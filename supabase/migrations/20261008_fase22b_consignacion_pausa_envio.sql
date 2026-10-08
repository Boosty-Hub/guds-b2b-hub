-- ════════════════════════════════════════════════════════════════════════
-- Fase 22b (2/2) · Pausa de seguridad: aprobar consignaciones espera al despliegue de sync-odoo
--   La base ya crea el pedido al aprobar una declaración (20261008_fase22b_consignacion_pedido_odoo.sql), pero la función edge
--   sync-odoo desplegada todavía tiene el enviar.js anterior, que manda TODO pedido desde el almacén general P-01: una venta en
--   consignación aprobada antes del despliegue llegaría a Odoo con el almacén equivocado.
--   configuracion.odoo_envio_consignacion: 'pausado' (aprobar responde con el aviso; rechazar sigue funcionando) | 'activo'.
--   Al desplegar sync-odoo con el enviar.js de 22b: update configuracion set valor = 'activo' where clave = 'odoo_envio_consignacion';
-- ════════════════════════════════════════════════════════════════════════
begin;

insert into public.configuracion (clave, valor, descripcion)
select 'odoo_envio_consignacion', 'pausado',
  'Aprobar ventas en consignación (crean el pedido en Odoo desde el almacén de consignación, 22b): pausado hasta desplegar sync-odoo con enviar.js de 22b | activo'
where not exists (select 1 from public.configuracion where clave = 'odoo_envio_consignacion');

do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.revisar_declaracion_consignacion(uuid,boolean,text)'::regprocedure);
  n := replace(d, E'  select * into a from public.almacenes where id = d.almacen_id;\n',
    E'  if coalesce((select valor from public.configuracion where clave = ''odoo_envio_consignacion''), ''pausado'') <> ''activo'' then\n'
    || E'    raise exception ''La aprobación de ventas en consignación está en pausa hasta actualizar el envío a Odoo (fase 22b): el pedido saldría del almacén general. Puedes rechazarla o esperar.'' using errcode = ''P0001'';\n'
    || E'  end if;\n'
    || E'  select * into a from public.almacenes where id = d.almacen_id;\n');
  if n = d then raise exception 'revisar_declaracion_consignacion cambió: no se encontró dónde agregar la pausa'; end if;
  execute n;
end $$;

commit;
