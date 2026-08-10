-- Pendientes de lanzamiento — Fase 7 (comprobante de pago antes de confirmar la compra)
-- Item 13: pagos.comprobante_url ya existía en la DB, pero la UI de subida en
-- PortalPagos.tsx era un <div> decorativo sin input real, y ninguna de las
-- dos RPCs de pago (crear_orden_desde_carrito, registrar_pago) aceptaba el
-- dato. Mismo patrón que fase6b_entrega_evidencia.sql para firma_url/foto_url.
begin;

alter table public.ordenes
  add column if not exists comprobante_url text,
  add column if not exists referencia_pago text;

-- El bucket privado `documentos` (creado en fase2 para el RIF, solo con
-- insert de anon bajo registros/) ahora también recibe comprobantes de pago
-- de clientes ya autenticados, bajo su propio prefijo.
create policy "authenticated_upload_comprobante"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'documentos' and (storage.foldername(name))[1] = 'comprobantes');

-- Checkout: cuando el método de pago requiere prueba (transferencia, pago
-- móvil), el comprobante y la referencia se capturan ANTES de confirmar el
-- pedido y quedan en la propia orden.
create or replace function public.crear_orden_desde_carrito(
  p_metodo_pago pago_metodo,
  p_notas text default '',
  p_cupon_id uuid default null,
  p_comprobante_url text default null,
  p_referencia text default null
)
returns table(orden_id uuid, numero character varying, total numeric)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_usuario_id uuid; v_cliente_id uuid;
  v_subtotal numeric := 0; v_descuento numeric := 0;
  v_iva_pct numeric; v_costo_envio numeric; v_envio_gratis_min numeric;
  v_base numeric; v_impuesto numeric; v_envio numeric; v_total numeric;
  v_orden_id uuid; v_numero varchar; v_cupon record; v_items integer;
  v_limite numeric; v_utilizado numeric;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select id, cliente_id into v_usuario_id, v_cliente_id from usuarios where auth_id = v_uid;
  if v_usuario_id is null then raise exception 'Usuario no encontrado'; end if;
  if v_cliente_id is null then raise exception 'El usuario no tiene un cliente asociado'; end if;

  select count(*) into v_items from carrito where usuario_id = v_usuario_id;
  if v_items = 0 then raise exception 'El carrito esta vacio'; end if;

  select coalesce(sum(public.precio_efectivo(c.producto_id, c.tipo_empaque_id, v_cliente_id) * c.cantidad), 0)
    into v_subtotal
  from carrito c where c.usuario_id = v_usuario_id;

  -- Cupón: validación completa
  if p_cupon_id is not null then
    select * into v_cupon from cupones
    where id = p_cupon_id and activo = true
      and (fecha_inicio is null or fecha_inicio <= current_date)
      and (fecha_fin is null or fecha_fin >= current_date)
      and (cliente_especifico_id is null or cliente_especifico_id = v_cliente_id);
    if not found then raise exception 'Cupón inválido o vencido'; end if;
    if v_cupon.usos_maximos is not null and v_cupon.usos_actuales >= v_cupon.usos_maximos then
      raise exception 'El cupón alcanzó su límite de usos';
    end if;
    if v_subtotal < coalesce(v_cupon.minimo_compra, 0) then
      raise exception 'El cupón requiere una compra mínima de %', v_cupon.minimo_compra;
    end if;
    if v_cupon.solo_primera_compra and exists (
      select 1 from ordenes where cliente_id = v_cliente_id and estado <> 'cancelado'
    ) then
      raise exception 'El cupón es válido solo para la primera compra';
    end if;
    v_descuento := case when v_cupon.tipo = 'porcentaje'
      then round(v_subtotal * (v_cupon.valor / 100.0), 2) else v_cupon.valor end;
    if v_cupon.maximo_descuento is not null then
      v_descuento := least(v_descuento, v_cupon.maximo_descuento);
    end if;
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

  if p_metodo_pago = 'credito' then
    select limite_credito, credito_utilizado into v_limite, v_utilizado from clientes where id = v_cliente_id;
    if coalesce(v_utilizado,0) + v_total > coalesce(v_limite,0) then
      raise exception 'Crédito insuficiente: disponible %, requerido %',
        coalesce(v_limite,0) - coalesce(v_utilizado,0), v_total;
    end if;
  end if;

  v_numero := generar_numero_orden();

  insert into ordenes (numero, cliente_id, usuario_id, subtotal, descuento, impuesto, envio, total, estado, metodo_pago, notas, comprobante_url, referencia_pago)
  values (v_numero, v_cliente_id, v_usuario_id, v_subtotal, v_descuento, v_impuesto, v_envio, v_total, 'pendiente', p_metodo_pago, coalesce(p_notas,''), p_comprobante_url, p_referencia)
  returning id into v_orden_id;

  insert into orden_items (orden_id, producto_id, cantidad, precio_unitario, descuento, subtotal)
  select v_orden_id, c.producto_id, c.cantidad,
         public.precio_efectivo(c.producto_id, c.tipo_empaque_id, v_cliente_id), 0,
         public.precio_efectivo(c.producto_id, c.tipo_empaque_id, v_cliente_id) * c.cantidad
  from carrito c where c.usuario_id = v_usuario_id;

  -- Registrar el uso del cupón
  if p_cupon_id is not null then
    update cupones set usos_actuales = usos_actuales + 1 where id = p_cupon_id;
  end if;

  delete from carrito where usuario_id = v_usuario_id;
  return query select v_orden_id, v_numero, v_total;
end;
$function$;

-- Registro de pago posterior (PortalPagos, Cuentas, VendedorPagos): ahora
-- también acepta el comprobante y lo persiste en pagos.comprobante_url
-- (columna que ya existía pero el insert nunca la llenaba).
create or replace function public.registrar_pago(
  p_cliente_id uuid,
  p_orden_id uuid,
  p_banco_id uuid,
  p_metodo pago_metodo,
  p_monto_moneda numeric,
  p_moneda text default 'USD',
  p_tasa_cambio numeric default null,
  p_referencia text default null,
  p_comprobante_url text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_es_admin boolean := public.is_admin();
  v_autorizado boolean;
  v_monto_usd numeric;
  v_id uuid;
begin
  v_autorizado := v_es_admin
    or public.es_vendedor_de(p_cliente_id)
    or exists (select 1 from usuarios where auth_id = auth.uid() and cliente_id = p_cliente_id);
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

commit;
