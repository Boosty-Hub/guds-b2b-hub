-- ════════════════════════════════════════════════════════════════════════
-- Fase 22j (2/2) · Notas de entrega: emitir, abonar, convertir y anular (NE2–NE3 del plan de finanzas), cuentan como venta y
-- se pueden incluir en el estado de cuenta. Respuestas de finanzas (dueño, 9-oct):
--   1. Las dos empresas emiten notas de entrega.
--   2–3. La N/E descarga inventario, pero no es una factura oficial: la mercancía sale de Odoo con el pedido y su albarán
--      validado, sin factura. La N/E NACE DE ESE PEDIDO (pedidos_para_nota_entrega / emitir_nota_entrega): sus líneas son lo
--      entregado y aún sin facturar, sin IVA. GUDS no escribe nada en Odoo (ni la N/E ni el inventario).
--   4. El dinero entra por un banco de Odoo: el cobro queda en Odoo como anticipo y el abono de la N/E se ENLAZA a ese cobro
--      (abonar_nota_entrega), que deja de contar como saldo a favor en el estado de cuenta fiscal (v_anticipos, partidas).
--   5. Puede terminar en factura o no: "pagada" sin factura o "facturada" (convertir_nota_entrega, con sugerencia cuando el
--      pedido de la N/E se factura en Odoo). Al pasar a factura, lo abonado de más vuelve a ser anticipo para aplicarlo en
--      Odoo a esa factura (se "traslada": nota_entrega_movimientos.trasladado).
--   6. Sin IVA. 7. Serie NE (correlativo por empresa, empresa_secuencias tipo 'NE'). 8. Incobrable por documento.
--   9. Check "incluir notas de entrega" en el estado de cuenta: salen en el mismo (detalle de la cuenta, PDF, Excel, correo,
--      enlace público y ficha del vendedor). El portal del cliente no las muestra.
--   Además: las N/E CUENTAN COMO VENTA (lo no facturado: lo facturado cuenta en su factura) en el promedio de ventas, Ventas vs
--   deuda y los días de recuperación (ventas_con_iva con p_ne).
--   · ne_saldos(corte, notas): fuente única del saldo de una N/E (total − abonos vigentes − facturado − devuelto − descontado
--     − ajustes) y de lo que falta por facturar. ne_vinculado(pago, corte): lo de un cobro que está pagando notas de entrega.
--   · Escritura solo por RPC (las tablas siguen sin insert/update/delete para authenticated). Anular y quitar movimientos van a
--     la papelera (D8) y se restauran desde allí.
-- ════════════════════════════════════════════════════════════════════════
begin;

-- ── 1. Columnas ──────────────────────────────────────────────────────────
alter table public.notas_entrega add column if not exists anulada_at timestamptz;
alter table public.notas_entrega add column if not exists anulada_por uuid references public.usuarios(id) on delete set null;
alter table public.notas_entrega add column if not exists motivo_anulacion text;
alter table public.nota_entrega_items add column if not exists orden_item_id uuid references public.orden_items(id) on delete set null;
alter table public.nota_entrega_items add column if not exists facturada_base numeric(14,3);
alter table public.nota_entrega_movimientos add column if not exists trasladado date;
alter table public.estado_cuenta_enlaces add column if not exists incluir_ne boolean not null default false;
create index if not exists nota_entrega_items_orden_item on public.nota_entrega_items (orden_item_id) where orden_item_id is not null;
create index if not exists nota_entrega_movimientos_pago on public.nota_entrega_movimientos (pago_id) where pago_id is not null;
create index if not exists notas_entrega_orden on public.notas_entrega (orden_id) where orden_id is not null;
comment on column public.nota_entrega_items.orden_item_id is 'Línea del pedido de Odoo de la que sale (22j): la N/E es lo entregado y aún sin facturar';
comment on column public.nota_entrega_items.facturada_base is 'Cantidad ya facturada en Odoo en esa línea al emitir la N/E: lo que se facture después es la conversión';
comment on column public.nota_entrega_movimientos.trasladado is
  'Abono que pasó a la factura (fecha de la conversión): ya no baja el saldo de la N/E y el cobro vuelve a ser anticipo para aplicarlo en Odoo';
comment on column public.estado_cuenta_enlaces.incluir_ne is 'El enlace público muestra también las notas de entrega del cliente (check del estado de cuenta, 22j)';

-- ── 2. Saldo de las notas de entrega (fuente única) ──────────────────────
-- Al corte: movimientos con fecha hasta el corte (o sin fecha: abonos históricos). Un abono trasladado a una factura deja de
-- contar desde la fecha del traslado. sin_facturar = lo que la N/E vende y no pasó a factura (cuenta como venta).
-- Invocador (respeta RLS): las funciones internas la llaman como dueño.
create or replace function public.ne_saldos(p_corte date default null, p_notas uuid[] default null)
returns table (nota_id uuid, total numeric, abonos numeric, facturado numeric, devuelto numeric, descontado numeric, ajustes numeric,
               saldo numeric, sin_facturar numeric, ultimo_movimiento date)
language sql stable set search_path = public
as $$
  select x.id, x.total, x.ab, x.fa, x.de, x.ds, x.aj,
         round(x.total - x.ab - x.fa - x.de - x.ds - x.aj, 2),
         round(x.total - x.fa - x.de - x.ds, 2),
         x.ultimo
    from (
      select n.id, n.total_usd total,
             coalesce(sum(m.monto_usd) filter (where m.tipo = 'abono'
                        and (m.trasladado is null or (p_corte is not null and m.trasladado > p_corte))), 0) ab,
             coalesce(sum(m.monto_usd) filter (where m.tipo = 'facturada'), 0) fa,
             coalesce(sum(m.monto_usd) filter (where m.tipo = 'devolucion'), 0) de,
             coalesce(sum(m.monto_usd) filter (where m.tipo = 'descuento'), 0) ds,
             coalesce(sum(m.monto_usd) filter (where m.tipo = 'ajuste'), 0) aj,
             max(m.fecha) ultimo
        from notas_entrega n
        left join nota_entrega_movimientos m on m.nota_id = n.id and (p_corte is null or m.fecha is null or m.fecha <= p_corte)
       where p_notas is null or n.id = any (p_notas)
       group by n.id, n.total_usd
    ) x
$$;
comment on function public.ne_saldos(date, uuid[]) is
  'Saldo de cada nota de entrega al corte (22j): total − abonos vigentes − facturado − devuelto − descontado − ajustes; sin_facturar = lo que cuenta como venta';
revoke execute on function public.ne_saldos(date, uuid[]) from public, anon;
grant execute on function public.ne_saldos(date, uuid[]) to authenticated;

-- Lo que un cobro está pagando de notas de entrega (abonos enlazados vigentes al corte). Definer: el estado de cuenta fiscal
-- de cualquier usuario descuenta lo mismo, vea o no las notas de entrega.
create or replace function public.ne_vinculado(p_pago uuid, p_corte date default null)
returns numeric language sql stable security definer set search_path = public
as $$
  select coalesce(round(sum(m.monto_usd), 2), 0)
    from nota_entrega_movimientos m join notas_entrega n on n.id = m.nota_id
   where m.pago_id = p_pago and m.tipo = 'abono' and n.estado <> 'anulada'
     and (case when p_corte is null then m.trasladado is null
               else (m.fecha is null or m.fecha <= p_corte) and (m.trasladado is null or m.trasladado > p_corte) end)
$$;
revoke execute on function public.ne_vinculado(uuid, date) from public, anon;
grant execute on function public.ne_vinculado(uuid, date) to authenticated;

-- ── 3. Vistas ────────────────────────────────────────────────────────────
drop view if exists public.v_notas_entrega;
create view public.v_notas_entrega with (security_invoker = on) as
select n.id, n.empresa_id, n.serie, n.numero, n.serie || ' ' || n.numero as documento, n.cliente_id,
       coalesce(c.nombre_negocio, n.cliente_nombre) as cliente, c.rif, n.cliente_nombre,
       coalesce(nullif(btrim(concat_ws(' ', u.nombre, u.apellido)), ''), n.vendedor_nombre) as vendedor,
       n.orden_id, n.pedido_odoo, n.fecha_emision, coalesce(n.fecha_vencimiento, n.fecha_emision) as fecha_vencimiento,
       n.moneda, n.tasa, n.total_usd,
       round(n.total_usd - s.saldo, 2) as abonado,
       s.saldo as saldo_usd,
       n.estado, coalesce(n.clasificacion, g.clasificacion, 'activa') as clasificacion,
       case when n.clasificacion is not null then 'nota' when g.clasificacion is not null then 'cliente' end as clasificacion_origen,
       n.observacion, n.origen, n.archivo, n.created_at, n.updated_at,
       (select count(*) from public.nota_entrega_movimientos x where x.nota_id = n.id) as movimientos,
       -- 22j
       s.abonos, s.facturado, s.devuelto, s.descontado, s.ajustes, s.sin_facturar, s.ultimo_movimiento,
       n.anulada_at, n.motivo_anulacion, n.vendedor_id, n.clasificacion as clasificacion_nota
  from public.notas_entrega n
  cross join lateral public.ne_saldos(null, array[n.id]) s
  left join public.clientes c on c.id = n.cliente_id
  left join public.usuarios u on u.id = n.vendedor_id
  left join public.cobranza_gestion g on g.cliente_id = n.cliente_id and g.factura_id is null;
comment on view public.v_notas_entrega is 'Notas de entrega con saldo (ne_saldos), lo facturado y lo sin facturar, y la clasificación efectiva (22g, 22j)';
grant select on public.v_notas_entrega to authenticated;
revoke all on public.v_notas_entrega from anon;

-- Anticipos: lo que un cobro paga de notas de entrega ya no es saldo a favor (ne_vinculado)
create or replace view public.v_anticipos with (security_invoker = on) as
select x.pago_id, x.numero, x.cliente_id, x.created_at, x.monto_usd,
       round(x.monto_usd - x.disponible, 2) as aplicado,
       x.disponible, x.empresa_id, x.odoo_id, x.fecha, x.vinculado_ne
  from (
    select p.id as pago_id, p.numero, p.cliente_id, p.created_at, p.monto as monto_usd, p.empresa_id, p.odoo_id, p.fecha_pago as fecha,
           l.v as vinculado_ne,
           greatest(0::numeric, round(case when p.odoo_id is null
                                             then p.monto - coalesce((select sum(pf.monto_aplicado) from public.pago_facturas pf where pf.pago_id = p.id), 0)
                                           else p.saldo_odoo_usd end - l.v, 2)) as disponible
      from public.pagos p
      cross join lateral (select public.ne_vinculado(p.id, null) v) l
     where p.estado = 'verificado'
       and (p.odoo_id is null or coalesce(p.saldo_odoo_usd, 0) > 0.009)
  ) x
 where x.odoo_id is null or x.disponible > 0.009;
comment on view public.v_anticipos is
  'Cobros verificados sin aplicar: de GUDS (monto − lo asignado) y de Odoo (saldo_odoo_usd, se aplican en Odoo), menos lo que pagan de notas de entrega (22g, 22j)';

-- ── 4. Estado de una nota (derivado de sus movimientos) ──────────────────
create or replace function public.ne_recalcular_estado(p_nota uuid)
returns text language plpgsql security definer set search_path = public as $$
declare n notas_entrega; s record; v text;
begin
  select * into n from notas_entrega where id = p_nota;
  if not found or n.estado in ('anulada', 'borrador') then return n.estado; end if;
  select * into s from public.ne_saldos(null, array[p_nota]);
  v := case
    when s.saldo <= 0.009 and s.facturado > 0.009 and s.sin_facturar <= 0.009 then 'facturada'
    when s.saldo <= 0.009 and s.devuelto >= s.total - 0.009 then 'devuelta'
    when s.saldo <= 0.009 then 'pagada'
    when s.abonos + s.facturado + s.devuelto + s.descontado + s.ajustes > 0.009 then 'abonada'
    else 'emitida' end;
  if v is distinct from n.estado then
    update notas_entrega set estado = v, updated_at = now() where id = p_nota;
  end if;
  return v;
end $$;
revoke all on function public.ne_recalcular_estado(uuid) from public, anon, authenticated;

-- Si lo abonado supera lo que queda por cobrar (la N/E pasó a factura o se devolvió), el excedente de los abonos se traslada:
-- deja de contar en la N/E y su cobro vuelve a ser anticipo, para aplicarlo en Odoo (a la factura nueva).
create or replace function public.ne_trasladar_excedente(p_nota uuid, p_fecha date, p_texto text)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_exceso numeric; v_mover numeric; v_total numeric := 0; r record;
begin
  select -saldo into v_exceso from public.ne_saldos(null, array[p_nota]);
  for r in select * from nota_entrega_movimientos where nota_id = p_nota and tipo = 'abono' and trasladado is null
            order by fecha desc nulls first, created_at desc loop
    exit when coalesce(v_exceso, 0) <= 0.009;
    v_mover := least(r.monto_usd, v_exceso);
    if v_mover >= r.monto_usd - 0.009 then
      update nota_entrega_movimientos set trasladado = p_fecha where id = r.id;
    else
      update nota_entrega_movimientos set monto_usd = round(monto_usd - v_mover, 2) where id = r.id;
      insert into nota_entrega_movimientos (nota_id, tipo, fecha, monto_usd, pago_id, referencia, nota, origen, created_by, trasladado)
      values (p_nota, 'abono', r.fecha, round(v_mover, 2), r.pago_id, r.referencia, p_texto, 'guds', r.created_by, p_fecha);
    end if;
    v_exceso := v_exceso - v_mover;
    v_total := v_total + v_mover;
  end loop;
  return round(v_total, 2);
end $$;
revoke all on function public.ne_trasladar_excedente(uuid, date, text) from public, anon, authenticated;

-- Contexto de escritura: sesión, permiso y empresa activa (en «Ambas» solo se consulta)
create or replace function public.ne_contexto(p_accion text)
returns uuid language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sin sesión' using errcode = '42501'; end if;
  if not (public.es_personal_admin() and public.puede('notas_entrega', p_accion)) then
    raise exception 'No tienes permiso para % notas de entrega',
      case p_accion when 'crear' then 'emitir' when 'editar' then 'registrar movimientos en' when 'eliminar' then 'anular' else 'ver' end
      using errcode = '42501';
  end if;
  return public.empresa_activa_requerida();
end $$;
revoke all on function public.ne_contexto(text) from public, anon, authenticated;

-- ── 5. Pedidos de Odoo entregados y sin facturar (de donde nace una N/E) ──
-- Por línea: entregado − facturado − lo que ya está en notas de entrega abiertas y aún no se facturó.
create or replace function public.ne_lineas_pendientes(p_empresas uuid[], p_orden uuid default null, p_cliente uuid default null)
returns table (orden_id uuid, orden_item_id uuid, producto_id uuid, descripcion text, sku text, entregada numeric, facturada numeric,
               en_ne numeric, pendiente numeric, precio numeric)
language sql stable security definer set search_path = public as $$
  select oi.orden_id, oi.id, oi.producto_id, coalesce(nullif(btrim(oi.nombre_producto), ''), 'Producto'), oi.sku_producto,
         coalesce(oi.cantidad_entregada, 0), coalesce(oi.cantidad_facturada, 0), coalesce(ne.en_ne, 0),
         greatest(0, round(coalesce(oi.cantidad_entregada, 0) - coalesce(oi.cantidad_facturada, 0) - coalesce(ne.en_ne, 0), 3)),
         round(oi.precio_unitario * (1 - coalesce(oi.descuento, 0) / 100.0), 4)
    from orden_items oi
    join ordenes o on o.id = oi.orden_id
    left join lateral (
      -- Lo de esta línea que está en N/E vigentes y Odoo aún no facturó (lo facturado después de emitir ya pasó a factura)
      select greatest(0, sum(i.cantidad) - greatest(0, coalesce(oi.cantidad_facturada, 0) - min(coalesce(i.facturada_base, 0)))) en_ne
        from nota_entrega_items i join notas_entrega n on n.id = i.nota_id
       where i.orden_item_id = oi.id and n.estado <> 'anulada'
    ) ne on true
   where o.empresa_id = any (p_empresas) and o.odoo_id is not null and o.estado_odoo = 'sale'
     and (p_orden is null or o.id = p_orden) and (p_cliente is null or o.cliente_id = p_cliente)
     and coalesce(oi.cantidad_entregada, 0) - coalesce(oi.cantidad_facturada, 0) > 0.0005
$$;
revoke all on function public.ne_lineas_pendientes(uuid[], uuid, uuid) from public, anon, authenticated;

create or replace function public.pedidos_para_nota_entrega(p_cliente uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if auth.uid() is null or not (public.es_personal_admin() and public.puede('notas_entrega', 'crear')) then
    raise exception 'No tienes permiso para emitir notas de entrega' using errcode = '42501';
  end if;
  with l as materialized (select * from public.ne_lineas_pendientes(public.empresas_visibles(), null, p_cliente) where pendiente > 0.0005)
  select coalesce(jsonb_agg(x order by x->>'despacho' desc nulls last, x->>'numero' desc), '[]'::jsonb) into v
    from (
      select jsonb_build_object(
               'orden_id', o.id, 'numero', o.numero, 'empresa_id', o.empresa_id, 'cliente_id', o.cliente_id, 'cliente', c.nombre_negocio,
               'rif', c.rif, 'vendedor', coalesce(nullif(btrim(concat_ws(' ', u.nombre, u.apellido)), ''), nullif(btrim(o.vendedor_odoo), '')),
               'fecha', (o.fecha_pedido at time zone 'America/Caracas')::date, 'despacho', o.fecha_despacho,
               'facturacion', o.estado_facturacion, 'dias_credito', c.dias_credito,
               'con_ne', exists (select 1 from notas_entrega n where n.orden_id = o.id and n.estado <> 'anulada'),
               'pendiente_usd', round(sum(l.pendiente * l.precio), 2),
               'lineas', jsonb_agg(jsonb_build_object('orden_item_id', l.orden_item_id, 'producto_id', l.producto_id, 'descripcion', l.descripcion,
                           'sku', l.sku, 'entregada', l.entregada, 'facturada', l.facturada, 'en_ne', l.en_ne, 'pendiente', l.pendiente,
                           'precio', l.precio, 'subtotal', round(l.pendiente * l.precio, 2)) order by l.descripcion)) x
        from l join ordenes o on o.id = l.orden_id
        left join clientes c on c.id = o.cliente_id
        left join usuarios u on u.id = o.vendedor_id
       group by o.id, c.id, u.id
    ) t;
  return v;
end $$;
revoke all on function public.pedidos_para_nota_entrega(uuid) from public, anon;
grant execute on function public.pedidos_para_nota_entrega(uuid) to authenticated;

-- ── 6. Emitir ────────────────────────────────────────────────────────────
-- p_items: [{orden_item_id, cantidad}] (nulo = todo lo pendiente del pedido). Serie NE con el correlativo de la empresa.
create or replace function public.emitir_nota_entrega(p_orden uuid, p_items jsonb default null, p_fecha date default null,
  p_vence date default null, p_observacion text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.ne_contexto('crear');
  v_yo uuid := (select id from usuarios where auth_id = auth.uid());
  v_hoy date := (now() at time zone 'America/Caracas')::date;
  o ordenes; c clientes;
  v_fecha date; v_vence date; v_n integer; v_id uuid; v_total numeric; v_malas integer;
begin
  select * into o from ordenes where id = p_orden for update;
  if not found then raise exception 'Pedido no encontrado' using errcode = 'P0002'; end if;
  if o.empresa_id <> v_emp then raise exception 'El pedido es de otra empresa: cámbiala en el menú superior' using errcode = 'P0001'; end if;
  if o.odoo_id is null or o.estado_odoo <> 'sale' then
    raise exception 'La nota de entrega nace de un pedido confirmado en Odoo con su albarán validado' using errcode = 'P0001';
  end if;
  if o.cliente_id is null then raise exception 'El pedido no tiene cliente en GUDS' using errcode = 'P0001'; end if;
  select * into c from clientes where id = o.cliente_id;

  drop table if exists _ne_l;
  create temp table _ne_l on commit drop as
    select l.*, coalesce((select (x->>'cantidad')::numeric from jsonb_array_elements(p_items) x
                           where (x->>'orden_item_id')::uuid = l.orden_item_id limit 1), case when p_items is null then l.pendiente end) cantidad
      from public.ne_lineas_pendientes(array[v_emp], p_orden, null) l;
  if p_items is not null then
    select count(*) into v_malas from jsonb_array_elements(p_items) x
     where not exists (select 1 from _ne_l l where l.orden_item_id = (x->>'orden_item_id')::uuid);
    if v_malas > 0 then raise exception 'Hay líneas que no son del pedido o ya no tienen nada por facturar' using errcode = '22023'; end if;
  end if;
  delete from _ne_l where coalesce(cantidad, 0) <= 0.0005;
  if not exists (select 1 from _ne_l) then
    raise exception 'El pedido % no tiene nada entregado sin facturar (o ya está en otra nota de entrega)', o.numero using errcode = 'P0001';
  end if;
  if exists (select 1 from _ne_l where cantidad > pendiente + 0.0005) then
    raise exception 'La cantidad no puede pasar de lo entregado y aún sin facturar' using errcode = '22023';
  end if;
  select round(sum(round(cantidad * precio, 2)), 2) into v_total from _ne_l;
  if coalesce(v_total, 0) <= 0.009 then raise exception 'La nota de entrega quedaría en cero (líneas sin precio)' using errcode = 'P0001'; end if;

  v_fecha := coalesce(p_fecha, o.fecha_despacho, v_hoy);
  if v_fecha > v_hoy then raise exception 'La fecha de emisión no puede ser futura' using errcode = '22023'; end if;
  v_vence := coalesce(p_vence, v_fecha + coalesce(c.dias_credito, 0));
  if v_vence < v_fecha then raise exception 'El vencimiento no puede ser anterior a la emisión' using errcode = '22023'; end if;

  insert into empresa_secuencias (empresa_id, tipo, ultimo) values (v_emp, 'NE', 1)
  on conflict (empresa_id, tipo) do update set ultimo = empresa_secuencias.ultimo + 1
  returning ultimo into v_n;

  insert into notas_entrega (empresa_id, serie, numero, cliente_id, cliente_nombre, vendedor_id, vendedor_nombre, orden_id, pedido_odoo,
                             fecha_emision, fecha_vencimiento, moneda, total_usd, estado, observacion, origen, created_by, updated_by)
  values (v_emp, 'NE', lpad(v_n::text, 6, '0'), c.id, c.nombre_negocio, coalesce(o.vendedor_id, c.vendedor_asignado_id),
          nullif(btrim(o.vendedor_odoo), ''), o.id, o.numero, v_fecha, v_vence, 'USD', v_total, 'emitida',
          nullif(btrim(coalesce(p_observacion, '')), ''), 'guds', v_yo, v_yo)
  returning id into v_id;
  insert into nota_entrega_items (nota_id, producto_id, descripcion, cantidad, precio_usd, subtotal_usd, orden, orden_item_id, facturada_base)
  select v_id, l.producto_id,
         -- el nombre de la línea de Odoo ya suele traer el código ("[310008856] …"): solo se agrega si no lo tiene
         case when l.sku is not null and position(l.sku in l.descripcion) = 0 then l.descripcion || ' [' || l.sku || ']' else l.descripcion end,
         l.cantidad, l.precio, round(l.cantidad * l.precio, 2),
         (row_number() over (order by l.descripcion))::smallint, l.orden_item_id, l.facturada
    from _ne_l l;
  return v_id;
end $$;
revoke all on function public.emitir_nota_entrega(uuid, jsonb, date, date, text) from public, anon;
grant execute on function public.emitir_nota_entrega(uuid, jsonb, date, date, text) to authenticated;

-- ── 7. Abonos: enlazados a un cobro de Odoo (el dinero entró por un banco de Odoo) ──
create or replace function public.cobros_para_nota_entrega(p_nota uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare n notas_entrega;
begin
  if auth.uid() is null or not (public.es_personal_admin() and public.puede('notas_entrega', 'editar')) then
    raise exception 'No tienes permiso para registrar abonos en notas de entrega' using errcode = '42501';
  end if;
  select * into n from notas_entrega where id = p_nota and empresa_id = any (public.empresas_visibles());
  if not found then raise exception 'Nota de entrega no encontrada' using errcode = 'P0002'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('pago_id', a.pago_id, 'numero', a.numero, 'fecha', a.fecha, 'monto', a.monto_usd,
             'disponible', a.disponible, 'referencia', nullif(btrim(p.referencia), ''), 'moneda', case when p.moneda = 'USD' then 'USD' else 'VES' end,
             'banco', coalesce(nullif(btrim(b.nombre), ''), nullif(btrim(p.banco), '')), 'vinculado_ne', a.vinculado_ne)
           order by a.fecha desc nulls last, a.numero)
      from v_anticipos a join pagos p on p.id = a.pago_id left join bancos b on b.id = p.banco_id
     where n.cliente_id is not null and a.cliente_id = n.cliente_id and a.empresa_id = n.empresa_id and a.odoo_id is not null
       and a.disponible > 0.009), '[]'::jsonb);
end $$;
revoke all on function public.cobros_para_nota_entrega(uuid) from public, anon;
grant execute on function public.cobros_para_nota_entrega(uuid) to authenticated;

-- p_pago: el cobro de Odoo (lo normal). Sin cobro solo si el dinero no pasó por Odoo (p. ej. clientes sin ficha): pide referencia.
create or replace function public.abonar_nota_entrega(p_nota uuid, p_monto numeric, p_pago uuid default null,
  p_fecha date default null, p_referencia text default null, p_nota_texto text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.ne_contexto('editar');
  v_yo uuid := (select id from usuarios where auth_id = auth.uid());
  v_hoy date := (now() at time zone 'America/Caracas')::date;
  n notas_entrega; p pagos; v_saldo numeric; v_disp numeric; v_id uuid; v_fecha date; v_ref text;
begin
  select * into n from notas_entrega where id = p_nota for update;
  if not found then raise exception 'Nota de entrega no encontrada' using errcode = 'P0002'; end if;
  if n.empresa_id <> v_emp then raise exception 'La nota es de otra empresa: cámbiala en el menú superior' using errcode = 'P0001'; end if;
  if n.estado in ('anulada', 'borrador') then raise exception 'La nota de entrega está %', n.estado using errcode = 'P0001'; end if;
  if coalesce(p_monto, 0) <= 0.009 then raise exception 'El monto debe ser mayor que cero' using errcode = '22023'; end if;
  select saldo into v_saldo from public.ne_saldos(null, array[p_nota]);
  if p_monto > v_saldo + 0.009 then
    raise exception 'El abono (USD %) pasa del saldo de la nota (USD %)', round(p_monto, 2), v_saldo using errcode = '22023';
  end if;
  v_ref := nullif(btrim(coalesce(p_referencia, '')), '');
  if p_pago is not null then
    select * into p from pagos where id = p_pago for update;
    if not found then raise exception 'Cobro no encontrado' using errcode = 'P0002'; end if;
    if p.estado::text <> 'verificado' then raise exception 'El cobro % no está verificado', p.numero using errcode = 'P0001'; end if;
    if p.odoo_id is null then raise exception 'Solo se enlazan cobros registrados en Odoo' using errcode = 'P0001'; end if;
    if p.cliente_id is distinct from n.cliente_id or p.empresa_id <> n.empresa_id then
      raise exception 'El cobro % es de otro cliente o de otra empresa', p.numero using errcode = 'P0001';
    end if;
    select disponible into v_disp from v_anticipos where pago_id = p_pago;
    if coalesce(v_disp, 0) < p_monto - 0.009 then
      raise exception 'Al cobro % solo le quedan USD % sin aplicar', p.numero, coalesce(v_disp, 0) using errcode = 'P0001';
    end if;
    v_fecha := coalesce(p.fecha_pago, v_hoy);
    v_ref := coalesce(v_ref, p.numero);
  else
    if v_ref is null then
      raise exception 'Sin cobro de Odoo hace falta la referencia del pago (solo si el dinero no entró por un banco de Odoo)' using errcode = '22023';
    end if;
    v_fecha := coalesce(p_fecha, v_hoy);
    if v_fecha > v_hoy then raise exception 'La fecha no puede ser futura' using errcode = '22023'; end if;
  end if;
  insert into nota_entrega_movimientos (nota_id, tipo, fecha, monto_usd, pago_id, referencia, nota, origen, created_by)
  values (p_nota, 'abono', v_fecha, round(p_monto, 2), p_pago, v_ref, nullif(btrim(coalesce(p_nota_texto, '')), ''), 'guds', v_yo)
  returning id into v_id;
  update notas_entrega set updated_at = now(), updated_by = v_yo where id = p_nota;
  perform public.ne_recalcular_estado(p_nota);
  return v_id;
end $$;
revoke all on function public.abonar_nota_entrega(uuid, numeric, uuid, date, text, text) from public, anon;
grant execute on function public.abonar_nota_entrega(uuid, numeric, uuid, date, text, text) to authenticated;

-- ── 8. Conversión a factura (con sugerencia) ─────────────────────────────
-- Facturas candidatas: las del pedido de la N/E emitidas desde la N/E (sugerencia por lo que Odoo facturó de sus líneas
-- después de emitirla) y, sin pedido, las del mismo cliente desde la emisión (sugerencia: su base, hasta lo sin facturar).
create or replace function public.ne_sugerencias(p_notas uuid[] default null, p_empresas uuid[] default null)
returns table (nota_id uuid, factura_id uuid, numero text, fecha date, base_usd numeric, del_pedido boolean, sugerido numeric)
language sql stable security definer set search_path = public as $$
  with n as (
    select n.*, s.sin_facturar, s.facturado
      from notas_entrega n join public.ne_saldos(null, p_notas) s on s.nota_id = n.id
     where n.estado not in ('anulada', 'borrador') and n.cliente_id is not null and s.sin_facturar > 0.009
       and (p_empresas is null or n.empresa_id = any (p_empresas))
  ),
  q as (   -- lo que Odoo facturó de las líneas de la N/E después de emitirla, en USD sin IVA
    select i.nota_id, round(sum(least(i.cantidad, greatest(0, coalesce(oi.cantidad_facturada, 0) - coalesce(i.facturada_base, 0))) * i.precio_usd), 2) usd
      from nota_entrega_items i join orden_items oi on oi.id = i.orden_item_id
     where i.nota_id in (select id from n)
     group by i.nota_id
  )
  select n.id, f.id, f.numero, f.fecha_emision,
         round(case when f.total <> 0 then f.subtotal * f.total_usd / f.total else f.total_usd end, 2),
         n.orden_id is not null and f.orden_id = n.orden_id,
         greatest(0, round(least(n.sin_facturar,
           case when n.orden_id is not null and f.orden_id = n.orden_id then coalesce(q.usd, 0) - n.facturado
                else case when f.total <> 0 then f.subtotal * f.total_usd / f.total else f.total_usd end end), 2))
    from n
    join facturas f on f.cliente_id = n.cliente_id and f.empresa_id = n.empresa_id and f.estado = 'posted' and f.tipo = 'factura'
                   and not coalesce(f.es_nota_debito, false) and not coalesce(f.es_saldo_inicial, false)
                   and f.fecha_emision >= n.fecha_emision
                   and (n.orden_id is null or f.orden_id = n.orden_id)
    left join q on q.nota_id = n.id
   where not exists (select 1 from nota_entrega_movimientos m where m.nota_id = n.id and m.factura_id = f.id)
$$;
revoke all on function public.ne_sugerencias(uuid[], uuid[]) from public, anon, authenticated;

create or replace function public.conversion_nota_entrega(p_nota uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not (public.es_personal_admin() and public.puede('notas_entrega', 'ver')) then
    raise exception 'No tienes permiso para ver notas de entrega' using errcode = '42501';
  end if;
  if not exists (select 1 from notas_entrega where id = p_nota and empresa_id = any (public.empresas_visibles())) then
    raise exception 'Nota de entrega no encontrada' using errcode = 'P0002';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('factura_id', s.factura_id, 'numero', s.numero, 'fecha', s.fecha, 'base', s.base_usd,
                     'del_pedido', s.del_pedido, 'sugerido', s.sugerido) order by s.del_pedido desc, s.sugerido desc, s.fecha)
                    from public.ne_sugerencias(array[p_nota]) s), '[]'::jsonb);
end $$;
revoke all on function public.conversion_nota_entrega(uuid) from public, anon;
grant execute on function public.conversion_nota_entrega(uuid) to authenticated;

create or replace function public.convertir_nota_entrega(p_nota uuid, p_factura uuid, p_monto numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.ne_contexto('editar');
  v_yo uuid := (select id from usuarios where auth_id = auth.uid());
  n notas_entrega; f facturas; s record; v_monto numeric; v_sug numeric; v_id uuid; v_tras numeric;
begin
  select * into n from notas_entrega where id = p_nota for update;
  if not found then raise exception 'Nota de entrega no encontrada' using errcode = 'P0002'; end if;
  if n.empresa_id <> v_emp then raise exception 'La nota es de otra empresa: cámbiala en el menú superior' using errcode = 'P0001'; end if;
  if n.estado in ('anulada', 'borrador') then raise exception 'La nota de entrega está %', n.estado using errcode = 'P0001'; end if;
  select * into f from facturas where id = p_factura;
  if not found or f.estado <> 'posted' or f.tipo <> 'factura' then raise exception 'Factura no encontrada o no vigente' using errcode = 'P0002'; end if;
  if f.cliente_id is distinct from n.cliente_id or f.empresa_id <> n.empresa_id then
    raise exception 'La factura % es de otro cliente o de otra empresa', f.numero using errcode = 'P0001';
  end if;
  if exists (select 1 from nota_entrega_movimientos where nota_id = p_nota and factura_id = p_factura) then
    raise exception 'La factura % ya está registrada en esta nota de entrega', f.numero using errcode = 'P0001';
  end if;
  select * into s from public.ne_saldos(null, array[p_nota]);
  select x.sugerido into v_sug from public.ne_sugerencias(array[p_nota]) x where x.factura_id = p_factura;
  v_monto := round(coalesce(p_monto, nullif(v_sug, 0), s.sin_facturar), 2);
  if v_monto <= 0.009 then raise exception 'El monto debe ser mayor que cero' using errcode = '22023'; end if;
  if v_monto > s.sin_facturar + 0.009 then
    raise exception 'Solo quedan USD % de la nota sin facturar', s.sin_facturar using errcode = '22023';
  end if;
  insert into nota_entrega_movimientos (nota_id, tipo, fecha, monto_usd, factura_id, referencia, nota, origen, created_by)
  values (p_nota, 'facturada', f.fecha_emision, v_monto, f.id, f.numero, 'Pasó a la factura ' || f.numero, 'guds', v_yo)
  returning id into v_id;
  v_tras := public.ne_trasladar_excedente(p_nota, f.fecha_emision,
    'Trasladado a la factura ' || f.numero || ': aplicar este cobro a la factura en Odoo');
  update notas_entrega set updated_at = now(), updated_by = v_yo where id = p_nota;
  return jsonb_build_object('movimiento_id', v_id, 'monto', v_monto, 'trasladado', v_tras, 'estado', public.ne_recalcular_estado(p_nota));
end $$;
revoke all on function public.convertir_nota_entrega(uuid, uuid, numeric) from public, anon;
grant execute on function public.convertir_nota_entrega(uuid, uuid, numeric) to authenticated;

-- ── 9. Descuento, devolución y ajuste ────────────────────────────────────
create or replace function public.ajustar_nota_entrega(p_nota uuid, p_tipo text, p_monto numeric, p_motivo text, p_fecha date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.ne_contexto('editar');
  v_yo uuid := (select id from usuarios where auth_id = auth.uid());
  v_hoy date := (now() at time zone 'America/Caracas')::date;
  n notas_entrega; s record; v_id uuid; v_fecha date := coalesce(p_fecha, (now() at time zone 'America/Caracas')::date); v_tras numeric;
begin
  if p_tipo not in ('descuento', 'devolucion', 'ajuste') then raise exception 'Tipo no válido' using errcode = '22023'; end if;
  if nullif(btrim(coalesce(p_motivo, '')), '') is null then raise exception 'Escribe el motivo' using errcode = '22023'; end if;
  if v_fecha > v_hoy then raise exception 'La fecha no puede ser futura' using errcode = '22023'; end if;
  select * into n from notas_entrega where id = p_nota for update;
  if not found then raise exception 'Nota de entrega no encontrada' using errcode = 'P0002'; end if;
  if n.empresa_id <> v_emp then raise exception 'La nota es de otra empresa: cámbiala en el menú superior' using errcode = 'P0001'; end if;
  if n.estado in ('anulada', 'borrador') then raise exception 'La nota de entrega está %', n.estado using errcode = 'P0001'; end if;
  select * into s from public.ne_saldos(null, array[p_nota]);
  if coalesce(p_monto, 0) = 0 or (p_tipo <> 'ajuste' and p_monto < 0) then raise exception 'Monto no válido' using errcode = '22023'; end if;
  if p_tipo in ('descuento', 'devolucion') and p_monto > s.sin_facturar + 0.009 then
    raise exception 'Solo quedan USD % de la nota sin facturar', s.sin_facturar using errcode = '22023';
  end if;
  if p_tipo = 'ajuste' and (p_monto > s.saldo + 0.009 or abs(p_monto) > n.total_usd + 0.009) then
    raise exception 'El ajuste no puede pasar del saldo (USD %)', s.saldo using errcode = '22023';
  end if;
  insert into nota_entrega_movimientos (nota_id, tipo, fecha, monto_usd, nota, origen, created_by)
  values (p_nota, p_tipo, v_fecha, round(p_monto, 2), btrim(p_motivo), 'guds', v_yo) returning id into v_id;
  v_tras := public.ne_trasladar_excedente(p_nota, v_fecha, 'Excedente por ' || p_tipo || ': vuelve a ser saldo a favor del cliente');
  update notas_entrega set updated_at = now(), updated_by = v_yo where id = p_nota;
  return jsonb_build_object('movimiento_id', v_id, 'trasladado', v_tras, 'estado', public.ne_recalcular_estado(p_nota));
end $$;
revoke all on function public.ajustar_nota_entrega(uuid, text, numeric, text, date) from public, anon;
grant execute on function public.ajustar_nota_entrega(uuid, text, numeric, text, date) to authenticated;

-- ── 10. Quitar un movimiento y anular una nota (a la papelera, restaurables) ──
create or replace function public.quitar_movimiento_nota_entrega(p_movimiento uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.ne_contexto('eliminar'); m nota_entrega_movimientos; n notas_entrega; v_pap uuid;
begin
  if nullif(btrim(coalesce(p_motivo, '')), '') is null then raise exception 'Escribe el motivo' using errcode = '22023'; end if;
  select * into m from nota_entrega_movimientos where id = p_movimiento for update;
  if not found then raise exception 'Movimiento no encontrado' using errcode = 'P0002'; end if;
  select * into n from notas_entrega where id = m.nota_id for update;
  if n.empresa_id <> v_emp then raise exception 'La nota es de otra empresa: cámbiala en el menú superior' using errcode = 'P0001'; end if;
  if m.origen <> 'guds' then raise exception 'Los abonos del Excel de finanzas no se quitan desde aquí' using errcode = 'P0001'; end if;
  v_pap := public.papelera_guardar('movimiento_nota_entrega', 'anulado', m.id, n.serie || ' ' || n.numero, n.empresa_id, n.cliente_id, m.monto_usd,
    case m.tipo when 'abono' then 'Abono' when 'facturada' then 'Paso a factura' when 'devolucion' then 'Devolución'
                when 'descuento' then 'Descuento' else 'Ajuste' end || ' de la nota de entrega ' || n.serie || ' ' || n.numero,
    'USD ' || to_char(m.monto_usd, 'FM999G999G990D00') || coalesce(' · ' || m.referencia, ''),
    jsonb_build_object('movimiento', to_jsonb(m)), p_motivo, true);
  delete from nota_entrega_movimientos where id = m.id;
  update notas_entrega set updated_at = now() where id = n.id;
  return jsonb_build_object('papelera_id', v_pap, 'estado', public.ne_recalcular_estado(n.id));
end $$;
revoke all on function public.quitar_movimiento_nota_entrega(uuid, text) from public, anon;
grant execute on function public.quitar_movimiento_nota_entrega(uuid, text) to authenticated;

create or replace function public.papelera_restaurar_movimiento_nota_entrega(p_item public.papelera)
returns void language plpgsql security definer set search_path = public as $$
declare m nota_entrega_movimientos; n notas_entrega; v_disp numeric;
begin
  if not public.puede('notas_entrega', 'editar') then raise exception 'No tienes permiso sobre notas de entrega' using errcode = '42501'; end if;
  m := jsonb_populate_record(null::nota_entrega_movimientos, p_item.datos->'movimiento');
  select * into n from notas_entrega where id = m.nota_id for update;
  if not found or n.estado = 'anulada' then raise exception 'La nota de entrega % ya no está vigente', p_item.numero using errcode = 'P0001'; end if;
  if m.tipo = 'abono' and m.pago_id is not null and m.trasladado is null then
    select disponible into v_disp from v_anticipos where pago_id = m.pago_id;
    if coalesce(v_disp, 0) < m.monto_usd - 0.009 then
      raise exception 'El cobro ya no tiene USD % sin aplicar: no se puede restaurar el abono', m.monto_usd using errcode = 'P0001';
    end if;
  end if;
  insert into nota_entrega_movimientos select (m).* on conflict (id) do nothing;
  perform public.ne_trasladar_excedente(n.id, (now() at time zone 'America/Caracas')::date, 'Excedente al restaurar un movimiento');
  perform public.ne_recalcular_estado(n.id);
end $$;
revoke all on function public.papelera_restaurar_movimiento_nota_entrega(public.papelera) from public, anon, authenticated;

create or replace function public.anular_nota_entrega(p_nota uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.ne_contexto('eliminar'); v_yo uuid := (select id from usuarios where auth_id = auth.uid());
        n notas_entrega; v_pap uuid; v_movs integer;
begin
  if nullif(btrim(coalesce(p_motivo, '')), '') is null then raise exception 'Escribe el motivo' using errcode = '22023'; end if;
  select * into n from notas_entrega where id = p_nota for update;
  if not found then raise exception 'Nota de entrega no encontrada' using errcode = 'P0002'; end if;
  if n.empresa_id <> v_emp then raise exception 'La nota es de otra empresa: cámbiala en el menú superior' using errcode = 'P0001'; end if;
  if n.estado = 'anulada' then raise exception 'La nota de entrega ya está anulada' using errcode = 'P0001'; end if;
  select count(*) into v_movs from nota_entrega_movimientos where nota_id = p_nota and origen = 'guds';
  if v_movs > 0 then
    raise exception 'La nota tiene % movimiento(s) registrados en GUDS: quítalos antes de anularla', v_movs using errcode = 'P0001';
  end if;
  v_pap := public.papelera_guardar('nota_entrega', 'anulado', n.id, n.serie || ' ' || n.numero, n.empresa_id, n.cliente_id, n.total_usd,
    'Nota de entrega ' || n.serie || ' ' || n.numero, coalesce(n.cliente_nombre, '') || ' · USD ' || to_char(n.total_usd, 'FM999G999G990D00'),
    jsonb_build_object('nota', to_jsonb(n),
      'items', coalesce((select jsonb_agg(to_jsonb(i)) from nota_entrega_items i where i.nota_id = n.id), '[]'::jsonb),
      'movimientos', coalesce((select jsonb_agg(to_jsonb(m)) from nota_entrega_movimientos m where m.nota_id = n.id), '[]'::jsonb)),
    p_motivo, true);
  update notas_entrega set estado = 'anulada', anulada_at = now(), anulada_por = v_yo, motivo_anulacion = btrim(p_motivo),
         updated_at = now(), updated_by = v_yo
   where id = p_nota;
  return jsonb_build_object('papelera_id', v_pap);
end $$;
revoke all on function public.anular_nota_entrega(uuid, text) from public, anon;
grant execute on function public.anular_nota_entrega(uuid, text) to authenticated;

create or replace function public.papelera_restaurar_nota_entrega(p_item public.papelera)
returns void language plpgsql security definer set search_path = public as $$
declare n notas_entrega;
begin
  if not public.puede('notas_entrega', 'editar') then raise exception 'No tienes permiso sobre notas de entrega' using errcode = '42501'; end if;
  select * into n from notas_entrega where id = p_item.registro_id for update;
  if not found then raise exception 'La nota de entrega % ya no existe', p_item.numero using errcode = 'P0001'; end if;
  if n.estado <> 'anulada' then raise exception 'La nota de entrega % ya no está anulada', p_item.numero using errcode = 'P0001'; end if;
  -- Lo que se entregue de su pedido después en otra N/E no puede quedar dos veces
  if n.orden_id is not null and exists (
       select 1 from nota_entrega_items i
         left join public.ne_lineas_pendientes(array[n.empresa_id], n.orden_id, null) l on l.orden_item_id = i.orden_item_id
        where i.nota_id = n.id and i.orden_item_id is not null and i.cantidad > coalesce(l.pendiente, 0) + 0.0005) then
    raise exception 'Lo de su pedido ya está en otra nota de entrega o ya se facturó: no se puede restaurar' using errcode = 'P0001';
  end if;
  update notas_entrega set estado = 'emitida', anulada_at = null, anulada_por = null, motivo_anulacion = null, updated_at = now() where id = n.id;
  perform public.ne_recalcular_estado(n.id);
end $$;
revoke all on function public.papelera_restaurar_nota_entrega(public.papelera) from public, anon, authenticated;

-- ── 11. Alertas (torre de control) y cartera del vendedor ────────────────
create or replace function public.alertas_notas_entrega()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_emps uuid[] := public.empresas_visibles(); v_hoy date := (now() at time zone 'America/Caracas')::date; v jsonb;
begin
  if auth.uid() is null or not (public.es_personal_admin() and public.puede('notas_entrega', 'ver')) then
    return jsonb_build_object('por_emitir', 0, 'por_convertir', 0, 'vencidas', 0, 'por_convertir_ids', '[]'::jsonb);
  end if;
  select jsonb_build_object(
    'por_emitir', (select count(distinct l.orden_id) from public.ne_lineas_pendientes(v_emps) l where l.pendiente > 0.0005),
    'por_convertir', (select count(distinct s.nota_id) from public.ne_sugerencias(null, v_emps) s where s.del_pedido and s.sugerido > 0.009),
    'por_convertir_ids', coalesce((select jsonb_agg(distinct s.nota_id) from public.ne_sugerencias(null, v_emps) s where s.del_pedido and s.sugerido > 0.009), '[]'::jsonb),
    'vencidas', (select count(*) from notas_entrega n join public.ne_saldos(null) s on s.nota_id = n.id
                  where n.empresa_id = any (v_emps) and n.estado not in ('anulada', 'borrador') and s.saldo > 0.009
                    and coalesce(n.fecha_vencimiento, n.fecha_emision) < v_hoy
                    and coalesce(n.clasificacion, (select g.clasificacion from cobranza_gestion g where g.cliente_id = n.cliente_id and g.factura_id is null), 'activa') = 'activa'))
    into v;
  return v;
end $$;
revoke all on function public.alertas_notas_entrega() from public, anon;
grant execute on function public.alertas_notas_entrega() to authenticated;

-- Las del vendedor: notas con saldo de los clientes de su cartera (solo consulta, en su portal)
create or replace function public.notas_entrega_vendedor()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_hoy date := (now() at time zone 'America/Caracas')::date;
begin
  if auth.uid() is null then raise exception 'Sin sesión' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', n.id, 'cliente_id', n.cliente_id, 'documento', n.serie || ' ' || n.numero,
             'emision', n.fecha_emision, 'vence', coalesce(n.fecha_vencimiento, n.fecha_emision),
             'dias', v_hoy - coalesce(n.fecha_vencimiento, n.fecha_emision), 'total', n.total_usd, 'saldo', s.saldo, 'estado', n.estado)
           order by n.fecha_emision)
      from notas_entrega n join public.ne_saldos(null) s on s.nota_id = n.id
     where n.cliente_id in (select public.mis_clientes_vendedor()) and n.estado not in ('anulada', 'borrador') and s.saldo > 0.009), '[]'::jsonb);
end $$;
revoke all on function public.notas_entrega_vendedor() from public, anon;
grant execute on function public.notas_entrega_vendedor() to authenticated;

-- ── 12. Las N/E cuentan como venta (lo no facturado) ─────────────────────
drop function if exists public.ventas_con_iva(date, date, uuid[]);
create or replace function public.ventas_con_iva(p_desde date, p_hasta date, p_empresas uuid[], p_ne boolean default false)
returns table (empresa_id uuid, cliente_id uuid, cliente_clave text, cliente_nombre text, fecha date, venta_usd numeric, fuente text)
language sql stable security definer set search_path = public
as $$
  select d.empresa_id, d.cliente_id,
         coalesce(d.cliente_id::text, 'profit:' || d.empresa_id::text || ':' || coalesce(d.cliente_codigo, '')),
         d.cliente_nombre, d.fecha, d.total_usd, 'profit'
    from profit_documentos d
   where d.lote = public.profit_lote_vigente() and d.empresa_id = any (p_empresas) and d.fecha between p_desde and p_hasta
  union all
  select f.empresa_id, f.cliente_id, f.cliente_id::text, null, f.fecha_emision, f.total_usd, 'odoo'
    from facturas f
   where f.estado = 'posted' and not coalesce(f.es_saldo_inicial, false) and f.empresa_id = any (p_empresas)
     and f.fecha_emision between p_desde and p_hasta and f.cliente_id is not null
  union all
  -- 22j: notas de entrega (sin IVA), por lo que no pasó a factura (lo facturado cuenta en su factura) ni se devolvió
  select n.empresa_id, n.cliente_id,
         coalesce(n.cliente_id::text, 'ne:' || n.empresa_id::text || ':' || public.clasif_norm(n.cliente_nombre)),
         n.cliente_nombre, n.fecha_emision, s.sin_facturar, 'nota_entrega'
    from notas_entrega n join public.ne_saldos(p_hasta) s on s.nota_id = n.id
   where coalesce(p_ne, false) and n.empresa_id = any (p_empresas) and n.estado not in ('borrador', 'anulada')
     and n.fecha_emision between p_desde and p_hasta and abs(s.sin_facturar) > 0.004
$$;
comment on function public.ventas_con_iva(date, date, uuid[], boolean) is
  'Venta con IVA por documento (22h, D6): Profit (todo el histórico) + Odoo (sin saldos iniciales) y, con p_ne, las notas de entrega (lo no facturado, 22j). Interna';
revoke execute on function public.ventas_con_iva(date, date, uuid[], boolean) from public, anon, authenticated;

create or replace function public.recuperacion_calculo(p_corte date, p_empresas uuid[], p_ne boolean default true, p_clientes uuid[] default null)
returns table (cliente_id uuid, empresa_id uuid, deuda_fiscal numeric, notas_entrega numeric, deuda numeric, impuesto numeric,
  venta_12m numeric, meses integer, promedio numeric, dias integer, venta_5m numeric, compra_90d numeric, primera_compra date, ultima_compra date)
language sql stable security definer set search_path = public
as $$
  with
  p as (
    select x.cliente_id, x.empresa_id,
           coalesce(sum(x.saldo_usd) filter (where x.tipo <> 'nota_entrega'), 0) fiscal,
           coalesce(sum(x.saldo_usd) filter (where x.tipo = 'nota_entrega'), 0) ne,
           coalesce(sum(x.saldo_usd) filter (where x.clase in ('retencion', 'impuesto')), 0) imp
      from public.partidas_cobranza(p_corte, p_empresas, p_ne) x
     where x.cliente_id is not null and (p_clientes is null or x.cliente_id = any (p_clientes))
     group by 1, 2
  ),
  v as (
    select x.cliente_id, x.empresa_id,
           sum(x.venta_usd) v12,
           coalesce(sum(x.venta_usd) filter (where x.fecha > (p_corte - interval '5 months')::date), 0) v5,
           coalesce(sum(x.venta_usd) filter (where x.fecha > (p_corte - interval '3 months')::date), 0) v3,
           max(x.fecha) filter (where x.venta_usd > 0) ultima
      from public.ventas_con_iva((p_corte - interval '12 months')::date + 1, p_corte, p_empresas, p_ne) x
     where x.cliente_id is not null and (p_clientes is null or x.cliente_id = any (p_clientes))
     group by 1, 2
  ),
  c as (
    select coalesce(p.cliente_id, v.cliente_id) cliente_id, coalesce(p.empresa_id, v.empresa_id) empresa_id,
           coalesce(p.fiscal, 0) fiscal, coalesce(p.ne, 0) ne, coalesce(p.imp, 0) imp,
           coalesce(v.v12, 0) v12, coalesce(v.v5, 0) v5, coalesce(v.v3, 0) v3, v.ultima
      from p full join v on v.cliente_id = p.cliente_id
  ),
  -- Primera compra (Profit, Odoo con las facturas migradas como saldo inicial y, con p_ne, las notas de entrega)
  pc as (
    select y.cliente_id, min(y.f) primera from (
      select d.cliente_id, min(d.fecha) f from profit_documentos d
       where d.lote = public.profit_lote_vigente() and d.tipo = 'factura' and d.cliente_id in (select cliente_id from c) group by 1
      union all
      select f.cliente_id, min(f.fecha_emision) from facturas f
       where f.estado = 'posted' and f.tipo = 'factura' and f.cliente_id in (select cliente_id from c) group by 1
      union all
      select n.cliente_id, min(n.fecha_emision) from notas_entrega n
       where coalesce(p_ne, true) and n.estado not in ('borrador', 'anulada') and n.cliente_id in (select cliente_id from c) group by 1
    ) y group by 1
  )
  select c.cliente_id, c.empresa_id, round(c.fiscal, 2), round(c.ne, 2), round(c.fiscal + c.ne, 2), round(c.imp, 2),
         round(c.v12, 2), m.meses, round(c.v12 / m.meses, 2),
         case when c.fiscal + c.ne <= 0.009 then 0
              when c.v12 > 0.009 then round((c.fiscal + c.ne) / (c.v12 / m.meses) * 30)::integer end,
         round(c.v5, 2), round(c.v3, 2), pc.primera, c.ultima
    from c
    left join pc on pc.cliente_id = c.cliente_id
    cross join lateral (
      select greatest(1, least(12, case when pc.primera is null then 12
               else (extract(year from p_corte)::int * 12 + extract(month from p_corte)::int)
                  - (extract(year from pc.primera)::int * 12 + extract(month from pc.primera)::int) + 1 end))::integer meses) m
$$;
comment on function public.recuperacion_calculo(date, uuid[], boolean, uuid[]) is
  'Días de recuperación por cliente al corte (22h, D6): deuda neta ÷ venta promedio mensual de 12 meses (con IVA) × 30; clientes nuevos: meses desde la primera compra. Con p_ne, las notas de entrega suman a la deuda y a la venta (22j). Interna';
revoke execute on function public.recuperacion_calculo(date, uuid[], boolean, uuid[]) from public, anon, authenticated;

-- ── 13. Partidas al corte: N/E con ne_saldos y anticipos sin lo que pagan de N/E ──
create or replace function public.partidas_cobranza(p_corte date, p_empresas uuid[], p_ne boolean default true)
returns table (
  ref text, tipo text, clase text, falta text, empresa_id uuid, documento_id uuid, numero text, cliente_id uuid, cliente_nombre text,
  vendedor text, emision date, vence date, moneda text, total_usd numeric, saldo_usd numeric, clasificacion text, clasificacion_origen text
)
language sql stable security definer set search_path = public
as $$
  with
  docs as materialized (
    select f.id, f.empresa_id, f.cliente_id, f.numero, f.tipo, coalesce(f.es_nota_debito, false) es_nd, f.fecha_emision, f.fecha_vencimiento,
           f.moneda, f.total_usd, f.saldo_usd, f.vendedor_odoo,
           case when f.total <> 0 then f.subtotal * f.total_usd / f.total else f.total_usd end base_usd,
           case when f.total <> 0 then f.impuesto * f.total_usd / f.total else 0 end iva_usd
      from facturas f
     where f.estado = 'posted' and f.empresa_id = any (p_empresas)
       and coalesce(f.fecha_emision, date '1900-01-01') <= p_corte
       and not ((f.tipo = 'nota_credito' or coalesce(f.es_nota_debito, false))
                and abs(coalesce(f.total_usd, 0)) < 0.005 and abs(coalesce(f.saldo_usd, 0)) < 0.005)
  ),
  ab0 as (
    select fa.factura_id doc, fa.fecha, fa.tipo, fa.monto_usd monto, fa.pago_id, fa.descripcion, null::text ret_tipo
      from factura_aplicaciones fa join docs d on d.id = fa.factura_id
    union all
    select fa.documento_id, fa.fecha, 'aplicada', fa.monto_usd, null::uuid, fa.descripcion, null::text
      from factura_aplicaciones fa join docs d on d.id = fa.documento_id
     where fa.tipo = 'nota_credito' and d.tipo = 'nota_credito'
    union all
    select pf.factura_id, coalesce(p.fecha_pago, (coalesce(p.fecha_verificacion, p.created_at) at time zone 'America/Caracas')::date),
           'pago', pf.monto_aplicado, pf.pago_id, null::text, null::text
      from pago_facturas pf join docs d on d.id = pf.factura_id join pagos p on p.id = pf.pago_id
     where p.estado = 'verificado'
    union all
    select ri.factura_id, r.fecha, 'retencion', ri.monto_aplicado, null::uuid, coalesce(nullif(btrim(r.numero_comprobante), ''), r.numero), r.tipo::text
      from retencion_items ri join retenciones r on r.id = ri.retencion_id join docs d on d.id = ri.factura_id
     where r.estado = 'aprobado' and r.odoo_id is null
  ),
  ab as (
    select a.doc, a.monto, (a.fecha is not null and a.fecha > p_corte) futuro,
           case a.tipo when 'pago' then 'pagos' when 'nota_credito' then 'nc' when 'aplicada' then 'nc' when 'retencion' then 'retenciones'
                       else 'otros' end col,
           case when a.tipo = 'retencion' then
             case when coalesce(a.ret_tipo, '') = 'iva' or coalesce(a.descripcion, '') ~* '^IVA' then 'iva'
                  when coalesce(a.ret_tipo, '') = 'municipal' or coalesce(a.descripcion, '') ~* '^RETRS' then 'municipal'
                  else coalesce(a.ret_tipo, 'otra') end end clase_ret,
           (a.tipo = 'pago' and p.moneda = 'USD' and not coalesce(p.es_igtf, false)) divisa
      from ab0 a left join pagos p on p.id = a.pago_id
     where abs(a.monto) >= 0.005
  ),
  agg as (
    select d.id,
           coalesce(sum(a.monto) filter (where a.col = 'pagos' and not a.futuro), 0) pagos,
           coalesce(sum(a.monto) filter (where a.col = 'nc' and not a.futuro), 0) nc,
           coalesce(sum(a.monto) filter (where a.col = 'retenciones' and not a.futuro), 0) retenciones,
           coalesce(sum(a.monto) filter (where a.col = 'otros' and not a.futuro), 0) otros,
           coalesce(sum(a.monto) filter (where a.clase_ret = 'iva' and not a.futuro), 0) ret_iva,
           coalesce(sum(a.monto) filter (where a.clase_ret = 'municipal' and not a.futuro), 0) ret_mun,
           coalesce(sum(a.monto) filter (where a.divisa and not a.futuro), 0) pagos_div,
           coalesce(sum(a.monto) filter (where a.futuro), 0) despues
      from docs d left join ab a on a.doc = d.id
     group by d.id
  ),
  abiertos as materialized (
    select x.* from (
      select d.*, g.pagos, g.nc, g.retenciones, g.otros, g.ret_iva, g.ret_mun, g.pagos_div,
             case when d.tipo = 'nota_credito' then d.saldo_usd - g.despues else d.saldo_usd + g.despues end saldo
        from docs d join agg g on g.id = d.id) x
     where abs(x.saldo) > 0.009
  ),
  ret_pct as (
    select h.cliente_id, h.empresa_id,
           case when percentile_cont(0.5) within group (order by h.r) >= 0.875 then 1.0 when count(*) > 0 then 0.75 end pct
      from (select f.cliente_id, f.empresa_id, fa.monto_usd / nullif(f.impuesto * f.total_usd / nullif(f.total, 0), 0) r
              from factura_aplicaciones fa join facturas f on f.id = fa.factura_id
             where fa.tipo = 'retencion' and fa.descripcion ~* '^IVA' and fa.monto_usd > 0.009 and f.impuesto > 0
               and f.empresa_id = any (p_empresas)) h
     where h.r is not null
     group by h.cliente_id, h.empresa_id
  ),
  ret_mun as (
    select f.cliente_id, f.empresa_id from factura_aplicaciones fa join facturas f on f.id = fa.factura_id
     where fa.tipo = 'retencion' and fa.descripcion ~* '^RETRS' and fa.monto_usd > 0.009 and f.empresa_id = any (p_empresas)
    union
    select r.cliente_id, r.empresa_id from retenciones r
     where r.tipo = 'municipal' and r.estado = 'aprobado' and r.empresa_id = any (p_empresas)
  ),
  igtf as (select distinct p.empresa_id from pagos p where p.es_igtf and p.empresa_id = any (p_empresas)),
  qf as (
    select b.id, x.codigo, x.texto
      from abiertos b
      left join ret_pct rp on rp.cliente_id = b.cliente_id and rp.empresa_id = b.empresa_id
      left join lateral (select true si from ret_mun rm where rm.cliente_id = b.cliente_id and rm.empresa_id = b.empresa_id limit 1) mu on true
      left join igtf ig on ig.empresa_id = b.empresa_id
      cross join lateral (
        select c.codigo, c.texto from (
          select v.orden, v.codigo, v.texto
            from (values
              (1, 'iva_no_retenido', 'Pendiente el IVA no retenido',
                  case when b.ret_iva > 0.009 and b.iva_usd - b.ret_iva > 0.009 then b.iva_usd - b.ret_iva end),
              (2, 'retencion_iva', 'Retención de IVA por recibir (' || to_char(coalesce(rp.pct, 0.75) * 100, 'FM990') || ' %)',
                  case when b.ret_iva <= 0.009 and b.iva_usd > 0.009 then coalesce(rp.pct, 0.75) * b.iva_usd end),
              (3, 'iva', 'Pendiente el IVA',
                  case when b.iva_usd > 0.009 and b.ret_iva <= 0.009 then b.iva_usd end),
              (4, 'igtf', 'Pendiente el IGTF (3 % de los pagos en divisas)',
                  case when ig.empresa_id is not null and b.pagos_div > 0.009 then 0.03 * b.pagos_div end),
              (5, 'retencion_municipal', 'Retención municipal por recibir (1,25 %)',
                  case when mu.si and b.ret_mun <= 0.009 and b.base_usd > 0.009 then 0.0125 * b.base_usd end),
              (6, 'retenciones', 'Retenciones de IVA y municipal por recibir',
                  case when rp.pct is not null and mu.si and b.ret_iva <= 0.009 and b.ret_mun <= 0.009 and b.iva_usd > 0.009
                       then rp.pct * b.iva_usd + 0.0125 * b.base_usd end),
              (7, 'iva_no_retenido_municipal', 'Pendiente el IVA no retenido y la retención municipal',
                  case when mu.si and b.ret_iva > 0.009 and b.ret_mun <= 0.009 and b.iva_usd - b.ret_iva > 0.009
                       then b.iva_usd - b.ret_iva + 0.0125 * b.base_usd end),
              (8, 'iva_igtf', 'Pendiente el IVA y el IGTF',
                  case when ig.empresa_id is not null and b.pagos_div > 0.009 and b.iva_usd > 0.009 and b.ret_iva <= 0.009
                       then b.iva_usd + 0.03 * b.pagos_div end),
              (9, 'iva_no_retenido_igtf', 'Pendiente el IVA no retenido y el IGTF',
                  case when ig.empresa_id is not null and b.pagos_div > 0.009 and b.ret_iva > 0.009 and b.iva_usd - b.ret_iva > 0.009
                       then b.iva_usd - b.ret_iva + 0.03 * b.pagos_div end)
            ) v(orden, codigo, texto, esperado)
           where v.esperado is not null and abs(b.saldo - v.esperado) <= public.estado_cuenta_tolerancia()
          union all
          select 20, 'solo_retencion', 'Falta el pago (retención ya aplicada)'
           where b.pagos <= 0.009 and b.nc <= 0.009 and b.otros <= 0.009 and b.retenciones > 0.009 and b.saldo >= 1
          union all
          select 21, 'abono_retencion', 'Falta el pago (solo abonó la retención de IVA)'
           where b.pagos > 0.009 and b.nc <= 0.009 and b.otros <= 0.009 and b.retenciones <= 0.009 and b.saldo >= 1
             and b.iva_usd > 0.009 and abs(b.pagos - coalesce(rp.pct, 0.75) * b.iva_usd) <= public.estado_cuenta_tolerancia()
          union all
          select 30, 'diferencia_menor', 'Diferencia menor (redondeo o cambio)'
           where b.saldo < 1
        ) c order by c.orden limit 1
      ) x
     where b.tipo <> 'nota_credito' and b.saldo > 0.009
       and b.pagos + b.nc + b.retenciones + b.otros > 0.009
  ),
  gcli as (select g.cliente_id, g.clasificacion from cobranza_gestion g where g.factura_id is null and g.empresa_id = any (p_empresas)),
  gdoc as (select g.factura_id, g.clasificacion from cobranza_gestion g where g.factura_id is not null and g.empresa_id = any (p_empresas)),
  -- Cobros sin aplicar al corte, menos lo que pagan de notas de entrega (22j)
  ant_guds as (
    select p.id, p.empresa_id, p.cliente_id, p.numero, p.moneda, p.monto,
           coalesce(p.fecha_pago, (coalesce(p.fecha_verificacion, p.created_at) at time zone 'America/Caracas')::date) fecha,
           round(p.monto - coalesce((select sum(pf.monto_aplicado) from pago_facturas pf where pf.pago_id = p.id), 0)
                 - public.ne_vinculado(p.id, p_corte), 2) disponible
      from pagos p
     where p.odoo_id is null and p.estado = 'verificado' and p.empresa_id = any (p_empresas)
  ),
  ant_odoo as (
    select p.id, p.empresa_id, p.cliente_id, p.numero, p.moneda, p.monto, p.fecha_pago fecha,
           p.saldo_odoo_usd + coalesce((select sum((c->>1)::numeric) from jsonb_array_elements(p.odoo_conciliaciones) c
                                         where (c->>0)::date > p_corte), 0)
             - public.ne_vinculado(p.id, p_corte) disponible
      from pagos p
     where p.odoo_id is not null and p.estado = 'verificado' and p.empresa_id = any (p_empresas)
       and p.fecha_pago <= p_corte and p.saldo_odoo_usd is not null
  ),
  ne as (
    select n.*, s.saldo
      from notas_entrega n join public.ne_saldos(p_corte) s on s.nota_id = n.id
     where coalesce(p_ne, true) and n.empresa_id = any (p_empresas) and n.estado not in ('borrador', 'anulada')
       and n.fecha_emision <= p_corte
  )
  select 'f:' || b.id,
         case when b.tipo = 'nota_credito' then 'nota_credito' when b.es_nd then 'nota_debito' else 'factura' end,
         case when q.codigo in ('retencion_iva', 'retencion_municipal', 'retenciones') then 'retencion'
              when q.codigo in ('iva_no_retenido', 'iva', 'igtf', 'iva_no_retenido_municipal', 'iva_igtf', 'iva_no_retenido_igtf') then 'impuesto'
              when b.tipo <> 'nota_credito' and b.saldo < -0.009 then 'a_favor' end,
         q.texto, b.empresa_id, b.id, b.numero, b.cliente_id, null::text, nullif(btrim(b.vendedor_odoo), ''),
         b.fecha_emision, b.fecha_vencimiento, case when b.moneda = 'USD' then 'USD' else 'VES' end,
         round(b.total_usd, 2), round(b.saldo, 2),
         coalesce(gd.clasificacion, gc.clasificacion, 'activa'),
         case when gd.clasificacion is not null then 'documento' when gc.clasificacion is not null then 'cliente' end
    from abiertos b
    left join qf q on q.id = b.id
    left join gdoc gd on gd.factura_id = b.id
    left join gcli gc on gc.cliente_id = b.cliente_id
  union all
  select 'p:' || a.id, 'anticipo', null, null, a.empresa_id, a.id, a.numero, a.cliente_id, null, null, a.fecha, a.fecha,
         case when a.moneda = 'USD' then 'USD' else 'VES' end, round(-a.monto, 2), round(-a.disponible, 2),
         coalesce(gc.clasificacion, 'activa'), case when gc.clasificacion is not null then 'cliente' end
    from (select * from ant_guds where fecha <= p_corte union all select * from ant_odoo) a
    left join gcli gc on gc.cliente_id = a.cliente_id
   where a.disponible > 0.009
  union all
  select 'n:' || n.id, 'nota_entrega', case when n.saldo < -0.009 then 'a_favor' end, null, n.empresa_id, n.id, n.serie || ' ' || n.numero,
         n.cliente_id, coalesce(c.nombre_negocio, n.cliente_nombre),
         coalesce(nullif(btrim(concat_ws(' ', u.nombre, u.apellido)), ''), n.vendedor_nombre),
         n.fecha_emision, coalesce(n.fecha_vencimiento, n.fecha_emision), case when n.moneda = 'USD' then 'USD' else 'VES' end,
         n.total_usd, n.saldo,
         coalesce(n.clasificacion, gc.clasificacion, 'activa'),
         case when n.clasificacion is not null then 'nota' when gc.clasificacion is not null then 'cliente' end
    from ne n
    left join clientes c on c.id = n.cliente_id
    left join usuarios u on u.id = n.vendedor_id
    left join gcli gc on gc.cliente_id = n.cliente_id
   where abs(n.saldo) > 0.009
$$;
comment on function public.partidas_cobranza(date, uuid[], boolean) is
  'Partidas abiertas al corte (22g, 22j): facturas, ND, NC a favor, anticipos de Odoo y de GUDS (sin lo que pagan de notas de entrega) y notas de entrega (ne_saldos), con su clasificación de cobranza. Interna';
revoke execute on function public.partidas_cobranza(date, uuid[], boolean) from public, anon, authenticated;

-- ── 14. Ventas vs deuda: N/E sin ficha con ne_saldos y su venta ───────────
create or replace function public.reporte_ventas_vs_deuda(p_corte date default null, p_meses integer default 12, p_ne boolean default true)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_hoy date := (now() at time zone 'America/Caracas')::date;
  v_corte date := least(coalesce(p_corte, (now() at time zone 'America/Caracas')::date), (now() at time zone 'America/Caracas')::date);
  v_inicio date := date '2020-12-01';   -- primer mes del histórico de Profit
  v_desde date;
  v_emps uuid[] := public.empresas_visibles();
  v_ve_ne boolean := public.puede('notas_entrega', 'ver');
  v_ne boolean := coalesce(p_ne, true) and public.puede('notas_entrega', 'ver');
  v jsonb;
begin
  perform public.exigir_permiso_reportes_cuentas();
  v_desde := case when coalesce(p_meses, 0) <= 0 then v_inicio
                  else greatest(v_inicio, (date_trunc('month', v_corte) - make_interval(months => least(p_meses, 120) - 1))::date) end;
  with
  r as materialized (select * from public.recuperacion_calculo(v_corte, v_emps, v_ne, null)),
  vm as materialized (
    select x.cliente_clave k, max(x.cliente_id::text)::uuid cliente_id, max(x.empresa_id::text)::uuid empresa_id, max(x.cliente_nombre) nombre,
           to_char(x.fecha, 'YYYY-MM') mes, sum(x.venta_usd) usd
      from public.ventas_con_iva(v_desde, v_corte, v_emps, v_ne) x
     group by x.cliente_clave, to_char(x.fecha, 'YYYY-MM')
  ),
  vk as (
    select vm.k, max(vm.cliente_id::text)::uuid cliente_id, max(vm.empresa_id::text)::uuid empresa_id, max(vm.nombre) nombre,
           jsonb_object_agg(vm.mes, round(vm.usd, 2)) filter (where abs(vm.usd) >= 0.005) ventas, sum(vm.usd) total
      from vm group by vm.k
  ),
  -- Notas de entrega sin ficha en GUDS: deuda (no fiscal) por nombre, como el Excel de finanzas
  nesf as (
    select 'ne:' || n.empresa_id::text || ':' || public.clasif_norm(n.cliente_nombre) k, n.empresa_id, max(n.cliente_nombre) nombre, sum(s.saldo) saldo
      from notas_entrega n join public.ne_saldos(v_corte) s on s.nota_id = n.id
     where v_ne and n.cliente_id is null and n.empresa_id = any (v_emps) and n.estado not in ('borrador', 'anulada') and n.fecha_emision <= v_corte
     group by 1, 2
    having abs(sum(s.saldo)) > 0.009
  ),
  fichas as (
    select coalesce(r.cliente_id, vk.cliente_id) id from r full join vk on vk.cliente_id = r.cliente_id
     where coalesce(r.cliente_id, vk.cliente_id) is not null
  ),
  filas as (
    -- (un cliente compartido por las dos empresas no tiene empresa en su ficha: va la de sus ventas o su deuda)
    select c.id::text k, c.id cliente_id, coalesce(c.empresa_id, vk.empresa_id, r.empresa_id) empresa_id, c.nombre_negocio nombre, c.rif, c.codigo,
           coalesce(nullif(btrim(concat_ws(' ', u.nombre, u.apellido)), ''), nullif(btrim(c.vendedor_odoo), '')) vendedor,
           coalesce(nullif(btrim(c.tipo_cliente), ''), ct.tipo) tipo, coalesce(nullif(btrim(c.segmento), ''), ct.categoria_cobranza) cat,
           g.clasificacion clasif, vk.ventas, vk.total, r.deuda_fiscal, r.notas_entrega, r.deuda, r.impuesto, r.venta_12m, r.meses,
           r.promedio, r.dias, r.venta_5m, r.compra_90d, r.primera_compra, r.ultima_compra
      from fichas f join clientes c on c.id = f.id
      left join r on r.cliente_id = c.id
      left join vk on vk.cliente_id = c.id
      left join usuarios u on u.id = c.vendedor_asignado_id
      left join clasificacion_clientes cc on cc.cliente_id = c.id
      left join clasificacion_tipos ct on ct.id = cc.tipo_id
      left join cobranza_gestion g on g.cliente_id = c.id and g.factura_id is null
  )
  select jsonb_build_object(
    'hoy', v_hoy, 'corte', v_corte, 'desde', v_desde, 'ne', v_ne, 've_ne', v_ve_ne,
    'umbral', public.config_entero('cobranza_recuperacion_alerta_dias', 90, 1, 3650),
    'empresas', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'nombre', e.nombre_corto) order by e.nombre_corto)
                            from empresas e where e.id = any (v_emps)), '[]'::jsonb),
    'clientes', coalesce((select jsonb_agg(x order by (x->>'d')::numeric desc nulls last, x->>'n') from (
        select jsonb_strip_nulls(jsonb_build_object(
                 'k', f.k, 'id', f.cliente_id, 'n', f.nombre, 'rif', f.rif, 'cod', f.codigo, 'e', f.empresa_id, 'v', f.vendedor,
                 'tipo', f.tipo, 'cat', f.cat, 'cl', f.clasif, 'ventas', f.ventas, 'tot', round(f.total, 2),
                 'v12', f.venta_12m, 'm12', f.meses, 'prom', f.promedio, 'v5', f.venta_5m, 'c90', f.compra_90d,
                 'df', f.deuda_fiscal, 'ne', nullif(f.notas_entrega, 0), 'd', f.deuda, 'imp', nullif(f.impuesto, 0), 'dias', f.dias,
                 'pc', f.primera_compra, 'uc', f.ultima_compra)) x
          from filas f
        union all
        -- Clientes de Profit sin ficha en GUDS (solo ventas del histórico)
        select jsonb_strip_nulls(jsonb_build_object('k', vk.k, 'n', vk.nombre, 'e', vk.empresa_id, 'ventas', vk.ventas,
                 'tot', round(vk.total, 2), 'sf', true)) from vk where vk.cliente_id is null and vk.k not like 'ne:%'
        union all
        -- Clientes de notas de entrega sin ficha: su deuda y sus ventas por nota de entrega
        select jsonb_strip_nulls(jsonb_build_object('k', coalesce(ne.k, vn.k), 'n', coalesce(ne.nombre, vn.nombre), 'e', coalesce(ne.empresa_id, vn.empresa_id),
                 'ventas', vn.ventas, 'tot', round(vn.total, 2), 'ne', round(ne.saldo, 2), 'd', round(coalesce(ne.saldo, 0), 2), 'df', 0, 'sf', true))
          from nesf ne full join (select * from vk where vk.k like 'ne:%') vn on vn.k = ne.k
      ) t), '[]'::jsonb))
    into v;
  return v;
end $$;
comment on function public.reporte_ventas_vs_deuda(date, integer, boolean) is
  'Ventas vs deuda (22h · R4, 22j): cliente × mes con IVA (Profit + Odoo y, con el interruptor, notas de entrega), promedios de 12 y 5 meses, compra de 90 días, deuda neta y días de recuperación (D6), en JSON. Exige reportes y cuentas';
revoke execute on function public.reporte_ventas_vs_deuda(date, integer, boolean) from public, anon;
grant execute on function public.reporte_ventas_vs_deuda(date, integer, boolean) to authenticated;

-- ── 15. Estado de cuenta con el check "incluir notas de entrega" ─────────
create or replace function public.estado_cuenta_sin_ids(p_docs jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select coalesce((select jsonb_agg(d - 'factura_id' - 'nota_entrega_id' order by o) from jsonb_array_elements(p_docs) with ordinality t(d, o)), p_docs)
$$;
revoke all on function public.estado_cuenta_sin_ids(jsonb) from public, anon, authenticated;

-- Filas de notas de entrega con saldo al corte, en el formato del estado de cuenta (interna)
create or replace function public.estado_cuenta_notas_entrega(p_cliente uuid, p_empresa uuid, p_corte date)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'nota_entrega_id', n.id,
           'numero', case when n.serie = 'NE' then n.numero else n.serie || ' ' || n.numero end,
           'tipo', 'nota_entrega', 'nro_control', null,
           'emision', n.fecha_emision, 'vence', coalesce(n.fecha_vencimiento, n.fecha_emision),
           'dias', p_corte - coalesce(n.fecha_vencimiento, n.fecha_emision),
           'estado', case when abs(s.saldo) < abs(n.total_usd) - 0.009 then 'parcial' else 'pendiente' end,
           'estatus', case when s.saldo < -0.009 then 'a_favor' else 'pendiente' end,
           'moneda', 'USD', 'tasa', null,
           'tasa_emision', round(public.tasa_bcv_dia(n.fecha_emision), 4), 'tasa_origen', 'bcv',
           'base', n.total_usd, 'iva', 0, 'total', n.total_usd,
           'pagos', s.abonos, 'nc', 0, 'retenciones', 0, 'otros', round(n.total_usd - s.saldo - s.abonos, 2),
           'abonado', round(n.total_usd - s.saldo, 2), 'saldo', s.saldo, 'ultimo_abono', s.ultimo_movimiento,
           'que_falta', null, 'comentarios', '[]'::jsonb, 'no_fiscal', true,
           'abonos', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'fecha', m.fecha,
                      'tipo', case m.tipo when 'abono' then 'pago' else m.tipo end,
                      'documento', case when m.tipo = 'facturada' then coalesce(f.numero, m.referencia)
                                        when m.tipo = 'abono' then coalesce(p.numero, m.referencia, 'Abono') else m.referencia end,
                      'referencia', case when m.tipo = 'abono' then nullif(btrim(coalesce(p.referencia, m.referencia)), '') end,
                      'banco', coalesce(nullif(btrim(b.nombre), ''), nullif(btrim(p.banco), '')),
                      'moneda', 'USD', 'monto', round(m.monto_usd, 2))
                    order by m.fecha nulls first, m.created_at)
               from nota_entrega_movimientos m
               left join pagos p on p.id = m.pago_id left join bancos b on b.id = p.banco_id left join facturas f on f.id = m.factura_id
              where m.nota_id = n.id and (m.fecha is null or m.fecha <= p_corte)
                and not (m.tipo = 'abono' and m.trasladado is not null and m.trasladado <= p_corte)), '[]'::jsonb))
         order by coalesce(n.fecha_vencimiento, n.fecha_emision), n.fecha_emision, n.numero), '[]'::jsonb)
    from notas_entrega n join public.ne_saldos(p_corte) s on s.nota_id = n.id
   where n.cliente_id = p_cliente and n.empresa_id = p_empresa and n.estado not in ('borrador', 'anulada')
     and n.fecha_emision <= p_corte and abs(s.saldo) > 0.009
$$;
revoke all on function public.estado_cuenta_notas_entrega(uuid, uuid, date) from public, anon, authenticated;

drop function if exists public.estado_cuenta_datos(uuid, uuid, date, date, boolean, boolean, text, boolean, date);
create or replace function public.estado_cuenta_datos(
  p_cliente uuid,
  p_empresa uuid,
  p_desde date default null,
  p_hasta date default null,
  p_movimientos boolean default true,
  p_internos boolean default false,
  p_filtro text default 'abiertas',
  p_desde_abierta boolean default false,
  p_corte date default null,
  p_ne boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_hoy date := (now() at time zone 'America/Caracas')::date;
  v_corte date := least(coalesce(p_corte, (now() at time zone 'America/Caracas')::date), (now() at time zone 'America/Caracas')::date);
  v_resumen jsonb;
  v_saldo numeric;
  v_nc numeric;
  v_anticipos numeric;
  v_neto numeric;
  v_credito jsonb;
  v_cliente jsonb;
  v_empresa jsonb;
  v_abiertos jsonb;
  v_notas jsonb := '[]'::jsonb;
  v_documentos jsonb;
  v_desde_abierta date;
  v_desde date := p_desde;
  v_ajustes int := 0;
  v_mov jsonb := '[]'::jsonb;
  v_total_libro numeric := 0;
  v_inicial numeric := 0;
  v_final numeric := 0;
begin
  if p_cliente is null or p_empresa is null then
    raise exception 'Falta el cliente o la empresa' using errcode = '22023';
  end if;
  if p_desde is not null and p_hasta is not null and p_desde > p_hasta then
    raise exception 'La fecha inicial no puede ser posterior a la final' using errcode = '22023';
  end if;

  -- Documentos con saldo al corte, con el cruce completo (base, IVA, abonos, qué falta, comentarios, tasa y estatus)
  v_abiertos := public.estado_cuenta_documentos(p_cliente, p_empresa, 'abiertas', null, null, p_internos, v_corte);
  -- 22j: con el check, las notas de entrega con saldo van en el mismo estado de cuenta (mismo orden: vencimiento y emisión)
  if coalesce(p_ne, false) then
    v_notas := public.estado_cuenta_notas_entrega(p_cliente, p_empresa, v_corte);
    if jsonb_array_length(v_notas) > 0 then
      select coalesce(jsonb_agg(d order by coalesce(d->>'vence', d->>'emision') nulls last, d->>'emision' nulls last, d->>'numero'), '[]'::jsonb)
        into v_abiertos from jsonb_array_elements(v_abiertos || v_notas) d;
    end if;
  end if;

  -- Resumen de esos mismos documentos (misma regla que Cuentas por Cobrar del admin)
  select jsonb_build_object(
      'saldo', round(coalesce(sum(s.saldo) filter (where s.saldo > 0), 0), 2),
      'por_vencer', round(coalesce(sum(s.saldo) filter (where s.saldo > 0 and s.dias <= 0), 0), 2),
      'vencido', round(coalesce(sum(s.saldo) filter (where s.saldo > 0 and s.dias > 0), 0), 2),
      'd1_30', round(coalesce(sum(s.saldo) filter (where s.saldo > 0 and s.dias between 1 and 30), 0), 2),
      'd31_60', round(coalesce(sum(s.saldo) filter (where s.saldo > 0 and s.dias between 31 and 60), 0), 2),
      'd61_90', round(coalesce(sum(s.saldo) filter (where s.saldo > 0 and s.dias between 61 and 90), 0), 2),
      'mas_90', round(coalesce(sum(s.saldo) filter (where s.saldo > 0 and s.dias > 90), 0), 2),
      'nc_a_favor', round(coalesce(-sum(s.saldo) filter (where s.saldo < 0), 0), 2),
      'facturas_abiertas', count(*) filter (where s.saldo > 0),
      'facturas_vencidas', count(*) filter (where s.saldo > 0 and s.dias > 0),
      'notas_credito_abiertas', count(*) filter (where s.saldo < 0),
      'notas_debito_abiertas', count(*) filter (where s.saldo > 0 and s.tipo = 'nota_debito'),
      'notas_debito_saldo', round(coalesce(sum(s.saldo) filter (where s.saldo > 0 and s.tipo = 'nota_debito'), 0), 2),
      'notas_entrega_abiertas', count(*) filter (where s.tipo = 'nota_entrega' and s.saldo > 0),
      'notas_entrega_saldo', round(coalesce(sum(s.saldo) filter (where s.tipo = 'nota_entrega'), 0), 2)),
      min(s.emision) filter (where s.saldo > 0)
    into v_resumen, v_desde_abierta
  from (select (d->>'saldo')::numeric saldo, (d->>'dias')::int dias, d->>'tipo' tipo, (d->>'emision')::date emision
          from jsonb_array_elements(v_abiertos) d) s;

  -- 2.1: los movimientos empiezan en la factura abierta más antigua (sin deuda: los últimos 90 días)
  if coalesce(p_desde_abierta, false) and p_desde is null then
    v_desde := coalesce(v_desde_abierta, v_hoy - 90);
    if p_hasta is not null and v_desde > p_hasta then v_desde := p_hasta; end if;
  end if;

  -- Anticipos (cobros sin aplicar, sin lo que pagan de notas de entrega) de esta empresa, cobrados hasta el corte
  select coalesce(round(sum(a.disponible), 2), 0) into v_anticipos
    from v_anticipos a join pagos p on p.id = a.pago_id
   where a.cliente_id = p_cliente and a.disponible > 0.009
     and (p.empresa_id is null or p.empresa_id = p_empresa)
     and coalesce(p.fecha_pago, (coalesce(p.fecha_verificacion, p.created_at) at time zone 'America/Caracas')::date) <= v_corte;

  v_saldo := (v_resumen->>'saldo')::numeric;
  v_nc := (v_resumen->>'nc_a_favor')::numeric;
  v_neto := round(v_saldo - v_nc - v_anticipos, 2);
  v_resumen := v_resumen || jsonb_build_object(
    'anticipos', v_anticipos,
    'a_favor', round(v_nc + v_anticipos, 2),
    'neto', v_neto);

  if coalesce(p_filtro, 'abiertas') <> 'abiertas' then
    v_documentos := public.estado_cuenta_documentos(p_cliente, p_empresa, p_filtro, v_desde, p_hasta, p_internos, null);
  end if;

  select to_jsonb(x) into v_credito from public.credito_disponible(p_cliente) x;
  select jsonb_build_object('id', cl.id, 'nombre', cl.nombre_negocio, 'rif', cl.rif, 'codigo', cl.codigo,
           'condicion_pago', cl.condicion_pago, 'dias_credito', cl.dias_credito,
           'direccion', nullif(btrim(cl.direccion), ''), 'ciudad', nullif(btrim(cl.ciudad), ''),
           'estado', nullif(btrim(regexp_replace(coalesce(cl.estado, ''), '\s*\(VE\)\s*$', '')), ''))
    into v_cliente from clientes cl where cl.id = p_cliente;
  select jsonb_build_object('id', e.id, 'nombre', e.nombre, 'nombre_corto', e.nombre_corto, 'prefijo', e.prefijo,
           'rif', e.rif, 'direccion', e.direccion, 'ciudad', e.ciudad, 'estado', e.estado, 'telefono', e.telefono,
           'email', e.email, 'sitio_web', e.sitio_web, 'logo_url', e.logo_url, 'color', e.color)
    into v_empresa from empresas e where e.id = p_empresa;

  -- Libro de movimientos con saldo corrido (21b). Ya no forma parte del estado de cuenta (22c); se conserva para el
  -- frontend publicado hasta que se publique el nuevo, que pide p_movimientos = false. No incluye notas de entrega.
  if coalesce(p_movimientos, true) then
    select count(*) into v_ajustes
      from facturas f
     where f.cliente_id = p_cliente and f.estado = 'posted'
       and (f.empresa_id is null or f.empresa_id = p_empresa)
       and (f.tipo = 'nota_credito' or f.es_nota_debito)
       and abs(coalesce(f.total_usd, 0)) < 0.005 and abs(coalesce(f.saldo_usd, 0)) < 0.005
       and (v_desde is null or coalesce(f.fecha_emision, date '1900-01-01') >= v_desde)
       and (p_hasta is null or coalesce(f.fecha_emision, date '1900-01-01') <= p_hasta);

    with fac as (
      select f.id, f.numero, f.tipo, f.es_nota_debito, f.fecha_emision, f.fecha_vencimiento, f.total_usd, f.saldo_usd, f.estado_cobro
        from facturas f
       where f.cliente_id = p_cliente and f.estado = 'posted'
         and (f.empresa_id is null or f.empresa_id = p_empresa)
    ),
    cob as (
      select fa.pago_id, fa.fecha fecha_ap,
             case when f.tipo = 'nota_credito' then fa.monto_usd else -fa.monto_usd end monto
        from factura_aplicaciones fa join fac f on f.id = fa.factura_id
       where fa.tipo = 'pago' and fa.pago_id is not null
      union all
      select pf.pago_id, null::date, -pf.monto_aplicado
        from pago_facturas pf join fac f on f.id = pf.factura_id join pagos p on p.id = pf.pago_id
       where p.estado = 'verificado'
      union all
      select a.pago_id, null::date, -a.disponible
        from v_anticipos a join pagos p on p.id = a.pago_id
       where a.cliente_id = p_cliente and a.disponible > 0.009 and (p.empresa_id is null or p.empresa_id = p_empresa)
    ),
    mov0 as (
      select f.fecha_emision fecha, 1 orden,
             case when f.tipo = 'nota_credito' then 'nota_credito' when f.es_nota_debito then 'nota_debito' else 'factura' end tipo,
             f.numero::text documento, null::text detalle, f.id factura_id, f.id::text clave, f.total_usd monto,
             f.fecha_vencimiento vence, f.estado_cobro estado
        from fac f
       where not ((f.tipo = 'nota_credito' or f.es_nota_debito)
                  and abs(coalesce(f.total_usd, 0)) < 0.005 and abs(coalesce(f.saldo_usd, 0)) < 0.005)
      union all
      select coalesce(case when p.odoo_id is not null then (p.created_at at time zone 'UTC')::date
                           else (p.created_at at time zone 'America/Caracas')::date end, min(cob.fecha_ap)),
             2, 'cobro', coalesce(p.numero::text, 'Cobro'), p.metodo::text, null::uuid, cob.pago_id::text,
             sum(cob.monto), null::date, null::text
        from cob left join pagos p on p.id = cob.pago_id
       group by cob.pago_id, p.id
      union all
      select fa.fecha, 3,
             case fa.tipo when 'retencion' then 'retencion' when 'reintegro' then 'reintegro' else 'ajuste' end,
             coalesce(fa.descripcion, ''), null::text, null::uuid, fa.tipo || '|' || coalesce(fa.descripcion, ''),
             sum(case when f.tipo = 'nota_credito' then fa.monto_usd else -fa.monto_usd end), null::date, null::text
        from factura_aplicaciones fa join fac f on f.id = fa.factura_id
       where fa.tipo not in ('pago', 'nota_credito')
       group by fa.fecha, fa.tipo, fa.descripcion
      union all
      select fa.fecha, 3, 'nota_credito_aplicada', coalesce(d.numero::text, fa.descripcion, ''), null::text, null::uuid,
             'nca|' || coalesce(fa.documento_id::text, fa.descripcion, ''), sum(-fa.monto_usd), null::date, null::text
        from factura_aplicaciones fa join fac f on f.id = fa.factura_id left join facturas d on d.id = fa.documento_id
       where fa.tipo = 'nota_credito' and (fa.documento_id is null or fa.documento_id not in (select id from fac))
       group by fa.fecha, fa.documento_id, d.numero, fa.descripcion
      union all
      select fa.fecha, 3, 'nota_credito_aplicada', n.numero::text, null::text, null::uuid, 'ncx|' || n.id::text,
             sum(fa.monto_usd), null::date, null::text
        from factura_aplicaciones fa join fac n on n.id = fa.documento_id
       where fa.tipo = 'nota_credito' and fa.factura_id not in (select id from fac)
       group by fa.fecha, n.id, n.numero
      union all
      select r.fecha, 3, 'retencion', r.numero::text, r.tipo::text, null::uuid, 'ret|' || r.id::text,
             sum(-ri.monto_aplicado), null::date, null::text
        from retencion_items ri join retenciones r on r.id = ri.retencion_id join fac f on f.id = ri.factura_id
       where r.estado = 'aprobado' and r.odoo_id is null
       group by r.id, r.fecha, r.numero, r.tipo
    ),
    mov1 as (
      select * from mov0 where orden = 1 or abs(monto) >= 0.005
    ),
    mov as (
      select * from mov1
      union all
      select v_hoy, 9, 'redondeo', 'Redondeo', null::text, null::uuid, 'redondeo', d.dif, null::date, null::text
        from (select v_neto - coalesce((select sum((x->>'saldo')::numeric) from jsonb_array_elements(v_notas) x), 0) - coalesce(sum(monto), 0) dif from mov1) d
       where v_corte = v_hoy and abs(d.dif) >= 0.005 and abs(d.dif) <= 1
    ),
    libro as (
      select m.*, coalesce(m.fecha, date '1900-01-01') f_orden,
             sum(m.monto) over (order by coalesce(m.fecha, date '1900-01-01'), m.orden, m.documento, m.clave
                                rows between unbounded preceding and current row) acumulado
        from mov m
    )
    select coalesce(sum(l.monto), 0),
           coalesce(sum(l.monto) filter (where v_desde is not null and l.f_orden < v_desde), 0),
           coalesce(sum(l.monto) filter (where p_hasta is null or l.f_orden <= p_hasta), 0),
           coalesce(jsonb_agg(jsonb_build_object(
               'fecha', l.fecha, 'tipo', l.tipo, 'documento', l.documento, 'detalle', l.detalle, 'factura_id', l.factura_id,
               'monto', round(l.monto, 2), 'saldo', round(l.acumulado, 2), 'vence', l.vence, 'estado', l.estado)
             order by l.f_orden, l.orden, l.documento, l.clave)
             filter (where (v_desde is null or l.f_orden >= v_desde) and (p_hasta is null or l.f_orden <= p_hasta)), '[]'::jsonb)
      into v_total_libro, v_inicial, v_final, v_mov
      from libro l;
  end if;

  return jsonb_build_object(
    'hoy', v_hoy,
    'corte', v_corte,
    'cliente', v_cliente,
    'empresa', v_empresa,
    'resumen', v_resumen,
    'credito', v_credito,
    'abiertos', v_abiertos,
    'documentos', v_documentos,
    'filtro', coalesce(p_filtro, 'abiertas'),
    'desde_abierta', v_desde_abierta,
    'tolerancia', public.estado_cuenta_tolerancia(),
    'incluye_ne', coalesce(p_ne, false),
    'periodo', jsonb_build_object('desde', v_desde, 'hasta', p_hasta,
                                  'modo', case when coalesce(p_desde_abierta, false) and p_desde is null then 'abierta' end),
    'saldo_inicial', round(v_inicial, 2),
    'saldo_final', round(v_final, 2),
    'movimientos', v_mov,
    'ajustes_cambiarios', v_ajustes,
    'diferencia', case when coalesce(p_movimientos, true) and v_corte = v_hoy
                       then round(v_total_libro - (v_neto - coalesce((select sum((x->>'saldo')::numeric) from jsonb_array_elements(v_notas) x), 0)), 2) end);
end $$;
revoke all on function public.estado_cuenta_datos(uuid, uuid, date, date, boolean, boolean, text, boolean, date, boolean) from public, anon, authenticated;

-- Admin (CuentaDetalle) y vendedor del cliente: el check de notas de entrega para quien las puede ver
drop function if exists public.estado_cuenta_cliente(uuid, date, date, boolean, text, boolean, date);
create or replace function public.estado_cuenta_cliente(
  p_cliente_id uuid,
  p_desde date default null,
  p_hasta date default null,
  p_movimientos boolean default true,
  p_filtro text default 'abiertas',
  p_desde_abierta boolean default false,
  p_corte date default null,
  p_ne boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_emp uuid;
  v_internos boolean;
  v_ne boolean;
begin
  v_emp := public.estado_cuenta_acceso(p_cliente_id, 'ver');
  v_internos := public.es_personal_admin() and public.puede('cuentas', 'ver');
  v_ne := coalesce(p_ne, false) and ((public.es_personal_admin() and public.puede('notas_entrega', 'ver')) or public.es_vendedor_de(p_cliente_id));
  return public.estado_cuenta_datos(p_cliente_id, v_emp, p_desde, p_hasta, p_movimientos, v_internos, p_filtro, p_desde_abierta, p_corte, v_ne);
end $$;
revoke all on function public.estado_cuenta_cliente(uuid, date, date, boolean, text, boolean, date, boolean) from public, anon;
grant execute on function public.estado_cuenta_cliente(uuid, date, date, boolean, text, boolean, date, boolean) to authenticated;

-- Enlace público: muestra las notas de entrega si el enlace lo tiene marcado (lo marca el check al copiarlo o enviarlo)
create or replace function public.estado_cuenta_publico(
  p_token text,
  p_desde date default null,
  p_hasta date default null,
  p_contar boolean default true,
  p_filtro text default 'abiertas',
  p_desde_abierta boolean default false,
  p_movimientos boolean default true
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  e public.estado_cuenta_enlaces;
  v jsonb;
  v_rif text;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'Este enlace no es válido o ya no está disponible' using errcode = 'P0001';
  end if;
  select * into e from estado_cuenta_enlaces x
   where x.token = p_token and x.revocado_at is null and (x.vence_at is null or x.vence_at > now());
  if not found then
    raise exception 'Este enlace no es válido o ya no está disponible' using errcode = 'P0001';
  end if;

  update estado_cuenta_enlaces
     set ultimo_acceso_at = now(), accesos = accesos + case when coalesce(p_contar, true) then 1 else 0 end
   where id = e.id;

  -- p_internos = false: solo comentarios visibles para el cliente, sin autor ni id
  v := public.estado_cuenta_datos(e.cliente_id, e.empresa_id, p_desde, p_hasta, coalesce(p_movimientos, true), false, p_filtro, p_desde_abierta,
                                  null, e.incluir_ne);

  v := jsonb_set(v, '{cliente}', (v->'cliente') - 'id');
  v := jsonb_set(v, '{empresa}', (v->'empresa') - 'id');
  v := jsonb_set(v, '{credito}', coalesce((v->'credito') - 'utilizado' - 'en_pedidos', 'null'::jsonb));
  v := jsonb_set(v, '{movimientos}', coalesce((select jsonb_agg(m - 'factura_id' order by o)
                                                 from jsonb_array_elements(v->'movimientos') with ordinality t(m, o)), '[]'::jsonb));
  v := jsonb_set(v, '{abiertos}', public.estado_cuenta_sin_ids(v->'abiertos'));
  if jsonb_typeof(v->'documentos') = 'array' then
    v := jsonb_set(v, '{documentos}', public.estado_cuenta_sin_ids(v->'documentos'));
  end if;

  select c.rif into v_rif from clientes c where c.id = e.cliente_id;
  return v || jsonb_build_object(
    'enlace', jsonb_build_object('creado_at', e.creado_at, 'vence_at', e.vence_at),
    'actualizado_at', now(),
    'tiene_cuenta', exists (
      select 1 from usuarios u join clientes c on c.id = u.cliente_id
       where u.role = 'cliente' and coalesce(u.activo, true)
         and (c.id = e.cliente_id or (v_rif is not null and public.normalizar_rif(c.rif) = public.normalizar_rif(v_rif)))));
end $$;
revoke all on function public.estado_cuenta_publico(text, date, date, boolean, text, boolean, boolean) from public;
grant execute on function public.estado_cuenta_publico(text, date, date, boolean, text, boolean, boolean) to anon, authenticated;

create or replace function public.estado_cuenta_enlace_json(e public.estado_cuenta_enlaces, p_con_token boolean)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', e.id,
    'token', case when p_con_token and e.revocado_at is null and (e.vence_at is null or e.vence_at > now()) then e.token end,
    'activo', e.revocado_at is null and (e.vence_at is null or e.vence_at > now()),
    'creado_at', e.creado_at,
    'creado_por', (select nullif(btrim(concat_ws(' ', u.nombre, u.apellido)), '') from usuarios u where u.id = e.creado_por),
    'vence_at', e.vence_at,
    'revocado_at', e.revocado_at,
    'revocado_por', (select nullif(btrim(concat_ws(' ', u.nombre, u.apellido)), '') from usuarios u where u.id = e.revocado_por),
    'revocado_motivo', case when e.revocado_at is null and e.vence_at is not null and e.vence_at <= now() then 'vencido' else e.revocado_motivo end,
    'ultimo_acceso_at', e.ultimo_acceso_at,
    'accesos', e.accesos,
    'incluir_ne', e.incluir_ne);
$$;
revoke all on function public.estado_cuenta_enlace_json(public.estado_cuenta_enlaces, boolean) from public, anon, authenticated;

-- Marca o desmarca las notas de entrega en el enlace activo del cliente (el check del estado de cuenta)
create or replace function public.estado_cuenta_enlace_ne(p_cliente_id uuid, p_ne boolean)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_emp uuid; e public.estado_cuenta_enlaces;
begin
  v_emp := public.estado_cuenta_acceso(p_cliente_id, 'editar', false);
  if coalesce(p_ne, false) and not public.puede('notas_entrega', 'ver') then
    raise exception 'No tienes permiso para ver notas de entrega' using errcode = '42501';
  end if;
  update estado_cuenta_enlaces x set incluir_ne = coalesce(p_ne, false)
   where x.cliente_id = p_cliente_id and x.empresa_id = v_emp and x.revocado_at is null
  returning * into e;
  if not found then return null; end if;
  return public.estado_cuenta_enlace_json(e, true);
end $$;
revoke all on function public.estado_cuenta_enlace_ne(uuid, boolean) from public, anon;
grant execute on function public.estado_cuenta_enlace_ne(uuid, boolean) to authenticated;

-- Correo: con el check, las notas de entrega van en el cuerpo y el enlace queda marcado
drop function if exists public.datos_correo_estado_cuenta(uuid, boolean);
create or replace function public.datos_correo_estado_cuenta(p_cliente_id uuid, p_asegurar_enlace boolean default false, p_ne boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_emp uuid;
  v_enlace jsonb;
  v jsonb;
  v_ne boolean;
begin
  v_emp := public.estado_cuenta_acceso(p_cliente_id, 'editar', false);
  v_ne := coalesce(p_ne, false) and public.puede('notas_entrega', 'ver');
  if coalesce(p_asegurar_enlace, false) then
    v_enlace := public.crear_enlace_estado_cuenta(p_cliente_id, false, null);
    update estado_cuenta_enlaces set incluir_ne = v_ne where id = (v_enlace->>'id')::uuid and incluir_ne is distinct from v_ne;
    v_enlace := v_enlace || jsonb_build_object('incluir_ne', v_ne);
  else
    select public.estado_cuenta_enlace_json(x, true) into v_enlace from estado_cuenta_enlaces x
     where x.cliente_id = p_cliente_id and x.empresa_id = v_emp and x.revocado_at is null
       and (x.vence_at is null or x.vence_at > now())
     order by x.creado_at desc limit 1;
  end if;
  v := public.estado_cuenta_datos(p_cliente_id, v_emp, null, null, false, false, 'abiertas', false, null, v_ne);
  return jsonb_build_object(
    'hoy', v->'hoy',
    'corte', v->'corte',
    'cliente', (v->'cliente') || jsonb_build_object('email', (select nullif(btrim(c.email), '') from clientes c where c.id = p_cliente_id)),
    'empresa', v->'empresa',
    'resumen', v->'resumen',
    'incluye_ne', v_ne,
    'documentos', coalesce((select jsonb_agg(jsonb_build_object(
                     'numero', d->>'numero', 'tipo', d->>'tipo', 'nro_control', d->>'nro_control',
                     'emision', d->>'emision', 'vence', d->>'vence', 'dias', (d->>'dias')::int,
                     'tasa', (d->>'tasa_emision')::numeric, 'base', (d->>'base')::numeric, 'iva', (d->>'iva')::numeric,
                     'total', (d->>'total')::numeric, 'abonado', (d->>'abonado')::numeric, 'saldo', (d->>'saldo')::numeric,
                     'estatus', d->>'estatus',
                     'que_falta', d->'que_falta'->>'texto', 'comentario', d->'comentarios'->0->>'texto') order by o)
                   from jsonb_array_elements(v->'abiertos') with ordinality t(d, o)), '[]'::jsonb),
    'enlace', v_enlace,
    'contactos', coalesce((
      select jsonb_agg(jsonb_build_object('nombre', k.nombre, 'cargo', k.cargo, 'email', btrim(k.email), 'principal', coalesce(k.es_principal, false))
             order by coalesce(k.es_principal, false) desc, k.nombre)
        from cliente_contactos k
       where k.cliente_id = p_cliente_id and coalesce(k.activo, true) and nullif(btrim(k.email), '') is not null), '[]'::jsonb),
    'remitente', (select jsonb_build_object('id', u.id, 'nombre', nullif(btrim(concat_ws(' ', u.nombre, u.apellido)), ''), 'email', u.email)
                    from usuarios u where u.auth_id = auth.uid()));
end $$;
revoke all on function public.datos_correo_estado_cuenta(uuid, boolean, boolean) from public, anon;
grant execute on function public.datos_correo_estado_cuenta(uuid, boolean, boolean) to authenticated;

-- Las notas históricas del Excel ya no se pisan si GUDS les registró movimientos (scripts/importar-vencimiento-finanzas.mjs)
comment on column public.notas_entrega.origen is 'excel = cargada del Excel de finanzas (serie HIST); guds = emitida en GUDS desde un pedido de Odoo (22j)';

notify pgrst, 'reload schema';

commit;
