import { useEffect, useState } from "react";
import { Minus, Plus, Trash2, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/contexts/CurrencyContext";
import { EtiquetaIva } from "@/components/portal/EtiquetaIva";
import { opcionesDe, fechaCorta, type OpcionVenta, type ProductoVendedor } from "./tipos";
import { flechasGrupoRadio } from "@/components/portal/accesibilidad";

// Tarjeta de producto de la venta rápida: precio del cliente (servidor), IVA, disponible, empaques y un selector de cantidad
// con número editable (no solo +/−: pedir 48 unidades no son 47 toques).

/** Selector de cantidad: − [número] +. El número se escribe directo; se ajusta al tope al salir del campo. */
export function SelectorCantidad({ valor, max, onCambiar, etiqueta, className }: {
  valor: number; max: number; onCambiar: (n: number) => void; etiqueta: string; className?: string;
}) {
  const [texto, setTexto] = useState(String(valor));
  useEffect(() => { setTexto(String(valor)); }, [valor]);
  const confirmar = (t: string) => {
    const n = Math.floor(Number(t.replace(/\D/g, "")) || 0);
    onCambiar(Math.max(0, Math.min(n, max)));
  };
  return (
    <div className={cn("flex items-center rounded-md border border-input bg-background", className)} data-testid="selector-cantidad">
      <button type="button" className="flex h-9 w-9 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
        onClick={() => onCambiar(Math.max(0, valor - 1))} aria-label={`Quitar una unidad de ${etiqueta}`}>
        {valor <= 1 ? <Trash2 className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
      </button>
      <input
        type="text" inputMode="numeric" pattern="[0-9]*" value={texto} aria-label={`Cantidad de ${etiqueta}`}
        className="h-9 w-11 min-w-0 border-x border-input bg-transparent text-center text-sm font-semibold tabular-nums outline-none focus:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onChange={(e) => setTexto(e.target.value.replace(/\D/g, "").slice(0, 6))}
        onBlur={(e) => confirmar(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        onFocus={(e) => e.target.select()}
        data-testid="cantidad-input"
      />
      <button type="button" className="flex h-9 w-9 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
        onClick={() => onCambiar(Math.min(max, valor + 1))} disabled={valor >= max} aria-label={`Agregar una unidad de ${etiqueta}`}>
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function TarjetaProductoVenta({ p, cantidadDe, maxDe, onCantidad, sugerida }: {
  p: ProductoVendedor;
  /** Cantidad en el pedido de la opción (empaque o unidad). */
  cantidadDe: (o: OpcionVenta) => number;
  /** Tope de la opción según el disponible (descontando lo ya pedido en otras presentaciones). */
  maxDe: (o: OpcionVenta) => number;
  onCantidad: (o: OpcionVenta, n: number) => void;
  /** "Lo que compra": cantidad sugerida (la última que pidió, en la presentación por defecto). */
  sugerida?: number | null;
}) {
  const { formatPrice } = useCurrency();
  const opciones = opcionesDe(p);
  const [sel, setSel] = useState(() => {
    const conCantidad = opciones.find((o) => cantidadDe(o) > 0);
    const deLaUltima = p.frecuencia?.ultima_tipo_empaque_id ? opciones.find((o) => o.tipo_empaque_id === p.frecuencia?.ultima_tipo_empaque_id) : null;
    return (conCantidad ?? deLaUltima ?? opciones[0]).tipo_empaque_id;
  });
  const opcion = opciones.find((o) => o.tipo_empaque_id === sel) ?? opciones[0];
  const cant = cantidadDe(opcion);
  const max = maxDe(opcion);
  const agotado = p.controla_stock && Number(p.stock_disponible) <= 0;
  const disp = Math.floor(Number(p.stock_disponible) || 0);
  const f = p.frecuencia;

  return (
    <li className={cn("flex gap-3 px-3 py-2.5", agotado && "bg-muted/30")} data-testid="producto-venta" data-producto={p.id}>
      <div className={cn("min-w-0 flex-1", agotado && "opacity-60")}>
        <p className="line-clamp-2 text-[13px] font-medium leading-snug" title={p.nombre}>{p.nombre}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
          {p.sku && <span className="font-mono">{p.sku}</span>}
          {p.categoria && <span>· {p.categoria.etiqueta}</span>}
          {p.impuesto_pct != null && <span>· <EtiquetaIva pct={p.impuesto_pct} nombre={p.impuesto_nombre} /></span>}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {!p.controla_stock ? null : agotado
            ? <Badge variant="outline" className="border-destructive/40 bg-destructive/10 px-1.5 py-0 text-[10px] font-medium text-destructive">Sin disponible</Badge>
            : <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal text-muted-foreground" data-testid="disponible">{disp.toLocaleString("es-VE")} disp.</Badge>}
          {p.compras.veces > 0 && (
            <Badge variant="outline" className="gap-1 border-emerald-300 bg-emerald-50 px-1.5 py-0 text-[10px] font-normal text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">
              <History className="h-3 w-3" />{p.compras.veces === 1 ? "Lo compró 1 vez" : `Lo compró ${p.compras.veces} veces`}
            </Badge>
          )}
        </div>
        {f && (
          <p className="mt-1 text-[11px] text-muted-foreground" data-testid="frecuencia">
            Última vez: {f.ultima_unidades.toLocaleString("es-VE")} u. · {fechaCorta(f.ultima)}
          </p>
        )}
        {opciones.length > 1 && (
          <div className="mt-1.5 flex flex-wrap gap-1" role="radiogroup" aria-label="Presentación" onKeyDown={flechasGrupoRadio}>
            {opciones.map((o, idx) => (
              <button key={o.tipo_empaque_id ?? "u"} type="button" role="radio" aria-checked={o.tipo_empaque_id === sel}
                tabIndex={o.tipo_empaque_id === sel || (idx === 0 && !opciones.some((x) => x.tipo_empaque_id === sel)) ? 0 : -1}
                onClick={() => setSel(o.tipo_empaque_id)}
                className={cn("inline-flex min-h-6 items-center rounded-full border px-2 py-0.5 text-[11px]", o.tipo_empaque_id === sel ? "border-emerald-700 bg-emerald-500/10 font-medium text-emerald-800 dark:text-emerald-300" : "border-border text-muted-foreground")}>
                {o.nombre ?? "Unidad"}{o.unidades > 1 ? ` ×${o.unidades}` : ""}{cantidadDe(o) > 0 ? ` · ${cantidadDe(o)}` : ""}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex w-[128px] shrink-0 flex-col items-end gap-1.5">
        <div className="text-right leading-tight">
          <p className="text-sm font-semibold tabular-nums" data-testid="precio">{formatPrice(opcion.precio)}</p>
          <p className="text-[10px] text-muted-foreground">{opcion.unidades > 1 ? `${opcion.nombre} ×${opcion.unidades}` : opcion.nombre ?? "c/u"}</p>
        </div>
        {cant > 0 ? (
          <SelectorCantidad valor={cant} max={Math.max(cant, max)} onCambiar={(n) => onCantidad(opcion, n)} etiqueta={p.nombre} />
        ) : sugerida && sugerida > 0 && max > 0 ? (
          <Button type="button" size="sm" className="h-9 w-full gap-1 bg-emerald-700 px-2 text-white hover:bg-emerald-800" disabled={agotado}
            onClick={() => onCantidad(opcion, Math.min(max, sugerida))} data-testid="agregar-sugerida">
            <Plus className="h-3.5 w-3.5" />{Math.min(max, sugerida)}
          </Button>
        ) : (
          <Button type="button" size="sm" variant="outline" className="h-9 w-full gap-1 border-emerald-500/60 px-2 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300"
            disabled={agotado || max <= 0} onClick={() => onCantidad(opcion, 1)} data-testid="agregar">
            <Plus className="h-3.5 w-3.5" />Agregar
          </Button>
        )}
      </div>
    </li>
  );
}
