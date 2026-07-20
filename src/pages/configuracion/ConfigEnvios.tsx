import { ConfiguracionLayout } from "@/components/configuracion/ConfiguracionLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Truck, Plus, Edit, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const zonasEnvio = [
  { id: 1, nombre: "Zona Centro", cobertura: "CDMX, Estado de México", costoBase: 150, tiempoEntrega: "1-2 días", activo: true },
  { id: 2, nombre: "Zona Norte", cobertura: "Monterrey, Guadalajara", costoBase: 250, tiempoEntrega: "2-3 días", activo: true },
  { id: 3, nombre: "Zona Sur", cobertura: "Veracruz, Oaxaca, Chiapas", costoBase: 350, tiempoEntrega: "3-5 días", activo: true },
  { id: 4, nombre: "Zona Noroeste", cobertura: "Tijuana, Hermosillo", costoBase: 400, tiempoEntrega: "4-6 días", activo: false },
];

const ConfigEnvios = () => {
  const { toast } = useToast();

  const handleSave = () => {
    toast({
      title: "Configuración guardada",
      description: "La configuración de envíos ha sido actualizada",
    });
  };

  return (
    <ConfiguracionLayout 
      title="Envíos" 
      description="Configuración de zonas y costos de envío"
    >
      <div className="space-y-6">
        <Card className="border-border">
          <CardHeader>
            <CardTitle>Configuración General</CardTitle>
            <CardDescription>Opciones generales de envío</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Envío gratis sobre monto mínimo</p>
                <p className="text-sm text-muted-foreground">Ofrecer envío gratis en pedidos mayores al monto configurado</p>
              </div>
              <Switch defaultChecked />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Monto mínimo para envío gratis</Label>
                <Input type="number" defaultValue="5000" />
              </div>
              <div className="space-y-2">
                <Label>Peso máximo por paquete (kg)</Label>
                <Input type="number" defaultValue="30" />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Permitir recolección en tienda</p>
                <p className="text-sm text-muted-foreground">El cliente puede recoger su pedido sin costo de envío</p>
              </div>
              <Switch defaultChecked />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Calcular envío por peso</p>
                <p className="text-sm text-muted-foreground">Ajustar costo de envío según el peso total del pedido</p>
              </div>
              <Switch />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Zonas de Envío</CardTitle>
              <CardDescription>Configura las zonas y costos de entrega</CardDescription>
            </div>
            <Button size="sm" className="gap-2">
              <Plus className="h-4 w-4" />
              Nueva Zona
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {zonasEnvio.map((zona) => (
                <div
                  key={zona.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4"
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <div className={`h-10 w-10 rounded-full flex items-center justify-center ${zona.activo ? "bg-emerald-500/10" : "bg-muted"}`}>
                      <Truck className={`h-5 w-5 ${zona.activo ? "text-emerald-500" : "text-muted-foreground"}`} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{zona.nombre}</p>
                        {!zona.activo && <Badge variant="secondary">Inactivo</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground">{zona.cobertura}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <p className="font-medium">${zona.costoBase}</p>
                      <p className="text-xs text-muted-foreground">{zona.tiempoEntrega}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="icon">
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader>
            <CardTitle>Transportistas</CardTitle>
            <CardDescription>Servicios de paquetería integrados</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-border p-4">
              <div className="flex items-center gap-4">
                <div className="h-10 w-10 rounded-full bg-blue-500/10 flex items-center justify-center">
                  <span className="text-sm font-bold text-blue-500">FX</span>
                </div>
                <div>
                  <p className="font-medium">FedEx</p>
                  <p className="text-sm text-muted-foreground">Servicio express y estándar</p>
                </div>
              </div>
              <Switch defaultChecked />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border p-4">
              <div className="flex items-center gap-4">
                <div className="h-10 w-10 rounded-full bg-amber-500/10 flex items-center justify-center">
                  <span className="text-sm font-bold text-amber-500">DHL</span>
                </div>
                <div>
                  <p className="font-medium">DHL</p>
                  <p className="text-sm text-muted-foreground">Envíos nacionales e internacionales</p>
                </div>
              </div>
              <Switch defaultChecked />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border p-4">
              <div className="flex items-center gap-4">
                <div className="h-10 w-10 rounded-full bg-red-500/10 flex items-center justify-center">
                  <span className="text-sm font-bold text-red-500">EST</span>
                </div>
                <div>
                  <p className="font-medium">Estafeta</p>
                  <p className="text-sm text-muted-foreground">Cobertura nacional</p>
                </div>
              </div>
              <Switch />
            </div>
          </CardContent>
        </Card>

        <Button onClick={handleSave}>Guardar Configuración</Button>
      </div>
    </ConfiguracionLayout>
  );
};

export default ConfigEnvios;
