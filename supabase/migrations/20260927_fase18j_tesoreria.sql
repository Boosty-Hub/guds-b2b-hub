-- ════════════════════════════════════════════════════════════════════════
-- Fase 18j · Bancos y tesorería (docs/PLAN-ESPEJO-ODOO.md, Fase 7)
--   movimientos_bancarios: también pagos a proveedores, reintegros y depósitos por identificar (antes solo cobros)
--   bancos: saldo según Odoo (en la moneda del banco y en USD) y número de cuenta de Odoo
--   extractos_odoo + extracto_odoo_lineas: extractos bancarios de Odoo (espejo, solo lectura)
--   pagos: pago de origen del IGTF y lote de pago · pagos_proveedor: lote de pago
-- La conciliación propia de GUDS (extractos_bancarios / extracto_lineas) no cambia.
-- ════════════════════════════════════════════════════════════════════════
begin;

alter table public.movimientos_bancarios
  add column if not exists origen text,
  add column if not exists pago_proveedor_id uuid references public.pagos_proveedor(id) on delete cascade,
  add column if not exists reintegro_id uuid references public.reintegros(id) on delete cascade,
  add column if not exists odoo_pago_id integer;
update public.movimientos_bancarios set origen = 'cobro' where pago_id is not null and origen is null;
update public.movimientos_bancarios set origen = 'manual' where origen is null;
alter table public.movimientos_bancarios drop constraint if exists movimientos_bancarios_origen_check;
alter table public.movimientos_bancarios add constraint movimientos_bancarios_origen_check
  check (origen in ('cobro', 'pago_proveedor', 'reintegro_proveedor', 'reintegro_cliente', 'por_identificar', 'manual'));
alter table public.movimientos_bancarios alter column origen set default 'manual';
create unique index if not exists movimientos_pago_proveedor_uq on public.movimientos_bancarios (pago_proveedor_id) where pago_proveedor_id is not null;
create unique index if not exists movimientos_reintegro_uq on public.movimientos_bancarios (reintegro_id) where reintegro_id is not null;
create unique index if not exists movimientos_odoo_pago_uq on public.movimientos_bancarios (odoo_pago_id) where odoo_pago_id is not null;

alter table public.bancos
  add column if not exists saldo_odoo numeric,
  add column if not exists saldo_odoo_usd numeric,
  add column if not exists saldo_odoo_at timestamptz,
  add column if not exists cuenta_odoo text;

alter table public.pagos
  add column if not exists igtf_origen_id uuid references public.pagos(id) on delete set null,
  add column if not exists lote_pago text;
alter table public.pagos_proveedor add column if not exists lote_pago text;

create table if not exists public.extractos_odoo (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  odoo_id integer not null unique,                      -- account.bank.statement
  banco_id uuid references public.bancos(id) on delete set null,
  nombre text,
  fecha date,
  saldo_inicial numeric,
  saldo_final numeric,
  saldo_final_real numeric,
  completo boolean,
  valido boolean,
  odoo_sync_at timestamptz
);

create table if not exists public.extracto_odoo_lineas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  odoo_id integer not null unique,                      -- account.bank.statement.line
  extracto_id uuid references public.extractos_odoo(id) on delete cascade,
  banco_id uuid references public.bancos(id) on delete set null,
  fecha date,
  referencia text,
  contacto text,
  cliente_id uuid references public.clientes(id) on delete set null,
  proveedor_id uuid references public.proveedores(id) on delete set null,
  monto numeric not null default 0,                     -- moneda del banco
  monto_otra_moneda numeric,
  otra_moneda text,
  saldo numeric,                                        -- saldo corrido del extracto
  conciliada boolean not null default false,
  pendiente numeric,
  tipo_transaccion text,
  cuenta_contraparte text,
  odoo_sync_at timestamptz
);
create index if not exists extracto_odoo_lineas_banco_idx on public.extracto_odoo_lineas (banco_id, fecha);
create index if not exists extracto_odoo_lineas_extracto_idx on public.extracto_odoo_lineas (extracto_id);

do $$
declare t text;
begin
  foreach t in array array['extractos_odoo', 'extracto_odoo_lineas'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists empresa_visible on public.%I', t);
    execute format('create policy empresa_visible on public.%I as restrictive for all to authenticated
      using (empresa_id = any ((select public.empresas_visibles())::uuid[]))', t);
    execute format('drop policy if exists %I on public.%I', t || '_leer', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.puede(''bancos'', ''ver''))', t || '_leer', t);
    execute format('drop trigger if exists z_guardia_empresa on public.%I', t);
    execute format('create trigger z_guardia_empresa before insert or update or delete on public.%I for each row execute function public.trg_guardia_empresa()', t);
  end loop;
end $$;

-- Los datos nuevos que vienen de Odoo tampoco se editan desde GUDS
drop trigger if exists c_proteger_espejo_odoo on public.bancos;
create trigger c_proteger_espejo_odoo before update or delete on public.bancos for each row
  execute function public.trg_proteger_espejo_odoo('nombre', 'moneda', 'tipo_odoo', 'activo', 'empresa_id', 'saldo_odoo', 'saldo_odoo_usd', 'saldo_odoo_at', 'cuenta_odoo');
drop trigger if exists c_proteger_espejo_odoo on public.pagos;
create trigger c_proteger_espejo_odoo before update or delete on public.pagos for each row
  execute function public.trg_proteger_espejo_odoo('numero', 'cliente_id', 'banco_id', 'monto', 'monto_moneda', 'moneda', 'estado', 'estado_odoo',
    'referencia', 'es_igtf', 'fecha_verificacion', 'empresa_id', 'igtf_origen_id', 'lote_pago');

commit;
