/**
 * T2 (fase 22c) · Histórico de la tasa BCV en `tasa_bcv` para las fechas anteriores al cron diario (19-jul-2026).
 *
 *   node scripts/importar-tasas-bcv-historico.mjs              → muestra lo que insertaría (no escribe)
 *   node scripts/importar-tasas-bcv-historico.mjs --aplicar    → inserta las fechas que faltan
 *   node scripts/importar-tasas-bcv-historico.mjs --aplicar --sin-profit   → solo Odoo
 *
 * Fuentes, en este orden, y SOLO para fechas que todavía no tienen ninguna tasa en `tasa_bcv` (idempotente: se puede
 * correr las veces que haga falta; nunca modifica ni borra filas existentes, y el cron sigue escribiendo las nuevas):
 *
 *   1. Odoo `res.currency.rate` (solo lectura, scripts/lib/odoo.mjs), moneda VED. La moneda de las dos compañías es USD,
 *      así que `rate` = bolívares por 1 USD (lo mismo que guarda el cron); `inverse_company_rate` es USD por Bs. Si las dos
 *      compañías tienen la fecha y difieren (1 caso, 10-nov-2025), gana GUDS. fuente = 'Odoo res.currency.rate'.
 *      Validado el 8-oct contra las 80 fechas que ya trae el cron: 78 iguales a la diezmilésima; el 14-ago el cron tiene
 *      además una fila de las 20:39 (botón pulsado cuando el BCV ya había publicado la tasa del día hábil siguiente; la de
 *      las 8:00 coincide con Odoo) y el 4-oct (domingo) no está en Odoo.
 *   2. Profit (`ventas_historicas`, tipo factura): la tasa de venta más usada en las facturas de ese día (GUDS y, si no hay,
 *      Quirutec), con 2 decimales. Solo rellena los huecos de Odoo (abr–jun 2025, oct 2025–feb 2026, mar–abr 2026…).
 *      Validado: en los 843 días que tienen las dos fuentes, 830 (98,5 %) coinciden con Odoo redondeado a 2 decimales.
 *      fuente = 'Profit (tasa de venta de facturas)'. Se omite con --sin-profit.
 *
 * Para quitarlo todo: delete from tasa_bcv where fuente in ('Odoo res.currency.rate', 'Profit (tasa de venta de facturas)');
 */
import { conectarOdoo, odooRead } from './lib/odoo.mjs';
import { sql } from './lib/supabase-admin.mjs';

const APLICAR = process.argv.includes('--aplicar');
const CON_PROFIT = !process.argv.includes('--sin-profit');
const FUENTE_ODOO = 'Odoo res.currency.rate';
const FUENTE_PROFIT = 'Profit (tasa de venta de facturas)';

const sesion = await conectarOdoo();
const ved = await odooRead('res.currency', 'search_read', [[['name', '=', 'VED'], ['active', 'in', [true, false]]]], { fields: ['id', 'name'] });
if (ved.length !== 1) throw new Error(`Se esperaba una moneda VED en Odoo y hay ${ved.length}`);
const companias = await odooRead('res.company', 'search_read', [[['id', 'in', sesion.empresas]]], { fields: ['id', 'name', 'currency_id'] });
for (const c of companias) {
  if (c.currency_id?.[1] !== 'USD') throw new Error(`La moneda de ${c.name} no es USD (${c.currency_id?.[1]}): revisar el sentido de la tasa`);
}
const gudsOdoo = (await sql(`select odoo_company_id from empresas where prefijo = 'GUDS'`))[0]?.odoo_company_id ?? 1;

const tasasOdoo = await odooRead('res.currency.rate', 'search_read', [[['currency_id', '=', ved[0].id]]],
  { fields: ['name', 'rate', 'company_id'], order: 'name asc' });
const porFecha = new Map();
for (const r of tasasOdoo) {
  if (!(r.rate > 0)) continue;
  const previa = porFecha.get(r.name);
  if (!previa || r.company_id?.[0] === gudsOdoo) porFecha.set(r.name, { fecha: r.name, tasa: Number(r.rate.toFixed(4)), fuente: FUENTE_ODOO });
}

const existentes = new Set((await sql(`select distinct fecha::text f from tasa_bcv`)).map((x) => x.f));
const nuevas = [...porFecha.values()].filter((x) => !existentes.has(x.fecha));

let profit = [];
if (CON_PROFIT) {
  const ocupadas = new Set([...existentes, ...nuevas.map((x) => x.fecha)]);
  const filas = await sql(`
    select v.fecha::text fecha, e.prefijo, mode() within group (order by v.tasa_venta) tasa, count(distinct v.numero) n
      from ventas_historicas v join empresas e on e.id = v.empresa_id
     where v.tipo = 'factura' and v.tasa_venta > 1
     group by 1, 2`);
  const mejor = new Map();
  for (const f of filas) {
    const x = mejor.get(f.fecha);
    // GUDS primero; si no, la empresa con más facturas ese día
    if (!x || (f.prefijo === 'GUDS' && x.prefijo !== 'GUDS') || (f.prefijo !== 'GUDS' && x.prefijo !== 'GUDS' && Number(f.n) > Number(x.n))) mejor.set(f.fecha, f);
  }
  profit = [...mejor.values()].filter((f) => !ocupadas.has(f.fecha))
    .map((f) => ({ fecha: f.fecha, tasa: Number(Number(f.tasa).toFixed(4)), fuente: FUENTE_PROFIT }));
}

const todas = [...nuevas, ...profit].sort((a, b) => a.fecha.localeCompare(b.fecha));
const rango = (a) => (a.length ? `${a[0].fecha} → ${a.at(-1).fecha}` : '—');
console.log(`Odoo: ${tasasOdoo.length} tasas VED (${porFecha.size} fechas); faltan en tasa_bcv: ${nuevas.length} (${rango(nuevas)})`);
if (CON_PROFIT) console.log(`Profit: ${profit.length} fechas más para los huecos de Odoo (${rango(profit)})`);
console.log(`Fechas que ya tenía tasa_bcv: ${existentes.size}`);

if (!APLICAR) {
  console.log('\nVista previa (sin escribir). Para insertar: --aplicar');
  process.exit(0);
}

let insertadas = 0;
for (let i = 0; i < todas.length; i += 500) {
  const lote = todas.slice(i, i + 500);
  const valores = lote.map((x) => `('${x.fecha}'::date, ${x.tasa}::numeric, '${x.fuente.replace(/'/g, "''")}')`).join(',\n');
  const r = await sql(`
    with v(fecha, tasa, fuente) as (values ${valores}),
    ins as (
      insert into tasa_bcv (fecha, tasa, fuente)
      select v.fecha, v.tasa, v.fuente from v
       where not exists (select 1 from tasa_bcv t where t.fecha = v.fecha)
      returning 1)
    select count(*)::int n from ins`);
  insertadas += r[0].n;
}
const resumen = await sql(`select fuente, count(*)::int n, min(fecha)::text desde, max(fecha)::text hasta from tasa_bcv group by 1 order by 3`);
console.log(`\n✓ Insertadas ${insertadas} fechas.`);
console.table(resumen);
