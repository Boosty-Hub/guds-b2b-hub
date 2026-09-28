import { useEffect, useState, useSyncExternalStore } from "react";
import { useAuth } from "@/contexts/AuthContext";

// Tema del portal del cliente (claro, oscuro o el del sistema). Se recuerda por usuario en este navegador y se aplica con
// la clase `dark` en <html> (los tokens de index.css ya tienen su versión oscura) solo mientras el portal está montado:
// al salir (p. ej. a /login) se quita.

export type TemaPortal = "claro" | "oscuro" | "sistema";

const clave = (uid: string) => `guds.tema.${uid}`;
const leer = (uid: string): TemaPortal => {
  try {
    const v = localStorage.getItem(clave(uid));
    return v === "oscuro" || v === "sistema" ? v : "claro";
  } catch {
    return "claro";
  }
};

let actual: { uid: string | null; tema: TemaPortal } = { uid: null, tema: "claro" };
const oyentes = new Set<() => void>();
const suscribir = (f: () => void) => { oyentes.add(f); return () => { oyentes.delete(f); }; };
const avisar = () => oyentes.forEach((f) => f());

/** Tema elegido por el usuario y cómo cambiarlo (compartido entre el shell y Preferencias). */
export function useTemaPortal() {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  if (actual.uid !== uid) actual = { uid, tema: uid ? leer(uid) : "claro" };
  const tema = useSyncExternalStore(suscribir, () => actual.tema, () => "claro" as TemaPortal);
  const cambiar = (t: TemaPortal) => {
    if (uid) { try { localStorage.setItem(clave(uid), t); } catch { /* sin almacenamiento */ } }
    actual = { uid, tema: t };
    avisar();
  };
  return [tema, cambiar] as const;
}

const consultaOscuro = "(prefers-color-scheme: dark)";

/** Aplica el tema en <html> mientras el componente (el shell del portal) esté montado. */
export function useAplicarTemaPortal() {
  const [tema] = useTemaPortal();
  const [sistemaOscuro, setSistemaOscuro] = useState(() => typeof window !== "undefined" && window.matchMedia(consultaOscuro).matches);

  useEffect(() => {
    if (tema !== "sistema") return;
    const mql = window.matchMedia(consultaOscuro);
    const cambio = () => setSistemaOscuro(mql.matches);
    cambio();
    mql.addEventListener("change", cambio);
    return () => mql.removeEventListener("change", cambio);
  }, [tema]);

  const oscuro = tema === "oscuro" || (tema === "sistema" && sistemaOscuro);
  useEffect(() => {
    const html = document.documentElement;
    html.classList.toggle("dark", oscuro);
    html.style.colorScheme = oscuro ? "dark" : "";
    return () => {
      html.classList.remove("dark");
      html.style.colorScheme = "";
    };
  }, [oscuro]);
}
