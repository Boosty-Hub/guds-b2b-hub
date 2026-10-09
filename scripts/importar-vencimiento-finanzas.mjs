/**
 * Carga inicial de la fase 22g (R3 de docs/PLAN-REPORTES-FINANZAS.md) desde el Excel de finanzas "FORMATO - Análisis de
 * Vencimiento" (corte 30-abr-2026):
 *
 *   1. Gestión de cobranza (T5): las cuentas que finanzas marca "Incobrable" (casos con abogados) en la hoja "Matriz".
 *      Cada fila se busca en GUDS por empresa, tipo y número del documento. Si todos los documentos del cliente en el Excel
 *      son incobrables y el cliente no tiene documentos posteriores al corte, se marca el cliente; si no, se marcan solo esos
 *      documentos (excepciones). No se tocan las marcas que ya existan (p. ej. las cambiadas a mano en GUDS).
 *   2. Notas de entrega no fiscales (NE1): las de la hoja "P Matriz" (Quirutec), serie HIST. Si el monto del Excel es una
 *      fórmula con abonos restados ("=3024,2-500-400"), se carga el total y los abonos sin fecha, para que el saldo cuadre.
 *      El cliente se empareja por nombre con los clientes de Quirutec en GUDS (solo si hay uno); si no, queda con su nombre
 *      (no se crean clientes: crear un cliente lo crea en Odoo).
 *
 *   node scripts/importar-vencimiento-finanzas.mjs [--excel "<ruta .xlsx>"] [--solo-validar]
 *
 *   --excel         por defecto ~/Downloads/FORMATO - Analisis de Vencimiento.xlsx
 *   --solo-validar  lee, valida y empareja, sin escribir
 *
 * Se puede volver a correr: las notas de entrega se actualizan por número (las de origen Excel) y las marcas de cobranza solo
 * se agregan si no existen. Solo contiene código: los datos quedan en la base y el resumen en docs/privado/22g/ (fuera de git).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import XLSX from 'xlsx';
import { sql, jsonbLit } from './lib/supabase-admin.mjs';
import { ROOT } from './lib/entorno.mjs';

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const EXCEL = arg('--excel', path.join(os.homedir(), 'Downloads', 'FORMATO - Analisis de Vencimiento.xlsx'));
const SOLO_VALIDAR = args.includes('--solo-validar');
const CORTE_EXCEL = '2026-04-30';
const NOTA_INCOBRABLE = 'Excel de finanzas "Análisis de vencimiento" al 30/04/2026: cuenta incobrable (casos con abogados)';
const fallar = (m) => { console.error(`✗ ${m}`); process.exit(1); };
const texto = (v) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());
const sinTildes = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const fechaIso = (v) => {
  if (typeof v === 'number') { const d = XLSX.SSF.parse_date_code(v); return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`; }
  const m = String(v ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : null;
};
const empresaDe = (nombre) => (/QUIRUTEC/i.test(nombre) ? 'Quirutec' : /GUDS/i.test(nombre) ? 'GUDS' : null);

// ── 1. Leer el Excel ──
if (!fs.existsSync(EXCEL)) fallar(`No existe el archivo: ${EXCEL}`);
const libro = XLSX.readFile(EXCEL, { cellDates: false, cellFormula: true });
for (const h of ['Matriz', 'P Matriz']) if (!libro.Sheets[h]) fallar(`El archivo no tiene la hoja "${h}" (hojas: ${libro.SheetNames.join(', ')})`);

const filasDe = (hoja) => XLSX.utils.sheet_to_json(libro.Sheets[hoja], { header: 1, raw: true, defval: null });
const columnas = (titulos, req) => Object.fromEntries(Object.entries(req).map(([k, prueba]) => {
  const i = titulos.findIndex((t) => prueba(sinTildes(texto(t)).toLowerCase()));
  if (i < 0) fallar(`Falta la columna "${k}"`);
  return [k, i];
}));

// Matriz: un documento por fila
const matriz = filasDe('Matriz');
const CM = columnas(matriz[0], {
  empresa: (t) => t === 'empresa', tipo: (t) => t === 'tipo', numero: (t) => t === 'numero',
  deuda: (t) => t === 'deuda total usd', clasif: (t) => t.startsWith('clasificacion de la deuda'), emision: (t) => t === 'emision',
});
const docs = [];
for (const r of matriz.slice(1)) {
  if (!r || !texto(r[CM.empresa])) continue;
  const emp = empresaDe(texto(r[CM.empresa]));
  if (!emp) fallar(`Empresa desconocida en Matriz: ${texto(r[CM.empresa])}`);
  const tipo = { FACT: 'factura', 'N/DB': 'nota_debito', 'N/CR': 'nota_credito' }[texto(r[CM.tipo])] ?? null;
  docs.push({ empresa: emp, tipo, tipo_excel: texto(r[CM.tipo]), numero: texto(r[CM.numero]).replace(/^0+(?=\d)/, ''),
    emision: fechaIso(r[CM.emision]), deuda: Number(r[CM.deuda] ?? 0), incobrable: /incobrable/i.test(texto(r[CM.clasif])) });
}
if (!docs.length) fallar('La hoja Matriz no trae documentos');

// P Matriz: las notas de entrega (con la fórmula del monto, si la tiene)
const hojaNE = libro.Sheets['P Matriz'];
const pm = filasDe('P Matriz');
const CN = columnas(pm[0], {
  tipo: (t) => t.startsWith('tipo de doc'), numero: (t) => t.startsWith('numero de'), fecha: (t) => t.startsWith('fecha de'),
  cliente: (t) => t === 'cliente', monto: (t) => t.startsWith('base imponible'), vendedor: (t) => t === 'vendedor',
  obs: (t) => t.startsWith('observacion'), clasif: (t) => t.startsWith('clasificacion de la deuda'),
});
const notas = [];
pm.slice(1).forEach((r, i) => {
  if (!r || !texto(r[CN.numero])) return;
  if (texto(r[CN.tipo]).toUpperCase() !== 'N/E') fallar(`P Matriz fila ${i + 2}: tipo "${texto(r[CN.tipo])}" (se esperaba N/E)`);
  const fecha = fechaIso(r[CN.fecha]);
  if (!fecha) fallar(`P Matriz fila ${i + 2}: fecha no válida`);
  const valor = Number(r[CN.monto]);
  if (!(valor > 0)) fallar(`P Matriz fila ${i + 2}: monto no válido`);
  // ¿Monto con abonos restados en fórmula? "3024.2-500-400" → total 3024,2 y abonos 500 y 400
  const celda = hojaNE[XLSX.utils.encode_cell({ r: i + 1, c: CN.monto })];
  const f = celda?.f ? String(celda.f).replace(/\s+/g, '') : null;
  let total = valor, abonos = [];
  const m = f?.match(/^=?(\d+(?:\.\d+)?)((?:-\d+(?:\.\d+)?)+)$/);
  if (m) {
    total = Number(m[1]);
    abonos = m[2].split('-').filter(Boolean).map(Number);
    if (Math.abs(total - abonos.reduce((s, a) => s + a, 0) - valor) > 0.005) fallar(`P Matriz fila ${i + 2}: la fórmula no da el monto`);
  } else if (f && !/^=?\d+(\.\d+)?$/.test(f)) {
    fallar(`P Matriz fila ${i + 2}: fórmula no reconocida (${f})`);
  }
  notas.push({ numero: texto(r[CN.numero]), fecha, cliente: texto(r[CN.cliente]), vendedor: texto(r[CN.vendedor]) || null,
    observacion: texto(r[CN.obs]) || null, clasificacion: /incobrable/i.test(texto(r[CN.clasif])) ? 'incobrable' : 'activa',
    total: Math.round(total * 100) / 100, abonos, saldo: Math.round(valor * 100) / 100 });
});
if (!notas.length) fallar('La hoja P Matriz no trae notas de entrega');
if (new Set(notas.map((n) => n.numero)).size !== notas.length) fallar('P Matriz: hay números de nota repetidos');

const inc = docs.filter((d) => d.incobrable);
console.log(`Excel: ${docs.length} documentos en Matriz (${inc.length} incobrables, USD ${inc.reduce((s, d) => s + d.deuda, 0).toFixed(2)}) · ${notas.length} notas de entrega (USD ${notas.reduce((s, n) => s + n.saldo, 0).toFixed(2)})`);

// ── 2. Emparejar con GUDS ──
const empresas = Object.fromEntries((await sql(`select nombre_corto, id from empresas`)).map((e) => [e.nombre_corto, e.id]));
for (const e of ['GUDS', 'Quirutec']) if (!empresas[e]) fallar(`No existe la empresa ${e} en GUDS`);

// Documentos de la Matriz → documento y cliente de GUDS (por empresa, tipo y número)
const pares = await sql(`
  with x as (select * from jsonb_to_recordset(${jsonbLit(docs.filter((d) => d.tipo).map((d, i) => ({ i, empresa_id: empresas[d.empresa], tipo: d.tipo, numero: d.numero })))})
               as x(i int, empresa_id uuid, tipo text, numero text))
  select x.i, f.id factura_id, f.cliente_id,
         exists (select 1 from facturas g where g.cliente_id = f.cliente_id and g.estado = 'posted' and g.fecha_emision > date '${CORTE_EXCEL}') posteriores
    from x
    join lateral (select f.id, f.cliente_id from facturas f
                   where f.empresa_id = x.empresa_id and f.estado = 'posted' and f.numero = x.numero
                     and (case when f.tipo = 'nota_credito' then 'nota_credito' when coalesce(f.es_nota_debito, false) then 'nota_debito' else 'factura' end) = x.tipo
                   order by f.fecha_emision limit 1) f on true`);
const conTipo = docs.filter((d) => d.tipo);
for (const p of pares) Object.assign(conTipo[p.i], { factura_id: p.factura_id, cliente_id: p.cliente_id, posteriores: p.posteriores });
const porCliente = new Map();
for (const d of conTipo.filter((x) => x.cliente_id)) {
  const c = porCliente.get(d.cliente_id) ?? { empresa: d.empresa, docs: [], posteriores: d.posteriores };
  c.docs.push(d);
  porCliente.set(d.cliente_id, c);
}
const marcasCliente = [], marcasDocumento = [];
for (const [cliente_id, c] of porCliente) {
  const malos = c.docs.filter((d) => d.incobrable);
  if (!malos.length) continue;
  if (malos.length === c.docs.length && !c.posteriores) marcasCliente.push({ cliente_id, empresa_id: empresas[c.empresa], docs: malos.length, usd: malos.reduce((s, d) => s + d.deuda, 0) });
  else for (const d of malos) marcasDocumento.push({ cliente_id, empresa_id: empresas[c.empresa], factura_id: d.factura_id, usd: d.deuda });
}
const incSinGuds = inc.filter((d) => !d.factura_id);
console.log(`Incobrables: ${marcasCliente.length} clientes completos (${marcasCliente.reduce((s, c) => s + c.docs, 0)} documentos) + ${marcasDocumento.length} documentos sueltos; ${incSinGuds.length} no están en GUDS (USD ${incSinGuds.reduce((s, d) => s + d.deuda, 0).toFixed(2)})`);

// Notas de entrega → cliente de Quirutec por nombre (sin tildes, sin signos; solo si hay uno)
const clientesNE = await sql(`
  with x as (select * from jsonb_to_recordset(${jsonbLit(notas.map((n) => ({ numero: n.numero, cliente: n.cliente })))}) as x(numero text, cliente text)),
  c as (select c.id, regexp_replace(public.clasif_norm(c.nombre_negocio), '[^a-z0-9]+', '', 'g') k from clientes c where c.empresa_id = '${empresas.Quirutec}')
  select x.numero, (select case when count(*) = 1 then min(c.id::text) end from c where c.k = regexp_replace(public.clasif_norm(x.cliente), '[^a-z0-9]+', '', 'g')) cliente_id
    from x`);
const clienteNE = new Map(clientesNE.map((r) => [r.numero, r.cliente_id]));
notas.forEach((n) => { n.cliente_id = clienteNE.get(n.numero) ?? null; });
const nombresNE = new Set(notas.map((n) => n.cliente)), nombresCon = new Set(notas.filter((n) => n.cliente_id).map((n) => n.cliente));
console.log(`Notas de entrega: ${nombresNE.size} clientes, ${nombresCon.size} con ficha en GUDS; ${notas.filter((n) => n.abonos.length).length} con abonos en fórmula`);

const resumen = {
  archivo: path.basename(EXCEL), corte: CORTE_EXCEL,
  matriz: { documentos: docs.length, incobrables: inc.length, incobrables_usd: Math.round(inc.reduce((s, d) => s + d.deuda, 0) * 100) / 100 },
  marcas_cliente: marcasCliente.length, marcas_documento: marcasDocumento.length, incobrables_sin_guds: incSinGuds.length,
  notas: notas.length, notas_saldo: Math.round(notas.reduce((s, n) => s + n.saldo, 0) * 100) / 100,
  notas_activas: Math.round(notas.filter((n) => n.clasificacion === 'activa').reduce((s, n) => s + n.saldo, 0) * 100) / 100,
  notas_incobrables: Math.round(notas.filter((n) => n.clasificacion === 'incobrable').reduce((s, n) => s + n.saldo, 0) * 100) / 100,
  notas_clientes: nombresNE.size, notas_clientes_guds: nombresCon.size,
};
const dirPriv = path.join(ROOT, 'docs', 'privado', '22g');
fs.mkdirSync(dirPriv, { recursive: true });
// Para las pruebas (scripts/probar-22g-antiguedad.mjs): los documentos de la Matriz y las notas, tal como los trae el Excel
fs.writeFileSync(path.join(dirPriv, 'vencimiento-matriz.json'), JSON.stringify({ corte: CORTE_EXCEL,
  documentos: docs.map(({ empresa, tipo_excel, numero, emision, deuda, incobrable }) => ({ empresa, tipo: tipo_excel, numero, emision, deuda, incobrable })),
  notas: notas.map(({ numero, total, saldo, abonos, clasificacion }) => ({ numero, total, saldo, abonos, clasificacion })) }));
fs.writeFileSync(path.join(dirPriv, 'vencimiento-carga.json'), JSON.stringify({ resumen,
  incobrables_sin_guds: incSinGuds.map((d) => ({ empresa: d.empresa, tipo: d.tipo_excel, numero: d.numero, deuda: d.deuda })) }, null, 1));
if (SOLO_VALIDAR) { console.log('Solo validar: no se escribió nada.', resumen); process.exit(0); }

// ── 3. Escribir (una transacción) ──
const marcas = [...marcasCliente.map((m) => ({ ...m, factura_id: null })), ...marcasDocumento];
const filasNE = notas.map((n) => ({ empresa_id: empresas.Quirutec, numero: n.numero, cliente_id: n.cliente_id, cliente_nombre: n.cliente,
  vendedor_nombre: n.vendedor, fecha: n.fecha, total: n.total, estado: n.abonos.length ? 'abonada' : 'emitida', clasificacion: n.clasificacion,
  observacion: n.observacion, abonos: n.abonos }));
const r = await sql(`
  begin;
  with m as (select * from jsonb_to_recordset(${jsonbLit(marcas)}) as m(cliente_id uuid, empresa_id uuid, factura_id uuid))
  insert into cobranza_gestion (empresa_id, cliente_id, factura_id, clasificacion, nota, desde, origen)
  select m.empresa_id, m.cliente_id, m.factura_id, 'incobrable', ${`'${NOTA_INCOBRABLE.replace(/'/g, "''")}'`}, date '${CORTE_EXCEL}', 'excel'
    from m
   where not exists (select 1 from cobranza_gestion g where g.cliente_id = m.cliente_id and g.factura_id is not distinct from m.factura_id);

  with n as (select * from jsonb_to_recordset(${jsonbLit(filasNE)}) as n(empresa_id uuid, numero text, cliente_id uuid, cliente_nombre text,
               vendedor_nombre text, fecha date, total numeric, estado text, clasificacion text, observacion text, abonos jsonb))
  insert into notas_entrega (empresa_id, serie, numero, cliente_id, cliente_nombre, vendedor_nombre, fecha_emision, fecha_vencimiento, moneda,
                             total_usd, estado, clasificacion, observacion, origen, archivo)
  select n.empresa_id, 'HIST', n.numero, n.cliente_id, n.cliente_nombre, n.vendedor_nombre, n.fecha, n.fecha, 'USD', n.total, n.estado,
         n.clasificacion, n.observacion, 'excel', ${`'${path.basename(EXCEL).replace(/'/g, "''")}'`}
    from n
  on conflict (empresa_id, serie, numero) do update
    set cliente_id = excluded.cliente_id, cliente_nombre = excluded.cliente_nombre, vendedor_nombre = excluded.vendedor_nombre,
        fecha_emision = excluded.fecha_emision, fecha_vencimiento = excluded.fecha_vencimiento, total_usd = excluded.total_usd,
        estado = excluded.estado, clasificacion = excluded.clasificacion, observacion = excluded.observacion, archivo = excluded.archivo,
        updated_at = now()
    -- 22j: las que ya se trabajan en GUDS (abonos, conversión, anulación) no se pisan con el Excel
    where notas_entrega.origen = 'excel' and notas_entrega.estado <> 'anulada'
      and not exists (select 1 from nota_entrega_movimientos g where g.nota_id = notas_entrega.id and g.origen = 'guds');

  delete from nota_entrega_movimientos m using notas_entrega n
   where n.id = m.nota_id and n.empresa_id = '${empresas.Quirutec}' and n.serie = 'HIST' and m.origen = 'excel'
     and not exists (select 1 from nota_entrega_movimientos g where g.nota_id = n.id and g.origen = 'guds');
  with n as (select * from jsonb_to_recordset(${jsonbLit(filasNE.filter((x) => x.abonos.length))}) as n(empresa_id uuid, numero text, abonos jsonb))
  insert into nota_entrega_movimientos (nota_id, empresa_id, tipo, fecha, monto_usd, nota, origen)
  select e.id, e.empresa_id, 'abono', null, a.v::numeric, 'Abono restado en el Excel de finanzas (sin fecha)', 'excel'
    from n join notas_entrega e on e.empresa_id = n.empresa_id and e.serie = 'HIST' and e.numero = n.numero
    cross join lateral jsonb_array_elements_text(n.abonos) a(v)
   where not exists (select 1 from nota_entrega_movimientos x where x.nota_id = e.id and x.origen = 'excel');
  select public.ne_recalcular_estado(id) from notas_entrega where empresa_id = '${empresas.Quirutec}' and serie = 'HIST';
  commit;
  select (select count(*) from cobranza_gestion where origen = 'excel') marcas,
         (select count(*) from notas_entrega where serie = 'HIST') notas,
         (select round(sum(saldo_usd), 2) from v_notas_entrega where serie = 'HIST') saldo`);
console.log('✓ Cargado:', r[0]);
