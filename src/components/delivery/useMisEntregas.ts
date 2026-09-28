import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import type { EntregaReparto } from "@/components/delivery/entregas";

/** Entregas del repartidor con sesión (abiertas + cerradas de los últimos `dias`), por la función mis_entregas_reparto:
 *  trae el documento de Odoo, la dirección y el teléfono de entrega y las líneas, sin precios. Ignora la empresa activa:
 *  el repartidor ve y cierra sus entregas de todas sus empresas. */
export function useMisEntregas(dias = 30) {
  const { user } = useAuth();
  const [entregas, setEntregas] = useState<EntregaReparto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const recargar = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    const { data, error: err } = await supabase.rpc("mis_entregas_reparto", { p_dias: dias });
    setError(err ? err.message : null);
    setEntregas(err ? [] : ((data as EntregaReparto[] | null) ?? []));
    setLoading(false);
  }, [user?.id, dias]);

  useEffect(() => { recargar(); }, [recargar]);
  return { entregas, loading, error, recargar };
}
