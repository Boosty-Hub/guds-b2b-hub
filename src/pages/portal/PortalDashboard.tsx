import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ClipboardList,
  CreditCard,
  FileText,
  Heart,
  Landmark,
  LayoutGrid,
  Receipt,
  Search,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useStoreConfig } from "@/contexts/StoreConfigContext";
import { Button } from "@/components/ui/button";
import { BannerVisual } from "@/components/BannerVisual";
import { estadoVisible } from "@/components/pedidos/estadoPedido";
import { PortalPagina } from "@/components/portal/PortalPagina";
import { usePortal } from "@/components/portal/contextoPortal";
import { TarjetaProducto } from "@/components/portal/TarjetaProducto";
import { SelectorEmpaqueDialog } from "@/components/portal/SelectorEmpaqueDialog";
import { EstadoPill, EstadoVacio, Kpi, NumeroPedido, Panel, SkeletonFilas, SkeletonProductos, fechaCorta } from "@/components/portal/sistema";
import { useCarritoPortal, type ProductoConEmpaques } from "@/hooks/useCarritoPortal";
import { usePreciosListaCliente } from "@/hooks/usePreciosListaCliente";

// Inicio del portal: lo que un comprador B2B necesita al entrar (saldo, crédito, pedidos en curso), sus pedidos recientes,
// accesos rápidos y productos destacados para recomprar.

interface OrdenResumen {
  id: string; numero: string; numero_guds: string | null; estado: string; estado_odoo: string | null; aprobacion: string | null;
  odoo_id: number | null; total: number; created_at: string; fecha_pedido: string | null;
}
interface Credito { modo: string; disponible: number; limite: number }

const TOLERANCIA = 0.009;

const ACCESOS: { etiqueta: string; ruta: string; icono: LucideIcon }[] = [
  { etiqueta: "Catálogo", ruta: "/portal/catalogo", icono: LayoutGrid },
  { etiqueta: "Favoritos", ruta: "/portal/favoritos", icono: Heart },
  { etiqueta: "Declarar pago", ruta: "/portal/pagos", icono: Wallet },
  { etiqueta: "Cuentas para pagar", ruta: "/portal/cuenta/pagos", icono: Landmark },
  { etiqueta: "Mis pedidos", ruta: "/portal/pedidos", icono: ClipboardList },
  { etiqueta: "Retenciones", ruta: "/portal/retenciones", icono: Receipt },
];

const PortalDashboard = () => {
  const { user } = useAuth();
  const { formatPrice } = useCurrency();
  const { getActiveBanners } = useStoreConfig();
  const portal = usePortal();
  const { precioDe } = usePreciosListaCliente();
  const { agregar, agregarConEmpaque, cambiarCantidad, cantidadDe, disponibleDe, empaqueProducto, empaquePrecios, cerrarEmpaque } = useCarritoPortal();

  const [cargando, setCargando] = useState(true);
  const [ordenes, setOrdenes] = useState<OrdenResumen[]>([]);
  const [facturas, setFacturas] = useState<{ saldo_usd: number; fecha_vencimiento: string | null }[]>([]);
  const [credito, setCredito] = useState<Credito | null>(null);
  const [destacados, setDestacados] = useState<ProductoConEmpaques[] | null>(null);
  // Categorías con productos a la venta en la empresa activa (las vacías o internas no se muestran)
  const [categorias, setCategorias] = useState<{ nombre: string; n: number }[]>([]);

  const banners = getActiveBanners();

  useEffect(() => {
    const cid = user?.cliente_id;
    if (!cid) { setCargando(false); return; }
    let activo = true;
    Promise.all([
      supabase.from("ordenes").select("id, numero, numero_guds, estado, estado_odoo, aprobacion, odoo_id, total, created_at, fecha_pedido")
        .eq("cliente_id", cid).order("created_at", { ascending: false }).limit(200),
      // Deuda real: facturas publicadas con saldo, igual que Pagos y Cuentas por Cobrar del admin
      supabase.from("facturas").select("saldo_usd, fecha_vencimiento").eq("cliente_id", cid).eq("estado", "posted").gt("saldo_usd", TOLERANCIA),
      supabase.rpc("credito_disponible", { p_cliente_id: cid }),
    ]).then(([o, f, c]) => {
      if (!activo) return;
      const filas = ((o.data as OrdenResumen[] | null) ?? []).sort((a, b) => (b.fecha_pedido ?? b.created_at).localeCompare(a.fecha_pedido ?? a.created_at));
      setOrdenes(filas);
      setFacturas(((f.data as { saldo_usd: number; fecha_vencimiento: string | null }[] | null) ?? []).map((x) => ({ ...x, saldo_usd: Number(x.saldo_usd) })));
      setCredito(((c.data as Credito[] | null) ?? [])[0] ?? null);
      setCargando(false);
    });
    supabase.from("productos").select("*, producto_empaques(*, tipo_empaque:tipos_empaque(*))").eq("activo", true).eq("destacado", true).order("nombre").limit(8)
      .then(({ data }) => { if (activo) setDestacados((data as ProductoConEmpaques[] | null) ?? []); });
    supabase.from("productos").select("categoria:categorias(nombre)").eq("activo", true)
      .then(({ data }) => {
        if (!activo) return;
        const m = new Map<string, number>();
        ((data as unknown as { categoria: { nombre: string } | null }[] | null) ?? []).forEach((r) => {
          const n = r.categoria?.nombre; if (n) m.set(n, (m.get(n) ?? 0) + 1);
        });
        setCategorias(Array.from(m, ([nombre, n]) => ({ nombre, n })).sort((a, b) => b.n - a.n));
      });
    return () => { activo = false; };
  }, [user?.cliente_id]);

  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const porPagar = facturas.reduce((s, f) => s + f.saldo_usd, 0);
  const vencido = facturas.filter((f) => f.fecha_vencimiento && new Date(`${f.fecha_vencimiento}T00:00:00`) < hoy).reduce((s, f) => s + f.saldo_usd, 0);
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
          <p className="truncate text-sm font-semibold text-foreground" data-testid="nombre-negocio">{portal?.cliente?.nombre_negocio ?? "Mi negocio"}</p>
        </div>
      }
      acciones={
        <>
          <Button asChild variant="outline" className="gap-2"><Link to="/portal/pagos"><Wallet className="h-4 w-4" />Declarar pago</Link></Button>
          <Button asChild className="gap-2"><Link to="/portal/catalogo"><LayoutGrid className="h-4 w-4" />Hacer un pedido</Link></Button>
        </>
      }
    >
      <div className="space-y-6">
        {/* Buscador (móvil y tableta; en escritorio está en la barra superior) */}
        <Link to="/portal/catalogo?focus=search" className="flex h-11 items-center gap-2.5 rounded-lg border border-border bg-card px-3.5 text-sm text-muted-foreground lg:hidden">
          <Search className="h-4 w-4" />Buscar productos por nombre o código
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
          <Kpi etiqueta="Por pagar" icono={FileText} href="/portal/pagos" cargando={cargando} testId="kpi-por-pagar"
            valor={formatPrice(porPagar)} alerta={vencido > TOLERANCIA}
            detalle={facturas.length === 0 ? "Sin facturas pendientes" : vencido > TOLERANCIA ? `${formatPrice(vencido)} vencido` : `${facturas.length} ${facturas.length === 1 ? "factura" : "facturas"}`} />
          <Kpi etiqueta="Crédito disponible" icono={CreditCard} cargando={cargando} valor={creditoValor} detalle={creditoDetalle}>
            {usoCredito != null && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                <div className="h-full rounded-full bg-foreground/70" style={{ width: `${usoCredito}%` }} />
              </div>
            )}
          </Kpi>
          <Kpi etiqueta="Pedidos en curso" icono={ClipboardList} href="/portal/pedidos" cargando={cargando}
            valor={enCurso.length} detalle={porAprobar > 0 ? `${porAprobar} por aprobar` : "Ninguno por aprobar"} />
          <Kpi etiqueta="Último pedido" icono={Receipt} cargando={cargando} href={ultimo ? `/portal/pedidos?pedido=${ultimo.o.id}` : "/portal/catalogo"}
            valor={ultimo ? <span className="text-lg sm:text-xl">{ultimo.o.numero}</span> : "—"}
            detalle={ultimo ? `${fechaCorta(ultimo.o.fecha_pedido ?? ultimo.o.created_at)} · ${ultimo.ev.etiqueta}` : "Aún no tienes pedidos"} />
        </div>

        <div className="grid gap-6 lg:grid-cols-3 lg:items-start">
          {/* Pedidos recientes */}
          <Panel titulo="Pedidos recientes" className="lg:col-span-2" cuerpoClassName="p-0 sm:p-0"
            accion={<Link to="/portal/pedidos" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">Ver todos<ArrowRight className="h-3.5 w-3.5" /></Link>}>
            {cargando ? <SkeletonFilas n={4} alto="h-12" className="p-4" /> : ordenes.length === 0 ? (
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

          <div className="space-y-6">
            <Panel titulo="Accesos rápidos" cuerpoClassName="p-2 sm:p-2">
              <ul className="grid grid-cols-3 gap-1 lg:grid-cols-2">
                {ACCESOS.map((a) => (
                  <li key={a.ruta + a.etiqueta}>
                    <Link to={a.ruta} className="flex h-full flex-col items-center gap-1.5 rounded-lg px-2 py-3 text-center text-xs font-medium text-foreground hover:bg-muted/60 lg:flex-row lg:gap-2.5 lg:px-3 lg:text-left lg:text-sm">
                      <a.icono className="h-5 w-5 shrink-0 text-muted-foreground lg:h-4 lg:w-4" strokeWidth={1.75} />
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
                    <Link key={c.nombre} to={`/portal/catalogo?cat=${encodeURIComponent(c.nombre)}`}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:border-foreground/30 hover:bg-muted/50">
                      {c.nombre.trim()}<span className="tabular-nums text-muted-foreground">{c.n}</span>
                    </Link>
                  ))}
                </div>
              </Panel>
            )}
          </div>
        </div>

        {/* Destacados */}
        {(destacados === null || destacados.length > 0) && (
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground">Productos destacados</h2>
              <Link to="/portal/catalogo" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">Ver todo<ArrowRight className="h-3.5 w-3.5" /></Link>
            </div>
            {destacados === null ? (
              <SkeletonProductos n={4} className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 lg:gap-4" />
            ) : (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 lg:gap-4">
                {destacados.map((p) => (
                  <TarjetaProducto key={p.id} producto={p} precio={precioDe(p)} disponible={disponibleDe(p)} cantidad={cantidadDe(p.id)}
                    onAgregar={() => agregar(p)} onCambiar={(d) => cambiarCantidad(p, d)} />
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      <SelectorEmpaqueDialog producto={empaqueProducto} precios={empaquePrecios} onElegir={agregarConEmpaque} onCerrar={cerrarEmpaque} />
    </PortalPagina>
  );
};

export default PortalDashboard;
