-- =====================================================================
-- GUDS · FASE 5 (P2) — Motor de permisos granular, capa de funciones.
--   El enum usuarios.role gobierna el ÁREA (admin/cliente/vendedor/delivery).
--   rol_id + permisos gobierna los MÓDULOS dentro del área admin.
--   BLINDAJE: el rol "Administrador" (o un admin sin rol_id) SIEMPRE tiene
--   acceso total, para no bloquear nunca al administrador principal.
-- =====================================================================
begin;

-- ¿El usuario actual es administrador total (super)?
create or replace function public.es_admin_total()
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from usuarios u left join roles r on r.id = u.rol_id
    where u.auth_id = auth.uid() and u.role = 'admin' and coalesce(u.activo, true)
      and (u.rol_id is null or r.nombre = 'Administrador')
  );
$fn$;
revoke all on function public.es_admin_total() from public;
grant execute on function public.es_admin_total() to anon, authenticated;

-- ¿El usuario actual puede realizar <accion> sobre <modulo>?
--   accion ∈ ('ver','crear','editar','eliminar')
create or replace function public.puede(p_codigo text, p_accion text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select public.es_admin_total() or exists (
    select 1
    from usuarios u
    join permisos p on p.rol_id = u.rol_id
    join modulos m on m.id = p.modulo_id
    where u.auth_id = auth.uid() and coalesce(u.activo, true) and m.codigo = p_codigo
      and case p_accion
        when 'ver' then p.puede_ver
        when 'crear' then p.puede_crear
        when 'editar' then p.puede_editar
        when 'eliminar' then p.puede_eliminar
        else false end
  );
$fn$;
revoke all on function public.puede(text, text) from public;
grant execute on function public.puede(text, text) to anon, authenticated;

-- Permisos del usuario actual, para el frontend (un solo viaje).
create or replace function public.mis_permisos()
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare v_super boolean; v_result jsonb;
begin
  v_super := public.es_admin_total();
  if v_super then
    -- acceso total a todos los módulos
    select jsonb_build_object('es_admin_total', true, 'permisos',
      coalesce(jsonb_object_agg(m.codigo, jsonb_build_object('ver',true,'crear',true,'editar',true,'eliminar',true)), '{}'::jsonb))
    into v_result from modulos m;
  else
    select jsonb_build_object('es_admin_total', false, 'permisos',
      coalesce(jsonb_object_agg(m.codigo, jsonb_build_object(
        'ver',p.puede_ver,'crear',p.puede_crear,'editar',p.puede_editar,'eliminar',p.puede_eliminar)), '{}'::jsonb))
    into v_result
    from usuarios u
    join permisos p on p.rol_id = u.rol_id
    join modulos m on m.id = p.modulo_id
    where u.auth_id = auth.uid();
  end if;
  return coalesce(v_result, jsonb_build_object('es_admin_total', false, 'permisos', '{}'::jsonb));
end;
$fn$;
revoke all on function public.mis_permisos() from public;
grant execute on function public.mis_permisos() to authenticated;

commit;
