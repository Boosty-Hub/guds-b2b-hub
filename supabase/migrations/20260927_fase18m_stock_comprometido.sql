-- ════════════════════════════════════════════════════════════════════════
-- Fase 18m · Stock comprometido y pedidos (docs/PLAN-ESPEJO-ODOO.md, Fase 8)
--   Como en Odoo: lo que está en un pedido queda en espera y no se puede volver a vender; al entregarse en Odoo baja la
--   existencia y se libera lo comprometido.
--     disponible = existencia en almacenes propios (Odoo) − comprometido en Odoo (entregas y traslados a consignación
--                  pendientes, calculado por el importador) − comprometido en GUDS (pedidos de GUDS aún sin pasar a Odoo)
--   orden_items guarda el empaque y sus unidades (antes solo la cantidad de empaques).
--   Los pedidos (tienda, vendedor, admin): validan existencias (productos con control de stock) y crédito
--   (configuracion.credito_modo); la tienda usa la ficha del cliente de la empresa activa (clientes en ambas empresas).
--   El trigger viejo que descontaba stock_actual (espejo de Odoo) queda solo para productos propios de GUDS.
-- ════════════════════════════════════════════════════════════════════════
begin;

alter table public.productos
  add column if not exists controla_stock boolean not null default true,
  add column if not exists comprometido_odoo numeric not null default 0,
  add column if not exists comprometido_guds numeric not null default 0;
alter table public.productos add column if not exists stock_disponible numeric
  generated always as (greatest(coalesce(stock_actual, 0) - comprometido_odoo - comprometido_guds, 0)) stored;

alter table public.orden_items
  add column if not exists tipo_empaque_id uuid references public.tipos_empaque(id) on delete set null,
  add column if not exists unidades_por_empaque integer not null default 1;

create or replace function public.unidades_empaque(p_tipo_empaque_id uuid)
returns integer language sql stable set search_path = public as $$
  select greatest(coalesce((select unidades from tipos_empaque where id = p_tipo_empaque_id), 1), 1)
$$;

-- Comprometido por pedidos de GUDS que todavía no están en Odoo (al pasar a Odoo, lo compromete su entrega)
create or replace function public.recalcular_comprometido_guds(p_productos uuid[])
returns void language sql security definer set search_path = public as $$
  update productos p set comprometido_guds = s.u
  from (select x.pid, coalesce((select sum(oi.cantidad * oi.unidades_por_empaque) from orden_items oi join ordenes o on o.id = oi.orden_id
                                where oi.producto_id = x.pid and o.odoo_id is null and o.estado <> 'cancelado'), 0) u
        from unnest(p_productos) as x(pid)) s
  where p.id = s.pid and p.comprometido_guds is distinct from s.u
$$;

create or replace function public.trg_item_comprometido()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.recalcular_comprometido_guds(array_remove(array[
    case when tg_op <> 'INSERT' then old.producto_id end,
    case when tg_op <> 'DELETE' then new.producto_id end], null));
  return null;
end $$;
drop trigger if exists y_item_comprometido on public.orden_items;
create trigger y_item_comprometido after insert or update of cantidad, producto_id, unidades_por_empaque or delete on public.orden_items
  for each row execute function public.trg_item_comprometido();

create or replace function public.trg_orden_comprometido()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.recalcular_comprometido_guds(array(select distinct producto_id from orden_items
    where orden_id = case when tg_op = 'DELETE' then old.id else new.id end and producto_id is not null));
  return null;
end $$;
drop trigger if exists y_orden_comprometido on public.ordenes;
create trigger y_orden_comprometido after update of estado, odoo_id on public.ordenes
  for each row execute function public.trg_orden_comprometido();

-- Valida existencias de un pedido: items [{producto_id, cantidad, tipo_empaque_id}] (cantidad en empaques)
create or replace function public.validar_stock_pedido(p_items jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select p.id, p.nombre, p.stock_disponible, sum((it->>'cantidad')::numeric * public.unidades_empaque(nullif(it->>'tipo_empaque_id', '')::uuid)) pedido
    from jsonb_array_elements(p_items) it join productos p on p.id = (it->>'producto_id')::uuid
    where p.controla_stock
    group by p.id, p.nombre, p.stock_disponible
  loop
    if r.pedido > r.stock_disponible then
      raise exception 'Stock insuficiente de %: disponible % unidades, pedido %', r.nombre, trunc(r.stock_disponible), trunc(r.pedido)
        using errcode = 'P0001';
    end if;
  end loop;
end $$;
grant execute on function public.validar_stock_pedido(jsonb) to authenticated;

-- El trigger viejo solo mueve stock de productos propios de GUDS (el de Odoo lo manda Odoo)
create or replace function public.actualizar_stock_orden()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.odoo_id is not null then return new; end if;
  if new.estado is not distinct from old.estado then return new; end if;
  if not old.stock_descontado and new.estado in ('procesando', 'enviado', 'completado') then
    update productos p set stock_actual = p.stock_actual - oi.cantidad * oi.unidades_por_empaque
    from orden_items oi where oi.orden_id = new.id and p.id = oi.producto_id and p.odoo_id is null;
    insert into movimientos_inventario (producto_id, tipo, cantidad, stock_anterior, stock_nuevo, motivo, referencia_id, referencia_tipo)
    select oi.producto_id, 'salida', oi.cantidad * oi.unidades_por_empaque, p.stock_actual + oi.cantidad * oi.unidades_por_empaque, p.stock_actual,
      'Venta - Orden ' || new.numero, new.id, 'orden'
    from orden_items oi join productos p on p.id = oi.producto_id where oi.orden_id = new.id and p.odoo_id is null;
    new.stock_descontado := true;
  elsif old.stock_descontado and new.estado = 'cancelado' then
    update productos p set stock_actual = p.stock_actual + oi.cantidad * oi.unidades_por_empaque
    from orden_items oi where oi.orden_id = new.id and p.id = oi.producto_id and p.odoo_id is null;
    insert into movimientos_inventario (producto_id, tipo, cantidad, stock_anterior, stock_nuevo, motivo, referencia_id, referencia_tipo)
    select oi.producto_id, 'entrada', oi.cantidad * oi.unidades_por_empaque, p.stock_actual - oi.cantidad * oi.unidades_por_empaque, p.stock_actual,
      'Reposicion por cancelacion - Orden ' || new.numero, new.id, 'orden'
    from orden_items oi join productos p on p.id = oi.producto_id where oi.orden_id = new.id and p.odoo_id is null;
    new.stock_descontado := false;
  end if;
  return new;
end $$;

-- ── Pedido desde el carrito (tienda del cliente) ─────────────────────────
create or replace function public.crear_orden_desde_carrito(p_metodo_pago pago_metodo, p_notas text default ''::text, p_cupon_id uuid default null::uuid,
  p_comprobante_url text default null::text, p_referencia text default null::text, p_banco_id uuid default null::uuid,
  p_moneda text default 'USD'::text, p_tasa numeric default null::numeric)
returns table(orden_id uuid, numero character varying, total numeric)
language plpgsql security definer set search_path = public as $function$
declare
  v_uid uuid := auth.uid();
  v_usuario_id uuid; v_cliente_id uuid; v_empresa uuid;
  v_subtotal numeric := 0; v_descuento numeric := 0;
  v_iva_pct numeric; v_costo_envio numeric; v_envio_gratis_min numeric;
  v_base numeric; v_impuesto numeric; v_envio numeric; v_total numeric;
  v_orden_id uuid; v_numero varchar; v_cupon record; v_items integer; v_json jsonb;
  v_moneda text := upper(coalesce(p_moneda, 'USD'));
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select id into v_usuario_id from usuarios where auth_id = v_uid;
  if v_usuario_id is null then raise exception 'Usuario no encontrado'; end if;
  v_empresa := public.empresa_activa_requerida();
  -- Ficha del cliente en la empresa activa (un cliente presente en ambas empresas tiene una ficha por empresa)
  v_cliente_id := public.mi_cliente_id();
  if v_cliente_id is null then raise exception 'El usuario no tiene un cliente asociado'; end if;
  if not exists (select 1 from clientes where id = v_cliente_id and (empresa_id is null or empresa_id = v_empresa)) then
    raise exception 'Tu cuenta no está habilitada para comprar en esta empresa' using errcode = 'P0001';
  end if;

  select count(*) into v_items from carrito where usuario_id = v_usuario_id and empresa_id = v_empresa;
  if v_items = 0 then raise exception 'El carrito esta vacio'; end if;

  select jsonb_agg(jsonb_build_object('producto_id', c.producto_id, 'cantidad', c.cantidad, 'tipo_empaque_id', c.tipo_empaque_id))
    into v_json from carrito c where c.usuario_id = v_usuario_id and c.empresa_id = v_empresa;
  perform public.validar_stock_pedido(v_json);

  select coalesce(sum(public.precio_efectivo(c.producto_id, c.tipo_empaque_id, v_cliente_id) * c.cantidad), 0)
    into v_subtotal from carrito c where c.usuario_id = v_usuario_id and c.empresa_id = v_empresa;

  if p_cupon_id is not null then
    select * into v_cupon from cupones
    where id = p_cupon_id and activo = true
      and (fecha_inicio is null or fecha_inicio <= current_date)
      and (fecha_fin is null or fecha_fin >= current_date)
      and (cliente_especifico_id is null or cliente_especifico_id = v_cliente_id);
    if not found then raise exception 'Cupón inválido o vencido'; end if;
    if v_cupon.usos_maximos is not null and v_cupon.usos_actuales >= v_cupon.usos_maximos then
      raise exception 'El cupón alcanzó su límite de usos'; end if;
    if v_subtotal < coalesce(v_cupon.minimo_compra, 0) then
      raise exception 'El cupón requiere una compra mínima de %', v_cupon.minimo_compra; end if;
    if v_cupon.solo_primera_compra and exists (
      select 1 from ordenes where cliente_id = v_cliente_id and estado <> 'cancelado') then
      raise exception 'El cupón es válido solo para la primera compra'; end if;
    v_descuento := case when v_cupon.tipo = 'porcentaje'
      then round(v_subtotal * (v_cupon.valor / 100.0), 2) else v_cupon.valor end;
    if v_cupon.maximo_descuento is not null then v_descuento := least(v_descuento, v_cupon.maximo_descuento); end if;
    v_descuento := least(v_descuento, v_subtotal);
  end if;

  select coalesce(max(case when clave='iva_porcentaje' then valor::numeric end),16),
         coalesce(max(case when clave='costo_envio' then valor::numeric end),50),
         coalesce(max(case when clave='envio_gratis_minimo' then valor::numeric end),500)
    into v_iva_pct, v_costo_envio, v_envio_gratis_min
  from configuracion where clave in ('iva_porcentaje','costo_envio','envio_gratis_minimo');

  v_base := v_subtotal - v_descuento;
  v_impuesto := round(v_base * (v_iva_pct/100.0), 2);
  v_envio := case when v_base >= v_envio_gratis_min then 0 else v_costo_envio end;
  v_total := v_base + v_impuesto + v_envio;

  if p_metodo_pago = 'credito' then perform public.validar_credito(v_cliente_id, v_total); end if;

  v_numero := generar_numero_orden();

  insert into ordenes (numero, cliente_id, usuario_id, subtotal, descuento, impuesto, envio, total, estado, metodo_pago, notas, comprobante_url, referencia_pago)
  values (v_numero, v_cliente_id, v_usuario_id, v_subtotal, v_descuento, v_impuesto, v_envio, v_total, 'pendiente', p_metodo_pago, coalesce(p_notas,''), p_comprobante_url, p_referencia)
  returning id into v_orden_id;

  insert into orden_items (orden_id, producto_id, cantidad, precio_unitario, descuento, subtotal, tipo_empaque_id, unidades_por_empaque)
  select v_orden_id, c.producto_id, c.cantidad,
         public.precio_efectivo(c.producto_id, c.tipo_empaque_id, v_cliente_id), 0,
         public.precio_efectivo(c.producto_id, c.tipo_empaque_id, v_cliente_id) * c.cantidad,
         c.tipo_empaque_id, public.unidades_empaque(c.tipo_empaque_id)
  from carrito c where c.usuario_id = v_usuario_id and c.empresa_id = v_empresa;

  if p_cupon_id is not null then
    update cupones set usos_actuales = usos_actuales + 1 where id = p_cupon_id;
  end if;

  if p_comprobante_url is not null then
    insert into pagos (cliente_id, orden_id, monto, monto_moneda, moneda, tasa_cambio, banco_id, metodo, referencia, comprobante_url, estado)
    values (
      v_cliente_id, v_orden_id, v_total,
      case when v_moneda = 'BS' and coalesce(p_tasa,0) > 0 then round(v_total * p_tasa, 2) else v_total end,
      v_moneda, case when v_moneda = 'BS' then p_tasa else null end,
      p_banco_id, p_metodo_pago, p_referencia, p_comprobante_url, 'pendiente'
    );
  end if;

  delete from carrito where usuario_id = v_usuario_id and empresa_id = v_empresa;
  return query select v_orden_id, v_numero, v_total;
end;
$function$;

-- ── Pedido del vendedor ──────────────────────────────────────────────────
create or replace function public.crear_orden_vendedor(p_cliente_id uuid, p_metodo_pago pago_metodo, p_notas text, p_items jsonb)
returns table(orden_id uuid, numero character varying, total numeric)
language plpgsql security definer set search_path = public as $function$
declare
  v_usuario_id uuid; v_subtotal numeric := 0;
  v_iva_pct numeric; v_costo_envio numeric; v_envio_gratis_min numeric;
  v_impuesto numeric; v_envio numeric; v_total numeric;
  v_orden_id uuid; v_numero varchar;
begin
  if not (public.es_vendedor_de(p_cliente_id) or public.is_admin()) then
    raise exception 'No autorizado: el cliente no está asignado a este vendedor';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'La orden no tiene items'; end if;
  perform public.validar_stock_pedido(p_items);

  select id into v_usuario_id from usuarios where auth_id = auth.uid();

  select coalesce(sum((it->>'cantidad')::int
           * public.precio_efectivo((it->>'producto_id')::uuid, nullif(it->>'tipo_empaque_id','')::uuid, p_cliente_id)), 0)
    into v_subtotal from jsonb_array_elements(p_items) it;

  select coalesce(max(case when clave='iva_porcentaje' then valor::numeric end),16),
         coalesce(max(case when clave='costo_envio' then valor::numeric end),50),
         coalesce(max(case when clave='envio_gratis_minimo' then valor::numeric end),500)
    into v_iva_pct, v_costo_envio, v_envio_gratis_min
  from configuracion where clave in ('iva_porcentaje','costo_envio','envio_gratis_minimo');

  v_impuesto := round(v_subtotal * (v_iva_pct/100.0), 2);
  v_envio := case when v_subtotal >= v_envio_gratis_min then 0 else v_costo_envio end;
  v_total := v_subtotal + v_impuesto + v_envio;

  if p_metodo_pago = 'credito' then perform public.validar_credito(p_cliente_id, v_total); end if;

  v_numero := generar_numero_orden();
  insert into ordenes (numero, cliente_id, usuario_id, vendedor_id, subtotal, descuento, impuesto, envio, total, estado, metodo_pago, notas)
  values (v_numero, p_cliente_id, v_usuario_id, v_usuario_id, v_subtotal, 0, v_impuesto, v_envio, v_total, 'pendiente', p_metodo_pago, coalesce(p_notas,''))
  returning id into v_orden_id;

  insert into orden_items (orden_id, producto_id, cantidad, precio_unitario, descuento, subtotal, tipo_empaque_id, unidades_por_empaque)
  select v_orden_id, (it->>'producto_id')::uuid, (it->>'cantidad')::int,
         public.precio_efectivo((it->>'producto_id')::uuid, nullif(it->>'tipo_empaque_id','')::uuid, p_cliente_id), 0,
         (it->>'cantidad')::int * public.precio_efectivo((it->>'producto_id')::uuid, nullif(it->>'tipo_empaque_id','')::uuid, p_cliente_id),
         nullif(it->>'tipo_empaque_id','')::uuid, public.unidades_empaque(nullif(it->>'tipo_empaque_id','')::uuid)
  from jsonb_array_elements(p_items) it;

  return query select v_orden_id, v_numero, v_total;
end;
$function$;

-- ── Pedido desde administración ──────────────────────────────────────────
create or replace function public.crear_orden_admin(p_cliente_id uuid, p_metodo_pago pago_metodo, p_notas text, p_items jsonb)
returns table(orden_id uuid, numero character varying, total numeric)
language plpgsql security definer set search_path = public as $function$
declare
  v_usuario_id uuid; v_subtotal numeric := 0;
  v_iva_pct numeric; v_costo_envio numeric; v_envio_gratis_min numeric;
  v_impuesto numeric; v_envio numeric; v_total numeric;
  v_orden_id uuid; v_numero varchar;
begin
  if not public.is_admin() then raise exception 'Solo un administrador puede crear ordenes aqui'; end if;
  if p_cliente_id is null then raise exception 'Falta el cliente'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'La orden no tiene items'; end if;
  perform public.validar_stock_pedido(p_items);

  select id into v_usuario_id from usuarios where auth_id = auth.uid();

  select coalesce(sum((it->>'cantidad')::int * public.precio_efectivo((it->>'producto_id')::uuid, nullif(it->>'tipo_empaque_id','')::uuid, p_cliente_id)), 0)
    into v_subtotal from jsonb_array_elements(p_items) it;

  select coalesce(max(case when clave='iva_porcentaje' then valor::numeric end),16),
         coalesce(max(case when clave='costo_envio' then valor::numeric end),50),
         coalesce(max(case when clave='envio_gratis_minimo' then valor::numeric end),500)
    into v_iva_pct, v_costo_envio, v_envio_gratis_min
  from configuracion where clave in ('iva_porcentaje','costo_envio','envio_gratis_minimo');

  v_impuesto := round(v_subtotal * (v_iva_pct/100.0), 2);
  v_envio := case when v_subtotal >= v_envio_gratis_min then 0 else v_costo_envio end;
  v_total := v_subtotal + v_impuesto + v_envio;

  if p_metodo_pago = 'credito' then perform public.validar_credito(p_cliente_id, v_total); end if;

  v_numero := generar_numero_orden();
  insert into ordenes (numero, cliente_id, usuario_id, subtotal, descuento, impuesto, envio, total, estado, metodo_pago, notas)
  values (v_numero, p_cliente_id, v_usuario_id, v_subtotal, 0, v_impuesto, v_envio, v_total, 'pendiente', p_metodo_pago, coalesce(p_notas,''))
  returning id into v_orden_id;

  insert into orden_items (orden_id, producto_id, cantidad, precio_unitario, descuento, subtotal, tipo_empaque_id, unidades_por_empaque)
  select v_orden_id, (it->>'producto_id')::uuid, (it->>'cantidad')::int,
         public.precio_efectivo((it->>'producto_id')::uuid, nullif(it->>'tipo_empaque_id','')::uuid, p_cliente_id), 0,
         (it->>'cantidad')::int * public.precio_efectivo((it->>'producto_id')::uuid, nullif(it->>'tipo_empaque_id','')::uuid, p_cliente_id),
         nullif(it->>'tipo_empaque_id','')::uuid, public.unidades_empaque(nullif(it->>'tipo_empaque_id','')::uuid)
  from jsonb_array_elements(p_items) it;

  return query select v_orden_id, v_numero, v_total;
end;
$function$;

-- Datos de Odoo que no se editan en GUDS
drop trigger if exists c_proteger_espejo_odoo on public.productos;
create trigger c_proteger_espejo_odoo before update or delete on public.productos for each row
  execute function public.trg_proteger_espejo_odoo('sku', 'nombre', 'categoria_id', 'unidad', 'empresa_id', 'tipo_odoo', 'vendible', 'controla_stock', 'comprometido_odoo');

-- Comprometido de los pedidos de GUDS que ya existen
select public.recalcular_comprometido_guds(array(select distinct oi.producto_id from orden_items oi join ordenes o on o.id = oi.orden_id
  where o.odoo_id is null and oi.producto_id is not null));

commit;
