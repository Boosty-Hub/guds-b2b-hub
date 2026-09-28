import { AlertTriangle, Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCurrency } from "@/contexts/CurrencyContext";
import { cn } from "@/lib/utils";
import type { Cotizacion } from "@/hooks/useCotizacion";
import { textoPct } from "@/lib/iva";

// Desglose del total que calcula el servidor (cotizar_pedido): Subtotal, Descuento, IVA, Envío y Total. Compartido por el
// checkout y el carrito del portal, el editor de pedidos por aprobar, el pedido del vendedor y la orden del admin.

interface Props {
  cotizacion: Cotizacion | null;
  cargando: boolean;
  error: string | null;
  reintentar: () => void;
  /** Cómo se muestra un envío en 0: "Gratis" (regla del portal) o "Sin envío" (cargo manual del vendedor). */
  envioCero?: string;
  /** Texto cuando todavía no hay nada que cotizar (p. ej. falta elegir el cliente). */
  vacio?: string;
  tituloTotal?: string;
  claseTotal?: string;
  className?: string;
}

/** Tasa del IVA del pedido según sus líneas: "exento", "16 %" o "según producto" si hay varias tasas. */
const tasaPedido = (c: Cotizacion) => {
  const tasas = [...new Set(c.lineas.map((l) => Number(l.impuesto_pct)))];
  if (tasas.length === 0) return null;
  if (tasas.length > 1) return "según producto";
  return tasas[0] === 0 ? "exento" : textoPct(tasas[0]);
};

export const ResumenCotizacion = ({
  cotizacion: c, cargando, error, reintentar, envioCero = "Gratis", vacio, tituloTotal = "Total", claseTotal = "", className = "",
}: Props) => {
  const { formatPrice } = useCurrency();

  if (error) {
    return (
      <div className={cn("space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm", className)} role="alert" data-testid="cotizacion-error">
        <p className="flex gap-2 text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error} Sin el cálculo no mostramos un total.</span>
        </p>
        <Button type="button" size="sm" variant="outline" className="h-9 gap-1.5" onClick={reintentar}>
          <RotateCw className="h-3.5 w-3.5" />Reintentar
        </Button>
      </div>
    );
  }

  if (!c) {
    if (!cargando && !vacio) return null;
    return (
      <p className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)} data-testid="cotizacion-cargando">
        {cargando ? <><Loader2 className="h-4 w-4 animate-spin" />Calculando el total…</> : vacio}
      </p>
    );
  }

  const tasa = tasaPedido(c);
  return (
    <div className={cn("space-y-1.5 text-sm", className)} data-testid="cotizacion" aria-busy={cargando}>
      <div className={cn("space-y-1.5 transition-opacity", cargando && "opacity-60")}>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="tabular-nums" data-testid="cotizacion-subtotal">{formatPrice(c.subtotal)}</span>
        </div>
        {c.descuento > 0 && (
          <div className="flex justify-between gap-2 text-green-600">
            <span>Descuento</span>
            <span className="tabular-nums" data-testid="cotizacion-descuento">-{formatPrice(c.descuento)}</span>
          </div>
        )}
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">IVA{tasa ? <span className="text-xs"> · {tasa}</span> : null}</span>
          <span className="tabular-nums" data-testid="cotizacion-iva">{formatPrice(c.impuesto)}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">Envío</span>
          <span className={cn("tabular-nums", c.envio === 0 && envioCero === "Gratis" && "text-green-600")} data-testid="cotizacion-envio">
            {c.envio > 0 ? formatPrice(c.envio) : envioCero}
          </span>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border pt-2 text-base font-semibold">
        <span className="flex items-center gap-1.5">
          {tituloTotal}
          {cargando && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Actualizando el total" />}
        </span>
        <span className={cn("tabular-nums", cargando && "opacity-60", claseTotal)} data-testid="cotizacion-total">{formatPrice(c.total)}</span>
      </div>
      {c.aviso && <p className="text-xs text-amber-700" data-testid="cotizacion-aviso">{c.aviso}</p>}
    </div>
  );
};
