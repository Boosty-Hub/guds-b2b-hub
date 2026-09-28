// Tipos de las funciones del servidor del portal del vendedor (migraciones 20o).

/** Empaque de un producto con el precio que cobra el servidor a ese cliente (precio_efectivo). */
export interface EmpaqueVendedor {
  tipo_empaque_id: string;
  precio: number;
  tipo_empaque: { id: string; nombre: string; unidades: number };
}

/** Producto como lo devuelve catalogo_vendedor / compras_cliente_vendedor (sin costo). */
export interface ProductoVendedor {
  id: string;
  sku: string | null;
  nombre: string;
  unidad: string | null;
  imagen_url: string | null;
  controla_stock: boolean;
  stock_disponible: number;
  impuesto_pct: number | null;
  impuesto_nombre: string | null;
  categoria: { id: string; etiqueta: string } | null;
  /** Precio de la opción por defecto (el empaque de menos unidades o la unidad). */
  precio: number;
  precio_unidades: number;
  empaques: EmpaqueVendedor[];
  compras: { veces: number; ultima: string | null };
  frecuencia?: {
    veces: number; veces_180: number; ultima: string; ultima_cantidad: number;
    ultima_tipo_empaque_id: string | null; ultima_unidades: number;
  };
}

export interface CategoriaVendedor { id: string; etiqueta: string; n: number }

export interface UltimoPedido {
  id: string; numero: string; numero_guds: string | null; fecha: string; total: number;
  items: { producto_id: string; tipo_empaque_id: string | null; cantidad: number; unidades: number; nombre: string; a_la_venta: boolean }[];
}

/** Cliente de cartera_vendedor(): deuda por tramos, mora, compras y prioridad de cobro. */
export interface ClienteCartera {
  id: string; codigo: string | null; nombre_negocio: string; ciudad: string | null; telefono: string | null; celular: string | null;
  condicion_pago: string | null; dias_credito: number | null; limite_credito: number; empresa_id: string | null;
  por_cobrar: number; a_favor: number; vencido: number; dias_mora: number; facturas: number; saldo_inicial: number;
  tramos: Tramos; proximo_vencimiento: string | null; vence_7d: number;
  ultima_compra: string | null; compras_180d: number; ultimo_cobro: string | null; cobros_pendientes: number;
  excedido: boolean; prioridad: number;
}

export interface Tramos { por_vencer: number; d1_30: number; d31_60: number; d61_90: number; mas_90: number }

/** Opción que se agrega al pedido: un empaque o la unidad (tipo_empaque_id null). */
export interface OpcionVenta { tipo_empaque_id: string | null; nombre: string | null; unidades: number; precio: number }

export const opcionesDe = (p: ProductoVendedor): OpcionVenta[] =>
  p.empaques.length > 0
    ? p.empaques.map((e) => ({ tipo_empaque_id: e.tipo_empaque_id, nombre: e.tipo_empaque.nombre, unidades: Math.max(1, Number(e.tipo_empaque.unidades) || 1), precio: Number(e.precio) }))
    : [{ tipo_empaque_id: null, nombre: null, unidades: 1, precio: Number(p.precio) }];

/** Días entre una fecha ISO y hoy (en el huso del navegador). */
export const diasDesde = (iso: string | null | undefined) => {
  if (!iso) return null;
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return Math.floor((Date.now() - d.getTime()) / 86400000);
};

export const fechaCorta = (s: string | null | undefined) =>
  s ? new Date(s.length === 10 ? `${s}T12:00:00` : s).toLocaleDateString("es-VE", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/** Clave única (idempotencia del pedido y del cobro). */
export const nuevaClave = (): string => {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch { /* sin crypto.randomUUID */ }
  const b = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
