-- ════════════════════════════════════════════════════════════════════════
-- Fase 18n · Portal del cliente: usuarios de un cliente presente en ambas empresas (mismo RIF) y contactos
--   Las políticas del portal pasan de "el cliente de mi usuario" a clientes_del_usuario() (mis fichas en cada empresa;
--   la política restrictiva de empresa deja ver solo la de la empresa activa). Un usuario desactivado pierde el acceso.
--   registrar_pago y declarar_venta_consignacion aceptan cualquiera de las fichas del usuario.
-- ════════════════════════════════════════════════════════════════════════
begin;

drop policy if exists "almacenes_cliente_read" on public.almacenes;
create policy "almacenes_cliente_read" on public.almacenes for select to authenticated
  using (cliente_id is not null and cliente_id in (select unnest(public.clientes_del_usuario())));
drop policy if exists "cliente_direcciones_leer" on public.cliente_direcciones;
create policy "cliente_direcciones_leer" on public.cliente_direcciones for select to authenticated
  using (public.puede('clientes', 'ver') or cliente_id in (select unnest(public.clientes_del_usuario())) or public.es_vendedor_de(cliente_id));
drop policy if exists "Clientes ven su propia info" on public.clientes;
create policy "Clientes ven su propia info" on public.clientes for select to public
  using (id in (select unnest(public.clientes_del_usuario())));
drop policy if exists "declaracion_consignacion_items_cliente_read" on public.declaracion_consignacion_items;
create policy "declaracion_consignacion_items_cliente_read" on public.declaracion_consignacion_items for select to authenticated
  using (declaracion_id in (select d.id from declaraciones_consignacion d where d.cliente_id in (select unnest(public.clientes_del_usuario()))));
drop policy if exists "declaraciones_consignacion_cliente_read" on public.declaraciones_consignacion;
create policy "declaraciones_consignacion_cliente_read" on public.declaraciones_consignacion for select to authenticated
  using (cliente_id in (select unnest(public.clientes_del_usuario())));
drop policy if exists "factura_items_cliente_read" on public.factura_items;
create policy "factura_items_cliente_read" on public.factura_items for select to authenticated
  using (factura_id in (select f.id from facturas f where f.cliente_id in (select unnest(public.clientes_del_usuario()))));
drop policy if exists "facturas_cliente_read" on public.facturas;
create policy "facturas_cliente_read" on public.facturas for select to authenticated
  using (cliente_id in (select unnest(public.clientes_del_usuario())));
drop policy if exists "inventario_almacen_cliente_read" on public.inventario_almacen;
create policy "inventario_almacen_cliente_read" on public.inventario_almacen for select to authenticated
  using (almacen_id in (select a.id from almacenes a where a.cliente_id in (select unnest(public.clientes_del_usuario()))));
drop policy if exists "Clientes ven items de sus órdenes" on public.orden_items;
create policy "Clientes ven items de sus órdenes" on public.orden_items for select to authenticated
  using (orden_id in (select o.id from ordenes o where o.cliente_id in (select unnest(public.clientes_del_usuario()))));
drop policy if exists "orden_items_cliente_read" on public.orden_items;
create policy "orden_items_cliente_read" on public.orden_items for select to authenticated
  using (orden_id in (select o.id from ordenes o where o.cliente_id in (select unnest(public.clientes_del_usuario()))));
drop policy if exists "Clientes pueden crear órdenes" on public.ordenes;
create policy "Clientes pueden crear órdenes" on public.ordenes for insert to authenticated
  with check (cliente_id in (select unnest(public.clientes_del_usuario())));
drop policy if exists "Clientes ven sus órdenes" on public.ordenes;
create policy "Clientes ven sus órdenes" on public.ordenes for select to public
  using (cliente_id in (select unnest(public.clientes_del_usuario())));
drop policy if exists "ordenes_cliente_read" on public.ordenes;
create policy "ordenes_cliente_read" on public.ordenes for select to authenticated
  using (cliente_id in (select unnest(public.clientes_del_usuario())));
drop policy if exists "pago_facturas_cliente_read" on public.pago_facturas;
create policy "pago_facturas_cliente_read" on public.pago_facturas for select to authenticated
  using (factura_id in (select f.id from facturas f where f.cliente_id in (select unnest(public.clientes_del_usuario()))));
drop policy if exists "Clientes pueden registrar pagos" on public.pagos;
create policy "Clientes pueden registrar pagos" on public.pagos for insert to authenticated
  with check (cliente_id in (select unnest(public.clientes_del_usuario())));
drop policy if exists "Clientes ven sus pagos" on public.pagos;
create policy "Clientes ven sus pagos" on public.pagos for select to authenticated
  using (cliente_id in (select unnest(public.clientes_del_usuario())));
drop policy if exists "retencion_items_cliente_read" on public.retencion_items;
create policy "retencion_items_cliente_read" on public.retencion_items for select to authenticated
  using (retencion_id in (select r.id from retenciones r where r.cliente_id in (select unnest(public.clientes_del_usuario()))));
drop policy if exists "retenciones_cliente_read" on public.retenciones;
create policy "retenciones_cliente_read" on public.retenciones for select to authenticated
  using (cliente_id in (select unnest(public.clientes_del_usuario())));

CREATE OR REPLACE FUNCTION public.registrar_pago(p_cliente_id uuid, p_orden_id uuid, p_banco_id uuid, p_metodo pago_metodo, p_monto_moneda numeric, p_moneda text DEFAULT 'USD'::text, p_tasa_cambio numeric DEFAULT NULL::numeric, p_referencia text DEFAULT NULL::text, p_comprobante_url text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_es_admin boolean := public.is_admin();
  v_autorizado boolean;
  v_monto_usd numeric;
  v_id uuid;
begin
  v_autorizado := v_es_admin
    or public.es_vendedor_de(p_cliente_id)
    or p_cliente_id = any (public.clientes_del_usuario());
  if not v_autorizado then raise exception 'No autorizado para registrar este pago'; end if;
  if p_monto_moneda is null or p_monto_moneda <= 0 then raise exception 'Monto inválido'; end if;

  if p_moneda = 'BS' then
    if coalesce(p_tasa_cambio, 0) <= 0 then raise exception 'Falta la tasa de cambio para un pago en bolívares'; end if;
    v_monto_usd := round(p_monto_moneda / p_tasa_cambio, 2);
  else
    v_monto_usd := p_monto_moneda;
  end if;

  insert into pagos (cliente_id, orden_id, banco_id, metodo, monto, monto_moneda, moneda, tasa_cambio, referencia, comprobante_url, estado, verificado_por, fecha_verificacion)
  values (
    p_cliente_id, p_orden_id, p_banco_id, p_metodo, v_monto_usd, p_monto_moneda,
    coalesce(p_moneda,'USD'), case when p_moneda = 'BS' then p_tasa_cambio else null end, p_referencia, p_comprobante_url,
    (case when v_es_admin then 'verificado' else 'pendiente' end)::pago_estado,
    case when v_es_admin then (select id from usuarios where auth_id = auth.uid()) else null end,
    case when v_es_admin then now() else null end
  ) returning id into v_id;

  if v_es_admin then
    perform public.liquidar_orden(p_orden_id);
  end if;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.declarar_venta_consignacion(p_almacen_id uuid, p_items jsonb, p_notas text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  select coalesce(max(valor::numeric), 16) into v_iva_pct from public.configuracion where clave = 'iva_porcentaje';

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
$function$;

commit;
