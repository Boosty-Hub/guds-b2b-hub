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
  pageSizeOptions = [10, 25, 50, 100],
  className,
}: DataTablePaginationProps) {
  const { page, pageSize, pageCount, total, from, to, setPage, setPageSize } = pagination;

  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-t border-border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <p className="text-muted-foreground">
        {total === 0 ? "Sin resultados" : <>Mostrando <span className="font-medium text-foreground">{from}–{to}</span> de <span className="font-medium text-foreground">{total}</span></>}
      </p>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="whitespace-nowrap text-muted-foreground">Filas por página</span>
          <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
            <SelectTrigger className="h-8 w-[72px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizeOptions.map((n) => (
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
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => setPage(1)} aria-label="Primera página">
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Página anterior">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= pageCount} onClick={() => setPage(page + 1)} aria-label="Página siguiente">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= pageCount} onClick={() => setPage(pageCount)} aria-label="Última página">
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
