begin;

-- Fase 12a: cierra un hueco de seguridad existente — `almacenes` e `inventario_almacen`
-- no tenían NINGUNA política RLS (cualquier usuario autenticado veía/editaba el inventario
-- de cualquier cliente). Se cierra ahora porque esta fase abre lectura de estas tablas a los
-- portales de cliente y vendedor (declaración de ventas en consignación).

alter table public.almacenes enable row level security;
alter table public.inventario_almacen enable row level security;

-- Admin: control total vía el módulo de permisos 'inventario' (ya usado por /admin/inventario
-- y /admin/almacenes).
create policy almacenes_perm_ver on public.almacenes
  for select to authenticated using (public.puede('inventario','ver'));
create policy almacenes_perm_crear on public.almacenes
  for insert to authenticated with check (public.puede('inventario','crear'));
create policy almacenes_perm_editar on public.almacenes
  for update to authenticated using (public.puede('inventario','editar')) with check (public.puede('inventario','editar'));
create policy almacenes_perm_eliminar on public.almacenes
  for delete to authenticated using (public.puede('inventario','eliminar'));

create policy inventario_almacen_perm_ver on public.inventario_almacen
  for select to authenticated using (public.puede('inventario','ver'));
create policy inventario_almacen_perm_crear on public.inventario_almacen
  for insert to authenticated with check (public.puede('inventario','crear'));
create policy inventario_almacen_perm_editar on public.inventario_almacen
  for update to authenticated using (public.puede('inventario','editar')) with check (public.puede('inventario','editar'));
create policy inventario_almacen_perm_eliminar on public.inventario_almacen
  for delete to authenticated using (public.puede('inventario','eliminar'));

-- Cliente: solo su(s) propio(s) almacén(es) de consignación.
create policy almacenes_cliente_read on public.almacenes
  for select to authenticated using (
    cliente_id is not null
    and cliente_id in (select u.cliente_id from public.usuarios u where u.auth_id = auth.uid())
  );
create policy inventario_almacen_cliente_read on public.inventario_almacen
  for select to authenticated using (
    almacen_id in (
      select a.id from public.almacenes a
      where a.cliente_id in (select u.cliente_id from public.usuarios u where u.auth_id = auth.uid())
    )
  );

-- Vendedor: almacenes de sus clientes asignados.
create policy almacenes_vendedor_read on public.almacenes
  for select to authenticated using (
    cliente_id is not null and cliente_id in (select public.mis_clientes_vendedor())
  );
create policy inventario_almacen_vendedor_read on public.inventario_almacen
  for select to authenticated using (
    almacen_id in (select a.id from public.almacenes a where a.cliente_id in (select public.mis_clientes_vendedor()))
  );

commit;
