begin;

-- Fase 12c: RPCs de declaración/aprobación de ventas en consignación.

create or replace function public.declarar_venta_consignacion(
  p_almacen_id uuid,
  p_items jsonb,
  p_notas text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
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
    if v_almacen.cliente_id is distinct from v_usuario.cliente_id then
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

  select coalesce(max(valor::numeric), 16) into v_iva_pct from public.configuracion where clave = 'iva_porcentaje';

  v_numero := 'DC-' || lpad(nextval('public.declaracion_consignacion_seq')::text, 6, '0');

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

  v_impuesto := round(v_subtotal * (v_iva_pct / 100.0), 2);
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
$$;

grant execute on function public.declarar_venta_consignacion(uuid, jsonb, text) to authenticated;

create or replace function public.revisar_declaracion_consignacion(
  p_declaracion_id uuid,
  p_aprobar boolean,
  p_notas text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_admin uuid;
  d public.declaraciones_consignacion%rowtype;
  v_dias_credito int;
  v_numero_factura text;
  v_factura_id uuid;
  r record;
  v_disponible numeric;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede revisar declaraciones';
  end if;
  select id into v_admin from public.usuarios where auth_id = auth.uid();

  select * into d from public.declaraciones_consignacion where id = p_declaracion_id;
  if not found then
    raise exception 'Declaración % no existe', p_declaracion_id;
  end if;
  if d.estado <> 'pendiente' then
    raise exception 'La declaración ya fue %', d.estado;
  end if;

  if not p_aprobar then
    update public.declaraciones_consignacion
    set estado = 'rechazado', revisado_por = v_admin, revisado_en = now(), notas = coalesce(p_notas, notas)
    where id = p_declaracion_id;
    return jsonb_build_object('estado', 'rechazado');
  end if;

  -- Re-valida stock (pudo cambiar desde que se declaró) y descuenta.
  for r in select * from public.declaracion_consignacion_items where declaracion_id = p_declaracion_id loop
    select ia.cantidad into v_disponible from public.inventario_almacen ia
    where ia.almacen_id = d.almacen_id and ia.producto_id = r.producto_id;
    if v_disponible is null or r.cantidad > v_disponible then
      raise exception 'Stock insuficiente de %: disponible % (cambió desde que se declaró)', coalesce(r.nombre_producto, 'producto'), coalesce(v_disponible, 0);
    end if;
  end loop;

  update public.inventario_almacen ia
  set cantidad = ia.cantidad - item.cantidad
  from public.declaracion_consignacion_items item
  where item.declaracion_id = p_declaracion_id
    and ia.almacen_id = d.almacen_id and ia.producto_id = item.producto_id;

  select coalesce(dias_credito, 0) into v_dias_credito from public.clientes where id = d.cliente_id;
  v_numero_factura := 'F-' || lpad(nextval('public.factura_interna_seq')::text, 6, '0');

  insert into public.facturas (
    numero, tipo, cliente_id, orden_id, fecha_emision, fecha_vencimiento,
    moneda, subtotal, impuesto, total, total_usd, saldo_odoo_usd,
    estado_pago, estado, referencia, creada_en_guds
  ) values (
    v_numero_factura, 'factura', d.cliente_id, null, current_date, current_date + v_dias_credito,
    'USD', d.subtotal, d.impuesto, d.total, d.total, d.total,
    'pendiente', 'posted', d.numero, true
  ) returning id into v_factura_id;

  insert into public.factura_items (factura_id, producto_id, nombre_producto, sku_producto, cantidad, precio_unitario, subtotal, total)
  select v_factura_id, producto_id, nombre_producto, sku_producto, cantidad, precio_unitario, subtotal, subtotal
  from public.declaracion_consignacion_items
  where declaracion_id = p_declaracion_id;

  update public.declaraciones_consignacion
  set estado = 'aprobado', factura_id = v_factura_id, revisado_por = v_admin, revisado_en = now(), notas = coalesce(p_notas, notas)
  where id = p_declaracion_id;

  perform public.notif_cliente(d.cliente_id, 'Declaración de consignación aprobada',
    'Se generó la factura ' || v_numero_factura || ' por ' || public.fmt_usd(d.total), 'exito', '/portal/consignacion');
  perform public.notif_vendedor(d.cliente_id, 'Declaración de consignación aprobada',
    'Factura ' || v_numero_factura || ' · ' || public.fmt_usd(d.total), 'exito', '/vendedor/consignacion');

  return jsonb_build_object('factura_id', v_factura_id, 'numero', v_numero_factura);
end;
$$;

grant execute on function public.revisar_declaracion_consignacion(uuid, boolean, text) to authenticated;

commit;
