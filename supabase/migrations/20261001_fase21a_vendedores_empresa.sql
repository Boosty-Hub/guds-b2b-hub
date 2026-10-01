-- ════════════════════════════════════════════════════════════════════════
-- Fase 21a · 0.3, 0.4 y 1.2 Vendedores por empresa, usuarios de prueba y correo real (plan de revisión del 30-sep).
--   0.3 usuarios.es_prueba: usuarios de QA (qa.*, e2e.*, test.* @guds.test y @gudsqa.com). Se conservan (los usa la QA)
--       pero no salen en listas, KPI, metas ni selectores de asignación. Se marca solo al crear o cambiar el correo.
--   1.2 vendedor_empresas(usuario): empresas a las que pertenece un vendedor, en este orden:
--         1) las de sus clientes activos asignados (sin contar empleados; un cliente compartido cuenta en las dos);
--         2) si no tiene clientes, las de sus pedidos de los últimos 12 meses (no cancelados, a clientes no empleados);
--         3) si tampoco, las empresas a las que tiene acceso (usuario_empresas): vendedor nuevo.
--       Odoo da acceso a las dos compañías a casi todos sus usuarios, por eso el acceso solo decide en el último caso.
--       vendedores_empresa(): lista para la pantalla Vendedores y los selectores (Reasignar a, alta de clientes, órdenes),
--       con la cartera de la empresa visible. metas_vendedores(): mismos vendedores.
--   0.4 Correo real: usuarios.odoo_login / odoo_user_id / odoo_activo (login del usuario de Odoo con el mismo nombre; lo
--       llena la sincronización) como sugerencia, y actualizar_acceso_vendedor(): cambia el correo de entrada, pone una
--       contraseña (temporal generada o elegida) y quita bloqueos; mismo flujo que el acceso de contactos (20v).
-- ════════════════════════════════════════════════════════════════════════
begin;

alter table public.usuarios
  add column if not exists es_prueba boolean not null default false,
  add column if not exists odoo_user_id integer,
  add column if not exists odoo_login text,
  add column if not exists odoo_activo boolean;
comment on column public.usuarios.es_prueba is 'Usuario de QA: no sale en listas, KPI, metas ni asignaciones.';
comment on column public.usuarios.odoo_login is 'Login del usuario de Odoo con el mismo nombre (sugerencia de correo real). Lo llena la sincronización.';

create or replace function public.es_correo_prueba(p_email text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(lower(btrim(p_email)) like '%@gudsqa.com' or lower(btrim(p_email)) ~ '^(qa|e2e|test)[._-][^@]*@guds\.test$', false)
$$;

create or replace function public.trg_usuario_es_prueba()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.email is distinct from old.email then
    new.es_prueba := coalesce(new.es_prueba, false) or public.es_correo_prueba(new.email);
  end if;
  return new;
end $$;
revoke all on function public.trg_usuario_es_prueba() from public, anon, authenticated;
drop trigger if exists a_usuario_es_prueba on public.usuarios;
create trigger a_usuario_es_prueba before insert or update of email on public.usuarios
  for each row execute function public.trg_usuario_es_prueba();

update public.usuarios set es_prueba = true where not es_prueba and public.es_correo_prueba(email);

-- ── Empresas de un vendedor (interna) ──
create or replace function public.vendedor_empresas(p_usuario uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(
    (select array_agg(distinct e.id order by e.id)
       from clientes c join empresas e on c.empresa_id = e.id or c.empresa_id is null
      where c.vendedor_asignado_id = p_usuario and c.activo and not c.es_empleado),
    (select array_agg(distinct o.empresa_id order by o.empresa_id)
       from ordenes o join clientes c on c.id = o.cliente_id
      where o.vendedor_id = p_usuario and o.empresa_id is not null and not c.es_empleado and o.estado::text <> 'cancelado'
        and coalesce(o.fecha_pedido, o.created_at) >= now() - interval '12 months'),
    (select array_agg(ue.empresa_id order by ue.empresa_id) from usuario_empresas ue where ue.usuario_id = p_usuario),
    '{}'::uuid[])
$$;
revoke all on function public.vendedor_empresas(uuid) from public, anon, authenticated;

-- ── Vendedores de la empresa activa (o de las dos en «Ambas») ──
drop function if exists public.vendedores_empresa(boolean);
create or replace function public.vendedores_empresa(p_incluir_prueba boolean default false)
returns table(id uuid, nombre text, apellido text, email text, telefono text, activo boolean, es_prueba boolean,
              empresas uuid[], clientes integer, correo_pendiente boolean, odoo_login text, odoo_activo boolean,
              ultimo_ingreso timestamptz, debe_cambiar_clave boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_vis uuid[] := public.empresas_visibles();
begin
  if not public.es_personal_admin() then
    raise exception 'No tienes permiso para ver los vendedores' using errcode = '42501';
  end if;
  return query
  with v as (
    select u.*, public.vendedor_empresas(u.id) emps
      from usuarios u
     where u.role = 'vendedor' and (p_incluir_prueba or not u.es_prueba)
  )
  select v.id, v.nombre::text, v.apellido::text, v.email::text, v.telefono::text, coalesce(v.activo, true), v.es_prueba,
         (select array_agg(x order by x) from unnest(v.emps) x where x = any (v_vis)),
         (select count(*)::int from clientes c
           where c.vendedor_asignado_id = v.id and c.activo and not c.es_empleado
             and (c.empresa_id is null or c.empresa_id = any (v_vis))),
         lower(v.email) like '%@guds.test' and not v.es_prueba,
         v.odoo_login, v.odoo_activo, a.last_sign_in_at, coalesce(v.debe_cambiar_clave, false)
    from v left join auth.users a on a.id = v.auth_id
   where v.emps && v_vis
   order by v.nombre, v.apellido;
end $$;
revoke all on function public.vendedores_empresa(boolean) from public, anon;
grant execute on function public.vendedores_empresa(boolean) to authenticated;

-- ── Correo real y acceso de un vendedor ──
drop function if exists public.actualizar_acceso_vendedor(uuid, text, text, boolean);
create or replace function public.actualizar_acceso_vendedor(p_usuario_id uuid, p_email text, p_password text default null,
                                                             p_pedir_cambio boolean default true)
returns table(email text, password_temporal text)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare u record; v_email text; v_pass text; v_generada boolean; v_cambio boolean; v_auth uuid;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión.' using errcode = '42501'; end if;
  if not (public.is_admin() and public.puede('usuarios', 'editar')) then
    raise exception 'No tienes permiso para cambiar el acceso de los vendedores' using errcode = '42501';
  end if;
  select * into u from usuarios x where x.id = p_usuario_id;
  if not found or u.role <> 'vendedor' then raise exception 'Vendedor no encontrado' using errcode = 'P0001'; end if;
  v_email := lower(btrim(coalesce(p_email, '')));
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Escribe un correo válido' using errcode = 'P0001';
  end if;
  if v_email like '%@guds.test' and not u.es_prueba then
    raise exception 'Usa el correo real del vendedor (los @guds.test son de relleno)' using errcode = 'P0001';
  end if;
  if exists (select 1 from usuarios x where lower(x.email) = v_email and x.id <> u.id)
     or exists (select 1 from auth.users a where lower(a.email) = v_email and a.id is distinct from u.auth_id) then
    raise exception 'Ya existe un usuario con el correo %', v_email using errcode = 'P0001';
  end if;
  v_generada := nullif(btrim(coalesce(p_password, '')), '') is null;
  v_pass := case when v_generada then public.generar_password_temporal() else p_password end;
  if not v_generada then perform public.validar_clave_portal(v_pass, v_email); end if;
  v_cambio := v_generada or coalesce(p_pedir_cambio, true);

  v_auth := u.auth_id;
  if v_auth is null or not exists (select 1 from auth.users a where a.id = v_auth) then
    v_auth := public.crear_auth_user(v_email, v_pass);
  else
    update auth.users set email = v_email,
           raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('email', v_email),
           encrypted_password = crypt(v_pass, gen_salt('bf')), email_confirmed_at = coalesce(email_confirmed_at, now()),
           banned_until = null, updated_at = now()
     where id = v_auth;
    update auth.identities set identity_data = identity_data || jsonb_build_object('email', v_email), updated_at = now()
     where user_id = v_auth and provider = 'email';
    delete from auth.sessions where user_id = v_auth;
  end if;
  perform set_config('guds.bypass_guard', 'on', true);
  update usuarios set email = v_email, auth_id = v_auth, debe_cambiar_clave = v_cambio where id = u.id;
  perform set_config('guds.bypass_guard', 'off', true);
  return query select v_email, case when v_generada then v_pass else null end;
end $$;
revoke all on function public.actualizar_acceso_vendedor(uuid, text, text, boolean) from public, anon;
grant execute on function public.actualizar_acceso_vendedor(uuid, text, text, boolean) to authenticated;

-- ── Metas: los vendedores de la empresa (sin QA) y la cartera sin empleados ──
CREATE OR REPLACE FUNCTION public.metas_vendedores(p_anio integer, p_mes integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_visibles uuid[] := public.empresas_visibles();
  v_activa uuid := public.empresa_activa();
  v_desde date;
  v_hasta date;
  v_res jsonb;
begin
  if not (public.es_personal_admin() and public.puede('usuarios', 'ver')) then
    raise exception 'No tienes permiso para ver las metas' using errcode = '42501';
  end if;
  if p_mes not between 1 and 12 or p_anio not between 2020 and 2100 then
    raise exception 'Mes no válido' using errcode = '22023';
  end if;
  v_desde := make_date(p_anio, p_mes, 1);
  v_hasta := (v_desde + interval '1 month - 1 day')::date;

  with
  ven as (
    select c.vendedor_asignado_id vid, sum(d.neto_usd) neto, count(*) filter (where d.tipo = 'factura') facturas
      from public.documentos_venta(v_desde, v_hasta) d join clientes c on c.id = d.cliente_id
     where c.vendedor_asignado_id is not null
     group by 1
  ),
  met as (
    select m.vendedor_id vid,
           sum(m.meta_ventas) filter (where m.empresa_id is null or m.empresa_id = any(v_visibles)) meta,
           max(m.meta_ventas) filter (where m.empresa_id = v_activa) meta_empresa
      from metas_vendedor m where m.anio = p_anio and m.mes = p_mes and coalesce(m.meta_ventas, 0) > 0
     group by 1
  ),
  cli as (
    select c.vendedor_asignado_id vid, count(*) n from clientes c
     where c.activo and not c.es_empleado and c.vendedor_asignado_id is not null and (c.empresa_id is null or c.empresa_id = any(v_visibles))
     group by 1
  )
  select jsonb_build_object(
    'desde', v_desde, 'hasta', v_hasta, 'empresa_activa', v_activa,
    'vendedores', coalesce(jsonb_agg(jsonb_build_object(
        'id', u.id, 'nombre', btrim(concat_ws(' ', u.nombre, u.apellido)), 'email', u.email, 'activo', coalesce(u.activo, true),
        'clientes', coalesce(cli.n, 0), 'meta', round(coalesce(met.meta, 0), 2), 'meta_empresa', met.meta_empresa,
        'venta', round(coalesce(ven.neto, 0), 2), 'facturas', coalesce(ven.facturas, 0))
      order by coalesce(u.activo, true) desc, coalesce(ven.neto, 0) desc, u.nombre), '[]'::jsonb))
    into v_res
    from usuarios u
    left join ven on ven.vid = u.id
    left join met on met.vid = u.id
    left join cli on cli.vid = u.id
   where u.role = 'vendedor' and not u.es_prueba
     and (met.vid is not null or ven.vid is not null
          or (coalesce(u.activo, true) and public.vendedor_empresas(u.id) && v_visibles));
  return v_res;
end $function$;

commit;
