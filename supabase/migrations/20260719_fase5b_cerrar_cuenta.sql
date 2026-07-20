-- =====================================================================
-- GUDS · FASE 5b — "Eliminar mi cuenta" real (cierre de cuenta seguro).
--   Revoca el acceso (borra la cuenta de auth), desactiva el usuario y
--   limpia carrito/favoritos. Conserva la fila usuarios (inactiva, sin
--   auth_id) y el cliente + su historial de órdenes por integridad
--   referencial y motivos fiscales (las órdenes referencian usuarios).
-- =====================================================================
begin;

-- El guard de usuarios (Fase 0) bloquea cambiar activo/role/cliente_id a los
-- no-admin. Se le añade un bypass transaccional (GUC local) que solo activan
-- funciones internas SECURITY DEFINER como cerrar_mi_cuenta.
create or replace function public.usuarios_guard_role()
returns trigger language plpgsql security definer set search_path = public as $guard$
begin
  if coalesce(current_setting('guds.bypass_guard', true), '') = 'on' then
    return new;
  end if;
  if public.is_admin() then
    return new;
  end if;
  if new.role is distinct from old.role
     or new.activo is distinct from old.activo
     or new.cliente_id is distinct from old.cliente_id then
    raise exception 'No autorizado para cambiar role/activo/cliente_id';
  end if;
  return new;
end;
$guard$;

create or replace function public.cerrar_mi_cuenta()
returns void
language plpgsql
security definer
set search_path = public, auth
as $fn$
declare v_uid uuid := auth.uid(); v_usuario_id uuid;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;

  select id into v_usuario_id from usuarios where auth_id = v_uid;

  if v_usuario_id is not null then
    delete from carrito where usuario_id = v_usuario_id;
    delete from favoritos where usuario_id = v_usuario_id;
    -- Bypass del guard (cierre de la propia cuenta), solo en esta transacción
    perform set_config('guds.bypass_guard', 'on', true);
    -- Desligar de auth y desactivar (se conserva la fila para el historial)
    update usuarios set activo = false, auth_id = null where id = v_usuario_id;
    perform set_config('guds.bypass_guard', 'off', true);
  end if;

  -- Revocar el acceso: eliminar la cuenta de autenticación
  delete from auth.identities where user_id = v_uid;
  delete from auth.users where id = v_uid;
end;
$fn$;
revoke all on function public.cerrar_mi_cuenta() from public;
grant execute on function public.cerrar_mi_cuenta() to authenticated;

commit;
