// Rutas de reparto por repartidor y día (fase 20f): lo que devuelve ruta_reparto_admin (planificador y hoja de ruta).
import { supabase } from "@/lib/supabase";
import type { DestinoEntrega, UbicacionCorta } from "@/components/delivery/ubicaciones";

export interface LineaParada { producto: string; unidad: string | null; demandada: number | null; cantidad: number }
export interface ParadaAdmin {
  id: string; estado: string; prioridad: string | null; empresa_id: string; empresa: string; numero: string | null; origen: string | null;
  tipo: "entrega" | "reposicion"; fecha_ruta: string | null; orden_ruta: number | null; fecha_programada: string | null;
  fecha_asignacion: string | null; fecha_cierre: string | null; cliente_id: string | null; direccion_id: string | null;
  cliente: string | null; contacto: string | null; sucursal: string | null; direccion: string | null; ciudad: string | null; region: string | null;
  telefono: string | null; ubicacion: UbicacionCorta | null; lineas: LineaParada[];
}
export interface RutaPublicada { version: number; paradas: string[]; publicada_at: string | null; publicada_por: string | null }
export interface RutaAdmin { ruta: RutaPublicada | null; entregas: ParadaAdmin[] }

export async function cargarRutaAdmin(repartidorId: string, fecha: string): Promise<RutaAdmin> {
  const { data, error } = await supabase.rpc("ruta_reparto_admin", { p_repartidor_id: repartidorId, p_fecha: fecha });
  if (error) throw new Error(error.message);
  const r = (data as RutaAdmin | null) ?? { ruta: null, entregas: [] };
  return {
    ruta: r.ruta,
    entregas: (r.entregas ?? []).map((e) => ({ ...e, ubicacion: e.ubicacion ? { ...e.ubicacion, lat: Number(e.ubicacion.lat), lng: Number(e.ubicacion.lng) } : null })),
  };
}

export const ABIERTA = (estado: string) => estado === "asignada" || estado === "en_camino";

export const destinoDeParada = (p: ParadaAdmin): DestinoEntrega | null => (p.cliente_id ? {
  cliente_id: p.cliente_id, direccion_id: p.direccion_id, cliente: p.cliente ?? "Cliente", sucursal: p.sucursal,
  direccion: p.direccion, ciudad: p.ciudad, region: p.region,
} : null);
