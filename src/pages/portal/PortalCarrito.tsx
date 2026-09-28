import { useState, useEffect, useRef, useMemo } from "react";
import { PortalPagina } from "@/components/portal/PortalPagina";
import { EstadoVacio, Panel, SkeletonFilas, unidadTexto, useEsEscritorio } from "@/components/portal/sistema";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Minus,
  Trash2,
  Ticket,
  Truck,
  CreditCard,
  ChevronRight,
  ShoppingBag,
  Loader2,
  Upload,
  Paperclip,
  Landmark,
  Smartphone,
  Mail,
  CalendarClock,
  Banknote
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { supabase, Producto } from "@/lib/supabase";
import { compressImage } from "@/lib/image";
import { ProductImage } from "@/components/portal/ProductImage";
import { CuentaPagoDatos } from "@/components/portal/CuentaPagoDatos";
import { useCuentasPago, metodosDeCuenta, type MetodoCuenta } from "@/hooks/useCuentasPago";
import { useCotizacion } from "@/hooks/useCotizacion";
import { ResumenCotizacion } from "@/components/portal/ResumenCotizacion";
import { EtiquetaIva } from "@/components/portal/EtiquetaIva";

const METODOS_CON_COMPROBANTE = ["transferencia", "pago_movil", "zelle"];
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
  tipo_empaque?: { unidades: number | null } | null;
}

interface CuponDB {
  id: string;
  codigo: string;
  tipo: string;
  valor: number;
  descripcion: string;
}

// Pago móvil y Zelle solo aparecen si alguna cuenta publicada tiene esos datos (ver metodosDeCuenta)
const METODOS_BASE = [
  { id: "transferencia", name: "Transferencia bancaria", icon: Landmark },
  { id: "pago_movil", name: "Pago móvil", icon: Smartphone },
  { id: "zelle", name: "Zelle", icon: Mail },
  { id: "credito", name: "Crédito", icon: CalendarClock },
  { id: "efectivo", name: "Efectivo contra entrega", icon: Banknote },
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
  // Cuenta destino que el cliente indica (a dónde pagó): cuentas publicadas (vista cuentas_pago), filtradas por moneda
  const { cuentas: bancos } = useCuentasPago();
  const [monedaPago, setMonedaPago] = useState<"USD" | "BS">("USD");
  const [bancoPagoId, setBancoPagoId] = useState<string>("");
  const { formatPrice, exchangeRate } = useCurrency();
  const { user } = useAuth();
  const [credito, setCredito] = useState<{ modo: string; disponible: number; limite: number } | null>(null);
  useEffect(() => {
    if (!user?.cliente_id) return;
    supabase.rpc("credito_disponible", { p_cliente_id: user.cliente_id }).then(({ data }) => {
      const r = (data as { modo: string; disponible: number; limite: number }[] | null)?.[0];
      if (r) setCredito(r);
    });
  }, [user?.cliente_id]);
  const navigate = useNavigate();
  const { toast } = useToast();
  const esEscritorio = useEsEscritorio();

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
        producto:productos(id, nombre, sku, unidad, imagen_url, impuesto_pct, impuesto_nombre, controla_stock, stock_disponible, stock_actual, en_oferta, precio_oferta, precio_base),
        tipo_empaque:tipos_empaque(unidades)
      `)
      .eq('usuario_id', user?.id);
    
    if (data) setCart(data);
    setLoading(false);
  };

  const updateQuantity = async (id: string, delta: number) => {
    const item = cart.find(i => i.id === id);
    if (!item) return;
    
    const newQuantity = Math.max(1, item.cantidad + delta);
    // No se puede pedir sobre lo comprometido: tope por el disponible del producto (en unidades)
    if (delta > 0 && item.producto?.controla_stock !== false) {
      const unidades = (i: CartItemDB) => Math.max(1, Number(i.tipo_empaque?.unidades ?? 1));
      const enCarrito = cart.filter((i) => i.producto_id === item.producto_id).reduce((s, i) => s + i.cantidad * unidades(i), 0);
      const disponible = Number(item.producto?.stock_disponible ?? item.producto?.stock_actual ?? 0);
      if (enCarrito + delta * unidades(item) > disponible) {
        toast({ title: "Sin disponible suficiente", description: `De ${item.producto?.nombre} quedan ${Math.floor(disponible)} unidades disponibles.`, variant: "destructive" });
        return;
      }
    }
    
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
        title: "Cupón aplicado",
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

  // Total exacto del servidor (cotizar_pedido): precio efectivo del cliente, IVA de cada producto (Odoo), cupón y envío
  const itemsCotizar = useMemo(() => cart.map((i) => ({ producto_id: i.producto_id, cantidad: i.cantidad, tipo_empaque_id: i.tipo_empaque_id })), [cart]);
  const cotizacionEstado = useCotizacion({ clienteId: user?.cliente_id, items: itemsCotizar, cuponId: cuponApplied?.id ?? null });
  const { cotizacion, cargando: cotizando, error: errorCotizacion, lineaDe } = cotizacionEstado;
  // Total confirmado de lo que hay en pantalla (no uno viejo mientras se recalcula)
  const total = cotizacion && !cotizando && !errorCotizacion ? cotizacion.total : null;

  const getItemPrice = (item: CartItemDB) => {
    // Precio que cobra el servidor (cotización); mientras llega, el guardado en el carrito o el del producto
    const cotizado = lineaDe(item.producto_id, item.tipo_empaque_id);
    if (cotizado) return cotizado.precio_unitario;
    if (item.precio_unitario != null) return Number(item.precio_unitario);
    const product = item.producto;
    return product.en_oferta && product.precio_oferta
      ? product.precio_oferta
      : product.precio_base;
  };

  const cartCount = cart.reduce((sum, item) => sum + item.cantidad, 0);
  // Cuánto falta para el envío gratis (regla del portal, sobre el subtotal con el descuento)
  const faltaEnvioGratis = cotizacion && cotizacion.envio > 0
    ? Math.max(0, cotizacion.envio_gratis_desde - (cotizacion.subtotal - cotizacion.descuento))
    : null;

  const requiereComprobante = selectedPayment ? METODOS_CON_COMPROBANTE.includes(selectedPayment) : false;
  const aceptaMetodo = (m: string) => (c: (typeof bancos)[number]) => (metodosDeCuenta(c) as string[]).includes(m);
  const metodosPago = METODOS_BASE.filter((m) => !METODOS_CON_COMPROBANTE.includes(m.id) || bancos.some(aceptaMetodo(m.id)));
  // Monedas con al menos una cuenta que recibe el método elegido (Zelle: USD; pago móvil: Bs.)
  const monedasMetodo = (["USD", "BS"] as const).filter((m) => bancos.some((c) => c.moneda === m && (!selectedPayment || aceptaMetodo(selectedPayment)(c))));
  const bancosFiltrados = bancos.filter((b) => b.moneda === monedaPago && (!selectedPayment || aceptaMetodo(selectedPayment)(b)));
  const bancoPago = bancos.find((b) => b.id === bancoPagoId);
  const tasaPago = monedaPago === "BS" ? exchangeRate : 0;
  const montoPagar = total == null ? null : monedaPago === "BS" && tasaPago > 0 ? total * tasaPago : total;

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

    // Sin el total calculado por el servidor no se envía (el cliente debe ver lo que va a pagar)
    if (total == null) {
      toast({ title: "Falta calcular el total", description: errorCotizacion ?? "Espera un momento a que se calcule el total del pedido.", variant: "destructive" });
      return;
    }

    if (requiereComprobante && !bancoPagoId) {
      toast({
        title: "Elige el banco",
        description: "Indica a qué cuenta transferiste para continuar",
        variant: "destructive",
      });
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
      p_banco_id: requiereComprobante ? (bancoPagoId || null) : null,
      p_moneda: requiereComprobante ? monedaPago : 'USD',
      p_tasa: requiereComprobante && monedaPago === 'BS' ? (tasaPago || null) : null,
    });

    if (error) {
      toast({ title: "No se pudo confirmar el pedido", description: error.message, variant: "destructive" });
      setSubmitting(false);
      return;
    }

    const creada = (Array.isArray(data) ? data[0] : data) as { orden_id?: string; numero?: string } | null;

    // Todo pedido de cliente queda pendiente de aprobación en el admin: no se promete confirmación ni fecha
    toast({
      title: "Pedido recibido · pendiente de aprobación",
      description: `${creada?.numero ? `Pedido ${creada.numero}. ` : ""}Te avisaremos cuando lo aprobemos.`,
    });

    setCart([]);
    setSubmitting(false);
    navigate(creada?.orden_id ? `/portal/pedidos?orden=${creada.orden_id}&nuevo=1` : "/portal/pedidos");
  };

  if (loading) {
    return (
      <PortalPagina titulo="Carrito" volver="/portal/catalogo" etiquetaVolver="Seguir comprando">
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-6">
          <SkeletonFilas n={3} alto="h-24" />
          <SkeletonFilas n={1} alto="h-64" className="hidden lg:block" />
        </div>
      </PortalPagina>
    );
  }

  if (cart.length === 0) {
    return (
      <PortalPagina titulo="Carrito" volver="/portal/catalogo" etiquetaVolver="Seguir comprando" ancho="estrecho">
        <div className="rounded-xl border border-border bg-card">
          <EstadoVacio
            icono={ShoppingBag}
            titulo="Tu carrito está vacío"
            descripcion="Agrega productos del catálogo o repite un pedido anterior desde Mis pedidos."
            accion={<Button asChild size="lg"><Link to="/portal/catalogo">Explorar productos</Link></Button>}
          />
        </div>
      </PortalPagina>
    );
  }

  const botonEnviar = (
    <Button
      className="h-12 w-full text-base font-semibold"
      size="lg"
      onClick={handleCheckout}
      disabled={submitting || total == null}
      data-testid="enviar-pedido"
    >
      {submitting ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : total != null ? (
        <>Enviar pedido · <span className="tabular-nums">{formatPrice(total)}</span></>
      ) : cotizando ? (
        <><Loader2 className="h-4 w-4 animate-spin" />Calculando el total…</>
      ) : (
        <>Enviar pedido</>
      )}
    </Button>
  );

  return (
    <PortalPagina
      titulo={`Carrito (${cart.length} ${cart.length === 1 ? "producto" : "productos"})`}
      descripcion="Revisa tu pedido, elige cómo vas a pagar y envíalo. Lo aprobamos antes de prepararlo."
      volver="/portal/catalogo"
      etiquetaVolver="Seguir comprando"
    >
      <div className="pb-24 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-6 lg:pb-0">
        <div className="space-y-4">
          {/* Envío (según la cotización del servidor) */}
          {cotizacion && (
            <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
              <Truck className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
              <p className="text-sm text-foreground">
                {faltaEnvioGratis == null ? "Envío sin costo en este pedido." : <>Agrega <span className="font-semibold tabular-nums">{formatPrice(faltaEnvioGratis)}</span> más para envío sin costo.</>}
              </p>
            </div>
          )}

          {/* Productos */}
          <Panel titulo={`Productos (${cart.length})`} descripcion={`${cartCount} ${cartCount === 1 ? "unidad o empaque" : "unidades o empaques"} en total`} cuerpoClassName="p-0 sm:p-0">
            <ul className="divide-y divide-border">
              {cart.map((item) => {
                const product = item.producto;
                const price = getItemPrice(item);
                return (
                  <li key={item.id} className="flex gap-3 px-4 py-3 sm:px-5" data-testid="checkout-linea">
                    <ProductImage imageUrl={product?.imagen_url} alt={product?.nombre} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm font-medium leading-snug text-foreground">{product?.nombre}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {product?.sku ? `${product.sku} · ` : ""}{unidadTexto(product?.unidad)}
                        {product?.impuesto_pct != null && <> · <EtiquetaIva pct={product.impuesto_pct} nombre={product.impuesto_nombre} className="text-xs" /></>}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center rounded-md border border-border">
                          <button type="button" className="flex h-9 w-9 items-center justify-center text-muted-foreground hover:text-foreground"
                            onClick={() => updateQuantity(item.id, -1)} aria-label={`Quitar uno de ${product?.nombre}`}><Minus className="h-4 w-4" /></button>
                          <span className="w-9 text-center text-sm font-medium tabular-nums" aria-live="polite">{item.cantidad}</span>
                          <button type="button" className="flex h-9 w-9 items-center justify-center text-muted-foreground hover:text-foreground"
                            onClick={() => updateQuantity(item.id, 1)} aria-label={`Agregar uno de ${product?.nombre}`}><Plus className="h-4 w-4" /></button>
                        </div>
                        <p className="text-sm tabular-nums text-muted-foreground">
                          {formatPrice(price)} c/u · <span className="font-semibold text-foreground">{formatPrice(price * item.cantidad)}</span>
                        </p>
                      </div>
                    </div>
                    <button type="button" onClick={() => removeItem(item.id)} className="self-start rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                      aria-label={`Eliminar ${product?.nombre} del carrito`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </Panel>

          {/* Cupón */}
          <Panel titulo={<span className="flex items-center gap-2"><Ticket className="h-4 w-4 text-muted-foreground" />Cupón de descuento</span>}>
            {cuponApplied ? (
              <div className="flex items-center justify-between rounded-lg border border-success/30 bg-success/5 px-3 py-2">
                <div>
                  <p className="font-medium text-foreground">{cuponApplied.codigo}</p>
                  <p className="text-xs text-muted-foreground">
                    {cuponApplied.tipo === 'porcentaje'
                      ? `${cuponApplied.valor}% de descuento aplicado`
                      : `${formatPrice(cuponApplied.valor)} de descuento aplicado`}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => { setCuponApplied(null); setCuponCode(""); }}>Quitar</Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input placeholder="Ingresa tu código" value={cuponCode} onChange={(e) => setCuponCode(e.target.value)} className="flex-1" aria-label="Código de cupón" />
                <Button variant="outline" onClick={applyCupon} disabled={!cuponCode}>Aplicar</Button>
              </div>
            )}
          </Panel>

          {/* Método de pago */}
          <button
            type="button"
            onClick={() => setIsPaymentOpen(true)}
            className="flex w-full items-center justify-between rounded-xl border border-border bg-card px-4 py-3.5 text-left hover:bg-muted/40 sm:px-5"
            data-testid="elegir-metodo"
          >
            <span className="flex items-center gap-3">
              <CreditCard className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} />
              <span>
                <span className="block text-sm font-semibold">Método de pago</span>
                <span className="block text-sm text-muted-foreground">
                  {selectedPayment ? metodosPago.find((m) => m.id === selectedPayment)?.name : "Selecciona un método"}
                </span>
              </span>
            </span>
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          </button>

          {/* Comprobante de pago: requerido antes de confirmar cuando el método lo exige */}
          {requiereComprobante && (
            <Panel titulo="¿A qué cuenta pagaste?">
              <div className="space-y-4">
                <div className="flex gap-2">
                  {monedasMetodo.map((m) => (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={monedaPago === m}
                      onClick={() => { setMonedaPago(m); setBancoPagoId(""); }}
                      className={`flex-1 rounded-lg border py-2 text-sm font-medium transition-colors ${monedaPago === m ? "border-foreground bg-muted" : "border-border"}`}
                    >
                      {m === "USD" ? "Dólares (USD)" : "Bolívares (Bs.)"}
                    </button>
                  ))}
                </div>

                <div className="space-y-2">
                  <Label>Banco / cuenta destino *</Label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {bancosFiltrados.map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        aria-pressed={bancoPagoId === b.id}
                        onClick={() => setBancoPagoId(b.id)}
                        className={`w-full rounded-lg border p-3 text-left transition-colors ${bancoPagoId === b.id ? "border-foreground bg-muted/60 ring-1 ring-foreground" : "border-border hover:bg-muted/40"}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium">{b.nombre}</p>
                          <span className="shrink-0 text-xs font-semibold">{b.moneda === "USD" ? "USD $" : "Bs."}</span>
                        </div>
                        {b.numero_cuenta && <p className="font-mono text-xs text-muted-foreground">{b.numero_cuenta}</p>}
                        {b.titular && <p className="text-xs text-muted-foreground">{b.titular}</p>}
                      </button>
                    ))}
                  </div>
                  {bancosFiltrados.length === 0 && (
                    <p className="text-sm text-muted-foreground">No hay cuentas en {monedaPago === "USD" ? "dólares" : "bolívares"} para este método.</p>
                  )}
                </div>

                {bancoPago && (
                  <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
                    <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Datos de la cuenta</p>
                    <CuentaPagoDatos cuenta={bancoPago} metodo={selectedPayment as MetodoCuenta} />
                  </div>
                )}

                <div className="flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2 text-sm">
                  <span className="text-muted-foreground">Monto a transferir</span>
                  <span className="font-semibold tabular-nums" data-testid="monto-transferir">
                    {total == null || montoPagar == null
                      ? (cotizando ? "Calculando…" : "—")
                      : monedaPago === "BS" && tasaPago > 0
                        ? `Bs. ${montoPagar.toLocaleString("es-VE", { maximumFractionDigits: 2 })}`
                        : formatPrice(total)}
                  </span>
                </div>
                {monedaPago === "BS" && tasaPago > 0 && total != null && (
                  <p className="-mt-2 text-xs text-muted-foreground tabular-nums">Equivale a {formatPrice(total)} · tasa Bs. {tasaPago.toLocaleString("es-VE")}/USD</p>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="ref-checkout">Número de referencia *</Label>
                    <Input id="ref-checkout" placeholder="Ej: 123456789" value={referenciaPago} onChange={(e) => setReferenciaPago(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Comprobante *</Label>
                    <input ref={comprobanteInputRef} type="file" accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={handleComprobanteSelect} />
                    <button
                      type="button"
                      onClick={() => comprobanteInputRef.current?.click()}
                      className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-dashed border-border px-3 text-sm text-muted-foreground transition-colors hover:border-foreground/40"
                    >
                      {comprobanteFile ? (
                        <><Paperclip className="h-4 w-4 shrink-0 text-foreground" /><span className="truncate text-foreground">{comprobanteFile.name}</span></>
                      ) : (
                        <><Upload className="h-4 w-4 shrink-0" />Adjuntar (PDF, JPG o PNG, máx. 5 MB)</>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </Panel>
          )}

          {/* Qué pasa después de enviar (sin fechas fijas: la entrega se coordina al aprobar) */}
          <p className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground sm:px-5">
            <Truck className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
            <span>Tu pedido quedará <strong className="text-foreground">pendiente de aprobación</strong>. Te avisaremos cuando lo aprobemos y coordinaremos la entrega.</span>
          </p>
        </div>

        {/* Resumen (escritorio: columna fija a la derecha) */}
        <aside className="mt-4 lg:sticky lg:top-[5.5rem] lg:mt-0">
          <Panel titulo="Resumen del pedido" descripcion={`${cart.length} ${cart.length === 1 ? "producto" : "productos"}`}>
            <ResumenCotizacion {...cotizacionEstado} claseTotal="text-foreground"
              vacio={user?.cliente_id ? undefined : "Tu usuario no tiene una cuenta de cliente asociada: no podemos calcular el total. Comunícate con tu ejecutivo."} />
            <p className="mt-3 text-xs text-muted-foreground">El IVA depende de cada producto (exento o gravado) y lo calcula GUDS igual que en tu factura.</p>
            <div className="mt-4 hidden lg:block">{botonEnviar}</div>
          </Panel>
        </aside>
      </div>

      {/* Botón fijo (móvil y tableta), sobre la navegación inferior */}
      <div className="fixed inset-x-0 z-30 border-t border-border bg-card/95 px-4 py-3 backdrop-blur lg:hidden" style={{ bottom: "calc(4rem + env(safe-area-inset-bottom))" }}>
        <div className="mx-auto max-w-3xl">{botonEnviar}</div>
      </div>

      {/* Método de pago: hoja inferior en móvil, panel lateral en escritorio */}
      <Sheet open={isPaymentOpen} onOpenChange={setIsPaymentOpen}>
        <SheetContent side={esEscritorio ? "right" : "bottom"} className={esEscritorio ? "w-full sm:max-w-md" : "max-h-[90vh] overflow-y-auto rounded-t-2xl pb-[max(1.5rem,env(safe-area-inset-bottom))]"}>
          <SheetHeader className="text-left">
            <SheetTitle>Método de pago</SheetTitle>
            <SheetDescription>Elige cómo vas a pagar este pedido.</SheetDescription>
          </SheetHeader>
          <div className="space-y-2 py-4">
            {metodosPago.map((metodo) => (
              <button
                key={metodo.id}
                type="button"
                aria-pressed={selectedPayment === metodo.id}
                onClick={() => {
                  setSelectedPayment(metodo.id);
                  // La moneda y la cuenta deben admitir el método (p. ej. Zelle solo en cuentas en USD)
                  const monedas = (["USD", "BS"] as const).filter((m) => bancos.some((c) => c.moneda === m && aceptaMetodo(metodo.id)(c)));
                  if (monedas.length > 0 && !monedas.includes(monedaPago)) setMonedaPago(monedas[0]);
                  if (bancoPago && !aceptaMetodo(metodo.id)(bancoPago)) setBancoPagoId("");
                  setIsPaymentOpen(false);
                }}
                className={`flex w-full items-center gap-3 rounded-lg border p-3.5 text-left transition-colors ${
                  selectedPayment === metodo.id ? "border-foreground bg-muted/60" : "border-border hover:bg-muted/40"
                }`}
              >
                <metodo.icon className="h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{metodo.name}</span>
                  {metodo.id === "credito" && credito && (
                    <span className="block text-xs text-muted-foreground">
                      {credito.modo === "abierto" ? "Crédito abierto" : Number(credito.limite) > 0 ? `Disponible ${formatPrice(Number(credito.disponible))}` : "Sin crédito aprobado"}
                    </span>
                  )}
                </span>
                {selectedPayment === metodo.id && <Badge variant="secondary">Elegido</Badge>}
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </PortalPagina>
  );
};

export default PortalCarrito;
