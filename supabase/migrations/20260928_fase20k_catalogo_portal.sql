-- ════════════════════════════════════════════════════════════════════════
-- Fase 20k · Catálogo del portal paginado en el servidor y ficha de producto (F2 del portal del cliente)
--   Antes el portal descargaba todos los productos (select=*, con costo) y calculaba el precio en el navegador con la lista
--   del cliente; "ordenar" y la búsqueda por código o sin acentos no funcionaban. Ahora:
--   · catalogo_portal(...)  → una página de productos activos de la empresa activa con el precio que cobra el servidor
--     (precio_efectivo del cliente, por empaque), el disponible, el IVA, la imagen y si es favorito; más el total.
--     Busca por nombre (la marca va en el nombre), código y categoría sin acentos ni mayúsculas; ordena por relevancia,
--     nombre, precio o disponibilidad; filtra por categoría, "solo disponibles", destacados o una lista de ids (favoritos).
--     Si la búsqueda exacta no encuentra nada, devuelve resultados aproximados (trigramas) y lo indica (aproximado = true).
--   · categorias_portal()   → categorías con productos a la venta en la empresa activa (no depende de categorias.activo).
--   · producto_portal(id)   → ficha: lo anterior + descripción, última compra del cliente y productos relacionados.
--   Las tres son SECURITY DEFINER, solo para un usuario cliente activo y ligadas a su ficha (mi_cliente_id) en la empresa
--   activa; nunca devuelven productos.costo. anon y public no las ejecutan.
-- ════════════════════════════════════════════════════════════════════════
begin;

create extension if not exists unaccent with schema extensions;

-- Texto normalizado para buscar: minúsculas, sin acentos (ñ → n) y espacios simples. Inmutable (diccionario explícito).
create or replace function public.texto_busqueda(t text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select btrim(regexp_replace(lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(t, ''))), '\s+', ' ', 'g'))
$$;

-- Quién llama: usuario cliente activo, su ficha en la empresa activa (la misma que usa el checkout) y la empresa.
create or replace function public.portal_contexto(out o_usuario uuid, out o_cliente uuid, out o_empresa uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;
  select u.id into o_usuario from usuarios u
   where u.auth_id = auth.uid() and coalesce(u.activo, true) and u.role = 'cliente';
  if o_usuario is null then
    raise exception 'El catálogo del portal es solo para clientes' using errcode = '42501';
  end if;
  o_empresa := public.empresa_activa_requerida();
  o_cliente := public.mi_cliente_id();
  if o_cliente is null or not exists (select 1 from clientes c where c.id = o_cliente and (c.empresa_id is null or c.empresa_id = o_empresa)) then
    raise exception 'Tu cuenta no está habilitada para comprar en esta empresa' using errcode = 'P0001';
  end if;
end $$;

-- Un producto como lo ve el cliente (sin costo). El precio es precio_efectivo del cliente para cada empaque (lo que cobra
-- el carrito y el checkout); "precio" es el de la opción que se agrega por defecto (el empaque de menos unidades, o la
-- unidad si no tiene empaques) y "precio_unidades" cuántas unidades trae esa opción.
create or replace function public.portal_producto_item(p_id uuid, p_cliente uuid, p_usuario uuid, p_detalle boolean default false)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
      'id', p.id,
      'sku', p.sku,
      'nombre', p.nombre,
      'unidad', p.unidad,
      'precio_base', p.precio_base,
      'precio_oferta', p.precio_oferta,
      'en_oferta', coalesce(p.en_oferta, false),
      'porcentaje_descuento', p.porcentaje_descuento,
      'imagen_url', p.imagen_url,
      'imagenes', coalesce(p.imagenes, '[]'::jsonb),
      'destacado', coalesce(p.destacado, false),
      'controla_stock', coalesce(p.controla_stock, true),
      'stock_disponible', greatest(coalesce(p.stock_disponible, p.stock_actual, 0), 0),
      'impuesto_pct', p.impuesto_pct,
      'impuesto_nombre', p.impuesto_nombre,
      'categoria_id', p.categoria_id,
      'categoria', case when cat.id is null then null else jsonb_build_object(
        'id', cat.id, 'nombre', btrim(cat.nombre), 'etiqueta', btrim(regexp_replace(cat.nombre, '^.*/', ''))) end,
      'favorito', exists (select 1 from favoritos f where f.usuario_id = p_usuario and f.producto_id = p.id),
      'precio', coalesce((emp.lista -> 0 ->> 'precio')::numeric, public.precio_efectivo(p.id, null, p_cliente)),
      'precio_unidades', coalesce((emp.lista -> 0 -> 'tipo_empaque' ->> 'unidades')::int, 1),
      'producto_empaques', coalesce(emp.lista, '[]'::jsonb))
    || case when p_detalle then jsonb_build_object('descripcion', nullif(btrim(p.descripcion), '')) else '{}'::jsonb end
  from productos p
  left join categorias cat on cat.id = p.categoria_id
  left join lateral (
    select jsonb_agg(jsonb_build_object(
             'id', x.id,
             'tipo_empaque_id', x.tipo_empaque_id,
             'precio', public.precio_efectivo(p.id, x.tipo_empaque_id, p_cliente),
             'tipo_empaque', jsonb_build_object('id', x.tipo_empaque_id, 'nombre', x.nombre, 'unidades', x.unidades))
           order by x.unidades, x.orden, x.nombre) lista
    from (select pe.id, pe.tipo_empaque_id, greatest(coalesce(te.unidades, 1), 1) unidades, te.orden, te.nombre
            from producto_empaques pe join tipos_empaque te on te.id = pe.tipo_empaque_id
           where pe.producto_id = p.id and coalesce(pe.activo, true) and coalesce(te.activo, true)) x
  ) emp on true
  where p.id = p_id
$$;

-- Catálogo paginado. p_orden: relevancia | nombre | precio_asc | precio_desc | disponibles. p_limite máx. 100.
create or replace function public.catalogo_portal(
  p_busqueda text default null,
  p_categoria uuid default null,
  p_orden text default 'relevancia',
  p_limite integer default 24,
  p_offset integer default 0,
  p_solo_disponibles boolean default false,
  p_solo_destacados boolean default false,
  p_ids uuid[] default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c record;
  v_q text := public.texto_busqueda(left(coalesce(p_busqueda, ''), 120));
  v_terminos text[];
  v_orden text := coalesce(nullif(btrim(p_orden), ''), 'relevancia');
  v_lim int := least(greatest(coalesce(p_limite, 24), 1), 100);
  v_off int := greatest(coalesce(p_offset, 0), 0);
  v_total int;
  v_productos jsonb;
  v_aprox boolean := false;
begin
  select * into c from public.portal_contexto();
  if v_orden not in ('relevancia', 'nombre', 'precio_asc', 'precio_desc', 'disponibles') then
    raise exception 'Orden no válido: %', p_orden using errcode = '22023';
  end if;
  v_terminos := case when v_q = '' then '{}'::text[] else string_to_array(v_q, ' ') end;

  -- Primero cada palabra debe aparecer tal cual (sin acentos) en el nombre, el código o la categoría. Si no hay nada, una
  -- segunda pasada aproximada (trigramas) tolera errores de tipeo en palabras de 3 letras o más ("acidas" → "ACIDOS").
  loop
  with base as (
    select p.id, p.destacado, p.categoria_id,
           public.texto_busqueda(p.nombre) n_nombre,
           public.texto_busqueda(p.sku) n_sku,
           public.texto_busqueda(cat.nombre) n_cat,
           public.texto_busqueda(concat_ws(' ', p.nombre, p.sku, cat.nombre)) n_todo,
           (not coalesce(p.controla_stock, true)) or coalesce(p.stock_disponible, p.stock_actual, 0) > 0 hay
      from productos p
      left join categorias cat on cat.id = p.categoria_id
     where p.activo and coalesce(p.vendible, true) and not coalesce(p.oculto_tienda, false)
       and (p.empresa_id = c.o_empresa or p.empresa_id is null)
       and (p_categoria is null or p.categoria_id = p_categoria)
       and (p_ids is null or p.id = any (p_ids))
       and (not coalesce(p_solo_destacados, false) or p.destacado)
  ),
  f as materialized (
    select b.*,
           case when v_q = '' then 0 else
             (case
                when b.n_sku = v_q then 1000
                when left(b.n_sku, length(v_q)) = v_q then 800
                when b.n_nombre = v_q then 700
                when left(b.n_nombre, length(v_q)) = v_q then 600
                when strpos(' ' || b.n_nombre, ' ' || v_q) > 0 then 500
                when strpos(b.n_nombre, v_q) > 0 then 400
                when strpos(b.n_cat, v_q) > 0 then 200
                else 100 end)
             + extensions.similarity(b.n_nombre, v_q) * 100 end relevancia,
           case when v_orden in ('precio_asc', 'precio_desc') then
             public.precio_efectivo(b.id,
               (select pe.tipo_empaque_id from producto_empaques pe join tipos_empaque te on te.id = pe.tipo_empaque_id
                 where pe.producto_id = b.id and coalesce(pe.activo, true) and coalesce(te.activo, true)
                 order by greatest(coalesce(te.unidades, 1), 1), te.orden, te.nombre limit 1),
               c.o_cliente) end precio
      from base b
     where (not coalesce(p_solo_disponibles, false) or b.hay)
       and not exists (select 1 from unnest(v_terminos) t
                        where strpos(b.n_todo, t) = 0
                          and (not v_aprox or length(t) < 3 or extensions.word_similarity(t, b.n_todo) < 0.5))
  ),
  pagina as (
    select f.id, row_number() over (order by
             case when v_orden = 'relevancia' and v_q <> '' then f.relevancia end desc nulls last,
             case when v_orden = 'relevancia' and v_q = '' then f.destacado::int end desc nulls last,
             case when v_orden in ('relevancia', 'disponibles') then f.hay::int end desc nulls last,
             case when v_orden = 'precio_asc' then f.precio end asc nulls last,
             case when v_orden = 'precio_desc' then f.precio end desc nulls last,
             f.n_nombre, f.id) rn
      from f
  )
  select (select count(*) from f),
         coalesce((select jsonb_agg(public.portal_producto_item(x.id, c.o_cliente, c.o_usuario) order by x.rn)
                     from (select id, rn from pagina order by rn limit v_lim offset v_off) x), '[]'::jsonb)
    into v_total, v_productos;
  exit when v_total > 0 or v_q = '' or v_aprox;
  v_aprox := true;
  end loop;

  return jsonb_build_object('total', v_total, 'limite', v_lim, 'offset', v_off, 'aproximado', v_aprox, 'productos', v_productos);
end $$;

-- Categorías con productos a la venta en la empresa activa (solo las que tienen productos; ignora categorias.activo).
create or replace function public.categorias_portal()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c record;
  v jsonb;
begin
  select * into c from public.portal_contexto();
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', cat.id, 'nombre', btrim(cat.nombre), 'etiqueta', btrim(regexp_replace(cat.nombre, '^.*/', '')),
           'n', x.n, 'disponibles', x.d) order by public.texto_busqueda(cat.nombre)), '[]'::jsonb)
    into v
    from (select p.categoria_id, count(*) n,
                 count(*) filter (where (not coalesce(p.controla_stock, true)) or coalesce(p.stock_disponible, p.stock_actual, 0) > 0) d
            from productos p
           where p.activo and coalesce(p.vendible, true) and not coalesce(p.oculto_tienda, false)
             and (p.empresa_id = c.o_empresa or p.empresa_id is null) and p.categoria_id is not null
           group by p.categoria_id) x
    join categorias cat on cat.id = x.categoria_id;
  return v;
end $$;

-- Ficha de producto: null si no está a la venta en la empresa activa.
create or replace function public.producto_portal(p_producto_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c record;
  v_cat uuid;
  v_nombre text;
  v_ultima jsonb;
  v_rel jsonb;
begin
  select * into c from public.portal_contexto();
  select p.categoria_id, public.texto_busqueda(p.nombre) into v_cat, v_nombre
    from productos p
   where p.id = p_producto_id and p.activo and coalesce(p.vendible, true) and not coalesce(p.oculto_tienda, false)
     and (p.empresa_id = c.o_empresa or p.empresa_id is null);
  if not found then return null; end if;

  -- Última compra del cliente (sus fichas en la empresa activa; sin pedidos cancelados ni rechazados)
  with compras as (
    select o.id, o.numero, coalesce(o.fecha_pedido, o.created_at) fecha, oi.cantidad, oi.tipo_empaque_id, te.nombre empaque,
           greatest(coalesce(oi.unidades_por_empaque, te.unidades, 1), 1) unidades, oi.precio_unitario
      from orden_items oi
      join ordenes o on o.id = oi.orden_id
      left join tipos_empaque te on te.id = oi.tipo_empaque_id
     where oi.producto_id = p_producto_id
       and o.cliente_id = any (public.clientes_del_usuario())
       and (o.empresa_id = c.o_empresa or o.empresa_id is null)
       and o.estado::text <> 'cancelado' and coalesce(o.aprobacion, '') <> 'rechazada'
  )
  select jsonb_build_object(
           'orden_id', u.id, 'numero', u.numero, 'fecha', u.fecha, 'cantidad', u.cantidad,
           'tipo_empaque_id', u.tipo_empaque_id, 'empaque', u.empaque, 'unidades', u.unidades,
           'precio_unitario', u.precio_unitario,
           'veces', (select count(distinct id) from compras))
    into v_ultima
    from (select * from compras order by fecha desc, id limit 1) u;

  -- Relacionados: misma categoría, con disponible primero y nombres parecidos
  select coalesce(jsonb_agg(public.portal_producto_item(r.id, c.o_cliente, c.o_usuario) order by r.rn), '[]'::jsonb)
    into v_rel
    from (select p.id, row_number() over (order by
                   ((not coalesce(p.controla_stock, true)) or coalesce(p.stock_disponible, p.stock_actual, 0) > 0) desc,
                   extensions.similarity(public.texto_busqueda(p.nombre), v_nombre) desc, p.nombre, p.id) rn
            from productos p
           where p.id <> p_producto_id and p.activo and coalesce(p.vendible, true) and not coalesce(p.oculto_tienda, false)
             and (p.empresa_id = c.o_empresa or p.empresa_id is null)
             and (v_cat is null or p.categoria_id = v_cat)
           order by rn limit 8) r;

  return jsonb_build_object(
    'producto', public.portal_producto_item(p_producto_id, c.o_cliente, c.o_usuario, true),
    'ultima_compra', v_ultima,
    'relacionados', v_rel);
end $$;

-- Permisos: las internas no se ejecutan por la API; las del portal solo con sesión
revoke execute on function public.portal_contexto() from public, anon, authenticated;
revoke execute on function public.portal_producto_item(uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.catalogo_portal(text, uuid, text, integer, integer, boolean, boolean, uuid[]) from public, anon;
revoke execute on function public.categorias_portal() from public, anon;
revoke execute on function public.producto_portal(uuid) from public, anon;
revoke execute on function public.texto_busqueda(text) from public, anon;
grant execute on function public.catalogo_portal(text, uuid, text, integer, integer, boolean, boolean, uuid[]) to authenticated;
grant execute on function public.categorias_portal() to authenticated;
grant execute on function public.producto_portal(uuid) to authenticated;
grant execute on function public.texto_busqueda(text) to authenticated;

commit;
