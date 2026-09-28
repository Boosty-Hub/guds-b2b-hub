import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Loader2, MapPin, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/contexts/PermissionsContext";
import { SelectorPin } from "@/components/mapas/SelectorPin";
import { enVenezuela, verEnGoogle, type Punto } from "@/components/mapas/geo";
import { fechaHora } from "@/components/delivery/fechas";
import {
  ubicacionDeDestino, estadoUbicacion, fmtPrecision, textoBusqueda, cargarPuntoSalida, type DestinoEntrega, type Ubicacion, type PuntoSalida,
} from "@/components/delivery/ubicaciones";

const fmtCoord = (p: Punto) => `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;

/** Editor de la ubicación de entrega de un destino (cliente o sucursal): busca la dirección para centrar el mapa, la
 *  persona pone o arrastra el pin y guarda (queda confirmada). Si hay una propuesta del GPS de una entrega, se confirma
 *  con un clic. Nada de esto va a Odoo. */
export function EditorUbicacionDialog({ destino, onClose, onGuardado }: { destino: DestinoEntrega | null; onClose: () => void; onGuardado?: () => void }) {
  const { toast } = useToast();
  const { can } = usePermissions();
  const puedeEditar = can("delivery", "editar") || can("clientes", "editar");
  const [cargando, setCargando] = useState(false);
  const [actual, setActual] = useState<Ubicacion | null>(null);
  const [pin, setPin] = useState<Punto | null>(null);
  const [movido, setMovido] = useState(false);
  const [busy, setBusy] = useState<"" | "guardar" | "confirmar" | "quitar">("");
  const [seguroQuitar, setSeguroQuitar] = useState(false);
  const clave = destino ? `${destino.cliente_id}:${destino.direccion_id ?? ""}` : "";

  useEffect(() => {
    setActual(null); setPin(null); setMovido(false); setSeguroQuitar(false);
    if (!destino) return;
    let vivo = true;
    setCargando(true);
    ubicacionDeDestino(destino)
      .then((u) => { if (vivo) { setActual(u); setPin(u ? { lat: u.latitud, lng: u.longitud } : null); } })
      .catch((e) => toast({ title: "No se pudo leer la ubicación", description: (e as Error).message, variant: "destructive" }))
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [clave]); // eslint-disable-line react-hooks/exhaustive-deps

  const estado = estadoUbicacion(actual);
  const fuera = !!pin && !enVenezuela(pin);

  const terminar = (titulo: string) => { toast({ title: titulo, description: destino ? `${destino.cliente}${destino.sucursal ? ` › ${destino.sucursal}` : ""}` : undefined }); onGuardado?.(); onClose(); };

  const guardar = async () => {
    if (!destino || !pin) return;
    setBusy("guardar");
    const { error } = await supabase.rpc("guardar_ubicacion_entrega", { p_cliente_id: destino.cliente_id, p_direccion_id: destino.direccion_id, p_lat: pin.lat, p_lng: pin.lng, p_precision: null });
    setBusy("");
    if (error) { toast({ title: "No se pudo guardar la ubicación", description: error.message, variant: "destructive" }); return; }
    terminar("Ubicación guardada");
  };
  const confirmar = async () => {
    if (!actual) return;
    setBusy("confirmar");
    const { error } = await supabase.rpc("confirmar_ubicacion_entrega", { p_ubicacion_id: actual.id });
    setBusy("");
    if (error) { toast({ title: "No se pudo confirmar", description: error.message, variant: "destructive" }); return; }
    terminar("Ubicación confirmada");
  };
  const quitar = async () => {
    if (!actual) return;
    if (!seguroQuitar) { setSeguroQuitar(true); return; }
    setBusy("quitar");
    const { error } = await supabase.rpc("borrar_ubicacion_entrega", { p_ubicacion_id: actual.id });
    setBusy("");
    if (error) { toast({ title: "No se pudo quitar la ubicación", description: error.message, variant: "destructive" }); return; }
    terminar("Ubicación quitada");
  };

  return (
    <Dialog open={!!destino} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-h-[96dvh] overflow-y-auto sm:max-w-3xl">
        {destino && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
                <MapPin className="h-4 w-4 text-primary" />Ubicación de entrega
                {!cargando && (
                  <Badge variant="outline" className={`font-normal ${estado === "confirmada" ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200" : estado === "propuesta" ? "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200" : ""}`}>
                    {estado === "confirmada" ? "Confirmada" : estado === "propuesta" ? "Propuesta por GPS" : "Sin ubicación"}
                  </Badge>
                )}
              </DialogTitle>
              <DialogDescription className="text-left">
                <span className="font-medium text-foreground">{destino.cliente}</span>{destino.sucursal ? ` › ${destino.sucursal}` : ""}
                {(destino.direccion || destino.ciudad) && <span className="block">{[destino.direccion, destino.ciudad].filter(Boolean).join(" · ")}</span>}
              </DialogDescription>
            </DialogHeader>

            {cargando ? (
              <div className="flex h-[300px] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
            ) : (
              <div className="space-y-2">
                {actual && (
                  <p className="rounded-md bg-muted/60 px-3 py-1.5 text-xs text-muted-foreground">
                    {actual.confirmada
                      ? <>Confirmada {actual.fuente === "gps_entrega" ? "(GPS de una entrega)" : "(pin puesto en el mapa)"} · {fechaHora(actual.confirmada_at)}</>
                      : <>Propuesta por el GPS del teléfono al cerrar una entrega {fmtPrecision(actual.precision_m)} · {fechaHora(actual.registrada_at)}. Revísala en el mapa y confírmala, o arrastra el pin y guarda.</>}
                    {" · "}<a className="text-primary underline" href={verEnGoogle({ lat: actual.latitud, lng: actual.longitud })} target="_blank" rel="noopener noreferrer">ver en Google Maps</a>
                  </p>
                )}
                <SelectorPin key={clave} pin={pin} soloLectura={!puedeEditar}
                  onPin={(p) => { setPin(p); setMovido(true); setSeguroQuitar(false); }}
                  busquedaInicial={textoBusqueda(destino)} />
                {pin && (
                  <p className={`text-xs ${fuera ? "text-destructive" : "text-muted-foreground"}`}>
                    Pin: <span className="font-mono">{fmtCoord(pin)}</span>{fuera ? " — queda fuera de Venezuela" : movido ? " (sin guardar)" : ""}
                  </p>
                )}
              </div>
            )}

            {puedeEditar && !cargando && (
              <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                <div>
                  {actual && (
                    <Button variant="ghost" className="w-full gap-1.5 text-destructive hover:text-destructive sm:w-auto" onClick={quitar} disabled={!!busy}>
                      {busy === "quitar" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}{seguroQuitar ? "¿Quitar? Confirmar" : "Quitar ubicación"}
                    </Button>
                  )}
                </div>
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  <Button variant="outline" onClick={onClose} disabled={!!busy}>Cancelar</Button>
                  {actual && !actual.confirmada && !movido && (
                    <Button variant="outline" className="gap-1.5 border-emerald-300 text-emerald-800 hover:bg-emerald-50 dark:text-emerald-200" onClick={confirmar} disabled={!!busy}>
                      {busy === "confirmar" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Confirmar propuesta
                    </Button>
                  )}
                  <Button onClick={guardar} disabled={!!busy || !pin || fuera || (!!actual && !movido)}
                    title={!pin ? "Toca el mapa para poner el pin" : actual && !movido ? "Mueve el pin para cambiar la ubicación" : undefined}>
                    {busy === "guardar" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar ubicación"}
                  </Button>
                </div>
              </DialogFooter>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Punto de salida de las rutas (almacén) para "Ordenar por cercanía". */
export function PuntoSalidaDialog({ abierto, onClose, onGuardado }: { abierto: boolean; onClose: () => void; onGuardado?: (p: PuntoSalida) => void }) {
  const { toast } = useToast();
  const [cargando, setCargando] = useState(false);
  const [pin, setPin] = useState<Punto | null>(null);
  const [nombre, setNombre] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    let vivo = true;
    setCargando(true);
    cargarPuntoSalida().then((p) => { if (vivo) { setPin(p ? { lat: p.lat, lng: p.lng } : null); setNombre(p?.nombre ?? "Almacén"); } }).finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [abierto]);

  const guardar = async () => {
    if (!pin) return;
    setBusy(true);
    const { error } = await supabase.rpc("guardar_punto_salida", { p_lat: pin.lat, p_lng: pin.lng, p_nombre: nombre.trim() || null });
    setBusy(false);
    if (error) { toast({ title: "No se pudo guardar el punto de salida", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Punto de salida guardado" });
    onGuardado?.({ ...pin, nombre: nombre.trim() || "Punto de salida" });
    onClose();
  };

  return (
    <Dialog open={abierto} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-h-[96dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Punto de salida de las rutas</DialogTitle>
          <DialogDescription>Desde aquí se ordenan las paradas por cercanía. Suele ser el almacén.</DialogDescription>
        </DialogHeader>
        {cargando ? <div className="flex h-[300px] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div> : (
          <div className="space-y-2">
            <div className="space-y-1">
              <Label htmlFor="nombre-salida">Nombre</Label>
              <Input id="nombre-salida" value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={80} className="h-9" placeholder="Almacén principal" />
            </div>
            <SelectorPin key={abierto ? "abierto" : "cerrado"} pin={pin} onPin={setPin} busquedaInicial={pin ? "" : "Caracas"} />
            {pin && <p className="text-xs text-muted-foreground">Pin: <span className="font-mono">{fmtCoord(pin)}</span></p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={guardar} disabled={busy || !pin || (!!pin && !enVenezuela(pin))}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar punto de salida"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
