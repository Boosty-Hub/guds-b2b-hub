-- ════════════════════════════════════════════════════════════════════════
-- Fase 19y · Calle y complemento por separado (como en Odoo: street / street2)
--   GUDS guardaba la dirección con street y street2 unidos; al editarla desde GUDS se escribía todo en street y street2
--   quedaba vacío en Odoo. Ahora la ficha y las direcciones de entrega guardan también calle y complemento, que llena la
--   sincronización, y el editor los usa tal cual.
-- ════════════════════════════════════════════════════════════════════════
begin;

alter table public.clientes add column if not exists calle text, add column if not exists complemento text;
alter table public.cliente_direcciones add column if not exists calle text, add column if not exists complemento text;

commit;
