-- ════════════════════════════════════════════════════════════════════════
-- Fase 20b · IVA redondeado por grupo de impuesto, como lo calcula Odoo en el total del pedido
--   Validado contra los pedidos reales de Odoo desde julio (en USD): redondeando línea por línea coincidían 419 de 441
--   (GUDS) con diferencias de centavos; sumando las bases de cada tasa y redondeando una vez coinciden 440 de 441 (GUDS) y
--   405 de 408 (Quirutec). El IVA de cada línea se sigue guardando (informativo) pero el del pedido es por grupo.
-- ════════════════════════════════════════════════════════════════════════
begin;

create or replace function public.impuesto_de_items(p_items jsonb, p_cliente_id uuid, p_factor numeric)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(round(g.base * g.pct / 100.0, 2)), 0)
  from (
    select public.impuesto_producto((it->>'producto_id')::uuid) pct,
           sum((it->>'cantidad')::int
             * public.precio_efectivo((it->>'producto_id')::uuid, nullif(it->>'tipo_empaque_id','')::uuid, p_cliente_id)
             * coalesce(p_factor, 1)) base
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) it
    group by 1
  ) g;
$$;
revoke execute on function public.impuesto_de_items(jsonb, uuid, numeric) from public, anon, authenticated;

create or replace function public.aplicar_impuestos_orden(p_orden_id uuid)
returns numeric language plpgsql security definer set search_path = public as $$
declare o ordenes%rowtype; v_factor numeric; v_imp numeric; v_total numeric;
begin
  select * into o from ordenes where id = p_orden_id for update;
  if not found or o.odoo_id is not null then return null; end if;   -- los pedidos de Odoo traen sus impuestos de Odoo
  v_factor := case when coalesce(o.subtotal, 0) > 0 then (o.subtotal - coalesce(o.descuento, 0)) / o.subtotal else 1 end;
  update orden_items i set impuesto_pct = public.impuesto_producto(i.producto_id),
    impuesto = round(i.subtotal * v_factor * public.impuesto_producto(i.producto_id) / 100.0, 2)
  where i.orden_id = o.id;
  -- Total del pedido: por grupo de tasa (suma de bases y un solo redondeo), más el IVA del envío
  select coalesce(sum(round(g.base * g.pct / 100.0, 2)), 0) + public.impuesto_envio(o.empresa_id, o.envio) into v_imp
  from (select impuesto_pct pct, sum(subtotal * v_factor) base from orden_items where orden_id = o.id group by 1) g;
  v_total := coalesce(o.subtotal, 0) - coalesce(o.descuento, 0) + v_imp + coalesce(o.envio, 0);
  if v_imp is distinct from o.impuesto or v_total is distinct from o.total then
    perform set_config('guds.bypass_guard', 'on', true);
    update ordenes set impuesto = v_imp, total = v_total where id = o.id;
    perform set_config('guds.bypass_guard', 'off', true);
  end if;
  return v_total;
end $$;
revoke execute on function public.aplicar_impuestos_orden(uuid) from public, anon, authenticated;

commit;
