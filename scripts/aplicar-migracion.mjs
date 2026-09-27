/**
 * Aplica un archivo .sql de supabase/migrations en el proyecto vía Management API.
 * (Las migraciones de 2026 se aplican así; supabase_migrations quedó en dic-2025.)
 *
 * Uso:
 *   node scripts/aplicar-migracion.mjs supabase/migrations/<archivo>.sql
 *
 * El archivo debe envolver sus cambios en begin/commit para que un error no deje la base a medias.
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
const file = process.argv[2];
if (!file) { console.error('Uso: node scripts/aplicar-migracion.mjs <archivo.sql>'); process.exit(1); }

const query = fs.readFileSync(path.resolve(ROOT, file), 'utf8');
if (!/^\s*begin\s*;/im.test(query) || !/commit\s*;\s*$/i.test(query.trim())) {
  console.error('✗ La migración debe empezar con begin; y terminar con commit;');
  process.exit(1);
}
const t0 = Date.now();
const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query }),
});
const body = await r.json().catch(() => ({}));
if (!r.ok) { console.error(`✗ ${path.basename(file)} falló (${r.status}):\n${body.message || JSON.stringify(body)}`); process.exit(1); }
console.log(`✓ ${path.basename(file)} aplicada en ${Date.now() - t0} ms`);

// La API (PostgREST) se entera de tablas/columnas nuevas por un event trigger que NO corre si la migración usa
// session_replication_role = replica. Se fuerza el refresco siempre.
const n = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: `notify pgrst, 'reload schema';` }),
});
console.log(n.ok ? '✓ esquema de la API refrescado' : '⚠ no se pudo refrescar el esquema de la API');
