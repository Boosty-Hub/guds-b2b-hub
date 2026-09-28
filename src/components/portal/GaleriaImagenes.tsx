import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { cn } from "@/lib/utils";
import { urlImagenAncho } from "@/components/portal/ProductImage";

// Carrusel de varias fotos de un producto (se carga aparte, solo cuando hace falta).
export default function GaleriaImagenes({ urls, alt, className, onError }: {
  urls: string[]; alt: string; className?: string; onError: () => void;
}) {
  return (
    <Carousel className={cn(className, "[&>div]:h-full [&>div]:w-full")}>
      <CarouselContent className="ml-0 h-full">
        {urls.map((url, i) => (
          <CarouselItem key={url + i} className="h-full pl-0">
            <img src={urlImagenAncho(url, 320)} alt={`${alt} ${i + 1}`} loading="lazy" decoding="async" className="h-full w-full object-contain"
              onError={onError} />
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious className="left-1 h-6 w-6" />
      <CarouselNext className="right-1 h-6 w-6" />
    </Carousel>
  );
}
