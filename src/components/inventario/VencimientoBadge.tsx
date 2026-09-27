import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Días que faltan para la fecha de vencimiento (negativo = vencido); null si no tiene fecha
export function diasParaVencer(vencimiento: string | null | undefined): number | null {
  if (!vencimiento) return null;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  return Math.round((new Date(`${vencimiento}T00:00:00`).getTime() - hoy.getTime()) / 86400000);
}

export type EstadoVencimiento = "vencido" | "30" | "90" | "vigente" | "sin_fecha";

export function estadoVencimiento(vencimiento: string | null | undefined): EstadoVencimiento {
  const d = diasParaVencer(vencimiento);
  if (d === null) return "sin_fecha";
  if (d < 0) return "vencido";
  if (d <= 30) return "30";
  if (d <= 90) return "90";
  return "vigente";
}

export const fmtFechaCorta = (d?: string | null) =>
  d ? new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString("es-VE") : "—";

/** Fecha de vencimiento con su estado: vencido, vence en ≤30 / ≤90 días o vigente. */
export function VencimientoBadge({ vencimiento, className, conFecha = false }: { vencimiento: string | null | undefined; className?: string; conFecha?: boolean }) {
  const d = diasParaVencer(vencimiento);
  const e = estadoVencimiento(vencimiento);
  const texto =
    e === "sin_fecha" ? "Sin vencimiento" :
    e === "vencido" ? `Vencido hace ${Math.abs(d!)} d` :
    d === 0 ? "Vence hoy" :
    e === "vigente" ? "Vigente" : `Vence en ${d} d`;
  const estilo =
    e === "vencido" ? "border-destructive/40 bg-destructive/10 text-destructive" :
    e === "30" ? "border-warning/60 bg-warning/20 text-foreground" :
    e === "90" ? "border-warning/30 bg-warning/5 text-foreground" :
    e === "vigente" ? "border-success/30 bg-success/10 text-success" : "text-muted-foreground";
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", className)}>
      {conFecha && vencimiento && <span className="text-sm">{fmtFechaCorta(vencimiento)}</span>}
      <Badge variant="outline" className={cn("whitespace-nowrap font-normal", estilo)}>{texto}</Badge>
    </span>
  );
}
