import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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

interface Almacen {
  id: string;
  nombre: string;
  codigo: string | null;
  tipo: "propio" | "consignacion";
  activo: boolean;
  cliente?: { nombre_negocio: string } | null;
  vinculo_cliente: "nombre" | "entregas" | "manual" | null;
  n_productos: number;
  unidades: number;
}

const nf = (n: number) => n.toLocaleString("es-VE");
const VINCULO: Record<string, string> = { nombre: "por nombre", entregas: "por entregas en Odoo", manual: "manual" };

function TablaAlmacenes({ data, mostrarCliente }: { data: Almacen[]; mostrarCliente?: boolean }) {
  const navigate = useNavigate();
  const pg = usePagination(data, 50);
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

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: alm }, { data: inv }] = await Promise.all([
        supabase.from("almacenes").select("id, nombre, codigo, tipo, activo, vinculo_cliente, cliente:clientes(nombre_negocio)").order("nombre"),
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

  const filtrar = (list: Almacen[]) =>
    list.filter((a) =>
      a.nombre.toLowerCase().includes(q.toLowerCase()) ||
      (a.codigo || "").toLowerCase().includes(q.toLowerCase()) ||
      (a.cliente?.nombre_negocio || "").toLowerCase().includes(q.toLowerCase())
    );

  const propios = filtrar(almacenes.filter((a) => a.tipo === "propio"));
  const consig = filtrar(almacenes.filter((a) => a.tipo === "consignacion"));
  const totalUnidadesPropias = almacenes.filter((a) => a.tipo === "propio").reduce((s, a) => s + a.unidades, 0);

  return (
    <MainLayout title="Almacenes">
      <KpiStrip items={[
        { label: "Almacenes propios", valor: almacenes.filter((a) => a.tipo === "propio").length, tono: "primario" },
        { label: "Consignaciones", valor: almacenes.filter((a) => a.tipo === "consignacion").length, tono: "alerta" },
        { label: "Unidades en almacén propio", valor: nf(totalUnidadesPropias), tono: "positivo" },
      ]} />

      <Tabs defaultValue="propios">
        <BarraLista
          busqueda={q}
          onBusqueda={setQ}
          placeholder="Buscar almacén o cliente..."
          filtros={
            <TabsList>
              <TabsTrigger value="propios">Propios ({propios.length})</TabsTrigger>
              <TabsTrigger value="consignacion">Consignaciones ({consig.length})</TabsTrigger>
            </TabsList>
          }
          contador={`${propios.length + consig.length} registros`}
        />
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <>
            <TabsContent value="propios" className="mt-0">
              <TablaAlmacenes data={propios} />
            </TabsContent>
            <TabsContent value="consignacion" className="mt-0">
              <TablaAlmacenes data={consig} mostrarCliente />
            </TabsContent>
          </>
        )}
      </Tabs>
    </MainLayout>
  );
};

export default Almacenes;
