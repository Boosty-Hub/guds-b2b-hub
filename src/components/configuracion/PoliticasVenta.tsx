import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { OdooBadge } from "@/components/OdooBadge";

/** Políticas de venta de la tienda, el portal del vendedor y los pedidos de administración. */
export function PoliticasVenta() {
  const { toast } = useToast();
  const [modo, setModo] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [productoEnvio, setProductoEnvio] = useState<string | null>(null);
  const [guardandoEnvio, setGuardandoEnvio] = useState(false);

  useEffect(() => {
    supabase.from("configuracion").select("valor").eq("clave", "credito_modo").maybeSingle()
      .then(({ data }) => setModo((data?.valor as string | undefined) ?? "abierto"));
    supabase.from("configuracion").select("valor").eq("clave", "odoo_producto_envio").maybeSingle()
      .then(({ data }) => setProductoEnvio((data?.valor as string | undefined) ?? ""));
  }, []);

  const guardarProductoEnvio = async () => {
    setGuardandoEnvio(true);
    const { error } = await supabase.from("configuracion").update({ valor: (productoEnvio ?? "").trim(), updated_at: new Date().toISOString() }).eq("clave", "odoo_producto_envio");
    setGuardandoEnvio(false);
    if (error) { toast({ title: "No se pudo guardar", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Producto de envío guardado", description: (productoEnvio ?? "").trim() ? "Los próximos pedidos llevarán el envío como línea de servicio en Odoo." : "El envío irá como nota en la cotización." });
  };

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
          <CardTitle>Pedidos y Odoo</CardTitle>
          <CardDescription>Aprobación y envío de los pedidos de GUDS a Odoo</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="space-y-1 text-muted-foreground">
            <p>• Los pedidos del portal del cliente y del vendedor quedan <span className="font-medium text-foreground">por aprobar</span> en Órdenes. Los que crea administración nacen aprobados.</p>
            <p>• Al aprobarse, GUDS crea en Odoo una <span className="font-medium text-foreground">cotización en borrador</span> (almacén general, precios de GUDS, referencia "(GUDS)") que se confirma en Odoo. GUDS nunca borra ni modifica registros de Odoo.</p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="producto-envio" className="font-medium">Producto de servicio de envío en Odoo (código interno)</label>
            <div className="flex flex-wrap gap-2">
              <Input id="producto-envio" className="h-8 w-56 font-mono text-[13px]" placeholder="Ej.: ENVIO" value={productoEnvio ?? ""}
                disabled={productoEnvio === null} onChange={(e) => setProductoEnvio(e.target.value)} />
              <Button size="sm" onClick={guardarProductoEnvio} disabled={productoEnvio === null || guardandoEnvio}>
                {guardandoEnvio && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Guardar
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              El envío que cobra GUDS va como línea de este servicio (debe existir en Odoo como servicio vendible, con su cuenta de ingresos e impuesto definidos por contabilidad). Vacío: el monto del envío va como nota en la cotización.
            </p>
          </div>
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
