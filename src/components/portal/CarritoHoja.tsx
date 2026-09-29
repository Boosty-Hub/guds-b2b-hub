import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ShoppingCart, Plus, Minus, Trash2, ShoppingBag, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ProductImage } from "@/components/portal/ProductImage";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/hooks/use-toast";
import { useCotizacion } from "@/hooks/useCotizacion";
import { ResumenCotizacion } from "@/components/portal/ResumenCotizacion";
import { EtiquetaIva } from "@/components/portal/EtiquetaIva";
import { EstadoVacio, unidadTexto } from "@/components/portal/sistema";
import { notifyCartChanged, precioBase, type EstadoCarritoPanel, type LineaCarrito } from "@/components/portal/PortalCartWidget";

// Se descarga aparte (cuando el navegador queda libre o al abrir el carrito por primera vez): ver PortalShell.
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
            <ShoppingCart className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} aria-hidden />
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
                          onClick={() => cambiar(i.id, -1)} aria-label={`Quitar uno de ${i.producto?.nombre}`}><Minus className="h-3.5 w-3.5" aria-hidden /></button>
                        <span className="w-8 text-center text-sm font-medium tabular-nums" aria-live="polite">{i.cantidad}</span>
                        <button type="button" className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:text-foreground"
                          onClick={() => cambiar(i.id, 1)} aria-label={`Agregar uno de ${i.producto?.nombre}`}><Plus className="h-3.5 w-3.5" aria-hidden /></button>
                      </div>
                      <p className="text-sm font-semibold tabular-nums">{formatPrice(precio(i) * i.cantidad)}</p>
                    </div>
                  </div>
                  <button type="button" onClick={() => quitar(i.id)} className="self-start rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                    aria-label={`Eliminar ${i.producto?.nombre} del carrito`}>
                    <Trash2 className="h-4 w-4" aria-hidden />
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
              Revisar y enviar pedido <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
            <p className="mt-2 text-center text-xs text-muted-foreground">El IVA depende de cada producto (exento o gravado).</p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};
