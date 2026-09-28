-- ════════════════════════════════════════════════════════════════════════
-- Fase 20a · Etapa 2 del plan de portales: IVA por producto desde Odoo, cotización en el servidor y listas de precios
--   Decisión 28-sep: "el IVA de cada producto viene de Odoo" y "listas de precios de Odoo".
--   · En Odoo cada producto tiene su impuesto (GUDS: IVA 16 %; Quirutec: la mayoría exentos, algunos 16 %; ninguno incluido en
--     el precio; redondeo por línea). GUDS aplicaba 16 % a todo. Ahora productos.impuesto_pct lo trae la sincronización y los
--     cuatro caminos de pedido (portal, vendedor, admin, edición) calculan el IVA por línea sobre la base con el descuento
--     prorrateado, redondeado por línea como Odoo, más el IVA del servicio de envío si está configurado. Cada línea guarda su
--     impuesto (orden_items.impuesto_pct / impuesto).
--   · cotizar_pedido(): el mismo cálculo para que las pantallas muestren el total exacto antes de enviar (sin estimar en el
--     navegador).
--   · Listas de precios: en Odoo hoy hay 4 listas sin reglas y el precio de lista es un valor de relleno ($1), por eso GUDS usa
--     el último precio vendido (decisión 27-sep). La sincronización trae listas, reglas y la lista de cada cliente;
--     precio_efectivo aplica las reglas de precio fijo y de descuento (sobre el precio base de GUDS) de listas en USD.
-- ════════════════════════════════════════════════════════════════════════
begin;

alter table public.productos add column if not exists impuesto_pct numeric(6,3), add column if not exists impuesto_nombre text;
comment on column public.productos.impuesto_pct is 'IVA de venta del producto en su empresa (Odoo: taxes_id). null = aún sin sincronizar (se usa iva_porcentaje)';
alter table public.orden_items add column if not exists impuesto_pct numeric(6,3), add column if not exists impuesto numeric(14,2);

alter table public.listas_precios add column if not exists odoo_id integer, add column if not exists moneda text;
create unique index if not exists listas_precios_odoo_id on public.listas_precios (odoo_id) where odoo_id is not null;

create table if not exists public.reglas_precio (
  id uuid primary key default gen_random_uuid(),
  odoo_id integer unique,
  lista_precios_id uuid not null references public.listas_precios(id) on delete cascade,
  empresa_id uuid references public.empresas(id),
  aplicado_en text not null check (aplicado_en in ('producto', 'categoria', 'global')),
  producto_id uuid references public.productos(id),
  categoria_id uuid references public.categorias(id),
  tipo_calculo text not null check (tipo_calculo in ('fijo', 'porcentaje', 'formula')),
  precio_fijo numeric, descuento_pct numeric, recargo numeric,
  base text, cantidad_minima numeric not null default 0,
  fecha_inicio timestamptz, fecha_fin timestamptz,
  activo boolean not null default true,
  odoo_sync_at timestamptz
);
alter table public.reglas_precio enable row level security;
drop policy if exists reglas_precio_leer on public.reglas_precio;
create policy reglas_precio_leer on public.reglas_precio for select to authenticated using ((select public.es_personal_admin()));
drop policy if exists empresa_visible on public.reglas_precio;
create policy empresa_visible on public.reglas_precio as restrictive for all to authenticated
  using (empresa_id is null or empresa_id = any ((select public.empresas_visibles())::uuid[]));
revoke all on public.reglas_precio from anon;
revoke insert, update, delete on public.reglas_precio from authenticated;

-- IVA de un producto (el de Odoo; si aún no se sincronizó o es un producto creado en GUDS, el general de configuración)
create or replace function public.impuesto_producto(p_producto_id uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select impuesto_pct from productos where id = p_producto_id),
                  (select nullif(valor, '')::numeric from configuracion where clave = 'iva_porcentaje'), 16);
$$;

-- IVA de las líneas de un pedido (jsonb de producto_id/cantidad/tipo_empaque_id): por línea sobre subtotal × factor (descuento prorrateado)
create or replace function public.impuesto_de_items(p_items jsonb, p_cliente_id uuid, p_factor numeric)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(round((it->>'cantidad')::int
           * public.precio_efectivo((it->>'producto_id')::uuid, nullif(it->>'tipo_empaque_id','')::uuid, p_cliente_id)
           * coalesce(p_factor, 1) * public.impuesto_producto((it->>'producto_id')::uuid) / 100.0, 2)), 0)
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) it;
$$;

-- IVA del envío: el del servicio de envío configurado para Odoo (si existe como producto en GUDS); sin servicio, 0
create or replace function public.impuesto_envio(p_empresa uuid, p_envio numeric)
returns numeric language sql stable security definer set search_path = public as $$
  select case when coalesce(p_envio, 0) <= 0 then 0 else round(p_envio * coalesce((
    select p.impuesto_pct from productos p
    where p.sku = (select nullif(trim(valor), '') from configuracion where clave = 'odoo_producto_envio')
      and (p.empresa_id is null or p.empresa_id = p_empresa) order by (p.empresa_id = p_empresa) desc nulls last limit 1), 0) / 100.0, 2) end;
$$;

-- Guarda el IVA por línea del pedido y deja impuesto y total del pedido consistentes con ellas
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
  select coalesce(sum(impuesto), 0) + public.impuesto_envio(o.empresa_id, o.envio) into v_imp from orden_items where orden_id = o.id;
  v_total := coalesce(o.subtotal, 0) - coalesce(o.descuento, 0) + v_imp + coalesce(o.envio, 0);
  if v_imp is distinct from o.impuesto or v_total is distinct from o.total then
    perform set_config('guds.bypass_guard', 'on', true);
    update ordenes set impuesto = v_imp, total = v_total where id = o.id;
    perform set_config('guds.bypass_guard', 'off', true);
  end if;
  return v_total;
end $$;

-- Precio efectivo: lista negociada en GUDS > regla de la lista de Odoo del cliente > precio del empaque > oferta/base × unidades
create or replace function public.precio_efectivo(p_producto_id uuid, p_tipo_empaque_id uuid default null, p_cliente_id uuid default null)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare
  v_precio numeric;
  v_lista uuid;
  v_moneda text;
  v_unidades numeric := 1;
  v_base numeric;
  v_categoria uuid;
  r record;
begin
  select case when en_oferta and precio_oferta is not null then precio_oferta else precio_base end, categoria_id
    into v_base, v_categoria from productos where id = p_producto_id;
  if p_tipo_empaque_id is not null then
    select greatest(coalesce(te.unidades, 1), 1) into v_unidades from tipos_empaque te where te.id = p_tipo_empaque_id;
  end if;

  if p_cliente_id is not null then
    select c.lista_precios_id, l.moneda into v_lista, v_moneda from clientes c left join listas_precios l on l.id = c.lista_precios_id where c.id = p_cliente_id;
    if v_lista is not null then
      -- 1) Precio negociado de la lista en GUDS
      select precio into v_precio from precios_lista where producto_id = p_producto_id and lista_precios_id = v_lista;
      if v_precio is not null then return v_precio; end if;
      -- 2) Regla de la lista de Odoo (solo listas en USD): producto > categoría > global, cantidad mínima ≤ 1, vigente
      if coalesce(v_moneda, 'USD') = 'USD' then
        select * into r from reglas_precio g
        where g.lista_precios_id = v_lista and g.activo and g.cantidad_minima <= 1
          and (g.fecha_inicio is null or g.fecha_inicio <= now()) and (g.fecha_fin is null or g.fecha_fin >= now())
          and (g.aplicado_en = 'global' or (g.aplicado_en = 'producto' and g.producto_id = p_producto_id)
               or (g.aplicado_en = 'categoria' and g.categoria_id = v_categoria))
        order by case g.aplicado_en when 'producto' then 0 when 'categoria' then 1 else 2 end, g.cantidad_minima desc
        limit 1;
        if found then
          v_precio := case r.tipo_calculo
            when 'fijo' then r.precio_fijo
            when 'porcentaje' then v_base * (1 - coalesce(r.descuento_pct, 0) / 100.0)
            else v_base * (1 - coalesce(r.descuento_pct, 0) / 100.0) + coalesce(r.recargo, 0) end;
          if v_precio is not null then return round(v_precio * coalesce(v_unidades, 1), 4); end if;
        end if;
      end if;
    end if;
  end if;

  -- 3) Precio explícito del empaque
  if p_tipo_empaque_id is not null then
    select precio_empaque into v_precio from producto_empaques
    where producto_id = p_producto_id and tipo_empaque_id = p_tipo_empaque_id and precio_empaque is not null;
    if v_precio is not null then return v_precio; end if;
  end if;

  -- 4) Oferta / precio base: son por unidad (como en Odoo); un empaque sin precio propio vale unidades × precio
  return round(v_base * coalesce(v_unidades, 1), 4);
end $$;

-- Cotización exacta para las pantallas (mismo cálculo que al guardar el pedido)
--   p_envio: null = regla del portal (gratis desde el mínimo); un número = cargo manual (vendedor / administración)
create or replace function public.cotizar_pedido(p_cliente_id uuid, p_items jsonb, p_cupon_id uuid default null, p_envio numeric default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_empresa uuid; v_subtotal numeric; v_descuento numeric := 0; v_base numeric; v_envio numeric; v_imp numeric; v_factor numeric;
  v_costo_envio numeric; v_envio_gratis_min numeric; c cupones%rowtype; v_lineas jsonb; v_aviso text;
begin
  if not (public.es_personal_admin() or public.es_vendedor_de(p_cliente_id) or p_cliente_id = any (public.clientes_del_usuario())) then
    raise exception 'No puedes cotizar para este cliente' using errcode = '42501';
  end if;
  select empresa_id into v_empresa from clientes where id = p_cliente_id;
  with l as (
    select (it->>'producto_id')::uuid producto_id, nullif(it->>'tipo_empaque_id','')::uuid tipo_empaque_id, (it->>'cantidad')::int cantidad,
           public.precio_efectivo((it->>'producto_id')::uuid, nullif(it->>'tipo_empaque_id','')::uuid, p_cliente_id) precio,
           public.impuesto_producto((it->>'producto_id')::uuid) pct
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) it where coalesce((it->>'cantidad')::int, 0) > 0
  )
  select coalesce(sum(cantidad * precio), 0),
         coalesce(jsonb_agg(jsonb_build_object('producto_id', producto_id, 'tipo_empaque_id', tipo_empaque_id, 'cantidad', cantidad,
           'precio_unitario', round(precio, 4), 'subtotal', round(cantidad * precio, 2), 'impuesto_pct', pct)), '[]'::jsonb)
    into v_subtotal, v_lineas from l;

  if p_cupon_id is not null then
    select * into c from cupones where id = p_cupon_id and activo;
    if not found then v_aviso := 'Cupón no válido';
    elsif v_subtotal < coalesce(c.minimo_compra, 0) then v_aviso := 'El cupón requiere una compra mínima de ' || c.minimo_compra;
    else
      v_descuento := case when c.tipo = 'porcentaje' then round(v_subtotal * c.valor / 100.0, 2) else c.valor end;
      if c.tipo = 'porcentaje' and c.maximo_descuento is not null then v_descuento := least(v_descuento, c.maximo_descuento); end if;
      v_descuento := least(v_descuento, v_subtotal);
    end if;
  end if;
  v_base := v_subtotal - v_descuento;
  select coalesce(max(case when clave='costo_envio' then valor::numeric end),50), coalesce(max(case when clave='envio_gratis_minimo' then valor::numeric end),500)
    into v_costo_envio, v_envio_gratis_min from configuracion where clave in ('costo_envio','envio_gratis_minimo');
  v_envio := case when p_envio is not null then round(greatest(p_envio, 0), 2)
                  when v_base <= 0 then 0 when v_base >= v_envio_gratis_min then 0 else v_costo_envio end;
  v_factor := case when v_subtotal > 0 then v_base / v_subtotal else 1 end;
  v_imp := public.impuesto_de_items(p_items, p_cliente_id, v_factor) + public.impuesto_envio(v_empresa, v_envio);
  return jsonb_build_object('lineas', v_lineas, 'subtotal', round(v_subtotal, 2), 'descuento', round(v_descuento, 2),
    'impuesto', round(v_imp, 2), 'envio', v_envio, 'total', round(v_base + v_imp + v_envio, 2),
    'envio_gratis_desde', v_envio_gratis_min, 'aviso', v_aviso);
end $$;

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
  v_envio := case when v_base >= v_envio_gratis_min then 0 else v_costo_envio end;
  -- IVA de cada producto (Odoo), sobre la base con el descuento prorrateado, redondeado por línea; más el del envío
  v_impuesto := public.impuesto_de_items(v_json, v_cliente_id, case when v_subtotal > 0 then v_base / v_subtotal else 1 end)
    + public.impuesto_envio(v_empresa, v_envio);
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
  perform public.aplicar_impuestos_orden(v_orden_id);

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
$$;

create or replace function public.crear_orden_vendedor(p_cliente_id uuid, p_metodo_pago pago_metodo, p_notas text, p_items jsonb, p_envio numeric default null)
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

  -- Sin envío automático en pedidos del vendedor: solo el cargo que él estipule
  v_envio := round(coalesce(p_envio, 0), 2);
  -- IVA de cada producto (Odoo), redondeado por línea; más el del envío
  v_impuesto := public.impuesto_de_items(p_items, p_cliente_id, 1)
    + public.impuesto_envio((select empresa_id from clientes where id = p_cliente_id), v_envio);
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
  perform public.aplicar_impuestos_orden(v_orden_id);

  return query select v_orden_id, v_numero, v_total;
end $$;

create or replace function public.crear_orden_admin(p_cliente_id uuid, p_metodo_pago pago_metodo, p_notas text, p_items jsonb)
 RETURNS TABLE(orden_id uuid, numero character varying, total numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_usuario_id uuid; v_subtotal numeric := 0;
  v_iva_pct numeric; v_costo_envio numeric; v_envio_gratis_min numeric;
  v_impuesto numeric; v_envio numeric; v_total numeric;
  v_orden_id uuid; v_numero varchar;
begin
  if not public.is_admin() then raise exception 'Solo un administrador puede crear ordenes aqui'; end if;
  if p_cliente_id is null then raise exception 'Falta el cliente'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'La orden no tiene items'; end if;
  perform public.validar_stock_pedido(p_items);

  select id into v_usuario_id from usuarios where auth_id = auth.uid();

  select coalesce(sum((it->>'cantidad')::int * public.precio_efectivo((it->>'producto_id')::uuid, nullif(it->>'tipo_empaque_id','')::uuid, p_cliente_id)), 0)
    into v_subtotal from jsonb_array_elements(p_items) it;

  select coalesce(max(case when clave='iva_porcentaje' then valor::numeric end),16),
         coalesce(max(case when clave='costo_envio' then valor::numeric end),50),
         coalesce(max(case when clave='envio_gratis_minimo' then valor::numeric end),500)
    into v_iva_pct, v_costo_envio, v_envio_gratis_min
  from configuracion where clave in ('iva_porcentaje','costo_envio','envio_gratis_minimo');

  v_envio := case when v_subtotal >= v_envio_gratis_min then 0 else v_costo_envio end;
  -- IVA de cada producto (Odoo), redondeado por línea; más el del envío
  v_impuesto := public.impuesto_de_items(p_items, p_cliente_id, 1)
    + public.impuesto_envio((select empresa_id from clientes where id = p_cliente_id), v_envio);
  v_total := v_subtotal + v_impuesto + v_envio;

  if p_metodo_pago = 'credito' then perform public.validar_credito(p_cliente_id, v_total); end if;

  v_numero := generar_numero_orden();
  insert into ordenes (numero, cliente_id, usuario_id, subtotal, descuento, impuesto, envio, total, estado, metodo_pago, notas)
  values (v_numero, p_cliente_id, v_usuario_id, v_subtotal, 0, v_impuesto, v_envio, v_total, 'pendiente', p_metodo_pago, coalesce(p_notas,''))
  returning id into v_orden_id;

  insert into orden_items (orden_id, producto_id, cantidad, precio_unitario, descuento, subtotal, tipo_empaque_id, unidades_por_empaque)
  select v_orden_id, (it->>'producto_id')::uuid, (it->>'cantidad')::int,
         public.precio_efectivo((it->>'producto_id')::uuid, nullif(it->>'tipo_empaque_id','')::uuid, p_cliente_id), 0,
         (it->>'cantidad')::int * public.precio_efectivo((it->>'producto_id')::uuid, nullif(it->>'tipo_empaque_id','')::uuid, p_cliente_id),
         nullif(it->>'tipo_empaque_id','')::uuid, public.unidades_empaque(nullif(it->>'tipo_empaque_id','')::uuid)
  from jsonb_array_elements(p_items) it;
  perform public.aplicar_impuestos_orden(v_orden_id);

  return query select v_orden_id, v_numero, v_total;
end;
$$;

create or replace function public.editar_pedido_pendiente(p_orden_id uuid, p_items jsonb, p_notas text default null, p_envio numeric default null)
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
  v_envio := case
    when o.vendedor_id is not null then round(coalesce(p_envio, o.envio, 0), 2)                      -- pedido del vendedor: cargo manual
    when p_envio is not null then round(p_envio, 2)                                                   -- administración lo ajusta
    else case when v_base >= v_envio_gratis_min then 0 else v_costo_envio end end;                    -- regla del portal
  -- IVA de cada producto (Odoo), sobre la base con el descuento prorrateado, redondeado por línea; más el del envío
  v_impuesto := public.impuesto_de_items(p_items, o.cliente_id, case when v_subtotal > 0 then v_base / v_subtotal else 1 end)
    + public.impuesto_envio(o.empresa_id, v_envio);
  v_total := v_base + v_impuesto + v_envio;

  if o.metodo_pago = 'credito' and v_total > coalesce(o.total, 0) then
    perform public.validar_credito(o.cliente_id, v_total - coalesce(o.total, 0));
  end if;

  update ordenes set subtotal = v_subtotal, descuento = v_descuento, impuesto = v_impuesto, envio = v_envio, total = v_total,
    notas = coalesce(p_notas, notas), editado_at = now(), editado_por = v_usuario_id, ediciones = coalesce(ediciones, 0) + 1
  where id = o.id;
  perform public.aplicar_impuestos_orden(o.id);
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

revoke execute on function public.impuesto_producto(uuid) from public, anon, authenticated;
revoke execute on function public.impuesto_de_items(jsonb, uuid, numeric) from public, anon, authenticated;
revoke execute on function public.impuesto_envio(uuid, numeric) from public, anon, authenticated;
revoke execute on function public.aplicar_impuestos_orden(uuid) from public, anon, authenticated;
revoke execute on function public.cotizar_pedido(uuid, jsonb, uuid, numeric) from public, anon;
grant execute on function public.cotizar_pedido(uuid, jsonb, uuid, numeric) to authenticated;

notify pgrst, 'reload schema';

commit;
