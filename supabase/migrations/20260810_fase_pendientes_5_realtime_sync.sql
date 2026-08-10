-- Pendientes de lanzamiento — Fase 5 (sincronización front admin -> portal)
-- Item 10: banners, productos y categorías se cargaban una sola vez al montar
-- el front; un cambio en admin no se veía hasta recargar a mano. Solo
-- `notificaciones` estaba en la publicación de Realtime hasta ahora.
begin;

alter publication supabase_realtime add table
  public.banners,
  public.productos,
  public.categorias,
  public.configuracion;

commit;
