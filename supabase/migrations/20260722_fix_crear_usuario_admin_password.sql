-- Fix: permitir que el administrador defina la contraseña al crear un usuario.
--
-- Antes, crear_usuario_admin ignoraba cualquier contraseña provista y generaba
-- una temporal aleatoria. El módulo de Usuarios pedía una contraseña en el
-- formulario pero nunca llegaba a la base, así que el usuario recién creado no
-- podía iniciar sesión con la contraseña comunicada. Ahora se usa la contraseña
-- provista (>= 6 caracteres) y, si viene vacía, se cae al generador temporal.

-- La firma cambia (se agrega p_password), por eso hay que soltar la versión previa.
drop function if exists public.crear_usuario_admin(text, text, text, user_role, text, uuid);

create or replace function public.crear_usuario_admin(
  p_email text,
  p_nombre text,
  p_apellido text,
  p_role user_role,
  p_telefono text default null,
  p_cliente_id uuid default null,
  p_password text default null
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
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede crear usuarios';
  end if;

  -- Contraseña provista por el admin; si viene vacía, se genera una temporal.
  v_pass := coalesce(nullif(trim(p_password), ''), generar_password_temporal());
  if length(v_pass) < 6 then
    raise exception 'La contraseña debe tener al menos 6 caracteres';
  end if;

  v_auth_id := public.crear_auth_user(p_email, v_pass);

  insert into usuarios (auth_id, email, nombre, apellido, telefono, role, cliente_id, activo)
  values (v_auth_id, lower(p_email), p_nombre, p_apellido, p_telefono, p_role, p_cliente_id, true)
  returning id into v_uid;

  return query select v_uid, v_pass;
end;
$function$;
