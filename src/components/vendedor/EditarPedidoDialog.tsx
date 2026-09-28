import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EditorPedidoPendiente } from "@/components/portal/EditorPedidoPendiente";
import type { ResultadoEdicion } from "@/components/portal/pedidoEditable";

interface Props {
  orden: { id: string; numero: string; vendedor_id: string | null; cliente?: { nombre_negocio: string } | null } | null;
  onCerrar: () => void;
  onGuardado: (r: ResultadoEdicion) => void;
  onYaNoEditable: (mensaje: string) => void;
}

// Editar un pedido «Por aprobar» de un cliente de la cartera: líneas, cantidades, productos, notas y cargo de envío.
// Usa el mismo editor que el portal del cliente; el servidor (editar_pedido_pendiente) recalcula el total.
export const EditarPedidoDialog = ({ orden, onCerrar, onGuardado, onYaNoEditable }: Props) => (
  <Dialog open={!!orden} onOpenChange={(v) => { if (!v) onCerrar(); }}>
    <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col gap-0 p-0 supports-[height:100dvh]:max-h-[90dvh]">
      {orden && (
        <>
          <DialogHeader className="border-b border-border px-4 py-3 pr-12 text-left">
            <DialogTitle>Editar pedido {orden.numero}</DialogTitle>
            <DialogDescription>
              {orden.cliente?.nombre_negocio || "Cliente"} · {orden.vendedor_id ? "pedido tomado por vendedor" : "pedido hecho por el cliente en el portal"}.
              {" "}Sigue por aprobar; el total final lo calcula GUDS al guardar.
            </DialogDescription>
          </DialogHeader>
          <EditorPedidoPendiente
            key={orden.id}
            ordenId={orden.id}
            modo="vendedor"
            claseAcento="bg-emerald-500 text-white hover:bg-emerald-600"
            onCancelar={onCerrar}
            onGuardado={onGuardado}
            onYaNoEditable={onYaNoEditable}
          />
        </>
      )}
    </DialogContent>
  </Dialog>
);
