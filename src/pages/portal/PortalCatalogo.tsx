import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronDown, Loader2, PackageSearch, RotateCcw, Search, SlidersHorizontal, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cargaDiferida } from "@/lib/cargaDiferida";
import { PortalPagina } from "@/components/portal/PortalPagina";
import { TarjetaProducto, empaquePorDefecto } from "@/components/portal/TarjetaProducto";
import { SelectorEmpaqueDialog } from "@/components/portal/SelectorEmpaqueDialog";
import { EstadoVacio, SkeletonProductos } from "@/components/portal/sistema";
import { useCarritoPortal } from "@/hooks/useCarritoPortal";
import {
  ORDENES_CATALOGO, invalidarFicha, useCatalogoPaginado, useCategoriasPortal, type OrdenCatalogo, type ProductoPortal,
} from "@/hooks/useCatalogoPortal";

// Catálogo del portal (F2): paginado en el servidor (catalogo_portal) de 24 en 24 con scroll infinito y "Cargar más".
// Búsqueda con espera de 300 ms, sin acentos, por nombre (incluye la marca), código o categoría. Los filtros viven en la
// URL (?q=&cat=&orden=&disp=1) y la lista se guarda en memoria: al volver de la ficha se ve igual y en la misma posición.
// Móvil: buscador y categorías fijos bajo el encabezado, grilla de 2 columnas. Escritorio: categorías a la izquierda.

// Orden (Radix Select, escritorio) y hoja de filtros (Radix Sheet, teléfono): se descargan aparte, cuando el navegador
// queda libre o al tocarlos. Mientras tanto el orden se ve con un botón idéntico al del Select.
const controles = cargaDiferida(() => import("@/components/portal/CatalogoControles"));
const CLASE_DISPARADOR_SELECT = "flex h-10 w-52 items-center justify-between rounded-md border border-input bg-card px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 [&>span]:line-clamp-1";

const POR_PAGINA = 24;
const ESPERA_BUSQUEDA = 300;
const esUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const ordenValido = (s: string | null): OrdenCatalogo =>
  (ORDENES_CATALOGO.some((o) => o.valor === s) ? s : "relevancia") as OrdenCatalogo;

const PortalCatalogo = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const qUrl = searchParams.get("q") ?? "";
  const catUrl = searchParams.get("cat");
  const orden = ordenValido(searchParams.get("orden"));
  const soloDisponibles = searchParams.get("disp") === "1";
  const enfocar = searchParams.get("focus") === "search";

  const categorias = useCategoriasPortal();
  // ?cat= admite el id o (enlaces viejos) el nombre de la categoría
  const categoria = useMemo(() => {
    if (!catUrl) return null;
    if (esUuid(catUrl)) return catUrl;
    const n = catUrl.trim().toLowerCase();
    return categorias?.find((c) => c.nombre.trim().toLowerCase() === n)?.id ?? null;
  }, [catUrl, categorias]);
  const categoriaActual = categorias?.find((c) => c.id === categoria) ?? null;

  const [texto, setTexto] = useState(qUrl);
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  const modControles = controles.useModulo();
  useEffect(() => { if (filtrosAbiertos) controles.pedir(); }, [filtrosAbiertos]);
  const [abrirOrden, setAbrirOrden] = useState(false);
  const focoOrden = useRef(false);
  const inputMovil = useRef<HTMLInputElement>(null);
  const contenedor = useRef<HTMLDivElement>(null);
  const centinela = useRef<HTMLDivElement>(null);

  const cambiarParams = useCallback((cambios: Record<string, string | null>) => {
    setSearchParams((prev) => {
      const sp = new URLSearchParams(prev);
      Object.entries(cambios).forEach(([k, v]) => (v ? sp.set(k, v) : sp.delete(k)));
      sp.delete("focus");
      return sp;
    }, { replace: true });
  }, [setSearchParams]);

  // La URL manda (buscador del encabezado, atrás/adelante); el campo sigue a la URL si cambia desde fuera
  const ultimoEnviado = useRef(qUrl);
  useEffect(() => {
    if (qUrl !== ultimoEnviado.current) { ultimoEnviado.current = qUrl; setTexto(qUrl); }
  }, [qUrl]);
  useEffect(() => {
    if (texto.trim() === qUrl.trim()) return;
    const t = setTimeout(() => { ultimoEnviado.current = texto.trim(); cambiarParams({ q: texto.trim() || null }); }, ESPERA_BUSQUEDA);
    return () => clearTimeout(t);
  }, [texto, qUrl, cambiarParams]);
  useEffect(() => { if (enfocar) setTimeout(() => inputMovil.current?.focus(), 100); }, [enfocar]);

  const filtros = useMemo(() => ({ busqueda: qUrl, categoria, orden, soloDisponibles }), [qUrl, categoria, orden, soloDisponibles]);
  const lista = useCatalogoPaginado(filtros, POR_PAGINA);
  const { productos, total, aproximado, cargando, desactualizada, cargandoMas, hayMas, error, cargarMas, actualizar, guardarScroll, scrollRestaurar, consumirScroll } = lista;

  const { agregar, agregarConEmpaque, cambiarCantidad, cantidadDe, empaqueProducto, empaquePrecios, cerrarEmpaque } = useCarritoPortal();

  // Volver de la ficha: misma posición. Cambiar de filtros: arriba.
  useLayoutEffect(() => {
    if (scrollRestaurar != null && productos?.length) {
      window.scrollTo(0, scrollRestaurar);
      consumirScroll();
    }
  }, [scrollRestaurar, productos, consumirScroll]);
  const claveFiltros = JSON.stringify(filtros);
  const primeraClave = useRef(claveFiltros);
  useEffect(() => {
    if (claveFiltros !== primeraClave.current) { primeraClave.current = claveFiltros; window.scrollTo({ top: 0 }); }
  }, [claveFiltros]);
  useEffect(() => {
    let raf = 0;
    const alDesplazar = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { if (contenedor.current?.isConnected) guardarScroll(window.scrollY); });
    };
    window.addEventListener("scroll", alDesplazar, { passive: true });
    return () => { window.removeEventListener("scroll", alDesplazar); cancelAnimationFrame(raf); };
  }, [guardarScroll]);

  // Scroll infinito: al acercarse al final se pide la página siguiente (el botón "Cargar más" queda como respaldo)
  useEffect(() => {
    const el = centinela.current;
    if (!el || !hayMas) return;
    const obs = new IntersectionObserver((e) => { if (e[0]?.isIntersecting) cargarMas(); }, { rootMargin: "800px 0px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [hayMas, cargarMas, productos?.length]);

  const alternarFavorito = async (p: ProductoPortal) => {
    if (!user?.id) return;
    const nuevo = !p.favorito;
    actualizar(p.id, { favorito: nuevo });
    invalidarFicha(p.id);
    const { error: e } = nuevo
      ? await supabase.from("favoritos").insert({ usuario_id: user.id, producto_id: p.id })
      : await supabase.from("favoritos").delete().eq("usuario_id", user.id).eq("producto_id", p.id);
    if (e) {
      actualizar(p.id, { favorito: !nuevo });
      toast({ title: "No se pudo guardar el favorito", description: e.message, variant: "destructive" });
    }
  };

  const limpiar = () => { setTexto(""); ultimoEnviado.current = ""; cambiarParams({ q: null, cat: null, disp: null }); };
  const hayFiltros = !!(qUrl || catUrl || soloDisponibles);
  const nTodos = categorias?.reduce((s, c) => s + (c.n ?? 0), 0);

  const buscador = (ref?: React.Ref<HTMLInputElement>, id = "buscar-catalogo") => (
    <div className="relative flex-1" role="search">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        id={id}
        ref={ref}
        type="search"
        inputMode="search"
        enterKeyHint="search"
        placeholder="Buscar por nombre, marca o código"
        aria-label="Buscar productos"
        className="h-10 bg-card pl-9 pr-9"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { ultimoEnviado.current = texto.trim(); cambiarParams({ q: texto.trim() || null }); (e.target as HTMLInputElement).blur(); } }}
        autoFocus={enfocar}
      />
      {texto && (
        <button type="button" onClick={() => { setTexto(""); ultimoEnviado.current = ""; cambiarParams({ q: null }); }}
          className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground" aria-label="Borrar búsqueda">
          <X className="h-4 w-4" aria-hidden />
        </button>
      )}
    </div>
  );

  const chipCategoria = (id: string | null, etiqueta: string, titulo?: string) => {
    const activa = (id ?? null) === (categoria ?? null);
    return (
      <button key={id ?? "todas"} type="button" onClick={() => cambiarParams({ cat: id })} aria-pressed={activa} title={titulo}
        className={cn("shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
          activa ? "border-foreground bg-foreground text-background" : "border-border bg-card text-foreground hover:border-foreground/30")}>
        {etiqueta}
      </button>
    );
  };

  const resumen = productos === null || (cargando && desactualizada && !productos.length) ? "Cargando productos…"
    : `${total.toLocaleString("es-VE")} ${total === 1 ? "producto" : "productos"}`;

  return (
    <PortalPagina
      titulo="Catálogo"
      sinTituloEscritorio
      subencabezadoMovil={
        <div className="space-y-2.5">
          <div className="flex gap-2">
            {buscador(inputMovil, "buscar-catalogo-movil")}
            <Button variant="outline" size="icon" className="relative h-10 w-10 shrink-0" onClick={() => setFiltrosAbiertos(true)} aria-label="Filtros y orden">
              <SlidersHorizontal className="h-4 w-4" aria-hidden />
              {(soloDisponibles || orden !== "relevancia") && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary" aria-hidden />}
            </Button>
          </div>
          <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-0.5 [scrollbar-width:none] md:-mx-6 md:px-6 [&::-webkit-scrollbar]:hidden" role="group" aria-label="Categorías">
            {chipCategoria(null, "Todos")}
            {(categorias ?? []).map((c) => chipCategoria(c.id, c.etiqueta, c.nombre))}
          </div>
        </div>
      }
    >
      <div ref={contenedor} className="lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-8" data-catalogo>
        {/* Categorías (escritorio) */}
        <aside className="hidden lg:block" aria-label="Filtros del catálogo">
          <div className="sticky top-[5.5rem]">
            <h1 className="text-2xl font-semibold tracking-tight">Catálogo</h1>
            <p className="mt-1 text-sm text-muted-foreground tabular-nums">{nTodos != null ? `${nTodos} productos a la venta` : "Cargando…"}</p>
            <nav className="mt-6" aria-label="Categorías">
              <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Categorías</p>
              <ul className="max-h-[calc(100vh-18rem)] space-y-0.5 overflow-y-auto pr-1">
                {[{ id: null as string | null, etiqueta: "Todos", nombre: "Todos", n: nTodos, grupo: null as string | null | undefined }, ...(categorias ?? [])].map((c, i, lista) => {
                  const activa = (c.id ?? null) === (categoria ?? null);
                  // "MATERIAL MEDICO QUIRURGICO / GUANTES": el padre como encabezado y la categoría como subcategoría
                  const nuevoGrupo = !!c.grupo && c.grupo !== lista[i - 1]?.grupo;
                  return (
                    <Fragment key={c.id ?? "todas"}>
                    {nuevoGrupo && (
                      <li className="px-2 pb-0.5 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80" data-grupo-categoria>{c.grupo}</li>
                    )}
                    <li>
                      <button type="button" onClick={() => cambiarParams({ cat: c.id })} aria-pressed={activa} title={c.nombre}
                        className={cn("flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors", c.grupo && "pl-4",
                          activa ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")}>
                        <span className="truncate">{c.etiqueta}</span>
                        {c.n != null && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{c.n}</span>}
                      </button>
                    </li>
                    </Fragment>
                  );
                })}
              </ul>
            </nav>
            <label className="mt-5 flex cursor-pointer items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2.5 text-sm">
              <span>Solo disponibles</span>
              <Switch checked={soloDisponibles} onCheckedChange={(v) => cambiarParams({ disp: v ? "1" : null })} aria-label="Mostrar solo productos disponibles" />
            </label>
          </div>
        </aside>

        <div className="min-w-0">
          {/* Barra de herramientas (escritorio) */}
          <div className="mb-4 hidden items-center gap-3 lg:flex">
            {buscador()}
            {modControles ? (
              <modControles.OrdenSelect orden={orden} onCambiar={(v) => cambiarParams({ orden: v === "relevancia" ? null : v })}
                abrirAlMontar={abrirOrden} enfocar={focoOrden.current} />
            ) : (
              <button type="button" role="combobox" aria-expanded={false} aria-label="Ordenar" className={CLASE_DISPARADOR_SELECT}
                onPointerEnter={controles.pedir} onFocus={() => { focoOrden.current = true; controles.pedir(); }} onBlur={() => { focoOrden.current = false; }}
                onClick={() => { setAbrirOrden(true); controles.pedir(); }}>
                <span style={{ pointerEvents: "none" }}>{ORDENES_CATALOGO.find((o) => o.valor === orden)?.etiqueta}</span>
                <ChevronDown className="h-4 w-4 opacity-50" aria-hidden />
              </button>
            )}
          </div>

          <div className="mb-3 flex min-h-[1.5rem] flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground" aria-live="polite">
            <span className="tabular-nums" data-testid="catalogo-total">{resumen}</span>
            {categoriaActual && <span>en <span className="font-medium text-foreground">{categoriaActual.etiqueta}</span></span>}
            {qUrl.trim() && <span>{aproximado ? "parecidos a" : "para"} «{qUrl.trim()}»</span>}
            {soloDisponibles && <span>· solo disponibles</span>}
            {(cargando && productos !== null) && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label="Actualizando" />}
          </div>
          {aproximado && total > 0 && !desactualizada && (
            <p className="mb-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground" data-testid="catalogo-aproximado">
              No encontramos «{qUrl.trim()}» tal cual; te mostramos productos con nombres parecidos.
            </p>
          )}

          {error && !productos?.length ? (
            <div className="rounded-xl border border-border bg-card">
              <EstadoVacio icono={PackageSearch} titulo="No pudimos cargar el catálogo" descripcion={error}
                accion={<Button variant="outline" className="gap-2" onClick={lista.reintentar}><RotateCcw className="h-4 w-4" />Reintentar</Button>} />
            </div>
          ) : productos === null || (cargando && !productos.length) ? (
            <SkeletonProductos n={8} className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:gap-4 xl:grid-cols-4" />
          ) : productos.length === 0 && !cargando ? (
            <div className="rounded-xl border border-border bg-card">
              <EstadoVacio icono={PackageSearch} titulo="No encontramos productos" descripcion="Prueba con otro nombre, marca o código, o cambia de categoría."
                accion={hayFiltros ? <Button variant="outline" onClick={limpiar}>Ver todo el catálogo</Button> : undefined} />
            </div>
          ) : (
            <>
              {/* Las tarjetas llevan su nombre en h3: este h2 mantiene el orden de encabezados para los lectores de pantalla */}
              <h2 className="sr-only">Productos</h2>
              <div className={cn("grid grid-cols-2 gap-3 transition-opacity md:grid-cols-3 lg:gap-4 xl:grid-cols-4", desactualizada && "opacity-60")}
                aria-busy={desactualizada || undefined} data-testid="catalogo-grilla">
                {productos.map((p, i) => {
                  const tipo = empaquePorDefecto(p);
                  return (
                    <TarjetaProducto key={p.id} producto={p} prioridad={i < 4} cantidad={cantidadDe(p.id, tipo)}
                      favorito={p.favorito} onFavorito={() => alternarFavorito(p)} onAbrir={() => guardarScroll(window.scrollY)}
                      onAgregar={() => agregar(p)} onCambiar={(d) => cambiarCantidad(p, d, tipo)} />
                  );
                })}
                {cargandoMas && Array.from({ length: 4 }).map((_, i) => (
                  <div key={`s${i}`} className="h-[19rem] animate-pulse rounded-xl border border-border bg-muted/40" aria-hidden />
                ))}
              </div>
              <div ref={centinela} aria-hidden className="h-px" />
              <div className="mt-6 flex flex-col items-center gap-2">
                <p className="text-xs tabular-nums text-muted-foreground" data-testid="catalogo-mostrando">
                  Mostrando {productos.length.toLocaleString("es-VE")} de {total.toLocaleString("es-VE")}
                </p>
                {hayMas && (
                  <Button variant="outline" onClick={cargarMas} disabled={cargandoMas} className="gap-2" data-testid="catalogo-cargar-mas">
                    {cargandoMas && <Loader2 className="h-4 w-4 animate-spin" />}Cargar más
                  </Button>
                )}
                {error && productos.length > 0 && <p className="text-sm text-destructive" role="alert">{error}</p>}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Filtros y orden (móvil y tableta) */}
      {modControles && (
        <modControles.FiltrosHoja abierto={filtrosAbiertos} setAbierto={setFiltrosAbiertos} orden={orden} soloDisponibles={soloDisponibles}
          categorias={categorias} categoria={categoria} total={total} cambiarParams={cambiarParams} />
      )}

      {/* Elegir empaque (productos con más de un empaque) */}
      <SelectorEmpaqueDialog producto={empaqueProducto} precios={empaquePrecios} onElegir={agregarConEmpaque} onCerrar={cerrarEmpaque} />
    </PortalPagina>
  );
};

export default PortalCatalogo;
