// Edge Function: enviar-estado-cuenta (fase 20w)
// Envía el estado de cuenta de un cliente por correo (Resend) con el botón "Ver estado de cuenta" hacia su enlace público
// y el PDF adjunto. También arma la vista previa del correo (modo "vista_previa", sin enviar nada).
//
//   · Sesión: verify_jwt=false (el gateway no valida JWT con las llaves nuevas sb_publishable_), así que el JWT se valida
//     aquí (auth.getUser) y los datos se piden CON el JWT del usuario: datos_correo_estado_cuenta exige personal de
//     administración con 'cuentas' editar, la empresa elegida y la del cliente; crea o reutiliza el enlace público.
//   · PDF: lo genera el navegador con el mismo componente que el admin, el portal y la página pública (un solo diseño; la
//     función edge no carga librerías de PDF ni letras). Aquí se valida: base64 válido, entre 1 KB y 5 MB, empieza con
//     %PDF- y termina con %%EOF. El nombre del archivo lo pone el servidor. El cuerpo del correo y el enlace se arman
//     aquí con datos de la base, no con lo que mande el navegador.
//   · Registro: registrar_envio_estado_cuenta / cerrar_envio_estado_cuenta con la llave de servicio (el usuario no
//     puede escribir el historial). Límite: 5 envíos por minuto por usuario y 20 por hora por cliente.
//   · Envío masivo (21b): el navegador recorre los clientes del lote (crear_lote_estado_cuenta) y llama a esta función una
//     vez por cliente con lote_id; el registro valida que el cliente sea del lote y aplica el límite de lotes (40/min).
//   · Entrega y rebotes (21b): Resend llama a esta misma URL con su webhook (cabeceras svix-id / svix-timestamp /
//     svix-signature, sin sesión). Se verifica la firma con RESEND_WEBHOOK_SECRET (whsec_…) y se anota la entrega del
//     envío (entregado, rebotado, queja, retrasado). Sin ese secreto, los webhooks se rechazan (503).
//   · Secretos: RESEND_API_KEY. Opcionales: PORTAL_URL (https://portal.guds-supply.com), ESTADO_CUENTA_REMITENTE
//     (no-responder@portal.guds-supply.com), RESEND_WEBHOOK_SECRET y ESTADO_CUENTA_DESTINOS_PERMITIDOS (expresión regular:
//     si existe, solo se envía a correos que la cumplan; para pruebas, p. ej. @resend\.dev$).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { armarCorreo, asuntoPorDefecto, type DatosCorreo } from "./correo.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-empresa-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const MAX_PDF = 5 * 1024 * 1024;
const MAX_DESTINOS = 10;
const CORREO = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const PORTAL = (Deno.env.get("PORTAL_URL") ?? "https://portal.guds-supply.com").replace(/\/+$/, "");
const REMITENTE = Deno.env.get("ESTADO_CUENTA_REMITENTE") ?? "no-responder@portal.guds-supply.com";

const llave = (nombre: string) => {
  try { return (JSON.parse(Deno.env.get(nombre) ?? "{}") as Record<string, string>)["default"]; } catch { return undefined; }
};

const nombreArchivo = (cliente: string, fecha: string) => {
  const limpio = cliente.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/g, "") || "cliente";
  return `estado-de-cuenta-${limpio}-${fecha.slice(0, 10)}.pdf`;
};

const aBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const aB64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));

/** Firma de un webhook de Resend (Svix): HMAC-SHA256 de "id.timestamp.cuerpo" con el secreto whsec_ (base64). */
async function firmaValida(secreto: string, id: string, ts: string, cuerpo: string, firmas: string) {
  const t = Number(ts);
  if (!id || !Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > 5 * 60) return false;
  const clave = await crypto.subtle.importKey("raw", aBytes(secreto.replace(/^whsec_/, "")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const esperada = aB64(await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(`${id}.${ts}.${cuerpo}`)));
  return firmas.split(" ").some((f) => {
    const [v, sig] = f.split(",");
    if (v !== "v1" || !sig || sig.length !== esperada.length) return false;
    let dif = 0;
    for (let i = 0; i < sig.length; i++) dif |= sig.charCodeAt(i) ^ esperada.charCodeAt(i);
    return dif === 0;
  });
}

/** Valida el PDF del navegador: devuelve el base64 limpio y su tamaño, o un error. */
function validarPdf(b64: unknown): { ok: true; base64: string; bytes: number } | { ok: false; error: string } {
  if (typeof b64 !== "string" || !b64) return { ok: false, error: "Falta el PDF del estado de cuenta" };
  const limpio = b64.replace(/^data:application\/pdf;base64,/, "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(limpio) || limpio.length > Math.ceil(MAX_PDF / 3) * 4 + 4) {
    return { ok: false, error: "El PDF no es válido o supera los 5 MB" };
  }
  let bin: string;
  try { bin = atob(limpio); } catch { return { ok: false, error: "El PDF no es válido" }; }
  if (bin.length < 1024 || bin.length > MAX_PDF) return { ok: false, error: "El PDF no es válido o supera los 5 MB" };
  if (!bin.startsWith("%PDF-") || !bin.slice(-1024).includes("%%EOF")) return { ok: false, error: "El archivo adjunto no es un PDF" };
  return { ok: true, base64: limpio, bytes: bin.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return responder(405, { error: "Método no permitido" });

  // ── Webhook de Resend (entrega y rebotes) ──
  if (req.headers.get("svix-id") && !req.headers.get("Authorization")) {
    const secreto = Deno.env.get("RESEND_WEBHOOK_SECRET");
    if (!secreto) return responder(503, { error: "Webhook no configurado" });
    const cuerpo = await req.text();
    const ok = await firmaValida(secreto, req.headers.get("svix-id") ?? "", req.headers.get("svix-timestamp") ?? "", cuerpo,
      req.headers.get("svix-signature") ?? "").catch(() => false);
    if (!ok) return responder(401, { error: "Firma inválida" });
    // deno-lint-ignore no-explicit-any
    let ev: any;
    try { ev = JSON.parse(cuerpo); } catch { return responder(400, { error: "Evento inválido" }); }
    const secretaW = llave("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const srv = createClient(Deno.env.get("SUPABASE_URL")!, secretaW, { auth: { persistSession: false, autoRefreshToken: false } });
    const detalle = ev?.data?.bounce?.message ?? ev?.data?.bounce?.subType ?? ev?.data?.reason ?? null;
    const { data: n, error: e } = await srv.rpc("registrar_entrega_envio_estado_cuenta", {
      p_resend_id: String(ev?.data?.email_id ?? ""), p_evento: String(ev?.type ?? ""), p_detalle: detalle ? String(detalle) : null,
    });
    if (e) return responder(500, { error: "No se pudo registrar el evento" });
    return responder(200, { ok: true, actualizados: n ?? 0 });
  }

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return responder(401, { error: "Inicia sesión para enviar el estado de cuenta" });
  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return responder(400, { error: "Solicitud inválida" }); }
  const modo = body?.modo === "vista_previa" ? "vista_previa" : "enviar";
  const clienteId = String(body?.cliente_id ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clienteId)) return responder(400, { error: "Falta el cliente" });

  const url = Deno.env.get("SUPABASE_URL")!;
  const publica = llave("SUPABASE_PUBLISHABLE_KEYS") ?? req.headers.get("apikey") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const secreta = llave("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const sinSesion = { persistSession: false, autoRefreshToken: false };
  const servicio = createClient(url, secreta, { auth: sinSesion });
  const comoUsuario = createClient(url, publica, {
    auth: sinSesion,
    global: { headers: { Authorization: `Bearer ${jwt}`, "x-empresa-id": req.headers.get("x-empresa-id") ?? "todas" } },
  });

  const { data: usuario, error: errUsuario } = await servicio.auth.getUser(jwt);
  if (errUsuario || !usuario?.user) return responder(401, { error: "Tu sesión venció: vuelve a iniciar sesión" });

  // Permiso, datos del correo y (al enviar) el enlace público, con el JWT del usuario
  // 22j: con el check del estado de cuenta, las notas de entrega van en el correo y el enlace queda marcado para mostrarlas
  const { data: d, error: errDatos } = await comoUsuario.rpc("datos_correo_estado_cuenta", {
    p_cliente_id: clienteId, p_asegurar_enlace: modo === "enviar", p_ne: body?.ne === true,
  });
  if (errDatos || !d) {
    return responder(errDatos?.code === "42501" ? 403 : 400, { error: errDatos?.message ?? "No se pudo preparar el correo" });
  }

  const remitente: string | null = d.remitente?.nombre ?? null;
  const replyTo = [d.empresa?.email, d.remitente?.email].find((c: unknown) => typeof c === "string" && CORREO.test(c)) as string | undefined;
  const token: string | null = d.enlace?.token ?? null;
  const enlace = token ? `${PORTAL}/estado-cuenta/${token}` : `${PORTAL}/estado-cuenta/…`;
  const mensaje = typeof body?.mensaje === "string" ? body.mensaje.trim().slice(0, 2000) : "";
  const asunto = (typeof body?.asunto === "string" && body.asunto.trim() ? body.asunto.trim() : asuntoPorDefecto(d)).slice(0, 200);
  const datos: DatosCorreo = {
    hoy: d.hoy, cliente: d.cliente, empresa: d.empresa, resumen: d.resumen, documentos: d.documentos ?? [], url: enlace, mensaje,
    remitente, responder: !!replyTo,
  };
  const loteId = typeof body?.lote_id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.lote_id)
    ? body.lote_id : null;

  if (modo === "vista_previa") {
    const { html, texto } = armarCorreo(datos);
    const sugeridos = [d.cliente?.email, ...(d.contactos ?? []).map((k: { email: string }) => k.email)]
      .filter((c: unknown): c is string => typeof c === "string" && CORREO.test(c.trim()))
      .map((c: string) => c.trim().toLowerCase())
      .filter((c: string, i: number, a: string[]) => a.indexOf(c) === i);
    return responder(200, { asunto, html, texto, destinatarios: sugeridos, enlace_activo: !!token });
  }

  // ── Enviar ──
  if (!token) return responder(400, { error: "No se pudo obtener el enlace público" });
  const lista: unknown[] = Array.isArray(body?.destinatarios) ? body.destinatarios : [];
  const destinatarios = lista.map((c) => String(c ?? "").trim().toLowerCase()).filter(Boolean)
    .filter((c, i, a) => a.indexOf(c) === i);
  if (destinatarios.length === 0) return responder(400, { error: "Indica al menos un destinatario" });
  if (destinatarios.length > MAX_DESTINOS) return responder(400, { error: `Máximo ${MAX_DESTINOS} destinatarios por envío` });
  const malos = destinatarios.filter((c) => c.length > 254 || !CORREO.test(c));
  if (malos.length) return responder(400, { error: `Correo inválido: ${malos.slice(0, 3).join(", ")}` });
  const permitidos = Deno.env.get("ESTADO_CUENTA_DESTINOS_PERMITIDOS");
  if (permitidos) {
    const re = new RegExp(permitidos, "i");
    const fuera = destinatarios.filter((c) => !re.test(c));
    if (fuera.length) return responder(400, { error: `En este entorno solo se envía a direcciones de prueba (${fuera.slice(0, 3).join(", ")} no está permitida)` });
  }
  const pdf = validarPdf(body?.pdf_base64);
  if (!pdf.ok) return responder(400, { error: pdf.error });
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return responder(500, { error: "El envío de correos no está configurado" });

  const archivo = nombreArchivo(String(d.cliente?.nombre ?? "cliente"), String(d.hoy));
  const { data: envioId, error: errReg } = await servicio.rpc("registrar_envio_estado_cuenta", {
    p_usuario_id: d.remitente?.id ?? null,
    p_cliente_id: clienteId,
    p_empresa_id: d.empresa?.id,
    p_enlace_id: d.enlace?.id ?? null,
    p_destinatarios: destinatarios,
    p_asunto: asunto,
    p_mensaje: mensaje || null,
    p_adjunto_nombre: archivo,
    p_adjunto_bytes: pdf.bytes,
    p_lote_id: loteId,
  });
  if (errReg || !envioId) {
    const limite = /Demasiados envíos|muchos envíos|ya se envió/i.test(errReg?.message ?? "");
    return responder(limite ? 429 : 400, { error: errReg?.message ?? "No se pudo registrar el envío" });
  }

  const { html, texto } = armarCorreo(datos);
  const marca = String(d.empresa?.nombre_corto || d.empresa?.nombre || "GUDS").replace(/["<>\r\n]/g, "").trim();
  let resendId: string | null = null;
  let error: string | null = null;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": String(envioId) },
      body: JSON.stringify({
        from: `${marca} <${REMITENTE}>`,
        to: destinatarios,
        subject: asunto,
        html,
        text: texto,
        ...(replyTo ? { reply_to: replyTo } : {}),
        attachments: [{ filename: archivo, content: pdf.base64, content_type: "application/pdf" }],
        tags: [{ name: "tipo", value: "estado_cuenta" }],
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j?.id) resendId = String(j.id);
    else error = `Resend ${r.status}: ${j?.message ?? j?.name ?? "error"}`;
  } catch (e) {
    error = `Resend: ${(e as Error).message}`;
  }
  await servicio.rpc("cerrar_envio_estado_cuenta", { p_envio_id: envioId, p_resend_id: resendId, p_error: error });
  if (error) return responder(502, { error: "El proveedor de correo no aceptó el envío. Inténtalo de nuevo en unos minutos.", detalle: error, envio_id: envioId });
  return responder(200, { ok: true, envio_id: envioId, resend_id: resendId, destinatarios, adjunto: { nombre: archivo, bytes: pdf.bytes } });
});
