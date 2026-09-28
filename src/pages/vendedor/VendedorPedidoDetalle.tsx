import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Copy, FileText, Loader2, Pencil, Search } from "lucide-react";
import { VendedorLayout } from "@/components/vendedor/VendedorLayout";
import { EditarPedidoDialog } from "@/components/vendedor/EditarPedidoDialog";
import { EstadoPedidoBadge, estadoPedidoVendedor } from "@/components/vendedor/estadoPedidoVendedor";
import { LineaTiempoPedido } from "@/components/pedidos/LineaTiempoPedido";
import { claseTono } from "@/components/pedidos/estadoPedido";
import { ResumenCotizacion } from "@/components/portal/ResumenCotizacion";
import { ResumenPagoPedido, textoPagoEdicion } from "@/components/portal/ResumenPagoPedido";
import { EtiquetaIva } from "@/components/portal/EtiquetaIva";
import { pedidoEditable, type ResultadoEdicion } from "@/components/portal/pedidoEditable";
import { FichaCampos, Panel } from "@/components/datos/FichaCampos";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { useToast } from "@/hooks/use-toast";
import type { Cotizacion } from "@/hooks/useCotizacion";

// Detalle de un pedido para el vendedor (plan de portales §5, V1): estado visible con su mensaje y línea de tiempo, cliente,
// líneas con el IVA de cada producto, totales guardados por el servidor, facturas del pedido con su saldo y resumen de pago.
// Los avisos de confirmación, despacho y factura enlazan aquí (/vendedor/pedidos?pedido=<id> redirige a esta página).

interface Item {
  id: string; producto_id: string; tipo_empaque_id: string | null; unidades_por_empaque: number | null; cantidad: number;
  precio_unitario: number; subtotal: number; impuesto_pct: number | null; nombre_producto: string | null; sku_producto: string | null;
  producto: { nombre: string; sku: string | null; impuesto_pct: number | null; impuesto_nombre: string | null } | null;
  tipo_empaque: { nombre: string; unidades: number } | null;
}
interface Pedido {
  id: string; numero: string; numero_guds: string | null; estado: string; estado_odoo: string | null;
  aprobacion: "pendiente" | "aprobada" | "rechazada" | null; rechazo_motivo: string | null; odoo_id: number | null; odoo_envio_error: string | null;
  odoo_enviado_at: string | null; subtotal: number; descuento: number | null; impuesto: number | null; envio: number | null; total: number;
  metodo_pago: string | null; notas: string | null; fecha_pedido: string | null; created_at: string; cliente_id: string; vendedor_id: string | null;
  ediciones: number | null; editado_at: string | null; direccion_entrega: string | null; ciudad_entrega: string | null;
  cliente: {
    id: string; nombre_negocio: string; rif: string | null; telefono: string | null; celular: string | null; ciudad: string | null;
    direccion: string | null; direccion_entrega: string | null; vendedor_asignado_id: string | null; activo: boolean | null;
  } | null;
  items: Item[] | null;
}
interface Factura {
  id: string; numero: string; tipo: string; fecha_emision: string | null; fecha_vencimiento: string | null;
  total_usd: number | null; saldo_usd: number | null; estado_cobro: string | null;
}
interface ResumenPago { total: number; verificado: number; por_verificar: number; falta: number; a_favor: number }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const METODO: Record<string, string> = {
  transferencia: "Transferencia", pago_movil: "Pago móvil", tarjeta: "Tarjeta", efectivo: "Efectivo", credito: "Crédito", zelle: "Zelle",
};
const COBRO: Record<string, { etiqueta: string; tono: keyof typeof claseTono }> = {
  pagado: { etiqueta: "Pagada", tono: "ok" },
  parcial: { etiqueta: "Pago parcial", tono: "pendiente" },
  pendiente: { etiqueta: "Por cobrar", tono: "pendiente" },
  anulado: { etiqueta: "Anulada", tono: "neutro" },
};

const fechaCorta = (s: string | null) => (s ? new Date(s.length === 10 ? `${s}T12:00:00` : s).toLocaleDateString("es-VE", { day: "2-digit", month: "short", year: "numeric" }) : null);
const fechaHora = (s: string) => new Date(s).toLocaleString("es-VE", { dateStyle: "medium", timeStyle: "short" });

const VendedorPedidoDetalle = () => {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { formatPrice } = useCurrency();
  const { toast } = useToast();
  const { empresas, empresaActiva, seleccion, soloLectura, cambiarEmpresa } = useEmpresa();
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [pago, setPago] = useState<ResumenPago | null>(null);
  const [cargando, setCargando] = useState(true);
  const [recarga, setRecarga] = useState(0);
  const [editar, setEditar] = useState(false);

  const cargar = useCallback(async () => {
    if (!UUID.test(id)) { setPedido(null); setCargando(false); return; }
    const [oRes, fRes] = await Promise.all([
      supabase.from("ordenes").select(`id, numero, numero_guds, estado, estado_odoo, aprobacion, rechazo_motivo, odoo_id, odoo_envio_error, odoo_enviado_at,
        subtotal, descuento, impuesto, envio, total, metodo_pago, notas, fecha_pedido, created_at, cliente_id, vendedor_id, ediciones, editado_at,
        direccion_entrega, ciudad_entrega,
        cliente:clientes(id, nombre_negocio, rif, telefono, celular, ciudad, direccion, direccion_entrega, vendedor_asignado_id, activo),
        items:orden_items(id, producto_id, tipo_empaque_id, unidades_por_empaque, cantidad, precio_unitario, subtotal, impuesto_pct, nombre_producto, sku_producto,
          producto:productos(nombre, sku, impuesto_pct, impuesto_nombre), tipo_empaque:tipos_empaque(nombre, unidades))`).eq("id", id).maybeSingle(),
      // Facturas y notas de crédito emitidas del pedido (las de Odoo llegan por la sincronización)
      supabase.from("facturas").select("id, numero, tipo, fecha_emision, fecha_vencimiento, total_usd, saldo_usd, estado_cobro")
        .eq("orden_id", id).eq("estado", "posted").order("fecha_emision").order("numero"),
    ]);
    const o = (oRes.data as unknown as Pedido | null) ?? null;
    setPedido(o);
    setFacturas((fRes.data as Factura[] | null) ?? []);
    // Lo pagado contra el pedido (solo pedidos creados en GUDS de un cliente de su cartera: la función lo exige)
    const deGuds = !!o && (!o.odoo_id || !!o.numero_guds);
    if (o && deGuds && o.cliente?.vendedor_asignado_id === user?.id) {
      const { data } = await supabase.rpc("resumen_pago_orden", { p_orden_id: o.id });
      setPago(((Array.isArray(data) ? data[0] : data) as ResumenPago | null) ?? null);
    } else setPago(null);
    setCargando(false);
  }, [id, user?.id]);

  useEffect(() => { setCargando(true); cargar(); }, [cargar]);

  const items = useMemo(() => [...(pedido?.items ?? [])].sort((a, b) => (a.producto?.nombre || a.nombre_producto || "").localeCompare(b.producto?.nombre || b.nombre_producto || "")), [pedido]);

  if (cargando) {
    return (
      <VendedorLayout title="Pedido">
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-emerald-700" /></div>
      </VendedorLayout>
    );
  }

  if (!pedido) {
    const otras = soloLectura ? [] : empresas.filter((e) => e.id !== seleccion);
    return (
      <VendedorLayout title="Pedido">
        <Volver />
        <Panel className="mx-auto max-w-lg">
          <div className="space-y-3 py-4 text-center" data-testid="pedido-no-encontrado">
            <Search className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="font-semibold">No encontramos este pedido</p>
            <p className="text-sm text-muted-foreground">
              {empresaActiva ? `No está entre los pedidos de tu cartera en ${empresaActiva.nombre_corto || empresaActiva.nombre}.` : "No está entre los pedidos de tu cartera."}
              {otras.length > 0 ? " Si es de otra empresa, búscalo allí:" : ""}
            </p>
            {otras.length > 0 && (
              <div className="flex flex-wrap justify-center gap-2">
                {otras.map((e) => (
                  <Button key={e.id} size="sm" variant="outline" onClick={() => cambiarEmpresa(e.id)}>Ver en {e.nombre_corto || e.nombre}</Button>
                ))}
              </div>
            )}
          </div>
        </Panel>
      </VendedorLayout>
    );
  }

  const estado = estadoPedidoVendedor(pedido);
  const miCliente = !!pedido.cliente && pedido.cliente.vendedor_asignado_id === user?.id;
  const puedeEditar = miCliente && pedidoEditable(pedido) && !soloLectura;
  // Duplicar = nuevo pedido con crear_orden_vendedor: solo para clientes activos de su cartera
  const puedeDuplicar = miCliente && pedido.cliente?.activo !== false && !soloLectura && items.length > 0;
  const noVigente = estado.clave === "rechazado" || estado.clave === "cancelado";
  const deGuds = !pedido.odoo_id || !!pedido.numero_guds;
  const fecha = pedido.fecha_pedido || pedido.created_at;

  // Pago (eje aparte del estado): contra sus facturas si ya se facturó; si no, lo pagado contra el pedido
  const docsFactura = facturas.filter((f) => f.tipo === "factura");
  const facturado = docsFactura.reduce((s, f) => s + Number(f.total_usd || 0), 0);
  const saldo = facturas.reduce((s, f) => s + Number(f.saldo_usd || 0), 0);
  const pagadoPedido = pago ? Number(pago.verificado) + Number(pago.por_verificar) : 0;
  const pill: { etiqueta: string; tono: keyof typeof claseTono } | null = noVigente ? null
    : docsFactura.length > 0 ? (saldo <= 0.009 ? { etiqueta: "Pagado", tono: "ok" } : saldo < facturado - 0.009 ? { etiqueta: "Pago parcial", tono: "pendiente" } : { etiqueta: "Por cobrar", tono: "pendiente" })
    : pago ? (Number(pago.falta) <= 0.009 && pagadoPedido > 0 ? { etiqueta: Number(pago.por_verificar) > 0 ? "Pago por verificar" : "Pagado", tono: Number(pago.por_verificar) > 0 ? "pendiente" : "ok" }
      : pagadoPedido > 0 ? { etiqueta: "Pago parcial", tono: "pendiente" } : { etiqueta: "Sin pagos", tono: "neutro" })
    : null;

  // Totales guardados por el servidor, con el mismo desglose que al cotizar (el IVA por tasa solo si todas las líneas la guardaron)
  const cotizacion: Cotizacion = {
    lineas: items.length > 0 && items.every((i) => i.impuesto_pct != null)
      ? items.map((i) => ({ producto_id: i.producto_id, tipo_empaque_id: i.tipo_empaque_id, cantidad: i.cantidad, precio_unitario: Number(i.precio_unitario), subtotal: Number(i.subtotal), impuesto_pct: Number(i.impuesto_pct) }))
      : [],
    subtotal: Number(pedido.subtotal || 0), descuento: Number(pedido.descuento || 0), impuesto: Number(pedido.impuesto || 0),
    envio: Number(pedido.envio || 0), total: Number(pedido.total || 0), envio_gratis_desde: 0, aviso: null,
  };

  const alGuardar = (r: ResultadoEdicion) => {
    setEditar(false);
    toast({ title: "Pedido actualizado", description: `${r.numero} · ${formatPrice(r.total)}. Sigue por aprobar.${textoPagoEdicion(r, formatPrice)}` });
    setRecarga((n) => n + 1);
    cargar();
  };
  const alBloquear = (mensaje: string) => {
    setEditar(false);
    toast({ title: "No se puede editar", description: mensaje, variant: "destructive" });
    setRecarga((n) => n + 1);
    cargar();
  };
  const duplicar = () => navigate(`/vendedor/pedidos/nuevo?duplicar=${pedido.id}`);
  // Notas de crédito y saldos a favor: "-$7,47" (no "$-7,47")
  const monto = (n: number) => (n < -0.004 ? `-${formatPrice(-n)}` : formatPrice(n));

  const nombreItem = (i: Item) => i.producto?.nombre || i.nombre_producto || "Producto";
  const presentacion = (i: Item) => (i.tipo_empaque ? `${i.tipo_empaque.nombre} ×${i.tipo_empaque.unidades}` : null);
  const ivaItem = (i: Item) => (i.impuesto_pct ?? i.producto?.impuesto_pct ?? null);
  const telefono = pedido.cliente?.celular || pedido.cliente?.telefono;
  const direccion = pedido.direccion_entrega || pedido.cliente?.direccion_entrega || pedido.cliente?.direccion;

  const botonDuplicar = puedeDuplicar && (
    <Button size="sm" variant={noVigente ? "default" : "outline"} onClick={duplicar} data-testid="duplicar-pedido"
      className={cn("h-9 gap-1.5", noVigente && "bg-emerald-700 text-white hover:bg-emerald-800")}>
      <Copy className="h-3.5 w-3.5" />{noVigente ? "Duplicar y corregir" : "Duplicar"}
    </Button>
  );

  return (
    <VendedorLayout title={`Pedido ${pedido.numero}`}>
      <div className="mx-auto max-w-6xl" data-testid="detalle-pedido">
        <Volver />

        {/* Cabecera: número (y el de GUDS si ya pasó a Odoo), estado visible, pago, cliente, total y acciones */}
        <section className="mb-3 rounded-lg border border-border bg-card p-3">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <h2 className="text-lg font-semibold leading-tight text-emerald-700 dark:text-emerald-400" data-testid="detalle-numero">{pedido.numero}</h2>
                <EstadoPedidoBadge pedido={pedido} />
                {pill && <Badge variant="outline" className={cn("whitespace-nowrap font-medium", claseTono[pill.tono])} data-testid="pago-pedido">{pill.etiqueta}</Badge>}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {pedido.numero_guds && pedido.numero_guds !== pedido.numero ? <>antes {pedido.numero_guds} · </> : null}
                {fechaHora(fecha)}
                {(pedido.ediciones ?? 0) > 0 ? ` · editado ${pedido.ediciones === 1 ? "1 vez" : `${pedido.ediciones} veces`}` : ""}
              </p>
              <p className="mt-1 truncate text-sm font-medium" title={pedido.cliente?.nombre_negocio}>{pedido.cliente?.nombre_negocio || "Cliente fuera de tu cartera"}</p>
            </div>
            <div className="flex w-full items-baseline justify-between gap-2 sm:block sm:w-auto sm:text-right">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total</p>
              <p className="text-xl font-semibold tabular-nums" data-testid="detalle-total">{formatPrice(Number(pedido.total || 0))}</p>
            </div>
          </div>
          {(puedeEditar || puedeDuplicar) && (
            <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
              {puedeEditar && (
                <Button size="sm" className="h-9 gap-1.5 bg-emerald-700 text-white hover:bg-emerald-800" onClick={() => setEditar(true)} data-testid="detalle-editar">
                  <Pencil className="h-3.5 w-3.5" />Editar
                </Button>
              )}
              {botonDuplicar}
            </div>
          )}
        </section>

        {/* Móvil: una columna (seguimiento, productos, facturas, pago, cliente). Escritorio: productos y cliente a la izquierda;
            seguimiento, facturas y pago a la derecha. */}
        <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
          <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-3">
            <Panel className="order-2 mb-0 lg:order-none" sinPadding titulo={<>Productos <span className="font-normal text-muted-foreground">({items.length})</span></>}>
              {items.length === 0 ? (
                <p className="px-3 py-4 text-sm text-muted-foreground">No hay líneas visibles para este pedido.</p>
              ) : (
                <>
                  {/* Móvil: lista legible sin desplazamiento lateral */}
                  <ul className="divide-y divide-border md:hidden" data-testid="lineas-movil">
                    {items.map((i) => (
                      <li key={i.id} className="flex gap-3 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-[13px] font-medium leading-snug">{nombreItem(i)}</p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                            <span className="tabular-nums">{i.cantidad} × {formatPrice(Number(i.precio_unitario))}</span>
                            {presentacion(i) && <span>· {presentacion(i)}</span>}
                            {ivaItem(i) != null && <span>· <EtiquetaIva pct={ivaItem(i)} nombre={i.producto?.impuesto_nombre} className="text-xs" /></span>}
                          </p>
                        </div>
                        <p className="shrink-0 text-[13px] font-semibold tabular-nums">{formatPrice(Number(i.subtotal))}</p>
                      </li>
                    ))}
                  </ul>
                  {/* Escritorio: tabla compacta */}
                  <div className="hidden md:block">
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead>Producto</TableHead>
                        <TableHead>Presentación</TableHead>
                        <TableHead className="text-right">Cant.</TableHead>
                        <TableHead className="text-right">Precio</TableHead>
                        <TableHead>IVA</TableHead>
                        <TableHead className="text-right">Subtotal</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {items.map((i) => (
                          <TableRow key={i.id}>
                            <TableCell className="max-w-[320px]">
                              <span className="block truncate font-medium" title={nombreItem(i)}>{nombreItem(i)}</span>
                              {(i.producto?.sku || i.sku_producto) && <span className="block text-[11px] text-muted-foreground">{i.producto?.sku || i.sku_producto}</span>}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-muted-foreground">{presentacion(i) || "Unidad"}</TableCell>
                            <TableCell className="whitespace-nowrap text-right tabular-nums">{i.cantidad}</TableCell>
                            <TableCell className="whitespace-nowrap text-right tabular-nums">{formatPrice(Number(i.precio_unitario))}</TableCell>
                            <TableCell className="whitespace-nowrap">{ivaItem(i) != null ? <EtiquetaIva pct={ivaItem(i)} nombre={i.producto?.impuesto_nombre} className="text-xs" /> : <span className="text-muted-foreground">—</span>}</TableCell>
                            <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">{formatPrice(Number(i.subtotal))}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
              <div className="border-t border-border p-3">
                <ResumenCotizacion cotizacion={cotizacion} cargando={false} error={null} reintentar={() => undefined} envioCero="Sin envío"
                  className="md:ml-auto md:max-w-xs" />
              </div>
            </Panel>

            <Panel className="order-5 mb-0 lg:order-none" titulo="Cliente y entrega"
              acciones={pedido.cliente ? (
                miCliente ? (
                  <Link to={`/vendedor/clientes/${pedido.cliente.id}`} className="text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400">
                    Ver ficha del cliente
                  </Link>
                ) : (
                  <Link to={`/vendedor/pedidos?q=${encodeURIComponent(pedido.cliente.nombre_negocio)}`} className="text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400">
                    Ver sus pedidos
                  </Link>
                )
              ) : undefined}>
              {pedido.cliente ? (
                <FichaCampos columnas={3} campos={[
                  { label: "Cliente", valor: pedido.cliente.nombre_negocio, ancho: 2 },
                  { label: "RIF", valor: pedido.cliente.rif, mono: true },
                  { label: "Teléfono", valor: telefono ? <a href={`tel:${telefono.replace(/[^\d+]/g, "")}`} className="text-emerald-700 hover:underline dark:text-emerald-400">{telefono}</a> : null },
                  { label: "Ciudad", valor: pedido.ciudad_entrega || pedido.cliente.ciudad },
                  { label: "Dirección de entrega", valor: direccion, ancho: 3 },
                  ...(pedido.notas && pedido.notas !== "Pedido tomado por vendedor" ? [{ label: "Notas", valor: pedido.notas, ancho: 3 as const }] : []),
                ]} />
              ) : (
                <p className="text-sm text-muted-foreground">Este cliente ya no está en tu cartera; ves el pedido porque lo tomaste tú.</p>
              )}
            </Panel>
          </div>

          <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-3">
            <Panel className="order-1 mb-0 lg:order-none" titulo="Seguimiento">
              <div className={cn("mb-3 rounded-md border px-3 py-2 text-sm", claseTono[estado.tono])} data-testid="estado-mensaje">
                <p className="font-semibold">{estado.etiqueta}</p>
                <p className="mt-0.5 leading-snug">{estado.mensaje}</p>
                {estado.clave === "rechazado" && pedido.rechazo_motivo && (
                  <p className="mt-1.5 leading-snug" data-testid="motivo-rechazo"><span className="font-semibold">Motivo:</span> {pedido.rechazo_motivo}</p>
                )}
              </div>
              <LineaTiempoPedido ordenId={pedido.id} recarga={recarga} />
            </Panel>

            <Panel className="order-3 mb-0 lg:order-none" sinPadding titulo={<>Facturas <span className="font-normal text-muted-foreground">({facturas.length})</span></>}>
              {facturas.length === 0 ? (
                <p className="px-3 py-3 text-sm text-muted-foreground">
                  {noVigente ? "Sin facturas." : "Este pedido aún no tiene factura. Te avisaremos cuando se emita."}
                </p>
              ) : (
                <>
                  <ul className="divide-y divide-border" data-testid="facturas-pedido">
                    {facturas.map((f) => {
                      const c = f.tipo === "nota_credito" ? { etiqueta: "Nota de crédito", tono: "neutro" as const } : COBRO[f.estado_cobro || ""] ?? null;
                      const s = Number(f.saldo_usd || 0);
                      return (
                        <li key={f.id} className="flex items-start justify-between gap-3 px-3 py-2 text-[13px]">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5 font-medium">
                              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />{f.numero}
                              {c && <Badge variant="outline" className={cn("px-1.5 py-0 text-[10px] font-medium", claseTono[c.tono])}>{c.etiqueta}</Badge>}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {fechaCorta(f.fecha_emision) ? `Emitida ${fechaCorta(f.fecha_emision)}` : "Sin fecha"}
                              {f.fecha_vencimiento && f.tipo === "factura" ? ` · vence ${fechaCorta(f.fecha_vencimiento)}` : ""}
                            </p>
                          </div>
                          <div className="shrink-0 text-right tabular-nums">
                            <p className="font-medium">{monto(Number(f.total_usd || 0))}</p>
                            <p className={cn("text-xs", s > 0.009 ? "text-destructive" : "text-muted-foreground")}>Saldo {monto(s)}</p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="flex justify-between border-t border-border px-3 py-2 text-sm font-semibold">
                    <span>Saldo del pedido</span>
                    <span className={cn("tabular-nums", saldo > 0.009 ? "text-destructive" : saldo < -0.009 ? "text-success" : "")} data-testid="saldo-facturas">{monto(saldo)}</span>
                  </div>
                </>
              )}
            </Panel>

            <Panel className="order-4 mb-0 lg:order-none" titulo="Pago">
              <div className="space-y-2 text-sm" data-testid="pago-detalle">
                {docsFactura.length > 0 ? (
                  <p className="text-muted-foreground">Se cobra contra sus facturas: {saldo > 0.009 ? <>queda <span className="font-semibold text-foreground">{formatPrice(saldo)}</span> por cobrar.</> : "no queda saldo por cobrar."}</p>
                ) : deGuds ? (
                  pagadoPedido > 0 ? null : <p className="text-muted-foreground">{noVigente ? "Sin pagos registrados." : "Sin pagos registrados contra este pedido."}</p>
                ) : (
                  <p className="text-muted-foreground">Se cobra contra la factura cuando se emita.</p>
                )}
                {deGuds && pagadoPedido > 0 && <ResumenPagoPedido ordenId={pedido.id} recarga={recarga} />}
                {pedido.metodo_pago && <p className="text-xs text-muted-foreground">Método indicado al pedir: {METODO[pedido.metodo_pago] ?? pedido.metodo_pago}</p>}
              </div>
            </Panel>
          </div>
        </div>
      </div>

      <EditarPedidoDialog
        orden={editar ? { id: pedido.id, numero: pedido.numero, vendedor_id: pedido.vendedor_id, cliente: pedido.cliente ? { nombre_negocio: pedido.cliente.nombre_negocio } : null } : null}
        onCerrar={() => setEditar(false)} onGuardado={alGuardar} onYaNoEditable={alBloquear} />
    </VendedorLayout>
  );
};

const Volver = () => (
  <Link to="/vendedor/pedidos" className="mb-2 inline-flex h-9 items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground" data-testid="volver-pedidos">
    <ArrowLeft className="h-4 w-4" />Pedidos
  </Link>
);

export default VendedorPedidoDetalle;
