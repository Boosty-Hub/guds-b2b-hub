-- ════════════════════════════════════════════════════════════════════════
-- Fase 22b · La venta en consignación aprobada se convierte en un PEDIDO que va a Odoo (decisión del dueño, 8-oct)
--   "La consignación, al ser aprobada, debe crear la orden en Odoo como si fuese una orden, y en Odoo sigue el proceso hasta
--    convertirse en factura."
--   Antes: revisar_declaracion_consignacion descontaba inventario_almacen en GUDS y creaba una FACTURA INTERNA (F-…) que no
--   existía en Odoo. Ahora, al aprobar:
--     1. Se crea un pedido en `ordenes` (+ ítems) con los productos, cantidades y precios declarados, aprobado por quien revisa,
--        enlazado a la declaración (declaraciones_consignacion.orden_id) y con el almacén de salida (ordenes.almacen_id = el
--        almacén de consignación del cliente).
--     2. El pedido sigue el flujo de envío de la fase 9b/19g: trigger → pg_net → sync-odoo?enviar=<id> → enviar.js crea la
--        cotización en borrador en Odoo con warehouse_id = ese almacén de consignación (así lo hace hoy el equipo en Odoo:
--        sale.order con el almacén "X-CONSIGNADO <cliente>", entrega C-xx/OUT desde C-xx/Existencias).
--     3. En Odoo se confirma, se valida la entrega y se factura; la sincronización trae el estado, baja el inventario del
--        almacén y enlaza la factura al pedido (facturas.orden_id). GUDS ya NO descuenta stock ni crea factura interna.
--   Stock comprometido de consignación: mientras la declaración está por revisar o su pedido aún no está confirmado en Odoo
--   (Odoo todavía no reservó), esas unidades no se pueden volver a declarar:
--     disponible = existencia (Odoo) − reservado (Odoo) − declarado en GUDS sin confirmar en Odoo.
--   Los pedidos de consignación no comprometen el stock de los almacenes propios (productos.comprometido_guds).
-- ════════════════════════════════════════════════════════════════════════
begin;

-- ── 1. Enlaces ───────────────────────────────────────────────────────────
alter table public.ordenes add column if not exists almacen_id uuid references public.almacenes(id) on delete set null;
comment on column public.ordenes.almacen_id is
  'Almacén de Odoo desde el que sale el pedido (22b): el de consignación del cliente en las ventas declaradas; null = almacén general (P-01)';
create index if not exists ordenes_almacen_idx on public.ordenes(almacen_id) where almacen_id is not null;

alter table public.declaraciones_consignacion add column if not exists orden_id uuid references public.ordenes(id) on delete set null;
alter table public.declaraciones_consignacion drop constraint if exists declaraciones_consignacion_orden_id_key;
alter table public.declaraciones_consignacion add constraint declaraciones_consignacion_orden_id_key unique (orden_id);
comment on column public.declaraciones_consignacion.orden_id is
  'Pedido creado al aprobar la declaración (22b); va a Odoo como cotización desde el almacén de consignación y allí se factura';
comment on column public.declaraciones_consignacion.factura_id is
  'Factura interna de GUDS: solo en declaraciones aprobadas antes de la fase 22b (desde 22b la factura viene de Odoo por el pedido)';
comment on table public.declaraciones_consignacion is
  'Declaración de ventas del inventario en consignación (cliente/vendedor/admin). Al aprobarse crea un pedido que va a Odoo desde el almacén de consignación (22b).';

-- Sin mezclar empresas en los enlaces nuevos
drop trigger if exists z_validar_refs_empresa on public.ordenes;
create trigger z_validar_refs_empresa before insert or update on public.ordenes for each row
  execute function public.trg_validar_refs_empresa('cliente_id:clientes', 'almacen_id:almacenes');
drop trigger if exists z_validar_refs_empresa on public.declaraciones_consignacion;
create trigger z_validar_refs_empresa before insert or update on public.declaraciones_consignacion for each row
  execute function public.trg_validar_refs_empresa('cliente_id:clientes', 'almacen_id:almacenes', 'factura_id:facturas', 'orden_id:ordenes');

-- El almacén de salida lo fija solo administración (o el sistema): un pedido del portal no puede salir de otro almacén
create or replace function public.trg_orden_almacen_guardia() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.es_llamada_no_admin() then
    if tg_op = 'INSERT' then
      new.almacen_id := null;
    elsif new.almacen_id is distinct from old.almacen_id then
      raise exception 'El almacén de salida del pedido solo lo gestiona administración' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.trg_orden_almacen_guardia() from public, anon, authenticated;
drop trigger if exists b_orden_almacen_guardia on public.ordenes;
create trigger b_orden_almacen_guardia before insert or update of almacen_id on public.ordenes
  for each row execute function public.trg_orden_almacen_guardia();

-- La revisión (estado, pedido, factura, montos) solo cambia por las funciones de declarar y revisar, no por la API directa
create or replace function public.trg_declaracion_consignacion_guardia() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '') in ('authenticated', 'anon')
     and coalesce(current_setting('guds.revision_consignacion', true), '') <> 'on'
     and (new.estado, new.orden_id, new.factura_id, new.revisado_por, new.revisado_en, new.subtotal, new.impuesto, new.total,
          new.cliente_id, new.almacen_id)
         is distinct from
         (old.estado, old.orden_id, old.factura_id, old.revisado_por, old.revisado_en, old.subtotal, old.impuesto, old.total,
          old.cliente_id, old.almacen_id) then
    raise exception 'Las declaraciones de consignación se aprueban o rechazan desde Consignación (no se editan directamente)' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.trg_declaracion_consignacion_guardia() from public, anon, authenticated;
drop trigger if exists b_declaracion_consignacion_guardia on public.declaraciones_consignacion;
create trigger b_declaracion_consignacion_guardia before update on public.declaraciones_consignacion
  for each row execute function public.trg_declaracion_consignacion_guardia();

-- ── 2. Stock comprometido de consignación ────────────────────────────────
-- Unidades declaradas en GUDS que Odoo todavía no reservó: declaraciones por revisar y aprobadas cuyo pedido no está
-- confirmado en Odoo (sin enviar, o cotización en borrador). Al confirmarse en Odoo la entrega reserva (inventario_almacen.
-- reservado) y al validarse baja la existencia: ahí deja de contar aquí. `p_excluir` = la declaración que se está validando.
create or replace function public.consignacion_comprometido(p_almacen_id uuid, p_excluir uuid default null)
returns table(producto_id uuid, cantidad numeric)
language sql stable security definer set search_path = public as $$
  select i.producto_id, sum(i.cantidad)
  from public.declaraciones_consignacion d
  join public.declaracion_consignacion_items i on i.declaracion_id = d.id
  left join public.ordenes o on o.id = d.orden_id
  where d.almacen_id = p_almacen_id
    and d.id is distinct from p_excluir
    and i.producto_id is not null
    and (d.estado = 'pendiente'
         or (d.estado = 'aprobado' and d.orden_id is not null and o.estado <> 'cancelado'
             and (o.odoo_id is null or coalesce(o.estado_odoo, 'draft') in ('draft', 'sent'))))
  group by i.producto_id
$$;
revoke execute on function public.consignacion_comprometido(uuid, uuid) from public, anon, authenticated;

-- Disponible para declarar en un almacén de consignación (portal del cliente, del vendedor y admin)
create or replace function public.consignacion_disponible(p_almacen_id uuid)
returns table(producto_id uuid, nombre text, sku text, cantidad numeric, reservado numeric, comprometido numeric, disponible numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare a public.almacenes%rowtype;
begin
  select * into a from public.almacenes where id = p_almacen_id;
  if not found or a.tipo <> 'consignacion' then raise exception 'Almacén de consignación no encontrado' using errcode = 'P0001'; end if;
  if not (a.empresa_id is null or a.empresa_id = any (public.empresas_visibles())) then
    raise exception 'Este almacén pertenece a otra empresa' using errcode = '42501';
  end if;
  if not ((public.is_admin() and (select public.puede('inventario', 'ver')))
          or (a.cliente_id is not null and a.cliente_id = any (public.clientes_del_usuario()))
          or (a.cliente_id is not null and a.cliente_id in (select public.mis_clientes_vendedor()))) then
    raise exception 'No tienes acceso a este almacén' using errcode = '42501';
  end if;
  return query
    select ia.producto_id, p.nombre::text, p.sku::text, ia.cantidad, coalesce(ia.reservado, 0), coalesce(c.cantidad, 0),
           greatest(ia.cantidad - coalesce(ia.reservado, 0) - coalesce(c.cantidad, 0), 0)
    from public.inventario_almacen ia
    join public.productos p on p.id = ia.producto_id
    left join public.consignacion_comprometido(p_almacen_id) c on c.producto_id = ia.producto_id
    where ia.almacen_id = p_almacen_id and ia.cantidad > 0
    order by p.nombre;
end $$;
revoke execute on function public.consignacion_disponible(uuid) from public, anon;
grant execute on function public.consignacion_disponible(uuid) to authenticated;

-- Los pedidos de consignación salen del almacén del cliente, no comprometen el stock de los almacenes propios
create or replace function public.recalcular_comprometido_guds(p_productos uuid[])
returns void language sql security definer set search_path = public as $$
  update productos p set comprometido_guds = s.u
  from (select x.pid, coalesce((select sum(oi.cantidad * oi.unidades_por_empaque) from orden_items oi join ordenes o on o.id = oi.orden_id
                                where oi.producto_id = x.pid and o.odoo_id is null and o.estado <> 'cancelado'
                                  and not exists (select 1 from almacenes a where a.id = o.almacen_id and a.tipo = 'consignacion')), 0) u
        from unnest(p_productos) as x(pid)) s
  where p.id = s.pid and p.comprometido_guds is distinct from s.u
$$;

-- ── 3. Declarar: valida contra lo disponible (no contra la existencia bruta) y en unidades enteras ─
create or replace function public.declarar_venta_consignacion(p_almacen_id uuid, p_items jsonb, p_notas text default null::text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_usuario public.usuarios%rowtype;
  v_almacen public.almacenes%rowtype;
  v_declaracion_id uuid;
  v_numero text;
  v_subtotal numeric := 0;
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
    if v_almacen.cliente_id is null or not (v_almacen.cliente_id = any (public.clientes_del_usuario())) then
      raise exception 'No tenés acceso a este almacén';
    end if;
  elsif v_usuario.role::text = 'vendedor' then
    if v_almacen.cliente_id is null or v_almacen.cliente_id not in (select public.mis_clientes_vendedor()) then
      raise exception 'No tenés acceso a este almacén';
    end if;
  else
    raise exception 'No autorizado';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Agregá al menos un producto vendido';
  end if;

  v_numero := public.siguiente_numero(public.empresa_activa_requerida(), 'DC', 6);

  insert into public.declaraciones_consignacion (
    numero, almacen_id, cliente_id, declarado_por, rol_declarante, notas
  ) values (
    v_numero, p_almacen_id, v_almacen.cliente_id, v_usuario.id,
    case when public.is_admin() then 'admin' else v_usuario.role::text end,
    p_notas
  ) returning id into v_declaracion_id;

  -- Un producto repetido en la lista se suma (se valida el total contra lo disponible)
  for r in
    select (x->>'producto_id')::uuid as producto_id, sum((x->>'cantidad')::numeric) as cantidad, bool_or((x->>'cantidad') is null) sin_cantidad
    from jsonb_array_elements(p_items) x
    group by 1
  loop
    declare
      v_disponible numeric;
      v_precio numeric;
      v_nombre text;
      v_sku text;
      v_sub numeric;
    begin
      if r.sin_cantidad or r.cantidad is null or r.cantidad <= 0 then
        raise exception 'Cantidad inválida para un producto declarado';
      end if;
      if r.cantidad <> trunc(r.cantidad) then
        raise exception 'Las cantidades se declaran en unidades enteras';
      end if;

      select p.nombre, p.sku into v_nombre, v_sku from public.productos p where p.id = r.producto_id;

      -- Disponible = existencia (Odoo) − reservado (Odoo) − declarado en GUDS que Odoo aún no reservó (22b)
      select ia.cantidad - coalesce(ia.reservado, 0)
             - coalesce((select c.cantidad from public.consignacion_comprometido(p_almacen_id, v_declaracion_id) c where c.producto_id = r.producto_id), 0)
        into v_disponible
      from public.inventario_almacen ia
      where ia.almacen_id = p_almacen_id and ia.producto_id = r.producto_id;

      if v_disponible is null or r.cantidad > v_disponible then
        raise exception 'Stock insuficiente de %: disponible % (descontando lo reservado en Odoo y lo ya declarado)',
          coalesce(v_nombre, 'producto'), greatest(coalesce(v_disponible, 0), 0);
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

  -- IVA de cada producto (Odoo), por grupo de tasa como Odoo (fase 20c)
  select coalesce(sum(round(g.base * g.pct / 100.0, 2)), 0) into v_impuesto
  from (select public.impuesto_producto(i.producto_id) pct, sum(i.subtotal) base
        from public.declaracion_consignacion_items i where i.declaracion_id = v_declaracion_id group by 1) g;
  v_total := v_subtotal + v_impuesto;

  perform set_config('guds.revision_consignacion', 'on', true);
  update public.declaraciones_consignacion
  set subtotal = v_subtotal, impuesto = v_impuesto, total = v_total
  where id = v_declaracion_id;
  perform set_config('guds.revision_consignacion', 'off', true);

  select nombre_negocio into v_cliente_nombre from public.clientes where id = v_almacen.cliente_id;
  perform public.notif_admins(
    'Declaración de consignación por revisar',
    coalesce(v_cliente_nombre, 'Cliente') || ' declaró ventas por ' || public.fmt_usd(v_total),
    'alerta', '/admin/consignacion'
  );

  return v_declaracion_id;
end $$;

-- ── 4. Revisar: aprobar = crear el pedido que va a Odoo (sin factura interna ni descuento de stock en GUDS) ─
create or replace function public.revisar_declaracion_consignacion(p_declaracion_id uuid, p_aprobar boolean, p_notas text default null::text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid;
  d public.declaraciones_consignacion%rowtype;
  a public.almacenes%rowtype;
  v_cliente text;
  v_vendedor uuid;
  v_orden_id uuid;
  v_numero text;
  v_total numeric;
  r record;
  v_disponible numeric;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede revisar declaraciones';
  end if;
  select id into v_admin from public.usuarios where auth_id = auth.uid();

  select * into d from public.declaraciones_consignacion where id = p_declaracion_id for update;
  if not found then
    raise exception 'Declaración % no existe', p_declaracion_id;
  end if;
  if d.estado <> 'pendiente' then
    raise exception 'La declaración ya fue %', d.estado;
  end if;

  perform set_config('guds.revision_consignacion', 'on', true);

  if not p_aprobar then
    update public.declaraciones_consignacion
    set estado = 'rechazado', revisado_por = v_admin, revisado_en = now(), notas = coalesce(p_notas, notas)
    where id = p_declaracion_id;
    perform set_config('guds.revision_consignacion', 'off', true);
    return jsonb_build_object('estado', 'rechazado');
  end if;

  select * into a from public.almacenes where id = d.almacen_id;
  if a.odoo_id is null then
    raise exception 'El almacén % no está enlazado a Odoo: no se puede crear el pedido', a.nombre;
  end if;
  if not coalesce(a.activo, true) then
    raise exception 'El almacén % está inactivo', a.nombre;
  end if;
  if exists (select 1 from public.declaracion_consignacion_items i where i.declaracion_id = d.id and (i.cantidad <> trunc(i.cantidad) or i.producto_id is null)) then
    raise exception 'La declaración tiene cantidades no enteras o productos sin enlazar: rechazala y que se declare de nuevo';
  end if;

  -- Re-valida lo disponible (pudo cambiar desde que se declaró). El stock NO se descuenta aquí: baja cuando Odoo valida la entrega.
  for r in
    select i.producto_id, max(i.nombre_producto) nombre, sum(i.cantidad) cantidad
    from public.declaracion_consignacion_items i where i.declaracion_id = d.id group by 1
  loop
    select ia.cantidad - coalesce(ia.reservado, 0)
           - coalesce((select c.cantidad from public.consignacion_comprometido(d.almacen_id, d.id) c where c.producto_id = r.producto_id), 0)
      into v_disponible
    from public.inventario_almacen ia
    where ia.almacen_id = d.almacen_id and ia.producto_id = r.producto_id;
    if v_disponible is null or r.cantidad > v_disponible then
      raise exception 'Stock insuficiente de %: disponible % (cambió desde que se declaró)', coalesce(r.nombre, 'producto'), greatest(coalesce(v_disponible, 0), 0);
    end if;
  end loop;

  select c.nombre_negocio, case when d.rol_declarante = 'vendedor' then d.declarado_por else c.vendedor_asignado_id end
    into v_cliente, v_vendedor
  from public.clientes c where c.id = d.cliente_id;

  -- Pedido aprobado por quien revisa: el trigger y_orden_enviar_si_aprobada lo envía a Odoo al confirmar la transacción
  insert into public.ordenes (
    empresa_id, cliente_id, usuario_id, vendedor_id, almacen_id, subtotal, descuento, impuesto, envio, total, estado,
    metodo_pago, notas, aprobacion, aprobado_por, aprobado_at
  ) values (
    d.empresa_id, d.cliente_id, coalesce(d.declarado_por, v_admin), v_vendedor, d.almacen_id, d.subtotal, 0, d.impuesto, 0, d.total,
    'pendiente', 'credito',
    'Venta en consignación ' || d.numero || ' · ' || a.nombre || coalesce(' · ' || nullif(trim(d.notas), ''), ''),
    'aprobada', v_admin, now()
  ) returning id, numero into v_orden_id, v_numero;

  insert into public.orden_items (orden_id, producto_id, cantidad, precio_unitario, descuento, subtotal, nombre_producto, sku_producto,
    tipo_empaque_id, unidades_por_empaque)
  select v_orden_id, i.producto_id, i.cantidad::int, i.precio_unitario, 0, i.subtotal, i.nombre_producto, i.sku_producto, null, 1
  from public.declaracion_consignacion_items i
  where i.declaracion_id = d.id
  order by i.created_at, i.id;
  v_total := coalesce(public.aplicar_impuestos_orden(v_orden_id), d.total);

  update public.declaraciones_consignacion
  set estado = 'aprobado', orden_id = v_orden_id, revisado_por = v_admin, revisado_en = now(), notas = coalesce(p_notas, notas)
  where id = p_declaracion_id;
  perform set_config('guds.revision_consignacion', 'off', true);

  perform public.notif_admins('Pedido de consignación ' || v_numero,
    coalesce(v_cliente, 'Cliente') || ' · ' || public.fmt_usd(v_total) || ' · declaración ' || d.numero || ' aprobada; se está creando en Odoo',
    'orden', '/admin/ordenes?orden=' || v_orden_id);
  perform public.notif_cliente(d.cliente_id, 'Declaración de consignación aprobada',
    'Tu declaración ' || d.numero || ' generó el pedido ' || v_numero || ' por ' || public.fmt_usd(v_total)
      || '. La factura te llegará cuando se procese.', 'exito', '/portal/consignacion');
  perform public.notif_vendedor(d.cliente_id, 'Declaración de consignación aprobada',
    coalesce(v_cliente, 'Cliente') || ': ' || d.numero || ' → pedido ' || v_numero || ' · ' || public.fmt_usd(v_total), 'exito', '/vendedor/consignacion');

  return jsonb_build_object('estado', 'aprobado', 'orden_id', v_orden_id, 'numero', v_numero, 'total', v_total,
    'mensaje', 'Pedido ' || v_numero || ' creado; se está enviando a Odoo como cotización desde ' || a.nombre);
end $$;

-- ── 5. Avisos: el pedido de una consignación los da la revisión (sin el "Pedido recibido" genérico duplicado) ─
create or replace function public.trg_orden_creada() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_cli text; v_pend boolean := coalesce(new.aprobacion, '') = 'pendiente';
begin
  if new.almacen_id is not null and exists (select 1 from almacenes a where a.id = new.almacen_id and a.tipo = 'consignacion') then
    return new;   -- venta en consignación aprobada (22b): revisar_declaracion_consignacion avisa al admin, al cliente y al vendedor
  end if;
  select nombre_negocio into v_cli from clientes where id = new.cliente_id;
  perform notif_admins(case when v_pend then 'Pedido por aprobar ' else 'Nueva orden ' end || new.numero,
    coalesce(v_cli, 'Cliente') || ' · ' || fmt_usd(new.total), case when v_pend then 'alerta' else 'orden' end, '/admin/ordenes?aprobacion=pendiente');
  perform notif_cliente(new.cliente_id, 'Pedido recibido',
    'Tu pedido ' || new.numero || ' por ' || fmt_usd(new.total) || case when v_pend then ' fue recibido y está pendiente de aprobación.' else ' fue registrado.' end,
    'orden', '/portal/pedidos');
  if new.vendedor_id is null then
    perform notif_vendedor(new.cliente_id, 'Tu cliente hizo un pedido', coalesce(v_cli, 'Cliente') || ': ' || new.numero || ' por ' || fmt_usd(new.total), 'orden', '/vendedor/pedidos');
  end if;
  return new;
end $$;

-- ── 6. facturar_orden no factura internamente un pedido de consignación (se factura en Odoo) ─
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.facturar_orden(uuid)'::regprocedure);
  n := replace(d, E'  if o.estado = ''cancelado'' then',
    E'  if o.almacen_id is not null and exists (select 1 from public.almacenes a where a.id = o.almacen_id and a.tipo = ''consignacion'') then\n'
    || E'    raise exception ''El pedido % es una venta en consignación: se factura en Odoo y la factura llega con la sincronización'', o.numero;\n'
    || E'  end if;\n'
    || E'  if o.estado = ''cancelado'' then');
  if n = d then raise exception 'facturar_orden cambió: no se encontró dónde agregar la guardia de consignación'; end if;
  execute n;
end $$;

notify pgrst, 'reload schema';

commit;
