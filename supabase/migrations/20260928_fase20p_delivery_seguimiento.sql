-- ════════════════════════════════════════════════════════════════════════
-- Fase 20p · Delivery D6: seguimiento del día, incidencias, devoluciones y en indicadores (docs/PLAN-PORTALES-Y-FLUJOS.md §6)
--   Decisión del dueño (28-sep): la plataforma queda EN LÍNEA (sin app instalable ni modo sin señal). Una web no sigue la
--   posición en segundo plano: el seguimiento es la "última posición conocida" que manda la app mientras el repartidor está
--   en Mi ruta o con una entrega en camino. Nada de esto se escribe en Odoo.
--   1. posiciones_repartidor: pings livianos (en lote, cada 2–3 min o al moverse > 200 m) que SOLO escribe el repartidor
--      (registrar_posiciones) y solo con reparto en curso; los lee administración. Retención de 90 días (job diario).
--   2. seguimiento_delivery(fecha): vista "En curso" del admin: por repartidor, la última posición (ping o GPS del cierre),
--      el rastro del día y sus paradas (hechas, pendientes, siguiente) con el avance.
--   3. incidencias_entrega: se abre sola cuando una entrega se cierra incompleta, rechazada o reprogramada (con lo que regresa
--      al almacén); administración reprograma (vuelve a la cola con fecha), reasigna o la marca resuelta con nota; almacén (o
--      administración) confirma la devolución con cantidades por producto, quién y cuándo (tarea y evidencia para Odoo).
--   4. indicadores_delivery(desde, hasta): por período y repartidor (asignadas, cerradas, % por resultado, a tiempo, tiempo de
--      salida a entrega, reprogramaciones y motivos más frecuentes).
-- ════════════════════════════════════════════════════════════════════════
begin;

-- ── 1. Posiciones del repartidor ────────────────────────────────────────
create table if not exists public.posiciones_repartidor (
  id bigserial primary key,
  repartidor_id uuid not null references public.usuarios(id) on delete cascade,
  latitud numeric(9,6) not null check (latitud between -90 and 90),
  longitud numeric(9,6) not null check (longitud between -180 and 180),
  precision_m numeric(8,1) check (precision_m >= 0),
  entrega_id uuid references public.entregas(id) on delete set null,
  tomada_at timestamptz not null,
  registrada_at timestamptz not null default now()
);
comment on table public.posiciones_repartidor is 'Última posición conocida del repartidor (pings de la app con Mi ruta abierta o una entrega en camino). Solo la escribe el repartidor por registrar_posiciones; la lee administración. Se purga a los 90 días.';
comment on column public.posiciones_repartidor.tomada_at is 'Hora del teléfono en que se tomó la lectura';
comment on column public.posiciones_repartidor.entrega_id is 'Entrega en camino al momento del ping (si había)';
create unique index if not exists posiciones_repartidor_unica on public.posiciones_repartidor (repartidor_id, tomada_at);
create index if not exists posiciones_repartidor_purga on public.posiciones_repartidor (tomada_at);

alter table public.posiciones_repartidor enable row level security;
drop policy if exists posiciones_repartidor_admin_ver on public.posiciones_repartidor;
create policy posiciones_repartidor_admin_ver on public.posiciones_repartidor for select to authenticated
  using ((select public.es_personal_admin()) and (select public.puede('delivery', 'ver')));
revoke all on table public.posiciones_repartidor from anon;
revoke insert, update, delete, truncate, references, trigger on table public.posiciones_repartidor from authenticated;
grant select on table public.posiciones_repartidor to authenticated;
revoke all on sequence public.posiciones_repartidor_id_seq from anon, authenticated;

-- Registrar pings en lote (repartidor). p_puntos: [{lat, lng, precision, at}] con at = hora del teléfono en ms (epoch).
--   · Solo el usuario con rol delivery y solo con reparto en curso: una entrega en camino o paradas abiertas para hoy
--     (planificadas hoy, sin planificar o atrasadas). Fuera de eso no se guarda nada (responde activo = false).
--   · Idempotente por (repartidor, hora del teléfono): reintentar el mismo lote no duplica.
--   · Descarta lecturas inválidas o muy imprecisas (> 5 km); una hora del teléfono fuera de rango se toma como la del servidor.
create or replace function public.registrar_posiciones(p_puntos jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_yo uuid := (select public.usuario_actual_id());
  v_hoy date := (now() at time zone 'America/Caracas')::date;
  v_ent uuid; v_total integer; v_ok integer := 0; v_recientes integer;
begin
  if v_yo is null or not exists (select 1 from usuarios u where u.id = v_yo and u.role = 'delivery' and coalesce(u.activo, true)) then
    raise exception 'Solo el repartidor registra su posición';
  end if;
  if p_puntos is null or jsonb_typeof(p_puntos) <> 'array' then raise exception 'Posiciones inválidas'; end if;
  v_total := jsonb_array_length(p_puntos);
  if v_total > 60 then raise exception 'Demasiadas posiciones en un envío'; end if;

  select e.id into v_ent from entregas e where e.repartidor_id = v_yo and e.estado = 'en_camino'
  order by e.fecha_inicio_entrega desc nulls last limit 1;
  if v_ent is null and not exists (select 1 from entregas e where e.repartidor_id = v_yo and e.estado = 'asignada'
                                     and (e.fecha_ruta is null or e.fecha_ruta <= v_hoy)) then
    return jsonb_build_object('aceptados', 0, 'descartados', v_total, 'activo', false);
  end if;
  if v_total = 0 then return jsonb_build_object('aceptados', 0, 'descartados', 0, 'activo', true); end if;

  select count(*) into v_recientes from posiciones_repartidor where repartidor_id = v_yo and registrada_at > now() - interval '10 minutes';
  if v_recientes > 120 then raise exception 'Demasiadas posiciones seguidas: espera unos minutos'; end if;

  with p as (
    select case when jsonb_typeof(x->'lat') = 'number' then round((x->>'lat')::numeric, 6) end lat,
           case when jsonb_typeof(x->'lng') = 'number' then round((x->>'lng')::numeric, 6) end lng,
           case when jsonb_typeof(x->'precision') = 'number' then round((x->>'precision')::numeric, 1) end prec,
           case when jsonb_typeof(x->'at') = 'number' and (x->>'at')::numeric between 0 and 32503680000000
                then to_timestamp((x->>'at')::numeric / 1000) end at
    from jsonb_array_elements(p_puntos) x
  ), v as (
    select lat, lng, prec,
      case when at is null or at > now() + interval '10 minutes' or at < now() - interval '12 hours' then now() else at end at
    from p
    where lat between -90 and 90 and lng between -180 and 180 and (prec is null or (prec >= 0 and prec <= 5000))
  ), ins as (
    insert into posiciones_repartidor (repartidor_id, latitud, longitud, precision_m, entrega_id, tomada_at)
    select distinct on (v.at) v_yo, v.lat, v.lng, v.prec, v_ent, v.at from v order by v.at
    on conflict (repartidor_id, tomada_at) do nothing
    returning 1)
  select count(*) into v_ok from ins;
  return jsonb_build_object('aceptados', v_ok, 'descartados', v_total - v_ok, 'activo', true);
end $$;

-- Retención: 90 días (job diario). Interna.
create or replace function public.purgar_posiciones_repartidor()
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  delete from posiciones_repartidor where tomada_at < now() - interval '90 days';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ── 2. Seguimiento del día (administración) ─────────────────────────────
--   Paradas del día: planificadas ese día, cerradas ese día y (si es hoy) las abiertas sin planificar o atrasadas, de todas
--   las empresas a las que el admin tiene acceso (rutas mixtas). Posición: la más reciente del día entre los pings y el GPS
--   de los cierres. Rastro: hasta 500 pings del día, en orden.
create or replace function public.seguimiento_delivery(p_fecha date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_hoy date := (now() at time zone 'America/Caracas')::date;
  v_f date := coalesce(p_fecha, (now() at time zone 'America/Caracas')::date);
  v_ini timestamptz; v_fin timestamptz; v_res jsonb;
begin
  if not ((select public.es_personal_admin()) and (select public.puede('delivery', 'ver'))) then
    raise exception 'Solo administración puede ver el seguimiento de delivery';
  end if;
  v_ini := v_f::timestamp at time zone 'America/Caracas';
  v_fin := (v_f + 1)::timestamp at time zone 'America/Caracas';

  with par as (
    select e.id, e.repartidor_id, e.estado::text estado, e.prioridad, e.fecha_ruta, e.orden_ruta, e.fecha_asignacion, e.fecha_inicio_entrega,
      e.fecha_cierre, e.origen_cierre, e.motivo_codigo, e.reprogramada_para, e.cierre_lat, e.cierre_lng,
      coalesce(t.numero, e.doc_numero, o.numero) numero, em.nombre_corto empresa,
      case when t.tipo = 'interna' then 'reposicion' else 'entrega' end tipo,
      coalesce(c.nombre_negocio, t.contacto) cliente, d.nombre sucursal,
      coalesce(t.direccion_entrega, e.doc_direccion, d.direccion, o.direccion_entrega, c.direccion) direccion,
      coalesce(t.ciudad_entrega, d.ciudad, o.ciudad_entrega, c.ciudad) ciudad,
      u.latitud ulat, u.longitud ulng, u.confirmada uconf,
      (e.fecha_ruta = v_f) en_ruta
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
    where e.repartidor_id is not null and e.estado <> 'cancelada' and e.empresa_id = any (public.empresas_permitidas())
      and (e.fecha_ruta = v_f
        or (v_f = v_hoy and e.estado in ('asignada', 'en_camino') and (e.fecha_ruta is null or e.fecha_ruta < v_hoy))
        or (e.estado not in ('asignada', 'en_camino') and e.fecha_cierre >= v_ini and e.fecha_cierre < v_fin))
  ),
  reps as (
    select repartidor_id id from par
    union
    select p.repartidor_id from posiciones_repartidor p where p.tomada_at >= v_ini and p.tomada_at < v_fin
  ),
  fila as (
    select r.id,
      (select trim(us.nombre || ' ' || coalesce(us.apellido, '')) from usuarios us where us.id = r.id) nombre,
      (select coalesce(nullif(us.telefono, ''), null) from usuarios us where us.id = r.id) telefono,
      (select jsonb_build_object('lat', x.lat, 'lng', x.lng, 'precision_m', x.prec, 'tomada_at', x.at, 'fuente', x.fuente)
       from (
         (select p.latitud lat, p.longitud lng, p.precision_m prec, p.tomada_at at, 'ping' fuente from posiciones_repartidor p
          where p.repartidor_id = r.id and p.tomada_at >= v_ini and p.tomada_at < v_fin order by p.tomada_at desc limit 1)
         union all
         (select e.cierre_lat, e.cierre_lng, e.cierre_precision_m, e.cierre_gps_at, 'cierre' from entregas e
          where e.repartidor_id = r.id and e.cierre_lat is not null and e.cierre_gps_at >= v_ini and e.cierre_gps_at < v_fin
          order by e.cierre_gps_at desc limit 1)
       ) x order by x.at desc limit 1) posicion,
      (select coalesce(jsonb_agg(jsonb_build_array(z.latitud, z.longitud) order by z.tomada_at), '[]'::jsonb)
       from (select p.latitud, p.longitud, p.tomada_at from posiciones_repartidor p
             where p.repartidor_id = r.id and p.tomada_at >= v_ini and p.tomada_at < v_fin order by p.tomada_at desc limit 500) z) rastro,
      (select coalesce(jsonb_agg(jsonb_build_object(
          'id', p.id, 'numero', p.numero, 'empresa', p.empresa, 'tipo', p.tipo, 'estado', p.estado, 'prioridad', p.prioridad,
          'fecha_ruta', p.fecha_ruta, 'orden_ruta', p.orden_ruta, 'en_ruta', p.en_ruta, 'fecha_asignacion', p.fecha_asignacion,
          'fecha_inicio_entrega', p.fecha_inicio_entrega, 'fecha_cierre', p.fecha_cierre, 'origen_cierre', p.origen_cierre,
          'motivo_codigo', p.motivo_codigo, 'reprogramada_para', p.reprogramada_para,
          'cliente', p.cliente, 'sucursal', p.sucursal, 'direccion', p.direccion, 'ciudad', p.ciudad,
          'ubicacion', case when p.ulat is null then null else jsonb_build_object('lat', p.ulat, 'lng', p.ulng, 'confirmada', p.uconf) end,
          'cierre', case when p.cierre_lat is null then null else jsonb_build_object('lat', p.cierre_lat, 'lng', p.cierre_lng) end)
        order by p.en_ruta desc nulls last, p.orden_ruta nulls last, p.fecha_asignacion), '[]'::jsonb)
       from par p where p.repartidor_id = r.id) paradas
    from reps r
  )
  select jsonb_build_object('fecha', v_f, 'hoy', v_f = v_hoy, 'generado_at', now(),
    'repartidores', coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'nombre', f.nombre, 'telefono', f.telefono, 'posicion', f.posicion,
      'rastro', f.rastro, 'paradas', f.paradas) order by f.nombre), '[]'::jsonb))
  into v_res from fila f;
  return v_res;
end $$;

-- ── 3. Incidencias de entrega ───────────────────────────────────────────
create table if not exists public.incidencias_entrega (
  id uuid primary key default gen_random_uuid(),
  entrega_id uuid not null unique references public.entregas(id) on delete cascade,
  empresa_id uuid references public.empresas(id),
  tipo text not null check (tipo in ('incompleta', 'rechazada', 'reprogramada')),
  estado text not null default 'abierta' check (estado in ('abierta', 'reprogramada', 'reasignada', 'resuelta')),
  fecha_objetivo date,
  nueva_entrega_id uuid references public.entregas(id) on delete set null,
  devolucion text not null default 'no_aplica' check (devolucion in ('no_aplica', 'pendiente', 'confirmada')),
  devolucion_lineas jsonb,
  devolucion_nota text,
  devolucion_por uuid references public.usuarios(id) on delete set null,
  devolucion_at timestamptz,
  nota text,
  resuelta_por uuid references public.usuarios(id) on delete set null,
  resuelta_at timestamptz,
  historial jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint incidencias_entrega_resuelta check (estado <> 'resuelta' or (resuelta_at is not null and nullif(trim(coalesce(nota, '')), '') is not null))
);
-- Confirmada = con fecha (quién puede quedar vacío si luego se borra el usuario: la FK es ON DELETE SET NULL)
alter table public.incidencias_entrega drop constraint if exists incidencias_entrega_devolucion;
alter table public.incidencias_entrega add constraint incidencias_entrega_devolucion check (devolucion <> 'confirmada' or devolucion_at is not null);
comment on table public.incidencias_entrega is 'Incidencia de una entrega cerrada incompleta, rechazada o reprogramada: lo decide administración (reprogramar, reasignar o resolver con nota) y almacén confirma la devolución. Solo GUDS: no se escribe en Odoo (queda como tarea y evidencia).';
comment on column public.incidencias_entrega.fecha_objetivo is 'Fecha en que el documento vuelve a la cola (la de la reprogramación del repartidor o la que fija administración)';
comment on column public.incidencias_entrega.devolucion_lineas is 'Lo que regresa al almacén: [{item_id, move_odoo_id, producto, unidad, esperada, recibida, motivo}]';
create index if not exists incidencias_entrega_abiertas on public.incidencias_entrega (created_at desc) where estado <> 'resuelta';
create index if not exists incidencias_entrega_devolucion on public.incidencias_entrega (created_at desc) where devolucion = 'pendiente';

alter table public.incidencias_entrega enable row level security;
drop policy if exists incidencias_entrega_ver on public.incidencias_entrega;
create policy incidencias_entrega_ver on public.incidencias_entrega for select to authenticated
  using ((select public.es_personal_admin())
    and ((select public.puede('delivery', 'ver')) or ((select public.puede('inventario', 'ver')) and devolucion <> 'no_aplica'))
    and (empresa_id is null or empresa_id = any ((select public.empresas_visibles())::uuid[])));
revoke all on table public.incidencias_entrega from anon;
revoke insert, update, delete, truncate, references, trigger on table public.incidencias_entrega from authenticated;
grant select on table public.incidencias_entrega to authenticated;

-- Quién confirma devoluciones: personal de administración con delivery o inventario (editar). Interna.
create or replace function public.puede_confirmar_devolucion()
returns boolean language sql stable security definer set search_path = public as $$
  select (select public.es_personal_admin()) and ((select public.puede('delivery', 'editar')) or (select public.puede('inventario', 'editar')));
$$;

-- Al cerrar una entrega incompleta, rechazada o reprogramada se abre su incidencia, con lo que regresa al almacén
-- (incompleta: lo no entregado por producto; rechazada: todo lo que llevaba el camión). Avisa a administración (la
-- incompleta; el rechazo y la reprogramación ya los avisa cerrar_entrega), al vendedor del cliente (incompleta y rechazada)
-- y al personal de almacén cuando hay devolución por confirmar.
create or replace function public.trg_entrega_incidencia()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_lineas jsonb; v_dev text; v_num text; v_orden uuid; v_cli text; v_mot text; v_id uuid;
begin
  if new.estado::text not in ('incompleta', 'rechazada', 'reprogramada') then return new; end if;
  if tg_op = 'UPDATE' and old.estado is not distinct from new.estado then return new; end if;

  if new.estado::text = 'incompleta' then
    select jsonb_agg(jsonb_build_object('item_id', l->>'item_id', 'move_odoo_id', (l->>'move_odoo_id')::int, 'producto', l->>'producto',
        'unidad', ti.unidad, 'esperada', coalesce((l->>'esperada')::numeric, 0) - coalesce((l->>'entregada')::numeric, 0), 'motivo', l->>'motivo')
      order by (l->>'move_odoo_id')::int)
    into v_lineas
    from jsonb_array_elements(coalesce(new.lineas, '[]'::jsonb)) l
    left join transferencia_items ti on ti.id::text = l->>'item_id'
    where coalesce((l->>'esperada')::numeric, 0) - coalesce((l->>'entregada')::numeric, 0) > 0;
  elsif new.estado::text = 'rechazada' and new.transferencia_id is not null then
    select jsonb_agg(jsonb_build_object('item_id', ti.id, 'move_odoo_id', ti.odoo_id, 'producto', coalesce(ti.nombre_producto, p.nombre),
        'unidad', ti.unidad, 'esperada', ti.cantidad_hecha, 'motivo', new.motivo_codigo) order by ti.odoo_id)
    into v_lineas
    from transferencia_items ti left join productos p on p.id = ti.producto_id
    where ti.transferencia_id = new.transferencia_id and coalesce(ti.estado, '') <> 'cancelada' and coalesce(ti.cantidad_hecha, 0) > 0;
  end if;
  v_dev := case when v_lineas is not null and jsonb_array_length(v_lineas) > 0 then 'pendiente' else 'no_aplica' end;

  insert into incidencias_entrega (entrega_id, empresa_id, tipo, estado, fecha_objetivo, devolucion, devolucion_lineas, historial)
  values (new.id, new.empresa_id, new.estado::text, case when new.estado::text = 'reprogramada' then 'reprogramada' else 'abierta' end,
    case when new.estado::text = 'reprogramada' then new.reprogramada_para end, v_dev, case when v_dev = 'pendiente' then v_lineas end,
    jsonb_build_array(jsonb_build_object('accion', 'abierta', 'at', coalesce(new.fecha_cierre, now()), 'por', new.cerrada_por,
      'detalle', nullif(concat_ws(' · ', new.motivo_codigo, new.motivo_detalle), ''))))
  on conflict (entrega_id) do nothing
  returning id into v_id;
  if v_id is null then return new; end if;

  v_num := coalesce(new.doc_numero, 'Entrega');
  v_orden := coalesce(new.orden_id, (select t.orden_id from transferencias t where t.id = new.transferencia_id));
  select nombre_negocio into v_cli from clientes where id = new.cliente_id;
  v_mot := (select string_agg(distinct l->>'motivo', ', ') from jsonb_array_elements(coalesce(new.lineas, '[]'::jsonb)) l where l->>'motivo' is not null);
  if new.estado::text = 'incompleta' then
    perform notif_admins('Entrega incompleta', v_num || coalesce(' · ' || v_cli, '') || ': regresa mercancía al almacén' || coalesce(' (' || v_mot || ')', '') || '.',
      'orden', '/admin/delivery?vista=incidencias');
  end if;
  if new.estado::text in ('incompleta', 'rechazada') and new.cliente_id is not null then
    perform notif_vendedor(new.cliente_id, case when new.estado::text = 'rechazada' then 'Entrega rechazada' else 'Entrega incompleta' end,
      coalesce(v_cli, 'Cliente') || ': ' || v_num || case when new.estado::text = 'rechazada' then ' fue rechazada' else ' se entregó incompleta' end
        || coalesce(' (' || coalesce(new.motivo_detalle, new.motivo_codigo, v_mot) || ')', '') || '.',
      'alerta', case when v_orden is not null then '/vendedor/pedidos?pedido=' || v_orden else '/vendedor' end);
  end if;
  if v_dev = 'pendiente' then
    -- Personal de almacén (rol con inventario editar, sin ser administración total ni tener delivery): la devolución por confirmar
    insert into notificaciones (usuario_id, titulo, mensaje, tipo, link, leida)
    select u.id, 'Devolución por confirmar', v_num || coalesce(' · ' || v_cli, '') || ': confirma lo que regresó al almacén.', 'orden', '/admin/delivery/devoluciones', false
    from usuarios u join roles r on r.id = u.rol_id
    where u.role = 'admin' and coalesce(u.activo, true) and r.nombre <> 'Administrador'
      and exists (select 1 from permisos pe join modulos m on m.id = pe.modulo_id where pe.rol_id = u.rol_id and m.codigo = 'inventario' and pe.puede_editar)
      and not exists (select 1 from permisos pe join modulos m on m.id = pe.modulo_id where pe.rol_id = u.rol_id and m.codigo = 'delivery' and pe.puede_ver);
  end if;
  return new;
end $$;
drop trigger if exists zz_entrega_incidencia on public.entregas;
create trigger zz_entrega_incidencia after insert or update of estado on public.entregas
  for each row execute function public.trg_entrega_incidencia();

-- Bitácora simple de la incidencia (interna)
create or replace function public.incidencia_historial(p_hist jsonb, p_accion text, p_detalle text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(p_hist, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('accion', p_accion, 'at', now(),
    'por', (select public.usuario_actual_id()), 'detalle', nullif(trim(coalesce(p_detalle, '')), '')));
$$;

-- Lista de incidencias (administración) o solo las devoluciones (administración o almacén), con la entrega, el documento,
-- la evidencia, el intento y si el documento ya volvió a asignarse. Por resolver de cualquier fecha + resueltas de p_dias.
create or replace function public.incidencias_delivery(p_dias integer default 60, p_solo_devoluciones boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not ((select public.es_personal_admin()) and ((select public.puede('delivery', 'ver'))
          or (coalesce(p_solo_devoluciones, false) and (select public.puede('inventario', 'ver'))))) then
    raise exception 'No tienes permiso para ver las incidencias de delivery';
  end if;
  return coalesce((
    select jsonb_agg(x.fila order by x.orden desc)
    from (
      select i.created_at orden, jsonb_build_object(
        'id', i.id, 'entrega_id', i.entrega_id, 'empresa_id', i.empresa_id, 'empresa', em.nombre_corto, 'tipo', i.tipo, 'estado', i.estado,
        'fecha_objetivo', i.fecha_objetivo, 'devolucion', i.devolucion, 'devolucion_lineas', i.devolucion_lineas, 'devolucion_nota', i.devolucion_nota,
        'devolucion_at', i.devolucion_at, 'devolucion_por', (select trim(u.nombre || ' ' || coalesce(u.apellido, '')) from usuarios u where u.id = i.devolucion_por),
        'nota', i.nota, 'resuelta_at', i.resuelta_at, 'resuelta_por', (select trim(u.nombre || ' ' || coalesce(u.apellido, '')) from usuarios u where u.id = i.resuelta_por),
        'historial', i.historial, 'created_at', i.created_at,
        'numero', coalesce(t.numero, e.doc_numero, o.numero), 'transferencia_id', e.transferencia_id, 'transferencia_odoo_id', e.transferencia_odoo_id,
        'estado_odoo', t.estado, 'origen', t.origen, 'tipo_doc', case when t.tipo = 'interna' then 'reposicion' else 'entrega' end,
        'cliente', coalesce(c.nombre_negocio, t.contacto), 'cliente_id', c.id,
        'direccion', coalesce(t.direccion_entrega, e.doc_direccion, c.direccion), 'ciudad', coalesce(t.ciudad_entrega, c.ciudad),
        'repartidor_id', e.repartidor_id, 'repartidor', (select trim(u.nombre || ' ' || coalesce(u.apellido, '')) from usuarios u where u.id = e.repartidor_id),
        'estado_entrega', e.estado, 'fecha_asignacion', e.fecha_asignacion, 'fecha_inicio_entrega', e.fecha_inicio_entrega, 'fecha_cierre', e.fecha_cierre,
        'motivo_codigo', e.motivo_codigo, 'motivo_detalle', e.motivo_detalle, 'reprogramada_para', e.reprogramada_para, 'notas', e.notas,
        'receptor_nombre', e.receptor_nombre, 'firma_url', e.firma_url, 'foto_entrega_url', e.foto_entrega_url, 'lineas', e.lineas,
        'deja_pendiente', e.deja_pendiente,
        'intento', (select count(*) from entregas p where e.transferencia_odoo_id is not null and p.transferencia_odoo_id = e.transferencia_odoo_id
                      and p.estado <> 'cancelada' and p.created_at <= e.created_at),
        'activa', (select jsonb_build_object('id', a.id, 'estado', a.estado, 'repartidor', trim(u.nombre || ' ' || coalesce(u.apellido, '')), 'fecha_ruta', a.fecha_ruta)
                   from entregas a left join usuarios u on u.id = a.repartidor_id
                   where e.transferencia_odoo_id is not null and a.transferencia_odoo_id = e.transferencia_odoo_id and a.estado in ('asignada', 'en_camino') limit 1),
        'nueva', (select jsonb_build_object('id', n.id, 'estado', n.estado, 'repartidor', trim(u.nombre || ' ' || coalesce(u.apellido, '')), 'fecha_cierre', n.fecha_cierre)
                  from entregas n left join usuarios u on u.id = n.repartidor_id where n.id = i.nueva_entrega_id)
      ) fila
      from incidencias_entrega i
      join entregas e on e.id = i.entrega_id
      left join empresas em on em.id = i.empresa_id
      left join transferencias t on t.id = e.transferencia_id
      left join almacenes ad on ad.id = t.almacen_destino_id
      left join ordenes o on o.id = e.orden_id
      left join clientes c on c.id = coalesce(e.cliente_id, case when t.tipo = 'interna' then ad.cliente_id else t.cliente_id end, o.cliente_id)
      where (i.empresa_id is null or i.empresa_id = any (public.empresas_visibles()))
        and (not coalesce(p_solo_devoluciones, false) or i.devolucion <> 'no_aplica')
        and (i.estado <> 'resuelta' or i.devolucion = 'pendiente'
             or i.updated_at > now() - make_interval(days => greatest(1, least(coalesce(p_dias, 60), 365))))
    ) x), '[]'::jsonb);
end $$;

-- Incidencia bloqueada para decidir (interna): valida permiso, empresa y que no esté resuelta
create or replace function public.incidencia_para_decidir(p_id uuid)
returns public.incidencias_entrega language plpgsql security definer set search_path = public as $$
declare v public.incidencias_entrega;
begin
  if not ((select public.es_personal_admin()) and (select public.puede('delivery', 'editar'))) then
    raise exception 'Solo administración puede decidir sobre las incidencias de delivery';
  end if;
  select * into v from incidencias_entrega where id = p_id for update;
  if not found then raise exception 'Incidencia no encontrada'; end if;
  if v.empresa_id is not null and not (v.empresa_id = any (public.empresas_permitidas())) then
    raise exception 'No tienes acceso a la empresa de esta incidencia';
  end if;
  if v.estado = 'resuelta' then raise exception 'La incidencia ya está resuelta'; end if;
  return v;
end $$;

-- Reprogramar (administración): el documento vuelve a la cola con la fecha nueva. Solo rechazos y reprogramaciones (una
-- entrega incompleta ya se entregó: lo que faltó sale en Odoo como pendiente) y solo si el documento sigue abierto en Odoo
-- y no volvió a asignarse.
create or replace function public.reprogramar_incidencia(p_id uuid, p_fecha date, p_nota text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.incidencias_entrega; v_ent record; v_hoy date := (now() at time zone 'America/Caracas')::date;
begin
  v := public.incidencia_para_decidir(p_id);
  if v.tipo = 'incompleta' then raise exception 'La entrega incompleta ya se entregó: lo que faltó sale en Odoo como un documento pendiente'; end if;
  if p_fecha is null or p_fecha < v_hoy then raise exception 'La fecha nueva no puede ser anterior a hoy'; end if;
  if p_fecha > v_hoy + 60 then raise exception 'La fecha nueva puede ser hasta 60 días adelante'; end if;
  select e.transferencia_odoo_id, t.estado into v_ent from entregas e left join transferencias t on t.id = e.transferencia_id where e.id = v.entrega_id;
  if v_ent.transferencia_odoo_id is null then raise exception 'Solo se reprograman documentos de entrega de Odoo'; end if;
  if v_ent.estado is null or v_ent.estado in ('hecha', 'cancelada') then
    raise exception 'El documento ya no está abierto en Odoo (%): no se puede reprogramar', coalesce(v_ent.estado, 'no existe');
  end if;
  if exists (select 1 from entregas a where a.transferencia_odoo_id = v_ent.transferencia_odoo_id and a.estado in ('asignada', 'en_camino')) then
    raise exception 'El documento ya volvió a asignarse: cambia la fecha desde la ruta';
  end if;
  update incidencias_entrega set estado = 'reprogramada', fecha_objetivo = p_fecha, updated_at = now(),
    historial = public.incidencia_historial(historial, 'reprogramada', 'Para el ' || to_char(p_fecha, 'DD/MM/YYYY') || coalesce(' · ' || nullif(trim(p_nota), ''), ''))
  where id = p_id;
  return jsonb_build_object('estado', 'reprogramada', 'fecha_objetivo', p_fecha);
end $$;

-- Reasignar (administración): asigna otra vez el documento (a otro repartidor o al mismo) y, si se indica, lo pone en la
-- ruta de ese día (sin orden: se ordena al publicar la ruta).
create or replace function public.reasignar_incidencia(p_id uuid, p_repartidor_id uuid, p_fecha date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.incidencias_entrega; v_ent record; v_nueva uuid; v_hoy date := (now() at time zone 'America/Caracas')::date; v_f date;
begin
  v := public.incidencia_para_decidir(p_id);
  if v.tipo = 'incompleta' then raise exception 'La entrega incompleta ya se entregó: lo que faltó sale en Odoo como un documento pendiente'; end if;
  select e.transferencia_id, e.transferencia_odoo_id, e.prioridad into v_ent from entregas e where e.id = v.entrega_id;
  if v_ent.transferencia_id is null then raise exception 'El documento ya no está en Odoo: no se puede reasignar'; end if;
  if exists (select 1 from entregas a where a.transferencia_odoo_id = v_ent.transferencia_odoo_id and a.estado in ('asignada', 'en_camino')) then
    raise exception 'El documento ya tiene una entrega abierta: reasígnala desde la cola';
  end if;
  v_f := coalesce(p_fecha, v.fecha_objetivo);
  if v_f is not null and v_f < v_hoy then v_f := null; end if;
  if v_f is not null and v_f > v_hoy + 60 then raise exception 'La fecha puede ser hasta 60 días adelante'; end if;
  v_nueva := public.asignar_entrega_documento(v_ent.transferencia_id, p_repartidor_id, coalesce(v_ent.prioridad, 'normal'));
  if v_f is not null then
    perform set_config('guds.bypass_guard', 'on', true);
    update entregas set fecha_ruta = v_f, orden_ruta = null where id = v_nueva;
    perform set_config('guds.bypass_guard', 'off', true);
  end if;
  update incidencias_entrega set estado = 'reasignada', nueva_entrega_id = v_nueva, fecha_objetivo = coalesce(v_f, fecha_objetivo), updated_at = now(),
    historial = public.incidencia_historial(historial, 'reasignada',
      (select trim(u.nombre || ' ' || coalesce(u.apellido, '')) from usuarios u where u.id = p_repartidor_id)
        || coalesce(' · ruta del ' || to_char(v_f, 'DD/MM/YYYY'), ''))
  where id = p_id;
  return jsonb_build_object('estado', 'reasignada', 'entrega_id', v_nueva, 'fecha_ruta', v_f);
end $$;

-- Resolver (administración) con nota. Si hay mercancía que regresa, primero la confirma almacén.
create or replace function public.resolver_incidencia(p_id uuid, p_nota text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.incidencias_entrega; v_nota text := nullif(trim(coalesce(p_nota, '')), '');
begin
  v := public.incidencia_para_decidir(p_id);
  if v_nota is null or length(v_nota) < 3 then raise exception 'Escribe una nota con lo que se decidió'; end if;
  if v.devolucion = 'pendiente' then raise exception 'Falta que almacén confirme la devolución de la mercancía'; end if;
  update incidencias_entrega set estado = 'resuelta', nota = left(v_nota, 1000), resuelta_por = (select public.usuario_actual_id()), resuelta_at = now(),
    updated_at = now(), historial = public.incidencia_historial(historial, 'resuelta', left(v_nota, 300))
  where id = p_id;
  return jsonb_build_object('estado', 'resuelta');
end $$;

-- Confirmar la devolución (almacén o administración): cantidad recibida por producto (0 … lo que regresaba); si falta algo
-- hace falta una nota. Queda quién y cuándo. No escribe en Odoo: la devolución y la nota de crédito se hacen allá.
--   p_lineas: [{item_id, recibida}]
create or replace function public.confirmar_devolucion_entrega(p_id uuid, p_lineas jsonb, p_nota text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v public.incidencias_entrega; v_l jsonb; v_x jsonb; v_q numeric; v_esp numeric; v_nuevas jsonb := '[]'::jsonb; v_falta boolean := false;
  v_nota text := nullif(trim(coalesce(p_nota, '')), ''); v_num text; v_yo uuid := (select public.usuario_actual_id());
begin
  if not public.puede_confirmar_devolucion() then
    raise exception 'Solo almacén o administración pueden confirmar devoluciones';
  end if;
  select * into v from incidencias_entrega where id = p_id for update;
  if not found then raise exception 'Incidencia no encontrada'; end if;
  if v.empresa_id is not null and not (v.empresa_id = any (public.empresas_permitidas())) then
    raise exception 'No tienes acceso a la empresa de esta devolución';
  end if;
  if v.devolucion = 'no_aplica' then raise exception 'Esta entrega no tiene mercancía que regrese al almacén'; end if;
  if v.devolucion = 'confirmada' then raise exception 'La devolución ya se confirmó'; end if;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' then raise exception 'Indica lo que se recibió por producto'; end if;

  for v_l in select * from jsonb_array_elements(coalesce(v.devolucion_lineas, '[]'::jsonb)) loop
    v_esp := coalesce((v_l->>'esperada')::numeric, 0);
    select x into v_x from jsonb_array_elements(p_lineas) x where x->>'item_id' = v_l->>'item_id' limit 1;
    if v_x is null then raise exception 'Indica la cantidad recibida de %', v_l->>'producto'; end if;
    begin v_q := (v_x->>'recibida')::numeric; exception when others then v_q := null; end;
    if v_q is null or v_q < 0 or v_q > v_esp then raise exception 'La cantidad recibida de % debe estar entre 0 y %', v_l->>'producto', v_esp; end if;
    if v_q < v_esp then v_falta := true; end if;
    v_nuevas := v_nuevas || (v_l || jsonb_build_object('recibida', v_q));
  end loop;
  if v_falta and (v_nota is null or length(v_nota) < 3) then raise exception 'Explica en la nota por qué se recibió menos de lo que regresaba'; end if;

  update incidencias_entrega set devolucion = 'confirmada', devolucion_lineas = v_nuevas, devolucion_nota = left(v_nota, 1000),
    devolucion_por = v_yo, devolucion_at = now(), updated_at = now(),
    historial = public.incidencia_historial(historial, 'devolucion_confirmada', case when v_falta then 'Con diferencias' || coalesce(' · ' || left(v_nota, 200), '') else 'Completa' end)
  where id = p_id;

  if v_falta then
    select coalesce(e.doc_numero, 'Entrega') into v_num from entregas e where e.id = v.entrega_id;
    perform notif_admins('Devolución con diferencias', v_num || ': almacén recibió menos de lo que regresaba. ' || left(coalesce(v_nota, ''), 140),
      'alerta', '/admin/delivery?vista=incidencias');
  end if;
  return jsonb_build_object('devolucion', 'confirmada', 'con_diferencias', v_falta);
end $$;

-- Incidencias que ya existían (entregas cerradas antes de esta fase)
insert into public.incidencias_entrega (entrega_id, empresa_id, tipo, estado, fecha_objetivo, historial)
select e.id, e.empresa_id, e.estado::text, case when e.estado::text = 'reprogramada' then 'reprogramada' else 'abierta' end,
  case when e.estado::text = 'reprogramada' then e.reprogramada_para end,
  jsonb_build_array(jsonb_build_object('accion', 'abierta', 'at', coalesce(e.fecha_cierre, e.updated_at), 'por', e.cerrada_por))
from public.entregas e where e.estado::text in ('incompleta', 'rechazada', 'reprogramada')
on conflict (entrega_id) do nothing;

-- ── 4. Indicadores (administración) ─────────────────────────────────────
--   Período en días de Caracas. Asignadas: por fecha de asignación. Cerradas: por el repartidor en GUDS (completa,
--   incompleta, rechazada o reprogramada) por fecha de cierre; las cerradas desde Odoo se cuentan aparte. A tiempo: entregas
--   (completas o incompletas) hechas el día objetivo o antes: la fecha de reprogramación del intento anterior, si no la fecha
--   programada del documento en Odoo y, si no, el día de la ruta. Salida a entrega: minutos entre "salir a entregar" y el
--   cierre. Motivos: el del rechazo o la reprogramación y el de cada producto de las incompletas. Empresa activa.
create or replace function public.indicadores_delivery(p_desde date, p_hasta date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_ini timestamptz; v_fin timestamptz; v_res jsonb;
begin
  if not ((select public.es_personal_admin()) and (select public.puede('delivery', 'ver'))) then
    raise exception 'Solo administración puede ver los indicadores de delivery';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde then raise exception 'Elige un período válido'; end if;
  if p_hasta - p_desde > 366 then raise exception 'El período puede ser de hasta un año'; end if;
  v_ini := p_desde::timestamp at time zone 'America/Caracas';
  v_fin := (p_hasta + 1)::timestamp at time zone 'America/Caracas';

  with base as (
    select e.id, e.repartidor_id, e.estado::text estado, e.origen_cierre, e.fecha_asignacion, e.fecha_inicio_entrega, e.fecha_entrega,
      e.fecha_cierre, e.motivo_codigo, e.lineas,
      (e.fecha_asignacion >= v_ini and e.fecha_asignacion < v_fin) asig,
      (e.fecha_cierre >= v_ini and e.fecha_cierre < v_fin and e.origen_cierre = 'guds'
        and e.estado in ('entregada', 'incompleta', 'rechazada', 'reprogramada')) cerr,
      (e.fecha_cierre >= v_ini and e.fecha_cierre < v_fin and e.origen_cierre = 'odoo' and e.estado = 'entregada') odoo,
      (e.fecha_entrega at time zone 'America/Caracas')::date dia_entrega,
      coalesce(
        (select coalesce(i.fecha_objetivo, p.reprogramada_para) from entregas p left join incidencias_entrega i on i.entrega_id = p.id
         where e.transferencia_odoo_id is not null and p.transferencia_odoo_id = e.transferencia_odoo_id and p.id <> e.id
           and p.estado in ('reprogramada', 'rechazada') and p.fecha_cierre <= e.fecha_asignacion
         order by p.fecha_cierre desc limit 1),
        (select (t.fecha_programada at time zone 'America/Caracas')::date from transferencias t where t.id = e.transferencia_id),
        e.fecha_ruta) objetivo
    from entregas e
    where e.repartidor_id is not null and e.empresa_id = any (public.empresas_visibles())
      and ((e.fecha_asignacion >= v_ini and e.fecha_asignacion < v_fin) or (e.fecha_cierre >= v_ini and e.fecha_cierre < v_fin))
  ),
  met as (
    select repartidor_id, grouping(repartidor_id) = 1 total,
      count(*) filter (where asig) asignadas,
      count(*) filter (where cerr) cerradas,
      count(*) filter (where cerr and estado = 'entregada') completas,
      count(*) filter (where cerr and estado = 'incompleta') incompletas,
      count(*) filter (where cerr and estado = 'rechazada') rechazadas,
      count(*) filter (where cerr and estado = 'reprogramada') reprogramadas,
      count(*) filter (where odoo) cerradas_odoo,
      count(*) filter (where cerr and estado in ('entregada', 'incompleta') and objetivo is not null) con_objetivo,
      count(*) filter (where cerr and estado in ('entregada', 'incompleta') and objetivo is not null and dia_entrega <= objetivo) a_tiempo,
      round((avg(extract(epoch from fecha_entrega - fecha_inicio_entrega) / 60) filter (where cerr and estado in ('entregada', 'incompleta')
        and fecha_inicio_entrega is not null and fecha_entrega >= fecha_inicio_entrega))::numeric, 1) minutos_salida_entrega,
      count(*) filter (where cerr and estado in ('entregada', 'incompleta') and fecha_inicio_entrega is not null and fecha_entrega >= fecha_inicio_entrega) con_tiempo
    from base
    group by grouping sets ((repartidor_id), ())
  ),
  mot as (
    select repartidor_id, tipo, codigo, count(*) n from (
      select repartidor_id, estado tipo, motivo_codigo codigo from base where cerr and estado in ('rechazada', 'reprogramada') and motivo_codigo is not null
      union all
      select b.repartidor_id, 'incompleta', l->>'motivo' from base b cross join lateral jsonb_array_elements(coalesce(b.lineas, '[]'::jsonb)) l
      where b.cerr and b.estado = 'incompleta' and nullif(l->>'motivo', '') is not null
    ) z group by repartidor_id, tipo, codigo
  )
  select jsonb_build_object('desde', p_desde, 'hasta', p_hasta,
    'total', (select to_jsonb(m) - 'repartidor_id' - 'total' from met m where m.total),
    'repartidores', coalesce((select jsonb_agg((to_jsonb(m) - 'total') || jsonb_build_object('id', m.repartidor_id,
        'nombre', (select trim(u.nombre || ' ' || coalesce(u.apellido, '')) from usuarios u where u.id = m.repartidor_id),
        'motivos', (select coalesce(jsonb_agg(jsonb_build_object('tipo', x.tipo, 'codigo', x.codigo, 'n', x.n) order by x.n desc, x.codigo), '[]'::jsonb)
                    from (select * from mot where mot.repartidor_id = m.repartidor_id order by n desc, codigo limit 3) x))
      order by m.cerradas desc, m.asignadas desc) from met m where not m.total), '[]'::jsonb),
    'motivos', coalesce((select jsonb_agg(jsonb_build_object('tipo', x.tipo, 'codigo', x.codigo, 'n', x.n) order by x.n desc, x.tipo, x.codigo)
      from (select tipo, codigo, sum(n)::int n from mot group by tipo, codigo order by sum(n) desc, tipo, codigo limit 12) x), '[]'::jsonb))
  into v_res;
  return v_res;
end $$;

-- ── Permisos ────────────────────────────────────────────────────────────
revoke execute on function public.registrar_posiciones(jsonb) from public, anon;
revoke execute on function public.purgar_posiciones_repartidor() from public, anon, authenticated;
revoke execute on function public.seguimiento_delivery(date) from public, anon;
revoke execute on function public.puede_confirmar_devolucion() from public, anon, authenticated;
revoke execute on function public.trg_entrega_incidencia() from public, anon, authenticated;
revoke execute on function public.incidencia_historial(jsonb, text, text) from public, anon, authenticated;
revoke execute on function public.incidencia_para_decidir(uuid) from public, anon, authenticated;
revoke execute on function public.incidencias_delivery(integer, boolean) from public, anon;
revoke execute on function public.reprogramar_incidencia(uuid, date, text) from public, anon;
revoke execute on function public.reasignar_incidencia(uuid, uuid, date) from public, anon;
revoke execute on function public.resolver_incidencia(uuid, text) from public, anon;
revoke execute on function public.confirmar_devolucion_entrega(uuid, jsonb, text) from public, anon;
revoke execute on function public.indicadores_delivery(date, date) from public, anon;
grant execute on function public.registrar_posiciones(jsonb) to authenticated;
grant execute on function public.seguimiento_delivery(date) to authenticated;
grant execute on function public.incidencias_delivery(integer, boolean) to authenticated;
grant execute on function public.reprogramar_incidencia(uuid, date, text) to authenticated;
grant execute on function public.reasignar_incidencia(uuid, uuid, date) to authenticated;
grant execute on function public.resolver_incidencia(uuid, text) to authenticated;
grant execute on function public.confirmar_devolucion_entrega(uuid, jsonb, text) to authenticated;
grant execute on function public.indicadores_delivery(date, date) to authenticated;

-- Purga diaria de posiciones (03:30 de Caracas)
select cron.schedule('purgar-posiciones-repartidor', '30 7 * * *', $$select public.purgar_posiciones_repartidor()$$);

notify pgrst, 'reload schema';

commit;
