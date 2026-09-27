import { useState, useEffect, useCallback } from "react";
import { VendedorLayout } from "@/components/vendedor/VendedorLayout";
import { Link, useNavigate } from "react-router-dom";
import { ShoppingCart, DollarSign, ArrowRight, Loader2 } from "lucide-react";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/contexts/CurrencyContext";

const VendedorDashboard = () => {
  const { user } = useAuth();
  const { formatPrice } = useCurrency();
  const navigate = useNavigate();
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


  return (
    <VendedorLayout title="Dashboard">
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-emerald-500" /></div>
      ) : (
        <div>
          <p className="mb-2 text-[13px] text-muted-foreground">Hola, <span className="font-medium text-foreground">{user?.nombre}</span> — resumen de tu cartera y ventas.</p>
          <KpiStrip items={[
            { label: "Mis clientes", valor: clientes, tono: "primario", onClick: () => navigate("/vendedor/clientes") },
            { label: "Pedidos activos", valor: pedidosPend, tono: pedidosPend ? "alerta" : "normal", onClick: () => navigate("/vendedor/pedidos") },
            { label: "Ventas del mes", valor: formatPrice(ventasMes), tono: "positivo", onClick: () => navigate("/vendedor/metas") },
            { label: "Saldo de cartera", valor: formatPrice(saldoCartera), tono: saldoCartera > 0 ? "negativo" : "normal", onClick: () => navigate("/vendedor/clientes") },
          ]} />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Link to="/vendedor/pedidos" className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5 transition-colors hover:bg-muted/50">
              <span className="flex items-center gap-2.5"><ShoppingCart className="h-4 w-4 text-emerald-500" /><span><span className="block text-[13px] font-medium">Tomar pedido</span><span className="block text-[11px] text-muted-foreground">Crear un pedido para un cliente</span></span></span>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </Link>
            <Link to="/vendedor/pagos" className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5 transition-colors hover:bg-muted/50">
              <span className="flex items-center gap-2.5"><DollarSign className="h-4 w-4 text-emerald-500" /><span><span className="block text-[13px] font-medium">Registrar cobro</span><span className="block text-[11px] text-muted-foreground">Reportar un pago recibido</span></span></span>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          </div>
        </div>
      )}
    </VendedorLayout>
  );
};

export default VendedorDashboard;
