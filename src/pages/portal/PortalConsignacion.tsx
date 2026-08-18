import { useEffect, useState } from "react";
import { PortalMobileLayout } from "@/components/portal/PortalMobileLayout";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Boxes } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { DeclararVentaForm, type StockConsignacion } from "@/components/consignacion/DeclararVentaForm";

interface Almacen { id: string; nombre: string; }
interface Declaracion {
  id: string; numero: string; estado: string; fecha: string; total: number;
  factura_id: string | null; factura?: { numero: string } | null;
}

const ESTADO: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  pendiente: { label: "Pendiente", variant: "secondary" },
  aprobado: { label: "Aprobado", variant: "default" },
  rechazado: { label: "Rechazado", variant: "destructive" },
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
    <PortalMobileLayout title="Consignación">
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : !almacen ? (
        <div className="flex flex-col items-center px-4 py-16 text-center text-muted-foreground">
          <Boxes className="mb-3 h-10 w-10 opacity-50" />
          <p>No tenés inventario en consignación asignado.</p>
        </div>
      ) : (
        <div className="space-y-6 px-4 pt-4">
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <h2 className="mb-3 font-semibold">Declarar venta — {almacen.nombre}</h2>
            <DeclararVentaForm almacenId={almacen.id} stock={stock} onDeclarado={cargar} />
          </div>

          <div className="rounded-xl border border-border bg-card shadow-sm">
            <div className="border-b border-border p-5"><h2 className="font-semibold">Mis declaraciones ({declaraciones.length})</h2></div>
            {declaraciones.length === 0 ? (
              <p className="p-8 text-center text-muted-foreground">Todavía no declaraste ninguna venta.</p>
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
                      <TableCell className="font-mono text-sm text-primary">{d.numero}</TableCell>
                      <TableCell className="text-muted-foreground">{new Date(d.fecha).toLocaleDateString("es-VE")}</TableCell>
                      <TableCell className="text-right font-semibold">{formatPrice(d.total)}</TableCell>
                      <TableCell><Badge variant={ESTADO[d.estado]?.variant ?? "secondary"}>{ESTADO[d.estado]?.label ?? d.estado}</Badge></TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground">{d.factura?.numero || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      )}
    </PortalMobileLayout>
  );
};

export default PortalConsignacion;
