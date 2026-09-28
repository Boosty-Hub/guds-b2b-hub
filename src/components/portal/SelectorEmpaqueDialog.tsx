import { Package } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ProductImage } from "@/components/portal/ProductImage";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { TipoEmpaque } from "@/lib/supabase";
import type { ProductoConEmpaques } from "@/hooks/useCarritoPortal";

interface Props {
  producto: ProductoConEmpaques | null;
  /** Precio real por empaque (precio_efectivo), { tipo_empaque_id: precio }. Vacío mientras carga. */
  precios: Record<string, number>;
  onElegir: (producto: ProductoConEmpaques, empaque: TipoEmpaque) => void;
  onCerrar: () => void;
}

// Elegir empaque antes de agregar al carrito (productos con más de un empaque). Compartido por catálogo y favoritos.
export const SelectorEmpaqueDialog = ({ producto, precios, onElegir, onCerrar }: Props) => {
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
                imageUrl={producto.imagen_url}
                images={producto.imagenes}
                emoji={producto.imagen_emoji}
                alt={producto.nombre}
                size="xl"
              />
              <p className="font-medium">{producto.nombre}</p>
            </div>

            <div className="space-y-2">
              {producto.producto_empaques?.map((pe) => {
                // Precio real del empaque (el que cobra el checkout); sin respaldo inventado mientras carga
                const precio = precios[pe.tipo_empaque_id];
                return (
                  <button
                    key={pe.id}
                    onClick={() => onElegir(producto, pe.tipo_empaque)}
                    className="w-full flex items-center justify-between p-3 rounded-lg border border-border hover:border-primary hover:bg-primary/5 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Package className="h-5 w-5 text-muted-foreground" />
                      <div className="text-left">
                        <p className="font-medium">{pe.tipo_empaque.nombre}</p>
                        <p className="text-xs text-muted-foreground">{pe.tipo_empaque.unidades} unidades</p>
                      </div>
                    </div>
                    <p className="font-bold text-primary">{precio != null ? formatPrice(precio) : "…"}</p>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
