import { useState } from "react";
import { DeliveryLayout } from "@/components/delivery/DeliveryLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Package, 
  MapPin, 
  Phone, 
  Clock,
  CheckCircle,
  XCircle,
  Navigation,
  Camera,
  FileText
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Entrega {
  id: string;
  pedidoId: string;
  cliente: string;
  direccion: string;
  telefono: string;
  estado: "pendiente" | "en_camino" | "entregado" | "fallido";
  horaEstimada: string;
  productos: number;
  total: number;
  notas: string;
  coordenadas: { lat: number; lng: number };
}

const entregasData: Entrega[] = [
  {
    id: "ENV-001",
    pedidoId: "PED-2024-045",
    cliente: "Walmart Centro",
    direccion: "Av. Insurgentes Sur 1234, Col. Del Valle, CDMX",
    telefono: "+52 55 1234 5678",
    estado: "en_camino",
    horaEstimada: "10:30 AM",
    productos: 12,
    total: 15680,
    notas: "Entregar en almacén trasero",
    coordenadas: { lat: 19.3910, lng: -99.1775 }
  },
  {
    id: "ENV-002",
    pedidoId: "PED-2024-044",
    cliente: "Soriana Norte",
    direccion: "Blvd. Manuel Ávila Camacho 500, Naucalpan",
    telefono: "+52 55 9876 5432",
    estado: "pendiente",
    horaEstimada: "11:15 AM",
    productos: 8,
    total: 8920,
    notas: "",
    coordenadas: { lat: 19.4785, lng: -99.2385 }
  },
  {
    id: "ENV-003",
    pedidoId: "PED-2024-043",
    cliente: "OXXO Zona 5",
    direccion: "Av. Universidad 1500, Col. Narvarte, CDMX",
    telefono: "+52 55 5555 1234",
    estado: "pendiente",
    horaEstimada: "12:00 PM",
    productos: 5,
    total: 3450,
    notas: "Llamar antes de llegar",
    coordenadas: { lat: 19.3856, lng: -99.1569 }
  },
  {
    id: "ENV-004",
    pedidoId: "PED-2024-042",
    cliente: "Bodega Aurrera",
    direccion: "Calz. de Tlalpan 2500, Col. Xoco, CDMX",
    telefono: "+52 55 4444 3333",
    estado: "entregado",
    horaEstimada: "09:00 AM",
    productos: 15,
    total: 22100,
    notas: "",
    coordenadas: { lat: 19.3650, lng: -99.1520 }
  },
  {
    id: "ENV-005",
    pedidoId: "PED-2024-041",
    cliente: "Chedraui Express",
    direccion: "Av. Revolución 800, Col. Mixcoac, CDMX",
    telefono: "+52 55 6666 7777",
    estado: "entregado",
    horaEstimada: "08:30 AM",
    productos: 10,
    total: 12500,
    notas: "",
    coordenadas: { lat: 19.3750, lng: -99.1850 }
  },
];

const estadoConfig: Record<string, { label: string; color: string; bg: string }> = {
  pendiente: { label: "Pendiente", color: "text-gray-500", bg: "bg-gray-500/10" },
  en_camino: { label: "En Camino", color: "text-amber-500", bg: "bg-amber-500/10" },
  entregado: { label: "Entregado", color: "text-green-500", bg: "bg-green-500/10" },
  fallido: { label: "Fallido", color: "text-red-500", bg: "bg-red-500/10" },
};

const DeliveryEntregas = () => {
  const [selectedEntrega, setSelectedEntrega] = useState<Entrega | null>(null);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [failDialogOpen, setFailDialogOpen] = useState(false);
  const [motivoFallo, setMotivoFallo] = useState("");
  const { toast } = useToast();

  const entregasPendientes = entregasData.filter(e => e.estado === "pendiente" || e.estado === "en_camino");
  const entregasCompletadas = entregasData.filter(e => e.estado === "entregado" || e.estado === "fallido");

  const handleConfirmEntrega = () => {
    toast({
      title: "Entrega Confirmada",
      description: `La entrega ${selectedEntrega?.id} ha sido marcada como completada`,
    });
    setConfirmDialogOpen(false);
    setSelectedEntrega(null);
  };

  const handleFailEntrega = () => {
    if (!motivoFallo) {
      toast({
        title: "Error",
        description: "Debes indicar el motivo del fallo",
        variant: "destructive",
      });
      return;
    }
    toast({
      title: "Entrega Marcada como Fallida",
      description: `La entrega ${selectedEntrega?.id} ha sido reportada`,
      variant: "destructive",
    });
    setFailDialogOpen(false);
    setSelectedEntrega(null);
    setMotivoFallo("");
  };

  const openGoogleMaps = (entrega: Entrega) => {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${entrega.coordenadas.lat},${entrega.coordenadas.lng}`;
    window.open(url, "_blank");
  };

  const callClient = (telefono: string) => {
    window.open(`tel:${telefono}`, "_self");
  };

  return (
    <DeliveryLayout title="Mis Entregas">
      <Tabs defaultValue="pendientes" className="space-y-6">
        <TabsList>
          <TabsTrigger value="pendientes" className="gap-2">
            <Clock className="h-4 w-4" />
            Pendientes ({entregasPendientes.length})
          </TabsTrigger>
          <TabsTrigger value="completadas" className="gap-2">
            <CheckCircle className="h-4 w-4" />
            Completadas ({entregasCompletadas.length})
          </TabsTrigger>
        </TabsList>

        {/* Pendientes */}
        <TabsContent value="pendientes" className="space-y-4">
          {entregasPendientes.length === 0 ? (
            <Card className="border-border">
              <CardContent className="p-12 text-center">
                <CheckCircle className="h-12 w-12 mx-auto text-green-500 mb-4" />
                <p className="text-lg font-medium">¡Todas las entregas completadas!</p>
                <p className="text-muted-foreground">No tienes entregas pendientes</p>
              </CardContent>
            </Card>
          ) : (
            entregasPendientes.map((entrega, index) => (
              <Card key={entrega.id} className={`border-border ${index === 0 ? "border-amber-500/50" : ""}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`h-12 w-12 rounded-full flex items-center justify-center ${
                        index === 0 ? "bg-amber-500 text-white" : "bg-muted"
                      }`}>
                        <span className="text-lg font-bold">{index + 1}</span>
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-lg">{entrega.cliente}</p>
                          {index === 0 && <Badge className="bg-amber-500">Siguiente</Badge>}
                        </div>
                        <p className="text-sm text-muted-foreground">{entrega.id} • {entrega.pedidoId}</p>
                      </div>
                    </div>
                    <Badge className={`${estadoConfig[entrega.estado].bg} ${estadoConfig[entrega.estado].color} border-0`}>
                      {estadoConfig[entrega.estado].label}
                    </Badge>
                  </div>

                  <div className="space-y-3 mb-4">
                    <div className="flex items-start gap-3">
                      <MapPin className="h-5 w-5 text-muted-foreground mt-0.5" />
                      <div>
                        <p className="font-medium">{entrega.direccion}</p>
                        <p className="text-sm text-muted-foreground">Hora estimada: {entrega.horaEstimada}</p>
                      </div>
                    </div>
                    {entrega.notas && (
                      <div className="flex items-start gap-3">
                        <FileText className="h-5 w-5 text-muted-foreground mt-0.5" />
                        <p className="text-sm text-amber-500">{entrega.notas}</p>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t border-border">
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span>{entrega.productos} productos</span>
                      <span>•</span>
                      <span className="font-medium text-foreground">${entrega.total.toLocaleString()}</span>
                    </div>
                    <div className="flex gap-2">
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => callClient(entrega.telefono)}
                      >
                        <Phone className="h-4 w-4 mr-1" />
                        Llamar
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => openGoogleMaps(entrega)}
                      >
                        <Navigation className="h-4 w-4 mr-1" />
                        Navegar
                      </Button>
                      <Button 
                        size="sm"
                        className="bg-green-500 hover:bg-green-600"
                        onClick={() => {
                          setSelectedEntrega(entrega);
                          setConfirmDialogOpen(true);
                        }}
                      >
                        <CheckCircle className="h-4 w-4 mr-1" />
                        Entregar
                      </Button>
                      <Button 
                        variant="destructive"
                        size="sm"
                        onClick={() => {
                          setSelectedEntrega(entrega);
                          setFailDialogOpen(true);
                        }}
                      >
                        <XCircle className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* Completadas */}
        <TabsContent value="completadas" className="space-y-4">
          {entregasCompletadas.map((entrega) => (
            <Card key={entrega.id} className="border-border">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`h-10 w-10 rounded-full flex items-center justify-center ${estadoConfig[entrega.estado].bg}`}>
                      {entrega.estado === "entregado" ? (
                        <CheckCircle className={`h-5 w-5 ${estadoConfig[entrega.estado].color}`} />
                      ) : (
                        <XCircle className={`h-5 w-5 ${estadoConfig[entrega.estado].color}`} />
                      )}
                    </div>
                    <div>
                      <p className="font-medium">{entrega.cliente}</p>
                      <p className="text-sm text-muted-foreground">{entrega.id} • {entrega.horaEstimada}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <Badge className={`${estadoConfig[entrega.estado].bg} ${estadoConfig[entrega.estado].color} border-0`}>
                      {estadoConfig[entrega.estado].label}
                    </Badge>
                    <p className="text-sm text-muted-foreground mt-1">${entrega.total.toLocaleString()}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>

      {/* Confirm Delivery Dialog */}
      <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar Entrega</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-muted-foreground">
              ¿Confirmas que la entrega <strong>{selectedEntrega?.id}</strong> a <strong>{selectedEntrega?.cliente}</strong> fue completada?
            </p>
            <div className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-amber-500/50 transition-colors">
              <Camera className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">Tomar foto de evidencia (opcional)</p>
            </div>
            <Textarea placeholder="Notas adicionales (opcional)" rows={2} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialogOpen(false)}>
              Cancelar
            </Button>
            <Button className="bg-green-500 hover:bg-green-600" onClick={handleConfirmEntrega}>
              <CheckCircle className="h-4 w-4 mr-2" />
              Confirmar Entrega
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Fail Delivery Dialog */}
      <Dialog open={failDialogOpen} onOpenChange={setFailDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reportar Entrega Fallida</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-muted-foreground">
              Indica el motivo por el cual no se pudo completar la entrega <strong>{selectedEntrega?.id}</strong>
            </p>
            <Select value={motivoFallo} onValueChange={setMotivoFallo}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona el motivo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cerrado">Local cerrado</SelectItem>
                <SelectItem value="no_disponible">Cliente no disponible</SelectItem>
                <SelectItem value="direccion_incorrecta">Dirección incorrecta</SelectItem>
                <SelectItem value="rechazo">Cliente rechazó el pedido</SelectItem>
                <SelectItem value="otro">Otro motivo</SelectItem>
              </SelectContent>
            </Select>
            <Textarea placeholder="Detalles adicionales..." rows={3} />
            <div className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-red-500/50 transition-colors">
              <Camera className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">Tomar foto de evidencia</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFailDialogOpen(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleFailEntrega}>
              <XCircle className="h-4 w-4 mr-2" />
              Reportar Fallo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DeliveryLayout>
  );
};

export default DeliveryEntregas;
