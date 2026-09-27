-- ════════════════════════════════════════════════════════════════════════
-- Fase 19d · Postgres concede EXECUTE a PUBLIC por defecto: se revoca en las funciones nuevas de reportes y
-- sincronización (quedan solo para authenticated; la validación interna de permisos sigue igual).
-- ════════════════════════════════════════════════════════════════════════
begin;
revoke execute on function public.estado_sync_odoo() from public;
revoke execute on function public.solicitar_sync_odoo() from public;
revoke execute on function public.reporte_ventas(date, date, text) from public;
revoke execute on function public.reporte_cobranza(date, date, text) from public;
revoke execute on function public.reporte_inventario(integer) from public;
revoke execute on function public.exigir_permiso_reportes() from public, anon;
grant execute on function public.estado_sync_odoo() to authenticated;
grant execute on function public.solicitar_sync_odoo() to authenticated;
grant execute on function public.reporte_ventas(date, date, text) to authenticated;
grant execute on function public.reporte_cobranza(date, date, text) to authenticated;
grant execute on function public.reporte_inventario(integer) to authenticated;
grant execute on function public.exigir_permiso_reportes() to authenticated;
commit;
