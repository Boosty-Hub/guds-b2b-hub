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
import { useSearchParams } from "react-router-dom";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { BarraLista } from "@/components/datos/BarraLista";
import { useOrdenTabla, EncabezadoOrdenable } from "@/components/datos/tabla";
import { useResumenVendedor, mesDe } from "@/components/vendedor/resumen";

interface Orden { id: string; numero: string; total: number; estado: string; created_at: string; fecha_pedido: string | null; odoo_id: number | null;
  aprobacion: "pendiente" | "aprobada" | "rechazada" | null; rechazo_motivo: string | null; cliente?: { nombre_negocio: string } | null; }
interface Cli { id: string; nombre_negocio: string; }
interface TipoEmpaque { id: string; nombre: string; unidades: number; }
interface ProductoEmp { id: string; tipo_empaque_id: string; precio_empaque: number; activo: boolean; tipo_empaque: TipoEmpaque | null; }
interface Prod { id: string; nombre: string; precio_base: number; en_oferta: boolean | null; precio_oferta: number | null; producto_empaques?: ProductoEmp[];
  stock_disponible: number | null; controla_stock: boolean | null; }
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
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get("q") || "");
  const [estadoFiltro, setEstadoFiltro] = useState<"todos" | "abiertos">("todos");
  // Contadores desde resumen_vendedor() (misma fuente que el Dashboard y Metas)
  const { resumen, recargar: recargarResumen } = useResumenVendedor();
  // El buscador global abre esta página con ?q=
  useEffect(() => { const v = params.get("q"); if (v !== null) setQ(v); }, [params]);

  const fetchData = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    // Todos sus clientes asignados (activos o no): la lista de pedidos se filtra explícitamente por su cartera,
    // además de lo que ya limita RLS (los pedidos que tomó él aunque el cliente ya no sea suyo también cuentan)
    const { data: asignados } = await supabase.from("clientes").select("id").eq("vendedor_asignado_id", user.id);
    const ids = ((asignados ?? []) as { id: string }[]).map((c) => c.id);
    const filtro = ids.length ? `vendedor_id.eq.${user.id},cliente_id.in.(${ids.join(",")})` : `vendedor_id.eq.${user.id}`;
    const [oRes, cRes, pRes] = await Promise.all([
      supabase.from("ordenes").select("id, numero, total, estado, created_at, fecha_pedido, odoo_id, aprobacion, rechazo_motivo, cliente:clientes(nombre_negocio)").or(filtro).order("created_at", { ascending: false }),
      // Solo los clientes activos asignados a este vendedor
      supabase.from("clientes").select("id, nombre_negocio").eq("activo", true).eq("vendedor_asignado_id", user.id).order("nombre_negocio"),
      supabase.from("productos").select("id, nombre, precio_base, en_oferta, precio_oferta, stock_disponible, controla_stock, producto_empaques(id, tipo_empaque_id, precio_empaque, activo, tipo_empaque:tipos_empaque(id, nombre, unidades))").eq("activo", true).order("nombre"),
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

  // No se vende por encima del disponible (existencia − comprometido en pedidos y entregas)
  const unidadesDe = (p: Prod, tipoId: string | null) => Math.max(1, Number(p.producto_empaques?.find((e) => e.tipo_empaque_id === tipoId)?.tipo_empaque?.unidades ?? 1));
  const cabe = (p: Prod, tipoId: string | null, extra: number) => {
    if (p.controla_stock === false) return true;
    const enPedido = lineas.filter((l) => l.producto_id === p.id).reduce((s, l) => s + l.cantidad * unidadesDe(p, l.tipo_empaque_id), 0);
    const disp = Number(p.stock_disponible ?? 0);
    if (enPedido + extra * unidadesDe(p, tipoId) <= disp) return true;
    toast({ title: "Sin disponible suficiente", description: `De ${p.nombre} quedan ${Math.floor(disp)} unidades disponibles.`, variant: "destructive" });
    return false;
  };

  const agregarConEmpaque = async (p: Prod, emp: ProductoEmp | null) => {
    if (!cabe(p, emp?.tipo_empaque_id || null, 1)) { setPendingEmpaque(null); setAddProd(""); return; }
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
    const p = productos.find((x) => x.id === l.producto_id);
    if (d > 0 && p && !cabe(p, l.tipo_empaque_id, d)) return [l];
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
    fetchData(); recargarResumen();
  };

  const fmt = (s: string) => new Date(s).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });

  // "En curso" con la misma definición que resumen_vendedor(): estado abierto y no rechazado
  const ABIERTOS = ["pendiente", "confirmado", "procesando", "enviado"];
  const abierto = (o: Orden) => ABIERTOS.includes(o.estado) && o.aprobacion !== "rechazada";
  const texto = q.trim().toLowerCase();
  const filtradas = ordenes.filter((o) => (estadoFiltro === "todos" || abierto(o)) &&
    (!texto || o.numero.toLowerCase().includes(texto) || (o.cliente?.nombre_negocio || "").toLowerCase().includes(texto)));
  const fechaDe = (o: Orden) => o.fecha_pedido || o.created_at;
  const { ordenadas, orden, alternar } = useOrdenTabla(filtradas, {
    numero: (o) => o.numero, cliente: (o) => o.cliente?.nombre_negocio, fecha: (o) => fechaDe(o), total: (o) => Number(o.total || 0), estado: (o) => o.estado,
  });
  const pagination = usePagination(ordenadas, 50);
  const ped = resumen?.pedidos;

  return (
    <VendedorLayout title="Pedidos">
      <KpiStrip items={[
        { label: "Pedidos de mis clientes", valor: ped?.total ?? "—", tono: "primario", onClick: () => setEstadoFiltro("todos"), activo: estadoFiltro === "todos" },
        { label: "En curso", valor: ped?.abiertos ?? "—", detalle: ped?.por_aprobar ? `${ped.por_aprobar} por aprobar` : undefined, tono: ped?.abiertos ? "alerta" : "normal", onClick: () => setEstadoFiltro("abiertos"), activo: estadoFiltro === "abiertos" },
        { label: `Pedidos de ${mesDe(resumen)}`, valor: ped ? formatPrice(ped.mes_monto) : "—", detalle: ped ? `${ped.mes_n} pedidos` : undefined, tono: "positivo",
          titulo: "Pedidos no cancelados del mes. Lo facturado está en Dashboard y Metas." },
      ]} />

      <BarraLista busqueda={q} onBusqueda={setQ} placeholder="Buscar pedido o cliente..."
        contador={loading ? undefined : `${filtradas.length} registros`}
        acciones={<Button size="sm" className="gap-1.5 bg-emerald-500 hover:bg-emerald-600" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5" />Nuevo Pedido</Button>} />

      <div className="rounded-lg border border-border bg-card">
        {loading ? <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-emerald-500" /></div>
        : ordenes.length === 0 ? <div className="py-10 text-center text-sm text-muted-foreground">Aún no hay pedidos. Crea el primero con "Nuevo Pedido".</div>
        : filtradas.length === 0 ? <div className="py-10 text-center text-sm text-muted-foreground">Sin resultados{texto ? ` para "${q.trim()}"` : ""}</div>
        : (
          <Table>
            <TableHeader><TableRow>
              <EncabezadoOrdenable clave="numero" orden={orden} onOrdenar={alternar}>Pedido</EncabezadoOrdenable>
              <EncabezadoOrdenable clave="cliente" orden={orden} onOrdenar={alternar}>Cliente</EncabezadoOrdenable>
              <EncabezadoOrdenable clave="fecha" orden={orden} onOrdenar={alternar} className="hidden sm:table-cell">Fecha</EncabezadoOrdenable>
              <EncabezadoOrdenable clave="total" orden={orden} onOrdenar={alternar} alinear="derecha">Total</EncabezadoOrdenable>
              <EncabezadoOrdenable clave="estado" orden={orden} onOrdenar={alternar}>Estado</EncabezadoOrdenable>
            </TableRow></TableHeader>
            <TableBody>
              {pagination.pageItems.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="whitespace-nowrap font-medium text-emerald-600">{o.numero}</TableCell>
                  <TableCell><span className="block max-w-[280px] truncate" title={o.cliente?.nombre_negocio || undefined}>{o.cliente?.nombre_negocio || "—"}</span></TableCell>
                  <TableCell className="hidden whitespace-nowrap text-muted-foreground sm:table-cell">{fmt(fechaDe(o))}</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-semibold">{formatPrice(Number(o.total))}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {o.aprobacion === "pendiente" ? <Badge variant="outline" className="border-amber-300 bg-amber-100 text-amber-900">Por aprobar</Badge>
                      : o.aprobacion === "rechazada" ? <Badge variant="destructive" title={o.rechazo_motivo || undefined}>No aprobado</Badge>
                      : <Badge variant={estadoConfig[o.estado]?.variant || "outline"}>{estadoConfig[o.estado]?.label || o.estado}</Badge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {!loading && filtradas.length > 0 && <DataTablePagination pagination={pagination} />}
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
                        {p.controla_stock !== false ? ` · ${Math.floor(Number(p.stock_disponible ?? 0)).toLocaleString("es-VE")} disp.` : ""}
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
                  <SelectItem value="pago_movil">Pago Móvil</SelectItem>
                  <SelectItem value="tarjeta">Tarjeta</SelectItem>
                  <SelectItem value="efectivo">Efectivo</SelectItem>
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
