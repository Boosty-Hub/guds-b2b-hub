begin;

-- Fase 13a: catálogo de conceptos ISLR + tablas de retenciones (IVA/ISLR).

create table public.conceptos_retencion_islr (
  id uuid primary key default gen_random_uuid(),
  codigo text,
  concepto text not null,
  porcentaje numeric not null,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.conceptos_retencion_islr is 'Catálogo SENIAT de conceptos de retención ISLR aplicables a GUDS como proveedor domiciliado (persona jurídica), con la tasa vigente 2026 tomada de Odoo (account_withholding_rate_table_line, company_type=company, residence_type=D).';

-- Sembrado con los conceptos y tasas REALES vigentes en Odoo (verificado 2026-08-18).
-- Se excluye el concepto 11 "Sueldos y Salarios" (nómina, no aplica a la relación B2B con clientes).
insert into public.conceptos_retencion_islr (codigo, concepto, porcentaje) values
  ('004', 'Honorarios Profesionales No Mercantiles', 5),
  ('020', 'Comisiones distintas a Remuneraciones Sueldos y Salarios', 5),
  ('055', 'Pagos a Empresas Contratistas o Subcontratistas por ejecución de obras o prestación de servicios', 2),
  ('059', 'Pagos de Administradores de bienes inmuebles a Arrendadores de bienes inmuebles situados en el país', 5),
  ('063', 'Cánones de Arrendamiento de Bienes Muebles situados en el país', 5),
  ('072', 'Pagos por Gastos de Transporte conformados por Fletes', 3),
  ('084', 'Pagos por Servicios de Publicidad y Propaganda y la Cesión de Venta de Espacios para tales fines', 5),
  ('086', 'Pagos por Servicios de Publicidad y Propaganda a Emisoras Radiodifusoras', 3);

create sequence if not exists public.retencion_seq;

create table public.retenciones (
  id uuid primary key default gen_random_uuid(),
  numero text not null,
  tipo text not null check (tipo in ('iva','islr')),
  cliente_id uuid not null references public.clientes(id),
  concepto_islr_id uuid references public.conceptos_retencion_islr(id),
  porcentaje numeric,
  base_imponible numeric not null default 0,
  total numeric not null default 0,
  fecha date not null default current_date,
  comprobante_url text,
  estado text not null default 'pendiente' check (estado in ('pendiente','aprobado','rechazado')),
  declarado_por uuid references public.usuarios(id),
  rol_declarante text not null check (rol_declarante in ('cliente','vendedor','admin')),
  revisado_por uuid references public.usuarios(id),
  revisado_en timestamptz,
  notas text,
  odoo_id integer unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.retenciones is 'Comprobantes de retención de IVA/ISLR que los clientes le practican a GUDS. odoo_id NOT NULL = migrada del histórico de Odoo (ya neteada en facturas.saldo_odoo_usd, excluida del recálculo de saldo).';

create index retenciones_cliente_idx on public.retenciones(cliente_id);
create index retenciones_estado_idx on public.retenciones(estado);

create trigger update_retenciones_updated_at
  before update on public.retenciones
  for each row execute function public.update_updated_at();

create table public.retencion_items (
  id uuid primary key default gen_random_uuid(),
  retencion_id uuid not null references public.retenciones(id) on delete cascade,
  factura_id uuid not null references public.facturas(id),
  monto_aplicado numeric not null check (monto_aplicado > 0),
  odoo_id integer unique,
  created_at timestamptz not null default now()
);

create index retencion_items_retencion_idx on public.retencion_items(retencion_id);
create index retencion_items_factura_idx on public.retencion_items(factura_id);

alter table public.conceptos_retencion_islr enable row level security;
alter table public.retenciones enable row level security;
alter table public.retencion_items enable row level security;

create policy conceptos_retencion_islr_read on public.conceptos_retencion_islr
  for select to authenticated using (true);
create policy conceptos_retencion_islr_perm_editar on public.conceptos_retencion_islr
  for update to authenticated using (public.puede('cuentas','editar')) with check (public.puede('cuentas','editar'));

create policy retenciones_perm_ver on public.retenciones
  for select to authenticated using (public.puede('cuentas','ver'));
create policy retenciones_perm_editar on public.retenciones
  for update to authenticated using (public.puede('cuentas','editar')) with check (public.puede('cuentas','editar'));
create policy retenciones_perm_eliminar on public.retenciones
  for delete to authenticated using (public.puede('cuentas','eliminar'));
create policy retenciones_cliente_read on public.retenciones
  for select to authenticated using (
    cliente_id in (select u.cliente_id from public.usuarios u where u.auth_id = auth.uid())
  );
create policy retenciones_vendedor_read on public.retenciones
  for select to authenticated using (cliente_id in (select public.mis_clientes_vendedor()));

create policy retencion_items_perm_ver on public.retencion_items
  for select to authenticated using (public.puede('cuentas','ver'));
create policy retencion_items_perm_editar on public.retencion_items
  for update to authenticated using (public.puede('cuentas','editar')) with check (public.puede('cuentas','editar'));
create policy retencion_items_perm_eliminar on public.retencion_items
  for delete to authenticated using (public.puede('cuentas','eliminar'));
create policy retencion_items_cliente_read on public.retencion_items
  for select to authenticated using (
    retencion_id in (
      select r.id from public.retenciones r
      where r.cliente_id in (select u.cliente_id from public.usuarios u where u.auth_id = auth.uid())
    )
  );
create policy retencion_items_vendedor_read on public.retencion_items
  for select to authenticated using (
    retencion_id in (select r.id from public.retenciones r where r.cliente_id in (select public.mis_clientes_vendedor()))
  );

-- Nota: sin políticas de INSERT en retenciones/retencion_items — toda escritura pasa por
-- declarar_retencion() / revisar_retencion() (security definer, Fase 13b).

-- ─────────────────────────────────────────────────────────────────────────
-- Conectar con el saldo de la factura, sin duplicar el descuento del histórico
-- ya neteado en saldo_odoo_usd (Fase 10/11).
-- ─────────────────────────────────────────────────────────────────────────
alter table public.facturas add column if not exists monto_retenido_usd numeric not null default 0;
comment on column public.facturas.monto_retenido_usd is 'Suma de retencion_items.monto_aplicado de retenciones aprobadas Y NO migradas de Odoo (odoo_id is null). Mantenido por trigger, no editar a mano.';

drop index if exists public.facturas_deuda_idx;
alter table public.facturas drop column saldo_usd;
alter table public.facturas drop column estado_cobro;

alter table public.facturas add column saldo_usd numeric
  generated always as (round(saldo_odoo_usd - monto_aplicado_usd - monto_retenido_usd, 2)) stored;
comment on column public.facturas.saldo_usd is 'Saldo real en USD = saldo_odoo_usd - monto_aplicado_usd - monto_retenido_usd. Columna canónica de deuda.';

alter table public.facturas add column estado_cobro text generated always as (
  case
    when estado_pago = 'anulado' or estado = 'cancel' then 'anulado'
    when abs(saldo_odoo_usd - monto_aplicado_usd - monto_retenido_usd) <= 0.01 then 'pagado'
    when abs(saldo_odoo_usd - monto_aplicado_usd - monto_retenido_usd) < abs(total_usd) then 'parcial'
    else 'pendiente'
  end
) stored;

create index facturas_deuda_idx on public.facturas (cliente_id) include (saldo_usd) where estado = 'posted';

-- Flags de cliente agente de retención (migrados de res_partner.apply_third_party_retention_iva/islr).
alter table public.clientes add column if not exists retiene_iva boolean not null default false;
alter table public.clientes add column if not exists retiene_islr boolean not null default false;

-- Trigger: retencion_items es la fuente de verdad de facturas.monto_retenido_usd.
-- CRÍTICO: excluye retenciones migradas (odoo_id is null) para no descontar dos veces
-- lo que Odoo ya neteó en saldo_odoo_usd.
create or replace function public.trg_recalc_factura_retenido()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_factura_id uuid := coalesce(new.factura_id, old.factura_id);
begin
  update public.facturas f
  set monto_retenido_usd = coalesce((
    select sum(ri.monto_aplicado)
    from public.retencion_items ri
    join public.retenciones r on r.id = ri.retencion_id
    where ri.factura_id = f.id and r.estado = 'aprobado' and r.odoo_id is null
  ), 0)
  where f.id = v_factura_id;
  return null;
end;
$$;

create trigger trg_ri_recalc
  after insert or update or delete on public.retencion_items
  for each row execute function public.trg_recalc_factura_retenido();

create or replace function public.trg_recalc_factura_retenido_por_retencion()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.estado is distinct from old.estado then
    update public.facturas f
    set monto_retenido_usd = coalesce((
      select sum(ri.monto_aplicado)
      from public.retencion_items ri
      join public.retenciones r on r.id = ri.retencion_id
      where ri.factura_id = f.id and r.estado = 'aprobado' and r.odoo_id is null
    ), 0)
    where f.id in (select ri2.factura_id from public.retencion_items ri2 where ri2.retencion_id = new.id);
  end if;
  return new;
end;
$$;

create trigger trg_retencion_estado_recalc
  after update on public.retenciones
  for each row execute function public.trg_recalc_factura_retenido_por_retencion();

commit;
