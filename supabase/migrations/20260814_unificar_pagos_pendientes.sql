-- Unifica el flujo de pagos pendientes (checkout / portal cliente / vendedor → cola admin).
-- 1) verificar_pago: al APROBAR aplica el monto a la deuda real (monto_pagado/estado_pago)
--    adjudicando FIFO igual que registrar_cobro (+ movimiento bancario), no solo el boolean pagado.
-- 2) crear_orden_desde_carrito: crea un pago 'pendiente' cuando hay comprobante (entra a la cola).
-- 3) trg_pago_insert: la notificación al admin apunta a /admin/cuentas-por-cobrar.

-- ── 1. verificar_pago (aprobar/rechazar + adjudicar) ─────────────────────────
drop function if exists public.verificar_pago(uuid, boolean, text);

create or replace function public.verificar_pago(
  p_pago_id uuid,
  p_aprobar boolean,
  p_notas   text default null,
  p_banco_id uuid default null,
  p_tasa    numeric default null
) returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_admin uuid;
  p pagos%rowtype;
  v_banco uuid;
  v_rest numeric;
  v_apl numeric;
  v_saldo numeric;
  v_monto_moneda numeric;
  r record;
begin
  if not public.is_admin() then raise exception 'Solo un administrador puede verificar pagos'; end if;
  select id into v_admin from usuarios where auth_id = auth.uid();

  select * into p from pagos where id = p_pago_id;
  if not found then raise exception 'Pago no encontrado'; end if;
  if p.estado <> 'pendiente' then raise exception 'El pago ya fue procesado (%).', p.estado; end if;

  -- Rechazo: solo marca el estado
  if not p_aprobar then
    update pagos set estado = 'rechazado', verificado_por = v_admin, fecha_verificacion = now(),
      notas = coalesce(p_notas, notas)
    where id = p_pago_id;
    return;
  end if;

  -- Aprobación
  v_banco := coalesce(p_banco_id, p.banco_id);
  update pagos set estado = 'verificado', verificado_por = v_admin, fecha_verificacion = now(),
    notas = coalesce(p_notas, notas), banco_id = v_banco, tasa_cambio = coalesce(p_tasa, tasa_cambio)
  where id = p_pago_id;

  -- Movimiento bancario (si hay banco): monto en la moneda del banco
  if v_banco is not null then
    v_monto_moneda := coalesce(p.monto_moneda, p.monto);
    insert into movimientos_bancarios (banco_id, tipo, monto, referencia, descripcion, pago_id)
    values (v_banco, 'entrada', v_monto_moneda, p.referencia, 'Cobro verificado', p_pago_id);
  end if;

  -- Adjudicar el monto (USD) a la deuda: primero la orden ligada, luego FIFO
  v_rest := p.monto;

  if p.orden_id is not null then
    select (total - coalesce(monto_pagado,0)) into v_saldo from ordenes where id = p.orden_id;
    if coalesce(v_saldo,0) > 0.009 then
      v_apl := least(v_rest, v_saldo);
      update ordenes set monto_pagado = coalesce(monto_pagado,0) + v_apl,
        estado_pago = case when (total - (coalesce(monto_pagado,0) + v_apl)) <= 0.009 then 'pagado' else 'parcial' end,
        pagado = ((total - (coalesce(monto_pagado,0) + v_apl)) <= 0.009)
      where id = p.orden_id;
      insert into pago_ordenes (pago_id, orden_id, monto_aplicado) values (p_pago_id, p.orden_id, v_apl);
      v_rest := v_rest - v_apl;
    end if;
  end if;

  for r in
    select t.tipo, t.id, t.saldo from (
      select 'orden'::text as tipo, id, (total - coalesce(monto_pagado,0)) as saldo, coalesce(fecha_pedido, created_at) as fecha
        from ordenes
        where cliente_id = p.cliente_id and estado <> 'cancelado'
          and (total - coalesce(monto_pagado,0)) > 0.009
          and (p.orden_id is null or id <> p.orden_id)
      union all
      select 'cuenta'::text as tipo, id, (monto - coalesce(monto_pagado,0)) as saldo, (fecha::timestamptz) as fecha
        from cuentas_cobrar
        where cliente_id = p.cliente_id and coalesce(estado_pago,'pendiente') <> 'anulada'
          and (monto - coalesce(monto_pagado,0)) > 0.009
    ) t order by t.fecha asc nulls last
  loop
    exit when v_rest <= 0.009;
    v_apl := least(v_rest, r.saldo);
    if r.tipo = 'orden' then
      insert into pago_ordenes (pago_id, orden_id, monto_aplicado) values (p_pago_id, r.id, v_apl);
      update ordenes set monto_pagado = coalesce(monto_pagado,0) + v_apl,
        estado_pago = case when (r.saldo - v_apl) <= 0.009 then 'pagado' else 'parcial' end,
        pagado = ((r.saldo - v_apl) <= 0.009)
      where id = r.id;
    else
      insert into pago_cuentas (pago_id, cuenta_id, monto_aplicado) values (p_pago_id, r.id, v_apl);
      update cuentas_cobrar set monto_pagado = coalesce(monto_pagado,0) + v_apl,
        estado_pago = case when (r.saldo - v_apl) <= 0.009 then 'pagado' else 'parcial' end, updated_at = now()
      where id = r.id;
    end if;
    v_rest := v_rest - v_apl;
  end loop;

  perform recalcular_credito(p.cliente_id);
end;
$function$;

grant execute on function public.verificar_pago(uuid, boolean, text, uuid, numeric) to authenticated;

-- ── 2. crear_orden_desde_carrito: crear pago 'pendiente' si hay comprobante ──
create or replace function public.crear_orden_desde_carrito(
  p_metodo_pago pago_metodo, p_notas text default '', p_cupon_id uuid default null,
  p_comprobante_url text default null, p_referencia text default null
) returns table(orden_id uuid, numero character varying, total numeric)
language plpgsql security definer set search_path to 'public'
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
    into v_subtotal from carrito c where c.usuario_id = v_usuario_id;

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

  if p_metodo_pago = 'credito' then
    select limite_credito, credito_utilizado into v_limite, v_utilizado from clientes where id = v_cliente_id;
    if coalesce(v_utilizado,0) + v_total > coalesce(v_limite,0) then
      raise exception 'Crédito insuficiente: disponible %, requerido %',
        coalesce(v_limite,0) - coalesce(v_utilizado,0), v_total; end if;
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

  if p_cupon_id is not null then
    update cupones set usos_actuales = usos_actuales + 1 where id = p_cupon_id;
  end if;

  -- Pago 'pendiente' cuando el checkout llevó comprobante: entra a la cola de verificación admin.
  if p_comprobante_url is not null then
    insert into pagos (cliente_id, orden_id, monto, monto_moneda, moneda, metodo, referencia, comprobante_url, estado)
    values (v_cliente_id, v_orden_id, v_total, v_total, 'USD', p_metodo_pago, p_referencia, p_comprobante_url, 'pendiente');
  end if;

  delete from carrito where usuario_id = v_usuario_id;
  return query select v_orden_id, v_numero, v_total;
end;
$function$;

-- ── 3. Notificación al admin apunta a la cola de cobranzas ───────────────────
create or replace function public.trg_pago_insert() returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
declare v_cli text;
begin
  select nombre_negocio into v_cli from clientes where id=NEW.cliente_id;
  if NEW.estado::text='pendiente' then
    perform notif_admins('Pago por verificar', coalesce(v_cli,'Cliente')||' reportó '||fmt_usd(NEW.monto), 'alerta', '/admin/cuentas-por-cobrar');
  elsif NEW.estado::text='verificado' then
    perform notif_cliente(NEW.cliente_id, 'Pago verificado', 'Tu pago '||coalesce(NEW.numero,'')||' de '||fmt_usd(NEW.monto)||' fue verificado.', 'exito', '/portal/pagos');
    perform notif_vendedor(NEW.cliente_id, 'Pago verificado', coalesce(v_cli,'Cliente')||': '||fmt_usd(NEW.monto), 'exito', '/vendedor/pagos');
  end if;
  return NEW;
end; $function$;
