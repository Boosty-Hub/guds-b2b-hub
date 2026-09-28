import { lazy, Suspense, useState } from "react";
import { cn } from "@/lib/utils";
import { iniciales } from "@/components/portal/sistema";

// El carrusel (embla) solo se descarga si un producto trae varias fotos: no viaja con el shell ni con cada tarjeta.
const GaleriaImagenes = lazy(() => import("@/components/portal/GaleriaImagenes"));

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
  /** Ancho con que se pinta (atributo `sizes`); por defecto el del tamaño fijo. */
  sizes?: string;
}

const sizeClasses = {
  sm: "h-10 w-10",
  md: "h-16 w-16",
  lg: "h-20 w-20",
  xl: "h-24 w-24",
};

const anchoFijo = { sm: 40, md: 64, lg: 80, xl: 96 };

const textoIniciales = {
  sm: "text-xs",
  md: "text-base",
  lg: "text-lg",
  xl: "text-xl",
};

// Fotos del bucket público de Supabase: se piden al tamaño en que se pintan (transformación de imágenes; WebP si el
// navegador lo acepta) en vez del original (≈100–200 KB por foto). Otras URL quedan igual.
const RE_PUBLICA = /^(https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1)\/object\/public\/([^?#]+)$/;
export const urlImagenAncho = (url: string, ancho: number) => {
  const m = url.match(RE_PUBLICA);
  return m ? `${m[1]}/render/image/public/${m[2]}?width=${ancho}&resize=contain&quality=75` : url;
};
const ANCHOS = [96, 160, 320, 480, 800];
export const srcSetImagen = (url: string) => (RE_PUBLICA.test(url) ? ANCHOS.map((w) => `${urlImagenAncho(url, w)} ${w}w`).join(", ") : undefined);

// Foto del producto sobre blanco (object-contain, sin recortes). Sin foto: placeholder de marca con las iniciales del
// producto sobre un fondo neutro, nunca una caja gris ni un emoji.
export const ProductImage = ({
  imageUrl,
  images,
  alt = "Producto",
  className = "",
  size = "md",
  prioridad = false,
  sizes,
}: ProductImageProps) => {
  // 0: foto al tamaño; 1: si la transformación falla, el original; 2: sin foto (placeholder)
  const [intento, setIntento] = useState(0);

  const base = cn(sizeClasses[size], "flex shrink-0 items-center justify-center overflow-hidden rounded-lg", className);
  const galeria = (images || []).filter(Boolean);

  if (galeria.length > 1 && intento < 2) {
    return (
      <Suspense fallback={<div className={cn(base, "bg-white")} aria-busy="true" aria-label={alt} role="img" />}>
        <GaleriaImagenes urls={galeria} alt={alt} className={cn(base, "bg-white")} onError={() => setIntento(2)} />
      </Suspense>
    );
  }

  const url = galeria[0] || imageUrl;
  if (url && intento < 2) {
    const optimizada = intento === 0 && RE_PUBLICA.test(url);
    return (
      <div className={cn(base, "bg-white")}>
        <img
          src={optimizada ? urlImagenAncho(url, 320) : url}
          srcSet={optimizada ? srcSetImagen(url) : undefined}
          sizes={optimizada ? sizes ?? `${anchoFijo[size]}px` : undefined}
          alt={alt}
          loading={prioridad ? "eager" : "lazy"}
          decoding="async"
          {...(prioridad ? { fetchpriority: "high" } : {})}
          className="h-full w-full object-contain"
          onError={() => setIntento(optimizada ? 1 : 2)}
        />
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
      <span className={cn("select-none font-semibold tracking-wider text-muted-foreground", textoIniciales[size])} aria-hidden>
        {iniciales(alt)}
      </span>
    </div>
  );
};

export default ProductImage;
