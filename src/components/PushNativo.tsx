import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useNotifications } from "@/contexts/NotificationsContext";
import {
  activarPushParaSesion,
  esAppNativa,
  EVENTO_PUSH_RECIBIDA,
  EVENTO_TOQUE_PUSH,
  iniciarPushNativo,
  limpiarNotificacionesEntregadas,
  sesionTerminadaPush,
  tomarToquePendiente,
} from "@/lib/pushNativo";

// Pantallas donde no se pide el permiso de notificaciones (todavía no hay una sesión "en uso")
const SIN_PEDIR_PERMISO = ["/login", "/restablecer-clave", "/registro"];
// En /login, al iniciar sesión Login.tsx redirige al panel del rol: se espera a esa redirección antes de consumir un toque.
const ESPERA_EN_LOGIN_MS = 800;

/**
 * Puente entre las notificaciones push de la app nativa y la web: registra el teléfono con la sesión, navega al tocar una
 * notificación y refresca la campanita al recibir una con la app abierta. En el navegador no hace nada.
 * Va dentro del router y fuera de RemontarPorEmpresa (no debe remontarse al cambiar de empresa).
 */
export function PushNativo() {
  const nativa = esAppNativa();
  const { user, loading } = useAuth();
  const { refresh } = useNotifications();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    if (nativa) void iniciarPushNativo();
  }, [nativa]);

  // Registro del teléfono con la sesión (el permiso se pide fuera de la pantalla de login)
  const usuarioId = user?.id;
  const pedirPermiso = !SIN_PEDIR_PERMISO.some((p) => pathname.startsWith(p));
  useEffect(() => {
    if (!nativa || loading) return;
    if (!usuarioId) { sesionTerminadaPush(); return; }
    void activarPushParaSesion(usuarioId, pedirPermiso);
  }, [nativa, loading, usuarioId, pedirPermiso]);

  // Toque en una notificación: se consume cuando hay sesión y router
  const temporizador = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const consumir = useRef<() => void>(() => {});
  consumir.current = () => {
    if (!nativa || loading || !usuarioId) return;
    clearTimeout(temporizador.current);
    const ir = () => {
      const ruta = tomarToquePendiente();
      if (!ruta) return;
      navigate(ruta);
      limpiarNotificacionesEntregadas();
    };
    if (pathname === "/login") temporizador.current = setTimeout(ir, ESPERA_EN_LOGIN_MS);
    else ir();
  };
  useEffect(() => {
    consumir.current();
    return () => clearTimeout(temporizador.current);
  }, [nativa, loading, usuarioId, pathname]);
  useEffect(() => {
    if (!nativa) return;
    const alTocar = () => consumir.current();
    window.addEventListener(EVENTO_TOQUE_PUSH, alTocar);
    return () => window.removeEventListener(EVENTO_TOQUE_PUSH, alTocar);
  }, [nativa]);

  // Llegó una notificación con la app abierta: refrescar la campanita (y con ella la lista del portal)
  useEffect(() => {
    if (!nativa) return;
    const alRecibir = () => { void refresh(); };
    window.addEventListener(EVENTO_PUSH_RECIBIDA, alRecibir);
    return () => window.removeEventListener(EVENTO_PUSH_RECIBIDA, alRecibir);
  }, [nativa, refresh]);

  return null;
}
