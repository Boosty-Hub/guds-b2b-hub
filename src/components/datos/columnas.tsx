import { useState } from "react";
import { Columns3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface ColumnaTabla { etiqueta: string; fija?: boolean; oculta?: boolean }

const clave = (tabla: string) => `guds.columnas.${tabla}`;

/**
 * Columnas visibles de una tabla, recordadas en el navegador. Oculta por CSS (nth-child), sin tocar el render de las celdas:
 * poner `data-tabla={tabla}` en <Table>, renderizar `estilo` y el `selector` en la barra. `columnas` va en el orden del
 * encabezado (incluidas las columnas sin título, p. ej. casillas o acciones, marcadas `fija`).
 */
export function useColumnas(tabla: string, columnas: ColumnaTabla[]) {
  const porDefecto = () => columnas.filter((c) => c.oculta && !c.fija).map((c) => c.etiqueta);
  const [ocultas, setOcultas] = useState<string[]>(() => {
    try {
      const g = localStorage.getItem(clave(tabla));
      if (g) return JSON.parse(g) as string[];
    } catch { /* sin almacenamiento */ }
    return porDefecto();
  });
  const guardar = (n: string[]) => { try { localStorage.setItem(clave(tabla), JSON.stringify(n)); } catch { /* sin almacenamiento */ } };
  const alternar = (e: string) => setOcultas((o) => { const n = o.includes(e) ? o.filter((x) => x !== e) : [...o, e]; guardar(n); return n; });
  const restablecer = () => { const n = porDefecto(); guardar(n); setOcultas(n); };

  const indices = columnas.map((c, i) => (!c.fija && ocultas.includes(c.etiqueta) ? i + 1 : 0)).filter(Boolean);
  const css = indices.map((n) => `table[data-tabla="${tabla}"]>*>tr>:nth-child(${n})`).join(",");
  const estilo = css ? <style>{`${css}{display:none}`}</style> : null;

  const visibles = columnas.length - indices.length;
  const selector = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="sm" variant={indices.length ? "secondary" : "outline"} className="h-8 w-8 px-0"
          title={indices.length ? `Columnas visibles (${indices.length} ocultas)` : "Columnas visibles"} aria-label="Columnas visibles">
          <Columns3 className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs">Columnas visibles ({visibles}/{columnas.length})</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {columnas.filter((c) => !c.fija && c.etiqueta).map((c) => (
          <DropdownMenuCheckboxItem key={c.etiqueta} className="text-[13px]" checked={!ocultas.includes(c.etiqueta)}
            onCheckedChange={() => alternar(c.etiqueta)} onSelect={(e) => e.preventDefault()}>
            {c.etiqueta}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-xs text-muted-foreground" onSelect={restablecer}>Restablecer</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  return { ocultas, estilo, selector };
}
