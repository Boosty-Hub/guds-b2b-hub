import type { ReactNode } from "react";
import { Check, DollarSign, Monitor, Moon, Palette, Sun, type LucideIcon } from "lucide-react";
import { PortalPagina } from "@/components/portal/PortalPagina";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useTemaPortal, type TemaPortal } from "@/hooks/useTemaPortal";
import { cn } from "@/lib/utils";

// Preferencias del portal (F6), todas reales y guardadas en este navegador para el usuario: el tema (claro, oscuro o el
// del sistema, con la clase `dark`) y la moneda en que se muestran los montos (el shell la recuerda por usuario).

const TEMAS: { id: TemaPortal; nombre: string; detalle: string; icono: LucideIcon }[] = [
  { id: "claro", nombre: "Claro", detalle: "Fondo claro", icono: Sun },
  { id: "oscuro", nombre: "Oscuro", detalle: "Fondo oscuro, cómodo de noche", icono: Moon },
  { id: "sistema", nombre: "Según el dispositivo", detalle: "Sigue el ajuste de tu teléfono o computadora", icono: Monitor },
];

const MONEDAS: { id: "USD" | "BS"; nombre: string; simbolo: string }[] = [
  { id: "USD", nombre: "Dólares (USD)", simbolo: "$" },
  { id: "BS", nombre: "Bolívares (Bs.) a la tasa BCV del día", simbolo: "Bs." },
];

const Opcion = ({ activa, onClick, children, testId }: { activa: boolean; onClick: () => void; children: ReactNode; testId?: string }) => (
  <button
    type="button"
    role="radio"
    aria-checked={activa}
    onClick={onClick}
    data-testid={testId}
    className={cn(
      "flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left transition-colors",
      activa ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
    )}
  >
    {children}
    <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full", activa ? "bg-primary text-primary-foreground" : "border border-border")} aria-hidden>
      {activa && <Check className="h-4 w-4" />}
    </span>
  </button>
);

const PortalPreferencias = () => {
  const { currency, setCurrency } = useCurrency();
  const [tema, setTema] = useTemaPortal();

  return (
    <PortalPagina titulo="Preferencias" volver="/portal/cuenta" etiquetaVolver="Mi cuenta" ancho="estrecho"
      descripcion="Se guardan en este navegador para tu usuario.">
      <div className="space-y-4 pb-2">
        <section className="rounded-xl border border-border bg-card p-4" aria-labelledby="pref-tema">
          <h2 id="pref-tema" className="mb-3 flex items-center gap-2 font-semibold"><Palette className="h-4 w-4" />Apariencia</h2>
          <div className="space-y-2" role="radiogroup" aria-labelledby="pref-tema">
            {TEMAS.map((t) => (
              <Opcion key={t.id} activa={tema === t.id} onClick={() => setTema(t.id)} testId={`tema-${t.id}`}>
                <span className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted"><t.icono className="h-4 w-4" /></span>
                  <span className="min-w-0">
                    <span className="block font-medium">{t.nombre}</span>
                    <span className="block text-xs text-muted-foreground">{t.detalle}</span>
                  </span>
                </span>
              </Opcion>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-4" aria-labelledby="pref-moneda">
          <h2 id="pref-moneda" className="mb-3 flex items-center gap-2 font-semibold"><DollarSign className="h-4 w-4" />Moneda de los montos</h2>
          <div className="space-y-2" role="radiogroup" aria-labelledby="pref-moneda">
            {MONEDAS.map((m) => (
              <Opcion key={m.id} activa={currency === m.id} onClick={() => setCurrency(m.id)} testId={`moneda-pref-${m.id.toLowerCase()}`}>
                <span className="flex min-w-0 items-center gap-3">
                  <span className="w-9 text-center text-base font-bold text-muted-foreground">{m.simbolo}</span>
                  <span className="font-medium">{m.nombre}</span>
                </span>
              </Opcion>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Los documentos (facturas, estado de cuenta en CSV o impreso) conservan su moneda original.</p>
        </section>

        <p className="px-1 text-xs text-muted-foreground">El portal está disponible en español.</p>
      </div>
    </PortalPagina>
  );
};

export default PortalPreferencias;
