import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

// Total exacto de un pedido antes de enviarlo: cotizar_pedido (migración 20a) hace en el servidor el mismo cálculo que los
// cuatro caminos de pedido (precio efectivo del cliente, IVA de cada producto según Odoo agrupado por tasa, cupón y envío).
// El navegador no estima nada: si la cotización falla, no hay total que mostrar.

export interface ItemCotizar {
  producto_id: string;
  cantidad: number;
  tipo_empaque_id?: string | null;
}

export interface LineaCotizada {
  producto_id: string;
  tipo_empaque_id: string | null;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
  impuesto_pct: number;
}

export interface Cotizacion {
  lineas: LineaCotizada[];
  subtotal: number;
  descuento: number;
  impuesto: number;
  envio: number;
  total: number;
  envio_gratis_desde: number;
  aviso: string | null;
}

interface Opciones {
  clienteId: string | null | undefined;
  items: ItemCotizar[];
  cuponId?: string | null;
  /** Edición de un pedido: el servidor aplica el cupón o el descuento del pedido como editar_pedido_pendiente (fase 20c). */
  ordenId?: string | null;
  /** null = regla del portal (gratis desde el mínimo); un número = cargo manual (vendedor). */
  envio?: number | null;
  /** false = no cotizar (p. ej. panel cerrado o un dato del formulario inválido). */
  activo?: boolean;
  demoraMs?: number;
}

const num = (v: unknown) => Number(v ?? 0) || 0;

const normalizar = (d: Record<string, unknown>): Cotizacion => ({
  lineas: ((d.lineas as Record<string, unknown>[] | null) ?? []).map((l) => ({
    producto_id: String(l.producto_id),
    tipo_empaque_id: (l.tipo_empaque_id as string | null) ?? null,
    cantidad: num(l.cantidad),
    precio_unitario: num(l.precio_unitario),
    subtotal: num(l.subtotal),
    impuesto_pct: num(l.impuesto_pct),
  })),
  subtotal: num(d.subtotal),
  descuento: num(d.descuento),
  impuesto: num(d.impuesto),
  envio: num(d.envio),
  total: num(d.total),
  envio_gratis_desde: num(d.envio_gratis_desde),
  aviso: (d.aviso as string | null) ?? null,
});

/** Clave de una línea (producto + empaque) para cruzar las líneas cotizadas con las de la pantalla. */
export const claveLinea = (productoId: string, tipoEmpaqueId: string | null | undefined) => `${productoId}|${tipoEmpaqueId || ""}`;

export const useCotizacion = ({ clienteId, items, cuponId = null, ordenId = null, envio = null, activo = true, demoraMs = 300 }: Opciones) => {
  // Clave estable de lo que se cotiza: cambia solo si cambia algo que altera el total
  const clave = useMemo(() => {
    const validos = items
      .filter((i) => Number(i.cantidad) > 0)
      .map((i) => ({ producto_id: i.producto_id, cantidad: Math.floor(Number(i.cantidad)), tipo_empaque_id: i.tipo_empaque_id || null }));
    if (!activo || !clienteId || validos.length === 0) return "";
    return JSON.stringify({ c: clienteId, i: validos, u: cuponId || null, o: ordenId || null, e: envio ?? null });
  }, [items, clienteId, cuponId, ordenId, envio, activo]);

  const [estado, setEstado] = useState<{ clave: string; cotizacion: Cotizacion | null; error: string | null }>({ clave: "", cotizacion: null, error: null });
  // Última cotización buena: se sigue mostrando (atenuada) mientras llega la nueva
  const [ultima, setUltima] = useState<Cotizacion | null>(null);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    if (!clave) return;
    let cancelado = false;
    const t = setTimeout(async () => {
      const q = JSON.parse(clave) as { c: string; i: ItemCotizar[]; u: string | null; o: string | null; e: number | null };
      const { data, error } = await supabase.rpc("cotizar_pedido", { p_cliente_id: q.c, p_items: q.i, p_cupon_id: q.u, p_envio: q.e, p_orden_id: q.o });
      if (cancelado) return;
      if (error || !data) {
        // Mensajes del servidor que el usuario entiende (permiso, validación); lo demás, uno genérico
        const legible = error && (error.code === "42501" || error.code === "P0001") ? error.message : null;
        setEstado({ clave, cotizacion: null, error: legible ?? "No se pudo calcular el total. Revisa tu conexión e intenta de nuevo." });
        setUltima(null);
        return;
      }
      const c = normalizar(data as Record<string, unknown>);
      setEstado({ clave, cotizacion: c, error: null });
      setUltima(c);
    }, demoraMs);
    return () => { cancelado = true; clearTimeout(t); };
  }, [clave, intento, demoraMs]);

  const vigente = !!clave && estado.clave === clave;
  const reintentar = useCallback(() => {
    setEstado((e) => ({ ...e, clave: "" }));
    setIntento((n) => n + 1);
  }, []);

  return {
    /** Cotización de lo que hay en pantalla; mientras se recalcula, la anterior (con `cargando` en true). */
    cotizacion: !clave ? null : vigente ? estado.cotizacion : ultima,
    /** true desde que cambia algo hasta que llega la cotización nueva (incluye la espera del debounce). */
    cargando: !!clave && !vigente,
    error: vigente ? estado.error : null,
    reintentar,
    /** Línea cotizada por producto y empaque (precio unitario y % de IVA del servidor). */
    lineaDe: useCallback(
      (productoId: string, tipoEmpaqueId: string | null | undefined) => {
        const c = !clave ? null : vigente ? estado.cotizacion : ultima;
        return c?.lineas.find((l) => claveLinea(l.producto_id, l.tipo_empaque_id) === claveLinea(productoId, tipoEmpaqueId)) ?? null;
      },
      [clave, vigente, estado.cotizacion, ultima],
    ),
  };
};
