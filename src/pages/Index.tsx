import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { StatCard } from "@/components/dashboard/StatCard";
import { RecentOrders } from "@/components/dashboard/RecentOrders";
import { TopClients } from "@/components/dashboard/TopClients";
import { Badge } from "@/components/ui/badge";
import { ShoppingCart, Users, Package, DollarSign, Loader2, Wallet, UserCog, PiggyBank, ListTodo } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { usePendingActions } from "@/hooks/use-pending-actions";

interface DashboardStats {
  ordenesHoy: number;
  ordenesAyer: number;
  clientesActivos: number;
  clientesNuevosSemana: number;
  totalProductos: number;
  productosBajoStock: number;
  ventasMes: number;
  ventasMesAnterior: number;
  deudaTotal: number;
  clientesConDeuda: number;
  carteraVendedores: number;
  anticiposSinAplicar: number;
}

const Index = () => {
  const [stats, setStats] = useState<DashboardStats>({
    ordenesHoy: 0,
    ordenesAyer: 0,
    clientesActivos: 0,
    clientesNuevosSemana: 0,
    totalProductos: 0,
    productosBajoStock: 0,
    ventasMes: 0,
    ventasMesAnterior: 0,
    deudaTotal: 0,
    clientesConDeuda: 0,
    carteraVendedores: 0,
    anticiposSinAplicar: 0,
  });
  const [loading, setLoading] = useState(true);
  const { formatPrice } = useCurrency();
  const navigate = useNavigate();
  const { items: pendientes, total: totalPendientes, loading: loadingPendientes } = usePendingActions();

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    setLoading(true);
    
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
    const startOfYesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1).toISOString();
    const startOfWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7).toISOString();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();
    const startOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString();
    const endOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0).toISOString();

    const [
      ordenesHoyRes,
      ordenesAyerRes,
      clientesRes,
      clientesNuevosRes,
      productosRes,
      bajoStockRes,
      ventasMesRes,
      ventasMesAnteriorRes,
      facturasRes,
      clientesVendedorRes,
      anticiposRes,
    ] = await Promise.all([
      // Órdenes de hoy
      supabase.from('ordenes').select('id', { count: 'exact' }).gte('created_at', startOfToday),
      // Órdenes de ayer
      supabase.from('ordenes').select('id', { count: 'exact' }).gte('created_at', startOfYesterday).lt('created_at', startOfToday),
      // Clientes activos
      supabase.from('clientes').select('id', { count: 'exact' }).eq('activo', true),
      // Clientes nuevos esta semana
      supabase.from('clientes').select('id', { count: 'exact' }).gte('created_at', startOfWeek),
      // Total productos
      supabase.from('productos').select('id', { count: 'exact' }).eq('activo', true),
      // Productos bajo stock
      supabase.from('productos').select('id', { count: 'exact' }).lt('stock_actual', 10).eq('activo', true),
      // Ventas del mes
      supabase.from('ordenes').select('total').gte('created_at', startOfMonth),
      // Ventas mes anterior
      supabase.from('ordenes').select('total').gte('created_at', startOfLastMonth).lt('created_at', startOfMonth),
      // Deuda real (Fase 11): suma de facturas.saldo_usd, igual que Cuentas.tsx
      supabase.from('facturas').select('cliente_id, saldo_usd').eq('estado', 'posted'),
      // Cartera gestionada por vendedores (Fase 14): clientes con vendedor asignado
      supabase.from('clientes').select('id').eq('activo', true).not('vendedor_asignado_id', 'is', null),
      // Anticipos sin aplicar (Fase 11), igual que CuentasPorCobrar.tsx
      supabase.from('v_anticipos').select('disponible'),
    ]);

    const ventasMes = ventasMesRes.data?.reduce((sum, o) => sum + (o.total || 0), 0) || 0;
    const ventasMesAnterior = ventasMesAnteriorRes.data?.reduce((sum, o) => sum + (o.total || 0), 0) || 0;

    const saldoPorCliente = new Map<string, number>();
    for (const f of (facturasRes.data as { cliente_id: string; saldo_usd: number }[]) ?? []) {
      saldoPorCliente.set(f.cliente_id, (saldoPorCliente.get(f.cliente_id) || 0) + Number(f.saldo_usd));
    }
    const deudaTotal = [...saldoPorCliente.values()].reduce((s, v) => s + v, 0);
    const clientesConDeuda = [...saldoPorCliente.values()].filter((v) => v > 0.009).length;

    const idsConVendedor = new Set((clientesVendedorRes.data as { id: string }[] ?? []).map((c) => c.id));
    const carteraVendedores = [...saldoPorCliente.entries()].filter(([id]) => idsConVendedor.has(id)).reduce((s, [, v]) => s + v, 0);

    const anticiposSinAplicar = ((anticiposRes.data as { disponible: number }[] ?? [])).reduce((s, a) => s + Number(a.disponible), 0);

    setStats({
      ordenesHoy: ordenesHoyRes.count || 0,
      ordenesAyer: ordenesAyerRes.count || 0,
      clientesActivos: clientesRes.count || 0,
      clientesNuevosSemana: clientesNuevosRes.count || 0,
      totalProductos: productosRes.count || 0,
      productosBajoStock: bajoStockRes.count || 0,
      ventasMes,
      ventasMesAnterior,
      deudaTotal,
      clientesConDeuda,
      carteraVendedores,
      anticiposSinAplicar,
    });
    setLoading(false);
  };

  const getOrdenesChange = () => {
    if (stats.ordenesAyer === 0) return { text: "Sin datos de ayer", type: "neutral" as const };
    const change = ((stats.ordenesHoy - stats.ordenesAyer) / stats.ordenesAyer * 100).toFixed(0);
    return {
      text: `${Number(change) >= 0 ? '+' : ''}${change}% vs ayer`,
      type: Number(change) >= 0 ? "positive" as const : "negative" as const,
    };
  };

  const getVentasChange = () => {
    if (stats.ventasMesAnterior === 0) return { text: "Sin datos previos", type: "neutral" as const };
    const change = ((stats.ventasMes - stats.ventasMesAnterior) / stats.ventasMesAnterior * 100).toFixed(1);
    return {
      text: `${Number(change) >= 0 ? '+' : ''}${change}% vs mes anterior`,
      type: Number(change) >= 0 ? "positive" as const : "negative" as const,
    };
  };

  if (loading) {
    return (
      <MainLayout title="Dashboard">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout title="Dashboard">
      {/* Stats Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Órdenes Hoy"
          value={stats.ordenesHoy.toString()}
          change={getOrdenesChange().text}
          changeType={getOrdenesChange().type}
          icon={ShoppingCart}
        />
        <StatCard
          title="Clientes Activos"
          value={stats.clientesActivos.toString()}
          change={`+${stats.clientesNuevosSemana} nuevos esta semana`}
          changeType="positive"
          icon={Users}
        />
        <StatCard
          title="Productos"
          value={stats.totalProductos.toString()}
          change={`${stats.productosBajoStock} bajo stock`}
          changeType={stats.productosBajoStock > 0 ? "negative" : "positive"}
          icon={Package}
        />
        <StatCard
          title="Ventas del Mes"
          value={formatPrice(stats.ventasMes)}
          change={getVentasChange().text}
          changeType={getVentasChange().type}
          icon={DollarSign}
        />
      </div>

      {/* Stats Grid — módulos financieros (Fases 11-14) */}
      <div className="mt-6 grid gap-6 md:grid-cols-3">
        <StatCard
          title="Deuda por Cobrar"
          value={formatPrice(stats.deudaTotal)}
          change={`${stats.clientesConDeuda} cliente(s) con deuda`}
          changeType={stats.clientesConDeuda > 0 ? "negative" : "positive"}
          icon={Wallet}
        />
        <StatCard
          title="Cartera de Vendedores"
          value={formatPrice(stats.carteraVendedores)}
          change="Gestionada por vendedores"
          changeType="neutral"
          icon={UserCog}
        />
        <StatCard
          title="Anticipos sin Aplicar"
          value={formatPrice(stats.anticiposSinAplicar)}
          change="Pagos con saldo a favor"
          changeType="neutral"
          icon={PiggyBank}
        />
      </div>

      {/* Charts and Tables */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <RecentOrders />
        <TopClients />
      </div>

      {/* Acciones pendientes — misma fuente que la Torre de Control */}
      <div className="mt-6 rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <ListTodo className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">Acciones pendientes</h2>
          {totalPendientes > 0 && <Badge variant="destructive">{totalPendientes}</Badge>}
        </div>
        {loadingPendientes ? (
          <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : totalPendientes === 0 ? (
          <p className="text-sm text-muted-foreground">Todo al día — nada pendiente por revisar.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {pendientes.filter((p) => p.count > 0).map((p) => (
              <button
                key={p.clave}
                onClick={() => navigate(p.link)}
                className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-left text-sm hover:bg-muted/60"
              >
                <p.icono className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate">{p.label}</span>
                <Badge variant="secondary">{p.count}</Badge>
              </button>
            ))}
          </div>
        )}
      </div>
    </MainLayout>
  );
};

export default Index;
