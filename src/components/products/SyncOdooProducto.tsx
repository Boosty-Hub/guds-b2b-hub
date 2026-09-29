import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowLeftRight, CheckCircle2, FlaskConical, Loader2, RotateCcw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// Foto principal y descripción de un producto de Odoo: se sincronizan en los dos sentidos (decisión 15, migración 20r).
// Muestra de dónde vino el último cambio de cada una, el estado del último envío a Odoo (cola odoo_escrituras) y, si GUDS tiene
// una foto o descripción anterior a la sincronización que Odoo no tiene, el botón para enviarla.

export interface ProductoSyncOdoo {
  id: string;
  odoo_id?: number | null;
  imagen_url: string | null;
  descripcion: string | null;
  imagen_origen?: "guds" | "odoo" | null;
  imagen_actualizada_en?: string | null;
  imagen_odoo_url?: string | null;
  descripcion_origen?: "guds" | "odoo" | null;
  descripcion_actualizada_en?: string | null;
}

interface EnvioProducto {
  id: string;
  estado: "pendiente" | "procesando" | "simulada" | "hecha" | "error";
  error: string | null;
  intentos: number;
  created_at: string;
  procesado_at: string | null;
  resultado: {
    campos?: string[];
    sin_cambios?: boolean;
    omitida?: string;
    motivo?: string;
    omitidos?: { campo: string; motivo: string }[];
    avisos?: string[];
  } | null;
}

const fechaCorta = (d?: string | null) =>
  d ? new Date(d).toLocaleString("es-VE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : null;

const ETIQUETA_CAMPO: Record<string, string> = { imagen: "foto", descripcion: "descripción" };
const listaCampos = (c?: string[]) => (c?.length ? c.map((x) => ETIQUETA_CAMPO[x] ?? x).join(" y ") : null);

function Origen({ etiqueta, origen, fecha }: { etiqueta: string; origen?: string | null; fecha?: string | null }) {
  return (
    <span>
      <span className="text-muted-foreground">{etiqueta}:</span>{" "}
      {origen === "guds" ? "cambio en GUDS" : origen === "odoo" ? "vino de Odoo" : "sin cambios registrados"}
      {origen && fecha ? <span className="text-muted-foreground"> · {fechaCorta(fecha)}</span> : null}
    </span>
  );
}

/** Estado del último envío a Odoo en una línea (con reintentar si falló). */
function EstadoEnvio({ envio, simular, reintentando, onReintentar }: {
  envio: EnvioProducto; simular: boolean; reintentando: boolean; onReintentar: () => void;
}) {
  const r = envio.resultado ?? {};
  const campos = listaCampos(r.campos);
  const cuando = fechaCorta(envio.procesado_at ?? envio.created_at);
  let icono = <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />;
  let texto = "Enviando a Odoo…";
  let cls = "text-foreground";
  if (envio.estado === "error") {
    icono = <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />;
    texto = `Error al escribir en Odoo: ${envio.error ?? "desconocido"}`;
    cls = "text-destructive";
  } else if (envio.estado === "simulada") {
    icono = <FlaskConical className="h-3.5 w-3.5 shrink-0 text-warning" />;
    texto = r.sin_cambios || r.omitida ? `Simulación: ${r.omitida ?? r.motivo ?? "sin cambios para Odoo"}`
      : `Simulación: se enviaría ${campos ?? "el cambio"} (no se escribió en Odoo)`;
  } else if (envio.estado === "hecha") {
    icono = <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />;
    texto = r.sin_cambios || r.omitida ? (r.omitida ?? r.motivo ?? "Sin cambios para Odoo") : `Escrita en Odoo: ${campos ?? "cambio"}`;
  }
  return (
    <div className="space-y-0.5" data-testid="sync-odoo-envio" data-estado={envio.estado}>
      <p className={cn("flex items-start gap-1.5", cls)}>
        <span className="mt-px">{icono}</span>
        <span className="min-w-0 break-words">
          {texto}
          {cuando && <span className="text-muted-foreground"> · {cuando}</span>}
          {simular && envio.estado === "pendiente" && <span className="text-muted-foreground"> (modo simulación)</span>}
        </span>
      </p>
      {(r.omitidos ?? []).map((o) => <p key={o.campo} className="pl-5 text-muted-foreground">{o.motivo}</p>)}
      {(r.avisos ?? []).map((a) => <p key={a} className="pl-5 text-muted-foreground">{a}</p>)}
      {envio.estado === "error" && (
        <Button size="sm" variant="outline" className="ml-5 h-6 gap-1 px-2 text-[11px]" onClick={onReintentar} disabled={reintentando}>
          {reintentando ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />} Reintentar
        </Button>
      )}
    </div>
  );
}

/** Indicador "Se sincroniza con Odoo" de la ficha de producto (solo productos de Odoo). */
export function SyncOdooProducto({ producto, version = 0, onEnviado }: {
  producto: ProductoSyncOdoo; version?: number; onEnviado?: () => void;
}) {
  const { toast } = useToast();
  const [envio, setEnvio] = useState<EnvioProducto | null | undefined>(undefined);
  const [simular, setSimular] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    const [{ data }, { data: cfg }] = await Promise.all([
      supabase.from("odoo_escrituras").select("id, estado, error, intentos, created_at, procesado_at, resultado")
        .eq("tipo", "producto").eq("referencia_id", producto.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("configuracion").select("valor").eq("clave", "odoo_escritura_productos").maybeSingle(),
    ]);
    setEnvio((data as EnvioProducto | null) ?? null);
    setSimular(((cfg as { valor: string | null } | null)?.valor ?? "simular") !== "activo");
  }, [producto.id]);

  useEffect(() => { cargar(); }, [cargar, version]);

  // Mientras el envío está en curso se refresca solo (hasta 2 minutos; después lo retoma la sincronización)
  const enCurso = envio?.estado === "pendiente" || envio?.estado === "procesando";
  useEffect(() => {
    if (!enCurso) return;
    const inicio = Date.now();
    const t = setInterval(() => { if (Date.now() - inicio > 120000) clearInterval(t); else cargar(); }, 2500);
    return () => clearInterval(t);
  }, [enCurso, cargar]);

  if (!producto.odoo_id) return null;

  // Foto o descripción de GUDS de antes de la sincronización que Odoo no tiene: se envían a mano
  const fotoSinEnviar = !!producto.imagen_url && !producto.imagen_origen && producto.imagen_url !== producto.imagen_odoo_url;
  const descSinEnviar = !!producto.descripcion?.trim() && !producto.descripcion_origen;
  const sinEnviar = [fotoSinEnviar && "la foto", descSinEnviar && "la descripción"].filter(Boolean).join(" y ");

  const enviar = async () => {
    setOcupado(true);
    const { error } = await supabase.rpc("enviar_producto_odoo", { p_producto_id: producto.id });
    setOcupado(false);
    if (error) { toast({ title: "No se pudo enviar a Odoo", description: error.message, variant: "destructive" }); return; }
    toast({ title: simular ? "Enviado a Odoo (simulación)" : "Enviando a Odoo", description: `Se envía ${sinEnviar}.` });
    onEnviado?.();
    cargar();
  };

  const reintentar = async () => {
    if (!envio) return;
    setOcupado(true);
    const { error } = await supabase.rpc("reintentar_escritura_producto", { p_id: envio.id });
    setOcupado(false);
    if (error) { toast({ title: "No se pudo reintentar", description: error.message, variant: "destructive" }); return; }
    setEnvio({ ...envio, estado: "pendiente", error: null });
    setTimeout(cargar, 1500);
  };

  return (
    <div className="space-y-1 rounded-md border border-border bg-muted/30 px-2.5 py-2 text-xs" data-testid="sync-odoo-producto">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <p className="flex items-center gap-1.5 font-medium">
          <ArrowLeftRight className="h-3.5 w-3.5 text-[#714B67] dark:text-[#d7b6cf]" aria-hidden />
          Se sincroniza con Odoo
          {simular && <span className="font-normal text-muted-foreground">· modo simulación</span>}
        </p>
        {sinEnviar && (
          <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-[11px]" onClick={enviar} disabled={ocupado || enCurso}>
            {ocupado ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Enviar a Odoo
          </Button>
        )}
      </div>
      <p className="text-muted-foreground">La foto principal y la descripción se escriben en Odoo y lo que cambie en Odoo llega aquí; gana el cambio más reciente.</p>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5">
        <Origen etiqueta="Foto" origen={producto.imagen_origen} fecha={producto.imagen_actualizada_en} />
        <Origen etiqueta="Descripción" origen={producto.descripcion_origen} fecha={producto.descripcion_actualizada_en} />
      </div>
      {sinEnviar && <p className="text-amber-700 dark:text-amber-300">Odoo aún no tiene {sinEnviar} de GUDS.</p>}
      {envio === undefined ? null : envio ? (
        <EstadoEnvio envio={envio} simular={simular} reintentando={ocupado} onReintentar={reintentar} />
      ) : (
        <p className="text-muted-foreground">Todavía no se ha enviado nada de este producto a Odoo.</p>
      )}
    </div>
  );
}
