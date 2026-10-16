// Edge Function: enviar-push (fase 23)
// Envía a los teléfonos (app nativa Guds Store) las notificaciones recién creadas en public.notificaciones.
//
//   · La dispara el disparador trg_notificaciones_push (pg_net) con {"ids": [...]} y el header x-push-secret; sin ese
//     secreto (PUSH_WEBHOOK_SECRET) responde 401. verify_jwt=false (config.toml): la autenticación es el secreto.
//   · push_lote (service_role) arma cada aviso: título, mensaje, enlace, tipo, data, no leídas (badge) y los tokens iOS y
//     Android del destinatario por separado.
//   · iOS (APNs, HTTP/2): JWT ES256 firmado con WebCrypto (la firma ya sale en r||s, sin DER). Un solo JWT compartido por
//     todos los workers vía push_jwt_reclamar (Apple rechaza renovarlo más de una vez cada 20 min).
//       - TooManyProviderTokenUpdates: no se vuelve a firmar; solo se olvida el de memoria (el siguiente sale de la base).
//       - ExpiredProviderToken / InvalidProviderToken: se borra la fila solo si sigue siendo ese JWT.
//   · Android (FCM HTTP v1): cuenta de servicio de Firebase (FCM_SERVICE_ACCOUNT_JSON) → JWT RS256 firmado con WebCrypto
//     → token OAuth de Google, guardado en memoria ~50 min por worker. Canal "avisos" (el mismo que crea la app y el del
//     manifest), ícono ic_stat_guds y color de marca; la ruta del toque va en data.link (FCM solo admite texto en data).
//     Sin el secreto (o si es inválido) se omiten los tokens Android con un aviso en el log e iOS sigue igual.
//   · Tiempos: 8 s por envío, 8 envíos a la vez y ningún envío nuevo pasados 20 s desde que llegó la solicitud (el resto
//     se registra como SinTiempo).
//   · Tokens muertos (se borran de device_tokens): APNs 410 o BadDeviceToken, Unregistered, DeviceTokenNotForTopic,
//     TopicDisallowed; FCM UNREGISTERED, o un 400 INVALID_ARGUMENT que nombra el token. Nunca por un 404 sin UNREGISTERED
//     (un project_id equivocado da 404 para todos) ni por SENDER_ID_MISMATCH (cuenta de servicio y google-services.json
//     de proyectos distintos: un error de configuración que, si se podara, borraría todos los teléfonos Android).
//     Lo demás es transitorio.
//   · Responde {notificaciones, envios, enviados, fallidos, podados, omitidos_android, motivos}.
//
// Secretos: PUSH_WEBHOOK_SECRET, APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID, APNS_PRIVATE_KEY (.p8), APNS_ENVIRONMENT
// (production | development). Android: FCM_SERVICE_ACCOUNT_JSON (el JSON completo de la cuenta de servicio de Firebase;
// opcional, sin él no se envía a Android). La plataforma inyecta SUPABASE_URL y SUPABASE_SECRET_KEYS.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

type Fila = {
  id: string;
  titulo: string | null;
  mensaje: string | null;
  link: string | null;
  tipo: string | null;
  data: Record<string, unknown> | null;
  no_leidas: number | null;
  tokens_ios: string[] | null;
  tokens_android: string[] | null;
};

type Envio = { plataforma: "ios" | "android"; token: string; fila: Fila };
type Resultado = { ok: true } | { ok: false; motivo: string; podar: boolean };

const TIEMPO_ENVIO_MS = 8_000;
const PRESUPUESTO_MS = 20_000;
const CONCURRENCIA = 8;
const MAX_IDS = 500;
const VIDA_JWT_MS = 50 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PODAR_APNS = new Set(["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic", "TopicDisallowed"]);
const CLAVES_RESERVADAS = new Set(["aps", "notificacion_id", "tipo", "link"]);

const responder = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const llave = (nombre: string) => {
  try { return (JSON.parse(Deno.env.get(nombre) ?? "{}") as Record<string, string>)["default"]; } catch { return undefined; }
};

// ── Bytes ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// Deno rechaza Uint8Array<ArrayBufferLike> en importKey/sign: los ayudantes devuelven ArrayBuffer.
function textoABuffer(s: string): ArrayBuffer {
  const u = new TextEncoder().encode(s);
  const b = new ArrayBuffer(u.byteLength);
  new Uint8Array(b).set(u);
  return b;
}

function pemABuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const b = new ArrayBuffer(bin.length);
  const v = new Uint8Array(b);
  for (let i = 0; i < bin.length; i++) v[i] = bin.charCodeAt(i);
  return b;
}

function base64url(datos: ArrayBuffer | string): string {
  const v = new Uint8Array(typeof datos === "string" ? textoABuffer(datos) : datos);
  let s = "";
  for (let i = 0; i < v.length; i++) s += String.fromCharCode(v[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function igualSeguro(a: string, b: string): boolean {
  const x = new Uint8Array(textoABuffer(a));
  const y = new Uint8Array(textoABuffer(b));
  let dif = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) dif |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return dif === 0;
}

const recortar = (s: string | null | undefined, max: number) => {
  const t = (s ?? "").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

// Claves de data (jsonb) que viajan al teléfono además de notificacion_id, tipo y link
function datosEntidad(fila: Fila): Record<string, unknown> {
  const d = fila.data;
  if (!d || typeof d !== "object" || Array.isArray(d)) return {};
  const fuera: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) if (!CLAVES_RESERVADAS.has(k) && v !== null && v !== undefined) fuera[k] = v;
  return fuera;
}

// ── APNs ────────────────────────────────────────────────────────────────────────────────────────────────────────────
type ConfigApns = { keyId: string; teamId: string; topic: string; privada: string; host: string };

let avisoSinApns = false;
function configApns(): ConfigApns | null {
  const keyId = Deno.env.get("APNS_KEY_ID");
  const teamId = Deno.env.get("APNS_TEAM_ID");
  const topic = Deno.env.get("APNS_BUNDLE_ID");
  const privada = Deno.env.get("APNS_PRIVATE_KEY");
  if (!keyId || !teamId || !topic || !privada) {
    if (!avisoSinApns) {
      console.warn("enviar-push: faltan secretos APNS_* — se omite iOS");
      avisoSinApns = true;
    }
    return null;
  }
  const entorno = (Deno.env.get("APNS_ENVIRONMENT") ?? "production").toLowerCase();
  const host = entorno === "production" ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com";
  return { keyId, teamId, topic, privada, host };
}

let llaveApns: { keyId: string; key: CryptoKey } | null = null;
async function llavePrivadaApns(cfg: ConfigApns): Promise<CryptoKey> {
  if (llaveApns?.keyId === cfg.keyId) return llaveApns.key;
  const key = await crypto.subtle.importKey(
    "pkcs8", pemABuffer(cfg.privada), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"],
  );
  llaveApns = { keyId: cfg.keyId, key };
  return key;
}

async function firmarJwtApns(cfg: ConfigApns): Promise<string> {
  const cabecera = base64url(JSON.stringify({ alg: "ES256", kid: cfg.keyId }));
  const reclamos = base64url(JSON.stringify({ iss: cfg.teamId, iat: Math.floor(Date.now() / 1000) }));
  const entrada = `${cabecera}.${reclamos}`;
  // WebCrypto devuelve la firma ECDSA en formato IEEE P1363 (r||s de 64 bytes), que es lo que pide JWS.
  const firma = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await llavePrivadaApns(cfg), textoABuffer(entrada));
  return `${entrada}.${base64url(firma)}`;
}

let jwtMemoria: { jwt: string; vence: number } | null = null;
let jwtEnCurso: Promise<string> | null = null;

async function jwtApns(srv: SupabaseClient, cfg: ConfigApns): Promise<string> {
  if (jwtMemoria && Date.now() < jwtMemoria.vence) return jwtMemoria.jwt;
  if (jwtEnCurso) return jwtEnCurso;
  jwtEnCurso = (async () => {
    const firmado = await firmarJwtApns(cfg);
    const { data, error } = await srv.rpc("push_jwt_reclamar", { p_key_id: cfg.keyId, p_jwt: firmado });
    const fila = Array.isArray(data) ? data[0] as { jwt?: string; creado_at?: string } | undefined : undefined;
    if (error || !fila?.jwt) {
      console.warn("enviar-push: push_jwt_reclamar falló; se usa el JWT recién firmado", error?.message ?? "");
      jwtMemoria = { jwt: firmado, vence: Date.now() + VIDA_JWT_MS };
      return firmado;
    }
    const creado = Date.parse(fila.creado_at ?? "") || Date.now();
    jwtMemoria = { jwt: fila.jwt, vence: Math.max(creado + VIDA_JWT_MS, Date.now() + 60_000) };
    return fila.jwt;
  })();
  try { return await jwtEnCurso; } finally { jwtEnCurso = null; }
}

function payloadApns(fila: Fila): string {
  const base = {
    aps: {
      alert: { title: recortar(fila.titulo, 120) || "Guds Store", body: recortar(fila.mensaje, 600) },
      badge: Math.max(0, fila.no_leidas ?? 0),
      sound: "default",
    },
    notificacion_id: fila.id,
    tipo: fila.tipo ?? null,
    link: fila.link ?? null,
  };
  const completo = JSON.stringify({ ...datosEntidad(fila), ...base });
  // APNs admite 4 KB: si la data de la entidad no cabe, se manda sin ella.
  return new TextEncoder().encode(completo).byteLength <= 3_800 ? completo : JSON.stringify(base);
}

async function enviarApns(srv: SupabaseClient, cfg: ConfigApns, e: Envio): Promise<Resultado> {
  let jwt: string;
  try {
    jwt = await jwtApns(srv, cfg);
  } catch (err) {
    return { ok: false, motivo: `JwtApns: ${(err as Error).message}`, podar: false };
  }
  const r = await fetch(`${cfg.host}/3/device/${encodeURIComponent(e.token)}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${jwt}`,
      "apns-topic": cfg.topic,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-collapse-id": e.fila.id,
      "content-type": "application/json",
    },
    body: payloadApns(e.fila),
    signal: AbortSignal.timeout(TIEMPO_ENVIO_MS),
  });
  if (r.status === 200) {
    await r.body?.cancel();
    return { ok: true };
  }
  let motivo = `HTTP ${r.status}`;
  try { motivo = ((await r.json()) as { reason?: string }).reason ?? motivo; } catch { /* sin cuerpo */ }
  if (motivo === "TooManyProviderTokenUpdates") {
    jwtMemoria = null;
  } else if (motivo === "ExpiredProviderToken" || motivo === "InvalidProviderToken") {
    jwtMemoria = null;
    const { error } = await srv.rpc("push_jwt_olvidar", { p_jwt: jwt });
    if (error) console.warn("enviar-push: push_jwt_olvidar falló", error.message);
  }
  return { ok: false, motivo, podar: r.status === 410 || PODAR_APNS.has(motivo) };
}

// ── FCM (Android) ───────────────────────────────────────────────────────────────────────────────────────────────────
// Deben coincidir con src/lib/pushNativo.ts (CANAL_ANDROID) y con AndroidManifest.xml (meta-data de Firebase).
const CANAL_ANDROID = "avisos";
const ICONO_ANDROID = "ic_stat_guds";
const COLOR_ANDROID = "#8B1A1A";
// FCM rechaza el mensaje entero si data usa estas claves (y las que empiezan por "google." o "gcm.").
const CLAVES_RESERVADAS_FCM = new Set(["from", "notification", "message_type", "collapse_key"]);

type CuentaFcm = { client_email: string; private_key: string; project_id: string; token_uri?: string };

let cuentaFcmCache: CuentaFcm | null | undefined;
/** La cuenta de servicio de Firebase, o null si Android no está configurado. Nunca se registra su contenido. */
function cuentaFcm(): CuentaFcm | null {
  if (cuentaFcmCache !== undefined) return cuentaFcmCache;
  const crudo = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON");
  let cuenta: CuentaFcm | null = null;
  let problema = "";
  if (!crudo) {
    problema = "falta el secreto FCM_SERVICE_ACCOUNT_JSON";
  } else {
    try {
      const c = JSON.parse(crudo) as Partial<Record<keyof CuentaFcm, unknown>>;
      const texto = (v: unknown) => typeof v === "string" && v.trim() !== "";
      const faltan = (["project_id", "client_email", "private_key"] as const).filter((k) => !texto(c[k]));
      if (faltan.length) problema = `a FCM_SERVICE_ACCOUNT_JSON le falta ${faltan.join(", ")}`;
      else if (!String(c.private_key).includes("PRIVATE KEY")) problema = "private_key de FCM_SERVICE_ACCOUNT_JSON no es una llave PEM";
      else cuenta = c as CuentaFcm;
    } catch {
      problema = "FCM_SERVICE_ACCOUNT_JSON no es un JSON válido";
    }
  }
  if (!cuenta) console.warn(`enviar-push: ${problema} — se omiten los dispositivos Android`);
  cuentaFcmCache = cuenta;
  return cuenta;
}

let accesoFcm: { token: string; vence: number } | null = null;
let accesoFcmEnCurso: Promise<string> | null = null;

async function tokenAccesoFcm(c: CuentaFcm): Promise<string> {
  if (accesoFcm && Date.now() < accesoFcm.vence) return accesoFcm.token;
  if (accesoFcmEnCurso) return accesoFcmEnCurso;
  accesoFcmEnCurso = (async () => {
    const aud = c.token_uri ?? "https://oauth2.googleapis.com/token";
    const ahora = Math.floor(Date.now() / 1000);
    const cabecera = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const reclamos = base64url(JSON.stringify({
      iss: c.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud, iat: ahora, exp: ahora + 3600,
    }));
    const llave = await crypto.subtle.importKey(
      "pkcs8", pemABuffer(c.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
    );
    const firma = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", llave, textoABuffer(`${cabecera}.${reclamos}`));
    const r = await fetch(aud, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${cabecera}.${reclamos}.${base64url(firma)}`,
      }),
      signal: AbortSignal.timeout(TIEMPO_ENVIO_MS),
    });
    // Solo el código de error de Google (p. ej. invalid_grant), nunca el cuerpo completo ni la llave
    const j = await r.json().catch(() => ({})) as { access_token?: string; error?: unknown };
    if (!r.ok || !j.access_token) {
      throw new Error(`OAuth FCM HTTP ${r.status}${typeof j.error === "string" ? ` ${j.error}` : ""}`);
    }
    accesoFcm = { token: j.access_token, vence: Date.now() + VIDA_JWT_MS };
    return j.access_token;
  })();
  try { return await accesoFcmEnCurso; } finally { accesoFcmEnCurso = null; }
}

// FCM exige que todos los valores de data sean texto: los demás se mandan como JSON.
function datosFcm(fila: Fila): Record<string, string> {
  const base: Record<string, string> = { notificacion_id: fila.id };
  if (fila.tipo) base.tipo = fila.tipo;
  if (fila.link) base.link = fila.link;
  const d: Record<string, string> = {};
  for (const [k, v] of Object.entries(datosEntidad(fila))) {
    if (CLAVES_RESERVADAS_FCM.has(k) || k.startsWith("google.") || k.startsWith("gcm.")) continue;
    d[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  const completo = { ...d, ...base };
  // FCM admite 4 KB por mensaje: si la data de la entidad no cabe, se manda sin ella (igual que en APNs).
  return new TextEncoder().encode(JSON.stringify(completo)).byteLength <= 3_000 ? completo : base;
}

type ErrorFcm = {
  error?: {
    code?: number;
    status?: string;
    message?: string;
    details?: { "@type"?: string; errorCode?: string; fieldViolations?: { field?: string }[] }[];
  };
};

/**
 * Si la falla de FCM significa que el token ya no sirve. UNREGISTERED es inequívoco. INVALID_ARGUMENT también sale por
 * un mensaje mal armado, así que solo cuenta con HTTP 400 y cuando Google señala el token. Un 404 sin UNREGISTERED o
 * SENDER_ID_MISMATCH son errores de configuración (proyecto equivocado): podar ahí borraría todos los teléfonos Android.
 */
function tokenFcmMuerto(status: number, j: ErrorFcm): boolean {
  const detalles = j.error?.details ?? [];
  const codigos = detalles.map((x) => x.errorCode).filter(Boolean);
  if (codigos.includes("UNREGISTERED")) return true;
  const invalido = codigos.includes("INVALID_ARGUMENT") || j.error?.status === "INVALID_ARGUMENT";
  if (status !== 400 || !invalido) return false;
  return detalles.some((x) => (x.fieldViolations ?? []).some((f) => f.field === "message.token")) ||
    /message\.token|registration token/i.test(j.error?.message ?? "");
}

async function enviarFcm(c: CuentaFcm, e: Envio): Promise<Resultado> {
  let acceso: string;
  try {
    acceso = await tokenAccesoFcm(c);
  } catch (err) {
    return { ok: false, motivo: `OAuthFcm: ${(err as Error).message}`, podar: false };
  }
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${c.project_id}/messages:send`, {
    method: "POST",
    headers: { authorization: `Bearer ${acceso}`, "content-type": "application/json" },
    body: JSON.stringify({
      message: {
        token: e.token,
        notification: { title: recortar(e.fila.titulo, 120) || "Guds Store", body: recortar(e.fila.mensaje, 600) },
        data: datosFcm(e.fila),
        android: {
          priority: "HIGH",
          ttl: "86400s",
          notification: {
            channel_id: CANAL_ANDROID,
            icon: ICONO_ANDROID,
            color: COLOR_ANDROID,
            // Solo cuenta antes de Android 8; desde ahí manda el canal (creado sin sonido propio = sonido del sistema)
            sound: "default",
            tag: e.fila.id,
            notification_count: Math.max(0, e.fila.no_leidas ?? 0),
          },
        },
      },
    }),
    signal: AbortSignal.timeout(TIEMPO_ENVIO_MS),
  });
  if (r.ok) {
    await r.body?.cancel();
    return { ok: true };
  }
  if (r.status === 401) accesoFcm = null;
  const j = await r.json().catch(() => ({})) as ErrorFcm;
  const codigo = j.error?.details?.find((x) => x.errorCode)?.errorCode ?? j.error?.status ?? `HTTP ${r.status}`;
  return { ok: false, motivo: codigo, podar: tokenFcmMuerto(r.status, j) };
}

// ── Handler ─────────────────────────────────────────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const inicio = Date.now();
  if (req.method !== "POST") return responder(405, { error: "Método no permitido" });

  const esperado = Deno.env.get("PUSH_WEBHOOK_SECRET") ?? "";
  const recibido = req.headers.get("x-push-secret") ?? "";
  if (!esperado || !igualSeguro(recibido, esperado)) return responder(401, { error: "No autorizado" });

  let ids: string[];
  try {
    const cuerpo = await req.json() as { ids?: unknown };
    ids = Array.isArray(cuerpo?.ids) ? cuerpo.ids.filter((x): x is string => typeof x === "string" && UUID.test(x)) : [];
  } catch {
    return responder(400, { error: "Cuerpo inválido" });
  }
  ids = [...new Set(ids)].slice(0, MAX_IDS);
  const vacio = { notificaciones: 0, envios: 0, enviados: 0, fallidos: 0, podados: 0, omitidos_android: 0, motivos: {} };
  if (!ids.length) return responder(200, vacio);

  const secreta = llave("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const srv = createClient(Deno.env.get("SUPABASE_URL")!, secreta, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data, error } = await srv.rpc("push_lote", { ids });
  if (error) {
    console.error("enviar-push: push_lote falló", error.message);
    return responder(500, { error: "No se pudo leer el lote" });
  }
  const filas = (data ?? []) as Fila[];

  const apns = filas.some((f) => f.tokens_ios?.length) ? configApns() : null;
  const fcm = filas.some((f) => f.tokens_android?.length) ? cuentaFcm() : null;

  const cola: Envio[] = [];
  let omitidosAndroid = 0;
  for (const fila of filas) {
    if (apns) for (const token of fila.tokens_ios ?? []) cola.push({ plataforma: "ios", token, fila });
    if (fcm) for (const token of fila.tokens_android ?? []) cola.push({ plataforma: "android", token, fila });
    else omitidosAndroid += fila.tokens_android?.length ?? 0;
  }
  if (omitidosAndroid > 0) console.warn(`enviar-push: ${omitidosAndroid} envíos a Android omitidos (FCM sin configurar)`);

  let enviados = 0;
  let fallidos = 0;
  const motivos: Record<string, number> = {};
  const podar = new Set<string>();
  const anotar = (motivo: string) => { motivos[motivo] = (motivos[motivo] ?? 0) + 1; };

  let siguiente = 0;
  const trabajador = async () => {
    while (siguiente < cola.length) {
      if (Date.now() - inicio > PRESUPUESTO_MS) return;
      const e = cola[siguiente++];
      let res: Resultado;
      try {
        res = e.plataforma === "ios" ? await enviarApns(srv, apns!, e) : await enviarFcm(fcm!, e);
      } catch (err) {
        const nombre = (err as Error)?.name;
        res = { ok: false, motivo: nombre === "TimeoutError" || nombre === "AbortError" ? "Timeout" : `Red: ${(err as Error)?.message ?? err}`, podar: false };
      }
      if (res.ok) {
        enviados++;
      } else {
        fallidos++;
        anotar(res.motivo);
        if (res.podar) podar.add(e.token);
        console.warn(`enviar-push: ${e.plataforma} ${e.fila.id} → ${res.motivo}${res.podar ? " (token podado)" : ""}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCIA, cola.length) }, trabajador));

  const sinTiempo = cola.length - siguiente;
  if (sinTiempo > 0) {
    fallidos += sinTiempo;
    motivos.SinTiempo = (motivos.SinTiempo ?? 0) + sinTiempo;
    console.warn(`enviar-push: SinTiempo — ${sinTiempo} envíos no salieron (presupuesto de ${PRESUPUESTO_MS / 1000} s)`);
  }

  let podados = 0;
  if (podar.size) {
    const { data: borrados, error: errPoda } = await srv.from("device_tokens").delete().in("token", [...podar]).select("id");
    if (errPoda) console.error("enviar-push: no se pudieron podar tokens", errPoda.message);
    else podados = borrados?.length ?? 0;
  }

  return responder(200, {
    notificaciones: filas.length, envios: cola.length, enviados, fallidos, podados, omitidos_android: omitidosAndroid, motivos,
  });
});
