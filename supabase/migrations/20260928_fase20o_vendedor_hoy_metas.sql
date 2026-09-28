-- ════════════════════════════════════════════════════════════════════════
-- Fase 20o · Portal del vendedor V5: "Hoy" y metas (plan del vendedor 3.8; decisión del dueño 28-sep: metas por vendedor y
-- mes en USD, cargadas por administración)
--   · resumen_vendedor(): igual que la 19n + 'meta_mes' (meta del mes en las empresas visibles). La venta real sigue siendo
--     ventas_mes.neto (documentos de venta netos de IVA de sus clientes en el mes de Caracas), así meta y avance salen de la
--     misma función.
--   · hoy_vendedor(): el tablero "Hoy" en una llamada: clientes a visitar o con vencido (a partir de cartera_vendedor), facturas
--     que vencen esta semana, pedidos por aprobar y rechazados sin corregir, cobros por verificar y rechazados, y avisos.
--   · metas_vendedores(año, mes) y guardar_meta_vendedor(…): pantalla del admin (Vendedores → Metas), solo personal de
--     administración con permiso del módulo usuarios; la meta se guarda en la empresa activa (como el resto de los datos).
-- ════════════════════════════════════════════════════════════════════════
begin;

-- 1. resumen_vendedor() con la meta del mes -----------------------------------------------------------------------------
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
    -- Meta del mes (cargada por administración por empresa): la suma de las empresas visibles
    'meta_mes', (select jsonb_build_object('meta', round(coalesce(sum(m.meta_ventas), 0), 2), 'cargada', count(*) > 0)
      from metas_vendedor m
      where m.vendedor_id = v_usuario and m.anio = extract(year from v_mes)::int and m.mes = extract(month from v_mes)::int
        and coalesce(m.meta_ventas, 0) > 0
        and (m.empresa_id is null or m.empresa_id = any(v_visibles))),
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
revoke all on function public.resumen_vendedor(boolean) from public, anon;
grant execute on function public.resumen_vendedor(boolean) to authenticated;

-- 2. Tablero "Hoy" --------------------------------------------------------------------------------------------------------
create or replace function public.hoy_vendedor()
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
  v_cartera jsonb;
  v_res jsonb;
begin
  if v_usuario is null then
    raise exception 'Inicia sesión para ver tu día' using errcode = '42501';
  end if;
  v_cartera := coalesce(public.cartera_vendedor() -> 'clientes', '[]'::jsonb);

  with
  mis as (select c.id, c.nombre_negocio from clientes c where c.vendedor_asignado_id = v_usuario),
  cli as (
    select x, (x->>'vencido')::numeric vencido, (x->>'dias_mora')::int dias_mora, (x->>'vence_7d')::numeric vence_7d,
           (x->>'compras_180d')::int compras_180d, (x->>'ultima_compra')::timestamptz ultima_compra, (x->>'prioridad')::numeric prioridad
      from jsonb_array_elements(v_cartera) x
  ),
  visitar as (
    select c.*, case when c.ultima_compra is null then null else v_hoy - (c.ultima_compra at time zone 'America/Caracas')::date end dias_sin_compra
      from cli c
     where c.vencido > 0.009 or c.vence_7d > 0.009
        or (c.compras_180d >= 2 and c.ultima_compra < now() - interval '30 days')
  ),
  ped as (
    select o.*, m.nombre_negocio cliente from ordenes o left join mis m on m.id = o.cliente_id
     where (o.cliente_id in (select id from mis) or o.vendedor_id = v_usuario)
       and (o.empresa_id is null or o.empresa_id = any(v_visibles))
  ),
  rech as (
    select p.* from ped p
     where p.aprobacion = 'rechazada' and coalesce(p.aprobado_at, p.updated_at, p.created_at) >= now() - interval '30 days'
       -- ya corregido: el vendedor lo duplicó ("… · corrige <número>")
       and not exists (select 1 from ordenes x where x.vendedor_id = v_usuario and x.created_at > p.created_at
                         and x.notas like '%corrige ' || p.numero || '%')
  ),
  pag as (
    select p.*, m.nombre_negocio cliente from pagos p join mis m on m.id = p.cliente_id
     where (p.empresa_id is null or p.empresa_id = any(v_visibles)) and not coalesce(p.es_igtf, false)
  )
  select jsonb_build_object(
    'hoy', v_hoy,
    'visitar', jsonb_build_object(
      'n', (select count(*) from visitar),
      'items', (select coalesce(jsonb_agg(jsonb_build_object(
          'id', v.x->>'id', 'nombre_negocio', v.x->>'nombre_negocio', 'ciudad', v.x->>'ciudad',
          'telefono', coalesce(v.x->>'celular', v.x->>'telefono'), 'vencido', v.vencido, 'dias_mora', v.dias_mora,
          'por_cobrar', (v.x->>'por_cobrar')::numeric, 'vence_7d', v.vence_7d, 'dias_sin_compra', v.dias_sin_compra,
          'motivo', case when v.vencido > 0.009 then 'vencido' when v.vence_7d > 0.009 then 'vence_pronto' else 'sin_compras' end)
          order by v.prioridad desc, v.vence_7d desc, v.dias_sin_compra desc nulls last), '[]'::jsonb)
        from (select * from visitar order by prioridad desc, vence_7d desc, dias_sin_compra desc nulls last limit 8) v)),
    'vencen_semana', (select jsonb_build_object('n', count(*), 'monto', round(coalesce(sum(f.saldo_usd), 0), 2))
      from facturas f
     where f.cliente_id in (select (x->>'id')::uuid from jsonb_array_elements(v_cartera) x)
       and f.estado = 'posted' and f.saldo_usd > 0.009 and f.fecha_vencimiento between v_hoy and v_hoy + 7
       and (f.empresa_id is null or f.empresa_id = any(v_visibles))),
    'por_aprobar', jsonb_build_object(
      'n', (select count(*) from ped where aprobacion = 'pendiente'),
      'items', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'numero', p.numero, 'cliente', p.cliente, 'total', p.total,
          'fecha', coalesce(p.fecha_pedido, p.created_at)) order by coalesce(p.fecha_pedido, p.created_at)), '[]'::jsonb)
        from (select * from ped where aprobacion = 'pendiente' order by coalesce(fecha_pedido, created_at) limit 5) p)),
    'rechazados', jsonb_build_object(
      'n', (select count(*) from rech),
      'items', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'numero', r.numero, 'cliente', r.cliente, 'total', r.total,
          'motivo', r.rechazo_motivo, 'fecha', coalesce(r.aprobado_at, r.updated_at)) order by coalesce(r.aprobado_at, r.updated_at) desc), '[]'::jsonb)
        from (select * from rech order by coalesce(aprobado_at, updated_at) desc limit 5) r)),
    'cobros_pendientes', jsonb_build_object(
      'n', (select count(*) from pag where estado = 'pendiente'),
      'monto', (select round(coalesce(sum(monto), 0), 2) from pag where estado = 'pendiente'),
      'items', (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'numero', g.numero, 'cliente', g.cliente, 'monto', g.monto,
          'fecha', coalesce(g.fecha_pago::timestamptz, g.created_at)) order by g.created_at), '[]'::jsonb)
        from (select * from pag where estado = 'pendiente' order by created_at limit 5) g)),
    'cobros_rechazados', jsonb_build_object(
      -- Solo los reportados en GUDS que administración rechazó (los anulados en Odoo no son "por corregir")
      'n', (select count(*) from pag where estado = 'rechazado' and odoo_id is null and coalesce(fecha_verificacion, updated_at) >= now() - interval '14 days'),
      'items', (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'numero', g.numero, 'cliente', g.cliente, 'monto', g.monto,
          'motivo', g.notas, 'fecha', coalesce(g.fecha_verificacion, g.updated_at)) order by coalesce(g.fecha_verificacion, g.updated_at) desc), '[]'::jsonb)
        from (select * from pag where estado = 'rechazado' and odoo_id is null and coalesce(fecha_verificacion, updated_at) >= now() - interval '14 days'
               order by coalesce(fecha_verificacion, updated_at) desc limit 5) g)),
    'avisos', jsonb_build_object(
      'no_leidas', (select count(*) from notificaciones n where n.usuario_id = v_usuario and not coalesce(n.leida, false)),
      'items', (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'titulo', n.titulo, 'mensaje', n.mensaje, 'tipo', n.tipo,
          'link', n.link, 'created_at', n.created_at) order by n.created_at desc), '[]'::jsonb)
        from (select * from notificaciones n where n.usuario_id = v_usuario and not coalesce(n.leida, false)
               order by n.created_at desc limit 5) n))
  ) into v_res;
  return v_res;
end $$;
revoke execute on function public.hoy_vendedor() from public, anon;
grant execute on function public.hoy_vendedor() to authenticated;

-- 3. Metas por vendedor y mes (administración) ------------------------------------------------------------------------------
-- Lista de vendedores con su meta y la venta real del mes, con la misma definición que resumen_vendedor (documentos de venta
-- netos de IVA de los clientes asignados, empresas visibles). 'meta_empresa' es la meta de la empresa activa (la editable).
create or replace function public.metas_vendedores(p_anio integer, p_mes integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_visibles uuid[] := public.empresas_visibles();
  v_activa uuid := public.empresa_activa();
  v_desde date;
  v_hasta date;
  v_res jsonb;
begin
  if not (public.es_personal_admin() and public.puede('usuarios', 'ver')) then
    raise exception 'No tienes permiso para ver las metas' using errcode = '42501';
  end if;
  if p_mes not between 1 and 12 or p_anio not between 2020 and 2100 then
    raise exception 'Mes no válido' using errcode = '22023';
  end if;
  v_desde := make_date(p_anio, p_mes, 1);
  v_hasta := (v_desde + interval '1 month - 1 day')::date;

  with
  ven as (
    select c.vendedor_asignado_id vid, sum(d.neto_usd) neto, count(*) filter (where d.tipo = 'factura') facturas
      from public.documentos_venta(v_desde, v_hasta) d join clientes c on c.id = d.cliente_id
     where c.vendedor_asignado_id is not null
     group by 1
  ),
  met as (
    select m.vendedor_id vid,
           sum(m.meta_ventas) filter (where m.empresa_id is null or m.empresa_id = any(v_visibles)) meta,
           max(m.meta_ventas) filter (where m.empresa_id = v_activa) meta_empresa
      from metas_vendedor m where m.anio = p_anio and m.mes = p_mes and coalesce(m.meta_ventas, 0) > 0
     group by 1
  ),
  cli as (
    select c.vendedor_asignado_id vid, count(*) n from clientes c
     where c.activo and c.vendedor_asignado_id is not null and (c.empresa_id is null or c.empresa_id = any(v_visibles))
     group by 1
  )
  select jsonb_build_object(
    'desde', v_desde, 'hasta', v_hasta, 'empresa_activa', v_activa,
    'vendedores', coalesce(jsonb_agg(jsonb_build_object(
        'id', u.id, 'nombre', btrim(concat_ws(' ', u.nombre, u.apellido)), 'email', u.email, 'activo', coalesce(u.activo, true),
        'clientes', coalesce(cli.n, 0), 'meta', round(coalesce(met.meta, 0), 2), 'meta_empresa', met.meta_empresa,
        'venta', round(coalesce(ven.neto, 0), 2), 'facturas', coalesce(ven.facturas, 0))
      order by coalesce(u.activo, true) desc, coalesce(ven.neto, 0) desc, u.nombre), '[]'::jsonb))
    into v_res
    from usuarios u
    left join ven on ven.vid = u.id
    left join met on met.vid = u.id
    left join cli on cli.vid = u.id
   where u.role = 'vendedor' and (coalesce(u.activo, true) or met.vid is not null or ven.vid is not null);
  return v_res;
end $$;

create or replace function public.guardar_meta_vendedor(p_vendedor_id uuid, p_anio integer, p_mes integer, p_meta numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.empresa_activa();
begin
  if not (public.es_personal_admin() and public.puede('usuarios', 'editar')) then
    raise exception 'No tienes permiso para cargar metas' using errcode = '42501';
  end if;
  if v_emp is null then
    raise exception 'Selecciona GUDS o Quirutec en el menú superior para cargar metas' using errcode = 'P0001';
  end if;
  if p_mes not between 1 and 12 or p_anio not between 2020 and 2100 then
    raise exception 'Mes no válido' using errcode = '22023';
  end if;
  if not exists (select 1 from usuarios u where u.id = p_vendedor_id and u.role = 'vendedor') then
    raise exception 'El usuario no es vendedor' using errcode = 'P0001';
  end if;
  if p_meta is not null and (p_meta < 0 or p_meta > 1e9) then
    raise exception 'Meta no válida' using errcode = '22023';
  end if;

  if coalesce(p_meta, 0) = 0 then
    delete from metas_vendedor where vendedor_id = p_vendedor_id and anio = p_anio and mes = p_mes and empresa_id = v_emp;
    return jsonb_build_object('vendedor_id', p_vendedor_id, 'meta', null);
  end if;
  insert into metas_vendedor (vendedor_id, anio, mes, meta_ventas, empresa_id)
  values (p_vendedor_id, p_anio, p_mes, round(p_meta, 2), v_emp)
  on conflict (empresa_id, vendedor_id, mes, anio) do update set meta_ventas = excluded.meta_ventas, updated_at = now();
  return jsonb_build_object('vendedor_id', p_vendedor_id, 'meta', round(p_meta, 2));
end $$;

revoke execute on function public.metas_vendedores(integer, integer) from public, anon;
revoke execute on function public.guardar_meta_vendedor(uuid, integer, integer, numeric) from public, anon;
grant execute on function public.metas_vendedores(integer, integer) to authenticated;
grant execute on function public.guardar_meta_vendedor(uuid, integer, integer, numeric) to authenticated;

notify pgrst, 'reload schema';

commit;
