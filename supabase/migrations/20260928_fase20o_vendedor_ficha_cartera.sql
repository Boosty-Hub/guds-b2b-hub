-- ════════════════════════════════════════════════════════════════════════
-- Fase 20o · Portal del vendedor V3: ficha del cliente y cartera (plan del vendedor 3.3 y 3.5)
--   · ficha_cliente_vendedor(cliente) → en una sola llamada: datos y contacto, direcciones, crédito, deuda con antigüedad
--     por tramos (misma lógica que Cuentas por cobrar y resumen_vendedor: facturas contabilizadas con saldo, vencido según
--     su vencimiento —o su emisión— y el día de hoy en Caracas), facturas pendientes, últimos pedidos, últimos cobros y
--     productos frecuentes.
--   · cartera_vendedor() → sus clientes activos con deuda por tramos, mora, próximo vencimiento, última compra y último
--     cobro, y un puntaje de prioridad de cobro (vencido ponderado por los días de mora). La suma de los tramos de todos
--     los clientes es la misma de resumen_vendedor().
--   Ambas SECURITY DEFINER con alcance explícito: solo clientes asignados a quien llama y las empresas visibles (la ficha de
--   un cliente ajeno devuelve null).
-- ════════════════════════════════════════════════════════════════════════
begin;

-- 1. Ficha del cliente ------------------------------------------------------------------------------------------------
create or replace function public.ficha_cliente_vendedor(p_cliente_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_visibles uuid[] := public.empresas_visibles();
  v_hoy date := (now() at time zone 'America/Caracas')::date;
  v_res jsonb;
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;
  -- Un cliente que no es de su cartera no existe para él (la página muestra "no encontrado", sin error de permisos)
  if p_cliente_id is null or not public.es_vendedor_de(p_cliente_id) then
    return null;
  end if;

  with
  fac as (
    select f.id, f.numero, f.tipo, f.fecha_emision, f.fecha_vencimiento, f.total_usd, f.saldo_usd, f.monto_retenido_usd,
           coalesce(f.es_saldo_inicial, false) saldo_inicial, f.orden_id,
           v_hoy - coalesce(f.fecha_vencimiento, f.fecha_emision, v_hoy) dias
      from facturas f
     where f.cliente_id = p_cliente_id and f.estado = 'posted' and abs(f.saldo_usd) > 0.009
       and (f.empresa_id is null or f.empresa_id = any(v_visibles))
  ),
  ped as (
    select o.* from ordenes o
     where o.cliente_id = p_cliente_id and (o.empresa_id is null or o.empresa_id = any(v_visibles))
  ),
  pag as (
    select p.* from pagos p
     where p.cliente_id = p_cliente_id and (p.empresa_id is null or p.empresa_id = any(v_visibles))
  )
  select jsonb_build_object(
    'hoy', v_hoy,
    'cliente', (select jsonb_build_object(
        'id', c.id, 'codigo', c.codigo, 'nombre_negocio', c.nombre_negocio, 'rif', c.rif, 'email', c.email,
        'telefono', c.telefono, 'celular', c.celular, 'direccion', c.direccion, 'calle', c.calle, 'complemento', c.complemento,
        'direccion_entrega', c.direccion_entrega, 'ciudad', c.ciudad, 'estado', c.estado,
        'condicion_pago', c.condicion_pago, 'dias_credito', c.dias_credito, 'limite_credito', coalesce(c.limite_credito, 0),
        'activo', coalesce(c.activo, true), 'empresa_id', c.empresa_id, 'empresa', e.nombre_corto,
        'lista_precios', lp.nombre, 'retiene_iva', coalesce(c.retiene_iva, false), 'retiene_islr', coalesce(c.retiene_islr, false),
        'contribuyente_especial', coalesce(c.contribuyente_especial, false), 'portal_habilitado', coalesce(c.portal_habilitado, false),
        'latitud', c.latitud, 'longitud', c.longitud)
      from clientes c
      left join empresas e on e.id = c.empresa_id
      left join listas_precios lp on lp.id = c.lista_precios_id
     where c.id = p_cliente_id),
    'contactos', (select coalesce(jsonb_agg(jsonb_build_object(
        'nombre', cc.nombre, 'cargo', cc.cargo, 'telefono', cc.telefono, 'celular', cc.celular, 'email', cc.email,
        'es_principal', coalesce(cc.es_principal, false)) order by cc.es_principal desc nulls last, cc.nombre), '[]'::jsonb)
      from (select * from cliente_contactos x where x.cliente_id = p_cliente_id and coalesce(x.activo, true)
             order by x.es_principal desc nulls last, x.nombre limit 6) cc),
    'direcciones', (select coalesce(jsonb_agg(jsonb_build_object(
        'nombre', d.nombre, 'direccion', d.direccion, 'calle', d.calle, 'complemento', d.complemento,
        'ciudad', d.ciudad, 'estado', d.estado, 'telefono', d.telefono) order by d.nombre), '[]'::jsonb)
      from (select * from cliente_direcciones x where x.cliente_id = p_cliente_id and coalesce(x.activo, true)
             order by x.nombre limit 6) d),
    'deuda', (select jsonb_build_object(
        'por_cobrar', round(coalesce(sum(saldo_usd) filter (where saldo_usd > 0), 0), 2),
        'a_favor', round(coalesce(sum(saldo_usd) filter (where saldo_usd < 0), 0), 2),
        'neto', round(coalesce(sum(saldo_usd), 0), 2),
        'vencido', round(coalesce(sum(saldo_usd) filter (where saldo_usd > 0 and dias > 0), 0), 2),
        'dias_mora', coalesce(max(dias) filter (where saldo_usd > 0 and dias > 0), 0),
        'facturas', count(*) filter (where saldo_usd > 0),
        'saldo_inicial', round(coalesce(sum(saldo_usd) filter (where saldo_usd > 0 and saldo_inicial), 0), 2),
        'tramos', jsonb_build_object(
          'por_vencer', round(coalesce(sum(saldo_usd) filter (where saldo_usd > 0 and dias <= 0), 0), 2),
          'd1_30', round(coalesce(sum(saldo_usd) filter (where saldo_usd > 0 and dias between 1 and 30), 0), 2),
          'd31_60', round(coalesce(sum(saldo_usd) filter (where saldo_usd > 0 and dias between 31 and 60), 0), 2),
          'd61_90', round(coalesce(sum(saldo_usd) filter (where saldo_usd > 0 and dias between 61 and 90), 0), 2),
          'mas_90', round(coalesce(sum(saldo_usd) filter (where saldo_usd > 0 and dias > 90), 0), 2)))
      from fac),
    'facturas', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', f.id, 'numero', f.numero, 'tipo', f.tipo, 'fecha_emision', f.fecha_emision, 'fecha_vencimiento', f.fecha_vencimiento,
        'dias', f.dias, 'total_usd', f.total_usd, 'saldo_usd', f.saldo_usd, 'monto_retenido_usd', coalesce(f.monto_retenido_usd, 0),
        'saldo_inicial', f.saldo_inicial, 'orden_id', f.orden_id)
        order by (f.saldo_usd < 0), coalesce(f.fecha_vencimiento, f.fecha_emision) nulls last, f.numero), '[]'::jsonb)
      from fac f),
    'pedidos', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', o.id, 'numero', o.numero, 'numero_guds', o.numero_guds, 'fecha', coalesce(o.fecha_pedido, o.created_at),
        'total', o.total, 'estado', o.estado, 'estado_odoo', o.estado_odoo, 'aprobacion', o.aprobacion, 'odoo_id', o.odoo_id,
        'odoo_envio_error', o.odoo_envio_error, 'rechazo_motivo', o.rechazo_motivo) order by coalesce(o.fecha_pedido, o.created_at) desc), '[]'::jsonb)
      from (select * from ped order by coalesce(fecha_pedido, created_at) desc limit 8) o),
    'pedidos_resumen', (select jsonb_build_object(
        'total', count(*),
        'ultima_compra', max(coalesce(fecha_pedido, created_at)) filter (where estado::text <> 'cancelado' and coalesce(aprobacion, '') <> 'rechazada'),
        'compras_90d', round(coalesce(sum(total) filter (where estado::text <> 'cancelado' and coalesce(aprobacion, '') <> 'rechazada'
                                  and coalesce(fecha_pedido, created_at) >= now() - interval '90 days'), 0), 2))
      from ped),
    'cobros', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'numero', p.numero, 'fecha', coalesce(p.fecha_pago::timestamptz, p.created_at), 'monto', p.monto,
        'moneda', p.moneda, 'monto_moneda', p.monto_moneda, 'metodo', p.metodo, 'estado', p.estado, 'referencia', p.referencia,
        'es_igtf', coalesce(p.es_igtf, false)) order by coalesce(p.fecha_pago::timestamptz, p.created_at) desc), '[]'::jsonb)
      from (select * from pag order by coalesce(fecha_pago::timestamptz, created_at) desc limit 8) p),
    'ultimo_pago', (select max(coalesce(fecha_pago::timestamptz, created_at)) from pag where estado::text <> 'rechazado' and not coalesce(es_igtf, false)),
    'frecuentes', coalesce(public.compras_cliente_vendedor(p_cliente_id, 8) -> 'frecuentes', '[]'::jsonb)
  ) into v_res;

  return v_res;
end $$;

-- 2. Cartera del vendedor con prioridad de cobro -----------------------------------------------------------------------
create or replace function public.cartera_vendedor()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_usuario uuid := public.usuario_actual_id();
  v_visibles uuid[] := public.empresas_visibles();
  v_hoy date := (now() at time zone 'America/Caracas')::date;
  v_res jsonb;
begin
  if v_usuario is null then
    raise exception 'Inicia sesión para ver tu cartera' using errcode = '42501';
  end if;

  with
  cartera as (
    select c.id, c.codigo, c.nombre_negocio, c.ciudad, c.telefono, c.celular, c.condicion_pago, c.dias_credito,
           coalesce(c.limite_credito, 0) limite, c.empresa_id
      from clientes c
     where c.vendedor_asignado_id = v_usuario and c.activo
       and (c.empresa_id is null or c.empresa_id = any(v_visibles))
  ),
  fac as (
    select f.cliente_id, f.saldo_usd, coalesce(f.es_saldo_inicial, false) saldo_inicial, f.fecha_vencimiento,
           v_hoy - coalesce(f.fecha_vencimiento, f.fecha_emision, v_hoy) dias
      from facturas f join cartera c on c.id = f.cliente_id
     where f.estado = 'posted' and abs(f.saldo_usd) > 0.009
       and (f.empresa_id is null or f.empresa_id = any(v_visibles))
  ),
  deuda as (
    select c.id cliente_id,
      coalesce(sum(f.saldo_usd) filter (where f.saldo_usd > 0), 0) por_cobrar,
      coalesce(sum(f.saldo_usd) filter (where f.saldo_usd < 0), 0) a_favor,
      coalesce(sum(f.saldo_usd) filter (where f.saldo_usd > 0 and f.dias > 0), 0) vencido,
      coalesce(max(f.dias) filter (where f.saldo_usd > 0 and f.dias > 0), 0) dias_mora,
      count(f.*) filter (where f.saldo_usd > 0) facturas,
      coalesce(sum(f.saldo_usd) filter (where f.saldo_usd > 0 and f.saldo_inicial), 0) saldo_inicial,
      coalesce(sum(f.saldo_usd) filter (where f.saldo_usd > 0 and f.dias <= 0), 0) t_por_vencer,
      coalesce(sum(f.saldo_usd) filter (where f.saldo_usd > 0 and f.dias between 1 and 30), 0) t_d1_30,
      coalesce(sum(f.saldo_usd) filter (where f.saldo_usd > 0 and f.dias between 31 and 60), 0) t_d31_60,
      coalesce(sum(f.saldo_usd) filter (where f.saldo_usd > 0 and f.dias between 61 and 90), 0) t_d61_90,
      coalesce(sum(f.saldo_usd) filter (where f.saldo_usd > 0 and f.dias > 90), 0) t_mas_90,
      min(f.fecha_vencimiento) filter (where f.saldo_usd > 0 and f.dias <= 0) proximo_vencimiento,
      coalesce(sum(f.saldo_usd) filter (where f.saldo_usd > 0 and f.dias between -7 and 0), 0) vence_7d
    from cartera c left join fac f on f.cliente_id = c.id
    group by c.id
  ),
  compras as (
    select o.cliente_id, max(coalesce(o.fecha_pedido, o.created_at)) ultima,
           count(*) filter (where coalesce(o.fecha_pedido, o.created_at) >= now() - interval '180 days') n_180
      from ordenes o join cartera c on c.id = o.cliente_id
     where o.estado::text <> 'cancelado' and coalesce(o.aprobacion, '') <> 'rechazada'
       and (o.empresa_id is null or o.empresa_id = any(v_visibles))
     group by o.cliente_id
  ),
  cobros as (
    select p.cliente_id, max(coalesce(p.fecha_pago::timestamptz, p.created_at)) ultimo,
           count(*) filter (where p.estado = 'pendiente') pendientes
      from pagos p join cartera c on c.id = p.cliente_id
     where p.estado::text <> 'rechazado' and not coalesce(p.es_igtf, false)
       and (p.empresa_id is null or p.empresa_id = any(v_visibles))
     group by p.cliente_id
  )
  select jsonb_build_object(
    'hoy', v_hoy,
    'clientes', coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'codigo', c.codigo, 'nombre_negocio', c.nombre_negocio, 'ciudad', c.ciudad, 'telefono', c.telefono,
        'celular', c.celular, 'condicion_pago', c.condicion_pago, 'dias_credito', c.dias_credito, 'limite_credito', c.limite,
        'empresa_id', c.empresa_id,
        'por_cobrar', round(d.por_cobrar, 2), 'a_favor', round(d.a_favor, 2), 'vencido', round(d.vencido, 2),
        'dias_mora', d.dias_mora, 'facturas', d.facturas, 'saldo_inicial', round(d.saldo_inicial, 2),
        'tramos', jsonb_build_object('por_vencer', round(d.t_por_vencer, 2), 'd1_30', round(d.t_d1_30, 2), 'd31_60', round(d.t_d31_60, 2),
                                     'd61_90', round(d.t_d61_90, 2), 'mas_90', round(d.t_mas_90, 2)),
        'proximo_vencimiento', d.proximo_vencimiento, 'vence_7d', round(d.vence_7d, 2),
        'ultima_compra', cp.ultima, 'compras_180d', coalesce(cp.n_180, 0),
        'ultimo_cobro', cb.ultimo, 'cobros_pendientes', coalesce(cb.pendientes, 0),
        'excedido', c.limite > 0 and d.por_cobrar > c.limite,
        -- Prioridad de cobro: el vencido pesa más cuantos más días de mora tenga (tope 6 meses)
        'prioridad', round(d.vencido * (1 + least(d.dias_mora, 180) / 30.0), 2))
      order by d.vencido * (1 + least(d.dias_mora, 180) / 30.0) desc, d.por_cobrar desc, c.nombre_negocio), '[]'::jsonb)
  ) into v_res
  from cartera c
  join deuda d on d.cliente_id = c.id
  left join compras cp on cp.cliente_id = c.id
  left join cobros cb on cb.cliente_id = c.id;

  return v_res;
end $$;

revoke execute on function public.ficha_cliente_vendedor(uuid) from public, anon;
revoke execute on function public.cartera_vendedor() from public, anon;
grant execute on function public.ficha_cliente_vendedor(uuid) to authenticated;
grant execute on function public.cartera_vendedor() to authenticated;

notify pgrst, 'reload schema';

commit;
