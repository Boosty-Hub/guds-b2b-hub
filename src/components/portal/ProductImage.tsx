import { useState } from "react";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { cn } from "@/lib/utils";
import { iniciales } from "@/components/portal/sistema";

interface ProductImageProps {
  imageUrl?: string | null;
  images?: string[] | null;
  /** Obsoleto: el portal ya no muestra emojis (se conserva la prop por compatibilidad). */
  emoji?: string | null;
  alt?: string;
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
  /** Imagen visible al cargar (primera fila): se pide de inmediato y con prioridad alta en vez de diferida. */
  prioridad?: boolean;
}

const sizeClasses = {
  sm: "h-10 w-10",
  md: "h-16 w-16",
  lg: "h-20 w-20",
  xl: "h-24 w-24",
};

const textoIniciales = {
  sm: "text-xs",
  md: "text-base",
  lg: "text-lg",
  xl: "text-xl",
};

// Foto del producto sobre blanco (object-contain, sin recortes). Sin foto: placeholder de marca con las iniciales del
// producto sobre un fondo neutro, nunca una caja gris ni un emoji.
export const ProductImage = ({
  imageUrl,
  images,
  alt = "Producto",
  className = "",
  size = "md",
  prioridad = false,
}: ProductImageProps) => {
  const [imageError, setImageError] = useState(false);

  const base = cn(sizeClasses[size], "flex shrink-0 items-center justify-center overflow-hidden rounded-lg", className);
  const galeria = (images || []).filter(Boolean);

  if (galeria.length > 1 && !imageError) {
    return (
      <Carousel className={cn(base, "bg-white [&>div]:h-full [&>div]:w-full")}>
        <CarouselContent className="ml-0 h-full">
          {galeria.map((url, i) => (
            <CarouselItem key={url + i} className="h-full pl-0">
              <img src={url} alt={`${alt} ${i + 1}`} loading="lazy" decoding="async" className="h-full w-full object-contain"
                onError={() => setImageError(true)} />
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious className="left-1 h-6 w-6" />
        <CarouselNext className="right-1 h-6 w-6" />
      </Carousel>
    );
  }

  const url = galeria[0] || imageUrl;
  if (url && !imageError) {
    return (
      <div className={cn(base, "bg-white")}>
        <img src={url} alt={alt} loading={prioridad ? "eager" : "lazy"} decoding="async" {...(prioridad ? { fetchpriority: "high" } : {})}
          className="h-full w-full object-contain" onError={() => setImageError(true)} />
      </div>
    );
  }

  return (
    <div
      className={cn(base, "border border-border/60 bg-gradient-to-br from-muted to-muted/40")}
      role="img"
      aria-label={alt}
      data-placeholder-producto
    >
      <span className={cn("select-none font-semibold tracking-wider text-muted-foreground/80", textoIniciales[size])} aria-hidden>
        {iniciales(alt)}
      </span>
    </div>
  );
};

export default ProductImage;
