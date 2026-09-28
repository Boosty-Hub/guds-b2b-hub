import { Link } from "react-router-dom";
import { AlertCircle, Landmark, Plus } from "lucide-react";
import { PortalPagina } from "@/components/portal/PortalPagina";
import { CuentaPagoDatos } from "@/components/portal/CuentaPagoDatos";
import { NavFinanzas } from "@/components/portal/finanzas";
import { EstadoVacio, SkeletonFilas } from "@/components/portal/sistema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { useCuentasPago, metodosDeCuenta, METODO_LABEL, type CuentaPago } from "@/hooks/useCuentasPago";

// Cómo pagar: cuentas oficiales donde el cliente puede pagar (vista cuentas_pago: cuentas publicadas de la empresa activa,
// con los datos traídos de Odoo), agrupadas por moneda y con botón de copiar en cada dato.
const PortalMetodosPago = () => {
  const { empresaActiva } = useEmpresa();
  const { cuentas, loading, error } = useCuentasPago();

  const grupos: { titulo: string; lista: CuentaPago[] }[] = [
    { titulo: "Bolívares (Bs.)", lista: cuentas.filter((c) => c.moneda === "BS") },
    { titulo: "Dólares (USD)", lista: cuentas.filter((c) => c.moneda === "USD") },
  ].filter((g) => g.lista.length > 0);

  return (
    <PortalPagina
      titulo="Cómo pagar"
      descripcion="Cuentas oficiales para tus pagos. Después de pagar, declara el pago con la referencia y el comprobante."
      acciones={<Button asChild className="gap-2"><Link to="/portal/pagos?declarar=1"><Plus className="h-4 w-4" />Declarar un pago</Link></Button>}
    >
      <NavFinanzas />

      <div className="space-y-6 pb-2">
        <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm">
          <p>
            Estas son las cuentas oficiales de <strong>{empresaActiva?.nombre || "la empresa"}</strong>
            {empresaActiva?.rif ? ` (RIF ${empresaActiva.rif})` : ""}. Paga solo a estas cuentas.
          </p>
          <p className="mt-1.5 text-muted-foreground">
            Después de pagar, declara el pago indicando a qué cuenta pagaste, la referencia y el comprobante. Lo verificaremos y te avisaremos.
          </p>
          <Button asChild variant="outline" className="mt-3 w-full gap-2 lg:hidden">
            <Link to="/portal/pagos?declarar=1"><Plus className="h-4 w-4" />Declarar un pago</Link>
          </Button>
        </div>

        {loading ? (
          <SkeletonFilas n={3} alto="h-40" className="md:grid md:grid-cols-2 md:gap-4 md:space-y-0" />
        ) : error ? (
          <div className="rounded-xl border border-border bg-card">
            <EstadoVacio icono={AlertCircle} titulo="No pudimos cargar las cuentas" descripcion="Intenta de nuevo en unos minutos." />
          </div>
        ) : cuentas.length === 0 ? (
          <div className="rounded-xl border border-border bg-card">
            <EstadoVacio icono={Landmark} titulo="Todavía no hay cuentas publicadas"
              descripcion="Consulta con tu ejecutivo de cuenta dónde puedes pagar." />
          </div>
        ) : (
          grupos.map((g) => (
            <section key={g.titulo} className="space-y-3" aria-label={g.titulo}>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.titulo}</h2>
              <div className="grid gap-3 md:grid-cols-2 md:gap-4">
                {g.lista.map((c) => (
                  <article key={c.id} className="rounded-xl border border-border bg-card p-4" data-testid="cuenta-pago">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
                          <Landmark className="h-5 w-5 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="truncate font-semibold">{c.nombre}</h3>
                          <p className="text-xs text-muted-foreground">{metodosDeCuenta(c).map((m) => METODO_LABEL[m]).join(" · ")}</p>
                        </div>
                      </div>
                      <Badge variant="outline" className="shrink-0">{c.moneda === "USD" ? "USD" : "Bs."}</Badge>
                    </div>
                    <CuentaPagoDatos cuenta={c} className="mt-2" />
                  </article>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </PortalPagina>
  );
};

export default PortalMetodosPago;
