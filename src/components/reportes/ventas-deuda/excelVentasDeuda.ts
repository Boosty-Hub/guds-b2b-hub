import { nombreArchivoExcel, type ColumnaExcel, type HojaExcel, type LibroExcel } from "@/lib/excel";
import { fechaDMA, hoyCaracas } from "@/lib/fechas";
import { ESTADO, REGLA, agrupar, diasConjunto, etiquetaMes, formulaFila, type DatosVentasDeuda, type Fila, type Grupo } from "./datos";

// Excel de Ventas vs deuda (22h · R4), como el "Promedio de ventas vs deudas" de finanzas: Resumen · una hoja por empresa
// (cliente × mes con totales por año, promedios, compra de 90 días, deuda, días de recuperación) · Por vendedor · Parámetros
// (con la fórmula, D6).

export interface DatosLibroVentasDeuda {
  datos: DatosVentasDeuda;
  filas: Fila[];
  meses: string[];
  activoMeses: number;
  /** "GUDS", "Quirutec" o "GUDS y Quirutec" */
  empresas: string;
  ambas: boolean;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function libroVentasDeuda(d: DatosLibroVentasDeuda): LibroExcel {
  const { datos, filas, meses } = d;
  const anios = [...new Set(meses.map((m) => m.slice(0, 4)))];
  const encabezado = (titulo: string, empresa?: string) => [
    titulo, `Empresas: ${empresa ?? d.empresas}`,
    `Deuda al ${fechaDMA(datos.corte)} · venta con IVA de ${etiquetaMes(meses[0]).toLowerCase()} a ${etiquetaMes(meses[meses.length - 1]).toLowerCase()} · montos en USD${datos.ne ? " · la deuda y la venta incluyen notas de entrega" : ""}`,
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hojas: HojaExcel<any>[] = [];
  const agregar = <T,>(h: HojaExcel<T>) => { hojas.push(h); };
  const empresas = [...new Set(filas.map((f) => f.empresa))].sort();

  // 1. Resumen por empresa
  type FilaResumen = { empresa: string; fs: Fila[] };
  const resumen = (fs: Fila[]) => ({ ...diasConjunto(fs), v12: fs.reduce((s, f) => s + Number(f.v12 ?? 0), 0) });
  agregar<FilaResumen>({
    nombre: "Resumen", encabezado: encabezado("Promedio de ventas vs deudas · resumen"), totales: d.ambas ? "Total" : false,
    columnas: [
      { titulo: "Empresa", valor: (r) => r.empresa, ancho: 14 },
      { titulo: "Clientes con venta en 12 meses", valor: (r) => r.fs.filter((f) => Number(f.v12 ?? 0) > 0.009).length, tipo: "entero" },
      { titulo: "Venta 12 meses (con IVA)", valor: (r) => r2(resumen(r.fs).v12), tipo: "usd" },
      { titulo: "Venta promedio mensual", valor: (r) => r2(resumen(r.fs).promedio), tipo: "usd" },
      { titulo: "Deuda neta", valor: (r) => r2(resumen(r.fs).deuda), tipo: "usd" },
      { titulo: "Notas de entrega en la deuda", valor: (r) => r2(r.fs.reduce((s, f) => s + Number(f.ne ?? 0), 0)), tipo: "usd" },
      { titulo: "Días de recuperación", valor: (r) => resumen(r.fs).dias, tipo: "entero",
        total: (rs) => diasConjunto(rs.flatMap((r) => r.fs)).dias },
      { titulo: `Más de ${datos.umbral} días`, valor: (r) => r.fs.filter((f) => f.lento).length, tipo: "entero" },
      { titulo: "Con deuda y sin compras (12 meses)", valor: (r) => r.fs.filter((f) => f.estado === "recuperacion" && f.cl !== "incobrable" && f.deuda > 1).length, tipo: "entero" },
      { titulo: "Activos", valor: (r) => r.fs.filter((f) => f.estado === "activo").length, tipo: "entero" },
      { titulo: "Inactivos con deuda", valor: (r) => r.fs.filter((f) => f.estado === "inactivo" && f.deuda > 0.009).length, tipo: "entero" },
    ],
    filas: empresas.map((e) => ({ empresa: e, fs: filas.filter((f) => f.empresa === e) })),
    notas: [REGLA],
  });

  // 2. Una hoja por empresa: cliente × mes (con totales por año), promedios, deuda y días
  const columnasCliente: ColumnaExcel<Fila>[] = [
    { titulo: "Cliente", valor: (f) => f.n, ancho: 40 },
    { titulo: "RIF", valor: (f) => f.rif ?? "" },
    { titulo: "Código", valor: (f) => f.cod ?? "" },
    { titulo: "Tipo de cliente", valor: (f) => f.tipo ?? "", ancho: 18 },
    { titulo: "Categoría de cobranza", valor: (f) => f.cat ?? "", ancho: 18 },
    { titulo: "Vendedor", valor: (f) => f.v ?? "", ancho: 22 },
    ...meses.map((m): ColumnaExcel<Fila> => ({ titulo: etiquetaMes(m), valor: (f) => (f.ventas?.[m] ? r2(Number(f.ventas[m])) : null), tipo: "usd", ancho: 12 })),
    ...anios.map((a): ColumnaExcel<Fila> => ({ titulo: `Total ${a}`, valor: (f) => r2(meses.filter((m) => m.startsWith(a)).reduce((s, m) => s + Number(f.ventas?.[m] ?? 0), 0)) || null, tipo: "usd", ancho: 13 })),
    { titulo: "Total de la matriz", valor: (f) => r2(Number(f.tot ?? 0)), tipo: "usd", ancho: 14 },
    { titulo: "Venta 12 meses", valor: (f) => r2(Number(f.v12 ?? 0)), tipo: "usd", ancho: 14 },
    { titulo: "Meses del promedio", valor: (f) => Number(f.m12 ?? 12), tipo: "entero", total: false },
    { titulo: "Venta promedio mensual", valor: (f) => r2(f.promedio), tipo: "usd", ancho: 14 },
    { titulo: "Promedio 5 meses", valor: (f) => (f.v5 != null ? r2(Number(f.v5) / 5) : null), tipo: "usd", ancho: 14 },
    { titulo: "Compra 90 días", valor: (f) => (f.c90 != null ? r2(Number(f.c90)) : null), tipo: "usd", ancho: 14 },
    { titulo: "Deuda fiscal", valor: (f) => r2(Number(f.df ?? 0)), tipo: "usd", ancho: 14 },
    { titulo: "Notas de entrega", valor: (f) => (f.ne ? r2(Number(f.ne)) : null), tipo: "usd", ancho: 13 },
    { titulo: "Deuda neta", valor: (f) => r2(f.deuda), tipo: "usd", ancho: 14 },
    { titulo: "Días de recuperación", valor: (f) => (f.deuda > 0.009 ? f.dias ?? null : null), tipo: "entero", ancho: 12,
      total: (fs) => diasConjunto(fs).dias },
    { titulo: "Deuda ÷ compra 90 días", valor: (f) => f.deudaSobreCompra, tipo: "pct", total: false },
    { titulo: "% impuesto por cobrar", valor: (f) => f.pctImpuesto, tipo: "pct", total: false },
    { titulo: "Estado", valor: (f) => ESTADO[f.estado], ancho: 16 },
    { titulo: "Clasificación", valor: (f) => (f.cl === "incobrable" ? "Incobrable" : ""), ancho: 12 },
    { titulo: "Primera compra", valor: (f) => f.pc ?? null, tipo: "fecha" },
    { titulo: "Última compra (12 meses)", valor: (f) => f.uc ?? null, tipo: "fecha" },
    { titulo: "Sin ficha en GUDS", valor: (f) => (f.sf ? (f.k.startsWith("ne:") ? "Nota de entrega" : "Cliente de Profit") : ""), ancho: 16 },
    { titulo: "Cómo se calcula", valor: (f) => (f.deuda > 0.009 ? formulaFila(f) : ""), ancho: 70 },
  ];
  for (const e of empresas) {
    const fs = filas.filter((f) => f.empresa === e).sort((a, b) => b.deuda - a.deuda || Number(b.v12 ?? 0) - Number(a.v12 ?? 0) || a.n.localeCompare(b.n));
    agregar<Fila>({ nombre: e, encabezado: encabezado("Promedio de ventas vs deudas", e), totales: "Total general", columnas: columnasCliente, filas: fs,
      notas: [REGLA, "Clientes de Profit sin ficha en GUDS: solo traen su venta del histórico; no tienen deuda en GUDS."] });
  }

  // 3. Por vendedor del cliente
  const grupos = agrupar(filas, "vendedor");
  agregar<Grupo>({
    nombre: "Por vendedor", encabezado: encabezado("Promedio de ventas vs deudas · por vendedor del cliente"), totales: "Total",
    columnas: [
      { titulo: "Vendedor", valor: (g) => g.etiqueta, ancho: 28 },
      { titulo: "Clientes", valor: (g) => g.clientes, tipo: "entero" },
      { titulo: "Venta 12 meses", valor: (g) => r2(g.v12), tipo: "usd" },
      { titulo: "Venta promedio mensual", valor: (g) => r2(g.promedio), tipo: "usd" },
      { titulo: "Deuda neta", valor: (g) => r2(g.deuda), tipo: "usd" },
      { titulo: "Días de recuperación", valor: (g) => g.dias, tipo: "entero", total: (gs) => diasConjunto(gs).dias },
      { titulo: `Más de ${datos.umbral} días`, valor: (g) => g.lentos, tipo: "entero" },
      { titulo: "Con deuda y sin compras", valor: (g) => g.recuperacion, tipo: "entero" },
    ],
    filas: grupos,
  });

  // 4. Parámetros
  const p = (clave: string, valor: string) => ({ clave, valor });
  agregar({
    nombre: "Parámetros", encabezado: ["Promedio de ventas vs deudas · cómo se calcula"], autofiltro: false,
    columnas: [{ titulo: "Parámetro", valor: (f: { clave: string; valor: string }) => f.clave, ancho: 30 }, { titulo: "Valor", valor: (f) => f.valor, ancho: 110, ajustar: true }],
    filas: [
      p("Días de recuperación (D6)", REGLA),
      p("Corte", `${fechaDMA(datos.corte)}: deuda a esa fecha (saldo de cada documento más lo aplicado después) y venta de los 12 meses que terminan ese día.`),
      p("Venta con IVA", "Profit (histórico hasta su cierre): todos los documentos, como el Excel de finanzas (facturas, devoluciones, notas financieras, ND cambiarias y reversos). Odoo: facturas, notas de crédito y de débito publicadas, sin los saldos iniciales migrados."),
      p("Promedio de 5 meses y compra de 90 días", "Venta de los últimos 5 meses ÷ 5, y venta de los últimos 3 meses."),
      p("Activo / inactivo", `Activo = compró en los últimos ${d.activoMeses} meses. En recuperación = debe y no compró en 12 meses.`),
      p("Recuperación lenta", `Más de ${datos.umbral} días (configurable en cobranza_recuperacion_alerta_dias). No se cuentan los clientes marcados como incobrables.`),
      p("Notas de entrega", datos.ne ? "Incluidas en la deuda (no fiscal). Nunca cuentan como venta." : "No incluidas en la deuda. Nunca cuentan como venta."),
      p("Diferencias con el Excel de finanzas", "El Excel de Quirutec suma como venta todas las notas de entrega de Profit (no fiscales); GUDS cuenta como venta las notas de entrega que tiene (las abiertas del Excel y las emitidas en GUDS), pero no las ya pagadas de Profit, que no están en GUDS. El Excel agrupa a mano algunos clientes de Profit (hoja LISTADO); GUDS los muestra con su ficha. El Excel divide siempre entre 12; GUDS, entre los meses desde la primera compra si el cliente es nuevo."),
      p("Empresas", d.empresas),
      p("Generado", fechaDMA(hoyCaracas())),
    ],
  });

  return { archivo: nombreArchivoExcel("ventas vs deuda", d.empresas, datos.corte), hojas };
}
