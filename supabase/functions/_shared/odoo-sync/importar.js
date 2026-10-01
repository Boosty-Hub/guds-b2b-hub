// Importador Odoo → GUDS (espejo). docs/PLAN-ESPEJO-ODOO.md, Fase 2.
//
// - Lee Odoo en SOLO LECTURA por la API, empresa por empresa (GUDS SUPPLY y QUIRUTEC).
// - Escribe en Supabase con upserts idempotentes por odoo_id: conserva los uuid de GUDS y solo toca filas
//   que cambiaron. Los campos que administra GUDS (ofertas, método de pago corregido a mano,
//   aplicaciones de cobros/retenciones hechas en GUDS…) no se pisan.
// - Las escrituras masivas van con session_replication_role = replica: no disparan triggers
//   (notificaciones, reposición de stock, recálculos). Lo derivado se recalcula explícitamente al final.
//   OJO: en modo réplica tampoco corren los ON DELETE CASCADE, por eso los borrados con hijos van aparte.
//
// Uso: importarOdoo({ odoo, sql, aplicar, log }) — `sql(query)` ejecuta SQL como rol postgres y devuelve filas.

import { m2oId, m2oNombre } from './odoo.js';
import { round2, stripHtml, txt, norm, jsonbLit, lotes, aUsd, fechaOdoo } from './util.js';
import { leerCompras, proveedoresReferenciados, escribirCompras } from './compras.js';
import { leerInventario, lotesReferenciados, clientesPorEntregas, escribirInventario, CAMPOS_LOTE } from './inventario.js';
import { leerTesoreria, escribirTesoreria } from './tesoreria.js';
import { sincronizarContenidoProductos } from './contenido-productos.js';
import { leerContactosOdoo, escribirContactos } from './contactos.js';

// Documento sin número en Odoo (borrador o anulado antes de publicarse: name vacío o '/')
const nombreDoc = (name, id, max = null) => (name && name !== '/' ? txt(name, max) : `ODOO-${id}`);
const esConsignacion = (w) => /consignado|consginado/i.test(w.name || '') || /^C-/i.test(w.code || '');
const monedaBanco = (curId) => (curId === 2 ? 'BS' : 'USD');          // 2 = VED; sin moneda = moneda de la empresa (USD)
const monedaFactura = (curId) => (curId === 2 ? 'VES' : 'USD');
// Diarios de notas de débito de clientes en Odoo ("Nota debito cliente", "Nota de Debito de Contingencia", "ND CxC Saldos Iniciales")
const RE_DIARIO_ND = /nota\s+(de\s+)?d[eé]bito|^nd\s/i;
const CAMPOS_CLIENTE = ['name', 'vat', 'rif', 'cedula', 'email', 'phone', 'mobile', 'street', 'street2', 'city', 'state_id',
  'partner_latitude', 'partner_longitude', 'is_company', 'residence_type', 'user_id', 'property_payment_term_id',
  'credit_limit', 'credit_limit_value', 'econ_act_license', 'website', 'comment', 'create_date', 'active', 'company_id', 'write_date',
  'property_product_pricelist',
  // Clasificación comercial (R2 · 20q): tipo de cliente = Industria; canal y segmento del contacto; etiquetas
  'industry_id', 'eu_partner_channel_id', 'eu_partner_segment_id', 'channel', 'segmentation', 'category_id'];
// Reglas de listas de precios (fase 20a)
const CAMPOS_REGLA = ['pricelist_id', 'applied_on', 'product_tmpl_id', 'product_id', 'categ_id', 'compute_price', 'fixed_price',
  'percent_price', 'price_discount', 'price_surcharge', 'base', 'min_quantity', 'date_start', 'date_end'];
const CAMPOS_PROVEEDOR = ['name', 'vat', 'rif', 'cedula', 'email', 'phone', 'mobile', 'street', 'street2', 'city', 'state_id',
  'is_company', 'residence_type', 'property_supplier_payment_term_id', 'website', 'comment', 'active', 'company_id', 'write_date'];
const RESIDENCIA = { D: 'Domiciliado', R: 'Residente', NR: 'No residente', ND: 'No domiciliado' };

// Datos de la cuenta bancaria de cada diario (número, banco, titular y RIF) para publicarlos a los clientes (19l)
async function leerCuentasBanco(odoo, diarios, cid) {
  const ids = [...new Set(diarios.map((j) => m2oId(j.bank_account_id)).filter(Boolean))];
  if (!ids.length) return new Map();
  const cuentas = await odoo.leer('res.partner.bank', 'read', [ids], { fields: ['acc_number', 'bank_id', 'partner_id', 'acc_holder_name'] }, cid);
  const titulares = [...new Set(cuentas.map((c) => m2oId(c.partner_id)).filter(Boolean))];
  const rif = new Map((titulares.length ? await odoo.leer('res.partner', 'read', [titulares], { fields: ['vat'] }, cid) : [])
    .map((x) => [x.id, txt(x.vat)]));
  return new Map(cuentas.map((c) => [c.id, {
    numero_cuenta: txt(c.acc_number), banco_nombre: m2oNombre(c.bank_id),
    titular: txt(c.acc_holder_name) || m2oNombre(c.partner_id), documento: rif.get(m2oId(c.partner_id)) || null,
  }]));
}

function estadoOrden(state, delivery) {
  if (state === 'cancel') return 'cancelado';
  if (state === 'draft' || state === 'sent') return 'pendiente';
  if (delivery === 'full') return 'completado';
  if (delivery === 'partial' || delivery === 'started') return 'enviado';
  if (delivery === 'pending') return 'procesando';
  return 'confirmado';
}
function estadoPagoFactura(state, ps) {
  if (state === 'cancel') return 'anulado';
  // "En pago" en Odoo = pagada por completo, con el cobro aún sin conciliar con el banco (saldo 0): para GUDS está pagada
  if (ps === 'paid' || ps === 'in_payment') return 'pagado';
  if (ps === 'partial') return 'parcial';
  if (ps === 'reversed') return 'anulado';
  return 'pendiente';
}
const estadoCobro = (s) => (s === 'paid' || s === 'in_process' ? 'verificado' : s === 'draft' ? 'pendiente' : 'rechazado');
const estadoRetencion = (s) => (s === 'cancel' ? 'rechazado' : s === 'draft' ? 'pendiente' : 'aprobado');

// Cliente de un almacén de consignación al sincronizar: el vínculo manual de GUDS se respeta; si no, el que se identificó en
// Odoo (por nombre o por entregas); si no se identificó, se conserva el anterior solo si es de la misma empresa (o compartido).
const CLIENTE_PREVIO = `(select c2.id from clientes c2 where c2.id = almacenes.cliente_id and (c2.empresa_id is null or c2.empresa_id = excluded.empresa_id))`;
const CLIENTE_ALMACEN = `case when almacenes.vinculo_cliente = 'manual' then almacenes.cliente_id else coalesce(excluded.cliente_id, ${CLIENTE_PREVIO}) end`;
const VINCULO_ALMACEN = `case when almacenes.vinculo_cliente = 'manual' then 'manual' when excluded.cliente_id is not null then excluded.vinculo_cliente
  when ${CLIENTE_PREVIO} is not null then almacenes.vinculo_cliente end`;

// `storage` (opcional, storage.js): para subir al bucket las fotos de producto que cambian en Odoo (20r).
export async function importarOdoo({ odoo, sql, aplicar = false, log = console.log, origen = 'script', storage = null }) {
  const t0 = Date.now();
  const ts = new Date().toISOString();
  const resumen = { entidades: {}, avisos: [] };
  const aviso = (m) => { resumen.avisos.push(m); log(`  ⚠ ${m}`); };
  const marca = (entidad, empresaId, registros) => {
    const max = registros.reduce((m, r) => (r.write_date && r.write_date > m ? r.write_date : m), '');
    return { entidad, empresa_id: empresaId, ultima_marca: max ? fechaOdoo(max) : null, registros: registros.length };
  };
  const marcas = [];

  // Escritura masiva sin triggers (ver cabecera)
  const escribir = (cuerpo) => sql(`begin; set local session_replication_role = replica; ${cuerpo}; commit;`);

  await odoo.autenticar();
  const empresas = await sql(`select id, odoo_company_id, nombre_corto from empresas where activo and odoo_company_id is not null order by orden`);
  const uuidEmpresa = Object.fromEntries(empresas.map((e) => [e.odoo_company_id, e.id]));
  log(`Empresas: ${empresas.map((e) => `${e.nombre_corto} (Odoo ${e.odoo_company_id})`).join(', ')} · ${aplicar ? 'APLICAR' : 'SIMULACIÓN'}`);

  let corridaId = null;
  if (aplicar) {
    corridaId = (await sql(`insert into sync_corridas (modo, origen) values ('completo', '${origen}') returning id`))[0].id;
  }

  try {
    // ── 1. Mapas globales ────────────────────────────────────────────────
    log('\n[1] Mapas globales de Odoo…');
    const partners = await odoo.leerTodo('res.partner', [], ['commercial_partner_id']);
    const comercial = new Map(partners.map((p) => [p.id, m2oId(p.commercial_partner_id) ?? p.id]));
    const variantes = await odoo.leerTodo('product.product', [], ['product_tmpl_id', 'default_code']);
    const plantillaDe = new Map(variantes.map((v) => [v.id, m2oId(v.product_tmpl_id)]));
    const ubicaciones = await odoo.leerTodo('stock.location', [['usage', '=', 'internal']], ['warehouse_id']);
    const almacenDe = new Map(ubicaciones.map((l) => [l.id, m2oId(l.warehouse_id)]));
    const plazos = await odoo.leerTodo('account.payment.term', [], ['name', 'line_ids']);
    const lineasPlazo = await odoo.leerTodo('account.payment.term.line', [], ['nb_days', 'payment_id']);
    const diasPlazo = new Map();
    for (const l of lineasPlazo) {
      const t = m2oId(l.payment_id);
      diasPlazo.set(t, Math.max(diasPlazo.get(t) ?? 0, l.nb_days || 0));
    }
    const nombrePlazo = new Map(plazos.map((p) => [p.id, typeof p.name === 'object' ? (p.name.es_VE || p.name.en_US) : p.name]));
    // Etiquetas de contacto de Odoo (clasificación de clientes, R2 · 20q)
    const etiquetaCliente = new Map((await odoo.leerTodo('res.partner.category', [], ['name']))
      .map((t) => [t.id, txt(typeof t.name === 'object' ? (t.name.es_VE || t.name.en_US) : t.name)]));
    // Vendedores de Odoo (res.users) → usuarios de GUDS por nombre
    const usuariosGuds = await sql(`select id, nombre, apellido from usuarios where coalesce(activo, true)`);
    const usuarioPorNombre = new Map();
    for (const u of usuariosGuds) {
      usuarioPorNombre.set(norm(`${u.nombre} ${u.apellido || ''}`), u.id);
      if (!usuarioPorNombre.has(norm(u.nombre))) usuarioPorNombre.set(norm(u.nombre), u.id);
    }
    const usuariosOdoo = await odoo.leerTodo('res.users', [['share', '=', false]], ['name']);
    const vendedorGuds = new Map(usuariosOdoo.map((u) => [u.id, usuarioPorNombre.get(norm(u.name)) ?? null]));
    log(`    ${partners.length} contactos · ${variantes.length} variantes · ${ubicaciones.length} ubicaciones · ${usuariosOdoo.length} usuarios Odoo (${[...vendedorGuds.values()].filter(Boolean).length} ligados a GUDS)`);

    // ── 2. Lectura por empresa ───────────────────────────────────────────
    const datos = [];
    for (const [i, emp] of empresas.entries()) {
      const cid = emp.odoo_company_id;
      // Los registros compartidos (company_id vacío) se leen una sola vez, con la primera empresa
      const deEmpresa = i === 0 ? ['|', ['company_id', '=', cid], ['company_id', '=', false]] : [['company_id', '=', cid]];
      log(`\n[2] Leyendo ${emp.nombre_corto}…`);
      const d = { emp, cid };
      d.diarios = await odoo.leerTodo('account.journal', [['type', 'in', ['bank', 'cash']], ['company_id', '=', cid]],
        ['name', 'type', 'currency_id', 'active', 'default_account_id', 'bank_acc_number', 'bank_account_id', 'current_statement_balance', 'write_date'], { empresa: cid });
      d.cuentasBanco = await leerCuentasBanco(odoo, d.diarios, cid);
      d.clientes = await odoo.leerTodo('res.partner', [['customer_rank', '>', 0], ...deEmpresa], CAMPOS_CLIENTE, { empresa: cid });
      d.proveedores = await odoo.leerTodo('res.partner', [['supplier_rank', '>', 0], ...deEmpresa], CAMPOS_PROVEEDOR, { empresa: cid });
      d.productos = await odoo.leerTodo('product.template', deEmpresa,
        ['name', 'default_code', 'categ_id', 'uom_id', 'type', 'is_storable', 'sale_ok', 'active', 'company_id', 'taxes_id', 'write_date',
          'standard_price', 'product_brand_id'], { empresa: cid });
      // Costo promedio (standard_price depende de la empresa, fase 20j): los productos compartidos se leen con la primera
      // empresa; en las demás se lee aparte su costo con el contexto de cada una
      d.costosCompartidos = i > 0 ? await odoo.leerTodo('product.template', [['company_id', '=', false]], ['standard_price'], { empresa: cid }) : [];
      // Impuestos de venta de la empresa (el IVA de cada producto) y listas de precios con sus reglas (fase 20a)
      d.impuestos = await odoo.leerTodo('account.tax', [['type_tax_use', '=', 'sale'], ['company_id', '=', cid]],
        ['name', 'amount', 'amount_type', 'price_include'], { empresa: cid });
      d.listas = await odoo.leerTodo('product.pricelist', ['|', ['company_id', '=', cid], ['company_id', '=', false]],
        ['name', 'currency_id', 'company_id', 'active'], { empresa: cid });
      d.reglas = d.listas.length ? await odoo.leerTodo('product.pricelist.item', [['pricelist_id', 'in', d.listas.map((l) => l.id)]], CAMPOS_REGLA, { empresa: cid }) : [];
      d.almacenes = await odoo.leerTodo('stock.warehouse', [['company_id', '=', cid]], ['name', 'code', 'active', 'write_date'], { empresa: cid });
      d.quants = await odoo.leerTodo('stock.quant', [['location_id.usage', '=', 'internal'], ['company_id', '=', cid]],
        ['product_id', 'location_id', 'lot_id', 'quantity', 'reserved_quantity', 'in_date', 'write_date'], { empresa: cid });
      d.ordenes = await odoo.leerTodo('sale.order', [['company_id', '=', cid]],
        ['name', 'partner_id', 'state', 'delivery_status', 'date_order', 'amount_untaxed', 'amount_tax', 'amount_total',
          'currency_id', 'ref_currency_id', 'amount_total_ref', 'user_id', 'note', 'write_date'], { empresa: cid });
      d.lineas = await odoo.leerTodo('sale.order.line', [['company_id', '=', cid], ['display_type', '=', false]],
        ['order_id', 'product_id', 'name', 'product_uom_qty', 'discount', 'price_unit', 'price_subtotal',
          'price_unit_ref', 'price_subtotal_ref', 'tax_id', 'write_date'], { empresa: cid });
      d.facturas = await odoo.leerTodo('account.move',
        [['move_type', 'in', ['out_invoice', 'out_refund']], ['state', 'in', ['posted', 'cancel']], ['company_id', '=', cid]],
        ['name', 'move_type', 'state', 'invoice_date', 'invoice_date_due', 'commercial_partner_id', 'currency_id',
          'invoice_currency_rate', 'amount_untaxed', 'amount_tax', 'amount_total', 'amount_residual', 'amount_total_signed',
          'amount_residual_signed', 'payment_state', 'ref', 'nro_control', 'invoice_user_id', 'debit_origin_id',
          'reversed_entry_id', 'sale_id', 'invoice_cancel_reason_id', 'descripcion_cancel', 'eu_cancel_motive_id',
          'eu_cancel_motive_desc', 'motivos', 'journal_id', 'write_date'], { empresa: cid });
      d.lineasFactura = await odoo.leerTodo('account.move.line',
        [['display_type', '=', 'product'], ['company_id', '=', cid],
          ['move_id.move_type', 'in', ['out_invoice', 'out_refund']], ['move_id.state', 'in', ['posted', 'cancel']]],
        ['move_id', 'name', 'quantity', 'price_unit', 'price_subtotal', 'price_total', 'discount', 'product_id', 'write_date'], { empresa: cid });
      d.pagos = await odoo.leerTodo('account.payment',
        [['payment_type', '=', 'inbound'], ['partner_type', '=', 'customer'], ['company_id', '=', cid]],
        ['name', 'partner_id', 'amount', 'currency_id', 'date', 'journal_id', 'state', 'memo', 'is_igtf_payment', 'pago_igtf_origen',
          'batch_payment_id', 'amount_company_currency_signed', 'move_id', 'write_date'], { empresa: cid });
      d.reintegros = await odoo.leerTodo('account.payment',
        [['payment_type', '=', 'outbound'], ['partner_type', '=', 'customer'], ['company_id', '=', cid]],
        ['name', 'partner_id', 'amount', 'currency_id', 'date', 'journal_id', 'state', 'memo',
          'amount_company_currency_signed', 'move_id', 'write_date'], { empresa: cid });
      d.retenciones = await odoo.leerTodo('account.wh.iva',
        [['move_type', 'in', ['out_invoice', 'out_refund']], ['company_id', '=', cid]],
        ['state', 'number', 'customer_doc_number', 'date', 'partner_id', 'total_tax_ret', 'asiento_iva', 'write_date'], { empresa: cid });
      d.lineasRetencion = d.retenciones.length
        ? await odoo.leerTodo('account.wh.iva.line', [['retention_id', 'in', d.retenciones.map((r) => r.id)]],
          ['retention_id', 'invoice_id', 'base_tax', 'rate_amount', 'ret_amount', 'asiento_iva_in_line', 'write_date'], { empresa: cid })
        : [];
      // Retención municipal que hacen los clientes (en Odoo se registra con el módulo "Responsabilidad Social")
      d.municipales = await odoo.leerTodo('base.retenciones',
        [['tipo_retencion', '=', 'res_social'], ['move_type', '=', 'out_invoice'], ['company_id', '=', cid]],
        ['name', 'move_id', 'partner_id', 'amount', 'percentage', 'monto_retenido', 'communication', 'state', 'create_date',
          'asiento_retencion', 'write_date'], { empresa: cid });
      // Conciliaciones: qué documento saldó qué factura
      d.parciales = await odoo.leerTodo('account.partial.reconcile', [['company_id', '=', cid]],
        ['debit_move_id', 'credit_move_id', 'amount', 'max_date', 'write_date'], { empresa: cid });
      const idsLineas = [...new Set(d.parciales.flatMap((p) => [m2oId(p.debit_move_id), m2oId(p.credit_move_id)]).filter(Boolean))];
      d.movimientoDeLinea = new Map();
      for (const lote of lotes(idsLineas, 3000)) {
        for (const l of await odoo.leerTodo('account.move.line', [['id', 'in', lote]], ['move_id'], { empresa: cid, pagina: 3000 })) {
          d.movimientoDeLinea.set(l.id, m2oId(l.move_id));
        }
      }
      d.compras = await leerCompras(odoo, cid);
      d.inv = await leerInventario(odoo, cid, deEmpresa);
      d.tes = await leerTesoreria(odoo, cid, d.diarios);
      const lotesFaltan = lotesReferenciados(d.inv, d.quants);
      if (lotesFaltan.length) d.inv.lotes.push(...await odoo.leerTodo('stock.lot', [['id', 'in', lotesFaltan]], CAMPOS_LOTE, { empresa: cid }));
      log(`    ${d.clientes.length} clientes · ${d.productos.length} productos · ${d.almacenes.length} almacenes · ${d.quants.length} quants · ${d.ordenes.length} órdenes/${d.lineas.length} líneas · ${d.facturas.length} facturas/${d.lineasFactura.length} líneas · ${d.pagos.length} cobros · ${d.reintegros.length} reintegros · ${d.retenciones.length} ret. IVA · ${d.municipales.length} ret. municipales · ${d.parciales.length} conciliaciones · compras: ${d.compras.ordenesCompra.length} OC, ${d.compras.facturasProv.length} facturas prov., ${d.compras.pagosProv.length} pagos prov., ${d.compras.retIvaProv.length + d.compras.retIslr.length} ret. emitidas · inventario: ${d.inv.lotes.length} lotes, ${d.inv.transferencias.length} transferencias, ${d.inv.movimientos.length} movimientos, ${d.inv.lineas.length} líneas con lote, ${d.inv.ajustes.length} ajustes · tesorería: ${d.tes.extractos.length} extractos, ${d.tes.lineas.length} líneas, ${d.tes.porIdentificar.length} depósitos por identificar`);
      datos.push(d);
    }

    // Contactos con documentos de venta aunque en Odoo no estén marcados como clientes (customer_rank = 0)
    const clientesLeidos = new Set(datos.flatMap((d) => d.clientes.map((c) => c.id)));
    for (const d of datos) {
      const refs = new Set([
        ...d.ordenes.map((o) => comercial.get(m2oId(o.partner_id)) ?? m2oId(o.partner_id)),
        ...d.facturas.map((x) => m2oId(x.commercial_partner_id)),
        ...d.pagos.map((p) => comercial.get(m2oId(p.partner_id)) ?? m2oId(p.partner_id)),
        ...d.retenciones.map((r) => comercial.get(m2oId(r.partner_id)) ?? m2oId(r.partner_id)),
        ...d.reintegros.map((p) => comercial.get(m2oId(p.partner_id)) ?? m2oId(p.partner_id)),
        ...d.municipales.map((r) => comercial.get(m2oId(r.partner_id)) ?? m2oId(r.partner_id)),
      ]);
      const faltan = [...refs].filter((id) => id && !clientesLeidos.has(id));
      if (!faltan.length) continue;
      const extra = await odoo.leerTodo('res.partner', [['id', 'in', faltan]], CAMPOS_CLIENTE, { empresa: d.cid });
      d.clientes.push(...extra);
      extra.forEach((c) => clientesLeidos.add(c.id));
      log(`    ${d.emp.nombre_corto}: +${extra.length} clientes con documentos pero sin marca de cliente en Odoo`);
    }
    // Clientes creados o enlazados desde GUDS (20s) que Odoo no marca como clientes y aún no tienen documentos (p. ej. un
    // proveedor con el mismo RIF): se leen igual, para que la sincronización los actualice por odoo_id (sin duplicar la fila)
    const ligadosGuds = (await sql(`select odoo_id from clientes where odoo_vinculo in ('creado', 'enlazado') and odoo_id is not null`))
      .map((x) => x.odoo_id).filter((id) => !clientesLeidos.has(id));
    for (const [i, d] of datos.entries()) {
      const faltan = ligadosGuds.filter((id) => !clientesLeidos.has(id));
      if (!faltan.length) break;
      const deEmpresa = i === 0 ? ['|', ['company_id', '=', d.cid], ['company_id', '=', false]] : [['company_id', '=', d.cid]];
      const extra = await odoo.leerTodo('res.partner', [['id', 'in', faltan], ...deEmpresa], CAMPOS_CLIENTE, { empresa: d.cid });
      d.clientes.push(...extra);
      extra.forEach((c) => clientesLeidos.add(c.id));
      if (extra.length) log(`    ${d.emp.nombre_corto}: +${extra.length} clientes creados o enlazados desde GUDS`);
    }

    const idsClientes = [...new Set(datos.flatMap((d) => d.clientes.map((c) => c.id)))];
    const direcciones = idsClientes.length
      ? await odoo.leerTodo('res.partner', [['type', '=', 'delivery'], ['parent_id', 'in', idsClientes]],
        ['name', 'parent_id', 'street', 'street2', 'city', 'state_id', 'phone', 'mobile', 'active', 'write_date'])
      : [];
    log(`    ${direcciones.length} direcciones de entrega`);

    const proveedoresLeidos = new Set(datos.flatMap((d) => d.proveedores.map((p) => p.id)));
    for (const d of datos) {
      const faltan = [...new Set(proveedoresReferenciados(d.compras, comercial))].filter((id) => !proveedoresLeidos.has(id));
      if (!faltan.length) continue;
      const extra = await odoo.leerTodo('res.partner', [['id', 'in', faltan]], CAMPOS_PROVEEDOR, { empresa: d.cid });
      d.proveedores.push(...extra);
      extra.forEach((p) => proveedoresLeidos.add(p.id));
      log(`    ${d.emp.nombre_corto}: +${extra.length} proveedores con documentos pero sin marca de proveedor en Odoo`);
    }
    const proveedoresSet = new Set(datos.flatMap((d) => d.proveedores.map((p) => p.id)));
    // Personas de contacto (20v): hijas de tipo contacto de clientes o proveedores y personas sueltas
    const contactosOdoo = await leerContactosOdoo({ odoo, sql, idsClientes, idsProveedores: [...proveedoresSet] });
    log(`    ${contactosOdoo.hijos.length} personas de contacto hijas · ${contactosOdoo.sueltos.length} personas sueltas${contactosOdoo.conSueltos ? '' : ' (no se importan)'}`);
    if (!aplicar) resumen.contactos = await escribirContactos({ sql, escribir, leidos: contactosOdoo, ts, aplicar: false, log, aviso });

    // ── 3. Precio base: último precio USD en cotizaciones y órdenes no canceladas (decisión 2026-09-27) ──
    const ultimoPrecio = new Map();   // plantilla → { fecha, usd }
    for (const d of datos) {
      const ordenPorId = new Map(d.ordenes.map((o) => [o.id, o]));
      for (const l of d.lineas) {
        const o = ordenPorId.get(m2oId(l.order_id));
        const tmpl = plantillaDe.get(m2oId(l.product_id));
        if (!o || !tmpl || o.state === 'cancel' || !(l.price_unit > 0)) continue;
        const usd = aUsd(l.price_unit, l.price_unit_ref, m2oId(o.currency_id), m2oId(o.ref_currency_id));
        if (!(usd > 0)) continue;
        const previo = ultimoPrecio.get(tmpl);
        if (!previo || o.date_order > previo.fecha) ultimoPrecio.set(tmpl, { fecha: o.date_order, usd: round2(usd) });
      }
    }

    // ── 4. Categorías (globales en Odoo) ─────────────────────────────────
    const categIds = [...new Set(datos.flatMap((d) => d.productos.map((p) => m2oId(p.categ_id)).filter(Boolean)))];
    const categorias = await odoo.leerTodo('product.category', [['id', 'in', categIds]], ['complete_name']);
    // Guardia de lectura (la sincronización corre sola): si Odoo devolviera una lista vacía o incompleta —p. ej. por un
    // cambio de permisos de la API key— la escritura borraría en GUDS cobros, retenciones y líneas. Se compara lo leído
    // con lo que ya hay en GUDS y, si alguna entidad cae a menos de la mitad, se aborta ANTES de escribir.
    for (const d of datos) {
      const leidos = { clientes: d.clientes.length, productos: d.productos.length, ordenes: d.ordenes.length, facturas: d.facturas.length,
        pagos: d.pagos.length, proveedores: d.proveedores.length };
      const enGuds = (await sql(`select ${Object.keys(leidos).map((t) => `(select count(*)::int from ${t} where odoo_id is not null and empresa_id = '${d.emp.id}') ${t}`).join(', ')}`))[0];
      const caidas = Object.entries(leidos).filter(([t, n]) => enGuds[t] >= 20 && n < enGuds[t] * 0.5).map(([t, n]) => `${t}: Odoo ${n} / GUDS ${enGuds[t]}`);
      if (caidas.length) {
        const msg = `Lectura sospechosa de Odoo en ${d.emp.nombre_corto} (${caidas.join('; ')}): no se escribe nada`;
        if (aplicar) throw new Error(msg);
        aviso(msg);
      }
    }
    log(`\n[3] Categorías: ${categorias.length}`);
    if (aplicar && categorias.length) {
      await escribir(`
        insert into categorias (odoo_id, nombre, icono, color, orden, activo)
        select x.odoo_id, left(x.nombre, 100), '📦', 'bg-gray-500', 99, true
        from jsonb_to_recordset(${jsonbLit(categorias.map((c) => ({ odoo_id: c.id, nombre: c.complete_name })))}) as x(odoo_id int, nombre text)
        on conflict (odoo_id) do update set nombre = excluded.nombre, updated_at = now()
        where categorias.nombre is distinct from excluded.nombre`);
    }

    // ── 5. Escritura por empresa ─────────────────────────────────────────
    for (const d of datos) {
      const { emp, cid } = d;
      const E = emp.id;
      const empDe = (v) => uuidEmpresa[m2oId(v)] ?? null;   // null = compartido
      log(`\n[4] Escribiendo ${emp.nombre_corto}…`);
      const clientesSet = new Set(datos.flatMap((x) => x.clientes.map((c) => c.id)));
      const clienteDe = (partnerId) => {
        const c = comercial.get(partnerId) ?? partnerId;
        return clientesSet.has(c) ? c : clientesSet.has(partnerId) ? partnerId : null;
      };

      // Bancos: todas las cuentas bancarias + las cajas que usan los cobros (sin unificar por nombre)
      const diariosUsados = new Set([...d.pagos, ...d.reintegros, ...d.compras.pagosProv].map((p) => m2oId(p.journal_id)));
      const bancos = d.diarios.filter((j) => j.type === 'bank' || diariosUsados.has(j.id)).map((j) => ({
        odoo_id: j.id, empresa_id: E, nombre: txt(typeof j.name === 'object' ? (j.name.es_VE || j.name.en_US) : j.name),
        moneda: monedaBanco(m2oId(j.currency_id)), metodo: j.type === 'cash' ? 'efectivo' : 'transferencia',
        tipo_odoo: j.type, activo: !!j.active,
        ...(d.cuentasBanco.get(m2oId(j.bank_account_id)) || { numero_cuenta: null, banco_nombre: null, titular: null, documento: null }),
      }));
      marcas.push(marca('bancos', E, d.diarios));

      // Clientes
      const clientes = d.clientes.map((p) => {
        const plazo = m2oId(p.property_payment_term_id);
        return {
          odoo_id: p.id, empresa_id: empDe(p.company_id), codigo: `ODOO-${p.id}`,
          nombre_negocio: txt(p.name, 200) || `ODOO-${p.id}`,
          rif: txt(p.rif) || txt(p.vat) || txt(p.cedula) || 'N/D', cedula: txt(p.cedula),
          email: txt(p.email, 255), telefono: txt(p.phone), celular: txt(p.mobile),
          direccion: [txt(p.street), txt(p.street2)].filter(Boolean).join(', ') || null,
          calle: txt(p.street), complemento: txt(p.street2), lista_odoo_id: m2oId(p.property_product_pricelist),
          ciudad: txt(p.city, 100), estado: m2oNombre(p.state_id),
          latitud: p.partner_latitude || null, longitud: p.partner_longitude || null,
          es_empresa: !!p.is_company, tipo_negocio: p.is_company ? 'Empresa' : 'Persona Natural',
          tipo_residencia: RESIDENCIA[p.residence_type] ?? null,
          vendedor_odoo: m2oNombre(p.user_id), vendedor_id: vendedorGuds.get(m2oId(p.user_id)) ?? null,
          condicion_pago: plazo ? nombrePlazo.get(plazo) ?? null : null,
          dias_credito: plazo ? diasPlazo.get(plazo) ?? 0 : 0,
          limite_credito: round2(p.credit_limit_value || p.credit_limit || 0),
          licencia_actividad: txt(p.econ_act_license), sitio_web: txt(p.website), notas: stripHtml(p.comment),
          fecha_registro_odoo: fechaOdoo(p.create_date), activo: !!p.active,
        };
      });
      marcas.push(marca('clientes', E, d.clientes));

      // Proveedores
      const proveedores = d.proveedores.map((p) => {
        const plazo = m2oId(p.property_supplier_payment_term_id);
        return {
          odoo_id: p.id, empresa_id: empDe(p.company_id), codigo: `ODOO-${p.id}`, nombre: txt(p.name) || `ODOO-${p.id}`,
          rif: txt(p.rif) || txt(p.vat) || txt(p.cedula), email: txt(p.email), telefono: txt(p.phone), celular: txt(p.mobile),
          direccion: [txt(p.street), txt(p.street2)].filter(Boolean).join(', ') || null, ciudad: txt(p.city), estado: m2oNombre(p.state_id),
          es_empresa: !!p.is_company, tipo_residencia: RESIDENCIA[p.residence_type] ?? null,
          condicion_pago: plazo ? nombrePlazo.get(plazo) ?? null : null, dias_credito: plazo ? diasPlazo.get(plazo) ?? 0 : 0,
          sitio_web: txt(p.website), notas: stripHtml(p.comment), activo: !!p.active,
        };
      });
      marcas.push(marca('proveedores', E, d.proveedores));

      // Productos
      const skus = new Set();
      // IVA de venta del producto en SU empresa (suma de los impuestos porcentuales; sin impuesto = 0, exento)
      const impuestoPorId = new Map(d.impuestos.map((t) => [t.id, t]));
      if (d.impuestos.some((t) => t.price_include || t.amount_type !== 'percent')) aviso(`${emp.nombre_corto}: hay impuestos de venta incluidos en el precio o no porcentuales; GUDS los trata como porcentaje sobre el precio`);
      const impuestoDe = (p) => {
        const ts = (p.taxes_id || []).map((id) => impuestoPorId.get(id)).filter(Boolean);
        return { impuesto_pct: round2(ts.reduce((a, t) => a + (t.amount_type === 'percent' ? Number(t.amount) || 0 : 0), 0)),
          impuesto_nombre: ts.map((t) => txt(typeof t.name === 'object' ? (t.name.es_VE || t.name.en_US) : t.name)).filter(Boolean).join(' + ') || 'Sin impuesto' };
      };
      const productos = d.productos.map((p) => {
        let sku = txt(p.default_code, 50) || `ODOO-${p.id}`;
        if (skus.has(sku)) sku = `${sku.slice(0, 40)}-${p.id}`;
        skus.add(sku);
        return {
          odoo_id: p.id, empresa_id: empDe(p.company_id), sku,
          nombre: txt(typeof p.name === 'object' ? (p.name.es_VE || p.name.en_US) : p.name, 200) || sku,
          categ_odoo_id: m2oId(p.categ_id),
          unidad: txt(m2oNombre(p.uom_id), 50) || 'Unidad',
          precio_odoo: ultimoPrecio.get(p.id)?.usd ?? null,   // null: nunca se vendió; se respeta el precio de GUDS
          tipo_odoo: p.type, vendible: !!p.active && !!p.sale_ok, controla_stock: !!p.is_storable,
          ...impuestoDe(p),
        };
      });
      marcas.push(marca('productos', E, d.productos));

      // Almacenes (cliente de consignación por nombre, entre los clientes de la empresa)
      const indiceClientes = d.clientes.map((c) => ({ id: c.id, n: norm(c.name) })).filter((c) => c.n.length >= 4);
      const clienteConsignacion = (nombre) => {
        const s = norm(String(nombre).replace(/.*cons(?:ig|gi)nado/i, ''));   // "CONSIGNADO" y la variante "CONSGINADO"
        if (s.length < 4) return null;
        let mejor = null;
        for (const c of indiceClientes) if ((c.n.includes(s) || s.includes(c.n)) && (!mejor || c.n.length > mejor.n.length)) mejor = c;
        return mejor?.id ?? null;
      };
      const porEntregas = clientesPorEntregas(d.inv, almacenDe, clienteDe);
      const almacenes = d.almacenes.map((w) => {
        const consig = esConsignacion(w);
        const porNombre = consig ? clienteConsignacion(w.name) : null;
        const entregas = consig ? porEntregas.get(w.id) ?? null : null;
        if (porNombre && entregas && porNombre !== entregas) aviso(`${emp.nombre_corto}: el almacén "${w.name}" coincide por nombre con un cliente pero sus entregas van a otro (revisar vínculo)`);
        const porEnt = porNombre ? null : entregas;
        return {
          odoo_id: w.id, empresa_id: E, nombre: txt(w.name) || w.code, codigo: txt(w.code),
          tipo: consig ? 'consignacion' : 'propio', cliente_odoo_id: porNombre ?? porEnt,
          vinculo_cliente: porNombre ? 'nombre' : porEnt ? 'entregas' : null, activo: !!w.active,
        };
      });
      marcas.push(marca('almacenes', E, d.almacenes));

      // Inventario por almacén × producto
      const invMap = new Map();
      for (const q of d.quants) {
        const wh = almacenDe.get(m2oId(q.location_id));
        const tmpl = plantillaDe.get(m2oId(q.product_id));
        if (!wh || !tmpl) continue;
        const k = `${wh}|${tmpl}`;
        const a = invMap.get(k) || { c: 0, r: 0 };
        a.c += q.quantity || 0; a.r += q.reserved_quantity || 0;
        invMap.set(k, a);
      }
      const inventario = [...invMap].filter(([, a]) => Math.abs(a.c) > 0.0001 || Math.abs(a.r) > 0.0001)
        .map(([k, a]) => { const [wh, tmpl] = k.split('|').map(Number); return { wh, tmpl, cantidad: round2(a.c), reservado: round2(a.r) }; });
      marcas.push(marca('inventario', E, d.quants));

      // Órdenes y líneas
      const sinCliente = { ordenes: 0, facturas: 0, pagos: 0, retenciones: 0 };
      const ordenes = [];
      for (const o of d.ordenes) {
        const cli = clienteDe(m2oId(o.partner_id));
        if (!cli) { sinCliente.ordenes++; continue; }
        const cur = m2oId(o.currency_id), ref = m2oId(o.ref_currency_id);
        const total = aUsd(o.amount_total, o.amount_total_ref, cur, ref);
        const factor = Number(o.amount_total) ? total / Number(o.amount_total) : 1;
        ordenes.push({
          odoo_id: o.id, empresa_id: E, numero: nombreDoc(o.name, o.id, 20), cliente_odoo_id: cli,
          subtotal: round2(Number(o.amount_untaxed) * factor), impuesto: round2(Number(o.amount_tax) * factor), total: round2(total),
          estado: estadoOrden(o.state, o.delivery_status), estado_odoo: o.state, moneda_original: m2oNombre(o.currency_id),
          fecha_pedido: fechaOdoo(o.date_order), vendedor_odoo: m2oNombre(o.user_id),
          vendedor_id: vendedorGuds.get(m2oId(o.user_id)) ?? null, notas: stripHtml(o.note),
        });
      }
      const ordenPorId = new Map(d.ordenes.map((o) => [o.id, o]));
      const skuPorPlantilla = new Map(productos.map((p) => [p.odoo_id, p.sku]));
      const lineas = d.lineas.map((l) => {
        const o = ordenPorId.get(m2oId(l.order_id));
        const cur = m2oId(o?.currency_id), ref = m2oId(o?.ref_currency_id);
        const tmpl = plantillaDe.get(m2oId(l.product_id)) ?? null;
        return {
          odoo_id: l.id, empresa_id: E, orden_odoo_id: m2oId(l.order_id), tmpl,
          nombre_producto: txt(l.name, 200) || m2oNombre(l.product_id), sku_producto: tmpl ? skuPorPlantilla.get(tmpl) ?? null : null,
          cantidad: Math.round(l.product_uom_qty || 0), precio_unitario: round2(aUsd(l.price_unit, l.price_unit_ref, cur, ref)),
          descuento: round2(l.discount), subtotal: round2(aUsd(l.price_subtotal, l.price_subtotal_ref, cur, ref)),
          // IVA de la línea en Odoo (el que se aplicó al vender, aunque el producto cambie después)
          impuesto_pct: round2((l.tax_id || []).map((id) => impuestoPorId.get(id)).filter((t) => t && t.amount_type === 'percent')
            .reduce((a, t) => a + (Number(t.amount) || 0), 0)),
        };
      });
      marcas.push(marca('ordenes', E, d.ordenes));

      // Facturas y líneas
      const facturas = [];
      for (const f of d.facturas) {
        const cli = clienteDe(m2oId(f.commercial_partner_id));
        if (!cli) { sinCliente.facturas++; continue; }
        facturas.push({
          odoo_id: f.id, empresa_id: E, numero: nombreDoc(f.name, f.id), tipo: f.move_type === 'out_refund' ? 'nota_credito' : 'factura',
          // Nota de débito: ligada a su factura de origen o emitida en un diario de ND ("Nota debito cliente", "ND CxC…")
          es_nota_debito: !!m2oId(f.debit_origin_id) || (f.move_type === 'out_invoice' && RE_DIARIO_ND.test(m2oNombre(f.journal_id) || '')),
          origen_odoo_id: m2oId(f.debit_origin_id) ?? m2oId(f.reversed_entry_id), diario_odoo: m2oNombre(f.journal_id),
          cliente_odoo_id: cli, orden_odoo_id: m2oId(f.sale_id), fecha_emision: f.invoice_date || null,
          fecha_vencimiento: f.invoice_date_due || null, moneda: monedaFactura(m2oId(f.currency_id)),
          tasa_cambio: f.invoice_currency_rate || null, subtotal: round2(f.amount_untaxed), impuesto: round2(f.amount_tax),
          total: round2(f.amount_total), monto_pagado: round2(Number(f.amount_total) - Number(f.amount_residual)),
          saldo_pendiente: round2(f.amount_residual), total_usd: round2(f.amount_total_signed),
          saldo_odoo_usd: round2(f.amount_residual_signed), estado_pago: estadoPagoFactura(f.state, f.payment_state),
          estado: f.state, referencia: txt(f.ref), nro_control: txt(f.nro_control), vendedor_odoo: m2oNombre(f.invoice_user_id),
          motivo_anulacion: f.state === 'cancel'
            ? [m2oNombre(f.invoice_cancel_reason_id), txt(f.descripcion_cancel), m2oNombre(f.eu_cancel_motive_id), txt(f.eu_cancel_motive_desc)]
              .filter(Boolean).join(' · ') || null
            : null,
          motivo_nota: m2oNombre(f.motivos),
        });
      }
      const lineasFactura = d.lineasFactura.map((l) => {
        const tmpl = plantillaDe.get(m2oId(l.product_id)) ?? null;
        return {
          odoo_id: l.id, empresa_id: E, factura_odoo_id: m2oId(l.move_id), tmpl, nombre_producto: txt(l.name),
          sku_producto: tmpl ? skuPorPlantilla.get(tmpl) ?? null : null, cantidad: round2(l.quantity),
          precio_unitario: round2(l.price_unit), descuento: round2(l.discount), subtotal: round2(l.price_subtotal), total: round2(l.price_total),
        };
      });
      marcas.push(marca('facturas', E, d.facturas));

      // Cobros
      const diarioTipo = new Map(d.diarios.map((j) => [j.id, j.type]));
      const pagos = [];
      for (const p of d.pagos) {
        const cli = clienteDe(m2oId(p.partner_id));
        if (!cli) { sinCliente.pagos++; continue; }
        pagos.push({
          odoo_id: p.id, empresa_id: E, numero: nombreDoc(p.name, p.id, 20), cliente_odoo_id: cli, banco_odoo_id: m2oId(p.journal_id),
          metodo: diarioTipo.get(m2oId(p.journal_id)) === 'cash' ? 'efectivo' : 'transferencia',
          monto: round2(Math.abs(p.amount_company_currency_signed || 0)), monto_moneda: round2(p.amount),
          moneda: m2oId(p.currency_id) === 2 ? 'BS' : 'USD', estado: estadoCobro(p.state), estado_odoo: p.state,
          referencia: txt(p.memo, 100), fecha: p.date, es_igtf: !!p.is_igtf_payment,
          igtf_origen_odoo_id: m2oId(p.pago_igtf_origen), lote_pago: txt(m2oNombre(p.batch_payment_id)),
        });
      }
      marcas.push(marca('pagos', E, d.pagos));

      // Reintegros a clientes (pagos salientes)
      const reintegros = [];
      for (const p of d.reintegros) {
        const cli = clienteDe(m2oId(p.partner_id));
        if (!cli) { sinCliente.reintegros = (sinCliente.reintegros || 0) + 1; continue; }
        reintegros.push({
          odoo_id: p.id, empresa_id: E, numero: nombreDoc(p.name, p.id), cliente_odoo_id: cli, banco_odoo_id: m2oId(p.journal_id),
          monto: round2(Math.abs(p.amount_company_currency_signed || 0)), monto_moneda: round2(p.amount),
          moneda: m2oId(p.currency_id) === 2 ? 'BS' : 'USD', estado: estadoCobro(p.state), estado_odoo: p.state,
          referencia: txt(p.memo), fecha: p.date,
        });
      }
      marcas.push(marca('reintegros', E, d.reintegros));

      // Retenciones de IVA que nos hacen los clientes (1 cabecera Odoo = 1 retención GUDS)
      const lineasPorRet = new Map();
      for (const l of d.lineasRetencion) {
        const r = m2oId(l.retention_id);
        if (!lineasPorRet.has(r)) lineasPorRet.set(r, []);
        lineasPorRet.get(r).push(l);
      }
      const retenciones = [];
      for (const r of d.retenciones) {
        const cli = clienteDe(m2oId(r.partner_id));
        if (!cli) { sinCliente.retenciones++; continue; }
        const ls = lineasPorRet.get(r.id) || [];
        retenciones.push({
          odoo_model: 'account.wh.iva', tipo: 'iva',
          odoo_id: r.id, empresa_id: E, numero: txt(r.customer_doc_number) || txt(r.number) || `IVA-${r.id}`,
          numero_comprobante: txt(r.customer_doc_number), cliente_odoo_id: cli, porcentaje: ls[0]?.rate_amount ?? null,
          base_imponible: round2(ls.reduce((s, l) => s + (l.base_tax || 0), 0)), total: round2(Math.abs(r.total_tax_ret || 0)),
          fecha: r.date || null, estado: estadoRetencion(r.state),
        });
      }
      const itemsRetencion = d.lineasRetencion
        .filter((l) => Math.abs(l.ret_amount || 0) > 0)
        .map((l) => ({ odoo_model: 'account.wh.iva.line', ret_model: 'account.wh.iva', odoo_id: l.id, empresa_id: E,
          ret_odoo_id: m2oId(l.retention_id), factura_odoo_id: m2oId(l.invoice_id), monto: round2(Math.abs(l.ret_amount)) }));
      marcas.push(marca('retenciones', E, d.retenciones));
      // Municipales: 1 registro Odoo = 1 retención con un ítem (la factura)
      const estadoMunicipal = (st) => (st === 'cancel' ? 'rechazado' : st === 'draft' ? 'pendiente' : 'aprobado');
      for (const r of d.municipales) {
        const cli = clienteDe(m2oId(r.partner_id));
        if (!cli) { sinCliente.retenciones++; continue; }
        retenciones.push({
          odoo_model: 'base.retenciones', tipo: 'municipal', odoo_id: r.id, empresa_id: E,
          numero: txt(r.communication) || txt(r.name) || `MUN-${r.id}`, numero_comprobante: txt(r.communication),
          cliente_odoo_id: cli, porcentaje: r.percentage ?? null, base_imponible: round2(r.amount), total: round2(Math.abs(r.monto_retenido || 0)),
          fecha: r.create_date ? String(r.create_date).slice(0, 10) : null, estado: estadoMunicipal(r.state),
        });
        if (Math.abs(r.monto_retenido || 0) > 0 && m2oId(r.move_id)) {
          itemsRetencion.push({ odoo_model: 'base.retenciones.item', ret_model: 'base.retenciones', odoo_id: r.id, empresa_id: E,
            ret_odoo_id: r.id, factura_odoo_id: m2oId(r.move_id), monto: round2(Math.abs(r.monto_retenido)) });
        }
      }
      marcas.push(marca('retenciones_municipales', E, d.municipales));

      // Aplicaciones: cada conciliación parcial dice qué documento saldó qué factura
      const tipoFactura = new Map(d.facturas.map((x) => [x.id, x.move_type]));
      const facturasImportadas = new Set(facturas.map((x) => x.odoo_id));
      const pagoPorMovimiento = new Map(d.pagos.map((p) => [m2oId(p.move_id), p.id]));
      const reintegroPorMovimiento = new Map(d.reintegros.map((p) => [m2oId(p.move_id), p.id]));
      const movimientosRetencion = new Set([
        ...d.retenciones.map((r) => m2oId(r.asiento_iva)), ...d.lineasRetencion.map((l) => m2oId(l.asiento_iva_in_line)),
        ...d.municipales.map((r) => m2oId(r.asiento_retencion)),
      ].filter(Boolean));
      const aplicacionesBase = [];
      for (const pr of d.parciales) {
        const dm = d.movimientoDeLinea.get(m2oId(pr.debit_move_id));
        const cm = d.movimientoDeLinea.get(m2oId(pr.credit_move_id));
        let factura = null, contra = null;
        if (dm && tipoFactura.get(dm) === 'out_invoice') { factura = dm; contra = cm; }
        else if (cm && tipoFactura.get(cm) === 'out_refund' && tipoFactura.get(dm) !== 'out_invoice') { factura = cm; contra = dm; }
        if (!factura || !facturasImportadas.has(factura)) continue;
        let tipo = 'otro', pago = null, documento = null;
        if (tipoFactura.get(contra) === 'out_refund') { tipo = 'nota_credito'; documento = contra; }
        else if (pagoPorMovimiento.has(contra)) { tipo = 'pago'; pago = pagoPorMovimiento.get(contra); }
        else if (reintegroPorMovimiento.has(contra)) tipo = 'reintegro';
        else if (movimientosRetencion.has(contra)) tipo = 'retencion';
        aplicacionesBase.push({ odoo_id: pr.id, empresa_id: E, factura_odoo_id: factura, tipo, pago_odoo_id: pago,
          documento_odoo_id: documento, contra, monto_usd: round2(pr.amount), fecha: pr.max_date || null });
      }
      // Nombre del documento que aplica (asiento de Odoo)
      const contras = [...new Set(aplicacionesBase.map((a) => a.contra).filter(Boolean))];
      const nombreMovimiento = new Map();
      for (const lote of lotes(contras, 3000)) {
        for (const m of await odoo.leerTodo('account.move', [['id', 'in', lote]], ['name', 'ref'], { empresa: cid, pagina: 3000 })) {
          nombreMovimiento.set(m.id, [txt(m.name), txt(m.ref)].filter(Boolean).join(' · ') || null);
        }
      }
      const aplicaciones = aplicacionesBase.map(({ contra, ...a }) => ({ ...a, descripcion: nombreMovimiento.get(contra) ?? null }));
      marcas.push(marca('aplicaciones', E, d.parciales));

      for (const [k, n] of Object.entries(sinCliente)) if (n) aviso(`${emp.nombre_corto}: ${n} ${k} sin cliente reconocible (no se importan)`);

      resumen.entidades[emp.nombre_corto] = {
        bancos: bancos.length, clientes: clientes.length, proveedores: proveedores.length, productos: productos.length, almacenes: almacenes.length,
        inventario: inventario.length, ordenes: ordenes.length, lineas_orden: lineas.length, facturas: facturas.length,
        lineas_factura: lineasFactura.length, cobros: pagos.length, reintegros: reintegros.length, retenciones: retenciones.length,
        items_retencion: itemsRetencion.length, aplicaciones: aplicaciones.length,
      };
      const ctxCompras = { c: d.compras, d, E, odoo, cid, sql, escribir, ts, comercial, plantillaDe, proveedoresSet, log };
      const provDe = (pid) => { const x = comercial.get(pid) ?? pid; return proveedoresSet.has(x) ? x : proveedoresSet.has(pid) ? pid : null; };
      const ctxInv = { inv: d.inv, quants: d.quants, E, sql, escribir, ts, plantillaDe, almacenDe, clienteDe, provDe, empDe, log };
      const ctxTes = { tes: d.tes, diarios: d.diarios, E, sql, escribir, ts, clienteDe, provDe };
      marcas.push(marca('extractos_odoo', E, d.tes.lineas));
      marcas.push(marca('lotes', E, d.inv.lotes), marca('transferencias', E, d.inv.transferencias));
      marcas.push(marca('ordenes_compra', E, d.compras.ordenesCompra), marca('facturas_proveedor', E, d.compras.facturasProv),
        marca('pagos_proveedor', E, d.compras.pagosProv), marca('retenciones_emitidas', E, [...d.compras.retIvaProv, ...d.compras.retIslr]));
      if (!aplicar) {
        Object.assign(resumen.entidades[emp.nombre_corto], await escribirCompras({ ...ctxCompras, aplicar: false }));
        Object.assign(resumen.entidades[emp.nombre_corto], await escribirInventario({ ...ctxInv, aplicar: false }));
        Object.assign(resumen.entidades[emp.nombre_corto], await escribirTesoreria({ ...ctxTes, aplicar: false }));
        log(`    ${JSON.stringify(resumen.entidades[emp.nombre_corto])}`);
        continue;
      }
      log(`    ${JSON.stringify(resumen.entidades[emp.nombre_corto])}`);

      // ─ Upserts (orden de dependencias) ─
      await escribir(`
        insert into bancos (odoo_id, empresa_id, nombre, moneda, metodo_pago, tipo_odoo, activo, numero_cuenta, banco_nombre, titular, documento,
          visible_portal, odoo_sync_at)
        select x.odoo_id, x.empresa_id, x.nombre, x.moneda, x.metodo::pago_metodo, x.tipo_odoo, x.activo, x.numero_cuenta, x.banco_nombre, x.titular,
          x.documento, x.tipo_odoo = 'bank' and x.activo, '${ts}'
        from jsonb_to_recordset(${jsonbLit(bancos)}) as x(odoo_id int, empresa_id uuid, nombre text, moneda text, metodo text, tipo_odoo text, activo boolean,
          numero_cuenta text, banco_nombre text, titular text, documento text)
        on conflict (odoo_id) do update set empresa_id = excluded.empresa_id, nombre = excluded.nombre, moneda = excluded.moneda,
          tipo_odoo = excluded.tipo_odoo, activo = excluded.activo, numero_cuenta = excluded.numero_cuenta, banco_nombre = excluded.banco_nombre,
          titular = excluded.titular, documento = excluded.documento,
          visible_portal = bancos.visible_portal and excluded.activo, odoo_sync_at = excluded.odoo_sync_at, updated_at = now()
        where (bancos.empresa_id, bancos.nombre, bancos.moneda, bancos.tipo_odoo, bancos.activo, bancos.numero_cuenta, bancos.banco_nombre, bancos.titular, bancos.documento)
          is distinct from (excluded.empresa_id, excluded.nombre, excluded.moneda, excluded.tipo_odoo, excluded.activo, excluded.numero_cuenta,
            excluded.banco_nombre, excluded.titular, excluded.documento)`);

      // Listas de precios de Odoo (antes que los clientes, que apuntan a su lista)
      if (d.listas.length) {
        const listas = d.listas.map((l) => ({ odoo_id: l.id, empresa_id: empDe(l.company_id),
          nombre: txt(typeof l.name === 'object' ? (l.name.es_VE || l.name.en_US) : l.name) || `Lista ${l.id}`,
          moneda: monedaBanco(m2oId(l.currency_id)), activo: !!l.active }));
        await escribir(`
          insert into listas_precios (odoo_id, empresa_id, nombre, moneda, activo, es_default, porcentaje_descuento)
          select x.odoo_id, x.empresa_id, x.nombre, x.moneda, x.activo, false, 0
          from jsonb_to_recordset(${jsonbLit(listas)}) as x(odoo_id int, empresa_id uuid, nombre text, moneda text, activo boolean)
          on conflict (odoo_id) where odoo_id is not null do update set empresa_id = excluded.empresa_id, nombre = excluded.nombre,
            moneda = excluded.moneda, activo = excluded.activo, updated_at = now()
          where (listas_precios.empresa_id, listas_precios.nombre, listas_precios.moneda, listas_precios.activo)
            is distinct from (excluded.empresa_id, excluded.nombre, excluded.moneda, excluded.activo)`);
      }

      for (const lote of lotes(clientes, 500)) {
        await escribir(`
          insert into clientes (odoo_id, empresa_id, codigo, nombre_negocio, rif, cedula, email, telefono, celular, direccion, calle, complemento, ciudad,
            estado, latitud, longitud, es_empresa, tipo_negocio, tipo_residencia, vendedor_odoo, vendedor_asignado_id, condicion_pago,
            dias_credito, limite_credito, licencia_actividad, sitio_web, notas, fecha_registro_odoo, activo, contribuyente_especial, lista_precios_id, odoo_sync_at)
          select x.odoo_id, x.empresa_id, x.codigo, x.nombre_negocio, x.rif, x.cedula, x.email, x.telefono, x.celular, x.direccion, x.calle, x.complemento, x.ciudad,
            x.estado, x.latitud, x.longitud, x.es_empresa, x.tipo_negocio, x.tipo_residencia, x.vendedor_odoo, x.vendedor_id, x.condicion_pago,
            x.dias_credito, x.limite_credito, x.licencia_actividad, x.sitio_web, x.notas, x.fecha_registro_odoo, x.activo, false,
            (select l.id from listas_precios l where l.odoo_id = x.lista_odoo_id), '${ts}'
          from jsonb_to_recordset(${jsonbLit(lote)}) as x(odoo_id int, empresa_id uuid, codigo text, nombre_negocio text, rif text, cedula text,
            email text, telefono text, celular text, direccion text, calle text, complemento text, ciudad text, estado text, latitud numeric, longitud numeric, es_empresa boolean,
            tipo_negocio text, tipo_residencia text, vendedor_odoo text, vendedor_id uuid, condicion_pago text, dias_credito int, limite_credito numeric,
            licencia_actividad text, sitio_web text, notas text, fecha_registro_odoo timestamptz, activo boolean, lista_odoo_id int)
          on conflict (odoo_id) do update set empresa_id = excluded.empresa_id, nombre_negocio = excluded.nombre_negocio, rif = excluded.rif,
            cedula = excluded.cedula, email = excluded.email, telefono = excluded.telefono, celular = excluded.celular,
            direccion = excluded.direccion, calle = excluded.calle, complemento = excluded.complemento, ciudad = excluded.ciudad, estado = excluded.estado, latitud = excluded.latitud,
            longitud = excluded.longitud, es_empresa = excluded.es_empresa, tipo_negocio = excluded.tipo_negocio,
            tipo_residencia = excluded.tipo_residencia, vendedor_odoo = excluded.vendedor_odoo,
            vendedor_asignado_id = coalesce(excluded.vendedor_asignado_id, clientes.vendedor_asignado_id),
            lista_precios_id = coalesce(excluded.lista_precios_id, clientes.lista_precios_id),
            condicion_pago = excluded.condicion_pago, dias_credito = excluded.dias_credito,
            limite_credito = case when clientes.limite_credito_pendiente then clientes.limite_credito else excluded.limite_credito end,
            licencia_actividad = excluded.licencia_actividad, sitio_web = excluded.sitio_web, notas = excluded.notas,
            fecha_registro_odoo = excluded.fecha_registro_odoo, activo = excluded.activo, odoo_sync_at = excluded.odoo_sync_at, updated_at = now()
          where (clientes.empresa_id, clientes.nombre_negocio, clientes.rif, clientes.cedula, clientes.email, clientes.telefono, clientes.celular,
            clientes.direccion, clientes.calle, clientes.complemento, clientes.ciudad, clientes.estado, clientes.latitud, clientes.longitud, clientes.es_empresa, clientes.tipo_residencia,
            clientes.vendedor_odoo, clientes.vendedor_asignado_id, clientes.condicion_pago, clientes.dias_credito, clientes.limite_credito,
            clientes.licencia_actividad, clientes.sitio_web, clientes.notas, clientes.activo, clientes.lista_precios_id)
          is distinct from (excluded.empresa_id, excluded.nombre_negocio, excluded.rif, excluded.cedula, excluded.email, excluded.telefono,
            excluded.celular, excluded.direccion, excluded.calle, excluded.complemento, excluded.ciudad, excluded.estado, excluded.latitud, excluded.longitud, excluded.es_empresa,
            excluded.tipo_residencia, excluded.vendedor_odoo, coalesce(excluded.vendedor_asignado_id, clientes.vendedor_asignado_id),
            excluded.condicion_pago, excluded.dias_credito, case when clientes.limite_credito_pendiente then clientes.limite_credito else excluded.limite_credito end,
            excluded.licencia_actividad, excluded.sitio_web,
            excluded.notas, excluded.activo, coalesce(excluded.lista_precios_id, clientes.lista_precios_id))`);
      }

      // Clasificación comercial de Odoo (R2 · 20q): tipo de cliente (Industria), canal, segmento y etiquetas del contacto.
      // Se mantiene en Odoo (el espejo impide editarla en GUDS); solo se escriben las filas que cambian.
      const clasifClientes = d.clientes.map((p) => ({
        odoo_id: p.id, tipo_cliente: txt(m2oNombre(p.industry_id), 100),
        canal: txt(m2oNombre(p.eu_partner_channel_id), 100) || txt(p.channel, 100),
        segmento: txt(m2oNombre(p.eu_partner_segment_id), 100) || txt(p.segmentation, 100),
        etiquetas: (Array.isArray(p.category_id) ? p.category_id : []).map((id) => etiquetaCliente.get(id)).filter(Boolean),
      }));
      for (const lote of lotes(clasifClientes, 1000)) {
        await escribir(`
          with x as (
            select x.odoo_id, x.tipo_cliente, x.canal, x.segmento,
              case when jsonb_array_length(x.etiquetas) > 0 then array(select jsonb_array_elements_text(x.etiquetas)) end etiquetas
            from jsonb_to_recordset(${jsonbLit(lote)}) as x(odoo_id int, tipo_cliente text, canal text, segmento text, etiquetas jsonb)
          )
          update clientes c set tipo_cliente = x.tipo_cliente, canal = x.canal, segmento = x.segmento, etiquetas = x.etiquetas
          from x
          where c.odoo_id = x.odoo_id and (c.tipo_cliente, c.canal, c.segmento, c.etiquetas) is distinct from (x.tipo_cliente, x.canal, x.segmento, x.etiquetas)`);
      }

      for (const lote of lotes(productos, 500)) {
        await escribir(`
          with x as (
            select x.*, coalesce(x.precio_odoo, 0) precio_ins,
              x.vendible and coalesce(x.tipo_odoo, 'consu') <> 'service' and coalesce(x.precio_odoo, 0) > 0 disponible_ins
            from jsonb_to_recordset(${jsonbLit(lote)}) as x(odoo_id int, empresa_id uuid, sku text, nombre text,
              categ_odoo_id int, unidad text, precio_odoo numeric, tipo_odoo text, vendible boolean, controla_stock boolean,
              impuesto_pct numeric, impuesto_nombre text)
          )
          insert into productos (odoo_id, empresa_id, sku, nombre, categoria_id, unidad, precio_base, precio_origen, stock_actual,
            stock_minimo, disponible, activo, destacado, tipo_odoo, vendible, controla_stock, impuesto_pct, impuesto_nombre, odoo_sync_at)
          select x.odoo_id, x.empresa_id, x.sku, x.nombre, (select c.id from categorias c where c.odoo_id = x.categ_odoo_id),
            x.unidad, x.precio_ins, case when x.precio_odoo is not null then 'odoo' else 'guds' end, 0, 0, x.disponible_ins, x.disponible_ins,
            false, x.tipo_odoo, x.vendible, x.controla_stock, x.impuesto_pct, x.impuesto_nombre, '${ts}'
          from x
          on conflict (odoo_id) do update set empresa_id = excluded.empresa_id, sku = excluded.sku, nombre = excluded.nombre,
            impuesto_pct = excluded.impuesto_pct, impuesto_nombre = excluded.impuesto_nombre,
            categoria_id = excluded.categoria_id, unidad = excluded.unidad,
            -- Precio: el de Odoo si hay historial de venta; si no, se conserva el que tenga GUDS
            precio_base = case when excluded.precio_origen = 'odoo' then excluded.precio_base else productos.precio_base end,
            precio_origen = case when excluded.precio_origen = 'odoo' then 'odoo' else productos.precio_origen end,
            disponible = excluded.vendible and coalesce(excluded.tipo_odoo, 'consu') <> 'service'
              and (case when excluded.precio_origen = 'odoo' then excluded.precio_base else productos.precio_base end) > 0,
            activo = excluded.vendible and coalesce(excluded.tipo_odoo, 'consu') <> 'service'
              and (case when excluded.precio_origen = 'odoo' then excluded.precio_base else productos.precio_base end) > 0
              and not productos.oculto_tienda,
            tipo_odoo = excluded.tipo_odoo, vendible = excluded.vendible, controla_stock = excluded.controla_stock,
            odoo_sync_at = excluded.odoo_sync_at, updated_at = now()
          where (productos.empresa_id, productos.sku, productos.nombre, productos.categoria_id, productos.unidad, productos.precio_base,
            productos.precio_origen, productos.disponible, productos.activo, productos.tipo_odoo, productos.vendible, productos.controla_stock,
            productos.impuesto_pct, productos.impuesto_nombre)
          is distinct from (excluded.empresa_id, excluded.sku, excluded.nombre, excluded.categoria_id, excluded.unidad,
            case when excluded.precio_origen = 'odoo' then excluded.precio_base else productos.precio_base end,
            case when excluded.precio_origen = 'odoo' then 'odoo' else productos.precio_origen end,
            excluded.vendible and coalesce(excluded.tipo_odoo, 'consu') <> 'service'
              and (case when excluded.precio_origen = 'odoo' then excluded.precio_base else productos.precio_base end) > 0,
            excluded.vendible and coalesce(excluded.tipo_odoo, 'consu') <> 'service'
              and (case when excluded.precio_origen = 'odoo' then excluded.precio_base else productos.precio_base end) > 0
              and not productos.oculto_tienda,
            excluded.tipo_odoo, excluded.vendible, excluded.controla_stock, excluded.impuesto_pct, excluded.impuesto_nombre)`);
      }

      // Marca del producto en Odoo (R2 · 20q): se mantiene en Odoo; solo se escriben las filas que cambian
      for (const lote of lotes(d.productos.map((p) => ({ odoo_id: p.id, marca: txt(m2oNombre(p.product_brand_id), 100) })), 1000)) {
        await escribir(`
          update productos p set marca = x.marca
          from jsonb_to_recordset(${jsonbLit(lote)}) as x(odoo_id int, marca text)
          where p.odoo_id = x.odoo_id and p.marca is distinct from x.marca`);
      }
      log(`    clasificación: ${clasifClientes.filter((c) => c.tipo_cliente).length} clientes con tipo · ${clasifClientes.filter((c) => c.canal || c.segmento).length} con canal o segmento · ${d.productos.filter((p) => m2oId(p.product_brand_id)).length} productos con marca`);

      // Costo promedio de Odoo por empresa (fase 20j): solo las filas que cambian; cada valor nuevo queda en el historial.
      // No va en productos.costo: esa columna la lee el catálogo público y queda siempre vacía.
      const costos = [...d.productos, ...d.costosCompartidos].map((p) => ({ odoo_id: p.id, costo: Number(p.standard_price) || 0 }));
      for (const lote of lotes(costos, 1000)) {
        await escribir(`
          with x as (
            select p.id producto_id, x.costo
            from jsonb_to_recordset(${jsonbLit(lote)}) as x(odoo_id int, costo numeric) join productos p on p.odoo_id = x.odoo_id
          ), cambios as (
            insert into producto_costos (producto_id, empresa_id, costo, costo_actualizado_at)
            select x.producto_id, '${E}', x.costo, '${ts}' from x
            on conflict (producto_id, empresa_id) do update set costo = excluded.costo, costo_actualizado_at = excluded.costo_actualizado_at
            where producto_costos.costo is distinct from excluded.costo
            returning producto_id, empresa_id, costo, costo_actualizado_at
          )
          insert into producto_costos_historial (producto_id, empresa_id, costo, desde) select * from cambios`);
      }
      log(`    costo de Odoo: ${costos.filter((c) => c.costo > 0).length} de ${costos.length} productos con costo`);

      // Reglas de las listas de precios (precio fijo o descuento por producto, categoría o global)
      const reglas = d.reglas.map((g) => ({
        odoo_id: g.id, lista_odoo_id: m2oId(g.pricelist_id),
        aplicado_en: g.applied_on === '3_global' ? 'global' : g.applied_on === '2_product_category' ? 'categoria' : 'producto',
        producto_odoo_id: g.applied_on === '0_product_variant' ? plantillaDe.get(m2oId(g.product_id)) ?? null : m2oId(g.product_tmpl_id),
        categ_odoo_id: m2oId(g.categ_id),
        tipo_calculo: g.compute_price === 'fixed' ? 'fijo' : g.compute_price === 'percentage' ? 'porcentaje' : 'formula',
        precio_fijo: g.compute_price === 'fixed' ? g.fixed_price : null,
        descuento_pct: g.compute_price === 'percentage' ? g.percent_price : g.compute_price === 'formula' ? g.price_discount : null,
        recargo: g.compute_price === 'formula' ? g.price_surcharge || 0 : null, base: g.base || null, cantidad_minima: g.min_quantity || 0,
        fecha_inicio: g.date_start || null, fecha_fin: g.date_end || null,
      }));
      if (d.reglas.some((g) => g.compute_price === 'formula' && g.base && g.base !== 'list_price')) aviso(`${emp.nombre_corto}: reglas de lista de precios basadas en otra lista o en el costo; GUDS las aplica sobre su precio base`);
      if (d.listas.length) {
        if (reglas.length) {
          await escribir(`
            insert into reglas_precio (odoo_id, lista_precios_id, empresa_id, aplicado_en, producto_id, categoria_id, tipo_calculo, precio_fijo,
              descuento_pct, recargo, base, cantidad_minima, fecha_inicio, fecha_fin, activo, odoo_sync_at)
            select x.odoo_id, l.id, l.empresa_id, x.aplicado_en, (select p.id from productos p where p.odoo_id = x.producto_odoo_id),
              (select c.id from categorias c where c.odoo_id = x.categ_odoo_id), x.tipo_calculo, x.precio_fijo, x.descuento_pct, x.recargo, x.base,
              x.cantidad_minima, x.fecha_inicio, x.fecha_fin, true, '${ts}'
            from jsonb_to_recordset(${jsonbLit(reglas)}) as x(odoo_id int, lista_odoo_id int, aplicado_en text, producto_odoo_id int, categ_odoo_id int,
              tipo_calculo text, precio_fijo numeric, descuento_pct numeric, recargo numeric, base text, cantidad_minima numeric,
              fecha_inicio timestamptz, fecha_fin timestamptz)
            join listas_precios l on l.odoo_id = x.lista_odoo_id
            on conflict (odoo_id) do update set lista_precios_id = excluded.lista_precios_id, empresa_id = excluded.empresa_id,
              aplicado_en = excluded.aplicado_en, producto_id = excluded.producto_id, categoria_id = excluded.categoria_id,
              tipo_calculo = excluded.tipo_calculo, precio_fijo = excluded.precio_fijo, descuento_pct = excluded.descuento_pct,
              recargo = excluded.recargo, base = excluded.base, cantidad_minima = excluded.cantidad_minima, fecha_inicio = excluded.fecha_inicio,
              fecha_fin = excluded.fecha_fin, activo = true, odoo_sync_at = excluded.odoo_sync_at`);
        }
        // Reglas que ya no existen en Odoo (tabla propia de GUDS: se quitan)
        await escribir(`
          delete from reglas_precio g using listas_precios l
          where l.id = g.lista_precios_id and l.odoo_id = any (array[${d.listas.map((l) => l.id).join(',')}]::int[])
            and g.odoo_id is not null and g.odoo_id <> all (array[${reglas.map((g) => g.odoo_id).join(',') || 0}]::int[])`);
      }

      for (const lote of lotes(proveedores, 500)) {
        await escribir(`
          insert into proveedores (odoo_id, empresa_id, codigo, nombre, rif, email, telefono, celular, direccion, ciudad, estado, es_empresa,
            tipo_residencia, condicion_pago, dias_credito, sitio_web, notas, activo, cliente_id, odoo_sync_at)
          select x.odoo_id, x.empresa_id, x.codigo, x.nombre, x.rif, x.email, x.telefono, x.celular, x.direccion, x.ciudad, x.estado,
            x.es_empresa, x.tipo_residencia, x.condicion_pago, x.dias_credito, x.sitio_web, x.notas, x.activo,
            (select c.id from clientes c where c.odoo_id = x.odoo_id), '${ts}'
          from jsonb_to_recordset(${jsonbLit(lote)}) as x(odoo_id int, empresa_id uuid, codigo text, nombre text, rif text, email text,
            telefono text, celular text, direccion text, ciudad text, estado text, es_empresa boolean, tipo_residencia text,
            condicion_pago text, dias_credito int, sitio_web text, notas text, activo boolean)
          on conflict (odoo_id) do update set empresa_id = excluded.empresa_id, codigo = excluded.codigo, nombre = excluded.nombre,
            rif = excluded.rif, email = excluded.email, telefono = excluded.telefono, celular = excluded.celular, direccion = excluded.direccion,
            ciudad = excluded.ciudad, estado = excluded.estado, es_empresa = excluded.es_empresa, tipo_residencia = excluded.tipo_residencia,
            condicion_pago = excluded.condicion_pago, dias_credito = excluded.dias_credito, sitio_web = excluded.sitio_web,
            notas = excluded.notas, activo = excluded.activo, cliente_id = excluded.cliente_id, odoo_sync_at = excluded.odoo_sync_at,
            updated_at = now()
          where (proveedores.empresa_id, proveedores.codigo, proveedores.nombre, proveedores.rif, proveedores.email, proveedores.telefono,
            proveedores.celular, proveedores.direccion, proveedores.ciudad, proveedores.estado, proveedores.es_empresa,
            proveedores.tipo_residencia, proveedores.condicion_pago, proveedores.dias_credito, proveedores.sitio_web, proveedores.notas,
            proveedores.activo, proveedores.cliente_id)
          is distinct from (excluded.empresa_id, excluded.codigo, excluded.nombre, excluded.rif, excluded.email, excluded.telefono,
            excluded.celular, excluded.direccion, excluded.ciudad, excluded.estado, excluded.es_empresa, excluded.tipo_residencia,
            excluded.condicion_pago, excluded.dias_credito, excluded.sitio_web, excluded.notas, excluded.activo, excluded.cliente_id)`);
      }

      await escribir(`
        insert into almacenes (odoo_id, empresa_id, nombre, codigo, tipo, cliente_id, vinculo_cliente, activo, odoo_sync_at)
        select x.odoo_id, x.empresa_id, x.nombre, x.codigo, x.tipo, c.id, case when c.id is not null then x.vinculo_cliente end, x.activo, '${ts}'
        from jsonb_to_recordset(${jsonbLit(almacenes)}) as x(odoo_id int, empresa_id uuid, nombre text, codigo text, tipo text, cliente_odoo_id int,
          vinculo_cliente text, activo boolean)
        left join clientes c on c.odoo_id = x.cliente_odoo_id
        on conflict (odoo_id) do update set empresa_id = excluded.empresa_id, nombre = excluded.nombre, codigo = excluded.codigo,
          tipo = excluded.tipo, cliente_id = ${CLIENTE_ALMACEN}, vinculo_cliente = ${VINCULO_ALMACEN},
          activo = excluded.activo, odoo_sync_at = excluded.odoo_sync_at, updated_at = now()
        where (almacenes.empresa_id, almacenes.nombre, almacenes.codigo, almacenes.tipo, almacenes.cliente_id, almacenes.vinculo_cliente, almacenes.activo)
          is distinct from (excluded.empresa_id, excluded.nombre, excluded.codigo, excluded.tipo, ${CLIENTE_ALMACEN}, ${VINCULO_ALMACEN}, excluded.activo)`);

      // Inventario: upsert de lo que hay + borrar lo que ya no está (stock en 0)
      for (const lote of lotes(inventario, 1000)) {
        await escribir(`
          insert into inventario_almacen (almacen_id, producto_id, cantidad, reservado, empresa_id, updated_at)
          select a.id, p.id, x.cantidad, x.reservado, a.empresa_id, now()
          from jsonb_to_recordset(${jsonbLit(lote)}) as x(wh int, tmpl int, cantidad numeric, reservado numeric)
          join almacenes a on a.odoo_id = x.wh join productos p on p.odoo_id = x.tmpl
          on conflict (almacen_id, producto_id) do update set cantidad = excluded.cantidad, reservado = excluded.reservado, updated_at = now()
          where (inventario_almacen.cantidad, inventario_almacen.reservado) is distinct from (excluded.cantidad, excluded.reservado)`);
      }
      await escribir(`
        delete from inventario_almacen ia using almacenes a, productos p
        where a.id = ia.almacen_id and p.id = ia.producto_id and a.empresa_id = '${E}' and a.odoo_id is not null
          and not exists (select 1 from jsonb_to_recordset(${jsonbLit(inventario.map(({ wh, tmpl }) => ({ wh, tmpl })))}) as x(wh int, tmpl int)
                          where x.wh = a.odoo_id and x.tmpl = p.odoo_id)`);

      for (const lote of lotes(ordenes, 500)) {
        await escribir(`
          insert into ordenes (odoo_id, empresa_id, numero, cliente_id, subtotal, impuesto, total, estado, estado_odoo, moneda_original,
            fecha_pedido, created_at, vendedor_odoo, vendedor_id, notas, pagado, stock_descontado, odoo_sync_at)
          select x.odoo_id, x.empresa_id, x.numero, (select c.id from clientes c where c.odoo_id = x.cliente_odoo_id), x.subtotal, x.impuesto,
            x.total, x.estado::orden_estado, x.estado_odoo, x.moneda_original, x.fecha_pedido, coalesce(x.fecha_pedido, now()), x.vendedor_odoo,
            x.vendedor_id, x.notas, false, true, '${ts}'
          from jsonb_to_recordset(${jsonbLit(lote)}) as x(odoo_id int, empresa_id uuid, numero text, cliente_odoo_id int, subtotal numeric,
            impuesto numeric, total numeric, estado text, estado_odoo text, moneda_original text, fecha_pedido timestamptz, vendedor_odoo text,
            vendedor_id uuid, notas text)
          on conflict (odoo_id) do update set empresa_id = excluded.empresa_id, numero = excluded.numero, cliente_id = excluded.cliente_id,
            subtotal = excluded.subtotal, impuesto = excluded.impuesto, total = excluded.total, estado = excluded.estado,
            estado_odoo = excluded.estado_odoo, moneda_original = excluded.moneda_original, fecha_pedido = excluded.fecha_pedido,
            vendedor_odoo = excluded.vendedor_odoo, vendedor_id = coalesce(excluded.vendedor_id, ordenes.vendedor_id), notas = excluded.notas,
            odoo_sync_at = excluded.odoo_sync_at, updated_at = now()
          where (ordenes.empresa_id, ordenes.numero, ordenes.cliente_id, ordenes.subtotal, ordenes.impuesto, ordenes.total, ordenes.estado,
            ordenes.estado_odoo, ordenes.moneda_original, ordenes.fecha_pedido, ordenes.vendedor_odoo, ordenes.vendedor_id, ordenes.notas)
          is distinct from (excluded.empresa_id, excluded.numero, excluded.cliente_id, excluded.subtotal, excluded.impuesto, excluded.total,
            excluded.estado, excluded.estado_odoo, excluded.moneda_original, excluded.fecha_pedido, excluded.vendedor_odoo,
            coalesce(excluded.vendedor_id, ordenes.vendedor_id), excluded.notas)`);
      }
      // Órdenes borradas en Odoo (Odoo solo deja borrar borradores o canceladas): en GUDS no se borran (trazabilidad),
      // quedan canceladas con estado_odoo 'eliminada' (20u). Tope de seguridad: si faltan demasiadas, la lectura pudo quedar
      // incompleta y no se toca nada.
      {
        const idsOdoo = `array[${ordenes.map((o) => o.odoo_id).join(',') || 0}]::int[]`;
        const [{ n: faltan }] = await sql(`select count(*)::int n from ordenes where empresa_id = '${E}' and odoo_id is not null
          and odoo_id <> all (${idsOdoo}) and coalesce(estado_odoo, '') <> 'eliminada'`);
        if (faltan && faltan <= Math.max(10, Math.round(ordenes.length * 0.02))) {
          await escribir(`
            update ordenes set estado = 'cancelado', estado_odoo = 'eliminada', odoo_sync_at = '${ts}', updated_at = now()
            where empresa_id = '${E}' and odoo_id is not null and odoo_id <> all (${idsOdoo}) and coalesce(estado_odoo, '') <> 'eliminada'`);
          log(`    ${emp.nombre_corto}: ${faltan} orden(es) borrada(s) en Odoo quedan canceladas en GUDS ("eliminada")`);
        } else if (faltan) {
          log(`    AVISO ${emp.nombre_corto}: ${faltan} órdenes de GUDS no aparecen en Odoo; son demasiadas para marcarlas solas (¿lectura incompleta?)`);
        }
      }
      for (const lote of lotes(lineas, 1000)) {
        await escribir(`
          insert into orden_items (odoo_id, empresa_id, orden_id, producto_id, nombre_producto, sku_producto, cantidad, precio_unitario, descuento, subtotal,
            impuesto_pct, impuesto)
          select x.odoo_id, x.empresa_id, o.id, (select p.id from productos p where p.odoo_id = x.tmpl), x.nombre_producto, x.sku_producto,
            x.cantidad, x.precio_unitario, x.descuento, x.subtotal, x.impuesto_pct, round(x.subtotal * x.impuesto_pct / 100.0, 2)
          from jsonb_to_recordset(${jsonbLit(lote)}) as x(odoo_id int, empresa_id uuid, orden_odoo_id int, tmpl int, nombre_producto text,
            sku_producto text, cantidad int, precio_unitario numeric, descuento numeric, subtotal numeric, impuesto_pct numeric)
          join ordenes o on o.odoo_id = x.orden_odoo_id
          on conflict (odoo_id) do update set empresa_id = excluded.empresa_id, orden_id = excluded.orden_id, producto_id = excluded.producto_id,
            nombre_producto = excluded.nombre_producto, sku_producto = excluded.sku_producto, cantidad = excluded.cantidad,
            precio_unitario = excluded.precio_unitario, descuento = excluded.descuento, subtotal = excluded.subtotal,
            impuesto_pct = excluded.impuesto_pct, impuesto = excluded.impuesto
          where (orden_items.empresa_id, orden_items.orden_id, orden_items.producto_id, orden_items.nombre_producto, orden_items.sku_producto,
            orden_items.cantidad, orden_items.precio_unitario, orden_items.descuento, orden_items.subtotal, orden_items.impuesto_pct, orden_items.impuesto)
          is distinct from (excluded.empresa_id, excluded.orden_id, excluded.producto_id, excluded.nombre_producto, excluded.sku_producto,
            excluded.cantidad, excluded.precio_unitario, excluded.descuento, excluded.subtotal, excluded.impuesto_pct, excluded.impuesto)`);
      }
      await escribir(`
        delete from orden_items oi using ordenes o
        where o.id = oi.orden_id and o.empresa_id = '${E}' and o.odoo_id is not null and oi.odoo_id is not null
          and oi.odoo_id <> all (array[${lineas.map((l) => l.odoo_id).join(',') || 0}]::int[])`);

      for (const lote of lotes(facturas, 500)) {
        await escribir(`
          insert into facturas (odoo_id, empresa_id, numero, tipo, es_nota_debito, cliente_id, orden_id, fecha_emision, fecha_vencimiento, moneda,
            tasa_cambio, subtotal, impuesto, total, monto_pagado, saldo_pendiente, total_usd, saldo_odoo_usd, estado_pago, estado, referencia,
            nro_control, vendedor_odoo, motivo_anulacion, motivo_nota, diario_odoo, creada_en_guds, odoo_sync_at)
          select x.odoo_id, x.empresa_id, x.numero, x.tipo, x.es_nota_debito, (select c.id from clientes c where c.odoo_id = x.cliente_odoo_id),
            (select o.id from ordenes o where o.odoo_id = x.orden_odoo_id), x.fecha_emision, x.fecha_vencimiento, x.moneda, x.tasa_cambio,
            x.subtotal, x.impuesto, x.total, x.monto_pagado, x.saldo_pendiente, x.total_usd, x.saldo_odoo_usd, x.estado_pago, x.estado,
            x.referencia, x.nro_control, x.vendedor_odoo, x.motivo_anulacion, x.motivo_nota, x.diario_odoo, false, '${ts}'
          from jsonb_to_recordset(${jsonbLit(lote)}) as x(odoo_id int, empresa_id uuid, numero text, tipo text, es_nota_debito boolean,
            cliente_odoo_id int, orden_odoo_id int, fecha_emision date, fecha_vencimiento date, moneda text, tasa_cambio numeric, subtotal numeric,
            impuesto numeric, total numeric, monto_pagado numeric, saldo_pendiente numeric, total_usd numeric, saldo_odoo_usd numeric,
            estado_pago text, estado text, referencia text, nro_control text, vendedor_odoo text, motivo_anulacion text, motivo_nota text,
            diario_odoo text)
          on conflict (odoo_id) do update set empresa_id = excluded.empresa_id, numero = excluded.numero, tipo = excluded.tipo,
            es_nota_debito = excluded.es_nota_debito, cliente_id = excluded.cliente_id, orden_id = excluded.orden_id,
            fecha_emision = excluded.fecha_emision, fecha_vencimiento = excluded.fecha_vencimiento, moneda = excluded.moneda,
            tasa_cambio = excluded.tasa_cambio, subtotal = excluded.subtotal, impuesto = excluded.impuesto, total = excluded.total,
            monto_pagado = excluded.monto_pagado, saldo_pendiente = excluded.saldo_pendiente, total_usd = excluded.total_usd,
            saldo_odoo_usd = excluded.saldo_odoo_usd, estado_pago = excluded.estado_pago, estado = excluded.estado,
            referencia = excluded.referencia, nro_control = excluded.nro_control, vendedor_odoo = excluded.vendedor_odoo,
            motivo_anulacion = excluded.motivo_anulacion, motivo_nota = excluded.motivo_nota, diario_odoo = excluded.diario_odoo,
            odoo_sync_at = excluded.odoo_sync_at, updated_at = now()
          where (facturas.empresa_id, facturas.numero, facturas.tipo, facturas.es_nota_debito, facturas.cliente_id, facturas.orden_id,
            facturas.fecha_emision, facturas.fecha_vencimiento, facturas.moneda, facturas.tasa_cambio, facturas.subtotal, facturas.impuesto,
            facturas.total, facturas.monto_pagado, facturas.saldo_pendiente, facturas.total_usd, facturas.saldo_odoo_usd, facturas.estado_pago,
            facturas.estado, facturas.referencia, facturas.nro_control, facturas.vendedor_odoo, facturas.motivo_anulacion, facturas.motivo_nota,
            facturas.diario_odoo)
          is distinct from (excluded.empresa_id, excluded.numero, excluded.tipo, excluded.es_nota_debito, excluded.cliente_id, excluded.orden_id,
            excluded.fecha_emision, excluded.fecha_vencimiento, excluded.moneda, excluded.tasa_cambio, excluded.subtotal, excluded.impuesto,
            excluded.total, excluded.monto_pagado, excluded.saldo_pendiente, excluded.total_usd, excluded.saldo_odoo_usd, excluded.estado_pago,
            excluded.estado, excluded.referencia, excluded.nro_control, excluded.vendedor_odoo, excluded.motivo_anulacion, excluded.motivo_nota,
            excluded.diario_odoo)`);
      }
      const conOrigen = facturas.filter((f) => f.origen_odoo_id).map((f) => ({ odoo_id: f.odoo_id, origen: f.origen_odoo_id }));
      if (conOrigen.length) {
        await escribir(`
          update facturas f set factura_origen_id = o.id
          from jsonb_to_recordset(${jsonbLit(conOrigen)}) as x(odoo_id int, origen int) join facturas o on o.odoo_id = x.origen
          where f.odoo_id = x.odoo_id and f.factura_origen_id is distinct from o.id`);
      }
      for (const lote of lotes(lineasFactura, 1000)) {
        await escribir(`
          insert into factura_items (odoo_id, empresa_id, factura_id, producto_id, nombre_producto, sku_producto, cantidad, precio_unitario, descuento, subtotal, total)
          select x.odoo_id, x.empresa_id, f.id, (select p.id from productos p where p.odoo_id = x.tmpl), x.nombre_producto, x.sku_producto,
            x.cantidad, x.precio_unitario, x.descuento, x.subtotal, x.total
          from jsonb_to_recordset(${jsonbLit(lote)}) as x(odoo_id int, empresa_id uuid, factura_odoo_id int, tmpl int, nombre_producto text,
            sku_producto text, cantidad numeric, precio_unitario numeric, descuento numeric, subtotal numeric, total numeric)
          join facturas f on f.odoo_id = x.factura_odoo_id
          on conflict (odoo_id) do update set empresa_id = excluded.empresa_id, factura_id = excluded.factura_id, producto_id = excluded.producto_id,
            nombre_producto = excluded.nombre_producto, sku_producto = excluded.sku_producto, cantidad = excluded.cantidad,
            precio_unitario = excluded.precio_unitario, descuento = excluded.descuento, subtotal = excluded.subtotal, total = excluded.total
          where (factura_items.empresa_id, factura_items.factura_id, factura_items.producto_id, factura_items.nombre_producto,
            factura_items.sku_producto, factura_items.cantidad, factura_items.precio_unitario, factura_items.descuento, factura_items.subtotal,
            factura_items.total)
          is distinct from (excluded.empresa_id, excluded.factura_id, excluded.producto_id, excluded.nombre_producto, excluded.sku_producto,
            excluded.cantidad, excluded.precio_unitario, excluded.descuento, excluded.subtotal, excluded.total)`);
      }
      await escribir(`
        delete from factura_items fi using facturas f
        where f.id = fi.factura_id and f.empresa_id = '${E}' and f.odoo_id is not null and fi.odoo_id is not null
          and fi.odoo_id <> all (array[${lineasFactura.map((l) => l.odoo_id).join(',') || 0}]::int[])`);

      for (const lote of lotes(pagos, 800)) {
        await escribir(`
          insert into pagos (odoo_id, empresa_id, numero, cliente_id, banco_id, metodo, monto, monto_moneda, moneda, estado, estado_odoo,
            referencia, es_igtf, lote_pago, fecha_verificacion, created_at, odoo_sync_at)
          select x.odoo_id, x.empresa_id, x.numero, (select c.id from clientes c where c.odoo_id = x.cliente_odoo_id),
            (select b.id from bancos b where b.odoo_id = x.banco_odoo_id), x.metodo::pago_metodo, x.monto, x.monto_moneda, x.moneda,
            x.estado::pago_estado, x.estado_odoo, x.referencia, x.es_igtf, x.lote_pago, x.fecha::timestamptz, x.fecha::timestamptz, '${ts}'
          from jsonb_to_recordset(${jsonbLit(lote)}) as x(odoo_id int, empresa_id uuid, numero text, cliente_odoo_id int, banco_odoo_id int,
            metodo text, monto numeric, monto_moneda numeric, moneda text, estado text, estado_odoo text, referencia text, es_igtf boolean,
            lote_pago text, fecha date)
          on conflict (odoo_id) do update set empresa_id = excluded.empresa_id, numero = excluded.numero, cliente_id = excluded.cliente_id,
            banco_id = excluded.banco_id, monto = excluded.monto, monto_moneda = excluded.monto_moneda, moneda = excluded.moneda,
            estado = excluded.estado, estado_odoo = excluded.estado_odoo, referencia = excluded.referencia, es_igtf = excluded.es_igtf,
            lote_pago = excluded.lote_pago, fecha_verificacion = excluded.fecha_verificacion, odoo_sync_at = excluded.odoo_sync_at, updated_at = now()
          where (pagos.empresa_id, pagos.numero, pagos.cliente_id, pagos.banco_id, pagos.monto, pagos.monto_moneda, pagos.moneda, pagos.estado,
            pagos.estado_odoo, pagos.referencia, pagos.es_igtf, pagos.lote_pago, pagos.fecha_verificacion)
          is distinct from (excluded.empresa_id, excluded.numero, excluded.cliente_id, excluded.banco_id, excluded.monto, excluded.monto_moneda,
            excluded.moneda, excluded.estado, excluded.estado_odoo, excluded.referencia, excluded.es_igtf, excluded.lote_pago, excluded.fecha_verificacion)`);
      }
      // IGTF: cada pago de IGTF apunta al cobro que lo originó (cuando ambos existen)
      const igtf = pagos.filter((x) => x.igtf_origen_odoo_id).map((x) => ({ odoo_id: x.odoo_id, origen: x.igtf_origen_odoo_id }));
      await escribir(`
        update pagos p set igtf_origen_id = o.id
        from jsonb_to_recordset(${jsonbLit(igtf)}) as x(odoo_id int, origen int) join pagos o on o.odoo_id = x.origen
        where p.odoo_id = x.odoo_id and p.igtf_origen_id is distinct from o.id`);

      for (const lote of lotes(reintegros, 500)) {
        await escribir(`
          insert into reintegros (odoo_id, empresa_id, numero, cliente_id, banco_id, monto, monto_moneda, moneda, estado, estado_odoo, referencia, fecha, odoo_sync_at)
          select x.odoo_id, x.empresa_id, x.numero, c.id, (select b.id from bancos b where b.odoo_id = x.banco_odoo_id), x.monto, x.monto_moneda,
            x.moneda, x.estado, x.estado_odoo, x.referencia, x.fecha, '${ts}'
          from jsonb_to_recordset(${jsonbLit(lote)}) as x(odoo_id int, empresa_id uuid, numero text, cliente_odoo_id int, banco_odoo_id int,
            monto numeric, monto_moneda numeric, moneda text, estado text, estado_odoo text, referencia text, fecha date)
          join clientes c on c.odoo_id = x.cliente_odoo_id
          on conflict (odoo_id) do update set empresa_id = excluded.empresa_id, numero = excluded.numero, cliente_id = excluded.cliente_id,
            banco_id = excluded.banco_id, monto = excluded.monto, monto_moneda = excluded.monto_moneda, moneda = excluded.moneda,
            estado = excluded.estado, estado_odoo = excluded.estado_odoo, referencia = excluded.referencia, fecha = excluded.fecha,
            odoo_sync_at = excluded.odoo_sync_at
          where (reintegros.empresa_id, reintegros.numero, reintegros.cliente_id, reintegros.banco_id, reintegros.monto, reintegros.monto_moneda,
            reintegros.moneda, reintegros.estado, reintegros.estado_odoo, reintegros.referencia, reintegros.fecha)
          is distinct from (excluded.empresa_id, excluded.numero, excluded.cliente_id, excluded.banco_id, excluded.monto, excluded.monto_moneda,
            excluded.moneda, excluded.estado, excluded.estado_odoo, excluded.referencia, excluded.fecha)`);
      }

      if (retenciones.length) {
        for (const lote of lotes(retenciones, 500)) {
          await escribir(`
            insert into retenciones (odoo_model, odoo_id, empresa_id, numero, numero_comprobante, tipo, cliente_id, porcentaje, base_imponible,
              total, fecha, estado, rol_declarante, odoo_sync_at)
            select x.odoo_model, x.odoo_id, x.empresa_id, x.numero, x.numero_comprobante, x.tipo,
              (select c.id from clientes c where c.odoo_id = x.cliente_odoo_id), x.porcentaje, x.base_imponible, x.total, x.fecha, x.estado,
              'admin', '${ts}'
            from jsonb_to_recordset(${jsonbLit(lote)}) as x(odoo_model text, tipo text, odoo_id int, empresa_id uuid, numero text,
              numero_comprobante text, cliente_odoo_id int, porcentaje numeric, base_imponible numeric, total numeric, fecha date, estado text)
            on conflict (odoo_model, odoo_id) do update set empresa_id = excluded.empresa_id, numero = excluded.numero,
              numero_comprobante = excluded.numero_comprobante, cliente_id = excluded.cliente_id, porcentaje = excluded.porcentaje,
              base_imponible = excluded.base_imponible, total = excluded.total, fecha = excluded.fecha, estado = excluded.estado,
              odoo_sync_at = excluded.odoo_sync_at, updated_at = now()
            where (retenciones.empresa_id, retenciones.numero, retenciones.numero_comprobante, retenciones.cliente_id, retenciones.porcentaje,
              retenciones.base_imponible, retenciones.total, retenciones.fecha, retenciones.estado)
            is distinct from (excluded.empresa_id, excluded.numero, excluded.numero_comprobante, excluded.cliente_id, excluded.porcentaje,
              excluded.base_imponible, excluded.total, excluded.fecha, excluded.estado)`);
        }
        for (const lote of lotes(itemsRetencion, 1000)) {
          await escribir(`
            insert into retencion_items (odoo_model, odoo_id, empresa_id, retencion_id, factura_id, monto_aplicado)
            select x.odoo_model, x.odoo_id, x.empresa_id, r.id, f.id, x.monto
            from jsonb_to_recordset(${jsonbLit(lote)}) as x(odoo_model text, ret_model text, odoo_id int, empresa_id uuid, ret_odoo_id int,
              factura_odoo_id int, monto numeric)
            join retenciones r on r.odoo_model = x.ret_model and r.odoo_id = x.ret_odoo_id
            join facturas f on f.odoo_id = x.factura_odoo_id
            on conflict (odoo_model, odoo_id) do update set empresa_id = excluded.empresa_id, retencion_id = excluded.retencion_id,
              factura_id = excluded.factura_id, monto_aplicado = excluded.monto_aplicado
            where (retencion_items.empresa_id, retencion_items.retencion_id, retencion_items.factura_id, retencion_items.monto_aplicado)
              is distinct from (excluded.empresa_id, excluded.retencion_id, excluded.factura_id, excluded.monto_aplicado)`);
        }
      }
      // Retenciones de Odoo que ya no corresponden (p. ej. las de proveedores que la carga vieja mezcló): se borran SIN
      // modo réplica para que el ON DELETE CASCADE limpie sus ítems.
      for (const [modelo, modeloItem] of [['account.wh.iva', 'account.wh.iva.line'], ['base.retenciones', 'base.retenciones.item']]) {
        const ids = retenciones.filter((r) => r.odoo_model === modelo).map((r) => r.odoo_id);
        const borradas = await sql(`
          with b as (delete from retenciones where odoo_model = '${modelo}' and empresa_id = '${E}'
            and odoo_id <> all (array[${ids.join(',') || 0}]::int[]) returning 1) select count(*)::int n from b`);
        if (borradas[0]?.n) log(`    retenciones de Odoo (${modelo}) eliminadas (ya no corresponden): ${borradas[0].n}`);
        await escribir(`
          delete from retencion_items ri using retenciones r
          where r.id = ri.retencion_id and r.empresa_id = '${E}' and ri.odoo_model = '${modeloItem}'
            and ri.odoo_id <> all (array[${itemsRetencion.filter((i) => i.odoo_model === modeloItem).map((i) => i.odoo_id).join(',') || 0}]::int[])`);
      }

      // Aplicaciones de Odoo (conciliaciones)
      for (const lote of lotes(aplicaciones, 1000)) {
        await escribir(`
          insert into factura_aplicaciones (odoo_id, empresa_id, factura_id, tipo, pago_id, documento_id, descripcion, monto_usd, fecha, odoo_sync_at)
          select x.odoo_id, x.empresa_id, f.id, x.tipo, (select p.id from pagos p where p.odoo_id = x.pago_odoo_id),
            (select d.id from facturas d where d.odoo_id = x.documento_odoo_id), x.descripcion, x.monto_usd, x.fecha, '${ts}'
          from jsonb_to_recordset(${jsonbLit(lote)}) as x(odoo_id int, empresa_id uuid, factura_odoo_id int, tipo text, pago_odoo_id int,
            documento_odoo_id int, descripcion text, monto_usd numeric, fecha date)
          join facturas f on f.odoo_id = x.factura_odoo_id
          on conflict (odoo_id) do update set empresa_id = excluded.empresa_id, factura_id = excluded.factura_id, tipo = excluded.tipo,
            pago_id = excluded.pago_id, documento_id = excluded.documento_id, descripcion = excluded.descripcion,
            monto_usd = excluded.monto_usd, fecha = excluded.fecha, odoo_sync_at = excluded.odoo_sync_at
          where (factura_aplicaciones.empresa_id, factura_aplicaciones.factura_id, factura_aplicaciones.tipo, factura_aplicaciones.pago_id,
            factura_aplicaciones.documento_id, factura_aplicaciones.descripcion, factura_aplicaciones.monto_usd, factura_aplicaciones.fecha)
          is distinct from (excluded.empresa_id, excluded.factura_id, excluded.tipo, excluded.pago_id, excluded.documento_id,
            excluded.descripcion, excluded.monto_usd, excluded.fecha)`);
      }
      await escribir(`
        delete from factura_aplicaciones where empresa_id = '${E}'
          and odoo_id <> all (array[${aplicaciones.map((a) => a.odoo_id).join(',') || 0}]::int[])`);

      // Compras y cuentas por pagar
      Object.assign(resumen.entidades[emp.nombre_corto], await escribirCompras({ ...ctxCompras, aplicar: true }));
      // Inventario: lotes, existencias por lote y transferencias (después de órdenes y compras, a las que se refieren)
      Object.assign(resumen.entidades[emp.nombre_corto], await escribirInventario({ ...ctxInv, aplicar: true }));
      // Tesorería: saldos de bancos, extractos de Odoo y depósitos por identificar
      Object.assign(resumen.entidades[emp.nombre_corto], await escribirTesoreria({ ...ctxTes, aplicar: true }));
    }

    // Fotos y descripciones de producto (bidireccionales, 20r): después de los productos, con la regla "gana el más reciente"
    log('\n[4] Fotos y descripciones de producto…');
    resumen.contenido = await sincronizarContenidoProductos({ odoo, sql, storage, aplicar, log, aviso,
      plantillas: datos.flatMap((d) => d.productos) });

    if (aplicar) {
      // Direcciones de entrega (la empresa es la del cliente)
      const filasDir = direcciones.map((a) => ({
        odoo_id: a.id, cliente_odoo_id: m2oId(a.parent_id), nombre: txt(a.name),
        direccion: [txt(a.street), txt(a.street2)].filter(Boolean).join(', ') || null, calle: txt(a.street), complemento: txt(a.street2),
        ciudad: txt(a.city), estado: m2oNombre(a.state_id), telefono: txt(a.phone) || txt(a.mobile), activo: !!a.active,
      }));
      for (const lote of lotes(filasDir, 500)) {
        await escribir(`
          insert into cliente_direcciones (odoo_id, cliente_id, empresa_id, nombre, direccion, calle, complemento, ciudad, estado, telefono, activo, odoo_sync_at)
          select x.odoo_id, c.id, c.empresa_id, x.nombre, x.direccion, x.calle, x.complemento, x.ciudad, x.estado, x.telefono, x.activo, '${ts}'
          from jsonb_to_recordset(${jsonbLit(lote)}) as x(odoo_id int, cliente_odoo_id int, nombre text, direccion text, calle text, complemento text,
            ciudad text, estado text, telefono text, activo boolean)
          join clientes c on c.odoo_id = x.cliente_odoo_id
          on conflict (odoo_id) do update set cliente_id = excluded.cliente_id, empresa_id = excluded.empresa_id, nombre = excluded.nombre,
            direccion = excluded.direccion, calle = excluded.calle, complemento = excluded.complemento, ciudad = excluded.ciudad,
            estado = excluded.estado, telefono = excluded.telefono, activo = excluded.activo, odoo_sync_at = excluded.odoo_sync_at, updated_at = now()
          where (cliente_direcciones.cliente_id, cliente_direcciones.empresa_id, cliente_direcciones.nombre, cliente_direcciones.direccion,
            cliente_direcciones.calle, cliente_direcciones.complemento, cliente_direcciones.ciudad, cliente_direcciones.estado,
            cliente_direcciones.telefono, cliente_direcciones.activo)
          is distinct from (excluded.cliente_id, excluded.empresa_id, excluded.nombre, excluded.direccion, excluded.calle, excluded.complemento,
            excluded.ciudad, excluded.estado, excluded.telefono, excluded.activo)`);
      }

      // Personas de contacto (20v): después de clientes y proveedores (se ligan por su odoo_id)
      resumen.contactos = await escribirContactos({ sql, escribir, leidos: contactosOdoo, ts, aplicar: true, log, aviso });

      // ── 6. Derivados ────────────────────────────────────────────────────
      log('\n[5] Recalculando derivados…');
      await escribir(`
        update productos p set stock_actual = s.stock
        from (select p2.id, greatest(0, round(coalesce(sum(ia.cantidad) filter (where a.tipo = 'propio'), 0)))::int stock
              from productos p2 left join inventario_almacen ia on ia.producto_id = p2.id left join almacenes a on a.id = ia.almacen_id
              where p2.odoo_id is not null group by p2.id) s
        where p.id = s.id and p.stock_actual is distinct from s.stock`);
      // Comprometido en Odoo: entregas y traslados a consignación pendientes que salen de almacenes propios
      // (confirmadas, en espera o listas; al validarse en Odoo baja la existencia y dejan de estar pendientes)
      await escribir(`
        update productos p set comprometido_odoo = s.c
        from (select p2.id, coalesce((
                select sum(ti.cantidad_demandada) from transferencia_items ti
                join transferencias t on t.id = ti.transferencia_id
                join almacenes ao on ao.id = t.almacen_origen_id and ao.tipo = 'propio'
                left join almacenes ad on ad.id = t.almacen_destino_id
                where ti.producto_id = p2.id and t.estado in ('en_espera', 'parcial', 'lista') and ti.estado not in ('hecha', 'cancelada')
                  and (ad.id is null or ad.tipo <> 'propio')), 0) c
              from productos p2 where p2.odoo_id is not null) s
        where p.id = s.id and p.comprometido_odoo is distinct from s.c`);
      await escribir(`
        update clientes c set credito_utilizado = s.saldo
        from (select c2.id, coalesce(sum(f.saldo_usd) filter (where f.estado = 'posted'), 0) saldo
              from clientes c2 left join facturas f on f.cliente_id = c2.id group by c2.id) s
        where c.id = s.id and c.credito_utilizado is distinct from s.saldo`);
      // Cobros de Odoo que ya no lo son (la carga vieja metió pagos entrantes de PROVEEDORES como cobros de clientes).
      // Se borran si nada de GUDS los usa; sus movimientos bancarios también (si no están conciliados).
      const idsCobros = datos.flatMap((d) => d.pagos.map((p) => p.id));
      const noCobros = `select id from pagos where odoo_id is not null and odoo_id <> all (array[${idsCobros.join(',') || 0}]::int[])
        and not exists (select 1 from pago_facturas pf where pf.pago_id = pagos.id)`;
      const [{ n: borrados }] = await sql(`
        delete from movimientos_bancarios m where m.pago_id in (${noCobros})
          and not exists (select 1 from extracto_lineas el where el.movimiento_bancario_id = m.id);
        with b as (delete from pagos where id in (${noCobros}) returning 1) select count(*)::int n from b`);
      if (borrados) log(`    pagos de Odoo que no son cobros de clientes, eliminados: ${borrados}`);

      // Movimientos bancarios de los cobros de Odoo (base de la conciliación)
      await escribir(`
        update movimientos_bancarios m set banco_id = p.banco_id, empresa_id = p.empresa_id, monto = p.monto_moneda,
          referencia = p.referencia, fecha = p.fecha_verificacion
        from pagos p where p.id = m.pago_id and p.odoo_id is not null and p.banco_id is not null
          and (m.banco_id, m.empresa_id, m.monto, m.referencia, m.fecha) is distinct from (p.banco_id, p.empresa_id, p.monto_moneda, p.referencia, p.fecha_verificacion);
        insert into movimientos_bancarios (banco_id, empresa_id, tipo, monto, referencia, descripcion, pago_id, fecha, origen)
        select p.banco_id, p.empresa_id, 'entrada', p.monto_moneda, p.referencia, 'Cobro cliente (Odoo)', p.id, p.fecha_verificacion, 'cobro'
        from pagos p where p.odoo_id is not null and p.banco_id is not null and p.estado = 'verificado'
          and not exists (select 1 from movimientos_bancarios m where m.pago_id = p.id);
        delete from movimientos_bancarios m using pagos p
        where p.id = m.pago_id and p.odoo_id is not null and p.estado <> 'verificado'
          and not exists (select 1 from extracto_lineas el where el.movimiento_bancario_id = m.id)`);

      // Pagos a proveedores y reintegros de proveedores (salidas y entradas del banco)
      await escribir(`
        update movimientos_bancarios m set banco_id = pp.banco_id, empresa_id = pp.empresa_id, monto = coalesce(pp.monto_moneda, pp.monto),
          referencia = pp.referencia, fecha = pp.fecha::timestamptz, tipo = case when pp.tipo = 'pago' then 'salida' else 'entrada' end
        from pagos_proveedor pp where pp.id = m.pago_proveedor_id and pp.banco_id is not null
          and (m.banco_id, m.empresa_id, m.monto, m.referencia, m.fecha, m.tipo) is distinct from
              (pp.banco_id, pp.empresa_id, coalesce(pp.monto_moneda, pp.monto), pp.referencia, pp.fecha::timestamptz, case when pp.tipo = 'pago' then 'salida' else 'entrada' end);
        insert into movimientos_bancarios (banco_id, empresa_id, tipo, monto, referencia, descripcion, pago_proveedor_id, fecha, origen)
        select pp.banco_id, pp.empresa_id, case when pp.tipo = 'pago' then 'salida' else 'entrada' end, coalesce(pp.monto_moneda, pp.monto), pp.referencia,
          case when pp.tipo = 'pago' then 'Pago a proveedor' else 'Reintegro de proveedor' end || coalesce(': ' || pv.nombre, ''), pp.id, pp.fecha::timestamptz,
          case when pp.tipo = 'pago' then 'pago_proveedor' else 'reintegro_proveedor' end
        from pagos_proveedor pp left join proveedores pv on pv.id = pp.proveedor_id
        where pp.banco_id is not null and pp.estado = 'verificado' and not exists (select 1 from movimientos_bancarios m where m.pago_proveedor_id = pp.id);
        delete from movimientos_bancarios m using pagos_proveedor pp
        where pp.id = m.pago_proveedor_id and pp.estado <> 'verificado'
          and not exists (select 1 from extracto_lineas el where el.movimiento_bancario_id = m.id)`);

      // Reintegros a clientes (salidas)
      await escribir(`
        update movimientos_bancarios m set banco_id = r.banco_id, empresa_id = r.empresa_id, monto = coalesce(r.monto_moneda, r.monto),
          referencia = r.referencia, fecha = r.fecha::timestamptz
        from reintegros r where r.id = m.reintegro_id and r.banco_id is not null
          and (m.banco_id, m.empresa_id, m.monto, m.referencia, m.fecha) is distinct from (r.banco_id, r.empresa_id, coalesce(r.monto_moneda, r.monto), r.referencia, r.fecha::timestamptz);
        insert into movimientos_bancarios (banco_id, empresa_id, tipo, monto, referencia, descripcion, reintegro_id, fecha, origen)
        select r.banco_id, r.empresa_id, 'salida', coalesce(r.monto_moneda, r.monto), r.referencia, 'Reintegro a cliente' || coalesce(': ' || c.nombre_negocio, ''),
          r.id, r.fecha::timestamptz, 'reintegro_cliente'
        from reintegros r left join clientes c on c.id = r.cliente_id
        where r.banco_id is not null and r.estado = 'verificado' and not exists (select 1 from movimientos_bancarios m where m.reintegro_id = r.id);
        delete from movimientos_bancarios m using reintegros r
        where r.id = m.reintegro_id and r.estado <> 'verificado'
          and not exists (select 1 from extracto_lineas el where el.movimiento_bancario_id = m.id)`);

      // Marcas de agua para la sincronización incremental
      await sql(`
        insert into sync_estado (entidad, empresa_id, ultima_marca, ultima_corrida_id, registros, actualizado_en)
        select x.entidad, x.empresa_id, x.ultima_marca, '${corridaId}', x.registros, now()
        from jsonb_to_recordset(${jsonbLit(marcas)}) as x(entidad text, empresa_id uuid, ultima_marca timestamptz, registros int)
        on conflict (entidad, empresa_id) do update set ultima_marca = excluded.ultima_marca, ultima_corrida_id = excluded.ultima_corrida_id,
          registros = excluded.registros, actualizado_en = now()`);
    }

    // ── 7. Huérfanos: en GUDS con odoo_id que ya no vienen de Odoo (se reportan; la política de borrado es de la Fase 9) ──
    const vistos = {
      clientes: datos.flatMap((d) => d.clientes.map((x) => x.id)), proveedores: datos.flatMap((d) => d.proveedores.map((x) => x.id)),
      productos: datos.flatMap((d) => d.productos.map((x) => x.id)),
      ordenes: datos.flatMap((d) => d.ordenes.map((x) => x.id)), facturas: datos.flatMap((d) => d.facturas.map((x) => x.id)),
      pagos: datos.flatMap((d) => d.pagos.map((x) => x.id)), almacenes: datos.flatMap((d) => d.almacenes.map((x) => x.id)),
    };
    const huerfanos = {};
    for (const [tabla, ids] of Object.entries(vistos)) {
      const r = await sql(`select count(*)::int n from ${tabla} where odoo_id is not null and odoo_id <> all (array[${ids.join(',') || 0}]::int[])`);
      if (r[0].n) huerfanos[tabla] = r[0].n;
    }
    resumen.huerfanos = huerfanos;
    if (Object.keys(huerfanos).length) aviso(`Registros con odoo_id que ya no vienen de Odoo: ${JSON.stringify(huerfanos)}`);

    resumen.segundos = Math.round((Date.now() - t0) / 1000);
    if (aplicar) {
      await sql(`update sync_corridas set estado = 'ok', terminado_en = now(), resumen = ${jsonbLit(resumen)} where id = '${corridaId}'`);
    }
    log(`\n✓ ${aplicar ? 'Importación aplicada' : 'Simulación terminada'} en ${resumen.segundos}s`);
    return resumen;
  } catch (e) {
    if (corridaId) {
      await sql(`update sync_corridas set estado = 'error', terminado_en = now(), error = '${String(e.message).replace(/'/g, "''")}', resumen = ${jsonbLit(resumen)} where id = '${corridaId}'`).catch(() => {});
    }
    throw e;
  }
}
