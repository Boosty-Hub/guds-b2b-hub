// Foto principal y descripción de venta de un producto editadas en GUDS → Odoo (product.template). Migración 20r
// (decisión 15 del dueño: fotos y descripciones bidireccionales, gana el cambio más reciente).
//
// La fila de la cola solo avisa que algo cambió: se envía el ESTADO ACTUAL del producto en GUDS, y solo de los campos que
// cambió GUDS (origen 'guds') y que difieren de lo último que se vio en Odoo. Antes de escribir se relee Odoo: si Odoo cambió
// ese campo después que GUDS, gana Odoo y el campo no se envía (la sincronización lo trae a GUDS).
// Al escribir se guarda la huella nueva de Odoo (checksum del adjunto de la imagen, md5 de la descripción): así lo que
// escribió GUDS no vuelve en la próxima sincronización como si fuera un cambio de Odoo.
// Nunca borra en Odoo: quitar la foto en GUDS no se envía (en Odoo eso borraría el adjunto de la imagen) y odoo.js bloquea
// image_1920 = false. Solo usa `escribir` de odoo.js con image_1920 / description_sale.
import { txt, fechaOdoo, aBase64 } from './util.js';

const MAX_BYTES_FOTO = 5 * 1024 * 1024;
const lit = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);

async function leerOdoo(odoo, odooId, lang) {
  const [t] = await odoo.leer('product.template', 'read', [[odooId]], { fields: ['name', 'description_sale', 'write_date', 'company_id'], context: { lang } });
  if (!t) return null;
  const [a] = await odoo.leer('ir.attachment', 'search_read',
    [[['res_model', '=', 'product.template'], ['res_field', '=', 'image_1920'], ['res_id', '=', odooId]]],
    { fields: ['checksum', 'write_date', 'file_size', 'mimetype'], order: 'id desc', limit: 1 });
  return {
    nombre: typeof t.name === 'object' && t.name ? (t.name.es_VE || t.name.en_US) : t.name,
    descripcion: txt(t.description_sale), escrito_en: fechaOdoo(t.write_date), empresa: Array.isArray(t.company_id) ? t.company_id[0] : null,
    imagen: a ? { checksum: a.checksum || null, escrita_en: fechaOdoo(a.write_date), bytes: a.file_size, tipo: a.mimetype } : null,
  };
}

export async function escribirProducto({ odoo, sql, fila, aplicar, log = () => {}, storage = null }) {
  // Un envío viejo (p. ej. un reintento) no hace falta si ya hay uno más reciente del mismo producto: ese envía el estado actual
  const [nuevo] = await sql(`select count(*)::int n from odoo_escrituras o join odoo_escrituras f on f.id = ${lit(fila.id)}
    where o.tipo = 'producto' and o.referencia_id = f.referencia_id and o.id <> f.id and o.created_at > f.created_at
      and o.estado in ('pendiente', 'procesando', 'hecha')`);
  if (nuevo?.n > 0) return { omitida: 'Hay un envío más reciente de este producto' };
  const [otro] = await sql(`select count(*)::int n from odoo_escrituras where tipo = 'producto' and referencia_id = ${lit(fila.referencia_id)}
    and id <> ${lit(fila.id)} and estado = 'procesando' and created_at > now() - interval '15 minutes'`);
  if (otro?.n > 0) throw new Error('Hay otro envío de este producto en curso; se reintenta en la próxima sincronización');

  const [p] = await sql(`select p.id, p.odoo_id, p.nombre, p.empresa_id, e.odoo_company_id, p.imagen_url, p.imagen_odoo_url, p.imagen_odoo_checksum,
      nullif(btrim(p.descripcion), '') descripcion,
      p.descripcion_origen = 'guds' and md5(nullif(btrim(p.descripcion), '')) is distinct from p.descripcion_odoo_md5 desc_pendiente,
      p.imagen_origen = 'guds' and p.imagen_url is not null and p.imagen_url is distinct from p.imagen_odoo_url img_pendiente,
      p.imagen_origen = 'guds' and p.imagen_url is null and p.imagen_odoo_checksum is not null img_quitada
    from productos p left join empresas e on e.id = p.empresa_id where p.id = ${lit(fila.referencia_id)}`);
  if (!p) throw new Error('Producto no encontrado en GUDS');
  if (!p.odoo_id) throw new Error(`El producto ${p.nombre} no está vinculado a Odoo`);
  const avisos = p.img_quitada ? ['Quitar la foto no se envía a Odoo: allí se conserva la suya'] : [];
  if (!p.desc_pendiente && !p.img_pendiente) {
    return { sin_cambios: true, motivo: avisos[0] || 'La foto y la descripción de GUDS ya coinciden con Odoo', avisos };
  }

  if (!odoo.empresas) await odoo.autenticar();
  const lang = odoo.idioma || 'es_VE';
  const antes = await leerOdoo(odoo, p.odoo_id, lang);
  if (!antes) throw new Error(`La plantilla ${p.odoo_id} ya no existe en Odoo`);
  const cid = p.odoo_company_id || antes.empresa || odoo.empresas[0];

  // ¿Odoo cambió cada campo después de lo último que vio GUDS, y más tarde que el cambio de GUDS? (gana el más reciente)
  const [c] = await sql(`select
      md5(${lit(antes.descripcion)}::text) is distinct from p.descripcion_odoo_md5 desc_odoo_cambio,
      md5(${lit(antes.descripcion)}::text) is not distinct from md5(nullif(btrim(p.descripcion), '')) desc_igual,
      md5(${lit(antes.descripcion)}::text) huella_desc,
      public.contenido_odoo_gana(p.descripcion_origen, p.descripcion_actualizada_en, ${lit(antes.escrito_en)}::timestamptz) desc_gana_odoo,
      ${lit(antes.imagen?.checksum ?? null)}::text is distinct from p.imagen_odoo_checksum img_odoo_cambio,
      public.contenido_odoo_gana(p.imagen_origen, p.imagen_actualizada_en, ${lit(antes.imagen?.escrita_en ?? antes.escrito_en)}::timestamptz) img_gana_odoo
    from productos p where p.id = ${lit(p.id)}`);

  const vals = {};
  const omitidos = [];
  const plan = { producto: p.nombre, odoo_id: p.odoo_id, empresa_odoo: cid, idioma: lang, campos: [], omitidos, avisos };
  if (p.desc_pendiente) {
    if (c.desc_odoo_cambio && c.desc_gana_odoo) {
      omitidos.push({ campo: 'descripcion', motivo: 'Odoo tiene un cambio más reciente de la descripción: se trae a GUDS' });
    } else if (c.desc_igual) {
      plan.descripcion = { ya_igual: true };
    } else {
      vals.description_sale = p.descripcion || false;
      plan.campos.push('descripcion');
      plan.descripcion = { antes: antes.descripcion?.slice(0, 300) ?? null, despues: p.descripcion?.slice(0, 300) ?? null, caracteres: p.descripcion?.length ?? 0 };
    }
  }
  if (p.img_pendiente) {
    if (c.img_odoo_cambio && c.img_gana_odoo) {
      omitidos.push({ campo: 'imagen', motivo: 'Odoo tiene una foto más reciente: se trae a GUDS' });
    } else {
      if (!storage) throw new Error('Falta acceso al almacenamiento de GUDS para leer la foto');
      const foto = await storage.descargar(p.imagen_url, MAX_BYTES_FOTO);
      vals.image_1920 = aBase64(foto.bytes);
      plan.campos.push('imagen');
      plan.imagen = { url: p.imagen_url, tipo: foto.tipo, bytes: foto.bytes.length, base64_kb: Math.round(vals.image_1920.length / 1024),
        odoo_antes: antes.imagen ? { checksum: antes.imagen.checksum, bytes: antes.imagen.bytes } : null };
    }
  }

  // Nada que escribir (ya coincidía o ganó Odoo): se anota la huella si la descripción ya era igual
  if (!Object.keys(vals).length) {
    if (plan.descripcion?.ya_igual && aplicar) {
      await sql(`begin; set local session_replication_role = replica; update productos set descripcion_odoo_md5 = ${lit(c.huella_desc)} where id = ${lit(p.id)}; commit;`);
    }
    return { modo: aplicar ? 'aplicada' : 'simulacion', sin_cambios: true, ...plan,
      motivo: omitidos.length ? omitidos.map((o) => o.motivo).join(' · ') : 'Odoo ya tenía estos datos' };
  }
  if (!aplicar) return { modo: 'simulacion', ...plan };

  await odoo.escribir('product.template', [p.odoo_id], vals, cid, { lang });
  const despues = await leerOdoo(odoo, p.odoo_id, lang);
  if (vals.image_1920 && !despues?.imagen?.checksum) throw new Error('Odoo no guardó la imagen');
  // Huellas nuevas de Odoo (sin disparadores): lo escrito no vuelve como cambio de Odoo en la próxima sincronización
  const sets = [];
  if ('description_sale' in vals) sets.push(`descripcion_odoo_md5 = md5(${lit(despues.descripcion)}::text)`);
  if (vals.image_1920) sets.push(`imagen_odoo_checksum = ${lit(despues.imagen.checksum)}`, `imagen_odoo_url = ${lit(p.imagen_url)}`);
  await sql(`begin; set local session_replication_role = replica; update productos set ${sets.join(', ')} where id = ${lit(p.id)}; commit;`);
  log(`producto ${p.nombre} (Odoo ${p.odoo_id}): ${plan.campos.join(', ')}`);
  return {
    modo: 'aplicada', ...plan,
    despues: { descripcion_igual: 'description_sale' in vals ? despues.descripcion === (p.descripcion || null) : undefined,
      imagen: despues.imagen ? { checksum: despues.imagen.checksum, bytes: despues.imagen.bytes, tipo: despues.imagen.tipo } : null },
  };
}
