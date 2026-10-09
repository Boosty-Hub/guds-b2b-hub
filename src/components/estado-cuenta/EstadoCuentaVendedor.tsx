import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { BotonExcel } from "@/components/datos/BotonExcel";
import { BotonPdfEstadoCuenta } from "./BotonPdfEstadoCuenta";
import { EstadoCuenta } from "./EstadoCuenta";
import { libroEstadoCuenta } from "./excelEstadoCuenta";
import { rpcConReintento } from "./reintento";
import type { EstadoCuentaCompleto } from "./tipos";

// Estado de cuenta en la ficha del cliente del vendedor (fase 22c): el mismo componente y formato que el admin, el enlace
// público y el portal, al corte de hoy, con PDF y Excel. Sale de estado_cuenta_cliente (el vendedor solo para clientes de
// su cartera; sin comentarios internos). Se carga al abrir la pestaña para no pesar en la ficha.
// 22j: si el cliente tiene notas de entrega con saldo, el check "Incluir notas de entrega" las suma al mismo estado de cuenta.

export function EstadoCuentaVendedor({ clienteId }: { clienteId: string }) {
  const [datos, setDatos] = useState<EstadoCuentaCompleto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [tieneNe, setTieneNe] = useState(false);
  const [incluirNe, setIncluirNe] = useState(false);

  useEffect(() => {
    supabase.rpc("notas_entrega_vendedor").then(({ data }) =>
      setTieneNe(((data as { cliente_id: string }[]) ?? []).some((n) => n.cliente_id === clienteId)));
  }, [clienteId]);

  const cargar = useCallback(async () => {
    setCargando(true);
    const { data, error: e } = await rpcConReintento(() => supabase.rpc("estado_cuenta_cliente", { p_cliente_id: clienteId, p_movimientos: false, p_ne: incluirNe }));
    if (e) setError(e.message); else { setDatos(data as EstadoCuentaCompleto); setError(null); }
    setCargando(false);
  }, [clienteId, incluirNe]);
  useEffect(() => { cargar(); }, [cargar]);

  if (!datos) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-center text-sm text-muted-foreground" data-testid="vendedor-estado-cuenta">
        {cargando ? <Loader2 className="mx-auto h-5 w-5 animate-spin" />
          : <div className="space-y-2"><p>{error ?? "Sin datos"}</p><Button size="sm" variant="outline" className="gap-1.5" onClick={cargar}><RefreshCw className="h-3.5 w-3.5" />Reintentar</Button></div>}
      </div>
    );
  }
  return (
    <EstadoCuenta datos={datos} modo="vendedor" cargando={cargando} testId="vendedor-estado-cuenta"
      acciones={
        <>
          {tieneNe && (
            <label className="flex items-center gap-1.5 text-xs" data-testid="ec-incluir-ne">
              <Checkbox checked={incluirNe} onCheckedChange={(v) => setIncluirNe(v === true)} aria-label="Incluir notas de entrega en el estado de cuenta" />
              Incluir notas de entrega
            </label>
          )}
          <BotonPdfEstadoCuenta datos={datos} etiqueta="PDF" size="sm" className="h-9 gap-1.5" />
          <BotonExcel libro={() => libroEstadoCuenta(datos)} size="sm" className="h-9 gap-1.5" data-testid="ec-excel" />
        </>
      } />
  );
}
