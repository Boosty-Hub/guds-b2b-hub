-- ════════════════════════════════════════════════════════════════════════
-- Fase 21a · 1.3 Empleados que llegaron como clientes (plan de revisión del 30-sep).
--   En Odoo hay contactos de empleados: los que tienen la etiqueta "Empleado" (4) y los contactos de los usuarios internos
--   de Odoo (res.users share=false → partner_id) que quedaron con rango de cliente, sin empresa y asignados al usuario
--   de soporte (5 vendedores + el propio soporte). Tres de ellos tienen facturas (compras de personal).
--   · clientes.es_empleado lo fija la sincronización con esas dos reglas (no se usa tipo_cliente: es la "Industria" de Odoo
--     y la sincronización lo sobrescribe). Aquí se carga lo mismo con lo leído hoy de Odoo (solo lectura).
--   · No cuentan como cartera del vendedor (cartera_vendedor) ni en "clientes sin vendedor"; siguen en Cuentas y Facturas.
--   · Reportes de venta (decisión del 30-sep): canal "Personal" en el cubo (cubo_base_sql / _docs / _mensual), así el
--     filtro de canal de Reportes los separa o excluye sin tocar la pantalla.
-- ════════════════════════════════════════════════════════════════════════
begin;

alter table public.clientes add column if not exists es_empleado boolean not null default false;
comment on column public.clientes.es_empleado is
  'Empleado (compras de personal): etiqueta Empleado de Odoo o contacto de un usuario interno de Odoo. Lo fija la sincronización.';
create index if not exists clientes_es_empleado_idx on public.clientes (es_empleado) where es_empleado;

-- Carga inicial: etiqueta Empleado o contacto de un usuario interno de Odoo (partner_id de res.users share=false, 30-sep)
update public.clientes set es_empleado = true
 where not es_empleado
   and ('Empleado' = any (coalesce(etiquetas, '{}'))
        or odoo_id = any (array[10645,10828,10628,10640,10627,20,10838,10637,10870,10625,5,10638,24,10633,10632,19,10626,10634,
                                10643,10629,10630,10636,10642,10635,10641,2,10995,3,10639,18,10646]));

-- cubo_base_sql: canal 'Personal' para los empleados (2 sitios)
CREATE OR REPLACE FUNCTION public.cubo_base_sql(p_odoo boolean, p_profit boolean, p_detalle boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare v_odoo text; v_profit text;
begin
  v_odoo := $q$
    select 'odoo'::text fte, dv.empresa_id, dv.fecha, dv.id::text doc, dv.tipo = 'factura' es_fac,
           coalesce(dv.cliente_id::text, '') cli, coalesce(nullif(dv.vendedor, 'Sin vendedor'), '') vendedor,
           coalesce(cl.tipo_cliente, '') tipo_cliente, case when cl.es_empleado then 'Personal' else coalesce(cl.canal, '') end canal, coalesce(cl.segmento, '') segmento,
           coalesce(ct.c1, '') categoria, coalesce(ct.c2, '') linea, coalesce(ct.c3, '') sublinea, coalesce(pr.marca, '') marca,
           ''::text categoria_p, ''::text linea_p, ''::text sublinea_p,
           coalesce(i.producto_id::text, 'sku:' || nullif(upper(btrim(i.sku_producto)), ''), 'n:' || nullif(btrim(i.nombre_producto), ''), '') prod,
           case when dv.tipo = 'nota_credito' then -i.cantidad else i.cantidad end cant,
           i.subtotal * dv.factor neto, 0::numeric fin, pc.costo costo_u$q$
    || case when p_detalle then $q$,
           'venta'::text tratamiento, e.nombre empresa, f.fecha_vencimiento, case dv.tipo when 'factura' then 'Factura' else 'Nota de Crédito' end tipo_doc,
           f.numero, fo.numero numero_origen, case when f.orden_id is not null then 'Pedido' when fo.id is not null then 'Factura' end doc_origen,
           null::text vendedor_codigo, f.moneda, case when f.moneda = 'VES' then f.tasa_cambio end tasa_venta,
           cl.codigo cliente_codigo, cl.nombre_negocio::text cliente_nombre, cl.rif cliente_rif,
           coalesce(pr.sku, i.sku_producto)::text articulo_codigo, coalesce(pr.nombre, i.nombre_producto)::text articulo, pr.unidad::text presentacion,
           i.cantidad * sign(dv.factor) cantidad_doc, i.precio_unitario * abs(dv.factor) precio_usd,
           case when f.moneda = 'VES' then i.precio_unitario end precio_bs, i.descuento descuento_pct, null::numeric descuento_global_pct,
           i.precio_unitario * i.cantidad * coalesce(i.descuento, 0) / 100 * dv.factor descuento_usd,
           case when f.moneda = 'VES' then i.precio_unitario * i.cantidad * coalesce(i.descuento, 0) / 100 * sign(dv.factor) end descuento_bs,
           case when i.total = i.subtotal then i.subtotal * dv.factor else 0 end exento_usd,
           case when i.total <> i.subtotal then i.subtotal * dv.factor else 0 end base_imponible_usd,
           (i.total - i.subtotal) * dv.factor iva_usd, i.total * dv.factor total_usd,
           case when f.moneda = 'VES' then (case when i.total = i.subtotal then i.subtotal else 0 end) * sign(dv.factor) end exento_bs,
           case when f.moneda = 'VES' then (case when i.total <> i.subtotal then i.subtotal else 0 end) * sign(dv.factor) end base_imponible_bs,
           case when f.moneda = 'VES' then (i.total - i.subtotal) * sign(dv.factor) end iva_bs,
           case when f.moneda = 'VES' then i.total * sign(dv.factor) end total_bs,
           case when f.estado_pago = 'pagado' then 'Cobrada' else 'Pendiente' end estatus_cobro,
           cl.dias_credito, cl.condicion_pago, null::text lista_precios, pc.costo_actualizado_at costo_fecha,
           coalesce(i.odoo_id, 0) renglon,
           coalesce(ct.c1, '') categoria_x, coalesce(ct.c2, '') linea_x, coalesce(ct.c3, '') sublinea_x$q$ else '' end
    || $q$
    from public.documentos_venta($3, $4) dv
    join public.factura_items i on i.factura_id = dv.id
    left join public.productos pr on pr.id = i.producto_id
    left join $q$ || public.cubo_niveles_categoria_sql() || $q$ ct on ct.id = pr.categoria_id
    left join public.producto_costos pc on pc.producto_id = i.producto_id and pc.empresa_id = dv.empresa_id and pc.costo > 0
    left join public.clientes cl on cl.id = dv.cliente_id$q$
    || case when p_detalle then $q$
    join public.facturas f on f.id = dv.id
    left join public.facturas fo on fo.id = f.factura_origen_id
    left join public.empresas e on e.id = dv.empresa_id$q$ else '' end;

  v_profit := $q$
    select 'profit'::text fte, v.empresa_id, v.fecha, 'p' || v.documento doc, v.tipo = 'factura' es_fac,
           coalesce(v.cliente_id::text, 'p:' || v.empresa_id::text || ':' || coalesce(v.cliente_codigo, '')) cli,
           coalesce(nullif(pv.vendedor_odoo, ''), nullif(v.vendedor_nombre, ''), '') vendedor,
           coalesce(nullif(cl.tipo_cliente, ''), nullif(v.tipo_cliente, ''), '') tipo_cliente, case when cl.es_empleado then 'Personal' else coalesce(nullif(cl.canal, ''), nullif(v.canal, ''), '') end canal,
           coalesce(nullif(cl.segmento, ''), nullif(v.segmento, ''), '') segmento,$q$ || public.cubo_clasificacion_profit_sql('v') || $q$,
           coalesce(v.producto_id::text, 'sku:' || upper(v.articulo_codigo), '') prod,
           case when v.tratamiento = 'venta' then v.cantidad else 0 end cant,
           case when v.tratamiento = 'venta' then v.neto_usd else 0 end neto,
           case when v.tratamiento = 'financiera' then v.neto_usd else 0 end fin,
           case when v.tratamiento = 'venta' and v.ultimo_costo_usd > 0 then v.ultimo_costo_usd end costo_u$q$
    || case when p_detalle then $q$,
           v.tratamiento, e.nombre empresa, v.fecha_vencimiento,
           case v.tipo when 'factura' then 'Factura' when 'devolucion' then 'Devoluciones' when 'nota_credito' then 'Nota de Crédito' else 'Nota de Débito' end tipo_doc,
           v.numero, v.numero_origen, v.documento_origen doc_origen, v.vendedor_codigo, v.moneda, v.tasa_venta,
           v.cliente_codigo, v.cliente_nombre, v.cliente_rif, v.articulo_codigo, v.articulo_descripcion articulo, v.presentacion,
           v.cantidad cantidad_doc, v.precio_usd, v.precio_bs, v.descuento_renglon_pct descuento_pct, v.descuento_global_pct,
           v.descuento_usd, v.descuento_bs, v.exento_usd, v.base_imponible_usd, v.iva_usd, v.total_usd,
           v.exento_bs, v.base_imponible_bs, v.iva_bs, v.total_bs, v.estatus_cobro, v.dias_credito, v.condicion_pago, v.lista_precios,
           null::timestamptz costo_fecha, v.renglon,
           btrim(coalesce(v.categoria, '')) categoria_x, btrim(coalesce(v.linea, '')) linea_x, btrim(coalesce(v.sublinea, '')) sublinea_x$q$ else '' end
    || $q$
    from public.ventas_historicas v
    left join public.profit_vendedores pv on pv.empresa_id = v.empresa_id and pv.codigo_profit = coalesce(v.vendedor_codigo, '')
      and pv.nombre_profit = coalesce(v.vendedor_nombre, '')
    left join public.productos pr on pr.id = v.producto_id
    left join public.profit_categorias pq on pq.empresa_id = v.empresa_id and pq.categoria_profit = btrim(coalesce(v.categoria, ''))
      and pq.linea_profit = btrim(coalesce(v.linea, ''))
    left join $q$ || public.cubo_niveles_categoria_sql() || $q$ ct on ct.id = coalesce(pr.categoria_id, pq.categoria_id)
    left join public.clientes cl on cl.id = v.cliente_id$q$
    || case when p_detalle then $q$
    left join public.empresas e on e.id = v.empresa_id$q$ else '' end
    || $q$
    where v.lote = $6 and v.tratamiento in ('venta', 'financiera') and v.fecha between $3 and $4 and v.empresa_id = any($5)$q$;

  return case when p_odoo and p_profit then v_odoo || E'\n    union all' || v_profit
              when p_odoo then v_odoo else v_profit end;
end $function$;

-- cubo_base_docs_sql: canal 'Personal' para los empleados (2 sitios)
CREATE OR REPLACE FUNCTION public.cubo_base_docs_sql(p_odoo boolean, p_profit boolean)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare v_odoo text; v_profit text;
begin
  v_odoo := $q$
    select 'odoo'::text fte, dv.empresa_id, dv.fecha, dv.id::text doc, dv.tipo = 'factura' es_fac,
           coalesce(dv.cliente_id::text, '') cli, coalesce(nullif(dv.vendedor, 'Sin vendedor'), '') vendedor,
           coalesce(cl.tipo_cliente, '') tipo_cliente, case when cl.es_empleado then 'Personal' else coalesce(cl.canal, '') end canal, coalesce(cl.segmento, '') segmento,
           case when dv.tipo = 'nota_credito' then -coalesce(li.cant, 0) else coalesce(li.cant, 0) end cant,
           dv.neto_usd neto, 0::numeric fin,
           case when dv.tipo = 'nota_credito' then -li.costo else li.costo end costo, li.vcc * dv.factor vcc
    from public.documentos_venta($3, $4) dv
    left join public.clientes cl on cl.id = dv.cliente_id
    left join (
      select i.factura_id, sum(i.cantidad) cant, sum(i.cantidad * pc.costo) filter (where pc.costo is not null) costo,
             sum(i.subtotal) filter (where pc.costo is not null) vcc
      from public.factura_items i
      join public.facturas fa on fa.id = i.factura_id
      left join public.producto_costos pc on pc.producto_id = i.producto_id and pc.empresa_id = fa.empresa_id and pc.costo > 0
      where fa.fecha_emision between $3 and $4
      group by i.factura_id) li on li.factura_id = dv.id$q$;
  v_profit := $q$
    select 'profit'::text fte, d.empresa_id, d.fecha, 'p' || d.documento doc, d.tipo = 'factura' es_fac,
           coalesce(d.cliente_id::text, 'p:' || d.empresa_id::text || ':' || coalesce(d.cliente_codigo, '')) cli,
           coalesce(nullif(pv.vendedor_odoo, ''), nullif(d.vendedor_nombre, ''), '') vendedor,
           coalesce(nullif(cl.tipo_cliente, ''), nullif(d.tipo_cliente, ''), '') tipo_cliente, case when cl.es_empleado then 'Personal' else coalesce(nullif(cl.canal, ''), nullif(d.canal, ''), '') end canal,
           coalesce(nullif(cl.segmento, ''), nullif(d.segmento, ''), '') segmento,
           case when d.tratamiento = 'venta' then d.cantidad else 0 end cant,
           case when d.tratamiento = 'venta' then d.neto_usd else 0 end neto,
           case when d.tratamiento = 'financiera' then d.neto_usd else 0 end fin,
           case when d.tratamiento = 'venta' then d.costo_usd end costo,
           case when d.tratamiento = 'venta' then d.venta_con_costo_usd end vcc
    from public.profit_documentos d
    left join public.profit_vendedores pv on pv.empresa_id = d.empresa_id and pv.codigo_profit = coalesce(d.vendedor_codigo, '')
      and pv.nombre_profit = coalesce(d.vendedor_nombre, '')
    left join public.clientes cl on cl.id = d.cliente_id
    where d.lote = $6 and d.tratamiento in ('venta', 'financiera') and d.fecha between $3 and $4 and d.empresa_id = any($5)$q$;
  return case when p_odoo and p_profit then v_odoo || E'\n    union all' || v_profit
              when p_odoo then v_odoo else v_profit end;
end $function$;

-- cubo_base_mensual_sql: canal 'Personal' para los empleados (1 sitio)
CREATE OR REPLACE FUNCTION public.cubo_base_mensual_sql(p_odoo boolean, p_profit boolean)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare v_odoo text; v_profit text;
begin
  v_odoo := format($q$
    select o.fte, o.empresa_id, o.fecha, o.doc, o.es_fac, o.cli, o.vendedor, o.tipo_cliente, o.canal, o.segmento, o.categoria, o.linea, o.sublinea,
           o.marca, o.categoria_p, o.linea_p, o.sublinea_p, o.prod, o.cant, o.neto, o.fin, case when o.costo_u is not null then o.cant * o.costo_u end costo,
           case when o.costo_u is not null then o.neto end vcc
    from (%s) o$q$, public.cubo_base_sql(true, false));
  v_profit := $q$
    select 'profit'::text fte, m.empresa_id, m.mes fecha, null::text doc, m.es_fac, m.cli,
           coalesce(nullif(pv.vendedor_odoo, ''), nullif(m.vendedor_nombre, ''), '') vendedor,
           coalesce(nullif(cl.tipo_cliente, ''), nullif(m.tipo_cliente, ''), '') tipo_cliente, case when cl.es_empleado then 'Personal' else coalesce(nullif(cl.canal, ''), nullif(m.canal, ''), '') end canal,
           coalesce(nullif(cl.segmento, ''), nullif(m.segmento, ''), '') segmento,$q$ || public.cubo_clasificacion_profit_sql('m') || $q$,
           m.prod, m.cant, m.neto, m.fin, m.costo, m.vcc
    from public.profit_articulos_mes m
    left join public.profit_vendedores pv on pv.empresa_id = m.empresa_id and pv.codigo_profit = m.vendedor_codigo and pv.nombre_profit = m.vendedor_nombre
    left join public.productos pr on pr.id::text = m.prod
    left join public.profit_categorias pq on pq.empresa_id = m.empresa_id and pq.categoria_profit = btrim(m.categoria) and pq.linea_profit = btrim(m.linea)
    left join $q$ || public.cubo_niveles_categoria_sql() || $q$ ct on ct.id = coalesce(pr.categoria_id, pq.categoria_id)
    left join public.clientes cl on cl.id::text = m.cli
    where m.lote = $6 and m.mes between date_trunc('month', $3)::date and $4 and m.empresa_id = any($5)$q$;
  return case when p_odoo and p_profit then v_odoo || E'\n    union all' || v_profit
              when p_odoo then v_odoo else v_profit end;
end $function$;

-- cartera_vendedor: las compras de personal no son cartera del vendedor
CREATE OR REPLACE FUNCTION public.cartera_vendedor()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_usuario uuid := public.usuario_actual_id();
  v_visibles uuid[] := public.empresas_visibles();
  v_hoy date := (now() at time zone 'America/Caracas')::date;
  v_res jsonb;
begin
  if v_usuario is null then
    raise exception 'Inicia sesión para ver tu cartera' using errcode = '42501';
  end if;

  with
  cartera as (
    select c.id, c.codigo, c.nombre_negocio, c.ciudad, c.telefono, c.celular, c.condicion_pago, c.dias_credito,
           coalesce(c.limite_credito, 0) limite, c.empresa_id
      from clientes c
     where c.vendedor_asignado_id = v_usuario and c.activo and not c.es_empleado
       and (c.empresa_id is null or c.empresa_id = any(v_visibles))
  ),
  fac as (
    select f.cliente_id, f.saldo_usd, coalesce(f.es_saldo_inicial, false) saldo_inicial, f.fecha_vencimiento,
           v_hoy - coalesce(f.fecha_vencimiento, f.fecha_emision, v_hoy) dias
      from facturas f join cartera c on c.id = f.cliente_id
     where f.estado = 'posted' and abs(f.saldo_usd) > 0.009
       and (f.empresa_id is null or f.empresa_id = any(v_visibles))
  ),
  deuda as (
    select c.id cliente_id,
      coalesce(sum(f.saldo_usd) filter (where f.saldo_usd > 0), 0) por_cobrar,
      coalesce(sum(f.saldo_usd) filter (where f.saldo_usd < 0), 0) a_favor,
      coalesce(sum(f.saldo_usd) filter (where f.saldo_usd > 0 and f.dias > 0), 0) vencido,
      coalesce(max(f.dias) filter (where f.saldo_usd > 0 and f.dias > 0), 0) dias_mora,
      count(f.*) filter (where f.saldo_usd > 0) facturas,
      coalesce(sum(f.saldo_usd) filter (where f.saldo_usd > 0 and f.saldo_inicial), 0) saldo_inicial,
      coalesce(sum(f.saldo_usd) filter (where f.saldo_usd > 0 and f.dias <= 0), 0) t_por_vencer,
      coalesce(sum(f.saldo_usd) filter (where f.saldo_usd > 0 and f.dias between 1 and 30), 0) t_d1_30,
      coalesce(sum(f.saldo_usd) filter (where f.saldo_usd > 0 and f.dias between 31 and 60), 0) t_d31_60,
      coalesce(sum(f.saldo_usd) filter (where f.saldo_usd > 0 and f.dias between 61 and 90), 0) t_d61_90,
      coalesce(sum(f.saldo_usd) filter (where f.saldo_usd > 0 and f.dias > 90), 0) t_mas_90,
      min(f.fecha_vencimiento) filter (where f.saldo_usd > 0 and f.dias <= 0) proximo_vencimiento,
      coalesce(sum(f.saldo_usd) filter (where f.saldo_usd > 0 and f.dias between -7 and 0), 0) vence_7d
    from cartera c left join fac f on f.cliente_id = c.id
    group by c.id
  ),
  compras as (
    select o.cliente_id, max(coalesce(o.fecha_pedido, o.created_at)) ultima,
           count(*) filter (where coalesce(o.fecha_pedido, o.created_at) >= now() - interval '180 days') n_180
      from ordenes o join cartera c on c.id = o.cliente_id
     where o.estado::text <> 'cancelado' and coalesce(o.aprobacion, '') <> 'rechazada'
       and (o.empresa_id is null or o.empresa_id = any(v_visibles))
     group by o.cliente_id
  ),
  cobros as (
    select p.cliente_id, max(coalesce(p.fecha_pago::timestamptz, p.created_at)) ultimo,
           count(*) filter (where p.estado = 'pendiente') pendientes
      from pagos p join cartera c on c.id = p.cliente_id
     where p.estado::text <> 'rechazado' and not coalesce(p.es_igtf, false)
       and (p.empresa_id is null or p.empresa_id = any(v_visibles))
     group by p.cliente_id
  )
  select jsonb_build_object(
    'hoy', v_hoy,
    'clientes', coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'codigo', c.codigo, 'nombre_negocio', c.nombre_negocio, 'ciudad', c.ciudad, 'telefono', c.telefono,
        'celular', c.celular, 'condicion_pago', c.condicion_pago, 'dias_credito', c.dias_credito, 'limite_credito', c.limite,
        'empresa_id', c.empresa_id,
        'por_cobrar', round(d.por_cobrar, 2), 'a_favor', round(d.a_favor, 2), 'vencido', round(d.vencido, 2),
        'dias_mora', d.dias_mora, 'facturas', d.facturas, 'saldo_inicial', round(d.saldo_inicial, 2),
        'tramos', jsonb_build_object('por_vencer', round(d.t_por_vencer, 2), 'd1_30', round(d.t_d1_30, 2), 'd31_60', round(d.t_d31_60, 2),
                                     'd61_90', round(d.t_d61_90, 2), 'mas_90', round(d.t_mas_90, 2)),
        'proximo_vencimiento', d.proximo_vencimiento, 'vence_7d', round(d.vence_7d, 2),
        'ultima_compra', cp.ultima, 'compras_180d', coalesce(cp.n_180, 0),
        'ultimo_cobro', cb.ultimo, 'cobros_pendientes', coalesce(cb.pendientes, 0),
        'excedido', c.limite > 0 and d.por_cobrar > c.limite,
        -- Prioridad de cobro: el vencido pesa más cuantos más días de mora tenga (tope 6 meses)
        'prioridad', round(d.vencido * (1 + least(d.dias_mora, 180) / 30.0), 2))
      order by d.vencido * (1 + least(d.dias_mora, 180) / 30.0) desc, d.por_cobrar desc, c.nombre_negocio), '[]'::jsonb)
  ) into v_res
  from cartera c
  join deuda d on d.cliente_id = c.id
  left join compras cp on cp.cliente_id = c.id
  left join cobros cb on cb.cliente_id = c.id;

  return v_res;
end $function$;

commit;
