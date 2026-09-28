-- ════════════════════════════════════════════════════════════════════════
-- Fase 20j · R3: costo de los productos desde Odoo, visible solo para administración (docs/PLAN-PORTALES-Y-FLUJOS.md §7,
-- docs/privado/planes/plan-reportes.md R3; decisión del 28-sep: "costo promedio de Odoo, solo para administración")
--
--   · producto_costos: costo promedio de Odoo (standard_price, depende de la empresa) de cada producto en cada empresa,
--     con la fecha en que GUDS vio el valor actual (costo_actualizado_at). Lo escribe solo el importador (rol postgres);
--     por la API lo lee únicamente el personal de administración (es_personal_admin) y en la empresa activa.
--   · producto_costos_historial: cada valor nuevo que trae el importador (para calcular el margen a la fecha en una
--     fase futura; hoy el margen de Odoo usa el costo actual).
--   · productos.costo (campo heredado de GUDS, 0 en todos los productos): el catálogo se lee con select=* desde el portal
--     del cliente y del vendedor, así que un privilegio por columna rompería esas pantallas. El costo real no se guarda
--     ahí: la columna queda siempre vacía (un disparador la limpia en cada alta o edición) para que nunca exponga un costo.
-- ════════════════════════════════════════════════════════════════════════
begin;

create table if not exists public.producto_costos (
  producto_id uuid not null references public.productos(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id),
  costo numeric not null default 0,
  costo_actualizado_at timestamptz not null default now(),
  origen text not null default 'odoo' check (origen in ('odoo')),
  primary key (producto_id, empresa_id)
);
comment on table public.producto_costos is 'Costo promedio de Odoo (standard_price) por producto y empresa, en USD. Lo escribe el importador; solo lo lee administración';
comment on column public.producto_costos.costo_actualizado_at is 'Cuándo trajo el importador este valor (la sincronización periódica lo ve dentro de los 15 minutos del cambio en Odoo)';

create table if not exists public.producto_costos_historial (
  id bigint generated always as identity primary key,
  producto_id uuid not null references public.productos(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id),
  costo numeric not null,
  desde timestamptz not null
);
create index if not exists producto_costos_historial_producto on public.producto_costos_historial (producto_id, empresa_id, desde);
comment on table public.producto_costos_historial is 'Cada costo nuevo de Odoo que trae el importador (desde = fecha de la sincronización)';

alter table public.producto_costos enable row level security;
alter table public.producto_costos_historial enable row level security;

drop policy if exists producto_costos_admin_ver on public.producto_costos;
create policy producto_costos_admin_ver on public.producto_costos for select to authenticated
  using ((select public.es_personal_admin()));
drop policy if exists empresa_visible on public.producto_costos;
create policy empresa_visible on public.producto_costos as restrictive for all to authenticated
  using (empresa_id = any ((select public.empresas_visibles())::uuid[]));

drop policy if exists producto_costos_historial_admin_ver on public.producto_costos_historial;
create policy producto_costos_historial_admin_ver on public.producto_costos_historial for select to authenticated
  using ((select public.es_personal_admin()));
drop policy if exists empresa_visible on public.producto_costos_historial;
create policy empresa_visible on public.producto_costos_historial as restrictive for all to authenticated
  using (empresa_id = any ((select public.empresas_visibles())::uuid[]));

revoke all on public.producto_costos, public.producto_costos_historial from public, anon, authenticated;
grant select on public.producto_costos, public.producto_costos_historial to authenticated;

-- productos.costo: siempre vacío (el costo vive en producto_costos)
comment on column public.productos.costo is 'Obsoleto: siempre null. El costo de Odoo está en producto_costos (solo administración); esta columna la lee el catálogo público';
create or replace function public.trg_producto_sin_costo() returns trigger language plpgsql set search_path = public as $$
begin
  new.costo := null;
  return new;
end $$;
revoke execute on function public.trg_producto_sin_costo() from public, anon, authenticated;
drop trigger if exists a_producto_sin_costo on public.productos;
create trigger a_producto_sin_costo before insert or update of costo on public.productos
  for each row when (new.costo is not null) execute function public.trg_producto_sin_costo();

-- Vaciar lo que haya (sin disparar los recálculos del catálogo ni tocar updated_at)
set local session_replication_role = replica;
update public.productos set costo = null where costo is not null;
set local session_replication_role = origin;

notify pgrst, 'reload schema';

commit;
