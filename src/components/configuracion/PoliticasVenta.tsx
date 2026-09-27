import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { OdooBadge } from "@/components/OdooBadge";

/** Políticas de venta de la tienda, el portal del vendedor y los pedidos de administración. */
export function PoliticasVenta() {
  const { toast } = useToast();
  const [modo, setModo] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    supabase.from("configuracion").select("valor").eq("clave", "credito_modo").maybeSingle()
      .then(({ data }) => setModo((data?.valor as string | undefined) ?? "abierto"));
  }, []);

  const cambiarModo = async (exigir: boolean) => {
    const nuevo = exigir ? "limite" : "abierto";
    setGuardando(true);
    const { error } = await supabase.from("configuracion").update({ valor: nuevo, updated_at: new Date().toISOString() }).eq("clave", "credito_modo");
    setGuardando(false);
    if (error) { toast({ title: "No se pudo guardar", description: error.message, variant: "destructive" }); return; }
    setModo(nuevo);
    toast({ title: exigir ? "Se exige el límite de crédito" : "Crédito abierto", description: exigir ? "Los pedidos a crédito no pueden superar el límite de cada cliente." : "Se puede comprar a crédito sin tope." });
  };

  return (
    <>
      <Card className="border-border">
        <CardHeader>
          <CardTitle>Crédito</CardTitle>
          <CardDescription>Aplica a la tienda, al portal del vendedor y a los pedidos de administración</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-medium">Exigir el límite de crédito de cada cliente</p>
              <p className="text-sm text-muted-foreground">
                {modo === "limite"
                  ? "Un pedido a crédito no puede superar el límite menos lo que el cliente debe y sus pedidos a crédito pendientes."
                  : "Crédito abierto: se permite comprar a crédito sin tope mientras se actualizan los límites."}
              </p>
            </div>
            {modo === null || guardando ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              : <Switch checked={modo === "limite"} onCheckedChange={cambiarModo} aria-label="Exigir el límite de crédito" />}
          </div>
          <p className="flex flex-wrap items-center gap-1.5 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
            <OdooBadge /> El límite de cada cliente viene de Odoo. Si se cambia en GUDS (ficha del cliente), queda pendiente de enviarse a Odoo.
          </p>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader>
          <CardTitle>Inventario en los pedidos</CardTitle>
          <CardDescription>Cómo se aparta el stock (igual que en Odoo)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>• Lo que está en un pedido queda <span className="font-medium text-foreground">comprometido</span> y no se puede volver a vender.</p>
          <p>• Disponible = existencia en almacenes propios − entregas pendientes en Odoo − pedidos de GUDS aún no pasados a Odoo.</p>
          <p>• Al entregarse en Odoo baja la existencia y se libera lo comprometido. Los servicios y productos sin control de stock no tienen tope.</p>
        </CardContent>
      </Card>
    </>
  );
}
