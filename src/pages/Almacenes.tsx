import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { BarraLista } from "@/components/datos/BarraLista";
import {
  FiltrosLista, useFiltros, useFiltroEmpresa, opcionesPrueba, pasaPrueba, coincide, contadorFiltrado, type OpcionPrueba,
} from "@/components/datos/FiltrosLista";

interface Almacen {
  id: string;
  nombre: string;
  codigo: string | null;
  tipo: "propio" | "consignacion";
  activo: boolean;
  cliente?: { nombre_negocio: string } | null;
  vinculo_cliente: "nombre" | "entregas" | "manual" | null;
  empresa_id?: string | null;
  n_productos: number;
  unidades: number;
}

const nf = (n: number) => n.toLocaleString("es-VE");
const VINCULO: Record<string, string> = { nombre: "por nombre", entregas: "por entregas en Odoo", manual: "manual" };

function TablaAlmacenes({ data, mostrarCliente, reinicio }: { data: Almacen[]; mostrarCliente?: boolean; reinicio?: string }) {
  const navigate = useNavigate();
  const pg = usePagination(data, 50, reinicio);
  return (
    <div className="rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Almacén</TableHead>
            <TableHead>Código</TableHead>
            {mostrarCliente && <TableHead>Cliente</TableHead>}
            <TableHead className="text-right">Productos</TableHead>
            <TableHead className="text-right">Unidades</TableHead>
            <TableHead>Estado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pg.pageItems.map((a) => (
            <TableRow
              key={a.id}
              className="cursor-pointer hover:bg-muted/50"
              onClick={() => navigate(`/admin/almacenes/${a.id}`)}
            >
              <TableCell className="max-w-[300px] truncate font-medium" title={a.nombre}>{a.nombre}</TableCell>
              <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">{a.codigo || "—"}</TableCell>
              {mostrarCliente && (
                <TableCell className="max-w-[320px] truncate text-muted-foreground" title={a.cliente?.nombre_negocio || undefined}>
                  {a.cliente?.nombre_negocio || <span className="italic opacity-60">{a.vinculo_cliente === "manual" ? "sin cliente (manual)" : "sin cliente identificado"}</span>}
                  {a.cliente && a.vinculo_cliente && <span className="ml-1.5 text-xs opacity-70">{VINCULO[a.vinculo_cliente]}</span>}
                </TableCell>
              )}
              <TableCell className="whitespace-nowrap text-right">{a.n_productos}</TableCell>
              <TableCell className="whitespace-nowrap text-right font-semibold">{nf(a.unidades)}</TableCell>
              <TableCell className="whitespace-nowrap">
                <Badge variant={a.activo ? "default" : "secondary"}>{a.activo ? "Activo" : "Inactivo"}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <DataTablePagination pagination={pg} />
    </div>
  );
}

const Almacenes = () => {
  const [almacenes, setAlmacenes] = useState<Almacen[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [params, setParams] = useSearchParams();
  // Pestaña en la URL (?tab=consignacion) para que los filtros sobrevivan a recargar
  const tab = params.get("tab") === "consignacion" ? "consignacion" : "propios";
  const setTab = (t: string) => setParams((p) => {
    const n = new URLSearchParams(p);
    if (t === "consignacion") n.set("tab", t); else { n.delete("tab"); n.delete("vinculo"); }
    return n;
  }, { replace: true });

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: alm }, { data: inv }] = await Promise.all([
        supabase.from("almacenes").select("id, nombre, codigo, tipo, activo, vinculo_cliente, empresa_id, cliente:clientes(nombre_negocio)").order("nombre"),
        supabase.from("inventario_almacen").select("almacen_id, cantidad"),
      ]);
      const agg = new Map<string, { n: number; sum: number }>();
      for (const r of inv ?? []) {
        const cur = agg.get(r.almacen_id) || { n: 0, sum: 0 };
        cur.n += 1; cur.sum += Number(r.cantidad || 0);
        agg.set(r.almacen_id, cur);
      }
      setAlmacenes((alm ?? []).map((a): Almacen => ({
        ...(a as unknown as Almacen),
        n_productos: agg.get(a.id)?.n ?? 0,
        unidades: agg.get(a.id)?.sum ?? 0,
      })));
      setLoading(false);
    })();
  }, []);

  // ---- Filtros (en la URL) ----
  const pruebasActivo: OpcionPrueba<Almacen>[] = [
    { valor: "si", etiqueta: "Activos", prueba: (a) => a.activo }, { valor: "no", etiqueta: "Inactivos", prueba: (a) => !a.activo },
  ];
  const pruebasExistencias: OpcionPrueba<Almacen>[] = [
    { valor: "con", etiqueta: "Con existencias", prueba: (a) => a.unidades > 0 }, { valor: "sin", etiqueta: "Sin existencias", prueba: (a) => !(a.unidades > 0) },
  ];
  // Consignaciones: cómo se identificó el cliente dueño del almacén (o si falta)
  const pruebasVinculo: OpcionPrueba<Almacen>[] = [
    { valor: "sin", etiqueta: "Sin cliente identificado", prueba: (a) => !a.cliente },
    { valor: "nombre", etiqueta: "Vinculado por nombre", prueba: (a) => !!a.cliente && a.vinculo_cliente === "nombre" },
    { valor: "entregas", etiqueta: "Vinculado por entregas en Odoo", prueba: (a) => !!a.cliente && a.vinculo_cliente === "entregas" },
    { valor: "manual", etiqueta: "Vinculado a mano", prueba: (a) => !!a.cliente && a.vinculo_cliente === "manual" },
  ];
  const deTab = almacenes.filter((a) => a.tipo === (tab === "consignacion" ? "consignacion" : "propio"));
  const filtroEmpresa = useFiltroEmpresa(almacenes);
  const f = useFiltros([
    { clave: "activo", etiqueta: "Situación", todos: "Activos e inactivos", principal: true, opciones: opcionesPrueba(deTab, pruebasActivo) },
    { clave: "existencias", etiqueta: "Existencias", todos: "Todos", principal: true, opciones: opcionesPrueba(deTab, pruebasExistencias) },
    tab === "consignacion" && { clave: "vinculo", etiqueta: "Cliente", todos: "Todos", principal: true, opciones: opcionesPrueba(deTab, pruebasVinculo) },
    filtroEmpresa,
  ]);
  const filtrar = (list: Almacen[], conVinculo: boolean) =>
    list.filter((a) =>
      (a.nombre.toLowerCase().includes(q.toLowerCase()) ||
      (a.codigo || "").toLowerCase().includes(q.toLowerCase()) ||
      (a.cliente?.nombre_negocio || "").toLowerCase().includes(q.toLowerCase())) &&
      pasaPrueba(pruebasActivo, f.v("activo"), a) && pasaPrueba(pruebasExistencias, f.v("existencias"), a) &&
      (!conVinculo || pasaPrueba(pruebasVinculo, f.v("vinculo"), a)) && (!filtroEmpresa || coincide(a.empresa_id, f.v("empresa")))
    );

  const propios = filtrar(almacenes.filter((a) => a.tipo === "propio"), false);
  const consig = filtrar(almacenes.filter((a) => a.tipo === "consignacion"), true);
  const visibles = tab === "consignacion" ? consig : propios;
  const totalUnidadesPropias = almacenes.filter((a) => a.tipo === "propio").reduce((s, a) => s + a.unidades, 0);

  return (
    <MainLayout title="Almacenes">
      <KpiStrip items={[
        { label: "Almacenes propios", valor: almacenes.filter((a) => a.tipo === "propio").length, tono: "primario" },
        { label: "Consignaciones", valor: almacenes.filter((a) => a.tipo === "consignacion").length, tono: "alerta" },
        { label: "Unidades en almacén propio", valor: nf(totalUnidadesPropias), tono: "positivo" },
      ]} />

      <Tabs value={tab} onValueChange={setTab}>
        <BarraLista
          busqueda={q}
          onBusqueda={setQ}
          placeholder="Buscar almacén o cliente..."
          pestanas={
            <TabsList>
              <TabsTrigger value="propios">Propios ({propios.length})</TabsTrigger>
              <TabsTrigger value="consignacion">Consignaciones ({consig.length})</TabsTrigger>
            </TabsList>
          }
          filtros={<FiltrosLista filtros={f} resultados={visibles.length} />}
          contador={loading ? undefined : contadorFiltrado(visibles.length, deTab.length, f.activos || !!q, "almacenes")}
        />
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <>
            <TabsContent value="propios" className="mt-0">
              <TablaAlmacenes data={propios} reinicio={f.firma} />
            </TabsContent>
            <TabsContent value="consignacion" className="mt-0">
              <TablaAlmacenes data={consig} mostrarCliente reinicio={f.firma} />
            </TabsContent>
          </>
        )}
      </Tabs>
    </MainLayout>
  );
};

export default Almacenes;
