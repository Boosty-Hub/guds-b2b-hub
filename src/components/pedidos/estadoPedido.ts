// Estado visible de un pedido: el mismo contrato para el admin, el vendedor y el cliente (docs/PLAN-PORTALES-Y-FLUJOS.md §3).
// Combina la aprobación de GUDS, el estado en Odoo y el despacho; el pago va aparte.

export interface PedidoParaEstado {
  aprobacion?: string | null;      // pendiente / aprobada / rechazada (pedidos creados en GUDS)
  estado: string;                  // pendiente / confirmado / procesando / enviado / completado / cancelado
  estado_odoo?: string | null;     // draft / sent / sale / done / cancel
  odoo_id?: number | null;
  odoo_envio_error?: string | null;
}

export type ClaveEstado = "rechazado" | "cancelado" | "por_aprobar" | "registrandose" | "cotizacion" | "confirmado" | "en_preparacion"
  | "despachado_parcial" | "entregado";

export interface EstadoVisible {
  clave: ClaveEstado;
  etiqueta: string;
  /** Tono para la insignia: riesgo, neutro, pendiente, aprobado, proceso, ok */
  tono: "riesgo" | "neutro" | "pendiente" | "aprobado" | "proceso" | "ok";
  /** Texto para el cliente (el admin ve además los detalles técnicos, p. ej. el error de envío a Odoo). */
  mensaje: string;
}

export const estadoVisible = (p: PedidoParaEstado): EstadoVisible => {
  if (p.aprobacion === "rechazada") return { clave: "rechazado", etiqueta: "No aprobado", tono: "riesgo", mensaje: "El pedido no fue aprobado." };
  if (p.estado === "cancelado" || p.estado_odoo === "cancel") return { clave: "cancelado", etiqueta: "Cancelado", tono: "neutro", mensaje: "El pedido fue cancelado." };
  if (p.aprobacion === "pendiente") {
    return { clave: "por_aprobar", etiqueta: "Por aprobar", tono: "pendiente", mensaje: "Recibimos tu pedido. Nuestro equipo lo revisa (precios, stock y crédito) y te avisaremos al aprobarlo." };
  }
  if (p.aprobacion === "aprobada" && (!p.odoo_id || p.estado_odoo === "draft" || p.estado_odoo === "sent")) {
    return { clave: "registrandose", etiqueta: "Aprobado", tono: "aprobado", mensaje: "Aprobado. Se está registrando para su preparación." };
  }
  if (p.estado === "completado") return { clave: "entregado", etiqueta: "Despachado", tono: "ok", mensaje: "Tu pedido salió del almacén." };
  if (p.estado === "enviado") return { clave: "despachado_parcial", etiqueta: "Despacho parcial", tono: "proceso", mensaje: "Parte de tu pedido ya salió del almacén." };
  if (p.estado === "procesando") return { clave: "en_preparacion", etiqueta: "En preparación", tono: "proceso", mensaje: "Confirmado. Lo estamos preparando." };
  if (p.estado === "confirmado" || p.estado_odoo === "sale" || p.estado_odoo === "done") {
    return { clave: "confirmado", etiqueta: "Confirmado", tono: "aprobado", mensaje: "Confirmado. En cola de preparación." };
  }
  return { clave: "cotizacion", etiqueta: "Cotización", tono: "pendiente", mensaje: "Cotización en revisión." };
};

/** Clases de la insignia por tono (tokens del tema). */
export const claseTono: Record<EstadoVisible["tono"], string> = {
  riesgo: "border-destructive/40 bg-destructive/10 text-destructive",
  neutro: "border-border bg-muted text-muted-foreground",
  pendiente: "border-amber-300 bg-amber-100 text-amber-900",
  aprobado: "border-sky-300 bg-sky-50 text-sky-900",
  proceso: "border-indigo-300 bg-indigo-50 text-indigo-900",
  ok: "border-success/40 bg-success/10 text-success",
};
