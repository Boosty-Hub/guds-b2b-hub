-- =====================================================================
-- GUDS · FASE 3 — Onboarding y acceso
-- Decisión P1: al aprobar un registro se crea la cuenta de auth con una
--   contraseña temporal que el admin comunica al cliente.
-- Incluye:
--   · crear_auth_user(email, pass)  -> crea auth.users + auth.identities
--       (receta verificada: tokens en '' no NULL; email/confirmed_at generados)
--   · aprobar_registro_cliente(...) -> ahora crea la cuenta y enlaza auth_id,
--       devuelve la contraseña temporal
--   · crear_usuario_admin(...)      -> alta de usuario desde el panel admin
--       sin secuestrar la sesión (no usa signUp en el navegador)
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- Helper interno: crea un usuario de Supabase Auth (email+password).
-- ---------------------------------------------------------------------
create or replace function public.crear_auth_user(p_email text, p_password text)
returns uuid
language plpgsql
security definer
set search_path = public, auth, extensions
as $fn$
declare v_id uuid := gen_random_uuid();
begin
  if exists (select 1 from auth.users where email = lower(p_email)) then
    raise exception 'Ya existe una cuenta con el email %', p_email;
  end if;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, reauthentication_token, phone_change, phone_change_token,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', lower(p_email),
    crypt(p_password, gen_salt('bf')), now(),
    '', '', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('sub', v_id::text, 'email', lower(p_email), 'email_verified', true),
    now(), now()
  );

  insert into auth.identities (
    id, provider_id, user_id, identity_data, provider, created_at, updated_at, last_sign_in_at
  ) values (
    gen_random_uuid(), v_id::text, v_id,
    jsonb_build_object('sub', v_id::text, 'email', lower(p_email), 'email_verified', true),
    'email', now(), now(), now()
  );

  return v_id;
end;
$fn$;
revoke all on function public.crear_auth_user(text, text) from public;
-- No se concede a nadie: solo la usan otras funciones SECURITY DEFINER.

-- Generador de contraseña temporal legible (usa md5/random, sin depender de pgcrypto).
create or replace function public.generar_password_temporal()
returns text language sql volatile as $fn$
  select 'Gd' || substr(md5(random()::text), 1, 6) || upper(substr(md5(random()::text), 1, 3)) || '#7';
$fn$;

-- ---------------------------------------------------------------------
-- Aprobación: crea cliente + usuario + cuenta de auth, devuelve la clave.
-- ---------------------------------------------------------------------
drop function if exists public.aprobar_registro_cliente(uuid, uuid, uuid, uuid, numeric, integer);
create or replace function public.aprobar_registro_cliente(
  p_registro_id uuid,
  p_admin_id uuid default null,
  p_lista_precios_id uuid default null,
  p_vendedor_id uuid default null,
  p_limite_credito numeric default 0,
  p_dias_credito integer default 0
) returns table(cliente_id uuid, email text, password_temporal text)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_registro RECORD;
  v_cliente_id uuid;
  v_codigo text;
  v_lista_id uuid;
  v_auth_id uuid;
  v_pass text;
  v_admin uuid;
begin
  select * into v_registro from registros_clientes where id = p_registro_id;
  if v_registro is null then raise exception 'Registro no encontrado'; end if;
  if v_registro.estado <> 'pendiente' then raise exception 'El registro ya fue procesado'; end if;

  -- admin que aprueba: el pasado, o el usuario actual
  v_admin := coalesce(p_admin_id, (select id from usuarios where auth_id = auth.uid()));

  if p_lista_precios_id is null then
    select id into v_lista_id from listas_precios where es_default = true limit 1;
  else
    v_lista_id := p_lista_precios_id;
  end if;

  v_codigo := generar_codigo_cliente();

  insert into clientes (
    codigo, nombre_negocio, tipo_negocio, rif, email, telefono,
    direccion, ciudad, lista_precios_id, vendedor_asignado_id,
    limite_credito, dias_credito, registro_origen_id
  ) values (
    v_codigo, v_registro.nombre_negocio, v_registro.tipo_negocio,
    v_registro.rif, v_registro.email, v_registro.telefono,
    v_registro.direccion, v_registro.ciudad, v_lista_id, p_vendedor_id,
    p_limite_credito, p_dias_credito, p_registro_id
  ) returning id into v_cliente_id;

  -- Crear la cuenta de auth con contraseña temporal y enlazarla
  v_pass := generar_password_temporal();
  v_auth_id := public.crear_auth_user(v_registro.email, v_pass);

  insert into usuarios (auth_id, email, nombre, apellido, telefono, role, cliente_id, activo)
  values (v_auth_id, v_registro.email, v_registro.nombre_contacto, v_registro.apellido_contacto,
          v_registro.telefono, 'cliente', v_cliente_id, true);

  update registros_clientes set
    estado = 'aprobado', revisado_por = v_admin, fecha_revision = now(), cliente_creado_id = v_cliente_id
  where id = p_registro_id;

  return query select v_cliente_id, v_registro.email::text, v_pass;
end;
$fn$;
revoke all on function public.aprobar_registro_cliente(uuid, uuid, uuid, uuid, numeric, integer) from public;
grant execute on function public.aprobar_registro_cliente(uuid, uuid, uuid, uuid, numeric, integer) to authenticated;

-- ---------------------------------------------------------------------
-- Alta de usuario desde el panel admin (sin secuestrar la sesión).
-- ---------------------------------------------------------------------
create or replace function public.crear_usuario_admin(
  p_email text, p_nombre text, p_apellido text, p_role user_role, p_telefono text default null, p_cliente_id uuid default null
) returns table(usuario_id uuid, password_temporal text)
language plpgsql security definer set search_path = public
as $fn$
declare v_auth_id uuid; v_pass text; v_uid uuid;
begin
  if not public.is_admin() then raise exception 'Solo un administrador puede crear usuarios'; end if;
  v_pass := generar_password_temporal();
  v_auth_id := public.crear_auth_user(p_email, v_pass);
  insert into usuarios (auth_id, email, nombre, apellido, telefono, role, cliente_id, activo)
  values (v_auth_id, lower(p_email), p_nombre, p_apellido, p_telefono, p_role, p_cliente_id, true)
  returning id into v_uid;
  return query select v_uid, v_pass;
end;
$fn$;
revoke all on function public.crear_usuario_admin(text, text, text, user_role, text, uuid) from public;
grant execute on function public.crear_usuario_admin(text, text, text, user_role, text, uuid) to authenticated;

commit;
