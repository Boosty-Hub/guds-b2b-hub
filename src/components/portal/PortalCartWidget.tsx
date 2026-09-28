import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ShoppingCart, Plus, Minus, Trash2, ShoppingBag, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ProductImage } from "@/components/portal/ProductImage";
import { supabase, Producto } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useCotizacion } from "@/hooks/useCotizacion";
import { ResumenCotizacion } from "@/components/portal/ResumenCotizacion";
import { EtiquetaIva } from "@/components/portal/EtiquetaIva";
import { EstadoVacio, unidadTexto } from "@/components/portal/sistema";

// Panel del carrito del portal (F1): un único carrito para todo el portal. En escritorio se abre desde el botón del header;
// en móvil, desde la barra de carrito que aparece sobre la navegación inferior cuando hay productos.

export interface LineaCarrito {
  id: string;
  producto_id: string;
  cantidad: number;
  precio_unitario: number | null;
  tipo_empaque_id: string | null;
  producto: Producto;
  tipo_empaque?: { nombre: string; unidades: number | null } | null;
}

// Evento global para mantener el panel sincronizado cuando el carrito cambia desde otras vistas (catálogo, favoritos,
// "volver a pedir").
// Columnas del producto que usa el carrito (nunca select=*: el costo solo lo ve administración)
export const COLUMNAS_PRODUCTO_CARRITO = "id, nombre, sku, unidad, imagen_url, impuesto_pct, impuesto_nombre, controla_stock, stock_disponible, stock_actual, en_oferta, precio_oferta, precio_base";

export const CART_CHANGED = "cart:changed";
export const notifyCartChanged = () => window.dispatchEvent(new Event(CART_CHANGED));

const precioBase = (p?: Producto | null) => (p?.en_oferta && p?.precio_oferta ? Number(p.precio_oferta) : Number(p?.precio_base || 0));

/** Estado del carrito para el shell del portal (una sola instancia). */
export const useCarritoPanel = () => {
  const { user } = useAuth();
  const [items, setItems] = useState<LineaCarrito[]>([]);
  const [cargado, setCargado] = useState(false);
  const [abierto, setAbierto] = useState(false);

  const recargar = useCallback(async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from("carrito")
      .select(`id, producto_id, cantidad, precio_unitario, tipo_empaque_id, producto:productos(${COLUMNAS_PRODUCTO_CARRITO}), tipo_empaque:tipos_empaque(nombre, unidades)`)
      .eq("usuario_id", user.id)
      .order("created_at");
    if (data) setItems(data as unknown as LineaCarrito[]);
    setCargado(true);
  }, [user?.id]);

  useEffect(() => { recargar(); }, [recargar]);
  useEffect(() => {
    const handler = () => { recargar(); };
    window.addEventListener(CART_CHANGED, handler);
    return () => window.removeEventListener(CART_CHANGED, handler);
  }, [recargar]);
  useEffect(() => { if (abierto) recargar(); }, [abierto, recargar]);

  const unidades = items.reduce((s, i) => s + i.cantidad, 0);
  // Suma sin IVA con el precio guardado al agregar (precio_efectivo); el total exacto lo da la cotización del servidor
  const subtotal = items.reduce((s, i) => s + (i.precio_unitario != null ? Number(i.precio_unitario) : precioBase(i.producto)) * i.cantidad, 0);

  return { items, setItems, cargado, abierto, setAbierto, recargar, lineas: items.length, unidades, subtotal };
};

export type EstadoCarritoPanel = ReturnType<typeof useCarritoPanel>;

/** Hoja lateral del carrito. */
export const CarritoHoja = ({ estado }: { estado: EstadoCarritoPanel }) => {
  const { user } = useAuth();
  const { formatPrice } = useCurrency();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { items, setItems, abierto, setAbierto, unidades } = estado;

  // Total exacto del servidor (IVA de cada producto, envío); solo se cotiza con el panel abierto
  const itemsCotizar = useMemo(() => items.map((i) => ({ producto_id: i.producto_id, cantidad: i.cantidad, tipo_empaque_id: i.tipo_empaque_id })), [items]);
  const cotizacionEstado = useCotizacion({ clienteId: user?.cliente_id, items: itemsCotizar, activo: abierto });

  const precio = (i: LineaCarrito) => {
    const cotizado = cotizacionEstado.lineaDe(i.producto_id, i.tipo_empaque_id);
    if (cotizado) return cotizado.precio_unitario;
    if (i.precio_unitario != null) return Number(i.precio_unitario);
    return precioBase(i.producto);
  };

  // Tope por el disponible del producto (en unidades), igual que el catálogo y el checkout
  const cabe = (it: LineaCarrito, delta: number) => {
    const p = it.producto;
    if (!p || p.controla_stock === false || delta <= 0) return true;
    const unid = (l: LineaCarrito) => Math.max(1, Number(l.tipo_empaque?.unidades ?? 1));
    const enCarrito = items.filter((l) => l.producto_id === it.producto_id).reduce((s, l) => s + l.cantidad * unid(l), 0);
    const disponible = Number(p.stock_disponible ?? p.stock_actual ?? 0);
    if (enCarrito + delta * unid(it) <= disponible) return true;
    toast({ title: "Sin disponible suficiente", description: `De ${p.nombre} quedan ${Math.max(0, Math.floor(disponible))} unidades disponibles.`, variant: "destructive" });
    return false;
  };

  const quitar = async (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    await supabase.from("carrito").delete().eq("id", id);
    notifyCartChanged();
  };

  const cambiar = async (id: string, delta: number) => {
    const it = items.find((i) => i.id === id); if (!it) return;
    const nueva = it.cantidad + delta;
    if (nueva <= 0) return quitar(id);
    if (!cabe(it, delta)) return;
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, cantidad: nueva } : i)));
    await supabase.from("carrito").update({ cantidad: nueva, updated_at: new Date().toISOString() }).eq("id", id);
    notifyCartChanged();
  };

  const irACheckout = () => { setAbierto(false); navigate("/portal/carrito"); };

  return (
    <Sheet open={abierto} onOpenChange={setAbierto}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border px-5 py-4 pr-12 text-left">
          <SheetTitle className="flex items-center gap-2 text-base">
            <ShoppingCart className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
            Tu carrito
            {unidades > 0 && <span className="text-sm font-normal tabular-nums text-muted-foreground">({items.length} {items.length === 1 ? "producto" : "productos"})</span>}
          </SheetTitle>
          <SheetDescription className="sr-only">Productos que vas a pedir. El total final lo calcula el servidor.</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {items.length === 0 ? (
            <EstadoVacio
              icono={ShoppingBag}
              titulo="Tu carrito está vacío"
              descripcion="Agrega productos desde el catálogo o repite un pedido anterior."
              accion={<Button variant="outline" onClick={() => { setAbierto(false); navigate("/portal/catalogo"); }}>Ir al catálogo</Button>}
            />
          ) : (
            <ul className="divide-y divide-border">
              {items.map((i) => (
                <li key={i.id} className="flex gap-3 py-3 first:pt-0" data-testid="carrito-linea">
                  <ProductImage imageUrl={i.producto?.imagen_url} alt={i.producto?.nombre} size="md" className="h-14 w-14" />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-medium leading-snug">{i.producto?.nombre}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {i.tipo_empaque?.nombre ?? unidadTexto(i.producto?.unidad)}
                      {i.producto?.impuesto_pct != null && <> · <EtiquetaIva pct={i.producto.impuesto_pct} nombre={i.producto.impuesto_nombre} className="text-xs" /></>}
                    </p>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className="flex items-center rounded-md border border-border">
                        <button type="button" className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:text-foreground"
                          onClick={() => cambiar(i.id, -1)} aria-label={`Quitar uno de ${i.producto?.nombre}`}><Minus className="h-3.5 w-3.5" /></button>
                        <span className="w-8 text-center text-sm font-medium tabular-nums" aria-live="polite">{i.cantidad}</span>
                        <button type="button" className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:text-foreground"
                          onClick={() => cambiar(i.id, 1)} aria-label={`Agregar uno de ${i.producto?.nombre}`}><Plus className="h-3.5 w-3.5" /></button>
                      </div>
                      <p className="text-sm font-semibold tabular-nums">{formatPrice(precio(i) * i.cantidad)}</p>
                    </div>
                  </div>
                  <button type="button" onClick={() => quitar(i.id)} className="self-start rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                    aria-label={`Eliminar ${i.producto?.nombre} del carrito`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {items.length > 0 && (
          <div className="border-t border-border bg-card px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
            <ResumenCotizacion {...cotizacionEstado} className="mb-3" />
            <Button className="h-11 w-full gap-2 text-sm font-semibold" onClick={irACheckout} data-testid="carrito-finalizar">
              Revisar y enviar pedido <ArrowRight className="h-4 w-4" />
            </Button>
            <p className="mt-2 text-center text-xs text-muted-foreground">El IVA depende de cada producto (exento o gravado).</p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};

/** Botón del carrito para el header de escritorio. */
export const BotonCarrito = ({ estado, className }: { estado: EstadoCarritoPanel; className?: string }) => (
  <button
    type="button"
    onClick={() => estado.setAbierto(true)}
    aria-label={`Abrir carrito${estado.lineas > 0 ? ` (${estado.lineas} productos)` : ""}`}
    className={cn("relative flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-muted", className)}
    data-testid="boton-carrito"
  >
    <ShoppingCart className="h-4 w-4" strokeWidth={1.75} />
    <span>Carrito</span>
    {estado.lineas > 0 && (
      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold tabular-nums text-primary-foreground">
        {estado.lineas}
      </span>
    )}
  </button>
);

/** Barra de carrito persistente (móvil y tableta), sobre la navegación inferior; solo con productos. */
export const BarraCarrito = ({ estado }: { estado: EstadoCarritoPanel }) => {
  const { formatPrice } = useCurrency();
  if (estado.lineas === 0) return null;
  return (
    <div className="fixed inset-x-0 z-40 px-3 lg:hidden" style={{ bottom: "calc(4rem + env(safe-area-inset-bottom) + 0.5rem)" }}>
      <button
        type="button"
        onClick={() => estado.setAbierto(true)}
        className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between gap-3 rounded-xl bg-foreground px-4 text-background shadow-lg shadow-black/20"
        data-testid="barra-carrito"
      >
        <span className="flex items-center gap-3">
          <span className="flex h-8 min-w-8 items-center justify-center rounded-md bg-background/15 px-1.5 text-sm font-semibold tabular-nums">{estado.lineas}</span>
          <span className="text-left leading-tight">
            <span className="block text-sm font-semibold">Ver carrito</span>
            <span className="block text-xs opacity-70">Subtotal sin IVA</span>
          </span>
        </span>
        <span className="text-base font-semibold tabular-nums">{formatPrice(estado.subtotal)}</span>
      </button>
    </div>
  );
};
