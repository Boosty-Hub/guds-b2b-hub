-- ════════════════════════════════════════════════════════════════════════
-- Fase 20q · R7: comparativos y metas en Reportes (docs/privado/planes/plan-reportes.md R7; decisiones del 28-sep: metas
-- por vendedor y mes en USD; venta neta sin ND cambiarias, reversos neteados y NC financieras aparte)
--
--   · periodo_comparacion(desde, hasta, tipo): el período con el que se compara.
--       anterior     → si el período son meses completos, los mismos meses justo antes (un año → el año anterior); si no,
--                      el mismo número de días justo antes (la misma regla que la pestaña Ventas).
--       anio_anterior → las mismas fechas un año antes (29-feb → 28-feb).
--   · reporte_ventas_comparativo(desde, hasta, agrupar, fuente): la venta de reporte_ventas en el período, en el anterior y en
--     el mismo período del año anterior, con la variación en USD y en %, por empresa, vendedor, cliente, categoría o
--     producto. Cada cifra es exactamente la de reporte_ventas en su período (el histórico de Profit suma igual que allí).
--   · dias_habiles(desde, hasta): lunes a viernes entre dos fechas, inclusive (sin feriados).
--   · reporte_metas_vendedores(desde, hasta): meta de cada vendedor por mes contra su venta real, con la misma definición
--     que resumen_vendedor (documentos de venta netos de IVA de los clientes asignados, empresas visibles), % de
--     cumplimiento, brecha y, en el mes en curso, la proyección de cierre = venta ÷ días hábiles transcurridos (incluido
--     hoy) × días hábiles del mes. Solo con el permiso de reportes.
-- ════════════════════════════════════════════════════════════════════════
begin;

create or replace function public.periodo_comparacion(p_desde date, p_hasta date, p_tipo text)
returns table(desde date, hasta date) language plpgsql immutable set search_path = public as $$
declare v_meses integer; v_dias integer;
begin
  if p_desde is null or p_hasta is null or p_desde > p_hasta then
    raise exception 'Período no válido' using errcode = '22023';
  end if;
  if p_tipo = 'anio_anterior' then
    return query select (p_desde - interval '1 year')::date, (p_hasta - interval '1 year')::date;
    return;
  elsif p_tipo = 'anterior' then
    if extract(day from p_desde) = 1 and p_hasta = (date_trunc('month', p_hasta) + interval '1 month - 1 day')::date then
      v_meses := (extract(year from p_hasta)::int - extract(year from p_desde)::int) * 12 + extract(month from p_hasta)::int - extract(month from p_desde)::int + 1;
      return query select (p_desde - make_interval(months => v_meses))::date, p_desde - 1;
      return;
    end if;
    v_dias := p_hasta - p_desde + 1;
    return query select p_desde - v_dias, p_desde - 1;
    return;
  else
    raise exception 'Comparación no válida: % (anterior o anio_anterior)', p_tipo using errcode = '22023';
  end if;
end $$;
revoke execute on function public.periodo_comparacion(date, date, text) from public, anon;
grant execute on function public.periodo_comparacion(date, date, text) to authenticated;

create or replace function public.reporte_ventas_comparativo(p_desde date, p_hasta date, p_agrupar text default 'empresa', p_fuente text default 'ambas')
returns table(clave text, etiqueta text, detalle text,
              actual_usd numeric, anterior_usd numeric, anio_anterior_usd numeric,
              var_anterior_usd numeric, var_anterior_pct numeric, var_anio_usd numeric, var_anio_pct numeric,
              facturas_actual bigint, facturas_anterior bigint, facturas_anio_anterior bigint,
              bruto_actual_usd numeric, bruto_anterior_usd numeric, bruto_anio_anterior_usd numeric,
              profit_actual_usd numeric, profit_anterior_usd numeric, profit_anio_anterior_usd numeric,
              fuente text, anterior_desde date, anterior_hasta date, anio_desde date, anio_hasta date)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_ad date; v_ah date; v_yd date; v_yh date;
  v_conteos boolean;
begin
  perform public.exigir_permiso_reportes();
  if p_agrupar not in ('empresa', 'vendedor', 'cliente', 'categoria', 'producto') then
    raise exception 'Agrupación no válida para comparar: % (empresa, vendedor, cliente, categoria o producto)', p_agrupar using errcode = '22023';
  end if;
  select x.desde, x.hasta into v_ad, v_ah from public.periodo_comparacion(p_desde, p_hasta, 'anterior') x;
  select x.desde, x.hasta into v_yd, v_yh from public.periodo_comparacion(p_desde, p_hasta, 'anio_anterior') x;
  v_conteos := p_agrupar not in ('categoria', 'producto');
  return query
  with a as (select * from public.reporte_ventas(p_desde, p_hasta, p_agrupar, p_fuente, v_conteos)),
       p as (select * from public.reporte_ventas(v_ad, v_ah, p_agrupar, p_fuente, v_conteos)),
       y as (select * from public.reporte_ventas(v_yd, v_yh, p_agrupar, p_fuente, v_conteos)),
       k as (select a.clave from a union select p.clave from p union select y.clave from y)
  select k.clave, coalesce(a.etiqueta, p.etiqueta, y.etiqueta), coalesce(a.detalle, p.detalle, y.detalle),
         coalesce(a.neto_usd, 0), coalesce(p.neto_usd, 0), coalesce(y.neto_usd, 0),
         coalesce(a.neto_usd, 0) - coalesce(p.neto_usd, 0),
         case when coalesce(p.neto_usd, 0) <> 0 then round(100 * (coalesce(a.neto_usd, 0) - p.neto_usd) / abs(p.neto_usd), 2) end,
         coalesce(a.neto_usd, 0) - coalesce(y.neto_usd, 0),
         case when coalesce(y.neto_usd, 0) <> 0 then round(100 * (coalesce(a.neto_usd, 0) - y.neto_usd) / abs(y.neto_usd), 2) end,
         a.documentos, p.documentos, y.documentos,
         coalesce(a.bruto_usd, 0), coalesce(p.bruto_usd, 0), coalesce(y.bruto_usd, 0),
         coalesce(a.profit_usd, 0), coalesce(p.profit_usd, 0), coalesce(y.profit_usd, 0),
         case when (a.fuente in ('profit', 'ambas') or p.fuente in ('profit', 'ambas') or y.fuente in ('profit', 'ambas'))
                   and (coalesce(a.fuente, '') in ('odoo', 'ambas') or coalesce(p.fuente, '') in ('odoo', 'ambas') or coalesce(y.fuente, '') in ('odoo', 'ambas')) then 'ambas'
              when a.fuente in ('profit', 'ambas') or p.fuente in ('profit', 'ambas') or y.fuente in ('profit', 'ambas') then 'profit'
              else 'odoo' end,
         v_ad, v_ah, v_yd, v_yh
  from k
  left join a on a.clave = k.clave
  left join p on p.clave = k.clave
  left join y on y.clave = k.clave
  order by 4 desc, 5 desc, 6 desc;
end $$;
revoke execute on function public.reporte_ventas_comparativo(date, date, text, text) from public, anon;
grant execute on function public.reporte_ventas_comparativo(date, date, text, text) to authenticated;

create or replace function public.dias_habiles(p_desde date, p_hasta date) returns integer language sql immutable set search_path = public as $$
  select coalesce(count(*), 0)::int from generate_series(p_desde, p_hasta, interval '1 day') d where extract(isodow from d) < 6;
$$;
revoke execute on function public.dias_habiles(date, date) from public, anon;
grant execute on function public.dias_habiles(date, date) to authenticated;

-- Metas por vendedor y mes contra la venta real (definición de resumen_vendedor)
create or replace function public.reporte_metas_vendedores(p_desde date, p_hasta date)
returns table(vendedor_id uuid, vendedor text, email text, activo boolean, clientes bigint, anio integer, mes integer, desde date, hasta date,
              meta_usd numeric, venta_usd numeric, facturas bigint, cumplimiento_pct numeric, brecha_usd numeric,
              en_curso boolean, dias_habiles integer, dias_transcurridos integer, proyeccion_usd numeric, proyeccion_pct numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_visibles uuid[];
  v_hoy date := (now() at time zone 'America/Caracas')::date;
  v_ini date;
  v_fin date;
begin
  perform public.exigir_permiso_reportes();
  if p_desde is null or p_hasta is null or p_desde > p_hasta then
    raise exception 'Período no válido' using errcode = '22023';
  end if;
  v_ini := date_trunc('month', p_desde)::date;
  v_fin := (date_trunc('month', p_hasta) + interval '1 month - 1 day')::date;
  if (extract(year from v_fin)::int - extract(year from v_ini)::int) * 12 + extract(month from v_fin)::int - extract(month from v_ini)::int >= 36 then
    raise exception 'Las metas se consultan por períodos de hasta 36 meses' using errcode = '22023';
  end if;
  v_visibles := public.empresas_visibles();
  return query
  with meses as (
    select m::date m_ini, (m + interval '1 month - 1 day')::date m_fin from generate_series(v_ini, v_fin, interval '1 month') m
  ), ven as (
    select c.vendedor_asignado_id vid, date_trunc('month', d.fecha)::date m_ini, sum(d.neto_usd) neto, count(*) filter (where d.tipo = 'factura') facturas
    from public.documentos_venta(v_ini, v_fin) d join clientes c on c.id = d.cliente_id
    where c.vendedor_asignado_id is not null
    group by 1, 2
  ), met as (
    select m.vendedor_id vid, make_date(m.anio, m.mes, 1) m_ini, sum(m.meta_ventas) meta
    from metas_vendedor m
    where make_date(m.anio, m.mes, 1) between v_ini and v_fin and coalesce(m.meta_ventas, 0) > 0
      and (m.empresa_id is null or m.empresa_id = any(v_visibles))
    group by 1, 2
  ), cli as (
    select c.vendedor_asignado_id vid, count(*) n from clientes c
    where c.activo and c.vendedor_asignado_id is not null and (c.empresa_id is null or c.empresa_id = any(v_visibles))
    group by 1
  ), vend as (
    select u.id, btrim(concat_ws(' ', u.nombre, u.apellido)) nombre, u.email::text email, coalesce(u.activo, true) activo
    from usuarios u
    where u.role = 'vendedor'
      and (exists (select 1 from met where met.vid = u.id) or exists (select 1 from ven where ven.vid = u.id))
  ), filas as (
    select v.id, v.nombre, v.email, v.activo, coalesce(cli.n, 0) clientes, ms.m_ini, ms.m_fin,
           round(coalesce(met.meta, 0), 2) meta, round(coalesce(ven.neto, 0), 2) venta, coalesce(ven.facturas, 0) facturas,
           v_hoy between ms.m_ini and ms.m_fin en_curso,
           public.dias_habiles(ms.m_ini, ms.m_fin) dh,
           case when v_hoy between ms.m_ini and ms.m_fin then public.dias_habiles(ms.m_ini, v_hoy)
                when v_hoy > ms.m_fin then public.dias_habiles(ms.m_ini, ms.m_fin) else 0 end dt
    from vend v cross join meses ms
    left join met on met.vid = v.id and met.m_ini = ms.m_ini
    left join ven on ven.vid = v.id and ven.m_ini = ms.m_ini
    left join cli on cli.vid = v.id
  )
  select f.id, f.nombre, f.email, f.activo, f.clientes, extract(year from f.m_ini)::int, extract(month from f.m_ini)::int, f.m_ini, f.m_fin,
         f.meta, f.venta, f.facturas,
         case when f.meta > 0 then round(100 * f.venta / f.meta, 2) end,
         case when f.meta > 0 then round(f.meta - f.venta, 2) end,
         f.en_curso, f.dh, f.dt,
         case when f.en_curso and f.dt > 0 then round(f.venta / f.dt * f.dh, 2) when not f.en_curso and f.dt > 0 then f.venta end,
         case when f.meta > 0 and f.dt > 0 then round(100 * (case when f.en_curso then f.venta / f.dt * f.dh else f.venta end) / f.meta, 2) end
  from filas f
  order by f.m_ini, f.venta desc, f.nombre;
end $$;
revoke execute on function public.reporte_metas_vendedores(date, date) from public, anon;
grant execute on function public.reporte_metas_vendedores(date, date) to authenticated;

notify pgrst, 'reload schema';

commit;
