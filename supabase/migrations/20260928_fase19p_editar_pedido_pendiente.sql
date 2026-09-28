-- ════════════════════════════════════════════════════════════════════════
-- Fase 19p · Pedidos pendientes editables y envío en pedidos del vendedor (decisiones 28-sep del plan de portales)
--   1. editar_pedido_pendiente(): mientras el pedido está por aprobar (y no llegó a Odoo) lo puede editar el cliente (sus
--      pedidos del portal), el vendedor del cliente o administración. Reemplaza las líneas, recalcula precios y totales en el
--      servidor y el stock comprometido (triggers de orden_items). Deja constancia (editado_at, editado_por, ediciones) y
--      avisa a administración (y al vendedor si editó el cliente).
--   2. crear_orden_vendedor: los pedidos del vendedor ya no llevan envío automático; solo el cargo que indique el vendedor
--      (p_envio), que viaja a Odoo como la línea de servicio de envío.
-- ════════════════════════════════════════════════════════════════════════
begin;

alter table public.ordenes
  add column if not exists editado_at timestamptz,
  add column if not exists editado_por uuid references public.usuarios(id),
  add column if not exists ediciones integer not null default 0;

drop function if exists public.crear_orden_vendedor(uuid, pago_metodo, text, jsonb);
create function public.crear_orden_vendedor(p_cliente_id uuid, p_metodo_pago pago_metodo, p_notas text, p_items jsonb, p_envio numeric default null)
returns table(orden_id uuid, numero character varying, total numeric)
language plpgsql security definer set search_path = public as $$
declare
  v_usuario_id uuid; v_subtotal numeric := 0;
  v_iva_pct numeric; v_impuesto numeric; v_envio numeric; v_total numeric;
  v_orden_id uuid; v_numero varchar;
begin
  if not (public.es_vendedor_de(p_cliente_id) or public.is_admin()) then
    raise exception 'No autorizado: el cliente no está asignado a este vendedor';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'La orden no tiene items'; end if;
  if coalesce(p_envio, 0) < 0 then raise exception 'El cargo de envío no puede ser negativo'; end if;
  perform public.validar_stock_pedido(p_items);

  select id into v_usuario_id from usuarios where auth_id = auth.uid();

  select coalesce(sum((it->>'cantidad')::int
           * public.precio_efectivo((it->>'producto_id')::uuid, nullif(it->>'tipo_empaque_id','')::uuid, p_cliente_id)), 0)
    into v_subtotal from jsonb_array_elements(p_items) it;

  select coalesce(max(case when clave = 'iva_porcentaje' then valor::numeric end), 16) into v_iva_pct
  from configuracion where clave = 'iva_porcentaje';

  v_impuesto := round(v_subtotal * (v_iva_pct / 100.0), 2);
  -- Sin envío automático en pedidos del vendedor: solo el cargo que él estipule
  v_envio := round(coalesce(p_envio, 0), 2);
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
end $$;
revoke execute on function public.crear_orden_vendedor(uuid, pago_metodo, text, jsonb, numeric) from public, anon;
grant execute on function public.crear_orden_vendedor(uuid, pago_metodo, text, jsonb, numeric) to authenticated;

create or replace function public.editar_pedido_pendiente(p_orden_id uuid, p_items jsonb, p_notas text default null, p_envio numeric default null)
returns table(orden_id uuid, numero character varying, total numeric)
language plpgsql security definer set search_path = public as $$
declare
  o ordenes%rowtype;
  v_usuario_id uuid; v_admin boolean; v_vendedor boolean; v_cliente boolean;
  v_subtotal numeric; v_descuento numeric; v_iva_pct numeric; v_costo_envio numeric; v_envio_gratis_min numeric;
  v_base numeric; v_impuesto numeric; v_envio numeric; v_total numeric; v_cli text;
begin
  select * into o from ordenes where id = p_orden_id for update;
  if not found then raise exception 'Pedido no encontrado' using errcode = 'P0001'; end if;

  v_admin := public.es_personal_admin() and public.puede('ordenes', 'editar');
  v_vendedor := public.es_vendedor_de(o.cliente_id);
  -- El cliente edita los pedidos que hizo en el portal (no los que le cargó su vendedor)
  v_cliente := o.cliente_id = any (public.clientes_del_usuario()) and o.vendedor_id is null;
  if not (v_admin or v_vendedor or v_cliente) then
    raise exception 'No puedes editar este pedido' using errcode = '42501';
  end if;
  if coalesce(o.aprobacion, '') <> 'pendiente' or o.estado <> 'pendiente' or o.odoo_id is not null then
    raise exception 'Solo se editan pedidos pendientes de aprobación' using errcode = 'P0001';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido debe tener al menos un producto (para anularlo, cancélalo)' using errcode = 'P0001';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) it where coalesce((it->>'cantidad')::numeric, 0) <= 0
             or (it->>'cantidad')::numeric <> trunc((it->>'cantidad')::numeric)) then
    raise exception 'Las cantidades deben ser números enteros mayores que cero' using errcode = 'P0001';
  end if;
  if not (v_admin or v_vendedor) and p_envio is not null then
    raise exception 'El cargo de envío lo define GUDS' using errcode = 'P0001';
  end if;
  if coalesce(p_envio, 0) < 0 then raise exception 'El cargo de envío no puede ser negativo'; end if;

  select id into v_usuario_id from usuarios where auth_id = auth.uid();

  -- Se liberan las líneas actuales (los triggers recalculan el comprometido) y se valida el stock con el pedido nuevo
  delete from orden_items where orden_items.orden_id = o.id;
  perform public.validar_stock_pedido(p_items);

  insert into orden_items (orden_id, producto_id, cantidad, precio_unitario, descuento, subtotal, tipo_empaque_id, unidades_por_empaque)
  select o.id, (it->>'producto_id')::uuid, (it->>'cantidad')::int,
         public.precio_efectivo((it->>'producto_id')::uuid, nullif(it->>'tipo_empaque_id','')::uuid, o.cliente_id), 0,
         (it->>'cantidad')::int * public.precio_efectivo((it->>'producto_id')::uuid, nullif(it->>'tipo_empaque_id','')::uuid, o.cliente_id),
         nullif(it->>'tipo_empaque_id','')::uuid, public.unidades_empaque(nullif(it->>'tipo_empaque_id','')::uuid)
  from jsonb_array_elements(p_items) it;

  select coalesce(sum(i.subtotal), 0) into v_subtotal from orden_items i where i.orden_id = o.id;
  select coalesce(max(case when clave='iva_porcentaje' then valor::numeric end),16),
         coalesce(max(case when clave='costo_envio' then valor::numeric end),50),
         coalesce(max(case when clave='envio_gratis_minimo' then valor::numeric end),500)
    into v_iva_pct, v_costo_envio, v_envio_gratis_min
  from configuracion where clave in ('iva_porcentaje','costo_envio','envio_gratis_minimo');

  -- Un descuento fijo (cupón) se conserva, sin superar el subtotal nuevo
  v_descuento := least(coalesce(o.descuento, 0), v_subtotal);
  v_base := v_subtotal - v_descuento;
  v_impuesto := round(v_base * (v_iva_pct / 100.0), 2);
  v_envio := case
    when o.vendedor_id is not null then round(coalesce(p_envio, o.envio, 0), 2)                      -- pedido del vendedor: cargo manual
    when p_envio is not null then round(p_envio, 2)                                                   -- administración lo ajusta
    else case when v_base >= v_envio_gratis_min then 0 else v_costo_envio end end;                    -- regla del portal
  v_total := v_base + v_impuesto + v_envio;

  if o.metodo_pago = 'credito' and v_total > coalesce(o.total, 0) then
    perform public.validar_credito(o.cliente_id, v_total - coalesce(o.total, 0));
  end if;

  update ordenes set subtotal = v_subtotal, descuento = v_descuento, impuesto = v_impuesto, envio = v_envio, total = v_total,
    notas = coalesce(p_notas, notas), editado_at = now(), editado_por = v_usuario_id, ediciones = coalesce(ediciones, 0) + 1
  where id = o.id;

  select nombre_negocio into v_cli from clientes where id = o.cliente_id;
  perform notif_admins('Pedido por aprobar ' || o.numero || ' editado',
    coalesce(v_cli, 'Cliente') || ' · ' || fmt_usd(v_total) || case when v_cliente and not (v_admin or v_vendedor) then ' · editado por el cliente' else '' end,
    'alerta', '/admin/ordenes?aprobacion=pendiente');
  if v_cliente and not (v_admin or v_vendedor) then
    perform notif_vendedor(o.cliente_id, 'Tu cliente editó un pedido', coalesce(v_cli, 'Cliente') || ': ' || o.numero || ' ahora por ' || fmt_usd(v_total), 'orden', '/vendedor/pedidos');
  end if;

  return query select o.id, o.numero, v_total;
end $$;
revoke execute on function public.editar_pedido_pendiente(uuid, jsonb, text, numeric) from public, anon;
grant execute on function public.editar_pedido_pendiente(uuid, jsonb, text, numeric) to authenticated;

notify pgrst, 'reload schema';

commit;
