import { cn } from "@/lib/utils";
import { textoIva } from "@/lib/iva";

// Etiqueta discreta con el IVA de venta del producto (de Odoo): "Exento" o "IVA 16 %". Sin dato sincronizado no muestra nada.

interface Props {
  pct: number | null | undefined;
  /** Nombre del impuesto en Odoo, como ayuda al pasar el cursor. */
  nombre?: string | null;
  className?: string;
}

export const EtiquetaIva = ({ pct, nombre, className = "" }: Props) => {
  const texto = textoIva(pct);
  if (!texto) return null;
  return (
    <span className={cn("whitespace-nowrap text-[11px] font-normal text-muted-foreground", className)}
      title={nombre ? `Impuesto en Odoo: ${nombre}` : undefined} data-testid="etiqueta-iva">
      {texto}
    </span>
  );
};
