// SQL contra Supabase vía Management API (rol postgres: salta RLS y la guardia de empresa).
// Solo para scripts de mantenimiento/importación; nunca desde el frontend.
import { requerir } from './entorno.mjs';

const { SUPABASE_ACCESS_TOKEN: TOKEN, SUPABASE_PROJECT_REF: REF } = requerir('SUPABASE_ACCESS_TOKEN', 'SUPABASE_PROJECT_REF');

// La Management API limita la tasa de peticiones (429): se reintenta con espera creciente, igual ante 5xx.
export async function sql(query, intentos = 6) {
  for (let i = 0; ; i++) {
    const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const b = await r.json().catch(() => ({}));
    if (r.ok) return b;
    const reintentable = r.status === 429 || r.status >= 500;
    if (!reintentable || i >= intentos - 1) throw new Error(`${r.status}: ${b.message || JSON.stringify(b)}`);
    const espera = Math.min(60000, 2000 * 2 ** i);
    await new Promise((res) => setTimeout(res, espera));
  }
}

export const jsonbLit = (a) => `'${JSON.stringify(a).replace(/'/g, "''")}'::jsonb`;
export const lotes = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
