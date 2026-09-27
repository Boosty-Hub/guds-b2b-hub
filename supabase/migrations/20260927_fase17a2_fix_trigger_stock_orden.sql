-- ════════════════════════════════════════════════════════════════════════
-- Fase 17a2 · Corrige actualizar_stock_orden
--
-- Bug: el trigger BEFORE UPDATE de ordenes reponía (o descontaba) stock en CUALQUIER update, aunque el
-- estado no cambiara. Al asignar empresa_id a las órdenes (backfill 17) repuso stock de 61 órdenes
-- canceladas importadas de Odoo (92 productos, 461 movimientos). Los datos se revirtieron desde el
-- respaldo del 2026-09-27 (ver docs/PLAN-ESPEJO-ODOO.md).
--
-- Ahora:
--   - Solo actúa cuando el estado cambia de verdad.
--   - Las órdenes que vienen de Odoo (odoo_id no nulo) nunca mueven el stock de GUDS: Odoo manda en el inventario.
-- ════════════════════════════════════════════════════════════════════════
begin;

create or replace function public.actualizar_stock_orden()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  -- Odoo manda en el inventario de sus órdenes
  if new.odoo_id is not null then
    return new;
  end if;

  -- Solo en cambios de estado (un update de otros campos no mueve stock)
  if new.estado is not distinct from old.estado then
    return new;
  end if;

  -- Descontar (idempotente): primera vez que la orden llega a un estado de preparacion/despacho
  if not old.stock_descontado
     and new.estado in ('procesando','enviado','completado') then

    update productos p
      set stock_actual = p.stock_actual - oi.cantidad
    from orden_items oi
    where oi.orden_id = new.id and p.id = oi.producto_id;

    insert into movimientos_inventario
      (producto_id, tipo, cantidad, stock_anterior, stock_nuevo, motivo, referencia_id, referencia_tipo)
    select oi.producto_id, 'salida', oi.cantidad,
           p.stock_actual + oi.cantidad, p.stock_actual,
           'Venta - Orden ' || new.numero, new.id, 'orden'
    from orden_items oi join productos p on p.id = oi.producto_id
    where oi.orden_id = new.id;

    new.stock_descontado := true;

  -- Reponer: la orden se cancela despues de haber descontado
  elsif old.stock_descontado
        and new.estado = 'cancelado' then

    update productos p
      set stock_actual = p.stock_actual + oi.cantidad
    from orden_items oi
    where oi.orden_id = new.id and p.id = oi.producto_id;

    insert into movimientos_inventario
      (producto_id, tipo, cantidad, stock_anterior, stock_nuevo, motivo, referencia_id, referencia_tipo)
    select oi.producto_id, 'entrada', oi.cantidad,
           p.stock_actual - oi.cantidad, p.stock_actual,
           'Reposicion por cancelacion - Orden ' || new.numero, new.id, 'orden'
    from orden_items oi join productos p on p.id = oi.producto_id
    where oi.orden_id = new.id;

    new.stock_descontado := false;
  end if;

  return new;
end;
$function$;

commit;
