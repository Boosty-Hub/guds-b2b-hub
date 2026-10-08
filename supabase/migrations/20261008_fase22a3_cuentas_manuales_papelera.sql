-- ════════════════════════════════════════════════════════════════════════
-- Fase 22a3 · Cuentas manuales viejas a la papelera (hallazgo 2 del plan de reportes; aprobado por el usuario el 8-oct).
--   `cuentas_cobrar` tiene 185 filas "Saldo pendiente según Odoo" del 14-ago (ajustar_deuda_odoo) que ninguna RPC, vista
--   ni pantalla usa desde la fase 11 (la deuda sale de las facturas de Odoo). Se quitó la pestaña "Cuentas manuales" y el
--   botón "Nueva CxC" de Cuentas por Cobrar.
--   Lo más seguro: NO se borran. Cada cuenta se marca archivada (archivada_at) y su foto va a la papelera como
--   tipo 'cuenta_manual' (no restaurable: ya no hay dónde verlas; los datos siguen en la tabla). pago_cuentas está vacía,
--   así que no hay cobros colgando de ellas. La tabla queda retirada: sin altas, cambios ni bajas desde la API.
-- ════════════════════════════════════════════════════════════════════════
begin;

alter table public.cuentas_cobrar add column if not exists archivada_at timestamptz;
alter table public.cuentas_cobrar add column if not exists archivada_motivo text;
comment on column public.cuentas_cobrar.archivada_at is 'Archivada (22a3): la tabla quedó retirada; la foto está en la papelera (tipo cuenta_manual)';

insert into public.papelera (tipo, accion, registro_id, numero, empresa_id, cliente_id, monto_usd, titulo, resumen, datos, motivo, restaurable)
select 'cuenta_manual', 'archivado', c.id, c.numero, c.empresa_id, c.cliente_id, round(c.monto, 2),
       'Cuenta manual ' || coalesce(c.numero, ''),
       concat_ws(' · ', cl.nombre_negocio, c.concepto, 'del ' || to_char(c.fecha, 'DD/MM/YYYY')),
       jsonb_build_object(
         'version', 1,
         'cuenta', to_jsonb(c),
         'cliente', case when cl.id is not null then jsonb_build_object('id', cl.id, 'nombre', cl.nombre_negocio, 'rif', cl.rif, 'codigo', cl.codigo) end,
         'pago_cuentas', (select coalesce(jsonb_agg(to_jsonb(pc)), '[]'::jsonb) from public.pago_cuentas pc where pc.cuenta_id = c.id),
         'nota', 'Saldo copiado de Odoo el 14-ago. Desde la fase 11 la deuda de cada cliente sale de sus facturas de Odoo: esta cuenta ya no se usaba. Se conserva archivada en la base.'),
       'Cuentas manuales viejas («Saldo pendiente según Odoo» del 14-ago) que ya no se usan: archivadas al quitar la pestaña Cuentas manuales (aprobado por el usuario el 8-oct).',
       false
  from public.cuentas_cobrar c
  left join public.clientes cl on cl.id = c.cliente_id
 where c.archivada_at is null
   and not exists (select 1 from public.papelera p where p.tipo = 'cuenta_manual' and p.registro_id = c.id);

update public.cuentas_cobrar
   set archivada_at = now(),
       archivada_motivo = 'Cuenta manual vieja del 14-ago sin uso; archivada al quitar la pestaña Cuentas manuales (8-oct)'
 where archivada_at is null;

-- Tabla retirada: nadie crea, cambia ni borra cuentas manuales desde la API (la lectura sigue sujeta a RLS)
revoke insert, update, delete, truncate on public.cuentas_cobrar from anon, authenticated;
revoke insert, update, delete, truncate on public.pago_cuentas from anon, authenticated;

-- Higiene de 22a2: la función del trigger de guardia no se llama desde la API
revoke all on function public.trg_pago_anulado_guardia() from public, anon, authenticated;

commit;
