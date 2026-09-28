import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { VendedorLayout } from "@/components/vendedor/VendedorLayout";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Plus, Minus, Trash2, ShoppingCart, Loader2, Package, Pencil, ChevronRight, Copy } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { BarraLista } from "@/components/datos/BarraLista";
import { useOrdenTabla, EncabezadoOrdenable } from "@/components/datos/tabla";
import { useResumenVendedor, mesDe } from "@/components/vendedor/resumen";
import { EditarPedidoDialog } from "@/components/vendedor/EditarPedidoDialog";
import { EstadoPedidoBadge } from "@/components/vendedor/estadoPedidoVendedor";
import { estadoVisible } from "@/components/pedidos/estadoPedido";
import { pedidoEditable, type ResultadoEdicion } from "@/components/portal/pedidoEditable";
import { textoPagoEdicion } from "@/components/portal/ResumenPagoPedido";
import { useCotizacion } from "@/hooks/useCotizacion";
import { ResumenCotizacion } from "@/components/portal/ResumenCotizacion";
import { EtiquetaIva } from "@/components/portal/EtiquetaIva";
import { textoIva } from "@/lib/iva";

interface Orden { id: string; numero: string; numero_guds: string | null; total: number; estado: string; estado_odoo: string | null; created_at: string;
  fecha_pedido: string | null; odoo_id: number | null; odoo_envio_error: string | null;
  aprobacion: "pendiente" | "aprobada" | "rechazada" | null; rechazo_motivo: string | null; cliente?: { nombre_negocio: string } | null;
  cliente_id: string; vendedor_id: string | null; ediciones: number | null; editado_at: string | null; }
interface Cli { id: string; nombre_negocio: string; }
interface TipoEmpaque { id: string; nombre: string; unidades: number; }
interface ProductoEmp { id: string; tipo_empaque_id: string; precio_empaque: number; activo: boolean; tipo_empaque: TipoEmpaque | null; }
interface Prod { id: string; nombre: string; precio_base: number; en_oferta: boolean | null; precio_oferta: number | null; producto_empaques?: ProductoEmp[];
  stock_disponible: number | null; controla_stock: boolean | null; impuesto_pct: number | null; impuesto_nombre: string | null; }
interface Linea { producto_id: string; tipo_empaque_id: string | null; nombre: string; empaque: string | null; precio: number; cantidad: number;
  impuesto_pct: number | null; impuesto_nombre: string | null; }
/** Pedido que se está duplicando para corregirlo (el aviso del diálogo y la nota del pedido nuevo). */
interface Duplicado { numero: string; motivo: string | null; avisos: string[] }

const METODOS = ["transferencia", "pago_movil", "tarjeta", "efectivo", "credito"];
const NOTA_VENDEDOR = "Pedido tomado por vendedor";

// Los avisos (confirmado, despachado, facturado…) enlazan a /vendedor/pedidos?pedido=<id>: se abre el detalle del pedido.
const VendedorPedidos = () => {
  const [params] = useSearchParams();
  const pedido = params.get("pedido");
  if (pedido) return <Navigate to={`/vendedor/pedidos/${encodeURIComponent(pedido)}`} replace />;
  return <ListaPedidos />;
};

const ListaPedidos = () => {
  const { formatPrice } = useCurrency();
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
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
  // Cargo de envío que estipula el vendedor (vacío = sin envío: sus pedidos no llevan envío automático)
  const [envio, setEnvio] = useState("");
  // "Duplicar y corregir": el nuevo pedido nace con el cliente y las líneas de otro (típicamente uno no aprobado o cancelado)
  const [duplicado, setDuplicado] = useState<Duplicado | null>(null);
  const duplicando = useRef<string | null>(null);
  // Clientes de su cartera (activos o no): solo en esos puede editar pedidos por aprobar
  const [asignados, setAsignados] = useState<string[]>([]);
  const [editar, setEditar] = useState<Orden | null>(null);
  const [params, setParams] = useSearchParams();
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
    setAsignados(ids);
    const [oRes, cRes, pRes] = await Promise.all([
      supabase.from("ordenes").select("id, numero, numero_guds, total, estado, estado_odoo, created_at, fecha_pedido, odoo_id, odoo_envio_error, aprobacion, rechazo_motivo, cliente_id, vendedor_id, ediciones, editado_at, cliente:clientes(nombre_negocio)").or(filtro).order("created_at", { ascending: false }),
      // Solo los clientes activos asignados a este vendedor
      supabase.from("clientes").select("id, nombre_negocio").eq("activo", true).eq("vendedor_asignado_id", user.id).order("nombre_negocio"),
      supabase.from("productos").select("id, nombre, precio_base, en_oferta, precio_oferta, stock_disponible, controla_stock, impuesto_pct, impuesto_nombre, producto_empaques(id, tipo_empaque_id, precio_empaque, activo, tipo_empaque:tipos_empaque(id, nombre, unidades))").eq("activo", true).order("nombre"),
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
  const precioEfectivo = async (productoId: string, tipoEmpaqueId: string | null, fallback: number, cliente = clienteId) => {
    const { data } = await supabase.rpc("precio_efectivo", {
      p_producto_id: productoId,
      p_tipo_empaque_id: tipoEmpaqueId,
      p_cliente_id: cliente || null,
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
      impuesto_pct: p.impuesto_pct ?? null,
      impuesto_nombre: p.impuesto_nombre ?? null,
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
  // Total exacto del servidor (cotizar_pedido): precio del cliente, IVA de cada producto (Odoo) y el envío solo si el vendedor lo indica
  const envioNum = envio.trim() === "" ? null : Number(envio.replace(",", "."));
  const envioInvalido = envioNum != null && (!Number.isFinite(envioNum) || envioNum < 0);
  const envioEstimado = envioNum != null && !envioInvalido ? Math.round(envioNum * 100) / 100 : 0;
  const itemsCotizar = useMemo(() => lineas.map((l) => ({ producto_id: l.producto_id, cantidad: l.cantidad, tipo_empaque_id: l.tipo_empaque_id })), [lineas]);
  // Sin envío automático en sus pedidos: vacío = 0 (igual que crear_orden_vendedor)
  const cotizacionEstado = useCotizacion({ clienteId, items: itemsCotizar, envio: envioEstimado, activo: open && !envioInvalido });

  const resetForm = () => { setClienteId(""); setLineas([]); setMetodo("transferencia"); setPendingEmpaque(null); setAddProd(""); setEnvio(""); setDuplicado(null); };

  // "Duplicar y corregir" (/vendedor/pedidos?duplicar=<id>, desde el detalle): abre "Nuevo pedido" con el mismo cliente, las mismas
  // líneas (precio de hoy del cliente, tope en el disponible), el método y el cargo de envío. Se envía con crear_orden_vendedor.
  const duplicarId = params.get("duplicar");
  useEffect(() => {
    if (!duplicarId || loading || duplicando.current === duplicarId) return;
    duplicando.current = duplicarId;
    // Sin el parámetro, recargar la página no vuelve a duplicar
    setParams((p) => { const n = new URLSearchParams(p); n.delete("duplicar"); return n; }, { replace: true });
    (async () => {
      const { data } = await supabase.from("ordenes")
        .select("id, numero, cliente_id, metodo_pago, envio, aprobacion, rechazo_motivo, items:orden_items(producto_id, tipo_empaque_id, cantidad, nombre_producto, producto:productos(nombre), tipo_empaque:tipos_empaque(nombre))")
        .eq("id", duplicarId).maybeSingle();
      duplicando.current = null;
      const o = data as unknown as {
        numero: string; cliente_id: string; metodo_pago: string | null; envio: number | null; aprobacion: string | null; rechazo_motivo: string | null;
        items: { producto_id: string; tipo_empaque_id: string | null; cantidad: number; nombre_producto: string | null; producto: { nombre: string } | null; tipo_empaque: { nombre: string } | null }[] | null;
      } | null;
      if (!o) { toast({ title: "No se pudo duplicar", description: "No encontramos ese pedido en tu cartera.", variant: "destructive" }); return; }
      if (!clientes.some((c) => c.id === o.cliente_id)) {
        toast({ title: "No se puede duplicar", description: "El cliente de ese pedido ya no está activo en tu cartera.", variant: "destructive" });
        return;
      }
      const avisos: string[] = [];
      const nuevas: Linea[] = [];
      for (const it of o.items ?? []) {
        const nombre = it.producto?.nombre || it.nombre_producto || "Producto";
        const p = productos.find((x) => x.id === it.producto_id);
        if (!p) { avisos.push(`${nombre}: ya no está en el catálogo.`); continue; }
        const emp = it.tipo_empaque_id ? empaquesDe(p).find((e) => e.tipo_empaque_id === it.tipo_empaque_id) ?? null : null;
        if (it.tipo_empaque_id && !emp) { avisos.push(`${nombre}: la presentación${it.tipo_empaque?.nombre ? ` ${it.tipo_empaque.nombre}` : ""} ya no está disponible.`); continue; }
        let cantidad = Math.max(1, Math.floor(Number(it.cantidad) || 0));
        if (p.controla_stock !== false) {
          const uds = unidadesDe(p, emp?.tipo_empaque_id ?? null);
          const usadas = nuevas.filter((l) => l.producto_id === p.id).reduce((s, l) => s + l.cantidad * unidadesDe(p, l.tipo_empaque_id), 0);
          const max = Math.floor((Number(p.stock_disponible ?? 0) - usadas) / uds);
          if (max <= 0) { avisos.push(`${nombre}: sin disponible, no se agregó.`); continue; }
          if (cantidad > max) { avisos.push(`${nombre}: se ajustó de ${cantidad} a ${max} (disponible).`); cantidad = max; }
        }
        const fallback = emp ? Number(emp.precio_empaque || 0) : p.en_oferta && p.precio_oferta ? Number(p.precio_oferta) : Number(p.precio_base);
        const precio = await precioEfectivo(p.id, emp?.tipo_empaque_id ?? null, fallback, o.cliente_id);
        const ex = nuevas.find((l) => l.producto_id === p.id && l.tipo_empaque_id === (emp?.tipo_empaque_id ?? null));
        if (ex) { ex.cantidad += cantidad; continue; }
        nuevas.push({ producto_id: p.id, tipo_empaque_id: emp?.tipo_empaque_id ?? null, nombre: p.nombre, empaque: emp?.tipo_empaque?.nombre ?? null, precio, cantidad,
          impuesto_pct: p.impuesto_pct ?? null, impuesto_nombre: p.impuesto_nombre ?? null });
      }
      setPendingEmpaque(null); setAddProd("");
      setClienteId(o.cliente_id);
      setLineas(nuevas);
      setMetodo(o.metodo_pago && METODOS.includes(o.metodo_pago) ? o.metodo_pago : "transferencia");
      setEnvio(Number(o.envio || 0) > 0 ? String(Number(o.envio)) : "");
      setDuplicado({ numero: o.numero, motivo: o.aprobacion === "rechazada" ? o.rechazo_motivo : null, avisos });
      setOpen(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duplicarId, loading]);

  const crear = async () => {
    if (!clienteId || lineas.length === 0) { toast({ title: "Faltan datos", description: "Elige cliente y agrega productos", variant: "destructive" }); return; }
    if (envioInvalido) { toast({ title: "Cargo de envío inválido", description: "Indica un monto de 0 o más, o déjalo vacío para no cobrar envío.", variant: "destructive" }); return; }
    setSaving(true);
    const { data, error } = await supabase.rpc("crear_orden_vendedor", {
      p_cliente_id: clienteId, p_metodo_pago: metodo,
      // La copia queda anotada para que administración sepa qué pedido corrige
      p_notas: duplicado ? `${NOTA_VENDEDOR} · corrige ${duplicado.numero}` : NOTA_VENDEDOR,
      p_items: lineas.map((l) => ({ producto_id: l.producto_id, cantidad: l.cantidad, tipo_empaque_id: l.tipo_empaque_id })),
      // Sin envío automático: solo el cargo que estipule el vendedor (null = sin envío)
      p_envio: envioNum != null ? envioEstimado : null,
    });
    setSaving(false);
    if (error) { toast({ title: "No se pudo crear el pedido", description: error.message, variant: "destructive" }); return; }
    const row = Array.isArray(data) ? data[0] : data;
    toast({ title: "Pedido creado", description: `${row?.numero ?? ""} · ${formatPrice(Number(row?.total || 0))} · queda por aprobar.` });
    setOpen(false); resetForm();
    fetchData(); recargarResumen();
  };

  // Editar pedidos por aprobar de clientes de su cartera (el servidor valida lo mismo)
  const puedeEditar = (o: Orden) => pedidoEditable(o) && asignados.includes(o.cliente_id);
  const alGuardarEdicion = (r: ResultadoEdicion) => {
    setEditar(null);
    toast({ title: "Pedido actualizado", description: `${r.numero} · ${formatPrice(r.total)}. Sigue por aprobar.${textoPagoEdicion(r, formatPrice)}` });
    fetchData(); recargarResumen();
  };
  const alBloquearEdicion = (mensaje: string) => {
    setEditar(null);
    toast({ title: "No se puede editar", description: mensaje, variant: "destructive" });
    fetchData(); recargarResumen();
  };

  const fmt = (s: string) => new Date(s).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });

  // "En curso" con la misma definición que resumen_vendedor(): estado abierto y no rechazado
  const ABIERTOS = ["pendiente", "confirmado", "procesando", "enviado"];
  const abierto = (o: Orden) => ABIERTOS.includes(o.estado) && o.aprobacion !== "rechazada";
  const texto = q.trim().toLowerCase();
  const filtradas = ordenes.filter((o) => (estadoFiltro === "todos" || abierto(o)) &&
    (!texto || o.numero.toLowerCase().includes(texto) || (o.numero_guds || "").toLowerCase().includes(texto)
      || (o.cliente?.nombre_negocio || "").toLowerCase().includes(texto)));
  const fechaDe = (o: Orden) => o.fecha_pedido || o.created_at;
  const { ordenadas, orden, alternar } = useOrdenTabla(filtradas, {
    numero: (o) => o.numero, cliente: (o) => o.cliente?.nombre_negocio, fecha: (o) => fechaDe(o), total: (o) => Number(o.total || 0), estado: (o) => estadoVisible(o).etiqueta,
  });
  const pagination = usePagination(ordenadas, 50);
  const ped = resumen?.pedidos;
  const abrirDetalle = (o: Orden) => navigate(`/vendedor/pedidos/${o.id}`);
  // Número de Odoo y, si el pedido nació en GUDS, el número con el que el vendedor lo conoció
  const antes = (o: Orden) => (o.numero_guds && o.numero_guds !== o.numero ? o.numero_guds : null);
  const marcaEditado = (o: Orden) => (o.ediciones ?? 0) > 0 && (
    <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
      title={`Editado ${o.ediciones === 1 ? "1 vez" : `${o.ediciones} veces`}${o.editado_at ? ` · último cambio: ${fmt(o.editado_at)}` : ""}`}
      data-testid="pedido-editado">
      Editado
    </Badge>
  );

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
          <>
            {/* Teléfono: tarjetas con número, cliente, total, estado y fecha a la vista (sin desplazar de lado). Tocar abre el detalle. */}
            <ul className="divide-y divide-border md:hidden" data-testid="pedidos-tarjetas">
              {pagination.pageItems.map((o) => (
                // Enlace "estirado" (after:inset-0): toda la tarjeta abre el detalle y el botón Editar queda encima, sin anidar controles
                <li key={o.id} className="relative px-3 py-2.5 hover:bg-muted/40 active:bg-muted/60" data-testid="pedido-tarjeta">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <Link to={`/vendedor/pedidos/${o.id}`} className="truncate text-sm font-semibold text-emerald-700 after:absolute after:inset-0 dark:text-emerald-400">{o.numero}</Link>
                      {marcaEditado(o)}
                    </div>
                    <span className="flex shrink-0 items-center gap-1 text-sm font-semibold tabular-nums">
                      {formatPrice(Number(o.total))}<ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                    </span>
                  </div>
                  <p className="truncate pr-5 text-[13px] text-foreground">{o.cliente?.nombre_negocio || "—"}</p>
                  <div className="mt-1 flex min-h-6 items-center gap-2">
                    <EstadoPedidoBadge pedido={o} className="px-2 py-0 text-[11px]" />
                    <span className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground">{antes(o) ? `${antes(o)} · ` : ""}{fmt(fechaDe(o))}</span>
                    {puedeEditar(o) && (
                      <Button size="sm" variant="outline" className="relative z-10 h-9 shrink-0 gap-1.5 px-2.5" onClick={() => setEditar(o)}
                        aria-label={`Editar pedido ${o.numero}`} data-testid="editar-pedido-movil">
                        <Pencil className="h-3.5 w-3.5" />Editar
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {/* Escritorio: tabla compacta; la fila abre el detalle */}
            <div className="hidden md:block">
              <Table>
                <TableHeader><TableRow>
                  <EncabezadoOrdenable clave="numero" orden={orden} onOrdenar={alternar}>Pedido</EncabezadoOrdenable>
                  <EncabezadoOrdenable clave="cliente" orden={orden} onOrdenar={alternar}>Cliente</EncabezadoOrdenable>
                  <EncabezadoOrdenable clave="fecha" orden={orden} onOrdenar={alternar}>Fecha</EncabezadoOrdenable>
                  <EncabezadoOrdenable clave="total" orden={orden} onOrdenar={alternar} alinear="derecha">Total</EncabezadoOrdenable>
                  <EncabezadoOrdenable clave="estado" orden={orden} onOrdenar={alternar}>Estado</EncabezadoOrdenable>
                  <TableHead className="w-px"><span className="sr-only">Acciones</span></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {pagination.pageItems.map((o) => (
                    <TableRow key={o.id} className="cursor-pointer" onClick={() => abrirDetalle(o)} data-testid="pedido-fila">
                      <TableCell className="whitespace-nowrap">
                        <Link to={`/vendedor/pedidos/${o.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-emerald-600 hover:underline">{o.numero}</Link>
                        {antes(o) && <span className="ml-1.5 text-[11px] text-muted-foreground">antes {antes(o)}</span>}
                        {(o.ediciones ?? 0) > 0 && <span className="ml-1.5">{marcaEditado(o)}</span>}
                      </TableCell>
                      <TableCell><span className="block max-w-[280px] truncate" title={o.cliente?.nombre_negocio || undefined}>{o.cliente?.nombre_negocio || "—"}</span></TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{fmt(fechaDe(o))}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{formatPrice(Number(o.total))}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <EstadoPedidoBadge pedido={o} />
                        {o.aprobacion === "rechazada" && o.rechazo_motivo && (
                          <span className="ml-1.5 inline-block max-w-[220px] truncate align-middle text-xs text-muted-foreground" title={o.rechazo_motivo}>{o.rechazo_motivo}</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap py-1 text-right">
                        {puedeEditar(o) && (
                          <Button size="sm" variant="outline" className="h-8 gap-1.5 px-2.5" onClick={(e) => { e.stopPropagation(); setEditar(o); }}
                            aria-label={`Editar pedido ${o.numero}`} data-testid="editar-pedido">
                            <Pencil className="h-3.5 w-3.5" />Editar
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
        {!loading && filtradas.length > 0 && <DataTablePagination pagination={pagination} />}
      </div>

      {/* Nuevo pedido */}
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nuevo pedido</DialogTitle>
            {duplicado && <DialogDescription>Copia de {duplicado.numero}: revisa y corrige antes de crearlo.</DialogDescription>}
          </DialogHeader>
          {/* min-w-0: sin esto, un nombre largo (truncate) ensancha la columna del grid y el diálogo se sale de la pantalla en el teléfono */}
          <div className="min-w-0 space-y-3 py-2">
            {duplicado && (
              <div className="rounded-lg border border-sky-300 bg-sky-50 p-3 text-sm text-sky-950 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100" data-testid="aviso-duplicado">
                <p className="flex items-center gap-1.5 font-medium"><Copy className="h-4 w-4 shrink-0" />Mismo cliente y productos que {duplicado.numero}, con los precios de hoy.</p>
                {duplicado.motivo && <p className="mt-1 text-xs"><span className="font-semibold">No se aprobó por:</span> {duplicado.motivo}</p>}
                {duplicado.avisos.length > 0 && (
                  <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs" data-testid="avisos-duplicado">
                    {duplicado.avisos.map((a) => <li key={a}>{a}</li>)}
                  </ul>
                )}
              </div>
            )}
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
                        {p.nombre} · {formatPrice(Number(p.precio_base))}{textoIva(p.impuesto_pct) ? ` · ${textoIva(p.impuesto_pct)}` : ""}{n > 1 ? ` · ${n} presentaciones` : ""}
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
              <div className="rounded-lg border border-border divide-y" data-testid="lineas-nuevo">
                {lineas.map((l) => {
                  const key = l.producto_id + "|" + (l.tipo_empaque_id || "");
                  return (
                    <div key={key} className="flex items-center justify-between gap-2 p-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="truncate">{l.nombre}{l.empaque ? <span className="text-muted-foreground"> · {l.empaque}</span> : null}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatPrice(l.precio)} c/u
                          {l.impuesto_pct != null && <> · <EtiquetaIva pct={l.impuesto_pct} nombre={l.impuesto_nombre} className="text-xs" /></>}
                        </p>
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
            <div><Label htmlFor="envio-nuevo">Cargo de envío (USD) <span className="font-normal text-muted-foreground">· opcional</span></Label>
              <Input id="envio-nuevo" type="number" inputMode="decimal" min={0} step="0.01" placeholder="Sin envío" value={envio}
                onChange={(e) => setEnvio(e.target.value)} data-testid="envio-nuevo" />
              {envioInvalido
                ? <p className="mt-1 text-xs text-destructive">Indica un monto válido (0 o más).</p>
                : <p className="mt-1 text-xs text-muted-foreground">Tus pedidos no llevan envío automático: vacío = sin envío.</p>}
            </div>
            {lineas.length > 0 && (
              <div className="rounded-lg bg-muted p-3" data-testid="resumen-nuevo">
                {envioInvalido
                  ? <p className="text-sm text-muted-foreground">Corrige el cargo de envío para ver el total.</p>
                  : <ResumenCotizacion {...cotizacionEstado} envioCero="Sin envío" vacio="Elige el cliente para ver el total con su IVA." />}
              </div>
            )}
            <p className="text-xs text-muted-foreground">El IVA depende de cada producto (exento o gravado, como en Odoo) y el envío solo va si lo indicas. GUDS confirma el total al crear el pedido.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); resetForm(); }} disabled={saving}>Cancelar</Button>
            <Button className="bg-emerald-500 hover:bg-emerald-600" onClick={crear} disabled={saving || !clienteId || lineas.length === 0 || envioInvalido}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><ShoppingCart className="h-4 w-4 mr-1" />Crear pedido</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Editar pedido por aprobar */}
      <EditarPedidoDialog orden={editar} onCerrar={() => setEditar(null)} onGuardado={alGuardarEdicion} onYaNoEditable={alBloquearEdicion} />
    </VendedorLayout>
  );
};

export default VendedorPedidos;
