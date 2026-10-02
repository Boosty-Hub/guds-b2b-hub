-- Fase 21f: contraseñas desde el módulo Usuarios (Configuración → Usuarios).
--  · cambiar_clave_usuario: el admin pone una contraseña nueva (o genera una temporal) a cualquier usuario y cierra sus sesiones.
--  · forzar_cambio_clave: marca al usuario para que cree una contraseña nueva. Si tiene la sesión abierta le aparece el aviso
--    al momento (realtime sobre usuarios); si no, al iniciar sesión.
--  · El propio usuario ya no puede quitarse la marca editando su fila: solo marcar_clave_cambiada (tras cambiarla) lo hace.
begin;

create or replace function public.cambiar_clave_usuario(p_usuario_id uuid, p_password text default null, p_pedir_cambio boolean default true)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare u record; v_pass text; v_generada boolean;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión.' using errcode = '42501'; end if;
  if not public.puede('usuarios', 'editar') then raise exception 'No tienes permiso para cambiar contraseñas de usuarios.' using errcode = '42501'; end if;
  select * into u from usuarios where id = p_usuario_id;
  if not found then raise exception 'Usuario no encontrado.' using errcode = 'P0002'; end if;
  if u.auth_id is null then raise exception 'Este usuario no tiene cuenta de acceso.' using errcode = 'P0001'; end if;
  if u.auth_id = auth.uid() then raise exception 'Tu propia contraseña se cambia desde Mi perfil → Seguridad.' using errcode = 'P0001'; end if;
  v_generada := nullif(btrim(coalesce(p_password, '')), '') is null;
  v_pass := case when v_generada then public.generar_password_temporal() else p_password end;
  if not v_generada then perform public.validar_clave_portal(v_pass, u.email); end if;
  update auth.users set encrypted_password = crypt(v_pass, gen_salt('bf')), updated_at = now() where id = u.auth_id;
  -- Las sesiones abiertas quedan cerradas: debe entrar con la contraseña nueva.
  delete from auth.sessions where user_id = u.auth_id;
  perform set_config('guds.bypass_guard', 'on', true);
  update usuarios set debe_cambiar_clave = (v_generada or coalesce(p_pedir_cambio, true)) where id = u.id;
  perform set_config('guds.bypass_guard', 'off', true);
  return case when v_generada then v_pass else null end;
end $$;
revoke all on function public.cambiar_clave_usuario(uuid, text, boolean) from public, anon;
grant execute on function public.cambiar_clave_usuario(uuid, text, boolean) to authenticated;

-- Obliga (o deja de obligar) a un usuario a crear una contraseña nueva. No cierra su sesión: el aviso le sale encima.
create or replace function public.forzar_cambio_clave(p_usuario_id uuid, p_forzar boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare u record;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión.' using errcode = '42501'; end if;
  if not public.puede('usuarios', 'editar') then raise exception 'No tienes permiso para gestionar contraseñas de usuarios.' using errcode = '42501'; end if;
  select * into u from usuarios where id = p_usuario_id;
  if not found then raise exception 'Usuario no encontrado.' using errcode = 'P0002'; end if;
  if u.auth_id = auth.uid() then raise exception 'No puedes obligarte a ti mismo: cambia tu contraseña desde Mi perfil → Seguridad.' using errcode = 'P0001'; end if;
  perform set_config('guds.bypass_guard', 'on', true);
  update usuarios set debe_cambiar_clave = coalesce(p_forzar, true) where id = u.id;
  perform set_config('guds.bypass_guard', 'off', true);
end $$;
revoke all on function public.forzar_cambio_clave(uuid, boolean) from public, anon;
grant execute on function public.forzar_cambio_clave(uuid, boolean) to authenticated;

-- El usuario la quita solo tras cambiar su contraseña (diálogo obligatorio o enlace de recuperación).
create or replace function public.marcar_clave_cambiada()
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('guds.bypass_guard', 'on', true);
  update usuarios set debe_cambiar_clave = false where auth_id = auth.uid();
  perform set_config('guds.bypass_guard', 'off', true);
end $$;
revoke all on function public.marcar_clave_cambiada() from public, anon;
grant execute on function public.marcar_clave_cambiada() to authenticated;

create or replace function public.usuarios_guard_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('guds.bypass_guard', true), '') = 'on' then
    return new;
  end if;
  -- Nadie se quita a sí mismo la obligación de cambiar la contraseña editando su fila (ni siquiera un admin).
  if old.auth_id = auth.uid() and old.debe_cambiar_clave and not coalesce(new.debe_cambiar_clave, false) then
    raise exception 'Para quitar el aviso cambia tu contraseña.' using errcode = '42501';
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
$$;

-- Realtime: la sesión abierta del usuario se entera al momento de que debe cambiar la contraseña (RLS: solo ve su fila).
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'usuarios') then
    alter publication supabase_realtime add table public.usuarios;
  end if;
end $$;

commit;
