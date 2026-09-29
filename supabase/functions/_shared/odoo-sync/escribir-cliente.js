// Dirección y teléfonos de un cliente editados en GUDS → Odoo (res.partner). Migración 19w (decisión del dueño, 28-sep:
// "en cliente se puede editar direcciones y teléfono y se actualiza en Odoo").
//
// - cliente_contacto: teléfono, celular y dirección (calle, complemento, ciudad, estado) del contacto del cliente
//   (clientes.odoo_id). Lo encola actualizar_contacto_cliente().
// - cliente_direccion: edita una dirección de entrega existente (hija del cliente en Odoo) o crea una nueva
//   (type 'delivery', la que trae el importador). Lo encola guardar_direccion_cliente().
//
// Las funciones SQL ya validaron permisos y formato; aquí se vuelve a comprobar contra Odoo (que el registro exista y sea
// del cliente, que el estado exista) antes de escribir. El estado se busca por nombre en res.country.state (Venezuela).
// Siempre lee Odoo y arma el plan: en modo simular (aplicar = false) lo devuelve sin escribir en Odoo ni tocar GUDS.
// Si Odoo acepta, relee el registro y deja la ficha de GUDS con lo que quedó en Odoo (el mismo mapeo que importar.js),
// para no esperar a la próxima sincronización. Solo usa `escribir`/`crear` de odoo.js: nunca borra nada en Odoo.
// Cada cambio aplicado deja una nota interna "(GUDS)" en el cliente en Odoo (decisión D, 29-sep); si la nota falla, el cambio
// no se revierte y el error queda en el resultado.
import { m2oId, m2oNombre } from './odoo.js';
import { txt, fechaCaracas } from './util.js';
import { dejarNota, cambiosTexto } from './notas.js';

const CAMPOS_PARTNER = ['name', 'type', 'parent_id', 'company_id', 'street', 'street2', 'city', 'state_id', 'country_id',
  'phone', 'mobile', 'active'];
const CAMPOS_DIRECCION = ['street', 'street2', 'city', 'state_id', 'country_id'];
const ETIQUETA = { phone: 'Teléfono', mobile: 'Celular', street: 'Calle', street2: 'Complemento', city: 'Ciudad', state_id: 'Estado', country_id: 'País' };
const conEtiquetas = (cambios) => cambios.map((c) => ({ ...c, etiqueta: ETIQUETA[c.campo] ?? c.campo }));

const lit = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
// "Bolívar", "Bolivar." y "Bolivar. (VE)" son el mismo estado
const normEstado = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\([^)]*\)/g, '')
  .replace(/\./g, '').replace(/\s+/g, ' ').trim().toLowerCase();
// Valor de Odoo comparable: false/'' → null; many2one → id
const valorOdoo = (v) => (Array.isArray(v) ? v[0] : v === false || v === '' || v === undefined ? null : v);

// Texto que GUDS guarda, igual que importar.js
const direccionGuds = (p) => [txt(p.street), txt(p.street2)].filter(Boolean).join(', ') || null;

async function empresaOdoo(sql, odoo, empresaId, partner) {
  if (empresaId) {
    const [e] = await sql(`select odoo_company_id from empresas where id = ${lit(empresaId)}`);
    if (!e?.odoo_company_id) throw new Error('La empresa del cliente no está ligada a Odoo');
    return e.odoo_company_id;
  }
  // Cliente compartido: la empresa del contacto en Odoo o, si no tiene, la primera permitida al usuario de la API
  if (!odoo.empresas) await odoo.autenticar();
  return m2oId(partner.company_id) ?? odoo.empresas[0];
}

// Un envío viejo (p. ej. uno con error que la sincronización reintenta) no debe pisar un cambio posterior del mismo registro
async function reemplazada(sql, fila) {
  const [r] = await sql(`select count(*)::int n from odoo_escrituras o join odoo_escrituras f on f.id = ${lit(fila.id)}
    where o.tipo = f.tipo and o.referencia_id = f.referencia_id and o.id <> f.id and o.created_at > f.created_at
      and o.estado in ('pendiente', 'procesando', 'hecha')`);
  if (r?.n > 0) throw new Error('Se omitió: hay un cambio más reciente de este registro');
}

async function leerPartner(odoo, id, cid = null) {
  const [p] = await odoo.leer('res.partner', 'read', [[id]], { fields: CAMPOS_PARTNER }, cid);
  return p ?? null;
}

export async function buscarEstado(odoo, nombre) {
  const estados = await odoo.leer('res.country.state', 'search_read', [[['country_id.code', '=', 'VE']]], { fields: ['name', 'country_id'] });
  const hallados = estados.filter((s) => normEstado(s.name) === normEstado(nombre));
  if (hallados.length !== 1) throw new Error(`Odoo: no se encontró el estado "${nombre}" de Venezuela`);
  return { id: hallados[0].id, nombre: hallados[0].name, pais: m2oId(hallados[0].country_id) };
}

// Campos de GUDS (validados en SQL) → valores de res.partner
async function valsDesde(odoo, campos, partner, { telefono = 'phone' } = {}) {
  const vals = {};
  if ('telefono' in campos) vals[telefono] = campos.telefono || false;
  if ('celular' in campos) vals.mobile = campos.celular || false;
  let estado = null;
  if ('calle' in campos) {
    if (!campos.calle || !campos.ciudad || !campos.estado) throw new Error('Dirección incompleta: calle, ciudad y estado son obligatorios');
    estado = await buscarEstado(odoo, campos.estado);
    vals.street = campos.calle;
    vals.street2 = campos.complemento || false;
    vals.city = campos.ciudad;
    vals.state_id = estado.id;
    if (!partner || m2oId(partner.country_id) !== estado.pais) vals.country_id = estado.pais;
  }
  return { vals, estado };
}

// Qué cambia realmente en Odoo (para el historial y la simulación)
function diferencias(partner, vals, estado) {
  const etiqueta = (k, v) => (k === 'state_id' && estado ? estado.nombre : k === 'country_id' ? 'Venezuela' : valorOdoo(v));
  return Object.entries(vals)
    .filter(([k, v]) => valorOdoo(partner?.[k]) !== valorOdoo(v))
    .map(([k, v]) => ({ campo: k, antes: partner ? (Array.isArray(partner[k]) ? partner[k][1] : valorOdoo(partner[k])) : null, despues: etiqueta(k, v) }));
}

// Lo que Odoo no dejó como se pidió (p. ej. si un módulo reformatea el teléfono): se informa, no se oculta
function noAplicados(despues, vals) {
  return Object.entries(vals).filter(([k, v]) => valorOdoo(despues?.[k]) !== valorOdoo(v)).map(([k]) => k);
}

const resumenPartner = (p) => p && ({
  id: p.id, nombre: p.name, calle: valorOdoo(p.street), complemento: valorOdoo(p.street2), ciudad: valorOdoo(p.city),
  estado: m2oNombre(p.state_id), pais: m2oNombre(p.country_id), telefono: valorOdoo(p.phone), celular: valorOdoo(p.mobile),
});

// ── Contacto del cliente ───────────────────────────────────────────────────
async function escribirContacto({ odoo, sql, fila, aplicar, log, quien }) {
  const campos = fila.datos?.campos || {};
  await reemplazada(sql, fila);
  const [c] = await sql(`select id, odoo_id, empresa_id, nombre_negocio from clientes where id = ${lit(fila.referencia_id)}`);
  if (!c) throw new Error('Cliente no encontrado en GUDS');
  if (!c.odoo_id) throw new Error(`El cliente ${c.nombre_negocio} no está vinculado a Odoo`);
  const antes = await leerPartner(odoo, c.odoo_id);
  if (!antes) throw new Error(`El contacto ${c.odoo_id} ya no existe en Odoo`);
  const cid = await empresaOdoo(sql, odoo, c.empresa_id, antes);
  const { vals, estado } = await valsDesde(odoo, campos, antes);
  if (!Object.keys(vals).length) throw new Error('No hay datos para enviar a Odoo');
  // Odoo copia la dirección del contacto a sus personas de contacto (hijos type 'contact'), como en su propio formulario
  let contactosHijos = 0;
  if (CAMPOS_DIRECCION.some((k) => k in vals)) {
    const hijos = await odoo.leer('res.partner', 'search_read', [[['parent_id', '=', c.odoo_id], ['type', '=', 'contact']]],
      { fields: CAMPOS_DIRECCION }, cid);
    contactosHijos = hijos.filter((h) => CAMPOS_DIRECCION.some((k) => k in vals && valorOdoo(h[k]) !== valorOdoo(vals[k]))).length;
  }
  const plan = { partner: c.odoo_id, empresa_odoo: cid, vals, cambios: diferencias(antes, vals, estado), contactos_hijos: contactosHijos, antes: resumenPartner(antes) };
  const nota = { modelo: 'res.partner', id: c.odoo_id,
    texto: `(GUDS) Teléfonos / dirección actualizados desde GUDS por ${quien} el ${fechaCaracas()}: ${cambiosTexto(conEtiquetas(plan.cambios)) || 'sin diferencias con Odoo'}.` };
  if (!aplicar) return { modo: 'simulacion', ...plan, nota: { ...nota, simulada: true } };

  await odoo.escribir('res.partner', [c.odoo_id], vals, cid);
  const despues = await leerPartner(odoo, c.odoo_id, cid);
  await sql(`update clientes set telefono = ${lit(txt(despues.phone))}, celular = ${lit(txt(despues.mobile))},
      direccion = ${lit(direccionGuds(despues))}, calle = ${lit(txt(despues.street))}, complemento = ${lit(txt(despues.street2))},
      ciudad = ${lit(txt(despues.city, 100))}, estado = ${lit(m2oNombre(despues.state_id))}, updated_at = now()
    where id = ${lit(c.id)}`);
  const notaHecha = await dejarNota(odoo, nota, cid, true);
  log(`cliente ${c.nombre_negocio} (Odoo ${c.odoo_id}): ${Object.keys(vals).join(', ')}`);
  return { modo: 'aplicada', ...plan, despues: resumenPartner(despues), no_aplicados: noAplicados(despues, vals), nota: notaHecha };
}

// ── Direcciones de entrega ─────────────────────────────────────────────────
async function editarDireccion({ odoo, sql, fila, aplicar, log, quien }) {
  const campos = fila.datos?.campos || {};
  await reemplazada(sql, fila);
  const [d] = await sql(`select d.id, d.odoo_id, d.nombre, c.id cliente_id, c.odoo_id cliente_odoo_id, c.empresa_id
    from cliente_direcciones d join clientes c on c.id = d.cliente_id where d.id = ${lit(fila.referencia_id)}`);
  if (!d) throw new Error('Dirección no encontrada en GUDS');
  if (!d.odoo_id || !d.cliente_odoo_id) throw new Error('La dirección o su cliente no están vinculados a Odoo');
  const antes = await leerPartner(odoo, d.odoo_id);
  if (!antes) throw new Error(`La dirección ${d.odoo_id} ya no existe en Odoo`);
  if (m2oId(antes.parent_id) !== d.cliente_odoo_id || !['delivery', 'other'].includes(antes.type)) {
    throw new Error(`En Odoo, la dirección ${d.odoo_id} ya no es una dirección de entrega de este cliente`);
  }
  const cid = await empresaOdoo(sql, odoo, d.empresa_id, antes);
  const { vals, estado } = await valsDesde(odoo, campos, antes);
  if (!Object.keys(vals).length) throw new Error('No hay datos para enviar a Odoo');
  const plan = { accion: 'editar', partner: d.odoo_id, empresa_odoo: cid, vals, cambios: diferencias(antes, vals, estado), antes: resumenPartner(antes) };
  const nota = { modelo: 'res.partner', id: d.cliente_odoo_id,
    texto: `(GUDS) Dirección de entrega "${d.nombre ?? d.odoo_id}" actualizada desde GUDS por ${quien} el ${fechaCaracas()}: ${cambiosTexto(conEtiquetas(plan.cambios)) || 'sin diferencias con Odoo'}.` };
  if (!aplicar) return { modo: 'simulacion', ...plan, nota: { ...nota, simulada: true } };

  await odoo.escribir('res.partner', [d.odoo_id], vals, cid);
  const despues = await leerPartner(odoo, d.odoo_id, cid);
  await sql(`update cliente_direcciones set direccion = ${lit(direccionGuds(despues))}, calle = ${lit(txt(despues.street))},
      complemento = ${lit(txt(despues.street2))}, ciudad = ${lit(txt(despues.city))},
      estado = ${lit(m2oNombre(despues.state_id))}, telefono = ${lit(txt(despues.phone) || txt(despues.mobile))}, updated_at = now()
    where id = ${lit(d.id)}`);
  const notaHecha = await dejarNota(odoo, nota, cid, true);
  log(`dirección ${d.nombre ?? d.odoo_id} (Odoo ${d.odoo_id}): ${Object.keys(vals).join(', ')}`);
  return { modo: 'aplicada', ...plan, despues: resumenPartner(despues), no_aplicados: noAplicados(despues, vals), nota: notaHecha };
}

async function crearDireccion({ odoo, sql, fila, aplicar, log, quien }) {
  const campos = fila.datos?.campos || {};
  if (!txt(campos.nombre)) throw new Error('La dirección nueva necesita un nombre');
  const [c] = await sql(`select id, odoo_id, empresa_id, nombre_negocio from clientes where id = ${lit(fila.referencia_id)}`);
  if (!c) throw new Error('Cliente no encontrado en GUDS');
  if (!c.odoo_id) throw new Error(`El cliente ${c.nombre_negocio} no está vinculado a Odoo`);
  const padre = await leerPartner(odoo, c.odoo_id);
  if (!padre) throw new Error(`El contacto ${c.odoo_id} ya no existe en Odoo`);
  const cid = await empresaOdoo(sql, odoo, c.empresa_id, padre);
  const { vals: dir } = await valsDesde(odoo, campos, null);
  const vals = { parent_id: c.odoo_id, type: 'delivery', name: txt(campos.nombre), ...dir };
  if (m2oId(padre.company_id)) vals.company_id = m2oId(padre.company_id);

  // No duplicar: un reintento después de crearla (quedó anotada en la fila) o una dirección igual ya existente en Odoo
  const [previa] = await sql(`select (resultado ->> 'odoo_id_creado')::int id from odoo_escrituras where id = ${lit(fila.id)}`);
  const iguales = await odoo.leer('res.partner', 'search_read', [[['parent_id', '=', c.odoo_id], ['type', '=', 'delivery'],
    ['name', '=', vals.name], ['street', '=', vals.street]]], { fields: ['id'], limit: 1 }, cid);
  const existente = previa?.id || iguales[0]?.id || null;
  const plan = { accion: 'crear', padre: c.odoo_id, empresa_odoo: cid, vals, existente };
  const nota = { modelo: 'res.partner', id: c.odoo_id,
    texto: `(GUDS) Dirección de entrega "${vals.name}" ${existente ? 'enlazada' : 'agregada'} desde GUDS por ${quien} el ${fechaCaracas()}: ${[vals.street, vals.street2, vals.city].filter(Boolean).join(', ')}.` };
  if (!aplicar) return { modo: 'simulacion', ...plan, nota: { ...nota, simulada: true } };

  let nuevoId = existente;
  if (!nuevoId) {
    nuevoId = await odoo.crear('res.partner', vals, cid);
    if (!Number.isInteger(nuevoId)) throw new Error('Odoo no devolvió el id de la dirección creada');
    // Se anota de inmediato: si algo falla después, el reintento no crea otra
    await sql(`update odoo_escrituras set resultado = jsonb_build_object('odoo_id_creado', ${nuevoId}) where id = ${lit(fila.id)}`);
  }
  const p = await leerPartner(odoo, nuevoId, cid);
  if (!p) throw new Error(`Odoo no devuelve la dirección ${nuevoId}`);
  const [g] = await sql(`
    insert into cliente_direcciones (odoo_id, cliente_id, empresa_id, nombre, direccion, calle, complemento, ciudad, estado, telefono, activo, odoo_sync_at)
    values (${p.id}, ${lit(c.id)}, ${lit(c.empresa_id)}, ${lit(txt(p.name))}, ${lit(direccionGuds(p))}, ${lit(txt(p.street))}, ${lit(txt(p.street2))}, ${lit(txt(p.city))},
      ${lit(m2oNombre(p.state_id))}, ${lit(txt(p.phone) || txt(p.mobile))}, ${p.active ? 'true' : 'false'}, now())
    on conflict (odoo_id) do update set nombre = excluded.nombre, direccion = excluded.direccion, calle = excluded.calle,
      complemento = excluded.complemento, ciudad = excluded.ciudad,
      estado = excluded.estado, telefono = excluded.telefono, activo = excluded.activo, updated_at = now()
    returning id`);
  const notaHecha = await dejarNota(odoo, nota, cid, true);
  log(`dirección nueva "${vals.name}" de ${c.nombre_negocio}: Odoo ${p.id}${existente ? ' (ya existía)' : ''}`);
  return { modo: 'aplicada', ...plan, odoo_id_creado: p.id, direccion_id: g?.id ?? null, ya_existia: !!existente, despues: resumenPartner(p), nota: notaHecha };
}

export async function escribirCliente({ odoo, sql, fila, aplicar, log = () => {}, quien = 'GUDS' }) {
  if (fila.tipo === 'cliente_contacto') return escribirContacto({ odoo, sql, fila, aplicar, log, quien });
  if (fila.tipo === 'cliente_direccion') {
    return fila.datos?.accion === 'crear'
      ? crearDireccion({ odoo, sql, fila, aplicar, log, quien })
      : editarDireccion({ odoo, sql, fila, aplicar, log, quien });
  }
  throw new Error(`escribirCliente: tipo ${fila.tipo} no soportado`);
}
