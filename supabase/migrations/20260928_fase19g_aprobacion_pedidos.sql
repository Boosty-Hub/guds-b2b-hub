-- ════════════════════════════════════════════════════════════════════════
-- Fase 19g · Aprobación de pedidos antes de enviarlos a Odoo (Fase 9b)
--   Regla del negocio (28-sep): todo pedido que entra desde el portal del cliente o del vendedor queda "por aprobar"
--   en el admin; al aprobarlo, GUDS lo crea en Odoo como cotización en borrador (con el envío como línea de servicio)
--   y sigue el flujo de Odoo. Los pedidos que crea el propio admin nacen aprobados.
--   Rechazar = cancelar con motivo (libera el stock comprometido y avisa al cliente y al vendedor).
--   El envío a Odoo lo hace la función edge sync-odoo (?enviar=<id>) disparada por pg_net con el secreto de Vault; la
--   sincronización periódica reintenta los aprobados que no llegaron a enviarse.
-- ════════════════════════════════════════════════════════════════════════
begin;

alter table public.ordenes add column if not exists aprobacion text;
alter table public.ordenes drop constraint if exists ordenes_aprobacion_check;
alter table public.ordenes add constraint ordenes_aprobacion_check check (aprobacion in ('pendiente', 'aprobada', 'rechazada'));
alter table public.ordenes add column if not exists aprobado_por uuid references public.usuarios(id) on delete set null;
alter table public.ordenes add column if not exists aprobado_at timestamptz;
alter table public.ordenes add column if not exists rechazo_motivo text;
alter table public.ordenes add column if not exists odoo_envio_aviso text;
comment on column public.ordenes.aprobacion is 'Pedidos de GUDS: pendiente | aprobada | rechazada (null en órdenes que vienen de Odoo)';
comment on column public.ordenes.odoo_envio_aviso is 'Aviso del envío a Odoo que no impide crearlo (p. ej. falta el producto de servicio de envío)';

-- Pedido de prueba S00927 (enviado a mano el 27-sep antes de esta regla)
update public.ordenes set aprobacion = 'aprobada', aprobado_at = odoo_enviado_at where odoo_id = 1784 and aprobacion is null;

-- Producto de servicio de envío en Odoo (código interno), por empresa. Vacío = el envío va como línea de nota.
insert into public.configuracion (clave, valor, descripcion)
select 'odoo_producto_envio', '', 'Código interno (default_code) del producto de servicio de envío en Odoo; vacío = el envío va como nota en la cotización'
where not exists (select 1 from public.configuracion where clave = 'odoo_producto_envio');

-- Estado de aprobación inicial de los pedidos creados en GUDS
create or replace function public.trg_orden_aprobacion() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_usuario uuid; v_admin boolean;
begin
  if new.odoo_id is not null or new.aprobacion is not null then return new; end if;
  select u.id, u.role = 'admin' into v_usuario, v_admin from usuarios u where u.auth_id = auth.uid();
  if coalesce(v_admin, false) then
    new.aprobacion := 'aprobada'; new.aprobado_por := v_usuario; new.aprobado_at := now();
  else
    new.aprobacion := 'pendiente';
  end if;
  return new;
end $$;
drop trigger if exists a_orden_aprobacion on public.ordenes;
create trigger a_orden_aprobacion before insert on public.ordenes for each row execute function public.trg_orden_aprobacion();

-- Disparo del envío a Odoo (pg_net → función edge). Se ejecuta al confirmar la transacción.
create or replace function public.disparar_envio_pedido(p_orden_id uuid) returns bigint
language sql security definer set search_path = public as $$
  select net.http_post(
    url := 'https://oyyxkbwtyxdpzsgarmim.supabase.co/functions/v1/sync-odoo?enviar=' || p_orden_id::text,
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_odoo_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000);
$$;
revoke execute on function public.disparar_envio_pedido(uuid) from public, anon, authenticated;

-- Los pedidos que crea el admin (ya aprobados) salen a Odoo al guardarse
create or replace function public.trg_orden_enviar_si_aprobada() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.odoo_id is null and new.aprobacion = 'aprobada' then perform public.disparar_envio_pedido(new.id); end if;
  return null;
end $$;
drop trigger if exists y_orden_enviar_si_aprobada on public.ordenes;
create trigger y_orden_enviar_si_aprobada after insert on public.ordenes for each row execute function public.trg_orden_enviar_si_aprobada();

create or replace function public.aprobar_pedido(p_orden_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare o record; v_usuario uuid;
begin
  if not (select public.puede('ordenes', 'editar')) then raise exception 'No tienes permiso para aprobar pedidos' using errcode = '42501'; end if;
  select * into o from ordenes where id = p_orden_id for update;
  if not found then raise exception 'Pedido no encontrado'; end if;
  if not (o.empresa_id = any(public.empresas_visibles())) then raise exception 'Este pedido pertenece a otra empresa. Cámbiala en el menú superior.'; end if;
  if o.odoo_id is not null then raise exception 'El pedido ya está en Odoo'; end if;
  if o.aprobacion <> 'pendiente' then raise exception 'El pedido no está pendiente de aprobación (estado: %)', o.aprobacion; end if;
  if o.estado = 'cancelado' then raise exception 'El pedido está cancelado'; end if;
  select id into v_usuario from usuarios where auth_id = auth.uid();
  update ordenes set aprobacion = 'aprobada', aprobado_por = v_usuario, aprobado_at = now(), odoo_envio_error = null, updated_at = now()
  where id = p_orden_id;
  perform public.disparar_envio_pedido(p_orden_id);
  perform notif_cliente(o.cliente_id, 'Pedido aprobado', 'Tu pedido ' || o.numero || ' fue aprobado y pasa a preparación.', 'orden', '/portal/pedidos');
  perform notif_vendedor(o.cliente_id, 'Pedido aprobado', o.numero || ' fue aprobado.', 'orden', '/vendedor/pedidos');
  return jsonb_build_object('ok', true, 'mensaje', 'Pedido aprobado; se está creando en Odoo como cotización');
end $$;

create or replace function public.rechazar_pedido(p_orden_id uuid, p_motivo text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare o record; v_usuario uuid;
begin
  if not (select public.puede('ordenes', 'editar')) then raise exception 'No tienes permiso para rechazar pedidos' using errcode = '42501'; end if;
  if nullif(trim(coalesce(p_motivo, '')), '') is null then raise exception 'Indica el motivo del rechazo'; end if;
  select * into o from ordenes where id = p_orden_id for update;
  if not found then raise exception 'Pedido no encontrado'; end if;
  if not (o.empresa_id = any(public.empresas_visibles())) then raise exception 'Este pedido pertenece a otra empresa. Cámbiala en el menú superior.'; end if;
  if o.odoo_id is not null then raise exception 'El pedido ya está en Odoo: se anula en Odoo'; end if;
  if o.aprobacion <> 'pendiente' then raise exception 'El pedido no está pendiente de aprobación'; end if;
  select id into v_usuario from usuarios where auth_id = auth.uid();
  update ordenes set aprobacion = 'rechazada', rechazo_motivo = trim(p_motivo), aprobado_por = v_usuario, aprobado_at = now(),
    estado = 'cancelado', updated_at = now()
  where id = p_orden_id;
  return jsonb_build_object('ok', true, 'mensaje', 'Pedido rechazado');
end $$;

create or replace function public.reintentar_envio_pedido(p_orden_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare o record;
begin
  if not (select public.puede('ordenes', 'editar')) then raise exception 'Sin permiso' using errcode = '42501'; end if;
  select * into o from ordenes where id = p_orden_id;
  if not found or o.odoo_id is not null or o.aprobacion <> 'aprobada' then raise exception 'Solo se reintentan pedidos aprobados que aún no están en Odoo'; end if;
  update ordenes set odoo_envio_error = null where id = p_orden_id;
  perform public.disparar_envio_pedido(p_orden_id);
  return jsonb_build_object('ok', true, 'mensaje', 'Reintentando el envío a Odoo');
end $$;

-- Avisos: al crearse, el pedido del cliente/vendedor queda "por aprobar"; el rechazo lleva su motivo
create or replace function public.trg_orden_creada() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_cli text; v_pend boolean := coalesce(new.aprobacion, '') = 'pendiente';
begin
  select nombre_negocio into v_cli from clientes where id = new.cliente_id;
  perform notif_admins(case when v_pend then 'Pedido por aprobar ' else 'Nueva orden ' end || new.numero,
    coalesce(v_cli, 'Cliente') || ' · ' || fmt_usd(new.total), case when v_pend then 'alerta' else 'orden' end, '/admin/ordenes?aprobacion=pendiente');
  perform notif_cliente(new.cliente_id, 'Pedido recibido',
    'Tu pedido ' || new.numero || ' por ' || fmt_usd(new.total) || case when v_pend then ' fue recibido y está pendiente de aprobación.' else ' fue registrado.' end,
    'orden', '/portal/pedidos');
  if new.vendedor_id is null then
    perform notif_vendedor(new.cliente_id, 'Tu cliente hizo un pedido', coalesce(v_cli, 'Cliente') || ': ' || new.numero || ' por ' || fmt_usd(new.total), 'orden', '/vendedor/pedidos');
  end if;
  return new;
end $$;

create or replace function public.trg_orden_estado() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_cli text; v_lbl text; v_tipo text;
begin
  if new.estado is not distinct from old.estado then return new; end if;
  if new.estado::text not in ('confirmado', 'procesando', 'enviado', 'completado', 'cancelado') then return new; end if;
  select nombre_negocio into v_cli from clientes where id = new.cliente_id;
  if new.estado::text = 'cancelado' and new.aprobacion = 'rechazada' then
    perform notif_cliente(new.cliente_id, 'Pedido no aprobado', 'Tu pedido ' || new.numero || ' no fue aprobado: ' || coalesce(new.rechazo_motivo, 'sin motivo') || '.', 'alerta', '/portal/pedidos');
    perform notif_vendedor(new.cliente_id, 'Pedido no aprobado', new.numero || ' de ' || coalesce(v_cli, 'cliente') || ': ' || coalesce(new.rechazo_motivo, ''), 'alerta', '/vendedor/pedidos');
    return new;
  end if;
  v_lbl := case new.estado::text when 'confirmado' then 'confirmado' when 'procesando' then 'en preparación' when 'enviado' then 'en camino'
    when 'completado' then 'entregado' when 'cancelado' then 'cancelado' else new.estado::text end;
  v_tipo := case new.estado::text when 'cancelado' then 'alerta' when 'completado' then 'exito' else 'orden' end;
  perform notif_cliente(new.cliente_id, 'Pedido ' || v_lbl, 'Tu pedido ' || new.numero || ' está ' || v_lbl || '.', v_tipo, '/portal/pedidos');
  if new.estado::text = 'completado' then
    perform notif_admins('Pedido completado', new.numero || ' de ' || coalesce(v_cli, 'cliente'), 'exito', '/admin/ordenes');
  elsif new.estado::text = 'cancelado' then
    perform notif_vendedor(new.cliente_id, 'Pedido cancelado', new.numero || ' de ' || coalesce(v_cli, 'cliente'), 'alerta', '/vendedor/pedidos');
  end if;
  return new;
end $$;

grant execute on function public.aprobar_pedido(uuid) to authenticated;
grant execute on function public.rechazar_pedido(uuid, text) to authenticated;
grant execute on function public.reintentar_envio_pedido(uuid) to authenticated;
revoke execute on function public.aprobar_pedido(uuid) from public, anon;
revoke execute on function public.rechazar_pedido(uuid, text) from public, anon;
revoke execute on function public.reintentar_envio_pedido(uuid) from public, anon;
commit;
