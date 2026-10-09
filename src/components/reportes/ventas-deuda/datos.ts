import { aDate, iso, sumarDias } from "@/lib/fechas";

// Ventas vs deuda (22h · R4 del plan de reportes de finanzas): el "Promedio de ventas vs deudas" de finanzas dentro de GUDS.
// La base (reporte_ventas_vs_deuda) da por cliente la venta con IVA de cada mes (Profit + Odoo), los promedios, la compra de
// 90 días, la deuda neta al corte y los días de recuperación (D6); la página agrupa, filtra y arma el Excel.

/** Un cliente tal como llega de la base (claves cortas). */
export interface FilaCruda {
  /** clave: id del cliente, 'profit:…' (cliente de Profit sin ficha) o 'ne:…' (nota de entrega sin ficha) */
  k: string;
  id?: string;
  n: string;
  rif?: string;
  cod?: string;
  /** empresa_id */
  e: string;
  /** vendedor del cliente */
  v?: string;
  tipo?: string;
  cat?: string;
  /** clasificación de cobranza (activa / incobrable) */
  cl?: "activa" | "incobrable";
  /** venta con IVA por mes 'AAAA-MM' (solo los meses con venta) */
  ventas?: Record<string, number>;
  /** total de la matriz */
  tot?: number;
  /** venta de 12 meses, meses que la dividen, promedio mensual, venta de 5 meses y compra de 90 días */
  v12?: number; m12?: number; prom?: number; v5?: number; c90?: number;
  /** deuda fiscal, notas de entrega, deuda neta (con N/E si van), impuesto por cobrar */
  df?: number; ne?: number; d?: number; imp?: number;
  /** días de recuperación (sin la clave = con deuda y sin compras, o sin deuda) */
  dias?: number;
  /** primera y última compra */
  pc?: string; uc?: string;
  /** sin ficha en GUDS */
  sf?: boolean;
}

export interface DatosVentasDeuda {
  hoy: string; corte: string; desde: string; ne: boolean; ve_ne: boolean; umbral: number;
  empresas: { id: string; nombre: string }[];
  clientes: FilaCruda[];
}

export type EstadoCliente = "activo" | "inactivo" | "recuperacion" | "sin_ventas";
export const ESTADO: Record<EstadoCliente, string> = {
  activo: "Activo", inactivo: "Inactivo", recuperacion: "En recuperación", sin_ventas: "Sin ventas ni deuda",
};

export interface Fila extends FilaCruda {
  empresa: string;
  deuda: number;
  promedio: number;
  estado: EstadoCliente;
  /** días de recuperación sobre el umbral (sin contar incobrables) */
  lento: boolean;
  /** deuda ÷ compra de 90 días */
  deudaSobreCompra: number | null;
  /** impuesto por cobrar ÷ deuda */
  pctImpuesto: number | null;
}

/** Meses 'AAAA-MM' desde `desde` hasta el mes del corte. */
export const mesesEntre = (desde: string, corte: string) => {
  const out: string[] = [];
  let d = aDate(`${desde.slice(0, 7)}-01`);
  const fin = corte.slice(0, 7);
  for (let i = 0; i < 200; i++) {
    const k = iso(d).slice(0, 7);
    out.push(k);
    if (k >= fin) break;
    d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  }
  return out;
};
const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
export const etiquetaMes = (k: string) => `${MESES[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}`;

/** Cortes que se ofrecen: hoy (mes en curso) y el cierre de los últimos 24 meses. Por defecto, el último mes cerrado. */
export const cortesDisponibles = (hoy: string) => {
  const out: { fecha: string; texto: string }[] = [{ fecha: hoy, texto: `Hoy (${etiquetaMes(hoy.slice(0, 7)).toLowerCase()} en curso)` }];
  let fin = sumarDias(`${hoy.slice(0, 7)}-01`, -1);
  for (let i = 0; i < 24; i++) {
    out.push({ fecha: fin, texto: `Cierre de ${aDate(fin).toLocaleDateString("es-VE", { month: "long", year: "numeric" })}` });
    fin = sumarDias(`${fin.slice(0, 7)}-01`, -1);
  }
  return out;
};
export const corteDefecto = (hoy: string) => sumarDias(`${hoy.slice(0, 7)}-01`, -1);

/** Arma las filas: estado, recuperación lenta y porcentajes. `activoMeses`: compró en los últimos N meses. */
export function filasDe(d: DatosVentasDeuda, activoMeses: number): Fila[] {
  const emp = new Map(d.empresas.map((e) => [e.id, e.nombre]));
  const limite = (() => { const x = aDate(d.corte); x.setMonth(x.getMonth() - activoMeses); return iso(x); })();
  const meses = mesesEntre(d.desde, d.corte);
  const ultimos12 = meses.slice(-12), ultimosN = meses.slice(-activoMeses);
  return d.clientes.map((c) => {
    // Clientes de Profit sin ficha: la venta de 12 meses y "activo" salen de los meses de la matriz (no tienen deuda en GUDS)
    const v12 = c.v12 != null ? Number(c.v12) : ultimos12.reduce((s, m) => s + Number(c.ventas?.[m] ?? 0), 0);
    const deuda = Number(c.d ?? 0), promedio = c.prom != null ? Number(c.prom) : v12 / 12, c90 = Number(c.c90 ?? 0);
    const compro = c.uc ? c.uc > limite : ultimosN.some((m) => Number(c.ventas?.[m] ?? 0) > 0.009);
    const estado: EstadoCliente = deuda > 0.009 && v12 <= 0.009 ? "recuperacion"
      : compro ? "activo" : v12 > 0.009 || deuda > 0.009 ? "inactivo" : "sin_ventas";
    return {
      ...c, v12, empresa: emp.get(c.e) ?? "—", deuda, promedio, estado,
      lento: deuda > 1 && c.dias != null && c.dias > d.umbral && c.cl !== "incobrable",
      deudaSobreCompra: c90 > 0.009 && deuda > 0.009 ? deuda / c90 : null,
      pctImpuesto: deuda > 0.009 && c.imp ? Number(c.imp) / deuda : null,
    };
  });
}

/** Días de recuperación de un conjunto: Σ deuda ÷ Σ promedio × 30 (como reporte_dso). */
export const diasConjunto = (fs: Pick<Fila, "deuda" | "promedio">[]) => {
  const deuda = fs.reduce((s, f) => s + f.deuda, 0), promedio = fs.reduce((s, f) => s + f.promedio, 0);
  return { deuda, promedio, dias: deuda <= 0.009 ? 0 : promedio > 0.009 ? Math.round((deuda / promedio) * 30) : null };
};

export type Agrupar = "cliente" | "vendedor" | "tipo" | "categoria" | "empresa";
export const AGRUPAR: { clave: Agrupar; texto: string }[] = [
  { clave: "cliente", texto: "Cliente" }, { clave: "vendedor", texto: "Vendedor" }, { clave: "tipo", texto: "Tipo de cliente" },
  { clave: "categoria", texto: "Categoría" }, { clave: "empresa", texto: "Empresa" },
];

export interface Grupo {
  clave: string; etiqueta: string; clientes: number; ventas: Record<string, number>; total: number; v12: number;
  promedio: number; c90: number; deuda: number; dias: number | null; lentos: number; recuperacion: number;
}
export function agrupar(filas: Fila[], por: Exclude<Agrupar, "cliente">): Grupo[] {
  const m = new Map<string, Grupo>();
  for (const f of filas) {
    const k = por === "vendedor" ? f.v || "Sin vendedor" : por === "tipo" ? f.tipo || "Sin clasificar" : por === "categoria" ? f.cat || "Sin clasificar" : f.empresa;
    let g = m.get(k);
    if (!g) { g = { clave: k, etiqueta: k, clientes: 0, ventas: {}, total: 0, v12: 0, promedio: 0, c90: 0, deuda: 0, dias: null, lentos: 0, recuperacion: 0 }; m.set(k, g); }
    g.clientes++;
    for (const [mes, v] of Object.entries(f.ventas ?? {})) g.ventas[mes] = (g.ventas[mes] ?? 0) + Number(v);
    g.total += Number(f.tot ?? 0); g.v12 += Number(f.v12 ?? 0); g.promedio += f.promedio; g.c90 += Number(f.c90 ?? 0); g.deuda += f.deuda;
    if (f.lento) g.lentos++;
    if (f.estado === "recuperacion" && f.cl !== "incobrable") g.recuperacion++;
  }
  return [...m.values()].map((g) => ({ ...g, dias: diasConjunto([g]).dias })).sort((a, b) => b.deuda - a.deuda || b.v12 - a.v12);
}

const usd = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** D6: la regla con las cifras, para el encabezado, los títulos y la hoja Parámetros. */
export const formulaFila = (f: Pick<Fila, "deuda" | "promedio" | "dias" | "m12" | "ne">) => {
  if (f.deuda <= 0.009) return "Sin deuda neta al corte.";
  const ne = Number(f.ne ?? 0) > 0.009 ? ` (incluye ${usd(Number(f.ne))} de notas de entrega)` : "";
  if (f.dias == null) return `Deuda neta ${usd(f.deuda)}${ne} y sin compras en los últimos 12 meses: en recuperación.`;
  const m = Number(f.m12 ?? 12);
  const meses = m >= 12 ? "12 meses" : `${m} ${m === 1 ? "mes" : "meses"} desde su primera compra`;
  return `Deuda neta ${usd(f.deuda)}${ne} ÷ venta promedio mensual ${usd(f.promedio)} (${meses}, con IVA) × 30 = ${f.dias} días`;
};
export const formulaTotal = (t: { deuda: number; promedio: number; dias: number | null }) =>
  t.deuda <= 0.009 ? "Sin deuda neta." : t.dias == null ? `Deuda neta ${usd(t.deuda)} y sin venta en 12 meses.`
    : `Deuda neta ${usd(t.deuda)} ÷ venta promedio mensual ${usd(t.promedio)} × 30 = ${t.dias} días`;
export const REGLA = "Días de recuperación = deuda neta al corte ÷ venta promedio mensual de los últimos 12 meses (con IVA, Profit + Odoo) × 30. "
  + "Deuda neta = facturas y notas de débito con saldo − notas de crédito a favor − anticipos sin aplicar (+ notas de entrega con saldo, si se incluyen). "
  + "Cliente nuevo: el promedio se divide entre los meses desde su primera compra. Las notas de entrega nunca cuentan como venta.";
