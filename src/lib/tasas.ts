// Tasas diarias (fase 24a): BCV dólar y euro por fecha valor, dólar paralelo y brecha. Las carga la Edge Function
// actualizar-tasa-bcv a las 8:00 y a las 17:00 de Caracas; aquí se leen, se corrigen a mano o se pide una
// actualización inmediata. La tasa canónica de cobros y estados de cuenta sigue en CurrencyContext.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export interface TasaDiaria {
  fecha: string;
  bcv_usd: number | null;
  bcv_eur: number | null;
  paralelo_usd: number | null;
  brecha_pct: number | null;
  fuente_bcv: string | null;
  fuente_paralelo: string | null;
  editada_manual: boolean;
  actualizado_en: string;
}

/** Tasas vigentes a una fecha (tasa_del_dia). */
export interface TasaDelDia {
  fecha: string;
  bcv_usd: number | null;
  bcv_eur: number | null;
  fecha_bcv: string | null;
  fuente_bcv: string | null;
  paralelo_usd: number | null;
  fecha_paralelo: string | null;
  brecha_pct: number | null;
  /** Del día hábil siguiente, si el BCV ya la publicó (sale en la tarde). */
  proxima_fecha: string | null;
  proxima_bcv_usd: number | null;
  proxima_bcv_eur: number | null;
}

export const RUTA_TASAS = "/admin/tasas";

// Tabla y funciones de la fase 24a que aún no están en los tipos generados
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown) => (v === null || v === undefined ? null : String(v));

// Avisa a los que muestran tasas (encabezado, pantalla de Tasas) que hay datos nuevos.
const EVENTO = "guds:tasas-actualizadas";
export const avisarTasasActualizadas = () => window.dispatchEvent(new Event(EVENTO));

export const tasasService = {
  async delDia(fecha?: string): Promise<TasaDelDia> {
    const { data, error } = await sb.rpc("tasa_del_dia", { p_fecha: fecha ?? null });
    if (error) throw error;
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      fecha: String(d.fecha),
      bcv_usd: num(d.bcv_usd), bcv_eur: num(d.bcv_eur),
      fecha_bcv: texto(d.fecha_bcv), fuente_bcv: texto(d.fuente_bcv),
      paralelo_usd: num(d.paralelo_usd), fecha_paralelo: texto(d.fecha_paralelo),
      brecha_pct: num(d.brecha_pct),
      proxima_fecha: texto(d.proxima_fecha),
      proxima_bcv_usd: num(d.proxima_bcv_usd), proxima_bcv_eur: num(d.proxima_bcv_eur),
    };
  },

  /** Historial de más reciente a más vieja, desde una fecha (AAAA-MM-DD, opcional). */
  async historial(desde?: string | null): Promise<TasaDiaria[]> {
    let q = sb.from("tasas_diarias").select("*").order("fecha", { ascending: false }).limit(2000);
    if (desde) q = q.gte("fecha", desde);
    const { data, error } = await q;
    if (error) throw error;
    return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      ...(r as unknown as TasaDiaria),
      bcv_usd: num(r.bcv_usd), bcv_eur: num(r.bcv_eur), paralelo_usd: num(r.paralelo_usd), brecha_pct: num(r.brecha_pct),
    }));
  },

  async guardar(fecha: string, tasas: { bcv_usd: number | null; bcv_eur: number | null; paralelo_usd: number | null }): Promise<void> {
    const { error } = await sb.rpc("guardar_tasa_diaria", {
      p_fecha: fecha, p_bcv_usd: tasas.bcv_usd, p_bcv_eur: tasas.bcv_eur, p_paralelo_usd: tasas.paralelo_usd,
    });
    if (error) throw error;
  },
};

/** Tasas del día; se recargan cada 15 minutos y cuando alguien las actualiza en esta pestaña. */
export function useTasasDelDia() {
  const [tasas, setTasas] = useState<TasaDelDia | null>(null);
  const cargar = useCallback(() => {
    tasasService.delDia().then(setTasas).catch(() => undefined);
  }, []);
  useEffect(() => {
    cargar();
    const intervalo = window.setInterval(cargar, 15 * 60_000);
    window.addEventListener(EVENTO, cargar);
    return () => { window.clearInterval(intervalo); window.removeEventListener(EVENTO, cargar); };
  }, [cargar]);
  return { tasas, recargar: cargar };
}

/** «880,12» con 2 decimales, formato venezolano. */
export const formatearTasa = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : v.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** «+12,75 %» */
export const formatearBrecha = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${v > 0 ? "+" : ""}${formatearTasa(v)} %`;
