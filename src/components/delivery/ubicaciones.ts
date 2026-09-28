// Ubicaciones de entrega (fase 20f): tabla propia de GUDS (la sincronización con Odoo no la toca), una por destino
// (cliente o dirección de entrega). fuente "pin" = la puso una persona en el mapa; "gps_entrega" = GPS del teléfono al
// cerrar una entrega, propuesta hasta que administración la confirma.
import { supabase } from "@/lib/supabase";
import type { Punto } from "@/components/mapas/geo";

export interface Ubicacion {
  id: string; cliente_id: string; direccion_id: string | null; latitud: number; longitud: number; precision_m: number | null;
  fuente: "pin" | "gps_entrega"; confirmada: boolean; entrega_id: string | null; registrada_at: string; confirmada_at: string | null;
}
/** Ubicación resumida que devuelven las funciones de rutas (ruta_reparto_admin, mis_entregas_reparto). */
export interface UbicacionCorta { id?: string; lat: number; lng: number; confirmada: boolean; fuente: "pin" | "gps_entrega"; precision_m: number | null }

/** Destino de una entrega: el cliente (dirección principal) o una de sus direcciones de entrega (sucursal). */
export interface DestinoEntrega {
  cliente_id: string; direccion_id: string | null;
  cliente: string; sucursal?: string | null; direccion?: string | null; ciudad?: string | null; region?: string | null;
}

export interface DireccionCliente { id: string; odoo_id: number | null; cliente_id: string; nombre: string | null; direccion: string | null; ciudad: string | null; estado: string | null }

export const claveDestino = (cliente_id: string | null | undefined, direccion_id: string | null | undefined) =>
  direccion_id ? `d:${direccion_id}` : cliente_id ? `c:${cliente_id}` : null;

export const SEL_UBICACION = "id, cliente_id, direccion_id, latitud, longitud, precision_m, fuente, confirmada, entrega_id, registrada_at, confirmada_at";

/** Todas las ubicaciones (son pocas: una por destino), indexadas por destino. */
export async function cargarUbicaciones(): Promise<Map<string, Ubicacion>> {
  const { data, error } = await supabase.from("ubicaciones_entrega").select(SEL_UBICACION).limit(5000);
  if (error) throw new Error(error.message);
  const m = new Map<string, Ubicacion>();
  for (const u of (data as Ubicacion[] | null) ?? []) m.set(claveDestino(u.cliente_id, u.direccion_id)!, { ...u, latitud: Number(u.latitud), longitud: Number(u.longitud) });
  return m;
}

export async function ubicacionDeDestino(d: { cliente_id: string; direccion_id: string | null }): Promise<Ubicacion | null> {
  let q = supabase.from("ubicaciones_entrega").select(SEL_UBICACION);
  q = d.direccion_id ? q.eq("direccion_id", d.direccion_id) : q.eq("cliente_id", d.cliente_id).is("direccion_id", null);
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(error.message);
  const u = data as Ubicacion | null;
  return u ? { ...u, latitud: Number(u.latitud), longitud: Number(u.longitud) } : null;
}

export interface PuntoSalida extends Punto { nombre: string }

/** Punto de salida de las rutas (configuracion.delivery_punto_salida). */
export async function cargarPuntoSalida(): Promise<PuntoSalida | null> {
  const { data } = await supabase.from("configuracion").select("valor").eq("clave", "delivery_punto_salida").maybeSingle();
  try {
    const v = data?.valor ? JSON.parse(data.valor as string) : null;
    return v && Number.isFinite(Number(v.lat)) && Number.isFinite(Number(v.lng)) ? { lat: Number(v.lat), lng: Number(v.lng), nombre: v.nombre || "Punto de salida" } : null;
  } catch {
    return null;
  }
}

/** Estado de ubicación para mostrar: confirmada, propuesta (GPS por confirmar) o sin ubicación. */
export type EstadoUbicacion = "confirmada" | "propuesta" | "sin";
export const estadoUbicacion = (u: { confirmada: boolean } | null | undefined): EstadoUbicacion => (!u ? "sin" : u.confirmada ? "confirmada" : "propuesta");

export const ETIQUETA_UBICACION: Record<EstadoUbicacion, { label: string; cls: string; titulo: string }> = {
  confirmada: { label: "Ubicada", cls: "text-emerald-600 dark:text-emerald-400", titulo: "Ubicación confirmada en el mapa" },
  propuesta: { label: "Por confirmar", cls: "text-amber-600 dark:text-amber-400", titulo: "Ubicación propuesta por el GPS de una entrega: falta confirmarla" },
  sin: { label: "Sin ubicación", cls: "text-muted-foreground", titulo: "Sin ubicación en el mapa" },
};

export const fmtPrecision = (m: number | null | undefined) => (m == null ? "" : `±${Math.round(Number(m))} m`);

/** Texto para buscar la dirección en el geocodificador (quita basura de Odoo y la zona "(VE)"). */
export const textoBusqueda = (d: Pick<DestinoEntrega, "direccion" | "ciudad" | "region">) =>
  [d.direccion, d.ciudad, d.region?.replace(/\s*\(VE\)\s*$/, "")].filter(Boolean).join(", ").replace(/_x000D_/gi, " ").replace(/\s+/g, " ").trim();
