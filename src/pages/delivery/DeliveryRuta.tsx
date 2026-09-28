import { useState } from "react";
import { DeliveryLayout } from "@/components/delivery/DeliveryLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MapPin, Navigation, Loader2, Route, Phone } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { useMisEntregas } from "@/components/delivery/useMisEntregas";
import { CierreEntregaDialog } from "@/components/delivery/CierreEntregaDialog";
import { ABIERTAS, enlaceMaps, enlaceRuta, enlaceWaze, telefonos, type EntregaReparto } from "@/components/delivery/entregas";

// Mi ruta: las paradas pendientes en orden (primero las que ya salieron, luego prioridad alta y fecha programada),
// con Google Maps / Waze por parada y la ruta completa en Google Maps (por dirección; aún no hay coordenadas).
const DeliveryRuta = () => {
  const { toast } = useToast();
  const { entregas, loading, recargar } = useMisEntregas(1);
  const [cerrando, setCerrando] = useState<EntregaReparto | null>(null);
  const [saliendo, setSaliendo] = useState<string | null>(null);
  const paradas = entregas.filter((e) => ABIERTAS.includes(e.estado))
    .sort((a, b) => (a.estado === "en_camino" ? 0 : 1) - (b.estado === "en_camino" ? 0 : 1));
  const ruta = enlaceRuta(paradas.map((p) => ({ dir: p.direccion, ciudad: p.ciudad, region: p.region })));

  const salir = async (e: EntregaReparto) => {
    setSaliendo(e.id);
    const { error } = await supabase.rpc("iniciar_entrega", { p_entrega_id: e.id });
    setSaliendo(null);
    if (error) { toast({ title: "No se pudo actualizar", description: error.message, variant: "destructive" }); return; }
    recargar();
  };

  return (
    <DeliveryLayout title="Mi Ruta">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold"><Route className="h-5 w-5 text-amber-500" />Paradas pendientes</h2>
            <p className="text-sm text-muted-foreground">{paradas.length} {paradas.length === 1 ? "parada" : "paradas"}</p>
          </div>
          {ruta && paradas.length > 1 && (
            <Button asChild className="h-11 bg-amber-500 hover:bg-amber-600">
              <a href={ruta} target="_blank" rel="noopener noreferrer"><Navigation className="mr-1 h-4 w-4" />Ruta completa</a>
            </Button>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-amber-500" /></div>
        ) : paradas.length === 0 ? (
          <Card className="border-border"><CardContent className="p-12 text-center text-muted-foreground">No tienes paradas pendientes en tu ruta</CardContent></Card>
        ) : (
          <div className="space-y-3">
            {paradas.map((p, i) => {
              const tel = telefonos(p.telefono)[0];
              return (
                <Card key={p.id} className="border-border"><CardContent className="p-3">
                  <div className="flex items-start gap-3">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-bold ${p.estado === "en_camino" ? "bg-amber-500 text-white" : "bg-muted"}`}>{i + 1}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="min-w-0 truncate font-medium">{p.contacto || p.cliente || "Cliente"}</p>
                        {p.prioridad === "alta" && <Badge variant="destructive" className="text-[10px]">Alta</Badge>}
                        {p.estado === "en_camino" && <Badge className="border-0 bg-amber-500/10 text-[10px] text-amber-700">En camino</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground"><span className="font-mono">{p.numero}</span> · {p.empresa}</p>
                      <p className="mt-1 flex items-start gap-1 text-sm text-muted-foreground"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />{p.direccion || "Sin dirección"}{p.ciudad ? ` · ${p.ciudad}` : ""}</p>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-2">
                    <Button asChild={!!tel} variant="outline" className="h-10 px-2" disabled={!tel} aria-label="Llamar">
                      {tel ? <a href={`tel:${tel}`}><Phone className="h-4 w-4" /></a> : <span><Phone className="h-4 w-4" /></span>}
                    </Button>
                    <Button asChild variant="outline" className="h-10 px-2"><a href={enlaceMaps(p.direccion, p.ciudad, p.region)} target="_blank" rel="noopener noreferrer">Maps</a></Button>
                    <Button asChild variant="outline" className="h-10 px-2"><a href={enlaceWaze(p.direccion, p.ciudad, p.region)} target="_blank" rel="noopener noreferrer">Waze</a></Button>
                    {p.estado === "asignada"
                      ? <Button className="h-10 bg-amber-500 px-2 hover:bg-amber-600" onClick={() => salir(p)} disabled={saliendo === p.id}>{saliendo === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salir"}</Button>
                      : <Button className="h-10 px-2" onClick={() => setCerrando(p)}>Cerrar</Button>}
                  </div>
                </CardContent></Card>
              );
            })}
          </div>
        )}
      </div>
      <CierreEntregaDialog entrega={cerrando} onClose={() => setCerrando(null)} onCerrada={() => { setCerrando(null); recargar(); }} />
    </DeliveryLayout>
  );
};

export default DeliveryRuta;
