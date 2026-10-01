import { useState, useEffect, useMemo, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  FiltrosLista, useFiltros, useFiltroEmpresa, opcionesDe, opcionesTexto, opcionesPrueba, pasaPrueba, coincide, coincideTexto, enRango,
  contadorFiltrado, type OpcionPrueba,
} from "@/components/datos/FiltrosLista";
import { estadoVe } from "@/components/clientes/odooCliente";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, BarChart3, Eye, ListChecks, Loader2, MapPin, MapPinned, Route, Scale, ShieldAlert, Truck, UserPlus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { BarraLista } from "@/components/datos/BarraLista";
import { OdooBadge } from "@/components/OdooBadge";
import { EmpresaDistintivo } from "@/components/EmpresaSelector";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { EstadoTransferencia } from "@/components/inventario/EstadoTransferencia";
import {
  DetalleEntregaDialog, EscrituraBadge, EstadoEntregaBadge, InsigniaOdooCierre, TipoDocBadge, clienteFila, esReposicion, nombreRepartidor, numeroFila,
  type DocEntrega, type EntregaAdmin, type EscrituraOdoo, type FilaDoc, type Situacion,
} from "@/components/delivery/DetalleEntregaDialog";
import { fechaCorta, fechaHora, diaCaracas } from "@/components/delivery/fechas";
import { ABIERTAS, etiquetaMotivo, fmtCantidad, fmtDia, telefonos } from "@/components/delivery/entregas";
import { usePermissions } from "@/contexts/PermissionsContext";
import { EditorUbicacionDialog } from "@/components/delivery/EditorUbicacionDialog";
import { UbicacionesPanel, type DestinoPendiente } from "@/components/delivery/UbicacionesPanel";
import { PlanificadorRutas } from "@/components/delivery/PlanificadorRutas";
import {
  cargarUbicaciones, claveDestino, estadoUbicacion, ETIQUETA_UBICACION, type DestinoEntrega, type DireccionCliente, type Ubicacion,
} from "@/components/delivery/ubicaciones";
import { SeguimientoPanel } from "@/components/delivery/SeguimientoPanel";
import { IncidenciasPanel } from "@/components/delivery/IncidenciasPanel";
import { IndicadoresPanel } from "@/components/delivery/IndicadoresPanel";
import { CuadreOdooPanel } from "@/components/delivery/CuadreOdooPanel";
import { DISCREPANCIAS, cargarIncidencias, type Incidencia } from "@/components/delivery/seguimiento";

// Delivery (fase 19v): la cola son los DOCUMENTOS DE ENTREGA DE ODOO tal cual (stock.picking de salida, por empresa) y las
// reposiciones a consignación (traslado interno hacia un almacén de consignación: se entrega en el cliente del almacén).
// Se asignan a un repartidor; nada del documento se edita en GUDS. Lo que el repartidor cierra como entregado completo
// o incompleto se valida en Odoo por la cola de escrituras (modo simular / activo en configuración).
interface Repartidor { id: string; nombre: string; apellido: string | null; empresas: string[] }

const DESTINO = "almacen_destino:almacenes!transferencias_almacen_destino_id_fkey(nombre, tipo, cliente_id, cliente:clientes(nombre_negocio))";
const SEL_DOC = `id, empresa_id, odoo_id, numero, tipo, origen, estado, contacto, fecha_programada, fecha_realizada, direccion_entrega, ciudad_entrega,
  region_entrega, telefono_entrega, notas, odoo_sync_at, cliente_id, partner_odoo_id, almacen:almacenes!transferencias_almacen_origen_id_fkey(nombre, tipo), ${DESTINO},
  cliente:clientes(nombre_negocio), items:transferencia_items(id, odoo_id, nombre_producto, cantidad_demandada, cantidad_hecha, estado, unidad)`;
const SEL_ENT = `id, transferencia_id, transferencia_odoo_id, orden_id, doc_numero, empresa_id, estado, prioridad, repartidor_id, created_at,
  fecha_asignacion, fecha_inicio_entrega, fecha_entrega, fecha_cierre, receptor_nombre, notas, motivo_fallo, motivo_codigo, motivo_detalle,
  reprogramada_para, deja_pendiente, lineas, origen_cierre, firma_url, foto_entrega_url, doc_direccion,
  cliente_id, direccion_id, fecha_ruta, orden_ruta, cierre_lat, cierre_lng, cierre_precision_m,
  repartidor:usuarios!entregas_repartidor_id_fkey(nombre, apellido), orden:ordenes(numero, direccion_entrega, cliente:clientes(nombre_negocio)),
  cliente:clientes!entregas_cliente_id_fkey(nombre_negocio), documento:transferencias!entregas_transferencia_id_fkey(${SEL_DOC})`;
const DIAS_HISTORIAL = 90;

const ESTADO_ODOO: Record<string, string> = { lista: "Listo", en_espera: "En espera", borrador: "Borrador", hecha: "Hecho", cancelada: "Cancelado" };
const TIPO_DOC: Record<string, string> = { venta: "Ventas (almacén propio)", reposicion: "Reposiciones a consignación", corte: "Cortes de consignación" };

const PESTANAS: { v: Situacion; label: string }[] = [
  { v: "por_asignar", label: "Por asignar" }, { v: "asignada", label: "Asignadas" }, { v: "en_camino", label: "En camino" }, { v: "cerrada", label: "Cerradas" },
];

// Una fila por documento de entrega (o por entrega vieja ligada a un pedido): el documento de Odoo + su entrega activa o la última
function armarFilas(docs: DocEntrega[], entregas: EntregaAdmin[], escrituras: EscrituraOdoo[]): FilaDoc[] {
  const escPor = new Map<string, EscrituraOdoo>();
  for (const w of escrituras) if (!escPor.has(w.referencia_id)) escPor.set(w.referencia_id, w);   // vienen de la más nueva a la más vieja
  const porDoc = new Map<string, EntregaAdmin[]>();
  for (const e of entregas) {
    const k = e.transferencia_odoo_id != null ? `d${e.transferencia_odoo_id}` : `e${e.id}`;
    (porDoc.get(k) ?? porDoc.set(k, []).get(k)!).push(e);
  }
  const fila = (k: string, doc: DocEntrega | null, ents: EntregaAdmin[]): FilaDoc => {
    const activa = ents.find((x) => ABIERTAS.includes(x.estado)) ?? null;
    const ultima = activa ?? ents[0] ?? null;
    let situacion: Situacion;
    if (activa) situacion = activa.estado as Situacion;
    else if (ultima && ["entregada", "incompleta", "fallida"].includes(ultima.estado)) situacion = "cerrada";
    else if (doc && !["hecha", "cancelada"].includes(doc.estado)) situacion = "por_asignar";   // sin entrega, rechazada, reprogramada o anulada
    else situacion = "cerrada";
    return { clave: k, doc: doc ?? ultima?.documento ?? null, entrega: ultima, intentos: ents, situacion, escritura: ultima ? escPor.get(ultima.id) ?? null : null };
  };
  const filas: FilaDoc[] = [];
  const vistos = new Set<string>();
  for (const d of docs) {
    const k = `d${d.odoo_id}`;
    vistos.add(k);
    filas.push(fila(k, d, porDoc.get(k) ?? []));
  }
  for (const [k, ents] of porDoc) if (!vistos.has(k)) filas.push(fila(k, null, ents));
  return filas;
}

// venta (orden de entrega desde almacén propio) · corte (orden de entrega desde consignación) · reposicion (propio → consignación)
const tipoDe = (f: FilaDoc) => (esReposicion(f.doc) ? "reposicion" : f.doc?.almacen?.tipo === "consignacion" ? "corte" : "venta");

// En la cola, un documento reprogramado (por el repartidor o por administración desde Incidencias, 20p) va con su fecha nueva
const fechaCola = (f: FilaDoc, inc?: Map<string, Incidencia>) => {
  const e = f.entrega;
  const objetivo = e ? inc?.get(e.id)?.fecha_objetivo ?? (e.estado === "reprogramada" ? e.reprogramada_para : null) : null;
  if (f.situacion === "por_asignar") return objetivo ? `${objetivo}T12:00:00Z` : f.doc?.fecha_programada ?? "";
  if (f.situacion === "cerrada") return e?.fecha_cierre || e?.fecha_entrega || f.doc?.fecha_realizada || "";
  return e?.fecha_asignacion ?? "";
};

const Delivery = () => {
  const { toast } = useToast();
  const { soloLectura, empresas } = useEmpresa();
  const [repartidores, setRepartidores] = useState<Repartidor[]>([]);
  const [filas, setFilas] = useState<FilaDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [detalle, setDetalle] = useState<FilaDoc | null>(null);
  const [asignar, setAsignar] = useState<FilaDoc | null>(null);
  const [repSel, setRepSel] = useState("");
  const [prioridad, setPrioridad] = useState("normal");
  const [anular, setAnular] = useState<EntregaAdmin | null>(null);
  const [motivoAnular, setMotivoAnular] = useState("");
  const [saving, setSaving] = useState(false);
  // 20f: vistas Cola / Rutas / Ubicaciones (en la URL, ?vista=rutas), ubicaciones de entrega y editor en el mapa
  const [params, setParams] = useSearchParams();
  // 20p: En curso (seguimiento del día), Incidencias, Indicadores y Cuadre con Odoo
  const seccion = (["rutas", "ubicaciones", "curso", "incidencias", "indicadores", "cuadre"].includes(params.get("vista") ?? "") ? params.get("vista") : "cola") as
    "cola" | "rutas" | "ubicaciones" | "curso" | "incidencias" | "indicadores" | "cuadre";
  // Al cambiar de vista se limpian los filtros de la anterior (cada vista tiene los suyos en la URL)
  const cambiarVista = (v: string) => setParams(() => { const n = new URLSearchParams(); if (v !== "cola") n.set("vista", v); return n; }, { replace: true });
  // Pestaña de la cola (?cola=asignada); por asignar va sin parámetro
  const tab = (PESTANAS.some((p) => p.v === params.get("cola")) ? params.get("cola") : "por_asignar") as Situacion;
  // Desde otra vista (p. ej. un KPI pulsado en Incidencias) se entra a la cola sin los filtros de esa vista
  const setTab = (t: Situacion) => setParams((p) => {
    const n = seccion === "cola" ? new URLSearchParams(p) : new URLSearchParams();
    n.delete("vista");
    if (t === "por_asignar") n.delete("cola"); else n.set("cola", t);
    return n;
  }, { replace: true });
  const { can } = usePermissions();
  const puedeUbicar = can("delivery", "editar") || can("clientes", "editar");
  const [direcciones, setDirecciones] = useState<DireccionCliente[]>([]);
  const [ubicaciones, setUbicaciones] = useState<Map<string, Ubicacion>>(new Map());
  const [editarUbic, setEditarUbic] = useState<DestinoEntrega | null>(null);
  const [recargaRutas, setRecargaRutas] = useState(0);
  const [incidencias, setIncidencias] = useState<Incidencia[]>([]);
  const [cargandoInc, setCargandoInc] = useState(true);
  const [cuadreDisc, setCuadreDisc] = useState(0);

  const recargarIncidencias = useCallback(async () => {
    setCargandoInc(true);
    try { setIncidencias(await cargarIncidencias(false, DIAS_HISTORIAL)); }
    catch (e) { toast({ title: "No se pudieron cargar las incidencias", description: (e as Error).message, variant: "destructive" }); }
    finally { setCargandoInc(false); }
  }, [toast]);
  const incPorEntrega = useMemo(() => new Map(incidencias.map((i) => [i.entrega_id, i])), [incidencias]);

  const recargarUbicaciones = useCallback(async () => {
    try { setUbicaciones(await cargarUbicaciones()); }
    catch (e) { toast({ title: "No se pudieron cargar las ubicaciones", description: (e as Error).message, variant: "destructive" }); }
  }, [toast]);

  const cargar = useCallback(async () => {
    setLoading(true);
    const desde = new Date(Date.now() - DIAS_HISTORIAL * 86400000).toISOString();
    recargarUbicaciones();
    recargarIncidencias();
    supabase.from("cuadre_entregas_odoo").select("tipo").in("tipo", DISCREPANCIAS)
      .then(({ data }) => setCuadreDisc((data as unknown[] | null)?.length ?? 0));
    supabase.from("cliente_direcciones").select("id, odoo_id, cliente_id, nombre, direccion, ciudad, estado").limit(5000)
      .then(({ data }) => setDirecciones((data as DireccionCliente[] | null) ?? []));
    const [rRes, dRes, iRes, eRes, wRes] = await Promise.all([
      supabase.from("usuarios").select("id, nombre, apellido, empresas:usuario_empresas(empresa_id)").eq("role", "delivery").eq("activo", true).order("nombre"),
      supabase.from("transferencias").select(SEL_DOC).eq("tipo", "entrega").not("estado", "in", "(hecha,cancelada)").order("fecha_programada", { ascending: true }),
      // Reposiciones: traslados internos cuyo almacén destino es de consignación (los traslados entre almacenes propios no entran)
      supabase.from("transferencias").select(SEL_DOC.replace(DESTINO, DESTINO.replace("_fkey(", "_fkey!inner(")))
        .eq("tipo", "interna").eq("almacen_destino.tipo", "consignacion").not("estado", "in", "(hecha,cancelada)").order("fecha_programada", { ascending: true }),
      supabase.from("entregas").select(SEL_ENT).or(`estado.in.(asignada,en_camino),created_at.gte.${desde}`).order("created_at", { ascending: false }),
      supabase.from("odoo_escrituras").select("id, referencia_id, estado, error, resultado, intentos, created_at, procesado_at")
        .eq("tipo", "entrega_estado").gte("created_at", desde).order("created_at", { ascending: false }),
    ]);
    const err = dRes.error || iRes.error || eRes.error;
    if (err) toast({ title: "No se pudo cargar delivery", description: err.message, variant: "destructive" });
    setRepartidores(((rRes.data as unknown as { id: string; nombre: string; apellido: string | null; empresas: { empresa_id: string }[] | null }[] | null) ?? [])
      .map((r) => ({ id: r.id, nombre: r.nombre, apellido: r.apellido, empresas: (r.empresas ?? []).map((x) => x.empresa_id) })));
    setFilas(armarFilas([...((dRes.data as unknown as DocEntrega[] | null) ?? []), ...((iRes.data as unknown as DocEntrega[] | null) ?? [])],
      (eRes.data as unknown as EntregaAdmin[] | null) ?? [],
      (wRes.data as unknown as EscrituraOdoo[] | null) ?? []));
    setLoading(false);
  }, [toast, recargarUbicaciones, recargarIncidencias]);
  useEffect(() => { cargar(); }, [cargar]);

  // Destino de cada documento: el cliente (o el de su almacén de consignación) y la sucursal si el contacto del documento
  // en Odoo es una dirección de entrega del cliente
  const dirPorOdoo = useMemo(() => new Map(direcciones.filter((d) => d.odoo_id != null).map((d) => [d.odoo_id!, d])), [direcciones]);
  const dirPorId = useMemo(() => new Map(direcciones.map((d) => [d.id, d])), [direcciones]);
  const destinoFila = useCallback((f: FilaDoc): DestinoEntrega | null => {
    const d = f.doc, e = f.entrega;
    let cliente_id: string | null = null, direccion_id: string | null = null;
    if (d) {
      cliente_id = (esReposicion(d) ? d.almacen_destino?.cliente_id : d.cliente_id) ?? null;
      const x = d.tipo === "entrega" && d.partner_odoo_id != null ? dirPorOdoo.get(d.partner_odoo_id) : undefined;
      if (x && x.cliente_id === cliente_id) direccion_id = x.id;
    }
    if (!cliente_id && e?.cliente_id) { cliente_id = e.cliente_id; direccion_id = e.direccion_id ?? null; }
    if (!cliente_id) return null;
    const dir = direccion_id ? dirPorId.get(direccion_id) : undefined;
    return {
      cliente_id, direccion_id, cliente: clienteFila(f), sucursal: dir?.nombre ?? null,
      direccion: d?.direccion_entrega ?? dir?.direccion ?? e?.doc_direccion ?? null, ciudad: d?.ciudad_entrega ?? dir?.ciudad ?? null, region: d?.region_entrega ?? dir?.estado ?? null,
    };
  }, [dirPorOdoo, dirPorId]);
  const ubicacionFila = (f: FilaDoc) => { const d = destinoFila(f); return d ? ubicaciones.get(claveDestino(d.cliente_id, d.direccion_id)!) ?? null : null; };
  // Destinos de los documentos que hay que llevar (sin cortes de consignación ni borradores), para "Sin ubicación"
  const pendientes = useMemo<DestinoPendiente[]>(() => {
    const m = new Map<string, DestinoPendiente>();
    for (const f of filas) {
      if (!(f.situacion === "asignada" || f.situacion === "en_camino" || (f.situacion === "por_asignar" && tipoDe(f) !== "corte" && f.doc?.estado !== "borrador"))) continue;
      const d = destinoFila(f);
      if (!d) continue;
      const k = claveDestino(d.cliente_id, d.direccion_id)!;
      const p = m.get(k) ?? m.set(k, { clave: k, destino: d, docs: [] }).get(k)!;
      p.docs.push({ numero: numeroFila(f), empresa: empresas.find((x) => x.id === (f.doc?.empresa_id ?? f.entrega?.empresa_id))?.nombre_corto ?? "" });
    }
    return [...m.values()].sort((a, b) => b.docs.length - a.docs.length || a.destino.cliente.localeCompare(b.destino.cliente));
  }, [filas, destinoFila, empresas]);
  const sinUbicacion = pendientes.filter((p) => !ubicaciones.get(p.clave)).length;
  const porConfirmar = [...ubicaciones.values()].filter((u) => !u.confirmada).length;
  const trasUbicar = () => { recargarUbicaciones(); setRecargaRutas((n) => n + 1); };

  // Si el detalle está abierto, se refresca con los datos nuevos
  useEffect(() => { setDetalle((d) => (d ? filas.find((f) => f.clave === d.clave) ?? null : d)); }, [filas]);

  const conteo = useMemo(() => {
    const c: Record<Situacion, number> = { por_asignar: 0, asignada: 0, en_camino: 0, cerrada: 0 };
    for (const f of filas) c[f.situacion]++;
    return c;
  }, [filas]);
  const listas = filas.filter((f) => f.situacion === "por_asignar" && f.doc?.estado === "lista").length;
  const hoy = diaCaracas();
  const cerradasHoy = filas.filter((f) => f.situacion === "cerrada" && f.entrega?.fecha_cierre && diaCaracas(f.entrega.fecha_cierre) === hoy).length;
  const conError = filas.filter((f) => f.escritura?.estado === "error").length;
  const incPorDecidir = incidencias.filter((i) => i.estado === "abierta").length;
  const devPendientes = incidencias.filter((i) => i.devolucion === "pendiente").length;
  const verEnCola = (odooId: number) => {
    const f = filas.find((x) => x.clave === `d${odooId}`);
    if (f) setDetalle(f);
    else toast({ title: "No está en la cola de los últimos 90 días", description: "Ábrelo en Odoo con el enlace del documento." });
  };

  // ---- Filtros de la cola (en la URL): estado en Odoo, tipo, repartidor, fecha, zona (estado), ciudad y ubicación ----
  const filasTab = useMemo(() => filas.filter((f) => f.situacion === tab), [filas, tab]);
  const zonaFila = (f: FilaDoc) => { const r = destinoFila(f)?.region ?? f.doc?.region_entrega ?? null; return estadoVe(r) ?? r; };
  const ciudadFila = (f: FilaDoc) => destinoFila(f)?.ciudad ?? f.doc?.ciudad_entrega ?? null;
  const pruebasUbicacion: OpcionPrueba<FilaDoc>[] = [
    { valor: "con", etiqueta: "Con ubicación en el mapa", prueba: (f) => !!ubicacionFila(f) },
    { valor: "sin", etiqueta: "Sin ubicación", prueba: (f) => tipoDe(f) !== "corte" && !ubicacionFila(f) },
  ];
  const empresasTab = useMemo(() => filasTab.map((f) => ({ empresa_id: f.doc?.empresa_id ?? f.entrega?.empresa_id ?? null })), [filasTab]);
  const filtroEmpresa = useFiltroEmpresa(empresasTab);
  const fc = useFiltros([
    { clave: "odoo", etiqueta: "Estado Odoo", todos: "Todos", principal: true, opciones: opcionesDe(filasTab, (f) => f.doc?.estado, (_f, v) => ESTADO_ODOO[v] ?? v) },
    { clave: "fecha", etiqueta: tab === "cerrada" ? "Cierre" : tab === "por_asignar" ? "Programada" : "Asignada", tipo: "fecha", principal: true },
    { clave: "repartidor", etiqueta: "Repartidor", principal: true, opciones: opcionesDe(filasTab, (f) => f.entrega?.repartidor_id, (f) => nombreRepartidor(f.entrega), "Sin repartidor") },
    { clave: "zona", etiqueta: "Zona (estado)", todos: "Todas las zonas", principal: true, opciones: opcionesDe(filasTab, zonaFila, undefined, "Sin zona") },
    { clave: "ciudad", etiqueta: "Ciudad", todos: "Todas las ciudades", opciones: opcionesTexto(filasTab, ciudadFila, "Sin ciudad") },
    { clave: "tipo", etiqueta: "Tipo de documento", todos: "Todos", opciones: opcionesDe(filasTab, tipoDe, (_f, v) => TIPO_DOC[v] ?? v) },
    { clave: "ubicacion", etiqueta: "Ubicación", todos: "Todas", opciones: opcionesPrueba(filasTab, pruebasUbicacion) },
    filtroEmpresa,
  ]);
  const vista = useMemo(() => {
    const t = q.trim().toLowerCase();
    return filasTab.filter((f) => coincide(f.doc?.estado, fc.v("odoo")) && coincide(tipoDe(f), fc.v("tipo"))
      && coincide(f.entrega?.repartidor_id, fc.v("repartidor")) && enRango(fechaCola(f, incPorEntrega), fc.v("fecha"))
      && coincide(zonaFila(f), fc.v("zona")) && coincideTexto(ciudadFila(f), fc.v("ciudad")) && pasaPrueba(pruebasUbicacion, fc.v("ubicacion"), f)
      && (!filtroEmpresa || coincide(f.doc?.empresa_id ?? f.entrega?.empresa_id, fc.v("empresa")))
      && (!t || [numeroFila(f), clienteFila(f), f.doc?.contacto, f.doc?.origen, f.doc?.direccion_entrega, f.doc?.ciudad_entrega, nombreRepartidor(f.entrega)]
        .some((v) => (v || "").toLowerCase().includes(t))))
      .sort((a, b) => {
        if (tab === "por_asignar") {
          const la = a.doc?.estado === "lista" ? 0 : 1, lb = b.doc?.estado === "lista" ? 0 : 1;
          return la - lb || fechaCola(a, incPorEntrega).localeCompare(fechaCola(b, incPorEntrega));
        }
        return fechaCola(b).localeCompare(fechaCola(a));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filasTab, tab, q, fc.firma, incPorEntrega, ubicaciones, destinoFila]);
  const pagination = usePagination(vista, 50, `${fc.firma}&cola=${tab}`);
  const empresaDe = (id: string) => empresas.find((x) => x.id === id) ?? null;

  const abrirAsignar = (f: FilaDoc) => {
    setAsignar(f);
    const actual = f.entrega && ABIERTAS.includes(f.entrega.estado) ? f.entrega : null;
    setRepSel(actual?.repartidor_id ?? "");
    setPrioridad(actual?.prioridad ?? "normal");
  };
  const repartidoresDoc = asignar?.doc
    ? repartidores.filter((r) => !r.empresas.length || r.empresas.includes(asignar.doc!.empresa_id))
    : repartidores;

  const guardarAsignacion = async () => {
    if (!asignar?.doc || !repSel) return;
    setSaving(true);
    const { error } = await supabase.rpc("asignar_entrega_documento", { p_transferencia_id: asignar.doc.id, p_repartidor_id: repSel, p_prioridad: prioridad });
    setSaving(false);
    if (error) { toast({ title: "No se pudo asignar", description: error.message, variant: "destructive" }); return; }
    const r = repartidores.find((x) => x.id === repSel);
    toast({ title: "Entrega asignada", description: `${asignar.doc.numero} → ${r ? `${r.nombre} ${r.apellido || ""}` : "repartidor"}` });
    setAsignar(null);
    cargar();
  };
  const guardarAnulacion = async () => {
    if (!anular) return;
    setSaving(true);
    const { error } = await supabase.rpc("anular_entrega", { p_entrega_id: anular.id, p_motivo: motivoAnular.trim() || null });
    setSaving(false);
    if (error) { toast({ title: "No se pudo quitar la asignación", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Asignación quitada", description: "El documento vuelve a la cola por asignar" });
    setAnular(null); setMotivoAnular("");
    cargar();
  };
  const reintentar = async (esc: EscrituraOdoo) => {
    const { error } = await supabase.rpc("reintentar_escritura_entrega", { p_escritura_id: esc.id });
    if (error) { toast({ title: "No se pudo reintentar", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Enviado a Odoo", description: "Se está procesando; actualiza en unos segundos." });
    setTimeout(cargar, 4000);
  };

  // Situación de la fila: último intento (por asignar), repartidor (abiertas) o resultado + Odoo (cerradas)
  const situacion = (f: FilaDoc) => {
    const e = f.entrega;
    if (f.situacion === "por_asignar") {
      if (!e) return <span className="text-muted-foreground">—</span>;
      // 20p: la incidencia manda la fecha en la cola (reprogramada por administración) y dice si ya se resolvió
      const inc = incPorEntrega.get(e.id);
      const objetivo = inc?.fecha_objetivo ?? (e.estado === "reprogramada" ? e.reprogramada_para : null);
      const intento = f.intentos.filter((x) => x.estado !== "cancelada").length + 1;
      return (
        <span className="flex flex-col items-start gap-0.5">
          <span className="flex flex-wrap items-center gap-1">
            <EstadoEntregaBadge estado={e.estado} />
            {intento > 1 && e.estado !== "cancelada" && <span className="text-[11px] font-medium text-muted-foreground">{intento}.º intento</span>}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {objetivo && inc?.estado !== "resuelta" ? `para el ${fmtDia(objetivo)} · ` : ""}{e.motivo_codigo ? etiquetaMotivo(e.motivo_codigo) : e.motivo_detalle || ""}
          </span>
          {inc && (inc.estado === "abierta" || inc.estado === "resuelta") && (
            <button type="button" onClick={(ev) => { ev.stopPropagation(); cambiarVista("incidencias"); }}
              className={`text-[11px] hover:underline ${inc.estado === "resuelta" ? "text-muted-foreground" : "text-destructive"}`}
              title={inc.estado === "resuelta" ? inc.nota ?? undefined : "Administración aún no decide: reprogramar, reasignar o resolver"}>
              {inc.estado === "resuelta" ? "Incidencia resuelta" : "Incidencia por decidir"}
            </button>
          )}
        </span>
      );
    }
    if (f.situacion === "cerrada") {
      return (
        <span className="flex flex-wrap items-center gap-1">
          {e ? <EstadoEntregaBadge estado={e.estado} /> : f.doc && <EstadoTransferencia estado={f.doc.estado} />}
          {e?.origen_cierre === "odoo" && <InsigniaOdooCierre />}
          <EscrituraBadge esc={f.escritura} />
        </span>
      );
    }
    return (
      <span className="flex flex-col items-start gap-0.5">
        <span className="whitespace-nowrap font-medium">{nombreRepartidor(e)}</span>
        <span className="text-[11px] text-muted-foreground">{fechaHora(e?.fecha_asignacion ?? null)}{e?.prioridad === "alta" ? " · alta" : ""}</span>
      </span>
    );
  };

  const pestanas = (
    <TabsList className="h-auto flex-wrap justify-start">
      {PESTANAS.map((p) => <TabsTrigger key={p.v} value={p.v}>{p.label} ({conteo[p.v]})</TabsTrigger>)}
    </TabsList>
  );

  return (
    <MainLayout title="Delivery">
      <KpiStrip
        items={[
          { label: "Por asignar", valor: conteo.por_asignar, detalle: `${listas} listas en Odoo`, tono: "primario", onClick: () => setTab("por_asignar"), activo: seccion === "cola" && tab === "por_asignar" },
          { label: "Asignadas", valor: conteo.asignada, onClick: () => setTab("asignada"), activo: seccion === "cola" && tab === "asignada" },
          { label: "En camino", valor: conteo.en_camino, tono: "alerta", onClick: () => setTab("en_camino"), activo: seccion === "cola" && tab === "en_camino" },
          { label: "Cerradas hoy", valor: cerradasHoy, detalle: `${conteo.cerrada} en ${DIAS_HISTORIAL} días`, tono: "positivo", onClick: () => setTab("cerrada"), activo: seccion === "cola" && tab === "cerrada" },
          { label: "Sin ubicación", valor: sinUbicacion, detalle: porConfirmar ? `${porConfirmar} por confirmar (GPS)` : "destinos pendientes", tono: sinUbicacion ? "alerta" : "tenue",
            onClick: () => cambiarVista("ubicaciones"), activo: seccion === "ubicaciones", titulo: "Destinos de los documentos pendientes sin ubicación en el mapa" },
          { label: "Incidencias", valor: incPorDecidir, detalle: devPendientes ? `${devPendientes} devoluciones por confirmar` : "por decidir", tono: incPorDecidir ? "negativo" : "tenue",
            onClick: () => cambiarVista("incidencias"), activo: seccion === "incidencias", titulo: "Entregas incompletas, rechazadas o reprogramadas por decidir" },
          { label: "Error en Odoo", valor: conError, detalle: cuadreDisc ? `${cuadreDisc} con diferencias de cuadre` : undefined, tono: conError || cuadreDisc ? "negativo" : "tenue",
            onClick: () => cambiarVista("cuadre"), activo: seccion === "cuadre", titulo: "Entregas cuya validación en Odoo falló y diferencias del cuadre con Odoo" },
        ]}
      />

      <Tabs value={seccion} onValueChange={cambiarVista} className="mb-2">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="cola" className="gap-1.5"><ListChecks className="h-3.5 w-3.5" />Cola de despacho</TabsTrigger>
          <TabsTrigger value="rutas" className="gap-1.5"><Route className="h-3.5 w-3.5" />Rutas</TabsTrigger>
          <TabsTrigger value="curso" className="gap-1.5"><Truck className="h-3.5 w-3.5" />En curso</TabsTrigger>
          <TabsTrigger value="incidencias" className="gap-1.5"><ShieldAlert className="h-3.5 w-3.5" />Incidencias{incPorDecidir + devPendientes ? ` (${incPorDecidir + devPendientes})` : ""}</TabsTrigger>
          <TabsTrigger value="indicadores" className="gap-1.5"><BarChart3 className="h-3.5 w-3.5" />Indicadores</TabsTrigger>
          <TabsTrigger value="cuadre" className="gap-1.5"><Scale className="h-3.5 w-3.5" />Cuadre con Odoo{cuadreDisc ? ` (${cuadreDisc})` : ""}</TabsTrigger>
          <TabsTrigger value="ubicaciones" className="gap-1.5"><MapPinned className="h-3.5 w-3.5" />Ubicaciones{sinUbicacion + porConfirmar ? ` (${sinUbicacion + porConfirmar})` : ""}</TabsTrigger>
        </TabsList>
      </Tabs>

      {seccion === "curso" && <SeguimientoPanel />}
      {seccion === "incidencias" && (
        <IncidenciasPanel incidencias={incidencias} cargando={cargandoInc} repartidores={repartidores} puedeDecidir={can("delivery", "editar")}
          puedeConfirmar={can("delivery", "editar") || can("inventario", "editar")} soloLectura={soloLectura} abrirId={params.get("incidencia")}
          onCambio={() => cargar()} />
      )}
      {seccion === "indicadores" && <IndicadoresPanel />}
      {seccion === "cuadre" && <CuadreOdooPanel onVerEntrega={verEnCola} />}

      {seccion === "rutas" && (
        <PlanificadorRutas repartidores={repartidores} puedeEditar={can("delivery", "editar")} recarga={recargaRutas}
          onEditarUbicacion={(d) => setEditarUbic(d)} />
      )}
      {seccion === "ubicaciones" && (
        <UbicacionesPanel pendientes={pendientes} ubicaciones={ubicaciones} puedeEditar={puedeUbicar} onEditar={setEditarUbic} onCambio={trasUbicar} />
      )}

      {seccion === "cola" && (<>
      <Tabs value={tab} onValueChange={(v) => setTab(v as Situacion)}>
        <BarraLista
          pestanas={pestanas}
          busqueda={q}
          onBusqueda={setQ}
          placeholder="Buscar documento, cliente, dirección…"
          filtros={<FiltrosLista filtros={fc} resultados={vista.length} />}
          contador={loading ? undefined : contadorFiltrado(vista.length, filasTab.length, fc.activos || !!q.trim(), "documentos")}
          acciones={<span className="hidden items-center gap-1.5 text-xs text-muted-foreground xl:flex"><OdooBadge titulo="Documentos de entrega de Odoo: se muestran tal cual y se editan en Odoo" /> Documentos de Odoo</span>}
        />
      </Tabs>

      {soloLectura && tab !== "cerrada" && (
        <p className="mb-2 rounded-md bg-muted/60 px-3 py-1.5 text-xs text-muted-foreground">Modo consulta («Ambas empresas»): para asignar, elige GUDS o Quirutec en el menú superior.</p>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {loading ? <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        : vista.length === 0 ? <div className="py-10 text-center text-sm text-muted-foreground">
            {tab === "por_asignar" ? "No hay documentos de entrega pendientes en Odoo con este filtro" : "No hay entregas con este filtro"}
          </div>
        : (
          <Table data-tabla="delivery">
            <TableHeader><TableRow>
              <TableHead>Documento</TableHead><TableHead>Cliente</TableHead><TableHead>Dirección de entrega</TableHead>
              <TableHead>{tab === "cerrada" ? "Cerrada" : "Programada"}</TableHead>
              <TableHead>Odoo</TableHead><TableHead>Productos</TableHead>
              <TableHead>{tab === "por_asignar" ? "Último intento" : tab === "cerrada" ? "Resultado" : "Repartidor"}</TableHead>
              <TableHead className="text-right">Acción</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {pagination.pageItems.map((f) => {
                const d = f.doc;
                const items = (d?.items ?? []).filter((i) => i.estado !== "cancelada");
                const reservadas = items.reduce((s, i) => s + Number(i.cantidad_hecha ?? 0), 0);
                const pedidas = items.reduce((s, i) => s + Number(i.cantidad_demandada ?? 0), 0);
                const corto = d && d.estado !== "hecha" && reservadas < pedidas;
                const tel = telefonos(d?.telefono_entrega)[0];
                const abierta = f.situacion === "asignada" || f.situacion === "en_camino";
                const destino = tipoDe(f) === "corte" ? null : destinoFila(f);
                const eu = estadoUbicacion(destino ? ubicaciones.get(claveDestino(destino.cliente_id, destino.direccion_id)!) : null);
                return (
                  <TableRow key={f.clave} className="cursor-pointer hover:bg-muted/50" onClick={() => setDetalle(f)}>
                    <TableCell className="whitespace-nowrap">
                      <span className="flex items-center gap-1.5">
                        {soloLectura && <EmpresaDistintivo empresa={empresaDe(d?.empresa_id ?? f.entrega?.empresa_id ?? "")} className="h-4 w-4 text-[8px]" />}
                        <span className="font-mono text-xs text-primary">{numeroFila(f)}</span>
                      </span>
                      <span className="block text-[11px] text-muted-foreground">{d?.origen || f.entrega?.orden?.numero || ""}</span>
                      <TipoDocBadge doc={d} />
                    </TableCell>
                    <TableCell>
                      <span className="block max-w-[220px] truncate font-medium" title={clienteFila(f)}>{clienteFila(f)}</span>
                      {esReposicion(d)
                        ? <span className="block max-w-[220px] truncate text-[11px] text-muted-foreground" title={d?.almacen_destino?.nombre}>{d?.almacen_destino?.nombre}</span>
                        : d?.contacto && d.contacto !== clienteFila(f) && <span className="block max-w-[220px] truncate text-[11px] text-muted-foreground" title={d.contacto}>{d.contacto}</span>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <span className="block max-w-[260px] truncate" title={d?.direccion_entrega || f.entrega?.doc_direccion || undefined}>{d?.direccion_entrega || f.entrega?.doc_direccion || "—"}</span>
                      <span className="flex max-w-[260px] items-center gap-1.5 text-[11px]">
                        {destino && (
                          <button type="button" onClick={(ev) => { ev.stopPropagation(); setEditarUbic(destino); }}
                            className={`inline-flex shrink-0 items-center gap-0.5 hover:underline ${ETIQUETA_UBICACION[eu].cls}`}
                            title={`${ETIQUETA_UBICACION[eu].titulo}: ${eu === "sin" ? "ubicar" : "ver"} en el mapa`} aria-label={`Ubicación de ${clienteFila(f)}: ${ETIQUETA_UBICACION[eu].label}`}>
                            <MapPin className="h-3 w-3" />{eu === "confirmada" ? null : ETIQUETA_UBICACION[eu].label}
                          </button>
                        )}
                        <span className="truncate">{[d?.ciudad_entrega, tel].filter(Boolean).join(" · ")}</span>
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {tab === "cerrada" ? fechaCorta(f.entrega?.fecha_cierre || f.entrega?.fecha_entrega || d?.fecha_realizada || null) : fechaCorta(d?.fecha_programada ?? null)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{d ? <EstadoTransferencia estado={d.estado} /> : <span className="text-xs text-muted-foreground">Pedido GUDS</span>}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {items.length ? (
                        <span className="flex items-center gap-1" title={corto ? "Odoo no tiene todo reservado: lo que falta no sale en el camión" : undefined}>
                          {corto && <AlertTriangle className="h-3.5 w-3.5 text-warning" />}
                          {items.length} · {fmtCantidad(reservadas)}{corto ? <span className="text-muted-foreground">/{fmtCantidad(pedidas)}</span> : null} u.
                        </span>
                      ) : "—"}
                    </TableCell>
                    <TableCell>{situacion(f)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right" onClick={(ev) => ev.stopPropagation()}>
                      {(f.situacion === "por_asignar" || abierta) && d ? (
                        <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => abrirAsignar(f)}
                          disabled={soloLectura || d.estado !== "lista"}
                          title={soloLectura ? "Elige una empresa para asignar" : d.estado !== "lista" ? "Se asigna cuando Odoo tenga el documento «Listo»" : undefined}>
                          <UserPlus className="h-3.5 w-3.5" />{abierta ? "Reasignar" : "Asignar"}
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => setDetalle(f)}><Eye className="h-3.5 w-3.5" />Ver</Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {!loading && vista.length > 0 && <DataTablePagination pagination={pagination} />}
      </div>
      </>)}

      <DetalleEntregaDialog fila={detalle} onClose={() => setDetalle(null)} puedeEditar={!soloLectura}
        onAsignar={(f) => abrirAsignar(f)} onAnular={(e) => { setAnular(e); setMotivoAnular(""); }} onReintentar={reintentar}
        ubicacion={detalle && destinoFila(detalle) ? estadoUbicacion(ubicacionFila(detalle)) : undefined}
        onUbicar={(f) => { const d = destinoFila(f); if (d) { setDetalle(null); setEditarUbic(d); } }} />

      <EditorUbicacionDialog destino={editarUbic} onClose={() => setEditarUbic(null)} onGuardado={trasUbicar} />

      {/* Asignar / reasignar repartidor */}
      <Dialog open={!!asignar} onOpenChange={(o) => { if (!o) setAsignar(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{asignar?.entrega && ABIERTAS.includes(asignar.entrega.estado) ? "Reasignar" : "Asignar"} entrega — <span className="font-mono">{asignar?.doc?.numero}</span></DialogTitle>
            <DialogDescription>{asignar ? clienteFila(asignar) : ""}{asignar?.doc?.direccion_entrega ? ` · ${asignar.doc.direccion_entrega}` : ""}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            {asignar?.entrega && ABIERTAS.includes(asignar.entrega.estado) && (
              <p className="text-sm text-muted-foreground">Ahora: <span className="text-foreground">{nombreRepartidor(asignar.entrega)}</span>{asignar.entrega.estado === "en_camino" ? " (ya salió)" : ""}</p>
            )}
            <div>
              <Label htmlFor="rep">Repartidor</Label>
              <Select value={repSel} onValueChange={setRepSel}>
                <SelectTrigger id="rep"><SelectValue placeholder="Selecciona un repartidor" /></SelectTrigger>
                <SelectContent>
                  {repartidoresDoc.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">No hay repartidores activos con acceso a esta empresa</div>}
                  {repartidoresDoc.map((r) => <SelectItem key={r.id} value={r.id}>{r.nombre} {r.apellido || ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="prio">Prioridad</Label>
              <Select value={prioridad} onValueChange={setPrioridad}>
                <SelectTrigger id="prio"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="alta">Alta</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">El documento no se modifica en Odoo al asignarlo. Solo cuando el repartidor lo cierre como entregado (completo o incompleto) se valida en Odoo.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAsignar(null)} disabled={saving}>Cancelar</Button>
            <Button onClick={guardarAsignacion} disabled={saving || !repSel}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Asignar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quitar asignación */}
      <Dialog open={!!anular} onOpenChange={(o) => { if (!o) setAnular(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Quitar asignación — <span className="font-mono">{anular?.doc_numero}</span></DialogTitle>
            <DialogDescription>La entrega se anula en GUDS y el documento vuelve a «Por asignar». En Odoo no cambia nada.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="motivo-anular">Motivo (opcional)</Label>
            <Textarea id="motivo-anular" value={motivoAnular} onChange={(e) => setMotivoAnular(e.target.value)} placeholder="Ej. se asignó por error" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAnular(null)} disabled={saving}>Cancelar</Button>
            <Button variant="destructive" onClick={guardarAnulacion} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Quitar asignación"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
};

export default Delivery;
