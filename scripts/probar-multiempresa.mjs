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
  const prod = (await sql(`select id, comprometido_guds, impuesto_pct from productos where empresa_id = '${guds.id}' and controla_stock and stock_disponible > 100 and activo limit 1`))[0];
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

    // ── IVA por producto desde Odoo y cotización en el servidor (20a/20b) ──
    await caso('IVA: el pedido del vendedor (GUDS) guarda el IVA de cada línea y el del pedido por grupo de tasa', (r) =>
      Number(r?.pct) === Number(prod.impuesto_pct ?? 16) && Math.abs(Number(r?.impuesto) - Math.round(Number(r?.subtotal) * Number(r?.pct)) / 100) < 0.011,
      como({ empresa: guds.id, previo: previoVend },
        `select row_to_json(t)::text from (select o.subtotal, o.impuesto, (select max(i.impuesto_pct) from orden_items i where i.orden_id = o.id) pct from ordenes o where o.id = ${idPend}) t`));
    await caso('Cotización: cotizar_pedido da el mismo total que el pedido guardado', (r) => r?.ok === true,
      como({ uid: vendGuds, empresa: guds.id, previo: previoVend },
        `select row_to_json(t)::text from (select (public.cotizar_pedido('${vend.cliente}', ${items}, null, 0) ->> 'total')::numeric = (select total from ordenes where id = ${idPend}) ok) t`));

    await caso('Cotización: la edición de un pedido cotiza lo mismo que guarda editar_pedido_pendiente', (r) => r?.ok === true,
      como({ uid: vendGuds, empresa: guds.id, previo: `${previoVend} perform set_config('guds.prueba_orden', ${idPend}::text, true);
        perform set_config('guds.prueba_cot', (public.cotizar_pedido('${vend.cliente}', '[{"producto_id":"${prod.id}","cantidad":5}]'::jsonb, null, 7.5,
          current_setting('guds.prueba_orden')::uuid) ->> 'total'), true);
        perform public.editar_pedido_pendiente(current_setting('guds.prueba_orden')::uuid, '[{"producto_id":"${prod.id}","cantidad":5}]'::jsonb, null, 7.5);` },
        `select row_to_json(t)::text from (select current_setting('guds.prueba_cot')::numeric = (select total from ordenes where id = current_setting('guds.prueba_orden')::uuid) ok) t`));

    // ── Línea de tiempo y avisos de lo que cambia en Odoo (20d) ──
    await caso('Eventos: crear y aprobar un pedido quedan en su línea de tiempo', (r) => r?.creado === 1 && r?.aprobado === 1,
      como({ empresa: guds.id, previo: `${previoVend} ${comoUsuario(admin)} perform public.aprobar_pedido(${idPend});` },
        `select row_to_json(t)::text from (select count(*) filter (where tipo = 'creado') creado, count(*) filter (where tipo = 'aprobado') aprobado
          from orden_eventos where orden_id = ${idPend}) t`));
    await caso('Eventos: la confirmación que llega de Odoo queda registrada y avisa al vendedor', (r) => r?.confirmado === 1 && r?.aviso >= 1,
      como({ rol: 'postgres', empresa: guds.id, previo: `${previoVend} perform set_config('guds.prueba_orden', ${idPend}::text, true);
        perform set_config('request.jwt.claims', '', true);
        update ordenes set estado_odoo = 'sale' where id = current_setting('guds.prueba_orden')::uuid;` },
        `select row_to_json(t)::text from (select (select count(*) from orden_eventos where orden_id = current_setting('guds.prueba_orden')::uuid and tipo = 'confirmado' and origen = 'odoo') confirmado,
          (select count(*) from notificaciones n join usuarios u on u.id = n.usuario_id where u.auth_id = '${vendGuds}' and n.titulo = 'Pedido confirmado'
            and n.link like '%' || current_setting('guds.prueba_orden')) aviso) t`));
    await caso('Eventos: el vendedor ve la línea de tiempo de sus pedidos', (r) => r?.n >= 1,
      como({ uid: vendGuds, empresa: guds.id, previo: `${previoVend} perform set_config('guds.prueba_orden', ${idPend}::text, true);` },
        `select row_to_json(t)::text from (select count(*) n from orden_eventos where orden_id = current_setting('guds.prueba_orden')::uuid) t`));

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

// ── IVA por producto: Quirutec exento vs gravado (20a) ──
{
  const exento = (await sql(`select id from productos where empresa_id = '${qrt.id}' and activo and impuesto_pct = 0 and odoo_id is not null limit 1`))[0]?.id;
  const gravado = (await sql(`select id from productos where empresa_id = '${qrt.id}' and activo and impuesto_pct = 16 and odoo_id is not null limit 1`))[0]?.id;
  if (exento) {
    await caso('IVA: un producto exento de Quirutec cotiza con IVA 0', (r) => Number(r?.impuesto) === 0 && Number(r?.subtotal) > 0,
      como({ empresa: qrt.id }, `select (public.cotizar_pedido('${cliQrt}', '[{"producto_id":"${exento}","cantidad":3}]'::jsonb, null, 0))::text`));
  }
  if (gravado) {
    await caso('IVA: un producto gravado de Quirutec cotiza con IVA 16 %', (r) => Math.abs(Number(r?.impuesto) - Math.round(Number(r?.subtotal) * 16) / 100) < 0.011 && Number(r?.impuesto) > 0,
      como({ empresa: qrt.id }, `select (public.cotizar_pedido('${cliQrt}', '[{"producto_id":"${gravado}","cantidad":3}]'::jsonb, null, 0))::text`));
  }
  if (vendGuds) {
    await caso('Cotización: un vendedor no cotiza para un cliente que no es suyo', 'No puedes cotizar',
      como({ uid: vendGuds, empresa: qrt.id }, `select (public.cotizar_pedido('${cliQrt}', '[]'::jsonb))::text`));
  }
  await caso('IVA: las funciones internas de impuestos no se ejecutan por la API', (r) => r?.n === 0,
    como({}, `select row_to_json(t)::text from (select count(*) n from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('impuesto_producto', 'impuesto_de_items', 'impuesto_envio', 'aplicar_impuestos_orden')
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) t`));
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
  await caso('Clientes→Odoo: campos fuera de teléfonos/dirección/correo se rechazan', 'Campos no permitidos: rif',
    como({ empresa: guds.id }, contacto({ rif: 'J-12345678-9' })));
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

// ── Delivery D2/D3 (20f): ubicaciones de entrega (pin o GPS del cierre), rutas por día y aviso al repartidor ──
{
  const docs = await sql(`select t.id, t.odoo_id, t.numero from transferencias t where t.empresa_id = '${guds.id}' and t.tipo = 'entrega' and t.estado = 'lista'
    and t.cliente_id is not null and exists (select 1 from transferencia_items ti where ti.transferencia_id = t.id and ti.cantidad_hecha > 0)
    and not exists (select 1 from entregas e where e.transferencia_odoo_id = t.odoo_id and e.estado in ('asignada', 'en_camino')) order by t.numero limit 2`);
  const repReal = (await sql(`select u.auth_id from usuarios u join usuario_empresas ue on ue.usuario_id = u.id and ue.empresa_id = '${guds.id}'
    where u.role = 'delivery' and u.activo and u.auth_id is not null order by u.created_at limit 1`))[0]?.auth_id;
  const [conSucursal] = await sql(`select t.id, t.odoo_id, d.id direccion_id from transferencias t join cliente_direcciones d on d.odoo_id = t.partner_odoo_id and d.cliente_id = t.cliente_id
    where t.empresa_id = '${guds.id}' and t.tipo = 'entrega' and t.estado = 'lista'
      and not exists (select 1 from entregas e where e.transferencia_odoo_id = t.odoo_id and e.estado in ('asignada', 'en_camino')) limit 1`);
  const sesion = (uid) => `perform set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true);
    perform set_config('request.headers', '{"x-empresa-id":"${guds.id}"}', true);`;
  const HOY = `(now() at time zone 'America/Caracas')::date`;
  const REP = '00000000-0000-0000-0000-00000000d20f';
  const repFalso = `insert into usuarios (id, email, nombre, apellido, role, rol_id, activo) select '${REP}', 'prueba.20f@guds.test', 'Prueba', 'Repartidor', 'delivery', r.id, true
      from roles r where lower(r.nombre) = 'delivery' limit 1;
    insert into usuario_empresas (usuario_id, empresa_id, por_defecto) values ('${REP}', '${guds.id}', true);`;
  if (docs.length === 2 && repReal) {
    const [a, b] = docs;
    const idRep = `(select id from usuarios where auth_id = '${repReal}')`;
    const ent = (doc) => `(select id from entregas where transferencia_odoo_id = ${doc.odoo_id} and estado in ('asignada', 'en_camino'))`;
    const asignar = (doc, rep = idRep) => `${sesion(admin)} perform public.asignar_entrega_documento('${doc.id}', ${rep}, 'normal');`;
    const pinDe = (doc, lat = 10.5, lng = -66.9) => `insert into ubicaciones_entrega (cliente_id, direccion_id, latitud, longitud, fuente, confirmada, confirmada_at)
      select cliente_id, direccion_id, ${lat}, ${lng}, 'pin', true, now() from entregas where id = ${ent(doc)} on conflict do nothing;`;
    const evidencia = (doc) => `insert into storage.objects (bucket_id, name) select 'evidencias-entrega', e.id || '/foto-20f.jpg' from entregas e where e.id = ${ent(doc)};`;
    const rechazarConGps = (doc, gps) => `${evidencia(doc)} ${sesion(repReal)}
      perform set_config('guds.p20f_r', public.cerrar_entrega(${ent(doc)}, 'rechazada', jsonb_build_object('motivo', 'precio', 'foto', ${ent(doc)} || '/foto-20f.jpg', 'gps', ${gps}))::text, true);`;
    const ultima = (doc) => `(select id from entregas where transferencia_odoo_id = ${doc.odoo_id} order by created_at desc limit 1)`;
    const publicar = (orden) => `${sesion(admin)} perform public.publicar_ruta_reparto(${idRep}, ${HOY}, array[${orden.map((d) => ent(d)).join(', ')}]::uuid[]);`;

    await caso('Delivery 20f: el repartidor solo ve las ubicaciones de sus paradas (tabla y mis_entregas_reparto)', (r) => r?.mio === 1 && r?.otra === 0 && r?.rpc === 1,
      como({ uid: repReal, empresa: guds.id, previo: `${asignar(a)} ${pinDe(a)}
          perform set_config('guds.p20f_otro', (select c.id from clientes c where c.id <> (select cliente_id from entregas where id = ${ent(a)})
            and not exists (select 1 from ubicaciones_entrega u where u.cliente_id = c.id) order by c.id limit 1)::text, true);
          insert into ubicaciones_entrega (cliente_id, latitud, longitud, fuente, confirmada, confirmada_at) values (current_setting('guds.p20f_otro')::uuid, 10.6, -66.8, 'pin', true, now());` },
        `select row_to_json(t)::text from (select
          (select count(*) from ubicaciones_entrega where cliente_id = (select cliente_id from entregas where id = ${ent(a)})) mio,
          (select count(*) from ubicaciones_entrega where cliente_id = current_setting('guds.p20f_otro')::uuid) otra,
          (select count(*) from jsonb_array_elements(public.mis_entregas_reparto()) x where x->>'numero' = '${a.numero}' and (x->'ubicacion'->>'lat')::numeric = 10.5) rpc) t`));
    if (vendGuds) {
      await caso('Delivery 20f: un vendedor no guarda ubicaciones de entrega', 'Solo administración',
        como({ uid: vendGuds, empresa: guds.id }, `select public.guardar_ubicacion_entrega('${cliGuds}', null, 10.5, -66.9)::text`));
      await caso('Delivery 20f: un vendedor no escribe directo en ubicaciones_entrega', 'permission denied',
        como({ uid: vendGuds, empresa: guds.id }, `with x as (insert into ubicaciones_entrega (cliente_id, latitud, longitud, fuente) values ('${cliGuds}', 10.5, -66.9, 'pin') returning id) select row_to_json(x)::text from x`));
    }
    const CLI = '00000000-0000-0000-0000-00000000c20f';
    await caso('Delivery 20f: un cliente no guarda ni confirma ubicaciones', 'Solo administración',
      como({ uid: CLI, empresa: guds.id, previo: `insert into auth.users (id, email, aud, role) values ('${CLI}', 'prueba.cliente.20f@guds.test', 'authenticated', 'authenticated');
          insert into usuarios (auth_id, email, nombre, role, cliente_id, activo) values ('${CLI}', 'prueba.cliente.20f@guds.test', 'Prueba', 'cliente', '${cliGuds}', true);` },
        `select public.guardar_ubicacion_entrega('${cliGuds}', null, 10.5, -66.9)::text`));
    await caso('Delivery 20f: el GPS de una entrega crea la ubicación propuesta (sin confirmar)', (r) => r?.fuente === 'gps_entrega' && r?.confirmada === false && Number(r?.latitud) === 10.491234 && Number(r?.cierre_lat) === 10.491234 && r?.res === 'propuesta',
      como({ empresa: guds.id, previo: `${asignar(a)} ${rechazarConGps(a, `jsonb_build_object('lat', 10.4912341, 'lng', -66.8765432, 'precision', 14)`)}` },
        `select row_to_json(t)::text from (select u.fuente, u.confirmada, u.latitud, e.cierre_lat, current_setting('guds.p20f_r')::jsonb->>'ubicacion' res
          from entregas e join ubicaciones_entrega u on u.entrega_id = e.id where e.id = ${ultima(a)}) t`));
    await caso('Delivery 20f: el GPS no pisa una ubicación confirmada (queda solo en la entrega)', (r) => r?.fuente === 'pin' && Number(r?.latitud) === 10.5 && Number(r?.cierre_lat) === 10.49 && r?.res === 'ya_confirmada',
      como({ empresa: guds.id, previo: `${asignar(a)} ${pinDe(a)} ${rechazarConGps(a, `jsonb_build_object('lat', 10.49, 'lng', -66.87, 'precision', 10)`)}` },
        `select row_to_json(t)::text from (select u.fuente, u.latitud, e.cierre_lat, current_setting('guds.p20f_r')::jsonb->>'ubicacion' res
          from entregas e join ubicaciones_entrega u on u.cliente_id = e.cliente_id and u.direccion_id is not distinct from e.direccion_id where e.id = ${ultima(a)}) t`));
    await caso('Delivery 20f: un GPS impreciso (> 500 m) no propone ubicación', (r) => r?.res === 'impreciso' && r?.n === 0,
      como({ empresa: guds.id, previo: `${asignar(a)} ${rechazarConGps(a, `jsonb_build_object('lat', 10.49, 'lng', -66.87, 'precision', 2500)`)}` },
        `select row_to_json(t)::text from (select current_setting('guds.p20f_r')::jsonb->>'ubicacion' res, (select count(*) from ubicaciones_entrega where entrega_id = ${ultima(a)}) n) t`));
    await caso('Delivery 20f: el admin confirma con un clic la ubicación propuesta', (r) => r?.confirmada === true && r?.quien === true,
      como({ empresa: guds.id, previo: `${asignar(a)} ${rechazarConGps(a, `jsonb_build_object('lat', 10.49, 'lng', -66.87, 'precision', 20)`)}
          ${sesion(admin)} perform public.confirmar_ubicacion_entrega((select id from ubicaciones_entrega where entrega_id = ${ultima(a)}));` },
        `select row_to_json(t)::text from (select confirmada, confirmada_por is not null quien from ubicaciones_entrega where entrega_id = ${ultima(a)}) t`));
    await caso('Delivery 20f: una ubicación fuera de Venezuela (lat/lng invertidas) se rechaza', 'fuera de Venezuela',
      como({ empresa: guds.id }, `select public.guardar_ubicacion_entrega('${cliGuds}', null, -66.9, 10.5)::text`));
    await caso('Delivery 20f: el repartidor no puede publicar ni ordenar su ruta', 'Solo administración',
      como({ uid: repReal, empresa: guds.id, previo: asignar(a) }, `select public.publicar_ruta_reparto(${idRep}, ${HOY}, array[${ent(a)}]::uuid[])::text`));
    await caso('Delivery 20f: el repartidor no cambia orden_ruta directo (0 filas)', (r, err) => r === null && !err,
      como({ uid: repReal, empresa: guds.id, previo: asignar(a) }, `with x as (update entregas set orden_ruta = 7 where id = ${ent(a)} returning id) select row_to_json(x)::text from x`));
    await caso('Delivery 20f: el admin publica la ruta: guarda orden_ruta y avisa al repartidor', (r) => r?.ob === 1 && r?.oa === 2 && r?.v === 1 && r?.n === 1,
      como({ uid: repReal, empresa: guds.id, previo: `${asignar(a)} ${asignar(b)} ${publicar([b, a])}` },
        `select row_to_json(t)::text from (select (select orden_ruta from entregas where id = ${ent(b)}) ob, (select orden_ruta from entregas where id = ${ent(a)}) oa,
          (select version from rutas_reparto where repartidor_id = ${idRep} and fecha = ${HOY}) v,
          (select count(*) from notificaciones where usuario_id = ${idRep} and titulo = 'Ruta publicada' and link = '/delivery/ruta') n) t`));
    await caso('Delivery 20f: al cambiar el orden avisa "Ruta actualizada" y el repartidor lo ve en ese orden', (r) => r?.v === 2 && r?.n === 1 && r?.orden === `${a.numero},${b.numero}`,
      como({ uid: repReal, empresa: guds.id, previo: `${asignar(a)} ${asignar(b)} ${publicar([b, a])} ${publicar([b, a])} ${publicar([a, b])}` },
        `select row_to_json(t)::text from (select
          (select string_agg(x->>'numero', ',' order by o) from jsonb_array_elements(public.mis_entregas_reparto()) with ordinality z(x, o) where x->>'numero' in ('${a.numero}', '${b.numero}')) orden,
          (select version from rutas_reparto where repartidor_id = ${idRep} and fecha = ${HOY}) v,
          (select count(*) from notificaciones where usuario_id = ${idRep} and titulo = 'Ruta actualizada') n) t`));
    await caso('Delivery 20f: no se publica en la ruta una entrega de otro repartidor', 'no son entregas abiertas de este repartidor',
      como({ empresa: guds.id, previo: `${repFalso} ${asignar(a, `'${REP}'`)}` }, `select public.publicar_ruta_reparto(${idRep}, ${HOY}, array[${ent(a)}]::uuid[])::text`));
    await caso('Delivery 20f: al reasignar la entrega sale de la ruta planificada', (r) => r?.fecha_ruta === null && r?.orden_ruta === null,
      como({ empresa: guds.id, previo: `${repFalso} ${asignar(a)} ${publicar([a])} ${asignar(a, `'${REP}'`)}` },
        `select row_to_json(t)::text from (select fecha_ruta, orden_ruta from entregas where id = ${ent(a)}) t`));
    if (vendGuds) {
      await caso('Delivery 20f: un vendedor no cambia el punto de salida', 'Solo administración',
        como({ uid: vendGuds, empresa: guds.id }, `select public.guardar_punto_salida(10.5, -66.9, 'Prueba')::text`));
    }
  }
  if (conSucursal && repReal) {
    await caso('Delivery 20f: la entrega guarda la sucursal (dirección de entrega) del documento de Odoo', (r) => r?.ok === true,
      como({ empresa: guds.id, previo: `${sesion(admin)} perform public.asignar_entrega_documento('${conSucursal.id}', (select id from usuarios where auth_id = '${repReal}'), 'normal');` },
        `select row_to_json(t)::text from (select direccion_id = '${conSucursal.direccion_id}' ok from entregas where transferencia_odoo_id = ${conSucursal.odoo_id} and estado = 'asignada') t`));
  }
  await caso('Delivery 20f: anon no ejecuta las funciones y nadie ejecuta las internas', (r) => r?.n === 0,
    como({}, `select row_to_json(t)::text from (select count(*) n from pg_proc p where p.pronamespace = 'public'::regnamespace and (
      (p.proname in ('guardar_ubicacion_entrega', 'confirmar_ubicacion_entrega', 'borrar_ubicacion_entrega', 'guardar_punto_salida', 'ruta_reparto_admin', 'publicar_ruta_reparto')
        and has_function_privilege('anon', p.oid, 'execute'))
      or (p.proname in ('registrar_gps_cierre', 'direccion_destino_transferencia', 'puede_editar_ubicaciones')
        and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))))) t`));
  await caso('Delivery 20f: sin sesión no se leen ubicaciones ni rutas', 'permission denied',
    como({ rol: 'anon', uid: null, empresa: guds.id }, `select count(*)::text from ubicaciones_entrega`));
}

// ── Histórico de Profit (20g): solo lectura, por empresa y con el permiso de reportes; suma a los reportes sin cambiar Odoo ──
{
  const [{ lote }] = await sql(`select public.profit_lote_vigente() lote`);
  const resuelto = (obj) => Promise.resolve(obj.error ? obj : { ok: JSON.stringify(obj) });
  const valor = async (q, empresa = 'todas') => { const r = await como({ empresa }, q); return r.ok ? JSON.parse(r.ok) : { error: r.error }; };
  if (!lote) {
    casos.push({ ok: '✗', caso: 'Profit: hay un lote vigente del histórico', resultado: 'sin carga (node scripts/importar-historico-profit.mjs)' });
  } else {
    const cuentaHist = `select row_to_json(t)::text from (select count(*) n from public.ventas_historicas) t`;
    if (vendGuds) {
      await caso('Profit: un vendedor no lee ventas_historicas', (r, err) => r?.n === 0 || /permission denied/.test(err || ''),
        como({ uid: vendGuds, empresa: guds.id }, cuentaHist));
      await caso('Profit: un vendedor no lee el resumen por documento ni las equivalencias', (r) => r?.docs === 0 && r?.vend === 0,
        como({ uid: vendGuds, empresa: guds.id }, `select row_to_json(t)::text from (select (select count(*) from public.profit_documentos) docs,
          (select count(*) from public.profit_vendedores) vend) t`));
      await caso('Profit: un vendedor no ve el estado del histórico', 'permiso para ver reportes',
        como({ uid: vendGuds, empresa: guds.id }, `select public.estado_historico_profit()::text`));
      await caso('Profit: un vendedor no puede guardar equivalencias', 'Solo administración',
        como({ uid: vendGuds, empresa: guds.id }, `select public.guardar_profit_vendedores('[{"id":"00000000-0000-0000-0000-000000000000","vendedor_odoo":null}]'::jsonb)::text`));
    }
    // Cliente del portal: uno real o, si no hay, un perfil de cliente temporal dentro del bloque (se deshace con él)
    const cliReal = (await sql(`select auth_id from usuarios where role = 'cliente' and auth_id is not null and cliente_id is not null and activo limit 1`))[0]?.auth_id;
    const authLibre = cliReal ? null : (await sql(`select a.id from auth.users a where not exists (select 1 from usuarios u where u.auth_id = a.id) limit 1`))[0]?.id;
    const cliUid = cliReal || authLibre;
    if (cliUid) {
      const previoCli = authLibre ? `insert into public.usuarios (auth_id, email, nombre, role, cliente_id, activo)
        values ('${authLibre}', 'prueba-20g@guds.test', 'Prueba 20g', 'cliente', '${cliGuds}', true);` : '';
      await caso('Profit: un cliente no lee ventas_historicas', (r, err) => r?.n === 0 || /permission denied/.test(err || ''),
        como({ uid: cliUid, empresa: guds.id, previo: previoCli }, cuentaHist));
    }
    await caso('Profit: anónimo no lee el histórico', 'permission denied', como({ rol: 'anon', uid: null, empresa: guds.id }, cuentaHist));
    await caso('Profit: el admin en GUDS lee solo el histórico de GUDS', (r) => r?.n > 0 && r?.otras === 0,
      como(E, `select row_to_json(t)::text from (select count(*) n, count(*) filter (where empresa_id <> '${guds.id}') otras from public.ventas_historicas) t`));
    await caso('Profit: el costo de referencia no se lee por la API', 'permission denied',
      como(E, `select sum(costo_usd)::text from public.ventas_historicas`));

    // Nadie modifica el histórico por la API (ni con una función security definer)
    const idLinea = (await sql(`select id from ventas_historicas where lote = ${lote} and empresa_id = '${guds.id}' limit 1`))[0].id;
    await caso('Profit: el admin no puede editar una línea del histórico', 'permission denied',
      como(E, `with x as (update public.ventas_historicas set neto_usd = 0 where id = ${idLinea} returning id) select row_to_json(x)::text from x`));
    await caso('Profit: el admin no puede borrar el histórico', 'permission denied',
      como(E, `with x as (delete from public.ventas_historicas where id = ${idLinea} returning id) select row_to_json(x)::text from x`));
    await caso('Profit: ni una función security definer escribe en el histórico', 'solo lectura',
      como({ empresa: guds.id, previo: `create function pg_temp.tocar_hist(p bigint) returns int language sql security definer as 'update public.ventas_historicas set neto_usd = neto_usd where id = p returning 1';` },
        `select row_to_json(t)::text from (select pg_temp.tocar_hist(${idLinea}) n) t`));
    await caso('Profit: nadie edita las equivalencias directamente (solo con la función)', 'permission denied',
      como(E, `with x as (update public.profit_vendedores set vendedor_odoo = 'X' returning id) select row_to_json(x)::text from x`));

    // El reporte suma Odoo + Profit y la venta de Odoo no cambia (mayo 2026 tiene las dos fuentes)
    const rep = (fuente, desde, hasta, emp = 'todas') => valor(`select row_to_json(t)::text from (select coalesce(round(sum(neto_usd), 2), 0) neto,
      coalesce(round(sum(profit_usd), 2), 0) profit, coalesce(round(sum(financieras_usd), 2), 0) fin, count(*) filas
      from public.reporte_ventas('${desde}', '${hasta}', 'empresa', '${fuente}')) t`, emp);
    const [ambas, odoo, profit] = [await rep('ambas', '2026-05-01', '2026-05-31'), await rep('odoo', '2026-05-01', '2026-05-31'), await rep('profit', '2026-05-01', '2026-05-31')];
    await caso('Profit: el reporte de mayo 2026 suma Odoo + Profit', (r) => Math.abs(Number(r.ambas.neto) - Number(r.odoo.neto) - Number(r.profit.neto)) < 0.02
      && Number(r.profit.neto) > 0 && Number(r.odoo.neto) !== 0 && Math.abs(Number(r.ambas.profit) - Number(r.profit.neto)) < 0.02, resuelto({ ambas, odoo, profit }));
    const odooDirecto = Number((await sql(`with rev as (select fa.id f, nc.id n from facturas nc join facturas fa on fa.id = nc.factura_origen_id
        where nc.tipo = 'nota_credito' and fa.tipo = 'factura' and nc.estado = 'posted' and fa.estado = 'posted'
          and fa.moneda is not distinct from nc.moneda and abs(abs(nc.total) - abs(fa.total)) < 0.01)
      select coalesce(round(sum(case when total<>0 then subtotal*total_usd/total end),2),0) n from facturas
      where estado='posted' and tipo in ('factura','nota_credito') and not es_saldo_inicial and not coalesce(es_nota_debito,false)
        and fecha_emision between '2026-05-01' and '2026-05-31' and id not in (select f from rev union select n from rev)`))[0].n);
    await caso('Profit: la venta de Odoo no cambia al agregar Profit (mayo 2026)', (r) => Math.abs(Number(r.odoo.neto) - r.directo) < 0.02
      && Math.abs(Number(r.ambas.neto) - Number(r.ambas.profit) - r.directo) < 0.02, resuelto({ odoo, ambas, directo: odooDirecto }));
    const venta2025 = (await sql(`select e.nombre_corto, round(sum(neto_usd) filter (where tratamiento = 'venta'), 2) venta,
      round(sum(neto_usd) filter (where tratamiento = 'financiera'), 2) fin from ventas_historicas v join empresas e on e.id = v.empresa_id
      where lote = ${lote} and fecha between '2025-01-01' and '2025-12-31' group by 1`));
    const esperado = (emp) => venta2025.find((x) => x.nombre_corto === emp);
    await caso('Profit: 2025 en GUDS = facturas − devoluciones de Profit, con las notas financieras aparte', (r) => Number(r.rep.neto) === Number(r.esp.venta)
      && Number(r.rep.fin) === Number(r.esp.fin) && r.rep.filas === 1, resuelto({ rep: await rep('ambas', '2025-01-01', '2025-12-31', guds.id), esp: esperado('GUDS') }));
    await caso('Profit: una fuente no válida se rechaza', 'Fuente no válida',
      como(E, `select count(*)::text from public.reporte_ventas('2025-01-01', '2025-12-31', 'mes', 'otra')`));
    await caso('Profit: los reversos del histórico aparecen con su fuente', (r) => r?.profit > 0 && r?.fuera === 0,
      como({ empresa: 'todas' }, `select row_to_json(t)::text from (select count(*) filter (where fuente = 'profit') profit,
        count(*) filter (where fuente = 'profit' and not (factura_fecha between '2025-01-01' and '2025-12-31' or nota_fecha between '2025-01-01' and '2025-12-31')) fuera
        from public.reporte_reversos('2025-01-01', '2025-12-31')) t`));

    // Equivalencias de vendedores: solo administración y en la empresa activa (el bloque se deshace: no queda validado)
    const pv = (await sql(`select id, vendedor_odoo from profit_vendedores where empresa_id = '${guds.id}' and vendedor_odoo is not null limit 1`))[0];
    if (pv) {
      const cambio = lit(JSON.stringify([{ id: pv.id, vendedor_odoo: pv.vendedor_odoo }]));
      await caso('Profit: en "Ambas" no se editan equivalencias', 'Modo consulta',
        como({ empresa: 'todas' }, `select public.guardar_profit_vendedores(${cambio}::jsonb)::text`));
      const previoValidar = `create function pg_temp.p20g_validar(p jsonb, v uuid) returns text language plpgsql as $f$
        declare n int; r text;
        begin
          n := public.guardar_profit_vendedores(p);
          select row_to_json(t)::text into r from (select n, estado, revisado_por is not null quien from public.profit_vendedores where id = v) t;
          return r;
        end $f$;`;
      await caso('Profit: el admin valida una equivalencia en su empresa', (r) => r?.n === 1 && r?.estado === 'validado' && r?.quien,
        como({ empresa: guds.id, previo: previoValidar }, `select pg_temp.p20g_validar(${cambio}::jsonb, '${pv.id}')`));
      await caso('Profit: no se asigna un vendedor que no existe en Odoo', 'no existe en Odoo',
        como(E, `select public.guardar_profit_vendedores(${lit(JSON.stringify([{ id: pv.id, vendedor_odoo: 'NADIE INVENTADO' }]))}::jsonb)::text`));
    }
    await caso('Profit: las funciones de carga no se ejecutan desde la API', (r) => r?.n === 0,
      como({}, `select row_to_json(t)::text from (select count(*) n from pg_proc p where p.pronamespace = 'public'::regnamespace
        and p.proname in ('profit_iniciar_carga', 'profit_publicar_carga', 'profit_emparejar', 'profit_proponer_vendedores', 'profit_parejas_clientes',
          'profit_parejas_productos', 'profit_palabras', 'trg_ventas_historicas_solo_lectura')
        and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) t`));
  }
}

// ── Catálogo del portal (20k): paginado en el servidor, ligado al cliente y a su empresa, sin costo ──
{
  // Cliente del portal: uno real con ficha en su empresa o, si no hay, un perfil temporal dentro del bloque (se deshace con él)
  const real = (await sql(`select u.auth_id, c.empresa_id from usuarios u join clientes c on c.id = u.cliente_id
    join usuario_empresas ue on ue.usuario_id = u.id and ue.empresa_id = c.empresa_id
    where u.role = 'cliente' and u.activo and u.auth_id is not null limit 1`))[0];
  const libre = real ? null : (await sql(`select a.id from auth.users a where not exists (select 1 from usuarios u where u.auth_id = a.id) limit 1`))[0]?.id;
  const uid20k = real?.auth_id ?? libre;
  const emp20k = real?.empresa_id ?? guds.id;
  const otra20k = emp20k === guds.id ? qrt.id : guds.id;
  const previo20k = libre ? `insert into public.usuarios (auth_id, email, nombre, role, cliente_id, activo)
    values ('${libre}', 'prueba-20k@guds.test', 'Prueba 20k', 'cliente', '${cliGuds}', true);` : '';
  const resuelto20k = (obj) => Promise.resolve(obj.error ? obj : { ok: JSON.stringify(obj) });
  if (uid20k) {
    const Cli = { uid: uid20k, empresa: emp20k, previo: previo20k };
    const esperados = (await sql(`select id from productos where activo and coalesce(vendible, true) and not coalesce(oculto_tienda, false)
      and (empresa_id = '${emp20k}' or empresa_id is null)`)).map((x) => x.id);
    const r = await como(Cli, `select row_to_json(t)::text from (select (j->>'total')::int total,
        (select array_agg(x->>'id') from jsonb_array_elements(j->'productos') x) ids, position('"costo"' in j::text) > 0 con_costo
      from (select public.catalogo_portal(null, null, 'nombre', 100, 0) j) s) t`);
    const v = r.ok ? JSON.parse(r.ok) : null;
    await caso('Catálogo 20k: un cliente recibe solo los productos a la venta de su empresa, sin costo', (x) => x.total === x.esperados
      && x.ajenos === 0 && x.total > 0 && x.con_costo === false,
      resuelto20k(r.error ? r : { total: v.total, esperados: esperados.length, ajenos: (v.ids ?? []).filter((id) => !esperados.includes(id)).length, con_costo: v.con_costo }));
    await caso('Catálogo 20k: pedir la otra empresa (no habilitada) no devuelve su catálogo', 'Selecciona una empresa',
      como({ ...Cli, empresa: otra20k }, `select public.catalogo_portal()::text`));
    const ajeno = (await sql(`select id from productos where activo and empresa_id = '${otra20k}' limit 1`))[0]?.id;
    if (ajeno) {
      await caso('Catálogo 20k: la ficha de un producto de otra empresa no se ve', (x) => x === null,
        como(Cli, `select public.producto_portal('${ajeno}')::text`));
    }
    // Búsqueda sin acentos: un nombre con tilde o ñ se encuentra escrito sin ella (y en mayúsculas)
    const conTilde = (await sql(`select id, nombre from productos where activo and coalesce(vendible, true) and not coalesce(oculto_tienda, false)
      and empresa_id = '${emp20k}' and nombre ~ '[ÁÉÍÓÚÑáéíóúñ]' limit 1`))[0];
    if (conTilde) {
      const palabra = conTilde.nombre.split(/\s+/).find((w) => /[ÁÉÍÓÚÑáéíóúñ]/.test(w));
      const sinTilde = palabra.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      await caso(`Catálogo 20k: buscar "${sinTilde}" (sin acento) encuentra «${palabra}»`, (x) => x?.ok === true,
        como(Cli, `select row_to_json(t)::text from (select exists (select 1 from jsonb_array_elements(public.catalogo_portal(${lit(sinTilde)}, null, 'relevancia', 100, 0)->'productos') x
          where x->>'id' = '${conTilde.id}') ok) t`));
    }
    const conSku = (await sql(`select id, sku from productos where activo and coalesce(vendible, true) and not coalesce(oculto_tienda, false)
      and empresa_id = '${emp20k}' and sku is not null and sku <> '' limit 1`))[0];
    if (conSku) {
      await caso('Catálogo 20k: buscar por código (SKU) lo pone primero', (x) => x?.primero === conSku.id,
        como(Cli, `select row_to_json(t)::text from (select public.catalogo_portal(${lit(conSku.sku)})->'productos'->0->>'id' primero) t`));
    }
    await caso('Catálogo 20k: el precio de la página es precio_efectivo del cliente', (x) => x?.distintos === 0 && x?.n > 0,
      como(Cli, `select row_to_json(t)::text from (select count(*) n, count(*) filter (where (x->>'precio')::numeric
          is distinct from public.precio_efectivo((x->>'id')::uuid, nullif(x->'producto_empaques'->0->>'tipo_empaque_id', '')::uuid, public.mi_cliente_id())) distintos
        from jsonb_array_elements(public.catalogo_portal(null, null, 'relevancia', 100, 0)->'productos') x) t`));
    await caso('Catálogo 20k: un orden no válido se rechaza', 'Orden no válido',
      como(Cli, `select public.catalogo_portal(null, null, 'costo')::text`));
  }
  await caso('Catálogo 20k: un anónimo no ejecuta catalogo_portal', 'permission denied',
    como({ rol: 'anon', uid: null, empresa: guds.id }, `select public.catalogo_portal()::text`));
  await caso('Catálogo 20k: un anónimo no ejecuta la ficha ni las categorías', (x) => x?.n === 0,
    como({}, `select row_to_json(t)::text from (select count(*) n from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('producto_portal', 'categorias_portal', 'catalogo_portal') and has_function_privilege('anon', p.oid, 'execute')) t`));
  await caso('Catálogo 20k: las funciones internas no se ejecutan por la API', (x) => x?.n === 0,
    como({}, `select row_to_json(t)::text from (select count(*) n from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('portal_contexto', 'portal_producto_item')
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) t`));
  await caso('Catálogo 20k: el personal (no cliente) no usa el catálogo del portal', 'solo para clientes',
    como(E, `select public.catalogo_portal()::text`));
}

// ── Costo de Odoo y motor de reportes tipo cubo (20j): permiso de reportes, costo solo para administración, totales ──
{
  const P = `'2025-01-01', '2026-09-28'`;
  const valor = async (q, empresa = guds.id, extra = {}) => { const r = await como({ empresa, ...extra }, q); return r.ok ? JSON.parse(r.ok) : { error: r.error }; };
  const resuelto = (obj) => Promise.resolve(obj.error ? obj : { ok: JSON.stringify(obj) });
  const [cob] = await sql(`select count(*) filter (where costo > 0 and empresa_id = '${guds.id}') guds, count(*) filter (where costo > 0 and empresa_id = '${qrt.id}') qrt from producto_costos`);
  casos.push({ ok: cob.guds > 0 && cob.qrt > 0 ? '✓' : '✗', caso: 'Costo: el importador trae el costo de Odoo de cada empresa', resultado: JSON.stringify(cob) });
  await caso('Costo: sin sesión no se lee el costo de los productos', 'permission denied',
    como({ rol: 'anon', uid: null, empresa: guds.id }, `select count(*)::text from public.producto_costos`));
  await caso('Costo: productos.costo queda vacío aunque se escriba (el catálogo es público)', (r) => r && r.costo === null,
    como(E, upd('productos', `costo = 5`, prodOdoo, 'costo')));
  await caso('Costo: el costo del resumen de Profit no se lee por la API', 'permission denied',
    como(E, `select sum(costo_usd)::text from public.profit_documentos`));
  if (vendGuds) {
    await caso('Cubo: un vendedor sin el permiso "reportes" no ejecuta el motor', 'permiso para ver reportes',
      como({ uid: vendGuds, empresa: guds.id }, `select count(*)::text from public.reporte_ventas_cubo(${P}, array['vendedor'])`));
    await caso('Cubo: un vendedor sin el permiso "reportes" no ejecuta la versión compacta (pantalla)', 'permiso para ver reportes',
      como({ uid: vendGuds, empresa: guds.id }, `select public.reporte_ventas_cubo_json(${P}, array['vendedor'])::text`));
    await caso('Cubo: un vendedor sin el permiso "reportes" no descarga el detalle de líneas', 'permiso para ver reportes',
      como({ uid: vendGuds, empresa: guds.id }, `select count(*)::text from public.reporte_ventas_lineas('2026-04-01', '2026-04-30')`));
    await caso('Costo: un vendedor no lee producto_costos', (r) => r?.n === 0,
      como({ uid: vendGuds, empresa: guds.id }, `select row_to_json(t)::text from (select count(*) n from public.producto_costos) t`));
    // Usuario con permiso de reportes pero sin rol de administración: el rol del vendedor recibe "reportes: ver" dentro del
    // bloque (se deshace al terminar)
    const previoRep = `insert into public.permisos (rol_id, modulo_id, puede_ver) select u.rol_id, m.id, true from public.usuarios u, public.modulos m
      where u.auth_id = '${vendGuds}' and m.codigo = 'reportes' on conflict (rol_id, modulo_id) do update set puede_ver = true;`;
    await caso('Cubo: un usuario de reportes sin rol de administración no ve el costo ni el margen', (r) => r?.filas > 1 && r.venta > 0
      && r.con_costo === 0 && r.ve_costo === false && r.detalle > 0 && r.detalle_costo === 0 && r.tabla === 0
      && r.json_ve_costo === false && r.json_filas > 1 && r.json_costo === 0,
      como({ uid: vendGuds, empresa: guds.id, previo: previoRep }, `select row_to_json(t)::text from (select count(*) filas,
        max(venta_usd) filter (where nivel = 0) venta,
        count(*) filter (where costo_usd is not null or venta_con_costo_usd is not null or margen_usd is not null or margen_pct is not null or cobertura_costo_pct is not null) con_costo,
        bool_or(ve_costo) ve_costo,
        (select count(*) from public.reporte_ventas_lineas('2026-04-01', '2026-04-30')) detalle,
        (select count(*) from public.reporte_ventas_lineas('2026-04-01', '2026-04-30') where ultimo_costo_usd is not null or costo_usd is not null or rentabilidad_usd is not null) detalle_costo,
        (select count(*) from public.producto_costos) tabla,
        (select (j ->> 've_costo')::boolean from (select public.reporte_ventas_cubo_json(${P}, array['categoria', 'producto']) j) x) json_ve_costo,
        (select json_array_length(j -> 'filas') from (select public.reporte_ventas_cubo_json(${P}, array['categoria', 'producto']) j) x) json_filas,
        (select count(*) from (select public.reporte_ventas_cubo_json(${P}, array['categoria', 'producto']) j) x, json_array_elements(x.j -> 'filas') e
          where coalesce(e ->> 17, e ->> 18, e ->> 19, e ->> 20, e ->> 21) is not null) json_costo
        from public.reporte_ventas_cubo(${P}, array['categoria', 'producto'])) t`));
  }
  await caso('Cubo: administración sí ve costo y margen (sin costo no hay margen)', (r) => r?.ve_costo === true && r.con_margen > 0 && r.margen_sin_costo === 0,
    como(E, `select row_to_json(t)::text from (select bool_or(ve_costo) ve_costo, count(*) filter (where margen_pct is not null) con_margen,
      count(*) filter (where margen_pct is not null and coalesce(venta_con_costo_usd, 0) <= 0) margen_sin_costo
      from public.reporte_ventas_cubo(${P}, array['producto'])) t`));

  // El total del motor = reporte_ventas en el mismo período y fuente (por documento: exacto; por línea: redondeo por grupo)
  const totales = async (fuente) => valor(`select row_to_json(t)::text from (select
      (select round(sum(neto_usd), 2) from public.reporte_ventas(${P}, 'empresa', '${fuente}')) rv,
      (select round(sum(financieras_usd), 2) from public.reporte_ventas(${P}, 'empresa', '${fuente}')) rv_fin,
      (select round(sum(neto_usd), 2) from public.reporte_ventas(${P}, 'producto', '${fuente}', false)) rv_lineas,
      (select round(venta_usd, 2) from public.reporte_ventas_cubo(${P}, array['vendedor', 'cliente'], '${fuente}') where nivel = 0) cubo,
      (select round(financieras_usd, 2) from public.reporte_ventas_cubo(${P}, array['vendedor', 'cliente'], '${fuente}') where nivel = 0) cubo_fin,
      (select round(venta_usd, 2) from public.reporte_ventas_cubo(${P}, array['categoria', 'producto'], '${fuente}', '{}', null, false) where nivel = 0) cubo_lineas) t`);
  const tt = { ambas: await totales('ambas'), odoo: await totales('odoo'), profit: await totales('profit') };
  await caso('Cubo: el total del motor es igual a reporte_ventas (mismo período y fuente)', (r) => Object.values(r).every((x) =>
    x.rv !== null && Number(x.cubo) === Number(x.rv) && Number(x.cubo_fin) === Number(x.rv_fin) && Math.abs(Number(x.cubo_lineas) - Number(x.rv_lineas)) < 0.5)
    && Number(r.ambas.cubo) > 0 && Math.abs(Number(r.ambas.cubo) - Number(r.odoo.cubo) - Number(r.profit.cubo)) < 0.02, resuelto(tt));

  // La suma de los subtotales de cada nivel es igual al total (unidades y costo también), y en la matriz la suma de las columnas
  await caso('Cubo: la suma de los subtotales es igual al total', (r) => r && [r.n1, r.n2, r.n3, r.u1, r.u3, r.c3, r.m].every((d) => d !== null && Math.abs(Number(d)) < 0.005) && r.filas > 10,
    como(E, `select row_to_json(t)::text from (select count(*) filas,
      sum(venta_usd) filter (where nivel = 1) - max(venta_usd) filter (where nivel = 0) n1,
      sum(venta_usd) filter (where nivel = 2) - max(venta_usd) filter (where nivel = 0) n2,
      sum(venta_usd) filter (where nivel = 3) - max(venta_usd) filter (where nivel = 0) n3,
      sum(unidades) filter (where nivel = 1) - max(unidades) filter (where nivel = 0) u1,
      sum(unidades) filter (where nivel = 3) - max(unidades) filter (where nivel = 0) u3,
      sum(costo_usd) filter (where nivel = 3) - max(costo_usd) filter (where nivel = 0) c3,
      (select sum(venta_usd) filter (where nivel = 0 and col is not null) - max(venta_usd) filter (where nivel = 0 and col is null)
       from public.reporte_ventas_cubo(${P}, array['anio'], 'ambas', '{}', 'mes')) m
      from public.reporte_ventas_cubo(${P}, array['categoria', 'linea', 'producto'])) t`));
  // Los caminos rápidos (resumen mensual de Profit, sin conteos) dan lo mismo que recorrer las líneas (con conteos)
  await caso('Cubo: el resumen mensual de Profit cuadra con las líneas (venta, unidades y costo)', (r) => r?.filas_m > 10 && r.filas_m === r.filas_l
    && Number(r.venta_m) === Number(r.venta_l) && Number(r.und_m) === Number(r.und_l) && Number(r.costo_m) === Number(r.costo_l),
    como({ empresa: 'todas' }, `select row_to_json(t)::text from (select
      (select count(*) from public.reporte_ventas_cubo(${P}, array['categoria', 'producto'], 'ambas', '{}', null, false)) filas_m,
      (select count(*) from public.reporte_ventas_cubo(${P}, array['categoria', 'producto'], 'ambas', '{}', null, true)) filas_l,
      (select round(venta_usd, 4) from public.reporte_ventas_cubo(${P}, array['categoria', 'producto'], 'ambas', '{}', null, false) where nivel = 0) venta_m,
      (select round(venta_usd, 4) from public.reporte_ventas_cubo(${P}, array['categoria', 'producto'], 'ambas', '{}', null, true) where nivel = 0) venta_l,
      (select unidades from public.reporte_ventas_cubo(${P}, array['categoria', 'producto'], 'ambas', '{}', null, false) where nivel = 0) und_m,
      (select unidades from public.reporte_ventas_cubo(${P}, array['categoria', 'producto'], 'ambas', '{}', null, true) where nivel = 0) und_l,
      (select round(costo_usd, 4) from public.reporte_ventas_cubo(${P}, array['categoria', 'producto'], 'ambas', '{}', null, false) where nivel = 0) costo_m,
      (select round(costo_usd, 4) from public.reporte_ventas_cubo(${P}, array['categoria', 'producto'], 'ambas', '{}', null, true) where nivel = 0) costo_l) t`));
  await caso('Cubo: los filtros cruzados dan la misma cifra que la celda del cubo', (r) => r?.celda !== undefined && Number(r.filtrado) === Number(r.celda) && Number(r.celda) !== 0,
    como(E, `with c as (select k1, k2, venta_usd from public.reporte_ventas_cubo(${P}, array['vendedor', 'categoria']) where nivel = 2 and k1 <> '' and k2 <> '' order by venta_usd desc limit 1)
      select row_to_json(t)::text from (select (select round(venta_usd, 6) from c) celda,
        (select round(venta_usd, 6) from public.reporte_ventas_cubo(${P}, array[]::text[], 'ambas',
          jsonb_build_object('vendedor', jsonb_build_array((select k1 from c)), 'categoria', jsonb_build_array((select k2 from c))))) filtrado) t`));
  await caso('Cubo: un nivel no válido se rechaza (no se arma SQL con él)', 'Nivel no válido',
    como(E, `select count(*)::text from public.reporte_ventas_cubo(${P}, array['categoria; select 1'])`));
  await caso('Cubo: un filtro no válido se rechaza', 'Filtro no válido',
    como(E, `select count(*)::text from public.reporte_ventas_cubo(${P}, array['categoria'], 'ambas', '{"costo": ["1"]}')`));
  await caso('Cubo: las funciones auxiliares no se ejecutan desde la API', (r) => r?.n === 0,
    como({}, `select row_to_json(t)::text from (select count(*) n from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('cubo_dimension_sql', 'cubo_dimensiones_documento', 'cubo_etiqueta_sql', 'cubo_busqueda_sql', 'cubo_base_sql',
        'cubo_base_docs_sql', 'cubo_base_mensual_sql', 'cubo_filtros_sql', 'trg_producto_sin_costo', 'profit_publicar_carga', 'profit_emparejar',
        'profit_resumir_articulos_mes')
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) t`));
  await caso('Cubo: sin sesión no se ejecuta', 'permission denied',
    como({ rol: 'anon', uid: null, empresa: guds.id }, `select count(*)::text from public.reporte_ventas_cubo(${P}, array['vendedor'])`));
}

// ── Finanzas y cuenta del portal (20m): estado de cuenta ligado al cliente, facturas propias, ejecutivo sin datos de más ──
{
  // Cliente real con facturas vivas y vendedor asignado; el perfil temporal (auth de qa.cliente) vive solo dentro del bloque
  const qa20m = (await sql(`select id from auth.users where email = 'qa.cliente@guds.test'`))[0]?.id;
  const c20m = (await sql(`select c.id, c.empresa_id, c.vendedor_asignado_id from clientes c
    where c.empresa_id is not null and c.vendedor_asignado_id is not null
      and exists (select 1 from facturas f where f.cliente_id = c.id and f.estado = 'posted' and f.saldo_usd > 0.009)
      and exists (select 1 from facturas f where f.cliente_id = c.id and f.estado = 'posted' and f.saldo_usd < -0.009)
    order by c.codigo limit 1`))[0];
  const resuelto20m = (obj) => Promise.resolve(obj.error ? obj : { ok: JSON.stringify(obj) });
  if (qa20m && c20m) {
    const Cli = { uid: qa20m, empresa: c20m.empresa_id,
      previo: `insert into public.usuarios (auth_id, email, nombre, role, cliente_id, activo) values ('${qa20m}', 'qa.cliente@guds.test', 'QA', 'cliente', '${c20m.id}', true);` };
    await caso('Estado de cuenta 20m: movimientos solo con documentos del cliente que llama', (x) => x?.n > 0 && x?.ajenos === 0 && x?.cliente === c20m.id,
      como(Cli, `select row_to_json(t)::text from (select count(*) n,
          count(*) filter (where m->>'factura_id' is not null and not exists (select 1 from facturas f where f.id = (m->>'factura_id')::uuid and f.cliente_id = '${c20m.id}')) ajenos,
          (select public.estado_cuenta_portal()->'cliente'->>'id') cliente
        from jsonb_array_elements(public.estado_cuenta_portal()->'movimientos') m) t`));
    // Mismo saldo que Cuentas por Cobrar del admin: facturas publicadas de su empresa con saldo positivo; a favor = negativos
    const esperado20m = (await sql(`select round(coalesce(sum(saldo_usd) filter (where saldo_usd > 0.009), 0), 2)::float8 saldo,
        round(coalesce(-sum(saldo_usd) filter (where saldo_usd < -0.009), 0), 2)::float8 nc
      from facturas where cliente_id = '${c20m.id}' and estado = 'posted' and (empresa_id is null or empresa_id = '${c20m.empresa_id}')`))[0];
    const r20m = await como(Cli, `select (public.estado_cuenta_portal()->'resumen' || jsonb_build_object('diferencia', public.estado_cuenta_portal()->'diferencia',
      'saldo_final', public.estado_cuenta_portal()->'saldo_final'))::text`);
    const v20m = r20m.ok ? JSON.parse(r20m.ok) : null;
    await caso('Estado de cuenta 20m: saldo y a favor = regla de CxC del admin; el libro cuadra con el saldo neto', (x) => x?.ok === true,
      resuelto20m(r20m.error ? r20m : { ok: Number(v20m.saldo) === esperado20m.saldo && Number(v20m.nc_a_favor) === esperado20m.nc
        && Number(v20m.diferencia) === 0 && Number(v20m.saldo_final) === Number(v20m.neto),
        saldo: v20m.saldo, esperado: esperado20m.saldo, neto: v20m.neto, final: v20m.saldo_final }));
    await caso('Estado de cuenta 20m: la antigüedad suma el saldo (por vencer + vencido)', (x) => x?.ok === true,
      resuelto20m(r20m.error ? r20m : { ok: Math.abs(Number(v20m.por_vencer) + Number(v20m.d1_30) + Number(v20m.d31_60) + Number(v20m.d61_90) + Number(v20m.mas_90) - Number(v20m.saldo)) < 0.011
        && Math.abs(Number(v20m.por_vencer) + Number(v20m.vencido) - Number(v20m.saldo)) < 0.011 }));
    const propia = (await sql(`select id from facturas where cliente_id = '${c20m.id}' and estado = 'posted' limit 1`))[0].id;
    const ajena = (await sql(`select id from facturas where cliente_id <> '${c20m.id}' and empresa_id = '${c20m.empresa_id}' limit 1`))[0].id;
    await caso('Factura 20m: la ficha de una factura propia sí; la de otro cliente devuelve nada', (x) => x?.propia === propia && x?.ajena === null,
      como(Cli, `select json_build_object('propia', public.factura_portal('${propia}')->>'id', 'ajena', public.factura_portal('${ajena}'))::text`));
    const vend20m = (await sql(`select nullif(btrim(concat_ws(' ', nombre, apellido)), '') n from usuarios where id = '${c20m.vendedor_asignado_id}'`))[0]?.n;
    await caso('Ejecutivo 20m: mi_ejecutivo() da solo nombre, teléfono y WhatsApp del vendedor de su propio cliente', (x) =>
      x && Object.keys(x).sort().join(',') === 'nombre,telefono,whatsapp' && x.nombre === vend20m,
      como(Cli, `select public.mi_ejecutivo()::text`));
    // Con otra ficha (otro vendedor), la misma llamada responde por esa ficha: no hay forma de pedir el de otro cliente
    const otro20m = (await sql(`select c.id, c.empresa_id, nullif(btrim(concat_ws(' ', u.nombre, u.apellido)), '') n from clientes c join usuarios u on u.id = c.vendedor_asignado_id
      where c.vendedor_asignado_id <> '${c20m.vendedor_asignado_id}' and c.empresa_id is not null limit 1`))[0];
    if (otro20m) {
      await caso('Ejecutivo 20m: un cliente no ve el ejecutivo de otro (la función no recibe parámetros)', (x) => x?.nombre === otro20m.n && x?.nombre !== vend20m
        && x?.args === '',
        como({ uid: qa20m, empresa: otro20m.empresa_id,
          previo: `insert into public.usuarios (auth_id, email, nombre, role, cliente_id, activo) values ('${qa20m}', 'qa.cliente@guds.test', 'QA', 'cliente', '${otro20m.id}', true);` },
          `select (public.mi_ejecutivo() || jsonb_build_object('args', (select pg_get_function_identity_arguments('public.mi_ejecutivo'::regproc))))::text`));
    }
    await caso('Retenciones 20m: un cliente no declara sobre la ficha de otro cliente', 'No tienes acceso a este cliente',
      como(Cli, `select public.declarar_retencion('${otro20m?.id ?? cliGuds}', 'iva', '[]'::jsonb)::text`));
  }
  await caso('Estado de cuenta 20m: un anónimo no ejecuta estado_cuenta_portal', 'permission denied',
    como({ rol: 'anon', uid: null, empresa: guds.id }, `select public.estado_cuenta_portal()::text`));
  await caso('Estado de cuenta 20m: un anónimo no ejecuta la ficha de factura ni el ejecutivo', (x) => x?.n === 0,
    como({}, `select row_to_json(t)::text from (select count(*) n from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('estado_cuenta_portal', 'factura_portal', 'mi_ejecutivo', 'portal_cliente_contexto') and has_function_privilege('anon', p.oid, 'execute')) t`));
  await caso('Estado de cuenta 20m: la función interna de contexto no se ejecuta por la API', (x) => x?.n === 0,
    como({}, `select row_to_json(t)::text from (select count(*) n from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname = 'portal_cliente_contexto' and has_function_privilege('authenticated', p.oid, 'execute')) t`));
  if (vendGuds) {
    await caso('Estado de cuenta 20m: un vendedor no ejecuta el estado de cuenta del portal', 'solo para clientes del portal',
      como({ uid: vendGuds, empresa: guds.id }, `select public.estado_cuenta_portal()::text`));
    await caso('Ejecutivo 20m: un vendedor no ejecuta mi_ejecutivo', 'solo para clientes del portal',
      como({ uid: vendGuds, empresa: guds.id }, `select public.mi_ejecutivo()::text`));
  }
  await caso('Estado de cuenta 20m: el personal de administración no usa el estado de cuenta del portal', 'solo para clientes del portal',
    como(E, `select public.estado_cuenta_portal()::text`));
}

// ── Portal del vendedor V2–V5 (20o): catálogo, pedido idempotente, ficha y cartera, cobro con evidencia, metas ──
{
  // Un vendedor activo con un cliente activo de GUDS que tenga facturas con saldo (y otro cliente ajeno con factura)
  const v = (await sql(`select u.auth_id, u.id usuario, c.id cliente, f.id factura, f.saldo_usd
    from usuarios u join clientes c on c.vendedor_asignado_id = u.id and c.activo and c.empresa_id = '${guds.id}'
    join facturas f on f.cliente_id = c.id and f.estado = 'posted' and f.tipo = 'factura' and f.saldo_usd > 1
    where u.role = 'vendedor' and coalesce(u.activo, true) and u.auth_id is not null
    order by f.saldo_usd desc limit 1`))[0];
  const ajena = v && (await sql(`select f.id, f.cliente_id from facturas f join clientes c on c.id = f.cliente_id
    where f.estado = 'posted' and f.tipo = 'factura' and f.saldo_usd > 1 and c.empresa_id = '${guds.id}'
      and c.vendedor_asignado_id is distinct from '${v.usuario}' limit 1`))[0];
  const otroV = v && (await sql(`select u.auth_id, u.id usuario, c.id cliente from usuarios u join clientes c on c.vendedor_asignado_id = u.id and c.activo
    where u.role = 'vendedor' and u.auth_id is not null and u.id <> '${v.usuario}' limit 1`))[0];
  const bancoBs = (await sql(`select id from bancos where empresa_id = '${guds.id}' and activo and visible_portal and moneda = 'BS' limit 1`))[0]?.id;
  const prodV = (await sql(`select id, sku from productos where empresa_id = '${guds.id}' and activo and coalesce(vendible, true) and controla_stock
    and stock_disponible > 50 and sku is not null limit 1`))[0];
  if (v && ajena && bancoBs && prodV) {
    const E = { uid: v.auth_id, empresa: guds.id };
    const claimsJ = (uid) => JSON.stringify({ sub: uid, role: 'authenticated' }).replace(/'/g, "''");
    const hdrJ = JSON.stringify({ 'x-empresa-id': guds.id }).replace(/'/g, "''");
    const comoU = (uid) => `perform set_config('request.jwt.claims', '${claimsJ(uid)}', true); perform set_config('request.headers', '${hdrJ}', true);`;

    // V2 · catálogo y pedido
    await caso('Vendedor 20o: catálogo del cliente de su cartera, con precio del cliente y sin costo', (r) => r?.n > 0 && r.costo === false && r.precio === true,
      como(E, `select row_to_json(t)::text from (select jsonb_array_length(x->'productos') n, (x::text like '%"costo"%') costo,
        (x->'productos'->0 ? 'precio') precio from (select public.catalogo_vendedor('${v.cliente}') x) y) t`));
    await caso('Vendedor 20o: el catálogo no se abre para un cliente que no es de su cartera', 'no está en tu cartera',
      como(E, `select public.catalogo_vendedor('${ajena.cliente_id}')::text`));
    await caso('Vendedor 20o: el catálogo busca por código y sin mayúsculas', (r) => r?.primero === prodV.id,
      como(E, `select row_to_json(t)::text from (select public.catalogo_vendedor('${v.cliente}', lower('${prodV.sku}')) -> 'productos' -> 0 ->> 'id' primero) t`));
    await caso('Vendedor 20o: "lo que compra" solo de clientes de su cartera', 'no está en tu cartera',
      como(E, `select public.compras_cliente_vendedor('${ajena.cliente_id}')::text`));
    const items = `'[{"producto_id":"${prodV.id}","cantidad":2}]'::jsonb`;
    const clave = '00000000-0000-0000-0000-00000000c1a0';
    const pedido = `perform public.crear_orden_vendedor('${v.cliente}', 'transferencia', 'prueba-20o', ${items}, null, '${clave}');`;
    await caso('Vendedor 20o: el pedido con la misma clave no se crea dos veces (doble toque / reintento)', (r) => r?.n === 1 && r.mismo === true,
      como({ ...E, previo: `${comoU(v.auth_id)} ${pedido} perform set_config('guds.p1', (select id from ordenes where clave_idempotencia = '${clave}')::text, true);` },
        `select row_to_json(t)::text from (select (select count(*) from ordenes where clave_idempotencia = '${clave}') n,
          (select orden_id from public.crear_orden_vendedor('${v.cliente}', 'transferencia', 'prueba-20o', ${items}, null, '${clave}'))::text = current_setting('guds.p1') mismo) t`));
    if (otroV) {
      await caso('Vendedor 20o: otro vendedor no reutiliza la clave de un pedido ajeno', 'ya usada',
        como({ uid: otroV.auth_id, empresa: guds.id, previo: `${comoU(v.auth_id)} ${pedido}` },
          `select orden_id::text from public.crear_orden_vendedor('${otroV.cliente}', 'transferencia', 'x', ${items}, null, '${clave}')`));
    }

    // V3 · ficha y cartera
    await caso('Vendedor 20o: la ficha de un cliente ajeno no existe para él (null)', (r) => r === null,
      como(E, `select public.ficha_cliente_vendedor('${ajena.cliente_id}')::text`));
    await caso('Vendedor 20o: la ficha da la deuda de Cuentas por cobrar (neto = Σ saldos; tramos = saldo positivo)', (r) => r?.neto_ok && r?.tramos_ok,
      como(E, `select row_to_json(t)::text from (select
          round((f->'deuda'->>'neto')::numeric, 2) = (select round(coalesce(sum(saldo_usd), 0), 2) from facturas where cliente_id = '${v.cliente}' and estado = 'posted' and abs(saldo_usd) > 0.009) neto_ok,
          abs((select sum(value::numeric) from jsonb_each_text(f->'deuda'->'tramos')) - (f->'deuda'->>'por_cobrar')::numeric) < 0.05 tramos_ok
        from (select public.ficha_cliente_vendedor('${v.cliente}') f) x) t`));
    await caso('Vendedor 20o: la cartera suma lo mismo que resumen_vendedor (tramos)', (r) => r?.ok === true,
      como(E, `select row_to_json(t)::text from (select
          abs((select sum((c->'tramos'->>'mas_90')::numeric + (c->'tramos'->>'d61_90')::numeric + (c->'tramos'->>'d31_60')::numeric + (c->'tramos'->>'d1_30')::numeric + (c->'tramos'->>'por_vencer')::numeric)
             from jsonb_array_elements(public.cartera_vendedor()->'clientes') c)
          - (select (r->'cartera'->>'por_cobrar')::numeric from (select public.resumen_vendedor() r) z)) < 0.5 ok) t`));
    await caso('Vendedor 20o: "Hoy" cuenta los mismos pedidos por aprobar que resumen_vendedor', (r) => r?.ok === true,
      como(E, `select row_to_json(t)::text from (select (public.hoy_vendedor()->'por_aprobar'->>'n')::int = (public.resumen_vendedor()->'pedidos'->>'por_aprobar')::int ok) t`));

    // V4 · cobro con evidencia
    const ruta = `${v.usuario}/${v.cliente}/prueba-20o.jpg`;
    const objeto = `insert into storage.objects (bucket_id, name) values ('comprobantes-cobro', '${ruta}');`;
    const fecha = `(now() at time zone 'America/Caracas')::date - 3`;
    const lineas = (comp = ruta) => `jsonb_build_array(jsonb_build_object('banco_id', '${bancoBs}', 'metodo', 'transferencia', 'moneda', 'BS', 'monto', 10000,
      'referencia', 'PRUEBA-20O-REF', 'fecha_pago', ${fecha}, 'comprobante', '${comp}'))`;
    const prop = (fid, m) => `jsonb_build_array(jsonb_build_object('factura_id', '${fid}', 'monto', ${m}))`;
    const lote = '00000000-0000-0000-0000-00000000c0b0';
    const cobro = `perform public.registrar_cobro_vendedor('${v.cliente}', ${lineas()}, ${prop(v.factura, 1)}, '${lote}');`;
    await caso('Vendedor 20o: la propuesta de aplicación solo sobre facturas del cliente del pago', 'no es de este cliente',
      como({ ...E, previo: objeto }, `select public.registrar_cobro_vendedor('${v.cliente}', ${lineas()}, ${prop(ajena.id, 1)}, '${lote}')::text`));
    await caso('Vendedor 20o: sin el comprobante subido no se registra el cobro', 'comprobante no se encontró',
      como(E, `select public.registrar_cobro_vendedor('${v.cliente}', ${lineas()}, '[]'::jsonb, '${lote}')::text`));
    await caso('Vendedor 20o: el cobro en Bs usa la tasa BCV de la fecha del pago y queda pendiente con su propuesta', (r) => r?.tasa_ok && r?.estado === 'pendiente' && r?.prop === 'pendiente' && r?.n === 1,
      como({ ...E, previo: `${objeto} ${comoU(v.auth_id)} ${cobro} ${cobro}` }, `select row_to_json(t)::text from (select count(*) n,
          bool_and(tasa_cambio = public.tasa_bcv_de(fecha_pago) and monto = round(monto_moneda / tasa_cambio, 2)) tasa_ok, min(estado::text) estado, min(propuesta_estado) prop
        from pagos where lote_cobro = '${lote}') t`));
    await caso('Vendedor 20o: la misma foto no respalda dos cobros distintos', 'ya se usó en el cobro',
      como({ ...E, previo: `${objeto} ${comoU(v.auth_id)} ${cobro}` }, `select public.registrar_cobro_vendedor('${v.cliente}',
        jsonb_set(${lineas()}, '{0,referencia}', '"OTRA-REF-20O"'), '[]'::jsonb, '00000000-0000-0000-0000-00000000c0b1')::text`));
    await caso('Vendedor 20o: administración recibe el aviso "Cobro por verificar" con enlace a Pagos', (r) => r?.n >= 1,
      como({ uid: admin, empresa: guds.id, previo: `${objeto} ${comoU(v.auth_id)} ${cobro}` }, `select row_to_json(t)::text from (select count(*) n from notificaciones
        where titulo = 'Cobro por verificar' and link = '/admin/pagos' and created_at >= now() - interval '1 minute') t`));
    await caso('Vendedor 20o: un vendedor no verifica ni aplica pagos', 'No tienes permiso para verificar',
      como({ ...E, previo: `${objeto} ${comoU(v.auth_id)} ${cobro}` }, `select public.verificar_cobro_propuesta((select id from pagos where lote_cobro = '${lote}'))::text`));
    await caso('Vendedor 20o: aplicar_pago_a_facturas sigue siendo interna', (r) => r?.ok === false,
      como(E, `select row_to_json(t)::text from (select has_function_privilege('authenticated', 'public.aplicar_pago_a_facturas(uuid, jsonb)', 'execute') ok) t`));
    await caso('Vendedor 20o: administración verifica aplicando la propuesta del vendedor', (r) => r?.aplicado === 1 && r?.estado === 'verificado/aplicada',
      como({ uid: admin, empresa: guds.id, previo: `${objeto} ${comoU(v.auth_id)} ${cobro} ${comoU(admin)}
          perform public.verificar_cobro_propuesta((select id from pagos where lote_cobro = '${lote}'));` },
        `select row_to_json(t)::text from (select (select sum(monto_aplicado) from pago_facturas pf join pagos p on p.id = pf.pago_id where p.lote_cobro = '${lote}') aplicado,
          (select estado || '/' || propuesta_estado from pagos where lote_cobro = '${lote}') estado) t`));
    // Almacenamiento: carpeta del vendedor
    await caso('Vendedor 20o: no sube comprobantes a la carpeta de otro vendedor', 'row-level security',
      como(E, `with x as (insert into storage.objects (bucket_id, name) values ('comprobantes-cobro', '${otroV?.usuario ?? '00000000-0000-0000-0000-000000000000'}/${v.cliente}/x.jpg') returning name) select row_to_json(x)::text from x`));
    await caso('Vendedor 20o: no sube comprobantes para un cliente que no es suyo', 'row-level security',
      como(E, `with x as (insert into storage.objects (bucket_id, name) values ('comprobantes-cobro', '${v.usuario}/${ajena.cliente_id}/x.jpg') returning name) select row_to_json(x)::text from x`));
    await caso('Vendedor 20o: sube a su carpeta para un cliente de su cartera', (r) => r?.name === `${v.usuario}/${v.cliente}/propio.jpg`,
      como(E, `with x as (insert into storage.objects (bucket_id, name) values ('comprobantes-cobro', '${v.usuario}/${v.cliente}/propio.jpg') returning name) select row_to_json(x)::text from x`));
    if (otroV) {
      await caso('Vendedor 20o: no lee comprobantes de otros vendedores (sí los suyos)', (r) => r?.ajenos === 0 && r?.propios === 1,
        como({ uid: otroV.auth_id, empresa: guds.id, previo: `${objeto} insert into storage.objects (bucket_id, name) values ('comprobantes-cobro', '${otroV.usuario}/${otroV.cliente}/suyo.jpg');` },
          `select row_to_json(t)::text from (select count(*) filter (where name = '${ruta}') ajenos, count(*) filter (where name = '${otroV.usuario}/${otroV.cliente}/suyo.jpg') propios
            from storage.objects where bucket_id = 'comprobantes-cobro') t`));
    }
    await caso('Vendedor 20o: administración lee los comprobantes de todos', (r) => r?.n === 1,
      como({ uid: admin, empresa: guds.id, previo: objeto }, `select row_to_json(t)::text from (select count(*) n from storage.objects where bucket_id = 'comprobantes-cobro' and name = '${ruta}') t`));
    const cliPortal = (await sql(`select u.auth_id, u.cliente_id from usuarios u join clientes c on c.id = u.cliente_id
      where u.role = 'cliente' and coalesce(u.activo, true) and u.auth_id is not null and c.empresa_id = '${guds.id}' limit 1`))[0];
    if (cliPortal) {
      await caso('Vendedor 20o: el cliente del portal lee solo los comprobantes de sus fichas', (r) => r?.suyo === 1 && r?.ajeno === 0,
        como({ uid: cliPortal.auth_id, empresa: guds.id, previo: `${objeto} insert into storage.objects (bucket_id, name) values ('comprobantes-cobro', '${v.usuario}/${cliPortal.cliente_id}/del-cliente.jpg');` },
          `select row_to_json(t)::text from (select count(*) filter (where name like '%/${cliPortal.cliente_id}/%') suyo, count(*) filter (where name = '${ruta}' and '${v.cliente}' <> '${cliPortal.cliente_id}') ajeno
            from storage.objects where bucket_id = 'comprobantes-cobro') t`));
    }

    // V5 · metas
    const mes = `extract(month from (now() at time zone 'America/Caracas'))::int`, anio = `extract(year from (now() at time zone 'America/Caracas'))::int`;
    await caso('Vendedor 20o: un vendedor no carga metas', 'No tienes permiso para cargar metas',
      como(E, `select public.guardar_meta_vendedor('${v.usuario}', ${anio}, ${mes}, 1000)::text`));
    await caso('Vendedor 20o: administración carga la meta y el vendedor la ve contra su venta del mes', (r) => Number(r?.meta) === 1234.5 && r?.venta_ok === true,
      como({ ...E, previo: `${comoU(admin)} perform public.guardar_meta_vendedor('${v.usuario}', ${anio}, ${mes}, 1234.5);` },
        `select row_to_json(t)::text from (select (r->'meta_mes'->>'meta')::numeric meta, (r->'ventas_mes'->>'neto') is not null venta_ok from (select public.resumen_vendedor() r) z) t`));
    await caso('Vendedor 20o: la lista de metas del admin no se abre para un vendedor', 'No tienes permiso para ver las metas',
      como(E, `select public.metas_vendedores(${anio}, ${mes})::text`));
  }
  await caso('Vendedor 20o: las funciones internas no se ejecutan por la API y las nuevas no se abren sin sesión', (r) => r?.internas === 0 && r?.anon === 0,
    como({}, `select row_to_json(t)::text from (select
      (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('vendedor_cliente_empresa', 'vendedor_producto_item', 'trg_pago_estado')
         and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) internas,
      (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('catalogo_vendedor', 'categorias_vendedor', 'compras_cliente_vendedor',
         'crear_orden_vendedor', 'ficha_cliente_vendedor', 'cartera_vendedor', 'registrar_cobro_vendedor', 'verificar_cobro_propuesta', 'hoy_vendedor',
         'metas_vendedores', 'guardar_meta_vendedor', 'tasa_bcv_de', 'ruta_comprobante_cobro_ok', 'comprobante_cobro_de_mis_clientes', 'comprobante_cobro_en_uso')
         and has_function_privilege('anon', p.oid, 'execute')) anon) t`));
}

// ── Delivery D6/D8 (20p): posición del repartidor, seguimiento, incidencias y devoluciones, indicadores y cuadre con Odoo ──
{
  const REP = '00000000-0000-0000-0000-0000000d2d60';
  const AUTH_REP = '00000000-0000-0000-0000-0000000a2d60';
  const ALM = '00000000-0000-0000-0000-0000000a2d61';
  const CLI = '00000000-0000-0000-0000-0000000c2d60';
  const sesion = (uid) => `perform set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true);
    perform set_config('request.headers', '{"x-empresa-id":"${guds.id}"}', true);`;
  const HOY = `(now() at time zone 'America/Caracas')::date`;
  const repFalso = `insert into auth.users (id, email, aud, role) values ('${AUTH_REP}', 'prueba.20p@guds.test', 'authenticated', 'authenticated');
    insert into usuarios (id, auth_id, email, nombre, apellido, role, rol_id, activo) select '${REP}', '${AUTH_REP}', 'prueba.20p@guds.test', 'Prueba', 'Repartidor 20p', 'delivery', r.id, true
      from roles r where lower(r.nombre) = 'delivery' limit 1;
    insert into usuario_empresas (usuario_id, empresa_id, por_defecto) values ('${REP}', '${guds.id}', true);`;
  // Personal de almacén: rol "Almacén" con inventario (ver/editar) y sin delivery
  const almacen = `insert into auth.users (id, email, aud, role) values ('${ALM}', 'prueba.almacen.20p@guds.test', 'authenticated', 'authenticated');
    insert into permisos (rol_id, modulo_id, puede_ver, puede_editar) select r.id, m.id, true, true from roles r, modulos m where r.nombre = 'Almacén' and m.codigo = 'inventario'
      on conflict (rol_id, modulo_id) do update set puede_ver = true, puede_editar = true;
    insert into usuarios (auth_id, email, nombre, role, rol_id, activo) select '${ALM}', 'prueba.almacen.20p@guds.test', 'Almacén', 'admin', r.id, true from roles r where r.nombre = 'Almacén';
    insert into usuario_empresas (usuario_id, empresa_id, por_defecto) select id, '${guds.id}', true from usuarios where auth_id = '${ALM}';`;
  const clienteFalso = `insert into auth.users (id, email, aud, role) values ('${CLI}', 'prueba.cliente.20p@guds.test', 'authenticated', 'authenticated');
    insert into usuarios (auth_id, email, nombre, role, cliente_id, activo) values ('${CLI}', 'prueba.cliente.20p@guds.test', 'Prueba', 'cliente', '${cliGuds}', true);`;
  // Entregas de prueba del repartidor (documentos ficticios con odoo_id negativo): estado y minutos desde "salir a entregar"
  const ent = (n, estado, extra = {}) => {
    const cols = { id: `'00000000-0000-0000-0000-0000002d60${String(n).padStart(2, '0')}'`, transferencia_odoo_id: -2060000 - n, doc_numero: `'P-20P/${n}'`,
      empresa_id: `'${guds.id}'`, repartidor_id: `'${REP}'`, estado: `'${estado}'`, fecha_asignacion: 'now()', ...extra };
    return `insert into entregas (${Object.keys(cols).join(', ')}) values (${Object.values(cols).join(', ')});`;
  };
  const idEnt = (n) => `'00000000-0000-0000-0000-0000002d60${String(n).padStart(2, '0')}'`;
  const t0 = Date.now();
  const pings = JSON.stringify([{ lat: 10.4901, lng: -66.8702, precision: 12, at: t0 - 300000 }, { lat: 10.5012, lng: -66.8611, precision: 15, at: t0 - 120000 }]);
  const registrar = (k) => `perform set_config('guds.p20p_${k}', public.registrar_posiciones('${pings}'::jsonb)::text, true);`;
  const incid = (n) => `(select id from incidencias_entrega where entrega_id = ${idEnt(n)})`;
  const lineasIncompleta = `'[{"item_id":"00000000-0000-0000-0000-0000002d6f01","move_odoo_id":1,"producto":"Producto A","esperada":10,"entregada":7,"motivo":"danado"},
    {"item_id":"00000000-0000-0000-0000-0000002d6f02","move_odoo_id":2,"producto":"Producto B","esperada":4,"entregada":4,"motivo":null}]'::jsonb`;
  const cerrada = (motivo = null) => ({ fecha_cierre: 'now()', origen_cierre: `'guds'`, cerrada_por: `'${REP}'`, ...(motivo ? { motivo_codigo: `'${motivo}'` } : {}) });

  await caso('Delivery 20p: el repartidor registra su posición en lote con una entrega en camino (reintentar no duplica)', (r) => r?.a === 2 && r?.b === 0 && r?.activo === true && r?.guardadas === 2,
    como({ rol: 'postgres', empresa: guds.id, previo: `${repFalso} ${ent(1, 'en_camino', { fecha_inicio_entrega: 'now()' })} ${sesion(AUTH_REP)} ${registrar('a')} ${registrar('b')}` },
      `select row_to_json(t)::text from (select (current_setting('guds.p20p_a')::jsonb->>'aceptados')::int a, (current_setting('guds.p20p_b')::jsonb->>'aceptados')::int b,
        (current_setting('guds.p20p_a')::jsonb->>'activo')::boolean activo,
        (select count(*) from posiciones_repartidor where repartidor_id = '${REP}' and entrega_id = ${idEnt(1)}) guardadas) t`));
  await caso('Delivery 20p: sin reparto en curso no se guarda la posición (activo = false)', (r) => r?.activo === false && r?.aceptados === 0,
    como({ uid: AUTH_REP, empresa: guds.id, previo: repFalso }, `select row_to_json(t)::text from (select (x->>'activo')::boolean activo, (x->>'aceptados')::int aceptados
      from (select public.registrar_posiciones('${pings}'::jsonb) x) z) t`));
  await caso('Delivery 20p: el repartidor no escribe directo en posiciones_repartidor', 'permission denied',
    como({ uid: AUTH_REP, empresa: guds.id, previo: `${repFalso} ${ent(1, 'en_camino')}` },
      `with x as (insert into posiciones_repartidor (repartidor_id, latitud, longitud, tomada_at) values ('${REP}', 10.5, -66.9, now()) returning id) select row_to_json(x)::text from x`));
  await caso('Delivery 20p: el repartidor no lee las posiciones (ni la suya)', (r) => r?.n === 0,
    como({ uid: AUTH_REP, empresa: guds.id, previo: `${repFalso} ${ent(1, 'en_camino')} ${sesion(AUTH_REP)} ${registrar('a')}` },
      `select row_to_json(t)::text from (select count(*) n from posiciones_repartidor) t`));
  await caso('Delivery 20p: administración no registra posiciones (solo el repartidor)', 'Solo el repartidor registra su posición',
    como({ empresa: guds.id }, `select public.registrar_posiciones('${pings}'::jsonb)::text`));
  if (vendGuds) {
    await caso('Delivery 20p: un vendedor no registra posiciones', 'Solo el repartidor registra su posición',
      como({ uid: vendGuds, empresa: guds.id }, `select public.registrar_posiciones('${pings}'::jsonb)::text`));
    await caso('Delivery 20p: un vendedor no lee las posiciones ni el seguimiento', (r) => r?.n === 0,
      como({ uid: vendGuds, empresa: guds.id, previo: `${repFalso} ${ent(1, 'en_camino')} ${sesion(AUTH_REP)} ${registrar('a')}` },
        `select row_to_json(t)::text from (select count(*) n from posiciones_repartidor) t`));
    await caso('Delivery 20p: un vendedor no abre el seguimiento del día', 'Solo administración',
      como({ uid: vendGuds, empresa: guds.id }, `select public.seguimiento_delivery()::text`));
  }
  await caso('Delivery 20p: un cliente no lee las posiciones', (r) => r?.n === 0,
    como({ uid: CLI, empresa: guds.id, previo: `${clienteFalso} ${repFalso} ${ent(1, 'en_camino')} ${sesion(AUTH_REP)} ${registrar('a')}` },
      `select row_to_json(t)::text from (select count(*) n from posiciones_repartidor) t`));
  await caso('Delivery 20p: administración ve la última posición y las paradas del día (hechas, pendientes y siguiente)',
    (r) => r?.n_tabla === 2 && Number(r?.lat) === 10.5012 && r?.paradas === 3 && r?.hechas === 1 && r?.siguiente === 'P-20P/2' && r?.rastro === 2,
    como({ empresa: guds.id, previo: `${repFalso}
        ${ent(1, 'entregada', { fecha_ruta: HOY, orden_ruta: 1, fecha_entrega: 'now()', ...cerrada() })}
        ${ent(2, 'en_camino', { fecha_ruta: HOY, orden_ruta: 2, fecha_inicio_entrega: 'now()' })}
        ${ent(3, 'asignada', { fecha_ruta: HOY, orden_ruta: 3 })}
        ${sesion(AUTH_REP)} ${registrar('a')} ${sesion(admin)}` },
      `select row_to_json(t)::text from (select (select count(*) from posiciones_repartidor where repartidor_id = '${REP}') n_tabla,
        r->'posicion'->>'lat' lat, jsonb_array_length(r->'paradas') paradas, jsonb_array_length(r->'rastro') rastro,
        (select count(*) from jsonb_array_elements(r->'paradas') p where p->>'estado' = 'entregada') hechas,
        (select p->>'numero' from jsonb_array_elements(r->'paradas') p where p->>'estado' in ('en_camino', 'asignada') order by (p->>'estado' = 'en_camino') desc, (p->>'orden_ruta')::int limit 1) siguiente
        from jsonb_array_elements(public.seguimiento_delivery()->'repartidores') r where r->>'id' = '${REP}') t`));

  // Incidencias y devoluciones
  await caso('Delivery 20p: una entrega incompleta abre su incidencia con lo que regresa al almacén', (r) => r?.tipo === 'incompleta' && r?.devolucion === 'pendiente' && r?.lineas === 1 && Number(r?.esperada) === 3,
    como({ rol: 'postgres', empresa: guds.id, previo: `${repFalso} ${ent(4, 'incompleta', { lineas: lineasIncompleta, fecha_entrega: 'now()', ...cerrada() })}` },
      `select row_to_json(t)::text from (select tipo, devolucion, jsonb_array_length(devolucion_lineas) lineas, devolucion_lineas->0->>'esperada' esperada
        from incidencias_entrega where entrega_id = ${idEnt(4)}) t`));
  const conIncompleta = `${repFalso} ${ent(4, 'incompleta', { lineas: lineasIncompleta, fecha_entrega: 'now()', ...cerrada() })}`;
  const confirmar = (recibida, nota = null) => `select public.confirmar_devolucion_entrega(${incid(4)}, '[{"item_id":"00000000-0000-0000-0000-0000002d6f01","recibida":${recibida}}]'::jsonb, ${nota ? `'${nota}'` : 'null'})::text`;
  if (vendGuds) {
    await caso('Delivery 20p: un vendedor no confirma devoluciones', 'Solo almacén o administración',
      como({ uid: vendGuds, empresa: guds.id, previo: conIncompleta }, confirmar(3)));
  }
  await caso('Delivery 20p: el repartidor no confirma su propia devolución', 'Solo almacén o administración',
    como({ uid: AUTH_REP, empresa: guds.id, previo: conIncompleta }, confirmar(3)));
  await caso('Delivery 20p: recibir menos de lo que regresa exige una nota', 'Explica en la nota',
    como({ empresa: guds.id, previo: conIncompleta }, confirmar(2)));
  await caso('Delivery 20p: almacén (rol con inventario) confirma la devolución con cantidades, quién y cuándo', (r) => r?.devolucion === 'confirmada' && Number(r?.recibida) === 2 && r?.quien === true && r?.cuando === true,
    como({ empresa: guds.id, previo: `${conIncompleta} ${almacen} ${sesion(ALM)}
        perform public.confirmar_devolucion_entrega(${incid(4)}, '[{"item_id":"00000000-0000-0000-0000-0000002d6f01","recibida":2}]'::jsonb, 'Llegaron 2, una caja rota se quedó en el camión');` },
      `select row_to_json(t)::text from (select devolucion, devolucion_lineas->0->>'recibida' recibida, devolucion_por = (select id from usuarios where auth_id = '${ALM}') quien,
        devolucion_at is not null cuando from incidencias_entrega where entrega_id = ${idEnt(4)}) t`));
  await caso('Delivery 20p: almacén ve las devoluciones pero no las incidencias completas', 'No tienes permiso para ver las incidencias',
    como({ uid: ALM, empresa: guds.id, previo: `${conIncompleta} ${almacen}` }, `select public.incidencias_delivery(60, false)::text`));
  await caso('Delivery 20p: almacén solo lee (tabla) las incidencias con mercancía por devolver', (r) => r?.con === 1 && r?.sin === 0,
    como({ uid: ALM, empresa: guds.id, previo: `${conIncompleta} ${ent(5, 'reprogramada', { reprogramada_para: HOY, ...cerrada('cerrado') })} ${almacen}` },
      `select row_to_json(t)::text from (select count(*) filter (where entrega_id = ${idEnt(4)}) con, count(*) filter (where entrega_id = ${idEnt(5)}) sin from incidencias_entrega) t`));
  await caso('Delivery 20p: no se resuelve una incidencia con la devolución pendiente', 'Falta que almacén confirme',
    como({ empresa: guds.id, previo: conIncompleta }, `select public.resolver_incidencia(${incid(4)}, 'Se emitió la nota de crédito')::text`));
  await caso('Delivery 20p: una entrega incompleta no se reprograma (lo que falta va como pendiente en Odoo)', 'La entrega incompleta ya se entregó',
    como({ empresa: guds.id, previo: conIncompleta }, `select public.reprogramar_incidencia(${incid(4)}, ${HOY} + 1)::text`));
  await caso('Delivery 20p: resolver exige una nota y queda quién y cuándo', (r) => r?.estado === 'resuelta' && r?.quien === true,
    como({ empresa: guds.id, previo: `${repFalso} ${ent(5, 'reprogramada', { reprogramada_para: HOY, ...cerrada('cerrado') })} ${sesion(admin)}
        perform public.resolver_incidencia(${incid(5)}, 'El cliente canceló el pedido: se anula en Odoo');` },
      `select row_to_json(t)::text from (select estado, resuelta_por is not null quien from incidencias_entrega where entrega_id = ${idEnt(5)}) t`));
  if (vendGuds) {
    await caso('Delivery 20p: un vendedor no decide sobre incidencias', 'Solo administración puede decidir',
      como({ uid: vendGuds, empresa: guds.id, previo: `${repFalso} ${ent(5, 'reprogramada', { reprogramada_para: HOY, ...cerrada('cerrado') })}` },
        `select public.resolver_incidencia(${incid(5)}, 'nota de prueba')::text`));
  }
  // Rechazo sobre un documento real "Listo" de Odoo: reprogramar lo devuelve a la cola con fecha; reasignar crea la entrega nueva en la ruta de ese día
  const [docLista] = await sql(`select t.id, t.odoo_id from transferencias t where t.empresa_id = '${guds.id}' and t.tipo = 'entrega' and t.estado = 'lista'
    and exists (select 1 from transferencia_items ti where ti.transferencia_id = t.id and ti.cantidad_hecha > 0)
    and not exists (select 1 from entregas e where e.transferencia_odoo_id = t.odoo_id and e.estado in ('asignada', 'en_camino')) order by t.numero limit 1`);
  if (docLista) {
    const rechazoReal = `${repFalso} ${ent(6, 'rechazada', { transferencia_id: `'${docLista.id}'`, transferencia_odoo_id: docLista.odoo_id, ...cerrada('precio') })}`;
    await caso('Delivery 20p: un rechazo abre la incidencia con toda la mercancía del documento por devolver', (r) => r?.tipo === 'rechazada' && r?.devolucion === 'pendiente' && r?.lineas > 0,
      como({ rol: 'postgres', empresa: guds.id, previo: rechazoReal },
        `select row_to_json(t)::text from (select tipo, devolucion, jsonb_array_length(devolucion_lineas) lineas from incidencias_entrega where entrega_id = ${idEnt(6)}) t`));
    await caso('Delivery 20p: reprogramar un rechazo lo devuelve a la cola con la fecha nueva', (r) => r?.estado === 'reprogramada' && r?.ok === true,
      como({ empresa: guds.id, previo: `${rechazoReal} ${sesion(admin)} perform public.reprogramar_incidencia(${incid(6)}, ${HOY} + 2, 'El cliente pidió el jueves');` },
        `select row_to_json(t)::text from (select estado, fecha_objetivo = ${HOY} + 2 ok from incidencias_entrega where entrega_id = ${idEnt(6)}) t`));
    await caso('Delivery 20p: reasignar crea la entrega nueva (2.º intento) en la ruta del día elegido', (r) => r?.estado === 'reasignada' && r?.nueva === 'asignada' && r?.ruta_ok === true && r?.intento === 2,
      como({ empresa: guds.id, previo: `${rechazoReal} ${sesion(admin)} perform public.reasignar_incidencia(${incid(6)}, '${REP}', ${HOY} + 1);` },
        `select row_to_json(t)::text from (select i.estado, n.estado nueva, n.fecha_ruta = ${HOY} + 1 ruta_ok,
          (select count(*) from entregas p where p.transferencia_odoo_id = ${docLista.odoo_id} and p.estado <> 'cancelada')::int intento
          from incidencias_entrega i join entregas n on n.id = i.nueva_entrega_id where i.entrega_id = ${idEnt(6)}) t`));
    await caso('Delivery 20p: no se reprograma un documento que ya volvió a asignarse', 'ya volvió a asignarse',
      como({ empresa: guds.id, previo: `${rechazoReal} ${sesion(admin)} perform public.reasignar_incidencia(${incid(6)}, '${REP}', null);
          update incidencias_entrega set estado = 'abierta' where entrega_id = ${idEnt(6)};` },
        `select public.reprogramar_incidencia(${incid(6)}, ${HOY} + 1)::text`));
  }

  // Indicadores: 5 asignadas hoy; 4 cerradas (completa, incompleta, rechazada, reprogramada); 60 min de salida a entrega; a tiempo 2 de 2
  await caso('Delivery 20p: los indicadores cuadran con las entregas del repartidor',
    (r) => r?.asignadas === 5 && r?.cerradas === 4 && r?.completas === 1 && r?.incompletas === 1 && r?.rechazadas === 1 && r?.reprogramadas === 1
      && Number(r?.minutos) === 60 && r?.a_tiempo === 2 && r?.con_objetivo === 2 && r?.motivos === 'cerrado,danado,precio' && r?.total_ok === true,
    como({ empresa: guds.id, previo: `${repFalso}
        ${ent(1, 'entregada', { fecha_ruta: HOY, fecha_inicio_entrega: `now() - interval '60 minutes'`, fecha_entrega: 'now()', ...cerrada() })}
        ${ent(2, 'incompleta', { fecha_ruta: HOY, fecha_inicio_entrega: `now() - interval '60 minutes'`, fecha_entrega: 'now()', lineas: lineasIncompleta, ...cerrada() })}
        ${ent(3, 'rechazada', { fecha_ruta: HOY, ...cerrada('precio') })}
        ${ent(4, 'reprogramada', { fecha_ruta: HOY, reprogramada_para: HOY, ...cerrada('cerrado') })}
        ${ent(5, 'asignada', { fecha_ruta: HOY })}` },
      `select row_to_json(t)::text from (select (r->>'asignadas')::int asignadas, (r->>'cerradas')::int cerradas, (r->>'completas')::int completas,
        (r->>'incompletas')::int incompletas, (r->>'rechazadas')::int rechazadas, (r->>'reprogramadas')::int reprogramadas, r->>'minutos_salida_entrega' minutos,
        (r->>'a_tiempo')::int a_tiempo, (r->>'con_objetivo')::int con_objetivo,
        (select string_agg(m->>'codigo', ',' order by m->>'codigo') from jsonb_array_elements(r->'motivos') m) motivos,
        ((i->'total'->>'cerradas')::int >= 4) total_ok
        from (select public.indicadores_delivery(${HOY}, ${HOY}) i) z, jsonb_array_elements(i->'repartidores') r where r->>'id' = '${REP}') t`));
  if (vendGuds) {
    await caso('Delivery 20p: un vendedor no ve los indicadores de delivery', 'Solo administración',
      como({ uid: vendGuds, empresa: guds.id }, `select public.indicadores_delivery(${HOY} - 30, ${HOY})::text`));
  }

  // Cuadre con Odoo (D8): lo que la sincronización compara con el documento de Odoo (solo lectura)
  const docsHechos = await sql(`select t.id, t.odoo_id from transferencias t where t.empresa_id = '${guds.id}' and t.tipo = 'entrega' and t.estado = 'hecha'
    and exists (select 1 from transferencia_items ti where ti.transferencia_id = t.id and coalesce(ti.estado, '') <> 'cancelada' and ti.cantidad_hecha > 0)
    and not exists (select 1 from entregas e where e.transferencia_odoo_id = t.odoo_id) order by t.fecha_realizada desc limit 3`);
  if (docLista && docsHechos.length === 3) {
    const [h1, h2, h3] = docsHechos;
    const lineasDe = (doc, mas = 0) => `(select jsonb_agg(jsonb_build_object('item_id', ti.id, 'move_odoo_id', ti.odoo_id, 'producto', ti.nombre_producto,
      'esperada', ti.cantidad_hecha, 'entregada', ti.cantidad_hecha + ${mas})) from transferencia_items ti where ti.transferencia_id = '${doc.id}' and coalesce(ti.estado, '') <> 'cancelada')`;
    const docEnt = (n, doc, estado, extra) => ent(n, estado, { transferencia_id: `'${doc.id}'`, transferencia_odoo_id: doc.odoo_id, ...extra });
    const fixtures = `${repFalso}
      ${docEnt(1, docLista, 'entregada', { fecha_entrega: 'now()', lineas: lineasDe(docLista), ...cerrada() })}
      ${docEnt(2, h1, 'rechazada', cerrada('precio'))}
      ${docEnt(3, h2, 'entregada', { fecha_entrega: 'now()', lineas: lineasDe(h2), ...cerrada() })}
      ${docEnt(4, h3, 'incompleta', { fecha_entrega: 'now()', lineas: lineasDe(h3, -1), ...cerrada() })}
      perform set_config('guds.p20p_c', public.cuadrar_entregas_odoo('${guds.id}')::text, true);`;
    await caso('Delivery 20p: el cuadre con Odoo separa pendiente en Odoo, validada sin GUDS, cantidades distintas y cuadrada',
      (r) => r?.a === 'pendiente_odoo' && r?.b === 'validada_sin_guds' && r?.c === 'cuadrada' && r?.d === 'cantidades_distintas' && Number(r?.dif) === 1 && r?.resumen >= 1,
      como({ rol: 'postgres', empresa: guds.id, previo: fixtures },
        `select row_to_json(t)::text from (select
          (select tipo from cuadre_entregas_odoo where transferencia_odoo_id = ${docLista.odoo_id}) a,
          (select tipo from cuadre_entregas_odoo where transferencia_odoo_id = ${h1.odoo_id}) b,
          (select tipo from cuadre_entregas_odoo where transferencia_odoo_id = ${h2.odoo_id}) c,
          (select tipo from cuadre_entregas_odoo where transferencia_odoo_id = ${h3.odoo_id}) d,
          (select lineas->0->>'diferencia' from cuadre_entregas_odoo where transferencia_odoo_id = ${h3.odoo_id}) dif,
          (current_setting('guds.p20p_c')::jsonb->>'cantidades_distintas')::int resumen) t`));
    await caso('Delivery 20p: el cuadre se recalcula (si Odoo valida lo que GUDS entregó, pasa a cuadrada)', (r) => r?.tipo === 'cuadrada',
      como({ rol: 'postgres', empresa: guds.id, previo: `${fixtures} update transferencias set estado = 'hecha' where id = '${docLista.id}';
          perform public.cuadrar_entregas_odoo('${guds.id}');` },
        `select row_to_json(t)::text from (select tipo from cuadre_entregas_odoo where transferencia_odoo_id = ${docLista.odoo_id}) t`));
    if (vendGuds) {
      await caso('Delivery 20p: un vendedor no lee el cuadre con Odoo', (r) => r?.n === 0,
        como({ uid: vendGuds, empresa: guds.id, previo: fixtures }, `select row_to_json(t)::text from (select count(*) n from cuadre_entregas_odoo) t`));
    }
    await caso('Delivery 20p: administración lee el cuadre de su empresa', (r) => r?.n >= 4,
      como({ empresa: guds.id, previo: fixtures }, `select row_to_json(t)::text from (select count(*) n from cuadre_entregas_odoo) t`));
  }
  await caso('Delivery 20p: nadie recalcula el cuadre por la API', 'permission denied',
    como({ empresa: guds.id }, `select public.cuadrar_entregas_odoo('${guds.id}')::text`));
  await caso('Delivery 20p: anon no ejecuta las funciones y nadie ejecuta las internas', (r) => r?.n === 0,
    como({}, `select row_to_json(t)::text from (select count(*) n from pg_proc p where p.pronamespace = 'public'::regnamespace and (
      (p.proname in ('registrar_posiciones', 'seguimiento_delivery', 'incidencias_delivery', 'reprogramar_incidencia', 'reasignar_incidencia',
          'resolver_incidencia', 'confirmar_devolucion_entrega', 'indicadores_delivery') and has_function_privilege('anon', p.oid, 'execute'))
      or (p.proname in ('purgar_posiciones_repartidor', 'cuadrar_entregas_odoo', 'puede_confirmar_devolucion', 'trg_entrega_incidencia', 'incidencia_historial', 'incidencia_para_decidir')
        and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))))) t`));
  await caso('Delivery 20p: sin sesión no se leen posiciones, incidencias ni cuadre', 'permission denied',
    como({ rol: 'anon', uid: null, empresa: guds.id }, `select ((select count(*) from posiciones_repartidor) + (select count(*) from incidencias_entrega) + (select count(*) from cuadre_entregas_odoo))::text`));
  await caso('Delivery 20p: la purga de posiciones está programada (90 días)', (r) => r?.n === 1,
    como({ rol: 'postgres' }, `select row_to_json(t)::text from (select count(*) n from cron.job where jobname = 'purgar-posiciones-repartidor') t`));
}

// ── Reportes R2 · R7 · R8b (20q): clasificación comercial de Odoo, equivalencias, comparativos, metas, calidad y cuadre ──
{
  const valor20q = async (q, empresa = 'todas', extra = {}) => { const r = await como({ empresa, ...extra }, q); return r.ok ? JSON.parse(r.ok) : { error: r.error }; };
  const resuelto20q = (obj) => Promise.resolve(obj?.error ? obj : { ok: JSON.stringify(obj) });
  const [{ lote: lote20q }] = await sql(`select public.profit_lote_vigente() lote`);
  const sinPermiso20q = vendGuds ? { uid: vendGuds, empresa: guds.id } : null;

  // R2 · clasificación comercial: se trae de Odoo y no se edita en GUDS
  const [clasif] = await sql(`select (select count(*) from clientes where etiquetas is not null) etiquetas,
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'clientes' and column_name in ('tipo_cliente', 'canal', 'segmento', 'etiquetas')) cols_cli,
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'productos' and column_name = 'marca') cols_prod`);
  casos.push({ ok: Number(clasif.cols_cli) === 4 && Number(clasif.cols_prod) === 1 && Number(clasif.etiquetas) > 0 ? '✓' : '✗',
    caso: 'Clasificación 20q: el importador trae tipo de cliente, canal, segmento, etiquetas y marca de Odoo', resultado: JSON.stringify(clasif) });
  await caso('Clasificación 20q: el tipo de cliente viene de Odoo (no se edita en GUDS)', 'viene de Odoo', como(E, upd('clientes', `tipo_cliente = 'X'`, cliOdoo)));
  await caso('Clasificación 20q: la marca del producto viene de Odoo (no se edita en GUDS)', 'viene de Odoo', como(E, upd('productos', `marca = 'X'`, prodOdoo)));

  if (lote20q) {
    // Motor: Categoría › Línea › Sub-línea son los niveles de la categoría de Odoo también en las ventas de Profit
    await caso('Cubo 20q: en Profit la categoría usa los niveles de Odoo (sin nombres de Profit mezclados)', (r) => r?.filas > 1 && r.mezcladas === 0,
      como({ empresa: 'todas' }, `select row_to_json(t)::text from (select count(*) filas,
        count(*) filter (where k1 <> '' and k1 not like '% (Profit)' and k1 not in (select distinct upper(btrim(split_part(nombre, '/', 1))) from public.categorias)) mezcladas
        from public.reporte_ventas_cubo('2025-01-01', '2025-12-31', array['categoria'], 'profit', '{}', null, false) where nivel = 1) t`));
    await caso('Cubo 20q: la línea de Odoo en Profit = artículo con categoría en Odoo o la equivalencia (Quirutec 2025, SOLUCIONES)',
      (r) => r?.cubo !== null && Number(r.cubo) > 0 && Math.abs(Number(r.cubo) - Number(r.directo)) < 0.02,
      como({ empresa: qrt.id }, `with c as (select round(sum(venta_usd), 2) v from public.reporte_ventas_cubo('2025-01-01', '2025-12-31', array['categoria', 'linea'], 'profit', '{}', null, false)
          where nivel = 2 and k2 = 'SOLUCIONES'),
        d as (select round(sum(v.neto_usd), 2) v from public.ventas_historicas v
          left join public.productos pr on pr.id = v.producto_id
          left join public.profit_categorias pq on pq.empresa_id = v.empresa_id and pq.categoria_profit = btrim(coalesce(v.categoria, '')) and pq.linea_profit = btrim(coalesce(v.linea, ''))
          join public.categorias ca on ca.id = coalesce(pr.categoria_id, pq.categoria_id)
          where v.lote = public.profit_lote_vigente() and v.tratamiento = 'venta' and v.fecha between '2025-01-01' and '2025-12-31'
            and upper(btrim(split_part(ca.nombre, '/', 2))) = 'SOLUCIONES')
        select row_to_json(t)::text from (select (select v from c) cubo, (select v from d) directo) t`));
    await caso('Cubo 20q: la clasificación original de Profit sigue disponible y suma lo mismo', (r) => r && Number(r.unificada) === Number(r.profit) && r.nombres_profit > 0,
      como({ empresa: 'todas' }, `select row_to_json(t)::text from (select
        (select round(venta_usd, 2) from public.reporte_ventas_cubo('2025-01-01', '2025-12-31', array['categoria'], 'profit', '{}', null, false) where nivel = 0) unificada,
        (select round(venta_usd, 2) from public.reporte_ventas_cubo('2025-01-01', '2025-12-31', array['categoria_profit'], 'profit', '{}', null, false) where nivel = 0) profit,
        (select count(*) from public.reporte_ventas_cubo('2025-01-01', '2025-12-31', array['categoria_profit'], 'profit', '{}', null, false)
          where nivel = 1 and k1 in (select distinct btrim(categoria) from public.ventas_historicas where lote = public.profit_lote_vigente())) nombres_profit) t`));
    await caso('Reportes 20q: por categoría, los artículos de Profit sin pareja usan la equivalencia (mismo total)', (r) => r && Number(r.categorias) === Number(r.productos) && r.sin_equivalencia === r.pares_sin,
      como({ empresa: 'todas' }, `select row_to_json(t)::text from (select
        (select round(sum(neto_usd), 2) from public.reporte_ventas('2025-01-01', '2025-12-31', 'categoria', 'profit', false)) categorias,
        (select round(sum(neto_usd), 2) from public.reporte_ventas('2025-01-01', '2025-12-31', 'producto', 'profit', false)) productos,
        (select count(*) from public.reporte_ventas('2025-01-01', '2025-12-31', 'categoria', 'profit', false) where clave like 'profit:%') sin_equivalencia,
        (select count(distinct upper(btrim(v.categoria))) from public.ventas_historicas v
          left join public.productos pr on pr.id = v.producto_id
          left join public.profit_categorias pq on pq.empresa_id = v.empresa_id and pq.categoria_profit = btrim(coalesce(v.categoria, '')) and pq.linea_profit = btrim(coalesce(v.linea, ''))
          where v.lote = public.profit_lote_vigente() and v.tratamiento = 'venta' and v.fecha between '2025-01-01' and '2025-12-31'
            and pr.categoria_id is null and pq.categoria_id is null and nullif(btrim(v.categoria), '') is not null) pares_sin) t`));
    await caso('Detalle 20q: el detalle de líneas trae la categoría de Odoo', (r) => r?.n > 0 && r.con_cat > 0.9 * r.n,
      como({ empresa: guds.id }, `select row_to_json(t)::text from (select count(*) n, count(categoria_odoo) con_cat from public.reporte_ventas_lineas('2026-04-01', '2026-04-30')) t`));

    // Equivalencias: las lee quien tiene reportes; solo administración las edita, en la empresa activa y con la función
    const eq = (await sql(`select id, categoria_id from profit_categorias where empresa_id = '${guds.id}' and categoria_id is not null limit 1`))[0];
    if (sinPermiso20q) {
      await caso('Equivalencias 20q: un vendedor sin permiso no las lee', (r) => r?.n === 0, como(sinPermiso20q, `select row_to_json(t)::text from (select count(*) n from public.profit_categorias) t`));
      await caso('Equivalencias 20q: un vendedor sin permiso no abre la pantalla', 'permiso para ver reportes', como(sinPermiso20q, `select public.equivalencias_categorias_profit()::text`));
      const previoRepEditar = `insert into public.permisos (rol_id, modulo_id, puede_ver, puede_editar) select u.rol_id, m.id, true, true from public.usuarios u, public.modulos m
        where u.auth_id = '${vendGuds}' and m.codigo = 'reportes' on conflict (rol_id, modulo_id) do update set puede_ver = true, puede_editar = true;`;
      if (eq) {
        await caso('Equivalencias 20q: con "reportes: editar" pero sin ser administración no se editan', 'Solo administración',
          como({ ...sinPermiso20q, previo: previoRepEditar }, `select public.guardar_profit_categorias(${lit(JSON.stringify([{ id: eq.id, categoria_id: eq.categoria_id }]))}::jsonb)::text`));
      }
    }
    if (eq) {
      await caso('Equivalencias 20q: nadie las edita directamente (solo con la función)', 'permission denied',
        como(E, `with x as (update public.profit_categorias set categoria_id = null where id = '${eq.id}' returning id) select row_to_json(x)::text from x`));
      await caso('Equivalencias 20q: en "Ambas" no se editan', 'Modo consulta',
        como({ empresa: 'todas' }, `select public.guardar_profit_categorias(${lit(JSON.stringify([{ id: eq.id, categoria_id: eq.categoria_id }]))}::jsonb)::text`));
      await caso('Equivalencias 20q: una categoría que no es de Odoo se rechaza', 'no existe en Odoo',
        como(E, `select public.guardar_profit_categorias(${lit(JSON.stringify([{ id: eq.id, categoria_id: '00000000-0000-0000-0000-000000000000' }]))}::jsonb)::text`));
      const previoValidar20q = `create function pg_temp.p20q_validar(p jsonb, v uuid) returns text language plpgsql as $f$
        declare n int; r text;
        begin
          n := public.guardar_profit_categorias(p);
          select row_to_json(t)::text into r from (select n, estado, revisado_por is not null quien, categoria_id is null sin from public.profit_categorias where id = v) t;
          return r;
        end $f$;`;
      await caso('Equivalencias 20q: administración valida una en su empresa (y puede dejarla sin equivalencia)', (r) => r?.n === 1 && r.estado === 'validado' && r.quien && r.sin,
        como({ empresa: guds.id, previo: previoValidar20q }, `select pg_temp.p20q_validar(${lit(JSON.stringify([{ id: eq.id, categoria_id: null }]))}::jsonb, '${eq.id}')`));
    }

    // R8b · cuadre Profit ↔ Odoo
    const cuadre = await valor20q(`select (public.reporte_cuadre_profit_odoo() -> 'totales')::text`);
    await caso('Cuadre 20q: repite el cruce previo (≥ 666 documentos cuadran desde dic-2024, diferencia total < 2 USD)', (r) => r && Number(r.ventana_cuadran) >= 666
      && Math.abs(Number(r.ventana_odoo_usd) - Number(r.ventana_profit_usd)) < 2 && Number(r.cuadran) >= Number(r.ventana_cuadran)
      && Number(r.documentos) === Number(r.cuadran) + Number(r.pronto_pago) + Number(r.difieren) + Number(r.nc_ambiguas) + Number(r.solo_odoo), resuelto20q(cuadre));
    const [siDirecto] = await sql(`select count(*) n from facturas where es_saldo_inicial`);
    casos.push({ ok: Number(cuadre?.documentos) === Number(siDirecto.n) ? '✓' : '✗', caso: 'Cuadre 20q: revisa todos los saldos iniciales de Odoo', resultado: JSON.stringify({ cuadre: cuadre?.documentos, directo: siDirecto.n }) });
  }

  // R7 · comparativos: cada período es exactamente reporte_ventas en sus fechas
  const compMes = await valor20q(`select row_to_json(t)::text from (select
      (select round(sum(actual_usd), 2) from public.reporte_ventas_comparativo('2026-08-01', '2026-08-31', 'empresa')) actual,
      (select round(sum(anterior_usd), 2) from public.reporte_ventas_comparativo('2026-08-01', '2026-08-31', 'empresa')) anterior,
      (select round(sum(anio_anterior_usd), 2) from public.reporte_ventas_comparativo('2026-08-01', '2026-08-31', 'empresa')) anio,
      (select min(anterior_desde)::text || '/' || min(anterior_hasta)::text || '/' || min(anio_desde)::text || '/' || min(anio_hasta)::text from public.reporte_ventas_comparativo('2026-08-01', '2026-08-31', 'empresa')) fechas,
      (select round(sum(neto_usd), 2) from public.reporte_ventas('2026-08-01', '2026-08-31', 'empresa')) rv_actual,
      (select round(sum(neto_usd), 2) from public.reporte_ventas('2026-07-01', '2026-07-31', 'empresa')) rv_anterior,
      (select round(sum(neto_usd), 2) from public.reporte_ventas('2025-08-01', '2025-08-31', 'empresa')) rv_anio) t`);
  await caso('Comparativo 20q: el período anterior y el año anterior coinciden con reporte_ventas (mes)', (r) => r && Number(r.actual) === Number(r.rv_actual)
    && Number(r.anterior) === Number(r.rv_anterior) && Number(r.anio) === Number(r.rv_anio) && Number(r.anio) > 0
    && r.fechas === '2026-07-01/2026-07-31/2025-08-01/2025-08-31', resuelto20q(compMes));
  await caso('Comparativo 20q: por vendedor y en un período de días, el anterior es el mismo número de días justo antes', (r) => r && r.filas > 0 && r.distintas === 0 && r.fechas === '2026-08-17/2026-08-31',
    como({ empresa: 'todas' }, `with c as (select * from public.reporte_ventas_comparativo('2026-09-01', '2026-09-15', 'vendedor')),
        p as (select * from public.reporte_ventas('2026-08-17', '2026-08-31', 'vendedor'))
      select row_to_json(t)::text from (select (select count(*) from c) filas,
        (select count(*) from c full join p on p.clave = c.clave where coalesce(c.anterior_usd, 0) <> coalesce(p.neto_usd, 0)) distintas,
        (select min(anterior_desde)::text || '/' || min(anterior_hasta)::text from c) fechas) t`));
  await caso('Comparativo 20q: por mes no se compara (las claves cambian de período)', 'Agrupación no válida',
    como(E, `select count(*)::text from public.reporte_ventas_comparativo('2026-08-01', '2026-08-31', 'mes')`));
  if (sinPermiso20q) {
    await caso('Comparativo 20q: un vendedor sin el permiso de reportes no compara', 'permiso para ver reportes',
      como(sinPermiso20q, `select count(*)::text from public.reporte_ventas_comparativo('2026-08-01', '2026-08-31')`));
  }

  // R7 · metas: el cumplimiento y la venta son los de resumen_vendedor; proyección con días hábiles (lunes a viernes)
  await caso('Metas 20q: días hábiles de septiembre 2026 = 22 (lunes a viernes)', (r) => r?.n === 22,
    como(E, `select row_to_json(t)::text from (select public.dias_habiles('2026-09-01', '2026-09-30') n) t`));
  const vm = (await sql(`select u.id usuario, u.auth_id from usuarios u where u.role = 'vendedor' and u.auth_id is not null and coalesce(u.activo, true)
    and exists (select 1 from clientes c where c.vendedor_asignado_id = u.id and c.empresa_id = '${guds.id}') order by u.created_at limit 1`))[0];
  if (vm) {
    const hdr = JSON.stringify({ 'x-empresa-id': guds.id });
    const previoMeta = `insert into public.metas_vendedor (vendedor_id, anio, mes, meta_ventas, empresa_id)
        values ('${vm.usuario}', extract(year from (now() at time zone 'America/Caracas'))::int, extract(month from (now() at time zone 'America/Caracas'))::int, 5000, '${guds.id}')
        on conflict (empresa_id, vendedor_id, mes, anio) do update set meta_ventas = 5000;
      perform set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: vm.auth_id, role: 'authenticated' }))}, true);
      perform set_config('request.headers', ${lit(hdr)}, true);
      perform set_config('prueba.rv20q', public.resumen_vendedor()::text, true);`;
    const metas = await valor20q(`select row_to_json(t)::text from (select m.meta_usd, m.venta_usd, m.cumplimiento_pct, m.proyeccion_usd, m.dias_habiles, m.dias_transcurridos,
        current_setting('prueba.rv20q')::jsonb rv
      from public.reporte_metas_vendedores(date_trunc('month', now() at time zone 'America/Caracas')::date, (now() at time zone 'America/Caracas')::date) m
      where m.vendedor_id = '${vm.usuario}' and m.en_curso) t`, guds.id, { previo: previoMeta });
    await caso('Metas 20q: el cumplimiento coincide con resumen_vendedor (meta, venta y %)', (r) => r && Number(r.meta_usd) === 5000
      && Number(r.meta_usd) === Number(r.rv.meta_mes.meta) && Number(r.venta_usd) === Number(r.rv.ventas_mes.neto)
      && Number(r.cumplimiento_pct) === Math.round((Number(r.venta_usd) / 5000) * 10000) / 100, resuelto20q(metas));
    await caso('Metas 20q: proyección del mes = venta ÷ días hábiles transcurridos × días hábiles del mes', (r) => r && r.dias_habiles > 0
      && (r.dias_transcurridos === 0 ? r.proyeccion_usd === null
        : Math.abs(Number(r.proyeccion_usd) - Math.round((Number(r.venta_usd) / r.dias_transcurridos) * r.dias_habiles * 100) / 100) < 0.011), resuelto20q(metas));
  }
  if (sinPermiso20q) {
    await caso('Metas 20q: un vendedor sin el permiso de reportes no ve la tabla de metas', 'permiso para ver reportes',
      como(sinPermiso20q, `select count(*)::text from public.reporte_metas_vendedores('2026-09-01', '2026-09-30')`));
  }

  // R8b · calidad de datos
  const calidad = await valor20q(`select row_to_json(t)::text from (select r -> 'conteos' conteos,
      (select jsonb_object_agg(k, jsonb_array_length(v)) from jsonb_each(r -> 'listas') x(k, v)) largos from (select public.reporte_calidad_datos() r) z) t`);
  await caso('Calidad 20q: cada lista trae su conteo', (r) => r?.conteos && Object.keys(r.conteos).length === 8 && Object.entries(r.conteos).every(([k, n]) => r.largos[k] === n), resuelto20q(calidad));
  const [ext] = await sql(`select count(*) n from clientes where activo and estado ~ '\\((?!VE\\))[A-Z]{2}\\)\\s*$'`);
  casos.push({ ok: Number(calidad?.conteos?.clientes_estado_extranjero) === Number(ext.n) ? '✓' : '✗', caso: 'Calidad 20q: clientes con estado de otro país = los "(XX)" distintos de Venezuela',
    resultado: JSON.stringify({ calidad: calidad?.conteos?.clientes_estado_extranjero, directo: ext.n }) });
  if (sinPermiso20q) {
    await caso('Calidad 20q: un vendedor sin permiso no ve Calidad', 'permiso para ver reportes', como(sinPermiso20q, `select public.reporte_calidad_datos()::text`));
    await caso('Cuadre 20q: un vendedor sin permiso no ve el cuadre Profit ↔ Odoo', 'permiso para ver reportes', como(sinPermiso20q, `select public.reporte_cuadre_profit_odoo()::text`));
  }
  await caso('Calidad 20q: sin sesión no se ejecuta', 'permission denied', como({ rol: 'anon', uid: null, empresa: guds.id }, `select public.reporte_calidad_datos()::text`));
  await caso('Reportes 20q: las funciones internas no se ejecutan por la API y las nuevas no se abren sin sesión', (r) => r?.internas === 0 && r?.anon === 0,
    como({}, `select row_to_json(t)::text from (select
      (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('profit_proponer_categorias', 'profit_norm_categoria',
         'cubo_niveles_categoria_sql', 'cubo_clasificacion_profit_sql')
         and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) internas,
      (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('equivalencias_categorias_profit', 'guardar_profit_categorias',
         'reporte_ventas_comparativo', 'periodo_comparacion', 'dias_habiles', 'reporte_metas_vendedores', 'reporte_cuadre_profit_odoo', 'reporte_calidad_datos')
         and has_function_privilege('anon', p.oid, 'execute')) anon) t`));
}

// ── Fotos y descripciones bidireccionales con Odoo (20r): solo administración encola, sin bucles, gana el más reciente ──
{
  const qaVend20r = (await sql(`select a.id from auth.users a join usuarios u on u.auth_id = a.id where a.email = 'qa.vendedor@guds.test' and u.role = 'vendedor'`))[0]?.id || vendGuds;
  const [p20r] = await sql(`select id from productos where empresa_id = '${guds.id}' and odoo_id is not null and imagen_url is null
    and nullif(btrim(descripcion), '') is null and imagen_origen is null and descripcion_origen is null order by nombre limit 1`);
  const P = p20r.id;
  const colaP = `(select count(*) from public.odoo_escrituras e where e.tipo = 'producto' and e.referencia_id = '${P}')`;
  // Cambio del admin por la API (función de prueba: cada sentencia ve lo que encoló el disparador de la anterior)
  const previoAdmin = `create function public.p20r_admin(p uuid) returns text language plpgsql as $f$
    declare r text;
    begin
      update public.productos set descripcion = '  Descripción de prueba 20r  ' where id = p;
      update public.productos set imagen_url = 'https://ejemplo.invalid/prueba-20r.jpg' where id = p;
      update public.productos set imagen_origen = 'odoo', imagen_odoo_checksum = 'falso', descripcion_origen = 'odoo', descripcion_odoo_md5 = 'falso' where id = p;
      select row_to_json(t)::text into r from (select pr.descripcion, pr.descripcion_origen, pr.imagen_origen, pr.imagen_odoo_checksum, pr.descripcion_odoo_md5,
          pr.descripcion_actualizada_en = now() ahora_desc, pr.imagen_actualizada_en = now() ahora_img,
          (select count(*) from public.odoo_escrituras e where e.tipo = 'producto' and e.referencia_id = p) n,
          (select row_to_json(e) from (select e.estado, e.solicitado_por is not null quien, e.datos -> 'campos' campos from public.odoo_escrituras e
             where e.tipo = 'producto' and e.referencia_id = p order by e.created_at desc limit 1) e) fila
        from public.productos pr where pr.id = p) t;
      return r;
    end $f$;`;
  await caso('Productos→Odoo: el admin cambia descripción y foto → una sola escritura pendiente (quién y campos), sellado "guds" y huellas protegidas',
    (r) => r?.descripcion === 'Descripción de prueba 20r' && r?.descripcion_origen === 'guds' && r?.imagen_origen === 'guds' && r?.ahora_desc && r?.ahora_img
      && r?.imagen_odoo_checksum === null && r?.descripcion_odoo_md5 === null && r?.n === 1 && r?.fila?.estado === 'pendiente' && r?.fila?.quien
      && [...(r?.fila?.campos || [])].sort().join(',') === 'descripcion,imagen',
    como({ empresa: guds.id, previo: previoAdmin }, `select public.p20r_admin('${P}')`));
  const previoQuitar = `create function public.p20r_quitar(p uuid) returns text language plpgsql as $f$
    declare r text;
    begin
      update public.productos set imagen_url = null where id = p;
      select row_to_json(t)::text into r from (select (select count(*) from public.odoo_escrituras e where e.tipo = 'producto' and e.referencia_id = p) n) t;
      return r;
    end $f$;`;
  await caso('Productos→Odoo: quitar la foto no encola nada (GUDS no borra en Odoo)', (r) => r?.n === 0,
    como({ empresa: guds.id, previo: `update public.productos set imagen_url = 'https://ejemplo.invalid/a.jpg' where id = '${P}'; ${previoQuitar}` },
      `select public.p20r_quitar('${P}')`));
  // Intento de cambio + conteo de la cola como postgres (la cola solo la lee administración): cada sentencia ve lo encolado por la anterior
  const previoIntento = `create function public.p20r_contar(p uuid) returns bigint language sql security definer set search_path = public
      as 'select count(*) from odoo_escrituras e where e.tipo = ''producto'' and e.referencia_id = p';
    create function public.p20r_origen(p uuid) returns text language sql security definer set search_path = public
      as 'select coalesce(descripcion_origen, ''-'') || ''/'' || coalesce(imagen_origen, ''-'') from productos where id = p';
    create function public.p20r_intento(p uuid, q text) returns text language plpgsql as $f$
    declare filas int;
    begin
      execute q using p;
      get diagnostics filas = row_count;
      return json_build_object('filas', filas, 'n', public.p20r_contar(p), 'origen', public.p20r_origen(p))::text;
    end $f$;`;
  const intento = (set) => `select public.p20r_intento('${P}', ${lit(`update public.productos set ${set} where id = $1`)})`;
  if (qaVend20r) {
    await caso('Productos→Odoo: un vendedor no cambia la descripción ni encola (RLS)', (r, e) => !!e || (r?.filas === 0 && r?.n === 0),
      como({ uid: qaVend20r, empresa: guds.id, previo: previoIntento }, intento(`descripcion = 'x', imagen_url = 'https://ejemplo.invalid/v.jpg'`)));
    await caso('Productos→Odoo: un vendedor no puede enviar un producto a Odoo', 'No tienes permiso para enviar productos a Odoo',
      como({ uid: qaVend20r, empresa: guds.id }, `select public.enviar_producto_odoo('${P}')::text`));
    await caso('Productos→Odoo: un vendedor no reintenta envíos', 'No tienes permiso para enviar productos a Odoo',
      como({ uid: qaVend20r, empresa: guds.id }, `select public.reintentar_escritura_producto('00000000-0000-0000-0000-000000000000')::text`));
    await caso('Productos→Odoo: un vendedor no lee el modo de escritura de productos ni la cola', (r) => r?.cfg === 0 && r?.cola === 0,
      como({ uid: qaVend20r, empresa: guds.id }, `select row_to_json(t)::text from (select (select count(*) from configuracion where clave = 'odoo_escritura_productos') cfg,
        (select count(*) from odoo_escrituras where tipo = 'producto') cola) t`));
  }
  // Cliente del portal: el de QA (si otra prueba ya le creó perfil se usa ese; si no, uno temporal dentro del bloque)
  const qaCli20r = (await sql(`select id from auth.users where email = 'qa.cliente@guds.test'`))[0]?.id;
  const perfilCli20r = qaCli20r ? (await sql(`select role from usuarios where auth_id = '${qaCli20r}'`))[0] : null;
  if (qaCli20r && (!perfilCli20r || perfilCli20r.role === 'cliente')) {
    const previoCli = perfilCli20r ? '' : `insert into usuarios (auth_id, email, nombre, role, cliente_id, activo) values ('${qaCli20r}', 'qa.cliente@guds.test', 'QA', 'cliente', '${cliGuds}', true);`;
    await caso('Productos→Odoo: un cliente no cambia la descripción ni encola', (r, e) => !!e || (r?.filas === 0 && r?.n === 0),
      como({ uid: qaCli20r, empresa: guds.id, previo: previoCli + previoIntento }, intento(`descripcion = 'x'`)));
    await caso('Productos→Odoo: un cliente no puede enviar un producto a Odoo', 'No tienes permiso para enviar productos a Odoo',
      como({ uid: qaCli20r, empresa: guds.id, previo: previoCli }, `select public.enviar_producto_odoo('${P}')::text`));
  }
  await caso('Productos→Odoo: sin sesión no se envía', 'permission denied',
    como({ rol: 'anon', uid: null, empresa: guds.id }, `select public.enviar_producto_odoo('${P}')::text`));
  await caso('Productos→Odoo: el admin lee el modo (simular/activo)', (r) => ['simular', 'activo'].includes(r?.valor),
    como({ empresa: guds.id }, `select row_to_json(t)::text from (select valor from configuracion where clave = 'odoo_escritura_productos') t`));
  await caso('Productos→Odoo: "Enviar a Odoo" sin nada distinto de Odoo se rechaza', 'ya coinciden con Odoo',
    como({ empresa: guds.id }, `select public.enviar_producto_odoo('${P}')::text`));
  await caso('Productos→Odoo: solo se reintentan envíos existentes', 'Envío no encontrado',
    como({ empresa: guds.id }, `select public.reintentar_escritura_producto('00000000-0000-0000-0000-000000000000')::text`));

  // Sin bucles: lo que escribe la sincronización (sin sesión de usuario, y en modo réplica) no encola ni se sella como "guds"
  await caso('Sin bucle: un cambio de la sincronización (sin usuario) no encola ni marca "guds"', (r) => r?.filas === 1 && r?.n === 0 && r?.origen === '-/-',
    como({ rol: 'postgres', uid: null, empresa: guds.id, previo: previoIntento }, intento(`descripcion = 'Desde Odoo', imagen_url = 'https://ejemplo.invalid/o.jpg'`)));
  await caso('Sin bucle: en modo réplica (como la sincronización) ni siquiera un cambio del admin encola', (r) => r?.filas === 1 && r?.n === 0 && r?.origen === '-/-',
    como({ empresa: guds.id, previo: `execute 'set local session_replication_role = replica'; ${previoIntento}` }, intento(`descripcion = 'x', imagen_url = 'https://ejemplo.invalid/r.jpg'`)));
  await caso('Control: el mismo cambio del admin fuera de réplica sí encola', (r) => r?.filas === 1 && r?.n === 1 && r?.origen === 'guds/guds',
    como({ empresa: guds.id, previo: previoIntento }, intento(`descripcion = 'x', imagen_url = 'https://ejemplo.invalid/r.jpg'`)));

  // Gana el más reciente (descripciones): GUDS cambió hace un momento; Odoo cambió antes → se conserva GUDS; Odoo después → gana Odoo
  const previoDesc = `create function public.p20r_desc(p uuid, oid int) returns text language plpgsql as $f$
    declare a jsonb; b jsonb; c jsonb; d jsonb; r text;
    begin
      update public.productos set descripcion = 'Nueva en GUDS', descripcion_origen = 'guds', descripcion_actualizada_en = now(), descripcion_odoo_md5 = null where id = p;
      a := public.sincronizar_descripciones_odoo(jsonb_build_array(jsonb_build_object('odoo_id', oid, 'descripcion', 'Vieja de Odoo', 'cambio_en', now() - interval '1 hour')));
      select to_jsonb(x) into b from (select descripcion, descripcion_origen, descripcion_odoo_md5 from public.productos where id = p) x;
      c := public.sincronizar_descripciones_odoo(jsonb_build_array(jsonb_build_object('odoo_id', oid, 'descripcion', 'Nueva de Odoo', 'cambio_en', now() + interval '1 minute')));
      select to_jsonb(x) into d from (select descripcion, descripcion_origen, descripcion_odoo_md5 = md5('Nueva de Odoo') huella, descripcion_actualizada_en > now() fecha_odoo,
        (select count(*) from public.odoo_escrituras e where e.tipo = 'producto' and e.referencia_id = p) n from public.productos where id = p) x;
      -- Otra corrida con lo mismo: nada que hacer (idempotente)
      r := jsonb_build_object('a', a, 'b', b, 'c', c, 'd', d, 'e', public.sincronizar_descripciones_odoo(jsonb_build_array(jsonb_build_object('odoo_id', oid, 'descripcion', 'Nueva de Odoo', 'cambio_en', now() + interval '1 minute'))))::text;
      return r;
    end $f$;`;
  const oid20r = (await sql(`select odoo_id from productos where id = '${P}'`))[0].odoo_id;
  await caso('Gana el más reciente: descripción de GUDS más nueva se conserva; la de Odoo más nueva la reemplaza; sin encolar y sin repetir',
    (r) => r?.a?.guds_mas_reciente === 1 && r?.b?.descripcion === 'Nueva en GUDS' && r?.b?.descripcion_odoo_md5 === null
      && r?.c?.traidas === 1 && r?.d?.descripcion === 'Nueva de Odoo' && r?.d?.descripcion_origen === 'odoo' && r?.d?.huella && r?.d?.fecha_odoo && r?.d?.n === 0
      && r?.e?.traidas === 0 && r?.e?.iguales === 0 && r?.e?.guds_mas_reciente === 0,
    como({ rol: 'postgres', uid: null, previo: previoDesc }, `select public.p20r_desc('${P}', ${oid20r})`));
  // Lo que GUDS ya escribió en Odoo (huella guardada por el escritor) no vuelve como cambio de Odoo
  await caso('Sin bucle: la descripción que GUDS escribió en Odoo no regresa como cambio de Odoo', (r) => r?.s?.traidas === 0 && r?.s?.iguales === 0 && r?.origen === 'guds',
    como({ rol: 'postgres', uid: null, previo: `update public.productos set descripcion = 'Escrita por GUDS', descripcion_origen = 'guds', descripcion_actualizada_en = now() - interval '1 minute',
        descripcion_odoo_md5 = md5('Escrita por GUDS') where id = '${P}';` },
      `select row_to_json(t)::text from (select public.sincronizar_descripciones_odoo(jsonb_build_array(jsonb_build_object('odoo_id', ${oid20r}, 'descripcion', 'Escrita por GUDS',
        'cambio_en', now()))) s, (select descripcion_origen from productos where id = '${P}') origen) t`));

  // Gana el más reciente (fotos): decisión por huella y fecha; aplicar trae la de Odoo y no se repite
  const previoImg = `create function public.p20r_img(p uuid, oid int) returns text language plpgsql as $f$
    declare r jsonb := '{}'::jsonb; d record; ap jsonb;
    begin
      update public.productos set imagen_url = 'https://ejemplo.invalid/guds.jpg', imagenes = '["https://ejemplo.invalid/guds.jpg","https://ejemplo.invalid/b.jpg"]',
        imagen_origen = 'guds', imagen_actualizada_en = now(), imagen_odoo_checksum = null, imagen_odoo_url = null where id = p;
      select accion into d from public.decidir_imagenes_odoo(jsonb_build_array(jsonb_build_object('odoo_id', oid, 'checksum', 'ck1', 'mimetype', 'image/jpeg', 'cambio_en', now() - interval '1 hour')));
      r := r || jsonb_build_object('vieja', d.accion);
      select * into d from public.decidir_imagenes_odoo(jsonb_build_array(jsonb_build_object('odoo_id', oid, 'checksum', 'ck1', 'mimetype', 'image/jpeg', 'cambio_en', now() + interval '1 minute')));
      r := r || jsonb_build_object('nueva', d.accion);
      ap := public.aplicar_imagenes_odoo(jsonb_build_array(jsonb_build_object('producto_id', p, 'accion', 'traer', 'checksum', 'ck1', 'url', 'https://ejemplo.invalid/odoo.jpg',
        'cambio_en', d.cambio_en, 'url_previa', d.url_previa, 'checksum_previo', d.checksum_previo, 'odoo_url_previa', d.odoo_url_previa)));
      r := r || jsonb_build_object('aplicar', ap) || (select jsonb_build_object('url', imagen_url, 'imagenes', imagenes, 'origen', imagen_origen, 'ck', imagen_odoo_checksum)
        from public.productos where id = p);
      -- Misma huella en la próxima corrida: nada que traer
      r := r || jsonb_build_object('repite', (select count(*) from public.decidir_imagenes_odoo(jsonb_build_array(jsonb_build_object('odoo_id', oid, 'checksum', 'ck1',
        'mimetype', 'image/jpeg', 'cambio_en', now() + interval '2 minute')))));
      -- Si el producto cambió mientras se descargaba, no se aplica
      r := r || jsonb_build_object('cambiado', public.aplicar_imagenes_odoo(jsonb_build_array(jsonb_build_object('producto_id', p, 'accion', 'traer', 'checksum', 'ck2',
        'url', 'https://ejemplo.invalid/odoo2.jpg', 'cambio_en', now(), 'url_previa', 'https://ejemplo.invalid/otra.jpg', 'checksum_previo', 'ck1'))) -> 'aplicadas');
      -- Odoo quitó la foto (y fue después): se quita en GUDS y la galería sigue con la siguiente
      select * into d from public.decidir_imagenes_odoo(jsonb_build_array(jsonb_build_object('odoo_id', oid, 'checksum', null, 'cambio_en', now() + interval '3 minute')));
      ap := public.aplicar_imagenes_odoo(jsonb_build_array(jsonb_build_object('producto_id', p, 'accion', d.accion, 'cambio_en', d.cambio_en, 'url_previa', d.url_previa,
        'checksum_previo', d.checksum_previo, 'odoo_url_previa', d.odoo_url_previa)));
      r := r || jsonb_build_object('quitar', d.accion, 'sin_uso', ap -> 'sin_uso') || (select jsonb_build_object('url_q', imagen_url, 'imagenes_q', imagenes, 'ck_q', imagen_odoo_checksum)
        from public.productos where id = p);
      r := r || jsonb_build_object('n', (select count(*) from public.odoo_escrituras e where e.tipo = 'producto' and e.referencia_id = p));
      return r::text;
    end $f$;`;
  await caso('Gana el más reciente: foto de GUDS más nueva se conserva; la de Odoo más nueva se trae (principal y galería) sin repetirse; quitar en Odoo se refleja',
    (r) => r?.vieja === 'guds_mas_reciente' && r?.nueva === 'traer' && r?.aplicar?.aplicadas === 1 && r?.url === 'https://ejemplo.invalid/odoo.jpg'
      && JSON.stringify(r?.imagenes) === JSON.stringify(['https://ejemplo.invalid/odoo.jpg', 'https://ejemplo.invalid/b.jpg']) && r?.origen === 'odoo' && r?.ck === 'ck1'
      && r?.repite === 0 && r?.cambiado === 0 && r?.quitar === 'quitar' && JSON.stringify(r?.sin_uso) === JSON.stringify(['https://ejemplo.invalid/odoo.jpg'])
      && r?.url_q === 'https://ejemplo.invalid/b.jpg' && JSON.stringify(r?.imagenes_q) === JSON.stringify(['https://ejemplo.invalid/b.jpg']) && r?.ck_q === null && r?.n === 0,
    como({ rol: 'postgres', uid: null, previo: previoImg }, `select public.p20r_img('${P}', ${oid20r})`));

  await caso('Productos→Odoo: funciones internas cerradas (anon y authenticated) y las de la API sin anon', (r) => r?.n === 0,
    como({}, `select row_to_json(t)::text from (select count(*) n from pg_proc p where p.pronamespace = 'public'::regnamespace and (
      (p.proname in ('contenido_odoo_gana', 'imagenes_con_principal', 'sincronizar_descripciones_odoo', 'decidir_imagenes_odoo', 'aplicar_imagenes_odoo',
         'encolar_escritura_producto', 'trg_producto_contenido_odoo', 'trg_producto_contenido_odoo_encolar')
        and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')))
      or (p.proname in ('enviar_producto_odoo', 'reintentar_escritura_producto', 'puede_editar_producto_odoo') and has_function_privilege('anon', p.oid, 'execute')))) t`));
  await caso('Productos→Odoo: las funciones con privilegios validan al llamador (security definer + auth.uid/permiso)', (r) => r?.n === 3,
    como({}, `select row_to_json(t)::text from (select count(*) n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
      and p.proname in ('enviar_producto_odoo', 'reintentar_escritura_producto', 'trg_producto_contenido_odoo_encolar')
      and pg_get_functiondef(p.oid) ~ 'puede_editar_producto_odoo\\(\\)') t`));
}

// ── Clientes nuevos, contactos y límites → Odoo (20s): aprobar sin duplicar (RIF o nombre), enlazar o elegir, contactos y
//    límites a la cola, solo administración, funciones internas cerradas y reglas del escritor (sin tocar Odoo) ──
{
  const qaVend20s = (await sql(`select a.id from auth.users a join usuarios u on u.auth_id = a.id where a.email = 'qa.vendedor@guds.test' and u.role = 'vendedor'`))[0]?.id || vendGuds;
  const qaCli20s = (await sql(`select id from auth.users where email = 'qa.cliente@guds.test'`))[0]?.id;
  const perfilCli20s = qaCli20s ? (await sql(`select role from usuarios where auth_id = '${qaCli20s}'`))[0] : null;
  const previoCli20s = qaCli20s && !perfilCli20s
    ? `insert into usuarios (auth_id, email, nombre, role, cliente_id, activo) values ('${qaCli20s}', 'qa.cliente@guds.test', 'QA', 'cliente', '${cliGuds}', true);` : '';
  const adminUsr = (await sql(`select id from usuarios where auth_id = '${admin}'`))[0].id;
  // Cliente real de GUDS (de Odoo) con RIF válido que no está en Quirutec ni compartido: referencia para "ya existe" (el bloque se deshace)
  const [ref20s] = await sql(`select c.id, c.nombre_negocio, c.rif from clientes c where c.empresa_id = '${guds.id}' and c.odoo_id is not null and c.activo
    and public.clave_rif(c.rif) ~ '^[JVG][0-9]{8}$' and length(public.normalizar_nombre_empresa(c.nombre_negocio)) > 6
    and not exists (select 1 from clientes q where q.id <> c.id and public.clave_rif(q.rif) = public.clave_rif(c.rif))
    and not exists (select 1 from clientes d where d.id <> c.id and (d.empresa_id = '${guds.id}' or d.empresa_id is null)
      and public.normalizar_nombre_empresa(d.nombre_negocio) = public.normalizar_nombre_empresa(c.nombre_negocio))
    order by c.created_at limit 1`);
  const rifSinDv = ref20s.rif.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 9);          // "J-12345678-9" → "J12345678"
  const U = (n) => `00000000-0000-0000-0000-0000000a20${String(n).padStart(2, '0')}`;
  const reg = (id, nombre, rif, emp = guds.id, ciudad = 'Valencia') => `insert into public.registros_clientes (id, nombre_negocio, nombre_contacto,
    email, telefono, direccion, ciudad, rif, tipo_negocio, estado, empresa_id)
    values ('${id}', ${lit(nombre)}, 'Ana Prueba', 'registro.20s.${id.slice(-2)}@guds.test', '0414-0000000', 'Av. Ficticia 1', ${lit(ciudad)}, ${lit(rif)}, 'Farmacia', 'pendiente', '${emp}');`;
  // Aprueba como el usuario del bloque y devuelve lo que quedó (cada sentencia ve lo que hizo la anterior)
  const fnAprobar = `create function public.p20s_aprobar(p uuid) returns text language plpgsql as $f$
    declare v record; r text;
    begin
      select * into v from public.aprobar_registro_cliente(p);
      select row_to_json(t)::text into r from (select
        v.cliente_id = (select cliente_creado_id from public.registros_clientes where id = p) ligado,
        (select count(*) from public.clientes where registro_origen_id = p) nuevos,
        (select row_to_json(c) from (select odoo_vinculo, estado, es_empresa, empresa_id, calle from public.clientes where id = v.cliente_id) c) cli,
        (select row_to_json(g) from (select uso_cliente_existente, coincidencia, estado from public.registros_clientes where id = p) g) reg,
        (select u.cliente_id = v.cliente_id and u.debe_cambiar_clave from public.usuarios u where lower(u.email) = lower(v.email)) acceso,
        (select row_to_json(e) from (select estado, solicitado_por is not null quien, datos ->> 'registro_id' = p::text del_registro, datos ->> 'origen' origen
           from public.odoo_escrituras where tipo = 'cliente_nuevo' and referencia_id = v.cliente_id limit 1) e) cola,
        (select count(*) from public.odoo_escrituras where tipo = 'cliente_nuevo' and referencia_id = v.cliente_id) n_cola,
        v.cliente_id::text cliente) t;
      return r;
    end $f$;`;
  const aprobar = (id) => `select public.p20s_aprobar('${id}')`;

  // Permisos
  await caso('Clientes nuevos→Odoo: sin sesión no se previsualiza ni se aprueba', 'permission denied',
    como({ rol: 'anon', uid: null, empresa: guds.id }, `select public.previsualizar_registro_cliente('${U(1)}')::text`));
  await caso('Clientes nuevos→Odoo: sin sesión no se elige, completa ni envía nada', (r, e) => /permission denied/.test(e || ''),
    como({ rol: 'anon', uid: null, empresa: guds.id }, `select public.elegir_cliente_odoo('${cliGuds}', 1)::text`));
  for (const [fn, args] of [['completar_cliente_odoo', `'${cliGuds}', '{}'::jsonb`], ['enviar_cliente_odoo', `'${cliGuds}'`], ['enviar_contactos_odoo', `'${cliGuds}'`],
    ['enviar_limite_credito_odoo', `'${cliGuds}'`], ['estado_odoo_cliente', `'${cliGuds}'`]]) {
    await caso(`Clientes nuevos→Odoo: sin sesión no se ejecuta ${fn}`, 'permission denied',
      como({ rol: 'anon', uid: null, empresa: guds.id }, `select public.${fn}(${args})::text`));
  }
  if (qaVend20s) {
    await caso('Clientes nuevos→Odoo: un vendedor no previsualiza ni aprueba registros', 'No tienes permiso para aprobar registros',
      como({ uid: qaVend20s, empresa: guds.id, previo: reg(U(1), 'Prueba 20s Ficticia Uno', 'J-99999997-0') }, `select public.previsualizar_registro_cliente('${U(1)}')::text`));
    await caso('Clientes nuevos→Odoo: un vendedor no elige coincidencias ni envía clientes a Odoo', 'No tienes permiso para crear o enlazar',
      como({ uid: qaVend20s, empresa: guds.id }, `select public.elegir_cliente_odoo('${cliGuds}', 1)::text`));
    await caso('Clientes nuevos→Odoo: un vendedor no envía contactos ni límites', 'No tienes permiso para editar',
      como({ uid: qaVend20s, empresa: guds.id }, `select public.enviar_contactos_odoo('${cliGuds}')::text`));
    await caso('Clientes nuevos→Odoo: un vendedor no ve el estado de Odoo del cliente', 'No tienes permiso para ver el estado',
      como({ uid: qaVend20s, empresa: guds.id }, `select public.estado_odoo_cliente('${cliGuds}')::text`));
  }
  if (qaCli20s && (!perfilCli20s || perfilCli20s.role === 'cliente')) {
    await caso('Clientes nuevos→Odoo: un cliente del portal no aprueba registros', 'No tienes permiso para aprobar registros',
      como({ uid: qaCli20s, empresa: guds.id, previo: previoCli20s + reg(U(1), 'Prueba 20s Ficticia Uno', 'J-99999997-0') },
        `select row_to_json(t)::text from public.aprobar_registro_cliente('${U(1)}') t`));
    await caso('Clientes nuevos→Odoo: un cliente del portal no elige ni envía a Odoo', 'No tienes permiso para crear o enlazar',
      como({ uid: qaCli20s, empresa: guds.id, previo: previoCli20s }, `select public.enviar_cliente_odoo('${cliGuds}')::text`));
  }

  // Aprobación de un cliente nuevo: se crea en GUDS (estado inferido de la ciudad) y su alta en Odoo queda en cola
  await caso('Clientes nuevos→Odoo: aprobar un registro nuevo crea el cliente y encola su alta en Odoo (pendiente, quién, del registro)',
    (r) => r?.ligado && r?.nuevos === 1 && r?.cli?.odoo_vinculo === 'pendiente' && r?.cli?.estado === 'Carabobo' && r?.cli?.es_empresa === true
      && r?.cli?.calle === 'Av. Ficticia 1' && r?.reg?.uso_cliente_existente === false && r?.reg?.estado === 'aprobado' && r?.acceso === true
      && r?.n_cola === 1 && r?.cola?.estado === 'pendiente' && r?.cola?.quien && r?.cola?.del_registro && r?.cola?.origen === 'registro',
    como({ empresa: guds.id, previo: reg(U(2), 'Prueba 20s Ficticia Dos', 'J-99999997-0') + fnAprobar }, aprobar(U(2))));
  // Sin duplicar en GUDS: mismo RIF (sin dígito verificador) o mismo nombre → se usa el cliente existente y no se encola nada
  await caso('Clientes nuevos→Odoo: mismo RIF en otro formato → no se crea otro cliente; el acceso queda ligado al existente',
    (r) => r?.ligado && r?.nuevos === 0 && r?.cliente === ref20s.id && r?.reg?.uso_cliente_existente === true && r?.reg?.coincidencia === 'rif'
      && r?.acceso === true && r?.n_cola === 0,
    como({ empresa: guds.id, previo: reg(U(3), 'Prueba 20s Otro Nombre Ficticio', rifSinDv) + fnAprobar }, aprobar(U(3))));
  await caso('Clientes nuevos→Odoo: mismo nombre (otro formato, "C.A.") → no se crea otro cliente; coincidencia por nombre',
    (r) => r?.nuevos === 0 && r?.cliente === ref20s.id && r?.reg?.coincidencia === 'nombre' && r?.n_cola === 0,
    como({ empresa: guds.id, previo: reg(U(4), `${ref20s.nombre_negocio.toLowerCase().replace(/,?\s*c\.?\s*a\.?$/i, '')} c.a.`, 'J-99999996-4') + fnAprobar }, aprobar(U(4))));
  await caso('Clientes nuevos→Odoo: el mismo RIF en la otra empresa sí crea su cliente (y su alta en Odoo)',
    (r) => r?.nuevos === 1 && r?.cli?.empresa_id === qrt.id && r?.reg?.uso_cliente_existente === false && r?.n_cola === 1,
    como({ empresa: qrt.id, previo: reg(U(5), 'Prueba 20s Ficticia Cinco', rifSinDv, qrt.id) + fnAprobar }, aprobar(U(5))));
  await caso('Clientes nuevos→Odoo: la vista previa dice qué pasará (existente por RIF / crear en Odoo con el estado inferido)',
    (r) => r?.a?.accion === 'usar_existente' && r?.a?.existente?.id === ref20s.id && r?.a?.existente?.coincidencia === 'rif'
      && r?.b?.accion === 'crear_odoo' && r?.b?.estado_ve === 'Carabobo' && r?.b?.estado_inferido === true && r?.b?.rif_valido === true && ['simular', 'activo'].includes(r?.b?.modo),
    como({ empresa: guds.id, previo: reg(U(3), 'Prueba 20s Otro Nombre Ficticio', rifSinDv) + reg(U(2), 'Prueba 20s Ficticia Dos', 'J-99999997-0') },
      `select json_build_object('a', public.previsualizar_registro_cliente('${U(3)}'), 'b', public.previsualizar_registro_cliente('${U(2)}'))::text`));
  await caso('Clientes nuevos→Odoo: el alta manual de un cliente sin RIF repetido también se encola (y no se puede fijar su odoo_id)',
    (r) => r?.odoo_id === null && r?.vinculo === 'pendiente' && r?.n === 1 && r?.origen === 'manual',
    como({ empresa: guds.id, previo: `create function public.p20s_manual() returns text language plpgsql as $f$
        declare v uuid; r text;
        begin
          insert into public.clientes (codigo, nombre_negocio, rif, tipo_negocio, odoo_id) values ('PRUEBA-20S', 'Prueba 20s Ficticia Manual', 'J-99999995-8', 'Farmacia', 987654321)
            returning id into v;
          select row_to_json(t)::text into r from (select c.odoo_id, c.odoo_vinculo vinculo,
            (select count(*) from public.odoo_escrituras e where e.tipo = 'cliente_nuevo' and e.referencia_id = v) n,
            (select e.datos ->> 'origen' from public.odoo_escrituras e where e.tipo = 'cliente_nuevo' and e.referencia_id = v limit 1) origen
            from public.clientes c where c.id = v) t;
          return r;
        end $f$;` }, `select public.p20s_manual()`));
  await caso('Clientes nuevos→Odoo: "J-12345678" y "J-12345678-9" ya cuentan como el mismo RIF al dar de alta', 'Ya existe un cliente',
    como({ empresa: guds.id }, `with x as (insert into clientes (codigo, nombre_negocio, rif, tipo_negocio) values ('PRUEBA-20S', 'Prueba 20s Ficticia Rif', ${lit(rifSinDv)}, 'Empresa')
      returning id) select row_to_json(x)::text from x`));

  // Enlace (lo hace la función edge como postgres): liga, reenvía pedidos que esperaban, encola contactos activos y el límite
  const cliPrueba = (id, nombre, rif) => `insert into public.clientes (id, codigo, nombre_negocio, rif, tipo_negocio, empresa_id, limite_credito)
    values ('${id}', 'PRUEBA-20S-${id.slice(-2)}', ${lit(nombre)}, ${lit(rif)}, 'Farmacia', '${guds.id}', 150);`;
  const previoVinculo = `perform set_config('request.headers', '${hdr(guds.id)}', true);
    ${cliPrueba(U(10), 'Prueba 20s Ficticia Vinculo', 'J-99999994-1')}
    insert into public.ordenes (cliente_id, subtotal, total, estado, empresa_id, aprobacion, aprobado_por, aprobado_at, odoo_envio_error)
      values ('${U(10)}', 1, 1, 'pendiente', '${guds.id}', 'aprobada', '${adminUsr}', now(), 'El cliente X no existe en Odoo (primero hay que crearlo)');
    insert into public.cliente_contactos (cliente_id, nombre, activo) values ('${U(10)}', 'Contacto Activo', true), ('${U(10)}', 'Contacto Inactivo', false);
    ${cliPrueba(U(11), 'Prueba 20s Ficticia Otro', 'J-99999993-5')}`;
  await caso('Clientes nuevos→Odoo: al crearse en Odoo el cliente queda ligado, sus pedidos se reenvían y se encolan su contacto activo y su límite',
    (r) => r?.v?.pedidos_reenviados === 1 && r?.v?.contactos_encolados === 1 && r?.v?.limite_encolado === true && r?.c?.odoo_id === 999999001
      && r?.c?.odoo_vinculo === 'creado' && r?.c?.limite_credito_pendiente === true && r?.err === 0 && r?.k === 1 && r?.l === 1 && /ya está ligado/.test(r?.otro || ''),
    como({ rol: 'postgres', uid: null, empresa: guds.id, previo: previoVinculo + `create function public.p20s_vinculo() returns text language plpgsql as $f$
        declare v jsonb; o text;
        begin
          v := public.aplicar_vinculo_cliente_odoo('${U(10)}', 999999001, 'creado', '{}'::jsonb);
          begin perform public.aplicar_vinculo_cliente_odoo('${U(11)}', 999999001, 'enlazado', '{}'::jsonb); exception when others then o := sqlerrm; end;
          return json_build_object('v', v, 'otro', o,
            'c', (select row_to_json(c) from (select odoo_id, odoo_vinculo, limite_credito_pendiente from public.clientes where id = '${U(10)}') c),
            'err', (select count(*) from public.ordenes where cliente_id = '${U(10)}' and odoo_envio_error is not null),
            'k', (select count(*) from public.odoo_escrituras where tipo = 'persona_contacto' and datos ->> 'cliente_id' = '${U(10)}'),
            'l', (select count(*) from public.odoo_escrituras where tipo = 'cliente_limite' and referencia_id = '${U(10)}'))::text;
        end $f$;` }, `select public.p20s_vinculo()`));
  await caso('Clientes nuevos→Odoo: al enlazar con uno que ya existía en Odoo, manda Odoo (el límite de GUDS no se envía)',
    (r) => r?.v?.limite_encolado === false && r?.c?.odoo_vinculo === 'enlazado' && r?.c?.limite_credito_pendiente === false,
    como({ rol: 'postgres', uid: null, empresa: guds.id, previo: previoVinculo + `create function public.p20s_enlace() returns text language plpgsql as $f$
        declare v jsonb;
        begin
          v := public.aplicar_vinculo_cliente_odoo('${U(10)}', 999999002, 'enlazado', '{}'::jsonb);
          return json_build_object('v', v, 'c', (select row_to_json(c) from (select odoo_vinculo, limite_credito_pendiente from public.clientes where id = '${U(10)}') c))::text;
        end $f$;` }, `select public.p20s_enlace()`));

  // Varias coincidencias: queda para que administración elija; solo entre los candidatos; "crear nuevo" solo sin RIF igual
  const previoVarias = (cands) => `perform set_config('request.headers', '${hdr(guds.id)}', true);
    ${cliPrueba(U(12), 'Prueba 20s Ficticia Varias', 'J-99999992-9')}
    perform public.registrar_revision_cliente_odoo('${U(12)}', ${lit(JSON.stringify({ candidatos: cands }))}::jsonb);
    create function public.p20s_elegir(p int) returns text language plpgsql as $f$
    declare r jsonb := '{}'; x uuid;
    begin
      r := r || jsonb_build_object('vinculo', (select odoo_vinculo from public.clientes where id = '${U(12)}'));
      begin perform public.elegir_cliente_odoo('${U(12)}', 999999555); exception when others then r := r || jsonb_build_object('ajeno', sqlerrm); end;
      begin perform public.elegir_cliente_odoo('${U(12)}', null); r := r || jsonb_build_object('crear', 'ok'); exception when others then r := r || jsonb_build_object('crear', sqlerrm); end;
      if not r ? 'crear' or r ->> 'crear' <> 'ok' then
        x := public.elegir_cliente_odoo('${U(12)}', p);
        r := r || jsonb_build_object('elegido', (select datos -> 'elegido' from public.odoo_escrituras where id = x));
      else
        r := r || jsonb_build_object('elegido', (select datos -> 'elegido' from public.odoo_escrituras where tipo = 'cliente_nuevo' and referencia_id = '${U(12)}' order by created_at desc limit 1));
      end if;
      begin perform public.elegir_cliente_odoo('${U(12)}', p); exception when others then r := r || jsonb_build_object('doble', sqlerrm); end;
      return r::text;
    end $f$;`;
  await caso('Clientes nuevos→Odoo: varias coincidencias por RIF → el admin elige una de ellas (no un contacto cualquiera, no "crear otro", no dos veces)',
    (r) => r?.vinculo === 'varias' && /no está entre las coincidencias/.test(r?.ajeno || '') && /mismo RIF/.test(r?.crear || '') && r?.elegido === 999999101 && /en curso/.test(r?.doble || ''),
    como({ empresa: guds.id, previo: previoVarias([{ id: 999999101, coincide: 'rif' }, { id: 999999102, coincide: 'rif' }]) }, `select public.p20s_elegir(999999101)`));
  await caso('Clientes nuevos→Odoo: coincidencias solo por nombre (otro RIF) → el admin puede crear un cliente nuevo en Odoo',
    (r) => r?.crear === 'ok' && r?.elegido === 'crear',
    como({ empresa: guds.id, previo: previoVarias([{ id: 999999103, coincide: 'nombre', rif_distinto: true }]) }, `select public.p20s_elegir(999999103)`));

  // Límite de crédito: pendiente → a la cola al editarlo; se apaga al escribirse (solo si no cambió mientras tanto)
  await caso('Límites→Odoo: el admin edita el límite de un cliente de Odoo → pendiente y a la cola',
    (r) => r?.pendiente === true && r?.n === 1,
    como({ empresa: guds.id, previo: `create function public.p20s_limite(c uuid) returns text language plpgsql as $f$
        begin
          update public.clientes set limite_credito = coalesce(limite_credito, 0) + 123 where id = c;
          return json_build_object('pendiente', (select limite_credito_pendiente from public.clientes where id = c),
            'n', (select count(*) from public.odoo_escrituras where tipo = 'cliente_limite' and referencia_id = c and estado = 'pendiente'))::text;
        end $f$;` }, `select public.p20s_limite('${cliOdoo}')`));
  await caso('Límites→Odoo: al quedar escrito en Odoo se apaga el pendiente; si el límite cambió mientras tanto, sigue pendiente',
    (r) => r?.a === true && r?.pa === false && r?.b === false && r?.pb === true,
    como({ rol: 'postgres', uid: null, empresa: guds.id, previo: `${cliPrueba(U(13), 'Prueba 20s Ficticia Limite', 'J-99999991-2')}
        ${cliPrueba(U(14), 'Prueba 20s Ficticia Limite Dos', 'J-99999990-6')}
        update public.clientes set limite_credito_pendiente = true where id in ('${U(13)}', '${U(14)}');
        create function public.p20s_marcar() returns text language plpgsql as $f$
        declare a boolean; b boolean;
        begin
          a := public.marcar_limite_credito_enviado('${U(13)}', 150);
          b := public.marcar_limite_credito_enviado('${U(14)}', 99);
          return json_build_object('a', a, 'pa', (select limite_credito_pendiente from public.clientes where id = '${U(13)}'),
            'b', b, 'pb', (select limite_credito_pendiente from public.clientes where id = '${U(14)}'))::text;
        end $f$;` }, `select public.p20s_marcar()`));
  if (qaVend20s) {
    await caso('Límites→Odoo: un vendedor no cambia límites (ni encola)', (r, e) => !!e || r?.n === 0,
      como({ uid: qaVend20s, empresa: guds.id }, `with x as (update clientes set limite_credito = 1 where id = '${cliOdoo}' returning id) select row_to_json(t)::text from (select count(*) n from x) t`));
  }

  // Contactos: el admin los crea o edita → a la cola; desactivar no se envía; nadie fija su odoo_id; sin cliente en Odoo esperan
  await caso('Contactos→Odoo: crear y editar se encolan; desactivar no; el odoo_id no se fija desde la API; los de un cliente sin Odoo esperan',
    (r) => r?.crear === 1 && r?.odoo_id === null && r?.editar === 1 && r?.desactivar === 0 && r?.sin_odoo === 0,
    como({ empresa: guds.id, previo: `${cliPrueba(U(15), 'Prueba 20s Ficticia Sin Odoo', 'J-99999989-1')}
        create function public.p20s_contactos(c uuid) returns text language plpgsql as $f$
        declare k uuid; k2 uuid; r jsonb := '{}'; n0 int;
        begin
          insert into public.cliente_contactos (cliente_id, nombre, cargo, odoo_id) values (c, 'Contacto Prueba 20s', 'Compras', 123456789) returning id into k;
          r := r || jsonb_build_object('crear', (select count(*) from public.odoo_escrituras where tipo = 'persona_contacto' and referencia_id = k and datos ->> 'accion' = 'crear'),
            'odoo_id', (select odoo_id from public.cliente_contactos where id = k));
          perform public.p20s_fijar(k);
          update public.cliente_contactos set cargo = 'Gerente de compras' where id = k;
          r := r || jsonb_build_object('editar', (select count(*) from public.odoo_escrituras where tipo = 'persona_contacto' and referencia_id = k and datos ->> 'accion' = 'editar'));
          n0 := (select count(*) from public.odoo_escrituras where tipo = 'persona_contacto' and referencia_id = k);
          update public.cliente_contactos set activo = false where id = k;
          r := r || jsonb_build_object('desactivar', (select count(*) from public.odoo_escrituras where tipo = 'persona_contacto' and referencia_id = k) - n0);
          insert into public.cliente_contactos (cliente_id, nombre) values ('${U(15)}', 'Contacto Espera') returning id into k2;
          r := r || jsonb_build_object('sin_odoo', (select count(*) from public.odoo_escrituras where tipo = 'persona_contacto' and referencia_id = k2));
          return r::text;
        end $f$;
        create function public.p20s_fijar(k uuid) returns void language plpgsql security definer set search_path = public as $x$
        declare c text := current_setting('request.jwt.claims', true);
        begin
          -- Como la función edge (sin sesión de usuario): liga el contacto y da por hecho su envío
          perform set_config('request.jwt.claims', '', true);
          update cliente_contactos set odoo_id = 999999201 where id = k;
          update odoo_escrituras set estado = 'hecha' where referencia_id = k;
          perform set_config('request.jwt.claims', c, true);
        end $x$;` },
      `select public.p20s_contactos('${cliOdoo}')`));
  if (qaVend20s) {
    await caso('Contactos→Odoo: un vendedor no crea contactos de clientes (ni encola)', (r, e) => !!e || r?.n === 0,
      como({ uid: qaVend20s, empresa: guds.id }, `with x as (insert into cliente_contactos (cliente_id, nombre) values ('${cliOdoo}', 'Contacto Vendedor') returning id)
        select row_to_json(t)::text from (select count(*) n from x) t`));
  }

  // Registro público: siempre entra pendiente y sin datos de revisión; el estado de Venezuela se normaliza
  await caso('Registro público: entra pendiente aunque lo manden aprobado; el estado de Venezuela se normaliza',
    (r) => r?.estado === 'pendiente' && r?.cliente_creado_id === null && r?.uso_cliente_existente === false && r?.estado_ve === 'Bolívar',
    como({ rol: 'anon', uid: null, empresa: guds.id, previo: `create function public.p20s_leer_registro(p uuid) returns text language sql security definer set search_path = public
        as 'select row_to_json(t)::text from (select estado, cliente_creado_id, uso_cliente_existente, estado_ve from registros_clientes where id = p) t';
        grant execute on function public.p20s_leer_registro(uuid) to anon;
        create function public.p20s_registro_anon() returns text language plpgsql as $f$
        begin
          insert into public.registros_clientes (id, nombre_negocio, nombre_contacto, email, telefono, direccion, ciudad, rif, tipo_negocio, estado, empresa_id,
            cliente_creado_id, uso_cliente_existente, estado_ve)
          values ('${U(20)}', 'Prueba 20s Ficticia Anonima', 'Ana', 'registro.20s.anon@guds.test', '0414', 'Calle 1', 'Ciudad Bolívar', 'J-99999988-4', 'Farmacia',
            'aprobado', '${guds.id}', '${cliGuds}', true, 'Bolivar. (VE)');
          return public.p20s_leer_registro('${U(20)}');
        end $f$;
        grant execute on function public.p20s_registro_anon() to anon;` }, `select public.p20s_registro_anon()`));

  // Reglas de datos (SQL): RIF y estado inferido
  await caso('Clave de RIF: J-12345678-9 = J123456789 = J-12345678; cédula de 7 dígitos con 0; N/D sin clave',
    (r) => r?.a === 'J12345678' && r?.a === r?.b && r?.a === r?.c && r?.d === 'V01234567' && r?.e === null,
    como({ rol: 'postgres', uid: null }, `select json_build_object('a', public.clave_rif('J-12345678-9'), 'b', public.clave_rif('j123456789'), 'c', public.clave_rif('J-12345678'),
      'd', public.clave_rif('V-1234567'), 'e', public.clave_rif('N/D'))::text`));
  await caso('Estado inferido: "Valencia" → Carabobo, "Av. Bolívar, Caracas" → Distrito Capital, "Edo. Miranda", "Ciudad Bolívar"; texto sin pistas → nada',
    (r) => r?.a === 'Carabobo' && r?.b === 'Distrito Capital' && r?.c === 'Miranda' && r?.d === 'Bolívar' && r?.e === null,
    como({ rol: 'postgres', uid: null }, `select json_build_object('a', public.inferir_estado_ve('Valencia'), 'b', public.inferir_estado_ve('Av. Bolívar, Caracas'),
      'c', public.inferir_estado_ve('Sector La Macarena, Edo. Miranda'), 'd', public.inferir_estado_ve('Ciudad Bolívar'), 'e', public.inferir_estado_ve('Calle 5 con Av. 3'))::text`));

  // Funciones internas cerradas; las de la API sin anon; las SECURITY DEFINER validan al llamador
  await caso('Clientes nuevos→Odoo: funciones internas cerradas (anon y authenticated) y las de la API sin anon', (r) => r?.n === 0,
    como({}, `select row_to_json(t)::text from (select count(*) n from pg_proc p where p.pronamespace = 'public'::regnamespace and (
      (p.proname in ('clave_rif', 'inferir_estado_ve', 'buscar_cliente_existente', 'nombre_usuario_actual', 'encolar_cliente_nuevo', 'aplicar_vinculo_cliente_odoo',
         'registrar_revision_cliente_odoo', 'registrar_error_cliente_odoo', 'marcar_limite_credito_enviado', 'trg_cliente_odoo_protegido', 'trg_contacto_odoo_protegido',
         'trg_registro_cliente_normalizar', 'trg_cliente_sin_duplicados', 'trg_cliente_nuevo_odoo', 'trg_contacto_odoo_encolar', 'trg_cliente_limite_odoo_encolar', 'encolar_escritura_odoo')
        and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')))
      or (p.proname in ('aprobar_registro_cliente', 'previsualizar_registro_cliente', 'puede_crear_cliente_odoo', 'elegir_cliente_odoo', 'completar_cliente_odoo',
         'enviar_cliente_odoo', 'enviar_contactos_odoo', 'enviar_limite_credito_odoo', 'reintentar_escritura_cliente', 'historial_escrituras_cliente', 'estado_odoo_cliente')
        and has_function_privilege('anon', p.oid, 'execute')))) t`));
  await caso('Clientes nuevos→Odoo: las acciones SECURITY DEFINER validan al llamador (sesión + permiso de administración)', (r) => r?.n === 10 && r?.total === 10,
    como({}, `select row_to_json(t)::text from (select count(*) filter (where pg_get_functiondef(p.oid) ~ '(puede_crear_cliente_odoo|puede_editar_cliente_odoo)\\(|es_personal_admin\\(\\)') n,
      count(*) total from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
      and p.proname in ('aprobar_registro_cliente', 'previsualizar_registro_cliente', 'elegir_cliente_odoo', 'completar_cliente_odoo', 'enviar_cliente_odoo',
        'enviar_contactos_odoo', 'enviar_limite_credito_odoo', 'reintentar_escritura_cliente', 'historial_escrituras_cliente', 'estado_odoo_cliente')) t`));

  // Reglas del escritor (JS, sin tocar Odoo): no duplicar en Odoo por RIF ni por nombre, y guardas de odoo.js
  const { decidirVinculo } = await import('../supabase/functions/_shared/odoo-sync/escribir-cliente-nuevo.js');
  const { crearClienteOdoo, formaAltaPartner } = await import('../supabase/functions/_shared/odoo-sync/odoo.js');
  const P = (id, name, vat, extra = {}) => ({ id, name, vat, rif: vat, cedula: false, company_id: [1, 'GUDS'], active: true, customer_rank: 1, supplier_rank: 0, ...extra });
  const yo = { rif: 'J-12345678-9', nombre: 'Farmacia Ficticia Uno, C.A.' };
  const reglas = [
    ['RIF igual en otro formato (J123456789) → enlaza, no crea', decidirVinculo(yo, [P(1, 'OTRO NOMBRE', 'J123456789')]), (d) => d.accion === 'enlazar' && d.partner.id === 1],
    ['RIF igual sin dígito verificador (cédula J-12345678) → enlaza', decidirVinculo(yo, [P(2, 'X', false, { cedula: 'J-12345678', rif: false })]), (d) => d.accion === 'enlazar'],
    ['Dos contactos con el mismo RIF → no crea: administración elige (sin "crear nuevo")', decidirVinculo(yo, [P(3, 'A', 'J-123456789'), P(4, 'B', 'J-12345678-9')]),
      (d) => d.accion === 'revisar' && d.puede_crear === false && d.candidatos.length === 2],
    ['RIF igual pero archivado → no crea ni enlaza solo', decidirVinculo(yo, [P(5, 'A', 'J-123456789', { active: false })]), (d) => d.accion === 'revisar' && d.puede_crear === false],
    ['RIF igual ya ligado a otro cliente de GUDS → no enlaza', decidirVinculo(yo, [P(6, 'A', 'J-123456789')], new Map([[6, { id: 'x', nombre: 'Otro' }]])),
      (d) => d.accion === 'revisar'],
    ['Mismo nombre ("FARMACIA FICTICIA UNO CA") y otro RIF → no crea solo: administración decide (puede crear)', decidirVinculo(yo, [P(7, 'FARMACIA FICTICIA UNO CA', 'J-87654321-0')]),
      (d) => d.accion === 'revisar' && d.puede_crear === true && d.candidatos[0].rif_distinto],
    ['Mismo nombre y sin RIF en Odoo → enlaza', decidirVinculo(yo, [P(8, 'Farmacia Ficticia Uno', false)]), (d) => d.accion === 'enlazar' && d.partner.id === 8],
    ['Sin coincidencias → crea', decidirVinculo(yo, [P(9, 'Otra Farmacia', 'J-11111111-1')]), (d) => d.accion === 'crear'],
  ];
  for (const [nombre, d, ok] of reglas) casos.push({ ok: ok(d) ? '✓' : '✗', caso: `Escritor Odoo: ${nombre}`, resultado: JSON.stringify({ accion: d.accion, motivo: d.motivo }).slice(0, 100) });
  const odooFalso = crearClienteOdoo({ url: 'http://127.0.0.1:9', db: 'x', usuario: 'x', apiKey: 'x', timeoutMs: 500 });
  const rechaza = async (fn) => { try { await fn(); return 'NO RECHAZÓ'; } catch (e) { return e.message; } };
  const guardas = [
    ['crear un cliente sin la marca "(GUDS)"', () => formaAltaPartner({ name: 'X', company_id: 1, customer_rank: 1, comment: 'Hola' }), /marca "\(GUDS\)"/],
    ['crear un cliente con campos fuera de la lista (active)', () => formaAltaPartner({ name: 'X', company_id: 1, customer_rank: 1, comment: '(GUDS) x', active: false }), /no permitidos/],
    ['crear un contacto hijo sin la marca "(GUDS)"', () => formaAltaPartner({ parent_id: 5, type: 'contact', name: 'X' }), /marca "\(GUDS\)"/],
    ['archivar un contacto (write active)', () => odooFalso.escribir('res.partner', [5], { active: false }, 1), /no permitidos/],
    ['un límite de crédito negativo', () => odooFalso.escribir('res.partner', [5], { credit_limit: -1 }, 1), /mayor o igual a 0/],
    ['una nota que no empieza con "(GUDS)"', () => odooFalso.nota('res.partner', 5, 'Hola', 1), /empiezan con "\(GUDS\)"/],
    ['una nota en un modelo no permitido (account.move)', () => odooFalso.nota('account.move', 5, '(GUDS) x', 1), /no deja notas/],
  ];
  for (const [nombre, fn, re] of guardas) {
    const m = await rechaza(fn);
    casos.push({ ok: re.test(m) ? '✓' : '✗', caso: `odoo.js bloquea ${nombre}`, resultado: m.slice(0, 100) });
  }
}

// ── Estado de cuenta público, PDF y correo (20w): enlace revocable por token, solo ese cliente, ND cuadradas, permisos ──
{
  const MSG20W = 'Este enlace no es válido o ya no está disponible';
  const token20w = () => Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  // Cliente real con notas de débito con saldo (y ajustes cambiarios de 0,00 USD), y otro cliente de su misma empresa
  const c20w = (await sql(`select c.id, c.empresa_id, c.nombre_negocio from clientes c
    where c.empresa_id is not null
      and exists (select 1 from facturas f where f.cliente_id = c.id and f.estado = 'posted' and f.es_nota_debito and f.saldo_usd > 0.009)
    order by (select count(*) from facturas f where f.cliente_id = c.id and f.estado = 'posted' and f.es_nota_debito and abs(f.total_usd) < 0.005) desc, c.codigo
    limit 1`))[0];
  const otro20w = c20w && (await sql(`select c.id from clientes c where c.empresa_id = '${c20w.empresa_id}' and c.id <> '${c20w.id}'
    and exists (select 1 from facturas f where f.cliente_id = c.id and f.estado = 'posted') order by c.codigo limit 1`))[0];
  if (c20w && otro20w) {
    const E20w = { empresa: c20w.empresa_id };
    const Anon20w = (previo = '') => ({ rol: 'anon', uid: null, empresa: c20w.empresa_id, previo });
    // Enlace de prueba insertado como postgres (dentro del bloque, que siempre se deshace). Antes deja sin activo al cliente.
    const enlace20w = (cliente, token, extra = {}) => {
      const cols = { cliente_id: `'${cliente}'`, empresa_id: `'${c20w.empresa_id}'`, token: lit(token), ...extra };
      return `update public.estado_cuenta_enlaces set revocado_at = now(), revocado_motivo = 'reemplazado' where cliente_id = '${cliente}' and revocado_at is null;
        insert into public.estado_cuenta_enlaces (${Object.keys(cols).join(', ')}) values (${Object.values(cols).join(', ')});`;
    };
    const ayudantes20w = `create function pg_temp.acc20w(p text) returns int language sql security definer as $f$ select accesos from public.estado_cuenta_enlaces where token = p $f$;
      create function pg_temp.ult20w(p text) returns boolean language sql security definer as $f$ select ultimo_acceso_at is not null from public.estado_cuenta_enlaces where token = p $f$;
      create function pg_temp.ajenos20w(d jsonb, c uuid) returns int language sql security definer as $f$
        select count(*)::int from jsonb_array_elements(d->'movimientos') m
         where m->>'tipo' in ('factura', 'nota_debito', 'nota_credito')
           and not exists (select 1 from public.facturas f where f.numero = m->>'documento' and f.cliente_id = c) $f$;`;

    const t1 = token20w();
    await caso('Enlace 20w: anónimo con un token válido ve el estado de cuenta de ese cliente, sin identificadores internos', (x) =>
      x?.nombre === c20w.nombre_negocio && x?.n > 0 && x?.ids === false && x?.ajenos === 0,
      como(Anon20w(enlace20w(c20w.id, t1) + ayudantes20w), `select json_build_object('nombre', d->'cliente'->>'nombre', 'n', jsonb_array_length(d->'movimientos'),
          'ids', (d->'cliente' ? 'id') or (d->'empresa' ? 'id') or exists (select 1 from jsonb_array_elements(d->'movimientos') m where m ? 'factura_id')
                 or exists (select 1 from jsonb_array_elements(d->'abiertos') a where a ? 'factura_id'),
          'ajenos', pg_temp.ajenos20w(d, '${c20w.id}'))::text
        from (select public.estado_cuenta_publico(${lit(t1)}) d) t`));
    const t2 = token20w();
    await caso('Enlace 20w: cada apertura suma un acceso y la recarga automática (p_contar=false) solo actualiza el último acceso', (x) =>
      x?.antes === 0 && x?.despues === 1 && x?.ultimo === true && !!x?.nombre,
      como(Anon20w(enlace20w(c20w.id, t2) + ayudantes20w), `select json_build_object('antes', pg_temp.acc20w(${lit(t2)}),
          'nombre', public.estado_cuenta_publico(${lit(t2)})->'cliente'->>'nombre',
          'recarga', public.estado_cuenta_publico(${lit(t2)}, null, null, false)->'resumen'->>'saldo',
          'despues', pg_temp.acc20w(${lit(t2)}), 'ultimo', pg_temp.ult20w(${lit(t2)}))::text`));
    const t3 = token20w(), t4 = token20w();
    await caso('Enlace 20w: un token revocado da el error genérico', MSG20W,
      como(Anon20w(enlace20w(c20w.id, t3, { revocado_at: 'now()', revocado_motivo: `'revocado'` })), `select public.estado_cuenta_publico(${lit(t3)})::text`));
    await caso('Enlace 20w: un token vencido da el mismo error genérico', MSG20W,
      como(Anon20w(enlace20w(otro20w.id, t4, { creado_at: `now() - interval '3 days'`, vence_at: `now() - interval '1 day'` })),
        `select public.estado_cuenta_publico(${lit(t4)})::text`));
    await caso('Enlace 20w: un token inventado (bien formado) da el mismo error genérico', MSG20W,
      como(Anon20w(), `select public.estado_cuenta_publico(${lit(token20w())})::text`));
    await caso('Enlace 20w: un token mal formado da el mismo error genérico', MSG20W,
      como(Anon20w(), `select public.estado_cuenta_publico('abc'' or 1=1 --')::text`));

    // ND presentes y cuadradas contra la base: todas las ND con valor, ninguna de 0,00 USD, abiertas con su saldo
    const nd20w = (await sql(`select count(*) filter (where abs(total_usd) >= 0.005)::int n, coalesce(round(sum(total_usd) filter (where abs(total_usd) >= 0.005), 2), 0)::float8 total,
        count(*) filter (where saldo_usd > 0.009)::int abiertas, coalesce(round(sum(saldo_usd) filter (where saldo_usd > 0.009), 2), 0)::float8 saldo
      from facturas where cliente_id = '${c20w.id}' and estado = 'posted' and es_nota_debito and (empresa_id is null or empresa_id = '${c20w.empresa_id}')`))[0];
    const ceros20w = (await sql(`select count(*)::int n from facturas where cliente_id = '${c20w.id}' and estado = 'posted' and (es_nota_debito or tipo = 'nota_credito')
      and abs(total_usd) < 0.005 and abs(saldo_usd) < 0.005 and (empresa_id is null or empresa_id = '${c20w.empresa_id}')`))[0].n;
    const t5 = token20w();
    const pub20w = await como(Anon20w(enlace20w(c20w.id, t5)), `select json_build_object(
        'nd_n', (select count(*) from jsonb_array_elements(d->'movimientos') m where m->>'tipo' = 'nota_debito'),
        'nd_total', (select round(sum((m->>'monto')::numeric), 2) from jsonb_array_elements(d->'movimientos') m where m->>'tipo' = 'nota_debito'),
        'nd_cero', (select count(*) from jsonb_array_elements(d->'movimientos') m where m->>'tipo' = 'nota_debito' and abs((m->>'monto')::numeric) < 0.005),
        'ab_n', (select count(*) from jsonb_array_elements(d->'abiertos') a where a->>'tipo' = 'nota_debito'),
        'ab_saldo', (select round(sum((a->>'saldo')::numeric), 2) from jsonb_array_elements(d->'abiertos') a where a->>'tipo' = 'nota_debito'),
        'ajustes', d->'ajustes_cambiarios', 'resumen', d->'resumen', 'saldo_final', d->'saldo_final', 'diferencia', d->'diferencia',
        'movs', jsonb_array_length(d->'movimientos'))::text
      from (select public.estado_cuenta_publico(${lit(t5)}) d) t`);
    const p20w = pub20w.ok ? JSON.parse(pub20w.ok) : null;
    const resuelto20w = (obj) => Promise.resolve(obj.error ? obj : { ok: JSON.stringify(obj) });
    await caso('ND 20w: el estado de cuenta lista todas las notas de débito con valor y su monto cuadra con la base', (x) => x?.ok === true,
      resuelto20w(pub20w.error ? pub20w : { ok: p20w.nd_n === nd20w.n && Number(p20w.nd_total) === nd20w.total && nd20w.n > 0,
        lista: p20w.nd_n, base: nd20w.n, total: p20w.nd_total, esperado: nd20w.total }));
    await caso('ND 20w: las ND abiertas llevan su saldo y los ajustes cambiarios de 0,00 USD no ensucian el libro (solo se cuentan)', (x) => x?.ok === true,
      resuelto20w(pub20w.error ? pub20w : { ok: p20w.ab_n === nd20w.abiertas && Number(p20w.ab_saldo) === nd20w.saldo
        && Number(p20w.resumen.notas_debito_saldo) === nd20w.saldo && p20w.nd_cero === 0 && p20w.ajustes === ceros20w
        && Number(p20w.diferencia) === 0 && Number(p20w.saldo_final) === Number(p20w.resumen.neto),
        abiertas: p20w.ab_n, saldo: p20w.ab_saldo, ajustes: p20w.ajustes, ceros: ceros20w }));
    // Misma fuente que el portal del cliente y que el admin
    const qa20w = (await sql(`select id from auth.users where email = 'qa.cliente@guds.test'`))[0]?.id;
    if (qa20w) {
      const portal20w = await como({ uid: qa20w, empresa: c20w.empresa_id,
        previo: `insert into public.usuarios (auth_id, email, nombre, role, cliente_id, activo) values ('${qa20w}', 'qa.cliente@guds.test', 'QA', 'cliente', '${c20w.id}', true);` },
        `select json_build_object('resumen', d->'resumen', 'saldo_final', d->'saldo_final', 'movs', jsonb_array_length(d->'movimientos'), 'ajustes', d->'ajustes_cambiarios',
          'nd_total', (select round(sum((m->>'monto')::numeric), 2) from jsonb_array_elements(d->'movimientos') m where m->>'tipo' = 'nota_debito'))::text
         from (select public.estado_cuenta_portal() d) t`);
      const q20w = portal20w.ok ? JSON.parse(portal20w.ok) : null;
      await caso('ND 20w: el enlace público da lo mismo que estado_cuenta_portal (resumen, saldo final, movimientos y ND)', (x) => x?.ok === true,
        resuelto20w(portal20w.error || pub20w.error ? (portal20w.error ? portal20w : pub20w)
          : { ok: JSON.stringify(q20w.resumen) === JSON.stringify(p20w.resumen) && Number(q20w.saldo_final) === Number(p20w.saldo_final)
              && q20w.movs === p20w.movs && Number(q20w.nd_total) === Number(p20w.nd_total) && q20w.ajustes === p20w.ajustes }));
      await caso('Enlace 20w: un cliente del portal no crea enlaces', 'No tienes permiso',
        como({ uid: qa20w, empresa: c20w.empresa_id,
          previo: `insert into public.usuarios (auth_id, email, nombre, role, cliente_id, activo) values ('${qa20w}', 'qa.cliente@guds.test', 'QA', 'cliente', '${c20w.id}', true);` },
          `select public.crear_enlace_estado_cuenta('${c20w.id}')::text`));
    }
    const admin20w = await como(E20w, `select json_build_object('resumen', d->'resumen', 'saldo_final', d->'saldo_final', 'movs', jsonb_array_length(d->'movimientos'))::text
      from (select public.estado_cuenta_cliente('${c20w.id}') d) t`);
    const a20w = admin20w.ok ? JSON.parse(admin20w.ok) : null;
    await caso('ND 20w: CuentaDetalle (estado_cuenta_cliente) usa la misma fuente que el enlace y el portal', (x) => x?.ok === true,
      resuelto20w(admin20w.error || pub20w.error ? (admin20w.error ? admin20w : pub20w)
        : { ok: JSON.stringify(a20w.resumen) === JSON.stringify(p20w.resumen) && a20w.movs === p20w.movs && Number(a20w.saldo_final) === Number(p20w.saldo_final) }));

    // Crear, reutilizar, reemplazar y revocar (administración con 'cuentas' editar)
    const sinActivo20w = `update public.estado_cuenta_enlaces set revocado_at = now(), revocado_motivo = 'reemplazado' where cliente_id = '${c20w.id}' and revocado_at is null;`;
    await caso('Enlace 20w: administración crea un token de 43 caracteres url-safe y reutiliza el activo en vez de crear otro', (x) =>
      /^[A-Za-z0-9_-]{43}$/.test(x?.a ?? '') && x?.a === x?.b && x?.reutilizado === 'true' && x?.primero === 'false',
      como({ ...E20w, previo: sinActivo20w }, `select json_build_object('a', a->>'token', 'primero', a->>'reutilizado', 'b', b->>'token', 'reutilizado', b->>'reutilizado')::text
        from (select public.crear_enlace_estado_cuenta('${c20w.id}') a) x, lateral (select public.crear_enlace_estado_cuenta('${c20w.id}') b where x.a is not null) y`));
    await caso('Enlace 20w: pedir uno nuevo revoca el anterior (queda "reemplazado") y deja uno solo activo', (x) =>
      x?.distinto === true && x?.activos === 1 && x?.motivo === 'reemplazado',
      como({ ...E20w, previo: sinActivo20w + `create function pg_temp.activos20w(c uuid) returns int language sql security definer as $f$
          select count(*)::int from public.estado_cuenta_enlaces where cliente_id = c and revocado_at is null $f$;
        create function pg_temp.motivo20w(i uuid) returns text language sql security definer as $f$ select revocado_motivo from public.estado_cuenta_enlaces where id = i $f$;` },
        `select json_build_object('distinto', a->>'token' <> b->>'token',
          'activos', pg_temp.activos20w('${c20w.id}'), 'motivo', pg_temp.motivo20w((a->>'id')::uuid))::text
        from (select public.crear_enlace_estado_cuenta('${c20w.id}') a) x, lateral (select public.crear_enlace_estado_cuenta('${c20w.id}', true) b where x.a is not null) y`));
    await caso('Enlace 20w: revocar lo apaga al instante (activo = false, motivo "revocado")', (x) => x?.activo === false && x?.revocado_motivo === 'revocado' && x?.token === null,
      como({ ...E20w, previo: sinActivo20w }, `select public.revocar_enlace_estado_cuenta((public.crear_enlace_estado_cuenta('${c20w.id}')->>'id')::uuid)::text`));
    await caso('Enlace 20w: el vencimiento no puede ser pasado ni de más de un año', 'entre hoy y un año',
      como(E20w, `select public.crear_enlace_estado_cuenta('${c20w.id}', true, current_date - 3)::text`));
    await caso('Enlace 20w: en "Ambas empresas" no se crean enlaces (modo consulta)', 'Modo consulta',
      como({ empresa: 'todas' }, `select public.crear_enlace_estado_cuenta('${c20w.id}')::text`));
    await caso('Enlace 20w: personal sin "cuentas" editar (rol Almacén) no crea enlaces', 'No tienes permiso',
      como({ ...E20w, previo: `update public.usuarios set rol_id = (select id from public.roles where nombre = 'Almacén') where auth_id = '${admin}';` },
        `select public.crear_enlace_estado_cuenta('${c20w.id}')::text`));
    await caso('Enlace 20w: el rol Contador (cuentas editar) sí crea enlaces', (x) => /^[A-Za-z0-9_-]{43}$/.test(x?.token ?? ''),
      como({ ...E20w, previo: `update public.usuarios set rol_id = (select id from public.roles where nombre = 'Contador') where auth_id = '${admin}';` + sinActivo20w },
        `select public.crear_enlace_estado_cuenta('${c20w.id}')::text`));
    await caso('Correo 20w: personal sin "cuentas" editar no pide los datos del correo', 'No tienes permiso',
      como({ ...E20w, previo: `update public.usuarios set rol_id = (select id from public.roles where nombre = 'Almacén') where auth_id = '${admin}';` },
        `select public.datos_correo_estado_cuenta('${c20w.id}')::text`));

    // Vendedor: solo los clientes de su cartera
    const v20w = (await sql(`select u.auth_id, c.id cliente, c.empresa_id from clientes c join usuarios u on u.id = c.vendedor_asignado_id
      join usuario_empresas ue on ue.usuario_id = u.id and ue.empresa_id = c.empresa_id
      where u.role = 'vendedor' and u.auth_id is not null and coalesce(u.activo, true) and c.empresa_id is not null order by c.codigo limit 1`))[0];
    if (v20w) {
      const ajeno20w = (await sql(`select c.id from clientes c where c.empresa_id = '${v20w.empresa_id}'
        and c.vendedor_asignado_id is distinct from (select id from usuarios where auth_id = '${v20w.auth_id}') order by c.codigo limit 1`))[0];
      await caso('Enlace 20w: el vendedor crea el enlace de un cliente de su cartera', (x) => /^[A-Za-z0-9_-]{43}$/.test(x?.token ?? ''),
        como({ uid: v20w.auth_id, empresa: v20w.empresa_id, previo: `update public.estado_cuenta_enlaces set revocado_at = now(), revocado_motivo = 'reemplazado' where cliente_id = '${v20w.cliente}' and revocado_at is null;` },
          `select public.crear_enlace_estado_cuenta('${v20w.cliente}')::text`));
      if (ajeno20w) {
        await caso('Enlace 20w: el vendedor no crea enlaces de un cliente fuera de su cartera', 'No tienes permiso',
          como({ uid: v20w.auth_id, empresa: v20w.empresa_id }, `select public.crear_enlace_estado_cuenta('${ajeno20w.id}')::text`));
      }
      await caso('Correo 20w: el vendedor no envía el estado de cuenta por correo (datos del correo solo para administración)', 'No tienes permiso',
        como({ uid: v20w.auth_id, empresa: v20w.empresa_id }, `select public.datos_correo_estado_cuenta('${v20w.cliente}')::text`));
    }

    // Envíos: solo la llave de servicio los registra; límite por minuto y correos válidos
    const uAdmin20w = (await sql(`select id from usuarios where auth_id = '${admin}'`))[0].id;
    const reg20w = (dest) => `select json_build_object('id', public.registrar_envio_estado_cuenta('${uAdmin20w}', '${c20w.id}', '${c20w.empresa_id}', null, ${dest}, 'Estado de cuenta', null, 'x.pdf', 1000))::text`;
    await caso('Correo 20w: la función edge (llave de servicio) registra un envío válido', (x) => /^[0-9a-f-]{36}$/.test(x?.id ?? ''),
      como({ rol: 'service_role', uid: null }, reg20w(`array['delivered@resend.dev']`)));
    await caso('Correo 20w: un correo con formato inválido se rechaza', 'formato inválido',
      como({ rol: 'service_role', uid: null }, reg20w(`array['delivered@resend.dev', 'no es un correo']`)));
    await caso('Correo 20w: más de 5 envíos por minuto del mismo usuario se rechazan', 'Demasiados envíos',
      como({ rol: 'service_role', uid: null, previo: `insert into public.estado_cuenta_envios (cliente_id, empresa_id, destinatarios, asunto, enviado_por)
          select '${otro20w.id}', '${c20w.empresa_id}', array['delivered@resend.dev'], 'Prueba', '${uAdmin20w}' from generate_series(1, 5);` },
        reg20w(`array['delivered@resend.dev']`)));
    await caso('Correo 20w: un usuario con sesión no registra envíos por su cuenta (solo la función edge)', 'permission denied',
      como(E20w, reg20w(`array['delivered@resend.dev']`)));
  }

  // Funciones y tablas cerradas
  await caso('Enlace 20w: anon solo ejecuta estado_cuenta_publico (ni las internas ni las de administración)', (x) => x?.pub === true && x?.otras === 0,
    como({}, `select row_to_json(t)::text from (select
        bool_or(has_function_privilege('anon', p.oid, 'execute')) filter (where p.proname = 'estado_cuenta_publico') pub,
        count(*) filter (where p.proname <> 'estado_cuenta_publico' and has_function_privilege('anon', p.oid, 'execute')) otras
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('estado_cuenta_publico', 'estado_cuenta_datos', 'estado_cuenta_acceso',
        'estado_cuenta_enlace_json', 'estado_cuenta_cliente', 'crear_enlace_estado_cuenta', 'revocar_enlace_estado_cuenta', 'enlaces_estado_cuenta',
        'datos_correo_estado_cuenta', 'registrar_envio_estado_cuenta', 'cerrar_envio_estado_cuenta', 'envios_estado_cuenta')) t`));
  await caso('Enlace 20w: las funciones internas no se ejecutan con sesión (authenticated); el registro de envíos solo con la llave de servicio', (x) => x?.auth === 0 && x?.servicio === 2,
    como({}, `select row_to_json(t)::text from (select
        count(*) filter (where has_function_privilege('authenticated', p.oid, 'execute')) auth,
        count(*) filter (where p.proname in ('registrar_envio_estado_cuenta', 'cerrar_envio_estado_cuenta') and has_function_privilege('service_role', p.oid, 'execute')) servicio
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('estado_cuenta_datos', 'estado_cuenta_acceso', 'estado_cuenta_enlace_json',
        'registrar_envio_estado_cuenta', 'cerrar_envio_estado_cuenta')) t`));
  await caso('Enlace 20w: las tablas de enlaces y envíos tienen RLS y ningún permiso directo para anon ni authenticated', (x) => x?.rls === 2 && x?.permisos === 0,
    como({}, `select row_to_json(t)::text from (select count(*) filter (where c.relrowsecurity) rls,
        (select count(*) from information_schema.role_table_grants g where g.table_schema = 'public'
           and g.table_name in ('estado_cuenta_enlaces', 'estado_cuenta_envios') and g.grantee in ('anon', 'authenticated', 'PUBLIC')) permisos
      from pg_class c where c.oid in ('public.estado_cuenta_enlaces'::regclass, 'public.estado_cuenta_envios'::regclass)) t`));
  await caso('Enlace 20w: anon no lee la tabla de enlaces', 'permission denied',
    como({ rol: 'anon', uid: null }, `select count(*)::text from public.estado_cuenta_enlaces`));
}

// ── Fase 20v: módulo Contactos (clientes, proveedores y sueltos) y acceso al portal ──
{
  const K = (n) => `00000000-0000-0000-0000-0000000${String(n).padStart(2, '0')}20c`;   // ids fijos de prueba (todo en rollback)
  const AUTH_P = '00000000-0000-0000-0000-00000000f20c';                               // usuario de auth de prueba
  const adminClaims = JSON.stringify({ sub: admin, role: 'authenticated' }).replace(/'/g, "''");
  const hdrG = JSON.stringify({ 'x-empresa-id': guds.id }).replace(/'/g, "''");
  const comoAdmin = `perform set_config('request.jwt.claims', '${adminClaims}', true); perform set_config('request.headers', '${hdrG}', true);`;
  const G = { empresa: guds.id };
  const provGuds = (await sql(`select id from proveedores where empresa_id = '${guds.id}' limit 1`))[0].id;
  const cli2 = (await sql(`select id from clientes where empresa_id = '${guds.id}' and id <> '${cliGuds}' and odoo_id is not null limit 1`))[0].id;
  const cliOdooId = (await sql(`select odoo_id from clientes where id = '${cliGuds}'`))[0].odoo_id;
  const nuevoK = (n, extra = '') => `insert into cliente_contactos (id, empresa_id, nombre ${extra ? ', ' + extra.split('|')[0] : ''}) values ('${K(n)}', '${guds.id}', 'Contacto 20v ${n}' ${extra ? ', ' + extra.split('|')[1] : ''});`;
  const conAcceso = (n, clave = null) => `${nuevoK(n, `cliente_id, email|'${cliGuds}', 'prueba.20v.${n}@guds.test'`)} ${comoAdmin}
    perform public.crear_acceso_contacto('${K(n)}'${clave ? `, '${clave}', false` : ''});`;
  // Verificación como postgres (auth.users no es legible para authenticated). Llamar y leer en el mismo statement no ve lo escrito:
  // las funciones pg_temp (plpgsql, volátiles) llaman y luego leen con un snapshot nuevo.
  const dar = `create function pg_temp.dar_20v(p uuid, c text, cambio boolean) returns text language plpgsql security definer as $f$
    declare r record; begin select * into r from public.crear_acceso_contacto(p, c, cambio);
    return (select row_to_json(t)::text from (select r.password_temporal, u.debe_cambiar_clave debe,
      a.encrypted_password = extensions.crypt(coalesce(c, r.password_temporal), a.encrypted_password) clave_ok
      from usuarios u join auth.users a on a.id = u.auth_id where u.id = r.usuario_id) t); end $f$;`;
  const rest = `create function pg_temp.rest_20v(p uuid, c text, cambio boolean) returns text language plpgsql security definer as $f$
    declare v text; begin v := public.restablecer_clave_cliente((select id from usuarios where contacto_id = p), c, cambio);
    return (select row_to_json(t)::text from (select v devuelta, u.debe_cambiar_clave debe from usuarios u where u.contacto_id = p) t); end $f$;`;
  // Verificación como postgres (auth.users no es legible para authenticated). El bloqueo debe ser una fecha finita: Auth no
  // sabe leer 'infinity' (la cuenta queda inservible para su API).
  const verif = `create function pg_temp.acceso_20v(p uuid) returns text language sql security definer as $f$
    select row_to_json(t)::text from (select u.activo, u.debe_cambiar_clave debe, u.cliente_id = k.cliente_id mismo_cliente,
      (a.banned_until is not null and a.banned_until <> 'infinity'::timestamptz) baneado, (select count(*) from usuarios x where x.contacto_id = p) usuarios
      from usuarios u join cliente_contactos k on k.id = u.contacto_id join auth.users a on a.id = u.auth_id where u.contacto_id = p) t $f$;`;

  await caso('Contactos 20v: el admin crea un contacto suelto en la empresa activa (origen GUDS)', (r) => r?.empresa_id === guds.id && r?.origen === 'guds' && !r?.cliente_id,
    como(G, `with x as (insert into cliente_contactos (nombre, email) values ('Contacto 20v suelto', 'suelto.20v@guds.test') returning empresa_id, origen, cliente_id) select row_to_json(x)::text from x`));
  await caso('Contactos 20v: en modo "Ambas" no se crea un contacto suelto', 'Modo consulta',
    como({ empresa: 'todas' }, `with x as (insert into cliente_contactos (nombre) values ('Contacto 20v') returning id) select row_to_json(x)::text from x`));
  await caso('Contactos 20v: la API no fija origen ni odoo_id', (r) => r?.origen === 'guds' && r?.odoo_id === null,
    como(G, `with x as (insert into cliente_contactos (nombre, origen, odoo_id) values ('Contacto 20v', 'odoo', 999999) returning origen, odoo_id) select row_to_json(x)::text from x`));
  await caso('Contactos 20v: un contacto no es a la vez de un cliente y de un proveedor', 'cliente_contactos_un_vinculo',
    como(G, `with x as (insert into cliente_contactos (nombre, cliente_id, proveedor_id) values ('Contacto 20v', '${cliGuds}', '${provGuds}') returning id) select row_to_json(x)::text from x`));
  await caso('Contactos 20v: un contacto de proveedor toma la empresa del proveedor', (r) => r?.empresa_id === guds.id && r?.proveedor_id === provGuds,
    como(G, `with x as (insert into cliente_contactos (nombre, proveedor_id) values ('Contacto 20v prov', '${provGuds}') returning empresa_id, proveedor_id) select row_to_json(x)::text from x`));

  // Acceso al portal: solo con cliente y correo
  await caso('Contactos 20v: un contacto suelto no recibe acceso al portal', 'ligado a un cliente',
    como({ ...G, previo: nuevoK(1, `email|'prueba.20v.1@guds.test'`) }, `select row_to_json(t)::text from public.crear_acceso_contacto('${K(1)}') t`));
  await caso('Contactos 20v: un contacto de proveedor no recibe acceso al portal', 'ligado a un cliente',
    como({ ...G, previo: nuevoK(2, `proveedor_id, email|'${provGuds}', 'prueba.20v.2@guds.test'`) }, `select row_to_json(t)::text from public.crear_acceso_contacto('${K(2)}') t`));
  await caso('Contactos 20v: sin correo no hay acceso al portal', 'correo válido',
    como({ ...G, previo: nuevoK(3, `cliente_id|'${cliGuds}'`) }, `select row_to_json(t)::text from public.crear_acceso_contacto('${K(3)}') t`));
  await caso('Contactos 20v: el admin establece la contraseña (no se devuelve; sin pedir cambio)', (r) => r?.password_temporal === null && r?.debe === false && r?.clave_ok === true,
    como({ ...G, previo: nuevoK(4, "cliente_id, email|'" + cliGuds + "', 'prueba.20v.4@guds.test'") + ' ' + dar }, "select pg_temp.dar_20v('" + K(4) + "', 'Portal2026guds', false)"));
  await caso('Contactos 20v: la contraseña generada es temporal (debe cambiarla al entrar)', (r) => r?.password_temporal?.length >= 8 && r?.debe === true && r?.clave_ok === true,
    como({ ...G, previo: nuevoK(5, "cliente_id, email|'" + cliGuds + "', 'prueba.20v.5@guds.test'") + ' ' + dar }, "select pg_temp.dar_20v('" + K(5) + "', null, false)"));
  await caso('Contactos 20v: la contraseña elegida exige 8 caracteres', 'al menos 8',
    como({ ...G, previo: nuevoK(6, "cliente_id, email|'" + cliGuds + "', 'prueba.20v.6@guds.test'") }, "select row_to_json(t)::text from public.crear_acceso_contacto('" + K(6) + "', 'abc123', true) t"));
  await caso('Contactos 20v: la contraseña elegida exige letras y números', 'letras y números',
    como({ ...G, previo: nuevoK(6, "cliente_id, email|'" + cliGuds + "', 'prueba.20v.6@guds.test'") }, "select row_to_json(t)::text from public.crear_acceso_contacto('" + K(6) + "', 'solamenteletras', true) t"));
  await caso('Contactos 20v: restablecer con una contraseña elegida (no se devuelve; pide cambio si se marca)', (r) => r?.devuelta === null && r?.debe === true,
    como({ ...G, previo: conAcceso(7, 'Portal2026guds') + ' ' + rest }, "select pg_temp.rest_20v('" + K(7) + "', 'OtraClave2026', true)"));
  await caso('Contactos 20v: restablecer sin contraseña genera una temporal', (r) => r?.devuelta?.length >= 8 && r?.debe === true,
    como({ ...G, previo: conAcceso(7, 'Portal2026guds') + ' ' + rest }, "select pg_temp.rest_20v('" + K(7) + "', null, false)"));

  // Desligar: el acceso se desactiva solo
  await caso('Contactos 20v: al quitarle el cliente (suelto) su acceso se desactiva y queda bloqueado', (r) => r?.activo === false && r?.baneado === true,
    como({ ...G, previo: `${conAcceso(8)} ${verif} update cliente_contactos set cliente_id = null where id = '${K(8)}';` }, `select pg_temp.acceso_20v('${K(8)}')`));
  await caso('Contactos 20v: al pasarlo a un proveedor su acceso se desactiva', (r) => r?.activo === false && r?.baneado === true,
    como({ ...G, previo: `${conAcceso(9)} ${verif} update cliente_contactos set cliente_id = null, proveedor_id = '${provGuds}' where id = '${K(9)}';` }, `select pg_temp.acceso_20v('${K(9)}')`));
  await caso('Contactos 20v: al pasarlo a otro cliente su acceso se desactiva', (r) => r?.activo === false,
    como({ ...G, previo: `${conAcceso(10)} ${verif} update cliente_contactos set cliente_id = '${cli2}' where id = '${K(10)}';` }, `select pg_temp.acceso_20v('${K(10)}')`));
  await caso('Contactos 20v: al desactivar el contacto su acceso se desactiva', (r) => r?.activo === false,
    como({ ...G, previo: `${conAcceso(11)} ${verif} update cliente_contactos set activo = false where id = '${K(11)}';` }, `select pg_temp.acceso_20v('${K(11)}')`));
  await caso('Contactos 20v: no se reactiva el acceso de un contacto desligado', 'ya no pertenece',
    como({ ...G, previo: `${conAcceso(12)} update cliente_contactos set cliente_id = null where id = '${K(12)}';` },
      `select public.cambiar_acceso_cliente((select id from usuarios where contacto_id = '${K(12)}'), true)::text`));
  await caso('Contactos 20v: al volver a ligarlo y darle acceso se reutiliza su usuario (activo, del cliente nuevo)', (r) => r?.activo === true && r?.mismo_cliente === true && r?.usuarios === 1 && r?.baneado === false,
    como({ ...G, previo: `${conAcceso(13)} ${verif} update cliente_contactos set cliente_id = null where id = '${K(13)}';
      update cliente_contactos set cliente_id = '${cli2}' where id = '${K(13)}'; perform public.crear_acceso_contacto('${K(13)}');` }, `select pg_temp.acceso_20v('${K(13)}')`));
  await caso('Contactos 20v: con acceso activo, el correo del contacto no se cambia', 'El correo es el usuario del portal',
    como({ ...G, previo: conAcceso(14) }, `with x as (update cliente_contactos set email = 'otro.20v@guds.test' where id = '${K(14)}' returning id) select row_to_json(x)::text from x`));
  await caso('Contactos 20v: no se elimina un contacto con usuario del portal', 'tiene usuario del portal',
    como({ ...G, previo: conAcceso(15) }, `with x as (delete from cliente_contactos where id = '${K(15)}' returning id) select row_to_json(x)::text from x`));

  // Permisos por rol
  const vendUsuario = vendGuds && (await sql(`select id from usuarios where auth_id = '${vendGuds}'`))[0]?.id;
  const cliVend = vendUsuario && (await sql(`select id from clientes where vendedor_asignado_id = '${vendUsuario}' and empresa_id = '${guds.id}' limit 1`))[0]?.id;
  const cliAjeno = vendUsuario && (await sql(`select id from clientes where empresa_id = '${guds.id}' and vendedor_asignado_id is distinct from '${vendUsuario}' limit 1`))[0]?.id;
  if (vendGuds && cliVend && cliAjeno) {
    const V = { uid: vendGuds, empresa: guds.id };
    const permisoVend = (modulo) => `update permisos set puede_ver = true, puede_editar = true, puede_crear = true where rol_id = (select id from roles where nombre = 'Vendedor')
      and modulo_id = (select id from modulos where codigo = '${modulo}'); insert into permisos (rol_id, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar)
      select r.id, m.id, true, true, true, false from roles r, modulos m where r.nombre = 'Vendedor' and m.codigo = '${modulo}' on conflict (rol_id, modulo_id) do nothing;`;
    await caso('Contactos 20v: un vendedor (sin permiso de edición) no crea contactos ni en su cartera', 'row-level security',
      como(V, `with x as (insert into cliente_contactos (nombre, cliente_id) values ('Contacto 20v', '${cliVend}') returning id) select row_to_json(x)::text from x`));
    await caso('Contactos 20v: un vendedor con permiso gestiona contactos de su cartera', (r) => r?.cliente_id === cliVend,
      como({ ...V, previo: permisoVend('clientes') }, `with x as (insert into cliente_contactos (nombre, cliente_id) values ('Contacto 20v', '${cliVend}') returning cliente_id) select row_to_json(x)::text from x`));
    await caso('Contactos 20v: un vendedor con permiso no crea contactos de clientes ajenos', 'row-level security',
      como({ ...V, previo: permisoVend('clientes') }, `with x as (insert into cliente_contactos (nombre, cliente_id) values ('Contacto 20v', '${cliAjeno}') returning id) select row_to_json(x)::text from x`));
    await caso('Contactos 20v: un vendedor con permiso de contactos no crea sueltos ni de proveedores', 'row-level security',
      como({ ...V, previo: permisoVend('contactos') }, `with x as (insert into cliente_contactos (nombre, proveedor_id) values ('Contacto 20v', '${provGuds}') returning id) select row_to_json(x)::text from x`));
    await caso('Contactos 20v: un vendedor con permiso no da acceso al portal a contactos de clientes ajenos', 'No tienes permiso',
      como({ ...V, previo: `${permisoVend('clientes')} ${nuevoK(16, `cliente_id, email|'${cliAjeno}', 'prueba.20v.16@guds.test'`)}` },
        `select row_to_json(t)::text from public.crear_acceso_contacto('${K(16)}') t`));
    await caso('Contactos 20v: un vendedor con permiso da acceso al portal a un contacto de su cartera', (r) => r?.email === 'prueba.20v.17@guds.test',
      como({ ...V, previo: `${permisoVend('clientes')} ${nuevoK(17, `cliente_id, email|'${cliVend}', 'prueba.20v.17@guds.test'`)}` },
        `select row_to_json(t)::text from public.crear_acceso_contacto('${K(17)}') t`));
    await caso('Contactos 20v: un vendedor solo ve los contactos de su cartera', (r) => r?.propios >= 1 && r?.ajenos === 0,
      como({ ...V, previo: `${nuevoK(18, `cliente_id|'${cliVend}'`)} ${nuevoK(19, `cliente_id|'${cliAjeno}'`)} ${nuevoK(20)}` },
        `select row_to_json(t)::text from (select count(*) filter (where cliente_id = '${cliVend}') propios, count(*) filter (where cliente_id is distinct from '${cliVend}') ajenos from cliente_contactos) t`));
  }
  const previoPortal = `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values ('${AUTH_P}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'portal.20v@guds.test', '', now(), now(), now());
    insert into usuarios (auth_id, email, nombre, role, cliente_id, activo) values ('${AUTH_P}', 'portal.20v@guds.test', 'Portal', 'cliente', '${cliGuds}', true);
    ${nuevoK(21, `cliente_id|'${cliGuds}'`)} ${nuevoK(22, `email|'prueba.20v.22@guds.test'`)}`;
  await caso('Contactos 20v: un usuario del portal no ve contactos (ni de su cliente)', (r) => r?.n === 0,
    como({ uid: AUTH_P, empresa: guds.id, previo: previoPortal }, `select row_to_json(t)::text from (select count(*) n from cliente_contactos) t`));
  await caso('Contactos 20v: un usuario del portal no da accesos', 'No tienes permiso',
    como({ uid: AUTH_P, empresa: guds.id, previo: `${previoPortal} update cliente_contactos set cliente_id = '${cliGuds}' where id = '${K(22)}';` },
      `select row_to_json(t)::text from public.crear_acceso_contacto('${K(22)}') t`));
  await caso('Contactos 20v: el rol Contador (clientes y compras: ver) ve contactos de clientes, no los sueltos', (r) => r?.de_cliente >= 1 && r?.sueltos === 0,
    como({ uid: AUTH_P, empresa: guds.id, previo: `${previoPortal} perform set_config('guds.bypass_guard', 'on', true); update usuarios set role = 'admin', cliente_id = null, rol_id = (select id from roles where nombre = 'Contador') where auth_id = '${AUTH_P}'; perform set_config('guds.bypass_guard', 'off', true);
      insert into usuario_empresas (usuario_id, empresa_id, por_defecto) select id, '${guds.id}', true from usuarios where auth_id = '${AUTH_P}' on conflict do nothing;` },
      `select row_to_json(t)::text from (select count(*) filter (where cliente_id is not null) de_cliente, count(*) filter (where cliente_id is null and proveedor_id is null) sueltos from cliente_contactos) t`));
  await caso('Contactos 20v: anónimo no lee contactos', 'permission denied',
    como({ rol: 'anon', uid: null, empresa: guds.id }, `select count(*)::text from cliente_contactos`));
  await caso('Contactos 20v: funciones internas cerradas y acciones sin anónimo', (r) => r?.n === 0,
    como({}, `select row_to_json(t)::text from (select count(*) n from pg_proc p where p.pronamespace = 'public'::regnamespace and (
      (p.proname in ('validar_clave_portal', 'desactivar_acceso_contacto', 'sincronizar_accesos_contactos', 'trg_contacto_empresa', 'trg_contacto_odoo_protegido',
         'trg_contacto_espejo', 'trg_contacto_reglas', 'trg_contacto_acceso', 'trg_contacto_odoo_encolar')
        and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')))
      or (p.proname in ('puede_gestionar_contacto', 'crear_acceso_contacto', 'restablecer_clave_cliente', 'cambiar_acceso_cliente', 'accesos_portal_contactos', 'enviar_contacto_odoo')
        and has_function_privilege('anon', p.oid, 'execute')))) t`));
  await caso('Contactos 20v: las acciones SECURITY DEFINER exigen sesión y validan permiso', (r) => r?.n === 4 && r?.total === 4,
    como({}, `select row_to_json(t)::text from (select count(*) filter (where pg_get_functiondef(p.oid) ~ 'auth\\.uid\\(\\) is null' and pg_get_functiondef(p.oid) ~ 'puede_gestionar_contacto\\(') n,
      count(*) total from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
      and p.proname in ('crear_acceso_contacto', 'restablecer_clave_cliente', 'cambiar_acceso_cliente', 'enviar_contacto_odoo')) t`));

  // Contactos que vienen de Odoo
  const deOdoo = (n, padre = false, cli = null) => `insert into cliente_contactos (id, empresa_id, nombre, origen, odoo_id, odoo_padre_id, cliente_id)
    values ('${K(n)}', '${guds.id}', 'Contacto Odoo 20v', 'odoo', ${999990000 + n}, ${padre ? cliOdooId : 'null'}, ${cli ? `'${cli}'` : 'null'});`;
  await caso('Contactos 20v: los datos de un contacto de Odoo no se editan en GUDS', 'vienen de Odoo',
    como({ ...G, previo: deOdoo(23) }, `with x as (update cliente_contactos set nombre = 'X' where id = '${K(23)}' returning id) select row_to_json(x)::text from x`));
  await caso('Contactos 20v: a un contacto suelto de Odoo se le asigna un cliente en GUDS', (r) => r?.cliente_id === cliGuds,
    como({ ...G, previo: deOdoo(24) }, `with x as (update cliente_contactos set cliente_id = '${cliGuds}' where id = '${K(24)}' returning cliente_id) select row_to_json(x)::text from x`));
  await caso('Contactos 20v: un contacto hijo en Odoo no cambia de cliente en GUDS', 'el cambio se hace en Odoo',
    como({ ...G, previo: deOdoo(25, true, cliGuds) }, `with x as (update cliente_contactos set cliente_id = null where id = '${K(25)}' returning id) select row_to_json(x)::text from x`));
  await caso('Contactos 20v: un contacto de Odoo no se elimina en GUDS', 'viene de Odoo',
    como({ ...G, previo: deOdoo(26) }, `with x as (delete from cliente_contactos where id = '${K(26)}' returning id) select row_to_json(x)::text from x`));

  // Sincronización (motor del importador, sin tocar Odoo): idempotente, sin duplicar y sin pisar lo de GUDS
  const { filasContactos, sqlUpsertContactos } = await import('../supabase/functions/_shared/odoo-sync/contactos.js');
  const P = (id, extra = {}) => ({ id, name: `Persona Odoo ${id}`, function: false, email: `p${id}@guds.test`, phone: false, mobile: false, parent_id: false,
    type: 'contact', is_company: false, company_id: [1, 'GUDS'], active: true, comment: false, ...extra });
  const leidos = {
    hijos: [P(999991001, { parent_id: [cliOdooId, 'Cliente'] }), P(999991002, { parent_id: [cliOdooId, 'Cliente'], comment: '<p>(GUDS) creado por GUDS</p>' })],
    sueltos: [P(999991003), P(999991004, { company_id: false }), P(999991005)],
    clientes: new Set([cliOdooId]), proveedores: new Set(),
  };
  const filas = filasContactos(leidos);
  casos.push({ ok: filas.length === 4 && !filas.some((f) => f.odoo_id === 999991002) ? '✓' : '✗', caso: 'Contactos 20v: la sincronización no importa los contactos que creó GUDS en Odoo', resultado: `${filas.length} filas` });
  const upsert = sqlUpsertContactos(filas, new Date().toISOString());
  const previoSync = `insert into cliente_contactos (id, empresa_id, nombre, origen, odoo_id, cliente_id) values ('${K(27)}', '${guds.id}', 'De GUDS', 'guds', 999991005, '${cliGuds}');
    ${upsert}; ${upsert};`;
  await caso('Contactos 20v: la sincronización no duplica contactos (dos pasadas) ni pisa los de GUDS', (r) => r?.filas === 4 && r?.distintos === 4 && r?.hijo_cliente === true && r?.guds_intacto === 'De GUDS' && r?.compartido === true,
    como({ rol: 'postgres', previo: previoSync }, `select row_to_json(t)::text from (select count(*) filas, count(distinct odoo_id) distintos,
      bool_or(odoo_id = 999991001 and cliente_id = '${cliGuds}' and origen = 'odoo') hijo_cliente,
      max(nombre) filter (where odoo_id = 999991005) guds_intacto, bool_or(odoo_id = 999991004 and empresa_id is null) compartido
      from cliente_contactos where odoo_id between 999991000 and 999991999) t`));
  await caso('Contactos 20v: la sincronización conserva el cliente que GUDS asignó a un contacto suelto de Odoo', (r) => r?.cliente_id === cli2,
    como({ rol: 'postgres', previo: `${upsert}; update cliente_contactos set cliente_id = '${cli2}' where odoo_id = 999991003; ${upsert};` },
      `select row_to_json(t)::text from (select cliente_id from cliente_contactos where odoo_id = 999991003) t`));
  await caso('Contactos 20v: si en Odoo el contacto cambia de cliente, la sincronización desactiva su acceso', (r) => r?.activo === false,
    como({ ...G, previo: `${deOdoo(28, true, cliGuds)} update cliente_contactos set email = 'prueba.20v.28@guds.test' where id = '${K(28)}'; ${comoAdmin}
      perform public.crear_acceso_contacto('${K(28)}'); ${verif}
      perform set_config('request.jwt.claims', '', true); set local session_replication_role = replica;
      update cliente_contactos set cliente_id = '${cli2}' where id = '${K(28)}'; set local session_replication_role = origin;
      perform public.sincronizar_accesos_contactos();` }, `select pg_temp.acceso_20v('${K(28)}')`));

  // Hacia Odoo (en rollback: pg_net no llega a enviar nada)
  await caso('Contactos 20v: un contacto suelto no se encola hacia Odoo', (r) => r?.n === 0,
    como({ ...G, previo: `${comoAdmin} ${nuevoK(29)}` }, `select row_to_json(t)::text from (select count(*) n from odoo_escrituras where referencia_id = '${K(29)}') t`));
  await caso('Contactos 20v: un contacto nuevo de un proveedor de Odoo se encola (crear)', (r) => r?.accion === 'crear' && r?.proveedor_id === provGuds,
    como({ ...G, previo: `${comoAdmin} ${nuevoK(30, `proveedor_id|'${provGuds}'`)}` },
      `select row_to_json(t)::text from (select datos ->> 'accion' accion, datos ->> 'proveedor_id' proveedor_id from odoo_escrituras where referencia_id = '${K(30)}' and tipo = 'persona_contacto') t`));
  await caso('Contactos 20v: al cambiar de cliente un contacto ya enviado, queda la nota en Odoo (desligar) y se crea en el nuevo', (r) => r?.desligar === 1 && r?.crear === 1 && r?.odoo_id === null,
    como({ ...G, previo: `${nuevoK(31, `cliente_id, odoo_id, odoo_padre_id|'${cliGuds}', 999992031, ${cliOdooId}`)} ${comoAdmin}
      update cliente_contactos set cliente_id = '${cli2}' where id = '${K(31)}';` },
      `select row_to_json(t)::text from (select count(*) filter (where datos ->> 'accion' = 'desligar' and (datos ->> 'odoo_id_anterior')::int = 999992031) desligar,
        count(*) filter (where datos ->> 'accion' = 'crear' and datos ->> 'cliente_id' = '${cli2}') crear,
        (select odoo_id from cliente_contactos where id = '${K(31)}') odoo_id from odoo_escrituras where referencia_id = '${K(31)}') t`));
  const { valsContactoHijo } = await import('../supabase/functions/_shared/odoo-sync/escribir-persona-contacto.js');
  const { formaAltaPartner } = await import('../supabase/functions/_shared/odoo-sync/odoo.js');
  const vals = valsContactoHijo({ nombre: 'Persona Prueba', cargo: 'Compras', email: 'x@guds.test', telefono: null, celular: null },
    { street: 'Calle 1', city: 'Caracas', state_id: [1, 'X'], country_id: [238, 'VE'], company_id: [1, 'GUDS'], lang: 'es_VE' }, 4242, 'Prueba');
  let forma = null; try { forma = formaAltaPartner(vals); } catch (e) { forma = e.message; }
  casos.push({ ok: forma === 'contacto' && vals.parent_id === 4242 && /^<p>\(GUDS\)/.test(vals.comment) ? '✓' : '✗',
    caso: 'Contactos 20v: el contacto de un proveedor va a Odoo como hijo "(GUDS)" permitido por odoo.js', resultado: String(forma).slice(0, 100) });

  await caso('Contactos 20v: el buscador global encuentra contactos por teléfono y enlaza al módulo', (r) => r?.n >= 1 && r?.modulo === true,
    como({ ...G, previo: nuevoK(32, `celular|'+58 414-555-0132'`) }, `select row_to_json(t)::text from (select count(*) n, bool_and(enlace like '/admin/contactos?contacto=%') modulo
      from public.buscar_global('4145550132', 5) where tipo = 'contacto') t`));
}


// ── Fase 21d: bandeja de calidad y cuadre (tareas, cierre automático, corrección asistida, normalización) ──
{
  const G = { empresa: guds.id };
  const claims21 = JSON.stringify({ sub: admin, role: 'authenticated' }).replace(/'/g, "''");
  const hdr21 = (e) => JSON.stringify({ 'x-empresa-id': e }).replace(/'/g, "''");
  const admin21 = (e = guds.id) => `perform set_config('request.jwt.claims', '${claims21}', true); perform set_config('request.headers', '${hdr21(e)}', true);`;
  const PG = { rol: 'postgres', uid: null };
  const t1 = async (w) => (await sql(`select id, entidad_id from calidad_tareas where ${w} limit 1`))[0];
  const tGuds = await t1(`empresa_id = '${guds.id}' and estado = 'pendiente' and tipo = 'cobro_sin_aplicar'`);
  const tQrt = await t1(`empresa_id = '${qrt.id}' and estado = 'pendiente'`);
  const tEc = await t1(`empresa_id = '${guds.id}' and estado = 'pendiente' and tipo = 'cliente_estado_extranjero'`);
  const tCiudad = await t1(`empresa_id = '${guds.id}' and estado = 'pendiente' and tipo = 'cliente_sin_ciudad'`);
  const fila = (q) => `select row_to_json(t)::text from (${q}) t`;

  await caso('Calidad 21d: admin en GUDS ve solo tareas de GUDS y compartidas', (r) => r.n > 0 && r.otras === 0 && r.compartidas > 0,
    como(G, fila(`select count(*) n, count(*) filter (where empresa_id = '${qrt.id}') otras, count(*) filter (where empresa_id is null) compartidas from calidad_tareas`)));
  await caso('Calidad 21d: en "Ambas" se ven las dos empresas', (r) => r.empresas === 2,
    como({ empresa: 'todas' }, fila(`select count(distinct empresa_id) empresas from calidad_tareas`)));
  await caso('Calidad 21d: anónimo no lee tareas ni historial', (r, e) => !!e || (r?.n === 0 && r?.h === 0),
    como({ rol: 'anon', uid: null }, fila(`select (select count(*) from calidad_tareas) n, (select count(*) from calidad_tareas_historial) h`)));
  if (vendGuds) {
    await caso('Calidad 21d: un vendedor (sin permiso de reportes) no ve tareas ni responsables', (r) => r?.n === 0 && r?.resp === 0,
      como({ uid: vendGuds, ...G }, fila(`select (select count(*) from calidad_tareas) n, (select count(*) from public.calidad_responsables()) resp`)));
  }
  await caso('Calidad 21d: nadie escribe directo en la tabla (solo por las funciones)', (r, e) => /permission denied/i.test(e ?? ''),
    como(G, `with x as (update calidad_tareas set comentario = 'x' where id = '${tGuds.id}' returning id) select row_to_json(x)::text from x`));
  await caso('Calidad 21d: las funciones internas no se ejecutan por la API', (r, e) => /permission denied/i.test(e ?? ''),
    como(G, fila(`select public.calidad_sincronizar_tareas() x`)));
  await caso('Calidad 21d: en "Ambas" no se trabaja una tarea', 'Modo consulta',
    como({ empresa: 'todas' }, fila(`select public.calidad_actualizar_tareas(array['${tGuds.id}']::uuid[], null, null, false, 'nota') n`)));
  await caso('Calidad 21d: desde GUDS no se toca una tarea de Quirutec', 'No se encontraron',
    como(G, fila(`select public.calidad_actualizar_tareas(array['${tQrt.id}']::uuid[], null, null, false, 'nota') n`)));
  await caso('Calidad 21d: "explicado" exige comentario', 'escribe por qué',
    como(G, fila(`select public.calidad_actualizar_tareas(array['${tGuds.id}']::uuid[], 'explicado', null, false, null) n`)));
  await caso('Calidad 21d: "corregido" no se marca a mano', 'lo marca la sincronización',
    como(G, fila(`select public.calidad_actualizar_tareas(array['${tGuds.id}']::uuid[], 'corregido', null, false, 'x') n`)));
  await caso('Calidad 21d: explicar con comentario y responsable deja estado e historial', (r) => r?.estado === 'explicado' && r?.comentario === 'Revisado en prueba' && r?.resp && r?.hist === 2,
    como({ ...PG, previo: `${admin21()} perform public.calidad_actualizar_tareas(array['${tGuds.id}']::uuid[], 'explicado', (select id from usuarios where auth_id = '${admin}'), false, 'Revisado en prueba');` },
      fila(`select estado, comentario, responsable_id is not null resp, (select count(*) from calidad_tareas_historial h where h.tarea_id = '${tGuds.id}' and h.accion in ('explicada', 'responsable') and h.at > now() - interval '1 minute') hist from calidad_tareas where id = '${tGuds.id}'`)));

  // Cierre automático: la "sincronización" trae la ciudad → la tarea se cierra sola; si vuelve a faltar, se reabre
  await caso('Calidad 21d: la tarea se cierra sola cuando el dato llega corregido', (r) => r?.estado === 'corregido' && r?.auto === true && r?.hist === 1,
    como({ ...PG, previo: `update clientes set ciudad = 'Ciudad Prueba 21d' where id = '${tCiudad.entidad_id}'; perform public.calidad_sincronizar_tareas(array['cliente_sin_ciudad']);` },
      fila(`select estado, cierre_automatico auto, (select count(*) from calidad_tareas_historial h where h.tarea_id = '${tCiudad.id}' and h.accion = 'corregida' and h.at > now() - interval '1 minute') hist from calidad_tareas where id = '${tCiudad.id}'`)));
  await caso('Calidad 21d: si el problema vuelve, la tarea se reabre', (r) => r?.estado === 'pendiente' && r?.hist === 1,
    como({ ...PG, previo: `update clientes set ciudad = 'Ciudad Prueba 21d' where id = '${tCiudad.entidad_id}'; perform public.calidad_sincronizar_tareas(array['cliente_sin_ciudad']);
      update clientes set ciudad = null where id = '${tCiudad.entidad_id}'; perform public.calidad_sincronizar_tareas(array['cliente_sin_ciudad']);` },
      fila(`select estado, (select count(*) from calidad_tareas_historial h where h.tarea_id = '${tCiudad.id}' and h.accion = 'reabierta' and h.at > now() - interval '1 minute') hist from calidad_tareas where id = '${tCiudad.id}'`)));
  await caso('Calidad 21d: revisar dos veces no duplica tareas', (r) => r?.dup === 0,
    como({ ...PG, previo: `perform public.calidad_sincronizar_tareas(); perform public.calidad_sincronizar_tareas();` },
      fila(`select count(*) dup from (select tipo, clave, empresa_id from calidad_tareas group by 1, 2, 3 having count(*) > 1) x`)));

  // Normalización de presentación: la base reconoce el estado, pero el dato guardado no cambia (ni al revisar)
  const huella = (await sql(`select md5(string_agg(coalesce(estado, '∅') || coalesce(ciudad, '∅'), ',' order by id)) h from clientes`))[0].h;
  await caso('Calidad 21d: normalizar "Sucre. (VE)" no cambia el dato guardado', (r) => r?.ve === 'Sucre' && r?.bol === 'Bolívar' && r?.h === huella && r?.punto > 0,
    como({ ...PG, previo: `perform public.calidad_sincronizar_tareas();` },
      fila(`select public.estado_ve('Sucre. (VE)') ve, public.estado_ve('Bolivar. (VE)') bol, (select md5(string_agg(coalesce(estado, '∅') || coalesce(ciudad, '∅'), ',' order by id)) from clientes) h,
        (select count(*) from clientes where estado = 'Sucre. (VE)') punto`)));

  // Corrección asistida [escribe en Odoo]: encola por la cola de 19w (en rollback: pg_net no envía nada)
  if (tEc) {
    await caso('Calidad 21d: corrección asistida encola la dirección a Odoo y liga la tarea', (r) => r?.estado_dest === 'Bolívar' && r?.tipo === 'cliente_contacto' && r?.ligada === true && r?.hist === 1,
      como({ ...PG, previo: `${admin21()} perform public.calidad_corregir_direccion('${tEc.id}', jsonb_build_object('calle', (select coalesce(calle, direccion) from clientes where id = '${tEc.entidad_id}'), 'ciudad', 'Puerto Ordaz', 'estado', 'Bolívar'));` },
        fila(`select o.tipo, o.datos -> 'campos' ->> 'estado' estado_dest, t.escritura_id = o.id ligada,
          (select count(*) from calidad_tareas_historial h where h.tarea_id = t.id and h.accion = 'enviada_odoo' and h.at > now() - interval '1 minute') hist
          from calidad_tareas t join odoo_escrituras o on o.id = t.escritura_id where t.id = '${tEc.id}'`)));
    await caso('Calidad 21d: en "Ambas" no se corrige hacia Odoo', 'empresa',
      como({ empresa: 'todas' }, fila(`select public.calidad_corregir_direccion('${tEc.id}', '{"calle":"Calle prueba","ciudad":"Puerto Ordaz","estado":"Bolívar"}'::jsonb) x`)));
    await caso('Calidad 21d: un estado de otro país no se acepta en la corrección', 'estado de Venezuela',
      como(G, fila(`select public.calidad_corregir_direccion('${tEc.id}', '{"calle":"Calle prueba","ciudad":"Puerto Ordaz","estado":"Pichincha"}'::jsonb) x`)));
  }
  await caso('Calidad 21d: lo contable no tiene corrección asistida', 'no tiene corrección asistida',
    como(G, fila(`select public.calidad_corregir_direccion('${tGuds.id}', '{"calle":"Calle prueba","ciudad":"Caracas","estado":"Miranda"}'::jsonb) x`)));
  await caso('Calidad 21d: el cuadre sigue cuadrando y trae el avance de la revisión', (r) => r?.docs > 0 && r?.cuadran > 0 && r?.rev > 0,
    como(G, fila(`select (x->'totales'->>'documentos')::int docs, (x->'totales'->>'cuadran')::int cuadran, jsonb_array_length(x->'revision') rev from public.reporte_cuadre_profit_odoo() x`)));
  await caso('Calidad 21d: ocultar la sección exige empresa activa', 'Modo consulta',
    como({ empresa: 'todas' }, fila(`select public.calidad_seccion(true) x`)));
  await caso('Calidad 21d: ocultar en GUDS no la oculta en Quirutec', (r) => r?.guds === true && r?.qrt === false,
    como({ empresa: qrt.id, previo: `${admin21()} perform public.calidad_seccion(true);` },
      fila(`select (select (public.calidad_seccion() ->> 'oculta')::boolean) qrt, (select (valor::jsonb ? '${guds.id}') from configuracion where clave = 'calidad_seccion_oculta') guds`)));
}

// ── Fase 21c: planificación de pagos (planes por empresa y permiso, aprobación, cierre automático con la sincronización) ──
{
  const G = { empresa: guds.id };
  const cl = (uid = admin) => JSON.stringify({ sub: uid, role: 'authenticated' }).replace(/'/g, "''");
  const hdr = (e) => JSON.stringify({ 'x-empresa-id': e }).replace(/'/g, "''");
  const comoUsr = (e = guds.id, uid = admin) => `perform set_config('request.jwt.claims', '${cl(uid)}', true); perform set_config('request.headers', '${hdr(e)}', true);`;
  const sinSesion = `perform set_config('request.jwt.claims', '', true); perform set_config('request.headers', '{}', true);`;
  const [fa, fb] = await sql(`select id, saldo_usd::float s from v_cxp_planificacion where empresa_id = '${guds.id}' and plan_id is null and saldo_usd > 50 order by saldo_usd limit 2`);
  const [fq] = await sql(`select id from v_cxp_planificacion where empresa_id = '${qrt.id}' limit 1`);
  const it = (f, m) => `[{"factura_proveedor_id":"${f}","monto_usd":${m}}]`;
  const nuevoPlan = (items, e = guds.id, uid = admin) => `${comoUsr(e, uid)} perform public.guardar_plan_pago(null, current_date, current_date, 'prueba 21c', '${items}', 'reemplazar');`;
  const elPlan = `(select id from planes_pago where notas = 'prueba 21c' order by created_at desc limit 1)`;
  const aprobar = `${comoUsr()} perform public.cambiar_estado_plan_pago(${elPlan}, 'aprobar');`;
  // La sincronización (sin sesión) trae un pago de Odoo aplicado a la factura y luego llama a conciliar_planes_pago
  const pagoOdoo = (f, monto) => `${sinSesion} insert into factura_proveedor_aplicaciones (empresa_id, odoo_id, factura_proveedor_id, tipo, monto_usd, fecha)
    values ('${guds.id}', 999921001, '${f}', 'pago', ${monto}, current_date); perform public.conciliar_planes_pago('${guds.id}');`;
  const estado = `select row_to_json(t)::text from (select p.estado, p.cierre, i.estado item, i.monto_pagado_usd::float pagado, i.diferencia_usd::float dif, i.motivo_diferencia motivo
    from planes_pago p join planes_pago_items i on i.plan_id = p.id where p.notas = 'prueba 21c' order by p.created_at desc limit 1) t`;
  const rol = (nombre) => `perform set_config('guds.bypass_guard', 'on', true); update usuarios set rol_id = (select id from roles where nombre = '${nombre}') where auth_id = '${admin}'; perform set_config('guds.bypass_guard', 'off', true);`;

  if (fa && fb && fq) {
    await caso('Planes 21c: en GUDS se crea un plan GUDS-PP-… en borrador y el ítem hereda la empresa', (r) => /^GUDS-PP-\d{5}$/.test(r?.numero) && r?.estado === 'borrador' && r?.item_empresa === guds.id,
      como({ ...G, previo: nuevoPlan(it(fa.id, 10)) }, `select row_to_json(t)::text from (select p.numero, p.estado, i.empresa_id item_empresa from planes_pago p join planes_pago_items i on i.plan_id = p.id where p.notas = 'prueba 21c') t`));
    await caso('Planes 21c: en «Ambas empresas» no se crean planes', 'Modo consulta',
      como({ empresa: 'todas' }, `select public.guardar_plan_pago(null, current_date, current_date, 'prueba 21c', '${it(fa.id, 10)}', 'reemplazar')::text`));
    await caso('Planes 21c: un plan de GUDS no acepta facturas de Quirutec', 'pertenece a otra empresa',
      como(G, `select public.guardar_plan_pago(null, current_date, current_date, 'prueba 21c', '${it(fq.id, 10)}', 'reemplazar')::text`));
    await caso('Planes 21c: el monto no puede superar el saldo de la factura', 'supera su saldo',
      como(G, `select public.guardar_plan_pago(null, current_date, current_date, 'prueba 21c', '${it(fa.id, Math.ceil(fa.s + 5))}', 'reemplazar')::text`));
    await caso('Planes 21c: una factura no está en dos planes activos a la vez', 'ya está en el plan',
      como({ ...G, previo: nuevoPlan(it(fa.id, 10)) }, `select public.guardar_plan_pago(null, current_date, current_date, 'otro 21c', '${it(fa.id, 5)}', 'reemplazar')::text`));
    await caso('Planes 21c: desde Quirutec no se ven los planes de GUDS (RLS por empresa)', (r) => r?.n === 0,
      como({ empresa: qrt.id, previo: nuevoPlan(it(fa.id, 10)) }, `select row_to_json(t)::text from (select count(*)::int n from planes_pago where notas = 'prueba 21c') t`));
    await caso('Planes 21c: nadie escribe directo en planes_pago (solo por las funciones)', (r, e) => !!e && /permission denied|row-level security/i.test(e),
      como(G, `with x as (insert into planes_pago (empresa_id, numero, fecha_corte, fecha_pago) values ('${guds.id}', 'X-21c', current_date, current_date) returning id) select row_to_json(x)::text from x`));
    await caso('Planes 21c: anónimo no lee planes ni la vista de planificación', (r, e) => !!e && /permission denied/i.test(e),
      como({ rol: 'anon', uid: null }, `select ((select count(*) from planes_pago) + (select count(*) from v_cxp_planificacion))::text`));
    await caso('Planes 21c: rol sin permiso (Almacén) no ve planes ni facturas a planificar', (r) => r?.planes === 0 && r?.facturas === 0,
      como({ ...G, previo: `${nuevoPlan(it(fa.id, 10))} ${rol('Almacén')}` }, `select row_to_json(t)::text from (select (select count(*)::int from planes_pago) planes, (select count(*)::int from v_cxp_planificacion) facturas) t`));
    await caso('Planes 21c: rol sin permiso (Almacén) no crea planes', 'No tienes permiso',
      como({ ...G, previo: rol('Almacén') }, `select public.guardar_plan_pago(null, current_date, current_date, 'prueba 21c', '${it(fa.id, 10)}', 'reemplazar')::text`));
    await caso('Planes 21c: el Contador planifica pero no aprueba', 'No tienes permiso para aprobar',
      como({ ...G, previo: `${rol('Contador')} ${nuevoPlan(it(fa.id, 10))}` }, `select public.cambiar_estado_plan_pago(${elPlan}, 'aprobar')::text`));
    await caso('Planes 21c: el aprobador aprueba (borrador → aprobado)', (r) => r?.estado === 'aprobado' && r?.item === 'pendiente',
      como({ ...G, previo: `${nuevoPlan(it(fa.id, 10))} ${aprobar}` }, estado));
    await caso('Planes 21c: un plan aprobado ya no se modifica', 'Solo se modifica un plan en borrador',
      como({ ...G, previo: `${nuevoPlan(it(fa.id, 10))} ${aprobar}` }, `select public.guardar_plan_pago(${elPlan}, null, null, null, '${it(fa.id, 8)}', 'reemplazar')::text`));
    await caso('Planes 21c: cierre automático — el pago de Odoo igual a lo planificado cierra el ítem y el plan', (r) => r?.estado === 'pagado' && r?.cierre === 'automatico' && r?.item === 'pagado' && r?.pagado === 10,
      como({ ...G, previo: `${nuevoPlan(it(fa.id, 10))} ${aprobar} ${pagoOdoo(fa.id, 10)}` }, estado));
    await caso('Planes 21c: pago menor a lo planificado con saldo pendiente queda parcial (el plan sigue aprobado)', (r) => r?.estado === 'aprobado' && r?.item === 'parcial' && r?.dif === -6,
      como({ ...G, previo: `${nuevoPlan(it(fa.id, 10))} ${aprobar} ${pagoOdoo(fa.id, 4)}` }, estado));
    await caso('Planes 21c: pago mayor a lo planificado se señala como diferencia', (r) => r?.estado === 'pagado' && r?.item === 'diferencia' && r?.dif === 5 && /más/.test(r?.motivo ?? ''),
      como({ ...G, previo: `${nuevoPlan(it(fa.id, 10))} ${aprobar} ${pagoOdoo(fa.id, 15)}` }, estado));
    await caso('Planes 21c: factura saldada sin pago (p. ej. nota de crédito) se señala como diferencia', (r) => r?.item === 'diferencia' && /sin pago/.test(r?.motivo ?? ''),
      como({ ...G, previo: `${nuevoPlan(it(fa.id, 10))} ${aprobar} ${sinSesion} update facturas_proveedor set saldo_usd = 0 where id = '${fa.id}'; perform public.conciliar_planes_pago('${guds.id}');` }, estado));
    await caso('Planes 21c: con pagos registrados no se devuelve a borrador', 'ya tiene pagos registrados',
      como({ ...G, previo: `${nuevoPlan(it(fa.id, 10))} ${aprobar} ${pagoOdoo(fa.id, 4)}` }, `select public.cambiar_estado_plan_pago(${elPlan}, 'devolver')::text`));
    await caso('Planes 21c: un pago anterior a la fecha del plan no lo cierra', (r) => r?.item === 'pendiente',
      como({ ...G, previo: `${nuevoPlan(it(fa.id, 10))} ${aprobar} ${sinSesion} insert into factura_proveedor_aplicaciones (empresa_id, odoo_id, factura_proveedor_id, tipo, monto_usd, fecha)
        values ('${guds.id}', 999921002, '${fa.id}', 'pago', 10, current_date - 3); perform public.conciliar_planes_pago('${guds.id}');` }, estado));
    await caso('Planes 21c: anular libera la factura para otro plan', (r) => /^[0-9a-f-]{36}$/.test(r?.id ?? ''),
      como({ ...G, previo: `${nuevoPlan(it(fa.id, 10))} ${comoUsr()} perform public.cambiar_estado_plan_pago(${elPlan}, 'anular', 'prueba');` },
        `select row_to_json(t)::text from (select public.guardar_plan_pago(null, current_date, current_date, 'otro 21c', '${it(fa.id, 5)}', 'reemplazar') id) t`));
  }
  // Vista de planificación = facturas de proveedor con saldo (mismo total por empresa)
  await caso('Planes 21c: la vista de planificación suma lo mismo que las facturas con saldo', (r) => r?.ok === true,
    como(G, `select row_to_json(t)::text from (select (select round(sum(saldo_usd), 2) from v_cxp_planificacion) = (select round(sum(saldo_usd), 2) from facturas_proveedor
      where estado = 'posted' and tipo = 'factura' and saldo_usd > 0.009) ok) t`));
  await caso('Planes 21c: día de caja — sin permiso de configuración no se cambia', 'No tienes permiso',
    como({ ...G, previo: rol('Almacén') }, `select public.fijar_dia_caja('${guds.id}', 2::smallint)::text`));
  await caso('Planes 21c: día de caja — el admin lo cambia para cualquier empresa permitida', (r) => r?.dia === 2,
    como({ ...G, previo: `${comoUsr()} perform public.fijar_dia_caja('${qrt.id}', 2::smallint);` }, `select row_to_json(t)::text from (select dia_semana dia from dias_caja where empresa_id = '${qrt.id}') t`));
}


// ── Fase 21a: categorías, vendedores y empleados por empresa (plan de revisión del 30-sep) ──
{
  const G21 = { empresa: guds.id }, Q21 = { empresa: qrt.id };
  // Cliente del portal temporal (en rollback): auth + usuario cliente ligado a un cliente de la empresa
  const portal21 = (n, clienteId) => `
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('00000000-0000-4000-a000-0000000021${n}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'portal.21a.${n}@guds.test', '', now(), '{}', '{}', now(), now());
    insert into usuarios (auth_id, email, nombre, role, cliente_id, activo) values ('00000000-0000-4000-a000-0000000021${n}', 'portal.21a.${n}@guds.test', 'Portal 21a', 'cliente', '${clienteId}', true);`;
  const cliPortalG = (await sql(`select id from clientes where empresa_id = '${guds.id}' and activo and not es_empleado order by codigo limit 1`))[0].id;
  const cliPortalQ = (await sql(`select id from clientes where empresa_id = '${qrt.id}' and activo and not es_empleado order by codigo limit 1`))[0].id;
  const catQ = (await sql(`select array_agg(id) ids from categorias where empresas = array['${qrt.id}']::uuid[]`))[0].ids ?? [];
  const catG = (await sql(`select array_agg(id) ids from categorias where empresas = array['${guds.id}']::uuid[]`))[0].ids ?? [];
  const catNoVenta = (await sql(`select array_agg(id) ids from categorias where not de_venta`))[0].ids ?? [];
  const arr = (ids) => `array[${ids.map((x) => `'${x}'`).join(',') || `'00000000-0000-0000-0000-000000000000'`}]::uuid[]`;
  const catsPortal = (lista) => `select row_to_json(t)::text from (select count(*) n,
      count(*) filter (where (e ->> 'id')::uuid = any (${arr(catQ)})) de_quirutec, count(*) filter (where (e ->> 'id')::uuid = any (${arr(catG)})) de_guds,
      count(*) filter (where (e ->> 'id')::uuid = any (${arr(catNoVenta)})) no_venta,
      bool_or(e ->> 'grupo' is not null and e ->> 'etiqueta' not like '%/%') con_grupo
    from jsonb_array_elements(public.categorias_portal()) e) t`;
  const uidPortal = (n) => `00000000-0000-4000-a000-0000000021${n}`;

  await caso('Categorías 21a: en el portal de GUDS no aparece ninguna categoría solo de Quirutec ni las que no son de venta', (r) => r?.n > 0 && r.de_quirutec === 0 && r.no_venta === 0 && r.de_guds > 0,
    como({ ...G21, uid: uidPortal('01'), previo: portal21('01', cliPortalG) }, catsPortal()));
  await caso('Categorías 21a: en el portal de Quirutec, solo las suyas, con el padre como grupo ("A / B" → grupo A)', (r) => r?.n > 0 && r.de_guds === 0 && r.de_quirutec > 0 && r.con_grupo === true,
    como({ ...Q21, uid: uidPortal('02'), previo: portal21('02', cliPortalQ) }, catsPortal()));
  const catQVisible = (await sql(`select c.id from categorias c where c.empresas = array['${qrt.id}']::uuid[] and c.activo
    and exists (select 1 from productos p where p.categoria_id = c.id and p.activo and p.vendible and not coalesce(p.oculto_tienda, false)) limit 1`))[0]?.id;
  await caso('Categorías 21a: el interruptor manual (activo = false) la saca del portal', (r) => r?.antes === 1 && r?.oculta === 0,
    como({ ...Q21, uid: uidPortal('03'), previo: `${portal21('03', cliPortalQ)} update categorias set activo = false where id = '${catQVisible}';` },
      `select row_to_json(t)::text from (select count(*) filter (where (e ->> 'id')::uuid = '${catQVisible}') oculta,
        (select count(*) from categorias where id = '${catQVisible}' and de_venta) antes from jsonb_array_elements(public.categorias_portal()) e) t`));
  const prodQ = (await sql(`select id, categoria_id from productos where empresa_id = '${qrt.id}' and categoria_id is not null limit 1`))[0];
  const catSoloG = (await sql(`select id from categorias where empresas = array['${guds.id}']::uuid[] limit 1`))[0]?.id;
  await caso('Categorías 21a: al mover un producto de Quirutec a una categoría de GUDS, la categoría pasa a compartida', (r) => r?.n === 2,
    como({ rol: 'postgres', uid: null, previo: `update productos set categoria_id = '${catSoloG}' where id = '${prodQ.id}';` },
      `select row_to_json(t)::text from (select cardinality(empresas) n from categorias where id = '${catSoloG}') t`));

  // Vendedores por empresa
  const vendQ = (await sql(`select id from usuarios where role = 'vendedor' and not es_prueba and public.vendedor_empresas(id) = array['${qrt.id}']::uuid[] limit 1`))[0].id;
  const vendG = (await sql(`select id from usuarios where role = 'vendedor' and not es_prueba and public.vendedor_empresas(id) = array['${guds.id}']::uuid[] limit 1`))[0].id;
  const listaV = `select row_to_json(t)::text from (select count(*) n, bool_or(id = '${vendQ}') de_quirutec, bool_or(id = '${vendG}') de_guds,
      count(*) filter (where es_prueba) prueba from public.vendedores_empresa()) t`;
  await caso('Vendedores 21a: en GUDS no sale un vendedor que solo tiene clientes en Quirutec (ni los de prueba)', (r) => r?.n > 0 && r.de_quirutec === false && r.de_guds === true && r.prueba === 0,
    como(G21, listaV));
  await caso('Vendedores 21a: en Quirutec no sale un vendedor que solo tiene clientes en GUDS', (r) => r?.n > 0 && r.de_quirutec === true && r.de_guds === false,
    como(Q21, listaV));
  await caso('Vendedores 21a: un vendedor no ve la lista de vendedores', 'No tienes permiso',
    como({ ...G21, uid: (await sql(`select auth_id from usuarios where id = '${vendG}'`))[0].auth_id }, `select count(*)::text from public.vendedores_empresa()`));
  await caso('Vendedores 21a: metas solo con vendedores de la empresa (sin QA)', (r) => r?.otro === 0 && r?.prueba === 0 && r?.n > 0,
    como(G21, `select row_to_json(t)::text from (select count(*) n, count(*) filter (where (v ->> 'id')::uuid = '${vendQ}' and (v ->> 'venta')::numeric = 0 and coalesce((v ->> 'meta')::numeric, 0) = 0) otro,
      count(*) filter (where (v ->> 'email') ~ '@gudsqa\\.com$|^qa\\.') prueba
      from jsonb_array_elements(public.metas_vendedores(extract(year from now())::int, extract(month from now())::int) -> 'vendedores') v) t`));

  // Correo real y acceso (0.4)
  await caso('Vendedores 21a: el admin carga el correo real, genera la clave temporal y pide cambio', (r) => r?.temporal === 'si' && r?.perfil === 'real.21a@ejemplo.com' && r?.cambio === true && r?.auth === 'real.21a@ejemplo.com',
    como({ ...G21, previo: `perform set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: admin, role: 'authenticated' }))}, true);
      perform set_config('guds.t21', (select case when password_temporal is not null then 'si' else 'no' end from public.actualizar_acceso_vendedor('${vendG}', 'Real.21a@Ejemplo.com')), true);
      perform set_config('guds.t21_auth', (select a.email from auth.users a join usuarios u on u.auth_id = a.id where u.id = '${vendG}'), true);` },
      `select row_to_json(t)::text from (select current_setting('guds.t21', true) temporal, current_setting('guds.t21_auth', true) auth,
        email perfil, debe_cambiar_clave cambio from usuarios where id = '${vendG}') t`));
  await caso('Vendedores 21a: no acepta un correo de relleno @guds.test', 'correo real',
    como(G21, `select email from public.actualizar_acceso_vendedor('${vendG}', 'otro.nombre@guds.test')`));
  await caso('Vendedores 21a: no acepta el correo de otro usuario', 'Ya existe un usuario',
    como(G21, `select email from public.actualizar_acceso_vendedor('${vendG}', (select email from usuarios where role = 'admin' and email not like '%@guds.test' limit 1))`));
  await caso('Vendedores 21a: un vendedor no puede cambiar el acceso de otro', 'No tienes permiso',
    como({ ...G21, uid: (await sql(`select auth_id from usuarios where id = '${vendG}'`))[0].auth_id }, `select email from public.actualizar_acceso_vendedor('${vendQ}', 'x.21a@ejemplo.com')`));
  await caso('Usuarios 21a: un usuario nuevo qa./e2e. o @gudsqa.com queda marcado de prueba', (r) => r?.a === true && r?.b === true && r?.c === false,
    como({ rol: 'postgres', uid: null }, `select row_to_json(t)::text from (select public.es_correo_prueba('e2e.filtros.admin@guds.test') a,
      public.es_correo_prueba('test.vendedor@gudsqa.com') b, public.es_correo_prueba('adrian.gonzalez@guds.test') c) t`));

  // Empleados
  const vendEmpleado = (await sql(`select u.auth_id, u.id from usuarios u where exists (select 1 from clientes c where c.vendedor_asignado_id = u.id and c.es_empleado and c.activo) and u.role = 'vendedor' and u.auth_id is not null limit 1`))[0];
  if (vendEmpleado) {
    await caso('Empleados 21a: no cuentan en la cartera del portal del vendedor', (r) => r?.empleados === 0,
      como({ uid: vendEmpleado.auth_id, empresa: 'todas' }, `select row_to_json(t)::text from (select count(*) filter (where (x ->> 'id')::uuid in (select id from clientes where es_empleado)) empleados
        from jsonb_array_elements(public.cartera_vendedor() -> 'clientes') x) t`));
    await caso('Empleados 21a: no cuentan en los clientes del vendedor en Vendedores', (r) => r?.clientes === r?.esperado,
      como({ empresa: 'todas' }, `select row_to_json(t)::text from (select v.clientes, (select count(*)::int from clientes c where c.vendedor_asignado_id = '${vendEmpleado.id}' and c.activo and not c.es_empleado) esperado
        from public.vendedores_empresa(true) v where v.id = '${vendEmpleado.id}') t`));
  }
  await caso('Empleados 21a: las compras de personal salen como canal "Personal" en el cubo de ventas', (r) => r?.personal > 0,
    como(G21, `select row_to_json(t)::text from (select coalesce(sum(venta_usd) filter (where k1 = 'Personal'), 0) personal
      from public.reporte_ventas_cubo('2025-01-01', current_date, array['canal'], 'odoo') where nivel = 1) t`));
}


// ── Fase 21b: estado de cuenta a profundidad (cruce por factura, comentarios, correo, envío masivo) y métricas de cobranza ──
{
  const G = { empresa: guds.id };
  const doc = (await sql(`select f.id, f.cliente_id from facturas f join clientes c on c.id = f.cliente_id
    where f.estado = 'posted' and f.tipo = 'factura' and f.saldo_usd > 1 and f.empresa_id = '${guds.id}' and c.empresa_id = '${guds.id}' limit 1`))[0];
  const TOKEN = 'Prueba21bPrueba21bPrueba21bPrueba21bPrueba2';   // 43 caracteres url-safe
  const previoComentarios = `insert into factura_comentarios (factura_id, empresa_id, texto, visible_cliente) values
      ('${doc.id}', '${guds.id}', 'TXT21B_VISIBLE esto es el IGTF', true), ('${doc.id}', '${guds.id}', 'TXT21B_INTERNO cliente difícil', false);
    insert into estado_cuenta_enlaces (cliente_id, empresa_id, token) values ('${doc.cliente_id}', '${guds.id}', '${TOKEN}')
      on conflict do nothing;
    update estado_cuenta_enlaces set revocado_at = now(), revocado_motivo = 'reemplazado' where cliente_id = '${doc.cliente_id}' and empresa_id = '${guds.id}' and token <> '${TOKEN}' and revocado_at is null;`;
  const ANON = { rol: 'anon', uid: null };

  await caso('Estado de cuenta 21b: el enlace público muestra el comentario visible y NO el interno', (r) => r?.visible === true && r?.interno === false && r?.autor === false,
    como({ ...ANON, previo: previoComentarios }, `select row_to_json(t)::text from (select v::text like '%TXT21B_VISIBLE%' visible, v::text like '%TXT21B_INTERNO%' interno,
      (v -> 'abiertos') @? '$[*].comentarios[*].autor' autor from (select public.estado_cuenta_publico('${TOKEN}') v) x) t`));
  await caso('Estado de cuenta 21b: el enlace público no trae ids internos (documentos, cobros ni comentarios)', (r) => r?.ids === false,
    como({ ...ANON, previo: previoComentarios }, `select row_to_json(t)::text from (select ((v -> 'abiertos') @? '$[*].factura_id' or (v -> 'abiertos') @? '$[*].comentarios[*].id'
      or (v -> 'abiertos') @? '$[*].abonos[*].pago_id') ids from (select public.estado_cuenta_publico('${TOKEN}') v) x) t`));
  await caso('Estado de cuenta 21b: el admin ve el comentario interno con su marca y autor', (r) => r?.interno === true && r?.marca === true,
    como({ ...G, previo: previoComentarios }, `select row_to_json(t)::text from (select v::text like '%TXT21B_INTERNO%' interno,
      (v -> 'abiertos') @? '$[*].comentarios[*] ? (@.visible == false)' marca from (select public.estado_cuenta_cliente('${doc.cliente_id}') v) x) t`));
  await caso('Estado de cuenta 21b: anónimo no lee la tabla de comentarios', (r, err) => /permission denied/.test(err || ''),
    como(ANON, `select row_to_json(t)::text from (select count(*) n from factura_comentarios) t`));
  if (cliUser) {
    await caso('Estado de cuenta 21b: un cliente del portal no lee comentarios de la tabla (ni internos ni de otros)', (r) => r?.n === 0,
      como({ uid: cliUser, previo: previoComentarios }, `select row_to_json(t)::text from (select count(*) n from factura_comentarios) t`));
  }
  await caso('Estado de cuenta 21b: comentar y editar deja historial (1 vigente, 1 reemplazado, con autor)', (r) => r?.vigentes === 1 && r?.reemplazados === 1 && r?.autor === true,
    como({ ...G, previo: `perform set_config('request.jwt.claims', '${claimsAdmin}', true); perform set_config('request.headers', '${hdr(guds.id)}', true);
      perform public.comentar_factura('${doc.id}', 'TXT21B_V1', true, (select id from factura_comentarios where texto = 'nada'));
      perform public.comentar_factura('${doc.id}', 'TXT21B_V2', false, (select id from factura_comentarios where texto = 'TXT21B_V1'));` },
      `select row_to_json(t)::text from (select count(*) filter (where retirado_at is null and texto like 'TXT21B_V%') vigentes,
        count(*) filter (where retirado_motivo = 'reemplazado' and texto = 'TXT21B_V1') reemplazados, bool_and(autor_id is not null) autor
        from factura_comentarios where factura_id = '${doc.id}' and texto like 'TXT21B_V%') t`));
  await caso('Estado de cuenta 21b: en "Ambas" no se comenta', 'Modo consulta',
    como({ empresa: 'todas' }, `select row_to_json(t)::text from (select public.comentar_factura('${doc.id}', 'x') r) t`));
  if (vendGuds) {
    await caso('Estado de cuenta 21b: un vendedor no escribe comentarios', 'No tienes permiso',
      como({ uid: vendGuds, ...G }, `select row_to_json(t)::text from (select public.comentar_factura('${doc.id}', 'x') r) t`));
    await caso('Métricas 21b: el vendedor solo ve métricas de su cartera', (r) => r?.ajenos === 0,
      como({ uid: vendGuds, ...G }, `select row_to_json(t)::text from (select count(*) filter (where (m ->> 'cliente_id')::uuid not in (select public.mis_clientes_vendedor())) ajenos
        from jsonb_array_elements(public.metricas_cobranza() -> 'clientes') m) t`));
  }
  await caso('Métricas 21b: anónimo no ve métricas de cobranza', (r, err) => /permission denied|No autenticado/.test(err || ''),
    como(ANON, `select row_to_json(t)::text from (select public.metricas_cobranza() v) t`));
  await caso('Métricas 21b: la deuda de las métricas cuadra con Cuentas (Σ saldo > 0 de facturas visibles)', (r) => Math.abs(r?.dif ?? 99) < 0.05,
    como(G, `select row_to_json(t)::text from (select round((select sum((m ->> 'deuda')::numeric) from jsonb_array_elements(public.metricas_cobranza() -> 'clientes') m)
      - (select sum(saldo_usd) from facturas where estado = 'posted' and saldo_usd > 0.009), 2) dif) t`));
  await caso('Métricas 21b: la tendencia reconstruida coincide con el saldo actual (total − aplicado hasta hoy = saldo)', (r) => r?.malos === 0,
    como({ rol: 'postgres' }, `select row_to_json(t)::text from (select count(*) malos from facturas f
      left join (select factura_id, sum(monto_usd) s from factura_aplicaciones group by 1) a on a.factura_id = f.id
      where f.estado = 'posted' and f.tipo = 'factura' and abs(f.total_usd - coalesce(a.s, 0) - f.saldo_usd) > 0.02) t`));

  // Cruce por documento en una muestra de 40 clientes de las dos empresas (como postgres, la función interna)
  const docsCuadre = `with cl as (select distinct f.cliente_id, f.empresa_id from facturas f where f.estado = 'posted' and abs(f.saldo_usd) > 0.009 and f.empresa_id is not null
      order by 1 limit 40), d as (select x from cl, jsonb_array_elements(public.estado_cuenta_documentos(cl.cliente_id, cl.empresa_id, 'abiertas', null, null, true)) x)
    select row_to_json(t)::text from (select count(*) docs,
      count(*) filter (where abs((x ->> 'abonado')::numeric - (abs((x ->> 'total')::numeric) - abs((x ->> 'saldo')::numeric))) > 0.02) abonos_mal,
      count(*) filter (where abs((x ->> 'base')::numeric + (x ->> 'iva')::numeric - (x ->> 'total')::numeric) > 0.02) base_iva_mal,
      count(*) filter (where abs((select coalesce(sum((a ->> 'monto')::numeric), 0) from jsonb_array_elements(x -> 'abonos') a) - (x ->> 'abonado')::numeric) > 0.02) detalle_mal
      from d) t`;
  await caso('Estado de cuenta 21b: por documento, abonos = total − saldo, base + IVA = total y el desglose suma lo abonado (40 clientes)',
    (r) => r?.docs > 0 && r?.abonos_mal === 0 && r?.base_iva_mal === 0 && r?.detalle_mal === 0, como({ rol: 'postgres' }, docsCuadre));

  // Envíos y correo
  await caso('Correo 21b: un usuario no registra envíos directo (solo la función edge)', (r, err) => /permission denied/.test(err || ''),
    como(G, `select row_to_json(t)::text from (select public.registrar_envio_estado_cuenta(null, '${doc.cliente_id}', '${guds.id}', null, array['a@b.co'], 'x', null, null, null, null) r) t`));
  await caso('Correo 21b: un usuario no marca entregas ni rebotes (solo el webhook firmado)', (r, err) => /permission denied/.test(err || ''),
    como(G, `select row_to_json(t)::text from (select public.registrar_entrega_envio_estado_cuenta('x', 'email.bounced', null) r) t`));
  await caso('Correo 21b: un envío masivo admite hasta 200 clientes', 'Máximo 200',
    como(G, `select row_to_json(t)::text from (select public.crear_lote_estado_cuenta((select array_agg(id) from (select id from clientes where empresa_id = '${guds.id}' limit 201) x)) r) t`));
  await caso('Correo 21b: un envío del lote no se registra para un cliente fuera del lote', 'no corresponde',
    como({ rol: 'postgres', previo: `insert into estado_cuenta_lotes (id, empresa_id, creado_por, clientes) values ('${'2'.repeat(8)}-2222-2222-2222-${'2'.repeat(12)}', '${guds.id}', null, array['${doc.cliente_id}'::uuid]);` },
      `select row_to_json(t)::text from (select public.registrar_envio_estado_cuenta(null, '${cliGuds === doc.cliente_id ? cliQrt : cliGuds}', '${guds.id}', null, array['a@resend.dev'], 'x', null, null, null, '${'2'.repeat(8)}-2222-2222-2222-${'2'.repeat(12)}') r) t`));
  await caso('Correo 21b: el correo del cliente se valida antes de ir a Odoo', 'formato válido',
    como({ ...G, previo: '' }, `select row_to_json(t)::text from (select public.actualizar_contacto_cliente('${cliOdoo}', '{"email": "no-es-correo"}') r) t`));
  await caso('Correo 21b: el correo del cliente se encola hacia Odoo (cliente_contacto, en minúsculas)', (r) => r?.email === 'cuentas.prueba21b@resend.dev',
    como({ ...G, previo: `perform set_config('request.jwt.claims', '${claimsAdmin}', true); perform set_config('request.headers', '${hdr(guds.id)}', true);
      perform public.actualizar_contacto_cliente('${cliOdoo}', '{"email": " Cuentas.Prueba21b@Resend.dev "}');` },
      `select row_to_json(t)::text from (select datos -> 'campos' ->> 'email' email from odoo_escrituras
        where tipo = 'cliente_contacto' and referencia_id = '${cliOdoo}' order by created_at desc limit 1) t`));
}

// ── Fase 21e: listas de precios de GUDS (precio por producto, historial, asignación, RLS de precios por cliente) ──
{
  const L = '21e00000-0000-4000-8000-000000000001';
  const prodQ = (await sql(`select id from productos where empresa_id = '${qrt.id}' and activo order by nombre limit 2`)).map((r) => r.id);
  const prodG = (await sql(`select id from productos where empresa_id = '${guds.id}' and activo limit 1`))[0].id;
  const cliQ = (await sql(`select id from clientes where empresa_id = '${qrt.id}' and activo and not es_empleado limit 1`))[0].id;
  const listaOdooQ = (await sql(`select id from listas_precios where empresa_id = '${qrt.id}' and odoo_id is not null limit 1`))[0].id;
  const cliDeUser = cliUser ? (await sql(`select cliente_id from usuarios where auth_id = '${cliUser}'`))[0]?.cliente_id : null;
  const empCliUser = cliDeUser ? (await sql(`select empresa_id from clientes where id = '${cliDeUser}'`))[0]?.empresa_id : null;
  const Qa = { empresa: qrt.id };
  const crear = (emp = qrt.id, id = L) => `insert into listas_precios (id, nombre, empresa_id, moneda, activo, es_default, porcentaje_descuento)
    values ('${id}', 'Prueba 21e', '${emp}', 'USD', true, false, 0);`;
  const comoAdmin = (emp) => `perform set_config('request.jwt.claims', '${claimsAdmin}', true); perform set_config('request.headers', '${hdr(emp)}', true);`;
  const items = (arr) => lit(JSON.stringify(arr)) + '::jsonb';

  await caso('Listas 21e: guardar precios a mano deja historial (2 nuevos, 1 cambiado, 1 quitado)', (r) => r?.n === 1 && r?.precio === 11 && r?.hist === 4 && r?.origenes === 'manual',
    como({ ...Qa, previo: crear() + comoAdmin(qrt.id) + `
      perform public.guardar_precios_lista('${L}', ${items([{ producto_id: prodQ[0], precio: 10 }, { producto_id: prodQ[1], precio: 5.5 }])});
      perform public.guardar_precios_lista('${L}', ${items([{ producto_id: prodQ[0], precio: 11 }, { producto_id: prodQ[1], precio: null }])});` },
      `select row_to_json(t)::text from (select (select count(*) from precios_lista where lista_precios_id = '${L}') n,
        (select precio::float from precios_lista where lista_precios_id = '${L}' and producto_id = '${prodQ[0]}') precio,
        (select count(*) from precios_lista_historial where lista_precios_id = '${L}') hist,
        (select string_agg(distinct origen, ',') from precios_lista_historial where lista_precios_id = '${L}') origenes) t`));
  await caso('Listas 21e: una lista de Odoo no se edita en GUDS', 'viene de Odoo',
    como(Qa, `select public.guardar_precios_lista('${listaOdooQ}', ${items([{ producto_id: prodQ[0], precio: 1 }])})::text`));
  await caso('Listas 21e: un producto de otra empresa se rechaza', 'otra empresa',
    como({ ...Qa, previo: crear() }, `select public.guardar_precios_lista('${L}', ${items([{ producto_id: prodG, precio: 1 }])})::text`));
  await caso('Listas 21e: un precio negativo se rechaza', 'Precio no válido',
    como({ ...Qa, previo: crear() }, `select public.guardar_precios_lista('${L}', ${items([{ producto_id: prodQ[0], precio: -1 }])})::text`));
  await caso('Listas 21e: la importación queda registrada con sus no encontrados', (r) => r?.cargas === 1 && r?.ne === 1 && r?.cambio === true,
    como({ ...Qa, previo: crear() + comoAdmin(qrt.id) + `
      perform public.guardar_precios_lista('${L}', ${items([{ producto_id: prodQ[0], precio: 8 }])}, 'importacion', 'lista.xlsx', '[{"fila": 3, "codigo": "X"}]'::jsonb);` },
      `select row_to_json(t)::text from (select count(*) cargas, max(jsonb_array_length(no_encontrados)) ne,
        bool_and(exists (select 1 from precios_lista_historial h where h.carga_id = c.id)) cambio from precios_lista_cargas c where lista_precios_id = '${L}') t`));
  await caso('Listas 21e: no se asigna la lista a un cliente de otra empresa', 'otra empresa',
    como({ ...Qa, previo: crear() }, `select public.asignar_lista_clientes('${L}', array['${cliOdoo}']::uuid[])::text`));
  await caso('Listas 21e: asignar la lista cambia el precio efectivo del cliente', (r) => r?.asignados === 1 && r?.efectivo === 10,
    como({ ...Qa, previo: crear() + comoAdmin(qrt.id) + `
      perform public.guardar_precios_lista('${L}', ${items([{ producto_id: prodQ[0], precio: 10 }])});
      perform public.asignar_lista_clientes('${L}', array['${cliQ}']::uuid[]);` },
      `select row_to_json(t)::text from (select (select count(*) from clientes where lista_precios_id = '${L}') asignados,
        public.precio_efectivo('${prodQ[0]}', null, '${cliQ}')::float efectivo) t`));
  if (vendGuds) {
    await caso('Listas 21e: un vendedor no edita precios de listas', 'No tienes permiso',
      como({ uid: vendGuds, empresa: guds.id, previo: crear(guds.id) }, `select public.guardar_precios_lista('${L}', ${items([{ producto_id: prodG, precio: 1 }])})::text`));
  }
  await caso('Listas 21e: anónimo no ejecuta las funciones de listas', (r, err) => /permission denied/.test(err || ''),
    como({ rol: 'anon', uid: null }, `select public.guardar_precios_lista('${L}', '[]'::jsonb)::text`));
  if (cliUser && cliDeUser && empCliUser) {
    // Lista con precio asignada a OTRO cliente: el usuario del portal no la ve; asignada a SU cliente, sí
    const precio = `insert into precios_lista (lista_precios_id, producto_id, precio, empresa_id)
      select '${L}', p.id, 1, '${empCliUser}' from productos p where (p.empresa_id = '${empCliUser}' or p.empresa_id is null) and p.activo limit 1;`;
    await caso('Listas 21e: un cliente del portal no lee la lista de precios de otro cliente', (r) => r?.precios === 0 && r?.listas === 0,
      como({ uid: cliUser, previo: crear(empCliUser) + precio + `update clientes set lista_precios_id = '${L}' where id = (select id from clientes where empresa_id = '${empCliUser}' and id <> '${cliDeUser}' and public.normalizar_rif(coalesce(rif, '')) is distinct from (select public.normalizar_rif(rif) from clientes where id = '${cliDeUser}') limit 1);` },
        `select row_to_json(t)::text from (select (select count(*) from precios_lista where lista_precios_id = '${L}') precios, (select count(*) from listas_precios where id = '${L}') listas) t`));
    await caso('Listas 21e: un cliente del portal sí lee la lista que tiene asignada', (r) => r?.precios === 1,
      como({ uid: cliUser, previo: crear(empCliUser) + precio + `update clientes set lista_precios_id = '${L}' where id = '${cliDeUser}';` },
        `select row_to_json(t)::text from (select count(*) precios from precios_lista where lista_precios_id = '${L}') t`));
  }
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
