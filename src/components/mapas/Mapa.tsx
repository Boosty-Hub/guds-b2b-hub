import { useEffect, useRef, useState } from "react";
import type mapboxgl from "mapbox-gl";
import { Loader2, MapPinOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { cargarMapbox, webglDisponible, ESTILO_MAPA, type MapboxGL } from "./mapbox";
import { CENTRO_VENEZUELA, type Punto } from "./geo";

// Mapa (Mapbox GL) con marcadores HTML numerados, línea de recorrido opcional, pin arrastrable y clic para ubicar.
// Carga Mapbox solo cuando se monta. Si no hay token o WebGL, muestra un aviso y el resto de la pantalla sigue funcionando.

export type TonoMarcador = "parada" | "siguiente" | "propuesta" | "hecha" | "salida" | "yo" | "busqueda" | "pin";

export interface MarcadorMapa extends Punto {
  id: string;
  etiqueta?: string;
  tono?: TonoMarcador;
  titulo?: string;
  arrastrable?: boolean;
}

const CLASES: Record<Exclude<TonoMarcador, "pin">, string> = {
  parada: "h-7 min-w-7 px-1 bg-primary text-primary-foreground text-xs",
  siguiente: "h-9 min-w-9 px-1 bg-amber-500 text-white text-sm ring-4 ring-amber-500/30",
  propuesta: "h-7 min-w-7 px-1 bg-white text-amber-800 text-xs border-2 border-dashed border-amber-500",
  hecha: "h-6 min-w-6 px-1 bg-emerald-600 text-white text-[11px] opacity-90",
  salida: "h-7 w-7 rounded-md bg-slate-800 text-white text-[11px]",
  yo: "h-4 w-4 bg-sky-500 ring-4 ring-sky-500/30",
  busqueda: "h-3.5 w-3.5 bg-slate-500",
};

function elementoMarcador(m: MarcadorMapa, onClick?: (id: string) => void): HTMLElement {
  const el = document.createElement("div");
  const tono = (m.tono ?? "parada") as Exclude<TonoMarcador, "pin">;
  el.className = cn("flex cursor-pointer select-none items-center justify-center rounded-full font-bold shadow-md ring-2 ring-white", CLASES[tono]);
  if (tono === "salida") el.classList.remove("rounded-full");
  el.textContent = m.etiqueta ?? "";
  el.dataset.marcador = m.id;
  el.dataset.tono = tono;
  if (m.titulo) { el.title = m.titulo; el.setAttribute("aria-label", m.titulo); }
  if (onClick) el.addEventListener("click", (ev) => { ev.stopPropagation(); onClick(m.id); });
  return el;
}

interface Enfoque extends Punto { zoom?: number; clave: string | number }

// Paradas en el mismo punto (p. ej. dos documentos para la misma sucursal): un solo marcador "2·3"
const PRIORIDAD: Partial<Record<TonoMarcador, number>> = { siguiente: 4, parada: 3, propuesta: 2, hecha: 1 };
function agrupar(marcadores: MarcadorMapa[]): MarcadorMapa[] {
  const salida: MarcadorMapa[] = [];
  const porPunto = new Map<string, MarcadorMapa>();
  for (const m of marcadores) {
    if (!PRIORIDAD[m.tono ?? "parada"] || m.arrastrable) { salida.push(m); continue; }
    const k = `${m.lat.toFixed(5)},${m.lng.toFixed(5)}`;
    const g = porPunto.get(k);
    if (!g) { const n = { ...m }; porPunto.set(k, n); salida.push(n); continue; }
    g.etiqueta = [g.etiqueta, m.etiqueta].filter(Boolean).join("·");
    g.titulo = [g.titulo, m.titulo].filter(Boolean).join("\n");
    if ((PRIORIDAD[m.tono ?? "parada"] ?? 0) > (PRIORIDAD[g.tono ?? "parada"] ?? 0)) g.tono = m.tono;
  }
  return salida;
}

export function Mapa({
  marcadores, linea, ajustarA, enfoque, onClickMapa, onArrastrar, onClickMarcador, className, centroInicial, zoomInicial = 11, etiqueta = "Mapa",
}: {
  marcadores: MarcadorMapa[];
  /** Recorrido en orden (línea recta entre puntos). */
  linea?: Punto[];
  /** Cuando cambia, el mapa se ajusta para mostrar todos los marcadores. */
  ajustarA?: string | number;
  /** Cuando cambia su clave, el mapa vuela a ese punto. */
  enfoque?: Enfoque | null;
  onClickMapa?: (p: Punto) => void;
  onArrastrar?: (id: string, p: Punto) => void;
  onClickMarcador?: (id: string) => void;
  className?: string;
  centroInicial?: Punto | null;
  zoomInicial?: number;
  etiqueta?: string;
}) {
  const contRef = useRef<HTMLDivElement>(null);
  const mapaRef = useRef<mapboxgl.Map | null>(null);
  const glRef = useRef<MapboxGL | null>(null);
  const marcasRef = useRef(new Map<string, { m: mapboxgl.Marker; firma: string }>());
  const cb = useRef({ onClickMapa, onArrastrar, onClickMarcador });
  cb.current = { onClickMapa, onArrastrar, onClickMarcador };
  const [estado, setEstado] = useState<"cargando" | "listo" | "error">("cargando");
  const [error, setError] = useState("");

  // Crear el mapa una sola vez
  useEffect(() => {
    let vivo = true;
    let ro: ResizeObserver | null = null;
    if (!webglDisponible()) { setEstado("error"); setError("Este dispositivo no puede mostrar el mapa (WebGL desactivado)."); return; }
    cargarMapbox().then((gl) => {
      if (!vivo || !contRef.current) return;
      glRef.current = gl;
      const c = centroInicial ?? CENTRO_VENEZUELA;
      const mapa = new gl.Map({
        container: contRef.current, style: ESTILO_MAPA, center: [c.lng, c.lat], zoom: zoomInicial,
        dragRotate: false, pitchWithRotate: false, attributionControl: true, locale: { "NavigationControl.ZoomIn": "Acercar", "NavigationControl.ZoomOut": "Alejar" },
      });
      mapa.touchZoomRotate.disableRotation();
      mapa.addControl(new gl.NavigationControl({ showCompass: false }), "top-right");
      mapa.on("click", (e) => cb.current.onClickMapa?.({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
      // Sin este manejador Mapbox escribe cada error de red en la consola; aquí solo se avisa si el token no sirve
      mapa.on("error", (e) => {
        const st = (e?.error as { status?: number } | undefined)?.status;
        if (st === 401 || st === 403) { setEstado("error"); setError("El mapa no está disponible (token de Mapbox no autorizado para este sitio)."); }
      });
      mapa.on("load", () => { if (vivo) setEstado("listo"); });
      mapaRef.current = mapa;
      ro = new ResizeObserver(() => mapa.resize());
      ro.observe(contRef.current);
    }).catch((e: Error) => { if (vivo) { setEstado("error"); setError(e.message || "No se pudo cargar el mapa."); } });
    return () => {
      vivo = false;
      ro?.disconnect();
      marcasRef.current.forEach(({ m }) => m.remove());
      marcasRef.current.clear();
      mapaRef.current?.remove();
      mapaRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Marcadores: se agregan, mueven o quitan según su id (sin recrear los que no cambian)
  useEffect(() => {
    const mapa = mapaRef.current, gl = glRef.current;
    if (estado !== "listo" || !mapa || !gl) return;
    const vistos = new Set<string>();
    for (const m of agrupar(marcadores)) {
      vistos.add(m.id);
      const firma = `${m.tono}|${m.etiqueta}|${m.titulo}|${m.arrastrable}`;
      const previo = marcasRef.current.get(m.id);
      if (previo && previo.firma === firma) { previo.m.setLngLat([m.lng, m.lat]); continue; }
      previo?.m.remove();
      const marcador = m.tono === "pin"
        ? new gl.Marker({ color: "#dc2626", draggable: !!m.arrastrable, anchor: "bottom" })
        : new gl.Marker({ element: elementoMarcador(m, (id) => cb.current.onClickMarcador?.(id)), draggable: !!m.arrastrable, anchor: "center" });
      if (m.tono === "pin") {
        const el = marcador.getElement();
        el.dataset.marcador = m.id; el.dataset.tono = "pin";
        if (m.titulo) el.title = m.titulo;
      }
      marcador.setLngLat([m.lng, m.lat]).addTo(mapa);
      if (m.arrastrable) marcador.on("dragend", () => { const p = marcador.getLngLat(); cb.current.onArrastrar?.(m.id, { lat: p.lat, lng: p.lng }); });
      marcasRef.current.set(m.id, { m: marcador, firma });
    }
    for (const [id, { m }] of marcasRef.current) if (!vistos.has(id)) { m.remove(); marcasRef.current.delete(id); }
  }, [estado, marcadores]);

  // Línea del recorrido
  useEffect(() => {
    const mapa = mapaRef.current;
    if (estado !== "listo" || !mapa) return;
    const datos = { type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: (linea ?? []).map((p) => [p.lng, p.lat]) } };
    const fuente = mapa.getSource("recorrido") as mapboxgl.GeoJSONSource | undefined;
    if (fuente) fuente.setData(datos);
    else if (linea?.length) {
      mapa.addSource("recorrido", { type: "geojson", data: datos });
      mapa.addLayer({ id: "recorrido", type: "line", source: "recorrido", layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#2563eb", "line-width": 3, "line-opacity": 0.55, "line-dasharray": [2, 1.5] } });
    }
  }, [estado, linea]);

  // Ajustar a los marcadores
  useEffect(() => {
    const mapa = mapaRef.current, gl = glRef.current;
    if (estado !== "listo" || !mapa || !gl || ajustarA === undefined) return;
    const pts = marcadores.filter((m) => m.tono !== "busqueda");
    if (!pts.length) return;
    if (pts.length === 1) { mapa.jumpTo({ center: [pts[0].lng, pts[0].lat], zoom: Math.max(mapa.getZoom(), 14) }); return; }
    const b = new gl.LngLatBounds();
    pts.forEach((p) => b.extend([p.lng, p.lat]));
    mapa.fitBounds(b, { padding: 56, maxZoom: 15, duration: 0 });
  }, [estado, ajustarA]); // eslint-disable-line react-hooks/exhaustive-deps

  // Volar a un punto
  useEffect(() => {
    const mapa = mapaRef.current;
    if (estado !== "listo" || !mapa || !enfoque) return;
    mapa.flyTo({ center: [enfoque.lng, enfoque.lat], zoom: enfoque.zoom ?? Math.max(mapa.getZoom(), 15), duration: 600 });
  }, [estado, enfoque?.clave]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={cn("relative overflow-hidden rounded-lg border border-border bg-muted/40", className)} data-mapa={estado} role="region" aria-label={etiqueta}>
      {/* Estilo en línea: mapbox-gl.css pone .mapboxgl-map { position: relative } y dejaría el contenedor sin alto */}
      <div ref={contRef} style={{ position: "absolute", inset: 0 }} />
      {estado === "cargando" && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />Cargando mapa…</div>
      )}
      {estado === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted/80 p-4 text-center text-sm text-muted-foreground">
          <MapPinOff className="h-6 w-6" />{error}
        </div>
      )}
    </div>
  );
}
