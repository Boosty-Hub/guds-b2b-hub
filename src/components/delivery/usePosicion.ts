import { useEffect, useState } from "react";

// GPS del teléfono (solo con la app abierta y si el repartidor da permiso). Una web no puede seguir la posición en
// segundo plano ni con la pantalla bloqueada.

export interface Posicion { lat: number; lng: number; precision: number; at: number }
export type EstadoPosicion = "pidiendo" | "ok" | "denegado" | "no_disponible";

const aPosicion = (p: GeolocationPosition): Posicion => ({ lat: p.coords.latitude, lng: p.coords.longitude, precision: Math.round(p.coords.accuracy), at: p.timestamp });

/** Sigue la posición mientras la pantalla está montada (Mi ruta). */
export function usePosicion(activo = true) {
  const [pos, setPos] = useState<Posicion | null>(null);
  const [estado, setEstado] = useState<EstadoPosicion>("pidiendo");
  useEffect(() => {
    if (!activo) return;
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) { setEstado("no_disponible"); return; }
    const id = navigator.geolocation.watchPosition(
      (p) => { setPos(aPosicion(p)); setEstado("ok"); },
      (err) => setEstado((e) => (err.code === err.PERMISSION_DENIED ? "denegado" : e === "ok" ? "ok" : "no_disponible")),
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [activo]);
  return { pos, estado };
}

/** Una lectura del GPS (al cerrar una entrega). Devuelve null si no hay permiso, señal o se agota el tiempo. */
export function leerPosicion(timeoutMs = 15000): Promise<Posicion | null> {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) return Promise.resolve(null);
  return new Promise((res) => {
    const t = setTimeout(() => res(null), timeoutMs + 1000);
    navigator.geolocation.getCurrentPosition(
      (p) => { clearTimeout(t); res(aPosicion(p)); },
      () => { clearTimeout(t); res(null); },
      { enableHighAccuracy: true, maximumAge: 30000, timeout: timeoutMs },
    );
  });
}
