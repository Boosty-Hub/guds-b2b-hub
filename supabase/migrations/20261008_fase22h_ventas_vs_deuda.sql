-- ════════════════════════════════════════════════════════════════════════
-- Fase 22h · R4 del plan de reportes de finanzas (docs/PLAN-REPORTES-FINANZAS.md): Ventas vs deuda y días de recuperación
-- oficiales (D6).
--
--   Días de recuperación = deuda neta al corte ÷ venta promedio mensual de los últimos 12 meses (con IVA, Profit + Odoo) × 30.
--     · Deuda neta = facturas y ND con saldo − NC a favor − anticipos sin aplicar (partidas_cobranza, la de la Antigüedad) y,
--       con el interruptor, + notas de entrega con saldo. Las notas de entrega nunca cuentan como venta.
--     · Venta con IVA = todos los documentos fiscales del período: en Profit, los del histórico (facturas, devoluciones, notas
--       financieras, ND cambiarias y reversos, como el Excel de finanzas); en Odoo, facturas, NC y ND sin saldos iniciales.
--     · Cliente con menos de 12 meses: el promedio se divide entre los meses desde su primera compra.
--   1. ventas_con_iva(desde, hasta, empresas): una fila por documento con su venta con IVA (interna).
--   2. recuperacion_calculo(corte, empresas, ne, clientes): deuda neta, venta de 12/5/3 meses, promedio y días por cliente.
--   3. metricas_cobranza agrega a cada cliente sus días de recuperación (hoy y al cierre del mes anterior) y la regla; el DSO
--      de 90 días queda como "tendencia". alertas_cobranza cuenta los clientes sobre el umbral de recuperación
--      (configuracion.cobranza_recuperacion_alerta_dias). reporte_dso suma también los días de recuperación.
--   4. reporte_ventas_vs_deuda(corte, meses, ne): cliente × mes con IVA, promedios, compra de 90 días, deuda y días, en JSON
--      (exige reportes y cuentas, D10).
-- ════════════════════════════════════════════════════════════════════════
begin;

-- 1. Venta con IVA por documento ------------------------------------------------------------------------------------------
create or replace function public.ventas_con_iva(p_desde date, p_hasta date, p_empresas uuid[])
returns table (empresa_id uuid, cliente_id uuid, cliente_clave text, cliente_nombre text, fecha date, venta_usd numeric, fuente text)
language sql stable security definer set search_path = public
as $$
  select d.empresa_id, d.cliente_id,
         coalesce(d.cliente_id::text, 'profit:' || d.empresa_id::text || ':' || coalesce(d.cliente_codigo, '')),
         d.cliente_nombre, d.fecha, d.total_usd, 'profit'
    from profit_documentos d
   where d.lote = public.profit_lote_vigente() and d.empresa_id = any (p_empresas) and d.fecha between p_desde and p_hasta
  union all
  select f.empresa_id, f.cliente_id, f.cliente_id::text, null, f.fecha_emision, f.total_usd, 'odoo'
    from facturas f
   where f.estado = 'posted' and not coalesce(f.es_saldo_inicial, false) and f.empresa_id = any (p_empresas)
     and f.fecha_emision between p_desde and p_hasta and f.cliente_id is not null
$$;
comment on function public.ventas_con_iva(date, date, uuid[]) is
  'Venta con IVA por documento (22h, D6): Profit (todo el histórico, como el Excel de finanzas) + Odoo (facturas, NC y ND sin saldos iniciales). Interna';
revoke execute on function public.ventas_con_iva(date, date, uuid[]) from public, anon, authenticated;

-- 2. Días de recuperación por cliente a un corte (D6) -------------------------------------------------------------------
create or replace function public.recuperacion_calculo(p_corte date, p_empresas uuid[], p_ne boolean default true, p_clientes uuid[] default null)
returns table (cliente_id uuid, empresa_id uuid, deuda_fiscal numeric, notas_entrega numeric, deuda numeric, impuesto numeric,
  venta_12m numeric, meses integer, promedio numeric, dias integer, venta_5m numeric, compra_90d numeric, primera_compra date, ultima_compra date)
language sql stable security definer set search_path = public
as $$
  with
  p as (
    select x.cliente_id, x.empresa_id,
           coalesce(sum(x.saldo_usd) filter (where x.tipo <> 'nota_entrega'), 0) fiscal,
           coalesce(sum(x.saldo_usd) filter (where x.tipo = 'nota_entrega'), 0) ne,
           coalesce(sum(x.saldo_usd) filter (where x.clase in ('retencion', 'impuesto')), 0) imp
      from public.partidas_cobranza(p_corte, p_empresas, p_ne) x
     where x.cliente_id is not null and (p_clientes is null or x.cliente_id = any (p_clientes))
     group by 1, 2
  ),
  v as (
    select x.cliente_id, x.empresa_id,
           sum(x.venta_usd) v12,
           coalesce(sum(x.venta_usd) filter (where x.fecha > (p_corte - interval '5 months')::date), 0) v5,
           coalesce(sum(x.venta_usd) filter (where x.fecha > (p_corte - interval '3 months')::date), 0) v3,
           max(x.fecha) filter (where x.venta_usd > 0) ultima
      from public.ventas_con_iva((p_corte - interval '12 months')::date + 1, p_corte, p_empresas) x
     where x.cliente_id is not null and (p_clientes is null or x.cliente_id = any (p_clientes))
     group by 1, 2
  ),
  c as (
    select coalesce(p.cliente_id, v.cliente_id) cliente_id, coalesce(p.empresa_id, v.empresa_id) empresa_id,
           coalesce(p.fiscal, 0) fiscal, coalesce(p.ne, 0) ne, coalesce(p.imp, 0) imp,
           coalesce(v.v12, 0) v12, coalesce(v.v5, 0) v5, coalesce(v.v3, 0) v3, v.ultima
      from p full join v on v.cliente_id = p.cliente_id
  ),
  -- Primera compra (Profit u Odoo, incluidas las facturas migradas como saldo inicial, que conservan su fecha)
  pc as (
    select y.cliente_id, min(y.f) primera from (
      select d.cliente_id, min(d.fecha) f from profit_documentos d
       where d.lote = public.profit_lote_vigente() and d.tipo = 'factura' and d.cliente_id in (select cliente_id from c) group by 1
      union all
      select f.cliente_id, min(f.fecha_emision) from facturas f
       where f.estado = 'posted' and f.tipo = 'factura' and f.cliente_id in (select cliente_id from c) group by 1
    ) y group by 1
  )
  select c.cliente_id, c.empresa_id, round(c.fiscal, 2), round(c.ne, 2), round(c.fiscal + c.ne, 2), round(c.imp, 2),
         round(c.v12, 2), m.meses, round(c.v12 / m.meses, 2),
         case when c.fiscal + c.ne <= 0.009 then 0
              when c.v12 > 0.009 then round((c.fiscal + c.ne) / (c.v12 / m.meses) * 30)::integer end,
         round(c.v5, 2), round(c.v3, 2), pc.primera, c.ultima
    from c
    left join pc on pc.cliente_id = c.cliente_id
    cross join lateral (
      select greatest(1, least(12, case when pc.primera is null then 12
               else (extract(year from p_corte)::int * 12 + extract(month from p_corte)::int)
                  - (extract(year from pc.primera)::int * 12 + extract(month from pc.primera)::int) + 1 end))::integer meses) m
$$;
comment on function public.recuperacion_calculo(date, uuid[], boolean, uuid[]) is
  'Días de recuperación por cliente al corte (22h, D6): deuda neta ÷ venta promedio mensual de 12 meses (con IVA) × 30; clientes nuevos: meses desde la primera compra. dias nulo = con deuda y sin venta (en recuperación). Interna';
revoke execute on function public.recuperacion_calculo(date, uuid[], boolean, uuid[]) from public, anon, authenticated;

-- Umbral de la torre de control con la fórmula nueva (antes: DSO de 90 días > 60)
insert into public.configuracion (clave, valor, tipo, descripcion)
values ('cobranza_recuperacion_alerta_dias', '90', 'number',
        'Días de recuperación (deuda neta ÷ venta promedio mensual de 12 meses × 30) desde los que un cliente sale como alerta en la torre de control y en Cuentas (22h)')
on conflict (clave) do nothing;

-- 3. Métricas de cobranza con los días de recuperación ------------------------------------------------------------------
create or replace function public.metricas_cobranza(p_dias integer default null, p_cliente_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_clientes uuid[];
  v_dias integer := case when p_dias is null then public.config_entero('cobranza_dso_ventana_dias', 90, 7, 730)
                         else least(greatest(p_dias, 7), 730) end;
  v_hoy date := (now() at time zone 'America/Caracas')::date;
  v_ant date := (date_trunc('month', (now() at time zone 'America/Caracas')) - interval '1 day')::date;
  v_emps uuid[] := public.empresas_visibles();
  v_ne boolean := public.puede('notas_entrega', 'ver');
begin
  if auth.uid() is null then raise exception 'No autenticado' using errcode = '42501'; end if;
  if public.es_personal_admin() and public.puede('cuentas', 'ver') then
    v_clientes := case when p_cliente_id is not null then array[p_cliente_id] end;
  elsif exists (select 1 from usuarios u where u.auth_id = auth.uid() and u.role = 'vendedor') then
    select array_agg(x) into v_clientes from public.mis_clientes_vendedor() x where p_cliente_id is null or x = p_cliente_id;
    v_clientes := coalesce(v_clientes, '{}'::uuid[]);
  else
    raise exception 'No tienes permiso para ver las métricas de cobranza' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'dias', v_dias,
    'alerta_dso', public.config_entero('cobranza_dso_alerta_dias', 60, 1, 3650),
    -- 22h (D6): días de recuperación, la medida oficial; el DSO de la ventana queda como tendencia
    'alerta_recuperacion', public.config_entero('cobranza_recuperacion_alerta_dias', 90, 1, 3650),
    'recuperacion_ne', v_ne,
    'corte_ant', v_ant,
    'clientes', coalesce((
      with r as materialized (select * from public.recuperacion_calculo(v_hoy, v_emps, v_ne, v_clientes)),
           ra as materialized (select * from public.recuperacion_calculo(v_ant, v_emps, v_ne, v_clientes))
      -- También los clientes que solo deben en la deuda neta (p. ej. solo notas de entrega) o que compraron en 12 meses: así Cuentas
      -- cuenta lo mismo que la torre y la suma de un vendedor da lo mismo que reporte_dso
      select jsonb_agg(coalesce(to_jsonb(m), jsonb_build_object('cliente_id', r.cliente_id, 'corte_ant', v_ant)) || jsonb_build_object(
               'dias_rec', r.dias, 'dias_rec_ant', ra.dias, 'rec_deuda', coalesce(r.deuda, 0), 'rec_ne', coalesce(r.notas_entrega, 0),
               'rec_venta', coalesce(r.venta_12m, 0), 'rec_meses', coalesce(r.meses, 12), 'rec_promedio', coalesce(r.promedio, 0),
               'incobrable', coalesce(g.clasificacion = 'incobrable', false)))
        from public.metricas_cobranza_calculo(v_clientes, v_dias) m
        full join r on r.cliente_id = m.cliente_id
        left join ra on ra.cliente_id = coalesce(m.cliente_id, r.cliente_id)
        left join cobranza_gestion g on g.cliente_id = coalesce(m.cliente_id, r.cliente_id) and g.factura_id is null
       where m.cliente_id is not null or r.deuda > 0.009 or r.venta_12m > 0.009), '[]'::jsonb));
end $$;

create or replace function public.alertas_cobranza()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_umbral integer := public.config_entero('cobranza_dso_alerta_dias', 60, 1, 3650);
  v_umbral_rec integer := public.config_entero('cobranza_recuperacion_alerta_dias', 90, 1, 3650);
  v jsonb;
begin
  if not (public.es_personal_admin() and public.puede('cuentas', 'ver')) then
    return jsonb_build_object('umbral', v_umbral, 'dso_alto', 0, 'sobre_limite', 0, 'umbral_recuperacion', v_umbral_rec,
                              'recuperacion_alta', 0, 'sin_compras', 0);
  end if;
  select jsonb_build_object('umbral', v_umbral,
           'dso_alto', count(*) filter (where m.deuda > 0.009 and (m.dso > v_umbral or (m.dso is null and m.vencido > 0.009))),
           'sobre_limite', count(*) filter (where m.sobre_limite))
    into v from public.metricas_cobranza_calculo(null, null) m;
  -- 22h (D6), sin contar los incobrables (ya están en gestión): días de recuperación sobre el umbral, y con deuda (más de
  -- USD 1) sin compras en 12 meses ("en recuperación" en el Excel de finanzas)
  select v || jsonb_build_object('umbral_recuperacion', v_umbral_rec,
           'recuperacion_alta', count(*) filter (where r.deuda > 1 and r.dias > v_umbral_rec and coalesce(g.clasificacion, 'activa') <> 'incobrable'),
           'sin_compras', count(*) filter (where r.deuda > 1 and r.dias is null and coalesce(g.clasificacion, 'activa') <> 'incobrable'))
    into v
    from public.recuperacion_calculo((now() at time zone 'America/Caracas')::date, public.empresas_visibles(),
                                     public.puede('notas_entrega', 'ver'), null) r
    left join cobranza_gestion g on g.cliente_id = r.cliente_id and g.factura_id is null;
  return v;
end $$;

-- reporte_dso: además de la tendencia de 90 días (DSO), los días de recuperación del grupo (Σ deuda neta ÷ Σ promedio × 30)
drop function if exists public.reporte_dso(integer, text);
create function public.reporte_dso(p_dias integer default null, p_agrupar text default 'vendedor')
returns table (clave text, etiqueta text, detalle text, clientes bigint, deuda numeric, vencido numeric, venta numeric, dso numeric,
  mora numeric, dso_ant numeric, a_favor_nc numeric, rec_deuda numeric, rec_promedio numeric, dias_rec numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_dias integer := case when p_dias is null then public.config_entero('cobranza_dso_ventana_dias', 90, 7, 730)
                         else least(greatest(p_dias, 7), 730) end;
begin
  perform public.exigir_permiso_reportes_cuentas();
  if p_agrupar not in ('vendedor', 'cliente') then raise exception 'Agrupación no válida' using errcode = '22023'; end if;
  return query
  with r as materialized (
    select * from public.recuperacion_calculo((now() at time zone 'America/Caracas')::date, public.empresas_visibles(),
                                              public.puede('notas_entrega', 'ver'), null)
  ), m as (
    select coalesce(m.cliente_id, r.cliente_id) cliente_id, coalesce(m.deuda, 0) deuda, coalesce(m.vencido, 0) vencido,
           coalesce(m.venta, 0) venta, m.mora, coalesce(m.venta_ant, 0) venta_ant, coalesce(m.deuda_ant, 0) deuda_ant,
           coalesce(m.a_favor_nc, 0) a_favor_nc, coalesce(r.deuda, 0) rec_deuda, coalesce(r.promedio, 0) rec_promedio
      from public.metricas_cobranza_calculo(null, v_dias) m
      full join r on r.cliente_id = m.cliente_id
  ), k as (
    select m.*, cl.nombre_negocio, cl.rif, cl.ciudad,
           case when p_agrupar = 'cliente' then m.cliente_id::text
                else coalesce(nullif(trim(concat_ws(' ', u.nombre, u.apellido)), ''), nullif(trim(cl.vendedor_odoo), ''), 'Sin vendedor') end k
      from m join clientes cl on cl.id = m.cliente_id
      left join usuarios u on u.id = cl.vendedor_asignado_id
  )
  select k.k,
         case when p_agrupar = 'cliente' then max(k.nombre_negocio) else k.k end::text,
         case when p_agrupar = 'cliente' then max(concat_ws(' · ', k.rif, k.ciudad)) end::text,
         count(*) filter (where k.deuda > 0.009),
         round(sum(k.deuda), 2), round(sum(k.vencido), 2), round(sum(k.venta), 2),
         case when sum(k.venta) > 0.009 and sum(k.deuda) > 0.009 then round(sum(k.deuda) / (sum(k.venta) / v_dias), 0) end,
         case when sum(k.deuda) > 0.009 then round(sum(k.mora * k.deuda) / sum(k.deuda), 0) end,
         case when sum(k.venta_ant) > 0.009 and sum(k.deuda_ant) > 0.009 then round(sum(k.deuda_ant) / (sum(k.venta_ant) / v_dias), 0) end,
         round(sum(k.a_favor_nc), 2), round(sum(k.rec_deuda), 2), round(sum(k.rec_promedio), 2),
         case when sum(k.rec_deuda) <= 0.009 then 0::numeric
              when sum(k.rec_promedio) > 0.009 then round(sum(k.rec_deuda) / sum(k.rec_promedio) * 30, 0) end
    from k
   group by k.k
  having sum(k.deuda) > 0.009 or sum(k.a_favor_nc) > 0.009 or abs(sum(k.rec_deuda)) > 0.009
   order by 5 desc nulls last;
end $$;
comment on function public.reporte_dso(integer, text) is
  'Cobranza por vendedor o cliente (21b, 22h): tendencia de la ventana (DSO, mora) y días de recuperación oficiales (D6). Exige reportes y cuentas';
revoke execute on function public.reporte_dso(integer, text) from public, anon;
grant execute on function public.reporte_dso(integer, text) to authenticated;

-- 4. Ventas vs deuda ------------------------------------------------------------------------------------------------------
create or replace function public.reporte_ventas_vs_deuda(p_corte date default null, p_meses integer default 12, p_ne boolean default true)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_hoy date := (now() at time zone 'America/Caracas')::date;
  v_corte date := least(coalesce(p_corte, (now() at time zone 'America/Caracas')::date), (now() at time zone 'America/Caracas')::date);
  v_inicio date := date '2020-12-01';   -- primer mes del histórico de Profit
  v_desde date;
  v_emps uuid[] := public.empresas_visibles();
  v_ve_ne boolean := public.puede('notas_entrega', 'ver');
  v_ne boolean := coalesce(p_ne, true) and public.puede('notas_entrega', 'ver');
  v jsonb;
begin
  perform public.exigir_permiso_reportes_cuentas();
  v_desde := case when coalesce(p_meses, 0) <= 0 then v_inicio
                  else greatest(v_inicio, (date_trunc('month', v_corte) - make_interval(months => least(p_meses, 120) - 1))::date) end;
  with
  r as materialized (select * from public.recuperacion_calculo(v_corte, v_emps, v_ne, null)),
  vm as materialized (
    select x.cliente_clave k, max(x.cliente_id::text)::uuid cliente_id, max(x.empresa_id::text)::uuid empresa_id, max(x.cliente_nombre) nombre,
           to_char(x.fecha, 'YYYY-MM') mes, sum(x.venta_usd) usd
      from public.ventas_con_iva(v_desde, v_corte, v_emps) x
     group by x.cliente_clave, to_char(x.fecha, 'YYYY-MM')
  ),
  vk as (
    select vm.k, max(vm.cliente_id::text)::uuid cliente_id, max(vm.empresa_id::text)::uuid empresa_id, max(vm.nombre) nombre,
           jsonb_object_agg(vm.mes, round(vm.usd, 2)) filter (where abs(vm.usd) >= 0.005) ventas, sum(vm.usd) total
      from vm group by vm.k
  ),
  -- Notas de entrega sin ficha en GUDS: deuda (no fiscal) por nombre, como el Excel de finanzas
  nesf as (
    select 'ne:' || n.empresa_id::text || ':' || public.clasif_norm(n.cliente_nombre) k, n.empresa_id, max(n.cliente_nombre) nombre,
           sum(n.total_usd - coalesce((select sum(m.monto_usd) from nota_entrega_movimientos m
                                        where m.nota_id = n.id and (m.fecha is null or m.fecha <= v_corte)), 0)) saldo
      from notas_entrega n
     where v_ne and n.cliente_id is null and n.empresa_id = any (v_emps) and n.estado not in ('borrador', 'anulada') and n.fecha_emision <= v_corte
     group by 1, 2
    having abs(sum(n.total_usd - coalesce((select sum(m.monto_usd) from nota_entrega_movimientos m
                                            where m.nota_id = n.id and (m.fecha is null or m.fecha <= v_corte)), 0))) > 0.009
  ),
  fichas as (
    select coalesce(r.cliente_id, vk.cliente_id) id from r full join vk on vk.cliente_id = r.cliente_id
     where coalesce(r.cliente_id, vk.cliente_id) is not null
  ),
  filas as (
    -- (un cliente compartido por las dos empresas no tiene empresa en su ficha: va la de sus ventas o su deuda)
    select c.id::text k, c.id cliente_id, coalesce(c.empresa_id, vk.empresa_id, r.empresa_id) empresa_id, c.nombre_negocio nombre, c.rif, c.codigo,
           coalesce(nullif(btrim(concat_ws(' ', u.nombre, u.apellido)), ''), nullif(btrim(c.vendedor_odoo), '')) vendedor,
           coalesce(nullif(btrim(c.tipo_cliente), ''), ct.tipo) tipo, coalesce(nullif(btrim(c.segmento), ''), ct.categoria_cobranza) cat,
           g.clasificacion clasif, vk.ventas, vk.total, r.deuda_fiscal, r.notas_entrega, r.deuda, r.impuesto, r.venta_12m, r.meses,
           r.promedio, r.dias, r.venta_5m, r.compra_90d, r.primera_compra, r.ultima_compra
      from fichas f join clientes c on c.id = f.id
      left join r on r.cliente_id = c.id
      left join vk on vk.cliente_id = c.id
      left join usuarios u on u.id = c.vendedor_asignado_id
      left join clasificacion_clientes cc on cc.cliente_id = c.id
      left join clasificacion_tipos ct on ct.id = cc.tipo_id
      left join cobranza_gestion g on g.cliente_id = c.id and g.factura_id is null
  )
  select jsonb_build_object(
    'hoy', v_hoy, 'corte', v_corte, 'desde', v_desde, 'ne', v_ne, 've_ne', v_ve_ne,
    'umbral', public.config_entero('cobranza_recuperacion_alerta_dias', 90, 1, 3650),
    'empresas', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'nombre', e.nombre_corto) order by e.nombre_corto)
                            from empresas e where e.id = any (v_emps)), '[]'::jsonb),
    'clientes', coalesce((select jsonb_agg(x order by (x->>'d')::numeric desc nulls last, x->>'n') from (
        select jsonb_strip_nulls(jsonb_build_object(
                 'k', f.k, 'id', f.cliente_id, 'n', f.nombre, 'rif', f.rif, 'cod', f.codigo, 'e', f.empresa_id, 'v', f.vendedor,
                 'tipo', f.tipo, 'cat', f.cat, 'cl', f.clasif, 'ventas', f.ventas, 'tot', round(f.total, 2),
                 'v12', f.venta_12m, 'm12', f.meses, 'prom', f.promedio, 'v5', f.venta_5m, 'c90', f.compra_90d,
                 'df', f.deuda_fiscal, 'ne', nullif(f.notas_entrega, 0), 'd', f.deuda, 'imp', nullif(f.impuesto, 0), 'dias', f.dias,
                 'pc', f.primera_compra, 'uc', f.ultima_compra)) x
          from filas f
        union all
        -- Clientes de Profit sin ficha en GUDS (solo ventas del histórico)
        select jsonb_strip_nulls(jsonb_build_object('k', vk.k, 'n', vk.nombre, 'e', vk.empresa_id, 'ventas', vk.ventas,
                 'tot', round(vk.total, 2), 'sf', true)) from vk where vk.cliente_id is null
        union all
        select jsonb_build_object('k', ne.k, 'n', ne.nombre, 'e', ne.empresa_id, 'ne', round(ne.saldo, 2), 'd', round(ne.saldo, 2),
                 'df', 0, 'sf', true) from nesf ne
      ) t), '[]'::jsonb))
    into v;
  return v;
end $$;
comment on function public.reporte_ventas_vs_deuda(date, integer, boolean) is
  'Ventas vs deuda (22h · R4): cliente × mes con IVA (Profit + Odoo), promedios de 12 y 5 meses, compra de 90 días, deuda neta y días de recuperación (D6), en JSON. Exige reportes y cuentas';
revoke execute on function public.reporte_ventas_vs_deuda(date, integer, boolean) from public, anon;
grant execute on function public.reporte_ventas_vs_deuda(date, integer, boolean) to authenticated;

commit;
