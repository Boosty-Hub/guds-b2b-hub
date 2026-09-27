/**
 * Diagnóstico + verificación (SOLO LECTURA) contra el Odoo de GUDS.
 *
 * Requiere salir por la IP autorizada por Corpo Eureka (VPN) y las credenciales ODOO_PG_* en .env.local:
 *   node scripts/odoo-verificar.mjs
 *
 * No escribe nada en Odoo: solo COUNT/SELECT y llamadas de lectura a la API.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const HOST = process.env.ODOO_PG_HOST;
const DB = process.env.ODOO_DB;
const PG_USER = process.env.ODOO_PG_USER;
const PG_PASSWORD = process.env.ODOO_PG_PASSWORD;
if (!HOST || !DB || !PG_USER || !PG_PASSWORD) { console.error('Falta ODOO_PG_HOST / ODOO_DB / ODOO_PG_USER / ODOO_PG_PASSWORD en .env.local'); process.exit(1); }
const BASE = `https://${HOST}`;

// ─────────────────────────────────────────────────────────────
// 1) ¿El tráfico HTTPS (API) llega bien desde esta máquina/VPN?
// ─────────────────────────────────────────────────────────────
console.log('══════════ 1. PRUEBA API HTTPS (JSON-RPC) ══════════');
async function rpc(payload) {
  const res = await fetch(`${BASE}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });
  return res.json();
}
try {
  const v = await rpc({ jsonrpc: '2.0', method: 'call', params: { service: 'common', method: 'version', args: [] }, id: 1 });
  console.log('✓ HTTPS OK. Odoo versión:', v.result?.server_version);
  const dl = await fetch(`${BASE}/web/database/list`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: '{"jsonrpc":"2.0","method":"call","params":{}}', signal: AbortSignal.timeout(20000),
  }).then(r => r.json());
  console.log('✓ Bases de datos visibles:', dl.result);
  console.log('→ Conclusión: la API HTTPS SÍ funciona desde tu máquina.');
  console.log('   (Con un usuario/API key de Odoo yo podría consultar todo desde aquí.)');
} catch (e) {
  console.log('✗ HTTPS falló:', e.message);
}

// ─────────────────────────────────────────────────────────────
// 2) Reintento Postgres directo con timeout largo + keepAlive
// ─────────────────────────────────────────────────────────────
console.log('\n══════════ 2. PRUEBA POSTGRES DIRECTO (puerto 5432) ══════════');
async function tryPg(ssl, label) {
  const client = new pg.Client({
    host: HOST, port: 5432, user: PG_USER, password: PG_PASSWORD, database: DB,
    ssl, keepAlive: true, connectionTimeoutMillis: 45000, statement_timeout: 30000,
  });
  const t0 = Date.now();
  try {
    await client.connect();
    console.log(`✓ Conectado por Postgres (${label}) en ${Date.now() - t0} ms`);
    return client;
  } catch (e) {
    console.log(`✗ ${label} falló tras ${Date.now() - t0} ms: ${e.message}`);
    try { await client.end(); } catch {}
    return null;
  }
}
let client = await tryPg(false, 'sin SSL');
if (!client) client = await tryPg({ rejectUnauthorized: false }, 'con SSL');

if (!client) {
  console.log('\n→ Postgres directo NO funciona (probable interferencia de la VPN WireGuard).');
  console.log('  La vía recomendada es la API HTTPS de arriba.');
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────
// 3) Si Postgres conectó: verificar productos y clientes
// ─────────────────────────────────────────────────────────────
try {
  console.log('\n══════════ 3. DATOS (solo lectura) ══════════');
  const meta = await client.query('select current_database() db, current_user usr, version() v');
  console.log('BD:', meta.rows[0].db, '| Usuario:', meta.rows[0].usr);
  console.log('Versión:', meta.rows[0].v.split(',')[0]);

  const tipos = await client.query(`
    select column_name, data_type from information_schema.columns
    where table_name = 'product_template' and column_name = 'name'`);
  const nameIsJsonb = tipos.rows[0]?.data_type === 'jsonb';
  const nombreProd = nameIsJsonb
    ? "COALESCE(name->>'es_VE', name->>'es_419', name->>'en_US', name::text)"
    : 'name';

  console.log('\n-- PRODUCTOS --');
  console.log('Plantillas:', (await client.query('select count(*)::int n from product_template')).rows[0].n);
  console.log('Variantes :', (await client.query('select count(*)::int n from product_product')).rows[0].n);
  console.table((await client.query(
    `select id, ${nombreProd} as nombre, default_code as codigo, list_price as precio
     from product_template order by id desc limit 10`)).rows);

  console.log('\n-- CLIENTES --');
  console.log('Clientes (customer_rank>0):', (await client.query('select count(*)::int n from res_partner where customer_rank > 0')).rows[0].n);
  console.log('res_partner (todos)       :', (await client.query('select count(*)::int n from res_partner')).rows[0].n);
  console.table((await client.query(
    `select id, name as nombre, vat as rif, email, phone, city
     from res_partner where customer_rank > 0 order by id desc limit 10`)).rows);

  console.log('\n✓ Verificación completada.');
} catch (e) {
  console.error('✗ Error en consultas:', e.message);
} finally {
  await client.end();
}
