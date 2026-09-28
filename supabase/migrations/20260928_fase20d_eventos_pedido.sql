-- ════════════════════════════════════════════════════════════════════════
-- Fase 20d · Línea de tiempo del pedido y avisos de lo que cambia en Odoo (plan de portales §3, F4/V1)
--   · orden_eventos: cada hito del pedido (creado, editado, aprobado/rechazado, enviado a Odoo, confirmado, despachado,
--     en camino, entregado / incompleto / rechazado / reprogramado, facturado, pagado, cancelado) con fecha, origen y quién.
--     Lo leen quienes pueden ver el pedido (misma RLS de ordenes).
--   · Los triggers corren SIEMPRE (también cuando la sincronización escribe con los triggers apagados): así lo que cambia en
--     Odoo (confirmar, despachar, facturar, cancelar) llega a la línea de tiempo y AVISA al cliente y a su vendedor, que antes
--     no se enteraban. Solo se avisa de pedidos de los últimos 60 días (evita avisos masivos si cambia algo viejo).
--   · notif_cliente avisa también al usuario de un cliente presente en ambas empresas (fichas con el mismo RIF).
--   · Se cargan los hitos históricos que se pueden reconstruir (creación, aprobación, envío, despachos, entregas, facturas).
-- ════════════════════════════════════════════════════════════════════════
begin;

create table if not exists public.orden_eventos (
  id bigserial primary key,
  orden_id uuid not null references public.ordenes(id) on delete cascade,
  empresa_id uuid references public.empresas(id),
  tipo text not null check (tipo in ('creado', 'editado', 'aprobado', 'rechazado', 'enviado_odoo', 'confirmado', 'despachado', 'en_camino',
    'entregado', 'entrega_incompleta', 'entrega_rechazada', 'reprogramado', 'facturado', 'pagado', 'cancelado')),
  detalle text,
  origen text not null default 'guds' check (origen in ('guds', 'odoo')),
  usuario_id uuid references public.usuarios(id),
  fecha timestamptz not null default now()
);
create index if not exists orden_eventos_orden on public.orden_eventos (orden_id, fecha);
alter table public.orden_eventos enable row level security;
drop policy if exists orden_eventos_leer on public.orden_eventos;
create policy orden_eventos_leer on public.orden_eventos for select to authenticated
  using (exists (select 1 from public.ordenes o where o.id = orden_eventos.orden_id));
drop policy if exists empresa_visible on public.orden_eventos;
create policy empresa_visible on public.orden_eventos as restrictive for all to authenticated
  using (empresa_id is null or empresa_id = any ((select public.empresas_visibles())::uuid[]));
revoke all on public.orden_eventos from anon;
revoke insert, update, delete, truncate on public.orden_eventos from authenticated;

-- Avisos al cliente: a los usuarios de cualquier ficha del mismo cliente (presente en ambas empresas)
create or replace function public.notif_cliente(p_cliente_id uuid, p_titulo text, p_mensaje text, p_tipo text, p_link text)
returns void language sql security definer set search_path = public as $$
  insert into notificaciones (usuario_id, titulo, mensaje, tipo, link, leida)
  select u.id, p_titulo, p_mensaje, p_tipo, p_link, false
  from usuarios u where u.role = 'cliente' and u.activo and u.cliente_id in (select f.id from public.fichas_cliente(p_cliente_id) f);
$$;
revoke execute on function public.notif_cliente(uuid, text, text, text, text) from public, anon, authenticated;

create or replace function public.registrar_evento_orden(p_orden_id uuid, p_tipo text, p_detalle text, p_fecha timestamptz default now())
returns void language plpgsql security definer set search_path = public as $$
declare v_origen text := case when coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '') in ('authenticated', 'anon')
                               then 'guds' else 'odoo' end;
begin
  insert into orden_eventos (orden_id, empresa_id, tipo, detalle, origen, usuario_id, fecha)
  select o.id, o.empresa_id, p_tipo, p_detalle, v_origen, (select id from usuarios where auth_id = auth.uid()), coalesce(p_fecha, now())
  from ordenes o where o.id = p_orden_id;
end $$;
revoke execute on function public.registrar_evento_orden(uuid, text, text, timestamptz) from public, anon, authenticated;

-- ¿El cambio viene de la sincronización con Odoo (sin sesión de usuario)? ¿El pedido es reciente para avisar?
create or replace function public.cambio_desde_odoo() returns boolean language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '') not in ('authenticated', 'anon');
$$;

create or replace function public.trg_orden_eventos()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_odoo boolean := public.cambio_desde_odoo();
  v_reciente boolean := coalesce(new.fecha_pedido, new.created_at, now()) >= now() - interval '60 days';
  v_link_c text := '/portal/pedidos?pedido=' || new.id;
  v_link_v text := '/vendedor/pedidos?pedido=' || new.id;
  v_cli text;
begin
  if tg_op = 'INSERT' then
    perform public.registrar_evento_orden(new.id, 'creado', case when new.odoo_id is not null then 'Pedido de Odoo' else null end,
      coalesce(new.fecha_pedido, new.created_at, now()));
    return new;
  end if;
  if new.aprobacion is distinct from old.aprobacion and new.aprobacion = 'aprobada' then
    perform public.registrar_evento_orden(new.id, 'aprobado', null, coalesce(new.aprobado_at, now()));
  elsif new.aprobacion is distinct from old.aprobacion and new.aprobacion = 'rechazada' then
    perform public.registrar_evento_orden(new.id, 'rechazado', new.rechazo_motivo);
  end if;
  if coalesce(new.ediciones, 0) > coalesce(old.ediciones, 0) then
    perform public.registrar_evento_orden(new.id, 'editado', null);
  end if;
  if old.odoo_id is null and new.odoo_id is not null then
    perform public.registrar_evento_orden(new.id, 'enviado_odoo', 'Registrado en Odoo como ' || new.numero, coalesce(new.odoo_enviado_at, now()));
  end if;
  if coalesce(new.pagado, false) and not coalesce(old.pagado, false) then
    perform public.registrar_evento_orden(new.id, 'pagado', null);
  end if;

  select nombre_negocio into v_cli from clientes where id = new.cliente_id;
  -- Confirmación en Odoo
  if new.estado_odoo is distinct from old.estado_odoo and new.estado_odoo in ('sale', 'done') and coalesce(old.estado_odoo, '') not in ('sale', 'done') then
    perform public.registrar_evento_orden(new.id, 'confirmado', null);
    if v_odoo and v_reciente then
      perform notif_cliente(new.cliente_id, 'Pedido confirmado', 'Tu pedido ' || new.numero || ' fue confirmado y pasa a preparación.', 'orden', v_link_c);
      perform notif_vendedor(new.cliente_id, 'Pedido confirmado', coalesce(v_cli, 'Cliente') || ': ' || new.numero || ' confirmado en Odoo.', 'orden', v_link_v);
    end if;
  end if;
  -- Despacho (validado en Odoo, parcial o completo)
  if new.estado is distinct from old.estado and new.estado::text in ('enviado', 'completado') and v_odoo then
    perform public.registrar_evento_orden(new.id, 'despachado', case when new.estado::text = 'enviado' then 'Despacho parcial' else 'Despacho completo validado en Odoo' end);
    if v_reciente then
      perform notif_cliente(new.cliente_id, 'Pedido despachado', 'Tu pedido ' || new.numero || case when new.estado::text = 'enviado' then ' salió parcialmente del almacén.' else ' salió del almacén.' end, 'orden', v_link_c);
      perform notif_vendedor(new.cliente_id, 'Pedido despachado', coalesce(v_cli, 'Cliente') || ': ' || new.numero || ' despachado.', 'orden', v_link_v);
    end if;
  end if;
  -- Cancelación (el rechazo en GUDS ya se registró y avisó aparte)
  if new.estado is distinct from old.estado and new.estado::text = 'cancelado' and coalesce(new.aprobacion, '') <> 'rechazada' then
    perform public.registrar_evento_orden(new.id, 'cancelado', null);
    if v_odoo and v_reciente then
      perform notif_cliente(new.cliente_id, 'Pedido cancelado', 'Tu pedido ' || new.numero || ' fue cancelado. Si tienes dudas, escríbele a tu ejecutivo.', 'alerta', v_link_c);
      perform notif_vendedor(new.cliente_id, 'Pedido cancelado', coalesce(v_cli, 'Cliente') || ': ' || new.numero || ' cancelado en Odoo.', 'alerta', v_link_v);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists zz_orden_eventos on public.ordenes;
create trigger zz_orden_eventos after insert or update on public.ordenes for each row execute function public.trg_orden_eventos();
alter table public.ordenes enable always trigger zz_orden_eventos;

-- Entregas de GUDS (repartidor): en camino y cierres
create or replace function public.trg_entrega_eventos()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_orden uuid;
begin
  if new.estado is not distinct from old.estado then return new; end if;
  v_orden := coalesce(new.orden_id, (select t.orden_id from transferencias t where t.id = new.transferencia_id));
  if v_orden is null then return new; end if;
  perform public.registrar_evento_orden(v_orden,
    case new.estado::text when 'en_camino' then 'en_camino' when 'entregada' then 'entregado' when 'incompleta' then 'entrega_incompleta'
      when 'rechazada' then 'entrega_rechazada' when 'fallida' then 'entrega_rechazada' when 'reprogramada' then 'reprogramado' else null end,
    case new.estado::text
      when 'entregada' then nullif(concat_ws(' · ', new.doc_numero, case when new.receptor_nombre is not null then 'Recibió ' || new.receptor_nombre end), '')
      when 'reprogramada' then concat_ws(' · ', new.doc_numero, 'Nueva fecha ' || to_char(new.reprogramada_para, 'DD/MM/YYYY'), new.motivo_detalle)
      else nullif(concat_ws(' · ', new.doc_numero, coalesce(new.motivo_detalle, new.motivo_fallo)), '') end,
    coalesce(new.fecha_cierre, new.fecha_entrega, new.fecha_inicio_entrega, now()));
  return new;
exception when check_violation or not_null_violation then return new;   -- estados sin hito (asignada, cancelada)
end $$;
drop trigger if exists zz_entrega_eventos on public.entregas;
create trigger zz_entrega_eventos after update on public.entregas for each row execute function public.trg_entrega_eventos();
alter table public.entregas enable always trigger zz_entrega_eventos;

-- Facturas del pedido (las de Odoo llegan por la sincronización)
create or replace function public.trg_factura_evento()
returns trigger language plpgsql security definer set search_path = public as $$
declare o ordenes%rowtype; v_cli text;
begin
  if new.orden_id is null or new.tipo <> 'factura' or new.estado <> 'posted' then return new; end if;
  if tg_op = 'UPDATE' and old.orden_id is not distinct from new.orden_id and old.estado is not distinct from new.estado then return new; end if;
  select * into o from ordenes where id = new.orden_id;
  if not found then return new; end if;
  perform public.registrar_evento_orden(o.id, 'facturado', 'Factura ' || new.numero, coalesce(new.fecha_emision::timestamptz, now()));
  if public.cambio_desde_odoo() and coalesce(new.fecha_emision, current_date) >= current_date - 30 then
    select nombre_negocio into v_cli from clientes where id = o.cliente_id;
    perform notif_cliente(o.cliente_id, 'Pedido facturado', 'Se emitió la factura ' || new.numero || ' de tu pedido ' || o.numero || ' por ' || fmt_usd(coalesce(new.total_usd, new.total)) || '.', 'orden', '/portal/pagos');
    perform notif_vendedor(o.cliente_id, 'Pedido facturado', coalesce(v_cli, 'Cliente') || ': factura ' || new.numero || ' del pedido ' || o.numero || '.', 'orden', '/vendedor/pedidos?pedido=' || o.id);
  end if;
  return new;
end $$;
drop trigger if exists zz_factura_evento on public.facturas;
create trigger zz_factura_evento after insert or update of orden_id, estado on public.facturas for each row execute function public.trg_factura_evento();
alter table public.facturas enable always trigger zz_factura_evento;

-- ── Hitos históricos reconstruibles (sin avisos) ──
insert into orden_eventos (orden_id, empresa_id, tipo, detalle, origen, fecha)
select o.id, o.empresa_id, 'creado', case when o.numero_guds is null and o.odoo_id is not null then 'Pedido de Odoo' end,
       case when o.numero_guds is null and o.odoo_id is not null then 'odoo' else 'guds' end, coalesce(o.fecha_pedido, o.created_at)
from ordenes o where not exists (select 1 from orden_eventos e where e.orden_id = o.id and e.tipo = 'creado');

insert into orden_eventos (orden_id, empresa_id, tipo, origen, fecha)
select o.id, o.empresa_id, 'aprobado', 'guds', o.aprobado_at from ordenes o
where o.aprobacion = 'aprobada' and o.aprobado_at is not null and not exists (select 1 from orden_eventos e where e.orden_id = o.id and e.tipo = 'aprobado');

insert into orden_eventos (orden_id, empresa_id, tipo, detalle, origen, fecha)
select o.id, o.empresa_id, 'enviado_odoo', 'Registrado en Odoo como ' || o.numero, 'guds', o.odoo_enviado_at from ordenes o
where o.odoo_enviado_at is not null and not exists (select 1 from orden_eventos e where e.orden_id = o.id and e.tipo = 'enviado_odoo');

insert into orden_eventos (orden_id, empresa_id, tipo, detalle, origen, fecha)
select t.orden_id, t.empresa_id, 'despachado', t.numero, 'odoo', t.fecha_realizada
from transferencias t where t.tipo = 'entrega' and t.estado = 'hecha' and t.orden_id is not null and t.fecha_realizada is not null
  and not exists (select 1 from orden_eventos e where e.orden_id = t.orden_id and e.tipo = 'despachado' and e.detalle = t.numero);

insert into orden_eventos (orden_id, empresa_id, tipo, detalle, origen, fecha)
select f.orden_id, f.empresa_id, 'facturado', 'Factura ' || f.numero, 'odoo', f.fecha_emision::timestamptz
from facturas f where f.tipo = 'factura' and f.estado = 'posted' and f.orden_id is not null and f.fecha_emision is not null
  and not exists (select 1 from orden_eventos e where e.orden_id = f.orden_id and e.tipo = 'facturado' and e.detalle = 'Factura ' || f.numero);

insert into orden_eventos (orden_id, empresa_id, tipo, origen, fecha)
select o.id, o.empresa_id, 'cancelado', 'odoo', coalesce(o.updated_at, o.created_at) from ordenes o
where o.estado = 'cancelado' and coalesce(o.aprobacion, '') <> 'rechazada' and not exists (select 1 from orden_eventos e where e.orden_id = o.id and e.tipo = 'cancelado');

notify pgrst, 'reload schema';

commit;
