import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel } from "@/components/datos/FichaCampos";
import { ChevronDown, ChevronUp, Loader2, LocateFixed, MapPinOff, Maximize2, Navigation, RefreshCw, Truck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Mapa, type MarcadorMapa, type TonoMarcador } from "@/components/mapas/Mapa";
import { verEnGoogle, type Punto } from "@/components/mapas/geo";
import { diaCaracas, fechaHora } from "@/components/delivery/fechas";
import { ESTADO_ENTREGA, etiquetaMotivo, fmtDia } from "@/components/delivery/entregas";
import {
  ABIERTA_SEG, CON_INCIDENCIA, POSICION_VIEJA_MIN, avanceRuta, cargarSeguimiento, hace, minutosDesde,
  type ParadaSeguimiento, type RepartidorSeguimiento, type Seguimiento,
} from "@/components/delivery/seguimiento";

const REFRESCO_MS = 60_000;
const iniciales = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join("") || "R";
const hora = (s: string | null) => (s ? new Date(s).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit", timeZone: "America/Caracas" }) : "—");

function tonoParada(p: ParadaSeguimiento, siguienteId: string | null): TonoMarcador {
  if (p.id === siguienteId) return "siguiente";
  if (!ABIERTA_SEG(p.estado)) return CON_INCIDENCIA.includes(p.estado) && p.estado !== "incompleta" ? "incidencia" : "hecha";
  return p.ubicacion?.confirmada === false ? "propuesta" : "parada";
}

/** Barra de avance de la ruta: entregadas, con incidencia y pendientes (cada tramo con su número al lado). */
function BarraAvance({ r }: { r: RepartidorSeguimiento }) {
  const a = avanceRuta(r);
  const entregadas = a.hechas - a.incidencias;
  if (!a.total) return null;
  const tramo = (n: number, cls: string, titulo: string) => (n > 0 ? <span className={`h-full ${cls}`} style={{ width: `${(n / a.total) * 100}%` }} title={`${titulo}: ${n}`} /> : null);
  return (
    <div className="space-y-1">
      <div className="flex h-2 w-full gap-[2px] overflow-hidden rounded-full bg-muted" role="img"
        aria-label={`${a.hechas} de ${a.total} paradas cerradas: ${entregadas} entregadas, ${a.incidencias} con incidencia, ${a.pendientes} pendientes`}>
        {tramo(entregadas, "bg-emerald-600", "Entregadas")}
        {tramo(a.incidencias, "bg-red-500", "Con incidencia")}
        {tramo(a.pendientes, "bg-muted-foreground/25", "Pendientes")}
      </div>
      <p className="text-[11px] text-muted-foreground tabular-nums">
        {a.hechas} de {a.total} cerradas · {entregadas} entregadas{a.incidencias ? ` · ${a.incidencias} con incidencia` : ""} · {a.pendientes} pendientes
      </p>
    </div>
  );
}

/** Seguimiento del día (D6): última posición conocida de cada repartidor (pings de la app o GPS del cierre), sus paradas
 *  (hechas, pendientes y la siguiente) y el avance de la ruta. Se refresca cada minuto mientras se mira el día de hoy. */
export function SeguimientoPanel() {
  const { toast } = useToast();
  const hoy = diaCaracas();
  const [fecha, setFecha] = useState(hoy);
  const [datos, setDatos] = useState<Seguimiento | null>(null);
  const [cargando, setCargando] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const [ajuste, setAjuste] = useState(0);
  const [enfoque, setEnfoque] = useState<{ lat: number; lng: number; zoom?: number; clave: number } | null>(null);
  const [ahora, setAhora] = useState(Date.now());

  const cargar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargando(true);
    try {
      const d = await cargarSeguimiento(fecha);
      setDatos(d);
      setAhora(Date.now());
      if (!silencioso) setAjuste((n) => n + 1);
    } catch (e) {
      if (!silencioso) toast({ title: "No se pudo cargar el seguimiento", description: (e as Error).message, variant: "destructive" });
    } finally {
      if (!silencioso) setCargando(false);
    }
  }, [fecha, toast]);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => {
    if (fecha !== hoy) return;
    const t = window.setInterval(() => { if (document.visibilityState === "visible") cargar(true); }, REFRESCO_MS);
    return () => window.clearInterval(t);
  }, [fecha, hoy, cargar]);

  const reps = datos?.repartidores ?? [];
  const visibles = sel ? reps.filter((r) => r.id === sel) : reps;
  const resumen = useMemo(() => reps.reduce((s, r) => {
    const a = avanceRuta(r);
    return { total: s.total + a.total, hechas: s.hechas + a.hechas, incidencias: s.incidencias + a.incidencias,
      enCamino: s.enCamino + r.paradas.filter((p) => p.estado === "en_camino").length, conPos: s.conPos + (r.posicion ? 1 : 0) };
  }, { total: 0, hechas: 0, incidencias: 0, enCamino: 0, conPos: 0 }), [reps]);

  const marcadores = useMemo<MarcadorMapa[]>(() => visibles.flatMap((r) => {
    const a = avanceRuta(r);
    const numeradas = r.paradas.map((p, i) => ({ p, n: p.orden_ruta ?? i + 1 }));
    const paradas: MarcadorMapa[] = numeradas.flatMap(({ p, n }) => {
      const pt = p.ubicacion ?? (ABIERTA_SEG(p.estado) ? null : p.cierre);
      if (!pt) return [];
      const est = ESTADO_ENTREGA[p.estado]?.label ?? p.estado;
      return [{ id: `p:${p.id}`, lat: pt.lat, lng: pt.lng, etiqueta: String(n), tono: tonoParada(p, a.siguiente?.id ?? null),
        titulo: `${reps.length > 1 ? `${r.nombre} · ` : ""}${n}. ${p.cliente ?? ""} · ${est}${p.id === a.siguiente?.id ? " (siguiente)" : ""}` }];
    });
    const pos = r.posicion;
    const viejo = minutosDesde(pos?.tomada_at, ahora) > POSICION_VIEJA_MIN;
    return [...paradas, ...(pos ? [{ id: `r:${r.id}`, lat: pos.lat, lng: pos.lng, etiqueta: iniciales(r.nombre), tono: (viejo ? "repartidor_viejo" : "repartidor") as TonoMarcador,
      titulo: `${r.nombre} · ${hace(pos.tomada_at, ahora)}${pos.precision_m != null ? ` (±${Math.round(pos.precision_m)} m)` : ""}${pos.fuente === "cierre" ? " · GPS de un cierre" : ""}` }] : [])];
  }), [visibles, reps.length, ahora]);

  // Recorrido del repartidor elegido: su rastro del día (pings) o, si no hay, la línea entre sus paradas en orden
  const linea = useMemo<Punto[] | undefined>(() => {
    if (!sel) return [];
    const r = reps.find((x) => x.id === sel);
    if (!r) return [];
    if (r.rastro.length >= 2) return r.rastro.map(([lat, lng]) => ({ lat, lng }));
    return r.paradas.map((p) => p.ubicacion).filter(Boolean) as Punto[];
  }, [sel, reps]);

  const elegir = (id: string) => { setSel((s) => (s === id ? null : id)); setAjuste((n) => n + 1); };
  const alternar = (id: string) => setAbiertos((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const irA = (p: { lat: number; lng: number }) => setEnfoque({ lat: p.lat, lng: p.lng, zoom: 15, clave: Date.now() });
  const clicMarcador = (id: string) => {
    const [tipo, ref] = [id.slice(0, 1), id.slice(2)];
    const rep = tipo === "r" ? ref : reps.find((r) => r.paradas.some((p) => p.id === ref))?.id;
    if (rep) {
      setAbiertos((s) => new Set(s).add(rep));
      document.querySelector(`[data-repartidor="${rep}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  };

  const tarjeta = (r: RepartidorSeguimiento) => {
    const a = avanceRuta(r);
    const pos = r.posicion;
    const viejo = minutosDesde(pos?.tomada_at, ahora) > POSICION_VIEJA_MIN;
    const enCamino = r.paradas.some((p) => p.estado === "en_camino");
    const abierto = abiertos.has(r.id);
    return (
      <li key={r.id} data-repartidor={r.id} className={`px-3 py-2.5 ${sel === r.id ? "bg-primary/5" : ""}`}>
        <div className="flex items-start gap-2">
          <button type="button" onClick={() => elegir(r.id)} aria-pressed={sel === r.id} title={sel === r.id ? "Ver todos los repartidores" : "Ver solo este repartidor en el mapa"}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${pos ? (viejo ? "bg-slate-400" : "bg-sky-600") : "bg-muted text-muted-foreground"}`}>
            {iniciales(r.nombre)}
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" className="truncate text-left text-sm font-medium hover:underline" onClick={() => elegir(r.id)}>{r.nombre}</button>
              {enCamino && <Badge variant="outline" className={`h-4 gap-0.5 px-1 text-[10px] font-normal ${ESTADO_ENTREGA.en_camino.cls}`}><Truck className="h-3 w-3" />En camino</Badge>}
            </div>
            <p className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
              {pos ? (
                <>
                  <LocateFixed className="h-3 w-3 shrink-0" />
                  <span className={viejo ? "text-warning" : ""}>Última posición {hace(pos.tomada_at, ahora)}</span>
                  {pos.precision_m != null && <span>· ±{Math.round(pos.precision_m)} m</span>}
                  {pos.fuente === "cierre" && <span>· GPS de un cierre</span>}
                  <button type="button" className="text-primary hover:underline" onClick={() => irA(pos)}>ver</button>
                  <a className="text-primary hover:underline" href={verEnGoogle(pos)} target="_blank" rel="noopener noreferrer">Google Maps</a>
                </>
              ) : <><MapPinOff className="h-3 w-3 shrink-0" />Sin posición {datos?.hoy ? "hoy" : "ese día"} (la app manda la ubicación con Mi ruta abierta)</>}
            </p>
          </div>
        </div>
        <div className="mt-2"><BarraAvance r={r} /></div>
        {a.siguiente && (
          <p className="mt-1.5 truncate text-xs" title={`${a.siguiente.cliente ?? ""} · ${a.siguiente.direccion ?? ""}`}>
            <span className="font-medium text-amber-700 dark:text-amber-300">{a.siguiente.estado === "en_camino" ? "En camino a" : "Siguiente"}:</span>{" "}
            {a.siguiente.orden_ruta ? `${a.siguiente.orden_ruta}. ` : ""}{a.siguiente.cliente}{a.siguiente.ciudad ? <span className="text-muted-foreground"> · {a.siguiente.ciudad}</span> : null}
          </p>
        )}
        <button type="button" onClick={() => alternar(r.id)} className="mt-1 inline-flex items-center gap-0.5 text-[11px] text-primary hover:underline" aria-expanded={abierto}>
          {abierto ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}{abierto ? "Ocultar paradas" : `Ver paradas (${a.total})`}
        </button>
        {abierto && (
          <ol className="mt-1 divide-y divide-border rounded-md border border-border" data-lista="paradas-seguimiento">
            {r.paradas.map((p, i) => {
              const est = ESTADO_ENTREGA[p.estado];
              const n = p.orden_ruta ?? i + 1;
              const pt = p.ubicacion ?? p.cierre;
              return (
                <li key={p.id} className="flex items-start gap-2 px-2 py-1.5">
                  <span className={`mt-0.5 flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-bold ${
                    p.id === a.siguiente?.id ? "bg-amber-500 text-white" : !ABIERTA_SEG(p.estado) ? (CON_INCIDENCIA.includes(p.estado) && p.estado !== "incompleta" ? "bg-red-600 text-white" : "bg-emerald-600 text-white") : "bg-muted text-muted-foreground"}`}>{n}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">{p.cliente ?? "Cliente"}{p.sucursal ? <span className="font-normal text-muted-foreground"> › {p.sucursal}</span> : null}</p>
                    <p className="truncate text-[11px] text-muted-foreground"><span className="font-mono">{p.numero}</span> · {p.empresa}{p.en_ruta === false ? " · sin planificar" : ""}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                      {est && <Badge variant="outline" className={`h-4 px-1 text-[10px] font-normal ${est.cls}`}>{est.label}</Badge>}
                      {p.estado === "en_camino" && p.fecha_inicio_entrega && <span>salió {hora(p.fecha_inicio_entrega)}</span>}
                      {!ABIERTA_SEG(p.estado) && <span>{hora(p.fecha_cierre)}{p.origen_cierre === "odoo" ? " · desde Odoo" : ""}</span>}
                      {p.motivo_codigo && <span>· {etiquetaMotivo(p.motivo_codigo)}</span>}
                      {p.reprogramada_para && <span>· para el {fmtDia(p.reprogramada_para)}</span>}
                      {!pt && <span>· sin ubicación</span>}
                    </div>
                  </div>
                  {pt && <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={() => irA(pt)} aria-label={`Ver ${p.numero} en el mapa`}><Navigation className="h-3.5 w-3.5" /></Button>}
                </li>
              );
            })}
          </ol>
        )}
      </li>
    );
  };

  return (
    <div className="space-y-3">
      <Panel titulo={<><Truck className="h-4 w-4 text-amber-600" />En curso</>}
        acciones={(
          <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => cargar()} disabled={cargando} aria-label="Actualizar seguimiento">
            <RefreshCw className={`h-3.5 w-3.5 ${cargando ? "animate-spin" : ""}`} />Actualizar
          </Button>
        )}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="seg-fecha" className="text-xs">Día</Label>
            <Input id="seg-fecha" type="date" value={fecha} max={hoy} onChange={(e) => { if (e.target.value) { setFecha(e.target.value); setSel(null); } }} className="h-9 w-[150px]" />
          </div>
          <p className="text-xs text-muted-foreground tabular-nums" data-resumen-seguimiento>
            {reps.length} {reps.length === 1 ? "repartidor" : "repartidores"} · {resumen.hechas} de {resumen.total} paradas cerradas
            {resumen.enCamino ? ` · ${resumen.enCamino} en camino` : ""}{resumen.incidencias ? ` · ${resumen.incidencias} con incidencia` : ""}
            {" · "}{resumen.conPos} con posición
            {datos && <span className="block">{fecha === hoy ? `Actualizado ${fechaHora(datos.generado_at)} · se refresca cada minuto` : `Día pasado: ${fmtDia(fecha)}`}</span>}
          </p>
        </div>
      </Panel>

      {cargando && !datos ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : !reps.length ? (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No hay repartidores con paradas ni posición {fecha === hoy ? "hoy" : `el ${fmtDia(fecha)}`}.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="order-2 lg:order-1">
            <Panel sinPadding titulo={<>Repartidores ({reps.length}){sel && <button type="button" className="ml-1 text-[11px] font-normal text-primary hover:underline" onClick={() => { setSel(null); setAjuste((n) => n + 1); }}>ver todos</button>}</>}>
              <ul className="divide-y divide-border" data-lista="repartidores">{reps.map(tarjeta)}</ul>
            </Panel>
          </div>
          <div className="order-1 lg:order-2">
            <div className="lg:sticky lg:top-20">
              <div className="relative">
                <Mapa className="h-[300px] sm:h-[380px] lg:h-[calc(100vh-260px)] lg:min-h-[420px]" etiqueta="Mapa del seguimiento" marcadores={marcadores} linea={linea}
                  ajustarA={`${fecha}|${sel ?? ""}|${ajuste}`} enfoque={enfoque} onClickMarcador={clicMarcador} />
                <Button size="sm" variant="secondary" className="absolute left-2 top-2 h-8 gap-1 shadow" onClick={() => setAjuste((n) => n + 1)}><Maximize2 className="h-3.5 w-3.5" />Ver todo</Button>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Círculo azul con iniciales: última posición del repartidor (gris si es de hace más de {POSICION_VIEJA_MIN} min). Números: paradas (verde hecha,
                rojo rechazada o reprogramada, ámbar la siguiente). Al elegir un repartidor se ve su recorrido del día.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
