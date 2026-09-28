-- ════════════════════════════════════════════════════════════════════════
-- Fase 20h · Lectura de configuracion acotada (flanco del agente de mapas, 28-sep)
--   configuracion_public_read (using true) dejaba leer TODA la configuración sin sesión, incluido el punto de salida del
--   reparto y los modos de escritura hacia Odoo. Ahora:
--   · sin sesión: solo lo que usan las páginas públicas (moneda, tasa, envío, IVA general, datos de contacto y soporte);
--   · con sesión: todo salvo las claves internas de Odoo (odoo_*), que solo lee el personal de administración.
-- ════════════════════════════════════════════════════════════════════════
begin;

drop policy if exists configuracion_public_read on public.configuracion;
drop policy if exists configuracion_anon_read on public.configuracion;
drop policy if exists configuracion_auth_read on public.configuracion;

create policy configuracion_anon_read on public.configuracion for select to anon
  using (clave in ('costo_envio', 'envio_gratis_minimo', 'iva_porcentaje', 'moneda_principal', 'moneda_secundaria', 'tasa_cambio',
                   'tasa_cambio_actualizada', 'tasa_cambio_fuente', 'empresa_nombre', 'empresa_direccion', 'empresa_email',
                   'empresa_telefono', 'empresa_rif')
         or clave like 'soporte\_%');

create policy configuracion_auth_read on public.configuracion for select to authenticated
  using (clave not like 'odoo\_%' or (select public.es_personal_admin()));

commit;
