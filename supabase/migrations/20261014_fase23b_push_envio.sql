-- ============================================================================
-- FASE 23b: Notificaciones push nativas — envío
--   - Cada INSERT en public.notificaciones (un disparador POR SENTENCIA, con tabla de transición) junta las que tienen
--     destinatario con al menos un dispositivo y encola por pg_net una llamada a la Edge Function `enviar-push` con
--     {"ids": [...]} y el header x-push-secret.
--   - INTERRUPTOR GENERAL: el secreto de vault 'push_webhook_secret'. Sin él, el disparador no hace nada.
--   - El disparador NUNCA rompe el INSERT original: todo va dentro de "exception when others then raise warning" y
--     pg_net solo encola (la llamada sale después del commit; si la transacción se deshace, no sale).
--   - push_lote (solo service_role): arma el lote para la función: título, mensaje, enlace, tipo, data, no leídas del
--     destinatario (badge) y sus tokens iOS y Android por separado. notificaciones.usuario_id es public.usuarios.id; el
--     dueño del token es usuarios.auth_id. Usuarios inactivos no reciben push. Respeta el interruptor global
--     configuracion.notif_push_activo (Configuración > Notificaciones): solo 'false' lo apaga.
--   - push_jwt: un solo JWT de proveedor de APNs compartido por todos los workers de la función (Apple rechaza
--     renovarlo más de una vez cada 20 min: TooManyProviderTokenUpdates).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- push_lote
-- ---------------------------------------------------------------------------
create or replace function public.push_lote(ids uuid[])
returns table (
  id             uuid,
  titulo         text,
  mensaje        text,
  link           text,
  tipo           text,
  data           jsonb,
  no_leidas      integer,
  tokens_ios     text[],
  tokens_android text[]
)
language sql
stable
security definer
set search_path = public
as $$
  with lote as (
    select n.id, n.titulo::text as titulo, n.mensaje, n.link::text as link, n.tipo::text as tipo, n.data,
           n.usuario_id, u.auth_id
    from public.notificaciones n
    join public.usuarios u on u.id = n.usuario_id
    where n.id = any(ids)
      and u.auth_id is not null
      and u.activo is not false
      and coalesce((select c.valor from public.configuracion c where c.clave = 'notif_push_activo'), 'true') <> 'false'
  ),
  con_tokens as (
    select l.*,
      coalesce((select array_agg(d.token order by d.last_seen_at desc) from public.device_tokens d
                where d.user_id = l.auth_id and d.platform = 'ios'), '{}'::text[]) as t_ios,
      coalesce((select array_agg(d.token order by d.last_seen_at desc) from public.device_tokens d
                where d.user_id = l.auth_id and d.platform = 'android'), '{}'::text[]) as t_android
    from lote l
  )
  select t.id, t.titulo, t.mensaje, t.link, t.tipo, t.data,
         (select count(*)::integer from public.notificaciones x
          where x.usuario_id = t.usuario_id and x.leida = false) as no_leidas,
         t.t_ios, t.t_android
  from con_tokens t
  where cardinality(t.t_ios) > 0 or cardinality(t.t_android) > 0;
$$;

revoke all on function public.push_lote(uuid[]) from public, anon, authenticated;
grant execute on function public.push_lote(uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- push_jwt: JWT de proveedor de APNs compartido (una fila por proveedor)
-- ---------------------------------------------------------------------------
create table if not exists public.push_jwt (
  proveedor text primary key default 'apns' check (proveedor = 'apns'),
  key_id    text not null,
  jwt       text not null,
  creado_at timestamptz not null default now()
);
alter table public.push_jwt enable row level security;
-- Sin políticas: solo service_role (que salta RLS) y las funciones de abajo.
revoke all on public.push_jwt from anon, authenticated;

-- Reemplaza el JWT guardado solo si es de otra llave o tiene más de 50 minutos; SIEMPRE devuelve la fila vigente,
-- así los workers que firman a la vez terminan usando el mismo token.
create or replace function public.push_jwt_reclamar(p_key_id text, p_jwt text)
returns table (key_id text, jwt text, creado_at timestamptz)
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if p_key_id is null or p_jwt is null or length(p_jwt) < 20 then
    raise exception 'JWT de APNs inválido' using errcode = '22023';
  end if;

  insert into public.push_jwt as pj (proveedor, key_id, jwt, creado_at)
  values ('apns', p_key_id, p_jwt, now())
  on conflict (proveedor) do update
    set key_id = excluded.key_id, jwt = excluded.jwt, creado_at = excluded.creado_at
    where pj.key_id is distinct from excluded.key_id
       or pj.creado_at < now() - interval '50 minutes';

  return query
    select pj.key_id, pj.jwt, pj.creado_at from public.push_jwt pj where pj.proveedor = 'apns';
end;
$$;

-- Borra el JWT guardado solo si sigue siendo el que APNs rechazó (otro worker pudo haberlo renovado ya).
create or replace function public.push_jwt_olvidar(p_jwt text)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  delete from public.push_jwt where proveedor = 'apns' and jwt = p_jwt;
$$;

revoke all on function public.push_jwt_reclamar(text, text) from public, anon, authenticated;
grant execute on function public.push_jwt_reclamar(text, text) to service_role;
revoke all on function public.push_jwt_olvidar(text) from public, anon, authenticated;
grant execute on function public.push_jwt_olvidar(text) to service_role;

-- ---------------------------------------------------------------------------
-- Disparador: AFTER INSERT ... FOR EACH STATEMENT con tabla de transición
-- ---------------------------------------------------------------------------
create or replace function public.trg_notificaciones_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids     uuid[];
  v_secreto text;
  v_desde   integer := 1;
  v_tramo   constant integer := 100;
begin
  begin
    select array_agg(n.id) into v_ids
    from nuevas n
    join public.usuarios u on u.id = n.usuario_id
    where u.auth_id is not null
      and u.activo is not false
      and exists (select 1 from public.device_tokens d where d.user_id = u.auth_id);

    if v_ids is null then
      return null;
    end if;

    -- Interruptor general: sin el secreto en vault no se envía nada.
    select s.decrypted_secret into v_secreto
    from vault.decrypted_secrets s where s.name = 'push_webhook_secret' limit 1;
    if v_secreto is null or v_secreto = '' then
      return null;
    end if;

    -- Lotes de 100 ids por llamada
    while v_desde <= cardinality(v_ids) loop
      perform net.http_post(
        url := 'https://oyyxkbwtyxdpzsgarmim.supabase.co/functions/v1/enviar-push',
        body := jsonb_build_object('ids', to_jsonb(v_ids[v_desde : v_desde + v_tramo - 1])),
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secreto),
        timeout_milliseconds := 30000
      );
      v_desde := v_desde + v_tramo;
    end loop;
  exception when others then
    raise warning 'enviar-push: no se pudo encolar el envío (%): %', sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.trg_notificaciones_push() from public, anon, authenticated;

drop trigger if exists trg_notificaciones_push on public.notificaciones;
create trigger trg_notificaciones_push
  after insert on public.notificaciones
  referencing new table as nuevas
  for each statement
  execute function public.trg_notificaciones_push();

notify pgrst, 'reload schema';
