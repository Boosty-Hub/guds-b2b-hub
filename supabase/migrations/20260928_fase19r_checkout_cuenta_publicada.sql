-- ════════════════════════════════════════════════════════════════════════
-- Fase 19r · Checkout: el pago adjunto al pedido solo a cuentas publicadas (flanco del agente del portal, 28-sep)
--   crear_orden_desde_carrito guardaba el pago adjunto con cualquier p_banco_id; registrar_pago ya lo validaba (19l).
--   Además se vacían los datos de empresa de ejemplo en configuracion (RIF J-12345678-9, teléfono y correo inventados);
--   los datos reales de cada empresa están en la tabla empresas.
-- ════════════════════════════════════════════════════════════════════════
begin;

create or replace function public.crear_orden_desde_carrito(p_metodo_pago pago_metodo, p_notas text DEFAULT ''::text, p_cupon_id uuid DEFAULT NULL::uuid, p_comprobante_url text DEFAULT NULL::text, p_referencia text DEFAULT NULL::text, p_banco_id uuid DEFAULT NULL::uuid, p_moneda text DEFAULT 'USD'::text, p_tasa numeric DEFAULT NULL::numeric)
 RETURNS TABLE(orden_id uuid, numero character varying, total numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
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
  -- Un pago adjunto solo se declara a una cuenta publicada para clientes (19l)
  if p_banco_id is not null and not exists (select 1 from bancos b where b.id = p_banco_id and b.activo and b.visible_portal) then
    raise exception 'La cuenta indicada no recibe pagos de clientes' using errcode = 'P0001';
  end if;

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
$$;

update configuracion set valor = '' where clave in ('empresa_rif', 'empresa_telefono', 'empresa_email')
  and valor in ('J-12345678-9', '+58 212-555-0000', 'info@guds.com');

notify pgrst, 'reload schema';

commit;
