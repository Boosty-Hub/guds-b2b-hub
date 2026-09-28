-- ════════════════════════════════════════════════════════════════════════
-- Fase 20q · R8b: calidad de datos y cuadre Profit ↔ Odoo (docs/privado/planes/plan-reportes.md R8 y §4.3). Solo lectura:
-- lo que aparece aquí se corrige en Odoo (o, la categoría inactiva, en Categorías de GUDS).
--
--   · reporte_cuadre_profit_odoo(): repite el cruce documento a documento de §4.3. Cada saldo inicial de Odoo (la cartera
--     abierta de Profit al corte) se busca en el histórico de Profit por empresa, clase (factura / nota de crédito o
--     devolución / nota de débito) y número (sin ceros a la izquierda ni prefijo NC/ND); si hay varios, el de total más
--     cercano. Estados:
--       cuadra       → mismo total con IVA (diferencia < 1 USD)
--       pronto_pago  → Odoo = Profit + 3 % de la base: el descuento global por pronto pago de Profit no pasó a Odoo
--       nc_ambigua   → nota de crédito con el número de otro documento de Profit (Profit numera devoluciones y notas de
--                      crédito por separado y Odoo las unió en una sola secuencia)
--       difiere      → mismo número con otro total
--       solo_odoo    → sin documento de Profit con ese número (p. ej. ND que no están en la vista de ventas)
--     El detalle trae solo los documentos que no cuadran (el resumen cuenta todos). Además, las facturas que Profit tiene
--     "Pendiente" y no llegaron como saldo inicial a Odoo.
--   · reporte_calidad_datos(): listas para corregir en Odoo, cada una con su conteo:
--       clientes con estado de otro país ("Bolivar (EC)"), sin condición de pago o sin RIF;
--       productos con ventas en Odoo sin costo, sin categoría (o en la raíz "Todos") o con la categoría inactiva;
--       facturas anuladas (revertidas con NC o canceladas) que Odoo aún tiene con saldo;
--       cobros de Odoo con al menos 1 USD sin aplicar a facturas.
--   Las dos con el permiso de reportes y en las empresas visibles.
-- ════════════════════════════════════════════════════════════════════════
begin;

create or replace function public.reporte_cuadre_profit_odoo() returns jsonb
language plpgsql stable security definer set search_path = public set work_mem = '32MB' as $$
declare v_emp uuid[]; v_lote bigint; v_res jsonb;
begin
  perform public.exigir_permiso_reportes();
  v_emp := public.empresas_visibles();
  v_lote := public.profit_lote_vigente();
  with o as (
    select f.id, f.empresa_id, f.cliente_id, f.numero, f.fecha_emision, f.total_usd, f.saldo_usd, f.estado,
           case when f.tipo = 'nota_credito' then 'nc' when coalesce(f.es_nota_debito, false) then 'nd' else 'factura' end clase,
           ltrim(regexp_replace(upper(btrim(f.numero)), '^(NC|ND|N/C|N/D)\s*', ''), '0') num
    from facturas f
    where f.es_saldo_inicial and f.empresa_id = any(v_emp)
  ), p as (
    select d.documento, d.empresa_id, d.tipo, d.numero, d.fecha, d.total_usd, d.neto_usd, d.cliente_nombre, d.tratamiento, d.estatus_cobro estatus,
           case d.tipo when 'factura' then 'factura' when 'nota_debito' then 'nd' else 'nc' end clase,
           ltrim(upper(btrim(d.numero)), '0') num
    from profit_documentos d
    where d.lote = v_lote and d.empresa_id = any(v_emp)
  ), par as (
    select distinct on (o.id) o.*, p.documento, p.tipo tipo_profit, p.numero numero_profit, p.fecha fecha_profit, p.total_usd total_profit,
           p.neto_usd neto_profit, p.estatus estatus_profit, p.cliente_nombre cliente_profit, o.total_usd - p.total_usd dif
    from o left join p on p.empresa_id = o.empresa_id and p.clase = o.clase and p.num = o.num and o.num <> ''
    order by o.id, abs(o.total_usd - p.total_usd) nulls last
  ), c as (
    select par.*, case when par.documento is null then 'solo_odoo'
                       when abs(par.dif) < 1 then 'cuadra'
                       when abs(par.dif - 0.03 * par.neto_profit) < 0.05 then 'pronto_pago'
                       when par.clase = 'nc' then 'nc_ambigua'
                       else 'difiere' end estado_cuadre
    from par
  ), sin_saldo as (
    -- Facturas "Pendiente" en Profit (sin anular) que no llegaron como saldo inicial a Odoo
    select p.* from p
    where p.clase = 'factura' and p.estatus = 'Pendiente' and p.tratamiento = 'venta'
      and not exists (select 1 from c where c.documento = p.documento)
  )
  select jsonb_build_object(
    'lote', v_lote,
    'ventana_desde', '2024-12-01',
    'totales', (select jsonb_build_object(
        'documentos', count(*),
        'cuadran', count(*) filter (where estado_cuadre = 'cuadra'),
        'cuadran_odoo_usd', round(coalesce(sum(total_usd) filter (where estado_cuadre = 'cuadra'), 0), 2),
        'cuadran_profit_usd', round(coalesce(sum(total_profit) filter (where estado_cuadre = 'cuadra'), 0), 2),
        'pronto_pago', count(*) filter (where estado_cuadre = 'pronto_pago'),
        'pronto_pago_usd', round(coalesce(sum(dif) filter (where estado_cuadre = 'pronto_pago'), 0), 2),
        'difieren', count(*) filter (where estado_cuadre = 'difiere'),
        'nc_ambiguas', count(*) filter (where estado_cuadre = 'nc_ambigua'),
        'solo_odoo', count(*) filter (where estado_cuadre = 'solo_odoo'),
        'pendientes_profit', count(*) filter (where estado_cuadre = 'cuadra' and estatus_profit = 'Pendiente'),
        -- Ventana del análisis previo (dic-2024 → may-2026, la hoja "Base datos" del Excel)
        'ventana_cuadran', count(*) filter (where estado_cuadre = 'cuadra' and fecha_emision >= '2024-12-01'),
        'ventana_odoo_usd', round(coalesce(sum(total_usd) filter (where estado_cuadre = 'cuadra' and fecha_emision >= '2024-12-01'), 0), 2),
        'ventana_profit_usd', round(coalesce(sum(total_profit) filter (where estado_cuadre = 'cuadra' and fecha_emision >= '2024-12-01'), 0), 2),
        'sin_saldo_inicial', (select count(*) from sin_saldo),
        'sin_saldo_inicial_usd', (select round(coalesce(sum(total_usd), 0), 2) from sin_saldo))
      from c),
    'resumen', coalesce((select jsonb_agg(x order by x.empresa, x.clase, x.estado) from (
        select e.nombre_corto empresa, c.clase, c.estado_cuadre estado, count(*) documentos,
               round(sum(c.total_usd), 2) odoo_usd, round(coalesce(sum(c.total_profit), 0), 2) profit_usd, round(coalesce(sum(c.dif), 0), 2) diferencia_usd
        from c join empresas e on e.id = c.empresa_id group by 1, 2, 3) x), '[]'::jsonb),
    'documentos', coalesce((select jsonb_agg(x order by x.estado_orden, abs(x.diferencia_usd) desc nulls first, x.fecha desc) from (
        select c.id, e.nombre_corto empresa, c.clase, c.numero, c.fecha_emision fecha, c.estado estado_odoo,
               coalesce(cl.nombre_negocio, c.cliente_profit) cliente, cl.rif,
               round(c.total_usd, 2) total_odoo_usd, round(c.saldo_usd, 2) saldo_odoo_usd,
               c.tipo_profit, c.numero_profit, c.fecha_profit, round(c.total_profit, 2) total_profit_usd, c.estatus_profit,
               round(c.dif, 2) diferencia_usd, c.estado_cuadre estado,
               case c.estado_cuadre when 'difiere' then 1 when 'pronto_pago' then 2 when 'solo_odoo' then 3 when 'nc_ambigua' then 4 else 5 end estado_orden
        from c join empresas e on e.id = c.empresa_id left join clientes cl on cl.id = c.cliente_id
        where c.estado_cuadre <> 'cuadra') x), '[]'::jsonb),
    'pendientes_sin_saldo', coalesce((select jsonb_agg(x order by x.total_usd desc) from (
        select e.nombre_corto empresa, s.numero, s.fecha, s.cliente_nombre cliente, round(s.total_usd, 2) total_usd
        from sin_saldo s join empresas e on e.id = s.empresa_id) x), '[]'::jsonb)
  ) into v_res;
  return v_res;
end $$;
revoke execute on function public.reporte_cuadre_profit_odoo() from public, anon;
grant execute on function public.reporte_cuadre_profit_odoo() to authenticated;

create or replace function public.reporte_calidad_datos() returns jsonb
language plpgsql stable security definer set search_path = public set work_mem = '32MB' as $$
declare v_emp uuid[]; v_res jsonb; v_hoy date := (now() at time zone 'America/Caracas')::date;
begin
  perform public.exigir_permiso_reportes();
  v_emp := public.empresas_visibles();
  with cli as (
    select c.*, e.nombre_corto empresa_nombre from clientes c left join empresas e on e.id = c.empresa_id
    where c.activo and (c.empresa_id is null or c.empresa_id = any(v_emp))
  ), compras as (
    select f.cliente_id, max(f.fecha_emision) ultima, count(*) filter (where f.fecha_emision > v_hoy - 365) facturas_12m,
           round(coalesce(sum(case when f.total <> 0 then f.subtotal * f.total_usd / f.total end) filter (where f.fecha_emision > v_hoy - 365), 0), 2) venta_12m
    from facturas f
    where f.estado = 'posted' and f.tipo = 'factura' and not f.es_saldo_inicial and f.cliente_id is not null
      and (f.empresa_id is null or f.empresa_id = any(v_emp))
    group by 1
  ), cli_j as (
    select c.id, coalesce(c.empresa_nombre, 'Compartido') empresa, c.nombre_negocio cliente, c.rif, c.estado, c.ciudad, c.condicion_pago,
           c.vendedor_odoo vendedor, c.odoo_id, co.ultima ultima_compra, coalesce(co.facturas_12m, 0) facturas_12m, coalesce(co.venta_12m, 0) venta_12m
    from cli c left join compras co on co.cliente_id = c.id
  ), vendidos as (
    -- Productos con ventas en Odoo (facturas publicadas, sin saldos iniciales) por empresa
    select i.producto_id, f.empresa_id, max(f.fecha_emision) ultima, round(sum(i.cantidad), 2) unidades,
           round(sum(i.subtotal * case when f.total <> 0 then f.total_usd / f.total else 0 end), 2) venta_usd
    from factura_items i join facturas f on f.id = i.factura_id
    where f.estado = 'posted' and f.tipo = 'factura' and not f.es_saldo_inicial and i.producto_id is not null and f.empresa_id = any(v_emp)
    group by 1, 2
  ), prod as (
    select v.producto_id id, e.nombre_corto empresa, p.sku, p.nombre producto, p.tipo_odoo, c.nombre categoria, c.activo categoria_activa,
           p.categoria_id, v.ultima ultima_venta, v.unidades, v.venta_usd,
           exists (select 1 from producto_costos pc where pc.producto_id = v.producto_id and pc.empresa_id = v.empresa_id and pc.costo > 0) con_costo
    from vendidos v join productos p on p.id = v.producto_id join empresas e on e.id = v.empresa_id
    left join categorias c on c.id = p.categoria_id
  ), anuladas as (
    select f.id, e.nombre_corto empresa, f.tipo, f.numero, f.fecha_emision fecha, cl.nombre_negocio cliente, f.estado estado_odoo, f.estado_pago,
           round(coalesce(nullif(f.saldo_usd, 0), f.saldo_odoo_usd), 2) saldo_usd, f.es_saldo_inicial,
           case when f.estado = 'cancel' then 'Cancelada en Odoo con saldo'
                else 'Revertida con nota de crédito y aún con saldo' end motivo
    from facturas f left join empresas e on e.id = f.empresa_id left join clientes cl on cl.id = f.cliente_id
    where (f.empresa_id is null or f.empresa_id = any(v_emp))
      and ((f.estado = 'cancel' and abs(coalesce(f.saldo_odoo_usd, f.saldo_usd, 0)) > 0.009)
        or (f.estado = 'posted' and f.estado_pago = 'anulado' and abs(coalesce(f.saldo_usd, 0)) > 0.009))
  ), cobros as (
    select p.id, e.nombre_corto empresa, p.numero, coalesce(p.fecha_pago, (p.created_at at time zone 'America/Caracas')::date) fecha,
           cl.nombre_negocio cliente, b.nombre banco, p.moneda, round(p.monto, 2) monto_usd,
           round(coalesce(a.aplicado, 0), 2) aplicado_usd, round(p.monto - coalesce(a.aplicado, 0), 2) sin_aplicar_usd
    from pagos p
    left join (select pago_id, sum(monto_usd) aplicado from factura_aplicaciones where pago_id is not null group by 1) a on a.pago_id = p.id
    left join empresas e on e.id = p.empresa_id left join clientes cl on cl.id = p.cliente_id left join bancos b on b.id = p.banco_id
    where p.odoo_id is not null and p.estado = 'verificado' and not coalesce(p.es_igtf, false)
      and (p.empresa_id is null or p.empresa_id = any(v_emp))
      and p.monto - coalesce(a.aplicado, 0) >= 1
  ), listas as (
    select 'clientes_estado_extranjero' clave, coalesce(jsonb_agg(to_jsonb(x) order by x.empresa, x.cliente), '[]'::jsonb) filas, count(*) n
      from (select * from cli_j where estado ~ '\((?!VE\))[A-Z]{2}\)\s*$') x
    union all
    select 'clientes_sin_condicion', coalesce(jsonb_agg(to_jsonb(x) order by x.venta_12m desc, x.cliente), '[]'::jsonb), count(*)
      from (select * from cli_j where nullif(btrim(coalesce(condicion_pago, '')), '') is null) x
    union all
    select 'clientes_sin_rif', coalesce(jsonb_agg(to_jsonb(x) order by x.venta_12m desc, x.cliente), '[]'::jsonb), count(*)
      from (select * from cli_j where nullif(upper(btrim(coalesce(rif, ''))), 'N/D') is null) x
    union all
    select 'productos_sin_costo', coalesce(jsonb_agg(to_jsonb(x) - 'categoria_id' - 'categoria_activa' - 'con_costo' order by x.venta_usd desc), '[]'::jsonb), count(*)
      from (select * from prod where not con_costo and coalesce(tipo_odoo, '') <> 'service') x
    union all
    select 'productos_sin_categoria', coalesce(jsonb_agg(to_jsonb(x) - 'categoria_id' - 'categoria_activa' - 'con_costo' order by x.venta_usd desc), '[]'::jsonb), count(*)
      from (select *, case when categoria_id is null then 'Sin categoría' else 'En la categoría raíz de Odoo' end motivo from prod
            where categoria_id is null or upper(btrim(categoria)) in ('TODOS', 'TODOS Q', 'ALL')) x
    union all
    select 'productos_categoria_inactiva', coalesce(jsonb_agg(to_jsonb(x) - 'categoria_id' - 'categoria_activa' - 'con_costo' order by x.venta_usd desc), '[]'::jsonb), count(*)
      from (select * from prod where categoria_id is not null and not coalesce(categoria_activa, true)) x
    union all
    select 'facturas_anuladas_con_saldo', coalesce(jsonb_agg(to_jsonb(x) order by abs(x.saldo_usd) desc), '[]'::jsonb), count(*) from anuladas x
    union all
    select 'cobros_sin_aplicar', coalesce(jsonb_agg(to_jsonb(x) order by x.sin_aplicar_usd desc), '[]'::jsonb), count(*) from cobros x
  )
  select jsonb_build_object(
    'generado', now(),
    'conteos', (select jsonb_object_agg(clave, n) from listas),
    'listas', (select jsonb_object_agg(clave, filas) from listas),
    'montos', jsonb_build_object(
      'facturas_anuladas_con_saldo_usd', (select round(coalesce(sum(abs(saldo_usd)), 0), 2) from anuladas),   -- facturas (+) y NC (−) en valor absoluto
      'cobros_sin_aplicar_usd', (select round(coalesce(sum(sin_aplicar_usd), 0), 2) from cobros),
      'productos_sin_costo_venta_usd', (select round(coalesce(sum(venta_usd), 0), 2) from prod where not con_costo and coalesce(tipo_odoo, '') <> 'service'))
  ) into v_res;
  return v_res;
end $$;
revoke execute on function public.reporte_calidad_datos() from public, anon;
grant execute on function public.reporte_calidad_datos() to authenticated;

notify pgrst, 'reload schema';

commit;
