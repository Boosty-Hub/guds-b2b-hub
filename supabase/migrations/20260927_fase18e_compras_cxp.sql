-- ════════════════════════════════════════════════════════════════════════
-- Fase 18e · Compras y cuentas por pagar (docs/PLAN-ESPEJO-ODOO.md, Fase 5) — espejo de Odoo, solo lectura en GUDS
--   ordenes_compra (+ items) · facturas_proveedor (+ items; NC y ND de proveedor) · pagos_proveedor
--   factura_proveedor_aplicaciones (cómo se saldó) · retenciones_emitidas (+ items; IVA e ISLR a proveedores)
-- Convención de signos (igual que ventas): facturas y ND en positivo, notas de crédito en negativo.
-- ════════════════════════════════════════════════════════════════════════
begin;

create table if not exists public.ordenes_compra (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  odoo_id integer unique,
  numero text not null,
  referencia_proveedor text,
  proveedor_id uuid references public.proveedores(id),
  fecha_orden timestamptz,
  fecha_prevista timestamptz,
  estado text not null,                 -- borrador / enviada / confirmada / bloqueada / cancelada
  estado_recepcion text,
  estado_facturacion text,
  moneda text,
  subtotal numeric default 0,
  impuesto numeric default 0,
  total numeric default 0,              -- moneda del documento
  total_usd numeric default 0,          -- moneda de la empresa
  comprador text,
  notas text,
  odoo_sync_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.orden_compra_items (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  odoo_id integer unique,
  orden_compra_id uuid not null references public.ordenes_compra(id) on delete cascade,
  producto_id uuid references public.productos(id),
  nombre_producto text,
  cantidad numeric default 0,
  cantidad_recibida numeric default 0,
  cantidad_facturada numeric default 0,
  precio_unitario numeric default 0,
  subtotal numeric default 0
);

create table if not exists public.facturas_proveedor (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  odoo_id integer unique,
  numero text not null,
  referencia text,                      -- número de factura del proveedor
  tipo text not null check (tipo in ('factura', 'nota_credito')),
  es_nota_debito boolean not null default false,
  factura_origen_id uuid references public.facturas_proveedor(id) on delete set null,
  proveedor_id uuid references public.proveedores(id),
  orden_compra_id uuid references public.ordenes_compra(id) on delete set null,
  fecha_emision date,
  fecha_vencimiento date,
  moneda text,
  tasa_cambio numeric,
  subtotal numeric default 0,
  impuesto numeric default 0,
  total numeric default 0,              -- moneda del documento
  total_usd numeric default 0,          -- + factura/ND, − nota de crédito
  saldo_usd numeric default 0,
  estado_pago text,                     -- pendiente / parcial / pagado / anulado
  estado text,                          -- posted / cancel
  nro_control text,
  motivo_anulacion text,
  odoo_sync_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.factura_proveedor_items (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  odoo_id integer unique,
  factura_proveedor_id uuid not null references public.facturas_proveedor(id) on delete cascade,
  producto_id uuid references public.productos(id),
  nombre_producto text,
  cantidad numeric default 0,
  precio_unitario numeric default 0,
  descuento numeric default 0,
  subtotal numeric default 0,
  total numeric default 0
);

create table if not exists public.pagos_proveedor (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  odoo_id integer unique,
  numero text not null,
  tipo text not null check (tipo in ('pago', 'reintegro')),   -- pago al proveedor / reintegro del proveedor
  proveedor_id uuid references public.proveedores(id),
  banco_id uuid references public.bancos(id),
  monto numeric not null default 0,     -- USD
  monto_moneda numeric,
  moneda text,
  estado text not null,
  estado_odoo text,
  referencia text,
  fecha date,
  odoo_sync_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.factura_proveedor_aplicaciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  odoo_id integer unique,               -- account.partial.reconcile
  factura_proveedor_id uuid not null references public.facturas_proveedor(id) on delete cascade,
  tipo text not null check (tipo in ('pago', 'nota_credito', 'retencion', 'reintegro', 'otro')),
  pago_proveedor_id uuid references public.pagos_proveedor(id) on delete set null,
  documento_id uuid references public.facturas_proveedor(id) on delete set null,
  descripcion text,
  monto_usd numeric not null,
  fecha date,
  odoo_sync_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.retenciones_emitidas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  odoo_model text not null,
  odoo_id integer not null,
  tipo text not null check (tipo in ('iva', 'islr')),
  numero text not null,                 -- correlativo del comprobante
  proveedor_id uuid references public.proveedores(id),
  fecha date,
  periodo text,
  porcentaje numeric,
  base_imponible numeric default 0,
  total numeric default 0,              -- USD
  total_bs numeric,
  estado text,                          -- borrador / confirmado / anulado
  odoo_sync_at timestamptz,
  created_at timestamptz not null default now(),
  unique (odoo_model, odoo_id)
);
create table if not exists public.retencion_emitida_items (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  odoo_model text not null,
  odoo_id integer not null,
  retencion_id uuid not null references public.retenciones_emitidas(id) on delete cascade,
  factura_proveedor_id uuid references public.facturas_proveedor(id) on delete set null,
  concepto text,                        -- ISLR: código y descripción del concepto
  base_imponible numeric default 0,
  porcentaje numeric,
  monto numeric default 0,              -- USD
  monto_bs numeric,
  sustraendo numeric,
  unique (odoo_model, odoo_id)
);

-- Índices
create index if not exists ordenes_compra_empresa_idx on public.ordenes_compra (empresa_id);
create index if not exists ordenes_compra_proveedor_idx on public.ordenes_compra (proveedor_id);
create index if not exists orden_compra_items_orden_idx on public.orden_compra_items (orden_compra_id);
create index if not exists facturas_proveedor_empresa_idx on public.facturas_proveedor (empresa_id);
create index if not exists facturas_proveedor_proveedor_idx on public.facturas_proveedor (proveedor_id);
create index if not exists factura_proveedor_items_factura_idx on public.factura_proveedor_items (factura_proveedor_id);
create index if not exists pagos_proveedor_empresa_idx on public.pagos_proveedor (empresa_id);
create index if not exists pagos_proveedor_proveedor_idx on public.pagos_proveedor (proveedor_id);
create index if not exists fp_aplicaciones_factura_idx on public.factura_proveedor_aplicaciones (factura_proveedor_id);
create index if not exists fp_aplicaciones_pago_idx on public.factura_proveedor_aplicaciones (pago_proveedor_id);
create index if not exists retenciones_emitidas_empresa_idx on public.retenciones_emitidas (empresa_id);
create index if not exists retenciones_emitidas_proveedor_idx on public.retenciones_emitidas (proveedor_id);
create index if not exists retencion_emitida_items_ret_idx on public.retencion_emitida_items (retencion_id);

-- Reglas: multiempresa, lectura con el módulo "compras", solo lectura para usuarios (espejo de Odoo)
do $$
declare t text;
begin
  foreach t in array array['ordenes_compra', 'orden_compra_items', 'facturas_proveedor', 'factura_proveedor_items',
                           'pagos_proveedor', 'factura_proveedor_aplicaciones', 'retenciones_emitidas', 'retencion_emitida_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists empresa_visible on public.%I', t);
    execute format('create policy empresa_visible on public.%I as restrictive for all to authenticated
      using (empresa_id = any ((select public.empresas_visibles())::uuid[]))', t);
    execute format('drop policy if exists %I on public.%I', t || '_leer', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.puede(''compras'', ''ver''))', t || '_leer', t);
    execute format('drop trigger if exists z_guardia_empresa on public.%I', t);
    execute format('create trigger z_guardia_empresa before insert or update or delete on public.%I for each row execute function public.trg_guardia_empresa()', t);
    -- Sin políticas de escritura: solo el importador (service role / postgres) escribe estas tablas
  end loop;
end $$;

commit;
