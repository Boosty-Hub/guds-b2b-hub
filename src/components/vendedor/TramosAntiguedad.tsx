import { cn } from "@/lib/utils";
import { useCurrency } from "@/contexts/CurrencyContext";
import { TRAMOS } from "./cartera";
import type { Tramos } from "./tipos";

// Antigüedad de la deuda por tramos (por vencer, 1–30, 31–60, 61–90, +90): misma lógica que Cuentas por cobrar del admin.
// Cada tramo es un botón (filtro) cuando se pasa onElegir.

const COLOR: Record<keyof Tramos, string> = {
  por_vencer: "bg-sky-500",
  d1_30: "bg-amber-400",
  d31_60: "bg-orange-500",
  d61_90: "bg-red-500",
  mas_90: "bg-red-800",
};

export function TramosAntiguedad({ tramos, activo, onElegir, className }: {
  tramos: Tramos;
  activo?: keyof Tramos | null;
  onElegir?: (t: keyof Tramos | null) => void;
  className?: string;
}) {
  const { formatPrice } = useCurrency();
  const total = TRAMOS.reduce((s, t) => s + Math.max(0, Number(tramos[t.clave] || 0)), 0);
  return (
    <div className={cn("rounded-lg border border-border bg-card p-2.5", className)} data-testid="tramos-antiguedad">
      <div className="mb-2 flex h-2.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
        {total > 0 && TRAMOS.map((t) => {
          const v = Math.max(0, Number(tramos[t.clave] || 0));
          return v > 0 ? <div key={t.clave} className={cn(COLOR[t.clave], activo && activo !== t.clave && "opacity-30")} style={{ width: `${(v / total) * 100}%` }} /> : null;
        })}
      </div>
      <div className="grid grid-cols-3 gap-1 sm:grid-cols-5">
        {TRAMOS.map((t) => {
          const v = Number(tramos[t.clave] || 0);
          const contenido = (
            <>
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", COLOR[t.clave])} aria-hidden />{t.etiqueta}
              </span>
              <span className={cn("block truncate text-[13px] font-semibold tabular-nums", v > 0.009 && t.clave !== "por_vencer" && "text-destructive")}>{formatPrice(v)}</span>
            </>
          );
          return onElegir ? (
            <button key={t.clave} type="button" onClick={() => onElegir(activo === t.clave ? null : t.clave)} data-testid={`tramo-${t.clave}`}
              className={cn("min-w-0 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-muted/60", activo === t.clave && "bg-primary/10 ring-1 ring-primary/40")}
              aria-pressed={activo === t.clave}>
              {contenido}
            </button>
          ) : <div key={t.clave} className="min-w-0 px-1.5 py-1">{contenido}</div>;
        })}
      </div>
    </div>
  );
}
