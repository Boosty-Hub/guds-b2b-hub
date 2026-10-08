/**
 * Carga los cobros de Profit anteriores al arranque de Odoo (ene–abr 2026) en cobros_historicos (fase 22f · R2, decisión D3
 * de docs/PLAN-REPORTES-FINANZAS.md). Desde el arranque los cobros salen de Odoo; antes no están en Odoo (solo hay anticipos de
 * saldo inicial migrados, que NO cuentan como cobro: son el mismo dinero que estos recibos).
 *
 * Fuente: el Excel "FORMATO DE LO COBRADO" de finanzas, hoja "Cobranza 2026" (una fila por forma de pago de cada recibo).
 *
 *   node scripts/importar-cobros-profit.mjs [--excel "<ruta .xls>"] [--hoja "Cobranza 2026"] [--solo-validar] [--esperado <json>]
 *
 *   --excel         por defecto ~/Downloads/FORMATO DE LO COBRADO.xls
 *   --solo-validar  lee, valida y empareja, sin escribir
 *   --esperado      cifras de control por empresa: { "GUDS": { "filas": 555, "usd": 487195.84 }, ... } (por defecto
 *                   docs/privado/22f/cobros-profit-esperado.json si existe; es privado, no va al repositorio)
 *
 * Se cargan solo las filas con fecha anterior al arranque de su empresa (empresas.odoo_arranque) y con número de recibo de
 * Profit; las que no traen número son cobros que ya están en Odoo. Validaciones antes de escribir: empresa conocida, fecha,
 * moneda BS/USD, monto > 0 y total USD = monto ÷ tipo de cambio (o = monto en USD). La carga reemplaza en una sola transacción
 * todo lo de Profit de las empresas del archivo (se puede volver a correr). El cliente se empareja por su código en las ventas
 * de Profit y, si no, por RIF o nombre (profit_parejas_clientes); la caja o cuenta, con el diario de Odoo equivalente.
 *
 * Solo contiene código: los datos (clientes, montos) quedan en la base y, si hace falta, en docs/privado/.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import XLSX from 'xlsx';
import { sql, jsonbLit } from './lib/supabase-admin.mjs';
import { ROOT } from './lib/entorno.mjs';

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const EXCEL = arg('--excel', path.join(os.homedir(), 'Downloads', 'FORMATO DE LO COBRADO.xls'));
const HOJA = arg('--hoja', 'Cobranza 2026');
const SOLO_VALIDAR = args.includes('--solo-validar');
const ESPERADO = arg('--esperado', path.join(ROOT, 'docs', 'privado', '22f', 'cobros-profit-esperado.json'));
const fallar = (m) => { console.error(`✗ ${m}`); process.exit(1); };
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

// Caja o cuenta de Profit → diario de Odoo (id del diario en Odoo) de la misma empresa. Verificado con may–sep, donde el mismo
// Excel nombra así los cobros que ya están en Odoo. Las que no tienen equivalente (tarjeta de débito, cuenta por cobrar entre
// empresas) quedan con su nombre de Profit.
const DIARIOS = {
  GUDS: { 'GS BANESCO BS': 542, 'GS MERCANTIL BS': 539, 'GS VENEZUELA BS': 543 },
  Quirutec: {
    'DMQ BANESCO BS': 535, 'DMQ MERCANTIL BS': 532, 'DMQ VENEZUELA BS': 536, 'DMQ BANESCO USA': 29, 'DMQ BANESCO PANAMA': 530,
    'DMQ CAJA PRINCIPAL USD': 30,
  },
};

// ── 1. Leer el Excel ──
if (!fs.existsSync(EXCEL)) fallar(`No existe el archivo: ${EXCEL}`);
const libro = XLSX.readFile(EXCEL, { cellDates: false });
const hoja = libro.Sheets[HOJA];
if (!hoja) fallar(`El archivo no tiene la hoja "${HOJA}" (hojas: ${libro.SheetNames.join(', ')})`);
const celdas = XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true, defval: null });
const iTitulos = celdas.findIndex((r) => r && String(r[0] ?? '').trim() === 'Empresa' && r.some((c) => String(c ?? '').trim() === 'FECHA DEL COBRO'));
if (iTitulos < 0) fallar('No se encontró la fila de títulos (Empresa · FECHA DEL COBRO · …)');
const titulos = celdas[iTitulos].map((c) => String(c ?? '').trim());
const col = (t) => { const i = titulos.indexOf(t); if (i < 0) fallar(`Falta la columna "${t}"`); return i; };
const C = {
  empresa: col('Empresa'), fecha: col('FECHA DEL COBRO'), numero: col('NUMERO'), codigo: col('CODIGO CLIENTE'), cliente: col('CLIENTE'),
  cobrador: col('COBRADOR'), neto: col('NETO'), forma: col('FORMA PAGO'), nroDoc: col('NRO DOC'), cuentaCod: col('DOC CAJA CTA'),
  cuenta: col('DESCRIPCION'), moneda: col('Moneda'), monto: col('MONTO'), tasa: col('TIPO DE CAMBIO'), usd: col('TOTAL USD'),
};

const texto = (v) => (v === null || v === undefined ? null : (String(typeof v === 'number' && Number.isInteger(v) ? v : v).trim() || null));
// Números que Excel guarda como 6200141737.0 o "134,1": texto sin ".0" y con punto decimal
const codigo = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  return String(v).trim().replace(/^(\d+),(\d+)$/, '$1.$2') || null;
};
const numero = (v) => (typeof v === 'number' ? v : v === null || v === undefined || String(v).trim() === '' ? null : Number(String(v).replace(/\./g, '').replace(',', '.')));
const fechaIso = (v) => {
  if (typeof v !== 'number') return null;
  const d = new Date(Math.round((v - 25569) * 86400000));   // serial de Excel (1900) → UTC
  return d.toISOString().slice(0, 10);
};
const normal = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ')
  .split(/\s+/).filter((w) => w && !['c', 'a', 'ca'].includes(w));

// ── 2. Empresas y arranque de Odoo ──
const empresas = await sql(`select id, nombre, nombre_corto, odoo_arranque::text arranque from empresas`);
const empresaDe = new Map();
const buscarEmpresa = (nombre) => {
  if (empresaDe.has(nombre)) return empresaDe.get(nombre);
  const p = normal(nombre).slice(0, 2).join(' ');
  const e = empresas.find((x) => normal(x.nombre).slice(0, 2).join(' ') === p) ?? null;
  empresaDe.set(nombre, e);
  return e;
};

const filas = [], errores = [];
let posteriores = 0, sinNumero = 0, sinNumeroUsd = 0;
const totalesExcel = {};   // todo lo anterior al arranque, con y sin número de Profit (las cifras de control del Excel)
const renglones = new Map();
for (let i = iTitulos + 1; i < celdas.length; i++) {
  const r = celdas[i];
  if (!r || !texto(r[C.empresa])) continue;
  const fila = i + 1;
  const e = buscarEmpresa(texto(r[C.empresa]));
  if (!e) { errores.push(`fila ${fila}: empresa desconocida "${texto(r[C.empresa])}"`); continue; }
  const fecha = fechaIso(r[C.fecha]);
  if (!fecha) { errores.push(`fila ${fila}: fecha no válida`); continue; }
  if (!e.arranque) { errores.push(`fila ${fila}: la empresa ${e.nombre_corto} no tiene fecha de arranque de Odoo (empresas.odoo_arranque)`); continue; }
  if (fecha >= e.arranque) { posteriores++; continue; }   // desde el arranque, los cobros salen de Odoo
  const nro = codigo(r[C.numero]);
  const usd = numero(r[C.usd]);
  const te = (totalesExcel[e.nombre_corto] ??= { filas: 0, usd: 0 });
  te.filas++; te.usd += usd ?? 0;
  if (!nro) { sinNumero++; sinNumeroUsd += usd ?? 0; continue; }   // sin número de Profit: el cobro ya está en Odoo
  const moneda = (texto(r[C.moneda]) ?? '').toUpperCase();
  const monto = numero(r[C.monto]), tasa = numero(r[C.tasa]);
  if (!['BS', 'USD'].includes(moneda)) { errores.push(`fila ${fila}: moneda "${moneda}"`); continue; }
  if (!(monto > 0)) { errores.push(`fila ${fila}: monto ${monto}`); continue; }
  const esperadoUsd = moneda === 'BS' ? monto / tasa : monto;
  if (!(usd > 0) || Math.abs(esperadoUsd - usd) > 0.01) errores.push(`fila ${fila}: total USD ${usd} ≠ monto ÷ tasa ${esperadoUsd?.toFixed(2)}`);
  const clave = `${e.id}|${nro}`;
  const renglon = (renglones.get(clave) ?? 0) + 1;
  renglones.set(clave, renglon);
  const cuenta = texto(r[C.cuenta]);
  filas.push({
    empresa_id: e.id, empresa: e.nombre_corto, numero: nro, renglon, fecha,
    cliente_codigo: texto(r[C.codigo]), cliente_nombre: texto(r[C.cliente]), cobrador_codigo: texto(r[C.cobrador]),
    forma_pago: texto(r[C.forma]), referencia: codigo(r[C.nroDoc]), cuenta_codigo: codigo(r[C.cuentaCod]), cuenta,
    diario_odoo: DIARIOS[e.nombre_corto]?.[cuenta] ?? null,
    moneda, monto: Math.round(monto * 100) / 100, neto_recibo: numero(r[C.neto]), tasa_origen: tasa, usd_origen: Math.round(usd * 100) / 100,
    usd_excel: usd,
  });
}
if (errores.length) fallar(`${errores.length} filas con problemas:\n  ${errores.slice(0, 20).join('\n  ')}`);
if (!filas.length) fallar('No hay cobros de Profit anteriores al arranque de Odoo en el archivo');

// ── 3. Totales de control ──
const totales = {};
for (const f of filas) {
  const t = (totales[f.empresa] ??= { filas: 0, usd: 0, usdRedondeado: 0, desde: f.fecha, hasta: f.fecha });
  t.filas++; t.usd += f.usd_excel; t.usdRedondeado += f.usd_origen;
  if (f.fecha < t.desde) t.desde = f.fecha;
  if (f.fecha > t.hasta) t.hasta = f.fecha;
}
for (const [e, t] of Object.entries(totales)) console.log(`  ${e}: ${t.filas} filas · USD ${t.usd.toFixed(2)} (según el Excel) · ${t.desde} → ${t.hasta}`);
console.log(`  Omitidas: ${posteriores} desde el arranque de Odoo · ${sinNumero} sin número de Profit (ya en Odoo, USD ${sinNumeroUsd.toFixed(2)})`);
if (fs.existsSync(ESPERADO)) {
  const esperado = JSON.parse(fs.readFileSync(ESPERADO, 'utf8'));
  for (const [e, x] of Object.entries(esperado)) {
    const t = totalesExcel[e];   // las cifras de control cuentan todas las filas anteriores al arranque
    if (!t || t.filas !== x.filas || Math.abs(t.usd - x.usd) > 0.01) fallar(`${e}: se esperaban ${x.filas} filas y USD ${x.usd} antes del arranque; hay ${t?.filas ?? 0} y USD ${t?.usd.toFixed(2) ?? 0}`);
  }
  console.log(`✓ Cuadra con ${path.relative(ROOT, ESPERADO)}`);
}
const sinDiario = [...new Set(filas.filter((f) => !f.diario_odoo).map((f) => `${f.empresa} · ${f.cuenta}`))];
if (sinDiario.length) console.log(`  Cuentas de Profit sin diario de Odoo equivalente (quedan con su nombre): ${sinDiario.join(' | ')}`);

if (SOLO_VALIDAR) { console.log('Solo validación: no se escribió en la base.'); process.exit(0); }

// ── 4. Carga: reemplaza lo de Profit de estas empresas en una sola transacción ──
const empresasArchivo = [...new Set(filas.map((f) => f.empresa_id))];
const datos = filas.map(({ empresa, usd_excel, ...f }) => f);
const [r] = await sql(`
  with x as (
    select * from jsonb_to_recordset(${jsonbLit(datos)}) as x(empresa_id uuid, numero text, renglon smallint, fecha date, cliente_codigo text,
      cliente_nombre text, cobrador_codigo text, forma_pago text, referencia text, cuenta_codigo text, cuenta text, diario_odoo int, moneda text,
      monto numeric, neto_recibo numeric, tasa_origen numeric, usd_origen numeric)
  ), clientes_profit as (
    select x.empresa_id, x.cliente_codigo, max(x.cliente_nombre) nombre from x group by 1, 2
  ), por_codigo as (
    -- el mismo código de cliente en las ventas de Profit (ya emparejadas con GUDS)
    select distinct on (v.empresa_id, v.cliente_codigo) v.empresa_id, v.cliente_codigo, v.cliente_id
    from ventas_historicas v join clientes_profit c on c.empresa_id = v.empresa_id and c.cliente_codigo = v.cliente_codigo
    where v.lote = public.profit_lote_vigente() and v.cliente_id is not null
    group by v.empresa_id, v.cliente_codigo, v.cliente_id
    order by v.empresa_id, v.cliente_codigo, count(*) desc
  ), por_rif as (
    select * from public.profit_parejas_clientes((select jsonb_agg(jsonb_build_object('empresa_id', c.empresa_id,
      'cliente_codigo', c.cliente_codigo, 'nombre', c.nombre, 'rif', c.cliente_codigo, 'facturas', '[]'::jsonb)) from clientes_profit c))
  ), cobradores as (
    select v.empresa_id, v.vendedor_codigo, max(v.vendedor_nombre) nombre from ventas_historicas v
    where v.lote = public.profit_lote_vigente() and v.vendedor_codigo is not null group by 1, 2
  ), nuevos as (
    -- inserta o actualiza por (empresa, recibo, renglón)…
    insert into cobros_historicos (empresa_id, origen, archivo, numero, renglon, fecha, cliente_codigo, cliente_nombre, cliente_id, cliente_match,
      cobrador_codigo, cobrador_nombre, forma_pago, referencia, cuenta_codigo, cuenta, banco_id, moneda, monto, neto_recibo, tasa_origen, usd_origen)
    select x.empresa_id, 'profit', ${q(path.basename(EXCEL))}, x.numero, x.renglon, x.fecha, x.cliente_codigo, x.cliente_nombre,
           coalesce(pc.cliente_id, pr.cliente_id), case when pc.cliente_id is not null then 'profit' else pr.metodo end,
           x.cobrador_codigo, initcap(cb.nombre), x.forma_pago, x.referencia, x.cuenta_codigo, x.cuenta,
           (select b.id from bancos b where b.odoo_id = x.diario_odoo and b.empresa_id = x.empresa_id),
           x.moneda, x.monto, x.neto_recibo, x.tasa_origen, x.usd_origen
    from x
    left join por_codigo pc on pc.empresa_id = x.empresa_id and pc.cliente_codigo = x.cliente_codigo
    left join por_rif pr on pr.empresa_id = x.empresa_id and pr.cliente_codigo = coalesce(x.cliente_codigo, '')
    left join cobradores cb on cb.empresa_id = x.empresa_id and cb.vendedor_codigo = x.cobrador_codigo
    on conflict (empresa_id, origen, numero, renglon) do update set archivo = excluded.archivo, cargado_at = now(), fecha = excluded.fecha,
      cliente_codigo = excluded.cliente_codigo, cliente_nombre = excluded.cliente_nombre, cliente_id = excluded.cliente_id,
      cliente_match = excluded.cliente_match, cobrador_codigo = excluded.cobrador_codigo, cobrador_nombre = excluded.cobrador_nombre,
      forma_pago = excluded.forma_pago, referencia = excluded.referencia, cuenta_codigo = excluded.cuenta_codigo, cuenta = excluded.cuenta,
      banco_id = excluded.banco_id, moneda = excluded.moneda, monto = excluded.monto, neto_recibo = excluded.neto_recibo,
      tasa_origen = excluded.tasa_origen, usd_origen = excluded.usd_origen
    returning id, cliente_id, banco_id
  ), sobrantes as (
    -- …y borra lo de Profit de estas empresas que ya no está en el archivo (todo en la misma instrucción: o entra todo o nada)
    delete from cobros_historicos c where c.origen = 'profit' and c.empresa_id = any(${q(`{${empresasArchivo.join(',')}}`)}::uuid[])
      and c.id not in (select id from nuevos) returning 1
  )
  select (select count(*) from sobrantes)::int borrados, count(*)::int cargados, count(cliente_id)::int con_cliente, count(banco_id)::int con_diario
  from nuevos`);
console.log(`✓ Cargados ${r.cargados} cobros de Profit (se quitaron ${r.borrados} que ya no están en el archivo); con cliente de GUDS: ${r.con_cliente}; con diario de Odoo: ${r.con_diario}`);

// ── 5. Comprobación: lo que quedó en la base = lo leído ──
const enBase = await sql(`select e.nombre_corto empresa, count(*)::int filas, round(sum(c.usd_origen), 2)::float usd
  from cobros_historicos c join empresas e on e.id = c.empresa_id where c.origen = 'profit' group by 1`);
for (const b of enBase) {
  const t = totales[b.empresa];
  const ok = t && t.filas === b.filas && Math.abs(t.usdRedondeado - b.usd) < 0.005;
  console.log(`${ok ? '✓' : '✗'} ${b.empresa}: ${b.filas} filas · USD ${b.usd} en la base`);
  if (!ok) process.exitCode = 1;
}
