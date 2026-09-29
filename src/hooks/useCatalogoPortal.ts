import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { useRealtimeRefetch } from "@/hooks/useRealtimeRefetch";

// Catálogo del portal paginado en el servidor (fase 20k). Las RPC devuelven el producto como lo ve el cliente, sin costo,
// con el precio que cobra el carrito (precio_efectivo de su ficha por empaque), el disponible, el IVA y si es favorito.
//  · catalogo_portal   → una página + el total (búsqueda sin acentos por nombre, código y categoría; orden y filtros).
//  · categorias_portal → categorías con productos a la venta en la empresa activa.
//  · producto_portal   → ficha (descripción, última compra del cliente y relacionados).

export interface EmpaquePortal {
  id: string;
  tipo_empaque_id: string;
  /** Precio del empaque para este cliente (precio_efectivo). */
  precio: number;
  tipo_empaque: { id: string; nombre: string; unidades: number };
}

export interface CategoriaPortal {
  id: string;
  nombre: string;
  /** Último tramo del nombre ("MATERIAL MEDICO QUIRURGICO / GUANTES" → "GUANTES"). */
  etiqueta: string;
  n?: number;
  disponibles?: number;
}

export interface ProductoPortal {
  id: string;
  sku: string | null;
  nombre: string;
  unidad: string | null;
  precio_base: number;
  precio_oferta: number | null;
  en_oferta: boolean;
  porcentaje_descuento: number | null;
  imagen_url: string | null;
  imagenes: string[];
  destacado: boolean;
  controla_stock: boolean;
  /** Unidades disponibles para vender (existencia − comprometido). */
  stock_disponible: number;
  impuesto_pct: number | null;
  impuesto_nombre: string | null;
  categoria_id: string | null;
  categoria: CategoriaPortal | null;
  favorito: boolean;
  /** Precio de la opción que se agrega por defecto (el empaque de menos unidades o la unidad). */
  precio: number;
  /** Unidades que trae esa opción. */
  precio_unidades: number;
  /** Empaques activos, de menos a más unidades. */
  producto_empaques: EmpaquePortal[];
  descripcion?: string | null;
}

export interface UltimaCompra {
  orden_id: string;
  numero: string;
  fecha: string;
  cantidad: number;
  tipo_empaque_id: string | null;
  empaque: string | null;
  unidades: number;
  precio_unitario: number | null;
  veces: number;
}

export interface FichaPortal {
  producto: ProductoPortal;
  ultima_compra: UltimaCompra | null;
  relacionados: ProductoPortal[];
}

export type OrdenCatalogo = "relevancia" | "nombre" | "precio_asc" | "precio_desc" | "disponibles";

export const ORDENES_CATALOGO: { valor: OrdenCatalogo; etiqueta: string }[] = [
  { valor: "relevancia", etiqueta: "Relevancia" },
  { valor: "nombre", etiqueta: "Nombre (A–Z)" },
  { valor: "precio_asc", etiqueta: "Menor precio" },
  { valor: "precio_desc", etiqueta: "Mayor precio" },
  { valor: "disponibles", etiqueta: "Disponibles primero" },
];

export interface ParametrosCatalogo {
  busqueda?: string;
  categoria?: string | null;
  orden?: OrdenCatalogo;
  limite?: number;
  offset?: number;
  soloDisponibles?: boolean;
  soloDestacados?: boolean;
  ids?: string[] | null;
}

export interface PaginaCatalogo {
  total: number;
  /** La búsqueda exacta no encontró nada y estos son resultados parecidos. */
  aproximado: boolean;
  productos: ProductoPortal[];
}

/** Unidades disponibles (Infinity si el producto no controla existencias). */
export const disponibleProducto = (p: Pick<ProductoPortal, "controla_stock" | "stock_disponible">) =>
  p.controla_stock === false ? Infinity : Number(p.stock_disponible ?? 0);

export async function pedirCatalogo(p: ParametrosCatalogo): Promise<PaginaCatalogo> {
  const { data, error } = await supabase.rpc("catalogo_portal", {
    p_busqueda: p.busqueda?.trim() || null,
    p_categoria: p.categoria || null,
    p_orden: p.orden ?? "relevancia",
    p_limite: p.limite ?? 24,
    p_offset: p.offset ?? 0,
    p_solo_disponibles: !!p.soloDisponibles,
    p_solo_destacados: !!p.soloDestacados,
    p_ids: p.ids ?? null,
  });
  if (error) throw error;
  const r = (data ?? {}) as { total?: number; aproximado?: boolean; productos?: ProductoPortal[] };
  return { total: Number(r.total ?? 0), aproximado: !!r.aproximado, productos: r.productos ?? [] };
}

const listas = new Map<string, EntradaListaCache>();

// Cachés en memoria del portal (lista por filtros, categorías y fichas). Son de un usuario en una empresa: al cambiar
// cualquiera de los dos se vacían, para no mezclar precios ni productos de GUDS y Quirutec.
let categoriasCache: CategoriaPortal[] | null = null;
const semillas = new Map<string, ProductoPortal>();
const fichas = new Map<string, { ficha: FichaPortal | null; t: number }>();
const VIGENCIA_FICHA = 60_000;
let alcance = "";
const alinearAlcance = (a: string) => {
  if (a === alcance) return;
  alcance = a;
  categoriasCache = null;
  semillas.clear();
  fichas.clear();
  listas.clear();
  enVuelo.clear();
};
/** Alinea las cachés con el usuario y la empresa activa (llamar arriba en cada pantalla que las use). */
export function useAlcanceCatalogo() {
  const { user } = useAuth();
  const { seleccion } = useEmpresa();
  alinearAlcance(`${user?.id ?? ""}|${seleccion}`);
}

/** Categorías con productos a la venta en la empresa activa. */
/** Categorías con productos a la venta en la empresa activa. `activo = false` pospone la consulta (p. ej. el inicio del
 *  portal, que las muestra debajo de su resumen y las pide cuando el resumen ya está en pantalla). */
export function useCategoriasPortal(activo = true) {
  useAlcanceCatalogo();
  const [lista, setLista] = useState<CategoriaPortal[] | null>(() => categoriasCache);
  useEffect(() => {
    if (!activo) return;
    let vivo = true;
    supabase.rpc("categorias_portal").then(({ data, error }) => {
      if (!vivo || error) return;
      const l = (data as CategoriaPortal[] | null) ?? [];
      categoriasCache = l;
      setLista(l);
    });
    return () => { vivo = false; };
  }, [activo]);
  return lista;
}

// ── Ficha: semilla (lo que ya se sabe desde la tarjeta) y caché corta para volver o reabrir sin esperar ──

/** Guarda lo que muestra la tarjeta para que la ficha se pinte al instante mientras llega el resto. */
export const sembrarFicha = (p: ProductoPortal) => { semillas.set(p.id, p); };
export const semillaFicha = (id: string) => fichas.get(id)?.ficha?.producto ?? semillas.get(id) ?? null;

const enVuelo = new Map<string, Promise<FichaPortal | null>>();
export async function pedirFicha(id: string, forzar = false): Promise<FichaPortal | null> {
  const c = fichas.get(id);
  if (!forzar && c && Date.now() - c.t < VIGENCIA_FICHA) return c.ficha;
  const pendiente = enVuelo.get(id);
  if (pendiente && !forzar) return pendiente;
  const a = alcance;
  const promesa = (async () => {
    const { data, error } = await supabase.rpc("producto_portal", { p_producto_id: id });
    if (error) throw error;
    const ficha = (data as FichaPortal | null) ?? null;
    if (a === alcance) fichas.set(id, { ficha, t: Date.now() });
    return ficha;
  })().finally(() => { if (enVuelo.get(id) === promesa) enVuelo.delete(id); });
  enVuelo.set(id, promesa);
  return promesa;
}
/** Adelanta la ficha (al pasar el cursor o enfocar la tarjeta). */
export const precargarFicha = (id: string) => { if (!fichas.has(id)) pedirFicha(id).catch(() => undefined); };
/** Olvida la ficha cacheada (p. ej. tras marcar favorito). */
export const invalidarFicha = (id: string) => { fichas.delete(id); };

// ── Lista con "cargar más": caché por filtros para volver de la ficha a la misma posición ──
export interface FiltrosCatalogo {
  busqueda: string;
  categoria: string | null;
  orden: OrdenCatalogo;
  soloDisponibles: boolean;
}

interface EntradaListaCache {
  productos: ProductoPortal[];
  total: number;
  aproximado: boolean;
  scrollY: number;
  t: number;
}
const VIGENCIA_LISTA = 10 * 60_000;
const LOTE_REFRESCO = 96;

export function useCatalogoPaginado(filtros: FiltrosCatalogo, porPagina = 24) {
  useAlcanceCatalogo();
  const clave = useMemo(() => JSON.stringify([filtros.busqueda.trim().toLowerCase(), filtros.categoria, filtros.orden, filtros.soloDisponibles]),
    [filtros.busqueda, filtros.categoria, filtros.orden, filtros.soloDisponibles]);
  const inicial = listas.get(clave);
  const vigente = inicial && Date.now() - inicial.t < VIGENCIA_LISTA ? inicial : undefined;

  const [productos, setProductos] = useState<ProductoPortal[] | null>(vigente?.productos ?? null);
  const [total, setTotal] = useState(vigente?.total ?? 0);
  const [aproximado, setAproximado] = useState(vigente?.aproximado ?? false);
  const [cargando, setCargando] = useState(!vigente);        // primera página de estos filtros
  const [cargandoMas, setCargandoMas] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claveMostrada, setClaveMostrada] = useState(vigente ? clave : "");
  /** Posición a la que volver: solo al montar con la lista en caché (p. ej. al volver de la ficha). */
  const [scrollRestaurar, setScrollRestaurar] = useState<number | null>(vigente ? vigente.scrollY : null);
  const peticion = useRef(0);
  const estado = useRef({ productos: productos ?? [], total, clave });
  estado.current = { productos: productos ?? [], total, clave };

  const guardar = useCallback((k: string, e: Partial<EntradaListaCache>) => {
    const prev = listas.get(k);
    listas.set(k, { productos: [], total: 0, aproximado: false, scrollY: 0, ...prev, ...e, t: Date.now() });
  }, []);

  const pedir = useCallback((offset: number, limite: number) =>
    pedirCatalogo({ busqueda: filtros.busqueda, categoria: filtros.categoria, orden: filtros.orden, soloDisponibles: filtros.soloDisponibles, offset, limite }),
  [filtros.busqueda, filtros.categoria, filtros.orden, filtros.soloDisponibles]);

  // Cambio de filtros: de la caché al instante (y se refresca en silencio) o primera página. La lista anterior queda a la
  // vista (atenuada) hasta que llega la nueva.
  useEffect(() => {
    const id = ++peticion.current;
    const c = listas.get(clave);
    const enCache = c && Date.now() - c.t < VIGENCIA_LISTA;
    if (enCache) {
      setProductos(c.productos); setTotal(c.total); setAproximado(c.aproximado); setClaveMostrada(clave);
      setCargando(false); setError(null);
    } else {
      setCargando(true); setError(null);
    }
    const n = enCache ? Math.max(c.productos.length, porPagina) : porPagina;
    const lotes = Array.from({ length: Math.ceil(n / LOTE_REFRESCO) }, (_, i) => pedir(i * LOTE_REFRESCO, Math.min(LOTE_REFRESCO, n - i * LOTE_REFRESCO)));
    Promise.all(lotes).then((paginas) => {
      if (id !== peticion.current) return;
      const lista = paginas.flatMap((p) => p.productos);
      setProductos(lista); setTotal(paginas[0].total); setAproximado(paginas[0].aproximado); setClaveMostrada(clave);
      setCargando(false);
      guardar(clave, { productos: lista, total: paginas[0].total, aproximado: paginas[0].aproximado });
    }).catch((e: Error) => {
      if (id !== peticion.current) return;
      setCargando(false);
      if (!enCache) setError(e.message || "No pudimos cargar el catálogo.");
    });
  }, [clave, pedir, porPagina, guardar]);

  const hayMas = productos != null && claveMostrada === clave && productos.length < total;

  const cargarMas = useCallback(async () => {
    const { productos: actuales, total: t, clave: k } = estado.current;
    if (cargandoMas || actuales.length >= t) return;
    const id = peticion.current;
    setCargandoMas(true);
    try {
      const p = await pedir(actuales.length, porPagina);
      if (id !== peticion.current) return;
      const ids = new Set(actuales.map((x) => x.id));
      const lista = [...actuales, ...p.productos.filter((x) => !ids.has(x.id))];
      setProductos(lista); setTotal(p.total);
      guardar(k, { productos: lista, total: p.total, aproximado: p.aproximado });
    } catch (e) {
      if (id === peticion.current) setError((e as Error).message || "No pudimos cargar más productos.");
    } finally {
      setCargandoMas(false);
    }
  }, [cargandoMas, pedir, porPagina, guardar]);

  // Refresco silencioso (realtime o poll): mismas filas ya cargadas, sin esqueleto ni salto de scroll
  const temporizador = useRef<ReturnType<typeof setTimeout>>();
  const refrescar = useCallback(() => {
    clearTimeout(temporizador.current);
    temporizador.current = setTimeout(async () => {
      const { productos: actuales, clave: k } = estado.current;
      if (!actuales.length) return;
      const id = peticion.current;
      try {
        const n = actuales.length;
        const paginas = await Promise.all(Array.from({ length: Math.ceil(n / LOTE_REFRESCO) },
          (_, i) => pedir(i * LOTE_REFRESCO, Math.min(LOTE_REFRESCO, n - i * LOTE_REFRESCO))));
        if (id !== peticion.current) return;
        const lista = paginas.flatMap((p) => p.productos);
        setProductos(lista); setTotal(paginas[0].total);
        guardar(k, { productos: lista, total: paginas[0].total });
      } catch { /* se reintenta en el próximo aviso */ }
    }, 1500);
  }, [pedir, guardar]);
  useEffect(() => () => clearTimeout(temporizador.current), []);
  useRealtimeRefetch("productos", refrescar);

  /** Cambia un producto de la lista (p. ej. favorito) sin recargar. */
  const actualizar = useCallback((id: string, cambio: Partial<ProductoPortal>) => {
    setProductos((prev) => {
      if (!prev) return prev;
      const lista = prev.map((p) => (p.id === id ? { ...p, ...cambio } : p));
      guardar(estado.current.clave, { productos: lista });
      return lista;
    });
  }, [guardar]);

  const guardarScroll = useCallback((y: number) => { if (listas.has(estado.current.clave)) guardar(estado.current.clave, { scrollY: y }); }, [guardar]);

  return {
    productos,
    total,
    aproximado,
    cargando,
    /** La lista visible es de otros filtros (se está buscando la nueva). */
    desactualizada: claveMostrada !== clave,
    cargandoMas,
    hayMas,
    error,
    cargarMas,
    reintentar: () => { setError(null); peticion.current++; listas.delete(clave); setClaveMostrada(""); setCargando(true); pedir(0, porPagina).then((p) => {
      setProductos(p.productos); setTotal(p.total); setAproximado(p.aproximado); setClaveMostrada(clave); setCargando(false);
      guardar(clave, { productos: p.productos, total: p.total, aproximado: p.aproximado });
    }).catch((e: Error) => { setCargando(false); setError(e.message); }); },
    actualizar,
    guardarScroll,
    scrollRestaurar,
    consumirScroll: () => setScrollRestaurar(null),
  };
}
