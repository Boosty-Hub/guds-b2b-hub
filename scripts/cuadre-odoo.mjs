/**
 * Cuadre Odoo ↔ GUDS por empresa (solo lectura en ambos lados): cantidades y totales en USD,
 * más controles de coherencia multiempresa en GUDS. Sale con código 1 si algo no cuadra.
 *
 *   node scripts/cuadre-odoo.mjs
 */
import { requerir } from './lib/entorno.mjs';
import { sql } from './lib/supabase-admin.mjs';
import { crearClienteOdoo } from '../supabase/functions/_shared/odoo-sync/odoo.js';

const { ODOO_URL, ODOO_DB, ODOO_USER, ODOO_API_KEY } = requerir('ODOO_URL', 'ODOO_DB', 'ODOO_USER', 'ODOO_API_KEY');
const odoo = crearClienteOdoo({ url: ODOO_URL, db: ODOO_DB, usuario: ODOO_USER, apiKey: ODOO_API_KEY });
await odoo.autenticar();

const empresas = await sql(`select id, odoo_company_id, nombre_corto from empresas where odoo_company_id is not null order by orden`);
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const filas = [];
let fallas = 0;
const comparar = (empresa, concepto, odooVal, gudsVal, tolerancia = 0.011) => {
  const ok = Math.abs(Number(odooVal) - Number(gudsVal)) <= tolerancia;
  if (!ok) fallas++;
  filas.push({ ok: ok ? '✓' : '✗', empresa, concepto, odoo: odooVal, guds: gudsVal });
};
const suma = (recs, campo) => r2(recs.reduce((s, r) => s + Number(r[campo] || 0), 0));

for (const e of empresas) {
  const cid = e.odoo_company_id;
  const leer = (m, dom, f) => odoo.leerTodo(m, [...dom, ['company_id', '=', cid]], f, { empresa: cid });
  const g = (await sql(`select
      (select count(*) from ordenes where empresa_id = '${e.id}' and odoo_id is not null and estado_odoo is distinct from 'eliminada')::int ordenes,  -- borradas en Odoo: GUDS las conserva canceladas (20u)
      (select coalesce(sum(total), 0) from ordenes where empresa_id = '${e.id}' and odoo_id is not null and estado <> 'cancelado') total_ordenes,
      (select count(*) from facturas where empresa_id = '${e.id}' and odoo_id is not null and tipo = 'factura')::int facturas,
      (select count(*) from facturas where empresa_id = '${e.id}' and odoo_id is not null and tipo = 'nota_credito')::int notas_credito,
      (select coalesce(sum(total_usd), 0) from facturas where empresa_id = '${e.id}' and odoo_id is not null and estado = 'posted') facturado_usd,
      (select coalesce(sum(saldo_odoo_usd), 0) from facturas where empresa_id = '${e.id}' and odoo_id is not null and estado = 'posted') saldo_usd,
      (select count(*) from pagos where empresa_id = '${e.id}' and odoo_id is not null)::int cobros,
      (select coalesce(sum(monto), 0) from pagos where empresa_id = '${e.id}' and odoo_id is not null and estado = 'verificado') cobrado_usd,
      (select count(*) from retenciones where empresa_id = '${e.id}' and odoo_model = 'account.wh.iva')::int retenciones,
      (select count(*) from almacenes where empresa_id = '${e.id}')::int almacenes`))[0];

  const ordenes = await leer('sale.order', [], ['amount_total', 'amount_total_ref', 'currency_id', 'ref_currency_id', 'state', 'partner_id']);
  const usdOrden = (o) => (o.currency_id[0] === 1 ? o.amount_total : o.ref_currency_id && o.ref_currency_id[0] === 1 ? o.amount_total_ref : o.amount_total);
  const facturas = await leer('account.move', [['move_type', 'in', ['out_invoice', 'out_refund']], ['state', 'in', ['posted', 'cancel']], ['commercial_partner_id', '!=', false]],
    ['move_type', 'state', 'amount_total_signed', 'amount_residual_signed']);
  const cobros = await leer('account.payment', [['payment_type', '=', 'inbound'], ['partner_type', '=', 'customer'], ['partner_id', '!=', false]],
    ['state', 'amount_company_currency_signed']);
  const retenciones = await leer('account.wh.iva', [['move_type', 'in', ['out_invoice', 'out_refund']]], ['id']);
  const almacenes = await leer('stock.warehouse', [], ['id']);
  const publicadas = facturas.filter((f) => f.state === 'posted');

  comparar(e.nombre_corto, 'Órdenes (todas)', ordenes.length, g.ordenes);
  comparar(e.nombre_corto, 'Total órdenes no canceladas USD', r2(ordenes.filter((o) => o.state !== 'cancel').reduce((s, o) => s + usdOrden(o), 0)), r2(g.total_ordenes), 1);
  comparar(e.nombre_corto, 'Facturas', facturas.filter((f) => f.move_type === 'out_invoice').length, g.facturas);
  comparar(e.nombre_corto, 'Notas de crédito', facturas.filter((f) => f.move_type === 'out_refund').length, g.notas_credito);
  comparar(e.nombre_corto, 'Facturado neto USD (publicadas)', suma(publicadas, 'amount_total_signed'), r2(g.facturado_usd), 0.5);
  comparar(e.nombre_corto, 'Cuentas por cobrar USD (saldo)', suma(publicadas, 'amount_residual_signed'), r2(g.saldo_usd), 0.5);
  comparar(e.nombre_corto, 'Cobros', cobros.length, g.cobros);
  comparar(e.nombre_corto, 'Cobrado USD (verificado)',
    r2(cobros.filter((p) => p.state === 'paid' || p.state === 'in_process').reduce((s, p) => s + Math.abs(p.amount_company_currency_signed || 0), 0)), r2(g.cobrado_usd), 0.5);
  comparar(e.nombre_corto, 'Retenciones IVA recibidas', retenciones.length, g.retenciones);
  comparar(e.nombre_corto, 'Almacenes', almacenes.length, g.almacenes);

  // Compras y cuentas por pagar (Fase 5)
  const gc = (await sql(`select
      (select count(*) from ordenes_compra where empresa_id = '${e.id}')::int oc,
      (select count(*) from facturas_proveedor where empresa_id = '${e.id}')::int facturas_prov,
      (select coalesce(sum(saldo_usd), 0) from facturas_proveedor where empresa_id = '${e.id}' and estado = 'posted') cxp,
      (select count(*) from pagos_proveedor where empresa_id = '${e.id}')::int pagos_prov,
      (select count(*) from retenciones_emitidas where empresa_id = '${e.id}')::int ret_emitidas`))[0];
  const oc = await leer('purchase.order', [], ['id']);
  const fprov = await leer('account.move', [['move_type', 'in', ['in_invoice', 'in_refund']], ['state', 'in', ['posted', 'cancel']]],
    ['state', 'amount_residual_signed']);
  const pprov = await leer('account.payment', [['partner_type', '=', 'supplier']], ['id']);
  const rIva = await leer('account.wh.iva', [['move_type', 'in', ['in_invoice', 'in_refund']]], ['id']);
  const rIslr = await leer('account.wh.islr', [], ['id']);
  comparar(e.nombre_corto, 'Órdenes de compra', oc.length, gc.oc);
  comparar(e.nombre_corto, 'Facturas de proveedor (+NC)', fprov.length, gc.facturas_prov);
  comparar(e.nombre_corto, 'Cuentas por pagar USD (saldo)', r2(-fprov.filter((f) => f.state === 'posted').reduce((s, f) => s + Number(f.amount_residual_signed || 0), 0)), r2(gc.cxp), 0.5);
  comparar(e.nombre_corto, 'Pagos y reintegros de proveedores', pprov.length, gc.pagos_prov);
  comparar(e.nombre_corto, 'Retenciones emitidas (IVA + ISLR)', rIva.length + rIslr.length, gc.ret_emitidas);

  // Inventario (Fase 6)
  const gi = (await sql(`select
      (select count(*) from lotes where empresa_id = '${e.id}')::int lotes,
      (select count(*) from inventario_lotes where empresa_id = '${e.id}')::int quants,
      (select coalesce(sum(cantidad), 0) from inventario_lotes where empresa_id = '${e.id}') cantidad,
      (select coalesce(sum(reservado), 0) from inventario_lotes where empresa_id = '${e.id}') reservado,
      (select count(*) from transferencias where empresa_id = '${e.id}')::int transf,
      (select count(*) from transferencia_items where empresa_id = '${e.id}')::int movs,
      (select count(*) from transferencia_lotes where empresa_id = '${e.id}')::int lineas`))[0];
  const lotesO = await leer('stock.lot', [], ['id']);
  const quantsO = await leer('stock.quant', [['location_id.usage', '=', 'internal']], ['quantity', 'reserved_quantity']);
  const transfO = await leer('stock.picking', [], ['id']);
  const nMovs = await odoo.leer('stock.move', 'search_count', [[['company_id', '=', cid], ['picking_id', '!=', false]]], {}, cid);
  const nLineas = await odoo.leer('stock.move.line', 'search_count',
    [[['company_id', '=', cid], ['picking_id', '!=', false], '|', ['lot_id', '!=', false], ['lot_name', '!=', false]]], {}, cid);
  comparar(e.nombre_corto, 'Lotes y series', lotesO.length, gi.lotes);
  comparar(e.nombre_corto, 'Existencias por ubicación y lote', quantsO.length, gi.quants);
  comparar(e.nombre_corto, 'Unidades en existencia', suma(quantsO, 'quantity'), r2(gi.cantidad), 0.01);
  comparar(e.nombre_corto, 'Unidades reservadas', suma(quantsO, 'reserved_quantity'), r2(gi.reservado), 0.01);
  comparar(e.nombre_corto, 'Transferencias', transfO.length, gi.transf);
  comparar(e.nombre_corto, 'Movimientos de transferencias', nMovs, gi.movs);
  comparar(e.nombre_corto, 'Líneas con lote (trazabilidad)', nLineas, gi.lineas);
  // Tesorería (Fase 7)
  const gt = (await sql(`select
      (select count(*) from extractos_odoo where empresa_id = '${e.id}')::int extractos,
      (select count(*) from extracto_odoo_lineas where empresa_id = '${e.id}')::int lineas,
      (select count(*) from extracto_odoo_lineas where empresa_id = '${e.id}' and conciliada)::int conciliadas,
      (select coalesce(sum(monto), 0) from extracto_odoo_lineas where empresa_id = '${e.id}') neto`))[0];
  const lineasO = await leer('account.bank.statement.line', [], ['amount', 'is_reconciled']);
  comparar(e.nombre_corto, 'Extractos bancarios', await odoo.leer('account.bank.statement', 'search_count', [[['journal_id.company_id', '=', cid]]], {}, cid), gt.extractos);
  comparar(e.nombre_corto, 'Líneas de extracto', lineasO.length, gt.lineas);
  comparar(e.nombre_corto, 'Líneas de extracto conciliadas', lineasO.filter((l) => l.is_reconciled).length, gt.conciliadas);
  comparar(e.nombre_corto, 'Movimiento neto de extractos', suma(lineasO, 'amount'), r2(gt.neto), 0.5);
  const nAjustes = await odoo.leer('stock.move.line', 'search_count', [[['company_id', '=', cid], ['picking_id', '=', false], ['state', '=', 'done']]], {}, cid);
  comparar(e.nombre_corto, 'Ajustes de inventario', nAjustes, (await sql(`select count(*)::int n from ajustes_inventario where empresa_id = '${e.id}'`))[0].n);
}

// Coherencia multiempresa en GUDS (todo debe dar 0)
const coh = (await sql(`select
  (select count(*) from pagos p join bancos b on b.id = p.banco_id where b.empresa_id <> p.empresa_id)::int pagos_banco_otra_empresa,
  (select count(*) from ordenes o join clientes c on c.id = o.cliente_id where c.empresa_id is not null and c.empresa_id <> o.empresa_id)::int ordenes_cliente_otra_empresa,
  (select count(*) from facturas f join clientes c on c.id = f.cliente_id where c.empresa_id is not null and c.empresa_id <> f.empresa_id)::int facturas_cliente_otra_empresa,
  (select count(*) from orden_items i join ordenes o on o.id = i.orden_id where i.empresa_id <> o.empresa_id)::int items_empresa_distinta,
  (select count(*) from retencion_items ri join facturas f on f.id = ri.factura_id where f.empresa_id <> ri.empresa_id)::int retenciones_factura_otra_empresa,
  (select count(*) from movimientos_bancarios m join pagos p on p.id = m.pago_id where m.banco_id <> p.banco_id or m.empresa_id <> p.empresa_id)::int movimientos_desalineados,
  (select count(*) from ordenes where odoo_id is not null and numero ~ '-[0-9]+$' and numero !~ '^ODOO-')::int numeros_con_sufijo_viejo,
  (select count(*) from almacenes a join clientes c on c.id = a.cliente_id where c.empresa_id is not null and c.empresa_id <> a.empresa_id)::int consignacion_cliente_otra_empresa,
  (select count(*) from transferencias t join clientes c on c.id = t.cliente_id where c.empresa_id is not null and c.empresa_id <> t.empresa_id)::int transferencias_cliente_otra_empresa,
  (select count(*) from inventario_lotes il join almacenes a on a.id = il.almacen_id where a.empresa_id <> il.empresa_id)::int existencias_almacen_otra_empresa,
  (select count(*) from pagos_proveedor pp where pp.estado = 'verificado' and pp.banco_id is not null
     and not exists (select 1 from movimientos_bancarios m where m.pago_proveedor_id = pp.id))::int pagos_proveedor_sin_movimiento,
  (select count(*) from reintegros r where r.estado = 'verificado' and r.banco_id is not null
     and not exists (select 1 from movimientos_bancarios m where m.reintegro_id = r.id))::int reintegros_sin_movimiento,
  (select count(*) from movimientos_bancarios m join bancos b on b.id = m.banco_id where b.empresa_id <> m.empresa_id)::int movimientos_banco_otra_empresa,
  (select count(*) from pagos where es_igtf and igtf_origen_id is null)::int igtf_sin_pago_origen`))[0];
for (const [k, v] of Object.entries(coh)) comparar('—', `Coherencia: ${k}`, 0, v, 0);

console.table(filas);
console.log(fallas ? `✗ ${fallas} diferencia(s)` : `✓ Todo cuadra (${filas.length} controles)`);
process.exit(fallas ? 1 : 0);
