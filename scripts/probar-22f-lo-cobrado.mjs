/**
 * Pruebas de la fase 22f (R2 del plan de reportes de finanzas): "Lo cobrado".
 *   - pagos.fecha_pago: siempre llena (Odoo = su fecha en Odoo; GUDS = la reportada o el día de Caracas) y protegida.
 *   - Cobros de Profit de ene–abr 2026 (cobros_historicos): cargados, con su RLS.
 *   - cobros_unificados: Odoo + Profit sin contar dos veces (los anticipos de saldo inicial anteriores al arranque no cuentan),
 *     USD a la tasa BCV del día (D1), lo que no cuenta aparte, y los mismos totales en la matriz, el resumen y el detalle.
 *   - Permisos: la matriz por cliente y el detalle exigen reportes y cuentas.
 *   - Si existe docs/privado/22f/cobrado-excel.json (filas del Excel "FORMATO DE LO COBRADO" de finanzas, fuera de git), el
 *     cuadre con ese Excel.
 * Mismo estilo que probar-22a: cada caso que simula un usuario corre en un bloque que termina en excepción (se deshace todo).
 *
 *   node scripts/probar-22f-lo-cobrado.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { sql } from './lib/supabase-admin.mjs';
import { ROOT } from './lib/entorno.mjs';

const [guds, qrt] = await sql(`select id, nombre_corto from empresas order by orden`);
const admin = (await sql(`select u.auth_id from usuarios u join roles r on r.id = u.rol_id
  where u.role = 'admin' and r.nombre = 'Administrador' and u.auth_id is not null and coalesce(u.activo, true) order by u.created_at limit 1`))[0].auth_id;
const vendGuds = (await sql(`select u.auth_id from usuarios u join usuario_empresas ue on ue.usuario_id = u.id
  where u.role = 'vendedor' and u.auth_id is not null group by u.auth_id
  having count(*) = 1 and bool_and(ue.empresa_id = '${guds.id}') limit 1`))[0]?.auth_id;
const cliGuds = (await sql(`select id from clientes where empresa_id = '${guds.id}' and activo order by created_at limit 1`))[0].id;
const pagoOdoo = (await sql(`select id from pagos where empresa_id = '${guds.id}' and odoo_id is not null and estado = 'verificado' order by fecha_pago desc limit 1`))[0].id;
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

async function como({ rol = 'authenticated', uid = admin, empresa = guds.id, previo = '', decl = '' }, cuerpo) {
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
  try {
    await sql(q);
    return { error: 'el bloque no terminó en excepción (no debería pasar)' };
  } catch (e) {
    const m = e.message.match(/RESULTADO:(.*)$/m);
    if (m) return { ok: m[1] };
    return { error: e.message.replace(/^\d+: Failed to run sql query: ERROR:\s+\w+: /, '').split('\n')[0] };
  }
}

const casos = [];
async function caso(nombre, verificar, promesa) {
  const r = await promesa;
  const texto = r.error ? `ERROR: ${r.error}` : r.ok;
  let ok = false;
  try { ok = typeof verificar === 'function' ? verificar(r.ok ? JSON.parse(r.ok) : null, r.error) : texto.includes(verificar); } catch { ok = false; }
  casos.push({ ok: ok ? '✓' : '✗', caso: nombre, resultado: String(texto).slice(0, 120) });
}
const dato = (obj) => Promise.resolve({ ok: JSON.stringify(obj) });
const json = (select) => `v := (select row_to_json(t)::text from (${select}) t);`;

// ── 1. Fecha del cobro ──
{
  const x = (await sql(`select count(*) filter (where fecha_pago is null) sin_fecha,
      count(*) filter (where odoo_id is not null) odoo,
      count(*) filter (where odoo_id is not null and fecha_pago = (fecha_verificacion at time zone 'UTC')::date) odoo_ok,
      (select is_nullable from information_schema.columns where table_name = 'pagos' and column_name = 'fecha_pago') nulable
    from pagos`))[0];
  await caso('fecha_pago: ningún cobro sin fecha, es obligatoria y los de Odoo llevan su fecha de Odoo', (r) =>
    Number(r.sin_fecha) === 0 && r.nulable === 'NO' && Number(r.odoo) > 1000 && r.odoo === r.odoo_ok, dato(x));
}
await caso('fecha_pago: un cobro de GUDS sin fecha toma el día de Caracas en que se registra', (r) => r.f === r.hoy,
  como({ decl: 'f date;', previo: `insert into pagos (cliente_id, monto, monto_moneda, moneda, metodo, estado, empresa_id)
      values (${lit(cliGuds)}, 1, 1, 'USD', 'transferencia', 'pendiente', ${lit(guds.id)}) returning fecha_pago into f;` },
    json(`select f, (now() at time zone 'America/Caracas')::date hoy`)));
await caso('fecha_pago: si el vendedor reporta la fecha del pago, se respeta', (r) => r.f === '2026-09-01',
  como({ decl: 'f date;', previo: `insert into pagos (cliente_id, monto, monto_moneda, moneda, metodo, estado, empresa_id, fecha_pago)
      values (${lit(cliGuds)}, 1, 1, 'USD', 'transferencia', 'pendiente', ${lit(guds.id)}, '2026-09-01') returning fecha_pago into f;` },
    json(`select f`)));
await caso('fecha_pago: si la fecha cambia en Odoo y la escritura no la trae, se recalcula', (r) => r.f === '2026-01-15',
  como({ decl: 'f date;', previo: `update pagos set fecha_verificacion = '2026-01-15 00:00:00+00' where id = ${lit(pagoOdoo)} returning fecha_pago into f;` },
    json(`select f`)));
await caso('fecha_pago: nadie la cambia en GUDS a un cobro de Odoo (se corrige en Odoo)', 'viene de Odoo',
  como({}, `update pagos set fecha_pago = '2026-01-01' where id = ${lit(pagoOdoo)};`));
{
  const f = (await sql(`select pg_get_functiondef('public.factura_portal(uuid)'::regprocedure) a, pg_get_functiondef('public.resumen_vendedor(boolean)'::regprocedure) b`))[0];
  await caso('fecha_pago: el portal (factura) y el resumen del vendedor la usan', (r) => r.ok,
    dato({ ok: f.a.includes('p.fecha_pago') && f.b.includes('p.fecha_pago') && !/p\.created_at at time zone 'America\/Caracas'/.test(f.a + f.b) }));
}

// ── 2. Cobros de Profit ──
const rutaExcel = path.join(ROOT, 'docs', 'privado', '22f', 'cobrado-excel.json');
const excel = fs.existsSync(rutaExcel) ? JSON.parse(fs.readFileSync(rutaExcel, 'utf8')) : null;
{
  const b = await sql(`select e.nombre_corto emp, count(*)::int n, round(sum(c.usd_origen), 2)::float usd, max(c.fecha)::text hasta,
      count(*) filter (where c.banco_id is null)::int sin_diario, string_agg(distinct c.cuenta, ' | ') filter (where c.banco_id is null) cuentas_sin_diario,
      count(*) filter (where c.cliente_id is not null)::int con_cliente
    from cobros_historicos c join empresas e on e.id = c.empresa_id group by 1 order by 1`);
  const esperado = {};
  if (excel) for (const f of excel.filter((x) => x.fecha < '2026-05-01' && x.numero)) {
    const t = (esperado[f.emp] ??= { n: 0, usd: 0 }); t.n++; t.usd += f.usd;
  }
  const r = Object.fromEntries(b.map((x) => [x.emp, x]));
  await caso('Profit: 553 recibos de GUDS y 700 de Quirutec, todos antes del arranque (1-may-2026)', (x) =>
    x.GUDS?.n === 553 && x.Quirutec?.n === 700 && x.GUDS.hasta < '2026-05-01' && x.Quirutec.hasta < '2026-05-01', dato(r));
  if (excel) await caso('Profit: el total USD cargado es el del Excel de finanzas (filas con número de Profit)', (x) =>
    Object.entries(esperado).every(([e, t]) => x[e] && x[e].n === t.n && Math.abs(x[e].usd - t.usd) < 0.02), dato(r));
  await caso('Profit: solo la tarjeta de débito y la cuenta por cobrar entre empresas quedan sin diario de Odoo', (x) =>
    /TARJETA DEBITO/.test(x.Quirutec?.cuentas_sin_diario ?? '') && /CTA POR COBRAR/.test(x.GUDS?.cuentas_sin_diario ?? '')
      && (x.GUDS.sin_diario + x.Quirutec.sin_diario) === 77, dato(r));
  await caso('Profit: más del 90 % ligados a un cliente de GUDS', (x) => (x.GUDS.con_cliente + x.Quirutec.con_cliente) / 1253 > 0.9, dato(r));
}
const contarProfit = json(`select count(*) n from cobros_historicos`);
await caso('Profit: el Administrador en GUDS ve solo los de GUDS', (r) => r.n === 553, como({}, contarProfit));
await caso('Profit: en «Ambas» ve los de las dos empresas', (r) => r.n === 1253, como({ empresa: 'todas' }, contarProfit));
const darPermiso = (modulo) => `insert into permisos (rol_id, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar)
  select r.id, m.id, true, false, false, false from roles r, modulos m where r.nombre = 'Vendedor' and m.codigo = '${modulo}'
  on conflict (rol_id, modulo_id) do update set puede_ver = true;`;
const quitarPermiso = (modulo) => `delete from permisos where rol_id = (select id from roles where nombre = 'Vendedor') and modulo_id = (select id from modulos where codigo = '${modulo}');`;
const soloReportes = darPermiso('reportes') + quitarPermiso('cuentas');
if (vendGuds) await caso('Profit: con reportes y sin cuentas no se leen (traen clientes)', (r) => r.n === 0, como({ uid: vendGuds, previo: soloReportes }, contarProfit));
await caso('Profit: anónimo no los lee', 'permission denied', como({ rol: 'anon', uid: null }, contarProfit));
await caso('Profit: nadie escribe en la tabla desde la API', 'permission denied',
  como({}, `delete from cobros_historicos where id = (select min(id) from cobros_historicos);`));
await caso('cobros_unificados no se llama directo desde la API', 'permission denied',
  como({}, json(`select count(*) n from public.cobros_unificados('2026-01-01', '2026-01-31')`)));

// ── 3. Reglas de lo cobrado (Administrador, «Ambas») ──
const U = (d, h) => `public.cobros_unificados('${d}', '${h}')`;
const reglas = json(`
  with u as (select u.*, b.saldo_inicial from jsonb_to_recordset(public.reporte_cobros_detalle('2026-01-01', '2026-09-30')) as u(ref text, fuente text,
      empresa text, fecha date, numero text, moneda text, monto numeric, tasa numeric, usd numeric, estado text)
    left join pagos p on u.ref = 'pago:' || p.id::text left join bancos b on b.id = p.banco_id)
  select
    count(*) filter (where fuente = 'profit' and estado = 'vigente' and fecha < '2026-05-01') profit_ene_abr,
    count(*) filter (where fuente = 'odoo' and saldo_inicial and fecha < '2026-05-01' and estado = 'vigente') si_antes_cuenta,
    count(*) filter (where fuente = 'odoo' and saldo_inicial and fecha < '2026-05-01' and estado = 'saldo_inicial') si_antes_fuera,
    count(*) filter (where fuente = 'odoo' and saldo_inicial and fecha >= '2026-05-01' and estado = 'vigente') si_despues_cuenta,
    count(*) filter (where fuente = 'odoo' and not coalesce(saldo_inicial, false) and fecha < '2026-05-01' and estado = 'vigente') odoo_banco_abril,
    count(*) filter (where moneda = 'BS' and estado = 'vigente') bs,
    count(*) filter (where moneda = 'BS' and estado = 'vigente' and abs(usd - round(monto / public.tasa_bcv_dia(fecha), 2)) < 0.005) bs_d1,
    count(*) filter (where moneda = 'USD' and estado = 'vigente' and usd <> monto) usd_distinto,
    (select count(*) from pagos p where p.es_igtf and p.estado = 'verificado' and p.fecha_pago between '2026-01-01' and '2026-09-30') igtf_pagos,
    count(*) filter (where estado = 'igtf') igtf,
    (select count(*) from pagos p where p.estado::text in ('rechazado', 'anulado') and p.fecha_pago between '2026-01-01' and '2026-09-30') anulados_pagos,
    count(*) filter (where estado = 'anulado') anulados
  from u`);
await caso('Ene–abr: cuentan los 1.253 recibos de Profit y NINGÚN anticipo de saldo inicial anterior al arranque (no se cuenta dos veces)', (r) =>
  r.profit_ene_abr === 1253 && r.si_antes_cuenta === 0 && r.si_antes_fuera > 100, como({ empresa: 'todas' }, reglas));
await caso('Desde el arranque los anticipos de saldo inicial de Odoo sí cuentan; los cobros de banco de Odoo de abril también', (r) =>
  r.si_despues_cuenta > 0 && r.odoo_banco_abril >= 1, como({ empresa: 'todas' }, reglas));
await caso('D1: todos los cobros en Bs se pasan a USD con la tasa BCV del día; los de USD van por su monto', (r) =>
  r.bs > 1500 && r.bs === r.bs_d1 && r.usd_distinto === 0, como({ empresa: 'todas' }, reglas));
await caso('IGTF y anulados no cuentan y se ven aparte', (r) => r.igtf === r.igtf_pagos && r.anulados === r.anulados_pagos && r.anulados > 0,
  como({ empresa: 'todas' }, reglas));

const coherencia = (d, h) => json(`select
    (select round(sum(usd), 2) from public.reporte_cobranza_matriz('${d}', '${h}', 'diario')) diario,
    (select round(sum(usd), 2) from public.reporte_cobranza_matriz('${d}', '${h}', 'moneda')) moneda,
    (select round(sum(usd), 2) from public.reporte_cobranza_matriz('${d}', '${h}', 'cliente')) cliente,
    (select round(sum(usd), 2) from public.reporte_cobranza_matriz('${d}', '${h}', 'estado') where fila = 'vigente') estado,
    (select round(sum(usd), 2) from public.reporte_cobranza_matrices('${d}', '${h}', array['diario', 'cliente', 'estado']) where agrupacion = 'cliente') varias,
    (select round(sum(monto_usd), 2) from public.reporte_cobranza('${d}', '${h}', 'empresa')) resumen,
    (select round(sum(monto_usd), 2) from public.reporte_cobranza('${d}', '${h}', 'mes')) resumen_mes,
    (select round(sum((x->>'usd')::numeric), 2) from jsonb_array_elements(public.reporte_cobros_detalle('${d}', '${h}')) x where x->>'estado' = 'vigente') detalle,
    (select sum(cobros) from public.reporte_cobranza_matriz('${d}', '${h}', 'diario')) cobros_matriz,
    (select sum(cobros) from public.reporte_cobranza('${d}', '${h}', 'empresa')) cobros_resumen`);
await caso('Mismo total en la matriz (diario, moneda, cliente, estado), el resumen de cobranza y el detalle (ene–sep 2026, «Ambas»)', (r) =>
  r.diario > 1000000 && [r.moneda, r.cliente, r.estado, r.varias, r.resumen, r.resumen_mes, r.detalle].every((x) => Math.abs(x - r.diario) < 0.05)
    && r.cobros_matriz === r.cobros_resumen, como({ empresa: 'todas' }, coherencia('2026-01-01', '2026-09-30')));
await caso('En GUDS la matriz solo trae GUDS', (r) => r.empresas === 'GUDS',
  como({}, json(`select string_agg(distinct empresa, ',') empresas from public.reporte_cobranza_matriz('2026-01-01', '2026-09-30', 'diario')`)));

// ── 4. Permisos ──
if (vendGuds) {
  await caso('Solo reportes: la matriz por diario se ve', (r) => r.n > 0,
    como({ uid: vendGuds, previo: soloReportes }, json(`select count(*) n from public.reporte_cobranza_matriz('2026-01-01', '2026-09-30', 'diario')`)));
  await caso('Solo reportes: la matriz por cliente pide Cuentas', 'permiso de Cuentas',
    como({ uid: vendGuds, previo: soloReportes }, json(`select count(*) n from public.reporte_cobranza_matriz('2026-01-01', '2026-09-30', 'cliente')`)));
  await caso('Solo reportes: varias matrices juntas con la de cliente también piden Cuentas', 'permiso de Cuentas',
    como({ uid: vendGuds, previo: soloReportes }, json(`select count(*) n from public.reporte_cobranza_matrices('2026-01-01', '2026-09-30', array['diario', 'cliente'])`)));
  await caso('Solo reportes: varias matrices sin la de cliente sí se ven', (r) => r.n > 0,
    como({ uid: vendGuds, previo: soloReportes }, json(`select count(*) n from public.reporte_cobranza_matrices('2026-01-01', '2026-09-30', array['diario', 'moneda', 'estado'])`)));
  await caso('Solo reportes: el detalle de cobros pide Cuentas', 'permiso de Cuentas',
    como({ uid: vendGuds, previo: soloReportes }, json(`select jsonb_array_length(public.reporte_cobros_detalle('2026-01-01', '2026-09-30')) n`)));
  await caso('Sin reportes no se ve ni la matriz', 'reportes',
    como({ uid: vendGuds, previo: quitarPermiso('reportes') + darPermiso('cuentas') }, json(`select count(*) n from public.reporte_cobranza_matriz('2026-01-01', '2026-09-30', 'diario')`)));
}
await caso('Una agrupación que no existe da error claro', 'Agrupación no válida',
  como({}, json(`select count(*) n from public.reporte_cobranza_matriz('2026-01-01', '2026-09-30', 'banco; drop table x')`)));

// ── 5. Cuadre con el Excel de finanzas ──
if (excel) {
  const mayoSep = excel.filter((x) => x.fecha >= '2026-05-01').map((x) => ({ e: x.emp, n: x.numero, f: x.fecha, m: x.moneda, a: x.monto }));
  const r = await como({ empresa: 'todas' }, json(`
    with x as (select * from jsonb_to_recordset(${lit(JSON.stringify(mayoSep))}::jsonb) as x(e text, n text, f date, m text, a numeric)),
    g as (select d->>'empresa' e, d->>'numero' n, (d->>'fecha')::date f, d->>'moneda' m, (d->>'monto')::numeric a, d->>'estado' estado
          from jsonb_array_elements(public.reporte_cobros_detalle('2026-04-01', '2026-10-31')) d),
    par as (select x.*, g.f gf, g.a ga, g.estado from x left join lateral (select * from g where g.e = x.e and g.n = x.n order by abs(g.f - x.f) limit 1) g on true)
    select count(*) excel, count(estado) en_guds, count(*) filter (where abs(ga - a) < 0.01) monto_igual, count(*) filter (where gf = f) fecha_igual,
      count(*) filter (where estado = 'anulado') anulados_en_odoo, count(*) filter (where estado = 'vigente') vigentes from par`));
  await caso('Excel may–sep: 1.099 cobros; al menos 1.092 están en GUDS, con el mismo monto (≥ 98 %) y la misma fecha (≥ 99 %)', (x) =>
    x.excel === 1099 && x.en_guds >= 1092 && x.monto_igual / x.en_guds >= 0.98 && x.fecha_igual / x.en_guds >= 0.99, Promise.resolve(r));
  await caso('Excel may–sep: los cobros anulados en Odoo que el Excel suma, GUDS los deja fuera', (x) => x.anulados_en_odoo >= 15, Promise.resolve(r));
}

console.table(casos);
const fallas = casos.filter((c) => c.ok !== '✓').length;
console.log(`${casos.length - fallas}/${casos.length} casos OK`);
process.exit(fallas ? 1 : 0);
