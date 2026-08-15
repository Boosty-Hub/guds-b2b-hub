import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ArrowLeft, Loader2, Warehouse, Boxes, Package } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";

interface AlmacenFull {
  id: string;
  nombre: string;
  codigo: string | null;
  tipo: "propio" | "consignacion";
  activo: boolean;
  cliente?: { id: string; nombre_negocio: string } | null;
}
interface InvRow {
  cantidad: number;
  producto?: { id: string; nombre: string; sku: string; unidad: string } | null;
}

const nf = (n: number) => n.toLocaleString("es-VE");

const AlmacenDetalle = () => {
  const { almacenId } = useParams();
  const navigate = useNavigate();
  const [almacen, setAlmacen] = useState<AlmacenFull | null>(null);
  const [inv, setInv] = useState<InvRow[]>([]);
  const [loading, setLoading] = useState(true);
  const pg = usePagination(inv, 25);

  useEffect(() => {
    let vivo = true;
    (async () => {
      setLoading(true);
      const [{ data: a }, { data: rows }] = await Promise.all([
        supabase.from("almacenes").select("id, nombre, codigo, tipo, activo, cliente:clientes(id, nombre_negocio)").eq("id", almacenId).maybeSingle(),
        supabase.from("inventario_almacen").select("cantidad, producto:productos(id, nombre, sku, unidad)").eq("almacen_id", almacenId).order("cantidad", { ascending: false }),
      ]);
      if (vivo) {
        setAlmacen((a as AlmacenFull) ?? null);
        setInv((rows as InvRow[]) ?? []);
        setLoading(false);
      }
    })();
    return () => { vivo = false; };
  }, [almacenId]);

  const volver = (
    <Button variant="ghost" className="mb-4 gap-2" onClick={() => navigate("/admin/almacenes")}>
      <ArrowLeft className="h-4 w-4" /> Volver a almacenes
    </Button>
  );

  if (loading) {
    return <MainLayout title="Almacén">{volver}<div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></MainLayout>;
  }
  if (!almacen) {
    return <MainLayout title="Almacén">{volver}<div className="py-20 text-center text-muted-foreground">Almacén no encontrado</div></MainLayout>;
  }

  const totalUnidades = inv.reduce((s, r) => s + Number(r.cantidad || 0), 0);

  return (
    <MainLayout title={almacen.nombre}>
      {volver}

      {/* Encabezado */}
      <div className="mb-6 flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="rounded-lg bg-primary/10 p-3"><Warehouse className="h-6 w-6 text-primary" /></div>
          <div>
            <h1 className="text-xl font-bold">{almacen.nombre}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {almacen.codigo && <span className="font-mono text-sm text-muted-foreground">{almacen.codigo}</span>}
              <Badge variant={almacen.tipo === "consignacion" ? "outline" : "default"}>
                {almacen.tipo === "consignacion" ? "Consignación" : "Propio"}
              </Badge>
              <Badge variant={almacen.activo ? "default" : "secondary"}>{almacen.activo ? "Activo" : "Inactivo"}</Badge>
              {almacen.cliente && (
                <Link to={`/admin/clientes/${almacen.cliente.id}`} className="text-sm text-primary hover:underline">
                  {almacen.cliente.nombre_negocio}
                </Link>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-6">
          <div className="text-right">
            <p className="text-2xl font-bold">{inv.length}</p>
            <p className="text-xs text-muted-foreground">Productos</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold">{nf(totalUnidades)}</p>
            <p className="text-xs text-muted-foreground">Unidades</p>
          </div>
        </div>
      </div>

      {/* Inventario */}
      <div className="rounded-xl border border-border bg-card shadow-sm">
        {inv.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Boxes className="mb-3 h-10 w-10 opacity-50" />
            <p>Este almacén no tiene existencias.</p>
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead>Unidad</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pg.pageItems.map((r, i) => (
                  <TableRow key={r.producto?.id || i}>
                    <TableCell className="font-mono text-sm text-primary">{r.producto?.sku || "—"}</TableCell>
                    <TableCell className="font-medium">
                      <span className="mr-2"><Package className="inline h-4 w-4 text-muted-foreground" /></span>
                      {r.producto?.nombre || "Producto"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.producto?.unidad || "—"}</TableCell>
                    <TableCell className="text-right font-semibold">{nf(Number(r.cantidad))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <DataTablePagination pagination={pg} />
          </>
        )}
      </div>
    </MainLayout>
  );
};

export default AlmacenDetalle;
