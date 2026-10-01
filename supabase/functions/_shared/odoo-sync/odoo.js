// Cliente JSON-RPC de Odoo. Sin dependencias: corre en Node (scripts) y en Deno (edge functions de Supabase).
// - `leer`: SOLO métodos de lectura (incluye default_get, que calcula los valores por defecto sin escribir); cualquier otro se
//   rechaza antes de enviarse.
// - `crear`: solo `create` y solo en los modelos de CREACION_PERMITIDA:
//     · sale.order: pedidos aprobados en GUDS (Fase 9b).
//     · res.partner, en tres formas, cada una con su lista de campos:
//         dirección de entrega hija de un cliente (parent_id + type delivery/other, 19w);
//         persona de contacto hija de un cliente o de un proveedor (parent_id + type contact), marcada "(GUDS)" en las notas (20s, 20v);
//         cliente nuevo (sin parent_id, customer_rank 1, con su compañía), marcado "(GUDS)" en las notas (20s).
// - `escribir`: solo `write`, solo en los modelos y CAMPOS de ESCRITURA_PERMITIDA (decisiones del dueño, 28 y 29-sep):
//     · res.partner: dirección y teléfonos del cliente, editados en GUDS; límite de crédito (flanco 28); nombre y cargo SOLO
//       de personas de contacto que creó GUDS; correo de esas personas o del propio cliente (partner principal, sin padre;
//       decisión del 30-sep, 21b). Se comprueba en Odoo antes de escribir.
//     · stock.move / stock.move.line: cantidades entregadas de un documento de entrega asignado a un repartidor.
//     · product.template: imagen y descripción de venta editadas en GUDS (decisión 15, migración 20r). La imagen solo se
//       reemplaza: escribir image_1920 = false borraría su adjunto en Odoo y está bloqueado.
// - `accion`: solo los métodos de ACCIONES_PERMITIDAS (validar el documento de entrega cuando el repartidor lo cierra).
// - `nota`: deja una NOTA INTERNA "(GUDS)" en el historial (chatter) de un registro de NOTAS_PERMITIDAS (decisión D, 29-sep).
//   Siempre message_type 'comment' + subtipo mail.mt_note, sin destinatarios ni seguidores nuevos: no envía correos.
// Está PROHIBIDO borrar registros de Odoo desde GUDS: unlink, archivar (active) y cualquier otro método no existen aquí.

const METODOS_LECTURA = new Set(['search_read', 'read', 'search', 'search_count', 'read_group', 'fields_get', 'default_get']);
const CREACION_PERMITIDA = new Set(['sale.order', 'res.partner']);
const ESCRITURA_PERMITIDA = {
  'res.partner': new Set(['street', 'street2', 'city', 'zip', 'state_id', 'country_id', 'phone', 'mobile',
    'name', 'function', 'email', 'credit_limit', 'credit_limit_value', 'use_partner_credit_limit']),
  'stock.move': new Set(['quantity', 'picked']),
  'stock.move.line': new Set(['quantity', 'picked']),
  'product.template': new Set(['image_1920', 'description_sale']),
};
// Campos que solo se escriben en personas de contacto creadas por GUDS (type contact, con padre y marca "(GUDS)")
const SOLO_CONTACTOS_GUDS = { 'res.partner': new Set(['name', 'function']) };
// El correo, además, en el propio cliente (partner principal, sin padre), no en direcciones ni en contactos de Odoo
const CORREO_CLIENTE_O_CONTACTO_GUDS = { 'res.partner': new Set(['email']) };
const numeroNoNegativo = (campo) => (v) => (typeof v !== 'number' || !Number.isFinite(v) || v < 0 ? `${campo} debe ser un número mayor o igual a 0` : null);
// Valores que no se aceptan aunque el campo esté permitido (lo que en Odoo equivale a borrar algo)
const VALOR_PROHIBIDO = {
  'product.template': {
    image_1920: (v) => typeof v !== 'string' || v.length < 100 || !/^[A-Za-z0-9+/]+={0,2}$/.test(v.slice(-64))
      ? 'image_1920 solo acepta una imagen en base64 (quitar la imagen borraría su adjunto en Odoo)' : null,
    description_sale: (v) => (v !== false && typeof v !== 'string' ? 'description_sale debe ser texto' : null),
  },
  'res.partner': {
    name: (v) => (typeof v !== 'string' || !v.trim() ? 'el nombre no puede quedar vacío' : null),
    credit_limit: numeroNoNegativo('credit_limit'),
    credit_limit_value: numeroNoNegativo('credit_limit_value'),
    use_partner_credit_limit: (v) => (typeof v !== 'boolean' ? 'use_partner_credit_limit debe ser verdadero o falso' : null),
  },
};
const RE_IDIOMA = /^[a-z]{2,3}_[A-Z]{2}$/;
const ACCIONES_PERMITIDAS = { 'stock.picking': new Set(['button_validate']) };
const NOTAS_PERMITIDAS = new Set(['res.partner', 'product.template', 'stock.picking', 'sale.order']);
const TIPOS_DIRECCION = new Set(['delivery', 'other']);
// Marca de origen en las notas (comment) de lo que crea GUDS
export const RE_MARCA_GUDS = /^(<p>)?\(GUDS\)/;
const CAMPOS_ALTA = {
  direccion: new Set(['parent_id', 'type', 'name', 'street', 'street2', 'city', 'zip', 'state_id', 'country_id', 'company_id', 'phone', 'mobile']),
  contacto: new Set(['parent_id', 'type', 'company_id', 'name', 'function', 'email', 'phone', 'mobile', 'street', 'street2', 'city', 'zip',
    'state_id', 'country_id', 'comment', 'lang', 'tz', 'partner_type']),
  cliente: new Set(['company_id', 'name', 'vat', 'rif', 'cedula', 'has_cedula', 'email', 'phone', 'mobile', 'street', 'street2', 'city', 'zip',
    'state_id', 'country_id', 'is_company', 'customer_rank', 'user_id', 'property_product_pricelist', 'comment', 'lang', 'tz',
    'residence_type', 'partner_type', 'type']),
};

// Qué forma de res.partner se está creando; lanza si no es una de las permitidas
export function formaAltaPartner(vals) {
  let forma;
  if (vals.parent_id !== undefined) {
    if (!Number.isInteger(vals.parent_id)) throw new Error('Bloqueado: parent_id inválido');
    if (TIPOS_DIRECCION.has(vals.type)) forma = 'direccion';
    else if (vals.type === 'contact') forma = 'contacto';
    else throw new Error('Bloqueado: en res.partner solo se crean direcciones de entrega o personas de contacto hijas de un cliente o proveedor');
  } else {
    forma = 'cliente';
    if (vals.customer_rank !== 1 || !Number.isInteger(vals.company_id) || typeof vals.name !== 'string' || !vals.name.trim()) {
      throw new Error('Bloqueado: un cliente nuevo necesita nombre, compañía y customer_rank 1');
    }
    if (vals.type !== undefined && vals.type !== 'contact') throw new Error('Bloqueado: un cliente nuevo es de tipo contact');
  }
  if (forma !== 'direccion' && !(typeof vals.comment === 'string' && RE_MARCA_GUDS.test(vals.comment))) {
    throw new Error('Bloqueado: lo que GUDS crea en Odoo lleva la marca "(GUDS)" en las notas');
  }
  const ajenos = Object.keys(vals).filter((k) => !CAMPOS_ALTA[forma].has(k));
  if (ajenos.length) throw new Error(`Bloqueado: campos no permitidos al crear (${forma}) en res.partner: ${ajenos.join(', ')}`);
  return forma;
}

export function crearClienteOdoo({ url, db, usuario, apiKey, timeoutMs = 120000 }) {
  let uid = null;
  let empresasPermitidas = null;
  let idioma = null;

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
    const [yo] = await rpc('object', 'execute_kw', [db, uid, apiKey, 'res.users', 'read', [[uid]], { fields: ['company_ids', 'lang'] }]);
    empresasPermitidas = yo.company_ids;
    // Idioma del usuario de la API: los campos traducibles (descripción de venta) se leen y escriben en ese idioma
    idioma = RE_IDIOMA.test(yo.lang || '') ? yo.lang : null;
    return { uid, empresas: empresasPermitidas };
  }

  // Lee todos los registros de un dominio en páginas (orden estable por id).
  async function leerTodo(model, domain, fields, { empresa = null, pagina = 2000, contexto = null } = {}) {
    const out = [];
    for (let offset = 0; ; offset += pagina) {
      const lote = await leer(model, 'search_read', [domain], { fields, limit: pagina, offset, order: 'id', ...(contexto ? { context: contexto } : {}) }, empresa);
      out.push(...lote);
      if (lote.length < pagina) break;
    }
    return out;
  }

  function contextoEmpresa(empresaActiva, extra = {}) {
    if (!empresaActiva || !empresasPermitidas.includes(empresaActiva)) throw new Error(`Odoo: empresa ${empresaActiva} no permitida`);
    return { allowed_company_ids: [empresaActiva, ...empresasPermitidas.filter((e) => e !== empresaActiva)], ...extra };
  }

  // Crea UN registro (solo modelos y formas permitidas). Devuelve el id nuevo.
  async function crear(model, vals, empresaActiva) {
    if (!CREACION_PERMITIDA.has(model)) throw new Error(`Bloqueado: GUDS no crea registros de "${model}" en Odoo`);
    if (!vals || typeof vals !== 'object' || Array.isArray(vals)) throw new Error('crear: se espera un solo registro');
    // res.partner: dirección de entrega, persona de contacto hija de un cliente o proveedor, o cliente nuevo marcado "(GUDS)"
    if (model === 'res.partner') formaAltaPartner(vals);
    if (!uid) await autenticar();
    return rpc('object', 'execute_kw', [db, uid, apiKey, model, 'create', [vals], { context: contextoEmpresa(empresaActiva) }]);
  }

  // Modifica campos permitidos de registros existentes. Nunca borra. `lang`: idioma en que se escriben los campos traducibles.
  async function escribir(model, ids, vals, empresaActiva, { lang = null } = {}) {
    const campos = ESCRITURA_PERMITIDA[model];
    if (!campos) throw new Error(`Bloqueado: GUDS no modifica registros de "${model}" en Odoo`);
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 || !ids.every(Number.isInteger)) throw new Error('escribir: ids inválidos');
    if (!vals || typeof vals !== 'object' || Array.isArray(vals) || !Object.keys(vals).length) throw new Error('escribir: valores vacíos');
    const ajenos = Object.keys(vals).filter((k) => !campos.has(k));
    if (ajenos.length) throw new Error(`Bloqueado: campos no permitidos en ${model}: ${ajenos.join(', ')}`);
    for (const [k, v] of Object.entries(vals)) {
      const motivo = VALOR_PROHIBIDO[model]?.[k]?.(v);
      if (motivo) throw new Error(`Bloqueado: ${motivo}`);
    }
    if (lang !== null && !RE_IDIOMA.test(lang)) throw new Error('escribir: idioma inválido');
    if (!uid) await autenticar();
    // Nombre y cargo: solo de personas de contacto que creó GUDS (nunca el nombre de un cliente). Correo: de esas personas
    // o del propio cliente (21b)
    const soloContacto = Object.keys(vals).some((k) => SOLO_CONTACTOS_GUDS[model]?.has(k));
    const correo = Object.keys(vals).some((k) => CORREO_CLIENTE_O_CONTACTO_GUDS[model]?.has(k));
    if (soloContacto || correo) {
      const regs = await rpc('object', 'execute_kw', [db, uid, apiKey, model, 'read', [ids, ['type', 'parent_id', 'comment']],
        { context: { active_test: false, allowed_company_ids: empresasPermitidas } }]);
      const deGuds = (r) => r.type === 'contact' && Array.isArray(r.parent_id) && RE_MARCA_GUDS.test(String(r.comment || '').trim());
      // customer_rank no sirve (clientes con facturas quedan en 0): basta con el partner principal (sin padre, tipo contacto);
      // que sea un cliente de GUDS lo exige la cola (clientes.odoo_id)
      const esCliente = (r) => !Array.isArray(r.parent_id) && (r.type === 'contact' || !r.type);
      const ajenos = ids.filter((id) => {
        const r = regs.find((x) => x.id === id);
        if (!r) return true;
        if (soloContacto) return !deGuds(r);
        return !(deGuds(r) || esCliente(r));
      });
      if (ajenos.length) {
        throw new Error(soloContacto
          ? `Bloqueado: nombre y cargo solo se editan en personas de contacto creadas por GUDS (${ajenos.join(', ')})`
          : `Bloqueado: el correo solo se edita en el cliente o en personas de contacto creadas por GUDS (${ajenos.join(', ')})`);
      }
    }
    return rpc('object', 'execute_kw', [db, uid, apiKey, model, 'write', [ids, vals], { context: contextoEmpresa(empresaActiva, lang ? { lang } : {}) }]);
  }

  // Ejecuta un método de negocio permitido sobre registros existentes (p. ej. validar un documento de entrega).
  async function accion(model, metodo, ids, empresaActiva, contexto = {}) {
    if (!ACCIONES_PERMITIDAS[model]?.has(metodo)) throw new Error(`Bloqueado: "${model}.${metodo}" no está permitido desde GUDS`);
    if (!Array.isArray(ids) || ids.length !== 1 || !Number.isInteger(ids[0])) throw new Error('accion: se espera un solo registro');
    if (!uid) await autenticar();
    return rpc('object', 'execute_kw', [db, uid, apiKey, model, metodo, [ids], { context: contextoEmpresa(empresaActiva, contexto) }]);
  }

  // Nota interna en el historial de un registro (decisión D, 29-sep). Texto plano que empieza con "(GUDS)"; Odoo lo escapa.
  // message_type 'comment' + subtipo "Nota" (interno): no notifica a clientes ni seguidores y no envía correo. Sin partner_ids,
  // y con mail_create_nosubscribe para que el usuario de la API no quede como seguidor del registro. Devuelve el id del mensaje.
  async function nota(model, id, texto, empresaActiva) {
    if (!NOTAS_PERMITIDAS.has(model)) throw new Error(`Bloqueado: GUDS no deja notas en "${model}"`);
    if (!Number.isInteger(id) || id <= 0) throw new Error('nota: id inválido');
    const cuerpo = String(texto ?? '').replace(/\s+/g, ' ').trim();
    if (!cuerpo.startsWith('(GUDS)')) throw new Error('Bloqueado: las notas de GUDS empiezan con "(GUDS)"');
    if (cuerpo.length > 3000) throw new Error('nota: texto demasiado largo');
    if (!uid) await autenticar();
    return rpc('object', 'execute_kw', [db, uid, apiKey, model, 'message_post', [[id]], {
      body: cuerpo, message_type: 'comment', subtype_xmlid: 'mail.mt_note',
      context: contextoEmpresa(empresaActiva, { mail_create_nosubscribe: true, mail_post_autofollow: false }),
    }]);
  }

  return { autenticar, leer, leerTodo, crear, escribir, accion, nota, get empresas() { return empresasPermitidas; }, get idioma() { return idioma; } };
}

// Many2one de Odoo: [id, "nombre"] o false
export const m2oId = (v) => (Array.isArray(v) ? v[0] : null);
export const m2oNombre = (v) => (Array.isArray(v) ? v[1] : null);
