import { useCallback, useEffect, useState } from "react";
import {
  Receipt, UserPlus, Boxes, FileMinus2, ListChecks, Package, UserX,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

export interface PendingActionItem {
  clave: string;
  label: string;
  count: number;
  link: string;
  icono: typeof Receipt;
}

/**
 * Fuente única de "todo lo que hay por hacer" — la usan la Torre de Control y el
 * Dashboard, para no mantener dos versiones de las mismas colas de aprobación.
 * Cada fuente reusa exactamente el mismo filtro que ya usa su propio módulo.
 */
export function usePendingActions() {
  const [items, setItems] = useState<PendingActionItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [
      pagosRes, registrosRes, consignacionRes, retencionesRes,
      extractoLineasRes, stockBajoRes, sinVendedorRes,
    ] = await Promise.all([
      supabase.from("pagos").select("id", { count: "exact", head: true }).eq("estado", "pendiente"),
      supabase.from("registros_clientes").select("id", { count: "exact", head: true }).eq("estado", "pendiente"),
      supabase.from("declaraciones_consignacion").select("id", { count: "exact", head: true }).eq("estado", "pendiente"),
      supabase.from("retenciones").select("id", { count: "exact", head: true }).eq("estado", "pendiente"),
      supabase.from("extracto_lineas").select("id", { count: "exact", head: true }).eq("estado", "pendiente"),
      supabase.from("productos").select("id", { count: "exact", head: true }).eq("activo", true).lt("stock_actual", 10),
      supabase.from("clientes").select("id", { count: "exact", head: true }).eq("activo", true).is("vendedor_asignado_id", null),
    ]);

    const lista: PendingActionItem[] = [
      { clave: "pagos", label: "Pagos por verificar", count: pagosRes.count || 0, link: "/admin/cuentas-por-cobrar", icono: Receipt },
      { clave: "registros", label: "Registros de clientes pendientes", count: registrosRes.count || 0, link: "/admin/registros", icono: UserPlus },
      { clave: "consignacion", label: "Consignación por revisar", count: consignacionRes.count || 0, link: "/admin/consignacion", icono: Boxes },
      { clave: "retenciones", label: "Retenciones por revisar", count: retencionesRes.count || 0, link: "/admin/retenciones", icono: FileMinus2 },
      { clave: "conciliacion", label: "Líneas de extracto sin conciliar", count: extractoLineasRes.count || 0, link: "/admin/conciliacion", icono: ListChecks },
      { clave: "stock", label: "Productos con stock bajo", count: stockBajoRes.count || 0, link: "/admin/inventario", icono: Package },
      { clave: "sin-vendedor", label: "Clientes sin vendedor asignado", count: sinVendedorRes.count || 0, link: "/admin/vendedores", icono: UserX },
    ];

    setItems(lista);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const total = items.reduce((s, i) => s + i.count, 0);
  return { items, total, loading, refetch: fetchAll };
}
