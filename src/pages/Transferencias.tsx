import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2 } from "lucide-react";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { BarraLista } from "@/components/datos/BarraLista";
import { useOrdenTabla, EncabezadoOrdenable, exportarCSV, BotonExportar } from "@/components/datos/tabla";
import { supabase } from "@/lib/supabase";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { OdooBadge } from "@/components/OdooBadge";
import { EstadoTransferencia, PENDIENTES, TIPO_TRANSF, fmtFechaHora, type TransferenciaRow } from "@/components/inventario/EstadoTransferencia";
import { useColumnas } from "@/components/datos/columnas";
import {
  FiltrosLista, useFiltros, useFiltroEmpresa, opcionesDe, opcionesPrueba, pasaPrueba, coincide, enRango, fechaLocal, contadorFiltrado,
  type OpcionFiltro, type OpcionPrueba,
} from "@/components/datos/FiltrosLista";

// El cliente no se incrusta: con ~1.800 transferencias, el join con clientes evalúa su RLS por fila y la consulta llegó a
// 12–30 s (o al límite de tiempo). Los nombres se piden aparte y se unen aquí.
const SELECT = "id, numero, tipo, tipo_operacion, estado, origen, contacto, fecha_programada, fecha_realizada, almacen_origen_id, almacen_destino_id, ubicacion_origen, ubicacion_destino, empresa_id, cliente_id, proveedor:proveedores(id, nombre), orden:ordenes(id, numero)";
type Fila = TransferenciaRow & { empresa_id?: string | null; cliente_id?: string | null };
const TIPOS = ["entrega", "recepcion", "interna", "todas"];
// Fecha que muestra la tabla: la realizada si está hecha; si no, la programada
const fechaDe = (t: Fila) => (t.estado === "hecha" ? t.fecha_realizada : t.fecha_programada);

const Transferencias = () => {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [filas, setFilas] = useState<Fila[]>([]);
  const [almacenes, setAlmacenes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  // Tipo = pestañas (?tipo=, por defecto entregas); los demás filtros van en FiltrosLista (?estado=, ?almacen=, ?fecha=…)
  const tipo = TIPOS.includes(params.get("tipo") ?? "") ? params.get("tipo")! : "entrega";
  const setTipo = (t: string) => setParams((p) => { const n = new URLSearchParams(p); if (t === "entrega") n.delete("tipo"); else n.set("tipo", t); return n; }, { replace: true });
  const [q, setQ] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      // Todas las transferencias de la empresa; el filtro de almacén se aplica en la lista (antes pedía de nuevo al servidor)
      // Con la base cargada la consulta puede pasar el límite de 8 s: un reintento antes de mostrar la lista vacía
      const transferencias = async () => {
        const r = await supabase.from("transferencias").select(SELECT).order("fecha_programada", { ascending: false });
        return r.error ? supabase.from("transferencias").select(SELECT).order("fecha_programada", { ascending: false }) : r;
      };
      const [{ data }, { data: alm }, { data: clis }] = await Promise.all([
        transferencias(),
        supabase.from("almacenes").select("id, nombre"),
        supabase.from("clientes").select("id, nombre_negocio"),
      ]);
      const nombres = new Map(((clis as { id: string; nombre_negocio: string }[] | null) ?? []).map((c) => [c.id, c.nombre_negocio]));
      setFilas(((data as unknown as Fila[]) ?? []).map((t) => ({
        ...t, cliente: t.cliente_id && nombres.has(t.cliente_id) ? { id: t.cliente_id, nombre_negocio: nombres.get(t.cliente_id)! } : null,
      })));
      setAlmacenes(Object.fromEntries(((alm as { id: string; nombre: string }[] | null) ?? []).map((a) => [a.id, a.nombre])));
      setLoading(false);
    })();
  }, []);

  // ---- Filtros (en la URL) ----
  const hoy = fechaLocal(new Date().toISOString())!;
  const pruebasEstado: OpcionPrueba<Fila>[] = [
    { valor: "pendientes", etiqueta: "Pendientes", prueba: (t) => PENDIENTES.includes(t.estado) },
    { valor: "atrasadas", etiqueta: "Pendientes atrasadas", prueba: (t) => PENDIENTES.includes(t.estado) && !!t.fecha_programada && (fechaLocal(t.fecha_programada) ?? "") < hoy },
    { valor: "lista", etiqueta: "Listas", prueba: (t) => t.estado === "lista" },
    { valor: "en_espera", etiqueta: "En espera", prueba: (t) => t.estado === "en_espera" },
    { valor: "parcial", etiqueta: "Parciales", prueba: (t) => t.estado === "parcial" },
    { valor: "borrador", etiqueta: "Borradores", prueba: (t) => t.estado === "borrador" },
    { valor: "hecha", etiqueta: "Hechas", prueba: (t) => t.estado === "hecha" },
    { valor: "cancelada", etiqueta: "Canceladas", prueba: (t) => t.estado === "cancelada" },
    { valor: "todas", etiqueta: "Todos los estados", prueba: () => true },
  ];
  const deAlmacen = (t: Fila, a: string) => !a || t.almacen_origen_id === a || t.almacen_destino_id === a;
  // Almacenes que aparecen como origen o destino (una transferencia cuenta en los dos)
  const opcionesAlmacen = useMemo<OpcionFiltro[]>(() => {
    const n = new Map<string, number>();
    for (const t of filas) for (const a of new Set([t.almacen_origen_id, t.almacen_destino_id])) if (a) n.set(a, (n.get(a) ?? 0) + 1);
    return [...n.entries()].map(([valor, c]) => ({ valor, etiqueta: almacenes[valor] ?? "Almacén", n: c }))
      .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, "es", { numeric: true }));
  }, [filas, almacenes]);
  const contactoDe = (t: Fila) => t.cliente?.nombre_negocio || t.proveedor?.nombre || t.contacto || null;
  const filtroEmpresa = useFiltroEmpresa(filas);
  const deTipo = useMemo(() => filas.filter((t) => tipo === "todas" || t.tipo === tipo), [filas, tipo]);
  const f = useFiltros([
    { clave: "estado", etiqueta: "Estado", porDefecto: "pendientes", principal: true, opciones: opcionesPrueba(deTipo, pruebasEstado).filter((o) => (o.n ?? 0) > 0 || ["pendientes", "todas"].includes(o.valor)) },
    { clave: "almacen", etiqueta: "Almacén", todos: "Todos los almacenes", principal: true, opciones: opcionesAlmacen },
    { clave: "fecha", etiqueta: "Fecha", tipo: "fecha", principal: true },
    { clave: "contacto", etiqueta: "Contacto", todos: "Todos", opciones: opcionesDe(deTipo, contactoDe, undefined, "Sin contacto") },
    filtroEmpresa,
  ]);
  const estado = f.v("estado");
  // Filtros que no son tipo ni estado: acotan también los indicadores y las pestañas (sin filtros = todo, como antes)
  const base = useMemo(() => filas.filter((t) => deAlmacen(t, f.v("almacen")) && enRango(fechaDe(t), f.v("fecha"))
      && coincide(contactoDe(t), f.v("contacto")) && (!filtroEmpresa || coincide(t.empresa_id, f.v("empresa")))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filas, f.firma]);

  const stats = useMemo(() => ({
    listas: base.filter((t) => t.tipo === "entrega" && t.estado === "lista").length,
    espera: base.filter((t) => t.tipo === "entrega" && ["en_espera", "parcial", "borrador"].includes(t.estado)).length,
    recepciones: base.filter((t) => t.tipo === "recepcion" && PENDIENTES.includes(t.estado)).length,
    internas: base.filter((t) => t.tipo === "interna" && PENDIENTES.includes(t.estado)).length,
  }), [base]);
  const porTipo = useMemo(() => {
    const m: Record<string, number> = { todas: base.length };
    for (const t of base) m[t.tipo] = (m[t.tipo] || 0) + 1;
    return m;
  }, [base]);

  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase();
    return base.filter((x) =>
      (tipo === "todas" || x.tipo === tipo) && pasaPrueba(pruebasEstado, estado, x) &&
      (!t || [x.numero, x.origen, x.contacto, x.cliente?.nombre_negocio, x.proveedor?.nombre].some((v) => (v || "").toLowerCase().includes(t))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, tipo, estado, q]);
  const { ordenadas, orden, alternar } = useOrdenTabla(filtradas, {
    numero: (t) => t.numero, contacto: (t) => t.cliente?.nombre_negocio || t.proveedor?.nombre || t.contacto, documento: (t) => t.orden?.numero || t.origen,
    fecha: (t) => (t.estado === "hecha" ? t.fecha_realizada : t.fecha_programada), estado: (t) => t.estado,
  });
  const pg = usePagination(ordenadas, 50, `${tipo}&${f.firma}`);
  const exportar = () => exportarCSV("transferencias", ordenadas, [
    { titulo: "Número", valor: (t) => t.numero }, { titulo: "Tipo", valor: (t) => t.tipo }, { titulo: "Contacto", valor: (t) => t.cliente?.nombre_negocio || t.proveedor?.nombre || t.contacto },
    { titulo: "Origen", valor: (t) => t.ubicacion_origen }, { titulo: "Destino", valor: (t) => t.ubicacion_destino }, { titulo: "Documento", valor: (t) => t.orden?.numero || t.origen },
    { titulo: "Programada", valor: (t) => t.fecha_programada }, { titulo: "Realizada", valor: (t) => t.fecha_realizada }, { titulo: "Estado", valor: (t) => t.estado },
  ]);

  // Un indicador fija tipo y estado a la vez (en una sola escritura de la URL)
  const ir = (t: string, e: string) => f.setVarios({ tipo: t === "entrega" ? "" : t, estado: e });

  const cols = useColumnas("transferencias", [{ etiqueta: "Número", fija: true }, { etiqueta: "Contacto" }, { etiqueta: "Origen" }, { etiqueta: "Destino" }, { etiqueta: "Documento" }, { etiqueta: "Fecha" }, { etiqueta: "Estado" }]);
  return (
    <MainLayout title="Transferencias">
      {cols.estilo}
      <KpiStrip items={[
        { label: "Entregas listas para despachar", valor: stats.listas, tono: "primario", onClick: () => ir("entrega", "lista"), activo: tipo === "entrega" && estado === "lista" },
        { label: "Entregas en espera de stock", valor: stats.espera, tono: stats.espera ? "alerta" : "normal", onClick: () => ir("entrega", "en_espera"), activo: tipo === "entrega" && estado === "en_espera" },
        { label: "Recepciones pendientes", valor: stats.recepciones, tono: "positivo", onClick: () => ir("recepcion", "pendientes"), activo: tipo === "recepcion" && estado === "pendientes" },
        { label: "Traslados pendientes", valor: stats.internas, onClick: () => ir("interna", "pendientes"), activo: tipo === "interna" && estado === "pendientes" },
      ]} />

      {/* Tipo (pestañas), búsqueda, estado y acciones en una sola fila */}
      <Tabs value={tipo} onValueChange={setTipo}>
      <BarraLista
        busqueda={q}
        onBusqueda={setQ}
        placeholder="Buscar número, documento origen o contacto..."
        pestanas={
          <TabsList className="h-auto flex-wrap justify-start">
            <TabsTrigger value="entrega">Entregas ({porTipo.entrega || 0})</TabsTrigger>
            <TabsTrigger value="recepcion">Recepciones ({porTipo.recepcion || 0})</TabsTrigger>
            <TabsTrigger value="interna">Traslados internos ({porTipo.interna || 0})</TabsTrigger>
            <TabsTrigger value="todas">Todas ({porTipo.todas})</TabsTrigger>
          </TabsList>
        }
        filtros={<FiltrosLista filtros={f} resultados={filtradas.length} />}
        contador={loading ? undefined : contadorFiltrado(filtradas.length, deTipo.length, f.activos || !!q)}
        acciones={<><span className="hidden items-center gap-1.5 text-xs text-muted-foreground 2xl:flex"><OdooBadge /> Se procesan en Odoo</span>{cols.selector}<BotonExportar onClick={exportar} total={ordenadas.length} /></>}
      />
      </Tabs>

      <div className="rounded-lg border border-border bg-card">
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <Table data-tabla="transferencias">
            <TableHeader>
              <TableRow>
                <EncabezadoOrdenable clave="numero" orden={orden} onOrdenar={alternar}>Número</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="contacto" orden={orden} onOrdenar={alternar}>Contacto</EncabezadoOrdenable>
                <TableHead>Origen</TableHead>
                <TableHead>Destino</TableHead>
                <EncabezadoOrdenable clave="documento" orden={orden} onOrdenar={alternar}>Documento</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="fecha" orden={orden} onOrdenar={alternar}>Fecha</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="estado" orden={orden} onOrdenar={alternar}>Estado</EncabezadoOrdenable>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pg.pageItems.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No hay transferencias con este filtro</TableCell></TableRow>
              ) : pg.pageItems.map((t) => {
                const contacto = t.cliente?.nombre_negocio || t.proveedor?.nombre || t.contacto || "—";
                return (
                  <TableRow key={t.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/admin/transferencias/${t.id}`)}>
                    <TableCell className="whitespace-nowrap font-mono text-xs text-primary">
                      {t.numero}
                      {tipo === "todas" && <span className="ml-1.5 font-sans text-xs text-muted-foreground">{TIPO_TRANSF[t.tipo] ?? t.tipo}</span>}
                    </TableCell>
                    <TableCell className="max-w-[240px] truncate font-medium" title={contacto}>{contacto}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-muted-foreground" title={t.ubicacion_origen || undefined}>{t.ubicacion_origen || "—"}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-muted-foreground" title={t.ubicacion_destino || undefined}>{t.ubicacion_destino || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">{t.orden?.numero || t.origen || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{t.estado === "hecha" ? fmtFechaHora(t.fecha_realizada) : fmtFechaHora(t.fecha_programada)}</TableCell>
                    <TableCell className="whitespace-nowrap"><EstadoTransferencia estado={t.estado} /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {!loading && <DataTablePagination pagination={pg} />}
      </div>
    </MainLayout>
  );
};

export default Transferencias;
