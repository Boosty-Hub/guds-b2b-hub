import { useCallback, useEffect, useState } from "react";
import { supabase, Producto, TipoEmpaque } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { CART_CHANGED, notifyCartChanged } from "@/components/portal/PortalCartWidget";
import { usePortal } from "@/components/portal/contextoPortal";

// Carrito del portal del cliente: una sola lógica para el catálogo y favoritos (antes favoritos tenía un carrito
// local que no se guardaba). Escribe en la tabla carrito con el precio autoritativo de precio_efectivo (el mismo que
// usa crear_orden_desde_carrito) y respeta el disponible de cada producto.

export interface ProductoConEmpaques extends Producto {
  producto_empaques?: {
    id: string;
    tipo_empaque_id: string;
    tipo_empaque: TipoEmpaque;
  }[];
}

/** Empaque mínimo que necesita el carrito. */
export interface EmpaqueCarrito {
  id: string;
  nombre: string;
  unidades: number;
}

/** Lo mínimo de un producto que usa el carrito (lo cumplen el producto de la tabla y el del catálogo del portal). */
export interface ProductoCarrito {
  id: string;
  nombre: string;
  precio_base: number;
  en_oferta?: boolean | null;
  precio_oferta?: number | null;
  controla_stock?: boolean | null;
  stock_disponible?: number | null;
  stock_actual?: number | null;
  imagen_url?: string | null;
  imagenes?: string[] | null;
  imagen_emoji?: string | null;
  producto_empaques?: {
    id: string;
    tipo_empaque_id: string;
    /** Precio del empaque para el cliente, si ya lo trae el catálogo (precio_efectivo). */
    precio?: number | null;
    tipo_empaque: EmpaqueCarrito;
  }[];
}

// Columnas del producto que lee el portal (nunca select=*: el costo solo lo ve administración)
const COLUMNAS_PRODUCTO = "id, nombre, sku, activo, vendible, oculto_tienda, controla_stock, stock_disponible, stock_actual, en_oferta, precio_oferta, precio_base, producto_empaques(id, tipo_empaque_id, activo, tipo_empaque:tipos_empaque(id, nombre, unidades))";

export interface ItemCarrito {
  id: string;
  producto_id: string;
  tipo_empaque_id: string | null;
  cantidad: number;
  precio_unitario: number | null;
}

/** Línea de un pedido anterior para "volver a pedir" (cantidad en empaques si trae empaque; si no, en unidades). */
export interface LineaRepetir {
  producto_id: string;
  tipo_empaque_id: string | null;
  cantidad: number;
  nombre: string;
}

export interface ResultadoRepetir {
  agregadas: number;
  ajustadas: { nombre: string; pedida: number; agregada: number }[];
  omitidas: { nombre: string; motivo: string }[];
}

export const useCarritoPortal = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [cart, setCart] = useState<ItemCarrito[]>([]);
  // Diálogo para elegir empaque cuando el producto tiene más de uno
  const [empaqueProducto, setEmpaqueProducto] = useState<ProductoCarrito | null>(null);
  // Precio real por empaque (mismo que cobra el checkout) para el diálogo: { tipo_empaque_id: precio }
  const [empaquePrecios, setEmpaquePrecios] = useState<Record<string, number>>({});

  // Dentro del shell del portal las líneas salen del carrito único del panel (misma tabla y mismo usuario, ya cargado
  // y sincronizado con CART_CHANGED): no se vuelven a pedir. Fuera del shell, el hook carga el suyo.
  const panel = usePortal()?.carrito;
  const recargarPanel = panel?.recargar;
  const lineasPanel = panel?.cargado ? panel.items : null;
  useEffect(() => {
    if (lineasPanel) setCart(lineasPanel.map(({ id, producto_id, tipo_empaque_id, cantidad, precio_unitario }) => ({ id, producto_id, tipo_empaque_id, cantidad, precio_unitario })));
  }, [lineasPanel]);
  const enShell = !!panel;

  const cargarCarrito = useCallback(async () => {
    if (!user?.id) return;
    if (recargarPanel) { await recargarPanel(); return; }
    const { data } = await supabase
      .from("carrito")
      .select("id, producto_id, tipo_empaque_id, cantidad, precio_unitario")
      .eq("usuario_id", user.id);
    if (data) setCart(data as ItemCarrito[]);
  }, [user?.id, recargarPanel]);

  useEffect(() => { if (!enShell) cargarCarrito(); }, [enShell, cargarCarrito]);

  // El panel del carrito (widget) también cambia cantidades: se mantiene sincronizado (en el shell ya lo hace el panel)
  useEffect(() => {
    if (enShell) return;
    const handler = () => { cargarCarrito(); };
    window.addEventListener(CART_CHANGED, handler);
    return () => window.removeEventListener(CART_CHANGED, handler);
  }, [enShell, cargarCarrito]);

  // Disponible para vender (unidades): existencia − lo comprometido en pedidos y entregas. Sin control de stock: sin tope.
  const disponibleDe = (p: ProductoCarrito) => (p.controla_stock === false ? Infinity : Number(p.stock_disponible ?? p.stock_actual ?? 0));
  const unidadesEmpaque = (p: ProductoCarrito, tipoId: string | null) =>
    Math.max(1, Number(p.producto_empaques?.find((pe) => pe.tipo_empaque_id === tipoId)?.tipo_empaque?.unidades ?? 1));
  const unidadesEnCarrito = (p: ProductoCarrito) =>
    cart.filter((i) => i.producto_id === p.id).reduce((s, i) => s + i.cantidad * unidadesEmpaque(p, i.tipo_empaque_id), 0);
  /** Cuántos empaques (o unidades, sin empaque) más caben en el disponible, contando lo que ya está en el carrito. */
  const maximoAgregable = (p: ProductoCarrito, tipoId: string | null) => {
    const libre = disponibleDe(p) - unidadesEnCarrito(p);
    return Number.isFinite(libre) ? Math.max(0, Math.floor(libre / unidadesEmpaque(p, tipoId))) : Infinity;
  };
  const cabeEnStock = (p: ProductoCarrito, unidadesExtra: number) => {
    const disp = disponibleDe(p);
    if (unidadesEnCarrito(p) + unidadesExtra <= disp) return true;
    toast({ title: "Sin disponible suficiente", description: `De ${p.nombre} quedan ${Math.max(0, Math.floor(disp))} unidades disponibles (el resto está comprometido en pedidos).`, variant: "destructive" });
    return false;
  };

  /** Agrega `cantidad` empaques (o unidades si no hay empaque) con el precio del servidor. */
  const agregarConEmpaque = async (product: ProductoCarrito, empaque: EmpaqueCarrito | null, cantidad = 1) => {
    if (!user?.id) return false;
    cantidad = Math.max(1, Math.floor(cantidad));
    if (!cabeEnStock(product, unidadesEmpaque(product, empaque?.id || null) * cantidad)) return false;

    // Precio efectivo autoritativo (lista de cliente / empaque / oferta / base).
    // Es la misma función que usa el checkout, así el carrito nunca miente.
    let precioUnitario: number;
    const { data: precioRpc } = await supabase.rpc("precio_efectivo", {
      p_producto_id: product.id,
      p_tipo_empaque_id: empaque?.id || null,
      p_cliente_id: user.cliente_id || null,
    });
    if (precioRpc != null) {
      precioUnitario = Number(precioRpc);
    } else {
      // Fallback defensivo si el RPC no responde: precio del empaque (P4), sin ×unidades.
      precioUnitario = product.en_oferta && product.precio_oferta ? product.precio_oferta : product.precio_base;
    }

    // Mismo producto con el mismo empaque: se suma a la línea existente
    const existing = cart.find((item) =>
      item.producto_id === product.id && item.tipo_empaque_id === (empaque?.id || null)
    );

    if (existing) {
      const newCantidad = existing.cantidad + cantidad;
      const { error } = await supabase
        .from("carrito")
        .update({ cantidad: newCantidad, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      if (error) {
        toast({ title: "No se pudo agregar", description: error.message, variant: "destructive" });
        return false;
      }
      setCart((prev) => prev.map((item) => (item.id === existing.id ? { ...item, cantidad: newCantidad } : item)));
    } else {
      const { data, error } = await supabase
        .from("carrito")
        .insert({
          usuario_id: user.id,
          producto_id: product.id,
          tipo_empaque_id: empaque?.id || null,
          cantidad,
          precio_unitario: precioUnitario,
        })
        .select("id, producto_id, tipo_empaque_id, cantidad, precio_unitario")
        .single();
      if (error || !data) {
        toast({ title: "No se pudo agregar", description: error?.message ?? "Intenta de nuevo.", variant: "destructive" });
        return false;
      }
      setCart((prev) => [...prev, data as ItemCarrito]);
    }

    setEmpaqueProducto(null);
    const empaqueNombre = empaque ? ` (${cantidad > 1 ? `${cantidad} × ` : ""}${empaque.nombre})` : cantidad > 1 ? ` (${cantidad})` : "";
    toast({ title: "Agregado al carrito", description: `${product.nombre}${empaqueNombre}` });
    notifyCartChanged();
    return true;
  };

  // Punto de entrada del botón "+": con más de un empaque pide elegir; con uno o ninguno agrega directo.
  const agregar = async (product: ProductoCarrito) => {
    if (!user?.id) return;
    const empaques = product.producto_empaques || [];
    if (empaques.length > 1) {
      setEmpaqueProducto(product);
      // El catálogo del portal ya trae el precio de cada empaque (el mismo que cobra el servidor)
      if (empaques.every((pe) => pe.precio != null)) {
        setEmpaquePrecios(Object.fromEntries(empaques.map((pe) => [pe.tipo_empaque_id, Number(pe.precio)])));
        return;
      }
      setEmpaquePrecios({});
      const entries = await Promise.all(empaques.map(async (pe) => {
        const { data } = await supabase.rpc("precio_efectivo", {
          p_producto_id: product.id,
          p_tipo_empaque_id: pe.tipo_empaque_id,
          p_cliente_id: user.cliente_id || null,
        });
        const fallback = product.en_oferta && product.precio_oferta ? Number(product.precio_oferta) : Number(product.precio_base);
        return [pe.tipo_empaque_id, data != null ? Number(data) : fallback] as const;
      }));
      setEmpaquePrecios(Object.fromEntries(entries));
    } else {
      await agregarConEmpaque(product, empaques[0]?.tipo_empaque ?? null);
    }
  };

  /** Suma o resta en la línea del producto con ese empaque (sin empaque indicado: la primera línea del producto). */
  const cambiarCantidad = async (product: ProductoCarrito, delta: number, tipoEmpaqueId?: string | null) => {
    const item = cart.find((i) => i.producto_id === product.id && (tipoEmpaqueId === undefined || i.tipo_empaque_id === tipoEmpaqueId));
    if (!item) return;
    const newCantidad = Math.max(0, item.cantidad + delta);
    if (delta > 0 && !cabeEnStock(product, delta * unidadesEmpaque(product, item.tipo_empaque_id))) return;

    if (newCantidad === 0) {
      setCart((prev) => prev.filter((i) => i.id !== item.id));
      await supabase.from("carrito").delete().eq("id", item.id);
    } else {
      setCart((prev) => prev.map((i) => (i.id === item.id ? { ...i, cantidad: newCantidad } : i)));
      await supabase.from("carrito").update({ cantidad: newCantidad, updated_at: new Date().toISOString() }).eq("id", item.id);
    }
    notifyCartChanged();
  };

  /** Cantidad en el carrito del producto (con ese empaque, si se indica). */
  const cantidadDe = (productId: string, tipoEmpaqueId?: string | null) =>
    cart.filter((i) => i.producto_id === productId && (tipoEmpaqueId === undefined || i.tipo_empaque_id === tipoEmpaqueId))
      .reduce((s, i) => s + i.cantidad, 0);

  // "Volver a pedir": agrega las líneas de un pedido anterior al carrito, con el mismo empaque, sin pasar del disponible
  // (lo que ya está en el carrito cuenta) y con el precio de hoy (precio_efectivo). Informa lo que se ajustó o se omitió.
  const agregarLineas = async (lineas: LineaRepetir[]): Promise<ResultadoRepetir> => {
    const res: ResultadoRepetir = { agregadas: 0, ajustadas: [], omitidas: [] };
    if (!user?.id || lineas.length === 0) return res;
    const ids = Array.from(new Set(lineas.map((l) => l.producto_id)));
    const [{ data: prods }, { data: actual }] = await Promise.all([
      supabase.from("productos").select(COLUMNAS_PRODUCTO).in("id", ids),
      supabase.from("carrito").select("id, producto_id, tipo_empaque_id, cantidad, precio_unitario").eq("usuario_id", user.id),
    ]);
    type ProductoRepetir = ProductoCarrito & { activo?: boolean; vendible?: boolean | null; oculto_tienda?: boolean | null };
    const porId = new Map(((prods as unknown as ProductoRepetir[] | null) ?? []).map((p) => [p.id, p]));
    let carrito = ((actual as ItemCarrito[] | null) ?? []).slice();
    const unidadesDe = (p: ProductoCarrito, tipoId: string | null) =>
      tipoId ? Math.max(1, Number(p.producto_empaques?.find((pe) => pe.tipo_empaque_id === tipoId)?.tipo_empaque?.unidades ?? 1)) : 1;
    const enCarrito = (p: ProductoCarrito) =>
      carrito.filter((i) => i.producto_id === p.id).reduce((s, i) => s + i.cantidad * unidadesDe(p, i.tipo_empaque_id), 0);

    for (const l of lineas) {
      const p = porId.get(l.producto_id);
      if (!p || p.activo === false || p.vendible === false || p.oculto_tienda) {
        res.omitidas.push({ nombre: l.nombre, motivo: "ya no está a la venta" });
        continue;
      }
      // El mismo empaque del pedido; si el producto ya no lo ofrece, se pide elegirlo en el catálogo
      if (l.tipo_empaque_id && !p.producto_empaques?.some((pe) => pe.tipo_empaque_id === l.tipo_empaque_id)) {
        res.omitidas.push({ nombre: p.nombre, motivo: "su empaque cambió; agrégalo desde el catálogo" });
        continue;
      }
      const tipoId = l.tipo_empaque_id ?? null;
      const unid = unidadesDe(p, tipoId);
      const libre = disponibleDe(p) - enCarrito(p);
      const maxEmpaques = Number.isFinite(libre) ? Math.floor(Math.max(0, libre) / unid) : l.cantidad;
      const cantidad = Math.min(l.cantidad, maxEmpaques);
      if (cantidad <= 0) {
        res.omitidas.push({ nombre: p.nombre, motivo: "sin disponible por ahora" });
        continue;
      }
      const { data: precioRpc } = await supabase.rpc("precio_efectivo", { p_producto_id: p.id, p_tipo_empaque_id: tipoId, p_cliente_id: user.cliente_id || null });
      const precio = precioRpc != null ? Number(precioRpc) : (p.en_oferta && p.precio_oferta ? Number(p.precio_oferta) : Number(p.precio_base));
      const existente = carrito.find((i) => i.producto_id === p.id && i.tipo_empaque_id === tipoId);
      if (existente) {
        const nueva = existente.cantidad + cantidad;
        const { error } = await supabase.from("carrito").update({ cantidad: nueva, updated_at: new Date().toISOString() }).eq("id", existente.id);
        if (error) { res.omitidas.push({ nombre: p.nombre, motivo: "no se pudo agregar" }); continue; }
        carrito = carrito.map((i) => (i.id === existente.id ? { ...i, cantidad: nueva } : i));
      } else {
        const { data, error } = await supabase.from("carrito")
          .insert({ usuario_id: user.id, producto_id: p.id, tipo_empaque_id: tipoId, cantidad, precio_unitario: precio })
          .select("id, producto_id, tipo_empaque_id, cantidad, precio_unitario").single();
        if (error || !data) { res.omitidas.push({ nombre: p.nombre, motivo: "no se pudo agregar" }); continue; }
        carrito = [...carrito, data as ItemCarrito];
      }
      res.agregadas += 1;
      if (cantidad < l.cantidad) res.ajustadas.push({ nombre: p.nombre, pedida: l.cantidad, agregada: cantidad });
    }
    setCart(carrito);
    notifyCartChanged();
    return res;
  };

  return {
    cart,
    cargarCarrito,
    agregar,
    agregarConEmpaque,
    agregarLineas,
    cambiarCantidad,
    cantidadDe,
    disponibleDe,
    maximoAgregable,
    empaqueProducto,
    empaquePrecios,
    cerrarEmpaque: () => setEmpaqueProducto(null),
  };
};
