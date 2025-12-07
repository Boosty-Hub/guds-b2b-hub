import { useState } from "react";
import { PortalLayout } from "@/components/portal/PortalLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CreditCard, Upload, DollarSign, Clock, CheckCircle, AlertCircle } from "lucide-react";

const pendingInvoices = [
  { id: "FAC-2024-089", date: "2024-01-10", dueDate: "2024-01-25", amount: 3140.0, order: "ORD-045" },
  { id: "FAC-2024-085", date: "2024-01-05", dueDate: "2024-01-20", amount: 4160.0, order: "ORD-044" },
];

const paymentHistory = [
  { id: "PAG-001", date: "2024-01-08", invoice: "FAC-2024-080", amount: 2400.0, method: "Transferencia", status: "verificado" },
  { id: "PAG-002", date: "2024-01-05", invoice: "FAC-2024-078", amount: 5600.0, method: "Depósito", status: "verificado" },
  { id: "PAG-003", date: "2024-01-02", invoice: "FAC-2024-075", amount: 3200.0, method: "Transferencia", status: "verificado" },
  { id: "PAG-004", date: "2023-12-28", invoice: "FAC-2024-070", amount: 8900.0, method: "Cheque", status: "verificado" },
];

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  pendiente: { label: "Pendiente", variant: "secondary" },
  verificando: { label: "Verificando", variant: "outline" },
  verificado: { label: "Verificado", variant: "default" },
  rechazado: { label: "Rechazado", variant: "destructive" as "default" },
};

const PortalPagos = () => {
  const [selectedInvoice, setSelectedInvoice] = useState("");

  const totalPending = pendingInvoices.reduce((sum, inv) => sum + inv.amount, 0);

  return (
    <PortalLayout title="Pagos">
      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <Card className="border-border">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Saldo Pendiente</p>
                <p className="text-2xl font-bold text-foreground">${totalPending.toFixed(2)}</p>
              </div>
              <div className="h-12 w-12 rounded-full bg-amber-500/10 flex items-center justify-center">
                <AlertCircle className="h-6 w-6 text-amber-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Facturas Pendientes</p>
                <p className="text-2xl font-bold text-foreground">{pendingInvoices.length}</p>
              </div>
              <div className="h-12 w-12 rounded-full bg-blue-500/10 flex items-center justify-center">
                <Clock className="h-6 w-6 text-blue-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Pagos del Mes</p>
                <p className="text-2xl font-bold text-foreground">$20,100.00</p>
              </div>
              <div className="h-12 w-12 rounded-full bg-green-500/10 flex items-center justify-center">
                <CheckCircle className="h-6 w-6 text-green-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="pending" className="space-y-4">
        <TabsList>
          <TabsTrigger value="pending">Facturas Pendientes</TabsTrigger>
          <TabsTrigger value="history">Historial de Pagos</TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="space-y-4">
          <div className="flex justify-end">
            <Dialog>
              <DialogTrigger asChild>
                <Button className="gap-2">
                  <CreditCard className="h-4 w-4" />
                  Registrar Pago
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Registrar Pago</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <Label>Factura a pagar</Label>
                    <Select value={selectedInvoice} onValueChange={setSelectedInvoice}>
                      <SelectTrigger>
                        <SelectValue placeholder="Seleccionar factura" />
                      </SelectTrigger>
                      <SelectContent>
                        {pendingInvoices.map((inv) => (
                          <SelectItem key={inv.id} value={inv.id}>
                            {inv.id} - ${inv.amount.toFixed(2)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Método de Pago</Label>
                    <Select>
                      <SelectTrigger>
                        <SelectValue placeholder="Seleccionar método" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="transfer">Transferencia Bancaria</SelectItem>
                        <SelectItem value="deposit">Depósito</SelectItem>
                        <SelectItem value="check">Cheque</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Monto</Label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input type="number" placeholder="0.00" className="pl-9" />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Número de Referencia</Label>
                    <Input placeholder="Ej: 123456789" />
                  </div>

                  <div className="space-y-2">
                    <Label>Comprobante de Pago</Label>
                    <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-primary/50 transition-colors cursor-pointer">
                      <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                      <p className="text-sm text-muted-foreground">
                        Arrastra tu comprobante aquí o haz clic para seleccionar
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        PDF, JPG o PNG (máx. 5MB)
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Notas (opcional)</Label>
                    <Textarea placeholder="Agregar notas adicionales..." />
                  </div>

                  <Button className="w-full">Enviar Pago para Verificación</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <Card className="border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Factura</TableHead>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Vencimiento</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingInvoices.map((invoice) => {
                  const isOverdue = new Date(invoice.dueDate) < new Date();
                  return (
                    <TableRow key={invoice.id}>
                      <TableCell className="font-medium">{invoice.id}</TableCell>
                      <TableCell className="text-primary">{invoice.order}</TableCell>
                      <TableCell className="text-muted-foreground">{invoice.date}</TableCell>
                      <TableCell>
                        <span className={isOverdue ? "text-destructive font-medium" : "text-muted-foreground"}>
                          {invoice.dueDate}
                          {isOverdue && " (Vencida)"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        ${invoice.amount.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm">
                          Pagar
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card className="border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID Pago</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Factura</TableHead>
                  <TableHead>Método</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paymentHistory.map((payment) => (
                  <TableRow key={payment.id}>
                    <TableCell className="font-medium">{payment.id}</TableCell>
                    <TableCell className="text-muted-foreground">{payment.date}</TableCell>
                    <TableCell className="text-primary">{payment.invoice}</TableCell>
                    <TableCell>{payment.method}</TableCell>
                    <TableCell className="text-right font-semibold">
                      ${payment.amount.toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusConfig[payment.status].variant}>
                        {statusConfig[payment.status].label}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </PortalLayout>
  );
};

export default PortalPagos;
