import { Package } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ProductImage } from "@/components/portal/ProductImage";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { ProductoCarrito } from "@/hooks/useCarritoPortal";

type EmpaqueDe<T extends ProductoCarrito> = NonNullable<T["producto_empaques"]>[number]["tipo_empaque"];

interface Props<T extends ProductoCarrito> {
  producto: T | null;
  /** Precio real por empaque (precio_efectivo), { tipo_empaque_id: precio }. Vacío mientras carga. */
  precios: Record<string, number>;
  onElegir: (producto: T, empaque: EmpaqueDe<T>) => void;
  onCerrar: () => void;
}

// Elegir empaque antes de agregar al carrito (productos con más de un empaque). Compartido por catálogo, favoritos, inicio
// y el editor de pedidos pendientes.
export function SelectorEmpaqueDialog<T extends ProductoCarrito>({ producto, precios, onElegir, onCerrar }: Props<T>) {
  const { formatPrice } = useCurrency();
  return (
    <Dialog open={!!producto} onOpenChange={(v) => { if (!v) onCerrar(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Selecciona el empaque</DialogTitle>
          <DialogDescription>El precio mostrado es el que se cobra por empaque.</DialogDescription>
        </DialogHeader>
        {producto && (
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-3 pb-3 border-b">
              <ProductImage
                imageUrl={producto.imagenes?.[0] ?? producto.imagen_url}
                alt={producto.nombre}
                size="xl"
              />
              <p className="font-medium">{producto.nombre}</p>
            </div>

            <div className="space-y-2">
              {producto.producto_empaques?.map((pe) => {
                // Precio real del empaque (el que cobra el checkout); sin respaldo inventado mientras carga
                const precio = precios[pe.tipo_empaque_id];
                const unidades = Number(pe.tipo_empaque.unidades) || 1;
                return (
                  <button
                    key={pe.id}
                    type="button"
                    onClick={() => onElegir(producto, pe.tipo_empaque as EmpaqueDe<T>)}
                    className="w-full flex items-center justify-between p-3 rounded-lg border border-border hover:border-primary hover:bg-primary/5 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Package className="h-5 w-5 text-muted-foreground" />
                      <div className="text-left">
                        <p className="font-medium">{pe.tipo_empaque.nombre}</p>
                        <p className="text-xs text-muted-foreground">{unidades} {unidades === 1 ? "unidad" : "unidades"}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold tabular-nums text-primary">{precio != null ? formatPrice(precio) : "…"}</p>
                      {precio != null && unidades > 1 && <p className="text-xs tabular-nums text-muted-foreground">{formatPrice(precio / unidades)} c/u</p>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
