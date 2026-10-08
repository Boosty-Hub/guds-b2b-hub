-- Fase 22f · R2 del plan de reportes de finanzas (docs/PLAN-REPORTES-FINANZAS.md): "Lo cobrado".
--
--   1. pagos.fecha_pago: la fecha del cobro en un solo lugar. Para los de Odoo, la fecha del cobro en Odoo; para los de
--      GUDS, la que reporta el vendedor o el día (en Caracas) en que se registró. Antes estaba vacía y cada pantalla la sacaba
--      de created_at a su manera: los cobros de Odoo (guardados a las 00:00 UTC) caían un día antes en hora de Caracas, y los
--      que cambiaron de fecha en Odoo seguían con la vieja. La sincronización la escribe; un disparador la completa siempre.
--   2. Cobros de Profit de ene–abr 2026 (decisión D3): tabla cobros_historicos, cargada desde el Excel de finanzas con
--      scripts/importar-cobros-profit.mjs. Antes del arranque de Odoo de cada empresa (empresas.odoo_arranque) valen esos
--      recibos y NO cuentan los anticipos de saldo inicial migrados a Odoo (bancos.saldo_inicial): son el mismo dinero.
--   3. cobros_unificados(): la única fuente de los reportes de cobros (Odoo + GUDS + Profit). USD = monto ÷ tasa BCV del día
--      del cobro (decisión D1) y el estado de cada cobro: vigente, anulado, borrador, por verificar, IGTF o saldo inicial.
--   4. reporte_cobranza (Resumen) pasa a esa fuente; nuevas reporte_cobranza_matriz y reporte_cobros_detalle (Lo cobrado).
--   5. factura_portal y resumen_vendedor leen fecha_pago.
-- Se puede volver a correr.

begin;

-- 1. Fecha del cobro ----------------------------------------------------------------------------------------------------
create or replace function public.pagos_fecha_pago() returns trigger language plpgsql set search_path = public as $$
begin
  -- Cobro de Odoo: su fecha en Odoo (la sincronización la deja en fecha_verificacion a las 00:00 UTC). Si la fecha cambia en
  -- Odoo y quien escribe no trae fecha_pago, se recalcula.
  if new.odoo_id is not null and new.fecha_verificacion is not null
     and (tg_op = 'INSERT' and new.fecha_pago is null
          or tg_op = 'UPDATE' and new.fecha_verificacion is distinct from old.fecha_verificacion
             and new.fecha_pago is not distinct from old.fecha_pago) then
    new.fecha_pago := (new.fecha_verificacion at time zone 'UTC')::date;
  elsif new.fecha_pago is null then
    -- Cobro de GUDS sin fecha reportada: el día de Caracas en que se registró
    new.fecha_pago := (coalesce(new.created_at, now()) at time zone 'America/Caracas')::date;
  end if;
  return new;
end $$;

drop trigger if exists b_pagos_fecha_pago on public.pagos;
create trigger b_pagos_fecha_pago before insert or update on public.pagos
  for each row execute function public.pagos_fecha_pago();

update public.pagos
   set fecha_pago = case when odoo_id is not null then (coalesce(fecha_verificacion, created_at) at time zone 'UTC')::date
                         else (created_at at time zone 'America/Caracas')::date end
 where fecha_pago is null;

alter table public.pagos alter column fecha_pago set not null;
create index if not exists pagos_fecha_pago_idx on public.pagos (fecha_pago);
comment on column public.pagos.fecha_pago is
  'Fecha del cobro (día de Caracas). Odoo: la del cobro en Odoo. GUDS: la reportada o el día en que se registró. La usan todos los reportes.';

-- La fecha de un cobro de Odoo también se corrige solo en Odoo
do $$
begin
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'public.pagos'::regclass and t.tgname = 'c_proteger_espejo_odoo'
                    and pg_get_triggerdef(t.oid) like '%''fecha_pago''%') then
    drop trigger if exists c_proteger_espejo_odoo on public.pagos;
    create trigger c_proteger_espejo_odoo before delete or update on public.pagos
      for each row execute function public.trg_proteger_espejo_odoo('numero', 'cliente_id', 'banco_id', 'monto', 'monto_moneda', 'moneda',
        'estado', 'estado_odoo', 'referencia', 'es_igtf', 'fecha_verificacion', 'empresa_id', 'igtf_origen_id', 'lote_pago', 'fecha_pago');
  end if;
end $$;

-- 2. Arranque de Odoo y diarios de saldo inicial ------------------------------------------------------------------------
alter table public.empresas add column if not exists odoo_arranque date;
comment on column public.empresas.odoo_arranque is
  'Desde esta fecha los cobros salen de Odoo; antes, de los recibos de Profit (cobros_historicos). Los anticipos de saldo inicial migrados a Odoo con fecha anterior no cuentan como cobro.';
update public.empresas set odoo_arranque = date '2026-05-01' where odoo_arranque is null;

alter table public.bancos add column if not exists saldo_inicial boolean not null default false;
comment on column public.bancos.saldo_inicial is
  'Diario de Odoo con los anticipos de saldo inicial migrados de Profit (PSIANT / PSIAME). Antes del arranque de Odoo no cuentan como cobro.';
update public.bancos set saldo_inicial = true where nombre ~* '^saldos? inicial' and not saldo_inicial;

-- 3. Cobros de Profit ---------------------------------------------------------------------------------------------------
create table if not exists public.cobros_historicos (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references public.empresas(id),
  origen text not null default 'profit' check (origen in ('profit')),
  archivo text not null,
  cargado_at timestamptz not null default now(),
  numero text not null,                    -- número del recibo en Profit
  renglon smallint not null default 1,     -- forma de pago dentro del recibo (un recibo puede tener varias)
  fecha date not null,
  cliente_codigo text,
  cliente_nombre text,
  cliente_id uuid references public.clientes(id) on delete set null,
  cliente_match text,                      -- profit (código en las ventas de Profit) · rif · nombre · documento
  cobrador_codigo text,
  cobrador_nombre text,
  forma_pago text,                         -- DEPO · EFEC · TARJ
  referencia text,
  cuenta_codigo text,
  cuenta text,                             -- caja o cuenta de Profit, p. ej. «GS BANESCO BS»
  banco_id uuid references public.bancos(id) on delete set null,
  moneda text not null check (moneda in ('BS', 'USD')),
  monto numeric(16, 2) not null,
  neto_recibo numeric(16, 2),
  tasa_origen numeric,                     -- tipo de cambio del Excel (finanzas usa uno por semana)
  usd_origen numeric(16, 2),               -- total USD del Excel
  unique (empresa_id, origen, numero, renglon)
);
comment on table public.cobros_historicos is
  'Cobros anteriores al arranque de Odoo (decisión D3): recibos de Profit cargados desde el Excel de finanzas. Solo lectura; se reemplazan con scripts/importar-cobros-profit.mjs.';
create index if not exists cobros_historicos_fecha_idx on public.cobros_historicos (fecha);
create index if not exists cobros_historicos_cliente_idx on public.cobros_historicos (cliente_id);

alter table public.cobros_historicos enable row level security;
revoke all on public.cobros_historicos from anon;
revoke insert, update, delete, truncate on public.cobros_historicos from authenticated;
drop policy if exists cobros_historicos_ver on public.cobros_historicos;
create policy cobros_historicos_ver on public.cobros_historicos for select to authenticated
  using ((select public.puede('reportes', 'ver')) and (select public.puede('cuentas', 'ver')));
drop policy if exists empresa_visible on public.cobros_historicos;
create policy empresa_visible on public.cobros_historicos as restrictive for all to authenticated
  using (empresa_id = any ((select public.empresas_visibles())::uuid[]));

-- 4. Una sola fuente de cobros -------------------------------------------------------------------------------------------
-- Una fila por cobro de Odoo o de GUDS (pagos) y por forma de pago de un recibo de Profit (cobros_historicos), de las empresas
-- visibles. usd = monto ÷ tasa BCV del día del cobro (D1; tasa_origen 'profit' = el día no tiene tasa de Odoo y se usó la de
-- Profit). Solo cuentan las filas con estado 'vigente'; las demás explican las diferencias (motivo).
create or replace function public.cobros_unificados(p_desde date, p_hasta date)
returns table(ref text, fuente text, empresa_id uuid, empresa text, fecha date, numero text, cliente_id uuid, cliente text, rif text,
  vendedor text, cobrador text, banco_id uuid, diario text, diario_moneda text, forma text, referencia text, moneda text,
  monto_moneda numeric, tasa numeric, tasa_origen text, usd numeric, usd_origen numeric, estado text, motivo text)
language sql stable security definer set search_path = public as $$
  with base as (
    select 'pago:' || pg.id::text ref, case when pg.odoo_id is not null then 'odoo' else 'guds' end fuente, pg.empresa_id,
           e.nombre_corto::text empresa, pg.fecha_pago fecha, pg.numero::text numero, pg.cliente_id, cl.nombre_negocio::text cliente,
           cl.rif::text rif,
           coalesce(nullif(trim(concat_ws(' ', u.nombre, u.apellido)), ''), nullif(trim(cl.vendedor_odoo), ''), 'Sin vendedor')::text vendedor,
           null::text cobrador, b.id banco_id, coalesce(b.nombre::text, nullif(trim(pg.banco), ''), 'Sin banco') diario,
           upper(coalesce(b.moneda::text, pg.moneda, 'USD')) diario_moneda,
           case pg.metodo::text when 'efectivo' then 'Efectivo' when 'tarjeta' then 'Tarjeta' when 'pago_movil' then 'Pago móvil'
                when 'zelle' then 'Zelle' when 'credito' then 'Crédito' else 'Transferencia' end forma,
           pg.referencia::text referencia, upper(coalesce(nullif(trim(pg.moneda), ''), 'USD')) moneda,
           coalesce(pg.monto_moneda, pg.monto) monto_moneda, pg.monto usd_origen,
           case when pg.estado::text in ('rechazado', 'anulado') then 'anulado'
                when pg.estado::text = 'pendiente' then case when pg.odoo_id is not null then 'borrador' else 'por_verificar' end
                when coalesce(pg.es_igtf, false) then 'igtf'
                when coalesce(b.saldo_inicial, false) and pg.fecha_pago < e.odoo_arranque then 'saldo_inicial'
                when pg.estado::text = 'verificado' then 'vigente'
                else pg.estado::text end estado
    from pagos pg
    left join bancos b on b.id = pg.banco_id
    left join clientes cl on cl.id = pg.cliente_id
    left join usuarios u on u.id = cl.vendedor_asignado_id
    left join empresas e on e.id = pg.empresa_id
    where pg.fecha_pago between p_desde and p_hasta
      and (pg.empresa_id is null or pg.empresa_id = any((select public.empresas_visibles())::uuid[]))
    union all
    select 'profit:' || ch.id::text, 'profit', ch.empresa_id, e.nombre_corto::text, ch.fecha, ch.numero, ch.cliente_id,
           coalesce(cl.nombre_negocio::text, ch.cliente_nombre), coalesce(cl.rif::text, ch.cliente_codigo),
           coalesce(nullif(trim(concat_ws(' ', u.nombre, u.apellido)), ''), nullif(trim(cl.vendedor_odoo), ''), 'Sin vendedor')::text,
           ch.cobrador_nombre, b.id, coalesce(b.nombre::text, ch.cuenta || ' (Profit)', 'Sin cuenta'), upper(coalesce(b.moneda::text, ch.moneda)),
           case ch.forma_pago when 'EFEC' then 'Efectivo' when 'TARJ' then 'Tarjeta' when 'DEPO' then 'Depósito o transferencia'
                else coalesce(nullif(trim(ch.forma_pago), ''), 'Sin forma de pago') end,
           ch.referencia, ch.moneda, ch.monto, ch.usd_origen,
           case when ch.fecha >= e.odoo_arranque then 'posterior_arranque' else 'vigente' end
    from cobros_historicos ch
    left join bancos b on b.id = ch.banco_id
    left join clientes cl on cl.id = ch.cliente_id
    left join usuarios u on u.id = cl.vendedor_asignado_id
    left join empresas e on e.id = ch.empresa_id
    where ch.fecha between p_desde and p_hasta
      and ch.empresa_id = any((select public.empresas_visibles())::uuid[])
  )
  select x.ref, x.fuente, x.empresa_id, x.empresa, x.fecha, x.numero, x.cliente_id, x.cliente, x.rif, x.vendedor, x.cobrador, x.banco_id,
         x.diario, x.diario_moneda, x.forma, x.referencia, x.moneda, x.monto_moneda, t.tasa,
         case when t.tasa is null then null when coalesce(t.fuente, '') ~* 'profit' then 'profit' else 'bcv' end,
         case when x.moneda = 'BS' then coalesce(round(x.monto_moneda / nullif(t.tasa, 0), 2), x.usd_origen) else x.monto_moneda end,
         x.usd_origen, x.estado,
         case x.estado
           when 'anulado' then case when x.fuente = 'odoo' then 'Anulado en Odoo' else 'Anulado en GUDS' end
           when 'borrador' then 'En borrador en Odoo (no publicado)'
           when 'por_verificar' then 'Reportado en GUDS y aún sin verificar'
           when 'igtf' then 'IGTF: impuesto cobrado aparte, no abona a la deuda'
           when 'saldo_inicial' then 'Anticipo de saldo inicial migrado a Odoo antes de su arranque: ese dinero ya está en los recibos de Profit'
           when 'posterior_arranque' then 'Recibo de Profit con fecha posterior al arranque de Odoo: desde el arranque los cobros salen de Odoo'
         end
  from base x
  left join lateral (
    select tb.tasa, tb.fuente from tasa_bcv tb
     where x.moneda = 'BS' and tb.fecha <= x.fecha and tb.tasa > 0
     order by tb.fecha desc, (coalesce(tb.fuente, '') ~* 'respaldo'), tb.created_at
     limit 1) t on true
$$;
revoke execute on function public.cobros_unificados(date, date) from public, anon, authenticated;

-- 5. Resumen de cobranza sobre la fuente única (mismas columnas de antes) ------------------------------------------------
create or replace function public.reporte_cobranza(p_desde date, p_hasta date, p_agrupar text)
returns table(clave text, etiqueta text, detalle text, cobros bigint, clientes bigint, monto_usd numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if p_agrupar = 'cliente' then perform public.exigir_permiso_reportes_cuentas(); else perform public.exigir_permiso_reportes(); end if;  -- 22e: por cliente exige también Cuentas
  return query
  with c as (
    select u.*,
           case p_agrupar when 'mes' then to_char(u.fecha, 'YYYY-MM') when 'metodo' then u.forma
                          when 'banco' then coalesce(u.banco_id::text, 'cuenta:' || coalesce(u.empresa_id::text, '') || ':' || u.diario)
                          when 'cliente' then coalesce(u.cliente_id::text, 'profit:' || coalesce(u.empresa_id::text, '') || ':' || coalesce(u.rif, u.cliente, ''))
                          when 'vendedor' then u.vendedor else coalesce(u.empresa_id::text, 'compartido') end k,
           coalesce(u.cliente_id::text, 'profit:' || coalesce(u.rif, u.cliente, '')) kc
    from public.cobros_unificados(p_desde, p_hasta) u
    where u.estado = 'vigente'
  )
  select c.k,
         case p_agrupar when 'banco' then max(c.diario) when 'cliente' then coalesce(max(c.cliente), '—')
                        when 'empresa' then coalesce(max(c.empresa), 'Compartido') else c.k end::text,
         case p_agrupar when 'banco' then max(c.diario_moneda) when 'cliente' then max(concat_ws(' · ', c.rif, cl.ciudad)) else null end::text,
         count(*), count(distinct c.kc), round(sum(c.usd), 2)
  from c left join clientes cl on cl.id = c.cliente_id
  group by c.k
  order by case when p_agrupar = 'mes' then c.k end, 6 desc nulls last;
end $$;

-- 6. Lo cobrado: matrices (fila × mes × moneda) y detalle ---------------------------------------------------------------
-- p_filas: diario · moneda · forma · vendedor · empresa · fuente (solo vigentes) · estado (todos: explica lo que no cuenta)
-- · cliente (exige también Cuentas). Varias agrupaciones en una sola llamada: los cobros se calculan una vez.
drop function if exists public.reporte_cobranza_matrices(date, date, text[]);
create function public.reporte_cobranza_matrices(p_desde date, p_hasta date, p_filas text[])
returns table(agrupacion text, fila text, etiqueta text, detalle text, empresa text, mes text, moneda text, cobros bigint, monto_moneda numeric, usd numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if p_filas is null or cardinality(p_filas) = 0
     or not (p_filas <@ array['diario', 'moneda', 'forma', 'vendedor', 'empresa', 'fuente', 'estado', 'cliente']::text[]) then
    raise exception 'Agrupación no válida: %', array_to_string(p_filas, ', ') using errcode = '22023';
  end if;
  if 'cliente' = any(p_filas) then perform public.exigir_permiso_reportes_cuentas(); else perform public.exigir_permiso_reportes(); end if;
  return query
  with u as materialized (select * from public.cobros_unificados(p_desde, p_hasta))
  select g.f, x.k, max(x.et), max(x.det), max(x.emp), to_char(x.fecha, 'YYYY-MM'), x.moneda, count(*), round(sum(x.monto_moneda), 2), round(sum(x.usd), 2)
  from (select distinct unnest(p_filas) f) g
  cross join lateral (
    select u.fecha, u.moneda, u.monto_moneda, u.usd, u.empresa emp,
           case g.f when 'diario' then coalesce(u.banco_id::text, 'cuenta:' || coalesce(u.empresa_id::text, '') || ':' || u.diario)
                    when 'moneda' then u.moneda when 'forma' then u.forma when 'vendedor' then u.vendedor
                    when 'empresa' then coalesce(u.empresa_id::text, 'compartido') when 'fuente' then u.fuente when 'estado' then u.estado
                    else coalesce(u.cliente_id::text, 'profit:' || coalesce(u.empresa_id::text, '') || ':' || coalesce(u.rif, u.cliente, '')) end k,
           case g.f when 'diario' then u.diario when 'moneda' then case u.moneda when 'BS' then 'Bolívares' else 'Dólares' end
                    when 'forma' then u.forma when 'vendedor' then u.vendedor when 'empresa' then coalesce(u.empresa, 'Compartido')
                    when 'fuente' then case u.fuente when 'odoo' then 'Odoo' when 'profit' then 'Profit' else 'GUDS' end
                    when 'estado' then u.estado else coalesce(u.cliente, '—') end et,
           case g.f when 'diario' then u.diario_moneda when 'cliente' then u.rif when 'estado' then u.motivo end det
    from u
    where g.f = 'estado' or u.estado = 'vigente'
  ) x
  group by g.f, x.k, to_char(x.fecha, 'YYYY-MM'), x.moneda
  order by 1, 2, 6, 7;
end $$;
revoke execute on function public.reporte_cobranza_matrices(date, date, text[]) from public, anon;
grant execute on function public.reporte_cobranza_matrices(date, date, text[]) to authenticated;

-- Una sola agrupación (misma lógica)
drop function if exists public.reporte_cobranza_matriz(date, date, text);
create function public.reporte_cobranza_matriz(p_desde date, p_hasta date, p_filas text)
returns table(fila text, etiqueta text, detalle text, empresa text, mes text, moneda text, cobros bigint, monto_moneda numeric, usd numeric)
language sql stable security definer set search_path = public as $$
  select m.fila, m.etiqueta, m.detalle, m.empresa, m.mes, m.moneda, m.cobros, m.monto_moneda, m.usd
  from public.reporte_cobranza_matrices(p_desde, p_hasta, array[p_filas]) m
$$;
revoke execute on function public.reporte_cobranza_matriz(date, date, text) from public, anon;
grant execute on function public.reporte_cobranza_matriz(date, date, text) to authenticated;

-- Detalle de cada cobro (con cliente: exige reportes y cuentas), incluidos los que no cuentan y por qué
create or replace function public.reporte_cobros_detalle(p_desde date, p_hasta date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_permiso_reportes_cuentas();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'ref', u.ref, 'fuente', u.fuente, 'empresa', u.empresa, 'fecha', u.fecha, 'numero', u.numero, 'cliente_id', u.cliente_id,
             'cliente', u.cliente, 'rif', u.rif, 'vendedor', u.vendedor, 'cobrador', u.cobrador, 'diario', u.diario, 'forma', u.forma,
             'referencia', u.referencia, 'moneda', u.moneda, 'monto', u.monto_moneda, 'tasa', u.tasa, 'tasa_origen', u.tasa_origen,
             'usd', u.usd, 'usd_origen', u.usd_origen, 'estado', u.estado, 'motivo', u.motivo)
           order by u.fecha, u.empresa, u.numero)
    from public.cobros_unificados(p_desde, p_hasta) u), '[]'::jsonb);
end $$;
revoke execute on function public.reporte_cobros_detalle(date, date) from public, anon;
grant execute on function public.reporte_cobros_detalle(date, date) to authenticated;

-- 7. Portal y resumen del vendedor: la fecha del cobro ------------------------------------------------------------------
do $$
declare f regprocedure; v_def text; v_nuevo text;
begin
  foreach f in array array['public.factura_portal(uuid)'::regprocedure, 'public.resumen_vendedor(boolean)'::regprocedure] loop
    v_def := pg_get_functiondef(f);
    v_nuevo := replace(v_def, '(p.created_at at time zone ''America/Caracas'')::date', 'p.fecha_pago');
    if v_nuevo <> v_def then execute v_nuevo; end if;
  end loop;
end $$;

commit;
