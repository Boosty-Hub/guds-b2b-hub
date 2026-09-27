-- ════════════════════════════════════════════════════════════════════════
-- Fase 19b · Programación de la sincronización Odoo → GUDS (función edge sync-odoo)
--   El secreto de la función vive en Vault ('sync_odoo_secret'; se carga aparte, no en este archivo).
--   Horario (UTC; Caracas = UTC-4): cada 15 min de 07:00 a 19:45 de lunes a sábado + nocturna diaria a las 02:00.
--   Cada corrida lee Odoo en solo lectura (~55 s) y deja su registro en sync_corridas.
-- ════════════════════════════════════════════════════════════════════════
begin;
create or replace function public.disparar_sync_odoo() returns bigint language sql security definer set search_path = public as $$
  select net.http_post(
    url := 'https://oyyxkbwtyxdpzsgarmim.supabase.co/functions/v1/sync-odoo',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_odoo_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000);
$$;
revoke execute on function public.disparar_sync_odoo() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname in ('sync-odoo-horario', 'sync-odoo-nocturna');
select cron.schedule('sync-odoo-horario', '*/15 11-23 * * 1-6', $$select public.disparar_sync_odoo()$$);
select cron.schedule('sync-odoo-nocturna', '0 6 * * *', $$select public.disparar_sync_odoo()$$);
commit;
