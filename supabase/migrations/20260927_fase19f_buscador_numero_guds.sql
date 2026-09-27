-- ════════════════════════════════════════════════════════════════════════
-- Fase 19f · Buscador global: los pedidos enviados a Odoo también se encuentran por su número de GUDS (numero_guds)
-- ════════════════════════════════════════════════════════════════════════
begin;
create or replace function public.buscar_global(q text, limite integer default 6, contexto text default 'admin')
returns table(tipo text, id uuid, titulo text, subtitulo text, extra text, enlace text, relevancia integer)
language plpgsql stable security invoker set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_t text := trim(coalesce(q, ''));
  v_p text;
  v_rif text;
  v_n integer := least(greatest(coalesce(limite, 6), 1), 25);
  v_vend boolean := coalesce(contexto, 'admin') = 'vendedor';
begin
  if length(v_t) < 2 then return; end if;
  v_p := '%' || replace(replace(v_t, '%', ''), '_', '\_') || '%';
  v_rif := nullif(public.normalizar_rif(v_t), '');

  return query
  (select 'cliente'::text, c.id, c.nombre_negocio::text, concat_ws(' · ', c.rif, c.ciudad, c.codigo)::text, null::text,
          case when v_vend then '/vendedor/clientes?q=' || url_q(c.nombre_negocio) else '/admin/clientes/' || c.id end,
          case when c.nombre_negocio ilike v_t || '%' or public.normalizar_rif(c.rif) = v_rif then 2 else 1 end
   from clientes c
   where c.nombre_negocio ilike v_p or c.codigo ilike v_p or (v_rif is not null and length(v_rif) >= 4 and public.normalizar_rif(c.rif) like '%' || v_rif || '%')
   order by 7 desc, c.nombre_negocio limit v_n)
  union all
  (select 'contacto', k.id, k.nombre, concat_ws(' · ', k.cargo, k.email, cl.nombre_negocio), null,
          case when v_vend then '/vendedor/clientes?q=' || url_q(cl.nombre_negocio) else '/admin/clientes/' || k.cliente_id || '/usuarios' end, 1
   from cliente_contactos k left join clientes cl on cl.id = k.cliente_id
   where k.nombre ilike v_p or k.email ilike v_p order by k.nombre limit v_n)
  union all
  (select 'proveedor', v.id, v.nombre, concat_ws(' · ', v.rif, v.ciudad), null, '/admin/proveedores/' || v.id,
          case when v.nombre ilike v_t || '%' then 2 else 1 end
   from proveedores v
   where not v_vend and (v.nombre ilike v_p or v.codigo ilike v_p or (v_rif is not null and length(v_rif) >= 4 and public.normalizar_rif(v.rif) like '%' || v_rif || '%'))
   order by 7 desc, v.nombre limit v_n)
  union all
  (select 'producto', pr.id, pr.nombre, concat_ws(' · ', pr.sku, 'disp. ' || trunc(pr.stock_disponible)::text), null,
          case when v_vend then '/vendedor/inventario?q=' || url_q(coalesce(pr.sku, pr.nombre)) else '/admin/productos?q=' || url_q(coalesce(pr.sku, pr.nombre)) end,
          case when pr.sku ilike v_t or pr.nombre ilike v_t || '%' then 2 else 1 end
   from productos pr where (pr.nombre ilike v_p or pr.sku ilike v_p) and (not v_vend or pr.activo) order by 7 desc, pr.nombre limit v_n)
  union all
  (select 'orden', o.id, o.numero::text, concat_ws(' · ', case when o.numero_guds is not null then 'GUDS ' || o.numero_guds end, cl.nombre_negocio, o.estado::text, to_char(coalesce(o.fecha_pedido, o.created_at), 'DD/MM/YYYY')),
          '$' || to_char(o.total, 'FM999G999G990D00'),
          case when v_vend then '/vendedor/pedidos?q=' || url_q(o.numero) else '/admin/ordenes?orden=' || o.id end,
          case when o.numero ilike v_t or o.numero_guds ilike v_t then 3 when o.numero ilike v_t || '%' then 2 else 1 end
   from ordenes o left join clientes cl on cl.id = o.cliente_id
   where o.numero ilike v_p or o.numero_guds ilike v_p order by 7 desc, o.created_at desc limit v_n)
  union all
  (select case when f.tipo = 'nota_credito' then 'nota_credito' when f.es_nota_debito then 'nota_debito' else 'factura' end,
          f.id, f.numero::text, concat_ws(' · ', cl.nombre_negocio, to_char(f.fecha_emision, 'DD/MM/YYYY'), 'saldo $' || to_char(f.saldo_usd, 'FM999G999G990D00')),
          '$' || to_char(abs(f.total_usd), 'FM999G999G990D00'),
          case when v_vend then '/vendedor/clientes?q=' || url_q(cl.nombre_negocio) else '/admin/facturas/' || f.id end,
          case when f.numero ilike v_t then 3 when f.numero ilike v_t || '%' then 2 else 1 end
   from facturas f left join clientes cl on cl.id = f.cliente_id
   where f.numero ilike v_p or f.nro_control ilike v_p or f.referencia ilike v_p order by 7 desc, f.fecha_emision desc nulls last limit v_n)
  union all
  (select 'cobro', pg.id, pg.numero::text, concat_ws(' · ', cl.nombre_negocio, 'ref. ' || pg.referencia, pg.estado::text),
          '$' || to_char(pg.monto, 'FM999G999G990D00'),
          case when v_vend then '/vendedor/pagos?q=' || url_q(pg.numero) else '/admin/cuentas/' || pg.cliente_id end,
          case when pg.numero ilike v_t or pg.referencia ilike v_t then 2 else 1 end
   from pagos pg left join clientes cl on cl.id = pg.cliente_id
   where pg.numero ilike v_p or pg.referencia ilike v_p order by 7 desc, pg.created_at desc limit v_n)
  union all
  (select 'factura_proveedor', fp.id, fp.numero, concat_ws(' · ', (select nombre from proveedores where id = fp.proveedor_id), 'ref. ' || fp.referencia, to_char(fp.fecha_emision, 'DD/MM/YYYY')),
          '$' || to_char(abs(fp.total_usd), 'FM999G999G990D00'), '/admin/facturas-proveedor/' || fp.id, case when fp.numero ilike v_t or fp.referencia ilike v_t then 2 else 1 end
   from facturas_proveedor fp where not v_vend and (fp.numero ilike v_p or fp.referencia ilike v_p or fp.nro_control ilike v_p) order by 7 desc, fp.fecha_emision desc nulls last limit v_n)
  union all
  (select 'pago_proveedor', pp.id, pp.numero, concat_ws(' · ', (select nombre from proveedores where id = pp.proveedor_id), 'ref. ' || pp.referencia),
          '$' || to_char(pp.monto, 'FM999G999G990D00'), coalesce('/admin/proveedores/' || pp.proveedor_id, '/admin/cuentas-por-pagar'), 1
   from pagos_proveedor pp where not v_vend and (pp.numero ilike v_p or pp.referencia ilike v_p) order by pp.fecha desc nulls last limit v_n)
  union all
  (select 'orden_compra', oc.id, oc.numero, concat_ws(' · ', (select nombre from proveedores where id = oc.proveedor_id), oc.estado),
          '$' || to_char(oc.total_usd, 'FM999G999G990D00'), coalesce('/admin/proveedores/' || oc.proveedor_id, '/admin/cuentas-por-pagar'), 1
   from ordenes_compra oc where not v_vend and (oc.numero ilike v_p or oc.referencia_proveedor ilike v_p) order by oc.fecha_orden desc nulls last limit v_n)
  union all
  (select 'retencion', r.id, r.numero::text, concat_ws(' · ', upper(r.tipo::text), (select nombre_negocio from clientes where id = r.cliente_id), to_char(r.fecha, 'DD/MM/YYYY')),
          '$' || to_char(r.total, 'FM999G999G990D00'), '/admin/retenciones', 1
   from retenciones r where not v_vend and (r.numero ilike v_p or r.numero_comprobante ilike v_p) order by r.fecha desc nulls last limit v_n)
  union all
  (select 'retencion_emitida', re.id, re.numero, concat_ws(' · ', upper(re.tipo), (select nombre from proveedores where id = re.proveedor_id), to_char(re.fecha, 'DD/MM/YYYY')),
          '$' || to_char(re.total, 'FM999G999G990D00'), coalesce('/admin/proveedores/' || re.proveedor_id, '/admin/cuentas-por-pagar'), 1
   from retenciones_emitidas re where not v_vend and re.numero ilike v_p order by re.fecha desc nulls last limit v_n)
  union all
  (select 'lote', l.id, l.nombre, concat_ws(' · ', pl.nombre, 'vence ' || to_char(l.vencimiento, 'DD/MM/YYYY')),
          trunc(l.cantidad)::text || ' u',
          case when v_vend then '/vendedor/inventario?q=' || url_q(coalesce(pl.sku, pl.nombre)) else '/admin/lotes/' || l.id end,
          case when l.nombre ilike v_t then 2 else 1 end
   from lotes l left join productos pl on pl.id = l.producto_id
   where l.nombre ilike v_p order by 7 desc, l.vencimiento nulls last limit v_n)
  union all
  (select 'transferencia', tr.id, tr.numero, concat_ws(' · ', tr.contacto, tr.origen, tr.estado), null, '/admin/transferencias/' || tr.id,
          case when tr.numero ilike v_t then 2 else 1 end
   from transferencias tr where not v_vend and (tr.numero ilike v_p or tr.origen ilike v_p) order by 7 desc, tr.fecha_programada desc nulls last limit v_n)
  union all
  (select 'almacen', a.id, a.nombre, concat_ws(' · ', a.codigo, a.tipo), null, '/admin/almacenes/' || a.id, 1
   from almacenes a where not v_vend and (a.nombre ilike v_p or a.codigo ilike v_p) order by a.nombre limit v_n)
  union all
  (select 'banco', b.id, b.nombre::text, concat_ws(' · ', b.moneda, coalesce(b.cuenta_odoo, b.numero_cuenta)), null, '/admin/bancos/' || b.id, 1
   from bancos b where not v_vend and (b.nombre ilike v_p or b.cuenta_odoo ilike v_p or b.numero_cuenta ilike v_p) order by b.nombre limit v_n)
  union all
  (select 'vendedor', u.id, concat_ws(' ', u.nombre, u.apellido), u.email, null, '/admin/vendedores/' || u.id, 1
   from usuarios u where not v_vend and u.role = 'vendedor' and (concat_ws(' ', u.nombre, u.apellido) ilike v_p or u.email ilike v_p) order by u.nombre limit v_n);
end $$;
grant execute on function public.buscar_global(text, integer, text) to authenticated;
commit;
