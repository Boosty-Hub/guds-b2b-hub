-- ════════════════════════════════════════════════════════════════════════
-- Fase 20u (29-sep) · Órdenes borradas en Odoo
--   Odoo permite borrar cotizaciones en borrador o canceladas; la sincronización no lo reflejaba y en GUDS seguían
--   "pendientes" (S00921 y S00922, detectadas en el cuadre del 29-sep). Ahora el importador las marca canceladas con
--   estado_odoo = 'eliminada' (no se borran en GUDS: trazabilidad). Este cambio del disparador de eventos registra
--   "Eliminada en Odoo" en la línea de tiempo y no avisa por las cotizaciones nacidas en Odoo que el cliente nunca vio.
-- ════════════════════════════════════════════════════════════════════════
begin;

create or replace function public.trg_orden_eventos()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_odoo boolean := public.cambio_desde_odoo();
  v_reciente boolean := coalesce(new.fecha_pedido, new.created_at, now()) >= now() - interval '60 days';
  v_link_c text := '/portal/pedidos?pedido=' || new.id;
  v_link_v text := '/vendedor/pedidos?pedido=' || new.id;
  v_cli text;
begin
  if tg_op = 'INSERT' then
    perform public.registrar_evento_orden(new.id, 'creado', case when new.odoo_id is not null then 'Pedido de Odoo' else null end,
      coalesce(new.fecha_pedido, new.created_at, now()));
    return new;
  end if;
  if new.aprobacion is distinct from old.aprobacion and new.aprobacion = 'aprobada' then
    perform public.registrar_evento_orden(new.id, 'aprobado', null, coalesce(new.aprobado_at, now()));
  elsif new.aprobacion is distinct from old.aprobacion and new.aprobacion = 'rechazada' then
    perform public.registrar_evento_orden(new.id, 'rechazado', new.rechazo_motivo);
  end if;
  if coalesce(new.ediciones, 0) > coalesce(old.ediciones, 0) then
    perform public.registrar_evento_orden(new.id, 'editado', null);
  end if;
  if old.odoo_id is null and new.odoo_id is not null then
    perform public.registrar_evento_orden(new.id, 'enviado_odoo', 'Registrado en Odoo como ' || new.numero, coalesce(new.odoo_enviado_at, now()));
  end if;
  if coalesce(new.pagado, false) and not coalesce(old.pagado, false) then
    perform public.registrar_evento_orden(new.id, 'pagado', null);
  end if;

  select nombre_negocio into v_cli from clientes where id = new.cliente_id;
  -- Confirmación en Odoo
  if new.estado_odoo is distinct from old.estado_odoo and new.estado_odoo in ('sale', 'done') and coalesce(old.estado_odoo, '') not in ('sale', 'done') then
    perform public.registrar_evento_orden(new.id, 'confirmado', null);
    if v_odoo and v_reciente then
      perform notif_cliente(new.cliente_id, 'Pedido confirmado', 'Tu pedido ' || new.numero || ' fue confirmado y pasa a preparación.', 'orden', v_link_c);
      perform notif_vendedor(new.cliente_id, 'Pedido confirmado', coalesce(v_cli, 'Cliente') || ': ' || new.numero || ' confirmado en Odoo.', 'orden', v_link_v);
    end if;
  end if;
  -- Despacho (validado en Odoo, parcial o completo)
  if new.estado is distinct from old.estado and new.estado::text in ('enviado', 'completado') and v_odoo then
    perform public.registrar_evento_orden(new.id, 'despachado', case when new.estado::text = 'enviado' then 'Despacho parcial' else 'Despacho completo validado en Odoo' end);
    if v_reciente then
      perform notif_cliente(new.cliente_id, 'Pedido despachado', 'Tu pedido ' || new.numero || case when new.estado::text = 'enviado' then ' salió parcialmente del almacén.' else ' salió del almacén.' end, 'orden', v_link_c);
      perform notif_vendedor(new.cliente_id, 'Pedido despachado', coalesce(v_cli, 'Cliente') || ': ' || new.numero || ' despachado.', 'orden', v_link_v);
    end if;
  end if;
  -- Cancelación (el rechazo en GUDS ya se registró y avisó aparte)
  if new.estado is distinct from old.estado and new.estado::text = 'cancelado' and coalesce(new.aprobacion, '') <> 'rechazada' then
    perform public.registrar_evento_orden(new.id, 'cancelado', case when new.estado_odoo = 'eliminada' then 'Eliminada en Odoo' else null end);
    -- Una cotización nacida en Odoo y borrada allí en borrador no se avisa: el cliente nunca la vio (20u)
    if v_odoo and v_reciente and not (new.estado_odoo = 'eliminada' and new.numero_guds is null) then
      perform notif_cliente(new.cliente_id, 'Pedido cancelado', 'Tu pedido ' || new.numero || ' fue cancelado. Si tienes dudas, escríbele a tu ejecutivo.', 'alerta', v_link_c);
      perform notif_vendedor(new.cliente_id, 'Pedido cancelado', coalesce(v_cli, 'Cliente') || ': ' || new.numero || ' cancelado en Odoo.', 'alerta', v_link_v);
    end if;
  end if;
  return new;
end $$;

commit;
