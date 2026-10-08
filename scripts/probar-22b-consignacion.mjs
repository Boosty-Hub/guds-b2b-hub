/**
 * Pruebas de la fase 22b: la venta en consignación aprobada crea un PEDIDO que va a Odoo desde el almacén de consignación
 * (sin factura interna ni descuento de stock en GUDS). Cada caso corre en un bloque que SIEMPRE termina en excepción: la base
 * deshace todo (declaraciones, pedidos, avisos, contadores y la llamada de pg_net, que nunca sale). No deja rastro.
 *
 * La última parte simula el envío a Odoo (enviar.js con aplicar = false, solo LECTURA en Odoo) con el pedido que crea la
 * aprobación, para ver el payload: warehouse_id = almacén de consignación del cliente. Necesita salir a Odoo (.env.local).
 *
 *   node scripts/probar-22b-consignacion.mjs            → casos SQL + simulación del payload
 *   node scripts/probar-22b-consignacion.mjs --sin-odoo → solo los casos SQL
 *   node scripts/probar-22b-consignacion.mjs --quirutec → con un almacén de consignación de Quirutec (por defecto, GUDS)
 */
import { sql } from './lib/supabase-admin.mjs';

const sinOdoo = process.argv.includes('--sin-odoo');
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const [empGuds, empQrt] = await sql(`select id, nombre_corto, odoo_company_id from empresas order by orden`);
const guds = process.argv.includes('--quirutec') ? empQrt : empGuds;   // empresa de la prueba
const admin = (await sql(`select id, auth_id from usuarios where role = 'admin' and auth_id is not null and coalesce(activo, true) order by created_at limit 1`))[0];

// Almacén de consignación real de la empresa (cliente enlazado a Odoo) con al menos 2 productos con existencia libre y precio
const [alm] = await sql(`select a.id, a.nombre, a.odoo_id, a.cliente_id, c.vendedor_asignado_id,
    (select u.auth_id from usuarios u where u.id = c.vendedor_asignado_id) vendedor_auth
  from almacenes a join clientes c on c.id = a.cliente_id
  where a.tipo = 'consignacion' and a.activo and a.odoo_id is not null and a.empresa_id = '${guds.id}' and c.odoo_id is not null
    and (select count(*) from inventario_almacen ia join productos p on p.id = ia.producto_id
         where ia.almacen_id = a.id and p.odoo_id is not null and ia.cantidad - ia.reservado >= 5
           and public.precio_efectivo(p.id, null, a.cliente_id) > 0) >= 2
  order by (select count(*) from inventario_almacen ia where ia.almacen_id = a.id) desc limit 1`);
if (!alm) { console.error(`No hay un almacén de consignación de ${guds.nombre_corto} con existencia para probar`); process.exit(1); }
const prods = await sql(`select ia.producto_id id, p.nombre, ia.cantidad, ia.reservado, p.comprometido_guds
  from inventario_almacen ia join productos p on p.id = ia.producto_id
  where ia.almacen_id = '${alm.id}' and p.odoo_id is not null and ia.cantidad - ia.reservado >= 5
    and public.precio_efectivo(p.id, null, '${alm.cliente_id}') > 0
  order by ia.cantidad desc limit 2`);
const [pA, pB] = prods;
const libreA = Number(pA.cantidad) - Number(pA.reservado);
console.log(`${guds.nombre_corto} · almacén: ${alm.nombre} (Odoo ${alm.odoo_id}) · productos: ${pA.nombre} (${libreA} libres), ${pB.nombre}`);

const claims = (uid) => JSON.stringify({ sub: uid, role: 'authenticated' });
const hdr = (e) => JSON.stringify({ 'x-empresa-id': e });
const items = (lista) => `${lit(JSON.stringify(lista))}::jsonb`;
const DECLARAR = (lista, notas = 'Prueba 22b') => `perform set_config('prueba.decl',
  public.declarar_venta_consignacion('${alm.id}', ${items(lista)}, ${lit(notas)})::text, true);`;
const APROBAR = `perform set_config('prueba.rev', public.revisar_declaracion_consignacion(current_setting('prueba.decl')::uuid, true, null)::text, true);`;
const DECL = `current_setting('prueba.decl')::uuid`;
const ORDEN = `(select orden_id from declaraciones_consignacion where id = ${DECL})`;

// Bloque: `antes` como postgres, `pasos` como el usuario (rol authenticated + claims + empresa), `cuerpo` (una fila de texto)
// otra vez como postgres para leer sin RLS. Siempre termina en excepción → rollback. La pausa de seguridad de 22b
// (configuracion.odoo_envio_consignacion) se activa dentro del bloque salvo con `pausa: true`.
async function bloque({ uid = admin.auth_id, empresa = guds.id, antes = '', pasos = '', cuerpo, pausa = false }) {
  const q = `do $bloque$
    declare v text;
    begin
      ${pausa ? '' : `update configuracion set valor = 'activo' where clave = 'odoo_envio_consignacion';`}
      ${antes}
      perform set_config('request.jwt.claims', ${lit(claims(uid))}, true);
      perform set_config('request.headers', ${lit(hdr(empresa))}, true);
      execute 'set local role authenticated';
      ${pasos}
      execute 'reset role';
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
const fila = (q) => `select row_to_json(t)::text from (${q}) t`;

const casos = [];
async function caso(nombre, verificar, promesa) {
  const r = await promesa;
  const texto = r.error ? `ERROR: ${r.error}` : r.ok;
  let ok = false;
  try { ok = typeof verificar === 'function' ? verificar(r.ok ? JSON.parse(r.ok) : null, r.error) : texto.includes(verificar); } catch { ok = false; }
  casos.push({ ok: ok ? '✓' : '✗', caso: nombre, resultado: texto.slice(0, 110) });
  return r;
}

const dos = [{ producto_id: pA.id, cantidad: 2 }, { producto_id: pB.id, cantidad: 1 }];

// ── Aprobación ──
await caso('Aprobar crea un pedido aprobado, enlazado, con el almacén de consignación y los ítems declarados',
  (r) => r.aprobacion === 'aprobada' && r.aprobado_por === admin.id && r.almacen_id === alm.id && r.estado === 'pendiente'
    && r.metodo_pago === 'credito' && r.empresa_id === guds.id && /^[A-Z]+-ORD-\d+$/.test(r.numero) && r.items === 2 && r.unidades === 3
    && r.decl_estado === 'aprobado' && r.decl_factura === null && Math.abs(r.total - r.decl_total) < 0.02 && r.odoo_id === null,
  bloque({ pasos: DECLARAR(dos) + APROBAR, cuerpo: fila(`select o.numero, o.aprobacion, o.aprobado_por, o.almacen_id, o.estado::text, o.metodo_pago::text,
      o.empresa_id, o.odoo_id, o.total::float, d.total::float decl_total, d.estado decl_estado, d.factura_id decl_factura,
      (select count(*) from orden_items i where i.orden_id = o.id) items, (select sum(cantidad) from orden_items i where i.orden_id = o.id) unidades
    from declaraciones_consignacion d join ordenes o on o.id = d.orden_id where d.id = ${DECL}`) }));

await caso('Aprobar NO crea factura interna',
  (r) => r.facturas === 0,
  bloque({ pasos: DECLARAR(dos) + APROBAR, cuerpo: fila(`select count(*) facturas from facturas
    where created_at >= now() and (referencia = (select numero from declaraciones_consignacion where id = ${DECL}) or creada_en_guds)`) }));

await caso('Aprobar NO descuenta el inventario del almacén (lo baja Odoo al validar la entrega)',
  (r) => Number(r.a) === Number(pA.cantidad) && Number(r.b) === Number(prods[1].cantidad),
  bloque({ pasos: DECLARAR(dos) + APROBAR, cuerpo: fila(`select
    (select cantidad from inventario_almacen where almacen_id = '${alm.id}' and producto_id = '${pA.id}') a,
    (select cantidad from inventario_almacen where almacen_id = '${alm.id}' and producto_id = '${pB.id}') b`) }));

await caso('Aprobar dispara el envío a Odoo (pg_net → sync-odoo?enviar=<pedido>; en rollback no sale)',
  (r) => r.n === 1,
  bloque({ pasos: DECLARAR(dos) + APROBAR, cuerpo: fila(`select count(*) n from net.http_request_queue
    where url like '%sync-odoo?enviar=' || ${ORDEN}::text`) }));

await caso('El pedido de consignación no compromete el stock de los almacenes propios (comprometido_guds)',
  (r) => Number(r.a) === Number(pA.comprometido_guds) && Number(r.b) === Number(prods[1].comprometido_guds),
  bloque({ pasos: DECLARAR(dos) + APROBAR, cuerpo: fila(`select
    (select comprometido_guds from productos where id = '${pA.id}') a, (select comprometido_guds from productos where id = '${pB.id}') b`) }));

await caso('Avisos: el admin recibe "Pedido de consignación" y no el "Nueva orden" genérico; línea de tiempo con "creado"',
  (r) => r.consig > 0 && r.generico === 0 && r.eventos >= 1,
  bloque({ pasos: DECLARAR(dos) + APROBAR, cuerpo: fila(`select
    (select count(*) from notificaciones where titulo = 'Pedido de consignación ' || o.numero) consig,
    (select count(*) from notificaciones where titulo in ('Nueva orden ' || o.numero, 'Pedido recibido') and created_at >= now()) generico,
    (select count(*) from orden_eventos e where e.orden_id = o.id and e.tipo = 'creado') eventos
    from ordenes o where o.id = ${ORDEN}`) }));

await caso('La respuesta de la aprobación trae el pedido y el mensaje de envío a Odoo',
  (r) => r.estado === 'aprobado' && /-ORD-/.test(r.numero) && /Odoo/.test(r.mensaje),
  bloque({ pasos: DECLARAR(dos) + APROBAR, cuerpo: `select current_setting('prueba.rev')` }));

// ── Stock comprometido de consignación ──
await caso('Lo declarado (pendiente o aprobado sin confirmar en Odoo) baja lo disponible para declarar',
  (r) => Number(r.comprometido) === 2 && Number(r.disponible) === libreA - 2,
  bloque({ pasos: DECLARAR(dos) + APROBAR + `perform set_config('prueba.disp', (${fila(`select comprometido, disponible from public.consignacion_disponible('${alm.id}') where producto_id = '${pA.id}'`)}), true);`,
    cuerpo: `select current_setting('prueba.disp')` }));

await caso('No se puede declarar más de lo disponible (descontando lo ya declarado)',
  'Stock insuficiente',
  bloque({ pasos: DECLARAR(dos) + `perform public.declarar_venta_consignacion('${alm.id}', ${items([{ producto_id: pA.id, cantidad: libreA - 1 }])}, 'segunda');`,
    cuerpo: `select 'no debió pasar'` }));

await caso('Un producto repetido en la lista se suma y se valida el total',
  'Stock insuficiente',
  bloque({ pasos: `perform public.declarar_venta_consignacion('${alm.id}', ${items([{ producto_id: pA.id, cantidad: libreA }, { producto_id: pA.id, cantidad: 1 }])}, 'repetido');`,
    cuerpo: `select 'no debió pasar'` }));

await caso('Confirmado en Odoo (reserva allí): la declaración deja de contar como comprometida en GUDS',
  (r) => Number(r.comprometido) === 0,
  bloque({ pasos: DECLARAR(dos) + APROBAR + `execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      update ordenes set odoo_id = 999992201, estado_odoo = 'sale', estado = 'confirmado' where id = ${ORDEN};`,
    cuerpo: fila(`select coalesce((select cantidad from public.consignacion_comprometido('${alm.id}') where producto_id = '${pA.id}'), 0) comprometido`) }));

await caso('Las cantidades se declaran en unidades enteras',
  'unidades enteras',
  bloque({ pasos: `perform public.declarar_venta_consignacion('${alm.id}', ${items([{ producto_id: pA.id, cantidad: 1.5 }])}, null);`, cuerpo: `select 'no'` }));

// ── 22e: sin precio no se declara ni se aprueba; almacén sin cliente ──
// Producto de la empresa, en Odoo, sin precio para el cliente: dentro del bloque se le da existencia en el almacén (se deshace)
const [pZ] = await sql(`select p.id, p.nombre from productos p where p.empresa_id = '${guds.id}' and p.odoo_id is not null
  and coalesce(public.precio_efectivo(p.id, null, '${alm.cliente_id}'), 0) <= 0 order by p.nombre limit 1`);
if (pZ) {
  const conZ = `insert into inventario_almacen (almacen_id, producto_id, cantidad, reservado, empresa_id)
    values ('${alm.id}', '${pZ.id}', 10, 0, '${guds.id}') on conflict (almacen_id, producto_id) do update set cantidad = 10, reservado = 0;`;
  await caso('22e: consignacion_disponible trae el precio para el cliente (0 si no tiene)',
    (r) => Number(r.a) > 0 && Number(r.z) === 0,
    bloque({ antes: conZ, pasos: `perform set_config('prueba.disp', (${fila(`select
        (select precio from public.consignacion_disponible('${alm.id}') where producto_id = '${pA.id}') a,
        (select precio from public.consignacion_disponible('${alm.id}') where producto_id = '${pZ.id}') z`)}), true);`,
      cuerpo: `select current_setting('prueba.disp')` }));
  await caso('22e: no se declara un producto sin precio (la respuesta lo nombra)',
    (r, e) => /Sin precio para este cliente/.test(e || '') && (e || '').includes(pZ.nombre.slice(0, 20)) && !(e || '').includes(pA.nombre.slice(0, 20)),
    bloque({ antes: conZ, pasos: DECLARAR([{ producto_id: pA.id, cantidad: 1 }, { producto_id: pZ.id, cantidad: 1 }]), cuerpo: `select 'no'` }));
} else {
  casos.push({ ok: '✗', caso: '22e: hay un producto sin precio para probar el bloqueo', resultado: 'no se encontró' });
}
await caso('22e: no se aprueba una declaración con una línea sin precio',
  (r, e) => /No se puede aprobar: hay productos sin precio/.test(e || '') && (e || '').includes(pB.nombre.slice(0, 20)),
  bloque({ pasos: DECLARAR(dos) + `execute 'reset role';
      update declaracion_consignacion_items set precio_unitario = 0, subtotal = 0 where declaracion_id = ${DECL} and producto_id = '${pB.id}';
      execute 'set local role authenticated';` + APROBAR, cuerpo: `select 'no'` }));
await caso('22e: no se declara en un almacén sin cliente asignado',
  'no tiene un cliente asignado',
  bloque({ antes: `update almacenes set cliente_id = null where id = '${alm.id}';`, pasos: DECLARAR(dos), cuerpo: `select 'no'` }));

await caso('Pausa de seguridad (hasta desplegar sync-odoo): aprobar responde con el aviso y no crea pedido',
  'en pausa',
  bloque({ pausa: true, antes: `update configuracion set valor = 'pausado' where clave = 'odoo_envio_consignacion';`,
    pasos: DECLARAR(dos) + APROBAR, cuerpo: `select 'no'` }));

await caso('Con la pausa, rechazar sigue funcionando',
  (r) => r.estado === 'rechazado',
  bloque({ pausa: true, antes: `update configuracion set valor = 'pausado' where clave = 'odoo_envio_consignacion';`,
    pasos: DECLARAR(dos) + `perform public.revisar_declaracion_consignacion(${DECL}, false, 'no');`,
    cuerpo: fila(`select estado from declaraciones_consignacion where id = ${DECL}`) }));

// ── Rechazo y permisos ──
await caso('Rechazar no crea pedido',
  (r) => r.estado === 'rechazado' && r.orden_id === null && r.pedidos === 0,
  bloque({ pasos: DECLARAR(dos) + `perform public.revisar_declaracion_consignacion(${DECL}, false, 'no');`,
    cuerpo: fila(`select d.estado, d.orden_id, (select count(*) from ordenes where almacen_id = '${alm.id}' and created_at >= now()) pedidos
      from declaraciones_consignacion d where d.id = ${DECL}`) }));

if (alm.vendedor_auth) {
  await caso('Un vendedor no puede aprobar declaraciones',
    'Solo un administrador',
    bloque({ antes: `perform set_config('request.jwt.claims', ${lit(claims(admin.auth_id))}, true); perform set_config('request.headers', ${lit(hdr(guds.id))}, true);
        ${DECLARAR(dos)}`,
      uid: alm.vendedor_auth, pasos: `perform public.revisar_declaracion_consignacion(${DECL}, true, null);`, cuerpo: `select 'no'` }));
}

await caso('consignacion_comprometido es interna (no se llama desde la API)',
  'permission denied',
  bloque({ pasos: `perform * from public.consignacion_comprometido('${alm.id}');`, cuerpo: `select 'no'` }));

await caso('La API no cambia el estado de una declaración por fuera de Aprobar/Rechazar',
  'se aprueban o rechazan desde Consignación',
  bloque({ pasos: DECLARAR(dos) + `update declaraciones_consignacion set estado = 'aprobado' where id = ${DECL};`, cuerpo: `select 'no'` }));

await caso('facturar_orden no factura internamente un pedido de consignación',
  'venta en consignación',
  bloque({ pasos: DECLARAR(dos) + APROBAR + `perform public.facturar_orden(${ORDEN});`, cuerpo: `select 'no'` }));

await caso('En "Ambas empresas" no se aprueba (solo consulta)',
  (r, e) => /Modo consulta|Selecciona una empresa/.test(e || ''),
  bloque({ antes: `perform set_config('request.jwt.claims', ${lit(claims(admin.auth_id))}, true); perform set_config('request.headers', ${lit(hdr(guds.id))}, true);
      ${DECLARAR(dos)}`,
    empresa: 'todas', pasos: `perform public.revisar_declaracion_consignacion(${DECL}, true, null);`, cuerpo: `select 'no'` }));

await caso('Un pedido creado por la API de alguien que no es administración no puede fijar el almacén de salida',
  (r) => r.almacen_id === null,
  bloque({ uid: alm.vendedor_auth ?? admin.auth_id, pasos: `execute 'reset role';
      insert into ordenes (id, cliente_id, subtotal, total, estado, almacen_id, empresa_id)
      values ('00000000-0000-0000-0000-000000022b01', '${alm.cliente_id}', 0, 0, 'pendiente', '${alm.id}', '${guds.id}');`,
    cuerpo: fila(`select almacen_id from ordenes where id = '00000000-0000-0000-0000-000000022b01'`) }));

await caso('Portal: consignacion_disponible rechaza a quien no tiene acceso al almacén',
  'No tienes acceso',
  bloque({ uid: (await sql(`select u.auth_id from usuarios u where u.role = 'vendedor' and u.auth_id is not null and coalesce(u.activo, true)
      and exists (select 1 from usuario_empresas ue where ue.usuario_id = u.id and ue.empresa_id = '${guds.id}')
      and u.id is distinct from ${alm.vendedor_asignado_id ? lit(alm.vendedor_asignado_id) : 'null'}
      and not exists (select 1 from clientes c where c.id = '${alm.cliente_id}' and c.vendedor_asignado_id = u.id) limit 1`))[0].auth_id,
    pasos: `perform * from public.consignacion_disponible('${alm.id}');`, cuerpo: `select 'no'` }));

// ── Simulación del envío a Odoo (solo lectura en Odoo) con el pedido que crea la aprobación ──
let payload = null;
if (!sinOdoo) {
  const enviarSrc = (await import('node:fs')).readFileSync(new URL('../supabase/functions/_shared/odoo-sync/enviar.js', import.meta.url), 'utf8');
  // Las dos consultas de enviar.js (pedido e ítems), tal cual, sobre el pedido recién creado en el bloque
  const consultas = [...enviarSrc.matchAll(/await sql\(`([\s\S]*?)`\)/g)].slice(0, 2).map((m) => m[1]);
  const qOrden = consultas[0].replace('${lit(ordenId)}', ORDEN);
  const qItems = consultas[1].replace('${lit(o.id)}', ORDEN);
  const r = await bloque({ pasos: DECLARAR(dos, 'Prueba de simulación 22b') + APROBAR,
    cuerpo: `select jsonb_build_object('orden', (select to_jsonb(t) from (${qOrden}) t), 'items', (select jsonb_agg(to_jsonb(t)) from (${qItems}) t))::text` });
  if (r.error) {
    casos.push({ ok: '✗', caso: 'Simulación: leer el pedido creado', resultado: r.error.slice(0, 110) });
  } else {
    const filas = JSON.parse(r.ok);
    const { requerir } = await import('./lib/entorno.mjs');
    const { crearClienteOdoo } = await import('../supabase/functions/_shared/odoo-sync/odoo.js');
    const { enviarPedido } = await import('../supabase/functions/_shared/odoo-sync/enviar.js');
    const { ODOO_URL, ODOO_DB, ODOO_USER, ODOO_API_KEY } = requerir('ODOO_URL', 'ODOO_DB', 'ODOO_USER', 'ODOO_API_KEY');
    const odoo = crearClienteOdoo({ url: ODOO_URL, db: ODOO_DB, usuario: ODOO_USER, apiKey: ODOO_API_KEY });
    // Odoo solo para leer: crear/escribir/acción/nota quedan bloqueados en la simulación
    for (const k of ['crear', 'escribir', 'accion', 'nota']) if (odoo[k]) odoo[k] = async () => { throw new Error(`Bloqueado en la prueba: ${k}`); };
    const mock = (filasOrden) => { let n = 0; return async () => (n++ === 0 ? [filasOrden] : filas.items); };
    try {
      payload = await enviarPedido({ odoo, sql: mock(filas.orden), ordenId: filas.orden.id, aplicar: false, log: () => {} });
      casos.push({ ok: payload.vals.warehouse_id === alm.odoo_id && payload.consignacion && payload.vals.order_line.length === 2
          && /consignación/i.test(payload.vals.note) && payload.vals.partner_id > 0 ? '✓' : '✗',
        caso: 'Simulación: la cotización sale del almacén de consignación del cliente', resultado: `warehouse_id ${payload.vals.warehouse_id} (${payload.almacen})` });
      const general = await enviarPedido({ odoo, sql: mock({ ...filas.orden, almacen_id: null, almacen_odoo_id: null, declaracion: null }), ordenId: filas.orden.id, aplicar: false, log: () => {} });
      casos.push({ ok: general.vals.warehouse_id !== alm.odoo_id && /ALMACEN GENERAL/.test(general.almacen) ? '✓' : '✗',
        caso: 'Simulación: un pedido normal sigue saliendo del almacén general (P-01)', resultado: `warehouse_id ${general.vals.warehouse_id} (${general.almacen})` });
      let n = 0;
      const sqlCero = async () => (n++ === 0 ? [filas.orden] : filas.items.map((i, k) => (k === 0 ? { ...i, precio_unitario: 0 } : i)));
      const cero = await enviarPedido({ odoo, sql: sqlCero, ordenId: filas.orden.id, aplicar: false, log: () => {} });
      casos.push({ ok: /Sin precio en GUDS/.test(cero.aviso || '') && cero.vals.order_line[0][2].price_unit === 0 ? '✓' : '✗',
        caso: 'Simulación: una línea sin precio en GUDS va con aviso para revisarla en Odoo', resultado: String(cero.aviso).slice(0, 110) });
    } catch (e) {
      casos.push({ ok: '✗', caso: 'Simulación del envío a Odoo', resultado: String(e.message).slice(0, 110) });
    }
  }
}

console.table(casos);
if (payload) {
  console.log('\nPayload que iría a Odoo (sale.order.create, simulación):');
  console.log(JSON.stringify({ almacen: payload.almacen, consignacion: payload.consignacion, aviso: payload.aviso, vals: payload.vals }, null, 2));
}
const fallas = casos.filter((c) => c.ok === '✗').length;
console.log(fallas ? `✗ ${fallas} caso(s) fallaron` : `✓ Los ${casos.length} casos pasaron`);
process.exit(fallas ? 1 : 0);
