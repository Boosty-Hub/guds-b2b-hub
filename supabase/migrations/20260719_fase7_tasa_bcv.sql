-- ============================================================================
-- FASE 7: Tasa BCV automática
--   - Scraping de bcv.org.ve vía Edge Function `actualizar-tasa-bcv`
--   - Cron diario a las 08:00 America/Caracas (UTC-4) = 12:00 UTC
--   - Botón manual desde el header (invoca la misma Edge Function)
--   - La tasa canónica sigue siendo configuracion.tasa_cambio (Bs/USD)
-- ============================================================================

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------
-- Historial de tasas (auditoría: quién/cuándo/cuánto, cron o manual)
-- ---------------------------------------------------------------------------
create table if not exists public.tasa_bcv (
  id         uuid primary key default gen_random_uuid(),
  tasa       numeric(14,4) not null,
  fuente     text,
  fecha      date not null default (now() at time zone 'America/Caracas')::date,
  created_at timestamptz not null default now()
);
alter table public.tasa_bcv enable row level security;
drop policy if exists tasa_bcv_read on public.tasa_bcv;
create policy tasa_bcv_read on public.tasa_bcv
  for select to authenticated using (true);
-- La escritura ocurre solo vía upsert_tasa_bcv (service_role bypassa RLS).

-- ---------------------------------------------------------------------------
-- upsert_tasa_bcv: actualiza la tasa canónica + metadatos + historial.
-- Solo callable por service_role (la Edge Function). Bloqueado a usuarios.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_tasa_bcv(p_tasa numeric, p_fuente text default 'BCV')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_now timestamptz := now();
begin
  if p_tasa is null or p_tasa <= 0 then
    raise exception 'Tasa BCV inválida: %', p_tasa;
  end if;

  insert into configuracion (clave, valor, tipo, descripcion, updated_at)
  values ('tasa_cambio', p_tasa::text, 'number', 'Tasa BCV Bs/USD', v_now)
  on conflict (clave) do update set valor = excluded.valor, updated_at = v_now;

  insert into configuracion (clave, valor, tipo, descripcion, updated_at)
  values ('tasa_cambio_actualizada', v_now::text, 'datetime', 'Última actualización de la tasa BCV', v_now)
  on conflict (clave) do update set valor = excluded.valor, updated_at = v_now;

  insert into configuracion (clave, valor, tipo, descripcion, updated_at)
  values ('tasa_cambio_fuente', coalesce(p_fuente, 'BCV'), 'text', 'Fuente de la tasa BCV', v_now)
  on conflict (clave) do update set valor = excluded.valor, updated_at = v_now;

  insert into public.tasa_bcv (tasa, fuente) values (p_tasa, p_fuente);

  return jsonb_build_object('ok', true, 'tasa', p_tasa, 'fuente', p_fuente, 'actualizada', v_now);
end;
$$;

revoke all on function public.upsert_tasa_bcv(numeric, text) from public, anon, authenticated;
grant execute on function public.upsert_tasa_bcv(numeric, text) to service_role;

-- ---------------------------------------------------------------------------
-- Cron diario: 08:00 America/Caracas (UTC-4, sin horario de verano) = 12:00 UTC
-- Dispara la Edge Function, que scrapea bcv.org.ve y llama a upsert_tasa_bcv.
-- La función se despliega con verify_jwt=false; se manda la publishable key
-- (no-JWT) en el header `apikey` (las llaves nuevas NO van en Authorization).
-- ---------------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('actualizar-tasa-bcv-diario');
exception when others then null;
end $$;

select cron.schedule(
  'actualizar-tasa-bcv-diario',
  '0 12 * * *',
  $cron$
    select net.http_post(
      url     := 'https://oyyxkbwtyxdpzsgarmim.supabase.co/functions/v1/actualizar-tasa-bcv',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', 'sb_publishable_J8477Ia3F9Ro3S7NQQlwrw_BDOYElbV'
      ),
      body    := '{}'::jsonb
    );
  $cron$
);
