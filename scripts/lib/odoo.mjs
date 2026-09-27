// Cliente de la API JSON-RPC de Odoo en SOLO LECTURA (key de ODOO_API_KEY en .env.local).
// odooRead() rechaza cualquier método que no sea de lectura antes de enviar nada.
import { requerir } from './entorno.mjs';

const { ODOO_URL, ODOO_DB, ODOO_USER, ODOO_API_KEY } = requerir('ODOO_URL', 'ODOO_DB', 'ODOO_USER', 'ODOO_API_KEY');
const METODOS_LECTURA = new Set(['search_read', 'read', 'search', 'search_count', 'read_group', 'fields_get']);

async function rpc(service, method, args) {
  const res = await fetch(`${ODOO_URL}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service, method, args }, id: Date.now() }),
    signal: AbortSignal.timeout(120000),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.data?.message || json.error.message);
  return json.result;
}

let sesion;
// Autentica una vez y devuelve { uid, empresas } con las empresas permitidas del usuario.
export async function conectarOdoo() {
  if (sesion) return sesion;
  const uid = await rpc('common', 'authenticate', [ODOO_DB, ODOO_USER, ODOO_API_KEY, {}]);
  if (!uid) throw new Error(`Odoo rechazó la key de ${ODOO_USER}`);
  sesion = { uid };
  const [yo] = await odooRead('res.users', 'read', [[uid]], { fields: ['company_ids'] });
  sesion.empresas = yo.company_ids;
  return sesion;
}

export async function odooRead(model, method, args = [], kwargs = {}) {
  if (!METODOS_LECTURA.has(method)) throw new Error(`Bloqueado: "${method}" no es un método de solo lectura`);
  const uid = sesion?.uid ?? (await conectarOdoo()).uid;
  // Sin allowed_company_ids Odoo solo devuelve la empresa por defecto del usuario.
  const context = { active_test: false, ...(sesion?.empresas ? { allowed_company_ids: sesion.empresas } : {}), ...(kwargs.context || {}) };
  return rpc('object', 'execute_kw', [ODOO_DB, uid, ODOO_API_KEY, model, method, args, { ...kwargs, context }]);
}

// search_read de ids concretos en lotes (para cruzar con lo que ya existe en Supabase).
export async function leerPorIds(model, ids, fields, lote = 500) {
  const out = [];
  for (let i = 0; i < ids.length; i += lote) {
    out.push(...await odooRead(model, 'search_read', [[['id', 'in', ids.slice(i, i + lote)]]], { fields }));
  }
  return out;
}

// Many2one de Odoo llega como [id, "nombre"] o false.
export const m2oId = (v) => (Array.isArray(v) ? v[0] : null);
