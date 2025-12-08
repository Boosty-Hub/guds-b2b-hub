import { useState, useEffect } from "react";
import { PortalMobileLayout } from "@/components/portal/PortalMobileLayout";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { 
  Package, 
  Truck, 
  CheckCircle, 
  Clock, 
  ChevronRight,
  MapPin,
  Phone,
  RotateCcw,
  Loader2
} from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { ProductImage } from "@/components/portal/ProductImage";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

interface OrdenDB {
  id: string;
  numero_orden: string;
  estado: string;
  total: number;
  subtotal: number;
  created_at: string;
  fecha_entrega?: string;
  notas?: string;
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
    imagen_emoji?: string;
    imagen_url?: string;
  };
}

const statusConfig: Record<string, { label: string; color: string; icon: any }> = {
  pendiente: { label: "Pendiente", color: "bg-gray-500", icon: Clock },
  confirmado: { label: "Confirmado", color: "bg-blue-500", icon: CheckCircle },
  procesando: { label: "Preparando", color: "bg-yellow-500", icon: Package },
  enviado: { label: "En Camino", color: "bg-blue-500", icon: Truck },
  en_camino: { label: "En Camino", color: "bg-blue-500", icon: Truck },
  entregado: { label: "Entregado", color: "bg-green-500", icon: CheckCircle },
  completado: { label: "Entregado", color: "bg-green-500", icon: CheckCircle },
  cancelado: { label: "Cancelado", color: "bg-red-500", icon: Clock },
};

const PortalPedidos = () => {
  const [selectedOrder, setSelectedOrder] = useState<OrdenDB | null>(null);
  const [activeTab, setActiveTab] = useState<"activos" | "historial">("activos");
  const [ordenes, setOrdenes] = useState<OrdenDB[]>([]);
  const [loading, setLoading] = useState(true);
  const { formatPrice } = useCurrency();
  const { user } = useAuth();

  useEffect(() => {
    if (user?.cliente_id) {
      fetchOrdenes();
    }
  }, [user]);

  const fetchOrdenes = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('ordenes')
      .select(`
        *,
        items:orden_items(
          *,
          producto:productos(nombre, imagen_emoji, imagen_url)
        )
      `)
      .eq('cliente_id', user?.cliente_id)
      .order('created_at', { ascending: false });
    
    if (data) setOrdenes(data);
    setLoading(false);
  };

  const activeOrders = ordenes.filter(o => o.estado !== "entregado" && o.estado !== "cancelado");
  const completedOrders = ordenes.filter(o => o.estado === "entregado");
  const displayOrders = activeTab === "activos" ? activeOrders : completedOrders;

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('es-ES', { 
      day: 'numeric', 
      month: 'short', 
      year: 'numeric' 
    });
  };

  return (
    <PortalMobileLayout title="Mis Pedidos">
      {/* Tabs */}
      <div className="px-4 pt-4">
        <div className="flex bg-muted rounded-xl p-1">
          <button
            onClick={() => setActiveTab("activos")}
            className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
              activeTab === "activos"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground"
            }`}
          >
            Activos ({activeOrders.length})
          </button>
          <button
            onClick={() => setActiveTab("historial")}
            className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
              activeTab === "historial"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground"
            }`}
          >
            Historial ({completedOrders.length})
          </button>
        </div>
      </div>

      {/* Orders List */}
      <div className="px-4 py-4 space-y-3">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : displayOrders.length === 0 ? (
          <div className="text-center py-12">
            <div className="h-16 w-16 rounded-full bg-muted mx-auto flex items-center justify-center mb-4">
              <Package className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground">
              {activeTab === "activos" 
                ? "No tienes pedidos activos" 
                : "No hay pedidos en el historial"}
            </p>
            <Link to="/portal/catalogo">
              <Button className="mt-4">Hacer un pedido</Button>
            </Link>
          </div>
        ) : (
          displayOrders.map((order) => {
            const config = statusConfig[order.estado] || statusConfig.pendiente;
            const StatusIcon = config.icon;
            const itemCount = order.items?.reduce((sum, i) => sum + i.cantidad, 0) || 0;

            return (
              <button
                key={order.id}
                onClick={() => setSelectedOrder(order)}
                className="w-full bg-card rounded-xl border border-border p-4 text-left"
              >
                {/* Header */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className={`h-8 w-8 rounded-full ${config.color}/10 flex items-center justify-center`}>
                      <StatusIcon className={`h-4 w-4 ${config.color.replace('bg-', 'text-')}`} />
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">{order.numero_orden}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(order.created_at)}</p>
                    </div>
                  </div>
                  <Badge className={`${config.color} text-white`}>
                    {config.label}
                  </Badge>
                </div>

                {/* ETA for active orders */}
                {(order.estado === "enviado" || order.estado === "en_camino") && order.fecha_entrega && (
                  <div className="bg-blue-500/10 rounded-lg p-2 mb-3 flex items-center gap-2">
                    <Truck className="h-4 w-4 text-blue-500" />
                    <span className="text-sm text-blue-700 font-medium">
                      Entrega: {formatDate(order.fecha_entrega)}
                    </span>
                  </div>
                )}

                {/* Items Preview */}
                {order.items && order.items.length > 0 && (
                  <div className="flex items-center gap-2 mb-3">
                    <div className="flex -space-x-2">
                      {order.items.slice(0, 3).map((item, i) => (
                        <div key={i} className="border-2 border-card rounded-lg overflow-hidden">
                          <ProductImage 
                            imageUrl={item.producto?.imagen_url}
                            emoji={item.producto?.imagen_emoji}
                            alt={item.producto?.nombre}
                            size="sm"
                          />
                        </div>
                      ))}
                      {order.items.length > 3 && (
                        <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center text-xs font-medium border-2 border-card">
                          +{order.items.length - 3}
                        </div>
                      )}
                    </div>
                    <span className="text-sm text-muted-foreground">
                      {itemCount} {itemCount === 1 ? "producto" : "productos"}
                    </span>
                  </div>
                )}

                {/* Footer */}
                <div className="flex items-center justify-between pt-3 border-t border-border">
                  <span className="font-bold text-primary text-lg">{formatPrice(order.total)}</span>
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    Ver detalles
                    <ChevronRight className="h-4 w-4" />
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Order Detail Sheet */}
      <Sheet open={!!selectedOrder} onOpenChange={() => setSelectedOrder(null)}>
        <SheetContent side="bottom" className="h-[90vh] rounded-t-3xl">
          {selectedOrder && (() => {
            const config = statusConfig[selectedOrder.estado] || statusConfig.pendiente;
            return (
              <>
                <SheetHeader className="text-left">
                  <SheetTitle className="flex items-center justify-between">
                    <span>{selectedOrder.numero_orden}</span>
                    <Badge className={`${config.color} text-white`}>
                      {config.label}
                    </Badge>
                  </SheetTitle>
                </SheetHeader>

                <div className="mt-4 space-y-6 overflow-y-auto pb-6">
                  {/* Order Info */}
                  <div className="bg-muted rounded-xl p-4">
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-muted-foreground">Fecha del pedido</span>
                      <span>{formatDate(selectedOrder.created_at)}</span>
                    </div>
                    {selectedOrder.fecha_entrega && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Fecha de entrega</span>
                        <span>{formatDate(selectedOrder.fecha_entrega)}</span>
                      </div>
                    )}
                  </div>

                  {/* Contact Driver (for active orders) */}
                  {(selectedOrder.estado === "enviado" || selectedOrder.estado === "en_camino") && (
                    <div className="bg-blue-500/10 rounded-xl p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="h-12 w-12 rounded-full bg-blue-500/20 flex items-center justify-center">
                            <Truck className="h-6 w-6 text-blue-500" />
                          </div>
                          <div>
                            <p className="font-medium text-blue-700">Pedido en camino</p>
                            <p className="text-sm text-blue-600">Tu pedido está siendo entregado</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Products */}
                  <div>
                    <h3 className="font-semibold mb-3">Productos</h3>
                    <div className="space-y-3">
                      {selectedOrder.items?.map((item, index) => (
                        <div key={index} className="flex items-center gap-3">
                          <ProductImage 
                            imageUrl={item.producto?.imagen_url}
                            emoji={item.producto?.imagen_emoji}
                            alt={item.producto?.nombre}
                            size="sm"
                            className="h-12 w-12"
                          />
                          <div className="flex-1">
                            <p className="font-medium text-sm">{item.producto?.nombre || 'Producto'}</p>
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
                      <span className="text-muted-foreground">Subtotal</span>
                      <span>{formatPrice(selectedOrder.subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Envío</span>
                      <span className="text-green-600">Gratis</span>
                    </div>
                    <div className="flex justify-between font-semibold pt-2 border-t border-border">
                      <span>Total</span>
                      <span className="text-primary">{formatPrice(selectedOrder.total)}</span>
                    </div>
                  </div>

                  {/* Actions */}
                  {selectedOrder.estado === "entregado" && (
                    <Button className="w-full gap-2">
                      <RotateCcw className="h-4 w-4" />
                      Repetir pedido
                    </Button>
                  )}
                </div>
              </>
            );
          })()}
        </SheetContent>
      </Sheet>
    </PortalMobileLayout>
  );
};

export default PortalPedidos;
