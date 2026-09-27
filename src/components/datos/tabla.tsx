import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Download } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Valor = string | number | boolean | null | undefined | Date;
export type Orden = { clave: string; dir: "asc" | "desc" } | null;

/** Ordena filas en cliente por la columna elegida. `valores` devuelve el valor ordenable de cada columna. */
export function useOrdenTabla<T>(filas: T[], valores: Record<string, (fila: T) => Valor>, inicial: Orden = null) {
  const [orden, setOrden] = useState<Orden>(inicial);
  const ordenadas = useMemo(() => {
    if (!orden || !valores[orden.clave]) return filas;
    const f = valores[orden.clave];
    const signo = orden.dir === "asc" ? 1 : -1;
    return [...filas].sort((a, b) => {
      const va = f(a), vb = f(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const x = va instanceof Date ? va.getTime() : va, y = vb instanceof Date ? vb.getTime() : vb;
      if (typeof x === "number" && typeof y === "number") return (x - y) * signo;
      return String(x).localeCompare(String(y), "es", { numeric: true, sensitivity: "base" }) * signo;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filas, orden]);
  const alternar = (clave: string) => setOrden((o) => (o?.clave !== clave ? { clave, dir: "asc" } : o.dir === "asc" ? { clave, dir: "desc" } : null));
  return { ordenadas, orden, alternar };
}

/** Encabezado de columna que ordena al pulsarlo. */
export function EncabezadoOrdenable({ clave, orden, onOrdenar, children, className, alinear = "izquierda" }: {
  clave: string; orden: Orden; onOrdenar: (clave: string) => void; children: ReactNode; className?: string; alinear?: "izquierda" | "derecha" | "centro";
}) {
  const activo = orden?.clave === clave;
  const Icono = !activo ? ChevronsUpDown : orden!.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead className={cn(alinear === "derecha" && "text-right", alinear === "centro" && "text-center", className)}>
      <button type="button" onClick={() => onOrdenar(clave)}
        className={cn("inline-flex items-center gap-1 hover:text-foreground", activo && "text-foreground", alinear === "derecha" && "flex-row-reverse")}>
        {children}<Icono className={cn("h-3 w-3", !activo && "opacity-40")} />
      </button>
    </TableHead>
  );
}

/** Descarga un CSV (separador ; y BOM para que Excel en español lo abra bien). */
export function exportarCSV<T>(nombre: string, filas: T[], columnas: { titulo: string; valor: (fila: T) => Valor }[]) {
  const celda = (v: Valor) => {
    if (v == null) return "";
    const s = v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "number" ? String(v).replace(".", ",") : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lineas = [columnas.map((c) => celda(c.titulo)).join(";"), ...filas.map((f) => columnas.map((c) => celda(c.valor(f))).join(";"))];
  const blob = new Blob(["﻿" + lineas.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${nombre}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Botón "Exportar" para la barra de la lista. */
export function BotonExportar({ onClick, total, soloIcono }: { onClick: () => void; total?: number; soloIcono?: boolean }) {
  return (
    <Button type="button" size="sm" variant="outline" className={cn("h-8 gap-1.5", soloIcono && "w-8 px-0")} onClick={onClick} disabled={total === 0}
      title="Descargar lo filtrado en CSV (Excel)" aria-label="Exportar a CSV">
      <Download className="h-3.5 w-3.5" />{!soloIcono && " Exportar"}
    </Button>
  );
}
