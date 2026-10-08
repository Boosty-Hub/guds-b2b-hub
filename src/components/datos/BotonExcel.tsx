import { useState, type ComponentProps } from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { descargarExcel, precargarExcel, type LibroExcel } from "@/lib/excel";

/**
 * Botón "Excel" (R0 del plan de reportes): arma el libro al pulsar (`libro` puede ser async, p. ej. para pedir el
 * detalle completo al servidor) y lo descarga con formato (lib/excel). exceljs se precarga al acercar el ratón.
 */
export function BotonExcel({ libro, etiqueta = "Excel", disabled, className, ...props }: {
  libro: () => LibroExcel | null | undefined | Promise<LibroExcel | null | undefined>;
  etiqueta?: string;
} & Omit<ComponentProps<typeof Button>, "onClick">) {
  const [generando, setGenerando] = useState(false);
  const descargar = async () => {
    if (generando) return;
    setGenerando(true);
    try {
      const l = await libro();
      if (l) await descargarExcel(l);
    } catch (e) {
      toast({ title: "No se pudo generar el Excel", description: (e as Error).message || "Inténtalo de nuevo.", variant: "destructive" });
    } finally {
      setGenerando(false);
    }
  };
  return (
    <Button
      variant="outline"
      className={className}
      onClick={descargar}
      onPointerEnter={precargarExcel}
      onFocus={precargarExcel}
      disabled={disabled || generando}
      aria-busy={generando}
      data-testid="boton-excel"
      {...props}
    >
      {generando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileSpreadsheet className="h-4 w-4" aria-hidden />}
      {generando ? "Generando…" : etiqueta}
    </Button>
  );
}
