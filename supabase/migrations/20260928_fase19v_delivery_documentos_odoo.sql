-- ════════════════════════════════════════════════════════════════════════
-- Fase 19v · Delivery sobre los documentos de entrega de Odoo (D1 + D4 + D7 de docs/PLAN-PORTALES-Y-FLUJOS.md §6)
--   Decisión del dueño (28-sep): los documentos de entrega (stock.picking de salida) y las reposiciones a consignación
--   (traslados internos de un almacén propio a uno de consignación; se entregan en el cliente ligado al almacén destino)
--   salen TAL CUAL en GUDS y se asignan a un repartidor; nada del documento se edita en GUDS y, si Odoo lo cambia, la
--   sincronización lo refleja. Los traslados entre almacenes propios no entran. Lo único que
--   GUDS escribe en Odoo es el ESTADO de los documentos con repartidor asignado (con la API key actual de Odoo):
--     · entregado completo / incompleto → se valida en Odoo con las cantidades entregadas (cola 19u, tipo entrega_estado).
--       Incompleto deja pendiente (backorder) si faltó en el camión; sin pendiente si el cliente no lo quiso, dañado, etc.
--     · rechazado y reprogramado → solo en GUDS (administración decide en Odoo; la reprogramada vuelve a la cola).
--   Si alguien valida o cancela el documento directo en Odoo, la sincronización cierra la entrega abierta en GUDS
--   (origen_cierre = 'odoo', insignia "Actualizado desde Odoo").
--   1. Estados nuevos de entrega y columnas nuevas en el espejo (dirección y teléfono de entrega del documento; unidad y
--      "preparado" por línea). El importador las llena leyendo más campos de Odoo (solo lectura).
--   2. entregas cuelga del documento (transferencia_id ON DELETE SET NULL + transferencia_odoo_id + copia de los datos);
--      las entregas viejas ligadas a órdenes siguen funcionando (orden_id deja de ser obligatorio).
--   3. Funciones: asignar_entrega_documento (admin: asignar / reasignar), anular_entrega (admin), iniciar_entrega y
--      cerrar_entrega (repartidor, con la evidencia de cada resultado; el repartidor cierra desde cualquier empresa a la
--      que tenga acceso), mis_entregas_reparto (lo que ve el repartidor, sin precios) y reintentar_escritura_entrega (admin).
-- ════════════════════════════════════════════════════════════════════════
begin;

-- ── 1. Estados y espejo ─────────────────────────────────────────────────
-- (los valores nuevos solo se usan dentro de funciones plpgsql, que se evalúan después del commit)
alter type public.entrega_estado add value if not exists 'incompleta';
alter type public.entrega_estado add value if not exists 'rechazada';
alter type public.entrega_estado add value if not exists 'reprogramada';
alter type public.entrega_estado add value if not exists 'cancelada';

alter table public.transferencias
  add column if not exists partner_odoo_id integer,
  add column if not exists direccion_entrega text,
  add column if not exists ciudad_entrega text,
  add column if not exists region_entrega text,
  add column if not exists telefono_entrega text;
comment on column public.transferencias.partner_odoo_id is 'Contacto del documento en Odoo (stock.picking.partner_id): la dirección de entrega (sucursal) o el cliente';
comment on column public.transferencias.direccion_entrega is 'Dirección del contacto del documento en Odoo (la de la sucursal si es una dirección de entrega)';
comment on column public.transferencias.telefono_entrega is 'Teléfono del contacto del documento en Odoo (o del cliente si el contacto no tiene)';

alter table public.transferencia_items
  add column if not exists unidad text,
  add column if not exists preparado boolean;
comment on column public.transferencia_items.cantidad_hecha is 'stock.move.quantity: reservada/preparada mientras el documento no está hecho (lo que lleva el camión); hecha al validarse';

-- ── 2. Entregas ligadas al documento de Odoo ────────────────────────────
alter table public.entregas alter column orden_id drop not null;
alter table public.entregas
  add column if not exists transferencia_id uuid references public.transferencias(id) on delete set null,
  add column if not exists transferencia_odoo_id integer,
  add column if not exists doc_numero text,
  add column if not exists cliente_id uuid references public.clientes(id) on delete set null,
  add column if not exists doc_direccion text,
  add column if not exists origen_cierre text,
  add column if not exists motivo_codigo text,
  add column if not exists motivo_detalle text,
  add column if not exists reprogramada_para date,
  add column if not exists deja_pendiente boolean,
  add column if not exists lineas jsonb,
  add column if not exists cerrada_por uuid references public.usuarios(id) on delete set null,
  add column if not exists fecha_cierre timestamptz;
alter table public.entregas drop constraint if exists entregas_origen_cierre_check;
alter table public.entregas add constraint entregas_origen_cierre_check check (origen_cierre in ('guds', 'odoo'));
alter table public.entregas drop constraint if exists entregas_documento_u_orden;
alter table public.entregas add constraint entregas_documento_u_orden check (transferencia_odoo_id is not null or orden_id is not null);
-- Un documento, una sola entrega abierta
create unique index if not exists entregas_documento_abierta on public.entregas (transferencia_odoo_id)
  where transferencia_odoo_id is not null and estado in ('asignada', 'en_camino');
create index if not exists entregas_transferencia on public.entregas (transferencia_id);
create index if not exists entregas_repartidor on public.entregas (repartidor_id, estado);
comment on column public.entregas.transferencia_odoo_id is 'Documento de entrega de Odoo (stock.picking): clave estable aunque el documento desaparezca del espejo';
comment on column public.entregas.origen_cierre is 'guds: la cerró el repartidor o administración en GUDS · odoo: la cerró la sincronización (validado o cancelado en Odoo)';
comment on column public.entregas.lineas is 'Cierre por línea: [{item_id, move_odoo_id, producto, demandada, esperada, entregada, motivo}]';
comment on column public.entregas.deja_pendiente is 'Al validar en Odoo se crea un pendiente (backorder) con lo no entregado';

-- Notificación de asignación: con el número del documento (las entregas nuevas no siempre tienen orden en GUDS)
create or replace function public.trg_entrega_asignada()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_num text;
begin
  if new.repartidor_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.repartidor_id is not distinct from old.repartidor_id then return new; end if;
  v_num := coalesce(new.doc_numero, (select numero from ordenes where id = new.orden_id), '');
  perform notif_crear(new.repartidor_id, 'Nueva entrega asignada', 'Tienes la entrega ' || v_num || ' para llevar.', 'orden', '/delivery/entregas');
  return new;
end $$;

-- ── 3a. Asignar / reasignar un documento de entrega (administración) ─────
create or replace function public.asignar_entrega_documento(p_transferencia_id uuid, p_repartidor_id uuid, p_prioridad text default 'normal')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_doc record; v_ent record; v_id uuid; v_cliente uuid;
begin
  if not ((select public.es_personal_admin()) and (select public.puede('delivery', 'editar'))) then
    raise exception 'Solo administración puede asignar entregas';
  end if;
  select * into v_doc from transferencias where id = p_transferencia_id;
  if not found then raise exception 'Documento de entrega no encontrado'; end if;
  if not (v_doc.empresa_id = any (public.empresas_permitidas())) then raise exception 'No tienes acceso a la empresa de este documento'; end if;
  -- Órdenes de entrega, o reposiciones: traslado interno hacia un almacén de consignación (se entrega en su cliente)
  if not (v_doc.tipo = 'entrega' or (v_doc.tipo = 'interna'
      and exists (select 1 from almacenes a where a.id = v_doc.almacen_destino_id and a.tipo = 'consignacion'))) then
    raise exception 'Solo se asignan órdenes de entrega de Odoo o reposiciones a un almacén de consignación';
  end if;
  v_cliente := case when v_doc.tipo = 'interna' then (select a.cliente_id from almacenes a where a.id = v_doc.almacen_destino_id) else v_doc.cliente_id end;
  if v_doc.estado <> 'lista' then
    raise exception 'El documento % no está listo en Odoo (estado: %): se asigna cuando Odoo lo tenga "Listo"', v_doc.numero,
      case v_doc.estado when 'en_espera' then 'en espera' when 'borrador' then 'borrador' when 'hecha' then 'hecho' when 'cancelada' then 'cancelado' else v_doc.estado end;
  end if;
  if not exists (select 1 from usuarios u where u.id = p_repartidor_id and u.role = 'delivery' and coalesce(u.activo, true)) then
    raise exception 'Elige un repartidor activo';
  end if;
  if not exists (select 1 from usuario_empresas ue where ue.usuario_id = p_repartidor_id and ue.empresa_id = v_doc.empresa_id) then
    raise exception 'El repartidor no tiene acceso a la empresa de este documento';
  end if;

  select * into v_ent from entregas where transferencia_odoo_id = v_doc.odoo_id and estado in ('asignada', 'en_camino') for update;
  if found then
    -- Reasignar (o cambiar la prioridad): si ya había salido, vuelve a "asignada" con el repartidor nuevo
    update entregas set repartidor_id = p_repartidor_id, prioridad = coalesce(p_prioridad, prioridad),
      estado = case when repartidor_id is distinct from p_repartidor_id then 'asignada'::entrega_estado else estado end,
      fecha_inicio_entrega = case when repartidor_id is distinct from p_repartidor_id then null else fecha_inicio_entrega end,
      fecha_asignacion = case when repartidor_id is distinct from p_repartidor_id then now() else fecha_asignacion end,
      transferencia_id = v_doc.id, updated_at = now()
    where id = v_ent.id;
    if v_ent.repartidor_id is distinct from p_repartidor_id then
      perform notif_crear(v_ent.repartidor_id, 'Entrega reasignada', 'La entrega ' || v_doc.numero || ' pasó a otro repartidor.', 'orden', '/delivery/entregas');
    end if;
    return v_ent.id;
  end if;

  insert into entregas (orden_id, transferencia_id, transferencia_odoo_id, doc_numero, cliente_id, doc_direccion, empresa_id,
    repartidor_id, estado, prioridad, fecha_asignacion)
  values (v_doc.orden_id, v_doc.id, v_doc.odoo_id, v_doc.numero, v_cliente,
    nullif(concat_ws(', ', v_doc.direccion_entrega, v_doc.ciudad_entrega), ''), v_doc.empresa_id,
    p_repartidor_id, 'asignada', coalesce(p_prioridad, 'normal'), now())
  returning id into v_id;
  return v_id;
end $$;

-- ── 3b. Anular una entrega abierta (administración): el documento vuelve a la cola ──
create or replace function public.anular_entrega(p_entrega_id uuid, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_ent record;
begin
  if not ((select public.es_personal_admin()) and (select public.puede('delivery', 'editar'))) then
    raise exception 'Solo administración puede quitar una asignación';
  end if;
  select * into v_ent from entregas where id = p_entrega_id for update;
  if not found then raise exception 'Entrega no encontrada'; end if;
  if v_ent.estado not in ('asignada', 'en_camino') then raise exception 'La entrega ya está cerrada'; end if;
  update entregas set estado = 'cancelada', origen_cierre = 'guds', motivo_detalle = coalesce(nullif(trim(p_motivo), ''), 'Asignación anulada por administración'),
    fecha_cierre = now(), cerrada_por = (select public.usuario_actual_id()), updated_at = now()
  where id = p_entrega_id;
  perform notif_crear(v_ent.repartidor_id, 'Entrega retirada', 'La entrega ' || coalesce(v_ent.doc_numero, '') || ' ya no está asignada a ti.', 'orden', '/delivery/entregas');
end $$;

-- Repartidor asignado de una entrega (valida sesión, asignación y empresa). Interna.
create or replace function public.entrega_del_repartidor(p_entrega_id uuid)
returns public.entregas language plpgsql security definer set search_path = public as $$
declare v_ent public.entregas;
begin
  select e.* into v_ent from entregas e where e.id = p_entrega_id for update;
  if not found then raise exception 'Entrega no encontrada'; end if;
  if not exists (select 1 from usuarios u where u.id = v_ent.repartidor_id and u.auth_id = auth.uid() and coalesce(u.activo, true)) then
    raise exception 'Esta entrega no está asignada a ti';
  end if;
  if not (v_ent.empresa_id = any (public.empresas_permitidas())) then raise exception 'No tienes acceso a la empresa de esta entrega'; end if;
  return v_ent;
end $$;

-- ── 3c. Salir a entregar (repartidor) ───────────────────────────────────
create or replace function public.iniciar_entrega(p_entrega_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_ent public.entregas;
begin
  v_ent := public.entrega_del_repartidor(p_entrega_id);
  if v_ent.estado <> 'asignada' then raise exception 'La entrega no está pendiente de salir (estado: %)', v_ent.estado; end if;
  -- Ya se validó que la entrega es suya y de una empresa a la que tiene acceso: se cierra desde cualquier empresa activa
  perform set_config('guds.bypass_guard', 'on', true);
  update entregas set estado = 'en_camino', fecha_inicio_entrega = now(), updated_at = now() where id = p_entrega_id;
  perform set_config('guds.bypass_guard', 'off', true);
end $$;

-- ── 3d. Cerrar la entrega con uno de los 4 resultados (repartidor) ──────
--   p_resultado: completa | incompleta | rechazada | reprogramada
--   p_datos: { receptor, firma, foto, notas, motivo, motivo_detalle, fecha, lineas: [{item_id, entregada, motivo}] }
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
  v_estado entrega_estado; v_esc uuid; v_yo uuid := (select public.usuario_actual_id());
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
  return jsonb_build_object('estado', v_estado, 'escritura_id', v_esc, 'deja_pendiente', v_pend);
end $$;

-- ── 3e. Lo que ve el repartidor: sus entregas con el documento, dirección, teléfono y líneas (sin precios) ──
create or replace function public.mis_entregas_reparto(p_dias integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_yo uuid := (select public.usuario_actual_id());
begin
  if v_yo is null then raise exception 'Inicia sesión'; end if;
  return coalesce((
    select jsonb_agg(x.fila order by x.abierta desc, x.prioridad desc, x.orden)
    from (
      -- Abiertas: primero las de prioridad alta y por fecha programada; cerradas: la más reciente primero
      select e.estado in ('asignada', 'en_camino') abierta, (e.prioridad = 'alta') prioridad,
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
      where e.repartidor_id = v_yo
        and (e.estado in ('asignada', 'en_camino') or coalesce(e.fecha_cierre, e.fecha_entrega, e.updated_at) > now() - make_interval(days => greatest(1, least(coalesce(p_dias, 30), 365))))
    ) x), '[]'::jsonb);
end $$;

-- ── 3f. Reintentar (o volver a procesar) la escritura en Odoo de una entrega (administración) ──
--   error → se reintenta; simulada → se vuelve a procesar con el modo vigente (así se hace el piloto al activar).
create or replace function public.reintentar_escritura_entrega(p_escritura_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_esc record;
begin
  if not ((select public.es_personal_admin()) and (select public.puede('delivery', 'editar'))) then
    raise exception 'Solo administración puede reintentar escrituras en Odoo';
  end if;
  select * into v_esc from odoo_escrituras where id = p_escritura_id for update;
  if not found or v_esc.tipo <> 'entrega_estado' then raise exception 'Escritura de entrega no encontrada'; end if;
  if v_esc.empresa_id is not null and not (v_esc.empresa_id = any (public.empresas_permitidas())) then raise exception 'No tienes acceso a la empresa de esta entrega'; end if;
  if v_esc.estado not in ('error', 'simulada') then raise exception 'La escritura está %: no se puede reintentar', v_esc.estado; end if;
  update odoo_escrituras set estado = 'pendiente', error = null where id = p_escritura_id;
  perform public.disparar_escritura_odoo(p_escritura_id);
end $$;

-- ── 3g. Sincronización: entregas abiertas cuyo documento se validó o canceló directo en Odoo (o dejó de existir) ──
--   Las llama el importador (inventario.js) después de escribir las transferencias de cada empresa. Se cierran con
--   origen "odoo" (insignia "Actualizado desde Odoo") y se avisa al repartidor. Idempotente: solo toca entregas abiertas;
--   las cerradas en GUDS no se modifican (su escritura en Odoo va por la cola odoo_escrituras). Interna.
create or replace function public.cerrar_entregas_desde_odoo(p_empresa uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  with doc as (
    select e.id, case when t.estado = 'hecha' then 'entregada' else 'cancelada' end nuevo, t.estado, t.fecha_realizada
    from entregas e left join transferencias t on t.id = e.transferencia_id
    where e.empresa_id = p_empresa and e.transferencia_odoo_id is not null and e.estado in ('asignada', 'en_camino')
      and (t.id is null or t.estado in ('hecha', 'cancelada'))),
  u as (
    update entregas e set estado = doc.nuevo::entrega_estado, origen_cierre = 'odoo', fecha_cierre = now(),
      fecha_entrega = case when doc.nuevo = 'entregada' then coalesce(doc.fecha_realizada, now()) else e.fecha_entrega end,
      motivo_detalle = case when doc.nuevo = 'cancelada' then case when doc.estado is null then 'El documento ya no existe en Odoo'
        else 'Documento cancelado en Odoo' end end,
      updated_at = now()
    from doc where doc.id = e.id
    returning e.id, e.repartidor_id, e.doc_numero, e.empresa_id, doc.nuevo),
  n as (
    insert into notificaciones (usuario_id, titulo, mensaje, tipo, link, leida, empresa_id)
    select u.repartidor_id, 'Entrega actualizada desde Odoo', 'La entrega ' || coalesce(u.doc_numero, '') ||
      case when u.nuevo = 'entregada' then ' ya se validó en Odoo: no hace falta llevarla.' else ' se canceló en Odoo.' end,
      'orden', '/delivery/entregas', false, u.empresa_id
    from u where u.repartidor_id is not null)
  select count(*)::int into v_n from u;
  return v_n;
end $$;

-- ── Permisos ────────────────────────────────────────────────────────────
revoke execute on function public.cerrar_entregas_desde_odoo(uuid) from public, anon, authenticated;
revoke execute on function public.entrega_del_repartidor(uuid) from public, anon, authenticated;
revoke execute on function public.asignar_entrega_documento(uuid, uuid, text) from public, anon;
revoke execute on function public.anular_entrega(uuid, text) from public, anon;
revoke execute on function public.iniciar_entrega(uuid) from public, anon;
revoke execute on function public.cerrar_entrega(uuid, text, jsonb) from public, anon;
revoke execute on function public.mis_entregas_reparto(integer) from public, anon;
revoke execute on function public.reintentar_escritura_entrega(uuid) from public, anon;
grant execute on function public.asignar_entrega_documento(uuid, uuid, text) to authenticated;
grant execute on function public.anular_entrega(uuid, text) to authenticated;
grant execute on function public.iniciar_entrega(uuid) to authenticated;
grant execute on function public.cerrar_entrega(uuid, text, jsonb) to authenticated;
grant execute on function public.mis_entregas_reparto(integer) to authenticated;
grant execute on function public.reintentar_escritura_entrega(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
