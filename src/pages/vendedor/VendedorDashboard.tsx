import { VendedorLayout } from "@/components/vendedor/VendedorLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  Target, 
  Users, 
  DollarSign, 
  TrendingUp, 
  ArrowRight, 
  ShoppingCart,
  CreditCard,
  AlertCircle
} from "lucide-react";
import { Link } from "react-router-dom";
import { useCurrency } from "@/contexts/CurrencyContext";

const recentActivity = [
  { id: 1, type: "pedido", client: "Walmart Centro", amount: 12500, time: "Hace 2 horas" },
  { id: 2, type: "pago", client: "Soriana Norte", amount: 8200, time: "Hace 5 horas" },
  { id: 3, type: "pedido", client: "OXXO Zona 5", amount: 3400, time: "Ayer" },
];

const clientsNeedingAttention = [
  { id: 1, name: "Bodega Aurrera", issue: "Crédito al 90%", urgency: "high" },
  { id: 2, name: "Chedraui Express", issue: "Pago vencido", urgency: "high" },
  { id: 3, name: "7-Eleven Centro", issue: "Sin pedidos (15 días)", urgency: "medium" },
];

const VendedorDashboard = () => {
  const { formatPrice } = useCurrency();
  const metaMensual = 150000;
  const ventasActuales = 98500;
  const porcentajeMeta = (ventasActuales / metaMensual) * 100;

  return (
    <VendedorLayout title="Dashboard">
      {/* Meta Progress Card */}
      <Card className="border-border mb-6 bg-gradient-to-r from-emerald-500/10 to-emerald-500/5">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm text-muted-foreground">Meta del Mes - Diciembre 2024</p>
              <p className="text-3xl font-bold text-foreground">
                {formatPrice(ventasActuales)} 
                <span className="text-lg font-normal text-muted-foreground"> / {formatPrice(metaMensual)}</span>
              </p>
            </div>
            <div className="h-16 w-16 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <Target className="h-8 w-8 text-emerald-500" />
            </div>
          </div>
          <Progress value={porcentajeMeta} className="h-3 mb-2" />
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{porcentajeMeta.toFixed(1)}% completado</span>
            <span className="text-emerald-500 font-medium">
              Faltan {formatPrice(metaMensual - ventasActuales)}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4 mb-6">
        <Card className="border-border">
          <CardContent className="p-4 md:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs md:text-sm text-muted-foreground">Clientes</p>
                <p className="text-xl md:text-2xl font-bold text-foreground">12</p>
              </div>
              <div className="h-10 w-10 md:h-12 md:w-12 rounded-full bg-blue-500/10 flex items-center justify-center">
                <Users className="h-5 w-5 md:h-6 md:w-6 text-blue-500" />
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="border-border">
          <CardContent className="p-4 md:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs md:text-sm text-muted-foreground">Pedidos</p>
                <p className="text-xl md:text-2xl font-bold text-foreground">28</p>
              </div>
              <div className="h-10 w-10 md:h-12 md:w-12 rounded-full bg-purple-500/10 flex items-center justify-center">
                <ShoppingCart className="h-5 w-5 md:h-6 md:w-6 text-purple-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardContent className="p-4 md:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs md:text-sm text-muted-foreground">Pagos</p>
                <p className="text-lg md:text-2xl font-bold text-foreground">{formatPrice(45200)}</p>
              </div>
              <div className="h-10 w-10 md:h-12 md:w-12 rounded-full bg-green-500/10 flex items-center justify-center">
                <CreditCard className="h-5 w-5 md:h-6 md:w-6 text-green-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardContent className="p-4 md:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs md:text-sm text-muted-foreground">Comisión</p>
                <p className="text-lg md:text-2xl font-bold text-foreground">{formatPrice(4925)}</p>
              </div>
              <div className="h-10 w-10 md:h-12 md:w-12 rounded-full bg-amber-500/10 flex items-center justify-center">
                <DollarSign className="h-5 w-5 md:h-6 md:w-6 text-amber-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:gap-6 lg:grid-cols-3">
        {/* Quick Actions */}
        <Card className="border-border lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-lg">Acciones Rápidas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Link to="/vendedor/pedidos">
              <Button className="w-full justify-start gap-3 bg-emerald-500 hover:bg-emerald-600" size="lg">
                <ShoppingCart className="h-5 w-5" />
                Nuevo Pedido
              </Button>
            </Link>
            <Link to="/vendedor/pagos">
              <Button variant="outline" className="w-full justify-start gap-3" size="lg">
                <CreditCard className="h-5 w-5" />
                Registrar Pago
              </Button>
            </Link>
            <Link to="/vendedor/clientes">
              <Button variant="outline" className="w-full justify-start gap-3" size="lg">
                <Users className="h-5 w-5" />
                Ver Clientes
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* Clients Needing Attention */}
        <Card className="border-border lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-500" />
              Clientes que Requieren Atención
            </CardTitle>
            <Link to="/vendedor/clientes">
              <Button variant="ghost" size="sm" className="gap-1">
                Ver todos <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {clientsNeedingAttention.map((client) => (
                <div
                  key={client.id}
                  className="flex items-center justify-between rounded-lg border border-border p-4 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className={`h-10 w-10 rounded-full flex items-center justify-center ${
                      client.urgency === "high" ? "bg-red-500/10" : "bg-amber-500/10"
                    }`}>
                      <AlertCircle className={`h-5 w-5 ${
                        client.urgency === "high" ? "text-red-500" : "text-amber-500"
                      }`} />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{client.name}</p>
                      <p className="text-sm text-muted-foreground">{client.issue}</p>
                    </div>
                  </div>
                  <Badge variant={client.urgency === "high" ? "destructive" : "secondary"}>
                    {client.urgency === "high" ? "Urgente" : "Atención"}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <Card className="border-border mt-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Actividad Reciente</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {recentActivity.map((activity) => (
              <div
                key={activity.id}
                className="flex items-center justify-between rounded-lg border border-border p-4 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className={`h-10 w-10 rounded-full flex items-center justify-center ${
                    activity.type === "pedido" ? "bg-purple-500/10" : "bg-green-500/10"
                  }`}>
                    {activity.type === "pedido" ? (
                      <ShoppingCart className="h-5 w-5 text-purple-500" />
                    ) : (
                      <CreditCard className="h-5 w-5 text-green-500" />
                    )}
                  </div>
                  <div>
                    <p className="font-medium text-foreground">
                      {activity.type === "pedido" ? "Pedido creado" : "Pago registrado"}
                    </p>
                    <p className="text-sm text-muted-foreground">{activity.client}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-foreground">{formatPrice(activity.amount)}</p>
                  <p className="text-xs text-muted-foreground">{activity.time}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </VendedorLayout>
  );
};

export default VendedorDashboard;
