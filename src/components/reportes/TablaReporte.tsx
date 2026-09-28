import { useState, type ReactNode } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/datos/FichaCampos";
import { useOrdenTabla, EncabezadoOrdenable, exportarCSV, BotonExportar } from "@/components/datos/tabla";
import { cn } from "@/lib/utils";

export interface ColumnaReporte<T> {
  clave: string;
  titulo: string;
  valor: (f: T) => number | string | null | undefined;
  render?: (f: T) => ReactNode;
  derecha?: boolean;
  ocultarMovil?: boolean;
  /** Columna secundaria: solo en pantallas muy anchas (en la rejilla de 2 columnas no cabe) */
  secundaria?: boolean;
  /** Solo en el CSV (p. ej. la fuente, que en pantalla va como insignia) */
  soloExportar?: boolean;
}

/** Tabla de un reporte agrupado: ordenable, exportable, con participación (%) sobre `metrica` y "ver todos". */
export function TablaReporte<T>({ titulo, filas, columnas, metrica, exportar, limite = 10, vacio = "Sin datos en el período", acciones, className }: {
  titulo: ReactNode;
  filas: T[];
  columnas: ColumnaReporte<T>[];
  metrica?: (f: T) => number;
  exportar: string;
  limite?: number;
  vacio?: string;
  acciones?: ReactNode;
  className?: string;
}) {
  const [todos, setTodos] = useState(false);
  const valores = Object.fromEntries(columnas.map((c) => [c.clave, (f: T) => c.valor(f) ?? null]));
  const { ordenadas, orden, alternar } = useOrdenTabla(filas, valores);
  const visibles = todos ? ordenadas : ordenadas.slice(0, limite);
  const total = metrica ? filas.reduce((s, f) => s + (metrica(f) || 0), 0) : 0;
  const descargar = () => exportarCSV(exportar, ordenadas, [
    ...columnas.map((c) => ({ titulo: c.titulo, valor: (f: T) => c.valor(f) })),
    ...(metrica ? [{ titulo: "% del total", valor: (f: T) => (total ? Number(((metrica(f) / total) * 100).toFixed(2)) : 0) }] : []),
  ]);
  const enPantalla = columnas.filter((c) => !c.soloExportar);

  return (
    <Panel sinPadding className={className} titulo={titulo}
      acciones={<div className="flex items-center gap-1.5">{acciones}<BotonExportar soloIcono onClick={descargar} total={filas.length} /></div>}>
      {filas.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-muted-foreground">{vacio}</p>
      ) : (
        <>
          <Table containerClassName="max-h-none">
            <TableHeader>
              <TableRow>
                {enPantalla.map((c) => (
                  <EncabezadoOrdenable key={c.clave} clave={c.clave} orden={orden} onOrdenar={alternar} alinear={c.derecha ? "derecha" : "izquierda"}
                    className={cn(c.ocultarMovil && "hidden md:table-cell", c.secundaria && "hidden 2xl:table-cell")}>{c.titulo}</EncabezadoOrdenable>
                ))}
                {metrica && <TableHead className="w-24 text-right" title="Participación sobre el total">%</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibles.map((f, i) => {
                const pct = metrica && total ? (metrica(f) / total) * 100 : 0;
                return (
                  <TableRow key={i}>
                    {enPantalla.map((c, j) => (
                      <TableCell key={c.clave} className={cn("whitespace-nowrap", c.derecha && "text-right", j === 0 && "max-w-[240px] truncate font-medium", c.ocultarMovil && "hidden md:table-cell", c.secundaria && "hidden 2xl:table-cell")}
                        title={j === 0 ? String(c.valor(f) ?? "") : undefined}>
                        {c.render ? c.render(f) : c.valor(f) ?? "—"}
                      </TableCell>
                    ))}
                    {metrica && (
                      <TableCell className="text-right">
                        <span className="inline-flex w-full items-center justify-end gap-1.5">
                          <span className="h-1.5 w-10 overflow-hidden rounded-full bg-muted">
                            <span className={cn("block h-full rounded-full", pct < 0 ? "bg-destructive" : "bg-primary")} style={{ width: `${Math.min(100, Math.abs(pct))}%` }} />
                          </span>
                          <span className="w-11 text-xs tabular-nums text-muted-foreground">{pct.toFixed(1)}%</span>
                        </span>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {filas.length > limite && (
            <div className="border-t border-border px-3 py-1">
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setTodos((t) => !t)}>
                {todos ? "Ver menos" : `Ver todos (${filas.length})`}
              </Button>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
