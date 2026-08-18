-- =====================================================================
-- GUDS · FASE 10 — Módulo de FACTURAS (migradas desde Odoo account_move).
--   Las órdenes son el pedido comercial; las facturas son el documento
--   fiscal/contable real. Cuentas y Cuentas por Cobrar deben basarse en
--   facturas (no en órdenes) porque en Odoo la deuda vive en account_move.
--   Una orden puede no tener factura aún, o tener varias (parciales) —
--   por eso orden_id es nullable y no 1:1.
-- =====================================================================
begin;

create table if not exists public.facturas (
  id uuid primary key default gen_random_uuid(),
  numero text not null,                       -- account_move.name (ej. "27671")
  tipo text not null default 'factura'
    check (tipo in ('factura','nota_credito')), -- out_invoice / out_refund
  cliente_id uuid references public.clientes(id),
  orden_id uuid references public.ordenes(id), -- resuelto via sale_id -> ordenes.odoo_id
  fecha_emision date,                          -- invoice_date
  fecha_vencimiento date,                      -- invoice_date_due
  moneda text not null default 'USD'
    check (moneda in ('USD','VES')),           -- res_currency: USD / VED
  tasa_cambio numeric,                         -- invoice_currency_rate
  subtotal numeric not null default 0,         -- amount_untaxed
  impuesto numeric not null default 0,         -- amount_tax
  total numeric not null default 0,            -- amount_total
  monto_pagado numeric not null default 0,     -- total - amount_residual
  saldo_pendiente numeric not null default 0,  -- amount_residual
  estado_pago text not null default 'pendiente'
    check (estado_pago in ('pendiente','parcial','pagado','anulado')), -- payment_state mapeado
  estado text not null default 'posted',       -- state de Odoo (posted/cancel/draft)
  referencia text,                             -- ref
  nro_control text,                            -- nro_control (control fiscal VE)
  vendedor_odoo text,                          -- invoice_user_id -> nombre (mismo patrón que ordenes.vendedor_odoo)
  notas text,
  odoo_id integer unique,                      -- account_move.id (idempotencia del sync)
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists facturas_cliente_id_idx on public.facturas(cliente_id);
create index if not exists facturas_orden_id_idx on public.facturas(orden_id);
create index if not exists facturas_estado_pago_idx on public.facturas(estado_pago);

drop trigger if exists update_facturas_updated_at on public.facturas;
create trigger update_facturas_updated_at before update on public.facturas
  for each row execute function public.update_updated_at();

create table if not exists public.factura_items (
  id uuid primary key default gen_random_uuid(),
  factura_id uuid not null references public.facturas(id) on delete cascade,
  producto_id uuid references public.productos(id),  -- resuelto via product_id -> productos.odoo_id
  nombre_producto text,                               -- account_move_line.name
  sku_producto text,
  cantidad numeric not null default 0,                -- quantity
  precio_unitario numeric not null default 0,          -- price_unit
  descuento numeric not null default 0,                -- discount (%)
  subtotal numeric not null default 0,                 -- price_subtotal
  total numeric not null default 0,                    -- price_total
  odoo_id integer unique,                              -- account_move_line.id
  created_at timestamptz default now()
);

create index if not exists factura_items_factura_id_idx on public.factura_items(factura_id);

alter table public.facturas enable row level security;
alter table public.factura_items enable row level security;

-- Admin / back-office: mismo módulo de permisos que pagos ('cuentas')
create policy facturas_perm_ver on public.facturas
  for select to authenticated using (public.puede('cuentas', 'ver'));
create policy facturas_perm_crear on public.facturas
  for insert to authenticated with check (public.puede('cuentas', 'crear'));
create policy facturas_perm_editar on public.facturas
  for update to authenticated using (public.puede('cuentas', 'editar')) with check (public.puede('cuentas', 'editar'));
create policy facturas_perm_eliminar on public.facturas
  for delete to authenticated using (public.puede('cuentas', 'eliminar'));

-- Cliente ve sus propias facturas
create policy facturas_cliente_read on public.facturas
  for select to authenticated using (
    cliente_id in (select usuarios.cliente_id from public.usuarios where usuarios.auth_id = auth.uid())
  );

-- Vendedor ve las facturas de sus clientes asignados
create policy facturas_vendedor_read on public.facturas
  for select to authenticated using (
    cliente_id in (select public.mis_clientes_vendedor())
  );

-- factura_items sigue los mismos permisos que su factura
create policy factura_items_perm_ver on public.factura_items
  for select to authenticated using (public.puede('cuentas', 'ver'));
create policy factura_items_perm_crear on public.factura_items
  for insert to authenticated with check (public.puede('cuentas', 'crear'));
create policy factura_items_perm_editar on public.factura_items
  for update to authenticated using (public.puede('cuentas', 'editar')) with check (public.puede('cuentas', 'editar'));
create policy factura_items_perm_eliminar on public.factura_items
  for delete to authenticated using (public.puede('cuentas', 'eliminar'));

create policy factura_items_cliente_read on public.factura_items
  for select to authenticated using (
    factura_id in (
      select f.id from public.facturas f
      join public.usuarios u on u.cliente_id = f.cliente_id
      where u.auth_id = auth.uid()
    )
  );

create policy factura_items_vendedor_read on public.factura_items
  for select to authenticated using (
    factura_id in (
      select f.id from public.facturas f
      where f.cliente_id in (select public.mis_clientes_vendedor())
    )
  );

commit;
