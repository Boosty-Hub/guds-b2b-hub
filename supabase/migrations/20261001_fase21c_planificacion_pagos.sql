-- ════════════════════════════════════════════════════════════════════════
-- Fase 21c · Planificación de pagos en Cuentas por Pagar (plan de revisión 30-sep, Fase 4).
--   Pedido de finanzas: "entrar al sistema, decir qué tengo pendiente por pagar al día de caja y ejecutar los pagos
--   desde ese plan", sin armar el Excel. Los pagos se registran en Odoo (decisión vigente): GUDS planifica y refleja.
--
--   · dias_caja: día de caja por empresa (y por tipo; hoy solo 'proveedores'), por defecto miércoles. Se cambia en
--     Configuración → Días de caja (RPC fijar_dia_caja).
--   · facturas_proveedor.condicion_pago: nombre del término de pago de la factura en Odoo (invoice_payment_term_id).
--   · v_cxp_planificacion: facturas de proveedor con saldo, con retenciones pendientes estimadas y el plan activo en
--     que están (security invoker: respeta el RLS de cada tabla).
--   · planes_pago + planes_pago_items: borrador → aprobado → pagado (o anulado). Se escriben solo por RPC
--     (guardar_plan_pago, cambiar_estado_plan_pago, eliminar_plan_pago), que validan permiso y empresa.
--   · conciliar_planes_pago: cierre automático. La sincronización con Odoo (compras.js) la llama al terminar; cruza los
--     ítems de los planes aprobados con factura_proveedor_aplicaciones (pagos desde la fecha del plan) y marca cada ítem
--     pagado / parcial / diferencia; el plan pasa a pagado cuando ningún ítem queda pendiente.
--   Permisos: módulo 'planificacion_pagos' (ver, crear, editar, eliminar borradores) y 'aprobacion_pagos' (editar =
--   aprobar, devolver a borrador, anular aprobados y cerrar). Administrador: todo; Contador: planificar sin aprobar.
--   Nada para anon.
-- ════════════════════════════════════════════════════════════════════════
begin;

-- ── 1. Condición de pago de la factura (la trae la sincronización) ───────
alter table public.facturas_proveedor add column if not exists condicion_pago text;
comment on column public.facturas_proveedor.condicion_pago is 'Término de pago de la factura en Odoo (invoice_payment_term_id). Null = vencimiento puesto a mano';

-- ── 2. Módulos y permisos ────────────────────────────────────────────────
insert into public.modulos (codigo, nombre, descripcion, icono, orden, activo) values
  ('planificacion_pagos', 'Planificación de pagos', 'Planes de pago a proveedores (borradores, historial, PDF/Excel)', 'CalendarClock', 20, true),
  ('aprobacion_pagos', 'Aprobación de pagos', 'Aprobar, devolver, anular y cerrar planes de pago (usa el permiso Editar)', 'BadgeCheck', 21, true)
on conflict (codigo) do nothing;
insert into public.permisos (rol_id, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar)
select r.id, m.id, true, true, true, true from public.roles r, public.modulos m
where r.nombre = 'Administrador' and m.codigo in ('planificacion_pagos', 'aprobacion_pagos')
on conflict (rol_id, modulo_id) do nothing;
insert into public.permisos (rol_id, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar)
select r.id, m.id, true, true, true, false from public.roles r, public.modulos m
where r.nombre = 'Contador' and m.codigo = 'planificacion_pagos'
on conflict (rol_id, modulo_id) do nothing;

-- ── 3. Día de caja por empresa ───────────────────────────────────────────
create table if not exists public.dias_caja (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo text not null default 'proveedores',
  dia_semana smallint not null default 3,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.usuarios(id) on delete set null,
  primary key (empresa_id, tipo),
  constraint dias_caja_tipo_check check (tipo in ('proveedores', 'cobranza')),
  constraint dias_caja_dia_check check (dia_semana between 0 and 6)
);
comment on table public.dias_caja is 'Día de caja semanal por empresa (21c). dia_semana: 0 = domingo … 3 = miércoles … 6 = sábado';
insert into public.dias_caja (empresa_id, tipo, dia_semana)
select id, 'proveedores', 3 from public.empresas on conflict do nothing;

alter table public.dias_caja enable row level security;
revoke all on public.dias_caja from anon;
-- Es configuración: se ve el de todas las empresas permitidas al usuario (Configuración las muestra juntas)
drop policy if exists empresa_visible on public.dias_caja;
drop policy if exists empresa_permitida on public.dias_caja;
create policy empresa_permitida on public.dias_caja as restrictive for all to authenticated
  using (empresa_id = any ((select public.empresas_permitidas())::uuid[]));
drop policy if exists dias_caja_ver on public.dias_caja;
create policy dias_caja_ver on public.dias_caja for select to authenticated
  using ((select public.puede('planificacion_pagos', 'ver')) or (select public.puede('compras', 'ver')) or (select public.puede('configuracion', 'ver')));

create or replace function public.fijar_dia_caja(p_empresa uuid, p_dia smallint, p_tipo text default 'proveedores')
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.puede('configuracion', 'editar') then
    raise exception 'No tienes permiso para cambiar la configuración' using errcode = 'P0001';
  end if;
  if not (p_empresa = any (public.empresas_permitidas())) then
    raise exception 'No tienes acceso a esa empresa' using errcode = 'P0001';
  end if;
  if p_dia is null or p_dia not between 0 and 6 then raise exception 'Día inválido' using errcode = 'P0001'; end if;
  insert into dias_caja (empresa_id, tipo, dia_semana, updated_at, updated_by)
  values (p_empresa, coalesce(p_tipo, 'proveedores'), p_dia, now(), (select id from usuarios where auth_id = auth.uid()))
  on conflict (empresa_id, tipo) do update set dia_semana = excluded.dia_semana, updated_at = now(), updated_by = excluded.updated_by;
end $$;
revoke all on function public.fijar_dia_caja(uuid, smallint, text) from public, anon;
grant execute on function public.fijar_dia_caja(uuid, smallint, text) to authenticated;

-- ── 4. Planes de pago ────────────────────────────────────────────────────
create table if not exists public.planes_pago (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  numero text not null unique,
  estado text not null default 'borrador',
  fecha_corte date not null,
  fecha_pago date not null,
  notas text,
  tasa_bcv numeric,
  creado_por uuid references public.usuarios(id) on delete set null,
  aprobado_por uuid references public.usuarios(id) on delete set null,
  aprobado_at timestamptz,
  cerrado_por uuid references public.usuarios(id) on delete set null,
  cerrado_at timestamptz,
  cierre text,
  anulado_motivo text,
  conciliado_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint planes_pago_estado_check check (estado in ('borrador', 'aprobado', 'pagado', 'anulado')),
  constraint planes_pago_cierre_check check (cierre is null or cierre in ('automatico', 'manual'))
);
comment on table public.planes_pago is 'Plan de pago a proveedores (21c): borrador → aprobado → pagado (o anulado). Se escribe solo por RPC';
comment on column public.planes_pago.fecha_corte is 'Fecha hasta la que se miró lo pendiente (por defecto el próximo día de caja)';
comment on column public.planes_pago.fecha_pago is 'Día en que tesorería ejecuta los pagos (en Odoo)';
comment on column public.planes_pago.tasa_bcv is 'Tasa BCV (Bs/USD) al guardar el plan: equivalente en bolívares de lo que se paga en Bs';
comment on column public.planes_pago.cierre is 'automatico: la sincronización encontró todos los pagos · manual: lo cerró un aprobador';
create index if not exists planes_pago_empresa_idx on public.planes_pago (empresa_id, estado, fecha_pago desc);

create table if not exists public.planes_pago_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.planes_pago(id) on delete cascade,
  empresa_id uuid references public.empresas(id),
  factura_proveedor_id uuid references public.facturas_proveedor(id) on delete set null,
  proveedor_id uuid references public.proveedores(id) on delete set null,
  factura_numero text not null,
  factura_referencia text,
  proveedor_nombre text,
  fecha_vencimiento date,
  saldo_al_planificar numeric not null,
  ret_pendiente_est numeric not null default 0,
  monto_usd numeric not null,
  moneda_pago text not null default 'USD',
  banco_id uuid references public.bancos(id) on delete set null,
  notas text,
  estado text not null default 'pendiente',
  monto_pagado_usd numeric not null default 0,
  retenido_usd numeric not null default 0,
  diferencia_usd numeric,
  motivo_diferencia text,
  pagos_odoo text,
  fecha_pago_real date,
  revisado_at timestamptz,
  created_at timestamptz not null default now(),
  constraint planes_pago_items_monto_check check (monto_usd > 0),
  constraint planes_pago_items_moneda_check check (moneda_pago in ('USD', 'BS')),
  constraint planes_pago_items_estado_check check (estado in ('pendiente', 'parcial', 'pagado', 'diferencia')),
  constraint planes_pago_items_factura_uq unique (plan_id, factura_proveedor_id)
);
comment on table public.planes_pago_items is 'Factura (o parte) que entra en un plan de pago (21c). Guarda una foto de la factura al planificar';
comment on column public.planes_pago_items.monto_usd is 'Monto planificado en USD (puede ser parcial). Por defecto, saldo menos las retenciones pendientes estimadas';
comment on column public.planes_pago_items.ret_pendiente_est is 'Retenciones (IVA/ISLR) aún no emitidas en Odoo, estimadas con el % histórico del proveedor';
comment on column public.planes_pago_items.estado is 'pendiente · parcial (pagado menos de lo planificado y la factura sigue con saldo) · pagado · diferencia (pagado distinto a lo planificado, o saldada sin pago)';
comment on column public.planes_pago_items.monto_pagado_usd is 'Pagos de Odoo aplicados a la factura desde la fecha del plan (factura_proveedor_aplicaciones tipo pago)';
create index if not exists planes_pago_items_plan_idx on public.planes_pago_items (plan_id);
create index if not exists planes_pago_items_factura_idx on public.planes_pago_items (factura_proveedor_id);

drop trigger if exists z_guardia_empresa on public.planes_pago;
create trigger z_guardia_empresa before insert or update or delete on public.planes_pago
  for each row execute function public.trg_guardia_empresa();
drop trigger if exists a_heredar_empresa on public.planes_pago_items;
create trigger a_heredar_empresa before insert on public.planes_pago_items
  for each row execute function public.trg_heredar_empresa('planes_pago', 'plan_id');
drop trigger if exists z_guardia_empresa on public.planes_pago_items;
create trigger z_guardia_empresa before insert or update or delete on public.planes_pago_items
  for each row execute function public.trg_guardia_empresa();
drop trigger if exists z_validar_refs_empresa on public.planes_pago_items;
create trigger z_validar_refs_empresa before insert or update on public.planes_pago_items
  for each row execute function public.trg_validar_refs_empresa('plan_id:planes_pago', 'factura_proveedor_id:facturas_proveedor', 'banco_id:bancos');

alter table public.planes_pago enable row level security;
alter table public.planes_pago_items enable row level security;
revoke all on public.planes_pago, public.planes_pago_items from anon;
revoke insert, update, delete on public.planes_pago, public.planes_pago_items from authenticated;
drop policy if exists empresa_visible on public.planes_pago;
create policy empresa_visible on public.planes_pago as restrictive for all to authenticated
  using (empresa_id = any ((select public.empresas_visibles())::uuid[]));
drop policy if exists planes_pago_ver on public.planes_pago;
create policy planes_pago_ver on public.planes_pago for select to authenticated
  using ((select public.puede('planificacion_pagos', 'ver')));
drop policy if exists empresa_visible on public.planes_pago_items;
create policy empresa_visible on public.planes_pago_items as restrictive for all to authenticated
  using (empresa_id = any ((select public.empresas_visibles())::uuid[]));
drop policy if exists planes_pago_items_ver on public.planes_pago_items;
create policy planes_pago_items_ver on public.planes_pago_items for select to authenticated
  using ((select public.puede('planificacion_pagos', 'ver')));

-- ── 5. Vista de planificación ────────────────────────────────────────────
-- Facturas de proveedor con saldo. Retenciones pendientes: la factura aún no tiene comprobante (IVA / ISLR) en Odoo;
--   IVA = impuesto × % del último comprobante del proveedor (75 % si nunca se le retuvo);
--   ISLR = base × % del último comprobante ISLR del proveedor (solo si se le ha retenido ISLR antes).
create or replace view public.v_cxp_planificacion with (security_invoker = true) as
with ret as (
  select i.factura_proveedor_id, bool_or(r.tipo = 'iva') iva, bool_or(r.tipo = 'islr') islr
  from public.retencion_emitida_items i join public.retenciones_emitidas r on r.id = i.retencion_id
  where r.estado <> 'anulado' and i.factura_proveedor_id is not null
  group by 1
), pct as (
  select distinct on (r.empresa_id, r.proveedor_id, r.tipo) r.empresa_id, r.proveedor_id, r.tipo, i.porcentaje
  from public.retenciones_emitidas r join public.retencion_emitida_items i on i.retencion_id = r.id
  where r.estado <> 'anulado' and r.proveedor_id is not null and i.porcentaje is not null
  order by r.empresa_id, r.proveedor_id, r.tipo, r.fecha desc nulls last, i.porcentaje desc
), en_plan as (
  select distinct on (it.factura_proveedor_id) it.factura_proveedor_id, p.id plan_id, p.numero plan_numero, p.estado plan_estado,
    it.monto_usd plan_monto
  from public.planes_pago_items it join public.planes_pago p on p.id = it.plan_id
  where p.estado in ('borrador', 'aprobado') and it.estado in ('pendiente', 'parcial') and it.factura_proveedor_id is not null
  order by it.factura_proveedor_id, p.created_at desc
), base as (
  select f.*, coalesce(f.total_usd / nullif(f.total, 0), 1) factor
  from public.facturas_proveedor f
  where f.estado = 'posted' and f.tipo = 'factura' and f.saldo_usd > 0.009
)
select f.id, f.empresa_id, f.numero, f.referencia, f.proveedor_id, pr.nombre proveedor_nombre, pr.rif proveedor_rif,
  f.fecha_emision, f.fecha_vencimiento, coalesce(f.fecha_vencimiento, f.fecha_emision) vence, f.condicion_pago,
  (f.fecha_vencimiento - f.fecha_emision) plazo_dias, f.moneda, f.es_nota_debito, f.total_usd, f.saldo_usd,
  round(f.impuesto * f.factor, 2) impuesto_usd,
  coalesce(ret.iva, false) ret_iva_emitida, coalesce(ret.islr, false) ret_islr_emitida,
  piva.porcentaje iva_pct, pislr.porcentaje islr_pct,
  case when not coalesce(ret.iva, false) and f.impuesto > 0
    then least(f.saldo_usd, round(f.impuesto * f.factor * coalesce(piva.porcentaje, 75) / 100, 2)) else 0 end ret_iva_pend,
  case when not coalesce(ret.islr, false) and pislr.porcentaje > 0
    then least(f.saldo_usd, round(f.subtotal * f.factor * pislr.porcentaje / 100, 2)) else 0 end ret_islr_pend,
  ep.plan_id, ep.plan_numero, ep.plan_estado, ep.plan_monto
from base f
left join public.proveedores pr on pr.id = f.proveedor_id
left join ret on ret.factura_proveedor_id = f.id
left join pct piva on piva.empresa_id = f.empresa_id and piva.proveedor_id = f.proveedor_id and piva.tipo = 'iva'
left join pct pislr on pislr.empresa_id = f.empresa_id and pislr.proveedor_id = f.proveedor_id and pislr.tipo = 'islr'
left join en_plan ep on ep.factura_proveedor_id = f.id;
comment on view public.v_cxp_planificacion is 'Facturas de proveedor con saldo para planificar pagos (21c): retenciones pendientes estimadas y plan activo';
revoke all on public.v_cxp_planificacion from anon;
grant select on public.v_cxp_planificacion to authenticated;

-- ── 6. Funciones ─────────────────────────────────────────────────────────
-- Cierre automático: cruza los ítems de los planes aprobados con lo que Odoo aplicó a cada factura desde la fecha del
-- plan. Tolerancia: 0,05 USD o 0,5 % del monto. La llama la sincronización (sin sesión) y el botón "Revisar pagos".
create or replace function public.conciliar_planes_pago(p_empresa uuid default null, p_plan uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_items int := 0; v_planes int := 0;
begin
  if auth.uid() is not null and not public.puede('planificacion_pagos', 'ver') then
    raise exception 'No tienes permiso para ver los planes de pago' using errcode = 'P0001';
  end if;
  -- Proceso interno: valida arriba y solo refleja lo que trajo Odoo (también en "Ambas empresas")
  perform set_config('guds.bypass_guard', 'on', true);

  with base as (
    select i.id, i.monto_usd, f.saldo_usd saldo_actual, (f.id is null) sin_factura,
      coalesce(a.pagado, 0) pagado, coalesce(a.retenido, 0) retenido, a.ultima, a.refs,
      greatest(0.05, i.monto_usd * 0.005) tol
    from planes_pago_items i
    join planes_pago p on p.id = i.plan_id
    left join facturas_proveedor f on f.id = i.factura_proveedor_id
    left join lateral (
      select sum(x.monto_usd) filter (where x.tipo = 'pago') pagado, sum(x.monto_usd) filter (where x.tipo = 'retencion') retenido,
        max(x.fecha) filter (where x.tipo = 'pago') ultima,
        string_agg(distinct pp.numero, ', ') filter (where x.tipo = 'pago') refs
      from factura_proveedor_aplicaciones x left join pagos_proveedor pp on pp.id = x.pago_proveedor_id
      where x.factura_proveedor_id = i.factura_proveedor_id and x.fecha >= (p.created_at at time zone 'America/Caracas')::date
    ) a on true
    where p.estado = 'aprobado' and (p_empresa is null or p.empresa_id = p_empresa) and (p_plan is null or p.id = p_plan)
  ), nuevo as (
    select b.id, b.pagado, b.retenido, b.ultima, b.refs, b.monto_usd,
      case
        when b.pagado > b.monto_usd + b.tol then 'diferencia'
        when b.pagado >= b.monto_usd - b.tol then 'pagado'
        when b.sin_factura or coalesce(b.saldo_actual, 0) <= 0.009 then 'diferencia'
        when b.pagado > 0 then 'parcial'
        else 'pendiente' end estado,
      case
        when b.pagado > b.monto_usd + b.tol then 'Se pagó más de lo planificado'
        when b.pagado >= b.monto_usd - b.tol then null
        when b.sin_factura then 'La factura ya no está en Odoo'
        when coalesce(b.saldo_actual, 0) <= 0.009 and b.pagado > 0 then 'La factura quedó saldada con un pago menor al planificado'
        when coalesce(b.saldo_actual, 0) <= 0.009 then 'La factura quedó saldada sin pago (nota de crédito, retención u otro asiento)'
        else null end motivo
    from base b
  )
  update planes_pago_items i set estado = n.estado, monto_pagado_usd = round(n.pagado, 2), retenido_usd = round(n.retenido, 2),
    diferencia_usd = case when n.pagado > 0 or n.estado = 'diferencia' then round(n.pagado - n.monto_usd, 2) end,
    motivo_diferencia = n.motivo, pagos_odoo = n.refs, fecha_pago_real = n.ultima, revisado_at = now()
  from nuevo n
  where i.id = n.id;
  get diagnostics v_items = row_count;

  update planes_pago p set estado = 'pagado', cierre = 'automatico', cerrado_at = now(), conciliado_at = now(), updated_at = now()
  where p.estado = 'aprobado' and (p_empresa is null or p.empresa_id = p_empresa) and (p_plan is null or p.id = p_plan)
    and exists (select 1 from planes_pago_items i where i.plan_id = p.id)
    and not exists (select 1 from planes_pago_items i where i.plan_id = p.id and i.estado in ('pendiente', 'parcial'));
  get diagnostics v_planes = row_count;

  update planes_pago p set conciliado_at = now()
  where p.estado = 'aprobado' and (p_empresa is null or p.empresa_id = p_empresa) and (p_plan is null or p.id = p_plan);

  perform set_config('guds.bypass_guard', 'off', true);
  return jsonb_build_object('items_revisados', v_items, 'planes_cerrados', v_planes);
end $$;
revoke all on function public.conciliar_planes_pago(uuid, uuid) from public, anon;
grant execute on function public.conciliar_planes_pago(uuid, uuid) to authenticated;

-- Crea o modifica un plan en borrador. p_items: [{factura_proveedor_id, monto_usd, moneda_pago?, banco_id?, notas?}].
--   p_modo 'reemplazar' (los ítems del plan pasan a ser exactamente p_items) | 'agregar' (suma o actualiza esos ítems).
--   p_items null = solo cambia la cabecera.
create or replace function public.guardar_plan_pago(
  p_plan_id uuid, p_fecha_corte date, p_fecha_pago date, p_notas text, p_items jsonb, p_modo text default 'reemplazar')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.empresa_activa(); v_uid uuid; v_plan planes_pago; v_it jsonb; v_f record; v_monto numeric;
  v_otro text; v_moneda text; v_banco_id uuid; v_banco_moneda text; v_n int;
begin
  if auth.uid() is null then raise exception 'Sin sesión' using errcode = 'P0001'; end if;
  if v_emp is null then
    raise exception 'Modo consulta ("Ambas empresas"): selecciona GUDS o Quirutec en el menú superior para hacer cambios.' using errcode = 'P0001';
  end if;
  if coalesce(p_modo, 'reemplazar') not in ('reemplazar', 'agregar') then raise exception 'Modo inválido' using errcode = 'P0001'; end if;
  if p_items is not null and jsonb_typeof(p_items) <> 'array' then raise exception 'Ítems inválidos' using errcode = 'P0001'; end if;
  select id into v_uid from usuarios where auth_id = auth.uid();

  if p_plan_id is null then
    if not public.puede('planificacion_pagos', 'crear') then
      raise exception 'No tienes permiso para crear planes de pago' using errcode = 'P0001';
    end if;
    if p_items is null or jsonb_array_length(p_items) = 0 then
      raise exception 'Selecciona al menos una factura para el plan' using errcode = 'P0001';
    end if;
    insert into planes_pago (empresa_id, numero, fecha_corte, fecha_pago, notas, tasa_bcv, creado_por)
    values (v_emp, public.siguiente_numero(v_emp, 'PP'), coalesce(p_fecha_corte, (now() at time zone 'America/Caracas')::date),
      coalesce(p_fecha_pago, p_fecha_corte, (now() at time zone 'America/Caracas')::date), nullif(btrim(coalesce(p_notas, '')), ''),
      (select nullif(valor, '')::numeric from configuracion where clave = 'tasa_cambio'), v_uid)
    returning * into v_plan;
  else
    select * into v_plan from planes_pago where id = p_plan_id for update;
    if not found then raise exception 'Plan de pago no encontrado' using errcode = 'P0001'; end if;
    if v_plan.empresa_id <> v_emp then
      raise exception 'Este plan pertenece a otra empresa. Cámbiala en el menú superior.' using errcode = 'P0001';
    end if;
    if not public.puede('planificacion_pagos', 'editar') then
      raise exception 'No tienes permiso para modificar planes de pago' using errcode = 'P0001';
    end if;
    if v_plan.estado <> 'borrador' then
      raise exception 'Solo se modifica un plan en borrador (devuélvelo a borrador para cambiarlo)' using errcode = 'P0001';
    end if;
    update planes_pago set fecha_corte = coalesce(p_fecha_corte, fecha_corte), fecha_pago = coalesce(p_fecha_pago, fecha_pago),
      notas = case when p_notas is null then notas else nullif(btrim(p_notas), '') end,
      tasa_bcv = (select nullif(valor, '')::numeric from configuracion where clave = 'tasa_cambio'), updated_at = now()
    where id = v_plan.id;
    if p_items is not null and coalesce(p_modo, 'reemplazar') = 'reemplazar' then
      delete from planes_pago_items where plan_id = v_plan.id;
    end if;
  end if;

  for v_it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    select f.*, pr.nombre proveedor_nombre, v.ret_iva_pend + v.ret_islr_pend ret_pend
      into v_f
    from facturas_proveedor f left join proveedores pr on pr.id = f.proveedor_id
    left join v_cxp_planificacion v on v.id = f.id
    where f.id = nullif(v_it ->> 'factura_proveedor_id', '')::uuid;
    if not found then raise exception 'Factura no encontrada' using errcode = 'P0001'; end if;
    if v_f.empresa_id is distinct from v_emp then
      raise exception 'La factura % pertenece a otra empresa', v_f.numero using errcode = 'P0001';
    end if;
    if v_f.estado <> 'posted' or v_f.tipo <> 'factura' or v_f.saldo_usd <= 0.009 then
      raise exception 'La factura % no tiene saldo por pagar', v_f.numero using errcode = 'P0001';
    end if;
    v_monto := round(nullif(v_it ->> 'monto_usd', '')::numeric, 2);
    if v_monto is null or v_monto <= 0 then raise exception 'Monto inválido para la factura %', v_f.numero using errcode = 'P0001'; end if;
    if v_monto > v_f.saldo_usd + 0.01 then
      raise exception 'El monto de la factura % (%) supera su saldo (%)', v_f.numero, v_monto, round(v_f.saldo_usd, 2) using errcode = 'P0001';
    end if;
    select p.numero into v_otro from planes_pago_items i join planes_pago p on p.id = i.plan_id
    where i.factura_proveedor_id = v_f.id and p.id <> v_plan.id and p.estado in ('borrador', 'aprobado') and i.estado in ('pendiente', 'parcial')
    limit 1;
    if v_otro is not null then
      raise exception 'La factura % ya está en el plan %', v_f.numero, v_otro using errcode = 'P0001';
    end if;
    v_moneda := upper(coalesce(nullif(v_it ->> 'moneda_pago', ''), 'USD'));
    if v_moneda = 'VES' then v_moneda := 'BS'; end if;
    if v_moneda not in ('USD', 'BS') then raise exception 'Moneda de pago inválida' using errcode = 'P0001'; end if;
    v_banco_id := null; v_banco_moneda := null;
    if nullif(v_it ->> 'banco_id', '') is not null then
      select id, moneda into v_banco_id, v_banco_moneda from bancos where id = (v_it ->> 'banco_id')::uuid and coalesce(activo, true);
      if v_banco_id is null then raise exception 'Banco no encontrado' using errcode = 'P0001'; end if;
      v_moneda := case when upper(v_banco_moneda) = 'USD' then 'USD' else 'BS' end;   -- el banco manda la moneda
    end if;
    insert into planes_pago_items (plan_id, empresa_id, factura_proveedor_id, proveedor_id, factura_numero, factura_referencia,
      proveedor_nombre, fecha_vencimiento, saldo_al_planificar, ret_pendiente_est, monto_usd, moneda_pago, banco_id, notas)
    values (v_plan.id, v_emp, v_f.id, v_f.proveedor_id, v_f.numero, v_f.referencia, v_f.proveedor_nombre,
      coalesce(v_f.fecha_vencimiento, v_f.fecha_emision), round(v_f.saldo_usd, 2), coalesce(v_f.ret_pend, 0), v_monto, v_moneda, v_banco_id,
      nullif(btrim(coalesce(v_it ->> 'notas', '')), ''))
    on conflict (plan_id, factura_proveedor_id) do update set monto_usd = excluded.monto_usd, moneda_pago = excluded.moneda_pago,
      banco_id = excluded.banco_id, notas = coalesce(excluded.notas, planes_pago_items.notas),
      saldo_al_planificar = excluded.saldo_al_planificar, ret_pendiente_est = excluded.ret_pendiente_est;
  end loop;

  select count(*) into v_n from planes_pago_items where plan_id = v_plan.id;
  if v_n = 0 then raise exception 'El plan debe tener al menos una factura' using errcode = 'P0001'; end if;
  return v_plan.id;
end $$;
revoke all on function public.guardar_plan_pago(uuid, date, date, text, jsonb, text) from public, anon;
grant execute on function public.guardar_plan_pago(uuid, date, date, text, jsonb, text) to authenticated;

-- Cambio de estado: aprobar (borrador → aprobado), devolver (aprobado → borrador, si nada se ha pagado),
-- anular (borrador o aprobado → anulado), cerrar (aprobado → pagado a mano).
create or replace function public.cambiar_estado_plan_pago(p_plan_id uuid, p_accion text, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.empresa_activa(); v_uid uuid; v_plan planes_pago; v_aprob boolean := public.puede('aprobacion_pagos', 'editar');
  v_txt text;
begin
  if auth.uid() is null then raise exception 'Sin sesión' using errcode = 'P0001'; end if;
  if v_emp is null then
    raise exception 'Modo consulta ("Ambas empresas"): selecciona GUDS o Quirutec en el menú superior para hacer cambios.' using errcode = 'P0001';
  end if;
  select id into v_uid from usuarios where auth_id = auth.uid();
  select * into v_plan from planes_pago where id = p_plan_id for update;
  if not found then raise exception 'Plan de pago no encontrado' using errcode = 'P0001'; end if;
  if v_plan.empresa_id <> v_emp then raise exception 'Este plan pertenece a otra empresa. Cámbiala en el menú superior.' using errcode = 'P0001'; end if;

  if p_accion = 'aprobar' then
    if not v_aprob then raise exception 'No tienes permiso para aprobar planes de pago' using errcode = 'P0001'; end if;
    if v_plan.estado <> 'borrador' then raise exception 'Solo se aprueba un plan en borrador' using errcode = 'P0001'; end if;
    select string_agg(i.factura_numero, ', ') into v_txt from planes_pago_items i left join facturas_proveedor f on f.id = i.factura_proveedor_id
    where i.plan_id = v_plan.id and (f.id is null or f.saldo_usd <= 0.009 or i.monto_usd > f.saldo_usd + 0.01);
    if v_txt is not null then
      raise exception 'Revisa el plan: estas facturas ya no tienen ese saldo en Odoo: %', v_txt using errcode = 'P0001';
    end if;
    update planes_pago set estado = 'aprobado', aprobado_por = v_uid, aprobado_at = now(), updated_at = now() where id = v_plan.id;
    perform public.conciliar_planes_pago(null, v_plan.id);
  elsif p_accion = 'devolver' then
    if not v_aprob then raise exception 'No tienes permiso para devolver planes aprobados' using errcode = 'P0001'; end if;
    if v_plan.estado <> 'aprobado' then raise exception 'Solo se devuelve a borrador un plan aprobado' using errcode = 'P0001'; end if;
    if exists (select 1 from planes_pago_items where plan_id = v_plan.id and monto_pagado_usd > 0) then
      raise exception 'El plan ya tiene pagos registrados en Odoo: no se puede devolver a borrador (ciérralo o anúlalo)' using errcode = 'P0001';
    end if;
    update planes_pago set estado = 'borrador', aprobado_por = null, aprobado_at = null, updated_at = now() where id = v_plan.id;
    update planes_pago_items set estado = 'pendiente', diferencia_usd = null, motivo_diferencia = null, revisado_at = null where plan_id = v_plan.id;
  elsif p_accion = 'anular' then
    if v_plan.estado = 'borrador' and not (public.puede('planificacion_pagos', 'eliminar') or v_aprob) then
      raise exception 'No tienes permiso para anular planes de pago' using errcode = 'P0001';
    end if;
    if v_plan.estado = 'aprobado' and not v_aprob then raise exception 'Solo un aprobador anula un plan aprobado' using errcode = 'P0001'; end if;
    if v_plan.estado not in ('borrador', 'aprobado') then raise exception 'Este plan ya está cerrado' using errcode = 'P0001'; end if;
    update planes_pago set estado = 'anulado', anulado_motivo = nullif(btrim(coalesce(p_motivo, '')), ''), cerrado_por = v_uid,
      cerrado_at = now(), updated_at = now() where id = v_plan.id;
  elsif p_accion = 'cerrar' then
    if not v_aprob then raise exception 'No tienes permiso para cerrar planes de pago' using errcode = 'P0001'; end if;
    if v_plan.estado <> 'aprobado' then raise exception 'Solo se cierra un plan aprobado' using errcode = 'P0001'; end if;
    perform public.conciliar_planes_pago(null, v_plan.id);
    update planes_pago set estado = 'pagado', cierre = 'manual', cerrado_por = v_uid, cerrado_at = now(),
      notas = case when nullif(btrim(coalesce(p_motivo, '')), '') is null then notas
                   else concat_ws(E'\n', notas, 'Cierre: ' || btrim(p_motivo)) end,
      updated_at = now()
    where id = v_plan.id and estado = 'aprobado';
  else
    raise exception 'Acción inválida' using errcode = 'P0001';
  end if;
  return (select to_jsonb(p) from planes_pago p where p.id = v_plan.id);
end $$;
revoke all on function public.cambiar_estado_plan_pago(uuid, text, text) from public, anon;
grant execute on function public.cambiar_estado_plan_pago(uuid, text, text) to authenticated;

create or replace function public.eliminar_plan_pago(p_plan_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_plan planes_pago;
begin
  if auth.uid() is null or not public.puede('planificacion_pagos', 'eliminar') then
    raise exception 'No tienes permiso para eliminar planes de pago' using errcode = 'P0001';
  end if;
  select * into v_plan from planes_pago where id = p_plan_id for update;
  if not found then raise exception 'Plan de pago no encontrado' using errcode = 'P0001'; end if;
  if v_plan.empresa_id is distinct from public.empresa_activa() then
    raise exception 'Este plan pertenece a otra empresa (o estás en "Ambas empresas"). Cámbiala en el menú superior.' using errcode = 'P0001';
  end if;
  if v_plan.estado <> 'borrador' then raise exception 'Solo se elimina un borrador (un plan aprobado se anula)' using errcode = 'P0001'; end if;
  delete from planes_pago where id = v_plan.id;
end $$;
revoke all on function public.eliminar_plan_pago(uuid) from public, anon;
grant execute on function public.eliminar_plan_pago(uuid) to authenticated;

commit;
