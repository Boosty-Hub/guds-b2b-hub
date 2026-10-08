// Notas de entrega no fiscales (22g · NE1 del plan de reportes de finanzas): deuda interna que no está en Odoo ni en el libro
// fiscal. Por ahora solo consulta: las históricas se cargaron del Excel de finanzas (serie HIST). Emitir, abonar y convertir
// en factura llegan en NE2–NE3, con las respuestas de finanzas.

export type EstadoNota = "borrador" | "emitida" | "abonada" | "pagada" | "facturada" | "devuelta" | "anulada";
export type ClasificacionNota = "activa" | "incobrable";

/** Fila de la vista v_notas_entrega. */
export interface NotaEntrega {
  id: string;
  empresa_id: string;
  serie: "NE" | "TAL" | "HIST";
  numero: string;
  documento: string;
  cliente_id: string | null;
  cliente: string;
  rif: string | null;
  cliente_nombre: string;
  vendedor: string | null;
  orden_id: string | null;
  pedido_odoo: string | null;
  fecha_emision: string;
  fecha_vencimiento: string;
  moneda: "USD" | "BS";
  tasa: number | null;
  total_usd: number;
  abonado: number;
  saldo_usd: number;
  estado: EstadoNota;
  clasificacion: ClasificacionNota;
  clasificacion_origen: "nota" | "cliente" | null;
  observacion: string | null;
  origen: "excel" | "guds";
  archivo: string | null;
  created_at: string;
  updated_at: string;
  movimientos: number;
}

export interface MovimientoNota {
  id: string; tipo: "abono" | "descuento" | "devolucion" | "facturada" | "ajuste"; fecha: string | null; monto_usd: number;
  referencia: string | null; nota: string | null; origen: "excel" | "guds"; pago_id: string | null; factura_id: string | null; created_at: string;
}

export interface ItemNota { id: string; descripcion: string; cantidad: number; precio_usd: number; subtotal_usd: number; orden: number }

export const ESTADO_NOTA: Record<EstadoNota, { texto: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  borrador: { texto: "Borrador", variant: "outline" },
  emitida: { texto: "Emitida", variant: "secondary" },
  abonada: { texto: "Abonada", variant: "secondary" },
  pagada: { texto: "Pagada", variant: "default" },
  facturada: { texto: "Facturada", variant: "default" },
  devuelta: { texto: "Devuelta", variant: "outline" },
  anulada: { texto: "Anulada", variant: "destructive" },
};

export const SERIE_NOTA: Record<NotaEntrega["serie"], string> = {
  NE: "Correlativo de GUDS", TAL: "Talonario físico", HIST: "Histórica (Excel de finanzas)",
};

export const MOVIMIENTO_NOTA: Record<MovimientoNota["tipo"], string> = {
  abono: "Abono", descuento: "Descuento", devolucion: "Devolución", facturada: "Facturada (pasa a factura fiscal)", ajuste: "Ajuste",
};

export const abierta = (n: Pick<NotaEntrega, "estado" | "saldo_usd">) => n.estado !== "anulada" && n.estado !== "borrador" && Number(n.saldo_usd) > 0.009;
