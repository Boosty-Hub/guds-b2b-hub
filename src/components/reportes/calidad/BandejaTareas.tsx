import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, MapPin, RotateCcw, UserRound, X } from "lucide-react";
import { BarraLista } from "@/components/datos/BarraLista";
import { FiltrosLista, SIN_VALOR, contadorFiltrado, useFiltroEmpresa, useFiltros, type OpcionFiltro } from "@/components/datos/FiltrosLista";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { BotonExportar, exportarCSV } from "@/components/datos/tabla";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { usePagination } from "@/hooks/use-pagination";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/hooks/use-toast";
import { actualizarTareas, type Responsable } from "./datos";
import { CorregirDireccion } from "./CorregirDireccion";
import { DetalleTarea, EstadoEscritura, InsigniaEstado } from "./DetalleTarea";
import {
  ESTADO_CUADRE, ESTADO_TAREA, TIPOS, TIPOS_DIRECCION, datoActual, enlaceOdoo, montoTarea, nombreEntidad, textoBusqueda, tiposDe,
  type Grupo, type Tarea,
} from "./tipos";

const fmtN = (v: number) => v.toLocaleString("es-VE", { maximumFractionDigits: 0 });
const SIN_RESP = "_sin";

/**
 * Bandeja de tareas de un grupo (Calidad de datos o Cuadre Profit ↔ Odoo): contadores por tipo que bajan solos cuando la
 * sincronización trae el dato corregido, filtros en la URL, selección para asignar / explicar en lote, panel con el detalle
 * e historial, y la corrección asistida de dirección hacia Odoo.
 */
export function BandejaTareas({ grupo, tareas, responsables, puedeEditar, soloLectura, odooBase, cidOdoo, empresaNombre, recargar, refrescarUna, cabecera }: {
  grupo: Grupo;
  tareas: Tarea[];
  responsables: Responsable[];
  puedeEditar: boolean;
  soloLectura: boolean;
  odooBase: string | null;
  cidOdoo: (empresaId: string | null) => number | null;
  empresaNombre: (empresaId: string | null) => string;
  recargar: () => Promise<void>;
  refrescarUna: (id: string) => Promise<Tarea | null>;
  cabecera?: React.ReactNode;
}) {
  const { formatPrice } = useCurrency();
  const { toast } = useToast();
  const tipos = tiposDe(grupo);
  const nombreResp = useMemo(() => new Map(responsables.map((r) => [r.id, r.nombre])), [responsables]);

  // ── Filtros (en la URL) ──
  const filtroEmpresa = useFiltroEmpresa(tareas);
  const opcionesTipo: OpcionFiltro[] = tipos.map((k) => ({ valor: k, etiqueta: TIPOS[k].corto, n: tareas.filter((t) => t.tipo === k && t.estado === "pendiente").length }));
  const opcionesCuadre: OpcionFiltro[] = Object.entries(ESTADO_CUADRE).map(([k, e]) => ({ valor: k, etiqueta: e.texto, n: tareas.filter((t) => t.detalle.estado_cuadre === k).length }))
    .filter((o) => (o.n ?? 0) > 0);
  const opcionesResp: OpcionFiltro[] = [
    ...responsables.map((r) => ({ valor: r.id, etiqueta: r.nombre, n: tareas.filter((t) => t.responsable_id === r.id).length })).filter((o) => (o.n ?? 0) > 0),
    { valor: SIN_VALOR, etiqueta: "Sin responsable", n: tareas.filter((t) => !t.responsable_id).length },
  ];
  const f = useFiltros([
    { clave: "problema", etiqueta: "Problema", todos: "Todos los problemas", principal: true, opciones: opcionesTipo },
    { clave: "revision", etiqueta: "Estado", principal: true, porDefecto: "pendiente", opciones: [
      ...(["pendiente", "explicado", "corregido"] as const).map((k) => ({ valor: k, etiqueta: ESTADO_TAREA[k].texto, n: tareas.filter((t) => t.estado === k).length })),
      { valor: "todas", etiqueta: "Todos los estados", n: tareas.length },
    ] },
    grupo === "cuadre" && { clave: "cuadre", etiqueta: "Estado del cuadre", todos: "Todos los estados del cuadre", opciones: opcionesCuadre },
    { clave: "responsable", etiqueta: "Responsable", todos: "Todos los responsables", opciones: opcionesResp },
    filtroEmpresa,
  ]);
  const [q, setQ] = useState("");

  // Base de los contadores: filtros de empresa, responsable y estado del cuadre (no el problema ni el estado de la tarea)
  const base = useMemo(() => tareas.filter((t) =>
    (!f.v("empresa") || (f.v("empresa") === SIN_VALOR ? !t.empresa_id : t.empresa_id === f.v("empresa")))
    && (!f.v("responsable") || (f.v("responsable") === SIN_VALOR ? !t.responsable_id : t.responsable_id === f.v("responsable")))
    && (!f.v("cuadre") || t.detalle.estado_cuadre === f.v("cuadre"))), [tareas, f.firma]);   // eslint-disable-line react-hooks/exhaustive-deps
  const filtradas = useMemo(() => {
    const txt = q.trim().toLowerCase();
    return base.filter((t) => (!f.v("problema") || t.tipo === f.v("problema"))
      && (f.v("revision") === "todas" || t.estado === f.v("revision"))
      && (!txt || textoBusqueda(t).includes(txt)))
      .sort((a, b) => tipos.indexOf(a.tipo) - tipos.indexOf(b.tipo) || montoTarea(b) - montoTarea(a) || nombreEntidad(a).localeCompare(nombreEntidad(b), "es"));
  }, [base, q, f.firma, tipos]);   // eslint-disable-line react-hooks/exhaustive-deps
  const pg = usePagination(filtradas, 50, `${f.firma}|${q}`);

  // ── Selección ──
  const [sel, setSel] = useState<Set<string>>(new Set());
  useEffect(() => { setSel(new Set()); }, [f.firma, q, grupo]);
  const visiblesIds = filtradas.map((t) => t.id);
  const todasSel = visiblesIds.length > 0 && visiblesIds.every((id) => sel.has(id));
  const algunaSel = visiblesIds.some((id) => sel.has(id));
  const alternar = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const seleccionadas = filtradas.filter((t) => sel.has(t.id));
  const editableT = (t: Tarea) => puedeEditar && !(soloLectura && t.empresa_id);
  const motivoNoEditable = !puedeEditar ? "Tu rol solo puede consultar la bandeja" : soloLectura ? "Modo consulta («Ambas»): elige GUDS o Quirutec en el menú superior para trabajar las tareas" : null;

  // ── Detalle y corrección ──
  const [abierta, setAbierta] = useState<string | null>(null);
  const tareaAbierta = tareas.find((t) => t.id === abierta) ?? null;
  const [corrigiendo, setCorrigiendo] = useState<Tarea | null>(null);
  const seguimiento = useRef<number | null>(null);
  useEffect(() => () => { if (seguimiento.current) window.clearInterval(seguimiento.current); }, []);

  // Tras enviar a Odoo: se sigue la escritura hasta que termina; si se aplicó, la base reevalúa y la tarea se cierra sola
  const seguir = useCallback((tareaId: string) => {
    if (seguimiento.current) window.clearInterval(seguimiento.current);
    let vueltas = 0;
    seguimiento.current = window.setInterval(async () => {
      vueltas++;
      const t = await refrescarUna(tareaId);
      const e = t?.escritura?.estado;
      if (!t || vueltas > 40 || (e && !["pendiente", "procesando"].includes(e))) {
        if (seguimiento.current) window.clearInterval(seguimiento.current);
        seguimiento.current = null;
        await recargar();
        if (e === "error") toast({ title: "Odoo no aceptó el cambio", description: t?.escritura?.error ?? "", variant: "destructive" });
        else if (e === "hecha") toast({ title: "Corregido en Odoo", description: t?.estado === "corregido" ? "La tarea quedó cerrada." : "La tarea se cierra en la próxima revisión." });
      }
    }, 3000);
  }, [refrescarUna, recargar, toast]);

  // ── Acciones en lote ──
  const [lote, setLote] = useState<"explicar" | null>(null);
  const [comLote, setComLote] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const enLote = async (cambios: Parameters<typeof actualizarTareas>[1], ids = seleccionadas.filter(editableT).map((t) => t.id)) => {
    if (!ids.length) { toast({ title: "Nada que cambiar", description: "Las tareas elegidas no se pueden editar desde aquí.", variant: "destructive" }); return; }
    setOcupado(true);
    try {
      const n = await actualizarTareas(ids, cambios);
      toast({ title: `${n} ${n === 1 ? "tarea actualizada" : "tareas actualizadas"}` });
      setSel(new Set()); setLote(null); setComLote("");
      await recargar();
    } catch (e) {
      toast({ title: "No se pudo actualizar", description: (e as Error).message, variant: "destructive" });
    } finally { setOcupado(false); }
  };

  const exportar = () => exportarCSV(`bandeja-${grupo}`, filtradas, [
    { titulo: "Empresa", valor: (t) => empresaNombre(t.empresa_id) },
    { titulo: "Problema", valor: (t) => TIPOS[t.tipo]?.titulo ?? t.tipo },
    { titulo: "Registro", valor: (t) => nombreEntidad(t) },
    { titulo: "Dato", valor: (t) => datoActual(t, formatPrice) },
    ...(grupo === "cuadre" ? [{ titulo: "Estado del cuadre", valor: (t: Tarea) => ESTADO_CUADRE[String(t.detalle.estado_cuadre)]?.texto ?? null }] : []),
    { titulo: "Monto USD", valor: (t) => montoTarea(t) },
    { titulo: "Estado", valor: (t) => ESTADO_TAREA[t.estado].texto },
    { titulo: "Responsable", valor: (t) => (t.responsable_id ? nombreResp.get(t.responsable_id) ?? null : null) },
    { titulo: "Comentario", valor: (t) => t.comentario },
    { titulo: "Detectada", valor: (t) => t.detectada_at.slice(0, 10) },
    { titulo: "Cerrada", valor: (t) => t.cerrada_at?.slice(0, 10) ?? null },
    { titulo: "Escritura a Odoo", valor: (t) => t.escritura?.estado ?? null },
    { titulo: "RIF", valor: (t) => (t.detalle.rif as string) ?? null },
    { titulo: "Número", valor: (t) => (t.detalle.numero as string) ?? null },
    { titulo: "Fecha", valor: (t) => ((t.detalle.fecha ?? t.detalle.ultima_compra ?? t.detalle.ultima_venta) as string) ?? null },
    { titulo: "Total Odoo USD", valor: (t) => (t.detalle.total_odoo_usd as number) ?? null },
    { titulo: "Total Profit USD", valor: (t) => (t.detalle.total_profit_usd as number) ?? null },
    { titulo: "Diferencia USD", valor: (t) => (t.detalle.diferencia_usd as number) ?? null },
    { titulo: "Id Odoo", valor: (t) => (t.detalle.odoo_id as number) ?? null },
  ]);

  // ── Contadores por tipo (pendientes; bajan cuando se corrige o se explica) ──
  const kpis = tipos.map((k) => {
    const de = base.filter((t) => t.tipo === k);
    const pend = de.filter((t) => t.estado === "pendiente").length;
    const exp = de.filter((t) => t.estado === "explicado").length;
    const cor = de.filter((t) => t.estado === "corregido").length;
    return {
      label: TIPOS[k].corto, valor: fmtN(pend), tono: pend ? ("alerta" as const) : ("positivo" as const), titulo: `${TIPOS[k].ayuda}. Pendientes de ${de.length}.`,
      detalle: de.length ? `${exp ? `${fmtN(exp)} explic. · ` : ""}${cor ? `${fmtN(cor)} corr. · ` : ""}de ${fmtN(de.length)}` : "nada detectado",
      activo: f.v("problema") === k, onClick: () => f.setVarios({ problema: f.v("problema") === k ? "" : k }),
    };
  });

  const ver = (t: Tarea) => setAbierta(t.id);
  const hayDireccion = grupo === "calidad";

  return (
    <div className="min-w-0">
      {cabecera}
      <div className="hidden sm:block">
        <KpiStrip className={grupo === "calidad" ? "lg:grid-flow-row lg:grid-cols-6 lg:auto-cols-auto" : undefined} items={kpis} />
      </div>
      {/* Móvil: los contadores en una fila desplazable (la tira completa empuja la lista fuera de la pantalla) */}
      <div className="-mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] sm:hidden" role="group" aria-label="Pendientes por problema">
        {kpis.map((k) => (
          <button key={k.label} type="button" onClick={k.onClick} aria-pressed={k.activo} title={k.titulo}
            className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${k.activo ? "border-primary bg-primary/10 text-primary" : "border-border bg-card"}`}>
            <span>{k.label}</span><span className={`font-semibold tabular-nums ${k.tono === "alerta" ? "text-warning" : "text-success"}`}>{k.valor}</span>
          </button>
        ))}
      </div>

      <BarraLista busqueda={q} onBusqueda={setQ} placeholder={grupo === "cuadre" ? "Buscar documento, cliente, RIF…" : "Buscar cliente, producto, RIF, número…"}
        filtros={<FiltrosLista filtros={f} resultados={filtradas.length} />}
        contador={contadorFiltrado(filtradas.length, tareas.length, true, "tareas")}
        acciones={<BotonExportar soloIcono onClick={exportar} total={filtradas.length} />} />

      {algunaSel && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-xs" role="region" aria-label="Acciones sobre la selección">
          <span className="font-medium">{seleccionadas.length} {seleccionadas.length === 1 ? "seleccionada" : "seleccionadas"}</span>
          <Select value="" disabled={!!motivoNoEditable || ocupado} onValueChange={(v) => enLote({ responsable: v === SIN_RESP ? null : v })}>
            <SelectTrigger className="h-7 w-44 text-xs" aria-label="Asignar responsable"><UserRound className="mr-1 h-3.5 w-3.5" /><SelectValue placeholder="Asignar a…" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={SIN_RESP} className="text-xs">Sin responsable</SelectItem>
              {responsables.map((r) => <SelectItem key={r.id} value={r.id} className="text-xs">{r.nombre}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" className="h-7 text-xs" disabled={!!motivoNoEditable || ocupado || !seleccionadas.some((t) => t.estado === "pendiente")} onClick={() => setLote("explicar")}>
            <CheckCircle2 className="mr-1 h-3.5 w-3.5" />Explicar…
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!!motivoNoEditable || ocupado || !seleccionadas.some((t) => t.estado === "explicado")}
            onClick={() => enLote({ estado: "pendiente" }, seleccionadas.filter((t) => t.estado === "explicado" && editableT(t)).map((t) => t.id))}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" />Volver a pendiente
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSel(new Set())}><X className="mr-1 h-3.5 w-3.5" />Quitar selección</Button>
          {motivoNoEditable && <span className="text-muted-foreground">{motivoNoEditable}.</span>}
          {ocupado && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {filtradas.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            {tareas.length === 0 ? "Nada detectado." : f.v("revision") === "pendiente" && !q && !f.v("problema") ? "Nada pendiente: todo está corregido o explicado." : "Ninguna tarea con estos filtros."}
          </p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8 pr-0">
                    <Checkbox aria-label="Seleccionar todas las tareas filtradas" checked={todasSel ? true : algunaSel ? "indeterminate" : false}
                      onCheckedChange={(v) => setSel(v ? new Set(visiblesIds) : new Set())} />
                  </TableHead>
                  <TableHead>Registro</TableHead>
                  <TableHead className="hidden md:table-cell">Problema</TableHead>
                  {soloLectura && <TableHead className="hidden lg:table-cell">Empresa</TableHead>}
                  <TableHead className="hidden sm:table-cell">Responsable</TableHead>
                  <TableHead className="hidden sm:table-cell">Estado</TableHead>
                  <TableHead className="w-0 text-right"><span className="sr-only">Acciones</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pg.pageItems.map((t) => {
                  const url = enlaceOdoo(odooBase, t, cidOdoo(t.empresa_id));
                  const asistida = hayDireccion && TIPOS_DIRECCION.includes(t.tipo) && t.estado !== "corregido";
                  const enviando = t.escritura && ["pendiente", "procesando"].includes(t.escritura.estado);
                  return (
                    <TableRow key={t.id} data-state={sel.has(t.id) ? "selected" : undefined} className="cursor-pointer" onClick={() => ver(t)}>
                      <TableCell className="pr-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox aria-label={`Seleccionar ${nombreEntidad(t)}`} checked={sel.has(t.id)} onCheckedChange={() => alternar(t.id)} />
                      </TableCell>
                      <TableCell className="max-w-0 py-[var(--celda-py)]">
                        <button type="button" className="block w-full min-w-0 text-left" onClick={(e) => { e.stopPropagation(); ver(t); }}>
                          <span className="block truncate font-medium">{nombreEntidad(t)}</span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            <span className="md:hidden">{TIPOS[t.tipo]?.corto} · </span>{datoActual(t, formatPrice)}
                          </span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 sm:hidden">
                            <InsigniaEstado estado={t.estado} />{t.escritura && t.estado !== "corregido" && <EstadoEscritura tarea={t} />}
                          </span>
                        </button>
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-muted-foreground md:table-cell">{TIPOS[t.tipo]?.corto ?? t.tipo}</TableCell>
                      {soloLectura && <TableCell className="hidden whitespace-nowrap lg:table-cell">{empresaNombre(t.empresa_id)}</TableCell>}
                      <TableCell className="hidden max-w-[10rem] truncate sm:table-cell">{t.responsable_id ? nombreResp.get(t.responsable_id) ?? "—" : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="hidden whitespace-nowrap sm:table-cell">
                        <span className="flex flex-col items-start gap-0.5">
                          <InsigniaEstado estado={t.estado} />
                          {t.escritura && t.estado !== "corregido" && <EstadoEscritura tarea={t} />}
                          {t.estado !== "pendiente" && t.comentario && <span className="hidden max-w-[12rem] truncate text-[11px] text-muted-foreground xl:block" title={t.comentario}>{t.comentario}</span>}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                        <span className="inline-flex items-center gap-1">
                          {asistida && (
                            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={!editableT(t) || !!enviando}
                              title={motivoNoEditable ?? "Corregir la dirección en Odoo"} onClick={() => setCorrigiendo(t)}>
                              <MapPin className="h-3.5 w-3.5 sm:mr-1" /><span className="hidden sm:inline">Corregir</span>
                            </Button>
                          )}
                          {url && (
                            <Button size="icon" variant="ghost" className="h-7 w-7" asChild title="Abrir en Odoo">
                              <a href={url} target="_blank" rel="noreferrer" aria-label={`Abrir ${nombreEntidad(t)} en Odoo`}><ExternalLink className="h-3.5 w-3.5" /></a>
                            </Button>
                          )}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <DataTablePagination pagination={pg} />
          </>
        )}
      </div>

      <DetalleTarea tarea={tareaAbierta} abierta={!!tareaAbierta} onCerrar={() => setAbierta(null)} responsables={responsables}
        puedeEditar={puedeEditar} soloLectura={soloLectura} odooBase={odooBase} cidOdoo={cidOdoo} empresaNombre={empresaNombre}
        onCambio={(id) => { refrescarUna(id); }} onCorregir={(t) => setCorrigiendo(t)} />

      <CorregirDireccion tarea={corrigiendo} abierta={!!corrigiendo} onCerrar={() => setCorrigiendo(null)}
        onEnviada={(id) => { setCorrigiendo(null); refrescarUna(id); seguir(id); }} />

      <Dialog open={lote === "explicar"} onOpenChange={(v) => !v && !ocupado && setLote(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Marcar como explicadas</DialogTitle>
            <DialogDescription>
              {seleccionadas.filter((t) => t.estado === "pendiente").length} tareas pendientes de la selección. El comentario queda en cada una, con tu nombre y la fecha.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="calidad-lote-com" className="text-xs">Explicación *</Label>
            <Textarea id="calidad-lote-com" value={comLote} onChange={(e) => setComLote(e.target.value)} rows={3} maxLength={2000} className="text-[13px]"
              placeholder="P. ej.: ajuste cambiario de Odoo, no afecta el saldo" />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setLote(null)} disabled={ocupado}>Cancelar</Button>
            <Button disabled={ocupado || !comLote.trim()}
              onClick={() => enLote({ estado: "explicado", comentario: comLote }, seleccionadas.filter((t) => t.estado === "pendiente" && editableT(t)).map((t) => t.id))}>
              {ocupado && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Marcar explicadas
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

