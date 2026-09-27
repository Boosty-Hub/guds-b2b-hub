-- ════════════════════════════════════════════════════════════════════════
-- Fase 17b · Multiempresa: reglas
--   Se aplica DESPUÉS de la 17a y del backfill (scripts/multiempresa-backfill.mjs --apply).
--
--   1. Herencia de empresa en tablas hijas (trigger)
--   2. empresa_id obligatorio en tablas transaccionales + defaults según la empresa activa
--   3. Guardia: un usuario solo escribe en la empresa activa (cubre funciones security definer)
--   4. Validación de referencias: no se mezclan cliente/producto/factura de otra empresa
--   5. RLS restrictiva por empresa (las políticas por rol existentes no se tocan)
--   6. Unicidad por empresa
--   7. Numeración por empresa con prefijo (GUDS-ORD-00001 / QRT-ORD-00001)
-- ════════════════════════════════════════════════════════════════════════
begin;

-- ── 1. Herencia de empresa ──────────────────────────────────────────────
-- Uso: trigger BEFORE INSERT con argumentos (tabla_padre, columna_fk [, 'activa']).
-- Si el padre no tiene empresa (compartido) y se pasa 'activa', usa la empresa activa.
create or replace function public.trg_heredar_empresa()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ref uuid; v_emp uuid;
begin
  if new.empresa_id is not null then return new; end if;
  v_ref := (to_jsonb(new) ->> tg_argv[1])::uuid;
  if v_ref is not null then
    execute format('select empresa_id from public.%I where id = $1', tg_argv[0]) into v_emp using v_ref;
  end if;
  new.empresa_id := coalesce(v_emp, case when tg_nargs > 2 and tg_argv[2] = 'activa' then public.empresa_activa() end);
  return new;
end $$;

do $$
declare r record;
begin
  for r in select * from (values
    ('orden_items', 'ordenes', 'orden_id', null),
    ('entregas', 'ordenes', 'orden_id', null),
    ('factura_items', 'facturas', 'factura_id', null),
    ('retencion_items', 'retenciones', 'retencion_id', null),
    ('pago_facturas', 'pagos', 'pago_id', null),
    ('pago_ordenes', 'pagos', 'pago_id', null),
    ('pago_cuentas', 'pagos', 'pago_id', null),
    ('extracto_lineas', 'extractos_bancarios', 'extracto_id', null),
    ('declaracion_consignacion_items', 'declaraciones_consignacion', 'declaracion_id', null),
    ('inventario_almacen', 'almacenes', 'almacen_id', null),
    ('producto_empaques', 'productos', 'producto_id', null),
    ('precios_lista', 'listas_precios', 'lista_precios_id', null),
    ('movimientos_bancarios', 'bancos', 'banco_id', 'activa'),
    ('movimientos_inventario', 'productos', 'producto_id', 'activa'),
    ('cuentas_cobrar', 'clientes', 'cliente_id', 'activa')
  ) as t(tabla, padre, fk, modo) loop
    execute format('drop trigger if exists a_heredar_empresa on public.%I', r.tabla);
    execute format('create trigger a_heredar_empresa before insert on public.%I for each row execute function public.trg_heredar_empresa(%L, %L%s)',
      r.tabla, r.padre, r.fk, case when r.modo is not null then format(', %L', r.modo) else '' end);
  end loop;
end $$;

-- ── 2. Obligatoriedad y defaults ────────────────────────────────────────
do $$
declare t text;
begin
  -- Transaccionales: siempre de una empresa
  foreach t in array array[
    'bancos','almacenes','inventario_almacen','cupones','banners','metas_vendedor','carrito','favoritos',
    'ordenes','orden_items','entregas','facturas','factura_items',
    'pagos','pago_facturas','pago_ordenes','pago_cuentas','cuentas_cobrar',
    'movimientos_bancarios','extractos_bancarios','extracto_lineas',
    'declaraciones_consignacion','declaracion_consignacion_items','retenciones','retencion_items'
  ] loop
    execute format('alter table public.%I alter column empresa_id set not null', t);
  end loop;

  -- Lo que se crea en GUDS queda en la empresa activa (en "Ambas" la alta se rechaza con un mensaje claro).
  -- productos/clientes/listas_precios siguen admitiendo null = compartido (solo desde Odoo).
  foreach t in array array[
    'productos','clientes','listas_precios','bancos','almacenes','cupones','banners','metas_vendedor',
    'carrito','favoritos','ordenes','facturas','pagos','extractos_bancarios','declaraciones_consignacion','retenciones'
  ] loop
    execute format('alter table public.%I alter column empresa_id set default public.empresa_activa_requerida()', t);
  end loop;
end $$;

alter table public.notificaciones alter column empresa_id set default public.empresa_activa();
alter table public.registros_clientes alter column empresa_id set default public.empresa_solicitada();

-- ── 3. Guardia de empresa ───────────────────────────────────────────────
-- Solo para usuarios autenticados (service_role, cron e importador no pasan por aquí).
create or replace function public.trg_guardia_empresa()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_rol text; v_emp uuid; v_activa uuid;
begin
  v_rol := coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '');
  if v_rol <> 'authenticated' then return coalesce(new, old); end if;

  if tg_op = 'UPDATE' and old.empresa_id is not null and old.empresa_id is distinct from new.empresa_id then
    raise exception 'No se puede cambiar la empresa de un registro.' using errcode = 'P0001';
  end if;

  v_emp := case when tg_op = 'DELETE' then old.empresa_id else new.empresa_id end;
  if v_emp is null then return coalesce(new, old); end if;   -- compartido (viene de Odoo)

  v_activa := public.empresa_activa();
  if v_activa is null then
    raise exception 'Modo consulta ("Ambas empresas"): selecciona GUDS o Quirutec en el menú superior para hacer cambios.'
      using errcode = 'P0001';
  end if;
  if v_emp <> v_activa then
    raise exception 'Este registro pertenece a otra empresa. Cámbiala en el menú superior.' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'productos','clientes','listas_precios','precios_lista','producto_empaques',
    'bancos','almacenes','inventario_almacen','movimientos_inventario',
    'cupones','banners','metas_vendedor','registros_clientes',
    'carrito','favoritos','ordenes','orden_items','entregas','facturas','factura_items',
    'pagos','pago_facturas','pago_ordenes','pago_cuentas','cuentas_cobrar',
    'movimientos_bancarios','extractos_bancarios','extracto_lineas',
    'declaraciones_consignacion','declaracion_consignacion_items','retenciones','retencion_items'
  ] loop
    execute format('drop trigger if exists z_guardia_empresa on public.%I', t);
    execute format('create trigger z_guardia_empresa before insert or update or delete on public.%I for each row execute function public.trg_guardia_empresa()', t);
  end loop;
end $$;

-- ── 4. Validación de referencias entre empresas ─────────────────────────
-- Argumentos: 'columna:tabla' … La referencia debe ser compartida (null) o de la misma empresa.
create or replace function public.trg_validar_refs_empresa()
returns trigger language plpgsql security definer set search_path = public as $$
declare i int; v_col text; v_tabla text; v_ref uuid; v_emp uuid; v_rol text;
begin
  v_rol := coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '');
  if v_rol <> 'authenticated' or new.empresa_id is null then return new; end if;
  for i in 0 .. tg_nargs - 1 loop
    v_col := split_part(tg_argv[i], ':', 1);
    v_tabla := split_part(tg_argv[i], ':', 2);
    v_ref := (to_jsonb(new) ->> v_col)::uuid;
    continue when v_ref is null;
    v_emp := null;
    execute format('select empresa_id from public.%I where id = $1', v_tabla) into v_emp using v_ref;
    if v_emp is not null and v_emp <> new.empresa_id then
      raise exception 'No se pueden mezclar empresas: el registro de % pertenece a otra empresa.', v_tabla using errcode = 'P0001';
    end if;
  end loop;
  return new;
end $$;

do $$
declare r record;
begin
  for r in select * from (values
    ('ordenes', array['cliente_id:clientes']),
    ('facturas', array['cliente_id:clientes', 'orden_id:ordenes']),
    ('pagos', array['cliente_id:clientes', 'orden_id:ordenes', 'banco_id:bancos']),
    ('retenciones', array['cliente_id:clientes']),
    ('declaraciones_consignacion', array['cliente_id:clientes', 'almacen_id:almacenes', 'factura_id:facturas']),
    ('orden_items', array['producto_id:productos']),
    ('factura_items', array['producto_id:productos']),
    ('carrito', array['producto_id:productos']),
    ('favoritos', array['producto_id:productos']),
    ('declaracion_consignacion_items', array['producto_id:productos']),
    ('precios_lista', array['producto_id:productos']),
    ('inventario_almacen', array['producto_id:productos']),
    ('pago_facturas', array['factura_id:facturas']),
    ('pago_ordenes', array['orden_id:ordenes']),
    ('retencion_items', array['factura_id:facturas']),
    ('extractos_bancarios', array['banco_id:bancos']),
    ('movimientos_bancarios', array['pago_id:pagos']),
    ('extracto_lineas', array['movimiento_bancario_id:movimientos_bancarios']),
    ('cuentas_cobrar', array['cliente_id:clientes']),
    ('clientes', array['lista_precios_id:listas_precios']),
    ('cupones', array['cliente_especifico_id:clientes'])
  ) as t(tabla, refs) loop
    execute format('drop trigger if exists z_validar_refs_empresa on public.%I', r.tabla);
    execute format('create trigger z_validar_refs_empresa before insert or update on public.%I for each row execute function public.trg_validar_refs_empresa(%s)',
      r.tabla, (select string_agg(quote_literal(x), ', ') from unnest(r.refs) x));
  end loop;
end $$;

-- ── 5. RLS restrictiva por empresa ──────────────────────────────────────
-- authenticated: empresas visibles (la activa, o todas las permitidas en "Ambas").
-- anon (tienda pública / registro): la empresa pedida en el header, o todo si no pide ninguna.
do $$
declare t text;
begin
  foreach t in array array[
    'productos','clientes','listas_precios','precios_lista','producto_empaques',
    'bancos','almacenes','inventario_almacen','movimientos_inventario',
    'cupones','banners','metas_vendedor','registros_clientes','notificaciones',
    'carrito','favoritos','ordenes','orden_items','entregas','facturas','factura_items',
    'pagos','pago_facturas','pago_ordenes','pago_cuentas','cuentas_cobrar',
    'movimientos_bancarios','extractos_bancarios','extracto_lineas',
    'declaraciones_consignacion','declaracion_consignacion_items','retenciones','retencion_items'
  ] loop
    execute format('drop policy if exists empresa_visible on public.%I', t);
    execute format('create policy empresa_visible on public.%I as restrictive for all to authenticated
      using (empresa_id is null or empresa_id = any ((select public.empresas_visibles())::uuid[]))', t);
    execute format('drop policy if exists empresa_visible_anon on public.%I', t);
    execute format('create policy empresa_visible_anon on public.%I as restrictive for all to anon
      using (empresa_id is null or public.empresa_solicitada() is null or empresa_id = public.empresa_solicitada())', t);
  end loop;
end $$;

-- ── 6. Unicidad por empresa ─────────────────────────────────────────────
-- (Odoo repite números entre empresas: 698 órdenes, 79 facturas, 899 pagos.)
alter table public.ordenes drop constraint if exists ordenes_numero_key;
alter table public.ordenes add constraint ordenes_empresa_numero_key unique (empresa_id, numero);
alter table public.pagos drop constraint if exists pagos_numero_key;
alter table public.pagos add constraint pagos_empresa_numero_key unique (empresa_id, numero);
alter table public.productos drop constraint if exists productos_sku_key;
alter table public.productos add constraint productos_empresa_sku_key unique nulls not distinct (empresa_id, sku);
alter table public.clientes drop constraint if exists clientes_codigo_key;
alter table public.clientes add constraint clientes_empresa_codigo_key unique nulls not distinct (empresa_id, codigo);
alter table public.cupones drop constraint if exists cupones_codigo_key;
alter table public.cupones add constraint cupones_empresa_codigo_key unique (empresa_id, codigo);
alter table public.metas_vendedor drop constraint if exists metas_vendedor_vendedor_id_mes_anio_key;
alter table public.metas_vendedor add constraint metas_vendedor_empresa_vendedor_mes_key unique (empresa_id, vendedor_id, mes, anio);
alter table public.carrito drop constraint if exists carrito_usuario_id_producto_id_key;
alter table public.carrito add constraint carrito_empresa_usuario_producto_key unique (empresa_id, usuario_id, producto_id);
alter table public.favoritos drop constraint if exists favoritos_usuario_id_producto_id_key;
alter table public.favoritos add constraint favoritos_empresa_usuario_producto_key unique (empresa_id, usuario_id, producto_id);

-- ── 7. Numeración por empresa ───────────────────────────────────────────
create or replace function public.siguiente_numero(p_empresa uuid, p_tipo text, p_ancho integer default 5)
returns text language plpgsql security definer set search_path = public as $$
declare v_n integer; v_pref text; v_emp uuid := coalesce(p_empresa, public.empresa_activa_requerida());
begin
  select prefijo into v_pref from empresas where id = v_emp;
  if v_pref is null then raise exception 'Empresa % no existe', v_emp; end if;
  insert into empresa_secuencias (empresa_id, tipo, ultimo) values (v_emp, p_tipo, 1)
  on conflict (empresa_id, tipo) do update set ultimo = empresa_secuencias.ultimo + 1
  returning ultimo into v_n;
  return v_pref || '-' || p_tipo || '-' || lpad(v_n::text, p_ancho, '0');
end $$;
revoke execute on function public.siguiente_numero(uuid, text, integer) from public, anon;
grant execute on function public.siguiente_numero(uuid, text, integer) to authenticated, service_role;

create or replace function public.generar_numero_orden()
returns text language plpgsql security definer set search_path = public as $$
begin
  return public.siguiente_numero(public.empresa_activa_requerida(), 'ORD', 5);
end $$;

create or replace function public.generar_numero_pago()
returns text language plpgsql security definer set search_path = public as $$
begin
  return public.siguiente_numero(public.empresa_activa_requerida(), 'PAG', 5);
end $$;

create or replace function public.generar_codigo_cliente()
returns text language plpgsql security definer set search_path = public as $$
begin
  return public.siguiente_numero(public.empresa_activa_requerida(), 'CLI', 5);
end $$;

create or replace function public.set_numero_orden()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.numero is null or new.numero = '' then
    new.numero := public.siguiente_numero(coalesce(new.empresa_id, public.empresa_activa_requerida()), 'ORD', 5);
  end if;
  return new;
end $$;

create or replace function public.set_numero_pago()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.numero is null or new.numero = '' then
    new.numero := public.siguiente_numero(coalesce(new.empresa_id, public.empresa_activa_requerida()), 'PAG', 5);
  end if;
  return new;
end $$;

-- ── 7b. Funciones existentes ajustadas (generado desde la foto de esquema 2026-09-27) ──
-- declarar_retencion: numeración por empresa
CREATE OR REPLACE FUNCTION public.declarar_retencion(p_cliente_id uuid, p_tipo text, p_items jsonb, p_concepto_islr_id uuid DEFAULT NULL::uuid, p_comprobante_url text DEFAULT NULL::text, p_numero text DEFAULT NULL::text, p_fecha date DEFAULT CURRENT_DATE, p_notas text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_usuario public.usuarios%rowtype;
  v_es_admin boolean;
  v_retencion_id uuid;
  v_numero text;
  v_base numeric := 0;
  v_porcentaje numeric;
  v_estado text;
  v_cliente_nombre text;
  r record;
begin
  select * into v_usuario from public.usuarios where auth_id = auth.uid();
  if not found then
    raise exception 'Usuario no encontrado';
  end if;

  v_es_admin := public.is_admin();

  if not v_es_admin then
    if v_usuario.role::text = 'cliente' then
      if v_usuario.cliente_id is distinct from p_cliente_id then
        raise exception 'No tenés acceso a este cliente';
      end if;
    elsif v_usuario.role::text = 'vendedor' then
      if p_cliente_id not in (select public.mis_clientes_vendedor()) then
        raise exception 'No tenés acceso a este cliente';
      end if;
    else
      raise exception 'No autorizado';
    end if;
  end if;

  if p_tipo not in ('iva','islr') then
    raise exception 'Tipo de retención inválido: %', p_tipo;
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Agregá al menos una factura afectada';
  end if;

  if p_tipo = 'islr' then
    if p_concepto_islr_id is null then
      raise exception 'Elegí el concepto de retención ISLR';
    end if;
    select porcentaje into v_porcentaje from public.conceptos_retencion_islr where id = p_concepto_islr_id;
  end if;

  v_numero := coalesce(p_numero, public.siguiente_numero(public.empresa_activa_requerida(), 'RET', 6));
  v_estado := case when v_es_admin then 'aprobado' else 'pendiente' end;

  insert into public.retenciones (
    numero, tipo, cliente_id, concepto_islr_id, porcentaje, fecha, comprobante_url,
    estado, declarado_por, rol_declarante, notas,
    revisado_por, revisado_en
  ) values (
    v_numero, p_tipo, p_cliente_id, p_concepto_islr_id, v_porcentaje, coalesce(p_fecha, current_date), p_comprobante_url,
    v_estado, v_usuario.id, case when v_es_admin then 'admin' else v_usuario.role::text end, p_notas,
    case when v_es_admin then v_usuario.id else null end, case when v_es_admin then now() else null end
  ) returning id into v_retencion_id;

  for r in
    select (x->>'factura_id')::uuid as factura_id, round(sum((x->>'monto')::numeric), 2) as monto
    from jsonb_array_elements(p_items) x
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
      if f.cliente_id is distinct from p_cliente_id then
        raise exception 'La factura % no pertenece a este cliente', f.numero;
      end if;
      if f.estado <> 'posted' or f.estado_pago = 'anulado' or f.tipo <> 'factura' then
        raise exception 'La factura % no admite retenciones', f.numero;
      end if;
      if r.monto > f.saldo_usd + 0.01 then
        raise exception 'La factura % solo tiene saldo $%', f.numero, f.saldo_usd;
      end if;

      insert into public.retencion_items (retencion_id, factura_id, monto_aplicado)
      values (v_retencion_id, r.factura_id, r.monto);
      v_base := v_base + r.monto;
    end;
  end loop;

  update public.retenciones set base_imponible = v_base, total = v_base where id = v_retencion_id;

  if v_estado = 'pendiente' then
    select nombre_negocio into v_cliente_nombre from public.clientes where id = p_cliente_id;
    perform public.notif_admins(
      'Retención por revisar',
      coalesce(v_cliente_nombre, 'Cliente') || ' declaró una retención de ' || upper(p_tipo) || ' por ' || public.fmt_usd(v_base),
      'alerta', '/admin/retenciones'
    );
  end if;

  return v_retencion_id;
end;
$function$;

-- declarar_venta_consignacion: numeración por empresa
CREATE OR REPLACE FUNCTION public.declarar_venta_consignacion(p_almacen_id uuid, p_items jsonb, p_notas text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_usuario public.usuarios%rowtype;
  v_almacen public.almacenes%rowtype;
  v_declaracion_id uuid;
  v_numero text;
  v_subtotal numeric := 0;
  v_iva_pct numeric;
  v_impuesto numeric;
  v_total numeric;
  v_cliente_nombre text;
  r record;
begin
  select * into v_usuario from public.usuarios where auth_id = auth.uid();
  if not found then
    raise exception 'Usuario no encontrado';
  end if;

  select * into v_almacen from public.almacenes where id = p_almacen_id;
  if not found then
    raise exception 'Almacén % no existe', p_almacen_id;
  end if;
  if v_almacen.tipo <> 'consignacion' or not coalesce(v_almacen.activo, true) then
    raise exception 'El almacén % no es de consignación o está inactivo', v_almacen.nombre;
  end if;

  -- Autorización
  if public.is_admin() then
    null; -- admin puede declarar sobre cualquier almacén de consignación
  elsif v_usuario.role::text = 'cliente' then
    if v_almacen.cliente_id is distinct from v_usuario.cliente_id then
      raise exception 'No tenés acceso a este almacén';
    end if;
  elsif v_usuario.role::text = 'vendedor' then
    if v_almacen.cliente_id is null or v_almacen.cliente_id not in (select public.mis_clientes_vendedor()) then
      raise exception 'No tenés acceso a este almacén';
    end if;
  else
    raise exception 'No autorizado';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Agregá al menos un producto vendido';
  end if;

  select coalesce(max(valor::numeric), 16) into v_iva_pct from public.configuracion where clave = 'iva_porcentaje';

  v_numero := public.siguiente_numero(public.empresa_activa_requerida(), 'DC', 6);

  insert into public.declaraciones_consignacion (
    numero, almacen_id, cliente_id, declarado_por, rol_declarante, notas
  ) values (
    v_numero, p_almacen_id, v_almacen.cliente_id, v_usuario.id,
    case when public.is_admin() then 'admin' else v_usuario.role::text end,
    p_notas
  ) returning id into v_declaracion_id;

  for r in
    select (x->>'producto_id')::uuid as producto_id, (x->>'cantidad')::numeric as cantidad
    from jsonb_array_elements(p_items) x
  loop
    declare
      v_disponible numeric;
      v_precio numeric;
      v_nombre text;
      v_sku text;
      v_sub numeric;
    begin
      if r.cantidad is null or r.cantidad <= 0 then
        raise exception 'Cantidad inválida para un producto declarado';
      end if;

      select ia.cantidad into v_disponible
      from public.inventario_almacen ia
      where ia.almacen_id = p_almacen_id and ia.producto_id = r.producto_id;

      select p.nombre, p.sku into v_nombre, v_sku from public.productos p where p.id = r.producto_id;

      if v_disponible is null or r.cantidad > v_disponible then
        raise exception 'Stock insuficiente de %: disponible %', coalesce(v_nombre, 'producto'), coalesce(v_disponible, 0);
      end if;

      v_precio := public.precio_efectivo(r.producto_id, null, v_almacen.cliente_id);
      v_sub := round(r.cantidad * v_precio, 2);
      v_subtotal := v_subtotal + v_sub;

      insert into public.declaracion_consignacion_items (
        declaracion_id, producto_id, nombre_producto, sku_producto, cantidad, precio_unitario, subtotal
      ) values (
        v_declaracion_id, r.producto_id, v_nombre, v_sku, r.cantidad, v_precio, v_sub
      );
    end;
  end loop;

  v_impuesto := round(v_subtotal * (v_iva_pct / 100.0), 2);
  v_total := v_subtotal + v_impuesto;

  update public.declaraciones_consignacion
  set subtotal = v_subtotal, impuesto = v_impuesto, total = v_total
  where id = v_declaracion_id;

  select nombre_negocio into v_cliente_nombre from public.clientes where id = v_almacen.cliente_id;
  perform public.notif_admins(
    'Declaración de consignación por revisar',
    coalesce(v_cliente_nombre, 'Cliente') || ' declaró ventas por ' || public.fmt_usd(v_total),
    'alerta', '/admin/consignacion'
  );

  return v_declaracion_id;
end;
$function$;

-- facturar_orden: numeración por empresa
CREATE OR REPLACE FUNCTION public.facturar_orden(p_orden_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_numero := public.siguiente_numero(public.empresa_activa_requerida(), 'F', 6);

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
$function$;

-- revisar_declaracion_consignacion: numeración por empresa
CREATE OR REPLACE FUNCTION public.revisar_declaracion_consignacion(p_declaracion_id uuid, p_aprobar boolean, p_notas text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_admin uuid;
  d public.declaraciones_consignacion%rowtype;
  v_dias_credito int;
  v_numero_factura text;
  v_factura_id uuid;
  r record;
  v_disponible numeric;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede revisar declaraciones';
  end if;
  select id into v_admin from public.usuarios where auth_id = auth.uid();

  select * into d from public.declaraciones_consignacion where id = p_declaracion_id;
  if not found then
    raise exception 'Declaración % no existe', p_declaracion_id;
  end if;
  if d.estado <> 'pendiente' then
    raise exception 'La declaración ya fue %', d.estado;
  end if;

  if not p_aprobar then
    update public.declaraciones_consignacion
    set estado = 'rechazado', revisado_por = v_admin, revisado_en = now(), notas = coalesce(p_notas, notas)
    where id = p_declaracion_id;
    return jsonb_build_object('estado', 'rechazado');
  end if;

  -- Re-valida stock (pudo cambiar desde que se declaró) y descuenta.
  for r in select * from public.declaracion_consignacion_items where declaracion_id = p_declaracion_id loop
    select ia.cantidad into v_disponible from public.inventario_almacen ia
    where ia.almacen_id = d.almacen_id and ia.producto_id = r.producto_id;
    if v_disponible is null or r.cantidad > v_disponible then
      raise exception 'Stock insuficiente de %: disponible % (cambió desde que se declaró)', coalesce(r.nombre_producto, 'producto'), coalesce(v_disponible, 0);
    end if;
  end loop;

  update public.inventario_almacen ia
  set cantidad = ia.cantidad - item.cantidad
  from public.declaracion_consignacion_items item
  where item.declaracion_id = p_declaracion_id
    and ia.almacen_id = d.almacen_id and ia.producto_id = item.producto_id;

  select coalesce(dias_credito, 0) into v_dias_credito from public.clientes where id = d.cliente_id;
  v_numero_factura := public.siguiente_numero(public.empresa_activa_requerida(), 'F', 6);

  insert into public.facturas (
    numero, tipo, cliente_id, orden_id, fecha_emision, fecha_vencimiento,
    moneda, subtotal, impuesto, total, total_usd, saldo_odoo_usd,
    estado_pago, estado, referencia, creada_en_guds
  ) values (
    v_numero_factura, 'factura', d.cliente_id, null, current_date, current_date + v_dias_credito,
    'USD', d.subtotal, d.impuesto, d.total, d.total, d.total,
    'pendiente', 'posted', d.numero, true
  ) returning id into v_factura_id;

  insert into public.factura_items (factura_id, producto_id, nombre_producto, sku_producto, cantidad, precio_unitario, subtotal, total)
  select v_factura_id, producto_id, nombre_producto, sku_producto, cantidad, precio_unitario, subtotal, subtotal
  from public.declaracion_consignacion_items
  where declaracion_id = p_declaracion_id;

  update public.declaraciones_consignacion
  set estado = 'aprobado', factura_id = v_factura_id, revisado_por = v_admin, revisado_en = now(), notas = coalesce(p_notas, notas)
  where id = p_declaracion_id;

  perform public.notif_cliente(d.cliente_id, 'Declaración de consignación aprobada',
    'Se generó la factura ' || v_numero_factura || ' por ' || public.fmt_usd(d.total), 'exito', '/portal/consignacion');
  perform public.notif_vendedor(d.cliente_id, 'Declaración de consignación aprobada',
    'Factura ' || v_numero_factura || ' · ' || public.fmt_usd(d.total), 'exito', '/vendedor/consignacion');

  return jsonb_build_object('factura_id', v_factura_id, 'numero', v_numero_factura);
end;
$function$;

-- crear_orden_desde_carrito: solo toma el carrito de la empresa activa
CREATE OR REPLACE FUNCTION public.crear_orden_desde_carrito(p_metodo_pago pago_metodo, p_notas text DEFAULT ''::text, p_cupon_id uuid DEFAULT NULL::uuid, p_comprobante_url text DEFAULT NULL::text, p_referencia text DEFAULT NULL::text, p_banco_id uuid DEFAULT NULL::uuid, p_moneda text DEFAULT 'USD'::text, p_tasa numeric DEFAULT NULL::numeric)
 RETURNS TABLE(orden_id uuid, numero character varying, total numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_usuario_id uuid; v_cliente_id uuid;
  v_subtotal numeric := 0; v_descuento numeric := 0;
  v_iva_pct numeric; v_costo_envio numeric; v_envio_gratis_min numeric;
  v_base numeric; v_impuesto numeric; v_envio numeric; v_total numeric;
  v_orden_id uuid; v_numero varchar; v_cupon record; v_items integer;
  v_limite numeric; v_utilizado numeric; v_moneda text := upper(coalesce(p_moneda,'USD'));
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select id, cliente_id into v_usuario_id, v_cliente_id from usuarios where auth_id = v_uid;
  if v_usuario_id is null then raise exception 'Usuario no encontrado'; end if;
  if v_cliente_id is null then raise exception 'El usuario no tiene un cliente asociado'; end if;

  select count(*) into v_items from carrito where usuario_id = v_usuario_id and empresa_id = public.empresa_activa_requerida();
  if v_items = 0 then raise exception 'El carrito esta vacio'; end if;

  select coalesce(sum(public.precio_efectivo(c.producto_id, c.tipo_empaque_id, v_cliente_id) * c.cantidad), 0)
    into v_subtotal from carrito c where c.usuario_id = v_usuario_id and c.empresa_id = public.empresa_activa_requerida();

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

  if p_metodo_pago = 'credito' then
    select limite_credito, credito_utilizado into v_limite, v_utilizado from clientes where id = v_cliente_id;
    if coalesce(v_utilizado,0) + v_total > coalesce(v_limite,0) then
      raise exception 'Crédito insuficiente: disponible %, requerido %',
        coalesce(v_limite,0) - coalesce(v_utilizado,0), v_total; end if;
  end if;

  v_numero := generar_numero_orden();

  insert into ordenes (numero, cliente_id, usuario_id, subtotal, descuento, impuesto, envio, total, estado, metodo_pago, notas, comprobante_url, referencia_pago)
  values (v_numero, v_cliente_id, v_usuario_id, v_subtotal, v_descuento, v_impuesto, v_envio, v_total, 'pendiente', p_metodo_pago, coalesce(p_notas,''), p_comprobante_url, p_referencia)
  returning id into v_orden_id;

  insert into orden_items (orden_id, producto_id, cantidad, precio_unitario, descuento, subtotal)
  select v_orden_id, c.producto_id, c.cantidad,
         public.precio_efectivo(c.producto_id, c.tipo_empaque_id, v_cliente_id), 0,
         public.precio_efectivo(c.producto_id, c.tipo_empaque_id, v_cliente_id) * c.cantidad
  from carrito c where c.usuario_id = v_usuario_id and c.empresa_id = public.empresa_activa_requerida();

  if p_cupon_id is not null then
    update cupones set usos_actuales = usos_actuales + 1 where id = p_cupon_id;
  end if;

  -- Pago 'pendiente' cuando el checkout llevó comprobante (entra a la cola admin),
  -- con el banco destino y la moneda que indicó el cliente.
  if p_comprobante_url is not null then
    insert into pagos (cliente_id, orden_id, monto, monto_moneda, moneda, tasa_cambio, banco_id, metodo, referencia, comprobante_url, estado)
    values (
      v_cliente_id, v_orden_id, v_total,
      case when v_moneda = 'BS' and coalesce(p_tasa,0) > 0 then round(v_total * p_tasa, 2) else v_total end,
      v_moneda,
      case when v_moneda = 'BS' then p_tasa else null end,
      p_banco_id, p_metodo_pago, p_referencia, p_comprobante_url, 'pendiente'
    );
  end if;

  delete from carrito where usuario_id = v_usuario_id and empresa_id = public.empresa_activa_requerida();
  return query select v_orden_id, v_numero, v_total;
end;
$function$;


commit;
