import { useState, useEffect, useRef } from "react";
import { PortalMobileLayout } from "@/components/portal/PortalMobileLayout";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Loader2,
  Upload,
  Paperclip
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
import { compressImage } from "@/lib/image";
import { ProductImage } from "@/components/portal/ProductImage";

const METODOS_CON_COMPROBANTE = ["transferencia", "pago_movil"];
const MAX_COMPROBANTE_SIZE = 5 * 1024 * 1024;
const ALLOWED_COMPROBANTE_TYPES = ["application/pdf", "image/jpeg", "image/png"];

interface CartItemDB {
  id: string;
  usuario_id: string;
  producto_id: string;
  cantidad: number;
  precio_unitario: number | null;
  tipo_empaque_id: string | null;
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
  const [referenciaPago, setReferenciaPago] = useState("");
  const [comprobanteFile, setComprobanteFile] = useState<File | null>(null);
  const comprobanteInputRef = useRef<HTMLInputElement>(null);
  // Config de negocio (IVA / envío) leída de la BD; los defaults coinciden con el servidor.
  const [cfg, setCfg] = useState({ iva: 16, envio: 50, envioGratis: 500 });
  const { formatPrice } = useCurrency();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    if (user?.id) {
      fetchCart();
    }
    fetchConfig();
  }, [user]);

  const fetchConfig = async () => {
    const { data } = await supabase
      .from('configuracion')
      .select('clave, valor')
      .in('clave', ['iva_porcentaje', 'costo_envio', 'envio_gratis_minimo']);
    if (data) {
      const map = Object.fromEntries(data.map((r: { clave: string; valor: unknown }) => [r.clave, Number(r.valor)]));
      setCfg({
        iva: Number.isFinite(map.iva_porcentaje) ? map.iva_porcentaje : 16,
        envio: Number.isFinite(map.costo_envio) ? map.costo_envio : 50,
        envioGratis: Number.isFinite(map.envio_gratis_minimo) ? map.envio_gratis_minimo : 500,
      });
    }
  };

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

  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

  const getItemPrice = (item: CartItemDB) => {
    // precio_unitario (precio del empaque elegido) es la fuente de verdad y coincide
    // con lo que calcula el checkout en el servidor. Fallback al precio del producto.
    if (item.precio_unitario != null) return Number(item.precio_unitario);
    const product = item.producto;
    return product.en_oferta && product.precio_oferta
      ? product.precio_oferta
      : product.precio_base;
  };

  const subtotal = cart.reduce((sum, item) => sum + getItemPrice(item) * item.cantidad, 0);
  const discount = cuponApplied
    ? (cuponApplied.tipo === 'porcentaje' ? subtotal * (cuponApplied.valor / 100) : cuponApplied.valor)
    : 0;
  const base = Math.max(0, subtotal - discount);
  const impuesto = round2(base * (cfg.iva / 100));
  const shipping = base >= cfg.envioGratis ? 0 : cfg.envio;
  const total = round2(base + impuesto + shipping);
  const cartCount = cart.reduce((sum, item) => sum + item.cantidad, 0);

  const requiereComprobante = selectedPayment ? METODOS_CON_COMPROBANTE.includes(selectedPayment) : false;

  const handleComprobanteSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ALLOWED_COMPROBANTE_TYPES.includes(file.type)) {
      toast({ title: "Formato no permitido", description: "Solo se aceptan PDF, JPG o PNG", variant: "destructive" });
      return;
    }
    if (file.size > MAX_COMPROBANTE_SIZE) {
      toast({ title: "Archivo muy grande", description: "El máximo es 5 MB", variant: "destructive" });
      return;
    }
    setComprobanteFile(file);
  };

  const uploadComprobante = async (file: File): Promise<string> => {
    // Guarda la RUTA, no una URL firmada: el bucket `documentos` es privado y
    // solo un admin puede leerlo (createSignedUrl se genera al momento de ver,
    // igual que con el documento del RIF en el registro).
    const isImage = file.type.startsWith("image/");
    const body = isImage ? await compressImage(file, 1600, 0.85) : file;
    const ext = isImage ? "jpg" : "pdf";
    const path = `comprobantes/${user?.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from("documentos").upload(path, body, {
      contentType: isImage ? "image/jpeg" : "application/pdf",
    });
    if (error) throw error;
    return path;
  };

  const handleCheckout = async () => {
    if (!selectedPayment) {
      setIsPaymentOpen(true);
      return;
    }

    if (!user?.cliente_id) {
      toast({ title: "Error", description: "No tienes un cliente asociado", variant: "destructive" });
      return;
    }

    if (requiereComprobante && (!referenciaPago || !comprobanteFile)) {
      toast({
        title: "Falta el comprobante",
        description: "Ingresa la referencia y adjunta el comprobante de pago para continuar",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);

    let comprobanteUrl: string | null = null;
    if (requiereComprobante && comprobanteFile) {
      try {
        comprobanteUrl = await uploadComprobante(comprobanteFile);
      } catch (err) {
        toast({ title: "No se pudo subir el comprobante", description: (err as Error).message, variant: "destructive" });
        setSubmitting(false);
        return;
      }
    }

    // Crear la orden de forma atómica en el servidor: numera, calcula IVA/envío,
    // inserta cabecera + items y vacía el carrito en una sola transacción.
    const { data, error } = await supabase.rpc('crear_orden_desde_carrito', {
      p_metodo_pago: selectedPayment,
      p_notas: '',
      p_cupon_id: cuponApplied?.id || null,
      p_comprobante_url: comprobanteUrl,
      p_referencia: requiereComprobante ? referenciaPago : null,
    });

    if (error) {
      toast({ title: "No se pudo confirmar el pedido", description: error.message, variant: "destructive" });
      setSubmitting(false);
      return;
    }

    const creada = Array.isArray(data) ? data[0] : data;

    toast({
      title: "¡Pedido confirmado!",
      description: `Tu pedido ${creada?.numero ?? ''} ha sido enviado para procesamiento`,
    });

    setCart([]);
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
              {shipping === 0 ? "¡Envío gratis!" : `Agrega ${formatPrice(cfg.envioGratis - base)} más para envío gratis`}
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

        {/* Comprobante de pago — requerido antes de confirmar cuando el método lo exige */}
        {requiereComprobante && (
          <div className="px-4 mt-4">
            <div className="bg-card rounded-xl border border-border p-4 space-y-3">
              <p className="font-medium">Comprobante de pago</p>
              <div className="space-y-2">
                <Label>Número de referencia *</Label>
                <Input
                  placeholder="Ej: 123456789"
                  value={referenciaPago}
                  onChange={(e) => setReferenciaPago(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Adjuntar comprobante *</Label>
                <input
                  ref={comprobanteInputRef}
                  type="file"
                  accept="application/pdf,image/jpeg,image/png"
                  className="hidden"
                  onChange={handleComprobanteSelect}
                />
                <button
                  type="button"
                  onClick={() => comprobanteInputRef.current?.click()}
                  className="w-full border-2 border-dashed border-border rounded-xl p-4 text-center hover:border-primary transition-colors"
                >
                  {comprobanteFile ? (
                    <span className="flex items-center justify-center gap-2 text-sm">
                      <Paperclip className="h-4 w-4 text-primary" />
                      {comprobanteFile.name}
                    </span>
                  ) : (
                    <span className="flex flex-col items-center gap-1 text-sm text-muted-foreground">
                      <Upload className="h-6 w-6" />
                      Toca para subir el comprobante (PDF, JPG o PNG, máx. 5 MB)
                    </span>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

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
                <span className="text-muted-foreground">IVA ({cfg.iva}%)</span>
                <span>{formatPrice(impuesto)}</span>
              </div>
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
