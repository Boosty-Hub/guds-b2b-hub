import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Cifras del vendedor con una sola fuente: la función del servidor resumen_vendedor() (misma definición que el admin:
// deuda desde facturas, ventas = documentos de venta del reporte, cobros verificados sin IGTF). Solo su cartera.
export interface ResumenVendedor {
  hoy: string;
  mes_desde: string;
  mes_hasta: string;
  clientes: number;
  clientes_por_empresa: Record<string, number>;
  cartera: {
    por_cobrar: number; a_favor: number; neto: number; vencido: number; facturas: number;
    clientes_con_saldo: number; clientes_a_favor: number; clientes_excedidos: number;
    tramos: { por_vencer: number; d1_30: number; d31_60: number; d61_90: number; mas_90: number };
  };
  /** neto incluye las notas de entrega del mes (lo no facturado, 22k), que también vienen aparte */
  ventas_mes: { neto: number; facturas: number; notas_credito: number; notas_entrega?: number };
  /** Meta del mes cargada por administración (suma de las empresas visibles); la venta real es ventas_mes.neto. */
  meta_mes?: { meta: number; cargada: boolean };
  pedidos: { total: number; abiertos: number; por_aprobar: number; rechazados: number; mes_n: number; mes_monto: number };
  cobros: {
    total: number; pendientes_n: number; pendientes_monto: number;
    verificados_mes_n: number; verificados_mes_monto: number; rechazados_mes_n: number;
  };
  detalle: { cliente_id: string; por_cobrar: number; a_favor: number; vencido: number; facturas: number; dias_mora: number }[] | null;
}

/** Resumen del vendedor; con `detalle` trae también la deuda por cliente. */
export function useResumenVendedor(detalle = false) {
  const [resumen, setResumen] = useState<ResumenVendedor | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const recargar = useCallback(async () => {
    setCargando(true);
    const { data, error: e } = await supabase.rpc("resumen_vendedor", { p_detalle: detalle });
    if (e) setError(e.message);
    else { setResumen(data as ResumenVendedor); setError(null); }
    setCargando(false);
  }, [detalle]);

  useEffect(() => { recargar(); }, [recargar]);

  return { resumen, cargando, error, recargar };
}

/** Nombre del mes del resumen ("septiembre"), para rotular las cifras del mes. */
export const mesDe = (r: ResumenVendedor | null) =>
  r ? new Date(`${r.mes_desde}T12:00:00`).toLocaleDateString("es-VE", { month: "long" }) : "";
