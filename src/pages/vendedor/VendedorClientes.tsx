import { useState } from "react";
import { VendedorLayout } from "@/components/vendedor/VendedorLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
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
  Search, 
  CreditCard, 
  ShoppingCart, 
  Phone, 
  Mail, 
  MapPin,
  Building2,
  DollarSign,
  AlertTriangle,
  CheckCircle,
  Clock
} from "lucide-react";
import { Link } from "react-router-dom";

interface Cliente {
  id: string;
  nombre: string;
  empresa: string;
  telefono: string;
  email: string;
  direccion: string;
  limiteCredito: number;
  creditoUsado: number;
  saldoPendiente: number;
  ultimoPedido: string;
  estado: "activo" | "inactivo" | "suspendido";
  diasCredito: number;
  pagosVencidos: number;
}

const clientesData: Cliente[] = [
  {
    id: "CLI-001",
    nombre: "Juan Pérez",
    empresa: "Walmart Centro",
    telefono: "+52 55 1234 5678",
    email: "juan.perez@walmart.com",
    direccion: "Av. Insurgentes Sur 1234, CDMX",
    limiteCredito: 50000,
    creditoUsado: 35000,
    saldoPendiente: 12500,
    ultimoPedido: "2024-01-10",
    estado: "activo",
    diasCredito: 30,
    pagosVencidos: 0,
  },
  {
    id: "CLI-002",
    nombre: "María García",
    empresa: "Soriana Norte",
    telefono: "+52 81 9876 5432",
    email: "maria.garcia@soriana.com",
    direccion: "Blvd. Rogelio Cantú 500, Monterrey",
    limiteCredito: 75000,
    creditoUsado: 68000,
    saldoPendiente: 28000,
    ultimoPedido: "2024-01-08",
    estado: "activo",
    diasCredito: 45,
    pagosVencidos: 1,
  },
  {
    id: "CLI-003",
    nombre: "Roberto Sánchez",
    empresa: "OXXO Zona 5",
    telefono: "+52 33 5555 1234",
    email: "roberto.sanchez@oxxo.com",
    direccion: "Av. Vallarta 2500, Guadalajara",
    limiteCredito: 30000,
    creditoUsado: 15000,
    saldoPendiente: 5000,
    ultimoPedido: "2024-01-12",
    estado: "activo",
    diasCredito: 15,
    pagosVencidos: 0,
  },
  {
    id: "CLI-004",
    nombre: "Ana López",
    empresa: "Bodega Aurrera",
    telefono: "+52 55 4444 3333",
    email: "ana.lopez@bodega.com",
    direccion: "Calz. de Tlalpan 1500, CDMX",
    limiteCredito: 40000,
    creditoUsado: 38000,
    saldoPendiente: 18000,
    ultimoPedido: "2024-01-05",
    estado: "activo",
    diasCredito: 30,
    pagosVencidos: 2,
  },
  {
    id: "CLI-005",
    nombre: "Carlos Ramírez",
    empresa: "Chedraui Express",
    telefono: "+52 229 8888 7777",
    email: "carlos.ramirez@chedraui.com",
    direccion: "Av. Ruiz Cortines 100, Veracruz",
    limiteCredito: 60000,
    creditoUsado: 45000,
    saldoPendiente: 32000,
    ultimoPedido: "2024-01-02",
    estado: "suspendido",
    diasCredito: 30,
    pagosVencidos: 3,
  },
  {
    id: "CLI-006",
    nombre: "Laura Martínez",
    empresa: "7-Eleven Centro",
    telefono: "+52 55 2222 1111",
    email: "laura.martinez@7eleven.com",
    direccion: "Paseo de la Reforma 222, CDMX",
    limiteCredito: 25000,
    creditoUsado: 8000,
    saldoPendiente: 0,
    ultimoPedido: "2023-12-20",
    estado: "activo",
    diasCredito: 15,
    pagosVencidos: 0,
  },
];

const VendedorClientes = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCliente, setSelectedCliente] = useState<Cliente | null>(null);

  const filteredClientes = clientesData.filter(
    (cliente) =>
      cliente.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
      cliente.empresa.toLowerCase().includes(searchTerm.toLowerCase()) ||
      cliente.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getCreditoStatus = (cliente: Cliente) => {
    const porcentaje = (cliente.creditoUsado / cliente.limiteCredito) * 100;
    if (porcentaje >= 90) return { color: "text-red-500", bg: "bg-red-500", label: "Crítico" };
    if (porcentaje >= 70) return { color: "text-amber-500", bg: "bg-amber-500", label: "Alto" };
    return { color: "text-green-500", bg: "bg-green-500", label: "Normal" };
  };

  const getEstadoBadge = (estado: string) => {
    switch (estado) {
      case "activo":
        return <Badge className="bg-green-500/10 text-green-500 hover:bg-green-500/20">Activo</Badge>;
      case "suspendido":
        return <Badge variant="destructive">Suspendido</Badge>;
      default:
        return <Badge variant="secondary">Inactivo</Badge>;
    }
  };

  return (
    <VendedorLayout title="Mis Clientes">
      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4 mb-6">
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-blue-500/10 flex items-center justify-center">
                <Building2 className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{clientesData.length}</p>
                <p className="text-xs text-muted-foreground">Total Clientes</p>
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
                <p className="text-2xl font-bold">{clientesData.filter(c => c.estado === "activo").length}</p>
                <p className="text-xs text-muted-foreground">Activos</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-amber-500/10 flex items-center justify-center">
                <Clock className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">${clientesData.reduce((acc, c) => acc + c.saldoPendiente, 0).toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Saldo Total</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-red-500/10 flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-red-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{clientesData.filter(c => c.pagosVencidos > 0).length}</p>
                <p className="text-xs text-muted-foreground">Con Pagos Vencidos</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <Card className="border-border mb-6">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nombre, empresa o ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      {/* Clients Table */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle>Lista de Clientes Asignados</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Línea de Crédito</TableHead>
                <TableHead>Saldo Pendiente</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Último Pedido</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredClientes.map((cliente) => {
                const creditoStatus = getCreditoStatus(cliente);
                const porcentajeCredito = (cliente.creditoUsado / cliente.limiteCredito) * 100;
                
                return (
                  <TableRow key={cliente.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{cliente.empresa}</p>
                        <p className="text-sm text-muted-foreground">{cliente.nombre}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className={creditoStatus.color}>
                            ${cliente.creditoUsado.toLocaleString()} / ${cliente.limiteCredito.toLocaleString()}
                          </span>
                        </div>
                        <Progress value={porcentajeCredito} className="h-2" />
                        <p className="text-xs text-muted-foreground">
                          {porcentajeCredito.toFixed(0)}% utilizado • {creditoStatus.label}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className={cliente.saldoPendiente > 0 ? "text-amber-500 font-medium" : "text-green-500"}>
                          ${cliente.saldoPendiente.toLocaleString()}
                        </span>
                        {cliente.pagosVencidos > 0 && (
                          <Badge variant="destructive" className="text-xs">
                            {cliente.pagosVencidos} vencido{cliente.pagosVencidos > 1 ? "s" : ""}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{getEstadoBadge(cliente.estado)}</TableCell>
                    <TableCell className="text-muted-foreground">{cliente.ultimoPedido}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedCliente(cliente)}
                        >
                          Ver Detalle
                        </Button>
                        <Link to={`/vendedor/pedidos?cliente=${cliente.id}`}>
                          <Button size="sm" className="bg-emerald-500 hover:bg-emerald-600">
                            <ShoppingCart className="h-4 w-4 mr-1" />
                            Pedido
                          </Button>
                        </Link>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Client Detail Dialog */}
      <Dialog open={!!selectedCliente} onOpenChange={() => setSelectedCliente(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Detalle del Cliente</DialogTitle>
          </DialogHeader>
          {selectedCliente && (
            <div className="space-y-6">
              {/* Client Info */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Empresa</p>
                    <p className="font-semibold text-lg">{selectedCliente.empresa}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Contacto</p>
                    <p className="font-medium">{selectedCliente.nombre}</p>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    <span>{selectedCliente.telefono}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <span>{selectedCliente.email}</span>
                  </div>
                  <div className="flex items-start gap-2 text-sm">
                    <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <span>{selectedCliente.direccion}</span>
                  </div>
                </div>

                <div className="space-y-4">
                  {/* Credit Card */}
                  <Card className="border-border">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <CreditCard className="h-5 w-5 text-emerald-500" />
                        <span className="font-medium">Línea de Crédito</span>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Límite</span>
                          <span className="font-medium">${selectedCliente.limiteCredito.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Utilizado</span>
                          <span className="font-medium">${selectedCliente.creditoUsado.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Disponible</span>
                          <span className="font-medium text-green-500">
                            ${(selectedCliente.limiteCredito - selectedCliente.creditoUsado).toLocaleString()}
                          </span>
                        </div>
                        <Progress 
                          value={(selectedCliente.creditoUsado / selectedCliente.limiteCredito) * 100} 
                          className="h-2 mt-2" 
                        />
                      </div>
                    </CardContent>
                  </Card>

                  {/* Balance Card */}
                  <Card className="border-border">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <DollarSign className="h-5 w-5 text-amber-500" />
                        <span className="font-medium">Saldo Pendiente</span>
                      </div>
                      <p className="text-2xl font-bold">${selectedCliente.saldoPendiente.toLocaleString()}</p>
                      <p className="text-sm text-muted-foreground">
                        Días de crédito: {selectedCliente.diasCredito} días
                      </p>
                      {selectedCliente.pagosVencidos > 0 && (
                        <Badge variant="destructive" className="mt-2">
                          {selectedCliente.pagosVencidos} pago(s) vencido(s)
                        </Badge>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-4 border-t">
                <Link to={`/vendedor/pedidos?cliente=${selectedCliente.id}`} className="flex-1">
                  <Button className="w-full bg-emerald-500 hover:bg-emerald-600">
                    <ShoppingCart className="h-4 w-4 mr-2" />
                    Crear Pedido
                  </Button>
                </Link>
                <Link to={`/vendedor/pagos?cliente=${selectedCliente.id}`} className="flex-1">
                  <Button variant="outline" className="w-full">
                    <CreditCard className="h-4 w-4 mr-2" />
                    Registrar Pago
                  </Button>
                </Link>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </VendedorLayout>
  );
};

export default VendedorClientes;
