import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface TasaBcvProps {
  /** Muestra el botón de actualización manual (por defecto sí). */
  showButton?: boolean;
  className?: string;
}

function formatFecha(iso: string | null): string {
  if (!iso) return "sin actualizar";
  const d = new Date(iso.replace(" ", "T"));
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("es-VE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TasaBcv({ showButton = true, className }: TasaBcvProps) {
  const { exchangeRate, tasaActualizada, tasaFuente, refreshing, refreshTasa } = useCurrency();
  const { toast } = useToast();

  const handleRefresh = async () => {
    const res = await refreshTasa();
    if (res.ok) {
      toast({
        title: "Tasa BCV actualizada",
        description: `Bs. ${(res.tasa ?? exchangeRate).toLocaleString("es-VE", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })} · ${res.fuente ?? "BCV"}`,
      });
    } else {
      toast({
        title: "No se pudo actualizar la tasa",
        description: res.error ?? "Intenta de nuevo en un momento.",
        variant: "destructive",
      });
    }
  };

  const rateLabel =
    exchangeRate > 0
      ? exchangeRate.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : "—";

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-full border border-border bg-muted/50 pl-3 pr-1 py-1",
        className,
      )}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-baseline gap-1 cursor-default">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              BCV
            </span>
            <span className="text-sm font-semibold text-foreground tabular-nums">
              Bs. {rateLabel}
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p className="text-xs">Tasa oficial del dólar (BCV)</p>
          <p className="text-xs text-muted-foreground">
            Actualizada: {formatFecha(tasaActualizada)}
          </p>
          {tasaFuente && (
            <p className="text-xs text-muted-foreground">Fuente: {tasaFuente}</p>
          )}
        </TooltipContent>
      </Tooltip>

      {showButton && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-full"
              onClick={handleRefresh}
              disabled={refreshing}
              aria-label="Actualizar tasa BCV"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p className="text-xs">Actualizar tasa desde el BCV</p>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
