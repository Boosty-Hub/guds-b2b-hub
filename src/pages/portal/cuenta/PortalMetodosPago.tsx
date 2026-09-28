import { Link, useNavigate } from "react-router-dom";
import { ChevronLeft, Landmark, Loader2, Receipt } from "lucide-react";
import { PortalMobileLayout } from "@/components/portal/PortalMobileLayout";
import { CuentaPagoDatos } from "@/components/portal/CuentaPagoDatos";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { useCuentasPago, metodosDeCuenta, METODO_LABEL, type CuentaPago } from "@/hooks/useCuentasPago";

// Cuentas oficiales donde el cliente puede pagar (vista cuentas_pago: cuentas publicadas de la empresa activa, con los
// datos traídos de Odoo). Reemplaza la maqueta anterior, que mostraba un banco, una cuenta, un RIF y un pago móvil
// inventados.
const PortalMetodosPago = () => {
  const navigate = useNavigate();
  const { empresaActiva } = useEmpresa();
  const { cuentas, loading, error } = useCuentasPago();

  const grupos: { titulo: string; lista: CuentaPago[] }[] = [
    { titulo: "Bolívares (Bs.)", lista: cuentas.filter((c) => c.moneda === "BS") },
    { titulo: "Dólares (USD)", lista: cuentas.filter((c) => c.moneda === "USD") },
  ].filter((g) => g.lista.length > 0);

  return (
    <PortalMobileLayout showHeader={false} showNav={false}>
      {/* Header */}
      <div className="bg-primary text-primary-foreground px-4 py-3 sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-1" aria-label="Volver">
            <ChevronLeft className="h-6 w-6" />
          </button>
          <h1 className="text-lg font-semibold">Cuentas para pagar</h1>
        </div>
      </div>

      <div className="px-4 py-4 space-y-4">
        <div className="rounded-xl bg-muted p-4">
          <p className="text-sm">
            Estas son las cuentas oficiales de <strong>{empresaActiva?.nombre || "la empresa"}</strong>
            {empresaActiva?.rif ? ` (RIF ${empresaActiva.rif})` : ""}. Paga solo a estas cuentas.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Después de pagar, declara el pago indicando a qué cuenta pagaste, la referencia y el comprobante.
          </p>
          <Link to="/portal/pagos" className="mt-3 block">
            <Button variant="outline" className="w-full gap-2">
              <Receipt className="h-4 w-4" />
              Declarar un pago
            </Button>
          </Link>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : error ? (
          <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
            No pudimos cargar las cuentas. Intenta de nuevo en unos minutos.
          </p>
        ) : cuentas.length === 0 ? (
          <div className="text-center py-12">
            <div className="h-16 w-16 rounded-full bg-muted mx-auto flex items-center justify-center mb-4">
              <Landmark className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground">
              Todavía no hay cuentas publicadas para recibir pagos. Consulta con tu ejecutivo de cuenta.
            </p>
          </div>
        ) : (
          grupos.map((g) => (
            <section key={g.titulo} className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{g.titulo}</h2>
              {g.lista.map((c) => (
                <article key={c.id} className="bg-card rounded-xl border border-border p-4" data-testid="cuenta-pago">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 shrink-0 rounded-full bg-primary/10 flex items-center justify-center">
                        <Landmark className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <h3 className="font-semibold">{c.nombre}</h3>
                        <p className="text-xs text-muted-foreground">
                          {metodosDeCuenta(c).map((m) => METODO_LABEL[m]).join(" · ")}
                        </p>
                      </div>
                    </div>
                    <Badge variant="outline" className="shrink-0">{c.moneda === "USD" ? "USD" : "Bs."}</Badge>
                  </div>
                  <CuentaPagoDatos cuenta={c} className="mt-2" />
                </article>
              ))}
            </section>
          ))
        )}
      </div>
    </PortalMobileLayout>
  );
};

export default PortalMetodosPago;
