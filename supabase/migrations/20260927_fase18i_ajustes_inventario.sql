-- ════════════════════════════════════════════════════════════════════════
-- Fase 18i · Ajustes de inventario de Odoo (stock.move.line sin transferencia) — espejo, solo lectura en GUDS
--   Completan la trazabilidad de lotes: entradas y salidas por conteo o corrección de cantidad.
-- ════════════════════════════════════════════════════════════════════════
begin;

create table if not exists public.ajustes_inventario (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  odoo_id integer not null unique,                      -- stock.move.line
  producto_id uuid references public.productos(id) on delete set null,
  lote_id uuid references public.lotes(id) on delete set null,
  lote_nombre text,
  sentido text not null check (sentido in ('entrada', 'salida', 'traslado')),
  cantidad numeric not null default 0,
  almacen_id uuid references public.almacenes(id) on delete set null,
  ubicacion_origen text,
  ubicacion_destino text,
  referencia text,
  fecha timestamptz,
  odoo_sync_at timestamptz
);
create index if not exists ajustes_inventario_lote_idx on public.ajustes_inventario (lote_id);
create index if not exists ajustes_inventario_almacen_idx on public.ajustes_inventario (almacen_id);

alter table public.ajustes_inventario enable row level security;
drop policy if exists empresa_visible on public.ajustes_inventario;
create policy empresa_visible on public.ajustes_inventario as restrictive for all to authenticated
  using (empresa_id = any ((select public.empresas_visibles())::uuid[]));
drop policy if exists ajustes_inventario_leer on public.ajustes_inventario;
create policy ajustes_inventario_leer on public.ajustes_inventario for select to authenticated using (public.puede('inventario', 'ver'));
drop trigger if exists z_guardia_empresa on public.ajustes_inventario;
create trigger z_guardia_empresa before insert or update or delete on public.ajustes_inventario
  for each row execute function public.trg_guardia_empresa();

commit;
