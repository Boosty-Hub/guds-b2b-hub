begin;

-- Fase 14b: RPCs de carga + matching determinístico + revisión de conciliación bancaria.

create or replace function public.crear_extracto_bancario(
  p_banco_id uuid,
  p_nombre_archivo text,
  p_moneda text,
  p_lineas jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_admin uuid;
  v_extracto_id uuid;
  v_min date; v_max date; v_n int;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede cargar extractos bancarios';
  end if;
  select id into v_admin from public.usuarios where auth_id = auth.uid();

  if not exists (select 1 from public.bancos where id = p_banco_id) then
    raise exception 'Banco % no existe', p_banco_id;
  end if;
  if p_lineas is null or jsonb_array_length(p_lineas) = 0 then
    raise exception 'El extracto no tiene líneas para cargar';
  end if;

  select min((x->>'fecha')::date), max((x->>'fecha')::date), count(*)
    into v_min, v_max, v_n
  from jsonb_array_elements(p_lineas) x;

  insert into public.extractos_bancarios (banco_id, nombre_archivo, moneda, fecha_desde, fecha_hasta, total_lineas, cargado_por)
  values (p_banco_id, p_nombre_archivo, coalesce(p_moneda, 'USD'), v_min, v_max, v_n, v_admin)
  returning id into v_extracto_id;

  insert into public.extracto_lineas (extracto_id, fecha, monto, referencia, descripcion)
  select v_extracto_id, (x->>'fecha')::date, (x->>'monto')::numeric, x->>'referencia', x->>'descripcion'
  from jsonb_array_elements(p_lineas) x;

  return v_extracto_id;
end;
$$;

grant execute on function public.crear_extracto_bancario(uuid, text, text, jsonb) to authenticated;

create or replace function public.conciliar_extracto_automatico(p_extracto_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_banco_id uuid;
  v_conciliadas int := 0;
  v_pendientes int := 0;
  r record;
  v_candidatos uuid[];
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede conciliar';
  end if;

  select banco_id into v_banco_id from public.extractos_bancarios where id = p_extracto_id;
  if v_banco_id is null then
    raise exception 'Extracto % no existe', p_extracto_id;
  end if;

  for r in
    select id, fecha, monto from public.extracto_lineas
    where extracto_id = p_extracto_id and estado = 'pendiente'
  loop
    select array_agg(m.id) into v_candidatos
    from public.movimientos_bancarios m
    where m.banco_id = v_banco_id
      and m.tipo = (case when r.monto >= 0 then 'entrada' else 'salida' end)
      and abs(abs(m.monto) - abs(r.monto)) <= 0.01
      and abs(m.fecha::date - r.fecha) <= 3
      and not exists (select 1 from public.extracto_lineas el2 where el2.movimiento_bancario_id = m.id);

    if v_candidatos is not null and array_length(v_candidatos, 1) = 1 then
      update public.extracto_lineas
      set estado = 'conciliado', movimiento_bancario_id = v_candidatos[1],
          metodo_match = 'automatico', confianza = 100, revisado_en = now()
      where id = r.id;
      v_conciliadas := v_conciliadas + 1;
    else
      v_pendientes := v_pendientes + 1;
    end if;
  end loop;

  return jsonb_build_object('conciliadas', v_conciliadas, 'pendientes', v_pendientes);
end;
$$;

grant execute on function public.conciliar_extracto_automatico(uuid) to authenticated;

create or replace function public.confirmar_match_extracto(p_linea_id uuid, p_movimiento_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_admin uuid;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede conciliar';
  end if;
  select id into v_admin from public.usuarios where auth_id = auth.uid();

  if not exists (select 1 from public.movimientos_bancarios where id = p_movimiento_id) then
    raise exception 'Movimiento % no existe', p_movimiento_id;
  end if;
  if exists (select 1 from public.extracto_lineas where movimiento_bancario_id = p_movimiento_id) then
    raise exception 'Ese movimiento ya está conciliado con otra línea';
  end if;

  update public.extracto_lineas
  set estado = 'conciliado', movimiento_bancario_id = p_movimiento_id,
      metodo_match = 'manual', revisado_por = v_admin, revisado_en = now()
  where id = p_linea_id and estado = 'pendiente';

  if not found then
    raise exception 'La línea no existe o ya fue procesada';
  end if;
end;
$$;

grant execute on function public.confirmar_match_extracto(uuid, uuid) to authenticated;

create or replace function public.aplicar_sugerencia_ia(p_linea_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_admin uuid;
  v_movimiento_id uuid;
  v_confianza numeric;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede conciliar';
  end if;
  select id into v_admin from public.usuarios where auth_id = auth.uid();

  select (sugerencia_ia->>'movimiento_bancario_id')::uuid, (sugerencia_ia->>'confianza')::numeric
    into v_movimiento_id, v_confianza
  from public.extracto_lineas where id = p_linea_id and estado = 'pendiente';

  if v_movimiento_id is null then
    raise exception 'Esta línea no tiene una sugerencia de IA aplicable';
  end if;
  if exists (select 1 from public.extracto_lineas where movimiento_bancario_id = v_movimiento_id) then
    raise exception 'Ese movimiento ya está conciliado con otra línea';
  end if;

  update public.extracto_lineas
  set estado = 'conciliado', movimiento_bancario_id = v_movimiento_id,
      metodo_match = 'ia', confianza = v_confianza, revisado_por = v_admin, revisado_en = now()
  where id = p_linea_id;
end;
$$;

grant execute on function public.aplicar_sugerencia_ia(uuid) to authenticated;

create or replace function public.descartar_linea_extracto(p_linea_id uuid, p_notas text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_admin uuid;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede conciliar';
  end if;
  select id into v_admin from public.usuarios where auth_id = auth.uid();

  update public.extracto_lineas
  set estado = 'descartado', revisado_por = v_admin, revisado_en = now(),
      descripcion = case when p_notas is not null then coalesce(descripcion,'') || ' | ' || p_notas else descripcion end
  where id = p_linea_id and estado = 'pendiente';

  if not found then
    raise exception 'La línea no existe o ya fue procesada';
  end if;
end;
$$;

grant execute on function public.descartar_linea_extracto(uuid, text) to authenticated;

commit;
