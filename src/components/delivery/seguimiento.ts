// Delivery D6/D8 (fase 20p): seguimiento del día, incidencias y devoluciones, indicadores y cuadre con Odoo. Tipos y
// lecturas compartidas entre /admin/delivery (pestañas En curso, Incidencias, Indicadores y Cuadre) y /admin/delivery/devoluciones.
import { supabase } from "@/lib/supabase";
import type { LineaCierre } from "@/components/delivery/entregas";

// ── Seguimiento del día (seguimiento_delivery) ──
export interface ParadaSeguimiento {
  id: string; numero: string | null; empresa: string; tipo: "entrega" | "reposicion"; estado: string; prioridad: string | null;
  fecha_ruta: string | null; orden_ruta: number | null; en_ruta: boolean | null; fecha_asignacion: string | null;
  fecha_inicio_entrega: string | null; fecha_cierre: string | null; origen_cierre: string | null; motivo_codigo: string | null;
  reprogramada_para: string | null; cliente: string | null; sucursal: string | null; direccion: string | null; ciudad: string | null;
  ubicacion: { lat: number; lng: number; confirmada: boolean } | null; cierre: { lat: number; lng: number } | null;
}
export interface PosicionRepartidor { lat: number; lng: number; precision_m: number | null; tomada_at: string; fuente: "ping" | "cierre" }
export interface RepartidorSeguimiento {
  id: string; nombre: string; telefono: string | null; posicion: PosicionRepartidor | null; rastro: [number, number][]; paradas: ParadaSeguimiento[];
}
export interface Seguimiento { fecha: string; hoy: boolean; generado_at: string; repartidores: RepartidorSeguimiento[] }

const num = (v: unknown) => (v == null ? v : Number(v)) as number;

export async function cargarSeguimiento(fecha: string): Promise<Seguimiento> {
  const { data, error } = await supabase.rpc("seguimiento_delivery", { p_fecha: fecha });
  if (error) throw new Error(error.message);
  const s = data as Seguimiento;
  return {
    ...s,
    repartidores: (s.repartidores ?? []).map((r) => ({
      ...r,
      posicion: r.posicion ? { ...r.posicion, lat: num(r.posicion.lat), lng: num(r.posicion.lng), precision_m: r.posicion.precision_m == null ? null : num(r.posicion.precision_m) } : null,
      rastro: (r.rastro ?? []).map(([a, b]) => [num(a), num(b)] as [number, number]),
      paradas: (r.paradas ?? []).map((p) => ({
        ...p,
        ubicacion: p.ubicacion ? { ...p.ubicacion, lat: num(p.ubicacion.lat), lng: num(p.ubicacion.lng) } : null,
        cierre: p.cierre ? { lat: num(p.cierre.lat), lng: num(p.cierre.lng) } : null,
      })),
    })),
  };
}

export const ABIERTA_SEG = (estado: string) => estado === "asignada" || estado === "en_camino";
export const CON_INCIDENCIA = ["incompleta", "rechazada", "reprogramada", "fallida"];

/** Avance de la ruta: hechas (cerradas), pendientes y la siguiente (la que está en camino o la primera pendiente). */
export function avanceRuta(r: RepartidorSeguimiento) {
  const pendientes = r.paradas.filter((p) => ABIERTA_SEG(p.estado));
  const hechas = r.paradas.filter((p) => !ABIERTA_SEG(p.estado));
  const siguiente = pendientes.find((p) => p.estado === "en_camino") ?? pendientes[0] ?? null;
  const incidencias = hechas.filter((p) => CON_INCIDENCIA.includes(p.estado)).length;
  return { total: r.paradas.length, hechas: hechas.length, pendientes: pendientes.length, siguiente, incidencias };
}

/** "hace 5 min", "hace 2 h" (edad de la última posición). */
export function hace(iso: string | null | undefined, ahora = Date.now()): string {
  if (!iso) return "—";
  const min = Math.max(0, Math.round((ahora - new Date(iso).getTime()) / 60000));
  if (min < 1) return "hace menos de 1 min";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `hace ${h} h${min % 60 ? ` ${min % 60} min` : ""}` : `hace ${Math.floor(h / 24)} d`;
}
/** Minutos desde la última posición (para marcarla vieja). */
export const minutosDesde = (iso: string | null | undefined, ahora = Date.now()) => (iso ? (ahora - new Date(iso).getTime()) / 60000 : Infinity);
export const POSICION_VIEJA_MIN = 30;

// ── Incidencias (incidencias_delivery) ──
export interface LineaDevolucion {
  item_id: string; move_odoo_id: number | null; producto: string; unidad: string | null; esperada: number; recibida?: number; motivo: string | null;
}
export interface EventoIncidencia { accion: string; at: string; por: string | null; detalle: string | null }
export interface Incidencia {
  id: string; entrega_id: string; empresa_id: string | null; empresa: string | null; tipo: "incompleta" | "rechazada" | "reprogramada";
  estado: "abierta" | "reprogramada" | "reasignada" | "resuelta"; fecha_objetivo: string | null;
  devolucion: "no_aplica" | "pendiente" | "confirmada"; devolucion_lineas: LineaDevolucion[] | null; devolucion_nota: string | null;
  devolucion_at: string | null; devolucion_por: string | null; nota: string | null; resuelta_at: string | null; resuelta_por: string | null;
  historial: EventoIncidencia[]; created_at: string;
  numero: string | null; transferencia_id: string | null; transferencia_odoo_id: number | null; estado_odoo: string | null; origen: string | null;
  tipo_doc: "entrega" | "reposicion"; cliente: string | null; cliente_id: string | null; direccion: string | null; ciudad: string | null;
  repartidor_id: string | null; repartidor: string | null; estado_entrega: string; fecha_asignacion: string | null; fecha_inicio_entrega: string | null;
  fecha_cierre: string | null; motivo_codigo: string | null; motivo_detalle: string | null; reprogramada_para: string | null; notas: string | null;
  receptor_nombre: string | null; firma_url: string | null; foto_entrega_url: string | null; lineas: LineaCierre[] | null; deja_pendiente: boolean | null;
  intento: number; activa: { id: string; estado: string; repartidor: string | null; fecha_ruta: string | null } | null;
  nueva: { id: string; estado: string; repartidor: string | null; fecha_cierre: string | null } | null;
}

export async function cargarIncidencias(soloDevoluciones = false, dias = 60): Promise<Incidencia[]> {
  const { data, error } = await supabase.rpc("incidencias_delivery", { p_dias: dias, p_solo_devoluciones: soloDevoluciones });
  if (error) throw new Error(error.message);
  return ((data as Incidencia[] | null) ?? []).map((i) => ({
    ...i,
    devolucion_lineas: i.devolucion_lineas?.map((l) => ({ ...l, esperada: Number(l.esperada), recibida: l.recibida == null ? undefined : Number(l.recibida) })) ?? null,
  }));
}

export const ESTADO_INCIDENCIA: Record<Incidencia["estado"], { label: string; cls: string }> = {
  abierta: { label: "Por decidir", cls: "border-red-300 bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" },
  reprogramada: { label: "En la cola con fecha", cls: "border-sky-300 bg-sky-50 text-sky-900 dark:bg-sky-500/15 dark:text-sky-200" },
  reasignada: { label: "Reasignada", cls: "border-primary/40 bg-primary/10 text-primary" },
  resuelta: { label: "Resuelta", cls: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200" },
};
export const ACCION_INCIDENCIA: Record<string, string> = {
  abierta: "Se abrió", reprogramada: "Reprogramada", reasignada: "Reasignada", resuelta: "Resuelta", devolucion_confirmada: "Devolución confirmada",
};
/** Unidades que regresan al almacén (lo esperado) o que se recibieron. */
export const unidadesDevolucion = (lineas: LineaDevolucion[] | null | undefined, campo: "esperada" | "recibida" = "esperada") =>
  (lineas ?? []).reduce((s, l) => s + Number(l[campo] ?? 0), 0);
/** Por decidir: la incidencia no está resuelta y el documento no está asignado otra vez. */
export const porDecidir = (i: Incidencia) => i.estado === "abierta";
/** Se puede reprogramar / reasignar: rechazo o reprogramación, documento abierto en Odoo y sin entrega activa. */
export const puedeRecolar = (i: Incidencia) => i.estado !== "resuelta" && i.tipo !== "incompleta" && !i.activa && !!i.transferencia_id
  && !!i.estado_odoo && !["hecha", "cancelada"].includes(i.estado_odoo);

// ── Indicadores (indicadores_delivery) ──
export interface MetricasDelivery {
  asignadas: number; cerradas: number; completas: number; incompletas: number; rechazadas: number; reprogramadas: number;
  cerradas_odoo: number; con_objetivo: number; a_tiempo: number; minutos_salida_entrega: number | null; con_tiempo: number;
}
export interface MotivoConteo { tipo: "incompleta" | "rechazada" | "reprogramada"; codigo: string; n: number }
export interface IndicadorRepartidor extends MetricasDelivery { id: string; nombre: string; motivos: MotivoConteo[] }
export interface Indicadores { desde: string; hasta: string; total: MetricasDelivery | null; repartidores: IndicadorRepartidor[]; motivos: MotivoConteo[] }

export async function cargarIndicadores(desde: string, hasta: string): Promise<Indicadores> {
  const { data, error } = await supabase.rpc("indicadores_delivery", { p_desde: desde, p_hasta: hasta });
  if (error) throw new Error(error.message);
  const r = data as Indicadores;
  const m = (x: MetricasDelivery | null) => (x ? { ...x, minutos_salida_entrega: x.minutos_salida_entrega == null ? null : Number(x.minutos_salida_entrega) } : null);
  return { ...r, total: m(r.total), repartidores: (r.repartidores ?? []).map((x) => ({ ...x, ...m(x)! })), motivos: r.motivos ?? [] };
}

export const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
export const fmtPct = (v: number | null) => (v == null ? "—" : `${v.toLocaleString("es-VE", { maximumFractionDigits: 1 })} %`);
export const fmtMinutos = (m: number | null) => {
  if (m == null) return "—";
  if (m < 60) return `${Math.round(m)} min`;
  const h = Math.floor(m / 60), r = Math.round(m % 60);
  return `${h} h${r ? ` ${r} min` : ""}`;
};

// ── Cuadre con Odoo (cuadre_entregas_odoo) ──
export type TipoCuadre = "pendiente_odoo" | "validada_sin_guds" | "cantidades_distintas" | "cancelada_odoo" | "cuadrada";
export interface LineaCuadre { move_odoo_id: number | null; producto: string | null; guds: number; odoo: number; diferencia: number }
export interface FilaCuadre {
  transferencia_odoo_id: number; empresa_id: string; transferencia_id: string | null; entrega_id: string | null; doc_numero: string | null;
  tipo: TipoCuadre; estado_guds: string | null; origen_cierre: string | null; estado_odoo: string | null; cerrada_guds_at: string | null;
  validada_odoo_at: string | null; lineas: LineaCuadre[] | null; detectado_at: string; revisado_at: string;
  entrega?: { estado: string; fecha_cierre: string | null; repartidor: { nombre: string; apellido: string | null } | null; cliente: { nombre_negocio: string } | null } | null;
}
export const TIPO_CUADRE: Record<TipoCuadre, { label: string; corto: string; cls: string; ayuda: string }> = {
  validada_sin_guds: {
    label: "Validada en Odoo sin cierre en GUDS", corto: "Validada sin GUDS", cls: "border-red-300 bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200",
    ayuda: "El documento se validó en Odoo, pero el repartidor no lo cerró como entregado en GUDS (lo validó la oficina, o GUDS lo tiene rechazado, reprogramado o anulado).",
  },
  cantidades_distintas: {
    label: "Cantidades distintas", corto: "Cantidades distintas", cls: "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200",
    ayuda: "Lo entregado en GUDS no coincide con lo validado en Odoo en al menos un producto.",
  },
  cancelada_odoo: {
    label: "Entregada en GUDS · cancelada en Odoo", corto: "Cancelada en Odoo", cls: "border-red-300 bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200",
    ayuda: "El repartidor la entregó, pero en Odoo el documento se canceló o ya no existe.",
  },
  pendiente_odoo: {
    label: "Cerrada en GUDS · Odoo abierta", corto: "Odoo aún abierta", cls: "border-sky-300 bg-sky-50 text-sky-900 dark:bg-sky-500/15 dark:text-sky-200",
    ayuda: "Entregada en GUDS y el documento sigue abierto en Odoo. Es lo normal mientras la escritura de entregas en Odoo está en modo simulación.",
  },
  cuadrada: {
    label: "Cuadrada", corto: "Cuadrada", cls: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200",
    ayuda: "Entregada en GUDS y validada en Odoo con las mismas cantidades.",
  },
};
export const DISCREPANCIAS: TipoCuadre[] = ["validada_sin_guds", "cantidades_distintas", "cancelada_odoo"];

export const SEL_CUADRE = `transferencia_odoo_id, empresa_id, transferencia_id, entrega_id, doc_numero, tipo, estado_guds, origen_cierre, estado_odoo,
  cerrada_guds_at, validada_odoo_at, lineas, detectado_at, revisado_at,
  entrega:entregas(estado, fecha_cierre, repartidor:usuarios!entregas_repartidor_id_fkey(nombre, apellido), cliente:clientes!entregas_cliente_id_fkey(nombre_negocio))`;

/** Enlace al documento de entrega en Odoo (configuracion.odoo_url_web, solo administración). */
export const enlaceOdooPicking = (base: string | null, odooId: number) =>
  base ? `${base.replace(/\/+$/, "")}/web#id=${odooId}&model=stock.picking&view_type=form` : null;
