import { useState, useEffect, useCallback } from "react";
import { VendedorLayout } from "@/components/vendedor/VendedorLayout";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Minus, Trash2, ShoppingCart, Loader2, Package } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";

interface Orden { id: string; numero: string; total: number; estado: string; created_at: string; cliente?: { nombre_negocio: string } | null; }
interface Cli { id: string; nombre_negocio: string; }
interface TipoEmpaque { id: string; nombre: string; unidades: number; }
interface ProductoEmp { id: string; tipo_empaque_id: string; precio_empaque: number; activo: boolean; tipo_empaque: TipoEmpaque | null; }
interface Prod { id: string; nombre: string; precio_base: number; en_oferta: boolean | null; precio_oferta: number | null; producto_empaques?: ProductoEmp[]; }
interface Linea { producto_id: string; tipo_empaque_id: string | null; nombre: string; empaque: string | null; precio: number; cantidad: number; }

const estadoConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pendiente: { label: "Pendiente", variant: "secondary" }, confirmado: { label: "Confirmado", variant: "default" },
  procesando: { label: "Procesando", variant: "default" }, enviado: { label: "Enviado", variant: "outline" },
  completado: { label: "Completado", variant: "default" }, cancelado: { label: "Cancelado", variant: "destructive" },
};

const VendedorPedidos = () => {
  const { formatPrice } = useCurrency();
  const { user } = useAuth();
  const { toast } = useToast();
  const [ordenes, setOrdenes] = useState<Orden[]>([]);
  const [clientes, setClientes] = useState<Cli[]>([]);
  const [productos, setProductos] = useState<Prod[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [clienteId, setClienteId] = useState("");
  const [metodo, setMetodo] = useState("transferencia");
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [addProd, setAddProd] = useState("");
  const [pendingEmpaque, setPendingEmpaque] = useState<Prod | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    const [oRes, cRes, pRes] = await Promise.all([
      supabase.from("ordenes").select("id, numero, total, estado, created_at, cliente:clientes(nombre_negocio)").order("created_at", { ascending: false }),
      // Solo los clientes asignados a este vendedor
      supabase.from("clientes").select("id, nombre_negocio").eq("activo", true).eq("vendedor_asignado_id", user.id).order("nombre_negocio"),
      supabase.from("productos").select("id, nombre, precio_base, en_oferta, precio_oferta, producto_empaques(id, tipo_empaque_id, precio_empaque, activo, tipo_empaque:tipos_empaque(id, nombre, unidades))").eq("activo", true).order("nombre"),
    ]);
    if (oRes.data) setOrdenes(oRes.data as unknown as Orden[]);
    if (cRes.data) setClientes(cRes.data as Cli[]);
    if (pRes.data) setProductos(pRes.data as unknown as Prod[]);
    setLoading(false);
  }, [user?.id]);
  useEffect(() => { fetchData(); }, [fetchData]);

  // Al cambiar de cliente, recalcular el precio de las líneas ya agregadas: el
  // cliente puede tener una lista de precios distinta. El servidor recalcula el
  // total al confirmar, pero así el vendedor ve el precio correcto de una vez.
  useEffect(() => {
    if (lineas.length === 0) return;
    let cancelled = false;
    (async () => {
      const recalculadas = await Promise.all(lineas.map(async (l) => {
        const { data } = await supabase.rpc("precio_efectivo", {
          p_producto_id: l.producto_id,
          p_tipo_empaque_id: l.tipo_empaque_id,
          p_cliente_id: clienteId || null,
        });
        return data != null ? { ...l, precio: Number(data) } : l;
      }));
      if (!cancelled) setLineas(recalculadas);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteId]);

  const empaquesDe = (p: Prod) => (p.producto_empaques || []).filter((e) => e.activo && e.tipo_empaque);

  // Precio autoritativo (lista de cliente / empaque / oferta / base), igual que el checkout.
  const precioEfectivo = async (productoId: string, tipoEmpaqueId: string | null, fallback: number) => {
    const { data } = await supabase.rpc("precio_efectivo", {
      p_producto_id: productoId,
      p_tipo_empaque_id: tipoEmpaqueId,
      p_cliente_id: clienteId || null,
    });
    return data != null ? Number(data) : fallback;
  };

  const pushLinea = (l: Linea) => setLineas((prev) => {
    const ex = prev.find((x) => x.producto_id === l.producto_id && x.tipo_empaque_id === l.tipo_empaque_id);
    if (ex) return prev.map((x) => x === ex ? { ...x, cantidad: x.cantidad + 1 } : x);
    return [...prev, l];
  });

  const agregarConEmpaque = async (p: Prod, emp: ProductoEmp | null) => {
    const baseFallback = p.en_oferta && p.precio_oferta ? Number(p.precio_oferta) : Number(p.precio_base);
    const precio = await precioEfectivo(p.id, emp?.tipo_empaque_id || null, emp ? Number(emp.precio_empaque) : baseFallback);
    pushLinea({
      producto_id: p.id,
      tipo_empaque_id: emp?.tipo_empaque_id || null,
      nombre: p.nombre,
      empaque: emp?.tipo_empaque?.nombre || null,
      precio,
      cantidad: 1,
    });
    setPendingEmpaque(null);
    setAddProd("");
  };

  const seleccionarProducto = (pid: string) => {
    const p = productos.find((x) => x.id === pid); if (!p) return;
    const emps = empaquesDe(p);
    if (emps.length > 1) {
      // Tiene varias presentaciones (unidad/pack/caja...): pedir cuál
      setPendingEmpaque(p);
    } else if (emps.length === 1) {
      agregarConEmpaque(p, emps[0]);
    } else {
      agregarConEmpaque(p, null);
    }
    setAddProd("");
  };

  const cambiarCant = (key: string, d: number) => setLineas((prev) => prev.flatMap((l) => {
    const k = l.producto_id + "|" + (l.tipo_empaque_id || "");
    if (k !== key) return [l];
    const n = l.cantidad + d; return n <= 0 ? [] : [{ ...l, cantidad: n }];
  }));
  const subtotal = lineas.reduce((s, l) => s + l.precio * l.cantidad, 0);

  const resetForm = () => { setClienteId(""); setLineas([]); setMetodo("transferencia"); setPendingEmpaque(null); setAddProd(""); };

  const crear = async () => {
    if (!clienteId || lineas.length === 0) { toast({ title: "Faltan datos", description: "Elige cliente y agrega productos", variant: "destructive" }); return; }
    setSaving(true);
    const { data, error } = await supabase.rpc("crear_orden_vendedor", {
      p_cliente_id: clienteId, p_metodo_pago: metodo, p_notas: "Pedido tomado por vendedor",
      p_items: lineas.map((l) => ({ producto_id: l.producto_id, cantidad: l.cantidad, tipo_empaque_id: l.tipo_empaque_id })),
    });
    setSaving(false);
    if (error) { toast({ title: "No se pudo crear el pedido", description: error.message, variant: "destructive" }); return; }
    const row = Array.isArray(data) ? data[0] : data;
    toast({ title: "Pedido creado", description: `${row?.numero ?? ""} · ${formatPrice(Number(row?.total || 0))}` });
    setOpen(false); resetForm();
    fetchData();
  };

  const fmt = (s: string) => new Date(s).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });

  const pagination = usePagination(ordenes, 25);

  return (
    <VendedorLayout title="Pedidos">
      <div className="flex items-center justify-between mb-4">
        <div><h2 className="text-lg font-semibold">Pedidos de mis clientes</h2><p className="text-sm text-muted-foreground">{ordenes.length} pedidos</p></div>
        <Button className="bg-emerald-500 hover:bg-emerald-600" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />Nuevo Pedido</Button>
      </div>

      <div className="rounded-xl border border-border bg-card">
        {loading ? <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-emerald-500" /></div>
        : ordenes.length === 0 ? <div className="py-16 text-center text-muted-foreground">Aún no hay pedidos. Crea el primero con "Nuevo Pedido".</div>
        : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>Pedido</TableHead><TableHead>Cliente</TableHead><TableHead>Fecha</TableHead>
              <TableHead className="text-right">Total</TableHead><TableHead>Estado</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {pagination.pageItems.map((o) => (
                <TableRow key={o.id} className="hover:bg-muted/50">
                  <TableCell className="font-medium text-emerald-600">{o.numero}</TableCell>
                  <TableCell>{o.cliente?.nombre_negocio || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{fmt(o.created_at)}</TableCell>
                  <TableCell className="text-right font-semibold">{formatPrice(Number(o.total))}</TableCell>
                  <TableCell><Badge variant={estadoConfig[o.estado]?.variant || "outline"}>{estadoConfig[o.estado]?.label || o.estado}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {!loading && ordenes.length > 0 && <DataTablePagination pagination={pagination} />}
      </div>

      {/* Nuevo pedido */}
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Nuevo pedido</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>Cliente</Label>
              <Select value={clienteId} onValueChange={setClienteId}>
                <SelectTrigger><SelectValue placeholder="Selecciona tu cliente" /></SelectTrigger>
                <SelectContent>
                  {clientes.length === 0
                    ? <div className="px-3 py-2 text-sm text-muted-foreground">No tienes clientes asignados</div>
                    : clientes.map((c) => <SelectItem key={c.id} value={c.id}>{c.nombre_negocio}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Agregar producto</Label>
              <Select value={addProd} onValueChange={seleccionarProducto}>
                <SelectTrigger><SelectValue placeholder="Buscar y agregar producto" /></SelectTrigger>
                <SelectContent>
                  {productos.map((p) => {
                    const n = empaquesDe(p).length;
                    return (
                      <SelectItem key={p.id} value={p.id}>
                        {p.nombre} · {formatPrice(Number(p.precio_base))}{n > 1 ? ` · ${n} presentaciones` : ""}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            {/* Selección de presentación (empaque) cuando el producto tiene varias */}
            {pendingEmpaque && (
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Package className="h-4 w-4 text-emerald-600" />
                  Presentación de {pendingEmpaque.nombre}
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {empaquesDe(pendingEmpaque).map((emp) => (
                    <button
                      key={emp.id}
                      onClick={() => agregarConEmpaque(pendingEmpaque, emp)}
                      className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-left text-sm hover:border-emerald-500"
                    >
                      <span>
                        <span className="font-medium">{emp.tipo_empaque?.nombre}</span>
                        <span className="text-muted-foreground"> · {emp.tipo_empaque?.unidades} u.</span>
                      </span>
                      <span className="font-semibold">{formatPrice(Number(emp.precio_empaque))}</span>
                    </button>
                  ))}
                </div>
                <button className="text-xs text-muted-foreground underline" onClick={() => setPendingEmpaque(null)}>Cancelar</button>
              </div>
            )}

            {lineas.length > 0 && (
              <div className="rounded-lg border border-border divide-y">
                {lineas.map((l) => {
                  const key = l.producto_id + "|" + (l.tipo_empaque_id || "");
                  return (
                    <div key={key} className="flex items-center justify-between gap-2 p-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="truncate">{l.nombre}{l.empaque ? <span className="text-muted-foreground"> · {l.empaque}</span> : null}</p>
                        <p className="text-xs text-muted-foreground">{formatPrice(l.precio)} c/u</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => cambiarCant(key, -1)}><Minus className="h-3.5 w-3.5" /></Button>
                        <span className="w-6 text-center tabular-nums">{l.cantidad}</span>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => cambiarCant(key, 1)}><Plus className="h-3.5 w-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => cambiarCant(key, -l.cantidad)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </div>
                  );
                })}
                <div className="flex justify-between p-2 font-semibold"><span>Subtotal</span><span>{formatPrice(subtotal)}</span></div>
              </div>
            )}
            <div><Label>Método de pago</Label>
              <Select value={metodo} onValueChange={setMetodo}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="transferencia">Transferencia</SelectItem>
                  <SelectItem value="efectivo">Efectivo</SelectItem>
                  <SelectItem value="pago_movil">Pago Móvil</SelectItem>
                  <SelectItem value="credito">Crédito</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">Se aplicará IVA y envío según la configuración. El total final se calcula en el servidor.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); resetForm(); }} disabled={saving}>Cancelar</Button>
            <Button className="bg-emerald-500 hover:bg-emerald-600" onClick={crear} disabled={saving || !clienteId || lineas.length === 0}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><ShoppingCart className="h-4 w-4 mr-1" />Crear pedido</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </VendedorLayout>
  );
};

export default VendedorPedidos;
