-- ============================================================================
-- FASE 9: Centro de notificaciones — el sistema crea notificaciones en cada
-- evento relevante y las dirige al usuario correcto (admin/cliente/vendedor/delivery).
-- Se implementa con triggers SECURITY DEFINER para que disparen sin importar
-- quién ejecute la acción (portal, vendedor, admin, RPC).
-- ============================================================================

-- ---- Helpers -------------------------------------------------------------
create or replace function public.fmt_usd(n numeric)
returns text language sql immutable as $$
  select '$' || to_char(coalesce(n,0), 'FM999999990.00');
$$;

create or replace function public.notif_crear(p_usuario_id uuid, p_titulo text, p_mensaje text, p_tipo text, p_link text)
returns void language sql security definer set search_path=public as $$
  insert into notificaciones (usuario_id, titulo, mensaje, tipo, link, leida)
  select p_usuario_id, p_titulo, p_mensaje, p_tipo, p_link, false
  where p_usuario_id is not null;
$$;

create or replace function public.notif_admins(p_titulo text, p_mensaje text, p_tipo text, p_link text)
returns void language sql security definer set search_path=public as $$
  insert into notificaciones (usuario_id, titulo, mensaje, tipo, link, leida)
  select id, p_titulo, p_mensaje, p_tipo, p_link, false
  from usuarios where role='admin' and activo;
$$;

create or replace function public.notif_cliente(p_cliente_id uuid, p_titulo text, p_mensaje text, p_tipo text, p_link text)
returns void language sql security definer set search_path=public as $$
  insert into notificaciones (usuario_id, titulo, mensaje, tipo, link, leida)
  select id, p_titulo, p_mensaje, p_tipo, p_link, false
  from usuarios where cliente_id=p_cliente_id and role='cliente' and activo;
$$;

create or replace function public.notif_vendedor(p_cliente_id uuid, p_titulo text, p_mensaje text, p_tipo text, p_link text)
returns void language sql security definer set search_path=public as $$
  insert into notificaciones (usuario_id, titulo, mensaje, tipo, link, leida)
  select c.vendedor_asignado_id, p_titulo, p_mensaje, p_tipo, p_link, false
  from clientes c
  where c.id=p_cliente_id and c.vendedor_asignado_id is not null;
$$;

-- ---- ORDEN creada --------------------------------------------------------
create or replace function public.trg_orden_creada()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_cli text;
begin
  select nombre_negocio into v_cli from clientes where id=NEW.cliente_id;
  perform notif_admins('Nueva orden '||NEW.numero, coalesce(v_cli,'Cliente')||' · '||fmt_usd(NEW.total), 'orden', '/admin/ordenes');
  perform notif_cliente(NEW.cliente_id, 'Pedido recibido', 'Tu pedido '||NEW.numero||' por '||fmt_usd(NEW.total)||' fue registrado.', 'orden', '/portal/pedidos');
  if NEW.vendedor_id is null then
    perform notif_vendedor(NEW.cliente_id, 'Tu cliente hizo un pedido', coalesce(v_cli,'Cliente')||': '||NEW.numero||' por '||fmt_usd(NEW.total), 'orden', '/vendedor/pedidos');
  end if;
  return NEW;
end; $$;
drop trigger if exists trg_notif_orden_creada on ordenes;
create trigger trg_notif_orden_creada after insert on ordenes for each row execute function trg_orden_creada();

-- ---- ORDEN cambia de estado ---------------------------------------------
create or replace function public.trg_orden_estado()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_cli text; v_lbl text; v_tipo text;
begin
  if NEW.estado is not distinct from OLD.estado then return NEW; end if;
  if NEW.estado::text not in ('confirmado','procesando','enviado','completado','cancelado') then return NEW; end if;
  select nombre_negocio into v_cli from clientes where id=NEW.cliente_id;
  v_lbl := case NEW.estado::text
    when 'confirmado' then 'confirmado'
    when 'procesando' then 'en preparación'
    when 'enviado' then 'en camino'
    when 'completado' then 'entregado'
    when 'cancelado' then 'cancelado'
    else NEW.estado::text end;
  v_tipo := case NEW.estado::text when 'cancelado' then 'alerta' when 'completado' then 'exito' else 'orden' end;
  perform notif_cliente(NEW.cliente_id, 'Pedido '||v_lbl, 'Tu pedido '||NEW.numero||' está '||v_lbl||'.', v_tipo, '/portal/pedidos');
  if NEW.estado::text='completado' then
    perform notif_admins('Pedido completado', NEW.numero||' de '||coalesce(v_cli,'cliente'), 'exito', '/admin/ordenes');
  elsif NEW.estado::text='cancelado' then
    perform notif_vendedor(NEW.cliente_id, 'Pedido cancelado', NEW.numero||' de '||coalesce(v_cli,'cliente'), 'alerta', '/vendedor/pedidos');
  end if;
  return NEW;
end; $$;
drop trigger if exists trg_notif_orden_estado on ordenes;
create trigger trg_notif_orden_estado after update of estado on ordenes for each row execute function trg_orden_estado();

-- ---- PAGO registrado (insert) -------------------------------------------
create or replace function public.trg_pago_insert()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_cli text;
begin
  select nombre_negocio into v_cli from clientes where id=NEW.cliente_id;
  if NEW.estado::text='pendiente' then
    perform notif_admins('Pago por verificar', coalesce(v_cli,'Cliente')||' reportó '||fmt_usd(NEW.monto), 'alerta', '/admin/cuentas');
  elsif NEW.estado::text='verificado' then
    perform notif_cliente(NEW.cliente_id, 'Pago verificado', 'Tu pago '||coalesce(NEW.numero,'')||' de '||fmt_usd(NEW.monto)||' fue verificado.', 'exito', '/portal/pagos');
    perform notif_vendedor(NEW.cliente_id, 'Pago verificado', coalesce(v_cli,'Cliente')||': '||fmt_usd(NEW.monto), 'exito', '/vendedor/pagos');
  end if;
  return NEW;
end; $$;
drop trigger if exists trg_notif_pago_insert on pagos;
create trigger trg_notif_pago_insert after insert on pagos for each row execute function trg_pago_insert();

-- ---- PAGO cambia de estado ----------------------------------------------
create or replace function public.trg_pago_estado()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_cli text;
begin
  if NEW.estado is not distinct from OLD.estado then return NEW; end if;
  select nombre_negocio into v_cli from clientes where id=NEW.cliente_id;
  if NEW.estado::text='verificado' then
    perform notif_cliente(NEW.cliente_id, 'Pago verificado', 'Tu pago '||coalesce(NEW.numero,'')||' de '||fmt_usd(NEW.monto)||' fue verificado.', 'exito', '/portal/pagos');
    perform notif_vendedor(NEW.cliente_id, 'Pago verificado', coalesce(v_cli,'Cliente')||': '||fmt_usd(NEW.monto), 'exito', '/vendedor/pagos');
  elsif NEW.estado::text='rechazado' then
    perform notif_cliente(NEW.cliente_id, 'Pago rechazado', 'Tu pago '||coalesce(NEW.numero,'')||' de '||fmt_usd(NEW.monto)||' fue rechazado.', 'alerta', '/portal/pagos');
  end if;
  return NEW;
end; $$;
drop trigger if exists trg_notif_pago_estado on pagos;
create trigger trg_notif_pago_estado after update of estado on pagos for each row execute function trg_pago_estado();

-- ---- REGISTRO de cliente nuevo ------------------------------------------
create or replace function public.trg_registro_nuevo()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform notif_admins('Nuevo registro de cliente', coalesce(NEW.nombre_negocio,'Un negocio')||' solicitó una cuenta.', 'alerta', '/admin/registros');
  return NEW;
end; $$;
drop trigger if exists trg_notif_registro_nuevo on registros_clientes;
create trigger trg_notif_registro_nuevo after insert on registros_clientes for each row execute function trg_registro_nuevo();

-- ---- ENTREGA asignada a un repartidor -----------------------------------
create or replace function public.trg_entrega_asignada()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_num text;
begin
  if NEW.repartidor_id is null then return NEW; end if;
  if TG_OP='UPDATE' and NEW.repartidor_id is not distinct from OLD.repartidor_id then return NEW; end if;
  select numero into v_num from ordenes where id=NEW.orden_id;
  perform notif_crear(NEW.repartidor_id, 'Nueva entrega asignada', 'Tienes el pedido '||coalesce(v_num,'')||' para entregar.', 'orden', '/delivery/entregas');
  return NEW;
end; $$;
drop trigger if exists trg_notif_entrega_ins on entregas;
create trigger trg_notif_entrega_ins after insert on entregas for each row execute function trg_entrega_asignada();
drop trigger if exists trg_notif_entrega_upd on entregas;
create trigger trg_notif_entrega_upd after update of repartidor_id on entregas for each row execute function trg_entrega_asignada();

-- ---- STOCK bajo ----------------------------------------------------------
create or replace function public.trg_stock_bajo()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if NEW.stock_minimo > 0 and NEW.stock_actual <= NEW.stock_minimo and OLD.stock_actual > NEW.stock_minimo then
    perform notif_admins('Stock bajo', NEW.nombre||': quedan '||NEW.stock_actual||' (mínimo '||NEW.stock_minimo||')', 'alerta', '/admin/inventario');
  end if;
  return NEW;
end; $$;
drop trigger if exists trg_notif_stock_bajo on productos;
create trigger trg_notif_stock_bajo after update of stock_actual on productos for each row execute function trg_stock_bajo();

notify pgrst, 'reload schema';
