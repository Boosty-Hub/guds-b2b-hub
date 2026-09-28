-- ════════════════════════════════════════════════════════════════════════
-- Fase 20c · Ajustes de la etapa 2 (flancos del agente de pantallas)
--   1. declarar_venta_consignacion aplicaba el IVA general (16 %) a todo: una venta en consignación de productos exentos de
--      Quirutec se facturaba con 16 %. Ahora usa el IVA de cada producto, por grupo de tasa.
--   2. cotizar_pedido valida los cupones como el checkout (vigencia, usos, cliente, primera compra, mínimo; tope si existe)
--      y, con p_orden_id, cotiza la edición de un pedido con las mismas reglas que editar_pedido_pendiente (cupón del pedido
--      aunque hoy esté inactivo, o el descuento fijo de pedidos viejos sin cupón registrado).
-- ════════════════════════════════════════════════════════════════════════
begin;

create or replace function public.declarar_venta_consignacion(p_almacen_id uuid, p_items jsonb, p_notas text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_usuario public.usuarios%rowtype;
  v_almacen public.almacenes%rowtype;
  v_declaracion_id uuid;
  v_numero text;
  v_subtotal numeric := 0;
  v_iva_pct numeric;
  v_impuesto numeric;
  v_total numeric;
  v_cliente_nombre text;
  r record;
begin
  select * into v_usuario from public.usuarios where auth_id = auth.uid();
  if not found then
    raise exception 'Usuario no encontrado';
  end if;

  select * into v_almacen from public.almacenes where id = p_almacen_id;
  if not found then
    raise exception 'Almacén % no existe', p_almacen_id;
  end if;
  if v_almacen.tipo <> 'consignacion' or not coalesce(v_almacen.activo, true) then
    raise exception 'El almacén % no es de consignación o está inactivo', v_almacen.nombre;
  end if;

  -- Autorización
  if public.is_admin() then
    null; -- admin puede declarar sobre cualquier almacén de consignación
  elsif v_usuario.role::text = 'cliente' then
    if v_almacen.cliente_id is null or not (v_almacen.cliente_id = any (public.clientes_del_usuario())) then
      raise exception 'No tenés acceso a este almacén';
    end if;
  elsif v_usuario.role::text = 'vendedor' then
    if v_almacen.cliente_id is null or v_almacen.cliente_id not in (select public.mis_clientes_vendedor()) then
      raise exception 'No tenés acceso a este almacén';
    end if;
  else
    raise exception 'No autorizado';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Agregá al menos un producto vendido';
  end if;


  v_numero := public.siguiente_numero(public.empresa_activa_requerida(), 'DC', 6);

  insert into public.declaraciones_consignacion (
    numero, almacen_id, cliente_id, declarado_por, rol_declarante, notas
  ) values (
    v_numero, p_almacen_id, v_almacen.cliente_id, v_usuario.id,
    case when public.is_admin() then 'admin' else v_usuario.role::text end,
    p_notas
  ) returning id into v_declaracion_id;

  for r in
    select (x->>'producto_id')::uuid as producto_id, (x->>'cantidad')::numeric as cantidad
    from jsonb_array_elements(p_items) x
  loop
    declare
      v_disponible numeric;
      v_precio numeric;
      v_nombre text;
      v_sku text;
      v_sub numeric;
    begin
      if r.cantidad is null or r.cantidad <= 0 then
        raise exception 'Cantidad inválida para un producto declarado';
      end if;

      select ia.cantidad into v_disponible
      from public.inventario_almacen ia
      where ia.almacen_id = p_almacen_id and ia.producto_id = r.producto_id;

      select p.nombre, p.sku into v_nombre, v_sku from public.productos p where p.id = r.producto_id;

      if v_disponible is null or r.cantidad > v_disponible then
        raise exception 'Stock insuficiente de %: disponible %', coalesce(v_nombre, 'producto'), coalesce(v_disponible, 0);
      end if;

      v_precio := public.precio_efectivo(r.producto_id, null, v_almacen.cliente_id);
      v_sub := round(r.cantidad * v_precio, 2);
      v_subtotal := v_subtotal + v_sub;

      insert into public.declaracion_consignacion_items (
        declaracion_id, producto_id, nombre_producto, sku_producto, cantidad, precio_unitario, subtotal
      ) values (
        v_declaracion_id, r.producto_id, v_nombre, v_sku, r.cantidad, v_precio, v_sub
      );
    end;
  end loop;

  -- IVA de cada producto (Odoo), por grupo de tasa como Odoo (fase 20c)
  select coalesce(sum(round(g.base * g.pct / 100.0, 2)), 0) into v_impuesto
  from (select public.impuesto_producto(i.producto_id) pct, sum(i.subtotal) base
        from public.declaracion_consignacion_items i where i.declaracion_id = v_declaracion_id group by 1) g;
  v_total := v_subtotal + v_impuesto;

  update public.declaraciones_consignacion
  set subtotal = v_subtotal, impuesto = v_impuesto, total = v_total
  where id = v_declaracion_id;

  select nombre_negocio into v_cliente_nombre from public.clientes where id = v_almacen.cliente_id;
  perform public.notif_admins(
    'Declaración de consignación por revisar',
    coalesce(v_cliente_nombre, 'Cliente') || ' declaró ventas por ' || public.fmt_usd(v_total),
    'alerta', '/admin/consignacion'
  );

  return v_declaracion_id;
end;
$$
;

drop function if exists public.cotizar_pedido(uuid, jsonb, uuid, numeric);
create or replace function public.cotizar_pedido(p_cliente_id uuid, p_items jsonb, p_cupon_id uuid default null, p_envio numeric default null,
  p_orden_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_empresa uuid; v_subtotal numeric; v_descuento numeric := 0; v_base numeric; v_envio numeric; v_imp numeric; v_factor numeric;
  v_costo_envio numeric; v_envio_gratis_min numeric; c cupones%rowtype; o ordenes%rowtype; v_lineas jsonb; v_aviso text;
begin
  if not (public.es_personal_admin() or public.es_vendedor_de(p_cliente_id) or p_cliente_id = any (public.clientes_del_usuario())) then
    raise exception 'No puedes cotizar para este cliente' using errcode = '42501';
  end if;
  if p_orden_id is not null then
    select * into o from ordenes where id = p_orden_id;
    if not found or o.cliente_id is distinct from p_cliente_id then raise exception 'Pedido no encontrado' using errcode = 'P0001'; end if;
  end if;
  select empresa_id into v_empresa from clientes where id = p_cliente_id;
  with l as (
    select (it->>'producto_id')::uuid producto_id, nullif(it->>'tipo_empaque_id','')::uuid tipo_empaque_id, (it->>'cantidad')::int cantidad,
           public.precio_efectivo((it->>'producto_id')::uuid, nullif(it->>'tipo_empaque_id','')::uuid, p_cliente_id) precio,
           public.impuesto_producto((it->>'producto_id')::uuid) pct
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) it where coalesce((it->>'cantidad')::int, 0) > 0
  )
  select coalesce(sum(cantidad * precio), 0),
         coalesce(jsonb_agg(jsonb_build_object('producto_id', producto_id, 'tipo_empaque_id', tipo_empaque_id, 'cantidad', cantidad,
           'precio_unitario', round(precio, 4), 'subtotal', round(cantidad * precio, 2), 'impuesto_pct', pct)), '[]'::jsonb)
    into v_subtotal, v_lineas from l;

  if p_orden_id is not null then
    -- Edición: mismas reglas que editar_pedido_pendiente
    if o.cupon_id is not null then
      select * into c from cupones where id = o.cupon_id;
      if not found or v_subtotal < coalesce(c.minimo_compra, 0) then
        v_descuento := 0;
        if found then v_aviso := 'El cupón del pedido requiere una compra mínima de ' || c.minimo_compra; end if;
      else
        v_descuento := case when c.tipo = 'porcentaje' then round(v_subtotal * c.valor / 100.0, 2) else c.valor end;
        if c.maximo_descuento is not null then v_descuento := least(v_descuento, c.maximo_descuento); end if;
      end if;
    else
      v_descuento := coalesce(o.descuento, 0);
    end if;
  elsif p_cupon_id is not null then
    -- Checkout: mismas validaciones que crear_orden_desde_carrito (aquí no se rechaza: se avisa y no se descuenta)
    select * into c from cupones where id = p_cupon_id;
    if not found or not c.activo or (c.fecha_inicio is not null and c.fecha_inicio > current_date) or (c.fecha_fin is not null and c.fecha_fin < current_date)
       or (c.cliente_especifico_id is not null and c.cliente_especifico_id <> p_cliente_id) then
      v_aviso := 'Cupón inválido o vencido';
    elsif c.usos_maximos is not null and c.usos_actuales >= c.usos_maximos then
      v_aviso := 'El cupón alcanzó su límite de usos';
    elsif v_subtotal < coalesce(c.minimo_compra, 0) then
      v_aviso := 'El cupón requiere una compra mínima de ' || c.minimo_compra;
    elsif c.solo_primera_compra and exists (select 1 from ordenes x where x.cliente_id = p_cliente_id and x.estado <> 'cancelado') then
      v_aviso := 'El cupón es válido solo para la primera compra';
    else
      v_descuento := case when c.tipo = 'porcentaje' then round(v_subtotal * c.valor / 100.0, 2) else c.valor end;
      if c.maximo_descuento is not null then v_descuento := least(v_descuento, c.maximo_descuento); end if;
    end if;
  end if;
  v_descuento := least(greatest(v_descuento, 0), v_subtotal);
  v_base := v_subtotal - v_descuento;
  select coalesce(max(case when clave='costo_envio' then valor::numeric end),50), coalesce(max(case when clave='envio_gratis_minimo' then valor::numeric end),500)
    into v_costo_envio, v_envio_gratis_min from configuracion where clave in ('costo_envio','envio_gratis_minimo');
  v_envio := case when p_envio is not null then round(greatest(p_envio, 0), 2)
                  when p_orden_id is not null and o.vendedor_id is not null then round(coalesce(o.envio, 0), 2)
                  when v_base <= 0 then 0 when v_base >= v_envio_gratis_min then 0 else v_costo_envio end;
  v_factor := case when v_subtotal > 0 then v_base / v_subtotal else 1 end;
  v_imp := public.impuesto_de_items(p_items, p_cliente_id, v_factor) + public.impuesto_envio(v_empresa, v_envio);
  return jsonb_build_object('lineas', v_lineas, 'subtotal', round(v_subtotal, 2), 'descuento', round(v_descuento, 2),
    'impuesto', round(v_imp, 2), 'envio', v_envio, 'total', round(v_base + v_imp + v_envio, 2),
    'envio_gratis_desde', v_envio_gratis_min, 'aviso', v_aviso);
end $$;
revoke execute on function public.cotizar_pedido(uuid, jsonb, uuid, numeric, uuid) from public, anon;
grant execute on function public.cotizar_pedido(uuid, jsonb, uuid, numeric, uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
