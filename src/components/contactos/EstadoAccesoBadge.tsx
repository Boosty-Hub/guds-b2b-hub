import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ETIQUETA_ACCESO, type EstadoAcceso } from "./tipos";

const CLASE: Record<EstadoAcceso, string> = {
  sin: "font-normal text-muted-foreground",
  activo: "border-success/40 bg-success/10 font-normal text-success",
  temporal: "border-warning/60 bg-warning/15 font-normal",
  desactivado: "border-destructive/40 bg-destructive/10 font-normal text-destructive",
};

/** Estado del acceso al portal de un contacto */
export function EstadoAccesoBadge({ estado, className }: { estado: EstadoAcceso; className?: string }) {
  return <Badge variant="outline" className={cn("whitespace-nowrap text-[11px]", CLASE[estado], className)}>{ETIQUETA_ACCESO[estado]}</Badge>;
}
