-- =====================================================================
-- ROLLBACK de FASE 0 — devuelve la BD al estado (inseguro) previo.
-- Usar SOLO si la migración rompe funcionalidad legítima en producción.
-- =====================================================================
begin;

-- Quitar políticas nuevas
drop policy if exists usuarios_admin_all  on public.usuarios;
drop policy if exists usuarios_select_own on public.usuarios;
drop policy if exists usuarios_insert_own on public.usuarios;
drop policy if exists usuarios_update_own on public.usuarios;
drop trigger if exists trg_usuarios_guard_role on public.usuarios;
drop function if exists public.usuarios_guard_role();

do $$
declare t text;
begin
  foreach t in array array['categorias','banners','tipos_empaque','productos','configuracion',
                            'listas_precios','precios_lista','cupones','roles','modulos','permisos',
                            'iconos','producto_empaques'] loop
    execute format('drop policy if exists %I_public_read on public.%I', t, t);
    execute format('drop policy if exists %I_auth_read on public.%I', t, t);
    execute format('drop policy if exists %I_admin_write on public.%I', t, t);
  end loop;
end $$;
drop policy if exists movinv_admin_all on public.movimientos_inventario;
drop policy if exists metas_admin_all on public.metas_vendedor;
drop policy if exists metas_vendedor_own on public.metas_vendedor;
drop policy if exists registros_anon_insert on public.registros_clientes;
drop policy if exists registros_admin_all on public.registros_clientes;
drop policy if exists entregas_admin_all on public.entregas;
drop policy if exists entregas_repartidor_read on public.entregas;
drop policy if exists entregas_repartidor_update on public.entregas;

-- Reactivar el estado previo de usuarios (políticas públicas)
create policy "Lectura publica de usuarios"  on public.usuarios for select using (true);
create policy "Escritura publica de usuarios" on public.usuarios for all using (true);

-- Desactivar RLS en las 14 tablas
alter table public.banners                disable row level security;
alter table public.categorias             disable row level security;
alter table public.configuracion          disable row level security;
alter table public.cupones                disable row level security;
alter table public.listas_precios         disable row level security;
alter table public.metas_vendedor         disable row level security;
alter table public.modulos                disable row level security;
alter table public.movimientos_inventario disable row level security;
alter table public.permisos               disable row level security;
alter table public.precios_lista          disable row level security;
alter table public.productos              disable row level security;
alter table public.registros_clientes     disable row level security;
alter table public.roles                  disable row level security;
alter table public.tipos_empaque          disable row level security;

-- Restaurar grants a anon
grant insert, update, delete on all tables in schema public to anon;
grant select (costo) on public.productos to anon;

commit;
