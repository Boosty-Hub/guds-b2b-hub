begin;

-- Fase 14c: corrige la causa raíz del bug "Sin rol" — crear_usuario_admin nunca asignaba
-- usuarios.rol_id (solo el enum role). 17 vendedores ya se corrigieron a mano en prod
-- (update puntual, fuera de esta migración). Este cambio evita que vuelva a pasar.

-- Agregar un parámetro nuevo con CREATE OR REPLACE no reemplaza la función vieja (Postgres
-- la trata como un overload distinto por firma de tipos) — hay que borrar la de 7 args.
drop function if exists public.crear_usuario_admin(text, text, text, user_role, text, uuid, text);

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

  -- Resuelve rol_id: si el llamador ya lo pasó, se respeta. Si no, se busca el rol
  -- granular que corresponde al enum (si aplica) para que ningún usuario quede
  -- "Sin rol" por descuido. 'cliente' no tiene un rol granular fijo -> queda null.
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

  v_auth_id := public.crear_auth_user(p_email, v_pass);

  insert into usuarios (auth_id, email, nombre, apellido, telefono, role, cliente_id, activo, rol_id)
  values (v_auth_id, lower(p_email), p_nombre, p_apellido, p_telefono, p_role, p_cliente_id, true, v_rol_id)
  returning id into v_uid;

  return query select v_uid, v_pass;
end;
$function$;

commit;
