import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { distanciaKm } from "@/components/mapas/geo";
import type { Posicion } from "@/components/delivery/usePosicion";

// Seguimiento del repartidor (D6, fase 20p): mientras está en Mi ruta o con una entrega en camino, la app guarda una
// lectura cada 2–3 min o al moverse más de 200 m y las manda en lote (registrar_posiciones). Solo con la app abierta: una
// web no sigue la posición con la pantalla bloqueada. Sin cola offline: si no hay señal, las lecturas esperan en memoria
// (máx. 30) y se reintentan en el siguiente envío. El servidor solo las acepta con reparto en curso.
const MUESTRA_MS = 150_000;     // una lectura cada 2,5 min…
const MOVIMIENTO_KM = 0.2;      // …o al moverse más de 200 m
const ENVIO_MS = 150_000;       // envío en lote cada 2,5 min (el primero, apenas hay posición)
const REVISION_MS = 30_000;
const PRECISION_MAX_M = 2000;
const MAX_PENDIENTES = 30;

interface Lectura { lat: number; lng: number; precision: number; at: number }

/**
 * @param activo  hay reparto en curso (Mi ruta con paradas abiertas, o una entrega en camino)
 * @param pos     posición que ya sigue la pantalla (Mi ruta usa usePosicion para el mapa); sin ella, el hook lee el GPS en
 *                modo de bajo consumo (sin alta precisión) solo mientras está activo
 */
export function usePingPosicion(activo: boolean, pos?: Posicion | null) {
  const ultima = useRef<Lectura | null>(null);
  const pendientes = useRef<Lectura[]>([]);
  const ultimoEnvio = useRef(0);
  const enviando = useRef(false);
  const detenido = useRef(false);   // el servidor dijo que no hay reparto en curso: no insistir hasta que cambie "activo"
  const activoRef = useRef(activo);
  activoRef.current = activo;

  const enviar = async (forzar = false) => {
    if (enviando.current || !pendientes.current.length || detenido.current) return;
    if (!forzar && ultimoEnvio.current && Date.now() - ultimoEnvio.current < ENVIO_MS) return;
    enviando.current = true;
    const lote = pendientes.current.slice(0, 60);
    try {
      const { data, error } = await supabase.rpc("registrar_posiciones", { p_puntos: lote });
      if (!error) {
        pendientes.current = pendientes.current.filter((p) => !lote.includes(p));
        ultimoEnvio.current = Date.now();
        if ((data as { activo?: boolean } | null)?.activo === false) detenido.current = true;
      }
    } catch { /* sin señal: se reintenta en el próximo envío */ }
    finally { enviando.current = false; }
  };

  const muestra = (p: Lectura) => {
    if (!activoRef.current || detenido.current || !(p.precision <= PRECISION_MAX_M)) return;
    const u = ultima.current;
    const movio = u ? distanciaKm(u, p) >= MOVIMIENTO_KM : true;
    if (u && p.at - u.at < MUESTRA_MS && !movio) return;
    ultima.current = p;
    pendientes.current = [...pendientes.current, p].slice(-MAX_PENDIENTES);
    void enviar(!ultimoEnvio.current);   // la primera sale al momento; el resto, en lote
  };

  // Al activarse de nuevo se vuelve a intentar (p. ej. salió a entregar otra parada)
  useEffect(() => { if (activo) detenido.current = false; }, [activo]);

  // Posición que ya sigue la pantalla
  useEffect(() => {
    if (!activo || !pos) return;
    muestra({ lat: pos.lat, lng: pos.lng, precision: pos.precision, at: pos.at || Date.now() });
  }, [activo, pos?.lat, pos?.lng, pos?.at]); // eslint-disable-line react-hooks/exhaustive-deps

  // GPS propio (bajo consumo) si la pantalla no lo sigue, revisión periódica (lectura si está quieto) y envío al ocultar la app
  const conPosExterna = pos !== undefined;
  useEffect(() => {
    if (!activo || typeof navigator === "undefined" || !("geolocation" in navigator)) return;
    const aLectura = (g: GeolocationPosition): Lectura => ({ lat: g.coords.latitude, lng: g.coords.longitude, precision: Math.round(g.coords.accuracy), at: g.timestamp || Date.now() });
    const watch = conPosExterna ? null : navigator.geolocation.watchPosition((g) => muestra(aLectura(g)), () => {}, { enableHighAccuracy: false, maximumAge: 60_000, timeout: 30_000 });
    const t = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (!ultima.current || Date.now() - ultima.current.at >= MUESTRA_MS) {
        navigator.geolocation.getCurrentPosition((g) => muestra(aLectura(g)), () => {}, { enableHighAccuracy: false, maximumAge: 60_000, timeout: 20_000 });
      }
      void enviar();
    }, REVISION_MS);
    const alOcultar = () => { if (document.visibilityState === "hidden") void enviar(true); };
    document.addEventListener("visibilitychange", alOcultar);
    return () => {
      if (watch != null) navigator.geolocation.clearWatch(watch);
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", alOcultar);
      void enviar(true);
    };
  }, [activo, conPosExterna]); // eslint-disable-line react-hooks/exhaustive-deps
}
