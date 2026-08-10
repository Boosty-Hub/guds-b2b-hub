-- Pendientes de lanzamiento — Fase 4 (galería de 2-4 imágenes por SKU)
-- Item 9: la ficha de producto solo admitía 1 imagen principal (imagen_url).
-- `imagenes` guarda el arreglo completo; `imagen_url` se mantiene como espejo
-- de imagenes[0] para no romper los ~12 sitios que hoy leen esa sola columna.
begin;

alter table public.productos
  add column if not exists imagenes jsonb not null default '[]'::jsonb;

update public.productos
set imagenes = jsonb_build_array(imagen_url)
where imagen_url is not null and imagenes = '[]'::jsonb;

-- fase0b_ajustes.sql revocó el select de tabla en productos para anon y
-- otorgó una lista explícita de columnas: sin este grant, `imagenes` sería
-- invisible en el Landing público aunque el resto de la fila sí se vea.
grant select (imagenes) on public.productos to anon;

commit;
