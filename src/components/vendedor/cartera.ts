import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { ClienteCartera, Tramos } from "./tipos";

// Cartera del vendedor desde cartera_vendedor() (migración 20o): sus clientes activos con deuda por tramos, mora y prioridad
// de cobro, con la misma definición de deuda que resumen_vendedor() y Cuentas por cobrar del admin.
export function useCarteraVendedor() {
  const [clientes, setClientes] = useState<ClienteCartera[]>([]);
  const [hoy, setHoy] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const recargar = useCallback(async () => {
    setCargando(true);
    const { data, error: e } = await supabase.rpc("cartera_vendedor");
    if (e) setError(e.message);
    else {
      const d = data as { hoy: string; clientes: ClienteCartera[] } | null;
      setClientes((d?.clientes ?? []).map((c) => ({
        ...c,
        por_cobrar: Number(c.por_cobrar), a_favor: Number(c.a_favor), vencido: Number(c.vencido), dias_mora: Number(c.dias_mora),
        saldo_inicial: Number(c.saldo_inicial), vence_7d: Number(c.vence_7d), prioridad: Number(c.prioridad),
        limite_credito: Number(c.limite_credito),
      })));
      setHoy(d?.hoy ?? null);
      setError(null);
    }
    setCargando(false);
  }, []);

  useEffect(() => { recargar(); }, [recargar]);
  return { clientes, hoy, cargando, error, recargar };
}

export const TRAMOS: { clave: keyof Tramos; etiqueta: string; corta: string }[] = [
  { clave: "por_vencer", etiqueta: "Por vencer", corta: "Por vencer" },
  { clave: "d1_30", etiqueta: "1–30 días", corta: "1–30" },
  { clave: "d31_60", etiqueta: "31–60 días", corta: "31–60" },
  { clave: "d61_90", etiqueta: "61–90 días", corta: "61–90" },
  { clave: "mas_90", etiqueta: "Más de 90 días", corta: "+90" },
];

export const sumarTramos = (lista: { tramos: Tramos }[]): Tramos =>
  lista.reduce<Tramos>((s, c) => ({
    por_vencer: s.por_vencer + Number(c.tramos.por_vencer || 0),
    d1_30: s.d1_30 + Number(c.tramos.d1_30 || 0),
    d31_60: s.d31_60 + Number(c.tramos.d31_60 || 0),
    d61_90: s.d61_90 + Number(c.tramos.d61_90 || 0),
    mas_90: s.mas_90 + Number(c.tramos.mas_90 || 0),
  }), { por_vencer: 0, d1_30: 0, d31_60: 0, d61_90: 0, mas_90: 0 });
