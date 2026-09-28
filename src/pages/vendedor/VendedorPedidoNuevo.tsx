import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeftRight, Copy, History, Loader2, Package, Repeat, Search, ShoppingCart, User, X, AlertTriangle, ChevronRight, FileText,
} from "lucide-react";
import { VendedorLayout, BarraSuperiorMovil } from "@/components/vendedor/VendedorLayout";
import { TarjetaProductoVenta, SelectorCantidad } from "@/components/vendedor/TarjetaProductoVenta";
import { ElegirClienteVendedor } from "@/components/vendedor/ElegirClienteVendedor";
import { useCarteraVendedor } from "@/components/vendedor/cartera";
import { useEsMovil } from "@/components/vendedor/comprobantes";
import {
  borrarBorrador, guardarBorrador, leerBorrador, type BorradorPedido, type LineaBorrador,
} from "@/components/vendedor/borrador";
import {
  opcionesDe, nuevaClave, fechaCorta, type CategoriaVendedor, type ClienteCartera, type OpcionVenta, type ProductoVendedor, type UltimoPedido,
} from "@/components/vendedor/tipos";
import { ResumenCotizacion } from "@/components/portal/ResumenCotizacion";
import { EtiquetaIva } from "@/components/portal/EtiquetaIva";
import { useCotizacion, claveLinea } from "@/hooks/useCotizacion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { useToast } from "@/hooks/use-toast";

// Venta rápida del vendedor (plan de portales §5, V2): pantalla completa en el teléfono y panel amplio en escritorio.
// Catálogo buscable del servidor con el precio del cliente (catalogo_vendedor), "Lo que compra este cliente"
// (compras_cliente_vendedor), total exacto del servidor (cotizar_pedido), borrador por cliente en el navegador y envío
// idempotente (crear_orden_vendedor con la clave del borrador: un doble toque o un reintento no crean dos pedidos).

const NOTA_VENDEDOR = "Pedido tomado por vendedor";
const METODOS: { valor: string; etiqueta: string }[] = [
  { valor: "transferencia", etiqueta: "Transferencia" },
  { valor: "pago_movil", etiqueta: "Pago móvil" },
  { valor: "efectivo", etiqueta: "Efectivo" },
  { valor: "tarjeta", etiqueta: "Tarjeta" },
  { valor: "credito", etiqueta: "Crédito" },
];
const POR_PAGINA = 30;

const borradorVacio = (c: ClienteCartera): BorradorPedido => ({
  clave: nuevaClave(), cliente_id: c.id, cliente_nombre: c.nombre_negocio, lineas: [], notas: "", envio: "", metodo: "transferencia",
  corrige: null, actualizado: new Date().toISOString(),
});
const claveDe = (l: { producto_id: string; tipo_empaque_id: string | null }) => claveLinea(l.producto_id, l.tipo_empaque_id);

const VendedorPedidoNuevo = () => {
  const [params, setParams] = useSearchParams();
  const clienteId = params.get("cliente");
  const duplicarId = params.get("duplicar");
  const { user } = useAuth();
  const { toast } = useToast();
  const { clientes, cargando } = useCarteraVendedor();
  const { empresas, seleccion, cambiarEmpresa } = useEmpresa();
  const [clienteDuplicado, setClienteDuplicado] = useState<string | null>(null);

  // "Duplicar y corregir" sin cliente en la URL: se toma el cliente del pedido
  useEffect(() => {
    if (!duplicarId || clienteId) return;
    (async () => {
      const { data } = await supabase.from("ordenes").select("cliente_id").eq("id", duplicarId).maybeSingle();
      const c = (data as { cliente_id: string } | null)?.cliente_id;
      if (c) setParams((p) => { const n = new URLSearchParams(p); n.set("cliente", c); return n; }, { replace: true });
      else { setClienteDuplicado("no"); toast({ title: "No se pudo duplicar", description: "No encontramos ese pedido en tu cartera.", variant: "destructive" }); }
    })();
  }, [duplicarId, clienteId, setParams, toast]);

  const cliente = clienteId ? clientes.find((c) => c.id === clienteId) : undefined;
  // El pedido se crea en la empresa del cliente: si la activa es otra (o "Ambas"), se cambia (la pantalla se vuelve a montar
  // con el mismo cliente en la URL y el borrador intacto)
  const empresaCliente = cliente?.empresa_id ?? null;
  const cambiando = !!empresaCliente && seleccion !== empresaCliente && empresas.some((e) => e.id === empresaCliente);
  useEffect(() => { if (cambiando && empresaCliente) cambiarEmpresa(empresaCliente); }, [cambiando, empresaCliente, cambiarEmpresa]);

  const elegir = (id: string | null) => setParams((p) => {
    const n = new URLSearchParams(p);
    if (id) n.set("cliente", id); else { n.delete("cliente"); n.delete("duplicar"); }
    return n;
  });

  if (!clienteId || clienteDuplicado === "no") {
    return <ElegirClienteVendedor titulo="Nuevo pedido" pregunta="¿Para qué cliente es el pedido?" volverA="/vendedor/pedidos" clientes={clientes}
      cargando={cargando || (!!duplicarId && !clienteDuplicado && !clienteId)} usuarioId={user?.id} onElegir={elegir} conBorradores />;
  }
  if (cargando || cambiando) {
    return (
      <VendedorLayout title="Nuevo pedido" pantallaCompletaMovil>
        <BarraSuperiorMovil titulo="Nuevo pedido" volverA="/vendedor/pedidos" />
        <div className="flex flex-col items-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
          {cambiando ? `Cambiando a ${empresas.find((e) => e.id === empresaCliente)?.nombre_corto ?? "la empresa del cliente"}…` : null}
        </div>
      </VendedorLayout>
    );
  }
  if (!cliente) {
    return (
      <VendedorLayout title="Nuevo pedido" pantallaCompletaMovil>
        <BarraSuperiorMovil titulo="Nuevo pedido" onVolver={() => elegir(null)} />
        <div className="mx-auto max-w-md space-y-3 p-4 py-10 text-center" data-testid="cliente-no-encontrado">
          <User className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="font-semibold">Este cliente no está en tu cartera activa</p>
          <p className="text-sm text-muted-foreground">Puede ser de otra empresa o estar inactivo. Elige otro cliente.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" onClick={() => elegir(null)}>Elegir cliente</Button>
            {empresas.filter((e) => e.id !== seleccion).map((e) => (
              <Button key={e.id} variant="outline" onClick={() => cambiarEmpresa(e.id)}>Buscar en {e.nombre_corto}</Button>
            ))}
          </div>
        </div>
      </VendedorLayout>
    );
  }
  return <TomarPedido key={cliente.id} cliente={cliente} usuarioId={user?.id ?? ""} duplicarId={duplicarId} onCambiarCliente={() => elegir(null)}
    onDuplicado={() => setParams((p) => { const n = new URLSearchParams(p); n.delete("duplicar"); return n; }, { replace: true })} />;
};

// ── Paso 2: tomar el pedido ─────────────────────────────────────────────────────────────────────────────────────────────
function TomarPedido({ cliente, usuarioId, duplicarId, onCambiarCliente, onDuplicado }: {
  cliente: ClienteCartera; usuarioId: string; duplicarId: string | null; onCambiarCliente: () => void; onDuplicado: () => void;
}) {
  const { formatPrice } = useCurrency();
  const { toast } = useToast();
  const navigate = useNavigate();
  const esMovil = useEsMovil();

  // Borrador (se guarda en cada cambio)
  const [borrador, setBorrador] = useState<BorradorPedido>(() => leerBorrador(usuarioId, cliente.id) ?? borradorVacio(cliente));
  const restaurado = useRef(borrador.lineas.length > 0);
  useEffect(() => { if (usuarioId) guardarBorrador(usuarioId, borrador); }, [usuarioId, borrador]);
  const actualizar = useCallback((f: (b: BorradorPedido) => BorradorPedido) => setBorrador((b) => f(b)), []);

  // Catálogo
  const [tab, setTab] = useState<"catalogo" | "compra">("catalogo");
  const [q, setQ] = useState("");
  const [qDeb, setQDeb] = useState("");
  const [categoria, setCategoria] = useState<string | null>(null);
  const [soloDisp, setSoloDisp] = useState(false);
  const [categorias, setCategorias] = useState<CategoriaVendedor[]>([]);
  const [productos, setProductos] = useState<ProductoVendedor[]>([]);
  const [total, setTotal] = useState(0);
  const [aproximado, setAproximado] = useState(false);
  const [cargandoCat, setCargandoCat] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [errorCat, setErrorCat] = useState<string | null>(null);
  const [compras, setCompras] = useState<{ frecuentes: ProductoVendedor[]; ultimo_pedido: UltimoPedido | null } | null>(null);
  const [aviso, setAviso] = useState<{ titulo: string; motivo?: string | null; lineas: string[] } | null>(null);
  const [revisar, setRevisar] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const enviandoRef = useRef(false);
  const busqRef = useRef(0);

  useEffect(() => { const t = setTimeout(() => setQDeb(q.trim()), 250); return () => clearTimeout(t); }, [q]);

  useEffect(() => {
    supabase.rpc("categorias_vendedor", { p_cliente_id: cliente.id }).then(({ data }) => setCategorias((data as CategoriaVendedor[] | null) ?? []));
    supabase.rpc("compras_cliente_vendedor", { p_cliente_id: cliente.id, p_limite: 24 }).then(({ data }) =>
      setCompras((data as { frecuentes: ProductoVendedor[]; ultimo_pedido: UltimoPedido | null } | null) ?? { frecuentes: [], ultimo_pedido: null }));
  }, [cliente.id]);

  const traer = useCallback(async (offset: number) => {
    const id = ++busqRef.current;
    if (offset === 0) setCargandoCat(true); else setCargandoMas(true);
    const { data, error } = await supabase.rpc("catalogo_vendedor", {
      p_cliente_id: cliente.id, p_busqueda: qDeb || null, p_categoria: categoria, p_limite: POR_PAGINA, p_offset: offset, p_solo_disponibles: soloDisp,
    });
    if (id !== busqRef.current) return;
    if (error) setErrorCat(error.message);
    else {
      const d = data as { total: number; aproximado: boolean; productos: ProductoVendedor[] };
      setErrorCat(null);
      setTotal(d.total);
      setAproximado(d.aproximado);
      setProductos((prev) => (offset === 0 ? d.productos : [...prev, ...d.productos]));
    }
    setCargandoCat(false); setCargandoMas(false);
  }, [cliente.id, qDeb, categoria, soloDisp]);
  useEffect(() => { traer(0); }, [traer]);

  // Productos por id (para refrescar un borrador guardado, repetir el último pedido o duplicar uno)
  const productosPorId = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return new Map<string, ProductoVendedor>();
    const { data } = await supabase.rpc("catalogo_vendedor", { p_cliente_id: cliente.id, p_ids: ids, p_limite: 100 });
    return new Map(((data as { productos: ProductoVendedor[] } | null)?.productos ?? []).map((p) => [p.id, p]));
  }, [cliente.id]);

  // ── Líneas ──
  const lineas = borrador.lineas;
  const unidadesEnOtras = (productoId: string, tipo: string | null) =>
    lineas.filter((l) => l.producto_id === productoId && l.tipo_empaque_id !== tipo).reduce((s, l) => s + l.cantidad * l.unidades, 0);
  const maxPara = (controla: boolean, disponible: number, productoId: string, o: { tipo_empaque_id: string | null; unidades: number }) =>
    !controla ? 99999 : Math.max(0, Math.floor((Math.floor(disponible) - unidadesEnOtras(productoId, o.tipo_empaque_id)) / Math.max(1, o.unidades)));
  const cantidadDe = (productoId: string, tipo: string | null) => lineas.find((l) => l.producto_id === productoId && l.tipo_empaque_id === tipo)?.cantidad ?? 0;

  const lineaDesde = (p: ProductoVendedor, o: OpcionVenta, cantidad: number): LineaBorrador => ({
    producto_id: p.id, tipo_empaque_id: o.tipo_empaque_id, nombre: p.nombre, sku: p.sku, empaque: o.nombre, unidades: o.unidades,
    precio: o.precio, cantidad, impuesto_pct: p.impuesto_pct, impuesto_nombre: p.impuesto_nombre, controla_stock: p.controla_stock,
    disponible: Number(p.stock_disponible) || 0,
  });

  const fijarCantidad = (p: ProductoVendedor, o: OpcionVenta, n: number) => actualizar((b) => {
    const k = claveDe({ producto_id: p.id, tipo_empaque_id: o.tipo_empaque_id });
    const existe = b.lineas.some((l) => claveDe(l) === k);
    if (n <= 0) return { ...b, lineas: b.lineas.filter((l) => claveDe(l) !== k) };
    if (existe) return { ...b, lineas: b.lineas.map((l) => (claveDe(l) === k ? { ...l, cantidad: n, precio: o.precio, disponible: Number(p.stock_disponible) || 0 } : l)) };
    return { ...b, lineas: [...b.lineas, lineaDesde(p, o, n)] };
  });
  const cambiarLinea = (l: LineaBorrador, n: number) => actualizar((b) => ({
    ...b, lineas: n <= 0 ? b.lineas.filter((x) => claveDe(x) !== claveDe(l)) : b.lineas.map((x) => (claveDe(x) === claveDe(l) ? { ...x, cantidad: n } : x)),
  }));

  // Agrega varias líneas (repetir / duplicar) respetando el disponible; devuelve los avisos
  const agregarVarias = (items: { p: ProductoVendedor; o: OpcionVenta; cantidad: number }[], base: LineaBorrador[]) => {
    const avisos: string[] = [];
    const nuevas = [...base];
    for (const { p, o, cantidad } of items) {
      const usadas = nuevas.filter((l) => l.producto_id === p.id && l.tipo_empaque_id !== o.tipo_empaque_id).reduce((s, l) => s + l.cantidad * l.unidades, 0);
      const max = !p.controla_stock ? 99999 : Math.floor((Math.floor(Number(p.stock_disponible) || 0) - usadas) / o.unidades);
      if (max <= 0) { avisos.push(`${p.nombre}: sin disponible, no se agregó.`); continue; }
      const k = claveDe({ producto_id: p.id, tipo_empaque_id: o.tipo_empaque_id });
      const previa = nuevas.find((l) => claveDe(l) === k)?.cantidad ?? 0;
      let n = previa + cantidad;
      if (n > max) { avisos.push(`${p.nombre}: se ajustó a ${max} (disponible).`); n = max; }
      const i = nuevas.findIndex((l) => claveDe(l) === k);
      if (i >= 0) nuevas[i] = { ...nuevas[i], cantidad: n, precio: o.precio };
      else nuevas.push(lineaDesde(p, o, n));
    }
    return { nuevas, avisos };
  };
  const opcionPara = (p: ProductoVendedor, tipo: string | null, unidades: number, cantidad: number) => {
    const ops = opcionesDe(p);
    const exacta = ops.find((o) => o.tipo_empaque_id === tipo);
    if (exacta) return { o: exacta, cantidad: Math.max(1, Math.floor(cantidad)) };
    const o = ops[0];
    return { o, cantidad: Math.max(1, Math.round(unidades / o.unidades)) };
  };

  // Borrador restaurado: precios y disponible de hoy; se quitan los productos que ya no se venden
  useEffect(() => {
    if (!restaurado.current || duplicarId) return;
    restaurado.current = false;
    (async () => {
      const mapa = await productosPorId([...new Set(borrador.lineas.map((l) => l.producto_id))]);
      const fuera: string[] = [];
      actualizar((b) => ({
        ...b,
        lineas: b.lineas.flatMap((l) => {
          const p = mapa.get(l.producto_id);
          const o = p && opcionesDe(p).find((x) => x.tipo_empaque_id === l.tipo_empaque_id);
          if (!p || !o) { fuera.push(l.nombre); return []; }
          return [{ ...l, precio: o.precio, disponible: Number(p.stock_disponible) || 0, controla_stock: p.controla_stock, impuesto_pct: p.impuesto_pct }];
        }),
      }));
      toast({ title: "Borrador recuperado", description: `Tenías un pedido sin enviar para ${cliente.nombre_negocio}.${fuera.length ? ` Se quitaron ${fuera.length} producto(s) que ya no se venden.` : ""}` });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Duplicar y corregir": mismas líneas (precio y disponible de hoy), método y envío del pedido original
  useEffect(() => {
    if (!duplicarId) return;
    (async () => {
      const { data } = await supabase.from("ordenes")
        .select("id, numero, cliente_id, metodo_pago, envio, aprobacion, rechazo_motivo, items:orden_items(producto_id, tipo_empaque_id, cantidad, unidades_por_empaque, nombre_producto, producto:productos(nombre))")
        .eq("id", duplicarId).maybeSingle();
      onDuplicado();
      const o = data as unknown as {
        numero: string; cliente_id: string; metodo_pago: string | null; envio: number | null; aprobacion: string | null; rechazo_motivo: string | null;
        items: { producto_id: string; tipo_empaque_id: string | null; cantidad: number; unidades_por_empaque: number | null; nombre_producto: string | null; producto: { nombre: string } | null }[] | null;
      } | null;
      if (!o || o.cliente_id !== cliente.id) { toast({ title: "No se pudo duplicar", description: "No encontramos ese pedido en tu cartera.", variant: "destructive" }); return; }
      const items = o.items ?? [];
      const mapa = await productosPorId([...new Set(items.map((i) => i.producto_id))]);
      const avisos: string[] = [];
      const aAgregar: { p: ProductoVendedor; o: OpcionVenta; cantidad: number }[] = [];
      for (const it of items) {
        const p = mapa.get(it.producto_id);
        if (!p) { avisos.push(`${it.producto?.nombre || it.nombre_producto || "Producto"}: ya no está en el catálogo.`); continue; }
        const x = opcionPara(p, it.tipo_empaque_id, Number(it.cantidad) * Math.max(1, Number(it.unidades_por_empaque) || 1), Number(it.cantidad));
        aAgregar.push({ p, o: x.o, cantidad: x.cantidad });
      }
      const { nuevas, avisos: av2 } = agregarVarias(aAgregar, []);
      setBorrador({
        ...borradorVacio(cliente), lineas: nuevas, corrige: o.numero,
        metodo: o.metodo_pago && METODOS.some((m) => m.valor === o.metodo_pago) ? o.metodo_pago : "transferencia",
        envio: Number(o.envio || 0) > 0 ? String(Number(o.envio)) : "",
      });
      setAviso({ titulo: `Copia de ${o.numero} con los precios de hoy. Revisa y corrige antes de enviar.`, motivo: o.aprobacion === "rechazada" ? o.rechazo_motivo : null, lineas: [...avisos, ...av2] });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duplicarId]);

  const repetirUltimo = async () => {
    const u = compras?.ultimo_pedido;
    if (!u) return;
    const vendibles = u.items.filter((i) => i.a_la_venta);
    const mapa = await productosPorId([...new Set(vendibles.map((i) => i.producto_id))]);
    const avisos = u.items.filter((i) => !i.a_la_venta || !mapa.has(i.producto_id)).map((i) => `${i.nombre}: ya no se vende.`);
    const aAgregar = vendibles.flatMap((i) => {
      const p = mapa.get(i.producto_id);
      if (!p) return [];
      const x = opcionPara(p, i.tipo_empaque_id, Number(i.unidades), Number(i.cantidad));
      return [{ p, o: x.o, cantidad: x.cantidad }];
    });
    const r = agregarVarias(aAgregar, borrador.lineas);
    actualizar((b) => ({ ...b, lineas: r.nuevas }));
    const todos = [...avisos, ...r.avisos];
    toast({ title: `Se agregó el pedido ${u.numero}`, description: todos.length ? todos.slice(0, 3).join(" ") + (todos.length > 3 ? ` (+${todos.length - 3})` : "") : `${aAgregar.length} productos.` });
  };

  // ── Total exacto del servidor ──
  const envioNum = borrador.envio.trim() === "" ? null : Number(borrador.envio.replace(",", "."));
  const envioInvalido = envioNum != null && (!Number.isFinite(envioNum) || envioNum < 0);
  const envioEstimado = envioNum != null && !envioInvalido ? Math.round(envioNum * 100) / 100 : 0;
  const items = useMemo(() => lineas.map((l) => ({ producto_id: l.producto_id, cantidad: l.cantidad, tipo_empaque_id: l.tipo_empaque_id })), [lineas]);
  const cot = useCotizacion({ clienteId: cliente.id, items, envio: envioEstimado, activo: !envioInvalido });
  const nProductos = lineas.length;
  const estimado = lineas.reduce((s, l) => s + l.cantidad * l.precio, 0);

  const enviar = async () => {
    if (enviandoRef.current) return;            // doble toque: el segundo no sale
    if (lineas.length === 0) { toast({ title: "Agrega productos", variant: "destructive" }); return; }
    if (envioInvalido) { toast({ title: "Cargo de envío inválido", description: "Indica un monto de 0 o más, o déjalo vacío.", variant: "destructive" }); return; }
    enviandoRef.current = true;
    setEnviando(true);
    try {
      const notas = [NOTA_VENDEDOR, borrador.corrige ? `corrige ${borrador.corrige}` : null, borrador.notas.trim() || null].filter(Boolean).join(" · ");
      const { data, error } = await supabase.rpc("crear_orden_vendedor", {
        p_cliente_id: cliente.id, p_metodo_pago: borrador.metodo, p_notas: notas,
        p_items: lineas.map((l) => ({ producto_id: l.producto_id, cantidad: l.cantidad, tipo_empaque_id: l.tipo_empaque_id })),
        p_envio: envioNum != null ? envioEstimado : null,
        p_clave: borrador.clave,
      });
      if (error) {
        // El borrador (con su clave) se queda: reintentar no duplica
        toast({ title: "No se pudo enviar el pedido", description: error.message, variant: "destructive" });
        return;
      }
      const fila = (Array.isArray(data) ? data[0] : data) as { orden_id: string; numero: string; total: number } | null;
      borrarBorrador(usuarioId, cliente.id);
      toast({ title: "Pedido enviado", description: `${fila?.numero ?? ""} · ${formatPrice(Number(fila?.total || 0))} · queda por aprobar.` });
      if (fila?.orden_id) navigate(`/vendedor/pedidos/${fila.orden_id}`, { replace: true });
      else navigate("/vendedor/pedidos", { replace: true });
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  };

  const vaciar = () => { setBorrador(borradorVacio(cliente)); setAviso(null); setRevisar(false); };

  // ── Vista ──
  const cabeceraCliente = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-card px-3 py-2" data-testid="cabecera-cliente">
      {/* En el teléfono el nombre ocupa su fila (la barra superior ya lo muestra) y las cifras y acciones van debajo */}
      <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
        <p className="truncate text-sm font-semibold">{cliente.nombre_negocio}</p>
        <p className="truncate text-xs text-muted-foreground">
          {[cliente.ciudad, cliente.condicion_pago ? `Condición: ${cliente.condicion_pago}` : null].filter(Boolean).join(" · ") || "—"}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {cliente.vencido > 0.009 ? (
          <span className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-0.5 font-medium text-destructive" data-testid="alerta-vencido">
            Vencido {formatPrice(cliente.vencido)} · {cliente.dias_mora} d
          </span>
        ) : cliente.por_cobrar > 0.009 ? (
          <span className="rounded-md border border-border px-2 py-0.5 text-muted-foreground">Por cobrar {formatPrice(cliente.por_cobrar)}</span>
        ) : null}
        {cliente.excedido && <span className="rounded-md border border-destructive/40 px-2 py-0.5 font-medium text-destructive">Sobre su límite</span>}
        <Link to={`/vendedor/clientes/${cliente.id}`} className="inline-flex h-8 items-center gap-1 rounded-md px-2 font-medium text-emerald-700 hover:bg-muted dark:text-emerald-400">
          <FileText className="h-3.5 w-3.5" />Ficha
        </Link>
        <button type="button" onClick={onCambiarCliente} className="inline-flex h-8 items-center gap-1 rounded-md px-2 font-medium text-muted-foreground hover:bg-muted" data-testid="cambiar-cliente">
          <ArrowLeftRight className="h-3.5 w-3.5" />Cambiar
        </button>
      </div>
    </div>
  );

  const avisoDuplicado = aviso && (
    <div className="rounded-lg border border-sky-300 bg-sky-50 p-3 text-sm text-sky-950 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100" data-testid="aviso-duplicado">
      <div className="flex items-start gap-2">
        <Copy className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{aviso.titulo}</p>
          {aviso.motivo && <p className="mt-1 text-xs"><span className="font-semibold">No se aprobó por:</span> {aviso.motivo}</p>}
          {aviso.lineas.length > 0 && <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs">{aviso.lineas.map((a) => <li key={a}>{a}</li>)}</ul>}
        </div>
        <button type="button" onClick={() => setAviso(null)} aria-label="Cerrar aviso" className="shrink-0 p-1"><X className="h-4 w-4" /></button>
      </div>
    </div>
  );

  const frecuentes = compras?.frecuentes ?? [];
  const ultimo = compras?.ultimo_pedido ?? null;
  const tarjeta = (p: ProductoVendedor, sugerir = false) => (
    <TarjetaProductoVenta key={p.id} p={p}
      cantidadDe={(o) => cantidadDe(p.id, o.tipo_empaque_id)}
      maxDe={(o) => maxPara(p.controla_stock, Number(p.stock_disponible) || 0, p.id, o)}
      onCantidad={(o, n) => fijarCantidad(p, o, n)}
      sugerida={sugerir && p.frecuencia ? Math.max(1, Math.round(p.frecuencia.ultima_unidades / Math.max(1, opcionesDe(p)[0].unidades))) : null} />
  );

  const catalogo = (
    <div className="min-w-0 space-y-2">
      <div className={cn("space-y-2", esMovil && "sticky top-12 z-30 -mx-3 border-b border-border bg-background px-3 pb-2 pt-2")}>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => { setQ(e.target.value); if (tab !== "catalogo") setTab("catalogo"); }}
            placeholder="Buscar por nombre, código o categoría…" className="h-10 pl-8 pr-8" data-testid="buscar-producto" enterKeyHint="search" />
          {q && <button type="button" onClick={() => setQ("")} aria-label="Limpiar búsqueda" className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground"><X className="h-4 w-4" /></button>}
        </div>
        <div className="flex gap-1.5" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "catalogo"} onClick={() => setTab("catalogo")} data-testid="tab-catalogo"
            className={cn("flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border text-sm font-medium", tab === "catalogo" ? "border-emerald-500 bg-emerald-500 text-white" : "border-border text-muted-foreground")}>
            <Package className="h-4 w-4" />Catálogo
          </button>
          <button type="button" role="tab" aria-selected={tab === "compra"} onClick={() => setTab("compra")} data-testid="tab-compra"
            className={cn("flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border text-sm font-medium", tab === "compra" ? "border-emerald-500 bg-emerald-500 text-white" : "border-border text-muted-foreground")}>
            <History className="h-4 w-4" />Lo que compra{frecuentes.length ? ` (${frecuentes.length})` : ""}
          </button>
        </div>
        {tab === "catalogo" && (
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]" data-testid="chips-categoria">
            <button type="button" onClick={() => setCategoria(null)}
              className={cn("shrink-0 rounded-full border px-2.5 py-1 text-xs", !categoria ? "border-emerald-500 bg-emerald-500/10 font-medium text-emerald-800 dark:text-emerald-300" : "border-border text-muted-foreground")}>
              Todas
            </button>
            {categorias.map((c) => (
              <button key={c.id} type="button" onClick={() => setCategoria(categoria === c.id ? null : c.id)}
                className={cn("shrink-0 rounded-full border px-2.5 py-1 text-xs", categoria === c.id ? "border-emerald-500 bg-emerald-500/10 font-medium text-emerald-800 dark:text-emerald-300" : "border-border text-muted-foreground")}>
                {c.etiqueta} <span className="text-muted-foreground">{c.n}</span>
              </button>
            ))}
            <button type="button" onClick={() => setSoloDisp((v) => !v)} aria-pressed={soloDisp}
              className={cn("shrink-0 rounded-full border px-2.5 py-1 text-xs", soloDisp ? "border-emerald-500 bg-emerald-500/10 font-medium text-emerald-800 dark:text-emerald-300" : "border-border text-muted-foreground")}>
              Solo con disponible
            </button>
          </div>
        )}
      </div>

      {tab === "catalogo" ? (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {errorCat ? <p className="p-4 text-sm text-destructive">No se pudo cargar el catálogo: {errorCat}</p>
            : cargandoCat && productos.length === 0 ? <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-emerald-500" /></div>
            : productos.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground" data-testid="catalogo-vacio">Sin productos{qDeb ? ` para "${qDeb}"` : ""}.</p>
            : (
              <>
                <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
                  <span data-testid="catalogo-total">{total} {total === 1 ? "producto" : "productos"}{aproximado ? ` parecidos a "${qDeb}"` : ""}</span>
                  {cargandoCat && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                </div>
                <ul className={cn("divide-y divide-border", cargandoCat && "opacity-60")} data-testid="catalogo-lista">{productos.map((p) => tarjeta(p))}</ul>
                {productos.length < total && (
                  <div className="border-t border-border p-2 text-center">
                    <Button variant="ghost" size="sm" onClick={() => traer(productos.length)} disabled={cargandoMas} className="h-9">
                      {cargandoMas ? <Loader2 className="h-4 w-4 animate-spin" /> : `Ver más (${total - productos.length})`}
                    </Button>
                  </div>
                )}
              </>
            )}
        </div>
      ) : (
        <div className="space-y-2" data-testid="lo-que-compra">
          {ultimo && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium">Último pedido: {ultimo.numero}</p>
                <p className="text-xs text-muted-foreground">{fechaCorta(ultimo.fecha)} · {ultimo.items.length} productos · {formatPrice(Number(ultimo.total || 0))}</p>
              </div>
              <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={repetirUltimo} data-testid="repetir-ultimo">
                <Repeat className="h-3.5 w-3.5" />Repetir
              </Button>
            </div>
          )}
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            {!compras ? <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-emerald-500" /></div>
              : frecuentes.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">Este cliente aún no tiene compras registradas.</p>
              : (
                <>
                  <p className="border-b border-border px-3 py-1.5 text-xs text-muted-foreground">Sus productos más pedidos (últimos 6 meses primero). El botón suma la cantidad de su última compra.</p>
                  <ul className="divide-y divide-border">{frecuentes.map((p) => tarjeta(p, true))}</ul>
                </>
              )}
          </div>
        </div>
      )}
    </div>
  );

  const panel = (
    <PanelPedido lineas={lineas} lineaDe={cot.lineaDe} onCambiar={cambiarLinea} borrador={borrador} actualizar={actualizar}
      envioInvalido={envioInvalido} cot={cot} cliente={cliente} />
  );
  const botonEnviar = (
    <Button className="h-11 w-full gap-2 bg-emerald-500 text-base text-white hover:bg-emerald-600" onClick={enviar}
      disabled={enviando || nProductos === 0 || envioInvalido || !!cot.error} data-testid="enviar-pedido">
      {enviando ? <><Loader2 className="h-4 w-4 animate-spin" />Enviando…</> : <><ShoppingCart className="h-4 w-4" />Enviar pedido</>}
    </Button>
  );
  const totalTexto = cot.cotizacion ? formatPrice(cot.cotizacion.total) : nProductos ? `≈ ${formatPrice(estimado)}` : formatPrice(0);

  if (esMovil) {
    return (
      <VendedorLayout title="Nuevo pedido" pantallaCompletaMovil>
        <BarraSuperiorMovil titulo={borrador.corrige ? `Corregir ${borrador.corrige}` : "Nuevo pedido"} subtitulo={cliente.nombre_negocio} volverA="/vendedor/pedidos" />
        <div className="space-y-2 px-3 pb-28 pt-2">
          {cabeceraCliente}
          {avisoDuplicado}
          {catalogo}
        </div>
        {/* Barra fija: productos y total; abre la revisión */}
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]" data-testid="barra-pedido">
          <button type="button" onClick={() => setRevisar(true)} disabled={nProductos === 0}
            className="flex h-12 w-full items-center justify-between gap-3 rounded-lg bg-emerald-500 px-4 text-white disabled:bg-muted disabled:text-muted-foreground" data-testid="revisar-pedido">
            <span className="text-sm">{nProductos === 0 ? "Agrega productos" : `${nProductos} ${nProductos === 1 ? "producto" : "productos"}`}</span>
            <span className="flex items-center gap-2 text-base font-semibold tabular-nums">{totalTexto}{nProductos > 0 && <ChevronRight className="h-4 w-4" />}</span>
          </button>
        </div>
        {revisar && (
          <div className="fixed inset-0 z-50 flex flex-col bg-background" role="dialog" aria-modal="true" aria-label="Revisar pedido" data-testid="revision-movil">
            <BarraSuperiorMovil titulo="Revisar pedido" subtitulo={cliente.nombre_negocio} onVolver={() => setRevisar(false)} />
            <div className="min-h-0 flex-1 overflow-y-auto p-3">{panel}
              <button type="button" onClick={vaciar} className="mt-3 w-full text-center text-xs text-muted-foreground underline">Vaciar pedido</button>
            </div>
            <div className="border-t border-border bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{botonEnviar}</div>
          </div>
        )}
      </VendedorLayout>
    );
  }

  return (
    <VendedorLayout title={borrador.corrige ? `Corregir pedido ${borrador.corrige}` : "Nuevo pedido"}>
      <div className="mx-auto max-w-7xl space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Link to="/vendedor/pedidos" className="inline-flex h-8 items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">← Pedidos</Link>
          <p className="text-xs text-muted-foreground">El borrador se guarda solo en este equipo.</p>
        </div>
        {cabeceraCliente}
        {avisoDuplicado}
        <div className="grid grid-cols-[minmax(0,1fr)_340px] items-start gap-3 xl:grid-cols-[minmax(0,1fr)_400px]">
          {catalogo}
          <aside className="sticky top-14 max-h-[calc(100vh-4.5rem)] overflow-y-auto rounded-lg border border-border bg-card" data-testid="panel-pedido">
            <div className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-2">
              <h2 className="text-[13px] font-semibold">Pedido <span className="font-normal text-muted-foreground">({nProductos})</span></h2>
              {nProductos > 0 && <button type="button" onClick={vaciar} className="text-xs text-muted-foreground underline">Vaciar</button>}
            </div>
            <div className="p-3">{panel}</div>
            <div className="sticky bottom-0 border-t border-border bg-card p-3">{botonEnviar}</div>
          </aside>
        </div>
      </div>
    </VendedorLayout>
  );
}

// ── Revisión: líneas, notas, envío, forma de pago y total del servidor ──────────────────────────────────────────────────────
function PanelPedido({ lineas, lineaDe, onCambiar, borrador, actualizar, envioInvalido, cot, cliente }: {
  lineas: LineaBorrador[];
  lineaDe: (productoId: string, tipo: string | null | undefined) => { precio_unitario: number; subtotal: number } | null;
  onCambiar: (l: LineaBorrador, n: number) => void;
  borrador: BorradorPedido;
  actualizar: (f: (b: BorradorPedido) => BorradorPedido) => void;
  envioInvalido: boolean;
  cot: ReturnType<typeof useCotizacion>;
  cliente: ClienteCartera;
}) {
  const { formatPrice } = useCurrency();
  const maxLinea = (l: LineaBorrador) => {
    if (!l.controla_stock) return 99999;
    const otras = lineas.filter((x) => x.producto_id === l.producto_id && x.tipo_empaque_id !== l.tipo_empaque_id).reduce((s, x) => s + x.cantidad * x.unidades, 0);
    return Math.max(l.cantidad, Math.floor((Math.floor(l.disponible) - otras) / Math.max(1, l.unidades)));
  };
  return (
    <div className="space-y-3">
      {lineas.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Busca productos y agrégalos al pedido.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border" data-testid="lineas-pedido">
          {lineas.map((l) => {
            const s = lineaDe(l.producto_id, l.tipo_empaque_id);
            const precio = s ? s.precio_unitario : l.precio;
            return (
              <li key={claveDe(l)} className="flex items-center gap-2 px-2.5 py-2" data-testid="linea-pedido">
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-[13px] font-medium leading-snug">{l.nombre}</p>
                  <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
                    <span className="tabular-nums">{formatPrice(precio)}{l.empaque ? ` · ${l.empaque}${l.unidades > 1 ? ` ×${l.unidades}` : ""}` : " c/u"}</span>
                    {l.impuesto_pct != null && <span>· <EtiquetaIva pct={l.impuesto_pct} nombre={l.impuesto_nombre} /></span>}
                  </p>
                  <p className="text-xs font-semibold tabular-nums">{formatPrice(s ? s.subtotal : precio * l.cantidad)}</p>
                </div>
                <SelectorCantidad valor={l.cantidad} max={maxLinea(l)} onCambiar={(n) => onCambiar(l, n)} etiqueta={l.nombre} className="shrink-0" />
              </li>
            );
          })}
        </ul>
      )}

      <div className="space-y-1">
        <Label htmlFor="notas-pedido" className="text-xs">Notas para administración <span className="font-normal text-muted-foreground">· opcional</span></Label>
        <Textarea id="notas-pedido" rows={2} maxLength={500} value={borrador.notas} placeholder="Ej.: entregar en la mañana, OC 1234…"
          onChange={(e) => actualizar((b) => ({ ...b, notas: e.target.value }))} data-testid="notas-pedido" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="min-w-0 space-y-1">
          <Label className="text-xs">Forma de pago</Label>
          <Select value={borrador.metodo} onValueChange={(v) => actualizar((b) => ({ ...b, metodo: v }))}>
            <SelectTrigger className="h-9" data-testid="forma-pago"><SelectValue /></SelectTrigger>
            <SelectContent>{METODOS.map((m) => <SelectItem key={m.valor} value={m.valor}>{m.etiqueta}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor="envio-pedido" className="text-xs">Envío (USD) <span className="font-normal text-muted-foreground">· opcional</span></Label>
          <Input id="envio-pedido" type="text" inputMode="decimal" placeholder="Sin envío" value={borrador.envio} className="h-9"
            onChange={(e) => actualizar((b) => ({ ...b, envio: e.target.value.replace(/[^\d.,]/g, "").slice(0, 10) }))} data-testid="envio-pedido" />
        </div>
      </div>
      {cliente.condicion_pago && <p className="-mt-1 text-[11px] text-muted-foreground">Condición de pago del cliente: {cliente.condicion_pago}.</p>}
      {envioInvalido && <p className="text-xs text-destructive">Indica un envío válido (0 o más) o déjalo vacío.</p>}

      {lineas.length > 0 && (
        <div className="rounded-lg bg-muted p-3" data-testid="resumen-pedido">
          {envioInvalido ? <p className="text-sm text-muted-foreground">Corrige el envío para ver el total.</p>
            : <ResumenCotizacion {...cot} envioCero="Sin envío" />}
        </div>
      )}
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
        <span>Quedará <strong className="font-semibold text-foreground">por aprobar</strong>. Te avisaremos cuando administración lo apruebe y cuando se registre en Odoo.</span>
      </p>
    </div>
  );
}

export default VendedorPedidoNuevo;
