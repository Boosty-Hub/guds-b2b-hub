/**
 * Pruebas de la fase 22g (R3 del plan de reportes de finanzas): Antigüedad, gestión de cobranza (T5), anticipos de Odoo sin
 * aplicar (T6) y notas de entrega no fiscales (NE1).
 *   - T6: la sincronización trae el saldo sin aplicar de cada cobro de Odoo y sus conciliaciones; v_anticipos, el estado de
 *     cuenta y la antigüedad los ven; aplicar_anticipo no toca los de Odoo.
 *   - partidas_cobranza da el mismo saldo al corte y el mismo "qué falta" que el estado de cuenta (hoy y a un corte pasado).
 *   - Gestión de cobranza: carga del Excel, cambios con permiso y empresa activa, excepciones por documento, historial.
 *   - Notas de entrega: las 29 históricas, su saldo, RLS y que la antigüedad las incluya solo con el interruptor.
 *   - reporte_antiguedad: mismo resultado que partidas_cobranza, por empresa, y exige reportes y cuentas.
 *   - Si existe docs/privado/22g/vencimiento-matriz.json (lo escribe importar-vencimiento-finanzas.mjs, fuera de git), el
 *     cuadre con el Excel "Análisis de vencimiento" al 30-abr-2026.
 * Mismo estilo que probar-22f: cada caso que simula un usuario corre en un bloque que termina en excepción (se deshace todo).
 *
 *   node scripts/probar-22g-antiguedad.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { sql } from './lib/supabase-admin.mjs';
import { ROOT } from './lib/entorno.mjs';

const emps = await sql(`select id, nombre_corto from empresas order by orden`);
const guds = emps.find((e) => e.nombre_corto === 'GUDS'), qrt = emps.find((e) => e.nombre_corto === 'Quirutec');
const todas = `(select array_agg(id) from empresas)`;
const admin = (await sql(`select u.auth_id from usuarios u join roles r on r.id = u.rol_id
  where u.role = 'admin' and r.nombre = 'Administrador' and u.auth_id is not null and coalesce(u.activo, true) order by u.created_at limit 1`))[0].auth_id;
const vendGuds = (await sql(`select u.auth_id from usuarios u join usuario_empresas ue on ue.usuario_id = u.id
  where u.role = 'vendedor' and u.auth_id is not null group by u.auth_id
  having count(*) = 1 and bool_and(ue.empresa_id = '${guds.id}') limit 1`))[0]?.auth_id;
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const RUTA_EXCEL = path.join(ROOT, 'docs', 'privado', '22g', 'vencimiento-matriz.json');
const excel = fs.existsSync(RUTA_EXCEL) ? JSON.parse(fs.readFileSync(RUTA_EXCEL, 'utf8')) : null;

async function como({ rol = 'authenticated', uid = admin, empresa = qrt.id, previo = '', decl = '' }, cuerpo) {
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
      // Cortes de red de la Management API: se reintenta (el bloque siempre se deshace)
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

// ── 1. T6 · Cobros de Odoo sin aplicar ──
{
  const x = await uno(`select
      count(*) filter (where not es_igtf) cobros,
      count(*) filter (where not es_igtf and saldo_odoo_usd is null) sin_saldo,
      count(*) filter (where saldo_odoo_usd is not null and jsonb_typeof(odoo_conciliaciones) <> 'array') conc_mal,
      count(*) filter (where saldo_odoo_usd is not null and abs(monto - saldo_odoo_usd
        - coalesce((select sum((c->>1)::numeric) from jsonb_array_elements(odoo_conciliaciones) c), 0)) <= 0.05) cuadran,
      count(*) filter (where saldo_odoo_usd is not null) con_saldo,
      count(*) filter (where saldo_odoo_usd > 0.009) anticipos
    from pagos where odoo_id is not null and estado = 'verificado'`);
  await caso('T6: la sincronización trae el saldo sin aplicar de los cobros de Odoo (menos de 3 sin línea por cobrar) y sus conciliaciones',
    (r) => r.cobros > 1500 && r.sin_saldo <= 2 && r.conc_mal === 0 && r.anticipos > 200, dato(x));
  await caso('T6: saldo + conciliaciones = monto del cobro en el 97 % o más (el resto, diferencias de cambio de Odoo)',
    (r) => r.cuadran / r.con_saldo >= 0.97, dato(x));
}
await caso('T6: v_anticipos incluye los cobros de Odoo con saldo (sin "Aplicar") y suma lo mismo que Odoo', (r) =>
  r.odoo === r.pagos && Math.abs(r.odoo_usd - r.pagos_usd) < 0.01 && r.odoo > 200,
  como({ empresa: 'todas' }, json(`select count(*) filter (where a.odoo_id is not null) odoo, round(sum(a.disponible) filter (where a.odoo_id is not null), 2) odoo_usd,
      (select count(*) from pagos p where p.odoo_id is not null and p.estado = 'verificado' and p.saldo_odoo_usd > 0.009) pagos,
      (select round(sum(p.saldo_odoo_usd), 2) from pagos p where p.odoo_id is not null and p.estado = 'verificado' and p.saldo_odoo_usd > 0.009) pagos_usd
    from v_anticipos a`)));
{
  const c = await uno(`select p.cliente_id, p.empresa_id from pagos p where p.odoo_id is not null and p.estado = 'verificado' and p.saldo_odoo_usd > 1
    order by p.saldo_odoo_usd desc limit 1`);
  await caso('T6: el estado de cuenta resta los anticipos de Odoo del cliente (neto = por cobrar − NC − anticipos)', (r) =>
    r.anticipos > 1 && Math.abs(r.anticipos - r.esperado) < 0.01 && Math.abs(r.neto - (r.saldo - r.nc - r.anticipos)) < 0.01,
    como({ empresa: c.empresa_id }, json(`select (e->'resumen'->>'anticipos')::numeric anticipos, (e->'resumen'->>'neto')::numeric neto,
        (e->'resumen'->>'saldo')::numeric saldo, (e->'resumen'->>'nc_a_favor')::numeric nc,
        (select round(sum(a.disponible), 2) from v_anticipos a where a.cliente_id = ${lit(c.cliente_id)}) esperado
      from (select public.estado_cuenta_cliente(${lit(c.cliente_id)}) e) z`)));
  const p = await uno(`select id, empresa_id from pagos where odoo_id is not null and estado = 'verificado' and saldo_odoo_usd > 1 limit 1`);
  await caso('T6: un cobro de Odoo no se aplica desde GUDS (se aplica en Odoo)', 'se aplica a las facturas en Odoo',
    como({ empresa: p.empresa_id }, `perform public.aplicar_anticipo(${lit(p.id)}, '[]'::jsonb);`));
}
{
  // Cobro aplicado después de su fecha: al corte del día del cobro, todo lo que se le aplicó después vuelve a ser anticipo
  const p = await uno(`select p.id, p.fecha_pago, p.monto, p.saldo_odoo_usd,
      (select sum((c->>1)::numeric) from jsonb_array_elements(p.odoo_conciliaciones) c where (c->>0)::date > p.fecha_pago) despues
    from pagos p where p.odoo_id is not null and p.estado = 'verificado' and p.saldo_odoo_usd is not null
      and exists (select 1 from jsonb_array_elements(p.odoo_conciliaciones) c where (c->>0)::date > p.fecha_pago + 5)
    order by p.monto desc limit 1`);
  const r = await uno(`select -saldo_usd s from public.partidas_cobranza(${lit(p.fecha_pago)}, ${todas}, false) where documento_id = ${lit(p.id)}`);
  await caso('T6: al corte del día del cobro, lo aplicado después vuelve a ser anticipo (saldo de hoy + conciliado después)', (x) =>
    Math.abs(x.s - (Number(x.hoy) + Number(x.despues))) < 0.01 && x.s > Number(x.hoy), dato({ s: Number(r?.s ?? 0), hoy: p.saldo_odoo_usd, despues: p.despues }));
}

// ── 2. partidas_cobranza = estado de cuenta ──
const igualEc = (corte) => uno(`
  with cli as (select distinct f.empresa_id, f.cliente_id from facturas f where f.estado = 'posted' and abs(f.saldo_usd) > 0.009 and f.fecha_emision <= ${lit(corte)}),
  muestra as (select * from (select cli.*, row_number() over (partition by empresa_id order by md5(cliente_id::text)) rn from cli) x where rn <= 15),
  ec as (select m.cliente_id, (d->>'factura_id')::uuid id, (d->>'saldo')::numeric saldo, d->>'estatus' estatus
           from muestra m cross join lateral jsonb_array_elements(public.estado_cuenta_documentos(m.cliente_id, m.empresa_id, 'abiertas', null, null, false, ${lit(corte)})) d),
  pc as (select p.documento_id id, p.saldo_usd saldo, p.clase from public.partidas_cobranza(${lit(corte)}, ${todas}, false) p
           where p.tipo in ('factura', 'nota_debito', 'nota_credito') and p.cliente_id in (select cliente_id from muestra))
  select (select count(*) from muestra) clientes, count(ec.id) ec, count(pc.id) pc,
         count(*) filter (where ec.id is not null and pc.id is not null and abs(ec.saldo - pc.saldo) <= 0.01) iguales,
         count(*) filter (where coalesce(ec.estatus = 'retencion', false) <> coalesce(pc.clase = 'retencion', false)) estatus_distinto
    from ec full join pc on pc.id = ec.id`);
for (const [corte, texto] of [[(await uno(`select (now() at time zone 'America/Caracas')::date d`)).d, 'hoy'], ['2026-06-30', 'al 30-jun']]) {
  await caso(`Antigüedad = estado de cuenta (${texto}): mismos documentos, mismo saldo y mismo "falta la retención" en 30 clientes`, (r) =>
    r.clientes >= 25 && r.ec > 50 && r.ec === r.pc && r.iguales === r.ec && r.estatus_distinto === 0, dato(await igualEc(corte)));
}
await caso('Hoy, el saldo de cada documento es el de Odoo (facturas.saldo_usd)', (r) => r.distintos === 0 && r.n > 1000,
  dato(await uno(`select count(*) n, count(*) filter (where abs(p.saldo_usd - round(f.saldo_usd, 2)) > 0.005) distintos
    from public.partidas_cobranza((now() at time zone 'America/Caracas')::date, ${todas}, false) p join facturas f on f.id = p.documento_id
    where p.tipo in ('factura', 'nota_debito', 'nota_credito')`)));

// ── 3. Cuadre con el Excel de finanzas (30-abr-2026) ──
if (excel) {
  const docs = excel.documentos.filter((d) => ['FACT', 'N/DB', 'N/CR'].includes(d.tipo) && d.emision && d.emision <= excel.corte)
    .map((d) => ({ e: d.empresa, t: { FACT: 'factura', 'N/DB': 'nota_debito', 'N/CR': 'nota_credito' }[d.tipo], n: d.numero, s: d.deuda, i: d.incobrable }));
  const r = await uno(`
    with x as (select x.*, e.id empresa_id from jsonb_to_recordset(${lit(JSON.stringify(docs))}::jsonb) as x(e text, t text, n text, s numeric, i boolean)
                 join empresas e on e.nombre_corto = x.e),
    p as (select * from public.partidas_cobranza(${lit(excel.corte)}, ${todas}, false) where tipo in ('factura', 'nota_debito', 'nota_credito')),
    par as (select x.*, p.saldo_usd g, p.clasificacion from x left join p on p.empresa_id = x.empresa_id and p.tipo = x.t and p.numero = x.n)
    select count(*) excel, count(g) en_guds, count(*) filter (where abs(coalesce(g, 0) - s) <= 0.02) iguales,
           count(*) filter (where t <> 'nota_credito') fact_nd, count(*) filter (where t <> 'nota_credito' and abs(coalesce(g, 0) - s) <= 0.02) fact_nd_iguales,
           round(sum(s), 2) neto_excel, round((select sum(saldo_usd) from p), 2) neto_guds,
           count(*) filter (where i and g is not null) incobrables_abiertos, count(*) filter (where i and clasificacion = 'incobrable') incobrables_marcados
      from par`);
  await caso('Excel 30-abr: facturas y ND con el mismo saldo al centavo (≥ 95 %)', (x) => x.fact_nd > 1000 && x.fact_nd_iguales / x.fact_nd >= 0.95, dato(r));
  await caso('Excel 30-abr: deuda neta de documentos a menos del 2 % (la diferencia: NC que Odoo ya aplicó a su factura)', (x) =>
    Math.abs(x.neto_guds - x.neto_excel) / Math.abs(x.neto_excel) < 0.02, dato(r));
  await caso('Excel 30-abr: todo documento incobrable del Excel abierto en GUDS sale como incobrable', (x) =>
    x.incobrables_abiertos > 100 && x.incobrables_abiertos === x.incobrables_marcados, dato(r));
  const ne = excel.notas;
  await caso('Excel: las 29 notas de entrega con el mismo saldo (USD 44.004,91; 3 con abonos en fórmula)', (x) =>
    x.n === ne.length && Math.abs(x.saldo - ne.reduce((s, n) => s + n.saldo, 0)) < 0.01 && x.con_abonos === ne.filter((n) => n.abonos.length).length
      && Math.abs(x.incobrable - ne.filter((n) => n.clasificacion === 'incobrable').reduce((s, n) => s + n.saldo, 0)) < 0.01,
    dato(await uno(`select count(*) n, round(sum(saldo_usd), 2) saldo, count(*) filter (where movimientos > 0) con_abonos,
        round(sum(saldo_usd) filter (where clasificacion = 'incobrable'), 2) incobrable from v_notas_entrega where serie = 'HIST'`)));
}

// ── 4. Gestión de cobranza ──
{
  const x = await uno(`select count(*) filter (where factura_id is null) clientes, count(*) filter (where factura_id is not null) documentos,
      (select count(*) from cobranza_gestion_historial where accion = 'crear') historial
    from cobranza_gestion where origen = 'excel'`);
  await caso('Carga del Excel: 21 clientes incobrables + 19 documentos sueltos, con historial', (r) => r.clientes === 21 && r.documentos === 19 && r.historial >= 40, dato(x));
}
const cliQ = await uno(`select c.id from clientes c where c.empresa_id = '${qrt.id}'
  and not exists (select 1 from cobranza_gestion g where g.cliente_id = c.id)
  and (select count(*) from facturas f where f.cliente_id = c.id and f.estado = 'posted' and f.tipo = 'factura' and f.saldo_usd > 1) >= 2
  order by c.created_at limit 1`);
const docsQ = await sql(`select id from facturas where cliente_id = '${cliQ.id}' and estado = 'posted' and tipo = 'factura' and saldo_usd > 1 order by fecha_emision limit 2`);
const clasifPartidas = `(select jsonb_object_agg(p.documento_id, p.clasificacion || '/' || coalesce(p.clasificacion_origen, '-'))
    from public.partidas_cobranza((now() at time zone 'America/Caracas')::date, array['${qrt.id}'::uuid], false) p
   where p.cliente_id = ${lit(cliQ.id)} and p.documento_id in (${lit(docsQ[0].id)}, ${lit(docsQ[1].id)}))`;
await caso('Gestión: marcar el cliente incobrable lo pasa a sus documentos; una excepción por documento manda sobre el cliente', (r) =>
  r.c[docsQ[0].id] === 'incobrable/cliente' && r.c[docsQ[1].id] === 'activa/documento' && r.hist >= 2 && r.por !== null,
  como({}, `perform public.guardar_gestion_cobranza(${lit(cliQ.id)}, null, 'incobrable', 'Cobranza externa', 'Prueba', null);
    perform public.guardar_gestion_cobranza(${lit(cliQ.id)}, ${lit(docsQ[1].id)}, 'activa');
    execute 'reset role';` +
    json(`select ${clasifPartidas} c, (select count(*) from cobranza_gestion_historial h where h.cliente_id = ${lit(cliQ.id)}) hist,
      (select h.usuario_nombre from cobranza_gestion_historial h where h.cliente_id = ${lit(cliQ.id)} order by h.id desc limit 1) por`)));
await caso('Gestión: una excepción igual a la clasificación del cliente no se guarda; quitar vuelve a la del cliente', (r) =>
  r.n === 0 && r.despues === 'activa/-',
  como({ decl: 'g jsonb;' }, `perform public.guardar_gestion_cobranza(${lit(cliQ.id)}, ${lit(docsQ[0].id)}, 'activa');
    g := public.guardar_gestion_cobranza(${lit(cliQ.id)}, ${lit(docsQ[0].id)}, 'incobrable');
    perform public.quitar_gestion_cobranza((g->>'id')::uuid);
    execute 'reset role';` +
    json(`select (select count(*) from cobranza_gestion where cliente_id = ${lit(cliQ.id)}) n, ${clasifPartidas}->>${lit(docsQ[0].id)} despues`)));
await caso('Gestión: el detalle de la cuenta trae la clasificación, las excepciones y el historial', (r) =>
  r.cliente === 'incobrable' && r.docs === 1 && r.hist >= 2,
  como({ decl: 'g jsonb;' }, `perform public.guardar_gestion_cobranza(${lit(cliQ.id)}, null, 'incobrable');
    perform public.guardar_gestion_cobranza(${lit(cliQ.id)}, ${lit(docsQ[1].id)}, 'activa');
    g := public.gestion_cobranza_cliente(${lit(cliQ.id)});` +
    json(`select g->'cliente'->>'clasificacion' cliente, jsonb_array_length(g->'documentos') docs, jsonb_array_length(g->'historial') hist`)));
await caso('Gestión: en «Ambas empresas» no se cambia (solo consulta)', 'Ambas empresas',
  como({ empresa: 'todas' }, `perform public.guardar_gestion_cobranza(${lit(cliQ.id)}, null, 'incobrable');`));
await caso('Gestión: desde la otra empresa el cliente no se encuentra', 'empresa activa',
  como({ empresa: guds.id }, `perform public.guardar_gestion_cobranza(${lit(cliQ.id)}, null, 'incobrable');`));
{
  const otro = await uno(`select id from facturas where empresa_id = '${qrt.id}' and cliente_id <> '${cliQ.id}' and estado = 'posted' limit 1`);
  await caso('Gestión: un documento de otro cliente se rechaza', 'no es de este cliente',
    como({}, `perform public.guardar_gestion_cobranza(${lit(cliQ.id)}, ${lit(otro.id)}, 'incobrable');`));
}
await caso('Gestión: clasificación desconocida se rechaza', 'Clasificación no válida',
  como({}, `perform public.guardar_gestion_cobranza(${lit(cliQ.id)}, null, 'perdida');`));
await caso('Gestión: nadie escribe directo en la tabla desde la API', 'permission denied',
  como({}, `insert into cobranza_gestion (empresa_id, cliente_id, clasificacion) values (${lit(qrt.id)}, ${lit(cliQ.id)}, 'incobrable');`));
const darPermiso = (modulo, editar = false) => `insert into permisos (rol_id, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar)
  select r.id, m.id, true, false, ${editar}, false from roles r, modulos m where r.nombre = 'Vendedor' and m.codigo = '${modulo}'
  on conflict (rol_id, modulo_id) do update set puede_ver = true, puede_editar = ${editar};`;
const quitarPermiso = (modulo) => `delete from permisos where rol_id = (select id from roles where nombre = 'Vendedor') and modulo_id = (select id from modulos where codigo = '${modulo}');`;
if (vendGuds) {
  const cliG = await uno(`select id from clientes where empresa_id = '${guds.id}' order by created_at limit 1`);
  await caso('Gestión: con Cuentas → Ver pero sin Editar no se cambia', 'No tienes permiso para cambiar',
    como({ uid: vendGuds, empresa: guds.id, previo: darPermiso('cuentas') }, `perform public.guardar_gestion_cobranza(${lit(cliG.id)}, null, 'incobrable');`));
}

// ── 5. Notas de entrega ──
const contarNe = json(`select count(*) n, count(*) filter (where serie = 'HIST') hist from notas_entrega`);
await caso('Notas de entrega: el Administrador en Quirutec ve las 29 históricas', (r) => r.hist === 29, como({}, contarNe));
await caso('Notas de entrega: en GUDS no ve las de Quirutec', (r) => r.n === 0, como({ empresa: guds.id }, contarNe));
if (vendGuds) await caso('Notas de entrega: sin el módulo no se leen', (r) => r.n === 0, como({ uid: vendGuds, empresa: guds.id, previo: quitarPermiso('notas_entrega') }, contarNe));
await caso('Notas de entrega: anónimo no las lee', 'permission denied', como({ rol: 'anon', uid: null }, contarNe));
await caso('Notas de entrega: nadie escribe directo desde la API', 'permission denied',
  como({}, `update notas_entrega set total_usd = 0 where serie = 'HIST';`));
await caso('Notas de entrega: 5 clientes con ficha en GUDS (el resto solo con el nombre); vencimiento = emisión', (r) => r.con_ficha === 5 && r.sin_venc === 0,
  dato(await uno(`select count(distinct cliente_id) con_ficha, count(*) filter (where fecha_vencimiento is distinct from fecha_emision) sin_venc
    from notas_entrega where serie = 'HIST'`)));

// ── 6. reporte_antiguedad ──
// (el reporte se calcula una sola vez: "materialized", si no Postgres lo repite por cada partida)
const resumenRep = (ne) => json(`with z as materialized (select public.reporte_antiguedad(null, ${ne}) r) select jsonb_array_length(r->'partidas') n, (select round(sum((x->>'s')::numeric), 2) from jsonb_array_elements(r->'partidas') x) s,
    (select count(*) from jsonb_array_elements(r->'partidas') x where x->>'t' = 'nota_entrega') ne,
    (select count(*) from jsonb_array_elements(r->'partidas') x where x ? 'c' and not (r->'clientes' ? (x->>'c'))) sin_ficha,
    (select string_agg(distinct x->>'e', ',') from jsonb_array_elements(r->'partidas') x) empresas, r->>'corte' corte
  from z`);
{
  const directo = await uno(`select count(*) n, round(sum(saldo_usd), 2) s from public.partidas_cobranza((now() at time zone 'America/Caracas')::date, ${todas}, true)`);
  await caso('reporte_antiguedad («Ambas») = partidas_cobranza: mismas partidas y mismo total; cada cliente con su ficha', (r) =>
    r.n === Number(directo.n) && Math.abs(r.s - Number(directo.s)) < 0.01 && r.ne === 29 && r.sin_ficha === 0, como({ empresa: 'todas' }, resumenRep(true)));
}
await caso('reporte_antiguedad sin el interruptor no trae notas de entrega', (r) => r.ne === 0 && r.n > 1000, como({ empresa: 'todas' }, resumenRep(false)));
await caso('reporte_antiguedad en GUDS trae solo GUDS', (r) => r.empresas === guds.id && r.ne === 0, como({ empresa: guds.id }, resumenRep(true)));
await caso('reporte_antiguedad: un corte futuro se toma como hoy', (r) => r.corte === r.hoy,
  como({ empresa: 'todas' }, json(`select r->>'corte' corte, r->>'hoy' hoy from (select public.reporte_antiguedad(date '2099-01-01', true) r) z`)));
if (vendGuds) {
  await caso('Solo reportes: la antigüedad pide también Cuentas (D10)', 'permiso de Cuentas',
    como({ uid: vendGuds, empresa: guds.id, previo: darPermiso('reportes') + quitarPermiso('cuentas') }, json(`select public.reporte_antiguedad(null, true) is not null x`)));
  await caso('Con reportes y cuentas pero sin el módulo de notas de entrega: la antigüedad sale sin ellas', (r) => r.ne === 0 && r.n > 0,
    como({ uid: vendGuds, empresa: 'todas', previo: darPermiso('reportes') + darPermiso('cuentas') + quitarPermiso('notas_entrega') }, resumenRep(true)));
}
await caso('Anónimo no ejecuta reporte_antiguedad', 'permission denied', como({ rol: 'anon', uid: null }, json(`select public.reporte_antiguedad() is not null x`)));
await caso('partidas_cobranza es interna (no la ejecuta un usuario)', 'permission denied',
  como({}, json(`select count(*) n from public.partidas_cobranza(current_date, array['${qrt.id}'::uuid], true)`)));
await caso('reporte_antiguedad («Ambas», con notas) se calcula en menos de 2 s en la base', (r) => r.ms < 2000 && r.n > 1000,
  como({ empresa: 'todas', decl: 't0 timestamptz; r jsonb;' }, `t0 := clock_timestamp(); r := public.reporte_antiguedad(null, true);` +
    json(`select round(extract(milliseconds from clock_timestamp() - t0)) ms, jsonb_array_length(r->'partidas') n`)));

console.table(casos);
const fallas = casos.filter((c) => c.ok !== '✓').length;
console.log(`${casos.length - fallas}/${casos.length} casos OK`);
process.exit(fallas ? 1 : 0);
