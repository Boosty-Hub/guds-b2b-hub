import { Badge } from "@/components/ui/badge";

export interface TransferenciaRow {
  id: string; numero: string; tipo: string; tipo_operacion: string | null; estado: string; origen: string | null; contacto: string | null;
  fecha_programada: string | null; fecha_realizada: string | null; almacen_origen_id: string | null; almacen_destino_id: string | null;
  ubicacion_origen: string | null; ubicacion_destino: string | null;
  cliente?: { id: string; nombre_negocio: string } | null;
  proveedor?: { id: string; nombre: string } | null;
  orden?: { id: string; numero: string } | null;
}
export const TIPO_TRANSF: Record<string, string> = { entrega: "Entrega", recepcion: "Recepción", interna: "Traslado interno", otra: "Otra" };
export const ESTADO_TRANSF: Record<string, { label: string; cls: string }> = {
  borrador: { label: "Borrador", cls: "text-muted-foreground" },
  en_espera: { label: "En espera", cls: "border-warning/60 bg-warning/15 text-foreground" },
  parcial: { label: "Parcial", cls: "border-warning/60 bg-warning/15 text-foreground" },
  lista: { label: "Lista", cls: "border-primary/40 bg-primary/10 text-primary" },
  hecha: { label: "Hecha", cls: "border-success/40 bg-success/10 text-success" },
  cancelada: { label: "Cancelada", cls: "border-destructive/40 bg-destructive/10 text-destructive" },
};
export const PENDIENTES = ["borrador", "en_espera", "parcial", "lista"];
export const fmtFechaHora = (d?: string | null) => (d ? new Date(d).toLocaleString("es-VE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

export function EstadoTransferencia({ estado }: { estado: string }) {
  const e = ESTADO_TRANSF[estado] ?? { label: estado, cls: "" };
  return <Badge variant="outline" className={`whitespace-nowrap font-normal ${e.cls}`}>{e.label}</Badge>;
}

