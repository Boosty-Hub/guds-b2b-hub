// Inventario (Fase 6): lotes y series con vencimiento, existencias por ubicación y lote, transferencias
// (recepciones, entregas y traslados) con sus movimientos y lotes. Espejo de Odoo, solo lectura en GUDS.

import { m2oId, m2oNombre } from './odoo.js';
import { round2, stripHtml, txt, jsonbLit, lotes, fechaOdoo } from './util.js';

const TIPO = { incoming: 'recepcion', outgoing: 'entrega', internal: 'interna' };
const ESTADO = { draft: 'borrador', waiting: 'en_espera', confirmed: 'en_espera', partially_available: 'parcial', assigned: 'lista', done: 'hecha', cancel: 'cancelada' };

// Fecha de vencimiento de Odoo (UTC) → fecha local de Venezuela (UTC-4). Odoo usa 1900-01-01 como relleno: se toma como sin fecha.
export const fechaLote = (v) => {
  if (!v) return null;
  const d = new Date(`${String(v).replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime()) || d.getUTCFullYear() < 1990) return null;
  return new Date(d.getTime() - 4 * 3600 * 1000).toISOString().slice(0, 10);
};

export const CAMPOS_LOTE = ['name', 'product_id', 'company_id', 'expiration_date', 'use_date', 'removal_date', 'alert_date', 'product_qty',
  'ref', 'note', 'write_date'];

// ── Lectura por empresa ────────────────────────────────────────────────
export async function leerInventario(odoo, cid, deEmpresa) {
  const L = (m, dom, campos) => odoo.leerTodo(m, dom, campos, { empresa: cid });
  const d = {};
  d.lotes = await L('stock.lot', deEmpresa, CAMPOS_LOTE);
  d.transferencias = await L('stock.picking', [['company_id', '=', cid]],
    ['name', 'picking_type_id', 'picking_type_code', 'partner_id', 'origin', 'state', 'scheduled_date', 'date_deadline', 'date_done',
      'location_id', 'location_dest_id', 'sale_id', 'purchase_id', 'user_id', 'carrier_id', 'note', 'backorder_id', 'return_id', 'write_date']);
  d.movimientos = await L('stock.move', [['company_id', '=', cid], ['picking_id', '!=', false]],
    ['picking_id', 'product_id', 'description_picking', 'product_uom_qty', 'quantity', 'state', 'write_date']);
  d.lineas = await L('stock.move.line', [['company_id', '=', cid], ['picking_id', '!=', false], '|', ['lot_id', '!=', false], ['lot_name', '!=', false]],
    ['move_id', 'picking_id', 'product_id', 'lot_id', 'lot_name', 'quantity', 'date', 'write_date']);
  // Ajustes de inventario: movimientos hechos sin transferencia (conteos y correcciones de cantidad)
  d.ajustes = await L('stock.move.line', [['company_id', '=', cid], ['picking_id', '=', false], ['state', '=', 'done']],
    ['product_id', 'lot_id', 'lot_name', 'quantity', 'location_id', 'location_dest_id', 'reference', 'date', 'write_date']);
  d.serie = new Set((await L('product.template', [['tracking', '=', 'serial']], ['id'])).map((p) => p.id));
  return d;
}

// Lotes referenciados por existencias o movimientos que no se leyeron con la empresa (p. ej. de la otra empresa)
export function lotesReferenciados(inv, quants) {
  const leidos = new Set(inv.lotes.map((l) => l.id));
  return [...new Set([...quants.map((q) => m2oId(q.lot_id)), ...inv.lineas.map((l) => m2oId(l.lot_id)), ...inv.ajustes.map((l) => m2oId(l.lot_id))]
    .filter((id) => id && !leidos.has(id)))];
}

// Cliente de un almacén de consignación según sus entregas: el cliente que recibe ≥ 60 % de las entregas hechas (mín. 3)
export function clientesPorEntregas(inv, almacenDe, clienteDe) {
  const conteo = new Map();
  for (const t of inv.transferencias) {
    if (t.picking_type_code !== 'outgoing' || t.state !== 'done') continue;
    const wh = almacenDe.get(m2oId(t.location_id));
    const cli = clienteDe(m2oId(t.partner_id));
    if (!wh || !cli) continue;
    if (!conteo.has(wh)) conteo.set(wh, new Map());
    const m = conteo.get(wh);
    m.set(cli, (m.get(cli) || 0) + 1);
  }
  const res = new Map();
  for (const [wh, m] of conteo) {
    const total = [...m.values()].reduce((s, n) => s + n, 0);
    const [cli, n] = [...m].sort((a, b) => b[1] - a[1])[0];
    if (total >= 3 && n / total >= 0.6) res.set(wh, cli);
  }
  return res;
}

// ── Transformación + escritura ─────────────────────────────────────────
export async function escribirInventario({ inv, quants, E, sql, escribir, ts, aplicar, plantillaDe, almacenDe, clienteDe, provDe, empDe, log }) {
  const tmpl = (pid) => plantillaDe.get(pid) ?? null;

  const filasLotes = inv.lotes.map((l) => ({
    odoo_id: l.id, empresa_id: empDe(l.company_id), producto_tmpl: tmpl(m2oId(l.product_id)), nombre: txt(l.name) || `LOTE-${l.id}`,
    es_serie: inv.serie.has(tmpl(m2oId(l.product_id))), vencimiento: fechaLote(l.expiration_date), fecha_alerta: fechaLote(l.alert_date),
    fecha_retiro: fechaLote(l.removal_date), fecha_uso: fechaLote(l.use_date), cantidad: round2(l.product_qty), referencia: txt(l.ref),
    notas: stripHtml(l.note),
  }));
  // El mismo lote compartido puede venir de las dos empresas: se conserva una sola fila
  const lotesUnicos = [...new Map(filasLotes.map((l) => [l.odoo_id, l])).values()];

  const filasQuants = quants.map((q) => ({
    odoo_id: q.id, empresa_id: E, wh: almacenDe.get(m2oId(q.location_id)) ?? null, ubicacion: txt(m2oNombre(q.location_id)),
    producto_tmpl: tmpl(m2oId(q.product_id)), lote_odoo_id: m2oId(q.lot_id), cantidad: round2(q.quantity), reservado: round2(q.reserved_quantity),
    fecha_ingreso: fechaOdoo(q.in_date),
  })).filter((q) => q.producto_tmpl && (Math.abs(q.cantidad) > 0.0001 || Math.abs(q.reservado) > 0.0001));

  const filasTransf = inv.transferencias.map((t) => {
    const partner = m2oId(t.partner_id);
    return {
      odoo_id: t.id, empresa_id: E, numero: txt(t.name) || `TRF-${t.id}`, tipo: TIPO[t.picking_type_code] || 'otra',
      tipo_operacion: txt(m2oNombre(t.picking_type_id)), estado: ESTADO[t.state] || t.state, origen: txt(t.origin), contacto: txt(m2oNombre(t.partner_id)),
      cliente_odoo_id: partner ? clienteDe(partner) : null, proveedor_odoo_id: partner ? provDe(partner) : null,
      orden_odoo_id: m2oId(t.sale_id), orden_compra_odoo_id: m2oId(t.purchase_id),
      wh_origen: almacenDe.get(m2oId(t.location_id)) ?? null, wh_destino: almacenDe.get(m2oId(t.location_dest_id)) ?? null,
      ubicacion_origen: txt(m2oNombre(t.location_id)), ubicacion_destino: txt(m2oNombre(t.location_dest_id)),
      fecha_programada: fechaOdoo(t.scheduled_date), fecha_limite: fechaOdoo(t.date_deadline), fecha_realizada: fechaOdoo(t.date_done),
      responsable: txt(m2oNombre(t.user_id)), transportista: txt(m2oNombre(t.carrier_id)),
      devolucion_de_odoo_id: m2oId(t.return_id), pendiente_de_odoo_id: m2oId(t.backorder_id), notas: stripHtml(t.note),
    };
  });

  const filasItems = inv.movimientos.map((m) => ({
    odoo_id: m.id, empresa_id: E, transferencia_odoo_id: m2oId(m.picking_id), producto_tmpl: tmpl(m2oId(m.product_id)),
    nombre_producto: txt(m2oNombre(m.product_id)), cantidad_demandada: round2(m.product_uom_qty), cantidad_hecha: round2(m.quantity),
    estado: ESTADO[m.state] || m.state,
  }));

  const filasLineas = inv.lineas.map((l) => ({
    odoo_id: l.id, empresa_id: E, transferencia_odoo_id: m2oId(l.picking_id), item_odoo_id: m2oId(l.move_id),
    producto_tmpl: tmpl(m2oId(l.product_id)), lote_odoo_id: m2oId(l.lot_id), lote_nombre: txt(m2oNombre(l.lot_id)) || txt(l.lot_name),
    cantidad: round2(l.quantity), fecha: fechaOdoo(l.date),
  }));

  const filasAjustes = inv.ajustes.map((l) => {
    const whO = almacenDe.get(m2oId(l.location_id)) ?? null;
    const whD = almacenDe.get(m2oId(l.location_dest_id)) ?? null;
    return {
      odoo_id: l.id, empresa_id: E, producto_tmpl: tmpl(m2oId(l.product_id)), lote_odoo_id: m2oId(l.lot_id),
      lote_nombre: txt(m2oNombre(l.lot_id)) || txt(l.lot_name), sentido: whD && whO ? 'traslado' : whD ? 'entrada' : 'salida',
      cantidad: round2(l.quantity), wh: whD ?? whO, ubicacion_origen: txt(m2oNombre(l.location_id)), ubicacion_destino: txt(m2oNombre(l.location_dest_id)),
      referencia: txt(l.reference), fecha: fechaOdoo(l.date),
    };
  });

  const resumen = { lotes: lotesUnicos.length, existencias_lote: filasQuants.length, transferencias: filasTransf.length,
    movimientos_transferencia: filasItems.length, lotes_movidos: filasLineas.length, ajustes_inventario: filasAjustes.length };
  if (!aplicar) return resumen;

  const upsert = async (filas, n, sqlFn) => { for (const lote of lotes(filas, n)) await escribir(sqlFn(jsonbLit(lote))); };
  const limpiar = async (tabla, ids) => {
    await sql(`delete from ${tabla} where empresa_id = '${E}' and odoo_id <> all (array[${ids.join(',') || 0}]::int[])`);
  };
  const prod = (col) => `(select p.id from productos p where p.odoo_id = x.${col})`;

  await upsert(lotesUnicos, 1000, (j) => `
    insert into lotes (odoo_id, empresa_id, producto_id, nombre, es_serie, vencimiento, fecha_alerta, fecha_retiro, fecha_uso, cantidad,
      referencia, notas, odoo_sync_at)
    select x.odoo_id, x.empresa_id, ${prod('producto_tmpl')}, x.nombre, x.es_serie, x.vencimiento, x.fecha_alerta, x.fecha_retiro,
      x.fecha_uso, x.cantidad, x.referencia, x.notas, '${ts}'
    from jsonb_to_recordset(${j}) as x(odoo_id int, empresa_id uuid, producto_tmpl int, nombre text, es_serie boolean, vencimiento date,
      fecha_alerta date, fecha_retiro date, fecha_uso date, cantidad numeric, referencia text, notas text)
    on conflict (odoo_id) do update set empresa_id = excluded.empresa_id, producto_id = excluded.producto_id, nombre = excluded.nombre,
      es_serie = excluded.es_serie, vencimiento = excluded.vencimiento, fecha_alerta = excluded.fecha_alerta,
      fecha_retiro = excluded.fecha_retiro, fecha_uso = excluded.fecha_uso, cantidad = excluded.cantidad,
      referencia = excluded.referencia, notas = excluded.notas, odoo_sync_at = excluded.odoo_sync_at
    where (lotes.empresa_id, lotes.producto_id, lotes.nombre, lotes.es_serie, lotes.vencimiento, lotes.fecha_alerta, lotes.fecha_retiro,
      lotes.fecha_uso, lotes.cantidad, lotes.referencia, lotes.notas)
    is distinct from (excluded.empresa_id, excluded.producto_id, excluded.nombre, excluded.es_serie, excluded.vencimiento,
      excluded.fecha_alerta, excluded.fecha_retiro, excluded.fecha_uso, excluded.cantidad, excluded.referencia, excluded.notas)`);

  await upsert(filasQuants, 1000, (j) => `
    insert into inventario_lotes (odoo_id, empresa_id, almacen_id, ubicacion, producto_id, lote_id, cantidad, reservado, fecha_ingreso, odoo_sync_at)
    select x.odoo_id, x.empresa_id, (select a.id from almacenes a where a.odoo_id = x.wh), x.ubicacion, p.id,
      (select l.id from lotes l where l.odoo_id = x.lote_odoo_id), x.cantidad, x.reservado, x.fecha_ingreso, '${ts}'
    from jsonb_to_recordset(${j}) as x(odoo_id int, empresa_id uuid, wh int, ubicacion text, producto_tmpl int, lote_odoo_id int,
      cantidad numeric, reservado numeric, fecha_ingreso timestamptz)
    join productos p on p.odoo_id = x.producto_tmpl
    on conflict (odoo_id) do update set almacen_id = excluded.almacen_id, ubicacion = excluded.ubicacion, producto_id = excluded.producto_id,
      lote_id = excluded.lote_id, cantidad = excluded.cantidad, reservado = excluded.reservado, fecha_ingreso = excluded.fecha_ingreso,
      odoo_sync_at = excluded.odoo_sync_at
    where (inventario_lotes.almacen_id, inventario_lotes.ubicacion, inventario_lotes.producto_id, inventario_lotes.lote_id,
      inventario_lotes.cantidad, inventario_lotes.reservado, inventario_lotes.fecha_ingreso)
    is distinct from (excluded.almacen_id, excluded.ubicacion, excluded.producto_id, excluded.lote_id, excluded.cantidad,
      excluded.reservado, excluded.fecha_ingreso)`);

  await upsert(filasTransf, 500, (j) => `
    insert into transferencias (odoo_id, empresa_id, numero, tipo, tipo_operacion, estado, origen, contacto, cliente_id, proveedor_id,
      orden_id, orden_compra_id, almacen_origen_id, almacen_destino_id, ubicacion_origen, ubicacion_destino, fecha_programada,
      fecha_limite, fecha_realizada, responsable, transportista, notas, odoo_sync_at)
    select x.odoo_id, x.empresa_id, x.numero, x.tipo, x.tipo_operacion, x.estado, x.origen, x.contacto,
      (select c.id from clientes c where c.odoo_id = x.cliente_odoo_id), (select pv.id from proveedores pv where pv.odoo_id = x.proveedor_odoo_id),
      (select o.id from ordenes o where o.odoo_id = x.orden_odoo_id), (select oc.id from ordenes_compra oc where oc.odoo_id = x.orden_compra_odoo_id),
      (select a.id from almacenes a where a.odoo_id = x.wh_origen), (select a.id from almacenes a where a.odoo_id = x.wh_destino),
      x.ubicacion_origen, x.ubicacion_destino, x.fecha_programada, x.fecha_limite, x.fecha_realizada, x.responsable, x.transportista,
      x.notas, '${ts}'
    from jsonb_to_recordset(${j}) as x(odoo_id int, empresa_id uuid, numero text, tipo text, tipo_operacion text, estado text, origen text,
      contacto text, cliente_odoo_id int, proveedor_odoo_id int, orden_odoo_id int, orden_compra_odoo_id int, wh_origen int, wh_destino int,
      ubicacion_origen text, ubicacion_destino text, fecha_programada timestamptz, fecha_limite timestamptz, fecha_realizada timestamptz,
      responsable text, transportista text, notas text)
    on conflict (odoo_id) do update set numero = excluded.numero, tipo = excluded.tipo, tipo_operacion = excluded.tipo_operacion,
      estado = excluded.estado, origen = excluded.origen, contacto = excluded.contacto, cliente_id = excluded.cliente_id,
      proveedor_id = excluded.proveedor_id, orden_id = excluded.orden_id, orden_compra_id = excluded.orden_compra_id,
      almacen_origen_id = excluded.almacen_origen_id, almacen_destino_id = excluded.almacen_destino_id,
      ubicacion_origen = excluded.ubicacion_origen, ubicacion_destino = excluded.ubicacion_destino,
      fecha_programada = excluded.fecha_programada, fecha_limite = excluded.fecha_limite, fecha_realizada = excluded.fecha_realizada,
      responsable = excluded.responsable, transportista = excluded.transportista, notas = excluded.notas, odoo_sync_at = excluded.odoo_sync_at
    where (transferencias.numero, transferencias.tipo, transferencias.tipo_operacion, transferencias.estado, transferencias.origen,
      transferencias.contacto, transferencias.cliente_id, transferencias.proveedor_id, transferencias.orden_id, transferencias.orden_compra_id,
      transferencias.almacen_origen_id, transferencias.almacen_destino_id, transferencias.ubicacion_origen, transferencias.ubicacion_destino,
      transferencias.fecha_programada, transferencias.fecha_limite, transferencias.fecha_realizada, transferencias.responsable,
      transferencias.transportista, transferencias.notas)
    is distinct from (excluded.numero, excluded.tipo, excluded.tipo_operacion, excluded.estado, excluded.origen, excluded.contacto,
      excluded.cliente_id, excluded.proveedor_id, excluded.orden_id, excluded.orden_compra_id, excluded.almacen_origen_id,
      excluded.almacen_destino_id, excluded.ubicacion_origen, excluded.ubicacion_destino, excluded.fecha_programada, excluded.fecha_limite,
      excluded.fecha_realizada, excluded.responsable, excluded.transportista, excluded.notas)`);

  // Devoluciones y pendientes (referencias entre transferencias, una vez que todas existen)
  const refs = filasTransf.filter((t) => t.devolucion_de_odoo_id || t.pendiente_de_odoo_id)
    .map(({ odoo_id, devolucion_de_odoo_id, pendiente_de_odoo_id }) => ({ odoo_id, devolucion_de_odoo_id, pendiente_de_odoo_id }));
  await upsert(refs, 1000, (j) => `
    update transferencias t set devolucion_de_id = (select d.id from transferencias d where d.odoo_id = x.devolucion_de_odoo_id),
      pendiente_de_id = (select b.id from transferencias b where b.odoo_id = x.pendiente_de_odoo_id)
    from jsonb_to_recordset(${j}) as x(odoo_id int, devolucion_de_odoo_id int, pendiente_de_odoo_id int)
    where t.odoo_id = x.odoo_id and (t.devolucion_de_id, t.pendiente_de_id) is distinct from
      ((select d.id from transferencias d where d.odoo_id = x.devolucion_de_odoo_id), (select b.id from transferencias b where b.odoo_id = x.pendiente_de_odoo_id))`);

  await upsert(filasItems, 1000, (j) => `
    insert into transferencia_items (odoo_id, empresa_id, transferencia_id, producto_id, nombre_producto, cantidad_demandada, cantidad_hecha, estado, odoo_sync_at)
    select x.odoo_id, x.empresa_id, t.id, ${prod('producto_tmpl')}, x.nombre_producto, x.cantidad_demandada, x.cantidad_hecha, x.estado, '${ts}'
    from jsonb_to_recordset(${j}) as x(odoo_id int, empresa_id uuid, transferencia_odoo_id int, producto_tmpl int, nombre_producto text,
      cantidad_demandada numeric, cantidad_hecha numeric, estado text)
    join transferencias t on t.odoo_id = x.transferencia_odoo_id
    on conflict (odoo_id) do update set transferencia_id = excluded.transferencia_id, producto_id = excluded.producto_id,
      nombre_producto = excluded.nombre_producto, cantidad_demandada = excluded.cantidad_demandada, cantidad_hecha = excluded.cantidad_hecha,
      estado = excluded.estado, odoo_sync_at = excluded.odoo_sync_at
    where (transferencia_items.transferencia_id, transferencia_items.producto_id, transferencia_items.nombre_producto,
      transferencia_items.cantidad_demandada, transferencia_items.cantidad_hecha, transferencia_items.estado)
    is distinct from (excluded.transferencia_id, excluded.producto_id, excluded.nombre_producto, excluded.cantidad_demandada,
      excluded.cantidad_hecha, excluded.estado)`);

  await upsert(filasLineas, 1000, (j) => `
    insert into transferencia_lotes (odoo_id, empresa_id, transferencia_id, item_id, producto_id, lote_id, lote_nombre, cantidad, fecha, odoo_sync_at)
    select x.odoo_id, x.empresa_id, t.id, (select i.id from transferencia_items i where i.odoo_id = x.item_odoo_id), ${prod('producto_tmpl')},
      (select l.id from lotes l where l.odoo_id = x.lote_odoo_id), x.lote_nombre, x.cantidad, x.fecha, '${ts}'
    from jsonb_to_recordset(${j}) as x(odoo_id int, empresa_id uuid, transferencia_odoo_id int, item_odoo_id int, producto_tmpl int,
      lote_odoo_id int, lote_nombre text, cantidad numeric, fecha timestamptz)
    join transferencias t on t.odoo_id = x.transferencia_odoo_id
    on conflict (odoo_id) do update set transferencia_id = excluded.transferencia_id, item_id = excluded.item_id,
      producto_id = excluded.producto_id, lote_id = excluded.lote_id, lote_nombre = excluded.lote_nombre, cantidad = excluded.cantidad,
      fecha = excluded.fecha, odoo_sync_at = excluded.odoo_sync_at
    where (transferencia_lotes.transferencia_id, transferencia_lotes.item_id, transferencia_lotes.producto_id, transferencia_lotes.lote_id,
      transferencia_lotes.lote_nombre, transferencia_lotes.cantidad, transferencia_lotes.fecha)
    is distinct from (excluded.transferencia_id, excluded.item_id, excluded.producto_id, excluded.lote_id, excluded.lote_nombre,
      excluded.cantidad, excluded.fecha)`);

  await upsert(filasAjustes, 1000, (j) => `
    insert into ajustes_inventario (odoo_id, empresa_id, producto_id, lote_id, lote_nombre, sentido, cantidad, almacen_id, ubicacion_origen,
      ubicacion_destino, referencia, fecha, odoo_sync_at)
    select x.odoo_id, x.empresa_id, ${prod('producto_tmpl')}, (select l.id from lotes l where l.odoo_id = x.lote_odoo_id), x.lote_nombre, x.sentido,
      x.cantidad, (select a.id from almacenes a where a.odoo_id = x.wh), x.ubicacion_origen, x.ubicacion_destino, x.referencia, x.fecha, '${ts}'
    from jsonb_to_recordset(${j}) as x(odoo_id int, empresa_id uuid, producto_tmpl int, lote_odoo_id int, lote_nombre text, sentido text,
      cantidad numeric, wh int, ubicacion_origen text, ubicacion_destino text, referencia text, fecha timestamptz)
    on conflict (odoo_id) do update set producto_id = excluded.producto_id, lote_id = excluded.lote_id, lote_nombre = excluded.lote_nombre,
      sentido = excluded.sentido, cantidad = excluded.cantidad, almacen_id = excluded.almacen_id, ubicacion_origen = excluded.ubicacion_origen,
      ubicacion_destino = excluded.ubicacion_destino, referencia = excluded.referencia, fecha = excluded.fecha, odoo_sync_at = excluded.odoo_sync_at
    where (ajustes_inventario.producto_id, ajustes_inventario.lote_id, ajustes_inventario.lote_nombre, ajustes_inventario.sentido,
      ajustes_inventario.cantidad, ajustes_inventario.almacen_id, ajustes_inventario.ubicacion_origen, ajustes_inventario.ubicacion_destino,
      ajustes_inventario.referencia, ajustes_inventario.fecha)
    is distinct from (excluded.producto_id, excluded.lote_id, excluded.lote_nombre, excluded.sentido, excluded.cantidad, excluded.almacen_id,
      excluded.ubicacion_origen, excluded.ubicacion_destino, excluded.referencia, excluded.fecha)`);

  // Lo que ya no viene de Odoo (sin modo réplica: los ON DELETE CASCADE limpian los hijos)
  await limpiar('ajustes_inventario', filasAjustes.map((a) => a.odoo_id));
  await limpiar('transferencia_lotes', filasLineas.map((l) => l.odoo_id));
  await limpiar('transferencia_items', filasItems.map((i) => i.odoo_id));
  await limpiar('transferencias', filasTransf.map((t) => t.odoo_id));
  await limpiar('inventario_lotes', filasQuants.map((q) => q.odoo_id));
  await limpiar('lotes', lotesUnicos.filter((l) => l.empresa_id).map((l) => l.odoo_id));
  const sinProducto = filasQuants.length - (await sql(`select count(*)::int n from inventario_lotes where empresa_id = '${E}'`))[0].n;
  if (sinProducto > 0) log(`    ${sinProducto} existencias por lote de productos que no están en GUDS (archivados en Odoo)`);
  return resumen;
}
