import { useMemo } from "react";
import { CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";
import { cortesSugeridos, esIso, fechaDMA, hoyCaracas } from "@/lib/fechas";

// Fecha de corte (R0 del plan de reportes, fase 22c): "¿cómo estaba al …?". Por defecto hoy (Caracas); se puede elegir una
// fecha pasada o uno de los cierres de mes sugeridos. Vive en la URL (?corte=AAAA-MM-DD) para que sobreviva a recargas y
// se pueda compartir (hook useCorteUrl); sin el parámetro, el corte es hoy.

export function SelectorCorte({ valor, onCambio, min, className, etiqueta = "Corte al" }: {
  valor: string;
  onCambio: (fecha: string | null) => void;
  min?: string;
  className?: string;
  etiqueta?: string;
}) {
  const hoy = hoyCaracas();
  const sugeridos = useMemo(() => cortesSugeridos(hoy), [hoy]);
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)} role="group" aria-label="Fecha de corte" data-testid="selector-corte">
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CalendarClock className="h-3.5 w-3.5" aria-hidden />
        <span className="whitespace-nowrap">{etiqueta}</span>
        <input
          type="date"
          value={valor}
          max={hoy}
          min={min}
          onChange={(e) => { if (esIso(e.target.value)) onCambio(e.target.value >= hoy ? null : e.target.value); }}
          className="h-7 rounded-md border border-input bg-background px-1.5 text-xs tabular-nums text-foreground"
          data-testid="corte-fecha"
          aria-label={`Fecha de corte (${fechaDMA(valor)})`}
        />
      </label>
      <div className="flex rounded-md border border-border bg-background p-0.5">
        {sugeridos.map((s) => {
          const activo = valor === s.fecha;
          return (
            <button key={s.fecha} type="button" aria-pressed={activo} title={s.etiqueta}
              onClick={() => onCambio(s.fecha === hoy ? null : s.fecha)}
              className={cn("whitespace-nowrap rounded px-2 py-0.5 text-xs", activo ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
              {s.fecha === hoy ? "Hoy" : fechaDMA(s.fecha).slice(0, 5)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
