-- ════════════════════════════════════════════════════════════════════════
-- Fase 18q · Buscador global (docs/PLAN-REDISENO-DENSO.md, Fase B)
--   buscar_global(q, limite): busca en clientes, contactos, proveedores, productos, órdenes, facturas/NC/ND, cobros,
--   facturas y pagos de proveedor, órdenes de compra, retenciones (recibidas y emitidas), lotes, transferencias,
--   almacenes, bancos y vendedores. security invoker: respeta los permisos (RLS) y la empresa activa del usuario.
-- ════════════════════════════════════════════════════════════════════════
begin;

create extension if not exists pg_trgm with schema extensions;

create index if not exists clientes_nombre_trgm on public.clientes using gin (nombre_negocio extensions.gin_trgm_ops);
create index if not exists productos_nombre_trgm on public.productos using gin (nombre extensions.gin_trgm_ops);
create index if not exists facturas_numero_trgm on public.facturas using gin (numero extensions.gin_trgm_ops);
create index if not exists ordenes_numero_trgm on public.ordenes using gin (numero extensions.gin_trgm_ops);
create index if not exists transferencias_numero_trgm on public.transferencias using gin (numero extensions.gin_trgm_ops);
create index if not exists proveedores_nombre_trgm on public.proveedores using gin (nombre extensions.gin_trgm_ops);

create or replace function public.buscar_global(q text, limite integer default 6)
returns table(tipo text, id uuid, titulo text, subtitulo text, extra text, enlace text, relevancia integer)
language plpgsql stable security invoker set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_t text := trim(coalesce(q, ''));
  v_p text;
  v_rif text;
  v_n integer := least(greatest(coalesce(limite, 6), 1), 25);
begin
  if length(v_t) < 2 then return; end if;
  v_p := '%' || replace(replace(v_t, '%', ''), '_', '\_') || '%';
  v_rif := nullif(public.normalizar_rif(v_t), '');

  return query
  (select 'cliente'::text, c.id, c.nombre_negocio::text, concat_ws(' · ', c.rif, c.ciudad, c.codigo)::text, null::text,
          '/admin/clientes/' || c.id, case when c.nombre_negocio ilike v_t || '%' or public.normalizar_rif(c.rif) = v_rif then 2 else 1 end
   from clientes c
   where c.nombre_negocio ilike v_p or c.codigo ilike v_p or (v_rif is not null and length(v_rif) >= 4 and public.normalizar_rif(c.rif) like '%' || v_rif || '%')
   order by 7 desc, c.nombre_negocio limit v_n)
  union all
  (select 'contacto', k.id, k.nombre, concat_ws(' · ', k.cargo, k.email, (select nombre_negocio from clientes where id = k.cliente_id)), null,
          '/admin/clientes/' || k.cliente_id || '/usuarios', 1
   from cliente_contactos k where k.nombre ilike v_p or k.email ilike v_p order by k.nombre limit v_n)
  union all
  (select 'proveedor', v.id, v.nombre, concat_ws(' · ', v.rif, v.ciudad), null, '/admin/proveedores/' || v.id,
          case when v.nombre ilike v_t || '%' then 2 else 1 end
   from proveedores v
   where v.nombre ilike v_p or v.codigo ilike v_p or (v_rif is not null and length(v_rif) >= 4 and public.normalizar_rif(v.rif) like '%' || v_rif || '%')
   order by 7 desc, v.nombre limit v_n)
  union all
  (select 'producto', pr.id, pr.nombre, concat_ws(' · ', pr.sku, 'disp. ' || trunc(pr.stock_disponible)::text), null,
          '/admin/productos?q=' || coalesce(pr.sku, pr.nombre), case when pr.sku ilike v_t or pr.nombre ilike v_t || '%' then 2 else 1 end
   from productos pr where pr.nombre ilike v_p or pr.sku ilike v_p order by 7 desc, pr.nombre limit v_n)
  union all
  (select 'orden', o.id, o.numero::text, concat_ws(' · ', (select nombre_negocio from clientes where id = o.cliente_id), o.estado::text, to_char(coalesce(o.fecha_pedido, o.created_at), 'DD/MM/YYYY')),
          '$' || to_char(o.total, 'FM999G999G990D00'), '/admin/ordenes?orden=' || o.id, case when o.numero ilike v_t then 3 when o.numero ilike v_t || '%' then 2 else 1 end
   from ordenes o where o.numero ilike v_p order by 7 desc, o.created_at desc limit v_n)
  union all
  (select case when f.tipo = 'nota_credito' then 'nota_credito' when f.es_nota_debito then 'nota_debito' else 'factura' end,
          f.id, f.numero::text, concat_ws(' · ', (select nombre_negocio from clientes where id = f.cliente_id), to_char(f.fecha_emision, 'DD/MM/YYYY'), 'saldo $' || to_char(f.saldo_usd, 'FM999G999G990D00')),
          '$' || to_char(abs(f.total_usd), 'FM999G999G990D00'), '/admin/facturas/' || f.id,
          case when f.numero ilike v_t then 3 when f.numero ilike v_t || '%' then 2 else 1 end
   from facturas f where f.numero ilike v_p or f.nro_control ilike v_p or f.referencia ilike v_p order by 7 desc, f.fecha_emision desc nulls last limit v_n)
  union all
  (select 'cobro', pg.id, pg.numero::text, concat_ws(' · ', (select nombre_negocio from clientes where id = pg.cliente_id), 'ref. ' || pg.referencia, pg.estado::text),
          '$' || to_char(pg.monto, 'FM999G999G990D00'), '/admin/cuentas/' || pg.cliente_id, case when pg.numero ilike v_t or pg.referencia ilike v_t then 2 else 1 end
   from pagos pg where pg.numero ilike v_p or pg.referencia ilike v_p order by 7 desc, pg.created_at desc limit v_n)
  union all
  (select 'factura_proveedor', fp.id, fp.numero, concat_ws(' · ', (select nombre from proveedores where id = fp.proveedor_id), 'ref. ' || fp.referencia, to_char(fp.fecha_emision, 'DD/MM/YYYY')),
          '$' || to_char(abs(fp.total_usd), 'FM999G999G990D00'), '/admin/facturas-proveedor/' || fp.id, case when fp.numero ilike v_t or fp.referencia ilike v_t then 2 else 1 end
   from facturas_proveedor fp where fp.numero ilike v_p or fp.referencia ilike v_p or fp.nro_control ilike v_p order by 7 desc, fp.fecha_emision desc nulls last limit v_n)
  union all
  (select 'pago_proveedor', pp.id, pp.numero, concat_ws(' · ', (select nombre from proveedores where id = pp.proveedor_id), 'ref. ' || pp.referencia),
          '$' || to_char(pp.monto, 'FM999G999G990D00'), coalesce('/admin/proveedores/' || pp.proveedor_id, '/admin/cuentas-por-pagar'), 1
   from pagos_proveedor pp where pp.numero ilike v_p or pp.referencia ilike v_p order by pp.fecha desc nulls last limit v_n)
  union all
  (select 'orden_compra', oc.id, oc.numero, concat_ws(' · ', (select nombre from proveedores where id = oc.proveedor_id), oc.estado),
          '$' || to_char(oc.total_usd, 'FM999G999G990D00'), coalesce('/admin/proveedores/' || oc.proveedor_id, '/admin/cuentas-por-pagar'), 1
   from ordenes_compra oc where oc.numero ilike v_p or oc.referencia_proveedor ilike v_p order by oc.fecha_orden desc nulls last limit v_n)
  union all
  (select 'retencion', r.id, r.numero::text, concat_ws(' · ', upper(r.tipo::text), (select nombre_negocio from clientes where id = r.cliente_id), to_char(r.fecha, 'DD/MM/YYYY')),
          '$' || to_char(r.total, 'FM999G999G990D00'), '/admin/retenciones', 1
   from retenciones r where r.numero ilike v_p or r.numero_comprobante ilike v_p order by r.fecha desc nulls last limit v_n)
  union all
  (select 'retencion_emitida', re.id, re.numero, concat_ws(' · ', upper(re.tipo), (select nombre from proveedores where id = re.proveedor_id), to_char(re.fecha, 'DD/MM/YYYY')),
          '$' || to_char(re.total, 'FM999G999G990D00'), coalesce('/admin/proveedores/' || re.proveedor_id, '/admin/cuentas-por-pagar'), 1
   from retenciones_emitidas re where re.numero ilike v_p order by re.fecha desc nulls last limit v_n)
  union all
  (select 'lote', l.id, l.nombre, concat_ws(' · ', (select nombre from productos where id = l.producto_id), 'vence ' || to_char(l.vencimiento, 'DD/MM/YYYY')),
          trunc(l.cantidad)::text || ' u', '/admin/lotes/' || l.id, case when l.nombre ilike v_t then 2 else 1 end
   from lotes l where l.nombre ilike v_p order by 7 desc, l.vencimiento nulls last limit v_n)
  union all
  (select 'transferencia', tr.id, tr.numero, concat_ws(' · ', tr.contacto, tr.origen, tr.estado), null, '/admin/transferencias/' || tr.id,
          case when tr.numero ilike v_t then 2 else 1 end
   from transferencias tr where tr.numero ilike v_p or tr.origen ilike v_p order by 7 desc, tr.fecha_programada desc nulls last limit v_n)
  union all
  (select 'almacen', a.id, a.nombre, concat_ws(' · ', a.codigo, a.tipo), null, '/admin/almacenes/' || a.id, 1
   from almacenes a where a.nombre ilike v_p or a.codigo ilike v_p order by a.nombre limit v_n)
  union all
  (select 'banco', b.id, b.nombre::text, concat_ws(' · ', b.moneda, coalesce(b.cuenta_odoo, b.numero_cuenta)), null, '/admin/bancos/' || b.id, 1
   from bancos b where b.nombre ilike v_p or b.cuenta_odoo ilike v_p or b.numero_cuenta ilike v_p order by b.nombre limit v_n)
  union all
  (select 'vendedor', u.id, concat_ws(' ', u.nombre, u.apellido), u.email, null, '/admin/vendedores/' || u.id, 1
   from usuarios u where u.role = 'vendedor' and (concat_ws(' ', u.nombre, u.apellido) ilike v_p or u.email ilike v_p) order by u.nombre limit v_n);
end $$;
grant execute on function public.buscar_global(text, integer) to authenticated;

commit;
