import { useEffect, useMemo, useState } from "react";
import { Info, Loader2, Minus, Plus, Search, Trash2 } from "lucide-react";
import { supabase, type TipoEmpaque } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ProductImage } from "@/components/portal/ProductImage";
import { SelectorEmpaqueDialog } from "@/components/portal/SelectorEmpaqueDialog";
import type { ProductoConEmpaques } from "@/hooks/useCarritoPortal";
import { esErrorNoEditable, pedidoEditable, type ResultadoEdicion } from "@/components/portal/pedidoEditable";

// Edición de un pedido que sigue «Por aprobar» (portal del cliente y del vendedor). El servidor
// (editar_pedido_pendiente) reemplaza las líneas y recalcula precios, IVA, envío y stock comprometido; aquí solo se arma
// el pedido nuevo y se muestra un total ESTIMADO con las mismas reglas. El padre pone el encabezado (Sheet o Dialog).

interface OrdenEditable {
  id: string; numero: string; cliente_id: string; empresa_id: string | null; vendedor_id: string | null;
  aprobacion: string | null; estado: string; odoo_id: number | null;
  descuento: number | null; envio: number | null; notas: string | null;
}

interface ItemDB {
  producto_id: string; cantidad: number; precio_unitario: number; tipo_empaque_id: string | null; unidades_por_empaque: number | null;
  producto: { nombre: string; imagen_url: string | null; imagen_emoji: string | null;
    stock_disponible: number | null; stock_actual: number | null; controla_stock: boolean | null } | null;
  tipo_empaque: { nombre: string; unidades: number } | null;
}

interface Linea {
  producto_id: string; tipo_empaque_id: string | null; nombre: string; empaque: string | null;
  unidades: number; precio: number; cantidad: number; imagen_url: string | null; imagen_emoji: string | null;
}

interface InfoStock { nombre: string; stock_disponible: number | null; stock_actual: number | null; controla_stock: boolean | null }

const clave = (productoId: string, tipoEmpaqueId: string | null) => productoId + "|" + (tipoEmpaqueId || "");
const firma = (ls: Linea[]) => ls.map((l) => `${clave(l.producto_id, l.tipo_empaque_id)}=${l.cantidad}`).sort().join(",");
const round2 = (n: number) => Math.round(n * 100) / 100;
const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

interface Props {
  ordenId: string;
  /** cliente: solo sus pedidos del portal, sin tocar el envío. vendedor: pedidos de sus clientes, con cargo de envío. */
  modo: "cliente" | "vendedor";
  onCancelar: () => void;
  onGuardado: (r: ResultadoEdicion) => void;
  /** El pedido ya no admite edición: el padre avisa y refresca la lista. */
  onYaNoEditable: (mensaje: string) => void;
  /** Clases del botón principal y de los «+» (el portal del vendedor usa esmeralda). */
  claseAcento?: string;
}

export const EditorPedidoPendiente = ({ ordenId, modo, onCancelar, onGuardado, onYaNoEditable, claseAcento = "" }: Props) => {
  const { formatPrice } = useCurrency();
  const { toast } = useToast();
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [orden, setOrden] = useState<OrdenEditable | null>(null);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [original, setOriginal] = useState({ lineas: "", notas: "", envio: "" });
  // Unidades que este pedido ya tiene apartadas: al guardar se liberan, así que cuentan como disponibles para él
  const [reservado, setReservado] = useState<Record<string, number>>({});
  const [info, setInfo] = useState<Record<string, InfoStock>>({});
  const [catalogo, setCatalogo] = useState<ProductoConEmpaques[]>([]);
  const [precioLista, setPrecioLista] = useState<Record<string, number>>({});
  const [cfg, setCfg] = useState({ iva: 16, envio: 50, envioGratis: 500 });
  const [notas, setNotas] = useState("");
  const [envio, setEnvio] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [empaqueProducto, setEmpaqueProducto] = useState<ProductoConEmpaques | null>(null);
  const [empaquePrecios, setEmpaquePrecios] = useState<Record<string, number>>({});
  const [guardando, setGuardando] = useState(false);

  const msgNoEditable = modo === "cliente"
    ? "Este pedido ya no se puede editar: GUDS ya lo aprobó o cambió de estado. Si necesitas cambiarlo, comunícate con tu ejecutivo de cuenta."
    : "Este pedido ya no se puede editar: ya fue aprobado o cambió de estado. Si hace falta cambiarlo, habla con administración.";

  useEffect(() => {
    let cancelado = false;
    (async () => {
      setCargando(true);
      setErrorCarga(null);
      const { data: o, error } = await supabase
        .from("ordenes")
        .select("id, numero, cliente_id, empresa_id, vendedor_id, aprobacion, estado, odoo_id, descuento, envio, notas")
        .eq("id", ordenId)
        .maybeSingle();
      if (cancelado) return;
      if (error || !o) { setErrorCarga(error?.message ?? "No encontramos el pedido."); setCargando(false); return; }
      const ord = o as OrdenEditable;
      if (!pedidoEditable(ord)) { onYaNoEditable(msgNoEditable); return; }

      // Catálogo de la misma empresa del pedido (no se mezclan productos de GUDS y Quirutec)
      let qProd = supabase
        .from("productos")
        .select("id, sku, nombre, imagen_url, imagen_emoji, precio_base, precio_oferta, en_oferta, stock_actual, stock_disponible, controla_stock, activo, empresa_id, producto_empaques(id, tipo_empaque_id, activo, tipo_empaque:tipos_empaque(*))")
        .eq("activo", true)
        .order("nombre");
      if (ord.empresa_id) qProd = qProd.or(`empresa_id.is.null,empresa_id.eq.${ord.empresa_id}`);

      const [iRes, pRes, cRes, cliRes] = await Promise.all([
        supabase
          .from("orden_items")
          .select("producto_id, cantidad, precio_unitario, tipo_empaque_id, unidades_por_empaque, producto:productos(nombre, imagen_url, imagen_emoji, stock_disponible, stock_actual, controla_stock), tipo_empaque:tipos_empaque(nombre, unidades)")
          .eq("orden_id", ordenId),
        qProd,
        supabase.from("configuracion").select("clave, valor").in("clave", ["iva_porcentaje", "costo_envio", "envio_gratis_minimo"]),
        supabase.from("clientes").select("lista_precios_id").eq("id", ord.cliente_id).maybeSingle(),
      ]);
      if (cancelado) return;
      if (iRes.error) { setErrorCarga(iRes.error.message); setCargando(false); return; }

      // Líneas actuales (mismo producto y empaque en una sola línea) y lo que el pedido tiene apartado
      const mapa = new Map<string, Linea>();
      const res: Record<string, number> = {};
      const inf: Record<string, InfoStock> = {};
      for (const it of (iRes.data ?? []) as unknown as ItemDB[]) {
        const unidades = Math.max(1, Number(it.unidades_por_empaque ?? it.tipo_empaque?.unidades ?? 1));
        res[it.producto_id] = (res[it.producto_id] ?? 0) + Number(it.cantidad) * unidades;
        if (it.producto) {
          inf[it.producto_id] = { nombre: it.producto.nombre, stock_disponible: it.producto.stock_disponible,
            stock_actual: it.producto.stock_actual, controla_stock: it.producto.controla_stock };
        }
        const k = clave(it.producto_id, it.tipo_empaque_id);
        const ex = mapa.get(k);
        if (ex) ex.cantidad += Number(it.cantidad);
        else mapa.set(k, {
          producto_id: it.producto_id, tipo_empaque_id: it.tipo_empaque_id, nombre: it.producto?.nombre ?? "Producto",
          empaque: it.tipo_empaque?.nombre ?? null, unidades, precio: Number(it.precio_unitario), cantidad: Number(it.cantidad),
          imagen_url: it.producto?.imagen_url ?? null, imagen_emoji: it.producto?.imagen_emoji ?? null,
        });
      }

      // Precio vigente de cada línea: el mismo que aplicará el servidor al guardar
      const lin = await Promise.all([...mapa.values()].map(async (l) => {
        const { data } = await supabase.rpc("precio_efectivo", {
          p_producto_id: l.producto_id, p_tipo_empaque_id: l.tipo_empaque_id, p_cliente_id: ord.cliente_id,
        });
        return data != null ? { ...l, precio: Number(data) } : l;
      }));

      // Solo presentaciones activas (igual que el pedido del vendedor)
      const cat = ((pRes.data ?? []) as unknown as ProductoConEmpaques[]).map((p) => ({
        ...p,
        producto_empaques: (p.producto_empaques ?? []).filter((pe) => (pe as { activo?: boolean }).activo !== false && pe.tipo_empaque),
      }));
      for (const p of cat) {
        inf[p.id] = { nombre: p.nombre, stock_disponible: p.stock_disponible ?? null, stock_actual: p.stock_actual, controla_stock: p.controla_stock ?? null };
      }

      let lista: Record<string, number> = {};
      const listaId = (cliRes.data as { lista_precios_id: string | null } | null)?.lista_precios_id;
      if (listaId) {
        const { data } = await supabase.from("precios_lista").select("producto_id, precio").eq("lista_precios_id", listaId);
        lista = Object.fromEntries(((data ?? []) as { producto_id: string; precio: number }[]).map((r) => [r.producto_id, Number(r.precio)]));
      }
      if (cancelado) return;

      const mapaCfg = Object.fromEntries(((cRes.data ?? []) as { clave: string; valor: unknown }[]).map((r) => [r.clave, Number(r.valor)]));
      setCfg({
        iva: Number.isFinite(mapaCfg.iva_porcentaje) ? mapaCfg.iva_porcentaje : 16,
        envio: Number.isFinite(mapaCfg.costo_envio) ? mapaCfg.costo_envio : 50,
        envioGratis: Number.isFinite(mapaCfg.envio_gratis_minimo) ? mapaCfg.envio_gratis_minimo : 500,
      });
      // En sus pedidos el vendedor ve el cargo que puso; en los del portal el campo arranca vacío (regla automática)
      const envioIni = modo === "vendedor" && ord.vendedor_id && Number(ord.envio ?? 0) > 0 ? String(round2(Number(ord.envio))) : "";
      setOrden(ord);
      setLineas(lin);
      setReservado(res);
      setInfo(inf);
      setCatalogo(cat);
      setPrecioLista(lista);
      setNotas(ord.notas ?? "");
      setEnvio(envioIni);
      setOriginal({ lineas: firma(lin), notas: ord.notas ?? "", envio: envioIni });
      setCargando(false);
    })();
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordenId, modo]);

  // ── Disponible (en unidades): existencia − comprometido + lo que este mismo pedido ya tenía apartado ──
  const disponible = (pid: string) => {
    const i = info[pid];
    if (!i || i.controla_stock === false) return Infinity;
    return Number(i.stock_disponible ?? i.stock_actual ?? 0) + (reservado[pid] ?? 0);
  };
  const unidadesEnPedido = (pid: string, exceptoClave?: string) =>
    lineas.filter((l) => l.producto_id === pid && clave(l.producto_id, l.tipo_empaque_id) !== exceptoClave)
      .reduce((s, l) => s + l.cantidad * l.unidades, 0);
  const avisoStock = (pid: string) => {
    const d = disponible(pid);
    toast({
      title: "Sin disponible suficiente",
      description: `De ${info[pid]?.nombre ?? "este producto"} hay ${Math.max(0, Math.floor(d))} unidades disponibles para este pedido.`,
      variant: "destructive",
    });
  };

  const fijarCantidad = (k: string, n: number) => {
    const l = lineas.find((x) => clave(x.producto_id, x.tipo_empaque_id) === k);
    if (!l || !Number.isFinite(n)) return;
    let cant = Math.max(1, Math.floor(n));
    if (cant > l.cantidad) {
      const max = Math.floor((disponible(l.producto_id) - unidadesEnPedido(l.producto_id, k)) / l.unidades);
      if (cant > max) {
        avisoStock(l.producto_id);
        if (max <= l.cantidad) return;
        cant = max;
      }
    }
    setLineas((prev) => prev.map((x) => (clave(x.producto_id, x.tipo_empaque_id) === k ? { ...x, cantidad: cant } : x)));
  };
  const quitar = (k: string) => setLineas((prev) => prev.filter((x) => clave(x.producto_id, x.tipo_empaque_id) !== k));

  const precioMostrado = (p: ProductoConEmpaques) =>
    precioLista[p.id] ?? (p.en_oferta && p.precio_oferta ? Number(p.precio_oferta) : Number(p.precio_base));

  const agregarConEmpaque = async (p: ProductoConEmpaques, emp: TipoEmpaque | null) => {
    if (!orden) return;
    const k = clave(p.id, emp?.id ?? null);
    const unidades = Math.max(1, Number(emp?.unidades ?? 1));
    if (unidadesEnPedido(p.id) + unidades > disponible(p.id)) { avisoStock(p.id); setEmpaqueProducto(null); return; }
    const incrementar = (prev: Linea[]) => prev.map((x) => (clave(x.producto_id, x.tipo_empaque_id) === k ? { ...x, cantidad: x.cantidad + 1 } : x));
    if (lineas.some((x) => clave(x.producto_id, x.tipo_empaque_id) === k)) {
      setLineas(incrementar);
    } else {
      const { data } = await supabase.rpc("precio_efectivo", {
        p_producto_id: p.id, p_tipo_empaque_id: emp?.id ?? null, p_cliente_id: orden.cliente_id,
      });
      const nueva: Linea = {
        producto_id: p.id, tipo_empaque_id: emp?.id ?? null, nombre: p.nombre, empaque: emp?.nombre ?? null, unidades,
        precio: data != null ? Number(data) : precioMostrado(p), cantidad: 1, imagen_url: p.imagen_url, imagen_emoji: p.imagen_emoji,
      };
      setLineas((prev) => (prev.some((x) => clave(x.producto_id, x.tipo_empaque_id) === k) ? incrementar(prev) : [...prev, nueva]));
    }
    setEmpaqueProducto(null);
    toast({ title: "Agregado al pedido", description: `${p.nombre}${emp ? ` (${emp.nombre})` : ""}` });
  };

  // Con varias presentaciones se pide elegir (mismo diálogo del catálogo); con una o ninguna se agrega directo
  const agregar = async (p: ProductoConEmpaques) => {
    if (!orden) return;
    const emps = p.producto_empaques ?? [];
    if (emps.length > 1) {
      setEmpaqueProducto(p);
      setEmpaquePrecios({});
      const entries = await Promise.all(emps.map(async (pe) => {
        const { data } = await supabase.rpc("precio_efectivo", {
          p_producto_id: p.id, p_tipo_empaque_id: pe.tipo_empaque_id, p_cliente_id: orden.cliente_id,
        });
        return [pe.tipo_empaque_id, data != null ? Number(data) : precioMostrado(p)] as const;
      }));
      setEmpaquePrecios(Object.fromEntries(entries));
      return;
    }
    await agregarConEmpaque(p, emps[0]?.tipo_empaque ?? null);
  };

  const resultados = useMemo(() => {
    const t = normalizar(busqueda.trim());
    if (!t) return [];
    return catalogo.filter((p) => normalizar(p.nombre).includes(t) || normalizar(p.sku ?? "").includes(t)).slice(0, 30);
  }, [busqueda, catalogo]);

  // ── Total estimado con las reglas del servidor ──
  const subtotal = lineas.reduce((s, l) => s + l.precio * l.cantidad, 0);
  const descuento = Math.min(Number(orden?.descuento ?? 0), subtotal);   // un cupón fijo se conserva
  const base = subtotal - descuento;
  const impuesto = round2(base * (cfg.iva / 100));
  const envioNum = envio.trim() === "" ? null : Number(envio.replace(",", "."));
  const envioInvalido = envioNum != null && (!Number.isFinite(envioNum) || envioNum < 0);
  const reglaPortal = base >= cfg.envioGratis ? 0 : cfg.envio;
  const envioEstimado = modo === "vendedor" && orden?.vendedor_id
    ? (envioInvalido ? 0 : envioNum ?? 0)                                  // pedido del vendedor: solo el cargo que él indique
    : modo === "vendedor" && envioNum != null && !envioInvalido ? envioNum  // el vendedor fija el envío de un pedido del portal
    : reglaPortal;                                                         // regla del portal
  const total = base + impuesto + round2(envioEstimado);

  const cambiado = firma(lineas) !== original.lineas || notas.trim() !== original.notas.trim()
    || (modo === "vendedor" && envio.trim() !== original.envio);

  const guardar = async () => {
    if (!orden || lineas.length === 0 || envioInvalido) return;
    setGuardando(true);
    const payload: Record<string, unknown> = {
      p_orden_id: orden.id,
      p_items: lineas.map((l) => ({ producto_id: l.producto_id, cantidad: l.cantidad, tipo_empaque_id: l.tipo_empaque_id })),
      // null = sin cambios (el servidor conserva las notas)
      p_notas: notas.trim() === original.notas.trim() ? null : notas.trim(),
    };
    // Solo el vendedor manda el envío. En sus pedidos, vacío = sin envío; en los del portal, vacío = regla del portal.
    if (modo === "vendedor") payload.p_envio = envioNum != null ? round2(envioNum) : orden.vendedor_id ? 0 : null;
    const { data, error } = await supabase.rpc("editar_pedido_pendiente", payload);
    setGuardando(false);
    if (error) {
      if (esErrorNoEditable(error.message)) { onYaNoEditable(msgNoEditable); return; }
      toast({
        title: /No puedes editar/i.test(error.message) ? "No puedes editar este pedido" : "No se pudieron guardar los cambios",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    const row = (Array.isArray(data) ? data[0] : data) as ResultadoEdicion | null;
    onGuardado({ orden_id: row?.orden_id ?? orden.id, numero: row?.numero ?? orden.numero, total: Number(row?.total ?? total) });
  };

  if (cargando) {
    return (
      <div className="flex flex-1 items-center justify-center py-12" data-testid="editor-pedido-cargando">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (errorCarga || !orden) {
    return (
      <div className="flex-1 space-y-3 p-4 text-sm">
        <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-red-900">No se pudo abrir el pedido para editarlo. {errorCarga}</p>
        <Button variant="outline" className="h-11 w-full" onClick={onCancelar}>Volver</Button>
      </div>
    );
  }

  const acentoPlus = claseAcento || "bg-primary text-primary-foreground";

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="editor-pedido">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4">
        {/* Líneas del pedido */}
        <section>
          <h3 className="mb-2 font-semibold">Productos ({lineas.length})</h3>
          {lineas.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
              El pedido debe tener al menos un producto.{" "}
              {modo === "cliente" ? "Si quieres anularlo, comunícate con tu ejecutivo de cuenta." : "Para anularlo, pídelo a administración."}
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {lineas.map((l) => {
                const k = clave(l.producto_id, l.tipo_empaque_id);
                return (
                  <li key={k} className="space-y-2 p-3" data-testid="linea-edicion">
                    <div className="flex items-center gap-3">
                      <ProductImage imageUrl={l.imagen_url} emoji={l.imagen_emoji} alt={l.nombre} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-sm font-medium leading-snug">{l.nombre}</p>
                        <p className="text-xs text-muted-foreground">
                          {l.empaque ? `${l.empaque}${l.unidades > 1 ? ` (${l.unidades} u.)` : ""} · ` : ""}{formatPrice(l.precio)} c/u
                        </p>
                      </div>
                      <p className="shrink-0 text-sm font-semibold tabular-nums">{formatPrice(l.precio * l.cantidad)}</p>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <Button type="button" variant="ghost" size="sm" className="h-11 gap-1.5 px-2 text-destructive hover:text-destructive sm:h-9"
                        onClick={() => quitar(k)} aria-label={`Quitar ${l.nombre}`}>
                        <Trash2 className="h-4 w-4" />Quitar
                      </Button>
                      <div className="flex items-center gap-1">
                        <Button type="button" variant="outline" size="icon" className="h-11 w-11 sm:h-9 sm:w-9" onClick={() => fijarCantidad(k, l.cantidad - 1)}
                          disabled={l.cantidad <= 1} aria-label={`Restar una unidad de ${l.nombre}`}>
                          <Minus className="h-4 w-4" />
                        </Button>
                        <CantidadInput valor={l.cantidad} onCambio={(n) => fijarCantidad(k, n)} etiqueta={`Cantidad de ${l.nombre}`} />
                        <Button type="button" variant="outline" size="icon" className="h-11 w-11 sm:h-9 sm:w-9" onClick={() => fijarCantidad(k, l.cantidad + 1)}
                          aria-label={`Sumar una unidad de ${l.nombre}`}>
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Agregar productos del catálogo */}
        <section>
          {!buscando ? (
            <Button type="button" variant="outline" className="h-11 w-full gap-2" onClick={() => setBuscando(true)} data-testid="agregar-productos">
              <Plus className="h-4 w-4" />Agregar productos
            </Button>
          ) : (
            <div className="space-y-2 rounded-xl border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="buscar-producto-edicion">Agregar productos</Label>
                <Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => { setBuscando(false); setBusqueda(""); }}>Listo</Button>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="buscar-producto-edicion" type="search" autoFocus value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
                  placeholder="Buscar por nombre o código" className="h-11 pl-9 text-base sm:text-sm" />
              </div>
              {busqueda.trim() === "" ? (
                <p className="text-xs text-muted-foreground">Escribe el nombre o el código del producto.</p>
              ) : resultados.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin resultados para «{busqueda.trim()}».</p>
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border" data-testid="resultados-busqueda">
                  {resultados.map((p) => {
                    const libre = disponible(p.id) - unidadesEnPedido(p.id);
                    const agotado = libre < 1;
                    const enPedido = lineas.filter((l) => l.producto_id === p.id).reduce((s, l) => s + l.cantidad, 0);
                    const nEmp = p.producto_empaques?.length ?? 0;
                    return (
                      <li key={p.id}>
                        <button type="button" onClick={() => agregar(p)} disabled={agotado}
                          className="flex min-h-[56px] w-full items-center gap-3 p-2 text-left transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50">
                          <ProductImage imageUrl={p.imagen_url} emoji={p.imagen_emoji} alt={p.nombre} size="sm" />
                          <div className="min-w-0 flex-1">
                            <p className="line-clamp-2 text-sm font-medium leading-snug">{p.nombre}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatPrice(precioMostrado(p))}
                              {nEmp > 1 ? ` · ${nEmp} presentaciones` : ""}
                              {Number.isFinite(libre) ? (agotado ? " · Sin disponible" : ` · ${Math.floor(libre).toLocaleString("es-VE")} disp.`) : ""}
                              {enPedido > 0 ? ` · ${enPedido} en el pedido` : ""}
                            </p>
                          </div>
                          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${acentoPlus}`} aria-hidden="true">
                            <Plus className="h-4 w-4" />
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </section>

        {/* Notas */}
        <section className="space-y-1.5">
          <Label htmlFor="notas-edicion">Notas del pedido</Label>
          <Textarea id="notas-edicion" value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={500} rows={3}
            placeholder={modo === "cliente" ? "Indicaciones para GUDS (opcional)" : "Indicaciones para administración (opcional)"} className="text-base sm:text-sm" />
        </section>

        {/* Cargo de envío: solo el vendedor lo estipula */}
        {modo === "vendedor" && (
          <section className="space-y-1.5">
            <Label htmlFor="envio-edicion">Cargo de envío (USD)</Label>
            <Input id="envio-edicion" type="number" inputMode="decimal" min={0} step="0.01" value={envio} onChange={(e) => setEnvio(e.target.value)}
              placeholder={orden.vendedor_id ? "Sin envío" : "Automático"} className="h-11 sm:h-10" data-testid="envio-edicion" />
            <p className="text-xs text-muted-foreground">
              {orden.vendedor_id
                ? "Opcional. Vacío = sin cargo de envío."
                : `Pedido hecho por el cliente en el portal: vacío = regla del portal (${formatPrice(cfg.envio)}, gratis desde ${formatPrice(cfg.envioGratis)}).`}
            </p>
            {envioInvalido && <p className="text-xs text-destructive">Indica un monto válido (0 o más).</p>}
          </section>
        )}

        {/* Total estimado */}
        <section className="space-y-2 rounded-xl bg-muted p-4" data-testid="totales-edicion">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="tabular-nums">{formatPrice(subtotal)}</span>
          </div>
          {descuento > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Descuento</span>
              <span className="tabular-nums">-{formatPrice(descuento)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">IVA ({cfg.iva}%)</span>
            <span className="tabular-nums">{formatPrice(impuesto)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Envío</span>
            <span className="tabular-nums">
              {envioEstimado > 0 ? formatPrice(envioEstimado) : modo === "vendedor" && orden.vendedor_id ? "Sin envío" : "Gratis"}
            </span>
          </div>
          <div className="flex justify-between border-t border-border pt-2 font-semibold">
            <span>Total estimado</span>
            <span className="tabular-nums" data-testid="total-estimado">{formatPrice(total)}</span>
          </div>
          <p className="flex gap-2 pt-1 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Es un estimado. El total final lo calcula GUDS al guardar, con los precios vigentes, el IVA y el envío.
          </p>
        </section>
      </div>

      {/* Pie fijo */}
      <div className="flex gap-2 border-t border-border bg-background px-4 py-3">
        <Button type="button" variant="outline" className="h-11 flex-1" onClick={onCancelar} disabled={guardando}>Cancelar</Button>
        <Button type="button" className={`h-11 flex-1 ${claseAcento}`} onClick={guardar}
          disabled={guardando || !cambiado || lineas.length === 0 || envioInvalido} data-testid="guardar-edicion">
          {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : cambiado ? "Guardar cambios" : "Sin cambios"}
        </Button>
      </div>

      <SelectorEmpaqueDialog
        producto={empaqueProducto}
        precios={empaquePrecios}
        onElegir={(p, e) => agregarConEmpaque(p, e)}
        onCerrar={() => setEmpaqueProducto(null)}
      />
    </div>
  );
};

// Cantidad escrita a mano (pedidos B2B de muchas unidades): se aplica al salir del campo o con Enter
const CantidadInput = ({ valor, onCambio, etiqueta }: { valor: number; onCambio: (n: number) => void; etiqueta: string }) => {
  const [texto, setTexto] = useState(String(valor));
  useEffect(() => { setTexto(String(valor)); }, [valor]);
  const aplicar = () => {
    const n = parseInt(texto, 10);
    if (!Number.isFinite(n) || n < 1 || n === valor) { setTexto(String(valor)); return; }
    onCambio(n);
    setTexto(String(valor));   // si el cambio se rechaza (stock), vuelve al valor vigente; si se aplica, el efecto lo actualiza
  };
  return (
    <Input
      type="number"
      inputMode="numeric"
      min={1}
      step={1}
      value={texto}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={aplicar}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      aria-label={etiqueta}
      className="h-11 w-16 px-1 text-center text-base tabular-nums sm:h-9 sm:text-sm"
    />
  );
};
