import { useState, useEffect, useMemo, Fragment } from "react";
import { cn } from "@/lib/utils";
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
import { Link } from "react-router-dom";
import { Plus, Search, Eye, Truck, Loader2, Package, CheckCircle, Clock, X, Users, ChevronRight, FileText } from "lucide-react";
import { supabase, Cliente, Producto } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/hooks/use-toast";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";

interface OrdenDB {
  id: string;
  numero: string;
  cliente_id: string;
  estado: string;
  subtotal: number;
  impuesto: number;
  descuento: number;
  envio: number;
  total: number;
  metodo_pago: string;
  moneda_original: string | null;
  vendedor_odoo: string | null;
  comprobante_url: string | null;
  referencia_pago: string | null;
  notas: string;
  fecha_pedido: string | null;
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
  nombre_producto?: string;
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
  const [grouped, setGrouped] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (k: string) => setOpenGroups((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const [selectedOrder, setSelectedOrder] = useState<OrdenDB | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [facturaPorOrden, setFacturaPorOrden] = useState<Record<string, { id: string; numero: string }>>({});
  const [facturando, setFacturando] = useState(false);

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
      .order('created_at', { ascending: false })
      .limit(5000); // el default de Supabase es 1000; con el histórico importado hay más
    
    if (data) setOrdenes(data);
    setLoading(false);

    const { data: facs } = await supabase
      .from("facturas")
      .select("id, numero, orden_id")
      .not("orden_id", "is", null)
      .eq("tipo", "factura")
      .neq("estado_pago", "anulado");
    if (facs) {
      setFacturaPorOrden(Object.fromEntries((facs as { id: string; numero: string; orden_id: string }[]).map((f) => [f.orden_id, { id: f.id, numero: f.numero }])));
    }
  };

  const facturarOrden = async (ordenId: string) => {
    setFacturando(true);
    const { data, error } = await supabase.rpc("facturar_orden", { p_orden_id: ordenId });
    setFacturando(false);
    if (error) {
      toast({ title: "No se pudo facturar", description: error.message, variant: "destructive" });
      return;
    }
    // Buscamos el número recién generado para el toast (facturar_orden devuelve solo el id).
    const { data: fac } = await supabase.from("facturas").select("numero").eq("id", data as string).maybeSingle();
    toast({ title: "Factura generada", description: fac?.numero ? `Factura ${fac.numero} creada` : "Factura creada" });
    fetchOrdenes();
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

  const pagination = usePagination(filteredOrdenes, 25);

  const grupos = useMemo(() => {
    const m = new Map<string, { key: string; nombre: string; orders: OrdenDB[]; total: number }>();
    for (const o of filteredOrdenes) {
      const key = o.cliente_id || "sin";
      const g = m.get(key) || { key, nombre: o.cliente?.nombre_negocio || "Sin cliente", orders: [], total: 0 };
      g.orders.push(o); g.total += Number(o.total || 0);
      m.set(key, g);
    }
    return [...m.values()].sort((a, b) => b.orders.length - a.orders.length);
  }, [filteredOrdenes]);

  const renderOrderRow = (orden: OrdenDB) => (
    <TableRow
      key={orden.id}
      className="cursor-pointer hover:bg-muted/50"
      onClick={() => { setSelectedOrder(orden); setIsDetailOpen(true); }}
    >
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
    </TableRow>
  );

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
        <div className="flex gap-2">
          <Button variant={grouped ? "default" : "outline"} className="gap-2" onClick={() => setGrouped((g) => !g)}>
            <Users className="h-4 w-4" />
            {grouped ? "Agrupado por cliente" : "Agrupar por cliente"}
          </Button>
          <Button className="gap-2" onClick={() => setIsCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            Nueva Orden
          </Button>
        </div>
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {grouped
                ? grupos.map((g) => (
                    <Fragment key={g.key}>
                      <TableRow className="cursor-pointer bg-muted/40 hover:bg-muted" onClick={() => toggleGroup(g.key)}>
                        <TableCell colSpan={7}>
                          <div className="flex items-center gap-2 font-medium">
                            <ChevronRight className={cn("h-4 w-4 shrink-0 transition-transform", openGroups.has(g.key) && "rotate-90")} />
                            <span className="truncate">{g.nombre}</span>
                            <Badge variant="secondary">{g.orders.length} órden{g.orders.length !== 1 ? "es" : ""}</Badge>
                            <span className="ml-auto font-semibold text-primary">{formatPrice(g.total)}</span>
                          </div>
                        </TableCell>
                      </TableRow>
                      {openGroups.has(g.key) && g.orders.map(renderOrderRow)}
                    </Fragment>
                  ))
                : pagination.pageItems.map(renderOrderRow)}
            </TableBody>
          </Table>
        )}
        {!loading && !grouped && <DataTablePagination pagination={pagination} />}
        {!loading && grouped && filteredOrdenes.length > 0 && (
          <div className="border-t border-border px-4 py-2.5 text-sm text-muted-foreground">
            {grupos.length} cliente{grupos.length !== 1 ? "s" : ""} · {filteredOrdenes.length} órdenes
          </div>
        )}
      </div>

      {/* Order Detail Sheet */}
      <Sheet open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <SheetContent className="w-full overflow-y-auto sm:w-[50vw] sm:max-w-none">
          <SheetHeader>
            <SheetTitle>Detalle de Orden</SheetTitle>
          </SheetHeader>
          
          {selectedOrder && (
            <div className="mt-6 space-y-6">
              {/* Cabecera */}
              <div className="rounded-xl border bg-muted/40 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-2xl font-bold text-primary">{selectedOrder.numero}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatDate(selectedOrder.fecha_pedido || selectedOrder.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={statusConfig[selectedOrder.estado]?.variant || "secondary"}>
                      {statusConfig[selectedOrder.estado]?.label || selectedOrder.estado}
                    </Badge>
                    {facturaPorOrden[selectedOrder.id] ? (
                      <Link to={`/admin/facturas/${facturaPorOrden[selectedOrder.id].id}`}>
                        <Button variant="outline" size="sm" className="gap-1.5">
                          <FileText className="h-3.5 w-3.5" /> {facturaPorOrden[selectedOrder.id].numero}
                        </Button>
                      </Link>
                    ) : (
                      <Button
                        variant="outline" size="sm" className="gap-1.5"
                        disabled={facturando || selectedOrder.estado === "cancelado"}
                        onClick={() => facturarOrden(selectedOrder.id)}
                      >
                        {facturando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />} Facturar
                      </Button>
                    )}
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Vendedor</p>
                    <p className="font-medium">{selectedOrder.vendedor_odoo || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Método de pago</p>
                    <p className="font-medium capitalize">{selectedOrder.metodo_pago?.replace('_', ' ') || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Moneda</p>
                    <p className="font-medium">{selectedOrder.moneda_original || '—'}</p>
                  </div>
                  {selectedOrder.referencia_pago && (
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Referencia</p>
                      <p className="font-mono font-medium">{selectedOrder.referencia_pago}</p>
                    </div>
                  )}
                </div>
                {selectedOrder.comprobante_url && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    onClick={() => verComprobanteOrden(selectedOrder.comprobante_url!)}
                  >
                    <Eye className="mr-2 h-4 w-4" />
                    Ver comprobante
                  </Button>
                )}
              </div>

              {/* Cliente + Resumen */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border p-4">
                  <h3 className="mb-2 font-semibold">Cliente</h3>
                  <p className="font-medium">{selectedOrder.cliente?.nombre_negocio}</p>
                  {selectedOrder.cliente?.direccion && (
                    <p className="text-sm text-muted-foreground">{selectedOrder.cliente.direccion}</p>
                  )}
                  {selectedOrder.cliente?.ciudad && (
                    <p className="text-sm text-muted-foreground">{selectedOrder.cliente.ciudad}</p>
                  )}
                  {selectedOrder.cliente?.telefono && (
                    <p className="text-sm text-muted-foreground">Tel: {selectedOrder.cliente.telefono}</p>
                  )}
                </div>
                <div className="rounded-xl border p-4">
                  <h3 className="mb-2 font-semibold">Resumen</h3>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Subtotal</span>
                      <span>{formatPrice(selectedOrder.subtotal)}</span>
                    </div>
                    {selectedOrder.impuesto > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Impuesto</span>
                        <span>{formatPrice(selectedOrder.impuesto)}</span>
                      </div>
                    )}
                    {selectedOrder.descuento > 0 && (
                      <div className="flex justify-between text-green-600">
                        <span>Descuento</span>
                        <span>-{formatPrice(selectedOrder.descuento)}</span>
                      </div>
                    )}
                    {selectedOrder.envio > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Envío</span>
                        <span>{formatPrice(selectedOrder.envio)}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t pt-2 text-base font-bold">
                      <span>Total</span>
                      <span className="text-primary">{formatPrice(selectedOrder.total)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Productos */}
              <div>
                <h3 className="mb-2 font-semibold">Productos ({selectedOrder.items?.length || 0})</h3>
                <div className="rounded-xl border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Producto</TableHead>
                        <TableHead className="text-center">Cant.</TableHead>
                        <TableHead className="text-right">Precio</TableHead>
                        <TableHead className="text-right">Subtotal</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedOrder.items?.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">
                            <span className="mr-2">{item.producto?.imagen_emoji || '📦'}</span>
                            {item.producto?.nombre || item.nombre_producto || 'Producto'}
                          </TableCell>
                          <TableCell className="text-center">{item.cantidad}</TableCell>
                          <TableCell className="text-right">{formatPrice(item.precio_unitario)}</TableCell>
                          <TableCell className="text-right font-medium">{formatPrice(item.subtotal)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Cambiar estado */}
              <div>
                <h3 className="mb-2 font-semibold">Cambiar estado</h3>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {['pendiente', 'confirmado', 'procesando', 'enviado', 'completado', 'cancelado'].map((status) => (
                    <Button
                      key={status}
                      variant={selectedOrder.estado === status ? "default" : "outline"}
                      size="sm"
                      disabled={updatingStatus || selectedOrder.estado === status}
                      onClick={() => updateOrderStatus(selectedOrder.id, status)}
                    >
                      {updatingStatus ? <Loader2 className="h-4 w-4 animate-spin" /> : statusConfig[status]?.label}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Notas */}
              {selectedOrder.notas && (
                <div>
                  <h3 className="mb-2 font-semibold">Notas</h3>
                  <p className="rounded-lg border bg-card p-3 text-sm text-muted-foreground">
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
