import { useState, useEffect, useCallback } from "react";
import { DeliveryLayout } from "@/components/delivery/DeliveryLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MapPin, Navigation, Loader2, Route } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";

interface Parada {
  id: string;
  estado: string;
  prioridad: string | null;
  orden?: {
    numero: string;
    direccion_entrega: string | null;
    ciudad_entrega: string | null;
    cliente?: { nombre_negocio: string; direccion: string; latitud: number | null; longitud: number | null } | null;
  } | null;
}

const DeliveryRuta = () => {
  const { user } = useAuth();
  const [paradas, setParadas] = useState<Parada[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchParadas = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    const { data } = await supabase
      .from("entregas")
      .select("id,estado,prioridad,orden_ruta,orden:ordenes(numero,direccion_entrega,ciudad_entrega,cliente:clientes(nombre_negocio,direccion,latitud,longitud))")
      .eq("repartidor_id", user.id)
      .in("estado", ["asignada", "en_camino"])
      .order("orden_ruta", { ascending: true, nullsFirst: false });
    if (data) setParadas(data as unknown as Parada[]);
    setLoading(false);
  }, [user?.id]);
  useEffect(() => { fetchParadas(); }, [fetchParadas]);

  const dir = (p: Parada) => p.orden?.cliente?.direccion || p.orden?.direccion_entrega || "Sin dirección";
  const navegar = (p: Parada) => {
    const c = p.orden?.cliente;
    const url = c?.latitud && c?.longitud
      ? `https://www.google.com/maps/dir/?api=1&destination=${c.latitud},${c.longitud}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(dir(p) + " " + (p.orden?.ciudad_entrega || ""))}`;
    window.open(url, "_blank");
  };
  const navegarTodo = () => {
    const conCoords = paradas.filter((p) => p.orden?.cliente?.latitud && p.orden?.cliente?.longitud);
    if (conCoords.length === 0) return;
    const dest = conCoords[conCoords.length - 1].orden!.cliente!;
    const waypoints = conCoords.slice(0, -1).map((p) => `${p.orden!.cliente!.latitud},${p.orden!.cliente!.longitud}`).join("|");
    let url = `https://www.google.com/maps/dir/?api=1&destination=${dest.latitud},${dest.longitud}&travelmode=driving`;
    if (waypoints) url += `&waypoints=${encodeURIComponent(waypoints)}`;
    window.open(url, "_blank");
  };

  return (
    <DeliveryLayout title="Mi Ruta">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2"><Route className="h-5 w-5 text-amber-500" />Ruta de hoy</h2>
            <p className="text-sm text-muted-foreground">{paradas.length} {paradas.length === 1 ? "parada" : "paradas"} pendientes</p>
          </div>
          {paradas.some((p) => p.orden?.cliente?.latitud) && (
            <Button className="bg-amber-500 hover:bg-amber-600" onClick={navegarTodo}><Navigation className="h-4 w-4 mr-1" />Navegar ruta</Button>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-amber-500" /></div>
        ) : paradas.length === 0 ? (
          <Card className="border-border"><CardContent className="p-12 text-center text-muted-foreground">No tienes paradas pendientes en tu ruta</CardContent></Card>
        ) : (
          <div className="space-y-3">
            {paradas.map((p, i) => (
              <Card key={p.id} className="border-border"><CardContent className="p-4 flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-amber-500 text-white flex items-center justify-center font-bold shrink-0">{i + 1}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium truncate">{p.orden?.cliente?.nombre_negocio || "Cliente"}</p>
                    {p.prioridad === "alta" && <Badge variant="destructive" className="text-xs">Alta</Badge>}
                    {p.estado === "en_camino" && <Badge className="bg-amber-500/10 text-amber-600 border-0 text-xs">En camino</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground flex items-center gap-1 truncate"><MapPin className="h-3.5 w-3.5 shrink-0" />{dir(p)}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => navegar(p)}><Navigation className="h-4 w-4" /></Button>
              </CardContent></Card>
            ))}
          </div>
        )}
      </div>
    </DeliveryLayout>
  );
};

export default DeliveryRuta;
