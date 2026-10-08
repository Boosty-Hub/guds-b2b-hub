-- ════════════════════════════════════════════════════════════════════════
-- Fase 22a4 · Los reportes que muestran deuda por cliente exigen `reportes` Y `cuentas` (hallazgo 4; decisión del 8-oct).
--   · exigir_permiso_reportes_cuentas(): helper para esos reportes (lo usarán también Antigüedad y Ventas vs deuda).
--   · reporte_dso (21b, DSO y mora por vendedor y por cliente) pasa a usarlo.
--   Revisados y sin cambio: reporte_ventas / reporte_ventas_comparativo / cubo / líneas (venta, no deuda),
--   reporte_cobranza (lo cobrado), reporte_inventario, reporte_metas_vendedores, reporte_reversos (18u/19o/20j/20q), y las
--   de calidad y cuadre (20q/21d: bandeja de trabajo por documento, exige reportes; ver informe de la fase).
--   metricas_cobranza, nc_sin_aplicar y alertas_cobranza (21b) ya exigían personal admin + cuentas.
-- ════════════════════════════════════════════════════════════════════════
begin;

create or replace function public.exigir_permiso_reportes_cuentas()
returns void language plpgsql stable set search_path = public as $$
begin
  if not public.puede('reportes', 'ver') then
    raise exception 'No tienes permiso para ver reportes' using errcode = '42501';
  end if;
  if not public.puede('cuentas', 'ver') then
    raise exception 'Este reporte muestra deuda por cliente: necesitas también el permiso de Cuentas' using errcode = '42501';
  end if;
end $$;
comment on function public.exigir_permiso_reportes_cuentas() is 'Reportes con deuda por cliente (22a4): exige reportes/ver y cuentas/ver';
revoke execute on function public.exigir_permiso_reportes_cuentas() from public, anon;
grant execute on function public.exigir_permiso_reportes_cuentas() to authenticated;

-- reporte_dso: reemplazo puntual sobre la definición vigente (no pisa otros cambios de la función)
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.reporte_dso'::regproc);
  n := replace(d, 'perform public.exigir_permiso_reportes();', 'perform public.exigir_permiso_reportes_cuentas();');
  if n = d and position('exigir_permiso_reportes_cuentas' in d) = 0 then
    raise exception 'reporte_dso: no se encontró la verificación de permisos a cambiar';
  end if;
  if n <> d then execute n; end if;
end $$;

commit;
