import { ConfiguracionLayout } from "@/components/configuracion/ConfiguracionLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, Mail, MessageSquare, Edit, Eye, Copy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const plantillas = [
  { 
    id: 1, 
    nombre: "Confirmación de Pedido", 
    tipo: "email", 
    descripcion: "Se envía al cliente cuando se confirma un pedido",
    ultimaEdicion: "Hace 5 días"
  },
  { 
    id: 2, 
    nombre: "Pedido Enviado", 
    tipo: "email", 
    descripcion: "Notifica al cliente que su pedido está en camino",
    ultimaEdicion: "Hace 1 semana"
  },
  { 
    id: 3, 
    nombre: "Recordatorio de Pago", 
    tipo: "email", 
    descripcion: "Recordatorio para pagos próximos a vencer",
    ultimaEdicion: "Hace 2 semanas"
  },
  { 
    id: 4, 
    nombre: "Pago Vencido", 
    tipo: "email", 
    descripcion: "Notificación de pago vencido",
    ultimaEdicion: "Hace 3 días"
  },
  { 
    id: 5, 
    nombre: "Bienvenida", 
    tipo: "email", 
    descripcion: "Email de bienvenida para nuevos clientes",
    ultimaEdicion: "Hace 1 mes"
  },
  { 
    id: 6, 
    nombre: "Cotización", 
    tipo: "documento", 
    descripcion: "Plantilla para generar cotizaciones",
    ultimaEdicion: "Hace 2 semanas"
  },
  { 
    id: 7, 
    nombre: "Factura", 
    tipo: "documento", 
    descripcion: "Formato de factura PDF",
    ultimaEdicion: "Hace 1 semana"
  },
  { 
    id: 8, 
    nombre: "Nota de Entrega", 
    tipo: "documento", 
    descripcion: "Documento de entrega para el transportista",
    ultimaEdicion: "Hace 3 semanas"
  },
];

const ConfigPlantillas = () => {
  const { toast } = useToast();

  const handleDuplicate = (nombre: string) => {
    toast({
      title: "Plantilla duplicada",
      description: `Se ha creado una copia de "${nombre}"`,
    });
  };

  const getTipoIcon = (tipo: string) => {
    switch (tipo) {
      case "email":
        return <Mail className="h-5 w-5 text-blue-500" />;
      case "documento":
        return <FileText className="h-5 w-5 text-emerald-500" />;
      case "sms":
        return <MessageSquare className="h-5 w-5 text-purple-500" />;
      default:
        return <FileText className="h-5 w-5" />;
    }
  };

  const getTipoBadge = (tipo: string) => {
    switch (tipo) {
      case "email":
        return <Badge className="bg-blue-500/10 text-blue-500 border-0">Email</Badge>;
      case "documento":
        return <Badge className="bg-emerald-500/10 text-emerald-500 border-0">Documento</Badge>;
      case "sms":
        return <Badge className="bg-purple-500/10 text-purple-500 border-0">SMS</Badge>;
      default:
        return <Badge variant="secondary">{tipo}</Badge>;
    }
  };

  return (
    <ConfiguracionLayout 
      title="Plantillas" 
      description="Gestiona las plantillas de emails y documentos"
    >
      <div className="space-y-6">
        <Card className="border-border">
          <CardHeader>
            <CardTitle>Plantillas de Email</CardTitle>
            <CardDescription>Personaliza los emails que se envían a los clientes</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {plantillas.filter(p => p.tipo === "email").map((plantilla) => (
                <div
                  key={plantilla.id}
                  className="flex items-center justify-between rounded-lg border border-border p-4 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-full bg-blue-500/10 flex items-center justify-center">
                      {getTipoIcon(plantilla.tipo)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{plantilla.nombre}</p>
                        {getTipoBadge(plantilla.tipo)}
                      </div>
                      <p className="text-sm text-muted-foreground">{plantilla.descripcion}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground mr-4">{plantilla.ultimaEdicion}</span>
                    <Button variant="ghost" size="icon">
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon">
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDuplicate(plantilla.nombre)}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader>
            <CardTitle>Plantillas de Documentos</CardTitle>
            <CardDescription>Formatos para cotizaciones, facturas y otros documentos</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {plantillas.filter(p => p.tipo === "documento").map((plantilla) => (
                <div
                  key={plantilla.id}
                  className="flex items-center justify-between rounded-lg border border-border p-4 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
                      {getTipoIcon(plantilla.tipo)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{plantilla.nombre}</p>
                        {getTipoBadge(plantilla.tipo)}
                      </div>
                      <p className="text-sm text-muted-foreground">{plantilla.descripcion}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground mr-4">{plantilla.ultimaEdicion}</span>
                    <Button variant="ghost" size="icon">
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon">
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDuplicate(plantilla.nombre)}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader>
            <CardTitle>Variables Disponibles</CardTitle>
            <CardDescription>Usa estas variables en tus plantillas para personalizar el contenido</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-lg border border-border p-3">
                <code className="text-sm text-primary">{"{{cliente.nombre}}"}</code>
                <p className="text-xs text-muted-foreground mt-1">Nombre del cliente</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <code className="text-sm text-primary">{"{{pedido.numero}}"}</code>
                <p className="text-xs text-muted-foreground mt-1">Número de pedido</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <code className="text-sm text-primary">{"{{pedido.total}}"}</code>
                <p className="text-xs text-muted-foreground mt-1">Total del pedido</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <code className="text-sm text-primary">{"{{pedido.fecha}}"}</code>
                <p className="text-xs text-muted-foreground mt-1">Fecha del pedido</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <code className="text-sm text-primary">{"{{empresa.nombre}}"}</code>
                <p className="text-xs text-muted-foreground mt-1">Nombre de la empresa</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <code className="text-sm text-primary">{"{{tracking.url}}"}</code>
                <p className="text-xs text-muted-foreground mt-1">URL de rastreo</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </ConfiguracionLayout>
  );
};

export default ConfigPlantillas;
