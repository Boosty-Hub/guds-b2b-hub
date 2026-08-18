import { useState, useEffect, useCallback } from "react";
import { VendedorLayout } from "@/components/vendedor/VendedorLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { Users, ShoppingCart, DollarSign, Target, ArrowRight, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/contexts/CurrencyContext";

const VendedorDashboard = () => {
  const { user } = useAuth();
  const { formatPrice } = useCurrency();
  const [clientes, setClientes] = useState(0);
  const [pedidosPend, setPedidosPend] = useState(0);
  const [ventasMes, setVentasMes] = useState(0);
  const [saldoCartera, setSaldoCartera] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    // Solo los clientes asignados a este vendedor
    const { data: cli } = await supabase.from("clientes").select("id").eq("activo", true).eq("vendedor_asignado_id", user.id);
    const ids = (cli ?? []).map((c: { id: string }) => c.id);
    setClientes(ids.length);
    if (ids.length === 0) { setPedidosPend(0); setVentasMes(0); setSaldoCartera(0); setLoading(false); return; }

    const [oRes, facRes] = await Promise.all([
      supabase.from("ordenes").select("total, estado, created_at").in("cliente_id", ids).neq("estado", "cancelado"),
      // Deuda real = suma de facturas.saldo_usd (Fase 11 — ordenes/cuentas_cobrar quedaron deprecadas)
      supabase.from("facturas").select("saldo_usd").in("cliente_id", ids).eq("estado", "posted"),
    ]);
    let saldo = 0, pend = 0, ventas = 0;
    for (const o of (oRes.data ?? []) as { total: number; estado: string; created_at: string }[]) {
      if (["pendiente", "confirmado", "procesando", "enviado"].includes(o.estado)) pend++;
      if (o.estado === "completado" && o.created_at >= inicioMes) ventas += Number(o.total);
    }
    for (const f of (facRes.data ?? []) as { saldo_usd: number }[]) {
      saldo += Number(f.saldo_usd);
    }
    setPedidosPend(pend);
    setVentasMes(ventas);
    setSaldoCartera(Math.max(0, saldo));
    setLoading(false);
  }, [user?.id]);
  useEffect(() => { fetchData(); }, [fetchData]);

  const stat = (icon: React.ReactNode, val: string | number, label: string, cls: string) => (
    <Card className="border-border"><CardContent className="p-4 flex items-center gap-3">
      <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${cls}`}>{icon}</div>
      <div><p className="text-2xl font-bold">{val}</p><p className="text-sm text-muted-foreground">{label}</p></div>
    </CardContent></Card>
  );

  return (
    <VendedorLayout title="Dashboard">
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-emerald-500" /></div>
      ) : (
        <div className="space-y-6">
          <div>
            <h2 className="text-lg font-semibold">Hola, {user?.nombre} 👋</h2>
            <p className="text-muted-foreground">Resumen de tu cartera y ventas.</p>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {stat(<Users className="h-5 w-5 text-emerald-500" />, clientes, "Mis clientes", "bg-emerald-500/10")}
            {stat(<ShoppingCart className="h-5 w-5 text-primary" />, pedidosPend, "Pedidos activos", "bg-primary/10")}
            {stat(<DollarSign className="h-5 w-5 text-green-600" />, formatPrice(ventasMes), "Ventas del mes", "bg-green-500/10")}
            {stat(<Target className="h-5 w-5 text-amber-600" />, formatPrice(saldoCartera), "Saldo cartera", "bg-amber-500/10")}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card className="border-border"><CardContent className="p-5 flex items-center justify-between">
              <div className="flex items-center gap-3"><ShoppingCart className="h-6 w-6 text-emerald-500" /><div><p className="font-medium">Tomar pedido</p><p className="text-sm text-muted-foreground">Crear un pedido para un cliente</p></div></div>
              <Button asChild variant="outline"><Link to="/vendedor/pedidos">Ir <ArrowRight className="h-4 w-4 ml-1" /></Link></Button>
            </CardContent></Card>
            <Card className="border-border"><CardContent className="p-5 flex items-center justify-between">
              <div className="flex items-center gap-3"><DollarSign className="h-6 w-6 text-emerald-500" /><div><p className="font-medium">Registrar cobro</p><p className="text-sm text-muted-foreground">Reportar un pago recibido</p></div></div>
              <Button asChild variant="outline"><Link to="/vendedor/pagos">Ir <ArrowRight className="h-4 w-4 ml-1" /></Link></Button>
            </CardContent></Card>
          </div>
        </div>
      )}
    </VendedorLayout>
  );
};

export default VendedorDashboard;
