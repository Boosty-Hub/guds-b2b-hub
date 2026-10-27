/**
 * Cobro en bolívares a tasa de emisión (PEN-14770 / PEN-14775).
 *
 * Muchos clientes pagan los Bs exactos que dice la factura. Si ese monto se
 * convierte a USD con la tasa del día, la factura queda con un saldo falso
 * (los Bs de una factura vieja "valen" menos dólares hoy). Aquí cada factura
 * en VES se convierte con SU tasa de emisión; las facturas en USD y el
 * sobrante que queda como anticipo usan la tasa del día.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface FacturaCobrable {
  id: string;
  numero: string;
  fecha_emision: string | null;
  saldo_usd: number;
  moneda?: string | null;
  total?: number | null;
  total_usd?: number | null;
  /** Tasa del documento según Odoo; solo se muestra (la conversión usa total Bs ÷ total USD, que cuadra exacto con el documento). */
  tasa_cambio?: number | null;
}

/** Tasa Bs/USD implícita del documento (total Bs ÷ total USD). Solo facturas emitidas en Bs. */
export function tasaEmision(f: FacturaCobrable): number | null {
  if (f.moneda !== "VES" || !f.total || !f.total_usd) return null;
  return Math.abs(Number(f.total) / Number(f.total_usd));
}

/** Tasa con la que se convierte esta factura en un cobro en Bs: la de emisión, o la del día si se emitió en USD. */
export function tasaDeCobro(f: FacturaCobrable, tasaHoy: number): { tasa: number; esDeHoy: boolean } {
  const t = tasaEmision(f);
  return t ? { tasa: t, esDeHoy: false } : { tasa: tasaHoy, esDeHoy: true };
}

export interface ResumenCobroBs {
  /** USD a aplicar por factura, listo para registrar_cobro_facturas. */
  asignacionesUsd: Record<string, number>;
  /** USD totales del cobro: lo aplicado + el sobrante convertido a tasa del día. */
  montoUsd: number;
  /** Tasa única que se guarda en el cobro para que monto Bs ÷ tasa = montoUsd. */
  tasaEquivalente: number;
  sobranteBs: number;
}

/**
 * Convierte las asignaciones en Bs a USD factura por factura. Si lo asignado cubre
 * el saldo en Bs de la factura (con margen de redondeo), se aplica el saldo USD
 * completo para que la factura quede exactamente en cero.
 */
export function resumirCobroBs(
  montoBs: number,
  asignacionesBs: Record<string, number>,
  facturas: FacturaCobrable[],
  tasaHoy: number,
): ResumenCobroBs {
  const porId = new Map(facturas.map((f) => [f.id, f]));
  const asignacionesUsd: Record<string, number> = {};
  let aplicadoBs = 0;
  let aplicadoUsd = 0;
  for (const [id, bs] of Object.entries(asignacionesBs)) {
    const f = porId.get(id);
    if (!f || !(bs > 0)) continue;
    const { tasa } = tasaDeCobro(f, tasaHoy);
    if (!(tasa > 0)) continue;
    const saldoBs = f.saldo_usd * tasa;
    const usd = bs >= saldoBs - 0.01 ? r2(f.saldo_usd) : Math.min(r2(bs / tasa), r2(f.saldo_usd));
    if (usd <= 0.009) continue;
    asignacionesUsd[id] = usd;
    aplicadoBs += Math.min(bs, saldoBs); // lo que exceda el saldo de la factura queda como anticipo, no se pierde
    aplicadoUsd += usd;
  }
  const sobranteBs = r2(Math.max(0, montoBs - aplicadoBs));
  const sobranteUsd = tasaHoy > 0 ? sobranteBs / tasaHoy : 0;
  const montoUsd = r2(aplicadoUsd + sobranteUsd);
  const tasaEquivalente = montoUsd > 0 ? Math.round((montoBs / montoUsd) * 1e6) / 1e6 : 0;
  return { asignacionesUsd, montoUsd, tasaEquivalente, sobranteBs };
}

/** Facturas como las muestra el selector: saldo en Bs. a su tasa (cobro a tasa de emisión) o en USD. */
export function facturasParaSelector(
  facturas: FacturaCobrable[],
  aTasaEmision: boolean,
  tasaHoy: number,
): { id: string; numero: string; fecha_emision: string | null; saldo: number; tasa?: number; tasaEsDeHoy?: boolean }[] {
  if (!aTasaEmision) return facturas.map((f) => ({ id: f.id, numero: f.numero, fecha_emision: f.fecha_emision, saldo: Number(f.saldo_usd) }));
  return facturas.map((f) => {
    const { tasa, esDeHoy } = tasaDeCobro(f, tasaHoy);
    const tasaVisible = !esDeHoy && f.tasa_cambio ? Number(f.tasa_cambio) : tasa;
    return { id: f.id, numero: f.numero, fecha_emision: f.fecha_emision, saldo: r2(Number(f.saldo_usd) * tasa), tasa: tasaVisible, tasaEsDeHoy: esDeHoy };
  });
}

/** Nota que acompaña al cobro: la tasa guardada es el promedio del lote, no una tasa del BCV. */
export const NOTA_TASA_EMISION = "Cobro en Bs. a tasa de emisión: cada factura se saldó con su propia tasa; la tasa del cobro es el promedio del lote.";

export const formatoBs = (n: number) =>
  `Bs. ${Number(n || 0).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
