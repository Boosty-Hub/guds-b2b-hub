-- =====================================================================
-- GUDS · FASE 0 — Seguridad / RLS
-- Fecha: 2026-07-19
-- Objetivo: cerrar la escalada anónima a admin, la fuga de PII y la
--   escritura pública, SIN romper el acceso anónimo legítimo:
--     · landing pública  -> SELECT productos/categorias/banners/configuracion
--     · registro público -> INSERT registros_clientes
--   El costo de compra deja de ser visible para anónimos.
-- Reversible: ver 20260719_fase0_seguridad_rls_ROLLBACK.sql
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0) Helper: ¿el usuario actual es admin activo?
--    SECURITY DEFINER + search_path fijo para evitar recursión de RLS.
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.usuarios
    where auth_id = auth.uid() and role = 'admin' and coalesce(activo, true)
  );
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- ---------------------------------------------------------------------
-- 1) Cerrar TODA la escritura anónima (el agujero central).
--    anon jamás escribe, con una sola excepción: el registro público.
-- ---------------------------------------------------------------------
revoke insert, update, delete on all tables in schema public from anon;
grant  insert on public.registros_clientes to anon;   -- formulario público de registro

-- ---------------------------------------------------------------------
-- 2) usuarios — cerrar la escalada a admin.
--    Sustituye las políticas 'Lectura/Escritura publica' por acceso propio.
-- ---------------------------------------------------------------------
drop policy if exists "Lectura publica de usuarios"  on public.usuarios;
drop policy if exists "Escritura publica de usuarios" on public.usuarios;
drop policy if exists usuarios_select_own on public.usuarios;
drop policy if exists usuarios_insert_own on public.usuarios;
drop policy if exists usuarios_update_own on public.usuarios;
drop policy if exists usuarios_admin_all  on public.usuarios;

-- admin ve/gestiona todo
create policy usuarios_admin_all on public.usuarios
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
-- cada quien ve su propia fila
create policy usuarios_select_own on public.usuarios
  for select to authenticated using (auth_id = auth.uid());
-- auto-provisión: un auth-user puede crear SU fila, siempre como 'cliente'
create policy usuarios_insert_own on public.usuarios
  for insert to authenticated with check (auth_id = auth.uid() and role = 'cliente');
-- puede editar su fila pero el trigger de abajo impide que se cambie el role
create policy usuarios_update_own on public.usuarios
  for update to authenticated using (auth_id = auth.uid()) with check (auth_id = auth.uid());

-- Blindaje del role: nadie que no sea admin puede cambiar su propio role/activo/cliente_id
create or replace function public.usuarios_guard_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() then
    return new;
  end if;
  if new.role is distinct from old.role
     or new.activo is distinct from old.activo
     or new.cliente_id is distinct from old.cliente_id then
    raise exception 'No autorizado para cambiar role/activo/cliente_id';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_usuarios_guard_role on public.usuarios;
create trigger trg_usuarios_guard_role
  before update on public.usuarios
  for each row execute function public.usuarios_guard_role();

-- ---------------------------------------------------------------------
-- 3) Activar RLS en las 14 tablas que lo tenían apagado.
-- ---------------------------------------------------------------------
alter table public.banners                enable row level security;
alter table public.categorias             enable row level security;
alter table public.configuracion          enable row level security;
alter table public.cupones                enable row level security;
alter table public.listas_precios         enable row level security;
alter table public.metas_vendedor         enable row level security;
alter table public.modulos                enable row level security;
alter table public.movimientos_inventario enable row level security;
alter table public.permisos               enable row level security;
alter table public.precios_lista          enable row level security;
alter table public.productos              enable row level security;
alter table public.registros_clientes     enable row level security;
alter table public.roles                  enable row level security;
alter table public.tipos_empaque          enable row level security;

-- ---------------------------------------------------------------------
-- 4) Catálogo de lectura pública (landing + catálogo). Escritura: admin.
--    productos ya tenía 2 políticas correctas; solo faltaba habilitar RLS
--    (paso 3). Reafirmamos lectura pública para las demás.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['categorias','banners','tipos_empaque'] loop
    execute format('drop policy if exists %I_public_read on public.%I', t, t);
    execute format('create policy %I_public_read on public.%I for select to anon, authenticated using (true)', t, t);
    execute format('drop policy if exists %I_admin_write on public.%I', t, t);
    execute format('create policy %I_admin_write on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t, t);
  end loop;
end $$;

-- productos: lectura pública (las columnas sensibles se cierran por GRANT abajo)
drop policy if exists productos_public_read on public.productos;
create policy productos_public_read on public.productos
  for select to anon, authenticated using (true);
-- (las políticas admin de escritura ya existen: 'Admins gestionan productos')

-- Ocultar el costo de compra a los anónimos (la landing no lo pide).
revoke select (costo) on public.productos from anon;

-- configuracion: lectura pública (tasa de cambio, IVA, datos de tienda). Escritura admin.
drop policy if exists configuracion_public_read on public.configuracion;
create policy configuracion_public_read on public.configuracion
  for select to anon, authenticated using (true);
drop policy if exists configuracion_admin_write on public.configuracion;
create policy configuracion_admin_write on public.configuracion
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- 5) Lectura solo autenticados. Escritura: admin.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['listas_precios','precios_lista','cupones','roles','modulos','permisos'] loop
    execute format('drop policy if exists %I_auth_read on public.%I', t, t);
    execute format('create policy %I_auth_read on public.%I for select to authenticated using (true)', t, t);
    execute format('drop policy if exists %I_admin_write on public.%I', t, t);
    execute format('create policy %I_admin_write on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 6) Solo admin (lectura y escritura).
-- ---------------------------------------------------------------------
drop policy if exists movinv_admin_all on public.movimientos_inventario;
create policy movinv_admin_all on public.movimientos_inventario
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- metas_vendedor: admin todo; el vendedor ve las suyas
drop policy if exists metas_admin_all on public.metas_vendedor;
create policy metas_admin_all on public.metas_vendedor
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists metas_vendedor_own on public.metas_vendedor;
create policy metas_vendedor_own on public.metas_vendedor
  for select to authenticated
  using (vendedor_id in (select id from public.usuarios where auth_id = auth.uid()));

-- ---------------------------------------------------------------------
-- 7) registros_clientes — PII. anon SOLO inserta (registro público),
--    nunca lee. admin gestiona todo.
-- ---------------------------------------------------------------------
drop policy if exists registros_anon_insert on public.registros_clientes;
create policy registros_anon_insert on public.registros_clientes
  for insert to anon with check (true);
drop policy if exists registros_admin_all on public.registros_clientes;
create policy registros_admin_all on public.registros_clientes
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- 8) iconos y producto_empaques — ya tenían RLS on pero con política
--    ALL/public/USING true. Corregir: lectura pública, escritura admin.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['iconos','producto_empaques'] loop
    execute format('drop policy if exists "Solo admin puede modificar %s" on public.%I', t, t);
    execute format('drop policy if exists %I_public_read on public.%I', t, t);
    execute format('create policy %I_public_read on public.%I for select to anon, authenticated using (true)', t, t);
    execute format('drop policy if exists %I_admin_write on public.%I', t, t);
    execute format('create policy %I_admin_write on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 9) entregas — tenía RLS on con 0 políticas (deny-all). Dar acceso:
--    admin todo; el repartidor ve/actualiza las suyas.
-- ---------------------------------------------------------------------
drop policy if exists entregas_admin_all on public.entregas;
create policy entregas_admin_all on public.entregas
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists entregas_repartidor_read on public.entregas;
create policy entregas_repartidor_read on public.entregas
  for select to authenticated
  using (repartidor_id in (select id from public.usuarios where auth_id = auth.uid()));
drop policy if exists entregas_repartidor_update on public.entregas;
create policy entregas_repartidor_update on public.entregas
  for update to authenticated
  using (repartidor_id in (select id from public.usuarios where auth_id = auth.uid()));

commit;
