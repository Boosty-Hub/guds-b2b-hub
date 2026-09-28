import { DeliveryLayout } from "@/components/delivery/DeliveryLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { Package, Truck, CheckCircle, AlertTriangle, Clock, ArrowRight, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { diaCaracas } from "@/components/delivery/fechas";
import { useMisEntregas } from "@/components/delivery/useMisEntregas";

const DeliveryDashboard = () => {
  const { user } = useAuth();
  const { entregas: rows, loading } = useMisEntregas(30);

  // "Hoy" en hora de Caracas (con la fecha UTC, desde las 20:00 contaba el día siguiente)
  const hoy = diaCaracas();
  const asignadas = rows.filter((r) => r.estado === "asignada").length;
  const enCamino = rows.filter((r) => r.estado === "en_camino").length;
  const entregadasHoy = rows.filter((r) => (r.estado === "entregada" || r.estado === "incompleta") && !!(r.fecha_cierre || r.fecha_entrega)
    && diaCaracas((r.fecha_cierre || r.fecha_entrega)!) === hoy).length;
  const incidencias = rows.filter((r) => ["rechazada", "reprogramada", "fallida"].includes(r.estado) && !!r.fecha_cierre && diaCaracas(r.fecha_cierre) === hoy).length;
  const pendientes = asignadas + enCamino;

  const stat = (icon: React.ReactNode, n: number, label: string, cls: string) => (
    <Card className="border-border"><CardContent className="p-4">
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${cls}`}>{icon}</div>
        <div><p className="text-2xl font-bold">{n}</p><p className="text-sm text-muted-foreground">{label}</p></div>
      </div>
    </CardContent></Card>
  );

  return (
    <DeliveryLayout title="Inicio">
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-amber-500" /></div>
      ) : (
        <div className="space-y-6">
          <div>
            <h2 className="text-lg font-semibold">Hola, {user?.nombre} 👋</h2>
            <p className="text-muted-foreground">Tienes {pendientes} {pendientes === 1 ? "entrega pendiente" : "entregas pendientes"}.</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {stat(<Clock className="h-5 w-5 text-muted-foreground" />, asignadas, "Por salir", "bg-muted")}
            {stat(<Truck className="h-5 w-5 text-amber-600" />, enCamino, "En camino", "bg-amber-500/10")}
            {stat(<CheckCircle className="h-5 w-5 text-green-600" />, entregadasHoy, "Entregadas hoy", "bg-green-500/10")}
            {stat(<AlertTriangle className="h-5 w-5 text-red-600" />, incidencias, "Rechazos / reprog. hoy", "bg-red-500/10")}
          </div>
          <Card className="border-border"><CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div className="flex items-center gap-3">
              <Package className="h-6 w-6 text-amber-500" />
              <div><p className="font-medium">Tus entregas</p><p className="text-sm text-muted-foreground">Documentos de entrega asignados a ti</p></div>
            </div>
            <Button asChild className="h-11 bg-amber-500 hover:bg-amber-600"><Link to="/delivery/entregas">Ir a entregas <ArrowRight className="ml-1 h-4 w-4" /></Link></Button>
          </CardContent></Card>
        </div>
      )}
    </DeliveryLayout>
  );
};

export default DeliveryDashboard;
