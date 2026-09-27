-- ════════════════════════════════════════════════════════════════════════
-- Fase 18d · Ventas y CxC (docs/PLAN-ESPEJO-ODOO.md, Fase 4)
--   1. Facturas: motivo de anulación y motivo de nota de crédito/débito
--   2. Aplicaciones de Odoo: qué pago / nota de crédito / retención saldó cada factura (conciliaciones parciales)
--   3. Reintegros a clientes (pagos salientes a clientes)
--   4. Retención municipal recibida (tipo 'municipal')
-- ════════════════════════════════════════════════════════════════════════
begin;
set local session_replication_role = replica;

alter table public.facturas
  add column if not exists motivo_anulacion text,
  add column if not exists motivo_nota text;

alter table public.retenciones drop constraint if exists retenciones_tipo_check;
alter table public.retenciones add constraint retenciones_tipo_check check (tipo in ('iva', 'islr', 'municipal'));

-- ── Aplicaciones de Odoo ────────────────────────────────────────────────
create table if not exists public.factura_aplicaciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  odoo_id integer unique,                       -- account.partial.reconcile
  factura_id uuid not null references public.facturas(id) on delete cascade,
  tipo text not null check (tipo in ('pago', 'nota_credito', 'retencion', 'reintegro', 'otro')),
  pago_id uuid references public.pagos(id) on delete set null,
  documento_id uuid references public.facturas(id) on delete set null,   -- nota de crédito aplicada
  descripcion text,                             -- documento de Odoo que aplica (número del asiento)
  monto_usd numeric not null,
  fecha date,
  odoo_sync_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists factura_aplicaciones_factura_idx on public.factura_aplicaciones (factura_id);
create index if not exists factura_aplicaciones_pago_idx on public.factura_aplicaciones (pago_id);
create index if not exists factura_aplicaciones_empresa_idx on public.factura_aplicaciones (empresa_id);

-- ── Reintegros a clientes ───────────────────────────────────────────────
create table if not exists public.reintegros (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  odoo_id integer unique,                       -- account.payment (outbound / customer)
  numero text not null,
  cliente_id uuid not null references public.clientes(id),
  banco_id uuid references public.bancos(id),
  monto numeric not null default 0,             -- USD (moneda de la empresa)
  monto_moneda numeric,
  moneda text,
  estado text not null,                         -- verificado / pendiente / rechazado
  estado_odoo text,
  referencia text,
  fecha date,
  odoo_sync_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists reintegros_cliente_idx on public.reintegros (cliente_id);
create index if not exists reintegros_empresa_idx on public.reintegros (empresa_id);

-- Reglas: multiempresa + espejo (solo lectura para usuarios) + permisos del módulo cuentas
do $$
declare t text;
begin
  foreach t in array array['factura_aplicaciones', 'reintegros'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists empresa_visible on public.%I', t);
    execute format('create policy empresa_visible on public.%I as restrictive for all to authenticated
      using (empresa_id = any ((select public.empresas_visibles())::uuid[]))', t);
    execute format('drop policy if exists %I on public.%I', t || '_leer', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.puede(''cuentas'', ''ver''))', t || '_leer', t);
    execute format('drop trigger if exists z_guardia_empresa on public.%I', t);
    execute format('create trigger z_guardia_empresa before insert or update or delete on public.%I for each row execute function public.trg_guardia_empresa()', t);
  end loop;
end $$;
-- Lo que viene de Odoo no se edita desde GUDS
drop trigger if exists c_proteger_espejo_odoo on public.factura_aplicaciones;
create trigger c_proteger_espejo_odoo before update or delete on public.factura_aplicaciones for each row
  execute function public.trg_proteger_espejo_odoo('factura_id', 'tipo', 'pago_id', 'documento_id', 'descripcion', 'monto_usd', 'fecha', 'empresa_id');
drop trigger if exists c_proteger_espejo_odoo on public.reintegros;
create trigger c_proteger_espejo_odoo before update or delete on public.reintegros for each row
  execute function public.trg_proteger_espejo_odoo('numero', 'cliente_id', 'banco_id', 'monto', 'monto_moneda', 'moneda', 'estado', 'estado_odoo', 'referencia', 'fecha', 'empresa_id');

commit;
