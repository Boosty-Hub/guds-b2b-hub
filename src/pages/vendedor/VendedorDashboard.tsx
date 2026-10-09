import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle, Bell, ChevronRight, CreditCard, Loader2, MessageCircle, Phone, ShoppingCart, Target, Clock, XCircle, CalendarClock, Wallet,
} from "lucide-react";
import { VendedorLayout } from "@/components/vendedor/VendedorLayout";
import { AvisoEmpresaCartera } from "@/components/vendedor/AvisoEmpresaCartera";
import { useResumenVendedor, mesDe } from "@/components/vendedor/resumen";
import { enlaceWhatsApp, telefonoLlamar, telefonoWhatsApp } from "@/components/vendedor/contacto";
import { fechaCorta } from "@/components/vendedor/tipos";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/contexts/CurrencyContext";

// "Hoy" del vendedor (plan de portales §5, V5): clientes a visitar o con vencido, facturas que vencen esta semana, pedidos por
// aprobar y rechazados por corregir, cobros por verificar o rechazados, avisos y la meta del mes contra la venta real
// (resumen_vendedor: documentos de venta netos de IVA de sus clientes). Datos de hoy_vendedor() y resumen_vendedor().

interface Hoy {
  hoy: string;
  visitar: { n: number; items: { id: string; nombre_negocio: string; ciudad: string | null; telefono: string | null; vencido: number; dias_mora: number;
    por_cobrar: number; vence_7d: number; dias_sin_compra: number | null; motivo: "vencido" | "vence_pronto" | "sin_compras" }[] };
  vencen_semana: { n: number; monto: number };
  por_aprobar: { n: number; items: { id: string; numero: string; cliente: string | null; total: number; fecha: string }[] };
  rechazados: { n: number; items: { id: string; numero: string; cliente: string | null; total: number; motivo: string | null; fecha: string }[] };
  cobros_pendientes: { n: number; monto: number; items: { id: string; numero: string; cliente: string; monto: number; fecha: string }[] };
  cobros_rechazados: { n: number; items: { id: string; numero: string; cliente: string; monto: number; motivo: string | null; fecha: string }[] };
  avisos: { no_leidas: number; items: { id: string; titulo: string; mensaje: string; tipo: string; link: string | null; created_at: string }[] };
}

function Tarjeta({ icono, titulo, n, tono = "normal", ver, children, testid }: {
  icono: ReactNode; titulo: string; n?: number; tono?: "normal" | "alerta" | "riesgo"; ver?: { a: string; texto: string }; children: ReactNode; testid?: string;
}) {
  return (
    <section className="flex min-w-0 flex-col rounded-lg border border-border bg-card" data-testid={testid}>
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h2 className="flex min-w-0 items-center gap-2 text-[13px] font-semibold">
          {icono}<span className="truncate">{titulo}</span>
          {n !== undefined && (
            <span className={cn("rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
              n === 0 ? "bg-muted text-muted-foreground" : tono === "riesgo" ? "bg-destructive/10 text-destructive" : tono === "alerta" ? "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300")}
              data-testid="contador">{n}</span>
          )}
        </h2>
        {ver && <Link to={ver.a} className="shrink-0 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400">{ver.texto}</Link>}
      </header>
      <div className="flex-1">{children}</div>
    </section>
  );
}

const Vacio = ({ texto }: { texto: string }) => <p className="px-3 py-4 text-sm text-muted-foreground">{texto}</p>;

const VendedorDashboard = () => {
  const { user } = useAuth();
  const { formatPrice } = useCurrency();
  const navigate = useNavigate();
  const { resumen: r, cargando: cargandoResumen, error: errorResumen } = useResumenVendedor();
  const [hoy, setHoy] = useState<Hoy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    const { data, error: e } = await supabase.rpc("hoy_vendedor");
    if (e) setError(e.message); else { setHoy(data as Hoy); setError(null); }
    setCargando(false);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const meta = Number(r?.meta_mes?.meta ?? 0);
  const venta = Number(r?.ventas_mes.neto ?? 0);
  const avance = meta > 0 ? Math.round((venta / meta) * 100) : 0;
  const fechaHoy = new Date().toLocaleDateString("es-VE", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Caracas" });

  const motivo = (c: Hoy["visitar"]["items"][number]) =>
    c.motivo === "vencido" ? <span className="font-medium text-destructive">Vencido {formatPrice(c.vencido)} · {c.dias_mora} d</span>
      : c.motivo === "vence_pronto" ? <span className="font-medium text-amber-700 dark:text-amber-300">Vence esta semana {formatPrice(c.vence_7d)}</span>
      : <span className="text-muted-foreground">Sin comprar hace {c.dias_sin_compra} días</span>;

  return (
    <VendedorLayout title="Hoy">
      {cargando || cargandoResumen ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-emerald-700" aria-label="Cargando" /></div>
      ) : (
        <div className="mx-auto max-w-7xl" data-testid="hoy">
          <p className="mb-2 text-[13px] text-muted-foreground">
            Hola, <span className="font-medium text-foreground">{user?.nombre}</span> · <span className="first-letter:uppercase">{fechaHoy}</span>
          </p>
          {(error || errorResumen) && <p className="mb-2 text-[13px] text-destructive" role="alert">No se pudo cargar todo: {error || errorResumen}</p>}
          {r && <AvisoEmpresaCartera clientes={r.clientes} porEmpresa={r.clientes_por_empresa} />}

          {/* Acciones rápidas */}
          <div className="mb-3 grid grid-cols-2 gap-2">
            <Link to="/vendedor/pedidos/nuevo" className="flex h-12 items-center justify-center gap-2 rounded-lg bg-emerald-700 text-sm font-semibold text-white hover:bg-emerald-800" data-testid="hoy-nuevo-pedido">
              <ShoppingCart className="h-4 w-4" aria-hidden />Nuevo pedido
            </Link>
            <Link to="/vendedor/cobros/nuevo" className="flex h-12 items-center justify-center gap-2 rounded-lg border border-emerald-500/60 bg-card text-sm font-semibold text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-500/10" data-testid="hoy-registrar-cobro">
              <CreditCard className="h-4 w-4" aria-hidden />Registrar cobro
            </Link>
          </div>

          {r && (
            <KpiStrip items={[
              { label: "Por cobrar", valor: formatPrice(r.cartera.por_cobrar), detalle: r.cartera.vencido > 0.009 ? `${formatPrice(r.cartera.vencido)} vencido` : "nada vencido",
                tono: r.cartera.vencido > 0.009 ? "negativo" : "normal", onClick: () => navigate("/vendedor/cartera") },
              { label: `Ventas de ${mesDe(r)}`, valor: formatPrice(venta), tono: "positivo", onClick: () => navigate("/vendedor/metas"),
                detalle: Number(r.ventas_mes.notas_entrega ?? 0) > 0.004 ? `${r.ventas_mes.facturas} facturas · ${formatPrice(Number(r.ventas_mes.notas_entrega))} en notas de entrega` : `${r.ventas_mes.facturas} facturas · neto de IVA`,
                titulo: "Facturado a tus clientes en el mes (neto de IVA y de notas de crédito), más lo que no pasó a factura de sus notas de entrega" },
              { label: "Pedidos en curso", valor: r.pedidos.abiertos, detalle: r.pedidos.por_aprobar ? `${r.pedidos.por_aprobar} por aprobar` : undefined, onClick: () => navigate("/vendedor/pedidos?filtro=abiertos") },
              { label: "Cobros por verificar", valor: r.cobros.pendientes_n, detalle: formatPrice(r.cobros.pendientes_monto), tono: r.cobros.pendientes_n ? "alerta" : "normal",
                onClick: () => navigate("/vendedor/pagos?estado=pendiente") },
            ]} />
          )}

          {/* Meta del mes */}
          {r && (
            <Link to="/vendedor/metas" className="mb-3 block rounded-lg border border-border bg-card px-3 py-2.5 hover:bg-muted/30" data-testid="hoy-meta">
              <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
                <span className="flex items-center gap-2 text-[13px] font-semibold"><Target className="h-4 w-4 text-emerald-700" />Meta de {mesDe(r)}</span>
                <span className="text-xs text-muted-foreground">
                  {meta > 0 ? <><span className="font-semibold text-foreground">{formatPrice(venta)}</span> de {formatPrice(meta)} · {avance}%</> : <>Sin meta cargada · vendido {formatPrice(venta)}</>}
                </span>
              </div>
              <Progress value={meta > 0 ? Math.min(100, avance) : 0} className="h-2" aria-label={`Avance de la meta de ${mesDe(r)}`} />
              {meta > 0 && venta < meta && <p className="mt-1 text-[11px] text-muted-foreground">Faltan {formatPrice(meta - venta)} para la meta.</p>}
            </Link>
          )}

          {hoy && (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <Tarjeta icono={<Wallet className="h-4 w-4 text-emerald-700" />} titulo="Clientes para hoy" n={hoy.visitar.n} tono="alerta" testid="hoy-visitar"
                ver={{ a: "/vendedor/cartera?filtro=visitar", texto: "Ver todos" }}>
                {hoy.visitar.items.length === 0 ? <Vacio texto="Nada urgente: sin vencidos ni clientes sin comprar." /> : (
                  <ul className="divide-y divide-border">
                    {hoy.visitar.items.map((c) => (
                      <li key={c.id} className="relative flex items-center gap-2 px-3 py-2 hover:bg-muted/40">
                        <div className="min-w-0 flex-1">
                          <Link to={`/vendedor/clientes/${c.id}`} className="block truncate text-[13px] font-medium after:absolute after:inset-0">{c.nombre_negocio}</Link>
                          <p className="truncate text-xs">{motivo(c)}{c.ciudad ? <span className="text-muted-foreground"> · {c.ciudad}</span> : null}</p>
                        </div>
                        {c.telefono && <a href={`tel:${telefonoLlamar(c.telefono)}`} className="relative z-10 rounded-md p-2 text-muted-foreground hover:bg-muted" aria-label={`Llamar a ${c.nombre_negocio}`}><Phone className="h-4 w-4" /></a>}
                        {telefonoWhatsApp(c.telefono) && <a href={enlaceWhatsApp(c.telefono, `Hola, ${c.nombre_negocio}. `)} target="_blank" rel="noopener noreferrer"
                          className="relative z-10 rounded-md p-2 text-muted-foreground hover:bg-muted" aria-label={`WhatsApp a ${c.nombre_negocio}`}><MessageCircle className="h-4 w-4" /></a>}
                      </li>
                    ))}
                  </ul>
                )}
                {hoy.vencen_semana.n > 0 && (
                  <Link to="/vendedor/cartera?filtro=por_vencer" className="flex items-center gap-2 border-t border-border px-3 py-2 text-xs text-amber-800 hover:bg-muted/40 dark:text-amber-200">
                    <CalendarClock className="h-3.5 w-3.5" />{hoy.vencen_semana.n} {hoy.vencen_semana.n === 1 ? "factura vence" : "facturas vencen"} en 7 días · {formatPrice(hoy.vencen_semana.monto)}
                  </Link>
                )}
              </Tarjeta>

              <Tarjeta icono={<Clock className="h-4 w-4 text-amber-500" />} titulo="Pedidos por aprobar" n={hoy.por_aprobar.n} tono="alerta" testid="hoy-por-aprobar"
                ver={{ a: "/vendedor/pedidos?filtro=por_aprobar", texto: "Ver todos" }}>
                {hoy.por_aprobar.items.length === 0 ? <Vacio texto="No tienes pedidos esperando aprobación." /> : (
                  <ul className="divide-y divide-border">
                    {hoy.por_aprobar.items.map((o) => (
                      <li key={o.id} className="relative flex items-center gap-2 px-3 py-2 hover:bg-muted/40">
                        <div className="min-w-0 flex-1">
                          <Link to={`/vendedor/pedidos/${o.id}`} className="block truncate text-[13px] font-medium text-emerald-700 after:absolute after:inset-0 dark:text-emerald-400">{o.numero}</Link>
                          <p className="truncate text-xs text-muted-foreground">{o.cliente || "—"} · {fechaCorta(o.fecha)}</p>
                        </div>
                        <span className="shrink-0 text-[13px] font-semibold tabular-nums">{formatPrice(Number(o.total))}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Tarjeta>

              <Tarjeta icono={<XCircle className="h-4 w-4 text-destructive" />} titulo="Rechazados por corregir" n={hoy.rechazados.n} tono="riesgo" testid="hoy-rechazados"
                ver={{ a: "/vendedor/pedidos?filtro=rechazados", texto: "Ver todos" }}>
                {hoy.rechazados.items.length === 0 ? <Vacio texto="Ningún pedido rechazado pendiente de corregir." /> : (
                  <ul className="divide-y divide-border">
                    {hoy.rechazados.items.map((o) => (
                      <li key={o.id} className="relative px-3 py-2 hover:bg-muted/40">
                        <div className="flex items-center justify-between gap-2">
                          <Link to={`/vendedor/pedidos/${o.id}`} className="truncate text-[13px] font-medium text-emerald-700 after:absolute after:inset-0 dark:text-emerald-400">{o.numero}</Link>
                          <span className="shrink-0 text-[13px] font-semibold tabular-nums">{formatPrice(Number(o.total))}</span>
                        </div>
                        <p className="truncate text-xs text-muted-foreground">{o.cliente || "—"}</p>
                        {o.motivo && <p className="line-clamp-2 text-xs text-destructive">Motivo: {o.motivo}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </Tarjeta>

              <Tarjeta icono={<CreditCard className="h-4 w-4 text-amber-500" />} titulo="Cobros por verificar" n={hoy.cobros_pendientes.n} tono="alerta" testid="hoy-cobros"
                ver={{ a: "/vendedor/pagos?estado=pendiente", texto: "Ver todos" }}>
                {hoy.cobros_pendientes.items.length === 0 ? <Vacio texto="No tienes cobros pendientes de verificación." /> : (
                  <ul className="divide-y divide-border">
                    {hoy.cobros_pendientes.items.map((p) => (
                      <li key={p.id} className="flex items-center gap-2 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium">{p.numero}</p>
                          <p className="truncate text-xs text-muted-foreground">{p.cliente} · {fechaCorta(p.fecha)}</p>
                        </div>
                        <span className="shrink-0 text-[13px] font-semibold tabular-nums">{formatPrice(Number(p.monto))}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {hoy.cobros_rechazados.n > 0 && (
                  <div className="border-t border-border px-3 py-2" data-testid="hoy-cobros-rechazados">
                    <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-destructive"><AlertTriangle className="h-3.5 w-3.5" />{hoy.cobros_rechazados.n} rechazado(s) en 14 días</p>
                    {hoy.cobros_rechazados.items.map((p) => (
                      <p key={p.id} className="truncate text-xs text-muted-foreground">{p.numero} · {p.cliente} · {formatPrice(Number(p.monto))}{p.motivo ? ` · ${p.motivo}` : ""}</p>
                    ))}
                  </div>
                )}
              </Tarjeta>

              <Tarjeta icono={<Bell className="h-4 w-4 text-sky-500" />} titulo="Avisos sin leer" n={hoy.avisos.no_leidas} testid="hoy-avisos">
                {hoy.avisos.items.length === 0 ? <Vacio texto="Estás al día." /> : (
                  <ul className="divide-y divide-border">
                    {hoy.avisos.items.map((a) => (
                      <li key={a.id} className="relative flex items-center gap-2 px-3 py-2 hover:bg-muted/40">
                        <div className="min-w-0 flex-1">
                          {a.link ? <Link to={a.link} className="block truncate text-[13px] font-medium after:absolute after:inset-0">{a.titulo}</Link>
                            : <p className="truncate text-[13px] font-medium">{a.titulo}</p>}
                          <p className="truncate text-xs text-muted-foreground">{a.mensaje} · {fechaCorta(a.created_at)}</p>
                        </div>
                        {a.link && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                      </li>
                    ))}
                  </ul>
                )}
              </Tarjeta>
            </div>
          )}
        </div>
      )}
    </VendedorLayout>
  );
};

export default VendedorDashboard;
