import { useState, useEffect } from "react";
import { PortalMobileLayout } from "@/components/portal/PortalMobileLayout";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { 
  ChevronLeft, 
  Plus, 
  Minus, 
  Trash2, 
  Ticket,
  Truck,
  CreditCard,
  ChevronRight,
  ShoppingBag,
  Clock,
  Loader2
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { supabase, Producto } from "@/lib/supabase";
import { ProductImage } from "@/components/portal/ProductImage";

interface CartItemDB {
  id: string;
  usuario_id: string;
  producto_id: string;
  cantidad: number;
  producto: Producto;
}

interface CuponDB {
  id: string;
  codigo: string;
  tipo: string;
  valor: number;
  descripcion: string;
}

const metodosPago = [
  { id: "transferencia", name: "Transferencia Bancaria", icon: "🏦" },
  { id: "credito", name: "Crédito (30 días)", icon: "📅" },
  { id: "efectivo", name: "Efectivo contra entrega", icon: "💵" },
  { id: "pago_movil", name: "Pago Móvil", icon: "📱" },
];

const PortalCarrito = () => {
  const [cart, setCart] = useState<CartItemDB[]>([]);
  const [loading, setLoading] = useState(true);
  const [cuponCode, setCuponCode] = useState("");
  const [cuponApplied, setCuponApplied] = useState<CuponDB | null>(null);
  const [selectedPayment, setSelectedPayment] = useState<string | null>(null);
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { formatPrice } = useCurrency();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    if (user?.id) {
      fetchCart();
    }
  }, [user]);

  const fetchCart = async () => {
    setLoading(true);
    
    const { data } = await supabase
      .from('carrito')
      .select(`
        *,
        producto:productos(*)
      `)
      .eq('usuario_id', user?.id);
    
    if (data) setCart(data);
    setLoading(false);
  };

  const updateQuantity = async (id: string, delta: number) => {
    const item = cart.find(i => i.id === id);
    if (!item) return;
    
    const newQuantity = Math.max(1, item.cantidad + delta);
    
    // Update local state immediately
    setCart(prev => prev.map(i => 
      i.id === id ? { ...i, cantidad: newQuantity } : i
    ));
    
    // Update in database
    await supabase
      .from('carrito')
      .update({ cantidad: newQuantity, updated_at: new Date().toISOString() })
      .eq('id', id);
  };

  const removeItem = async (id: string) => {
    // Update local state immediately
    setCart(prev => prev.filter(i => i.id !== id));
    
    // Delete from database
    await supabase
      .from('carrito')
      .delete()
      .eq('id', id);
    
    toast({ title: "Eliminado", description: "Producto eliminado del carrito" });
  };

  const applyCupon = async () => {
    const { data } = await supabase
      .from('cupones')
      .select('*')
      .eq('codigo', cuponCode.toUpperCase())
      .eq('activo', true)
      .gte('fecha_fin', new Date().toISOString())
      .single();
    
    if (data) {
      setCuponApplied(data);
      toast({
        title: "¡Cupón aplicado!",
        description: data.tipo === 'porcentaje' 
          ? `${data.valor}% de descuento aplicado` 
          : `${formatPrice(data.valor)} de descuento aplicado`,
      });
    } else {
      toast({
        title: "Cupón inválido",
        description: "El código ingresado no es válido o ha expirado",
        variant: "destructive",
      });
    }
  };

  const getItemPrice = (item: CartItemDB) => {
    const product = item.producto;
    return product.en_oferta && product.precio_oferta 
      ? product.precio_oferta 
      : product.precio_base;
  };

  const subtotal = cart.reduce((sum, item) => sum + getItemPrice(item) * item.cantidad, 0);
  const discount = cuponApplied 
    ? (cuponApplied.tipo === 'porcentaje' ? subtotal * (cuponApplied.valor / 100) : cuponApplied.valor)
    : 0;
  const shipping = subtotal >= 500 ? 0 : 50;
  const total = subtotal - discount + shipping;
  const cartCount = cart.reduce((sum, item) => sum + item.cantidad, 0);

  const handleCheckout = async () => {
    if (!selectedPayment) {
      setIsPaymentOpen(true);
      return;
    }
    
    if (!user?.cliente_id) {
      toast({ title: "Error", description: "No tienes un cliente asociado", variant: "destructive" });
      return;
    }

    setSubmitting(true);

    // Generate order number
    const numeroOrden = `ORD-${Date.now().toString(36).toUpperCase()}`;

    // Create order
    const { data: orden, error: ordenError } = await supabase
      .from('ordenes')
      .insert({
        cliente_id: user.cliente_id,
        usuario_id: user.id,
        numero_orden: numeroOrden,
        estado: 'pendiente',
        subtotal: subtotal,
        descuento: discount,
        total: total,
        metodo_pago: selectedPayment,
        cupon_id: cuponApplied?.id || null,
        notas: '',
      })
      .select()
      .single();

    if (ordenError || !orden) {
      toast({ title: "Error", description: ordenError?.message || "Error al crear la orden", variant: "destructive" });
      setSubmitting(false);
      return;
    }

    // Create order items
    const orderItems = cart.map(item => ({
      orden_id: orden.id,
      producto_id: item.producto_id,
      cantidad: item.cantidad,
      precio_unitario: getItemPrice(item),
      subtotal: getItemPrice(item) * item.cantidad,
    }));

    const { error: itemsError } = await supabase
      .from('orden_items')
      .insert(orderItems);

    if (itemsError) {
      toast({ title: "Error", description: itemsError.message, variant: "destructive" });
      setSubmitting(false);
      return;
    }

    // Clear cart
    await supabase
      .from('carrito')
      .delete()
      .eq('usuario_id', user.id);

    toast({
      title: "¡Pedido confirmado!",
      description: `Tu pedido ${numeroOrden} ha sido enviado para procesamiento`,
    });
    
    setSubmitting(false);
    navigate("/portal/pedidos");
  };

  if (loading) {
    return (
      <PortalMobileLayout title="Mi Carrito">
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </PortalMobileLayout>
    );
  }

  if (cart.length === 0) {
    return (
      <PortalMobileLayout title="Mi Carrito">
        <div className="flex flex-col items-center justify-center h-[60vh] px-4">
          <div className="h-24 w-24 rounded-full bg-muted flex items-center justify-center mb-4">
            <ShoppingBag className="h-12 w-12 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-semibold mb-2">Tu carrito está vacío</h2>
          <p className="text-muted-foreground text-center mb-6">
            Agrega productos del catálogo para comenzar tu pedido
          </p>
          <Link to="/portal/catalogo">
            <Button size="lg">Explorar productos</Button>
          </Link>
        </div>
      </PortalMobileLayout>
    );
  }

  return (
    <PortalMobileLayout showHeader={false} showNav={false}>
      {/* Header */}
      <div className="bg-primary text-primary-foreground px-4 py-3 sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-1">
            <ChevronLeft className="h-6 w-6" />
          </button>
          <h1 className="text-lg font-semibold flex-1">Mi Carrito ({cartCount})</h1>
        </div>
      </div>

      <div className="pb-40">
        {/* Delivery Info */}
        <div className="mx-4 mt-4 bg-green-500/10 rounded-xl p-3 flex items-center gap-3">
          <Truck className="h-5 w-5 text-green-500" />
          <div className="flex-1">
            <p className="text-sm font-medium text-green-700">
              {shipping === 0 ? "¡Envío gratis!" : `Agrega ${formatPrice(500 - subtotal)} más para envío gratis`}
            </p>
          </div>
        </div>

        {/* Cart Items */}
        <div className="px-4 mt-4 space-y-3">
          {cart.map((item) => {
            const product = item.producto;
            const price = getItemPrice(item);
            
            return (
              <div
                key={item.id}
                className="bg-card rounded-xl border border-border p-3 flex gap-3"
              >
                <ProductImage 
                  imageUrl={product?.imagen_url}
                  emoji={product?.imagen_emoji}
                  alt={product?.nombre}
                  size="md"
                />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground line-clamp-2 text-sm">{product?.nombre}</p>
                  <p className="text-xs text-muted-foreground">por {product?.unidad}</p>
                  <p className="text-primary font-bold mt-1">{formatPrice(price)}</p>
                </div>
                <div className="flex flex-col items-end justify-between">
                  <button onClick={() => removeItem(item.id)} className="p-1 text-muted-foreground">
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <div className="flex items-center gap-2 bg-muted rounded-full">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 rounded-full"
                      onClick={() => updateQuantity(item.id, -1)}
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="font-medium w-5 text-center text-sm">{item.cantidad}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 rounded-full"
                      onClick={() => updateQuantity(item.id, 1)}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Coupon */}
        <div className="px-4 mt-4">
          <div className="bg-card rounded-xl border border-border p-4">
            <div className="flex items-center gap-2 mb-3">
              <Ticket className="h-5 w-5 text-primary" />
              <span className="font-medium">Cupón de descuento</span>
            </div>
            {cuponApplied ? (
              <div className="flex items-center justify-between bg-green-500/10 rounded-lg p-3">
                <div>
                  <p className="font-medium text-green-700">{cuponApplied.codigo}</p>
                  <p className="text-xs text-green-600">
                    {cuponApplied.tipo === 'porcentaje' 
                      ? `${cuponApplied.valor}% de descuento aplicado`
                      : `${formatPrice(cuponApplied.valor)} de descuento aplicado`}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setCuponApplied(null);
                    setCuponCode("");
                  }}
                >
                  Quitar
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input
                  placeholder="Ingresa tu código"
                  value={cuponCode}
                  onChange={(e) => setCuponCode(e.target.value)}
                  className="flex-1"
                />
                <Button onClick={applyCupon} disabled={!cuponCode}>
                  Aplicar
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Payment Method */}
        <div className="px-4 mt-4">
          <button
            onClick={() => setIsPaymentOpen(true)}
            className="w-full bg-card rounded-xl border border-border p-4 flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <CreditCard className="h-5 w-5 text-primary" />
              <div className="text-left">
                <p className="font-medium">Método de pago</p>
                <p className="text-sm text-muted-foreground">
                  {selectedPayment
                    ? metodosPago.find((m) => m.id === selectedPayment)?.name
                    : "Selecciona un método"}
                </p>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>

        {/* Delivery Time */}
        <div className="px-4 mt-4">
          <div className="bg-card rounded-xl border border-border p-4 flex items-center gap-3">
            <Clock className="h-5 w-5 text-primary" />
            <div>
              <p className="font-medium">Entrega estimada</p>
              <p className="text-sm text-muted-foreground">Mañana, 9:00 AM - 1:00 PM</p>
            </div>
          </div>
        </div>

        {/* Order Summary */}
        <div className="px-4 mt-4">
          <div className="bg-card rounded-xl border border-border p-4 space-y-3">
            <h3 className="font-semibold">Resumen del pedido</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal ({cartCount} productos)</span>
                <span>{formatPrice(subtotal)}</span>
              </div>
              {cuponApplied && (
                <div className="flex justify-between text-green-600">
                  <span>Descuento ({cuponApplied.tipo === 'porcentaje' ? `${cuponApplied.valor}%` : 'Cupón'})</span>
                  <span>-{formatPrice(discount)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Envío</span>
                <span className={shipping === 0 ? "text-green-600" : ""}>
                  {shipping === 0 ? "Gratis" : formatPrice(shipping)}
                </span>
              </div>
              <div className="border-t border-border pt-2 flex justify-between font-semibold text-base">
                <span>Total</span>
                <span className="text-primary">{formatPrice(total)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Fixed Bottom Button */}
      <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-card border-t border-border p-4">
        <Button
          className="w-full h-12 text-base font-semibold"
          size="lg"
          onClick={handleCheckout}
          disabled={submitting}
        >
          {submitting ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <>Confirmar Pedido • {formatPrice(total)}</>
          )}
        </Button>
        <div className="h-2" />
      </div>

      {/* Payment Method Sheet */}
      <Sheet open={isPaymentOpen} onOpenChange={setIsPaymentOpen}>
        <SheetContent side="bottom" className="rounded-t-3xl">
          <SheetHeader>
            <SheetTitle>Método de pago</SheetTitle>
          </SheetHeader>
          <div className="py-4 space-y-3">
            {metodosPago.map((metodo) => (
              <button
                key={metodo.id}
                onClick={() => {
                  setSelectedPayment(metodo.id);
                  setIsPaymentOpen(false);
                }}
                className={`w-full p-4 rounded-xl border flex items-center gap-3 transition-colors ${
                  selectedPayment === metodo.id
                    ? "border-primary bg-primary/5"
                    : "border-border"
                }`}
              >
                <span className="text-2xl">{metodo.icon}</span>
                <span className="font-medium">{metodo.name}</span>
                {selectedPayment === metodo.id && (
                  <Badge className="ml-auto">Seleccionado</Badge>
                )}
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </PortalMobileLayout>
  );
};

export default PortalCarrito;
