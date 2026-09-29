import { Suspense, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as EventoTeclado } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowRight, Boxes, ClipboardList, FileText, Heart, Home, Landmark, LayoutGrid, LifeBuoy, LineChart, Loader2, LogOut,
  Receipt, Search, TicketPercent, UserRound, Wallet, type LucideIcon,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { EmpresaDistintivo, EmpresaSelector } from "@/components/EmpresaSelector";
import { NotificationsDropdown } from "@/components/portal/NotificationsDropdown";
import { BotonCuenta } from "@/components/portal/BotonCuenta";
import { BarraCarrito, BotonCarrito, useCarritoPanel } from "@/components/portal/PortalCartWidget";
import { cargaDiferida } from "@/lib/cargaDiferida";
import { ContextoPortal, type ClientePortal } from "@/components/portal/contextoPortal";
import { SelectorMoneda } from "@/components/portal/sistema";
import { PaginaCargando } from "@/components/portal/PortalPagina";
import { ProductImage } from "@/components/portal/ProductImage";
import { pedirCatalogo, sembrarFicha, useAlcanceCatalogo, type PaginaCatalogo, type ProductoPortal } from "@/hooks/useCatalogoPortal";
import { useAplicarTemaPortal } from "@/hooks/useTemaPortal";
import { useAccesibilidadPortal } from "@/components/portal/accesibilidad";

// Shell responsive del portal del cliente (F1). Es una ruta de diseño: se monta una vez y las páginas cambian dentro.
//  · Móvil y tableta (< 1024 px): encabezado compacto (lo pone cada página), barra inferior con 5 destinos y barra de
//    carrito sobre ella cuando hay productos.
//  · Escritorio (≥ 1024 px): barra lateral con la navegación, barra superior (buscador, empresa, moneda, avisos, carrito,
//    cuenta) y contenido ancho (máx. 1280 px).

interface ItemNav {
  etiqueta: string;
  ruta: string;
  icono: LucideIcon;
  exacto?: boolean;
  tambien?: string[];   // otras rutas que activan el destino
  excluir?: string[];   // subrutas que tienen su propio destino
}

const NAV_LATERAL: { seccion: string | null; items: ItemNav[] }[] = [
  {
    seccion: null,
    items: [
      { etiqueta: "Inicio", ruta: "/portal", icono: Home, exacto: true },
      { etiqueta: "Catálogo", ruta: "/portal/catalogo", icono: LayoutGrid },
      { etiqueta: "Favoritos", ruta: "/portal/favoritos", icono: Heart },
      { etiqueta: "Mis pedidos", ruta: "/portal/pedidos", icono: ClipboardList },
    ],
  },
  {
    seccion: "Finanzas",
    items: [
      { etiqueta: "Estado de cuenta", ruta: "/portal/finanzas", icono: LineChart },
      { etiqueta: "Facturas", ruta: "/portal/facturas", icono: FileText },
      { etiqueta: "Pagos", ruta: "/portal/pagos", icono: Wallet },
      { etiqueta: "Cómo pagar", ruta: "/portal/cuenta/pagos", icono: Landmark },
      { etiqueta: "Retenciones", ruta: "/portal/retenciones", icono: Receipt },
      { etiqueta: "Consignación", ruta: "/portal/consignacion", icono: Boxes },
    ],
  },
  {
    seccion: "Cuenta",
    items: [
      { etiqueta: "Mi cuenta", ruta: "/portal/cuenta", icono: UserRound, excluir: ["/portal/cuenta/pagos", "/portal/cuenta/cupones"] },
      { etiqueta: "Cupones", ruta: "/portal/cuenta/cupones", icono: TicketPercent },
      { etiqueta: "Ayuda", ruta: "/portal/ayuda", icono: LifeBuoy },
    ],
  },
];

const NAV_INFERIOR: ItemNav[] = [
  { etiqueta: "Inicio", ruta: "/portal", icono: Home, exacto: true },
  { etiqueta: "Catálogo", ruta: "/portal/catalogo", icono: LayoutGrid, tambien: ["/portal/favoritos"] },
  { etiqueta: "Pedidos", ruta: "/portal/pedidos", icono: ClipboardList },
  {
    etiqueta: "Finanzas", ruta: "/portal/finanzas", icono: Wallet,
    tambien: ["/portal/facturas", "/portal/pagos", "/portal/cuenta/pagos", "/portal/retenciones", "/portal/consignacion"],
  },
  { etiqueta: "Cuenta", ruta: "/portal/cuenta", icono: UserRound, tambien: ["/portal/ayuda"], excluir: ["/portal/cuenta/pagos"] },
];

const coincide = (item: ItemNav, ruta: string) => {
  const bajo = (base: string) => ruta === base || ruta.startsWith(`${base}/`);
  if (item.excluir?.some(bajo)) return false;
  if (item.exacto ? ruta === item.ruta : bajo(item.ruta)) return true;
  return !!item.tambien?.some(bajo);
};

// Overlays que no se ven al cargar (hoja del carrito, menú de la cuenta): su código (Radix Dialog / DropdownMenu y el motor
// de posicionamiento) se descarga aparte, cuando el navegador queda libre o al abrirlos por primera vez.
const hojaCarrito = cargaDiferida(() => import("@/components/portal/CarritoHoja"));
const menuCuenta = cargaDiferida(() => import("@/components/portal/MenuCuenta"));

// Caché del cliente por ficha: el shell se remonta al cambiar de empresa y no debe parpadear el nombre.
const cacheCliente = new Map<string, ClientePortal>();

const claveMoneda = (usuarioId: string) => `guds.moneda.${usuarioId}`;

export default function PortalShell() {
  const { user } = useAuth();
  const { currency, setCurrency, exchangeRate } = useCurrency();
  const { empresas, empresaActiva } = useEmpresa();
  const location = useLocation();
  const navigate = useNavigate();
  const carrito = useCarritoPanel();
  const hoja = hojaCarrito.useModulo();
  useEffect(() => { if (carrito.abierto) hojaCarrito.pedir(); }, [carrito.abierto]);
  const [cliente, setCliente] = useState<ClientePortal | null>(() => (user?.cliente_id ? cacheCliente.get(user.cliente_id) ?? null : null));
  const [monedaLista, setMonedaLista] = useState(false);
  useAplicarTemaPortal();
  useAccesibilidadPortal();

  // Cliente de la empresa activa (un cliente presente en ambas empresas tiene una ficha por empresa)
  useEffect(() => {
    const cid = user?.cliente_id;
    if (!cid) { setCliente(null); return; }
    const enCache = cacheCliente.get(cid);
    if (enCache) setCliente(enCache);
    let activo = true;
    supabase.from("clientes").select("id, nombre_negocio, rif, codigo, vendedor_odoo").eq("id", cid).maybeSingle()
      .then(({ data }) => {
        if (!activo || !data) return;
        cacheCliente.set(cid, data as ClientePortal);
        setCliente(data as ClientePortal);
      });
    return () => { activo = false; };
    }, [user?.cliente_id]);

  // La moneda elegida se recuerda por usuario (recargar con Bs. mantiene Bs.)
  useEffect(() => {
    if (!user?.id) return;
    try {
      const v = localStorage.getItem(claveMoneda(user.id));
      if (v === "USD" || v === "BS") setCurrency(v);
    } catch { /* sin almacenamiento */ }
    setMonedaLista(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  useEffect(() => {
    if (!monedaLista || !user?.id) return;
    try { localStorage.setItem(claveMoneda(user.id), currency); } catch { /* sin almacenamiento */ }
  }, [currency, monedaLista, user?.id]);

  const contexto = useMemo(() => ({ cliente, carrito, abrirCarrito: () => carrito.setAbierto(true) }), [cliente, carrito]);
  const ruta = location.pathname;
  const enCheckout = ruta === "/portal/carrito";
  const conBarraCarrito = carrito.lineas > 0 && !enCheckout;
  const acento = empresaActiva?.color || "hsl(var(--primary))";

  const cerrarSesion = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  return (
    <ContextoPortal.Provider value={contexto}>
      <div className="min-h-screen bg-background" data-portal-shell>
        {/* Barra lateral (escritorio) */}
        <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-border bg-card lg:flex" aria-label="Navegación del portal">
          <div className="border-t-[3px] px-5 pb-4 pt-5" style={{ borderTopColor: acento }}>
            <Link to="/portal" className="flex items-center gap-3" aria-label="Inicio del portal">
              <EmpresaDistintivo empresa={empresaActiva} className="h-9 w-9 rounded-lg text-xs" />
              <span className="min-w-0 leading-tight">
                <span className="block truncate text-sm font-semibold text-foreground" data-testid="shell-empresa">{empresaActiva?.nombre_corto ?? "GUDS"}</span>
                <span className="block text-xs text-muted-foreground">Portal de clientes</span>
              </span>
            </Link>
          </div>
          <div className="mx-4 mb-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Tu empresa</p>
            <p className="mt-0.5 line-clamp-2 text-sm font-medium leading-snug text-foreground" title={cliente?.nombre_negocio}>
              {cliente?.nombre_negocio ?? "—"}
            </p>
            {(cliente?.rif || cliente?.codigo) && (
              <p className="mt-0.5 truncate text-xs tabular-nums text-muted-foreground">{[cliente.rif, cliente.codigo].filter(Boolean).join(" · ")}</p>
            )}
          </div>
          <nav className="flex-1 overflow-y-auto px-3 py-2" aria-label="Secciones del portal">
            {NAV_LATERAL.map((s, i) => (
              <div key={s.seccion ?? i} className={cn(i > 0 && "mt-4")}>
                {s.seccion && <p className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{s.seccion}</p>}
                <ul className="space-y-0.5">
                  {s.items.map((it) => {
                    const activo = coincide(it, ruta);
                    return (
                      <li key={it.ruta}>
                        <Link
                          to={it.ruta}
                          aria-current={activo ? "page" : undefined}
                          className={cn(
                            "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
                            activo ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                          )}
                        >
                          <it.icono className={cn("h-4 w-4 shrink-0", activo && "text-primary")} strokeWidth={1.75} aria-hidden />
                          <span className="truncate">{it.etiqueta}</span>
                          {activo && <span className="ml-auto h-4 w-0.5 rounded-full bg-primary" aria-hidden />}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
          <div className="border-t border-border p-3">
            <button type="button" onClick={cerrarSesion}
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground">
              <LogOut className="h-4 w-4" strokeWidth={1.75} aria-hidden />Cerrar sesión
            </button>
          </div>
        </aside>

        <div className="lg:pl-64">
          {/* Barra superior (escritorio) */}
          <header className="sticky top-0 z-30 hidden h-16 items-center gap-4 border-b border-border bg-card px-6 lg:flex xl:px-8">
            {ruta !== "/portal/catalogo" ? <BuscadorSuperior /> : <div className="flex-1" />}
            <div className="ml-auto flex items-center gap-2">
              {empresas.length > 1 && <EmpresaSelector />}
              {exchangeRate > 0 && (
                <span className="hidden whitespace-nowrap text-xs tabular-nums text-muted-foreground xl:inline" title="Tasa oficial del día">
                  Tasa BCV Bs. {exchangeRate.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              )}
              <SelectorMoneda />
              <NotificationsDropdown />
              <BotonCarrito estado={carrito} />
              <MenuCuenta onCerrarSesion={cerrarSesion} />
            </div>
          </header>

          {/* Espacio inferior en móvil: navegación (4 rem) + barra de carrito (4 rem) + área segura */}
          <main className={cn(
            "pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-12",
            conBarraCarrito && "pb-[calc(9rem+env(safe-area-inset-bottom))]",
          )}>
            <Suspense fallback={<PaginaCargando />}>
              <Outlet />
            </Suspense>
          </main>
        </div>

        {/* Móvil y tableta: barra de carrito y navegación inferior */}
        {conBarraCarrito && <BarraCarrito estado={carrito} />}
        <nav
          className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
          aria-label="Navegación principal"
        >
          <ul className="mx-auto grid h-16 max-w-3xl grid-cols-5">
            {NAV_INFERIOR.map((it) => {
              const activo = coincide(it, ruta);
              return (
                <li key={it.ruta}>
                  <Link
                    to={it.ruta}
                    aria-current={activo ? "page" : undefined}
                    className={cn("flex h-full flex-col items-center justify-center gap-1 text-[11px] font-medium", activo ? "text-primary" : "text-muted-foreground")}
                  >
                    <it.icono className="h-5 w-5" strokeWidth={activo ? 2 : 1.75} aria-hidden />
                    {it.etiqueta}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {hoja && <hoja.CarritoHoja estado={carrito} />}
      </div>
    </ContextoPortal.Provider>
  );
}

/** Buscador del catálogo en la barra superior (atajo "/"): sugiere productos que abren su ficha; Enter busca en el catálogo. */
function BuscadorSuperior() {
  useAlcanceCatalogo();
  const navigate = useNavigate();
  const location = useLocation();
  const { formatPrice } = useCurrency();
  const [q, setQ] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [resultado, setResultado] = useState<(PaginaCatalogo & { q: string }) | null>(null);
  const [cargando, setCargando] = useState(false);
  const [activo, setActivo] = useState(-1);
  const caja = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      document.getElementById("buscador-superior")?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Sugerencias con espera de 200 ms (desde 2 letras); se descartan las respuestas viejas
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setResultado(null); setCargando(false); return; }
    let vivo = true;
    setCargando(true);
    const id = setTimeout(() => {
      pedirCatalogo({ busqueda: t, limite: 6 })
        .then((r) => { if (vivo) { setResultado({ ...r, q: t }); setActivo(-1); } })
        .catch(() => { if (vivo) setResultado(null); })
        .finally(() => { if (vivo) setCargando(false); });
    }, 200);
    return () => { vivo = false; clearTimeout(id); };
  }, [q]);

  // Cerrar al hacer clic fuera
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => { if (!caja.current?.contains(e.target as Node)) setAbierto(false); };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [abierto]);

  const productos = resultado?.productos ?? [];
  const mostrar = abierto && q.trim().length >= 2 && (resultado != null || cargando);

  const abrirFicha = (p: ProductoPortal) => {
    sembrarFicha(p);
    setAbierto(false);
    setQ("");
    navigate(`/portal/producto/${p.id}`, { state: { desde: location.pathname + location.search } });
  };
  const verTodo = () => {
    const t = q.trim();
    setAbierto(false);
    navigate(t ? `/portal/catalogo?q=${encodeURIComponent(t)}` : "/portal/catalogo");
    setQ("");
  };
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (activo >= 0 && productos[activo]) abrirFicha(productos[activo]);
    else verTodo();
  };
  const teclas = (e: EventoTeclado<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setAbierto(true); setActivo((i) => Math.min(productos.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActivo((i) => Math.max(-1, i - 1)); }
    else if (e.key === "Escape") { setAbierto(false); setActivo(-1); }
  };

  return (
    <form ref={caja} onSubmit={enviar} className="relative w-full max-w-md" role="search">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input
        id="buscador-superior"
        type="search"
        value={q}
        onChange={(e) => { setQ(e.target.value); setAbierto(true); }}
        onFocus={() => setAbierto(true)}
        onKeyDown={teclas}
        placeholder="Buscar productos por nombre, marca o código"
        aria-label="Buscar productos"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={mostrar}
        aria-controls="sugerencias-busqueda"
        aria-activedescendant={activo >= 0 ? `sugerencia-${activo}` : undefined}
        autoComplete="off"
        className="h-9 w-full rounded-md border border-border bg-muted/40 pl-9 pr-10 text-sm outline-none placeholder:text-muted-foreground focus:border-ring focus:bg-card focus:ring-2 focus:ring-ring/20"
      />
      {cargando ? (
        <Loader2 className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />
      ) : (
        <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-border bg-card px-1.5 text-[11px] text-muted-foreground xl:block" aria-hidden>/</kbd>
      )}
      {mostrar && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg" data-testid="buscador-sugerencias">
          <ul id="sugerencias-busqueda" role="listbox" aria-label="Productos sugeridos" className="max-h-[60vh] overflow-y-auto py-1">
            {productos.map((p, i) => (
              <li key={p.id} id={`sugerencia-${i}`} role="option" aria-selected={i === activo}
                onMouseDown={(e) => e.preventDefault()} onClick={() => abrirFicha(p)} onMouseEnter={() => setActivo(i)}
                className={cn("flex cursor-pointer items-center gap-3 px-3 py-2", i === activo && "bg-muted")} data-testid="sugerencia-producto">
                <ProductImage imageUrl={p.imagenes?.[0] ?? p.imagen_url} alt={p.nombre} size="sm" className="h-10 w-10 border border-border/60 bg-white" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{p.nombre}</span>
                  <span className="block truncate text-xs text-muted-foreground tabular-nums">{[p.sku, p.categoria?.etiqueta].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">{formatPrice(Number(p.precio))}</span>
              </li>
            ))}
            {resultado && productos.length === 0 && !cargando && (
              <li className="px-3 py-3 text-sm text-muted-foreground" role="presentation">No encontramos productos para «{resultado.q}».</li>
            )}
          </ul>
          {resultado && resultado.total > 0 && (
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={verTodo}
              className="flex w-full items-center justify-between gap-2 border-t border-border px-3 py-2.5 text-left text-sm font-medium text-primary hover:bg-muted/60">
              <span>{resultado.aproximado ? "Ver resultados parecidos" : `Ver los ${resultado.total.toLocaleString("es-VE")} resultados`} en el catálogo</span>
              <ArrowRight className="h-4 w-4 shrink-0" />
            </button>
          )}
        </div>
      )}
    </form>
  );
}

/** Menú de la cuenta: el botón se pinta con el header; el desplegable llega aparte (si se toca antes, se abre al llegar). */
function MenuCuenta({ onCerrarSesion }: { onCerrarSesion: () => void }) {
  // Solo existe en el header de escritorio: en teléfonos no se precarga (se pide si llega a usarse)
  const modulo = menuCuenta.useModulo(typeof window.matchMedia !== "function" || window.matchMedia("(min-width: 1024px)").matches);
  const [abrir, setAbrir] = useState(false);
  const foco = useRef(false);
  if (modulo) return <modulo.MenuCuentaDesplegable onCerrarSesion={onCerrarSesion} abrirAlMontar={abrir} enfocar={foco.current} />;
  return (
    <BotonCuenta
      aria-haspopup="menu"
      aria-expanded={false}
      onPointerEnter={menuCuenta.pedir}
      onFocus={() => { foco.current = true; menuCuenta.pedir(); }}
      onBlur={() => { foco.current = false; }}
      onClick={() => { setAbrir(true); menuCuenta.pedir(); }}
    />
  );
}
