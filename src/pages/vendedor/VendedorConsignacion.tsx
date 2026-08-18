import { useEffect, useState } from "react";
import { VendedorLayout } from "@/components/vendedor/VendedorLayout";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Boxes } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { DeclararVentaForm, type StockConsignacion } from "@/components/consignacion/DeclararVentaForm";

interface ClienteConsig { cliente_id: string; nombre: string; almacen_id: string; almacen_nombre: string; }
interface Declaracion {
  id: string; numero: string; estado: string; fecha: string; total: number;
  cliente_id: string; factura?: { numero: string } | null;
}

const ESTADO: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  pendiente: { label: "Pendiente", variant: "secondary" },
  aprobado: { label: "Aprobado", variant: "default" },
  rechazado: { label: "Rechazado", variant: "destructive" },
};

const VendedorConsignacion = () => {
  const { user } = useAuth();
  const { formatPrice } = useCurrency();
  const [clientes, setClientes] = useState<ClienteConsig[]>([]);
  const [clienteId, setClienteId] = useState("");
  const [stock, setStock] = useState<StockConsignacion[]>([]);
  const [declaraciones, setDeclaraciones] = useState<Declaracion[]>([]);
  const [loading, setLoading] = useState(true);

  const cargarClientes = async () => {
    if (!user?.id) return;
    setLoading(true);
    const { data } = await supabase
      .from("almacenes")
      .select("id, nombre, cliente:clientes!inner(id, nombre_negocio, vendedor_asignado_id)")
      .eq("tipo", "consignacion").eq("activo", true)
      .eq("cliente.vendedor_asignado_id", user.id);
    const lista = ((data as unknown as { id: string; nombre: string; cliente: { id: string; nombre_negocio: string } }[]) ?? [])
      .map((a) => ({ cliente_id: a.cliente.id, nombre: a.cliente.nombre_negocio, almacen_id: a.id, almacen_nombre: a.nombre }));
    setClientes(lista);
    setLoading(false);
  };

  useEffect(() => { cargarClientes(); }, [user?.id]);

  const cargarDetalle = async (cid: string) => {
    const c = clientes.find((x) => x.cliente_id === cid);
    if (!c) return;
    const { data: inv } = await supabase.from("inventario_almacen")
      .select("cantidad, producto:productos(id, nombre, sku)")
      .eq("almacen_id", c.almacen_id).gt("cantidad", 0);
    setStock(((inv as unknown as { cantidad: number; producto: { id: string; nombre: string; sku: string | null } | null }[]) ?? [])
      .filter((r) => r.producto)
      .map((r) => ({ producto_id: r.producto!.id, nombre: r.producto!.nombre, sku: r.producto!.sku, cantidad: Number(r.cantidad) })));
    const { data: decs } = await supabase.from("declaraciones_consignacion")
      .select("id, numero, estado, fecha, total, cliente_id, factura:facturas(numero)")
      .eq("cliente_id", cid).order("created_at", { ascending: false });
    setDeclaraciones((decs as unknown as Declaracion[]) ?? []);
  };

  const elegirCliente = (cid: string) => { setClienteId(cid); cargarDetalle(cid); };

  const clienteSel = clientes.find((c) => c.cliente_id === clienteId);

  return (
    <VendedorLayout title="Consignación">
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : clientes.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center text-muted-foreground">
          <Boxes className="mb-3 h-10 w-10 opacity-50" />
          <p>Ninguno de tus clientes tiene inventario en consignación.</p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="max-w-sm space-y-2">
            <Select value={clienteId} onValueChange={elegirCliente}>
              <SelectTrigger><SelectValue placeholder="Elegí un cliente con consignación" /></SelectTrigger>
              <SelectContent>
                {clientes.map((c) => <SelectItem key={c.cliente_id} value={c.cliente_id}>{c.nombre}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {clienteSel && (
            <>
              <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <h2 className="mb-3 font-semibold">Declarar venta — {clienteSel.nombre} ({clienteSel.almacen_nombre})</h2>
                <DeclararVentaForm almacenId={clienteSel.almacen_id} stock={stock} onDeclarado={() => cargarDetalle(clienteId)} />
              </div>

              <div className="rounded-xl border border-border bg-card shadow-sm">
                <div className="border-b border-border p-5"><h2 className="font-semibold">Declaraciones de {clienteSel.nombre} ({declaraciones.length})</h2></div>
                {declaraciones.length === 0 ? (
                  <p className="p-8 text-center text-muted-foreground">Sin declaraciones todavía.</p>
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
            </>
          )}
        </div>
      )}
    </VendedorLayout>
  );
};

export default VendedorConsignacion;
