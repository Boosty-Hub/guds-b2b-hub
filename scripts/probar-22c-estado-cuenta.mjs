/**
 * Pruebas de la fase 22c: un solo estado de cuenta con el formato de finanzas (corte a fecha, Nº de control, tasa de
 * emisión, estatus) y el histórico de tasas BCV (T2). Mismo estilo que scripts/probar-multiempresa.mjs: cada caso que
 * simula un usuario corre en un bloque que SIEMPRE termina en excepción (la base deshace todo); el resto son lecturas.
 *
 *   node scripts/probar-22c-estado-cuenta.mjs
 *
 * Si existe docs/privado/22c/edc-esperado.json (fuera de git: trae el cliente y las filas del Excel "FORMATO EDC" de
 * finanzas), también se prueba el cuadre con esa muestra al corte del Excel.
 */
import fs from 'node:fs';
import path from 'node:path';
import { sql } from './lib/supabase-admin.mjs';
import { ROOT } from './lib/entorno.mjs';

const [guds, qrt] = await sql(`select id, nombre_corto from empresas order by orden`);
const admin = (await sql(`select u.auth_id from usuarios u join roles r on r.id = u.rol_id
  where u.role = 'admin' and r.nombre = 'Administrador' and u.auth_id is not null and coalesce(u.activo, true) order by u.created_at limit 1`))[0].auth_id;
const hoy = (await sql(`select (now() at time zone 'America/Caracas')::date::text h`))[0].h;
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

async function como({ rol = 'authenticated', uid = admin, empresa, previo = '' }, cuerpo) {
  const claims = JSON.stringify(uid ? { sub: uid, role: rol } : { role: rol });
  const headers = JSON.stringify(empresa ? { 'x-empresa-id': empresa } : {});
  const q = `do $bloque$
    declare v text;
    begin
      perform set_config('request.jwt.claims', ${lit(claims)}, true);
      perform set_config('request.headers', ${lit(headers)}, true);
      ${previo}
      execute 'set local role ${rol}';
      execute ${lit(cuerpo)} into v;
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
  casos.push({ ok: ok ? '✓' : '✗', caso: nombre, resultado: String(texto).slice(0, 110) });
}
const dato = (obj) => Promise.resolve({ ok: JSON.stringify(obj) });
/** Estado de cuenta como postgres (la lógica común), sin pasar por permisos. */
const ec = (cli, emp, corte = null, internos = true) =>
  `public.estado_cuenta_datos('${cli}', '${emp}', null, null, false, ${internos}, 'abiertas', false, ${corte ? `'${corte}'` : 'null'})`;

// ── T2: histórico de tasas BCV ──
{
  const t = (await sql(`select
      count(*) filter (where fuente = 'Odoo res.currency.rate') odoo,
      count(*) filter (where fuente = 'Profit (tasa de venta de facturas)') profit,
      count(*) filter (where fuente like 'BCV%') cron,
      count(distinct fecha) filter (where fuente in ('Odoo res.currency.rate', 'Profit (tasa de venta de facturas)')) fechas_hist,
      count(*) filter (where fuente in ('Odoo res.currency.rate', 'Profit (tasa de venta de facturas)')) filas_hist,
      min(fecha)::text desde,
      (select max(g) from (select fecha - lag(fecha) over (order by fecha) g from (select distinct fecha from tasa_bcv where fecha >= '2022-02-08') x) y) hueco_max
    from tasa_bcv`))[0];
  await caso('T2: el histórico está cargado (Odoo + Profit) con una fila por fecha y sin huecos de más de 10 días desde feb-2022', (x) =>
    x.odoo > 1000 && x.profit > 100 && x.fechas_hist === x.filas_hist && x.hueco_max <= 10 && x.desde <= '2021-12-31', dato(t));
  const v = (await sql(`select public.tasa_bcv_dia('2026-08-14')::float8 a, public.tasa_bcv_dia('2026-07-19')::float8 b,
      public.tasa_bcv_dia('2026-07-26')::float8 dom, public.tasa_bcv_dia('2026-07-24')::float8 vie, public.tasa_bcv_dia('2020-01-01') nada`))[0];
  await caso('T2: tasa_bcv_dia toma la primera del BCV del día (14-ago 771,0714; 19-jul 736,9339, no el respaldo) y el domingo la última anterior', (x) =>
    x.a === 771.0714 && x.b === 736.9339 && x.dom === x.vie && x.nada === null, dato(v));
  await caso('T2: tasa_bcv_dia la puede usar una sesión y no anon', (x) => x?.auth === true && x?.anon === false,
    como({}, `select json_build_object('auth', has_function_privilege('authenticated', 'public.tasa_bcv_dia(date)', 'execute'),
      'anon', has_function_privilege('anon', 'public.tasa_bcv_dia(date)', 'execute'))::text`));
}

// ── Saldos: suma por cliente = saldo de sus facturas (5 clientes por empresa, corte de hoy) ──
for (const emp of [guds, qrt]) {
  const clis = await sql(`select c.id from clientes c where c.empresa_id = '${emp.id}'
      and exists (select 1 from facturas f where f.cliente_id = c.id and f.estado = 'posted' and abs(f.saldo_usd) > 0.009)
    order by md5(c.id::text || '22c') limit 5`);
  const r = await sql(`select c.id,
      (select round(coalesce(sum(f.saldo_usd), 0), 2) from facturas f where f.cliente_id = c.id and f.estado = 'posted'
         and (f.empresa_id is null or f.empresa_id = '${emp.id}')) facturas,
      (select round(coalesce(sum((d->>'saldo')::numeric), 0), 2) from jsonb_array_elements(e->'abiertos') d) estado,
      round((e->'resumen'->>'saldo')::numeric - (e->'resumen'->>'nc_a_favor')::numeric, 2) resumen
    from (select c.id, ${ec('X', emp.id).replace(`'X'`, 'c.id')} e from clientes c where c.id in (${clis.map((x) => `'${x.id}'`).join(',')})) c`);
  await caso(`Saldos ${emp.nombre_corto}: en 5 clientes la deuda del estado de cuenta = Σ saldo de sus facturas = resumen`, (x) =>
    x.length === 5 && x.every((y) => Number(y.facturas) === Number(y.estado) && Number(y.estado) === Number(y.resumen)), dato(r));
}

// ── Corte a fecha (T4): saldo al corte = total − lo aplicado hasta el corte; solo emitidos hasta el corte ──
{
  const corte = '2026-08-31';
  const cli = (await sql(`select f.cliente_id id from facturas f join clientes c on c.id = f.cliente_id where c.empresa_id = '${guds.id}'
      and f.estado = 'posted' and f.fecha_emision <= '${corte}' and exists (select 1 from factura_aplicaciones a where a.factura_id = f.id and a.fecha > '${corte}')
    group by 1 order by count(*) desc limit 1`))[0].id;
  const r = await sql(`with e as (select ${ec(cli, guds.id, corte)} d),
    ui as (select (x->>'factura_id')::uuid id, (x->>'saldo')::numeric saldo, (x->>'emision')::date em, (x->>'dias')::int dias, x->>'vence' vence from e, jsonb_array_elements(e.d->'abiertos') x),
    f as (select f.* from facturas f where f.cliente_id = '${cli}' and f.estado = 'posted' and (f.empresa_id is null or f.empresa_id = '${guds.id}')
            and f.fecha_emision <= '${corte}'
            and not ((f.tipo = 'nota_credito' or f.es_nota_debito) and abs(f.total_usd) < 0.005 and abs(f.saldo_usd) < 0.005)),
    ap as (
      select a.factura_id doc, a.monto_usd m from factura_aplicaciones a join f on f.id = a.factura_id where a.fecha <= '${corte}'
      union all
      select a.documento_id, a.monto_usd from factura_aplicaciones a join f on f.id = a.documento_id where a.tipo = 'nota_credito' and f.tipo = 'nota_credito' and a.fecha <= '${corte}'
      union all
      select pf.factura_id, pf.monto_aplicado from pago_facturas pf join f on f.id = pf.factura_id join pagos p on p.id = pf.pago_id
       where p.estado = 'verificado' and coalesce(p.fecha_pago, (coalesce(p.fecha_verificacion, p.created_at) at time zone 'America/Caracas')::date) <= '${corte}'
      union all
      select ri.factura_id, ri.monto_aplicado from retencion_items ri join f on f.id = ri.factura_id join retenciones r on r.id = ri.retencion_id
       where r.estado = 'aprobado' and r.odoo_id is null and r.fecha <= '${corte}'),
    esp as (select f.id, round(case when f.tipo = 'nota_credito' then f.total_usd + coalesce(sum(ap.m), 0) else f.total_usd - coalesce(sum(ap.m), 0) end, 2) saldo
              from f left join ap on ap.doc = f.id group by f.id, f.tipo, f.total_usd)
    -- Odoo redondea: un documento con saldo 0,00 puede dar 0,01 al restar sus aplicaciones (y 1 caso 0,02); se anclan al saldo de Odoo
    select (select count(*) from esp where abs(saldo) > 0.021 and id not in (select id from ui)) faltan, (select count(*) from ui) filas,
      (select count(*) from ui join esp on esp.id = ui.id where abs(ui.saldo - esp.saldo) <= 0.011) iguales,
      (select count(*) from ui where em > '${corte}') posteriores,
      (select count(*) from ui where dias <> '${corte}'::date - coalesce(vence::date, em)) dias_mal,
      (select e.d->>'corte' from e) corte`);
  await caso(`Corte ${corte}: cada saldo = total − lo aplicado hasta el corte; sin documentos posteriores; días = corte − vencimiento`, (x) =>
    x[0].faltan === 0 && x[0].filas > 0 && x[0].iguales === x[0].filas && x[0].posteriores === 0 && x[0].dias_mal === 0 && x[0].corte === corte, dato(r));
  const f = (await sql(`select (${ec(cli, guds.id, '2999-01-01')})->>'corte' futuro, (${ec(cli, guds.id, null)})->>'corte' nulo`))[0];
  await caso('Corte: un corte futuro o vacío es hoy (Caracas)', (x) => x.futuro === hoy && x.nulo === hoy, dato(f));
  const ab = (await sql(`select count(*) n from jsonb_array_elements((${ec(cli, guds.id, corte)})->'abiertos') d, jsonb_array_elements(d->'abonos') a
    where (a->>'fecha')::date > '${corte}'`))[0];
  await caso('Corte: los abonos que se despliegan son solo los de hasta el corte', (x) => x.n === 0, dato(ab));
}

// ── Cobros no verificados (pendientes, rechazados o anulados) nunca cuentan: un cobro pendiente y uno verificado de prueba
//    sobre la misma factura, dentro del bloque que se deshace ──
{
  const f = (await sql(`select f.id, f.cliente_id, f.empresa_id, f.saldo_usd::float8 saldo from facturas f
    where f.estado = 'posted' and f.saldo_usd > 50 and f.empresa_id is not null order by f.fecha_emision desc limit 1`))[0];
  const P1 = '00000000-0000-4000-8000-0000000022c1', P2 = '00000000-0000-4000-8000-0000000022c2';
  const previo = `insert into public.pagos (id, cliente_id, monto, metodo, estado, moneda, empresa_id) values
      ('${P1}', '${f.cliente_id}', 10, 'transferencia', 'pendiente', 'USD', '${f.empresa_id}'),
      ('${P2}', '${f.cliente_id}', 5, 'transferencia', 'verificado', 'USD', '${f.empresa_id}');
    insert into public.pago_facturas (pago_id, factura_id, monto_aplicado) values ('${P1}', '${f.id}', 10), ('${P2}', '${f.id}', 5);`;
  await caso('Cobros: uno pendiente no cuenta (ni en el saldo ni en los abonos); uno verificado sí', (x) =>
    Math.abs(x?.saldo - (f.saldo - 5)) < 0.001 && x?.abonos === 1,
    como({ rol: 'postgres', uid: admin, empresa: f.empresa_id, previo }, `select json_build_object(
      'saldo', (select (d->>'saldo')::numeric from jsonb_array_elements(public.estado_cuenta_documentos('${f.cliente_id}', '${f.empresa_id}', 'abiertas', null, null, false, null)) d where d->>'factura_id' = '${f.id}'),
      'abonos', (select count(*) from jsonb_array_elements(public.estado_cuenta_documentos('${f.cliente_id}', '${f.empresa_id}', 'abiertas', null, null, false, null)) d,
                   jsonb_array_elements(d->'abonos') a where d->>'factura_id' = '${f.id}' and a->>'tipo' = 'pago' and (a->>'monto')::numeric in (5, 10)))::text`));
}

// ── Formato: tasa de emisión, Nº de control y estatus ──
{
  const r = (await sql(`with d as (
      select x, f.moneda, f.nro_control, f.fecha_emision, abs(f.total / nullif(f.total_usd, 0)) implicita
        from (select c.id, coalesce(c.empresa_id, '${guds.id}') e from clientes c
               where exists (select 1 from facturas f where f.cliente_id = c.id and f.estado = 'posted' and abs(f.saldo_usd) > 0.009)
               order by md5(c.id::text) limit 40) c,
             jsonb_array_elements(public.estado_cuenta_documentos(c.id, c.e, 'abiertas', null, null, false, null)) x
        join facturas f on f.id = (x->>'factura_id')::uuid)
    select count(*) n,
      count(*) filter (where moneda = 'USD' and (x->>'tasa_emision')::numeric is not distinct from round(public.tasa_bcv_dia(fecha_emision), 4) and x->>'tasa_origen' = 'bcv') usd_ok,
      count(*) filter (where moneda = 'USD') usd,
      count(*) filter (where moneda <> 'USD' and abs((x->>'tasa_emision')::numeric - implicita) / implicita < 0.001 and x->>'tasa_origen' = 'documento') ves_ok,
      count(*) filter (where moneda <> 'USD') ves,
      count(*) filter (where (x->>'nro_control') is not distinct from nullif(btrim(nro_control), '')) control_ok,
      count(*) filter (where x->>'estatus' = 'nc_favor' and not (x->>'tipo' = 'nota_credito' and (x->>'saldo')::numeric < 0)) nc_mal,
      count(*) filter (where x->>'estatus' = 'retencion' and coalesce(x->'que_falta'->>'codigo', '') not in ('retencion_iva', 'retencion_municipal', 'retenciones')) ret_mal,
      count(*) filter (where x->>'estatus' = 'pendiente' and ((x->>'saldo')::numeric < 0 or x->'que_falta'->>'codigo' in ('retencion_iva', 'retencion_municipal', 'retenciones'))) pend_mal,
      count(*) filter (where (x->>'dias')::int is null) sin_dias
    from d`))[0];
  await caso('Formato: tasa USD = BCV del día de emisión; en Bs a ±0,1 % de total ÷ total_usd; Nº de control de la factura', (x) =>
    x.n > 100 && x.usd_ok === x.usd && x.ves_ok === x.ves && x.control_ok === x.n, dato(r));
  await caso('Formato: estatus NC a favor / Pendiente comprobante de retención / Pendiente por cobrar según el saldo y "qué falta"', (x) =>
    x.nc_mal === 0 && x.ret_mal === 0 && x.pend_mal === 0 && x.sin_dias === 0, dato(r));
}

// ── Permisos y lo que ve cada quien ──
{
  const c = (await sql(`select c.id, c.empresa_id, u.auth_id vend from clientes c join usuarios u on u.id = c.vendedor_asignado_id
    where c.empresa_id is not null and u.auth_id is not null
      and exists (select 1 from facturas f where f.cliente_id = c.id and f.estado = 'posted' and f.saldo_usd > 0.009) order by c.codigo limit 1`))[0];
  const fac = (await sql(`select f.id from facturas f where f.cliente_id = '${c.id}' and f.estado = 'posted' and f.saldo_usd > 0.009 limit 1`))[0].id;
  // Un comentario interno y uno visible, solo dentro del bloque (se deshace)
  const previo = `insert into public.factura_comentarios (factura_id, empresa_id, texto, visible_cliente) values
      ('${fac}', '${c.empresa_id}', 'PRUEBA 22c interno', false), ('${fac}', '${c.empresa_id}', 'PRUEBA 22c visible', true);`;
  const cuenta = (expr) => `select json_build_object(
      'internos', (select count(*) from jsonb_array_elements(d->'abiertos') x, jsonb_array_elements(x->'comentarios') k where k->>'texto' = 'PRUEBA 22c interno'),
      'visibles', (select count(*) from jsonb_array_elements(d->'abiertos') x, jsonb_array_elements(x->'comentarios') k where k->>'texto' = 'PRUEBA 22c visible'),
      'con_id', (select count(*) from jsonb_array_elements(d->'abiertos') x where x ? 'factura_id'),
      'corte', d->>'corte', 'filas', jsonb_array_length(d->'abiertos'))::text from (select ${expr} d) t`;
  await caso('Admin: estado_cuenta_cliente trae los comentarios internos (con su candado) y los visibles', (x) => x?.internos === 1 && x?.visibles === 1,
    como({ empresa: c.empresa_id, previo }, cuenta(`public.estado_cuenta_cliente('${c.id}', p_movimientos => false)`)));
  await caso('Admin: estado_cuenta_cliente acepta la fecha de corte', (x) => x?.corte === '2026-09-30',
    como({ empresa: c.empresa_id }, cuenta(`public.estado_cuenta_cliente('${c.id}', p_movimientos => false, p_corte => '2026-09-30')`)));
  await caso('Vendedor: el estado de cuenta de su cliente sin comentarios internos (solo los visibles)', (x) => x?.internos === 0 && x?.visibles === 1,
    como({ uid: c.vend, empresa: c.empresa_id, previo }, cuenta(`public.estado_cuenta_cliente('${c.id}', p_movimientos => false)`)));
  const token = 'p22c' + 'x'.repeat(39);
  const previoEnlace = previo + ` insert into public.estado_cuenta_enlaces (cliente_id, empresa_id, token) values ('${c.id}', '${c.empresa_id}', '${token}');`;
  await caso('Enlace público: hoy, sin ids de documentos, solo comentarios visibles y sin libro si p_movimientos = false', (x) =>
    x?.internos === 0 && x?.visibles === 1 && x?.con_id === 0 && x?.corte === hoy,
    como({ rol: 'anon', uid: null, previo: previoEnlace }, cuenta(`public.estado_cuenta_publico('${token}', p_contar => false, p_movimientos => false)`)));
  await caso('Enlace público: con p_movimientos = false no calcula el libro', (x) => x?.movs === 0,
    como({ rol: 'anon', uid: null, previo: previoEnlace }, `select json_build_object('movs', jsonb_array_length(public.estado_cuenta_publico('${token}', p_contar => false, p_movimientos => false)->'movimientos'))::text`));
  await caso('Correo: los documentos traen Nº de control, estatus y tasa, notas de crédito incluidas', (x) =>
    x?.n === x?.abiertos && x?.con_estatus === x?.n && x?.con_control > 0,
    como({ empresa: c.empresa_id }, `select json_build_object('n', jsonb_array_length(d->'documentos'),
        'con_estatus', (select count(*) from jsonb_array_elements(d->'documentos') x where x->>'estatus' is not null),
        'con_control', (select count(*) from jsonb_array_elements(d->'documentos') x where x->>'nro_control' is not null),
        'abiertos', (select jsonb_array_length(public.estado_cuenta_cliente('${c.id}', p_movimientos => false)->'abiertos')))::text
      from (select public.datos_correo_estado_cuenta('${c.id}') d) t`));
  await caso('Funciones: anon no ejecuta estado_cuenta_cliente ni las internas (documentos, datos)', (x) => x?.n === 0,
    como({}, `select json_build_object('n', count(*))::text from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('estado_cuenta_cliente', 'estado_cuenta_documentos', 'estado_cuenta_datos', 'datos_correo_estado_cuenta')
      and has_function_privilege('anon', p.oid, 'execute')`));
  await caso('Funciones: una sesión no ejecuta directo las internas (documentos, datos)', (x) => x?.n === 0,
    como({}, `select json_build_object('n', count(*))::text from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('estado_cuenta_documentos', 'estado_cuenta_datos') and has_function_privilege('authenticated', p.oid, 'execute')`));
}

// ── Cuadre con la muestra de finanzas (si está la muestra privada) ──
const muestraP = path.join(ROOT, 'docs', 'privado', '22c', 'edc-esperado.json');
if (fs.existsSync(muestraP)) {
  const m = JSON.parse(fs.readFileSync(muestraP, 'utf8'));
  const g = await sql(`select d->>'numero' numero, d->>'tipo' tipo, d->>'nro_control' control, (d->>'saldo')::float8 saldo, (d->>'tasa_emision')::float8 tasa, d->>'moneda' moneda
    from jsonb_array_elements((${ec(m.cliente, m.empresa, m.corte)})->'abiertos') d`);
  const clave = (tipo, num) => `${tipo === 'nota_credito' || tipo === 'NC' ? 'NC' : 'F'}|${num}`;
  const gm = new Map(g.map((x) => [clave(x.tipo, x.numero), x]));
  let iguales = 0, tasaExacta = 0, tasa2 = 0, usd = 0;
  const soloExcel = [], usados = new Set();
  for (const f of m.filas) {
    const [t, num] = f.doc.split(' ');
    const x = gm.get(clave(t, num));
    if (!x) { soloExcel.push(f.doc); continue; }
    usados.add(clave(t, num));
    if (Math.abs(x.saldo - f.deuda) <= 0.011) iguales++;
    if (x.moneda === 'USD') { usd++; if (Math.abs(x.tasa - f.tasa) < 0.00005) tasaExacta++; else if (Math.abs(x.tasa - f.tasa) < 0.0051) tasa2++; }
  }
  const soloGuds = g.filter((x) => !usados.has(clave(x.tipo, x.numero))).map((x) => `${x.tipo === 'nota_credito' ? 'NC' : 'F'} ${x.numero}`);
  const r = { filas_excel: m.filas.length, filas_guds: g.length, iguales, solo_excel: soloExcel.length, solo_guds: soloGuds.length, usd, tasa_exacta: tasaExacta, tasa_2dec: tasa2 };
  await caso(`Cuadre con el Excel de finanzas al ${m.corte}: 100 de 109 al centavo; 9 en Bs imputados distinto; GUDS trae además 3 del 29-sep, 11079 y la imputación en Bs`, (x) =>
    x.iguales === 100 && x.solo_excel === 9 && x.solo_guds === 11 && x.filas_guds === 111, dato(r));
  await caso('Cuadre: la tasa de emisión de los documentos USD coincide con el Excel (53 exactas y 12 a 2 decimales; el resto son NC/ND con la tasa de la factura)', (x) =>
    x.tasa_exacta >= 53 && x.tasa_exacta + x.tasa_2dec >= 65, dato(r));
}

console.table(casos);
const fallas = casos.filter((c) => c.ok !== '✓').length;
console.log(`${casos.length - fallas}/${casos.length} casos OK`);
process.exit(fallas ? 1 : 0);
