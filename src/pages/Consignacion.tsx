import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Loader2, Boxes, FileText, Send, CheckCircle2, AlertTriangle, ExternalLink, Layers } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { useToast } from "@/hooks/use-toast";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { BarraLista } from "@/components/datos/BarraLista";
import { OdooBadge } from "@/components/OdooBadge";
import { estadoVisible, claseTono } from "@/components/pedidos/estadoPedido";
import { estadoEnvioOdoo, PanelEnvioOdoo, reintentarEnvioPedido } from "@/components/pedidos/EnvioOdoo";
import {
  FiltrosLista, useFiltros, useFiltroEmpresa, opcionesDe, coincide, enRango, contadorFiltrado,
} from "@/components/datos/FiltrosLista";

interface Item { id: string; nombre_producto: string | null; sku_producto: string | null; cantidad: number; precio_unitario: number; subtotal: number; }
interface FacturaPedido { id: string; numero: string; tipo: string; estado_pago: string | null; }
// Pedido creado al aprobar (22b): va a Odoo como cotización desde el almacén de consignación y allí se factura
interface PedidoConsignacion {
  id: string; numero: string; numero_guds: string | null; odoo_id: number | null; aprobacion: string | null;
  odoo_envio_error: string | null; odoo_envio_aviso: string | null; estado: string; estado_odoo: string | null;
  facturas?: FacturaPedido[] | null;
}
interface Declaracion {
  id: string; numero: string; estado: string; fecha: string; subtotal: number; impuesto: number; total: number;
  notas: string | null; rol_declarante: string; factura_id: string | null; orden_id: string | null;
  cliente_id?: string | null; almacen_id?: string | null; empresa_id?: string | null;
  cliente?: { nombre_negocio: string } | null;
  almacen?: { nombre: string } | null;
  factura?: { numero: string } | null;          // factura interna (solo declaraciones aprobadas antes de 22b)
  orden?: PedidoConsignacion | null;
}

const ROL: Record<string, string> = { cliente: "Cliente", vendedor: "Vendedor", admin: "Administración" };
const TABS = ["pendientes", "aprobadas", "rechazadas"];

// 'YYYY-MM-DD' es un día local: new Date('2026-10-08') sería medianoche UTC y en Caracas mostraría el día anterior
const fechaDia = (s: string) => new Date(s.length === 10 ? `${s}T00:00:00` : s).toLocaleDateString("es-VE");

const ESTADO: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  pendiente: { label: "Pendiente", variant: "secondary" },
  aprobado: { label: "Aprobado", variant: "default" },
  rechazado: { label: "Rechazado", variant: "destructive" },
};

const facturaDe = (o?: PedidoConsignacion | null) =>
  (o?.facturas ?? []).find((f) => f.tipo === "factura" && f.estado_pago !== "anulado") ?? null;

/** Pedido de la declaración aprobada: número, estado visible y estado del envío a Odoo (como en Órdenes). */
function CeldaPedido({ d }: { d: Declaracion }) {
  const o = d.orden;
  if (!o) return <span className="text-muted-foreground">—</span>;
  const envio = estadoEnvioOdoo(o);
  const visible = estadoVisible(o);
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Link to={`/admin/ordenes?orden=${o.id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-xs text-primary hover:underline">{o.numero}</Link>
      {o.odoo_id ? <OdooBadge /> : null}
      {envio
        ? <Badge variant="outline" className={cn("px-1.5 py-0 text-[10px] font-medium", envio.cls)} title={o.odoo_envio_error || undefined}>{envio.txt}</Badge>
        : <Badge variant="outline" className={cn("px-1.5 py-0 text-[10px] font-medium", claseTono[visible.tono])}>{visible.etiqueta}</Badge>}
    </span>
  );
}

const Consignacion = () => {
  const { formatPrice } = useCurrency();
  const { toast } = useToast();
  const { soloLectura } = useEmpresa();
  const [declaraciones, setDeclaraciones] = useState<Declaracion[]>([]);
  const [loading, setLoading] = useState(true);
  const [detalle, setDetalle] = useState<Declaracion | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const sinPrecio = items.filter((it) => !(Number(it.precio_unitario) > 0));
  const [notas, setNotas] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [q, setQ] = useState("");
  const [params, setParams] = useSearchParams();
  // Pestaña (estado de la declaración) en la URL para que los filtros sobrevivan a recargar
  const tab = TABS.includes(params.get("tab") ?? "") ? params.get("tab")! : "pendientes";
  const setTab = (t: string) => setParams((p) => { const n = new URLSearchParams(p); if (t === "pendientes") n.delete("tab"); else n.set("tab", t); return n; }, { replace: true });

  const fetchAll = async (conSpinner = true) => {
    if (conSpinner) setLoading(true);
    const { data } = await supabase.from("declaraciones_consignacion")
      .select(`id, numero, estado, fecha, subtotal, impuesto, total, notas, rol_declarante, factura_id, orden_id, cliente_id, almacen_id, empresa_id,
        cliente:clientes(nombre_negocio), almacen:almacenes(nombre), factura:facturas(numero),
        orden:ordenes(id, numero, numero_guds, odoo_id, aprobacion, odoo_envio_error, odoo_envio_aviso, estado, estado_odoo,
          facturas(id, numero, tipo, estado_pago))`)
      .order("created_at", { ascending: false });
    setDeclaraciones((data as unknown as Declaracion[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { fetchAll(); }, []);

  // El detalle abierto se refresca con los datos nuevos (p. ej. cuando el pedido llega a Odoo o falla el envío)
  useEffect(() => {
    if (!detalle) return;
    const fresca = declaraciones.find((d) => d.id === detalle.id);
    if (fresca && fresca !== detalle) setDetalle(fresca);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [declaraciones]);

  // Enlace directo a una declaración (?declaracion=<id>), p. ej. desde el pedido en Órdenes
  useEffect(() => {
    const id = params.get("declaracion");
    if (!id || declaraciones.length === 0) return;
    const d = declaraciones.find((x) => x.id === id);
    if (d) abrirDetalle(d);
    setParams((p) => { const n = new URLSearchParams(p); n.delete("declaracion"); return n; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [declaraciones, params]);

  // El envío a Odoo lo hace la función edge en segundo plano: se vuelve a leer unas veces para mostrar el resultado
  const seguirEnvio = () => { [4000, 10000, 20000, 40000].forEach((ms) => setTimeout(() => fetchAll(false), ms)); };

  // ---- Filtros (en la URL): valen para las tres pestañas ----
  const filtroEmpresa = useFiltroEmpresa(declaraciones);
  const f = useFiltros([
    { clave: "cliente", etiqueta: "Cliente", todos: "Todos los clientes", principal: true, opciones: opcionesDe(declaraciones, (d) => d.cliente_id, (d) => d.cliente?.nombre_negocio ?? "—") },
    { clave: "almacen", etiqueta: "Almacén", todos: "Todos los almacenes", principal: true, opciones: opcionesDe(declaraciones, (d) => d.almacen_id, (d) => d.almacen?.nombre ?? "—") },
    { clave: "fecha", etiqueta: "Fecha", tipo: "fecha", principal: true },
    { clave: "declarante", etiqueta: "Declarado por", todos: "Todos", opciones: opcionesDe(declaraciones, (d) => d.rol_declarante, (_d, v) => ROL[v] ?? v) },
    filtroEmpresa,
  ]);
  const termino = q.trim().toLowerCase();
  const filtradas = declaraciones.filter((d) =>
    coincide(d.cliente_id, f.v("cliente")) && coincide(d.almacen_id, f.v("almacen")) && enRango(d.fecha, f.v("fecha"))
    && coincide(d.rol_declarante, f.v("declarante")) && (!filtroEmpresa || coincide(d.empresa_id, f.v("empresa")))
    && (!termino || d.numero.toLowerCase().includes(termino) || (d.cliente?.nombre_negocio || "").toLowerCase().includes(termino)
      || (d.orden?.numero || "").toLowerCase().includes(termino)));
  const pendientes = filtradas.filter((d) => d.estado === "pendiente");
  const aprobadas = filtradas.filter((d) => d.estado === "aprobado");
  const rechazadas = filtradas.filter((d) => d.estado === "rechazado");
  const deTab = tab === "aprobadas" ? aprobadas : tab === "rechazadas" ? rechazadas : pendientes;
  const totalTab = declaraciones.filter((d) => d.estado === (tab === "aprobadas" ? "aprobado" : tab === "rechazadas" ? "rechazado" : "pendiente")).length;
  const conErrorEnvio = aprobadas.filter((d) => d.orden && d.orden.aprobacion === "aprobada" && !d.orden.odoo_id && d.orden.odoo_envio_error).length;

  const pgPend = usePagination(pendientes, 50, f.firma);
  const pgApr = usePagination(aprobadas, 50, f.firma);
  const pgRech = usePagination(rechazadas, 50, f.firma);

  const abrirDetalle = async (d: Declaracion) => {
    setDetalle(d);
    setNotas("");
    setConfirmar(false);
    setItems([]);
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
    setConfirmar(false);
    if (error) { toast({ title: "No se pudo procesar", description: error.message, variant: "destructive" }); return; }
    const r = data as { numero?: string; mensaje?: string };
    toast({
      title: aprobar ? `Declaración aprobada · pedido ${r.numero ?? ""}` : "Declaración rechazada",
      description: aprobar ? (r.mensaje ?? "Se creó el pedido y se está enviando a Odoo.") : "Se descartó la declaración.",
    });
    if (aprobar) {
      // Queda abierta para ver cómo llega el pedido a Odoo
      setTab("aprobadas");
      await fetchAll(false);
      seguirEnvio();
    } else {
      setDetalle(null);
      fetchAll();
    }
  };

  const reintentar = async (ordenId: string) => {
    const err = await reintentarEnvioPedido(ordenId);
    if (err) { toast({ title: "No se pudo reintentar", description: err, variant: "destructive" }); return; }
    toast({ title: "Reintentando el envío a Odoo" });
    await fetchAll(false);
    seguirEnvio();
  };

  const renderTabla = (rows: Declaracion[], pg: ReturnType<typeof usePagination<Declaracion>>, modo: "pendientes" | "aprobadas" | "rechazadas") => (
    <div className="rounded-lg border border-border bg-card">
      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{f.activos || termino ? "Ninguna declaración coincide con la búsqueda o los filtros." : "Sin declaraciones en esta categoría."}</p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nº</TableHead><TableHead>Cliente</TableHead><TableHead>Almacén</TableHead>
                <TableHead>Declarado por</TableHead><TableHead>Fecha</TableHead>
                <TableHead className="text-right">Total</TableHead>
                {modo === "pendientes" && <TableHead className="text-right">Acción</TableHead>}
                {modo === "aprobadas" && <><TableHead>Pedido</TableHead><TableHead>Factura</TableHead></>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pg.pageItems.map((d) => {
                const fac = facturaDe(d.orden);
                return (
                  <TableRow key={d.id} className="cursor-pointer" onClick={() => abrirDetalle(d)}>
                    <TableCell className="whitespace-nowrap font-mono text-xs text-primary">{d.numero}</TableCell>
                    <TableCell className="max-w-[260px] truncate font-medium" title={d.cliente?.nombre_negocio || undefined}>{d.cliente?.nombre_negocio || "—"}</TableCell>
                    <TableCell className="max-w-[220px] truncate text-muted-foreground" title={d.almacen?.nombre || undefined}>{d.almacen?.nombre || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{ROL[d.rol_declarante] ?? d.rol_declarante}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{fechaDia(d.fecha)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-semibold">{formatPrice(d.total)}</TableCell>
                    {modo === "pendientes" && (
                      <TableCell className="text-right"><Button size="sm" className="h-7 px-2.5" onClick={(e) => { e.stopPropagation(); abrirDetalle(d); }}>Revisar</Button></TableCell>
                    )}
                    {modo === "aprobadas" && (
                      <>
                        <TableCell className="whitespace-nowrap"><CeldaPedido d={d} /></TableCell>
                        <TableCell className="whitespace-nowrap">
                          {fac ? (
                            <Link to={`/admin/facturas/${fac.id}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1 font-mono text-xs text-primary hover:underline">
                              <FileText className="h-3.5 w-3.5" /> {fac.numero}
                            </Link>
                          ) : d.factura?.numero ? (
                            <Link to={`/admin/facturas/${d.factura_id}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1 font-mono text-xs text-muted-foreground hover:underline" title="Factura interna de GUDS (antes de que la consignación pasara por Odoo)">
                              <FileText className="h-3.5 w-3.5" /> {d.factura.numero}
                            </Link>
                          ) : <span className="text-xs text-muted-foreground">{d.orden ? "Se factura en Odoo" : "—"}</span>}
                        </TableCell>
                      </>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <DataTablePagination pagination={pg} />
        </>
      )}
    </div>
  );

  const pedido = detalle?.orden ?? null;
  const facturaPedido = facturaDe(pedido);

  return (
    <MainLayout title="Consignación">
      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <BarraLista
            pestanas={
              <TabsList className="h-auto flex-wrap justify-start">
                <TabsTrigger value="pendientes" className="gap-1.5"><Boxes className="h-3.5 w-3.5" /> Pendientes ({pendientes.length})</TabsTrigger>
                <TabsTrigger value="aprobadas" className="gap-1.5">
                  Aprobadas ({aprobadas.length})
                  {conErrorEnvio > 0 && <span className="rounded bg-destructive/10 px-1 text-[10px] font-semibold text-destructive" title="Pedidos que no se pudieron crear en Odoo">{conErrorEnvio} con error</span>}
                </TabsTrigger>
                <TabsTrigger value="rechazadas">Rechazadas ({rechazadas.length})</TabsTrigger>
              </TabsList>
            }
            busqueda={q}
            onBusqueda={setQ}
            placeholder="Buscar número, cliente o pedido..."
            filtros={<FiltrosLista filtros={f} resultados={deTab.length} />}
            contador={contadorFiltrado(deTab.length, totalTab, f.activos || !!termino)}
          />
          <p className="mb-2 text-xs text-muted-foreground" data-testid="consignacion-flujo">
            Al aprobar una declaración se crea un <strong>pedido</strong> que va a Odoo como cotización desde el almacén de consignación del cliente;
            en Odoo se confirma, se valida la entrega y se factura. El inventario baja y la factura llega con la sincronización.
          </p>
          <TabsContent value="pendientes">{renderTabla(pendientes, pgPend, "pendientes")}</TabsContent>
          <TabsContent value="aprobadas">{renderTabla(aprobadas, pgApr, "aprobadas")}</TabsContent>
          <TabsContent value="rechazadas">{renderTabla(rechazadas, pgRech, "rechazadas")}</TabsContent>
        </Tabs>
      )}

      <Dialog open={!!detalle} onOpenChange={(o) => { if (!o) { setDetalle(null); setConfirmar(false); } }}>
        <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              Declaración {detalle?.numero}
              {detalle && <Badge variant={ESTADO[detalle.estado]?.variant ?? "secondary"}>{ESTADO[detalle.estado]?.label ?? detalle.estado}</Badge>}
            </DialogTitle>
            <DialogDescription className="sr-only">Detalle de la declaración de venta en consignación</DialogDescription>
          </DialogHeader>
          {detalle && (
            <div className="space-y-4 py-1">
              <div className="grid grid-cols-1 gap-2 rounded-lg border bg-muted/40 p-3 text-sm sm:grid-cols-2">
                <div className="min-w-0"><span className="text-muted-foreground">Cliente:</span> <span className="font-medium">{detalle.cliente?.nombre_negocio}</span></div>
                <div className="min-w-0"><span className="text-muted-foreground">Almacén:</span> {detalle.almacen?.nombre}</div>
                <div><span className="text-muted-foreground">Declarado por:</span> {ROL[detalle.rol_declarante] ?? detalle.rol_declarante}</div>
                <div><span className="text-muted-foreground">Fecha:</span> {fechaDia(detalle.fecha)}</div>
              </div>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Producto</TableHead><TableHead className="text-center">Cant.</TableHead><TableHead className="text-right">Precio</TableHead><TableHead className="text-right">Subtotal</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((it) => (
                      <TableRow key={it.id}>
                        <TableCell className="font-medium">{it.nombre_producto}{it.sku_producto && <span className="block font-mono text-[11px] font-normal text-muted-foreground">{it.sku_producto}</span>}</TableCell>
                        <TableCell className="text-center">{it.cantidad}</TableCell>
                        <TableCell className="whitespace-nowrap text-right">{formatPrice(it.precio_unitario)}</TableCell>
                        <TableCell className="whitespace-nowrap text-right font-semibold">{formatPrice(it.subtotal)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 text-sm">
                <span>Subtotal: <span className="font-semibold">{formatPrice(detalle.subtotal)}</span></span>
                <span>IVA: <span className="font-semibold">{formatPrice(detalle.impuesto)}</span></span>
                <span>Total: <span className="font-semibold text-primary">{formatPrice(detalle.total)}</span></span>
              </div>
              {detalle.notas && <p className="text-sm text-muted-foreground">Notas: {detalle.notas}</p>}
              {/* 22e: con líneas sin precio no se aprueba (irían en 0 a Odoo); la base también lo impide */}
              {detalle.estado === "pendiente" && sinPrecio.length > 0 && (
                <p role="alert" className="flex items-start gap-1.5 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" data-testid="consignacion-sin-precio">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    <strong>No se puede aprobar:</strong> {sinPrecio.map((it) => it.nombre_producto).join(", ")} sin precio.
                    Recházala y que se declare de nuevo cuando {sinPrecio.length === 1 ? "tenga" : "tengan"} precio.
                  </span>
                </p>
              )}

              {/* Pendiente: qué pasa al aprobar */}
              {detalle.estado === "pendiente" && (
                <>
                  <div className="rounded-lg border border-sky-300 bg-sky-50 p-3 text-xs text-sky-950 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-100" data-testid="consignacion-al-aprobar">
                    <p className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold"><Send className="h-3.5 w-3.5" /> Al aprobar se creará el pedido en Odoo</p>
                    Se crea un pedido con estos productos, cantidades y precios y se envía a Odoo como <strong>cotización en borrador</strong> desde
                    el almacén <strong>{detalle.almacen?.nombre}</strong>. En Odoo se confirma, se valida la entrega y se factura: la factura y la
                    baja del inventario llegan a GUDS con la sincronización. Aquí no se genera factura interna.
                  </div>
                  {soloLectura ? (
                    <p className="flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100" data-testid="consignacion-solo-lectura">
                      <Layers className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Estás viendo ambas empresas: elige la empresa de esta declaración (GUDS o Quirutec) en el menú superior para aprobarla o rechazarla.
                    </p>
                  ) : (
                    <Textarea rows={2} placeholder="Notas de la revisión (opcional)" value={notas} onChange={(e) => setNotas(e.target.value)} />
                  )}
                  {confirmar && (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-[13px] text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100" role="alertdialog" aria-label="Confirmar aprobación">
                      <p className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>¿Aprobar {detalle.numero}? Se crea en Odoo la cotización de {formatPrice(detalle.total)} para {detalle.cliente?.nombre_negocio}. Desde GUDS no se puede deshacer.</span>
                      </p>
                    </div>
                  )}
                </>
              )}

              {/* Aprobada: el pedido y su camino en Odoo */}
              {detalle.estado === "aprobado" && pedido && (
                <div className="space-y-2 rounded-lg border p-3" data-testid="consignacion-pedido">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Pedido:</span>
                    <Link to={`/admin/ordenes?orden=${pedido.id}`} className="inline-flex items-center gap-1 font-mono font-medium text-primary hover:underline">
                      {pedido.numero} <ExternalLink className="h-3 w-3" />
                    </Link>
                    {pedido.numero_guds && <Badge variant="secondary" className="px-1 py-0 text-[10px] font-normal" title="Número con que se creó en GUDS">{pedido.numero_guds}</Badge>}
                    {pedido.odoo_id ? <OdooBadge /> : null}
                    <Badge variant="outline" className={cn("font-medium", claseTono[estadoVisible(pedido).tono])}>{estadoVisible(pedido).etiqueta}</Badge>
                    {estadoEnvioOdoo(pedido) && (
                      <Badge variant="outline" className={cn("px-1.5 py-0 text-[10px] font-medium", estadoEnvioOdoo(pedido)!.cls)}>{estadoEnvioOdoo(pedido)!.txt}</Badge>
                    )}
                  </div>
                  {pedido.odoo_id && (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5 text-success" /> En Odoo como {pedido.numero}: se confirma, se entrega y se factura allí.
                    </p>
                  )}
                  <PanelEnvioOdoo orden={pedido} onReintentar={() => reintentar(pedido.id)} />
                  {pedido.odoo_envio_aviso && (
                    <p className="flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {pedido.odoo_envio_aviso}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Factura:{" "}
                    {facturaPedido
                      ? <Link to={`/admin/facturas/${facturaPedido.id}`} className="font-mono text-primary hover:underline">{facturaPedido.numero}</Link>
                      : "llega de Odoo cuando el pedido se facture."}
                  </p>
                </div>
              )}
              {detalle.estado === "aprobado" && !pedido && detalle.factura?.numero && (
                <p className="text-xs text-muted-foreground">
                  Aprobada antes de que la consignación pasara por Odoo: factura interna{" "}
                  <Link to={`/admin/facturas/${detalle.factura_id}`} className="font-mono text-primary hover:underline">{detalle.factura.numero}</Link>.
                </p>
              )}
            </div>
          )}
          {detalle?.estado === "pendiente" && (
            <DialogFooter className="gap-2">
              {confirmar ? (
                <>
                  <Button variant="outline" onClick={() => setConfirmar(false)} disabled={saving} autoFocus>Cancelar</Button>
                  <Button onClick={() => revisar(true)} disabled={saving || soloLectura || sinPrecio.length > 0} className="gap-2">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Sí, crear el pedido en Odoo
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="destructive" onClick={() => revisar(false)} disabled={saving || soloLectura}>Rechazar</Button>
                  <Button onClick={() => setConfirmar(true)} disabled={saving || soloLectura || sinPrecio.length > 0} className="gap-2">
                    <Send className="h-4 w-4" /> Aprobar y crear pedido en Odoo
                  </Button>
                </>
              )}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
};

export default Consignacion;
