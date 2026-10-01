-- ════════════════════════════════════════════════════════════════════════
-- Fase 21b · Métricas internas de cobranza (plan de revisión 30-sep, fase 3). Solo para el equipo: no salen en el estado
-- de cuenta del cliente (ni en el enlace público, el PDF, el correo o el portal).
--   · DSO (días de venta adeudados) por cliente = deuda vigente ÷ venta promedio diaria de la ventana (90 días por
--     defecto; 30 o 180 a elección; configuracion.cobranza_dso_ventana_dias). Deuda vigente = saldo positivo de facturas y
--     notas de débito (la regla de Cuentas por Cobrar). Venta = documentos_venta (19o: sin saldos iniciales, sin ND
--     cambiarias, sin reversos totales) con IVA (total_usd, las NC restan), para comparar con una deuda que lleva IVA.
--     Sin venta en la ventana: DSO vacío ("sin ventas").
--   · Mora ponderada = Σ(saldo × días de vencida) ÷ deuda (lo por vencer cuenta 0 días).
--   · Tendencia: las mismas dos cifras al cierre del mes anterior, reconstruidas con las fechas de las aplicaciones (saldo
--     al corte = total − lo aplicado hasta esa fecha; verificado: hoy reproduce el saldo actual).
--   · Días promedio de pago (ponderado): de la emisión al cobro, de lo cobrado en la ventana.
--   · A favor por aplicar: notas de crédito con saldo (sin cruzar) aparte de la deuda, con la más antigua (punto 3.4).
--   · metricas_cobranza(dias, cliente): administración con 'cuentas' ver (empresas visibles) o el vendedor (su cartera).
--   · reporte_dso(dias, agrupar 'vendedor'|'cliente'): Reportes → Cobranza ('reportes' ver).
--   · nc_sin_aplicar(): listado de NC sin aplicar con antigüedad, para que finanzas las cruce en Odoo.
--   · alertas_cobranza(): para la torre de control: clientes con DSO sobre el umbral
--     (configuracion.cobranza_dso_alerta_dias, 60 por defecto; sin ventas en la ventana y con vencido también cuenta) y
--     clientes sobre su límite de crédito.
--   Nada de esto escribe en Odoo.
-- ════════════════════════════════════════════════════════════════════════
begin;

insert into public.configuracion (clave, valor, tipo, descripcion) values
  ('cobranza_dso_ventana_dias', '90', 'number', 'Cobranza: ventana (días) de venta promedio para el DSO por cliente (30, 90 o 180)'),
  ('cobranza_dso_alerta_dias', '60', 'number', 'Cobranza: la torre de control avisa de los clientes con DSO por encima de estos días')
on conflict (clave) do nothing;

create or replace function public.config_entero(p_clave text, p_defecto integer, p_min integer, p_max integer)
returns integer language sql stable security definer set search_path = public as $$
  select least(greatest(coalesce((select case when valor ~ '^\s*[0-9]+\s*$' then valor::integer end
                                    from configuracion where clave = p_clave), p_defecto), p_min), p_max)
$$;
revoke all on function public.config_entero(text, integer, integer, integer) from public, anon, authenticated;

-- ── Cálculo (interno) ──
-- Clientes del alcance (null = todos) × empresas visibles. Un renglón por cliente.
create or replace function public.metricas_cobranza_calculo(p_clientes uuid[], p_dias integer)
returns table(
  cliente_id uuid, deuda numeric, vencido numeric, docs integer, a_favor_nc numeric, nc_sin_aplicar integer, nc_mas_antigua date,
  venta numeric, dso numeric, mora numeric, deuda_ant numeric, venta_ant numeric, dso_ant numeric, mora_ant numeric,
  dias_pago numeric, limite numeric, sobre_limite boolean, tiene_correo boolean, corte_ant date
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_hoy date := (now() at time zone 'America/Caracas')::date;
  v_dias integer := coalesce(p_dias, public.config_entero('cobranza_dso_ventana_dias', 90, 7, 730));
  v_ant date := (date_trunc('month', (now() at time zone 'America/Caracas')) - interval '1 day')::date;
  v_emps uuid[] := public.empresas_visibles();
begin
  return query
  with cli as (
    select c.id, coalesce(c.limite_credito, 0) limite,
           (nullif(btrim(c.email), '') is not null
            or exists (select 1 from cliente_contactos k where k.cliente_id = c.id and coalesce(k.activo, true) and nullif(btrim(k.email), '') is not null)) correo
      from clientes c
     where p_clientes is null or c.id = any (p_clientes)
  ),
  fac as (
    select f.id, f.cliente_id, f.tipo, f.fecha_emision, f.fecha_vencimiento, f.total_usd, f.saldo_usd
      from facturas f join cli on cli.id = f.cliente_id
     where f.estado = 'posted' and (f.empresa_id is null or f.empresa_id = any (v_emps))
  ),
  hoy as (
    select f.cliente_id,
           sum(f.saldo_usd) filter (where f.saldo_usd > 0.009) deuda,
           sum(f.saldo_usd) filter (where f.saldo_usd > 0.009 and v_hoy - coalesce(f.fecha_vencimiento, f.fecha_emision, v_hoy) > 0) vencido,
           count(*) filter (where abs(f.saldo_usd) > 0.009) docs,
           sum(f.saldo_usd * greatest(v_hoy - coalesce(f.fecha_vencimiento, f.fecha_emision, v_hoy), 0)) filter (where f.saldo_usd > 0.009) mora_num,
           -sum(f.saldo_usd) filter (where f.saldo_usd < -0.009) nc,
           count(*) filter (where f.saldo_usd < -0.009) nc_n,
           min(f.fecha_emision) filter (where f.saldo_usd < -0.009) nc_min
      from fac f group by f.cliente_id
  ),
  -- Saldo al cierre del mes anterior: total − lo aplicado hasta esa fecha (Odoo + cobros y retenciones de GUDS)
  apl_ant as (
    select x.doc, sum(x.monto) monto from (
      select fa.factura_id doc, fa.monto_usd monto from factura_aplicaciones fa join fac f on f.id = fa.factura_id where fa.fecha <= v_ant
      union all
      select pf.factura_id, pf.monto_aplicado from pago_facturas pf join fac f on f.id = pf.factura_id join pagos p on p.id = pf.pago_id
       where p.estado = 'verificado' and coalesce(p.fecha_pago, (coalesce(p.fecha_verificacion, p.created_at) at time zone 'America/Caracas')::date) <= v_ant
      union all
      select ri.factura_id, ri.monto_aplicado from retencion_items ri join retenciones r on r.id = ri.retencion_id join fac f on f.id = ri.factura_id
       where r.estado = 'aprobado' and r.odoo_id is null and r.fecha <= v_ant
    ) x group by x.doc
  ),
  ant as (
    select s.cliente_id, sum(s.saldo) deuda, sum(s.saldo * greatest(v_ant - s.vence, 0)) mora_num
      from (select f.cliente_id, f.total_usd - coalesce(a.monto, 0) saldo, coalesce(f.fecha_vencimiento, f.fecha_emision) vence
              from fac f left join apl_ant a on a.doc = f.id
             where f.tipo = 'factura' and f.fecha_emision <= v_ant) s
     where s.saldo > 0.009
     group by s.cliente_id
  ),
  ven as (
    select d.cliente_id,
           sum(f.total_usd) filter (where d.fecha > v_hoy - v_dias) venta,
           sum(f.total_usd) filter (where d.fecha > v_ant - v_dias and d.fecha <= v_ant) venta_ant
      from public.documentos_venta(least(v_hoy, v_ant) - v_dias + 1, v_hoy) d
      join facturas f on f.id = d.id
      join cli on cli.id = d.cliente_id
     group by d.cliente_id
  ),
  pago as (
    select f.cliente_id, sum(fa.monto_usd * greatest(fa.fecha - f.fecha_emision, 0)) / nullif(sum(fa.monto_usd), 0) dias
      from factura_aplicaciones fa join fac f on f.id = fa.factura_id
     where fa.tipo = 'pago' and f.tipo = 'factura' and fa.fecha > v_hoy - v_dias and fa.monto_usd > 0
     group by f.cliente_id
  )
  select cli.id,
         round(coalesce(h.deuda, 0), 2), round(coalesce(h.vencido, 0), 2), coalesce(h.docs, 0)::int,
         round(coalesce(h.nc, 0), 2), coalesce(h.nc_n, 0)::int, h.nc_min,
         round(coalesce(v.venta, 0), 2),
         case when coalesce(v.venta, 0) > 0.009 and coalesce(h.deuda, 0) > 0.009 then round(h.deuda / (v.venta / v_dias), 0)
              when coalesce(h.deuda, 0) <= 0.009 then 0 end,
         case when coalesce(h.deuda, 0) > 0.009 then round(h.mora_num / h.deuda, 0) else 0 end,
         round(coalesce(a.deuda, 0), 2), round(coalesce(v.venta_ant, 0), 2),
         case when coalesce(v.venta_ant, 0) > 0.009 and coalesce(a.deuda, 0) > 0.009 then round(a.deuda / (v.venta_ant / v_dias), 0)
              when coalesce(a.deuda, 0) <= 0.009 then 0 end,
         case when coalesce(a.deuda, 0) > 0.009 then round(a.mora_num / a.deuda, 0) else 0 end,
         round(p.dias, 0),
         -- sobre el límite: misma regla que Cuentas ("Deuda sobre el límite"): saldo neto de documentos (deuda − NC a favor)
         cli.limite, cli.limite > 0 and coalesce(h.deuda, 0) - coalesce(h.nc, 0) > cli.limite, cli.correo, v_ant
    from cli
    left join hoy h on h.cliente_id = cli.id
    left join ant a on a.cliente_id = cli.id
    left join ven v on v.cliente_id = cli.id
    left join pago p on p.cliente_id = cli.id
   where h.cliente_id is not null or v.cliente_id is not null or a.cliente_id is not null;
end $$;
revoke all on function public.metricas_cobranza_calculo(uuid[], integer) from public, anon, authenticated;

-- ── Por cliente (Cuentas, detalle de la cuenta, cartera del vendedor) ──
create or replace function public.metricas_cobranza(p_dias integer default null, p_cliente_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_clientes uuid[];
  v_dias integer := case when p_dias is null then public.config_entero('cobranza_dso_ventana_dias', 90, 7, 730)
                         else least(greatest(p_dias, 7), 730) end;
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
    'clientes', coalesce((select jsonb_agg(to_jsonb(m)) from public.metricas_cobranza_calculo(v_clientes, v_dias) m), '[]'::jsonb));
end $$;
revoke all on function public.metricas_cobranza(integer, uuid) from public, anon;
grant execute on function public.metricas_cobranza(integer, uuid) to authenticated;

-- ── Reportes → Cobranza: DSO y mora por vendedor o por cliente ──
create or replace function public.reporte_dso(p_dias integer default null, p_agrupar text default 'vendedor')
returns table(clave text, etiqueta text, detalle text, clientes bigint, deuda numeric, vencido numeric, venta numeric,
              dso numeric, mora numeric, dso_ant numeric, a_favor_nc numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_dias integer := case when p_dias is null then public.config_entero('cobranza_dso_ventana_dias', 90, 7, 730)
                         else least(greatest(p_dias, 7), 730) end;
begin
  perform public.exigir_permiso_reportes();
  if p_agrupar not in ('vendedor', 'cliente') then raise exception 'Agrupación no válida' using errcode = '22023'; end if;
  return query
  with m as (
    select m.*, cl.nombre_negocio, cl.rif, cl.ciudad,
           coalesce(nullif(trim(concat_ws(' ', u.nombre, u.apellido)), ''), nullif(trim(cl.vendedor_odoo), ''), 'Sin vendedor') vendedor
      from public.metricas_cobranza_calculo(null, v_dias) m
      join clientes cl on cl.id = m.cliente_id
      left join usuarios u on u.id = cl.vendedor_asignado_id
  ), k as (
    select m.*, case when p_agrupar = 'cliente' then m.cliente_id::text else m.vendedor end k from m
  )
  select k.k,
         case when p_agrupar = 'cliente' then max(k.nombre_negocio) else k.k end::text,
         case when p_agrupar = 'cliente' then max(concat_ws(' · ', k.rif, k.ciudad)) end::text,
         count(*) filter (where k.deuda > 0.009),
         round(sum(k.deuda), 2), round(sum(k.vencido), 2), round(sum(k.venta), 2),
         case when sum(k.venta) > 0.009 and sum(k.deuda) > 0.009 then round(sum(k.deuda) / (sum(k.venta) / v_dias), 0) end,
         case when sum(k.deuda) > 0.009 then round(sum(k.mora * k.deuda) / sum(k.deuda), 0) end,
         case when sum(k.venta_ant) > 0.009 and sum(k.deuda_ant) > 0.009 then round(sum(k.deuda_ant) / (sum(k.venta_ant) / v_dias), 0) end,
         round(sum(k.a_favor_nc), 2)
    from k
   group by k.k
  having sum(k.deuda) > 0.009 or sum(k.a_favor_nc) > 0.009
   order by 5 desc nulls last;
end $$;
revoke all on function public.reporte_dso(integer, text) from public, anon;
grant execute on function public.reporte_dso(integer, text) to authenticated;

-- ── Notas de crédito sin aplicar (a favor por cruzar en Odoo) ──
create or replace function public.nc_sin_aplicar()
returns table(factura_id uuid, numero text, cliente_id uuid, cliente text, vendedor text, empresa text, emision date, dias integer,
              total numeric, saldo numeric, moneda text, aplicada numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_hoy date := (now() at time zone 'America/Caracas')::date;
begin
  if not (public.es_personal_admin() and public.puede('cuentas', 'ver')) then
    raise exception 'No tienes permiso para ver cuentas' using errcode = '42501';
  end if;
  return query
  select f.id, f.numero::text, f.cliente_id, cl.nombre_negocio::text,
         coalesce(nullif(trim(concat_ws(' ', u.nombre, u.apellido)), ''), nullif(trim(cl.vendedor_odoo), ''), 'Sin vendedor')::text,
         e.nombre_corto::text, f.fecha_emision, (v_hoy - f.fecha_emision)::int,
         round(-f.total_usd, 2), round(-f.saldo_usd, 2), case when f.moneda = 'USD' then 'USD' else 'VES' end,
         round(abs(f.total_usd) - abs(f.saldo_usd), 2)
    from facturas f
    join clientes cl on cl.id = f.cliente_id
    left join usuarios u on u.id = cl.vendedor_asignado_id
    left join empresas e on e.id = f.empresa_id
   where f.tipo = 'nota_credito' and f.estado = 'posted' and f.saldo_usd < -0.009
     and (f.empresa_id is null or f.empresa_id = any (public.empresas_visibles()))
   order by f.fecha_emision nulls last, f.numero;
end $$;
revoke all on function public.nc_sin_aplicar() from public, anon;
grant execute on function public.nc_sin_aplicar() to authenticated;

-- ── Torre de control ──
create or replace function public.alertas_cobranza()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_umbral integer := public.config_entero('cobranza_dso_alerta_dias', 60, 1, 3650);
  v jsonb;
begin
  if not (public.es_personal_admin() and public.puede('cuentas', 'ver')) then
    return jsonb_build_object('umbral', v_umbral, 'dso_alto', 0, 'sobre_limite', 0);
  end if;
  select jsonb_build_object('umbral', v_umbral,
           'dso_alto', count(*) filter (where m.deuda > 0.009 and (m.dso > v_umbral or (m.dso is null and m.vencido > 0.009))),
           'sobre_limite', count(*) filter (where m.sobre_limite))
    into v from public.metricas_cobranza_calculo(null, null) m;
  return v;
end $$;
revoke all on function public.alertas_cobranza() from public, anon;
grant execute on function public.alertas_cobranza() to authenticated;

notify pgrst, 'reload schema';

commit;
