import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Info, Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FichaCampos, Panel } from "@/components/datos/FichaCampos";
import { usePermissions } from "@/contexts/PermissionsContext";
import { cn } from "@/lib/utils";
import { DetalleClasificacionDialog } from "./DetalleClasificacionDialog";
import { ESTADOS, ORIGENES, cargarLista, type FilaClasif } from "./comun";

/** Ficha del cliente: su clasificación de finanzas en Odoo (oficial), lo asignado en GUDS y el estado del envío (22d). */
export function ClasificacionClientePanel({ clienteId }: { clienteId: string }) {
  const { can } = usePermissions();
  const [fila, setFila] = useState<FilaClasif | null>(null);
  const [detalle, setDetalle] = useState(false);
  const verModulo = can("clasificacion_clientes", "ver");

  useEffect(() => {
    let vivo = true;
    cargarLista(clienteId).then((r) => { if (vivo) setFila(r[0] ?? null); }).catch(() => { if (vivo) setFila(null); });
    return () => { vivo = false; };
  }, [clienteId]);

  if (!fila) return null;
  const e = ESTADOS[fila.estado];
  return (
    <Panel titulo={<><Tags className="h-3.5 w-3.5 text-primary" />Clasificación de finanzas</>} acciones={
      <>
        <button type="button" onClick={() => setDetalle(true)} title={`${e.ayuda}. Ver detalle`} data-testid="ficha-clasificacion-estado"
          className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium", e.cls)}>
          {e.label}<Info className="h-3 w-3 opacity-50" />
        </button>
        {verModulo && (
          <Link to={`/admin/configuracion/clasificacion-clientes?q=${encodeURIComponent(fila.nombre)}&actividad=todos`}>
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs">Clasificar</Button>
          </Link>
        )}
      </>
    }>
      <FichaCampos campos={[
        { label: "Tipo de cliente", valor: fila.odoo_tipo, odoo: true },
        { label: "Canal", valor: fila.odoo_canal, odoo: true },
        { label: "Categoría de cobranza", valor: fila.odoo_segmento, odoo: true },
        { label: "Asignado en GUDS", valor: fila.tipo ? `${fila.tipo}${fila.estado_asignacion === "propuesta" ? " (propuesta)" : ""}` : null },
        { label: "Origen", valor: fila.origen ? ORIGENES[fila.origen] : null },
        { label: "Excel de finanzas", valor: fila.excel_texto },
        ...(fila.profit_tipo ? [{ label: "Profit", valor: `${fila.profit_tipo}${fila.profit_categoria ? ` → ${fila.profit_categoria}` : ""}` }] : []),
      ]} />
      <DetalleClasificacionDialog fila={detalle ? fila : null} onClose={() => setDetalle(false)} />
    </Panel>
  );
}
