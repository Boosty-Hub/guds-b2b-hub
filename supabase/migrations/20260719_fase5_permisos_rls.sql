-- =====================================================================
-- GUDS · FASE 5 (P2) — Enforcement de permisos granulares en el SERVIDOR.
--   Sustituye las políticas de admin (is_admin / "Admins ...") por políticas
--   granulares por módulo: SELECT=ver, INSERT=crear, UPDATE=editar, DELETE=eliminar.
--   El super-admin (Administrador) pasa siempre porque puede() llama a
--   es_admin_total(). Las políticas de cliente/vendedor/repartidor se conservan.
-- =====================================================================
begin;

do $do$
declare
  tbl text; modulo text; rec record;
  mapa jsonb := jsonb_build_object(
    'banners','banners', 'categorias','categorias', 'clientes','clientes',
    'configuracion','configuracion', 'cupones','cupones', 'entregas','delivery',
    'iconos','configuracion', 'listas_precios','precios', 'metodos_pago','configuracion',
    'modulos','roles', 'movimientos_inventario','inventario', 'orden_items','ordenes',
    'ordenes','ordenes', 'pagos','cuentas', 'permisos','roles', 'precios_lista','precios',
    'producto_empaques','productos', 'productos','productos', 'registros_clientes','registros',
    'roles','roles', 'tipos_empaque','productos', 'usuarios','usuarios'
  );
begin
  for tbl, modulo in select key, value from jsonb_each_text(mapa) loop
    -- Quitar las políticas de admin previas (is_admin() y las "Admins ...")
    for rec in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = tbl
        and ( coalesce(qual,'') like '%is_admin%'
           or coalesce(with_check,'') like '%is_admin%'
           or policyname ilike 'Admins %'
           or policyname like '%\_admin\_all'
           or policyname like '%\_admin\_write' )
    loop
      execute format('drop policy %I on public.%I', rec.policyname, tbl);
    end loop;

    -- Políticas granulares por módulo
    execute format('create policy %I on public.%I for select to authenticated using (public.puede(%L, %L))', tbl||'_perm_ver', tbl, modulo, 'ver');
    execute format('create policy %I on public.%I for insert to authenticated with check (public.puede(%L, %L))', tbl||'_perm_crear', tbl, modulo, 'crear');
    execute format('create policy %I on public.%I for update to authenticated using (public.puede(%L, %L)) with check (public.puede(%L, %L))', tbl||'_perm_editar', tbl, modulo, 'editar', modulo, 'editar');
    execute format('create policy %I on public.%I for delete to authenticated using (public.puede(%L, %L))', tbl||'_perm_eliminar', tbl, modulo, 'eliminar');
  end loop;
end $do$;

-- metas_vendedor no tiene módulo propio: solo el super-admin la gestiona
-- (el vendedor conserva su política de lectura metas_vendedor_own).
drop policy if exists metas_admin_all on public.metas_vendedor;
create policy metas_admin_all on public.metas_vendedor
  for all to authenticated using (public.es_admin_total()) with check (public.es_admin_total());

commit;
