-- ════════════════════════════════════════════════════════════════════════
-- Fase 19a · Sincronización periódica desde la función edge sync-odoo
--   sync_corridas acepta el origen 'edge-cron' y los modos 'simulacion' (lee sin escribir) y 'traza' (progreso de la
--   función, para diagnosticar cortes por límite de la plataforma).
-- ════════════════════════════════════════════════════════════════════════
begin;
alter table public.sync_corridas drop constraint if exists sync_corridas_modo_check;
alter table public.sync_corridas add constraint sync_corridas_modo_check check (modo = any (array['completo', 'incremental', 'simulacion', 'traza']));
alter table public.sync_corridas drop constraint if exists sync_corridas_origen_check;
alter table public.sync_corridas add constraint sync_corridas_origen_check check (origen = any (array['script', 'cron', 'manual', 'edge-cron']));
commit;
