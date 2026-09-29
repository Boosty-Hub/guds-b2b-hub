import { useState, useEffect, useCallback } from "react";
import { ShoppingCart } from "lucide-react";
import { supabase, Producto } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { cn } from "@/lib/utils";

// Panel del carrito del portal (F1): un único carrito para todo el portal. En escritorio se abre desde el botón del header;
// en móvil, desde la barra de carrito que aparece sobre la navegación inferior cuando hay productos. La hoja lateral
// (CarritoHoja, con Radix Dialog) se descarga aparte: ver PortalShell.

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

export const precioBase = (p?: Producto | null) => (p?.en_oferta && p?.precio_oferta ? Number(p.precio_oferta) : Number(p?.precio_base || 0));

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

/** Botón del carrito para el header de escritorio. */
export const BotonCarrito = ({ estado, className }: { estado: EstadoCarritoPanel; className?: string }) => (
  <button
    type="button"
    onClick={() => estado.setAbierto(true)}
    className={cn("relative flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-muted", className)}
    data-testid="boton-carrito"
  >
    <ShoppingCart className="h-4 w-4" strokeWidth={1.75} aria-hidden />
    <span>Carrito</span>
    {estado.lineas > 0 && (
      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold tabular-nums text-primary-foreground">
        {estado.lineas}<span className="sr-only"> {estado.lineas === 1 ? "producto" : "productos"}</span>
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
