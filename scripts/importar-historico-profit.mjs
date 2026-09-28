/**
 * Importa el histórico de ventas de Profit Plus (el ERP anterior) a ventas_historicas (Fase 20g · R1).
 *
 * Fuente: el Excel "Reporte de Venta Consolidado" que se alimenta de Profit (vista Vista_Ventas_2K8). La caché de sus tablas
 * dinámicas guarda TODAS las líneas de venta (dic-2020 → may-2026), aunque la hoja visible solo tenga 2025–2026. El script lee
 * esa caché directamente del .xlsx (sin Excel ni dependencias: ZIP con node:zlib y XML con expresiones regulares).
 *
 *   node scripts/importar-historico-profit.mjs [--excel "<ruta .xlsx>"] [--solo-validar] [--esperado <json>] [--lote 2000]
 *
 *   --excel         ruta del Excel (por defecto ~/Downloads/Reporte de Venta Consolidado (Boosty).xlsx)
 *   --solo-validar  extrae y valida, sin escribir en la base
 *   --esperado      JSON con cifras de control por empresa y mes: { "<empresa>|<año>|<mes>": { "filas": <n>, "neto": <usd> }, ... }
 *                   (por defecto docs/privado/profit/esperado-profit.json si existe; nunca en el repositorio: es privado)
 *
 * Validaciones antes de escribir:
 *   1. Cada fila de la caché: Base de Ventas = exento + base imponible en USD.
 *   2. Contra la hoja "Base datos" del mismo Excel (2025–2026): mismas filas, unidades y venta por empresa y mes, al centavo.
 *   3. Contra --esperado, si existe.
 * Carga (idempotente, por lote): empareja clientes y productos con GUDS (funciones de la base), abre un lote nuevo,
 * lo inserta por partes y lo publica en una transacción corta (profit_publicar_carga: clasifica notas y reversos, lo marca
 * vigente y propone vendedores); luego borra el lote anterior. Los reportes solo leen el lote vigente: una carga a medias
 * no se ve y la siguiente la limpia. Al final compara lo que quedó en la base con lo extraído, por empresa y mes.
 *
 * Solo contiene código: los datos (clientes, montos) quedan en la base y, si hace falta, en docs/privado/.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { ROOT } from './lib/entorno.mjs';

// ── Argumentos ──
const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const EXCEL = arg('--excel', path.join(os.homedir(), 'Downloads', 'Reporte de Venta Consolidado (Boosty).xlsx'));
const SOLO_VALIDAR = args.includes('--solo-validar');
const ESPERADO = arg('--esperado', path.join(ROOT, 'docs', 'privado', 'profit', 'esperado-profit.json'));
const LOTE = Number(arg('--lote', 2000));

const t0 = Date.now();
const log = (...m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...m);
const fallar = (m) => { console.error(`✗ ${m}`); process.exit(1); };

// ── ZIP mínimo (central directory + inflateRaw) ──
function abrirZip(ruta) {
  const buf = fs.readFileSync(ruta);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) fallar('El archivo no es un .xlsx válido (no se encontró el directorio del ZIP)');
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entradas = new Map();
  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) fallar('Directorio del ZIP dañado');
    const metodo = buf.readUInt16LE(p + 10), comp = buf.readUInt32LE(p + 20);
    const ln = buf.readUInt16LE(p + 28), lx = buf.readUInt16LE(p + 30), lc = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    entradas.set(buf.toString('utf8', p + 46, p + 46 + ln), { metodo, comp, local });
    p += 46 + ln + lx + lc;
  }
  return {
    nombres: [...entradas.keys()],
    leer(nombre) {
      const e = entradas.get(nombre);
      if (!e) return null;
      const ini = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
      const datos = buf.subarray(ini, ini + e.comp);
      return (e.metodo === 0 ? datos : zlib.inflateRawSync(datos)).toString('utf8');
    },
  };
}

// ── XML ──
const desescapar = (s) => (s.indexOf('&') < 0 ? s : s.replace(/&(amp|lt|gt|quot|apos|#x[0-9a-f]+|#\d+);/gi, (_, e) => {
  const l = e.toLowerCase();
  if (l === 'amp') return '&'; if (l === 'lt') return '<'; if (l === 'gt') return '>'; if (l === 'quot') return '"'; if (l === 'apos') return "'";
  return String.fromCodePoint(l.startsWith('#x') ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10));
}));
const atributo = (tag, n) => { const m = tag.match(new RegExp(`\\b${n}="([^"]*)"`)); return m ? desescapar(m[1]) : null; };
const clave = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// ── 1. Caché de las tablas dinámicas ──
if (!fs.existsSync(EXCEL)) fallar(`No existe el Excel: ${EXCEL}`);
log(`Leyendo ${path.basename(EXCEL)} (${(fs.statSync(EXCEL).size / 1e6).toFixed(1)} MB)`);
const zip = abrirZip(EXCEL);

function leerDefinicion(nombre) {
  const xml = zip.leer(nombre);
  const raiz = xml.match(/<pivotCacheDefinition\b[^>]*>/)[0];
  const campos = [];
  const reCampo = /<cacheField\b([^>]*?)(\/>|>([\s\S]*?)<\/cacheField>)/g;
  let m;
  while ((m = reCampo.exec(xml))) {
    if (/\bformula="/.test(m[1])) continue;                  // campos calculados: no están en los registros
    const items = [];
    const si = (m[3] || '').match(/<sharedItems\b[^>]*?(?:\/>|>([\s\S]*?)<\/sharedItems>)/);
    if (si && si[1]) {
      const reItem = /<([snbdem])(?=[\s/>])([^>]*?)\/?>/g;
      let it;
      while ((it = reItem.exec(si[1]))) items.push(it[1] === 'm' ? null : atributo(it[2], 'v'));
    }
    campos.push({ nombre: atributo(`<x ${m[1]}>`, 'name'), items });
  }
  const rels = zip.leer(nombre.replace('pivotCache/', 'pivotCache/_rels/') + '.rels') || '';
  const registros = (rels.match(/Target="([^"]*pivotCacheRecords\d+\.xml)"/) || [])[1];
  return {
    nombre, campos, registros: registros ? 'xl/pivotCache/' + path.posix.basename(registros) : null,
    total: Number(atributo(raiz, 'recordCount') || 0),
    actualizada: atributo(raiz, 'refreshedDate'), por: atributo(raiz, 'refreshedBy'),
  };
}

const definiciones = zip.nombres.filter((n) => /^xl\/pivotCache\/pivotCacheDefinition\d+\.xml$/.test(n)).map(leerDefinicion)
  .filter((d) => d.registros && ['empresa', 'base de ventas', 'numero documento'].every((c) => d.campos.some((f) => clave(f.nombre) === c)))
  .sort((a, b) => b.total - a.total);
if (!definiciones.length) fallar('No se encontró la caché de ventas de Profit en el Excel');
const cache = definiciones[0];
const fechaExcel = (serial) => (serial ? new Date(Math.round((Number(serial) - 25569) * 86400000)).toISOString().slice(0, 16).replace('T', ' ') : null);
const cacheActualizada = `${fechaExcel(cache.actualizada) ?? '—'} (${cache.por ?? '—'})`;
log(`Caché ${path.posix.basename(cache.nombre)}: ${cache.total} registros, ${cache.campos.length} campos, actualizada ${cacheActualizada}`);

const idx = Object.fromEntries(cache.campos.map((c, i) => [clave(c.nombre), i]));
const col = (n) => { const i = idx[clave(n)]; if (i === undefined) fallar(`La caché no tiene el campo "${n}"`); return i; };
const C = {
  empresa: col('Empresa'), fecha: col('Fecha de Emisión'), vence: col('Fecha de Vencimiento'), tipo: col('Tipo'),
  numero: col('Numero Documento'), numOrigen: col('Numero Origen'), docOrigen: col('Documento Origen'),
  vendCod: col('Código del vendedor'), vendNom: col('Nombre Vendedor'), moneda: col('Moneda'), tasa: col('Tasa de Venta'),
  cliCod: col('Código de Cliente'), cliNom: col('Nombre o Razón Social'), tipoCli: col('Tipo de Cliente'), canal: col('Canal de Ventas'),
  segmento: col('Segmento'), artCod: col('Código del Articulo'), artDesc: col('Descripcion Articulo'), linea: col('Línea del Articulo'),
  sublinea: col('Sub-Línea del Articulo'), marca: col('Marca/Presentación'), categoria: col('Categoria del Articulo'),
  cantidad: col('Cantidad (Unidad Primaria)'), precioBs: col('Precio Unitario Bolivares'), precioUsd: col('Precio Unitario Dolares'),
  presentacion: col('Presentación (Primaria)'), descRen: col('% Descuento Renglón'), descGlo: col('% Descuento Global'),
  descBs: col('Monto del Descuento Bolivares'), exentoBs: col('Exento Producto Bolivares'), baseBs: col('Base Imponible Producto Bolivares'),
  ivaBs: col('I.V.A. Producto Bolivares'), totalBs: col('Total Producto Bolivares'), descUsd: col('Monto del Descuento USD'),
  exentoUsd: col('Exento Producto USD'), baseUsd: col('Base Imponible Producto USD'), ivaUsd: col('I.V.A. Producto USD'),
  totalUsd: col('Total Producto USD'), anulado: col('Anulado'), ultCosto: col('Ultimo Costo USD (Referencia)'),
  estatus: col('Estatus Cobro'), dias: col('Dias de Credito'), condicion: col('Condicion de Pago'), lista: col('Lista de Precios'),
  baseVentas: col('Base de Ventas'), costo: col('Costo por Unidad'),
};

// Registros: <r> con un hijo por campo (x = índice en sharedItems; n/s/d/b/e = valor; m = vacío)
const xmlReg = zip.leer(cache.registros);
const registros = [];
{
  const re = /<r>|<\/r>|<([xnsdbem])\b([^>]*?)\/>/g;
  let m, fila = null;
  while ((m = re.exec(xmlReg))) {
    if (m[0] === '<r>') { fila = []; continue; }
    if (m[0] === '</r>') { registros.push(fila); fila = null; continue; }
    if (!fila) continue;
    const campo = cache.campos[fila.length];
    if (!campo) fallar('Un registro de la caché tiene más valores que campos');
    const v = m[1] === 'm' ? null : atributo(m[2], 'v');
    fila.push(m[1] === 'x' ? campo.items[Number(v)] ?? null : v);
  }
}
if (registros.length !== cache.total) fallar(`Se leyeron ${registros.length} registros y la caché declara ${cache.total}`);
log(`Registros leídos: ${registros.length}`);

// ── 2. Transformación ──
const texto = (v) => { if (v === null || v === undefined) return null; const s = String(v).replace(/\s+/g, ' ').trim(); return s === '' ? null : s; };
const numero = (v) => { if (v === null || v === undefined || String(v).trim() === '') return null; const n = Number(v); if (!Number.isFinite(n)) throw new Error(`Número no válido: ${v}`); return Number(n.toFixed(6)); };
const entero = (v) => { const n = numero(v); return n === null ? null : Math.round(n); };
const fecha = (v) => { const s = texto(v); if (!s) return null; if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10); return fechaExcel(s)?.slice(0, 10) ?? null; };
const numDoc = (v) => { const s = texto(v); if (!s) return null; return /^\d+(\.0+)?$/.test(s) ? String(Number(s)) : s; };
const TIPOS = [[/^factura$/, 'factura'], [/^devoluci/, 'devolucion'], [/^nota de cr/, 'nota_credito'], [/^nota de d/, 'nota_debito']];
const tipoDoc = (v) => { const k = clave(v); const t = TIPOS.find(([re]) => re.test(k)); return t ? t[1] : null; };
const esRif = (s) => !!s && /^[JVGEPC]-?\d{6,9}-?\d?$/i.test(s);

const { sql, jsonbLit, lotes } = await import('./lib/supabase-admin.mjs');
const nombresEmpresa = [...new Set(registros.map((r) => texto(r[C.empresa])).filter(Boolean))];
const mapaEmpresas = Object.fromEntries((await sql(`select x.nombre, e.id, e.nombre_corto from unnest(${`array[${nombresEmpresa.map((n) => `'${n.replace(/'/g, "''")}'`).join(',')}]`}::text[]) x(nombre)
  left join empresas e on public.normalizar_nombre_empresa(e.nombre) = public.normalizar_nombre_empresa(x.nombre)`)).map((r) => [r.nombre, r]));

const omitidas = { sin_empresa_en_guds: {}, vacias: 0, anuladas: 0 };
const filas = [];
const renglones = new Map(), documentos = new Map();
for (const r of registros) {
  const emp = texto(r[C.empresa]);
  if (!emp) { omitidas.vacias++; continue; }
  const e = mapaEmpresas[emp];
  if (!e?.id) { omitidas.sin_empresa_en_guds[emp] = (omitidas.sin_empresa_en_guds[emp] || 0) + 1; continue; }   // PRUEBAS
  if (clave(r[C.anulado]) === 'si') { omitidas.anuladas++; continue; }
  const tipo = tipoDoc(r[C.tipo]);
  if (!tipo) fallar(`Tipo de documento desconocido: "${r[C.tipo]}"`);
  const num = numDoc(r[C.numero]);
  if (!num) fallar(`Línea sin número de documento (${emp}, ${r[C.fecha]})`);
  const kDoc = `${e.id}|${tipo}|${num}`;
  const renglon = (renglones.get(kDoc) || 0) + 1;
  renglones.set(kDoc, renglon);
  if (!documentos.has(kDoc)) documentos.set(kDoc, documentos.size + 1);
  const cliCod = texto(r[C.cliCod])?.toUpperCase() ?? null;
  const exento = numero(r[C.exentoUsd]) ?? 0, base = numero(r[C.baseUsd]) ?? 0, neto = numero(r[C.baseVentas]) ?? 0;
  if (Math.abs(neto - exento - base) > 0.005) fallar(`Base de Ventas ≠ exento + base imponible en ${emp} ${tipo} ${num}`);
  const numOrigen = numDoc(r[C.numOrigen]);
  filas.push({
    empresa_id: e.id, _empresa: e.nombre_corto, documento: documentos.get(kDoc), tipo, numero: num, renglon, fecha: fecha(r[C.fecha]), fecha_vencimiento: fecha(r[C.vence]),
    documento_origen: texto(r[C.docOrigen]), numero_origen: numOrigen === '0' ? null : numOrigen,
    vendedor_codigo: texto(r[C.vendCod])?.toUpperCase() ?? null, vendedor_nombre: texto(r[C.vendNom])?.toUpperCase() ?? null,
    cliente_codigo: cliCod, cliente_nombre: texto(r[C.cliNom]), cliente_rif: esRif(cliCod) ? cliCod.replace(/[^A-Z0-9]/g, '') : null,
    tipo_cliente: texto(r[C.tipoCli]), canal: texto(r[C.canal]), segmento: texto(r[C.segmento]),
    articulo_codigo: texto(r[C.artCod])?.toUpperCase() ?? null, articulo_descripcion: texto(r[C.artDesc]),
    categoria: texto(r[C.categoria]), linea: texto(r[C.linea]), sublinea: texto(r[C.sublinea]), marca: texto(r[C.marca]),
    presentacion: texto(r[C.presentacion]), moneda: texto(r[C.moneda]), tasa_venta: numero(r[C.tasa]),
    cantidad: numero(r[C.cantidad]) ?? 0, precio_usd: numero(r[C.precioUsd]), precio_bs: numero(r[C.precioBs]),
    descuento_renglon_pct: numero(r[C.descRen]), descuento_global_pct: numero(r[C.descGlo]), descuento_usd: numero(r[C.descUsd]),
    descuento_bs: numero(r[C.descBs]), exento_usd: exento, base_imponible_usd: base, iva_usd: numero(r[C.ivaUsd]), total_usd: numero(r[C.totalUsd]),
    exento_bs: numero(r[C.exentoBs]), base_imponible_bs: numero(r[C.baseBs]), iva_bs: numero(r[C.ivaBs]), total_bs: numero(r[C.totalBs]),
    neto_usd: neto, ultimo_costo_usd: numero(r[C.ultCosto]), costo_usd: numero(r[C.costo]),
    estatus_cobro: texto(r[C.estatus]), dias_credito: entero(r[C.dias]), condicion_pago: texto(r[C.condicion]), lista_precios: texto(r[C.lista]),
  });
}
if (filas.some((f) => !f.fecha)) fallar('Hay líneas sin fecha de emisión');
log(`Líneas a importar: ${filas.length} · omitidas: ${JSON.stringify(omitidas)}`);

// Agregado por empresa y mes (para las validaciones)
const redondear = (n) => Math.round(n * 100) / 100;
function agregar(lista) {
  const m = new Map();
  for (const f of lista) {
    const k = `${f.empresa}|${Number(f.anio)}|${Number(f.mes)}`;
    const a = m.get(k) || { filas: 0, neto: 0, cantidad: 0 };
    a.filas += Number(f.filas ?? 1); a.neto += Number(f.neto); a.cantidad += Number(f.cantidad);
    m.set(k, a);
  }
  return m;
}
const extraido = agregar(filas.map((f) => ({ empresa: f._empresa, anio: f.fecha.slice(0, 4), mes: f.fecha.slice(5, 7), neto: f.neto_usd, cantidad: f.cantidad })));
function comparar(titulo, a, b, { soloClavesDe = null, conCantidad = true } = {}) {
  const claves = [...new Set([...(soloClavesDe ? soloClavesDe.keys() : [...a.keys(), ...b.keys()])])].sort();
  const dif = [];
  for (const k of claves) {
    const x = a.get(k) || { filas: 0, neto: 0, cantidad: 0 }, y = b.get(k) || { filas: 0, neto: 0, cantidad: 0 };
    if (x.filas !== y.filas || Math.abs(x.neto - y.neto) > 0.005 || (conCantidad && Math.abs(x.cantidad - y.cantidad) > 0.005)) {
      dif.push({ mes: k, filas: `${x.filas} vs ${y.filas}`, neto: `${redondear(x.neto)} vs ${redondear(y.neto)}`, ...(conCantidad ? { und: `${redondear(x.cantidad)} vs ${redondear(y.cantidad)}` } : {}) });
    }
  }
  if (dif.length) { console.table(dif.slice(0, 30)); fallar(`${titulo}: ${dif.length} de ${claves.length} meses no cuadran`); }
  log(`✓ ${titulo}: ${claves.length} meses por empresa cuadran (filas, venta${conCantidad ? ' y unidades' : ''})`);
}

// ── 3. Validación contra la hoja "Base datos" (misma consulta de Profit, 2025–2026) ──
{
  const wb = zip.leer('xl/workbook.xml'), wbRels = zip.leer('xl/_rels/workbook.xml.rels');
  const hoja = [...wb.matchAll(/<sheet\b[^>]*\/>/g)].map((m) => m[0]).find((s) => clave(atributo(s, 'name')) === 'base datos');
  const rid = hoja && (atributo(hoja, 'r:id'));
  const destino = rid && (wbRels.match(new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*>`)) || [])[0];
  if (!destino) {
    console.warn('⚠ El Excel no tiene la hoja "Base datos": se omite la validación contra la hoja');
  } else {
    const ss = zip.leer('xl/sharedStrings.xml') || '';
    const cadenas = [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => desescapar([...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
    const xml = zip.leer('xl/' + atributo(destino, 'Target').replace(/^\/?xl\//, ''));
    const valor = (atrs, cuerpo) => {
      if (!cuerpo) return null;
      const t = atributo(`<c ${atrs}>`, 't');
      if (t === 'inlineStr') return desescapar([...cuerpo.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
      const v = (cuerpo.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      if (v === undefined) return null;
      return t === 's' ? cadenas[Number(v)] : desescapar(v);
    };
    const reFila = /<row\b[^>]*>([\s\S]*?)<\/row>/g, reCelda = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let m, encabezado = null;
    const filasHoja = [];
    while ((m = reFila.exec(xml))) {
      const celdas = {};
      let c;
      reCelda.lastIndex = 0;
      while ((c = reCelda.exec(m[1]))) celdas[(atributo(`<c ${c[1]}>`, 'r') || '').replace(/\d+/g, '')] = valor(c[1], c[2]);
      if (!encabezado) { encabezado = Object.fromEntries(Object.entries(celdas).map(([l, v]) => [clave(v), l])); continue; }
      filasHoja.push(celdas);
    }
    const L = (n) => { const l = encabezado[clave(n)]; if (!l) fallar(`La hoja "Base datos" no tiene la columna "${n}"`); return l; };
    const [lEmp, lMes, lAnio, lCant, lBase] = [L('Empresa'), L('Mes'), L('Año'), L('Cantidad (Unidad Primaria)'), L('Base de Ventas')];
    const hojaAgr = agregar(filasHoja.filter((f) => mapaEmpresas[texto(f[lEmp])]?.id).map((f) => ({
      empresa: mapaEmpresas[texto(f[lEmp])].nombre_corto, anio: f[lAnio], mes: f[lMes], neto: Number(f[lBase] || 0), cantidad: Number(f[lCant] || 0),
    })));
    log(`Hoja "Base datos": ${filasHoja.length} filas`);
    comparar('Caché vs hoja "Base datos"', extraido, hojaAgr, { soloClavesDe: hojaAgr });
  }
}

// ── 4. Validación contra las cifras de control (--esperado) ──
if (fs.existsSync(ESPERADO)) {
  const esp = JSON.parse(fs.readFileSync(ESPERADO, 'utf8'));
  const m = new Map(Object.entries(esp).map(([k, v]) => [k, { filas: Number(v.filas), neto: Number(v.neto), cantidad: 0 }]));
  comparar(`Caché vs cifras de control (${path.basename(ESPERADO)})`, extraido, m, { conCantidad: false });
} else {
  log(`(sin cifras de control: ${path.relative(ROOT, ESPERADO)} no existe)`);
}

// Resumen por año y empresa
const porAnio = new Map();
for (const [k, v] of extraido) {
  const [emp, anio] = k.split('|');
  const a = porAnio.get(`${emp}|${anio}`) || { empresa: emp, anio: Number(anio), filas: 0, neto: 0 };
  a.filas += v.filas; a.neto += v.neto; porAnio.set(`${emp}|${anio}`, a);
}
console.table([...porAnio.values()].sort((a, b) => a.empresa.localeCompare(b.empresa) || a.anio - b.anio).map((a) => ({ ...a, neto: redondear(a.neto) })));

if (SOLO_VALIDAR) { log('Solo validación: no se escribió en la base.'); process.exit(0); }

// ── 5. Carga por lote ──
// 5a. Emparejamiento con GUDS (reglas en la base: profit_parejas_clientes / profit_parejas_productos)
const clientesProfit = new Map(), articulosProfit = new Map();
for (const f of filas) {
  const kc = `${f.empresa_id}|${f.cliente_codigo ?? ''}`;
  const c = clientesProfit.get(kc) || { empresa_id: f.empresa_id, cliente_codigo: f.cliente_codigo ?? '', nombre: null, rif: null, facturas: new Set() };
  if (f.cliente_nombre && (!c.nombre || f.cliente_nombre > c.nombre)) c.nombre = f.cliente_nombre;
  if (f.cliente_rif && (!c.rif || f.cliente_rif > c.rif)) c.rif = f.cliente_rif;
  if (f.tipo === 'factura') c.facturas.add(f.numero);
  clientesProfit.set(kc, c);
  if (f.articulo_codigo) articulosProfit.set(`${f.empresa_id}|${f.articulo_codigo}`, { empresa_id: f.empresa_id, articulo_codigo: f.articulo_codigo });
}
const parejaCliente = new Map((await sql(`select * from public.profit_parejas_clientes(${jsonbLit([...clientesProfit.values()].map((c) => ({ ...c, facturas: [...c.facturas] })))})`))
  .map((r) => [`${r.empresa_id}|${r.cliente_codigo}`, r]));
const parejaProducto = new Map((await sql(`select * from public.profit_parejas_productos(${jsonbLit([...articulosProfit.values()])})`))
  .map((r) => [`${r.empresa_id}|${r.articulo_codigo}`, r.producto_id]));
for (const f of filas) {
  const pc = parejaCliente.get(`${f.empresa_id}|${f.cliente_codigo ?? ''}`);
  f.cliente_id = pc?.cliente_id ?? null;
  f.cliente_match = pc?.metodo ?? null;
  f.producto_id = f.articulo_codigo ? parejaProducto.get(`${f.empresa_id}|${f.articulo_codigo}`) ?? null : null;
}
log(`Emparejados: ${[...parejaCliente.values()].filter((r) => r.cliente_id).length}/${clientesProfit.size} clientes, `
  + `${[...parejaProducto.values()].filter(Boolean).length}/${articulosProfit.size} artículos`);

// 5b. Lote nuevo: se inserta por partes y solo se publica si llegó completo
const COLS = [
  ['empresa_id', 'uuid'], ['documento', 'int'], ['tipo', 'text'], ['numero', 'text'], ['renglon', 'int'], ['fecha', 'date'], ['fecha_vencimiento', 'date'],
  ['documento_origen', 'text'], ['numero_origen', 'text'], ['vendedor_codigo', 'text'], ['vendedor_nombre', 'text'],
  ['cliente_codigo', 'text'], ['cliente_nombre', 'text'], ['cliente_rif', 'text'], ['cliente_id', 'uuid'], ['cliente_match', 'text'],
  ['tipo_cliente', 'text'], ['canal', 'text'], ['segmento', 'text'],
  ['articulo_codigo', 'text'], ['articulo_descripcion', 'text'], ['producto_id', 'uuid'], ['categoria', 'text'], ['linea', 'text'],
  ['sublinea', 'text'], ['marca', 'text'],
  ['presentacion', 'text'], ['moneda', 'text'], ['tasa_venta', 'numeric'], ['cantidad', 'numeric'], ['precio_usd', 'numeric'], ['precio_bs', 'numeric'],
  ['descuento_renglon_pct', 'numeric'], ['descuento_global_pct', 'numeric'], ['descuento_usd', 'numeric'], ['descuento_bs', 'numeric'],
  ['exento_usd', 'numeric'], ['base_imponible_usd', 'numeric'], ['iva_usd', 'numeric'], ['total_usd', 'numeric'], ['exento_bs', 'numeric'],
  ['base_imponible_bs', 'numeric'], ['iva_bs', 'numeric'], ['total_bs', 'numeric'], ['neto_usd', 'numeric'], ['ultimo_costo_usd', 'numeric'],
  ['costo_usd', 'numeric'], ['estatus_cobro', 'text'], ['dias_credito', 'int'], ['condicion_pago', 'text'], ['lista_precios', 'text'],
];
const lista = COLS.map(([c]) => c).join(', ');
const definicion = COLS.map(([c, t]) => `${c} ${t}`).join(', ');
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

// Borra por tandas las líneas de los lotes que no son el vigente ni `conservar` (lotes fallidos o reemplazados)
async function limpiarLotes(conservar) {
  let total = 0;
  for (;;) {
    const [{ n }] = await sql(`with x as (select id from public.ventas_historicas
        where lote is distinct from public.profit_lote_vigente() and lote <> ${Number(conservar) || 0} limit 20000),
      b as (delete from public.ventas_historicas v using x where v.id = x.id returning 1) select count(*)::int n from b`);
    total += n;
    if (n === 0) return total;
  }
}

const [{ lote }] = await sql(`select public.profit_iniciar_carga(${q(path.basename(EXCEL))}, ${q(cacheActualizada)}, ${jsonbLit(omitidas)}) lote`);
const limpiadas = await limpiarLotes(lote);
log(`Lote ${lote} abierto${limpiadas ? ` (se borraron ${limpiadas} líneas de cargas incompletas)` : ''}`);
const partes = lotes(filas, LOTE);
for (let i = 0; i < partes.length; i++) {
  const datos = partes[i].map((f) => Object.fromEntries(COLS.map(([c]) => [c, f[c]])));
  await sql(`insert into public.ventas_historicas (lote, ${lista}) select ${lote}, ${lista} from jsonb_to_recordset(${jsonbLit(datos)}) as x(${definicion})`);
  if ((i + 1) % 10 === 0 || i === partes.length - 1) log(`Lote ${lote}: parte ${i + 1}/${partes.length}`);
}

// 5c. Publicar (clasifica notas y reversos, pasa a vigente, propone vendedores) y borrar el lote anterior
// La publicación puede tardar más de lo que el proxy de la API mantiene abierta la conexión: si se corta, la base sigue
// trabajando y se espera a que el lote pase a "vigente" (o a que la consulta termine sin publicarlo).
async function publicar() {
  try {
    const [{ r }] = await sql(`set statement_timeout = '15min'; select public.profit_publicar_carga(${lote}, ${filas.length}) r`);
    return r;
  } catch (e) {
    if (!/fetch failed|other side closed|socket|ECONNRESET|UND_ERR|50[234]|52[0-9]/i.test(String(e.message) + String(e.cause?.message ?? ''))) throw e;
    log('Se cortó la conexión con la API mientras se publicaba; esperando a que la base termine…');
    for (let i = 0; i < 90; i++) {
      await new Promise((res) => setTimeout(res, 10000));
      const [c] = await sql(`select estado, resultado, exists (select 1 from pg_stat_activity where state = 'active'
        and query ilike '%profit_publicar_carga(${lote},%' and pid <> pg_backend_pid()) corriendo from public.profit_cargas where id = ${lote}`);
      if (c?.estado === 'vigente') return c.resultado;
      if (!c?.corriendo) fallar(`La publicación del lote ${lote} no terminó (estado ${c?.estado}); vuelve a ejecutar el script`);
    }
    fallar(`La publicación del lote ${lote} sigue en curso después de 15 minutos`);
  }
}
const publicado = await publicar();
log('Publicado:', JSON.stringify(publicado));
const borradas = await limpiarLotes(lote);
if (borradas) log(`Lote anterior borrado: ${borradas} líneas`);

// ── 6. Verificación en la base ──
const enBase = agregar(await sql(`select e.nombre_corto empresa, extract(year from v.fecha)::int anio, extract(month from v.fecha)::int mes,
  count(*)::int filas, sum(v.neto_usd) neto, sum(v.cantidad) cantidad from public.ventas_historicas v join public.empresas e on e.id = v.empresa_id
  where v.lote = ${lote} group by 1, 2, 3`));
comparar('Base vs extraído', enBase, extraido);
const [{ n: total }] = await sql('select count(*)::int n from public.ventas_historicas');
if (total !== filas.length) fallar(`La tabla tiene ${total} líneas y el lote ${filas.length}`);

const resumen = await sql(`select e.nombre_corto empresa, extract(year from v.fecha)::int anio, count(*)::int lineas,
  round(sum(v.neto_usd), 2) excel_usd,
  round(coalesce(sum(v.neto_usd) filter (where tratamiento = 'venta'), 0), 2) venta_neta,
  round(coalesce(sum(v.neto_usd) filter (where tratamiento = 'financiera'), 0), 2) financieras,
  round(coalesce(sum(v.neto_usd) filter (where tratamiento = 'reverso'), 0), 2) reversos,
  round(coalesce(sum(v.neto_usd) filter (where tratamiento = 'nd_cambiaria'), 0), 2) nd_cambiarias
  from public.ventas_historicas v join public.empresas e on e.id = v.empresa_id where v.lote = ${lote} group by 1, 2 order by 1, 2`);
console.table(resumen);
const [emp] = await sql(`with c as (select empresa_id, cliente_codigo, bool_or(cliente_id is not null) ok, sum(neto_usd) filter (where tratamiento = 'venta') neto
    from public.ventas_historicas where lote = ${lote} group by 1, 2),
  p as (select empresa_id, articulo_codigo, bool_or(producto_id is not null) ok, sum(neto_usd) filter (where tratamiento = 'venta') neto
    from public.ventas_historicas where lote = ${lote} and articulo_codigo is not null group by 1, 2)
  select (select count(*) filter (where ok) || '/' || count(*) from c) clientes,
         (select round(100 * sum(neto) filter (where ok) / nullif(sum(neto), 0), 1) from c) clientes_pct_monto,
         (select count(*) filter (where ok) || '/' || count(*) from p) productos,
         (select round(100 * sum(neto) filter (where ok) / nullif(sum(neto), 0), 1) from p) productos_pct_monto,
         (select count(*) filter (where estado = 'propuesto') || ' propuestos, ' || count(*) filter (where estado = 'sin_pareja') || ' sin pareja, '
            || count(*) filter (where estado = 'validado') || ' validados' from public.profit_vendedores) vendedores`);
log('Emparejamiento:', JSON.stringify(emp));
log('✓ Histórico de Profit cargado');
