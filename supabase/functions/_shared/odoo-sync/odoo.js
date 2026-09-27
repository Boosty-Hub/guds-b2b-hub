// Cliente JSON-RPC de Odoo en SOLO LECTURA. Sin dependencias: corre en Node (scripts) y en Deno
// (edge functions de Supabase). Cualquier método que no sea de lectura se rechaza antes de enviarse.

const METODOS_LECTURA = new Set(['search_read', 'read', 'search', 'search_count', 'read_group', 'fields_get']);

export function crearClienteOdoo({ url, db, usuario, apiKey, timeoutMs = 120000 }) {
  let uid = null;
  let empresasPermitidas = null;

  async function rpc(service, method, args) {
    const res = await fetch(`${url}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service, method, args }, id: Date.now() }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = await res.json();
    if (json.error) throw new Error(`Odoo: ${json.error.data?.message || json.error.message}`);
    return json.result;
  }

  async function leer(model, method, args = [], kwargs = {}, empresaActiva = null) {
    if (!METODOS_LECTURA.has(method)) throw new Error(`Bloqueado: "${method}" no es un método de solo lectura`);
    if (!uid) await autenticar();
    // La primera empresa de allowed_company_ids es la "empresa actual": define los campos por empresa
    // (plazo de pago, límite de crédito…). Sin la lista, Odoo solo devuelve la empresa por defecto.
    const empresas = empresaActiva
      ? [empresaActiva, ...empresasPermitidas.filter((e) => e !== empresaActiva)]
      : empresasPermitidas;
    const context = { active_test: false, allowed_company_ids: empresas, ...(kwargs.context || {}) };
    return rpc('object', 'execute_kw', [db, uid, apiKey, model, method, args, { ...kwargs, context }]);
  }

  async function autenticar() {
    uid = await rpc('common', 'authenticate', [db, usuario, apiKey, {}]);
    if (!uid) throw new Error(`Odoo rechazó la API key de ${usuario}`);
    const [yo] = await rpc('object', 'execute_kw', [db, uid, apiKey, 'res.users', 'read', [[uid]], { fields: ['company_ids'] }]);
    empresasPermitidas = yo.company_ids;
    return { uid, empresas: empresasPermitidas };
  }

  // Lee todos los registros de un dominio en páginas (orden estable por id).
  async function leerTodo(model, domain, fields, { empresa = null, pagina = 2000 } = {}) {
    const out = [];
    for (let offset = 0; ; offset += pagina) {
      const lote = await leer(model, 'search_read', [domain], { fields, limit: pagina, offset, order: 'id' }, empresa);
      out.push(...lote);
      if (lote.length < pagina) break;
    }
    return out;
  }

  return { autenticar, leer, leerTodo, get empresas() { return empresasPermitidas; } };
}

// Many2one de Odoo: [id, "nombre"] o false
export const m2oId = (v) => (Array.isArray(v) ? v[0] : null);
export const m2oNombre = (v) => (Array.isArray(v) ? v[1] : null);
