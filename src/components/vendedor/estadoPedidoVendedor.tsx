import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { claseTono, estadoVisible, type ClaveEstado, type EstadoVisible, type PedidoParaEstado } from "@/components/pedidos/estadoPedido";

// Estado visible del pedido para el vendedor: la misma etiqueta y el mismo tono que ven el cliente y el admin
// (components/pedidos/estadoPedido.ts, contrato de docs/PLAN-PORTALES-Y-FLUJOS.md §3), con el mensaje dicho para el vendedor
// (el compartido le habla al cliente: "tu pedido…"). El vendedor no ve el error técnico del envío a Odoo, solo que hay un problema.

const MENSAJE: Record<ClaveEstado, string> = {
  rechazado: "Administración no aprobó este pedido. Puedes duplicarlo, corregirlo y enviarlo de nuevo.",
  cancelado: "El pedido fue cancelado.",
  por_aprobar: "Administración lo revisa (precios, stock y crédito). Te avisaremos al aprobarlo; mientras tanto puedes editarlo.",
  registrandose: "Aprobado. Se está registrando para su preparación.",
  cotizacion: "Cotización en revisión.",
  confirmado: "Confirmado. En cola de preparación.",
  en_preparacion: "Confirmado. Lo están preparando en el almacén.",
  despachado_parcial: "Parte del pedido ya salió del almacén.",
  entregado: "El pedido salió del almacén.",
};

export interface PedidoEstadoVendedor extends PedidoParaEstado {
  rechazo_motivo?: string | null;
}

export const estadoPedidoVendedor = (p: PedidoEstadoVendedor): EstadoVisible => {
  const e = estadoVisible(p);
  if (e.clave === "registrandose" && p.odoo_envio_error) {
    return { ...e, mensaje: "Aprobado, pero hubo un problema al registrarlo para su preparación. Administración lo está resolviendo; no tienes que hacer nada." };
  }
  return { ...e, mensaje: MENSAJE[e.clave] ?? e.mensaje };
};

/** Insignia del estado visible (mismo texto y tono en la lista y en el detalle). */
export const EstadoPedidoBadge = ({ pedido, className }: { pedido: PedidoEstadoVendedor; className?: string }) => {
  const e = estadoVisible(pedido);
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap font-medium", claseTono[e.tono], className)} data-testid="estado-pedido">
      {e.etiqueta}
    </Badge>
  );
};
