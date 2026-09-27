-- ════════════════════════════════════════════════════════════════════════
-- Fase 18o · Ajustes de la Fase 8 detectados en pruebas
--   · validar_credito pasa a volátil (una función STABLE que solo lanza errores puede omitirse al planificar).
--   · Los vendedores gestionan contactos y accesos al portal solo de sus clientes asignados.
-- ════════════════════════════════════════════════════════════════════════
begin;

alter function public.validar_credito(uuid, numeric) volatile;

create or replace function public.puede_gestionar_cliente(p_cliente_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.puede('clientes', 'editar') and (
    public.is_admin()
    or coalesce((select u.role::text from usuarios u where u.auth_id = auth.uid()), '') <> 'vendedor'
    or public.es_vendedor_de(p_cliente_id))
$$;
grant execute on function public.puede_gestionar_cliente(uuid) to authenticated;

drop policy if exists cliente_contactos_crear on public.cliente_contactos;
create policy cliente_contactos_crear on public.cliente_contactos for insert to authenticated with check (public.puede_gestionar_cliente(cliente_id));
drop policy if exists cliente_contactos_editar on public.cliente_contactos;
create policy cliente_contactos_editar on public.cliente_contactos for update to authenticated
  using (public.puede_gestionar_cliente(cliente_id)) with check (public.puede_gestionar_cliente(cliente_id));
drop policy if exists cliente_contactos_eliminar on public.cliente_contactos;
create policy cliente_contactos_eliminar on public.cliente_contactos for delete to authenticated using (public.puede_gestionar_cliente(cliente_id));

create or replace function public.crear_acceso_contacto(p_contacto_id uuid, p_password text default null)
returns table(usuario_id uuid, email text, password_temporal text)
language plpgsql security definer set search_path = public as $$
declare k record; v_pass text; v_auth uuid; v_uid uuid; v_nombre text; v_apellido text;
begin
  select * into k from cliente_contactos where id = p_contacto_id;
  if not found then raise exception 'Contacto no encontrado' using errcode = 'P0001'; end if;
  if not public.puede_gestionar_cliente(k.cliente_id) then raise exception 'No tienes permiso para dar acceso al portal a este cliente' using errcode = 'P0001'; end if;
  if k.email is null or position('@' in k.email) = 0 then raise exception 'El contacto necesita un correo válido para entrar al portal' using errcode = 'P0001'; end if;
  if exists (select 1 from usuarios u where u.contacto_id = k.id) then raise exception 'Este contacto ya tiene acceso al portal' using errcode = 'P0001'; end if;
  if exists (select 1 from usuarios u where lower(u.email) = lower(k.email)) or exists (select 1 from auth.users a where lower(a.email) = lower(k.email)) then
    raise exception 'Ya existe un usuario con el correo %', lower(k.email) using errcode = 'P0001';
  end if;
  v_pass := coalesce(nullif(trim(p_password), ''), public.generar_password_temporal());
  if length(v_pass) < 8 then raise exception 'La contraseña debe tener al menos 8 caracteres' using errcode = 'P0001'; end if;
  v_nombre := split_part(k.nombre, ' ', 1);
  v_apellido := nullif(trim(substr(k.nombre, length(v_nombre) + 1)), '');
  v_auth := public.crear_auth_user(k.email, v_pass);
  insert into usuarios (auth_id, email, nombre, apellido, telefono, role, cliente_id, contacto_id, activo, debe_cambiar_clave)
  values (v_auth, lower(k.email), v_nombre, v_apellido, coalesce(k.celular, k.telefono), 'cliente', k.cliente_id, k.id, true, true)
  returning id into v_uid;
  return query select v_uid, lower(k.email), v_pass;
end $$;

create or replace function public.restablecer_clave_cliente(p_usuario_id uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare u record; v_pass text;
begin
  select * into u from usuarios where id = p_usuario_id;
  if not found or u.role <> 'cliente' then raise exception 'Solo se restablecen contraseñas de usuarios del portal de clientes' using errcode = 'P0001'; end if;
  if not public.puede_gestionar_cliente(u.cliente_id) then raise exception 'No tienes permiso para restablecer contraseñas de este cliente' using errcode = 'P0001'; end if;
  v_pass := public.generar_password_temporal();
  update auth.users set encrypted_password = crypt(v_pass, gen_salt('bf')), updated_at = now() where id = u.auth_id;
  update usuarios set debe_cambiar_clave = true where id = u.id;
  return v_pass;
end $$;

create or replace function public.cambiar_acceso_cliente(p_usuario_id uuid, p_activo boolean)
returns void language plpgsql security definer set search_path = public as $$
declare u record;
begin
  select * into u from usuarios where id = p_usuario_id;
  if not found or u.role <> 'cliente' then raise exception 'Usuario del portal no encontrado' using errcode = 'P0001'; end if;
  if not public.puede_gestionar_cliente(u.cliente_id) then raise exception 'No tienes permiso sobre este cliente' using errcode = 'P0001'; end if;
  update usuarios set activo = p_activo where id = u.id;
  update auth.users set banned_until = case when p_activo then null else 'infinity'::timestamptz end where id = u.auth_id;
end $$;

commit;
