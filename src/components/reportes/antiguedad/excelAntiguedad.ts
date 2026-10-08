import { nombreArchivoExcel, type ColumnaExcel, type HojaExcel, type LibroExcel } from "@/lib/excel";
import { fechaDMA, hoyCaracas } from "@/lib/fechas";
import {
  CLASIFICACION, PARTIDA, TIPO_DOC, agrupar, etiquetaTramo, indicadores, pct, tramosDe,
  type Agrupar, type Base, type DatosAntiguedad, type Fila, type Grupo, type Tramo,
} from "./datos";

// Excel de la Antigüedad (22g · R3) con las secciones del "Análisis de vencimiento" de finanzas: Resumen · Por año ·
// Año × vendedor · Tramos (cliente × tramo) · Top 10 · Por tipo de cliente · Por categoría · Cliente × año · 61–90 y +90 ·
// Incobrables · Notas de entrega · Detalle · Parámetros. En «Ambas», cada hoja lleva la columna Empresa.

export interface DatosLibroAntiguedad {
  datos: DatosAntiguedad;
  filas: Fila[];
  base: Base;
  clasif: "todas" | "activa" | "incobrable";
  /** "GUDS", "Quirutec" o "GUDS y Quirutec" */
  empresas: string;
  ambas: boolean;
}

type FilaGrupo = Grupo & { empresaHoja: string };
const r2 = (v: number) => Math.round(v * 100) / 100;

export function libroAntiguedad(d: DatosLibroAntiguedad): LibroExcel {
  const { datos, filas, base, ambas } = d;
  const tramos = tramosDe(base);
  const anios = [...new Set(filas.map((f) => f.anio))].sort();
  const textoBase = base === "vencimiento" ? "días desde el vencimiento" : "días desde la emisión";
  const textoClasif = d.clasif === "todas" ? "deuda activa e incobrable" : d.clasif === "activa" ? "solo deuda activa" : "solo incobrable";
  const encabezado = (titulo: string) => [
    titulo, `Empresas: ${d.empresas}`, `Saldos al ${fechaDMA(datos.corte)} · ${textoBase} · ${textoClasif}${datos.ne ? " · incluye notas de entrega (no fiscal)" : ""}`,
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hojas: HojaExcel<any>[] = [];
  const agregar = <T,>(h: HojaExcel<T>) => { hojas.push(h); };
  const empresasDe = (fs: Fila[]) => (ambas ? [...new Set(fs.map((f) => f.empresa))].sort() : [""]);

  /** Grupos × columnas; en «Ambas», por empresa (columna Empresa). */
  const grupos = (fs: Fila[], por: Agrupar, col: (f: Fila) => string): FilaGrupo[] =>
    empresasDe(fs).flatMap((e) => agrupar(ambas ? fs.filter((f) => f.empresa === e) : fs, por, col).map((g) => ({ ...g, empresaHoja: e })));
  const totalDe = (gs: FilaGrupo[]) => gs.reduce((s, g) => s + g.total, 0);

  /** Hoja "grupo × columnas" con Total, % del total y % vencido. */
  const hojaMatriz = (nombre: string, titulo: string, por: Agrupar, fs: Fila[], cols: string[], col: (f: Fila) => string,
    etiquetaCol: (k: string) => string, tituloGrupo: string, extra: ColumnaExcel<FilaGrupo>[] = [], limite?: number) => {
    let gs = grupos(fs, por, col);
    if (limite) gs = empresasDe(fs).flatMap((e) => gs.filter((g) => g.empresaHoja === e && g.total > 0.009).slice(0, limite));
    const total = totalDe(gs);
    agregar<FilaGrupo>({
      nombre, encabezado: encabezado(titulo), totales: "Total",
      columnas: [
        ...(ambas ? [{ titulo: "Empresa", valor: (g: FilaGrupo) => g.empresaHoja, ancho: 11 }] : []),
        { titulo: tituloGrupo, valor: (g) => g.etiqueta, ancho: por === "cliente" ? 40 : 30 },
        ...extra,
        ...cols.map((k): ColumnaExcel<FilaGrupo> => ({ titulo: etiquetaCol(k), valor: (g) => (g.columnas[k] ? r2(g.columnas[k]) : null), tipo: "usd", ancho: 14 })),
        { titulo: "Total", valor: (g) => r2(g.total), tipo: "usd", ancho: 15 },
        { titulo: "% del total", valor: (g) => pct(g.total, total), tipo: "pct", total: false, ancho: 10 },
        { titulo: "% vencido", valor: (g) => pct(g.vencido, g.deuda), tipo: "pct", ancho: 10,
          total: (gg) => pct(gg.reduce((s, g) => s + g.vencido, 0), gg.reduce((s, g) => s + g.deuda, 0)) },
      ],
      filas: gs,
    });
  };
  const colCliente: ColumnaExcel<FilaGrupo>[] = [
    { titulo: "RIF", valor: (g) => g.detalle ?? "" },
    { titulo: "Clasificación", valor: (g) => { const c = datos.clientes[g.clave]; return c?.cl ? CLASIFICACION[c.cl] : CLASIFICACION.activa; }, ancho: 13 },
  ];

  // 1. Resumen: una columna por empresa y el total
  const emps = ambas ? empresasDe(filas) : [d.empresas];
  const ind = emps.map((e) => indicadores(ambas ? filas.filter((f) => f.empresa === e) : filas));
  const indTotal = indicadores(filas);
  const conceptos: [string, (i: ReturnType<typeof indicadores>) => number | null, "usd" | "pct" | "entero"][] = [
    ["Deuda (facturas y notas de débito)", (i) => i.deuda, "usd"],
    ["Notas de crédito a favor", (i) => -i.nc, "usd"],
    ["Anticipos sin aplicar", (i) => -i.anticipos, "usd"],
    ["Deuda neta (fiscal)", (i) => i.fiscalNeto, "usd"],
    ...(datos.ne ? [["Notas de entrega (no fiscal)", (i: ReturnType<typeof indicadores>) => i.ne, "usd"] as [string, (i: ReturnType<typeof indicadores>) => number, "usd"],
      ["Deuda neta con notas de entrega", (i: ReturnType<typeof indicadores>) => i.neto, "usd"] as [string, (i: ReturnType<typeof indicadores>) => number, "usd"]] : []),
    ["Vencida", (i) => i.vencido, "usd"],
    ["% vencido", (i) => pct(i.vencido, i.positivos), "pct"],
    ["Más de 90 días", (i) => i.mas90, "usd"],
    ["Incobrable", (i) => i.incobrable, "usd"],
    ["Clientes con deuda", (i) => i.clientes, "entero"],
  ];
  type FilaResumen = { concepto: string; valores: (number | null)[]; total: number | null; tipo: "usd" | "pct" | "entero" };
  agregar<FilaResumen>({
    nombre: "Resumen", encabezado: encabezado("Antigüedad de la cuenta por cobrar · resumen"), autofiltro: false,
    columnas: [
      { titulo: "Concepto", valor: (f) => f.concepto, ancho: 38 },
      ...emps.map((e, i): ColumnaExcel<FilaResumen> => ({ titulo: e, valor: (f) => f.valores[i], tipo: "numero", ancho: 18 })),
      ...(ambas ? [{ titulo: "Total", valor: (f: FilaResumen) => f.total, tipo: "numero" as const, ancho: 18 }] : []),
    ],
    filas: conceptos.map(([concepto, fn, tipo]) => ({ concepto, valores: ind.map((i) => { const v = fn(i); return v == null ? null : tipo === "pct" ? Math.round(v * 1000) / 10 : r2(v); }),
      total: (() => { const v = fn(indTotal); return v == null ? null : tipo === "pct" ? Math.round(v * 1000) / 10 : r2(v); })(), tipo })),
    notas: ["Los montos van en USD; \"% vencido\" en por ciento. Las notas de crédito y los anticipos restan (van en negativo)."],
  });
  // 2. Por año de emisión × tramos
  hojaMatriz("Por año", "Cuenta por cobrar por año de emisión y tramo", "anio", filas, tramos, (f) => f.tramo, (k) => etiquetaTramo(k as Tramo, base), "Año de emisión");
  // 3. Año × vendedor
  hojaMatriz("Año x vendedor", "Cuenta por cobrar por vendedor y año de emisión", "vendedor", filas, anios, (f) => f.anio, (k) => k, "Vendedor");
  // 4. Tramos: cliente × tramo
  hojaMatriz("Tramos", "Cuenta por cobrar por cliente y tramo de días", "cliente", filas, tramos, (f) => f.tramo, (k) => etiquetaTramo(k as Tramo, base), "Cliente", colCliente);
  // 5. Top 10
  hojaMatriz("Top 10", "Los 10 clientes con mayor deuda, por año de emisión", "cliente", filas, anios, (f) => f.anio, (k) => k, "Cliente", colCliente, 10);
  // 6 y 7. Tipo de cliente y categoría de cobranza
  hojaMatriz("Por tipo de cliente", "Cuenta por cobrar por tipo de cliente y año de emisión", "tipo", filas, anios, (f) => f.anio, (k) => k, "Tipo de cliente");
  hojaMatriz("Por categoría", "Cuenta por cobrar por categoría de cobranza y año de emisión", "categoria", filas, anios, (f) => f.anio, (k) => k, "Categoría de cobranza");
  // 8. Por tipo de partida
  hojaMatriz("Por tipo de partida", "Cuenta por cobrar por tipo de partida y tramo", "partida", filas, tramos, (f) => f.tramo, (k) => etiquetaTramo(k as Tramo, base), "Tipo de partida");
  // 9. Cliente × año
  hojaMatriz("Cliente x año", "Cuenta por cobrar por cliente y año de emisión", "cliente", filas, anios, (f) => f.anio, (k) => k, "Cliente", colCliente);
  // 10. 61–90 y más de 90 (detalle)
  const columnasDetalle: ColumnaExcel<Fila>[] = [
    ...(ambas ? [{ titulo: "Empresa", valor: (f: Fila) => f.empresa, ancho: 11 }] : []),
    { titulo: "Cliente", valor: (f) => f.cliente, ancho: 38 },
    { titulo: "RIF", valor: (f) => f.rif },
    { titulo: "Código", valor: (f) => (f.p.c ? datos.clientes[f.p.c]?.cod ?? "" : "") },
    { titulo: "Tipo de cliente", valor: (f) => f.tipoCliente, ancho: 18 },
    { titulo: "Categoría de cobranza", valor: (f) => f.categoria, ancho: 18 },
    { titulo: "Vendedor", valor: (f) => f.vendedor, ancho: 22 },
    { titulo: "Vendedor del cliente", valor: (f) => f.vendedorCliente, ancho: 22 },
    { titulo: "Tipo de partida", valor: (f) => PARTIDA[f.partida].texto, ancho: 22 },
    { titulo: "Documento", valor: (f) => TIPO_DOC[f.p.t], ancho: 15 },
    { titulo: "Número", valor: (f) => f.p.n },
    { titulo: "Emisión", valor: (f) => f.p.em, tipo: "fecha" },
    { titulo: "Vencimiento", valor: (f) => f.p.ve, tipo: "fecha" },
    { titulo: "Año", valor: (f) => Number(f.anio), tipo: "entero", total: false },
    { titulo: "Días", valor: (f) => f.dias, tipo: "entero", total: false },
    { titulo: "Tramo", valor: (f) => etiquetaTramo(f.tramo, base), ancho: 14 },
    { titulo: "Moneda", valor: (f) => (f.p.m === "USD" ? "USD" : "Bs"), ancho: 8 },
    { titulo: "Total USD", valor: (f) => Number(f.p.tot), tipo: "usd" },
    { titulo: "Saldo USD", valor: (f) => f.saldo, tipo: "usd" },
    { titulo: "Clasificación", valor: (f) => CLASIFICACION[f.p.cl], ancho: 13 },
    { titulo: "Qué falta", valor: (f) => f.p.f ?? "", ancho: 34 },
    { titulo: "Responsable (cobranza)", valor: (f) => (f.p.c ? datos.clientes[f.p.c]?.resp ?? "" : ""), ancho: 22 },
    { titulo: "Último estado de cuenta enviado", valor: (f) => (f.p.c ? datos.clientes[f.p.c]?.edc ?? null : null), tipo: "fecha" },
  ];
  const ordenDetalle = (fs: Fila[]) => [...fs].sort((a, b) => a.empresa.localeCompare(b.empresa) || a.cliente.localeCompare(b.cliente) || a.p.em.localeCompare(b.p.em));
  agregar<Fila>({
    nombre: "61-90 y +90", encabezado: encabezado(`Partidas con más de 60 ${textoBase}`), totales: "Totales",
    columnas: columnasDetalle, filas: ordenDetalle(filas.filter((f) => f.tramo === "t90" || f.tramo === "t90mas")),
  });
  // 11. Incobrables: cliente × año
  const inc = filas.filter((f) => f.p.cl === "incobrable");
  if (inc.length) hojaMatriz("Incobrables", "Cuentas incobrables (casos con abogados o cobranza externa) por cliente y año", "cliente", inc, [...new Set(inc.map((f) => f.anio))].sort(), (f) => f.anio, (k) => k, "Cliente", colCliente);
  // 12. Notas de entrega
  const ne = filas.filter((f) => f.p.t === "nota_entrega");
  if (ne.length) agregar<Fila>({ nombre: "Notas de entrega", encabezado: encabezado("Notas de entrega no fiscales (deuda interna, no está en Odoo)"), totales: "Totales", columnas: columnasDetalle, filas: ordenDetalle(ne) });
  // 13. Detalle
  agregar<Fila>({ nombre: "Detalle", encabezado: encabezado("Antigüedad · todas las partidas abiertas"), totales: "Totales", columnas: columnasDetalle, filas: ordenDetalle(filas) });
  // 14. Parámetros
  const p = (clave: string, valor: string) => ({ clave, valor });
  agregar({
    nombre: "Parámetros", encabezado: ["Antigüedad · cómo se calcula"], autofiltro: false,
    columnas: [{ titulo: "Parámetro", valor: (f: { clave: string; valor: string }) => f.clave, ancho: 30 }, { titulo: "Valor", valor: (f) => f.valor, ancho: 110, ajustar: true }],
    filas: [
      p("Corte", `${fechaDMA(datos.corte)}. Saldo de cada documento = el de hoy más lo que se le aplicó después del corte (el mismo del estado de cuenta).`),
      p("Empresas", d.empresas),
      p("Generado", fechaDMA(hoyCaracas())),
      p("Días", base === "vencimiento" ? "Desde el vencimiento (decisión D2). \"Por vencer\" = aún no vence." : "Desde la emisión, como el Excel de finanzas."),
      p("Año", "Año de emisión del documento."),
      p("Partidas", "Facturas y notas de débito con saldo; notas de crédito sin aplicar y anticipos (cobros de Odoo o de GUDS sin aplicar a una factura), que restan; y, si se incluyen, las notas de entrega no fiscales."),
      p("Tipo de partida", "Retención por recibir = solo falta el comprobante de retención; IVA o IGTF pendiente = falta el IVA no retenido o el 3 % de IGTF de los pagos en divisas (como el estado de cuenta)."),
      p("Vendedor", "El del documento en Odoo; si no tiene, el asignado al cliente (columna \"Vendedor del cliente\")."),
      p("Tipo y categoría de cliente", "La clasificación de finanzas (Configuración → Clasificación de clientes): la de Odoo o, si aún no se envió, la asignada o propuesta en GUDS."),
      p("Clasificación", "Deuda activa o incobrable (casos con abogados o cobranza externa), por cliente o por documento, desde el detalle de la cuenta. Es la de hoy. No baja el saldo."),
      p("Notas de entrega", datos.ne ? "Incluidas: deuda interna no fiscal que no está en Odoo; no forman parte del estado de cuenta del cliente." : "No incluidas."),
      p("Diferencias con el Excel de finanzas", "El Excel cuenta los días desde la emisión y deja algunas notas de crédito abiertas que Odoo ya aplicó a su factura (el neto es el mismo). Los anticipos de saldo inicial de GUDS Supply tienen en Odoo fecha 4–5 de mayo de 2026 (la de la migración)."),
    ],
  });

  return { archivo: nombreArchivoExcel("antiguedad", d.empresas, datos.corte), hojas };
}
