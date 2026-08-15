/**
 * Sincroniza ÓRDENES (sale_order + sale_order_line) Odoo → Supabase.
 * SOLO LECTURA en Odoo. Idempotente (upsert por odoo_id).
 * Enlaza cada orden a su cliente (commercial_partner) y cada línea a su producto de catálogo.
 *
 *   node scripts/sync-odoo-ordenes.mjs [--apply]
 */
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const REF = process.env.SUPABASE_PROJECT_REF;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

async function mgmt(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`Mgmt API ${r.status}: ${JSON.stringify(body)}`);
  return body;
}
const jsonbLit = (arr) => `'${JSON.stringify(arr).replace(/'/g, "''")}'::jsonb`;
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const stripHtml = (s) => s == null ? null : (String(s)
  .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim() || null);
const chunk = (a, n) => { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };

// USD según moneda de la orden (1=USD, ref puede ser USD para órdenes en Bs)
const usd = (val, refVal, cur, ref) => cur === 1 ? Number(val) : ref === 1 ? Number(refVal) : Number(val);

function mapEstado(state, delivery) {
  if (state === 'cancel') return 'cancelado';
  if (state === 'draft') return 'pendiente';
  if (delivery === 'full') return 'completado';
  if (delivery === 'partial' || delivery === 'started') return 'enviado';
  if (delivery === 'pending') return 'procesando';
  return 'confirmado';
}

// ── 1. EXTRACCIÓN ───────────────────────────────────────────────────────
const odoo = new pg.Client({
  host: process.env.ODOO_PG_HOST, port: 5432, user: process.env.ODOO_PG_USER,
  password: process.env.ODOO_PG_PASSWORD, database: 'guds-master.agroo.net.ve',
  ssl: false, connectionTimeoutMillis: 20000, statement_timeout: 120000,
});
await odoo.connect();
let rawOrders, rawLines;
try {
  rawOrders = (await odoo.query(`
    select so.id as odoo_id, so.name as numero,
      case when cp.customer_rank>0 then cp.id when p.customer_rank>0 then p.id end as cliente_odoo_id,
      cc.name as moneda_original, so.state as estado_odoo, so.delivery_status, so.date_order as fecha_pedido,
      so.amount_untaxed, so.amount_tax, so.amount_total, so.amount_total_ref,
      so.currency_id, so.ref_currency_id,
      sp.name as vendedor_odoo, nullif(trim(so.note),'') as notas
    from sale_order so
    left join res_partner p on p.id=so.partner_id
    left join res_partner cp on cp.id=p.commercial_partner_id
    left join res_currency cc on cc.id=so.currency_id
    left join res_users ru on ru.id=so.user_id
    left join res_partner sp on sp.id=ru.partner_id
    where (cp.customer_rank>0 or p.customer_rank>0)
    order by so.id`)).rows;

  rawLines = (await odoo.query(`
    select sol.id as odoo_id, sol.order_id as order_odoo_id,
      (case when pt.active and pt.sale_ok and pt.type='consu' then pt.id else null end) as prod_catalogo_odoo_id,
      left(coalesce(nullif(trim(sol.name),''), pt.name->>'es_VE', pt.name::text), 200) as nombre_producto,
      pt.default_code as sku_producto,
      sol.product_uom_qty as cantidad, coalesce(sol.discount,0) as descuento,
      sol.price_unit, sol.price_unit_ref, sol.price_subtotal, sol.price_subtotal_ref,
      so.currency_id, so.ref_currency_id
    from sale_order_line sol
    join sale_order so on so.id=sol.order_id
    left join product_product pp on pp.id=sol.product_id
    left join product_template pt on pt.id=pp.product_tmpl_id
    left join res_partner p on p.id=so.partner_id
    left join res_partner cp on cp.id=p.commercial_partner_id
    where sol.display_type is null and (cp.customer_rank>0 or p.customer_rank>0)
    order by sol.id`)).rows;
} finally { await odoo.end(); }

// ── 2. TRANSFORMACIÓN ───────────────────────────────────────────────────
const numsUsados = new Set();
const orders = rawOrders.map(o => {
  const total = usd(o.amount_total, o.amount_total_ref, o.currency_id, o.ref_currency_id);
  const factor = Number(o.amount_total) ? total / Number(o.amount_total) : 1;
  let numero = o.numero || `ODOO-${o.odoo_id}`;
  if (numsUsados.has(numero)) numero = `${numero}-${o.odoo_id}`; // Odoo tiene nombres duplicados
  numsUsados.add(numero);
  return {
    odoo_id: o.odoo_id,
    numero,
    cliente_odoo_id: o.cliente_odoo_id,
    moneda_original: o.moneda_original,
    estado_odoo: o.estado_odoo,
    estado: mapEstado(o.estado_odoo, o.delivery_status),
    fecha_pedido: o.fecha_pedido,
    subtotal: round2(Number(o.amount_untaxed) * factor),
    impuesto: round2(Number(o.amount_tax) * factor),
    total: round2(total),
    vendedor_odoo: o.vendedor_odoo,
    notas: stripHtml(o.notas),
  };
});

const items = rawLines.map(l => ({
  odoo_id: l.odoo_id,
  order_odoo_id: l.order_odoo_id,
  prod_catalogo_odoo_id: l.prod_catalogo_odoo_id,
  nombre_producto: l.nombre_producto,
  sku_producto: l.sku_producto,
  cantidad: Math.max(1, Math.round(Number(l.cantidad) || 0)),
  precio_unitario: round2(usd(l.price_unit, l.price_unit_ref, l.currency_id, l.ref_currency_id)),
  descuento: round2(l.descuento),
  subtotal: round2(usd(l.price_subtotal, l.price_subtotal_ref, l.currency_id, l.ref_currency_id)),
}));

console.log(`\n=== SYNC ÓRDENES ODOO → SUPABASE  [${APPLY ? 'APPLY' : 'DRY-RUN'}] ===`);
console.log('Órdenes:', orders.length, '| Líneas:', items.length,
            '| sin producto de catálogo:', items.filter(i => i.prod_catalogo_odoo_id == null).length);
const porEstado = orders.reduce((a, o) => (a[o.estado] = (a[o.estado] || 0) + 1, a), {});
console.log('Por estado:', JSON.stringify(porEstado));
console.log('Ejemplo orden:', JSON.stringify(orders[0]));

if (!APPLY) { console.log('\nDRY-RUN: nada escrito. Usá --apply.'); process.exit(0); }

// ── 3. DDL ──────────────────────────────────────────────────────────────
console.log('\n[1/4] DDL…');
await mgmt(`
  alter table public.ordenes add column if not exists odoo_id integer;
  alter table public.ordenes add column if not exists vendedor_odoo text;
  alter table public.ordenes add column if not exists moneda_original text;
  alter table public.ordenes add column if not exists estado_odoo text;
  alter table public.ordenes add column if not exists fecha_pedido timestamptz;
  create unique index if not exists ordenes_odoo_id_key on public.ordenes(odoo_id);
  alter table public.orden_items add column if not exists odoo_id integer;
  alter table public.orden_items add column if not exists nombre_producto text;
  alter table public.orden_items add column if not exists sku_producto text;
  alter table public.orden_items alter column producto_id drop not null;
  create unique index if not exists orden_items_odoo_id_key on public.orden_items(odoo_id);`);

// ── 4. Insert (con triggers de ordenes desactivados) ────────────────────
console.log('[2/4] Desactivando triggers de ordenes + upsert órdenes…');
await mgmt(`alter table public.ordenes disable trigger user`);
try {
  await mgmt(`
    insert into ordenes (odoo_id, numero, cliente_id, subtotal, impuesto, total, estado,
      moneda_original, estado_odoo, vendedor_odoo, notas, fecha_pedido, created_at, pagado, stock_descontado)
    select x.odoo_id, x.numero,
      (select id from clientes c where c.odoo_id = x.cliente_odoo_id),
      x.subtotal, x.impuesto, x.total, x.estado::public.orden_estado,
      x.moneda_original, x.estado_odoo, x.vendedor_odoo, x.notas, x.fecha_pedido, x.fecha_pedido, false, true
    from jsonb_to_recordset(${jsonbLit(orders)}) as x(
      odoo_id int, numero text, cliente_odoo_id int, subtotal numeric, impuesto numeric, total numeric,
      estado text, moneda_original text, estado_odoo text, vendedor_odoo text, notas text, fecha_pedido timestamptz)
    on conflict (odoo_id) do update set
      numero=excluded.numero, cliente_id=excluded.cliente_id, subtotal=excluded.subtotal,
      impuesto=excluded.impuesto, total=excluded.total, estado=excluded.estado,
      moneda_original=excluded.moneda_original, estado_odoo=excluded.estado_odoo,
      vendedor_odoo=excluded.vendedor_odoo, notas=excluded.notas, fecha_pedido=excluded.fecha_pedido;`);

  console.log('[3/4] Upsert líneas (por lotes)…');
  const lotes = chunk(items, 1000);
  let n = 0;
  for (const lote of lotes) {
    await mgmt(`
      insert into orden_items (odoo_id, orden_id, producto_id, nombre_producto, sku_producto, cantidad, precio_unitario, descuento, subtotal)
      select x.odoo_id,
        (select id from ordenes o where o.odoo_id = x.order_odoo_id),
        (select id from productos p where p.odoo_id = x.prod_catalogo_odoo_id),
        x.nombre_producto, x.sku_producto, x.cantidad, x.precio_unitario, x.descuento, x.subtotal
      from jsonb_to_recordset(${jsonbLit(lote)}) as x(
        odoo_id int, order_odoo_id int, prod_catalogo_odoo_id int, nombre_producto text, sku_producto text,
        cantidad int, precio_unitario numeric, descuento numeric, subtotal numeric)
      on conflict (odoo_id) do update set
        orden_id=excluded.orden_id, producto_id=excluded.producto_id, nombre_producto=excluded.nombre_producto,
        sku_producto=excluded.sku_producto, cantidad=excluded.cantidad, precio_unitario=excluded.precio_unitario,
        descuento=excluded.descuento, subtotal=excluded.subtotal;`);
    n += lote.length;
    console.log(`   … ${n}/${items.length} líneas`);
  }
} finally {
  await mgmt(`alter table public.ordenes enable trigger user`);
  console.log('   triggers de ordenes reactivados.');
}

console.log('[4/4] Verificación…');
const v = await mgmt(`select
  (select count(*) from ordenes) as ordenes,
  (select count(*) from orden_items) as items,
  (select count(*) from ordenes where cliente_id is null) as ordenes_sin_cliente,
  (select count(*) from orden_items where producto_id is null) as items_sin_producto,
  (select round(sum(total)::numeric,2) from ordenes) as total_usd`);
console.log(JSON.stringify(v[0] ?? v, null, 1));
console.log('\n✓ Sync órdenes completado.');
