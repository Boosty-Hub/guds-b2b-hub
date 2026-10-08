// Lo cobrado (fase 22f · R2 del plan de reportes de finanzas): tipos, textos y la matriz fila × mes que comparten la pantalla y
// el Excel. Los datos salen de reporte_cobranza_matriz y reporte_cobros_detalle (fuente única: cobros_unificados en la base).

/** Una celda de reporte_cobranza_matriz: fila × mes × moneda. */
export interface CeldaCobro {
  fila: string; etiqueta: string; detalle: string | null; empresa: string | null; mes: string; moneda: "BS" | "USD";
  cobros: number; monto_moneda: number; usd: number;
}

export type FuenteCobro = "odoo" | "guds" | "profit";
export type EstadoCobro = "vigente" | "anulado" | "borrador" | "por_verificar" | "igtf" | "saldo_inicial" | "posterior_arranque";

/** Un cobro de reporte_cobros_detalle (una forma de pago de un recibo de Profit o un cobro de Odoo/GUDS). */
export interface Cobro {
  ref: string; fuente: FuenteCobro; empresa: string | null; fecha: string; numero: string; cliente_id: string | null; cliente: string | null;
  rif: string | null; vendedor: string; cobrador: string | null; diario: string; forma: string; referencia: string | null; moneda: "BS" | "USD";
  monto: number; tasa: number | null; tasa_origen: "bcv" | "profit" | null; usd: number; usd_origen: number | null; estado: EstadoCobro;
  motivo: string | null;
}

export const FUENTE_COBRO: Record<FuenteCobro, string> = { odoo: "Odoo", profit: "Profit", guds: "GUDS" };

/** Por qué un cobro no suma en lo cobrado (todo lo que no es "vigente"). */
export const ESTADO_COBRO: Record<EstadoCobro, string> = {
  vigente: "Cuenta",
  anulado: "Anulados",
  borrador: "Borradores en Odoo",
  por_verificar: "Reportados sin verificar",
  igtf: "IGTF (aparte)",
  saldo_inicial: "Saldo inicial antes del arranque",
  posterior_arranque: "Profit después del arranque",
};

export const TEXTO_TASA = {
  bcv: "BCV del día del cobro",
  profit: "Tomada de Profit: ese día no hay tasa BCV en Odoo",
} as const;

export const num = (v: unknown) => Number(v ?? 0) || 0;

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
/** '2026-03' → 'Mar 26' */
export const etiquetaMes = (k: string) => `${MESES[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}`;

/** Meses del período, en orden: '2026-01' … '2026-09'. */
export function mesesDe(desde: string, hasta: string): string[] {
  const out: string[] = [];
  let [a, m] = [Number(desde.slice(0, 4)), Number(desde.slice(5, 7))];
  const [af, mf] = [Number(hasta.slice(0, 4)), Number(hasta.slice(5, 7))];
  while (a < af || (a === af && m <= mf)) {
    out.push(`${a}-${String(m).padStart(2, "0")}`);
    if (++m > 12) { m = 1; a++; }
    if (out.length > 600) break;
  }
  return out;
}

export interface FilaMatriz {
  clave: string; etiqueta: string; detalle: string | null; empresa: string | null;
  /** Solo en la vista en moneda original: la moneda de la fila. */
  moneda: "BS" | "USD" | null;
  meses: Record<string, number>; total: number; cobros: number;
  /** Total en USD (para ordenar también la vista en moneda original). */
  usd: number;
}

/**
 * Matriz fila × mes. En USD, una fila por fila (todas las monedas sumadas en USD); en moneda original, una fila por fila y
 * moneda con el monto en esa moneda. Ordenada de mayor a menor (en moneda original, primero bolívares).
 */
export function pivotar(celdas: CeldaCobro[], medida: "usd" | "moneda"): FilaMatriz[] {
  const filas = new Map<string, FilaMatriz>();
  for (const c of celdas) {
    const clave = medida === "usd" ? c.fila : `${c.fila}|${c.moneda}`;
    let f = filas.get(clave);
    if (!f) {
      f = { clave, etiqueta: c.etiqueta, detalle: c.detalle, empresa: c.empresa, moneda: medida === "usd" ? null : c.moneda, meses: {}, total: 0, cobros: 0, usd: 0 };
      filas.set(clave, f);
    }
    const v = medida === "usd" ? num(c.usd) : num(c.monto_moneda);
    f.meses[c.mes] = (f.meses[c.mes] ?? 0) + v;
    f.total += v;
    f.cobros += num(c.cobros);
    f.usd += num(c.usd);
  }
  const orden = (f: FilaMatriz) => (f.moneda === "BS" ? 0 : f.moneda === "USD" ? 1 : 0);
  return [...filas.values()].sort((a, b) => orden(a) - orden(b) || b.usd - a.usd || a.etiqueta.localeCompare(b.etiqueta));
}

/** Totales por mes de un conjunto de filas (en moneda original, solo tiene sentido dentro de una misma moneda). */
export function totalesPorMes(filas: FilaMatriz[], meses: string[]): { meses: Record<string, number>; total: number; cobros: number } {
  const t: Record<string, number> = Object.fromEntries(meses.map((m) => [m, 0]));
  let total = 0, cobros = 0;
  for (const f of filas) {
    for (const m of meses) t[m] += f.meses[m] ?? 0;
    total += f.total; cobros += f.cobros;
  }
  return { meses: t, total, cobros };
}
