import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { FileText, Loader2, Pencil, RotateCcw, Truck, PackageCheck, CalendarClock, AlertTriangle, XCircle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/hooks/use-toast";
import { claseTono, estadoVisible } from "@/components/pedidos/estadoPedido";
import { LineaTiempoPedido } from "@/components/pedidos/LineaTiempoPedido";
import { ProductImage } from "@/components/portal/ProductImage";
import { ResumenPagoPedido } from "@/components/portal/ResumenPagoPedido";
import { pedidoEditable } from "@/components/portal/pedidoEditable";
import { usePortal } from "@/components/portal/contextoPortal";
import { EstadoPill, NumeroPedido, PillPago, PillTono, fechaCorta, unidadTexto, type Tono } from "@/components/portal/sistema";

export { NumeroPedido };
import { useCarritoPortal, type ResultadoRepetir } from "@/hooks/useCarritoPortal";

// Detalle de un pedido del cliente (F4): estado visible con su mensaje (mismo contrato que vendedor y admin), línea de
// tiempo (orden_eventos), número de Odoo y el anterior de GUDS, productos y totales guardados, facturas del pedido con su
// saldo, despachos, pago y "volver a pedir". Se usa en el panel derecho (escritorio) y en la hoja (móvil).

export interface PedidoDetalle {
  id: string;
  numero: string;
  numero_guds: string | null;
  estado: string;
  estado_odoo: string | null;
  aprobacion: "pendiente" | "aprobada" | "rechazada" | null;
  rechazo_motivo: string | null;
  odoo_id: number | null;
  odoo_envio_error: string | null;
  estado_pago: string | null;
  subtotal: number;
  descuento: number | null;
  impuesto: number | null;
  envio: number | null;
  total: number;
  created_at: string;
  fecha_pedido: string | null;
  fecha_entrega_estimada: string | null;
  vendedor_id: string | null;
  ediciones: number | null;
  editado_at: string | null;
  items: {
    id: string;
    producto_id: string;
    cantidad: number;
    precio_unitario: number;
    subtotal: number;
    tipo_empaque_id: string | null;
    nombre_producto: string | null;
    sku_producto: string | null;
    producto: { nombre: string; sku: string | null; imagen_url: string | null; unidad: string | null } | null;
    tipo_empaque: { nombre: string; unidades: number | null } | null;
  }[];
}

interface FacturaPedido {
  id: string; numero: string; tipo: string; es_nota_debito: boolean | null; estado: string;
  fecha_emision: string | null; fecha_vencimiento: string | null; total_usd: number | null; total: number | null; saldo_usd: number | null;
}
interface EventoDespacho { id: number; tipo: string; detalle: string | null; fecha: string }

const TOLERANCIA = 0.009;
const TIPOS_DESPACHO = ["despachado", "en_camino", "entregado", "entrega_incompleta", "entrega_rechazada", "reprogramado"];
const HITO_DESPACHO: Record<string, { etiqueta: string; icono: typeof Truck; tono: Tono }> = {
  despachado: { etiqueta: "Salió del almacén", icono: PackageCheck, tono: "proceso" },
  en_camino: { etiqueta: "En camino", icono: Truck, tono: "proceso" },
  entregado: { etiqueta: "Entregado", icono: CheckCircle2, tono: "ok" },
  entrega_incompleta: { etiqueta: "Entregado incompleto", icono: AlertTriangle, tono: "pendiente" },
  entrega_rechazada: { etiqueta: "Entrega rechazada", icono: XCircle, tono: "riesgo" },
  reprogramado: { etiqueta: "Entrega reprogramada", icono: CalendarClock, tono: "pendiente" },
};

export const SELECT_PEDIDO_DETALLE = `id, numero, numero_guds, estado, estado_odoo, aprobacion, rechazo_motivo, odoo_id, odoo_envio_error, estado_pago,
  subtotal, descuento, impuesto, envio, total, created_at, fecha_pedido, fecha_entrega_estimada, vendedor_id, ediciones, editado_at,
  items:orden_items(id, producto_id, cantidad, precio_unitario, subtotal, tipo_empaque_id, nombre_producto, sku_producto,
    producto:productos(nombre, sku, imagen_url, unidad), tipo_empaque:tipos_empaque(nombre, unidades))`;


const etiquetaFactura = (f: FacturaPedido) => (f.tipo === "nota_credito" ? "Nota de crédito" : f.es_nota_debito ? "Nota de débito" : "Factura");

const Seccion = ({ titulo, extra, children }: { titulo: string; extra?: ReactNode; children: ReactNode }) => (
  <section>
    <div className="mb-3 flex items-center justify-between gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</h3>
      {extra}
    </div>
    {children}
  </section>
);

export const textoRepetir = (r: ResultadoRepetir) => {
  const partes: string[] = [];
  if (r.ajustadas.length) partes.push(`Ajustamos al disponible: ${r.ajustadas.map((a) => `${a.nombre} (${a.agregada} de ${a.pedida})`).join(", ")}.`);
  if (r.omitidas.length) partes.push(`No agregamos: ${r.omitidas.map((o) => `${o.nombre} (${o.motivo})`).join(", ")}.`);
  return partes.join(" ");
};

interface Props {
  ordenId: string;
  /** Dentro de una hoja (móvil): el encabezado usa SheetTitle para la accesibilidad del diálogo. */
  enHoja?: boolean;
  recarga?: number;
  recienEnviado?: boolean;
  actualizado?: { total: number } | null;
  /** Muestra "Editar pedido" si el cliente puede editarlo (lo hizo en el portal y sigue por aprobar). */
  onEditar?: () => void;
}

export const DetallePedido = ({ ordenId, enHoja, recarga = 0, recienEnviado, actualizado, onEditar }: Props) => {
  const { formatPrice } = useCurrency();
  const { toast } = useToast();
  const portal = usePortal();
  const { agregarLineas } = useCarritoPortal();
  const [pedido, setPedido] = useState<PedidoDetalle | null>(null);
  const [facturas, setFacturas] = useState<FacturaPedido[] | null>(null);
  const [despachos, setDespachos] = useState<EventoDespacho[] | null>(null);
  const [error, setError] = useState(false);
  const [repitiendo, setRepitiendo] = useState(false);

  useEffect(() => {
    let activo = true;
    setError(false);
    if (!pedido || pedido.id !== ordenId) { setPedido(null); setFacturas(null); setDespachos(null); }
    Promise.all([
      supabase.from("ordenes").select(SELECT_PEDIDO_DETALLE).eq("id", ordenId).maybeSingle(),
      supabase.from("facturas").select("id, numero, tipo, es_nota_debito, estado, fecha_emision, fecha_vencimiento, total_usd, total, saldo_usd")
        .eq("orden_id", ordenId).order("fecha_emision"),
      supabase.from("orden_eventos").select("id, tipo, detalle, fecha").eq("orden_id", ordenId).in("tipo", TIPOS_DESPACHO).order("fecha"),
    ]).then(([o, f, d]) => {
      if (!activo) return;
      if (o.error || !o.data) { setError(true); return; }
      setPedido(o.data as unknown as PedidoDetalle);
      setFacturas((f.data as FacturaPedido[] | null) ?? []);
      setDespachos((d.data as EventoDespacho[] | null) ?? []);
    });
    return () => { activo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordenId, recarga]);

  // En la hoja (diálogo) siempre hay un título accesible, también mientras carga
  const tituloOculto = (t: string) => (enHoja ? <><SheetTitle className="sr-only">{t}</SheetTitle><SheetDescription className="sr-only">Detalle del pedido</SheetDescription></> : null);
  if (error) {
    return (
      <>
        {tituloOculto("Pedido no encontrado")}
        <p className="p-6 text-sm text-muted-foreground">No encontramos este pedido. Puede que pertenezca a otra empresa o que ya no esté disponible.</p>
      </>
    );
  }
  if (!pedido) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" aria-busy="true">
        {tituloOculto("Cargando pedido")}
        <div className="space-y-2 border-b border-border px-5 py-4">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-56" />
        </div>
        <div className="space-y-4 px-5 py-5">
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-40 w-full rounded-lg" />
        </div>
      </div>
    );
  }

  const ev = estadoVisible(pedido);
  const editado = (pedido.ediciones ?? 0) > 0;
  const descuento = Number(pedido.descuento ?? 0);
  const impuesto = Number(pedido.impuesto ?? 0);
  const envio = pedido.envio == null ? null : Number(pedido.envio);
  const puedeEditar = !!onEditar && pedidoEditable(pedido) && !pedido.vendedor_id;
  const delVendedorPendiente = pedidoEditable(pedido) && !!pedido.vendedor_id;
  const puedeRepetir = ev.clave !== "por_aprobar" && pedido.items.length > 0;
  const deGuds = !pedido.odoo_id || !!pedido.numero_guds;
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const anulado = ev.clave === "rechazado" || ev.clave === "cancelado";

  const repetir = async () => {
    setRepitiendo(true);
    const r = await agregarLineas(pedido.items.map((i) => ({
      producto_id: i.producto_id, tipo_empaque_id: i.tipo_empaque_id, cantidad: i.cantidad,
      nombre: i.producto?.nombre ?? i.nombre_producto ?? "Producto",
    })));
    setRepitiendo(false);
    const detalle = textoRepetir(r);
    if (r.agregadas === 0) {
      toast({ title: "No se agregó ningún producto", description: detalle || "Intenta de nuevo.", variant: "destructive" });
      return;
    }
    toast({ title: `Agregamos ${r.agregadas} ${r.agregadas === 1 ? "producto" : "productos"} al carrito`, description: detalle || "Con el precio y el disponible de hoy." });
    portal?.abrirCarrito();
  };

  const Titulo = enHoja ? SheetTitle : "h2";
  const Descripcion = enHoja ? SheetDescription : "p";

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="detalle-pedido">
      {/* Encabezado */}
      <div className="border-b border-border px-5 py-4 pr-12 lg:pr-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Titulo className="text-lg font-semibold text-foreground">
            <NumeroPedido numero={pedido.numero} numeroGuds={pedido.numero_guds} />
          </Titulo>
          <EstadoPill pedido={pedido} />
          {!["rechazado", "cancelado"].includes(ev.clave) && <PillPago estado={pedido.estado_pago} />}
        </div>
        <Descripcion className="mt-1 text-sm text-muted-foreground">
          Pedido del {fechaCorta(pedido.fecha_pedido ?? pedido.created_at)}
          {editado && ` · Editado${pedido.editado_at ? ` el ${fechaCorta(pedido.editado_at)}` : ""}`}
        </Descripcion>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 py-5">
        {/* Estado con su mensaje */}
        {recienEnviado ? (
          <div className={cn("rounded-lg border px-4 py-3 text-sm", claseTono.ok)} data-testid="pedido-recibido">
            <p className="font-semibold">Pedido recibido · pendiente de aprobación</p>
            <p className="mt-1">Nuestro equipo revisará precios, disponibilidad y condiciones. Te avisaremos por notificación cuando lo aprobemos.</p>
          </div>
        ) : actualizado ? (
          <div className={cn("rounded-lg border px-4 py-3 text-sm", claseTono.ok)} data-testid="pedido-actualizado">
            <p className="font-semibold">Pedido actualizado · pendiente de aprobación</p>
            <p className="mt-1">GUDS recalculó el total: <strong className="tabular-nums">{formatPrice(actualizado.total)}</strong>. Te avisaremos cuando lo aprobemos.</p>
          </div>
        ) : (
          <div className={cn("rounded-lg border px-4 py-3 text-sm", claseTono[ev.tono])} data-testid="estado-mensaje">
            <p className="font-semibold">{ev.etiqueta}</p>
            <p className="mt-0.5">
              {ev.clave === "rechazado"
                ? (pedido.rechazo_motivo ? `Motivo: ${pedido.rechazo_motivo}` : "No se indicó el motivo.")
                : ev.mensaje}
            </p>
          </div>
        )}

        {(puedeEditar || puedeRepetir || delVendedorPendiente) && (
          <div className="flex flex-wrap gap-2">
            {puedeEditar && (
              <Button variant="outline" className="h-10 gap-2" onClick={onEditar} data-testid="editar-pedido">
                <Pencil className="h-4 w-4" />Editar pedido
              </Button>
            )}
            {puedeRepetir && (
              <Button variant={ev.clave === "rechazado" || ev.clave === "entregado" ? "default" : "outline"} className="h-10 gap-2" onClick={repetir}
                disabled={repitiendo} data-testid="volver-a-pedir">
                {repitiendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}Volver a pedir
              </Button>
            )}
            {delVendedorPendiente && (
              <p className="w-full text-xs text-muted-foreground" data-testid="pedido-del-vendedor">
                Este pedido lo cargó tu vendedor. Si necesitas cambiarlo, comunícate con él.
              </p>
            )}
          </div>
        )}

        {pedido.fecha_entrega_estimada && (
          <div className="flex items-center justify-between rounded-lg border border-border px-4 py-2.5 text-sm">
            <span className="text-muted-foreground">Entrega estimada</span>
            <span className="font-medium">{fechaCorta(pedido.fecha_entrega_estimada)}</span>
          </div>
        )}

        <Seccion titulo="Seguimiento">
          <LineaTiempoPedido ordenId={pedido.id} recarga={recarga} />
        </Seccion>

        <Seccion titulo={`Productos (${pedido.items.length})`}>
          {pedido.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Este pedido no tiene productos.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {pedido.items.map((it) => {
                const nombre = it.producto?.nombre ?? it.nombre_producto ?? "Producto";
                const sku = it.producto?.sku ?? it.sku_producto;
                const empaque = it.tipo_empaque ? `${it.tipo_empaque.nombre}${Number(it.tipo_empaque.unidades) > 1 ? ` ×${it.tipo_empaque.unidades}` : ""}` : unidadTexto(it.producto?.unidad);
                return (
                  <li key={it.id} className="flex items-start gap-3 px-3 py-3" data-testid="linea-pedido">
                    <ProductImage imageUrl={it.producto?.imagen_url} alt={nombre} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm font-medium leading-snug">{nombre}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                        {[sku, empaque].filter(Boolean).join(" · ")}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">{it.cantidad} × {formatPrice(Number(it.precio_unitario))}</p>
                    </div>
                    <p className="shrink-0 text-sm font-medium tabular-nums">{formatPrice(Number(it.subtotal))}</p>
                  </li>
                );
              })}
            </ul>
          )}
          {/* Totales tal como se guardaron */}
          <dl className="mt-3 space-y-1.5 rounded-lg bg-muted/50 px-4 py-3 text-sm">
            <div className="flex justify-between"><dt className="text-muted-foreground">Subtotal</dt><dd className="tabular-nums">{formatPrice(Number(pedido.subtotal))}</dd></div>
            {descuento > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Descuento</dt><dd className="tabular-nums">−{formatPrice(descuento)}</dd></div>}
            <div className="flex justify-between"><dt className="text-muted-foreground">IVA</dt><dd className="tabular-nums">{formatPrice(impuesto)}</dd></div>
            {envio != null && <div className="flex justify-between"><dt className="text-muted-foreground">Envío</dt><dd className="tabular-nums">{envio > 0 ? formatPrice(envio) : "Sin costo"}</dd></div>}
            <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
              <dt>Total</dt><dd className="tabular-nums" data-testid="detalle-total">{formatPrice(Number(pedido.total))}</dd>
            </div>
          </dl>
        </Seccion>

        {/* Un pedido no aprobado o cancelado sin documentos no muestra facturas ni despachos vacíos */}
        {!(anulado && facturas?.length === 0 && despachos?.length === 0) && (
        <div className="grid gap-6 xl:grid-cols-2">
          <Seccion titulo="Facturas">
            {facturas === null ? <Skeleton className="h-14 w-full rounded-lg" /> : facturas.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aún no se ha facturado.</p>
            ) : (
              <ul className="space-y-2" data-testid="facturas-pedido">
                {facturas.map((f) => {
                  const saldo = Number(f.saldo_usd ?? 0);
                  const anulada = f.estado === "cancel";
                  const vencida = saldo > TOLERANCIA && !!f.fecha_vencimiento && new Date(`${f.fecha_vencimiento}T00:00:00`) < hoy;
                  return (
                    <li key={f.id} className="rounded-lg border border-border px-3 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 text-sm font-medium">
                            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />{etiquetaFactura(f)} {f.numero}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                            {fechaCorta(f.fecha_emision)} · Total {formatPrice(Number(f.total_usd ?? f.total ?? 0))}
                          </p>
                        </div>
                        {anulada ? <PillTono tono="neutro">Anulada</PillTono>
                          : saldo > TOLERANCIA ? <PillTono tono={vencida ? "riesgo" : "pendiente"}>{vencida ? "Vencida" : "Saldo"} {formatPrice(saldo)}</PillTono>
                          : saldo < -TOLERANCIA ? <PillTono tono="ok">A favor {formatPrice(-saldo)}</PillTono>
                          : <PillTono tono="ok">Pagada</PillTono>}
                      </div>
                      {!anulada && saldo > TOLERANCIA && f.tipo !== "nota_credito" && (
                        <Link to={`/portal/pagos?factura=${f.id}`} className="mt-2 inline-block text-xs font-medium text-primary hover:underline">Declarar pago de esta factura</Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Seccion>

          <Seccion titulo="Despachos">
            {despachos === null ? <Skeleton className="h-14 w-full rounded-lg" /> : despachos.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {ev.clave === "entregado" || ev.clave === "despachado_parcial" ? "Salió del almacén; el detalle del despacho no está disponible." : "Aún no ha salido del almacén."}
              </p>
            ) : (
              <ul className="space-y-2" data-testid="despachos-pedido">
                {despachos.map((d) => {
                  const h = HITO_DESPACHO[d.tipo] ?? HITO_DESPACHO.despachado;
                  return (
                    <li key={d.id} className="flex items-start gap-2.5 rounded-lg border border-border px-3 py-2.5">
                      <h.icono className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{h.etiqueta}</p>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {new Date(d.fecha).toLocaleString("es-VE", { dateStyle: "medium", timeStyle: "short" })}{d.detalle ? ` · ${d.detalle}` : ""}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Seccion>
        </div>
        )}

        {deGuds && !(["rechazado", "cancelado"].includes(ev.clave) && pedido.estado_pago !== "pagado" && pedido.estado_pago !== "parcial") && (
          <Seccion titulo="Pago">
            <ResumenPagoPedido ordenId={pedido.id} recarga={recarga + Number(actualizado?.total ?? 0)} />
            {pedido.estado_pago === "pagado" ? (
              <p className="mt-2 text-xs text-muted-foreground">El pago de este pedido está completo.</p>
            ) : ev.clave !== "rechazado" && ev.clave !== "cancelado" ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Puedes <Link to="/portal/pagos" className="font-medium text-primary hover:underline">declarar un pago</Link> de este pedido cuando lo realices.
              </p>
            ) : null}
          </Seccion>
        )}
      </div>
    </div>
  );
};
