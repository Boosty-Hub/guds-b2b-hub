import { ConfiguracionLayout } from "@/components/configuracion/ConfiguracionLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

const ConfigEmpresa = () => {
  const { toast } = useToast();

  const handleSave = () => {
    toast({
      title: "Configuración guardada",
      description: "Los datos de la empresa han sido actualizados",
    });
  };

  return (
    <ConfiguracionLayout 
      title="Información de la Empresa" 
      description="Datos generales de GUDS Distribuidora"
    >
      <div className="space-y-6">
        <Card className="border-border">
          <CardHeader>
            <CardTitle>Datos Generales</CardTitle>
            <CardDescription>Información básica de la empresa</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="company-name">Nombre de la Empresa</Label>
                <Input id="company-name" defaultValue="GUDS Distribuidora de Alimentos" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rfc">RFC</Label>
                <Input id="rfc" defaultValue="GDA123456ABC" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" defaultValue="contacto@guds.com" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Teléfono</Label>
                <Input id="phone" defaultValue="+52 55 1234 5678" />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="address">Dirección</Label>
                <Input id="address" defaultValue="Av. Industrial 1234, CDMX, México" />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="description">Descripción</Label>
                <Textarea 
                  id="description" 
                  defaultValue="Distribuidora líder en alimentos y productos de consumo masivo."
                  rows={3}
                />
              </div>
            </div>
            <Button onClick={handleSave}>Guardar Cambios</Button>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader>
            <CardTitle>Configuración de Inventario</CardTitle>
            <CardDescription>Ajustes para el manejo de inventario</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Alertas de bajo stock</p>
                <p className="text-sm text-muted-foreground">Notificar cuando un producto esté por debajo del mínimo</p>
              </div>
              <Switch defaultChecked />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Permitir stock negativo</p>
                <p className="text-sm text-muted-foreground">Permitir ventas aunque no haya stock disponible</p>
              </div>
              <Switch />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Reservar stock en órdenes</p>
                <p className="text-sm text-muted-foreground">Reservar automáticamente el stock al crear una orden</p>
              </div>
              <Switch defaultChecked />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader>
            <CardTitle>Configuración de Crédito</CardTitle>
            <CardDescription>Políticas de crédito para clientes</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Días de crédito por defecto</Label>
                <Input type="number" defaultValue="30" />
              </div>
              <div className="space-y-2">
                <Label>Límite de crédito por defecto</Label>
                <Input type="number" defaultValue="50000" />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Bloquear pedidos con crédito excedido</p>
                <p className="text-sm text-muted-foreground">No permitir nuevos pedidos si el cliente excede su límite</p>
              </div>
              <Switch defaultChecked />
            </div>
          </CardContent>
        </Card>
      </div>
    </ConfiguracionLayout>
  );
};

export default ConfigEmpresa;
