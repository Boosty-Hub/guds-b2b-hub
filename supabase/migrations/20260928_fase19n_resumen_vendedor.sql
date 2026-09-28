-- ════════════════════════════════════════════════════════════════════════
-- Fase 19n · Portal del vendedor: cifras con fuente única y empresa por defecto según la cartera (plan V0.3 y V0.4)
--   1. resumen_vendedor(): una sola función del servidor para las cifras del vendedor (dashboard, clientes, pedidos,
--      cobros y metas), con las mismas definiciones que el admin:
--        · Deuda  = facturas contabilizadas (estado posted) con saldo, como Cuentas por cobrar: "por cobrar" suma los
--                   saldos positivos, "a favor" los negativos (notas de crédito sin aplicar) y "vencido" lo que pasó su
--                   vencimiento (o su emisión si no tiene) según el día de hoy en Caracas.
--        · Ventas = documentos de venta del reporte de ventas (documentos_venta: facturas y notas de crédito sin saldos
--                   iniciales ni notas de débito, netas de IVA, en USD) de los clientes del vendedor, en el mes de Caracas.
--        · Cobros = pagos de sus clientes; "verificados del mes" sin IGTF, como el reporte de cobranza.
--      Antes cada pantalla sumaba en el navegador con consultas distintas y las cifras no cuadraban entre sí.
--      security definer con alcance explícito: solo los clientes asignados a quien llama y las empresas visibles.
--   2. Empresa por defecto: 5 vendedores entraban a la empresa donde no tienen ningún cliente (toda su
--      cartera está en Quirutec y su empresa por defecto era GUDS). Regla: la
--      empresa por defecto de un vendedor es la que tiene más clientes activos asignados (en empate se deja la actual).
--      Se corrige el dato y un trigger mantiene la regla cuando se asignan clientes desde la app. La sincronización con
--      Odoo escribe sin triggers; para ese caso el portal ofrece cambiar de empresa (aviso en Dashboard y Clientes).
-- ════════════════════════════════════════════════════════════════════════
begin;

-- 1. Resumen del vendedor ------------------------------------------------------------------------------------------
create or replace function public.resumen_vendedor(p_detalle boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_usuario uuid := public.usuario_actual_id();
  v_visibles uuid[] := public.empresas_visibles();
  v_hoy date := (now() at time zone 'America/Caracas')::date;
  v_mes date := date_trunc('month', now() at time zone 'America/Caracas')::date;
  v_fin date := (date_trunc('month', now() at time zone 'America/Caracas') + interval '1 month - 1 day')::date;
  v_res jsonb;
begin
  if v_usuario is null then
    raise exception 'Inicia sesión para ver tu resumen' using errcode = '42501';
  end if;

  with
  -- Cartera: clientes activos asignados (lo que lista "Mis clientes")
  cartera as (
    select c.id, coalesce(c.limite_credito, 0) limite from clientes c
    where c.vendedor_asignado_id = v_usuario and c.activo
      and (c.empresa_id is null or c.empresa_id = any(v_visibles))
  ),
  -- Todos sus clientes asignados (activos o no): lo que ve por RLS en pedidos y cobros
  mis as (
    select c.id from clientes c where c.vendedor_asignado_id = v_usuario
  ),
  fac as (
    select f.cliente_id, f.saldo_usd, v_hoy - coalesce(f.fecha_vencimiento, f.fecha_emision, v_hoy) dias
    from facturas f join cartera c on c.id = f.cliente_id
    where f.estado = 'posted' and abs(f.saldo_usd) > 0.009
      and (f.empresa_id is null or f.empresa_id = any(v_visibles))
  ),
  por_cliente as (
    select c.id cliente_id, c.limite,
      coalesce(sum(f.saldo_usd) filter (where f.saldo_usd > 0), 0) por_cobrar,
      coalesce(sum(f.saldo_usd) filter (where f.saldo_usd < 0), 0) a_favor,
      coalesce(sum(f.saldo_usd) filter (where f.saldo_usd > 0 and f.dias > 0), 0) vencido,
      count(*) filter (where f.saldo_usd > 0) facturas,
      coalesce(max(f.dias) filter (where f.saldo_usd > 0 and f.dias > 0), 0) dias_mora
    from cartera c left join fac f on f.cliente_id = c.id
    group by c.id, c.limite
  ),
  ped as (
    select o.estado::text estado, o.aprobacion, coalesce(o.total, 0) total,
           (coalesce(o.fecha_pedido, o.created_at) at time zone 'America/Caracas')::date fecha
    from ordenes o
    where (o.cliente_id in (select id from mis) or o.vendedor_id = v_usuario)
      and (o.empresa_id is null or o.empresa_id = any(v_visibles))
  ),
  pag as (
    select p.estado::text estado, coalesce(p.monto, 0) monto, coalesce(p.es_igtf, false) igtf,
           (p.created_at at time zone 'America/Caracas')::date fecha
    from pagos p
    where p.cliente_id in (select id from mis)
      and (p.empresa_id is null or p.empresa_id = any(v_visibles))
  ),
  ven as (
    select coalesce(sum(d.neto_usd), 0) neto, count(*) filter (where d.tipo = 'factura') facturas,
           count(*) filter (where d.tipo = 'nota_credito') notas_credito
    from public.documentos_venta(v_mes, v_fin) d
    where d.cliente_id in (select id from mis)
  )
  select jsonb_build_object(
    'hoy', v_hoy,
    'mes_desde', v_mes,
    'mes_hasta', v_fin,
    'clientes', (select count(*) from cartera),
    -- Clientes activos por empresa permitida (para ofrecer el cambio si la empresa activa no tiene ninguno)
    'clientes_por_empresa', (select coalesce(jsonb_object_agg(x.empresa_id, x.n), '{}'::jsonb) from (
        select c.empresa_id, count(*) n from clientes c
        where c.vendedor_asignado_id = v_usuario and c.activo and c.empresa_id = any(public.empresas_permitidas())
        group by c.empresa_id) x),
    'cartera', (select jsonb_build_object(
        'por_cobrar', round(coalesce(sum(pc.por_cobrar), 0), 2),
        'a_favor', round(coalesce(sum(pc.a_favor), 0), 2),
        'neto', round(coalesce(sum(pc.por_cobrar + pc.a_favor), 0), 2),
        'vencido', round(coalesce(sum(pc.vencido), 0), 2),
        'facturas', coalesce(sum(pc.facturas), 0),
        'clientes_con_saldo', count(*) filter (where pc.por_cobrar > 0.009),
        'clientes_a_favor', count(*) filter (where pc.a_favor < -0.009),
        'clientes_excedidos', count(*) filter (where pc.limite > 0 and pc.por_cobrar > pc.limite),
        'tramos', (select jsonb_build_object(
            'por_vencer', round(coalesce(sum(f.saldo_usd) filter (where f.dias <= 0), 0), 2),
            'd1_30', round(coalesce(sum(f.saldo_usd) filter (where f.dias between 1 and 30), 0), 2),
            'd31_60', round(coalesce(sum(f.saldo_usd) filter (where f.dias between 31 and 60), 0), 2),
            'd61_90', round(coalesce(sum(f.saldo_usd) filter (where f.dias between 61 and 90), 0), 2),
            'mas_90', round(coalesce(sum(f.saldo_usd) filter (where f.dias > 90), 0), 2))
          from fac f where f.saldo_usd > 0))
      from por_cliente pc),
    'ventas_mes', (select jsonb_build_object('neto', round(ven.neto, 2), 'facturas', ven.facturas, 'notas_credito', ven.notas_credito) from ven),
    'pedidos', (select jsonb_build_object(
        'total', count(*),
        'abiertos', count(*) filter (where p.estado in ('pendiente', 'confirmado', 'procesando', 'enviado') and p.aprobacion is distinct from 'rechazada'),
        'por_aprobar', count(*) filter (where p.aprobacion = 'pendiente'),
        'rechazados', count(*) filter (where p.aprobacion = 'rechazada'),
        'mes_n', count(*) filter (where p.fecha between v_mes and v_fin and p.estado <> 'cancelado'),
        'mes_monto', round(coalesce(sum(p.total) filter (where p.fecha between v_mes and v_fin and p.estado <> 'cancelado'), 0), 2))
      from ped p),
    'cobros', (select jsonb_build_object(
        'total', count(*),
        'pendientes_n', count(*) filter (where g.estado = 'pendiente'),
        'pendientes_monto', round(coalesce(sum(g.monto) filter (where g.estado = 'pendiente'), 0), 2),
        'verificados_mes_n', count(*) filter (where g.estado = 'verificado' and not g.igtf and g.fecha between v_mes and v_fin),
        'verificados_mes_monto', round(coalesce(sum(g.monto) filter (where g.estado = 'verificado' and not g.igtf and g.fecha between v_mes and v_fin), 0), 2),
        'rechazados_mes_n', count(*) filter (where g.estado = 'rechazado' and g.fecha between v_mes and v_fin))
      from pag g),
    'detalle', case when p_detalle then (select coalesce(jsonb_agg(jsonb_build_object(
        'cliente_id', pc.cliente_id, 'por_cobrar', round(pc.por_cobrar, 2), 'a_favor', round(pc.a_favor, 2),
        'vencido', round(pc.vencido, 2), 'facturas', pc.facturas, 'dias_mora', pc.dias_mora)), '[]'::jsonb) from por_cliente pc) end
  ) into v_res;

  return v_res;
end $$;
comment on function public.resumen_vendedor(boolean) is
  'Cifras del portal del vendedor (cartera, ventas del mes, pedidos, cobros) con las definiciones del admin; solo su cartera';
revoke all on function public.resumen_vendedor(boolean) from public, anon;
grant execute on function public.resumen_vendedor(boolean) to authenticated;

-- 2. Empresa por defecto del vendedor = la de más clientes activos asignados ------------------------------------------
create or replace function public.ajustar_empresa_defecto_vendedor(p_usuario uuid) returns void
language sql security definer set search_path = public as $$
  with conteo as (
    select ue.empresa_id, ue.por_defecto,
           (select count(*) from clientes c where c.vendedor_asignado_id = p_usuario and c.activo and c.empresa_id = ue.empresa_id) n
    from usuario_empresas ue
    where ue.usuario_id = p_usuario
      and exists (select 1 from usuarios u where u.id = p_usuario and u.role = 'vendedor')
  ), mejor as (
    select empresa_id from conteo where n > 0 order by n desc, por_defecto desc limit 1
  )
  update usuario_empresas ue set por_defecto = (ue.empresa_id = m.empresa_id)
  from mejor m
  where ue.usuario_id = p_usuario and ue.por_defecto is distinct from (ue.empresa_id = m.empresa_id);
$$;
revoke all on function public.ajustar_empresa_defecto_vendedor(uuid) from public, anon, authenticated;

-- Corrección del dato para todos los vendedores con cartera
do $$
declare v uuid;
begin
  for v in select distinct c.vendedor_asignado_id from clientes c join usuarios u on u.id = c.vendedor_asignado_id
           where u.role = 'vendedor' and c.activo loop
    perform public.ajustar_empresa_defecto_vendedor(v);
  end loop;
end $$;

-- Regla para lo que se asigne desde la app (la sincronización con Odoo no dispara triggers)
create or replace function public.trg_cliente_vendedor_empresa() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.vendedor_asignado_id is not distinct from old.vendedor_asignado_id
     and new.activo is not distinct from old.activo and new.empresa_id is not distinct from old.empresa_id then
    return null;
  end if;
  if new.vendedor_asignado_id is not null then
    perform public.ajustar_empresa_defecto_vendedor(new.vendedor_asignado_id);
  end if;
  if tg_op = 'UPDATE' and old.vendedor_asignado_id is not null and old.vendedor_asignado_id is distinct from new.vendedor_asignado_id then
    perform public.ajustar_empresa_defecto_vendedor(old.vendedor_asignado_id);
  end if;
  return null;
end $$;
drop trigger if exists z_cliente_vendedor_empresa on public.clientes;
create trigger z_cliente_vendedor_empresa after insert or update of vendedor_asignado_id, activo on public.clientes
  for each row execute function public.trg_cliente_vendedor_empresa();

notify pgrst, 'reload schema';

commit;
