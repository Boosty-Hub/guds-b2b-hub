/**
 * Pruebas de la capa multiempresa en la base (Fase 17). Cada caso simula una petición de PostgREST
 * (rol, usuario y header x-empresa-id) dentro de un bloque que SIEMPRE termina en excepción: la base
 * deshace todo (datos y contadores) y el resultado viaja en el mensaje. No deja rastro.
 *
 *   node scripts/probar-multiempresa.mjs
 */
import { sql } from './lib/supabase-admin.mjs';

const [guds, qrt] = await sql(`select id, nombre_corto from empresas order by orden`);
const admin = (await sql(`select auth_id from usuarios where role = 'admin' and auth_id is not null order by created_at limit 1`))[0].auth_id;
const vendGuds = (await sql(`select u.auth_id from usuarios u join usuario_empresas ue on ue.usuario_id = u.id
  where u.role = 'vendedor' and u.auth_id is not null group by u.auth_id
  having count(*) = 1 and bool_and(ue.empresa_id = '${guds.id}') limit 1`))[0]?.auth_id;
const cliQrt = (await sql(`select id from clientes where empresa_id = '${qrt.id}' limit 1`))[0].id;
const cliGuds = (await sql(`select id from clientes where empresa_id = '${guds.id}' limit 1`))[0].id;
const prodGuds = (await sql(`select id from productos where empresa_id = '${guds.id}' limit 1`))[0].id;
const factQrt = (await sql(`select id from facturas where empresa_id = '${qrt.id}' limit 1`))[0].id;

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

// `cuerpo` debe devolver una fila con una columna de texto (usa row_to_json(...)::text).
// `previo` corre como postgres antes de cambiar de rol (p. ej. crear una función de prueba).
async function como({ rol = 'authenticated', uid = admin, empresa, previo = '' }, cuerpo) {
  const claims = JSON.stringify(uid ? { sub: uid, role: rol } : { role: rol });
  const headers = JSON.stringify(empresa ? { 'x-empresa-id': empresa } : {});
  const q = `do $bloque$
    declare v text;
    begin
      ${previo}
      perform set_config('request.jwt.claims', ${lit(claims)}, true);
      perform set_config('request.headers', ${lit(headers)}, true);
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
  casos.push({ ok: ok ? '✓' : '✗', caso: nombre, resultado: texto.slice(0, 100) });
}

// ── Lectura ──
await caso('Admin en GUDS ve solo órdenes de GUDS', (r) => r.n > 0 && r.otras === 0,
  como({ empresa: guds.id }, `select row_to_json(t)::text from (select count(*) n, count(*) filter (where empresa_id <> '${guds.id}') otras from ordenes) t`));
await caso('Admin en Quirutec ve solo órdenes de Quirutec', (r) => r.n > 0 && r.otras === 0,
  como({ empresa: qrt.id }, `select row_to_json(t)::text from (select count(*) n, count(*) filter (where empresa_id <> '${qrt.id}') otras from ordenes) t`));
await caso('Admin en "Ambas" ve las dos empresas', (r) => r.empresas === 2,
  como({ empresa: 'todas' }, `select row_to_json(t)::text from (select count(distinct empresa_id) empresas, count(*) n from ordenes) t`));
await caso('Clientes compartidos visibles desde Quirutec', (r) => r.compartidos > 0 && r.guds === 0,
  como({ empresa: qrt.id }, `select row_to_json(t)::text from (select count(*) filter (where empresa_id is null) compartidos, count(*) filter (where empresa_id = '${guds.id}') guds from clientes) t`));
if (vendGuds) {
  await caso('Vendedor solo-GUDS que pide Quirutec no ve Quirutec', (r) => r.quirutec === 0,
    como({ uid: vendGuds, empresa: qrt.id }, `select row_to_json(t)::text from (select count(*) filter (where empresa_id = '${qrt.id}') quirutec from clientes) t`));
}
await caso('Anónimo con header GUDS no ve productos de Quirutec', (r) => r.quirutec === 0 && r.total > 0,
  como({ rol: 'anon', uid: null, empresa: guds.id }, `select row_to_json(t)::text from (select count(*) total, count(*) filter (where empresa_id = '${qrt.id}') quirutec from productos) t`));

// ── Escritura ──
await caso('En "Ambas" no se puede crear', 'solo se puede consultar',
  como({ empresa: 'todas' }, `with x as (insert into cupones (codigo, tipo, valor) values ('PRUEBA-17', 'porcentaje', 5) returning id) select row_to_json(x)::text from x`));
await caso('En GUDS se crea y queda en GUDS', (r) => r.empresa_id === guds.id,
  como({ empresa: guds.id }, `with x as (insert into cupones (codigo, tipo, valor) values ('PRUEBA-17', 'porcentaje', 5) returning empresa_id) select row_to_json(x)::text from x`));
await caso('No se mezcla: orden de GUDS con cliente de Quirutec', 'mezclar empresas',
  como({ empresa: guds.id }, `with x as (insert into ordenes (cliente_id, subtotal, total, estado) values ('${cliQrt}', 0, 0, 'pendiente') returning id) select row_to_json(x)::text from x`));
await caso('Orden nueva en GUDS numerada GUDS-ORD-…', (r) => /^GUDS-ORD-\d{5}$/.test(r.numero),
  como({ empresa: guds.id }, `with x as (insert into ordenes (cliente_id, subtotal, total, estado) values ('${cliGuds}', 0, 0, 'pendiente') returning numero) select row_to_json(x)::text from x`));
await caso('Numeración de Quirutec QRT-ORD-…', (r) => /^QRT-ORD-\d{5}$/.test(r.numero),
  como({ rol: 'postgres', empresa: qrt.id }, `select row_to_json(t)::text from (select public.generar_numero_orden() numero) t`));
await caso('Ítems heredan la empresa de la orden', (r) => r.empresa_id === guds.id,
  como({ empresa: guds.id }, `with o as (insert into ordenes (cliente_id, subtotal, total, estado) values ('${cliGuds}', 0, 0, 'pendiente') returning id),
    i as (insert into orden_items (orden_id, producto_id, cantidad, precio_unitario, subtotal) select o.id, '${prodGuds}', 1, 1, 1 from o returning empresa_id)
    select row_to_json(i)::text from i`));
await caso('Guardia: función security definer no escribe en otra empresa', 'otra empresa',
  como({ empresa: guds.id, previo: `create function pg_temp.tocar_factura(p uuid) returns int language sql security definer as 'update public.facturas set notas = notas where id = p returning 1';` },
    `select row_to_json(t)::text from (select pg_temp.tocar_factura('${factQrt}') n) t`));
await caso('Guardia: en "Ambas" no se edita', 'Modo consulta',
  como({ empresa: 'todas' }, `with x as (update clientes set notas = notas where id = '${cliGuds}' returning id) select row_to_json(x)::text from x`));

// ── Espejo Odoo (Fase 3): lo que manda Odoo no se edita desde GUDS; lo propio de GUDS sí ──
const cliOdoo = (await sql(`select id from clientes where empresa_id = '${guds.id}' and odoo_id is not null limit 1`))[0].id;
const prodOdoo = (await sql(`select id from productos where empresa_id = '${guds.id}' and precio_origen = 'odoo' and disponible limit 1`))[0].id;
const prodSinPrecio = (await sql(`select id from productos where empresa_id = '${guds.id}' and precio_origen = 'guds' and vendible
  and tipo_odoo <> 'service' limit 1`))[0]?.id;
const pagoOdoo = (await sql(`select id from pagos where empresa_id = '${guds.id}' and odoo_id is not null limit 1`))[0].id;
const bancoOdoo = (await sql(`select id from bancos where empresa_id = '${guds.id}' and odoo_id is not null limit 1`))[0].id;
const E = { empresa: guds.id };
const upd = (tabla, set, id, ret = 'id') => `with x as (update ${tabla} set ${set} where id = '${id}' returning ${ret}) select row_to_json(x)::text from x`;

await caso('Espejo: no se edita el nombre de un cliente de Odoo', 'viene de Odoo', como(E, upd('clientes', `nombre_negocio = 'X'`, cliOdoo)));
await caso('Espejo: sí se edita la lista de precios (dato de GUDS)', (r) => r?.id === cliOdoo,
  como(E, upd('clientes', `lista_precios_id = null`, cliOdoo)));
await caso('Espejo: no se borra un producto de Odoo', 'se elimina o se anula en Odoo',
  como(E, `with x as (delete from productos where id = '${prodOdoo}' returning id) select row_to_json(x)::text from x`));
await caso('Espejo: no se cambia un precio que vino de Odoo', 'viene de Odoo', como(E, upd('productos', `precio_base = 1`, prodOdoo)));
await caso('Espejo: "desactivar" un producto de Odoo lo oculta de la tienda', (r) => r?.oculto_tienda === true && r?.activo === false,
  como(E, upd('productos', `activo = false`, prodOdoo, 'oculto_tienda, activo')));
if (prodSinPrecio) {
  await caso('Espejo: producto sin historial acepta precio de GUDS y entra al catálogo', (r) => r?.disponible === true && r?.activo === true,
    como(E, upd('productos', `precio_base = 9.99`, prodSinPrecio, 'disponible, activo')));
}
await caso('Espejo: el método de un cobro de Odoo se corrige (dato de GUDS)', (r) => r?.id === pagoOdoo,
  como(E, upd('pagos', `metodo = 'tarjeta'`, pagoOdoo)));
await caso('Espejo: no se cambia el monto de un cobro de Odoo', 'viene de Odoo', como(E, upd('pagos', `monto = 1`, pagoOdoo)));
await caso('Espejo: el número de cuenta del banco es de GUDS', (r) => r?.id === bancoOdoo,
  como(E, upd('bancos', `numero_cuenta = '0102-TEST'`, bancoOdoo)));
await caso('Espejo: el nombre del banco viene de Odoo', 'viene de Odoo', como(E, upd('bancos', `nombre = 'X'`, bancoOdoo)));

// ── Clientes sin duplicados por RIF ni nombre (Fase 3, decisión 3) ──
const ref = (await sql(`select nombre_negocio, rif from clientes where empresa_id = '${guds.id}' and rif ~ '^[JVGEP]' limit 1`))[0];
const rifVariante = ref.rif.replace(/[^A-Za-z0-9]/g, '').toLowerCase();          // "J-123-4" → "j1234"
const alta = (empresa, nombre, rif) => como({ empresa }, `with x as (insert into clientes (codigo, nombre_negocio, rif, tipo_negocio)
  values ('PRUEBA-DUP', ${lit(nombre)}, ${lit(rif)}, 'Empresa') returning nombre_negocio) select row_to_json(x)::text from x`);
await caso('Duplicados: mismo RIF con otro formato en la misma empresa', 'Ya existe un cliente', alta(guds.id, 'Cliente Prueba Único XYZ', rifVariante));
await caso('Duplicados: mismo nombre con otro formato ("C.A.", mayúsculas)', 'Ya existe un cliente',
  alta(guds.id, `${ref.nombre_negocio.toLowerCase().replace(/,?\s*c\.?\s*a\.?$/i, '')} C.A.`, 'J-00000000-0'));
await caso('Duplicados: cliente nuevo de verdad se crea', (r) => r?.nombre_negocio === 'Cliente Prueba Único XYZ',
  alta(guds.id, 'Cliente Prueba Único XYZ', 'J-99999999-1'));
await caso('Duplicados: el mismo RIF sí se permite en la otra empresa', (r) => !!r?.nombre_negocio,
  alta(qrt.id, 'Cliente Prueba Único XYZ', rifVariante));

// ── Compras y cuentas por pagar (Fase 5): espejo de solo lectura, separado por empresa ──
const facProvGuds = (await sql(`select id from facturas_proveedor where empresa_id = '${guds.id}' limit 1`))[0].id;
const provGuds = (await sql(`select proveedor_id id from facturas_proveedor where empresa_id = '${guds.id}' and proveedor_id is not null limit 1`))[0].id;
const cuenta = (tabla) => `select row_to_json(t)::text from (select count(*) n, count(*) filter (where empresa_id <> '${guds.id}') otras from ${tabla}) t`;
await caso('Compras: admin en GUDS ve solo facturas de proveedor de GUDS', (r) => r.n > 0 && r.otras === 0, como(E, cuenta('facturas_proveedor')));
await caso('Compras: nadie edita una factura de proveedor desde GUDS (no afecta filas)', (r, err) => r === null && !err,
  como(E, upd('facturas_proveedor', `saldo_usd = 0`, facProvGuds)));
await caso('Compras: nadie registra pagos a proveedores desde GUDS', 'row-level security',
  como(E, `with x as (insert into pagos_proveedor (numero, tipo, proveedor_id, monto, estado) values ('PRUEBA', 'pago', '${provGuds}', 1, 'verificado') returning id)
    select row_to_json(x)::text from x`));
if (vendGuds) {
  await caso('Compras: un vendedor (sin módulo compras) no ve cuentas por pagar', (r) => r.n === 0,
    como({ uid: vendGuds, empresa: guds.id }, cuenta('facturas_proveedor')));
}
await caso('Compras: anónimo no ve cuentas por pagar', (r, err) => (r && r.n === 0) || /permission denied/.test(err || ''),
  como({ rol: 'anon', uid: null, empresa: guds.id }, cuenta('facturas_proveedor')));

// ── Inventario (Fase 6): espejo de solo lectura + cierre de políticas "todo permitido" ──
const cliUser = (await sql(`select u.auth_id from usuarios u where u.role = 'cliente' and u.auth_id is not null limit 1`))[0]?.auth_id;
const almConsig = (await sql(`select id from almacenes where empresa_id = '${guds.id}' and tipo = 'consignacion' limit 1`))[0].id;
const loteGuds = (await sql(`select id from lotes where empresa_id = '${guds.id}' limit 1`))[0].id;
const transfGuds = (await sql(`select id from transferencias where empresa_id = '${guds.id}' limit 1`))[0].id;
const prodEmp = (await sql(`select id from productos where empresa_id = '${guds.id}' limit 1`))[0].id;
await caso('Inventario: nadie edita un lote de Odoo desde GUDS (no afecta filas)', (r, err) => r === null && !err, como(E, upd('lotes', `vencimiento = current_date`, loteGuds)));
await caso('Inventario: nadie edita una transferencia de Odoo desde GUDS', (r, err) => r === null && !err, como(E, upd('transferencias', `estado = 'hecha'`, transfGuds)));
await caso('Inventario: admin asigna a mano el cliente de una consignación (queda "manual")', (r) => r?.vinculo_cliente === 'manual',
  como(E, upd('almacenes', `cliente_id = '${cliGuds}'`, almConsig, 'vinculo_cliente')));
await caso('Inventario: no se liga una consignación de GUDS a un cliente de Quirutec', 'mezclar empresas',
  como(E, upd('almacenes', `cliente_id = '${cliQrt}'`, almConsig)));
await caso('Seguridad: anónimo no crea empaques de producto', (r, err) => /row-level security|permission denied/.test(err || ''),
  como({ rol: 'anon', uid: null, empresa: guds.id }, `with x as (insert into producto_empaques (producto_id, tipo_empaque_id, precio_empaque) select '${prodEmp}', id, 1 from tipos_empaque limit 1 returning id) select row_to_json(x)::text from x`));
// ── Tesorería (Fase 7) ──
const lineaExt = (await sql(`select id from extracto_odoo_lineas where empresa_id = '${guds.id}' limit 1`))[0].id;
const bancoOdooG = (await sql(`select id from bancos where empresa_id = '${guds.id}' and odoo_id is not null and saldo_odoo is not null limit 1`))[0].id;
await caso('Tesorería: nadie edita una línea de extracto de Odoo desde GUDS', (r, err) => r === null && !err, como(E, upd('extracto_odoo_lineas', `conciliada = true`, lineaExt)));
await caso('Tesorería: el saldo de Odoo de un banco no se edita en GUDS', 'viene de Odoo', como(E, upd('bancos', `saldo_odoo = 1`, bancoOdooG)));
await caso('Tesorería: admin en GUDS ve solo extractos de GUDS', (r) => r.n > 0 && r.otras === 0, como(E, cuenta('extracto_odoo_lineas')));

// La conciliación propia de GUDS (extracto cargado en GUDS) casa entradas y también salidas (pagos a proveedores)
const movUnico = (origen) => `select m.id, m.banco_id, m.fecha::date fecha, m.monto, m.tipo from movimientos_bancarios m
  where m.empresa_id = '${guds.id}' and m.origen = '${origen}' and m.monto > 0
    and not exists (select 1 from movimientos_bancarios o where o.banco_id = m.banco_id and o.id <> m.id and o.tipo = m.tipo
                    and abs(o.monto - m.monto) <= 0.01 and abs(o.fecha::date - m.fecha::date) <= 3)
  order by m.fecha desc limit 1`;
const salida = (await sql(movUnico('pago_proveedor')))[0];
const entrada = (await sql(`select * from (${movUnico('cobro')}) x where x.banco_id = '${salida.banco_id}'`))[0];
if (salida && entrada) {
  const previo = `insert into extractos_bancarios (id, banco_id, nombre_archivo, moneda, empresa_id) values ('00000000-0000-0000-0000-00000000e001', '${salida.banco_id}', 'prueba.csv', 'BS', '${guds.id}');
    insert into extracto_lineas (extracto_id, fecha, monto, referencia, estado, empresa_id) values
      ('00000000-0000-0000-0000-00000000e001', '${salida.fecha}', -${salida.monto}, 'PRUEBA-SALIDA', 'pendiente', '${guds.id}'),
      ('00000000-0000-0000-0000-00000000e001', '${entrada.fecha}', ${entrada.monto}, 'PRUEBA-ENTRADA', 'pendiente', '${guds.id}');`;
  await caso('Conciliación GUDS: casa automáticamente una entrada (cobro) y una salida (pago a proveedor)', (r) => r?.conciliadas === 2,
    como({ empresa: guds.id, previo }, `select public.conciliar_extracto_automatico('00000000-0000-0000-0000-00000000e001')::text`));
}

const bancoGuds = (await sql(`select id from bancos where empresa_id = '${guds.id}' limit 1`))[0].id;
if (vendGuds) {
  await caso('Tesorería: un vendedor (sin módulo bancos) no ve extractos', (r) => r.n === 0, como({ uid: vendGuds, empresa: guds.id }, cuenta('extracto_odoo_lineas')));
  await caso('Seguridad: un vendedor no edita almacenes ni su cliente', (r, err) => r === null || /row-level|permission/.test(err || ''),
    como({ uid: vendGuds, empresa: guds.id }, upd('almacenes', `cliente_id = null`, almConsig)));
  await caso('Seguridad: un vendedor no registra movimientos bancarios', 'row-level security',
    como({ uid: vendGuds, empresa: guds.id }, `with x as (insert into movimientos_bancarios (banco_id, tipo, monto) values ('${bancoGuds}', 'entrada', 1) returning id) select row_to_json(x)::text from x`));
  await caso('Seguridad: un vendedor no cambia existencias', (r, err) => r === null || /row-level|permission/.test(err || ''),
    como({ uid: vendGuds, empresa: guds.id }, `with x as (update inventario_almacen set cantidad = 0 where empresa_id = '${guds.id}' returning id) select row_to_json(x)::text from (select * from x limit 1) x`));
}
if (cliUser) {
  await caso('Seguridad: un cliente del portal no edita almacenes', (r, err) => r === null || /row-level|permission/.test(err || ''),
    como({ uid: cliUser, empresa: guds.id }, upd('almacenes', `cliente_id = null`, almConsig)));
  await caso('Seguridad: un cliente del portal no registra movimientos bancarios', 'row-level security',
    como({ uid: cliUser, empresa: guds.id }, `with x as (insert into movimientos_bancarios (banco_id, tipo, monto) values ('${bancoGuds}', 'entrada', 1) returning id) select row_to_json(x)::text from x`));
}

// ── Fase 8: crédito, stock comprometido, clientes en ambas empresas y acceso de contactos ──
const cliSinLimite = (await sql(`select id from clientes where empresa_id = '${guds.id}' and coalesce(limite_credito, 0) = 0 limit 1`))[0].id;
const cred = (sql1) => `select row_to_json(t)::text from (select 'ok' r from (select public.validar_credito('${cliSinLimite}', 100)) x) t`;
await caso('Crédito: en modo abierto se compra a crédito aunque el límite sea 0', (r, err) => r?.r === 'ok' && !err, como({ ...E, rol: 'postgres' }, cred()));
await caso('Crédito: en modo límite, sin límite aprobado no se compra a crédito', 'no tiene crédito aprobado',
  como({ rol: 'postgres', empresa: guds.id, previo: `update configuracion set valor = 'limite' where clave = 'credito_modo';` }, cred()));
const agotado = (await sql(`select id from productos where empresa_id = '${guds.id}' and controla_stock and stock_disponible = 0 and comprometido_odoo > 0 limit 1`))[0]?.id;
const conStock = (await sql(`select id, comprometido_guds from productos where empresa_id = '${guds.id}' and controla_stock and stock_disponible > 100 and activo limit 1`))[0];
if (agotado) {
  await caso('Stock: no se pide sobre lo comprometido (disponible 0)', 'Stock insuficiente',
    como({ ...E, rol: 'postgres' }, `select row_to_json(t)::text from (select public.validar_stock_pedido('[{"producto_id":"${agotado}","cantidad":1}]'::jsonb)) t`));
}
const claimsAdmin = JSON.stringify({ sub: admin, role: 'authenticated' }).replace(/'/g, "''");
const hdr = (emp) => JSON.stringify({ 'x-empresa-id': emp }).replace(/'/g, "''");
await caso('Stock: un pedido de GUDS compromete sus unidades al crearse', (r) => Number(r?.comprometido_guds) === Number(conStock.comprometido_guds) + 2,
  como({ empresa: guds.id, previo: `perform set_config('request.jwt.claims', '${claimsAdmin}', true); perform set_config('request.headers', '${hdr(guds.id)}', true);
    perform public.crear_orden_admin('${cliGuds}', 'transferencia', 'prueba', '[{"producto_id":"${conStock.id}","cantidad":2}]'::jsonb);` },
    `select row_to_json(t)::text from (select comprometido_guds from productos where id = '${conStock.id}') t`));
const gemelo = (await sql(`select g.id g_id, q.id q_id from clientes g join clientes q on normalizar_rif(q.rif) = normalizar_rif(g.rif)
  where g.empresa_id = '${guds.id}' and q.empresa_id = '${qrt.id}' and g.rif is not null
    and exists (select 1 from facturas f where f.cliente_id = q.id) limit 1`))[0];
const qaCliente = (await sql(`select id from auth.users where email = 'qa.cliente@guds.test'`))[0]?.id;
if (gemelo && qaCliente) {
  const insertarQa = `insert into usuarios (auth_id, email, nombre, role, cliente_id, activo) values ('${qaCliente}', 'qa.cliente@guds.test', 'QA', 'cliente', '${gemelo.g_id}', true);`;
  const empresasQa = `select row_to_json(t)::text from (select count(*) n, bool_or(ue.empresa_id = '${qrt.id}') qrt from usuario_empresas ue join usuarios u on u.id = ue.usuario_id where u.auth_id = '${qaCliente}') t`;
  // 19s: sin habilitar, el portal solo ofrece la empresa de su ficha; habilitada desde el admin, ofrece ambas
  await caso('Portal: un cliente con ficha en ambas empresas solo ve la suya hasta que se habilite la otra', (r) => r?.n === 1 && !r?.qrt,
    como({ rol: 'postgres', empresa: guds.id, previo: insertarQa }, empresasQa));
  await caso('Portal: el admin habilita Quirutec y el usuario del cliente la recibe', (r) => r?.n === 2 && r?.qrt,
    como({ empresa: guds.id, previo: `${insertarQa} perform set_config('request.jwt.claims', '${claimsAdmin}', true); perform set_config('request.headers', '${hdr(guds.id)}', true);
      perform public.habilitar_empresa_portal('${gemelo.g_id}', '${qrt.id}', true);` }, empresasQa));
  if (vendGuds) {
    await caso('Portal: un vendedor no habilita empresas del portal', 'No tienes permiso',
      como({ uid: vendGuds, empresa: guds.id }, `select public.habilitar_empresa_portal('${gemelo.g_id}', '${qrt.id}', true)::text`));
  }
  const previoGemelo = `update clientes set portal_habilitado = true where id = '${gemelo.q_id}'; ${insertarQa}`;
  await caso('Cliente en ambas empresas: en Quirutec el portal usa su ficha de Quirutec', (r) => r?.cliente === gemelo.q_id && r?.facturas > 0,
    como({ uid: qaCliente, empresa: qrt.id, previo: previoGemelo },
      `select row_to_json(t)::text from (select public.mi_cliente_id() cliente, (select count(*) from facturas) facturas, (select count(*) from facturas where cliente_id <> '${gemelo.q_id}') ajenas) t`));
  await caso('Cliente en ambas empresas: no ve documentos de otros clientes', (r) => r?.ajenas === 0,
    como({ uid: qaCliente, empresa: qrt.id, previo: previoGemelo },
      `select row_to_json(t)::text from (select (select count(*) from facturas where cliente_id <> '${gemelo.q_id}') ajenas) t`));
}
await caso('Contactos: el admin da acceso al portal con contraseña temporal (debe cambiarla)', (r) => r?.email === 'prueba.contacto@guds.test' && r?.password_temporal?.length >= 8,
  como({ empresa: guds.id, previo: `insert into cliente_contactos (id, cliente_id, nombre, email) values ('00000000-0000-0000-0000-00000000c001', '${cliGuds}', 'Contacto Prueba', 'prueba.contacto@guds.test');` },
    `select row_to_json(t)::text from public.crear_acceso_contacto('00000000-0000-0000-0000-00000000c001') t`));
const vendAuthId = vendGuds && (await sql(`select id from usuarios where auth_id = '${vendGuds}'`))[0]?.id;
const cliAjeno = vendAuthId && (await sql(`select id from clientes where empresa_id = '${guds.id}' and vendedor_asignado_id is distinct from '${vendAuthId}' limit 1`))[0]?.id;
if (vendGuds && cliAjeno) {
  await caso('Contactos: un vendedor no da accesos al portal de clientes que no son suyos', 'No tienes permiso',
    como({ uid: vendGuds, empresa: guds.id, previo: `insert into cliente_contactos (id, cliente_id, nombre, email) values ('00000000-0000-0000-0000-00000000c002', '${cliAjeno}', 'Contacto Prueba 2', 'prueba2.contacto@guds.test');` },
      `select row_to_json(t)::text from public.crear_acceso_contacto('00000000-0000-0000-0000-00000000c002') t`));
}

// Registro de clientes por empresa: se aprueba en la empresa elegida
const previoRegistro = `insert into registros_clientes (id, nombre_negocio, nombre_contacto, email, telefono, direccion, ciudad, rif, tipo_negocio, estado, empresa_id)
  values ('00000000-0000-0000-0000-00000000a001', 'Farmacia Prueba Registro XYZ', 'Ana', 'registro.prueba@guds.test', '0414', 'Calle 1', 'Caracas', 'J-99999999-7', 'Farmacia', 'pendiente', '${qrt.id}');`;
await caso('Registro: se aprueba en la empresa que eligió el cliente (y debe cambiar la clave)', (r) => r?.empresa === qrt.id && r?.debe === true,
  como({ empresa: qrt.id, previo: previoRegistro + ` perform set_config('request.jwt.claims', '${claimsAdmin}', true); perform set_config('request.headers', '${hdr(qrt.id)}', true);
      perform public.aprobar_registro_cliente('00000000-0000-0000-0000-00000000a001');` },
    `select row_to_json(t)::text from (select c.empresa_id empresa, (select u.debe_cambiar_clave from usuarios u where u.cliente_id = c.id limit 1) debe
       from clientes c where c.registro_origen_id = '00000000-0000-0000-0000-00000000a001') t`));
await caso('Registro: desde la otra empresa no se aprueba (pide cambiar de empresa)', 'otra empresa',
  como({ empresa: guds.id, previo: previoRegistro }, `select row_to_json(t)::text from public.aprobar_registro_cliente('00000000-0000-0000-0000-00000000a001') t`));

// ── Buscador global (rediseño, Fase B) ──
const busca = (q, emp) => como({ empresa: emp }, `select row_to_json(t)::text from (select count(*) n, count(distinct tipo) tipos,
  string_agg(distinct tipo, ',') lista from public.buscar_global('${q}', 8)) t`);
const ordenG = (await sql(`select numero from ordenes where empresa_id = '${guds.id}' and odoo_id is not null order by created_at desc limit 1`))[0].numero;
await caso('Buscador: encuentra una orden por su número', (r) => r?.n > 0 && /orden/.test(r.lista), busca(ordenG, guds.id));
await caso('Buscador: "drovencentro" encuentra cliente, almacén y documentos', (r) => /cliente/.test(r?.lista || '') && /almacen/.test(r?.lista || ''), busca('drovencentro', guds.id));
const cliQNombre = (await sql(`select nombre_negocio from clientes c where empresa_id = '${qrt.id}' and not exists (select 1 from clientes g where g.empresa_id = '${guds.id}' and normalizar_rif(g.rif) = normalizar_rif(c.rif)) and rif is not null limit 1`))[0].nombre_negocio;
await caso('Buscador: respeta la empresa activa (un cliente solo de Quirutec no aparece en GUDS)', (r) => !/cliente/.test(r?.lista || ''),
  busca(cliQNombre.replace(/'/g, "''").slice(0, 18), guds.id));
if (vendGuds) {
  await caso('Buscador: un vendedor no ve proveedores ni cuentas por pagar', (r) => !/proveedor|factura_proveedor/.test(r?.lista || ''),
    como({ uid: vendGuds, empresa: guds.id }, `select row_to_json(t)::text from (select string_agg(distinct tipo, ',') lista from public.buscar_global('c.a', 25)) t`));
  // Portal del vendedor (18s): enlaces a sus páginas, sin compras/bancos, y solo sus clientes
  await caso('Buscador vendedor: enlaces del portal del vendedor y sin tipos de administración',
    (r) => r?.n > 0 && r.admin === 0 && !/proveedor|banco|transferencia|almacen|vendedor/.test(r.lista || ''),
    como({ uid: vendGuds, empresa: guds.id }, `select row_to_json(t)::text from (select count(*) n, count(*) filter (where enlace not like '/vendedor/%') admin,
      string_agg(distinct tipo, ',') lista from public.buscar_global('c.a', 25, 'vendedor')) t`));
  await caso('Buscador vendedor: solo encuentra clientes asignados a él',
    (r) => r?.ajenos === 0,
    como({ uid: vendGuds, empresa: guds.id }, `select row_to_json(t)::text from (select count(*) filter (where b.tipo = 'cliente' and not exists (
      select 1 from clientes c join usuarios u on u.id = c.vendedor_asignado_id where c.id = b.id and u.auth_id = '${vendGuds}')) ajenos
      from public.buscar_global('a', 25, 'vendedor') b) t`));
}
await caso('Buscador admin: con contexto por defecto conserva los enlaces de administración', (r) => r?.n > 0 && r.admin === r.n,
  como({ empresa: guds.id }, `select row_to_json(t)::text from (select count(*) n, count(*) filter (where enlace like '/admin/%') admin from public.buscar_global('farmatodo', 8)) t`));

// ── Reportes (18u): permiso "reportes", empresa activa, sin saldos iniciales ni ND ──
{
  const suma = async (emp) => Number((await sql(`with rev as (select fa.id f, nc.id n from facturas nc join facturas fa on fa.id = nc.factura_origen_id
      where nc.tipo = 'nota_credito' and fa.tipo = 'factura' and nc.estado = 'posted' and fa.estado = 'posted'
        and fa.moneda is not distinct from nc.moneda and abs(abs(nc.total) - abs(fa.total)) < 0.01)
    select coalesce(round(sum(case when total<>0 then subtotal*total_usd/total end),2),0) n from facturas
    where estado='posted' and tipo in ('factura','nota_credito') and not es_saldo_inicial and not coalesce(es_nota_debito,false)
      and fecha_emision between '2026-08-01' and '2026-08-31' and empresa_id = '${emp}'
      and id not in (select f from rev union select n from rev)`))[0].n);
  const [sg, sq] = [await suma(guds.id), await suma(qrt.id)];
  const rep = (emp) => como({ empresa: emp }, `select row_to_json(t)::text from (select round(sum(neto_usd),2) neto, count(*) filas
    from public.reporte_ventas('2026-08-01','2026-08-31','empresa')) t`);
  await caso('Reportes: la venta neta por empresa coincide con los documentos (GUDS)', (r) => Number(r?.neto) === sg && r.filas === 1, rep(guds.id));
  await caso('Reportes: con la empresa activa Quirutec solo suma Quirutec', (r) => Number(r?.neto) === sq && r.filas === 1, rep(qrt.id));
  await caso('Reportes: en "Ambas" consolida las dos empresas', (r) => Math.abs(Number(r?.neto) - (sg + sq)) < 0.02 && r.filas === 2, rep('todas'));
  if (vendGuds) {
    await caso('Reportes: un vendedor sin el permiso "reportes" no puede consultarlos', 'permiso para ver reportes',
      como({ uid: vendGuds, empresa: guds.id }, `select count(*)::text from public.reporte_ventas('2026-08-01','2026-08-31','mes')`));
  }
  await caso('Reportes: las funciones internas no se pueden llamar directo', 'permission denied',
    como({ empresa: guds.id }, `select count(*)::text from public.documentos_venta('2026-08-01','2026-08-31')`));
}

// ── Sincronización con Odoo (19a–c) ──
await caso('Sync Odoo: el admin ve el estado de la sincronización', (r) => r?.ultima_ok && r.ultima_estado,
  como({ empresa: guds.id }, `select row_to_json(t)::text from public.estado_sync_odoo() t`));
if (vendGuds) {
  await caso('Sync Odoo: un vendedor no puede disparar la sincronización', 'Solo administración',
    como({ uid: vendGuds, empresa: guds.id }, `select public.solicitar_sync_odoo()::text`));
}
await caso('Sync Odoo: disparar_sync_odoo no se puede llamar desde la API', 'permission denied',
  como({ empresa: guds.id }, `select public.disparar_sync_odoo()::text`));
await caso('Reportes: anónimo no puede ejecutarlos', 'permission denied',
  como({ rol: 'anon', uid: null, empresa: guds.id }, `select count(*)::text from public.reporte_ventas('2026-08-01','2026-08-31','mes')`));
await caso('Sync Odoo: anónimo no ve el estado', 'permission denied',
  como({ rol: 'anon', uid: null, empresa: guds.id }, `select count(*)::text from public.estado_sync_odoo()`));

// ── Aprobación de pedidos (19g): cliente/vendedor → por aprobar; admin aprueba (→ Odoo) o rechaza con motivo ──
{
  const prod = (await sql(`select id, comprometido_guds from productos where empresa_id = '${guds.id}' and controla_stock and stock_disponible > 100 and activo limit 1`))[0];
  const vend = vendGuds ? (await sql(`select u.id, c.id cliente from usuarios u join clientes c on c.vendedor_asignado_id = u.id
    where u.auth_id = '${vendGuds}' and c.activo and c.empresa_id = '${guds.id}' limit 1`))[0] : null;
  const claims = (uid) => JSON.stringify({ sub: uid, role: 'authenticated' }).replace(/'/g, "''");
  const hdrG = JSON.stringify({ 'x-empresa-id': guds.id }).replace(/'/g, "''");
  const comoUsuario = (uid) => `perform set_config('request.jwt.claims', '${claims(uid)}', true); perform set_config('request.headers', '${hdrG}', true);`;
  const items = `'[{"producto_id":"${prod.id}","cantidad":3}]'::jsonb`;
  await caso('Aprobación: un pedido creado por el admin nace aprobado (sale a Odoo)', (r) => r?.aprobacion === 'aprobada' && r?.envio > 0,
    como({ empresa: guds.id, previo: `${comoUsuario(admin)} perform public.crear_orden_admin('${cliGuds}', 'transferencia', 'prueba-aprob', ${items});` },
      `select row_to_json(t)::text from (select aprobacion, (select count(*) from net.http_request_queue where url like '%sync-odoo?enviar=%') envio
        from ordenes where notas = 'prueba-aprob' order by created_at desc limit 1) t`));
  if (vend) {
    const previoVend = `${comoUsuario(vendGuds)} perform public.crear_orden_vendedor('${vend.cliente}', 'transferencia', 'prueba-aprob-v', ${items});`;
    const idPend = `(select id from ordenes where notas = 'prueba-aprob-v' order by created_at desc limit 1)`;
    await caso('Aprobación: el pedido del vendedor queda por aprobar y compromete stock', (r) => r?.aprobacion === 'pendiente' && Number(r?.comp) === Number(prod.comprometido_guds) + 3,
      como({ empresa: guds.id, previo: previoVend },
        `select row_to_json(t)::text from (select aprobacion, (select comprometido_guds from productos where id = '${prod.id}') comp from ordenes where id = ${idPend}) t`));
    await caso('Aprobación: un vendedor no puede aprobar pedidos', 'No tienes permiso para aprobar',
      como({ uid: vendGuds, empresa: guds.id, previo: previoVend }, `select public.aprobar_pedido(${idPend})::text`));
    await caso('Aprobación: el admin aprueba y se dispara el envío a Odoo', (r) => r?.aprobacion === 'aprobada' && r?.envio > 0 && r?.por,
      como({ empresa: guds.id, previo: `${previoVend} ${comoUsuario(admin)} perform public.aprobar_pedido(${idPend});` },
        `select row_to_json(t)::text from (select o.aprobacion, o.aprobado_por por,
          (select count(*) from net.http_request_queue where url like '%enviar=' || o.id::text) envio from ordenes o where o.id = ${idPend}) t`));
    await caso('Aprobación: rechazar exige un motivo', 'Indica el motivo',
      como({ empresa: guds.id, previo: previoVend }, `select public.rechazar_pedido(${idPend}, '  ')::text`));
    await caso('Aprobación: rechazar cancela el pedido y libera el stock', (r) => r?.aprobacion === 'rechazada' && r?.estado === 'cancelado' && Number(r?.comp) === Number(prod.comprometido_guds) && r?.motivo === 'Sin disponibilidad',
      como({ empresa: guds.id, previo: `${previoVend} ${comoUsuario(admin)} perform public.rechazar_pedido(${idPend}, 'Sin disponibilidad');` },
        `select row_to_json(t)::text from (select aprobacion, estado::text estado, rechazo_motivo motivo, (select comprometido_guds from productos where id = '${prod.id}') comp from ordenes where id = ${idPend}) t`));

    // ── Pedidos pendientes editables y envío del vendedor (19p) ──
    await caso('Vendedor: su pedido no lleva envío automático', (r) => Number(r?.envio) === 0,
      como({ empresa: guds.id, previo: previoVend }, `select row_to_json(t)::text from (select envio from ordenes where id = ${idPend}) t`));
    const items5 = `'[{"producto_id":"${prod.id}","cantidad":5}]'::jsonb`;
    await caso('Editar pendiente: el vendedor cambia la cantidad; se recalculan total y stock comprometido', (r) =>
      Number(r?.comp) === Number(prod.comprometido_guds) + 5 && r?.ediciones === 1 && Number(r?.subtotal) > 0 && Number(r?.envio) === 12.5,
      como({ empresa: guds.id, previo: `${previoVend} perform public.editar_pedido_pendiente(${idPend}, ${items5}, null, 12.5);` },
        `select row_to_json(t)::text from (select subtotal, envio, ediciones, (select comprometido_guds from productos where id = '${prod.id}') comp from ordenes where id = ${idPend}) t`));
    await caso('Editar pendiente: un pedido aprobado ya no se edita', 'Solo se editan pedidos pendientes',
      como({ uid: vendGuds, empresa: guds.id, previo: `${previoVend} ${comoUsuario(admin)} perform public.aprobar_pedido(${idPend});` },
        `select row_to_json(t)::text from public.editar_pedido_pendiente(${idPend}, ${items5}) t`));
    const otroVend = (await sql(`select u.auth_id from usuarios u where u.role = 'vendedor' and u.activo and u.auth_id is not null and u.auth_id <> '${vendGuds}'
      and not exists (select 1 from clientes c where c.vendedor_asignado_id = u.id and c.id = '${vend.cliente}') limit 1`))[0]?.auth_id;
    if (otroVend) {
      await caso('Editar pendiente: otro vendedor no puede editar el pedido', 'No puedes editar este pedido',
        // El id se toma antes de cambiar de rol: el otro vendedor no ve el pedido (RLS), pero se prueba la validación de la función
        como({ uid: otroVend, empresa: guds.id, previo: `${previoVend} perform set_config('guds.prueba_orden', ${idPend}::text, true);` },
          `select row_to_json(t)::text from public.editar_pedido_pendiente(current_setting('guds.prueba_orden')::uuid, ${items5}) t`));
    }

    // ── Cupón, pago del pedido editado, vendedor y cuentas por empresa (19x) ──
    const fijarId = `perform set_config('guds.prueba_orden', ${idPend}::text, true);`;
    const cuponPct = `insert into cupones (id, codigo, tipo, valor, empresa_id) values ('00000000-0000-0000-0000-0000000c0010', 'PRUEBA-PCT', 'porcentaje', 10, '${guds.id}');
      update ordenes set cupon_id = '00000000-0000-0000-0000-0000000c0010', descuento = 1 where id = current_setting('guds.prueba_orden')::uuid;`;
    await caso('Editar pendiente: un cupón de porcentaje se recalcula sobre el subtotal nuevo', (r) => Math.abs(Number(r?.descuento) - Math.round(Number(r?.subtotal) * 10) / 100) < 0.011,
      como({ uid: vendGuds, empresa: guds.id, previo: `${previoVend} ${fijarId} ${cuponPct} ${comoUsuario(vendGuds)} perform public.editar_pedido_pendiente(current_setting('guds.prueba_orden')::uuid, ${items5});` },
        `select row_to_json(t)::text from (select subtotal, descuento from ordenes where id = current_setting('guds.prueba_orden')::uuid) t`));
    await caso('Cupones: solo porcentaje (hasta 100) o monto exacto', 'cupones_tipo_valor',
      como({ rol: 'postgres', empresa: guds.id }, `with x as (insert into cupones (codigo, tipo, valor, empresa_id) values ('PRUEBA-MAL', 'porcentaje', 150, '${guds.id}') returning 1) select count(*)::text from x`));
    const pagoPrevio = (monto) => `insert into pagos (cliente_id, orden_id, monto, monto_moneda, moneda, metodo, estado, empresa_id) values ('${vend.cliente}', current_setting('guds.prueba_orden')::uuid, ${monto}, ${monto}, 'USD', 'transferencia', 'pendiente', '${guds.id}');`;
    await caso('Editar pendiente: si ya pagó más que el total nuevo, queda a favor', (r) => Number(r?.a_favor) > 0 && Number(r?.falta) === 0,
      como({ uid: vendGuds, empresa: guds.id, previo: `${previoVend} ${fijarId} ${pagoPrevio(1000)}` },
        `select row_to_json(t)::text from public.editar_pedido_pendiente(current_setting('guds.prueba_orden')::uuid, ${items5}) t`));
    await caso('Editar pendiente: si pagó menos que el total nuevo, indica cuánto falta', (r) => Number(r?.falta) > 0 && Number(r?.a_favor) === 0 && Number(r?.pagado) === 1,
      como({ uid: vendGuds, empresa: guds.id, previo: `${previoVend} ${fijarId} ${pagoPrevio(1)}` },
        `select row_to_json(t)::text from public.editar_pedido_pendiente(current_setting('guds.prueba_orden')::uuid, ${items5}) t`));
    await caso('Pago del pedido: el vendedor ve lo pagado y lo que falta', (r) => Number(r?.por_verificar) === 1 && Number(r?.falta) > 0,
      como({ uid: vendGuds, empresa: guds.id, previo: `${previoVend} ${fijarId} ${pagoPrevio(1)}` },
        `select row_to_json(t)::text from public.resumen_pago_orden(current_setting('guds.prueba_orden')::uuid) t`));
    await caso('Vendedor del pedido: un vendedor no puede asignar vendedores', 'No tienes permiso para asignar',
      como({ uid: vendGuds, empresa: guds.id, previo: `${previoVend} ${fijarId}` },
        `select public.asignar_vendedor_orden(current_setting('guds.prueba_orden')::uuid, (select id from usuarios where auth_id = '${vendGuds}'))::text`));
    await caso('Vendedor del pedido: el admin lo asigna', (r) => r?.ok === true,
      como({ empresa: guds.id, previo: `${previoVend} ${fijarId} ${comoUsuario(admin)}
        perform public.asignar_vendedor_orden(current_setting('guds.prueba_orden')::uuid, (select id from usuarios where auth_id = '${vendGuds}'));` },
        `select row_to_json(t)::text from (select vendedor_id = (select id from usuarios where auth_id = '${vendGuds}') ok from ordenes where id = current_setting('guds.prueba_orden')::uuid) t`));
    const bancoQrt = (await sql(`select id from bancos where empresa_id = '${qrt.id}' and visible_portal limit 1`))[0]?.id;
    if (bancoQrt) {
      await caso('Pagos: no se declara a una cuenta de otra empresa', 'otra empresa',
        como({ uid: vendGuds, empresa: guds.id }, `select public.registrar_pago('${vend.cliente}', null, '${bancoQrt}', 'transferencia', 10, 'USD', null, 'REF-PRUEBA', null)::text`));
    }
  }
}

// ── Facturas: no se eliminan, se anulan, con historial (19x) ──
{
  const fac = (await sql(`select id from facturas where empresa_id = '${guds.id}' and odoo_id is not null and estado = 'posted' limit 1`))[0]?.id;
  if (fac) {
    await caso('Facturas: el admin no puede eliminar una factura por la API', 'permission denied',
      como({ empresa: guds.id }, `with x as (delete from facturas where id = '${fac}' returning 1) select count(*)::text from x`));
    await caso('Facturas: nadie las elimina, ni la sincronización', 'no se eliminan',
      como({ rol: 'postgres', empresa: guds.id }, `with x as (delete from facturas where id = '${fac}' returning 1) select count(*)::text from x`));
    await caso('Facturas: cada cambio queda en el historial (también los que llegan de Odoo)', (r) => r?.n === 1 && r?.origen === 'odoo',
      como({ rol: 'postgres', empresa: guds.id, previo: `update facturas set nro_control = coalesce(nro_control, '') || '-prueba' where id = '${fac}';` },
        `select row_to_json(t)::text from (select count(*) n, max(origen) origen from facturas_historial where factura_id = '${fac}' and accion = 'modificada' and cambios ? 'nro_control') t`));
    await caso('Facturas: una factura de Odoo se anula en Odoo, no en GUDS', 'viene de Odoo',
      como({ empresa: guds.id }, `select public.anular_factura('${fac}', 'Prueba de anulación')::text`));
  }
  const conLineas = (await sql(`select fi.id from factura_items fi join facturas f on f.id = fi.factura_id where f.empresa_id = '${guds.id}' limit 1`))[0]?.id;
  if (conLineas) {
    await caso('Facturas: sus líneas no se eliminan por la API', 'permission denied',
      como({ empresa: guds.id }, `with x as (delete from factura_items where id = '${conLineas}' returning 1) select count(*)::text from x`));
  }
}

// ── Seguridad de vendedor, repartidor y almacenamiento (19i/19j) ──
{
  const delivery = (await sql(`select u.auth_id from usuarios u where u.role = 'delivery' and u.activo and u.auth_id is not null
    and not exists (select 1 from entregas e where e.repartidor_id = u.id) limit 1`))[0]?.auth_id;
  if (vendGuds) {
    await caso('Vendedor: solo ve órdenes y clientes de su cartera (no toda la empresa)', (r) => r?.ordenes_ajenas === 0 && r?.clientes_ajenos === 0,
      como({ uid: vendGuds, empresa: guds.id }, `select row_to_json(t)::text from (select
        (select count(*) from ordenes o where not exists (select 1 from clientes c join usuarios u on u.id = c.vendedor_asignado_id
           where c.id = o.cliente_id and u.auth_id = '${vendGuds}') and o.vendedor_id is distinct from (select id from usuarios where auth_id = '${vendGuds}')) ordenes_ajenas,
        (select count(*) from clientes c where c.vendedor_asignado_id is distinct from (select id from usuarios where auth_id = '${vendGuds}')) clientes_ajenos) t`));
    const suOrden = (await sql(`select o.id from ordenes o join clientes c on c.id = o.cliente_id join usuarios u on u.id = c.vendedor_asignado_id
      where u.auth_id = '${vendGuds}' limit 1`))[0]?.id;
    if (suOrden) {
      await caso('Vendedor: no puede marcar un pedido como aprobado por la API', (r, e) => !!e || r?.n === 0,
        como({ uid: vendGuds, empresa: guds.id }, `with x as (update ordenes set aprobacion = 'aprobada' where id = '${suOrden}' returning 1) select row_to_json(t)::text from (select count(*) n from x) t`));
    }
  }
  const qaCli = (await sql(`select id from auth.users where email = 'qa.cliente@guds.test'`))[0]?.id;
  const libre = qaCli && !(await sql(`select 1 from usuarios where auth_id = '${qaCli}'`)).length;
  if (libre) {
    const previoCli = `insert into usuarios (auth_id, email, nombre, role, cliente_id, activo) values ('${qaCli}', 'qa.cliente@guds.test', 'QA', 'cliente', '${cliGuds}', true);`;
    await caso('Cliente: no puede insertar pedidos directo por la API (solo por la función del carrito)', 'row-level security',
      como({ uid: qaCli, empresa: guds.id, previo: previoCli },
        `with x as (insert into ordenes (cliente_id, subtotal, total, estado, aprobacion, odoo_id) values ('${cliGuds}', 0, 0, 'pendiente', 'aprobada', 999999)
          returning aprobacion, odoo_id) select row_to_json(x)::text from x`));
    await caso('Cliente: no puede insertar pagos directo por la API (p. ej. uno ya "verificado")', 'row-level security',
      como({ uid: qaCli, empresa: guds.id, previo: previoCli },
        `with x as (insert into pagos (cliente_id, monto, metodo, estado) values ('${cliGuds}', 1000, 'transferencia', 'verificado') returning estado) select row_to_json(x)::text from x`));
  }
  if (delivery) {
    await caso('Repartidor: sin entregas asignadas no ve órdenes', (r) => r?.n === 0,
      como({ uid: delivery, empresa: guds.id }, `select row_to_json(t)::text from (select count(*) n from ordenes) t`));
  }
  {
    const [emp] = await sql(`select pe.producto_id, pe.tipo_empaque_id, te.unidades, p.precio_base from producto_empaques pe join tipos_empaque te on te.id = pe.tipo_empaque_id
      join productos p on p.id = pe.producto_id where pe.activo and pe.precio_empaque is null and te.unidades > 1 and not p.en_oferta limit 1`);
    if (emp) {
      await caso('Precios: un empaque sin precio propio vale precio unitario × unidades (como Odoo)', (r) => Math.abs(Number(r?.p) - Number(emp.precio_base) * emp.unidades) < 0.001,
        como({ empresa: guds.id }, `select row_to_json(t)::text from (select public.precio_efectivo('${emp.producto_id}', '${emp.tipo_empaque_id}', null) p) t`));
    }
  }
  await caso('Almacenamiento: un cliente no puede borrar ni subir fotos de productos', (r) => r?.subir === false && r?.borrar === 0,
    como({ uid: vendGuds || admin, empresa: guds.id }, `select row_to_json(t)::text from (select
      (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('Authenticated users can delete images', 'Authenticated users can upload images')) borrar,
      exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'imagenes_subir' and with_check not like '%es_personal_admin%') subir) t`));
  {
    const [bk] = await sql(`select public from storage.buckets where id = 'evidencias-entrega'`);
    casos.push({ ok: bk && bk.public === false ? '✓' : '✗', caso: 'Evidencias de entrega en bucket privado', resultado: JSON.stringify(bk ?? null) });
  }
}

// ── Cuentas de pago, funciones internas y reversos (19l, 19o, 19q) ──
{
  if (vendGuds) {
    await caso('Bancos: un vendedor no lee la tabla de bancos (saldos), solo cuentas_pago sin saldos', (r) => r?.bancos === 0 && r?.cuentas > 0 && r?.con_saldo === false,
      como({ uid: vendGuds, empresa: guds.id }, `select row_to_json(t)::text from (select (select count(*) from bancos) bancos, (select count(*) from cuentas_pago) cuentas,
        exists (select 1 from information_schema.columns where table_name = 'cuentas_pago' and column_name like 'saldo%') con_saldo) t`));
  }
  const oculta = (await sql(`select id from bancos where empresa_id = '${guds.id}' and not visible_portal limit 1`))[0]?.id;
  if (vendGuds && oculta) {
    const cliV = (await sql(`select c.id from clientes c join usuarios u on u.id = c.vendedor_asignado_id where u.auth_id = '${vendGuds}' and c.empresa_id = '${guds.id}' limit 1`))[0]?.id;
    if (cliV) {
      await caso('Pagos: no se declara un pago a una cuenta no publicada', 'no recibe pagos de clientes',
        como({ uid: vendGuds, empresa: guds.id }, `select public.registrar_pago('${cliV}', null, '${oculta}', 'transferencia', 10, 'USD', null, 'REF-PRUEBA', null)::text`));
    }
  }
  await caso('Funciones internas: nadie ejecuta crear_auth_user, notif_admins ni aplicar_pago_a_facturas', (r) => r?.n === 0,
    como({}, `select row_to_json(t)::text from (select count(*) n from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('crear_auth_user', 'notif_admins', 'notif_crear', 'aplicar_pago_a_facturas', 'liquidar_orden')
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) t`));
  await caso('Sin sesión: no se puede aprobar un registro de cliente', 'permission denied',
    como({ rol: 'anon', uid: null }, `select row_to_json(t)::text from public.aprobar_registro_cliente('00000000-0000-0000-0000-000000000000') t`));
  if (vendGuds) {
    await caso('Un vendedor no puede aprobar registros de clientes', 'No tienes permiso para aprobar registros',
      como({ uid: vendGuds, empresa: guds.id }, `select row_to_json(t)::text from public.aprobar_registro_cliente('00000000-0000-0000-0000-000000000000') t`));
  }
  const par = (await sql(`select fa.id, fa.fecha_emision::text f from facturas nc join facturas fa on fa.id = nc.factura_origen_id
    where nc.tipo = 'nota_credito' and fa.tipo = 'factura' and nc.estado = 'posted' and fa.estado = 'posted' and not fa.es_saldo_inicial
      and fa.moneda is not distinct from nc.moneda and abs(abs(nc.total) - abs(fa.total)) < 0.01 and fa.empresa_id = '${qrt.id}' limit 1`))[0];
  if (par) {
    await caso('Reportes: una factura anulada por completo con su NC no cuenta como venta', (r) => r?.n === 0,
      como({ rol: 'postgres', empresa: qrt.id }, `select row_to_json(t)::text from (select count(*) n from public.documentos_venta('${par.f}', '${par.f}') d where d.id = '${par.id}') t`));
  }
}

// ── Portal del vendedor y delivery (19n): cifras con fuente única, empresa por defecto, entregas ajenas ──
{
  if (vendGuds) {
    const [esp] = await sql(`select count(*) n, (select round(coalesce(sum(f.saldo_usd) filter (where f.saldo_usd > 0.009), 0), 2) from facturas f
        join clientes c on c.id = f.cliente_id join usuarios u on u.id = c.vendedor_asignado_id
        where u.auth_id = '${vendGuds}' and c.activo and c.empresa_id = '${guds.id}' and f.estado = 'posted' and (f.empresa_id is null or f.empresa_id = '${guds.id}')) por_cobrar
      from clientes c join usuarios u on u.id = c.vendedor_asignado_id where u.auth_id = '${vendGuds}' and c.activo and c.empresa_id = '${guds.id}'`);
    await caso('Resumen vendedor: su cartera y su deuda = facturas de sus clientes (como Cuentas por cobrar)',
      (r) => r?.clientes === Number(esp.n) && Math.abs(Number(r?.cartera?.por_cobrar) - Number(esp.por_cobrar)) < 0.01,
      como({ uid: vendGuds, empresa: guds.id }, `select public.resumen_vendedor()::text`));
  }
  await caso('Resumen vendedor: sin sesión no se puede consultar', 'permission denied',
    como({ rol: 'anon', uid: null, empresa: guds.id }, `select public.resumen_vendedor()::text`));
  const vSin = (await sql(`select u.id from usuarios u where u.role = 'vendedor' and u.activo
    and (select count(*) from usuario_empresas ue where ue.usuario_id = u.id) = 2
    and not exists (select 1 from clientes c where c.vendedor_asignado_id = u.id) limit 1`))[0]?.id;
  const cliQrtLibre = (await sql(`select id from clientes where empresa_id = '${qrt.id}' and activo and vendedor_asignado_id is null limit 1`))[0]?.id;
  if (vSin && cliQrtLibre) {
    await caso('Empresa por defecto: al asignarle clientes de Quirutec a un vendedor sin cartera, entra por defecto a Quirutec', (r) => r?.defecto === qrt.id,
      como({ empresa: guds.id, previo: `update usuario_empresas set por_defecto = (empresa_id = '${guds.id}') where usuario_id = '${vSin}';
        update clientes set vendedor_asignado_id = '${vSin}' where id = '${cliQrtLibre}';` },
        `select row_to_json(t)::text from (select empresa_id defecto from usuario_empresas where usuario_id = '${vSin}' and por_defecto) t`));
  }
  const repartidor = (await sql(`select u.auth_id from usuarios u where u.role = 'delivery' and u.activo and u.auth_id is not null
    and not exists (select 1 from entregas e where e.repartidor_id = u.id) limit 1`))[0]?.auth_id;
  const ordG = (await sql(`select id from ordenes where empresa_id = '${guds.id}' limit 1`))[0].id;
  const entregaAjena = `insert into entregas (orden_id, repartidor_id, estado) values ('${ordG}', null, 'asignada');`;
  if (repartidor) {
    await caso('Repartidor: no ve las entregas de otros (aunque su rol tenga "delivery: ver")', (r) => r?.n === 0,
      como({ uid: repartidor, empresa: guds.id, previo: entregaAjena }, `select row_to_json(t)::text from (select count(*) n from entregas) t`));
  }
  await caso('Admin: ve las entregas del módulo delivery', (r) => r?.n >= 1,
    como({ empresa: guds.id, previo: entregaAjena }, `select row_to_json(t)::text from (select count(*) n from entregas) t`));
}

// ── Delivery sobre los documentos de entrega de Odoo (19v): asignar, ver lo suyo, cerrar, escritura en Odoo y sync ──
{
  const docs = await sql(`select t.id, t.odoo_id, t.numero from transferencias t where t.empresa_id = '${guds.id}' and t.tipo = 'entrega' and t.estado = 'lista'
    and exists (select 1 from transferencia_items ti where ti.transferencia_id = t.id and ti.cantidad_hecha > 0)
    and not exists (select 1 from entregas e where e.transferencia_odoo_id = t.odoo_id and e.estado in ('asignada', 'en_camino')) order by t.numero limit 2`);
  const noLista = (await sql(`select id from transferencias where empresa_id = '${guds.id}' and tipo = 'entrega' and estado in ('en_espera', 'borrador') limit 1`))[0]?.id;
  const repReal = (await sql(`select u.auth_id from usuarios u join usuario_empresas ue on ue.usuario_id = u.id and ue.empresa_id = '${guds.id}'
    where u.role = 'delivery' and u.activo and u.auth_id is not null limit 1`))[0]?.auth_id;
  if (docs.length === 2 && repReal) {
    const [a, b] = docs;
    const REP = '00000000-0000-0000-0000-00000000d19a';
    // Sesión simulada dentro del bloque (las funciones security definer leen auth.uid() y la empresa del header)
    const sesion = (uid) => `perform set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true);
      perform set_config('request.headers', '{"x-empresa-id":"${guds.id}"}', true);`;
    const repFalso = `insert into usuarios (id, email, nombre, apellido, role, rol_id, activo) select '${REP}', 'prueba.19v@guds.test', 'Prueba', 'Repartidor', 'delivery', r.id, true
        from roles r where lower(r.nombre) = 'delivery' limit 1;
      insert into usuario_empresas (usuario_id, empresa_id, por_defecto) values ('${REP}', '${guds.id}', true);`;
    const asignarA = (rep) => `${sesion(admin)} perform public.asignar_entrega_documento('${a.id}', ${rep}, 'normal');`;
    const idRepReal = `(select id from usuarios where auth_id = '${repReal}')`;
    const evidencia = `insert into storage.objects (bucket_id, name) select 'evidencias-entrega', e.id || x.f from entregas e, (values ('/firma-19v.png'), ('/foto-19v.jpg')) x(f)
      where e.transferencia_odoo_id = ${a.odoo_id} and e.estado = 'asignada';`;
    const cerrarA = (resultado, datos) => `with e as (select id from entregas where transferencia_odoo_id = ${a.odoo_id} and estado in ('asignada', 'en_camino'))
      select public.cerrar_entrega(e.id, '${resultado}', ${datos})::text from e`;

    await caso('Delivery 19v: el admin asigna un documento "Listo" de Odoo a un repartidor', (r) => r?.estado === 'asignada' && r?.transferencia_odoo_id === a.odoo_id && r?.empresa_id === guds.id,
      como({ empresa: guds.id, previo: `${repFalso} ${asignarA(`'${REP}'`)}` },
        `select row_to_json(t)::text from (select estado, transferencia_odoo_id, empresa_id from entregas where transferencia_odoo_id = ${a.odoo_id} and estado = 'asignada') t`));
    if (noLista) {
      await caso('Delivery 19v: no se asigna un documento que no está "Listo" en Odoo', 'no está listo',
        como({ empresa: guds.id, previo: repFalso }, `select public.asignar_entrega_documento('${noLista}', '${REP}', 'normal')::text`));
    }
    if (vendGuds) {
      await caso('Delivery 19v: un vendedor no puede asignar documentos de entrega', 'Solo administración',
        como({ uid: vendGuds, empresa: guds.id, previo: repFalso }, `select public.asignar_entrega_documento('${a.id}', '${REP}', 'normal')::text`));
    }
    await caso('Delivery 19v: el repartidor solo ve sus documentos (tabla y mis_entregas_reparto)', (r) => r?.mio === 1 && r?.ajeno === 0 && r?.ajenas_tabla === 0,
      como({ uid: repReal, empresa: guds.id, previo: `${repFalso} ${asignarA(idRepReal)} perform public.asignar_entrega_documento('${b.id}', '${REP}', 'normal');` },
        `select row_to_json(t)::text from (select
          count(*) filter (where x->>'numero' = '${a.numero}' and x->>'empresa_id' = '${guds.id}') mio,
          count(*) filter (where x->>'numero' = '${b.numero}' and x->>'empresa_id' = '${guds.id}') ajeno,
          (select count(*) from entregas where repartidor_id is distinct from ${idRepReal}) ajenas_tabla
          from jsonb_array_elements(public.mis_entregas_reparto()) x) t`));
    await caso('Delivery 19v: cerrar "entregado completo" encola la escritura entrega_estado en Odoo', (r) => r?.estado === 'entregada' && !!r?.escritura_id,
      como({ uid: repReal, empresa: guds.id, previo: `${asignarA(idRepReal)} ${evidencia}` },
        cerrarA('completa', `jsonb_build_object('receptor', 'Prueba 19v', 'firma', e.id || '/firma-19v.png', 'foto', e.id || '/foto-19v.jpg')`)));
    await caso('Delivery 19v: rechazar queda solo en GUDS (no encola escritura en Odoo)', (r) => r?.estado === 'rechazada' && r?.escritura_id === null,
      como({ uid: repReal, empresa: guds.id, previo: `${asignarA(idRepReal)} ${evidencia}` },
        cerrarA('rechazada', `jsonb_build_object('motivo', 'precio', 'foto', e.id || '/foto-19v.jpg')`)));
    await caso('Delivery 19v: "entregado completo" sin firma ni foto se rechaza', 'firma',
      como({ uid: repReal, empresa: guds.id, previo: asignarA(idRepReal) }, cerrarA('completa', `jsonb_build_object('receptor', 'Prueba 19v')`)));
    await caso('Delivery 19v: reprogramar exige una fecha de hoy en adelante', 'anterior a hoy',
      como({ uid: repReal, empresa: guds.id, previo: asignarA(idRepReal) }, cerrarA('reprogramada', `jsonb_build_object('motivo', 'cerrado', 'fecha', '2020-01-01')`)));
    await caso('Delivery 19v: otro repartidor no puede cerrar la entrega', 'no está asignada a ti',
      como({ uid: repReal, empresa: guds.id, previo: `${repFalso} ${asignarA(`'${REP}'`)} perform set_config('guds.prueba_ent', (select id from entregas where transferencia_odoo_id = ${a.odoo_id} and estado = 'asignada')::text, true);` },
        `select public.cerrar_entrega(current_setting('guds.prueba_ent')::uuid, 'rechazada', '{"motivo":"precio"}'::jsonb)::text`));
    await caso('Delivery 19v: si Odoo valida el documento, la sincronización cierra la entrega ("Actualizado desde Odoo")', (r) => r?.n >= 1 && r?.estado === 'entregada' && r?.origen === 'odoo',
      como({ rol: 'postgres', empresa: guds.id, previo: `${repFalso} ${asignarA(`'${REP}'`)} update transferencias set estado = 'hecha' where id = '${a.id}';
        perform set_config('guds.prueba_n', public.cerrar_entregas_desde_odoo('${guds.id}')::text, true);` },
        `select row_to_json(t)::text from (select current_setting('guds.prueba_n')::int n, estado, origen_cierre origen from entregas where transferencia_odoo_id = ${a.odoo_id} order by created_at desc limit 1) t`));
  }
  // Reposiciones a consignación (traslado interno propio → consignación): entran en la cola y se entregan en el cliente del almacén
  {
    const [repo] = await sql(`select t.id, t.numero, ad.cliente_id from transferencias t join almacenes ad on ad.id = t.almacen_destino_id
      where t.empresa_id = '${guds.id}' and t.tipo = 'interna' and ad.tipo = 'consignacion' and ad.cliente_id is not null and t.estado = 'lista'
        and exists (select 1 from transferencia_items ti where ti.transferencia_id = t.id and ti.cantidad_hecha > 0)
        and not exists (select 1 from entregas e where e.transferencia_odoo_id = t.odoo_id and e.estado in ('asignada', 'en_camino')) limit 1`);
    const [entrePropios] = await sql(`select t.id from transferencias t join almacenes ao on ao.id = t.almacen_origen_id join almacenes ad on ad.id = t.almacen_destino_id
      where t.empresa_id = '${guds.id}' and t.tipo = 'interna' and ao.tipo = 'propio' and ad.tipo = 'propio' limit 1`);
    const repReal2 = (await sql(`select u.auth_id from usuarios u join usuario_empresas ue on ue.usuario_id = u.id and ue.empresa_id = '${guds.id}'
      where u.role = 'delivery' and u.activo and u.auth_id is not null limit 1`))[0]?.auth_id;
    const sesionAdmin = `perform set_config('request.jwt.claims', '{"sub":"${admin}","role":"authenticated"}', true);
      perform set_config('request.headers', '{"x-empresa-id":"${guds.id}"}', true);`;
    if (repo && repReal2) {
      const asignarRepo = `${sesionAdmin} perform public.asignar_entrega_documento('${repo.id}', (select id from usuarios where auth_id = '${repReal2}'), 'normal');`;
      await caso('Delivery 19v: el admin asigna una reposición a consignación (se entrega en el cliente del almacén)', (r) => r?.estado === 'asignada' && r?.cliente_ok === true,
        como({ empresa: guds.id, previo: asignarRepo },
          `select row_to_json(t)::text from (select estado, cliente_id = '${repo.cliente_id}' cliente_ok from entregas where transferencia_id = '${repo.id}' and estado = 'asignada') t`));
      await caso('Delivery 19v: el repartidor ve la reposición con su tipo, el almacén de consignación y la dirección del cliente', (r) => r?.tipo === 'reposicion' && !!r?.contacto && !!r?.direccion,
        como({ uid: repReal2, empresa: guds.id, previo: asignarRepo },
          `select row_to_json(t)::text from (select x->>'tipo' tipo, x->>'contacto' contacto, x->>'direccion' direccion from jsonb_array_elements(public.mis_entregas_reparto()) x
            where x->>'numero' = '${repo.numero}') t`));
    }
    if (entrePropios) {
      await caso('Delivery 19v: un traslado entre almacenes propios no se asigna', 'Solo se asignan órdenes de entrega de Odoo o reposiciones',
        como({ empresa: guds.id }, `select public.asignar_entrega_documento('${entrePropios.id}', (select id from usuarios where role = 'delivery' limit 1), 'normal')::text`));
    }
  }
  await caso('Delivery 19v: sin sesión no se consultan entregas del repartidor', 'permission denied',
    como({ rol: 'anon', uid: null, empresa: guds.id }, `select public.mis_entregas_reparto()::text`));
}

// ── Teléfonos y direcciones del cliente → Odoo (19w): solo personal de administración, datos validados, a la cola ──
{
  const qaVend = (await sql(`select a.id from auth.users a join usuarios u on u.auth_id = a.id where a.email = 'qa.vendedor@guds.test' and u.role = 'vendedor'`))[0]?.id || vendGuds;
  const contacto = (datos, cli = cliGuds) => `select public.actualizar_contacto_cliente('${cli}', ${lit(JSON.stringify(datos))}::jsonb)::text`;
  const direccion = (dir, datos, cli = cliGuds) => `select public.guardar_direccion_cliente('${cli}', ${dir ? `'${dir}'` : 'null'}, ${lit(JSON.stringify(datos))}::jsonb)::text`;
  if (qaVend) {
    await caso('Clientes→Odoo: un vendedor no puede editar teléfonos ni dirección de un cliente', 'No tienes permiso para editar',
      como({ uid: qaVend, empresa: guds.id }, contacto({ telefono: '0414-1234567' })));
    await caso('Clientes→Odoo: un vendedor no puede crear direcciones de entrega', 'No tienes permiso para editar',
      como({ uid: qaVend, empresa: guds.id }, direccion(null, { nombre: 'Prueba', calle: 'Av. Principal 1', ciudad: 'Caracas', estado: 'Miranda' })));
    await caso('Clientes→Odoo: un vendedor no ve el historial de envíos a Odoo', 'No tienes permiso para ver el historial',
      como({ uid: qaVend, empresa: guds.id }, `select count(*)::text from public.historial_escrituras_cliente('${cliGuds}')`));
  }
  await caso('Clientes→Odoo: sin sesión no se puede editar', 'permission denied',
    como({ rol: 'anon', uid: null, empresa: guds.id }, contacto({ telefono: '0414-1234567' })));
  // El admin encola (la escritura se deshace con el bloque: no llega a Odoo)
  const previoEncolar = `create function public.p19w_encolar(p_cli uuid) returns text language plpgsql as $f$
    declare v uuid; r text;
    begin
      v := public.actualizar_contacto_cliente(p_cli, '{"telefono":"0414-1234567","calle":"Av. Principal de Prueba","ciudad":"Caracas","estado":"Distrito Capital (VE)"}'::jsonb);
      select row_to_json(t)::text into r from (select tipo, estado, referencia_id = p_cli ref, solicitado_por is not null quien,
        datos -> 'campos' ->> 'telefono' tel, datos -> 'campos' ->> 'estado' est, datos -> 'antes' ? 'direccion' antes from public.odoo_escrituras where id = v) t;
      return r;
    end $f$;`;
  await caso('Clientes→Odoo: el admin encola el cambio (pendiente, con quién lo pidió y los datos validados)',
    (r) => r?.tipo === 'cliente_contacto' && r?.estado === 'pendiente' && r?.ref && r?.quien && r?.tel === '0414-1234567' && r?.est === 'Distrito Capital' && r?.antes,
    como({ empresa: guds.id, previo: previoEncolar }, `select public.p19w_encolar('${cliGuds}')`));
  await caso('Clientes→Odoo: teléfono inválido se rechaza', 'no es un número venezolano válido',
    como({ empresa: guds.id }, contacto({ telefono: '123' })));
  await caso('Clientes→Odoo: un fijo no vale como celular', 'debe ser un móvil venezolano',
    como({ empresa: guds.id }, contacto({ celular: '0212-5551234' })));
  await caso('Clientes→Odoo: estado que no es de Venezuela se rechaza', 'Elige un estado de Venezuela válido',
    como({ empresa: guds.id }, contacto({ calle: 'Av. Principal 1', ciudad: 'Caracas', estado: 'Narnia' })));
  await caso('Clientes→Odoo: dirección incompleta se rechaza (ciudad obligatoria)', 'La ciudad es obligatoria',
    como({ empresa: guds.id }, contacto({ calle: 'Av. Principal 1', estado: 'Miranda' })));
  await caso('Clientes→Odoo: campos fuera de teléfonos/dirección se rechazan', 'Campos no permitidos: email',
    como({ empresa: guds.id }, contacto({ email: 'otro@correo.com' })));
  await caso('Clientes→Odoo: una dirección nueva necesita nombre', 'necesita un nombre',
    como({ empresa: guds.id }, direccion(null, { calle: 'Av. Principal 1', ciudad: 'Caracas', estado: 'Miranda' })));
  const dirAjena = (await sql(`select id from cliente_direcciones where cliente_id <> '${cliGuds}' and odoo_id is not null limit 1`))[0]?.id;
  if (dirAjena) {
    await caso('Clientes→Odoo: no se edita la dirección de otro cliente', 'no pertenece a este cliente',
      como({ empresa: guds.id }, direccion(dirAjena, { telefono: '0414-1234567' })));
  }
  await caso('Clientes→Odoo: solo se reintentan envíos de clientes existentes', 'Escritura no encontrada',
    como({ empresa: guds.id }, `select public.reintentar_escritura_cliente('00000000-0000-0000-0000-000000000000')::text`));
  await caso('Clientes→Odoo: anon no ejecuta las funciones y nadie ejecuta los validadores internos', (r) => r?.n === 0,
    como({}, `select row_to_json(t)::text from (select count(*) n from pg_proc p where p.pronamespace = 'public'::regnamespace and (
      (p.proname in ('actualizar_contacto_cliente', 'guardar_direccion_cliente', 'reintentar_escritura_cliente', 'historial_escrituras_cliente', 'puede_editar_cliente_odoo')
        and has_function_privilege('anon', p.oid, 'execute'))
      or (p.proname in ('validar_telefono_ve', 'estado_ve', 'validar_direccion_odoo', 'encolar_escritura_odoo')
        and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))))) t`));
}

// ── Rendimiento de RLS (18r): las funciones constantes deben ir envueltas en (select …) para evaluarse una vez ──
{
  const pol = await sql(String.raw`select tablename || '.' || policyname p, coalesce(qual,'') || ' ' || coalesce(with_check,'') t from pg_policies where schemaname = 'public'`);
  const malas = pol.filter((x) => /(?<!SELECT )(puede\('|auth\.uid\(|empresa_solicitada\(|es_admin_total\(|usuario_actual_id\()/.test(x.t) || /(?<![A-Za-z_]|SELECT )is_admin\(\)/.test(x.t));
  casos.push({ ok: malas.length ? '✗' : '✓', caso: 'RLS: ninguna política evalúa puede()/auth.uid() fila por fila', resultado: malas.length ? malas.slice(0, 3).map((x) => x.p).join(', ') : `${pol.length} políticas revisadas` });
}

console.table(casos);
const fallas = casos.filter(c => c.ok === '✗').length;
console.log(fallas ? `✗ ${fallas} caso(s) fallaron` : `✓ Los ${casos.length} casos pasaron`);
process.exit(fallas ? 1 : 0);
