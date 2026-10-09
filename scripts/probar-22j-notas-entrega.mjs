/**
 * Pruebas de la fase 22j (NE2–NE3 del plan de reportes de finanzas): notas de entrega que nacen de un pedido de Odoo
 * entregado y sin facturar, abonos enlazados a cobros de Odoo, conversión a factura, anulación a la papelera, las N/E como
 * venta y el check "incluir notas de entrega" del estado de cuenta.
 * Mismo estilo que probar-22g/22h: cada caso corre en un bloque que termina en excepción (se deshace todo: no queda ninguna
 * nota emitida ni nada escrito; nada de esto toca Odoo).
 *
 *   node scripts/probar-22j-notas-entrega.mjs
 */
import { sql } from './lib/supabase-admin.mjs';

const emps = await sql(`select id, nombre_corto from empresas order by orden`);
const guds = emps.find((e) => e.nombre_corto === 'GUDS'), qrt = emps.find((e) => e.nombre_corto === 'Quirutec');
const hoy = `(now() at time zone 'America/Caracas')::date`;
const usuarioDe = async (rol) => (await sql(`select u.auth_id from usuarios u join roles r on r.id = u.rol_id
  where r.nombre = '${rol}' and u.auth_id is not null and coalesce(u.activo, true) order by u.created_at limit 1`))[0]?.auth_id;
const admin = await usuarioDe('Administrador');
const contador = await usuarioDe('Contador');
const vendedor = (await sql(`select u.auth_id from usuarios u where u.role = 'vendedor' and u.auth_id is not null and coalesce(u.activo, true)
  order by u.created_at limit 1`))[0]?.auth_id;
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

// Pedido de GUDS con lo entregado sin facturar y un cliente con un cobro de Odoo sin aplicar (para enlazar abonos)
const base = (await sql(`
  with l as (select * from public.ne_lineas_pendientes(array['${guds.id}']::uuid[]) where pendiente > 0.0005),
  o as (select l.orden_id, o.cliente_id, round(sum(l.pendiente * l.precio), 2) usd, count(*) lineas from l join ordenes o on o.id = l.orden_id
         group by 1, 2 having sum(l.pendiente * l.precio) > 20)
  select o.*, (select a.pago_id from v_anticipos a where a.cliente_id = o.cliente_id and a.odoo_id is not null and a.disponible > 5
                order by a.disponible desc limit 1) pago,
         (select a.disponible from v_anticipos a where a.cliente_id = o.cliente_id and a.odoo_id is not null and a.disponible > 5
                order by a.disponible desc limit 1) disp
    from o order by (select count(*) from v_anticipos a where a.cliente_id = o.cliente_id and a.odoo_id is not null and a.disponible > 5) desc, o.usd desc
   limit 1`))[0];
if (!base?.pago) { console.error('No hay un pedido de GUDS entregado sin facturar con un cliente que tenga un cobro de Odoo sin aplicar'); process.exit(1); }
const hist = (await sql(`select n.id from notas_entrega n join v_notas_entrega v on v.id = n.id
  where n.serie = 'HIST' and n.cliente_id is null and v.saldo_usd > 10 order by n.numero limit 1`))[0]?.id;

async function como({ uid = admin, empresa = guds.id, previo = '', decl = '' }, cuerpo) {
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
const dato = (obj) => Promise.resolve({ ok: JSON.stringify(obj) });
const uno = async (q) => (await sql(q))[0];
const O = lit(base.orden_id), C = lit(base.cliente_id), P = lit(base.pago);
// Emitir la N/E del pedido base (como el usuario de la sesión) y dejar su id en n
const EMITIR = `n := public.emitir_nota_entrega(${O});`;
const COMO_DUENO = `execute 'reset role';`;
const COMO_USUARIO = `execute 'set local role authenticated';`;
const PARTIDAS_CLIENTE = `(select round(sum(saldo_usd), 2) from public.partidas_cobranza(${hoy}, array['${guds.id}']::uuid[], true) where cliente_id = ${C})`;

// ── 1. De dónde nace ──
await caso('pedidos_para_nota_entrega: los de GUDS con lo entregado sin facturar (el pendiente = la suma de sus líneas)', (r) =>
  r.pedidos > 0 && r.mal === 0 && r.de_quirutec === 0 && r.tiene_base,
  como({}, `r := public.pedidos_para_nota_entrega();
    v := json_build_object('pedidos', jsonb_array_length(r),
      'mal', (select count(*) from jsonb_array_elements(r) p
               where abs((p->>'pendiente_usd')::numeric - (select sum((l->>'subtotal')::numeric) from jsonb_array_elements(p->'lineas') l)) > 0.02),
      'de_quirutec', (select count(*) from jsonb_array_elements(r) p where (p->>'empresa_id')::uuid <> '${guds.id}'),
      'tiene_base', exists (select 1 from jsonb_array_elements(r) p where (p->>'orden_id')::uuid = ${O}))::text;`));
await caso('ne_lineas_pendientes = las líneas de Odoo con entregado > facturado (sin notas emitidas todavía)', (r) => r.a === r.b && r.a > 0,
  dato(await uno(`select (select count(*) from public.ne_lineas_pendientes((select array_agg(id) from empresas)) where pendiente > 0.0005) a,
    (select count(*) from orden_items i join ordenes o on o.id = i.orden_id where o.odoo_id is not null and o.estado_odoo = 'sale'
      and coalesce(i.cantidad_entregada, 0) - coalesce(i.cantidad_facturada, 0) > 0.0005) b`)));

// ── 2. Emitir ──
await caso('emitir: serie NE con correlativo, todas las líneas pendientes, total = pendiente, vence = emisión + días de crédito', (r) =>
  r.serie === 'NE' && /^\d{6}$/.test(r.numero) && Math.abs(r.total - base.usd) < 0.02 && r.items === Number(base.lineas) && r.estado === 'emitida'
  && r.vence_ok && r.queda === 0 && r.origen === 'guds' && r.pedido_ok,
  como({}, `${EMITIR}
    v := (select json_build_object('serie', n2.serie, 'numero', n2.numero, 'total', n2.total_usd, 'estado', n2.estado, 'origen', n2.origen,
      'items', (select count(*) from nota_entrega_items i where i.nota_id = n2.id),
      'vence_ok', n2.fecha_vencimiento = n2.fecha_emision + coalesce((select dias_credito from clientes where id = n2.cliente_id), 0),
      'pedido_ok', n2.orden_id = ${O} and n2.pedido_odoo = (select numero from ordenes where id = ${O}),
      'queda', 0)::text
      from notas_entrega n2 where n2.id = n);
    ${COMO_DUENO}
    v := (v::jsonb || jsonb_build_object('queda', (select count(*) from public.ne_lineas_pendientes(array['${guds.id}']::uuid[], ${O}) where pendiente > 0.0005)))::text;`));
await caso('emitir dos veces el mismo pedido: no hay nada más sin facturar', 'nada entregado sin facturar',
  como({}, `${EMITIR} n := public.emitir_nota_entrega(${O});`));
await caso('emitir más de lo pendiente en una línea: rechazado', 'no puede pasar de lo entregado',
  como({ previo: `select orden_item_id, pendiente into x from public.ne_lineas_pendientes(array['${guds.id}']::uuid[], ${O}) where pendiente > 0.0005 limit 1;` },
    `n := public.emitir_nota_entrega(${O}, jsonb_build_array(jsonb_build_object('orden_item_id', x.orden_item_id, 'cantidad', x.pendiente + 5)));`));
await caso('emitir una parte: solo esa línea y esa cantidad; el resto sigue pendiente', (r) => r.items === 1 && r.queda > 0 && Math.abs(r.total - r.esperado) < 0.01,
  como({ previo: `select orden_item_id, round(pendiente / 2, 3) c, precio into x from public.ne_lineas_pendientes(array['${guds.id}']::uuid[], ${O}) where pendiente > 0.0005 order by descripcion limit 1;` },
    `n := public.emitir_nota_entrega(${O}, jsonb_build_array(jsonb_build_object('orden_item_id', x.orden_item_id, 'cantidad', x.c)));
    v := json_build_object('items', (select count(*) from nota_entrega_items where nota_id = n), 'total', (select total_usd from notas_entrega where id = n),
      'esperado', round(x.c * x.precio, 2))::text;
    ${COMO_DUENO}
    v := (v::jsonb || jsonb_build_object('queda', (select round(sum(pendiente), 3) from public.ne_lineas_pendientes(array['${guds.id}']::uuid[], ${O}))))::text;`));
await caso('emitir en «Ambas»: solo consulta', 'Selecciona una empresa', como({ empresa: null }, EMITIR));
await caso('emitir con Quirutec activa un pedido de GUDS: rechazado', 'otra empresa', como({ empresa: qrt.id }, EMITIR));
await caso('emitir sin permiso (vendedor): rechazado', 'permiso', como({ uid: vendedor }, EMITIR));
await caso('el Contador puede emitir (crear) notas de entrega', (r) => r.ok === true, como({ uid: contador }, `${EMITIR} v := json_build_object('ok', n is not null)::text;`));
await caso('las tablas siguen cerradas: insertar una nota directo está prohibido', 'permission denied',
  como({}, `insert into notas_entrega (empresa_id, serie, numero, cliente_nombre, fecha_emision, total_usd) values ('${guds.id}', 'NE', '999999', 'x', ${hoy}, 1);`));

// ── 3. Deuda y venta ──
await caso('la N/E entra en la antigüedad (saldo = total) y en la deuda de los días de recuperación', (r) => r.partida === r.total && r.rec_ne === r.total,
  como({}, `${EMITIR} ${COMO_DUENO}
    v := json_build_object('total', (select total_usd from notas_entrega where id = n),
      'partida', (select saldo_usd from public.partidas_cobranza(${hoy}, array['${guds.id}']::uuid[], true) where ref = 'n:' || n),
      'rec_ne', (select notas_entrega from public.recuperacion_calculo(${hoy}, array['${guds.id}']::uuid[], true, array[${C}]::uuid[])))::text;`));
await caso('la N/E cuenta como venta (sin IVA) con el interruptor; sin él, no', (r) => r.con === r.total && r.sin === 0,
  como({}, `${EMITIR} ${COMO_DUENO}
    v := json_build_object('total', (select total_usd from notas_entrega where id = n),
      'con', (select coalesce(sum(venta_usd), 0) from public.ventas_con_iva('2020-01-01', ${hoy}, array['${guds.id}']::uuid[], true) where fuente = 'nota_entrega' and cliente_id = ${C}),
      'sin', (select count(*) from public.ventas_con_iva('2020-01-01', ${hoy}, array['${guds.id}']::uuid[], false) where fuente = 'nota_entrega'))::text;`));

// ── 4. Abonos enlazados a un cobro de Odoo ──
await caso('cobros_para_nota_entrega: los cobros de Odoo sin aplicar del cliente', (r) => r.n > 0 && r.base,
  como({}, `${EMITIR} r := public.cobros_para_nota_entrega(n);
    v := json_build_object('n', jsonb_array_length(r), 'base', exists (select 1 from jsonb_array_elements(r) c where (c->>'pago_id')::uuid = ${P}))::text;`));
await caso('abonar con el cobro: baja el saldo de la N/E, el cobro deja de ser saldo a favor por ese monto y la deuda neta del cliente no cambia', (r) =>
  Math.abs(r.saldo - (r.total - r.monto)) < 0.01 && Math.abs(r.disp_antes - r.disp_despues - r.monto) < 0.01 && Math.abs(r.neto_antes - r.neto_despues) < 0.01
  && r.estado === 'abonada' && r.vinculado === r.monto,
  como({ decl: 'm numeric; d0 numeric; p0 numeric;' }, `${EMITIR}
    ${COMO_DUENO} p0 := ${PARTIDAS_CLIENTE}; ${COMO_USUARIO}
    d0 := (select disponible from v_anticipos where pago_id = ${P});
    m := round(least(d0, (select total_usd from notas_entrega where id = n)) / 2, 2);
    perform public.abonar_nota_entrega(n, m, ${P});
    ${COMO_DUENO}
    v := json_build_object('monto', m, 'total', (select total_usd from notas_entrega where id = n), 'saldo', (select saldo from public.ne_saldos(null, array[n])),
      'estado', (select estado from notas_entrega where id = n), 'disp_antes', d0, 'disp_despues', (select coalesce(disponible, 0) from v_anticipos where pago_id = ${P}),
      'vinculado', public.ne_vinculado(${P}), 'neto_antes', p0, 'neto_despues', ${PARTIDAS_CLIENTE})::text;`));
await caso('abonar más de lo que le queda al cobro: rechazado', 'solo le quedan',
  como({ previo: `update pagos set saldo_odoo_usd = 1 where id = ${P};` }, `${EMITIR} perform public.abonar_nota_entrega(n, 2, ${P});`));
await caso('abonar más que el saldo de la nota: rechazado', 'pasa del saldo',
  como({}, `${EMITIR} perform public.abonar_nota_entrega(n, (select total_usd + 1 from notas_entrega where id = n), ${P});`));
await caso('abonar con un cobro de otro cliente: rechazado', 'otro cliente',
  como({}, `${EMITIR} perform public.abonar_nota_entrega(n, 1, (select a.pago_id from v_anticipos a where a.odoo_id is not null and a.disponible > 1
      and a.cliente_id <> ${C} and a.empresa_id = '${guds.id}' limit 1));`));
await caso('abono sin cobro de Odoo exige referencia; con referencia queda en GUDS', (r, e) => r?.ok === true,
  como({}, `${EMITIR}
    begin perform public.abonar_nota_entrega(n, 1); v := 'sin error'; exception when others then v := sqlerrm; end;
    if v not like '%referencia%' then raise exception 'esperaba pedir la referencia: %', v; end if;
    perform public.abonar_nota_entrega(n, 1, null, ${hoy}, 'TRF-123');
    v := json_build_object('ok', (select count(*) = 1 from nota_entrega_movimientos where nota_id = n and pago_id is null and referencia = 'TRF-123'))::text;`));
if (hist) {
  await caso('abonar una nota histórica sin ficha (con referencia)', (r) => r.estado === 'abonada' || r.estado === 'pagada',
    como({ empresa: qrt.id }, `perform public.abonar_nota_entrega(${lit(hist)}, 1, null, ${hoy}, 'Depósito prueba');
      v := json_build_object('estado', (select estado from notas_entrega where id = ${lit(hist)}))::text;`));
}

// ── 5. Conversión a factura ──
// Odoo factura lo de la N/E: sube la cantidad facturada de sus líneas y aparece una factura del pedido (todo simulado y deshecho)
const FACTURAR = `
    ${COMO_DUENO}
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    update orden_items oi set cantidad_facturada = coalesce(oi.cantidad_facturada, 0) + i.cantidad
      from nota_entrega_items i where i.nota_id = n and i.orden_item_id = oi.id;
    insert into facturas (numero, tipo, cliente_id, orden_id, empresa_id, fecha_emision, fecha_vencimiento, moneda, subtotal, impuesto, total,
                          total_usd, saldo_pendiente, saldo_odoo_usd, estado, estado_pago)
    select 'PRUEBA-22J', 'factura', ${C}, ${O}, '${guds.id}', ${hoy}, ${hoy}, 'USD', total_usd, round(total_usd * 0.16, 2), round(total_usd * 1.16, 2),
           round(total_usd * 1.16, 2), round(total_usd * 1.16, 2), round(total_usd * 1.16, 2), 'posted', 'pendiente'
      from notas_entrega where id = n;
    perform set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: admin, role: 'authenticated' }))}, true);
    ${COMO_USUARIO}`;
await caso('sugerencia: la factura del pedido, por lo que Odoo facturó de las líneas de la N/E', (r) => r.del_pedido && Math.abs(r.sugerido - r.total) < 0.02,
  como({}, `${EMITIR} ${FACTURAR}
    r := public.conversion_nota_entrega(n);
    v := json_build_object('del_pedido', (r->0->>'del_pedido')::boolean, 'sugerido', (r->0->>'sugerido')::numeric,
      'total', (select total_usd from notas_entrega where id = n))::text;`));
await caso('convertir con un abono: la nota queda facturada en cero, el abono se traslada y el cobro vuelve a ser anticipo', (r) =>
  r.estado === 'facturada' && Math.abs(r.saldo) < 0.01 && r.vinculado === 0 && Math.abs(r.disp - r.disp0) < 0.01 && r.trasladado > 0 && r.venta === 0,
  como({ decl: 'd0 numeric;' }, `${EMITIR}
    d0 := (select disponible from v_anticipos where pago_id = ${P});
    perform public.abonar_nota_entrega(n, round(least(d0, (select total_usd from notas_entrega where id = n)) / 2, 2), ${P});
    ${FACTURAR}
    r := public.convertir_nota_entrega(n, (select id from facturas where numero = 'PRUEBA-22J'));
    ${COMO_DUENO}
    v := json_build_object('estado', r->>'estado', 'trasladado', (r->>'trasladado')::numeric, 'saldo', (select saldo from public.ne_saldos(null, array[n])),
      'vinculado', public.ne_vinculado(${P}), 'disp0', d0, 'disp', (select disponible from v_anticipos where pago_id = ${P}),
      'venta', (select coalesce(sum(venta_usd), 0) from public.ventas_con_iva('2020-01-01', ${hoy}, array['${guds.id}']::uuid[], true) where fuente = 'nota_entrega' and cliente_id = ${C}))::text;`));
await caso('convertir una parte de una nota ya pagada: el excedente del abono se divide y se traslada (queda pagada, no negativa)', (r) =>
  Math.abs(r.saldo) < 0.01 && r.estado === 'pagada' && r.partes === 2 && Math.abs(r.vigente - (r.total - r.facturado)) < 0.02,
  como({}, `${EMITIR}
    perform public.abonar_nota_entrega(n, least((select disponible from v_anticipos where pago_id = ${P}), (select total_usd from notas_entrega where id = n)), ${P});
    ${FACTURAR}
    perform public.convertir_nota_entrega(n, (select id from facturas where numero = 'PRUEBA-22J'), round((select total_usd from notas_entrega where id = n) / 3, 2));
    v := json_build_object('saldo', (select saldo from public.ne_saldos(null, array[n])), 'estado', (select estado from notas_entrega where id = n),
      'total', (select total_usd from notas_entrega where id = n), 'facturado', (select facturado from public.ne_saldos(null, array[n])),
      'partes', (select count(*) from nota_entrega_movimientos where nota_id = n and tipo = 'abono'),
      'vigente', (select sum(monto_usd) from nota_entrega_movimientos where nota_id = n and tipo = 'abono' and trasladado is null))::text;`).then((x) => x));
await caso('convertir con una factura de otro cliente: rechazado', 'otro cliente',
  como({}, `${EMITIR} perform public.convertir_nota_entrega(n, (select id from facturas where estado = 'posted' and tipo = 'factura' and cliente_id <> ${C}
      and empresa_id = '${guds.id}' limit 1));`));
await caso('convertir dos veces con la misma factura: rechazado', 'ya está registrada',
  como({}, `${EMITIR} ${FACTURAR}
    perform public.convertir_nota_entrega(n, (select id from facturas where numero = 'PRUEBA-22J'), 1);
    perform public.convertir_nota_entrega(n, (select id from facturas where numero = 'PRUEBA-22J'), 1);`));
await caso('torre: "por convertir" cuenta la nota cuando su pedido se factura', (r) => r.despues === r.antes + 1,
  como({ decl: 'a int;' }, `${EMITIR} a := (public.alertas_notas_entrega()->>'por_convertir')::int; ${FACTURAR}
    v := json_build_object('antes', a, 'despues', (public.alertas_notas_entrega()->>'por_convertir')::int)::text;`));

// ── 6. Descuento, devolución, quitar y anular ──
await caso('devolución mayor a lo sin facturar: rechazada', 'sin facturar',
  como({}, `${EMITIR} perform public.ajustar_nota_entrega(n, 'devolucion', (select total_usd + 1 from notas_entrega where id = n), 'prueba');`));
await caso('devolución total: la nota queda devuelta y deja de contar como venta', (r) => r.estado === 'devuelta' && r.venta === 0,
  como({}, `${EMITIR} perform public.ajustar_nota_entrega(n, 'devolucion', (select total_usd from notas_entrega where id = n), 'Devolvió la mercancía');
    ${COMO_DUENO}
    v := json_build_object('estado', (select estado from notas_entrega where id = n),
      'venta', (select coalesce(sum(venta_usd), 0) from public.ventas_con_iva('2020-01-01', ${hoy}, array['${guds.id}']::uuid[], true) where fuente = 'nota_entrega' and cliente_id = ${C}))::text;`));
await caso('quitar un abono: va a la papelera y la nota vuelve a su saldo', (r) => r.papelera === 1 && r.estado === 'emitida' && r.vinculado === 0,
  como({}, `${EMITIR} perform public.abonar_nota_entrega(n, 1, ${P});
    perform public.quitar_movimiento_nota_entrega((select id from nota_entrega_movimientos where nota_id = n), 'Error de carga');
    ${COMO_DUENO}
    v := json_build_object('papelera', (select count(*) from papelera where tipo = 'movimiento_nota_entrega' and numero = (select serie || ' ' || numero from notas_entrega where id = n)),
      'estado', (select estado from notas_entrega where id = n), 'vinculado', public.ne_vinculado(${P}))::text;`));
await caso('el Contador no puede quitar movimientos (eliminar es del Administrador)', 'permiso',
  como({ uid: contador }, `${EMITIR} perform public.ajustar_nota_entrega(n, 'descuento', 1, 'prueba');
    perform public.quitar_movimiento_nota_entrega((select id from nota_entrega_movimientos where nota_id = n), 'x');`));
await caso('anular con movimientos de GUDS: hay que quitarlos antes', 'quítalos antes',
  como({}, `${EMITIR} perform public.ajustar_nota_entrega(n, 'descuento', 1, 'prueba'); perform public.anular_nota_entrega(n, 'prueba');`));
await caso('anular: a la papelera, fuera de la deuda y de la venta, el pedido vuelve a quedar pendiente; restaurar la devuelve', (r) =>
  r.estado === 'anulada' && r.partida === 0 && r.pend > 0 && r.restaurada === 'emitida',
  como({}, `${EMITIR} perform public.anular_nota_entrega(n, 'Emitida por error');
    ${COMO_DUENO}
    v := json_build_object('estado', (select estado from notas_entrega where id = n),
      'partida', (select count(*) from public.partidas_cobranza(${hoy}, array['${guds.id}']::uuid[], true) where ref = 'n:' || n),
      'pend', (select count(*) from public.ne_lineas_pendientes(array['${guds.id}']::uuid[], ${O}) where pendiente > 0.0005))::text;
    ${COMO_USUARIO}
    perform public.restaurar_papelera((select id from papelera where tipo = 'nota_entrega' and registro_id = n));
    v := (v::jsonb || jsonb_build_object('restaurada', (select estado from notas_entrega where id = n)))::text;`));

// ── 7. Estado de cuenta ──
await caso('estado de cuenta con el check: la N/E sale como un documento más y suma al resumen; sin el check, no', (r) =>
  r.con_fila && r.sin_fila === false && Math.abs(r.saldo_con - r.saldo_sin - r.ne) < 0.02 && r.resumen_ne === r.ne && r.no_fiscal,
  como({}, `${EMITIR}
    r := public.estado_cuenta_cliente(${C}, p_movimientos => false, p_ne => true);
    v := json_build_object('ne', (select total_usd from notas_entrega where id = n),
      'con_fila', exists (select 1 from jsonb_array_elements(r->'abiertos') d where d->>'tipo' = 'nota_entrega' and (d->>'nota_entrega_id')::uuid = n),
      'no_fiscal', exists (select 1 from jsonb_array_elements(r->'abiertos') d where d->>'tipo' = 'nota_entrega' and (d->>'no_fiscal')::boolean and (d->>'iva')::numeric = 0),
      'saldo_con', (r->'resumen'->>'saldo')::numeric, 'resumen_ne', (r->'resumen'->>'notas_entrega_saldo')::numeric,
      'saldo_sin', (public.estado_cuenta_cliente(${C}, p_movimientos => false)->'resumen'->>'saldo')::numeric,
      'sin_fila', exists (select 1 from jsonb_array_elements(public.estado_cuenta_cliente(${C}, p_movimientos => false)->'abiertos') d where d->>'tipo' = 'nota_entrega'))::text;`));
await caso('enlace público: con la marca muestra la N/E sin su id interno; sin la marca, no', (r) => r.con === 1 && r.sin === 0 && r.ids === 0,
  como({ decl: 't text;' }, `${EMITIR}
    t := (public.crear_enlace_estado_cuenta(${C})->>'token');
    perform public.estado_cuenta_enlace_ne(${C}, true);
    r := public.estado_cuenta_publico(t, p_movimientos => false, p_contar => false);
    v := json_build_object('con', (select count(*) from jsonb_array_elements(r->'abiertos') d where d->>'tipo' = 'nota_entrega'),
      'ids', (select count(*) from jsonb_array_elements(r->'abiertos') d where d ? 'nota_entrega_id' or d ? 'factura_id'))::text;
    perform public.estado_cuenta_enlace_ne(${C}, false);
    r := public.estado_cuenta_publico(t, p_movimientos => false, p_contar => false);
    v := (v::jsonb || jsonb_build_object('sin', (select count(*) from jsonb_array_elements(r->'abiertos') d where d->>'tipo' = 'nota_entrega')))::text;`));
await caso('correo con el check: la N/E va en el cuerpo y el enlace queda marcado', (r) => r.docs === 1 && r.marca === true,
  como({}, `${EMITIR}
    r := public.datos_correo_estado_cuenta(${C}, true, true);
    ${COMO_DUENO}
    v := json_build_object('docs', (select count(*) from jsonb_array_elements(r->'documentos') d where d->>'tipo' = 'nota_entrega'),
      'marca', (select incluir_ne from estado_cuenta_enlaces where id = (r->'enlace'->>'id')::uuid))::text;`));

// ── 8. Torre y reportes ──
await caso('torre: "por emitir" baja en uno al emitir la N/E del pedido', (r) => r.despues === r.antes - 1,
  como({ decl: 'a int;' }, `a := (public.alertas_notas_entrega()->>'por_emitir')::int; ${EMITIR}
    v := json_build_object('antes', a, 'despues', (public.alertas_notas_entrega()->>'por_emitir')::int)::text;`));
await caso('Ventas vs deuda al 30-abr: con N/E, Quirutec suma las dos de sep-2025 (USD 22.416) en sus ventas', (r) => Math.abs(r.con - r.sin - 22416) < 0.02,
  como({ empresa: qrt.id }, `
    v := json_build_object(
      'con', (select sum((m.value)::numeric) from jsonb_array_elements(public.reporte_ventas_vs_deuda('2026-04-30', 12, true)->'clientes') c, jsonb_each_text(c->'ventas') m),
      'sin', (select sum((m.value)::numeric) from jsonb_array_elements(public.reporte_ventas_vs_deuda('2026-04-30', 12, false)->'clientes') c, jsonb_each_text(c->'ventas') m))::text;`));
await caso('v_anticipos sin notas de entrega abonadas = la de antes (ningún cobro enlazado hoy)', (r) => r.enlazados === 0,
  dato(await uno(`select count(*)::int enlazados from v_anticipos where vinculado_ne > 0`)));

console.table(casos);
const fallas = casos.filter((c) => c.ok !== '✓').length;
console.log(fallas ? `✗ ${fallas} de ${casos.length} casos fallaron` : `✓ ${casos.length}/${casos.length} casos`);
process.exit(fallas ? 1 : 0);
