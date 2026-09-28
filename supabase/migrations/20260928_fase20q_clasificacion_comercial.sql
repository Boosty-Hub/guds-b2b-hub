-- ════════════════════════════════════════════════════════════════════════
-- Fase 20q · R2: clasificación comercial (docs/privado/planes/plan-reportes.md R2; decisión 28-sep: "la clasificación
-- comercial se mantiene en Odoo")
--
--   Qué hay en Odoo (sondeo de solo lectura, 28-sep):
--     · Productos: el campo Marca (product.template.product_brand_id → product.brand) existe pero no tiene marcas cargadas.
--       No hay etiquetas ni atributos de producto. La categoría de Odoo tiene 1 o 2 niveles ("A / B / C").
--     · Clientes: la Industria (res.partner.industry_id) tiene los tipos de cliente de Profit (AUTOMERCADO, CLINICA,
--       CORPORATIVO, DISTRIBUIDOR, EMPLEADOS, INSTITUCIONAL, PARTICULAR); Canal y Segmento del contacto
--       (eu_partner_channel_id / eu_partner_segment_id, con los textos channel / segmentation de respaldo) existen sin
--       valores; las etiquetas (category_id) son administrativas.
--   El importador los trae: productos.marca, clientes.tipo_cliente, clientes.canal, clientes.segmento y clientes.etiquetas.
--   Se editan en Odoo (el disparador del espejo impide cambiarlos desde la API).
--
--   Motor de reportes (reporte_ventas_cubo, 20j):
--     · Categoría › Línea › Sub-línea = los niveles del nombre de la categoría de Odoo ("A / B / C"), para las dos fuentes:
--         Odoo   → la categoría del producto.
--         Profit → la categoría en Odoo del mismo artículo (código = SKU); si el artículo no existe en Odoo, la equivalencia
--                  "categoría y línea de Profit → categoría de Odoo" (profit_categorias); sin equivalencia, el nombre de
--                  Profit marcado "(Profit)". Así las dos fuentes no quedan mezcladas en el mismo nivel (en GUDS la
--                  categoría de Odoo equivale a la línea de Profit y en Quirutec a la categoría).
--     · Dimensiones nuevas categoria_profit, linea_profit y sublinea_profit: la clasificación original de Profit (la del
--       Excel), solo en las filas de Profit.
--     · Marca, tipo de cliente, canal y segmento: el valor de Odoo (producto o cliente); en Profit, el de Odoo del mismo
--       artículo o cliente y, si no hay, el de Profit.
--   · profit_categorias: equivalencias propuestas por GUDS (por los artículos en común y por nombre) que administración
--     valida en Reportes → Histórico Profit (equivalencias_categorias_profit / guardar_profit_categorias).
--   · reporte_ventas (agrupado por categoría) usa la misma equivalencia para los artículos de Profit sin pareja.
--   · reporte_ventas_lineas agrega la clasificación de Odoo (categoría, línea y sub-línea) al detalle exportado.
-- ════════════════════════════════════════════════════════════════════════
begin;

-- 1. Campos de clasificación (los trae el importador desde Odoo) ------------------------------------------------------
alter table public.productos add column if not exists marca text;
comment on column public.productos.marca is 'Marca del producto en Odoo (product_brand_id). La trae el importador; se edita en Odoo';
alter table public.clientes
  add column if not exists tipo_cliente text,
  add column if not exists canal text,
  add column if not exists segmento text,
  add column if not exists etiquetas text[];
comment on column public.clientes.tipo_cliente is 'Tipo de cliente de Odoo (Industria del contacto: AUTOMERCADO, CLINICA, DISTRIBUIDOR…). Lo trae el importador';
comment on column public.clientes.canal is 'Canal de ventas del contacto en Odoo (eu_partner_channel_id o el texto "Canal")';
comment on column public.clientes.segmento is 'Segmento del contacto en Odoo (eu_partner_segment_id o el texto "Segmentación")';
comment on column public.clientes.etiquetas is 'Etiquetas del contacto en Odoo (category_id)';

-- El espejo de Odoo protege también estos campos (se editan en Odoo). Se conservan los argumentos actuales del disparador.
do $$
declare v_tabla text; v_extra text[]; v_args text[]; v_lista text;
begin
  foreach v_tabla in array array['clientes', 'productos'] loop
    v_extra := case v_tabla when 'clientes' then array['tipo_cliente', 'canal', 'segmento', 'etiquetas'] else array['marca'] end;
    select array_remove(string_to_array(encode(t.tgargs, 'escape'), '\000'), '') into v_args
      from pg_trigger t where t.tgrelid = format('public.%I', v_tabla)::regclass and t.tgname = 'c_proteger_espejo_odoo';
    if v_args is null then continue; end if;
    v_args := v_args || array(select x from unnest(v_extra) x where x <> all (v_args));
    select string_agg(quote_literal(a), ', ') into v_lista from unnest(v_args) a;
    execute format('drop trigger c_proteger_espejo_odoo on public.%I', v_tabla);
    execute format('create trigger c_proteger_espejo_odoo before delete or update on public.%I for each row execute function public.trg_proteger_espejo_odoo(%s)', v_tabla, v_lista);
  end loop;
end $$;

-- 2. Equivalencias categoría y línea de Profit → categoría de Odoo ------------------------------------------------------
create table if not exists public.profit_categorias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  categoria_profit text not null,
  linea_profit text not null,
  categoria_id uuid references public.categorias(id) on delete set null,
  propuesta_id uuid references public.categorias(id) on delete set null,
  metodo text check (metodo in ('productos', 'nombre')),
  estado text not null default 'sin_pareja' check (estado in ('propuesto', 'sin_pareja', 'validado')),
  revisado_por uuid references public.usuarios(id) on delete set null,
  revisado_at timestamptz,
  created_at timestamptz not null default now(),
  unique (empresa_id, categoria_profit, linea_profit)
);
comment on table public.profit_categorias is 'Categoría y línea de Profit → categoría de Odoo (sus niveles son Categoría › Línea › Sub-línea en los reportes). Se usa para los artículos de Profit que no existen en Odoo; los demás toman la categoría de Odoo del mismo artículo';
comment on column public.profit_categorias.metodo is 'Cómo propuso GUDS la equivalencia: productos (la categoría de Odoo de la mayoría de sus artículos) o nombre';

alter table public.profit_categorias enable row level security;
drop policy if exists profit_categorias_reportes_ver on public.profit_categorias;
create policy profit_categorias_reportes_ver on public.profit_categorias for select to authenticated using ((select public.puede('reportes', 'ver')));
drop policy if exists empresa_visible on public.profit_categorias;
create policy empresa_visible on public.profit_categorias as restrictive for all to authenticated
  using (empresa_id = any ((select public.empresas_visibles())::uuid[]));
revoke all on public.profit_categorias from public, anon, authenticated;
grant select on public.profit_categorias to authenticated;

-- Nombre normalizado para comparar categorías: sin acentos, signos ni plurales ("Guante" = "GUANTES", "Esterilización" = "ESTERILIZACION")
create or replace function public.profit_norm_categoria(t text) returns text language sql immutable set search_path = public as $$
  select regexp_replace(btrim(regexp_replace(regexp_replace(upper(translate(coalesce(t, ''), 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU')), '[^A-Z0-9]+', ' ', 'g'), '\s+', ' ', 'g')), 'S\M', '', 'g');
$$;
revoke execute on function public.profit_norm_categoria(text) from public, anon, authenticated;

-- Propone la equivalencia de cada (categoría, línea) de Profit del lote vigente. Lo validado por administración no se toca.
--   1) productos: si al menos la mitad del movimiento del par es de artículos que existen en Odoo y el 70 % de ese
--      movimiento está en una misma categoría de Odoo (que no sea genérica: Todos, Servicios, Gastos), esa categoría.
--   2) nombre: la línea (y si no, la categoría) de Profit se llama igual que el último nivel de una categoría de Odoo con
--      productos de la misma empresa.
create or replace function public.profit_proponer_categorias() returns integer language plpgsql set search_path = public as $$
declare v_lote bigint := public.profit_lote_vigente(); n integer;
begin
  if v_lote is null then return 0; end if;
  insert into profit_categorias (empresa_id, categoria_profit, linea_profit)
  select distinct v.empresa_id, btrim(coalesce(v.categoria, '')), btrim(coalesce(v.linea, ''))
  from ventas_historicas v
  where v.lote = v_lote and v.articulo_codigo is not null and (btrim(coalesce(v.categoria, '')) <> '' or btrim(coalesce(v.linea, '')) <> '')
  on conflict (empresa_id, categoria_profit, linea_profit) do nothing;

  with cat as (
    select c.id, public.profit_norm_categoria(coalesce(nullif(btrim(split_part(c.nombre, '/', 3)), ''), nullif(btrim(split_part(c.nombre, '/', 2)), ''), c.nombre)) ultimo,
           upper(btrim(c.nombre)) ~ '^(TODOS|SERVICIOS|GASTOS)' generica
    from categorias c
  ), cat_emp as (
    select pr.empresa_id, pr.categoria_id, count(*) productos from productos pr where pr.categoria_id is not null group by 1, 2
  ), pv as (
    select v.empresa_id, btrim(coalesce(v.categoria, '')) cat, btrim(coalesce(v.linea, '')) lin, pr.categoria_id, sum(abs(v.neto_usd)) peso
    from ventas_historicas v left join productos pr on pr.id = v.producto_id
    where v.lote = v_lote and v.articulo_codigo is not null
    group by 1, 2, 3, 4
  ), tot as (
    select empresa_id, cat, lin, sum(peso) total, coalesce(sum(peso) filter (where categoria_id is not null), 0) con_prod from pv group by 1, 2, 3
  ), top as (
    select distinct on (pv.empresa_id, pv.cat, pv.lin) pv.empresa_id, pv.cat, pv.lin, pv.categoria_id, pv.peso
    from pv join cat on cat.id = pv.categoria_id and not cat.generica
    order by pv.empresa_id, pv.cat, pv.lin, pv.peso desc
  ), por_productos as (
    select t.empresa_id, t.cat, t.lin, top.categoria_id
    from tot t join top using (empresa_id, cat, lin)
    where t.total > 0 and t.con_prod >= 0.5 * t.total and top.peso >= 0.7 * t.con_prod
  ), candidatas as (
    select ce.empresa_id, cat.id, cat.ultimo, ce.productos
    from cat join cat_emp ce on ce.categoria_id = cat.id
    where not cat.generica and cat.ultimo <> ''
  ), por_nombre as (
    select q.id, (
      select c.id from candidatas c
      where (c.empresa_id = q.empresa_id or c.empresa_id is null)
        and c.ultimo in (public.profit_norm_categoria(q.linea_profit), public.profit_norm_categoria(q.categoria_profit))
      order by (c.ultimo = public.profit_norm_categoria(q.linea_profit)) desc, (c.empresa_id is null), c.productos desc
      limit 1) categoria_id
    from profit_categorias q
  ), propuesta as (
    select q.id, coalesce(pp.categoria_id, pn.categoria_id) categoria_id,
           case when pp.categoria_id is not null then 'productos' when pn.categoria_id is not null then 'nombre' end metodo
    from profit_categorias q
    left join por_productos pp on pp.empresa_id = q.empresa_id and pp.cat = q.categoria_profit and pp.lin = q.linea_profit
    left join por_nombre pn on pn.id = q.id
  )
  update profit_categorias q
     set propuesta_id = p.categoria_id, metodo = p.metodo,
         categoria_id = case when q.estado = 'validado' then q.categoria_id else p.categoria_id end,
         estado = case when q.estado = 'validado' then 'validado' when p.categoria_id is null then 'sin_pareja' else 'propuesto' end
    from propuesta p
   where p.id = q.id
     and (q.propuesta_id, q.metodo, q.categoria_id, q.estado) is distinct from
         (p.categoria_id, p.metodo, case when q.estado = 'validado' then q.categoria_id else p.categoria_id end,
          case when q.estado = 'validado' then 'validado' when p.categoria_id is null then 'sin_pareja' else 'propuesto' end);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.profit_proponer_categorias() from public, anon, authenticated;

-- Estatus de cobro de Profit por documento (lo usa el cuadre Profit ↔ Odoo sin recorrer las 130 mil líneas). Como el
-- costo, no se concede a la API: solo lo leen las funciones del servidor.
alter table public.profit_documentos add column if not exists estatus_cobro text;
comment on column public.profit_documentos.estatus_cobro is 'Estatus de cobro en Profit (Cobrada / Pendiente) al extraer el histórico';
update public.profit_documentos d set estatus_cobro = x.estatus
  from (select lote, documento, max(estatus_cobro) estatus from public.ventas_historicas group by 1, 2) x
 where d.lote = x.lote and d.documento = x.documento and d.estatus_cobro is distinct from x.estatus;

-- La carga del histórico y el nuevo emparejamiento vuelven a proponer (misma función que 20j + la propuesta de categorías)
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
  perform public.profit_proponer_categorias();           -- la propuesta por productos depende de las parejas (20q)
  return jsonb_build_object('lote', v_lote, 'lineas_cliente', v_cli, 'lineas_producto', v_prod);
end $function$;
revoke execute on function public.profit_emparejar() from public, anon, authenticated;

create or replace function public.profit_publicar_carga(p_lote bigint, p_lineas integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_n integer; v_desde date; v_hasta date; v_emp jsonb; v_vend integer; v_rev integer; v_res jsonb; v_cat integer;
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
    costo_usd, venta_con_costo_usd, tipo_cliente, canal, segmento, estatus_cobro)
  select lote, documento, min(empresa_id::text)::uuid, min(tipo), min(numero), min(fecha), min(tratamiento), max(numero_origen), max(cliente_codigo),
         max(cliente_nombre), max(cliente_rif), min(cliente_id::text)::uuid, max(cliente_match), max(vendedor_codigo), max(vendedor_nombre),
         max(articulo_descripcion) filter (where articulo_codigo is null), count(*), sum(cantidad), sum(neto_usd), sum(total_usd),
         sum(cantidad * ultimo_costo_usd) filter (where ultimo_costo_usd > 0), sum(neto_usd) filter (where ultimo_costo_usd > 0),
         max(tipo_cliente), max(canal), max(segmento), max(estatus_cobro)
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
  v_cat := public.profit_proponer_categorias();          -- equivalencias de categorías (20q)

  select jsonb_object_agg(e.nombre_corto, x.n) into v_emp
  from (select empresa_id, count(*) n from ventas_historicas where lote = p_lote group by 1) x join empresas e on e.id = x.empresa_id;
  v_res := jsonb_build_object('lote', p_lote, 'lineas', v_n, 'desde', v_desde, 'hasta', v_hasta, 'por_empresa', v_emp,
                              'lineas_reverso', v_rev, 'vendedores_propuestos', v_vend, 'categorias_propuestas', v_cat);
  update profit_cargas set resultado = v_res where id = p_lote;
  return v_res;
end $function$;
revoke execute on function public.profit_publicar_carga(bigint, integer) from public, anon, authenticated;

select public.profit_proponer_categorias();

-- 3. Pantalla: equivalencias de categorías (Reportes → Histórico Profit) ------------------------------------------------
create or replace function public.equivalencias_categorias_profit() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_emp uuid[]; v_lote bigint; v_res jsonb;
begin
  perform public.exigir_permiso_reportes();
  v_emp := public.empresas_visibles();
  v_lote := public.profit_lote_vigente();
  -- Del resumen mensual por artículo (profit_articulos_mes, 20j): recorrer las 130 mil líneas pasaba del tiempo de la API
  with a as (
    select m.empresa_id, btrim(m.categoria) cat, btrim(m.linea) lin, m.prod, sum(m.neto) venta, sum(m.lineas) lineas
    from profit_articulos_mes m
    where m.lote = v_lote and m.empresa_id = any(v_emp) and m.prod <> ''
    group by 1, 2, 3, 4
  ), v as (
    select a.*, pr.categoria_id prod_cat from a left join productos pr on pr.id::text = a.prod
  ), par as (
    select empresa_id, cat, lin, sum(lineas) lineas, coalesce(sum(venta), 0) venta,
           coalesce(sum(venta) filter (where prod_cat is null), 0) venta_sin_articulo
    from v group by 1, 2, 3
  ), reparto as (
    select empresa_id, cat, lin, jsonb_agg(jsonb_build_object('categoria', nombre, 'venta_usd', round(venta, 2)) order by venta desc) reparto
    from (select v.empresa_id, v.cat, v.lin, c.nombre, sum(v.venta) venta
          from v join categorias c on c.id = v.prod_cat group by 1, 2, 3, 4) x
    group by 1, 2, 3
  )
  select jsonb_build_object(
    'filas', coalesce((select jsonb_agg(x order by x.empresa, x.venta_usd desc) from (
      select q.id, e.nombre_corto empresa, q.empresa_id, q.categoria_profit, q.linea_profit, q.categoria_id, c.nombre categoria,
             q.propuesta_id, cp.nombre propuesta, q.metodo, q.estado, q.revisado_at,
             nullif(btrim(concat_ws(' ', u.nombre, u.apellido)), '') revisado_por,
             coalesce(par.lineas, 0) lineas, round(coalesce(par.venta, 0), 2) venta_usd, round(coalesce(par.venta_sin_articulo, 0), 2) venta_sin_articulo_usd,
             coalesce(r.reparto, '[]'::jsonb) reparto
      from profit_categorias q
      join empresas e on e.id = q.empresa_id
      left join categorias c on c.id = q.categoria_id
      left join categorias cp on cp.id = q.propuesta_id
      left join usuarios u on u.id = q.revisado_por
      left join par on par.empresa_id = q.empresa_id and par.cat = q.categoria_profit and par.lin = q.linea_profit
      left join reparto r on r.empresa_id = q.empresa_id and r.cat = q.categoria_profit and r.lin = q.linea_profit
      where q.empresa_id = any(v_emp)) x), '[]'::jsonb),
    'candidatas', coalesce((select jsonb_agg(x order by x.nombre) from (
      select c.id, c.nombre, coalesce(jsonb_agg(distinct pr.empresa_id) filter (where pr.empresa_id is not null), '[]'::jsonb) empresas,
             count(pr.id) productos
      from categorias c left join productos pr on pr.categoria_id = c.id
      where c.odoo_id is not null
      group by c.id, c.nombre) x), '[]'::jsonb),
    'puede_editar', public.es_personal_admin() and public.puede('reportes', 'editar')
  ) into v_res;
  return v_res;
end $$;
revoke execute on function public.equivalencias_categorias_profit() from public, anon;
grant execute on function public.equivalencias_categorias_profit() to authenticated;

-- Guarda (y valida) equivalencias: p_cambios = [{"id": uuid, "categoria_id": uuid | null}]. null = sin equivalencia (se
-- muestra el nombre de Profit). Solo administración (personal de administración con reportes: editar), en la empresa activa.
create or replace function public.guardar_profit_categorias(p_cambios jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare v_activa uuid; v_usuario uuid; r record; n integer := 0;
begin
  if not (public.es_personal_admin() and public.puede('reportes', 'editar')) then
    raise exception 'Solo administración puede editar las equivalencias de categorías' using errcode = '42501';
  end if;
  v_activa := public.empresa_activa();
  if v_activa is null then
    raise exception 'Modo consulta ("Ambas empresas"): selecciona GUDS o Quirutec en el menú superior para hacer cambios.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_cambios) is distinct from 'array' or jsonb_array_length(p_cambios) = 0 or jsonb_array_length(p_cambios) > 500 then
    raise exception 'Envía entre 1 y 500 equivalencias' using errcode = '22023';
  end if;
  v_usuario := public.usuario_actual_id();
  for r in select * from jsonb_to_recordset(p_cambios) as x(id uuid, categoria_id uuid) loop
    if r.categoria_id is not null and not exists (select 1 from categorias c where c.id = r.categoria_id and c.odoo_id is not null) then
      raise exception 'La categoría no existe en Odoo' using errcode = '22023';
    end if;
    update profit_categorias set categoria_id = r.categoria_id, estado = 'validado', revisado_por = v_usuario, revisado_at = now()
    where id = r.id and empresa_id = v_activa;
    if not found then
      raise exception 'Equivalencia no encontrada en la empresa activa' using errcode = 'P0002';
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.guardar_profit_categorias(jsonb) from public, anon;
grant execute on function public.guardar_profit_categorias(jsonb) to authenticated;

-- 4. Motor de reportes (20j) con la clasificación unificada ------------------------------------------------------------
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
    when 'categoria_profit' then 'b.categoria_p'
    when 'linea_profit' then 'b.linea_p'
    when 'sublinea_profit' then 'b.sublinea_p'
  end || ') collate "C"';
$$;
revoke execute on function public.cubo_dimension_sql(text) from public, anon, authenticated;

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
      when 'categoria_profit' then format('coalesce(nullif(%s, ''''), ''Sin categoría de Profit'')', k)
      when 'linea_profit' then format('coalesce(nullif(%s, ''''), ''Sin línea de Profit'')', k)
      when 'sublinea_profit' then format('coalesce(nullif(%s, ''''), ''Sin sub-línea de Profit'')', k)
    end
  end;
$$;
revoke execute on function public.cubo_etiqueta_sql(text, text, text, boolean) from public, anon, authenticated;

-- Niveles del nombre de la categoría de Odoo (el alias ct lo usan las bases del cubo)
create or replace function public.cubo_niveles_categoria_sql() returns text language sql immutable set search_path = public as $$
  select $q$(select c.id, nullif(upper(btrim(split_part(c.nombre, '/', 1))), '') c1, nullif(upper(btrim(split_part(c.nombre, '/', 2))), '') c2,
                      nullif(upper(btrim(split_part(c.nombre, '/', 3))), '') c3 from public.categorias c)$q$;
$$;
revoke execute on function public.cubo_niveles_categoria_sql() from public, anon, authenticated;

-- Clasificación de una fila de Profit (alias v = ventas_historicas o m = profit_articulos_mes, pr = producto, pq =
-- equivalencia, ct = niveles de la categoría de Odoo, cl = cliente): categoría › línea › sub-línea de Odoo del mismo
-- artículo o de la equivalencia; si no hay, el nombre de Profit marcado "(Profit)"
create or replace function public.cubo_clasificacion_profit_sql(a text) returns text language sql immutable set search_path = public as $$
  select format($q$
           case when ct.id is not null then coalesce(ct.c1, '')
                when btrim(coalesce(%1$s.categoria, '')) <> '' then upper(btrim(%1$s.categoria)) || ' (Profit)' else '' end categoria,
           case when ct.id is not null then coalesce(ct.c2, '') else upper(btrim(coalesce(%1$s.linea, ''))) end linea,
           case when ct.id is not null then coalesce(ct.c3, '') else upper(btrim(coalesce(%1$s.sublinea, ''))) end sublinea,
           coalesce(nullif(pr.marca, ''), nullif(%1$s.marca, ''), '') marca,
           btrim(coalesce(%1$s.categoria, '')) categoria_p, btrim(coalesce(%1$s.linea, '')) linea_p, btrim(coalesce(%1$s.sublinea, '')) sublinea_p$q$, a);
$$;
revoke execute on function public.cubo_clasificacion_profit_sql(text) from public, anon, authenticated;

create or replace function public.cubo_base_sql(p_odoo boolean, p_profit boolean, p_detalle boolean default false) returns text
language plpgsql immutable set search_path = public as $$
declare v_odoo text; v_profit text;
begin
  v_odoo := $q$
    select 'odoo'::text fte, dv.empresa_id, dv.fecha, dv.id::text doc, dv.tipo = 'factura' es_fac,
           coalesce(dv.cliente_id::text, '') cli, coalesce(nullif(dv.vendedor, 'Sin vendedor'), '') vendedor,
           coalesce(cl.tipo_cliente, '') tipo_cliente, coalesce(cl.canal, '') canal, coalesce(cl.segmento, '') segmento,
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
           coalesce(nullif(cl.tipo_cliente, ''), nullif(v.tipo_cliente, ''), '') tipo_cliente, coalesce(nullif(cl.canal, ''), nullif(v.canal, ''), '') canal,
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
end $$;
revoke execute on function public.cubo_base_sql(boolean, boolean, boolean) from public, anon, authenticated;

-- Por documento: tipo de cliente, canal y segmento de Odoo (del cliente) y, en Profit sin clasificar en Odoo, los de Profit
create or replace function public.cubo_base_docs_sql(p_odoo boolean, p_profit boolean) returns text
language plpgsql immutable set search_path = public as $$
declare v_odoo text; v_profit text;
begin
  v_odoo := $q$
    select 'odoo'::text fte, dv.empresa_id, dv.fecha, dv.id::text doc, dv.tipo = 'factura' es_fac,
           coalesce(dv.cliente_id::text, '') cli, coalesce(nullif(dv.vendedor, 'Sin vendedor'), '') vendedor,
           coalesce(cl.tipo_cliente, '') tipo_cliente, coalesce(cl.canal, '') canal, coalesce(cl.segmento, '') segmento,
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
           coalesce(nullif(cl.tipo_cliente, ''), nullif(d.tipo_cliente, ''), '') tipo_cliente, coalesce(nullif(cl.canal, ''), nullif(d.canal, ''), '') canal,
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
end $$;
revoke execute on function public.cubo_base_docs_sql(boolean, boolean) from public, anon, authenticated;

-- Camino mensual: la misma clasificación que las líneas (el resumen mensual guarda la clasificación original de Profit)
create or replace function public.cubo_base_mensual_sql(p_odoo boolean, p_profit boolean) returns text
language plpgsql immutable set search_path = public as $$
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
           coalesce(nullif(cl.tipo_cliente, ''), nullif(m.tipo_cliente, ''), '') tipo_cliente, coalesce(nullif(cl.canal, ''), nullif(m.canal, ''), '') canal,
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
end $$;
revoke execute on function public.cubo_base_mensual_sql(boolean, boolean) from public, anon, authenticated;

-- Detalle de líneas (hoja "Base datos"): las columnas del Excel conservan la clasificación de cada fuente (Profit la suya,
-- Odoo la de Odoo) y se agregan Categoría, Línea y Sub-línea de Odoo (la unificada del motor)
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
              costo_usd numeric, rentabilidad_usd numeric, categoria_odoo text, linea_odoo text, sublinea_odoo text)
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

-- 5. reporte_ventas por categoría: los artículos de Profit sin pareja usan la equivalencia (misma función que 20g) ----
create or replace function public.reporte_ventas(p_desde date, p_hasta date, p_agrupar text, p_fuente text default 'ambas',
                                                 p_conteos boolean default true)
returns table(clave text, etiqueta text, detalle text, documentos bigint, clientes bigint, cantidad numeric,
              bruto_usd numeric, nc_usd numeric, neto_usd numeric, profit_usd numeric, financieras_usd numeric, fuente text)
language plpgsql stable security definer set search_path = public set work_mem = '16MB' as $$
#variable_conflict use_column
declare
  v_fuente text := coalesce(p_fuente, 'ambas');
  v_odoo boolean;
  v_profit boolean;
  v_emp uuid[];
  v_lote bigint;
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
    ), e1 as (
      select case when p_agrupar = 'producto' then coalesce(l.producto_id::text, l.sku, l.nombre)
                  else coalesce(pr.categoria_id::text, l.cat_eq::text, 'profit:' || upper(l.cat_profit), 'sin') end k,
             coalesce(l.producto_id::text, l.sku, l.nombre) pk, sum(l.cant) cant,
             sum(l.usd) filter (where not l.es_nc) fac, sum(l.usd) filter (where l.es_nc) nc, sum(l.usd) usd,
             sum(l.usd) filter (where l.fte = 'profit') prof, bool_or(l.fte = 'odoo') hay_odoo, bool_or(l.fte = 'profit') hay_profit,
             max(l.producto_id::text) prod, max(l.nombre) nombre, max(l.sku) sku, max(l.cat_profit) cat_profit
      from l left join productos pr on pr.id = l.producto_id
      group by 1, 2
    ), g as (
      select e1.k, count(*) n, sum(e1.cant) cant, sum(e1.fac) fac, sum(e1.nc) nc, sum(e1.usd) usd, sum(e1.prof) prof,
             bool_or(e1.hay_odoo) hay_odoo, bool_or(e1.hay_profit) hay_profit,
             max(e1.prod) prod, max(e1.nombre) nombre, max(e1.sku) sku, max(e1.cat_profit) cat_profit
      from e1 group by e1.k
    )
    select g.k,
           case when p_agrupar = 'producto' then coalesce(p.nombre, g.nombre)
                else coalesce(c.nombre, g.cat_profit || ' (Profit)', 'Sin categoría') end::text,
           case when p_agrupar = 'producto' then coalesce(p.sku, g.sku) else g.n::text || ' productos' end::text,
           null::bigint, null::bigint, round(g.cant, 2), round(g.fac, 2), round(coalesce(g.nc, 0), 2), round(g.usd, 2), round(coalesce(g.prof, 0), 2), 0::numeric,
           case when g.hay_odoo and g.hay_profit then 'ambas' when g.hay_profit then 'profit' else 'odoo' end
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
    ), lk as (
      -- Solo claves y montos (las etiquetas se buscan al final, por grupo)
      select case when p_agrupar = 'producto' then coalesce(l.producto_id::text, l.sku, l.nombre)
                  else coalesce(pr.categoria_id::text, l.cat_eq::text, 'profit:' || upper(l.cat_profit), 'sin') end k,
             coalesce(l.producto_id::text, l.sku, l.nombre) pk, l.fte, l.doc_o, l.doc_p, l.cli, l.es_nc, l.producto_id, l.sku, l.nombre,
             l.cat_profit, l.cant, l.usd
      from l left join productos pr on pr.id = l.producto_id
    ), e1 as (
      select lk.k, lk.cli, count(distinct lk.doc_o) + count(distinct lk.doc_p) docs, sum(lk.cant) cant,
             sum(lk.usd) filter (where not lk.es_nc) fac, sum(lk.usd) filter (where lk.es_nc) nc, sum(lk.usd) usd,
             sum(lk.usd) filter (where lk.fte = 'profit') prof, bool_or(lk.fte = 'odoo') hay_odoo, bool_or(lk.fte = 'profit') hay_profit,
             max(lk.producto_id::text) prod, max(lk.nombre) nombre, max(lk.sku) sku, max(lk.cat_profit) cat_profit
      from lk group by lk.k, lk.cli
    ), np as (
      select lk.k, count(distinct lk.pk) n from lk where p_agrupar = 'categoria' group by lk.k
    ), g as (
      select e1.k, sum(e1.docs)::bigint docs, count(e1.cli) clis, sum(e1.cant) cant, sum(e1.fac) fac, sum(e1.nc) nc, sum(e1.usd) usd,
             sum(e1.prof) prof, bool_or(e1.hay_odoo) hay_odoo, bool_or(e1.hay_profit) hay_profit,
             max(e1.prod) prod, max(e1.nombre) nombre, max(e1.sku) sku, max(e1.cat_profit) cat_profit
      from e1 group by e1.k
    )
    select g.k,
           case when p_agrupar = 'producto' then coalesce(p.nombre, g.nombre)
                else coalesce(c.nombre, g.cat_profit || ' (Profit)', 'Sin categoría') end::text,
           case when p_agrupar = 'producto' then coalesce(p.sku, g.sku) else np.n::text || ' productos' end::text,
           g.docs, g.clis, round(g.cant, 2), round(g.fac, 2), round(coalesce(g.nc, 0), 2), round(g.usd, 2), round(coalesce(g.prof, 0), 2), 0::numeric,
           case when g.hay_odoo and g.hay_profit then 'ambas' when g.hay_profit then 'profit' else 'odoo' end
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
           case when bool_or(k.fte = 'odoo') and bool_or(k.fte = 'profit') then 'ambas' when bool_or(k.fte = 'profit') then 'profit' else 'odoo' end
    from k
    left join clientes cl on cl.id = (case when k.cli !~ '^profit:' then k.cli::uuid end)
    left join empresas e on e.id = k.empresa_id
    group by k.k
    order by case when p_agrupar = 'mes' then k.k end, 9 desc nulls last;
  end if;
end $$;
revoke execute on function public.reporte_ventas(date, date, text, text, boolean) from public, anon;
grant execute on function public.reporte_ventas(date, date, text, text, boolean) to authenticated;

notify pgrst, 'reload schema';

commit;
