// Reglas compartidas de la edición de pedidos «Por aprobar» (portal del cliente y del vendedor).

// pagado / falta / a_favor: lo ya pagado frente al total nuevo (migración 19x)
export interface ResultadoEdicion { orden_id: string; numero: string; total: number; pagado?: number; falta?: number; a_favor?: number }

/** Mientras está por aprobar y no llegó a Odoo (misma condición que exige editar_pedido_pendiente en el servidor). */
export const pedidoEditable = (o: { aprobacion?: string | null; estado: string; odoo_id?: number | null }) =>
  o.aprobacion === "pendiente" && o.estado === "pendiente" && o.odoo_id == null;

/** Mensaje de error de la RPC cuando el pedido dejó de estar pendiente (lo aprobaron, lo rechazaron o cambió de estado). */
export const esErrorNoEditable = (mensaje: string) => /Solo se editan pedidos pendientes|Pedido no encontrado/i.test(mensaje);
