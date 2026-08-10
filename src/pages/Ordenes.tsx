import { useState, useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Plus, Search, Eye, Truck, Loader2, Package, CheckCircle, Clock, X } from "lucide-react";
import { supabase, Cliente, Producto } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/hooks/use-toast";

interface OrdenDB {
  id: string;
  numero: string;
  cliente_id: string;
  estado: string;
  subtotal: number;
  descuento: number;
  total: number;
  metodo_pago: string;
  comprobante_url: string | null;
  referencia_pago: string | null;
  notas: string;
  fecha_entrega: string | null;
  created_at: string;
  cliente?: {
    nombre_negocio: string;
    direccion: string;
    ciudad: string;
    telefono: string;
  };
  items?: OrdenItem[];
}

interface OrdenItem {
  id: string;
  producto_id: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
  producto?: {
    nombre: string;
    imagen_emoji: string;
    imagen_url: string;
  };
}

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; color: string }> = {
  pendiente: { label: "Pendiente", variant: "secondary", color: "bg-gray-500" },
  confirmado: { label: "Confirmado", variant: "default", color: "bg-blue-500" },
  procesando: { label: "Procesando", variant: "default", color: "bg-yellow-500" },
  enviado: { label: "Enviado", variant: "outline", color: "bg-purple-500" },
  en_camino: { label: "En Camino", variant: "outline", color: "bg-purple-500" },
  entregado: { label: "Entregado", variant: "default", color: "bg-green-500" },
  completado: { label: "Completado", variant: "default", color: "bg-green-500" },
  cancelado: { label: "Cancelado", variant: "destructive", color: "bg-red-500" },
};

const Ordenes = () => {
  const [ordenes, setOrdenes] = useState<OrdenDB[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedOrder, setSelectedOrder] = useState<OrdenDB | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  
  // New order form
  const [newOrder, setNewOrder] = useState({
    cliente_id: "",
    metodo_pago: "transferencia",
    notas: "",
    items: [] as { producto_id: string; cantidad: number; precio: number }[],
  });
  const [selectedProducto, setSelectedProducto] = useState("");
  const [cantidad, setCantidad] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  const { formatPrice } = useCurrency();
  const { toast } = useToast();

  useEffect(() => {
    fetchOrdenes();
    fetchClientes();
    fetchProductos();
  }, []);

  const fetchOrdenes = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('ordenes')
      .select(`
        *,
        cliente:clientes(nombre_negocio, direccion, ciudad, telefono),
        items:orden_items(*, producto:productos(nombre, imagen_emoji, imagen_url))
      `)
      .order('created_at', { ascending: false });
    
    if (data) setOrdenes(data);
    setLoading(false);
  };

  const fetchClientes = async () => {
    const { data } = await supabase
      .from('clientes')
      .select('*')
      .eq('activo', true)
      .order('nombre_negocio');
    if (data) setClientes(data);
  };

  const fetchProductos = async () => {
    const { data } = await supabase
      .from('productos')
      .select('*')
      .eq('activo', true)
      .order('nombre');
    if (data) setProductos(data);
  };

  const updateOrderStatus = async (orderId: string, newStatus: string) => {
    setUpdatingStatus(true);
    const { error } = await supabase
      .from('ordenes')
      .update({ estado: newStatus, updated_at: new Date().toISOString() })
      .eq('id', orderId);
    
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Actualizado", description: `Estado cambiado a ${statusConfig[newStatus]?.label || newStatus}` });
      fetchOrdenes();
      if (selectedOrder?.id === orderId) {
        setSelectedOrder({ ...selectedOrder, estado: newStatus });
      }
    }
    setUpdatingStatus(false);
  };

  const addItemToOrder = () => {
    if (!selectedProducto || cantidad < 1) return;
    
    const producto = productos.find(p => p.id === selectedProducto);
    if (!producto) return;
    
    const precio = producto.en_oferta && producto.precio_oferta ? producto.precio_oferta : producto.precio_base;
    
    setNewOrder(prev => ({
      ...prev,
      items: [...prev.items, { producto_id: selectedProducto, cantidad, precio }]
    }));
    
    setSelectedProducto("");
    setCantidad(1);
  };

  const removeItemFromOrder = (index: number) => {
    setNewOrder(prev => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index)
    }));
  };

  const createOrder = async () => {
    if (!newOrder.cliente_id || newOrder.items.length === 0) {
      toast({ title: "Error", description: "Selecciona un cliente y agrega productos", variant: "destructive" });
      return;
    }

    setSubmitting(true);

    // Crear la orden de forma atómica en el servidor (numera, aplica IVA/envío,
    // inserta cabecera + items). Misma lógica de dinero que el checkout del cliente.
    const { data, error } = await supabase.rpc('crear_orden_admin', {
      p_cliente_id: newOrder.cliente_id,
      p_metodo_pago: newOrder.metodo_pago,
      p_notas: newOrder.notas,
      p_items: newOrder.items.map(item => ({
        producto_id: item.producto_id,
        cantidad: item.cantidad,
        precio_unitario: item.precio,
      })),
    });

    if (error) {
      toast({ title: "No se pudo crear la orden", description: error.message, variant: "destructive" });
      setSubmitting(false);
      return;
    }

    const creada = Array.isArray(data) ? data[0] : data;
    toast({ title: "Orden creada", description: `Orden ${creada?.numero ?? ''} creada exitosamente` });
    setIsCreateOpen(false);
    setNewOrder({ cliente_id: "", metodo_pago: "transferencia", notas: "", items: [] });
    fetchOrdenes();
    setSubmitting(false);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  };

  const verComprobanteOrden = async (path: string) => {
    const { data, error } = await supabase.storage.from("documentos").createSignedUrl(path, 120);
    if (error || !data?.signedUrl) {
      toast({ title: "No se pudo abrir el comprobante", description: error?.message, variant: "destructive" });
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const filteredOrdenes = ordenes.filter(orden => {
    const matchesSearch = 
      orden.numero?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      orden.cliente?.nombre_negocio?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || orden.estado === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const orderTotal = newOrder.items.reduce((sum, item) => sum + item.precio * item.cantidad, 0);

  return (
    <MainLayout title="Órdenes">
      {/* Header Actions */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input 
              placeholder="Buscar por ID, cliente..." 
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
              <SelectItem value="confirmado">Confirmado</SelectItem>
              <SelectItem value="procesando">Procesando</SelectItem>
              <SelectItem value="enviado">Enviado</SelectItem>
              <SelectItem value="completado">Completado</SelectItem>
              <SelectItem value="cancelado">Cancelado</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button className="gap-2" onClick={() => setIsCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Nueva Orden
        </Button>
      </div>

      {/* Orders Table */}
      <div className="rounded-xl border border-border bg-card shadow-sm animate-fade-in">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : filteredOrdenes.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            No se encontraron órdenes
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Orden</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead className="text-center">Items</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Método Pago</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredOrdenes.map((orden) => (
                <TableRow key={orden.id} className="hover:bg-muted/50">
                  <TableCell className="font-medium text-primary">{orden.numero}</TableCell>
                  <TableCell className="font-medium">{orden.cliente?.nombre_negocio || 'N/A'}</TableCell>
                  <TableCell className="text-center">{orden.items?.length || 0}</TableCell>
                  <TableCell className="text-right font-semibold">{formatPrice(orden.total)}</TableCell>
                  <TableCell>
                    <Badge variant={statusConfig[orden.estado]?.variant || "secondary"}>
                      {statusConfig[orden.estado]?.label || orden.estado}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(orden.created_at)}</TableCell>
                  <TableCell className="text-muted-foreground capitalize">{orden.metodo_pago?.replace('_', ' ') || 'N/A'}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8"
                        onClick={() => {
                          setSelectedOrder(orden);
                          setIsDetailOpen(true);
                        }}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Order Detail Sheet */}
      <Sheet open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Detalle de Orden</SheetTitle>
          </SheetHeader>
          
          {selectedOrder && (
            <div className="mt-6 space-y-6">
              {/* Order Info */}
              <div className="bg-muted rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-lg font-bold text-primary">{selectedOrder.numero}</span>
                  <Badge variant={statusConfig[selectedOrder.estado]?.variant || "secondary"}>
                    {statusConfig[selectedOrder.estado]?.label || selectedOrder.estado}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Fecha:</span>
                    <p className="font-medium">{formatDate(selectedOrder.created_at)}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Método:</span>
                    <p className="font-medium capitalize">{selectedOrder.metodo_pago?.replace('_', ' ')}</p>
                  </div>
                  {selectedOrder.referencia_pago && (
                    <div>
                      <span className="text-muted-foreground">Referencia:</span>
                      <p className="font-medium font-mono">{selectedOrder.referencia_pago}</p>
                    </div>
                  )}
                  {selectedOrder.comprobante_url && (
                    <div>
                      <span className="text-muted-foreground">Comprobante:</span>
                      <div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-1"
                          onClick={() => verComprobanteOrden(selectedOrder.comprobante_url!)}
                        >
                          <Eye className="h-4 w-4 mr-2" />
                          Ver comprobante
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Client Info */}
              <div>
                <h3 className="font-semibold mb-2">Cliente</h3>
                <div className="bg-card border rounded-xl p-4">
                  <p className="font-medium">{selectedOrder.cliente?.nombre_negocio}</p>
                  <p className="text-sm text-muted-foreground">{selectedOrder.cliente?.direccion}</p>
                  <p className="text-sm text-muted-foreground">{selectedOrder.cliente?.ciudad}</p>
                  {selectedOrder.cliente?.telefono && (
                    <p className="text-sm text-muted-foreground">Tel: {selectedOrder.cliente.telefono}</p>
                  )}
                </div>
              </div>

              {/* Products */}
              <div>
                <h3 className="font-semibold mb-2">Productos ({selectedOrder.items?.length || 0})</h3>
                <div className="space-y-2">
                  {selectedOrder.items?.map((item) => (
                    <div key={item.id} className="flex items-center gap-3 bg-card border rounded-lg p-3">
                      <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center text-xl">
                        {item.producto?.imagen_emoji || '📦'}
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-sm">{item.producto?.nombre}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.cantidad} x {formatPrice(item.precio_unitario)}
                        </p>
                      </div>
                      <p className="font-medium">{formatPrice(item.subtotal)}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Summary */}
              <div className="bg-muted rounded-xl p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Subtotal</span>
                  <span>{formatPrice(selectedOrder.subtotal)}</span>
                </div>
                {selectedOrder.descuento > 0 && (
                  <div className="flex justify-between text-sm text-green-600">
                    <span>Descuento</span>
                    <span>-{formatPrice(selectedOrder.descuento)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-lg pt-2 border-t">
                  <span>Total</span>
                  <span className="text-primary">{formatPrice(selectedOrder.total)}</span>
                </div>
              </div>

              {/* Status Actions */}
              <div>
                <h3 className="font-semibold mb-2">Cambiar Estado</h3>
                <div className="grid grid-cols-2 gap-2">
                  {['pendiente', 'confirmado', 'procesando', 'enviado', 'completado', 'cancelado'].map((status) => (
                    <Button
                      key={status}
                      variant={selectedOrder.estado === status ? "default" : "outline"}
                      size="sm"
                      disabled={updatingStatus || selectedOrder.estado === status}
                      onClick={() => updateOrderStatus(selectedOrder.id, status)}
                      className="capitalize"
                    >
                      {updatingStatus ? <Loader2 className="h-4 w-4 animate-spin" /> : statusConfig[status]?.label}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Notes */}
              {selectedOrder.notas && (
                <div>
                  <h3 className="font-semibold mb-2">Notas</h3>
                  <p className="text-sm text-muted-foreground bg-card border rounded-lg p-3">
                    {selectedOrder.notas}
                  </p>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Create Order Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nueva Orden</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-6 mt-4">
            {/* Client Selection */}
            <div className="space-y-2">
              <Label>Cliente *</Label>
              <Select value={newOrder.cliente_id} onValueChange={(v) => setNewOrder(prev => ({ ...prev, cliente_id: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar cliente" />
                </SelectTrigger>
                <SelectContent>
                  {clientes.map((cliente) => (
                    <SelectItem key={cliente.id} value={cliente.id}>
                      {cliente.nombre_negocio}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Payment Method */}
            <div className="space-y-2">
              <Label>Método de Pago</Label>
              <Select value={newOrder.metodo_pago} onValueChange={(v) => setNewOrder(prev => ({ ...prev, metodo_pago: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="transferencia">Transferencia</SelectItem>
                  <SelectItem value="efectivo">Efectivo</SelectItem>
                  <SelectItem value="credito">Crédito</SelectItem>
                  <SelectItem value="pago_movil">Pago Móvil</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Add Products */}
            <div className="space-y-2">
              <Label>Agregar Productos</Label>
              <div className="flex gap-2">
                <Select value={selectedProducto} onValueChange={setSelectedProducto}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Seleccionar producto" />
                  </SelectTrigger>
                  <SelectContent>
                    {productos.map((producto) => (
                      <SelectItem key={producto.id} value={producto.id}>
                        {producto.nombre} - {formatPrice(producto.en_oferta && producto.precio_oferta ? producto.precio_oferta : producto.precio_base)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min="1"
                  value={cantidad}
                  onChange={(e) => setCantidad(parseInt(e.target.value) || 1)}
                  className="w-20"
                />
                <Button onClick={addItemToOrder} disabled={!selectedProducto}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Order Items */}
            {newOrder.items.length > 0 && (
              <div className="space-y-2">
                <Label>Productos en la orden</Label>
                <div className="border rounded-lg divide-y">
                  {newOrder.items.map((item, index) => {
                    const producto = productos.find(p => p.id === item.producto_id);
                    return (
                      <div key={index} className="flex items-center justify-between p-3">
                        <div>
                          <p className="font-medium">{producto?.nombre}</p>
                          <p className="text-sm text-muted-foreground">
                            {item.cantidad} x {formatPrice(item.precio)}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-medium">{formatPrice(item.precio * item.cantidad)}</span>
                          <Button variant="ghost" size="icon" onClick={() => removeItemFromOrder(index)}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between font-bold text-lg pt-2">
                  <span>Total:</span>
                  <span className="text-primary">{formatPrice(orderTotal)}</span>
                </div>
              </div>
            )}

            {/* Notes */}
            <div className="space-y-2">
              <Label>Notas</Label>
              <Input
                placeholder="Notas adicionales..."
                value={newOrder.notas}
                onChange={(e) => setNewOrder(prev => ({ ...prev, notas: e.target.value }))}
              />
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={createOrder} disabled={submitting || newOrder.items.length === 0}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Crear Orden
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
};

export default Ordenes;
