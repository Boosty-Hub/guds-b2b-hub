import { useEffect, useState } from "react";
import {
  CheckCircle2, CircleDot, ClipboardCheck, FileText, Loader2, PackageCheck, PencilLine, Send, Truck, XCircle, CalendarClock, AlertTriangle, Wallet, Ban,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

// Línea de tiempo de un pedido (migración 20d: orden_eventos). La usan el portal del cliente, el del vendedor y el admin.
interface Evento { id: number; tipo: string; detalle: string | null; origen: string; fecha: string }

const HITO: Record<string, { etiqueta: string; icono: typeof CircleDot; tono: string }> = {
  creado: { etiqueta: "Pedido creado", icono: CircleDot, tono: "text-muted-foreground" },
  editado: { etiqueta: "Pedido editado", icono: PencilLine, tono: "text-muted-foreground" },
  aprobado: { etiqueta: "Aprobado", icono: ClipboardCheck, tono: "text-sky-700" },
  rechazado: { etiqueta: "No aprobado", icono: XCircle, tono: "text-destructive" },
  enviado_odoo: { etiqueta: "Registrado para preparación", icono: Send, tono: "text-sky-700" },
  confirmado: { etiqueta: "Confirmado", icono: CheckCircle2, tono: "text-sky-700" },
  despachado: { etiqueta: "Despachado", icono: PackageCheck, tono: "text-indigo-700" },
  en_camino: { etiqueta: "En camino", icono: Truck, tono: "text-indigo-700" },
  entregado: { etiqueta: "Entregado", icono: CheckCircle2, tono: "text-success" },
  entrega_incompleta: { etiqueta: "Entregado incompleto", icono: AlertTriangle, tono: "text-amber-700" },
  entrega_rechazada: { etiqueta: "Entrega rechazada", icono: XCircle, tono: "text-destructive" },
  reprogramado: { etiqueta: "Entrega reprogramada", icono: CalendarClock, tono: "text-amber-700" },
  facturado: { etiqueta: "Facturado", icono: FileText, tono: "text-foreground" },
  pagado: { etiqueta: "Pagado", icono: Wallet, tono: "text-success" },
  cancelado: { etiqueta: "Cancelado", icono: Ban, tono: "text-muted-foreground" },
};

export const LineaTiempoPedido = ({ ordenId, recarga = 0, mostrarOrigen = false, className }: {
  ordenId: string;
  recarga?: number;
  /** El admin ve si el hito vino de Odoo o de GUDS. */
  mostrarOrigen?: boolean;
  className?: string;
}) => {
  const [eventos, setEventos] = useState<Evento[] | null>(null);

  useEffect(() => {
    let activo = true;
    setEventos(null);
    supabase.from("orden_eventos").select("id, tipo, detalle, origen, fecha").eq("orden_id", ordenId).order("fecha").order("id")
      .then(({ data }) => { if (activo) setEventos((data as Evento[] | null) ?? []); });
    return () => { activo = false; };
  }, [ordenId, recarga]);

  if (eventos === null) return <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
  if (eventos.length === 0) return <p className="py-2 text-sm text-muted-foreground">Sin movimientos registrados.</p>;
  return (
    <ol className={cn("relative ml-2 space-y-3 border-l border-border pl-5", className)} aria-label="Línea de tiempo del pedido">
      {eventos.map((e) => {
        const h = HITO[e.tipo] ?? { etiqueta: e.tipo, icono: CircleDot, tono: "text-muted-foreground" };
        const Icono = h.icono;
        return (
          <li key={e.id} className="relative">
            <span className="absolute -left-[29px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-background">
              <Icono className={cn("h-4 w-4", h.tono)} aria-hidden />
            </span>
            <p className="text-sm font-medium leading-tight">
              {h.etiqueta}
              {mostrarOrigen && e.origen === "odoo" && <span className="ml-1.5 rounded border border-border px-1 text-[10px] font-normal text-muted-foreground">Odoo</span>}
            </p>
            <p className="text-xs text-muted-foreground">
              {new Date(e.fecha).toLocaleString("es-VE", { dateStyle: "medium", timeStyle: "short" })}
              {e.detalle ? ` · ${e.detalle}` : ""}
            </p>
          </li>
        );
      })}
    </ol>
  );
};
