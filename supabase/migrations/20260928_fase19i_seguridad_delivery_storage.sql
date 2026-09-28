-- ════════════════════════════════════════════════════════════════════════
-- Fase 19i · Seguridad de delivery y del almacenamiento (hallazgos de la investigación de delivery, 28-sep)
--   1. El rol Delivery leía TODAS las órdenes de ambas empresas (permiso ordenes:ver) y podía modificar cualquier
--      entrega por REST (delivery:editar + entregas_repartidor_update). Ahora solo ve sus entregas (políticas
--      *_repartidor_read) y cierra por la función actualizar_estado_entrega, que valida.
--   2. En el bucket público "imagenes" cualquier usuario con sesión (también clientes) podía subir, reemplazar o
--      borrar cualquier imagen (fotos de productos, banners, logos). Ahora: lectura pública; productos/banners/empresas
--      solo administración; cada usuario solo su avatar.
--   3. La evidencia de entrega (firma, foto) pasa a un bucket PRIVADO "evidencias-entrega": sube el repartidor asignado,
--      leen él y administración; nadie la reemplaza ni la borra desde la app.
--   4. actualizar_estado_entrega: "entregada" exige receptor, firma y foto (en el bucket privado) y una entrega cerrada ya
--      no se reabre ni se reescribe (salvo administración).
-- ════════════════════════════════════════════════════════════════════════
begin;

-- 1. Rol Delivery
update public.permisos p set puede_ver = false
from public.roles r, public.modulos m
where r.id = p.rol_id and m.id = p.modulo_id and r.nombre = 'Delivery' and m.codigo = 'ordenes';
update public.permisos p set puede_editar = false, puede_crear = false, puede_eliminar = false
from public.roles r, public.modulos m
where r.id = p.rol_id and m.id = p.modulo_id and r.nombre = 'Delivery' and m.codigo = 'delivery';
drop policy if exists entregas_repartidor_update on public.entregas;

-- 2. Bucket público "imagenes"
drop policy if exists "Authenticated users can upload images" on storage.objects;
drop policy if exists "Authenticated users can update images" on storage.objects;
drop policy if exists "Authenticated users can delete images" on storage.objects;
create policy imagenes_subir on storage.objects for insert to authenticated with check (
  bucket_id = 'imagenes' and (
    ((select public.es_personal_admin()) and (storage.foldername(name))[1] in ('productos', 'banners', 'empresas', 'categorias'))
    or ((storage.foldername(name))[1] = 'avatars' and name like 'avatars/' || coalesce((select public.usuario_actual_id())::text, '-') || '-%')
  ));
create policy imagenes_cambiar on storage.objects for update to authenticated
  using (bucket_id = 'imagenes' and ((select public.es_personal_admin()) or owner_id = (select auth.uid())::text))
  with check (bucket_id = 'imagenes' and ((select public.es_personal_admin()) or owner_id = (select auth.uid())::text));
create policy imagenes_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'imagenes' and ((select public.es_personal_admin()) or owner_id = (select auth.uid())::text));

-- 3. Bucket privado de evidencias: <entrega_id>/firma-*.png, <entrega_id>/foto-*.jpg
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidencias-entrega', 'evidencias-entrega', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.es_repartidor_de(p_entrega text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from entregas e join usuarios u on u.id = e.repartidor_id
                 where e.id::text = p_entrega and u.auth_id = auth.uid());
$$;
revoke execute on function public.es_repartidor_de(text) from public, anon;
grant execute on function public.es_repartidor_de(text) to authenticated;

create policy evidencias_subir on storage.objects for insert to authenticated with check (
  bucket_id = 'evidencias-entrega' and public.es_repartidor_de((storage.foldername(name))[1]));
create policy evidencias_leer on storage.objects for select to authenticated using (
  bucket_id = 'evidencias-entrega' and ((select public.es_personal_admin()) or public.es_repartidor_de((storage.foldername(name))[1])));

-- 4. Cierre de entrega con evidencia obligatoria y sin reabrir
create or replace function public.actualizar_estado_entrega(p_entrega_id uuid, p_estado entrega_estado, p_receptor text default null,
  p_notas text default null, p_motivo text default null, p_firma_url text default null, p_foto_url text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_ent record; v_mine boolean; v_admin boolean;
begin
  select * into v_ent from entregas where id = p_entrega_id for update;
  if not found then raise exception 'Entrega no encontrada'; end if;
  v_mine := exists (select 1 from usuarios where id = v_ent.repartidor_id and auth_id = auth.uid());
  v_admin := (select public.es_personal_admin());
  if not (v_mine or v_admin) then raise exception 'No autorizado para actualizar esta entrega'; end if;
  if v_ent.estado in ('entregada', 'fallida') and not v_admin then
    raise exception 'La entrega ya está cerrada (%); si hay que corregirla, lo hace administración', v_ent.estado;
  end if;
  if p_estado = 'entregada' then
    if nullif(trim(coalesce(p_receptor, '')), '') is null then raise exception 'Indica quién recibe la entrega'; end if;
    if p_firma_url is null or p_foto_url is null then raise exception 'La entrega necesita la firma del receptor y la foto de evidencia'; end if;
    if p_firma_url not like p_entrega_id::text || '/%' or p_foto_url not like p_entrega_id::text || '/%' then
      raise exception 'La evidencia no corresponde a esta entrega';
    end if;
  elsif p_estado = 'fallida' and nullif(trim(coalesce(p_motivo, '')), '') is null then
    raise exception 'Indica el motivo por el que no se entregó';
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
    update ordenes set estado = 'enviado' where id = v_ent.orden_id and odoo_id is null and estado in ('pendiente', 'confirmado', 'procesando');
  elsif p_estado = 'entregada' then
    update ordenes set estado = case when odoo_id is null then 'completado'::orden_estado else estado end, fecha_entrega_real = now() where id = v_ent.orden_id;
  end if;
end $$;

commit;
