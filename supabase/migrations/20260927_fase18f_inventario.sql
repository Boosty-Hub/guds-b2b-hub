-- ════════════════════════════════════════════════════════════════════════
-- Fase 18f · Inventario (docs/PLAN-ESPEJO-ODOO.md, Fase 6) — espejo de Odoo, solo lectura en GUDS
--   lotes (stock.lot: lotes y series con vencimiento) · inventario_lotes (stock.quant por ubicación y lote)
--   transferencias (stock.picking: recepciones, entregas y traslados) · transferencia_items (stock.move)
--   transferencia_lotes (stock.move.line con lote: trazabilidad lote → cliente)
--   inventario_almacen.reservado · almacenes.vinculo_cliente (cómo se identificó el cliente de una consignación)
-- ════════════════════════════════════════════════════════════════════════
begin;

create table if not exists public.lotes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas(id),      -- nulo = compartido (company_id vacío en Odoo)
  odoo_id integer not null unique,
  producto_id uuid references public.productos(id) on delete cascade,
  nombre text not null,
  es_serie boolean not null default false,
  vencimiento date,                                     -- nulo = sin vencimiento (o fecha de relleno en Odoo)
  fecha_alerta date,
  fecha_retiro date,
  fecha_uso date,                                       -- "consumir preferentemente antes de"
  cantidad numeric default 0,                           -- existencia total del lote en Odoo
  referencia text,
  notas text,
  odoo_sync_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.inventario_lotes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  odoo_id integer not null unique,                      -- stock.quant
  almacen_id uuid references public.almacenes(id) on delete cascade,
  ubicacion text,
  producto_id uuid not null references public.productos(id) on delete cascade,
  lote_id uuid references public.lotes(id) on delete set null,
  cantidad numeric not null default 0,
  reservado numeric not null default 0,
  fecha_ingreso timestamptz,
  odoo_sync_at timestamptz
);

create table if not exists public.transferencias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  odoo_id integer not null unique,                      -- stock.picking
  numero text not null,
  tipo text not null check (tipo in ('recepcion', 'entrega', 'interna', 'otra')),
  tipo_operacion text,                                  -- nombre del tipo de operación en Odoo
  estado text not null,                                 -- borrador / en_espera / lista / hecha / cancelada
  origen text,                                          -- documento origen (S00123, P00045…)
  contacto text,
  cliente_id uuid references public.clientes(id) on delete set null,
  proveedor_id uuid references public.proveedores(id) on delete set null,
  orden_id uuid references public.ordenes(id) on delete set null,
  orden_compra_id uuid references public.ordenes_compra(id) on delete set null,
  almacen_origen_id uuid references public.almacenes(id) on delete set null,
  almacen_destino_id uuid references public.almacenes(id) on delete set null,
  ubicacion_origen text,
  ubicacion_destino text,
  fecha_programada timestamptz,
  fecha_limite timestamptz,
  fecha_realizada timestamptz,
  responsable text,
  transportista text,
  devolucion_de_id uuid references public.transferencias(id) on delete set null,
  pendiente_de_id uuid references public.transferencias(id) on delete set null,   -- backorder de
  notas text,
  odoo_sync_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.transferencia_items (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  odoo_id integer not null unique,                      -- stock.move
  transferencia_id uuid not null references public.transferencias(id) on delete cascade,
  producto_id uuid references public.productos(id) on delete set null,
  nombre_producto text,
  cantidad_demandada numeric default 0,
  cantidad_hecha numeric default 0,
  estado text,
  odoo_sync_at timestamptz
);

create table if not exists public.transferencia_lotes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  odoo_id integer not null unique,                      -- stock.move.line
  transferencia_id uuid not null references public.transferencias(id) on delete cascade,
  item_id uuid references public.transferencia_items(id) on delete cascade,
  producto_id uuid references public.productos(id) on delete set null,
  lote_id uuid references public.lotes(id) on delete set null,
  lote_nombre text,
  cantidad numeric default 0,
  fecha timestamptz,
  odoo_sync_at timestamptz
);

alter table public.inventario_almacen add column if not exists reservado numeric not null default 0;
alter table public.almacenes add column if not exists vinculo_cliente text
  check (vinculo_cliente in ('nombre', 'entregas', 'manual'));
update public.almacenes set vinculo_cliente = 'nombre' where tipo = 'consignacion' and cliente_id is not null and vinculo_cliente is null;

-- Si alguien de GUDS elige a mano el cliente de una consignación, el vínculo queda "manual" y el importador lo respeta
create or replace function public.trg_almacen_vinculo_manual()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '') = 'authenticated'
     and new.cliente_id is distinct from old.cliente_id then
    new.vinculo_cliente := case when new.cliente_id is null then null else 'manual' end;
  end if;
  return new;
end $$;
drop trigger if exists b_almacen_vinculo_manual on public.almacenes;
create trigger b_almacen_vinculo_manual before update on public.almacenes for each row execute function public.trg_almacen_vinculo_manual();

-- Índices
create index if not exists lotes_producto_idx on public.lotes (producto_id);
create index if not exists lotes_vencimiento_idx on public.lotes (vencimiento);
create index if not exists inventario_lotes_almacen_idx on public.inventario_lotes (almacen_id);
create index if not exists inventario_lotes_producto_idx on public.inventario_lotes (producto_id);
create index if not exists inventario_lotes_lote_idx on public.inventario_lotes (lote_id);
create index if not exists transferencias_empresa_idx on public.transferencias (empresa_id, tipo, estado);
create index if not exists transferencias_orden_idx on public.transferencias (orden_id);
create index if not exists transferencias_cliente_idx on public.transferencias (cliente_id);
create index if not exists transferencias_alm_origen_idx on public.transferencias (almacen_origen_id);
create index if not exists transferencias_alm_destino_idx on public.transferencias (almacen_destino_id);
create index if not exists transferencia_items_transf_idx on public.transferencia_items (transferencia_id);
create index if not exists transferencia_lotes_transf_idx on public.transferencia_lotes (transferencia_id);
create index if not exists transferencia_lotes_lote_idx on public.transferencia_lotes (lote_id);

-- Reglas: multiempresa, lectura con el módulo "inventario", solo lectura para usuarios (espejo de Odoo)
do $$
declare t text;
begin
  foreach t in array array['lotes', 'inventario_lotes', 'transferencias', 'transferencia_items', 'transferencia_lotes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists empresa_visible on public.%I', t);
    execute format('create policy empresa_visible on public.%I as restrictive for all to authenticated
      using (empresa_id is null or empresa_id = any ((select public.empresas_visibles())::uuid[]))', t);
    execute format('drop policy if exists %I on public.%I', t || '_leer', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.puede(''inventario'', ''ver''))', t || '_leer', t);
    execute format('drop trigger if exists z_guardia_empresa on public.%I', t);
    execute format('create trigger z_guardia_empresa before insert or update or delete on public.%I for each row execute function public.trg_guardia_empresa()', t);
    -- Sin políticas de escritura: solo el importador (service role / postgres) escribe estas tablas
  end loop;
end $$;

commit;
