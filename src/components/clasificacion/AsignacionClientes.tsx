import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, Check, CheckCheck, Info, Loader2, Send, Undo2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { usePermissions } from "@/contexts/PermissionsContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { BarraLista } from "@/components/datos/BarraLista";
import { EncabezadoOrdenable, exportarCSV, BotonExportar, useOrdenTabla } from "@/components/datos/tabla";
import { useColumnas } from "@/components/datos/columnas";
import {
  FiltrosLista, useFiltros, useFiltroEmpresa, opcionesDe, opcionesPrueba, pasaPrueba, coincide, contadorFiltrado, normalizarTexto, type OpcionPrueba,
} from "@/components/datos/FiltrosLista";
import { cn } from "@/lib/utils";
import {
  ESTADOS, ORDEN_ESTADOS, ORIGENES, MOTIVOS_OMITIDO, cargarLista, mensajeError, usd, type FilaClasif, type TipoClasif,
} from "./comun";
import { DetalleClasificacionDialog } from "./DetalleClasificacionDialog";

const pruebasActividad: OpcionPrueba<FilaClasif>[] = [
  { valor: "con", etiqueta: "Con actividad (ventas en Odoo o deuda)", prueba: (f) => f.con_actividad },
  { valor: "sin", etiqueta: "Sin actividad (históricos)", prueba: (f) => !f.con_actividad },
  { valor: "todos", etiqueta: "Con y sin actividad", prueba: () => true },
];
const pruebasExcel: OpcionPrueba<FilaClasif>[] = [
  { valor: "tipo", etiqueta: "Con tipo en el Excel", prueba: (f) => !!f.excel_tipo_id },
  { valor: "por_definir", etiqueta: "\"Por definir\" en el Excel", prueba: (f) => !f.excel_tipo_id && !!f.excel_texto && !f.excel_detalle?.conflicto },
  { valor: "conflicto", etiqueta: "Dos filas con tipos distintos", prueba: (f) => !!f.excel_detalle?.conflicto },
  { valor: "no", etiqueta: "No está en el Excel", prueba: (f) => !f.excel_texto },
];
const ENVIABLES = new Set(["por_enviar", "error", "simulada", "cambiado_en_odoo"]);

/** Clientes de la empresa con su clasificación: propuesta del Excel de finanzas, sugerencia de Profit, lo asignado en GUDS,
 *  lo que hay en Odoo y el estado del envío. Asignación individual y masiva, confirmar propuestas y enviar a Odoo. */
export function AsignacionClientes({ tipos, modo, version }: { tipos: TipoClasif[]; modo: string; version: number }) {
  const { toast } = useToast();
  const { soloLectura, empresaActiva } = useEmpresa();
  const { can } = usePermissions();
  const editable = !soloLectura && can("clasificacion_clientes", "editar");
  const [params] = useSearchParams();
  const [filas, setFilas] = useState<FilaClasif[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busq, setBusq] = useState(() => params.get("q") ?? "");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<FilaClasif | null>(null);
  const [confirmarEnvio, setConfirmarEnvio] = useState<string[] | null>(null);

  const cargar = useCallback(async () => {
    try {
      setFilas(await cargarLista());
    } catch (e) {
      toast({ title: "No se pudo cargar la clasificación", description: mensajeError(e as Error), variant: "destructive" });
    } finally {
      setCargando(false);
    }
  }, [toast]);
  useEffect(() => { cargar(); }, [cargar, version]);
  // Mientras haya envíos en la cola, se refresca solo
  const enCurso = filas.some((f) => f.estado === "enviando");
  useEffect(() => {
    if (!enCurso) return;
    const t = setInterval(cargar, 4000);
    return () => clearInterval(t);
  }, [enCurso, cargar]);

  const tiposEmpresa = useMemo(() => tipos.filter((t) => t.empresa_id === empresaActiva?.id && t.activo), [tipos, empresaActiva?.id]);
  const porCategoria = useMemo(() => {
    const m = new Map<string, TipoClasif[]>();
    for (const t of tiposEmpresa) {
      const k = t.categoria_cobranza ?? "Por confirmar";
      m.set(k, [...(m.get(k) ?? []), t]);
    }
    return [...m.entries()];
  }, [tiposEmpresa]);

  const fEmp = useFiltroEmpresa(filas, true);
  const f = useFiltros([
    fEmp,
    { clave: "actividad", etiqueta: "Actividad", principal: true, porDefecto: "con", opciones: opcionesPrueba(filas, pruebasActividad) },
    { clave: "estado", etiqueta: "Estado", todos: "Todos los estados", principal: true,
      opciones: ORDEN_ESTADOS.map((e) => ({ valor: e, etiqueta: ESTADOS[e].label, n: filas.filter((x) => x.estado === e).length })).filter((o) => o.n) },
    { clave: "tipo", etiqueta: "Tipo asignado", todos: "Todos los tipos", principal: true, opciones: opcionesDe(filas, (x) => x.tipo_id, (x) => x.tipo ?? "—", "Sin tipo") },
    { clave: "vendedor", etiqueta: "Vendedor", todos: "Todos los vendedores", principal: true, opciones: opcionesDe(filas, (x) => x.vendedor, undefined, "Sin vendedor") },
    { clave: "categoria", etiqueta: "Categoría de cobranza", todos: "Todas", opciones: opcionesDe(filas, (x) => x.categoria, undefined, "Sin categoría") },
    { clave: "origen", etiqueta: "Origen de la asignación", todos: "Todos", opciones: opcionesDe(filas, (x) => x.origen, (_x, v) => ORIGENES[v as keyof typeof ORIGENES] ?? v, "Sin asignación") },
    { clave: "excel", etiqueta: "Excel de finanzas", todos: "Todos", opciones: opcionesPrueba(filas, pruebasExcel) },
    { clave: "profit", etiqueta: "Tipo en Profit", todos: "Todos", opciones: opcionesDe(filas, (x) => x.profit_tipo, undefined, "Sin Profit") },
  ]);

  const visibles = useMemo(() => {
    const t = normalizarTexto(busq);
    return filas.filter((x) => (!fEmp || coincide(x.empresa_id, f.v("empresa")))
      && pasaPrueba(pruebasActividad, f.v("actividad"), x) && coincide(x.estado, f.v("estado")) && coincide(x.tipo_id, f.v("tipo"))
      && coincide(x.vendedor, f.v("vendedor")) && coincide(x.categoria, f.v("categoria")) && coincide(x.origen, f.v("origen"))
      && pasaPrueba(pruebasExcel, f.v("excel"), x) && coincide(x.profit_tipo, f.v("profit"))
      && (!t || normalizarTexto(`${x.nombre} ${x.rif ?? ""} ${x.codigo ?? ""} ${x.excel_texto ?? ""}`).includes(t)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filas, f.firma, busq, fEmp]);
  // Indicadores sobre la empresa y la actividad elegidas (sin los demás filtros)
  const base = useMemo(() => filas.filter((x) => (!fEmp || coincide(x.empresa_id, f.v("empresa"))) && pasaPrueba(pruebasActividad, f.v("actividad"), x)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filas, f.firma, fEmp]);
  const cuenta = (...e: string[]) => base.filter((x) => e.includes(x.estado)).length;

  const { ordenadas, orden, alternar } = useOrdenTabla(visibles, {
    nombre: (x) => x.nombre, vendedor: (x) => x.vendedor, ventas: (x) => x.ventas_odoo_usd, deuda: (x) => x.deuda_usd,
    tipo: (x) => x.tipo, estado: (x) => ORDEN_ESTADOS.indexOf(x.estado), excel: (x) => x.excel_texto, profit: (x) => x.profit_tipo,
  }, { clave: "ventas", dir: "desc" });
  const pag = usePagination(ordenadas, 50, `${f.firma}|${busq}`);
  const cols = useColumnas("clasificacion-clientes", [
    { etiqueta: "", fija: true }, { etiqueta: "Cliente", fija: true }, { etiqueta: "Estado", fija: true }, { etiqueta: "Ventas Odoo" }, { etiqueta: "Deuda" },
    { etiqueta: "Propuesta (Excel / Profit)" }, { etiqueta: "Asignado en GUDS", fija: true }, { etiqueta: "En Odoo" }, { etiqueta: "Vendedor", oculta: true },
  ]);

  const seleccionadas = useMemo(() => filas.filter((x) => sel.has(x.cliente_id)), [filas, sel]);
  const nPropuestas = seleccionadas.filter((x) => x.estado === "propuesta").length;
  const nEnviables = seleccionadas.filter((x) => ENVIABLES.has(x.estado)).length;
  const nOdoo = seleccionadas.filter((x) => x.odoo_tipo_id && x.odoo_tipo_id !== x.tipo_id).length;
  const todasPagina = pag.pageItems.length > 0 && pag.pageItems.every((x) => sel.has(x.cliente_id));
  const alternarSel = (id: string, v: boolean) => setSel((s) => { const n = new Set(s); if (v) n.add(id); else n.delete(id); return n; });

  const rpc = async (clave: string, fn: string, args: Record<string, unknown>, exito: (d: unknown) => string | null) => {
    setOcupado(clave);
    const { data, error } = await supabase.rpc(fn, args);
    setOcupado(null);
    if (error) { toast({ title: "No se pudo guardar", description: mensajeError(error), variant: "destructive" }); return null; }
    const t = exito(data);
    if (t) toast({ title: t });
    await cargar();
    return data;
  };
  const asignar = (ids: string[], tipo: string | null) => rpc(`asignar:${ids.length === 1 ? ids[0] : "masivo"}`, "asignar_clasificacion", { p_clientes: ids, p_tipo: tipo },
    (n) => (ids.length === 1 ? null : `${n} cliente${n === 1 ? "" : "s"} ${tipo ? "con el tipo elegido" : "sin asignación"}`));
  const confirmar = (ids: string[]) => rpc("confirmar", "confirmar_clasificacion", { p_clientes: ids },
    (n) => `${n} propuesta${n === 1 ? "" : "s"} confirmada${n === 1 ? "" : "s"}`);
  const adoptar = (ids: string[]) => rpc("adoptar", "adoptar_clasificacion_odoo", { p_clientes: ids },
    (n) => `${n} cliente${n === 1 ? "" : "s"} con el tipo que tienen en Odoo`);
  const enviar = async (ids: string[]) => {
    setConfirmarEnvio(null);
    setOcupado("enviar");
    const { data, error } = await supabase.rpc("enviar_clasificacion_odoo", { p_clientes: ids });
    setOcupado(null);
    if (error) { toast({ title: "No se pudo enviar", description: mensajeError(error), variant: "destructive" }); return; }
    const r = data as { encolados: number; omitidos: Record<string, number>; modo?: string };
    const omitidos = Object.entries(r.omitidos ?? {}).map(([k, n]) => `${n} ${MOTIVOS_OMITIDO[k] ?? k}`).join(" · ");
    toast({
      title: r.encolados ? `${r.encolados} cliente${r.encolados === 1 ? "" : "s"} en la cola hacia Odoo${r.modo === "activo" ? "" : " (modo prueba)"}` : "No se envió ninguno",
      description: omitidos ? `No se enviaron: ${omitidos}` : undefined,
      variant: r.encolados ? "default" : "destructive",
    });
    setSel(new Set());
    await cargar();
  };

  const exportar = () => exportarCSV(`clasificacion-clientes${empresaActiva ? `-${empresaActiva.nombre_corto}` : ""}`, ordenadas, [
    { titulo: "Empresa", valor: (x) => x.empresa }, { titulo: "Código", valor: (x) => x.codigo }, { titulo: "Cliente", valor: (x) => x.nombre },
    { titulo: "RIF", valor: (x) => x.rif }, { titulo: "Vendedor", valor: (x) => x.vendedor }, { titulo: "Ventas Odoo USD", valor: (x) => x.ventas_odoo_usd },
    { titulo: "Deuda USD", valor: (x) => x.deuda_usd }, { titulo: "Excel de finanzas", valor: (x) => x.excel_texto },
    { titulo: "Profit tipo", valor: (x) => x.profit_tipo }, { titulo: "Profit segmento", valor: (x) => x.profit_segmento },
    { titulo: "Sugerencia Profit (categoría)", valor: (x) => x.profit_categoria }, { titulo: "Tipo asignado", valor: (x) => x.tipo },
    { titulo: "Canal", valor: (x) => x.canal }, { titulo: "Categoría de cobranza", valor: (x) => x.categoria },
    { titulo: "Origen", valor: (x) => (x.origen ? ORIGENES[x.origen] : null) }, { titulo: "Estado", valor: (x) => ESTADOS[x.estado].label },
    { titulo: "Odoo: tipo", valor: (x) => x.odoo_tipo }, { titulo: "Odoo: canal", valor: (x) => x.odoo_canal }, { titulo: "Odoo: segmento", valor: (x) => x.odoo_segmento },
  ]);

  const filtrarEstado = (e: string) => f.set("estado", f.v("estado") === e ? "" : e);

  return (
    <div data-testid="clasificacion-asignacion">
      {cols.estilo}
      <KpiStrip items={[
        { label: "Clientes", valor: base.length, detalle: f.v("actividad") === "con" ? "con actividad" : f.v("actividad") === "sin" ? "sin actividad" : "todos", tono: "primario" },
        { label: "En Odoo", valor: cuenta("confirmada"), tono: "positivo", onClick: () => filtrarEstado("confirmada"), activo: f.v("estado") === "confirmada" },
        { label: "Por enviar", valor: cuenta("por_enviar"), onClick: () => filtrarEstado("por_enviar"), activo: f.v("estado") === "por_enviar" },
        { label: "Propuestas", valor: cuenta("propuesta"), detalle: "por revisar", tono: "alerta", onClick: () => filtrarEstado("propuesta"), activo: f.v("estado") === "propuesta" },
        { label: "Sin clasificar", valor: cuenta("sin_clasificar", "solo_odoo"), tono: cuenta("sin_clasificar") ? "negativo" : "normal", onClick: () => filtrarEstado("sin_clasificar"), activo: f.v("estado") === "sin_clasificar" },
        { label: modo === "activo" ? "Errores" : "Simulados / errores", valor: modo === "activo" ? cuenta("error") : `${cuenta("simulada")} / ${cuenta("error")}`,
          tono: cuenta("error") ? "negativo" : "tenue", onClick: () => filtrarEstado(cuenta("error") ? "error" : "simulada") },
      ]} />

      <BarraLista
        busqueda={busq}
        onBusqueda={setBusq}
        placeholder="Buscar cliente, RIF o tipo del Excel…"
        filtros={<FiltrosLista filtros={f} resultados={visibles.length} />}
        contador={cargando ? undefined : contadorFiltrado(visibles.length, filas.length, true, "clientes")}
        acciones={<>{cols.selector}<BotonExportar onClick={exportar} total={ordenadas.length} soloIcono /></>}
      />

      {sel.size > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs" data-testid="clasificacion-masivo">
          <span className="font-medium">{sel.size} seleccionado{sel.size === 1 ? "" : "s"}</span>
          {sel.size < visibles.length && (
            <button type="button" className="text-primary hover:underline" onClick={() => setSel(new Set(visibles.map((x) => x.cliente_id)))}>Seleccionar los {visibles.length} filtrados</button>
          )}
          {editable ? (
            <>
              <Select value="" onValueChange={(v) => asignar([...sel], v)} disabled={!!ocupado}>
                <SelectTrigger className="h-7 w-[190px] text-xs" aria-label="Asignar tipo a los seleccionados"><SelectValue placeholder="Asignar tipo…" /></SelectTrigger>
                <SelectContent>{porCategoria.map(([cat, ts]) => (
                  <SelectGroup key={cat}><SelectLabel className="text-[11px]">{cat}</SelectLabel>
                    {ts.map((t) => <SelectItem key={t.id} value={t.id} className="text-xs">{t.tipo}{t.por_confirmar ? " (por confirmar)" : ""}</SelectItem>)}
                  </SelectGroup>
                ))}</SelectContent>
              </Select>
              <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={!nPropuestas || !!ocupado} onClick={() => confirmar([...sel])} data-testid="clasificacion-confirmar">
                <CheckCheck className="h-3.5 w-3.5" /> Confirmar propuestas ({nPropuestas})
              </Button>
              <Button size="sm" className="h-7 gap-1 text-xs" disabled={!nEnviables || !!ocupado} onClick={() => setConfirmarEnvio([...sel])} data-testid="clasificacion-enviar">
                {ocupado === "enviar" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Enviar a Odoo ({nEnviables})
              </Button>
              {nOdoo > 0 && (
                <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={!!ocupado} onClick={() => adoptar([...sel])} title="Asignar en GUDS el tipo que el cliente ya tiene en Odoo">
                  <Undo2 className="h-3.5 w-3.5" /> Tomar de Odoo ({nOdoo})
                </Button>
              )}
              <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs text-muted-foreground" disabled={!!ocupado} onClick={() => asignar([...sel], null)} title="Quita la asignación en GUDS (no toca Odoo)">
                Quitar asignación
              </Button>
            </>
          ) : <span className="text-muted-foreground">{soloLectura ? "Elige una empresa para asignar o enviar." : "Tu rol solo puede consultar."}</span>}
          <Button size="sm" variant="ghost" className="ml-auto h-7 w-7 p-0" onClick={() => setSel(new Set())} aria-label="Quitar selección"><X className="h-3.5 w-3.5" /></Button>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card">
        {cargando ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : visibles.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Ningún cliente coincide con la búsqueda o los filtros.
            {f.activos > 0 && <button type="button" className="ml-1 font-medium text-primary hover:underline" onClick={f.limpiar}>Limpiar filtros</button>}
          </div>
        ) : (
          <>
            <Table data-tabla="clasificacion-clientes">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <Checkbox checked={todasPagina} aria-label="Seleccionar la página"
                      onCheckedChange={(v) => setSel((s) => { const n = new Set(s); for (const x of pag.pageItems) { if (v) n.add(x.cliente_id); else n.delete(x.cliente_id); } return n; })} />
                  </TableHead>
                  <EncabezadoOrdenable clave="nombre" orden={orden} onOrdenar={alternar}>Cliente</EncabezadoOrdenable>
                  <EncabezadoOrdenable clave="estado" orden={orden} onOrdenar={alternar}>Estado</EncabezadoOrdenable>
                  <EncabezadoOrdenable clave="ventas" orden={orden} onOrdenar={alternar} alinear="derecha">Ventas Odoo</EncabezadoOrdenable>
                  <EncabezadoOrdenable clave="deuda" orden={orden} onOrdenar={alternar} alinear="derecha">Deuda</EncabezadoOrdenable>
                  <EncabezadoOrdenable clave="excel" orden={orden} onOrdenar={alternar}>Propuesta (Excel / Profit)</EncabezadoOrdenable>
                  <EncabezadoOrdenable clave="tipo" orden={orden} onOrdenar={alternar}>Asignado en GUDS</EncabezadoOrdenable>
                  <TableHead>En Odoo</TableHead>
                  <EncabezadoOrdenable clave="vendedor" orden={orden} onOrdenar={alternar}>Vendedor</EncabezadoOrdenable>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pag.pageItems.map((x) => (
                  <TableRow key={x.cliente_id} data-cliente={x.cliente_id} className={cn(sel.has(x.cliente_id) && "bg-primary/5")}>
                    <TableCell><Checkbox checked={sel.has(x.cliente_id)} onCheckedChange={(v) => alternarSel(x.cliente_id, !!v)} aria-label={`Seleccionar ${x.nombre}`} /></TableCell>
                    <TableCell className="min-w-[170px] max-w-[240px]">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <Link to={`/admin/clientes/${x.cliente_id}`} className="truncate font-medium hover:underline" title={x.nombre}>{x.nombre}</Link>
                        {x.es_empleado && <Badge variant="outline" className="px-1 py-0 text-[10px]">Empleado</Badge>}
                      </div>
                      <p className="truncate text-[11px] text-muted-foreground" title={x.vendedor ?? undefined}>{[soloLectura ? x.empresa : null, x.rif, x.vendedor].filter(Boolean).join(" · ")}</p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <button type="button" onClick={() => setDetalle(x)} title={`${ESTADOS[x.estado].ayuda}. Ver detalle`}
                        className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium", ESTADOS[x.estado].cls)} data-estado={x.estado}>
                        {x.estado === "confirmada" && <Check className="h-3 w-3" />}
                        {x.estado === "enviando" && <Loader2 className="h-3 w-3 animate-spin" />}
                        {ESTADOS[x.estado].label}
                        <Info className="h-3 w-3 opacity-50" />
                      </button>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">{x.ventas_odoo_usd > 0 ? usd(x.ventas_odoo_usd) : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className={cn("whitespace-nowrap text-right", x.deuda_usd > 0.01 && "text-destructive")}>{Math.abs(x.deuda_usd) > 0.01 ? usd(x.deuda_usd) : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="min-w-[150px] max-w-[200px] text-xs leading-tight">
                      <span className={cn("flex items-center gap-1", !x.excel_tipo_id && "text-muted-foreground")}
                        title={x.excel_detalle?.conflicto ? "El Excel tiene dos filas de este cliente con tipos distintos" : "Excel de finanzas"}>
                        {x.excel_detalle?.conflicto && <AlertTriangle className="h-3 w-3 shrink-0 text-warning" />}
                        <span className="truncate">{x.excel_texto ?? "No está en el Excel"}</span>
                      </span>
                      {x.profit_tipo && (
                        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground" title={`Profit: ${x.profit_tipo}${x.profit_segmento ? ` · ${x.profit_segmento}` : ""}`}>
                          Profit: {x.profit_tipo}{x.profit_categoria ? <span className="text-primary"> → {x.profit_categoria}</span> : null}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="min-w-[190px]">
                      {editable && x.empresa_id === empresaActiva?.id ? (
                        <Select value={x.tipo_id ?? ""} onValueChange={(v) => asignar([x.cliente_id], v)} disabled={ocupado === `asignar:${x.cliente_id}`}>
                          <SelectTrigger className={cn("h-7 text-xs", x.estado_asignacion === "propuesta" && "border-dashed")} aria-label={`Tipo de ${x.nombre}`}>
                            <SelectValue placeholder={x.profit_categoria ? `Elegir (${x.profit_categoria})…` : "Elegir tipo…"} />
                          </SelectTrigger>
                          <SelectContent>{porCategoria.map(([cat, ts]) => (
                            <SelectGroup key={cat}><SelectLabel className="text-[11px]">{cat}{x.profit_categoria === cat ? " · sugerida por Profit" : ""}</SelectLabel>
                              {ts.map((t) => <SelectItem key={t.id} value={t.id} className="text-xs">{t.tipo}{t.por_confirmar ? " (por confirmar)" : ""}</SelectItem>)}
                            </SelectGroup>
                          ))}</SelectContent>
                        </Select>
                      ) : <span className="text-xs">{x.tipo ?? <span className="text-muted-foreground">—</span>}</span>}
                      {x.tipo_id && (
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {[x.canal, x.categoria].filter(Boolean).join(" · ") || "sin categoría"}
                          {x.estado_asignacion === "propuesta" && x.origen ? ` · propuesta ${x.origen === "excel" ? "del Excel" : x.origen === "profit" ? "de Profit" : ""}` : ""}
                          {x.tipo_por_confirmar && <span className="text-warning"> · tipo por confirmar</span>}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[160px] text-[11px] leading-tight">
                      {x.odoo_tipo || x.odoo_canal || x.odoo_segmento ? (
                        <>
                          <span className="block truncate font-medium">{x.odoo_tipo ?? "—"}</span>
                          <span className="block truncate text-muted-foreground">{[x.odoo_canal, x.odoo_segmento].filter(Boolean).join(" · ") || "—"}</span>
                        </>
                      ) : <span className="text-muted-foreground">Vacío</span>}
                    </TableCell>
                    <TableCell className="max-w-[140px] truncate whitespace-nowrap text-xs text-muted-foreground">{x.vendedor ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <DataTablePagination pagination={pag} />
          </>
        )}
      </div>
      {!cargando && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          La clasificación oficial es la de Odoo (Industria, Canal y Segmento de contacto). Aquí se propone, se revisa y se envía; la sincronización la confirma.
          Profit sugiere solo lo fiable (CADENAS → Cadena Moderno, PARTICULAR → Particular, en Quirutec DISTRIBUIDOR/CLÍNICA → Clínica / Distribuidor).
        </p>
      )}

      <DetalleClasificacionDialog fila={detalle} onClose={() => setDetalle(null)} />

      <AlertDialog open={!!confirmarEnvio} onOpenChange={(o) => !o && setConfirmarEnvio(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enviar {nEnviables} cliente{nEnviables === 1 ? "" : "s"} a Odoo</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                {modo === "activo" ? (
                  <p>Se escribirá en Odoo la <b>Industria</b>, el <b>Canal</b> y el <b>Segmento de contacto</b> de cada cliente, y se crearán en Odoo los valores del catálogo que falten. Cada cliente queda con una nota interna "(GUDS)".</p>
                ) : (
                  <p><b>Modo prueba:</b> GUDS no escribe en Odoo. Registra, cliente por cliente, lo que enviaría (y qué valores del catálogo crearía) para revisarlo antes de activar la escritura.</p>
                )}
                <p className="text-xs text-muted-foreground">Solo se envían las asignaciones confirmadas de tipos completos; las propuestas sin revisar y los tipos por confirmar se omiten.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmarEnvio && enviar(confirmarEnvio)} data-testid="clasificacion-enviar-confirmar">{modo === "activo" ? "Enviar a Odoo" : "Simular envío"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
