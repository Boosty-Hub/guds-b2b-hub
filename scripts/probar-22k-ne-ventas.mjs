/**
 * Pruebas de la fase 22k: las notas de entrega cuentan en los reportes de ventas, diferenciadas (Reportes → Ventas, Análisis
 * y Metas, las metas de Vendedores y el resumen del vendedor).
 * Mismo estilo que probar-22j: cada caso corre en un bloque que termina en excepción (se deshace todo: las notas de prueba
 * que se insertan no quedan; nada de esto toca Odoo).
 *
 *   node scripts/probar-22k-ne-ventas.mjs
 */
import { sql } from './lib/supabase-admin.mjs';

const emps = await sql(`select id, nombre_corto from empresas order by orden`);
const guds = emps.find((e) => e.nombre_corto === 'GUDS'), qrt = emps.find((e) => e.nombre_corto === 'Quirutec');
const hoy = (await sql(`select (now() at time zone 'America/Caracas')::date d`))[0].d;
const usuarioDe = async (rol) => (await sql(`select u.auth_id from usuarios u join roles r on r.id = u.rol_id
  where r.nombre = '${rol}' and u.auth_id is not null and coalesce(u.activo, true) order by u.created_at limit 1`))[0]?.auth_id;
const admin = await usuarioDe('Administrador');
const contador = await usuarioDe('Contador');
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
// Cliente de GUDS con vendedor (con sesión) y dos productos con categoría, para la nota de prueba
const base = (await sql(`
  select c.id cliente, c.nombre_negocio nombre, u.auth_id vendedor, u.id vendedor_id,
         (select array_agg(p.id order by p.sku) from (select id, sku from productos where categoria_id is not null and activo order by sku limit 2) p) productos
    from clientes c join usuarios u on u.id = c.vendedor_asignado_id
   where c.empresa_id = '${guds.id}' and c.activo and u.auth_id is not null and coalesce(u.activo, true) and u.role = 'vendedor'
   order by c.created_at limit 1`))[0];
if (!base?.cliente || base.productos?.length !== 2) { console.error('No hay un cliente de GUDS con vendedor y dos productos con categoría'); process.exit(1); }

async function como({ uid = admin, empresa = qrt.id, previo = '', decl = '' }, cuerpo) {
  const claims = JSON.stringify(uid ? { sub: uid, role: 'authenticated' } : { role: 'authenticated' });
  const headers = JSON.stringify(empresa ? { 'x-empresa-id': empresa } : {});
  const q = `do $bloque$
    declare v text; n uuid; r jsonb; x record; ${decl}
    begin
      ${previo}
      perform set_config('request.jwt.claims', ${lit(claims)}, true);
      perform set_config('request.headers', ${lit(headers)}, true);
      execute 'set local role authenticated';
      ${cuerpo}
      raise exception 'RESULTADO:%', coalesce(v, 'null');
    end $bloque$;`;
  for (let intento = 1; ; intento++) {
    try {
      await sql(q);
      return { error: 'el bloque no terminó en excepción (no debería pasar)' };
    } catch (e) {
      const m = e.message.match(/RESULTADO:(.*)$/m);
      if (m) return { ok: m[1] };
      if (/fetch failed/.test(e.message) && intento < 4) { await new Promise((s) => setTimeout(s, 3000 * intento)); continue; }
      return { error: e.message.replace(/^\d+: Failed to run sql query: ERROR:\s+\w+: /, '').split('\n')[0] };
    }
  }
}

const casos = [];
async function caso(nombre, verificar, promesa) {
  const r = await promesa;
  const texto = r.error ? `ERROR: ${r.error}` : r.ok;
  let ok = false;
  try { ok = typeof verificar === 'function' ? verificar(r.ok ? JSON.parse(r.ok) : null, r.error) : texto.includes(verificar); } catch { ok = false; }
  casos.push({ ok: ok ? '✓' : '✗', caso: nombre, resultado: String(texto).slice(0, 140) });
  if (process.env.AVANCE) console.error(`${ok ? '✓' : '✗'} ${nombre}`);
}
const cerca = (a, b, t = 0.05) => Math.abs(Number(a) - Number(b)) <= t;
const D = `'2022-01-01'`, H = `'${hoy}'`;
// Lo no facturado de las N/E vigentes de unas empresas en un rango (la regla: ne_saldos al cierre del período)
const NE_ESPERADO = (emp, d = D, h = H) => `(select coalesce(round(sum(s.sin_facturar), 2), 0) from notas_entrega n join public.ne_saldos(${h}::date) s on s.nota_id = n.id
  where n.empresa_id = any (${emp}) and n.estado not in ('borrador', 'anulada') and n.fecha_emision between ${d} and ${h} and abs(s.sin_facturar) > 0.004)`;
const N_ESPERADO = (emp, d = D, h = H) => `(select count(*) from notas_entrega n join public.ne_saldos(${h}::date) s on s.nota_id = n.id
  where n.empresa_id = any (${emp}) and n.estado not in ('borrador', 'anulada') and n.fecha_emision between ${d} and ${h} and abs(s.sin_facturar) > 0.004)`;
const Q = `array['${qrt.id}']::uuid[]`, G = `array['${guds.id}']::uuid[]`, AMBAS = `array['${guds.id}', '${qrt.id}']::uuid[]`;
// Nota de prueba en GUDS (hoy) para el cliente base: dos líneas (60 + 40), 60 pasó a factura → 40 sin facturar (24 + 16)
const NOTA_PRUEBA = `
  insert into notas_entrega (empresa_id, serie, numero, cliente_id, cliente_nombre, vendedor_nombre, fecha_emision, fecha_vencimiento, moneda, total_usd, estado, origen)
  values ('${guds.id}', 'NE', '9X0001', '${base.cliente}', ${lit(base.nombre)}, 'Vendedor de prueba', '${hoy}', '${hoy}', 'USD', 100, 'emitida', 'guds') returning id into n;
  insert into nota_entrega_items (nota_id, empresa_id, producto_id, descripcion, cantidad, precio_usd, subtotal_usd, orden)
  values (n, '${guds.id}', '${base.productos[0]}', 'Línea A', 6, 10, 60, 1), (n, '${guds.id}', '${base.productos[1]}', 'Línea B', 4, 10, 40, 2);
  insert into nota_entrega_movimientos (nota_id, empresa_id, tipo, fecha, monto_usd, origen) values (n, '${guds.id}', 'facturada', '${hoy}', 60, 'guds');
  -- y una anulada, que no cuenta
  insert into notas_entrega (empresa_id, serie, numero, cliente_id, cliente_nombre, fecha_emision, moneda, total_usd, estado, origen)
  values ('${guds.id}', 'NE', '9X0002', '${base.cliente}', ${lit(base.nombre)}, '${hoy}', 'USD', 500, 'anulada', 'guds');`;
const MES = `'${hoy.slice(0, 8)}01'`;

// ── 1. Sin pedirlas, todo igual que antes ──
await caso('sin p_ne la venta es la misma que con p_ne = false (la fiscal)', (r) => r.a === r.b && r.ne === 0,
  como({}, `v := json_build_object(
    'a', (select sum(neto_usd) from public.reporte_ventas(${D}, ${H}, 'empresa')),
    'b', (select sum(neto_usd) from public.reporte_ventas(${D}, ${H}, 'empresa', 'ambas', true, false)),
    'ne', (select sum(ne_usd) from public.reporte_ventas(${D}, ${H}, 'empresa')))::text;`));

// ── 2. Reportes → Ventas con N/E ──
await caso('Quirutec: la venta con N/E = fiscal + lo no facturado de sus notas; facturado y facturas no cambian', (r) =>
  r.esperado > 0 && cerca(r.ne, r.esperado, 0.01) && cerca(r.con - r.sin, r.ne, 0.01) && r.bruto_con === r.bruto_sin && r.docs_con === r.docs_sin && r.n === r.n_esperado,
  como({}, `v := (select json_build_object('con', c.neto_usd, 'sin', s.neto_usd, 'ne', c.ne_usd, 'n', c.ne_documentos, 'bruto_con', c.bruto_usd, 'bruto_sin', s.bruto_usd,
      'docs_con', c.documentos, 'docs_sin', s.documentos, 'esperado', ${NE_ESPERADO(Q)}, 'n_esperado', ${N_ESPERADO(Q)})
    from public.reporte_ventas(${D}, ${H}, 'empresa', 'ambas', true, true) c, public.reporte_ventas(${D}, ${H}, 'empresa', 'ambas', true, false) s)::text;`));
await caso('por mes: la parte de N/E suma lo mismo y cae en el mes de emisión de cada nota', (r) => cerca(r.total, r.esperado, 0.01) && r.meses_mal === 0,
  como({}, `v := json_build_object('total', (select sum(ne_usd) from public.reporte_ventas(${D}, ${H}, 'mes', 'ambas', true, true)),
    'esperado', ${NE_ESPERADO(Q)},
    'meses_mal', (select count(*) from public.reporte_ventas(${D}, ${H}, 'mes', 'ambas', true, true) m
       where abs(m.ne_usd - coalesce((select sum(s.sin_facturar) from notas_entrega n join public.ne_saldos(${H}::date) s on s.nota_id = n.id
          where n.empresa_id = '${qrt.id}' and n.estado not in ('borrador', 'anulada') and to_char(n.fecha_emision, 'YYYY-MM') = m.clave), 0)) > 0.01))::text;`));
await caso('por cliente: las N/E sin cliente de GUDS salen con su nombre (clave ne:) y el total cuadra', (r) => r.sin_nombre === 0 && r.ne_sin_cliente > 0 && cerca(r.total, r.esperado, 0.01),
  como({}, `v := json_build_object(
    'sin_nombre', (select count(*) from public.reporte_ventas(${D}, ${H}, 'cliente', 'ambas', true, true) where clave like 'ne:%' and coalesce(etiqueta, '—') = '—'),
    'ne_sin_cliente', (select count(*) from public.reporte_ventas(${D}, ${H}, 'cliente', 'ambas', true, true) where clave like 'ne:%'),
    'total', (select sum(ne_usd) from public.reporte_ventas(${D}, ${H}, 'cliente', 'ambas', true, true)), 'esperado', ${NE_ESPERADO(Q)})::text;`));
await caso('por vendedor: el total de N/E cuadra', (r) => cerca(r.total, r.esperado, 0.01),
  como({}, `v := json_build_object('total', (select sum(ne_usd) from public.reporte_ventas(${D}, ${H}, 'vendedor', 'ambas', true, true)), 'esperado', ${NE_ESPERADO(Q)})::text;`));
await caso('por vendedor: el de las N/E históricas (escrito distinto) se junta con el de las ventas', (r) => r.duplicados === 0 && r.con_ne > 0,
  como({ empresa: null }, `v := json_build_object(
    'duplicados', (select count(*) from public.reporte_ventas(${D}, ${H}, 'vendedor', 'ambas', true, true) a
       join public.reporte_ventas(${D}, ${H}, 'vendedor', 'ambas', true, true) b on upper(a.clave) = upper(b.clave) and a.clave < b.clave),
    'con_ne', (select count(*) from public.reporte_ventas(${D}, ${H}, 'vendedor', 'ambas', true, true) where ne_usd > 0 and neto_usd > ne_usd))::text;`));
await caso('por categoría y por producto: la venta con N/E = la de la empresa; lo facturado no incluye N/E', (r) =>
  cerca(r.cat, r.emp) && cerca(r.prod, r.emp) && cerca(r.cat_ne, r.ne, 0.02) && cerca(r.bruto_con, r.bruto_sin, 0.02),
  como({}, `v := json_build_object(
    'emp', (select sum(neto_usd) from public.reporte_ventas(${D}, ${H}, 'empresa', 'ambas', true, true)),
    'ne', (select sum(ne_usd) from public.reporte_ventas(${D}, ${H}, 'empresa', 'ambas', true, true)),
    'cat', (select sum(neto_usd) from public.reporte_ventas(${D}, ${H}, 'categoria', 'ambas', false, true)),
    'cat_ne', (select sum(ne_usd) from public.reporte_ventas(${D}, ${H}, 'categoria', 'ambas', false, true)),
    'prod', (select sum(neto_usd) from public.reporte_ventas(${D}, ${H}, 'producto', 'ambas', true, true)),
    'bruto_con', (select sum(bruto_usd) from public.reporte_ventas(${D}, ${H}, 'categoria', 'ambas', false, true)),
    'bruto_sin', (select sum(bruto_usd) from public.reporte_ventas(${D}, ${H}, 'categoria', 'ambas', false, false)))::text;`));
await caso('comparativo: la venta actual incluye las N/E y las trae aparte', (r) => cerca(r.actual, r.neto, 0.01) && cerca(r.ne_actual, r.ne, 0.01),
  como({}, `v := json_build_object(
    'actual', (select sum(actual_usd) from public.reporte_ventas_comparativo(${D}, ${H}, 'empresa', 'ambas', true)),
    'ne_actual', (select sum(ne_actual_usd) from public.reporte_ventas_comparativo(${D}, ${H}, 'empresa', 'ambas', true)),
    'neto', (select sum(neto_usd) from public.reporte_ventas(${D}, ${H}, 'empresa', 'ambas', true, true)), 'ne', ${NE_ESPERADO(Q)})::text;`));
await caso('«Ambas»: las N/E de las dos empresas', (r) => cerca(r.ne, r.esperado, 0.01),
  como({ empresa: null }, `v := json_build_object('ne', (select sum(ne_usd) from public.reporte_ventas(${D}, ${H}, 'empresa', 'ambas', true, true)), 'esperado', ${NE_ESPERADO(AMBAS)})::text;`));
// Permiso: el Contador ve notas de entrega (control) y, sin ese permiso, p_ne no agrega nada (con una N/E de prueba en GUDS)
const PERMISO_NE = `v := json_build_object('ne', coalesce((select sum(ne_usd) from public.reporte_ventas('${hoy}', '${hoy}', 'empresa', 'ambas', true, true)), 0),
      'con', coalesce((select sum(neto_usd) from public.reporte_ventas('${hoy}', '${hoy}', 'empresa', 'ambas', true, true)), 0),
      'sin', coalesce((select sum(neto_usd) from public.reporte_ventas('${hoy}', '${hoy}', 'empresa', 'ambas', true, false)), 0),
      'cubo', (select coalesce(sum(ne_usd), 0) from public.reporte_ventas_cubo('${hoy}', '${hoy}', array['fuente'], 'ambas', '{}'::jsonb, null, true, true) where nivel = 0),
      'lineas', (select count(*) from public.reporte_ventas_lineas('${hoy}', '${hoy}', 'ambas', '{}'::jsonb, true) where fuente = 'nota de entrega'))::text;`;
await caso('con permiso de notas de entrega (Contador), p_ne las suma en Ventas, Análisis y el detalle', (r) => cerca(r.ne, 40, 0.001) && cerca(r.con - r.sin, 40, 0.001) && cerca(r.cubo, 40, 0.001) && r.lineas === 2,
  como({ uid: contador, empresa: guds.id, previo: NOTA_PRUEBA }, PERMISO_NE));
await caso('sin permiso de notas de entrega, p_ne no agrega nada (como Ventas vs deuda)', (r) => r.ne === 0 && cerca(r.con, r.sin, 0.001) && r.cubo === 0 && r.lineas === 0,
  como({ uid: contador, empresa: guds.id, previo: `${NOTA_PRUEBA}
      update permisos set puede_ver = false where rol_id = (select id from roles where nombre = 'Contador')
      and modulo_id = (select id from modulos where codigo = 'notas_entrega');` }, PERMISO_NE));

// ── 3. Análisis (cubo) ──
const CUBO = (niveles, filtros = '{}', conteos = true, d = D, h = H, col = 'null') =>
  `public.reporte_ventas_cubo(${d}, ${h}, ${niveles}, 'ambas', '${filtros}'::jsonb, ${col}, ${conteos}, true)`;
await caso('cubo por Origen: Notas de entrega aparte, sin contarlas como facturas; el total = Reportes → Ventas', (r) =>
  r.etiqueta === 'Notas de entrega' && cerca(r.venta_ne, r.ne, 0.01) && r.docs_ne === 0 && cerca(r.total, r.neto, 0.02) && cerca(r.total_ne, r.ne, 0.01),
  como({}, `v := json_build_object(
    'etiqueta', (select etiqueta from ${CUBO(`array['fuente']`)} where nivel = 1 and k1 = 'ne'),
    'venta_ne', (select venta_usd from ${CUBO(`array['fuente']`)} where nivel = 1 and k1 = 'ne'),
    'docs_ne', (select documentos from ${CUBO(`array['fuente']`)} where nivel = 1 and k1 = 'ne'),
    'total', (select venta_usd from ${CUBO(`array['fuente']`)} where nivel = 0),
    'total_ne', (select ne_usd from ${CUBO(`array['fuente']`)} where nivel = 0),
    'neto', (select sum(neto_usd) from public.reporte_ventas(${D}, ${H}, 'empresa', 'ambas', true, true)), 'ne', ${NE_ESPERADO(Q)})::text;`));
await caso('cubo por líneas (categoría › producto) y por mes de Profit: el mismo total con N/E', (r) => cerca(r.lineas, r.neto, 0.05) && cerca(r.mensual, r.neto25, 0.05) && cerca(r.lineas_ne, r.ne, 0.02),
  como({}, `v := json_build_object(
    'lineas', (select venta_usd from ${CUBO(`array['categoria', 'producto']`, '{}', false)} where nivel = 0),
    'lineas_ne', (select ne_usd from ${CUBO(`array['categoria', 'producto']`, '{}', false)} where nivel = 0),
    'mensual', (select venta_usd from ${CUBO(`array['categoria']`, '{}', false, `'2025-01-01'`, `'2025-12-31'`)} where nivel = 0),
    'neto25', (select sum(neto_usd) from public.reporte_ventas('2025-01-01', '2025-12-31', 'empresa', 'ambas', true, true)),
    'neto', (select sum(neto_usd) from public.reporte_ventas(${D}, ${H}, 'empresa', 'ambas', true, true)), 'ne', ${NE_ESPERADO(Q)})::text;`));
await caso('cubo filtrado por Origen = Notas de entrega: solo las N/E (también por documento con filtro de línea)', (r) => cerca(r.solo, r.ne, 0.01) && cerca(r.por_doc, r.ne, 0.01),
  como({}, `v := json_build_object(
    'solo', (select venta_usd from ${CUBO(`array['vendedor']`, '{"fuente": ["ne"]}')} where nivel = 0),
    'por_doc', (select venta_usd from ${CUBO(`array['fuente']`, '{"categoria": [""]}')} where nivel = 1 and k1 = 'ne'),
    'ne', ${NE_ESPERADO(Q)})::text;`));
await caso('detalle de líneas (Excel): las N/E con tipo "Nota de entrega", sin IVA, y su venta cuadra', (r) => r.n === r.n_esperado && r.n > 0 && cerca(r.venta, r.ne, 0.02) && r.iva === 0 && r.tipo === 1,
  como({}, `v := (select json_build_object('n', count(*), 'venta', round(sum(venta_neta_usd), 2), 'iva', coalesce(sum(iva_usd), 0), 'tipo', count(distinct tipo),
      'n_esperado', ${N_ESPERADO(Q, `'2025-01-01'`, `'2025-09-30'`)}, 'ne', ${NE_ESPERADO(Q, `'2025-01-01'`, `'2025-09-30'`)})
    from public.reporte_ventas_lineas('2025-01-01', '2025-09-30', 'ambas', '{}'::jsonb, true) where fuente = 'nota de entrega')::text;`));

// ── 4. Una N/E en parte facturada, con líneas, de un cliente con vendedor ──
await caso('N/E con líneas y una parte facturada: cuenta lo no facturado repartido por línea; la anulada no cuenta', (r) =>
  cerca(r.ne, 40, 0.001) && cerca(r.a, 24, 0.001) && cerca(r.b, 16, 0.001) && cerca(r.unidades, 4, 0.001) && r.etiqueta === 'Notas de entrega',
  como({ empresa: guds.id, previo: NOTA_PRUEBA },
    `v := json_build_object(
      'ne', (select sum(ne_usd) from public.reporte_ventas('${hoy}', '${hoy}', 'cliente', 'ambas', true, true) where clave = '${base.cliente}'),
      'a', (select ne_usd from public.reporte_ventas('${hoy}', '${hoy}', 'producto', 'ambas', true, true) where clave = '${base.productos[0]}'),
      'b', (select ne_usd from public.reporte_ventas('${hoy}', '${hoy}', 'producto', 'ambas', false, true) where clave = '${base.productos[1]}'),
      'unidades', (select sum(unidades) from ${CUBO(`array['fuente', 'producto']`, '{}', false, `'${hoy}'`, `'${hoy}'`)} where nivel = 1 and k1 = 'ne'),
      'etiqueta', (select etiqueta from ${CUBO(`array['fuente']`, '{}', true, `'${hoy}'`, `'${hoy}'`)} where nivel = 1 and k1 = 'ne'))::text;`));
await caso('Reportes → Metas: la venta del vendedor incluye la N/E (aparte en ne_usd); sin p_ne, no', (r) => cerca(r.con - r.sin, 40, 0.001) && cerca(r.ne, 40, 0.001),
  como({ empresa: guds.id, previo: NOTA_PRUEBA },
    `v := json_build_object(
      'con', (select venta_usd from public.reporte_metas_vendedores(${MES}::date, '${hoy}', true) where vendedor_id = '${base.vendedor_id}' and en_curso),
      'ne', (select ne_usd from public.reporte_metas_vendedores(${MES}::date, '${hoy}', true) where vendedor_id = '${base.vendedor_id}' and en_curso),
      'sin', coalesce((select venta_usd from public.reporte_metas_vendedores(${MES}::date, '${hoy}') where vendedor_id = '${base.vendedor_id}' and en_curso), 0))::text;`));
await caso('Vendedores → Metas: la venta del mes incluye la N/E y la trae aparte (ne)', (r) => cerca(r.ne, 40, 0.001),
  como({ empresa: guds.id, previo: NOTA_PRUEBA },
    `r := public.metas_vendedores(extract(year from '${hoy}'::date)::int, extract(month from '${hoy}'::date)::int);
     v := json_build_object('ne', (select (e->>'ne')::numeric from jsonb_array_elements(r->'vendedores') e where e->>'id' = '${base.vendedor_id}'))::text;`));
await caso('portal del vendedor: las ventas del mes incluyen sus N/E (notas_entrega aparte)', (r) => cerca(r.ne, 40, 0.001) && cerca(r.neto_con - r.neto_sin, 40, 0.001),
  como({ uid: base.vendedor, empresa: guds.id, previo: `${NOTA_PRUEBA}
      perform set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: base.vendedor, role: 'authenticated' }))}, true);
      perform set_config('request.headers', ${lit(JSON.stringify({ 'x-empresa-id': guds.id }))}, true);
      execute 'set local role authenticated';
      r := public.resumen_vendedor();
      execute 'reset role';
      delete from nota_entrega_movimientos where nota_id = n; delete from nota_entrega_items where nota_id = n; delete from notas_entrega where id = n;
`},
    `v := json_build_object('ne', (r->'ventas_mes'->>'notas_entrega')::numeric, 'neto_con', (r->'ventas_mes'->>'neto')::numeric,
      'neto_sin', (public.resumen_vendedor()->'ventas_mes'->>'neto')::numeric)::text;`));

console.table(casos);
const fallas = casos.filter((c) => c.ok !== '✓').length;
console.log(fallas ? `✗ ${fallas} de ${casos.length} fallaron` : `✓ ${casos.length}/${casos.length} OK`);
process.exit(fallas ? 1 : 0);
