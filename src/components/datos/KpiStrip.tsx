import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface Kpi {
  label: string;
  valor: ReactNode;
  detalle?: ReactNode;
  tono?: "normal" | "positivo" | "negativo" | "alerta" | "primario" | "tenue";
  onClick?: () => void;
  activo?: boolean;
  titulo?: string;
}

const TONO: Record<NonNullable<Kpi["tono"]>, string> = {
  normal: "text-foreground",
  positivo: "text-success",
  negativo: "text-destructive",
  alerta: "text-warning",
  primario: "text-primary",
  tenue: "text-muted-foreground",
};

/** Franja compacta de indicadores (una fila, ~48 px) en lugar de tarjetas grandes. */
export function KpiStrip({ items, className }: { items: Kpi[]; className?: string }) {
  return (
    <div className={cn("mb-3 grid grid-cols-2 overflow-hidden rounded-lg border border-border bg-card sm:grid-cols-3 lg:auto-cols-fr lg:grid-flow-col lg:grid-cols-none", className)}>
      {items.map((k, i) => {
        const contenido = (
          <>
            <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{k.label}</p>
            <p className={cn("truncate text-base font-semibold leading-tight tabular-nums", TONO[k.tono ?? "normal"])}>{k.valor}</p>
            {k.detalle && <p className="truncate text-[11px] leading-tight text-muted-foreground">{k.detalle}</p>}
          </>
        );
        const base = cn("min-w-0 border-border px-3 py-1.5 text-left", i > 0 && "border-l", k.activo && "bg-primary/5 shadow-[inset_0_-2px_0_hsl(var(--primary))]");
        return k.onClick
          ? <button key={k.label} type="button" onClick={k.onClick} title={k.titulo} className={cn(base, "transition-colors hover:bg-muted/50")}>{contenido}</button>
          : <div key={k.label} title={k.titulo} className={base}>{contenido}</div>;
      })}
    </div>
  );
}
