import { useState, useEffect, useRef } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Truck, 
  Package, 
  MapPin, 
  Clock, 
  CheckCircle, 
  Search,
  MoreHorizontal,
  Eye,
  UserPlus,
  Navigation,
  Phone,
  Calendar,
  AlertCircle,
  XCircle
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { LiveDeliveryMap } from "@/components/delivery/LiveDeliveryMap";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

mapboxgl.accessToken = "pk.eyJ1IjoiZ3VkcyIsImEiOiJjbWt3cHR5emswMXE2M2ZuYngwcDJybXF6In0.k_RC8LITMponN_6XwIXARA";

interface Envio {
  id: string;
  pedidoId: string;
  cliente: string;
  direccion: string;
  telefono: string;
  repartidor: string | null;
  estado: "pendiente" | "asignado" | "en_ruta" | "entregado" | "fallido";
  fechaCreacion: string;
  fechaEntrega: string | null;
  coordenadas: { lat: number; lng: number };
  productos: number;
  total: number;
  notas: string;
}

interface Repartidor {
  id: string;
  nombre: string;
  telefono: string;
  vehiculo: string;
  estado: "disponible" | "en_ruta" | "no_disponible";
  enviosHoy: number;
  zona: string;
}

const enviosData: Envio[] = [
  {
    id: "ENV-001",
    pedidoId: "PED-2024-045",
    cliente: "Walmart Centro",
    direccion: "Av. Insurgentes Sur 1234, Col. Del Valle, CDMX",
    telefono: "+52 55 1234 5678",
    repartidor: "Carlos Ruiz",
    estado: "en_ruta",
    fechaCreacion: "2024-01-15 08:30",
    fechaEntrega: null,
    coordenadas: { lat: 19.3910, lng: -99.1775 },
    productos: 12,
    total: 15680,
    notas: "Entregar en almacén trasero"
  },
  {
    id: "ENV-002",
    pedidoId: "PED-2024-044",
    cliente: "Soriana Norte",
    direccion: "Blvd. Manuel Ávila Camacho 500, Naucalpan",
    telefono: "+52 55 9876 5432",
    repartidor: "Miguel Torres",
    estado: "asignado",
    fechaCreacion: "2024-01-15 09:15",
    fechaEntrega: null,
    coordenadas: { lat: 19.4785, lng: -99.2385 },
    productos: 8,
    total: 8920,
    notas: ""
  },
  {
    id: "ENV-003",
    pedidoId: "PED-2024-043",
    cliente: "OXXO Zona 5",
    direccion: "Av. Universidad 1500, Col. Narvarte, CDMX",
    telefono: "+52 55 5555 1234",
    repartidor: null,
    estado: "pendiente",
    fechaCreacion: "2024-01-15 10:00",
    fechaEntrega: null,
    coordenadas: { lat: 19.3856, lng: -99.1569 },
    productos: 5,
    total: 3450,
    notas: "Llamar antes de llegar"
  },
  {
    id: "ENV-004",
    pedidoId: "PED-2024-042",
    cliente: "Bodega Aurrera",
    direccion: "Calz. de Tlalpan 2500, Col. Xoco, CDMX",
    telefono: "+52 55 4444 3333",
    repartidor: "Carlos Ruiz",
    estado: "entregado",
    fechaCreacion: "2024-01-15 07:00",
    fechaEntrega: "2024-01-15 11:30",
    coordenadas: { lat: 19.3650, lng: -99.1520 },
    productos: 15,
    total: 22100,
    notas: ""
  },
  {
    id: "ENV-005",
    pedidoId: "PED-2024-041",
    cliente: "7-Eleven Centro",
    direccion: "Paseo de la Reforma 222, Col. Juárez, CDMX",
    telefono: "+52 55 2222 1111",
    repartidor: "Ana García",
    estado: "fallido",
    fechaCreacion: "2024-01-14 14:00",
    fechaEntrega: null,
    coordenadas: { lat: 19.4270, lng: -99.1677 },
    productos: 6,
    total: 4200,
    notas: "Local cerrado - reprogramar"
  },
];

const repartidoresData: Repartidor[] = [
  { id: "REP-001", nombre: "Carlos Ruiz", telefono: "+52 55 1111 2222", vehiculo: "Camioneta Ford", estado: "en_ruta", enviosHoy: 5, zona: "Centro" },
  { id: "REP-002", nombre: "Miguel Torres", telefono: "+52 55 3333 4444", vehiculo: "Camioneta Nissan", estado: "en_ruta", enviosHoy: 3, zona: "Norte" },
  { id: "REP-003", nombre: "Ana García", telefono: "+52 55 5555 6666", vehiculo: "Camioneta Chevrolet", estado: "disponible", enviosHoy: 4, zona: "Sur" },
  { id: "REP-004", nombre: "Roberto López", telefono: "+52 55 7777 8888", vehiculo: "Camioneta Toyota", estado: "disponible", enviosHoy: 0, zona: "Poniente" },
  { id: "REP-005", nombre: "Laura Méndez", telefono: "+52 55 9999 0000", vehiculo: "Camioneta Honda", estado: "no_disponible", enviosHoy: 6, zona: "Oriente" },
];

const estadoConfig: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive"; color: string }> = {
  pendiente: { label: "Pendiente", variant: "secondary", color: "text-gray-500" },
  asignado: { label: "Asignado", variant: "outline", color: "text-blue-500" },
  en_ruta: { label: "En Ruta", variant: "default", color: "text-amber-500" },
  entregado: { label: "Entregado", variant: "default", color: "text-green-500" },
  fallido: { label: "Fallido", variant: "destructive", color: "text-red-500" },
};

const Delivery = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterEstado, setFilterEstado] = useState<string>("todos");
  const [selectedEnvio, setSelectedEnvio] = useState<Envio | null>(null);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [envioToAssign, setEnvioToAssign] = useState<Envio | null>(null);
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const { toast } = useToast();

  const filteredEnvios = enviosData.filter((envio) => {
    const matchesSearch =
      envio.cliente.toLowerCase().includes(searchTerm.toLowerCase()) ||
      envio.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      envio.pedidoId.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesEstado = filterEstado === "todos" || envio.estado === filterEstado;
    return matchesSearch && matchesEstado;
  });

  useEffect(() => {
    if (map.current || !mapContainer.current) return;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [-99.1332, 19.4326],
      zoom: 11,
    });

    map.current.addControl(new mapboxgl.NavigationControl(), "top-right");

    // Add markers for each delivery
    enviosData.forEach((envio) => {
      const color = envio.estado === "entregado" ? "#22c55e" : 
                    envio.estado === "en_ruta" ? "#f59e0b" :
                    envio.estado === "fallido" ? "#ef4444" : "#6b7280";
      
      const marker = new mapboxgl.Marker({ color })
        .setLngLat([envio.coordenadas.lng, envio.coordenadas.lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 25 }).setHTML(`
            <div style="padding: 8px;">
              <strong>${envio.cliente}</strong><br/>
              <span style="color: #666; font-size: 12px;">${envio.id}</span><br/>
              <span style="color: ${color}; font-weight: 500;">${estadoConfig[envio.estado].label}</span>
            </div>
          `)
        )
        .addTo(map.current!);
    });

    return () => {
      map.current?.remove();
    };
  }, []);

  const handleAssignRepartidor = (repartidorId: string) => {
    const repartidor = repartidoresData.find(r => r.id === repartidorId);
    toast({
      title: "Repartidor Asignado",
      description: `${repartidor?.nombre} asignado al envío ${envioToAssign?.id}`,
    });
    setAssignDialogOpen(false);
    setEnvioToAssign(null);
  };

  const stats = {
    total: enviosData.length,
    pendientes: enviosData.filter(e => e.estado === "pendiente").length,
    enRuta: enviosData.filter(e => e.estado === "en_ruta").length,
    entregados: enviosData.filter(e => e.estado === "entregado").length,
  };

  return (
    <MainLayout title="Gestión de Envíos">
      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4 mb-6">
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-blue-500/10 flex items-center justify-center">
                <Package className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.total}</p>
                <p className="text-xs text-muted-foreground">Total Envíos</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-gray-500/10 flex items-center justify-center">
                <Clock className="h-5 w-5 text-gray-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.pendientes}</p>
                <p className="text-xs text-muted-foreground">Pendientes</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-amber-500/10 flex items-center justify-center">
                <Truck className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.enRuta}</p>
                <p className="text-xs text-muted-foreground">En Ruta</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-green-500/10 flex items-center justify-center">
                <CheckCircle className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.entregados}</p>
                <p className="text-xs text-muted-foreground">Entregados</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="envios" className="space-y-6">
        <TabsList>
          <TabsTrigger value="envios">Envíos</TabsTrigger>
          <TabsTrigger value="mapa">Mapa en Vivo</TabsTrigger>
          <TabsTrigger value="repartidores">Repartidores</TabsTrigger>
        </TabsList>

        {/* Envíos Tab */}
        <TabsContent value="envios" className="space-y-4">
          <Card className="border-border">
            <CardContent className="p-4">
              <div className="flex flex-col md:flex-row gap-4 items-center">
                <div className="relative flex-1 w-full md:max-w-sm">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Buscar por cliente, ID o pedido..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <Select value={filterEstado} onValueChange={setFilterEstado}>
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="Estado" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos</SelectItem>
                    <SelectItem value="pendiente">Pendientes</SelectItem>
                    <SelectItem value="asignado">Asignados</SelectItem>
                    <SelectItem value="en_ruta">En Ruta</SelectItem>
                    <SelectItem value="entregado">Entregados</SelectItem>
                    <SelectItem value="fallido">Fallidos</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader>
              <CardTitle>Lista de Envíos ({filteredEnvios.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Envío</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Dirección</TableHead>
                    <TableHead>Repartidor</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEnvios.map((envio) => (
                    <TableRow key={envio.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{envio.id}</p>
                          <p className="text-sm text-muted-foreground">{envio.pedidoId}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">{envio.cliente}</p>
                          <p className="text-sm text-muted-foreground">{envio.productos} productos</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-start gap-2 max-w-xs">
                          <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                          <span className="text-sm truncate">{envio.direccion}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {envio.repartidor ? (
                          <div className="flex items-center gap-2">
                            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                              <span className="text-xs font-medium text-primary">
                                {envio.repartidor.split(" ").map(n => n[0]).join("")}
                              </span>
                            </div>
                            <span className="text-sm">{envio.repartidor}</span>
                          </div>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            Sin asignar
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={estadoConfig[envio.estado].variant}>
                          {estadoConfig[envio.estado].label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setSelectedEnvio(envio)}>
                              <Eye className="h-4 w-4 mr-2" />
                              Ver Detalle
                            </DropdownMenuItem>
                            {envio.estado === "pendiente" && (
                              <DropdownMenuItem onClick={() => {
                                setEnvioToAssign(envio);
                                setAssignDialogOpen(true);
                              }}>
                                <UserPlus className="h-4 w-4 mr-2" />
                                Asignar Repartidor
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem>
                              <Navigation className="h-4 w-4 mr-2" />
                              Ver en Mapa
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Mapa Tab */}
        {/* Mapa en Vivo Tab */}
        <TabsContent value="mapa">
          <LiveDeliveryMap />
        </TabsContent>

        {/* Repartidores Tab */}
        <TabsContent value="repartidores">
          <Card className="border-border">
            <CardHeader>
              <CardTitle>Repartidores</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {repartidoresData.map((repartidor) => (
                  <Card key={repartidor.id} className="border-border">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className={`h-12 w-12 rounded-full flex items-center justify-center ${
                            repartidor.estado === "disponible" ? "bg-green-500/10" :
                            repartidor.estado === "en_ruta" ? "bg-amber-500/10" : "bg-gray-500/10"
                          }`}>
                            <Truck className={`h-6 w-6 ${
                              repartidor.estado === "disponible" ? "text-green-500" :
                              repartidor.estado === "en_ruta" ? "text-amber-500" : "text-gray-500"
                            }`} />
                          </div>
                          <div>
                            <p className="font-medium">{repartidor.nombre}</p>
                            <p className="text-sm text-muted-foreground">{repartidor.vehiculo}</p>
                          </div>
                        </div>
                        <Badge variant={
                          repartidor.estado === "disponible" ? "default" :
                          repartidor.estado === "en_ruta" ? "secondary" : "outline"
                        }>
                          {repartidor.estado === "disponible" ? "Disponible" :
                           repartidor.estado === "en_ruta" ? "En Ruta" : "No Disponible"}
                        </Badge>
                      </div>
                      <div className="space-y-2 text-sm">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Phone className="h-4 w-4" />
                          <span>{repartidor.telefono}</span>
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <MapPin className="h-4 w-4" />
                          <span>Zona {repartidor.zona}</span>
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Package className="h-4 w-4" />
                          <span>{repartidor.enviosHoy} envíos hoy</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Envio Detail Dialog */}
      <Dialog open={!!selectedEnvio} onOpenChange={() => setSelectedEnvio(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Detalle del Envío</DialogTitle>
          </DialogHeader>
          {selectedEnvio && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xl font-bold">{selectedEnvio.id}</p>
                  <p className="text-muted-foreground">Pedido: {selectedEnvio.pedidoId}</p>
                </div>
                <Badge variant={estadoConfig[selectedEnvio.estado].variant} className="text-base px-4 py-1">
                  {estadoConfig[selectedEnvio.estado].label}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Card className="border-border">
                  <CardContent className="p-4">
                    <p className="text-sm text-muted-foreground mb-1">Cliente</p>
                    <p className="font-semibold">{selectedEnvio.cliente}</p>
                    <div className="flex items-center gap-2 mt-2 text-sm text-muted-foreground">
                      <Phone className="h-4 w-4" />
                      <span>{selectedEnvio.telefono}</span>
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-border">
                  <CardContent className="p-4">
                    <p className="text-sm text-muted-foreground mb-1">Repartidor</p>
                    {selectedEnvio.repartidor ? (
                      <p className="font-semibold">{selectedEnvio.repartidor}</p>
                    ) : (
                      <p className="text-muted-foreground">Sin asignar</p>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card className="border-border">
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground mb-1">Dirección de Entrega</p>
                  <div className="flex items-start gap-2">
                    <MapPin className="h-5 w-5 text-primary mt-0.5" />
                    <p className="font-medium">{selectedEnvio.direccion}</p>
                  </div>
                  {selectedEnvio.notas && (
                    <div className="mt-3 p-3 bg-muted rounded-lg">
                      <p className="text-sm"><strong>Notas:</strong> {selectedEnvio.notas}</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-2xl font-bold">{selectedEnvio.productos}</p>
                  <p className="text-sm text-muted-foreground">Productos</p>
                </div>
                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-2xl font-bold">${selectedEnvio.total.toLocaleString()}</p>
                  <p className="text-sm text-muted-foreground">Total</p>
                </div>
                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-2xl font-bold">{selectedEnvio.fechaCreacion.split(" ")[1]}</p>
                  <p className="text-sm text-muted-foreground">Hora Creación</p>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Assign Repartidor Dialog */}
      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Asignar Repartidor</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-muted-foreground">
              Selecciona un repartidor para el envío <strong>{envioToAssign?.id}</strong>
            </p>
            <div className="space-y-2">
              {repartidoresData.filter(r => r.estado !== "no_disponible").map((repartidor) => (
                <div
                  key={repartidor.id}
                  className="flex items-center justify-between rounded-lg border border-border p-3 hover:bg-muted/50 cursor-pointer transition-colors"
                  onClick={() => handleAssignRepartidor(repartidor.id)}
                >
                  <div className="flex items-center gap-3">
                    <div className={`h-10 w-10 rounded-full flex items-center justify-center ${
                      repartidor.estado === "disponible" ? "bg-green-500/10" : "bg-amber-500/10"
                    }`}>
                      <Truck className={`h-5 w-5 ${
                        repartidor.estado === "disponible" ? "text-green-500" : "text-amber-500"
                      }`} />
                    </div>
                    <div>
                      <p className="font-medium">{repartidor.nombre}</p>
                      <p className="text-sm text-muted-foreground">Zona {repartidor.zona} • {repartidor.enviosHoy} envíos hoy</p>
                    </div>
                  </div>
                  <Badge variant={repartidor.estado === "disponible" ? "default" : "secondary"}>
                    {repartidor.estado === "disponible" ? "Disponible" : "En Ruta"}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
};

export default Delivery;
