import { useCallback, useEffect, useState } from "react";
import {
  Receipt, UserPlus, Boxes, FileMinus2, ListChecks, Package, UserX, CalendarX, CalendarClock, Truck, Landmark,
  ClipboardCheck, Gauge, CreditCard, CloudOff,
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
    const fecha = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const hoy = new Date();
    const en30 = new Date(hoy.getTime() + 30 * 86400000);
    const [
      pagosRes, registrosRes, consignacionRes, retencionesRes,
      extractoLineasRes, stockBajoRes, sinVendedorRes, vencidosRes, porVencerRes, despachosRes, porIdentificarRes, porAprobarRes,
      cobranzaRes, errorEnvioRes,
    ] = await Promise.all([
      supabase.from("pagos").select("id", { count: "exact", head: true }).eq("estado", "pendiente"),
      supabase.from("registros_clientes").select("id", { count: "exact", head: true }).eq("estado", "pendiente"),
      supabase.from("declaraciones_consignacion").select("id", { count: "exact", head: true }).eq("estado", "pendiente"),
      supabase.from("retenciones").select("id", { count: "exact", head: true }).eq("estado", "pendiente"),
      supabase.from("extracto_lineas").select("id", { count: "exact", head: true }).eq("estado", "pendiente"),
      supabase.from("productos").select("id", { count: "exact", head: true }).eq("activo", true).eq("controla_stock", true).lt("stock_actual", 10),
      supabase.from("clientes").select("id", { count: "exact", head: true }).eq("activo", true).eq("es_empleado", false).is("vendedor_asignado_id", null),
      supabase.from("lotes").select("id", { count: "exact", head: true }).gt("cantidad", 0).lt("vencimiento", fecha(hoy)),
      supabase.from("lotes").select("id", { count: "exact", head: true }).gt("cantidad", 0).gte("vencimiento", fecha(hoy)).lte("vencimiento", fecha(en30)),
      supabase.from("transferencias").select("id", { count: "exact", head: true }).eq("tipo", "entrega").eq("estado", "lista"),
      supabase.from("movimientos_bancarios").select("id", { count: "exact", head: true }).eq("origen", "por_identificar"),
      supabase.from("ordenes").select("id", { count: "exact", head: true }).eq("aprobacion", "pendiente"),
      // Alertas de cobranza (21b): DSO sobre el umbral y deuda sobre el límite de crédito (0 si no hay permiso de cuentas)
      supabase.rpc("alertas_cobranza"),
      // Pedidos aprobados (de clientes, vendedores, admin o ventas en consignación, 22b) que no se pudieron crear en Odoo
      // (mismo filtro que "Error al enviar a Odoo" en Órdenes)
      supabase.from("ordenes").select("id", { count: "exact", head: true }).eq("aprobacion", "aprobada").is("odoo_id", null)
        .not("odoo_envio_error", "is", null),
    ]);
    // 22h (D6): días de recuperación (deuda neta ÷ venta promedio mensual de 12 meses × 30) sobre el umbral, y con deuda sin compras
    const cobranza = (cobranzaRes.data as { umbral: number; dso_alto: number; sobre_limite: number; umbral_recuperacion?: number; recuperacion_alta?: number; sin_compras?: number } | null)
      ?? { umbral: 60, dso_alto: 0, sobre_limite: 0 };

    const lista: PendingActionItem[] = [
      { clave: "por-aprobar", label: "Pedidos por aprobar", count: porAprobarRes.count || 0, link: "/admin/ordenes?aprobacion=pendiente", icono: ClipboardCheck },
      { clave: "error-envio-odoo", label: "Pedidos aprobados con error al crearse en Odoo", count: errorEnvioRes.count || 0, link: "/admin/ordenes?aprobacion=error", icono: CloudOff },
      { clave: "pagos", label: "Pagos por verificar", count: pagosRes.count || 0, link: "/admin/cuentas-por-cobrar", icono: Receipt },
      { clave: "registros", label: "Registros de clientes pendientes", count: registrosRes.count || 0, link: "/admin/registros", icono: UserPlus },
      { clave: "consignacion", label: "Consignación por revisar", count: consignacionRes.count || 0, link: "/admin/consignacion", icono: Boxes },
      { clave: "retenciones", label: "Retenciones por revisar", count: retencionesRes.count || 0, link: "/admin/retenciones", icono: FileMinus2 },
      { clave: "conciliacion", label: "Líneas de extracto sin conciliar", count: extractoLineasRes.count || 0, link: "/admin/conciliacion", icono: ListChecks },
      { clave: "recuperacion-alta", label: `Clientes con más de ${cobranza.umbral_recuperacion ?? 90} días de recuperación`, count: cobranza.recuperacion_alta || 0, link: "/admin/cuentas?cobranza=recuperacion_alta", icono: Gauge },
      { clave: "sin-compras", label: "Clientes con deuda y sin compras en 12 meses", count: cobranza.sin_compras || 0, link: "/admin/cuentas?cobranza=sin_compras", icono: Gauge },
      { clave: "sobre-limite", label: "Clientes sobre su límite de crédito", count: cobranza.sobre_limite || 0, link: "/admin/cuentas?situacion=excedido", icono: CreditCard },
      { clave: "stock", label: "Productos con stock bajo", count: stockBajoRes.count || 0, link: "/admin/inventario", icono: Package },
      { clave: "sin-vendedor", label: "Clientes sin vendedor asignado", count: sinVendedorRes.count || 0, link: "/admin/vendedores", icono: UserX },
      { clave: "lotes-vencidos", label: "Lotes vencidos con existencia", count: vencidosRes.count || 0, link: "/admin/inventario?tab=lotes&lotes=vencidos", icono: CalendarX },
      { clave: "lotes-30", label: "Lotes que vencen en 30 días", count: porVencerRes.count || 0, link: "/admin/inventario?tab=lotes&lotes=30", icono: CalendarClock },
      { clave: "por-identificar", label: "Depósitos por identificar", count: porIdentificarRes.count || 0, link: "/admin/bancos", icono: Landmark },
      { clave: "despachos", label: "Entregas listas para despachar (Odoo)", count: despachosRes.count || 0, link: "/admin/transferencias?tipo=entrega&estado=lista", icono: Truck },
    ];

    setItems(lista);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const total = items.reduce((s, i) => s + i.count, 0);
  return { items, total, loading, refetch: fetchAll };
}
