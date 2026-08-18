/**
 * Sincroniza RETENCIONES (IVA/ISLR) confirmadas desde Odoo → Supabase
 * (retenciones / retencion_items). SOLO LECTURA en Odoo. Idempotente (upsert por odoo_id).
 *
 * CRÍTICO: se migran con estado='aprobado' y odoo_id NOT NULL — la Fase 13 excluye del
 * recálculo de facturas.monto_retenido_usd toda retención con odoo_id no nulo, porque
 * facturas.saldo_odoo_usd (amount_residual_signed) YA viene neto de estas retenciones en
 * Odoo. Si este script llegara a insertar con odoo_id null, el trigger las descontaría
 * DOS VECES. Ver supabase/migrations/20260820_fase13a_retenciones_schema.sql.
 *
 * Uso:
 *   ODOO_PG_HOST/ODOO_PG_USER/ODOO_PG_PASSWORD + SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF
 *   node scripts/sync-odoo-retenciones.mjs [--apply]
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
let ivaHeaders, ivaLines, islrHeaders, islrLines;
try {
  ivaHeaders = (await odoo.query(`
    select id, number, date, partner_id from account_wh_iva where state = 'confirmed'`)).rows;
  ivaLines = (await odoo.query(`
    select id, retention_id, invoice_id, base_tax, ret_amount
    from account_wh_iva_line where state = 'confirmed' and active = true`)).rows;
  islrHeaders = (await odoo.query(`
    select id, number, date, partner_id, code_withholding, percentage
    from account_wh_islr where state = 'confirmed'`)).rows;
  islrLines = (await odoo.query(`
    select id, withholding_id, invoice_id, base_tax, ret_amount
    from account_wh_islr_line where state = 'confirmed'`)).rows;
} finally { await odoo.end(); }

console.log(`\n=== IMPORT RETENCIONES  [${APPLY ? 'APPLY' : 'DRY-RUN'}] ===`);
console.log('account_wh_iva confirmadas:', ivaHeaders.length, '| líneas:', ivaLines.length);
console.log('account_wh_islr confirmadas:', islrHeaders.length, '| líneas:', islrLines.length);

// ── 2. Ratio USD por factura (mismo factor total_usd/total ya usado para facturas) ──
const facMap = {}; // odoo_id -> { id, total, total_usd }
{
  const rows = await mgmt(`select odoo_id, id, total, total_usd from facturas where odoo_id is not null`);
  for (const f of rows) facMap[f.odoo_id] = f;
}
const clienteMap = {}; // odoo_partner_id -> cliente uuid
{
  const rows = await mgmt(`select odoo_id, id from clientes where odoo_id is not null`);
  for (const c of rows) clienteMap[c.odoo_id] = c.id;
}
const conceptoMap = {}; // codigo -> uuid
{
  const rows = await mgmt(`select codigo, id from conceptos_retencion_islr`);
  for (const c of rows) conceptoMap[c.codigo] = c.id;
}
const ratioUsd = (odooInvoiceId) => {
  const f = facMap[odooInvoiceId];
  if (!f || !Number(f.total)) return null;
  return Number(f.total_usd) / Number(f.total);
};

// ── 3. Transformación ───────────────────────────────────────────────────
const ivaLinesByHeader = new Map();
for (const l of ivaLines) { const a = ivaLinesByHeader.get(l.retention_id) || []; a.push(l); ivaLinesByHeader.set(l.retention_id, a); }
const islrLinesByHeader = new Map();
for (const l of islrLines) { const a = islrLinesByHeader.get(l.withholding_id) || []; a.push(l); islrLinesByHeader.set(l.withholding_id, a); }

const retenciones = [];
const items = [];
let sinCliente = 0, sinFactura = 0;

for (const h of ivaHeaders) {
  const cliente_id = clienteMap[h.partner_id];
  if (!cliente_id) { sinCliente++; continue; }
  const lineas = ivaLinesByHeader.get(h.id) || [];
  let base = 0, total = 0;
  const its = [];
  for (const l of lineas) {
    const ratio = ratioUsd(l.invoice_id);
    const factura = facMap[l.invoice_id];
    if (!factura || ratio == null) { sinFactura++; continue; }
    const monto = round2(Number(l.ret_amount) * ratio);
    if (monto <= 0) continue;
    base += round2(Number(l.base_tax) * ratio);
    total += monto;
    its.push({ odoo_id: l.id, factura_odoo_id: l.invoice_id, monto_aplicado: monto });
  }
  if (its.length === 0) continue;
  retenciones.push({ odoo_id: h.id, numero: h.number, tipo: 'iva', cliente_odoo_id: h.partner_id, concepto_codigo: null, fecha: h.date, base_imponible: round2(base), total: round2(total) });
  items.push(...its.map((i) => ({ ...i, retencion_odoo_id: h.id })));
}

for (const h of islrHeaders) {
  const cliente_id = clienteMap[h.partner_id];
  if (!cliente_id) { sinCliente++; continue; }
  const lineas = islrLinesByHeader.get(h.id) || [];
  let base = 0, total = 0;
  const its = [];
  for (const l of lineas) {
    const ratio = ratioUsd(l.invoice_id);
    const factura = facMap[l.invoice_id];
    if (!factura || ratio == null) { sinFactura++; continue; }
    const monto = round2(Number(l.ret_amount) * ratio);
    if (monto <= 0) continue;
    base += round2(Number(l.base_tax) * ratio);
    total += monto;
    its.push({ odoo_id: l.id, factura_odoo_id: l.invoice_id, monto_aplicado: monto });
  }
  if (its.length === 0) continue;
  retenciones.push({ odoo_id: h.id, numero: h.number, tipo: 'islr', cliente_odoo_id: h.partner_id, concepto_codigo: h.code_withholding, fecha: h.date, base_imponible: round2(base), total: round2(total) });
  items.push(...its.map((i) => ({ ...i, retencion_odoo_id: h.id })));
}

console.log('Retenciones con cliente y facturas resueltas:', retenciones.length, '(IVA:', retenciones.filter(r => r.tipo === 'iva').length, '· ISLR:', retenciones.filter(r => r.tipo === 'islr').length, ')');
console.log('Descartadas por cliente no resoluble:', sinCliente, '| líneas descartadas por factura no resoluble:', sinFactura);
console.log('Total retenido (USD, aprox):', round2(retenciones.reduce((s, r) => s + r.total, 0)));

if (!APPLY) { console.log('\nDRY-RUN: nada escrito. Usá --apply.'); process.exit(0); }

// ── 4. UPSERT ─────────────────────────────────────────────────────────────
console.log('\n[1/2] Upsert retenciones (header)…');
let n = 0;
for (const lote of chunk(retenciones, 300)) {
  await mgmt(`
    insert into public.retenciones (odoo_id, numero, tipo, cliente_id, concepto_islr_id, fecha, base_imponible, total, estado, rol_declarante)
    select
      x.odoo_id, x.numero, x.tipo,
      (select id from clientes c where c.odoo_id = x.cliente_odoo_id),
      (select id from conceptos_retencion_islr co where co.codigo = x.concepto_codigo),
      x.fecha, x.base_imponible, x.total, 'aprobado', 'admin'
    from jsonb_to_recordset(${jsonbLit(lote)}) as x(
      odoo_id int, numero text, tipo text, cliente_odoo_id int, concepto_codigo text,
      fecha date, base_imponible numeric, total numeric)
    where exists (select 1 from clientes c where c.odoo_id = x.cliente_odoo_id)
    on conflict (odoo_id) do update set
      numero = excluded.numero, fecha = excluded.fecha,
      base_imponible = excluded.base_imponible, total = excluded.total;`);
  n += lote.length; console.log(`   … ${n}/${retenciones.length}`);
}

console.log('[2/2] Upsert líneas de retención…');
n = 0;
for (const lote of chunk(items, 500)) {
  await mgmt(`
    insert into public.retencion_items (odoo_id, retencion_id, factura_id, monto_aplicado)
    select x.odoo_id,
      (select id from retenciones r where r.odoo_id = x.retencion_odoo_id),
      (select id from facturas f where f.odoo_id = x.factura_odoo_id),
      x.monto_aplicado
    from jsonb_to_recordset(${jsonbLit(lote)}) as x(
      odoo_id int, retencion_odoo_id int, factura_odoo_id int, monto_aplicado numeric)
    where exists (select 1 from retenciones r where r.odoo_id = x.retencion_odoo_id)
      and exists (select 1 from facturas f where f.odoo_id = x.factura_odoo_id)
    on conflict (odoo_id) do update set monto_aplicado = excluded.monto_aplicado;`);
  n += lote.length; console.log(`   … ${n}/${items.length}`);
}

console.log('\nVerificación (la deuda NO debe cambiar — las migradas quedan excluidas del trigger)…');
const v = await mgmt(`select
  (select count(*) from retenciones where odoo_id is not null) retenciones_migradas,
  (select count(*) from retencion_items ri join retenciones r on r.id=ri.retencion_id where r.odoo_id is not null) items_migrados,
  (select round(sum(saldo_usd),2) from facturas where estado='posted') deuda_total`);
console.log(JSON.stringify(v[0], null, 1));
console.log('\n✓ Import de retenciones completado.');
