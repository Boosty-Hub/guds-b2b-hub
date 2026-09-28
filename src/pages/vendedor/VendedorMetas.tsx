import { VendedorLayout } from "@/components/vendedor/VendedorLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Target, TrendingUp, Loader2 } from "lucide-react";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useResumenVendedor, mesDe } from "@/components/vendedor/resumen";

// Metas del vendedor: la meta del mes la carga administración (Vendedores → Metas, por empresa) y la venta real es la de
// resumen_vendedor(): facturado a sus clientes en el mes de Caracas, neto de IVA y de notas de crédito (como el reporte de
// ventas). Todo sale de la misma función, así meta, avance y el tablero "Hoy" coinciden.
const VendedorMetas = () => {
  const { formatPrice } = useCurrency();
  const { resumen, cargando, error } = useResumenVendedor();
  const ventasMes = Number(resumen?.ventas_mes.neto ?? 0);
  const pedidosMes = Number(resumen?.pedidos.mes_n ?? 0);
  const metaVentas = Number(resumen?.meta_mes?.meta ?? 0);
  const progreso = metaVentas > 0 ? Math.round((ventasMes / metaVentas) * 100) : 0;
  const restante = Math.max(0, metaVentas - ventasMes);

  return (
    <VendedorLayout title="Mis Metas">
      {cargando ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-emerald-500" /></div>
      ) : (
        <div className="space-y-4">
          {error && <p className="text-sm text-destructive">No se pudo cargar el resumen: {error}</p>}
          <Card className="border-border">
            <CardContent className="p-4 sm:p-6">
              <div className="mb-4 flex items-center gap-2">
                <Target className="h-5 w-5 text-emerald-500" />
                <h2 className="text-lg font-semibold">Meta de {mesDe(resumen)}</h2>
              </div>
              {metaVentas > 0 ? (
                <div data-testid="meta-cargada">
                  <div className="mb-4 grid grid-cols-3 gap-2 text-center sm:gap-4">
                    <div><p className="text-sm text-muted-foreground">Meta</p><p className="text-base font-semibold tabular-nums">{formatPrice(metaVentas)}</p></div>
                    <div><p className="text-sm text-muted-foreground">Logrado</p><p className="text-base font-semibold tabular-nums text-emerald-600">{formatPrice(ventasMes)}</p></div>
                    <div><p className="text-sm text-muted-foreground">Restante</p><p className="text-base font-semibold tabular-nums">{formatPrice(restante)}</p></div>
                  </div>
                  <Progress value={Math.min(100, progreso)} className="h-3" />
                  <p className="mt-2 text-sm text-muted-foreground">{progreso}% de la meta{progreso >= 100 ? " · ¡meta cumplida!" : ""}</p>
                </div>
              ) : (
                <div className="py-6 text-center" data-testid="sin-meta">
                  <p className="mb-2 text-muted-foreground">Administración aún no cargó tu meta de este mes.</p>
                  <p className="text-sm text-muted-foreground">Facturado a tus clientes en {mesDe(resumen)}: <span className="font-semibold text-emerald-600">{formatPrice(ventasMes)}</span></p>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Card className="border-border"><CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10"><TrendingUp className="h-5 w-5 text-emerald-500" /></div>
              <div><p className="text-lg font-semibold tabular-nums">{formatPrice(ventasMes)}</p><p className="text-sm text-muted-foreground">Facturado en {mesDe(resumen)} (neto de IVA) · {resumen?.ventas_mes.facturas ?? 0} facturas</p></div>
            </CardContent></Card>
            <Card className="border-border"><CardContent className="p-4"><p className="text-lg font-semibold tabular-nums">{pedidosMes}</p><p className="text-sm text-muted-foreground">Pedidos de {mesDe(resumen)}</p></CardContent></Card>
          </div>
        </div>
      )}
    </VendedorLayout>
  );
};

export default VendedorMetas;
