import { useState } from "react";
import { DeliveryLayout } from "@/components/delivery/DeliveryLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle, Clock, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { TarjetaEntrega } from "@/components/delivery/TarjetaEntrega";
import { CierreEntregaDialog } from "@/components/delivery/CierreEntregaDialog";
import { useMisEntregas } from "@/components/delivery/useMisEntregas";
import { usePingPosicion } from "@/components/delivery/usePingPosicion";
import { ABIERTAS, type EntregaReparto } from "@/components/delivery/entregas";

// Mis entregas: los documentos de entrega de Odoo asignados al repartidor, con dirección, teléfono y productos;
// salir a entregar y cerrar con uno de los 4 resultados (fase 19v).
const DeliveryEntregas = () => {
  const { toast } = useToast();
  const { entregas, loading, error, recargar } = useMisEntregas(30);
  const [cerrando, setCerrando] = useState<EntregaReparto | null>(null);
  const [saliendo, setSaliendo] = useState<string | null>(null);

  const pendientes = entregas.filter((e) => ABIERTAS.includes(e.estado));
  const completadas = entregas.filter((e) => !ABIERTAS.includes(e.estado));
  // Seguimiento (20p): con una entrega en camino, la última posición llega a la oficina (GPS de bajo consumo)
  usePingPosicion(entregas.some((e) => e.estado === "en_camino"));

  const salir = async (e: EntregaReparto) => {
    setSaliendo(e.id);
    const { error: err } = await supabase.rpc("iniciar_entrega", { p_entrega_id: e.id });
    setSaliendo(null);
    if (err) { toast({ title: "No se pudo actualizar", description: err.message, variant: "destructive" }); return; }
    toast({ title: "En camino", description: `${e.numero ?? ""} · ${e.cliente ?? ""}` });
    recargar();
  };

  return (
    <DeliveryLayout title="Mis Entregas">
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-amber-500" /></div>
      ) : error ? (
        <Card className="border-border"><CardContent className="p-6 text-center text-sm text-destructive">No se pudieron cargar tus entregas: {error}</CardContent></Card>
      ) : (
        <Tabs defaultValue="pendientes" className="space-y-4">
          <TabsList className="grid w-full grid-cols-2 sm:w-auto sm:inline-grid">
            <TabsTrigger value="pendientes" className="gap-2"><Clock className="h-4 w-4" />Pendientes ({pendientes.length})</TabsTrigger>
            <TabsTrigger value="completadas" className="gap-2"><CheckCircle className="h-4 w-4" />Cerradas ({completadas.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="pendientes" className="space-y-3">
            {pendientes.length === 0 ? (
              <Card className="border-border"><CardContent className="p-10 text-center">
                <CheckCircle className="mx-auto mb-3 h-12 w-12 text-green-500" />
                <p className="text-lg font-medium">¡Todo al día!</p>
                <p className="text-muted-foreground">No tienes entregas pendientes</p>
              </CardContent></Card>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {pendientes.map((e, i) => <TarjetaEntrega key={e.id} e={e} idx={i} onSalir={salir} onCerrar={setCerrando} ocupado={saliendo === e.id} />)}
              </div>
            )}
          </TabsContent>

          <TabsContent value="completadas" className="space-y-3">
            {completadas.length === 0 ? (
              <p className="py-12 text-center text-muted-foreground">Aún no tienes entregas cerradas en los últimos 30 días</p>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {completadas.map((e) => <TarjetaEntrega key={e.id} e={e} />)}
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}

      <CierreEntregaDialog entrega={cerrando} onClose={() => setCerrando(null)} onCerrada={() => { setCerrando(null); recargar(); }} />
    </DeliveryLayout>
  );
};

export default DeliveryEntregas;
