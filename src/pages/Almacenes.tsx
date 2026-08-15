import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Warehouse, Boxes, Users, Search, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";

interface Almacen {
  id: string;
  nombre: string;
  codigo: string | null;
  tipo: "propio" | "consignacion";
  activo: boolean;
  cliente?: { nombre_negocio: string } | null;
  n_productos: number;
  unidades: number;
}

const nf = (n: number) => n.toLocaleString("es-VE");

function TablaAlmacenes({ data, mostrarCliente }: { data: Almacen[]; mostrarCliente?: boolean }) {
  const navigate = useNavigate();
  const pg = usePagination(data, 25);
  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Almacén</TableHead>
            <TableHead>Código</TableHead>
            {mostrarCliente && <TableHead>Cliente</TableHead>}
            <TableHead className="text-center">Productos</TableHead>
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
              <TableCell className="font-medium">{a.nombre}</TableCell>
              <TableCell className="font-mono text-sm text-muted-foreground">{a.codigo || "—"}</TableCell>
              {mostrarCliente && (
                <TableCell className="text-muted-foreground">
                  {a.cliente?.nombre_negocio || <span className="italic opacity-60">sin match</span>}
                </TableCell>
              )}
              <TableCell className="text-center">{a.n_productos}</TableCell>
              <TableCell className="text-right font-semibold">{nf(a.unidades)}</TableCell>
              <TableCell>
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
        supabase.from("almacenes").select("id, nombre, codigo, tipo, activo, cliente:clientes(nombre_negocio)").order("nombre"),
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
      {/* Stats */}
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2"><Warehouse className="h-5 w-5 text-primary" /></div>
            <div>
              <p className="text-2xl font-bold">{almacenes.filter((a) => a.tipo === "propio").length}</p>
              <p className="text-sm text-muted-foreground">Almacenes propios</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-warning/10 p-2"><Users className="h-5 w-5 text-warning" /></div>
            <div>
              <p className="text-2xl font-bold">{almacenes.filter((a) => a.tipo === "consignacion").length}</p>
              <p className="text-sm text-muted-foreground">Consignaciones</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-success/10 p-2"><Boxes className="h-5 w-5 text-success" /></div>
            <div>
              <p className="text-2xl font-bold">{nf(totalUnidadesPropias)}</p>
              <p className="text-sm text-muted-foreground">Unidades en almacén propio</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mb-4 relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Buscar almacén o cliente..." className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : (
        <Tabs defaultValue="propios">
          <TabsList>
            <TabsTrigger value="propios">Propios ({propios.length})</TabsTrigger>
            <TabsTrigger value="consignacion">Consignaciones ({consig.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="propios" className="mt-4">
            <TablaAlmacenes data={propios} />
          </TabsContent>
          <TabsContent value="consignacion" className="mt-4">
            <TablaAlmacenes data={consig} mostrarCliente />
          </TabsContent>
        </Tabs>
      )}
    </MainLayout>
  );
};

export default Almacenes;
