/**
 * Prueba la API key de Odoo (JSON-RPC por HTTPS) — SOLO LECTURA.
 *
 * Lee ODOO_URL, ODOO_DB, ODOO_USER y ODOO_API_KEY de .env.local y:
 *   1. autentica con la key,
 *   2. muestra las empresas a las que tiene acceso el usuario,
 *   3. cuenta registros por empresa (facturas, órdenes, pagos, clientes, productos).
 *
 * Uso (desde la raíz del repo):
 *   node scripts/odoo-api-probar.mjs
 *
 * La key del usuario tiene permisos de administrador en Odoo, así que odooRead()
 * solo deja pasar métodos de lectura: cualquier otro lanza error antes de salir.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}
const { ODOO_URL, ODOO_DB, ODOO_USER, ODOO_API_KEY } = process.env;
if (!ODOO_URL || !ODOO_DB || !ODOO_USER || !ODOO_API_KEY) {
  console.error('✗ Falta ODOO_URL / ODOO_DB / ODOO_USER / ODOO_API_KEY en .env.local');
  process.exit(1);
}

const METODOS_LECTURA = new Set(['search_read', 'read', 'search', 'search_count', 'read_group', 'fields_get']);

async function rpc(service, method, args) {
  const res = await fetch(`${ODOO_URL}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service, method, args }, id: Date.now() }),
    signal: AbortSignal.timeout(30000),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.data?.message || json.error.message);
  return json.result;
}

let uid;
async function odooRead(model, method, args = [], kwargs = {}) {
  if (!METODOS_LECTURA.has(method)) throw new Error(`Bloqueado: "${method}" no es un método de solo lectura`);
  return rpc('object', 'execute_kw', [ODOO_DB, uid, ODOO_API_KEY, model, method, args, kwargs]);
}

console.log('── 1. Autenticación ──');
uid = await rpc('common', 'authenticate', [ODOO_DB, ODOO_USER, ODOO_API_KEY, {}]);
if (!uid) {
  console.error(`✗ Odoo rechazó la key para ${ODOO_USER} (key inválida, vencida o usuario archivado)`);
  process.exit(1);
}
console.log(`✓ Autenticado como ${ODOO_USER} (uid ${uid})`);

console.log('\n── 2. Empresas permitidas ──');
const [yo] = await odooRead('res.users', 'read', [[uid]], { fields: ['name', 'company_id', 'company_ids'] });
const empresas = await odooRead('res.company', 'search_read', [[['id', 'in', yo.company_ids]]], { fields: ['name'] });
console.table(empresas.map(e => ({ id: e.id, empresa: e.name })));

// Sin allowed_company_ids, Odoo solo devuelve registros de la empresa por defecto del usuario.
const context = { allowed_company_ids: yo.company_ids };

console.log('\n── 3. Registros por empresa (solo lectura) ──');
const conteos = [
  ['Facturas de venta', 'account.move', [['move_type', '=', 'out_invoice']]],
  ['Notas de crédito venta', 'account.move', [['move_type', '=', 'out_refund']]],
  ['Facturas de proveedor', 'account.move', [['move_type', '=', 'in_invoice']]],
  ['Órdenes de venta', 'sale.order', []],
  ['Pagos', 'account.payment', []],
  ['Clientes', 'res.partner', [['customer_rank', '>', 0]]],
  ['Proveedores', 'res.partner', [['supplier_rank', '>', 0]]],
  ['Productos', 'product.template', []],
];
const filas = [];
for (const [label, model, domain] of conteos) {
  const fila = { dato: label };
  for (const e of empresas) {
    fila[e.name.slice(0, 20)] = await odooRead(model, 'search_count', [[...domain, ['company_id', '=', e.id]]], { context });
  }
  filas.push(fila);
}
console.table(filas);
console.log('\n✓ La API key funciona en modo lectura.');
