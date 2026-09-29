import { lazy, Suspense, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ClipboardList,
  CreditCard,
  FileText,
  Landmark,
  LayoutGrid,
  LineChart,
  Receipt,
  Search,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { despuesDePintar } from "@/lib/diferir";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useStoreConfig } from "@/contexts/StoreConfigContext";
import { Button } from "@/components/ui/button";
import { BannerVisual } from "@/components/BannerVisual";
import { estadoVisible } from "@/components/pedidos/estadoPedido";
import { PortalPagina } from "@/components/portal/PortalPagina";
import { usePortal } from "@/components/portal/contextoPortal";
import { EncabezadoDestacados, EstadoPill, EstadoVacio, Kpi, NumeroPedido, Panel, SkeletonDestacados, SkeletonFilas, fechaCorta } from "@/components/portal/sistema";
import { useCategoriasPortal } from "@/hooks/useCatalogoPortal";
import { pedirEstadoCuenta, type CreditoCuenta, type ResumenCuenta } from "@/hooks/useFinanzasPortal";

// Inicio del portal: lo que un comprador B2B necesita al entrar (saldo, crédito, pedidos en curso), sus pedidos recientes,
// accesos rápidos y productos destacados para recomprar.

// Destacados (tarjetas de producto con su carrito): código y datos llegan cuando el resumen ya está en pantalla
const DestacadosInicio = lazy(() => import("@/components/portal/DestacadosInicio"));

interface OrdenResumen {
  id: string; numero: string; numero_guds: string | null; estado: string; estado_odoo: string | null; aprobacion: string | null;
  odoo_id: number | null; total: number; created_at: string; fecha_pedido: string | null;
}
const TOLERANCIA = 0.009;

const ACCESOS: { etiqueta: string; ruta: string; icono: LucideIcon }[] = [
  { etiqueta: "Catálogo", ruta: "/portal/catalogo", icono: LayoutGrid },
  { etiqueta: "Mis pedidos", ruta: "/portal/pedidos", icono: ClipboardList },
  { etiqueta: "Estado de cuenta", ruta: "/portal/finanzas", icono: LineChart },
  { etiqueta: "Facturas", ruta: "/portal/facturas", icono: FileText },
  { etiqueta: "Declarar pago", ruta: "/portal/pagos?declarar=1", icono: Wallet },
  { etiqueta: "Cómo pagar", ruta: "/portal/cuenta/pagos", icono: Landmark },
];

const PortalDashboard = () => {
  const { user } = useAuth();
  const { formatPrice } = useCurrency();
  const { getActiveBanners } = useStoreConfig({ banners: true });
  const portal = usePortal();

  // Pedidos y estado de cuenta llegan por separado: cada parte se muestra en cuanto llega su dato
  const [cargandoOrdenes, setCargandoOrdenes] = useState(true);
  const [cargandoCuenta, setCargandoCuenta] = useState(true);
  const cargando = cargandoOrdenes || cargandoCuenta;
  const [ordenes, setOrdenes] = useState<OrdenResumen[]>([]);
  // Saldo, vencido y crédito: el mismo resumen del estado de cuenta (regla de Cuentas por Cobrar del admin)
  const [resumen, setResumen] = useState<ResumenCuenta | null>(null);
  const [credito, setCredito] = useState<CreditoCuenta | null>(null);
  // Categorías con productos a la venta en la empresa activa y destacados (DestacadosInicio): se muestran debajo del
  // resumen, solo cuando el resumen ya cargó, y se piden cuando el resumen ya está en pantalla; así el resumen (saldo,
  // crédito y pedidos) no comparte la conexión con ellos al entrar.
  const [secundario, setSecundario] = useState(false);
  useEffect(() => (cargando ? undefined : despuesDePintar(() => setSecundario(true))), [cargando]);
  const categoriasPortal = useCategoriasPortal(secundario);
  const categorias = [...(categoriasPortal ?? [])].sort((a, b) => (b.n ?? 0) - (a.n ?? 0));

  const banners = getActiveBanners();

  useEffect(() => {
    const cid = user?.cliente_id;
    if (!cid) { setCargandoOrdenes(false); setCargandoCuenta(false); return; }
    let activo = true;
    supabase.from("ordenes").select("id, numero, numero_guds, estado, estado_odoo, aprobacion, odoo_id, total, created_at, fecha_pedido")
      .eq("cliente_id", cid).order("created_at", { ascending: false }).limit(200)
      .then((o) => {
        if (!activo) return;
        const filas = ((o.data as OrdenResumen[] | null) ?? []).sort((a, b) => (b.fecha_pedido ?? b.created_at).localeCompare(a.fecha_pedido ?? a.created_at));
        setOrdenes(filas);
        setCargandoOrdenes(false);
      });
    pedirEstadoCuenta({ desde: null, hasta: null }, false).catch(() => null).then((ec) => {
      if (!activo) return;
      setResumen(ec?.resumen ?? null);
      setCredito(ec?.credito ?? null);
      setCargandoCuenta(false);
    });
    return () => { activo = false; };
  }, [user?.cliente_id]);


  const porPagar = Number(resumen?.saldo ?? 0);
  const vencido = Number(resumen?.vencido ?? 0);
  const abiertas = resumen?.facturas_abiertas ?? 0;
  const conEstado = ordenes.map((o) => ({ o, ev: estadoVisible(o) }));
  const enCurso = conEstado.filter(({ ev }) => !["rechazado", "cancelado", "entregado"].includes(ev.clave));
  const porAprobar = enCurso.filter(({ ev }) => ev.clave === "por_aprobar").length;
  const ultimo = conEstado[0];

  const nombre = user?.nombre?.split(" ")[0] || "";
  const saludo = nombre ? `Hola, ${nombre}` : "Hola";

  const creditoValor = !credito ? "—"
    : credito.modo === "abierto" ? "Abierto"
    : Number(credito.limite) > 0 ? formatPrice(Number(credito.disponible)) : "Sin crédito";
  const creditoDetalle = credito && credito.modo !== "abierto" && Number(credito.limite) > 0 ? `de ${formatPrice(Number(credito.limite))} aprobado` : credito?.modo === "abierto" ? "Sin tope de crédito" : "Pago de contado";
  const usoCredito = credito && Number(credito.limite) > 0 ? Math.min(100, Math.max(0, (1 - Number(credito.disponible) / Number(credito.limite)) * 100)) : null;

  return (
    <PortalPagina
      titulo={saludo}
      descripcion={portal?.cliente?.nombre_negocio ? <>Resumen de <span className="font-medium text-foreground">{portal.cliente.nombre_negocio}</span></> : "Resumen de tu cuenta"}
      encabezadoMovil={
        <div className="min-w-0 leading-tight">
          <p className="truncate text-xs text-muted-foreground">{saludo}</p>
          <h1 className="truncate text-sm font-semibold text-foreground" data-testid="nombre-negocio">{portal?.cliente?.nombre_negocio ?? "Mi negocio"}</h1>
        </div>
      }
      acciones={
        <>
          <Button asChild variant="outline" className="gap-2"><Link to="/portal/pagos?declarar=1"><Wallet className="h-4 w-4" />Declarar pago</Link></Button>
          <Button asChild className="gap-2"><Link to="/portal/catalogo"><LayoutGrid className="h-4 w-4" />Hacer un pedido</Link></Button>
        </>
      }
    >
      <div className="space-y-6">
        {/* Buscador (móvil y tableta; en escritorio está en la barra superior) */}
        <Link to="/portal/catalogo?focus=search" className="flex h-11 items-center gap-2.5 rounded-lg border border-border bg-card px-3.5 text-sm text-muted-foreground lg:hidden">
          <Search className="h-4 w-4" aria-hidden />Buscar productos por nombre o código
        </Link>

        {banners.length > 0 && (
          <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
            {banners.map((b) => (
              <Link key={b.id} to={b.link} className="shrink-0">
                <BannerVisual banner={b} className="min-w-[240px] rounded-xl p-4 lg:min-w-[320px] lg:p-5" titleClassName="text-xl font-semibold lg:text-2xl" subtitleClassName="text-sm opacity-90" />
              </Link>
            ))}
          </div>
        )}

        {/* Indicadores */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          <Kpi etiqueta="Por pagar" icono={FileText} href="/portal/finanzas" cargando={cargandoCuenta} testId="kpi-por-pagar"
            valor={resumen ? formatPrice(porPagar) : "—"} alerta={vencido > TOLERANCIA}
            detalle={!resumen ? "No disponible" : abiertas === 0 ? "Sin facturas pendientes" : vencido > TOLERANCIA ? `${formatPrice(vencido)} vencido` : `${abiertas} ${abiertas === 1 ? "factura" : "facturas"}`} />
          <Kpi etiqueta="Crédito disponible" icono={CreditCard} cargando={cargandoCuenta} valor={creditoValor} detalle={creditoDetalle}>
            {usoCredito != null && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                <div className="h-full rounded-full bg-foreground/70" style={{ width: `${usoCredito}%` }} />
              </div>
            )}
          </Kpi>
          <Kpi etiqueta="Pedidos en curso" icono={ClipboardList} href="/portal/pedidos" cargando={cargandoOrdenes}
            valor={enCurso.length} detalle={porAprobar > 0 ? `${porAprobar} por aprobar` : "Ninguno por aprobar"} />
          <Kpi etiqueta="Último pedido" icono={Receipt} cargando={cargandoOrdenes} href={ultimo ? `/portal/pedidos?pedido=${ultimo.o.id}` : "/portal/catalogo"}
            valor={ultimo ? <span className="text-lg sm:text-xl">{ultimo.o.numero}</span> : "—"}
            detalle={ultimo ? `${fechaCorta(ultimo.o.fecha_pedido ?? ultimo.o.created_at)} · ${ultimo.ev.etiqueta}` : "Aún no tienes pedidos"} />
        </div>

        <div className="grid gap-6 lg:grid-cols-3 lg:items-start">
          {/* Pedidos recientes */}
          <Panel titulo="Pedidos recientes" className="lg:col-span-2" cuerpoClassName="p-0 sm:p-0"
            accion={<Link to="/portal/pedidos" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">Ver todos<ArrowRight className="h-3.5 w-3.5" /></Link>}>
            {cargandoOrdenes ? <SkeletonFilas n={4} alto="h-12" className="p-4" /> : ordenes.length === 0 ? (
              <EstadoVacio icono={ClipboardList} titulo="Aún no tienes pedidos" descripcion="Explora el catálogo y haz tu primer pedido."
                accion={<Button asChild><Link to="/portal/catalogo">Ir al catálogo</Link></Button>} />
            ) : (
              <ul className="divide-y divide-border">
                {ordenes.slice(0, 5).map((o) => (
                  <li key={o.id}>
                    <Link to={`/portal/pedidos?pedido=${o.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 sm:px-5" data-testid="pedido-reciente">
                      <div className="min-w-0 flex-1">
                        <NumeroPedido numero={o.numero} numeroGuds={o.numero_guds} className="block truncate text-sm" />
                        <p className="text-xs text-muted-foreground">{fechaCorta(o.fecha_pedido ?? o.created_at)}</p>
                      </div>
                      <EstadoPill pedido={o} className="hidden sm:inline-flex" />
                      <span className="w-24 shrink-0 text-right text-sm font-semibold tabular-nums">{formatPrice(Number(o.total))}</span>
                    </Link>
                    <div className="-mt-1.5 px-4 pb-3 sm:hidden"><EstadoPill pedido={o} /></div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {!cargando && <div className="space-y-6">
            <Panel titulo="Accesos rápidos" cuerpoClassName="p-2 sm:p-2">
              <ul className="grid grid-cols-3 gap-1 lg:grid-cols-2">
                {ACCESOS.map((a) => (
                  <li key={a.ruta + a.etiqueta}>
                    <Link to={a.ruta} className="flex h-full flex-col items-center gap-1.5 rounded-lg px-2 py-3 text-center text-xs font-medium text-foreground hover:bg-muted/60 lg:flex-row lg:gap-2.5 lg:px-3 lg:text-left lg:text-sm">
                      <a.icono className="h-5 w-5 shrink-0 text-muted-foreground lg:h-4 lg:w-4" strokeWidth={1.75} aria-hidden />
                      <span className="leading-tight">{a.etiqueta}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>

            {categorias.length > 0 && (
              <Panel titulo="Categorías" accion={<Link to="/portal/catalogo" className="text-sm font-medium text-primary hover:underline">Ver catálogo</Link>}>
                <div className="flex flex-wrap gap-2">
                  {categorias.slice(0, 12).map((c) => (
                    <Link key={c.id} to={`/portal/catalogo?cat=${c.id}`} title={c.nombre}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:border-foreground/30 hover:bg-muted/50">
                      {c.etiqueta}<span className="tabular-nums text-muted-foreground">{c.n}</span>
                    </Link>
                  ))}
                </div>
              </Panel>
            )}
          </div>}
        </div>

        {/* Destacados */}
        {!cargando && (secundario ? (
          <Suspense fallback={<section>
            <EncabezadoDestacados>
              <Link to="/portal/catalogo" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">Ver todo<ArrowRight className="h-3.5 w-3.5" /></Link>
            </EncabezadoDestacados>
            <SkeletonDestacados />
          </section>}>
            <DestacadosInicio />
          </Suspense>
        ) : <section>
            <EncabezadoDestacados>
              <Link to="/portal/catalogo" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">Ver todo<ArrowRight className="h-3.5 w-3.5" /></Link>
            </EncabezadoDestacados>
            <SkeletonDestacados />
          </section>)}
      </div>
    </PortalPagina>
  );
};

export default PortalDashboard;
