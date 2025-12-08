import { useState } from "react";
import { VendedorLayout } from "@/components/vendedor/VendedorLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  DialogTrigger,
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
  Plus, 
  Search, 
  CreditCard,
  DollarSign,
  Calendar,
  FileText,
  CheckCircle,
  Clock,
  AlertCircle,
  Upload
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Pago {
  id: string;
  cliente: string;
  fecha: string;
  monto: number;
  metodo: string;
  referencia: string;
  estado: "pendiente" | "verificado" | "rechazado";
  notas: string;
}

interface ClienteConSaldo {
  id: string;
  nombre: string;
  saldoPendiente: number;
  pagosVencidos: number;
}

const clientesConSaldo: ClienteConSaldo[] = [
  { id: "CLI-001", nombre: "Walmart Centro", saldoPendiente: 12500, pagosVencidos: 0 },
  { id: "CLI-002", nombre: "Soriana Norte", saldoPendiente: 28000, pagosVencidos: 1 },
  { id: "CLI-003", nombre: "OXXO Zona 5", saldoPendiente: 5000, pagosVencidos: 0 },
  { id: "CLI-004", nombre: "Bodega Aurrera", saldoPendiente: 18000, pagosVencidos: 2 },
  { id: "CLI-005", nombre: "Chedraui Express", saldoPendiente: 32000, pagosVencidos: 3 },
];

const pagosRegistrados: Pago[] = [
  { 
    id: "PAG-2024-001", 
    cliente: "Walmart Centro", 
    fecha: "2024-01-15", 
    monto: 8500, 
    metodo: "Transferencia", 
    referencia: "TRF-123456",
    estado: "verificado",
    notas: "Pago parcial de factura F-2024-089"
  },
  { 
    id: "PAG-2024-002", 
    cliente: "Soriana Norte", 
    fecha: "2024-01-14", 
    monto: 15000, 
    metodo: "Depósito", 
    referencia: "DEP-789012",
    estado: "pendiente",
    notas: "Pago de facturas vencidas"
  },
  { 
    id: "PAG-2024-003", 
    cliente: "OXXO Zona 5", 
    fecha: "2024-01-13", 
    monto: 3450, 
    metodo: "Transferencia", 
    referencia: "TRF-345678",
    estado: "verificado",
    notas: ""
  },
  { 
    id: "PAG-2024-004", 
    cliente: "Bodega Aurrera", 
    fecha: "2024-01-12", 
    monto: 10000, 
    metodo: "Cheque", 
    referencia: "CHQ-901234",
    estado: "pendiente",
    notas: "Cheque a 15 días"
  },
  { 
    id: "PAG-2024-005", 
    cliente: "Chedraui Express", 
    fecha: "2024-01-10", 
    monto: 5000, 
    metodo: "Efectivo", 
    referencia: "EFE-567890",
    estado: "rechazado",
    notas: "Monto no coincide con recibo"
  },
];

const metodosPago = [
  { value: "transferencia", label: "Transferencia Bancaria" },
  { value: "deposito", label: "Depósito en Efectivo" },
  { value: "cheque", label: "Cheque" },
  { value: "efectivo", label: "Efectivo" },
  { value: "tarjeta", label: "Tarjeta de Crédito/Débito" },
];

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive"; icon: any }> = {
  pendiente: { label: "Pendiente", variant: "secondary", icon: Clock },
  verificado: { label: "Verificado", variant: "default", icon: CheckCircle },
  rechazado: { label: "Rechazado", variant: "destructive", icon: AlertCircle },
};

const VendedorPagos = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [clienteSeleccionado, setClienteSeleccionado] = useState("");
  const [monto, setMonto] = useState("");
  const [metodoPago, setMetodoPago] = useState("");
  const [referencia, setReferencia] = useState("");
  const [notas, setNotas] = useState("");
  const { toast } = useToast();

  const filteredPagos = pagosRegistrados.filter(
    (pago) =>
      pago.cliente.toLowerCase().includes(searchTerm.toLowerCase()) ||
      pago.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      pago.referencia.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const clienteInfo = clientesConSaldo.find(c => c.id === clienteSeleccionado);

  const registrarPago = () => {
    if (!clienteSeleccionado || !monto || !metodoPago || !referencia) {
      toast({
        title: "Error",
        description: "Completa todos los campos requeridos",
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Pago Registrado",
      description: `Pago de $${parseFloat(monto).toLocaleString()} registrado para ${clienteInfo?.nombre}`,
    });

    setClienteSeleccionado("");
    setMonto("");
    setMetodoPago("");
    setReferencia("");
    setNotas("");
    setIsDialogOpen(false);
  };

  const totalPagosVerificados = pagosRegistrados
    .filter(p => p.estado === "verificado")
    .reduce((acc, p) => acc + p.monto, 0);

  const totalPagosPendientes = pagosRegistrados
    .filter(p => p.estado === "pendiente")
    .reduce((acc, p) => acc + p.monto, 0);

  return (
    <VendedorLayout title="Pagos">
      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4 mb-6">
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-green-500/10 flex items-center justify-center">
                <CheckCircle className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">${totalPagosVerificados.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Verificados</p>
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
                <p className="text-2xl font-bold">${totalPagosPendientes.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Pendientes</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-blue-500/10 flex items-center justify-center">
                <FileText className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{pagosRegistrados.length}</p>
                <p className="text-xs text-muted-foreground">Total Registros</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-red-500/10 flex items-center justify-center">
                <AlertCircle className="h-5 w-5 text-red-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{clientesConSaldo.filter(c => c.pagosVencidos > 0).length}</p>
                <p className="text-xs text-muted-foreground">Clientes con Vencidos</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="historial" className="space-y-6">
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="historial">Historial de Pagos</TabsTrigger>
            <TabsTrigger value="registrar">Registrar Pago</TabsTrigger>
            <TabsTrigger value="saldos">Saldos Pendientes</TabsTrigger>
          </TabsList>
        </div>

        {/* Historial de Pagos */}
        <TabsContent value="historial" className="space-y-4">
          <Card className="border-border">
            <CardContent className="p-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar por cliente, ID o referencia..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader>
              <CardTitle>Pagos Registrados</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Monto</TableHead>
                    <TableHead>Método</TableHead>
                    <TableHead>Referencia</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPagos.map((pago) => {
                    const StatusIcon = statusConfig[pago.estado].icon;
                    return (
                      <TableRow key={pago.id}>
                        <TableCell className="font-medium">{pago.id}</TableCell>
                        <TableCell>{pago.cliente}</TableCell>
                        <TableCell>{pago.fecha}</TableCell>
                        <TableCell className="font-medium">${pago.monto.toLocaleString()}</TableCell>
                        <TableCell>{pago.metodo}</TableCell>
                        <TableCell className="text-muted-foreground">{pago.referencia}</TableCell>
                        <TableCell>
                          <Badge variant={statusConfig[pago.estado].variant} className="gap-1">
                            <StatusIcon className="h-3 w-3" />
                            {statusConfig[pago.estado].label}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Registrar Pago */}
        <TabsContent value="registrar" className="space-y-4">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="border-border">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <CreditCard className="h-5 w-5 text-emerald-500" />
                  Registrar Nuevo Pago
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Cliente *</Label>
                  <Select value={clienteSeleccionado} onValueChange={setClienteSeleccionado}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona un cliente" />
                    </SelectTrigger>
                    <SelectContent>
                      {clientesConSaldo.map((cliente) => (
                        <SelectItem key={cliente.id} value={cliente.id}>
                          <div className="flex items-center justify-between w-full">
                            <span>{cliente.nombre}</span>
                            <span className="text-muted-foreground ml-2">
                              (Saldo: ${cliente.saldoPendiente.toLocaleString()})
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Monto del Pago *</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      type="number"
                      placeholder="0.00"
                      value={monto}
                      onChange={(e) => setMonto(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Método de Pago *</Label>
                  <Select value={metodoPago} onValueChange={setMetodoPago}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona método de pago" />
                    </SelectTrigger>
                    <SelectContent>
                      {metodosPago.map((metodo) => (
                        <SelectItem key={metodo.value} value={metodo.value}>
                          {metodo.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Número de Referencia *</Label>
                  <Input
                    placeholder="Ej: TRF-123456, CHQ-789012"
                    value={referencia}
                    onChange={(e) => setReferencia(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Notas (Opcional)</Label>
                  <Textarea
                    placeholder="Información adicional sobre el pago..."
                    value={notas}
                    onChange={(e) => setNotas(e.target.value)}
                    rows={3}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Comprobante (Opcional)</Label>
                  <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-emerald-500/50 transition-colors cursor-pointer">
                    <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">
                      Arrastra o haz clic para subir comprobante
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      PDF, JPG, PNG (máx. 5MB)
                    </p>
                  </div>
                </div>

                <Button
                  className="w-full bg-emerald-500 hover:bg-emerald-600"
                  size="lg"
                  onClick={registrarPago}
                >
                  <CreditCard className="h-4 w-4 mr-2" />
                  Registrar Pago
                </Button>
              </CardContent>
            </Card>

            {/* Info del Cliente Seleccionado */}
            <Card className="border-border">
              <CardHeader>
                <CardTitle className="text-lg">Información del Cliente</CardTitle>
              </CardHeader>
              <CardContent>
                {clienteInfo ? (
                  <div className="space-y-4">
                    <div className="rounded-lg bg-muted p-4">
                      <p className="font-semibold text-lg">{clienteInfo.nombre}</p>
                      <p className="text-sm text-muted-foreground">ID: {clienteInfo.id}</p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="rounded-lg border border-border p-4">
                        <p className="text-sm text-muted-foreground">Saldo Pendiente</p>
                        <p className="text-2xl font-bold text-amber-500">
                          ${clienteInfo.saldoPendiente.toLocaleString()}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border p-4">
                        <p className="text-sm text-muted-foreground">Pagos Vencidos</p>
                        <p className={`text-2xl font-bold ${clienteInfo.pagosVencidos > 0 ? "text-red-500" : "text-green-500"}`}>
                          {clienteInfo.pagosVencidos}
                        </p>
                      </div>
                    </div>

                    {monto && (
                      <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-4">
                        <p className="text-sm text-muted-foreground">Nuevo Saldo Después del Pago</p>
                        <p className="text-2xl font-bold text-emerald-500">
                          ${Math.max(0, clienteInfo.saldoPendiente - parseFloat(monto || "0")).toLocaleString()}
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <CreditCard className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Selecciona un cliente para ver su información</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Saldos Pendientes */}
        <TabsContent value="saldos" className="space-y-4">
          <Card className="border-border">
            <CardHeader>
              <CardTitle>Saldos Pendientes por Cliente</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Saldo Pendiente</TableHead>
                    <TableHead>Pagos Vencidos</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clientesConSaldo.map((cliente) => (
                    <TableRow key={cliente.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{cliente.nombre}</p>
                          <p className="text-sm text-muted-foreground">{cliente.id}</p>
                        </div>
                      </TableCell>
                      <TableCell className="font-medium text-amber-500">
                        ${cliente.saldoPendiente.toLocaleString()}
                      </TableCell>
                      <TableCell>
                        {cliente.pagosVencidos > 0 ? (
                          <Badge variant="destructive">{cliente.pagosVencidos} vencido(s)</Badge>
                        ) : (
                          <Badge variant="secondary">Al día</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {cliente.pagosVencidos >= 3 ? (
                          <Badge variant="destructive">Crítico</Badge>
                        ) : cliente.pagosVencidos > 0 ? (
                          <Badge className="bg-amber-500/10 text-amber-500">Atención</Badge>
                        ) : (
                          <Badge className="bg-green-500/10 text-green-500">Normal</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          className="bg-emerald-500 hover:bg-emerald-600"
                          onClick={() => {
                            setClienteSeleccionado(cliente.id);
                            // Switch to registrar tab would go here
                          }}
                        >
                          <CreditCard className="h-4 w-4 mr-1" />
                          Registrar Pago
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </VendedorLayout>
  );
};

export default VendedorPagos;
