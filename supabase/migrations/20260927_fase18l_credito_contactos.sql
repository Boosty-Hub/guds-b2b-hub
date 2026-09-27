-- ════════════════════════════════════════════════════════════════════════
-- Fase 18l · Crédito, contactos del cliente y acceso al portal (docs/PLAN-ESPEJO-ODOO.md, Fase 8)
--   Crédito: modo "abierto" (por ahora) o "límite" (configuracion.credito_modo). El límite se puede editar en GUDS: queda
--   pendiente de enviar a Odoo (Fase 9) y la sincronización no lo pisa mientras tanto.
--   Contactos: personas del cliente (en Odoo hoy no hay contactos hijos; nacen en GUDS). Cada contacto puede tener su
--   usuario del portal; el admin genera una contraseña temporal y el contacto la cambia en su primer ingreso.
--   Clientes presentes en ambas empresas (mismo RIF): un solo usuario ve la ficha de la empresa activa.
-- ════════════════════════════════════════════════════════════════════════
begin;

-- ── Crédito ──────────────────────────────────────────────────────────────
insert into public.configuracion (clave, valor, tipo, descripcion)
values ('credito_modo', 'abierto', 'texto',
  'abierto = se permite comprar a crédito sin tope (mientras se actualizan los límites); limite = se exige el límite de crédito de cada cliente')
on conflict (clave) do nothing;

alter table public.clientes
  add column if not exists limite_credito_pendiente boolean not null default false,
  add column if not exists limite_credito_editado_en timestamptz;

create or replace function public.trg_cliente_limite_credito()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '') = 'authenticated'
     and new.limite_credito is distinct from old.limite_credito then
    new.limite_credito_pendiente := new.odoo_id is not null;   -- solo los clientes de Odoo esperan envío a Odoo
    new.limite_credito_editado_en := now();
  end if;
  return new;
end $$;
drop trigger if exists b_cliente_limite_credito on public.clientes;
create trigger b_cliente_limite_credito before update on public.clientes for each row execute function public.trg_cliente_limite_credito();

-- El límite de crédito deja de estar bloqueado como dato de Odoo (se edita en GUDS y se envía a Odoo)
drop trigger if exists c_proteger_espejo_odoo on public.clientes;
create trigger c_proteger_espejo_odoo before update or delete on public.clientes for each row
  execute function public.trg_proteger_espejo_odoo('codigo', 'nombre_negocio', 'rif', 'cedula', 'email', 'telefono', 'celular', 'direccion',
    'ciudad', 'estado', 'latitud', 'longitud', 'es_empresa', 'tipo_negocio', 'tipo_residencia', 'vendedor_odoo', 'condicion_pago', 'dias_credito',
    'licencia_actividad', 'sitio_web', 'notas', 'fecha_registro_odoo', 'activo', 'empresa_id', 'vendedor_asignado_id|vendedor_odoo');

-- ¿Puede este cliente comprar a crédito por este monto? (modo abierto: sí; modo límite: saldo + pedidos + monto ≤ límite)
create or replace function public.credito_disponible(p_cliente_id uuid)
returns table(modo text, limite numeric, utilizado numeric, en_pedidos numeric, disponible numeric)
language sql stable security definer set search_path = public as $$
  select coalesce((select valor from configuracion where clave = 'credito_modo'), 'abierto'),
    c.limite_credito, c.credito_utilizado,
    coalesce((select sum(o.total) from ordenes o where o.cliente_id = c.id and o.odoo_id is null and o.metodo_pago = 'credito'
              and o.estado in ('pendiente', 'confirmado', 'procesando', 'enviado')), 0),
    greatest(coalesce(c.limite_credito, 0) - coalesce(c.credito_utilizado, 0)
      - coalesce((select sum(o.total) from ordenes o where o.cliente_id = c.id and o.odoo_id is null and o.metodo_pago = 'credito'
                  and o.estado in ('pendiente', 'confirmado', 'procesando', 'enviado')), 0), 0)
  from clientes c where c.id = p_cliente_id
$$;
grant execute on function public.credito_disponible(uuid) to authenticated;

create or replace function public.validar_credito(p_cliente_id uuid, p_monto numeric)
returns void language plpgsql stable security definer set search_path = public as $$
declare r record;
begin
  select * into r from public.credito_disponible(p_cliente_id);
  if r.modo = 'abierto' then return; end if;
  if coalesce(r.limite, 0) <= 0 then
    raise exception 'Este cliente no tiene crédito aprobado. Elige otro método de pago o solicita un límite de crédito.' using errcode = 'P0001';
  end if;
  if p_monto > r.disponible + 0.009 then
    raise exception 'El pedido ($%) supera el crédito disponible ($%).', round(p_monto, 2), round(r.disponible, 2) using errcode = 'P0001';
  end if;
end $$;
grant execute on function public.validar_credito(uuid, numeric) to authenticated;

-- ── Contactos del cliente ────────────────────────────────────────────────
create table if not exists public.cliente_contactos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas(id),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  nombre text not null,
  cargo text,
  email text,
  telefono text,
  celular text,
  es_principal boolean not null default false,
  notas text,
  activo boolean not null default true,
  odoo_id integer unique,                               -- si el contacto existe (o se crea) en Odoo
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cliente_contactos_cliente_idx on public.cliente_contactos (cliente_id);
create unique index if not exists cliente_contactos_email_uq on public.cliente_contactos (cliente_id, lower(email)) where email is not null;

alter table public.usuarios
  add column if not exists contacto_id uuid references public.cliente_contactos(id) on delete set null,
  add column if not exists debe_cambiar_clave boolean not null default false;

drop trigger if exists a_heredar_empresa on public.cliente_contactos;
create trigger a_heredar_empresa before insert on public.cliente_contactos
  for each row execute function public.trg_heredar_empresa('clientes', 'cliente_id');
drop trigger if exists z_guardia_empresa on public.cliente_contactos;
create trigger z_guardia_empresa before insert or update or delete on public.cliente_contactos
  for each row execute function public.trg_guardia_empresa();

alter table public.cliente_contactos enable row level security;
drop policy if exists empresa_visible on public.cliente_contactos;
create policy empresa_visible on public.cliente_contactos as restrictive for all to authenticated
  using (empresa_id is null or empresa_id = any ((select public.empresas_visibles())::uuid[]));
drop policy if exists cliente_contactos_ver on public.cliente_contactos;
create policy cliente_contactos_ver on public.cliente_contactos for select to authenticated using (public.puede('clientes', 'ver'));
drop policy if exists cliente_contactos_crear on public.cliente_contactos;
create policy cliente_contactos_crear on public.cliente_contactos for insert to authenticated with check (public.puede('clientes', 'editar'));
drop policy if exists cliente_contactos_editar on public.cliente_contactos;
create policy cliente_contactos_editar on public.cliente_contactos for update to authenticated
  using (public.puede('clientes', 'editar')) with check (public.puede('clientes', 'editar'));
drop policy if exists cliente_contactos_eliminar on public.cliente_contactos;
create policy cliente_contactos_eliminar on public.cliente_contactos for delete to authenticated using (public.puede('clientes', 'editar'));

-- ── Clientes presentes en ambas empresas: el usuario accede a las dos fichas (mismo RIF) ──
create or replace function public.clientes_del_usuario()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct c2.id), '{}')
  from usuarios u
  join clientes c on c.id = u.cliente_id
  join clientes c2 on c2.id = c.id
    or (c.rif is not null and public.normalizar_rif(c2.rif) = public.normalizar_rif(c.rif))
  where u.auth_id = auth.uid() and coalesce(u.activo, true)
$$;
grant execute on function public.clientes_del_usuario() to authenticated;

-- Ficha del cliente para la empresa activa (o la propia si no hay otra)
create or replace function public.mi_cliente_id()
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select c.id from clientes c where c.id = any (public.clientes_del_usuario()) and c.empresa_id = public.empresa_activa() limit 1),
    (select c.id from clientes c where c.id = any (public.clientes_del_usuario()) and c.empresa_id is null limit 1),
    (select u.cliente_id from usuarios u where u.auth_id = auth.uid()))
$$;
grant execute on function public.mi_cliente_id() to authenticated;

create or replace function public.trg_usuario_empresas_cliente()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.cliente_id is not null and (tg_op = 'INSERT' or new.cliente_id is distinct from old.cliente_id) then
    insert into usuario_empresas (usuario_id, empresa_id, por_defecto)
    select new.id, e.id, row_number() over (order by (e.id = c.empresa_id) desc, e.orden) = 1
    from clientes c
    join empresas e on e.activo and (
      c.empresa_id is null or e.id = c.empresa_id
      or exists (select 1 from clientes t where t.empresa_id = e.id and c.rif is not null
                 and public.normalizar_rif(t.rif) = public.normalizar_rif(c.rif)))
    where c.id = new.cliente_id
    on conflict (usuario_id, empresa_id) do nothing;
  end if;
  return new;
end $$;

-- ── Acceso al portal de un contacto (contraseña temporal; el contacto la cambia al entrar) ──
create or replace function public.crear_acceso_contacto(p_contacto_id uuid, p_password text default null)
returns table(usuario_id uuid, email text, password_temporal text)
language plpgsql security definer set search_path = public as $$
declare k record; v_pass text; v_auth uuid; v_uid uuid; v_nombre text; v_apellido text;
begin
  if not public.puede('clientes', 'editar') then raise exception 'No tienes permiso para dar acceso al portal' using errcode = 'P0001'; end if;
  select * into k from cliente_contactos where id = p_contacto_id;
  if not found then raise exception 'Contacto no encontrado' using errcode = 'P0001'; end if;
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
revoke all on function public.crear_acceso_contacto(uuid, text) from public;
grant execute on function public.crear_acceso_contacto(uuid, text) to authenticated;

-- Nueva contraseña temporal para un usuario del portal (lo pide el admin cuando el contacto la olvida)
create or replace function public.restablecer_clave_cliente(p_usuario_id uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare u record; v_pass text;
begin
  if not public.puede('clientes', 'editar') then raise exception 'No tienes permiso para restablecer contraseñas' using errcode = 'P0001'; end if;
  select * into u from usuarios where id = p_usuario_id;
  if not found or u.role <> 'cliente' then raise exception 'Solo se restablecen contraseñas de usuarios del portal de clientes' using errcode = 'P0001'; end if;
  v_pass := public.generar_password_temporal();
  update auth.users set encrypted_password = crypt(v_pass, gen_salt('bf')), updated_at = now() where id = u.auth_id;
  update usuarios set debe_cambiar_clave = true where id = u.id;
  return v_pass;
end $$;
revoke all on function public.restablecer_clave_cliente(uuid) from public;
grant execute on function public.restablecer_clave_cliente(uuid) to authenticated;

-- Activar / desactivar el acceso (desactivado: no puede iniciar sesión)
create or replace function public.cambiar_acceso_cliente(p_usuario_id uuid, p_activo boolean)
returns void language plpgsql security definer set search_path = public as $$
declare u record;
begin
  if not public.puede('clientes', 'editar') then raise exception 'No tienes permiso' using errcode = 'P0001'; end if;
  select * into u from usuarios where id = p_usuario_id;
  if not found or u.role <> 'cliente' then raise exception 'Usuario del portal no encontrado' using errcode = 'P0001'; end if;
  update usuarios set activo = p_activo where id = u.id;
  update auth.users set banned_until = case when p_activo then null else 'infinity'::timestamptz end where id = u.auth_id;
end $$;
revoke all on function public.cambiar_acceso_cliente(uuid, boolean) from public;
grant execute on function public.cambiar_acceso_cliente(uuid, boolean) to authenticated;

-- El propio usuario marca que ya cambió su contraseña temporal
create or replace function public.marcar_clave_cambiada()
returns void language sql security definer set search_path = public as $$
  update usuarios set debe_cambiar_clave = false where auth_id = auth.uid()
$$;
grant execute on function public.marcar_clave_cambiada() to authenticated;

commit;
