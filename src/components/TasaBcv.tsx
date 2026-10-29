import { Link } from "react-router-dom";
import { Coins, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/hooks/use-toast";
import { aDate, fechaDMA } from "@/lib/fechas";
import { RUTA_TASAS, avisarTasasActualizadas, formatearBrecha, formatearTasa, useTasasDelDia } from "@/lib/tasas";
import { cn } from "@/lib/utils";

interface TasaBcvProps {
  /** Muestra el botón de actualización manual (por defecto sí). */
  showButton?: boolean;
  /** Solo el ícono (encabezado del celular); el detalle sale al tocarlo. */
  compacto?: boolean;
  className?: string;
}

const diaLargo = (iso: string) => aDate(iso).toLocaleDateString("es-VE", { weekday: "long", day: "numeric", month: "long" });

/**
 * Tasas del día en el encabezado (fase 24a): BCV dólar, BCV euro, dólar paralelo y la brecha. Al tocarlo, el detalle,
 * la del día hábil siguiente si el BCV ya la publicó, el botón para actualizar y el enlace al historial.
 */
export function TasaBcv({ showButton = true, compacto = false, className }: TasaBcvProps) {
  const { exchangeRate, refreshing, refreshTasa } = useCurrency();
  const { tasas: t } = useTasasDelDia();
  const { toast } = useToast();

  const handleRefresh = async () => {
    const res = await refreshTasa();
    avisarTasasActualizadas();
    if (res.ok) {
      toast({ title: "Tasas actualizadas", description: `BCV y paralelo consultados · ${res.fuente ?? "BCV"}` });
    } else {
      toast({
        title: "No se pudieron actualizar todas las tasas",
        description: res.error ?? "Intenta de nuevo en un momento.",
        variant: "destructive",
      });
    }
  };

  // Mientras carga la tabla nueva, la tasa canónica de siempre.
  const usd = t?.bcv_usd ?? (exchangeRate > 0 ? exchangeRate : null);
  const filas = [
    { etiqueta: "BCV dólar", valor: usd },
    { etiqueta: "BCV euro", valor: t?.bcv_eur ?? null },
    { etiqueta: "Dólar paralelo", valor: t?.paralelo_usd ?? null },
  ];
  const brecha = t?.brecha_pct ?? null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        {compacto ? (
          <button type="button" aria-label="Tasas del día" className={cn("p-2", className)}>
            <Coins className="h-5 w-5" />
          </button>
        ) : (
        <button
          type="button"
          aria-label="Tasas del día"
          className={cn(
            "flex h-8 items-center gap-2 rounded-full border border-border bg-muted/50 px-3 text-xs tabular-nums transition-colors hover:bg-muted",
            className,
          )}
        >
          <Coins className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
          <span>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">BCV $</span>{" "}
            <strong className="text-sm font-semibold text-foreground">{formatearTasa(usd)}</strong>
          </span>
          <span className="hidden lg:inline">
            <span className="text-muted-foreground">€</span> <strong className="font-semibold text-foreground">{formatearTasa(t?.bcv_eur)}</strong>
          </span>
          <span className="hidden xl:inline">
            <span className="text-muted-foreground">Par.</span> <strong className="font-semibold text-foreground">{formatearTasa(t?.paralelo_usd)}</strong>
          </span>
          {brecha !== null && (
            <span className="hidden font-semibold text-warning min-[1400px]:inline" title="Brecha del paralelo frente al BCV dólar">
              {formatearBrecha(brecha)}
            </span>
          )}
        </button>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">Tasas del día</p>
            <p className="text-xs text-muted-foreground">
              {t?.fecha_bcv ? `BCV con fecha valor ${fechaDMA(t.fecha_bcv)}` : "Sin tasa BCV registrada"}
            </p>
          </div>
          {showButton && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 rounded-full"
              onClick={handleRefresh}
              disabled={refreshing}
              aria-label="Actualizar tasas"
              title="Consultar BCV y paralelo ahora"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            </Button>
          )}
        </div>
        <dl className="mt-2 space-y-1">
          {filas.map((f) => (
            <div key={f.etiqueta} className="flex items-baseline justify-between gap-2 text-sm">
              <dt className="text-muted-foreground">{f.etiqueta}</dt>
              <dd className="font-semibold tabular-nums">Bs. {formatearTasa(f.valor)}</dd>
            </div>
          ))}
          {brecha !== null && (
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <dt className="text-muted-foreground">Brecha paralelo vs BCV $</dt>
              <dd className={cn("font-semibold tabular-nums", brecha > 0 && "text-warning")}>{formatearBrecha(brecha)}</dd>
            </div>
          )}
        </dl>
        {t?.fecha_paralelo && t.fecha_paralelo !== t.fecha && (
          <p className="mt-1 text-[11px] text-muted-foreground">Paralelo del {fechaDMA(t.fecha_paralelo)}</p>
        )}
        {t?.proxima_fecha && (
          <p className="mt-2 rounded-md bg-muted px-2 py-1.5 text-xs">
            BCV para el {diaLargo(t.proxima_fecha)}: $ {formatearTasa(t.proxima_bcv_usd)} · € {formatearTasa(t.proxima_bcv_eur)}
          </p>
        )}
        <Link to={RUTA_TASAS} className="mt-2 inline-block text-xs font-medium text-primary hover:underline">
          Ver historial de tasas
        </Link>
      </PopoverContent>
    </Popover>
  );
}
