-- Fase 22k: las notas de entrega cuentan en los reportes de ventas, diferenciadas (respuesta de finanzas del 9-oct).
-- Reportes → Ventas, Análisis y Metas, las metas de Vendedores y el resumen del vendedor: la venta incluye lo NO facturado de
-- cada N/E (sin IVA; ne_saldos al cierre del período, la misma regla que ventas_con_iva de la fase 22j) y se muestra aparte
-- (ne_usd, fuente 'ne'). documentos_venta sigue siendo solo fiscal (Odoo): el DSO, la rotación y lo demás no cambian.
-- Las funciones de reporte reciben p_ne (por defecto false: quien no lo pide ve lo mismo que antes).

begin;

-- ── 1. Líneas de venta de las notas de entrega ───────────────────────────
-- Una fila por línea de la N/E con su parte de lo no facturado (proporcional al subtotal de la línea); una N/E sin líneas (las
-- históricas cargadas del Excel) da una sola fila "sin detalle". Interna: la usan las funciones de reporte (definer).
create or replace function public.ne_ventas_lineas(p_desde date, p_hasta date, p_empresas uuid[])
returns table (nota_id uuid, empresa_id uuid, cliente_id uuid, cli text, cliente_nombre text, vendedor text, fecha date,
               fecha_vencimiento date, documento text, pedido_odoo text, estado text, item_id uuid, renglon integer,
               producto_id uuid, descripcion text, cantidad numeric, precio_usd numeric, neto_usd numeric)
language sql stable security definer set search_path = public
as $$
  with s as (
    select n.id, n.empresa_id, n.cliente_id, n.cliente_nombre, n.vendedor_nombre, n.fecha_emision, n.fecha_vencimiento, n.serie,
           n.numero, n.pedido_odoo, n.estado, x.sin_facturar, coalesce(it.t, 0) t
      from notas_entrega n
      join public.ne_saldos(p_hasta) x on x.nota_id = n.id
      left join (select i.nota_id, sum(i.subtotal_usd) t from nota_entrega_items i group by i.nota_id) it on it.nota_id = n.id
     where n.empresa_id = any (p_empresas) and n.estado not in ('borrador', 'anulada')
       and n.fecha_emision between p_desde and p_hasta and abs(x.sin_facturar) > 0.004
  ),
  -- Vendedor con el mismo nombre que en las ventas (las N/E del Excel lo traen escrito distinto, p. ej. sin el segundo
  -- apellido): el nombre exacto sin mayúsculas ni acentos o, si no, el único vendedor que tenga todas sus palabras. Las N/E
  -- nuevas ya traen el vendedor del pedido de Odoo, igual que sus facturas.
  nv as (select distinct btrim(s.vendedor_nombre) nombre from s where nullif(btrim(s.vendedor_nombre), '') is not null),
  vk as (
    select distinct z.k, translate(upper(z.k), 'ÁÉÍÓÚÜÑ', 'AEIOUUN') ku from (
      select btrim(f.vendedor_odoo) k from facturas f where f.empresa_id = any (p_empresas) and exists (select 1 from nv)
      union select btrim(pv.vendedor_odoo) from profit_vendedores pv where pv.empresa_id = any (p_empresas) and exists (select 1 from nv)
      union select btrim(d.vendedor_nombre) from profit_documentos d
       where d.lote = public.profit_lote_vigente() and d.empresa_id = any (p_empresas) and exists (select 1 from nv)) z
    where nullif(z.k, '') is not null
  ),
  mapa as (
    select nv.nombre, coalesce(
      (select min(vk.k) from vk where vk.ku = translate(upper(nv.nombre), 'ÁÉÍÓÚÜÑ', 'AEIOUUN')),
      (select min(vk.k) from vk
        where not exists (select 1 from regexp_split_to_table(translate(upper(nv.nombre), 'ÁÉÍÓÚÜÑ', 'AEIOUUN'), '\s+') w
                           where w <> '' and ' ' || vk.ku || ' ' not like '% ' || w || ' %')
       having count(*) = 1),
      nv.nombre) k
    from nv
  )
  select s.id, s.empresa_id, s.cliente_id,
         coalesce(s.cliente_id::text, 'ne:' || s.empresa_id::text || ':' || public.clasif_norm(s.cliente_nombre)),
         s.cliente_nombre, coalesce((select m.k from mapa m where m.nombre = btrim(s.vendedor_nombre)), 'Sin vendedor'), s.fecha_emision,
         coalesce(s.fecha_vencimiento, s.fecha_emision), concat_ws(' ', s.serie, s.numero), s.pedido_odoo, s.estado,
         i.id, coalesce(i.orden, 0)::integer, i.producto_id, coalesce(i.descripcion, 'Nota de entrega sin detalle de productos'),
         case when i.id is null then 0::numeric else i.cantidad * s.sin_facturar / s.t end,
         i.precio_usd,
         case when i.id is null then s.sin_facturar else i.subtotal_usd * s.sin_facturar / s.t end
    from s
    left join nota_entrega_items i on i.nota_id = s.id and s.t > 0
$$;
comment on function public.ne_ventas_lineas(date, date, uuid[]) is
  'Venta de las notas de entrega por línea (22k): lo no facturado al cierre (ne_saldos), repartido por el subtotal de cada línea. Interna';
revoke execute on function public.ne_ventas_lineas(date, date, uuid[]) from public, anon, authenticated;

-- ── 2. Cubo (Análisis): rama de las N/E y dimensión "Origen" ─────────────
-- Mismas columnas que cubo_base_sql / cubo_base_docs_sql / cubo_base_mensual_sql según el modo; usa $3 desde, $4 hasta, $5 empresas.
create or replace function public.cubo_base_ne_sql(p_modo text)
returns text language plpgsql immutable set search_path = public
as $f$
declare v_l text;
begin
  v_l := $q$
    select 'ne'::text fte, x.empresa_id, x.fecha, 'ne' || x.nota_id::text doc, true es_fac, x.cli,
           coalesce(nullif(x.vendedor, 'Sin vendedor'), '') vendedor,
           coalesce(cl.tipo_cliente, '') tipo_cliente, case when cl.es_empleado then 'Personal' else coalesce(cl.canal, '') end canal, coalesce(cl.segmento, '') segmento,
           coalesce(ct.c1, '') categoria, coalesce(ct.c2, '') linea, coalesce(ct.c3, '') sublinea, coalesce(pr.marca, '') marca,
           ''::text categoria_p, ''::text linea_p, ''::text sublinea_p,
           coalesce(x.producto_id::text, 'n:' || nullif(btrim(x.descripcion), ''), '') prod,
           x.cantidad cant, x.neto_usd neto, 0::numeric fin, pc.costo costo_u$q$
    || case when p_modo = 'detalle' then $q$,
           'venta'::text tratamiento, e.nombre empresa, x.fecha_vencimiento, 'Nota de entrega'::text tipo_doc,
           x.documento numero, x.pedido_odoo numero_origen, case when x.pedido_odoo is not null then 'Pedido' end doc_origen,
           null::text vendedor_codigo, 'USD'::text moneda, null::numeric tasa_venta,
           cl.codigo cliente_codigo, coalesce(cl.nombre_negocio::text, x.cliente_nombre) cliente_nombre, cl.rif cliente_rif,
           pr.sku::text articulo_codigo, coalesce(pr.nombre::text, x.descripcion) articulo, pr.unidad::text presentacion,
           x.cantidad cantidad_doc, x.precio_usd precio_usd, null::numeric precio_bs, null::numeric descuento_pct, null::numeric descuento_global_pct,
           null::numeric descuento_usd, null::numeric descuento_bs, null::numeric exento_usd, null::numeric base_imponible_usd,
           0::numeric iva_usd, x.neto_usd total_usd,
           null::numeric exento_bs, null::numeric base_imponible_bs, null::numeric iva_bs, null::numeric total_bs,
           case when x.estado = 'pagada' then 'Cobrada' else 'Pendiente' end estatus_cobro,
           cl.dias_credito, cl.condicion_pago, null::text lista_precios, pc.costo_actualizado_at costo_fecha,
           x.renglon renglon,
           coalesce(ct.c1, '') categoria_x, coalesce(ct.c2, '') linea_x, coalesce(ct.c3, '') sublinea_x$q$ else '' end
    || $q$
    from public.ne_ventas_lineas($3, $4, $5) x
    left join public.productos pr on pr.id = x.producto_id
    left join $q$ || public.cubo_niveles_categoria_sql() || $q$ ct on ct.id = pr.categoria_id
    left join public.producto_costos pc on pc.producto_id = x.producto_id and pc.empresa_id = x.empresa_id and pc.costo > 0
    left join public.clientes cl on cl.id = x.cliente_id$q$
    || case when p_modo = 'detalle' then $q$
    left join public.empresas e on e.id = x.empresa_id$q$ else '' end;
  return case p_modo
    when 'docs' then format($q$
    select o.fte, o.empresa_id, o.fecha, o.doc, o.es_fac, o.cli, o.vendedor, o.tipo_cliente, o.canal, o.segmento,
           sum(o.cant) cant, sum(o.neto) neto, sum(o.fin) fin,
           sum(o.cant * o.costo_u) filter (where o.costo_u is not null) costo, sum(o.neto) filter (where o.costo_u is not null) vcc
    from (%s) o
    group by o.fte, o.empresa_id, o.fecha, o.doc, o.es_fac, o.cli, o.vendedor, o.tipo_cliente, o.canal, o.segmento$q$, v_l)
    when 'mensual' then format($q$
    select o.fte, o.empresa_id, o.fecha, o.doc, o.es_fac, o.cli, o.vendedor, o.tipo_cliente, o.canal, o.segmento, o.categoria, o.linea, o.sublinea,
           o.marca, o.categoria_p, o.linea_p, o.sublinea_p, o.prod, o.cant, o.neto, o.fin, case when o.costo_u is not null then o.cant * o.costo_u end costo,
           case when o.costo_u is not null then o.neto end vcc
    from (%s) o$q$, v_l)
    else v_l end;
end $f$;
revoke execute on function public.cubo_base_ne_sql(text) from public, anon, authenticated;

-- Dimensión "Origen" (fuente): Facturas de Odoo, Profit (histórico) o Notas de entrega. Es de documento.
create or replace function public.cubo_dimension_sql(p_dim text)
returns text language sql immutable set search_path = public
as $function$
  select '(' || case p_dim
    when 'empresa' then 'coalesce(b.empresa_id::text, '''')'
    when 'anio' then 'to_char(b.fecha, ''YYYY'')'
    when 'mes' then 'to_char(b.fecha, ''MM'')'
    when 'anio_mes' then 'to_char(b.fecha, ''YYYY-MM'')'
    when 'vendedor' then 'b.vendedor'
    when 'cliente' then 'b.cli'
    when 'tipo_cliente' then 'b.tipo_cliente'
    when 'canal' then 'b.canal'
    when 'segmento' then 'b.segmento'
    when 'categoria' then 'b.categoria'
    when 'linea' then 'b.linea'
    when 'sublinea' then 'b.sublinea'
    when 'marca' then 'b.marca'
    when 'producto' then 'b.prod'
    when 'categoria_profit' then 'b.categoria_p'
    when 'linea_profit' then 'b.linea_p'
    when 'sublinea_profit' then 'b.sublinea_p'
    when 'fuente' then 'b.fte'
  end || ') collate "C"';
$function$;
revoke execute on function public.cubo_dimension_sql(text) from public, anon, authenticated;

create or replace function public.cubo_dimensiones_documento()
returns text[] language sql immutable set search_path = public
as $function$
  select array['empresa', 'anio', 'mes', 'anio_mes', 'vendedor', 'cliente', 'tipo_cliente', 'canal', 'segmento', 'fuente'];
$function$;
revoke execute on function public.cubo_dimensiones_documento() from public, anon, authenticated;

-- cubo_etiqueta_sql: nombre de la dimensión "Origen"
CREATE OR REPLACE FUNCTION public.cubo_etiqueta_sql(p_dim text, k text, a text, p_detalle boolean DEFAULT false)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case
    when p_detalle then case p_dim
      when 'cliente' then format('%s.det', a)
      when 'producto' then format('coalesce(%1$s.det, case when %2$s like ''sku:%%'' then substr(%2$s, 5) end)', a, k)
      else 'null::text' end
    else case p_dim
      when 'empresa' then format('coalesce(%s.nombre, ''Sin empresa'')', a)
      when 'anio' then k
      when 'mes' then format('(array[''Enero'',''Febrero'',''Marzo'',''Abril'',''Mayo'',''Junio'',''Julio'',''Agosto'',''Septiembre'',''Octubre'',''Noviembre'',''Diciembre''])[%s::int]', k)
      when 'anio_mes' then format('(array[''Ene'',''Feb'',''Mar'',''Abr'',''May'',''Jun'',''Jul'',''Ago'',''Sep'',''Oct'',''Nov'',''Dic''])[substr(%1$s, 6, 2)::int] || '' '' || substr(%1$s, 1, 4)', k)
      when 'vendedor' then format('coalesce(nullif(%s, ''''), ''Sin vendedor'')', k)
      when 'cliente' then format('coalesce(%s.nombre, ''Sin cliente'')', a)
      when 'producto' then format('coalesce(%1$s.nombre, case when %2$s like ''sku:%%'' then substr(%2$s, 5) when %2$s like ''n:%%'' then substr(%2$s, 3) end, ''Sin producto (notas financieras)'')', a, k)
      when 'tipo_cliente' then format('coalesce(nullif(%s, ''''), ''Sin tipo de cliente'')', k)
      when 'canal' then format('coalesce(nullif(%s, ''''), ''Sin canal'')', k)
      when 'segmento' then format('coalesce(nullif(%s, ''''), ''Sin segmento'')', k)
      when 'categoria' then format('coalesce(nullif(%s, ''''), ''Sin categoría'')', k)
      when 'linea' then format('coalesce(nullif(%s, ''''), ''Sin línea'')', k)
      when 'sublinea' then format('coalesce(nullif(%s, ''''), ''Sin sub-línea'')', k)
      when 'marca' then format('coalesce(nullif(%s, ''''), ''Sin marca'')', k)
      when 'categoria_profit' then format('coalesce(nullif(%s, ''''), ''Sin categoría de Profit'')', k)
      when 'linea_profit' then format('coalesce(nullif(%s, ''''), ''Sin línea de Profit'')', k)
      when 'sublinea_profit' then format('coalesce(nullif(%s, ''''), ''Sin sub-línea de Profit'')', k)
      when 'fuente' then format('case %1$s when ''odoo'' then ''Facturas de Odoo'' when ''profit'' then ''Profit (histórico)'' when ''ne'' then ''Notas de entrega'' else %1$s end', k)
    end
  end;
$function$;

revoke execute on function public.cubo_etiqueta_sql(text, text, text, boolean) from public, anon, authenticated;

-- cubo_busqueda_sql: nombre de los clientes de N/E sin cliente de GUDS (clave 'ne:')
CREATE OR REPLACE FUNCTION public.cubo_busqueda_sql(p_dim text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case p_dim
    when 'cliente' then $q$select c.id::text k, c.nombre_negocio::text nombre, c.rif::text det from public.clientes c
      union all
      select 'p:' || empresa_id::text || ':' || coalesce(cliente_codigo, ''), max(cliente_nombre), max(coalesce(cliente_rif, cliente_codigo))
      from public.profit_documentos where lote = $6 and cliente_id is null group by 1
      union all
      select 'ne:' || empresa_id::text || ':' || public.clasif_norm(cliente_nombre), max(cliente_nombre), null::text
      from public.notas_entrega where cliente_id is null group by 1$q$
    when 'producto' then $q$select p.id::text k, p.nombre::text nombre, p.sku::text det from public.productos p
      union all
      select 'sku:' || upper(articulo_codigo), max(descripcion), max(articulo_codigo)
      from public.profit_articulos where lote = $6 and producto_id is null group by 1$q$
    when 'empresa' then $q$select e.id::text k, e.nombre_corto::text nombre, null::text det from public.empresas e$q$
  end;
$function$;

revoke execute on function public.cubo_busqueda_sql(text) from public, anon, authenticated;

-- ── 3. Funciones de reporte con p_ne (cambia lo que devuelven: se reemplazan) ─────
drop function if exists public.reporte_ventas_comparativo(date, date, text, text);
drop function if exists public.reporte_ventas(date, date, text, text, boolean);
drop function if exists public.reporte_metas_vendedores(date, date);
drop function if exists public.reporte_ventas_cubo_json(date, date, text[], text, jsonb, text, boolean);
drop function if exists public.reporte_ventas_cubo(date, date, text[], text, jsonb, text, boolean);
drop function if exists public.reporte_ventas_lineas(date, date, text, jsonb);

-- Reportes → Ventas: ne_usd (parte de N/E, ya incluida en neto_usd) y ne_documentos (N/E del grupo). Facturado (bruto_usd) y
-- las facturas siguen siendo solo fiscales.
CREATE OR REPLACE FUNCTION public.reporte_ventas(p_desde date, p_hasta date, p_agrupar text, p_fuente text DEFAULT 'ambas'::text, p_conteos boolean DEFAULT true, p_ne boolean DEFAULT false)
 RETURNS TABLE(clave text, etiqueta text, detalle text, documentos bigint, clientes bigint, cantidad numeric, bruto_usd numeric, nc_usd numeric, neto_usd numeric, profit_usd numeric, financieras_usd numeric, fuente text, ne_usd numeric, ne_documentos bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET work_mem TO '16MB'
AS $function$
#variable_conflict use_column
declare
  v_fuente text := coalesce(p_fuente, 'ambas');
  v_odoo boolean;
  v_profit boolean;
  v_emp uuid[];
  v_lote bigint;
  -- 22k: notas de entrega (lo no facturado al cierre del período), aparte en ne_usd; solo con permiso de verlas (como Ventas vs deuda)
  v_ne boolean := coalesce(p_ne, false) and public.puede('notas_entrega', 'ver');
begin
  perform public.exigir_permiso_reportes();
  if v_fuente not in ('ambas', 'odoo', 'profit') then
    raise exception 'Fuente no válida: % (ambas, odoo o profit)', p_fuente using errcode = '22023';
  end if;
  v_odoo := v_fuente in ('ambas', 'odoo');
  v_profit := v_fuente in ('ambas', 'profit');
  v_emp := public.empresas_visibles();
  v_lote := case when v_profit then public.profit_lote_vigente() end;

  if p_agrupar in ('producto', 'categoria') and not coalesce(p_conteos, true) then
    -- Sin conteos: solo sumas, agregadas por hash (sin ordenar)
    return query
    with d as (select * from public.documentos_venta(p_desde, p_hasta) where v_odoo),
    l as (
      select 'odoo'::text fte, d.tipo = 'nota_credito' es_nc, i.producto_id, i.sku_producto sku, i.nombre_producto nombre, null::text cat_profit,
             null::uuid cat_eq, case when d.tipo = 'nota_credito' then -i.cantidad else i.cantidad end cant, i.subtotal * d.factor usd
      from d join factura_items i on i.factura_id = d.id
      union all
      select 'profit', v.tipo = 'devolucion', v.producto_id, v.articulo_codigo, v.articulo_descripcion, nullif(trim(v.categoria), ''), pq.categoria_id,
             v.cantidad, v.neto_usd
      from ventas_historicas v
      left join profit_categorias pq on pq.empresa_id = v.empresa_id and pq.categoria_profit = btrim(coalesce(v.categoria, ''))
        and pq.linea_profit = btrim(coalesce(v.linea, ''))
      where v.lote = v_lote and v.tratamiento = 'venta' and v.fecha between p_desde and p_hasta and v.empresa_id = any(v_emp)
      union all
      select 'ne', false, x.producto_id, null::text, x.descripcion, null::text, null::uuid, x.cantidad, x.neto_usd
      from public.ne_ventas_lineas(p_desde, p_hasta, v_emp) x
      where v_ne
    ), e1 as (
      select case when p_agrupar = 'producto' then coalesce(l.producto_id::text, l.sku, l.nombre)
                  else coalesce(pr.categoria_id::text, l.cat_eq::text, 'profit:' || upper(l.cat_profit), 'sin') end k,
             coalesce(l.producto_id::text, l.sku, l.nombre) pk, sum(l.cant) cant,
             sum(l.usd) filter (where not l.es_nc and l.fte <> 'ne') fac, sum(l.usd) filter (where l.es_nc) nc, sum(l.usd) usd,
             sum(l.usd) filter (where l.fte = 'profit') prof, sum(l.usd) filter (where l.fte = 'ne') ne, bool_or(l.fte = 'odoo') hay_odoo, bool_or(l.fte = 'profit') hay_profit,
             max(l.producto_id::text) prod, max(l.nombre) nombre, max(l.sku) sku, max(l.cat_profit) cat_profit
      from l left join productos pr on pr.id = l.producto_id
      group by 1, 2
    ), g as (
      select e1.k, count(*) n, sum(e1.cant) cant, sum(e1.fac) fac, sum(e1.nc) nc, sum(e1.usd) usd, sum(e1.prof) prof, sum(e1.ne) ne,
             bool_or(e1.hay_odoo) hay_odoo, bool_or(e1.hay_profit) hay_profit,
             max(e1.prod) prod, max(e1.nombre) nombre, max(e1.sku) sku, max(e1.cat_profit) cat_profit
      from e1 group by e1.k
    )
    select g.k,
           case when p_agrupar = 'producto' then coalesce(p.nombre, g.nombre)
                else coalesce(c.nombre, g.cat_profit || ' (Profit)', 'Sin categoría') end::text,
           case when p_agrupar = 'producto' then coalesce(p.sku, g.sku) else g.n::text || ' productos' end::text,
           null::bigint, null::bigint, round(g.cant, 2), round(g.fac, 2), round(coalesce(g.nc, 0), 2), round(g.usd, 2), round(coalesce(g.prof, 0), 2), 0::numeric,
           case when g.hay_odoo and g.hay_profit then 'ambas' when g.hay_profit then 'profit' else 'odoo' end,
           round(coalesce(g.ne, 0), 2), null::bigint
    from g
    left join productos p on p_agrupar = 'producto' and p.id = g.prod::uuid
    left join categorias c on p_agrupar = 'categoria' and c.id::text = g.k
    order by 9 desc nulls last;
  elsif p_agrupar in ('producto', 'categoria') then
    -- Líneas de las dos fuentes con claves cortas: documento de Odoo (uuid) o de Profit (entero), que no se cruzan, y cliente
    -- (uuid de GUDS o, sin pareja, uno derivado del código de Profit). Se agrupa primero por (grupo, cliente): cada documento
    -- es de un solo cliente, así que sumar los documentos de cada cliente da el total exacto sin volver a ordenar.
    return query
    with d as (select * from public.documentos_venta(p_desde, p_hasta) where v_odoo),
    l as (
      select 'odoo'::text fte, d.id doc_o, null::integer doc_p, d.cliente_id cli, d.tipo = 'nota_credito' es_nc, i.producto_id,
             i.sku_producto sku, i.nombre_producto nombre, null::text cat_profit, null::uuid cat_eq,
             case when d.tipo = 'nota_credito' then -i.cantidad else i.cantidad end cant, i.subtotal * d.factor usd
      from d join factura_items i on i.factura_id = d.id
      union all
      select 'profit', null::uuid, v.documento, coalesce(v.cliente_id, md5(v.empresa_id::text || ':' || coalesce(v.cliente_codigo, ''))::uuid),
             v.tipo = 'devolucion', v.producto_id, v.articulo_codigo, v.articulo_descripcion, nullif(trim(v.categoria), ''), pq.categoria_id,
             v.cantidad, v.neto_usd
      from ventas_historicas v
      left join profit_categorias pq on pq.empresa_id = v.empresa_id and pq.categoria_profit = btrim(coalesce(v.categoria, ''))
        and pq.linea_profit = btrim(coalesce(v.linea, ''))
      where v.lote = v_lote and v.tratamiento = 'venta' and v.fecha between p_desde and p_hasta and v.empresa_id = any(v_emp)
      union all
      select 'ne', x.nota_id, null::integer, coalesce(x.cliente_id, md5(x.cli)::uuid), false, x.producto_id, null::text, x.descripcion,
             null::text, null::uuid, x.cantidad, x.neto_usd
      from public.ne_ventas_lineas(p_desde, p_hasta, v_emp) x
      where v_ne
    ), lk as (
      -- Solo claves y montos (las etiquetas se buscan al final, por grupo)
      select case when p_agrupar = 'producto' then coalesce(l.producto_id::text, l.sku, l.nombre)
                  else coalesce(pr.categoria_id::text, l.cat_eq::text, 'profit:' || upper(l.cat_profit), 'sin') end k,
             coalesce(l.producto_id::text, l.sku, l.nombre) pk, l.fte, l.doc_o, l.doc_p, l.cli, l.es_nc, l.producto_id, l.sku, l.nombre,
             l.cat_profit, l.cant, l.usd
      from l left join productos pr on pr.id = l.producto_id
    ), e1 as (
      select lk.k, lk.cli, count(distinct lk.doc_o) + count(distinct lk.doc_p) docs, sum(lk.cant) cant,
             sum(lk.usd) filter (where not lk.es_nc and lk.fte <> 'ne') fac, sum(lk.usd) filter (where lk.es_nc) nc, sum(lk.usd) usd,
             sum(lk.usd) filter (where lk.fte = 'profit') prof, sum(lk.usd) filter (where lk.fte = 'ne') ne, bool_or(lk.fte = 'odoo') hay_odoo, bool_or(lk.fte = 'profit') hay_profit,
             max(lk.producto_id::text) prod, max(lk.nombre) nombre, max(lk.sku) sku, max(lk.cat_profit) cat_profit
      from lk group by lk.k, lk.cli
    ), np as (
      select lk.k, count(distinct lk.pk) n from lk where p_agrupar = 'categoria' group by lk.k
    ), g as (
      select e1.k, sum(e1.docs)::bigint docs, count(e1.cli) clis, sum(e1.cant) cant, sum(e1.fac) fac, sum(e1.nc) nc, sum(e1.usd) usd,
             sum(e1.prof) prof, sum(e1.ne) ne, bool_or(e1.hay_odoo) hay_odoo, bool_or(e1.hay_profit) hay_profit,
             max(e1.prod) prod, max(e1.nombre) nombre, max(e1.sku) sku, max(e1.cat_profit) cat_profit
      from e1 group by e1.k
    )
    select g.k,
           case when p_agrupar = 'producto' then coalesce(p.nombre, g.nombre)
                else coalesce(c.nombre, g.cat_profit || ' (Profit)', 'Sin categoría') end::text,
           case when p_agrupar = 'producto' then coalesce(p.sku, g.sku) else np.n::text || ' productos' end::text,
           g.docs, g.clis, round(g.cant, 2), round(g.fac, 2), round(coalesce(g.nc, 0), 2), round(g.usd, 2), round(coalesce(g.prof, 0), 2), 0::numeric,
           case when g.hay_odoo and g.hay_profit then 'ambas' when g.hay_profit then 'profit' else 'odoo' end,
           round(coalesce(g.ne, 0), 2), null::bigint
    from g
    left join productos p on p_agrupar = 'producto' and p.id = g.prod::uuid
    left join categorias c on p_agrupar = 'categoria' and c.id::text = g.k
    left join np on np.k = g.k
    order by 9 desc nulls last;
  else
    return query
    with d as (
      select 'odoo'::text fte, dv.id::text doc, dv.empresa_id, dv.cliente_id::text cli, dv.tipo, dv.fecha, dv.vendedor,
             dv.neto_usd neto, 0::numeric fin, null::text cli_nombre, null::text cli_detalle
      from public.documentos_venta(p_desde, p_hasta) dv
      where v_odoo
      union all
      select 'profit', 'p' || v.documento, v.empresa_id,
             coalesce(v.cliente_id::text, 'profit:' || v.empresa_id::text || ':' || coalesce(v.cliente_codigo, '')),
             case v.tipo when 'factura' then 'factura' when 'devolucion' then 'nota_credito' else 'financiera' end,
             v.fecha, coalesce(nullif(trim(pv.vendedor_odoo), ''), nullif(v.vendedor_nombre, ''), 'Sin vendedor'),
             case when v.tratamiento = 'venta' then v.neto_usd else 0 end, case when v.tratamiento = 'financiera' then v.neto_usd else 0 end,
             v.cliente_nombre, coalesce(v.cliente_rif, v.cliente_codigo)
      from profit_documentos v
      left join profit_vendedores pv on pv.empresa_id = v.empresa_id and pv.codigo_profit = coalesce(v.vendedor_codigo, '')
        and pv.nombre_profit = coalesce(v.vendedor_nombre, '')
      where v.lote = v_lote and v.tratamiento in ('venta', 'financiera') and v.fecha between p_desde and p_hasta and v.empresa_id = any(v_emp)
      union all
      select 'ne', 'ne' || x.nota_id::text, x.empresa_id, x.cli, 'nota_entrega', x.fecha, x.vendedor,
             sum(x.neto_usd), 0::numeric, max(x.cliente_nombre), null::text
      from public.ne_ventas_lineas(p_desde, p_hasta, v_emp) x
      where v_ne
      group by x.nota_id, x.empresa_id, x.cli, x.fecha, x.vendedor
    ), k as (
      select d.*, case p_agrupar when 'mes' then to_char(d.fecha, 'YYYY-MM') when 'vendedor' then d.vendedor
                                 when 'cliente' then d.cli else coalesce(d.empresa_id::text, 'compartido') end k
      from d
    )
    select k.k,
           case p_agrupar when 'cliente' then coalesce(max(cl.nombre_negocio), max(k.cli_nombre), '—')
                          when 'empresa' then coalesce(max(e.nombre_corto), 'Compartido') else k.k end::text,
           case p_agrupar when 'cliente' then coalesce(max(nullif(concat_ws(' · ', cl.rif, cl.ciudad), '')), max(k.cli_detalle)) else null end::text,
           count(distinct k.doc) filter (where k.tipo = 'factura'), count(distinct k.cli), null::numeric,
           round(coalesce(sum(k.neto) filter (where k.tipo = 'factura'), 0), 2), round(coalesce(sum(k.neto) filter (where k.tipo = 'nota_credito'), 0), 2),
           round(sum(k.neto), 2), round(coalesce(sum(k.neto) filter (where k.fte = 'profit'), 0), 2), round(coalesce(sum(k.fin), 0), 2),
           case when bool_or(k.fte = 'odoo') and bool_or(k.fte = 'profit') then 'ambas' when bool_or(k.fte = 'profit') then 'profit' else 'odoo' end,
           round(coalesce(sum(k.neto) filter (where k.fte = 'ne'), 0), 2), count(distinct k.doc) filter (where k.fte = 'ne')
    from k
    left join clientes cl on cl.id = (case when k.cli !~ '^(profit|ne):' then k.cli::uuid end)
    left join empresas e on e.id = k.empresa_id
    group by k.k
    order by case when p_agrupar = 'mes' then k.k end, 9 desc nulls last;
  end if;
end $function$;

revoke execute on function public.reporte_ventas(date, date, text, text, boolean, boolean) from public, anon;
grant execute on function public.reporte_ventas(date, date, text, text, boolean, boolean) to authenticated;

CREATE OR REPLACE FUNCTION public.reporte_ventas_comparativo(p_desde date, p_hasta date, p_agrupar text DEFAULT 'empresa'::text, p_fuente text DEFAULT 'ambas'::text, p_ne boolean DEFAULT false)
 RETURNS TABLE(clave text, etiqueta text, detalle text, actual_usd numeric, anterior_usd numeric, anio_anterior_usd numeric, var_anterior_usd numeric, var_anterior_pct numeric, var_anio_usd numeric, var_anio_pct numeric, facturas_actual bigint, facturas_anterior bigint, facturas_anio_anterior bigint, bruto_actual_usd numeric, bruto_anterior_usd numeric, bruto_anio_anterior_usd numeric, profit_actual_usd numeric, profit_anterior_usd numeric, profit_anio_anterior_usd numeric, fuente text, anterior_desde date, anterior_hasta date, anio_desde date, anio_hasta date, ne_actual_usd numeric, ne_anterior_usd numeric, ne_anio_anterior_usd numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  with a as (select * from public.reporte_ventas(p_desde, p_hasta, p_agrupar, p_fuente, v_conteos, p_ne)),
       p as (select * from public.reporte_ventas(v_ad, v_ah, p_agrupar, p_fuente, v_conteos, p_ne)),
       y as (select * from public.reporte_ventas(v_yd, v_yh, p_agrupar, p_fuente, v_conteos, p_ne)),
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
         v_ad, v_ah, v_yd, v_yh,
         coalesce(a.ne_usd, 0), coalesce(p.ne_usd, 0), coalesce(y.ne_usd, 0)
  from k
  left join a on a.clave = k.clave
  left join p on p.clave = k.clave
  left join y on y.clave = k.clave
  order by 4 desc, 5 desc, 6 desc;
end $function$;

revoke execute on function public.reporte_ventas_comparativo(date, date, text, text, boolean) from public, anon;
grant execute on function public.reporte_ventas_comparativo(date, date, text, text, boolean) to authenticated;

-- Reportes → Metas
CREATE OR REPLACE FUNCTION public.reporte_metas_vendedores(p_desde date, p_hasta date, p_ne boolean DEFAULT false)
 RETURNS TABLE(vendedor_id uuid, vendedor text, email text, activo boolean, clientes bigint, anio integer, mes integer, desde date, hasta date, meta_usd numeric, venta_usd numeric, facturas bigint, cumplimiento_pct numeric, brecha_usd numeric, en_curso boolean, dias_habiles integer, dias_transcurridos integer, proyeccion_usd numeric, proyeccion_pct numeric, ne_usd numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_visibles uuid[];
  v_hoy date := (now() at time zone 'America/Caracas')::date;
  v_ini date;
  v_fin date;
  v_ne boolean := coalesce(p_ne, false) and public.puede('notas_entrega', 'ver');   -- 22k
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
    select v.vid, v.m_ini, sum(v.neto) neto, sum(v.facturas)::bigint facturas, sum(v.ne) ne from (
      select c.vendedor_asignado_id vid, date_trunc('month', d.fecha)::date m_ini, d.neto_usd neto, (d.tipo = 'factura')::int facturas, 0::numeric ne
      from public.documentos_venta(v_ini, v_fin) d join clientes c on c.id = d.cliente_id
      where c.vendedor_asignado_id is not null
      union all
      -- 22k: las notas de entrega (lo no facturado) cuentan como venta del vendedor del cliente
      select c.vendedor_asignado_id, date_trunc('month', x.fecha)::date, x.neto_usd, 0, x.neto_usd
      from public.ne_ventas_lineas(v_ini, v_fin, v_visibles) x join clientes c on c.id = x.cliente_id
      where v_ne and c.vendedor_asignado_id is not null
    ) v
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
           round(coalesce(met.meta, 0), 2) meta, round(coalesce(ven.neto, 0), 2) venta, coalesce(ven.facturas, 0) facturas, round(coalesce(ven.ne, 0), 2) ne,
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
         case when f.meta > 0 and f.dt > 0 then round(100 * (case when f.en_curso then f.venta / f.dt * f.dh else f.venta end) / f.meta, 2) end,
         f.ne
  from filas f
  order by f.m_ini, f.venta desc, f.nombre;
end $function$;

revoke execute on function public.reporte_metas_vendedores(date, date, boolean) from public, anon;
grant execute on function public.reporte_metas_vendedores(date, date, boolean) to authenticated;

-- Vendedores → Metas y el resumen del portal del vendedor: la venta del mes incluye las N/E (campo aparte 'ne' / 'notas_entrega')
CREATE OR REPLACE FUNCTION public.metas_vendedores(p_anio integer, p_mes integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_visibles uuid[] := public.empresas_visibles();
  v_activa uuid := public.empresa_activa();
  v_desde date;
  v_hasta date;
  v_res jsonb;
  v_ne boolean := public.puede('notas_entrega', 'ver');   -- 22k: como en Reportes → Metas
begin
  if not (public.es_personal_admin() and public.puede('usuarios', 'ver')) then
    raise exception 'No tienes permiso para ver las metas' using errcode = '42501';
  end if;
  if p_mes not between 1 and 12 or p_anio not between 2020 and 2100 then
    raise exception 'Mes no válido' using errcode = '22023';
  end if;
  v_desde := make_date(p_anio, p_mes, 1);
  v_hasta := (v_desde + interval '1 month - 1 day')::date;

  with
  ven as (
    select v.vid, sum(v.neto) neto, sum(v.facturas)::bigint facturas, sum(v.ne) ne from (
      select c.vendedor_asignado_id vid, d.neto_usd neto, (d.tipo = 'factura')::int facturas, 0::numeric ne
        from public.documentos_venta(v_desde, v_hasta) d join clientes c on c.id = d.cliente_id
       where c.vendedor_asignado_id is not null
      union all
      -- 22k: las notas de entrega (lo no facturado) cuentan como venta
      select c.vendedor_asignado_id, x.neto_usd, 0, x.neto_usd
        from public.ne_ventas_lineas(v_desde, v_hasta, v_visibles) x join clientes c on c.id = x.cliente_id
       where v_ne and c.vendedor_asignado_id is not null) v
     group by 1
  ),
  met as (
    select m.vendedor_id vid,
           sum(m.meta_ventas) filter (where m.empresa_id is null or m.empresa_id = any(v_visibles)) meta,
           max(m.meta_ventas) filter (where m.empresa_id = v_activa) meta_empresa
      from metas_vendedor m where m.anio = p_anio and m.mes = p_mes and coalesce(m.meta_ventas, 0) > 0
     group by 1
  ),
  cli as (
    select c.vendedor_asignado_id vid, count(*) n from clientes c
     where c.activo and not c.es_empleado and c.vendedor_asignado_id is not null and (c.empresa_id is null or c.empresa_id = any(v_visibles))
     group by 1
  )
  select jsonb_build_object(
    'desde', v_desde, 'hasta', v_hasta, 'empresa_activa', v_activa,
    'vendedores', coalesce(jsonb_agg(jsonb_build_object(
        'id', u.id, 'nombre', btrim(concat_ws(' ', u.nombre, u.apellido)), 'email', u.email, 'activo', coalesce(u.activo, true),
        'clientes', coalesce(cli.n, 0), 'meta', round(coalesce(met.meta, 0), 2), 'meta_empresa', met.meta_empresa,
        'venta', round(coalesce(ven.neto, 0), 2), 'facturas', coalesce(ven.facturas, 0), 'ne', round(coalesce(ven.ne, 0), 2))
      order by coalesce(u.activo, true) desc, coalesce(ven.neto, 0) desc, u.nombre), '[]'::jsonb))
    into v_res
    from usuarios u
    left join ven on ven.vid = u.id
    left join met on met.vid = u.id
    left join cli on cli.vid = u.id
   where u.role = 'vendedor' and not u.es_prueba
     and (met.vid is not null or ven.vid is not null
          or (coalesce(u.activo, true) and public.vendedor_empresas(u.id) && v_visibles));
  return v_res;
end $function$;

CREATE OR REPLACE FUNCTION public.resumen_vendedor(p_detalle boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_usuario uuid := public.usuario_actual_id();
  v_visibles uuid[] := public.empresas_visibles();
  v_hoy date := (now() at time zone 'America/Caracas')::date;
  v_mes date := date_trunc('month', now() at time zone 'America/Caracas')::date;
  v_fin date := (date_trunc('month', now() at time zone 'America/Caracas') + interval '1 month - 1 day')::date;
  v_res jsonb;
begin
  if v_usuario is null then
    raise exception 'Inicia sesión para ver tu resumen' using errcode = '42501';
  end if;

  with
  -- Cartera: clientes activos asignados (lo que lista "Mis clientes")
  cartera as (
    select c.id, coalesce(c.limite_credito, 0) limite from clientes c
    where c.vendedor_asignado_id = v_usuario and c.activo
      and (c.empresa_id is null or c.empresa_id = any(v_visibles))
  ),
  -- Todos sus clientes asignados (activos o no): lo que ve por RLS en pedidos y cobros
  mis as (
    select c.id from clientes c where c.vendedor_asignado_id = v_usuario
  ),
  fac as (
    select f.cliente_id, f.saldo_usd, v_hoy - coalesce(f.fecha_vencimiento, f.fecha_emision, v_hoy) dias
    from facturas f join cartera c on c.id = f.cliente_id
    where f.estado = 'posted' and abs(f.saldo_usd) > 0.009
      and (f.empresa_id is null or f.empresa_id = any(v_visibles))
  ),
  por_cliente as (
    select c.id cliente_id, c.limite,
      coalesce(sum(f.saldo_usd) filter (where f.saldo_usd > 0), 0) por_cobrar,
      coalesce(sum(f.saldo_usd) filter (where f.saldo_usd < 0), 0) a_favor,
      coalesce(sum(f.saldo_usd) filter (where f.saldo_usd > 0 and f.dias > 0), 0) vencido,
      count(*) filter (where f.saldo_usd > 0) facturas,
      coalesce(max(f.dias) filter (where f.saldo_usd > 0 and f.dias > 0), 0) dias_mora
    from cartera c left join fac f on f.cliente_id = c.id
    group by c.id, c.limite
  ),
  ped as (
    select o.estado::text estado, o.aprobacion, coalesce(o.total, 0) total,
           (coalesce(o.fecha_pedido, o.created_at) at time zone 'America/Caracas')::date fecha
    from ordenes o
    where (o.cliente_id in (select id from mis) or o.vendedor_id = v_usuario)
      and (o.empresa_id is null or o.empresa_id = any(v_visibles))
  ),
  pag as (
    select p.estado::text estado, coalesce(p.monto, 0) monto, coalesce(p.es_igtf, false) igtf,
           p.fecha_pago fecha
    from pagos p
    where p.cliente_id in (select id from mis)
      and (p.empresa_id is null or p.empresa_id = any(v_visibles))
  ),
  ven0 as (
    select coalesce(sum(d.neto_usd), 0) neto, count(*) filter (where d.tipo = 'factura') facturas,
           count(*) filter (where d.tipo = 'nota_credito') notas_credito
    from public.documentos_venta(v_mes, v_fin) d
    where d.cliente_id in (select id from mis)
  ),
  -- 22k: las notas de entrega (lo no facturado) cuentan como venta del mes
  vne as (
    select coalesce(sum(x.neto_usd), 0) ne from public.ne_ventas_lineas(v_mes, v_fin, v_visibles) x
    where x.cliente_id in (select id from mis)
  ),
  ven as (select ven0.neto + vne.ne neto, ven0.facturas, ven0.notas_credito, vne.ne from ven0, vne)
  select jsonb_build_object(
    'hoy', v_hoy,
    'mes_desde', v_mes,
    'mes_hasta', v_fin,
    'clientes', (select count(*) from cartera),
    -- Clientes activos por empresa permitida (para ofrecer el cambio si la empresa activa no tiene ninguno)
    'clientes_por_empresa', (select coalesce(jsonb_object_agg(x.empresa_id, x.n), '{}'::jsonb) from (
        select c.empresa_id, count(*) n from clientes c
        where c.vendedor_asignado_id = v_usuario and c.activo and c.empresa_id = any(public.empresas_permitidas())
        group by c.empresa_id) x),
    'cartera', (select jsonb_build_object(
        'por_cobrar', round(coalesce(sum(pc.por_cobrar), 0), 2),
        'a_favor', round(coalesce(sum(pc.a_favor), 0), 2),
        'neto', round(coalesce(sum(pc.por_cobrar + pc.a_favor), 0), 2),
        'vencido', round(coalesce(sum(pc.vencido), 0), 2),
        'facturas', coalesce(sum(pc.facturas), 0),
        'clientes_con_saldo', count(*) filter (where pc.por_cobrar > 0.009),
        'clientes_a_favor', count(*) filter (where pc.a_favor < -0.009),
        'clientes_excedidos', count(*) filter (where pc.limite > 0 and pc.por_cobrar > pc.limite),
        'tramos', (select jsonb_build_object(
            'por_vencer', round(coalesce(sum(f.saldo_usd) filter (where f.dias <= 0), 0), 2),
            'd1_30', round(coalesce(sum(f.saldo_usd) filter (where f.dias between 1 and 30), 0), 2),
            'd31_60', round(coalesce(sum(f.saldo_usd) filter (where f.dias between 31 and 60), 0), 2),
            'd61_90', round(coalesce(sum(f.saldo_usd) filter (where f.dias between 61 and 90), 0), 2),
            'mas_90', round(coalesce(sum(f.saldo_usd) filter (where f.dias > 90), 0), 2))
          from fac f where f.saldo_usd > 0))
      from por_cliente pc),
    'ventas_mes', (select jsonb_build_object('neto', round(ven.neto, 2), 'facturas', ven.facturas, 'notas_credito', ven.notas_credito, 'notas_entrega', round(ven.ne, 2)) from ven),
    -- Meta del mes (cargada por administración por empresa): la suma de las empresas visibles
    'meta_mes', (select jsonb_build_object('meta', round(coalesce(sum(m.meta_ventas), 0), 2), 'cargada', count(*) > 0)
      from metas_vendedor m
      where m.vendedor_id = v_usuario and m.anio = extract(year from v_mes)::int and m.mes = extract(month from v_mes)::int
        and coalesce(m.meta_ventas, 0) > 0
        and (m.empresa_id is null or m.empresa_id = any(v_visibles))),
    'pedidos', (select jsonb_build_object(
        'total', count(*),
        'abiertos', count(*) filter (where p.estado in ('pendiente', 'confirmado', 'procesando', 'enviado') and p.aprobacion is distinct from 'rechazada'),
        'por_aprobar', count(*) filter (where p.aprobacion = 'pendiente'),
        'rechazados', count(*) filter (where p.aprobacion = 'rechazada'),
        'mes_n', count(*) filter (where p.fecha between v_mes and v_fin and p.estado <> 'cancelado'),
        'mes_monto', round(coalesce(sum(p.total) filter (where p.fecha between v_mes and v_fin and p.estado <> 'cancelado'), 0), 2))
      from ped p),
    'cobros', (select jsonb_build_object(
        'total', count(*),
        'pendientes_n', count(*) filter (where g.estado = 'pendiente'),
        'pendientes_monto', round(coalesce(sum(g.monto) filter (where g.estado = 'pendiente'), 0), 2),
        'verificados_mes_n', count(*) filter (where g.estado = 'verificado' and not g.igtf and g.fecha between v_mes and v_fin),
        'verificados_mes_monto', round(coalesce(sum(g.monto) filter (where g.estado = 'verificado' and not g.igtf and g.fecha between v_mes and v_fin), 0), 2),
        'rechazados_mes_n', count(*) filter (where g.estado = 'rechazado' and g.fecha between v_mes and v_fin))
      from pag g),
    'detalle', case when p_detalle then (select coalesce(jsonb_agg(jsonb_build_object(
        'cliente_id', pc.cliente_id, 'por_cobrar', round(pc.por_cobrar, 2), 'a_favor', round(pc.a_favor, 2),
        'vencido', round(pc.vencido, 2), 'facturas', pc.facturas, 'dias_mora', pc.dias_mora)), '[]'::jsonb) from por_cliente pc) end
  ) into v_res;

  return v_res;
end $function$;


-- Reportes → Análisis
CREATE OR REPLACE FUNCTION public.reporte_ventas_cubo(p_desde date, p_hasta date, p_niveles text[], p_fuente text DEFAULT 'ambas'::text, p_filtros jsonb DEFAULT '{}'::jsonb, p_columna text DEFAULT NULL::text, p_conteos boolean DEFAULT true, p_ne boolean DEFAULT false)
 RETURNS TABLE(nivel integer, k1 text, k2 text, k3 text, k4 text, col text, etiqueta text, detalle text, ecol text, venta_usd numeric, nc_usd numeric, unidades numeric, documentos bigint, clientes bigint, precio_promedio numeric, financieras_usd numeric, profit_usd numeric, costo_usd numeric, venta_con_costo_usd numeric, margen_usd numeric, margen_pct numeric, cobertura_costo_pct numeric, fuente text, ve_costo boolean, ne_usd numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET work_mem TO '48MB'
AS $function$
declare
  v_fuente text := coalesce(p_fuente, 'ambas');
  v_niv text[] := coalesce(p_niveles, '{}'::text[]);
  v_col text := nullif(btrim(coalesce(p_columna, '')), '');
  v_conteos boolean := coalesce(p_conteos, true);
  v_dims text[];
  v_por_doc boolean;
  v_resumen boolean;
  v_mensual boolean;
  v_hasta_profit date;
  v_filtros text[];
  v_n integer;
  v_emp uuid[];
  v_lote bigint;
  v_admin boolean;
  v_i integer;
  v_keys text := '';
  v_grp text := '';
  v_nivel text := '0';
  v_sets text[] := '{}';
  v_prefijo text;
  v_out text := '';
  v_lk text := '';
  v_join text := '';
  v_alias text;
  v_d text;
  v_agr text;
  v_sql text;
  v_filas bigint;
  -- 22k: notas de entrega (fuente 'ne'), aparte en ne_usd; solo con permiso de verlas
  v_ne boolean := coalesce(p_ne, false) and public.puede('notas_entrega', 'ver');
begin
  perform public.exigir_permiso_reportes();
  if v_fuente not in ('ambas', 'odoo', 'profit') then
    raise exception 'Fuente no válida: % (ambas, odoo o profit)', p_fuente using errcode = '22023';
  end if;
  if p_desde is null or p_hasta is null or p_desde > p_hasta then
    raise exception 'Período no válido' using errcode = '22023';
  end if;
  v_n := coalesce(array_length(v_niv, 1), 0);
  if v_n > 4 then
    raise exception 'Hasta 4 niveles' using errcode = '22023';
  end if;
  for v_i in 1 .. v_n loop
    if public.cubo_dimension_sql(v_niv[v_i]) is null then
      raise exception 'Nivel no válido: %', v_niv[v_i] using errcode = '22023';
    end if;
    if v_niv[v_i] = any (v_niv[1 : v_i - 1]) then
      raise exception 'Nivel repetido: %', v_niv[v_i] using errcode = '22023';
    end if;
  end loop;
  if v_col is not null and (v_col not in ('anio', 'mes', 'anio_mes', 'empresa') or v_col = any (v_niv)) then
    raise exception 'Columna no válida: % (anio, mes, anio_mes o empresa, distinta de los niveles)', v_col using errcode = '22023';
  end if;

  v_emp := public.empresas_visibles();
  v_lote := case when v_fuente in ('ambas', 'profit') then public.profit_lote_vigente() end;
  v_admin := public.es_personal_admin();
  v_dims := v_niv || case when v_col is not null then array[v_col] else '{}'::text[] end;
  v_filtros := coalesce((select array_agg(k) from jsonb_object_keys(case when jsonb_typeof(p_filtros) = 'object' then p_filtros else '{}'::jsonb end) k), '{}'::text[]);
  v_resumen := v_dims <@ public.cubo_dimensiones_documento() and v_filtros <@ public.cubo_dimensiones_documento();
  v_por_doc := not v_resumen and v_conteos and v_dims <@ public.cubo_dimensiones_documento();
  -- Resumen mensual de Profit: sin conteos, fuera del camino por documento y con meses completos en el tramo de Profit
  v_hasta_profit := (select hasta from public.profit_cargas where id = v_lote);
  v_mensual := not v_resumen and not v_conteos and v_lote is not null
    and extract(day from p_desde) = 1
    and (p_hasta = (date_trunc('month', p_hasta) + interval '1 month - 1 day')::date or p_hasta >= coalesce(v_hasta_profit, p_hasta))
    and exists (select 1 from public.profit_articulos_mes where lote = v_lote);

  -- Claves de los niveles (k1..kn) y de la columna (kc)
  for v_i in 1 .. v_n loop
    v_keys := v_keys || format(', %s k%s', public.cubo_dimension_sql(v_niv[v_i]), v_i);
    v_grp := v_grp || format(', k%s', v_i);
    v_nivel := v_nivel || format(' + (1 - grouping(k%s))', v_i);
  end loop;
  if v_col is not null then
    v_keys := v_keys || format(', %s kc', public.cubo_dimension_sql(v_col));
    v_grp := v_grp || ', kc';
  end if;

  -- Conjuntos: (k1..kn), (k1..kn-1), …, () y, con columna, los mismos con kc
  for v_i in reverse v_n .. 0 loop
    v_prefijo := (select string_agg(format('k%s', j), ', ' order by j) from generate_series(1, v_i) j);
    v_sets := v_sets || format('(%s)', coalesce(v_prefijo, ''));
    if v_col is not null then v_sets := v_sets || format('(%s)', concat_ws(', ', v_prefijo, 'kc')); end if;
  end loop;

  -- Salida por nivel: clave, etiqueta y detalle; las dimensiones con nombre en otra tabla se unen por clave
  for v_i in 1 .. 4 loop
    v_out := v_out || case when v_i <= v_n then format(', g.k%s', v_i) else ', null::text' end;
  end loop;
  v_out := v_out || case when v_col is not null then ', g.kc' else ', null::text' end;
  for v_i in 1 .. v_n + 1 loop
    continue when v_i > v_n and v_col is null;
    v_d := case when v_i <= v_n then v_niv[v_i] else v_col end;
    v_alias := case when v_i <= v_n then format('l%s', v_i) else 'lc' end;
    if public.cubo_busqueda_sql(v_d) is not null then
      v_lk := v_lk || format(E',\n    lk_%s as (%s)', v_d, public.cubo_busqueda_sql(v_d));
      v_join := v_join || format(E'\n    left join lk_%s %s on %s.k = g.%s', v_d, v_alias, v_alias, case when v_i <= v_n then format('k%s', v_i) else 'kc' end);
    end if;
  end loop;
  -- Etiqueta y detalle solo del nivel propio de cada fila (las de los niveles de arriba están en sus filas): la respuesta
  -- pesa la mitad en los análisis grandes (p. ej. Cliente › Categoría › Artículo con todo el historial, ~21 mil filas)
  if v_n = 0 then
    v_out := v_out || ', null::text, null::text';
  else
    v_out := v_out || ', (case g.nivel';
    for v_i in 1 .. v_n loop
      v_out := v_out || format(' when %s then %s', v_i, public.cubo_etiqueta_sql(v_niv[v_i], format('g.k%s', v_i), format('l%s', v_i)));
    end loop;
    v_out := v_out || ' end)::text, (case g.nivel';
    for v_i in 1 .. v_n loop
      v_out := v_out || format(' when %s then %s', v_i, public.cubo_etiqueta_sql(v_niv[v_i], format('g.k%s', v_i), format('l%s', v_i), true));
    end loop;
    v_out := v_out || ' end)::text';
  end if;
  v_out := v_out || case when v_col is not null
    then format(', case when g.kc is not null then (%s)::text end', public.cubo_etiqueta_sql(v_col, 'g.kc', 'lc')) else ', null::text' end;

  -- Agregación: por documento primero (dimensiones de documento con conteos) o directo sobre las líneas
  if v_resumen or v_mensual then
    v_agr := format($q$, g as (
      select %2$s nivel%1$s,
             sum(f.neto) venta, sum(f.neto) filter (where not f.es_fac) nc, sum(f.cant) unidades,
             %4$s,
             sum(f.fin) fin, sum(f.neto) filter (where f.fte = 'profit') prof, sum(f.neto) filter (where f.fte = 'ne') ne, sum(f.costo) costo, sum(f.vcc) vcc,
             bool_or(f.fte = 'odoo') hay_odoo, bool_or(f.fte = 'profit') hay_profit
      from f
      group by grouping sets (%3$s)
    )$q$, v_grp, v_nivel, array_to_string(v_sets, ', '),
      case when v_conteos then 'count(*) filter (where f.es_fac and f.fte <> ''ne'') docs, count(distinct f.cli) filter (where f.es_fac) clis'
           else 'null::bigint docs, null::bigint clis' end);
  elsif v_por_doc then
    v_agr := format($q$, d as (
      select f.doc, f.cli, f.es_fac, f.fte%1$s, sum(f.neto) neto, sum(f.cant) cant, sum(f.fin) fin,
             sum(f.cant * f.costo_u) filter (where f.costo_u is not null) costo, sum(f.neto) filter (where f.costo_u is not null) vcc
      from f group by f.doc, f.cli, f.es_fac, f.fte%1$s
    ), g as (
      select %2$s nivel%1$s,
             sum(d.neto) venta, sum(d.neto) filter (where not d.es_fac) nc, sum(d.cant) unidades,
             count(*) filter (where d.es_fac and d.fte <> 'ne') docs, count(distinct d.cli) filter (where d.es_fac) clis,
             sum(d.fin) fin, sum(d.neto) filter (where d.fte = 'profit') prof, sum(d.neto) filter (where d.fte = 'ne') ne, sum(d.costo) costo, sum(d.vcc) vcc,
             bool_or(d.fte = 'odoo') hay_odoo, bool_or(d.fte = 'profit') hay_profit
      from d
      group by grouping sets (%3$s)
    )$q$, v_grp, v_nivel, array_to_string(v_sets, ', '));
  else
    v_agr := format($q$, g as (
      select %2$s nivel%1$s,
             sum(f.neto) venta, sum(f.neto) filter (where not f.es_fac) nc, sum(f.cant) unidades,
             %4$s,
             sum(f.fin) fin, sum(f.neto) filter (where f.fte = 'profit') prof, sum(f.neto) filter (where f.fte = 'ne') ne,
             sum(f.cant * f.costo_u) filter (where f.costo_u is not null) costo, sum(f.neto) filter (where f.costo_u is not null) vcc,
             bool_or(f.fte = 'odoo') hay_odoo, bool_or(f.fte = 'profit') hay_profit
      from f
      group by grouping sets (%3$s)
    )$q$, v_grp, v_nivel, array_to_string(v_sets, ', '),
      case when v_conteos then 'count(distinct f.doc) filter (where f.es_fac and f.fte <> ''ne'') docs, count(distinct f.cli) filter (where f.es_fac) clis'
           else 'null::bigint docs, null::bigint clis' end);
  end if;

  v_sql := format($q$
    with b as (%s
    ), f as (
      select b.fte, b.doc collate "C" doc, b.es_fac, b.cli collate "C" cli, b.cant, b.neto, b.fin, %s%s
      from b
      where true%s
    )%s%s
    select g.nivel%s,
           round(g.venta, 6), round(coalesce(g.nc, 0), 6), g.unidades, g.docs, g.clis,
           case when g.unidades > 0 then round(g.venta / g.unidades, 4) end,
           round(coalesce(g.fin, 0), 6), round(coalesce(g.prof, 0), 6),
           case when $7 then round(coalesce(g.costo, 0), 6) end, case when $7 then round(coalesce(g.vcc, 0), 6) end,
           case when $7 and g.vcc is not null and g.vcc <> 0 then round(g.vcc - g.costo, 6) end,
           case when $7 and g.vcc > 0 then round(100 * (g.vcc - g.costo) / g.vcc, 2) end,
           case when $7 and g.venta > 0 then least(100, round(100 * coalesce(g.vcc, 0) / g.venta, 1)) end,
           case when g.hay_odoo and g.hay_profit then 'ambas' when g.hay_profit then 'profit' else 'odoo' end,
           $7, round(coalesce(g.ne, 0), 6)
    from g%s
    order by g.nivel, 2, 3, 4, 5, 6$q$,
    case when v_resumen then public.cubo_base_docs_sql(v_fuente in ('ambas', 'odoo'), v_fuente in ('ambas', 'profit'))
         when v_mensual then public.cubo_base_mensual_sql(v_fuente in ('ambas', 'odoo'), v_fuente in ('ambas', 'profit'))
         else public.cubo_base_sql(v_fuente in ('ambas', 'odoo'), v_fuente in ('ambas', 'profit')) end
      || case when v_ne then E'\n    union all' || public.cubo_base_ne_sql(case when v_resumen then 'docs' when v_mensual then 'mensual' else 'lineas' end) else '' end,
    case when v_resumen or v_mensual then 'b.costo, b.vcc' else 'b.costo_u' end,
    v_keys, public.cubo_filtros_sql(p_filtros), v_agr, v_lk, v_out, v_join);

  return query execute v_sql using p_filtros, v_conteos, p_desde, p_hasta, v_emp, v_lote, v_admin;
  get diagnostics v_filas = row_count;
  if v_filas > 40000 then
    raise exception 'El análisis tiene demasiadas filas (%): agrega filtros o quita un nivel', v_filas using errcode = '54000';
  end if;
end $function$;

revoke execute on function public.reporte_ventas_cubo(date, date, text[], text, jsonb, text, boolean, boolean) from public, anon;
grant execute on function public.reporte_ventas_cubo(date, date, text[], text, jsonb, text, boolean, boolean) to authenticated;

create or replace function public.reporte_ventas_cubo_json(p_desde date, p_hasta date, p_niveles text[], p_fuente text default 'ambas',
  p_filtros jsonb default '{}'::jsonb, p_columna text default null, p_conteos boolean default true, p_ne boolean default false)
returns json language plpgsql stable security definer set search_path = public
as $function$
begin
  perform public.exigir_permiso_reportes();
  return (select json_build_object(
    'columnas', json_build_array('nivel', 'k1', 'k2', 'k3', 'k4', 'col', 'etiqueta', 'detalle', 'ecol', 'venta_usd', 'nc_usd', 'unidades',
      'documentos', 'clientes', 'precio_promedio', 'financieras_usd', 'profit_usd', 'costo_usd', 'venta_con_costo_usd', 'margen_usd',
      'margen_pct', 'cobertura_costo_pct', 'fuente', 'ne_usd'),
    'filas', coalesce(json_agg(json_build_array(c.nivel, c.k1, c.k2, c.k3, c.k4, c.col, c.etiqueta, c.detalle, c.ecol,
      c.venta_usd::float8, c.nc_usd::float8, c.unidades::float8, c.documentos, c.clientes, c.precio_promedio::float8, c.financieras_usd::float8,
      c.profit_usd::float8, c.costo_usd::float8, c.venta_con_costo_usd::float8, c.margen_usd::float8, c.margen_pct::float8,
      c.cobertura_costo_pct::float8, c.fuente, c.ne_usd::float8)), '[]'::json),
    've_costo', public.es_personal_admin())
  from public.reporte_ventas_cubo(p_desde, p_hasta, p_niveles, p_fuente, p_filtros, p_columna, p_conteos, p_ne) c);
end $function$;
revoke execute on function public.reporte_ventas_cubo_json(date, date, text[], text, jsonb, text, boolean, boolean) from public, anon;
grant execute on function public.reporte_ventas_cubo_json(date, date, text[], text, jsonb, text, boolean, boolean) to authenticated;

CREATE OR REPLACE FUNCTION public.reporte_ventas_lineas(p_desde date, p_hasta date, p_fuente text DEFAULT 'ambas'::text, p_filtros jsonb DEFAULT '{}'::jsonb, p_ne boolean DEFAULT false)
 RETURNS TABLE(fuente text, tratamiento text, empresa text, fecha date, fecha_vencimiento date, anio integer, mes integer, semana integer, dia_semana text, tipo text, numero text, numero_origen text, documento_origen text, vendedor_codigo text, vendedor text, moneda text, tasa_venta numeric, cliente_codigo text, cliente text, cliente_rif text, tipo_cliente text, canal text, segmento text, articulo_codigo text, articulo text, linea text, sublinea text, marca text, categoria text, cantidad numeric, precio_bs numeric, precio_usd numeric, presentacion text, descuento_renglon_pct numeric, descuento_global_pct numeric, descuento_bs numeric, exento_bs numeric, base_imponible_bs numeric, iva_bs numeric, total_bs numeric, descuento_usd numeric, exento_usd numeric, base_imponible_usd numeric, iva_usd numeric, total_usd numeric, anulado text, ultimo_costo_usd numeric, costo_fecha timestamp with time zone, estatus_cobro text, dias_credito integer, condicion_pago text, lista_precios text, base_ventas_usd numeric, venta_neta_usd numeric, financieras_usd numeric, costo_usd numeric, rentabilidad_usd numeric, categoria_odoo text, linea_odoo text, sublinea_odoo text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET work_mem TO '32MB'
AS $function$
declare
  v_fuente text := coalesce(p_fuente, 'ambas');
  v_emp uuid[];
  v_lote bigint;
  v_admin boolean;
  v_sql text;
  v_filas bigint;
  v_ne boolean := coalesce(p_ne, false) and public.puede('notas_entrega', 'ver');   -- 22k
begin
  perform public.exigir_permiso_reportes();
  if v_fuente not in ('ambas', 'odoo', 'profit') then
    raise exception 'Fuente no válida: % (ambas, odoo o profit)', p_fuente using errcode = '22023';
  end if;
  if p_desde is null or p_hasta is null or p_desde > p_hasta then
    raise exception 'Período no válido' using errcode = '22023';
  end if;
  if p_hasta - p_desde > 400 then
    raise exception 'El detalle se pide por tramos de hasta un año' using errcode = '22023';
  end if;
  v_emp := public.empresas_visibles();
  v_lote := case when v_fuente in ('ambas', 'profit') then public.profit_lote_vigente() end;
  v_admin := public.es_personal_admin();
  if v_fuente = 'profit' and v_lote is null and not v_ne then return; end if;

  v_sql := format($q$
    with b as (%s
    )
    select case when b.fte = 'ne' then 'nota de entrega' else b.fte end, b.tratamiento, b.empresa, b.fecha, b.fecha_vencimiento, extract(year from b.fecha)::int, extract(month from b.fecha)::int,
           extract(week from b.fecha)::int,
           (array['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'])[extract(isodow from b.fecha)::int],
           b.tipo_doc, b.numero, b.numero_origen, b.doc_origen, b.vendedor_codigo, nullif(b.vendedor, ''),
           b.moneda, b.tasa_venta, b.cliente_codigo, b.cliente_nombre, b.cliente_rif, nullif(b.tipo_cliente, ''), nullif(b.canal, ''), nullif(b.segmento, ''),
           b.articulo_codigo, b.articulo, nullif(b.linea_x, ''), nullif(b.sublinea_x, ''), nullif(b.marca, ''), nullif(b.categoria_x, ''), b.cantidad_doc,
           round(b.precio_bs, 6), round(b.precio_usd, 6), b.presentacion, b.descuento_pct, b.descuento_global_pct,
           round(b.descuento_bs, 6), round(b.exento_bs, 6), round(b.base_imponible_bs, 6), round(b.iva_bs, 6), round(b.total_bs, 6),
           round(b.descuento_usd, 6), round(b.exento_usd, 6), round(b.base_imponible_usd, 6), round(b.iva_usd, 6), round(b.total_usd, 6),
           'No'::text, case when $7 then b.costo_u end, case when $7 then b.costo_fecha end, b.estatus_cobro, b.dias_credito,
           b.condicion_pago, b.lista_precios, round(b.neto + b.fin, 6), round(b.neto, 6), round(b.fin, 6),
           case when $7 and b.costo_u is not null then round(b.cant * b.costo_u, 6) end,
           case when $7 and b.costo_u is not null then round(b.neto - b.cant * b.costo_u, 6) end,
           nullif(b.categoria, ''), nullif(b.linea, ''), nullif(b.sublinea, '')
    from b
    where true%s
    order by b.fecha, b.fte, b.numero, b.renglon$q$,
    public.cubo_base_sql(v_fuente in ('ambas', 'odoo'), v_fuente in ('ambas', 'profit'), true)
      || case when v_ne then E'\n    union all' || public.cubo_base_ne_sql('detalle') else '' end,
    public.cubo_filtros_sql(p_filtros));

  return query execute v_sql using p_filtros, true, p_desde, p_hasta, v_emp, v_lote, v_admin;
  get diagnostics v_filas = row_count;
  if v_filas > 45000 then
    raise exception 'El tramo tiene demasiadas líneas (%): pide un período más corto', v_filas using errcode = '54000';
  end if;
end $function$;

revoke execute on function public.reporte_ventas_lineas(date, date, text, jsonb, boolean) from public, anon;
grant execute on function public.reporte_ventas_lineas(date, date, text, jsonb, boolean) to authenticated;

notify pgrst, 'reload schema';

commit;
