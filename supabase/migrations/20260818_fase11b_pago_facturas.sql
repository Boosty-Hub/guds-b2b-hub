begin;

-- Fase 11b: puente pago↔factura (asignación manual) + cache de aplicado + vista de anticipos.

create table if not exists public.pago_facturas (
  id uuid primary key default gen_random_uuid(),
  pago_id uuid not null references public.pagos(id) on delete cascade,
  factura_id uuid not null references public.facturas(id) on delete restrict,
  monto_aplicado numeric not null check (monto_aplicado > 0), -- USD
  created_at timestamptz not null default now(),
  created_by uuid references public.usuarios(id),
  unique (pago_id, factura_id)
);

comment on table public.pago_facturas is 'Asignación MANUAL de un pago a una o varias facturas (Fase 11). Fuente de verdad de facturas.monto_aplicado_usd.';

create index if not exists pago_facturas_factura_idx on public.pago_facturas(factura_id);
create index if not exists pago_facturas_pago_idx on public.pago_facturas(pago_id);

alter table public.pago_facturas enable row level security;

create policy pago_facturas_perm_ver on public.pago_facturas
  for select to authenticated using (public.puede('cuentas','ver'));
create policy pago_facturas_perm_crear on public.pago_facturas
  for insert to authenticated with check (public.puede('cuentas','crear'));
create policy pago_facturas_perm_editar on public.pago_facturas
  for update to authenticated using (public.puede('cuentas','editar')) with check (public.puede('cuentas','editar'));
create policy pago_facturas_perm_eliminar on public.pago_facturas
  for delete to authenticated using (public.puede('cuentas','eliminar'));
create policy pago_facturas_cliente_read on public.pago_facturas
  for select to authenticated using (
    factura_id in (select f.id from public.facturas f join public.usuarios u on u.cliente_id = f.cliente_id where u.auth_id = auth.uid())
  );
create policy pago_facturas_vendedor_read on public.pago_facturas
  for select to authenticated using (
    factura_id in (select f.id from public.facturas f where f.cliente_id in (select public.mis_clientes_vendedor()))
  );

-- Trigger: pago_facturas es la fuente de verdad de facturas.monto_aplicado_usd.
-- Solo cuenta lo aplicado por pagos ya 'verificado' (un pago pendiente no reduce deuda).
create or replace function public.trg_recalc_factura_aplicado()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_factura_id uuid := coalesce(new.factura_id, old.factura_id);
begin
  update public.facturas f
  set monto_aplicado_usd = coalesce((
    select round(sum(pf.monto_aplicado), 2)
    from public.pago_facturas pf
    join public.pagos p on p.id = pf.pago_id
    where pf.factura_id = f.id and p.estado = 'verificado'
  ), 0)
  where f.id = v_factura_id;
  return null;
end;
$$;

drop trigger if exists trg_pf_recalc on public.pago_facturas;
create trigger trg_pf_recalc
  after insert or update or delete on public.pago_facturas
  for each row execute function public.trg_recalc_factura_aplicado();

-- También recalcular si un pago cambia de estado (ej. queda 'verificado' después de estar 'pendiente').
create or replace function public.trg_recalc_factura_aplicado_por_pago()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.estado is distinct from old.estado then
    update public.facturas f
    set monto_aplicado_usd = coalesce((
      select round(sum(pf.monto_aplicado), 2)
      from public.pago_facturas pf
      join public.pagos p on p.id = pf.pago_id
      where pf.factura_id = f.id and p.estado = 'verificado'
    ), 0)
    where f.id in (select pf2.factura_id from public.pago_facturas pf2 where pf2.pago_id = new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_pago_estado_recalc on public.pagos;
create trigger trg_pago_estado_recalc
  after update on public.pagos
  for each row execute function public.trg_recalc_factura_aplicado_por_pago();

-- Anticipos: derivados de pagos verificados sin asignar por completo. Se excluyen los pagos
-- históricos importados de Odoo (odoo_id not null) para no mostrar 1.418 "anticipos" falsos.
create or replace view public.v_anticipos
with (security_invoker = on) as
select
  p.id as pago_id,
  p.numero,
  p.cliente_id,
  p.created_at,
  p.monto as monto_usd,
  coalesce((select sum(pf.monto_aplicado) from public.pago_facturas pf where pf.pago_id = p.id), 0) as aplicado,
  round(p.monto - coalesce((select sum(pf.monto_aplicado) from public.pago_facturas pf where pf.pago_id = p.id), 0), 2) as disponible
from public.pagos p
where p.estado = 'verificado' and p.odoo_id is null;

comment on view public.v_anticipos is 'Saldo a favor por pago verificado (monto - aplicado a facturas). security_invoker=on: hereda RLS de pagos.';

commit;
