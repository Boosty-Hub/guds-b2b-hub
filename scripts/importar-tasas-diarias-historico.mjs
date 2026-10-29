/**
 * Fase 24a · Histórico de `tasas_diarias` desde DolarApi (BCV dólar y euro desde ene-2023, paralelo desde feb-2026).
 *
 *   node scripts/importar-tasas-diarias-historico.mjs              → muestra lo que cargaría (no escribe)
 *   node scripts/importar-tasas-diarias-historico.mjs --aplicar    → lo carga
 *
 * Idempotente: solo llena las tasas que falten en cada fecha (nunca pisa un valor ni una fila corregida a mano), así que
 * se puede correr las veces que haga falta. La fecha de DolarApi es la fecha valor del BCV, la misma que usa la Edge
 * Function actualizar-tasa-bcv. fuente = 'dolarapi (histórico)'.
 *
 * Para quitarlo: delete from tasas_diarias where not editada_manual and fuente_bcv = 'dolarapi (histórico)'
 *                  and coalesce(fuente_paralelo, 'dolarapi (histórico)') = 'dolarapi (histórico)';
 */
import { sql, jsonbLit, lotes } from './lib/supabase-admin.mjs';

const APLICAR = process.argv.includes('--aplicar');
const FUENTE = 'dolarapi (histórico)';

const historico = async (ruta) => {
  const r = await fetch(`https://ve.dolarapi.com/v1/historicos/${ruta}`, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`DolarApi ${ruta}: ${r.status}`);
  return (await r.json()).filter((x) => x.fecha && x.promedio > 0);
};

const [usd, eur, par] = await Promise.all([historico('dolares/oficial'), historico('euros/oficial'), historico('dolares/paralelo')]);
const filas = new Map();
const fila = (fecha) => filas.get(fecha) ?? filas.set(fecha, { fecha, bcv_usd: null, bcv_eur: null, paralelo_usd: null }).get(fecha);
for (const x of usd) fila(x.fecha).bcv_usd = x.promedio;
for (const x of eur) fila(x.fecha).bcv_eur = x.promedio;
for (const x of par) fila(x.fecha).paralelo_usd = x.promedio;
const todas = [...filas.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));

console.log(`DolarApi: ${usd.length} BCV dólar, ${eur.length} BCV euro, ${par.length} paralelo → ${todas.length} fechas`);
console.log(`  de ${todas[0].fecha} a ${todas.at(-1).fecha}`);

const [antes] = await sql(`select count(*)::int n, count(bcv_usd)::int usd, count(bcv_eur)::int eur, count(paralelo_usd)::int par
                             from tasas_diarias`);
console.log('tasas_diarias antes:', antes);
if (!APLICAR) { console.log('\n(sin --aplicar: no se escribió nada)'); process.exit(0); }

for (const lote of lotes(todas, 400)) {
  await sql(`
    insert into tasas_diarias as t (fecha, bcv_usd, bcv_eur, paralelo_usd, fuente_bcv, fuente_paralelo)
    select x.fecha, x.bcv_usd, x.bcv_eur, x.paralelo_usd,
           case when x.bcv_usd is not null or x.bcv_eur is not null then '${FUENTE}' end,
           case when x.paralelo_usd is not null then '${FUENTE}' end
      from jsonb_to_recordset(${jsonbLit(lote)}) x(fecha date, bcv_usd numeric, bcv_eur numeric, paralelo_usd numeric)
    on conflict (fecha) do update set
      bcv_usd = coalesce(t.bcv_usd, excluded.bcv_usd),
      bcv_eur = coalesce(t.bcv_eur, excluded.bcv_eur),
      paralelo_usd = coalesce(t.paralelo_usd, excluded.paralelo_usd),
      fuente_bcv = coalesce(t.fuente_bcv, excluded.fuente_bcv),
      fuente_paralelo = coalesce(t.fuente_paralelo, excluded.fuente_paralelo)
    where not t.editada_manual`);
}
const [despues] = await sql(`select count(*)::int n, count(bcv_usd)::int usd, count(bcv_eur)::int eur, count(paralelo_usd)::int par
                               from tasas_diarias`);
console.log('tasas_diarias después:', despues);
