import { useEffect, useMemo, useState } from "react";
import { DeliveryLayout } from "@/components/delivery/DeliveryLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, ChevronDown, ChevronUp, ClipboardCheck, LocateFixed, Loader2, MapPin, MapPinOff, Maximize2, Navigation, Phone, RefreshCw, Route, Truck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useMisEntregas } from "@/components/delivery/useMisEntregas";
import { usePosicion } from "@/components/delivery/usePosicion";
import { usePingPosicion } from "@/components/delivery/usePingPosicion";
import { CierreEntregaDialog } from "@/components/delivery/CierreEntregaDialog";
import { Mapa, type MarcadorMapa } from "@/components/mapas/Mapa";
import { distanciaKm, fmtKm } from "@/components/mapas/geo";
import { diaCaracas, fechaHora } from "@/components/delivery/fechas";
import { ABIERTAS, ESTADO_ENTREGA, enlaceRuta, fmtDia, navegacion, telefonos, type EntregaReparto } from "@/components/delivery/entregas";

// Mi ruta (20f): las paradas del día en el orden que publicó la oficina, en un mapa (Mapbox, se carga solo en esta
// pantalla) con la posición del repartidor si da permiso, y el enlace para navegar a la siguiente (Google Maps / Waze).
// Las paradas sin ubicación se marcan y salen solo en la lista.
const DeliveryRuta = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const { entregas, loading, recargar } = useMisEntregas(1);
  const [cerrando, setCerrando] = useState<EntregaReparto | null>(null);
  const [saliendo, setSaliendo] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [enfoque, setEnfoque] = useState<{ lat: number; lng: number; zoom?: number; clave: number } | null>(null);
  const [ajuste, setAjuste] = useState(0);
  const [verProximas, setVerProximas] = useState(false);
  const [publicada, setPublicada] = useState<{ publicada_at: string | null; version: number } | null>(null);
  const hoy = diaCaracas();

  // Paradas de hoy (en el orden publicado, incluidas las ya cerradas hoy), luego las abiertas sin planificar o atrasadas
  const deHoy = entregas.filter((e) => e.fecha_ruta === hoy).sort((a, b) => (a.orden_ruta ?? 999) - (b.orden_ruta ?? 999));
  const sinPlan = entregas.filter((e) => ABIERTAS.includes(e.estado) && (!e.fecha_ruta || e.fecha_ruta < hoy));
  const proximas = entregas.filter((e) => ABIERTAS.includes(e.estado) && !!e.fecha_ruta && e.fecha_ruta > hoy)
    .sort((a, b) => a.fecha_ruta!.localeCompare(b.fecha_ruta!) || (a.orden_ruta ?? 999) - (b.orden_ruta ?? 999));
  const paradas = [...deHoy, ...sinPlan];
  const abiertas = paradas.filter((e) => ABIERTAS.includes(e.estado));
  const actual = abiertas.find((e) => e.estado === "en_camino") ?? abiertas[0] ?? null;
  const hayMapa = abiertas.length > 0;
  const { pos, estado: estadoGps } = usePosicion(hayMapa);
  // Seguimiento (20p): con paradas abiertas, la última posición llega a la oficina cada 2–3 min (o al moverse > 200 m)
  usePingPosicion(hayMapa, pos);
  const numero = (e: EntregaReparto) => paradas.findIndex((x) => x.id === e.id) + 1;

  useEffect(() => {
    if (!user?.id) return;
    supabase.from("rutas_reparto").select("publicada_at, version").eq("fecha", hoy).maybeSingle()
      .then(({ data }) => setPublicada((data as { publicada_at: string | null; version: number } | null) ?? null));
  }, [user?.id, hoy, entregas]);

  // Ajustar el mapa a las paradas cuando llegan (y la primera vez que hay GPS)
  const firma = abiertas.map((e) => `${e.id}:${e.ubicacion ? 1 : 0}`).join();
  useEffect(() => { setAjuste((n) => n + 1); }, [firma, !!pos]); // eslint-disable-line react-hooks/exhaustive-deps

  const marcadores = useMemo<MarcadorMapa[]>(() => [
    ...abiertas.flatMap((e) => (e.ubicacion ? [{
      id: e.id, lat: e.ubicacion.lat, lng: e.ubicacion.lng, etiqueta: String(numero(e)),
      tono: e.id === actual?.id ? "siguiente" as const : e.ubicacion.confirmada ? "parada" as const : "propuesta" as const,
      titulo: `${numero(e)}. ${e.cliente ?? ""}${e.ubicacion.confirmada ? "" : " (ubicación aproximada)"}`,
    }] : [])),
    ...(pos ? [{ id: "yo", lat: pos.lat, lng: pos.lng, tono: "yo" as const, titulo: `Tu posición (±${pos.precision} m)` }] : []),
  ], [firma, actual?.id, pos?.lat, pos?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  const salir = async (e: EntregaReparto) => {
    setSaliendo(e.id);
    const { error } = await supabase.rpc("iniciar_entrega", { p_entrega_id: e.id });
    setSaliendo(null);
    if (error) { toast({ title: "No se pudo actualizar", description: error.message, variant: "destructive" }); return; }
    toast({ title: "En camino", description: `${e.numero ?? ""} · ${e.cliente ?? ""}` });
    recargar();
  };
  const elegir = (id: string) => {
    setSel(id);
    const e = paradas.find((x) => x.id === id);
    if (e?.ubicacion) setEnfoque({ lat: e.ubicacion.lat, lng: e.ubicacion.lng, zoom: 15, clave: Date.now() });
    document.querySelector(`[data-parada="${id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  const distancia = (e: EntregaReparto) => (pos && e.ubicacion ? fmtKm(distanciaKm(pos, e.ubicacion)) : null);
  const ruta = enlaceRuta(abiertas.map((p) => ({ dir: p.direccion, ciudad: p.ciudad, region: p.region, lat: p.ubicacion?.lat, lng: p.ubicacion?.lng })));

  const botonesNavegar = (e: EntregaReparto, grande = false) => {
    const nav = navegacion(e);
    const tel = telefonos(e.telefono)[0];
    const h = grande ? "h-12" : "h-10";
    return (
      <div className="grid grid-cols-3 gap-2">
        <Button asChild className={`${h} gap-1 ${grande ? "bg-sky-600 text-white hover:bg-sky-700" : ""}`} variant={grande ? "default" : "outline"}>
          <a href={nav.maps} target="_blank" rel="noopener noreferrer" aria-label={`Navegar a ${e.cliente ?? "la parada"} con Google Maps`}><Navigation className="h-4 w-4" />Maps</a>
        </Button>
        <Button asChild variant="outline" className={`${h} gap-1`}>
          <a href={nav.waze} target="_blank" rel="noopener noreferrer" aria-label={`Navegar a ${e.cliente ?? "la parada"} con Waze`}><Navigation className="h-4 w-4" />Waze</a>
        </Button>
        <Button asChild={!!tel} variant="outline" className={`${h} gap-1`} disabled={!tel}>
          {tel ? <a href={`tel:${tel}`}><Phone className="h-4 w-4" />Llamar</a> : <span><Phone className="h-4 w-4" />Llamar</span>}
        </Button>
      </div>
    );
  };
  const accionPrincipal = (e: EntregaReparto, grande = false) => e.estado === "asignada"
    ? <Button className={`${grande ? "h-12 text-base" : "h-10"} w-full bg-amber-500 hover:bg-amber-600`} onClick={() => salir(e)} disabled={saliendo === e.id}>
        {saliendo === e.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Truck className="mr-2 h-5 w-5" />Salir a entregar</>}
      </Button>
    : <Button className={`${grande ? "h-12 text-base" : "h-10"} w-full`} onClick={() => setCerrando(e)}><ClipboardCheck className="mr-2 h-5 w-5" />Cerrar entrega</Button>;

  const insignias = (e: EntregaReparto) => {
    const est = ESTADO_ENTREGA[e.estado];
    return (
      <span className="flex flex-wrap gap-1">
        {e.estado !== "asignada" && est && <Badge variant="outline" className={`h-5 px-1.5 text-[10px] font-normal ${est.cls}`}>{est.label}</Badge>}
        {e.prioridad === "alta" && ABIERTAS.includes(e.estado) && <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">Alta</Badge>}
        {ABIERTAS.includes(e.estado) && !e.ubicacion && <Badge variant="outline" className="h-5 gap-0.5 px-1.5 text-[10px] font-normal text-muted-foreground"><MapPinOff className="h-3 w-3" />Sin ubicación en el mapa</Badge>}
        {e.ubicacion && !e.ubicacion.confirmada && <Badge variant="outline" className="h-5 border-amber-300 px-1.5 text-[10px] font-normal text-amber-800 dark:text-amber-200">Ubicación aproximada</Badge>}
        {!e.fecha_ruta && ABIERTAS.includes(e.estado) && <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-normal">Sin planificar</Badge>}
        {e.fecha_ruta && e.fecha_ruta < hoy && ABIERTAS.includes(e.estado) && <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-normal text-destructive">Atrasada ({fmtDia(e.fecha_ruta)})</Badge>}
      </span>
    );
  };

  return (
    <DeliveryLayout title="Mi Ruta">
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-lg font-semibold"><Route className="h-5 w-5 shrink-0 text-amber-500" />Ruta de hoy · {fmtDia(hoy)}</h2>
            <p className="text-xs text-muted-foreground">
              {abiertas.length} {abiertas.length === 1 ? "parada pendiente" : "paradas pendientes"}
              {paradas.length > abiertas.length ? ` · ${paradas.length - abiertas.length} hechas` : ""}
              {" · "}{publicada?.publicada_at ? `ruta publicada ${fechaHora(publicada.publicada_at)}` : "la oficina aún no publicó el orden"}
            </p>
          </div>
          <Button variant="outline" size="icon" className="h-10 w-10 shrink-0" onClick={recargar} aria-label="Actualizar ruta" disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {loading && !entregas.length ? (
          <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-amber-500" /></div>
        ) : !paradas.length ? (
          <Card className="border-border"><CardContent className="p-10 text-center text-muted-foreground">
            <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-green-500" />No tienes paradas en tu ruta de hoy
            {proximas.length > 0 && <p className="mt-1 text-sm">Tienes {proximas.length} para los próximos días.</p>}
          </CardContent></Card>
        ) : (
          <>
            {hayMapa && (
              <div className="relative">
                <Mapa className="h-[42vh] min-h-[240px] max-h-[460px]" etiqueta="Mapa de tu ruta" marcadores={marcadores}
                  ajustarA={ajuste} enfoque={enfoque} onClickMarcador={(id) => id !== "yo" && elegir(id)} zoomInicial={11} />
                <div className="absolute left-2 top-2 flex gap-1.5">
                  {pos && (
                    <Button size="sm" variant="secondary" className="h-9 gap-1 shadow" onClick={() => setEnfoque({ lat: pos.lat, lng: pos.lng, zoom: 15, clave: Date.now() })}>
                      <LocateFixed className="h-4 w-4" />Yo
                    </Button>
                  )}
                  <Button size="sm" variant="secondary" className="h-9 gap-1 shadow" onClick={() => setAjuste((n) => n + 1)}><Maximize2 className="h-4 w-4" />Toda la ruta</Button>
                </div>
              </div>
            )}
            {hayMapa && estadoGps !== "ok" && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <LocateFixed className="h-3.5 w-3.5 shrink-0" />
                {estadoGps === "pidiendo" ? "Buscando tu ubicación…" : estadoGps === "denegado"
                  ? "No diste permiso de ubicación: actívalo en el navegador para verte en el mapa y medir distancias."
                  : "No se pudo leer tu ubicación (GPS apagado o sin señal)."}
              </p>
            )}
            {hayMapa && estadoGps === "ok" && (
              <p className="text-[11px] text-muted-foreground" data-aviso="seguimiento">
                Mientras tengas paradas abiertas y esta pantalla esté abierta, la oficina ve tu última ubicación (cada 2–3 min).
              </p>
            )}

            {actual && (
              <Card className="border-amber-400/70 bg-amber-50/40 dark:bg-amber-500/5" data-siguiente={actual.id}>
                <CardContent className="space-y-2 p-3">
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500 text-lg font-bold text-white">{numero(actual)}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">{actual.estado === "en_camino" ? "Parada actual" : "Siguiente parada"}{distancia(actual) ? ` · a ${distancia(actual)}` : ""}</p>
                      <p className="font-semibold leading-snug">{actual.cliente || actual.contacto || "Cliente"}</p>
                      {actual.contacto && actual.contacto !== actual.cliente && <p className="text-xs text-muted-foreground">{actual.contacto}</p>}
                      <p className="mt-0.5 flex items-start gap-1 text-sm text-muted-foreground"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />{actual.direccion || "Sin dirección"}{actual.ciudad ? ` · ${actual.ciudad}` : ""}</p>
                      <p className="text-xs text-muted-foreground"><span className="font-mono">{actual.numero}</span> · {actual.empresa}</p>
                      <div className="mt-1">{insignias(actual)}</div>
                    </div>
                  </div>
                  {botonesNavegar(actual, true)}
                  {accionPrincipal(actual, true)}
                  {!actual.ubicacion && <p className="text-[11px] text-muted-foreground">Esta parada no tiene ubicación en el mapa: Maps y Waze buscan la dirección de Odoo.</p>}
                </CardContent>
              </Card>
            )}

            <div className="space-y-2" data-lista="paradas">
              {paradas.map((e) => {
                const abierta = ABIERTAS.includes(e.estado);
                const n = numero(e);
                return (
                  <Card key={e.id} data-parada={e.id} className={`border-border ${sel === e.id ? "ring-2 ring-amber-400" : ""} ${abierta ? "" : "opacity-70"}`}>
                    <CardContent className="p-3">
                      <button type="button" className="flex w-full items-start gap-3 text-left" onClick={() => elegir(e.id)}>
                        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-bold ${!abierta ? "bg-emerald-600 text-white" : e.id === actual?.id ? "bg-amber-500 text-white" : e.ubicacion ? (e.ubicacion.confirmada ? "bg-primary text-primary-foreground" : "border-2 border-dashed border-amber-500 text-amber-800") : "bg-muted text-muted-foreground"}`}>
                          {abierta ? n : <CheckCircle2 className="h-4 w-4" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{e.cliente || e.contacto || "Cliente"}</span>
                          <span className="block truncate text-xs text-muted-foreground"><span className="font-mono">{e.numero}</span> · {e.empresa}{distancia(e) && abierta ? ` · a ${distancia(e)}` : ""}</span>
                          <span className="block truncate text-xs text-muted-foreground">{e.direccion || "Sin dirección"}{e.ciudad ? ` · ${e.ciudad}` : ""}</span>
                          <span className="mt-1 block">{insignias(e)}</span>
                        </span>
                      </button>
                      {abierta && e.id !== actual?.id && (
                        <div className="mt-2 space-y-2">
                          {botonesNavegar(e)}
                          {accionPrincipal(e)}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {ruta && abiertas.length > 1 && (
              <Button asChild variant="outline" className="h-11 w-full gap-1">
                <a href={ruta} target="_blank" rel="noopener noreferrer"><Navigation className="h-4 w-4" />Ruta completa en Google Maps</a>
              </Button>
            )}
          </>
        )}

        {proximas.length > 0 && (
          <Card className="border-border"><CardContent className="p-3">
            <button type="button" className="flex w-full items-center justify-between text-sm font-medium" onClick={() => setVerProximas((v) => !v)}>
              Próximos días ({proximas.length}){verProximas ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {verProximas && (
              <ul className="mt-2 divide-y divide-border text-sm">
                {proximas.map((e) => (
                  <li key={e.id} className="py-1.5">
                    <span className="block truncate font-medium">{e.cliente}</span>
                    <span className="block text-xs text-muted-foreground">{fmtDia(e.fecha_ruta)} · parada {e.orden_ruta ?? "—"} · <span className="font-mono">{e.numero}</span> · {e.empresa}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent></Card>
        )}
      </div>
      <CierreEntregaDialog entrega={cerrando} onClose={() => setCerrando(null)} onCerrada={() => { setCerrando(null); recargar(); }} />
    </DeliveryLayout>
  );
};

export default DeliveryRuta;
