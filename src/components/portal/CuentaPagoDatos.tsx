import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { separarBanco, type CuentaPago, type MetodoCuenta } from "@/hooks/useCuentasPago";

// Copia al portapapeles con respaldo para navegadores sin la API moderna.
const copiarTexto = async (texto: string) => {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = texto;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
};

const Fila = ({ etiqueta, valor, mono = false }: { etiqueta: string; valor: string; mono?: boolean }) => {
  const { toast } = useToast();
  const [copiado, setCopiado] = useState(false);
  const copiar = async () => {
    const ok = await copiarTexto(valor);
    if (ok) {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
      toast({ title: "Copiado", description: `${etiqueta}: ${valor}` });
    } else {
      toast({ title: "No se pudo copiar", description: "Selecciona el texto y cópialo manualmente.", variant: "destructive" });
    }
  };
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{etiqueta}</p>
        <p className={cn("break-all text-sm font-medium", mono && "font-mono tracking-tight")}>{valor}</p>
      </div>
      <button
        type="button"
        onClick={copiar}
        aria-label={`Copiar ${etiqueta.toLowerCase()}`}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {copiado ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
};

interface Props {
  cuenta: CuentaPago;
  /** Si se indica, solo se muestran los datos que hacen falta para ese método. */
  metodo?: MetodoCuenta | string | null;
  className?: string;
}

// Datos de una cuenta publicada para pagarle, cada uno con su botón de copiar.
export const CuentaPagoDatos = ({ cuenta, metodo, className }: Props) => {
  const banco = separarBanco(cuenta.banco_nombre);
  const verTransferencia = !metodo || metodo === "transferencia";
  const verPagoMovil = !!cuenta.pago_movil_telefono && (!metodo || metodo === "pago_movil");
  const verZelle = !!cuenta.zelle_correo && (!metodo || metodo === "zelle");

  return (
    <div className={cn("divide-y divide-border", className)}>
      {verTransferencia && (
        <div className="pb-1">
          {banco.nombre && <Fila etiqueta="Banco" valor={banco.nombre} />}
          {cuenta.numero_cuenta && <Fila etiqueta="Número de cuenta" valor={cuenta.numero_cuenta} mono />}
          {cuenta.titular && <Fila etiqueta="Titular" valor={cuenta.titular} />}
          {cuenta.documento && <Fila etiqueta="RIF" valor={cuenta.documento} mono />}
          {banco.swift && <Fila etiqueta="Código SWIFT" valor={banco.swift} mono />}
        </div>
      )}
      {verPagoMovil && (
        <div className="py-1">
          {!metodo && <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pago móvil</p>}
          <Fila etiqueta="Teléfono" valor={cuenta.pago_movil_telefono!} mono />
          {(cuenta.pago_movil_documento || cuenta.documento) && (
            <Fila etiqueta="Cédula o RIF" valor={(cuenta.pago_movil_documento || cuenta.documento)!} mono />
          )}
          {cuenta.pago_movil_banco && <Fila etiqueta="Código del banco" valor={cuenta.pago_movil_banco} mono />}
        </div>
      )}
      {verZelle && (
        <div className="py-1">
          {!metodo && <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Zelle</p>}
          <Fila etiqueta="Correo Zelle" valor={cuenta.zelle_correo!} />
          {(cuenta.zelle_titular || cuenta.titular) && <Fila etiqueta="Titular Zelle" valor={(cuenta.zelle_titular || cuenta.titular)!} />}
        </div>
      )}
      {cuenta.instrucciones && (
        <p className="pt-2 text-xs text-muted-foreground">{cuenta.instrucciones}</p>
      )}
    </div>
  );
};
