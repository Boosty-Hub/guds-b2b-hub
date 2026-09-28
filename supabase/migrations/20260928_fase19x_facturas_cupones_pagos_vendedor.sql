-- ════════════════════════════════════════════════════════════════════════
-- Fase 19x · Trazabilidad de facturas, cupones, pago de pedidos editados, vendedor del pedido y cuentas por empresa
-- (decisiones del dueño, 28-sep)
--   1. Facturas: "no se pueden eliminar, solo anular, y deben tener trazabilidad perfecta". Se bloquea el borrado (siempre,
--      también para la sincronización), se quita el permiso de eliminar, se registra cada alta, cambio y anulación en
--      facturas_historial (también los que llegan de Odoo: el trigger corre aunque el importador desactive triggers) y
--      anular_factura() anula las facturas creadas en GUDS dejando motivo, fecha y quién (las de Odoo se anulan en Odoo).
--      Las líneas de factura solo las ajusta la sincronización en facturas que vienen de Odoo.
--   2. Cupones: porcentaje o monto exacto (restricción) y el pedido guarda el cupón usado (ordenes.cupon_id) para
--      recalcularlo bien si el pedido se edita.
--   3. Pedido editado: se recalcula el cupón según su tipo y se compara con lo pagado (verificado y por verificar):
--      editar_pedido_pendiente devuelve cuánto falta o cuánto queda a favor, y avisa al cliente con esa diferencia.
--      resumen_pago_orden() lo expone al portal, al vendedor y al admin.
--   4. asignar_vendedor_orden(): asignar vendedor a un pedido que no tiene.
--   5. Cuentas por empresa: un pago solo se declara a una cuenta de la misma empresa del cliente.
-- ════════════════════════════════════════════════════════════════════════
begin;

-- ── 1. Facturas ──
alter table public.facturas add column if not exists anulada_at timestamptz, add column if not exists anulada_por uuid references public.usuarios(id);

create table if not exists public.facturas_historial (
  id bigserial primary key,
  factura_id uuid not null references public.facturas(id),
  empresa_id uuid references public.empresas(id),
  accion text not null check (accion in ('creada', 'modificada', 'anulada')),
  cambios jsonb not null default '{}'::jsonb,
  origen text not null check (origen in ('odoo', 'guds')),
  usuario_id uuid references public.usuarios(id),
  created_at timestamptz not null default now()
);
create index if not exists facturas_historial_factura on public.facturas_historial (factura_id, created_at);
alter table public.facturas_historial enable row level security;
drop policy if exists facturas_historial_leer on public.facturas_historial;
create policy facturas_historial_leer on public.facturas_historial for select to authenticated
  using ((select public.es_personal_admin()) and (select public.puede('cuentas', 'ver')));
drop policy if exists empresa_visible on public.facturas_historial;
create policy empresa_visible on public.facturas_historial as restrictive for all to authenticated
  using (empresa_id is null or empresa_id = any ((select public.empresas_visibles())::uuid[]));
revoke all on public.facturas_historial from anon;
revoke insert, update, delete, truncate on public.facturas_historial from authenticated;

create or replace function public.trg_factura_historial()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_origen text := case when coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '') in ('authenticated', 'anon') then 'guds' else 'odoo' end;
  v_usuario uuid := (select id from usuarios where auth_id = auth.uid());
  v_cambios jsonb;
  k text;
begin
  if tg_op = 'INSERT' then
    insert into facturas_historial (factura_id, empresa_id, accion, cambios, origen, usuario_id)
    values (new.id, new.empresa_id, 'creada', jsonb_build_object('numero', new.numero, 'tipo', new.tipo, 'estado', new.estado,
      'total', new.total, 'moneda', new.moneda, 'fecha_emision', new.fecha_emision, 'cliente_id', new.cliente_id), v_origen, v_usuario);
    return new;
  end if;
  v_cambios := '{}'::jsonb;
  foreach k in array array['numero', 'tipo', 'estado', 'estado_pago', 'estado_cobro', 'cliente_id', 'fecha_emision', 'fecha_vencimiento',
    'moneda', 'subtotal', 'impuesto', 'total', 'total_usd', 'saldo_usd', 'nro_control', 'motivo_anulacion', 'anulada_at'] loop
    if (to_jsonb(old) -> k) is distinct from (to_jsonb(new) -> k) then
      v_cambios := v_cambios || jsonb_build_object(k, jsonb_build_array(to_jsonb(old) -> k, to_jsonb(new) -> k));
    end if;
  end loop;
  if v_cambios = '{}'::jsonb then return new; end if;
  insert into facturas_historial (factura_id, empresa_id, accion, cambios, origen, usuario_id)
  values (new.id, new.empresa_id, case when new.estado = 'cancel' and old.estado is distinct from 'cancel' then 'anulada' else 'modificada' end,
    v_cambios, v_origen, v_usuario);
  return new;
end $$;
drop trigger if exists z_factura_historial on public.facturas;
create trigger z_factura_historial after insert or update on public.facturas for each row execute function public.trg_factura_historial();
alter table public.facturas enable always trigger z_factura_historial;

create or replace function public.trg_facturas_no_borrar()
returns trigger language plpgsql as $$
begin
  raise exception 'Las facturas no se eliminan: se anulan y queda su registro e historial (%).', old.numero using errcode = 'P0001';
end $$;
drop trigger if exists a_facturas_no_borrar on public.facturas;
create trigger a_facturas_no_borrar before delete on public.facturas for each row execute function public.trg_facturas_no_borrar();
alter table public.facturas enable always trigger a_facturas_no_borrar;

-- Líneas: solo la sincronización ajusta las de facturas de Odoo; nunca por la API ni las de facturas de GUDS
create or replace function public.trg_factura_items_no_borrar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '') in ('authenticated', 'anon')
     or not exists (select 1 from facturas f where f.id = old.factura_id and f.odoo_id is not null) then
    raise exception 'Las líneas de una factura no se eliminan.' using errcode = 'P0001';
  end if;
  return old;
end $$;
drop trigger if exists a_factura_items_no_borrar on public.factura_items;
create trigger a_factura_items_no_borrar before delete on public.factura_items for each row execute function public.trg_factura_items_no_borrar();
alter table public.factura_items enable always trigger a_factura_items_no_borrar;

drop policy if exists facturas_perm_eliminar on public.facturas;
drop policy if exists factura_items_perm_eliminar on public.factura_items;
revoke delete, truncate on public.facturas, public.factura_items from authenticated, anon;

create or replace function public.anular_factura(p_factura_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare f facturas%rowtype;
begin
  if not (public.es_personal_admin() and public.puede('cuentas', 'editar')) then
    raise exception 'No tienes permiso para anular facturas' using errcode = '42501';
  end if;
  select * into f from facturas where id = p_factura_id for update;
  if not found then raise exception 'Factura no encontrada' using errcode = 'P0001'; end if;
  if f.odoo_id is not null then
    raise exception 'La factura % viene de Odoo: se anula en Odoo y GUDS lo refleja al sincronizar.', f.numero using errcode = 'P0001';
  end if;
  if f.estado = 'cancel' then raise exception 'La factura % ya está anulada.', f.numero using errcode = 'P0001'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Indica el motivo de la anulación' using errcode = 'P0001'; end if;
  if exists (select 1 from pago_facturas pf where pf.factura_id = f.id and pf.monto_aplicado > 0) then
    raise exception 'La factura % tiene cobros aplicados: primero revierte esos cobros.', f.numero using errcode = 'P0001';
  end if;
  update facturas set estado = 'cancel', estado_pago = 'anulado', estado_cobro = 'anulado', motivo_anulacion = trim(p_motivo),
    anulada_at = now(), anulada_por = (select id from usuarios where auth_id = auth.uid())
  where id = f.id;
end $$;
revoke execute on function public.anular_factura(uuid, text) from public, anon;
grant execute on function public.anular_factura(uuid, text) to authenticated;

-- ── 2. Cupones ──
alter table public.cupones drop constraint if exists cupones_tipo_valor;
alter table public.cupones add constraint cupones_tipo_valor check (tipo in ('porcentaje', 'fijo') and valor > 0 and (tipo <> 'porcentaje' or valor <= 100));
alter table public.ordenes add column if not exists cupon_id uuid references public.cupones(id);

create or replace function public.crear_orden_desde_carrito(p_metodo_pago pago_metodo, p_notas text DEFAULT ''::text, p_cupon_id uuid DEFAULT NULL::uuid, p_comprobante_url text DEFAULT NULL::text, p_referencia text DEFAULT NULL::text, p_banco_id uuid DEFAULT NULL::uuid, p_moneda text DEFAULT 'USD'::text, p_tasa numeric DEFAULT NULL::numeric)
 RETURNS TABLE(orden_id uuid, numero character varying, total numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_uid uuid := auth.uid();
  v_usuario_id uuid; v_cliente_id uuid; v_empresa uuid;
  v_subtotal numeric := 0; v_descuento numeric := 0;
  v_iva_pct numeric; v_costo_envio numeric; v_envio_gratis_min numeric;
  v_base numeric; v_impuesto numeric; v_envio numeric; v_total numeric;
  v_orden_id uuid; v_numero varchar; v_cupon record; v_items integer; v_json jsonb;
  v_moneda text := upper(coalesce(p_moneda, 'USD'));
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select id into v_usuario_id from usuarios where auth_id = v_uid;
  if v_usuario_id is null then raise exception 'Usuario no encontrado'; end if;
  v_empresa := public.empresa_activa_requerida();
  -- Ficha del cliente en la empresa activa (un cliente presente en ambas empresas tiene una ficha por empresa)
  v_cliente_id := public.mi_cliente_id();
  if v_cliente_id is null then raise exception 'El usuario no tiene un cliente asociado'; end if;
  if not exists (select 1 from clientes where id = v_cliente_id and (empresa_id is null or empresa_id = v_empresa)) then
    raise exception 'Tu cuenta no está habilitada para comprar en esta empresa' using errcode = 'P0001';
  end if;

  select count(*) into v_items from carrito where usuario_id = v_usuario_id and empresa_id = v_empresa;
  if v_items = 0 then raise exception 'El carrito esta vacio'; end if;
  -- Un pago adjunto solo se declara a una cuenta publicada para clientes (19l)
  if p_banco_id is not null and not exists (select 1 from bancos b where b.id = p_banco_id and b.activo and b.visible_portal
                                                and b.empresa_id is not distinct from v_empresa) then
    raise exception 'La cuenta indicada no recibe pagos de clientes' using errcode = 'P0001';
  end if;

  select jsonb_agg(jsonb_build_object('producto_id', c.producto_id, 'cantidad', c.cantidad, 'tipo_empaque_id', c.tipo_empaque_id))
    into v_json from carrito c where c.usuario_id = v_usuario_id and c.empresa_id = v_empresa;
  perform public.validar_stock_pedido(v_json);

  select coalesce(sum(public.precio_efectivo(c.producto_id, c.tipo_empaque_id, v_cliente_id) * c.cantidad), 0)
    into v_subtotal from carrito c where c.usuario_id = v_usuario_id and c.empresa_id = v_empresa;

  if p_cupon_id is not null then
    select * into v_cupon from cupones
    where id = p_cupon_id and activo = true
      and (fecha_inicio is null or fecha_inicio <= current_date)
      and (fecha_fin is null or fecha_fin >= current_date)
      and (cliente_especifico_id is null or cliente_especifico_id = v_cliente_id);
    if not found then raise exception 'Cupón inválido o vencido'; end if;
    if v_cupon.usos_maximos is not null and v_cupon.usos_actuales >= v_cupon.usos_maximos then
      raise exception 'El cupón alcanzó su límite de usos'; end if;
    if v_subtotal < coalesce(v_cupon.minimo_compra, 0) then
      raise exception 'El cupón requiere una compra mínima de %', v_cupon.minimo_compra; end if;
    if v_cupon.solo_primera_compra and exists (
      select 1 from ordenes where cliente_id = v_cliente_id and estado <> 'cancelado') then
      raise exception 'El cupón es válido solo para la primera compra'; end if;
    v_descuento := case when v_cupon.tipo = 'porcentaje'
      then round(v_subtotal * (v_cupon.valor / 100.0), 2) else v_cupon.valor end;
    if v_cupon.maximo_descuento is not null then v_descuento := least(v_descuento, v_cupon.maximo_descuento); end if;
    v_descuento := least(v_descuento, v_subtotal);
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

  if p_metodo_pago = 'credito' then perform public.validar_credito(v_cliente_id, v_total); end if;

  v_numero := generar_numero_orden();

  insert into ordenes (numero, cliente_id, usuario_id, subtotal, descuento, impuesto, envio, total, estado, metodo_pago, notas, comprobante_url, referencia_pago, cupon_id)
  values (v_numero, v_cliente_id, v_usuario_id, v_subtotal, v_descuento, v_impuesto, v_envio, v_total, 'pendiente', p_metodo_pago, coalesce(p_notas,''), p_comprobante_url, p_referencia, p_cupon_id)
  returning id into v_orden_id;

  insert into orden_items (orden_id, producto_id, cantidad, precio_unitario, descuento, subtotal, tipo_empaque_id, unidades_por_empaque)
  select v_orden_id, c.producto_id, c.cantidad,
         public.precio_efectivo(c.producto_id, c.tipo_empaque_id, v_cliente_id), 0,
         public.precio_efectivo(c.producto_id, c.tipo_empaque_id, v_cliente_id) * c.cantidad,
         c.tipo_empaque_id, public.unidades_empaque(c.tipo_empaque_id)
  from carrito c where c.usuario_id = v_usuario_id and c.empresa_id = v_empresa;

  if p_cupon_id is not null then
    update cupones set usos_actuales = usos_actuales + 1 where id = p_cupon_id;
  end if;

  if p_comprobante_url is not null then
    insert into pagos (cliente_id, orden_id, monto, monto_moneda, moneda, tasa_cambio, banco_id, metodo, referencia, comprobante_url, estado)
    values (
      v_cliente_id, v_orden_id, v_total,
      case when v_moneda = 'BS' and coalesce(p_tasa,0) > 0 then round(v_total * p_tasa, 2) else v_total end,
      v_moneda, case when v_moneda = 'BS' then p_tasa else null end,
      p_banco_id, p_metodo_pago, p_referencia, p_comprobante_url, 'pendiente'
    );
  end if;

  delete from carrito where usuario_id = v_usuario_id and empresa_id = v_empresa;
  return query select v_orden_id, v_numero, v_total;
end;
$$;;

-- ── 5. Cuentas por empresa en la declaración de pagos ──
create or replace function public.registrar_pago(p_cliente_id uuid, p_orden_id uuid, p_banco_id uuid, p_metodo pago_metodo, p_monto_moneda numeric,
  p_moneda text default 'USD', p_tasa_cambio numeric default null, p_referencia text default null, p_comprobante_url text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_es_admin boolean := public.is_admin();
  v_autorizado boolean;
  v_monto_usd numeric;
  v_id uuid;
begin
  v_autorizado := v_es_admin
    or public.es_vendedor_de(p_cliente_id)
    or p_cliente_id = any (public.clientes_del_usuario());
  if not v_autorizado then raise exception 'No autorizado para registrar este pago'; end if;
  if p_monto_moneda is null or p_monto_moneda <= 0 then raise exception 'Monto inválido'; end if;
  if not v_es_admin and p_banco_id is not null
     and not exists (select 1 from public.bancos b where b.id = p_banco_id and b.activo and b.visible_portal) then
    raise exception 'La cuenta indicada no recibe pagos de clientes';
  end if;
  -- La cuenta debe ser de la misma empresa que el cliente (no se mezclan cuentas de GUDS y de Quirutec)
  if p_banco_id is not null and exists (select 1 from public.bancos b join public.clientes c on c.id = p_cliente_id
       where b.id = p_banco_id and b.empresa_id is not null and c.empresa_id is not null and b.empresa_id <> c.empresa_id) then
    raise exception 'La cuenta indicada es de otra empresa';
  end if;

  if p_moneda = 'BS' then
    if coalesce(p_tasa_cambio, 0) <= 0 then raise exception 'Falta la tasa de cambio para un pago en bolívares'; end if;
    v_monto_usd := round(p_monto_moneda / p_tasa_cambio, 2);
  else
    v_monto_usd := p_monto_moneda;
  end if;

  insert into pagos (cliente_id, orden_id, banco_id, metodo, monto, monto_moneda, moneda, tasa_cambio, referencia, comprobante_url, estado, verificado_por, fecha_verificacion)
  values (
    p_cliente_id, p_orden_id, p_banco_id, p_metodo, v_monto_usd, p_monto_moneda,
    coalesce(p_moneda,'USD'), case when p_moneda = 'BS' then p_tasa_cambio else null end, p_referencia, p_comprobante_url,
    (case when v_es_admin then 'verificado' else 'pendiente' end)::pago_estado,
    case when v_es_admin then (select id from usuarios where auth_id = auth.uid()) else null end,
    case when v_es_admin then now() else null end
  ) returning id into v_id;

  if v_es_admin then
    perform public.liquidar_orden(p_orden_id);
  end if;

  return v_id;
end $$;

-- ── 3. Pago del pedido ──
create or replace function public.resumen_pago_orden(p_orden_id uuid)
returns table(total numeric, verificado numeric, por_verificar numeric, falta numeric, a_favor numeric)
language plpgsql stable security definer set search_path = public as $$
declare o ordenes%rowtype;
begin
  select * into o from ordenes where id = p_orden_id;
  if not found then raise exception 'Pedido no encontrado' using errcode = 'P0001'; end if;
  if not (public.es_personal_admin() or public.es_vendedor_de(o.cliente_id) or o.cliente_id = any (public.clientes_del_usuario())) then
    raise exception 'No puedes ver este pedido' using errcode = '42501';
  end if;
  return query
  with p as (
    select coalesce(sum(pg.monto) filter (where pg.estado = 'verificado'), 0) v, coalesce(sum(pg.monto) filter (where pg.estado = 'pendiente'), 0) pv
    from pagos pg where pg.orden_id = o.id and not coalesce(pg.es_igtf, false)
  )
  select round(coalesce(o.total, 0), 2), round(p.v, 2), round(p.pv, 2),
         round(greatest(coalesce(o.total, 0) - p.v - p.pv, 0), 2), round(greatest(p.v + p.pv - coalesce(o.total, 0), 0), 2)
  from p;
end $$;
revoke execute on function public.resumen_pago_orden(uuid) from public, anon;
grant execute on function public.resumen_pago_orden(uuid) to authenticated;

drop function if exists public.editar_pedido_pendiente(uuid, jsonb, text, numeric);
create function public.editar_pedido_pendiente(p_orden_id uuid, p_items jsonb, p_notas text default null, p_envio numeric default null)
returns table(orden_id uuid, numero character varying, total numeric, pagado numeric, falta numeric, a_favor numeric)
language plpgsql security definer set search_path = public as $$
declare
  o ordenes%rowtype; c cupones%rowtype;
  v_usuario_id uuid; v_admin boolean; v_vendedor boolean; v_cliente boolean;
  v_subtotal numeric; v_descuento numeric; v_iva_pct numeric; v_costo_envio numeric; v_envio_gratis_min numeric;
  v_base numeric; v_impuesto numeric; v_envio numeric; v_total numeric; v_cli text;
  v_pagado numeric; v_falta numeric; v_favor numeric; v_texto_pago text;
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

  -- Cupón: se recalcula según su tipo (porcentaje sobre el subtotal nuevo, con tope; o monto exacto). Si el subtotal
  -- quedó por debajo del mínimo de compra, deja de aplicar. Pedidos viejos sin cupón registrado conservan el descuento fijo.
  if o.cupon_id is not null then
    select * into c from cupones where id = o.cupon_id;
    if not found or v_subtotal < coalesce(c.minimo_compra, 0) then
      v_descuento := 0;
    elsif c.tipo = 'porcentaje' then
      v_descuento := round(v_subtotal * (c.valor / 100.0), 2);
      if c.maximo_descuento is not null then v_descuento := least(v_descuento, c.maximo_descuento); end if;
    else
      v_descuento := c.valor;
    end if;
    v_descuento := least(v_descuento, v_subtotal);
  else
    v_descuento := least(coalesce(o.descuento, 0), v_subtotal);
  end if;
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
  perform public.liquidar_orden(o.id);

  -- Lo ya pagado (verificado o por verificar) frente al total nuevo
  select coalesce(sum(pg.monto), 0) into v_pagado from pagos pg
  where pg.orden_id = o.id and pg.estado in ('verificado', 'pendiente') and not coalesce(pg.es_igtf, false);
  v_falta := round(greatest(v_total - v_pagado, 0), 2);
  v_favor := round(greatest(v_pagado - v_total, 0), 2);
  v_texto_pago := case when v_pagado <= 0 then ''
    when v_falta > 0 then ' Ya pagaste ' || fmt_usd(v_pagado) || ': falta ' || fmt_usd(v_falta) || '.'
    when v_favor > 0 then ' Ya pagaste ' || fmt_usd(v_pagado) || ': te quedan ' || fmt_usd(v_favor) || ' a favor en tu cuenta.'
    else ' Tu pago cubre el total.' end;

  select nombre_negocio into v_cli from clientes where id = o.cliente_id;
  perform notif_admins('Pedido por aprobar ' || o.numero || ' editado',
    coalesce(v_cli, 'Cliente') || ' · ' || fmt_usd(v_total) || case when v_cliente and not (v_admin or v_vendedor) then ' · editado por el cliente' else '' end
      || case when v_falta > 0 and v_pagado > 0 then ' · falta ' || fmt_usd(v_falta) when v_favor > 0 then ' · a favor ' || fmt_usd(v_favor) else '' end,
    'alerta', '/admin/ordenes?aprobacion=pendiente');
  if v_cliente and not (v_admin or v_vendedor) then
    perform notif_vendedor(o.cliente_id, 'Tu cliente editó un pedido', coalesce(v_cli, 'Cliente') || ': ' || o.numero || ' ahora por ' || fmt_usd(v_total), 'orden', '/vendedor/pedidos');
  else
    -- Lo editó su vendedor o administración: el cliente se entera del cambio
    perform notif_cliente(o.cliente_id, 'Tu pedido fue actualizado',
      'El pedido ' || o.numero || ' ahora es por ' || fmt_usd(v_total) || ' y sigue pendiente de aprobación.' || v_texto_pago, 'orden', '/portal/pedidos');
  end if;

  return query select o.id, o.numero, v_total, round(v_pagado, 2), v_falta, v_favor;
end $$;
revoke execute on function public.editar_pedido_pendiente(uuid, jsonb, text, numeric) from public, anon;
grant execute on function public.editar_pedido_pendiente(uuid, jsonb, text, numeric) to authenticated;

-- ── 4. Vendedor del pedido ──
create or replace function public.asignar_vendedor_orden(p_orden_id uuid, p_vendedor_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o ordenes%rowtype;
begin
  if not (public.es_personal_admin() and public.puede('ordenes', 'editar')) then
    raise exception 'No tienes permiso para asignar vendedores' using errcode = '42501';
  end if;
  select * into o from ordenes where id = p_orden_id for update;
  if not found then raise exception 'Pedido no encontrado' using errcode = 'P0001'; end if;
  if not exists (select 1 from usuarios u where u.id = p_vendedor_id and u.role = 'vendedor' and coalesce(u.activo, true)) then
    raise exception 'Elige un vendedor activo' using errcode = 'P0001';
  end if;
  if o.empresa_id is not null and not exists (select 1 from usuario_empresas ue where ue.usuario_id = p_vendedor_id and ue.empresa_id = o.empresa_id) then
    raise exception 'Ese vendedor no trabaja en la empresa del pedido' using errcode = 'P0001';
  end if;
  perform set_config('guds.bypass_guard', 'on', true);
  update ordenes set vendedor_id = p_vendedor_id where id = o.id;
  perform set_config('guds.bypass_guard', 'off', true);
end $$;
revoke execute on function public.asignar_vendedor_orden(uuid, uuid) from public, anon;
grant execute on function public.asignar_vendedor_orden(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
