-- ════════════════════════════════════════════════════════════════════════
-- Fase 19j · Seguridad del vendedor y blindaje de la aprobación (hallazgos de la investigación del portal vendedor)
--   1. El rol Vendedor tenía ver/crear/editar en clientes y órdenes: veía TODAS las órdenes y clientes de la empresa
--      (797 pedidos, "vendido este mes" de toda la empresa en su portal) y podía editar pedidos y clientes por REST.
--      El portal del vendedor ya tiene sus políticas propias (clientes asignados, órdenes/ítems/facturas/cobros de sus
--      clientes) y crea pedidos y cobros por funciones del servidor, así que se quitan esos permisos amplios.
--   2. Nadie que no sea administración puede fijar ni cambiar la aprobación ni los datos del envío a Odoo, aunque tenga
--      permiso de escritura en la tabla (p. ej. un cliente insertando por REST un pedido "aprobado"): el pedido llegaría a
--      Odoo sin pasar por el admin. Los triggers lo impiden; las funciones aprobar/rechazar siguen funcionando.
--   3. El envío a Odoo exige además que el pedido tenga quién lo aprobó.
-- ════════════════════════════════════════════════════════════════════════
begin;

-- 1. Rol Vendedor: sin permisos amplios sobre órdenes y clientes
update public.permisos p set puede_ver = false, puede_crear = false, puede_editar = false, puede_eliminar = false
from public.roles r, public.modulos m
where r.id = p.rol_id and m.id = p.modulo_id and r.nombre = 'Vendedor' and m.codigo in ('ordenes', 'clientes');

-- Llamada desde la API (PostgREST) por un usuario que no es administración
create or replace function public.es_llamada_no_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '') in ('authenticated', 'anon')
     and not public.es_personal_admin();
$$;
revoke execute on function public.es_llamada_no_admin() from public, anon;

-- 2a. Al crear: los que no son administración siempre dejan el pedido por aprobar y sin datos de Odoo
create or replace function public.trg_orden_aprobacion() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_usuario uuid; v_admin boolean;
begin
  if public.es_llamada_no_admin() then
    new.aprobacion := 'pendiente'; new.aprobado_por := null; new.aprobado_at := null; new.rechazo_motivo := null;
    new.odoo_id := null; new.numero_guds := null; new.odoo_enviado_at := null; new.odoo_envio_error := null; new.odoo_envio_aviso := null;
    return new;
  end if;
  if new.odoo_id is not null or new.aprobacion is not null then return new; end if;
  select u.id, u.role = 'admin' into v_usuario, v_admin from usuarios u where u.auth_id = auth.uid();
  if coalesce(v_admin, false) then
    new.aprobacion := 'aprobada'; new.aprobado_por := v_usuario; new.aprobado_at := now();
  else
    new.aprobacion := 'pendiente';
  end if;
  return new;
end $$;

-- 2b. Al modificar: la aprobación y el envío a Odoo solo los cambia administración (o el sistema)
create or replace function public.trg_proteger_aprobacion() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.es_llamada_no_admin() and (
    (new.aprobacion, new.aprobado_por, new.aprobado_at, new.rechazo_motivo, new.odoo_id, new.numero_guds,
     new.odoo_enviado_at, new.odoo_envio_error, new.odoo_envio_aviso)
    is distinct from
    (old.aprobacion, old.aprobado_por, old.aprobado_at, old.rechazo_motivo, old.odoo_id, old.numero_guds,
     old.odoo_enviado_at, old.odoo_envio_error, old.odoo_envio_aviso)) then
    raise exception 'La aprobación y el envío a Odoo solo los gestiona administración' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists b_proteger_aprobacion on public.ordenes;
create trigger b_proteger_aprobacion before update on public.ordenes for each row execute function public.trg_proteger_aprobacion();

commit;
