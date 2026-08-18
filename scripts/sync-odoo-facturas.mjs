/**
 * Sincroniza FACTURAS (account_move: out_invoice/out_refund, posted) + sus líneas
 * (account_move_line) desde Odoo → Supabase (facturas / factura_items).
 * SOLO LECTURA en Odoo. Idempotente (upsert por odoo_id).
 *
 * Uso:
 *   ODOO_PG_* + SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF en el entorno.
 *   node scripts/sync-odoo-facturas.mjs [--apply]
 *     (sin flags)  -> dry-run (solo cuenta e imprime resumen)
 *     --apply      -> upsert real de facturas + líneas
 *
 * Requiere que ya exista la migración 20260817_fase10_facturas.sql aplicada
 * (tablas public.facturas / public.factura_items).
 */
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const REF = process.env.SUPABASE_PROJECT_REF, TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
async function mgmt(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const b = await r.json(); if (!r.ok) throw new Error(`${r.status}: ${JSON.stringify(b)}`); return b;
}
const jsonbLit = (a) => `'${JSON.stringify(a).replace(/'/g, "''")}'::jsonb`;
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

// ── 1. EXTRACCIÓN (solo lectura) ────────────────────────────────────────
const odoo = new pg.Client({
  host: process.env.ODOO_PG_HOST, port: 5432, user: process.env.ODOO_PG_USER,
  password: process.env.ODOO_PG_PASSWORD, database: 'guds-master.agroo.net.ve',
  ssl: false, connectionTimeoutMillis: 20000, statement_timeout: 120000,
});
await odoo.connect();
let rawFacturas, rawLineas;
try {
  rawFacturas = (await odoo.query(`
    select am.id, am.name, am.move_type, am.invoice_date, am.invoice_date_due,
      am.sale_id, cc.name as moneda, am.invoice_currency_rate,
      am.amount_untaxed, am.amount_tax, am.amount_total, am.amount_residual,
      am.amount_total_signed, am.amount_residual_signed,
      am.payment_state, am.ref, am.nro_control,
      case when cp.customer_rank>0 then cp.id when p.customer_rank>0 then p.id end as cliente_odoo_id,
      rp_v.name as vendedor_nombre
    from account_move am
    left join res_partner p on p.id = am.partner_id
    left join res_partner cp on cp.id = p.commercial_partner_id
    left join res_currency cc on cc.id = am.currency_id
    left join res_users ru on ru.id = am.invoice_user_id
    left join res_partner rp_v on rp_v.id = ru.partner_id
    where am.move_type in ('out_invoice','out_refund') and am.state = 'posted'`)).rows;

  const ids = rawFacturas.map(f => f.id);
  rawLineas = ids.length ? (await odoo.query(`
    select l.id, l.move_id, l.name, l.quantity, l.price_unit, l.price_subtotal, l.price_total, l.discount,
      pp.product_tmpl_id as producto_odoo_id
    from account_move_line l
    left join product_product pp on pp.id = l.product_id
    where l.move_id = any($1) and l.display_type = 'product'`, [ids])).rows : [];
} finally { await odoo.end(); }

// ── 2. TRANSFORMACIÓN ────────────────────────────────────────────────────
const estadoPago = (ps) => ps === 'paid' ? 'pagado' : ps === 'partial' || ps === 'in_payment' ? 'parcial' : ps === 'reversed' ? 'anulado' : 'pendiente';

const facturas = rawFacturas
  .filter(f => f.cliente_odoo_id)
  .map(f => ({
    odoo_id: f.id,
    numero: f.name,
    tipo: f.move_type === 'out_refund' ? 'nota_credito' : 'factura',
    cliente_odoo_id: f.cliente_odoo_id,
    orden_odoo_id: f.sale_id || null,
    fecha_emision: f.invoice_date,
    fecha_vencimiento: f.invoice_date_due,
    moneda: f.moneda === 'USD' ? 'USD' : 'VES',
    tasa_cambio: f.invoice_currency_rate != null ? round2(f.invoice_currency_rate) : null,
    subtotal: round2(f.amount_untaxed),
    impuesto: round2(f.amount_tax),
    total: round2(f.amount_total),
    monto_pagado: round2(Number(f.amount_total) - Number(f.amount_residual)),
    saldo_pendiente: round2(f.amount_residual),
    // Fase 11a: USD canónico (moneda de la compañía), ya con signo (negativo en notas de crédito).
    total_usd: round2(f.amount_total_signed),
    saldo_odoo_usd: round2(f.amount_residual_signed),
    estado_pago: estadoPago(f.payment_state),
    referencia: f.ref || null,
    nro_control: f.nro_control || null,
    vendedor_odoo: f.vendedor_nombre || null,
  }));

const facturaIds = new Set(facturas.map(f => f.odoo_id));
const lineas = rawLineas
  .filter(l => facturaIds.has(l.move_id))
  .map(l => ({
    odoo_id: l.id,
    factura_odoo_id: l.move_id,
    producto_odoo_id: l.producto_odoo_id || null,
    nombre_producto: l.name,
    cantidad: round2(l.quantity),
    precio_unitario: round2(l.price_unit),
    descuento: round2(l.discount),
    subtotal: round2(l.price_subtotal),
    total: round2(l.price_total),
  }));

console.log(`\n=== IMPORT FACTURAS  [${APPLY ? 'APPLY' : 'DRY-RUN'}] ===`);
console.log('account_move (out_invoice/out_refund, posted):', rawFacturas.length);
console.log('  con cliente resoluble:', facturas.length, '| sin cliente:', rawFacturas.length - facturas.length);
console.log('  con orden origen (sale_id):', facturas.filter(f => f.orden_odoo_id).length);
console.log('  moneda USD:', facturas.filter(f => f.moneda === 'USD').length, '| VES:', facturas.filter(f => f.moneda === 'VES').length);
console.log('Líneas de factura:', lineas.length);
console.log('Total facturado (USD, aprox, sin convertir VES):',
  round2(facturas.filter(f => f.moneda === 'USD').reduce((s, f) => s + f.total, 0)));

if (!APPLY) { console.log('\nDRY-RUN: nada escrito. Usá --apply.'); process.exit(0); }

// ── 3. UPSERT ─────────────────────────────────────────────────────────────
console.log('\n[1/2] Upsert facturas…');
let n = 0;
for (const lote of chunk(facturas, 500)) {
  await mgmt(`
    insert into public.facturas (
      odoo_id, numero, tipo, cliente_id, orden_id, fecha_emision, fecha_vencimiento,
      moneda, tasa_cambio, subtotal, impuesto, total, monto_pagado, saldo_pendiente,
      total_usd, saldo_odoo_usd, odoo_sync_at,
      estado_pago, referencia, nro_control, vendedor_odoo)
    select
      x.odoo_id, x.numero, x.tipo,
      (select id from clientes c where c.odoo_id = x.cliente_odoo_id),
      (select id from ordenes o where o.odoo_id = x.orden_odoo_id),
      x.fecha_emision, x.fecha_vencimiento, x.moneda, x.tasa_cambio,
      x.subtotal, x.impuesto, x.total, x.monto_pagado, x.saldo_pendiente,
      x.total_usd, x.saldo_odoo_usd, now(),
      x.estado_pago, x.referencia, x.nro_control, x.vendedor_odoo
    from jsonb_to_recordset(${jsonbLit(lote)}) as x(
      odoo_id int, numero text, tipo text, cliente_odoo_id int, orden_odoo_id int,
      fecha_emision date, fecha_vencimiento date, moneda text, tasa_cambio numeric,
      subtotal numeric, impuesto numeric, total numeric, monto_pagado numeric, saldo_pendiente numeric,
      total_usd numeric, saldo_odoo_usd numeric,
      estado_pago text, referencia text, nro_control text, vendedor_odoo text)
    where exists (select 1 from clientes c where c.odoo_id = x.cliente_odoo_id)
    -- Nota (Fase 11a): NO se sobrescriben monto_pagado/saldo_pendiente en re-sync (deprecados,
    -- solo presentación en la moneda del documento al momento del import inicial). El saldo real
    -- vivo es facturas.saldo_usd (generado), que depende de saldo_odoo_usd (esto sí se refresca)
    -- y de monto_aplicado_usd (mantenido por trigger desde pago_facturas, nunca por este script).
    on conflict (odoo_id) do update set
      numero=excluded.numero, tipo=excluded.tipo, cliente_id=excluded.cliente_id, orden_id=excluded.orden_id,
      fecha_emision=excluded.fecha_emision, fecha_vencimiento=excluded.fecha_vencimiento,
      moneda=excluded.moneda, tasa_cambio=excluded.tasa_cambio,
      subtotal=excluded.subtotal, impuesto=excluded.impuesto, total=excluded.total,
      total_usd=excluded.total_usd, saldo_odoo_usd=excluded.saldo_odoo_usd, odoo_sync_at=excluded.odoo_sync_at,
      estado_pago=excluded.estado_pago, referencia=excluded.referencia, nro_control=excluded.nro_control,
      vendedor_odoo=excluded.vendedor_odoo;`);
  n += lote.length; console.log(`   … ${n}/${facturas.length}`);
}

console.log('[2/2] Upsert líneas de factura…');
n = 0;
for (const lote of chunk(lineas, 800)) {
  await mgmt(`
    insert into public.factura_items (
      odoo_id, factura_id, producto_id, nombre_producto, cantidad, precio_unitario, descuento, subtotal, total)
    select
      x.odoo_id, (select id from facturas f where f.odoo_id = x.factura_odoo_id),
      (select id from productos p where p.odoo_id = x.producto_odoo_id),
      x.nombre_producto, x.cantidad, x.precio_unitario, x.descuento, x.subtotal, x.total
    from jsonb_to_recordset(${jsonbLit(lote)}) as x(
      odoo_id int, factura_odoo_id int, producto_odoo_id int, nombre_producto text,
      cantidad numeric, precio_unitario numeric, descuento numeric, subtotal numeric, total numeric)
    where exists (select 1 from facturas f where f.odoo_id = x.factura_odoo_id)
    on conflict (odoo_id) do update set
      producto_id=excluded.producto_id, nombre_producto=excluded.nombre_producto,
      cantidad=excluded.cantidad, precio_unitario=excluded.precio_unitario,
      descuento=excluded.descuento, subtotal=excluded.subtotal, total=excluded.total;`);
  n += lote.length; console.log(`   … ${n}/${lineas.length}`);
}

console.log('\nVerificación…');
const v = await mgmt(`select
  (select count(*) from facturas) facturas,
  (select count(*) from facturas where orden_id is not null) facturas_con_orden,
  (select count(*) from factura_items) items,
  (select round(sum(saldo_usd),2) from facturas where estado='posted') deuda_real_usd`);
console.log(JSON.stringify(v[0], null, 1));
console.log('\n✓ Import de facturas completado.');
