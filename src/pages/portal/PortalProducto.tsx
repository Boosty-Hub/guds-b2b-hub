import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Heart, History, Minus, PackageSearch, Plus, RotateCcw, ShoppingCart } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PortalPagina } from "@/components/portal/PortalPagina";
import { usePortal } from "@/components/portal/contextoPortal";
import { TarjetaProducto, empaquePorDefecto } from "@/components/portal/TarjetaProducto";
import { SelectorEmpaqueDialog } from "@/components/portal/SelectorEmpaqueDialog";
import { EstadoVacio, Panel, PillTono, fechaCorta, iniciales, unidadTexto } from "@/components/portal/sistema";
import { textoIva } from "@/lib/iva";
import { useCarritoPortal } from "@/hooks/useCarritoPortal";
import {
  disponibleProducto, invalidarFicha, pedirFicha, semillaFicha, useAlcanceCatalogo, type FichaPortal, type ProductoPortal,
} from "@/hooks/useCatalogoPortal";

// Ficha de producto del portal (F2): fotos, datos, empaques con el precio que cobra el servidor (por empaque y por unidad),
// cantidad con tope de disponible, IVA, favorito, "comprado antes" y relacionados. Se pinta al instante con lo que ya
// traía la tarjeta y completa descripción, última compra y relacionados con producto_portal.

const numero = (n: number, dec = 0) => n.toLocaleString("es-VE", { maximumFractionDigits: dec });

const PortalProducto = () => {
  useAlcanceCatalogo();
  const { id = "" } = useParams();
  const location = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const { formatPrice } = useCurrency();
  const portal = usePortal();
  const desde = (location.state as { desde?: string } | null)?.desde;
  const volver = desde && desde.startsWith("/portal") && !desde.startsWith("/portal/producto/") ? desde : "/portal/catalogo";

  const [ficha, setFicha] = useState<FichaPortal | null | undefined>(undefined);   // undefined: cargando · null: no está a la venta
  const [semilla, setSemilla] = useState<ProductoPortal | null>(() => semillaFicha(id));
  const [error, setError] = useState<string | null>(null);
  const [favorito, setFavorito] = useState<boolean | null>(null);
  const [empaqueId, setEmpaqueId] = useState<string | null | undefined>(undefined);
  const [cantidad, setCantidad] = useState(1);
  const [textoCantidad, setTextoCantidad] = useState("1");
  const [agregando, setAgregando] = useState(false);
  const carrito = useCarritoPortal();

  const cargar = (forzar = false) => {
    setError(null);
    pedirFicha(id, forzar)
      .then((f) => { setFicha(f); if (f) setSemilla(f.producto); })
      .catch((e: Error) => setError(e.message || "No pudimos cargar el producto."));
  };

  // Otro producto (relacionados): arriba, estado limpio
  useEffect(() => {
    window.scrollTo(0, 0);
    setFicha(undefined);
    setSemilla(semillaFicha(id));
    setFavorito(null);
    setEmpaqueId(undefined);
    setCantidad(1); setTextoCantidad("1");
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const p = ficha?.producto ?? semilla;
  const empaques = useMemo(() => p?.producto_empaques ?? [], [p]);
  const empaqueSel = empaqueId === undefined ? empaques[0] ?? null : empaques.find((e) => e.tipo_empaque_id === empaqueId) ?? null;
  const unidades = Math.max(1, Number(empaqueSel?.tipo_empaque.unidades ?? 1));
  const precio = empaqueSel ? Number(empaqueSel.precio) : Number(p?.precio ?? 0);
  const disponible = p ? disponibleProducto(p) : 0;
  const esFavorito = favorito ?? p?.favorito ?? false;
  const tipoSel = empaqueSel?.tipo_empaque_id ?? null;
  const enCarrito = p ? carrito.cantidadDe(p.id, tipoSel) : 0;
  const maximo = p ? carrito.maximoAgregable(p, tipoSel) : 0;
  const agotado = Number.isFinite(disponible) && disponible < unidades;
  const tope = Number.isFinite(maximo) ? maximo : 9999;

  // La cantidad nunca pasa del tope (p. ej. tras agregar o cambiar a un empaque más grande)
  useEffect(() => {
    if (!p) return;
    if (tope > 0 && cantidad > tope) { setCantidad(tope); setTextoCantidad(String(tope)); }
  }, [tope, cantidad, p]);

  const fijarCantidad = (n: number) => {
    const v = Math.max(1, Math.min(Math.floor(n) || 1, Math.max(1, tope)));
    setCantidad(v); setTextoCantidad(String(v));
  };

  const alternarFavorito = async () => {
    if (!user?.id || !p) return;
    const nuevo = !esFavorito;
    setFavorito(nuevo);
    invalidarFicha(p.id);
    const { error: e } = nuevo
      ? await supabase.from("favoritos").insert({ usuario_id: user.id, producto_id: p.id })
      : await supabase.from("favoritos").delete().eq("usuario_id", user.id).eq("producto_id", p.id);
    if (e) {
      setFavorito(!nuevo);
      toast({ title: "No se pudo guardar el favorito", description: e.message, variant: "destructive" });
    }
  };

  const agregarAlCarrito = async () => {
    if (!p || agotado || tope <= 0) return;
    setAgregando(true);
    const ok = await carrito.agregarConEmpaque(p, empaqueSel ? { id: empaqueSel.tipo_empaque_id, nombre: empaqueSel.tipo_empaque.nombre, unidades } : null, cantidad);
    setAgregando(false);
    if (ok) { setCantidad(1); setTextoCantidad("1"); }
  };

  const ultima = ficha?.ultima_compra ?? null;
  const pedirLoMismo = () => {
    if (!ultima) return;
    const mismo = empaques.find((e) => e.tipo_empaque_id === ultima.tipo_empaque_id);
    if (mismo) { setEmpaqueId(mismo.tipo_empaque_id); fijarCantidad(ultima.cantidad); return; }
    // El pedido anterior fue por unidades: se lleva a empaques del seleccionado (redondeando hacia arriba)
    const u = ultima.cantidad * Math.max(1, ultima.unidades);
    fijarCantidad(Math.ceil(u / unidades));
  };

  if (error && !p) {
    return (
      <PortalPagina titulo="Producto" volver={volver} etiquetaVolver="Volver al catálogo">
        <div className="rounded-xl border border-border bg-card">
          <EstadoVacio icono={PackageSearch} titulo="No pudimos cargar el producto" descripcion={error}
            accion={<Button variant="outline" className="gap-2" onClick={() => cargar(true)}><RotateCcw className="h-4 w-4" />Reintentar</Button>} />
        </div>
      </PortalPagina>
    );
  }
  if (ficha === null) {
    return (
      <PortalPagina titulo="Producto" volver={volver} etiquetaVolver="Volver al catálogo">
        <div className="rounded-xl border border-border bg-card" data-testid="ficha-no-disponible">
          <EstadoVacio icono={PackageSearch} titulo="Este producto no está a la venta"
            descripcion="Puede que ya no esté en el catálogo de esta empresa. Busca uno parecido en el catálogo."
            accion={<Button asChild variant="outline"><Link to="/portal/catalogo">Ir al catálogo</Link></Button>} />
        </div>
      </PortalPagina>
    );
  }

  const fotos = p ? (p.imagenes?.length ? p.imagenes : p.imagen_url ? [p.imagen_url] : []) : [];
  const iva = textoIva(p?.impuesto_pct);
  const tachado = p && p.en_oferta && p.precio_oferta && Number(p.precio_base) * unidades > precio ? Number(p.precio_base) * unidades : null;
  const etiquetaOpcion = empaqueSel ? `${empaqueSel.tipo_empaque.nombre}${unidades > 1 ? ` ×${unidades}` : ""}` : unidadTexto(p?.unidad) || "Unidad";
  const plural = (n: number) => (empaqueSel ? `${empaqueSel.tipo_empaque.nombre.toLowerCase()}${n === 1 ? "" : "s"}` : n === 1 ? "unidad" : "unidades");

  return (
    <PortalPagina titulo={p?.nombre ?? "Producto"} volver={volver} etiquetaVolver="Volver al catálogo" sinTituloEscritorio>
      {/* Migas (escritorio) */}
      <nav className="mb-5 hidden items-center gap-1.5 text-sm text-muted-foreground lg:flex" aria-label="Ruta">
        <Link to={volver} className="inline-flex items-center gap-1 hover:text-foreground"><ChevronLeft className="h-4 w-4" />Catálogo</Link>
        {p?.categoria && (
          <>
            <span aria-hidden>/</span>
            <Link to={`/portal/catalogo?cat=${p.categoria.id}`} className="hover:text-foreground" title={p.categoria.nombre}>{p.categoria.etiqueta}</Link>
          </>
        )}
        {p && <><span aria-hidden>/</span><span className="truncate text-foreground">{p.nombre}</span></>}
      </nav>

      {!p ? <FichaEsqueleto /> : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]" data-testid="ficha-producto" data-producto-id={p.id}>
          <Galeria fotos={fotos} nombre={p.nombre} categoria={p.categoria?.etiqueta ?? null} />

          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground tabular-nums">
              {[p.sku && `Código ${p.sku}`, p.categoria?.etiqueta].filter(Boolean).join(" · ")}
            </p>
            <h1 className="mt-1 text-xl font-semibold leading-snug tracking-tight text-foreground lg:text-2xl" data-testid="ficha-nombre">{p.nombre}</h1>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {agotado ? <PillTono tono="riesgo">Agotado</PillTono>
                : !Number.isFinite(disponible) ? <PillTono tono="ok">Disponible</PillTono>
                : disponible < 20 ? <PillTono tono="pendiente">Quedan {numero(disponible)} {disponible === 1 ? "unidad" : "unidades"}</PillTono>
                : <PillTono tono="ok">Disponible · {numero(disponible)} und.</PillTono>}
              {iva && <PillTono tono="neutro" testId="ficha-iva">{iva}</PillTono>}
              {p.en_oferta && p.porcentaje_descuento ? <PillTono tono="aprobado">Oferta −{p.porcentaje_descuento}%</PillTono> : null}
            </div>

            {/* Precio de la opción elegida (el que cobra el carrito) */}
            <div className="mt-5 rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <p className="text-3xl font-semibold tabular-nums tracking-tight text-foreground" data-testid="ficha-precio" data-precio={precio}>{formatPrice(precio)}</p>
                <p className="text-sm text-muted-foreground">por {etiquetaOpcion.toLowerCase()}</p>
                {tachado != null && <p className="text-sm tabular-nums text-muted-foreground line-through">{formatPrice(tachado)}</p>}
              </div>
              {unidades > 1 && <p className="mt-0.5 text-sm tabular-nums text-muted-foreground" data-testid="ficha-precio-unidad">{formatPrice(precio / unidades)} por unidad</p>}
              <p className="mt-1 text-xs text-muted-foreground">{iva === "Exento" ? "Exento de IVA." : iva ? `Más ${iva.replace("IVA ", "IVA de ")}.` : "El IVA se calcula al revisar el pedido."}</p>

              {/* Empaques */}
              {empaques.length > 0 && (
                <fieldset className="mt-4">
                  <legend className="mb-2 text-sm font-medium text-foreground">{empaques.length > 1 ? "Elige el empaque" : "Se vende por"}</legend>
                  <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Empaque">
                    {empaques.map((e) => {
                      const sel = e.tipo_empaque_id === tipoSel;
                      const u = Math.max(1, Number(e.tipo_empaque.unidades));
                      return (
                        <button key={e.id} type="button" role="radio" aria-checked={sel} onClick={() => setEmpaqueId(e.tipo_empaque_id)}
                          className={cn("flex min-h-[3.25rem] items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
                            sel ? "border-foreground bg-muted/60 ring-1 ring-foreground" : "border-border hover:border-foreground/30")}
                          data-testid="ficha-empaque" data-tipo-empaque-id={e.tipo_empaque_id} data-precio={e.precio}>
                          <span className="min-w-0">
                            <span className="block text-sm font-medium">{e.tipo_empaque.nombre}{u > 1 ? ` ×${u}` : ""}</span>
                            <span className="block text-xs text-muted-foreground">{u} {u === 1 ? "unidad" : "unidades"}</span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="block text-sm font-semibold tabular-nums">{formatPrice(Number(e.precio))}</span>
                            {u > 1 && <span className="block text-xs tabular-nums text-muted-foreground">{formatPrice(Number(e.precio) / u)} c/u</span>}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              )}

              {/* Cantidad y agregar */}
              <div className="mt-4">
                <label htmlFor="ficha-cantidad" className="mb-2 block text-sm font-medium text-foreground">Cantidad</label>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex h-11 items-center rounded-lg border border-border bg-background">
                    <button type="button" className="flex h-11 w-11 items-center justify-center rounded-l-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                      onClick={() => fijarCantidad(cantidad - 1)} disabled={cantidad <= 1 || agotado} aria-label="Quitar uno"><Minus className="h-4 w-4" /></button>
                    <input id="ficha-cantidad" inputMode="numeric" pattern="[0-9]*" value={textoCantidad} disabled={agotado || tope <= 0}
                      onChange={(e) => setTextoCantidad(e.target.value.replace(/\D/g, "").slice(0, 5))}
                      onBlur={() => fijarCantidad(Number(textoCantidad))}
                      onKeyDown={(e) => { if (e.key === "Enter") { fijarCantidad(Number(textoCantidad)); } }}
                      className="h-11 w-16 border-x border-border bg-transparent text-center text-base font-semibold tabular-nums outline-none focus:bg-muted/40"
                      aria-describedby="ficha-tope" data-testid="ficha-cantidad" />
                    <button type="button" className="flex h-11 w-11 items-center justify-center rounded-r-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                      onClick={() => fijarCantidad(cantidad + 1)} disabled={cantidad >= tope || agotado} aria-label="Agregar uno"><Plus className="h-4 w-4" /></button>
                  </div>
                  <p className="text-sm tabular-nums text-muted-foreground">
                    Subtotal <span className="font-semibold text-foreground" data-testid="ficha-subtotal">{formatPrice(precio * cantidad)}</span>
                    {cantidad > 0 && unidades > 1 && <> · {numero(cantidad * unidades)} und.</>}
                  </p>
                </div>
                <p id="ficha-tope" className="mt-1.5 text-xs text-muted-foreground" aria-live="polite">
                  {agotado ? "Sin disponible por ahora."
                    : tope <= 0 ? "Ya tienes en el carrito todo lo disponible."
                    : Number.isFinite(maximo) ? `Puedes agregar hasta ${numero(tope)} ${plural(tope)}${enCarrito > 0 ? " (contando lo que ya tienes en el carrito)" : ""}.`
                    : "Sin tope de existencias."}
                </p>
              </div>

              <div className="mt-4 flex gap-2">
                <Button className="h-12 flex-1 gap-2 text-base font-semibold" onClick={agregarAlCarrito} disabled={agotado || tope <= 0 || agregando} data-testid="ficha-agregar">
                  <ShoppingCart className="h-5 w-5" />{agregando ? "Agregando…" : "Agregar al carrito"}
                </Button>
                <button type="button" onClick={alternarFavorito} aria-pressed={esFavorito}
                  aria-label={esFavorito ? "Quitar de favoritos" : "Agregar a favoritos"} data-testid="ficha-favorito"
                  className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-md border bg-card transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    esFavorito ? "border-primary/40 bg-primary/5 text-primary" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground")}>
                  <Heart className={cn("h-5 w-5", esFavorito && "fill-primary")} />
                </button>
              </div>
              {enCarrito > 0 && (
                <p className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground" data-testid="ficha-en-carrito">
                  <span>En tu carrito: <span className="font-medium tabular-nums text-foreground">{numero(enCarrito)} {plural(enCarrito)}</span></span>
                  {portal && <button type="button" className="font-medium text-primary hover:underline" onClick={portal.abrirCarrito}>Ver carrito</button>}
                </p>
              )}
            </div>

            {/* Comprado antes */}
            {ficha === undefined ? <Skeleton className="mt-4 h-20 w-full rounded-xl" /> : ultima && (
              <div className="mt-4 flex gap-3 rounded-xl border border-border bg-muted/30 p-4" data-testid="ficha-comprado-antes">
                <History className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-medium text-foreground">Comprado antes</p>
                  <p className="mt-0.5 text-muted-foreground">
                    Tu último pedido fue el {fechaCorta(ultima.fecha)}{" "}
                    (<Link to={`/portal/pedidos?pedido=${ultima.orden_id}`} className="font-medium text-foreground underline-offset-2 hover:underline">{ultima.numero}</Link>):{" "}
                    <span className="tabular-nums">{numero(ultima.cantidad)} {ultima.empaque ? `${ultima.empaque.toLowerCase()}${ultima.cantidad === 1 ? "" : "s"}` : ultima.cantidad === 1 ? "unidad" : "unidades"}</span>
                    {ultima.precio_unitario != null && <> a <span className="tabular-nums">{formatPrice(Number(ultima.precio_unitario))}</span>{ultima.empaque ? ` c/${ultima.empaque.toLowerCase()}` : " c/u"}</>}.
                    {ultima.veces > 1 && <> Lo has pedido {numero(ultima.veces)} veces.</>}
                  </p>
                  {!agotado && tope > 0 && (
                    <button type="button" onClick={pedirLoMismo} className="mt-2 text-sm font-medium text-primary hover:underline">Usar la misma cantidad</button>
                  )}
                </div>
              </div>
            )}

            {/* Descripción y datos */}
            {p.descripcion && (
              <Panel titulo="Descripción" className="mt-4">
                <p className="whitespace-pre-line text-sm leading-relaxed text-foreground" data-testid="ficha-descripcion">{p.descripcion}</p>
              </Panel>
            )}
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-border bg-card p-4 text-sm">
              <div><dt className="text-xs text-muted-foreground">Código</dt><dd className="font-medium tabular-nums">{p.sku || "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Categoría</dt><dd className="truncate font-medium" title={p.categoria?.nombre}>{p.categoria?.etiqueta ?? "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Unidad de medida</dt><dd className="font-medium">{unidadTexto(p.unidad) || "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Impuesto</dt><dd className="font-medium" title={p.impuesto_nombre ?? undefined}>{iva ?? "IVA general"}</dd></div>
            </dl>
          </div>
        </div>
      )}

      {/* Relacionados */}
      {ficha && ficha.relacionados.length > 0 && (
        <section className="mt-10" aria-labelledby="titulo-relacionados">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="titulo-relacionados" className="text-base font-semibold text-foreground">Productos relacionados</h2>
            {ficha.producto.categoria && (
              <Link to={`/portal/catalogo?cat=${ficha.producto.categoria.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                Ver {ficha.producto.categoria.etiqueta.toLowerCase()}<ChevronRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:gap-4 xl:grid-cols-4" data-testid="ficha-relacionados">
            {ficha.relacionados.map((r) => {
              const tipo = empaquePorDefecto(r);
              return (
                <TarjetaProducto key={r.id} producto={r} cantidad={carrito.cantidadDe(r.id, tipo)}
                  onAgregar={() => carrito.agregar(r)} onCambiar={(d) => carrito.cambiarCantidad(r, d, tipo)} />
              );
            })}
          </div>
        </section>
      )}

      <SelectorEmpaqueDialog producto={carrito.empaqueProducto} precios={carrito.empaquePrecios} onElegir={carrito.agregarConEmpaque} onCerrar={carrito.cerrarEmpaque} />
    </PortalPagina>
  );
};

/** Galería: fotos deslizables (táctil y flechas), miniaturas y placeholder de marca si no hay fotos. */
const Galeria = ({ fotos, nombre, categoria }: { fotos: string[]; nombre: string; categoria: string | null }) => {
  const [indice, setIndice] = useState(0);
  const [rotas, setRotas] = useState<Record<number, boolean>>({});
  const pista = useRef<HTMLDivElement>(null);
  const validas = fotos.filter((_, i) => !rotas[i]);
  useEffect(() => { setIndice(0); pista.current?.scrollTo({ left: 0 }); }, [fotos.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  const irA = (i: number) => {
    const el = pista.current; if (!el) return;
    const j = Math.max(0, Math.min(fotos.length - 1, i));
    el.scrollTo({ left: j * el.clientWidth, behavior: "smooth" });
    setIndice(j);
  };

  if (validas.length === 0) {
    return (
      <div className="relative flex aspect-[4/3] w-full flex-col items-center justify-center overflow-hidden rounded-xl border border-border bg-gradient-to-br from-muted to-muted/30 sm:aspect-square lg:max-h-[560px]"
        role="img" aria-label={`${nombre} (sin foto)`} data-placeholder-producto data-testid="ficha-placeholder">
        <div className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:radial-gradient(currentColor_1px,transparent_1px)] [background-size:14px_14px]" aria-hidden />
        <span className="select-none text-6xl font-semibold tracking-wider text-muted-foreground/70" aria-hidden>{iniciales(nombre)}</span>
        {categoria && <span className="mt-3 text-xs font-medium uppercase tracking-widest text-muted-foreground" aria-hidden>{categoria}</span>}
      </div>
    );
  }

  return (
    <div className="min-w-0 lg:sticky lg:top-[5.5rem] lg:self-start" data-testid="ficha-galeria">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-border bg-white sm:aspect-square lg:max-h-[560px]">
        <div ref={pista} className="flex h-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onScroll={(e) => { const el = e.currentTarget; setIndice(Math.round(el.scrollLeft / Math.max(1, el.clientWidth))); }}
          aria-roledescription="carrusel" aria-label={`Fotos de ${nombre}`}>
          {fotos.map((url, i) => (
            <div key={url + i} className="flex h-full w-full shrink-0 snap-center items-center justify-center p-4 sm:p-6" aria-roledescription="foto" aria-label={`${i + 1} de ${fotos.length}`}>
              {!rotas[i] && (
                <img src={url} alt={fotos.length > 1 ? `${nombre}, foto ${i + 1}` : nombre} width={800} height={800}
                  loading={i === 0 ? "eager" : "lazy"} decoding="async" {...(i === 0 ? { fetchpriority: "high" } : {})}
                  className="h-full w-full object-contain" onError={() => setRotas((r) => ({ ...r, [i]: true }))} />
              )}
            </div>
          ))}
        </div>
        {fotos.length > 1 && (
          <>
            <button type="button" onClick={() => irA(indice - 1)} disabled={indice === 0} aria-label="Foto anterior"
              className="absolute left-2 top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card/90 shadow-sm disabled:opacity-0 sm:flex">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button type="button" onClick={() => irA(indice + 1)} disabled={indice >= fotos.length - 1} aria-label="Foto siguiente"
              className="absolute right-2 top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card/90 shadow-sm disabled:opacity-0 sm:flex">
              <ChevronRight className="h-5 w-5" />
            </button>
            <span className="absolute bottom-2 right-2 rounded-full bg-foreground/70 px-2 py-0.5 text-xs font-medium tabular-nums text-background" aria-hidden>
              {indice + 1}/{fotos.length}
            </span>
          </>
        )}
      </div>
      {fotos.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Miniaturas">
          {fotos.map((url, i) => (
            <button key={url + i} type="button" onClick={() => irA(i)} aria-label={`Ver foto ${i + 1} de ${fotos.length}`} aria-current={i === indice || undefined}
              className={cn("h-16 w-16 shrink-0 overflow-hidden rounded-lg border bg-white p-1 transition-colors", i === indice ? "border-foreground ring-1 ring-foreground" : "border-border hover:border-foreground/40")}>
              <img src={url} alt="" width={64} height={64} loading="lazy" decoding="async" className="h-full w-full object-contain" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const FichaEsqueleto = () => (
  <div className="grid gap-6 lg:grid-cols-2 lg:gap-10" aria-busy="true" aria-label="Cargando producto">
    <Skeleton className="aspect-[4/3] w-full rounded-xl sm:aspect-square lg:max-h-[560px]" />
    <div className="space-y-3">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-7 w-full" />
      <Skeleton className="h-7 w-2/3" />
      <Skeleton className="mt-4 h-64 w-full rounded-xl" />
    </div>
  </div>
);

export default PortalProducto;
