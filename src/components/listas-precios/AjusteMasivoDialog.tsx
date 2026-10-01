import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { leerPrecio, redondear, type ProductoLista } from "./comun";

type Modo = "base_pct" | "lista_pct" | "fijo" | "quitar";

const MODOS: { valor: Modo; etiqueta: string; ayuda: string }[] = [
  { valor: "base_pct", etiqueta: "% sobre el precio base", ayuda: "Ej.: -10 = 10 % menos que el precio base; 15 = 15 % más." },
  { valor: "lista_pct", etiqueta: "% sobre el precio actual de la lista", ayuda: "Solo los productos que ya tienen precio en la lista." },
  { valor: "fijo", etiqueta: "Mismo precio a todos", ayuda: "Pone el mismo precio por unidad a cada fila." },
  { valor: "quitar", etiqueta: "Quitar el precio de la lista", ayuda: "Vuelven a usar el precio base." },
];

/** Calcula precios nuevos para las filas visibles. No guarda: deja los cambios pendientes en la tabla. */
export function AjusteMasivoDialog({ abierto, onOpenChange, filas, precioActual, onAplicar }: {
  abierto: boolean;
  onOpenChange: (v: boolean) => void;
  filas: ProductoLista[];
  /** Precio vigente en pantalla (guardado o editado); null = usa el base. */
  precioActual: (p: ProductoLista) => number | null;
  onAplicar: (cambios: Record<string, number | null>) => void;
}) {
  const [modo, setModo] = useState<Modo>("base_pct");
  const [valor, setValor] = useState("");
  const n = leerPrecio(valor.replace(/^-/, ""));
  const signo = valor.trim().startsWith("-") ? -1 : 1;
  const num = n == null || Number.isNaN(n) ? null : signo * n;
  const necesitaValor = modo !== "quitar";
  const invalido = necesitaValor && (num == null || (modo === "fijo" && num < 0) || (modo !== "fijo" && num <= -100));

  const calcular = (): Record<string, number | null> => {
    const out: Record<string, number | null> = {};
    for (const p of filas) {
      const actual = precioActual(p);
      if (modo === "quitar") { if (actual != null) out[p.id] = null; continue; }
      if (num == null) continue;
      if (modo === "fijo") out[p.id] = redondear(num);
      else if (modo === "base_pct") { if (p.precio_base > 0) out[p.id] = redondear(p.precio_base * (1 + num / 100)); }
      else if (actual != null) out[p.id] = redondear(actual * (1 + num / 100));
    }
    return out;
  };
  const afectados = invalido ? 0 : Object.keys(calcular()).length;

  return (
    <Dialog open={abierto} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ajuste masivo</DialogTitle>
          <DialogDescription>Se aplica a las {filas.length} filas que se ven con la búsqueda y los filtros actuales. Queda pendiente hasta que guardes.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {MODOS.map((m) => (
            <button key={m.valor} type="button" onClick={() => setModo(m.valor)} aria-pressed={modo === m.valor}
              className={cn("w-full rounded-md border px-3 py-2 text-left text-sm", modo === m.valor ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50")}>
              <span className="font-medium">{m.etiqueta}</span>
              <span className="block text-xs text-muted-foreground">{m.ayuda}</span>
            </button>
          ))}
          {necesitaValor && (
            <div className="space-y-1 pt-1">
              <Label htmlFor="ajuste-valor">{modo === "fijo" ? "Precio por unidad (USD)" : "Porcentaje"}</Label>
              <Input id="ajuste-valor" inputMode="decimal" autoFocus value={valor} onChange={(e) => setValor(e.target.value)}
                placeholder={modo === "fijo" ? "0.00" : "-10"} className={cn("h-9", valor && invalido && "border-destructive")} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={invalido || afectados === 0} onClick={() => { onAplicar(calcular()); onOpenChange(false); setValor(""); }}>
            Aplicar a {afectados} producto{afectados === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
