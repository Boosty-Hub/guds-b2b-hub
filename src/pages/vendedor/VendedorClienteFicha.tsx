import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft, CreditCard, FileText, Loader2, MapPin, MessageCircle, Phone, Search, Share2, ShoppingCart, Copy, Check, History,
} from "lucide-react";
import { VendedorLayout } from "@/components/vendedor/VendedorLayout";
import { TramosAntiguedad } from "@/components/vendedor/TramosAntiguedad";
import { EstadoPedidoBadge } from "@/components/vendedor/estadoPedidoVendedor";
import { enlaceWhatsApp, telefonoLlamar, telefonoWhatsApp, textoEstadoCuenta } from "@/components/vendedor/contacto";
import { fechaCorta, type ProductoVendedor, type Tramos } from "@/components/vendedor/tipos";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { FichaCampos, Panel } from "@/components/datos/FichaCampos";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { METODO_LABEL } from "@/hooks/useCuentasPago";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useEmpresa } from "@/contexts/EmpresaContext";

// Ficha del cliente para el vendedor (plan de portales §5, V3): datos y contacto (llamar, WhatsApp), dirección, crédito,
// deuda con antigüedad por tramos (misma lógica que Cuentas por cobrar del admin), facturas pendientes, últimos pedidos,
// cobros, productos frecuentes y accesos a "Nuevo pedido" / "Registrar cobro". Todo sale de ficha_cliente_vendedor().

interface Ficha {
  hoy: string;
  cliente: {
    id: string; codigo: string | null; nombre_negocio: string; rif: string | null; email: string | null; telefono: string | null; celular: string | null;
    direccion: string | null; calle: string | null; complemento: string | null; direccion_entrega: string | null; ciudad: string | null; estado: string | null;
    condicion_pago: string | null; dias_credito: number | null; limite_credito: number; activo: boolean; empresa_id: string | null; empresa: string | null;
    lista_precios: string | null; retiene_iva: boolean; retiene_islr: boolean; contribuyente_especial: boolean; portal_habilitado: boolean;
  };
  contactos: { nombre: string; cargo: string | null; telefono: string | null; celular: string | null; email: string | null; es_principal: boolean }[];
  direcciones: { nombre: string | null; direccion: string | null; calle: string | null; complemento: string | null; ciudad: string | null; estado: string | null; telefono: string | null }[];
  deuda: { por_cobrar: number; a_favor: number; neto: number; vencido: number; dias_mora: number; facturas: number; saldo_inicial: number; tramos: Tramos };
  facturas: { id: string; numero: string; tipo: string; fecha_emision: string | null; fecha_vencimiento: string | null; dias: number; total_usd: number;
    saldo_usd: number; monto_retenido_usd: number; saldo_inicial: boolean; orden_id: string | null }[];
  pedidos: { id: string; numero: string; numero_guds: string | null; fecha: string; total: number; estado: string; estado_odoo: string | null;
    aprobacion: "pendiente" | "aprobada" | "rechazada" | null; odoo_id: number | null; odoo_envio_error: string | null; rechazo_motivo: string | null }[];
  pedidos_resumen: { total: number; ultima_compra: string | null; compras_90d: number };
  cobros: { id: string; numero: string; fecha: string; monto: number; moneda: string; monto_moneda: number | null; metodo: string; estado: string; referencia: string | null; es_igtf: boolean }[];
  ultimo_pago: string | null;
  frecuentes: ProductoVendedor[];
}

const ESTADO_COBRO: Record<string, string> = {
  pendiente: "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200",
  verificado: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300",
  rechazado: "border-red-300 bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-300",
};
const claseDias = (d: number) => (d <= 0 ? "text-sky-700 dark:text-sky-300" : d <= 30 ? "text-amber-700 dark:text-amber-300" : "text-destructive");

const VendedorClienteFicha = () => {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const { formatPrice } = useCurrency();
  const { empresas, seleccion, soloLectura, cambiarEmpresa } = useEmpresa();
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [compartir, setCompartir] = useState(false);
  const [copiado, setCopiado] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    const { data, error: e } = await supabase.rpc("ficha_cliente_vendedor", { p_cliente_id: id });
    if (e) { setError(e.message); setFicha(null); } else { setFicha((data as Ficha | null) ?? null); setError(null); }
    setCargando(false);
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]);

  const monto = (n: number) => (n < -0.004 ? `-${formatPrice(-n)}` : formatPrice(n));
  const textoCuenta = useMemo(() => (ficha ? textoEstadoCuenta({
    cliente: ficha.cliente.nombre_negocio, empresa: ficha.cliente.empresa, hoy: ficha.hoy,
    por_cobrar: Number(ficha.deuda.por_cobrar), neto: Number(ficha.deuda.neto), vencido: Number(ficha.deuda.vencido), a_favor: Number(ficha.deuda.a_favor),
    facturas: ficha.facturas.map((f) => ({ ...f, saldo_usd: Number(f.saldo_usd), dias: Number(f.dias) })),
    vendedor: user ? `${user.nombre} ${user.apellido || ""}`.trim() : null,
  }, `${window.location.origin}/portal/pagos`) : ""), [ficha, user]);

  if (cargando) {
    return <VendedorLayout title="Cliente"><div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-emerald-700" /></div></VendedorLayout>;
  }
  if (!ficha) {
    const otras = soloLectura ? [] : empresas.filter((e) => e.id !== seleccion);
    return (
      <VendedorLayout title="Cliente">
        <Volver />
        <Panel className="mx-auto max-w-lg">
          <div className="space-y-3 py-4 text-center" data-testid="cliente-no-encontrado">
            <Search className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="font-semibold">No encontramos este cliente en tu cartera</p>
            <p className="text-sm text-muted-foreground">{error ? `No se pudo cargar: ${error}` : "No está asignado a ti o es de otra empresa."}</p>
            {otras.length > 0 && (
              <div className="flex flex-wrap justify-center gap-2">
                {otras.map((e) => <Button key={e.id} size="sm" variant="outline" onClick={() => cambiarEmpresa(e.id)}>Ver en {e.nombre_corto}</Button>)}
              </div>
            )}
          </div>
        </Panel>
      </VendedorLayout>
    );
  }

  const c = ficha.cliente;
  const d = ficha.deuda;
  const tel = c.celular || c.telefono || ficha.contactos.find((x) => x.celular || x.telefono)?.celular || ficha.contactos.find((x) => x.telefono)?.telefono || null;
  const telWa = [c.celular, c.telefono, ...ficha.contactos.flatMap((x) => [x.celular, x.telefono])].find((t) => telefonoWhatsApp(t)) ?? null;
  const vencido = Number(d.vencido) > 0.009;
  const conDeuda = Number(d.por_cobrar) > 0.009;
  const aFavor = Number(d.a_favor) < -0.009;
  const limite = Number(c.limite_credito || 0);
  const disponible = limite > 0 ? limite - Number(d.por_cobrar) : null;
  const direccion = [c.calle || c.direccion, c.complemento].filter(Boolean).join(", ");
  const facturasAbiertas = ficha.facturas.filter((f) => Number(f.saldo_usd) > 0.009);
  const notasCredito = ficha.facturas.filter((f) => Number(f.saldo_usd) < -0.009);
  const desactivado = soloLectura || !c.activo;
  const enlaceMapa = direccion ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([direccion, c.ciudad, c.estado].filter(Boolean).join(", "))}` : null;

  const estadoBadge = vencido
    ? <Badge variant="outline" className="border-red-300 bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-300">Vencido · {d.dias_mora} días</Badge>
    : conDeuda ? <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">Por vencer</Badge>
    : aFavor ? <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">Saldo a favor</Badge>
    : <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">Al día</Badge>;

  const copiar = async () => {
    try { await navigator.clipboard.writeText(textoCuenta); setCopiado(true); setTimeout(() => setCopiado(false), 2000); } catch { /* sin portapapeles */ }
  };

  return (
    <VendedorLayout title={c.nombre_negocio}>
      <div className="mx-auto max-w-6xl" data-testid="ficha-cliente">
        <Volver />
        {/* Cabecera y acciones */}
        <section className="mb-3 rounded-lg border border-border bg-card p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <h2 className="text-lg font-semibold leading-tight" data-testid="ficha-nombre">{c.nombre_negocio}</h2>
                {estadoBadge}
                {!c.activo && <Badge variant="outline">Inactivo</Badge>}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {[c.codigo, c.rif, c.ciudad, c.empresa].filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <Button asChild={!desactivado} size="sm" className="h-10 gap-1.5 bg-emerald-700 text-white hover:bg-emerald-800" disabled={desactivado} data-testid="ficha-nuevo-pedido">
              {desactivado ? <span><ShoppingCart className="h-4 w-4" />Nuevo pedido</span> : <Link to={`/vendedor/pedidos/nuevo?cliente=${c.id}`}><ShoppingCart className="h-4 w-4" />Nuevo pedido</Link>}
            </Button>
            <Button asChild={!desactivado} size="sm" variant="outline" className="h-10 gap-1.5" disabled={desactivado} data-testid="ficha-registrar-cobro">
              {desactivado ? <span><CreditCard className="h-4 w-4" />Registrar cobro</span> : <Link to={`/vendedor/cobros/nuevo?cliente=${c.id}`}><CreditCard className="h-4 w-4" />Registrar cobro</Link>}
            </Button>
            {tel && (
              <Button asChild size="sm" variant="outline" className="h-10 gap-1.5">
                <a href={`tel:${telefonoLlamar(tel)}`} data-testid="ficha-llamar"><Phone className="h-4 w-4" />Llamar</a>
              </Button>
            )}
            {telWa && (
              <Button asChild size="sm" variant="outline" className="h-10 gap-1.5">
                <a href={enlaceWhatsApp(telWa, `Hola, ${c.nombre_negocio}. `)} target="_blank" rel="noopener noreferrer" data-testid="ficha-whatsapp"><MessageCircle className="h-4 w-4" />WhatsApp</a>
              </Button>
            )}
            <Button size="sm" variant="outline" className="col-span-2 h-10 gap-1.5 sm:col-span-1" onClick={() => setCompartir(true)} data-testid="ficha-estado-cuenta">
              <Share2 className="h-4 w-4" />Compartir estado de cuenta
            </Button>
          </div>
        </section>

        <KpiStrip items={[
          // Neto (facturas menos notas de crédito sin aplicar), como "Por cobrar" en la ficha del cliente del admin
          { label: "Por cobrar", valor: monto(Number(d.neto)),
            detalle: aFavor ? `Facturas ${formatPrice(Number(d.por_cobrar))} · NC ${formatPrice(Math.abs(Number(d.a_favor)))}` : `${d.facturas} ${d.facturas === 1 ? "factura" : "facturas"}`,
            tono: Number(d.neto) > 0.009 ? "negativo" : "normal" },
          { label: "Vencido", valor: formatPrice(Number(d.vencido)), detalle: vencido ? `Mora máx. ${d.dias_mora} días` : "nada vencido", tono: vencido ? "negativo" : "normal" },
          { label: "A favor", valor: formatPrice(Math.abs(Number(d.a_favor))), detalle: aFavor ? "notas de crédito" : undefined, tono: aFavor ? "positivo" : "tenue" },
          { label: "Crédito", valor: limite > 0 ? formatPrice(limite) : "Sin límite", detalle: disponible != null ? `Disponible ${monto(disponible)}` : c.condicion_pago || undefined,
            tono: disponible != null && disponible < 0 ? "negativo" : "normal" },
          { label: "Última compra", valor: fechaCorta(ficha.pedidos_resumen.ultima_compra), detalle: `${formatPrice(Number(ficha.pedidos_resumen.compras_90d))} en 90 días`, tono: "tenue" },
        ]} />

        <TramosAntiguedad tramos={d.tramos} className="mb-3" />
        {Number(d.saldo_inicial) > 0.009 && (
          <p className="-mt-2 mb-3 text-xs text-muted-foreground">Incluye {formatPrice(Number(d.saldo_inicial))} de saldo inicial migrado (facturas anteriores a Odoo).</p>
        )}

        <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start">
          {/* Datos y contacto */}
          <div className="order-2 space-y-3 lg:order-none">
            <Panel className="mb-0" titulo="Datos y contacto">
              <FichaCampos columnas={3} campos={[
                { label: "RIF", valor: c.rif, mono: true },
                { label: "Teléfono", valor: c.telefono ? <a className="text-emerald-700 hover:underline dark:text-emerald-400" href={`tel:${telefonoLlamar(c.telefono)}`}>{c.telefono}</a> : null },
                { label: "Celular", valor: c.celular ? <a className="text-emerald-700 hover:underline dark:text-emerald-400" href={`tel:${telefonoLlamar(c.celular)}`}>{c.celular}</a> : null },
                { label: "Correo", valor: c.email ? <a className="break-all text-emerald-700 hover:underline dark:text-emerald-400" href={`mailto:${c.email}`}>{c.email}</a> : null, ancho: 3 },
                { label: "Condición de pago", valor: c.condicion_pago || (c.dias_credito ? `${c.dias_credito} días` : null) },
                { label: "Lista de precios", valor: c.lista_precios },
                { label: "Retenciones", valor: [c.retiene_iva && "IVA", c.retiene_islr && "ISLR"].filter(Boolean).join(" · ") || null },
              ]} />
            </Panel>
            <Panel className="mb-0" titulo={<><MapPin className="h-3.5 w-3.5" />Dirección</>}
              acciones={enlaceMapa ? <a href={enlaceMapa} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400">Ver en el mapa</a> : undefined}>
              <div className="space-y-2 text-[13px]">
                <p>{direccion || <span className="text-muted-foreground">Sin dirección</span>}{c.ciudad ? <span className="text-muted-foreground"> · {[c.ciudad, c.estado].filter(Boolean).join(", ")}</span> : null}</p>
                {c.direccion_entrega && c.direccion_entrega !== c.direccion && <p><span className="text-xs text-muted-foreground">Entrega: </span>{c.direccion_entrega}</p>}
                {ficha.direcciones.length > 0 && (
                  <ul className="space-y-1 border-t border-border pt-2 text-xs">
                    {ficha.direcciones.map((x, i) => (
                      <li key={i}><span className="font-medium">{x.nombre || "Dirección"}</span>: {[x.calle || x.direccion, x.complemento, x.ciudad].filter(Boolean).join(", ")}</li>
                    ))}
                  </ul>
                )}
              </div>
            </Panel>
            {ficha.contactos.length > 0 && (
              <Panel className="mb-0" sinPadding titulo="Contactos">
                <ul className="divide-y divide-border">
                  {ficha.contactos.map((x, i) => {
                    const t = x.celular || x.telefono;
                    return (
                      <li key={i} className="flex items-center gap-2 px-3 py-2 text-[13px]">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{x.nombre}{x.es_principal && <span className="ml-1 text-[11px] font-normal text-muted-foreground">· principal</span>}</p>
                          <p className="truncate text-xs text-muted-foreground">{[x.cargo, t, x.email].filter(Boolean).join(" · ")}</p>
                        </div>
                        {t && <a href={`tel:${telefonoLlamar(t)}`} className="rounded-md p-2 text-muted-foreground hover:bg-muted" aria-label={`Llamar a ${x.nombre}`}><Phone className="h-4 w-4" /></a>}
                        {telefonoWhatsApp(t) && <a href={enlaceWhatsApp(t, `Hola, ${x.nombre}. `)} target="_blank" rel="noopener noreferrer" className="rounded-md p-2 text-muted-foreground hover:bg-muted" aria-label={`WhatsApp a ${x.nombre}`}><MessageCircle className="h-4 w-4" /></a>}
                      </li>
                    );
                  })}
                </ul>
              </Panel>
            )}
          </div>

          {/* Facturas, pedidos, cobros y compra habitual */}
          <div className="order-1 min-w-0 lg:order-none">
            <Tabs defaultValue="facturas">
              <TabsList className="mb-2 grid h-auto w-full grid-cols-4">
                <TabsTrigger value="facturas" className="px-1 text-xs sm:text-sm" data-testid="tab-facturas">Facturas ({facturasAbiertas.length})</TabsTrigger>
                <TabsTrigger value="pedidos" className="px-1 text-xs sm:text-sm">Pedidos</TabsTrigger>
                <TabsTrigger value="cobros" className="px-1 text-xs sm:text-sm">Cobros</TabsTrigger>
                <TabsTrigger value="frecuentes" className="px-1 text-xs sm:text-sm">Compra</TabsTrigger>
              </TabsList>

              <TabsContent value="facturas" className="mt-0">
                <Panel className="mb-0" sinPadding>
                  {facturasAbiertas.length === 0 && notasCredito.length === 0 ? (
                    <p className="px-3 py-6 text-center text-sm text-muted-foreground">No tiene facturas pendientes.</p>
                  ) : (
                    <ul className="divide-y divide-border" data-testid="facturas-pendientes">
                      {[...facturasAbiertas, ...notasCredito].map((f) => {
                        const nc = Number(f.saldo_usd) < 0;
                        return (
                          <li key={f.id} className="flex items-start justify-between gap-3 px-3 py-2 text-[13px]">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5 font-medium">
                                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />{nc ? "Nota de crédito" : "Factura"} {f.numero}
                                {f.saldo_inicial && <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal text-muted-foreground">Saldo inicial</Badge>}
                              </div>
                              <p className="text-xs text-muted-foreground">
                                Emitida {fechaCorta(f.fecha_emision)}{!nc && f.fecha_vencimiento ? ` · vence ${fechaCorta(f.fecha_vencimiento)}` : ""}
                                {!nc && <span className={cn("ml-1 font-medium", claseDias(f.dias))}>· {f.dias > 0 ? `${f.dias} días vencida` : f.dias === 0 ? "vence hoy" : `faltan ${-f.dias} días`}</span>}
                              </p>
                            </div>
                            <div className="shrink-0 text-right tabular-nums">
                              <p className={cn("font-semibold", nc ? "text-success" : "")}>{monto(Number(f.saldo_usd))}</p>
                              <p className="text-[11px] text-muted-foreground">de {monto(Number(f.total_usd))}{Number(f.monto_retenido_usd) > 0.009 ? ` · ret. ${formatPrice(Number(f.monto_retenido_usd))}` : ""}</p>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Panel>
              </TabsContent>

              <TabsContent value="pedidos" className="mt-0">
                <Panel className="mb-0" sinPadding
                  acciones={<Link to={`/vendedor/pedidos?q=${encodeURIComponent(c.nombre_negocio)}`} className="text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400">Ver todos ({ficha.pedidos_resumen.total})</Link>}
                  titulo="Últimos pedidos">
                  {ficha.pedidos.length === 0 ? <p className="px-3 py-6 text-center text-sm text-muted-foreground">Sin pedidos.</p> : (
                    <ul className="divide-y divide-border">
                      {ficha.pedidos.map((o) => (
                        <li key={o.id} className="relative flex items-center justify-between gap-3 px-3 py-2 text-[13px] hover:bg-muted/40">
                          <div className="min-w-0">
                            <Link to={`/vendedor/pedidos/${o.id}`} className="font-medium text-emerald-700 after:absolute after:inset-0 dark:text-emerald-400">{o.numero}</Link>
                            <p className="text-xs text-muted-foreground">{o.numero_guds && o.numero_guds !== o.numero ? `antes ${o.numero_guds} · ` : ""}{fechaCorta(o.fecha)}</p>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <span className="font-semibold tabular-nums">{formatPrice(Number(o.total))}</span>
                            <EstadoPedidoBadge pedido={o} className="px-1.5 py-0 text-[10px]" />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              </TabsContent>

              <TabsContent value="cobros" className="mt-0">
                <Panel className="mb-0" sinPadding titulo="Últimos cobros"
                  acciones={ficha.ultimo_pago ? <span className="text-xs text-muted-foreground">Último: {fechaCorta(ficha.ultimo_pago)}</span> : undefined}>
                  {ficha.cobros.length === 0 ? <p className="px-3 py-6 text-center text-sm text-muted-foreground">Sin cobros.</p> : (
                    <ul className="divide-y divide-border">
                      {ficha.cobros.map((p) => (
                        <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
                          <div className="min-w-0">
                            <p className="truncate font-medium">{p.numero}{p.es_igtf ? " · IGTF" : ""}</p>
                            <p className="truncate text-xs text-muted-foreground">{fechaCorta(p.fecha)} · {METODO_LABEL[p.metodo] || p.metodo}{p.referencia ? ` · ref. ${p.referencia}` : ""}</p>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <span className="font-semibold tabular-nums">{formatPrice(Number(p.monto))}</span>
                            <Badge variant="outline" className={cn("px-1.5 py-0 text-[10px] capitalize", ESTADO_COBRO[p.estado])}>{p.estado}</Badge>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              </TabsContent>

              <TabsContent value="frecuentes" className="mt-0">
                <Panel className="mb-0" sinPadding titulo={<><History className="h-3.5 w-3.5" />Compra habitual</>}
                  acciones={!desactivado ? <Link to={`/vendedor/pedidos/nuevo?cliente=${c.id}`} className="text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400">Tomar pedido</Link> : undefined}>
                  {ficha.frecuentes.length === 0 ? <p className="px-3 py-6 text-center text-sm text-muted-foreground">Sin compras registradas.</p> : (
                    <ul className="divide-y divide-border" data-testid="frecuentes">
                      {ficha.frecuentes.map((p) => (
                        <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
                          <div className="min-w-0">
                            <p className="line-clamp-2 font-medium leading-snug">{p.nombre}</p>
                            <p className="text-xs text-muted-foreground">
                              {p.frecuencia ? `${p.frecuencia.veces} ${p.frecuencia.veces === 1 ? "vez" : "veces"} · última ${fechaCorta(p.frecuencia.ultima)} · ${p.frecuencia.ultima_unidades.toLocaleString("es-VE")} u.` : ""}
                            </p>
                          </div>
                          <span className="shrink-0 font-semibold tabular-nums">{formatPrice(Number(p.precio))}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>

      {/* Compartir estado de cuenta (WhatsApp o copiar) */}
      <Dialog open={compartir} onOpenChange={setCompartir}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Estado de cuenta</DialogTitle>
            <DialogDescription>Resumen para enviar al cliente, con el enlace al portal donde ve el detalle y reporta sus pagos.</DialogDescription>
          </DialogHeader>
          <pre className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/40 p-3 font-sans text-[13px]" data-testid="texto-estado-cuenta">{textoCuenta}</pre>
          {!telWa && <p className="text-xs text-muted-foreground">El cliente no tiene un teléfono válido para WhatsApp: se abrirá WhatsApp para elegir el contacto.</p>}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={copiar} className="gap-1.5" data-testid="copiar-estado-cuenta">
              {copiado ? <><Check className="h-4 w-4" />Copiado</> : <><Copy className="h-4 w-4" />Copiar texto</>}
            </Button>
            <Button asChild className="gap-1.5 bg-emerald-700 text-white hover:bg-emerald-800">
              <a href={enlaceWhatsApp(telWa, textoCuenta)} target="_blank" rel="noopener noreferrer" data-testid="enviar-estado-cuenta"><MessageCircle className="h-4 w-4" />Enviar por WhatsApp</a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </VendedorLayout>
  );
};

const Volver = () => (
  <Link to="/vendedor/cartera" className="mb-2 inline-flex h-9 items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground" data-testid="volver-cartera">
    <ArrowLeft className="h-4 w-4" />Cartera
  </Link>
);

export default VendedorClienteFicha;
