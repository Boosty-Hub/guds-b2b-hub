import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Tono } from "@/components/portal/sistema";

// Finanzas del portal del cliente (F5). El estado de cuenta sale de la función del servidor estado_cuenta_portal (fase 20m):
// la misma regla que Cuentas por Cobrar del admin (facturas publicadas con saldo, antigüedad por vencimiento) más el
// libro de movimientos con saldo corrido. Aquí solo se muestra; el navegador no recalcula el dinero.

export const TOLERANCIA = 0.009; // misma tolerancia que CxC del admin

export interface ResumenCuenta {
  saldo: number;
  por_vencer: number;
  vencido: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  mas_90: number;
  nc_a_favor: number;
  anticipos: number;
  a_favor: number;
  neto: number;
  facturas_abiertas: number;
  facturas_vencidas: number;
  notas_credito_abiertas: number;
}

export interface CreditoCuenta {
  modo: string;
  limite: number | null;
  utilizado: number | null;
  en_pedidos: number | null;
  disponible: number | null;
}

export type TipoMovimiento =
  | "factura" | "nota_debito" | "nota_credito" | "cobro" | "retencion" | "ajuste" | "reintegro" | "nota_credito_aplicada" | "redondeo";

export interface Movimiento {
  fecha: string | null;
  tipo: TipoMovimiento;
  documento: string;
  detalle: string | null;
  factura_id: string | null;
  monto: number;   // + cargo, − abono (USD)
  saldo: number;   // saldo corrido después del movimiento
  vence: string | null;
  estado: string | null;
}

export interface EstadoCuenta {
  hoy: string;
  cliente: { id: string; nombre: string; rif: string | null; codigo: string | null; condicion_pago: string | null; dias_credito: number | null };
  empresa: { id: string; nombre: string; nombre_corto: string | null; rif: string | null } | null;
  resumen: ResumenCuenta;
  credito: CreditoCuenta | null;
  periodo: { desde: string | null; hasta: string | null };
  saldo_inicial: number;
  saldo_final: number;
  movimientos: Movimiento[];
  diferencia: number | null;
}

/** Tramos de antigüedad: los mismos del admin (por vencer, 1–30, 31–60, 61–90, +90 días de vencida). */
export const TRAMOS = [
  { k: "por_vencer", etiqueta: "Por vencer", barra: "bg-sky-500" },
  { k: "d1_30", etiqueta: "1 a 30 días", barra: "bg-amber-400" },
  { k: "d31_60", etiqueta: "31 a 60 días", barra: "bg-orange-500" },
  { k: "d61_90", etiqueta: "61 a 90 días", barra: "bg-red-500" },
  { k: "mas_90", etiqueta: "Más de 90 días", barra: "bg-red-800 dark:bg-red-600" },
] as const;
export type ClaveTramo = (typeof TRAMOS)[number]["k"];
export const esClaveTramo = (v: string | null): v is ClaveTramo => !!v && TRAMOS.some((t) => t.k === v);

/** Fecha de hoy del navegador como 'YYYY-MM-DD' (el admin calcula la antigüedad con la fecha local). */
export const hoyLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Suma días a 'YYYY-MM-DD'. */
export const sumarDias = (fecha: string, dias: number) => {
  const d = new Date(`${fecha}T00:00:00`);
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Días entre dos fechas 'YYYY-MM-DD' (b − a). */
export const diasEntre = (a: string, b: string) =>
  Math.floor((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86400000);

/** Tramo de antigüedad de un saldo positivo, con la misma regla del admin (vence = vencimiento o, si falta, emisión). */
export const tramoDe = (vence: string | null, hoy: string): ClaveTramo => {
  const dias = vence ? diasEntre(vence, hoy) : 0;
  if (dias <= 0) return "por_vencer";
  if (dias <= 30) return "d1_30";
  if (dias <= 60) return "d31_60";
  if (dias <= 90) return "d61_90";
  return "mas_90";
};

// ── Documentos (facturas, notas de crédito y de débito) ──

export interface DocumentoCliente {
  id: string;
  numero: string;
  tipo: string;                 // factura | nota_credito
  es_nota_debito: boolean | null;
  estado: string;               // posted | cancel
  estado_cobro: string | null;  // pendiente | parcial | pagado | anulado
  fecha_emision: string | null;
  fecha_vencimiento: string | null;
  total_usd: number | null;
  saldo_usd: number | null;
}

export type ClaveEstadoDoc = "anulada" | "a_favor" | "aplicada" | "pagada" | "vencida" | "parcial" | "por_pagar";

export interface EstadoDoc {
  clave: ClaveEstadoDoc;
  etiqueta: string;
  tono: Tono;
  /** Días de vencida (solo si está vencida). */
  dias?: number;
}

export const etiquetaTipoDoc = (d: Pick<DocumentoCliente, "tipo" | "es_nota_debito">) =>
  d.tipo === "nota_credito" ? "Nota de crédito" : d.es_nota_debito ? "Nota de débito" : "Factura";

/** Estado de un documento para el cliente: pagada / parcial / vencida / por pagar / anulada (y para notas de crédito: a favor / aplicada). */
export const estadoDocumento = (d: DocumentoCliente, hoy: string): EstadoDoc => {
  if (d.estado === "cancel" || d.estado_cobro === "anulado") return { clave: "anulada", etiqueta: "Anulada", tono: "neutro" };
  const saldo = Number(d.saldo_usd ?? 0);
  if (d.tipo === "nota_credito") {
    return saldo < -TOLERANCIA ? { clave: "a_favor", etiqueta: "A favor", tono: "aprobado" } : { clave: "aplicada", etiqueta: "Aplicada", tono: "ok" };
  }
  if (saldo <= TOLERANCIA) return { clave: "pagada", etiqueta: "Pagada", tono: "ok" };
  const vence = d.fecha_vencimiento || d.fecha_emision;
  const dias = vence ? diasEntre(vence, hoy) : 0;
  if (dias > 0) return { clave: "vencida", etiqueta: "Vencida", tono: "riesgo", dias };
  if (d.estado_cobro === "parcial") return { clave: "parcial", etiqueta: "Pago parcial", tono: "proceso" };
  return { clave: "por_pagar", etiqueta: "Por pagar", tono: "pendiente" };
};

/** Un documento cuenta en la deuda si está publicado y tiene saldo positivo (regla de CxC del admin). */
export const cuentaEnDeuda = (d: DocumentoCliente) => d.estado === "posted" && Number(d.saldo_usd ?? 0) > TOLERANCIA;

// ── Estado de cuenta ──

export async function pedirEstadoCuenta(periodo: { desde: string | null; hasta: string | null }, conMovimientos = true) {
  const { data, error } = await supabase.rpc("estado_cuenta_portal", {
    p_desde: periodo.desde,
    p_hasta: periodo.hasta,
    p_movimientos: conMovimientos,
  });
  if (error) throw error;
  return data as EstadoCuenta;
}

/**
 * Estado de cuenta del cliente para un período. Conserva los datos anteriores mientras recarga (sin parpadeo) y descarta
 * respuestas viejas si el período cambia rápido.
 */
export function useEstadoCuenta(periodo: { desde: string | null; hasta: string | null }, conMovimientos = true) {
  const [datos, setDatos] = useState<EstadoCuenta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const turno = useRef(0);

  const cargar = useCallback(async () => {
    const mio = ++turno.current;
    setCargando(true);
    try {
      const d = await pedirEstadoCuenta(periodo, conMovimientos);
      if (mio !== turno.current) return;
      setDatos(d);
      setError(null);
    } catch (e) {
      if (mio !== turno.current) return;
      setError((e as Error).message || "No se pudo cargar el estado de cuenta");
    } finally {
      if (mio === turno.current) setCargando(false);
    }
  }, [periodo.desde, periodo.hasta, conMovimientos]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { cargar(); }, [cargar]);

  return { datos, cargando, error, recargar: cargar };
}

// ── Ficha de una factura ──

export interface FacturaItem {
  nombre: string;
  sku: string | null;
  producto_id: string | null;
  cantidad: number;
  precio_unitario: number;
  descuento: number | null;
  subtotal: number;
  total: number;
}

export interface FacturaAplicacion {
  tipo: "cobro" | "retencion" | "nota_credito" | "reintegro" | "ajuste";
  fecha: string | null;
  referencia: string | null;
  metodo: string | null;
  documento_id: string | null;
  monto_usd: number;
  origen: "odoo" | "guds";
}

export interface FacturaPortal extends DocumentoCliente {
  moneda: string | null;
  tasa_cambio: number | null;
  subtotal: number | null;
  impuesto: number | null;
  total: number | null;
  nro_control: string | null;
  motivo_anulacion: string | null;
  motivo_nota: string | null;
  anulada_at: string | null;
  hoy: string;
  orden: { id: string; numero: string } | null;
  origen: { id: string; numero: string } | null;
  items: FacturaItem[];
  aplicaciones: FacturaAplicacion[];
  aplicada_a: { factura_id: string; numero: string; fecha: string | null; monto_usd: number }[];
}

export async function pedirFactura(id: string) {
  const { data, error } = await supabase.rpc("factura_portal", { p_factura_id: id });
  if (error) throw error;
  return (data as FacturaPortal | null) ?? null;
}

// ── Ejecutivo de cuenta ──

export interface Ejecutivo { nombre: string; telefono: string | null; whatsapp: string | null }

export function useEjecutivo() {
  const [ejecutivo, setEjecutivo] = useState<Ejecutivo | null | undefined>(undefined); // undefined = cargando
  useEffect(() => {
    let vivo = true;
    supabase.rpc("mi_ejecutivo").then(({ data, error }) => {
      if (!vivo) return;
      setEjecutivo(error ? null : ((data as Ejecutivo | null) ?? null));
    });
    return () => { vivo = false; };
  }, []);
  return ejecutivo;
}

/** Monto con signo tipográfico: "−$12.50" en lugar de "$-12.50" (formatPrice no maneja negativos). */
export const conSigno = (formato: (n: number) => string, n: number) =>
  n < -0.004 ? `−${formato(-n)}` : formato(Math.abs(n) < 0.005 ? 0 : n);

/** Condición de pago legible: Odoo la trae en inglés ("30 Days", "Immediate Payment"). */
export const condicionPagoTexto = (c: string | null | undefined, dias?: number | null) => {
  const t = (c ?? "").trim();
  if (!t) return dias && dias > 0 ? `Crédito a ${dias} días` : null;
  if (/^immediate payment$/i.test(t) || /^contado$/i.test(t)) return "De contado";
  const m = t.match(/^(\d+)\s*(days?|d[ií]as?)$/i);
  if (m) return `Crédito a ${m[1]} días`;
  return t;
};
