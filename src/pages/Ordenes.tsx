import { useState, useEffect, useMemo, Fragment } from "react";
import { cn } from "@/lib/utils";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Link, useSearchParams } from "react-router-dom";
import { EstadoTransferencia, TIPO_TRANSF, fmtFechaHora } from "@/components/inventario/EstadoTransferencia";
import { Plus, Eye, Loader2, X, Users, ChevronRight, FileText, CheckCircle2, XCircle, RotateCw, AlertTriangle, Clock } from "lucide-react";
import { supabase, Cliente, Producto } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/hooks/use-toast";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { ResumenPagoPedido } from "@/components/portal/ResumenPagoPedido";
import { LineaTiempoPedido } from "@/components/pedidos/LineaTiempoPedido";
import { OdooBadge } from "@/components/OdooBadge";
import { BarraLista } from "@/components/datos/BarraLista";
import { useOrdenTabla, EncabezadoOrdenable, exportarCSV, BotonExportar } from "@/components/datos/tabla";
import { FichaCampos } from "@/components/datos/FichaCampos";
import { useColumnas } from "@/components/datos/columnas";
import {
  FiltrosLista, useFiltros, useFiltroEmpresa, opcionesDe, opcionesTexto, opcionesPrueba, pasaPrueba, coincide, coincideTexto, enRango,
  contadorFiltrado, type OpcionPrueba,
} from "@/components/datos/FiltrosLista";
import { estadoVisible, claseTono, type ClaveEstado } from "@/components/pedidos/estadoPedido";
import { useCotizacion } from "@/hooks/useCotizacion";
import { ResumenCotizacion } from "@/components/portal/ResumenCotizacion";
import { EtiquetaIva } from "@/components/portal/EtiquetaIva";
import { textoIva } from "@/lib/iva";

interface OrdenDB {
  id: string;
  numero: string;
  odoo_id?: number | null;   // orden de Odoo: estado y facturación se manejan en Odoo
  numero_guds?: string | null;      // pedido creado en GUDS y enviado a Odoo (Fase 9b)
  aprobacion?: 'pendiente' | 'aprobada' | 'rechazada' | null;  // pedidos de GUDS: se aprueban antes de ir a Odoo
  rechazo_motivo?: string | null;
  odoo_envio_error?: string | null;
  odoo_envio_aviso?: string | null;
  aprobado_at?: string | null;
  odoo_enviado_at?: string | null;
  editado_at?: string | null;       // editado por el cliente o el vendedor mientras estaba por aprobar (19p)
  vendedor_id?: string | null;      // vendedor en GUDS (asignable si el pedido no tiene, 19x)
  empresa_id?: string | null;
  vendedor?: { nombre: string; apellido: string | null } | null;
  ediciones?: number | null;
  cliente_id: string;
  estado: string;
  estado_odoo?: string | null;
  estado_pago?: string | null;
  subtotal: number;
  impuesto: number;
  descuento: number;
  envio: number;
  total: number;
  metodo_pago: string;
  moneda_original: string | null;
  vendedor_odoo: string | null;
  comprobante_url: string | null;
  referencia_pago: string | null;
  notas: string;
  fecha_pedido: string | null;
  fecha_entrega: string | null;
  created_at: string;
  cliente?: {
    nombre_negocio: string;
    direccion: string;
    ciudad: string;
    telefono: string;
  };
  items?: OrdenItem[];
}

interface OrdenItem {
  id: string;
  producto_id: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
  nombre_producto?: string;
  producto?: {
    nombre: string;
    imagen_emoji: string;
    imagen_url: string;
  };
}

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; color: string }> = {
  pendiente: { label: "Pendiente", variant: "secondary", color: "bg-gray-500" },
  confirmado: { label: "Confirmado", variant: "default", color: "bg-blue-500" },
  procesando: { label: "Procesando", variant: "default", color: "bg-yellow-500" },
  enviado: { label: "Enviado", variant: "outline", color: "bg-purple-500" },
  en_camino: { label: "En Camino", variant: "outline", color: "bg-purple-500" },
  entregado: { label: "Entregado", variant: "default", color: "bg-green-500" },
  completado: { label: "Completado", variant: "default", color: "bg-green-500" },
  cancelado: { label: "Cancelado", variant: "destructive", color: "bg-red-500" },
};

const Ordenes = () => {
  const [ordenes, setOrdenes] = useState<OrdenDB[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [grouped, setGrouped] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (k: string) => setOpenGroups((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const [selectedOrder, setSelectedOrder] = useState<OrdenDB | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [facturaPorOrden, setFacturaPorOrden] = useState<Record<string, { id: string; numero: string }>>({});
  const [facturando, setFacturando] = useState(false);
  const [despachos, setDespachos] = useState<{ id: string; numero: string; tipo: string; estado: string; fecha_programada: string | null; fecha_realizada: string | null; ubicacion_origen: string | null }[]>([]);
  const [params, setParams] = useSearchParams();
  // Aprobación de pedidos de clientes y vendedores (Fase 9b): al aprobar se crean en Odoo como cotización (filtro ?aprobacion=pendiente)
  const [rechazo, setRechazo] = useState<{ id: string; numero: string } | null>(null);
  // Asignar vendedor a un pedido que no tiene (19x)
  const [asignarVend, setAsignarVend] = useState<OrdenDB | null>(null);
  const [vendedores, setVendedores] = useState<{ id: string; nombre: string; empresas: string[] }[]>([]);
  const [vendElegido, setVendElegido] = useState("");
  const [asignando, setAsignando] = useState(false);
  const nombreVendedor = (o: OrdenDB) => (o.vendedor ? `${o.vendedor.nombre} ${o.vendedor.apellido || ""}`.trim() : o.vendedor_odoo || null);
  const abrirAsignarVendedor = async (o: OrdenDB) => {
    setAsignarVend(o);
    setVendElegido((o.cliente as { vendedor_asignado_id?: string | null } | undefined)?.vendedor_asignado_id || "");
    if (vendedores.length === 0) {
      // Vendedores de la empresa (por su cartera de Odoo; sin usuarios de prueba) — vendedores_empresa, fase 21a
      const { data } = await supabase.rpc("vendedores_empresa");
      setVendedores(((data as { id: string; nombre: string; apellido: string | null; activo: boolean; empresas: string[] | null }[] | null) ?? [])
        .filter((u) => u.activo).map((u) => ({ id: u.id, nombre: `${u.nombre} ${u.apellido || ""}`.trim(), empresas: u.empresas ?? [] })));
    }
  };
  const confirmarVendedor = async () => {
    if (!asignarVend || !vendElegido) return;
    setAsignando(true);
    const { error } = await supabase.rpc("asignar_vendedor_orden", { p_orden_id: asignarVend.id, p_vendedor_id: vendElegido });
    setAsignando(false);
    if (error) { toast({ title: "No se pudo asignar", description: error.message, variant: "destructive" }); return; }
    toast({ title: `Vendedor asignado a ${asignarVend.numero}` });
    setAsignarVend(null);
    fetchOrdenes();
  };
  const [motivoRechazo, setMotivoRechazo] = useState("");
  const [procesandoAprobacion, setProcesandoAprobacion] = useState(false);

  // New order form
  const [newOrder, setNewOrder] = useState({
    cliente_id: "",
    metodo_pago: "transferencia",
    notas: "",
    items: [] as { producto_id: string; cantidad: number; precio: number }[],
  });
  const [selectedProducto, setSelectedProducto] = useState("");
  const [cantidad, setCantidad] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  const { formatPrice } = useCurrency();
  const { toast } = useToast();

  useEffect(() => {
    fetchOrdenes();
    fetchClientes();
    fetchProductos();
  }, []);

  // Enlace directo a una orden (?orden=<id>), p. ej. desde una transferencia de Odoo
  useEffect(() => {
    const id = params.get("orden");
    if (!id || ordenes.length === 0) return;
    const o = ordenes.find((x) => x.id === id);
    if (o) { setSelectedOrder(o); setIsDetailOpen(true); }
    params.delete("orden");
    setParams(params, { replace: true });
  }, [ordenes, params, setParams]);

  // Despachos de Odoo (transferencias) de la orden abierta
  useEffect(() => {
    setDespachos([]);
    if (!selectedOrder?.odoo_id) return;
    supabase.from("transferencias").select("id, numero, tipo, estado, fecha_programada, fecha_realizada, ubicacion_origen")
      .eq("orden_id", selectedOrder.id).order("fecha_programada")
      .then(({ data }) => setDespachos((data as typeof despachos | null) ?? []));
  }, [selectedOrder?.id, selectedOrder?.odoo_id]);

  const fetchOrdenes = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('ordenes')
      .select(`
        *,
        cliente:clientes(nombre_negocio, direccion, ciudad, telefono, vendedor_asignado_id),
        vendedor:usuarios!ordenes_vendedor_id_fkey(nombre, apellido),
        items:orden_items(*, producto:productos(nombre, imagen_emoji, imagen_url))
      `)
      .order('created_at', { ascending: false })
      .limit(5000); // el default de Supabase es 1000; con el histórico importado hay más
    
    if (data) setOrdenes(data);
    setLoading(false);

    const { data: facs } = await supabase
      .from("facturas")
      .select("id, numero, orden_id")
      .not("orden_id", "is", null)
      .eq("tipo", "factura")
      .neq("estado_pago", "anulado");
    if (facs) {
      setFacturaPorOrden(Object.fromEntries((facs as { id: string; numero: string; orden_id: string }[]).map((f) => [f.orden_id, { id: f.id, numero: f.numero }])));
    }
  };

  const facturarOrden = async (ordenId: string) => {
    setFacturando(true);
    const { data, error } = await supabase.rpc("facturar_orden", { p_orden_id: ordenId });
    setFacturando(false);
    if (error) {
      toast({ title: "No se pudo facturar", description: error.message, variant: "destructive" });
      return;
    }
    // Buscamos el número recién generado para el toast (facturar_orden devuelve solo el id).
    const { data: fac } = await supabase.from("facturas").select("numero").eq("id", data as string).maybeSingle();
    toast({ title: "Factura generada", description: fac?.numero ? `Factura ${fac.numero} creada` : "Factura creada" });
    fetchOrdenes();
  };

  const fetchClientes = async () => {
    const { data } = await supabase
      .from('clientes')
      .select('*')
      .eq('activo', true)
      .order('nombre_negocio');
    if (data) setClientes(data);
  };

  const fetchProductos = async () => {
    const { data } = await supabase
      .from('productos')
      .select('*')
      .eq('activo', true)
      .order('nombre');
    if (data) setProductos(data);
  };

  const updateOrderStatus = async (orderId: string, newStatus: string) => {
    setUpdatingStatus(true);
    const { error } = await supabase
      .from('ordenes')
      .update({ estado: newStatus, updated_at: new Date().toISOString() })
      .eq('id', orderId);
    
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Actualizado", description: `Estado cambiado a ${statusConfig[newStatus]?.label || newStatus}` });
      fetchOrdenes();
      if (selectedOrder?.id === orderId) {
        setSelectedOrder({ ...selectedOrder, estado: newStatus });
      }
    }
    setUpdatingStatus(false);
  };

  const addItemToOrder = () => {
    if (!selectedProducto || cantidad < 1) return;
    
    const producto = productos.find(p => p.id === selectedProducto);
    if (!producto) return;
    
    const precio = producto.en_oferta && producto.precio_oferta ? producto.precio_oferta : producto.precio_base;
    
    setNewOrder(prev => ({
      ...prev,
      items: [...prev.items, { producto_id: selectedProducto, cantidad, precio }]
    }));
    
    setSelectedProducto("");
    setCantidad(1);
  };

  const removeItemFromOrder = (index: number) => {
    setNewOrder(prev => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index)
    }));
  };

  const createOrder = async () => {
    if (!newOrder.cliente_id || newOrder.items.length === 0) {
      toast({ title: "Error", description: "Selecciona un cliente y agrega productos", variant: "destructive" });
      return;
    }

    setSubmitting(true);

    // Crear la orden de forma atómica en el servidor (numera, aplica IVA/envío,
    // inserta cabecera + items). Misma lógica de dinero que el checkout del cliente.
    const { data, error } = await supabase.rpc('crear_orden_admin', {
      p_cliente_id: newOrder.cliente_id,
      p_metodo_pago: newOrder.metodo_pago,
      p_notas: newOrder.notas,
      p_items: newOrder.items.map(item => ({
        producto_id: item.producto_id,
        cantidad: item.cantidad,
        precio_unitario: item.precio,
      })),
    });

    if (error) {
      toast({ title: "No se pudo crear la orden", description: error.message, variant: "destructive" });
      setSubmitting(false);
      return;
    }

    const creada = Array.isArray(data) ? data[0] : data;
    toast({ title: "Orden creada", description: `Orden ${creada?.numero ?? ''} creada exitosamente` });
    setIsCreateOpen(false);
    setNewOrder({ cliente_id: "", metodo_pago: "transferencia", notas: "", items: [] });
    fetchOrdenes();
    setSubmitting(false);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  };

  const verComprobanteOrden = async (path: string) => {
    const { data, error } = await supabase.storage.from("documentos").createSignedUrl(path, 120);
    if (error || !data?.signedUrl) {
      toast({ title: "No se pudo abrir el comprobante", description: error?.message, variant: "destructive" });
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const fechaOrden = (o: OrdenDB) => o.fecha_pedido || o.created_at;

  // ---- Filtros (en la URL) ----
  // Estado visible: el mismo contrato que ven el vendedor y el cliente (estadoPedido.ts)
  const ESTADOS_VISIBLES: { clave: ClaveEstado; etiqueta: string }[] = [
    { clave: "por_aprobar", etiqueta: "Por aprobar" }, { clave: "registrandose", etiqueta: "Aprobado (registrándose)" },
    { clave: "cotizacion", etiqueta: "Cotización" }, { clave: "confirmado", etiqueta: "Confirmado" },
    { clave: "en_preparacion", etiqueta: "En preparación" }, { clave: "despachado_parcial", etiqueta: "Despacho parcial" },
    { clave: "entregado", etiqueta: "Despachado" }, { clave: "cancelado", etiqueta: "Cancelado" }, { clave: "rechazado", etiqueta: "No aprobado" },
  ];
  const pruebasEstado: OpcionPrueba<OrdenDB>[] = ESTADOS_VISIBLES.map((e) => ({ valor: e.clave, etiqueta: e.etiqueta, prueba: (o) => estadoVisible(o).clave === e.clave }));
  const pruebasAprobacion: OpcionPrueba<OrdenDB>[] = [
    { valor: "pendiente", etiqueta: "Por aprobar", prueba: (o) => o.aprobacion === "pendiente" },
    { valor: "aprobada", etiqueta: "Aprobados", prueba: (o) => o.aprobacion === "aprobada" },
    { valor: "error", etiqueta: "Error al enviar a Odoo", prueba: (o) => o.aprobacion === "aprobada" && !o.odoo_id && !!o.odoo_envio_error },
    { valor: "rechazada", etiqueta: "Rechazados", prueba: (o) => o.aprobacion === "rechazada" },
    { valor: "no_aplica", etiqueta: "Sin aprobación (de Odoo)", prueba: (o) => !o.aprobacion },
  ];
  const pruebasOrigen: OpcionPrueba<OrdenDB>[] = [
    { valor: "guds", etiqueta: "Creado en GUDS", prueba: (o) => !o.odoo_id || !!o.numero_guds },
    { valor: "odoo", etiqueta: "Creado en Odoo", prueba: (o) => !!o.odoo_id && !o.numero_guds },
  ];
  const pruebasPago: OpcionPrueba<OrdenDB>[] = [
    { valor: "pendiente", etiqueta: "Pendiente de pago", prueba: (o) => (o.estado_pago || "pendiente") === "pendiente" },
    { valor: "parcial", etiqueta: "Pago parcial", prueba: (o) => o.estado_pago === "parcial" },
    { valor: "pagado", etiqueta: "Pagado", prueba: (o) => o.estado_pago === "pagado" },
  ];
  const filtroEmpresa = useFiltroEmpresa(ordenes);
  const f = useFiltros([
    { clave: "estado", etiqueta: "Estado", principal: true, opciones: opcionesPrueba(ordenes, pruebasEstado, true) },
    { clave: "fecha", etiqueta: "Fecha", tipo: "fecha", principal: true },
    { clave: "vendedor", etiqueta: "Vendedor", principal: true, opciones: opcionesTexto(ordenes, (o) => nombreVendedor(o), "Sin vendedor") },
    { clave: "cliente", etiqueta: "Cliente", todos: "Todos los clientes", opciones: opcionesDe(ordenes, (o) => o.cliente_id, (o) => o.cliente?.nombre_negocio ?? "—") },
    { clave: "aprobacion", etiqueta: "Aprobación", todos: "Todas", opciones: opcionesPrueba(ordenes, pruebasAprobacion) },
    { clave: "pago", etiqueta: "Pago", todos: "Todos", opciones: opcionesPrueba(ordenes, pruebasPago) },
    { clave: "origen", etiqueta: "Origen", todos: "GUDS y Odoo", opciones: opcionesPrueba(ordenes, pruebasOrigen) },
    filtroEmpresa,
  ]);
  const soloPorAprobar = f.v("aprobacion") === "pendiente";
  const termino = searchTerm.toLowerCase();
  const filteredOrdenes = ordenes.filter(orden => {
    const matchesSearch =
      orden.numero?.toLowerCase().includes(termino) ||
      orden.cliente?.nombre_negocio?.toLowerCase().includes(termino);
    return matchesSearch && pasaPrueba(pruebasEstado, f.v("estado"), orden) && enRango(fechaOrden(orden), f.v("fecha"))
      && coincideTexto(nombreVendedor(orden), f.v("vendedor")) && coincide(orden.cliente_id, f.v("cliente"))
      && pasaPrueba(pruebasAprobacion, f.v("aprobacion"), orden) && pasaPrueba(pruebasPago, f.v("pago"), orden)
      && pasaPrueba(pruebasOrigen, f.v("origen"), orden) && (!filtroEmpresa || coincide(orden.empresa_id, f.v("empresa")));
  });

  const { ordenadas, orden, alternar } = useOrdenTabla(filteredOrdenes, {
    numero: (o) => o.numero, cliente: (o) => o.cliente?.nombre_negocio, items: (o) => o.items?.length ?? 0,
    total: (o) => Number(o.total || 0), estado: (o) => estadoVisible(o).etiqueta, fecha: (o) => fechaOrden(o), metodo: (o) => o.metodo_pago,
  });
  const pagination = usePagination(ordenadas, 50, f.firma);
  const exportar = () => exportarCSV("ordenes", ordenadas, [
    { titulo: "Orden", valor: (o) => o.numero }, { titulo: "Origen", valor: (o) => (o.odoo_id ? "Odoo" : "GUDS") },
    { titulo: "Cliente", valor: (o) => o.cliente?.nombre_negocio }, { titulo: "Items", valor: (o) => o.items?.length ?? 0 },
    { titulo: "Total USD", valor: (o) => Number(o.total || 0) }, { titulo: "Estado", valor: (o) => estadoVisible(o).etiqueta },
    { titulo: "Estado en Odoo", valor: (o) => statusConfig[o.estado]?.label || o.estado }, { titulo: "Pago", valor: (o) => o.estado_pago },
    { titulo: "Fecha", valor: (o) => fechaOrden(o)?.slice(0, 10) }, { titulo: "Método de pago", valor: (o) => o.metodo_pago },
    { titulo: "Vendedor", valor: (o) => nombreVendedor(o) },
  ]);

  const grupos = useMemo(() => {
    const m = new Map<string, { key: string; nombre: string; orders: OrdenDB[]; total: number }>();
    for (const o of ordenadas) {
      const key = o.cliente_id || "sin";
      const g = m.get(key) || { key, nombre: o.cliente?.nombre_negocio || "Sin cliente", orders: [], total: 0 };
      g.orders.push(o); g.total += Number(o.total || 0);
      m.set(key, g);
    }
    return [...m.values()].sort((a, b) => b.orders.length - a.orders.length);
  }, [ordenadas]);

  const renderOrderRow = (orden: OrdenDB) => (
    <TableRow
      key={orden.id}
      className="cursor-pointer"
      onClick={() => { setSelectedOrder(orden); setIsDetailOpen(true); }}
    >
      <TableCell className="whitespace-nowrap font-medium text-primary">
        <span className="flex items-center gap-1.5">
          {orden.numero}
          {orden.odoo_id ? <OdooBadge /> : <Badge variant="outline" className="px-1 py-0 text-[10px]" title="Creado en GUDS · pendiente de enviar a Odoo">GUDS</Badge>}
          {orden.numero_guds && <Badge variant="secondary" className="px-1 py-0 text-[10px] font-normal" title={`Creado en GUDS como ${orden.numero_guds} y enviado a Odoo`}>{orden.numero_guds}</Badge>}
          {estadoEnvio(orden) && <Badge variant="outline" className={cn("px-1.5 py-0 text-[10px] font-medium", estadoEnvio(orden)!.cls)} title={orden.odoo_envio_error || orden.rechazo_motivo || undefined}>{estadoEnvio(orden)!.txt}</Badge>}
          {!nombreVendedor(orden) && (
            <button type="button" onClick={(e) => { e.stopPropagation(); abrirAsignarVendedor(orden); }}
              className="rounded border border-dashed border-amber-400 bg-amber-50 px-1 py-0 text-[10px] font-medium text-amber-900 hover:bg-amber-100"
              title="Este pedido no tiene vendedor: asignar">Sin vendedor</button>
          )}
          {!!orden.ediciones && orden.aprobacion === "pendiente" && (
            <Badge variant="outline" className="px-1 py-0 text-[10px] font-normal" title={`Editado ${orden.ediciones} ${orden.ediciones === 1 ? "vez" : "veces"} antes de aprobar${orden.editado_at ? ` · último ${formatDate(orden.editado_at)}` : ""}`}>Editado</Badge>
          )}
        </span>
      </TableCell>
      <TableCell className="font-medium">
        <span className="block max-w-[260px] truncate" title={orden.cliente?.nombre_negocio || undefined}>{orden.cliente?.nombre_negocio || 'N/A'}</span>
      </TableCell>
      <TableCell className="text-right">{orden.items?.length || 0}</TableCell>
      <TableCell className="whitespace-nowrap text-right font-semibold">{formatPrice(orden.total)}</TableCell>
      <TableCell className="whitespace-nowrap">
        {/* Estado visible (el mismo que ven el vendedor y el cliente); el estado técnico va en el título */}
        <Badge variant="outline" className={cn("font-medium", claseTono[estadoVisible(orden).tono])} title={`Estado: ${statusConfig[orden.estado]?.label || orden.estado}`}>
          {estadoVisible(orden).etiqueta}
        </Badge>
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(fechaOrden(orden))}</TableCell>
      <TableCell className="whitespace-nowrap capitalize text-muted-foreground">{orden.metodo_pago?.replace('_', ' ') || 'N/A'}</TableCell>
    </TableRow>
  );

  // Total exacto de la orden nueva (cotizar_pedido): precio del cliente, IVA de cada producto (Odoo) y envío, como crear_orden_admin
  const cotizacionEstado = useCotizacion({ clienteId: newOrder.cliente_id || null, items: newOrder.items, activo: isCreateOpen });
  const clienteNuevo = clientes.find((c) => c.id === newOrder.cliente_id) as (Cliente & { empresa_id?: string | null }) | undefined;
  // Solo productos de la empresa del cliente (no se mezclan GUDS y Quirutec en un pedido)
  const productosVenta = clienteNuevo?.empresa_id
    ? productos.filter((p) => !p.empresa_id || p.empresa_id === clienteNuevo.empresa_id)
    : productos;
  const porAprobar = ordenes.filter((o) => o.aprobacion === "pendiente").length;

  // Mantener abierto el detalle con los datos frescos después de aprobar/rechazar (el envío a Odoo tarda unos segundos)
  useEffect(() => {
    if (!selectedOrder) return;
    const fresco = ordenes.find((o) => o.id === selectedOrder.id);
    if (fresco && fresco !== selectedOrder) setSelectedOrder(fresco);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordenes]);

  const seguirEnvio = () => { [4000, 10000, 20000, 40000, 70000].forEach((ms) => setTimeout(() => fetchOrdenes(), ms)); };

  // Aprobar crea la cotización en Odoo (no se puede borrar desde GUDS): se confirma antes
  const [confirmarAprobacion, setConfirmarAprobacion] = useState<OrdenDB | null>(null);
  const aprobarPedido = async (orden: OrdenDB) => {
    setProcesandoAprobacion(true);
    const { data, error } = await supabase.rpc("aprobar_pedido", { p_orden_id: orden.id });
    setProcesandoAprobacion(false);
    if (error) { toast({ title: "No se pudo aprobar", description: error.message, variant: "destructive" }); return; }
    toast({ title: `Pedido ${orden.numero} aprobado`, description: (data as { mensaje?: string } | null)?.mensaje });
    fetchOrdenes(); seguirEnvio();
  };

  const confirmarRechazo = async () => {
    if (!rechazo) return;
    if (!motivoRechazo.trim()) { toast({ title: "Indica el motivo del rechazo", variant: "destructive" }); return; }
    setProcesandoAprobacion(true);
    const { error } = await supabase.rpc("rechazar_pedido", { p_orden_id: rechazo.id, p_motivo: motivoRechazo.trim() });
    setProcesandoAprobacion(false);
    if (error) { toast({ title: "No se pudo rechazar", description: error.message, variant: "destructive" }); return; }
    toast({ title: `Pedido ${rechazo.numero} rechazado`, description: "Se avisó al cliente y al vendedor." });
    setRechazo(null); setMotivoRechazo("");
    fetchOrdenes();
  };

  const reintentarEnvio = async (orden: OrdenDB) => {
    const { error } = await supabase.rpc("reintentar_envio_pedido", { p_orden_id: orden.id });
    if (error) { toast({ title: "No se pudo reintentar", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Reintentando el envío a Odoo" });
    fetchOrdenes(); seguirEnvio();
  };

  // Estado del pedido frente a la aprobación y el envío a Odoo
  const estadoEnvio = (o: OrdenDB) =>
    o.aprobacion === "pendiente" ? { txt: "Por aprobar", cls: "border-amber-300 bg-amber-100 text-amber-900" }
    : o.aprobacion === "rechazada" ? { txt: "Rechazado", cls: "border-destructive/40 bg-destructive/10 text-destructive" }
    : o.aprobacion === "aprobada" && !o.odoo_id ? (o.odoo_envio_error ? { txt: "Error al enviar a Odoo", cls: "border-destructive/40 bg-destructive/10 text-destructive" } : { txt: "Enviando a Odoo…", cls: "border-sky-300 bg-sky-100 text-sky-900" })
    : null;

  const cols = useColumnas("ordenes", [{ etiqueta: "Orden", fija: true }, { etiqueta: "Cliente" }, { etiqueta: "Items" }, { etiqueta: "Total" }, { etiqueta: "Estado" }, { etiqueta: "Fecha" }, { etiqueta: "Método Pago" }]);
  return (
    <MainLayout title="Órdenes">
      {cols.estilo}
      <BarraLista
        busqueda={searchTerm}
        onBusqueda={setSearchTerm}
        placeholder="Buscar por ID, cliente..."
        filtros={
          <>
          <Button type="button" size="sm" variant={soloPorAprobar ? "default" : "outline"}
            className={cn("gap-1.5", !soloPorAprobar && porAprobar > 0 && "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100")}
            onClick={() => f.set("aprobacion", soloPorAprobar ? "" : "pendiente")} aria-pressed={soloPorAprobar}
            title="Pedidos de clientes y vendedores que esperan aprobación antes de ir a Odoo">
            <Clock className="h-3.5 w-3.5" /> Por aprobar ({porAprobar})
          </Button>
          <FiltrosLista filtros={f} resultados={filteredOrdenes.length} />
          </>
        }
        contador={loading ? undefined : contadorFiltrado(filteredOrdenes.length, ordenes.length, f.activos || !!searchTerm)}
        acciones={
          <>
            {cols.selector}
            <Button variant={grouped ? "default" : "outline"} size="sm" className="gap-1.5" onClick={() => setGrouped((g) => !g)}>
              <Users className="h-3.5 w-3.5" />
              {grouped ? "Agrupado por cliente" : "Agrupar por cliente"}
            </Button>
            <BotonExportar onClick={exportar} total={ordenadas.length} />
            <Button size="sm" className="gap-1.5" onClick={() => setIsCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              Nueva Orden
            </Button>
          </>
        }
      />

      {/* Orders Table */}
      <div className="overflow-hidden rounded-lg border border-border bg-card animate-fade-in">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : filteredOrdenes.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No se encontraron órdenes
          </div>
        ) : (
          <Table data-tabla="ordenes">
            <TableHeader>
              <TableRow>
                <EncabezadoOrdenable clave="numero" orden={orden} onOrdenar={alternar}>Orden</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="cliente" orden={orden} onOrdenar={alternar}>Cliente</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="items" orden={orden} onOrdenar={alternar} alinear="derecha">Items</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="total" orden={orden} onOrdenar={alternar} alinear="derecha">Total</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="estado" orden={orden} onOrdenar={alternar}>Estado</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="fecha" orden={orden} onOrdenar={alternar}>Fecha</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="metodo" orden={orden} onOrdenar={alternar}>Método Pago</EncabezadoOrdenable>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grouped
                ? grupos.map((g) => (
                    <Fragment key={g.key}>
                      <TableRow className="cursor-pointer bg-muted/40 hover:bg-muted" onClick={() => toggleGroup(g.key)}>
                        <TableCell colSpan={7}>
                          <div className="flex items-center gap-2 font-medium">
                            <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 transition-transform", openGroups.has(g.key) && "rotate-90")} />
                            <span className="truncate">{g.nombre}</span>
                            <Badge variant="secondary" className="whitespace-nowrap px-1.5 py-0 text-[11px]">{g.orders.length} órden{g.orders.length !== 1 ? "es" : ""}</Badge>
                            <span className="ml-auto whitespace-nowrap font-semibold text-primary">{formatPrice(g.total)}</span>
                          </div>
                        </TableCell>
                      </TableRow>
                      {openGroups.has(g.key) && g.orders.map(renderOrderRow)}
                    </Fragment>
                  ))
                : pagination.pageItems.map(renderOrderRow)}
            </TableBody>
          </Table>
        )}
        {!loading && !grouped && <DataTablePagination pagination={pagination} />}
        {!loading && grouped && filteredOrdenes.length > 0 && (
          <div className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
            {grupos.length} cliente{grupos.length !== 1 ? "s" : ""} · {filteredOrdenes.length} órdenes
          </div>
        )}
      </div>

      {/* Order Detail Sheet */}
      <Sheet open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        {/* Sin foco automático: el primer botón del panel puede ser "Aprobar y enviar a Odoo" y un Enter lo aprobaría */}
        <SheetContent className="w-full overflow-y-auto sm:w-[50vw] sm:max-w-none" onOpenAutoFocus={(e) => e.preventDefault()}>
          <SheetHeader>
            <SheetTitle>Detalle de Orden</SheetTitle>
          </SheetHeader>
          
          {selectedOrder && (
            <div className="mt-3 space-y-3">
              {/* Cabecera */}
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-2 text-base font-semibold text-primary">{selectedOrder.numero}{selectedOrder.odoo_id && <OdooBadge />}</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={statusConfig[selectedOrder.estado]?.variant || "secondary"}>
                      {statusConfig[selectedOrder.estado]?.label || selectedOrder.estado}
                    </Badge>
                    {facturaPorOrden[selectedOrder.id] ? (
                      <Link to={`/admin/facturas/${facturaPorOrden[selectedOrder.id].id}`}>
                        <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-xs">
                          <FileText className="h-3.5 w-3.5" /> {facturaPorOrden[selectedOrder.id].numero}
                        </Button>
                      </Link>
                    ) : selectedOrder.odoo_id || selectedOrder.aprobacion ? null : (
                      <Button
                        variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-xs"
                        disabled={facturando || selectedOrder.estado === "cancelado"}
                        onClick={() => facturarOrden(selectedOrder.id)}
                      >
                        {facturando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />} Facturar
                      </Button>
                    )}
                    {selectedOrder.comprobante_url && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1.5 px-2 text-xs"
                        onClick={() => verComprobanteOrden(selectedOrder.comprobante_url!)}
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Ver comprobante
                      </Button>
                    )}
                  </div>
                </div>
                <FichaCampos
                  columnas={4}
                  campos={[
                    { label: "Fecha", valor: formatDate(selectedOrder.fecha_pedido || selectedOrder.created_at) },
                    ...(selectedOrder.numero_guds ? [{ label: "Pedido GUDS", valor: `${selectedOrder.numero_guds} · enviado ${selectedOrder.odoo_enviado_at ? formatDate(selectedOrder.odoo_enviado_at) : ""}` }] : []),
                    ...(selectedOrder.ediciones ? [{ label: "Editado", valor: `${selectedOrder.ediciones} ${selectedOrder.ediciones === 1 ? "vez" : "veces"}${selectedOrder.editado_at ? ` · último ${formatDate(selectedOrder.editado_at)}` : ""}` }] : []),
                    { label: "Vendedor", valor: nombreVendedor(selectedOrder) || (
                      <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={() => abrirAsignarVendedor(selectedOrder)}>Asignar vendedor</Button>
                    ) },
                    { label: "Método de pago", valor: selectedOrder.metodo_pago ? <span className="capitalize">{selectedOrder.metodo_pago.replace('_', ' ')}</span> : null },
                    { label: "Moneda", valor: selectedOrder.moneda_original },
                    ...(selectedOrder.referencia_pago ? [{ label: "Referencia", valor: selectedOrder.referencia_pago, mono: true }] : []),
                    { label: "Cliente", valor: selectedOrder.cliente?.nombre_negocio, ancho: 2 as const },
                    { label: "Teléfono", valor: selectedOrder.cliente?.telefono },
                    { label: "Ciudad", valor: selectedOrder.cliente?.ciudad },
                    { label: "Dirección", valor: selectedOrder.cliente?.direccion, ancho: 3 as const },
                  ]}
                />
                {(!selectedOrder.odoo_id || selectedOrder.numero_guds) && <ResumenPagoPedido ordenId={selectedOrder.id} className="mt-2 max-w-sm" />}
              </div>

              {/* Productos + Resumen */}
              <div>
                <h3 className="mb-1.5 text-[13px] font-semibold">Productos ({selectedOrder.items?.length || 0})</h3>
                <div className="overflow-hidden rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Producto</TableHead>
                        <TableHead className="text-right">Cant.</TableHead>
                        <TableHead className="text-right">Precio</TableHead>
                        <TableHead className="text-right">Subtotal</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedOrder.items?.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span className="shrink-0">{item.producto?.imagen_emoji || '📦'}</span>
                              <span className="max-w-[320px] truncate" title={item.producto?.nombre || item.nombre_producto || undefined}>{item.producto?.nombre || item.nombre_producto || 'Producto'}</span>
                            </span>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right">{item.cantidad}</TableCell>
                          <TableCell className="whitespace-nowrap text-right">{formatPrice(item.precio_unitario)}</TableCell>
                          <TableCell className="whitespace-nowrap text-right font-medium">{formatPrice(item.subtotal)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="ml-auto mt-2 w-full max-w-xs space-y-0.5 rounded-lg border p-2.5 text-[13px] tabular-nums">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Resumen</p>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span>{formatPrice(selectedOrder.subtotal)}</span>
                  </div>
                  {selectedOrder.impuesto > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Impuesto</span>
                      <span>{formatPrice(selectedOrder.impuesto)}</span>
                    </div>
                  )}
                  {selectedOrder.descuento > 0 && (
                    <div className="flex justify-between text-green-600">
                      <span>Descuento</span>
                      <span>-{formatPrice(selectedOrder.descuento)}</span>
                    </div>
                  )}
                  {selectedOrder.envio > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Envío</span>
                      <span>{formatPrice(selectedOrder.envio)}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t pt-1 text-sm font-bold">
                    <span>Total</span>
                    <span className="text-primary">{formatPrice(selectedOrder.total)}</span>
                  </div>
                </div>
              </div>

              {!selectedOrder.odoo_id && (
                <p className="rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-[13px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                  Pedido creado en GUDS · pendiente de enviar a Odoo (se enviará cuando se active la sincronización).
                </p>
              )}
              {/* Despachos en Odoo */}
              {selectedOrder.odoo_id && (
                <div>
                  <h3 className="mb-1.5 flex items-center gap-2 text-[13px] font-semibold">Despachos ({despachos.length}) <OdooBadge titulo="Transferencias de Odoo ligadas a esta orden" /></h3>
                  {despachos.length === 0 ? (
                    <p className="rounded-lg border border-border px-3 py-2 text-[13px] text-muted-foreground">Esta orden no tiene transferencias en Odoo.</p>
                  ) : (
                    <div className="divide-y divide-border rounded-lg border border-border">
                      {despachos.map((d) => (
                        <Link key={d.id} to={`/admin/transferencias/${d.id}`} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-1.5 text-[13px] hover:bg-muted/50">
                          <span className="whitespace-nowrap font-mono font-medium text-primary">{d.numero}</span>
                          <span className="min-w-0 truncate text-muted-foreground">{TIPO_TRANSF[d.tipo] ?? d.tipo} · {d.ubicacion_origen}</span>
                          <span className="whitespace-nowrap text-xs text-muted-foreground">{d.estado === "hecha" ? `Realizada ${fmtFechaHora(d.fecha_realizada)}` : `Programada ${fmtFechaHora(d.fecha_programada)}`}</span>
                          <span className="ml-auto"><EstadoTransferencia estado={d.estado} /></span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Aprobación y envío a Odoo (pedidos de clientes y vendedores) */}
              {selectedOrder.aprobacion === "pendiente" && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-[13px] text-amber-950">
                  <p className="mb-2 flex items-center gap-1.5 font-semibold"><Clock className="h-4 w-4" /> Pedido por aprobar</p>
                  <p className="mb-2.5 text-xs">Al aprobarlo se crea en Odoo como <strong>cotización en borrador</strong> (con el envío como línea de servicio) y sigue el flujo de Odoo. Si se rechaza, se cancela y se avisa al cliente y al vendedor.</p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" className="gap-1.5" disabled={procesandoAprobacion} onClick={() => setConfirmarAprobacion(selectedOrder)}>
                      {procesandoAprobacion ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Aprobar y enviar a Odoo
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10" disabled={procesandoAprobacion}
                      onClick={() => { setRechazo({ id: selectedOrder.id, numero: selectedOrder.numero }); setMotivoRechazo(""); }}>
                      <XCircle className="h-3.5 w-3.5" /> Rechazar
                    </Button>
                  </div>
                </div>
              )}
              {selectedOrder.aprobacion === "aprobada" && !selectedOrder.odoo_id && (
                selectedOrder.odoo_envio_error ? (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-[13px]">
                    <p className="mb-1 flex items-center gap-1.5 font-semibold text-destructive"><AlertTriangle className="h-4 w-4" /> No se pudo crear en Odoo</p>
                    <p className="mb-2 text-xs">{selectedOrder.odoo_envio_error}</p>
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => reintentarEnvio(selectedOrder)}><RotateCw className="h-3.5 w-3.5" /> Reintentar</Button>
                  </div>
                ) : (
                  <p className="flex items-center gap-1.5 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-[13px] text-sky-900">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Aprobado · creando la cotización en Odoo…
                  </p>
                )
              )}
              {selectedOrder.aprobacion === "rechazada" && (
                <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-[13px]">
                  <span className="font-semibold text-destructive">Rechazado:</span> {selectedOrder.rechazo_motivo}
                </p>
              )}
              {selectedOrder.odoo_envio_aviso && (
                <p className="flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {selectedOrder.odoo_envio_aviso}
                </p>
              )}

              {/* Línea de tiempo (orden_eventos): se remonta al cambiar la aprobación o el estado para mostrar el hito nuevo */}
              <div>
                <h3 className="mb-1.5 text-[13px] font-semibold">Línea de tiempo</h3>
                <div className="rounded-lg border border-border px-3 py-2.5" data-testid="linea-tiempo-admin">
                  <LineaTiempoPedido key={`${selectedOrder.id}-${selectedOrder.aprobacion ?? ""}-${selectedOrder.estado}-${selectedOrder.odoo_id ?? ""}`} ordenId={selectedOrder.id} mostrarOrigen />
                </div>
              </div>

              {/* Cambiar estado (las órdenes de Odoo cambian de estado en Odoo; las de GUDS pasan por aprobación) */}
              {selectedOrder.aprobacion && !selectedOrder.odoo_id ? null : selectedOrder.odoo_id ? (
                <p className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[13px] text-muted-foreground">
                  <OdooBadge /> El estado y la facturación de esta orden se manejan en Odoo.
                </p>
              ) : (
              <div>
                <h3 className="mb-1.5 text-[13px] font-semibold">Cambiar estado</h3>
                <div className="flex flex-wrap gap-1.5">
                  {['pendiente', 'confirmado', 'procesando', 'enviado', 'completado', 'cancelado'].map((status) => (
                    <Button
                      key={status}
                      variant={selectedOrder.estado === status ? "default" : "outline"}
                      size="sm"
                      className="h-7 px-2.5 text-xs"
                      disabled={updatingStatus || selectedOrder.estado === status}
                      onClick={() => updateOrderStatus(selectedOrder.id, status)}
                    >
                      {updatingStatus ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : statusConfig[status]?.label}
                    </Button>
                  ))}
                </div>
              </div>
              )}

              {/* Notas */}
              {selectedOrder.notas && (
                <div>
                  <h3 className="mb-1.5 text-[13px] font-semibold">Notas</h3>
                  <p className="rounded-lg border bg-card px-3 py-2 text-[13px] text-muted-foreground">
                    {selectedOrder.notas}
                  </p>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Create Order Dialog */}
      {/* Rechazo de pedido con motivo */}
      <Dialog open={!!rechazo} onOpenChange={(o) => { if (!o) setRechazo(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Rechazar pedido {rechazo?.numero}</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="motivo-rechazo">Motivo (lo verán el cliente y el vendedor)</Label>
            <Input id="motivo-rechazo" value={motivoRechazo} onChange={(e) => setMotivoRechazo(e.target.value)} placeholder="Ej.: sin disponibilidad, crédito excedido, datos incompletos…" autoFocus />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setRechazo(null)}>Cancelar</Button>
            <Button variant="destructive" disabled={procesandoAprobacion || !motivoRechazo.trim()} onClick={confirmarRechazo}>
              {procesandoAprobacion && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Rechazar pedido
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nueva Orden</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-6 mt-4">
            {/* Client Selection */}
            <div className="space-y-2">
              <Label>Cliente *</Label>
              <Select value={newOrder.cliente_id} onValueChange={(v) => setNewOrder(prev => ({ ...prev, cliente_id: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar cliente" />
                </SelectTrigger>
                <SelectContent>
                  {clientes.map((cliente) => (
                    <SelectItem key={cliente.id} value={cliente.id}>
                      {cliente.nombre_negocio}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Payment Method */}
            <div className="space-y-2">
              <Label>Método de Pago</Label>
              <Select value={newOrder.metodo_pago} onValueChange={(v) => setNewOrder(prev => ({ ...prev, metodo_pago: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="transferencia">Transferencia</SelectItem>
                  <SelectItem value="efectivo">Efectivo</SelectItem>
                  <SelectItem value="credito">Crédito</SelectItem>
                  <SelectItem value="pago_movil">Pago Móvil</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Add Products */}
            <div className="space-y-2">
              <Label>Agregar Productos</Label>
              <div className="flex gap-2">
                <Select value={selectedProducto} onValueChange={setSelectedProducto}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Seleccionar producto" />
                  </SelectTrigger>
                  <SelectContent>
                    {productosVenta.map((producto) => (
                      <SelectItem key={producto.id} value={producto.id}>
                        {producto.nombre} - {formatPrice(producto.en_oferta && producto.precio_oferta ? producto.precio_oferta : producto.precio_base)}
                        {textoIva(producto.impuesto_pct) ? ` · ${textoIva(producto.impuesto_pct)}` : ""}
                        {producto.controla_stock !== false ? ` · ${Math.floor(Number(producto.stock_disponible ?? producto.stock_actual ?? 0)).toLocaleString("es-VE")} disp.` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min="1"
                  value={cantidad}
                  onChange={(e) => setCantidad(parseInt(e.target.value) || 1)}
                  className="w-20"
                />
                <Button onClick={addItemToOrder} disabled={!selectedProducto}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Order Items */}
            {newOrder.items.length > 0 && (
              <div className="space-y-2">
                <Label>Productos en la orden</Label>
                <div className="border rounded-lg divide-y">
                  {newOrder.items.map((item, index) => {
                    const producto = productos.find(p => p.id === item.producto_id);
                    // Precio que cobra el servidor para este cliente (lista, oferta o base); mientras llega, el del catálogo
                    const precio = cotizacionEstado.lineaDe(item.producto_id, null)?.precio_unitario ?? item.precio;
                    return (
                      <div key={index} className="flex items-center justify-between gap-2 p-3">
                        <div className="min-w-0">
                          <p className="font-medium">{producto?.nombre}</p>
                          <p className="text-sm text-muted-foreground">
                            {item.cantidad} x {formatPrice(precio)}
                            {producto?.impuesto_pct != null && <> · <EtiquetaIva pct={producto.impuesto_pct} nombre={producto.impuesto_nombre} className="text-xs" /></>}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="whitespace-nowrap font-medium">{formatPrice(precio * item.cantidad)}</span>
                          <Button variant="ghost" size="icon" onClick={() => removeItemFromOrder(index)}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="rounded-lg bg-muted p-3" data-testid="resumen-orden-nueva">
                  <ResumenCotizacion {...cotizacionEstado} claseTotal="text-primary" vacio="Elige el cliente para ver el total con su IVA." />
                </div>
                <p className="text-xs text-muted-foreground">El IVA depende de cada producto (exento o gravado, como en Odoo). GUDS confirma el total al crear la orden.</p>
              </div>
            )}

            {/* Notes */}
            <div className="space-y-2">
              <Label>Notas</Label>
              <Input
                placeholder="Notas adicionales..."
                value={newOrder.notas}
                onChange={(e) => setNewOrder(prev => ({ ...prev, notas: e.target.value }))}
              />
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={createOrder} disabled={submitting || newOrder.items.length === 0}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Crear Orden
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={!!asignarVend} onOpenChange={(o) => { if (!o) setAsignarVend(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Asignar vendedor · {asignarVend?.numero}</DialogTitle>
            <DialogDescription>El pedido no tiene vendedor. Solo aparecen los vendedores de la empresa del pedido.</DialogDescription>
          </DialogHeader>
          <Select value={vendElegido} onValueChange={setVendElegido}>
            <SelectTrigger aria-label="Vendedor"><SelectValue placeholder="Elige un vendedor" /></SelectTrigger>
            <SelectContent>
              {vendedores.filter((v) => !asignarVend?.empresa_id || v.empresas.includes(asignarVend.empresa_id)).map((v) => (
                <SelectItem key={v.id} value={v.id}>{v.nombre}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAsignarVend(null)} disabled={asignando}>Cancelar</Button>
            <Button onClick={confirmarVendedor} disabled={!vendElegido || asignando}>{asignando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Asignar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!confirmarAprobacion} onOpenChange={(o) => { if (!o) setConfirmarAprobacion(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>¿Aprobar el pedido {confirmarAprobacion?.numero}?</DialogTitle>
            <DialogDescription>Se crea en Odoo como cotización en borrador y sigue el flujo de Odoo. Desde GUDS no se puede deshacer.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmarAprobacion(null)} autoFocus>Cancelar</Button>
            <Button onClick={() => { const o = confirmarAprobacion; setConfirmarAprobacion(null); if (o) aprobarPedido(o); }} disabled={procesandoAprobacion}>
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Aprobar y enviar a Odoo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
};

export default Ordenes;
