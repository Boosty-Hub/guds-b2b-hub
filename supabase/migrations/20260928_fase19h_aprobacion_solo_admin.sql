-- ════════════════════════════════════════════════════════════════════════
-- Fase 19h · Solo el personal de administración aprueba, rechaza o reenvía pedidos a Odoo
--   (el rol Vendedor tiene "editar órdenes" para sus pedidos: no basta con puede('ordenes','editar')).
-- ════════════════════════════════════════════════════════════════════════
begin;
create or replace function public.es_personal_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from usuarios u where u.auth_id = auth.uid() and u.role = 'admin' and coalesce(u.activo, true));
$$;
revoke execute on function public.es_personal_admin() from public, anon;
grant execute on function public.es_personal_admin() to authenticated;

do $$
declare f text; d text;
begin
  foreach f in array array['aprobar_pedido(uuid)', 'rechazar_pedido(uuid,text)', 'reintentar_envio_pedido(uuid)', 'solicitar_sync_odoo()'] loop
    d := pg_get_functiondef(('public.' || f)::regprocedure);
    d := replace(d, 'if not (select public.puede(''ordenes'', ''editar'')) then', 'if not ((select public.es_personal_admin()) and (select public.puede(''ordenes'', ''editar''))) then');
    d := replace(d, 'if not (select public.puede(''configuracion'', ''editar'')) then', 'if not ((select public.es_personal_admin()) and (select public.puede(''configuracion'', ''editar''))) then');
    execute d;
  end loop;
end $$;
commit;
