-- ════════════════════════════════════════════════════════════════════════
-- Fase 18t · Diario de Odoo en facturas
--   Para reportes de ventas hay que distinguir documentos que no son venta del período:
--   · "Nota debito cliente" en Bs con cuenta Diferencia en cambio y 0 en USD (ajustes cambiarios),
--   · "Diario Saldo Inicial CXC" / "ND CxC Saldos Iniciales" (saldos de apertura migrados a Odoo).
--   El importador guarda el nombre del diario; es_saldo_inicial se calcula a partir de él.
-- ════════════════════════════════════════════════════════════════════════
begin;
alter table public.facturas add column if not exists diario_odoo text;
alter table public.facturas add column if not exists es_saldo_inicial boolean
  generated always as (coalesce(diario_odoo, '') ~* 'saldos? inicial') stored;
comment on column public.facturas.diario_odoo is 'Diario (journal) del documento en Odoo';
comment on column public.facturas.es_saldo_inicial is 'Documento de saldo de apertura migrado a Odoo (no es venta del período)';
commit;
