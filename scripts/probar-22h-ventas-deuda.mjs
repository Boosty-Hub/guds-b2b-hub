/**
 * Pruebas de la fase 22h (R4 del plan de reportes de finanzas): Ventas vs deuda y días de recuperación oficiales (D6).
 *   - ventas_con_iva: Profit (todo el histórico) + Odoo (sin saldos iniciales), con IVA.
 *   - recuperacion_calculo: la fórmula (deuda neta ÷ promedio mensual de 12 meses × 30, clientes nuevos sobre sus meses), la
 *     deuda neta = la de la Antigüedad, y "sin compras" cuando debe y no compró.
 *   - metricas_cobranza, alertas_cobranza y reporte_dso dan los mismos días y los mismos conteos (Cuentas = torre de control).
 *   - reporte_ventas_vs_deuda: totales coherentes, notas de entrega con el interruptor, por empresa y permisos (D10).
 *   - Si existe docs/privado/22h/promedio-esperado.json (cifras del Excel "Promedio de ventas vs deudas", fuera de git), el
 *     cuadre al 30-abr-2026.
 * Mismo estilo que probar-22g: cada caso que simula un usuario corre en un bloque que termina en excepción (se deshace todo).
 *
 *   node scripts/probar-22h-ventas-deuda.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { sql } from './lib/supabase-admin.mjs';
import { ROOT } from './lib/entorno.mjs';

const emps = await sql(`select id, nombre_corto from empresas order by orden`);
const guds = emps.find((e) => e.nombre_corto === 'GUDS'), qrt = emps.find((e) => e.nombre_corto === 'Quirutec');
const todas = `(select array_agg(id) from empresas)`;
const hoy = `(now() at time zone 'America/Caracas')::date`;
const admin = (await sql(`select u.auth_id from usuarios u join roles r on r.id = u.rol_id
  where u.role = 'admin' and r.nombre = 'Administrador' and u.auth_id is not null and coalesce(u.activo, true) order by u.created_at limit 1`))[0].auth_id;
const vendGuds = (await sql(`select u.auth_id from usuarios u join usuario_empresas ue on ue.usuario_id = u.id
  where u.role = 'vendedor' and u.auth_id is not null group by u.auth_id
  having count(*) = 1 and bool_and(ue.empresa_id = '${guds.id}') limit 1`))[0]?.auth_id;
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const RUTA_EXCEL = path.join(ROOT, 'docs', 'privado', '22h', 'promedio-esperado.json');
const excel = fs.existsSync(RUTA_EXCEL) ? JSON.parse(fs.readFileSync(RUTA_EXCEL, 'utf8')) : null;

async function como({ rol = 'authenticated', uid = admin, empresa = 'todas', previo = '', decl = '' }, cuerpo) {
  const claims = JSON.stringify(uid ? { sub: uid, role: rol } : { role: rol });
  const headers = JSON.stringify(empresa ? { 'x-empresa-id': empresa } : {});
  const q = `do $bloque$
    declare v text; ${decl}
    begin
      ${previo}
      perform set_config('request.jwt.claims', ${lit(claims)}, true);
      perform set_config('request.headers', ${lit(headers)}, true);
      execute 'set local role ${rol}';
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
      if (/fetch failed/.test(e.message) && intento < 4) { await new Promise((r) => setTimeout(r, 3000 * intento)); continue; }
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
  casos.push({ ok: ok ? '✓' : '✗', caso: nombre, resultado: String(texto).slice(0, 120) });
  if (process.env.AVANCE) console.error(`${ok ? '✓' : '✗'} ${nombre}`);
}
const dato = (obj) => Promise.resolve({ ok: JSON.stringify(obj) });
const json = (select) => `v := (select row_to_json(t)::text from (${select}) t);`;
const uno = async (q) => (await sql(q))[0];

// ── 1. Venta con IVA ──
await caso('ventas_con_iva: Odoo = facturas, NC y ND publicadas sin saldos iniciales (la NC en negativo)', (r) =>
  r.odoo > 100 && r.odoo === r.facturas && Math.abs(r.usd - r.usd_facturas) < 0.05 && r.nc_positivas === 0,
  dato(await uno(`select (select count(*) from public.ventas_con_iva('2020-01-01', ${hoy}, ${todas}) where fuente = 'odoo') odoo,
      (select round(sum(venta_usd), 2) from public.ventas_con_iva('2020-01-01', ${hoy}, ${todas}) where fuente = 'odoo') usd,
      (select count(*) from facturas where estado = 'posted' and not coalesce(es_saldo_inicial, false) and cliente_id is not null and fecha_emision <= ${hoy}) facturas,
      (select round(sum(total_usd), 2) from facturas where estado = 'posted' and not coalesce(es_saldo_inicial, false) and cliente_id is not null and fecha_emision <= ${hoy}) usd_facturas,
      (select count(*) from facturas where estado = 'posted' and tipo = 'nota_credito' and total_usd > 0.005) nc_positivas`)));
await caso('ventas_con_iva: Profit trae todo el histórico (venta, financieras, ND cambiarias y reversos)', (r) => r.n === r.docs && r.tratamientos >= 4,
  dato(await uno(`select (select count(*) from public.ventas_con_iva('2020-01-01', ${hoy}, ${todas}) where fuente = 'profit') n,
      (select count(*) from profit_documentos where lote = public.profit_lote_vigente()) docs,
      (select count(distinct tratamiento) from profit_documentos where lote = public.profit_lote_vigente()) tratamientos`)));

// ── 2. recuperacion_calculo ──
{
  const r = await uno(`with r as materialized (select * from public.recuperacion_calculo(${hoy}, ${todas}, true, null))
    select count(*) n, count(*) filter (where deuda > 0.009) con_deuda,
      count(*) filter (where deuda > 0.009 and venta_12m > 0.009 and dias is distinct from round(deuda / (venta_12m / meses) * 30)::int) formula_mal,
      count(*) filter (where deuda <= 0.009 and dias is distinct from 0) sin_deuda_mal,
      count(*) filter (where deuda > 0.009 and venta_12m <= 0.009 and dias is not null) sin_compras_mal,
      count(*) filter (where meses < 12) nuevos,
      count(*) filter (where meses < 12 and primera_compra <= (${hoy} - interval '12 months')::date) nuevos_mal,
      count(*) filter (where abs(promedio - round(venta_12m / meses, 2)) > 0.01) promedio_mal,
      round(sum(deuda), 2) deuda,
      (select round(sum(saldo_usd), 2) from public.partidas_cobranza(${hoy}, ${todas}, true) where cliente_id is not null) partidas
    from r`);
  await caso('D6: días = deuda neta ÷ (venta 12 m ÷ meses) × 30; sin deuda = 0; con deuda y sin compras = sin días', (x) =>
    x.n > 300 && x.con_deuda > 200 && x.formula_mal === 0 && x.sin_deuda_mal === 0 && x.sin_compras_mal === 0 && x.promedio_mal === 0, dato(r));
  await caso('D6: cliente nuevo (primera compra hace menos de 12 meses) se divide entre sus meses', (x) => x.nuevos > 0 && x.nuevos_mal === 0, dato(r));
  await caso('D6: la deuda neta es la de la Antigüedad (partidas_cobranza, con notas de entrega)', (x) => Math.abs(Number(x.deuda) - Number(x.partidas)) < 0.05, dato(r));
}
{
  // Un cliente con venta: los números de la fórmula a mano
  const c = await uno(`select r.* from public.recuperacion_calculo(${hoy}, ${todas}, true, null) r where r.deuda > 100 and r.venta_12m > 100 and r.meses = 12 order by r.deuda desc limit 1`);
  const v = await uno(`select round(sum(venta_usd), 2) v12 from public.ventas_con_iva((${hoy} - interval '12 months')::date + 1, ${hoy}, ${todas}) where cliente_id = ${lit(c.cliente_id)}`);
  await caso('D6: la venta de 12 meses de un cliente es la suma de sus documentos de los últimos 12 meses', (x) => Math.abs(x.a - x.b) < 0.01, dato({ a: Number(c.venta_12m), b: Number(v.v12) }));
}

// ── 3. Métricas, torre y reporte_dso ──
await caso('metricas_cobranza: cada cliente trae sus días de recuperación (los mismos de recuperacion_calculo) y la regla', (r) =>
  r.n > 300 && r.distintos === 0 && r.umbral > 0 && r.con_ne,
  // (la comparación con recuperacion_calculo, que es interna, corre con el rol de la API)
  como({ decl: 'mj jsonb;' }, `mj := public.metricas_cobranza(null, null); execute 'reset role';` + json(`with m as (select mj j),
      c as (select x from m, jsonb_array_elements(m.j->'clientes') x),
      r as (select * from public.recuperacion_calculo(${hoy}, ${todas}, true, null))
    select (select count(*) from c) n, (select (j->>'alerta_recuperacion')::int from m) umbral, (select (j->>'recuperacion_ne')::boolean from m) con_ne,
      (select count(*) from c join r on r.cliente_id = (c.x->>'cliente_id')::uuid
        where (c.x->>'dias_rec')::int is distinct from r.dias or abs((c.x->>'rec_deuda')::numeric - r.deuda) > 0.01) distintos`)));
await caso('Torre de control = Cuentas: mismos clientes con recuperación lenta y con deuda sin compras (sin incobrables)', (r) =>
  r.torre_alta === r.cuentas_alta && r.torre_sin === r.cuentas_sin && r.torre_alta > 0,
  como({}, json(`with m as materialized (select public.metricas_cobranza(null, null) j), a as materialized (select public.alertas_cobranza() j),
      c as (select x from m, jsonb_array_elements(m.j->'clientes') x)
    select (select (j->>'recuperacion_alta')::int from a) torre_alta, (select (j->>'sin_compras')::int from a) torre_sin,
      (select count(*) from c, m where (c.x->>'rec_deuda')::numeric > 1 and (c.x->>'dias_rec')::int > (m.j->>'alerta_recuperacion')::int and not (c.x->>'incobrable')::boolean) cuentas_alta,
      (select count(*) from c where (c.x->>'rec_deuda')::numeric > 1 and c.x->>'dias_rec' is null and not (c.x->>'incobrable')::boolean) cuentas_sin`)));
await caso('reporte_dso: los días de un vendedor = Σ deuda neta ÷ Σ promedio × 30 y la suma de deuda neta es la de los clientes', (r) =>
  r.mal === 0 && Math.abs(r.vendedores - r.clientes) < 0.05 && r.n > 0,
  como({}, json(`with v as (select * from public.reporte_dso(90, 'vendedor')), c as (select * from public.reporte_dso(90, 'cliente'))
    select (select count(*) from v) n,
      (select count(*) from v where rec_deuda > 0.009 and rec_promedio > 0.009 and dias_rec <> round(rec_deuda / rec_promedio * 30)) mal,
      (select round(sum(rec_deuda), 2) from v) vendedores, (select round(sum(rec_deuda), 2) from c) clientes`)));

// ── 4. reporte_ventas_vs_deuda ──
const resumenVd = (corte, meses, ne) => json(`with z as materialized (select public.reporte_ventas_vs_deuda(${corte}, ${meses}, ${ne}) r),
    c as (select x from z, jsonb_array_elements(z.r->'clientes') x)
  select (select r->>'desde' from z) desde, (select r->>'corte' from z) corte, (select r->>'hoy' from z) hoy, (select count(*) from c) n,
    (select count(*) from c where x ? 'sf') sin_ficha,
    (select round(sum((v.value)::numeric), 2) from c, jsonb_each_text(c.x->'ventas') v) ventas,
    (select round(sum((x->>'d')::numeric), 2) from c) deuda, (select round(coalesce(sum((x->>'ne')::numeric), 0), 2) from c) ne,
    (select string_agg(distinct x->>'e', ',') from c) empresas`);
{
  const r = await como({}, resumenVd(`date '2026-09-30'`, 12, true));
  const x = JSON.parse(r.ok ?? '{}');
  const directo = await uno(`select round(sum(venta_usd), 2) ventas from public.ventas_con_iva('2025-10-01', '2026-09-30', ${todas})`);
  const deuda = await uno(`select round(sum(saldo_usd), 2) d from public.partidas_cobranza('2026-09-30', ${todas}, true)`);
  await caso('Ventas vs deuda (30-sep, 12 meses): la matriz va de oct-2025 a sep-2026 y suma toda la venta con IVA del período', (y) =>
    y.desde === '2025-10-01' && Math.abs(Number(y.ventas) - Number(directo.ventas)) < 0.05 && y.sin_ficha > 0, dato(x));
  await caso('Ventas vs deuda: la deuda neta de todos los clientes (con N/E, también los sin ficha) = la de la Antigüedad', (y) =>
    Math.abs(Number(y.deuda) - Number(deuda.d)) < 0.05 && Number(y.ne) > 40000, dato(x));
}
await caso('Ventas vs deuda sin el interruptor: sin notas de entrega en la deuda', (r) => Number(r.ne) === 0,
  como({}, resumenVd(`date '2026-09-30'`, 12, false)));
await caso('Ventas vs deuda "desde dic-2020": la matriz empieza en el primer mes del histórico', (r) => r.desde === '2020-12-01', como({}, resumenVd(`date '2026-09-30'`, 0, true)));
await caso('Ventas vs deuda en GUDS trae solo GUDS', (r) => r.empresas === guds.id, como({ empresa: guds.id }, resumenVd('null', 12, true)));
await caso('Ventas vs deuda: un corte futuro se toma como hoy', (r) => r.corte === r.hoy, como({}, resumenVd(`date '2099-01-01'`, 12, true)));
await caso('Ventas vs deuda se calcula en menos de 2 s en la base', (r) => r.ms < 2000,
  como({ decl: 't0 timestamptz; z jsonb;' }, `t0 := clock_timestamp(); z := public.reporte_ventas_vs_deuda(null, 12, true);` +
    json(`select round(extract(milliseconds from clock_timestamp() - t0)) ms`)));
const darPermiso = (modulo) => `insert into permisos (rol_id, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar)
  select r.id, m.id, true, false, false, false from roles r, modulos m where r.nombre = 'Vendedor' and m.codigo = '${modulo}'
  on conflict (rol_id, modulo_id) do update set puede_ver = true;`;
const quitarPermiso = (modulo) => `delete from permisos where rol_id = (select id from roles where nombre = 'Vendedor') and modulo_id = (select id from modulos where codigo = '${modulo}');`;
if (vendGuds) {
  await caso('Solo reportes: Ventas vs deuda pide también Cuentas (D10)', 'permiso de Cuentas',
    como({ uid: vendGuds, empresa: guds.id, previo: darPermiso('reportes') + quitarPermiso('cuentas') }, json(`select public.reporte_ventas_vs_deuda() is not null x`)));
  await caso('Vendedor: metricas_cobranza trae solo sus clientes, con sus días de recuperación', (r) => r.ajenos === 0 && r.con_dias >= 0,
    como({ uid: vendGuds, empresa: guds.id }, json(`with m as materialized (select public.metricas_cobranza(null, null) j), c as (select x from m, jsonb_array_elements(m.j->'clientes') x)
      select (select count(*) from c where (c.x->>'cliente_id')::uuid not in (select public.mis_clientes_vendedor())) ajenos,
             (select count(*) from c where c.x ? 'dias_rec') con_dias`)));
}
await caso('Anónimo no ejecuta reporte_ventas_vs_deuda', 'permission denied', como({ rol: 'anon', uid: null }, json(`select public.reporte_ventas_vs_deuda() is not null x`)));
await caso('ventas_con_iva y recuperacion_calculo son internas', 'permission denied',
  como({}, json(`select count(*) n from public.recuperacion_calculo(current_date, array['${qrt.id}'::uuid], true, null)`)));

// ── 5. Cuadre con el Excel de finanzas (30-abr-2026) ──
if (excel) {
  const r = await como({}, json(`with z as materialized (select public.reporte_ventas_vs_deuda(date '2026-04-30', 12, true) r),
      c as (select x, e.nombre_corto emp from z, jsonb_array_elements(z.r->'clientes') x join empresas e on e.id = (x->>'e')::uuid),
      m as (select c.emp, v.key mes, sum(v.value::numeric) usd from c, jsonb_each_text(c.x->'ventas') v group by 1, 2)
    select (select jsonb_object_agg(emp || '|' || mes, round(usd, 2)) from m) meses,
           (select jsonb_object_agg(emp, round(d, 2)) from (select emp, sum((x->>'d')::numeric) d from c group by emp) t) deuda`));
  const x = JSON.parse(r.ok ?? '{}');
  // (se compara con la suma de los meses del Excel: su "promedio anual" tiene divisores escritos a mano en algunas filas)
  const iguales = (emp) => Object.entries(excel[emp].meses).filter(([m]) => m >= '2025-05').every(([m, v]) => Math.abs(Number(x.meses?.[`${emp}|${m}`] ?? 0) - v) <= 0.05);
  const v12 = (emp) => Object.entries(x.meses ?? {}).filter(([k]) => k.startsWith(`${emp}|`)).reduce((s, [, v]) => s + Number(v), 0);
  const v12x = (emp) => Object.entries(excel[emp].meses).filter(([m]) => m >= '2025-05').reduce((s, [, v]) => s + v, 0);
  await caso('Excel 30-abr · GUDS: la venta con IVA de cada mes (may-2025 a abr-2026) es la del Excel, al centavo', () => iguales('GUDS'),
    dato({ guds: v12('GUDS').toFixed(2), excel: v12x('GUDS').toFixed(2) }));
  await caso('Excel 30-abr · Quirutec: la venta de 12 meses a menos del 2 % (el Excel suma también las notas de entrega de Profit)', () =>
    v12('Quirutec') <= v12x('Quirutec') + 0.05 && (v12x('Quirutec') - v12('Quirutec')) / v12x('Quirutec') < 0.02,
    dato({ quirutec: v12('Quirutec').toFixed(2), excel: v12x('Quirutec').toFixed(2) }));
  await caso('Excel 30-abr: la deuda neta por empresa a menos del 4 % (anticipos de saldo inicial fechados en mayo y documentos del 1–6 de mayo)', () =>
    ['GUDS', 'Quirutec'].every((e) => Math.abs(Number(x.deuda?.[e] ?? 0) - excel[e].deuda) / excel[e].deuda < 0.04),
    dato({ guds: x.deuda?.GUDS, excel_guds: excel.GUDS.deuda, quirutec: x.deuda?.Quirutec, excel_quirutec: excel.Quirutec.deuda }));
}

console.table(casos);
const fallas = casos.filter((c) => c.ok !== '✓').length;
console.log(`${casos.length - fallas}/${casos.length} casos OK`);
process.exit(fallas ? 1 : 0);
