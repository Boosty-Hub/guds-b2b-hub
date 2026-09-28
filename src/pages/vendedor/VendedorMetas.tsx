import { useState, useEffect, useCallback } from "react";
import { VendedorLayout } from "@/components/vendedor/VendedorLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Target, TrendingUp, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useResumenVendedor, mesDe } from "@/components/vendedor/resumen";

interface Meta { meta_ventas: number; ventas_actuales: number; comision_porcentaje: number; comision_ganada: number; }

const VendedorMetas = () => {
  const { user } = useAuth();
  const { formatPrice } = useCurrency();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  // Ventas y pedidos del mes desde resumen_vendedor(): ventas = facturado a sus clientes (neto de IVA y de notas de
  // crédito, como el reporte de ventas del admin), en el mes de Caracas. Misma cifra que el Dashboard.
  const { resumen, cargando } = useResumenVendedor();
  const ventasMes = Number(resumen?.ventas_mes.neto ?? 0);
  const pedidosMes = Number(resumen?.pedidos.mes_n ?? 0);

  const fetchData = useCallback(async () => {
    if (!user?.id) return;
    if (!resumen) { if (!cargando) setLoading(false); return; }
    setLoading(true);
    const [anio, mes] = resumen.mes_desde.split("-").map(Number);
    const { data } = await supabase.from("metas_vendedor").select("meta_ventas, ventas_actuales, comision_porcentaje, comision_ganada")
      .eq("vendedor_id", user.id).eq("mes", mes).eq("anio", anio).maybeSingle();
    setMeta((data as Meta | null) ?? null);
    setLoading(false);
  }, [user?.id, resumen, cargando]);
  useEffect(() => { fetchData(); }, [fetchData]);

  const metaVentas = Number(meta?.meta_ventas || 0);
  const progreso = metaVentas > 0 ? Math.min(100, Math.round((ventasMes / metaVentas) * 100)) : 0;
  const restante = Math.max(0, metaVentas - ventasMes);

  return (
    <VendedorLayout title="Mis Metas">
      {loading || cargando ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-emerald-500" /></div>
      ) : (
        <div className="space-y-6">
          <Card className="border-border">
            <CardContent className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Target className="h-5 w-5 text-emerald-500" />
                <h2 className="text-lg font-semibold">Meta del mes</h2>
              </div>
              {metaVentas > 0 ? (
                <>
                  <div className="grid grid-cols-3 gap-4 mb-4 text-center">
                    <div><p className="text-sm text-muted-foreground">Meta</p><p className="text-base font-semibold">{formatPrice(metaVentas)}</p></div>
                    <div><p className="text-sm text-muted-foreground">Logrado</p><p className="text-base font-semibold text-emerald-600">{formatPrice(ventasMes)}</p></div>
                    <div><p className="text-sm text-muted-foreground">Restante</p><p className="text-base font-semibold">{formatPrice(restante)}</p></div>
                  </div>
                  <Progress value={progreso} className="h-3" />
                  <p className="text-sm text-muted-foreground mt-2">{progreso}% completado</p>
                </>
              ) : (
                <div className="text-center py-6">
                  <p className="text-muted-foreground mb-2">Aún no tienes una meta definida para este mes.</p>
                  <p className="text-sm text-muted-foreground">Facturado a tus clientes en {mesDe(resumen)}: <span className="font-semibold text-emerald-600">{formatPrice(ventasMes)}</span></p>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="border-border"><CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-emerald-500/10 flex items-center justify-center"><TrendingUp className="h-5 w-5 text-emerald-500" /></div>
              <div><p className="text-lg font-semibold">{formatPrice(ventasMes)}</p><p className="text-sm text-muted-foreground">Facturado en {mesDe(resumen)} (neto)</p></div>
            </CardContent></Card>
            <Card className="border-border"><CardContent className="p-4"><p className="text-lg font-semibold">{pedidosMes}</p><p className="text-sm text-muted-foreground">Pedidos de {mesDe(resumen)}</p></CardContent></Card>
            <Card className="border-border"><CardContent className="p-4"><p className="text-lg font-semibold">{meta ? formatPrice(Number(meta.comision_ganada || 0)) : "—"}</p><p className="text-sm text-muted-foreground">Comisión ganada</p></CardContent></Card>
          </div>
        </div>
      )}
    </VendedorLayout>
  );
};

export default VendedorMetas;
