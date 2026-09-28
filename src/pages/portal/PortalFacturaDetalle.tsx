import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertCircle, ArrowUpRight, FileText, Plus, RefreshCw } from "lucide-react";
import { PortalPagina } from "@/components/portal/PortalPagina";
import { EstadoVacio, Panel, SkeletonFilas, fechaCorta } from "@/components/portal/sistema";
import { PillDocumento } from "@/components/portal/finanzas";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrency } from "@/contexts/CurrencyContext";
import { METODO_LABEL } from "@/hooks/useCuentasPago";
import { cn } from "@/lib/utils";
import {
  TOLERANCIA, cuentaEnDeuda, estadoDocumento, etiquetaTipoDoc, pedirFactura, type FacturaAplicacion, type FacturaPortal,
} from "@/hooks/useFinanzasPortal";

// Ficha de una factura (o nota de crédito / débito) del cliente (F5): datos, renglones con sus impuestos, lo aplicado
// (cobros, retenciones, notas de crédito, ajustes) y "Pagar esta factura", que abre la declaración con la factura elegida.
// Sale de la función factura_portal: solo devuelve documentos de la ficha del cliente en la empresa activa.

/** Monto en la moneda original del documento (Bs. o USD), sin convertir. */
const enMoneda = (valor: number | null | undefined, moneda: string | null) => {
  const n = Number(valor ?? 0);
  return moneda === "VES" || moneda === "BS"
    ? `Bs. ${n.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const cantidad = (n: number) => Number(n).toLocaleString("es-VE", { maximumFractionDigits: 3 });

const ETIQUETA_APLICACION: Record<FacturaAplicacion["tipo"], string> = {
  cobro: "Cobro",
  retencion: "Retención",
  nota_credito: "Nota de crédito",
  reintegro: "Reintegro",
  ajuste: "Ajuste",
};
const RETENCION: Record<string, string> = { IVA1: "Retención de IVA", RETRS: "Retención municipal", iva: "Retención de IVA", islr: "Retención de ISLR" };
const conceptoAplicacion = (a: FacturaAplicacion) => {
  if (a.tipo === "cobro") return a.metodo && METODO_LABEL[a.metodo] ? `Cobro · ${METODO_LABEL[a.metodo]}` : "Cobro";
  if (a.tipo === "retencion") return RETENCION[a.metodo ?? ""] ?? RETENCION[(a.referencia ?? "").split("/")[0]] ?? "Retención";
  return ETIQUETA_APLICACION[a.tipo] ?? "Ajuste";
};

const PortalFacturaDetalle = () => {
  const { id } = useParams<{ id: string }>();
  const { formatPrice } = useCurrency();
  const [f, setF] = useState<FacturaPortal | null | undefined>(undefined); // undefined = cargando, null = no existe
  const [error, setError] = useState(false);

  const cargar = () => {
    if (!id) return;
    setError(false);
    setF(undefined);
    pedirFactura(id).then(setF).catch(() => setError(true));
  };
  useEffect(cargar, [id]);

  const titulo = f ? `${etiquetaTipoDoc(f)} ${f.numero}` : "Factura";

  if (error || f === null) {
    return (
      <PortalPagina titulo="Factura" volver="/portal/facturas" etiquetaVolver="Facturas" ancho="estrecho">
        <div className="rounded-xl border border-border bg-card">
          {error ? (
            <EstadoVacio icono={AlertCircle} titulo="No pudimos cargar la factura"
              accion={<Button variant="outline" className="gap-2" onClick={cargar}><RefreshCw className="h-4 w-4" />Reintentar</Button>} />
          ) : (
            <EstadoVacio icono={FileText} titulo="No encontramos esta factura" descripcion="Puede que pertenezca a otra empresa o que el enlace esté incompleto."
              accion={<Button asChild variant="outline"><Link to="/portal/facturas">Ver mis facturas</Link></Button>} />
          )}
        </div>
      </PortalPagina>
    );
  }

  if (f === undefined) {
    return (
      <PortalPagina titulo="Factura" volver="/portal/facturas" etiquetaVolver="Facturas">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-4"><Skeleton className="h-32 rounded-xl" /><SkeletonFilas n={5} alto="h-12" /></div>
          <Skeleton className="h-48 rounded-xl" />
        </div>
      </PortalPagina>
    );
  }

  const e = estadoDocumento(f, f.hoy);
  const esNC = f.tipo === "nota_credito";
  const anulada = e.clave === "anulada";
  const saldo = Number(f.saldo_usd ?? 0);
  const total = Number(f.total_usd ?? 0);
  const aplicado = f.aplicaciones.reduce((s, a) => s + Number(a.monto_usd), 0);
  const enBs = f.moneda === "VES" || f.moneda === "BS";
  const pagable = cuentaEnDeuda(f) && !esNC && !anulada;
  const vence = f.fecha_vencimiento || f.fecha_emision;

  const panelSaldo = (
    <Panel titulo="Saldo">
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Total</dt><dd className="tabular-nums">{formatPrice(Math.abs(total))}</dd></div>
        {!anulada && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{esNC ? "Aplicado" : "Pagado y aplicado"}</dt>
            <dd className="tabular-nums">{formatPrice(esNC ? Math.max(0, Math.abs(total) - Math.abs(saldo)) : Math.max(0, total - saldo))}</dd>
          </div>
        )}
        <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2">
          <dt className="font-semibold">{anulada ? "Estado" : esNC ? "Disponible a favor" : "Saldo pendiente"}</dt>
          <dd className="text-xl font-semibold tabular-nums" data-testid="factura-saldo">
            {anulada ? "Anulada" : formatPrice(Math.abs(saldo) > TOLERANCIA ? Math.abs(saldo) : 0)}
          </dd>
        </div>
      </dl>
      {pagable && (
        <Button asChild className="mt-4 w-full gap-2" size="lg" data-testid="pagar-factura">
          <Link to={`/portal/pagos?factura=${f.id}`}><Plus className="h-4 w-4" />Pagar esta factura</Link>
        </Button>
      )}
      {pagable && <p className="mt-2 text-center text-xs text-muted-foreground">Declara el pago que hiciste; lo verificaremos y te avisaremos.</p>}
      {enBs && !anulada && (
        <p className="mt-3 text-xs text-muted-foreground">Emitida en bolívares a la tasa {Number(f.tasa_cambio ?? 0).toLocaleString("es-VE", { maximumFractionDigits: 4 })}; los montos en USD usan esa tasa.</p>
      )}
    </Panel>
  );

  return (
    <PortalPagina titulo={titulo} volver="/portal/facturas" etiquetaVolver="Facturas" descripcion={`Emitida el ${fechaCorta(f.fecha_emision)}`}>
      {/* Una sola grilla: en móvil el saldo va tras el encabezado; en escritorio, columna derecha fija */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
          {/* Encabezado */}
          <section className="rounded-xl border border-border bg-card p-4 sm:p-5 lg:col-start-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{etiquetaTipoDoc(f)}</p>
                <p className="text-xl font-semibold tabular-nums" data-testid="factura-numero">{f.numero}</p>
              </div>
              <PillDocumento doc={f} hoy={f.hoy} />
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
              <div><dt className="text-xs text-muted-foreground">Emisión</dt><dd className="tabular-nums">{fechaCorta(f.fecha_emision)}</dd></div>
              {!esNC && (
                <div>
                  <dt className="text-xs text-muted-foreground">Vencimiento</dt>
                  <dd className={cn("tabular-nums", e.clave === "vencida" && "text-destructive")}>
                    {fechaCorta(vence)}{e.dias ? ` · hace ${e.dias} ${e.dias === 1 ? "día" : "días"}` : ""}
                  </dd>
                </div>
              )}
              <div><dt className="text-xs text-muted-foreground">Moneda</dt><dd>{enBs ? "Bolívares" : "Dólares"}</dd></div>
              {f.nro_control && <div><dt className="text-xs text-muted-foreground">N.º de control</dt><dd className="tabular-nums">{f.nro_control}</dd></div>}
              {f.orden && (
                <div>
                  <dt className="text-xs text-muted-foreground">Pedido</dt>
                  <dd><Link to={`/portal/pedidos?pedido=${f.orden.id}`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">{f.orden.numero}<ArrowUpRight className="h-3.5 w-3.5" /></Link></dd>
                </div>
              )}
              {f.origen && (
                <div>
                  <dt className="text-xs text-muted-foreground">Documento de origen</dt>
                  <dd><Link to={`/portal/facturas/${f.origen.id}`} className="font-medium text-primary hover:underline">{f.origen.numero}</Link></dd>
                </div>
              )}
            </dl>
            {anulada && (
              <p className="mt-4 rounded-lg border border-border bg-muted/60 px-3 py-2 text-sm text-muted-foreground" data-testid="factura-anulada">
                {Math.abs(saldo) > TOLERANCIA
                  ? `Este documento fue anulado con una nota de crédito que aún no se ha cruzado en la contabilidad: su saldo (${formatPrice(Math.abs(saldo))}) y el de la nota se compensan en tu estado de cuenta.`
                  : "Este documento está anulado y no forma parte de tu saldo."}
                {f.motivo_anulacion ? ` Motivo: ${f.motivo_anulacion}` : ""}
              </p>
            )}
            {f.motivo_nota && !anulada && <p className="mt-3 text-sm text-muted-foreground">Motivo: {f.motivo_nota}</p>}
          </section>

          <aside className="lg:sticky lg:top-[5.5rem] lg:col-start-2 lg:row-span-4 lg:row-start-1">{panelSaldo}</aside>

          {/* Renglones */}
          <Panel className="lg:col-start-1" titulo="Detalle" descripcion={`${f.items.length} ${f.items.length === 1 ? "renglón" : "renglones"} · montos en ${enBs ? "bolívares" : "dólares"}`} cuerpoClassName="p-0 sm:p-0">
            {f.items.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">Este documento no tiene renglones de productos.</p>
            ) : (
              <>
                <table className="hidden w-full text-sm md:table" data-testid="factura-renglones">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="px-5 py-2 font-medium">Producto</th>
                      <th className="px-3 py-2 text-right font-medium">Cant.</th>
                      <th className="px-3 py-2 text-right font-medium">Precio</th>
                      <th className="px-3 py-2 text-right font-medium">Desc.</th>
                      <th className="px-3 py-2 text-right font-medium">Subtotal</th>
                      <th className="px-5 py-2 text-right font-medium">Con IVA</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {f.items.map((it, i) => (
                      <tr key={i}>
                        <td className="px-5 py-2.5">
                          <span className="block">{it.nombre.replace(/^\[[^\]]+\]\s*/, "")}</span>
                          {it.sku && <span className="block text-xs tabular-nums text-muted-foreground">{it.sku}</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{cantidad(it.cantidad)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{enMoneda(it.precio_unitario, f.moneda)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{Number(it.descuento ?? 0) > 0 ? `${Number(it.descuento)} %` : "—"}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{enMoneda(it.subtotal, f.moneda)}</td>
                        <td className="whitespace-nowrap px-5 py-2.5 text-right tabular-nums">{enMoneda(it.total, f.moneda)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <ul className="divide-y divide-border md:hidden" data-testid="factura-renglones-movil">
                  {f.items.map((it, i) => (
                    <li key={i} className="px-4 py-3">
                      <p className="text-sm font-medium leading-snug">{it.nombre.replace(/^\[[^\]]+\]\s*/, "")}</p>
                      <div className="mt-1 flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
                        <span className="tabular-nums">
                          {cantidad(it.cantidad)} × {enMoneda(it.precio_unitario, f.moneda)}{Number(it.descuento ?? 0) > 0 ? ` · −${Number(it.descuento)} %` : ""}
                        </span>
                        <span className="text-sm font-medium tabular-nums text-foreground">{enMoneda(it.subtotal, f.moneda)}</span>
                      </div>
                      {it.sku && <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">{it.sku}</p>}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <dl className="space-y-1.5 border-t border-border bg-muted/40 px-4 py-3 text-sm sm:px-5">
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Subtotal (base imponible)</dt><dd className="tabular-nums">{enMoneda(f.subtotal, f.moneda)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">IVA</dt><dd className="tabular-nums" data-testid="factura-iva">{enMoneda(f.impuesto, f.moneda)}</dd></div>
              <div className="flex justify-between gap-3 border-t border-border pt-2 font-semibold"><dt>Total</dt><dd className="tabular-nums">{enMoneda(f.total, f.moneda)}</dd></div>
              {enBs && <div className="flex justify-between gap-3 text-xs text-muted-foreground"><dt>Equivale a</dt><dd className="tabular-nums">{enMoneda(f.total_usd, "USD")}</dd></div>}
            </dl>
          </Panel>

          {/* Lo aplicado */}
          {!anulada && (
            <Panel className="lg:col-start-1" titulo={esNC ? "Aplicado a este documento" : "Pagos y retenciones aplicados"} cuerpoClassName="p-0 sm:p-0">
              {f.aplicaciones.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">{esNC ? "Esta nota no tiene aplicaciones directas." : "Todavía no hay pagos aplicados a esta factura."}</p>
              ) : (
                <>
                  <ul className="divide-y divide-border" data-testid="factura-aplicaciones">
                    {f.aplicaciones.map((a, i) => (
                      <li key={i} className="flex items-start justify-between gap-3 px-4 py-3 sm:px-5">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{conceptoAplicacion(a)}</p>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground tabular-nums">
                            {fechaCorta(a.fecha)}
                            {a.referencia ? " · " : ""}
                            {a.documento_id ? <Link to={`/portal/facturas/${a.documento_id}`} className="text-primary hover:underline">{a.referencia}</Link> : a.referencia}
                          </p>
                        </div>
                        <span className="shrink-0 text-sm font-semibold tabular-nums text-success">−{formatPrice(Number(a.monto_usd))}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex justify-between gap-3 border-t border-border bg-muted/40 px-4 py-2.5 text-sm font-medium sm:px-5">
                    <span>Total aplicado</span><span className="tabular-nums">{formatPrice(aplicado)}</span>
                  </div>
                </>
              )}
            </Panel>
          )}

          {esNC && f.aplicada_a.length > 0 && (
            <Panel className="lg:col-start-1" titulo="Se aplicó a" cuerpoClassName="p-0 sm:p-0">
              <ul className="divide-y divide-border" data-testid="nota-aplicada-a">
                {f.aplicada_a.map((a, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                    <div className="min-w-0">
                      <Link to={`/portal/facturas/${a.factura_id}`} className="text-sm font-medium text-primary hover:underline">Factura {a.numero}</Link>
                      <p className="text-xs text-muted-foreground">{fechaCorta(a.fecha)}</p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold tabular-nums">{formatPrice(Number(a.monto_usd))}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
      </div>
    </PortalPagina>
  );
};

export default PortalFacturaDetalle;
