-- ════════════════════════════════════════════════════════════════════════
-- Fase 20i · Sin perfiles creados por el propio usuario
--   La política usuarios_insert_own dejaba que cualquier cuenta con sesión se creara su propio perfil de "cliente", y la
--   app lo hacía sola al entrar con una cuenta sin perfil. Los perfiles los crea GUDS (acceso de contactos, registro
--   aprobado, usuarios del admin) por funciones del servidor, así que se quita. El registro público de cuentas en Supabase
--   Auth también se desactiva (configuración de Auth: disable_signup).
-- ════════════════════════════════════════════════════════════════════════
begin;

drop policy if exists usuarios_insert_own on public.usuarios;

commit;
