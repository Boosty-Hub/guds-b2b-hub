-- Pendientes de lanzamiento — Fase 3 (banners con imagen de diseño)
-- Item 8: la sección de banners solo permitía color de fondo + texto; ahora
-- admite una imagen de diseño (sube al bucket público `imagenes`, igual que
-- productos/avatares). El gradiente se conserva como respaldo cuando el
-- banner no tiene imagen.
begin;

alter table public.banners
  add column if not exists imagen_url text;

commit;
