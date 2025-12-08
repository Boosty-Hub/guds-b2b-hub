import { DeliveryLayout } from "@/components/delivery/DeliveryLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  Package, 
  CheckCircle, 
  Clock, 
  MapPin,
  Navigation,
  Phone,
  ArrowRight,
  Truck
} from "lucide-react";
import { Link } from "react-router-dom";

const proximasEntregas = [
  { 
    id: "ENV-001", 
    cliente: "Walmart Centro", 
    direccion: "Av. Insurgentes Sur 1234", 
    hora: "10:30 AM",
    productos: 12,
    prioridad: "alta"
  },
  { 
    id: "ENV-002", 
    cliente: "Soriana Norte", 
    direccion: "Blvd. Manuel Ávila Camacho 500", 
    hora: "11:15 AM",
    productos: 8,
    prioridad: "normal"
  },
  { 
    id: "ENV-003", 
    cliente: "OXXO Zona 5", 
    direccion: "Av. Universidad 1500", 
    hora: "12:00 PM",
    productos: 5,
    prioridad: "normal"
  },
];

const DeliveryDashboard = () => {
  const entregasHoy = 8;
  const entregasCompletadas = 3;
  const porcentajeCompletado = (entregasCompletadas / entregasHoy) * 100;

  return (
    <DeliveryLayout title="Dashboard">
      {/* Progress Card */}
      <Card className="border-border mb-6 bg-gradient-to-r from-amber-500/10 to-amber-500/5">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm text-muted-foreground">Progreso del Día</p>
              <p className="text-3xl font-bold text-foreground">
                {entregasCompletadas} de {entregasHoy} entregas
              </p>
            </div>
            <div className="h-16 w-16 rounded-full bg-amber-500/20 flex items-center justify-center">
              <Truck className="h-8 w-8 text-amber-500" />
            </div>
          </div>
          <Progress value={porcentajeCompletado} className="h-3 mb-2" />
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{porcentajeCompletado.toFixed(0)}% completado</span>
            <span className="text-amber-500 font-medium">
              {entregasHoy - entregasCompletadas} pendientes
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:gap-4 md:grid-cols-4 mb-6">
        <Card className="border-border">
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 md:h-10 md:w-10 rounded-full bg-blue-500/10 flex items-center justify-center">
                <Package className="h-4 w-4 md:h-5 md:w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-xl md:text-2xl font-bold">{entregasHoy}</p>
                <p className="text-xs text-muted-foreground">Asignadas</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 md:h-10 md:w-10 rounded-full bg-amber-500/10 flex items-center justify-center">
                <Clock className="h-4 w-4 md:h-5 md:w-5 text-amber-500" />
              </div>
              <div>
                <p className="text-xl md:text-2xl font-bold">{entregasHoy - entregasCompletadas}</p>
                <p className="text-xs text-muted-foreground">Pendientes</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 md:h-10 md:w-10 rounded-full bg-green-500/10 flex items-center justify-center">
                <CheckCircle className="h-4 w-4 md:h-5 md:w-5 text-green-500" />
              </div>
              <div>
                <p className="text-xl md:text-2xl font-bold">{entregasCompletadas}</p>
                <p className="text-xs text-muted-foreground">Completadas</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 md:h-10 md:w-10 rounded-full bg-purple-500/10 flex items-center justify-center">
                <Navigation className="h-4 w-4 md:h-5 md:w-5 text-purple-500" />
              </div>
              <div>
                <p className="text-xl md:text-2xl font-bold">24 km</p>
                <p className="text-xs text-muted-foreground">Recorrido</p>
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
            <Link to="/delivery/ruta">
              <Button className="w-full justify-start gap-3 bg-amber-500 hover:bg-amber-600" size="lg">
                <Navigation className="h-5 w-5" />
                Ver Mi Ruta
              </Button>
            </Link>
            <Link to="/delivery/entregas">
              <Button variant="outline" className="w-full justify-start gap-3" size="lg">
                <Package className="h-5 w-5" />
                Mis Entregas
              </Button>
            </Link>
            <Link to="/delivery/historial">
              <Button variant="outline" className="w-full justify-start gap-3" size="lg">
                <CheckCircle className="h-5 w-5" />
                Ver Historial
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* Próximas Entregas */}
        <Card className="border-border lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Próximas Entregas</CardTitle>
            <Link to="/delivery/entregas">
              <Button variant="ghost" size="sm" className="gap-1">
                Ver todas <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {proximasEntregas.map((entrega, index) => (
                <div
                  key={entrega.id}
                  className={`flex items-center justify-between rounded-lg border p-4 transition-colors ${
                    index === 0 ? "border-amber-500/50 bg-amber-500/5" : "border-border hover:bg-muted/50"
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className={`h-10 w-10 rounded-full flex items-center justify-center ${
                      index === 0 ? "bg-amber-500/20" : "bg-muted"
                    }`}>
                      <span className={`text-lg font-bold ${index === 0 ? "text-amber-500" : "text-muted-foreground"}`}>
                        {index + 1}
                      </span>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{entrega.cliente}</p>
                        {entrega.prioridad === "alta" && (
                          <Badge variant="destructive" className="text-xs">Prioritario</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <MapPin className="h-3 w-3" />
                        <span>{entrega.direccion}</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-medium">{entrega.hora}</p>
                    <p className="text-sm text-muted-foreground">{entrega.productos} productos</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </DeliveryLayout>
  );
};

export default DeliveryDashboard;
