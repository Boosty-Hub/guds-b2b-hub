// Notas de entrega no fiscales (22g · NE1 y 22j · NE2–NE3 del plan de reportes de finanzas): deuda interna que no está en
// Odoo ni en el libro fiscal. Nacen de un pedido de Odoo con su albarán validado y aún sin factura (la mercancía ya salió de
// Odoo), sin IVA y con serie NE por empresa. Los abonos se enlazan al cobro de Odoo por el que entró el dinero; pueden
// terminar pagadas sin factura o pasar a factura (total o en parte). Cuentan como venta por lo que no pasó a factura.

export type EstadoNota = "borrador" | "emitida" | "abonada" | "pagada" | "facturada" | "devuelta" | "anulada";
export type ClasificacionNota = "activa" | "incobrable";
export type TipoMovimientoNota = "abono" | "descuento" | "devolucion" | "facturada" | "ajuste";

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
  /** Lo que bajó el saldo (total − saldo): abonos vigentes, lo facturado, devoluciones, descuentos y ajustes. */
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
  // 22j
  abonos: number;
  facturado: number;
  devuelto: number;
  descontado: number;
  ajustes: number;
  /** Lo que la nota vende y no pasó a factura (cuenta como venta). */
  sin_facturar: number;
  ultimo_movimiento: string | null;
  anulada_at: string | null;
  motivo_anulacion: string | null;
  vendedor_id: string | null;
}

export interface MovimientoNota {
  id: string; tipo: TipoMovimientoNota; fecha: string | null; monto_usd: number;
  referencia: string | null; nota: string | null; origen: "excel" | "guds"; pago_id: string | null; factura_id: string | null; created_at: string;
  /** Abono que pasó a la factura (fecha): ya no cuenta en la nota y su cobro vuelve a ser anticipo para aplicarlo en Odoo. */
  trasladado: string | null;
}

export interface ItemNota {
  id: string; descripcion: string; cantidad: number; precio_usd: number; subtotal_usd: number; orden: number; orden_item_id: string | null;
}

/** Línea de un pedido de Odoo con lo entregado y aún sin facturar (pedidos_para_nota_entrega). */
export interface LineaPendiente {
  orden_item_id: string; producto_id: string | null; descripcion: string; sku: string | null;
  entregada: number; facturada: number; en_ne: number; pendiente: number; precio: number; subtotal: number;
}

/** Pedido de Odoo entregado y sin facturar del que puede nacer una nota de entrega. */
export interface PedidoParaNota {
  orden_id: string; numero: string; empresa_id: string; cliente_id: string | null; cliente: string | null; rif: string | null;
  vendedor: string | null; fecha: string | null; despacho: string | null; facturacion: string | null; dias_credito: number | null;
  con_ne: boolean; pendiente_usd: number; lineas: LineaPendiente[];
}

/** Cobro de Odoo sin aplicar del cliente (cobros_para_nota_entrega). */
export interface CobroParaNota {
  pago_id: string; numero: string | null; fecha: string | null; monto: number; disponible: number; referencia: string | null;
  moneda: "USD" | "VES"; banco: string | null; vinculado_ne: number;
}

/** Factura candidata para pasar la nota a factura (conversion_nota_entrega). */
export interface FacturaParaNota { factura_id: string; numero: string; fecha: string; base: number; del_pedido: boolean; sugerido: number }

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

export const MOVIMIENTO_NOTA: Record<TipoMovimientoNota, string> = {
  abono: "Abono", descuento: "Descuento", devolucion: "Devolución", facturada: "Pasó a factura", ajuste: "Ajuste",
};

export const abierta = (n: Pick<NotaEntrega, "estado" | "saldo_usd">) => n.estado !== "anulada" && n.estado !== "borrador" && Number(n.saldo_usd) > 0.009;
export const vigente = (n: Pick<NotaEntrega, "estado">) => n.estado !== "anulada" && n.estado !== "borrador";
