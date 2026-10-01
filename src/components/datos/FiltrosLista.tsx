import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarRange, Check, ChevronDown, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { cn } from "@/lib/utils";
import { mostrarEstado, pareceEstadoOdoo } from "@/lib/estados";

/*
 * Filtros de una lista, guardados en la URL (?ciudad=Maracaibo&fecha=2026-09-01..2026-09-30): se comparten y
 * sobreviven a recargar. Uso:
 *
 *   const f = useFiltros([
 *     { clave: "ciudad", etiqueta: "Ciudad", opciones: opcionesDe(clientes, (c) => c.ciudad, undefined, "Sin ciudad"), principal: true },
 *     { clave: "fecha", etiqueta: "Fecha", tipo: "fecha" },
 *   ]);
 *   const filas = clientes.filter((c) => coincide(c.ciudad, f.v("ciudad")) && enRango(c.created_at, f.v("fecha")));
 *   <BarraLista filtros={<FiltrosLista filtros={f} resultados={filas.length} />} contador={contadorFiltrado(filas.length, clientes.length, f.activos)} />
 *
 * Escritorio: los `principal` van en la barra; el resto en el panel "Más filtros". Móvil: todo en una hoja inferior.
 * Debajo de la barra quedan los filtros activos como chips, con "Limpiar filtros".
 */

/** Valor de las opciones "Sin …" (campo vacío). */
export const SIN_VALOR = "_sin";

export interface OpcionFiltro { valor: string; etiqueta: string; n?: number }
interface BaseFiltro { clave: string; etiqueta: string; principal?: boolean }
/** `porDefecto`: valor cuando la URL no trae el filtro (p. ej. Facturas = "vigentes"); entonces no hay opción "Todos" y
 *  las opciones deben incluir la que muestra todo. `todos`: texto de la opción vacía. */
export interface FiltroSelect extends BaseFiltro { tipo?: "select"; opciones: OpcionFiltro[]; todos?: string; porDefecto?: string }
export interface FiltroFecha extends BaseFiltro { tipo: "fecha" }
export type DefFiltro = FiltroSelect | FiltroFecha;

const esFecha = (d: DefFiltro): d is FiltroFecha => d.tipo === "fecha";
const defecto = (d: DefFiltro) => (esFecha(d) ? "" : d.porDefecto ?? "");

/** Estado de los filtros en la URL. Las claves que no están en `defs` no se tocan (p. ej. ?tab=, ?orden=). */
export function useFiltros(defs: (DefFiltro | null | false | undefined)[]) {
  const [params, setParams] = useSearchParams();
  const lista = defs.filter(Boolean) as DefFiltro[];
  const valores: Record<string, string> = {};
  for (const d of lista) valores[d.clave] = params.get(d.clave) ?? defecto(d);
  const clavesTxt = lista.map((d) => d.clave).join(",");
  // "clave=defecto,…": el valor por defecto no se escribe en la URL
  const defectosTxt = lista.map((d) => `${d.clave}=${defecto(d)}`).join(",");

  /** Cambia varios filtros de una vez ("" o el valor por defecto = quitar). Dos set() seguidos en el mismo evento se pisarían. */
  const setVarios = useCallback((cambios: Record<string, string>) => {
    const defs = Object.fromEntries(defectosTxt.split(",").filter(Boolean).map((kv) => [kv.slice(0, kv.indexOf("=")), kv.slice(kv.indexOf("=") + 1)]));
    setParams((p) => {
      const n = new URLSearchParams(p);
      for (const [k, v] of Object.entries(cambios)) { if (v && v !== (defs[k] ?? "")) n.set(k, v); else n.delete(k); }
      return n;
    }, { replace: true });
  }, [setParams, defectosTxt]);
  const set = useCallback((clave: string, valor: string) => setVarios({ [clave]: valor }), [setVarios]);
  const limpiar = useCallback(() => setVarios(Object.fromEntries(clavesTxt.split(",").filter(Boolean).map((k) => [k, ""]))), [setVarios, clavesTxt]);

  const esActivo = (d: DefFiltro) => valores[d.clave] !== defecto(d);
  const activos = lista.filter(esActivo).length;
  // Firma de los filtros aplicados: sirve para volver a la página 1 de la tabla al cambiarlos
  const firma = lista.map((d) => `${d.clave}=${valores[d.clave]}`).join("&");
  const v = (clave: string) => valores[clave] ?? "";
  return { defs: lista, valores, v, set, setVarios, limpiar, activos, firma, esActivo };
}
export type Filtros = ReturnType<typeof useFiltros>;

// ---------------------------------------------------------------------------------------------------------------
// Predicados y opciones

/** ¿El valor pasa el filtro? Filtro vacío = todo; SIN_VALOR = campo vacío. */
export const coincide = (valor: string | number | null | undefined, filtro: string) =>
  !filtro || (filtro === SIN_VALOR ? valor == null || valor === "" : String(valor ?? "") === filtro);

/** Opciones distintas de un campo, con cuántas filas tiene cada una (ordenadas por etiqueta). `sin` agrega "Sin …". */
export function opcionesDe<T>(filas: T[], valor: (f: T) => string | null | undefined, etiqueta?: (f: T, v: string) => string, sin?: string): OpcionFiltro[] {
  const m = new Map<string, OpcionFiltro>();
  let vacios = 0;
  for (const f of filas) {
    const v = valor(f);
    if (v == null || v === "") { vacios++; continue; }
    const o = m.get(v);
    if (o) o.n = (o.n ?? 0) + 1; else m.set(v, { valor: v, etiqueta: etiqueta ? etiqueta(f, v) : v, n: 1 });
  }
  const ops = [...m.values()].sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, "es", { numeric: true, sensitivity: "base" }));
  if (sin && vacios) ops.push({ valor: SIN_VALOR, etiqueta: sin, n: vacios });
  return ops;
}

/** Texto comparable: sin tildes, mayúsculas, comillas ni espacios de más ("CARACAS " = "Caracas"). */
export const normalizarTexto = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/["'.]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/** Como opcionesDe, pero agrupa las variantes de escritura de un texto libre (ciudad, marca…). La etiqueta es la
 *  variante más usada; el valor, el texto normalizado (filtrar con coincideTexto). */
export function opcionesTexto<T>(filas: T[], valor: (f: T) => string | null | undefined, sin?: string): OpcionFiltro[] {
  const m = new Map<string, { n: number; variantes: Map<string, number> }>();
  let vacios = 0;
  for (const f of filas) {
    const original = (valor(f) ?? "").replace(/["]+$/g, "").trim();
    const k = normalizarTexto(original);
    if (!k) { vacios++; continue; }
    const g = m.get(k) ?? { n: 0, variantes: new Map<string, number>() };
    g.n++; g.variantes.set(original, (g.variantes.get(original) ?? 0) + 1);
    m.set(k, g);
  }
  // Un estado de Odoo se muestra limpio ("Sucre. (VE)" → "Sucre"); el valor del filtro (la clave) no cambia
  const etiqueta = (t: string) => (pareceEstadoOdoo(t) ? mostrarEstado(t) : t);
  const ops = [...m.entries()].map(([k, g]) => ({ valor: k, etiqueta: etiqueta([...g.variantes.entries()].sort((a, b) => b[1] - a[1])[0][0]), n: g.n }))
    .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, "es", { numeric: true, sensitivity: "base" }));
  if (sin && vacios) ops.push({ valor: SIN_VALOR, etiqueta: sin, n: vacios });
  return ops;
}
export const coincideTexto = (valor: string | null | undefined, filtro: string) =>
  !filtro || (filtro === SIN_VALOR ? !normalizarTexto(valor) : normalizarTexto(valor) === filtro);

/** Opción definida por una condición (p. ej. "Bajo stock"). Se usa para contar y para filtrar con la misma regla. */
export interface OpcionPrueba<T> { valor: string; etiqueta: string; prueba: (f: T) => boolean }
export const opcionesPrueba = <T,>(filas: T[], ops: OpcionPrueba<T>[], ocultarVacias = false): OpcionFiltro[] =>
  ops.map((o) => ({ valor: o.valor, etiqueta: o.etiqueta, n: filas.filter(o.prueba).length })).filter((o) => !ocultarVacias || (o.n ?? 0) > 0);
export const pasaPrueba = <T,>(ops: OpcionPrueba<T>[], filtro: string, fila: T) => {
  if (!filtro) return true;
  const o = ops.find((x) => x.valor === filtro);
  return o ? o.prueba(fila) : true;
};

/** Fecha local (YYYY-MM-DD) de una fecha o marca de tiempo. Las fechas sin hora se toman tal cual (sin corrimiento de zona). */
export const fechaLocal = (fecha: string | null | undefined): string | null => {
  if (!fecha) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return fecha;
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) return fecha.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** "2026-09-01..2026-09-30" → { desde, hasta } (cualquiera puede faltar). */
export const leerRango = (v: string): { desde: string; hasta: string } => {
  const [desde = "", hasta = ""] = (v || "").split("..");
  return { desde: /^\d{4}-\d{2}-\d{2}$/.test(desde) ? desde : "", hasta: /^\d{4}-\d{2}-\d{2}$/.test(hasta) ? hasta : "" };
};
const escribirRango = (desde: string, hasta: string) => (desde || hasta ? `${desde}..${hasta}` : "");

/** ¿La fecha cae en el rango del filtro? Filtro vacío = todo; sin fecha = fuera de cualquier rango. */
export const enRango = (fecha: string | null | undefined, filtro: string) => {
  if (!filtro) return true;
  const { desde, hasta } = leerRango(filtro);
  if (!desde && !hasta) return true;
  const d = fechaLocal(fecha);
  if (!d) return false;
  return (!desde || d >= desde) && (!hasta || d <= hasta);
};

/** Texto del contador de la barra: "38 de 238 clientes" con filtros, "238 clientes" sin ellos. */
export const contadorFiltrado = (n: number, total: number, filtrado: boolean | number, unidad = "registros") =>
  filtrado && n !== total ? `${n} de ${total} ${unidad}` : `${n} ${unidad}`;

/** Filtro "Empresa" solo en modo consulta «Ambas empresas» (null en una empresa concreta). */
export function useFiltroEmpresa<T extends { empresa_id?: string | null }>(filas: T[], principal = false): FiltroSelect | null {
  const { soloLectura, empresas } = useEmpresa();
  return useMemo(() => {
    if (!soloLectura || empresas.length < 2) return null;
    const n = (id: string) => filas.filter((f) => f.empresa_id === id).length;
    const opciones: OpcionFiltro[] = empresas.map((e) => ({ valor: e.id, etiqueta: e.nombre_corto || e.nombre, n: n(e.id) }));
    // empresa_id vacío = registro compartido por las dos empresas (como en Odoo)
    const compartidos = filas.filter((f) => !f.empresa_id).length;
    if (compartidos) opciones.push({ valor: SIN_VALOR, etiqueta: "Compartidos", n: compartidos });
    return { clave: "empresa", etiqueta: "Empresa", principal, opciones };
  }, [soloLectura, empresas, filas, principal]);
}

// ---------------------------------------------------------------------------------------------------------------
// Rangos de fecha rápidos

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function atajosFecha() {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const menos = (dias: number) => { const d = new Date(hoy); d.setDate(d.getDate() - dias); return d; };
  const y = hoy.getFullYear(), m = hoy.getMonth();
  return [
    { etiqueta: "Hoy", desde: iso(hoy), hasta: iso(hoy) },
    { etiqueta: "Últimos 7 días", desde: iso(menos(6)), hasta: iso(hoy) },
    { etiqueta: "Últimos 30 días", desde: iso(menos(29)), hasta: iso(hoy) },
    { etiqueta: "Este mes", desde: iso(new Date(y, m, 1)), hasta: iso(new Date(y, m + 1, 0)) },
    { etiqueta: "Mes anterior", desde: iso(new Date(y, m - 1, 1)), hasta: iso(new Date(y, m, 0)) },
    { etiqueta: "Este año", desde: iso(new Date(y, 0, 1)), hasta: iso(new Date(y, 11, 31)) },
  ];
}
const fmtCorta = (s: string) => { const [y, m, d] = s.split("-"); return `${d}/${m}/${y}`; };
export function textoRango(v: string) {
  const { desde, hasta } = leerRango(v);
  const prioridad = ["Hoy", "Este mes", "Mes anterior", "Este año", "Últimos 7 días", "Últimos 30 días"];
  const atajo = atajosFecha().sort((a, b) => prioridad.indexOf(a.etiqueta) - prioridad.indexOf(b.etiqueta))
    .find((a) => a.desde === desde && a.hasta === hasta);
  if (atajo) return atajo.etiqueta;
  if (desde && hasta) return desde === hasta ? fmtCorta(desde) : `${fmtCorta(desde)} – ${fmtCorta(hasta)}`;
  if (desde) return `desde ${fmtCorta(desde)}`;
  if (hasta) return `hasta ${fmtCorta(hasta)}`;
  return "";
}

const textoValor = (d: DefFiltro, v: string) => (esFecha(d) ? textoRango(v) : d.opciones.find((o) => o.valor === v)?.etiqueta ?? v);

// ---------------------------------------------------------------------------------------------------------------
// Controles

function useEscritorio(consulta: string) {
  const [es, setEs] = useState(() => typeof window === "undefined" || window.matchMedia(consulta).matches);
  useEffect(() => {
    const mql = window.matchMedia(consulta);
    const cambio = () => setEs(mql.matches);
    mql.addEventListener("change", cambio);
    cambio();
    return () => mql.removeEventListener("change", cambio);
  }, [consulta]);
  return es;
}

/** Lista con búsqueda (Popover + Command) para un filtro de opciones. */
function SelectFiltro({ def, valor, onCambio, id, enBarra, grande }: { def: FiltroSelect; valor: string; onCambio: (v: string) => void; id?: string; enBarra?: boolean; grande?: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const todos = def.todos ?? "Todos";
  const texto = valor ? textoValor(def, valor) : todos;
  const buscable = def.opciones.length > 8;
  // Con valor por defecto no hay opción vacía; "activo" = distinto del valor por defecto
  const conDefecto = def.porDefecto != null;
  const activo = valor !== (def.porDefecto ?? "");
  const elegir = (v: string) => { onCambio(v); setAbierto(false); };
  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" size="sm" role="combobox" aria-expanded={abierto}
          aria-label={enBarra ? `${def.etiqueta}: ${texto}` : undefined}
          className={cn("justify-between gap-1.5 px-2.5 font-normal", grande ? "h-10 text-sm" : "h-8 text-[13px]", enBarra ? "max-w-[15rem]" : "w-full",
            activo && "border-primary/50 bg-primary/5 text-foreground")}>
          {/* En la barra, sin valor solo se ve el nombre del filtro ("Ciudad ▾"); con valor, "Ciudad: Maracaibo" */}
          {enBarra && !valor ? <span className="truncate">{def.etiqueta}</span> : (
            <span className="truncate">
              {enBarra && <span className="text-muted-foreground">{def.etiqueta}: </span>}
              <span className={cn(activo && "font-medium")}>{texto}</span>
            </span>
          )}
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      {/* Sin buscador, el foco va a la lista para que funcionen las flechas y Enter (cmdk escucha el teclado en su raíz) */}
      <PopoverContent align="start" className="w-64 p-0"
        onOpenAutoFocus={(e) => { if (!buscable) { e.preventDefault(); raiz.current?.focus(); } }}>
        <Command ref={raiz} tabIndex={-1} className="outline-none">
          {buscable && <CommandInput placeholder={`Buscar ${def.etiqueta.toLowerCase()}…`} className="h-9 text-[13px]" />}
          <CommandList className="max-h-72">
            <CommandEmpty className="py-4 text-center text-xs text-muted-foreground">Sin coincidencias</CommandEmpty>
            {!conDefecto && (
              <CommandItem value={`__todos ${todos}`} onSelect={() => elegir("")} className="gap-2 text-[13px]">
                <Check className={cn("h-3.5 w-3.5", valor ? "opacity-0" : "opacity-100")} />{todos}
              </CommandItem>
            )}
            {def.opciones.map((o) => (
              <CommandItem key={o.valor} value={`${o.etiqueta} ${o.valor}`} onSelect={() => elegir(o.valor)} className="gap-2 text-[13px]">
                <Check className={cn("h-3.5 w-3.5 shrink-0", valor === o.valor ? "opacity-100" : "opacity-0")} />
                <span className="min-w-0 flex-1 truncate">{o.etiqueta}</span>
                {o.n != null && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{o.n}</span>}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Rango de fechas: atajos + desde/hasta. */
function EditorRango({ valor, onCambio, idBase, grande }: { valor: string; onCambio: (v: string) => void; idBase: string; grande?: boolean }) {
  const { desde, hasta } = leerRango(valor);
  const atajos = atajosFecha();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {atajos.map((a) => {
          const activo = a.desde === desde && a.hasta === hasta;
          return (
            <button key={a.etiqueta} type="button" onClick={() => onCambio(escribirRango(a.desde, a.hasta))} aria-pressed={activo}
              className={cn("rounded-full border px-2 text-xs transition-colors", grande ? "h-8" : "h-6",
                activo ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted")}>
              {a.etiqueta}
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor={`${idBase}-desde`} className="text-xs font-normal text-muted-foreground">Desde</Label>
          <Input id={`${idBase}-desde`} type="date" value={desde} max={hasta || undefined} onChange={(e) => onCambio(escribirRango(e.target.value, hasta))}
            className={cn("px-2 text-[13px]", grande ? "h-10" : "h-8")} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${idBase}-hasta`} className="text-xs font-normal text-muted-foreground">Hasta</Label>
          <Input id={`${idBase}-hasta`} type="date" value={hasta} min={desde || undefined} onChange={(e) => onCambio(escribirRango(desde, e.target.value))}
            className={cn("px-2 text-[13px]", grande ? "h-10" : "h-8")} />
        </div>
      </div>
    </div>
  );
}

function FechaEnBarra({ def, valor, onCambio, grande }: { def: FiltroFecha; valor: string; onCambio: (v: string) => void; grande?: boolean }) {
  const idBase = useId();
  const texto = valor ? textoRango(valor) : "Cualquiera";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" aria-label={`${def.etiqueta}: ${texto}`}
          className={cn("max-w-[16rem] gap-1.5 px-2.5 font-normal", grande ? "h-10 text-sm" : "h-8 text-[13px]", valor && "border-primary/50 bg-primary/5")}>
          <CalendarRange className="h-3.5 w-3.5 shrink-0 opacity-60" />
          {valor ? <span className="truncate"><span className="text-muted-foreground">{def.etiqueta}: </span><span className="font-medium">{texto}</span></span>
            : <span className="truncate">{def.etiqueta}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3">
        <EditorRango valor={valor} onCambio={onCambio} idBase={idBase} />
        {valor && <Button type="button" variant="ghost" size="sm" className="mt-2 h-7 px-2 text-xs" onClick={() => onCambio("")}>Quitar fecha</Button>}
      </PopoverContent>
    </Popover>
  );
}

/** Campo del panel o de la hoja: etiqueta + control. */
function CampoFiltro({ def, filtros, movil, grande }: { def: DefFiltro; filtros: Filtros; movil?: boolean; grande?: boolean }) {
  const id = useId();
  const valor = filtros.v(def.clave);
  if (esFecha(def)) {
    return (
      <fieldset className={cn("space-y-1.5", !movil && "col-span-2")}>
        <legend className={cn("mb-1.5 font-medium", grande ? "text-sm" : "text-xs")}>{def.etiqueta}</legend>
        <EditorRango valor={valor} onCambio={(v) => filtros.set(def.clave, v)} idBase={id} grande={movil || grande} />
      </fieldset>
    );
  }
  return (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={id} className={cn("font-medium", grande ? "text-sm" : "text-xs")}>{def.etiqueta}</Label>
      {movil ? (
        // En el teléfono, el selector nativo del sistema (lista grande, con búsqueda por letra y buen foco)
        <select id={id} value={valor} onChange={(e) => filtros.set(def.clave, e.target.value)}
          className={cn("h-10 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            filtros.esActivo(def) && "border-primary/60")}>
          {def.porDefecto == null && <option value="">{def.todos ?? "Todos"}</option>}
          {valor && !def.opciones.some((o) => o.valor === valor) && <option value={valor}>{valor}</option>}
          {def.opciones.map((o) => <option key={o.valor} value={o.valor}>{o.etiqueta}{o.n != null ? ` (${o.n})` : ""}</option>)}
        </select>
      ) : (
        <SelectFiltro def={def} valor={valor} onCambio={(v) => filtros.set(def.clave, v)} id={id} grande={grande} />
      )}
    </div>
  );
}

/** Chips de los filtros aplicados + "Limpiar filtros". Ocupa su propia fila al final de la barra. */
function ChipsFiltros({ filtros, grande }: { filtros: Filtros; grande?: boolean }) {
  const activos = filtros.defs.filter((d) => filtros.esActivo(d));
  if (activos.length === 0) return null;
  return (
    <div className="order-last flex basis-full flex-wrap items-center gap-1.5" role="group" aria-label="Filtros aplicados">
      {activos.map((d) => (
        <span key={d.clave} className={cn("inline-flex max-w-full items-center gap-1 rounded-full border border-primary/30 bg-primary/5 pr-0.5",
          grande ? "h-8 pl-3 text-sm" : "h-6 pl-2 text-xs")}>
          <span className="truncate"><span className="text-muted-foreground">{d.etiqueta}:</span> <span className="font-medium text-foreground">{textoValor(d, filtros.v(d.clave))}</span></span>
          <button type="button" onClick={() => filtros.set(d.clave, "")} aria-label={`Quitar filtro ${d.etiqueta}`}
            className={cn("rounded-full text-muted-foreground hover:bg-primary/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", grande ? "p-1.5" : "p-1")}>
            <X className={grande ? "h-3.5 w-3.5" : "h-3 w-3"} />
          </button>
        </span>
      ))}
      <button type="button" onClick={filtros.limpiar}
        className={cn("rounded px-1 font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", grande ? "min-h-8 text-sm" : "text-xs")}>
        Limpiar filtros
      </button>
    </div>
  );
}

/**
 * Filtros de la lista para el hueco `filtros` de BarraLista. En escritorio: los principales en la barra y el resto en
 * "Más filtros"; en móvil (< 640 px): un botón "Filtros" que abre una hoja inferior. Se monta solo una de las dos
 * variantes (la hoja de Radix va en un portal y no respeta las clases responsive del padre).
 */
export function FiltrosLista({ filtros, resultados, className, portal }: {
  filtros: Filtros; resultados?: number; className?: string;
  /** Portales (cliente y vendedor): controles de 40 px y hoja inferior por debajo de 1024 px, como el resto del portal. */
  portal?: boolean;
}) {
  const escritorio = useEscritorio(portal ? "(min-width: 1024px)" : "(min-width: 640px)");
  const alto = portal ? "h-10 text-sm" : "h-8 text-[13px]";
  const [hoja, setHoja] = useState(false);
  const principales = filtros.defs.filter((d) => d.principal);
  const resto = filtros.defs.filter((d) => !d.principal);
  const activosResto = resto.filter((d) => filtros.esActivo(d)).length;
  if (filtros.defs.length === 0) return null;

  const pie = (
    <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
      <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={filtros.limpiar} disabled={filtros.activos === 0}>
        Limpiar filtros
      </Button>
      {resultados != null && <span className="text-xs text-muted-foreground" aria-live="polite">{resultados} resultado{resultados === 1 ? "" : "s"}</span>}
    </div>
  );

  if (escritorio) {
    return (
      <>
        {principales.map((d) => esFecha(d)
          ? <FechaEnBarra key={d.clave} def={d} valor={filtros.v(d.clave)} onCambio={(v) => filtros.set(d.clave, v)} grande={portal} />
          : <SelectFiltro key={d.clave} def={d} valor={filtros.v(d.clave)} onCambio={(v) => filtros.set(d.clave, v)} enBarra grande={portal} />)}
        {resto.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant={activosResto ? "secondary" : "outline"} size="sm" className={cn("gap-1.5 px-2.5", alto, className)}>
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {principales.length ? "Más filtros" : "Filtros"}
                {activosResto > 0 && <span className="rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-4 text-primary-foreground">{activosResto}</span>}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[min(34rem,calc(100vw-2rem))] p-3">
              <p className="mb-2 text-sm font-semibold">Filtros</p>
              <div className="mb-3 grid grid-cols-2 gap-x-3 gap-y-2.5">
                {resto.map((d) => <CampoFiltro key={d.clave} def={d} filtros={filtros} grande={portal} />)}
              </div>
              {pie}
            </PopoverContent>
          </Popover>
        )}
        <ChipsFiltros filtros={filtros} grande={portal} />
      </>
    );
  }

  return (
    <>
      <Button type="button" variant={filtros.activos ? "secondary" : "outline"} size="sm" className={cn("gap-1.5 px-2.5", alto, className)}
        onClick={() => setHoja(true)} aria-haspopup="dialog">
        <SlidersHorizontal className="h-3.5 w-3.5" /> Filtros
        {filtros.activos > 0 && <span className="rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-4 text-primary-foreground">{filtros.activos}</span>}
      </Button>
      <Sheet open={hoja} onOpenChange={setHoja}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-xl p-4">
          <SheetHeader className="mb-3 text-left">
            <SheetTitle className="text-base">Filtros</SheetTitle>
            <SheetDescription className="text-xs">Se aplican al momento.</SheetDescription>
          </SheetHeader>
          <div className="mb-3 space-y-3">
            {filtros.defs.map((d) => <CampoFiltro key={d.clave} def={d} filtros={filtros} movil />)}
          </div>
          <div className="flex items-center gap-2 border-t border-border pt-3">
            <Button type="button" variant="outline" className="h-10 flex-1" onClick={filtros.limpiar} disabled={filtros.activos === 0}>Limpiar</Button>
            <Button type="button" className="h-10 flex-[2]" onClick={() => setHoja(false)}>
              {resultados != null ? `Ver ${resultados} resultado${resultados === 1 ? "" : "s"}` : "Listo"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
      <ChipsFiltros filtros={filtros} grande={portal} />
    </>
  );
}
