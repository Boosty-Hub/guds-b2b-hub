import { useEffect, useRef } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ORDENES_CATALOGO, type OrdenCatalogo } from "@/hooks/useCatalogoPortal";

// Controles del catálogo que no se ven al cargar o solo se ven en escritorio (orden con Radix Select, hoja de filtros del
// teléfono con Radix Sheet). Se descargan aparte, cuando el navegador queda libre o al tocarlos: ver PortalCatalogo.

export const CLASE_ORDEN = "h-10 w-52 bg-card";

/** Orden del catálogo (escritorio). */
export function OrdenSelect({ orden, onCambiar, abrirAlMontar = false, enfocar = false }: {
  orden: OrdenCatalogo;
  onCambiar: (orden: OrdenCatalogo) => void;
  abrirAlMontar?: boolean;
  enfocar?: boolean;
}) {
  const disparador = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (enfocar) disparador.current?.focus(); }, [enfocar]);
  return (
    <Select value={orden} onValueChange={(v) => onCambiar(v as OrdenCatalogo)} defaultOpen={abrirAlMontar}>
      <SelectTrigger ref={disparador} className={CLASE_ORDEN} aria-label="Ordenar"><SelectValue /></SelectTrigger>
      <SelectContent>{ORDENES_CATALOGO.map((o) => <SelectItem key={o.valor} value={o.valor}>{o.etiqueta}</SelectItem>)}</SelectContent>
    </Select>
  );
}

/** Filtros y orden (móvil y tableta). */
export function FiltrosHoja({ abierto, setAbierto, orden, soloDisponibles, categorias, categoria, total, cambiarParams }: {
  abierto: boolean;
  setAbierto: (v: boolean) => void;
  orden: OrdenCatalogo;
  soloDisponibles: boolean;
  categorias: { id: string; etiqueta: string; nombre: string }[] | null;
  categoria: string | null;
  total: number;
  cambiarParams: (cambios: Record<string, string | null>) => void;
}) {
  return (
    <Sheet open={abierto} onOpenChange={setAbierto}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <SheetHeader className="text-left">
          <SheetTitle>Filtros y orden</SheetTitle>
          <SheetDescription className="sr-only">Elige el orden, la categoría y si ver solo productos disponibles.</SheetDescription>
        </SheetHeader>
        <div className="space-y-5 py-4">
          <div>
            <p className="mb-2 text-sm font-medium">Ordenar por</p>
            <div className="grid grid-cols-2 gap-2">
              {ORDENES_CATALOGO.map((o) => (
                <button key={o.valor} type="button" onClick={() => cambiarParams({ orden: o.valor === "relevancia" ? null : o.valor })} aria-pressed={orden === o.valor}
                  className={cn("flex h-11 items-center justify-between rounded-lg border px-3 text-left text-sm font-medium",
                    orden === o.valor ? "border-foreground bg-muted" : "border-border")}>
                  {o.etiqueta}{orden === o.valor && <Check className="h-4 w-4 shrink-0" />}
                </button>
              ))}
            </div>
          </div>
          <label className="flex h-11 cursor-pointer items-center justify-between gap-3 rounded-lg border border-border px-3 text-sm font-medium">
            <span>Solo disponibles</span>
            <Switch checked={soloDisponibles} onCheckedChange={(v) => cambiarParams({ disp: v ? "1" : null })} aria-label="Mostrar solo productos disponibles" />
          </label>
          <div>
            <p className="mb-2 text-sm font-medium">Categoría</p>
            <div className="flex flex-wrap gap-2">
              {[{ id: null as string | null, etiqueta: "Todos", nombre: "Todos" }, ...(categorias ?? [])].map((c) => (
                <button key={c.id ?? "todas"} type="button" onClick={() => { cambiarParams({ cat: c.id }); setAbierto(false); }} aria-pressed={(c.id ?? null) === (categoria ?? null)}
                  title={c.nombre}
                  className={cn("rounded-full border px-3 py-1.5 text-sm", (c.id ?? null) === (categoria ?? null) ? "border-foreground bg-foreground text-background" : "border-border")}>
                  {c.etiqueta}
                </button>
              ))}
            </div>
          </div>
          <Button className="h-11 w-full" onClick={() => setAbierto(false)}>Ver {total.toLocaleString("es-VE")} {total === 1 ? "producto" : "productos"}</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
