-- ════════════════════════════════════════════════════════════════════════
-- Fase 20e · El aviso "Pedido facturado" abre el pedido en el portal (antes llevaba a Pagos) y la fecha del hito de
--   factura (un día, sin hora) se ubica al mediodía de Caracas: como medianoche UTC aparecía el día anterior a las 8 p. m.
-- ════════════════════════════════════════════════════════════════════════
begin;

create or replace function public.trg_factura_evento()
returns trigger language plpgsql security definer set search_path = public as $$
declare o ordenes%rowtype; v_cli text;
begin
  if new.orden_id is null or new.tipo <> 'factura' or new.estado <> 'posted' then return new; end if;
  if tg_op = 'UPDATE' and old.orden_id is not distinct from new.orden_id and old.estado is not distinct from new.estado then return new; end if;
  select * into o from ordenes where id = new.orden_id;
  if not found then return new; end if;
  perform public.registrar_evento_orden(o.id, 'facturado', 'Factura ' || new.numero,
    coalesce((new.fecha_emision + time '12:00') at time zone 'America/Caracas', now()));
  if public.cambio_desde_odoo() and coalesce(new.fecha_emision, current_date) >= current_date - 30 then
    select nombre_negocio into v_cli from clientes where id = o.cliente_id;
    perform notif_cliente(o.cliente_id, 'Pedido facturado', 'Se emitió la factura ' || new.numero || ' de tu pedido ' || o.numero || ' por ' || fmt_usd(coalesce(new.total_usd, new.total)) || '.', 'orden', '/portal/pedidos?pedido=' || o.id);
    perform notif_vendedor(o.cliente_id, 'Pedido facturado', coalesce(v_cli, 'Cliente') || ': factura ' || new.numero || ' del pedido ' || o.numero || '.', 'orden', '/vendedor/pedidos?pedido=' || o.id);
  end if;
  return new;
end $$;

update orden_eventos e set fecha = (f.fecha_emision + time '12:00') at time zone 'America/Caracas'
from facturas f where e.tipo = 'facturado' and e.detalle = 'Factura ' || f.numero and f.orden_id = e.orden_id and f.fecha_emision is not null
  and e.fecha is distinct from (f.fecha_emision + time '12:00') at time zone 'America/Caracas';

commit;
