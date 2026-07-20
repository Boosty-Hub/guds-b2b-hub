-- =====================================================================
-- GUDS · FASE 6 — Módulo de Bancos + pagos con banco/moneda/tasa,
--                 pagos parciales y multi-método.
--   · bancos: cuentas para recibir dinero (nombre, método, moneda USD/BS)
--   · pagos: + banco_id, moneda, tasa_cambio, monto_moneda
--            (monto sigue siendo el equivalente en USD para liquidar la orden)
--   · liquidación: la orden queda 'pagado' solo cuando la suma de pagos
--            verificados (en USD) alcanza el total → soporta pago parcial y
--            multi-método (varios pagos por orden).
--   · registrar_pago(): RPC unificada (admin verifica; vendedor/cliente dejan pendiente)
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- Módulo 'bancos' para el motor de permisos
-- ---------------------------------------------------------------------
insert into modulos (codigo, nombre, descripcion, orden, activo)
values ('bancos', 'Bancos', 'Cuentas bancarias para recibir pagos', 17, true)
on conflict (codigo) do nothing;

-- ---------------------------------------------------------------------
-- Tabla bancos
-- ---------------------------------------------------------------------
create table if not exists public.bancos (
  id uuid primary key default gen_random_uuid(),
  nombre varchar not null,
  metodo_pago pago_metodo not null,
  moneda varchar not null default 'USD' check (moneda in ('USD','BS')),
  numero_cuenta varchar,
  titular varchar,
  documento varchar,
  activo boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
drop trigger if exists update_bancos_updated_at on public.bancos;
create trigger update_bancos_updated_at before update on public.bancos
  for each row execute function public.update_updated_at();

alter table public.bancos enable row level security;
drop policy if exists bancos_auth_read on public.bancos;
create policy bancos_auth_read on public.bancos for select to authenticated using (true);
drop policy if exists bancos_perm_crear on public.bancos;
create policy bancos_perm_crear on public.bancos for insert to authenticated with check (public.puede('bancos','crear'));
drop policy if exists bancos_perm_editar on public.bancos;
create policy bancos_perm_editar on public.bancos for update to authenticated using (public.puede('bancos','editar')) with check (public.puede('bancos','editar'));
drop policy if exists bancos_perm_eliminar on public.bancos;
create policy bancos_perm_eliminar on public.bancos for delete to authenticated using (public.puede('bancos','eliminar'));

-- ---------------------------------------------------------------------
-- pagos: columnas de banco / moneda / tasa
-- ---------------------------------------------------------------------
alter table public.pagos add column if not exists banco_id uuid references public.bancos(id);
alter table public.pagos add column if not exists moneda varchar not null default 'USD';
alter table public.pagos add column if not exists tasa_cambio numeric;
alter table public.pagos add column if not exists monto_moneda numeric;

-- ---------------------------------------------------------------------
-- Liquidación: la orden queda pagada cuando lo verificado (USD) cubre el total
-- ---------------------------------------------------------------------
create or replace function public.liquidar_orden(p_orden_id uuid)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if p_orden_id is null then return; end if;
  update ordenes o set pagado = (
    coalesce((select sum(monto) from pagos where orden_id = o.id and estado = 'verificado'), 0) >= o.total
  ) where o.id = p_orden_id;
end;
$fn$;

-- verificar_pago ahora liquida por suma (soporta parcial/multi-método)
create or replace function public.verificar_pago(
  p_pago_id uuid, p_aprobar boolean, p_notas text default null
) returns void language plpgsql security definer set search_path = public as $fn$
declare v_admin_id uuid; v_orden_id uuid;
begin
  if not public.is_admin() then raise exception 'Solo un administrador puede verificar pagos'; end if;
  select id into v_admin_id from usuarios where auth_id = auth.uid();
  select orden_id into v_orden_id from pagos where id = p_pago_id;
  if not found then raise exception 'Pago no encontrado'; end if;

  update pagos set
    estado = (case when p_aprobar then 'verificado' else 'rechazado' end)::pago_estado,
    verificado_por = v_admin_id, fecha_verificacion = now(), notas = coalesce(p_notas, notas)
  where id = p_pago_id;

  perform public.liquidar_orden(v_orden_id);
end;
$fn$;

-- ---------------------------------------------------------------------
-- RPC unificada para registrar un pago (con banco/moneda/tasa)
--   admin -> queda 'verificado' y liquida; vendedor/cliente -> 'pendiente'
-- ---------------------------------------------------------------------
create or replace function public.registrar_pago(
  p_cliente_id uuid,
  p_orden_id uuid,
  p_banco_id uuid,
  p_metodo pago_metodo,
  p_monto_moneda numeric,
  p_moneda text default 'USD',
  p_tasa_cambio numeric default null,
  p_referencia text default null
) returns uuid
language plpgsql security definer set search_path = public
as $fn$
declare
  v_es_admin boolean := public.is_admin();
  v_autorizado boolean;
  v_monto_usd numeric;
  v_id uuid;
  v_admin_id uuid;
begin
  v_autorizado := v_es_admin
    or public.es_vendedor_de(p_cliente_id)
    or exists (select 1 from usuarios where auth_id = auth.uid() and cliente_id = p_cliente_id);
  if not v_autorizado then raise exception 'No autorizado para registrar este pago'; end if;
  if p_monto_moneda is null or p_monto_moneda <= 0 then raise exception 'Monto inválido'; end if;

  if p_moneda = 'BS' then
    if coalesce(p_tasa_cambio, 0) <= 0 then raise exception 'Falta la tasa de cambio para un pago en bolívares'; end if;
    v_monto_usd := round(p_monto_moneda / p_tasa_cambio, 2);
  else
    v_monto_usd := p_monto_moneda;
  end if;

  insert into pagos (cliente_id, orden_id, banco_id, metodo, monto, monto_moneda, moneda, tasa_cambio, referencia, estado, verificado_por, fecha_verificacion)
  values (
    p_cliente_id, p_orden_id, p_banco_id, p_metodo, v_monto_usd, p_monto_moneda,
    coalesce(p_moneda,'USD'), case when p_moneda = 'BS' then p_tasa_cambio else null end, p_referencia,
    (case when v_es_admin then 'verificado' else 'pendiente' end)::pago_estado,
    case when v_es_admin then (select id from usuarios where auth_id = auth.uid()) else null end,
    case when v_es_admin then now() else null end
  ) returning id into v_id;

  if v_es_admin then
    perform public.liquidar_orden(p_orden_id);
  end if;

  return v_id;
end;
$fn$;
revoke all on function public.registrar_pago(uuid, uuid, uuid, pago_metodo, numeric, text, numeric, text) from public;
grant execute on function public.registrar_pago(uuid, uuid, uuid, pago_metodo, numeric, text, numeric, text) to authenticated;

commit;
