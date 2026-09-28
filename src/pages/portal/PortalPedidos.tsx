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
  Loader2,
  XCircle,
  Ban,
  Pencil
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { ProductImage } from "@/components/portal/ProductImage";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { EditorPedidoPendiente } from "@/components/portal/EditorPedidoPendiente";
import { pedidoEditable, type ResultadoEdicion } from "@/components/portal/pedidoEditable";

interface OrdenDB {
  id: string;
  numero: string;
  estado: string;
  aprobacion?: "pendiente" | "aprobada" | "rechazada" | null;  // pedidos de GUDS: el admin los aprueba antes de prepararlos
  rechazo_motivo?: string | null;
  total: number;
  subtotal: number;
  descuento?: number | null;
  impuesto?: number | null;
  envio?: number | null;
  created_at: string;
  fecha_entrega_estimada?: string | null;
  notas?: string;
  vendedor_id?: string | null;   // pedido cargado por el vendedor: solo él lo edita
  odoo_id?: number | null;
  ediciones?: number | null;     // veces que se editó mientras estaba por aprobar
  editado_at?: string | null;
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

const statusConfig: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  pendiente: { label: "Pendiente", color: "bg-gray-500", icon: Clock },
  confirmado: { label: "Confirmado", color: "bg-blue-500", icon: CheckCircle },
  procesando: { label: "Preparando", color: "bg-yellow-500", icon: Package },
  enviado: { label: "En Camino", color: "bg-blue-500", icon: Truck },
  en_camino: { label: "En Camino", color: "bg-blue-500", icon: Truck },
  entregado: { label: "Entregado", color: "bg-green-500", icon: CheckCircle },
  completado: { label: "Entregado", color: "bg-green-500", icon: CheckCircle },
  cancelado: { label: "Cancelado", color: "bg-gray-500", icon: Ban },
  por_aprobar: { label: "Por aprobar", color: "bg-amber-500", icon: Clock },
  aprobado: { label: "Aprobado", color: "bg-blue-500", icon: CheckCircle },
  rechazado: { label: "No aprobado", color: "bg-red-500", icon: XCircle },
};

// El pedido recién hecho espera la aprobación de GUDS; si no se aprueba, se muestra con su motivo
const claveEstado = (o: { estado: string; aprobacion?: string | null }) =>
  o.aprobacion === "rechazada" ? "rechazado"
    : o.estado === "cancelado" ? "cancelado"
    : o.aprobacion === "pendiente" ? "por_aprobar"
    : o.aprobacion === "aprobada" && o.estado === "pendiente" ? "aprobado"
    : o.estado;

// El cliente edita, mientras está por aprobar, los pedidos que hizo en el portal (los que le cargó su vendedor, no)
const clientePuedeEditar = (o: OrdenDB) => pedidoEditable(o) && !o.vendedor_id;

type Pestana = "curso" | "entregados" | "cancelados";

const PortalPedidos = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedOrder, setSelectedOrder] = useState<OrdenDB | null>(null);
  const [activeTab, setActiveTab] = useState<Pestana>("curso");
  const [ordenes, setOrdenes] = useState<OrdenDB[]>([]);
  const [loading, setLoading] = useState(true);
  // Pedido recién enviado desde el checkout (?orden=<id>&nuevo=1): se abre su detalle con el estado real
  const [recienEnviado, setRecienEnviado] = useState<string | null>(null);
  // Edición del pedido por aprobar (se hace dentro del mismo panel de detalle) y aviso con el total que recalculó GUDS
  const [editando, setEditando] = useState(false);
  const [actualizado, setActualizado] = useState<{ id: string; total: number } | null>(null);
  const { formatPrice } = useCurrency();
  const { user } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (user?.cliente_id) {
      fetchOrdenes();
    }
  }, [user?.cliente_id]);

  // silencioso: refresca sin reemplazar la lista por el indicador de carga (p. ej. después de editar)
  const fetchOrdenes = async (silencioso = false) => {
    if (!silencioso) setLoading(true);
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
    return (data ?? null) as OrdenDB[] | null;
  };

  // Guardado: se recarga el pedido desde la base y se muestra el total que devolvió el servidor
  const alGuardarEdicion = async (r: ResultadoEdicion) => {
    setEditando(false);
    setActualizado({ id: r.orden_id, total: r.total });
    toast({ title: "Pedido actualizado", description: `${r.numero} · ${formatPrice(r.total)}. Sigue pendiente de aprobación.` });
    const data = await fetchOrdenes(true);
    const o = data?.find((x) => x.id === r.orden_id);
    if (o) setSelectedOrder(o);
  };

  // El pedido dejó de estar por aprobar mientras se editaba (lo aprobaron o cambió de estado)
  const alBloquearEdicion = async (mensaje: string) => {
    const id = selectedOrder?.id;
    setEditando(false);
    setActualizado(null);
    toast({ title: "No se puede editar", description: mensaje, variant: "destructive" });
    const data = await fetchOrdenes(true);
    const o = data?.find((x) => x.id === id);
    setSelectedOrder(o ?? null);
  };

  const cerrarDetalle = () => {
    setSelectedOrder(null);
    setRecienEnviado(null);
    setEditando(false);
    setActualizado(null);
  };

  // Abrir el pedido indicado en la URL una vez cargada la lista
  useEffect(() => {
    const id = searchParams.get("orden");
    if (!id || loading) return;
    const o = ordenes.find((x) => x.id === id);
    if (o) {
      setSelectedOrder(o);
      if (searchParams.get("nuevo") === "1") setRecienEnviado(o.id);
    }
    const sp = new URLSearchParams(searchParams);
    sp.delete("orden");
    sp.delete("nuevo");
    setSearchParams(sp, { replace: true });
  }, [loading, ordenes, searchParams, setSearchParams]);

  const cancelados = ordenes.filter((o) => o.estado === "cancelado" || o.aprobacion === "rechazada");
  const entregados = ordenes.filter((o) => o.estado === "completado" && o.aprobacion !== "rechazada");
  const enCurso = ordenes.filter((o) => o.estado !== "completado" && o.estado !== "cancelado" && o.aprobacion !== "rechazada");
  const displayOrders = activeTab === "curso" ? enCurso : activeTab === "entregados" ? entregados : cancelados;

  const tabs: { k: Pestana; label: string; n: number }[] = [
    { k: "curso", label: "En curso", n: enCurso.length },
    { k: "entregados", label: "Entregados", n: entregados.length },
    { k: "cancelados", label: "Cancelados y rechazados", n: cancelados.length },
  ];

  const formatDate = (dateStr: string) => {
    const d = dateStr.length === 10 ? new Date(`${dateStr}T00:00:00`) : new Date(dateStr);
    return d.toLocaleDateString('es-VE', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  };

  return (
    <PortalMobileLayout title="Mis Pedidos">
      {/* Tabs */}
      <div className="px-4 pt-4">
        <div className="flex bg-muted rounded-xl p-1" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.k}
              role="tab"
              aria-selected={activeTab === t.k}
              onClick={() => setActiveTab(t.k)}
              className={`flex-1 min-h-[44px] py-1.5 px-2 rounded-lg text-sm font-medium leading-tight transition-colors ${
                activeTab === t.k
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground"
              }`}
            >
              {t.label} ({t.n})
            </button>
          ))}
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
              {activeTab === "curso"
                ? "No tienes pedidos en curso"
                : activeTab === "entregados" ? "Todavía no tienes pedidos entregados" : "No tienes pedidos cancelados ni rechazados"}
            </p>
            {activeTab === "curso" && (
              <Link to="/portal/catalogo">
                <Button className="mt-4">Hacer un pedido</Button>
              </Link>
            )}
          </div>
        ) : (
          displayOrders.map((order) => {
            const config = statusConfig[claveEstado(order)] || statusConfig.pendiente;
            const StatusIcon = config.icon;
            const lineas = order.items?.length || 0;

            return (
              <button
                key={order.id}
                onClick={() => setSelectedOrder(order)}
                className="w-full bg-card rounded-xl border border-border p-4 text-left"
                data-testid="pedido-card"
              >
                {/* Header */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className={`h-8 w-8 rounded-full ${config.color}/10 flex items-center justify-center`}>
                      <StatusIcon className={`h-4 w-4 ${config.color.replace('bg-', 'text-')}`} />
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">
                        {order.numero}
                        {(order.ediciones ?? 0) > 0 && (
                          <span className="ml-2 rounded border border-border px-1.5 py-0.5 align-middle text-[11px] font-normal text-muted-foreground"
                            title={order.editado_at ? `Editado el ${formatDate(order.editado_at)}` : undefined} data-testid="pedido-editado">
                            Editado
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">{formatDate(order.created_at)}</p>
                    </div>
                  </div>
                  <Badge className={`${config.color} text-white`}>
                    {config.label}
                  </Badge>
                </div>

                {/* Motivo del rechazo, visible sin abrir el detalle */}
                {order.aprobacion === "rechazada" && (
                  <p className="mb-3 rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-900">
                    {order.rechazo_motivo ? `Motivo: ${order.rechazo_motivo}` : "No se indicó el motivo."}
                  </p>
                )}

                {/* Fecha estimada de entrega (si el pedido la tiene) */}
                {(order.estado === "enviado" || order.estado === "en_camino") && order.fecha_entrega_estimada && (
                  <div className="bg-blue-500/10 rounded-lg p-2 mb-3 flex items-center gap-2">
                    <Truck className="h-4 w-4 text-blue-500" />
                    <span className="text-sm text-blue-700 font-medium">
                      Entrega estimada: {formatDate(order.fecha_entrega_estimada)}
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
                      {lineas} {lineas === 1 ? "producto" : "productos"}
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

      {/* Order Detail Sheet: contenido con scroll propio */}
      <Sheet open={!!selectedOrder} onOpenChange={(v) => { if (!v) cerrarDetalle(); }}>
        <SheetContent side="bottom" className="flex h-[90vh] supports-[height:100dvh]:h-[90dvh] flex-col gap-0 rounded-t-3xl p-0 sm:mx-auto sm:max-w-lg">
          {selectedOrder && editando && (
            <>
              <SheetHeader className="border-b border-border px-4 py-3 pr-12 text-left">
                <SheetTitle>Editar pedido {selectedOrder.numero}</SheetTitle>
                <SheetDescription>Cambia cantidades, quita o agrega productos. Sigue pendiente de aprobación y el total final lo calcula GUDS.</SheetDescription>
              </SheetHeader>
              <EditorPedidoPendiente
                key={selectedOrder.id}
                ordenId={selectedOrder.id}
                modo="cliente"
                onCancelar={() => setEditando(false)}
                onGuardado={alGuardarEdicion}
                onYaNoEditable={alBloquearEdicion}
              />
            </>
          )}
          {selectedOrder && !editando && (() => {
            const config = statusConfig[claveEstado(selectedOrder)] || statusConfig.pendiente;
            const descuento = Number(selectedOrder.descuento ?? 0);
            const impuesto = Number(selectedOrder.impuesto ?? 0);
            const envio = selectedOrder.envio == null ? null : Number(selectedOrder.envio);
            const editado = (selectedOrder.ediciones ?? 0) > 0;
            const recienActualizado = actualizado?.id === selectedOrder.id;
            return (
              <>
                <SheetHeader className="border-b border-border px-4 py-3 pr-12 text-left">
                  <SheetTitle className="flex items-center justify-between gap-2">
                    <span>{selectedOrder.numero}</span>
                    <Badge className={`${config.color} text-white`}>
                      {config.label}
                    </Badge>
                  </SheetTitle>
                  <SheetDescription>
                    Pedido del {formatDate(selectedOrder.created_at)}
                    {editado && ` · Editado${selectedOrder.editado_at ? ` el ${formatDate(selectedOrder.editado_at)}` : ""}`}
                  </SheetDescription>
                </SheetHeader>

                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 space-y-6">
                  {recienEnviado === selectedOrder.id && (
                    <div className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-900" data-testid="pedido-recibido">
                      <p className="font-semibold">Pedido recibido · pendiente de aprobación</p>
                      <p className="mt-1">Nuestro equipo revisará precios, disponibilidad y condiciones. Te avisaremos por notificación cuando lo aprobemos.</p>
                    </div>
                  )}
                  {recienActualizado && (
                    <div className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-900" data-testid="pedido-actualizado">
                      <p className="font-semibold">Pedido actualizado · pendiente de aprobación</p>
                      <p className="mt-1">GUDS recalculó el total: <strong>{formatPrice(actualizado?.total ?? selectedOrder.total)}</strong>. Te avisaremos cuando lo aprobemos.</p>
                    </div>
                  )}
                  {selectedOrder.aprobacion === "pendiente" && recienEnviado !== selectedOrder.id && !recienActualizado && (
                    <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                      Tu pedido está <strong>pendiente de aprobación</strong>. Te avisaremos cuando sea aprobado y pase a preparación.
                    </p>
                  )}
                  {clientePuedeEditar(selectedOrder) && (
                    <Button variant="outline" className="h-11 w-full gap-2" onClick={() => setEditando(true)} data-testid="editar-pedido">
                      <Pencil className="h-4 w-4" />
                      Editar pedido
                    </Button>
                  )}
                  {pedidoEditable(selectedOrder) && selectedOrder.vendedor_id && (
                    <p className="text-xs text-muted-foreground" data-testid="pedido-del-vendedor">
                      Este pedido lo cargó tu vendedor. Si necesitas cambiarlo, comunícate con él.
                    </p>
                  )}
                  {selectedOrder.aprobacion === "rechazada" && (
                    <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
                      Este pedido no fue aprobado{selectedOrder.rechazo_motivo ? `: ${selectedOrder.rechazo_motivo}` : "."}
                    </p>
                  )}
                  {selectedOrder.fecha_entrega_estimada && (
                    <div className="bg-muted rounded-xl p-4">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Entrega estimada</span>
                        <span>{formatDate(selectedOrder.fecha_entrega_estimada)}</span>
                      </div>
                    </div>
                  )}

                  {/* Pedido en camino */}
                  {(selectedOrder.estado === "enviado" || selectedOrder.estado === "en_camino") && (
                    <div className="bg-blue-500/10 rounded-xl p-4">
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

                  {/* Totales del pedido, tal como se guardaron */}
                  <div className="bg-muted rounded-xl p-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Subtotal</span>
                      <span>{formatPrice(selectedOrder.subtotal)}</span>
                    </div>
                    {descuento > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Descuento</span>
                        <span>-{formatPrice(descuento)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">IVA</span>
                      <span>{formatPrice(impuesto)}</span>
                    </div>
                    {envio != null && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Envío</span>
                        <span>{formatPrice(envio)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-semibold pt-2 border-t border-border">
                      <span>Total</span>
                      <span className="text-primary">{formatPrice(selectedOrder.total)}</span>
                    </div>
                  </div>
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
