import { Link } from "react-router-dom";
import { AlertCircle, Plus, RefreshCw } from "lucide-react";
import { PortalPagina } from "@/components/portal/PortalPagina";
import { EstadoVacio, SkeletonFilas } from "@/components/portal/sistema";
import { NavFinanzas } from "@/components/portal/finanzas";
import { BotonPdfEstadoCuenta } from "@/components/estado-cuenta/BotonPdfEstadoCuenta";
import { EstadoCuenta } from "@/components/estado-cuenta/EstadoCuenta";
import { libroEstadoCuenta } from "@/components/estado-cuenta/excelEstadoCuenta";
import type { EstadoCuentaCompleto } from "@/components/estado-cuenta/tipos";
import { BotonExcel } from "@/components/datos/BotonExcel";
import { Button } from "@/components/ui/button";
import { useEstadoCuenta, type PeriodoEstadoCuenta } from "@/hooks/useFinanzasPortal";

// Estado de cuenta del cliente en su portal (F5).
// 22c: el mismo estado de cuenta que el admin, el enlace público y el vendedor (componente EstadoCuenta, formato de
// finanzas: documentos con saldo con Nº de control, tasa de emisión y estatus; cada uno se despliega con sus abonos),
// siempre al corte de hoy, con PDF y Excel. Ya no lleva el libro de movimientos ni el CSV.

const HOY: PeriodoEstadoCuenta = { desde: null, hasta: null };

const PortalEstadoCuenta = () => {
  const { datos, cargando, error, recargar } = useEstadoCuenta(HOY, false);
  const ec = datos as EstadoCuentaCompleto | null;

  const excel = <BotonExcel libro={() => (ec ? libroEstadoCuenta(ec) : null)} disabled={!ec} className="gap-2" data-testid="ec-excel" />;
  const acciones = (
    <>
      <BotonPdfEstadoCuenta datos={ec} etiqueta="PDF" />
      {excel}
      <Button asChild className="gap-2"><Link to="/portal/pagos?declarar=1"><Plus className="h-4 w-4" />Declarar pago</Link></Button>
    </>
  );

  return (
    <PortalPagina
      titulo="Estado de cuenta"
      descripcion={ec?.empresa ? `Tu cuenta con ${ec.empresa.nombre_corto ?? ec.empresa.nombre}: documentos con saldo, abonos y antigüedad.` : "Documentos con saldo, abonos y antigüedad de tu cuenta."}
      acciones={acciones}
    >
      <NavFinanzas />

      {/* Acciones en móvil y tableta */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:hidden">
        <Button asChild className="col-span-2 h-11 gap-2 sm:col-span-1"><Link to="/portal/pagos?declarar=1"><Plus className="h-4 w-4" />Declarar pago</Link></Button>
        <BotonPdfEstadoCuenta datos={ec} etiqueta="PDF" className="h-11" data-testid="ec-pdf-movil" />
        <BotonExcel libro={() => (ec ? libroEstadoCuenta(ec) : null)} disabled={!ec} className="h-11 gap-2" data-testid="ec-excel-movil" />
      </div>

      {error && !ec ? (
        <div className="rounded-xl border border-border bg-card">
          <EstadoVacio icono={AlertCircle} titulo="No pudimos cargar tu estado de cuenta" descripcion="Revisa tu conexión e intenta de nuevo."
            accion={<Button variant="outline" className="gap-2" onClick={recargar}><RefreshCw className="h-4 w-4" />Reintentar</Button>} />
        </div>
      ) : !ec ? (
        <div className="rounded-xl border border-border bg-card p-4"><SkeletonFilas n={6} alto="h-10" /></div>
      ) : (
        <EstadoCuenta datos={ec} modo="portal" cargando={cargando}
          enlaceDocumento={(d) => (d.factura_id ? `/portal/facturas/${d.factura_id}` : null)} testId="ec-portal" />
      )}
    </PortalPagina>
  );
};

export default PortalEstadoCuenta;
