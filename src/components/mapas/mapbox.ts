// Carga diferida de Mapbox GL (≈1,5 MB): solo se descarga en las pantallas que muestran un mapa (planificador, editor de
// ubicación y "Mi ruta" del repartidor), para ahorrar datos. El token público va en VITE_MAPBOX_TOKEN (nunca en el código).
import type mapboxgl from "mapbox-gl";
import type { Punto } from "./geo";

export type MapboxGL = typeof mapboxgl;

export const TOKEN_MAPBOX = (import.meta.env.VITE_MAPBOX_TOKEN as string | undefined)?.trim() || "";
export const ESTILO_MAPA = "mapbox://styles/mapbox/streets-v12";

let cargando: Promise<MapboxGL> | null = null;

export function cargarMapbox(): Promise<MapboxGL> {
  if (!TOKEN_MAPBOX) return Promise.reject(new Error("Falta configurar el token de Mapbox (VITE_MAPBOX_TOKEN)."));
  if (!cargando) {
    cargando = Promise.all([import("mapbox-gl"), import("mapbox-gl/dist/mapbox-gl.css")])
      .then(([m]) => {
        const gl = (m as unknown as { default: MapboxGL }).default ?? (m as unknown as MapboxGL);
        gl.accessToken = TOKEN_MAPBOX;
        return gl;
      })
      .catch((e) => { cargando = null; throw e; });
  }
  return cargando;
}

/** El mapa necesita WebGL (algunos teléfonos viejos o navegadores con aceleración apagada no lo tienen). */
export function webglDisponible(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export interface ResultadoGeo { id: string; nombre: string; detalle: string; lat: number; lng: number; tipo: string }

/** Geocodificación TEMPORAL de Mapbox (API v6): solo sirve para centrar el mapa. Sus términos no permiten guardar el
 *  resultado; lo que se guarda es el pin que pone una persona. En Venezuela suele devolver solo la ciudad o el sector. */
export async function geocodificar(q: string, cerca?: Punto | null, signal?: AbortSignal): Promise<ResultadoGeo[]> {
  const texto = q.replace(/_x000D_/gi, " ").replace(/\s+/g, " ").trim().slice(0, 250);
  if (!texto || !TOKEN_MAPBOX) return [];
  const params = new URLSearchParams({ q: texto, country: "ve", language: "es", limit: "5", access_token: TOKEN_MAPBOX });
  if (cerca) params.set("proximity", `${cerca.lng},${cerca.lat}`);
  const r = await fetch(`https://api.mapbox.com/search/geocode/v6/forward?${params}`, { signal });
  if (!r.ok) throw new Error(`La búsqueda de direcciones no respondió (${r.status})`);
  const j = (await r.json()) as { features?: { id: string; geometry: { coordinates: [number, number] }; properties: { name?: string; full_address?: string; place_formatted?: string; feature_type?: string } }[] };
  return (j.features ?? []).map((f) => ({
    id: f.id, nombre: f.properties.name || f.properties.full_address || "Resultado", detalle: f.properties.place_formatted || f.properties.full_address || "",
    lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], tipo: f.properties.feature_type || "",
  }));
}
