-- ════════════════════════════════════════════════════════════════════════
-- Fase 18k · Saldo del último extracto y cuentas contables compartidas entre diarios de Odoo
--   Si dos diarios de Odoo usan la misma cuenta contable, su saldo contable no se puede separar: se muestra el del extracto.
-- ════════════════════════════════════════════════════════════════════════
begin;

alter table public.bancos
  add column if not exists saldo_extracto numeric,
  add column if not exists cuenta_compartida boolean not null default false;

drop trigger if exists c_proteger_espejo_odoo on public.bancos;
create trigger c_proteger_espejo_odoo before update or delete on public.bancos for each row
  execute function public.trg_proteger_espejo_odoo('nombre', 'moneda', 'tipo_odoo', 'activo', 'empresa_id', 'saldo_odoo', 'saldo_odoo_usd',
    'saldo_odoo_at', 'cuenta_odoo', 'saldo_extracto', 'cuenta_compartida');

commit;
