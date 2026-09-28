-- ════════════════════════════════════════════════════════════════════════
-- Fase 20f · Delivery D2 (ubicaciones) + D3 (rutas) — docs/PLAN-PORTALES-Y-FLUJOS.md §6, plan-delivery.md §3.3/§3.4
--   Pedido del dueño: "en el portal del delivery debe mostrársele con mapa y demás".
--   Decisiones: mapas con Mapbox GL; la coordenada definitiva la pone una persona (pin confirmado en el mapa) o sale del
--   GPS del teléfono al cerrar una entrega (queda "propuesta" hasta que administración la confirma con un clic); la
--   geocodificación de Mapbox solo centra el mapa en el navegador y NUNCA se guarda; navegación por enlaces a Google Maps
--   y Waze; rutas mixtas GUDS + Quirutec permitidas. Nada de esto se escribe en Odoo.
--   1. ubicaciones_entrega: tabla propia de GUDS (la sincronización con Odoo no la toca). Una fila por destino: el cliente
--      (dirección principal) o una dirección de entrega (cliente_direcciones, la sucursal del documento de Odoo).
--   2. entregas: dirección de entrega del documento (sucursal), día de la ruta (fecha_ruta + orden_ruta) y GPS del cierre.
--      Al reasignar la entrega a otro repartidor sale de la ruta planificada.
--   3. rutas_reparto: ruta publicada por repartidor y día (paradas en orden, versión, quién y cuándo la publicó).
--   4. Funciones de administración: guardar/confirmar/borrar ubicación, punto de salida (configuracion
--      'delivery_punto_salida'), ruta_reparto_admin (lo que ve el planificador y la hoja de ruta) y publicar_ruta_reparto
--      (guarda el orden y avisa al repartidor cuando se publica o cambia).
--   5. Repartidor: cerrar_entrega acepta p_datos.gps {lat, lng, precision} (opcional, nunca bloquea el cierre) y
--      mis_entregas_reparto devuelve el orden de la ruta y la ubicación de cada parada abierta.
-- ════════════════════════════════════════════════════════════════════════
begin;

-- ── 1. Ubicaciones de entrega (propias de GUDS) ─────────────────────────
create table if not exists public.ubicaciones_entrega (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  direccion_id uuid references public.cliente_direcciones(id) on delete cascade,
  latitud numeric(9,6) not null check (latitud between -90 and 90),
  longitud numeric(9,6) not null check (longitud between -180 and 180),
  precision_m numeric(8,1) check (precision_m >= 0),
  fuente text not null check (fuente in ('pin', 'gps_entrega')),
  confirmada boolean not null default false,
  entrega_id uuid references public.entregas(id) on delete set null,
  registrada_por uuid references public.usuarios(id) on delete set null,
  registrada_at timestamptz not null default now(),
  confirmada_por uuid references public.usuarios(id) on delete set null,
  confirmada_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ubicaciones_entrega_confirmacion check (not confirmada or confirmada_at is not null)
);
comment on table public.ubicaciones_entrega is 'Ubicación de entrega por destino (cliente o dirección de entrega). Propia de GUDS: la sincronización con Odoo no la toca. fuente pin = la puso una persona en el mapa; gps_entrega = GPS del teléfono al cerrar una entrega (propuesta hasta que se confirma).';
comment on column public.ubicaciones_entrega.direccion_id is 'Dirección de entrega (sucursal) del cliente; null = dirección principal del cliente';
comment on column public.ubicaciones_entrega.entrega_id is 'Entrega de la que salió la lectura de GPS (fuente gps_entrega)';
-- Un destino, una ubicación: por dirección de entrega o, sin dirección, por cliente
create unique index if not exists ubicaciones_entrega_direccion on public.ubicaciones_entrega (direccion_id) where direccion_id is not null;
create unique index if not exists ubicaciones_entrega_cliente on public.ubicaciones_entrega (cliente_id) where direccion_id is null;
create index if not exists ubicaciones_entrega_por_confirmar on public.ubicaciones_entrega (registrada_at desc) where not confirmada;

-- ── 2. Entregas: destino, ruta del día y GPS del cierre ─────────────────
alter table public.entregas
  add column if not exists direccion_id uuid references public.cliente_direcciones(id) on delete set null,
  add column if not exists fecha_ruta date,
  add column if not exists cierre_lat numeric(9,6),
  add column if not exists cierre_lng numeric(9,6),
  add column if not exists cierre_precision_m numeric(8,1),
  add column if not exists cierre_gps_at timestamptz;
comment on column public.entregas.direccion_id is 'Dirección de entrega (sucursal) del documento de Odoo: stock.picking.partner_id cuando es una dirección hija del cliente';
comment on column public.entregas.fecha_ruta is 'Día de la ruta en que va la parada (lo fija el planificador); null = sin planificar';
comment on column public.entregas.orden_ruta is 'Posición de la parada en la ruta del día (1, 2, …), la guarda el planificador (publicar_ruta_reparto)';
comment on column public.entregas.cierre_lat is 'GPS del teléfono al cerrar la entrega (si el repartidor dio permiso)';
create index if not exists entregas_ruta on public.entregas (repartidor_id, fecha_ruta, orden_ruta);
create index if not exists entregas_direccion on public.entregas (direccion_id) where direccion_id is not null;

-- Dirección de entrega (sucursal) de un documento de Odoo: el contacto del picking cuando es una dirección hija del cliente. Interna.
create or replace function public.direccion_destino_transferencia(p_transferencia_id uuid, p_cliente_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select d.id from transferencias t join cliente_direcciones d on d.odoo_id = t.partner_odoo_id
  where t.id = p_transferencia_id and t.tipo = 'entrega' and (p_cliente_id is null or d.cliente_id = p_cliente_id)
  limit 1;
$$;

-- Al crear la entrega se guarda su sucursal; al reasignarla a otro repartidor sale de la ruta planificada
create or replace function public.trg_entrega_destino_ruta()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT' or new.transferencia_id is distinct from old.transferencia_id)
     and new.direccion_id is null and new.transferencia_id is not null then
    new.direccion_id := public.direccion_destino_transferencia(new.transferencia_id, new.cliente_id);
  end if;
  if tg_op = 'UPDATE' and new.repartidor_id is distinct from old.repartidor_id then
    new.fecha_ruta := null;
    new.orden_ruta := null;
  end if;
  return new;
end $$;
drop trigger if exists b_entrega_destino_ruta on public.entregas;
create trigger b_entrega_destino_ruta before insert or update of transferencia_id, repartidor_id on public.entregas
  for each row execute function public.trg_entrega_destino_ruta();

update public.entregas e set direccion_id = public.direccion_destino_transferencia(e.transferencia_id, e.cliente_id)
where e.direccion_id is null and e.transferencia_id is not null;

-- ── 3. Rutas publicadas (repartidor + día) ──────────────────────────────
create table if not exists public.rutas_reparto (
  id uuid primary key default gen_random_uuid(),
  repartidor_id uuid not null references public.usuarios(id) on delete cascade,
  fecha date not null,
  paradas uuid[] not null default '{}',
  version integer not null default 0,
  publicada_at timestamptz,
  publicada_por uuid references public.usuarios(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (repartidor_id, fecha)
);
comment on table public.rutas_reparto is 'Ruta publicada de un repartidor en un día: paradas (entregas) en orden. La publica administración (publicar_ruta_reparto) y avisa al repartidor.';

-- ── RLS: lectura por permisos; nadie escribe directo (todo pasa por las funciones) ──
alter table public.ubicaciones_entrega enable row level security;
alter table public.rutas_reparto enable row level security;

drop policy if exists ubicaciones_entrega_admin_ver on public.ubicaciones_entrega;
create policy ubicaciones_entrega_admin_ver on public.ubicaciones_entrega for select to authenticated
  using ((select public.es_personal_admin()) and ((select public.puede('delivery', 'ver')) or (select public.puede('clientes', 'ver'))));
-- El repartidor solo ve la ubicación de sus paradas abiertas
drop policy if exists ubicaciones_entrega_repartidor_ver on public.ubicaciones_entrega;
create policy ubicaciones_entrega_repartidor_ver on public.ubicaciones_entrega for select to authenticated
  using (exists (
    select 1 from public.entregas e
    where e.repartidor_id = (select public.usuario_actual_id()) and e.estado in ('asignada', 'en_camino')
      and ((ubicaciones_entrega.direccion_id is not null and e.direccion_id = ubicaciones_entrega.direccion_id)
        or (ubicaciones_entrega.direccion_id is null and e.direccion_id is null and e.cliente_id = ubicaciones_entrega.cliente_id))));

drop policy if exists rutas_reparto_admin_ver on public.rutas_reparto;
create policy rutas_reparto_admin_ver on public.rutas_reparto for select to authenticated
  using ((select public.es_personal_admin()) and (select public.puede('delivery', 'ver')));
drop policy if exists rutas_reparto_repartidor_ver on public.rutas_reparto;
create policy rutas_reparto_repartidor_ver on public.rutas_reparto for select to authenticated
  using (repartidor_id = (select public.usuario_actual_id()));

revoke all on table public.ubicaciones_entrega from anon;
revoke all on table public.rutas_reparto from anon;
revoke insert, update, delete, truncate, references, trigger on table public.ubicaciones_entrega from authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.rutas_reparto from authenticated;
grant select on table public.ubicaciones_entrega to authenticated;
grant select on table public.rutas_reparto to authenticated;

-- ── 4a. Ubicaciones (administración) ────────────────────────────────────
-- Quién edita ubicaciones: personal de administración con delivery o clientes (editar). Interna.
create or replace function public.puede_editar_ubicaciones()
returns boolean language sql stable security definer set search_path = public as $$
  select (select public.es_personal_admin()) and ((select public.puede('delivery', 'editar')) or (select public.puede('clientes', 'editar')));
$$;

-- Guardar el pin puesto por una persona (queda confirmado). Latitud/longitud dentro de un recuadro amplio de Venezuela
-- (detecta latitud y longitud invertidas).
create or replace function public.guardar_ubicacion_entrega(p_cliente_id uuid, p_direccion_id uuid, p_lat numeric, p_lng numeric, p_precision numeric default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_yo uuid := (select public.usuario_actual_id()); v_id uuid; v_lat numeric := round(p_lat, 6); v_lng numeric := round(p_lng, 6);
begin
  if not public.puede_editar_ubicaciones() then raise exception 'Solo administración puede editar ubicaciones de entrega'; end if;
  if p_cliente_id is null or not exists (select 1 from clientes where id = p_cliente_id) then raise exception 'Cliente no encontrado'; end if;
  if p_direccion_id is not null and not exists (select 1 from cliente_direcciones where id = p_direccion_id and cliente_id = p_cliente_id) then
    raise exception 'La dirección de entrega no pertenece a este cliente';
  end if;
  if v_lat is null or v_lng is null then raise exception 'Indica la latitud y la longitud'; end if;
  if v_lat not between -1 and 14 or v_lng not between -75 and -58 then
    raise exception 'La ubicación queda fuera de Venezuela: revisa la latitud y la longitud';
  end if;
  if p_precision is not null and (p_precision < 0 or p_precision > 100000) then raise exception 'Precisión inválida'; end if;

  select u.id into v_id from ubicaciones_entrega u
  where (p_direccion_id is not null and u.direccion_id = p_direccion_id) or (p_direccion_id is null and u.direccion_id is null and u.cliente_id = p_cliente_id)
  limit 1 for update;
  if v_id is null then
    insert into ubicaciones_entrega (cliente_id, direccion_id, latitud, longitud, precision_m, fuente, confirmada, registrada_por, confirmada_por, confirmada_at)
    values (p_cliente_id, p_direccion_id, v_lat, v_lng, round(p_precision, 1), 'pin', true, v_yo, v_yo, now())
    returning id into v_id;
  else
    update ubicaciones_entrega set cliente_id = p_cliente_id, latitud = v_lat, longitud = v_lng, precision_m = round(p_precision, 1), fuente = 'pin',
      confirmada = true, entrega_id = null, registrada_por = v_yo, registrada_at = now(), confirmada_por = v_yo, confirmada_at = now(), updated_at = now()
    where id = v_id;
  end if;
  return v_id;
end $$;

-- Confirmar con un clic la ubicación propuesta por el GPS de una entrega
create or replace function public.confirmar_ubicacion_entrega(p_ubicacion_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_yo uuid := (select public.usuario_actual_id()); v_u record;
begin
  if not public.puede_editar_ubicaciones() then raise exception 'Solo administración puede confirmar ubicaciones de entrega'; end if;
  select * into v_u from ubicaciones_entrega where id = p_ubicacion_id for update;
  if not found then raise exception 'Ubicación no encontrada'; end if;
  if v_u.confirmada then return; end if;
  update ubicaciones_entrega set confirmada = true, confirmada_por = v_yo, confirmada_at = now(), updated_at = now() where id = p_ubicacion_id;
end $$;

-- Quitar una ubicación (p. ej. una propuesta de GPS equivocada)
create or replace function public.borrar_ubicacion_entrega(p_ubicacion_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.puede_editar_ubicaciones() then raise exception 'Solo administración puede quitar ubicaciones de entrega'; end if;
  delete from ubicaciones_entrega where id = p_ubicacion_id;
  if not found then raise exception 'Ubicación no encontrada'; end if;
end $$;

-- Punto de salida de las rutas (almacén), para "Ordenar por cercanía": configuracion.delivery_punto_salida = {lat, lng, nombre}
create or replace function public.guardar_punto_salida(p_lat numeric, p_lng numeric, p_nombre text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_valor text;
begin
  if not ((select public.es_personal_admin()) and (select public.puede('delivery', 'editar'))) then
    raise exception 'Solo administración puede cambiar el punto de salida';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -1 and 14 or p_lng not between -75 and -58 then
    raise exception 'El punto de salida queda fuera de Venezuela: revisa la latitud y la longitud';
  end if;
  v_valor := jsonb_build_object('lat', round(p_lat, 6), 'lng', round(p_lng, 6),
    'nombre', coalesce(nullif(left(trim(coalesce(p_nombre, '')), 80), ''), 'Punto de salida'))::text;
  insert into configuracion (clave, valor, tipo, descripcion)
  values ('delivery_punto_salida', v_valor, 'json', 'Punto de salida de las rutas de delivery (almacén): se usa para ordenar las paradas por cercanía')
  on conflict (clave) do update set valor = excluded.valor, tipo = excluded.tipo, updated_at = now();
end $$;

-- ── 4b. Rutas (administración) ──────────────────────────────────────────
-- Paradas de un repartidor para planificar el día p_fecha: sus entregas abiertas (planificadas ese día, sin planificar o en
-- otro día) y las ya cerradas de ese día; con destino, ubicación y productos (lo reservado en Odoo). Todas las empresas a
-- las que el admin tiene acceso (rutas mixtas), sin depender de la empresa activa.
create or replace function public.ruta_reparto_admin(p_repartidor_id uuid, p_fecha date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_ruta jsonb; v_ent jsonb;
begin
  if not ((select public.es_personal_admin()) and (select public.puede('delivery', 'ver'))) then
    raise exception 'Solo administración puede ver las rutas de reparto';
  end if;
  if p_repartidor_id is null or p_fecha is null then raise exception 'Elige el repartidor y el día'; end if;

  select jsonb_build_object('version', r.version, 'paradas', to_jsonb(r.paradas), 'publicada_at', r.publicada_at,
      'publicada_por', (select trim(u.nombre || ' ' || coalesce(u.apellido, '')) from usuarios u where u.id = r.publicada_por))
    into v_ruta
  from rutas_reparto r where r.repartidor_id = p_repartidor_id and r.fecha = p_fecha;

  select coalesce(jsonb_agg(x.fila order by x.en_ruta desc, x.orden_ruta nulls last, x.prog nulls last, x.asig), '[]'::jsonb) into v_ent
  from (
    select coalesce(e.fecha_ruta = p_fecha, false) en_ruta, e.orden_ruta, t.fecha_programada prog, e.fecha_asignacion asig,
      jsonb_build_object(
        'id', e.id, 'estado', e.estado, 'prioridad', e.prioridad, 'empresa_id', e.empresa_id, 'empresa', em.nombre_corto,
        'numero', coalesce(t.numero, e.doc_numero, o.numero), 'origen', t.origen,
        'tipo', case when t.tipo = 'interna' then 'reposicion' else 'entrega' end,
        'fecha_ruta', e.fecha_ruta, 'orden_ruta', e.orden_ruta, 'fecha_programada', t.fecha_programada,
        'fecha_asignacion', e.fecha_asignacion, 'fecha_cierre', e.fecha_cierre,
        'cliente_id', c.id, 'direccion_id', e.direccion_id, 'cliente', coalesce(c.nombre_negocio, t.contacto),
        'contacto', case when t.tipo = 'interna' then ad.nombre else t.contacto end, 'sucursal', d.nombre,
        'direccion', coalesce(t.direccion_entrega, e.doc_direccion, d.direccion, o.direccion_entrega, c.direccion),
        'ciudad', coalesce(t.ciudad_entrega, d.ciudad, o.ciudad_entrega, c.ciudad), 'region', coalesce(t.region_entrega, d.estado, c.estado),
        'telefono', coalesce(nullif(t.telefono_entrega, ''), nullif(d.telefono, ''), nullif(c.telefono, ''), nullif(c.celular, '')),
        'ubicacion', case when u.id is null then null else jsonb_build_object('id', u.id, 'lat', u.latitud, 'lng', u.longitud,
          'confirmada', u.confirmada, 'fuente', u.fuente, 'precision_m', u.precision_m) end,
        'lineas', case when t.id is not null then (
            select coalesce(jsonb_agg(jsonb_build_object('producto', coalesce(ti.nombre_producto, p.nombre), 'unidad', ti.unidad,
              'demandada', ti.cantidad_demandada, 'cantidad', coalesce(ti.cantidad_hecha, 0)) order by ti.odoo_id), '[]'::jsonb)
            from transferencia_items ti left join productos p on p.id = ti.producto_id
            where ti.transferencia_id = t.id and coalesce(ti.estado, '') <> 'cancelada')
          else (
            select coalesce(jsonb_agg(jsonb_build_object('producto', coalesce(p.nombre, 'Producto'), 'unidad', null,
              'demandada', oi.cantidad, 'cantidad', oi.cantidad)), '[]'::jsonb)
            from orden_items oi left join productos p on p.id = oi.producto_id where oi.orden_id = e.orden_id)
          end
      ) fila
    from entregas e
    join empresas em on em.id = e.empresa_id
    left join transferencias t on t.id = e.transferencia_id
    left join almacenes ad on ad.id = t.almacen_destino_id
    left join ordenes o on o.id = e.orden_id
    left join clientes c on c.id = coalesce(e.cliente_id, case when t.tipo = 'interna' then ad.cliente_id else t.cliente_id end, o.cliente_id)
    left join cliente_direcciones d on d.id = e.direccion_id
    left join lateral (
      select u.* from ubicaciones_entrega u
      where (e.direccion_id is not null and u.direccion_id = e.direccion_id) or (e.direccion_id is null and u.direccion_id is null and u.cliente_id = c.id)
      limit 1) u on true
    where e.repartidor_id = p_repartidor_id and e.empresa_id = any (public.empresas_permitidas())
      and (e.estado in ('asignada', 'en_camino') or e.fecha_ruta = p_fecha)
  ) x;

  return jsonb_build_object('ruta', v_ruta, 'entregas', v_ent);
end $$;

-- Publicar (o volver a publicar) la ruta de un repartidor para un día: guarda fecha_ruta + orden_ruta en ese orden; las
-- entregas abiertas que estaban en la ruta de ese día y ya no vienen quedan sin planificar. Si cambió algo, sube la versión
-- y avisa al repartidor ("Ruta publicada" la primera vez, "Ruta actualizada" después). Rutas mixtas GUDS + Quirutec: se
-- valida el acceso a la empresa de cada entrega y se escribe desde cualquier empresa activa.
create or replace function public.publicar_ruta_reparto(p_repartidor_id uuid, p_fecha date, p_entregas uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_yo uuid := (select public.usuario_actual_id()); v_hoy date := (now() at time zone 'America/Caracas')::date;
  v_ids uuid[] := coalesce(p_entregas, '{}'::uuid[]); v_n integer; v_malas text; v_ruta record; v_version integer; v_cambio boolean;
begin
  if not ((select public.es_personal_admin()) and (select public.puede('delivery', 'editar'))) then
    raise exception 'Solo administración puede publicar rutas de reparto';
  end if;
  if p_fecha is null then raise exception 'Elige el día de la ruta'; end if;
  if p_fecha < v_hoy then raise exception 'No se puede publicar una ruta de un día que ya pasó'; end if;
  if p_fecha > v_hoy + 60 then raise exception 'La ruta puede planificarse hasta 60 días adelante'; end if;
  if not exists (select 1 from usuarios u where u.id = p_repartidor_id and u.role = 'delivery' and coalesce(u.activo, true)) then
    raise exception 'Elige un repartidor activo';
  end if;
  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n <> (select count(distinct x) from unnest(v_ids) x) then raise exception 'Una parada está repetida en la ruta'; end if;
  if v_n > 200 then raise exception 'Demasiadas paradas para una ruta'; end if;

  -- Cada parada: del repartidor, de una empresa a la que el admin tiene acceso, abierta (o ya cerrada en esta misma ruta)
  select string_agg(coalesce(e.doc_numero, x::text), ', ') into v_malas
  from unnest(v_ids) x left join entregas e on e.id = x
  where e.id is null or e.repartidor_id is distinct from p_repartidor_id or not (e.empresa_id = any (public.empresas_permitidas()))
     or not (e.estado in ('asignada', 'en_camino') or e.fecha_ruta = p_fecha);
  if v_malas is not null then
    raise exception 'Estas paradas no son entregas abiertas de este repartidor: %', v_malas;
  end if;

  perform set_config('guds.bypass_guard', 'on', true);
  update entregas e set fecha_ruta = p_fecha, orden_ruta = x.pos::int
  from unnest(v_ids) with ordinality x(id, pos)
  where e.id = x.id and (e.fecha_ruta is distinct from p_fecha or e.orden_ruta is distinct from x.pos::int);
  update entregas e set fecha_ruta = null, orden_ruta = null
  where e.repartidor_id = p_repartidor_id and e.fecha_ruta = p_fecha and e.estado in ('asignada', 'en_camino')
    and e.empresa_id = any (public.empresas_permitidas()) and not (e.id = any (v_ids));
  perform set_config('guds.bypass_guard', 'off', true);

  select * into v_ruta from rutas_reparto where repartidor_id = p_repartidor_id and fecha = p_fecha for update;
  v_cambio := not found or v_ruta.paradas is distinct from v_ids;
  if not found then
    insert into rutas_reparto (repartidor_id, fecha, paradas, version, publicada_at, publicada_por)
    values (p_repartidor_id, p_fecha, v_ids, 1, now(), v_yo) returning version into v_version;
  elsif v_cambio then
    update rutas_reparto set paradas = v_ids, version = version + 1, publicada_at = now(), publicada_por = v_yo, updated_at = now()
    where id = v_ruta.id returning version into v_version;
  else
    v_version := v_ruta.version;
  end if;

  if v_cambio then
    perform notif_crear(p_repartidor_id,
      case when v_version = 1 then 'Ruta publicada' else 'Ruta actualizada' end,
      case when v_version = 1 then 'Tu ruta del ' || to_char(p_fecha, 'DD/MM') || ' tiene ' || v_n || case when v_n = 1 then ' parada.' else ' paradas.' end
           when v_n = 0 then 'Tu ruta del ' || to_char(p_fecha, 'DD/MM') || ' quedó sin paradas.'
           else 'Cambió tu ruta del ' || to_char(p_fecha, 'DD/MM') || ': ' || v_n || case when v_n = 1 then ' parada' else ' paradas' end || ' en el orden nuevo.' end,
      'orden', '/delivery/ruta');
  end if;
  return jsonb_build_object('version', v_version, 'paradas', v_n, 'notificado', v_cambio);
end $$;

-- ── 5a. GPS del cierre → ubicación propuesta (interna, la llama cerrar_entrega) ──
--   Se guarda siempre en la entrega. Si el resultado es entregada / incompleta / rechazada (el repartidor estuvo en el
--   lugar), la precisión es de 500 m o mejor y el destino no tiene ubicación confirmada, queda como propuesta (se conserva
--   la lectura más precisa). Una ubicación confirmada nunca se pisa.
create or replace function public.registrar_gps_cierre(p_entrega_id uuid, p_gps jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_lat numeric; v_lng numeric; v_prec numeric; v_ent record; v_u record; v_yo uuid := (select public.usuario_actual_id());
  c_precision_max constant numeric := 500;
begin
  if p_gps is null or jsonb_typeof(p_gps) <> 'object' then return 'sin_gps'; end if;
  begin
    v_lat := round((p_gps->>'lat')::numeric, 6);
    v_lng := round((p_gps->>'lng')::numeric, 6);
    v_prec := round(nullif(p_gps->>'precision', '')::numeric, 1);
  exception when others then return 'sin_gps';
  end;
  if v_lat is null or v_lng is null or v_lat not between -90 and 90 or v_lng not between -180 and 180 or (v_prec is not null and v_prec < 0) then
    return 'sin_gps';
  end if;
  if v_prec > 999999 then v_prec := 999999; end if;

  perform set_config('guds.bypass_guard', 'on', true);
  update entregas set cierre_lat = v_lat, cierre_lng = v_lng, cierre_precision_m = v_prec, cierre_gps_at = now()
  where id = p_entrega_id
  returning id, estado, cliente_id, direccion_id into v_ent;
  perform set_config('guds.bypass_guard', 'off', true);
  if v_ent.id is null then return 'sin_gps'; end if;

  if v_ent.estado::text not in ('entregada', 'incompleta', 'rechazada') or v_ent.cliente_id is null then return 'registrado'; end if;
  if v_prec is not null and v_prec > c_precision_max then return 'impreciso'; end if;

  select * into v_u from ubicaciones_entrega u
  where (v_ent.direccion_id is not null and u.direccion_id = v_ent.direccion_id)
     or (v_ent.direccion_id is null and u.direccion_id is null and u.cliente_id = v_ent.cliente_id)
  limit 1 for update;
  if found and v_u.confirmada then return 'ya_confirmada'; end if;
  if found then
    if v_u.precision_m is not null and (v_prec is null or v_prec > v_u.precision_m) then return 'propuesta_previa'; end if;
    update ubicaciones_entrega set latitud = v_lat, longitud = v_lng, precision_m = v_prec, fuente = 'gps_entrega', entrega_id = p_entrega_id,
      registrada_por = v_yo, registrada_at = now(), updated_at = now()
    where id = v_u.id;
  else
    insert into ubicaciones_entrega (cliente_id, direccion_id, latitud, longitud, precision_m, fuente, confirmada, entrega_id, registrada_por)
    values (v_ent.cliente_id, v_ent.direccion_id, v_lat, v_lng, v_prec, 'gps_entrega', false, p_entrega_id, v_yo);
  end if;
  return 'propuesta';
end $$;

-- ── 5b. Cerrar la entrega (19v) + GPS del teléfono (p_datos.gps, opcional) ──
--   p_resultado: completa | incompleta | rechazada | reprogramada
--   p_datos: { receptor, firma, foto, notas, motivo, motivo_detalle, fecha, lineas: [{item_id, entregada, motivo}], gps: {lat, lng, precision} }
--   Evidencia: completa = foto + firma + quien recibe · incompleta = lo mismo + motivo por producto con diferencia ·
--   rechazada = foto + motivo · reprogramada = fecha (hoy o después, en Caracas) + motivo.
--   Solo completa e incompleta de un documento de Odoo encolan la escritura en Odoo (entrega_estado).
create or replace function public.cerrar_entrega(p_entrega_id uuid, p_resultado text, p_datos jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ent public.entregas; v_doc_id uuid; v_doc_numero text; v_doc_dir text; v_it record; v_l jsonb; v_lineas jsonb := '[]'::jsonb;
  v_esp numeric; v_q numeric; v_mot text; v_dif boolean := false; v_total numeric := 0; v_pend boolean := false;
  v_receptor text := nullif(trim(coalesce(p_datos->>'receptor', '')), '');
  v_firma text := nullif(trim(coalesce(p_datos->>'firma', '')), '');
  v_foto text := nullif(trim(coalesce(p_datos->>'foto', '')), '');
  v_notas text := nullif(trim(coalesce(p_datos->>'notas', '')), '');
  v_motivo text := nullif(trim(coalesce(p_datos->>'motivo', '')), '');
  v_detalle text := nullif(trim(coalesce(p_datos->>'motivo_detalle', '')), '');
  v_fecha date; v_hoy date := (now() at time zone 'America/Caracas')::date;
  v_estado entrega_estado; v_esc uuid; v_yo uuid := (select public.usuario_actual_id()); v_ubic text;
  motivos_linea constant text[] := array['falto_camion', 'no_lo_quiso', 'danado', 'vencimiento', 'error_pedido', 'otro'];
  motivos_rechazo constant text[] := array['sin_oc', 'precio', 'duplicado', 'danado', 'vencimiento', 'fuera_horario', 'no_lo_pidio', 'falta_pago', 'otro'];
  motivos_reprog constant text[] := array['cerrado', 'fuera_horario', 'receptor_ausente', 'direccion_no_encontrada', 'cliente_pide_fecha', 'sin_tiempo', 'falla_vehiculo', 'otro'];
begin
  if p_resultado not in ('completa', 'incompleta', 'rechazada', 'reprogramada') then raise exception 'Resultado de entrega inválido'; end if;
  v_ent := public.entrega_del_repartidor(p_entrega_id);
  if v_ent.estado not in ('asignada', 'en_camino') then raise exception 'La entrega ya está cerrada (%)', v_ent.estado; end if;
  select t.id, t.numero, nullif(concat_ws(', ', t.direccion_entrega, t.ciudad_entrega), '') into v_doc_id, v_doc_numero, v_doc_dir
  from transferencias t where t.id = v_ent.transferencia_id;

  -- Evidencia (en el bucket privado, en la carpeta de ESTA entrega, y que exista)
  if p_resultado in ('completa', 'incompleta') then
    if v_receptor is null then raise exception 'Indica el nombre de quien recibe'; end if;
    if v_firma is null or v_foto is null then raise exception 'La entrega necesita la firma de quien recibe y la foto de evidencia'; end if;
  elsif p_resultado = 'rechazada' then
    if v_foto is null then raise exception 'El rechazo necesita una foto de evidencia'; end if;
    if v_motivo is null or not (v_motivo = any (motivos_rechazo)) then raise exception 'Indica el motivo del rechazo'; end if;
  else
    if v_motivo is null or not (v_motivo = any (motivos_reprog)) then raise exception 'Indica el motivo de la reprogramación'; end if;
    begin v_fecha := (p_datos->>'fecha')::date; exception when others then v_fecha := null; end;
    if v_fecha is null then raise exception 'Indica la fecha nueva de la entrega'; end if;
    if v_fecha < v_hoy then raise exception 'La fecha nueva no puede ser anterior a hoy'; end if;
  end if;
  if v_motivo = 'otro' and v_detalle is null and p_resultado in ('rechazada', 'reprogramada') then raise exception 'Describe el motivo'; end if;
  if (v_firma is not null and v_firma not like p_entrega_id::text || '/%') or (v_foto is not null and v_foto not like p_entrega_id::text || '/%') then
    raise exception 'La evidencia no corresponde a esta entrega';
  end if;
  if (v_firma is not null and not exists (select 1 from storage.objects where bucket_id = 'evidencias-entrega' and name = v_firma))
     or (v_foto is not null and not exists (select 1 from storage.objects where bucket_id = 'evidencias-entrega' and name = v_foto)) then
    raise exception 'No se encontró la evidencia subida: vuelve a intentarlo';
  end if;

  -- Cantidades por línea del documento (lo esperado = lo reservado en Odoo, que es lo que lleva el camión)
  if p_resultado in ('completa', 'incompleta') then
    if v_doc_id is null and p_resultado = 'incompleta' then
      raise exception 'La entrega incompleta por producto es solo para documentos de entrega de Odoo';
    end if;
    if v_doc_id is not null then
      for v_it in select ti.id, ti.odoo_id, coalesce(ti.nombre_producto, p.nombre) producto, coalesce(ti.cantidad_demandada, 0) demandada,
                         coalesce(ti.cantidad_hecha, 0) reservada
                  from transferencia_items ti left join productos p on p.id = ti.producto_id
                  where ti.transferencia_id = v_doc_id and coalesce(ti.estado, '') <> 'cancelada' order by ti.odoo_id loop
        v_esp := v_it.reservada;
        v_mot := null;
        if p_resultado = 'completa' then
          v_q := v_esp;
        else
          select x into v_l from jsonb_array_elements(coalesce(p_datos->'lineas', '[]'::jsonb)) x where x->>'item_id' = v_it.id::text limit 1;
          if v_l is null then
            if v_esp > 0 then raise exception 'Falta la cantidad entregada de %', v_it.producto; end if;
            v_q := 0;
          else
            begin v_q := (v_l->>'entregada')::numeric; exception when others then v_q := null; end;
            if v_q is null or v_q < 0 or v_q > v_esp then raise exception 'La cantidad entregada de % debe estar entre 0 y %', v_it.producto, v_esp; end if;
            if v_q < v_esp then
              v_mot := nullif(trim(coalesce(v_l->>'motivo', '')), '');
              if v_mot is null or not (v_mot = any (motivos_linea)) then raise exception 'Indica el motivo de la diferencia en %', v_it.producto; end if;
              v_dif := true;
            end if;
          end if;
        end if;
        v_total := v_total + v_q;
        -- Pendiente en Odoo: si faltó en el camión, o si Odoo no tenía todo reservado (eso no salió en el camión)
        if v_mot = 'falto_camion' or v_esp < v_it.demandada then v_pend := true; end if;
        v_lineas := v_lineas || jsonb_build_object('item_id', v_it.id, 'move_odoo_id', v_it.odoo_id, 'producto', v_it.producto,
          'demandada', v_it.demandada, 'esperada', v_esp, 'entregada', v_q, 'motivo', v_mot);
      end loop;
      if v_total <= 0 then
        raise exception '%', case when p_resultado = 'completa' then 'El documento no tiene nada reservado en Odoo para entregar'
          else 'Si no se entregó nada, marca la entrega como rechazada' end;
      end if;
      if p_resultado = 'incompleta' and not v_dif then raise exception 'No hay diferencias: marca la entrega como entregada completa'; end if;
    end if;
  end if;

  v_estado := case p_resultado when 'completa' then 'entregada' when 'incompleta' then 'incompleta' when 'rechazada' then 'rechazada' else 'reprogramada' end;
  perform set_config('guds.bypass_guard', 'on', true);
  update entregas set estado = v_estado,
    fecha_entrega = case when p_resultado in ('completa', 'incompleta') then now() else fecha_entrega end,
    fecha_cierre = now(), cerrada_por = v_yo, origen_cierre = 'guds',
    receptor_nombre = coalesce(v_receptor, receptor_nombre), firma_url = coalesce(v_firma, firma_url), foto_entrega_url = coalesce(v_foto, foto_entrega_url),
    notas = coalesce(v_notas, notas),
    motivo_codigo = case when p_resultado in ('rechazada', 'reprogramada') then v_motivo end,
    motivo_detalle = case when p_resultado in ('rechazada', 'reprogramada') then v_detalle end,
    motivo_fallo = case when p_resultado in ('rechazada', 'reprogramada') then coalesce(v_detalle, v_motivo) else motivo_fallo end,
    reprogramada_para = v_fecha,
    deja_pendiente = case when p_resultado in ('completa', 'incompleta') and v_doc_id is not null then v_pend end,
    lineas = case when v_doc_id is not null and p_resultado in ('completa', 'incompleta') then v_lineas end,
    doc_direccion = coalesce(v_doc_dir, doc_direccion),
    updated_at = now()
  where id = p_entrega_id;
  perform set_config('guds.bypass_guard', 'off', true);

  if p_resultado in ('completa', 'incompleta') and v_ent.transferencia_odoo_id is not null then
    -- Lo único que GUDS escribe en Odoo de la entrega: el estado (validar con lo entregado). Modo en configuracion.
    v_esc := public.encolar_escritura_odoo('entrega_estado', p_entrega_id, jsonb_build_object(
      'transferencia_id', v_ent.transferencia_id, 'transferencia_odoo_id', v_ent.transferencia_odoo_id,
      'numero', coalesce(v_doc_numero, v_ent.doc_numero), 'resultado', p_resultado, 'crear_pendiente', v_pend,
      'lineas', v_lineas, 'receptor', v_receptor, 'cerrada_at', now()), v_ent.empresa_id);
  elsif p_resultado = 'completa' and v_ent.orden_id is not null then
    -- Entregas viejas ligadas a pedidos de GUDS (sin documento de Odoo)
    update ordenes set estado = case when odoo_id is null then 'completado'::orden_estado else estado end, fecha_entrega_real = now()
    where id = v_ent.orden_id;
  end if;

  if p_resultado in ('rechazada', 'reprogramada') then
    perform notif_admins(case when p_resultado = 'rechazada' then 'Entrega rechazada' else 'Entrega reprogramada' end,
      coalesce(v_ent.doc_numero, 'Entrega') || case when p_resultado = 'reprogramada' then ' para el ' || to_char(v_fecha, 'DD/MM') else '' end
        || ': ' || coalesce(v_detalle, v_motivo), 'orden', '/admin/delivery');
  end if;

  -- GPS del teléfono (20f): opcional y nunca bloquea el cierre. Si el destino no tiene ubicación confirmada queda propuesta.
  begin
    v_ubic := public.registrar_gps_cierre(p_entrega_id, p_datos->'gps');
  exception when others then
    v_ubic := 'error';
  end;
  return jsonb_build_object('estado', v_estado, 'escritura_id', v_esc, 'deja_pendiente', v_pend, 'ubicacion', v_ubic);
end $$;

-- ── 5c. Lo que ve el repartidor (19v) + orden de la ruta y ubicación de cada parada abierta ──
create or replace function public.mis_entregas_reparto(p_dias integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_yo uuid := (select public.usuario_actual_id());
begin
  if v_yo is null then raise exception 'Inicia sesión'; end if;
  return coalesce((
    select jsonb_agg(x.fila order by x.abierta desc, x.fr nulls last, x.orr nulls last, x.prioridad desc, x.orden)
    from (
      -- Abiertas: en el orden de la ruta (día y posición), luego prioridad alta y fecha programada; cerradas: la más reciente primero
      select e.estado in ('asignada', 'en_camino') abierta, (e.prioridad = 'alta') prioridad,
        case when e.estado in ('asignada', 'en_camino') then e.fecha_ruta end fr,
        case when e.estado in ('asignada', 'en_camino') then e.orden_ruta end orr,
        case when e.estado in ('asignada', 'en_camino') then extract(epoch from coalesce(t.fecha_programada, e.fecha_asignacion))
             else -extract(epoch from coalesce(e.fecha_cierre, e.updated_at)) end orden,
        jsonb_build_object(
          'id', e.id, 'estado', e.estado, 'prioridad', e.prioridad, 'empresa_id', e.empresa_id, 'empresa', em.nombre_corto,
          'fecha_asignacion', e.fecha_asignacion, 'fecha_inicio_entrega', e.fecha_inicio_entrega, 'fecha_entrega', e.fecha_entrega,
          'fecha_cierre', e.fecha_cierre, 'receptor_nombre', e.receptor_nombre, 'motivo_codigo', e.motivo_codigo, 'motivo_detalle', e.motivo_detalle,
          'motivo_fallo', e.motivo_fallo, 'reprogramada_para', e.reprogramada_para, 'origen_cierre', e.origen_cierre, 'notas', e.notas,
          'lineas_cierre', e.lineas, 'es_documento', e.transferencia_odoo_id is not null,
          'tipo', case when t.tipo = 'interna' then 'reposicion' else 'entrega' end,
          'numero', coalesce(t.numero, e.doc_numero, o.numero), 'origen', t.origen, 'estado_odoo', t.estado,
          'fecha_programada', t.fecha_programada, 'cliente', coalesce(c.nombre_negocio, t.contacto),
          'contacto', case when t.tipo = 'interna' then ad.nombre else t.contacto end,
          'direccion', coalesce(t.direccion_entrega, case when t.id is null then e.doc_direccion end, o.direccion_entrega, c.direccion),
          'ciudad', coalesce(t.ciudad_entrega, o.ciudad_entrega, c.ciudad), 'region', t.region_entrega,
          'telefono', coalesce(nullif(t.telefono_entrega, ''), nullif(c.telefono, ''), nullif(c.celular, '')),
          'notas_documento', t.notas,
          'fecha_ruta', e.fecha_ruta, 'orden_ruta', e.orden_ruta,
          'ubicacion', case when e.estado in ('asignada', 'en_camino') and u.id is not null then jsonb_build_object(
            'lat', u.latitud, 'lng', u.longitud, 'confirmada', u.confirmada, 'fuente', u.fuente, 'precision_m', u.precision_m) end,
          'lineas', case when t.id is not null then (
              select coalesce(jsonb_agg(jsonb_build_object('id', ti.id, 'producto', coalesce(ti.nombre_producto, p.nombre), 'unidad', ti.unidad,
                'demandada', ti.cantidad_demandada, 'esperada', coalesce(ti.cantidad_hecha, 0),
                'estado', ti.estado,
                'lotes', (select coalesce(jsonb_agg(jsonb_build_object('lote', tl.lote_nombre, 'cantidad', tl.cantidad, 'vence', l.vencimiento) order by l.vencimiento nulls last, tl.lote_nombre), '[]'::jsonb)
                          from transferencia_lotes tl left join lotes l on l.id = tl.lote_id where tl.item_id = ti.id)
              ) order by ti.odoo_id), '[]'::jsonb)
              from transferencia_items ti left join productos p on p.id = ti.producto_id
              where ti.transferencia_id = t.id and coalesce(ti.estado, '') <> 'cancelada')
            else (
              select coalesce(jsonb_agg(jsonb_build_object('id', oi.id, 'producto', coalesce(p.nombre, 'Producto'), 'unidad', null,
                'demandada', oi.cantidad, 'esperada', oi.cantidad, 'estado', null, 'lotes', '[]'::jsonb)), '[]'::jsonb)
              from orden_items oi left join productos p on p.id = oi.producto_id where oi.orden_id = e.orden_id)
            end
        ) fila
      from entregas e
      join empresas em on em.id = e.empresa_id
      left join transferencias t on t.id = e.transferencia_id
      left join almacenes ad on ad.id = t.almacen_destino_id
      left join ordenes o on o.id = e.orden_id
      left join clientes c on c.id = coalesce(e.cliente_id, case when t.tipo = 'interna' then ad.cliente_id else t.cliente_id end, o.cliente_id)
      left join lateral (
        select u.* from ubicaciones_entrega u
        where (e.direccion_id is not null and u.direccion_id = e.direccion_id) or (e.direccion_id is null and u.direccion_id is null and u.cliente_id = c.id)
        limit 1) u on true
      where e.repartidor_id = v_yo
        and (e.estado in ('asignada', 'en_camino') or coalesce(e.fecha_cierre, e.fecha_entrega, e.updated_at) > now() - make_interval(days => greatest(1, least(coalesce(p_dias, 30), 365))))
    ) x), '[]'::jsonb);
end $$;

-- ── Permisos ────────────────────────────────────────────────────────────
revoke execute on function public.direccion_destino_transferencia(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.trg_entrega_destino_ruta() from public, anon, authenticated;
revoke execute on function public.puede_editar_ubicaciones() from public, anon, authenticated;
revoke execute on function public.registrar_gps_cierre(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.guardar_ubicacion_entrega(uuid, uuid, numeric, numeric, numeric) from public, anon;
revoke execute on function public.confirmar_ubicacion_entrega(uuid) from public, anon;
revoke execute on function public.borrar_ubicacion_entrega(uuid) from public, anon;
revoke execute on function public.guardar_punto_salida(numeric, numeric, text) from public, anon;
revoke execute on function public.ruta_reparto_admin(uuid, date) from public, anon;
revoke execute on function public.publicar_ruta_reparto(uuid, date, uuid[]) from public, anon;
revoke execute on function public.cerrar_entrega(uuid, text, jsonb) from public, anon;
revoke execute on function public.mis_entregas_reparto(integer) from public, anon;
grant execute on function public.guardar_ubicacion_entrega(uuid, uuid, numeric, numeric, numeric) to authenticated;
grant execute on function public.confirmar_ubicacion_entrega(uuid) to authenticated;
grant execute on function public.borrar_ubicacion_entrega(uuid) to authenticated;
grant execute on function public.guardar_punto_salida(numeric, numeric, text) to authenticated;
grant execute on function public.ruta_reparto_admin(uuid, date) to authenticated;
grant execute on function public.publicar_ruta_reparto(uuid, date, uuid[]) to authenticated;
grant execute on function public.cerrar_entrega(uuid, text, jsonb) to authenticated;
grant execute on function public.mis_entregas_reparto(integer) to authenticated;

notify pgrst, 'reload schema';

commit;
