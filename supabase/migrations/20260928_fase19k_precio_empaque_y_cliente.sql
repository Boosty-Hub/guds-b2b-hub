-- ════════════════════════════════════════════════════════════════════════
-- Fase 19k · Precio de empaques y escrituras directas de clientes (hallazgos de la investigación del portal cliente)
--   1. precio_efectivo: un empaque sin precio propio cobraba precio_base (que, como en Odoo, es por UNIDAD): una "Caja x12"
--      se vendía al precio de 1 unidad y a Odoo llegaba precio/12. Ahora, sin precio de empaque ni precio de lista, el
--      empaque vale precio_base (u oferta) × unidades del empaque. Afectaba a 3 productos activos.
--   2. Los clientes podían insertar directamente por REST en ordenes y pagos (p. ej. un pago ya "verificado" o un pedido
--      con el total que quisieran). Todos los flujos usan funciones del servidor (crear_orden_desde_carrito,
--      registrar_pago), así que se quitan esas políticas de inserción directa.
-- ════════════════════════════════════════════════════════════════════════
begin;

drop policy if exists "Clientes pueden crear órdenes" on public.ordenes;
drop policy if exists "Clientes pueden registrar pagos" on public.pagos;

create or replace function public.precio_efectivo(p_producto_id uuid, p_tipo_empaque_id uuid default null, p_cliente_id uuid default null)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare
  v_precio numeric;
  v_lista uuid;
  v_unidades numeric := 1;
begin
  -- 1) Precio negociado de la lista del cliente
  if p_cliente_id is not null then
    select lista_precios_id into v_lista from clientes where id = p_cliente_id;
    if v_lista is not null then
      select precio into v_precio from precios_lista where producto_id = p_producto_id and lista_precios_id = v_lista;
      if v_precio is not null then return v_precio; end if;
    end if;
  end if;

  -- 2) Precio explícito del empaque
  if p_tipo_empaque_id is not null then
    select precio_empaque into v_precio from producto_empaques
    where producto_id = p_producto_id and tipo_empaque_id = p_tipo_empaque_id and precio_empaque is not null;
    if v_precio is not null then return v_precio; end if;
    select greatest(coalesce(te.unidades, 1), 1) into v_unidades from tipos_empaque te where te.id = p_tipo_empaque_id;
  end if;

  -- 3) Oferta / 4) Precio base: son por unidad (como en Odoo); un empaque sin precio propio vale unidades × precio
  select case when en_oferta and precio_oferta is not null then precio_oferta else precio_base end
    into v_precio
  from productos where id = p_producto_id;

  return round(v_precio * coalesce(v_unidades, 1), 4);
end $$;

commit;
