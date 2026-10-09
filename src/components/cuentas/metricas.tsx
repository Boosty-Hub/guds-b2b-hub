import { useCallback, useEffect, useState } from "react";
import { Gauge, Loader2, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

// Métricas internas de cobranza (fase 21b, plan de revisión §3): solo para el equipo, nunca en el estado de cuenta del
// cliente. Fuente: metricas_cobranza(dias, cliente) — la misma para Cuentas, el detalle de la cuenta y la cartera del
// vendedor; Reportes → Cobranza usa reporte_dso con el mismo cálculo.
// 22h (D6): la medida oficial son los DÍAS DE RECUPERACIÓN = deuda neta ÷ venta promedio mensual de 12 meses (con IVA) × 30,
// siempre con su explicación a la vista. El DSO de la ventana (30/90/180 días, deuda bruta) queda como "tendencia".

export type VentanaDso = 30 | 90 | 180;

export interface MetricaCliente {
  cliente_id: string;
  deuda: number; vencido: number; docs: number;
  a_favor_nc: number; nc_sin_aplicar: number; nc_mas_antigua: string | null;
  venta: number;
  /** Tendencia: deuda bruta ÷ venta promedio diaria de la ventana. null = sin ventas en la ventana (con deuda). */
  dso: number | null;
  /** Días de mora ponderados por monto (lo por vencer cuenta 0). */
  mora: number;
  deuda_ant: number; venta_ant: number; dso_ant: number | null; mora_ant: number;
  /** Días promedio de la emisión al cobro (ponderado), de lo cobrado en la ventana. */
  dias_pago: number | null;
  limite: number; sobre_limite: boolean; tiene_correo: boolean; corte_ant: string;
  /** Días de recuperación (D6). null = con deuda neta y sin compras en 12 meses. */
  dias_rec: number | null;
  dias_rec_ant: number | null;
  /** Deuda neta (facturas y ND − NC a favor − anticipos, + notas de entrega si el usuario las ve) */
  rec_deuda: number;
  rec_ne: number;
  /** Venta con IVA de los últimos 12 meses y los meses que la dividen (menos de 12 si es cliente nuevo) */
  rec_venta: number; rec_meses: number; rec_promedio: number;
  incobrable: boolean;
}
export interface Metricas { dias: number; alerta_dso: number; alerta_recuperacion: number; recuperacion_ne: boolean; clientes: MetricaCliente[] }

const num = (v: unknown) => (v == null ? null : Number(v));
const normalizar = (m: Record<string, unknown>): MetricaCliente => ({
  cliente_id: String(m.cliente_id),
  deuda: Number(m.deuda ?? 0), vencido: Number(m.vencido ?? 0), docs: Number(m.docs ?? 0),
  a_favor_nc: Number(m.a_favor_nc ?? 0), nc_sin_aplicar: Number(m.nc_sin_aplicar ?? 0), nc_mas_antigua: (m.nc_mas_antigua as string) ?? null,
  venta: Number(m.venta ?? 0), dso: num(m.dso), mora: Number(m.mora ?? 0),
  deuda_ant: Number(m.deuda_ant ?? 0), venta_ant: Number(m.venta_ant ?? 0), dso_ant: num(m.dso_ant), mora_ant: Number(m.mora_ant ?? 0),
  dias_pago: num(m.dias_pago), limite: Number(m.limite ?? 0), sobre_limite: !!m.sobre_limite, tiene_correo: !!m.tiene_correo,
  corte_ant: String(m.corte_ant ?? ""),
  dias_rec: num(m.dias_rec), dias_rec_ant: num(m.dias_rec_ant), rec_deuda: Number(m.rec_deuda ?? 0), rec_ne: Number(m.rec_ne ?? 0),
  rec_venta: Number(m.rec_venta ?? 0), rec_meses: Number(m.rec_meses ?? 12), rec_promedio: Number(m.rec_promedio ?? 0), incobrable: !!m.incobrable,
});

export function useMetricasCobranza(dias: VentanaDso | null, clienteId?: string | null, activo = true) {
  const [datos, setDatos] = useState<Metricas | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const cargar = useCallback(async () => {
    if (!activo) return;
    setCargando(true);
    const { data, error: e } = await supabase.rpc("metricas_cobranza", { p_dias: dias, p_cliente_id: clienteId ?? null });
    if (e) { setError(e.message); setCargando(false); return; }
    const d = data as { dias: number; alerta_dso: number; alerta_recuperacion?: number; recuperacion_ne?: boolean; clientes: Record<string, unknown>[] };
    setDatos({ dias: d.dias, alerta_dso: d.alerta_dso, alerta_recuperacion: d.alerta_recuperacion ?? 90, recuperacion_ne: !!d.recuperacion_ne,
      clientes: (d.clientes ?? []).map(normalizar) });
    setError(null);
    setCargando(false);
  }, [dias, clienteId, activo]);
  useEffect(() => { cargar(); }, [cargar]);
  return { datos, error, cargando, recargar: cargar };
}

/** DSO alto: sobre el umbral, o con vencido y sin ventas en la ventana (misma regla que alertas_cobranza). */
export const dsoAlto = (m: MetricaCliente, umbral: number) => m.deuda > 0.009 && (m.dso == null ? m.vencido > 0.009 : m.dso > umbral);

export type Tendencia = "mejora" | "empeora" | "igual" | null;
/** Contra el cierre del mes anterior: más de 3 días (o 10 %) de diferencia en el DSO; si no hay DSO, la mora. */
export const tendencia = (m: MetricaCliente): Tendencia => {
  const a = m.dso ?? null, b = m.dso_ant ?? null;
  const [x, y] = a != null && b != null ? [a, b] : [m.mora, m.mora_ant];
  if (m.deuda <= 0.009 && m.deuda_ant <= 0.009) return null;
  const dif = x - y;
  if (Math.abs(dif) <= Math.max(3, Math.abs(y) * 0.1)) return "igual";
  return dif < 0 ? "mejora" : "empeora";
};

export const textoDso = (m: Pick<MetricaCliente, "dso" | "deuda">) =>
  m.deuda <= 0.009 ? "Sin deuda" : m.dso == null ? "Sin ventas" : `${m.dso} d`;

// ── Días de recuperación (D6) ──
type Rec = Pick<MetricaCliente, "dias_rec" | "dias_rec_ant" | "rec_deuda" | "rec_promedio" | "rec_meses" | "rec_ne" | "incobrable">;
const usd = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** "57 d" · "Sin deuda" · "Sin compras" (con deuda neta y sin compras en 12 meses) */
export const textoRecuperacion = (m: Rec) => (m.rec_deuda <= 0.009 ? "Sin deuda" : m.dias_rec == null ? "Sin compras" : `${m.dias_rec} d`);
/** Recuperación lenta: más días que el umbral (sin contar los incobrables; misma regla que alertas_cobranza). */
export const recuperacionAlta = (m: Rec, umbral: number) => m.rec_deuda > 1 && m.dias_rec != null && m.dias_rec > umbral && !m.incobrable;
/** Con deuda neta y sin compras en 12 meses ("en recuperación" en el Excel de finanzas), sin contar los incobrables. */
export const sinCompras = (m: Rec) => m.rec_deuda > 1 && m.dias_rec == null && !m.incobrable;
/** La regla, con los números del cliente (D6: la explicación va donde se muestre el número). */
export const formulaRecuperacion = (m: Rec) => {
  if (m.rec_deuda <= 0.009) return "Días de recuperación: sin deuda neta (facturas y ND − NC a favor − anticipos).";
  const ne = m.rec_ne > 0.009 ? ` (incluye ${usd(m.rec_ne)} de notas de entrega)` : "";
  if (m.dias_rec == null) return `Deuda neta ${usd(m.rec_deuda)}${ne} y sin compras en los últimos 12 meses: no hay venta promedio para calcular los días (en recuperación).`;
  const meses = m.rec_meses >= 12 ? "12 meses" : `${m.rec_meses} ${m.rec_meses === 1 ? "mes" : "meses"} desde su primera compra`;
  return `Días de recuperación: deuda neta ${usd(m.rec_deuda)}${ne} ÷ venta promedio mensual ${usd(m.rec_promedio)} (${meses}, con IVA) × 30 = ${m.dias_rec} días`;
};
/** Contra el cierre del mes anterior: más de 3 días (o 10 %) de diferencia. */
export const tendenciaRecuperacion = (m: Rec): Tendencia => {
  if (m.dias_rec == null || m.dias_rec_ant == null) return null;
  const dif = m.dias_rec - m.dias_rec_ant;
  if (Math.abs(dif) <= Math.max(3, Math.abs(m.dias_rec_ant) * 0.1)) return "igual";
  return dif < 0 ? "mejora" : "empeora";
};
/** Días de recuperación de un grupo de clientes: Σ deuda neta ÷ Σ promedio mensual × 30 (como reporte_dso). */
export const recuperacionGrupo = (ms: Rec[]) => {
  const deuda = ms.reduce((s, m) => s + m.rec_deuda, 0), prom = ms.reduce((s, m) => s + m.rec_promedio, 0);
  return { deuda, promedio: prom, dias: deuda <= 0.009 ? 0 : prom > 0.009 ? Math.round((deuda / prom) * 30) : null };
};
export const formulaGrupo = (g: { deuda: number; promedio: number; dias: number | null }) =>
  g.deuda <= 0.009 ? "Sin deuda neta." : g.dias == null ? `Deuda neta ${usd(g.deuda)} y sin compras en 12 meses.`
    : `Días de recuperación: deuda neta ${usd(g.deuda)} ÷ venta promedio mensual ${usd(g.promedio)} (12 meses, con IVA) × 30 = ${g.dias} días`;

export function IconoTendencia({ t, className }: { t: Tendencia; className?: string }) {
  if (!t) return null;
  const I = t === "mejora" ? TrendingDown : t === "empeora" ? TrendingUp : Minus;
  return (
    <I className={cn("h-3.5 w-3.5", t === "mejora" ? "text-success" : t === "empeora" ? "text-destructive" : "text-muted-foreground", className)}
      aria-label={t === "mejora" ? "Mejora contra el mes anterior" : t === "empeora" ? "Empeora contra el mes anterior" : "Igual que el mes anterior"} />
  );
}

/** Selector de ventana del DSO (30 / 90 / 180 días). */
export function SelectorVentana({ valor, onCambio, className }: { valor: VentanaDso; onCambio: (v: VentanaDso) => void; className?: string }) {
  return (
    <div className={cn("flex rounded-md border border-border bg-background p-0.5", className)} role="group" aria-label="Ventana de venta promedio">
      {([30, 90, 180] as VentanaDso[]).map((v) => (
        <button key={v} type="button" onClick={() => onCambio(v)} aria-pressed={valor === v} title={`Venta promedio de los últimos ${v} días`}
          className={cn("whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] tabular-nums", valor === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{v} d</button>
      ))}
    </div>
  );
}

const fechaCorta = (s: string | null) => (s ? new Date(`${s.slice(0, 10)}T00:00:00`).toLocaleDateString("es-VE", { day: "2-digit", month: "short", year: "numeric" }) : "—");

/** Tarjeta del detalle de la cuenta: DSO, mora ponderada, tendencia, días de pago y a favor por aplicar. */
export function TarjetaMetricas({ clienteId, formatPrice }: { clienteId: string; formatPrice: (n: number) => string }) {
  const [ventana, setVentana] = useState<VentanaDso>(90);
  const { datos, error, cargando } = useMetricasCobranza(ventana, clienteId);
  const m = datos?.clientes[0] ?? null;
  const t = m ? tendencia(m) : null;
  const alto = m && datos ? dsoAlto(m, datos.alerta_dso) : false;
  const tr = m ? tendenciaRecuperacion(m) : null;
  const lento = m && datos ? recuperacionAlta(m, datos.alerta_recuperacion) || sinCompras(m) : false;
  return (
    <div className="rounded-lg border border-border bg-card" data-testid="cd-metricas">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-primary/10 p-1.5"><Gauge className="h-4 w-4 text-primary" /></div>
          <h2 className="text-[13px] font-semibold">Cobranza (interno)</h2>
          {cargando && datos && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
        <SelectorVentana valor={ventana} onCambio={setVentana} />
      </div>
      {!datos && cargando ? <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
        : error ? <p className="p-3 text-xs text-destructive">{error}</p>
        : !m ? <p className="p-3 text-xs text-muted-foreground">Sin deuda ni ventas en los últimos {ventana} días.</p>
        : (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 p-3 text-xs">
            {/* 22h (D6): la medida oficial, con su explicación */}
            <div className="col-span-2 border-b border-border pb-2" data-testid="cd-recuperacion">
              <dt className="text-muted-foreground">Días de recuperación</dt>
              <dd className={cn("flex items-center gap-1 text-base font-semibold tabular-nums", lento && "text-destructive")} data-testid="cd-dias-rec">
                {textoRecuperacion(m)}<IconoTendencia t={tr} />
                {m.incobrable && <span className="ml-1 rounded bg-destructive/10 px-1 text-[10px] font-medium text-destructive">Incobrable</span>}
              </dd>
              <dd className="text-[11px] text-muted-foreground" data-testid="cd-formula">{formulaRecuperacion(m)}</dd>
              <dd className="text-[11px] text-muted-foreground">Cierre del mes anterior: {m.dias_rec_ant == null ? (m.rec_deuda > 0.009 ? "sin compras" : "—") : `${m.dias_rec_ant} días`}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground" title={`Deuda bruta ÷ venta promedio diaria de los últimos ${ventana} días: sirve para ver hacia dónde va`}>Tendencia {ventana} días (DSO)</dt>
              <dd className={cn("flex items-center gap-1 text-base font-semibold tabular-nums", alto && "text-destructive")} data-testid="cd-dso">
                {textoDso(m)}<IconoTendencia t={t} />
              </dd>
              <dd className="text-[11px] text-muted-foreground">
                {m.deuda <= 0.009 ? "—" : m.dso == null ? `No compró en ${ventana} días` : `Debe ${m.dso} días de compras`} · mes anterior {m.dso_ant == null ? (m.deuda_ant > 0.009 ? "sin ventas" : "—") : `${m.dso_ant} d`}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Mora ponderada</dt>
              <dd className="text-base font-semibold tabular-nums" data-testid="cd-mora">{m.mora} d</dd>
              <dd className="text-[11px] text-muted-foreground">mes anterior {m.mora_ant} d · {t === "mejora" ? "mejora" : t === "empeora" ? "empeora" : t === "igual" ? "sin cambio" : "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Tarda en pagar (promedio)</dt>
              <dd className="font-semibold tabular-nums">{m.dias_pago == null ? "—" : `${m.dias_pago} días`}</dd>
              <dd className="text-[11px] text-muted-foreground">de la emisión al cobro · venta {ventana} d {formatPrice(m.venta)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">A favor por aplicar</dt>
              <dd className={cn("font-semibold tabular-nums", m.a_favor_nc > 0.009 && "text-success")}>{formatPrice(m.a_favor_nc)}</dd>
              <dd className="text-[11px] text-muted-foreground">{m.nc_sin_aplicar ? `${m.nc_sin_aplicar} NC sin cruzar · la más antigua ${fechaCorta(m.nc_mas_antigua)}` : "Sin NC por cruzar"}</dd>
            </div>
          </dl>
        )}
    </div>
  );
}
