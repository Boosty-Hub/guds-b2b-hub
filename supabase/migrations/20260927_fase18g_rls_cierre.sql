-- ════════════════════════════════════════════════════════════════════════
-- Fase 18g · Cierre de políticas RLS "todo permitido" (flanco detectado en la Fase 6)
--   producto_empaques: cualquiera, incluso anónimo, podía crear/editar/borrar empaques (y sus precios).
--   almacenes, inventario_almacen, movimientos_bancarios, cuentas_cobrar, pago_cuentas, pago_ordenes:
--   cualquier usuario autenticado (también clientes del portal) podía escribir.
-- Los procesos internos que escriben estas tablas son funciones security definer (no dependen de estas políticas);
-- el frontend solo escribe desde pantallas de administración, cubiertas por los permisos por módulo.
-- ════════════════════════════════════════════════════════════════════════
begin;

drop policy if exists "Escritura de producto_empaques" on public.producto_empaques;
drop policy if exists almacenes_auth_all on public.almacenes;
drop policy if exists inventario_auth_all on public.inventario_almacen;
drop policy if exists movimientos_auth on public.movimientos_bancarios;
drop policy if exists cuentas_cobrar_auth on public.cuentas_cobrar;
drop policy if exists pago_cuentas_auth on public.pago_cuentas;
drop policy if exists pago_ordenes_auth on public.pago_ordenes;

-- Permisos por módulo donde no existían
do $$
declare r record;
begin
  for r in select * from (values
    ('movimientos_bancarios', 'bancos'),
    ('cuentas_cobrar', 'cuentas'),
    ('pago_cuentas', 'cuentas'),
    ('pago_ordenes', 'cuentas')
  ) as t(tabla, modulo) loop
    execute format('drop policy if exists %I on public.%I', r.tabla || '_perm_ver', r.tabla);
    execute format('create policy %I on public.%I for select to authenticated using (public.puede(%L, ''ver''))', r.tabla || '_perm_ver', r.tabla, r.modulo);
    execute format('drop policy if exists %I on public.%I', r.tabla || '_perm_crear', r.tabla);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.puede(%L, ''crear''))', r.tabla || '_perm_crear', r.tabla, r.modulo);
    execute format('drop policy if exists %I on public.%I', r.tabla || '_perm_editar', r.tabla);
    execute format('create policy %I on public.%I for update to authenticated using (public.puede(%L, ''editar'')) with check (public.puede(%L, ''editar''))',
      r.tabla || '_perm_editar', r.tabla, r.modulo, r.modulo);
    execute format('drop policy if exists %I on public.%I', r.tabla || '_perm_eliminar', r.tabla);
    execute format('create policy %I on public.%I for delete to authenticated using (public.puede(%L, ''eliminar''))', r.tabla || '_perm_eliminar', r.tabla, r.modulo);
  end loop;
end $$;

-- El cliente de un almacén de consignación debe ser de la misma empresa (o compartido)
drop trigger if exists z_validar_refs_empresa on public.almacenes;
create trigger z_validar_refs_empresa before insert or update on public.almacenes
  for each row execute function public.trg_validar_refs_empresa('cliente_id:clientes');

commit;
