import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, X } from "lucide-react";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { BarraLista } from "@/components/datos/BarraLista";
import { useOrdenTabla, EncabezadoOrdenable, exportarCSV, BotonExportar } from "@/components/datos/tabla";
import { supabase } from "@/lib/supabase";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { OdooBadge } from "@/components/OdooBadge";
import { EstadoTransferencia, PENDIENTES, TIPO_TRANSF, fmtFechaHora, type TransferenciaRow } from "@/components/inventario/EstadoTransferencia";
import { useColumnas } from "@/components/datos/columnas";

const SELECT = "id, numero, tipo, tipo_operacion, estado, origen, contacto, fecha_programada, fecha_realizada, almacen_origen_id, almacen_destino_id, ubicacion_origen, ubicacion_destino, cliente:clientes(id, nombre_negocio), proveedor:proveedores(id, nombre), orden:ordenes(id, numero)";

const Transferencias = () => {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const almacenFiltro = params.get("almacen");
  const [filas, setFilas] = useState<TransferenciaRow[]>([]);
  const [almacenNombre, setAlmacenNombre] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tipo, setTipo] = useState(params.get("tipo") || "entrega");
  const [estado, setEstado] = useState(params.get("estado") || "pendientes");
  const [q, setQ] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      let consulta = supabase.from("transferencias").select(SELECT).order("fecha_programada", { ascending: false });
      if (almacenFiltro) consulta = consulta.or(`almacen_origen_id.eq.${almacenFiltro},almacen_destino_id.eq.${almacenFiltro}`);
      const [{ data }, alm] = await Promise.all([
        consulta,
        almacenFiltro ? supabase.from("almacenes").select("nombre").eq("id", almacenFiltro).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      setFilas((data as unknown as TransferenciaRow[]) ?? []);
      setAlmacenNombre((alm.data as { nombre: string } | null)?.nombre ?? null);
      setLoading(false);
    })();
  }, [almacenFiltro]);

  const stats = useMemo(() => ({
    listas: filas.filter((t) => t.tipo === "entrega" && t.estado === "lista").length,
    espera: filas.filter((t) => t.tipo === "entrega" && ["en_espera", "parcial", "borrador"].includes(t.estado)).length,
    recepciones: filas.filter((t) => t.tipo === "recepcion" && PENDIENTES.includes(t.estado)).length,
    internas: filas.filter((t) => t.tipo === "interna" && PENDIENTES.includes(t.estado)).length,
  }), [filas]);
  const porTipo = useMemo(() => {
    const m: Record<string, number> = { todas: filas.length };
    for (const t of filas) m[t.tipo] = (m[t.tipo] || 0) + 1;
    return m;
  }, [filas]);

  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase();
    return filas.filter((f) =>
      (tipo === "todas" || f.tipo === tipo) &&
      (estado === "todas" || (estado === "pendientes" ? PENDIENTES.includes(f.estado) : f.estado === estado)) &&
      (!t || [f.numero, f.origen, f.contacto, f.cliente?.nombre_negocio, f.proveedor?.nombre].some((v) => (v || "").toLowerCase().includes(t))));
  }, [filas, tipo, estado, q]);
  const { ordenadas, orden, alternar } = useOrdenTabla(filtradas, {
    numero: (t) => t.numero, contacto: (t) => t.cliente?.nombre_negocio || t.proveedor?.nombre || t.contacto, documento: (t) => t.orden?.numero || t.origen,
    fecha: (t) => (t.estado === "hecha" ? t.fecha_realizada : t.fecha_programada), estado: (t) => t.estado,
  });
  const pg = usePagination(ordenadas, 50);
  const exportar = () => exportarCSV("transferencias", ordenadas, [
    { titulo: "Número", valor: (t) => t.numero }, { titulo: "Tipo", valor: (t) => t.tipo }, { titulo: "Contacto", valor: (t) => t.cliente?.nombre_negocio || t.proveedor?.nombre || t.contacto },
    { titulo: "Origen", valor: (t) => t.ubicacion_origen }, { titulo: "Destino", valor: (t) => t.ubicacion_destino }, { titulo: "Documento", valor: (t) => t.orden?.numero || t.origen },
    { titulo: "Programada", valor: (t) => t.fecha_programada }, { titulo: "Realizada", valor: (t) => t.fecha_realizada }, { titulo: "Estado", valor: (t) => t.estado },
  ]);

  const ir = (t: string, e: string) => { setTipo(t); setEstado(e); };

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

      {almacenFiltro && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md bg-muted/50 px-3 py-1 text-[13px]">
          Movimientos del almacén <span className="font-semibold">{almacenNombre || "…"}</span>
          <Button variant="ghost" size="sm" className="h-7 gap-1" onClick={() => { params.delete("almacen"); setParams(params); }}><X className="h-3.5 w-3.5" /> Quitar filtro</Button>
        </div>
      )}

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
        filtros={
          <Select value={estado} onValueChange={setEstado}>
            <SelectTrigger className="h-8 w-full text-[13px] sm:w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pendientes">Pendientes</SelectItem>
              <SelectItem value="lista">Listas</SelectItem>
              <SelectItem value="en_espera">En espera</SelectItem>
              <SelectItem value="hecha">Hechas</SelectItem>
              <SelectItem value="cancelada">Canceladas</SelectItem>
              <SelectItem value="todas">Todos los estados</SelectItem>
            </SelectContent>
          </Select>
        }
        contador={`${filtradas.length} registros`}
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
