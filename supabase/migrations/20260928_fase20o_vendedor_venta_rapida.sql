-- ════════════════════════════════════════════════════════════════════════
-- Fase 20o · Portal del vendedor V2: venta rápida (plan de portales §5 y plan del vendedor 3.4)
--   Antes el vendedor elegía el producto en un select de 105 opciones sin búsqueda, con el precio base (no el del cliente),
--   sin saber qué compra ese cliente, y un doble toque con mala señal podía crear dos pedidos. Ahora:
--   · catalogo_vendedor(cliente, …)   → una página de productos a la venta en la empresa del cliente, con el precio que
--     cobra el servidor a ESE cliente (precio_efectivo por empaque), sus empaques, el disponible, el IVA de Odoo y cuántas
--     veces lo compró. Busca por nombre, código o categoría sin acentos (texto_busqueda de la 20k); si no encuentra nada,
--     una segunda pasada aproximada (trigramas) tolera errores de tipeo.
--   · categorias_vendedor(cliente)    → categorías con productos a la venta en la empresa del cliente.
--   · compras_cliente_vendedor(cliente) → "Lo que compra este cliente": productos más pedidos (últimos 180 días primero)
--     con la última cantidad (en unidades, para convertirla al empaque de hoy) y su último pedido para repetirlo.
--   · crear_orden_vendedor(…, p_clave) → idempotente: el borrador del navegador genera una clave; si la misma clave llega
--     dos veces (doble toque, reintento tras un corte), devuelve el pedido ya creado en lugar de crear otro.
--   Todas validan que el cliente sea de la cartera de quien llama (es_vendedor_de); nunca devuelven productos.costo.
-- ════════════════════════════════════════════════════════════════════════
begin;

-- 1. Clave de idempotencia del pedido ------------------------------------------------------------------------------------
alter table public.ordenes add column if not exists clave_idempotencia uuid;
comment on column public.ordenes.clave_idempotencia is
  'Clave que genera el borrador del vendedor: la misma clave nunca crea dos pedidos (crear_orden_vendedor)';
create unique index if not exists ordenes_clave_idempotencia_key on public.ordenes (clave_idempotencia) where clave_idempotencia is not null;

-- 2. Contexto: el cliente debe ser de la cartera de quien llama; devuelve la empresa del cliente ---------------------------
create or replace function public.vendedor_cliente_empresa(p_cliente_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_emp uuid;
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;
  if p_cliente_id is null or not public.es_vendedor_de(p_cliente_id) then
    raise exception 'Este cliente no está en tu cartera' using errcode = '42501';
  end if;
  select coalesce(c.empresa_id, public.empresa_activa()) into v_emp from clientes c where c.id = p_cliente_id;
  return v_emp;
end $$;

-- 3. Un producto como lo ve el vendedor para un cliente (sin costo) --------------------------------------------------------
-- "precio" es el de la opción por defecto (el empaque de menos unidades, o la unidad si no tiene empaques), como el portal.
create or replace function public.vendedor_producto_item(p_id uuid, p_cliente uuid)
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
      'imagen_url', p.imagen_url,
      'controla_stock', coalesce(p.controla_stock, true),
      'stock_disponible', greatest(coalesce(p.stock_disponible, p.stock_actual, 0), 0),
      'impuesto_pct', p.impuesto_pct,
      'impuesto_nombre', p.impuesto_nombre,
      'categoria', case when cat.id is null then null else jsonb_build_object(
        'id', cat.id, 'etiqueta', btrim(regexp_replace(cat.nombre, '^.*/', ''))) end,
      'precio', coalesce((emp.lista -> 0 ->> 'precio')::numeric, public.precio_efectivo(p.id, null, p_cliente)),
      'precio_unidades', coalesce((emp.lista -> 0 -> 'tipo_empaque' ->> 'unidades')::int, 1),
      'empaques', coalesce(emp.lista, '[]'::jsonb),
      'compras', jsonb_build_object('veces', coalesce(cp.veces, 0), 'ultima', cp.ultima))
  from productos p
  left join categorias cat on cat.id = p.categoria_id
  left join lateral (
    select jsonb_agg(jsonb_build_object(
             'tipo_empaque_id', x.tipo_empaque_id,
             'precio', public.precio_efectivo(p.id, x.tipo_empaque_id, p_cliente),
             'tipo_empaque', jsonb_build_object('id', x.tipo_empaque_id, 'nombre', x.nombre, 'unidades', x.unidades))
           order by x.unidades, x.orden, x.nombre) lista
    from (select pe.tipo_empaque_id, greatest(coalesce(te.unidades, 1), 1) unidades, te.orden, te.nombre
            from producto_empaques pe join tipos_empaque te on te.id = pe.tipo_empaque_id
           where pe.producto_id = p.id and coalesce(pe.activo, true) and coalesce(te.activo, true)) x
  ) emp on true
  left join lateral (
    select count(distinct o.id) veces, max(coalesce(o.fecha_pedido, o.created_at)) ultima
      from orden_items oi join ordenes o on o.id = oi.orden_id
     where oi.producto_id = p.id and o.cliente_id = p_cliente
       and o.estado::text <> 'cancelado' and coalesce(o.aprobacion, '') <> 'rechazada'
  ) cp on true
  where p.id = p_id
$$;

-- 4. Catálogo paginado del vendedor para un cliente -----------------------------------------------------------------------
-- p_ids: solo esos productos (repetir el último pedido, refrescar un borrador guardado o duplicar un pedido).
drop function if exists public.catalogo_vendedor(uuid, text, uuid, integer, integer, boolean);
create or replace function public.catalogo_vendedor(
  p_cliente_id uuid,
  p_busqueda text default null,
  p_categoria uuid default null,
  p_limite integer default 30,
  p_offset integer default 0,
  p_solo_disponibles boolean default false,
  p_ids uuid[] default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.vendedor_cliente_empresa(p_cliente_id);
  v_q text := public.texto_busqueda(left(coalesce(p_busqueda, ''), 120));
  v_terminos text[];
  v_lim int := least(greatest(coalesce(p_limite, 30), 1), 100);
  v_off int := greatest(coalesce(p_offset, 0), 0);
  v_total int;
  v_productos jsonb;
  v_aprox boolean := false;
begin
  v_terminos := case when v_q = '' then '{}'::text[] else string_to_array(v_q, ' ') end;
  loop
    with base as (
      select p.id,
             public.texto_busqueda(p.nombre) n_nombre,
             public.texto_busqueda(p.sku) n_sku,
             public.texto_busqueda(cat.nombre) n_cat,
             public.texto_busqueda(concat_ws(' ', p.nombre, p.sku, cat.nombre)) n_todo,
             (not coalesce(p.controla_stock, true)) or coalesce(p.stock_disponible, p.stock_actual, 0) > 0 hay
        from productos p
        left join categorias cat on cat.id = p.categoria_id
       where p.activo and coalesce(p.vendible, true)
         and (p.empresa_id = v_emp or p.empresa_id is null)
         and (p_categoria is null or p.categoria_id = p_categoria)
         and (p_ids is null or p.id = any (p_ids))
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
               + extensions.similarity(b.n_nombre, v_q) * 100 end relevancia
        from base b
       where (not coalesce(p_solo_disponibles, false) or b.hay)
         and not exists (select 1 from unnest(v_terminos) t
                          where strpos(b.n_todo, t) = 0
                            and (not v_aprox or length(t) < 3 or extensions.word_similarity(t, b.n_todo) < 0.5))
    ),
    pagina as (
      select f.id, row_number() over (order by
               case when v_q <> '' then f.relevancia end desc nulls last,
               f.hay::int desc, f.n_nombre, f.id) rn
        from f
    )
    select (select count(*) from f),
           coalesce((select jsonb_agg(public.vendedor_producto_item(x.id, p_cliente_id) order by x.rn)
                       from (select id, rn from pagina order by rn limit v_lim offset v_off) x), '[]'::jsonb)
      into v_total, v_productos;
    exit when v_total > 0 or v_q = '' or v_aprox;
    v_aprox := true;
  end loop;

  return jsonb_build_object('total', v_total, 'limite', v_lim, 'offset', v_off, 'aproximado', v_aprox, 'productos', v_productos);
end $$;

-- 5. Categorías con productos a la venta en la empresa del cliente ---------------------------------------------------------
create or replace function public.categorias_vendedor(p_cliente_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.vendedor_cliente_empresa(p_cliente_id);
  v jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', cat.id, 'etiqueta', btrim(regexp_replace(cat.nombre, '^.*/', '')), 'n', x.n)
           order by public.texto_busqueda(regexp_replace(cat.nombre, '^.*/', ''))), '[]'::jsonb)
    into v
    from (select p.categoria_id, count(*) n from productos p
           where p.activo and coalesce(p.vendible, true) and (p.empresa_id = v_emp or p.empresa_id is null)
             and p.categoria_id is not null
           group by p.categoria_id) x
    join categorias cat on cat.id = x.categoria_id;
  return v;
end $$;

-- 6. Lo que compra este cliente ------------------------------------------------------------------------------------------
-- Productos que pidió (sin pedidos cancelados ni rechazados), los de los últimos 180 días primero; la última cantidad va
-- también en unidades (las líneas que vienen de Odoo no traen empaque) para convertirla al empaque que se vende hoy.
create or replace function public.compras_cliente_vendedor(p_cliente_id uuid, p_limite integer default 24)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.vendedor_cliente_empresa(p_cliente_id);
  v_lim int := least(greatest(coalesce(p_limite, 24), 1), 60);
  v_frecuentes jsonb;
  v_ultimo jsonb;
begin
  with compras as (
    select oi.producto_id, o.id orden_id, coalesce(o.fecha_pedido, o.created_at) fecha, oi.cantidad, oi.tipo_empaque_id,
           oi.cantidad * greatest(coalesce(oi.unidades_por_empaque, te.unidades, 1), 1) unidades
      from orden_items oi
      join ordenes o on o.id = oi.orden_id
      left join tipos_empaque te on te.id = oi.tipo_empaque_id
     where o.cliente_id = p_cliente_id and oi.producto_id is not null
       and o.estado::text <> 'cancelado' and coalesce(o.aprobacion, '') <> 'rechazada'
  ),
  agg as (
    select producto_id, count(distinct orden_id) veces,
           count(distinct orden_id) filter (where fecha >= now() - interval '180 days') veces_180,
           max(fecha) ultima
      from compras group by producto_id
  ),
  ult as (
    select distinct on (producto_id) producto_id, cantidad, tipo_empaque_id, unidades
      from compras order by producto_id, fecha desc
  ),
  top as (
    select a.producto_id, a.veces, a.veces_180, a.ultima, u.cantidad, u.tipo_empaque_id, u.unidades,
           row_number() over (order by a.veces_180 desc, a.veces desc, a.ultima desc, a.producto_id) rn
      from agg a
      join ult u on u.producto_id = a.producto_id
      join productos p on p.id = a.producto_id
     where p.activo and coalesce(p.vendible, true) and (p.empresa_id = v_emp or p.empresa_id is null)
  )
  select coalesce(jsonb_agg(public.vendedor_producto_item(t.producto_id, p_cliente_id) || jsonb_build_object(
           'frecuencia', jsonb_build_object('veces', t.veces, 'veces_180', t.veces_180, 'ultima', t.ultima,
             'ultima_cantidad', t.cantidad, 'ultima_tipo_empaque_id', t.tipo_empaque_id, 'ultima_unidades', t.unidades))
           order by t.rn), '[]'::jsonb)
    into v_frecuentes
    from top t where t.rn <= v_lim;

  select jsonb_build_object(
           'id', o.id, 'numero', o.numero, 'numero_guds', o.numero_guds, 'fecha', coalesce(o.fecha_pedido, o.created_at),
           'total', o.total,
           'items', coalesce((select jsonb_agg(jsonb_build_object(
               'producto_id', oi.producto_id, 'tipo_empaque_id', oi.tipo_empaque_id, 'cantidad', oi.cantidad,
               'unidades', oi.cantidad * greatest(coalesce(oi.unidades_por_empaque, te.unidades, 1), 1),
               'nombre', coalesce(p.nombre, oi.nombre_producto),
               'a_la_venta', coalesce(p.activo and coalesce(p.vendible, true) and (p.empresa_id = v_emp or p.empresa_id is null), false))
               order by coalesce(p.nombre, oi.nombre_producto))
             from orden_items oi
             left join productos p on p.id = oi.producto_id
             left join tipos_empaque te on te.id = oi.tipo_empaque_id
            where oi.orden_id = o.id), '[]'::jsonb))
    into v_ultimo
    from ordenes o
   where o.cliente_id = p_cliente_id and o.estado::text <> 'cancelado' and coalesce(o.aprobacion, '') <> 'rechazada'
     and exists (select 1 from orden_items oi where oi.orden_id = o.id)
   order by coalesce(o.fecha_pedido, o.created_at) desc, o.id
   limit 1;

  return jsonb_build_object('frecuentes', v_frecuentes, 'ultimo_pedido', v_ultimo);
end $$;

-- 7. Pedido del vendedor idempotente ---------------------------------------------------------------------------------------
-- Misma lógica que la versión anterior (19p/20a: precio del cliente, IVA de cada producto, envío solo si lo indica, stock y
-- crédito) más p_clave: con la misma clave devuelve el pedido ya creado. Se reemplaza la firma (sin sobrecargas ambiguas).
drop function if exists public.crear_orden_vendedor(uuid, pago_metodo, text, jsonb, numeric);
create or replace function public.crear_orden_vendedor(
  p_cliente_id uuid, p_metodo_pago pago_metodo, p_notas text, p_items jsonb, p_envio numeric default null, p_clave uuid default null)
returns table(orden_id uuid, numero character varying, total numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario_id uuid; v_subtotal numeric := 0;
  v_iva_pct numeric; v_impuesto numeric; v_envio numeric; v_total numeric;
  v_orden_id uuid; v_numero varchar;
  v_prev ordenes%rowtype;
begin
  if not (public.es_vendedor_de(p_cliente_id) or public.is_admin()) then
    raise exception 'No autorizado: el cliente no está asignado a este vendedor';
  end if;

  select id into v_usuario_id from usuarios where auth_id = auth.uid();

  -- Idempotencia: la misma clave (mismo borrador) devuelve el pedido que ya se creó
  if p_clave is not null then
    perform pg_advisory_xact_lock(hashtextextended('orden_vendedor:' || p_clave::text, 0));
    select * into v_prev from ordenes o where o.clave_idempotencia = p_clave;
    if found then
      if v_prev.vendedor_id is distinct from v_usuario_id or v_prev.cliente_id is distinct from p_cliente_id then
        raise exception 'Clave de pedido ya usada por otro pedido' using errcode = 'P0001';
      end if;
      return query select v_prev.id, v_prev.numero, v_prev.total;
      return;
    end if;
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'La orden no tiene items'; end if;
  if coalesce(p_envio, 0) < 0 then raise exception 'El cargo de envío no puede ser negativo'; end if;
  perform public.validar_stock_pedido(p_items);

  select coalesce(sum((it->>'cantidad')::int
           * public.precio_efectivo((it->>'producto_id')::uuid, nullif(it->>'tipo_empaque_id','')::uuid, p_cliente_id)), 0)
    into v_subtotal from jsonb_array_elements(p_items) it;

  select coalesce(max(case when clave = 'iva_porcentaje' then valor::numeric end), 16) into v_iva_pct
  from configuracion where clave = 'iva_porcentaje';

  -- Sin envío automático en pedidos del vendedor: solo el cargo que él estipule
  v_envio := round(coalesce(p_envio, 0), 2);
  -- IVA de cada producto (Odoo), redondeado por línea; más el del envío
  v_impuesto := public.impuesto_de_items(p_items, p_cliente_id, 1)
    + public.impuesto_envio((select empresa_id from clientes where id = p_cliente_id), v_envio);
  v_total := v_subtotal + v_impuesto + v_envio;

  if p_metodo_pago = 'credito' then perform public.validar_credito(p_cliente_id, v_total); end if;

  v_numero := generar_numero_orden();
  insert into ordenes (numero, cliente_id, usuario_id, vendedor_id, subtotal, descuento, impuesto, envio, total, estado, metodo_pago, notas,
                       clave_idempotencia)
  values (v_numero, p_cliente_id, v_usuario_id, v_usuario_id, v_subtotal, 0, v_impuesto, v_envio, v_total, 'pendiente', p_metodo_pago,
          coalesce(p_notas,''), p_clave)
  returning id into v_orden_id;

  insert into orden_items (orden_id, producto_id, cantidad, precio_unitario, descuento, subtotal, tipo_empaque_id, unidades_por_empaque)
  select v_orden_id, (it->>'producto_id')::uuid, (it->>'cantidad')::int,
         public.precio_efectivo((it->>'producto_id')::uuid, nullif(it->>'tipo_empaque_id','')::uuid, p_cliente_id), 0,
         (it->>'cantidad')::int * public.precio_efectivo((it->>'producto_id')::uuid, nullif(it->>'tipo_empaque_id','')::uuid, p_cliente_id),
         nullif(it->>'tipo_empaque_id','')::uuid, public.unidades_empaque(nullif(it->>'tipo_empaque_id','')::uuid)
  from jsonb_array_elements(p_items) it;
  perform public.aplicar_impuestos_orden(v_orden_id);

  return query select v_orden_id, v_numero, v_total;
end $$;

-- 8. Permisos: las internas no se ejecutan por la API; las del vendedor solo con sesión --------------------------------------
revoke execute on function public.vendedor_cliente_empresa(uuid) from public, anon, authenticated;
revoke execute on function public.vendedor_producto_item(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.catalogo_vendedor(uuid, text, uuid, integer, integer, boolean, uuid[]) from public, anon;
revoke execute on function public.categorias_vendedor(uuid) from public, anon;
revoke execute on function public.compras_cliente_vendedor(uuid, integer) from public, anon;
revoke execute on function public.crear_orden_vendedor(uuid, pago_metodo, text, jsonb, numeric, uuid) from public, anon;
grant execute on function public.catalogo_vendedor(uuid, text, uuid, integer, integer, boolean, uuid[]) to authenticated;
grant execute on function public.categorias_vendedor(uuid) to authenticated;
grant execute on function public.compras_cliente_vendedor(uuid, integer) to authenticated;
grant execute on function public.crear_orden_vendedor(uuid, pago_metodo, text, jsonb, numeric, uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
