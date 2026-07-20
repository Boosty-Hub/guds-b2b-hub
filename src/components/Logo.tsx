import gudsLogo from "@/assets/guds-logo.png";
import { cn } from "@/lib/utils";

/**
 * Logo de GUDS. El PNG original es blanco sobre transparente (pensado para fondos
 * oscuros), por lo que sobre los fondos claros de la app quedaba invisible.
 * Este componente usa el PNG como máscara y lo pinta con `currentColor`, así se
 * adapta al fondo: en fondos claros usa `text-primary` (rojo de marca) y en
 * fondos oscuros `text-primary-foreground` (blanco).
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="GUDS"
      className={cn("inline-block aspect-square shrink-0 bg-current", className)}
      style={{
        WebkitMaskImage: `url(${gudsLogo})`,
        maskImage: `url(${gudsLogo})`,
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
        WebkitMaskSize: "contain",
        maskSize: "contain",
      }}
    />
  );
}
