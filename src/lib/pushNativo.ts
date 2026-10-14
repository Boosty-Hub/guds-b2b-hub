// Notificaciones push de la app nativa (Capacitor: Guds Store para iOS/Android). En el navegador no hace nada y no
// descarga los plugins (se cargan con import() solo dentro de la app).
//
//   · Se detecta la app con window.Capacitor.isNativePlatform() (nunca por el user agent).
//   · Los listeners se enganchan ANTES de register() y una sola vez por proceso (guarda de módulo).
//   · El permiso se pide después de iniciar sesión (no en la pantalla de login). Si se niega, no se vuelve a pedir ni a
//     reintentar; si luego se activa en Ajustes del teléfono, al abrir la app se registra sin preguntar.
//   · El registro cuenta solo cuando la RPC registrar_dispositivo responde bien; si falla se reintenta (30 s → 30 min) y
//     al volver la app a primer plano.
//   · Toque en una notificación: queda como "toque pendiente" y la app lo consume (tomarToquePendiente) cuando hay sesión
//     y router; con la app abierta se avisa con el evento EVENTO_TOQUE_PUSH y se navega de inmediato. Solo se navega a
//     rutas relativas del portal.
//   · Cerrar sesión: supabase.auth.signOut() (cualquier camino) primero quita el token con quitar_dispositivo (máx. 4 s,
//     ver antesDeCerrarSesion en lib/supabase.ts). Si no se confirma, el token queda pendiente y al abrir la app se borra
//     con quitar_token_huerfano.
import { antesDeCerrarSesion, supabase } from "@/lib/supabase";

/** Llegó una notificación con la app en primer plano (la campanita se refresca). */
export const EVENTO_PUSH_RECIBIDA = "push:recibida";
/** Se tocó una notificación con la app abierta: hay un toque pendiente para consumir. */
export const EVENTO_TOQUE_PUSH = "push:toque";

const CLAVE_TOKEN = "guds.push.token";
const CLAVE_HUERFANO = "guds.push.huerfano";
const ESPERA_INICIAL_MS = 30_000;
const ESPERA_MAXIMA_MS = 30 * 60_000;
const ESPERA_QUITAR_MS = 4_000;

type CapacitorGlobal = { isNativePlatform?: () => boolean; getPlatform?: () => string };
type PluginPush = typeof import("@capacitor/push-notifications").PushNotifications;
type PluginApp = typeof import("@capacitor/app").App;

export function esAppNativa(): boolean {
  try {
    return !!(window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
}

function plataforma(): "ios" | "android" | null {
  const p = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor?.getPlatform?.();
  return p === "ios" || p === "android" ? p : null;
}

const leer = (clave: string) => { try { return localStorage.getItem(clave); } catch { return null; } };
const guardar = (clave: string, valor: string) => { try { localStorage.setItem(clave, valor); } catch { /* sin almacenamiento */ } };
const borrar = (clave: string) => { try { localStorage.removeItem(clave); } catch { /* sin almacenamiento */ } };

// ── Estado del módulo (uno por proceso de la app) ───────────────────────────────────────────────────────────────────
let inicio: Promise<void> | null = null;
let push: PluginPush | null = null;
let app: PluginApp | null = null;
let tokenActual: string | null = null;
let sesion: { usuarioId: string; pedirPermiso: boolean } | null = null;
let registradoPara: string | null = null;     // `${usuarioId}:${token}` confirmado por la RPC
let registroEnCurso: Promise<void> | null = null;
let pidiendoPermiso = false;
let permisoDenegado = false;
let reintento: ReturnType<typeof setTimeout> | null = null;
let espera = ESPERA_INICIAL_MS;
let limpiezaHuerfano: Promise<void> = Promise.resolve();
let toquePendiente: string | null = null;

/** Convierte el link de la notificación en una ruta interna segura del portal (o null). */
export function rutaSegura(link: unknown): string | null {
  if (typeof link !== "string") return null;
  const l = link.trim();
  if (!l || l.length > 2048 || l.includes("\\") || [...l].some((c) => c.charCodeAt(0) < 32)) return null;
  try {
    const u = new URL(l, window.location.origin);
    if (u.origin !== window.location.origin) return null;
    if (!u.pathname.startsWith("/") || u.pathname.startsWith("//")) return null;
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return null;
  }
}

/** Devuelve (y olvida) la ruta del último toque en una notificación, si lo hay. */
export function tomarToquePendiente(): string | null {
  const r = toquePendiente;
  toquePendiente = null;
  return r;
}

/** Quita del centro de notificaciones del teléfono las que ya se atendieron. */
export function limpiarNotificacionesEntregadas(): void {
  push?.removeAllDeliveredNotifications().catch(() => { /* sin permiso o no disponible */ });
}

function cancelarReintento() {
  if (reintento) clearTimeout(reintento);
  reintento = null;
}

function programarReintento(accion: () => void) {
  cancelarReintento();
  const ms = espera;
  espera = Math.min(espera * 2, ESPERA_MAXIMA_MS);
  reintento = setTimeout(() => { reintento = null; accion(); }, ms);
}

function nombreDispositivo(): string {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua)) return "iPad";
  if (/iPhone/.test(ua)) return "iPhone";
  const android = ua.match(/Android [\d.]+;\s*([^;)]+)/);
  return android ? android[1].trim().slice(0, 100) : (plataforma() ?? "Dispositivo");
}

async function versionApp(): Promise<string | null> {
  try {
    const info = await app?.getInfo();
    return info ? `${info.version} (${info.build})` : null;
  } catch {
    return null;
  }
}

function registrarToken(): Promise<void> {
  if (registroEnCurso) return registroEnCurso;
  const par = () => (sesion && tokenActual ? `${sesion.usuarioId}:${tokenActual}` : null);
  const intento = par();
  registroEnCurso = registrarTokenAhora().finally(() => {
    registroEnCurso = null;
    // El token o la sesión cambiaron mientras se registraba: se registra lo vigente (salvo que haya un reintento en espera)
    const vigente = par();
    if (vigente && vigente !== intento && vigente !== registradoPara && !reintento) void registrarToken();
  });
  return registroEnCurso;
}

async function registrarTokenAhora(): Promise<void> {
  const token = tokenActual;
  const actual = sesion;
  const p = plataforma();
  if (!token || !actual || !p) return;
  if (registradoPara === `${actual.usuarioId}:${token}`) return;
  try {
    await limpiezaHuerfano;
    const { error } = await supabase.rpc("registrar_dispositivo", {
      p_token: token,
      p_platform: p,
      p_app_version: await versionApp(),
      p_device_name: nombreDispositivo(),
    });
    if (error) throw error;
    // La sesión pudo cambiar mientras tanto: solo cuenta si sigue siendo la misma
    if (sesion?.usuarioId !== actual.usuarioId) return;
    registradoPara = `${actual.usuarioId}:${token}`;
    espera = ESPERA_INICIAL_MS;
    cancelarReintento();
    guardar(CLAVE_TOKEN, token);
    // Registrarlo de nuevo reemplaza al dueño anterior: un borrado pendiente de este token ya no hace falta
    if (leer(CLAVE_HUERFANO) === token) borrar(CLAVE_HUERFANO);
  } catch (e) {
    console.warn("Push: no se pudo registrar el dispositivo; se reintentará", e);
    if (sesion) programarReintento(() => { void registrarToken(); });
  }
}

async function pedirRegistroNativo(): Promise<void> {
  if (!push || !sesion || permisoDenegado || pidiendoPermiso) return;
  pidiendoPermiso = true;
  try {
    let estado = (await push.checkPermissions()).receive;
    if (estado === "denied") { permisoDenegado = true; return; }
    if (estado !== "granted") {
      // Primera vez: solo fuera de la pantalla de login
      if (!sesion.pedirPermiso) return;
      estado = (await push.requestPermissions()).receive;
      if (estado !== "granted") { permisoDenegado = true; return; }
    }
    if (plataforma() === "android") {
      await push.createChannel({ id: "general", name: "General", importance: 4 }).catch(() => { /* ya existe */ });
    }
    if (tokenActual) await registrarToken();
    // register() también entrega el token vigente si cambió; el resultado llega por el listener 'registration'
    await push.register();
  } catch (e) {
    console.warn("Push: no se pudo activar el registro", e);
    programarReintento(() => { void pedirRegistroNativo(); });
  } finally {
    pidiendoPermiso = false;
  }
}

async function limpiarHuerfano(): Promise<void> {
  const token = leer(CLAVE_HUERFANO);
  if (!token) return;
  const { error } = await supabase.rpc("quitar_token_huerfano", { p_token: token });
  if (!error && leer(CLAVE_HUERFANO) === token) borrar(CLAVE_HUERFANO);
}

/** Quita el token del usuario que cierra sesión (con la sesión aún válida). Máximo 4 s; si no se confirma, queda pendiente. */
async function quitarAntesDeSalir(): Promise<void> {
  const token = tokenActual ?? leer(CLAVE_TOKEN);
  sesion = null;
  registradoPara = null;
  cancelarReintento();
  if (!token) return;
  let confirmado = false;
  try {
    const quitar = async () => {
      // Un registro en vuelo podría volver a dejar el token a nombre de este usuario: se espera a que termine
      await registroEnCurso?.catch(() => {});
      return supabase.rpc("quitar_dispositivo", { p_token: token });
    };
    const r = await Promise.race([
      quitar(),
      new Promise<null>((ok) => setTimeout(() => ok(null), ESPERA_QUITAR_MS)),
    ]);
    confirmado = !!r && !r.error;
  } catch {
    confirmado = false;
  }
  if (!confirmado) guardar(CLAVE_HUERFANO, token);
}

/**
 * Engancha los listeners (una vez por proceso) y limpia un token huérfano de un cierre de sesión anterior.
 * No pide permiso: eso lo hace activarPushParaSesion.
 */
export function iniciarPushNativo(): Promise<void> {
  if (!esAppNativa()) return Promise.resolve();
  if (inicio) return inicio;
  inicio = (async () => {
    const [{ PushNotifications }, { App }] = await Promise.all([
      import("@capacitor/push-notifications"),
      import("@capacitor/app"),
    ]);
    push = PushNotifications;
    app = App;

    await PushNotifications.addListener("registration", ({ value }) => {
      if (!value) return;
      tokenActual = value;
      void registrarToken();
    });
    await PushNotifications.addListener("registrationError", (err) => {
      console.warn("Push: el sistema no entregó el token", err?.error);
      if (sesion) programarReintento(() => { void pedirRegistroNativo(); });
    });
    await PushNotifications.addListener("pushNotificationReceived", () => {
      window.dispatchEvent(new Event(EVENTO_PUSH_RECIBIDA));
    });
    await PushNotifications.addListener("pushNotificationActionPerformed", (accion) => {
      const datos = (accion?.notification?.data ?? {}) as Record<string, unknown>;
      toquePendiente = rutaSegura(datos.link);
      window.dispatchEvent(new Event(EVENTO_TOQUE_PUSH));
      if (!toquePendiente) limpiarNotificacionesEntregadas();
    });
    await App.addListener("appStateChange", ({ isActive }) => {
      if (!isActive) return;
      if (!sesion) { limpiezaHuerfano = limpiarHuerfano().catch(() => {}); return; }
      if (permisoDenegado) {
        // El usuario pudo activarlo en Ajustes: comprobarlo no es volver a pedirlo
        void push?.checkPermissions().then(({ receive }) => {
          if (receive === "granted") { permisoDenegado = false; void pedirRegistroNativo(); }
        }).catch(() => {});
        return;
      }
      cancelarReintento();
      if (tokenActual) void registrarToken();
      else void pedirRegistroNativo();
    });

    // Cualquier supabase.auth.signOut() quita antes el token de este teléfono
    antesDeCerrarSesion(quitarAntesDeSalir);

    limpiezaHuerfano = limpiarHuerfano().catch(() => {});
  })().catch((e) => {
    console.warn("Push: no se pudieron cargar los plugins nativos", e);
    inicio = null;
  });
  return inicio;
}

/**
 * Hay sesión: registra este teléfono para el usuario. `pedirPermiso` = false en la pantalla de login (si el permiso ya
 * estaba concedido se registra igual, sin preguntar).
 */
export async function activarPushParaSesion(usuarioId: string, pedirPermiso: boolean): Promise<void> {
  if (!esAppNativa()) return;
  const cambioUsuario = sesion?.usuarioId !== usuarioId;
  sesion = { usuarioId, pedirPermiso };
  if (cambioUsuario) { espera = ESPERA_INICIAL_MS; cancelarReintento(); }
  await iniciarPushNativo();
  if (tokenActual && registradoPara === `${usuarioId}:${tokenActual}`) return;
  if (reintento) return; // ya hay un reintento programado
  await pedirRegistroNativo();
}

/** La sesión terminó (SIGNED_OUT o usuario nulo): no se registra nada hasta la próxima. */
export function sesionTerminadaPush(): void {
  sesion = null;
  registradoPara = null;
  cancelarReintento();
}
