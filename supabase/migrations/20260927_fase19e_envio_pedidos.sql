-- ════════════════════════════════════════════════════════════════════════
-- Fase 19e · Envío de pedidos de GUDS a Odoo (Fase 9b)
--   numero_guds: número original del pedido en GUDS (al quedar ligado a Odoo, `numero` pasa a ser el de Odoo, como
--   el resto del espejo). odoo_enviado_at / odoo_envio_error: seguimiento del envío.
-- ════════════════════════════════════════════════════════════════════════
begin;
alter table public.ordenes add column if not exists numero_guds text;
alter table public.ordenes add column if not exists odoo_enviado_at timestamptz;
alter table public.ordenes add column if not exists odoo_envio_error text;
comment on column public.ordenes.numero_guds is 'Número del pedido en GUDS antes de enviarse a Odoo';
comment on column public.ordenes.odoo_enviado_at is 'Cuándo se creó en Odoo desde GUDS (Fase 9b)';
comment on column public.ordenes.odoo_envio_error is 'Último error al enviar a Odoo';
commit;
