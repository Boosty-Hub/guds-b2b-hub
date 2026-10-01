import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Pagination } from "@/hooks/use-pagination";
import { cn } from "@/lib/utils";

interface DataTablePaginationProps {
  pagination: Pagination<unknown>;
  pageSizeOptions?: number[];
  className?: string;
}

/**
 * Controles de paginación reutilizables: rango visible, selector de filas por
 * página y navegación. Se usa junto al hook usePagination.
 */
export function DataTablePagination({
  pagination,
  pageSizeOptions = [25, 50, 100, 200],
  className,
}: DataTablePaginationProps) {
  const { page, pageSize, pageCount, total, from, to, setPage, setPageSize } = pagination;
  // Si la tabla arranca con un tamaño que no está en la lista (p. ej. 10), se agrega: si no, el selector queda vacío
  const opciones = pageSizeOptions.includes(pageSize) ? pageSizeOptions : [...pageSizeOptions, pageSize].sort((a, b) => a - b);

  return (
    <div
      className={cn(
        "flex flex-col gap-2 border-t border-border px-3 py-1.5 text-xs sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <p className="text-muted-foreground">
        {total === 0 ? "Sin resultados" : <>Mostrando <span className="font-medium text-foreground">{from}–{to}</span> de <span className="font-medium text-foreground">{total}</span></>}
      </p>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="whitespace-nowrap text-muted-foreground">Filas por página</span>
          <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
            <SelectTrigger className="h-7 w-[72px] text-xs" aria-label="Filas por página">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {opciones.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1">
          <span className="mr-1 whitespace-nowrap text-muted-foreground">
            Pág. {page} de {pageCount}
          </span>
          <Button variant="outline" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage(1)} aria-label="Primera página">
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Página anterior">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= pageCount} onClick={() => setPage(page + 1)} aria-label="Página siguiente">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= pageCount} onClick={() => setPage(pageCount)} aria-label="Última página">
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
