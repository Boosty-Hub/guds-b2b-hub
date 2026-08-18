begin;

-- Fase 16: hace obligatorio el rol granular (rol_id) para todo usuario que no sea
-- 'cliente' (los clientes no usan el sistema de roles/permisos admin, por diseño
-- quedan con rol_id null desde el registro/onboarding). Esto es la causa raíz de
-- fondo del bug "Sin rol" ya parcheado a mano en Fase 14 — ahora la BD lo impide
-- en cualquier camino de inserción/actualización futuro, no solo en el frontend.
alter table public.usuarios
  add constraint usuarios_rol_id_requerido_check
  check (role = 'cliente'::user_role or rol_id is not null);

-- crear_usuario_admin ya resolvía rol_id automáticamente para admin/vendedor/delivery
-- cuando no se pasaba explícito; ahora, si esa resolución falla (rol granular
-- inexistente), corta con un mensaje claro en vez de dejar que la constraint de arriba
-- tire un error crudo de Postgres.
create or replace function public.crear_usuario_admin(
  p_email text,
  p_nombre text,
  p_apellido text,
  p_role user_role,
  p_telefono text default null,
  p_cliente_id uuid default null,
  p_password text default null,
  p_rol_id uuid default null
)
returns table(usuario_id uuid, password_temporal text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_auth_id uuid;
  v_pass text;
  v_uid uuid;
  v_rol_id uuid;
  v_nombre_rol text;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede crear usuarios';
  end if;

  v_pass := coalesce(nullif(trim(p_password), ''), generar_password_temporal());
  if length(v_pass) < 6 then
    raise exception 'La contraseña debe tener al menos 6 caracteres';
  end if;

  v_rol_id := p_rol_id;
  if v_rol_id is null then
    v_nombre_rol := case p_role::text
      when 'admin' then 'Administrador'
      when 'vendedor' then 'Vendedor'
      when 'delivery' then 'Delivery'
      else null
    end;
    if v_nombre_rol is not null then
      select id into v_rol_id from public.roles where nombre = v_nombre_rol limit 1;
    end if;
  end if;

  if p_role <> 'cliente'::user_role and v_rol_id is null then
    raise exception 'Debes seleccionar un rol para este usuario';
  end if;

  v_auth_id := public.crear_auth_user(p_email, v_pass);

  insert into usuarios (auth_id, email, nombre, apellido, telefono, role, cliente_id, activo, rol_id)
  values (v_auth_id, lower(p_email), p_nombre, p_apellido, p_telefono, p_role, p_cliente_id, true, v_rol_id)
  returning id into v_uid;

  return query select v_uid, v_pass;
end;
$function$;

commit;
