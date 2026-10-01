import { useState, type ComponentProps } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { descargarPdfEstadoCuenta, precargarPdfEstadoCuenta } from "./pdf";
import type { EstadoCuentaCompleto } from "./tipos";

/** "Descargar PDF": genera el estado de cuenta como archivo con diseño (mismo documento en admin, portal y enlace público). */
export function BotonPdfEstadoCuenta({ datos, enlace, etiqueta = "Descargar PDF", className, ...props }: {
  datos: EstadoCuentaCompleto | null | undefined;
  enlace?: string | null;
  etiqueta?: string;
} & Omit<ComponentProps<typeof Button>, "onClick">) {
  const [generando, setGenerando] = useState(false);
  const descargar = async () => {
    if (!datos || generando) return;
    setGenerando(true);
    try {
      await descargarPdfEstadoCuenta(datos, { enlace });
    } catch (e) {
      toast({ title: "No se pudo generar el PDF", description: (e as Error).message || "Inténtalo de nuevo.", variant: "destructive" });
    } finally {
      setGenerando(false);
    }
  };
  return (
    <Button
      variant="outline"
      className={className}
      onClick={descargar}
      onPointerEnter={precargarPdfEstadoCuenta}
      onFocus={precargarPdfEstadoCuenta}
      disabled={!datos || generando}
      aria-busy={generando}
      data-testid="ec-pdf"
      {...props}
    >
      {generando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileDown className="h-4 w-4" aria-hidden />}
      {generando ? "Generando…" : etiqueta}
    </Button>
  );
}
