-- =====================================================================
-- GUDS · FASE 1b — RPC para crear ordenes desde el panel admin/vendedor.
--   Misma logica de dinero que el checkout del cliente (IVA + envio desde
--   configuracion), atomica, solo admin. Los items llegan como jsonb:
--   [{"producto_id": uuid, "cantidad": int, "precio_unitario": numeric}, ...]
-- =====================================================================
begin;

create or replace function public.crear_orden_admin(
  p_cliente_id uuid,
  p_metodo_pago pago_metodo,
  p_notas text,
  p_items jsonb
) returns table(orden_id uuid, numero varchar, total numeric)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_usuario_id uuid;
  v_subtotal numeric := 0;
  v_iva_pct numeric;
  v_costo_envio numeric;
  v_envio_gratis_min numeric;
  v_impuesto numeric;
  v_envio numeric;
  v_total numeric;
  v_orden_id uuid;
  v_numero varchar;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede crear ordenes aqui';
  end if;
  if p_cliente_id is null then
    raise exception 'Falta el cliente';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'La orden no tiene items';
  end if;

  select id into v_usuario_id from usuarios where auth_id = auth.uid();

  select coalesce(sum((it->>'cantidad')::int * (it->>'precio_unitario')::numeric), 0)
    into v_subtotal
  from jsonb_array_elements(p_items) it;

  select coalesce(max(case when clave = 'iva_porcentaje' then valor::numeric end), 16),
         coalesce(max(case when clave = 'costo_envio' then valor::numeric end), 50),
         coalesce(max(case when clave = 'envio_gratis_minimo' then valor::numeric end), 500)
    into v_iva_pct, v_costo_envio, v_envio_gratis_min
  from configuracion
  where clave in ('iva_porcentaje','costo_envio','envio_gratis_minimo');

  v_impuesto := round(v_subtotal * (v_iva_pct / 100.0), 2);
  v_envio    := case when v_subtotal >= v_envio_gratis_min then 0 else v_costo_envio end;
  v_total    := v_subtotal + v_impuesto + v_envio;
  v_numero   := generar_numero_orden();

  insert into ordenes
    (numero, cliente_id, usuario_id, subtotal, descuento, impuesto, envio, total,
     estado, metodo_pago, notas)
  values
    (v_numero, p_cliente_id, v_usuario_id, v_subtotal, 0, v_impuesto, v_envio, v_total,
     'pendiente', p_metodo_pago, coalesce(p_notas, ''))
  returning id into v_orden_id;

  insert into orden_items (orden_id, producto_id, cantidad, precio_unitario, descuento, subtotal)
  select v_orden_id,
         (it->>'producto_id')::uuid,
         (it->>'cantidad')::int,
         (it->>'precio_unitario')::numeric,
         0,
         (it->>'cantidad')::int * (it->>'precio_unitario')::numeric
  from jsonb_array_elements(p_items) it;

  return query select v_orden_id, v_numero, v_total;
end;
$fn$;

revoke all on function public.crear_orden_admin(uuid, pago_metodo, text, jsonb) from public;
grant execute on function public.crear_orden_admin(uuid, pago_metodo, text, jsonb) to authenticated;

commit;
