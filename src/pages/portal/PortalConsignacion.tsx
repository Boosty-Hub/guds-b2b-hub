import { useEffect, useState } from "react";
import { PortalPagina } from "@/components/portal/PortalPagina";
import { EstadoVacio, Panel, PillTono, SkeletonFilas, type Tono } from "@/components/portal/sistema";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Boxes } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { DeclararVentaForm, type StockConsignacion } from "@/components/consignacion/DeclararVentaForm";

interface Almacen { id: string; nombre: string; }
interface Declaracion {
  id: string; numero: string; estado: string; fecha: string; total: number;
  factura_id: string | null; factura?: { numero: string } | null;
}

const ESTADO: Record<string, { label: string; tono: Tono }> = {
  pendiente: { label: "Pendiente", tono: "pendiente" },
  aprobado: { label: "Aprobado", tono: "ok" },
  rechazado: { label: "Rechazado", tono: "riesgo" },
};

const PortalConsignacion = () => {
  const { user } = useAuth();
  const { formatPrice } = useCurrency();
  const [almacen, setAlmacen] = useState<Almacen | null>(null);
  const [stock, setStock] = useState<StockConsignacion[]>([]);
  const [declaraciones, setDeclaraciones] = useState<Declaracion[]>([]);
  const [loading, setLoading] = useState(true);

  const cargar = async () => {
    if (!user?.cliente_id) return;
    setLoading(true);
    const { data: alm } = await supabase.from("almacenes").select("id, nombre")
      .eq("cliente_id", user.cliente_id).eq("tipo", "consignacion").eq("activo", true).maybeSingle();
    setAlmacen((alm as Almacen) ?? null);
    if (alm) {
      const { data: inv } = await supabase.from("inventario_almacen")
        .select("cantidad, producto:productos(id, nombre, sku)")
        .eq("almacen_id", alm.id).gt("cantidad", 0);
      setStock(((inv as unknown as { cantidad: number; producto: { id: string; nombre: string; sku: string | null } | null }[]) ?? [])
        .filter((r) => r.producto)
        .map((r) => ({ producto_id: r.producto!.id, nombre: r.producto!.nombre, sku: r.producto!.sku, cantidad: Number(r.cantidad) })));
    }
    const { data: decs } = await supabase.from("declaraciones_consignacion")
      .select("id, numero, estado, fecha, total, factura_id, factura:facturas(numero)")
      .eq("cliente_id", user.cliente_id).order("created_at", { ascending: false });
    setDeclaraciones((decs as unknown as Declaracion[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { cargar(); }, [user?.cliente_id]);

  return (
    <PortalPagina titulo="Consignación" descripcion="Declara lo que vendiste del inventario que tienes en consignación.">
      {loading ? (
        <SkeletonFilas n={2} alto="h-48" />
      ) : !almacen ? (
        <div className="rounded-xl border border-border bg-card">
          <EstadoVacio icono={Boxes} titulo="No tienes inventario en consignación" descripcion="Si trabajas con consignación, tu ejecutivo de cuenta puede asignarte un almacén." />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:items-start">
          <Panel titulo="Declarar venta" descripcion={almacen.nombre}>
            <DeclararVentaForm almacenId={almacen.id} stock={stock} onDeclarado={cargar} />
          </Panel>

          <Panel titulo={`Mis declaraciones (${declaraciones.length})`} cuerpoClassName="p-0 sm:p-0">
            {declaraciones.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">Todavía no has declarado ninguna venta.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nº</TableHead><TableHead>Fecha</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Estado</TableHead><TableHead>Factura</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {declaraciones.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="font-mono text-sm">{d.numero}</TableCell>
                      <TableCell className="text-muted-foreground">{new Date(d.fecha).toLocaleDateString("es-VE")}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{formatPrice(d.total)}</TableCell>
                      <TableCell><PillTono tono={ESTADO[d.estado]?.tono ?? "neutro"}>{ESTADO[d.estado]?.label ?? d.estado}</PillTono></TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground">{d.factura?.numero || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Panel>
        </div>
      )}
    </PortalPagina>
  );
};

export default PortalConsignacion;
