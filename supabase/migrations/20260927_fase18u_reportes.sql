-- ════════════════════════════════════════════════════════════════════════
-- Fase 18u · Reportes (flanco 30 de docs/PLAN-ESPEJO-ODOO.md)
--   Funciones de agregación en el servidor para la página /admin/reportes. Permiso: módulo "reportes" (ver).
--   security definer con filtro explícito de empresa (empresas_visibles(): la empresa activa o ambas) porque el
--   módulo Reportes da acceso a los agregados aunque el rol no vea cada documento.
--
--   Venta = facturas y notas de crédito contabilizadas en Odoo, SIN saldos iniciales (diarios "Saldo Inicial") ni
--   notas de débito (ajustes por diferencia cambiaria, intereses), neta de IVA y en USD:
--     neto_usd = subtotal (moneda del documento) × total_usd / total   (las NC restan: total_usd < 0)
-- ════════════════════════════════════════════════════════════════════════
begin;

create or replace function public.exigir_permiso_reportes() returns void language plpgsql stable as $$
begin
  if not public.puede('reportes', 'ver') then
    raise exception 'No tienes permiso para ver reportes' using errcode = '42501';
  end if;
end $$;

-- Documentos de venta visibles con su neto en USD
create or replace function public.documentos_venta(p_desde date, p_hasta date)
returns table(id uuid, empresa_id uuid, cliente_id uuid, tipo text, fecha date, vendedor text, factor numeric, neto_usd numeric)
language sql stable security definer set search_path = public as $$
  select f.id, f.empresa_id, f.cliente_id, f.tipo, f.fecha_emision, coalesce(nullif(trim(f.vendedor_odoo), ''), 'Sin vendedor'),
         case when f.total <> 0 then f.total_usd / f.total else 0 end,
         case when f.total <> 0 then f.subtotal * f.total_usd / f.total else 0 end
  from facturas f
  where f.estado = 'posted' and f.tipo in ('factura', 'nota_credito') and not f.es_saldo_inicial and not coalesce(f.es_nota_debito, false)
    and f.fecha_emision between p_desde and p_hasta
    and (f.empresa_id is null or f.empresa_id = any(public.empresas_visibles()));
$$;
revoke execute on function public.documentos_venta(date, date) from public, anon, authenticated;

-- Ventas agrupadas: mes | vendedor | cliente | producto | categoria | empresa
create or replace function public.reporte_ventas(p_desde date, p_hasta date, p_agrupar text)
returns table(clave text, etiqueta text, detalle text, documentos bigint, clientes bigint, cantidad numeric,
              bruto_usd numeric, nc_usd numeric, neto_usd numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.exigir_permiso_reportes();
  if p_agrupar in ('producto', 'categoria') then
    return query
    with d as (select * from public.documentos_venta(p_desde, p_hasta)),
    l as (
      select d.id doc, d.cliente_id, d.tipo, i.producto_id, i.sku_producto, i.nombre_producto,
             case when d.tipo = 'nota_credito' then -i.cantidad else i.cantidad end cant, i.subtotal * d.factor usd
      from d join factura_items i on i.factura_id = d.id
    )
    select case when p_agrupar = 'producto' then coalesce(l.producto_id::text, l.sku_producto, l.nombre_producto) else coalesce(c.id::text, 'sin') end,
           case when p_agrupar = 'producto' then coalesce(max(p.nombre), max(l.nombre_producto)) else coalesce(max(c.nombre), 'Sin categoría') end::text,
           case when p_agrupar = 'producto' then coalesce(max(p.sku), max(l.sku_producto)) else count(distinct coalesce(l.producto_id::text, l.nombre_producto))::text || ' productos' end::text,
           count(distinct l.doc), count(distinct l.cliente_id), round(sum(l.cant), 2),
           round(sum(l.usd) filter (where l.tipo = 'factura'), 2), round(coalesce(sum(l.usd) filter (where l.tipo = 'nota_credito'), 0), 2), round(sum(l.usd), 2)
    from l left join productos p on p.id = l.producto_id left join categorias c on c.id = p.categoria_id
    group by 1
    order by 9 desc nulls last;
  else
    return query
    with d as (
      select dv.*, case p_agrupar when 'mes' then to_char(dv.fecha, 'YYYY-MM') when 'vendedor' then dv.vendedor
                                  when 'cliente' then dv.cliente_id::text else coalesce(dv.empresa_id::text, 'compartido') end k
      from public.documentos_venta(p_desde, p_hasta) dv
    )
    select d.k,
           case p_agrupar when 'cliente' then coalesce(max(cl.nombre_negocio), '—') when 'empresa' then coalesce(max(e.nombre_corto), 'Compartido')
                          else d.k end::text,
           case p_agrupar when 'cliente' then max(concat_ws(' · ', cl.rif, cl.ciudad)) else null end::text,
           count(*) filter (where d.tipo = 'factura'), count(distinct d.cliente_id), null::numeric,
           round(coalesce(sum(d.neto_usd) filter (where d.tipo = 'factura'), 0), 2), round(coalesce(sum(d.neto_usd) filter (where d.tipo = 'nota_credito'), 0), 2),
           round(sum(d.neto_usd), 2)
    from d left join clientes cl on cl.id = d.cliente_id left join empresas e on e.id = d.empresa_id
    group by d.k
    order by case when p_agrupar = 'mes' then d.k end, 9 desc nulls last;
  end if;
end $$;

-- Cobranza agrupada: mes | metodo | banco | cliente | vendedor | empresa (cobros verificados, sin IGTF)
create or replace function public.reporte_cobranza(p_desde date, p_hasta date, p_agrupar text)
returns table(clave text, etiqueta text, detalle text, cobros bigint, clientes bigint, monto_usd numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.exigir_permiso_reportes();
  return query
  with c as (
    select pg.id, pg.cliente_id, pg.monto, pg.metodo::text metodo, pg.created_at::date fecha, pg.empresa_id,
           b.id banco_id, b.nombre banco, b.moneda banco_moneda,
           coalesce(nullif(trim(concat_ws(' ', u.nombre, u.apellido)), ''), nullif(trim(cl.vendedor_odoo), ''), 'Sin vendedor') vendedor
    from pagos pg
    left join bancos b on b.id = pg.banco_id
    left join clientes cl on cl.id = pg.cliente_id
    left join usuarios u on u.id = cl.vendedor_asignado_id
    where pg.estado = 'verificado' and not coalesce(pg.es_igtf, false)
      and pg.created_at::date between p_desde and p_hasta
      and (pg.empresa_id is null or pg.empresa_id = any(public.empresas_visibles()))
  )
  , k as (
    select c.*, case p_agrupar when 'mes' then to_char(c.fecha, 'YYYY-MM') when 'metodo' then c.metodo when 'banco' then coalesce(c.banco_id::text, 'sin')
                               when 'cliente' then c.cliente_id::text when 'vendedor' then c.vendedor else coalesce(c.empresa_id::text, 'compartido') end k
    from c
  )
  select k.k,
         case p_agrupar when 'banco' then coalesce(max(k.banco), 'Sin banco') when 'cliente' then coalesce(max(cl.nombre_negocio), '—')
                        when 'empresa' then coalesce(max(e.nombre_corto), 'Compartido') else k.k end::text,
         case p_agrupar when 'banco' then max(k.banco_moneda) when 'cliente' then max(concat_ws(' · ', cl.rif, cl.ciudad)) else null end::text,
         count(*), count(distinct k.cliente_id), round(sum(k.monto), 2)
  from k left join clientes cl on cl.id = k.cliente_id left join empresas e on e.id = k.empresa_id
  group by k.k
  order by case when p_agrupar = 'mes' then k.k end, 6 desc nulls last;
end $$;

-- Inventario: existencia, comprometido, disponible y rotación (ventas de los últimos p_dias días) por producto almacenable
create or replace function public.reporte_inventario(p_dias integer default 90)
returns table(producto_id uuid, sku text, nombre text, categoria text, existencia numeric, comprometido numeric, disponible numeric,
              vendido_unidades numeric, vendido_usd numeric, ultima_venta date, cobertura_dias numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_dias integer := least(greatest(coalesce(p_dias, 90), 7), 365);
begin
  perform public.exigir_permiso_reportes();
  return query
  with v as (
    select i.producto_id, sum(case when d.tipo = 'nota_credito' then -i.cantidad else i.cantidad end) unidades,
           sum(i.subtotal * d.factor) usd, max(d.fecha) ultima
    from public.documentos_venta(current_date - v_dias, current_date) d join factura_items i on i.factura_id = d.id
    where i.producto_id is not null group by 1
  )
  select p.id, p.sku::text, p.nombre::text, coalesce(c.nombre, 'Sin categoría')::text,
         p.stock_actual::numeric, coalesce(p.comprometido_odoo, 0) + coalesce(p.comprometido_guds, 0), p.stock_disponible,
         round(coalesce(v.unidades, 0), 2), round(coalesce(v.usd, 0), 2), v.ultima,
         case when coalesce(v.unidades, 0) > 0 then round(p.stock_disponible / (v.unidades / v_dias), 0) end
  from productos p
  left join categorias c on c.id = p.categoria_id
  left join v on v.producto_id = p.id
  where p.activo and p.controla_stock is not false
    and (p.empresa_id is null or p.empresa_id = any(public.empresas_visibles()))
  order by coalesce(v.usd, 0) desc, p.nombre;
end $$;

grant execute on function public.reporte_ventas(date, date, text) to authenticated;
grant execute on function public.reporte_cobranza(date, date, text) to authenticated;
grant execute on function public.reporte_inventario(integer) to authenticated;
revoke execute on function public.reporte_ventas(date, date, text) from anon;
revoke execute on function public.reporte_cobranza(date, date, text) from anon;
revoke execute on function public.reporte_inventario(integer) from anon;

commit;
