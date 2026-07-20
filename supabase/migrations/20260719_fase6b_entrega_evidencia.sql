-- =====================================================================
-- GUDS · FASE 6b — Evidencia de entrega: foto y firma.
--   actualizar_estado_entrega acepta firma_url y foto_url (se guardan en
--   entregas.firma_url / foto_entrega_url). Las imágenes se suben al bucket
--   público 'imagenes' bajo entregas/ desde el repartidor (upload autenticado).
-- =====================================================================
begin;

create or replace function public.actualizar_estado_entrega(
  p_entrega_id uuid,
  p_estado entrega_estado,
  p_receptor text default null,
  p_notas text default null,
  p_motivo text default null,
  p_firma_url text default null,
  p_foto_url text default null
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
    firma_url = coalesce(p_firma_url, firma_url),
    foto_entrega_url = coalesce(p_foto_url, foto_entrega_url),
    updated_at = now()
  where id = p_entrega_id;

  if p_estado = 'en_camino' then
    update ordenes set estado = 'enviado' where id = v_ent.orden_id and estado in ('pendiente','confirmado','procesando');
  elsif p_estado = 'entregada' then
    update ordenes set estado = 'completado', fecha_entrega_real = now() where id = v_ent.orden_id;
  end if;
end;
$fn$;
revoke all on function public.actualizar_estado_entrega(uuid, entrega_estado, text, text, text, text, text) from public;
grant execute on function public.actualizar_estado_entrega(uuid, entrega_estado, text, text, text, text, text) to authenticated;

-- La firma anterior de 5 parámetros ya no se usa (el front llamará con los nuevos).
drop function if exists public.actualizar_estado_entrega(uuid, entrega_estado, text, text, text);

commit;
