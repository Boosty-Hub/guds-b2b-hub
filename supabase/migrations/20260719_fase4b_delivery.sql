-- =====================================================================
-- GUDS · FASE 4b — Delivery funcional
--   · asignar_entrega(orden, repartidor, prioridad): admin crea la entrega
--   · actualizar_estado_entrega(...): el repartidor asignado (o admin)
--       cambia el estado y sincroniza el estado de la orden
--   · RLS: el repartidor puede LEER las órdenes y clientes de sus entregas
-- =====================================================================
begin;

-- Asignación (admin)
create or replace function public.asignar_entrega(
  p_orden_id uuid, p_repartidor_id uuid, p_prioridad text default 'normal'
) returns uuid
language plpgsql security definer set search_path = public
as $fn$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'Solo un administrador puede asignar entregas'; end if;
  if exists (select 1 from entregas where orden_id = p_orden_id and estado <> 'fallida') then
    raise exception 'La orden ya tiene una entrega asignada';
  end if;
  insert into entregas (orden_id, repartidor_id, estado, prioridad, fecha_asignacion)
  values (p_orden_id, p_repartidor_id, 'asignada', coalesce(p_prioridad,'normal'), now())
  returning id into v_id;
  return v_id;
end;
$fn$;
revoke all on function public.asignar_entrega(uuid, uuid, text) from public;
grant execute on function public.asignar_entrega(uuid, uuid, text) to authenticated;

-- Actualización de estado por el repartidor asignado (o admin), sincroniza la orden
create or replace function public.actualizar_estado_entrega(
  p_entrega_id uuid,
  p_estado entrega_estado,
  p_receptor text default null,
  p_notas text default null,
  p_motivo text default null
) returns void
language plpgsql security definer set search_path = public
as $fn$
declare v_ent record; v_mine boolean;
begin
  select * into v_ent from entregas where id = p_entrega_id;
  if not found then raise exception 'Entrega no encontrada'; end if;

  v_mine := exists (select 1 from usuarios where id = v_ent.repartidor_id and auth_id = auth.uid());
  if not (v_mine or public.is_admin()) then
    raise exception 'No autorizado para actualizar esta entrega';
  end if;

  update entregas set
    estado = p_estado,
    fecha_inicio_entrega = case when p_estado = 'en_camino' then coalesce(fecha_inicio_entrega, now()) else fecha_inicio_entrega end,
    fecha_entrega = case when p_estado = 'entregada' then now() else fecha_entrega end,
    receptor_nombre = coalesce(p_receptor, receptor_nombre),
    notas = coalesce(p_notas, notas),
    motivo_fallo = case when p_estado = 'fallida' then p_motivo else motivo_fallo end,
    updated_at = now()
  where id = p_entrega_id;

  -- Sincronizar el estado de la orden
  if p_estado = 'en_camino' then
    update ordenes set estado = 'enviado' where id = v_ent.orden_id and estado in ('pendiente','confirmado','procesando');
  elsif p_estado = 'entregada' then
    update ordenes set estado = 'completado', fecha_entrega_real = now() where id = v_ent.orden_id;
  end if;
end;
$fn$;
revoke all on function public.actualizar_estado_entrega(uuid, entrega_estado, text, text, text) from public;
grant execute on function public.actualizar_estado_entrega(uuid, entrega_estado, text, text, text) to authenticated;

-- Helpers SECURITY DEFINER: evitan recursión de RLS (no re-disparan políticas).
create or replace function public.mis_ordenes_reparto()
returns setof uuid language sql stable security definer set search_path = public as $fn$
  select e.orden_id from entregas e join usuarios u on u.id = e.repartidor_id where u.auth_id = auth.uid();
$fn$;
revoke all on function public.mis_ordenes_reparto() from public;
grant execute on function public.mis_ordenes_reparto() to authenticated;

create or replace function public.mis_clientes_reparto()
returns setof uuid language sql stable security definer set search_path = public as $fn$
  select o.cliente_id from ordenes o join entregas e on e.orden_id = o.id
  join usuarios u on u.id = e.repartidor_id where u.auth_id = auth.uid();
$fn$;
revoke all on function public.mis_clientes_reparto() from public;
grant execute on function public.mis_clientes_reparto() to authenticated;

-- RLS: el repartidor lee las órdenes de sus entregas (vía función, sin recursión)
drop policy if exists ordenes_repartidor_read on public.ordenes;
create policy ordenes_repartidor_read on public.ordenes
  for select to authenticated
  using (id in (select public.mis_ordenes_reparto()));

-- RLS: el repartidor lee los clientes de sus entregas (dirección, teléfono, coords)
drop policy if exists clientes_repartidor_read on public.clientes;
create policy clientes_repartidor_read on public.clientes
  for select to authenticated
  using (id in (select public.mis_clientes_reparto()));

-- RLS: el repartidor lee los items de las órdenes de sus entregas (para contar productos)
drop policy if exists orden_items_repartidor_read on public.orden_items;
create policy orden_items_repartidor_read on public.orden_items
  for select to authenticated
  using (orden_id in (select public.mis_ordenes_reparto()));

commit;
