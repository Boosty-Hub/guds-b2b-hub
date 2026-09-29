// Fotos y descripciones de producto Odoo → GUDS (decisión 15, migración 20r). Lo llama importar.js en cada sincronización.
//
// - Detección barata: los adjuntos image_1920 de product.template (checksum y write_date, sin el binario) y las plantillas con
//   descripción de venta (en el idioma del usuario de la API). Son 2 lecturas livianas por corrida.
// - La decisión la toma la base (decidir_imagenes_odoo / sincronizar_descripciones_odoo): solo mira lo que cambió respecto de la
//   huella guardada y gana el cambio más reciente (si GUDS cambió después, se conserva y lo envía la cola hacia Odoo).
// - Solo se descargan de Odoo las imágenes que hay que traer, con tope por corrida (el resto sigue en la próxima), se suben
//   al bucket `imagenes` en productos/odoo/<plantilla>/<checksum>.<ext> (ruta estable y versionada) y se aplican si el producto
//   no cambió mientras tanto. Las copias viejas de Odoo que ya nadie usa se borran del bucket (de GUDS, nunca de Odoo).
import { txt, fechaOdoo, jsonbLit, lotes, deBase64 } from './util.js';
import { TIPOS_IMAGEN } from './storage.js';

const MAX_IMAGENES_CORRIDA = 25;
const MAX_BYTES_CORRIDA = 20 * 1024 * 1024;
const MAX_BYTES_IMAGEN = 8 * 1024 * 1024;

export async function sincronizarContenidoProductos({ odoo, sql, storage = null, aplicar = false, plantillas, log = () => {}, aviso = () => {} }) {
  const t0 = Date.now();
  const idioma = odoo.idioma || 'es_VE';
  const adjuntos = await odoo.leerTodo('ir.attachment', [['res_model', '=', 'product.template'], ['res_field', '=', 'image_1920']],
    ['res_id', 'checksum', 'write_date', 'mimetype', 'file_size']);
  const conDescripcion = await odoo.leerTodo('product.template', [['description_sale', '!=', false]], ['description_sale'], { contexto: { lang: idioma } });

  const adjuntoDe = new Map();
  for (const a of adjuntos) {
    const previo = adjuntoDe.get(a.res_id);
    if (!previo || a.id > previo.id) adjuntoDe.set(a.res_id, a);
  }
  const descripcionDe = new Map(conDescripcion.map((t) => [t.id, txt(t.description_sale)]));
  const vistas = new Set();
  const filas = [];
  for (const t of plantillas) {
    if (vistas.has(t.id)) continue;
    vistas.add(t.id);
    const a = adjuntoDe.get(t.id);
    filas.push({ odoo_id: t.id, cambio_en: fechaOdoo(t.write_date), descripcion: descripcionDe.get(t.id) ?? null,
      checksum: a?.checksum || null, mimetype: a?.mimetype || null, img_cambio_en: a ? fechaOdoo(a.write_date) : fechaOdoo(t.write_date),
      bytes: a?.file_size ?? null });
  }
  const resumen = { odoo_con_imagen: adjuntoDe.size, odoo_con_descripcion: descripcionDe.size };

  // ── Descripciones ──
  const [{ r: desc }] = await sql(`select public.sincronizar_descripciones_odoo(${jsonbLit(filas.map((f) => ({ odoo_id: f.odoo_id, descripcion: f.descripcion, cambio_en: f.cambio_en })))}, ${aplicar ? 'true' : 'false'}) r`);
  resumen.descripciones = desc;

  // ── Imágenes ──
  const decisiones = await sql(`select * from public.decidir_imagenes_odoo(${jsonbLit(filas.map((f) => ({ odoo_id: f.odoo_id, checksum: f.checksum, mimetype: f.mimetype, cambio_en: f.img_cambio_en })))})`);
  const porAccion = (a) => decisiones.filter((d) => d.accion === a);
  const traer = porAccion('traer');
  const quitar = porAccion('quitar');
  const img = { traer: traer.length, quitar: quitar.length, guds_mas_reciente: porAccion('guds_mas_reciente').length, traidas: 0, quitadas: 0, pendientes: 0, omitidas: 0 };
  resumen.imagenes = img;

  const cambios = quitar.map((d) => ({ producto_id: d.producto_id, accion: 'quitar', checksum: null, url: null, cambio_en: d.cambio_en,
    url_previa: d.url_previa, checksum_previo: d.checksum_previo, odoo_url_previa: d.odoo_url_previa }));

  if (traer.length && aplicar && !storage) aviso('Sin acceso al almacenamiento: no se traen las fotos nuevas de Odoo en esta corrida');
  if (traer.length && aplicar && storage) {
    const bytesDe = new Map(filas.map((f) => [f.odoo_id, Number(f.bytes) || 0]));
    const noSoportadas = traer.filter((d) => !TIPOS_IMAGEN[d.mimetype]);
    if (noSoportadas.length) aviso(`${noSoportadas.length} foto(s) de Odoo en un formato que GUDS no publica (${[...new Set(noSoportadas.map((d) => d.mimetype))].join(', ')}): se omiten`);
    // Tope por corrida para no alargar la sincronización: lo que no entra sigue en la próxima
    const elegidas = [];
    let presupuesto = MAX_BYTES_CORRIDA;
    for (const d of traer) {
      if (!TIPOS_IMAGEN[d.mimetype]) continue;
      const b = bytesDe.get(d.odoo_id) || 0;
      if (b > MAX_BYTES_IMAGEN) { img.omitidas++; continue; }
      if (elegidas.length >= MAX_IMAGENES_CORRIDA || (elegidas.length && b > presupuesto)) { img.pendientes++; continue; }
      presupuesto -= b;
      elegidas.push(d);
    }
    for (const lote of lotes(elegidas, 4)) {
      const binarios = await odoo.leer('product.template', 'read', [lote.map((d) => d.odoo_id)], { fields: ['image_1920'] });
      const b64De = new Map(binarios.map((b) => [b.id, b.image_1920]));
      for (const d of lote) {
        const b64 = b64De.get(d.odoo_id);
        if (!b64) { img.omitidas++; continue; }   // cambió entre la lectura del adjunto y la del binario: sigue en la próxima
        try {
          const ruta = `productos/odoo/${d.odoo_id}/${d.checksum}.${TIPOS_IMAGEN[d.mimetype]}`;
          const url = await storage.subir(ruta, deBase64(b64), d.mimetype);
          cambios.push({ producto_id: d.producto_id, accion: 'traer', checksum: d.checksum, url, cambio_en: d.cambio_en,
            url_previa: d.url_previa, checksum_previo: d.checksum_previo, odoo_url_previa: d.odoo_url_previa });
        } catch (e) {
          img.omitidas++;
          aviso(`Foto de Odoo ${d.odoo_id}: ${String(e.message).slice(0, 160)}`);
        }
      }
    }
  }

  if (aplicar && cambios.length) {
    const [{ r }] = await sql(`select public.aplicar_imagenes_odoo(${jsonbLit(cambios)}) r`);
    img.traidas = cambios.filter((c) => c.accion === 'traer').length;
    img.quitadas = cambios.filter((c) => c.accion === 'quitar').length;
    img.aplicadas = r.aplicadas;
    img.omitidas += r.omitidas;   // el producto cambió en GUDS mientras se descargaba: se vuelve a decidir en la próxima
    const sinUso = (r.sin_uso || []).map((u) => storage?.rutaDe(u)).filter((x) => x && x.startsWith('productos/odoo/'));
    if (sinUso.length && storage) await storage.borrar(sinUso).catch((e) => aviso(`No se borraron copias viejas de fotos de Odoo: ${e.message}`));
  }
  resumen.segundos = Math.round((Date.now() - t0) / 100) / 10;
  log(`    fotos y descripciones: Odoo tiene ${resumen.odoo_con_imagen} fotos y ${resumen.odoo_con_descripcion} descripciones · fotos: ${img.traer} por traer, ${img.quitar} por quitar, ${img.guds_mas_reciente} más recientes en GUDS${img.pendientes ? `, ${img.pendientes} para la próxima corrida` : ''} · descripciones: ${desc.traidas} traídas, ${desc.iguales} iguales, ${desc.guds_mas_reciente} más recientes en GUDS · ${resumen.segundos}s`);
  return resumen;
}
