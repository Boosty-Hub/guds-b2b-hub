import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { OdooBadge } from "@/components/OdooBadge";

export interface CampoFicha { label: string; valor?: ReactNode; odoo?: boolean; ancho?: 1 | 2 | 3; mono?: boolean }

/** Rejilla densa de campos etiqueta/valor (fichas de detalle estilo sistema de gestión). */
export function FichaCampos({ campos, columnas = 6, className }: { campos: CampoFicha[]; columnas?: 3 | 4 | 6; className?: string }) {
  const cols = columnas === 6 ? "grid-cols-2 md:grid-cols-4 xl:grid-cols-6" : columnas === 4 ? "grid-cols-2 md:grid-cols-4" : "grid-cols-2 md:grid-cols-3";
  return (
    <div className={cn("grid gap-x-4 gap-y-2", cols, className)}>
      {campos.map((c) => {
        const vacio = c.valor === null || c.valor === undefined || c.valor === "" || c.valor === false;
        return (
          <div key={c.label} className={cn("min-w-0", c.ancho === 2 && "col-span-2", c.ancho === 3 && "col-span-2 md:col-span-3")}>
            <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">{c.label}{c.odoo && <OdooBadge />}</p>
            <div className={cn("break-words text-[13px] font-medium leading-snug", c.mono && "font-mono text-xs")}>
              {vacio ? <span className="font-normal text-muted-foreground">—</span> : c.valor}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Panel compacto con barra de título (reemplaza tarjetas grandes con mucho aire). */
export function Panel({ titulo, acciones, children, className, sinPadding }: {
  titulo?: ReactNode; acciones?: ReactNode; children: ReactNode; className?: string; sinPadding?: boolean;
}) {
  return (
    <section className={cn("mb-3 overflow-hidden rounded-lg border border-border bg-card", className)}>
      {(titulo || acciones) && (
        <header className="flex min-h-9 items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold">{titulo}</h2>
          {acciones && <div className="flex items-center gap-1.5">{acciones}</div>}
        </header>
      )}
      <div className={sinPadding ? "" : "p-3"}>{children}</div>
    </section>
  );
}
