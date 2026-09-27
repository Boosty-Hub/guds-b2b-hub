// Carga .env.local (raíz del repo) en process.env sin pisar variables ya definidas.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

export function requerir(...nombres) {
  const faltan = nombres.filter(n => !process.env[n]);
  if (faltan.length) throw new Error(`Falta ${faltan.join(', ')} en .env.local`);
  return Object.fromEntries(nombres.map(n => [n, process.env[n]]));
}
