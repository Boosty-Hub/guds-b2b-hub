import { ConfiguracionLayout } from "@/components/configuracion/ConfiguracionLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const ConfigFacturacion = () => {
  const { toast } = useToast();

  const handleSave = () => {
    toast({
      title: "Configuración guardada",
      description: "Los datos de facturación han sido actualizados",
    });
  };

  return (
    <ConfiguracionLayout 
      title="Facturación" 
      description="Configuración de facturación y documentos fiscales"
    >
      <div className="space-y-6">
        <Card className="border-border">
          <CardHeader>
            <CardTitle>Datos Fiscales</CardTitle>
            <CardDescription>Información para la emisión de facturas</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Razón Social</Label>
                <Input defaultValue="GUDS Distribuidora S.A. de C.V." />
              </div>
              <div className="space-y-2">
                <Label>RFC</Label>
                <Input defaultValue="GDA123456ABC" />
              </div>
              <div className="space-y-2">
                <Label>Régimen Fiscal</Label>
                <Select defaultValue="601">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="601">601 - General de Ley Personas Morales</SelectItem>
                    <SelectItem value="603">603 - Personas Morales con Fines no Lucrativos</SelectItem>
                    <SelectItem value="612">612 - Personas Físicas con Actividades Empresariales</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Código Postal Fiscal</Label>
                <Input defaultValue="06600" />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Dirección Fiscal</Label>
                <Input defaultValue="Av. Reforma 500, Col. Juárez, CDMX" />
              </div>
            </div>
            <Button onClick={handleSave}>Guardar Datos Fiscales</Button>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader>
            <CardTitle>Certificados Digitales</CardTitle>
            <CardDescription>Certificados para firma electrónica (CFDI)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Certificado (.cer)</Label>
                <div className="flex gap-2">
                  <Input type="file" accept=".cer" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Llave Privada (.key)</Label>
                <div className="flex gap-2">
                  <Input type="file" accept=".key" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Contraseña de la Llave</Label>
                <Input type="password" placeholder="••••••••" />
              </div>
              <div className="space-y-2">
                <Label>Vigencia del Certificado</Label>
                <Input disabled defaultValue="Válido hasta: 15/06/2025" />
              </div>
            </div>
            <Button>Actualizar Certificados</Button>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader>
            <CardTitle>Configuración de Facturación</CardTitle>
            <CardDescription>Opciones generales de facturación</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Facturación automática</p>
                <p className="text-sm text-muted-foreground">Generar factura automáticamente al completar un pedido</p>
              </div>
              <Switch defaultChecked />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Enviar factura por email</p>
                <p className="text-sm text-muted-foreground">Enviar automáticamente la factura al cliente</p>
              </div>
              <Switch defaultChecked />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Incluir PDF y XML</p>
                <p className="text-sm text-muted-foreground">Adjuntar ambos formatos en el email</p>
              </div>
              <Switch defaultChecked />
            </div>
            <div className="grid gap-4 md:grid-cols-2 pt-4">
              <div className="space-y-2">
                <Label>Serie de Factura</Label>
                <Input defaultValue="A" />
              </div>
              <div className="space-y-2">
                <Label>Folio Inicial</Label>
                <Input type="number" defaultValue="1001" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </ConfiguracionLayout>
  );
};

export default ConfigFacturacion;
