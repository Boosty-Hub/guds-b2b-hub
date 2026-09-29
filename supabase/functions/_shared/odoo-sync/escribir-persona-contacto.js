// Personas de contacto de un cliente creadas o editadas en GUDS → Odoo (Fase 9b, flanco 29; migración 20s).
// En Odoo son contactos hijos del cliente: res.partner con parent_id = cliente y type 'contact', marcados "(GUDS)" en las notas.
//   · crear: si el contacto de GUDS aún no tiene odoo_id. Antes se busca entre los contactos hijos del cliente en Odoo uno con el
//     mismo nombre o el mismo correo (y que ningún otro contacto de GUDS use): si existe se enlaza en vez de crear otro.
//     Como en el formulario de Odoo, el contacto hijo lleva la dirección del cliente (Odoo exige calle, ciudad, estado y país).
//   · editar: nombre, cargo, correo, teléfono y celular. Nombre, cargo y correo solo se escriben en contactos que creó GUDS
//     (odoo.js lo comprueba en Odoo); en los demás solo los teléfonos.
// Desactivar o borrar un contacto en GUDS NO se envía a Odoo (nada de archivar ni borrar). Los contactos de un cliente que aún
// no está en Odoo esperan: public.aplicar_vinculo_cliente_odoo() los encola cuando el cliente queda vinculado.
// aplicar = false (modo "simular"): lee Odoo y devuelve el plan (con la nota); no escribe en Odoo ni en GUDS.
import { m2oId } from './odoo.js';
import { txt, norm, fechaCaracas } from './util.js';
import { validarAlta } from './validar-odoo.js';
import { dejarNota, cambiosTexto } from './notas.js';

const lit = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const valorOdoo = (v) => (v === false || v === '' || v === undefined ? null : v);
const CAMPOS_PADRE = ['name', 'type', 'parent_id', 'company_id', 'street', 'street2', 'city', 'zip', 'state_id', 'country_id', 'partner_type', 'lang', 'tz', 'active'];
const CAMPOS_HIJO = ['name', 'function', 'email', 'phone', 'mobile', 'parent_id', 'type', 'comment', 'active'];
const ETIQUETA = { name: 'Nombre', function: 'Cargo', email: 'Correo', phone: 'Teléfono', mobile: 'Celular' };
const SOLO_GUDS = new Set(['name', 'function', 'email']);

export async function escribirPersonaContacto({ odoo, sql, fila, aplicar, log = () => {}, quien = 'GUDS' }) {
  const [k] = await sql(`select k.id, k.nombre, k.cargo, k.email, k.telefono, k.celular, k.activo, k.odoo_id, c.id cliente_id,
      c.odoo_id cliente_odoo_id, c.nombre_negocio, e.odoo_company_id
    from cliente_contactos k join clientes c on c.id = k.cliente_id left join empresas e on e.id = c.empresa_id
    where k.id = ${lit(fila.referencia_id)}`);
  if (!k) throw new Error('El contacto ya no existe en GUDS');
  if (!k.cliente_odoo_id) return { omitida: 'El cliente aún no está en Odoo: el contacto se envía cuando quede vinculado' };
  // Un envío viejo no hace falta si hay uno más reciente del mismo contacto (ese envía el estado actual)
  const [nuevo] = await sql(`select count(*)::int n from odoo_escrituras o join odoo_escrituras f on f.id = ${lit(fila.id)}
    where o.tipo = 'persona_contacto' and o.referencia_id = f.referencia_id and o.id <> f.id and o.created_at > f.created_at
      and o.estado in ('pendiente', 'procesando', 'hecha')`);
  if (nuevo?.n > 0) return { omitida: 'Hay un envío más reciente de este contacto' };

  if (!odoo.empresas) await odoo.autenticar();
  const [padre] = await odoo.leer('res.partner', 'read', [[k.cliente_odoo_id]], { fields: CAMPOS_PADRE });
  if (!padre) throw new Error(`El cliente ${k.nombre_negocio} (Odoo ${k.cliente_odoo_id}) ya no existe en Odoo`);
  const cid = k.odoo_company_id || m2oId(padre.company_id) || odoo.empresas[0];
  const datos = { name: txt(k.nombre, 200), function: txt(k.cargo) || false, email: txt(k.email) || false, phone: txt(k.telefono) || false, mobile: txt(k.celular) || false };
  if (!datos.name) throw new Error('El contacto no tiene nombre');

  // ── Crear (o enlazar uno igual) ──
  if (!k.odoo_id) {
    if (!k.activo) return { omitida: 'El contacto está desactivado en GUDS: no se crea en Odoo' };
    const [previa] = await sql(`select (resultado ->> 'odoo_id_creado')::int id from odoo_escrituras where id = ${lit(fila.id)}`);
    const hijos = await odoo.leer('res.partner', 'search_read', [[['parent_id', '=', k.cliente_odoo_id], ['type', '=', 'contact']]], { fields: CAMPOS_HIJO }, cid);
    const usados = new Set(hijos.length
      ? (await sql(`select odoo_id from cliente_contactos where odoo_id in (${hijos.map((h) => h.id).join(',')}) and id <> ${lit(k.id)}`)).map((x) => x.odoo_id)
      : []);
    const igual = hijos.find((h) => !usados.has(h.id) && (norm(h.name) === norm(k.nombre)
      || (datos.email && h.email && String(h.email).trim().toLowerCase() === datos.email.toLowerCase())));
    const existente = previa?.id || igual?.id || null;
    const vals = {
      parent_id: k.cliente_odoo_id, type: 'contact', ...datos,
      street: padre.street || false, street2: padre.street2 || false, city: padre.city || false, zip: padre.zip || false,
      state_id: m2oId(padre.state_id) || false, country_id: m2oId(padre.country_id) || false,
      lang: padre.lang || 'es_VE', tz: padre.tz || 'America/Caracas',
      comment: `<p>${esc(`(GUDS) Persona de contacto creada desde la plataforma GUDS por ${quien} el ${fechaCaracas()}.`)}</p>`,
    };
    if (m2oId(padre.company_id)) vals.company_id = m2oId(padre.company_id);
    if (padre.partner_type) vals.partner_type = padre.partner_type;
    const nota = { modelo: 'res.partner', id: k.cliente_odoo_id,
      texto: `(GUDS) Contacto ${datos.name}${datos.function ? ` (${datos.function})` : ''} ${existente ? 'enlazado' : 'agregado'} desde GUDS por ${quien} el ${fechaCaracas()}.` };
    const validacion = existente ? null : await validarAlta(odoo, 'res.partner', vals, cid);
    const plan = { accion: existente ? 'enlazar' : 'crear', contacto: datos.name, cliente: k.nombre_negocio, padre: k.cliente_odoo_id, empresa_odoo: cid,
      existente, vals: existente ? undefined : vals, validacion };
    if (!aplicar) return { modo: 'simulacion', ...plan, nota: { ...nota, simulada: true } };

    let nuevoId = existente;
    if (!nuevoId) {
      nuevoId = await odoo.crear('res.partner', vals, cid);
      if (!Number.isInteger(nuevoId)) throw new Error('Odoo no devolvió el id del contacto creado');
      await sql(`update odoo_escrituras set resultado = jsonb_build_object('odoo_id_creado', ${nuevoId}) where id = ${lit(fila.id)}`);
    }
    const [ligado] = await sql(`update cliente_contactos set odoo_id = ${nuevoId}, updated_at = now()
      where id = ${lit(k.id)} and odoo_id is null returning id`);
    if (!ligado) throw new Error('El contacto ya quedó ligado a otro registro de Odoo mientras se procesaba');
    const notaHecha = await dejarNota(odoo, nota, cid, true);
    log(`contacto ${datos.name} de ${k.nombre_negocio}: Odoo ${nuevoId}${existente ? ' (ya existía)' : ''}`);
    return { modo: 'aplicada', ...plan, odoo_id: nuevoId, odoo_id_creado: existente ? undefined : nuevoId, nota: notaHecha };
  }

  // ── Editar ──
  const [hijo] = await odoo.leer('res.partner', 'read', [[k.odoo_id]], { fields: CAMPOS_HIJO }, cid);
  if (!hijo) throw new Error(`El contacto ${k.odoo_id} ya no existe en Odoo`);
  if (m2oId(hijo.parent_id) !== k.cliente_odoo_id) throw new Error(`En Odoo, el contacto ${k.odoo_id} ya no pertenece a ${k.nombre_negocio}`);
  const deGuds = /^(<p>)?\(GUDS\)/.test(String(hijo.comment || '').trim()) && hijo.type === 'contact';
  const avisos = [];
  const vals = {};
  const cambios = [];
  for (const [campo, valor] of Object.entries(datos)) {
    if (valorOdoo(hijo[campo]) === valorOdoo(valor)) continue;
    if (SOLO_GUDS.has(campo) && !deGuds) { avisos.push(`${ETIQUETA[campo]}: el contacto no lo creó GUDS, se edita en Odoo`); continue; }
    vals[campo] = valor;
    cambios.push({ campo, etiqueta: ETIQUETA[campo], antes: valorOdoo(hijo[campo]), despues: valorOdoo(valor) });
  }
  if (!cambios.length) return { modo: aplicar ? 'aplicada' : 'simulacion', accion: 'editar', sin_cambios: true, avisos, motivo: 'Odoo ya tiene estos datos' };
  const nota = { modelo: 'res.partner', id: k.odoo_id, texto: `(GUDS) Datos del contacto actualizados desde GUDS por ${quien} el ${fechaCaracas()}: ${cambiosTexto(cambios)}.` };
  const plan = { accion: 'editar', contacto: datos.name, partner: k.odoo_id, empresa_odoo: cid, vals, cambios, avisos };
  if (!aplicar) return { modo: 'simulacion', ...plan, nota: { ...nota, simulada: true } };
  await odoo.escribir('res.partner', [k.odoo_id], vals, cid);
  const notaHecha = await dejarNota(odoo, nota, cid, true);
  log(`contacto ${datos.name} (Odoo ${k.odoo_id}): ${Object.keys(vals).join(', ')}`);
  return { modo: 'aplicada', ...plan, nota: notaHecha };
}
