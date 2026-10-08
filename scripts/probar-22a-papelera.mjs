/**
 * Pruebas de la fase 22a (papelera general, anular cobros, cuentas manuales archivadas y permisos de reportes con deuda
 * por cliente). Igual que probar-multiempresa.mjs: cada caso corre como una petición de PostgREST (rol, usuario y header
 * x-empresa-id) dentro de un bloque que SIEMPRE termina en excepción, así la base deshace todo (cobros de prueba,
 * aplicaciones, papelera, avisos). No deja rastro.
 *
 *   node scripts/probar-22a-papelera.mjs
 */
import { sql } from './lib/supabase-admin.mjs';

const [guds, qrt] = await sql(`select id, nombre_corto from empresas order by orden`);
const admin = (await sql(`select u.auth_id from usuarios u join roles r on r.id = u.rol_id
  where u.role = 'admin' and r.nombre = 'Administrador' and u.auth_id is not null and coalesce(u.activo, true) order by u.created_at limit 1`))[0].auth_id;
const vendGuds = (await sql(`select u.auth_id from usuarios u join usuario_empresas ue on ue.usuario_id = u.id
  where u.role = 'vendedor' and u.auth_id is not null group by u.auth_id
  having count(*) = 1 and bool_and(ue.empresa_id = '${guds.id}') limit 1`))[0]?.auth_id;
// Factura de GUDS con saldo y un banco en USD de GUDS para registrar cobros de prueba
const fac = (await sql(`select id, numero, cliente_id, saldo_usd from facturas
  where empresa_id = '${guds.id}' and estado = 'posted' and tipo = 'factura' and coalesce(estado_pago, '') <> 'anulado'
    and saldo_usd between 10 and 5000 and cliente_id is not null order by fecha_emision desc limit 1`))[0];
const banco = (await sql(`select id from bancos where empresa_id = '${guds.id}' and activo and moneda = 'USD' order by nombre limit 1`))[0].id;
const pagoOdoo = (await sql(`select id from pagos where empresa_id = '${guds.id}' and odoo_id is not null and estado = 'verificado' limit 1`))[0].id;

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

/**
 * Corre `cuerpo` (plpgsql; debe asignar la variable de texto `v`, normalmente con row_to_json(...)::text o jsonb) como el
 * usuario `uid` con el rol `rol` y el header x-empresa-id = `empresa`. `decl` declara variables extra; `previo` corre como
 * postgres antes de cambiar de rol. Todo se deshace al final.
 */
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
  casos.push({ ok: ok ? '✓' : '✗', caso: nombre, resultado: texto.slice(0, 110) });
}

// Registra un cobro de prueba de USD `monto` aplicado a la factura `fac` (como el admin, en GUDS) y deja su id en `pid`
const registrar = (monto, aplicar = monto, var_ = 'pid') => `
  ${var_} := (public.registrar_cobro_facturas(${lit(fac.cliente_id)}, ${lit(banco)}, ${monto}, 'USD', null, 'transferencia', 'PRUEBA-22A', null,
    'Cobro de prueba 22a', ${aplicar > 0 ? `jsonb_build_array(jsonb_build_object('factura_id', ${lit(fac.id)}, 'monto', ${aplicar}))` : `'[]'::jsonb`}) ->> 'pago_id')::uuid;`;
const saldo = `(select saldo_usd from facturas where id = ${lit(fac.id)})`;
const MOTIVO = `'Cobro de prueba de la suite 22a'`;

// ── Anular ──
await caso('Admin anula un cobro de GUDS: estado, saldo, banco y papelera', (r) =>
  r.estado === 'anulado' && Math.abs(r.saldo_despues - r.saldo_antes) < 0.005 && Math.abs(r.saldo_con_cobro - (r.saldo_antes - 3)) < 0.005
  && r.aplicaciones === 0 && r.movimientos === 0 && r.papelera === 1 && r.aplic_foto === 1 && r.motivo === 'Cobro de prueba de la suite 22a'
  && r.quien_ok && r.restaurable,
  como({ decl: 'pid uuid; s0 numeric; s1 numeric; res jsonb;' }, `
    s0 := ${saldo};
    ${registrar(3)}
    s1 := ${saldo};
    res := public.anular_cobro(pid, ${MOTIVO});
    v := (select row_to_json(t)::text from (select (select estado::text from pagos where id = pid) estado, s0 saldo_antes, s1 saldo_con_cobro,
      ${saldo} saldo_despues, (select count(*) from pago_facturas where pago_id = pid) aplicaciones,
      (select count(*) from movimientos_bancarios where pago_id = pid) movimientos,
      (select count(*) from papelera where tipo = 'cobro' and registro_id = pid) papelera,
      (select jsonb_array_length(datos->'aplicaciones') from papelera where registro_id = pid) aplic_foto,
      (select motivo from papelera where registro_id = pid) motivo,
      (select eliminado_por is not null and eliminado_por_nombre is not null from papelera where registro_id = pid) quien_ok,
      (select restaurable from papelera where registro_id = pid) restaurable) t);`));

await caso('Anular también anula el IGTF que nació del cobro', (r) => r.principal === 'anulado' && r.igtf === 'anulado' && r.cobros === 2,
  como({ decl: 'pid uuid; igtf uuid; res jsonb;' }, `
    ${registrar(3)}
    execute 'reset role';
    insert into pagos (cliente_id, banco_id, metodo, monto, monto_moneda, moneda, estado, es_igtf, igtf_origen_id, empresa_id)
    values (${lit(fac.cliente_id)}, ${lit(banco)}, 'transferencia', 0.09, 0.09, 'USD', 'verificado', true, pid, ${lit(guds.id)}) returning id into igtf;
    execute 'set local role authenticated';
    res := public.anular_cobro(pid, ${MOTIVO});
    v := (select row_to_json(t)::text from (select (select estado::text from pagos where id = pid) principal,
      (select estado::text from pagos where id = igtf) igtf, (res->>'cobros')::int cobros) t);`));

await caso('El IGTF solo no se anula (se anula con su cobro)', 'anula el cobro principal',
  como({ decl: 'pid uuid; igtf uuid;' }, `
    ${registrar(3)}
    execute 'reset role';
    insert into pagos (cliente_id, banco_id, metodo, monto, monto_moneda, moneda, estado, es_igtf, igtf_origen_id, empresa_id)
    values (${lit(fac.cliente_id)}, ${lit(banco)}, 'transferencia', 0.09, 0.09, 'USD', 'verificado', true, pid, ${lit(guds.id)}) returning id into igtf;
    execute 'set local role authenticated';
    perform public.anular_cobro(igtf, ${MOTIVO});`));

await caso('No se anula un cobro que viene de Odoo', 'viene de Odoo: anúlalo en Odoo',
  como({}, `perform public.anular_cobro(${lit(pagoOdoo)}, ${MOTIVO});`));
await caso('El motivo es obligatorio', 'Indica el motivo',
  como({ decl: 'pid uuid;' }, `${registrar(3)} perform public.anular_cobro(pid, 'x');`));
await caso('No se anula dos veces', 'ya está anulado',
  como({ decl: 'pid uuid;' }, `${registrar(3)} perform public.anular_cobro(pid, ${MOTIVO}); perform public.anular_cobro(pid, ${MOTIVO});`));
await caso('En «Ambas» no se anula (modo consulta)', 'Modo consulta',
  como({ decl: 'pid uuid;' }, `${registrar(3)}
    perform set_config('request.headers', '{"x-empresa-id":"todas"}', true);
    perform public.anular_cobro(pid, ${MOTIVO});`));
await caso('No se cambia el estado a "anulado" por fuera de la función', 'botón «Anular»',
  como({ decl: 'pid uuid;' }, `${registrar(3)} update pagos set estado = 'anulado' where id = pid;`));
if (vendGuds) {
  await caso('Un vendedor no puede anular cobros', 'Solo un administrador',
    como({ uid: vendGuds, previo: `perform 1;` }, `perform public.anular_cobro(${lit(pagoOdoo)}, ${MOTIVO});`));
}
await caso('Un Contador (cuentas sí, papelera no) no puede anular', 'Solo un administrador',
  como({ decl: 'pid uuid;', previo: `update usuarios set rol_id = (select id from roles where nombre = 'Contador') where auth_id = ${lit(admin)};` },
    `perform public.anular_cobro(${lit(pagoOdoo)}, ${MOTIVO});`));

// ── Restaurar ──
await caso('Restaurar devuelve el cobro a verificado y lo reaplica', (r) =>
  r.estado === 'verificado' && Math.abs(r.saldo - (r.saldo_antes - 3)) < 0.005 && r.aplicaciones === 1 && r.movimientos === 1 && r.restaurado && r.motivo === null,
  como({ decl: 'pid uuid; s0 numeric; pap uuid;' }, `
    s0 := ${saldo};
    ${registrar(3)}
    pap := (public.anular_cobro(pid, ${MOTIVO}) ->> 'papelera_id')::uuid;
    perform public.restaurar_papelera(pap);
    v := (select row_to_json(t)::text from (select (select estado::text from pagos where id = pid) estado, s0 saldo_antes, ${saldo} saldo,
      (select count(*) from pago_facturas where pago_id = pid) aplicaciones, (select count(*) from movimientos_bancarios where pago_id = pid) movimientos,
      (select restaurado_at is not null and restaurado_por is not null from papelera where id = pap) restaurado,
      (select motivo_anulacion from pagos where id = pid) motivo) t);`));
await caso('No se restaura si la factura ya no tiene saldo', 'ya no tiene saldo suficiente',
  como({ decl: 'pid uuid; otro uuid; pap uuid; s numeric;' }, `
    ${registrar(3)}
    pap := (public.anular_cobro(pid, ${MOTIVO}) ->> 'papelera_id')::uuid;
    s := ${saldo};
    otro := (public.registrar_cobro_facturas(${lit(fac.cliente_id)}, ${lit(banco)}, s, 'USD', null, 'transferencia', 'PRUEBA-22A-2', null, 'Prueba 22a',
      jsonb_build_array(jsonb_build_object('factura_id', ${lit(fac.id)}, 'monto', s))) ->> 'pago_id')::uuid;
    perform public.restaurar_papelera(pap);`));
await caso('No se restaura dos veces', 'ya se restauró',
  como({ decl: 'pid uuid; pap uuid;' }, `${registrar(3)}
    pap := (public.anular_cobro(pid, ${MOTIVO}) ->> 'papelera_id')::uuid;
    perform public.restaurar_papelera(pap); perform public.restaurar_papelera(pap);`));
await caso('Lo marcado como no restaurable no se restaura', 'no se puede restaurar',
  como({ decl: 'pap uuid;', previo: `insert into papelera (tipo, accion, titulo, empresa_id, restaurable) values ('cuenta_manual', 'archivado', 'Cuenta de prueba 22a', ${lit(guds.id)}, false) returning id into pap;` },
    `perform public.restaurar_papelera(pap);`));
await caso('Un tipo sin función de restaurar no se restaura', 'no se restaura desde la Papelera',
  como({ decl: 'pap uuid;', previo: `insert into papelera (tipo, accion, titulo, empresa_id) values ('prueba_22a', 'anulado', 'Prueba 22a', ${lit(guds.id)}) returning id into pap;` },
    `perform public.restaurar_papelera(pap);`));
if (vendGuds) {
  await caso('Un vendedor no puede restaurar', 'Solo un administrador',
    como({ uid: vendGuds, decl: 'pap uuid;', previo: `insert into papelera (tipo, titulo, empresa_id) values ('cobro', 'Prueba 22a', ${lit(guds.id)}) returning id into pap;` },
      `perform public.restaurar_papelera(pap);`));
}
await caso('papelera_guardar no se llama desde la API', 'permission denied',
  como({}, `perform public.papelera_guardar('cobro', 'anulado', null, null, null, null, null, 'x', null, '{}'::jsonb, null, true);`));

// ── Lectura de la papelera (RLS) ──
const sembrar = `insert into papelera (tipo, titulo, empresa_id) values ('prueba_22a', 'Prueba GUDS', ${lit(guds.id)}), ('prueba_22a', 'Prueba Quirutec', ${lit(qrt.id)});`;
const contarPrueba = `v := (select row_to_json(t)::text from (select count(*) n, count(*) filter (where empresa_id = ${lit(guds.id)}) guds,
  count(*) filter (where empresa_id = ${lit(qrt.id)}) qrt from papelera where tipo = 'prueba_22a') t);`;
await caso('Admin en GUDS ve solo la papelera de GUDS', (r) => r.guds === 1 && r.qrt === 0, como({ previo: sembrar }, contarPrueba));
await caso('Admin en «Ambas» ve la papelera de las dos empresas', (r) => r.guds === 1 && r.qrt === 1, como({ previo: sembrar, empresa: 'todas' }, contarPrueba));
if (vendGuds) await caso('Un vendedor no ve la papelera', (r) => r.n === 0, como({ uid: vendGuds, previo: sembrar }, contarPrueba));
await caso('Anónimo no lee la papelera', 'permission denied', como({ rol: 'anon', uid: null, previo: sembrar }, contarPrueba));
await caso('Nadie escribe la papelera directo desde la API', 'permission denied',
  como({}, `insert into papelera (tipo, titulo, empresa_id) values ('prueba_22a', 'x', ${lit(guds.id)});`));

// ── Los reportes no cuentan cobros anulados ──
await caso('Anticipos (v_anticipos) y cobranza del día dejan fuera el cobro anulado', (r) =>
  r.ant_con === r.ant_base + 1 && r.ant_despues === r.ant_base && Math.abs(r.cob_con - r.cob_base - 7) < 0.005 && Math.abs(r.cob_despues - r.cob_base) < 0.005,
  como({ decl: 'pid uuid; a0 int; a1 int; c0 numeric; c1 numeric;' }, `
    a0 := (select count(*) from v_anticipos);
    c0 := (select coalesce(sum(monto_usd), 0) from public.reporte_cobranza(current_date - 1, current_date + 1, 'empresa'));
    ${registrar(7, 0)}
    a1 := (select count(*) from v_anticipos);
    c1 := (select coalesce(sum(monto_usd), 0) from public.reporte_cobranza(current_date - 1, current_date + 1, 'empresa'));
    perform public.anular_cobro(pid, ${MOTIVO});
    v := (select row_to_json(t)::text from (select a0 ant_base, a1 ant_con, (select count(*) from v_anticipos) ant_despues,
      c0 cob_base, c1 cob_con, (select coalesce(sum(monto_usd), 0) from public.reporte_cobranza(current_date - 1, current_date + 1, 'empresa')) cob_despues) t);`));

// ── Cuentas manuales viejas (22a3) ──
await caso('Cuentas manuales: todas archivadas y en la papelera', (r) => r.vigentes === 0 && r.archivadas === r.papelera && r.papelera > 0,
  como({ rol: 'postgres', uid: null, empresa: null }, `v := (select row_to_json(t)::text from (select
    (select count(*) from cuentas_cobrar where archivada_at is null) vigentes, (select count(*) from cuentas_cobrar where archivada_at is not null) archivadas,
    (select count(*) from papelera where tipo = 'cuenta_manual') papelera) t);`));
await caso('Cuentas manuales: ya no se crean desde la API', 'permission denied',
  como({}, `insert into cuentas_cobrar (cliente_id, concepto, monto) values (${lit(fac.cliente_id)}, 'Prueba 22a', 1);`));

// ── Reportes con deuda por cliente: exigen reportes Y cuentas (22a4) ──
const darPermiso = (modulo) => `insert into permisos (rol_id, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar)
  select r.id, m.id, true, false, false, false from roles r, modulos m where r.nombre = 'Vendedor' and m.codigo = '${modulo}'
  on conflict (rol_id, modulo_id) do update set puede_ver = true;`;
const quitarPermiso = (modulo) => `delete from permisos where rol_id = (select id from roles where nombre = 'Vendedor') and modulo_id = (select id from modulos where codigo = '${modulo}');`;
const dso = `v := (select row_to_json(t)::text from (select count(*) n from public.reporte_dso(90, 'vendedor')) t);`;
if (vendGuds) {
  await caso('DSO: con reportes y sin cuentas no se ve', 'permiso de Cuentas',
    como({ uid: vendGuds, previo: darPermiso('reportes') + quitarPermiso('cuentas') }, dso));
  await caso('DSO: con reportes y cuentas sí se ve', (r) => r.n >= 0,
    como({ uid: vendGuds, previo: darPermiso('reportes') + darPermiso('cuentas') }, dso));
  await caso('DSO: sin reportes no se ve', 'reportes',
    como({ uid: vendGuds, previo: quitarPermiso('reportes') + darPermiso('cuentas') }, dso));
}
await caso('DSO: el Administrador lo ve', (r) => r.n > 0, como({}, dso));

console.table(casos);
const fallas = casos.filter((c) => c.ok !== '✓').length;
console.log(fallas ? `✗ ${fallas} de ${casos.length} casos fallaron` : `✓ ${casos.length} casos OK`);
process.exit(fallas ? 1 : 0);
