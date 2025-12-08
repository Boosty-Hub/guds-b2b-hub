import { useState, useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { StatCard } from "@/components/dashboard/StatCard";
import { RecentOrders } from "@/components/dashboard/RecentOrders";
import { TopClients } from "@/components/dashboard/TopClients";
import { ShoppingCart, Users, Package, DollarSign, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";

interface DashboardStats {
  ordenesHoy: number;
  ordenesAyer: number;
  clientesActivos: number;
  clientesNuevosSemana: number;
  totalProductos: number;
  productosBajoStock: number;
  ventasMes: number;
  ventasMesAnterior: number;
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
  });
  const [loading, setLoading] = useState(true);
  const { formatPrice } = useCurrency();

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
      supabase.from('productos').select('id', { count: 'exact' }).lt('stock', 10).eq('activo', true),
      // Ventas del mes
      supabase.from('ordenes').select('total').gte('created_at', startOfMonth),
      // Ventas mes anterior
      supabase.from('ordenes').select('total').gte('created_at', startOfLastMonth).lt('created_at', startOfMonth),
    ]);

    const ventasMes = ventasMesRes.data?.reduce((sum, o) => sum + (o.total || 0), 0) || 0;
    const ventasMesAnterior = ventasMesAnteriorRes.data?.reduce((sum, o) => sum + (o.total || 0), 0) || 0;

    setStats({
      ordenesHoy: ordenesHoyRes.count || 0,
      ordenesAyer: ordenesAyerRes.count || 0,
      clientesActivos: clientesRes.count || 0,
      clientesNuevosSemana: clientesNuevosRes.count || 0,
      totalProductos: productosRes.count || 0,
      productosBajoStock: bajoStockRes.count || 0,
      ventasMes,
      ventasMesAnterior,
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

      {/* Charts and Tables */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <RecentOrders />
        <TopClients />
      </div>
    </MainLayout>
  );
};

export default Index;
