import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { TablaDocumentos } from "./TablaDocumentos";
import type { EstadoCuentaCompleto } from "./tipos";

// Cruce por factura en la ficha del cliente del vendedor (fase 21b, punto 2.2): base, IVA, abonos por tipo, saldo, qué
// falta y comentarios, con la misma función que el admin (estado_cuenta_cliente: el vendedor solo para clientes de su
// cartera). Se carga al abrirlo para no pesar en la ficha.

export function CruceDocumentosVendedor({ clienteId }: { clienteId: string }) {
  const { formatPrice } = useCurrency();
  const [abierto, setAbierto] = useState(false);
  const [datos, setDatos] = useState<EstadoCuentaCompleto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const alternar = async () => {
    const nuevo = !abierto;
    setAbierto(nuevo);
    if (!nuevo || datos || cargando) return;
    setCargando(true);
    const { data, error: e } = await supabase.rpc("estado_cuenta_cliente", { p_cliente_id: clienteId, p_movimientos: false });
    setCargando(false);
    if (e) setError(e.message); else setDatos(data as EstadoCuentaCompleto);
  };

  return (
    <div className="mt-2 rounded-lg border border-border bg-card" data-testid="cruce-vendedor">
      <button type="button" onClick={alternar} aria-expanded={abierto} className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[13px] font-medium">
        {abierto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        Cruce por factura: base, IVA, abonos y qué falta
      </button>
      {abierto && (
        <div className="border-t border-border">
          {cargando ? <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
            : error ? <p className="p-3 text-xs text-destructive">{error}</p>
            : datos ? <TablaDocumentos docs={datos.abiertos ?? []} modo="admin" formato={formatPrice} limite={10} testId="vendedor-documentos" /> : null}
        </div>
      )}
    </div>
  );
}
