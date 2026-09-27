import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface OdooBadgeProps {
  // Fecha de la última sincronización con Odoo (opcional)
  sincronizado?: string | null;
  // Texto del tooltip; por defecto explica que el dato se edita en Odoo
  titulo?: string;
  className?: string;
}

// Marca de "dato conectado con Odoo". Convención de la plataforma (docs/PLAN-ESPEJO-ODOO.md):
// todo campo o registro que viene de Odoo la lleva, y se edita en Odoo, no en GUDS.
export function OdooBadge({ sincronizado, titulo, className }: OdooBadgeProps) {
  const fecha = sincronizado
    ? new Date(sincronizado).toLocaleString("es-VE", { dateStyle: "short", timeStyle: "short" })
    : null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex h-4 shrink-0 cursor-default select-none items-center rounded px-1 align-middle text-[10px] font-semibold leading-none tracking-wide",
            "bg-[#714B67]/10 text-[#714B67] ring-1 ring-inset ring-[#714B67]/25 dark:bg-[#b48ead]/15 dark:text-[#d7b6cf] dark:ring-[#b48ead]/30",
            className,
          )}
          aria-label="Conectado con Odoo"
        >
          Odoo
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">
        <p>{titulo ?? "Viene de Odoo · se edita en Odoo"}</p>
        {fecha && <p className="text-muted-foreground">Última actualización: {fecha}</p>}
      </TooltipContent>
    </Tooltip>
  );
}
