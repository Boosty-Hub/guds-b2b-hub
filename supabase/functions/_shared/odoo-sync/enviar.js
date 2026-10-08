// Envío de pedidos de GUDS a Odoo (Fase 9b de docs/PLAN-ESPEJO-ODOO.md).
//
// - Solo pedidos APROBADOS en el admin (ordenes.aprobacion = 'aprobada').
// - Crea el pedido como COTIZACIÓN (borrador) en la empresa del pedido: no reserva stock ni toca la contabilidad;
//   el equipo de GUDS lo revisa y lo confirma en Odoo.
// - El envío que cobra GUDS va como línea de servicio con el producto de Odoo configurado en
//   configuracion.odoo_producto_envio (código interno); si no está configurado o no existe, va como línea de nota con el
//   monto y queda un aviso en ordenes.odoo_envio_aviso.
// - Todo lo que GUDS crea en Odoo queda marcado: referencia del cliente "<número GUDS> (GUDS)", origen "GUDS" y una nota.
// - Nunca borra ni modifica nada en Odoo (el cliente de odoo.js solo permite `create` en sale.order).
// - Idempotente: si ya existe en Odoo una orden con la referencia del pedido, la vincula en vez de crear otra.
// - Al vincular, el pedido y sus líneas quedan con su odoo_id: la sincronización periódica los actualiza desde Odoo
//   (Odoo manda) sin duplicarlos. `numero` pasa a ser el de Odoo y el de GUDS queda en `numero_guds`.
//
// - Al crearla deja una nota interna "(GUDS)" en la cotización con quién la aprobó (decisión D, 29-sep); si la nota falla,
//   el pedido no se revierte y el error queda en el resultado.
// - Almacén: el general de la empresa (P-01), salvo que el pedido traiga ordenes.almacen_id (fase 22b): una venta en
//   consignación aprobada sale del almacén de consignación del cliente ("X-CONSIGNADO <cliente>"), como hace hoy el equipo en
//   Odoo (la entrega C-xx/OUT descuenta de C-xx/Existencias). Si en Odoo ese almacén tiene menos de lo declarado, va un aviso.
//
// Uso: enviarPedido({ odoo, sql, ordenId, aplicar, log }) — `sql(query)` como en importar.js (rol postgres).
import { m2oId, m2oNombre } from './odoo.js';
import { dejarNota } from './notas.js';

const lit = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const escaparHtml = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function enviarPedido({ odoo, sql, ordenId, aplicar = false, log = console.log, nota = '' }) {
  const [o] = await sql(`
    select o.id, o.numero, o.numero_guds, o.odoo_id, o.estado::text estado, o.total, o.envio, o.notas, o.empresa_id, o.aprobacion,
           to_char(o.aprobado_at at time zone 'America/Caracas', 'DD/MM/YYYY HH24:MI') aprobado_el,
           nullif(trim(concat_ws(' ', ua.nombre, ua.apellido)), '') aprobado_por,
           e.odoo_company_id, e.nombre_corto, c.id cliente_id, c.odoo_id cliente_odoo_id, c.nombre_negocio,
           (select valor from configuracion where clave = 'odoo_producto_envio') producto_envio,
           o.almacen_id, al.odoo_id almacen_odoo_id, al.nombre almacen_nombre, al.tipo almacen_tipo, al.empresa_id almacen_empresa_id,
           (select dc.numero from declaraciones_consignacion dc where dc.orden_id = o.id) declaracion
    from ordenes o join empresas e on e.id = o.empresa_id join clientes c on c.id = o.cliente_id
    left join usuarios ua on ua.id = o.aprobado_por
    left join almacenes al on al.id = o.almacen_id
    where o.id = ${lit(ordenId)}`);
  if (!o) throw new Error('Pedido no encontrado');
  if (o.odoo_id) throw new Error(`El pedido ${o.numero} ya está en Odoo (id ${o.odoo_id})`);
  if (o.estado === 'cancelado') throw new Error(`El pedido ${o.numero} está cancelado`);
  // Crear en Odoo exige aprobación; la simulación sirve también para revisar un pedido antes de aprobarlo
  if (aplicar && o.aprobacion !== 'aprobada') throw new Error(`El pedido ${o.numero} no está aprobado (aprobación: ${o.aprobacion ?? '—'})`);
  if (aplicar && !o.aprobado_por) throw new Error(`El pedido ${o.numero} no tiene registrado quién lo aprobó`);
  if (!o.odoo_company_id) throw new Error('La empresa del pedido no está ligada a Odoo');
  if (!o.cliente_odoo_id) throw new Error(`El cliente ${o.nombre_negocio} no existe en Odoo (primero hay que crearlo): el pedido se envía solo cuando GUDS termine de crearlo o enlazarlo en Odoo`);
  const items = await sql(`
    select i.id, i.cantidad, i.precio_unitario, i.descuento, coalesce(i.unidades_por_empaque, 1) unidades, i.nombre_producto,
           p.odoo_id plantilla, p.nombre, p.sku
    from orden_items i join productos p on p.id = i.producto_id
    where i.orden_id = ${lit(o.id)} order by i.created_at, i.id`);
  if (!items.length) throw new Error('El pedido no tiene líneas');
  const sinOdoo = items.filter((i) => !i.plantilla);
  if (sinOdoo.length) throw new Error(`Productos que no existen en Odoo: ${sinOdoo.map((i) => i.nombre).join(', ')}`);
  const cid = o.odoo_company_id;
  const ref = `${o.numero} (GUDS)`;

  // 1. ¿Ya existe en Odoo? (reintento después de un corte, por ejemplo)
  const existentes = await odoo.leer('sale.order', 'search_read', [[['client_order_ref', '=', ref], ['company_id', '=', cid]]],
    { fields: ['name', 'state'], limit: 2 }, cid);
  if (existentes.length > 1) throw new Error(`Hay ${existentes.length} órdenes en Odoo con la referencia ${ref}: revisar a mano`);

  // 2. Variantes de producto y moneda de la lista de precios del cliente en esa empresa
  const plantillas = [...new Set(items.map((i) => i.plantilla))];
  const variantes = await odoo.leer('product.product', 'search_read', [[['product_tmpl_id', 'in', plantillas]]],
    { fields: ['product_tmpl_id', 'sale_ok', 'active'] }, cid);
  const varianteDe = new Map();
  for (const v of variantes) if (v.active && !varianteDe.has(m2oId(v.product_tmpl_id))) varianteDe.set(m2oId(v.product_tmpl_id), v.id);
  const sinVariante = items.filter((i) => !varianteDe.has(i.plantilla));
  if (sinVariante.length) throw new Error(`Sin variante activa en Odoo: ${sinVariante.map((i) => i.nombre).join(', ')}`);
  const [partner] = await odoo.leer('res.partner', 'read', [[o.cliente_odoo_id]], { fields: ['name', 'property_product_pricelist'] }, cid);
  const [lista] = partner?.property_product_pricelist
    ? await odoo.leer('product.pricelist', 'read', [[m2oId(partner.property_product_pricelist)]], { fields: ['name', 'currency_id'] }, cid)
    : [null];
  const moneda = lista ? m2oNombre(lista.currency_id) : null;
  // Los precios de GUDS están en USD: por ahora solo se envía a clientes con lista en USD (en Bs habría que convertir)
  if (moneda !== 'USD') throw new Error(`La lista de precios del cliente en Odoo es ${lista?.name ?? '—'} (${moneda ?? 'sin moneda'}): por ahora solo se envían pedidos en USD`);

  // Almacén: el general de la empresa (código P-01, el que usan las ventas normales). Sin esto Odoo toma el
  // predeterminado del usuario de la API, que puede ser un almacén de consignación.
  // Venta en consignación (22b): el almacén de consignación del cliente, comprobado en Odoo (activo y de la misma empresa).
  let almacenes;
  let libreEnAlmacen = null;   // variante → existencia libre (cantidad − reservado) en el almacén de consignación
  if (o.almacen_id) {
    if (!o.almacen_odoo_id) throw new Error(`El almacén ${o.almacen_nombre ?? ''} del pedido no está enlazado a Odoo`);
    if (o.almacen_empresa_id && o.almacen_empresa_id !== o.empresa_id) throw new Error(`El almacén ${o.almacen_nombre} es de otra empresa`);
    almacenes = await odoo.leer('stock.warehouse', 'search_read', [[['id', '=', Number(o.almacen_odoo_id)]]],
      { fields: ['name', 'code', 'company_id', 'active', 'lot_stock_id'], limit: 1 }, cid);
    const [w] = almacenes;
    if (!w) throw new Error(`El almacén ${o.almacen_nombre} (id ${o.almacen_odoo_id}) no existe en Odoo`);
    if (!w.active) throw new Error(`El almacén ${w.name} está archivado en Odoo`);
    if (m2oId(w.company_id) !== cid) throw new Error(`El almacén ${w.name} es de otra empresa en Odoo (${m2oNombre(w.company_id)})`);
    // Existencia del almacén en Odoo (solo lectura): si no alcanza, la cotización igual se crea y queda el aviso
    const quants = m2oId(w.lot_stock_id) ? await odoo.leer('stock.quant', 'search_read',
      [[['location_id', 'child_of', m2oId(w.lot_stock_id)], ['product_id', 'in', [...varianteDe.values()]]]],
      { fields: ['product_id', 'quantity', 'reserved_quantity'] }, cid) : [];
    libreEnAlmacen = new Map();
    for (const q of quants) {
      const v = m2oId(q.product_id);
      libreEnAlmacen.set(v, (libreEnAlmacen.get(v) ?? 0) + Number(q.quantity || 0) - Number(q.reserved_quantity || 0));
    }
  } else {
    almacenes = await odoo.leer('stock.warehouse', 'search_read', [[['company_id', '=', cid], ['code', '=', 'P-01'], ['active', '=', true]]],
      { fields: ['name'], limit: 2 }, cid);
    if (almacenes.length !== 1) throw new Error(`No se encontró un único almacén general (P-01) activo en ${o.nombre_corto}`);
  }

  // 3. Valores de la cotización (los precios de GUDS por unidad; en Odoo la cantidad va en unidades)
  const lineas = items.map((i) => {
    const unidades = Number(i.unidades) || 1;
    return {
      product_id: varianteDe.get(i.plantilla),
      product_uom_qty: Number(i.cantidad) * unidades,
      price_unit: Math.round((Number(i.precio_unitario) / unidades) * 10000) / 10000,
      discount: Number(i.descuento) || 0,
    };
  });
  // Envío cobrado en GUDS → línea de servicio (o nota si falta el producto en Odoo)
  const envio = Math.round(Number(o.envio || 0) * 100) / 100;
  let aviso = null;
  if (libreEnAlmacen) {
    const pedido = new Map();
    for (const l of lineas) pedido.set(l.product_id, (pedido.get(l.product_id) ?? 0) + l.product_uom_qty);
    const faltan = items.filter((i, k) => k === items.findIndex((x) => x.plantilla === i.plantilla))
      .map((i) => ({ nombre: i.nombre, pedido: pedido.get(varianteDe.get(i.plantilla)), libre: Math.round((libreEnAlmacen.get(varianteDe.get(i.plantilla)) ?? 0) * 100) / 100 }))
      .filter((x) => x.pedido > x.libre + 1e-6);
    if (faltan.length) {
      aviso = `En Odoo el almacén ${almacenes[0].name} tiene menos existencia libre de la declarada: `
        + faltan.map((x) => `${x.nombre} (${x.libre} de ${x.pedido})`).join(', ');
    }
  }
  // Líneas sin precio en GUDS: la cotización se crea igual (es un borrador que el equipo revisa en Odoo), con el aviso
  const sinPrecio = items.filter((i, k) => !(lineas[k].price_unit > 0));
  if (sinPrecio.length) {
    aviso = [aviso, `Sin precio en GUDS (van en 0 en la cotización; revisar el precio en Odoo antes de confirmar): ${sinPrecio.map((i) => i.nombre).join(', ')}`]
      .filter(Boolean).join(' · ');
  }
  const lineasExtra = [];
  if (envio > 0) {
    const codigo = String(o.producto_envio || '').trim();
    const [prodEnvio] = codigo
      ? await odoo.leer('product.product', 'search_read', [[['default_code', '=', codigo], ['sale_ok', '=', true], ['active', '=', true],
          '|', ['company_id', '=', cid], ['company_id', '=', false]]], { fields: ['display_name'], limit: 1 }, cid)
      : [];
    if (prodEnvio) {
      lineasExtra.push({ product_id: prodEnvio.id, product_uom_qty: 1, price_unit: envio, name: `Envío (GUDS) · pedido ${o.numero}` });
    } else {
      aviso = [aviso, codigo
        ? `No existe en Odoo un servicio vendible con código "${codigo}": el envío de $${envio.toFixed(2)} va como nota`
        : `Falta configurar el producto de servicio de envío en Odoo: el envío de $${envio.toFixed(2)} va como nota`].filter(Boolean).join(' · ');
      lineasExtra.push({ display_type: 'line_note', name: `(GUDS) Envío cobrado en GUDS: $${envio.toFixed(2)} (agregar la línea de servicio de envío en Odoo)` });
    }
  }
  const aprobacionTxt = `Aprobado en GUDS${o.aprobado_por ? ` por ${o.aprobado_por}` : ''}${o.aprobado_el ? ` el ${o.aprobado_el}` : ''}.`;
  const vals = {
    company_id: cid,
    partner_id: o.cliente_odoo_id,
    warehouse_id: almacenes[0].id,
    client_order_ref: ref,
    origin: 'GUDS',
    note: `<p>(GUDS) Pedido creado desde la plataforma GUDS: ${escaparHtml(o.numero)}. ${escaparHtml(aprobacionTxt)}${nota ? ` ${escaparHtml(nota)}` : ''}${o.declaracion ? `<br/>Venta en consignación declarada en GUDS (${escaparHtml(o.declaracion)}): sale del almacén ${escaparHtml(almacenes[0].name)}.` : ''}${o.notas ? `<br/>Notas del pedido: ${escaparHtml(o.notas)}` : ''}</p>`,
    order_line: [...lineas, ...lineasExtra].map((l) => [0, 0, l]),
  };
  const resumen = { pedido: o.numero, empresa: o.nombre_corto, cliente: o.nombre_negocio, moneda, almacen: almacenes[0].name,
    consignacion: o.declaracion ?? null, lineas, lineasExtra, aviso, vals, existente: existentes[0] ?? null };
  if (!aplicar) { log(`Simulación: se crearía en Odoo (${o.nombre_corto}) la cotización ${ref} con ${lineas.length} línea(s)`); return resumen; }

  // 4. Crear (o tomar la existente) y leerla de vuelta
  let odooId = existentes[0]?.id ?? null;
  const creadaAhora = !odooId;
  try {
    if (!odooId) odooId = await odoo.crear('sale.order', vals, cid);
  } catch (e) {
    await sql(`update ordenes set odoo_envio_error = ${lit(String(e.message).slice(0, 500))} where id = ${lit(o.id)}`);
    throw e;
  }
  const [so] = await odoo.leer('sale.order', 'read', [[odooId]],
    { fields: ['name', 'state', 'amount_untaxed', 'amount_tax', 'amount_total', 'currency_id', 'user_id', 'client_order_ref', 'origin', 'order_line', 'warehouse_id'] }, cid);
  const lineasOdoo = await odoo.leer('sale.order.line', 'read', [so.order_line],
    { fields: ['product_id', 'product_uom_qty', 'price_unit', 'price_subtotal', 'sequence', 'display_type'] }, cid);
  lineasOdoo.sort((a, b) => a.sequence - b.sequence || a.id - b.id);

  // Cuadre: Odoo calcula el IVA con los impuestos de cada producto; GUDS usa los mismos (fase 20a). Si no cuadra, queda el aviso
  // (p. ej. un cupón de GUDS, que no viaja a Odoo, o un impuesto cambiado en Odoo después de la última sincronización).
  const diferencia = Math.round((Number(so.amount_total) - Number(o.total)) * 100) / 100;
  if (Math.abs(diferencia) > 0.02) {
    aviso = [aviso, `Total en Odoo ${Number(so.amount_total).toFixed(2)} y en GUDS ${Number(o.total).toFixed(2)} (diferencia ${diferencia.toFixed(2)}): revisar impuestos o descuentos`].filter(Boolean).join(' · ');
  }

  // 5. Vincular en GUDS (sin triggers, como el importador): pedido y cada línea con su id de Odoo
  const usadas = new Set();
  const pares = items.map((i, k) => {
    const variante = varianteDe.get(i.plantilla);
    const l = lineasOdoo.find((x) => !usadas.has(x.id) && m2oId(x.product_id) === variante && Number(x.product_uom_qty) === lineas[k].product_uom_qty)
      ?? lineasOdoo.find((x) => !usadas.has(x.id) && m2oId(x.product_id) === variante);
    if (l) usadas.add(l.id);
    return { item: i, linea: l };
  });
  const updLineas = pares.filter((x) => x.linea).map((x) => `update orden_items set odoo_id = ${x.linea.id},
      cantidad = ${Math.round(Number(x.linea.product_uom_qty))}, precio_unitario = ${Number(x.linea.price_unit)}, unidades_por_empaque = 1
      where id = ${lit(x.item.id)} and odoo_id is null`).join(';\n');
  await sql(`begin; set local session_replication_role = replica;
    update ordenes set odoo_id = ${odooId}, numero_guds = coalesce(numero_guds, numero), odoo_enviado_at = now(), odoo_envio_error = null,
      odoo_envio_aviso = ${lit(aviso)},
      estado_odoo = ${lit(so.state)}, stock_descontado = true, updated_at = now()
    where id = ${lit(o.id)} and odoo_id is null;
    ${updLineas};
    commit;`);
  const notaHecha = creadaAhora
    ? await dejarNota(odoo, { modelo: 'sale.order', id: odooId, texto: `(GUDS) Pedido ${o.numero} creado desde la plataforma GUDS. ${aprobacionTxt}` }, cid, true)
    : null;
  if (notaHecha && !notaHecha.ok) log(`⚠ ${so.name}: no se pudo dejar la nota (GUDS): ${notaHecha.error}`);
  log(`✓ Creada en Odoo: ${so.name} (${o.nombre_corto}) · ${ref} · total ${so.amount_total} ${m2oNombre(so.currency_id)} · ${lineasOdoo.length} línea(s)`);
  return { ...resumen, odoo: { id: odooId, ...so, lineas: lineasOdoo }, lineasVinculadas: pares.filter((x) => x.linea).length, nota: notaHecha };
}
