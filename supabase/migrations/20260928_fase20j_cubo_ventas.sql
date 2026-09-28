-- ════════════════════════════════════════════════════════════════════════
-- Fase 20j · R4/R6: motor de reporte tipo cubo y detalle de líneas (docs/privado/planes/plan-reportes.md R4 y R6)
--
--   · reporte_ventas_cubo(desde, hasta, niveles, fuente, filtros, columna, conteos): agrupa las líneas de venta de Odoo y
--     del histórico de Profit por hasta 4 dimensiones con subtotales en cada nivel y total general (GROUPING SETS), y
--     opcionalmente por una dimensión de columna (año, mes, año-mes o empresa) para las matrices del Excel.
--       Dimensiones: empresa, anio, mes, anio_mes, vendedor, cliente, tipo_cliente, canal, segmento, categoria, linea,
--       sublinea, marca, producto. Categoría / línea / sub-línea son los niveles del nombre de la categoría de Odoo
--       ("MATERIAL MEDICO QUIRURGICO / GUANTES") o las columnas de Profit; marca, tipo de cliente, canal y segmento solo
--       existen en Profit (en Odoo quedan "sin …" hasta que se clasifiquen en Odoo, R2).
--       Filtros cruzados: {"vendedor": ["CLAVE", …], "categoria": [...], …} con las mismas claves que devuelve el cubo.
--       Medidas: venta neta, NC, unidades, documentos (facturas), clientes (con factura), precio promedio ponderado
--       (venta ÷ unidades), notas financieras de Profit (aparte), parte de Profit, y costo, venta con costo, margen,
--       margen % y cobertura del costo SOLO para el personal de administración (para los demás vienen nulas).
--   · Definición de venta (la misma de reporte_ventas, 18u/19o/20g): Odoo = documentos_venta (facturas y NC publicadas, sin
--     saldos iniciales, sin ND, sin reversos); Profit = facturas − devoluciones (tratamiento "venta"), sin reversos ni ND
--     cambiarias; las notas financieras de Profit van aparte. El total del cubo cuadra con reporte_ventas.
--   · Costo: Odoo = costo promedio actual de producto_costos (fase 20j, fecha en costo_actualizado_at); Profit = último
--     costo del Excel (ultimo_costo_usd). El margen se calcula solo sobre las líneas con costo > 0 (margen % = (venta con
--     costo − costo) ÷ venta con costo) y la cobertura dice qué parte de la venta tiene costo: un producto sin costo nunca
--     da 100 % de margen.
--   · reporte_ventas_cubo_json(...): el mismo cubo en formato compacto (filas como arreglos) para la pantalla Análisis.
--   · reporte_ventas_lineas(desde, hasta, fuente, filtros): detalle de líneas con las columnas de la hoja "Base datos" del
--     Excel (lo exporta la pestaña Análisis por tramos de fecha). El costo y la rentabilidad solo para administración.
--   · Resúmenes de Profit para el rendimiento (el rol authenticated corta a los 8 s):
--       profit_documentos gana costo, venta con costo, tipo de cliente, canal y segmento (cubos por documento);
--       profit_articulos_mes (nuevo): resumen mensual por artículo (cubos por artículo o categoría sin conteos).
--     profit_publicar_carga y profit_emparejar (20g) los mantienen al día; aquí se completan para el lote vigente.
--   · Seguridad: exigir_permiso_reportes() + empresas_visibles() (empresa activa); security definer; anon y public no las
--     ejecutan. Las funciones auxiliares no se ejecutan desde la API.
-- ════════════════════════════════════════════════════════════════════════
begin;

-- Resumen por documento de Profit: costo (último costo del Excel), venta con costo y clasificación del cliente, para que
-- el cubo no recorra las 130 mil líneas cuando agrupa por documento. La publicación de cada lote los llena (misma función
-- de la fase 20g, solo se agregan esas columnas al resumen) y aquí se completan para el lote vigente.
alter table public.profit_documentos
  add column if not exists costo_usd numeric,
  add column if not exists venta_con_costo_usd numeric,
  add column if not exists tipo_cliente text,
  add column if not exists canal text,
  add column if not exists segmento text;
comment on column public.profit_documentos.costo_usd is 'Σ cantidad × último costo de Profit de las líneas con costo (solo lo lee el servidor; lo muestra el cubo a administración)';
-- Como en ventas_historicas (20g), el costo de Profit no se concede a la API: lectura por columnas sin las de costo
revoke select on public.profit_documentos from authenticated;
grant select (lote, documento, empresa_id, tipo, numero, fecha, tratamiento, numero_origen, cliente_codigo, cliente_nombre, cliente_rif,
  cliente_id, cliente_match, vendedor_codigo, vendedor_nombre, descripcion, lineas, cantidad, neto_usd, total_usd, tipo_cliente, canal, segmento)
  on public.profit_documentos to authenticated;
update public.profit_documentos d
   set costo_usd = x.costo, venta_con_costo_usd = x.vcc, tipo_cliente = x.tipo_cliente, canal = x.canal, segmento = x.segmento
  from (select lote, documento, sum(cantidad * ultimo_costo_usd) filter (where ultimo_costo_usd > 0) costo,
               sum(neto_usd) filter (where ultimo_costo_usd > 0) vcc, max(tipo_cliente) tipo_cliente, max(canal) canal, max(segmento) segmento
          from public.ventas_historicas group by lote, documento) x
 where d.lote = x.lote and d.documento = x.documento
   and (d.costo_usd, d.venta_con_costo_usd, d.tipo_cliente, d.canal, d.segmento) is distinct from (x.costo, x.vcc, x.tipo_cliente, x.canal, x.segmento);

-- Resumen mensual por artículo de Profit: una fila por (mes, cliente, vendedor, artículo, clasificación, tipo y tratamiento),
-- ≈ 55 mil filas en vez de 115 mil líneas, con las claves del cubo ya armadas. Lo usa el cubo cuando agrupa por artículo o
-- categoría sin contar documentos y el período son meses completos. Se rearma al publicar un lote y al volver a emparejar.
create table if not exists public.profit_articulos_mes (
  lote bigint not null references public.profit_cargas(id),
  empresa_id uuid not null references public.empresas(id),
  mes date not null,
  es_fac boolean not null,
  tratamiento text not null,
  cli text not null,
  vendedor_codigo text not null,
  vendedor_nombre text not null,
  tipo_cliente text not null,
  canal text not null,
  segmento text not null,
  categoria text not null,
  linea text not null,
  sublinea text not null,
  marca text not null,
  prod text not null,
  cant numeric not null,
  neto numeric not null,
  fin numeric not null,
  costo numeric,
  vcc numeric,
  lineas integer not null
);
create index if not exists profit_articulos_mes_lote_empresa_mes on public.profit_articulos_mes (lote, empresa_id, mes);
comment on table public.profit_articulos_mes is 'Resumen mensual por artículo del histórico de Profit para el cubo de reportes (derivado de ventas_historicas; lo rearman profit_publicar_carga y profit_emparejar)';
alter table public.profit_articulos_mes enable row level security;
revoke all on public.profit_articulos_mes from public, anon, authenticated;

create or replace function public.profit_resumir_articulos_mes(p_lote bigint) returns integer language plpgsql set search_path = public as $$
declare n integer;
begin
  delete from profit_articulos_mes;
  if p_lote is null then return 0; end if;
  insert into profit_articulos_mes (lote, empresa_id, mes, es_fac, tratamiento, cli, vendedor_codigo, vendedor_nombre, tipo_cliente, canal, segmento,
    categoria, linea, sublinea, marca, prod, cant, neto, fin, costo, vcc, lineas)
  select lote, empresa_id, date_trunc('month', fecha)::date, tipo = 'factura', tratamiento,
         coalesce(cliente_id::text, 'p:' || empresa_id::text || ':' || coalesce(cliente_codigo, '')),
         coalesce(vendedor_codigo, ''), coalesce(vendedor_nombre, ''), coalesce(tipo_cliente, ''), coalesce(canal, ''), coalesce(segmento, ''),
         coalesce(categoria, ''), coalesce(linea, ''), coalesce(sublinea, ''), coalesce(marca, ''),
         coalesce(producto_id::text, 'sku:' || upper(articulo_codigo), ''),
         coalesce(sum(cantidad) filter (where tratamiento = 'venta'), 0), coalesce(sum(neto_usd) filter (where tratamiento = 'venta'), 0),
         coalesce(sum(neto_usd) filter (where tratamiento = 'financiera'), 0),
         sum(cantidad * ultimo_costo_usd) filter (where tratamiento = 'venta' and ultimo_costo_usd > 0),
         sum(neto_usd) filter (where tratamiento = 'venta' and ultimo_costo_usd > 0), count(*)
  from ventas_historicas
  where lote = p_lote and tratamiento in ('venta', 'financiera')
  group by 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.profit_resumir_articulos_mes(bigint) from public, anon, authenticated;

create or replace function public.profit_emparejar()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_lote bigint := public.profit_lote_vigente(); v_cli integer; v_prod integer;
begin
  if v_lote is null then return jsonb_build_object('lote', null); end if;
  with entrada as (
    select jsonb_agg(jsonb_build_object('empresa_id', empresa_id, 'cliente_codigo', cliente_codigo, 'nombre', nombre, 'rif', rif, 'facturas', facturas)) j
    from (select empresa_id, coalesce(cliente_codigo, '') cliente_codigo, max(cliente_nombre) nombre, max(cliente_rif) rif,
                 coalesce(jsonb_agg(distinct numero) filter (where tipo = 'factura'), '[]'::jsonb) facturas
          from ventas_historicas where lote = v_lote group by 1, 2) c
  )
  update ventas_historicas v set cliente_id = p.cliente_id, cliente_match = p.metodo
  from public.profit_parejas_clientes((select j from entrada)) p
  where v.lote = v_lote and p.empresa_id = v.empresa_id and p.cliente_codigo = coalesce(v.cliente_codigo, '')
    and (v.cliente_id, v.cliente_match) is distinct from (p.cliente_id, p.metodo);
  get diagnostics v_cli = row_count;

  with entrada as (
    select jsonb_agg(jsonb_build_object('empresa_id', empresa_id, 'articulo_codigo', articulo_codigo)) j
    from (select distinct empresa_id, articulo_codigo from ventas_historicas where lote = v_lote and articulo_codigo is not null) a
  )
  update ventas_historicas v set producto_id = p.producto_id
  from public.profit_parejas_productos((select j from entrada)) p
  where v.lote = v_lote and p.empresa_id = v.empresa_id and p.articulo_codigo = v.articulo_codigo and v.producto_id is distinct from p.producto_id;
  get diagnostics v_prod = row_count;

  update profit_documentos d set cliente_id = x.cliente_id, cliente_match = x.cliente_match
  from (select documento, min(cliente_id::text)::uuid cliente_id, max(cliente_match) cliente_match
        from ventas_historicas where lote = v_lote group by documento) x
  where d.lote = v_lote and d.documento = x.documento and (d.cliente_id, d.cliente_match) is distinct from (x.cliente_id, x.cliente_match);
  update profit_articulos a set producto_id = x.producto_id
  from (select empresa_id, articulo_codigo, min(producto_id::text)::uuid producto_id
        from ventas_historicas where lote = v_lote and articulo_codigo is not null group by 1, 2) x
  where a.lote = v_lote and a.empresa_id = x.empresa_id and a.articulo_codigo = x.articulo_codigo and a.producto_id is distinct from x.producto_id;
  perform public.profit_resumir_articulos_mes(v_lote);   -- el resumen mensual del cubo usa las parejas (20j)
  return jsonb_build_object('lote', v_lote, 'lineas_cliente', v_cli, 'lineas_producto', v_prod);
end $function$;
revoke execute on function public.profit_emparejar() from public, anon, authenticated;

create or replace function public.profit_publicar_carga(p_lote bigint, p_lineas integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_n integer; v_desde date; v_hasta date; v_emp jsonb; v_vend integer; v_rev integer; v_res jsonb;
begin
  if not exists (select 1 from profit_cargas where id = p_lote and estado = 'cargando') then
    raise exception 'El lote % no está en carga', p_lote;
  end if;
  select count(*), min(fecha), max(fecha) into v_n, v_desde, v_hasta from ventas_historicas where lote = p_lote;
  if v_n is distinct from p_lineas then
    raise exception 'El lote % tiene % líneas y se esperaban %', p_lote, v_n, p_lineas;
  end if;

  update ventas_historicas set tratamiento = case
      when tipo = 'nota_debito' and upper(coalesce(articulo_descripcion, '')) ~ '(CAMBIARI|DIFERENCIAL DE TASA|DIFERENCIA DE TASA)' then 'nd_cambiaria'
      else 'financiera' end
  where lote = p_lote and tipo in ('nota_credito', 'nota_debito');

  -- Reversos: devolución o NC cuyo documento de origen es una factura del mismo cliente por el mismo total (con IVA)
  with docs as (
    select empresa_id, tipo, numero, max(numero_origen) numero_origen, max(cliente_codigo) cliente_codigo, sum(total_usd) total
    from ventas_historicas where lote = p_lote group by empresa_id, tipo, numero
  ), par as (
    select distinct on (f.empresa_id, f.numero) f.empresa_id, f.numero factura, n.tipo nota_tipo, n.numero nota
    from docs n join docs f on f.empresa_id = n.empresa_id and f.tipo = 'factura' and f.numero = n.numero_origen
      and f.cliente_codigo is not distinct from n.cliente_codigo
    where n.tipo in ('devolucion', 'nota_credito') and f.total <> 0 and abs(abs(n.total) - abs(f.total)) < 0.01
    order by f.empresa_id, f.numero, n.numero
  ), marcar as (
    select empresa_id, 'factura'::text tipo, factura numero from par
    union all
    select empresa_id, nota_tipo, nota from par
  )
  update ventas_historicas v set tratamiento = 'reverso'
  from marcar m
  where v.lote = p_lote and v.empresa_id = m.empresa_id and v.tipo = m.tipo and v.numero = m.numero;
  get diagnostics v_rev = row_count;

  delete from profit_documentos;
  insert into profit_documentos (lote, documento, empresa_id, tipo, numero, fecha, tratamiento, numero_origen, cliente_codigo, cliente_nombre,
    cliente_rif, cliente_id, cliente_match, vendedor_codigo, vendedor_nombre, descripcion, lineas, cantidad, neto_usd, total_usd,
    costo_usd, venta_con_costo_usd, tipo_cliente, canal, segmento)
  select lote, documento, min(empresa_id::text)::uuid, min(tipo), min(numero), min(fecha), min(tratamiento), max(numero_origen), max(cliente_codigo),
         max(cliente_nombre), max(cliente_rif), min(cliente_id::text)::uuid, max(cliente_match), max(vendedor_codigo), max(vendedor_nombre),
         max(articulo_descripcion) filter (where articulo_codigo is null), count(*), sum(cantidad), sum(neto_usd), sum(total_usd),
         sum(cantidad * ultimo_costo_usd) filter (where ultimo_costo_usd > 0), sum(neto_usd) filter (where ultimo_costo_usd > 0),
         max(tipo_cliente), max(canal), max(segmento)
  from ventas_historicas where lote = p_lote group by lote, documento;
  delete from profit_articulos;
  insert into profit_articulos (lote, empresa_id, articulo_codigo, descripcion, categoria, producto_id, lineas, unidades, neto_usd, ultima)
  select lote, empresa_id, articulo_codigo, max(articulo_descripcion), max(categoria), min(producto_id::text)::uuid, count(*),
         coalesce(sum(cantidad) filter (where tratamiento = 'venta'), 0), coalesce(sum(neto_usd) filter (where tratamiento = 'venta'), 0), max(fecha)
  from ventas_historicas where lote = p_lote and articulo_codigo is not null group by lote, empresa_id, articulo_codigo;
  perform public.profit_resumir_articulos_mes(p_lote);   -- resumen mensual del cubo (20j)

  update profit_cargas set estado = 'reemplazada' where estado = 'vigente';
  update profit_cargas set estado = 'vigente', publicada_at = now(), lineas = v_n, desde = v_desde, hasta = v_hasta where id = p_lote;
  v_vend := public.profit_proponer_vendedores();

  select jsonb_object_agg(e.nombre_corto, x.n) into v_emp
  from (select empresa_id, count(*) n from ventas_historicas where lote = p_lote group by 1) x join empresas e on e.id = x.empresa_id;
  v_res := jsonb_build_object('lote', p_lote, 'lineas', v_n, 'desde', v_desde, 'hasta', v_hasta, 'por_empresa', v_emp,
                              'lineas_reverso', v_rev, 'vendedores_propuestos', v_vend);
  update profit_cargas set resultado = v_res where id = p_lote;
  return v_res;
end $function$;
revoke execute on function public.profit_publicar_carga(bigint, integer) from public, anon, authenticated;
select public.profit_resumir_articulos_mes(public.profit_lote_vigente());

-- (Primera versión: las etiquetas se buscaban fila por fila; ahora se unen por clave)
drop function if exists public.cubo_uuid(text);

-- Dimensiones válidas y la expresión de su clave sobre la fila base "b" (intercalación "C": agrupar y ordenar por bytes)
create or replace function public.cubo_dimension_sql(p_dim text) returns text language sql immutable set search_path = public as $$
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
  end || ') collate "C"';
$$;
-- Dimensiones de documento (una sola por documento): con ellas el cubo usa el resumen por documento
create or replace function public.cubo_dimensiones_documento() returns text[] language sql immutable set search_path = public as $$
  select array['empresa', 'anio', 'mes', 'anio_mes', 'vendedor', 'cliente', 'tipo_cliente', 'canal', 'segmento'];
$$;
revoke execute on function public.cubo_dimensiones_documento() from public, anon, authenticated;
revoke execute on function public.cubo_dimension_sql(text) from public, anon, authenticated;

-- Etiqueta (e) y detalle (d: RIF del cliente, SKU del producto) de una clave ya agrupada (k = columna de la consulta).
-- Cliente, producto y empresa toman el nombre de una tabla de búsqueda unida por la clave (alias a).
create or replace function public.cubo_etiqueta_sql(p_dim text, k text, a text, p_detalle boolean default false) returns text
language sql immutable set search_path = public as $$
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
    end
  end;
$$;
drop function if exists public.cubo_etiqueta_sql(text, text, boolean);
revoke execute on function public.cubo_etiqueta_sql(text, text, text, boolean) from public, anon, authenticated;

-- Tabla de búsqueda (k, nombre, det) de las dimensiones con nombre en otra tabla; $6 = lote vigente de Profit
create or replace function public.cubo_busqueda_sql(p_dim text) returns text language sql immutable set search_path = public as $$
  select case p_dim
    when 'cliente' then $q$select c.id::text k, c.nombre_negocio::text nombre, c.rif::text det from public.clientes c
      union all
      select 'p:' || empresa_id::text || ':' || coalesce(cliente_codigo, ''), max(cliente_nombre), max(coalesce(cliente_rif, cliente_codigo))
      from public.profit_documentos where lote = $6 and cliente_id is null group by 1$q$
    when 'producto' then $q$select p.id::text k, p.nombre::text nombre, p.sku::text det from public.productos p
      union all
      select 'sku:' || upper(articulo_codigo), max(descripcion), max(articulo_codigo)
      from public.profit_articulos where lote = $6 and producto_id is null group by 1$q$
    when 'empresa' then $q$select e.id::text k, e.nombre_corto::text nombre, null::text det from public.empresas e$q$
  end;
$$;
revoke execute on function public.cubo_busqueda_sql(text) from public, anon, authenticated;

-- Clientes de Profit sin pareja en GUDS (para sus nombres en el cubo)
create index if not exists profit_documentos_sin_cliente on public.profit_documentos (lote, empresa_id, cliente_codigo)
  include (cliente_nombre, cliente_rif) where cliente_id is null;

-- Filas base (una por línea de venta) de las fuentes pedidas. Parámetros de la consulta: $3 desde, $4 hasta,
-- $5 empresas visibles, $6 lote vigente de Profit. Con p_detalle agrega las columnas de la hoja "Base datos".
create or replace function public.cubo_base_sql(p_odoo boolean, p_profit boolean, p_detalle boolean default false) returns text
language plpgsql immutable set search_path = public as $$
declare v_odoo text; v_profit text;
begin
  v_odoo := $q$
    select 'odoo'::text fte, dv.empresa_id, dv.fecha, dv.id::text doc, dv.tipo = 'factura' es_fac,
           coalesce(dv.cliente_id::text, '') cli, coalesce(nullif(dv.vendedor, 'Sin vendedor'), '') vendedor,
           ''::text tipo_cliente, ''::text canal, ''::text segmento,
           coalesce(ct.c1, '') categoria, coalesce(ct.c2, '') linea, coalesce(ct.c3, '') sublinea, ''::text marca,
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
           coalesce(i.odoo_id, 0) renglon$q$ else '' end
    || $q$
    from public.documentos_venta($3, $4) dv
    join public.factura_items i on i.factura_id = dv.id
    left join public.productos pr on pr.id = i.producto_id
    left join (select c.id, nullif(upper(btrim(split_part(c.nombre, '/', 1))), '') c1, nullif(upper(btrim(split_part(c.nombre, '/', 2))), '') c2,
                      nullif(upper(btrim(split_part(c.nombre, '/', 3))), '') c3 from public.categorias c) ct on ct.id = pr.categoria_id
    left join public.producto_costos pc on pc.producto_id = i.producto_id and pc.empresa_id = dv.empresa_id and pc.costo > 0$q$
    || case when p_detalle then $q$
    join public.facturas f on f.id = dv.id
    left join public.facturas fo on fo.id = f.factura_origen_id
    left join public.clientes cl on cl.id = dv.cliente_id
    left join public.empresas e on e.id = dv.empresa_id$q$ else '' end;

  v_profit := $q$
    select 'profit'::text fte, v.empresa_id, v.fecha, 'p' || v.documento doc, v.tipo = 'factura' es_fac,
           coalesce(v.cliente_id::text, 'p:' || v.empresa_id::text || ':' || coalesce(v.cliente_codigo, '')) cli,
           coalesce(nullif(pv.vendedor_odoo, ''), nullif(v.vendedor_nombre, ''), '') vendedor,
           coalesce(v.tipo_cliente, '') tipo_cliente, coalesce(v.canal, '') canal, coalesce(v.segmento, '') segmento,
           coalesce(v.categoria, '') categoria, coalesce(v.linea, '') linea, coalesce(v.sublinea, '') sublinea, coalesce(v.marca, '') marca,
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
           null::timestamptz costo_fecha, v.renglon$q$ else '' end
    || $q$
    from public.ventas_historicas v
    left join public.profit_vendedores pv on pv.empresa_id = v.empresa_id and pv.codigo_profit = coalesce(v.vendedor_codigo, '')
      and pv.nombre_profit = coalesce(v.vendedor_nombre, '')$q$
    || case when p_detalle then $q$
    left join public.empresas e on e.id = v.empresa_id$q$ else '' end
    || $q$
    where v.lote = $6 and v.tratamiento in ('venta', 'financiera') and v.fecha between $3 and $4 and v.empresa_id = any($5)$q$;

  return case when p_odoo and p_profit then v_odoo || E'\n    union all' || v_profit
              when p_odoo then v_odoo else v_profit end;
end $$;
revoke execute on function public.cubo_base_sql(boolean, boolean, boolean) from public, anon, authenticated;

-- Filas base por documento (camino rápido cuando todas las dimensiones y filtros son de documento). Mismas columnas
-- que la base por línea salvo el costo: costo y venta con costo ya sumados por documento.
create or replace function public.cubo_base_docs_sql(p_odoo boolean, p_profit boolean) returns text
language plpgsql immutable set search_path = public as $$
declare v_odoo text; v_profit text;
begin
  v_odoo := $q$
    select 'odoo'::text fte, dv.empresa_id, dv.fecha, dv.id::text doc, dv.tipo = 'factura' es_fac,
           coalesce(dv.cliente_id::text, '') cli, coalesce(nullif(dv.vendedor, 'Sin vendedor'), '') vendedor,
           ''::text tipo_cliente, ''::text canal, ''::text segmento,
           case when dv.tipo = 'nota_credito' then -coalesce(li.cant, 0) else coalesce(li.cant, 0) end cant,
           dv.neto_usd neto, 0::numeric fin,
           case when dv.tipo = 'nota_credito' then -li.costo else li.costo end costo, li.vcc * dv.factor vcc
    from public.documentos_venta($3, $4) dv
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
           coalesce(d.tipo_cliente, '') tipo_cliente, coalesce(d.canal, '') canal, coalesce(d.segmento, '') segmento,
           case when d.tratamiento = 'venta' then d.cantidad else 0 end cant,
           case when d.tratamiento = 'venta' then d.neto_usd else 0 end neto,
           case when d.tratamiento = 'financiera' then d.neto_usd else 0 end fin,
           case when d.tratamiento = 'venta' then d.costo_usd end costo,
           case when d.tratamiento = 'venta' then d.venta_con_costo_usd end vcc
    from public.profit_documentos d
    left join public.profit_vendedores pv on pv.empresa_id = d.empresa_id and pv.codigo_profit = coalesce(d.vendedor_codigo, '')
      and pv.nombre_profit = coalesce(d.vendedor_nombre, '')
    where d.lote = $6 and d.tratamiento in ('venta', 'financiera') and d.fecha between $3 and $4 and d.empresa_id = any($5)$q$;
  return case when p_odoo and p_profit then v_odoo || E'\n    union all' || v_profit
              when p_odoo then v_odoo else v_profit end;
end $$;
revoke execute on function public.cubo_base_docs_sql(boolean, boolean) from public, anon, authenticated;

-- Filas base del camino mensual (sin conteos): líneas de Odoo con su costo ya multiplicado + resumen mensual de Profit
create or replace function public.cubo_base_mensual_sql(p_odoo boolean, p_profit boolean) returns text
language plpgsql immutable set search_path = public as $$
declare v_odoo text; v_profit text;
begin
  v_odoo := format($q$
    select o.fte, o.empresa_id, o.fecha, o.doc, o.es_fac, o.cli, o.vendedor, o.tipo_cliente, o.canal, o.segmento, o.categoria, o.linea, o.sublinea,
           o.marca, o.prod, o.cant, o.neto, o.fin, case when o.costo_u is not null then o.cant * o.costo_u end costo,
           case when o.costo_u is not null then o.neto end vcc
    from (%s) o$q$, public.cubo_base_sql(true, false));
  v_profit := $q$
    select 'profit'::text fte, m.empresa_id, m.mes fecha, null::text doc, m.es_fac, m.cli,
           coalesce(nullif(pv.vendedor_odoo, ''), nullif(m.vendedor_nombre, ''), '') vendedor,
           m.tipo_cliente, m.canal, m.segmento, m.categoria, m.linea, m.sublinea, m.marca, m.prod, m.cant, m.neto, m.fin, m.costo, m.vcc
    from public.profit_articulos_mes m
    left join public.profit_vendedores pv on pv.empresa_id = m.empresa_id and pv.codigo_profit = m.vendedor_codigo and pv.nombre_profit = m.vendedor_nombre
    where m.lote = $6 and m.mes between date_trunc('month', $3)::date and $4 and m.empresa_id = any($5)$q$;
  return case when p_odoo and p_profit then v_odoo || E'\n    union all' || v_profit
              when p_odoo then v_odoo else v_profit end;
end $$;
revoke execute on function public.cubo_base_mensual_sql(boolean, boolean) from public, anon, authenticated;

-- Filtros cruzados → condición SQL sobre "b" (claves validadas; los valores viajan como parámetro $1)
create or replace function public.cubo_filtros_sql(p_filtros jsonb) returns text language plpgsql immutable set search_path = public as $$
declare v_k text; v_sql text := '';
begin
  if p_filtros is null or p_filtros = '{}'::jsonb then return ''; end if;
  if jsonb_typeof(p_filtros) <> 'object' then
    raise exception 'Los filtros deben ser un objeto {"dimension": ["clave", …]}' using errcode = '22023';
  end if;
  for v_k in select jsonb_object_keys(p_filtros) loop
    if public.cubo_dimension_sql(v_k) is null then
      raise exception 'Filtro no válido: %', v_k using errcode = '22023';
    end if;
    if jsonb_typeof(p_filtros -> v_k) <> 'array' or jsonb_array_length(p_filtros -> v_k) = 0 or jsonb_array_length(p_filtros -> v_k) > 1000 then
      raise exception 'El filtro % debe ser una lista de 1 a 1000 claves', v_k using errcode = '22023';
    end if;
    v_sql := v_sql || format(E'\n      and %s = any (array(select jsonb_array_elements_text($1 -> %L)))', public.cubo_dimension_sql(v_k), v_k);
  end loop;
  return v_sql;
end $$;
revoke execute on function public.cubo_filtros_sql(jsonb) from public, anon, authenticated;

-- ── Motor ────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Rendimiento (el rol authenticated corta a los 8 s; la base es chica y la sincronización con Odoo la carga cada 15 min):
--   · Si niveles, columna y filtros son todos dimensiones de documento (empresa, año, mes, vendedor, cliente, tipo de
--     cliente, canal, segmento), Profit sale del resumen por documento (profit_documentos, ≈ 29 mil filas en vez de 130 mil
--     líneas) y Odoo de documentos_venta con sus líneas sumadas. Cada documento cae en un solo grupo de cada nivel, así que
--     los documentos se cuentan sin DISTINCT.
--   · Si hay un filtro de línea (categoría, producto…) con niveles de documento y se piden conteos, las líneas se agrupan
--     primero por documento.
--   · Sin conteos y con meses completos, Profit sale del resumen mensual por artículo (profit_articulos_mes, ≈ 55 mil filas).
--   · Si no, se agrupan las líneas; sin conteos no hay agregados DISTINCT.
--   · Las claves van con intercalación "C" y las etiquetas se unen por clave después de agrupar.
drop function if exists public.reporte_ventas_cubo(date, date, text[], text, jsonb, text, boolean);
create or replace function public.reporte_ventas_cubo(p_desde date, p_hasta date, p_niveles text[], p_fuente text default 'ambas',
                                                      p_filtros jsonb default '{}'::jsonb, p_columna text default null,
                                                      p_conteos boolean default true)
returns table(nivel integer, k1 text, k2 text, k3 text, k4 text, col text,
              etiqueta text, detalle text, ecol text,
              venta_usd numeric, nc_usd numeric, unidades numeric, documentos bigint, clientes bigint, precio_promedio numeric,
              financieras_usd numeric, profit_usd numeric,
              costo_usd numeric, venta_con_costo_usd numeric, margen_usd numeric, margen_pct numeric, cobertura_costo_pct numeric,
              fuente text, ve_costo boolean)
language plpgsql stable security definer set search_path = public set work_mem = '48MB' as $$
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
             sum(f.fin) fin, sum(f.neto) filter (where f.fte = 'profit') prof, sum(f.costo) costo, sum(f.vcc) vcc,
             bool_or(f.fte = 'odoo') hay_odoo, bool_or(f.fte = 'profit') hay_profit
      from f
      group by grouping sets (%3$s)
    )$q$, v_grp, v_nivel, array_to_string(v_sets, ', '),
      case when v_conteos then 'count(*) filter (where f.es_fac) docs, count(distinct f.cli) filter (where f.es_fac) clis'
           else 'null::bigint docs, null::bigint clis' end);
  elsif v_por_doc then
    v_agr := format($q$, d as (
      select f.doc, f.cli, f.es_fac, f.fte%1$s, sum(f.neto) neto, sum(f.cant) cant, sum(f.fin) fin,
             sum(f.cant * f.costo_u) filter (where f.costo_u is not null) costo, sum(f.neto) filter (where f.costo_u is not null) vcc
      from f group by f.doc, f.cli, f.es_fac, f.fte%1$s
    ), g as (
      select %2$s nivel%1$s,
             sum(d.neto) venta, sum(d.neto) filter (where not d.es_fac) nc, sum(d.cant) unidades,
             count(*) filter (where d.es_fac) docs, count(distinct d.cli) filter (where d.es_fac) clis,
             sum(d.fin) fin, sum(d.neto) filter (where d.fte = 'profit') prof, sum(d.costo) costo, sum(d.vcc) vcc,
             bool_or(d.fte = 'odoo') hay_odoo, bool_or(d.fte = 'profit') hay_profit
      from d
      group by grouping sets (%3$s)
    )$q$, v_grp, v_nivel, array_to_string(v_sets, ', '));
  else
    v_agr := format($q$, g as (
      select %2$s nivel%1$s,
             sum(f.neto) venta, sum(f.neto) filter (where not f.es_fac) nc, sum(f.cant) unidades,
             %4$s,
             sum(f.fin) fin, sum(f.neto) filter (where f.fte = 'profit') prof,
             sum(f.cant * f.costo_u) filter (where f.costo_u is not null) costo, sum(f.neto) filter (where f.costo_u is not null) vcc,
             bool_or(f.fte = 'odoo') hay_odoo, bool_or(f.fte = 'profit') hay_profit
      from f
      group by grouping sets (%3$s)
    )$q$, v_grp, v_nivel, array_to_string(v_sets, ', '),
      case when v_conteos then 'count(distinct f.doc) filter (where f.es_fac) docs, count(distinct f.cli) filter (where f.es_fac) clis'
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
           $7
    from g%s
    order by g.nivel, 2, 3, 4, 5, 6$q$,
    case when v_resumen then public.cubo_base_docs_sql(v_fuente in ('ambas', 'odoo'), v_fuente in ('ambas', 'profit'))
         when v_mensual then public.cubo_base_mensual_sql(v_fuente in ('ambas', 'odoo'), v_fuente in ('ambas', 'profit'))
         else public.cubo_base_sql(v_fuente in ('ambas', 'odoo'), v_fuente in ('ambas', 'profit')) end,
    case when v_resumen or v_mensual then 'b.costo, b.vcc' else 'b.costo_u' end,
    v_keys, public.cubo_filtros_sql(p_filtros), v_agr, v_lk, v_out, v_join);

  return query execute v_sql using p_filtros, v_conteos, p_desde, p_hasta, v_emp, v_lote, v_admin;
  get diagnostics v_filas = row_count;
  if v_filas > 40000 then
    raise exception 'El análisis tiene demasiadas filas (%): agrega filtros o quita un nivel', v_filas using errcode = '54000';
  end if;
end $$;
revoke execute on function public.reporte_ventas_cubo(date, date, text[], text, jsonb, text, boolean) from public, anon;
grant execute on function public.reporte_ventas_cubo(date, date, text[], text, jsonb, text, boolean) to authenticated;

-- Mismo cubo en formato compacto para la pantalla: filas como arreglos (sin repetir los nombres de las columnas) y montos
-- como números cortos. Con ~20 mil filas la respuesta de la API pasa de ~11 MB a ~4 MB (la base y la API comparten una
-- máquina chica: el tamaño de la respuesta pesa tanto como la consulta).
drop function if exists public.reporte_ventas_cubo_json(date, date, text[], text, jsonb, text, boolean);
create or replace function public.reporte_ventas_cubo_json(p_desde date, p_hasta date, p_niveles text[], p_fuente text default 'ambas',
                                                           p_filtros jsonb default '{}'::jsonb, p_columna text default null,
                                                           p_conteos boolean default true)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_permiso_reportes();
  return (select json_build_object(
    'columnas', json_build_array('nivel', 'k1', 'k2', 'k3', 'k4', 'col', 'etiqueta', 'detalle', 'ecol', 'venta_usd', 'nc_usd', 'unidades',
      'documentos', 'clientes', 'precio_promedio', 'financieras_usd', 'profit_usd', 'costo_usd', 'venta_con_costo_usd', 'margen_usd',
      'margen_pct', 'cobertura_costo_pct', 'fuente'),
    'filas', coalesce(json_agg(json_build_array(c.nivel, c.k1, c.k2, c.k3, c.k4, c.col, c.etiqueta, c.detalle, c.ecol,
      c.venta_usd::float8, c.nc_usd::float8, c.unidades::float8, c.documentos, c.clientes, c.precio_promedio::float8, c.financieras_usd::float8,
      c.profit_usd::float8, c.costo_usd::float8, c.venta_con_costo_usd::float8, c.margen_usd::float8, c.margen_pct::float8,
      c.cobertura_costo_pct::float8, c.fuente)), '[]'::json),
    've_costo', public.es_personal_admin())
  from public.reporte_ventas_cubo(p_desde, p_hasta, p_niveles, p_fuente, p_filtros, p_columna, p_conteos) c);
end $$;
revoke execute on function public.reporte_ventas_cubo_json(date, date, text[], text, jsonb, text, boolean) from public, anon;
grant execute on function public.reporte_ventas_cubo_json(date, date, text[], text, jsonb, text, boolean) to authenticated;

-- ── Detalle de líneas (hoja "Base datos") ────────────────────────────────────────────────────────────────────────
drop function if exists public.reporte_ventas_lineas(date, date, text, jsonb);
create or replace function public.reporte_ventas_lineas(p_desde date, p_hasta date, p_fuente text default 'ambas', p_filtros jsonb default '{}'::jsonb)
returns table(fuente text, tratamiento text, empresa text, fecha date, fecha_vencimiento date, anio integer, mes integer, semana integer,
              dia_semana text, tipo text, numero text, numero_origen text, documento_origen text, vendedor_codigo text, vendedor text,
              moneda text, tasa_venta numeric, cliente_codigo text, cliente text, cliente_rif text, tipo_cliente text, canal text, segmento text,
              articulo_codigo text, articulo text, linea text, sublinea text, marca text, categoria text, cantidad numeric,
              precio_bs numeric, precio_usd numeric, presentacion text, descuento_renglon_pct numeric, descuento_global_pct numeric,
              descuento_bs numeric, exento_bs numeric, base_imponible_bs numeric, iva_bs numeric, total_bs numeric,
              descuento_usd numeric, exento_usd numeric, base_imponible_usd numeric, iva_usd numeric, total_usd numeric,
              anulado text, ultimo_costo_usd numeric, costo_fecha timestamptz, estatus_cobro text, dias_credito integer,
              condicion_pago text, lista_precios text, base_ventas_usd numeric, venta_neta_usd numeric, financieras_usd numeric,
              costo_usd numeric, rentabilidad_usd numeric)
language plpgsql stable security definer set search_path = public set work_mem = '32MB' as $$
declare
  v_fuente text := coalesce(p_fuente, 'ambas');
  v_emp uuid[];
  v_lote bigint;
  v_admin boolean;
  v_sql text;
  v_filas bigint;
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
  if v_fuente = 'profit' and v_lote is null then return; end if;

  v_sql := format($q$
    with b as (%s
    )
    select b.fte, b.tratamiento, b.empresa, b.fecha, b.fecha_vencimiento, extract(year from b.fecha)::int, extract(month from b.fecha)::int,
           extract(week from b.fecha)::int,
           (array['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'])[extract(isodow from b.fecha)::int],
           b.tipo_doc, b.numero, b.numero_origen, b.doc_origen, b.vendedor_codigo, nullif(b.vendedor, ''),
           b.moneda, b.tasa_venta, b.cliente_codigo, b.cliente_nombre, b.cliente_rif, nullif(b.tipo_cliente, ''), nullif(b.canal, ''), nullif(b.segmento, ''),
           b.articulo_codigo, b.articulo, nullif(b.linea, ''), nullif(b.sublinea, ''), nullif(b.marca, ''), nullif(b.categoria, ''), b.cantidad_doc,
           round(b.precio_bs, 6), round(b.precio_usd, 6), b.presentacion, b.descuento_pct, b.descuento_global_pct,
           round(b.descuento_bs, 6), round(b.exento_bs, 6), round(b.base_imponible_bs, 6), round(b.iva_bs, 6), round(b.total_bs, 6),
           round(b.descuento_usd, 6), round(b.exento_usd, 6), round(b.base_imponible_usd, 6), round(b.iva_usd, 6), round(b.total_usd, 6),
           'No'::text, case when $7 then b.costo_u end, case when $7 then b.costo_fecha end, b.estatus_cobro, b.dias_credito,
           b.condicion_pago, b.lista_precios, round(b.neto + b.fin, 6), round(b.neto, 6), round(b.fin, 6),
           case when $7 and b.costo_u is not null then round(b.cant * b.costo_u, 6) end,
           case when $7 and b.costo_u is not null then round(b.neto - b.cant * b.costo_u, 6) end
    from b
    where true%s
    order by b.fecha, b.fte, b.numero, b.renglon$q$,
    public.cubo_base_sql(v_fuente in ('ambas', 'odoo'), v_fuente in ('ambas', 'profit'), true),
    public.cubo_filtros_sql(p_filtros));

  return query execute v_sql using p_filtros, true, p_desde, p_hasta, v_emp, v_lote, v_admin;
  get diagnostics v_filas = row_count;
  if v_filas > 45000 then
    raise exception 'El tramo tiene demasiadas líneas (%): pide un período más corto', v_filas using errcode = '54000';
  end if;
end $$;
revoke execute on function public.reporte_ventas_lineas(date, date, text, jsonb) from public, anon;
grant execute on function public.reporte_ventas_lineas(date, date, text, jsonb) to authenticated;

notify pgrst, 'reload schema';

commit;
