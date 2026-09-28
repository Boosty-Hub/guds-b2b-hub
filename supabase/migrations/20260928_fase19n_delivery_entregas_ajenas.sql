-- ════════════════════════════════════════════════════════════════════════
-- Fase 19n · Delivery: el repartidor solo ve sus entregas (resto del plan D0)
--   La 19i le quitó al rol Delivery "órdenes: ver" y "delivery: editar", pero conservó "delivery: ver" (lo usa el menú
--   de roles) y con eso la política entregas_perm_ver le dejaba leer TODAS las entregas de su empresa: las de los otros
--   repartidores, con el nombre del receptor, las notas, el motivo de fallo y las rutas de la evidencia.
--   Las políticas del módulo "delivery" pasan a exigir además ser personal de administración; el repartidor ve lo suyo
--   por entregas_repartidor_read y cierra por actualizar_estado_entrega (que valida).
--   La evidencia (bucket privado evidencias-entrega) ya la lee administración (evidencias_leer, 19i): no cambia.
-- ════════════════════════════════════════════════════════════════════════
begin;

drop policy if exists entregas_perm_ver on public.entregas;
create policy entregas_perm_ver on public.entregas for select to authenticated
  using ((select public.puede('delivery', 'ver')) and (select public.es_personal_admin()));

drop policy if exists entregas_perm_crear on public.entregas;
create policy entregas_perm_crear on public.entregas for insert to authenticated
  with check ((select public.puede('delivery', 'crear')) and (select public.es_personal_admin()));

drop policy if exists entregas_perm_editar on public.entregas;
create policy entregas_perm_editar on public.entregas for update to authenticated
  using ((select public.puede('delivery', 'editar')) and (select public.es_personal_admin()))
  with check ((select public.puede('delivery', 'editar')) and (select public.es_personal_admin()));

drop policy if exists entregas_perm_eliminar on public.entregas;
create policy entregas_perm_eliminar on public.entregas for delete to authenticated
  using ((select public.puede('delivery', 'eliminar')) and (select public.es_personal_admin()));

commit;
