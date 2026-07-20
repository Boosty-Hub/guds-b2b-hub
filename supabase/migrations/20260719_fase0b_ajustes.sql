-- =====================================================================
-- GUDS · FASE 0b — Ajustes finos sobre la migración de seguridad.
--   1) Eliminar las políticas "públicas" residuales de usuarios
--      (el DROP por nombre falló por el acento en "pública").
--   2) Ocultar productos.costo a anon con grant por columnas
--      (el revoke por columna no bastaba mientras existía el grant de tabla).
-- =====================================================================
begin;

-- 1) usuarios: borrar cualquier política que aplique al pseudo-rol public,
--    sin depender del nombre exacto. Deja solo las políticas nuevas (authenticated).
do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'usuarios' and 'public' = any(roles)
  loop
    execute format('drop policy %I on public.usuarios', pol.policyname);
  end loop;
end $$;
-- Defensa en profundidad: anon nunca lee usuarios (RLS ya lo bloquea sin política)
revoke select on public.usuarios from anon;

-- 2) productos: ocultar el costo de compra a anon.
--    Se revoca el SELECT de tabla y se re-otorga por columnas, sin 'costo'.
revoke select on public.productos from anon;
grant select (
  id, sku, nombre, descripcion, categoria_id, tipo_empaque_id, unidad,
  precio_base, imagen_url, imagen_emoji, stock_actual, stock_minimo, stock_maximo,
  precio_oferta, porcentaje_descuento, en_oferta, activo, destacado, created_at, updated_at
) on public.productos to anon;

commit;
