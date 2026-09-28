import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ImageOff, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fechaHora } from "@/components/delivery/fechas";

export interface EntregaDetalle {
  id: string;
  estado: string;
  prioridad: string | null;
  fecha_asignacion: string | null;
  fecha_inicio_entrega: string | null;
  fecha_entrega: string | null;
  receptor_nombre: string | null;
  notas: string | null;
  motivo_fallo: string | null;
  firma_url: string | null;
  foto_entrega_url: string | null;
  orden?: { numero: string; cliente?: { nombre_negocio: string } | null } | null;
  repartidor?: { nombre: string; apellido: string | null } | null;
}

const ESTADO: Record<string, { label: string; cls: string }> = {
  asignada: { label: "Asignada", cls: "" },
  en_camino: { label: "En camino", cls: "border-amber-300 bg-amber-50 text-amber-900" },
  entregada: { label: "Entregada", cls: "border-emerald-300 bg-emerald-50 text-emerald-800" },
  fallida: { label: "Fallida", cls: "border-red-300 bg-red-50 text-red-800" },
};

// La evidencia vive en el bucket PRIVADO "evidencias-entrega" (se guarda la ruta <entrega>/<archivo>): se abre con una
// URL firmada de 1 hora. Las entregas viejas podían tener una URL pública completa: se usa tal cual.
const URL_FIRMADA_SEG = 3600;
async function urlEvidencia(ruta: string | null): Promise<string | null> {
  if (!ruta) return null;
  if (/^https?:\/\//.test(ruta)) return ruta;
  const { data, error } = await supabase.storage.from("evidencias-entrega").createSignedUrl(ruta, URL_FIRMADA_SEG);
  if (error || !data?.signedUrl) throw new Error(error?.message || "sin URL");
  return data.signedUrl;
}

function Evidencia({ titulo, ruta, fondoBlanco }: { titulo: string; ruta: string | null; fondoBlanco?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [estado, setEstado] = useState<"cargando" | "ok" | "vacio" | "error">(ruta ? "cargando" : "vacio");
  useEffect(() => {
    let vivo = true;
    if (!ruta) { setEstado("vacio"); return; }
    setEstado("cargando");
    urlEvidencia(ruta)
      .then((u) => { if (vivo) { setUrl(u); setEstado(u ? "ok" : "vacio"); } })
      .catch(() => { if (vivo) setEstado("error"); });
    return () => { vivo = false; };
  }, [ruta]);
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs font-medium text-muted-foreground">{titulo}</p>
      <div className={`flex min-h-[120px] items-center justify-center overflow-hidden rounded-lg border border-border ${fondoBlanco ? "bg-white" : "bg-muted/40"}`}>
        {estado === "cargando" && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
        {estado === "vacio" && <span className="text-xs text-muted-foreground">Sin {titulo.toLowerCase()}</span>}
        {estado === "error" && <span className="flex items-center gap-1.5 px-3 text-center text-xs text-destructive"><ImageOff className="h-4 w-4 shrink-0" />No se pudo abrir la evidencia</span>}
        {estado === "ok" && url && (
          <a href={url} target="_blank" rel="noopener noreferrer" title="Abrir en tamaño completo" className="block w-full">
            <img src={url} alt={titulo} className="max-h-72 w-full object-contain" onError={() => setEstado("error")} />
          </a>
        )}
      </div>
    </div>
  );
}

const Dato = ({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) => (
  <div className="min-w-0">
    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{etiqueta}</p>
    <p className="break-words text-sm">{children}</p>
  </div>
);

/** Detalle de un envío para el admin: tiempos, receptor y la evidencia (firma y foto) de la entrega cerrada. */
export function DetalleEntregaDialog({ entrega, onClose }: { entrega: EntregaDetalle | null; onClose: () => void }) {
  const e = entrega;
  const cerrada = e?.estado === "entregada" || e?.estado === "fallida";
  return (
    <Dialog open={!!e} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        {e && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
                Envío {e.orden?.numero || ""}
                <Badge variant="outline" className={ESTADO[e.estado]?.cls}>{ESTADO[e.estado]?.label || e.estado}</Badge>
              </DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Dato etiqueta="Cliente">{e.orden?.cliente?.nombre_negocio || "—"}</Dato>
              <Dato etiqueta="Repartidor">{e.repartidor ? `${e.repartidor.nombre} ${e.repartidor.apellido || ""}` : "—"}</Dato>
              <Dato etiqueta="Prioridad">{e.prioridad === "alta" ? "Alta" : "Normal"}</Dato>
              <Dato etiqueta="Asignada">{fechaHora(e.fecha_asignacion)}</Dato>
              <Dato etiqueta="Salió a ruta">{fechaHora(e.fecha_inicio_entrega)}</Dato>
              {e.estado === "entregada" && <Dato etiqueta="Entregada">{fechaHora(e.fecha_entrega)}</Dato>}
              {e.estado === "entregada" && <Dato etiqueta="Recibió">{e.receptor_nombre || "—"}</Dato>}
              {e.estado === "fallida" && <div className="col-span-2 sm:col-span-3"><Dato etiqueta="Motivo del fallo">{e.motivo_fallo || "—"}</Dato></div>}
              {e.notas && <div className="col-span-2 sm:col-span-3"><Dato etiqueta="Notas del repartidor">{e.notas}</Dato></div>}
            </div>
            {cerrada ? (
              <div className="grid grid-cols-1 gap-3 border-t border-border pt-3 sm:grid-cols-2">
                <Evidencia titulo="Firma" ruta={e.firma_url} fondoBlanco />
                <Evidencia titulo="Foto" ruta={e.foto_entrega_url} />
              </div>
            ) : (
              <p className="border-t border-border pt-3 text-xs text-muted-foreground">La firma y la foto se ven aquí cuando el repartidor cierra la entrega.</p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
