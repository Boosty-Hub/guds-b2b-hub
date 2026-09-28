// Utilidades geográficas sin dependencias (no cargan Mapbox): distancias en línea recta, orden por cercanía y enlaces de
// navegación a Google Maps / Waze. Se usan en el admin (planificador de rutas) y en la app del repartidor.

export interface Punto { lat: number; lng: number }

export const CENTRO_VENEZUELA: Punto = { lat: 10.4806, lng: -66.9036 };   // Caracas

const rad = (g: number) => (g * Math.PI) / 180;

/** Distancia en línea recta (haversine) en km. */
export function distanciaKm(a: Punto, b: Punto): number {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Largo en km de un recorrido que pasa por los puntos en orden. */
export const largoKm = (puntos: Punto[]) => puntos.reduce((s, p, i) => (i ? s + distanciaKm(puntos[i - 1], p) : 0), 0);

export const fmtKm = (km: number) =>
  km < 1 ? `${Math.round(km * 1000)} m` : `${km.toLocaleString("es-VE", { maximumFractionDigits: km < 10 ? 1 : 0 })} km`;

/** Ordena por cercanía: vecino más cercano desde `inicio` y luego una pasada de 2-opt (quita cruces). Distancias en línea
 *  recta, del lado del cliente y sin costo. Los elementos sin ubicación van al final en su orden actual. */
export function ordenarPorCercania<T>(items: T[], pos: (t: T) => Punto | null, inicio: Punto | null): T[] {
  const con = items.filter((t) => pos(t));
  const sin = items.filter((t) => !pos(t));
  if (con.length < 2) return [...con, ...sin];
  const restantes = [...con];
  const ruta: T[] = [];
  let actual: Punto = inicio ?? pos(restantes[0])!;
  while (restantes.length) {
    let mejor = 0, dMejor = Infinity;
    restantes.forEach((t, i) => { const d = distanciaKm(actual, pos(t)!); if (d < dMejor) { dMejor = d; mejor = i; } });
    const [t] = restantes.splice(mejor, 1);
    ruta.push(t);
    actual = pos(t)!;
  }
  // 2-opt sobre el recorrido abierto que sale de `inicio` (si no hay inicio, del primer punto)
  const pts = () => [...(inicio ? [inicio] : []), ...ruta.map((t) => pos(t)!)];
  const off = inicio ? 1 : 0;
  let mejoro = true;
  for (let vuelta = 0; mejoro && vuelta < 50; vuelta++) {
    mejoro = false;
    const p = pts();
    for (let i = off; i < p.length - 1; i++) {
      for (let k = i + 1; k < p.length; k++) {
        const a = p[i - 1] ?? null, b = p[i], c = p[k], d = p[k + 1] ?? null;
        const antes = (a ? distanciaKm(a, b) : 0) + (d ? distanciaKm(c, d) : 0);
        const despues = (a ? distanciaKm(a, c) : 0) + (d ? distanciaKm(b, d) : 0);
        if (despues + 1e-9 < antes) {
          const ini = i - off, fin = k - off;
          ruta.splice(ini, fin - ini + 1, ...ruta.slice(ini, fin + 1).reverse());
          mejoro = true;
          break;
        }
      }
      if (mejoro) break;
    }
  }
  return [...ruta, ...sin];
}

// ── Navegación (enlaces; sin API ni costo) ──
export const navegarGoogle = (p: Punto) => `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${p.lat},${p.lng}`;
export const navegarWaze = (p: Punto) => `https://waze.com/ul?ll=${p.lat},${p.lng}&navigate=yes`;
export const verEnGoogle = (p: Punto) => `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;

/** Lee coordenadas pegadas ("10.4912, -66.8765", "10,4912 -66,8765" o un enlace de Google Maps con @lat,lng / q=lat,lng). */
export function leerCoordenadas(texto: string): Punto | null {
  const t = texto.trim();
  const enlace = t.match(/[@=](-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/);
  const m = enlace ?? t.match(/^(-?\d{1,2}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1].replace(",", ".")), lng = Number(m[2].replace(",", "."));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/** Recuadro amplio de Venezuela (el servidor rechaza puntos fuera; detecta latitud y longitud invertidas). */
export const enVenezuela = (p: Punto) => p.lat >= -1 && p.lat <= 14 && p.lng >= -75 && p.lng <= -58;
