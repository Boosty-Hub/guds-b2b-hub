-- ════════════════════════════════════════════════════════════════════════
-- Fase 19s · Empresas del cliente en el portal (decisión 28-sep: el selector GUDS / Quirutec solo aparece si el cliente
-- tiene habilitadas ambas empresas, y se habilita desde la ficha del cliente)
--   Antes, al crear el acceso al portal se daban todas las empresas donde el cliente tiene ficha (mismo RIF).
--   Ahora: clientes.portal_habilitado por ficha; la empresa de la ficha a la que está ligado el usuario siempre se ofrece,
--   las demás solo si se habilitan.
--   habilitar_empresa_portal() lo cambia desde el admin (Clientes → Contactos y acceso) y ajusta usuario_empresas de los
--   usuarios del portal de ese cliente. trg_guardia_empresa respeta guds.bypass_guard (solo lo activan funciones internas;
--   no se puede fijar por REST) para escribir la ficha de la otra empresa.
-- ════════════════════════════════════════════════════════════════════════
begin;

alter table public.clientes add column if not exists portal_habilitado boolean;
comment on column public.clientes.portal_habilitado is 'Portal de clientes: esta empresa se ofrece al cliente (null = solo si es la ficha del usuario)';

create or replace function public.trg_guardia_empresa()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_rol text; v_emp uuid; v_activa uuid;
begin
  v_rol := coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '');
  if v_rol <> 'authenticated' then return coalesce(new, old); end if;
  -- Funciones internas que ya validaron permisos (p. ej. habilitar_empresa_portal)
  if coalesce(current_setting('guds.bypass_guard', true), '') = 'on' then return coalesce(new, old); end if;

  if tg_op = 'UPDATE' and old.empresa_id is not null and old.empresa_id is distinct from new.empresa_id then
    raise exception 'No se puede cambiar la empresa de un registro.' using errcode = 'P0001';
  end if;

  v_emp := case when tg_op = 'DELETE' then old.empresa_id else new.empresa_id end;
  if v_emp is null then return coalesce(new, old); end if;   -- compartido (viene de Odoo)

  v_activa := public.empresa_activa();
  if v_activa is null then
    raise exception 'Modo consulta ("Ambas empresas"): selecciona GUDS o Quirutec en el menú superior para hacer cambios.'
      using errcode = 'P0001';
  end if;
  if v_emp <> v_activa then
    raise exception 'Este registro pertenece a otra empresa. Cámbiala en el menú superior.' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;

-- Fichas del mismo cliente (mismo RIF) en todas las empresas
create or replace function public.fichas_cliente(p_cliente_id uuid)
returns setof public.clientes language sql stable security definer set search_path = public as $$
  select t.* from clientes c join clientes t on t.id = c.id
    or (c.rif is not null and t.rif is not null and public.normalizar_rif(t.rif) = public.normalizar_rif(c.rif))
  where c.id = p_cliente_id;
$$;
revoke execute on function public.fichas_cliente(uuid) from public, anon, authenticated;

create or replace function public.trg_usuario_empresas_cliente()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.cliente_id is not null and (tg_op = 'INSERT' or new.cliente_id is distinct from old.cliente_id) then
    insert into usuario_empresas (usuario_id, empresa_id, por_defecto)
    select new.id, e.id, row_number() over (order by (e.id = c.empresa_id) desc, e.orden) = 1
    from clientes c
    join empresas e on e.activo and (
      c.empresa_id is null
      or exists (select 1 from public.fichas_cliente(c.id) t
                 where t.empresa_id = e.id and (t.id = c.id or coalesce(t.portal_habilitado, false))))
    where c.id = new.cliente_id
    on conflict (usuario_id, empresa_id) do nothing;
  end if;
  return new;
end $$;

-- Para el admin: empresas activas, si el cliente tiene ficha en cada una y si está habilitada en el portal
create or replace function public.empresas_portal_cliente(p_cliente_id uuid)
returns table(empresa_id uuid, empresa text, ficha_id uuid, habilitada boolean, principal boolean, usuarios bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.es_personal_admin() and public.puede('clientes', 'ver')) then
    raise exception 'No tienes permiso para ver este cliente' using errcode = '42501';
  end if;
  return query
  select e.id, e.nombre_corto::text, f.id,
         f.id = p_cliente_id or coalesce(f.portal_habilitado, false),
         f.id = p_cliente_id,
         (select count(*) from usuarios u where u.role = 'cliente' and u.cliente_id = f.id)
  from empresas e
  left join lateral (select t.* from public.fichas_cliente(p_cliente_id) t where t.empresa_id = e.id limit 1) f on true
  where e.activo
  order by e.orden;
end $$;
revoke execute on function public.empresas_portal_cliente(uuid) from public, anon;
grant execute on function public.empresas_portal_cliente(uuid) to authenticated;

create or replace function public.habilitar_empresa_portal(p_cliente_id uuid, p_empresa_id uuid, p_habilitado boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_ficha uuid; v_usuarios uuid[];
begin
  if not (public.es_personal_admin() and public.puede_gestionar_cliente(p_cliente_id)) then
    raise exception 'No tienes permiso sobre este cliente' using errcode = '42501';
  end if;
  select t.id into v_ficha from public.fichas_cliente(p_cliente_id) t where t.empresa_id = p_empresa_id limit 1;
  if v_ficha is null then
    raise exception 'El cliente no existe en esa empresa: primero debe crearse en Odoo' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(u.id), '{}') into v_usuarios
  from usuarios u where u.role = 'cliente' and u.cliente_id in (select t.id from public.fichas_cliente(p_cliente_id) t);
  if not p_habilitado and (v_ficha = p_cliente_id or exists (select 1 from usuarios u where u.role = 'cliente' and u.cliente_id = v_ficha)) then
    raise exception 'Es la empresa de la ficha del cliente (o de sus usuarios del portal): siempre está habilitada' using errcode = 'P0001';
  end if;

  perform set_config('guds.bypass_guard', 'on', true);
  update clientes set portal_habilitado = p_habilitado where id = v_ficha;
  perform set_config('guds.bypass_guard', 'off', true);

  if p_habilitado then
    insert into usuario_empresas (usuario_id, empresa_id, por_defecto)
    select x, p_empresa_id, false from unnest(v_usuarios) x
    on conflict (usuario_id, empresa_id) do nothing;
  else
    delete from usuario_empresas where empresa_id = p_empresa_id and usuario_id = any(v_usuarios);
    -- Quien se quedó sin empresa por defecto toma la de su ficha
    update usuario_empresas ue set por_defecto = true
    from usuarios u join clientes c on c.id = u.cliente_id
    where ue.usuario_id = u.id and ue.empresa_id = c.empresa_id and u.id = any(v_usuarios)
      and not exists (select 1 from usuario_empresas x where x.usuario_id = u.id and x.por_defecto);
  end if;
end $$;
revoke execute on function public.habilitar_empresa_portal(uuid, uuid, boolean) from public, anon;
grant execute on function public.habilitar_empresa_portal(uuid, uuid, boolean) to authenticated;

notify pgrst, 'reload schema';

commit;
