import { supabase } from "@/lib/supabase";

// Clasificación de clientes de finanzas (22d): tipo de cliente → canal → categoría de cobranza, guardada en Odoo
// (Industria, Canal de contacto y Segmento de contacto del cliente) por la cola de escrituras.

/** Fila de clasificacion_tipos (catálogo de finanzas por empresa). */
export interface TipoClasif {
  id: string;
  empresa_id: string;
  tipo: string;
  criterio: string | null;
  canal: string | null;
  categoria_cobranza: string | null;
  orden: number;
  activo: boolean;
  por_confirmar: boolean;
  nota: string | null;
  odoo_industry_id: number | null;
  odoo_channel_id: number | null;
  odoo_segment_id: number | null;
  odoo_verificado_at: string | null;
}

export type EstadoClasif =
  | "confirmada" | "enviando" | "simulada" | "error" | "cambiado_en_odoo" | "por_enviar" | "propuesta" | "solo_odoo" | "sin_clasificar";

export interface EnvioDetalle {
  cliente?: string;
  partner?: number;
  compania?: number;
  estado?: string;
  error?: string;
  sin_cambios?: boolean;
  payload?: Record<string, number | string>;
  cambios?: { campo: string; etiqueta?: string; antes: string | null; despues: string | null }[];
  antes?: { tipo_cliente: string | null; canal: string | null; segmento: string | null };
  despues?: { tipo_cliente: string | null; canal: string | null; segmento: string | null } | null;
  nota?: { texto?: string; simulada?: boolean; ok?: boolean; error?: string };
}

/** Fila de clasificacion_clientes_lista(). */
export interface FilaClasif {
  cliente_id: string;
  empresa_id: string;
  empresa: string;
  codigo: string | null;
  nombre: string;
  rif: string | null;
  odoo_id: number | null;
  es_empleado: boolean;
  vendedor_id: string | null;
  vendedor: string | null;
  ventas_odoo_usd: number;
  ultima_factura: string | null;
  deuda_usd: number;
  ventas_profit_usd: number;
  ultima_profit: string | null;
  con_actividad: boolean;
  odoo_tipo: string | null;
  odoo_canal: string | null;
  odoo_segmento: string | null;
  odoo_tipo_id: string | null;
  tipo_id: string | null;
  tipo: string | null;
  canal: string | null;
  categoria: string | null;
  tipo_por_confirmar: boolean;
  origen: "excel" | "profit" | "manual" | "odoo" | null;
  estado_asignacion: "propuesta" | "asignada" | null;
  excel_texto: string | null;
  excel_tipo_id: string | null;
  excel_tipo: string | null;
  excel_detalle: { conflicto?: boolean; filas?: { cliente: string; tipo: string | null; categoria: string | null; emparejado: string | null; cat_interna_ventas?: string | number | null }[] } | null;
  profit_tipo: string | null;
  profit_segmento: string | null;
  profit_categoria: string | null;
  profit_tipo_id: string | null;
  escritura_id: string | null;
  enviado_at: string | null;
  envio_estado: string | null;
  envio_error: string | null;
  envio_detalle: EnvioDetalle | null;
  revisado_at: string | null;
  revisado_por: string | null;
  estado: EstadoClasif;
}

export const ESTADOS: Record<EstadoClasif, { label: string; cls: string; ayuda: string }> = {
  confirmada: { label: "En Odoo", cls: "border-success/50 bg-success/15 text-foreground", ayuda: "Odoo ya tiene esta clasificación (la trajo la sincronización)" },
  enviando: { label: "Enviando…", cls: "border-primary/40 bg-primary/10 text-foreground", ayuda: "En la cola de escrituras hacia Odoo" },
  simulada: { label: "Simulado", cls: "border-warning/60 bg-warning/15 text-foreground", ayuda: "Modo prueba: se registró lo que se enviaría, sin escribir en Odoo" },
  error: { label: "Error", cls: "border-destructive/50 bg-destructive/10 text-destructive", ayuda: "El envío a Odoo falló: abre el detalle" },
  cambiado_en_odoo: { label: "Cambiado en Odoo", cls: "border-warning/60 bg-warning/15 text-foreground", ayuda: "Se escribió en Odoo pero allí ahora dice otra cosa: Odoo manda" },
  por_enviar: { label: "Por enviar", cls: "border-primary/40 bg-background text-primary", ayuda: "Confirmada en GUDS, falta enviarla a Odoo" },
  propuesta: { label: "Propuesta", cls: "border-dashed border-border bg-muted/40 text-muted-foreground", ayuda: "Carga automática (Excel de finanzas o Profit) sin revisar" },
  solo_odoo: { label: "Solo en Odoo", cls: "border-border bg-muted text-foreground", ayuda: "Odoo tiene un valor que GUDS no asignó" },
  sin_clasificar: { label: "Sin clasificar", cls: "border-border bg-background text-muted-foreground", ayuda: "Sin tipo de cliente ni propuesta" },
};
export const ORDEN_ESTADOS: EstadoClasif[] = ["sin_clasificar", "propuesta", "por_enviar", "enviando", "simulada", "error", "cambiado_en_odoo", "solo_odoo", "confirmada"];

export const ORIGENES: Record<NonNullable<FilaClasif["origen"]>, string> = {
  excel: "Excel de finanzas", profit: "Profit", manual: "Manual", odoo: "Tomado de Odoo",
};

/** Motivos por los que enviar_clasificacion_odoo() no encola un cliente. */
export const MOTIVOS_OMITIDO: Record<string, string> = {
  sin_tipo: "sin tipo asignado",
  sin_confirmar: "propuesta sin confirmar",
  tipo_por_confirmar: "tipo por confirmar por finanzas",
  tipo_incompleto: "tipo sin categoría de cobranza",
  ya_en_odoo: "ya está así en Odoo",
  en_curso: "envío en curso",
  sin_odoo: "cliente sin Odoo",
  otra_empresa: "de otra empresa",
};

export const CAMPOS_ODOO: Record<string, string> = {
  industry_id: "Tipo de cliente (Industria)",
  eu_partner_channel_id: "Canal (Canal de contacto)",
  eu_partner_segment_id: "Categoría de cobranza (Segmento de contacto)",
};

export const usd = (n: number | null | undefined) =>
  `$${Number(n ?? 0).toLocaleString("es-VE", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
export const fechaCorta = (d: string | null | undefined) =>
  d ? new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString("es-VE", { day: "2-digit", month: "short", year: "numeric" }) : "—";
export const fechaHora = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString("es-VE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

export const mensajeError = (e: { message?: string } | null | undefined) => e?.message?.replace(/^.*?ERROR:\s*/, "") ?? "Error desconocido";
/** Pista cuando la función edge aún no tiene el escritor (antes de desplegar sync-odoo). */
export const pistaError = (msg: string | null | undefined) =>
  msg && /desconocido/i.test(msg) && /clasificaci/i.test(msg)
    ? "La función de sincronización con Odoo aún no tiene el escritor de clasificación: falta desplegar sync-odoo."
    : null;

export async function cargarTipos(): Promise<TipoClasif[]> {
  const { data, error } = await supabase.from("clasificacion_tipos").select("*").order("orden").order("tipo");
  if (error) throw error;
  return (data ?? []) as TipoClasif[];
}

export async function cargarLista(clienteId?: string): Promise<FilaClasif[]> {
  const { data, error } = await supabase.rpc("clasificacion_clientes_lista", clienteId ? { p_cliente: clienteId } : {});
  if (error) throw error;
  return ((data ?? []) as FilaClasif[]).map((f) => ({ ...f, ventas_odoo_usd: Number(f.ventas_odoo_usd), deuda_usd: Number(f.deuda_usd), ventas_profit_usd: Number(f.ventas_profit_usd) }));
}

export interface PlanCatalogo { dimension: "tipo" | "canal" | "categoria"; modelo: string; nombre: string; accion: "crear" | "renombrar" | "reusar"; odoo_id: number | null; antes?: string; antes_idioma?: string; archivado?: boolean }
export interface RevisionCatalogo {
  empresa_id: string; id: string; estado: string; error: string | null; created_at: string; procesado_at: string | null;
  resultado: { modo?: string; resumen?: { crear: number; renombrar: number; reusar: number }; plan?: PlanCatalogo[]; avisos?: string[] } | null;
}
export interface EstadoOdooClasif { modo: "simular" | "activo" | string; catalogo: RevisionCatalogo[] }

export async function cargarEstadoOdoo(): Promise<EstadoOdooClasif> {
  const { data, error } = await supabase.rpc("clasificacion_estado_odoo");
  if (error) throw error;
  return data as EstadoOdooClasif;
}

export const DIMENSION: Record<PlanCatalogo["dimension"], string> = { tipo: "Tipo (Industria)", canal: "Canal", categoria: "Categoría (Segmento)" };
export const ACCION_PLAN: Record<PlanCatalogo["accion"], string> = { crear: "Crear", renombrar: "Ajustar nombre", reusar: "Ya existe" };
