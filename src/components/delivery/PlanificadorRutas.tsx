import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Panel } from "@/components/datos/FichaCampos";
import {
  ArrowDown, ArrowUp, CheckCircle2, GripVertical, Loader2, MapPinPlus, Plus, Printer, Route, Send, Sparkles, Warehouse, X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { Mapa, type MarcadorMapa } from "@/components/mapas/Mapa";
import { fmtKm, largoKm, ordenarPorCercania, type Punto } from "@/components/mapas/geo";
import { diaCaracas, fechaHora } from "@/components/delivery/fechas";
import { ESTADO_ENTREGA, fmtDia, telefonos } from "@/components/delivery/entregas";
import { cargarPuntoSalida, type DestinoEntrega, type PuntoSalida } from "@/components/delivery/ubicaciones";
import { PuntoSalidaDialog } from "@/components/delivery/EditorUbicacionDialog";
import { ABIERTA, cargarRutaAdmin, destinoDeParada, type ParadaAdmin, type RutaAdmin } from "@/components/delivery/rutas";

export interface RepartidorRuta { id: string; nombre: string; apellido: string | null }

const posDe = (p: ParadaAdmin): Punto | null => (p.ubicacion ? { lat: p.ubicacion.lat, lng: p.ubicacion.lng } : null);

/** Planificador de rutas (D3): por día y repartidor, las paradas en un mapa con marcadores numerados y una lista
 *  ordenable (arrastrar o flechas). "Ordenar por cercanía" (vecino más cercano + 2-opt desde el punto de salida) y
 *  "Publicar" guarda entregas.orden_ruta y avisa al repartidor. Rutas mixtas GUDS + Quirutec. */
export function PlanificadorRutas({ repartidores, puedeEditar, onEditarUbicacion, recarga }: {
  repartidores: RepartidorRuta[];
  puedeEditar: boolean;
  onEditarUbicacion: (d: DestinoEntrega) => void;
  /** Cambia cuando hay que volver a leer (p. ej. después de guardar una ubicación). */
  recarga: number;
}) {
  const { toast } = useToast();
  const hoy = diaCaracas();
  const [fecha, setFecha] = useState(hoy);
  const [repId, setRepId] = useState(repartidores.length === 1 ? repartidores[0].id : "");
  const [datos, setDatos] = useState<RutaAdmin | null>(null);
  const [cargando, setCargando] = useState(false);
  const [orden, setOrden] = useState<string[]>([]);
  const [salida, setSalida] = useState<PuntoSalida | null>(null);
  const [dlgSalida, setDlgSalida] = useState(false);
  const [publicando, setPublicando] = useState(false);
  const [resaltada, setResaltada] = useState<string | null>(null);
  const [ajuste, setAjuste] = useState(0);
  const arrastre = useRef<string | null>(null);

  useEffect(() => { if (!repId && repartidores.length === 1) setRepId(repartidores[0].id); }, [repartidores, repId]);
  useEffect(() => { cargarPuntoSalida().then(setSalida); }, []);

  const cargar = useCallback(async () => {
    if (!repId || !fecha) { setDatos(null); setOrden([]); return; }
    setCargando(true);
    try {
      const d = await cargarRutaAdmin(repId, fecha);
      setDatos(d);
      setOrden(d.entregas.filter((e) => e.fecha_ruta === fecha).sort((a, b) => (a.orden_ruta ?? 999) - (b.orden_ruta ?? 999)).map((e) => e.id));
      setAjuste((n) => n + 1);
    } catch (e) {
      toast({ title: "No se pudo cargar la ruta", description: (e as Error).message, variant: "destructive" });
    } finally {
      setCargando(false);
    }
  }, [repId, fecha, toast]);
  useEffect(() => { cargar(); }, [cargar, recarga]);

  const porId = useMemo(() => new Map((datos?.entregas ?? []).map((e) => [e.id, e])), [datos]);
  const enRuta = orden.map((id) => porId.get(id)).filter(Boolean) as ParadaAdmin[];
  const fuera = (datos?.entregas ?? []).filter((e) => !orden.includes(e.id) && ABIERTA(e.estado));
  const sinPlanificar = fuera.filter((e) => !e.fecha_ruta || e.fecha_ruta < hoy || e.fecha_ruta === fecha);
  const otroDia = fuera.filter((e) => e.fecha_ruta && e.fecha_ruta >= hoy && e.fecha_ruta !== fecha);
  const inicial = useMemo(() => (datos?.entregas ?? []).filter((e) => e.fecha_ruta === fecha).sort((a, b) => (a.orden_ruta ?? 999) - (b.orden_ruta ?? 999)).map((e) => e.id), [datos, fecha]);
  const sucio = orden.join() !== inicial.join();
  const publicada = datos?.ruta ?? null;
  const editable = puedeEditar && fecha >= hoy;
  const sinUbic = enRuta.filter((p) => !p.ubicacion).length;
  const km = largoKm([...(salida ? [salida] : []), ...enRuta.map(posDe).filter(Boolean) as Punto[]]);

  const mover = (id: string, delta: number) => setOrden((o) => {
    const i = o.indexOf(id), j = i + delta;
    if (i < 0 || j < 0 || j >= o.length) return o;
    const n = [...o]; [n[i], n[j]] = [n[j], n[i]]; return n;
  });
  const soltarEn = (destinoId: string) => {
    const id = arrastre.current;
    arrastre.current = null;
    if (!id || id === destinoId) return;
    setOrden((o) => { const n = o.filter((x) => x !== id); n.splice(n.indexOf(destinoId), 0, id); return n; });
  };
  const agregar = (ids: string[]) => setOrden((o) => [...o, ...ids.filter((x) => !o.includes(x))]);
  const quitar = (id: string) => setOrden((o) => o.filter((x) => x !== id));

  const ordenarCercania = () => {
    // Las paradas cerradas o en camino quedan primero, en su orden; el resto se ordena desde la última de ellas o desde el punto de salida
    const fijas = enRuta.filter((p) => !(p.estado === "asignada"));
    const libres = enRuta.filter((p) => p.estado === "asignada");
    const ultimaFija = [...fijas].reverse().map(posDe).find(Boolean) ?? null;
    const inicio = ultimaFija ?? (salida ? { lat: salida.lat, lng: salida.lng } : null);
    const nuevo = [...fijas, ...ordenarPorCercania(libres, posDe, inicio)].map((p) => p.id);
    setOrden(nuevo);
    setAjuste((n) => n + 1);
    toast({ title: "Ruta ordenada por cercanía", description: `${inicio ? (ultimaFija ? "Desde la última parada hecha" : `Desde ${salida?.nombre}`) : "Desde la primera parada"} · en línea recta${libres.some((p) => !p.ubicacion) ? " · las paradas sin ubicación quedan al final" : ""}` });
  };

  const publicar = async () => {
    if (!repId) return;
    setPublicando(true);
    const { data, error } = await supabase.rpc("publicar_ruta_reparto", { p_repartidor_id: repId, p_fecha: fecha, p_entregas: orden });
    setPublicando(false);
    if (error) { toast({ title: "No se pudo publicar la ruta", description: error.message, variant: "destructive" }); return; }
    const r = data as { version: number; paradas: number; notificado: boolean };
    toast({ title: r.notificado ? (r.version === 1 ? "Ruta publicada" : "Ruta actualizada") : "Sin cambios", description: r.notificado ? `${r.paradas} paradas · se avisó al repartidor` : "La ruta ya estaba publicada así" });
    cargar();
  };

  const marcadores = useMemo<MarcadorMapa[]>(() => [
    ...(salida ? [{ id: "salida", lat: salida.lat, lng: salida.lng, tono: "salida" as const, etiqueta: "S", titulo: `Punto de salida: ${salida.nombre}` }] : []),
    ...enRuta.flatMap((p, i) => (p.ubicacion ? [{
      id: p.id, lat: p.ubicacion.lat, lng: p.ubicacion.lng, etiqueta: String(i + 1),
      tono: !ABIERTA(p.estado) ? "hecha" as const : p.ubicacion.confirmada ? "parada" as const : "propuesta" as const,
      titulo: `${i + 1}. ${p.cliente ?? ""}${p.sucursal ? ` › ${p.sucursal}` : ""}${p.ubicacion.confirmada ? "" : " (ubicación por confirmar)"}`,
    }] : [])),
  ], [enRuta, salida]); // eslint-disable-line react-hooks/exhaustive-deps
  const linea = useMemo(() => [...(salida ? [salida] : []), ...enRuta.map(posDe).filter(Boolean) as Punto[]], [enRuta, salida]); // eslint-disable-line react-hooks/exhaustive-deps

  const resaltar = (id: string) => {
    setResaltada(id);
    document.querySelector(`[data-parada="${id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  const filaParada = (p: ParadaAdmin, i: number | null) => {
    const destino = destinoDeParada(p);
    const tel = telefonos(p.telefono)[0];
    const cerrada = !ABIERTA(p.estado);
    const est = ESTADO_ENTREGA[p.estado];
    return (
      <div className="flex min-w-0 flex-1 items-start gap-2">
        {i != null && (
          <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${cerrada ? "bg-emerald-600 text-white" : p.ubicacion ? (p.ubicacion.confirmada ? "bg-primary text-primary-foreground" : "border-2 border-dashed border-amber-500 text-amber-800") : "bg-muted text-muted-foreground"}`}>
            {cerrada ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={p.cliente ?? ""}>{p.cliente}{p.sucursal ? <span className="font-normal text-muted-foreground"> › {p.sucursal}</span> : null}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            <span className="font-mono">{p.numero}</span> · {p.empresa}{p.tipo === "reposicion" ? " · reposición" : ""}{tel ? ` · ${tel}` : ""}
          </p>
          <p className="truncate text-[11px] text-muted-foreground" title={p.direccion ?? ""}>{[p.direccion, p.ciudad].filter(Boolean).join(" · ") || "Sin dirección"}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            {est && p.estado !== "asignada" && <Badge variant="outline" className={`h-4 px-1 text-[10px] font-normal ${est.cls}`}>{est.label}</Badge>}
            {p.prioridad === "alta" && <Badge variant="destructive" className="h-4 px-1 text-[10px]">Alta</Badge>}
            {!p.ubicacion && <Badge variant="outline" className="h-4 px-1 text-[10px] font-normal text-muted-foreground">Sin ubicación</Badge>}
            {p.ubicacion && !p.ubicacion.confirmada && <Badge variant="outline" className="h-4 border-amber-300 px-1 text-[10px] font-normal text-amber-800 dark:text-amber-200">Ubicación por confirmar</Badge>}
            {destino && (!p.ubicacion || !p.ubicacion.confirmada) && puedeEditar && (
              <button type="button" onClick={() => onEditarUbicacion(destino)} className="inline-flex items-center gap-0.5 text-[11px] text-primary hover:underline">
                <MapPinPlus className="h-3 w-3" />{p.ubicacion ? "Revisar" : "Ubicar"}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const rep = repartidores.find((r) => r.id === repId);
  return (
    <div className="space-y-3">
      <Panel titulo={<><Route className="h-4 w-4 text-primary" />Ruta del día</>}>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="ruta-fecha" className="text-xs">Día</Label>
            <Input id="ruta-fecha" type="date" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} className="h-9 w-[150px]" />
          </div>
          <div className="min-w-[200px] flex-1 space-y-1 sm:flex-none">
            <Label htmlFor="ruta-rep" className="text-xs">Repartidor</Label>
            <Select value={repId} onValueChange={setRepId}>
              <SelectTrigger id="ruta-rep" className="h-9 sm:w-60"><SelectValue placeholder="Elige un repartidor" /></SelectTrigger>
              <SelectContent>
                {repartidores.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">No hay repartidores activos</div>}
                {repartidores.map((r) => <SelectItem key={r.id} value={r.id}>{r.nombre} {r.apellido || ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap gap-2 sm:ml-auto">
            {puedeEditar && (
              <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => setDlgSalida(true)} title={salida ? `Punto de salida: ${salida.nombre}` : "Define el punto de salida"}>
                <Warehouse className="h-4 w-4" /><span className="hidden sm:inline">{salida ? salida.nombre : "Punto de salida"}</span>
              </Button>
            )}
            <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={ordenarCercania} disabled={!editable || enRuta.filter((p) => p.ubicacion).length < 2}>
              <Sparkles className="h-4 w-4" />Ordenar por cercanía
            </Button>
            <Button asChild={!sucio && !!publicada && !!repId} variant="outline" size="sm" className="h-9 gap-1.5" disabled={sucio || !publicada || !repId}
              title={sucio ? "Publica la ruta para imprimirla" : !publicada ? "La ruta aún no se ha publicado" : undefined}>
              {!sucio && publicada && repId
                ? <a href={`/admin/delivery/hoja-ruta?rep=${repId}&fecha=${fecha}`} target="_blank" rel="noopener noreferrer"><Printer className="h-4 w-4" />Hoja de ruta</a>
                : <span><Printer className="h-4 w-4" />Hoja de ruta</span>}
            </Button>
            {editable && (
              <Button size="sm" className="h-9 gap-1.5" onClick={publicar} disabled={publicando || !repId || (!sucio && !!publicada)}>
                {publicando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{publicada ? "Publicar cambios" : "Publicar ruta"}
              </Button>
            )}
          </div>
        </div>
        {repId && (
          <p className="mt-2 text-[11px] text-muted-foreground" data-estado-ruta>
            {publicada?.publicada_at ? <>Publicada {fechaHora(publicada.publicada_at)}{publicada.publicada_por ? ` por ${publicada.publicada_por}` : ""} · versión {publicada.version}</> : "Sin publicar: el repartidor ve sus entregas sin orden de ruta."}
            {sucio && <span className="ml-1 font-medium text-warning">· cambios sin publicar</span>}
            {fecha < hoy && " · día pasado: solo consulta."}
          </p>
        )}
      </Panel>

      {!repId ? (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Elige un repartidor para planificar su ruta.</p>
      ) : cargando && !datos ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="order-2 space-y-3 lg:order-1">
            <Panel sinPadding titulo={<>En la ruta ({enRuta.length}){enRuta.length > 0 && <span className="font-normal text-muted-foreground">· ≈ {fmtKm(km)} en línea recta{sinUbic ? ` · ${sinUbic} sin ubicación` : ""}</span>}</>}>
              {enRuta.length === 0 ? (
                <p className="px-3 py-4 text-sm text-muted-foreground">{rep ? `${rep.nombre} no tiene paradas en la ruta del ${fmtDia(fecha)}.` : ""} {editable && sinPlanificar.length > 0 ? "Agrega las entregas de abajo." : ""}</p>
              ) : (
                <ol className="divide-y divide-border" data-lista="ruta">
                  {enRuta.map((p, i) => (
                    <li key={p.id} data-parada={p.id}
                      draggable={editable} onDragStart={() => { arrastre.current = p.id; }} onDragOver={(e) => { if (editable) e.preventDefault(); }} onDrop={() => soltarEn(p.id)}
                      onClick={() => setResaltada(p.id)}
                      className={`flex items-start gap-1 px-2 py-2 ${resaltada === p.id ? "bg-primary/5" : ""}`}>
                      {editable && <GripVertical className="mt-1 hidden h-4 w-4 shrink-0 cursor-grab text-muted-foreground sm:block" aria-hidden />}
                      {filaParada(p, i)}
                      {editable && (
                        <div className="flex shrink-0 flex-col items-center gap-0.5">
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); mover(p.id, -1); }} disabled={i === 0} aria-label={`Subir ${p.numero}`}><ArrowUp className="h-3.5 w-3.5" /></Button>
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); mover(p.id, 1); }} disabled={i === enRuta.length - 1} aria-label={`Bajar ${p.numero}`}><ArrowDown className="h-3.5 w-3.5" /></Button>
                          {ABIERTA(p.estado) && <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground" onClick={(e) => { e.stopPropagation(); quitar(p.id); }} aria-label={`Quitar ${p.numero} de la ruta`}><X className="h-3.5 w-3.5" /></Button>}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </Panel>

            {(sinPlanificar.length > 0 || otroDia.length > 0) && (
              <Panel sinPadding titulo={`Sin planificar (${sinPlanificar.length})${otroDia.length ? ` · en otro día (${otroDia.length})` : ""}`} acciones={editable && sinPlanificar.length > 1 ? (
                <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => agregar(sinPlanificar.map((p) => p.id))}><Plus className="h-3.5 w-3.5" />Agregar todas</Button>
              ) : undefined}>
                <ul className="divide-y divide-border" data-lista="sin-planificar">
                  {[...sinPlanificar, ...otroDia].map((p) => (
                    <li key={p.id} className="flex items-start gap-2 px-3 py-2">
                      {filaParada(p, null)}
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        {p.fecha_ruta && p.fecha_ruta !== fecha && <span className="text-[10px] text-muted-foreground">{p.fecha_ruta < hoy ? "atrasada · " : ""}{fmtDia(p.fecha_ruta)}</span>}
                        {editable && <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => agregar([p.id])} aria-label={`Agregar ${p.numero} a la ruta`}><Plus className="h-3.5 w-3.5" />Agregar</Button>}
                      </div>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </div>

          <div className="order-1 lg:order-2">
            <div className="lg:sticky lg:top-20">
              <Mapa className="h-[300px] sm:h-[380px] lg:h-[calc(100vh-230px)] lg:min-h-[420px]" etiqueta="Mapa de la ruta" marcadores={marcadores} linea={linea}
                ajustarA={`${repId}|${fecha}|${ajuste}`} onClickMarcador={(id) => id !== "salida" && resaltar(id)} centroInicial={salida} />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Números = orden de la ruta. Borde punteado: ubicación propuesta por GPS (sin confirmar). S = punto de salida. Las paradas sin ubicación solo salen en la lista.
              </p>
            </div>
          </div>
        </div>
      )}

      <PuntoSalidaDialog abierto={dlgSalida} onClose={() => setDlgSalida(false)} onGuardado={(p) => { setSalida(p); setAjuste((n) => n + 1); }} />
    </div>
  );
}
