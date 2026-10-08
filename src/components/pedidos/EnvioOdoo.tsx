// Estado de un pedido de GUDS frente a la aprobación y el envío a Odoo (fase 9b). Lo comparten Órdenes y Consignación (22b):
// un pedido aprobado se crea en Odoo como cotización en borrador; si falla, queda el error y se puede reintentar.
import { useState } from "react";
import { AlertTriangle, Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";

export interface PedidoEnvio {
  aprobacion?: string | null;
  odoo_id?: number | null;
  odoo_envio_error?: string | null;
  odoo_envio_aviso?: string | null;
}

/** Insignia del envío: por aprobar, rechazado, enviando o error. Null cuando ya está en Odoo (o vino de Odoo). */
export const estadoEnvioOdoo = (o: PedidoEnvio): { txt: string; cls: string } | null =>
  o.aprobacion === "pendiente" ? { txt: "Por aprobar", cls: "border-amber-300 bg-amber-100 text-amber-900" }
  : o.aprobacion === "rechazada" ? { txt: "Rechazado", cls: "border-destructive/40 bg-destructive/10 text-destructive" }
  : o.aprobacion === "aprobada" && !o.odoo_id
    ? (o.odoo_envio_error
      ? { txt: "Error al enviar a Odoo", cls: "border-destructive/40 bg-destructive/10 text-destructive" }
      : { txt: "Enviando a Odoo…", cls: "border-sky-300 bg-sky-100 text-sky-900" })
  : null;

/** Vuelve a disparar el envío de un pedido aprobado que no llegó a Odoo. Devuelve el mensaje de error, si lo hubo. */
export async function reintentarEnvioPedido(ordenId: string): Promise<string | null> {
  const { error } = await supabase.rpc("reintentar_envio_pedido", { p_orden_id: ordenId });
  return error ? error.message : null;
}

/** Panel del pedido aprobado que aún no está en Odoo: creando la cotización, o el error con el botón Reintentar. */
export function PanelEnvioOdoo({ orden, onReintentar, textoEnviando = "Aprobado · creando la cotización en Odoo…" }: {
  orden: PedidoEnvio;
  onReintentar: () => Promise<void> | void;
  textoEnviando?: string;
}) {
  const [reintentando, setReintentando] = useState(false);
  if (orden.aprobacion !== "aprobada" || orden.odoo_id) return null;
  if (orden.odoo_envio_error) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-[13px]" data-testid="envio-odoo-error">
        <p className="mb-1 flex items-center gap-1.5 font-semibold text-destructive"><AlertTriangle className="h-4 w-4" /> No se pudo crear en Odoo</p>
        <p className="mb-2 break-words text-xs">{orden.odoo_envio_error}</p>
        <Button size="sm" variant="outline" className="gap-1.5" disabled={reintentando}
          onClick={async () => { setReintentando(true); try { await onReintentar(); } finally { setReintentando(false); } }}>
          {reintentando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />} Reintentar
        </Button>
      </div>
    );
  }
  return (
    <p className="flex items-center gap-1.5 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-[13px] text-sky-900" data-testid="envio-odoo-enviando">
      <Loader2 className="h-3.5 w-3.5 animate-spin" /> {textoEnviando}
    </p>
  );
}
