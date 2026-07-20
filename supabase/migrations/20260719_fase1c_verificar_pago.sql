-- =====================================================================
-- GUDS · FASE 1c — Verificación de pagos por el admin.
--   verificar_pago(p_pago_id, p_aprobar, p_notas): marca el pago como
--   verificado/rechazado y, si se aprueba, pone ordenes.pagado = true.
--   Solo admin. El consumo/liberación de crédito se conecta en Fase 2 (P3).
-- =====================================================================
begin;

create or replace function public.verificar_pago(
  p_pago_id uuid,
  p_aprobar boolean,
  p_notas text default null
) returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_admin_id uuid;
  v_orden_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede verificar pagos';
  end if;

  select id into v_admin_id from usuarios where auth_id = auth.uid();
  select orden_id into v_orden_id from pagos where id = p_pago_id;
  if not found then
    raise exception 'Pago no encontrado';
  end if;

  if p_aprobar then
    update pagos
      set estado = 'verificado',
          verificado_por = v_admin_id,
          fecha_verificacion = now(),
          notas = coalesce(p_notas, notas)
    where id = p_pago_id;

    if v_orden_id is not null then
      update ordenes set pagado = true where id = v_orden_id;
    end if;
  else
    update pagos
      set estado = 'rechazado',
          verificado_por = v_admin_id,
          fecha_verificacion = now(),
          notas = coalesce(p_notas, notas)
    where id = p_pago_id;
  end if;
end;
$fn$;

revoke all on function public.verificar_pago(uuid, boolean, text) from public;
grant execute on function public.verificar_pago(uuid, boolean, text) to authenticated;

commit;
