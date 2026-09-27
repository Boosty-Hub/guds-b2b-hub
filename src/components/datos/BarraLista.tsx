import type { ReactNode } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Barra de herramientas de una lista en una sola fila: pestañas, búsqueda, filtros, contador y acciones.
 *  `pestanas` recibe un <TabsList> (la barra debe estar dentro de <Tabs>). */
export function BarraLista({
  pestanas, busqueda, onBusqueda, placeholder = "Buscar…", filtros, acciones, contador, className,
}: {
  pestanas?: ReactNode;
  busqueda?: string;
  onBusqueda?: (v: string) => void;
  placeholder?: string;
  filtros?: ReactNode;
  acciones?: ReactNode;
  contador?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-2 flex flex-wrap items-center gap-2", className)}>
      {pestanas}
      {onBusqueda && (
        <div className={cn("relative w-full", pestanas ? "sm:w-52" : "sm:w-72")}>
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={busqueda ?? ""} onChange={(e) => onBusqueda(e.target.value)} placeholder={placeholder} className="h-8 pl-8 pr-7 text-[13px]" />
          {busqueda && (
            <button type="button" onClick={() => onBusqueda("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Limpiar búsqueda">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
      {filtros}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {contador && <span className="text-xs text-muted-foreground">{contador}</span>}
        {acciones}
      </div>
    </div>
  );
}
