import { CheckCircle2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtBs, fmtUsd } from "./comun";

/** Total del plan contra el saldo disponible en bancos (saldos de Odoo), por moneda de pago. */
export function CoberturaMonedas({ planUsd, planBsUsd, tasa, dispUsd, dispBs, compacto }: {
  /** Lo que se paga en dólares (USD). */
  planUsd: number;
  /** Lo que se paga en bolívares, expresado en USD (se convierte a la tasa). */
  planBsUsd: number;
  tasa: number;
  dispUsd: number;
  /** Saldo en bolívares de los bancos en Bs. */
  dispBs: number;
  compacto?: boolean;
}) {
  const filas = [
    { moneda: "USD", plan: planUsd, disp: dispUsd, fmt: fmtUsd, eq: null as string | null },
    { moneda: "Bs.", plan: planBsUsd * tasa, disp: dispBs, fmt: fmtBs, eq: planBsUsd > 0 ? fmtUsd(planBsUsd) : null },
  ].filter((f) => !compacto || f.plan > 0.009);
  return (
    <div className="overflow-x-auto rounded-md border border-border" data-cobertura="">
      <table className="w-full text-xs tabular-nums sm:text-[13px]">
        <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-2 py-1 text-left font-medium">Moneda</th>
            <th className="px-2 py-1 text-right font-medium">Plan</th>
            <th className="px-2 py-1 text-right font-medium">En bancos</th>
            <th className="px-2 py-1 text-right font-medium">Queda</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => {
            const queda = f.disp - f.plan;
            const ok = queda >= -0.009;
            return (
              <tr key={f.moneda} className="border-t border-border" data-moneda={f.moneda}>
                <td className="px-2 py-1 font-medium">{f.moneda}</td>
                <td className="whitespace-nowrap px-2 py-1 text-right" title={f.eq ? `${f.eq} a la tasa ${tasa.toLocaleString("es-VE")}` : undefined}>{f.fmt(f.plan)}</td>
                <td className="whitespace-nowrap px-2 py-1 text-right text-muted-foreground">{f.fmt(f.disp)}</td>
                <td className={cn("whitespace-nowrap px-2 py-1 text-right font-medium", ok ? "text-success" : "text-destructive")}>
                  <span className="inline-flex items-center gap-1">
                    {ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}{f.fmt(queda)}
                  </span>
                </td>
              </tr>
            );
          })}
          {filas.length === 0 && <tr className="border-t border-border"><td colSpan={4} className="px-2 py-1.5 text-muted-foreground">Sin montos</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
