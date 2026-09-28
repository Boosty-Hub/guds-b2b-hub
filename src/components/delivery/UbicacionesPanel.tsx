import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Panel } from "@/components/datos/FichaCampos";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { usePagination } from "@/hooks/use-pagination";
import { CheckCircle2, Loader2, MapPin, MapPinPlus, Satellite, Search, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { fechaHora } from "@/components/delivery/fechas";
import { verEnGoogle } from "@/components/mapas/geo";
import { SEL_UBICACION, claveDestino, fmtPrecision, type DestinoEntrega, type Ubicacion } from "@/components/delivery/ubicaciones";

export interface DestinoPendiente { clave: string; destino: DestinoEntrega; docs: { numero: string; empresa: string }[] }

interface Propuesta extends Ubicacion {
  cliente: { nombre_negocio: string; direccion: string | null; ciudad: string | null; estado: string | null } | null;
  direccion: { nombre: string | null; direccion: string | null; ciudad: string | null; estado: string | null } | null;
  entrega: { doc_numero: string | null; fecha_cierre: string | null; repartidor: { nombre: string; apellido: string | null } | null } | null;
}

const destinoDePropuesta = (u: Propuesta): DestinoEntrega => ({
  cliente_id: u.cliente_id, direccion_id: u.direccion_id, cliente: u.cliente?.nombre_negocio ?? "Cliente", sucursal: u.direccion?.nombre ?? null,
  direccion: u.direccion?.direccion ?? u.cliente?.direccion ?? null, ciudad: u.direccion?.ciudad ?? u.cliente?.ciudad ?? null, region: u.direccion?.estado ?? u.cliente?.estado ?? null,
});

/** Ubicaciones por completar: propuestas del GPS de las entregas (confirmar con un clic), destinos de los documentos
 *  pendientes sin ubicación y, a pedido, todos los clientes y sucursales sin ubicación. */
export function UbicacionesPanel({ pendientes, ubicaciones, puedeEditar, onEditar, onCambio }: {
  pendientes: DestinoPendiente[];
  ubicaciones: Map<string, Ubicacion>;
  puedeEditar: boolean;
  onEditar: (d: DestinoEntrega) => void;
  onCambio: () => void;
}) {
  const { toast } = useToast();
  const [propuestas, setPropuestas] = useState<Propuesta[]>([]);
  const [cargandoProp, setCargandoProp] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [todos, setTodos] = useState<DestinoEntrega[] | null>(null);
  const [cargandoTodos, setCargandoTodos] = useState(false);
  const [q, setQ] = useState("");

  const cargarPropuestas = useCallback(async () => {
    setCargandoProp(true);
    const { data, error } = await supabase.from("ubicaciones_entrega")
      .select(`${SEL_UBICACION}, cliente:clientes(nombre_negocio, direccion, ciudad, estado), direccion:cliente_direcciones(nombre, direccion, ciudad, estado),
        entrega:entregas(doc_numero, fecha_cierre, repartidor:usuarios!entregas_repartidor_id_fkey(nombre, apellido))`)
      .eq("confirmada", false).order("registrada_at", { ascending: false }).limit(200);
    if (error) toast({ title: "No se pudieron cargar las propuestas", description: error.message, variant: "destructive" });
    setPropuestas(((data as unknown as Propuesta[] | null) ?? []).map((u) => ({ ...u, latitud: Number(u.latitud), longitud: Number(u.longitud) })));
    setCargandoProp(false);
  }, [toast]);
  useEffect(() => { cargarPropuestas(); }, [cargarPropuestas, ubicaciones]);

  const accion = async (u: Propuesta, tipo: "confirmar" | "descartar") => {
    setBusy(u.id);
    const { error } = await supabase.rpc(tipo === "confirmar" ? "confirmar_ubicacion_entrega" : "borrar_ubicacion_entrega", { p_ubicacion_id: u.id });
    setBusy(null);
    if (error) { toast({ title: tipo === "confirmar" ? "No se pudo confirmar" : "No se pudo descartar", description: error.message, variant: "destructive" }); return; }
    toast({ title: tipo === "confirmar" ? "Ubicación confirmada" : "Propuesta descartada", description: u.cliente?.nombre_negocio });
    onCambio();
  };

  const sinUbicacion = pendientes.filter((p) => !ubicaciones.get(p.clave));

  const verTodos = async () => {
    setCargandoTodos(true);
    const [cRes, dRes] = await Promise.all([
      supabase.from("clientes").select("id, nombre_negocio, direccion, ciudad, estado").eq("activo", true).order("nombre_negocio").limit(5000),
      supabase.from("cliente_direcciones").select("id, cliente_id, nombre, direccion, ciudad, estado, cliente:clientes(nombre_negocio)").eq("activo", true).limit(5000),
    ]);
    setCargandoTodos(false);
    if (cRes.error || dRes.error) { toast({ title: "No se pudieron cargar los clientes", description: (cRes.error || dRes.error)!.message, variant: "destructive" }); return; }
    const lista: DestinoEntrega[] = [
      ...((cRes.data as { id: string; nombre_negocio: string; direccion: string | null; ciudad: string | null; estado: string | null }[] | null) ?? [])
        .map((c) => ({ cliente_id: c.id, direccion_id: null, cliente: c.nombre_negocio, direccion: c.direccion, ciudad: c.ciudad, region: c.estado })),
      ...((dRes.data as unknown as { id: string; cliente_id: string; nombre: string | null; direccion: string | null; ciudad: string | null; estado: string | null; cliente: { nombre_negocio: string } | null }[] | null) ?? [])
        .map((d) => ({ cliente_id: d.cliente_id, direccion_id: d.id, cliente: d.cliente?.nombre_negocio ?? "Cliente", sucursal: d.nombre, direccion: d.direccion, ciudad: d.ciudad, region: d.estado })),
    ].sort((a, b) => a.cliente.localeCompare(b.cliente) || (a.direccion_id ? 1 : 0) - (b.direccion_id ? 1 : 0));
    setTodos(lista);
  };
  const todosSin = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (todos ?? []).filter((d) => !ubicaciones.get(claveDestino(d.cliente_id, d.direccion_id)!)
      && (!t || [d.cliente, d.sucursal, d.direccion, d.ciudad].some((v) => (v || "").toLowerCase().includes(t))));
  }, [todos, ubicaciones, q]);
  const pag = usePagination(todosSin, 25);

  const nombre = (d: DestinoEntrega) => (
    <span className="min-w-0">
      <span className="block truncate font-medium">{d.cliente}{d.sucursal ? <span className="font-normal text-muted-foreground"> › {d.sucursal}</span> : null}</span>
      <span className="block truncate text-xs text-muted-foreground">{[d.direccion, d.ciudad].filter(Boolean).join(" · ") || "Sin dirección en Odoo"}</span>
    </span>
  );

  return (
    <div className="space-y-3">
      <Panel sinPadding titulo={<><Satellite className="h-4 w-4 text-amber-600" />Por confirmar · GPS de las entregas ({propuestas.length})</>}>
        {cargandoProp ? <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
        : propuestas.length === 0 ? <p className="px-3 py-4 text-sm text-muted-foreground">No hay ubicaciones propuestas. Cuando un repartidor cierra una entrega con el GPS activo en un cliente sin ubicación, la lectura aparece aquí.</p>
        : (
          <ul className="divide-y divide-border" data-lista="propuestas">
            {propuestas.map((u) => {
              const d = destinoDePropuesta(u);
              return (
                <li key={u.id} className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    {nombre(d)}
                    <span className="block text-[11px] text-muted-foreground">
                      GPS {fmtPrecision(u.precision_m)} · {fechaHora(u.registrada_at)}{u.entrega?.doc_numero ? ` · ${u.entrega.doc_numero}` : ""}
                      {u.entrega?.repartidor ? ` (${u.entrega.repartidor.nombre} ${u.entrega.repartidor.apellido ?? ""})`.replace(/\s+\)/, ")") : ""}
                      {" · "}<a className="text-primary underline" href={verEnGoogle({ lat: u.latitud, lng: u.longitud })} target="_blank" rel="noopener noreferrer">Google Maps</a>
                    </span>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <Button size="sm" variant="outline" className="h-8 gap-1 px-2 text-xs" onClick={() => onEditar(d)}><MapPin className="h-3.5 w-3.5" />Revisar</Button>
                    {puedeEditar && (
                      <>
                        <Button size="sm" className="h-8 gap-1 px-2 text-xs" onClick={() => accion(u, "confirmar")} disabled={busy === u.id} aria-label={`Confirmar ubicación de ${d.cliente}`}>
                          {busy === u.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}Confirmar
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8 px-2 text-xs text-destructive hover:text-destructive" onClick={() => accion(u, "descartar")} disabled={busy === u.id}
                          title="Descartar la propuesta (p. ej. el repartidor cerró la entrega lejos del local)" aria-label={`Descartar propuesta de ${d.cliente}`}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel sinPadding titulo={<><MapPinPlus className="h-4 w-4 text-primary" />Sin ubicación · documentos pendientes ({sinUbicacion.length})</>}>
        {sinUbicacion.length === 0 ? <p className="px-3 py-4 text-sm text-muted-foreground">Todos los destinos de los documentos pendientes tienen ubicación.</p> : (
          <ul className="divide-y divide-border" data-lista="sin-ubicacion">
            {sinUbicacion.map((p) => (
              <li key={p.clave} className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  {nombre(p.destino)}
                  <span className="mt-0.5 flex flex-wrap gap-1">
                    {p.docs.slice(0, 6).map((x) => <Badge key={x.numero + x.empresa} variant="outline" className="h-4 px-1 font-mono text-[10px] font-normal">{x.numero} · {x.empresa}</Badge>)}
                    {p.docs.length > 6 && <span className="text-[11px] text-muted-foreground">+{p.docs.length - 6}</span>}
                  </span>
                </div>
                <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1 px-2 text-xs" onClick={() => onEditar(p.destino)} disabled={!puedeEditar}>
                  <MapPinPlus className="h-3.5 w-3.5" />Ubicar en el mapa
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel sinPadding titulo="Todos los clientes y sucursales sin ubicación" acciones={!todos ? (
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={verTodos} disabled={cargandoTodos}>
          {cargandoTodos ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Mostrar"}
        </Button>
      ) : undefined}>
        {todos && (
          <>
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente, sucursal o ciudad" className="h-8 pl-8 text-[13px]" aria-label="Buscar cliente sin ubicación" />
              </div>
              <span className="whitespace-nowrap text-xs text-muted-foreground">{todosSin.length} sin ubicación</span>
            </div>
            <ul className="divide-y divide-border">
              {pag.pageItems.map((d) => (
                <li key={claveDestino(d.cliente_id, d.direccion_id)!} className="flex items-center justify-between gap-2 px-3 py-1.5">
                  {nombre(d)}
                  <Button size="sm" variant="ghost" className="h-7 shrink-0 gap-1 px-2 text-xs" onClick={() => onEditar(d)} disabled={!puedeEditar}><MapPinPlus className="h-3.5 w-3.5" />Ubicar</Button>
                </li>
              ))}
            </ul>
            {todosSin.length > 0 && <DataTablePagination pagination={pag} />}
          </>
        )}
      </Panel>
    </div>
  );
}
