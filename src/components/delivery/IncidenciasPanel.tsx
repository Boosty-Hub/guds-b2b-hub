import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarraLista } from "@/components/datos/BarraLista";
import { FiltrosLista, useFiltros, useFiltroEmpresa, opcionesDe, opcionesTexto, coincide, coincideTexto, enRango, contadorFiltrado } from "@/components/datos/FiltrosLista";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { usePagination } from "@/hooks/use-pagination";
import { CalendarClock, CheckCircle2, Eye, Loader2, PackageCheck, UserPlus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { diaCaracas, fechaHora } from "@/components/delivery/fechas";
import { ESTADO_ENTREGA, MOTIVOS_LINEA, etiquetaMotivo, fmtCantidad, fmtDia, siguienteDiaHabil } from "@/components/delivery/entregas";
import { EstadoEntregaBadge, Evidencia } from "@/components/delivery/DetalleEntregaDialog";
import { EstadoTransferencia } from "@/components/inventario/EstadoTransferencia";
import {
  ACCION_INCIDENCIA, ESTADO_INCIDENCIA, puedeRecolar, unidadesDevolucion, type Incidencia,
} from "@/components/delivery/seguimiento";

export interface RepartidorOpcion { id: string; nombre: string; apellido: string | null; empresas: string[] }
type Pestana = "decidir" | "seguimiento" | "devolucion" | "resueltas" | "confirmadas";

const TIPO_INCIDENCIA: Record<Incidencia["tipo"], string> = { incompleta: "Incompleta", rechazada: "Rechazada", reprogramada: "Reprogramada" };

function EstadoIncidencia({ i }: { i: Incidencia }) {
  const e = ESTADO_INCIDENCIA[i.estado];
  return <Badge variant="outline" className={`whitespace-nowrap font-normal ${e.cls}`}>{e.label}</Badge>;
}

function DevolucionBadge({ i }: { i: Incidencia }) {
  if (i.devolucion === "no_aplica") return <span className="text-xs text-muted-foreground">No aplica</span>;
  if (i.devolucion === "pendiente") {
    return <Badge variant="outline" className="whitespace-nowrap border-amber-300 bg-amber-50 font-normal text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
      Por confirmar · {fmtCantidad(unidadesDevolucion(i.devolucion_lineas))} u.</Badge>;
  }
  const falta = unidadesDevolucion(i.devolucion_lineas) - unidadesDevolucion(i.devolucion_lineas, "recibida");
  return (
    <span className="flex flex-col items-start gap-0.5">
      <Badge variant="outline" className={`whitespace-nowrap font-normal ${falta > 0 ? "border-red-300 bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" : "border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200"}`}>
        {falta > 0 ? `Recibida con faltante (${fmtCantidad(falta)} u.)` : "Recibida en almacén"}
      </Badge>
      <span className="text-[11px] text-muted-foreground">{i.devolucion_por} · {fechaHora(i.devolucion_at)}</span>
    </span>
  );
}

/** Seguimiento de la incidencia: fecha en la cola, entrega nueva o resolución. */
function Seguimiento({ i }: { i: Incidencia }) {
  return (
    <span className="flex flex-col items-start gap-0.5">
      <EstadoIncidencia i={i} />
      <span className="text-[11px] text-muted-foreground">
        {i.estado === "reprogramada" && i.fecha_objetivo ? `Vuelve a la cola el ${fmtDia(i.fecha_objetivo)}` : null}
        {i.estado === "reasignada" && i.nueva ? `${i.nueva.repartidor ?? "Repartidor"} · ${ESTADO_ENTREGA[i.nueva.estado]?.label ?? i.nueva.estado}` : null}
        {i.estado === "resuelta" ? `${i.resuelta_por ?? ""} · ${fechaHora(i.resuelta_at)}` : null}
        {i.estado === "abierta" && i.activa ? `Asignada otra vez a ${i.activa.repartidor ?? "un repartidor"}` : null}
      </span>
    </span>
  );
}

/** Incidencias de entrega (D6): incompletas, rechazadas y reprogramadas con su motivo y evidencia. Administración
 *  reprograma (vuelve a la cola con fecha), reasigna o marca resuelta con nota; almacén (o administración) confirma la
 *  devolución de lo no entregado con cantidades por producto. Nada de esto se escribe en Odoo. */
export function IncidenciasPanel({ incidencias, cargando, repartidores = [], modo = "admin", puedeDecidir, puedeConfirmar, soloLectura, onCambio, abrirId }: {
  incidencias: Incidencia[];
  cargando: boolean;
  repartidores?: RepartidorOpcion[];
  /** admin: todas las pestañas · almacen: solo las devoluciones (para el rol Almacén) */
  modo?: "admin" | "almacen";
  puedeDecidir: boolean;
  puedeConfirmar: boolean;
  soloLectura?: boolean;
  onCambio: () => void;
  abrirId?: string | null;
}) {
  const [q, setQ] = useState("");
  // Pestaña (?pestana=) y filtros en la URL: se comparten y sobreviven a recargar
  const [params, setParams] = useSearchParams();
  const tabInicial: Pestana = modo === "almacen" ? "devolucion" : "decidir";
  const PESTANAS_VALIDAS: Pestana[] = modo === "almacen" ? ["devolucion", "confirmadas"] : ["decidir", "seguimiento", "devolucion", "resueltas"];
  const tab = (PESTANAS_VALIDAS.includes(params.get("pestana") as Pestana) ? params.get("pestana") : tabInicial) as Pestana;
  const setTab = (t: Pestana) => setParams((p) => { const n = new URLSearchParams(p); if (t === tabInicial) n.delete("pestana"); else n.set("pestana", t); return n; }, { replace: true });
  const [detalle, setDetalle] = useState<Incidencia | null>(null);

  useEffect(() => { setDetalle((d) => (d ? incidencias.find((x) => x.id === d.id) ?? null : d)); }, [incidencias]);
  // Enlace directo (?incidencia=<id>): se abre una sola vez, no en cada recarga
  const abierta = useRef<string | null>(null);
  useEffect(() => {
    if (!abrirId || abierta.current === abrirId) return;
    const x = incidencias.find((i) => i.id === abrirId || i.entrega_id === abrirId);
    if (x) { abierta.current = abrirId; setDetalle(x); }
  }, [abrirId, incidencias]);

  const enPestana = (i: Incidencia, t: Pestana) => {
    switch (t) {
      case "decidir": return i.estado === "abierta";
      case "seguimiento": return i.estado === "reprogramada" || i.estado === "reasignada";
      case "devolucion": return i.devolucion === "pendiente";
      case "resueltas": return i.estado === "resuelta";
      case "confirmadas": return i.devolucion === "confirmada";
    }
  };
  const pestanas: { v: Pestana; label: string }[] = modo === "almacen"
    ? [{ v: "devolucion", label: "Por confirmar" }, { v: "confirmadas", label: "Confirmadas" }]
    : [{ v: "decidir", label: "Por decidir" }, { v: "seguimiento", label: "En la cola / reasignadas" }, { v: "devolucion", label: "Devolución pendiente" }, { v: "resueltas", label: "Resueltas" }];
  const conteo = (t: Pestana) => incidencias.filter((i) => enPestana(i, t)).length;

  // ---- Filtros: resultado, repartidor, fecha de cierre, zona (ciudad) y empresa en «Ambas» ----
  const enTab = useMemo(() => incidencias.filter((i) => enPestana(i, tab)), [incidencias, tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const filtroEmpresa = useFiltroEmpresa(enTab);
  const f = useFiltros([
    modo === "admin" && { clave: "resultado", etiqueta: "Resultado", todos: "Todos", principal: true, opciones: opcionesDe(enTab, (i) => i.tipo, (_i, v) => TIPO_INCIDENCIA[v as Incidencia["tipo"]] ?? v) },
    { clave: "repartidor", etiqueta: "Repartidor", principal: true, opciones: opcionesDe(enTab, (i) => i.repartidor_id, (i) => i.repartidor ?? "—", "Sin repartidor") },
    { clave: "fecha", etiqueta: "Cierre", tipo: "fecha", principal: true },
    { clave: "ciudad", etiqueta: "Zona (ciudad)", todos: "Todas las ciudades", opciones: opcionesTexto(enTab, (i) => i.ciudad, "Sin ciudad") },
    filtroEmpresa,
  ]);
  const vista = useMemo(() => {
    const t = q.trim().toLowerCase();
    return enTab.filter((i) => coincide(i.tipo, f.v("resultado")) && coincide(i.repartidor_id, f.v("repartidor")) && enRango(i.fecha_cierre, f.v("fecha"))
      && coincideTexto(i.ciudad, f.v("ciudad")) && (!filtroEmpresa || coincide(i.empresa_id, f.v("empresa")))
      && (!t || [i.numero, i.cliente, i.repartidor, i.origen, i.motivo_detalle, etiquetaMotivo(i.motivo_codigo)].some((v) => (v || "").toLowerCase().includes(t))));
  }, [enTab, f.firma, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const pag = usePagination(vista, 25, `${f.firma}&pestana=${tab}`);

  const resultado = (i: Incidencia) => {
    const motivos = i.tipo === "incompleta"
      ? [...new Set((i.lineas ?? []).filter((l) => l.motivo).map((l) => etiquetaMotivo(l.motivo, MOTIVOS_LINEA)))].join(", ")
      : [etiquetaMotivo(i.motivo_codigo), i.motivo_detalle].filter((x) => x && x !== "—").join(" — ");
    return (
      <span className="flex flex-col items-start gap-0.5">
        <EstadoEntregaBadge estado={i.tipo} />
        <span className="max-w-[240px] truncate text-[11px] text-muted-foreground" title={motivos}>{motivos || "—"}</span>
        <span className="text-[11px] text-muted-foreground">{i.repartidor ?? "—"} · {fechaHora(i.fecha_cierre)}</span>
      </span>
    );
  };

  return (
    <div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as Pestana)}>
        <BarraLista
          pestanas={<TabsList className="h-auto flex-wrap justify-start">{pestanas.map((p) => <TabsTrigger key={p.v} value={p.v}>{p.label} ({conteo(p.v)})</TabsTrigger>)}</TabsList>}
          busqueda={q} onBusqueda={setQ} placeholder="Buscar documento, cliente, repartidor…"
          filtros={<FiltrosLista filtros={f} resultados={vista.length} />}
          contador={cargando ? undefined : contadorFiltrado(vista.length, enTab.length, f.activos || !!q.trim(), modo === "almacen" ? "devoluciones" : "incidencias")}
        />
      </Tabs>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {cargando && !incidencias.length ? <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        : vista.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            {tab === "decidir" ? "No hay incidencias por decidir. Cuando una entrega se cierra incompleta, rechazada o reprogramada aparece aquí."
              : tab === "devolucion" ? "No hay mercancía por confirmar en el almacén." : "No hay incidencias con este filtro."}
          </div>
        ) : (
          <Table data-tabla="incidencias">
            <TableHeader><TableRow>
              <TableHead>Documento</TableHead><TableHead>Cliente</TableHead><TableHead>Resultado</TableHead>
              {modo === "admin" && <TableHead>Seguimiento</TableHead>}
              <TableHead>Devolución</TableHead><TableHead className="text-right">Acción</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {pag.pageItems.map((i) => (
                <TableRow key={i.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setDetalle(i)} data-incidencia={i.id}>
                  <TableCell className="whitespace-nowrap">
                    <span className="font-mono text-xs text-primary">{i.numero ?? "—"}</span>
                    <span className="block text-[11px] text-muted-foreground">{i.empresa ?? ""}{i.origen ? ` · ${i.origen}` : ""}</span>
                    {i.intento > 1 && <span className="block text-[11px] text-muted-foreground">{i.intento}.º intento</span>}
                  </TableCell>
                  <TableCell><span className="block max-w-[200px] truncate font-medium" title={i.cliente ?? ""}>{i.cliente ?? "—"}</span>
                    <span className="block max-w-[200px] truncate text-[11px] text-muted-foreground">{i.ciudad ?? ""}</span></TableCell>
                  <TableCell>{resultado(i)}</TableCell>
                  {modo === "admin" && <TableCell><Seguimiento i={i} /></TableCell>}
                  <TableCell><DevolucionBadge i={i} /></TableCell>
                  <TableCell className="whitespace-nowrap text-right" onClick={(ev) => ev.stopPropagation()}>
                    <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => setDetalle(i)}>
                      {i.devolucion === "pendiente" && puedeConfirmar ? <><PackageCheck className="h-3.5 w-3.5" />Confirmar</> : <><Eye className="h-3.5 w-3.5" />Ver</>}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {vista.length > 0 && <DataTablePagination pagination={pag} />}
      </div>

      <IncidenciaDialog incidencia={detalle} onClose={() => setDetalle(null)} repartidores={repartidores} modo={modo}
        puedeDecidir={puedeDecidir} puedeConfirmar={puedeConfirmar} soloLectura={soloLectura} onCambio={onCambio} />
    </div>
  );
}

type Accion = null | "reprogramar" | "reasignar" | "resolver" | "devolucion";

const Dato = ({ etiqueta, children, ancho }: { etiqueta: string; children: React.ReactNode; ancho?: boolean }) => (
  <div className={`min-w-0 ${ancho ? "col-span-2 sm:col-span-3" : ""}`}>
    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{etiqueta}</p>
    <div className="break-words text-sm">{children}</div>
  </div>
);

/** Detalle de una incidencia con su evidencia, lo que regresa al almacén, la bitácora y las acciones. */
export function IncidenciaDialog({ incidencia: i, onClose, repartidores, modo, puedeDecidir, puedeConfirmar, soloLectura, onCambio }: {
  incidencia: Incidencia | null; onClose: () => void; repartidores: RepartidorOpcion[]; modo: "admin" | "almacen";
  puedeDecidir: boolean; puedeConfirmar: boolean; soloLectura?: boolean; onCambio: () => void;
}) {
  const { toast } = useToast();
  const hoy = diaCaracas();
  const [accion, setAccion] = useState<Accion>(null);
  const [fecha, setFecha] = useState(siguienteDiaHabil());
  const [nota, setNota] = useState("");
  const [rep, setRep] = useState("");
  const [recibidas, setRecibidas] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    setAccion(null); setNota(""); setRep(i?.repartidor_id ?? ""); setFecha(i?.fecha_objetivo && i.fecha_objetivo >= hoy ? i.fecha_objetivo : siguienteDiaHabil());
    setRecibidas(Object.fromEntries((i?.devolucion_lineas ?? []).map((l) => [l.item_id, String(l.esperada)])));
  }, [i?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!i) return <Dialog open={false} />;
  const decidible = modo === "admin" && puedeDecidir && i.estado !== "resuelta";
  const recolable = decidible && puedeRecolar(i);
  const repsEmpresa = repartidores.filter((r) => !r.empresas.length || !i.empresa_id || r.empresas.includes(i.empresa_id));
  const faltante = (i.devolucion_lineas ?? []).some((l) => Number(recibidas[l.item_id] ?? l.esperada) < Number(l.esperada));

  const llamar = async (fn: string, args: Record<string, unknown>, ok: string) => {
    setGuardando(true);
    const { error } = await supabase.rpc(fn, args);
    setGuardando(false);
    if (error) { toast({ title: "No se pudo guardar", description: error.message, variant: "destructive" }); return false; }
    toast({ title: ok, description: i.numero ?? undefined });
    setAccion(null);
    onCambio();
    return true;
  };
  const guardar = () => {
    if (accion === "reprogramar") return llamar("reprogramar_incidencia", { p_id: i.id, p_fecha: fecha, p_nota: nota.trim() || null }, `Vuelve a la cola el ${fmtDia(fecha)}`);
    if (accion === "reasignar") return llamar("reasignar_incidencia", { p_id: i.id, p_repartidor_id: rep, p_fecha: fecha || null }, "Documento asignado de nuevo");
    if (accion === "resolver") return llamar("resolver_incidencia", { p_id: i.id, p_nota: nota }, "Incidencia resuelta");
    if (accion === "devolucion") {
      return llamar("confirmar_devolucion_entrega", {
        p_id: i.id, p_lineas: (i.devolucion_lineas ?? []).map((l) => ({ item_id: l.item_id, recibida: Number(recibidas[l.item_id] ?? 0) })), p_nota: nota.trim() || null,
      }, "Devolución confirmada en almacén");
    }
  };
  const valido = accion === "reprogramar" ? !!fecha && fecha >= hoy
    : accion === "reasignar" ? !!rep
    : accion === "resolver" ? nota.trim().length >= 3
    : accion === "devolucion" ? (i.devolucion_lineas ?? []).every((l) => { const v = Number(recibidas[l.item_id]); return recibidas[l.item_id] !== "" && Number.isFinite(v) && v >= 0 && v <= Number(l.esperada); }) && (!faltante || nota.trim().length >= 3)
    : false;

  return (
    <Dialog open={!!i} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl" data-dialogo="incidencia">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
            <span className="font-mono">{i.numero ?? "Entrega"}</span>
            <EstadoEntregaBadge estado={i.tipo} />
            <EstadoIncidencia i={i} />
            {i.estado_odoo && <EstadoTransferencia estado={i.estado_odoo} />}
          </DialogTitle>
          <DialogDescription>{i.cliente ?? "—"}{i.origen ? ` · ${i.origen}` : ""}{i.empresa ? ` · ${i.empresa}` : ""}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Dato etiqueta="Repartidor">{i.repartidor ?? "—"}</Dato>
          <Dato etiqueta="Cerrada">{fechaHora(i.fecha_cierre)}</Dato>
          <Dato etiqueta="Intento">{i.intento > 0 ? `${i.intento}.º` : "—"}</Dato>
          {(i.motivo_codigo || i.motivo_detalle) && <Dato etiqueta="Motivo" ancho>{[etiquetaMotivo(i.motivo_codigo), i.motivo_detalle].filter((x) => x && x !== "—").join(" — ")}</Dato>}
          {i.reprogramada_para && <Dato etiqueta="El repartidor la reprogramó para">{fmtDia(i.reprogramada_para)}</Dato>}
          {i.fecha_objetivo && i.estado !== "resuelta" && <Dato etiqueta="Vuelve a la cola">{fmtDia(i.fecha_objetivo)}</Dato>}
          {i.receptor_nombre && <Dato etiqueta={i.tipo === "rechazada" ? "Rechazó" : "Recibió"}>{i.receptor_nombre}</Dato>}
          {i.activa && <Dato etiqueta="Asignada otra vez">{i.activa.repartidor ?? "—"} · {ESTADO_ENTREGA[i.activa.estado]?.label ?? i.activa.estado}{i.activa.fecha_ruta ? ` · ruta del ${fmtDia(i.activa.fecha_ruta)}` : ""}</Dato>}
          {i.nueva && !i.activa && <Dato etiqueta="Entrega nueva">{i.nueva.repartidor ?? "—"} · {ESTADO_ENTREGA[i.nueva.estado]?.label ?? i.nueva.estado}</Dato>}
          {i.notas && <Dato etiqueta="Notas del repartidor" ancho>{i.notas}</Dato>}
          {i.nota && <Dato etiqueta="Resolución" ancho>{i.nota} <span className="text-muted-foreground">· {i.resuelta_por} · {fechaHora(i.resuelta_at)}</span></Dato>}
        </div>

        {i.tipo === "incompleta" && !!i.lineas?.length && (
          <div className="rounded-lg border border-border">
            <Table containerClassName="max-h-60">
              <TableHeader><TableRow><TableHead>Producto</TableHead><TableHead className="text-right">Llevaba</TableHead><TableHead className="text-right">Entregado</TableHead><TableHead>Motivo</TableHead></TableRow></TableHeader>
              <TableBody>
                {i.lineas.map((l) => (
                  <TableRow key={l.item_id}>
                    <TableCell className="min-w-[180px]">{l.producto}</TableCell>
                    <TableCell className="whitespace-nowrap text-right">{fmtCantidad(l.esperada)}</TableCell>
                    <TableCell className={`whitespace-nowrap text-right ${l.entregada < l.esperada ? "font-semibold text-warning" : ""}`}>{fmtCantidad(l.entregada)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{l.motivo ? etiquetaMotivo(l.motivo, MOTIVOS_LINEA) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {(i.foto_entrega_url || i.firma_url) && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Evidencia titulo="Foto" ruta={i.foto_entrega_url} />
            {i.firma_url && <Evidencia titulo="Firma" ruta={i.firma_url} fondoBlanco />}
          </div>
        )}

        {i.devolucion !== "no_aplica" && (
          <div className="space-y-2 rounded-lg border border-border p-3" data-devolucion={i.devolucion}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">Regresa al almacén</p>
              <DevolucionBadge i={i} />
            </div>
            <Table containerClassName="max-h-60">
              <TableHeader><TableRow><TableHead>Producto</TableHead><TableHead className="text-right">Regresa</TableHead><TableHead className="text-right">Recibido</TableHead></TableRow></TableHeader>
              <TableBody>
                {(i.devolucion_lineas ?? []).map((l) => (
                  <TableRow key={l.item_id}>
                    <TableCell className="min-w-[160px]">{l.producto}{l.unidad ? <span className="text-muted-foreground"> · {l.unidad}</span> : null}</TableCell>
                    <TableCell className="whitespace-nowrap text-right">{fmtCantidad(l.esperada)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {accion === "devolucion" ? (
                        <Input type="number" inputMode="decimal" min={0} max={l.esperada} step="any" value={recibidas[l.item_id] ?? ""} aria-label={`Recibido de ${l.producto}`}
                          onChange={(e) => setRecibidas((r) => ({ ...r, [l.item_id]: e.target.value }))} className="ml-auto h-8 w-24 text-right" />
                      ) : l.recibida != null ? <span className={l.recibida < l.esperada ? "font-semibold text-destructive" : ""}>{fmtCantidad(l.recibida)}</span> : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {i.devolucion_nota && <p className="text-xs"><span className="font-medium">Nota de almacén:</span> {i.devolucion_nota}</p>}
            <p className="text-[11px] text-muted-foreground">
              Solo en GUDS: la devolución y, si hace falta, la nota de crédito se registran en Odoo. Este registro es la evidencia de lo que volvió.
            </p>
          </div>
        )}

        {!!i.historial?.length && (
          <div className="text-xs">
            <p className="mb-1 font-medium">Bitácora</p>
            <ul className="space-y-0.5 text-muted-foreground">
              {i.historial.map((h, k) => (
                <li key={k}>{fechaHora(h.at)} · {ACCION_INCIDENCIA[h.accion] ?? h.accion}{h.detalle ? ` · ${h.detalle}` : ""}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Formularios de las acciones */}
        {accion && (
          <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3" data-accion={accion}>
            {(accion === "reprogramar" || accion === "reasignar") && (
              <div className="flex flex-wrap items-end gap-3">
                {accion === "reasignar" && (
                  <div className="min-w-[200px] flex-1 space-y-1">
                    <Label htmlFor="inc-rep" className="text-xs">Repartidor</Label>
                    <Select value={rep} onValueChange={setRep}>
                      <SelectTrigger id="inc-rep" className="h-9"><SelectValue placeholder="Elige un repartidor" /></SelectTrigger>
                      <SelectContent>
                        {repsEmpresa.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">No hay repartidores activos con acceso a esta empresa</div>}
                        {repsEmpresa.map((r) => <SelectItem key={r.id} value={r.id}>{r.nombre} {r.apellido ?? ""}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-1">
                  <Label htmlFor="inc-fecha" className="text-xs">{accion === "reprogramar" ? "Nueva fecha" : "Ruta del día (opcional)"}</Label>
                  <Input id="inc-fecha" type="date" min={hoy} value={fecha} onChange={(e) => setFecha(e.target.value)} className="h-9 w-[160px]" />
                </div>
              </div>
            )}
            {accion !== "reasignar" && (
              <div className="space-y-1">
                <Label htmlFor="inc-nota" className="text-xs">
                  {accion === "resolver" ? "Qué se decidió (obligatorio)" : accion === "devolucion" ? (faltante ? "Nota (obligatoria: se recibió menos de lo que regresaba)" : "Nota (opcional)") : "Nota (opcional)"}
                </Label>
                <Textarea id="inc-nota" rows={2} value={nota} onChange={(e) => setNota(e.target.value)}
                  placeholder={accion === "resolver" ? "Ej. Se anuló en Odoo y se emitió la nota de crédito" : accion === "devolucion" ? "Ej. Una caja llegó dañada" : "Ej. El cliente pidió el jueves"} />
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              {accion === "reprogramar" && "El documento vuelve a «Por asignar» con esta fecha. En Odoo no cambia nada."}
              {accion === "reasignar" && "Se crea la entrega nueva para el repartidor (se le avisa). Si eliges un día, queda en su ruta de ese día sin orden: ordénala al publicar la ruta."}
              {accion === "resolver" && "La incidencia se cierra. Si hay que hacer algo en Odoo (devolución, nota de crédito, anular), se hace allá."}
              {accion === "devolucion" && "Cuenta lo que llegó al almacén por producto. Queda quién y cuándo lo confirmó."}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setAccion(null)} disabled={guardando}>Cancelar</Button>
              <Button size="sm" onClick={guardar} disabled={guardando || !valido}>{guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar"}</Button>
            </div>
          </div>
        )}

        {!accion && (decidible || (puedeConfirmar && i.devolucion === "pendiente")) && (
          <DialogFooter className="flex-wrap gap-2 border-t border-border pt-3 sm:justify-end">
            {puedeConfirmar && i.devolucion === "pendiente" && (
              <Button size="sm" variant={modo === "almacen" ? "default" : "outline"} className="gap-1" onClick={() => setAccion("devolucion")}><PackageCheck className="h-3.5 w-3.5" />Confirmar devolución</Button>
            )}
            {recolable && <Button size="sm" variant="outline" className="gap-1" onClick={() => setAccion("reprogramar")}><CalendarClock className="h-3.5 w-3.5" />Reprogramar</Button>}
            {recolable && (
              <Button size="sm" variant="outline" className="gap-1" onClick={() => setAccion("reasignar")} disabled={soloLectura}
                title={soloLectura ? "Elige GUDS o Quirutec en el menú superior para asignar" : undefined}><UserPlus className="h-3.5 w-3.5" />Reasignar</Button>
            )}
            {decidible && (
              <Button size="sm" className="gap-1" onClick={() => setAccion("resolver")} disabled={i.devolucion === "pendiente"}
                title={i.devolucion === "pendiente" ? "Primero almacén confirma lo que regresó" : undefined}><CheckCircle2 className="h-3.5 w-3.5" />Marcar resuelta</Button>
            )}
          </DialogFooter>
        )}
        {decidible && !recolable && i.tipo !== "incompleta" && !accion && (
          <p className="text-[11px] text-muted-foreground">
            {i.activa ? "El documento ya se asignó otra vez: cámbialo desde la cola o la ruta."
              : i.estado_odoo && ["hecha", "cancelada"].includes(i.estado_odoo) ? `El documento ya está ${i.estado_odoo === "hecha" ? "validado" : "cancelado"} en Odoo: no vuelve a la cola.`
              : !i.transferencia_id ? "El documento ya no está en Odoo." : null}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
