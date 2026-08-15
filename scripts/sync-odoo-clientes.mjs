/**
 * Sincroniza CLIENTES desde Odoo (res_partner, customer_rank>0) → Supabase.
 * SOLO LECTURA en Odoo. Idempotente (upsert por odoo_id).
 *
 * Uso:
 *   ODOO_PG_* + SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF en el entorno.
 *   node scripts/sync-odoo-clientes.mjs [--apply] [--purge-mock]
 *     (sin flags)  -> dry-run
 *     --apply      -> DDL (columnas nuevas + odoo_id) + upsert
 *     --purge-mock -> además borra los clientes de prueba (odoo_id null), desligando usuarios
 */
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const PURGE = process.argv.includes('--purge-mock');
const REF = process.env.SUPABASE_PROJECT_REF;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

async function mgmt(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`Mgmt API ${r.status}: ${JSON.stringify(body)}`);
  return body;
}
const jsonbLit = (arr) => `'${JSON.stringify(arr).replace(/'/g, "''")}'::jsonb`;

// ── 1. EXTRACCIÓN (solo lectura) ────────────────────────────────────────
const odoo = new pg.Client({
  host: process.env.ODOO_PG_HOST, port: 5432,
  user: process.env.ODOO_PG_USER, password: process.env.ODOO_PG_PASSWORD,
  database: 'guds-master.agroo.net.ve', ssl: false,
  connectionTimeoutMillis: 20000, statement_timeout: 120000,
});
await odoo.connect();
let raw;
try {
  raw = (await odoo.query(`
    select
      p.id as odoo_id,
      nullif(trim(p.ref),'') as ref,
      trim(p.name) as nombre_negocio,
      nullif(trim(p.rif),'') as rif,
      nullif(trim(p.cedula),'') as cedula,
      nullif(trim(p.email),'') as email,
      nullif(trim(p.phone),'') as telefono,
      nullif(trim(p.mobile),'') as celular,
      nullif(trim(concat_ws(', ', nullif(trim(p.street),''), nullif(trim(p.street2),''))),'') as direccion,
      nullif(trim(p.city),'') as ciudad,
      s.name as estado,
      nullif(p.partner_latitude, 0) as latitud,
      nullif(p.partner_longitude, 0) as longitud,
      coalesce(p.is_company, false) as es_empresa,
      p.residence_type,
      sp.name as vendedor_odoo,
      coalesce(apt.name->>'es_VE', apt.name->>'en_US', apt.name::text) as condicion_pago,
      ptl.dias as dias_credito,
      coalesce(p.credit_limit_value, cl.val) as limite_credito,
      nullif(trim(p.econ_act_license),'') as licencia_actividad,
      nullif(trim(p.website),'') as sitio_web,
      nullif(trim(p.comment),'') as notas,
      p.create_date as fecha_registro_odoo,
      coalesce(p.active, true) as activo
    from res_partner p
    left join res_country_state s on s.id = p.state_id
    left join res_users ru on ru.id = p.user_id
    left join res_partner sp on sp.id = ru.partner_id
    left join lateral (select (value)::int as term_id from jsonb_each_text(p.property_payment_term_id) limit 1) pt on true
    left join account_payment_term apt on apt.id = pt.term_id
    left join lateral (select max(nb_days) as dias from account_payment_term_line where payment_id = pt.term_id) ptl on true
    left join lateral (select (value)::numeric as val from jsonb_each_text(p.credit_limit) limit 1) cl on true
    where p.customer_rank > 0
    order by p.id`)).rows;
} finally { await odoo.end(); }

// ── 2. TRANSFORMACIÓN ───────────────────────────────────────────────────
const RESID = { D: 'Domiciliado', R: 'Residente', NR: 'No residente' };
const clientes = raw.map(c => {
  const codigo = `ODOO-${c.odoo_id}`; // código consistente y único (el ref de Odoo a veces trae nombres)
  return {
    odoo_id: c.odoo_id,
    codigo,
    nombre_negocio: c.nombre_negocio || codigo,
    rif: c.rif || c.cedula || 'N/D',
    cedula: c.cedula,
    email: c.email,
    telefono: c.telefono,
    celular: c.celular,
    direccion: c.direccion,
    ciudad: c.ciudad,
    estado: c.estado,
    latitud: c.latitud != null ? Number(c.latitud) : null,
    longitud: c.longitud != null ? Number(c.longitud) : null,
    es_empresa: c.es_empresa,
    tipo_negocio: c.es_empresa ? 'Empresa' : 'Persona Natural',
    tipo_residencia: RESID[c.residence_type] ?? null,
    vendedor_odoo: c.vendedor_odoo,
    condicion_pago: c.condicion_pago,
    dias_credito: c.dias_credito != null ? Number(c.dias_credito) : null,
    limite_credito: c.limite_credito != null ? Number(c.limite_credito) : null,
    licencia_actividad: c.licencia_actividad,
    sitio_web: c.sitio_web,
    notas: c.notas,
    fecha_registro_odoo: c.fecha_registro_odoo,
    activo: c.activo,
    contribuyente_especial: false,
  };
});

console.log(`\n=== SYNC CLIENTES ODOO → SUPABASE  [${APPLY ? 'APPLY' : 'DRY-RUN'}${PURGE ? ' +PURGE-MOCK' : ''}] ===`);
console.log('Clientes:', clientes.length);
console.log('  con email:', clientes.filter(c => c.email).length,
            '| con estado:', clientes.filter(c => c.estado).length,
            '| con vendedor:', clientes.filter(c => c.vendedor_odoo).length,
            '| con geo:', clientes.filter(c => c.latitud).length);
console.log('Ejemplo:', JSON.stringify(clientes[0]));

if (!APPLY) { console.log('\nDRY-RUN: nada escrito. Usá --apply (+ --purge-mock la 1ª vez).'); process.exit(0); }

// ── 3. DDL: columnas nuevas + nullable + odoo_id único ──────────────────
console.log('\n[1/4] DDL…');
await mgmt(`
  alter table public.clientes add column if not exists odoo_id integer;
  alter table public.clientes add column if not exists cedula text;
  alter table public.clientes add column if not exists estado text;
  alter table public.clientes add column if not exists celular text;
  alter table public.clientes add column if not exists es_empresa boolean;
  alter table public.clientes add column if not exists tipo_residencia text;
  alter table public.clientes add column if not exists vendedor_odoo text;
  alter table public.clientes add column if not exists condicion_pago text;
  alter table public.clientes add column if not exists licencia_actividad text;
  alter table public.clientes add column if not exists sitio_web text;
  alter table public.clientes add column if not exists notas text;
  alter table public.clientes add column if not exists fecha_registro_odoo timestamptz;
  alter table public.clientes alter column email drop not null;
  alter table public.clientes alter column ciudad drop not null;
  alter table public.clientes alter column direccion drop not null;
  alter table public.clientes alter column rif type text;
  alter table public.clientes alter column codigo type text;
  alter table public.clientes alter column telefono type text;
  alter table public.clientes drop constraint if exists clientes_rif_key;
  create unique index if not exists clientes_odoo_id_key on public.clientes(odoo_id);`);

// ── 4. Purga de mock (opcional) ─────────────────────────────────────────
if (PURGE) {
  console.log('[2/4] Purga de clientes mock (desligando usuarios)…');
  await mgmt(`
    alter table public.usuarios disable trigger user;
    update public.usuarios set cliente_id = null where cliente_id in (select id from clientes where odoo_id is null);
    alter table public.usuarios enable trigger user;
    update public.registros_clientes set cliente_creado_id = null where cliente_creado_id in (select id from clientes where odoo_id is null);
    delete from public.cupones where cliente_especifico_id in (select id from clientes where odoo_id is null);
    delete from public.pagos   where cliente_id in (select id from clientes where odoo_id is null);
    delete from public.ordenes where cliente_id in (select id from clientes where odoo_id is null);
    delete from public.clientes where odoo_id is null;`);
} else {
  console.log('[2/4] (sin --purge-mock)');
}

// ── 5. Upsert ───────────────────────────────────────────────────────────
console.log('[3/4] Upsert clientes…');
await mgmt(`
  insert into clientes (
    odoo_id, codigo, nombre_negocio, rif, cedula, email, telefono, celular, direccion,
    ciudad, estado, latitud, longitud, es_empresa, tipo_negocio, tipo_residencia,
    vendedor_odoo, condicion_pago, dias_credito, limite_credito, licencia_actividad,
    sitio_web, notas, fecha_registro_odoo, activo, contribuyente_especial)
  select
    x.odoo_id, x.codigo, x.nombre_negocio, x.rif, x.cedula, x.email, x.telefono, x.celular, x.direccion,
    x.ciudad, x.estado, x.latitud, x.longitud, x.es_empresa, x.tipo_negocio, x.tipo_residencia,
    x.vendedor_odoo, x.condicion_pago, x.dias_credito, x.limite_credito, x.licencia_actividad,
    x.sitio_web, x.notas, x.fecha_registro_odoo, x.activo, x.contribuyente_especial
  from jsonb_to_recordset(${jsonbLit(clientes)}) as x(
    odoo_id int, codigo text, nombre_negocio text, rif text, cedula text, email text, telefono text,
    celular text, direccion text, ciudad text, estado text, latitud numeric, longitud numeric,
    es_empresa boolean, tipo_negocio text, tipo_residencia text, vendedor_odoo text, condicion_pago text,
    dias_credito int, limite_credito numeric, licencia_actividad text, sitio_web text, notas text,
    fecha_registro_odoo timestamptz, activo boolean, contribuyente_especial boolean)
  on conflict (odoo_id) do update set
    codigo=excluded.codigo, nombre_negocio=excluded.nombre_negocio, rif=excluded.rif, cedula=excluded.cedula,
    email=excluded.email, telefono=excluded.telefono, celular=excluded.celular, direccion=excluded.direccion,
    ciudad=excluded.ciudad, estado=excluded.estado, latitud=excluded.latitud, longitud=excluded.longitud,
    es_empresa=excluded.es_empresa, tipo_negocio=excluded.tipo_negocio, tipo_residencia=excluded.tipo_residencia,
    vendedor_odoo=excluded.vendedor_odoo, condicion_pago=excluded.condicion_pago, dias_credito=excluded.dias_credito,
    limite_credito=excluded.limite_credito, licencia_actividad=excluded.licencia_actividad,
    sitio_web=excluded.sitio_web, notas=excluded.notas, fecha_registro_odoo=excluded.fecha_registro_odoo,
    activo=excluded.activo;`);

console.log('[4/4] Verificación…');
const v = await mgmt(`select
  (select count(*) from clientes) as total,
  (select count(*) from clientes where odoo_id is not null) as importados,
  (select count(*) from clientes where email is not null) as con_email,
  (select count(*) from clientes where estado is not null) as con_estado,
  (select count(*) from clientes where latitud is not null) as con_geo`);
console.log(JSON.stringify(v[0] ?? v, null, 1));
console.log('\n✓ Sync clientes completado.');
