import { PortalLayout } from "@/components/portal/PortalLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShoppingCart, Package, Clock, CreditCard, ArrowRight, TrendingUp } from "lucide-react";
import { Link } from "react-router-dom";

const recentOrders = [
  { id: "ORD-045", date: "2024-01-15", items: 12, total: "$2,450.00", status: "enviado" },
  { id: "ORD-044", date: "2024-01-12", items: 8, total: "$1,890.00", status: "completado" },
  { id: "ORD-043", date: "2024-01-10", items: 15, total: "$3,200.00", status: "completado" },
];

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  pendiente: { label: "Pendiente", variant: "secondary" },
  procesando: { label: "Procesando", variant: "default" },
  enviado: { label: "Enviado", variant: "outline" },
  completado: { label: "Completado", variant: "default" },
};

const PortalDashboard = () => {
  return (
    <PortalLayout title="Bienvenido">
      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
        <Card className="border-border">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Pedidos Activos</p>
                <p className="text-2xl font-bold text-foreground">3</p>
              </div>
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Package className="h-6 w-6 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="border-border">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">En Tránsito</p>
                <p className="text-2xl font-bold text-foreground">1</p>
              </div>
              <div className="h-12 w-12 rounded-full bg-blue-500/10 flex items-center justify-center">
                <Clock className="h-6 w-6 text-blue-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Saldo Pendiente</p>
                <p className="text-2xl font-bold text-foreground">$4,500.00</p>
              </div>
              <div className="h-12 w-12 rounded-full bg-amber-500/10 flex items-center justify-center">
                <CreditCard className="h-6 w-6 text-amber-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Compras del Mes</p>
                <p className="text-2xl font-bold text-foreground">$12,340</p>
              </div>
              <div className="h-12 w-12 rounded-full bg-green-500/10 flex items-center justify-center">
                <TrendingUp className="h-6 w-6 text-green-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Quick Actions */}
        <Card className="border-border lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-lg">Acciones Rápidas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Link to="/portal/catalogo">
              <Button className="w-full justify-start gap-3" size="lg">
                <ShoppingCart className="h-5 w-5" />
                Nuevo Pedido
              </Button>
            </Link>
            <Link to="/portal/pedidos">
              <Button variant="outline" className="w-full justify-start gap-3" size="lg">
                <Package className="h-5 w-5" />
                Ver Mis Pedidos
              </Button>
            </Link>
            <Link to="/portal/pagos">
              <Button variant="outline" className="w-full justify-start gap-3" size="lg">
                <CreditCard className="h-5 w-5" />
                Registrar Pago
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* Recent Orders */}
        <Card className="border-border lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Pedidos Recientes</CardTitle>
            <Link to="/portal/pedidos">
              <Button variant="ghost" size="sm" className="gap-1">
                Ver todos <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentOrders.map((order) => (
                <div
                  key={order.id}
                  className="flex items-center justify-between rounded-lg border border-border p-4 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <Package className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{order.id}</p>
                      <p className="text-sm text-muted-foreground">
                        {order.items} productos • {order.date}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <Badge variant={statusConfig[order.status].variant}>
                      {statusConfig[order.status].label}
                    </Badge>
                    <p className="font-semibold text-foreground">{order.total}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </PortalLayout>
  );
};

export default PortalDashboard;
