import type { Workbook, Worksheet } from "exceljs";

// Descarga en Excel con formato (R0 del plan de reportes, fase 22c): un libro con una o varias hojas, cada una con su
// encabezado (título combinado y líneas de contexto: empresa, cliente, corte o período), fila de títulos con autofiltro y
// paneles inmovilizados, números con formato real (USD, Bs, tasa, enteros, porcentaje), fechas reales (no texto), anchos
// de columna y una fila de totales en negrita. exceljs (~250 KB gzip) se descarga solo al pedir el primer Excel.
//
//   await descargarExcel({
//     archivo: nombreArchivoExcel("estado de cuenta", "GUDS", cliente, corte),
//     hojas: [{
//       nombre: "Estado de cuenta",
//       encabezado: ["GUDS SUPPLY, C.A.", "RIF: J-41015443-8", "Cliente: …", "Estado de cuenta actualizado al 30/09/2026"],
//       columnas: [
//         { titulo: "Emisión", valor: (d) => d.emision, tipo: "fecha" },
//         { titulo: "Total US$", valor: (d) => d.total, tipo: "usd", ancho: 14 },   // los usd/bs/entero se suman en el total
//         { titulo: "Tasa", valor: (d) => d.tasa, tipo: "tasa", total: false },
//       ],
//       filas: docs,
//       totales: "Totales",
//     }],
//   });

export type TipoColumnaExcel = "usd" | "bs" | "fecha" | "entero" | "pct" | "texto" | "tasa" | "numero";
type Valor = string | number | Date | boolean | null | undefined;

export interface ColumnaExcel<T> {
  titulo: string;
  valor: (fila: T, indice: number) => Valor;
  /** usd · bs · numero (2 decimales) · tasa (4 decimales) · entero · pct (fracción: 0,25 = 25 %) · fecha ('AAAA-MM-DD' o Date) · texto (por defecto). */
  tipo?: TipoColumnaExcel;
  /** Ancho en caracteres; sin él se calcula con el contenido (entre 8 y 60). */
  ancho?: number;
  /** En la fila de totales: false = vacía; una función = su valor; por defecto se suman las columnas usd, bs, numero y entero. */
  total?: boolean | ((filas: T[]) => Valor);
  /** Ajustar el texto en varias líneas (comentarios largos). */
  ajustar?: boolean;
}

export interface HojaExcel<T = unknown> {
  /** Nombre de la pestaña (se recorta a 31 caracteres y se quitan los caracteres que Excel no admite). */
  nombre: string;
  /** Líneas sobre la tabla: la primera es el título (combinado y en negrita); las demás, contexto. */
  encabezado?: string[];
  columnas: ColumnaExcel<T>[];
  filas: T[];
  /** true o el texto de la etiqueta ("Totales"): fila de totales en negrita al final. */
  totales?: boolean | string;
  /** Líneas de notas debajo de la tabla. */
  notas?: string[];
  /** Autofiltro en la fila de títulos (por defecto sí). */
  autofiltro?: boolean;
}

export interface LibroExcel {
  /** Nombre del archivo (con o sin .xlsx). Ver nombreArchivoExcel(). */
  archivo: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  hojas: HojaExcel<any>[];
  /** Autor del archivo (propiedades del documento). */
  autor?: string;
}

const FORMATO: Record<TipoColumnaExcel, string | undefined> = {
  usd: '"$"#,##0.00;-"$"#,##0.00',
  bs: '"Bs "#,##0.00;-"Bs "#,##0.00',
  numero: "#,##0.00;-#,##0.00",
  tasa: "#,##0.0000",
  entero: "#,##0;-#,##0",
  pct: "0.0%",
  fecha: "dd/mm/yyyy",
  texto: undefined,
};
const SUMABLES: TipoColumnaExcel[] = ["usd", "bs", "numero", "entero"];
const AZUL = "FF002060"; // el azul de los títulos del Excel de finanzas
const BORDE = { style: "thin" as const, color: { argb: "FFBFC5D2" } };

let carga: Promise<typeof import("exceljs")> | null = null;
/** Descarga exceljs una sola vez (también sirve para precargar al pasar el ratón por el botón). */
export const cargarExcelJs = () => {
  carga ??= import("exceljs").then((m) => ((m as unknown as { default?: typeof m }).default ?? m)).catch((e) => { carga = null; throw e; });
  return carga;
};
export const precargarExcel = () => { cargarExcelJs().catch(() => { /* se reintenta al pulsar */ }); };

/** 'AAAA-MM-DD' (o un instante) → Date a medianoche UTC, que Excel muestra como ese mismo día en cualquier zona. */
const aFechaExcel = (v: Valor): Date | null => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
  if (typeof v !== "string" || !v) return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
};

const celda = (v: Valor, tipo: TipoColumnaExcel): string | number | Date | boolean | null => {
  if (v === null || v === undefined || v === "") return null;
  if (tipo === "fecha") return aFechaExcel(v);
  if (tipo === "texto") return typeof v === "string" ? v : v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(v);
  return Number.isFinite(n) ? n : typeof v === "string" ? v : null;
};

/** Texto que ocupa una celda (para calcular el ancho). */
const largo = (v: unknown, tipo: TipoColumnaExcel): number => {
  if (v === null || v === undefined) return 0;
  if (tipo === "fecha") return 10;
  if (typeof v === "number") return (tipo === "tasa" ? v.toFixed(4) : v.toLocaleString("en-US", { maximumFractionDigits: 2 })).length + (tipo === "usd" ? 2 : tipo === "bs" ? 4 : 1);
  return String(v).split("\n").reduce((m, l) => Math.max(m, l.length), 0);
};

const nombreHoja = (s: string, usados: Set<string>) => {
  const base = s.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || "Hoja";
  let n = base;
  for (let i = 2; usados.has(n.toLowerCase()); i++) n = `${base.slice(0, 28)} ${i}`;
  usados.add(n.toLowerCase());
  return n;
};

function armarHoja<T>(ws: Worksheet, h: HojaExcel<T>) {
  const cols = h.columnas;
  const nCols = Math.max(cols.length, 1);
  let fila = 1;

  // Encabezado: título combinado y líneas de contexto
  (h.encabezado ?? []).forEach((linea, i) => {
    const r = ws.getRow(fila);
    r.getCell(1).value = linea;
    r.getCell(1).font = i === 0 ? { bold: true, size: 13 } : { bold: i === (h.encabezado?.length ?? 0) - 1, size: 11 };
    if (nCols > 1) ws.mergeCells(fila, 1, fila, Math.min(nCols, 8));
    fila++;
  });
  if (h.encabezado?.length) fila++;

  // Títulos
  const filaTitulos = fila;
  const rt = ws.getRow(filaTitulos);
  cols.forEach((c, i) => {
    const x = rt.getCell(i + 1);
    x.value = c.titulo;
    x.font = { bold: true, color: { argb: "FFFFFFFF" } };
    x.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL } };
    x.alignment = { vertical: "middle", horizontal: ["texto", "fecha"].includes(c.tipo ?? "texto") ? "left" : "right", wrapText: true };
    x.border = { top: BORDE, bottom: BORDE, left: BORDE, right: BORDE };
  });
  rt.height = 30;
  fila++;

  // Datos
  const anchos = cols.map((c) => Math.max(8, Math.min(28, c.titulo.length + 2)));
  h.filas.forEach((f, i) => {
    const r = ws.getRow(fila);
    cols.forEach((c, j) => {
      const tipo = c.tipo ?? "texto";
      const v = celda(c.valor(f, i), tipo);
      const x = r.getCell(j + 1);
      x.value = v;
      const fmt = FORMATO[tipo];
      if (fmt) x.numFmt = fmt;
      if (c.ajustar) x.alignment = { wrapText: true, vertical: "top" };
      anchos[j] = Math.max(anchos[j], Math.min(60, largo(v, tipo) + 2));
    });
    fila++;
  });

  // Totales
  if (h.totales) {
    const r = ws.getRow(fila);
    const etiqueta = typeof h.totales === "string" ? h.totales : "Totales";
    let puesta = false;
    cols.forEach((c, j) => {
      const tipo = c.tipo ?? "texto";
      let v: Valor = null;
      if (typeof c.total === "function") v = c.total(h.filas);
      else if (c.total !== false && SUMABLES.includes(tipo)) {
        v = h.filas.reduce<number>((s, f, i) => {
          const n = Number(c.valor(f, i));
          return s + (Number.isFinite(n) ? n : 0);
        }, 0);
        if (tipo !== "entero") v = Math.round((v as number) * 100) / 100;
      }
      const x = r.getCell(j + 1);
      if (v !== null && v !== undefined && v !== "") {
        x.value = celda(v, tipo);
        const fmt = FORMATO[tipo];
        if (fmt) x.numFmt = fmt;
      }
      x.font = { bold: true };
      x.border = { top: { style: "medium", color: { argb: AZUL } } };
      x.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F3F8" } };
    });
    // La etiqueta va en la primera columna vacía de la fila
    for (let j = 0; j < cols.length && !puesta; j++) {
      const x = r.getCell(j + 1);
      if (x.value === null || x.value === undefined) { x.value = etiqueta; puesta = true; }
    }
    fila++;
  }

  // Notas
  if (h.notas?.length) {
    fila++;
    for (const n of h.notas) {
      const x = ws.getRow(fila).getCell(1);
      x.value = n;
      x.font = { italic: true, size: 9, color: { argb: "FF6B7280" } };
      fila++;
    }
  }

  cols.forEach((c, j) => { ws.getColumn(j + 1).width = c.ancho ?? anchos[j]; });
  if (h.autofiltro !== false && h.filas.length > 0) {
    ws.autoFilter = { from: { row: filaTitulos, column: 1 }, to: { row: filaTitulos + h.filas.length, column: nCols } };
  }
  ws.views = [{ state: "frozen", ySplit: filaTitulos, xSplit: 0 }];
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
}

/** Arma el libro y devuelve el archivo (Blob) sin descargarlo. */
export async function generarExcel(libro: LibroExcel): Promise<{ blob: Blob; nombre: string; libro: Workbook }> {
  const ExcelJS = await cargarExcelJs();
  const wb = new ExcelJS.Workbook();
  wb.creator = libro.autor ?? "GUDS";
  wb.created = new Date();
  const usados = new Set<string>();
  for (const h of libro.hojas) armarHoja(wb.addWorksheet(nombreHoja(h.nombre, usados)), h);
  const buf = await wb.xlsx.writeBuffer();
  const nombre = libro.archivo.toLowerCase().endsWith(".xlsx") ? libro.archivo : `${libro.archivo}.xlsx`;
  return { blob: new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), nombre, libro: wb };
}

/** Genera y descarga el Excel. Devuelve el nombre del archivo. */
export async function descargarExcel(libro: LibroExcel): Promise<string> {
  const { blob, nombre } = await generarExcel(libro);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return nombre;
}

/** Nombre de archivo sin acentos ni caracteres raros: nombreArchivoExcel("estado de cuenta", "GUDS", "Cliente, C.A.", "2026-09-30")
 *  → "estado-de-cuenta-guds-cliente-c-a-2026-09-30.xlsx". Las partes vacías se omiten. */
export const nombreArchivoExcel = (...partes: (string | null | undefined)[]) => {
  const limpio = partes
    .filter((p): p is string => !!p && !!p.trim())
    .map((p) => p.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/g, ""))
    .filter(Boolean)
    .join("-");
  return `${limpio || "reporte"}.xlsx`;
};
