import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, MapPin, MapPinned } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { EditorUbicacionDialog } from "@/components/delivery/EditorUbicacionDialog";
import {
  SEL_UBICACION, claveDestino, estadoUbicacion, ETIQUETA_UBICACION, fmtPrecision, type DestinoEntrega, type Ubicacion,
} from "@/components/delivery/ubicaciones";

/** Botón "Ubicación para delivery" de la ficha del cliente: lista la dirección principal y las direcciones de entrega
 *  (sucursales) con su ubicación en el mapa y abre el editor. Las ubicaciones son de GUDS: no van a Odoo. */
export function BotonUbicacionesCliente({ clienteId, clienteNombre }: { clienteId: string; clienteNombre: string }) {
  const [abierto, setAbierto] = useState(false);
  const [editar, setEditar] = useState<DestinoEntrega | null>(null);
  const [cargando, setCargando] = useState(false);
  const [destinos, setDestinos] = useState<DestinoEntrega[]>([]);
  const [ubic, setUbic] = useState<Map<string, Ubicacion>>(new Map());

  const cargar = useCallback(async () => {
    setCargando(true);
    const [cRes, dRes, uRes] = await Promise.all([
      supabase.from("clientes").select("direccion, ciudad, estado").eq("id", clienteId).maybeSingle(),
      supabase.from("cliente_direcciones").select("id, nombre, direccion, ciudad, estado").eq("cliente_id", clienteId).eq("activo", true).order("nombre"),
      supabase.from("ubicaciones_entrega").select(SEL_UBICACION).eq("cliente_id", clienteId),
    ]);
    const c = cRes.data as { direccion: string | null; ciudad: string | null; estado: string | null } | null;
    setDestinos([
      { cliente_id: clienteId, direccion_id: null, cliente: clienteNombre, sucursal: null, direccion: c?.direccion ?? null, ciudad: c?.ciudad ?? null, region: c?.estado ?? null },
      ...((dRes.data as { id: string; nombre: string | null; direccion: string | null; ciudad: string | null; estado: string | null }[] | null) ?? [])
        .map((d) => ({ cliente_id: clienteId, direccion_id: d.id, cliente: clienteNombre, sucursal: d.nombre || "Dirección de entrega", direccion: d.direccion, ciudad: d.ciudad, region: d.estado })),
    ]);
    setUbic(new Map(((uRes.data as Ubicacion[] | null) ?? []).map((u) => [claveDestino(u.cliente_id, u.direccion_id)!, u])));
    setCargando(false);
  }, [clienteId, clienteNombre]);
  useEffect(() => { if (abierto) cargar(); }, [abierto, cargar]);

  return (
    <>
      <Button size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-xs" onClick={() => setAbierto(true)}>
        <MapPinned className="h-3.5 w-3.5" /> Ubicación para delivery
      </Button>
      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Ubicación para delivery</DialogTitle>
            <DialogDescription>{clienteNombre} · el pin en el mapa lo usan las rutas y el repartidor. Se guarda en GUDS (no en Odoo).</DialogDescription>
          </DialogHeader>
          {cargando ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div> : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {destinos.map((d) => {
                const u = ubic.get(claveDestino(d.cliente_id, d.direccion_id)!) ?? null;
                const e = estadoUbicacion(u);
                return (
                  <li key={d.direccion_id ?? "principal"} className="flex items-center justify-between gap-2 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{d.sucursal ?? "Dirección principal"}</p>
                      <p className="truncate text-xs text-muted-foreground">{[d.direccion, d.ciudad].filter(Boolean).join(" · ") || "Sin dirección en Odoo"}</p>
                      <p className={`text-[11px] ${ETIQUETA_UBICACION[e].cls}`}>{ETIQUETA_UBICACION[e].label}{u && !u.confirmada ? ` · GPS ${fmtPrecision(u.precision_m)}` : ""}</p>
                    </div>
                    <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1 px-2 text-xs" onClick={() => { setAbierto(false); setEditar(d); }}>
                      <MapPin className="h-3.5 w-3.5" />{e === "sin" ? "Ubicar" : e === "propuesta" ? "Revisar" : "Ver / editar"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </DialogContent>
      </Dialog>
      <EditorUbicacionDialog destino={editar} onClose={() => { setEditar(null); setAbierto(true); }} />
    </>
  );
}
