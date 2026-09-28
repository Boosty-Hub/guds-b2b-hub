// Delivery sobre los documentos de entrega de Odoo (fase 19v): estados, motivos, tipos y utilidades compartidas entre el
// admin (/admin/delivery) y la app del repartidor (/delivery/*). Los códigos de motivo son los que valida cerrar_entrega.
import { diaCaracas } from "@/components/delivery/fechas";
import { navegarGoogle, navegarWaze } from "@/components/mapas/geo";
import type { UbicacionCorta } from "@/components/delivery/ubicaciones";

export type ResultadoCierre = "completa" | "incompleta" | "rechazada" | "reprogramada";

export interface Motivo { v: string; l: string; pendiente?: boolean }

// Por producto (entrega incompleta). "Faltó en el camión" deja pendiente en Odoo; el resto se valida sin pendiente.
export const MOTIVOS_LINEA: Motivo[] = [
  { v: "falto_camion", l: "Faltó en el camión", pendiente: true },
  { v: "no_lo_quiso", l: "El cliente no lo quiso" },
  { v: "danado", l: "Producto dañado" },
  { v: "vencimiento", l: "Vencido o vencimiento corto" },
  { v: "error_pedido", l: "Producto o cantidad equivocada" },
  { v: "otro", l: "Otro motivo" },
];
export const MOTIVOS_RECHAZO: Motivo[] = [
  { v: "sin_oc", l: "Sin orden de compra / OC vencida" },
  { v: "precio", l: "El precio no coincide" },
  { v: "duplicado", l: "Pedido duplicado" },
  { v: "danado", l: "Mercancía dañada" },
  { v: "vencimiento", l: "Vencimiento corto" },
  { v: "fuera_horario", l: "Fuera del horario de recepción" },
  { v: "no_lo_pidio", l: "El cliente no lo pidió" },
  { v: "falta_pago", l: "Falta de pago" },
  { v: "otro", l: "Otro motivo" },
];
export const MOTIVOS_REPROGRAMACION: Motivo[] = [
  { v: "cerrado", l: "Local cerrado" },
  { v: "fuera_horario", l: "Fuera del horario de recepción" },
  { v: "receptor_ausente", l: "No estaba quien recibe" },
  { v: "direccion_no_encontrada", l: "No se encontró la dirección" },
  { v: "cliente_pide_fecha", l: "El cliente pidió otra fecha" },
  { v: "sin_tiempo", l: "No dio tiempo en la ruta" },
  { v: "falla_vehiculo", l: "Falla del vehículo" },
  { v: "otro", l: "Otro motivo" },
];
const TODOS = [...MOTIVOS_LINEA, ...MOTIVOS_RECHAZO, ...MOTIVOS_REPROGRAMACION];
export const etiquetaMotivo = (codigo: string | null | undefined, lista: Motivo[] = TODOS) =>
  codigo ? (lista.find((m) => m.v === codigo)?.l ?? codigo) : "—";

// Estado de la entrega en GUDS
export const ESTADO_ENTREGA: Record<string, { label: string; cls: string }> = {
  asignada: { label: "Asignada", cls: "border-primary/40 bg-primary/10 text-primary" },
  en_camino: { label: "En camino", cls: "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200" },
  entregada: { label: "Entregada", cls: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200" },
  incompleta: { label: "Entregada incompleta", cls: "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200" },
  rechazada: { label: "Rechazada", cls: "border-red-300 bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" },
  reprogramada: { label: "Reprogramada", cls: "border-sky-300 bg-sky-50 text-sky-900 dark:bg-sky-500/15 dark:text-sky-200" },
  cancelada: { label: "Cancelada", cls: "text-muted-foreground" },
  fallida: { label: "Fallida", cls: "border-red-300 bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" },
};
export const ABIERTAS = ["asignada", "en_camino"];
/** Insignia de las reposiciones a consignación (traslado de un almacén propio al de consignación de un cliente). */
export const CLS_REPOSICION = "border-violet-300 bg-violet-50 text-violet-900 dark:bg-violet-500/15 dark:text-violet-200";

// Estado de la escritura del resultado en Odoo (cola odoo_escrituras)
export const ESTADO_ESCRITURA: Record<string, { label: string; cls: string; titulo: string }> = {
  pendiente: { label: "Por enviar", cls: "text-muted-foreground", titulo: "En cola para Odoo" },
  procesando: { label: "Enviando", cls: "text-muted-foreground", titulo: "Procesándose en Odoo" },
  simulada: { label: "Simulada", cls: "border-sky-300 bg-sky-50 text-sky-900 dark:bg-sky-500/15 dark:text-sky-200", titulo: "Modo simulación: se calculó qué se escribiría en Odoo, sin escribir" },
  hecha: { label: "Validada en Odoo", cls: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200", titulo: "El documento quedó validado en Odoo" },
  error: { label: "Error en Odoo", cls: "border-red-300 bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200", titulo: "No se pudo validar en Odoo" },
};

// ── Lo que devuelve mis_entregas_reparto (app del repartidor) ──
export interface LoteReparto { lote: string | null; cantidad: number; vence: string | null }
export interface LineaReparto {
  id: string; producto: string; unidad: string | null; demandada: number; esperada: number; estado: string | null; lotes: LoteReparto[];
}
export interface LineaCierre {
  item_id: string; move_odoo_id: number; producto: string; demandada: number; esperada: number; entregada: number; motivo: string | null;
}
export interface EntregaReparto {
  id: string; estado: string; prioridad: string | null; empresa_id: string; empresa: string;
  fecha_asignacion: string | null; fecha_inicio_entrega: string | null; fecha_entrega: string | null; fecha_cierre: string | null;
  receptor_nombre: string | null; motivo_codigo: string | null; motivo_detalle: string | null; motivo_fallo: string | null;
  reprogramada_para: string | null; origen_cierre: string | null; notas: string | null; lineas_cierre: LineaCierre[] | null;
  es_documento: boolean; tipo: "entrega" | "reposicion"; numero: string | null; origen: string | null; estado_odoo: string | null; fecha_programada: string | null;
  cliente: string | null; contacto: string | null; direccion: string | null; ciudad: string | null; region: string | null;
  telefono: string | null; notas_documento: string | null; lineas: LineaReparto[];
  /** Ruta del día (20f): día y posición que fijó el planificador; ubicación de la parada si está abierta. */
  fecha_ruta: string | null; orden_ruta: number | null; ubicacion: UbicacionCorta | null;
}

// ── Utilidades ──
/** Números de teléfono de un texto de Odoo ("0212-2734915 / 0414-…", "0212-9498154 0424-1358583", "+58 412-4200266",
 *  "267.14.77 263.31.05"): une los trozos de un mismo número y separa números distintos. Cada uno con al menos 7 dígitos. */
export function telefonos(texto: string | null | undefined): string[] {
  if (!texto) return [];
  const salida: string[] = [];
  for (const parte of texto.split(/[/;,|]/)) {
    let cur = "";
    const cerrar = () => { if (cur.replace(/\D/g, "").length >= 7) salida.push(cur); cur = ""; };
    for (const tok of parte.split(/\s+/)) {
      const d = tok.replace(/\D/g, "");
      if (!d) continue;
      const nCur = cur.replace(/\D/g, "").length;
      if (nCur >= 7 && nCur + d.length > 12) cerrar();
      cur = (cur || (tok.trim().startsWith("+") ? "+" : "")) + d;
      if (cur.replace(/\D/g, "").length >= 10) cerrar();
    }
    cerrar();
  }
  return salida;
}
const destino = (dir: string | null, ciudad?: string | null, region?: string | null) =>
  [dir, ciudad, region?.replace(/\s*\(VE\)\s*$/, ""), "Venezuela"].filter(Boolean).join(", ");
export const enlaceMaps = (dir: string | null, ciudad?: string | null, region?: string | null) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destino(dir, ciudad, region))}`;
export const enlaceWaze = (dir: string | null, ciudad?: string | null, region?: string | null) =>
  `https://waze.com/ul?q=${encodeURIComponent(destino(dir, ciudad, region))}&navigate=yes`;
/** Navegar a una parada: por coordenadas si tiene ubicación en el mapa; si no, por la dirección de Odoo. */
export const navegacion = (e: Pick<EntregaReparto, "ubicacion" | "direccion" | "ciudad" | "region">) => e.ubicacion
  ? { maps: navegarGoogle(e.ubicacion), waze: navegarWaze(e.ubicacion) }
  : { maps: enlaceMaps(e.direccion, e.ciudad, e.region), waze: enlaceWaze(e.direccion, e.ciudad, e.region) };
/** Ruta con varias paradas en Google Maps (hasta 9 paradas intermedias), por coordenadas cuando las hay. */
export const enlaceRuta = (paradas: { dir: string | null; ciudad?: string | null; region?: string | null; lat?: number; lng?: number }[]) => {
  const d = paradas.filter((p) => p.dir || p.lat != null).map((p) => (p.lat != null && p.lng != null ? `${p.lat},${p.lng}` : destino(p.dir, p.ciudad, p.region)));
  if (!d.length) return null;
  const fin = d[d.length - 1];
  const intermedias = d.slice(0, -1).slice(0, 9);
  return `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${encodeURIComponent(fin)}${intermedias.length ? `&waypoints=${encodeURIComponent(intermedias.join("|"))}` : ""}`;
};
/** Siguiente día hábil (lunes a sábado) en Caracas, como YYYY-MM-DD. */
export function siguienteDiaHabil(): string {
  const [y, m, d] = diaCaracas().split("-").map(Number);
  const f = new Date(Date.UTC(y, m - 1, d + 1));
  if (f.getUTCDay() === 0) f.setUTCDate(f.getUTCDate() + 1);
  return f.toISOString().slice(0, 10);
}
export const fmtCantidad = (n: number | null | undefined) =>
  n == null ? "—" : Number(n).toLocaleString("es-VE", { maximumFractionDigits: 2 });
/** Fecha (YYYY-MM-DD) como "lun 29 sept" sin desfase de zona. */
export const fmtDia = (s: string | null) =>
  s ? new Date(`${s.slice(0, 10)}T12:00:00Z`).toLocaleDateString("es-ES", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" }) : "—";
/** Fecha (YYYY-MM-DD) como "31/12/2026" (vencimientos de lote). */
export const fmtFecha = (s: string | null) =>
  s ? new Date(`${s.slice(0, 10)}T12:00:00Z`).toLocaleDateString("es-VE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }) : "—";
