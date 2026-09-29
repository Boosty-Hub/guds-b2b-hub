import { useEffect, useSyncExternalStore } from "react";
import { alQuedarLibre } from "@/lib/diferir";

// Código que no hace falta para pintar la primera pantalla (menús, diálogos, hojas laterales): se descarga aparte,
// cuando el navegador queda libre tras la carga o en cuanto el usuario se acerca al control, lo que ocurra primero.
// Mientras tanto se muestra un disparador con el mismo aspecto (sin Radix ni su motor de posicionamiento).
export function cargaDiferida<M>(cargar: () => Promise<M>) {
  let modulo: M | null = null;
  let enCurso: Promise<M> | null = null;
  const oyentes = new Set<() => void>();

  /** Pide el módulo (una sola descarga); si falla, se puede volver a pedir. */
  const pedir = (): Promise<M> => {
    enCurso ??= cargar().then(
      (m) => { modulo = m; oyentes.forEach((f) => f()); return m; },
      (e) => { enCurso = null; throw e; },
    );
    return enCurso;
  };
  const pedirSinError = () => { pedir().catch(() => { /* se reintenta en la próxima interacción */ }); };

  const suscribir = (f: () => void) => { oyentes.add(f); return () => { oyentes.delete(f); }; };
  const leer = () => modulo;

  /** El módulo si ya llegó (null mientras tanto). Si `precargar`, lo pide cuando el navegador queda libre. */
  const useModulo = (precargar = true): M | null => {
    const m = useSyncExternalStore(suscribir, leer, leer);
    useEffect(() => (modulo || !precargar ? undefined : alQuedarLibre(pedirSinError, 1500)), [precargar]);
    return m;
  };

  return { pedir: pedirSinError, useModulo };
}
