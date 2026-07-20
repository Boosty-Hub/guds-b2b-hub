-- =====================================================================
-- GUDS · FASE 4c — Vendedor funcional
--   · mis_clientes_vendedor(): clientes asignados al vendedor (SECURITY DEFINER)
--   · es_vendedor_de(cliente): el que llama es el vendedor asignado
--   · pagos_vendedor_read: el vendedor ve los pagos de sus clientes
--   · crear_orden_vendedor(...): el vendedor toma pedidos para sus clientes
--   · registrar_pago_vendedor(...): registra un cobro (queda pendiente de verif.)
-- =====================================================================
begin;

create or replace function public.mis_clientes_vendedor()
returns setof uuid language sql stable security definer set search_path = public as $fn$
  select c.id from clientes c join usuarios u on u.id = c.vendedor_asignado_id
  where u.auth_id = auth.uid();
$fn$;
revoke all on function public.mis_clientes_vendedor() from public;
grant execute on function public.mis_clientes_vendedor() to authenticated;

create or replace function public.es_vendedor_de(p_cliente_id uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from clientes c join usuarios u on u.id = c.vendedor_asignado_id
    where c.id = p_cliente_id and u.auth_id = auth.uid()
  );
$fn$;
revoke all on function public.es_vendedor_de(uuid) from public;
grant execute on function public.es_vendedor_de(uuid) to authenticated;

-- El vendedor ve los pagos de sus clientes
drop policy if exists pagos_vendedor_read on public.pagos;
create policy pagos_vendedor_read on public.pagos
  for select to authenticated
  using (cliente_id in (select public.mis_clientes_vendedor()));

-- Crear orden como vendedor (para un cliente asignado). Mismo cálculo de dinero.
create or replace function public.crear_orden_vendedor(
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
  if not (public.es_vendedor_de(p_cliente_id) or public.is_admin()) then
    raise exception 'No autorizado: el cliente no está asignado a este vendedor';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'La orden no tiene items'; end if;

  select id into v_usuario_id from usuarios where auth_id = auth.uid();

  select coalesce(sum((it->>'cantidad')::int * public.precio_efectivo((it->>'producto_id')::uuid, null, p_cliente_id)),0)
    into v_subtotal from jsonb_array_elements(p_items) it;

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
      raise exception 'Crédito insuficiente: disponible %, requerido %', coalesce(v_limite,0)-coalesce(v_utilizado,0), v_total;
    end if;
  end if;

  v_numero := generar_numero_orden();
  insert into ordenes (numero, cliente_id, usuario_id, vendedor_id, subtotal, descuento, impuesto, envio, total, estado, metodo_pago, notas)
  values (v_numero, p_cliente_id, v_usuario_id, v_usuario_id, v_subtotal, 0, v_impuesto, v_envio, v_total, 'pendiente', p_metodo_pago, coalesce(p_notas,''))
  returning id into v_orden_id;

  insert into orden_items (orden_id, producto_id, cantidad, precio_unitario, descuento, subtotal)
  select v_orden_id, (it->>'producto_id')::uuid, (it->>'cantidad')::int,
         public.precio_efectivo((it->>'producto_id')::uuid, null, p_cliente_id), 0,
         (it->>'cantidad')::int * public.precio_efectivo((it->>'producto_id')::uuid, null, p_cliente_id)
  from jsonb_array_elements(p_items) it;

  return query select v_orden_id, v_numero, v_total;
end;
$fn$;
revoke all on function public.crear_orden_vendedor(uuid, pago_metodo, text, jsonb) from public;
grant execute on function public.crear_orden_vendedor(uuid, pago_metodo, text, jsonb) to authenticated;

-- Registrar un cobro como vendedor (queda pendiente de verificación por el admin)
create or replace function public.registrar_pago_vendedor(
  p_cliente_id uuid, p_orden_id uuid, p_monto numeric, p_metodo pago_metodo, p_referencia text default null
) returns uuid
language plpgsql security definer set search_path = public
as $fn$
declare v_id uuid;
begin
  if not (public.es_vendedor_de(p_cliente_id) or public.is_admin()) then
    raise exception 'No autorizado: el cliente no está asignado a este vendedor';
  end if;
  if p_monto is null or p_monto <= 0 then raise exception 'Monto inválido'; end if;
  insert into pagos (cliente_id, orden_id, monto, metodo, referencia, estado)
  values (p_cliente_id, p_orden_id, p_monto, p_metodo, p_referencia, 'pendiente')
  returning id into v_id;
  return v_id;
end;
$fn$;
revoke all on function public.registrar_pago_vendedor(uuid, uuid, numeric, pago_metodo, text) from public;
grant execute on function public.registrar_pago_vendedor(uuid, uuid, numeric, pago_metodo, text) to authenticated;

commit;
