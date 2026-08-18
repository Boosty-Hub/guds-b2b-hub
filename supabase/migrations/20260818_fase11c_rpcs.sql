begin;

-- Fase 11c: RPCs de cobranza contra facturas con asignación MANUAL por factura.
-- Reemplaza el FIFO automático de registrar_cobro / verificar_pago (Fase 6/8).

-- ─────────────────────────────────────────────────────────────────────────
-- Helper interno: aplica un pago (ya existente) a N facturas según lo que
-- decidió el admin. No expuesto directo a authenticated (revoke abajo).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.aplicar_pago_a_facturas(p_pago_id uuid, p_asignaciones jsonb)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_pago public.pagos%rowtype;
  v_ya_aplicado numeric;
  v_disponible numeric;
  v_total_asignado numeric := 0;
  r record;
begin
  select * into v_pago from public.pagos where id = p_pago_id;
  if not found then
    raise exception 'Pago % no existe', p_pago_id;
  end if;

  select coalesce(sum(monto_aplicado), 0) into v_ya_aplicado
  from public.pago_facturas where pago_id = p_pago_id;
  v_disponible := round(v_pago.monto - v_ya_aplicado, 2);

  -- Agrupa asignaciones por factura y descarta montos <= 0.
  for r in
    select (x->>'factura_id')::uuid as factura_id, round(sum((x->>'monto')::numeric), 2) as monto
    from jsonb_array_elements(coalesce(p_asignaciones, '[]'::jsonb)) x
    where (x->>'monto')::numeric > 0
    group by (x->>'factura_id')::uuid
  loop
    v_total_asignado := v_total_asignado + r.monto;
  end loop;

  if v_total_asignado <= 0 then
    return 0; -- nada que asignar (queda todo como anticipo)
  end if;

  if v_total_asignado > v_disponible + 0.01 then
    raise exception 'La asignación ($%) excede el monto disponible del pago ($%)', v_total_asignado, v_disponible;
  end if;

  for r in
    select (x->>'factura_id')::uuid as factura_id, round(sum((x->>'monto')::numeric), 2) as monto
    from jsonb_array_elements(coalesce(p_asignaciones, '[]'::jsonb)) x
    where (x->>'monto')::numeric > 0
    group by (x->>'factura_id')::uuid
  loop
    declare
      f public.facturas%rowtype;
    begin
      select * into f from public.facturas where id = r.factura_id;
      if not found then
        raise exception 'Factura % no existe', r.factura_id;
      end if;
      if f.cliente_id is distinct from v_pago.cliente_id then
        raise exception 'La factura % no pertenece al cliente del pago', f.numero;
      end if;
      if f.estado <> 'posted' or f.estado_pago = 'anulado' then
        raise exception 'La factura % no admite cobros (anulada o no vigente)', f.numero;
      end if;
      if f.tipo <> 'factura' then
        raise exception 'La factura % es una nota de crédito: no se cobra, se aplica aparte', f.numero;
      end if;
      if r.monto > f.saldo_usd + 0.01 then
        raise exception 'La factura % solo tiene saldo $%', f.numero, f.saldo_usd;
      end if;

      insert into public.pago_facturas (pago_id, factura_id, monto_aplicado, created_by)
      values (p_pago_id, r.factura_id, r.monto, (select id from public.usuarios where auth_id = auth.uid()))
      on conflict (pago_id, factura_id) do update
        set monto_aplicado = public.pago_facturas.monto_aplicado + excluded.monto_aplicado;
    end;
  end loop;

  return v_total_asignado;
end;
$$;

revoke all on function public.aplicar_pago_a_facturas(uuid, jsonb) from public;

-- ─────────────────────────────────────────────────────────────────────────
-- registrar_cobro_facturas: reemplaza a registrar_cobro (FIFO). El admin ya
-- trae las asignaciones decididas manualmente.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.registrar_cobro_facturas(
  p_cliente_id uuid,
  p_banco_id uuid,
  p_monto_moneda numeric,
  p_moneda text,
  p_tasa numeric,
  p_metodo pago_metodo,
  p_referencia text,
  p_comprobante_url text,
  p_notas text,
  p_asignaciones jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_admin uuid;
  v_monto_usd numeric;
  v_pago_id uuid;
  v_numero text;
  v_asignado numeric;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede registrar cobros';
  end if;
  select id into v_admin from public.usuarios where auth_id = auth.uid();

  if upper(coalesce(p_moneda,'USD')) in ('BS','VES') then
    if p_tasa is null or p_tasa <= 0 then
      raise exception 'Falta la tasa de cambio para un cobro en bolívares';
    end if;
    v_monto_usd := round(p_monto_moneda / p_tasa, 2);
  else
    v_monto_usd := round(p_monto_moneda, 2);
  end if;

  if v_monto_usd <= 0 then
    raise exception 'El monto del cobro debe ser mayor a 0';
  end if;

  v_numero := 'PAG-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(floor(random()*10000)::text, 4, '0');

  insert into public.pagos (
    numero, cliente_id, banco_id, metodo, monto, monto_moneda, moneda, tasa_cambio,
    referencia, comprobante_url, notas, estado, verificado_por, fecha_verificacion
  ) values (
    v_numero, p_cliente_id, p_banco_id, p_metodo, v_monto_usd, p_monto_moneda,
    coalesce(upper(p_moneda), 'USD'), p_tasa, p_referencia, p_comprobante_url, p_notas,
    'verificado', v_admin, now()
  ) returning id into v_pago_id;

  if p_banco_id is not null then
    insert into public.movimientos_bancarios (banco_id, tipo, monto, referencia, descripcion, pago_id)
    values (p_banco_id, 'entrada', coalesce(p_monto_moneda, v_monto_usd), p_referencia, 'Cobro registrado', v_pago_id);
  end if;

  v_asignado := public.aplicar_pago_a_facturas(v_pago_id, p_asignaciones);
  perform public.recalcular_credito(p_cliente_id);

  return jsonb_build_object(
    'pago_id', v_pago_id,
    'monto_usd', v_monto_usd,
    'facturas_afectadas', (select count(*) from public.pago_facturas where pago_id = v_pago_id),
    'saldo_a_favor', round(v_monto_usd - v_asignado, 2)
  );
end;
$$;

grant execute on function public.registrar_cobro_facturas(uuid, uuid, numeric, text, numeric, pago_metodo, text, text, text, jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- verificar_pago: nueva firma con asignaciones manuales. Se conserva un
-- wrapper de 5 argumentos (firma vieja) para no romper el frontend durante
-- el despliegue.
-- ─────────────────────────────────────────────────────────────────────────
drop function if exists public.verificar_pago(uuid, boolean, text, uuid, numeric);

create or replace function public.verificar_pago(
  p_pago_id uuid,
  p_aprobar boolean,
  p_notas text default null,
  p_banco_id uuid default null,
  p_tasa numeric default null,
  p_asignaciones jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_admin uuid;
  p public.pagos%rowtype;
  v_banco uuid;
  v_asignado numeric := 0;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede verificar pagos';
  end if;
  select id into v_admin from public.usuarios where auth_id = auth.uid();

  select * into p from public.pagos where id = p_pago_id;
  if not found then
    raise exception 'Pago % no existe', p_pago_id;
  end if;
  if p.estado <> 'pendiente' then
    raise exception 'El pago ya fue % ', p.estado;
  end if;

  if not p_aprobar then
    update public.pagos
    set estado = 'rechazado', verificado_por = v_admin, fecha_verificacion = now(),
        notas = coalesce(p_notas, notas)
    where id = p_pago_id;
    return jsonb_build_object('aplicado', 0, 'saldo_a_favor', 0);
  end if;

  v_banco := coalesce(p_banco_id, p.banco_id);

  update public.pagos
  set estado = 'verificado', verificado_por = v_admin, fecha_verificacion = now(),
      notas = coalesce(p_notas, notas), banco_id = v_banco,
      tasa_cambio = coalesce(p_tasa, tasa_cambio)
  where id = p_pago_id;

  if v_banco is not null then
    insert into public.movimientos_bancarios (banco_id, tipo, monto, referencia, descripcion, pago_id)
    values (v_banco, 'entrada', coalesce(p.monto_moneda, p.monto), p.referencia, 'Cobro verificado', p_pago_id);
  end if;

  v_asignado := public.aplicar_pago_a_facturas(p_pago_id, p_asignaciones);
  perform public.recalcular_credito(p.cliente_id);

  return jsonb_build_object('aplicado', v_asignado, 'saldo_a_favor', round(p.monto - v_asignado, 2));
end;
$$;

grant execute on function public.verificar_pago(uuid, boolean, text, uuid, numeric, jsonb) to authenticated;

-- Wrapper de compatibilidad (firma vieja de 5 args) mientras se despliega el frontend nuevo.
create or replace function public.verificar_pago(
  p_pago_id uuid, p_aprobar boolean, p_notas text, p_banco_id uuid, p_tasa numeric
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.verificar_pago(p_pago_id, p_aprobar, p_notas, p_banco_id, p_tasa, '[]'::jsonb);
end;
$$;

grant execute on function public.verificar_pago(uuid, boolean, text, uuid, numeric) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- aplicar_anticipo: aplica el disponible de un pago YA verificado a más
-- facturas (mismo cliente), sin crear un pago nuevo.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.aplicar_anticipo(p_pago_id uuid, p_asignaciones jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  p public.pagos%rowtype;
  v_asignado numeric;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede aplicar anticipos';
  end if;
  select * into p from public.pagos where id = p_pago_id;
  if not found or p.estado <> 'verificado' then
    raise exception 'El pago debe existir y estar verificado';
  end if;

  v_asignado := public.aplicar_pago_a_facturas(p_pago_id, p_asignaciones);
  perform public.recalcular_credito(p.cliente_id);

  return jsonb_build_object('aplicado', v_asignado);
end;
$$;

grant execute on function public.aplicar_anticipo(uuid, jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- facturar_orden: factura interna desde una orden (numeración propia F-######).
-- ─────────────────────────────────────────────────────────────────────────
create sequence if not exists public.factura_interna_seq;

create or replace function public.facturar_orden(p_orden_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  o public.ordenes%rowtype;
  v_factura_id uuid;
  v_numero text;
  v_dias_credito int;
begin
  if not public.puede('cuentas','crear') then
    raise exception 'No tiene permiso para facturar órdenes';
  end if;

  select * into o from public.ordenes where id = p_orden_id;
  if not found then
    raise exception 'Orden % no existe', p_orden_id;
  end if;
  if o.estado = 'cancelado' then
    raise exception 'No se puede facturar una orden cancelada';
  end if;
  if exists (
    select 1 from public.facturas
    where orden_id = p_orden_id and tipo = 'factura' and estado_pago <> 'anulado'
  ) then
    raise exception 'La orden % ya tiene una factura asociada', o.numero;
  end if;

  select coalesce(dias_credito, 0) into v_dias_credito from public.clientes where id = o.cliente_id;
  v_numero := 'F-' || lpad(nextval('public.factura_interna_seq')::text, 6, '0');

  insert into public.facturas (
    numero, tipo, cliente_id, orden_id, fecha_emision, fecha_vencimiento,
    moneda, subtotal, impuesto, total, total_usd, saldo_odoo_usd,
    estado_pago, estado, creada_en_guds
  ) values (
    v_numero, 'factura', o.cliente_id, o.id, current_date, current_date + v_dias_credito,
    'USD', coalesce(o.subtotal,0) - coalesce(o.descuento,0), coalesce(o.impuesto,0), o.total, o.total, o.total,
    'pendiente', 'posted', true
  ) returning id into v_factura_id;

  insert into public.factura_items (factura_id, producto_id, nombre_producto, sku_producto, cantidad, precio_unitario, descuento, subtotal, total)
  select v_factura_id, oi.producto_id, oi.nombre_producto, oi.sku_producto, oi.cantidad, oi.precio_unitario, oi.descuento, oi.subtotal,
         oi.subtotal -- orden_items no trae total con impuesto por línea; se deja igual al subtotal
  from public.orden_items oi
  where oi.orden_id = p_orden_id;

  return v_factura_id;
end;
$$;

grant execute on function public.facturar_orden(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- recalcular_credito v2: el crédito utilizado ahora refleja la deuda real
-- de facturas (incluye el efecto de notas de crédito, que restan).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.recalcular_credito(p_cliente_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_cliente_id is null then return; end if;
  update public.clientes set credito_utilizado = coalesce((
    select sum(saldo_usd) from public.facturas
    where cliente_id = p_cliente_id and estado = 'posted'
  ), 0)
  where id = p_cliente_id;
end;
$$;

commit;
