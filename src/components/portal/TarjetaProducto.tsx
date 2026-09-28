import { Heart, Minus, Plus } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCurrency } from "@/contexts/CurrencyContext";
import { ProductImage } from "@/components/portal/ProductImage";
import { EtiquetaIva } from "@/components/portal/EtiquetaIva";
import { unidadTexto } from "@/components/portal/sistema";
import { disponibleProducto, precargarFicha, sembrarFicha, type ProductoPortal } from "@/hooks/useCatalogoPortal";

// Tarjeta de producto del portal: foto sobre blanco (o placeholder de marca), código, nombre, empaque y disponible,
// precio del servidor (el que cobra el carrito) y control de cantidad a todo el ancho. Toda la tarjeta abre la ficha;
// el corazón y el control de cantidad quedan por encima del enlace.

interface Props {
  producto: ProductoPortal;
  cantidad: number;            // en el carrito (de la opción que se agrega por defecto)
  favorito?: boolean;
  onFavorito?: () => void;
  onAgregar: () => void;
  onCambiar: (delta: number) => void;
  /** Antes de abrir la ficha (p. ej. guardar la posición del catálogo). */
  onAbrir?: () => void;
  /** Primera fila visible: la foto se pide de inmediato. */
  prioridad?: boolean;
  className?: string;
}

/** Texto de la opción por defecto: "Caja ×12", "2 empaques" o la unidad de medida. */
export const empaqueTexto = (p: Pick<ProductoPortal, "producto_empaques" | "unidad">) => {
  const emp = p.producto_empaques ?? [];
  if (emp.length > 1) return `${emp.length} empaques`;
  if (emp.length === 1) {
    const t = emp[0].tipo_empaque;
    return `${t.nombre}${Number(t.unidades) > 1 ? ` ×${t.unidades}` : ""}`;
  }
  return unidadTexto(p.unidad) || "Unidad";
};

export const rutaFicha = (id: string) => `/portal/producto/${id}`;

export const TarjetaProducto = ({ producto: p, cantidad, favorito, onFavorito, onAgregar, onCambiar, onAbrir, prioridad, className }: Props) => {
  const { formatPrice } = useCurrency();
  const location = useLocation();
  const disponible = disponibleProducto(p);
  const unidades = Math.max(1, Number(p.precio_unidades) || 1);
  const hay = disponible >= unidades || (!Number.isFinite(disponible));
  const pocas = Number.isFinite(disponible) && hay && disponible < 20;
  const varios = (p.producto_empaques ?? []).length > 1;
  const precio = Number(p.precio);
  const tachado = p.en_oferta && p.precio_oferta && Number(p.precio_base) * unidades > precio ? Number(p.precio_base) * unidades : null;
  const foto = p.imagenes?.[0] ?? p.imagen_url;

  const abrir = () => { sembrarFicha(p); onAbrir?.(); };

  return (
    <article className={cn("relative flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-shadow hover:shadow-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring", className)}
      data-testid="producto-card" data-producto-id={p.id}
      onMouseEnter={() => precargarFicha(p.id)}>
      <div className="relative aspect-[16/10] overflow-hidden border-b border-border/60 bg-white">
        <ProductImage imageUrl={foto} alt={p.nombre} size="xl" prioridad={prioridad} className="absolute inset-0 h-full w-full rounded-none border-0"
          sizes="(min-width: 1280px) 280px, (min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw" />
        {p.en_oferta && p.porcentaje_descuento ? (
          <span className="absolute left-2 top-2 rounded bg-primary px-1.5 py-0.5 text-xs font-semibold tabular-nums text-primary-foreground">−{p.porcentaje_descuento}%</span>
        ) : null}
        {onFavorito && (
          <button
            type="button"
            onClick={onFavorito}
            aria-pressed={!!favorito}
            aria-label={favorito ? `Quitar ${p.nombre} de favoritos` : `Agregar ${p.nombre} a favoritos`}
            className="absolute right-1.5 top-1.5 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-card/90 text-muted-foreground shadow-sm hover:text-foreground"
          >
            <Heart className={cn("h-4 w-4", favorito && "fill-primary text-primary")} aria-hidden />
          </button>
        )}
      </div>

      <div className="flex flex-1 flex-col p-3">
        {p.sku && <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground tabular-nums">{p.sku}</p>}
        <h3 className="mt-0.5 line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-5 text-foreground" title={p.nombre}>
          {/* Enlace extendido: el área de toda la tarjeta abre la ficha */}
          <Link to={rutaFicha(p.id)} state={{ desde: location.pathname + location.search }} onClick={abrir} onFocus={() => precargarFicha(p.id)}
            className="outline-none after:absolute after:inset-0 after:content-['']" data-testid="producto-enlace">
            {p.nombre}
          </Link>
        </h3>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {empaqueTexto(p)}
          {!hay ? null : pocas ? <span className="text-amber-700 dark:text-amber-400"> · quedan {Math.floor(disponible).toLocaleString("es-VE")}</span>
            : Number.isFinite(disponible) ? <span> · {Math.floor(disponible).toLocaleString("es-VE")} {unidades > 1 ? "und. " : ""}disp.</span> : null}
        </p>

        <div className="mt-auto pt-3">
          <div className="flex items-baseline gap-2">
            <p className="text-base font-semibold tabular-nums text-foreground" data-testid="producto-precio" data-precio={precio}>
              {varios && <span className="mr-1 text-xs font-normal text-muted-foreground">desde</span>}{formatPrice(precio)}
            </p>
            {tachado != null && <p className="text-xs tabular-nums text-muted-foreground line-through">{formatPrice(tachado)}</p>}
          </div>
          {unidades > 1 && <p className="text-xs tabular-nums text-muted-foreground">{formatPrice(precio / unidades)} c/u</p>}
          <EtiquetaIva pct={p.impuesto_pct} nombre={p.impuesto_nombre} className="block text-xs" />

          <div className="relative z-10 mt-2.5">
            {!hay ? (
              <p className="flex h-10 items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">Agotado</p>
            ) : cantidad === 0 ? (
              <Button variant="outline" className="h-10 w-full gap-1.5 border-foreground/15 font-medium" onClick={onAgregar} aria-label={`Agregar ${p.nombre} al carrito`}>
                <Plus className="h-4 w-4" aria-hidden />Agregar
              </Button>
            ) : (
              <div className="flex h-10 items-center justify-between rounded-md bg-foreground text-background">
                <button type="button" className="flex h-10 w-10 items-center justify-center rounded-l-md hover:bg-background/10" onClick={() => onCambiar(-1)}
                  aria-label={`Quitar uno de ${p.nombre}`}><Minus className="h-4 w-4" aria-hidden /></button>
                <span className="text-sm font-semibold tabular-nums" aria-live="polite">{cantidad}<span className="hidden sm:inline"> en carrito</span></span>
                <button type="button" className="flex h-10 w-10 items-center justify-center rounded-r-md hover:bg-background/10" onClick={() => onCambiar(1)}
                  aria-label={`Agregar uno de ${p.nombre}`}><Plus className="h-4 w-4" aria-hidden /></button>
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
};

/** Tipo de empaque de la opción por defecto (undefined con varios empaques: el control suma en la primera línea). */
export const empaquePorDefecto = (p: ProductoPortal) => {
  const emp = p.producto_empaques ?? [];
  return emp.length > 1 ? undefined : emp[0]?.tipo_empaque_id ?? null;
};
