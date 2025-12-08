import { useState } from "react";
import { VendedorLayout } from "@/components/vendedor/VendedorLayout";
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
  Package, 
  ShoppingCart,
  Trash2,
  Eye
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Producto {
  id: string;
  nombre: string;
  sku: string;
  precio: number;
  stock: number;
  categoria: string;
}

interface ItemCarrito {
  producto: Producto;
  cantidad: number;
}

interface Pedido {
  id: string;
  cliente: string;
  fecha: string;
  items: number;
  total: number;
  estado: "pendiente" | "procesando" | "enviado" | "entregado" | "cancelado";
}

const clientesDisponibles = [
  { id: "CLI-001", nombre: "Walmart Centro" },
  { id: "CLI-002", nombre: "Soriana Norte" },
  { id: "CLI-003", nombre: "OXXO Zona 5" },
  { id: "CLI-004", nombre: "Bodega Aurrera" },
  { id: "CLI-005", nombre: "Chedraui Express" },
  { id: "CLI-006", nombre: "7-Eleven Centro" },
];

const productosDisponibles: Producto[] = [
  { id: "PRD-001", nombre: "Aceite de Oliva Extra Virgen 1L", sku: "AOL-001", precio: 189.00, stock: 150, categoria: "Aceites" },
  { id: "PRD-002", nombre: "Arroz Grano Largo 1kg", sku: "ARR-001", precio: 32.50, stock: 500, categoria: "Granos" },
  { id: "PRD-003", nombre: "Frijol Negro 1kg", sku: "FRJ-001", precio: 45.00, stock: 300, categoria: "Granos" },
  { id: "PRD-004", nombre: "Azúcar Estándar 1kg", sku: "AZU-001", precio: 28.00, stock: 400, categoria: "Endulzantes" },
  { id: "PRD-005", nombre: "Harina de Trigo 1kg", sku: "HAR-001", precio: 22.00, stock: 350, categoria: "Harinas" },
  { id: "PRD-006", nombre: "Leche Entera 1L", sku: "LEC-001", precio: 26.50, stock: 200, categoria: "Lácteos" },
  { id: "PRD-007", nombre: "Café Molido Premium 500g", sku: "CAF-001", precio: 145.00, stock: 100, categoria: "Bebidas" },
  { id: "PRD-008", nombre: "Atún en Agua 140g", sku: "ATU-001", precio: 24.00, stock: 600, categoria: "Enlatados" },
];

const pedidosExistentes: Pedido[] = [
  { id: "PED-2024-001", cliente: "Walmart Centro", fecha: "2024-01-15", items: 12, total: 15680.00, estado: "enviado" },
  { id: "PED-2024-002", cliente: "Soriana Norte", fecha: "2024-01-14", items: 8, total: 8920.00, estado: "procesando" },
  { id: "PED-2024-003", cliente: "OXXO Zona 5", fecha: "2024-01-13", items: 5, total: 3450.00, estado: "entregado" },
  { id: "PED-2024-004", cliente: "Bodega Aurrera", fecha: "2024-01-12", items: 15, total: 22100.00, estado: "pendiente" },
  { id: "PED-2024-005", cliente: "7-Eleven Centro", fecha: "2024-01-10", items: 6, total: 4200.00, estado: "entregado" },
];

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  pendiente: { label: "Pendiente", variant: "secondary" },
  procesando: { label: "Procesando", variant: "default" },
  enviado: { label: "Enviado", variant: "outline" },
  entregado: { label: "Entregado", variant: "default" },
  cancelado: { label: "Cancelado", variant: "destructive" },
};

const VendedorPedidos = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [clienteSeleccionado, setClienteSeleccionado] = useState("");
  const [carrito, setCarrito] = useState<ItemCarrito[]>([]);
  const [searchProducto, setSearchProducto] = useState("");
  const { toast } = useToast();

  const filteredPedidos = pedidosExistentes.filter(
    (pedido) =>
      pedido.cliente.toLowerCase().includes(searchTerm.toLowerCase()) ||
      pedido.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredProductos = productosDisponibles.filter(
    (producto) =>
      producto.nombre.toLowerCase().includes(searchProducto.toLowerCase()) ||
      producto.sku.toLowerCase().includes(searchProducto.toLowerCase())
  );

  const agregarAlCarrito = (producto: Producto) => {
    const existente = carrito.find((item) => item.producto.id === producto.id);
    if (existente) {
      setCarrito(
        carrito.map((item) =>
          item.producto.id === producto.id
            ? { ...item, cantidad: item.cantidad + 1 }
            : item
        )
      );
    } else {
      setCarrito([...carrito, { producto, cantidad: 1 }]);
    }
  };

  const actualizarCantidad = (productoId: string, cantidad: number) => {
    if (cantidad <= 0) {
      setCarrito(carrito.filter((item) => item.producto.id !== productoId));
    } else {
      setCarrito(
        carrito.map((item) =>
          item.producto.id === productoId ? { ...item, cantidad } : item
        )
      );
    }
  };

  const eliminarDelCarrito = (productoId: string) => {
    setCarrito(carrito.filter((item) => item.producto.id !== productoId));
  };

  const totalCarrito = carrito.reduce(
    (acc, item) => acc + item.producto.precio * item.cantidad,
    0
  );

  const crearPedido = () => {
    if (!clienteSeleccionado) {
      toast({
        title: "Error",
        description: "Selecciona un cliente para el pedido",
        variant: "destructive",
      });
      return;
    }
    if (carrito.length === 0) {
      toast({
        title: "Error",
        description: "Agrega productos al carrito",
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Pedido Creado",
      description: `Pedido para ${clientesDisponibles.find(c => c.id === clienteSeleccionado)?.nombre} por $${totalCarrito.toLocaleString()}`,
    });

    setCarrito([]);
    setClienteSeleccionado("");
    setIsDialogOpen(false);
  };

  return (
    <VendedorLayout title="Pedidos">
      <Tabs defaultValue="lista" className="space-y-6">
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="lista">Mis Pedidos</TabsTrigger>
            <TabsTrigger value="nuevo">Nuevo Pedido</TabsTrigger>
          </TabsList>
        </div>

        {/* Lista de Pedidos */}
        <TabsContent value="lista" className="space-y-4">
          <Card className="border-border">
            <CardContent className="p-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar por cliente o número de pedido..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader>
              <CardTitle>Historial de Pedidos</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pedido</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPedidos.map((pedido) => (
                    <TableRow key={pedido.id}>
                      <TableCell className="font-medium">{pedido.id}</TableCell>
                      <TableCell>{pedido.cliente}</TableCell>
                      <TableCell>{pedido.fecha}</TableCell>
                      <TableCell>{pedido.items} productos</TableCell>
                      <TableCell className="font-medium">${pedido.total.toLocaleString()}</TableCell>
                      <TableCell>
                        <Badge variant={statusConfig[pedido.estado].variant}>
                          {statusConfig[pedido.estado].label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm">
                          <Eye className="h-4 w-4 mr-1" />
                          Ver
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Nuevo Pedido */}
        <TabsContent value="nuevo" className="space-y-4">
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Selección de Cliente y Productos */}
            <div className="lg:col-span-2 space-y-4">
              {/* Cliente */}
              <Card className="border-border">
                <CardHeader>
                  <CardTitle className="text-lg">1. Seleccionar Cliente</CardTitle>
                </CardHeader>
                <CardContent>
                  <Select value={clienteSeleccionado} onValueChange={setClienteSeleccionado}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona un cliente" />
                    </SelectTrigger>
                    <SelectContent>
                      {clientesDisponibles.map((cliente) => (
                        <SelectItem key={cliente.id} value={cliente.id}>
                          {cliente.nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </CardContent>
              </Card>

              {/* Productos */}
              <Card className="border-border">
                <CardHeader>
                  <CardTitle className="text-lg">2. Agregar Productos</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Buscar producto por nombre o SKU..."
                      value={searchProducto}
                      onChange={(e) => setSearchProducto(e.target.value)}
                      className="pl-10"
                    />
                  </div>

                  <div className="grid gap-3 max-h-96 overflow-y-auto">
                    {filteredProductos.map((producto) => (
                      <div
                        key={producto.id}
                        className="flex items-center justify-between rounded-lg border border-border p-3 hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                            <Package className="h-5 w-5 text-muted-foreground" />
                          </div>
                          <div>
                            <p className="font-medium text-sm">{producto.nombre}</p>
                            <p className="text-xs text-muted-foreground">
                              SKU: {producto.sku} • Stock: {producto.stock}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <p className="font-semibold">${producto.precio.toFixed(2)}</p>
                          <Button
                            size="sm"
                            onClick={() => agregarAlCarrito(producto)}
                            className="bg-emerald-500 hover:bg-emerald-600"
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Carrito */}
            <div className="lg:col-span-1">
              <Card className="border-border sticky top-24">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <ShoppingCart className="h-5 w-5" />
                    Carrito ({carrito.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {carrito.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">
                      No hay productos en el carrito
                    </p>
                  ) : (
                    <>
                      <div className="space-y-3 max-h-80 overflow-y-auto">
                        {carrito.map((item) => (
                          <div
                            key={item.producto.id}
                            className="flex items-center justify-between rounded-lg border border-border p-3"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm truncate">{item.producto.nombre}</p>
                              <p className="text-xs text-muted-foreground">
                                ${item.producto.precio.toFixed(2)} c/u
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Input
                                type="number"
                                min="1"
                                value={item.cantidad}
                                onChange={(e) =>
                                  actualizarCantidad(item.producto.id, parseInt(e.target.value) || 0)
                                }
                                className="w-16 h-8 text-center"
                              />
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive"
                                onClick={() => eliminarDelCarrito(item.producto.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="border-t pt-4 space-y-3">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Subtotal</span>
                          <span>${totalCarrito.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">IVA (16%)</span>
                          <span>${(totalCarrito * 0.16).toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between font-semibold text-lg">
                          <span>Total</span>
                          <span>${(totalCarrito * 1.16).toLocaleString()}</span>
                        </div>

                        <Button
                          className="w-full bg-emerald-500 hover:bg-emerald-600"
                          size="lg"
                          onClick={crearPedido}
                        >
                          Crear Pedido
                        </Button>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </VendedorLayout>
  );
};

export default VendedorPedidos;
