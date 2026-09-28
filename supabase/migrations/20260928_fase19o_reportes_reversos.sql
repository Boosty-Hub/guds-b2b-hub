-- ════════════════════════════════════════════════════════════════════════
-- Fase 19o · Reportes: neteo de reversos (R8a de docs/PLAN-PORTALES-Y-FLUJOS.md; decisión 28-sep "reversos por error neteados")
--   Una factura anulada por completo con una nota de crédito por el mismo monto (factura_origen_id) no es venta: inflaba
--   "Facturado", "Notas de crédito" y el ticket, y cuando factura y NC caen en meses distintos movía la venta neta de un mes
--   a otro (Quirutec: 87 pares por ≈ 6 M USD; p. ej. una factura de 3,47 M USD revertida por error de precio).
--   documentos_venta excluye ambos documentos del par; reporte_reversos los lista para revisarlos.
-- ════════════════════════════════════════════════════════════════════════
begin;

create or replace function public.documentos_venta(p_desde date, p_hasta date)
returns table(id uuid, empresa_id uuid, cliente_id uuid, tipo text, fecha date, vendedor text, factor numeric, neto_usd numeric)
language sql stable security definer set search_path = public as $$
  with reverso as (
    select fa.id factura_id, nc.id nota_id
    from facturas nc join facturas fa on fa.id = nc.factura_origen_id
    where nc.tipo = 'nota_credito' and fa.tipo = 'factura' and nc.estado = 'posted' and fa.estado = 'posted'
      and fa.moneda is not distinct from nc.moneda and abs(abs(nc.total) - abs(fa.total)) < 0.01
  ), excluir as (select factura_id id from reverso union select nota_id from reverso)
  select f.id, f.empresa_id, f.cliente_id, f.tipo, f.fecha_emision, coalesce(nullif(trim(f.vendedor_odoo), ''), 'Sin vendedor'),
         case when f.total <> 0 then f.total_usd / f.total else 0 end,
         case when f.total <> 0 then f.subtotal * f.total_usd / f.total else 0 end
  from facturas f
  where f.estado = 'posted' and f.tipo in ('factura', 'nota_credito') and not f.es_saldo_inicial and not coalesce(f.es_nota_debito, false)
    and f.fecha_emision between p_desde and p_hasta
    and (f.empresa_id is null or f.empresa_id = any(public.empresas_visibles()))
    and f.id not in (select id from excluir);
$$;
revoke execute on function public.documentos_venta(date, date) from public, anon, authenticated;

-- Pares factura + NC de reverso total con algún documento en el período (para revisarlos en Reportes)
create or replace function public.reporte_reversos(p_desde date, p_hasta date)
returns table(empresa text, cliente text, factura text, factura_fecha date, nota text, nota_fecha date, neto_usd numeric, motivo text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_permiso_reportes();
  return query
  select e.nombre_corto::text, coalesce(c.nombre_negocio, '—')::text, fa.numero::text, fa.fecha_emision, nc.numero::text, nc.fecha_emision,
         round(case when fa.total <> 0 then fa.subtotal * fa.total_usd / fa.total else 0 end, 2),
         coalesce(nullif(trim(nc.motivo_nota), ''), nullif(trim(nc.referencia), ''), nullif(trim(fa.motivo_anulacion), ''))::text
  from facturas nc join facturas fa on fa.id = nc.factura_origen_id
  left join clientes c on c.id = fa.cliente_id
  left join empresas e on e.id = fa.empresa_id
  where nc.tipo = 'nota_credito' and fa.tipo = 'factura' and nc.estado = 'posted' and fa.estado = 'posted'
    and fa.moneda is not distinct from nc.moneda and abs(abs(nc.total) - abs(fa.total)) < 0.01
    and not fa.es_saldo_inicial and not nc.es_saldo_inicial
    and (fa.fecha_emision between p_desde and p_hasta or nc.fecha_emision between p_desde and p_hasta)
    and (fa.empresa_id is null or fa.empresa_id = any(public.empresas_visibles()))
  order by 7 desc;
end $$;
revoke execute on function public.reporte_reversos(date, date) from public, anon;
grant execute on function public.reporte_reversos(date, date) to authenticated;

commit;
