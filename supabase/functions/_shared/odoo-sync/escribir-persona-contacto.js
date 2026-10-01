// Personas de contacto creadas o editadas en GUDS → Odoo (Fase 9b, flanco 29; migraciones 20s y 20v).
// En Odoo son contactos hijos de su cliente o proveedor: res.partner con parent_id = la empresa y type 'contact', marcados
// "(GUDS)" en las notas. Un contacto suelto (sin cliente ni proveedor) vive solo en GUDS y no se envía.
//   · crear: si el contacto de GUDS aún no tiene odoo_id. Antes se busca entre los contactos hijos de su empresa en Odoo uno
//     con el mismo nombre o el mismo correo (y que ningún otro contacto de GUDS use): si existe se enlaza en vez de crear otro.
//     Como en el formulario de Odoo, el contacto hijo lleva la dirección de su empresa (Odoo exige calle, ciudad, estado y país).
//   · editar: nombre, cargo, correo, teléfono y celular. Nombre, cargo y correo solo se escriben en contactos que creó GUDS
//     (odoo.js lo comprueba en Odoo); en los demás solo los teléfonos.
//   · desligar (20v): el contacto cambió de cliente o proveedor en GUDS (o quedó suelto). En Odoo NO se mueve, archiva ni borra:
//     solo se deja una nota "(GUDS)" en el contacto de Odoo. Si su nueva empresa está en Odoo, otro envío lo crea allí.
// Desactivar o borrar un contacto en GUDS NO se envía a Odoo. Los contactos de un cliente o proveedor que aún no está en Odoo
// esperan: public.aplicar_vinculo_cliente_odoo() encola los de un cliente cuando queda vinculado.
// Los contactos que vinieron de Odoo (origen 'odoo') no se envían: se editan en Odoo.
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

// Datos del contacto tal como van a Odoo
export const datosContactoOdoo = (k) => ({
  name: txt(k.nombre, 200), function: txt(k.cargo) || false, email: txt(k.email) || false, phone: txt(k.telefono) || false, mobile: txt(k.celular) || false,
});

// Valores del res.partner hijo que se crea (con la dirección de su empresa, como hace el formulario de Odoo)
export function valsContactoHijo(k, padre, padreOdooId, quien, fecha = fechaCaracas()) {
  const vals = {
    parent_id: padreOdooId, type: 'contact', ...datosContactoOdoo(k),
    street: padre.street || false, street2: padre.street2 || false, city: padre.city || false, zip: padre.zip || false,
    state_id: m2oId(padre.state_id) || false, country_id: m2oId(padre.country_id) || false,
    lang: padre.lang || 'es_VE', tz: padre.tz || 'America/Caracas',
    comment: `<p>${esc(`(GUDS) Persona de contacto creada desde la plataforma GUDS por ${quien} el ${fecha}.`)}</p>`,
  };
  if (m2oId(padre.company_id)) vals.company_id = m2oId(padre.company_id);
  if (padre.partner_type) vals.partner_type = padre.partner_type;
  return vals;
}

// Nota en Odoo cuando un contacto de GUDS deja de pertenecer (en GUDS) a la empresa con la que se creó en Odoo
async function desligar({ odoo, sql, fila, aplicar, log, quien }) {
  const d = fila.datos || {};
  const odooId = Number(d.odoo_id_anterior);
  if (!Number.isInteger(odooId) || odooId <= 0) return { omitida: 'Sin contacto de Odoo anterior' };
  if (!odoo.empresas) await odoo.autenticar();
  const [emp] = await sql(`select e.odoo_company_id from empresas e where e.id = ${lit(fila.empresa_id)}`);
  const cid = emp?.odoo_company_id || odoo.empresas[0];
  const [hijo] = await odoo.leer('res.partner', 'read', [[odooId]], { fields: ['name', 'parent_id', 'type'] }, cid);
  if (!hijo) return { omitida: `El contacto ${odooId} ya no existe en Odoo` };
  const empresa = Array.isArray(hijo.parent_id) ? hijo.parent_id[1] : null;
  const destino = d.destino ? `ahora es contacto de ${d.destino}` : 'quedó sin cliente ni proveedor';
  const nota = { modelo: 'res.partner', id: odooId,
    texto: `(GUDS) En GUDS, ${hijo.name || d.nombre || 'este contacto'} ya no figura como contacto${empresa ? ` de ${empresa}` : ''}: ${destino} `
      + `(cambio de ${quien} el ${fechaCaracas()}). En Odoo no se cambia ni se archiva.` };
  if (!aplicar) return { modo: 'simulacion', accion: 'desligar', partner: odooId, nota: { ...nota, simulada: true } };
  const notaHecha = await dejarNota(odoo, nota, cid, true);
  log(`contacto ${hijo.name} (Odoo ${odooId}): nota de cambio de empresa en GUDS`);
  return { modo: 'aplicada', accion: 'desligar', partner: odooId, nota: notaHecha };
}

export async function escribirPersonaContacto({ odoo, sql, fila, aplicar, log = () => {}, quien = 'GUDS' }) {
  if (fila.datos?.accion === 'desligar') return desligar({ odoo, sql, fila, aplicar, log, quien });
  const [k] = await sql(`select k.id, k.nombre, k.cargo, k.email, k.telefono, k.celular, k.activo, k.odoo_id, k.origen,
      k.cliente_id, k.proveedor_id, coalesce(c.odoo_id, p.odoo_id) padre_odoo_id, coalesce(c.nombre_negocio, p.nombre) padre_nombre,
      coalesce(k.cliente_id, k.proveedor_id) padre_id, e.odoo_company_id
    from cliente_contactos k left join clientes c on c.id = k.cliente_id left join proveedores p on p.id = k.proveedor_id
      left join empresas e on e.id = coalesce(c.empresa_id, p.empresa_id, k.empresa_id)
    where k.id = ${lit(fila.referencia_id)}`);
  if (!k) throw new Error('El contacto ya no existe en GUDS');
  if (k.origen === 'odoo') return { omitida: 'El contacto viene de Odoo: se edita en Odoo' };
  if (!k.padre_id) return { omitida: 'El contacto no pertenece a un cliente ni a un proveedor: vive solo en GUDS' };
  if (!k.padre_odoo_id) return { omitida: 'Su cliente o proveedor aún no está en Odoo: el contacto se envía cuando quede vinculado' };
  // Un envío viejo no hace falta si hay uno más reciente del mismo contacto (ese envía el estado actual)
  const [nuevo] = await sql(`select count(*)::int n from odoo_escrituras o join odoo_escrituras f on f.id = ${lit(fila.id)}
    where o.tipo = 'persona_contacto' and o.referencia_id = f.referencia_id and o.id <> f.id and o.created_at > f.created_at
      and o.estado in ('pendiente', 'procesando', 'hecha') and coalesce(o.datos ->> 'accion', '') <> 'desligar'`);
  if (nuevo?.n > 0) return { omitida: 'Hay un envío más reciente de este contacto' };

  if (!odoo.empresas) await odoo.autenticar();
  const [padre] = await odoo.leer('res.partner', 'read', [[k.padre_odoo_id]], { fields: CAMPOS_PADRE });
  if (!padre) throw new Error(`${k.padre_nombre} (Odoo ${k.padre_odoo_id}) ya no existe en Odoo`);
  const cid = k.odoo_company_id || m2oId(padre.company_id) || odoo.empresas[0];
  const datos = datosContactoOdoo(k);
  if (!datos.name) throw new Error('El contacto no tiene nombre');

  // ── Crear (o enlazar uno igual) ──
  if (!k.odoo_id) {
    if (!k.activo) return { omitida: 'El contacto está desactivado en GUDS: no se crea en Odoo' };
    const [previa] = await sql(`select (resultado ->> 'odoo_id_creado')::int id from odoo_escrituras where id = ${lit(fila.id)}`);
    const hijos = await odoo.leer('res.partner', 'search_read', [[['parent_id', '=', k.padre_odoo_id], ['type', '=', 'contact']]], { fields: CAMPOS_HIJO }, cid);
    const usados = new Set(hijos.length
      ? (await sql(`select odoo_id from cliente_contactos where odoo_id in (${hijos.map((h) => h.id).join(',')}) and id <> ${lit(k.id)}`)).map((x) => x.odoo_id)
      : []);
    const igual = hijos.find((h) => !usados.has(h.id) && (norm(h.name) === norm(k.nombre)
      || (datos.email && h.email && String(h.email).trim().toLowerCase() === datos.email.toLowerCase())));
    const existente = previa?.id || igual?.id || null;
    const vals = valsContactoHijo(k, padre, k.padre_odoo_id, quien);
    const nota = { modelo: 'res.partner', id: k.padre_odoo_id,
      texto: `(GUDS) Contacto ${datos.name}${datos.function ? ` (${datos.function})` : ''} ${existente ? 'enlazado' : 'agregado'} desde GUDS por ${quien} el ${fechaCaracas()}.` };
    const validacion = existente ? null : await validarAlta(odoo, 'res.partner', vals, cid);
    const plan = { accion: existente ? 'enlazar' : 'crear', contacto: datos.name, empresa: k.padre_nombre, tipo_empresa: k.cliente_id ? 'cliente' : 'proveedor',
      padre: k.padre_odoo_id, empresa_odoo: cid, existente, vals: existente ? undefined : vals, validacion };
    if (!aplicar) return { modo: 'simulacion', ...plan, nota: { ...nota, simulada: true } };

    let nuevoId = existente;
    if (!nuevoId) {
      nuevoId = await odoo.crear('res.partner', vals, cid);
      if (!Number.isInteger(nuevoId)) throw new Error('Odoo no devolvió el id del contacto creado');
      await sql(`update odoo_escrituras set resultado = jsonb_build_object('odoo_id_creado', ${nuevoId}) where id = ${lit(fila.id)}`);
    }
    const [ligado] = await sql(`update cliente_contactos set odoo_id = ${nuevoId}, odoo_padre_id = ${k.padre_odoo_id}, updated_at = now()
      where id = ${lit(k.id)} and odoo_id is null and coalesce(cliente_id, proveedor_id) = ${lit(k.padre_id)} returning id`);
    if (!ligado) throw new Error('El contacto cambió de cliente o proveedor (o ya quedó ligado a otro registro de Odoo) mientras se procesaba');
    const notaHecha = await dejarNota(odoo, nota, cid, true);
    log(`contacto ${datos.name} de ${k.padre_nombre}: Odoo ${nuevoId}${existente ? ' (ya existía)' : ''}`);
    return { modo: 'aplicada', ...plan, odoo_id: nuevoId, odoo_id_creado: existente ? undefined : nuevoId, nota: notaHecha };
  }

  // ── Editar ──
  const [hijo] = await odoo.leer('res.partner', 'read', [[k.odoo_id]], { fields: CAMPOS_HIJO }, cid);
  if (!hijo) throw new Error(`El contacto ${k.odoo_id} ya no existe en Odoo`);
  if (m2oId(hijo.parent_id) !== k.padre_odoo_id) throw new Error(`En Odoo, el contacto ${k.odoo_id} ya no pertenece a ${k.padre_nombre}`);
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
