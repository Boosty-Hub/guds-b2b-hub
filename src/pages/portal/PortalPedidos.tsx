import { useState } from "react";
import { PortalLayout } from "@/components/portal/PortalLayout";
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
import { Search, Eye, Package, Truck, CheckCircle, Clock, MapPin } from "lucide-react";

const orders = [
  {
    id: "ORD-045",
    date: "2024-01-15",
    delivery: "2024-01-17",
    items: [
      { name: "Aceite Vegetal 5L", quantity: 10, price: 89.0 },
      { name: "Arroz Grano Largo 25kg", quantity: 5, price: 450.0 },
    ],
    total: 3140.0,
    status: "enviado",
    tracking: [
      { step: "Pedido recibido", date: "2024-01-15 09:30", completed: true },
      { step: "En preparación", date: "2024-01-15 11:00", completed: true },
      { step: "En camino", date: "2024-01-16 08:00", completed: true },
      { step: "Entregado", date: "", completed: false },
    ],
  },
  {
    id: "ORD-044",
    date: "2024-01-12",
    delivery: "2024-01-14",
    items: [
      { name: "Frijol Negro 25kg", quantity: 8, price: 520.0 },
    ],
    total: 4160.0,
    status: "completado",
    tracking: [
      { step: "Pedido recibido", date: "2024-01-12 10:00", completed: true },
      { step: "En preparación", date: "2024-01-12 14:00", completed: true },
      { step: "En camino", date: "2024-01-13 07:00", completed: true },
      { step: "Entregado", date: "2024-01-14 09:30", completed: true },
    ],
  },
  {
    id: "ORD-043",
    date: "2024-01-10",
    delivery: "2024-01-12",
    items: [
      { name: "Harina de Trigo 44kg", quantity: 15, price: 380.0 },
      { name: "Azúcar Estándar 50kg", quantity: 10, price: 680.0 },
    ],
    total: 12500.0,
    status: "completado",
    tracking: [
      { step: "Pedido recibido", date: "2024-01-10 08:00", completed: true },
      { step: "En preparación", date: "2024-01-10 10:00", completed: true },
      { step: "En camino", date: "2024-01-11 06:00", completed: true },
      { step: "Entregado", date: "2024-01-12 10:00", completed: true },
    ],
  },
  {
    id: "ORD-042",
    date: "2024-01-08",
    delivery: "2024-01-10",
    items: [
      { name: "Sal de Mesa 25kg", quantity: 20, price: 120.0 },
    ],
    total: 2400.0,
    status: "completado",
    tracking: [
      { step: "Pedido recibido", date: "2024-01-08 11:00", completed: true },
      { step: "En preparación", date: "2024-01-08 15:00", completed: true },
      { step: "En camino", date: "2024-01-09 07:00", completed: true },
      { step: "Entregado", date: "2024-01-10 08:30", completed: true },
    ],
  },
];

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "outline"; icon: typeof Package }> = {
  pendiente: { label: "Pendiente", variant: "secondary", icon: Clock },
  procesando: { label: "Procesando", variant: "default", icon: Package },
  enviado: { label: "En Camino", variant: "outline", icon: Truck },
  completado: { label: "Entregado", variant: "default", icon: CheckCircle },
};

const PortalPedidos = () => {
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");

  const filteredOrders = orders.filter((order) => {
    const matchesStatus = statusFilter === "all" || order.status === statusFilter;
    const matchesSearch = order.id.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  return (
    <PortalLayout title="Mis Pedidos">
      {/* Filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por número de pedido..."
            className="pl-9"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="pendiente">Pendiente</SelectItem>
            <SelectItem value="procesando">Procesando</SelectItem>
            <SelectItem value="enviado">En Camino</SelectItem>
            <SelectItem value="completado">Entregado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Orders List */}
      <div className="space-y-4">
        {filteredOrders.map((order) => {
          const StatusIcon = statusConfig[order.status].icon;
          return (
            <Card key={order.id} className="border-border">
              <CardContent className="p-6">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <StatusIcon className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <div className="flex items-center gap-3 mb-1">
                        <h3 className="font-semibold text-foreground text-lg">{order.id}</h3>
                        <Badge variant={statusConfig[order.status].variant}>
                          {statusConfig[order.status].label}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {order.items.length} productos • Pedido el {order.date}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Entrega estimada: {order.delivery}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-2xl font-bold text-foreground">${order.total.toFixed(2)}</p>
                    </div>

                    <Dialog>
                      <DialogTrigger asChild>
                        <Button variant="outline" className="gap-2">
                          <Eye className="h-4 w-4" />
                          Ver Detalles
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-2xl">
                        <DialogHeader>
                          <DialogTitle className="flex items-center gap-3">
                            Pedido {order.id}
                            <Badge variant={statusConfig[order.status].variant}>
                              {statusConfig[order.status].label}
                            </Badge>
                          </DialogTitle>
                        </DialogHeader>

                        <div className="space-y-6 mt-4">
                          {/* Tracking Timeline */}
                          <div>
                            <h4 className="font-semibold mb-4 flex items-center gap-2">
                              <MapPin className="h-4 w-4" />
                              Seguimiento
                            </h4>
                            <div className="space-y-4">
                              {order.tracking.map((step, index) => (
                                <div key={index} className="flex gap-4">
                                  <div className="flex flex-col items-center">
                                    <div
                                      className={`h-4 w-4 rounded-full ${
                                        step.completed ? "bg-primary" : "bg-muted"
                                      }`}
                                    />
                                    {index < order.tracking.length - 1 && (
                                      <div
                                        className={`w-0.5 h-8 ${
                                          step.completed ? "bg-primary" : "bg-muted"
                                        }`}
                                      />
                                    )}
                                  </div>
                                  <div className="flex-1 pb-4">
                                    <p
                                      className={`font-medium ${
                                        step.completed ? "text-foreground" : "text-muted-foreground"
                                      }`}
                                    >
                                      {step.step}
                                    </p>
                                    {step.date && (
                                      <p className="text-sm text-muted-foreground">{step.date}</p>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Order Items */}
                          <div>
                            <h4 className="font-semibold mb-4">Productos</h4>
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Producto</TableHead>
                                  <TableHead className="text-center">Cantidad</TableHead>
                                  <TableHead className="text-right">Precio Unit.</TableHead>
                                  <TableHead className="text-right">Subtotal</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {order.items.map((item, index) => (
                                  <TableRow key={index}>
                                    <TableCell>{item.name}</TableCell>
                                    <TableCell className="text-center">{item.quantity}</TableCell>
                                    <TableCell className="text-right">
                                      ${item.price.toFixed(2)}
                                    </TableCell>
                                    <TableCell className="text-right font-medium">
                                      ${(item.price * item.quantity).toFixed(2)}
                                    </TableCell>
                                  </TableRow>
                                ))}
                                <TableRow>
                                  <TableCell colSpan={3} className="text-right font-semibold">
                                    Total
                                  </TableCell>
                                  <TableCell className="text-right font-bold text-lg">
                                    ${order.total.toFixed(2)}
                                  </TableCell>
                                </TableRow>
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </PortalLayout>
  );
};

export default PortalPedidos;
