import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";

// Lo pagado de un pedido frente a su total (migración 19x): si el pedido se editó después de pagar, muestra cuánto falta o
// cuánto quedó a favor del cliente. Solo aplica a pedidos creados en GUDS (los de Odoo se cobran contra facturas).
interface Resumen { total: number; verificado: number; por_verificar: number; falta: number; a_favor: number }

export const ResumenPagoPedido = ({ ordenId, recarga = 0, className = "" }: { ordenId: string; recarga?: number; className?: string }) => {
  const { formatPrice } = useCurrency();
  const [r, setR] = useState<Resumen | null>(null);

  useEffect(() => {
    let activo = true;
    supabase.rpc("resumen_pago_orden", { p_orden_id: ordenId }).then(({ data }) => {
      const fila = (Array.isArray(data) ? data[0] : data) as Resumen | null;
      if (activo) setR(fila ?? null);
    });
    return () => { activo = false; };
  }, [ordenId, recarga]);

  const pagado = r ? Number(r.verificado) + Number(r.por_verificar) : 0;
  if (!r || pagado <= 0) return null;
  return (
    <div className={`rounded-md border border-border bg-muted/30 px-3 py-2 text-sm ${className}`} data-testid="resumen-pago-pedido">
      <div className="flex justify-between"><span className="text-muted-foreground">Pagado</span><span className="tabular-nums">{formatPrice(pagado)}</span></div>
      {Number(r.por_verificar) > 0 && (
        <p className="text-xs text-muted-foreground">{formatPrice(Number(r.por_verificar))} por verificar</p>
      )}
      {Number(r.falta) > 0 && (
        <div className="mt-1 flex justify-between font-medium text-destructive"><span>Falta por pagar</span><span className="tabular-nums">{formatPrice(Number(r.falta))}</span></div>
      )}
      {Number(r.a_favor) > 0 && (
        <div className="mt-1 flex justify-between font-medium text-success"><span>Saldo a favor</span><span className="tabular-nums">{formatPrice(Number(r.a_favor))}</span></div>
      )}
      {Number(r.falta) <= 0 && Number(r.a_favor) <= 0 && <p className="mt-1 text-xs text-success">El pago cubre el total.</p>}
    </div>
  );
};

/** Texto para el aviso al guardar una edición: cuánto falta o cuánto queda a favor según lo ya pagado. */
export const textoPagoEdicion = (r: { pagado?: number; falta?: number; a_favor?: number }, formatPrice: (n: number) => string) => {
  if (!r.pagado || r.pagado <= 0) return "";
  if ((r.falta ?? 0) > 0) return ` Ya pagado ${formatPrice(r.pagado)}: falta ${formatPrice(r.falta!)}.`;
  if ((r.a_favor ?? 0) > 0) return ` Ya pagado ${formatPrice(r.pagado)}: quedan ${formatPrice(r.a_favor!)} a favor.`;
  return " El pago cubre el total.";
};
