// Cliente creado en GUDS → Odoo (Fase 9b, flanco 47; decisión 3 del 27-sep y B del 29-sep). Lo encola la aprobación de un
// registro (aprobar_registro_cliente) o el alta manual de un cliente en el admin (migración 20s): el cliente se crea en Odoo
// automáticamente, SIN DUPLICAR por RIF ni por nombre: si ya existe en Odoo, se enlaza.
//
// Búsqueda en Odoo (solo lectura): contactos comerciales (sin padre) de la compañía del cliente o compartidos, activos o
// archivados, comparando el RIF (vat, rif o cedula) y el nombre normalizados (J-12345678-9 = J123456789 = J-12345678;
// "FARMACIA X, C.A." = "Farmacia X CA"):
//   · un único RIF igual, activo y libre → se ENLAZA (clientes.odoo_id); en Odoo solo se deja la nota "(GUDS)".
//   · sin RIF igual y un único nombre igual, activo, libre y sin RIF en Odoo → se enlaza.
//   · varias coincidencias, una archivada, una ya ligada a otro cliente de GUDS o un nombre igual con otro RIF → NO se crea:
//     el cliente queda en "varias coincidencias" con los candidatos para que administración elija en la ficha del cliente
//     (elegir_cliente_odoo); "crear uno nuevo" solo se permite si ningún candidato tiene su RIF.
//   · ninguna → se CREA el res.partner (compañía, nombre, RIF, correo, teléfonos, dirección de Venezuela, vendedor mapeado por
//     nombre como en importar.js, lista de precios USD de la empresa, marca "(GUDS)" en las notas) validado antes contra
//     fields_get/default_get de Odoo (validar-odoo.js).
// aplicar = false (modo "simular"): solo lee Odoo y devuelve el plan con el texto de la nota; no toca Odoo ni GUDS.
// Al crear o enlazar, public.aplicar_vinculo_cliente_odoo() liga el cliente, reenvía sus pedidos aprobados que esperaban y
// encola sus contactos y su límite de crédito. La sincronización lo actualiza por odoo_id (la fila no se duplica).
// Solo usa `leer`, `crear` (cliente nuevo marcado) y `nota` de odoo.js: nunca borra ni modifica un contacto existente.
import { m2oId, m2oNombre, RE_MARCA_GUDS } from './odoo.js';
import { txt, norm, claveRif, normNombreEmpresa, formatoRifOdoo, fechaCaracas } from './util.js';
import { buscarEstado } from './escribir-cliente.js';
import { validarAlta } from './validar-odoo.js';
import { dejarNota } from './notas.js';

const lit = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const CAMPOS_BUSQUEDA = ['name', 'vat', 'rif', 'cedula', 'company_id', 'active', 'customer_rank', 'supplier_rank', 'city'];
const EMPRESA_LETRAS = new Set(['J', 'G', 'C']);

// ── Decisión (pura, sin Odoo: se prueba en scripts/probar-multiempresa.mjs) ─────────────────────────────
// partners: contactos comerciales de Odoo (id, name, vat, rif, cedula, company_id, active, customer_rank, supplier_rank).
// ligados: Map odoo_id → { id, nombre } de clientes de GUDS que ya usan ese contacto.
export function decidirVinculo({ rif, nombre }, partners, ligados = new Map()) {
  const clave = claveRif(rif);
  const nom = normNombreEmpresa(nombre);
  const candidatos = [];
  for (const p of partners) {
    const rifOdoo = txt(p.vat) || txt(p.rif) || txt(p.cedula);
    const porRif = !!clave && [p.vat, p.rif, p.cedula].some((v) => v && claveRif(v) === clave);
    const porNombre = !!nom && normNombreEmpresa(p.name) === nom;
    if (!porRif && !porNombre) continue;
    candidatos.push({
      id: p.id, nombre: txt(p.name), rif: rifOdoo, compania: m2oNombre(p.company_id), compartido: !m2oId(p.company_id),
      activo: p.active !== false, cliente: (p.customer_rank || 0) > 0, proveedor: (p.supplier_rank || 0) > 0, ciudad: txt(p.city),
      coincide: porRif ? (porNombre ? 'rif_y_nombre' : 'rif') : 'nombre',
      rif_distinto: !porRif && !!rifOdoo && claveRif(rifOdoo) !== clave,
      ligado_a: ligados.get(p.id) ?? null,
    });
  }
  const porRif = candidatos.filter((c) => c.coincide !== 'nombre');
  if (porRif.length) {
    const [c] = porRif;
    if (porRif.length === 1 && c.activo && !c.ligado_a) return { accion: 'enlazar', partner: c, candidatos, motivo: 'Mismo RIF' };
    return {
      accion: 'revisar', candidatos, puede_crear: false,
      motivo: porRif.length > 1 ? `Hay ${porRif.length} contactos en Odoo con el mismo RIF`
        : c.ligado_a ? `El contacto de Odoo con ese RIF ya está ligado al cliente ${c.ligado_a.nombre} de GUDS`
          : 'El contacto de Odoo con ese RIF está archivado',
    };
  }
  if (candidatos.length) {
    const [c] = candidatos;
    if (candidatos.length === 1 && c.activo && !c.rif && !c.ligado_a) {
      return { accion: 'enlazar', partner: c, candidatos, motivo: 'Mismo nombre (el contacto de Odoo no tiene RIF)' };
    }
    return {
      accion: 'revisar', candidatos, puede_crear: true,
      motivo: candidatos.length > 1 ? `Hay ${candidatos.length} contactos en Odoo con el mismo nombre`
        : c.rif_distinto ? 'En Odoo hay un contacto con el mismo nombre y otro RIF'
          : c.ligado_a ? `El contacto de Odoo con ese nombre ya está ligado al cliente ${c.ligado_a.nombre} de GUDS`
            : 'El contacto de Odoo con ese nombre está archivado',
    };
  }
  return { accion: 'crear', candidatos: [] };
}

// ── Lecturas de Odoo ────────────────────────────────────────────────────
async function buscarCandidatos(odoo, sql, cid, c) {
  const partners = await odoo.leerTodo('res.partner', [['parent_id', '=', false], '|', ['company_id', '=', cid], ['company_id', '=', false]],
    CAMPOS_BUSQUEDA, { empresa: cid });
  const clave = claveRif(c.rif);
  const nom = normNombreEmpresa(c.nombre_negocio);
  const posibles = partners.filter((p) => (clave && [p.vat, p.rif, p.cedula].some((v) => v && claveRif(v) === clave))
    || (nom && normNombreEmpresa(p.name) === nom));
  const ids = posibles.map((p) => p.id);
  const ligados = new Map(ids.length
    ? (await sql(`select odoo_id, id, nombre_negocio from clientes where odoo_id in (${ids.join(',')}) and id <> ${lit(c.id)}`))
      .map((x) => [x.odoo_id, { id: x.id, nombre: x.nombre_negocio }])
    : []);
  return { decision: decidirVinculo({ rif: c.rif, nombre: c.nombre_negocio }, posibles, ligados), revisados: partners.length };
}

// Vendedor de Odoo (res.users interno de la compañía) con el mismo nombre que el vendedor asignado en GUDS (como importar.js)
async function vendedorOdoo(odoo, sql, vendedorId, cid) {
  if (!vendedorId) return { usuario: null, aviso: null };
  const [u] = await sql(`select nombre, apellido from usuarios where id = ${lit(vendedorId)}`);
  if (!u) return { usuario: null, aviso: null };
  const nombreGuds = [u.nombre, u.apellido].filter(Boolean).join(' ');
  const claves = new Set([norm(nombreGuds), norm(u.nombre)]);
  const usuarios = await odoo.leer('res.users', 'search_read', [[['share', '=', false], ['active', '=', true]]], { fields: ['name', 'company_ids'] }, cid);
  const hallados = usuarios.filter((x) => claves.has(norm(x.name)) && (x.company_ids || []).includes(cid));
  if (hallados.length === 1) return { usuario: { id: hallados[0].id, nombre: hallados[0].name }, aviso: null };
  return { usuario: null, aviso: hallados.length > 1 ? `Hay ${hallados.length} usuarios de Odoo llamados "${nombreGuds}": el cliente queda sin vendedor en Odoo`
    : `El vendedor ${nombreGuds} no tiene usuario en Odoo con ese nombre: el cliente queda sin vendedor en Odoo` };
}

async function listaUsd(odoo, cid) {
  const listas = await odoo.leer('product.pricelist', 'search_read', [['|', ['company_id', '=', cid], ['company_id', '=', false],
    ['currency_id.name', '=', 'USD'], ['active', '=', true]]], { fields: ['name', 'company_id', 'sequence'], order: 'sequence, id' }, cid);
  const propia = listas.find((l) => m2oId(l.company_id) === cid) ?? listas[0];
  if (!propia) throw new Error('No hay una lista de precios en USD activa para esta empresa en Odoo');
  return { id: propia.id, nombre: propia.name };
}

// ── Payload del cliente nuevo ───────────────────────────────────────────
async function armarAlta(odoo, sql, c, cid, quien) {
  const rif = formatoRifOdoo(c.rif);
  if (!rif) throw new Error(`El RIF "${c.rif ?? ''}" no es un RIF venezolano válido para Odoo (p. ej. J-12345678-9): corrígelo en la ficha del cliente y reintenta`);
  const calle = txt(c.calle) || txt(c.direccion);
  if (!calle) throw new Error('Falta la dirección (calle): Odoo la exige. Complétala en la ficha del cliente y reintenta');
  if (!txt(c.ciudad)) throw new Error('Falta la ciudad: Odoo la exige. Complétala en la ficha del cliente y reintenta');
  if (!txt(c.estado)) throw new Error('Falta el estado de la dirección: Odoo lo exige. Complétalo en la ficha del cliente y reintenta');
  const estado = await buscarEstado(odoo, c.estado);
  const lista = await listaUsd(odoo, cid);
  const { usuario, aviso: avisoVendedor } = await vendedorOdoo(odoo, sql, c.vendedor_asignado_id, cid);
  const esEmpresa = EMPRESA_LETRAS.has(rif.letra);
  const pd = await odoo.leer('res.partner', 'default_get', [['partner_type']], {}, cid);
  const origen = c.registro_origen_id ? `al aprobar el registro de ${txt(c.contacto) || 'su solicitante'}` : 'desde el admin';
  const comentario = [
    `(GUDS) Cliente creado desde la plataforma GUDS ${origen} (código GUDS ${c.codigo ?? '—'}), por ${quien} el ${fechaCaracas()}.`,
    c.contribuyente_especial ? 'Contribuyente especial según GUDS: asignar su posición fiscal en Odoo.' : null,
    rif.digito_calculado ? `El RIF se registró sin dígito verificador; GUDS lo calculó (${rif.vat}).` : null,
  ].filter(Boolean).join(' ');
  const vals = {
    company_id: cid,
    name: txt(c.nombre_negocio, 200),
    vat: rif.vat, rif: rif.vat, cedula: rif.cedula, has_cedula: true,
    email: txt(c.email) || false,
    phone: txt(c.telefono) || false,
    mobile: txt(c.celular) || false,
    street: calle, street2: txt(c.complemento) || false, city: txt(c.ciudad, 100),
    state_id: estado.id, country_id: estado.pais,
    is_company: esEmpresa,
    residence_type: esEmpresa ? 'D' : rif.letra === 'P' ? 'NR' : 'R',
    partner_type: pd?.partner_type || 'T',
    customer_rank: 1,
    // Sin vendedor en GUDS no se deja el de Odoo por defecto (sería el usuario de la API)
    user_id: usuario?.id ?? false,
    property_product_pricelist: lista.id,
    lang: 'es_VE', tz: 'America/Caracas',
    comment: `<p>${esc(comentario)}</p>`,
  };
  const avisos = [avisoVendedor, rif.digito_dudoso ? `El dígito verificador del RIF ${rif.vat} no coincide con el cálculo del SENIAT: revisarlo` : null].filter(Boolean);
  return { vals, resumen: { rif: rif.vat, estado: estado.nombre, lista: lista.nombre, vendedor: usuario?.nombre ?? null, es_empresa: esEmpresa }, avisos };
}

const textoNotaEnlace = (c, quien, motivo) => `(GUDS) Enlazado con el cliente ${c.codigo ?? ''} de la plataforma GUDS (${motivo.toLowerCase()})`
  + `${c.registro_origen_id ? `, al aprobar el registro de ${txt(c.contacto) || 'su solicitante'}; su acceso al portal de GUDS quedó ligado a este contacto` : ''}. `
  + `Por ${quien} el ${fechaCaracas()}. GUDS no modificó los datos de este contacto.`;

const textoNotaAlta = (c, quien) => `(GUDS) Cliente creado desde la plataforma GUDS (código GUDS ${c.codigo ?? '—'})`
  + `${c.registro_origen_id ? ` al aprobar el registro de ${txt(c.contacto) || 'su solicitante'}` : ''}, por ${quien} el ${fechaCaracas()}.`;

// ── Escritor ────────────────────────────────────────────────────────────
export async function escribirClienteNuevo({ odoo, sql, fila, aplicar, log = () => {}, quien = 'GUDS' }) {
  const [c] = await sql(`select c.id, c.codigo, c.nombre_negocio, c.rif, c.email, c.telefono, c.celular, c.direccion, c.calle, c.complemento,
      c.ciudad, c.estado, c.contribuyente_especial, c.vendedor_asignado_id, c.registro_origen_id, c.odoo_id, c.odoo_vinculo, c.empresa_id,
      e.odoo_company_id, e.nombre_corto, nullif(btrim(concat_ws(' ', r.nombre_contacto, r.apellido_contacto)), '') contacto
    from clientes c left join empresas e on e.id = c.empresa_id left join registros_clientes r on r.id = c.registro_origen_id
    where c.id = ${lit(fila.referencia_id)}`);
  if (!c) throw new Error('Cliente no encontrado en GUDS');
  if (c.odoo_id) return { accion: 'ya_vinculado', odoo_id: c.odoo_id, mensaje: 'El cliente ya está vinculado a Odoo: no se hizo nada' };
  if (!c.odoo_company_id) throw new Error('El cliente no tiene empresa ligada a Odoo (los clientes compartidos se crean en Odoo)');
  const cid = c.odoo_company_id;
  const elegido = fila.datos?.elegido ?? null;

  try {
    // Reintento después de haberlo creado (el id quedó anotado en la fila): solo falta ligarlo
    const [previa] = await sql(`select (resultado ->> 'odoo_id_creado')::int id from odoo_escrituras where id = ${lit(fila.id)}`);
    if (previa?.id && aplicar) {
      const detalle = await sql(`select public.aplicar_vinculo_cliente_odoo(${lit(c.id)}, ${previa.id}, 'creado', ${lit(JSON.stringify({ reintento: true }))}::jsonb) r`);
      log(`cliente ${c.nombre_negocio}: ligado a Odoo ${previa.id} (creado en un intento anterior)`);
      return { modo: 'aplicada', accion: 'crear', odoo_id: previa.id, vinculo: detalle[0]?.r ?? null, reintento: true };
    }

    const { decision, revisados } = await buscarCandidatos(odoo, sql, cid, c);
    let accion = decision.accion;
    let partner = decision.partner ?? null;
    let motivo = decision.motivo ?? null;
    const avisos = [];
    if (elegido !== null) {
      // Elección de administración entre las coincidencias (o "crear nuevo")
      if (elegido === 'crear') {
        if (decision.candidatos.some((x) => x.coincide !== 'nombre')) {
          throw new Error('En Odoo hay un contacto con el mismo RIF: no se crea otro; elige enlazarlo');
        }
        accion = 'crear';
        partner = null;
        motivo = 'Administración eligió crear un cliente nuevo';
      } else {
        const id = Number(elegido);
        partner = decision.candidatos.find((x) => x.id === id) ?? null;
        if (!partner) throw new Error(`El contacto ${id} de Odoo ya no coincide con este cliente (RIF o nombre): vuelve a revisar las coincidencias`);
        if (partner.ligado_a) throw new Error(`El contacto de Odoo ya está ligado al cliente ${partner.ligado_a.nombre} de GUDS`);
        if (!partner.activo) avisos.push('El contacto elegido está archivado en Odoo: en GUDS quedará inactivo hasta que lo desarchiven en Odoo');
        accion = 'enlazar';
        motivo = 'Elegido por administración';
      }
    }
    const base = { empresa: c.nombre_corto, empresa_odoo: cid, cliente: c.nombre_negocio, contactos_revisados: revisados, motivo };

    if (accion === 'revisar') {
      const resultado = { modo: aplicar ? 'aplicada' : 'simulacion', accion, ...base, candidatos: decision.candidatos, puede_crear: decision.puede_crear };
      if (aplicar) {
        await sql(`select public.registrar_revision_cliente_odoo(${lit(c.id)}, ${lit(JSON.stringify({ motivo, candidatos: decision.candidatos, puede_crear: decision.puede_crear }))}::jsonb)`);
      }
      log(`cliente ${c.nombre_negocio}: ${motivo} → queda para que administración elija`);
      return resultado;
    }

    if (accion === 'enlazar') {
      const nota = { modelo: 'res.partner', id: partner.id, texto: textoNotaEnlace(c, quien, motivo) };
      if (!aplicar) return { modo: 'simulacion', accion, ...base, partner, candidatos: decision.candidatos, avisos, nota: { ...nota, simulada: true } };
      const [v] = await sql(`select public.aplicar_vinculo_cliente_odoo(${lit(c.id)}, ${partner.id}, 'enlazado',
        ${lit(JSON.stringify({ motivo, partner: { id: partner.id, nombre: partner.nombre, rif: partner.rif, compania: partner.compania } }))}::jsonb) r`);
      const notaHecha = await dejarNota(odoo, nota, cid, true);
      log(`cliente ${c.nombre_negocio}: enlazado con Odoo ${partner.id} (${motivo})`);
      return { modo: 'aplicada', accion, ...base, partner, odoo_id: partner.id, vinculo: v?.r ?? null, avisos, nota: notaHecha };
    }

    // Crear
    const { vals, resumen, avisos: avisosAlta } = await armarAlta(odoo, sql, c, cid, quien);
    avisos.push(...avisosAlta);
    const validacion = await validarAlta(odoo, 'res.partner', vals, cid);
    const plan = { modo: aplicar ? 'aplicada' : 'simulacion', accion: 'crear', ...base, resumen, vals, validacion, avisos,
      nota: { modelo: 'res.partner', id: null, texto: textoNotaAlta(c, quien) } };
    if (!aplicar) return { ...plan, nota: { ...plan.nota, simulada: true } };

    // Justo antes de crear se vuelve a buscar por RIF (otro proceso pudo crearlo mientras tanto)
    const otra = await buscarCandidatos(odoo, sql, cid, c);
    if (otra.decision.candidatos.some((x) => x.coincide !== 'nombre')) {
      throw new Error('Apareció en Odoo un contacto con el mismo RIF mientras se procesaba: se reintenta para enlazarlo');
    }
    const nuevoId = await odoo.crear('res.partner', vals, cid);
    if (!Number.isInteger(nuevoId)) throw new Error('Odoo no devolvió el id del cliente creado');
    // Se anota de inmediato: si algo falla después, el reintento no crea otro
    await sql(`update odoo_escrituras set resultado = jsonb_build_object('odoo_id_creado', ${nuevoId}) where id = ${lit(fila.id)}`);
    const [p] = await odoo.leer('res.partner', 'read', [[nuevoId]], { fields: ['name', 'vat', 'company_id', 'customer_rank', 'user_id', 'property_product_pricelist', 'comment'] }, cid);
    if (!p || m2oId(p.company_id) !== cid) throw new Error(`El cliente creado en Odoo (${nuevoId}) no quedó en la compañía esperada`);
    const [v] = await sql(`select public.aplicar_vinculo_cliente_odoo(${lit(c.id)}, ${nuevoId}, 'creado',
      ${lit(JSON.stringify({ motivo: 'Creado desde GUDS', partner: { id: nuevoId, nombre: p.name, rif: txt(p.vat) } }))}::jsonb) r`);
    const notaHecha = await dejarNota(odoo, { ...plan.nota, id: nuevoId }, cid, true);
    log(`cliente ${c.nombre_negocio}: creado en Odoo ${nuevoId} (${c.nombre_corto})`);
    return {
      ...plan, odoo_id: nuevoId, odoo_id_creado: nuevoId, vinculo: v?.r ?? null, nota: notaHecha,
      despues: { nombre: p.name, rif: txt(p.vat), vendedor: m2oNombre(p.user_id), lista: m2oNombre(p.property_product_pricelist), marca: RE_MARCA_GUDS.test(String(p.comment || '')) },
    };
  } catch (e) {
    if (aplicar) {
      await sql(`select public.registrar_error_cliente_odoo(${lit(c.id)}, ${lit(String(e?.message || e).slice(0, 500))})`).catch(() => {});
    }
    throw e;
  }
}
