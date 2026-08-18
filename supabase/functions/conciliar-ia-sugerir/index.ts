// Edge Function: conciliar-ia-sugerir
// Fase 14 — para las líneas de un extracto bancario que el matcher determinístico
// (conciliar_extracto_automatico, RPC SQL) no pudo resolver, junta candidatos con criterio
// más laxo (banco, ventana de fecha amplia, tolerancia de monto mayor) y le pide a un modelo
// de Anthropic que sugiera el mejor match (o "ninguno") con motivo y confianza.
//
// IMPORTANTE: esto NUNCA concilia nada por sí solo. Solo escribe en
// extracto_lineas.sugerencia_ia (jsonb) — el admin decide aplicarla o no desde la UI
// (RPC aplicar_sugerencia_ia). Mismo patrón de secret/CORS que actualizar-tasa-bcv.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Candidato {
  id: string;
  fecha: string;
  monto: number;
  referencia: string | null;
  descripcion: string | null;
}

async function pedirSugerencia(linea: { fecha: string; monto: number; referencia: string | null; descripcion: string | null }, candidatos: Candidato[]) {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("Falta ANTHROPIC_API_KEY");

  const prompt = `Sos un asistente de conciliación bancaria para una distribuidora en Venezuela.
Tenés UNA línea de un extracto bancario real y una lista de movimientos ya registrados en el
sistema (cobros/pagos aprobados) que todavía no fueron conciliados con ninguna línea del
extracto. Elegí cuál de los candidatos (si alguno) corresponde a esta línea del extracto,
considerando monto, fecha y similitud de referencia/descripción (las referencias bancarias
suelen venir truncadas o con formato distinto al del sistema, así que no exijas coincidencia
exacta de texto).

LÍNEA DEL EXTRACTO:
fecha=${linea.fecha} monto=${linea.monto} referencia="${linea.referencia ?? ""}" descripcion="${linea.descripcion ?? ""}"

CANDIDATOS (índice: fecha, monto, referencia, descripcion):
${candidatos.map((c, i) => `${i}: fecha=${c.fecha} monto=${c.monto} referencia="${c.referencia ?? ""}" descripcion="${c.descripcion ?? ""}"`).join("\n")}

Respondé SOLO un JSON (sin texto alrededor) con esta forma exacta:
{"indice": <número de candidato o -1 si ninguno corresponde>, "confianza": <0 a 100>, "motivo": "<explicación breve en español>"}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const texto: string = data?.content?.[0]?.text ?? "";
  const jsonMatch = texto.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Respuesta de IA sin JSON: ${texto}`);
  return JSON.parse(jsonMatch[0]) as { indice: number; confianza: number; motivo: string };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { extracto_id } = await req.json();
    if (!extracto_id) throw new Error("Falta extracto_id");

    const secretKey =
      (() => {
        try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}")["default"]; }
        catch { return undefined; }
      })() ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, secretKey!);

    // verify_jwt=false (mismo motivo que actualizar-tasa-bcv: el gateway no valida JWT con las
    // llaves nuevas sb_publishable_) -> el chequeo de admin se hace acá adentro, a mano.
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData?.user) throw new Error("No autenticado");
    const { data: usuarioRow } = await supabase.from("usuarios").select("role").eq("auth_id", userData.user.id).maybeSingle();
    if (usuarioRow?.role !== "admin") throw new Error("Solo un administrador puede pedir sugerencias de IA");

    const { data: extracto, error: exErr } = await supabase
      .from("extractos_bancarios").select("banco_id").eq("id", extracto_id).single();
    if (exErr || !extracto) throw new Error("Extracto no encontrado");

    const { data: lineas, error: lnErr } = await supabase
      .from("extracto_lineas")
      .select("id, fecha, monto, referencia, descripcion")
      .eq("extracto_id", extracto_id)
      .eq("estado", "pendiente")
      .is("sugerencia_ia", null);
    if (lnErr) throw lnErr;

    let procesadas = 0, conSugerencia = 0;

    for (const linea of lineas ?? []) {
      // Candidatos con ventana ampliada: mismo banco, sin conciliar, monto/fecha cercanos
      // (no exactos — eso ya lo resolvió el matcher determinístico).
      const fecha = new Date(linea.fecha as string);
      const desde = new Date(fecha); desde.setDate(desde.getDate() - 15);
      const hasta = new Date(fecha); hasta.setDate(hasta.getDate() + 15);
      const tipo = Number(linea.monto) >= 0 ? "entrada" : "salida";
      const montoAbs = Math.abs(Number(linea.monto));

      const { data: movsBanco } = await supabase
        .from("movimientos_bancarios")
        .select("id, fecha, monto, referencia, descripcion")
        .eq("banco_id", extracto.banco_id)
        .eq("tipo", tipo)
        .gte("fecha", desde.toISOString())
        .lte("fecha", hasta.toISOString())
        .gte("monto", montoAbs * 0.5)
        .lte("monto", montoAbs * 1.5)
        .limit(15);

      const { data: yaConciliados } = await supabase
        .from("extracto_lineas").select("movimiento_bancario_id").not("movimiento_bancario_id", "is", null);
      const usados = new Set((yaConciliados ?? []).map((r: { movimiento_bancario_id: string }) => r.movimiento_bancario_id));

      const candidatos: Candidato[] = (movsBanco ?? [])
        .filter((m: { id: string }) => !usados.has(m.id))
        .map((m: { id: string; fecha: string; monto: number; referencia: string | null; descripcion: string | null }) => ({
          id: m.id, fecha: m.fecha, monto: Number(m.monto), referencia: m.referencia, descripcion: m.descripcion,
        }));

      procesadas++;
      if (candidatos.length === 0) {
        await supabase.from("extracto_lineas").update({
          sugerencia_ia: { movimiento_bancario_id: null, confianza: 0, motivo: "Sin candidatos cercanos en monto/fecha." },
        }).eq("id", linea.id);
        continue;
      }

      const sugerencia = await pedirSugerencia(
        { fecha: linea.fecha as string, monto: Number(linea.monto), referencia: linea.referencia as string | null, descripcion: linea.descripcion as string | null },
        candidatos
      );

      const elegido = sugerencia.indice >= 0 && sugerencia.indice < candidatos.length ? candidatos[sugerencia.indice] : null;
      await supabase.from("extracto_lineas").update({
        sugerencia_ia: {
          movimiento_bancario_id: elegido?.id ?? null,
          confianza: sugerencia.confianza,
          motivo: sugerencia.motivo,
        },
      }).eq("id", linea.id);
      if (elegido) conSugerencia++;
    }

    return new Response(JSON.stringify({ ok: true, procesadas, con_sugerencia: conSugerencia }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
