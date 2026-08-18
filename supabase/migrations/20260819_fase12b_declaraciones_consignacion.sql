begin;

-- Fase 12b: declaración de ventas de inventario en consignación (cliente/vendedor/admin
-- declaran, admin aprueba → genera factura interna + descuenta inventario_almacen).

create sequence if not exists public.declaracion_consignacion_seq;

create table public.declaraciones_consignacion (
  id uuid primary key default gen_random_uuid(),
  numero text not null,
  almacen_id uuid not null references public.almacenes(id),
  cliente_id uuid not null references public.clientes(id),
  declarado_por uuid references public.usuarios(id),
  rol_declarante text not null check (rol_declarante in ('cliente','vendedor','admin')),
  estado text not null default 'pendiente' check (estado in ('pendiente','aprobado','rechazado')),
  fecha date not null default current_date,
  subtotal numeric not null default 0,
  impuesto numeric not null default 0,
  total numeric not null default 0,
  factura_id uuid references public.facturas(id),
  notas text,
  revisado_por uuid references public.usuarios(id),
  revisado_en timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.declaraciones_consignacion is 'Declaración de ventas del inventario en consignación (cliente/vendedor/admin). Al aprobarse genera una factura interna y descuenta inventario_almacen.';

create index declaraciones_consignacion_cliente_idx on public.declaraciones_consignacion(cliente_id);
create index declaraciones_consignacion_almacen_idx on public.declaraciones_consignacion(almacen_id);
create index declaraciones_consignacion_estado_idx on public.declaraciones_consignacion(estado);

create trigger update_declaraciones_consignacion_updated_at
  before update on public.declaraciones_consignacion
  for each row execute function public.update_updated_at();

create table public.declaracion_consignacion_items (
  id uuid primary key default gen_random_uuid(),
  declaracion_id uuid not null references public.declaraciones_consignacion(id) on delete cascade,
  producto_id uuid references public.productos(id),
  nombre_producto text,
  sku_producto text,
  cantidad numeric not null check (cantidad > 0),
  precio_unitario numeric not null default 0,
  subtotal numeric not null default 0,
  created_at timestamptz not null default now()
);

create index declaracion_consignacion_items_declaracion_idx on public.declaracion_consignacion_items(declaracion_id);

alter table public.declaraciones_consignacion enable row level security;
alter table public.declaracion_consignacion_items enable row level security;

-- Admin: vía el módulo 'inventario' (mismo que gatea Almacenes/Inventario hoy).
create policy declaraciones_consignacion_perm_ver on public.declaraciones_consignacion
  for select to authenticated using (public.puede('inventario','ver'));
create policy declaraciones_consignacion_perm_editar on public.declaraciones_consignacion
  for update to authenticated using (public.puede('inventario','editar')) with check (public.puede('inventario','editar'));
create policy declaraciones_consignacion_perm_eliminar on public.declaraciones_consignacion
  for delete to authenticated using (public.puede('inventario','eliminar'));

create policy declaracion_consignacion_items_perm_ver on public.declaracion_consignacion_items
  for select to authenticated using (public.puede('inventario','ver'));
create policy declaracion_consignacion_items_perm_editar on public.declaracion_consignacion_items
  for update to authenticated using (public.puede('inventario','editar')) with check (public.puede('inventario','editar'));
create policy declaracion_consignacion_items_perm_eliminar on public.declaracion_consignacion_items
  for delete to authenticated using (public.puede('inventario','eliminar'));

-- Cliente: solo sus propias declaraciones.
create policy declaraciones_consignacion_cliente_read on public.declaraciones_consignacion
  for select to authenticated using (
    cliente_id in (select u.cliente_id from public.usuarios u where u.auth_id = auth.uid())
  );
create policy declaracion_consignacion_items_cliente_read on public.declaracion_consignacion_items
  for select to authenticated using (
    declaracion_id in (
      select d.id from public.declaraciones_consignacion d
      where d.cliente_id in (select u.cliente_id from public.usuarios u where u.auth_id = auth.uid())
    )
  );

-- Vendedor: declaraciones de sus clientes asignados.
create policy declaraciones_consignacion_vendedor_read on public.declaraciones_consignacion
  for select to authenticated using (cliente_id in (select public.mis_clientes_vendedor()));
create policy declaracion_consignacion_items_vendedor_read on public.declaracion_consignacion_items
  for select to authenticated using (
    declaracion_id in (select d.id from public.declaraciones_consignacion d where d.cliente_id in (select public.mis_clientes_vendedor()))
  );

-- Nota: sin políticas de INSERT — toda escritura pasa por declarar_venta_consignacion() /
-- revisar_declaracion_consignacion() (security definer, Fase 12c).

commit;
