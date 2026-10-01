-- ════════════════════════════════════════════════════════════════════════
-- Fase 20v · Corrección: bloqueo de cuentas del portal con fecha finita.
-- Desactivar un acceso ponía auth.users.banned_until = 'infinity'. El servicio de Auth no sabe leer ese valor: la cuenta
-- quedaba "Database error loading user" (500) para su API (no se podía borrar ni editar desde el panel, y el ingreso de
-- esa cuenta devolvía un error en vez de "cuenta bloqueada"). Se usa una fecha lejana finita y se corrigen las filas que
-- ya lo tenían. Afecta a desactivar_acceso_contacto (20v) y cambiar_acceso_cliente (18l/18o/20v).
-- ════════════════════════════════════════════════════════════════════════
begin;

-- Fecha de bloqueo "para siempre" que Auth sí entiende
create or replace function public.fecha_bloqueo_auth()
returns timestamptz language sql immutable set search_path = public as $$ select '2999-12-31 00:00:00+00'::timestamptz $$;
revoke execute on function public.fecha_bloqueo_auth() from public, anon;

CREATE OR REPLACE FUNCTION public.desactivar_acceso_contacto(p_contacto_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n int := 0; r record;
begin
  for r in select u.id, u.auth_id from usuarios u where u.contacto_id = p_contacto_id and u.role = 'cliente' and coalesce(u.activo, true) loop
    perform set_config('guds.bypass_guard', 'on', true);
    update usuarios set activo = false where id = r.id;
    perform set_config('guds.bypass_guard', 'off', true);
    update auth.users set banned_until = public.fecha_bloqueo_auth(), updated_at = now() where id = r.auth_id;
    delete from auth.sessions where user_id = r.auth_id;
    n := n + 1;
  end loop;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.cambiar_acceso_cliente(p_usuario_id uuid, p_activo boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  update auth.users set banned_until = case when p_activo then null else public.fecha_bloqueo_auth() end, updated_at = now() where id = u.auth_id;
  if not p_activo then delete from auth.sessions where user_id = u.auth_id; end if;
end $function$;

update auth.users set banned_until = public.fecha_bloqueo_auth() where banned_until = 'infinity'::timestamptz;

commit;
