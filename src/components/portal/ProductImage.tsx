import { useState } from "react";
import { Package } from "lucide-react";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";

interface ProductImageProps {
  imageUrl?: string | null;
  images?: string[] | null;
  emoji?: string | null;
  alt?: string;
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
}

const sizeClasses = {
  sm: "h-10 w-10 text-lg",
  md: "h-16 w-16 text-3xl",
  lg: "h-20 w-20 text-4xl",
  xl: "h-24 w-24 text-5xl",
};

export const ProductImage = ({
  imageUrl,
  images,
  emoji,
  alt = "Producto",
  className = "",
  size = "md"
}: ProductImageProps) => {
  const [imageError, setImageError] = useState(false);

  const baseClasses = `${sizeClasses[size]} rounded-lg bg-muted flex items-center justify-center flex-shrink-0 overflow-hidden ${className}`;
  const galeria = (images || []).filter(Boolean);

  // Varias imágenes: carrusel con flechas (usa embla, ya instalado y sin usar hasta ahora)
  if (galeria.length > 1 && !imageError) {
    return (
      <Carousel className={baseClasses}>
        <CarouselContent className="ml-0 h-full">
          {galeria.map((url, i) => (
            <CarouselItem key={url + i} className="pl-0 h-full">
              <img
                src={url}
                alt={`${alt} ${i + 1}`}
                className="h-full w-full object-cover"
                onError={() => setImageError(true)}
              />
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious className="left-1 h-6 w-6" />
        <CarouselNext className="right-1 h-6 w-6" />
      </Carousel>
    );
  }

  const singleUrl = galeria[0] || imageUrl;

  // Si hay imagen URL y no ha fallado, mostrar imagen
  if (singleUrl && !imageError) {
    return (
      <div className={baseClasses}>
        <img
          src={singleUrl}
          alt={alt}
          className="h-full w-full object-cover"
          onError={() => setImageError(true)}
        />
      </div>
    );
  }

  // Si hay emoji, mostrarlo
  if (emoji) {
    return (
      <div className={baseClasses}>
        {emoji}
      </div>
    );
  }

  // Fallback: icono de paquete
  return (
    <div className={baseClasses}>
      <Package className="h-1/2 w-1/2 text-muted-foreground" />
    </div>
  );
};

export default ProductImage;
