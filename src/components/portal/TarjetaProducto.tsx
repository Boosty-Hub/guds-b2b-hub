import { Heart, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCurrency } from "@/contexts/CurrencyContext";
import { ProductImage } from "@/components/portal/ProductImage";
import { EtiquetaIva } from "@/components/portal/EtiquetaIva";
import type { ProductoConEmpaques } from "@/hooks/useCarritoPortal";
import { unidadTexto } from "@/components/portal/sistema";

// Tarjeta de producto del portal: foto sobre blanco (o placeholder de marca), código, nombre, empaque y disponible,
// precio con cifras tabulares y control de cantidad a todo el ancho (táctil de 40 px).

interface Props {
  producto: ProductoConEmpaques;
  precio: number;
  disponible: number;          // unidades (Infinity si no controla existencias)
  cantidad: number;            // en el carrito
  favorito?: boolean;
  onFavorito?: () => void;
  onAgregar: () => void;
  onCambiar: (delta: number) => void;
  className?: string;
}

const empaqueTexto = (p: ProductoConEmpaques) => {
  const emp = p.producto_empaques ?? [];
  if (emp.length > 1) return `${emp.length} empaques`;
  if (emp.length === 1) {
    const t = emp[0].tipo_empaque;
    return t ? `${t.nombre}${Number(t.unidades) > 1 ? ` ×${t.unidades}` : ""}` : unidadTexto(p.unidad);
  }
  return unidadTexto(p.unidad);
};

export const TarjetaProducto = ({ producto: p, precio, disponible, cantidad, favorito, onFavorito, onAgregar, onCambiar, className }: Props) => {
  const { formatPrice } = useCurrency();
  const hay = disponible > 0;
  const pocas = Number.isFinite(disponible) && hay && disponible < 20;
  // Un solo empaque de varias unidades (p. ej. "Caja ×12"): se muestra el precio del empaque, que es lo que se cobra al
  // agregarlo (precio propio del empaque o unidad × unidades, como precio_efectivo), y el de la unidad debajo
  const empUnico = (p.producto_empaques ?? []).length === 1 ? p.producto_empaques![0] as { tipo_empaque?: { unidades?: number } | null; precio_empaque?: number | null } : null;
  const unidadesEmp = Number(empUnico?.tipo_empaque?.unidades ?? 1);
  const precioEmpaque = empUnico && unidadesEmp > 1 ? Number(empUnico.precio_empaque ?? precio * unidadesEmp) : null;

  return (
    <article className={cn("flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-shadow hover:shadow-sm", className)} data-testid="producto-card">
      <div className="relative aspect-[16/10] overflow-hidden border-b border-border/60 bg-white">
        <ProductImage imageUrl={p.imagen_url} images={p.imagenes} alt={p.nombre} size="xl" className="absolute inset-0 h-full w-full rounded-none border-0" />
        {p.en_oferta && p.porcentaje_descuento ? (
          <span className="absolute left-2 top-2 rounded bg-primary px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-primary-foreground">−{p.porcentaje_descuento}%</span>
        ) : null}
        {onFavorito && (
          <button
            type="button"
            onClick={onFavorito}
            aria-pressed={!!favorito}
            aria-label={favorito ? `Quitar ${p.nombre} de favoritos` : `Agregar ${p.nombre} a favoritos`}
            className="absolute right-1.5 top-1.5 flex h-9 w-9 items-center justify-center rounded-full bg-card/90 text-muted-foreground shadow-sm hover:text-foreground"
          >
            <Heart className={cn("h-4 w-4", favorito && "fill-primary text-primary")} />
          </button>
        )}
      </div>

      <div className="flex flex-1 flex-col p-3">
        {p.sku && <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground tabular-nums">{p.sku}</p>}
        <h3 className="mt-0.5 line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-5 text-foreground" title={p.nombre}>{p.nombre}</h3>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {empaqueTexto(p)}
          {!hay ? null : pocas ? <span className="text-amber-700"> · quedan {Math.floor(disponible).toLocaleString("es-VE")}</span>
            : Number.isFinite(disponible) ? <span> · {Math.floor(disponible).toLocaleString("es-VE")} {unidadesEmp > 1 ? "und. " : ""}disp.</span> : null}
        </p>

        <div className="mt-auto pt-3">
          <div className="flex items-baseline gap-2">
            <p className="text-base font-semibold tabular-nums text-foreground">{formatPrice(precioEmpaque ?? precio)}</p>
            {p.en_oferta && p.precio_oferta && Number(p.precio_base) > precio && (
              <p className="text-xs tabular-nums text-muted-foreground line-through">{formatPrice(Number(p.precio_base) * (precioEmpaque ? unidadesEmp : 1))}</p>
            )}
          </div>
          {precioEmpaque != null && (
            <p className="text-xs tabular-nums text-muted-foreground">{formatPrice(precioEmpaque / unidadesEmp)} c/u</p>
          )}
          <EtiquetaIva pct={p.impuesto_pct} nombre={p.impuesto_nombre} className="block text-xs" />

          <div className="mt-2.5">
            {!hay ? (
              <p className="flex h-10 items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">Agotado</p>
            ) : cantidad === 0 ? (
              <Button variant="outline" className="h-10 w-full gap-1.5 border-foreground/15 font-medium" onClick={onAgregar} aria-label={`Agregar ${p.nombre} al carrito`}>
                <Plus className="h-4 w-4" />Agregar
              </Button>
            ) : (
              <div className="flex h-10 items-center justify-between rounded-md bg-foreground text-background">
                <button type="button" className="flex h-10 w-10 items-center justify-center rounded-l-md hover:bg-background/10" onClick={() => onCambiar(-1)}
                  aria-label={`Quitar uno de ${p.nombre}`}><Minus className="h-4 w-4" /></button>
                <span className="text-sm font-semibold tabular-nums" aria-live="polite">{cantidad}<span className="hidden sm:inline"> en carrito</span></span>
                <button type="button" className="flex h-10 w-10 items-center justify-center rounded-r-md hover:bg-background/10" onClick={() => onCambiar(1)}
                  aria-label={`Agregar uno de ${p.nombre}`}><Plus className="h-4 w-4" /></button>
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
};
