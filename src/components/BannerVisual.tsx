import { ReactNode } from "react";

interface BannerVisualProps {
  banner: { bgColor: string; imagenUrl: string | null; title: string; subtitle: string };
  className?: string;
  titleClassName?: string;
  subtitleClassName?: string;
  children?: ReactNode;
}

// Único punto de render de un banner: usa la imagen de diseño si existe,
// y si no cae al gradiente de Tailwind (comportamiento anterior).
export function BannerVisual({ banner, className, titleClassName, subtitleClassName, children }: BannerVisualProps) {
  if (banner.imagenUrl) {
    return (
      <div className={`relative overflow-hidden ${className || ""}`}>
        <img src={banner.imagenUrl} alt={banner.title} className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-black/30" />
        <div className="relative text-white">
          <p className={titleClassName || "font-bold"}>{banner.title}</p>
          <p className={subtitleClassName || "text-sm opacity-90"}>{banner.subtitle}</p>
          {children}
        </div>
      </div>
    );
  }
  return (
    <div className={`bg-gradient-to-r ${banner.bgColor} text-white ${className || ""}`}>
      <p className={titleClassName || "font-bold"}>{banner.title}</p>
      <p className={subtitleClassName || "text-sm opacity-90"}>{banner.subtitle}</p>
      {children}
    </div>
  );
}
