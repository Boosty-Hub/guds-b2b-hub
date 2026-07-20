import { useState, useEffect, useCallback } from "react";
import { DeliveryLayout } from "@/components/delivery/DeliveryLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { Package, Truck, CheckCircle, XCircle, Clock, ArrowRight, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";

interface Row { estado: string; fecha_entrega: string | null; }

const DeliveryDashboard = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRows = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    const { data } = await supabase.from("entregas").select("estado,fecha_entrega").eq("repartidor_id", user.id);
    if (data) setRows(data as Row[]);
    setLoading(false);
  }, [user?.id]);
  useEffect(() => { fetchRows(); }, [fetchRows]);

  const hoy = new Date().toISOString().slice(0, 10);
  const asignadas = rows.filter((r) => r.estado === "asignada").length;
  const enCamino = rows.filter((r) => r.estado === "en_camino").length;
  const entregadasHoy = rows.filter((r) => r.estado === "entregada" && r.fecha_entrega?.slice(0, 10) === hoy).length;
  const fallidas = rows.filter((r) => r.estado === "fallida").length;
  const pendientes = asignadas + enCamino;

  const stat = (icon: React.ReactNode, n: number, label: string, cls: string) => (
    <Card className="border-border"><CardContent className="p-4">
      <div className="flex items-center gap-3">
        <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${cls}`}>{icon}</div>
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
            <p className="text-muted-foreground">Tienes {pendientes} {pendientes === 1 ? "entrega pendiente" : "entregas pendientes"} hoy.</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {stat(<Clock className="h-5 w-5 text-muted-foreground" />, asignadas, "Asignadas", "bg-muted")}
            {stat(<Truck className="h-5 w-5 text-amber-600" />, enCamino, "En camino", "bg-amber-500/10")}
            {stat(<CheckCircle className="h-5 w-5 text-green-600" />, entregadasHoy, "Entregadas hoy", "bg-green-500/10")}
            {stat(<XCircle className="h-5 w-5 text-red-600" />, fallidas, "Fallidas", "bg-red-500/10")}
          </div>
          <Card className="border-border"><CardContent className="p-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Package className="h-6 w-6 text-amber-500" />
              <div><p className="font-medium">Tus entregas de hoy</p><p className="text-sm text-muted-foreground">Ver y gestionar tus entregas</p></div>
            </div>
            <Button asChild className="bg-amber-500 hover:bg-amber-600"><Link to="/delivery/entregas">Ir a entregas <ArrowRight className="h-4 w-4 ml-1" /></Link></Button>
          </CardContent></Card>
        </div>
      )}
    </DeliveryLayout>
  );
};

export default DeliveryDashboard;
