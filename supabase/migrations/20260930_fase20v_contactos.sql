-- ════════════════════════════════════════════════════════════════════════
-- Fase 20v · Módulo Contactos (pedido del dueño, 30-sep): un contacto puede pertenecer a un cliente, a un proveedor o a
-- ninguno (suelto). Solo si está ligado a un cliente puede tener usuario del portal de clientes, con una contraseña que
-- el admin genera (temporal) o establece él mismo (opcionalmente sin pedir cambio al primer ingreso).
--
--   Modelo: se generaliza public.cliente_contactos (no se crea otra tabla) para no romper lo que ya la usa: acceso al
--   portal (18l/18o), usuarios.contacto_id, ficha del vendedor, estado de Odoo del cliente y el escritor de 20s.
--     · cliente_id pasa a ser opcional; proveedor_id nuevo; como mucho uno de los dos (suelto = ninguno).
--     · origen: 'guds' (nace en GUDS; lo que se edita aquí se envía a Odoo) | 'odoo' (lo trae la sincronización; sus datos
--       se editan en Odoo). odoo_padre_id: la empresa (cliente o proveedor) de la que es hijo en Odoo.
--   Odoo (30-sep, solo lectura): 0 personas hijas de tipo contacto (los 182 hijos son direcciones de entrega) y 135 personas
--   sin empresa ni rango de cliente/proveedor (carga de 2025, etiquetadas "Cliente"/"Proveedor"). La sincronización trae
--   los hijos de tipo contacto y, mientras configuracion.odoo_contactos_sueltos = 'importar', las personas sueltas.
--   Contactos de GUDS → Odoo (mismo modo que los de clientes, odoo_escritura_clientes_nuevos):
--     · de un cliente o de un proveedor que está en Odoo → contacto hijo marcado "(GUDS)" (tipo persona_contacto, 20s);
--     · sueltos → solo en GUDS;
--     · si cambia de cliente o proveedor, en Odoo el contacto se queda donde estaba (nunca se mueve, archiva ni borra):
--       queda una nota "(GUDS)" en él y, si el nuevo cliente o proveedor está en Odoo, se crea allí.
--   Acceso al portal: solo con cliente y correo; al quitarle el cliente (suelto, a un proveedor o a otro cliente) o
--   desactivar el contacto, su acceso se desactiva solo (sesiones cerradas). Todo en funciones SECURITY DEFINER que
--   validan a quien llama; las internas sin EXECUTE para nadie (en Supabase "revoke ... from public" no basta).
--   Permisos: módulo 'contactos' (Administrador); quien gestiona clientes gestiona sus contactos; los vendedores solo los
--   de su cartera (y solo si su rol tiene permiso de edición); proveedores y sueltos, solo personal de administración.
-- ════════════════════════════════════════════════════════════════════════
begin;

-- ── 1. Modelo ────────────────────────────────────────────────────────────
alter table public.cliente_contactos alter column cliente_id drop not null;
alter table public.cliente_contactos drop constraint if exists cliente_contactos_cliente_id_fkey;
alter table public.cliente_contactos add constraint cliente_contactos_cliente_id_fkey
  foreign key (cliente_id) references public.clientes(id) on delete set null;
alter table public.cliente_contactos
  add column if not exists proveedor_id uuid references public.proveedores(id) on delete set null,
  add column if not exists origen text not null default 'guds',
  add column if not exists odoo_padre_id integer,
  add column if not exists odoo_sync_at timestamptz;
alter table public.cliente_contactos drop constraint if exists cliente_contactos_origen_check;
alter table public.cliente_contactos add constraint cliente_contactos_origen_check check (origen in ('guds', 'odoo'));
alter table public.cliente_contactos drop constraint if exists cliente_contactos_un_vinculo;
alter table public.cliente_contactos add constraint cliente_contactos_un_vinculo check (cliente_id is null or proveedor_id is null);
create index if not exists cliente_contactos_proveedor_idx on public.cliente_contactos (proveedor_id);
-- Correo único por cliente o proveedor entre los contactos de GUDS (los de Odoo llegan como estén en Odoo)
drop index if exists public.cliente_contactos_email_uq;
create unique index cliente_contactos_email_uq on public.cliente_contactos (cliente_id, lower(email))
  where email is not null and cliente_id is not null and origen = 'guds';
create unique index if not exists cliente_contactos_email_prov_uq on public.cliente_contactos (proveedor_id, lower(email))
  where email is not null and proveedor_id is not null and origen = 'guds';

comment on table public.cliente_contactos is 'Contactos (20v): personas de un cliente, de un proveedor o sueltas. Solo las de un cliente pueden tener usuario del portal';
comment on column public.cliente_contactos.cliente_id is 'Cliente al que pertenece (null = de un proveedor o suelto). Al cambiar, su acceso al portal se desactiva';
comment on column public.cliente_contactos.proveedor_id is 'Proveedor al que pertenece (20v). Excluye a cliente_id';
comment on column public.cliente_contactos.origen is 'guds: nace en GUDS (se envía a Odoo si su cliente o proveedor está en Odoo) · odoo: lo trae la sincronización (sus datos se editan en Odoo)';
comment on column public.cliente_contactos.odoo_padre_id is 'res.partner padre en Odoo (cliente o proveedor). Null en contactos sueltos';

revoke all on public.cliente_contactos from anon;

-- ── 2. Módulo y permisos ─────────────────────────────────────────────────
insert into public.modulos (codigo, nombre, descripcion, icono, orden, activo)
values ('contactos', 'Contactos', 'Personas de clientes y proveedores, y acceso al portal de clientes', 'Contact', 19, true)
on conflict (codigo) do nothing;
insert into public.permisos (rol_id, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar)
select r.id, m.id, true, true, true, true from public.roles r, public.modulos m
where r.nombre = 'Administrador' and m.codigo = 'contactos'
on conflict (rol_id, modulo_id) do nothing;

insert into public.configuracion (clave, valor, descripcion)
values ('odoo_contactos_sueltos', 'importar', 'Personas de Odoo sin empresa ni rango de cliente/proveedor: importar (como contactos sueltos) o no')
on conflict (clave) do nothing;

-- ── 3. Reglas de permiso ─────────────────────────────────────────────────
-- ¿Quien llama puede crear, editar o dar acceso a un contacto de este cliente / proveedor / suelto?
--   · cliente: permiso de edición de clientes o de contactos; un vendedor, solo si el cliente es de su cartera;
--   · proveedor: personal de administración con edición de compras o de contactos;
--   · suelto: personal de administración con edición de contactos.
create or replace function public.puede_gestionar_contacto(p_cliente_id uuid, p_proveedor_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and case
    when p_cliente_id is not null then (public.puede('clientes', 'editar') or public.puede('contactos', 'editar'))
      and (public.is_admin()
           or coalesce((select u.role::text from usuarios u where u.auth_id = auth.uid()), '') <> 'vendedor'
           or public.es_vendedor_de(p_cliente_id))
    when p_proveedor_id is not null then public.es_personal_admin() and (public.puede('compras', 'editar') or public.puede('contactos', 'editar'))
    else public.es_personal_admin() and public.puede('contactos', 'editar')
  end
$$;

-- Reglas mínimas de una contraseña elegida por el admin (las mismas que pide el cambio obligatorio del portal)
create or replace function public.validar_clave_portal(p_pass text, p_email text default null)
returns void language plpgsql volatile set search_path = public as $$
begin
  if p_pass is null or length(p_pass) < 8 then raise exception 'La contraseña debe tener al menos 8 caracteres' using errcode = 'P0001'; end if;
  if length(p_pass) > 72 then raise exception 'La contraseña no puede tener más de 72 caracteres' using errcode = 'P0001'; end if;
  if p_pass !~ '[A-Za-z]' or p_pass !~ '[0-9]' then raise exception 'La contraseña debe tener letras y números' using errcode = 'P0001'; end if;
  if p_pass <> btrim(p_pass) then raise exception 'La contraseña no puede empezar ni terminar con espacios' using errcode = 'P0001'; end if;
  if p_email is not null and (lower(p_pass) = lower(p_email) or lower(p_pass) = split_part(lower(p_email), '@', 1)) then
    raise exception 'La contraseña no puede ser el correo' using errcode = 'P0001';
  end if;
end $$;

-- ── 4. Acceso al portal ──────────────────────────────────────────────────
-- Desactiva el acceso de un contacto (no puede entrar y se cierran sus sesiones). Interna.
create or replace function public.desactivar_acceso_contacto(p_contacto_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare n int := 0; r record;
begin
  for r in select u.id, u.auth_id from usuarios u where u.contacto_id = p_contacto_id and u.role = 'cliente' and coalesce(u.activo, true) loop
    perform set_config('guds.bypass_guard', 'on', true);
    update usuarios set activo = false where id = r.id;
    perform set_config('guds.bypass_guard', 'off', true);
    update auth.users set banned_until = 'infinity'::timestamptz, updated_at = now() where id = r.auth_id;
    delete from auth.sessions where user_id = r.auth_id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Tras una sincronización (que escribe sin disparar triggers): desactiva los accesos de contactos inactivos o que ya no
-- pertenecen al cliente de su usuario. Interna.
create or replace function public.sincronizar_accesos_contactos()
returns integer language plpgsql security definer set search_path = public as $$
declare n int := 0; r record;
begin
  for r in select distinct k.id from usuarios u join cliente_contactos k on k.id = u.contacto_id
           where u.role = 'cliente' and coalesce(u.activo, true) and (not k.activo or k.cliente_id is distinct from u.cliente_id) loop
    n := n + public.desactivar_acceso_contacto(r.id);
  end loop;
  return n;
end $$;

-- Dar acceso al portal a un contacto de un cliente. Sin p_password, GUDS genera una contraseña temporal (se devuelve una
-- sola vez y debe cambiarse al entrar); con p_password, el admin la establece (no se devuelve) y p_pedir_cambio decide si se
-- pide cambiarla al primer ingreso. Si el contacto ya tuvo un usuario (desactivado o de otro cliente), se reutiliza.
drop function if exists public.crear_acceso_contacto(uuid, text);
create or replace function public.crear_acceso_contacto(p_contacto_id uuid, p_password text default null, p_pedir_cambio boolean default true)
returns table(usuario_id uuid, email text, password_temporal text)
language plpgsql security definer set search_path = public, extensions as $$
declare k record; u record; v_pass text; v_generada boolean; v_cambio boolean; v_auth uuid; v_uid uuid;
  v_nombre text; v_apellido text; v_email text; v_hay boolean := false;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión.' using errcode = '42501'; end if;
  select * into k from cliente_contactos c where c.id = p_contacto_id
    and (c.empresa_id is null or c.empresa_id = any (public.empresas_visibles()));
  if not found then raise exception 'Contacto no encontrado' using errcode = 'P0001'; end if;
  if k.cliente_id is null then
    raise exception 'Solo un contacto ligado a un cliente puede entrar al portal de clientes' using errcode = 'P0001';
  end if;
  if not public.puede_gestionar_contacto(k.cliente_id, null) then
    raise exception 'No tienes permiso para dar acceso al portal a este cliente' using errcode = 'P0001';
  end if;
  if not k.activo then raise exception 'El contacto está desactivado: actívalo antes de darle acceso' using errcode = 'P0001'; end if;
  v_email := lower(btrim(coalesce(k.email, '')));
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'El contacto necesita un correo válido para entrar al portal' using errcode = 'P0001';
  end if;
  v_generada := nullif(btrim(coalesce(p_password, '')), '') is null;
  v_pass := case when v_generada then public.generar_password_temporal() else p_password end;
  if not v_generada then perform public.validar_clave_portal(v_pass, v_email); end if;
  v_cambio := v_generada or coalesce(p_pedir_cambio, true);

  select x.* into u from usuarios x where x.contacto_id = k.id order by x.created_at desc limit 1;
  v_hay := found;
  if v_hay then
    if u.role <> 'cliente' then raise exception 'El usuario de este contacto no es del portal de clientes' using errcode = 'P0001'; end if;
    if coalesce(u.activo, true) and u.cliente_id = k.cliente_id then
      raise exception 'Este contacto ya tiene acceso al portal' using errcode = 'P0001';
    end if;
    if lower(u.email) <> v_email then
      if exists (select 1 from usuarios x where lower(x.email) = v_email and x.id <> u.id)
         or exists (select 1 from auth.users a where lower(a.email) = v_email and a.id <> u.auth_id) then
        raise exception 'Ya existe un usuario con el correo %', v_email using errcode = 'P0001';
      end if;
      update auth.users set email = v_email, raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('email', v_email),
        updated_at = now() where id = u.auth_id;
      update auth.identities set identity_data = identity_data || jsonb_build_object('email', v_email), updated_at = now()
      where user_id = u.auth_id and provider = 'email';
    end if;
    update auth.users set encrypted_password = crypt(v_pass, gen_salt('bf')), banned_until = null, updated_at = now() where id = u.auth_id;
    delete from auth.sessions where user_id = u.auth_id;
    perform set_config('guds.bypass_guard', 'on', true);
    if u.cliente_id is distinct from k.cliente_id then
      -- Otro cliente: sus empresas del portal se rehacen con las del cliente nuevo (trg_usuario_empresas_cliente)
      delete from usuario_empresas where usuario_empresas.usuario_id = u.id;
      update usuarios set cliente_id = null where id = u.id;
    end if;
    update usuarios set email = v_email, cliente_id = k.cliente_id, activo = true, debe_cambiar_clave = v_cambio where id = u.id;
    perform set_config('guds.bypass_guard', 'off', true);
    v_uid := u.id;
  else
    if exists (select 1 from usuarios x where lower(x.email) = v_email) or exists (select 1 from auth.users a where lower(a.email) = v_email) then
      raise exception 'Ya existe un usuario con el correo %', v_email using errcode = 'P0001';
    end if;
    v_nombre := split_part(btrim(k.nombre), ' ', 1);
    v_apellido := nullif(btrim(substr(btrim(k.nombre), length(v_nombre) + 1)), '');
    v_auth := public.crear_auth_user(v_email, v_pass);
    insert into usuarios (auth_id, email, nombre, apellido, telefono, role, cliente_id, contacto_id, activo, debe_cambiar_clave)
    values (v_auth, v_email, v_nombre, v_apellido, coalesce(k.celular, k.telefono), 'cliente', k.cliente_id, k.id, true, v_cambio)
    returning id into v_uid;
  end if;
  return query select v_uid, v_email, case when v_generada then v_pass else null end;
end $$;

-- Nueva contraseña de un usuario del portal: temporal generada (se devuelve) o elegida por el admin (no se devuelve).
-- Cierra sus sesiones abiertas.
drop function if exists public.restablecer_clave_cliente(uuid);
create or replace function public.restablecer_clave_cliente(p_usuario_id uuid, p_password text default null, p_pedir_cambio boolean default true)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare u record; v_pass text; v_generada boolean;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión.' using errcode = '42501'; end if;
  select * into u from usuarios where id = p_usuario_id;
  if not found or u.role <> 'cliente' then raise exception 'Solo se restablecen contraseñas de usuarios del portal de clientes' using errcode = 'P0001'; end if;
  if not public.puede_gestionar_contacto(u.cliente_id, null) then
    raise exception 'No tienes permiso para restablecer contraseñas de este cliente' using errcode = 'P0001';
  end if;
  v_generada := nullif(btrim(coalesce(p_password, '')), '') is null;
  v_pass := case when v_generada then public.generar_password_temporal() else p_password end;
  if not v_generada then perform public.validar_clave_portal(v_pass, u.email); end if;
  update auth.users set encrypted_password = crypt(v_pass, gen_salt('bf')), updated_at = now() where id = u.auth_id;
  delete from auth.sessions where user_id = u.auth_id;
  perform set_config('guds.bypass_guard', 'on', true);
  update usuarios set debe_cambiar_clave = (v_generada or coalesce(p_pedir_cambio, true)) where id = u.id;
  perform set_config('guds.bypass_guard', 'off', true);
  return case when v_generada then v_pass else null end;
end $$;

-- Activar / desactivar el acceso. Reactivar exige que el contacto siga activo y ligado al cliente del acceso.
create or replace function public.cambiar_acceso_cliente(p_usuario_id uuid, p_activo boolean)
returns void language plpgsql security definer set search_path = public as $$
declare u record; v_kcli uuid; v_kact boolean; v_hay boolean := false;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión.' using errcode = '42501'; end if;
  select * into u from usuarios where id = p_usuario_id;
  if not found or u.role <> 'cliente' then raise exception 'Usuario del portal no encontrado' using errcode = 'P0001'; end if;
  if not public.puede_gestionar_contacto(u.cliente_id, null) then raise exception 'No tienes permiso sobre este cliente' using errcode = 'P0001'; end if;
  if p_activo and u.contacto_id is not null then
    select k.cliente_id, k.activo, true into v_kcli, v_kact, v_hay from cliente_contactos k where k.id = u.contacto_id;
    if v_hay and v_kcli is distinct from u.cliente_id then
      raise exception 'Este contacto ya no pertenece al cliente de su acceso: dale acceso de nuevo desde su ficha' using errcode = 'P0001';
    end if;
    if v_hay and not v_kact then raise exception 'El contacto está desactivado: actívalo antes de reactivar su acceso' using errcode = 'P0001'; end if;
  end if;
  perform set_config('guds.bypass_guard', 'on', true);
  update usuarios set activo = p_activo where id = u.id;
  perform set_config('guds.bypass_guard', 'off', true);
  update auth.users set banned_until = case when p_activo then null else 'infinity'::timestamptz end, updated_at = now() where id = u.auth_id;
  if not p_activo then delete from auth.sessions where user_id = u.auth_id; end if;
end $$;

-- Estado del acceso al portal de los contactos que quien llama puede ver (la tabla usuarios no es legible para todos)
create or replace function public.accesos_portal_contactos()
returns table(contacto_id uuid, usuario_id uuid, email text, activo boolean, debe_cambiar_clave boolean, cliente_id uuid, ultimo_ingreso timestamptz)
language sql stable security definer set search_path = public as $$
  select u.contacto_id, u.id, u.email, coalesce(u.activo, true), coalesce(u.debe_cambiar_clave, false), u.cliente_id, a.last_sign_in_at
  from usuarios u
  join cliente_contactos k on k.id = u.contacto_id
  left join auth.users a on a.id = u.auth_id
  where u.role = 'cliente' and auth.uid() is not null
    and (k.empresa_id is null or k.empresa_id = any (public.empresas_visibles()))
    and (public.puede('contactos', 'ver')
         or (k.cliente_id is not null and (public.puede('clientes', 'ver') or public.es_vendedor_de(k.cliente_id)))
         or (k.proveedor_id is not null and public.puede('compras', 'ver')))
$$;

-- ── 5. Odoo ──────────────────────────────────────────────────────────────
-- Enviar (o reenviar) a Odoo un contacto de GUDS de un cliente o proveedor que ya está en Odoo
create or replace function public.enviar_contacto_odoo(p_contacto_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare k record; v_odoo integer; v_emp uuid;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión.' using errcode = '42501'; end if;
  select * into k from cliente_contactos c where c.id = p_contacto_id and (c.empresa_id is null or c.empresa_id = any (public.empresas_visibles()));
  if not found then raise exception 'Contacto no encontrado.' using errcode = 'P0002'; end if;
  if not (public.es_personal_admin() and public.puede_gestionar_contacto(k.cliente_id, k.proveedor_id)) then
    raise exception 'No tienes permiso para enviar este contacto a Odoo.' using errcode = '42501';
  end if;
  if k.origen = 'odoo' then raise exception 'Este contacto viene de Odoo: se edita en Odoo.' using errcode = 'P0001'; end if;
  if k.cliente_id is null and k.proveedor_id is null then
    raise exception 'Un contacto suelto vive solo en GUDS: no se envía a Odoo.' using errcode = 'P0001';
  end if;
  if k.cliente_id is not null then select c.odoo_id, c.empresa_id into v_odoo, v_emp from clientes c where c.id = k.cliente_id;
  else select p.odoo_id, p.empresa_id into v_odoo, v_emp from proveedores p where p.id = k.proveedor_id; end if;
  if v_odoo is null then raise exception 'Su cliente o proveedor aún no está en Odoo: el contacto se envía cuando quede vinculado.' using errcode = 'P0001'; end if;
  if k.odoo_id is null and not k.activo then raise exception 'El contacto está desactivado: no se crea en Odoo.' using errcode = 'P0001'; end if;
  if exists (select 1 from odoo_escrituras e where e.tipo = 'persona_contacto' and e.referencia_id = k.id and e.estado in ('pendiente', 'procesando')
             and coalesce(e.datos ->> 'accion', '') <> 'desligar' and e.created_at > now() - interval '15 minutes') then
    raise exception 'Ya hay un envío de este contacto en curso. Espera su resultado.' using errcode = 'P0001';
  end if;
  return public.encolar_escritura_odoo('persona_contacto', k.id, jsonb_strip_nulls(jsonb_build_object('cliente_id', k.cliente_id,
    'proveedor_id', k.proveedor_id, 'contacto_id', k.id, 'accion', case when k.odoo_id is null then 'crear' else 'editar' end,
    'nombre', k.nombre, 'origen', 'manual')), coalesce(v_emp, k.empresa_id));
end $$;

-- ── 6. Disparadores de cliente_contactos ─────────────────────────────────
-- Empresa: la de su cliente o proveedor; un contacto suelto nace en la empresa activa. Uno compartido toma la empresa de
-- su nuevo cliente o proveedor.
create or replace function public.trg_contacto_empresa()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_hay boolean := false; v_rol text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '');
begin
  if tg_op = 'UPDATE' and (new.cliente_id, new.proveedor_id) is not distinct from (old.cliente_id, old.proveedor_id) then return new; end if;
  if new.cliente_id is not null then select c.empresa_id, true into v_emp, v_hay from clientes c where c.id = new.cliente_id;
  elsif new.proveedor_id is not null then select p.empresa_id, true into v_emp, v_hay from proveedores p where p.id = new.proveedor_id; end if;
  if tg_op = 'INSERT' then
    if new.empresa_id is null and not v_hay and v_rol = 'authenticated' then
      new.empresa_id := public.empresa_activa();
      if new.empresa_id is null then
        raise exception 'Modo consulta ("Ambas empresas"): selecciona GUDS o Quirutec en el menú superior para crear un contacto.' using errcode = 'P0001';
      end if;
    elsif new.empresa_id is null then
      new.empresa_id := v_emp;
    end if;
  elsif new.empresa_id is null and v_emp is not null then
    new.empresa_id := v_emp;
  end if;
  return new;
end $$;

-- odoo_id, origen y datos de Odoo: los fijan la sincronización o el escritor, nunca la API
create or replace function public.trg_contacto_odoo_protegido()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '') <> 'authenticated' then return new; end if;
  if tg_op = 'INSERT' then
    new.odoo_id := null; new.origen := 'guds'; new.odoo_padre_id := null; new.odoo_sync_at := null;
  else
    new.odoo_id := old.odoo_id; new.origen := old.origen; new.odoo_padre_id := old.odoo_padre_id; new.odoo_sync_at := old.odoo_sync_at;
  end if;
  return new;
end $$;

-- Contactos que vienen de Odoo: sus datos se editan en Odoo; el cliente o proveedor solo se asigna en GUDS si en Odoo no
-- pertenece a ninguna empresa. No se borra un contacto con usuario del portal.
create or replace function public.trg_contacto_espejo()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_rol text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '');
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from usuarios u where u.contacto_id = old.id) then
      raise exception 'Este contacto tiene usuario del portal: desactiva su acceso (o el contacto) en lugar de eliminarlo.' using errcode = 'P0001';
    end if;
    if v_rol = 'authenticated' and old.origen = 'odoo' then
      raise exception 'Este contacto viene de Odoo: se archiva o se elimina en Odoo.' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if v_rol <> 'authenticated' or old.origen <> 'odoo' then return new; end if;
  if (new.nombre, new.cargo, new.email, new.telefono, new.celular, new.activo)
     is distinct from (old.nombre, old.cargo, old.email, old.telefono, old.celular, old.activo) then
    raise exception 'Los datos de este contacto vienen de Odoo y se editan en Odoo.' using errcode = 'P0001';
  end if;
  if old.odoo_padre_id is not null and (new.cliente_id, new.proveedor_id) is distinct from (old.cliente_id, old.proveedor_id) then
    raise exception 'En Odoo este contacto pertenece a una empresa: el cambio se hace en Odoo.' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- Reglas al editar: el correo de un acceso activo no cambia; al cambiar de cliente o proveedor deja de ser el principal y,
-- si era un contacto de GUDS ya enviado a Odoo, se suelta de ese registro (en Odoo se queda donde estaba).
create or replace function public.trg_contacto_reglas()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_rol text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '');
begin
  new.updated_at := now();
  if v_rol = 'authenticated' and lower(coalesce(new.email, '')) is distinct from lower(coalesce(old.email, ''))
     and new.cliente_id is not distinct from old.cliente_id
     and exists (select 1 from usuarios u where u.contacto_id = old.id and u.role = 'cliente' and coalesce(u.activo, true)) then
    raise exception 'El correo es el usuario del portal de este contacto: desactiva su acceso para cambiarlo y luego vuelve a darlo con el correo nuevo.' using errcode = 'P0001';
  end if;
  if (new.cliente_id, new.proveedor_id) is distinct from (old.cliente_id, old.proveedor_id) then
    if old.es_principal and new.es_principal then new.es_principal := false; end if;
    if new.origen = 'guds' and old.odoo_id is not null then
      new.odoo_id := null; new.odoo_padre_id := null;
    end if;
  end if;
  if new.cliente_id is null and new.proveedor_id is null then new.es_principal := false; end if;
  return new;
end $$;

-- Al quitarle el cliente (o pasarlo a otro) o desactivar el contacto, su acceso al portal se desactiva solo
create or replace function public.trg_contacto_acceso()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.cliente_id is distinct from old.cliente_id or (old.activo and not new.activo) then
    perform public.desactivar_acceso_contacto(new.id);
  end if;
  return null;
end $$;

-- Contacto de GUDS creado o editado por administración → a la cola hacia Odoo si su cliente o proveedor está en Odoo
-- (20s). Sueltos: solo GUDS. Desactivar no se envía. Si cambió de cliente o proveedor y ya estaba en Odoo, queda una nota
-- "(GUDS)" en el contacto de Odoo (acción 'desligar').
create or replace function public.trg_contacto_odoo_encolar()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_odoo integer; v_emp uuid; v_accion text;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '') <> 'authenticated' then return null; end if;
  if new.origen <> 'guds' then return null; end if;
  if tg_op = 'UPDATE' and old.odoo_id is not null and new.odoo_id is null
     and public.es_personal_admin() and public.puede_gestionar_contacto(old.cliente_id, old.proveedor_id) then
    perform public.encolar_escritura_odoo('persona_contacto', new.id, jsonb_strip_nulls(jsonb_build_object(
      'accion', 'desligar', 'contacto_id', new.id, 'nombre', new.nombre, 'odoo_id_anterior', old.odoo_id,
      'cliente_id', old.cliente_id, 'proveedor_id', old.proveedor_id,
      'destino', coalesce((select c.nombre_negocio from clientes c where c.id = new.cliente_id), (select p.nombre from proveedores p where p.id = new.proveedor_id)))),
      coalesce(old.empresa_id, new.empresa_id));
  end if;
  if new.cliente_id is not null then select c.odoo_id, c.empresa_id into v_odoo, v_emp from clientes c where c.id = new.cliente_id;
  elsif new.proveedor_id is not null then select p.odoo_id, p.empresa_id into v_odoo, v_emp from proveedores p where p.id = new.proveedor_id;
  else return null; end if;
  if v_odoo is null then return null; end if;                 -- espera a que su cliente o proveedor quede ligado a Odoo
  if new.odoo_id is null then
    if not new.activo then return null; end if;
    if tg_op = 'UPDATE' and old.activo and (new.cliente_id, new.proveedor_id) is not distinct from (old.cliente_id, old.proveedor_id)
       and (new.nombre, new.cargo, new.email, new.telefono, new.celular) is not distinct from (old.nombre, old.cargo, old.email, old.telefono, old.celular) then
      return null;
    end if;
    v_accion := 'crear';
  else
    if tg_op = 'UPDATE' and (new.nombre, new.cargo, new.email, new.telefono, new.celular)
       is not distinct from (old.nombre, old.cargo, old.email, old.telefono, old.celular) then return null; end if;
    v_accion := 'editar';
  end if;
  if not (public.es_personal_admin() and public.puede_gestionar_contacto(new.cliente_id, new.proveedor_id)) then return null; end if;
  if exists (select 1 from odoo_escrituras e where e.tipo = 'persona_contacto' and e.referencia_id = new.id and e.estado = 'pendiente'
             and coalesce(e.datos ->> 'accion', '') <> 'desligar') then return null; end if;
  perform public.encolar_escritura_odoo('persona_contacto', new.id, jsonb_strip_nulls(jsonb_build_object('cliente_id', new.cliente_id,
    'proveedor_id', new.proveedor_id, 'contacto_id', new.id, 'accion', v_accion, 'nombre', new.nombre)), coalesce(v_emp, new.empresa_id));
  return null;
end $$;

drop trigger if exists a_heredar_empresa on public.cliente_contactos;
drop trigger if exists a_contacto_empresa on public.cliente_contactos;
create trigger a_contacto_empresa before insert or update on public.cliente_contactos
  for each row execute function public.trg_contacto_empresa();
drop trigger if exists b_contacto_odoo_protegido on public.cliente_contactos;
create trigger b_contacto_odoo_protegido before insert or update on public.cliente_contactos
  for each row execute function public.trg_contacto_odoo_protegido();
drop trigger if exists c_contacto_espejo on public.cliente_contactos;
create trigger c_contacto_espejo before update or delete on public.cliente_contactos
  for each row execute function public.trg_contacto_espejo();
drop trigger if exists d_contacto_reglas on public.cliente_contactos;
create trigger d_contacto_reglas before update on public.cliente_contactos
  for each row execute function public.trg_contacto_reglas();
drop trigger if exists z_validar_refs_empresa on public.cliente_contactos;
create trigger z_validar_refs_empresa before insert or update on public.cliente_contactos
  for each row execute function public.trg_validar_refs_empresa('cliente_id:clientes', 'proveedor_id:proveedores');
drop trigger if exists x_contacto_acceso on public.cliente_contactos;
create trigger x_contacto_acceso after update on public.cliente_contactos
  for each row execute function public.trg_contacto_acceso();
drop trigger if exists y_contacto_odoo_encolar on public.cliente_contactos;
create trigger y_contacto_odoo_encolar after insert or update on public.cliente_contactos
  for each row execute function public.trg_contacto_odoo_encolar();

-- ── 7. Políticas (restrictiva empresa_visible de 18l + permisivas por módulo) ──
drop policy if exists cliente_contactos_ver on public.cliente_contactos;
create policy cliente_contactos_ver on public.cliente_contactos for select to authenticated using (
  (select public.puede('contactos', 'ver'))
  or (cliente_id is not null and ((select public.puede('clientes', 'ver'))
      or cliente_id in (select c.id from public.clientes c where c.vendedor_asignado_id = (select public.usuario_actual_id()))))
  or (proveedor_id is not null and (select public.puede('compras', 'ver'))));
drop policy if exists cliente_contactos_crear on public.cliente_contactos;
create policy cliente_contactos_crear on public.cliente_contactos for insert to authenticated
  with check (public.puede_gestionar_contacto(cliente_id, proveedor_id));
drop policy if exists cliente_contactos_editar on public.cliente_contactos;
create policy cliente_contactos_editar on public.cliente_contactos for update to authenticated
  using (public.puede_gestionar_contacto(cliente_id, proveedor_id)) with check (public.puede_gestionar_contacto(cliente_id, proveedor_id));
drop policy if exists cliente_contactos_eliminar on public.cliente_contactos;
create policy cliente_contactos_eliminar on public.cliente_contactos for delete to authenticated
  using (public.puede_gestionar_contacto(cliente_id, proveedor_id));   -- los de Odoo o con usuario del portal: trg_contacto_espejo explica por qué no

-- ── 8. Buscador global: contactos por nombre, correo o teléfono, con enlace al módulo ──
create or replace function public.buscar_global(q text, limite integer DEFAULT 6, contexto text DEFAULT 'admin'::text)
 RETURNS TABLE(tipo text, id uuid, titulo text, subtitulo text, extra text, enlace text, relevancia integer)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $fn$
#variable_conflict use_column
declare
  v_t text := trim(coalesce(q, ''));
  v_p text;
  v_rif text;
  v_n integer := least(greatest(coalesce(limite, 6), 1), 25);
  v_vend boolean := coalesce(contexto, 'admin') = 'vendedor';
  v_dig text := regexp_replace(coalesce(q, ''), '\D', '', 'g');
begin
  if length(v_t) < 2 then return; end if;
  v_p := '%' || replace(replace(v_t, '%', ''), '_', '\_') || '%';
  v_rif := nullif(public.normalizar_rif(v_t), '');

  return query
  (select 'cliente'::text, c.id, c.nombre_negocio::text, concat_ws(' · ', c.rif, c.ciudad, c.codigo)::text, null::text,
          case when v_vend then '/vendedor/clientes?q=' || url_q(c.nombre_negocio) else '/admin/clientes/' || c.id end,
          case when c.nombre_negocio ilike v_t || '%' or public.normalizar_rif(c.rif) = v_rif then 2 else 1 end
   from clientes c
   where c.nombre_negocio ilike v_p or c.codigo ilike v_p or (v_rif is not null and length(v_rif) >= 4 and public.normalizar_rif(c.rif) like '%' || v_rif || '%')
   order by 7 desc, c.nombre_negocio limit v_n)
  union all
  (select 'contacto', k.id, k.nombre, concat_ws(' · ', k.cargo, k.email, coalesce(k.celular, k.telefono), coalesce(cl.nombre_negocio, pv.nombre, 'Suelto')), null,
          case when v_vend then '/vendedor/clientes?q=' || url_q(cl.nombre_negocio) else '/admin/contactos?contacto=' || k.id end, 1
   from cliente_contactos k left join clientes cl on cl.id = k.cliente_id left join proveedores pv on pv.id = k.proveedor_id
   where (not v_vend or k.cliente_id is not null)
     and (k.nombre ilike v_p or k.email ilike v_p or k.telefono ilike v_p or k.celular ilike v_p
          or (length(v_dig) >= 4 and (regexp_replace(coalesce(k.telefono, ''), '\D', '', 'g') like '%' || v_dig || '%'
                                      or regexp_replace(coalesce(k.celular, ''), '\D', '', 'g') like '%' || v_dig || '%')))
   order by k.nombre limit v_n)
  union all
  (select 'proveedor', v.id, v.nombre, concat_ws(' · ', v.rif, v.ciudad), null, '/admin/proveedores/' || v.id,
          case when v.nombre ilike v_t || '%' then 2 else 1 end
   from proveedores v
   where not v_vend and (v.nombre ilike v_p or v.codigo ilike v_p or (v_rif is not null and length(v_rif) >= 4 and public.normalizar_rif(v.rif) like '%' || v_rif || '%'))
   order by 7 desc, v.nombre limit v_n)
  union all
  (select 'producto', pr.id, pr.nombre, concat_ws(' · ', pr.sku, 'disp. ' || trunc(pr.stock_disponible)::text), null,
          case when v_vend then '/vendedor/inventario?q=' || url_q(coalesce(pr.sku, pr.nombre)) else '/admin/productos?q=' || url_q(coalesce(pr.sku, pr.nombre)) end,
          case when pr.sku ilike v_t or pr.nombre ilike v_t || '%' then 2 else 1 end
   from productos pr where (pr.nombre ilike v_p or pr.sku ilike v_p) and (not v_vend or pr.activo) order by 7 desc, pr.nombre limit v_n)
  union all
  (select 'orden', o.id, o.numero::text, concat_ws(' · ', case when o.numero_guds is not null then 'GUDS ' || o.numero_guds end, cl.nombre_negocio, o.estado::text, to_char(coalesce(o.fecha_pedido, o.created_at), 'DD/MM/YYYY')),
          '$' || to_char(o.total, 'FM999G999G990D00'),
          case when v_vend then '/vendedor/pedidos?q=' || url_q(o.numero) else '/admin/ordenes?orden=' || o.id end,
          case when o.numero ilike v_t or o.numero_guds ilike v_t then 3 when o.numero ilike v_t || '%' then 2 else 1 end
   from ordenes o left join clientes cl on cl.id = o.cliente_id
   where o.numero ilike v_p or o.numero_guds ilike v_p order by 7 desc, o.created_at desc limit v_n)
  union all
  (select case when f.tipo = 'nota_credito' then 'nota_credito' when f.es_nota_debito then 'nota_debito' else 'factura' end,
          f.id, f.numero::text, concat_ws(' · ', cl.nombre_negocio, to_char(f.fecha_emision, 'DD/MM/YYYY'), 'saldo $' || to_char(f.saldo_usd, 'FM999G999G990D00')),
          '$' || to_char(abs(f.total_usd), 'FM999G999G990D00'),
          case when v_vend then '/vendedor/clientes?q=' || url_q(cl.nombre_negocio) else '/admin/facturas/' || f.id end,
          case when f.numero ilike v_t then 3 when f.numero ilike v_t || '%' then 2 else 1 end
   from facturas f left join clientes cl on cl.id = f.cliente_id
   where f.numero ilike v_p or f.nro_control ilike v_p or f.referencia ilike v_p order by 7 desc, f.fecha_emision desc nulls last limit v_n)
  union all
  (select 'cobro', pg.id, pg.numero::text, concat_ws(' · ', cl.nombre_negocio, 'ref. ' || pg.referencia, pg.estado::text),
          '$' || to_char(pg.monto, 'FM999G999G990D00'),
          case when v_vend then '/vendedor/pagos?q=' || url_q(pg.numero) else '/admin/cuentas/' || pg.cliente_id end,
          case when pg.numero ilike v_t or pg.referencia ilike v_t then 2 else 1 end
   from pagos pg left join clientes cl on cl.id = pg.cliente_id
   where pg.numero ilike v_p or pg.referencia ilike v_p order by 7 desc, pg.created_at desc limit v_n)
  union all
  (select 'factura_proveedor', fp.id, fp.numero, concat_ws(' · ', (select nombre from proveedores where id = fp.proveedor_id), 'ref. ' || fp.referencia, to_char(fp.fecha_emision, 'DD/MM/YYYY')),
          '$' || to_char(abs(fp.total_usd), 'FM999G999G990D00'), '/admin/facturas-proveedor/' || fp.id, case when fp.numero ilike v_t or fp.referencia ilike v_t then 2 else 1 end
   from facturas_proveedor fp where not v_vend and (fp.numero ilike v_p or fp.referencia ilike v_p or fp.nro_control ilike v_p) order by 7 desc, fp.fecha_emision desc nulls last limit v_n)
  union all
  (select 'pago_proveedor', pp.id, pp.numero, concat_ws(' · ', (select nombre from proveedores where id = pp.proveedor_id), 'ref. ' || pp.referencia),
          '$' || to_char(pp.monto, 'FM999G999G990D00'), coalesce('/admin/proveedores/' || pp.proveedor_id, '/admin/cuentas-por-pagar'), 1
   from pagos_proveedor pp where not v_vend and (pp.numero ilike v_p or pp.referencia ilike v_p) order by pp.fecha desc nulls last limit v_n)
  union all
  (select 'orden_compra', oc.id, oc.numero, concat_ws(' · ', (select nombre from proveedores where id = oc.proveedor_id), oc.estado),
          '$' || to_char(oc.total_usd, 'FM999G999G990D00'), coalesce('/admin/proveedores/' || oc.proveedor_id, '/admin/cuentas-por-pagar'), 1
   from ordenes_compra oc where not v_vend and (oc.numero ilike v_p or oc.referencia_proveedor ilike v_p) order by oc.fecha_orden desc nulls last limit v_n)
  union all
  (select 'retencion', r.id, r.numero::text, concat_ws(' · ', upper(r.tipo::text), (select nombre_negocio from clientes where id = r.cliente_id), to_char(r.fecha, 'DD/MM/YYYY')),
          '$' || to_char(r.total, 'FM999G999G990D00'), '/admin/retenciones', 1
   from retenciones r where not v_vend and (r.numero ilike v_p or r.numero_comprobante ilike v_p) order by r.fecha desc nulls last limit v_n)
  union all
  (select 'retencion_emitida', re.id, re.numero, concat_ws(' · ', upper(re.tipo), (select nombre from proveedores where id = re.proveedor_id), to_char(re.fecha, 'DD/MM/YYYY')),
          '$' || to_char(re.total, 'FM999G999G990D00'), coalesce('/admin/proveedores/' || re.proveedor_id, '/admin/cuentas-por-pagar'), 1
   from retenciones_emitidas re where not v_vend and re.numero ilike v_p order by re.fecha desc nulls last limit v_n)
  union all
  (select 'lote', l.id, l.nombre, concat_ws(' · ', pl.nombre, 'vence ' || to_char(l.vencimiento, 'DD/MM/YYYY')),
          trunc(l.cantidad)::text || ' u',
          case when v_vend then '/vendedor/inventario?q=' || url_q(coalesce(pl.sku, pl.nombre)) else '/admin/lotes/' || l.id end,
          case when l.nombre ilike v_t then 2 else 1 end
   from lotes l left join productos pl on pl.id = l.producto_id
   where l.nombre ilike v_p order by 7 desc, l.vencimiento nulls last limit v_n)
  union all
  (select 'transferencia', tr.id, tr.numero, concat_ws(' · ', tr.contacto, tr.origen, tr.estado), null, '/admin/transferencias/' || tr.id,
          case when tr.numero ilike v_t then 2 else 1 end
   from transferencias tr where not v_vend and (tr.numero ilike v_p or tr.origen ilike v_p) order by 7 desc, tr.fecha_programada desc nulls last limit v_n)
  union all
  (select 'almacen', a.id, a.nombre, concat_ws(' · ', a.codigo, a.tipo), null, '/admin/almacenes/' || a.id, 1
   from almacenes a where not v_vend and (a.nombre ilike v_p or a.codigo ilike v_p) order by a.nombre limit v_n)
  union all
  (select 'banco', b.id, b.nombre::text, concat_ws(' · ', b.moneda, coalesce(b.cuenta_odoo, b.numero_cuenta)), null, '/admin/bancos/' || b.id, 1
   from bancos b where not v_vend and (b.nombre ilike v_p or b.cuenta_odoo ilike v_p or b.numero_cuenta ilike v_p) order by b.nombre limit v_n)
  union all
  (select 'vendedor', u.id, concat_ws(' ', u.nombre, u.apellido), u.email, null, '/admin/vendedores/' || u.id, 1
   from usuarios u where not v_vend and u.role = 'vendedor' and (concat_ws(' ', u.nombre, u.apellido) ilike v_p or u.email ilike v_p) order by u.nombre limit v_n);
end $fn$;

-- ── 9. Permisos de ejecución ─────────────────────────────────────────────
-- Internas: nadie las ejecuta por la API (ojo: "revoke ... from public" no basta en Supabase; se revoca de anon y authenticated)
revoke execute on function public.validar_clave_portal(text, text) from public, anon, authenticated;
revoke execute on function public.desactivar_acceso_contacto(uuid) from public, anon, authenticated;
revoke execute on function public.sincronizar_accesos_contactos() from public, anon, authenticated;
revoke execute on function public.trg_contacto_empresa() from public, anon, authenticated;
revoke execute on function public.trg_contacto_odoo_protegido() from public, anon, authenticated;
revoke execute on function public.trg_contacto_espejo() from public, anon, authenticated;
revoke execute on function public.trg_contacto_reglas() from public, anon, authenticated;
revoke execute on function public.trg_contacto_acceso() from public, anon, authenticated;
revoke execute on function public.trg_contacto_odoo_encolar() from public, anon, authenticated;
-- Acciones y reglas usadas por las políticas: con sesión (validan al llamador); sin anon
revoke execute on function public.puede_gestionar_contacto(uuid, uuid) from public, anon;
revoke execute on function public.crear_acceso_contacto(uuid, text, boolean) from public, anon;
revoke execute on function public.restablecer_clave_cliente(uuid, text, boolean) from public, anon;
revoke execute on function public.cambiar_acceso_cliente(uuid, boolean) from public, anon;
revoke execute on function public.accesos_portal_contactos() from public, anon;
revoke execute on function public.enviar_contacto_odoo(uuid) from public, anon;
grant execute on function public.puede_gestionar_contacto(uuid, uuid) to authenticated;
grant execute on function public.crear_acceso_contacto(uuid, text, boolean) to authenticated;
grant execute on function public.restablecer_clave_cliente(uuid, text, boolean) to authenticated;
grant execute on function public.cambiar_acceso_cliente(uuid, boolean) to authenticated;
grant execute on function public.accesos_portal_contactos() to authenticated;
grant execute on function public.enviar_contacto_odoo(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
