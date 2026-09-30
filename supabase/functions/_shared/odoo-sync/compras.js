// Compras y cuentas por pagar (Fase 5): órdenes de compra, facturas/NC/ND de proveedor, pagos a proveedores,
// cómo se saldó cada factura y retenciones emitidas (IVA e ISLR). Espejo de Odoo, solo lectura en GUDS.

import { m2oId, m2oNombre } from './odoo.js';
import { round2, stripHtml, txt, jsonbLit, lotes, fechaOdoo } from './util.js';

const nombreDoc = (name, id) => (name && name !== '/' ? txt(name) : `ODOO-${id}`);
const ESTADO_OC = { draft: 'borrador', sent: 'enviada', 'to approve': 'por_aprobar', purchase: 'confirmada', done: 'bloqueada', cancel: 'cancelada' };
// "En pago" en Odoo = pagada por completo, con el pago aún sin conciliar con el banco (saldo 0): para GUDS está pagada
const estadoPago = (state, ps) => (state === 'cancel' || ps === 'reversed' ? 'anulado' : ps === 'paid' || ps === 'in_payment' ? 'pagado'
  : ps === 'partial' ? 'parcial' : 'pendiente');
const estadoPagoProv = (s) => (s === 'paid' || s === 'in_process' ? 'verificado' : s === 'draft' ? 'pendiente' : 'rechazado');
const estadoRet = (s) => (s === 'cancel' ? 'anulado' : s === 'draft' ? 'borrador' : 'confirmado');

// ── Lectura por empresa ────────────────────────────────────────────────
export async function leerCompras(odoo, cid) {
  const L = (m, dom, campos, pagina) => odoo.leerTodo(m, dom, campos, { empresa: cid, ...(pagina ? { pagina } : {}) });
  const d = {};
  d.ordenesCompra = await L('purchase.order', [['company_id', '=', cid]],
    ['name', 'partner_id', 'partner_ref', 'state', 'date_order', 'date_planned', 'currency_id', 'amount_untaxed', 'amount_tax',
      'amount_total', 'amount_total_cc', 'notes', 'invoice_status', 'receipt_status', 'user_id', 'write_date']);
  d.lineasCompra = await L('purchase.order.line', [['order_id.company_id', '=', cid], ['display_type', '=', false]],
    ['order_id', 'product_id', 'name', 'product_qty', 'qty_received', 'qty_invoiced', 'price_unit', 'price_subtotal', 'write_date']);
  d.facturasProv = await L('account.move',
    [['move_type', 'in', ['in_invoice', 'in_refund']], ['state', 'in', ['posted', 'cancel']], ['company_id', '=', cid]],
    ['name', 'ref', 'move_type', 'state', 'invoice_date', 'invoice_date_due', 'commercial_partner_id', 'currency_id',
      'invoice_currency_rate', 'amount_untaxed', 'amount_tax', 'amount_total', 'amount_total_signed', 'amount_residual_signed',
      'payment_state', 'nro_control', 'debit_origin_id', 'reversed_entry_id', 'purchase_id', 'invoice_cancel_reason_id',
      'descripcion_cancel', 'eu_cancel_motive_id', 'eu_cancel_motive_desc', 'write_date']);
  d.lineasFacturaProv = await L('account.move.line',
    [['display_type', '=', 'product'], ['company_id', '=', cid],
      ['move_id.move_type', 'in', ['in_invoice', 'in_refund']], ['move_id.state', 'in', ['posted', 'cancel']]],
    ['move_id', 'name', 'quantity', 'price_unit', 'price_subtotal', 'price_total', 'discount', 'product_id', 'write_date']);
  d.pagosProv = await L('account.payment', [['partner_type', '=', 'supplier'], ['company_id', '=', cid]],
    ['name', 'payment_type', 'partner_id', 'amount', 'currency_id', 'date', 'journal_id', 'state', 'memo',
      'amount_company_currency_signed', 'move_id', 'batch_payment_id', 'write_date']);
  d.retIvaProv = await L('account.wh.iva', [['move_type', 'in', ['in_invoice', 'in_refund']], ['company_id', '=', cid]],
    ['number', 'period', 'date', 'partner_id', 'state', 'total_tax_ret', 'total_tax_ret_ref', 'asiento_iva', 'write_date']);
  d.lineasRetIvaProv = d.retIvaProv.length
    ? await L('account.wh.iva.line', [['retention_id', 'in', d.retIvaProv.map((r) => r.id)]],
      ['retention_id', 'invoice_id', 'base_tax', 'rate_amount', 'ret_amount', 'ret_amount_ref', 'write_date'])
    : [];
  d.retIslr = await L('account.wh.islr', [['company_id', '=', cid]],
    ['name', 'number', 'date', 'partner_id', 'state', 'asiento_islr', 'write_date']);
  d.lineasRetIslr = d.retIslr.length
    ? await L('account.wh.islr.line', [['withholding_id', 'in', d.retIslr.map((r) => r.id)]],
      ['withholding_id', 'invoice_id', 'code_withholding_islr', 'descripcion', 'base_tax', 'porc_islr', 'ret_amount',
        'ret_amount_bs', 'sus_amount', 'write_date'])
    : [];
  return d;
}

// Contactos que aparecen como proveedor en los documentos de compra
export function proveedoresReferenciados(c, comercial) {
  const com = (id) => comercial.get(id) ?? id;
  return [
    ...c.ordenesCompra.map((o) => com(m2oId(o.partner_id))), ...c.facturasProv.map((f) => m2oId(f.commercial_partner_id)),
    ...c.pagosProv.map((p) => com(m2oId(p.partner_id))), ...c.retIvaProv.map((r) => com(m2oId(r.partner_id))),
    ...c.retIslr.map((r) => com(m2oId(r.partner_id))),
  ].filter(Boolean);
}

// ── Transformación + escritura ─────────────────────────────────────────
export async function escribirCompras({ c, d, E, odoo, cid, sql, escribir, ts, aplicar, comercial, plantillaDe, proveedoresSet, log }) {
  const provDe = (pid) => { const x = comercial.get(pid) ?? pid; return proveedoresSet.has(x) ? x : proveedoresSet.has(pid) ? pid : null; };

  const ordenes = c.ordenesCompra.map((o) => ({
    odoo_id: o.id, empresa_id: E, numero: nombreDoc(o.name, o.id), referencia_proveedor: txt(o.partner_ref),
    proveedor_odoo_id: provDe(m2oId(o.partner_id)), fecha_orden: fechaOdoo(o.date_order), fecha_prevista: fechaOdoo(o.date_planned),
    estado: ESTADO_OC[o.state] || o.state, estado_recepcion: o.receipt_status || null, estado_facturacion: o.invoice_status || null,
    moneda: m2oNombre(o.currency_id), subtotal: round2(o.amount_untaxed), impuesto: round2(o.amount_tax), total: round2(o.amount_total),
    total_usd: round2(o.amount_total_cc ?? o.amount_total), comprador: m2oNombre(o.user_id), notas: stripHtml(o.notes),
  }));
  const lineasOC = c.lineasCompra.map((l) => ({
    odoo_id: l.id, empresa_id: E, orden_odoo_id: m2oId(l.order_id), tmpl: plantillaDe.get(m2oId(l.product_id)) ?? null,
    nombre_producto: txt(l.name) || m2oNombre(l.product_id), cantidad: l.product_qty || 0, cantidad_recibida: l.qty_received || 0,
    cantidad_facturada: l.qty_invoiced || 0, precio_unitario: round2(l.price_unit), subtotal: round2(l.price_subtotal),
  }));

  const facturas = c.facturasProv.map((f) => ({
    odoo_id: f.id, empresa_id: E, numero: nombreDoc(f.name, f.id), referencia: txt(f.ref),
    tipo: f.move_type === 'in_refund' ? 'nota_credito' : 'factura', es_nota_debito: !!m2oId(f.debit_origin_id),
    origen_odoo_id: m2oId(f.debit_origin_id) ?? m2oId(f.reversed_entry_id), proveedor_odoo_id: provDe(m2oId(f.commercial_partner_id)),
    orden_odoo_id: m2oId(f.purchase_id), fecha_emision: f.invoice_date || null, fecha_vencimiento: f.invoice_date_due || null,
    moneda: m2oId(f.currency_id) === 2 ? 'VES' : 'USD', tasa_cambio: f.invoice_currency_rate || null,
    subtotal: round2(f.amount_untaxed), impuesto: round2(f.amount_tax), total: round2(f.amount_total),
    total_usd: round2(-(f.amount_total_signed || 0)), saldo_usd: round2(-(f.amount_residual_signed || 0)),
    estado_pago: estadoPago(f.state, f.payment_state), estado: f.state, nro_control: txt(f.nro_control),
    motivo_anulacion: f.state === 'cancel'
      ? [m2oNombre(f.invoice_cancel_reason_id), txt(f.descripcion_cancel), m2oNombre(f.eu_cancel_motive_id), txt(f.eu_cancel_motive_desc)]
        .filter(Boolean).join(' · ') || null
      : null,
  }));
  const lineasFP = c.lineasFacturaProv.map((l) => ({
    odoo_id: l.id, empresa_id: E, factura_odoo_id: m2oId(l.move_id), tmpl: plantillaDe.get(m2oId(l.product_id)) ?? null,
    nombre_producto: txt(l.name), cantidad: round2(l.quantity), precio_unitario: round2(l.price_unit), descuento: round2(l.discount),
    subtotal: round2(l.price_subtotal), total: round2(l.price_total),
  }));

  const pagos = c.pagosProv.map((p) => ({
    odoo_id: p.id, empresa_id: E, numero: nombreDoc(p.name, p.id), tipo: p.payment_type === 'outbound' ? 'pago' : 'reintegro',
    proveedor_odoo_id: provDe(m2oId(p.partner_id)), banco_odoo_id: m2oId(p.journal_id),
    monto: round2(Math.abs(p.amount_company_currency_signed || 0)), monto_moneda: round2(p.amount),
    moneda: m2oId(p.currency_id) === 2 ? 'BS' : 'USD', estado: estadoPagoProv(p.state), estado_odoo: p.state,
    referencia: txt(p.memo), fecha: p.date, lote_pago: txt(m2oNombre(p.batch_payment_id)),
  }));

  // Retenciones emitidas
  const porRet = (lineas, campo) => { const m = new Map(); for (const l of lineas) { const k = m2oId(l[campo]); if (!m.has(k)) m.set(k, []); m.get(k).push(l); } return m; };
  const lIva = porRet(c.lineasRetIvaProv, 'retention_id');
  const lIslr = porRet(c.lineasRetIslr, 'withholding_id');
  const retenciones = [
    ...c.retIvaProv.map((r) => {
      const ls = lIva.get(r.id) || [];
      return { odoo_model: 'account.wh.iva', odoo_id: r.id, empresa_id: E, tipo: 'iva', numero: txt(r.number) || `IVA-${r.id}`,
        proveedor_odoo_id: provDe(m2oId(r.partner_id)), fecha: r.date || null, periodo: txt(r.period), porcentaje: ls[0]?.rate_amount ?? null,
        base_imponible: round2(ls.reduce((s, l) => s + (l.base_tax || 0), 0)), total: round2(Math.abs(r.total_tax_ret || 0)),
        total_bs: r.total_tax_ret_ref != null ? round2(Math.abs(r.total_tax_ret_ref)) : null, estado: estadoRet(r.state) };
    }),
    ...c.retIslr.map((r) => {
      const ls = lIslr.get(r.id) || [];
      return { odoo_model: 'account.wh.islr', odoo_id: r.id, empresa_id: E, tipo: 'islr', numero: txt(r.number) || txt(r.name) || `ISLR-${r.id}`,
        proveedor_odoo_id: provDe(m2oId(r.partner_id)), fecha: r.date || null, periodo: r.date ? String(r.date).slice(0, 7).replace('-', '/') : null,
        porcentaje: ls[0]?.porc_islr ?? null, base_imponible: round2(ls.reduce((s, l) => s + (l.base_tax || 0), 0)),
        total: round2(ls.reduce((s, l) => s + Math.abs(l.ret_amount || 0), 0)),
        total_bs: round2(ls.reduce((s, l) => s + Math.abs(l.ret_amount_bs || 0), 0)), estado: estadoRet(r.state) };
    }),
  ];
  const itemsRet = [
    ...c.lineasRetIvaProv.map((l) => ({ odoo_model: 'account.wh.iva.line', ret_model: 'account.wh.iva', odoo_id: l.id, empresa_id: E,
      ret_odoo_id: m2oId(l.retention_id), factura_odoo_id: m2oId(l.invoice_id), concepto: null, base_imponible: round2(l.base_tax),
      porcentaje: l.rate_amount ?? null, monto: round2(Math.abs(l.ret_amount || 0)),
      monto_bs: l.ret_amount_ref != null ? round2(Math.abs(l.ret_amount_ref)) : null, sustraendo: null })),
    ...c.lineasRetIslr.map((l) => ({ odoo_model: 'account.wh.islr.line', ret_model: 'account.wh.islr', odoo_id: l.id, empresa_id: E,
      ret_odoo_id: m2oId(l.withholding_id), factura_odoo_id: m2oId(l.invoice_id),
      concepto: [txt(l.code_withholding_islr), txt(l.descripcion)].filter(Boolean).join(' · ') || null, base_imponible: round2(l.base_tax),
      porcentaje: l.porc_islr ?? null, monto: round2(Math.abs(l.ret_amount || 0)), monto_bs: round2(Math.abs(l.ret_amount_bs || 0)),
      sustraendo: l.sus_amount ? round2(l.sus_amount) : null })),
  ];

  // Cómo se saldó cada factura de proveedor (conciliaciones parciales de la empresa)
  const tipoFP = new Map(c.facturasProv.map((f) => [f.id, f.move_type]));
  const pagoPorMov = new Map(c.pagosProv.map((p) => [m2oId(p.move_id), p]));
  const movRet = new Set([...c.retIvaProv.map((r) => m2oId(r.asiento_iva)), ...c.retIslr.map((r) => m2oId(r.asiento_islr))].filter(Boolean));
  const base = [];
  for (const pr of d.parciales) {
    const dm = d.movimientoDeLinea.get(m2oId(pr.debit_move_id));
    const cm = d.movimientoDeLinea.get(m2oId(pr.credit_move_id));
    let fp = null, contra = null;
    if (cm && tipoFP.get(cm) === 'in_invoice') { fp = cm; contra = dm; }
    else if (dm && tipoFP.get(dm) === 'in_refund' && tipoFP.get(cm) !== 'in_invoice') { fp = dm; contra = cm; }
    if (!fp) continue;
    let tipo = 'otro', pago = null, documento = null;
    if (tipoFP.get(contra) === 'in_refund') { tipo = 'nota_credito'; documento = contra; }
    else if (pagoPorMov.has(contra)) { const p = pagoPorMov.get(contra); pago = p.id; tipo = p.payment_type === 'outbound' ? 'pago' : 'reintegro'; }
    else if (movRet.has(contra)) tipo = 'retencion';
    base.push({ odoo_id: pr.id, empresa_id: E, factura_odoo_id: fp, tipo, pago_odoo_id: pago, documento_odoo_id: documento, contra,
      monto_usd: round2(pr.amount), fecha: pr.max_date || null });
  }
  const contras = [...new Set(base.map((a) => a.contra).filter(Boolean))];
  const nombres = new Map();
  for (const lote of lotes(contras, 3000)) {
    for (const m of await odoo.leerTodo('account.move', [['id', 'in', lote]], ['name', 'ref'], { empresa: cid, pagina: 3000 })) {
      nombres.set(m.id, [txt(m.name), txt(m.ref)].filter(Boolean).join(' · ') || null);
    }
  }
  const aplicaciones = base.map(({ contra, ...a }) => ({ ...a, descripcion: nombres.get(contra) ?? null }));

  const resumen = { ordenes_compra: ordenes.length, facturas_proveedor: facturas.length, pagos_proveedor: pagos.length,
    retenciones_emitidas: retenciones.length, aplicaciones_proveedor: aplicaciones.length };
  if (!aplicar) return resumen;

  const prov = (col) => `(select p.id from proveedores p where p.odoo_id = x.${col})`;
  const upsert = async (filas, n, sqlFn) => { for (const lote of lotes(filas, n)) await escribir(sqlFn(jsonbLit(lote))); };
  const limpiar = async (tabla, ids, extra = '') => {
    await sql(`delete from ${tabla} where empresa_id = '${E}' and odoo_id is not null ${extra}
      and odoo_id <> all (array[${ids.join(',') || 0}]::int[])`);
  };

  await upsert(ordenes, 500, (j) => `
    insert into ordenes_compra (odoo_id, empresa_id, numero, referencia_proveedor, proveedor_id, fecha_orden, fecha_prevista, estado,
      estado_recepcion, estado_facturacion, moneda, subtotal, impuesto, total, total_usd, comprador, notas, odoo_sync_at)
    select x.odoo_id, x.empresa_id, x.numero, x.referencia_proveedor, ${prov('proveedor_odoo_id')}, x.fecha_orden, x.fecha_prevista, x.estado,
      x.estado_recepcion, x.estado_facturacion, x.moneda, x.subtotal, x.impuesto, x.total, x.total_usd, x.comprador, x.notas, '${ts}'
    from jsonb_to_recordset(${j}) as x(odoo_id int, empresa_id uuid, numero text, referencia_proveedor text, proveedor_odoo_id int,
      fecha_orden timestamptz, fecha_prevista timestamptz, estado text, estado_recepcion text, estado_facturacion text, moneda text,
      subtotal numeric, impuesto numeric, total numeric, total_usd numeric, comprador text, notas text)
    on conflict (odoo_id) do update set empresa_id = excluded.empresa_id, numero = excluded.numero,
      referencia_proveedor = excluded.referencia_proveedor, proveedor_id = excluded.proveedor_id, fecha_orden = excluded.fecha_orden,
      fecha_prevista = excluded.fecha_prevista, estado = excluded.estado, estado_recepcion = excluded.estado_recepcion,
      estado_facturacion = excluded.estado_facturacion, moneda = excluded.moneda, subtotal = excluded.subtotal,
      impuesto = excluded.impuesto, total = excluded.total, total_usd = excluded.total_usd, comprador = excluded.comprador,
      notas = excluded.notas, odoo_sync_at = excluded.odoo_sync_at
    where (ordenes_compra.numero, ordenes_compra.referencia_proveedor, ordenes_compra.proveedor_id, ordenes_compra.fecha_orden,
      ordenes_compra.fecha_prevista, ordenes_compra.estado, ordenes_compra.estado_recepcion, ordenes_compra.estado_facturacion,
      ordenes_compra.moneda, ordenes_compra.subtotal, ordenes_compra.impuesto, ordenes_compra.total, ordenes_compra.total_usd,
      ordenes_compra.comprador, ordenes_compra.notas)
    is distinct from (excluded.numero, excluded.referencia_proveedor, excluded.proveedor_id, excluded.fecha_orden, excluded.fecha_prevista,
      excluded.estado, excluded.estado_recepcion, excluded.estado_facturacion, excluded.moneda, excluded.subtotal, excluded.impuesto,
      excluded.total, excluded.total_usd, excluded.comprador, excluded.notas)`);
  await upsert(lineasOC, 1000, (j) => `
    insert into orden_compra_items (odoo_id, empresa_id, orden_compra_id, producto_id, nombre_producto, cantidad, cantidad_recibida,
      cantidad_facturada, precio_unitario, subtotal)
    select x.odoo_id, x.empresa_id, o.id, (select p.id from productos p where p.odoo_id = x.tmpl), x.nombre_producto, x.cantidad,
      x.cantidad_recibida, x.cantidad_facturada, x.precio_unitario, x.subtotal
    from jsonb_to_recordset(${j}) as x(odoo_id int, empresa_id uuid, orden_odoo_id int, tmpl int, nombre_producto text, cantidad numeric,
      cantidad_recibida numeric, cantidad_facturada numeric, precio_unitario numeric, subtotal numeric)
    join ordenes_compra o on o.odoo_id = x.orden_odoo_id
    on conflict (odoo_id) do update set orden_compra_id = excluded.orden_compra_id, producto_id = excluded.producto_id,
      nombre_producto = excluded.nombre_producto, cantidad = excluded.cantidad, cantidad_recibida = excluded.cantidad_recibida,
      cantidad_facturada = excluded.cantidad_facturada, precio_unitario = excluded.precio_unitario, subtotal = excluded.subtotal
    where (orden_compra_items.orden_compra_id, orden_compra_items.producto_id, orden_compra_items.nombre_producto, orden_compra_items.cantidad,
      orden_compra_items.cantidad_recibida, orden_compra_items.cantidad_facturada, orden_compra_items.precio_unitario, orden_compra_items.subtotal)
    is distinct from (excluded.orden_compra_id, excluded.producto_id, excluded.nombre_producto, excluded.cantidad, excluded.cantidad_recibida,
      excluded.cantidad_facturada, excluded.precio_unitario, excluded.subtotal)`);

  await upsert(facturas, 500, (j) => `
    insert into facturas_proveedor (odoo_id, empresa_id, numero, referencia, tipo, es_nota_debito, proveedor_id, orden_compra_id,
      fecha_emision, fecha_vencimiento, moneda, tasa_cambio, subtotal, impuesto, total, total_usd, saldo_usd, estado_pago, estado,
      nro_control, motivo_anulacion, odoo_sync_at)
    select x.odoo_id, x.empresa_id, x.numero, x.referencia, x.tipo, x.es_nota_debito, ${prov('proveedor_odoo_id')},
      (select o.id from ordenes_compra o where o.odoo_id = x.orden_odoo_id), x.fecha_emision, x.fecha_vencimiento, x.moneda, x.tasa_cambio,
      x.subtotal, x.impuesto, x.total, x.total_usd, x.saldo_usd, x.estado_pago, x.estado, x.nro_control, x.motivo_anulacion, '${ts}'
    from jsonb_to_recordset(${j}) as x(odoo_id int, empresa_id uuid, numero text, referencia text, tipo text, es_nota_debito boolean,
      proveedor_odoo_id int, orden_odoo_id int, fecha_emision date, fecha_vencimiento date, moneda text, tasa_cambio numeric,
      subtotal numeric, impuesto numeric, total numeric, total_usd numeric, saldo_usd numeric, estado_pago text, estado text,
      nro_control text, motivo_anulacion text)
    on conflict (odoo_id) do update set empresa_id = excluded.empresa_id, numero = excluded.numero, referencia = excluded.referencia,
      tipo = excluded.tipo, es_nota_debito = excluded.es_nota_debito, proveedor_id = excluded.proveedor_id,
      orden_compra_id = excluded.orden_compra_id, fecha_emision = excluded.fecha_emision, fecha_vencimiento = excluded.fecha_vencimiento,
      moneda = excluded.moneda, tasa_cambio = excluded.tasa_cambio, subtotal = excluded.subtotal, impuesto = excluded.impuesto,
      total = excluded.total, total_usd = excluded.total_usd, saldo_usd = excluded.saldo_usd, estado_pago = excluded.estado_pago,
      estado = excluded.estado, nro_control = excluded.nro_control, motivo_anulacion = excluded.motivo_anulacion,
      odoo_sync_at = excluded.odoo_sync_at
    where (facturas_proveedor.numero, facturas_proveedor.referencia, facturas_proveedor.tipo, facturas_proveedor.es_nota_debito,
      facturas_proveedor.proveedor_id, facturas_proveedor.orden_compra_id, facturas_proveedor.fecha_emision,
      facturas_proveedor.fecha_vencimiento, facturas_proveedor.moneda, facturas_proveedor.tasa_cambio, facturas_proveedor.subtotal,
      facturas_proveedor.impuesto, facturas_proveedor.total, facturas_proveedor.total_usd, facturas_proveedor.saldo_usd,
      facturas_proveedor.estado_pago, facturas_proveedor.estado, facturas_proveedor.nro_control, facturas_proveedor.motivo_anulacion)
    is distinct from (excluded.numero, excluded.referencia, excluded.tipo, excluded.es_nota_debito, excluded.proveedor_id,
      excluded.orden_compra_id, excluded.fecha_emision, excluded.fecha_vencimiento, excluded.moneda, excluded.tasa_cambio,
      excluded.subtotal, excluded.impuesto, excluded.total, excluded.total_usd, excluded.saldo_usd, excluded.estado_pago,
      excluded.estado, excluded.nro_control, excluded.motivo_anulacion)`);
  const conOrigen = facturas.filter((f) => f.origen_odoo_id).map((f) => ({ odoo_id: f.odoo_id, origen: f.origen_odoo_id }));
  if (conOrigen.length) {
    await escribir(`
      update facturas_proveedor f set factura_origen_id = o.id
      from jsonb_to_recordset(${jsonbLit(conOrigen)}) as x(odoo_id int, origen int) join facturas_proveedor o on o.odoo_id = x.origen
      where f.odoo_id = x.odoo_id and f.factura_origen_id is distinct from o.id`);
  }
  await upsert(lineasFP, 1000, (j) => `
    insert into factura_proveedor_items (odoo_id, empresa_id, factura_proveedor_id, producto_id, nombre_producto, cantidad,
      precio_unitario, descuento, subtotal, total)
    select x.odoo_id, x.empresa_id, f.id, (select p.id from productos p where p.odoo_id = x.tmpl), x.nombre_producto, x.cantidad,
      x.precio_unitario, x.descuento, x.subtotal, x.total
    from jsonb_to_recordset(${j}) as x(odoo_id int, empresa_id uuid, factura_odoo_id int, tmpl int, nombre_producto text, cantidad numeric,
      precio_unitario numeric, descuento numeric, subtotal numeric, total numeric)
    join facturas_proveedor f on f.odoo_id = x.factura_odoo_id
    on conflict (odoo_id) do update set factura_proveedor_id = excluded.factura_proveedor_id, producto_id = excluded.producto_id,
      nombre_producto = excluded.nombre_producto, cantidad = excluded.cantidad, precio_unitario = excluded.precio_unitario,
      descuento = excluded.descuento, subtotal = excluded.subtotal, total = excluded.total
    where (factura_proveedor_items.factura_proveedor_id, factura_proveedor_items.producto_id, factura_proveedor_items.nombre_producto,
      factura_proveedor_items.cantidad, factura_proveedor_items.precio_unitario, factura_proveedor_items.descuento,
      factura_proveedor_items.subtotal, factura_proveedor_items.total)
    is distinct from (excluded.factura_proveedor_id, excluded.producto_id, excluded.nombre_producto, excluded.cantidad,
      excluded.precio_unitario, excluded.descuento, excluded.subtotal, excluded.total)`);

  await upsert(pagos, 800, (j) => `
    insert into pagos_proveedor (odoo_id, empresa_id, numero, tipo, proveedor_id, banco_id, monto, monto_moneda, moneda, estado,
      estado_odoo, referencia, fecha, lote_pago, odoo_sync_at)
    select x.odoo_id, x.empresa_id, x.numero, x.tipo, ${prov('proveedor_odoo_id')}, (select b.id from bancos b where b.odoo_id = x.banco_odoo_id),
      x.monto, x.monto_moneda, x.moneda, x.estado, x.estado_odoo, x.referencia, x.fecha, x.lote_pago, '${ts}'
    from jsonb_to_recordset(${j}) as x(odoo_id int, empresa_id uuid, numero text, tipo text, proveedor_odoo_id int, banco_odoo_id int,
      monto numeric, monto_moneda numeric, moneda text, estado text, estado_odoo text, referencia text, fecha date, lote_pago text)
    on conflict (odoo_id) do update set empresa_id = excluded.empresa_id, numero = excluded.numero, tipo = excluded.tipo,
      proveedor_id = excluded.proveedor_id, banco_id = excluded.banco_id, monto = excluded.monto, monto_moneda = excluded.monto_moneda,
      moneda = excluded.moneda, estado = excluded.estado, estado_odoo = excluded.estado_odoo, referencia = excluded.referencia,
      fecha = excluded.fecha, lote_pago = excluded.lote_pago, odoo_sync_at = excluded.odoo_sync_at
    where (pagos_proveedor.numero, pagos_proveedor.tipo, pagos_proveedor.proveedor_id, pagos_proveedor.banco_id, pagos_proveedor.monto,
      pagos_proveedor.monto_moneda, pagos_proveedor.moneda, pagos_proveedor.estado, pagos_proveedor.estado_odoo, pagos_proveedor.referencia,
      pagos_proveedor.fecha, pagos_proveedor.lote_pago)
    is distinct from (excluded.numero, excluded.tipo, excluded.proveedor_id, excluded.banco_id, excluded.monto, excluded.monto_moneda,
      excluded.moneda, excluded.estado, excluded.estado_odoo, excluded.referencia, excluded.fecha, excluded.lote_pago)`);

  await upsert(retenciones, 500, (j) => `
    insert into retenciones_emitidas (odoo_model, odoo_id, empresa_id, tipo, numero, proveedor_id, fecha, periodo, porcentaje, base_imponible,
      total, total_bs, estado, odoo_sync_at)
    select x.odoo_model, x.odoo_id, x.empresa_id, x.tipo, x.numero, ${prov('proveedor_odoo_id')}, x.fecha, x.periodo, x.porcentaje,
      x.base_imponible, x.total, x.total_bs, x.estado, '${ts}'
    from jsonb_to_recordset(${j}) as x(odoo_model text, odoo_id int, empresa_id uuid, tipo text, numero text, proveedor_odoo_id int,
      fecha date, periodo text, porcentaje numeric, base_imponible numeric, total numeric, total_bs numeric, estado text)
    on conflict (odoo_model, odoo_id) do update set empresa_id = excluded.empresa_id, tipo = excluded.tipo, numero = excluded.numero,
      proveedor_id = excluded.proveedor_id, fecha = excluded.fecha, periodo = excluded.periodo, porcentaje = excluded.porcentaje,
      base_imponible = excluded.base_imponible, total = excluded.total, total_bs = excluded.total_bs, estado = excluded.estado,
      odoo_sync_at = excluded.odoo_sync_at
    where (retenciones_emitidas.numero, retenciones_emitidas.proveedor_id, retenciones_emitidas.fecha, retenciones_emitidas.periodo,
      retenciones_emitidas.porcentaje, retenciones_emitidas.base_imponible, retenciones_emitidas.total, retenciones_emitidas.total_bs,
      retenciones_emitidas.estado)
    is distinct from (excluded.numero, excluded.proveedor_id, excluded.fecha, excluded.periodo, excluded.porcentaje,
      excluded.base_imponible, excluded.total, excluded.total_bs, excluded.estado)`);
  await upsert(itemsRet, 1000, (j) => `
    insert into retencion_emitida_items (odoo_model, odoo_id, empresa_id, retencion_id, factura_proveedor_id, concepto, base_imponible,
      porcentaje, monto, monto_bs, sustraendo)
    select x.odoo_model, x.odoo_id, x.empresa_id, r.id, (select f.id from facturas_proveedor f where f.odoo_id = x.factura_odoo_id),
      x.concepto, x.base_imponible, x.porcentaje, x.monto, x.monto_bs, x.sustraendo
    from jsonb_to_recordset(${j}) as x(odoo_model text, ret_model text, odoo_id int, empresa_id uuid, ret_odoo_id int, factura_odoo_id int,
      concepto text, base_imponible numeric, porcentaje numeric, monto numeric, monto_bs numeric, sustraendo numeric)
    join retenciones_emitidas r on r.odoo_model = x.ret_model and r.odoo_id = x.ret_odoo_id
    on conflict (odoo_model, odoo_id) do update set retencion_id = excluded.retencion_id, factura_proveedor_id = excluded.factura_proveedor_id,
      concepto = excluded.concepto, base_imponible = excluded.base_imponible, porcentaje = excluded.porcentaje, monto = excluded.monto,
      monto_bs = excluded.monto_bs, sustraendo = excluded.sustraendo
    where (retencion_emitida_items.retencion_id, retencion_emitida_items.factura_proveedor_id, retencion_emitida_items.concepto,
      retencion_emitida_items.base_imponible, retencion_emitida_items.porcentaje, retencion_emitida_items.monto,
      retencion_emitida_items.monto_bs, retencion_emitida_items.sustraendo)
    is distinct from (excluded.retencion_id, excluded.factura_proveedor_id, excluded.concepto, excluded.base_imponible,
      excluded.porcentaje, excluded.monto, excluded.monto_bs, excluded.sustraendo)`);

  await upsert(aplicaciones, 1000, (j) => `
    insert into factura_proveedor_aplicaciones (odoo_id, empresa_id, factura_proveedor_id, tipo, pago_proveedor_id, documento_id,
      descripcion, monto_usd, fecha, odoo_sync_at)
    select x.odoo_id, x.empresa_id, f.id, x.tipo, (select p.id from pagos_proveedor p where p.odoo_id = x.pago_odoo_id),
      (select d.id from facturas_proveedor d where d.odoo_id = x.documento_odoo_id), x.descripcion, x.monto_usd, x.fecha, '${ts}'
    from jsonb_to_recordset(${j}) as x(odoo_id int, empresa_id uuid, factura_odoo_id int, tipo text, pago_odoo_id int, documento_odoo_id int,
      descripcion text, monto_usd numeric, fecha date)
    join facturas_proveedor f on f.odoo_id = x.factura_odoo_id
    on conflict (odoo_id) do update set factura_proveedor_id = excluded.factura_proveedor_id, tipo = excluded.tipo,
      pago_proveedor_id = excluded.pago_proveedor_id, documento_id = excluded.documento_id, descripcion = excluded.descripcion,
      monto_usd = excluded.monto_usd, fecha = excluded.fecha, odoo_sync_at = excluded.odoo_sync_at
    where (factura_proveedor_aplicaciones.factura_proveedor_id, factura_proveedor_aplicaciones.tipo,
      factura_proveedor_aplicaciones.pago_proveedor_id, factura_proveedor_aplicaciones.documento_id,
      factura_proveedor_aplicaciones.descripcion, factura_proveedor_aplicaciones.monto_usd, factura_proveedor_aplicaciones.fecha)
    is distinct from (excluded.factura_proveedor_id, excluded.tipo, excluded.pago_proveedor_id, excluded.documento_id,
      excluded.descripcion, excluded.monto_usd, excluded.fecha)`);

  // Lo que ya no viene de Odoo (sin modo réplica: los ON DELETE CASCADE limpian los hijos)
  await limpiar('factura_proveedor_aplicaciones', aplicaciones.map((a) => a.odoo_id));
  await limpiar('orden_compra_items', lineasOC.map((l) => l.odoo_id));
  await limpiar('factura_proveedor_items', lineasFP.map((l) => l.odoo_id));
  await limpiar('retencion_emitida_items', itemsRet.filter((i) => i.odoo_model === 'account.wh.iva.line').map((i) => i.odoo_id), `and odoo_model = 'account.wh.iva.line'`);
  await limpiar('retencion_emitida_items', itemsRet.filter((i) => i.odoo_model === 'account.wh.islr.line').map((i) => i.odoo_id), `and odoo_model = 'account.wh.islr.line'`);
  await limpiar('retenciones_emitidas', retenciones.filter((r) => r.odoo_model === 'account.wh.iva').map((r) => r.odoo_id), `and odoo_model = 'account.wh.iva'`);
  await limpiar('retenciones_emitidas', retenciones.filter((r) => r.odoo_model === 'account.wh.islr').map((r) => r.odoo_id), `and odoo_model = 'account.wh.islr'`);
  await limpiar('pagos_proveedor', pagos.map((p) => p.odoo_id));
  await limpiar('facturas_proveedor', facturas.map((f) => f.odoo_id));
  await limpiar('ordenes_compra', ordenes.map((o) => o.odoo_id));
  return resumen;
}
