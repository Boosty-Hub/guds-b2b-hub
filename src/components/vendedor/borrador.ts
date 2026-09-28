// Borrador del pedido del vendedor en el navegador (localStorage), uno por cliente: sobrevive a recargar, a cerrar la app y
// a un cambio de empresa. Lleva la clave de idempotencia: si el envío se corta y se reintenta, el servidor devuelve el mismo
// pedido (crear_orden_vendedor con p_clave). Todo acceso va en try/catch (modo privado, almacenamiento bloqueado o lleno).

export interface LineaBorrador {
  producto_id: string;
  tipo_empaque_id: string | null;
  nombre: string;
  sku: string | null;
  empaque: string | null;
  unidades: number;          // unidades por empaque (1 = unidad)
  precio: number;            // precio del cliente al agregarlo (el total real lo da cotizar_pedido)
  cantidad: number;
  impuesto_pct: number | null;
  impuesto_nombre: string | null;
  controla_stock: boolean;
  disponible: number;        // unidades disponibles al agregarlo (el servidor valida al enviar)
}

export interface BorradorPedido {
  clave: string;
  cliente_id: string;
  cliente_nombre: string;
  lineas: LineaBorrador[];
  notas: string;
  envio: string;
  metodo: string;
  /** Número del pedido que se corrige ("Duplicar y corregir"). */
  corrige: string | null;
  actualizado: string;
}

const PREFIJO = "guds.vendedor.pedido.";
const clave = (usuarioId: string, clienteId: string) => `${PREFIJO}${usuarioId}.${clienteId}`;

export const leerBorrador = (usuarioId: string, clienteId: string): BorradorPedido | null => {
  try {
    const raw = localStorage.getItem(clave(usuarioId, clienteId));
    if (!raw) return null;
    const b = JSON.parse(raw) as BorradorPedido;
    if (!b || typeof b.clave !== "string" || !Array.isArray(b.lineas)) return null;
    return b;
  } catch {
    return null;
  }
};

export const guardarBorrador = (usuarioId: string, b: BorradorPedido) => {
  try {
    localStorage.setItem(clave(usuarioId, b.cliente_id), JSON.stringify({ ...b, actualizado: new Date().toISOString() }));
  } catch { /* sin almacenamiento: el pedido sigue en pantalla */ }
};

export const borrarBorrador = (usuarioId: string, clienteId: string) => {
  try { localStorage.removeItem(clave(usuarioId, clienteId)); } catch { /* nada */ }
};

/** Clientes con un borrador que tiene al menos una línea: id → { n líneas, actualizado }. */
export const listarBorradores = (usuarioId: string): Record<string, { lineas: number; actualizado: string }> => {
  const out: Record<string, { lineas: number; actualizado: string }> = {};
  try {
    const pref = `${PREFIJO}${usuarioId}.`;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(pref)) continue;
      try {
        const b = JSON.parse(localStorage.getItem(k) || "null") as BorradorPedido | null;
        if (b && Array.isArray(b.lineas) && b.lineas.length > 0) out[b.cliente_id] = { lineas: b.lineas.length, actualizado: b.actualizado };
      } catch { /* borrador dañado: se ignora */ }
    }
  } catch { /* sin almacenamiento */ }
  return out;
};
