/**
 * Fase 17 · Asigna empresa_id a los datos que ya existen en Supabase, leyendo la empresa de cada
 * registro en Odoo (solo lectura). Se corre entre las migraciones 17a y 17b.
 *
 *   node scripts/multiempresa-backfill.mjs            → simulación: muestra qué haría
 *   node scripts/multiempresa-backfill.mjs --apply    → escribe en Supabase
 *
 * Reglas:
 *   - Registro con odoo_id: la empresa (company_id) que tiene en Odoo. company_id vacío en Odoo = compartido (null).
 *   - Tablas hijas: la empresa de su tabla principal.
 *   - Lo creado en GUDS sin equivalente en Odoo (bancos manuales, banners, registros): GUDS.
 *   - Usuarios: administradores y delivery en ambas; vendedores según sus empresas en Odoo (por nombre),
 *     o ambas si no se encuentran.
 */
import { conectarOdoo, leerPorIds, odooRead, m2oId } from './lib/odoo.mjs';
import { sql, jsonbLit, lotes } from './lib/supabase-admin.mjs';

const APPLY = process.argv.includes('--apply');
const log = (...a) => console.log(...a);

await conectarOdoo();
const empresas = await sql(`select id, odoo_company_id, nombre_corto from empresas order by orden`);
const porOdoo = Object.fromEntries(empresas.map(e => [e.odoo_company_id, e.id]));
const GUDS = porOdoo[1];
log(`Empresas: ${empresas.map(e => `${e.nombre_corto} (Odoo ${e.odoo_company_id})`).join(', ')}`);
log(APPLY ? '→ MODO APLICAR\n' : '→ SIMULACIÓN (usa --apply para escribir)\n');

// ── 1. Tablas con odoo_id: empresa según Odoo ─────────────────────────────
const mapeos = [
  { tabla: 'clientes', modelo: 'res.partner' },
  { tabla: 'productos', modelo: 'product.template' },
  { tabla: 'ordenes', modelo: 'sale.order' },
  { tabla: 'facturas', modelo: 'account.move' },
  { tabla: 'pagos', modelo: 'account.payment' },
  { tabla: 'almacenes', modelo: 'stock.warehouse' },
  { tabla: 'bancos', modelo: 'account.journal' },
  { tabla: 'retenciones', modelo: 'account.wh.iva', filtro: `tipo = 'iva'` },
  { tabla: 'retenciones', modelo: 'account.wh.islr', filtro: `tipo = 'islr'` },
];

for (const m of mapeos) {
  const filas = await sql(`select odoo_id from ${m.tabla} where odoo_id is not null${m.filtro ? ` and ${m.filtro}` : ''}`);
  const ids = filas.map(f => f.odoo_id);
  if (!ids.length) { log(`${m.tabla} (${m.modelo}): sin registros`); continue; }
  const odoo = await leerPorIds(m.modelo, ids, ['company_id']);
  const encontrados = new Set(odoo.map(r => r.id));
  const pares = odoo.map(r => ({ odoo_id: r.id, empresa_id: porOdoo[m2oId(r.company_id)] ?? null }));
  const cuenta = pares.reduce((acc, p) => {
    const k = empresas.find(e => e.id === p.empresa_id)?.nombre_corto ?? 'compartido';
    acc[k] = (acc[k] || 0) + 1; return acc;
  }, {});
  const faltan = ids.filter(id => !encontrados.has(id));
  log(`${m.tabla} (${m.modelo}): ${JSON.stringify(cuenta)}${faltan.length ? ` · ${faltan.length} ya no existen en Odoo` : ''}`);
  if (APPLY) {
    for (const lote of lotes(pares, 1000)) {
      await sql(`update ${m.tabla} t set empresa_id = x.empresa_id
        from jsonb_to_recordset(${jsonbLit(lote)}) as x(odoo_id int, empresa_id uuid)
        where t.odoo_id = x.odoo_id${m.filtro ? ` and t.${m.filtro}` : ''}`);
    }
  }
}

// ── 2. Lo creado en GUDS sin equivalente en Odoo → GUDS ───────────────────
const soloGuds = [
  `update bancos set empresa_id = '${GUDS}' where odoo_id is null and empresa_id is null`,
  `update banners set empresa_id = '${GUDS}' where empresa_id is null`,
  `update registros_clientes set empresa_id = '${GUDS}' where empresa_id is null`,
  `update cupones set empresa_id = '${GUDS}' where empresa_id is null`,
  `update metas_vendedor set empresa_id = '${GUDS}' where empresa_id is null`,
  `update carrito set empresa_id = coalesce((select p.empresa_id from productos p where p.id = carrito.producto_id), '${GUDS}') where empresa_id is null`,
  `update favoritos set empresa_id = coalesce((select p.empresa_id from productos p where p.id = favoritos.producto_id), '${GUDS}') where empresa_id is null`,
  `update extractos_bancarios e set empresa_id = coalesce((select b.empresa_id from bancos b where b.id = e.banco_id), '${GUDS}') where e.empresa_id is null`,
  `update declaraciones_consignacion d set empresa_id = coalesce((select a.empresa_id from almacenes a where a.id = d.almacen_id), '${GUDS}') where d.empresa_id is null`,
  `update ordenes set empresa_id = '${GUDS}' where odoo_id is null and empresa_id is null`,
  `update pagos set empresa_id = coalesce((select o.empresa_id from ordenes o where o.id = pagos.orden_id), '${GUDS}') where odoo_id is null and empresa_id is null`,
  `update facturas set empresa_id = coalesce((select o.empresa_id from ordenes o where o.id = facturas.orden_id), '${GUDS}') where odoo_id is null and empresa_id is null`,
  `update retenciones set empresa_id = '${GUDS}' where odoo_id is null and empresa_id is null`,
];

// ── 3. Tablas hijas: heredan de su tabla principal ────────────────────────
const hijas = [
  `update orden_items h set empresa_id = p.empresa_id from ordenes p where p.id = h.orden_id and h.empresa_id is distinct from p.empresa_id`,
  `update entregas h set empresa_id = p.empresa_id from ordenes p where p.id = h.orden_id and h.empresa_id is distinct from p.empresa_id`,
  `update factura_items h set empresa_id = p.empresa_id from facturas p where p.id = h.factura_id and h.empresa_id is distinct from p.empresa_id`,
  `update retencion_items h set empresa_id = p.empresa_id from retenciones p where p.id = h.retencion_id and h.empresa_id is distinct from p.empresa_id`,
  `update pago_facturas h set empresa_id = p.empresa_id from pagos p where p.id = h.pago_id and h.empresa_id is distinct from p.empresa_id`,
  `update pago_ordenes h set empresa_id = p.empresa_id from pagos p where p.id = h.pago_id and h.empresa_id is distinct from p.empresa_id`,
  `update pago_cuentas h set empresa_id = p.empresa_id from pagos p where p.id = h.pago_id and h.empresa_id is distinct from p.empresa_id`,
  `update movimientos_bancarios h set empresa_id = coalesce(pg.empresa_id, b.empresa_id)
     from movimientos_bancarios m left join pagos pg on pg.id = m.pago_id left join bancos b on b.id = m.banco_id
     where m.id = h.id and h.empresa_id is distinct from coalesce(pg.empresa_id, b.empresa_id)`,
  `update extracto_lineas h set empresa_id = p.empresa_id from extractos_bancarios p where p.id = h.extracto_id and h.empresa_id is distinct from p.empresa_id`,
  `update declaracion_consignacion_items h set empresa_id = p.empresa_id from declaraciones_consignacion p where p.id = h.declaracion_id and h.empresa_id is distinct from p.empresa_id`,
  `update inventario_almacen h set empresa_id = p.empresa_id from almacenes p where p.id = h.almacen_id and h.empresa_id is distinct from p.empresa_id`,
  `update producto_empaques h set empresa_id = p.empresa_id from productos p where p.id = h.producto_id and h.empresa_id is distinct from p.empresa_id`,
  `update precios_lista h set empresa_id = p.empresa_id from listas_precios p where p.id = h.lista_precios_id and h.empresa_id is distinct from p.empresa_id`,
  `update movimientos_inventario h set empresa_id = coalesce(p.empresa_id, '${GUDS}') from productos p where p.id = h.producto_id and h.empresa_id is null`,
  `update cuentas_cobrar h set empresa_id = coalesce(p.empresa_id, '${GUDS}') from clientes p where p.id = h.cliente_id and h.empresa_id is null`,
];

if (APPLY) {
  for (const q of [...soloGuds, ...hijas]) await sql(q);
  log('\n✓ Registros propios de GUDS y tablas hijas actualizados');
}

// ── 4. Empresas de cada usuario ────────────────────────────────────────────
const usuarios = await sql(`select id, nombre, apellido, email, role from usuarios where coalesce(activo, true)`);
const odooUsers = await odooRead('res.users', 'search_read', [[['share', '=', false]]], { fields: ['name', 'company_id', 'company_ids'] });
const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const odooPorNombre = new Map(odooUsers.map(u => [norm(u.name), u]));

const asignaciones = [];
const resumen = [];
for (const u of usuarios) {
  let ids = empresas.map(e => e.id);
  let defecto = GUDS;
  let origen = u.role === 'vendedor' ? 'ambas (no está en Odoo)' : `ambas (${u.role})`;
  if (u.role === 'vendedor') {
    const ou = odooPorNombre.get(norm(`${u.nombre} ${u.apellido || ''}`)) || odooPorNombre.get(norm(u.nombre));
    if (ou) {
      const permitidas = ou.company_ids.map(c => porOdoo[c]).filter(Boolean);
      if (permitidas.length) {
        ids = permitidas;
        defecto = porOdoo[m2oId(ou.company_id)] ?? permitidas[0];
        origen = `Odoo: ${permitidas.map(id => empresas.find(e => e.id === id).nombre_corto).join(' + ')}`;
      }
    }
  }
  for (const id of ids) asignaciones.push({ usuario_id: u.id, empresa_id: id, por_defecto: id === defecto });
  resumen.push({ usuario: u.email, rol: u.role, empresas: origen });
}
console.table(resumen);
if (APPLY) {
  await sql(`insert into usuario_empresas (usuario_id, empresa_id, por_defecto)
    select * from jsonb_to_recordset(${jsonbLit(asignaciones)}) as x(usuario_id uuid, empresa_id uuid, por_defecto boolean)
    on conflict (usuario_id, empresa_id) do update set por_defecto = excluded.por_defecto`);
  log('✓ usuario_empresas cargado');
}

// ── 5. Qué queda sin empresa ───────────────────────────────────────────────
const tablas = ['productos', 'clientes', 'listas_precios', 'precios_lista', 'producto_empaques', 'bancos', 'almacenes',
  'inventario_almacen', 'movimientos_inventario', 'cupones', 'banners', 'metas_vendedor', 'registros_clientes',
  'notificaciones', 'carrito', 'favoritos', 'ordenes', 'orden_items', 'entregas', 'facturas', 'factura_items', 'pagos',
  'pago_facturas', 'pago_ordenes', 'pago_cuentas', 'cuentas_cobrar', 'movimientos_bancarios', 'extractos_bancarios',
  'extracto_lineas', 'declaraciones_consignacion', 'declaracion_consignacion_items', 'retenciones', 'retencion_items'];
const conteo = await sql(tablas.map(t => `select '${t}' tabla, count(*) total, count(*) filter (where empresa_id is null) sin_empresa,
  count(*) filter (where empresa_id = '${GUDS}') guds, count(*) filter (where empresa_id = '${porOdoo[3]}') quirutec from ${t}`).join(' union all '));
console.table(conteo.filter(c => Number(c.total) > 0));
