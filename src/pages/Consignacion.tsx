import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Boxes, FileText } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/hooks/use-toast";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";

interface Item { id: string; nombre_producto: string | null; sku_producto: string | null; cantidad: number; precio_unitario: number; subtotal: number; }
interface Declaracion {
  id: string; numero: string; estado: string; fecha: string; subtotal: number; impuesto: number; total: number;
  notas: string | null; rol_declarante: string; factura_id: string | null;
  cliente?: { nombre_negocio: string } | null;
  almacen?: { nombre: string } | null;
  factura?: { numero: string } | null;
}

const ESTADO: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  pendiente: { label: "Pendiente", variant: "secondary" },
  aprobado: { label: "Aprobado", variant: "default" },
  rechazado: { label: "Rechazado", variant: "destructive" },
};

const Consignacion = () => {
  const { formatPrice } = useCurrency();
  const { toast } = useToast();
  const [declaraciones, setDeclaraciones] = useState<Declaracion[]>([]);
  const [loading, setLoading] = useState(true);
  const [detalle, setDetalle] = useState<Declaracion | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [notas, setNotas] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchAll = async () => {
    setLoading(true);
    const { data } = await supabase.from("declaraciones_consignacion")
      .select("id, numero, estado, fecha, subtotal, impuesto, total, notas, rol_declarante, factura_id, cliente:clientes(nombre_negocio), almacen:almacenes(nombre), factura:facturas(numero)")
      .order("created_at", { ascending: false });
    setDeclaraciones((data as unknown as Declaracion[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { fetchAll(); }, []);

  const pendientes = declaraciones.filter((d) => d.estado === "pendiente");
  const aprobadas = declaraciones.filter((d) => d.estado === "aprobado");
  const rechazadas = declaraciones.filter((d) => d.estado === "rechazado");

  const pgPend = usePagination(pendientes, 25);
  const pgApr = usePagination(aprobadas, 25);
  const pgRech = usePagination(rechazadas, 25);

  const abrirDetalle = async (d: Declaracion) => {
    setDetalle(d);
    setNotas("");
    const { data } = await supabase.from("declaracion_consignacion_items").select("id, nombre_producto, sku_producto, cantidad, precio_unitario, subtotal").eq("declaracion_id", d.id);
    setItems((data as Item[]) ?? []);
  };

  const revisar = async (aprobar: boolean) => {
    if (!detalle) return;
    setSaving(true);
    const { data, error } = await supabase.rpc("revisar_declaracion_consignacion", {
      p_declaracion_id: detalle.id, p_aprobar: aprobar, p_notas: notas || null,
    });
    setSaving(false);
    if (error) { toast({ title: "No se pudo procesar", description: error.message, variant: "destructive" }); return; }
    const r = data as { numero?: string };
    toast({
      title: aprobar ? "Declaración aprobada" : "Declaración rechazada",
      description: aprobar ? `Factura ${r.numero} generada` : "Se descartó la declaración.",
    });
    setDetalle(null);
    fetchAll();
  };

  const renderTabla = (rows: Declaracion[], pg: ReturnType<typeof usePagination<Declaracion>>, accionable: boolean) => (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      {rows.length === 0 ? (
        <p className="p-8 text-center text-muted-foreground">Sin declaraciones en esta categoría.</p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nº</TableHead><TableHead>Cliente</TableHead><TableHead>Almacén</TableHead>
                <TableHead>Declarado por</TableHead><TableHead>Fecha</TableHead>
                <TableHead className="text-right">Total</TableHead>
                {accionable ? <TableHead className="text-right">Acción</TableHead> : <TableHead>Factura</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pg.pageItems.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-mono text-sm text-primary">{d.numero}</TableCell>
                  <TableCell className="font-medium">{d.cliente?.nombre_negocio || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{d.almacen?.nombre || "—"}</TableCell>
                  <TableCell className="capitalize text-muted-foreground">{d.rol_declarante}</TableCell>
                  <TableCell className="text-muted-foreground">{new Date(d.fecha).toLocaleDateString("es-VE")}</TableCell>
                  <TableCell className="text-right font-semibold">{formatPrice(d.total)}</TableCell>
                  {accionable ? (
                    <TableCell className="text-right"><Button size="sm" onClick={() => abrirDetalle(d)}>Revisar</Button></TableCell>
                  ) : (
                    <TableCell>
                      {d.factura?.numero ? (
                        <Link to={`/admin/facturas/${d.factura_id}`} className="flex items-center gap-1 font-mono text-sm text-primary hover:underline">
                          <FileText className="h-3.5 w-3.5" /> {d.factura.numero}
                        </Link>
                      ) : "—"}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <DataTablePagination pagination={pg} />
        </>
      )}
    </div>
  );

  return (
    <MainLayout title="Consignación">
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : (
        <Tabs defaultValue="pendientes">
          <TabsList>
            <TabsTrigger value="pendientes" className="gap-1.5"><Boxes className="h-3.5 w-3.5" /> Pendientes ({pendientes.length})</TabsTrigger>
            <TabsTrigger value="aprobadas">Aprobadas ({aprobadas.length})</TabsTrigger>
            <TabsTrigger value="rechazadas">Rechazadas ({rechazadas.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="pendientes" className="mt-4">{renderTabla(pendientes, pgPend, true)}</TabsContent>
          <TabsContent value="aprobadas" className="mt-4">{renderTabla(aprobadas, pgApr, false)}</TabsContent>
          <TabsContent value="rechazadas" className="mt-4">{renderTabla(rechazadas, pgRech, false)}</TabsContent>
        </Tabs>
      )}

      <Dialog open={!!detalle} onOpenChange={(o) => !o && setDetalle(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Declaración {detalle?.numero}</DialogTitle></DialogHeader>
          {detalle && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
                <div><span className="text-muted-foreground">Cliente:</span> <span className="font-medium">{detalle.cliente?.nombre_negocio}</span></div>
                <div><span className="text-muted-foreground">Almacén:</span> {detalle.almacen?.nombre}</div>
                <div><span className="text-muted-foreground">Declarado por:</span> <span className="capitalize">{detalle.rol_declarante}</span></div>
                <div><span className="text-muted-foreground">Fecha:</span> {new Date(detalle.fecha).toLocaleDateString("es-VE")}</div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Producto</TableHead><TableHead className="text-center">Cant.</TableHead><TableHead className="text-right">Precio</TableHead><TableHead className="text-right">Subtotal</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((it) => (
                    <TableRow key={it.id}>
                      <TableCell className="font-medium">{it.nombre_producto}</TableCell>
                      <TableCell className="text-center">{it.cantidad}</TableCell>
                      <TableCell className="text-right">{formatPrice(it.precio_unitario)}</TableCell>
                      <TableCell className="text-right font-semibold">{formatPrice(it.subtotal)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex justify-end gap-6 text-sm">
                <span>Subtotal: <span className="font-semibold">{formatPrice(detalle.subtotal)}</span></span>
                <span>IVA: <span className="font-semibold">{formatPrice(detalle.impuesto)}</span></span>
                <span>Total: <span className="font-semibold text-primary">{formatPrice(detalle.total)}</span></span>
              </div>
              {detalle.notas && <p className="text-sm text-muted-foreground">Notas del declarante: {detalle.notas}</p>}
              <Textarea rows={2} placeholder="Notas de la revisión (opcional)" value={notas} onChange={(e) => setNotas(e.target.value)} />
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="destructive" onClick={() => revisar(false)} disabled={saving}>Rechazar</Button>
            <Button onClick={() => revisar(true)} disabled={saving} className="gap-2">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Aprobar y facturar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
};

export default Consignacion;
