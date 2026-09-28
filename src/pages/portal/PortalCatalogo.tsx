import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Search, SlidersHorizontal, X, PackageSearch, Check } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PortalPagina } from "@/components/portal/PortalPagina";
import { TarjetaProducto } from "@/components/portal/TarjetaProducto";
import { SelectorEmpaqueDialog } from "@/components/portal/SelectorEmpaqueDialog";
import { EstadoVacio, SkeletonProductos, normalizar } from "@/components/portal/sistema";
import { useRealtimeRefetch } from "@/hooks/useRealtimeRefetch";
import { useCarritoPortal, type ProductoConEmpaques } from "@/hooks/useCarritoPortal";
import { usePreciosListaCliente } from "@/hooks/usePreciosListaCliente";

// Catálogo del portal. Móvil: buscador y categorías fijos bajo el encabezado, grilla de 2 columnas. Escritorio: columna de
// categorías a la izquierda y grilla de 3–4 columnas con buscador y orden. La búsqueda encuentra por nombre, código (SKU)
// o categoría, sin acentos.

type Orden = "relevancia" | "precio_asc" | "precio_desc" | "disponibles";
const ORDENES: { valor: Orden; etiqueta: string }[] = [
  { valor: "relevancia", etiqueta: "Nombre (A–Z)" },
  { valor: "precio_asc", etiqueta: "Menor precio" },
  { valor: "precio_desc", etiqueta: "Mayor precio" },
  { valor: "disponibles", etiqueta: "Disponibles primero" },
];
const TODOS = "Todos";
const POR_PAGINA = 48;

const PortalCatalogo = () => {
  const [searchParams] = useSearchParams();
  const categoriaUrl = searchParams.get("cat");
  const qUrl = searchParams.get("q");
  const enfocar = searchParams.get("focus") === "search";
  const inputMovil = useRef<HTMLInputElement>(null);

  const [busqueda, setBusqueda] = useState(qUrl ?? "");
  const [categoria, setCategoria] = useState(categoriaUrl || TODOS);
  const [orden, setOrden] = useState<Orden>("relevancia");
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  const [favoritos, setFavoritos] = useState<string[]>([]);
  const [productos, setProductos] = useState<ProductoConEmpaques[] | null>(null);
  const [limite, setLimite] = useState(POR_PAGINA);

  const { agregar, agregarConEmpaque, cambiarCantidad, cantidadDe, disponibleDe, empaqueProducto, empaquePrecios, cerrarEmpaque } = useCarritoPortal();
  const { precioDe } = usePreciosListaCliente();
  const { user } = useAuth();


  useEffect(() => { if (categoriaUrl) setCategoria(categoriaUrl); }, [categoriaUrl]);
  useEffect(() => { if (qUrl != null) setBusqueda(qUrl); }, [qUrl]);
  useEffect(() => {
    if (enfocar) setTimeout(() => inputMovil.current?.focus(), 100);
  }, [enfocar]);

  // Refresco silencioso: tras la primera carga no se vuelve al esqueleto ni se pierde la posición
  const cargarProductos = async () => {
    const { data } = await supabase
      .from("productos")
      .select("*, categoria:categorias(*), producto_empaques(*, tipo_empaque:tipos_empaque(*))")
      .eq("activo", true)
      .order("nombre");
    if (data) setProductos(data as ProductoConEmpaques[]);
  };
  useEffect(() => { cargarProductos(); }, []);
  useRealtimeRefetch("productos", cargarProductos);

  useEffect(() => {
    if (!user?.id) return;
    supabase.from("favoritos").select("producto_id").eq("usuario_id", user.id)
      .then(({ data }) => { if (data) setFavoritos(data.map((f) => f.producto_id)); });
  }, [user?.id]);

  const alternarFavorito = async (id: string) => {
    if (!user?.id) return;
    if (favoritos.includes(id)) {
      setFavoritos((prev) => prev.filter((x) => x !== id));
      await supabase.from("favoritos").delete().eq("usuario_id", user.id).eq("producto_id", id);
    } else {
      setFavoritos((prev) => [...prev, id]);
      await supabase.from("favoritos").insert({ usuario_id: user.id, producto_id: id });
    }
  };

  const filtrados = useMemo(() => {
    const q = normalizar(busqueda.trim());
    const lista = (productos ?? []).filter((p) => {
      const coincideCat = categoria === TODOS || p.categoria?.nombre === categoria;
      if (!coincideCat) return false;
      if (!q) return true;
      return normalizar(p.nombre).includes(q) || normalizar(p.sku).includes(q) || normalizar(p.categoria?.nombre).includes(q);
    });
    const conDisp = (p: ProductoConEmpaques) => (disponibleDe(p) > 0 ? 0 : 1);
    return lista.sort((a, b) => {
      if (orden === "precio_asc") return precioDe(a) - precioDe(b);
      if (orden === "precio_desc") return precioDe(b) - precioDe(a);
      if (orden === "disponibles") return conDisp(a) - conDisp(b) || a.nombre.localeCompare(b.nombre, "es");
      return a.nombre.localeCompare(b.nombre, "es");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productos, busqueda, categoria, orden, precioDe]);

  useEffect(() => { setLimite(POR_PAGINA); }, [busqueda, categoria, orden]);
  const visibles = filtrados.slice(0, limite);

  // Categorías con productos a la venta en la empresa activa (las vacías o de uso interno, como gastos de importación, no se
  // muestran). Se ordenan por nombre; el nombre guardado se usa como clave y se muestra sin espacios sobrantes.
  const conteoPorCategoria = useMemo(() => {
    const m = new Map<string, number>();
    (productos ?? []).forEach((p) => { const n = p.categoria?.nombre; if (n) m.set(n, (m.get(n) ?? 0) + 1); });
    return m;
  }, [productos]);
  const categorias = useMemo(
    () => [TODOS, ...Array.from(conteoPorCategoria.keys()).sort((a, b) => a.trim().localeCompare(b.trim(), "es"))],
    [conteoPorCategoria],
  );

  const buscador = (ref?: React.Ref<HTMLInputElement>, id = "buscar-catalogo") => (
    <div className="relative flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        id={id}
        ref={ref}
        type="search"
        placeholder="Buscar por nombre o código"
        aria-label="Buscar productos"
        className="h-10 bg-card pl-9 pr-9"
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        autoFocus={enfocar}
      />
      {busqueda && (
        <button type="button" onClick={() => setBusqueda("")} className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground" aria-label="Borrar búsqueda">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );

  return (
    <PortalPagina
      titulo="Catálogo"
      sinTituloEscritorio
      subencabezadoMovil={
        <div className="space-y-2.5">
          <div className="flex gap-2">
            {buscador(inputMovil, "buscar-catalogo-movil")}
            <Button variant="outline" size="icon" className="h-10 w-10 shrink-0" onClick={() => setFiltrosAbiertos(true)} aria-label="Filtros y orden">
              <SlidersHorizontal className="h-4 w-4" />
            </Button>
          </div>
          <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-0.5 [scrollbar-width:none] md:-mx-6 md:px-6 [&::-webkit-scrollbar]:hidden">
            {categorias.map((c) => (
              <button key={c} type="button" onClick={() => setCategoria(c)} aria-pressed={categoria === c}
                className={cn("shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  categoria === c ? "border-foreground bg-foreground text-background" : "border-border bg-card text-foreground")}>
                {c.trim()}
              </button>
            ))}
          </div>
        </div>
      }
    >
      <div className="lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-8">
        {/* Categorías (escritorio) */}
        <aside className="hidden lg:block">
          <div className="sticky top-[5.5rem]">
            <h1 className="text-2xl font-semibold tracking-tight">Catálogo</h1>
            <p className="mt-1 text-sm text-muted-foreground tabular-nums">{productos ? `${productos.length} productos` : "Cargando…"}</p>
            <nav className="mt-6" aria-label="Categorías">
              <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Categorías</p>
              <ul className="max-h-[calc(100vh-14rem)] space-y-0.5 overflow-y-auto pr-1">
                {categorias.map((c) => {
                  const activa = categoria === c;
                  const n = c === TODOS ? productos?.length : conteoPorCategoria.get(c);
                  return (
                    <li key={c}>
                      <button type="button" onClick={() => setCategoria(c)} aria-pressed={activa}
                        className={cn("flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                          activa ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")}>
                        <span className="truncate">{c.trim()}</span>
                        {n != null && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{n}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </div>
        </aside>

        <div className="min-w-0">
          {/* Barra de herramientas (escritorio) */}
          <div className="mb-4 hidden items-center gap-3 lg:flex">
            {buscador()}
            <Select value={orden} onValueChange={(v) => setOrden(v as Orden)}>
              <SelectTrigger className="h-10 w-52 bg-card" aria-label="Ordenar"><SelectValue /></SelectTrigger>
              <SelectContent>{ORDENES.map((o) => <SelectItem key={o.valor} value={o.valor}>{o.etiqueta}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          <p className="mb-3 text-sm text-muted-foreground tabular-nums" aria-live="polite">
            {productos === null ? "Cargando productos…" : `${filtrados.length} ${filtrados.length === 1 ? "producto" : "productos"}`}
            {categoria !== TODOS && <> en <span className="font-medium text-foreground">{categoria.trim()}</span></>}
            {busqueda.trim() && <> para «{busqueda.trim()}»</>}
          </p>

          {productos === null ? (
            <SkeletonProductos n={8} className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:gap-4 xl:grid-cols-4" />
          ) : filtrados.length === 0 ? (
            <div className="rounded-xl border border-border bg-card">
              <EstadoVacio icono={PackageSearch} titulo="No encontramos productos" descripcion="Prueba con otro nombre o código, o cambia de categoría."
                accion={(busqueda || categoria !== TODOS) ? <Button variant="outline" onClick={() => { setBusqueda(""); setCategoria(TODOS); }}>Ver todo el catálogo</Button> : undefined} />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:gap-4 xl:grid-cols-4">
                {visibles.map((p) => (
                  <TarjetaProducto key={p.id} producto={p} precio={precioDe(p)} disponible={disponibleDe(p)} cantidad={cantidadDe(p.id)}
                    favorito={favoritos.includes(p.id)} onFavorito={() => alternarFavorito(p.id)}
                    onAgregar={() => agregar(p)} onCambiar={(d) => cambiarCantidad(p, d)} />
                ))}
              </div>
              {filtrados.length > visibles.length && (
                <div className="mt-6 flex justify-center">
                  <Button variant="outline" onClick={() => setLimite((l) => l + POR_PAGINA)}>Mostrar más ({filtrados.length - visibles.length})</Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Filtros y orden (móvil) */}
      <Sheet open={filtrosAbiertos} onOpenChange={setFiltrosAbiertos}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <SheetHeader className="text-left">
            <SheetTitle>Filtros y orden</SheetTitle>
            <SheetDescription className="sr-only">Elige la categoría y el orden del catálogo.</SheetDescription>
          </SheetHeader>
          <div className="space-y-5 py-4">
            <div>
              <p className="mb-2 text-sm font-medium">Ordenar por</p>
              <div className="grid grid-cols-2 gap-2">
                {ORDENES.map((o) => (
                  <button key={o.valor} type="button" onClick={() => setOrden(o.valor)} aria-pressed={orden === o.valor}
                    className={cn("flex h-11 items-center justify-between rounded-lg border px-3 text-sm font-medium",
                      orden === o.valor ? "border-foreground bg-muted" : "border-border")}>
                    {o.etiqueta}{orden === o.valor && <Check className="h-4 w-4" />}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">Categoría</p>
              <div className="flex flex-wrap gap-2">
                {categorias.map((c) => (
                  <button key={c} type="button" onClick={() => { setCategoria(c); setFiltrosAbiertos(false); }} aria-pressed={categoria === c}
                    className={cn("rounded-full border px-3 py-1.5 text-sm", categoria === c ? "border-foreground bg-foreground text-background" : "border-border")}>
                    {c.trim()}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Elegir empaque (productos con más de un empaque) */}
      <SelectorEmpaqueDialog producto={empaqueProducto} precios={empaquePrecios} onElegir={agregarConEmpaque} onCerrar={cerrarEmpaque} />
    </PortalPagina>
  );
};

export default PortalCatalogo;
