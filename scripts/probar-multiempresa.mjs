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
  como({ empresa: qrt.id }, `select row_to_json(t)::text from (select public.generar_numero_orden() numero) t`));
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

if (vendGuds) {
  await caso('Tesorería: un vendedor (sin módulo bancos) no ve extractos', (r) => r.n === 0, como({ uid: vendGuds, empresa: guds.id }, cuenta('extracto_odoo_lineas')));
  await caso('Seguridad: un vendedor no edita almacenes ni su cliente', (r, err) => r === null || /row-level|permission/.test(err || ''),
    como({ uid: vendGuds, empresa: guds.id }, upd('almacenes', `cliente_id = null`, almConsig)));
  await caso('Seguridad: un vendedor no registra movimientos bancarios', 'row-level security',
    como({ uid: vendGuds, empresa: guds.id }, `with x as (insert into movimientos_bancarios (banco_id, tipo, monto) select id, 'entrada', 1 from bancos where empresa_id = '${guds.id}' limit 1 returning id) select row_to_json(x)::text from x`));
  await caso('Seguridad: un vendedor no cambia existencias', (r, err) => r === null || /row-level|permission/.test(err || ''),
    como({ uid: vendGuds, empresa: guds.id }, `with x as (update inventario_almacen set cantidad = 0 where empresa_id = '${guds.id}' returning id) select row_to_json(x)::text from (select * from x limit 1) x`));
}
if (cliUser) {
  await caso('Seguridad: un cliente del portal no edita almacenes', (r, err) => r === null || /row-level|permission/.test(err || ''),
    como({ uid: cliUser, empresa: guds.id }, upd('almacenes', `cliente_id = null`, almConsig)));
  await caso('Seguridad: un cliente del portal no registra movimientos bancarios', 'row-level security',
    como({ uid: cliUser, empresa: guds.id }, `with x as (insert into movimientos_bancarios (banco_id, tipo, monto) select id, 'entrada', 1 from bancos where empresa_id = '${guds.id}' limit 1 returning id) select row_to_json(x)::text from x`));
}

// ── Fase 8: crédito, stock comprometido, clientes en ambas empresas y acceso de contactos ──
const cliSinLimite = (await sql(`select id from clientes where empresa_id = '${guds.id}' and coalesce(limite_credito, 0) = 0 limit 1`))[0].id;
const cred = (sql1) => `select row_to_json(t)::text from (select 'ok' r from (select public.validar_credito('${cliSinLimite}', 100)) x) t`;
await caso('Crédito: en modo abierto se compra a crédito aunque el límite sea 0', (r, err) => r?.r === 'ok' && !err, como(E, cred()));
await caso('Crédito: en modo límite, sin límite aprobado no se compra a crédito', 'no tiene crédito aprobado',
  como({ empresa: guds.id, previo: `update configuracion set valor = 'limite' where clave = 'credito_modo';` }, cred()));
const agotado = (await sql(`select id from productos where empresa_id = '${guds.id}' and controla_stock and stock_disponible = 0 and comprometido_odoo > 0 limit 1`))[0]?.id;
const conStock = (await sql(`select id, comprometido_guds from productos where empresa_id = '${guds.id}' and controla_stock and stock_disponible > 100 and activo limit 1`))[0];
if (agotado) {
  await caso('Stock: no se pide sobre lo comprometido (disponible 0)', 'Stock insuficiente',
    como(E, `select row_to_json(t)::text from (select public.validar_stock_pedido('[{"producto_id":"${agotado}","cantidad":1}]'::jsonb)) t`));
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
  const previoGemelo = `insert into usuarios (auth_id, email, nombre, role, cliente_id, activo) values ('${qaCliente}', 'qa.cliente@guds.test', 'QA', 'cliente', '${gemelo.g_id}', true);`;
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
  const suma = async (emp) => Number((await sql(`select coalesce(round(sum(case when total<>0 then subtotal*total_usd/total end),2),0) n from facturas
    where estado='posted' and tipo in ('factura','nota_credito') and not es_saldo_inicial and not coalesce(es_nota_debito,false)
      and fecha_emision between '2026-08-01' and '2026-08-31' and empresa_id = '${emp}'`))[0].n);
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
