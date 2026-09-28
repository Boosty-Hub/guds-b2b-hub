// Piezas comunes de las pestañas de Reportes (Ventas, Análisis, Histórico Profit)

// Colores por fuente (paleta validada para daltonismo en claro y oscuro): Odoo rojo, Profit azul
const COLOR_FUENTE = { odoo: ["#e34948", "#e66767"], profit: ["#2a78d6", "#3987e5"] } as const;
export const colorFuente = (f: "odoo" | "profit") => {
  const oscuro = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  return COLOR_FUENTE[f][oscuro ? 1 : 0];
};

/** Insignia de los números que incluyen el histórico de Profit */
export function InsigniaProfit({ className }: { className?: string }) {
  return (
    <span title="Incluye el histórico de Profit (solo lectura)"
      className={`inline-flex h-4 shrink-0 items-center gap-1 rounded border border-border px-1 text-[10px] font-medium leading-none text-muted-foreground ${className ?? ""}`}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: colorFuente("profit") }} aria-hidden />Profit
    </span>
  );
}

// ── Períodos de comparación (misma regla que periodo_comparacion() en la base, migración 20q) ──
const isoFecha = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export type Comparacion = "anterior" | "anio_anterior";
export const TEXTO_COMPARACION: Record<Comparacion, string> = { anterior: "Período anterior", anio_anterior: "Mismo período del año anterior" };

/** Meses que abarca el período si son meses completos (del día 1 al último día del mes); si no, null */
export function mesesCompletos(desde: string, hasta: string): number | null {
  const d = new Date(`${desde}T00:00:00`), h = new Date(`${hasta}T00:00:00`);
  const finDeMes = new Date(h.getFullYear(), h.getMonth() + 1, 0).getDate() === h.getDate();
  if (d.getDate() !== 1 || !finDeMes) return null;
  return (h.getFullYear() - d.getFullYear()) * 12 + h.getMonth() - d.getMonth() + 1;
}

/** Período anterior: si son meses completos, los mismos meses justo antes (un año → el año anterior); si no, el mismo número
 * de días justo antes. Año anterior: las mismas fechas un año antes (29-feb → 28-feb). */
export function periodoComparacion(desde: string, hasta: string, tipo: Comparacion): [string, string] {
  const d = new Date(`${desde}T00:00:00`), h = new Date(`${hasta}T00:00:00`);
  if (tipo === "anio_anterior") {
    const menosUnAnio = (x: Date) => {
      const y = x.getFullYear() - 1, m = x.getMonth();
      return new Date(y, m, Math.min(x.getDate(), new Date(y, m + 1, 0).getDate()));
    };
    return [isoFecha(menosUnAnio(d)), isoFecha(menosUnAnio(h))];
  }
  const meses = mesesCompletos(desde, hasta);
  if (meses !== null) return [isoFecha(new Date(d.getFullYear(), d.getMonth() - meses, 1)), isoFecha(new Date(d.getFullYear(), d.getMonth(), 0))];
  const dias = Math.round((h.getTime() - d.getTime()) / 86400000) + 1;
  const fin = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1), ini = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dias);
  return [isoFecha(ini), isoFecha(fin)];
}

/** Meses que separan el período de su comparación (para alinear año y año-mes en el análisis); null si es por días */
export function desplazamientoMeses(desde: string, hasta: string, tipo: Comparacion): number | null {
  if (tipo === "anio_anterior") return 12;
  return mesesCompletos(desde, hasta);
}

export const variacionPct = (actual: number, previo: number) => (previo ? ((actual - previo) / Math.abs(previo)) * 100 : null);
export const fechaCorta = (d: string) => d.split("-").reverse().join("/");

/** Variación con signo y color (USD y %) */
export function Variacion({ actual, previo, formato, soloPct }: { actual: number; previo: number; formato: (v: number) => string; soloPct?: boolean }) {
  const pct = variacionPct(actual, previo);
  const dif = actual - previo;
  const color = Math.abs(dif) < 0.005 ? "text-muted-foreground" : dif > 0 ? "text-success" : "text-destructive";
  return (
    <span className={`whitespace-nowrap tabular-nums ${color}`}>
      {!soloPct && <>{dif > 0 ? "+" : ""}{formato(dif)}{" "}</>}
      <span className={soloPct ? "" : "text-[11px]"}>{pct === null ? (soloPct ? "—" : "") : `${pct >= 0 ? "+" : ""}${pct.toLocaleString("es-VE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`}</span>
    </span>
  );
}
