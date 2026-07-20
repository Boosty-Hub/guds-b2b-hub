import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ShoppingCart, Plus, Minus, Trash2, Loader2, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ProductImage } from "@/components/portal/ProductImage";
import { supabase, Producto } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { cn } from "@/lib/utils";

interface CartItem {
  id: string;
  producto_id: string;
  cantidad: number;
  precio_unitario: number | null;
  tipo_empaque_id: string | null;
  producto: Producto;
  tipo_empaque?: { nombre: string } | null;
}

// Evento global para mantener el widget sincronizado cuando el carrito cambia
// desde otras vistas (catálogo, etc.).
export const CART_CHANGED = "cart:changed";
export const notifyCartChanged = () => window.dispatchEvent(new Event(CART_CHANGED));

interface Props {
  /** Ancho de la columna del portal, para alinear el botón flotante. */
  maxWidthClass?: string;
}

export const PortalCartWidget = ({ maxWidthClass = "max-w-md" }: Props) => {
  const { user } = useAuth();
  const { formatPrice } = useCurrency();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchCart = useCallback(async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from("carrito")
      .select("id, producto_id, cantidad, precio_unitario, tipo_empaque_id, producto:productos(*), tipo_empaque:tipos_empaque(nombre)")
      .eq("usuario_id", user.id);
    if (data) setItems(data as unknown as CartItem[]);
  }, [user?.id]);

  useEffect(() => { fetchCart(); }, [fetchCart]);

  useEffect(() => {
    const handler = () => fetchCart();
    window.addEventListener(CART_CHANGED, handler);
    return () => window.removeEventListener(CART_CHANGED, handler);
  }, [fetchCart]);

  useEffect(() => { if (open) fetchCart(); }, [open, fetchCart]);

  const precio = (i: CartItem) => {
    if (i.precio_unitario != null) return Number(i.precio_unitario);
    const p = i.producto;
    return p?.en_oferta && p?.precio_oferta ? Number(p.precio_oferta) : Number(p?.precio_base || 0);
  };

  const count = items.reduce((s, i) => s + i.cantidad, 0);
  const subtotal = items.reduce((s, i) => s + precio(i) * i.cantidad, 0);

  const updateQty = async (id: string, delta: number) => {
    const it = items.find((i) => i.id === id); if (!it) return;
    const nueva = it.cantidad + delta;
    if (nueva <= 0) return removeItem(id);
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, cantidad: nueva } : i));
    await supabase.from("carrito").update({ cantidad: nueva, updated_at: new Date().toISOString() }).eq("id", id);
    notifyCartChanged();
  };

  const removeItem = async (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    await supabase.from("carrito").delete().eq("id", id);
    notifyCartChanged();
  };

  const irACheckout = () => { setOpen(false); navigate("/portal/carrito"); };

  return (
    <>
      {/* Botón flotante, alineado al borde derecho de la columna del portal */}
      <div className={cn("pointer-events-none fixed inset-x-0 bottom-0 z-40 mx-auto", maxWidthClass)}>
        <button
          onClick={() => setOpen(true)}
          aria-label="Abrir carrito"
          className="pointer-events-auto absolute bottom-20 right-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 transition-transform hover:scale-105 active:scale-95"
        >
          <ShoppingCart className="h-6 w-6" />
          {count > 0 && (
            <span className="absolute -right-1 -top-1 flex h-6 min-w-6 items-center justify-center rounded-full bg-destructive px-1 text-xs font-bold text-destructive-foreground">
              {count}
            </span>
          )}
        </button>
      </div>

      {/* Panel deslizante desde la derecha */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-md">
          <SheetHeader className="border-b border-border p-4">
            <SheetTitle className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5 text-primary" />
              Tu carrito {count > 0 && <span className="text-muted-foreground">({count})</span>}
            </SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto p-4">
            {loading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                  <ShoppingBag className="h-8 w-8 text-muted-foreground" />
                </div>
                <p className="font-medium">Tu carrito está vacío</p>
                <p className="mt-1 text-sm text-muted-foreground">Agrega productos desde el catálogo.</p>
                <Button className="mt-4" variant="outline" onClick={() => { setOpen(false); navigate("/portal/catalogo"); }}>
                  Ir al catálogo
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {items.map((i) => (
                  <div key={i.id} className="flex gap-3 rounded-xl border border-border bg-card p-3">
                    <ProductImage imageUrl={i.producto?.imagen_url} emoji={i.producto?.imagen_emoji} alt={i.producto?.nombre} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm font-medium">{i.producto?.nombre}</p>
                      {i.tipo_empaque?.nombre && <p className="text-xs text-muted-foreground">{i.tipo_empaque.nombre}</p>}
                      <p className="mt-1 font-bold text-primary">{formatPrice(precio(i))}</p>
                    </div>
                    <div className="flex flex-col items-end justify-between">
                      <button onClick={() => removeItem(i.id)} className="p-1 text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </button>
                      <div className="flex items-center gap-1 rounded-full bg-muted">
                        <Button size="icon" variant="ghost" className="h-7 w-7 rounded-full" onClick={() => updateQty(i.id, -1)}><Minus className="h-3 w-3" /></Button>
                        <span className="w-5 text-center text-sm font-medium tabular-nums">{i.cantidad}</span>
                        <Button size="icon" variant="ghost" className="h-7 w-7 rounded-full" onClick={() => updateQty(i.id, 1)}><Plus className="h-3 w-3" /></Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {items.length > 0 && (
            <div className="border-t border-border p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Subtotal</span>
                <span className="text-lg font-bold">{formatPrice(subtotal)}</span>
              </div>
              <Button className="h-12 w-full text-base font-semibold" onClick={irACheckout}>
                Finalizar compra
              </Button>
              <p className="mt-2 text-center text-xs text-muted-foreground">Impuestos y envío se calculan al confirmar.</p>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
};
