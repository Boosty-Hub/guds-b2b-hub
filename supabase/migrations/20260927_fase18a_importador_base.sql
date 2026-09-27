-- ════════════════════════════════════════════════════════════════════════
-- Fase 18a · Base para el importador Odoo → GUDS (docs/PLAN-ESPEJO-ODOO.md, Fase 2)
--   - Marcas de sincronización y datos de Odoo que faltaban
--   - Retenciones: unique(odoo_model, odoo_id) (los ids de IVA e ISLR se solapan en Odoo)
--   - Registro de corridas y marcas de agua por entidad/empresa (base de la sincronización periódica)
-- ════════════════════════════════════════════════════════════════════════
begin;
-- Las actualizaciones de abajo no deben disparar recálculos ni notificaciones
set local session_replication_role = replica;

alter table public.productos
  add column if not exists tipo_odoo text,                 -- consu / service / combo
  add column if not exists vendible boolean,               -- activo y sale_ok en Odoo
  add column if not exists odoo_sync_at timestamptz;
alter table public.clientes add column if not exists odoo_sync_at timestamptz;
alter table public.ordenes add column if not exists odoo_sync_at timestamptz;
alter table public.pagos
  add column if not exists odoo_sync_at timestamptz,
  add column if not exists estado_odoo text,
  add column if not exists es_igtf boolean not null default false;
alter table public.bancos
  add column if not exists tipo_odoo text,                 -- bank / cash
  add column if not exists odoo_sync_at timestamptz;
alter table public.almacenes add column if not exists odoo_sync_at timestamptz;
alter table public.facturas
  add column if not exists es_nota_debito boolean not null default false,
  add column if not exists factura_origen_id uuid references public.facturas(id) on delete set null;

-- Retenciones: identidad Odoo = (modelo, id)
alter table public.retenciones
  add column if not exists odoo_model text,
  add column if not exists numero_comprobante text,        -- nº de comprobante del cliente (customer_doc_number)
  add column if not exists odoo_sync_at timestamptz;
alter table public.retencion_items add column if not exists odoo_model text;
update public.retenciones set odoo_model = case tipo when 'islr' then 'account.wh.islr' else 'account.wh.iva' end
  where odoo_id is not null and odoo_model is null;
update public.retencion_items ri set odoo_model = case r.tipo when 'islr' then 'account.wh.islr.line' else 'account.wh.iva.line' end
  from public.retenciones r where r.id = ri.retencion_id and ri.odoo_id is not null and ri.odoo_model is null;
alter table public.retenciones drop constraint if exists retenciones_odoo_id_key;
alter table public.retenciones add constraint retenciones_odoo_key unique (odoo_model, odoo_id);
alter table public.retencion_items drop constraint if exists retencion_items_odoo_id_key;
alter table public.retencion_items add constraint retencion_items_odoo_key unique (odoo_model, odoo_id);

-- ── Registro de corridas del importador / sincronización ─────────────────
create table if not exists public.sync_corridas (
  id uuid primary key default gen_random_uuid(),
  iniciado_en timestamptz not null default now(),
  terminado_en timestamptz,
  modo text not null check (modo in ('completo', 'incremental')),
  origen text not null default 'script' check (origen in ('script', 'cron', 'manual')),
  estado text not null default 'en_curso' check (estado in ('en_curso', 'ok', 'error')),
  resumen jsonb not null default '{}'::jsonb,
  error text
);
create index if not exists sync_corridas_iniciado_idx on public.sync_corridas (iniciado_en desc);

-- Marca de agua por entidad y empresa: write_date más reciente ya importado
create table if not exists public.sync_estado (
  entidad text not null,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ultima_marca timestamptz,
  ultima_corrida_id uuid references public.sync_corridas(id) on delete set null,
  registros integer,
  actualizado_en timestamptz not null default now(),
  primary key (entidad, empresa_id)
);

-- Solo lectura para administración; escribe el importador (service role / postgres)
alter table public.sync_corridas enable row level security;
drop policy if exists sync_corridas_lectura on public.sync_corridas;
create policy sync_corridas_lectura on public.sync_corridas for select to authenticated
  using (public.puede('configuracion', 'ver'));
alter table public.sync_estado enable row level security;
drop policy if exists sync_estado_lectura on public.sync_estado;
create policy sync_estado_lectura on public.sync_estado for select to authenticated
  using (public.puede('configuracion', 'ver'));

commit;
