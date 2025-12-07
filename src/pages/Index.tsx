import { MainLayout } from "@/components/layout/MainLayout";
import { StatCard } from "@/components/dashboard/StatCard";
import { RecentOrders } from "@/components/dashboard/RecentOrders";
import { TopClients } from "@/components/dashboard/TopClients";
import { ShoppingCart, Users, Package, DollarSign } from "lucide-react";

const Index = () => {
  return (
    <MainLayout title="Dashboard">
      {/* Stats Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Órdenes Hoy"
          value="24"
          change="+12% vs ayer"
          changeType="positive"
          icon={ShoppingCart}
        />
        <StatCard
          title="Clientes Activos"
          value="156"
          change="+3 nuevos esta semana"
          changeType="positive"
          icon={Users}
        />
        <StatCard
          title="Productos"
          value="482"
          change="15 bajo stock"
          changeType="negative"
          icon={Package}
        />
        <StatCard
          title="Ventas del Mes"
          value="$245,680"
          change="+18.5% vs mes anterior"
          changeType="positive"
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
