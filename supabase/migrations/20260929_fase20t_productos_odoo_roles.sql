-- ════════════════════════════════════════════════════════════════════════
-- Fase 20t (29-sep) · Decisiones del dueño
--   E: los productos nacen en Odoo y se editan en GUDS → nadie crea productos por la API (el borrado de los de Odoo ya lo
--      impide c_proteger_espejo_odoo). La sincronización escribe como postgres en modo réplica y no pasa por aquí.
--   G: el rol Contador ve y edita lo financiero (cuentas, cobros, facturas, notas, retenciones, bancos, conciliación,
--      compras y cuentas por pagar) y consulta reportes, dashboard, clientes y órdenes para dar contexto.
--   Rol Almacén: inventario (ver y editar) para confirmar las devoluciones de delivery (D6).
--   Administrador: filas explícitas para Bancos y Compras (ya tenía acceso total; así lo muestra también Roles).
-- ════════════════════════════════════════════════════════════════════════
begin;

create or replace function public.productos_nacen_en_odoo() returns trigger
language plpgsql set search_path = public as $$
begin
  -- Solo las peticiones con sesión (API); el importador, el service role y el SQL interno no tienen auth.uid()
  if auth.uid() is not null then
    raise exception 'Los productos se crean en Odoo: aparecen en GUDS con la próxima sincronización y aquí se editan'
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.productos_nacen_en_odoo() from public, anon, authenticated;

drop trigger if exists a0_productos_nacen_en_odoo on public.productos;
create trigger a0_productos_nacen_en_odoo before insert on public.productos
  for each row execute function public.productos_nacen_en_odoo();

-- Permisos por rol (ver, crear, editar, eliminar); se reescriben si ya existían
with v(rol, modulo, ver, crear, editar, eliminar) as (values
  ('Contador', 'cuentas', true, true, true, false),
  ('Contador', 'bancos', true, true, true, false),
  ('Contador', 'compras', true, true, true, false),
  ('Contador', 'reportes', true, false, false, false),
  ('Contador', 'dashboard', true, false, false, false),
  ('Contador', 'clientes', true, false, false, false),
  ('Contador', 'ordenes', true, false, false, false),
  ('Almacén', 'inventario', true, false, true, false),
  ('Almacén', 'dashboard', true, false, false, false),
  ('Administrador', 'bancos', true, true, true, true),
  ('Administrador', 'compras', true, true, true, true)
)
insert into permisos (rol_id, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar)
select r.id, m.id, v.ver, v.crear, v.editar, v.eliminar
from v join roles r on r.nombre = v.rol join modulos m on m.codigo = v.modulo
on conflict (rol_id, modulo_id) do update
  set puede_ver = excluded.puede_ver, puede_crear = excluded.puede_crear,
      puede_editar = excluded.puede_editar, puede_eliminar = excluded.puede_eliminar;

commit;
