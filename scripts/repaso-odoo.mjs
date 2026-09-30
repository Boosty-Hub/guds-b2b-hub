/**
 * Repaso Odoo ↔ GUDS por empresa (solo lectura en ambos lados), complementa scripts/cuadre-odoo.mjs:
 *   · huérfanos: filas de GUDS cuyo registro ya no existe en Odoo (productos, facturas, transferencias, cobros, clientes)
 *   · órdenes por estado, facturas por estado de pago y documentos de entrega abiertos, lado a lado
 *
 *   node scripts/repaso-odoo.mjs
 */
import { requerir } from './lib/entorno.mjs';
import { sql } from './lib/supabase-admin.mjs';
import { crearClienteOdoo } from '../supabase/functions/_shared/odoo-sync/odoo.js';
const { ODOO_URL, ODOO_DB, ODOO_USER, ODOO_API_KEY } = requerir('ODOO_URL', 'ODOO_DB', 'ODOO_USER', 'ODOO_API_KEY');
const odoo = crearClienteOdoo({ url: ODOO_URL, db: ODOO_DB, usuario: ODOO_USER, apiKey: ODOO_API_KEY });
await odoo.autenticar();
const empresas = await sql(`select id, odoo_company_id cid, nombre_corto from empresas where odoo_company_id is not null order by orden`);
const out = {};
const ids = async (modelo, dom, cid, archivados = false) => new Set((await odoo.leerTodo(modelo, [...dom, ...(archivados ? [['active', 'in', [true, false]]] : [])], ['id'], { empresa: cid })).map((r) => r.id));
const contar = (arr, k) => arr.reduce((m, r) => { const v = Array.isArray(r[k]) ? r[k][1] : r[k]; m[v] = (m[v] || 0) + 1; return m; }, {});

for (const e of empresas) {
  const r = (out[e.nombre_corto] = {});
  const cid = e.cid;
  // Huérfanos: filas de GUDS con odoo_id que Odoo ya no tiene (ni archivadas)
  const huerf = async (tabla, modelo, dom, archivados, extra = '') => {
    const enOdoo = await ids(modelo, dom, cid, archivados);
    const g = await sql(`select odoo_id from ${tabla} where empresa_id = '${e.id}' and odoo_id is not null ${extra}`);
    const faltan = g.filter((x) => !enOdoo.has(Number(x.odoo_id)));
    return { guds: g.length, odoo: enOdoo.size, en_guds_no_en_odoo: faltan.length, ejemplos: faltan.slice(0, 5).map((x) => x.odoo_id) };
  };
  r.productos = await huerf('productos', 'product.template', [['company_id', 'in', [cid, false]]], true);
  r.facturas = await huerf('facturas', 'account.move', [['company_id', '=', cid], ['move_type', 'in', ['out_invoice', 'out_refund']]], false);
  r.transferencias = await huerf('transferencias', 'stock.picking', [['company_id', '=', cid]], false);
  r.cobros = await huerf('pagos', 'account.payment', [['company_id', '=', cid]], false);
  // Clientes: la tabla guarda empresa por cliente (los compartidos con empresa nula no entran aquí)
  r.clientes = await huerf('clientes', 'res.partner', [['company_id', 'in', [cid, false]]], true);

  // Estados de órdenes y facturas
  const so = await odoo.leerTodo('sale.order', [['company_id', '=', cid]], ['state'], { empresa: cid });
  r.ordenes_estado_odoo = contar(so, 'state');
  r.ordenes_estado_guds = Object.fromEntries((await sql(`select coalesce(estado_odoo, '—') k, count(*)::int n from ordenes where empresa_id = '${e.id}' and odoo_id is not null group by 1`)).map((x) => [x.k, x.n]));
  const inv = await odoo.leerTodo('account.move', [['company_id', '=', cid], ['move_type', '=', 'out_invoice'], ['state', '=', 'posted']], ['payment_state'], { empresa: cid });
  r.facturas_pago_odoo = contar(inv, 'payment_state');
  r.facturas_pago_guds = Object.fromEntries((await sql(`select coalesce(estado_pago, '—') k, count(*)::int n from facturas where empresa_id = '${e.id}' and odoo_id is not null and tipo = 'factura' and estado = 'posted' group by 1`).catch(async () => [{ k: 'columna distinta', n: 0 }])).map((x) => [x.k, x.n]));

  // Documentos de entrega abiertos (cola de delivery)
  const pk = await odoo.leerTodo('stock.picking', [['company_id', '=', cid], ['picking_type_code', '=', 'outgoing'], ['state', 'in', ['draft', 'waiting', 'confirmed', 'assigned']]], ['state'], { empresa: cid });
  r.entregas_abiertas_odoo = contar(pk, 'state');
  r.entregas_abiertas_guds = Object.fromEntries((await sql(`select estado k, count(*)::int n from transferencias where empresa_id = '${e.id}' and tipo = 'entrega' and estado in ('borrador', 'en_espera', 'lista') group by 1`)).map((x) => [x.k, x.n]));

}
console.log(JSON.stringify(out, null, 1));
