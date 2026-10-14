-- ============================================================================
-- FASE 23a: Notificaciones push nativas — registro de dispositivos
--   - device_tokens: un token de APNs/FCM por fila, ÚNICO por token (no por usuario+token): un mismo teléfono que cambia
--     de cuenta se mueve al usuario nuevo y el anterior deja de recibir sus avisos.
--   - user_id es el usuario de auth (auth.users.id), NO public.usuarios.id.
--   - La app nativa (src/lib/pushNativo.ts) escribe SOLO por RPC; la tabla no tiene políticas de INSERT/UPDATE.
--     Ninguna RPC recibe un user_id: siempre se usa auth.uid().
-- ============================================================================

create table if not exists public.device_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  token        text not null unique,
  platform     text not null check (platform in ('ios', 'android')),
  app_version  text,
  device_name  text,
  last_seen_at timestamptz not null default now()
);
create index if not exists device_tokens_user_idx on public.device_tokens (user_id);

alter table public.device_tokens enable row level security;

-- Lectura y borrado solo de lo propio. Sin políticas de INSERT/UPDATE: se registra por registrar_dispositivo().
revoke all on public.device_tokens from anon, authenticated;
grant select, delete on public.device_tokens to authenticated;

drop policy if exists device_tokens_ver_propios on public.device_tokens;
create policy device_tokens_ver_propios on public.device_tokens
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists device_tokens_borrar_propios on public.device_tokens;
create policy device_tokens_borrar_propios on public.device_tokens
  for delete to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- registrar_dispositivo: el token pasa a ser del usuario de la sesión (se quita a quien lo tuviera).
-- Máximo 10 dispositivos por usuario: si se pasa, se descartan los vistos hace más tiempo.
-- ---------------------------------------------------------------------------
create or replace function public.registrar_dispositivo(
  p_token text,
  p_platform text,
  p_app_version text default null,
  p_device_name text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_token text := btrim(coalesce(p_token, ''));
begin
  if v_uid is null then
    raise exception 'Se requiere una sesión para registrar el dispositivo' using errcode = '28000';
  end if;
  if length(v_token) < 16 or length(v_token) > 4096 then
    raise exception 'Token de dispositivo inválido' using errcode = '22023';
  end if;
  if p_platform is null or p_platform not in ('ios', 'android') then
    raise exception 'Plataforma inválida: %', p_platform using errcode = '22023';
  end if;

  delete from public.device_tokens where token = v_token and user_id <> v_uid;

  insert into public.device_tokens (user_id, token, platform, app_version, device_name, last_seen_at)
  values (v_uid, v_token, p_platform, left(p_app_version, 64), left(p_device_name, 128), now())
  on conflict (token) do update
    set user_id      = excluded.user_id,
        platform     = excluded.platform,
        app_version  = excluded.app_version,
        device_name  = excluded.device_name,
        last_seen_at = excluded.last_seen_at;

  delete from public.device_tokens d
  where d.user_id = v_uid
    and d.id in (
      select x.id from public.device_tokens x
      where x.user_id = v_uid
      order by x.last_seen_at desc
      offset 10
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- quitar_dispositivo: al cerrar sesión (antes del signOut). Solo borra si el token es del usuario de la sesión.
-- ---------------------------------------------------------------------------
create or replace function public.quitar_dispositivo(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Se requiere una sesión para quitar el dispositivo' using errcode = '28000';
  end if;
  delete from public.device_tokens where token = btrim(coalesce(p_token, '')) and user_id = v_uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- quitar_token_huerfano: si el cierre de sesión no pudo confirmar el borrado, la app lo reintenta al abrir (ya sin
-- sesión). Borra por token: quien tiene el token es el propio teléfono. No informa si existía.
-- ---------------------------------------------------------------------------
create or replace function public.quitar_token_huerfano(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_token is null or length(btrim(p_token)) < 16 then
    return;
  end if;
  delete from public.device_tokens where token = btrim(p_token);
end;
$$;

revoke all on function public.registrar_dispositivo(text, text, text, text) from public, anon;
grant execute on function public.registrar_dispositivo(text, text, text, text) to authenticated, service_role;

revoke all on function public.quitar_dispositivo(text) from public, anon;
grant execute on function public.quitar_dispositivo(text) to authenticated, service_role;

revoke all on function public.quitar_token_huerfano(text) from public;
grant execute on function public.quitar_token_huerfano(text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
