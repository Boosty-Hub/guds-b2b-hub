-- ════════════════════════════════════════════════════════════════════════
-- Fase 22j (1/2) · Lo entregado y lo facturado de cada pedido de Odoo (para las notas de entrega, NE2 del plan de finanzas)
--   Respuestas de finanzas del 9-oct: la nota de entrega nace de un pedido de Odoo cuyo albarán ya se validó (la mercancía
--   salió del inventario de Odoo) y que todavía no tiene factura. Para saber qué falta por facturar, la sincronización trae:
--     · ordenes.estado_facturacion = sale.order.invoice_status (no · to invoice · invoiced · upselling)
--     · ordenes.fecha_despacho     = sale.order.effective_date (primer albarán validado)
--     · orden_items.cantidad_entregada / cantidad_facturada = sale.order.line.qty_delivered / qty_invoiced
--   Columnas nuevas y nulas: se agregan ANTES de desplegar la sincronización que las escribe (la sincronización escribe con
--   los disparadores apagados). Nada de esto escribe en Odoo.
-- ════════════════════════════════════════════════════════════════════════
begin;

alter table public.ordenes add column if not exists estado_facturacion text;
alter table public.ordenes add column if not exists fecha_despacho date;
alter table public.orden_items add column if not exists cantidad_entregada numeric(14,3);
alter table public.orden_items add column if not exists cantidad_facturada numeric(14,3);

comment on column public.ordenes.estado_facturacion is 'Estado de facturación del pedido en Odoo (sale.order.invoice_status): no, to invoice, invoiced, upselling (22j)';
comment on column public.ordenes.fecha_despacho is 'Fecha del primer albarán validado en Odoo (sale.order.effective_date, hora de Caracas) (22j)';
comment on column public.orden_items.cantidad_entregada is 'Cantidad entregada en Odoo (sale.order.line.qty_delivered) (22j)';
comment on column public.orden_items.cantidad_facturada is 'Cantidad facturada en Odoo (sale.order.line.qty_invoiced) (22j)';

create index if not exists ordenes_por_facturar on public.ordenes (empresa_id) where estado_facturacion = 'to invoice';

-- Los pedidos de Odoo son espejo: estas columnas, como las demás, solo las escribe la sincronización
drop trigger if exists c_proteger_espejo_odoo on public.ordenes;
create trigger c_proteger_espejo_odoo before delete or update on public.ordenes for each row
  execute function public.trg_proteger_espejo_odoo('numero', 'cliente_id', 'subtotal', 'impuesto', 'total', 'estado', 'estado_odoo',
    'moneda_original', 'fecha_pedido', 'vendedor_odoo', 'empresa_id', 'estado_facturacion', 'fecha_despacho');
drop trigger if exists c_proteger_espejo_odoo on public.orden_items;
create trigger c_proteger_espejo_odoo before delete or update on public.orden_items for each row
  execute function public.trg_proteger_espejo_odoo('orden_id', 'producto_id', 'nombre_producto', 'cantidad', 'precio_unitario', 'descuento',
    'subtotal', 'cantidad_entregada', 'cantidad_facturada');

commit;
