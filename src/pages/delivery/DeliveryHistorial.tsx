import { useState } from "react";
import { DeliveryLayout } from "@/components/delivery/DeliveryLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  Search,
  CheckCircle,
  XCircle,
  Calendar,
  Package,
  TrendingUp,
  Clock
} from "lucide-react";

interface EntregaHistorial {
  id: string;
  cliente: string;
  direccion: string;
  fecha: string;
  hora: string;
  estado: "entregado" | "fallido";
  productos: number;
  total: number;
  motivoFallo?: string;
}

const historialData: EntregaHistorial[] = [
  { id: "ENV-100", cliente: "Walmart Centro", direccion: "Av. Insurgentes Sur 1234", fecha: "2024-01-15", hora: "10:45 AM", estado: "entregado", productos: 12, total: 15680 },
  { id: "ENV-099", cliente: "Soriana Norte", direccion: "Blvd. Manuel Ávila Camacho 500", fecha: "2024-01-15", hora: "09:30 AM", estado: "entregado", productos: 8, total: 8920 },
  { id: "ENV-098", cliente: "OXXO Zona 5", direccion: "Av. Universidad 1500", fecha: "2024-01-14", hora: "03:15 PM", estado: "fallido", productos: 5, total: 3450, motivoFallo: "Local cerrado" },
  { id: "ENV-097", cliente: "Bodega Aurrera", direccion: "Calz. de Tlalpan 2500", fecha: "2024-01-14", hora: "01:00 PM", estado: "entregado", productos: 15, total: 22100 },
  { id: "ENV-096", cliente: "Chedraui Express", direccion: "Av. Revolución 800", fecha: "2024-01-14", hora: "11:30 AM", estado: "entregado", productos: 10, total: 12500 },
  { id: "ENV-095", cliente: "7-Eleven Centro", direccion: "Paseo de la Reforma 222", fecha: "2024-01-14", hora: "10:00 AM", estado: "entregado", productos: 6, total: 4200 },
  { id: "ENV-094", cliente: "La Comer", direccion: "Av. Patriotismo 200", fecha: "2024-01-13", hora: "04:30 PM", estado: "entregado", productos: 20, total: 28000 },
  { id: "ENV-093", cliente: "Superama", direccion: "Av. Coyoacán 1500", fecha: "2024-01-13", hora: "02:45 PM", estado: "fallido", productos: 8, total: 9500, motivoFallo: "Cliente rechazó pedido" },
  { id: "ENV-092", cliente: "Fresko", direccion: "Av. Santa Fe 440", fecha: "2024-01-13", hora: "12:00 PM", estado: "entregado", productos: 12, total: 18500 },
  { id: "ENV-091", cliente: "City Market", direccion: "Av. Presidente Masaryk 300", fecha: "2024-01-13", hora: "10:15 AM", estado: "entregado", productos: 15, total: 32000 },
];

const DeliveryHistorial = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterEstado, setFilterEstado] = useState<string>("todos");
  const [filterFecha, setFilterFecha] = useState<string>("todos");

  const filteredHistorial = historialData.filter((entrega) => {
    const matchesSearch =
      entrega.cliente.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entrega.id.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesEstado = filterEstado === "todos" || entrega.estado === filterEstado;
    
    let matchesFecha = true;
    if (filterFecha === "hoy") {
      matchesFecha = entrega.fecha === "2024-01-15";
    } else if (filterFecha === "ayer") {
      matchesFecha = entrega.fecha === "2024-01-14";
    } else if (filterFecha === "semana") {
      matchesFecha = true; // All data is within the week
    }
    
    return matchesSearch && matchesEstado && matchesFecha;
  });

  const stats = {
    total: historialData.length,
    entregados: historialData.filter(e => e.estado === "entregado").length,
    fallidos: historialData.filter(e => e.estado === "fallido").length,
    tasaExito: ((historialData.filter(e => e.estado === "entregado").length / historialData.length) * 100).toFixed(1),
  };

  return (
    <DeliveryLayout title="Historial de Entregas">
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
                <p className="text-xs text-muted-foreground">Total Entregas</p>
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
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-red-500/10 flex items-center justify-center">
                <XCircle className="h-5 w-5 text-red-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.fallidos}</p>
                <p className="text-xs text-muted-foreground">Fallidos</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-amber-500/10 flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.tasaExito}%</p>
                <p className="text-xs text-muted-foreground">Tasa de Éxito</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="border-border mb-6">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por cliente o ID..."
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
                <SelectItem value="entregado">Entregados</SelectItem>
                <SelectItem value="fallido">Fallidos</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterFecha} onValueChange={setFilterFecha}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Fecha" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todas las fechas</SelectItem>
                <SelectItem value="hoy">Hoy</SelectItem>
                <SelectItem value="ayer">Ayer</SelectItem>
                <SelectItem value="semana">Esta semana</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* History List */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle>Historial ({filteredHistorial.length} entregas)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {filteredHistorial.map((entrega) => (
              <div
                key={entrega.id}
                className="flex items-center justify-between rounded-lg border border-border p-4 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className={`h-10 w-10 rounded-full flex items-center justify-center ${
                    entrega.estado === "entregado" ? "bg-green-500/10" : "bg-red-500/10"
                  }`}>
                    {entrega.estado === "entregado" ? (
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    ) : (
                      <XCircle className="h-5 w-5 text-red-500" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{entrega.cliente}</p>
                      <Badge variant={entrega.estado === "entregado" ? "default" : "destructive"}>
                        {entrega.estado === "entregado" ? "Entregado" : "Fallido"}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{entrega.direccion}</p>
                    {entrega.motivoFallo && (
                      <p className="text-sm text-red-500">Motivo: {entrega.motivoFallo}</p>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <Calendar className="h-4 w-4" />
                    <span>{entrega.fecha}</span>
                    <Clock className="h-4 w-4 ml-2" />
                    <span>{entrega.hora}</span>
                  </div>
                  <p className="text-sm">
                    <span className="text-muted-foreground">{entrega.productos} productos</span>
                    <span className="mx-2">•</span>
                    <span className="font-medium">${entrega.total.toLocaleString()}</span>
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </DeliveryLayout>
  );
};

export default DeliveryHistorial;
