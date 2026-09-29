// Sincronización periódica Odoo → GUDS (Fase 9a de docs/PLAN-ESPEJO-ODOO.md).
//
// - Lee Odoo en SOLO LECTURA (el cliente de odoo.js bloquea cualquier método que no sea de lectura) y escribe en la base
//   con el mismo motor idempotente del importador (supabase/functions/_shared/odoo-sync/).
// - La dispara pg_cron (job "sync-odoo") con el secreto SYNC_ODOO_SECRET en el header x-sync-secret.
// - Responde 202 de inmediato y trabaja en segundo plano (EdgeRuntime.waitUntil): el plan gratuito corta a los 150 s.
// - No se solapa: si hay una corrida "en_curso" de menos de 10 minutos, no arranca otra.
// - ?simular=1 lee todo y calcula sin escribir (para probar credenciales y tiempos).
// - ?enviar=<orden_id> crea en Odoo (cotización en borrador) un pedido APROBADO en GUDS (Fase 9b). Lo dispara
//   aprobar_pedido() por pg_net. Cada sincronización reintenta los aprobados que no llegaron a enviarse.
// - ?escritura=<id> procesa una fila de odoo_escrituras (estado de entregas, contacto y direcciones de clientes, foto y
//   descripción de productos; 19u/20r). La disparan las funciones que encolan por pg_net; cada sincronización reintenta las
//   pendientes o con error.
// - Fotos de producto (20r): la sincronización sube al bucket `imagenes` las que cambian en Odoo y el escritor lee de allí las
//   que se envían a Odoo (almacenamiento con la secret key del proyecto, que la plataforma inyecta).
//
// Secretos: ODOO_URL, ODOO_DB, ODOO_USER, ODOO_API_KEY, SYNC_ODOO_SECRET (+ SUPABASE_DB_URL, SUPABASE_URL y
// SUPABASE_SECRET_KEYS, que ya trae la plataforma).
import postgres from "npm:postgres@3.4.5";
import { crearClienteOdoo } from "../_shared/odoo-sync/odoo.js";
import { importarOdoo } from "../_shared/odoo-sync/importar.js";
import { enviarPedido } from "../_shared/odoo-sync/enviar.js";
import { procesarEscritura } from "../_shared/odoo-sync/escrituras.js";
import { crearStorage } from "../_shared/odoo-sync/storage.js";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const env = (k: string) => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`Falta el secreto ${k}`);
  return v;
};

// Igual que la API de gestión con la que corre el importador desde scripts/: filas de la ÚLTIMA sentencia,
// enteros como número y fechas/timestamps como texto.
function crearSql() {
  const db = postgres(env("SUPABASE_DB_URL"), {
    max: 1,
    prepare: false,
    idle_timeout: 5,
    types: {
      fecha: { to: 1082, from: [1082, 1114, 1184], serialize: (x: unknown) => String(x), parse: (x: string) => x },
      int8: { to: 20, from: [20], serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) },
    },
  });
  const sql = async (q: string) => {
    let r;
    try {
      r = await db.unsafe(q).simple();
    } catch (e) {
      // Un error dentro de "begin; …; commit;" deja la transacción abortada en la conexión: se deshace para seguir usándola
      await db.unsafe("rollback").simple().catch(() => {});
      throw e;
    }
    // Varias sentencias → un resultado por sentencia; se devuelve el de la última (como la API de gestión)
    const multi = Array.isArray(r) && r.length > 0 && Array.isArray(r[0]);
    const ultimo = multi ? r[r.length - 1] : r;
    return [...(ultimo as unknown as Record<string, unknown>[])];
  };
  return { sql, cerrar: () => db.end({ timeout: 5 }) };
}

const nuevoOdoo = () => crearClienteOdoo({ url: env("ODOO_URL"), db: env("ODOO_DB"), usuario: env("ODOO_USER"), apiKey: env("ODOO_API_KEY"), timeoutMs: 60000 });

// Almacenamiento de fotos: secret key nueva (SUPABASE_SECRET_KEYS, JSON por nombre) con la legacy como respaldo
function nuevoStorage() {
  const clave = (() => {
    try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}")["default"]; } catch { return undefined; }
  })() ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const url = Deno.env.get("SUPABASE_URL");
  if (!url || !clave) { console.error("sync-odoo: sin SUPABASE_URL o secret key; las fotos de producto no se sincronizan"); return null; }
  return crearStorage({ url, clave });
}

// Envía un pedido aprobado; si falla, deja el error en el pedido (se ve en el admin y se puede reintentar)
async function enviarUno(sql: (q: string) => Promise<Record<string, unknown>[]>, ordenId: string, odoo = nuevoOdoo()) {
  try {
    const r = await enviarPedido({ odoo, sql, ordenId, aplicar: true, log: (m: string) => console.log("sync-odoo enviar:", m) });
    return { ok: true, nombre: r.odoo?.name };
  } catch (e) {
    const msg = String((e as Error).message).slice(0, 500).replace(/'/g, "''");
    await sql(`update ordenes set odoo_envio_error = '${msg}' where id = '${ordenId.replace(/'/g, "")}' and odoo_id is null`).catch(() => {});
    console.error("sync-odoo enviar ERROR:", ordenId, msg);
    return { ok: false, error: msg };
  }
}

async function enviarAprobado(ordenId: string) {
  const { sql, cerrar } = crearSql();
  try { await enviarUno(sql, ordenId); } finally { await cerrar(); }
}

async function escribirUna(id: string) {
  const { sql, cerrar } = crearSql();
  try {
    await procesarEscritura({ odoo: nuevoOdoo(), sql, id, storage: nuevoStorage(), log: (m: string) => console.log("sync-odoo escritura:", m) });
  } finally { await cerrar(); }
}

async function sincronizar(simular: boolean) {
  const { sql, cerrar } = crearSql();
  const t0 = Date.now();
  let trazaId: string | null = null;
  try {
    const enCurso = await sql(`select count(*)::int n from sync_corridas where estado = 'en_curso' and iniciado_en > now() - interval '10 minutes'`);
    if (!simular && enCurso[0].n > 0) {
      console.log("sync-odoo: ya hay una corrida en curso; se omite");
      return;
    }
    // Limpieza: trazas y simulaciones de más de 2 días, corridas de más de 60
    await sql(`delete from sync_corridas where (modo in ('traza', 'simulacion') and iniciado_en < now() - interval '2 days')
      or iniciado_en < now() - interval '60 days'`);
    // Traza de progreso (etapa, segundos, memoria) para ver hasta dónde llega si la plataforma corta la función
    [{ id: trazaId }] = await sql(`insert into sync_corridas (modo, origen, estado, resumen) values ('traza', 'edge-cron', 'en_curso',
      jsonb_build_object('simular', ${simular}, 'etapas', '[]'::jsonb)) returning id`) as { id: string }[];
    let etapas = 0;
    const traza = (etapa: string) => {
      etapas++;
      const e = JSON.stringify({ t: Math.round((Date.now() - t0) / 1000), mb: Math.round(Deno.memoryUsage().heapUsed / 1e6), etapa: etapa.slice(0, 120) }).replace(/'/g, "''");
      return sql(`update sync_corridas set resumen = jsonb_set(resumen, '{etapas}', (resumen->'etapas') || '${e}'::jsonb) where id = '${trazaId}'`).catch(() => {});
    };
    await traza("inicio");
    const odoo = nuevoOdoo();
    const storage = nuevoStorage();
    // Pedidos aprobados que no llegaron a Odoo (p. ej. si falló el disparo): se reintentan antes de importar
    if (!simular) {
      const pendientes = await sql(`select id from ordenes where aprobacion = 'aprobada' and aprobado_por is not null and odoo_id is null and odoo_envio_error is null
        and estado <> 'cancelado' and aprobado_at < now() - interval '2 minutes' order by aprobado_at limit 10`);
      for (const p of pendientes) { await enviarUno(sql, String(p.id), odoo); await traza(`reintento envío ${p.id}`); }
      // Escrituras hacia Odoo que no se completaron (máximo 5 intentos)
      const escrituras = await sql(`select id from odoo_escrituras where (estado = 'pendiente' or (estado = 'error' and intentos < 5)
        or (estado = 'procesando' and procesado_at is null and created_at < now() - interval '15 minutes'))
        and created_at < now() - interval '2 minutes' order by created_at limit 20`);
      for (const e of escrituras) {
        await sql(`update odoo_escrituras set estado = 'pendiente' where id = '${e.id}' and estado = 'procesando'`);
        await procesarEscritura({ odoo, sql, id: String(e.id), storage, log: (m: string) => console.log("sync-odoo escritura:", m) });
        await traza(`reintento escritura ${e.id}`);
      }
    }
    const lineas: string[] = [];
    const resumen = await importarOdoo({
      odoo, sql, aplicar: !simular, origen: "edge-cron", storage,
      log: (m: string) => { if (/⚠|✓|Escribiendo|Leyendo|Recalculando|\[\d\]/.test(m)) { lineas.push(m.trim()); traza(m.trim()); } },
    });
    await traza("fin");
    await sql(`update sync_corridas set estado = 'ok', terminado_en = now() where id = '${trazaId}'`);
    console.log(`sync-odoo ${simular ? "SIMULACIÓN" : "APLICADA"} en ${Math.round((Date.now() - t0) / 1000)}s`, lineas.join(" | "),
      JSON.stringify({ segundos: resumen.segundos, avisos: resumen.avisos }));
    // La corrida aplicada la registra el importador; la simulación se deja registrada aquí
    if (simular) {
      const r = JSON.stringify({ ...resumen, segundos_totales: Math.round((Date.now() - t0) / 1000) }).replace(/'/g, "''");
      await sql(`insert into sync_corridas (modo, origen, estado, terminado_en, resumen) values ('simulacion', 'edge-cron', 'ok', now(), '${r}'::jsonb)`);
    }
  } catch (e) {
    const msg = String((e as Error).message).replace(/'/g, "''");
    console.error("sync-odoo ERROR:", msg);
    // La traza no queda "en curso": si no, bloquea las corridas siguientes durante 10 minutos
    if (trazaId) await sql(`update sync_corridas set estado = 'error', terminado_en = now() where id = '${trazaId}'`).catch(() => {});
    // Si falló antes de que el importador abriera su corrida (credenciales, red), se registra igual
    await sql(`insert into sync_corridas (modo, origen, estado, terminado_en, error, resumen)
      select '${simular ? "simulacion" : "completo"}', 'edge-cron', 'error', now(), '${msg}', jsonb_build_object('segundos_totales', ${Math.round((Date.now() - t0) / 1000)})
      where not exists (select 1 from sync_corridas where origen = 'edge-cron' and iniciado_en > now() - interval '5 minutes' and estado = 'error')`).catch(() => {});
  } finally {
    await cerrar();
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Usa POST", { status: 405 });
  let secreto: string;
  try { secreto = env("SYNC_ODOO_SECRET"); } catch (e) { return new Response((e as Error).message, { status: 500 }); }
  if (req.headers.get("x-sync-secret") !== secreto) return new Response("No autorizado", { status: 401 });
  const url = new URL(req.url);
  if (url.searchParams.get("diag") === "1") {
    // Verificación del adaptador SQL (tipos y varias sentencias), sin tocar datos
    const { sql, cerrar } = crearSql();
    try {
      const una = await sql(`select 1::int a, 5::bigint b, 2.50::numeric c, '2026-09-27'::date d, now() e, 'x' f`);
      const varias = await sql(`begin; set local session_replication_role = replica; select 7::int n; commit;`);
      const vacia = await sql(`select 1 where false`);
      let errorOk = false;
      try { await sql(`begin; select 1/0; commit;`); } catch { errorOk = true; }
      const despues = await sql(`select 'sigue' estado`);
      return Response.json({ una, varias, vacia, errorOk, despues, odoo: !!Deno.env.get("ODOO_API_KEY") });
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 500 });
    } finally { await cerrar(); }
  }
  const enviar = url.searchParams.get("enviar");
  if (enviar) {
    if (!/^[0-9a-f-]{36}$/i.test(enviar)) return new Response("enviar: id inválido", { status: 400 });
    EdgeRuntime.waitUntil(enviarAprobado(enviar));
    return Response.json({ ok: true, enviar, mensaje: "Enviando el pedido a Odoo" }, { status: 202 });
  }
  const escritura = url.searchParams.get("escritura");
  if (escritura) {
    if (!/^[0-9a-f-]{36}$/i.test(escritura)) return new Response("escritura: id inválido", { status: 400 });
    EdgeRuntime.waitUntil(escribirUna(escritura));
    return Response.json({ ok: true, escritura, mensaje: "Procesando la escritura en Odoo" }, { status: 202 });
  }
  const simular = url.searchParams.get("simular") === "1";
  EdgeRuntime.waitUntil(sincronizar(simular));
  return new Response(JSON.stringify({ ok: true, simular, mensaje: "Sincronización iniciada; ver sync_corridas y los logs de la función" }), {
    status: 202, headers: { "Content-Type": "application/json" },
  });
});
