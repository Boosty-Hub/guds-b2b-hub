/**
 * Respaldo de Supabase (SOLO LECTURA) sin pg_dump ni Docker, vía Management API.
 *
 * Genera en <destino>/<fecha>/:
 *   - esquema.sql : foto de la estructura (tipos, tablas, restricciones, índices, vistas,
 *                   funciones, triggers, RLS + políticas, grants, buckets, realtime, cron)
 *   - datos/<tabla>.json : todas las filas de cada tabla de public
 *   - datos/auth_users.json : usuarios de auth (sin hashes de contraseña)
 *
 * Uso (desde la raíz del repo):
 *   node scripts/respaldo-supabase.mjs [destino]
 * Por defecto el destino es C:/Users/gabri/GUDS-backups (fuera del repo y de OneDrive:
 * los datos tienen información de clientes).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const { SUPABASE_ACCESS_TOKEN: TOKEN, SUPABASE_PROJECT_REF: REF } = process.env;
if (!TOKEN || !REF) { console.error('Falta SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF en .env.local'); process.exit(1); }

async function sql(query) {
  if (!/^\s*(select|with)\b/i.test(query)) throw new Error('El respaldo solo ejecuta SELECT');
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const b = await r.json(); if (!r.ok) throw new Error(`${r.status}: ${JSON.stringify(b)}`); return b;
}

const fecha = new Date().toISOString().slice(0, 10);
const destino = path.join(process.argv[2] || 'C:/Users/gabri/GUDS-backups', fecha);
fs.mkdirSync(path.join(destino, 'datos'), { recursive: true });
const out = [];
const seccion = (t) => out.push(`\n-- ════════════════ ${t} ════════════════\n`);
out.push(`-- Foto de esquema de Supabase (proyecto ${REF}) · ${new Date().toISOString()}`,
  '-- Referencia/restauración manual. NO es una migración: no aplicar sobre una base que ya tiene estas tablas.');

seccion('EXTENSIONES');
for (const e of await sql(`select extname, n.nspname from pg_extension x join pg_namespace n on n.oid=x.extnamespace where extname<>'plpgsql' order by 1`))
  out.push(`create extension if not exists "${e.extname}" with schema ${e.nspname};`);

seccion('TIPOS ENUM');
for (const t of await sql(`select t.typname, string_agg(quote_literal(e.enumlabel), ', ' order by e.enumsortorder) vals
  from pg_type t join pg_enum e on e.enumtypid=t.oid join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' group by 1 order by 1`))
  out.push(`create type public.${t.typname} as enum (${t.vals});`);

seccion('SECUENCIAS');
for (const s of await sql(`select sequencename, start_value, increment_by from pg_sequences where schemaname='public' order by 1`))
  out.push(`create sequence if not exists public.${s.sequencename} start ${s.start_value} increment ${s.increment_by};`);

seccion('TABLAS');
const cols = await sql(`select c.relname tabla, a.attname col, format_type(a.atttypid, a.atttypmod) tipo, a.attnotnull nn,
  a.attgenerated gen, pg_get_expr(d.adbin, d.adrelid) def, a.attidentity ident
  from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
  left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where n.nspname='public' and c.relkind='r' and a.attnum>0 and not a.attisdropped order by c.relname, a.attnum`);
const tablas = [...new Set(cols.map(c => c.tabla))];
for (const t of tablas) {
  const defs = cols.filter(c => c.tabla === t).map(c => {
    let s = `  "${c.col}" ${c.tipo}`;
    if (c.gen === 's') s += ` generated always as (${c.def}) stored`;
    else if (c.ident) s += ` generated ${c.ident === 'a' ? 'always' : 'by default'} as identity`;
    else if (c.def) s += ` default ${c.def}`;
    if (c.nn) s += ' not null';
    return s;
  });
  out.push(`create table public."${t}" (\n${defs.join(',\n')}\n);`);
}

seccion('RESTRICCIONES (PK, UNIQUE, CHECK, luego FK)');
const cons = await sql(`select c.relname tabla, k.conname, k.contype, pg_get_constraintdef(k.oid) def from pg_constraint k
  join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
  order by (k.contype='f'), c.relname, k.conname`);
for (const k of cons) out.push(`alter table public."${k.tabla}" add constraint "${k.conname}" ${k.def};`);

seccion('ÍNDICES (los que no respaldan una restricción)');
for (const i of await sql(`select indexdef from pg_indexes i where schemaname='public'
  and not exists (select 1 from pg_constraint k where k.conname=i.indexname) order by tablename, indexname`))
  out.push(`${i.indexdef};`);

seccion('VISTAS');
for (const v of await sql(`select viewname, definition from pg_views where schemaname='public' order by 1`))
  out.push(`create or replace view public."${v.viewname}" as\n${v.definition}`);

seccion('FUNCIONES');
for (const f of await sql(`select pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind in ('f','p') order by p.proname`))
  out.push(`${f.def.trim()};\n`);

seccion('TRIGGERS');
for (const g of await sql(`select pg_get_triggerdef(t.oid) def from pg_trigger t join pg_class c on c.oid=t.tgrelid
  join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal order by c.relname, t.tgname`))
  out.push(`${g.def};`);

seccion('RLS Y POLÍTICAS (public y storage)');
for (const r of await sql(`select c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' and c.relrowsecurity order by 1`))
  out.push(`alter table public."${r.relname}" enable row level security;${r.relforcerowsecurity ? ` alter table public."${r.relname}" force row level security;` : ''}`);
for (const p of await sql(`select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check from pg_policies
  where schemaname in ('public','storage') order by schemaname, tablename, policyname`)) {
  const roles = (Array.isArray(p.roles) ? p.roles : String(p.roles).replace(/[{}]/g, '').split(',')).join(', ');
  out.push(`create policy "${p.policyname}" on ${p.schemaname}."${p.tablename}" as ${p.permissive.toLowerCase()} for ${p.cmd.toLowerCase()} to ${roles}`
    + (p.qual ? `\n  using (${p.qual})` : '') + (p.with_check ? `\n  with check (${p.with_check})` : '') + ';');
}

seccion('GRANTS (tablas y funciones, roles de Supabase)');
for (const g of await sql(`select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type) privs from information_schema.role_table_grants
  where table_schema='public' and grantee in ('anon','authenticated','service_role') group by 1,2 order by 1,2`))
  out.push(`grant ${g.privs} on public."${g.table_name}" to ${g.grantee};`);
for (const g of await sql(`select p.proname, pg_get_function_identity_arguments(p.oid) args, r.rolname from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  join pg_roles r on r.oid=a.grantee where n.nspname='public' and r.rolname in ('anon','authenticated','service_role') and a.privilege_type='EXECUTE'
  order by 1,3`))
  out.push(`grant execute on function public.${g.proname}(${g.args}) to ${g.rolname};`);

seccion('STORAGE BUCKETS');
for (const b of await sql(`select id, name, public, file_size_limit, allowed_mime_types from storage.buckets order by 1`))
  out.push(`insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values (${[b.id, b.name].map(v => `'${v}'`).join(', ')}, ${b.public}, ${b.file_size_limit ?? 'null'}, ${b.allowed_mime_types ? `'${JSON.stringify(b.allowed_mime_types).replace(/^\[/, '{').replace(/\]$/, '}')}'` : 'null'}) on conflict (id) do nothing;`);

seccion('REALTIME (publicación supabase_realtime)');
for (const t of await sql(`select schemaname, tablename from pg_publication_tables where pubname='supabase_realtime' order by 2`))
  out.push(`alter publication supabase_realtime add table ${t.schemaname}."${t.tablename}";`);

seccion('CRON');
try {
  for (const j of await sql(`select jobname, schedule, command from cron.job order by jobname`))
    out.push(`select cron.schedule('${j.jobname}', '${j.schedule}', $cron$${j.command}$cron$);`);
} catch { out.push('-- (pg_cron no disponible)'); }

fs.writeFileSync(path.join(destino, 'esquema.sql'), out.join('\n') + '\n');
console.log(`✓ esquema.sql: ${tablas.length} tablas, ${cons.length} restricciones`);

// ── Datos ──
let filas = 0;
for (const t of tablas) {
  const rows = await sql(`select coalesce(json_agg(x), '[]'::json) filas from public."${t}" x`);
  const data = rows[0].filas;
  fs.writeFileSync(path.join(destino, 'datos', `${t}.json`), JSON.stringify(data));
  filas += data.length;
}
const users = await sql(`select coalesce(json_agg(json_build_object('id', id, 'email', email, 'created_at', created_at,
  'raw_user_meta_data', raw_user_meta_data, 'raw_app_meta_data', raw_app_meta_data)), '[]'::json) filas from auth.users`);
fs.writeFileSync(path.join(destino, 'datos', 'auth_users.json'), JSON.stringify(users[0].filas));
console.log(`✓ datos: ${tablas.length} tablas, ${filas} filas + ${users[0].filas.length} usuarios de auth`);
console.log(`→ ${destino}`);
