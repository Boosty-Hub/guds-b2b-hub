/**
 * Pruebas de la clasificación de clientes de finanzas → Odoo (22d).
 *   · Base: cada caso corre como un usuario (claims + header de empresa) dentro de un bloque que SIEMPRE termina en excepción:
 *     la base deshace todo (incluido el disparo a la función edge por pg_net). No deja rastro.
 *   · odoo.js: las guardas nuevas, con un cliente que no se conecta a nada.
 *   · Escritor en modo prueba (aplicar = false) contra Odoo real en SOLO LECTURA: el cliente de Odoo que recibe solo deja
 *     leer (crear/escribir/notas lanzan). Muestra el payload que mandaría para 3 clientes de cada empresa.
 *
 *   node scripts/probar-22d-clasificacion.mjs            (todo)
 *   node scripts/probar-22d-clasificacion.mjs --sin-odoo (sin leer Odoo)
 */
import { sql } from './lib/supabase-admin.mjs';
import { requerir } from './lib/entorno.mjs';
import { crearClienteOdoo } from '../supabase/functions/_shared/odoo-sync/odoo.js';
import { escribirClasificacion, resolverCatalogo } from '../supabase/functions/_shared/odoo-sync/escribir-clasificacion.js';

const SIN_ODOO = process.argv.includes('--sin-odoo');
const [guds, qrt] = await sql(`select id, nombre_corto from empresas order by orden`);
const admin = (await sql(`select auth_id from usuarios where role = 'admin' and auth_id is not null and activo order by created_at limit 1`))[0].auth_id;
const vendedor = (await sql(`select u.auth_id from usuarios u where u.role = 'vendedor' and u.auth_id is not null and u.activo limit 1`))[0]?.auth_id;
// Auth sin perfil en usuarios: dentro del bloque se le crea un perfil de Contador (se deshace con todo lo demás)
const authLibre = (await sql(`select a.id from auth.users a where not exists (select 1 from usuarios u where u.auth_id = a.id) order by a.created_at limit 1`))[0]?.id;
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

async function como({ uid = admin, empresa = guds.id, previo = '' }, cuerpo) {
  const claims = JSON.stringify({ sub: uid, role: 'authenticated' });
  const headers = JSON.stringify(empresa ? { 'x-empresa-id': empresa } : {});
  const q = `do $bloque$
    declare v text;
    begin
      ${previo}
      perform set_config('request.jwt.claims', ${lit(claims)}, true);
      perform set_config('request.headers', ${lit(headers)}, true);
      execute 'set local role authenticated';
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
const j = (q) => `select row_to_json(t)::text from (${q}) t`;
// Varios pasos como el usuario (cada sentencia ve lo que hizo la anterior): función temporal de la sesión, sin privilegios propios
const pasos = (empresa, cuerpo, previo = '') => como({ empresa, previo: `${previo}
  create function pg_temp.p22d() returns text language plpgsql as $f$ declare v jsonb; n int; begin ${cuerpo} end $f$;` }, `select pg_temp.p22d()`);

// Datos de prueba reales (no se modifican fuera de los bloques)
const tipo = async (emp, nombre) => (await sql(`select id from clasificacion_tipos where empresa_id = '${emp}' and public.clasif_norm(tipo) = public.clasif_norm(${lit(nombre)})`))[0]?.id;
const tPartG = await tipo(guds.id, 'Particular');
const tPartQ = await tipo(qrt.id, 'Particular');
const tCines = await tipo(guds.id, 'Cines');
const propG = (await sql(`select cc.cliente_id from clasificacion_clientes cc join clientes c on c.id = cc.cliente_id
  where cc.empresa_id = '${guds.id}' and cc.estado = 'propuesta' and cc.tipo_id is not null and c.odoo_id is not null
    and not exists (select 1 from clasificacion_tipos t where t.id = cc.tipo_id and t.por_confirmar) order by c.nombre_negocio limit 30`)).map((x) => x.cliente_id);
// Un tipo de GUDS distinto del que propone el Excel para propG[0] (para probar la asignación manual)
const tOtroG = (await sql(`select t.id from clasificacion_tipos t where t.empresa_id = '${guds.id}' and t.activo and not t.por_confirmar
  and t.id is distinct from (select tipo_id from clasificacion_clientes where cliente_id = '${propG[0]}') order by t.orden limit 1`))[0].id;
const cliCines = (await sql(`select cliente_id from clasificacion_clientes where tipo_id = '${tCines}' limit 1`))[0]?.cliente_id;
const cliQ = (await sql(`select id from clientes where empresa_id = '${qrt.id}' and odoo_id is not null limit 1`))[0].id;
const arr = (ids) => `array[${ids.map(lit).join(',')}]::uuid[]`;

// ── 1. Estructura ──
await caso('Cola: odoo_escrituras acepta el tipo clasificacion (y conserva los anteriores)', (r) => r.ok,
  como({}, j(`select pg_get_constraintdef(oid) ~ 'clasificacion' and pg_get_constraintdef(oid) ~ 'cliente_limite' and pg_get_constraintdef(oid) ~ 'producto' ok
    from pg_constraint where conrelid = 'public.odoo_escrituras'::regclass and conname = 'odoo_escrituras_tipo_check'`)));
// Arrancó en "simular"; el 8-oct (22e) el dueño autorizó la primera escritura real y quedó en "activo"
const modoClasif = (await sql(`select valor from configuracion where clave = 'odoo_escritura_clasificacion'`))[0]?.valor;
casos.push({ ok: ['simular', 'activo'].includes(modoClasif) ? '✓' : '✗',
  caso: 'Modo de escritura de la clasificación: "simular" (prueba) o "activo" (autorizado el 8-oct)', resultado: modoClasif });
await caso('Catálogo sembrado: 18 tipos en GUDS (2 por confirmar) y 12 en Quirutec', (r) => r.g === 18 && r.q === 12 && r.pc === 2,
  como({ empresa: 'todas' }, j(`select count(*) filter (where empresa_id = '${guds.id}') g, count(*) filter (where empresa_id = '${qrt.id}') q,
    count(*) filter (where por_confirmar) pc from clasificacion_tipos`)));

// ── 2. Lectura por empresa y permisos ──
await caso('Lista en GUDS: solo clientes de GUDS', (r) => r.n > 200 && r.otras === 0,
  como({ empresa: guds.id }, j(`select count(*) n, count(*) filter (where empresa_id <> '${guds.id}') otras from public.clasificacion_clientes_lista()`)));
await caso('Lista en Quirutec: solo clientes de Quirutec', (r) => r.n > 200 && r.otras === 0,
  como({ empresa: qrt.id }, j(`select count(*) n, count(*) filter (where empresa_id <> '${qrt.id}') otras from public.clasificacion_clientes_lista()`)));
await caso('Lista en «Ambas»: las dos empresas', (r) => r.empresas === 2,
  como({ empresa: 'todas' }, j(`select count(distinct empresa_id) empresas from public.clasificacion_clientes_lista()`)));
await caso('RLS: en GUDS no se leen tipos ni clasificaciones de Quirutec', (r) => r.tipos === 0 && r.clasif === 0,
  como({ empresa: guds.id }, j(`select (select count(*) from clasificacion_tipos where empresa_id = '${qrt.id}') tipos, (select count(*) from clasificacion_clientes where empresa_id = '${qrt.id}') clasif`)));
if (vendedor) {
  await caso('Un vendedor no ve la lista de clasificación', 'No tienes permiso', como({ uid: vendedor }, j(`select count(*) n from public.clasificacion_clientes_lista()`)));
  await caso('Un vendedor no puede asignar', 'No tienes permiso', como({ uid: vendedor }, j(`select public.asignar_clasificacion(${arr([propG[0]])}, '${tPartG}') n`)));
}
if (authLibre) {
  const contador = `insert into public.usuarios (auth_id, email, nombre, role, rol_id, activo) values ('${authLibre}', 'contador.22d@prueba.test', 'Contador 22d', 'admin', (select id from roles where nombre = 'Contador'), true);
    insert into public.usuario_empresas (usuario_id, empresa_id, por_defecto) select (select id from usuarios where auth_id = '${authLibre}'), id, odoo_company_id = 1 from empresas;`;
  await caso('El Contador ve la lista y puede asignar (módulo clasificacion_clientes)', (r) => r.n > 0 && r.asignados === 1,
    como({ uid: authLibre, previo: contador }, j(`select (select count(*) from public.clasificacion_clientes_lista()) n, public.asignar_clasificacion(${arr([propG[0]])}, '${tPartG}') asignados`)));
}
await caso('Sin escritura directa: authenticated no inserta en clasificacion_clientes', 'permission denied',
  como({}, `insert into clasificacion_clientes (cliente_id, empresa_id) values ('${propG[0]}', '${guds.id}') on conflict do nothing returning cliente_id::text`));
await caso('Espejo: clientes.tipo_cliente no se edita desde GUDS (se escribe en Odoo)', 'viene de Odoo',
  como({}, `update clientes set tipo_cliente = 'X' where id = '${propG[0]}' returning id::text`));

// ── 3. Acciones ──
await caso('En «Ambas» no se asigna (solo consulta)', 'solo se puede consultar',
  como({ empresa: 'todas' }, j(`select public.asignar_clasificacion(${arr([propG[0]])}, '${tPartG}') n`)));
await caso('No se asigna un tipo de Quirutec estando en GUDS', 'otra empresa',
  como({ empresa: guds.id }, j(`select public.asignar_clasificacion(${arr([propG[0]])}, '${tPartQ}') n`)));
await caso('No se asigna un cliente de Quirutec estando en GUDS', 'otra empresa',
  como({ empresa: guds.id }, j(`select public.asignar_clasificacion(${arr([cliQ])}, '${tPartG}') n`)));
await caso('Asignar a mano: queda "asignada", origen manual, revisada', (r) => r.estado === 'asignada' && r.origen === 'manual' && r.revisado,
  pasos(guds.id, `perform public.asignar_clasificacion(${arr([propG[0]])}, '${tOtroG}');
    return (select row_to_json(x)::text from (select estado, origen, revisado_at is not null revisado from public.clasificacion_clientes where cliente_id = '${propG[0]}') x);`));
await caso('Asignar el mismo tipo que proponía el Excel: queda "asignada" y conserva el origen', (r) => r.estado === 'asignada' && r.origen !== 'manual',
  pasos(guds.id, `perform public.asignar_clasificacion(${arr([propG[0]])}, (select tipo_id from public.clasificacion_clientes where cliente_id = '${propG[0]}'));
    return (select row_to_json(x)::text from (select estado, origen from public.clasificacion_clientes where cliente_id = '${propG[0]}') x);`));
await caso('Confirmar propuestas: pasan a "asignada" conservando el origen (Excel/Profit)', (r) => r.n === 3 && r.asignadas === 3 && r.manual === 0,
  pasos(guds.id, `n := public.confirmar_clasificacion(${arr(propG.slice(0, 3))});
    return (select row_to_json(x)::text from (select n, count(*) filter (where estado = 'asignada') asignadas, count(*) filter (where origen = 'manual') manual
      from public.clasificacion_clientes where cliente_id = any (${arr(propG.slice(0, 3))})) x);`));
await caso('Enviar sin confirmar: no encola (motivo sin_confirmar)', (r) => r.encolados === 0 && r.omitidos.sin_confirmar === 3,
  como({ empresa: guds.id }, j(`select (x ->> 'encolados')::int encolados, x -> 'omitidos' omitidos from (select public.enviar_clasificacion_odoo(${arr(propG.slice(0, 3))}) x) s`)));
await caso('Enviar confirmadas: 1 fila "clasificacion" en la cola, clientes "enviando", con el modo vigente (en el bloque no sale)', (r) => r.encolados === 3 && r.filas === 1 && r.enviando === 3 && r.modo === modoClasif,
  pasos(guds.id, `perform public.confirmar_clasificacion(${arr(propG.slice(0, 3))});
    v := public.enviar_clasificacion_odoo(${arr(propG.slice(0, 3))});
    return (select row_to_json(x)::text from (select (v ->> 'encolados')::int encolados, v ->> 'modo' modo,
      (select count(*) from public.odoo_escrituras where tipo = 'clasificacion' and referencia_id = (v ->> 'lote')::uuid and datos ->> 'accion' = 'clientes') filas,
      (select count(*) from public.clasificacion_clientes_lista() l where l.cliente_id = any (${arr(propG.slice(0, 3))}) and l.estado = 'enviando') enviando) x);`));
await caso('Enviar 30 clientes: se parte en filas de 25 (2 partes)', (r) => r.partes === 2 && r.filas === 2 && r.encolados === propG.length,
  pasos(guds.id, `perform public.confirmar_clasificacion(${arr(propG)});
    v := public.enviar_clasificacion_odoo(${arr(propG)});
    return (select row_to_json(x)::text from (select (v ->> 'partes')::int partes, (v ->> 'encolados')::int encolados,
      (select count(*) from public.odoo_escrituras where referencia_id = (v ->> 'lote')::uuid) filas) x);`));
await caso('Reenviar lo que está en curso: no duplica (motivo en_curso)', (r) => r.omitidos.en_curso === 3,
  pasos(guds.id, `perform public.confirmar_clasificacion(${arr(propG.slice(0, 3))});
    perform public.enviar_clasificacion_odoo(${arr(propG.slice(0, 3))});
    return (select public.enviar_clasificacion_odoo(${arr(propG.slice(0, 3))}))::text;`));
if (cliCines) {
  await caso('Tipo "por confirmar" (Cines): no se envía a Odoo', (r) => r.omitidos.tipo_por_confirmar === 1,
    pasos(guds.id, `perform public.confirmar_clasificacion(${arr([cliCines])});
      return (select public.enviar_clasificacion_odoo(${arr([cliCines])}))::text;`));
}
await caso('Catálogo: no se duplica un tipo (sin distinguir tildes/mayúsculas)', 'Ya existe',
  como({ empresa: guds.id }, j(`select public.guardar_clasificacion_tipo(null, 'PARTICULAR ', null, 'Otro', 'Resto') id`)));
await caso('Catálogo: tipo nuevo sin categoría exige "por confirmar"', 'Falta la categoría',
  como({ empresa: guds.id }, j(`select public.guardar_clasificacion_tipo(null, 'Tipo prueba 22d', null, null, null) id`)));
await caso('Catálogo: renombrar un tipo olvida su valor de Odoo (se busca o crea con el nombre nuevo)', (r) => r.ind === null && r.seg === 7,
  pasos(guds.id, `perform public.guardar_clasificacion_tipo('${tPartG}', 'Particular (persona)', 'Persona natural', 'Otro', 'Resto');
    return (select row_to_json(x)::text from (select odoo_industry_id ind, odoo_segment_id seg from public.clasificacion_tipos where id = '${tPartG}') x);`,
  `update public.clasificacion_tipos set odoo_industry_id = 31, odoo_segment_id = 7 where id = '${tPartG}';`));
await caso('Revisar catálogo en Odoo encola una fila de catálogo de la empresa activa', (r) => r.n === 1,
  pasos(qrt.id, `v := to_jsonb(public.preparar_catalogo_clasificacion_odoo());
    return (select row_to_json(x)::text from (select count(*) n from public.odoo_escrituras where id = (v #>> '{}')::uuid and datos ->> 'accion' = 'catalogo' and empresa_id = '${qrt.id}') x);`));
await caso('Revisar catálogo en «Ambas»: pide elegir empresa', 'solo se puede consultar',
  como({ empresa: 'todas' }, `select public.preparar_catalogo_clasificacion_odoo()::text`));

// RLS: políticas nuevas envuelven puede() en (select …)
{
  const pol = await sql(String.raw`select tablename || '.' || policyname p, coalesce(qual,'') || ' ' || coalesce(with_check,'') t from pg_policies
    where schemaname = 'public' and tablename in ('clasificacion_tipos', 'clasificacion_clientes')`);
  const malas = pol.filter((x) => /(?<!SELECT )(puede\('|auth\.uid\(|empresas_visibles\()/.test(x.t));
  casos.push({ ok: !malas.length && pol.length === 4 ? '✓' : '✗', caso: 'RLS 22d: puede()/empresas_visibles() evaluados una vez (select …)', resultado: malas.map((x) => x.p).join(', ') || `${pol.length} políticas` });
}

// ── 4. Guardas de odoo.js (sin conexión) ──
{
  const falso = crearClienteOdoo({ url: 'http://127.0.0.1:9', db: 'x', usuario: 'x', apiKey: 'x', timeoutMs: 500 });
  const rechaza = async (fn) => { try { await fn(); return 'NO RECHAZÓ'; } catch (e) { return e.message; } };
  const guardas = [
    ['quitar la industria de un cliente (industry_id = false)', () => falso.escribir('res.partner', [5], { industry_id: false }, 1), /id de un valor del catálogo/],
    ['un segmento que no es un id', () => falso.escribir('res.partner', [5], { eu_partner_segment_id: 'Resto' }, 1), /id de un valor del catálogo/],
    ['archivar un valor de Industria (write active)', () => falso.escribir('res.partner.industry', [30], { active: false }, 1), /no permitidos/],
    ['dejar sin nombre un canal', () => falso.escribir('eu.res.channel', [1], { name: ' ' }, 1), /no puede quedar vacío/],
    ['crear un segmento con otros campos', () => falso.crear('eu.res.segment', { name: 'Resto', active: false }, 1), /solo se crea un valor con su nombre/],
    ['crear en un modelo no permitido (res.partner.category)', () => falso.crear('res.partner.category', { name: 'X' }, 1), /no crea registros/],
  ];
  for (const [nombre, fn, re] of guardas) {
    const m = await rechaza(fn);
    casos.push({ ok: re.test(m) ? '✓' : '✗', caso: `odoo.js bloquea ${nombre}`, resultado: m.slice(0, 100) });
  }
  casos.push({ ok: typeof falso.unlink === 'undefined' ? '✓' : '✗', caso: 'odoo.js no tiene unlink', resultado: typeof falso.unlink });
}

// ── 5. Escritor en modo prueba contra Odoo (solo lectura) ──
const payloads = [];
if (!SIN_ODOO) {
  const { ODOO_URL, ODOO_DB, ODOO_USER, ODOO_API_KEY } = requerir('ODOO_URL', 'ODOO_DB', 'ODOO_USER', 'ODOO_API_KEY');
  const real = crearClienteOdoo({ url: ODOO_URL, db: ODOO_DB, usuario: ODOO_USER, apiKey: ODOO_API_KEY });
  const prohibido = (m) => async () => { throw new Error(`PRUEBA: ${m} no se permite en modo prueba`); };
  const soloLectura = {
    autenticar: real.autenticar, leer: real.leer, leerTodo: real.leerTodo,
    crear: prohibido('crear'), escribir: prohibido('escribir'), accion: prohibido('accion'), nota: prohibido('nota'),
    get empresas() { return real.empresas; }, get idioma() { return real.idioma; },
  };
  // En la prueba se toma la propuesta como si finanzas ya la hubiera confirmado (solo en memoria; la base no cambia)
  const sqlPrueba = async (q) => {
    const r = await sql(q);
    if (/from clientes c join empresas e on e\.id = c\.empresa_id/.test(q)) for (const x of r) if (x.tipo_id) x.estado = 'asignada';
    if (/^\s*(update|insert|delete)/i.test(q)) throw new Error('PRUEBA: el escritor no debe cambiar la base en modo prueba');
    return r;
  };
  for (const emp of [guds, qrt]) {
    // 3 clientes con actividad y tipos distintos, uno de ellos con un tipo que ya existe en Odoo (Particular / Distribuidor)
    const muestra = await sql(`
      with l as (
        select cc.cliente_id, t.tipo, row_number() over (partition by t.tipo order by c.nombre_negocio) rn,
          public.clasif_norm(t.tipo) in ('particular', 'distribuidor') existe
        from clasificacion_clientes cc join clasificacion_tipos t on t.id = cc.tipo_id join clientes c on c.id = cc.cliente_id
        where cc.empresa_id = '${emp.id}' and c.odoo_id is not null and not t.por_confirmar and t.categoria_cobranza is not null
          and exists (select 1 from facturas f where f.cliente_id = c.id and f.estado = 'posted'))
      select cliente_id, tipo from l where rn = 1 order by existe desc, tipo limit 3`);
    const res = await escribirClasificacion({ odoo: soloLectura, sql: sqlPrueba, fila: { empresa_id: emp.id, datos: { accion: 'clientes', clientes: muestra.map((m) => m.cliente_id) } }, aplicar: false, quien: 'Prueba 22d' });
    for (const c of res.clientes) payloads.push({ empresa: emp.nombre_corto, cliente: c.cliente?.slice(0, 32), partner: c.partner, estado: c.estado, payload: JSON.stringify(c.payload ?? c.error) });
    const ok = res.modo === 'simulacion' && res.clientes.length === 3 && res.clientes.every((c) => c.estado === 'simulada')
      && res.clientes.every((c) => emp === guds ? 'eu_partner_channel_id' in c.payload : !('eu_partner_channel_id' in c.payload));
    casos.push({ ok: ok ? '✓' : '✗', caso: `Escritor (modo prueba) ${emp.nombre_corto}: 3 clientes simulados${emp === guds ? ', con canal' : ', sin canal (Quirutec)'}`, resultado: JSON.stringify(res.resumen) });
    // Ids de catálogo: lo que ya existe en Odoo va con su id; lo nuevo va como "(nuevo) …"
    const conocidos = res.catalogo.plan.filter((p) => p.odoo_id);
    const okIds = res.clientes.every((c) => Object.entries(c.payload).every(([campo, v]) => {
      const dim = { industry_id: 'tipo', eu_partner_channel_id: 'canal', eu_partner_segment_id: 'categoria' }[campo];
      const p = res.catalogo.plan.find((x) => x.dimension === dim && (Number.isInteger(v) ? x.odoo_id === v : `(nuevo) ${x.nombre}` === v));
      return p && (Number.isInteger(v) ? p.accion !== 'crear' : p.accion === 'crear');
    }));
    casos.push({ ok: okIds ? '✓' : '✗', caso: `Escritor ${emp.nombre_corto}: ids de catálogo coherentes con el plan (existentes por id, nuevos marcados)`,
      resultado: conocidos.map((p) => `${p.nombre}=${p.odoo_id}(${p.accion})`).join(' ').slice(0, 110) || 'todo nuevo' });
    // Catálogo completo de la empresa
    const cat = await escribirClasificacion({ odoo: soloLectura, sql: sqlPrueba, fila: { empresa_id: emp.id, datos: { accion: 'catalogo', empresa_id: emp.id } }, aplicar: false });
    casos.push({ ok: cat.modo === 'simulacion' && cat.plan.length > 0 ? '✓' : '✗', caso: `Catálogo ${emp.nombre_corto} en modo prueba: qué crearía / ajustaría / reusaría en Odoo`,
      resultado: `${JSON.stringify(cat.resumen)} ${cat.plan.filter((p) => p.accion !== 'crear').map((p) => `${p.nombre}←${p.antes ?? p.nombre}#${p.odoo_id}`).join(' ')}`.slice(0, 110) });
    // Nunca toca los 21 sectores estándar en inglés
    const ingles = cat.plan.filter((p) => p.dimension === 'tipo' && p.odoo_id && p.odoo_id <= 21);
    casos.push({ ok: !ingles.length ? '✓' : '✗', caso: `Catálogo ${emp.nombre_corto}: no usa ni renombra los sectores estándar de Odoo (ids 1–21)`, resultado: ingles.map((p) => p.odoo_id).join(',') || 'ninguno' });
  }
  // resolverCatalogo exportado: también lo usa la prueba (sanidad del import)
  casos.push({ ok: typeof resolverCatalogo === 'function' ? '✓' : '✗', caso: 'escribir-clasificacion.js exporta resolverCatalogo', resultado: typeof resolverCatalogo });
}

// ── 6. Carga inicial: conteos por empresa ──
const conteo = await sql(`
  with fac as (select f.cliente_id, coalesce(sum(f.total_usd) filter (where not coalesce(f.es_saldo_inicial, false)), 0) ventas, coalesce(sum(f.saldo_usd), 0) deuda
               from facturas f where f.estado = 'posted' group by 1)
  select e.nombre_corto empresa, count(*) clientes, count(*) filter (where coalesce(fac.ventas, 0) > 0 or coalesce(fac.deuda, 0) > 0.01) con_actividad,
    count(*) filter (where cc.excel_tipo_id is not null) propuesta_excel,
    count(*) filter (where cc.origen = 'profit') propuesta_profit_tipo,
    count(*) filter (where cc.tipo_id is null and cc.profit_categoria is not null) profit_solo_categoria,
    count(*) filter (where cc.tipo_id is null) sin_tipo,
    count(*) filter (where cc.tipo_id is null and (coalesce(fac.ventas, 0) > 0 or coalesce(fac.deuda, 0) > 0.01)) sin_tipo_con_actividad
  from clientes c join empresas e on e.id = c.empresa_id left join fac on fac.cliente_id = c.id left join clasificacion_clientes cc on cc.cliente_id = c.id
  group by 1 order by 1`);

console.table(casos);
if (payloads.length) { console.log('\nPayload que mandaría a Odoo (modo prueba):'); console.table(payloads); }
console.log('\nCarga inicial por empresa:'); console.table(conteo);
const fallas = casos.filter((c) => c.ok === '✗').length;
console.log(fallas ? `✗ ${fallas} caso(s) fallaron` : `✓ Los ${casos.length} casos pasaron`);
process.exit(fallas ? 1 : 0);
