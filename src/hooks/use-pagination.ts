import { useState, useMemo, useEffect } from "react";

export interface Pagination<T> {
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
  from: number; // 1-based índice del primer elemento visible (0 si vacío)
  to: number; // índice del último elemento visible
  pageItems: T[];
  setPage: (p: number) => void;
  setPageSize: (n: number) => void;
}

/**
 * Paginación en cliente reutilizable para cualquier tabla.
 * Uso:
 *   const pg = usePagination(filasFiltradas, 25);
 *   pg.pageItems.map(...)        // renderizar solo la página actual
 *   <DataTablePagination pagination={pg} />
 */
export function usePagination<T>(items: T[], defaultPageSize = 25): Pagination<T> {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(defaultPageSize);

  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  // Si el nº de filas baja (p.ej. al filtrar), no dejar la página fuera de rango.
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const current = Math.min(page, pageCount);
  const start = (current - 1) * pageSize;

  const pageItems = useMemo(
    () => items.slice(start, start + pageSize),
    [items, start, pageSize],
  );

  const setPageSize = (n: number) => {
    setPageSizeState(n);
    setPage(1);
  };

  return {
    page: current,
    pageSize,
    pageCount,
    total,
    from: total === 0 ? 0 : start + 1,
    to: Math.min(start + pageSize, total),
    pageItems,
    setPage,
    setPageSize,
  };
}
