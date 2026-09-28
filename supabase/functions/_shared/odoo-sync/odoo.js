// Cliente JSON-RPC de Odoo. Sin dependencias: corre en Node (scripts) y en Deno (edge functions de Supabase).
// - `leer`: SOLO métodos de lectura; cualquier otro se rechaza antes de enviarse.
// - `crear`: solo `create` y solo en los modelos de CREACION_PERMITIDA (pedidos de GUDS y direcciones de entrega).
// - `escribir`: solo `write`, solo en los modelos y CAMPOS de ESCRITURA_PERMITIDA (decisiones del dueño, 28-sep):
//     · res.partner: dirección y teléfonos del cliente, editados en GUDS.
//     · stock.move / stock.move.line: cantidades entregadas de un documento de entrega asignado a un repartidor.
// - `accion`: solo los métodos de ACCIONES_PERMITIDAS (validar el documento de entrega cuando el repartidor lo cierra).
// Está PROHIBIDO borrar registros de Odoo desde GUDS: unlink y cualquier otro método no existen aquí.

const METODOS_LECTURA = new Set(['search_read', 'read', 'search', 'search_count', 'read_group', 'fields_get']);
const CREACION_PERMITIDA = new Set(['sale.order', 'res.partner']);
const ESCRITURA_PERMITIDA = {
  'res.partner': new Set(['street', 'street2', 'city', 'zip', 'state_id', 'country_id', 'phone', 'mobile']),
  'stock.move': new Set(['quantity', 'picked']),
  'stock.move.line': new Set(['quantity', 'picked']),
};
const ACCIONES_PERMITIDAS = { 'stock.picking': new Set(['button_validate']) };
const TIPOS_DIRECCION = new Set(['delivery', 'other']);

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

  function contextoEmpresa(empresaActiva, extra = {}) {
    if (!empresaActiva || !empresasPermitidas.includes(empresaActiva)) throw new Error(`Odoo: empresa ${empresaActiva} no permitida`);
    return { allowed_company_ids: [empresaActiva, ...empresasPermitidas.filter((e) => e !== empresaActiva)], ...extra };
  }

  // Crea UN registro (solo modelos permitidos). Devuelve el id nuevo.
  async function crear(model, vals, empresaActiva) {
    if (!CREACION_PERMITIDA.has(model)) throw new Error(`Bloqueado: GUDS no crea registros de "${model}" en Odoo`);
    if (!vals || typeof vals !== 'object' || Array.isArray(vals)) throw new Error('crear: se espera un solo registro');
    // Contactos: solo direcciones hijas de un cliente existente (sucursal / dirección de entrega)
    if (model === 'res.partner' && (!Number.isInteger(vals.parent_id) || !TIPOS_DIRECCION.has(vals.type))) {
      throw new Error('Bloqueado: en res.partner solo se crean direcciones de entrega de un cliente (parent_id + type delivery/other)');
    }
    if (!uid) await autenticar();
    return rpc('object', 'execute_kw', [db, uid, apiKey, model, 'create', [vals], { context: contextoEmpresa(empresaActiva) }]);
  }

  // Modifica campos permitidos de registros existentes. Nunca borra.
  async function escribir(model, ids, vals, empresaActiva) {
    const campos = ESCRITURA_PERMITIDA[model];
    if (!campos) throw new Error(`Bloqueado: GUDS no modifica registros de "${model}" en Odoo`);
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 || !ids.every(Number.isInteger)) throw new Error('escribir: ids inválidos');
    if (!vals || typeof vals !== 'object' || Array.isArray(vals) || !Object.keys(vals).length) throw new Error('escribir: valores vacíos');
    const ajenos = Object.keys(vals).filter((k) => !campos.has(k));
    if (ajenos.length) throw new Error(`Bloqueado: campos no permitidos en ${model}: ${ajenos.join(', ')}`);
    if (!uid) await autenticar();
    return rpc('object', 'execute_kw', [db, uid, apiKey, model, 'write', [ids, vals], { context: contextoEmpresa(empresaActiva) }]);
  }

  // Ejecuta un método de negocio permitido sobre registros existentes (p. ej. validar un documento de entrega).
  async function accion(model, metodo, ids, empresaActiva, contexto = {}) {
    if (!ACCIONES_PERMITIDAS[model]?.has(metodo)) throw new Error(`Bloqueado: "${model}.${metodo}" no está permitido desde GUDS`);
    if (!Array.isArray(ids) || ids.length !== 1 || !Number.isInteger(ids[0])) throw new Error('accion: se espera un solo registro');
    if (!uid) await autenticar();
    return rpc('object', 'execute_kw', [db, uid, apiKey, model, metodo, [ids], { context: contextoEmpresa(empresaActiva, contexto) }]);
  }

  return { autenticar, leer, leerTodo, crear, escribir, accion, get empresas() { return empresasPermitidas; } };
}

// Many2one de Odoo: [id, "nombre"] o false
export const m2oId = (v) => (Array.isArray(v) ? v[0] : null);
export const m2oNombre = (v) => (Array.isArray(v) ? v[1] : null);
