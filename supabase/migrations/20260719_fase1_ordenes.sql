-- =====================================================================
-- GUDS · FASE 1 — Desbloquear el nucleo transaccional
-- Fecha: 2026-07-19
-- Decisiones aplicadas: P5 IVA +16% desde configuracion; P8 estado 'confirmado'.
-- NOTA: el 'ALTER TYPE ... ADD VALUE confirmado' se ejecuta por separado
--       (no puede ir en la misma transaccion que lo usa).
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1) Marca de idempotencia para el descuento de stock.
-- ---------------------------------------------------------------------
alter table public.ordenes add column if not exists stock_descontado boolean not null default false;

-- ---------------------------------------------------------------------
-- 2) Trigger de stock idempotente y reversible.
--    Descuenta al entrar a procesando/enviado/completado (una sola vez).
--    Repone si se cancela una orden que ya habia descontado.
--    BEFORE UPDATE para poder persistir NEW.stock_descontado.
-- ---------------------------------------------------------------------
create or replace function public.actualizar_stock_orden()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
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
$fn$;

drop trigger if exists trigger_actualizar_stock_orden on public.ordenes;
create trigger trigger_actualizar_stock_orden
  before update on public.ordenes
  for each row execute function public.actualizar_stock_orden();

-- ---------------------------------------------------------------------
-- 3) Auto-numero: BEFORE INSERT rellena 'numero' si viene null.
--    Hace robusto cualquier INSERT directo (admin, portal) sin duplicar logica.
-- ---------------------------------------------------------------------
create or replace function public.set_numero_orden()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.numero is null or new.numero = '' then
    new.numero := public.generar_numero_orden();
  end if;
  return new;
end; $fn$;
drop trigger if exists trg_set_numero_orden on public.ordenes;
create trigger trg_set_numero_orden before insert on public.ordenes
  for each row execute function public.set_numero_orden();

create or replace function public.set_numero_pago()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.numero is null or new.numero = '' then
    new.numero := public.generar_numero_pago();
  end if;
  return new;
end; $fn$;
drop trigger if exists trg_set_numero_pago on public.pagos;
create trigger trg_set_numero_pago before insert on public.pagos
  for each row execute function public.set_numero_pago();

-- ---------------------------------------------------------------------
-- 4) RPC atomica: crear orden desde el carrito del cliente autenticado.
--    Calcula subtotal (desde carrito.precio_unitario), descuento (cupon),
--    IVA e envio leidos de 'configuracion'. Inserta orden + items y vacia
--    el carrito en UNA transaccion. SECURITY DEFINER: pasa por encima de RLS.
-- ---------------------------------------------------------------------
create or replace function public.crear_orden_desde_carrito(
  p_metodo_pago pago_metodo,
  p_notas text default '',
  p_cupon_id uuid default null
) returns table(orden_id uuid, numero varchar, total numeric)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_usuario_id uuid;
  v_cliente_id uuid;
  v_subtotal numeric := 0;
  v_descuento numeric := 0;
  v_iva_pct numeric;
  v_costo_envio numeric;
  v_envio_gratis_min numeric;
  v_base numeric;
  v_impuesto numeric;
  v_envio numeric;
  v_total numeric;
  v_orden_id uuid;
  v_numero varchar;
  v_cupon record;
  v_items integer;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select id, cliente_id into v_usuario_id, v_cliente_id
  from usuarios where auth_id = v_uid;

  if v_usuario_id is null then
    raise exception 'Usuario no encontrado';
  end if;
  if v_cliente_id is null then
    raise exception 'El usuario no tiene un cliente asociado';
  end if;

  select count(*), coalesce(sum(precio_unitario * cantidad), 0)
    into v_items, v_subtotal
  from carrito where usuario_id = v_usuario_id;

  if v_items = 0 then
    raise exception 'El carrito esta vacio';
  end if;

  -- Cupon (validacion completa: Fase 4; aqui solo tipo/valor si existe y esta vigente)
  if p_cupon_id is not null then
    select * into v_cupon from cupones
    where id = p_cupon_id and activo = true
      and (fecha_fin is null or fecha_fin >= current_date);
    if found then
      v_descuento := case
        when v_cupon.tipo = 'porcentaje' then round(v_subtotal * (v_cupon.valor / 100.0), 2)
        else least(v_cupon.valor, v_subtotal)
      end;
    end if;
  end if;

  -- Config de negocio (con defaults sensatos si falta la clave)
  select coalesce(max(case when clave = 'iva_porcentaje' then valor::numeric end), 16),
         coalesce(max(case when clave = 'costo_envio' then valor::numeric end), 50),
         coalesce(max(case when clave = 'envio_gratis_minimo' then valor::numeric end), 500)
    into v_iva_pct, v_costo_envio, v_envio_gratis_min
  from configuracion
  where clave in ('iva_porcentaje','costo_envio','envio_gratis_minimo');

  v_base     := v_subtotal - v_descuento;
  v_impuesto := round(v_base * (v_iva_pct / 100.0), 2);
  v_envio    := case when v_base >= v_envio_gratis_min then 0 else v_costo_envio end;
  v_total    := v_base + v_impuesto + v_envio;

  v_numero := generar_numero_orden();

  insert into ordenes
    (numero, cliente_id, usuario_id, subtotal, descuento, impuesto, envio, total,
     estado, metodo_pago, notas)
  values
    (v_numero, v_cliente_id, v_usuario_id, v_subtotal, v_descuento, v_impuesto, v_envio, v_total,
     'pendiente', p_metodo_pago, coalesce(p_notas, ''))
  returning id into v_orden_id;

  insert into orden_items (orden_id, producto_id, cantidad, precio_unitario, descuento, subtotal)
  select v_orden_id, c.producto_id, c.cantidad, c.precio_unitario, 0,
         c.precio_unitario * c.cantidad
  from carrito c where c.usuario_id = v_usuario_id;

  delete from carrito where usuario_id = v_usuario_id;

  return query select v_orden_id, v_numero, v_total;
end;
$fn$;

revoke all on function public.crear_orden_desde_carrito(pago_metodo, text, uuid) from public;
grant execute on function public.crear_orden_desde_carrito(pago_metodo, text, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5) RLS de orden_items e ordenes para el cliente (defensa en profundidad;
--    la RPC ya inserta como definer, pero el cliente debe poder LEER lo suyo).
-- ---------------------------------------------------------------------
alter table public.ordenes     enable row level security;
alter table public.orden_items enable row level security;

drop policy if exists ordenes_admin_all on public.ordenes;
create policy ordenes_admin_all on public.ordenes
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists ordenes_cliente_read on public.ordenes;
create policy ordenes_cliente_read on public.ordenes
  for select to authenticated
  using (cliente_id in (select cliente_id from public.usuarios where auth_id = auth.uid()));

drop policy if exists ordenes_vendedor_read on public.ordenes;
create policy ordenes_vendedor_read on public.ordenes
  for select to authenticated
  using (cliente_id in (
    select c.id from public.clientes c
    join public.usuarios u on u.id = c.vendedor_asignado_id
    where u.auth_id = auth.uid()));

drop policy if exists orden_items_admin_all on public.orden_items;
create policy orden_items_admin_all on public.orden_items
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists orden_items_cliente_read on public.orden_items;
create policy orden_items_cliente_read on public.orden_items
  for select to authenticated
  using (orden_id in (
    select o.id from public.ordenes o
    join public.usuarios u on u.cliente_id = o.cliente_id
    where u.auth_id = auth.uid()));

-- pagos: el cliente ya tiene politicas; reforzamos que admin gestione todo
drop policy if exists pagos_admin_all on public.pagos;
create policy pagos_admin_all on public.pagos
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

commit;
