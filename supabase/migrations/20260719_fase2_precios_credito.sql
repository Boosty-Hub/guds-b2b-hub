-- =====================================================================
-- GUDS · FASE 2 — Precios (P4 empaque + P7 listas) y crédito (P3)
-- Decisiones:
--   P4: precio_base es el precio del empaque mostrado (NO se multiplica por
--       unidades). Un empaque con precio_empaque explícito lo usa.
--   P7: cada cliente ve el precio de su lista asignada.
--   P3: el checkout a crédito se bloquea si excede el cupo; el crédito se
--       devenga al crear la orden y se libera al pagar o cancelar.
-- Precedencia de precio: lista_cliente > precio_empaque > oferta > precio_base
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1) Precio efectivo unitario para (producto, empaque, cliente).
-- ---------------------------------------------------------------------
create or replace function public.precio_efectivo(
  p_producto_id uuid,
  p_tipo_empaque_id uuid default null,
  p_cliente_id uuid default null
) returns numeric
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_precio numeric;
  v_lista uuid;
begin
  -- 1) Precio negociado de la lista del cliente
  if p_cliente_id is not null then
    select lista_precios_id into v_lista from clientes where id = p_cliente_id;
    if v_lista is not null then
      select precio into v_precio
      from precios_lista
      where producto_id = p_producto_id and lista_precios_id = v_lista;
      if v_precio is not null then return v_precio; end if;
    end if;
  end if;

  -- 2) Precio explícito del empaque
  if p_tipo_empaque_id is not null then
    select precio_empaque into v_precio
    from producto_empaques
    where producto_id = p_producto_id
      and tipo_empaque_id = p_tipo_empaque_id
      and precio_empaque is not null;
    if v_precio is not null then return v_precio; end if;
  end if;

  -- 3) Oferta  / 4) Precio base (P4: es el precio del empaque, sin ×unidades)
  select case when en_oferta and precio_oferta is not null then precio_oferta else precio_base end
    into v_precio
  from productos where id = p_producto_id;

  return v_precio;
end;
$fn$;
revoke all on function public.precio_efectivo(uuid, uuid, uuid) from public;
grant execute on function public.precio_efectivo(uuid, uuid, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2) Crédito: recálculo desde la verdad (sin flags que se desincronicen).
--    credito_utilizado = suma de órdenes a crédito vigentes y no pagadas.
-- ---------------------------------------------------------------------
create or replace function public.recalcular_credito(p_cliente_id uuid)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if p_cliente_id is null then return; end if;
  update clientes set credito_utilizado = coalesce((
    select sum(total) from ordenes
    where cliente_id = p_cliente_id
      and metodo_pago = 'credito'
      and estado <> 'cancelado'
      and pagado = false
  ), 0)
  where id = p_cliente_id;
end;
$fn$;

create or replace function public.trg_recalcular_credito()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  perform public.recalcular_credito(coalesce(new.cliente_id, old.cliente_id));
  return null;
end;
$fn$;
drop trigger if exists trg_ordenes_credito on public.ordenes;
create trigger trg_ordenes_credito
  after insert or update of estado, pagado, total, metodo_pago on public.ordenes
  for each row execute function public.trg_recalcular_credito();

-- ---------------------------------------------------------------------
-- 3) Checkout del cliente: recomputa precios (P4/P7) y valida crédito (P3).
-- ---------------------------------------------------------------------
create or replace function public.crear_orden_desde_carrito(
  p_metodo_pago pago_metodo,
  p_notas text default '',
  p_cupon_id uuid default null
) returns table(orden_id uuid, numero varchar, total numeric)
language plpgsql security definer set search_path = public
as $fn$
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

  -- Subtotal recomputado con precio efectivo (lista de cliente / empaque / oferta / base)
  select coalesce(sum(public.precio_efectivo(c.producto_id, c.tipo_empaque_id, v_cliente_id) * c.cantidad), 0)
    into v_subtotal
  from carrito c where c.usuario_id = v_usuario_id;

  if p_cupon_id is not null then
    select * into v_cupon from cupones
    where id = p_cupon_id and activo = true and (fecha_fin is null or fecha_fin >= current_date);
    if found then
      v_descuento := case when v_cupon.tipo = 'porcentaje'
        then round(v_subtotal * (v_cupon.valor / 100.0), 2)
        else least(v_cupon.valor, v_subtotal) end;
    end if;
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

  -- P3: validar cupo de crédito
  if p_metodo_pago = 'credito' then
    select limite_credito, credito_utilizado into v_limite, v_utilizado from clientes where id = v_cliente_id;
    if coalesce(v_utilizado,0) + v_total > coalesce(v_limite,0) then
      raise exception 'Crédito insuficiente: disponible %, requerido %',
        coalesce(v_limite,0) - coalesce(v_utilizado,0), v_total;
    end if;
  end if;

  v_numero := generar_numero_orden();

  insert into ordenes (numero, cliente_id, usuario_id, subtotal, descuento, impuesto, envio, total, estado, metodo_pago, notas)
  values (v_numero, v_cliente_id, v_usuario_id, v_subtotal, v_descuento, v_impuesto, v_envio, v_total, 'pendiente', p_metodo_pago, coalesce(p_notas,''))
  returning id into v_orden_id;

  insert into orden_items (orden_id, producto_id, cantidad, precio_unitario, descuento, subtotal)
  select v_orden_id, c.producto_id, c.cantidad,
         public.precio_efectivo(c.producto_id, c.tipo_empaque_id, v_cliente_id), 0,
         public.precio_efectivo(c.producto_id, c.tipo_empaque_id, v_cliente_id) * c.cantidad
  from carrito c where c.usuario_id = v_usuario_id;

  delete from carrito where usuario_id = v_usuario_id;
  return query select v_orden_id, v_numero, v_total;
end;
$fn$;
revoke all on function public.crear_orden_desde_carrito(pago_metodo, text, uuid) from public;
grant execute on function public.crear_orden_desde_carrito(pago_metodo, text, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4) Orden admin: recomputa por lista del cliente y valida crédito.
-- ---------------------------------------------------------------------
create or replace function public.crear_orden_admin(
  p_cliente_id uuid, p_metodo_pago pago_metodo, p_notas text, p_items jsonb
) returns table(orden_id uuid, numero varchar, total numeric)
language plpgsql security definer set search_path = public
as $fn$
declare
  v_usuario_id uuid; v_subtotal numeric := 0;
  v_iva_pct numeric; v_costo_envio numeric; v_envio_gratis_min numeric;
  v_impuesto numeric; v_envio numeric; v_total numeric;
  v_orden_id uuid; v_numero varchar; v_limite numeric; v_utilizado numeric;
begin
  if not public.is_admin() then raise exception 'Solo un administrador puede crear ordenes aqui'; end if;
  if p_cliente_id is null then raise exception 'Falta el cliente'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'La orden no tiene items'; end if;

  select id into v_usuario_id from usuarios where auth_id = auth.uid();

  -- precio efectivo por lista del cliente (ignora el precio pasado, para integridad)
  select coalesce(sum((it->>'cantidad')::int * public.precio_efectivo((it->>'producto_id')::uuid, null, p_cliente_id)),0)
    into v_subtotal
  from jsonb_array_elements(p_items) it;

  select coalesce(max(case when clave='iva_porcentaje' then valor::numeric end),16),
         coalesce(max(case when clave='costo_envio' then valor::numeric end),50),
         coalesce(max(case when clave='envio_gratis_minimo' then valor::numeric end),500)
    into v_iva_pct, v_costo_envio, v_envio_gratis_min
  from configuracion where clave in ('iva_porcentaje','costo_envio','envio_gratis_minimo');

  v_impuesto := round(v_subtotal * (v_iva_pct/100.0), 2);
  v_envio := case when v_subtotal >= v_envio_gratis_min then 0 else v_costo_envio end;
  v_total := v_subtotal + v_impuesto + v_envio;

  if p_metodo_pago = 'credito' then
    select limite_credito, credito_utilizado into v_limite, v_utilizado from clientes where id = p_cliente_id;
    if coalesce(v_utilizado,0) + v_total > coalesce(v_limite,0) then
      raise exception 'Crédito insuficiente: disponible %, requerido %',
        coalesce(v_limite,0) - coalesce(v_utilizado,0), v_total;
    end if;
  end if;

  v_numero := generar_numero_orden();
  insert into ordenes (numero, cliente_id, usuario_id, subtotal, descuento, impuesto, envio, total, estado, metodo_pago, notas)
  values (v_numero, p_cliente_id, v_usuario_id, v_subtotal, 0, v_impuesto, v_envio, v_total, 'pendiente', p_metodo_pago, coalesce(p_notas,''))
  returning id into v_orden_id;

  insert into orden_items (orden_id, producto_id, cantidad, precio_unitario, descuento, subtotal)
  select v_orden_id, (it->>'producto_id')::uuid, (it->>'cantidad')::int,
         public.precio_efectivo((it->>'producto_id')::uuid, null, p_cliente_id), 0,
         (it->>'cantidad')::int * public.precio_efectivo((it->>'producto_id')::uuid, null, p_cliente_id)
  from jsonb_array_elements(p_items) it;

  return query select v_orden_id, v_numero, v_total;
end;
$fn$;
revoke all on function public.crear_orden_admin(uuid, pago_metodo, text, jsonb) from public;
grant execute on function public.crear_orden_admin(uuid, pago_metodo, text, jsonb) to authenticated;

-- Alinear credito_utilizado con la realidad actual (por si hay datos previos)
update clientes c set credito_utilizado = coalesce((
  select sum(total) from ordenes o
  where o.cliente_id = c.id and o.metodo_pago='credito' and o.estado <> 'cancelado' and o.pagado = false), 0);

commit;
