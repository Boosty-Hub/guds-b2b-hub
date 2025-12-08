import { useState } from "react";
import { Package } from "lucide-react";

interface ProductImageProps {
  imageUrl?: string | null;
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
  emoji, 
  alt = "Producto",
  className = "",
  size = "md"
}: ProductImageProps) => {
  const [imageError, setImageError] = useState(false);

  const baseClasses = `${sizeClasses[size]} rounded-lg bg-muted flex items-center justify-center flex-shrink-0 overflow-hidden ${className}`;

  // Si hay imagen URL y no ha fallado, mostrar imagen
  if (imageUrl && !imageError) {
    return (
      <div className={baseClasses}>
        <img
          src={imageUrl}
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
