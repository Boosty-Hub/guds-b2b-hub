-- ════════════════════════════════════════════════════════════════════════
-- Fase 19w · Editar teléfonos y direcciones de un cliente desde GUDS → Odoo (decisión del dueño, 28-sep:
--   "en cliente se puede editar direcciones y teléfono y se actualiza en Odoo").
--   · actualizar_contacto_cliente: teléfono, celular y dirección (calle, complemento, ciudad, estado) del cliente.
--   · guardar_direccion_cliente: edita una dirección de entrega existente o crea una nueva (dirección hija en Odoo).
--   · reintentar_escritura_cliente: vuelve a disparar una escritura que terminó con error.
--   · historial_escrituras_cliente: últimos cambios del cliente enviados a Odoo (quién, cuándo, qué, estado).
--   Solo el personal de administración con permiso para gestionar el cliente. Validan y encolan en odoo_escrituras (19u);
--   la función edge sync-odoo escribe en Odoo (escribir-cliente.js) y, si Odoo acepta, actualiza la ficha de GUDS.
--   Modo en configuracion.odoo_escritura_clientes: 'simular' (arma el plan sin escribir) o 'activo'.
-- ════════════════════════════════════════════════════════════════════════
begin;

-- ── Validaciones (internas) ────────────────────────────────────────────
-- Un teléfono venezolano por campo (0414-1234567, 0212 555 1234, +58 414 1234567), con extensión opcional ("ext 12").
-- Devuelve el valor recortado tal como se escribió, o null si viene vacío (borrar el dato).
create or replace function public.validar_telefono_ve(p_valor text, p_campo text, p_solo_movil boolean default false)
returns text language plpgsql immutable set search_path = public as $$
declare v text := nullif(btrim(coalesce(p_valor, '')), ''); v_num text; v_dig text;
begin
  if v is null then return null; end if;
  if length(v) > 40 then raise exception 'El % es demasiado largo.', p_campo using errcode = '22023'; end if;
  v_num := regexp_replace(v, '\s*(ext\.?|extensi[oó]n|x)\s*[0-9]{1,6}\s*$', '', 'i');
  v_dig := regexp_replace(v_num, '[^0-9]', '', 'g');
  if v_num !~ '^[0-9 +().-]+$' or v_dig !~ '^(580?|0)?[24][0-9]{9}$' then
    raise exception 'El % "%" no es un número venezolano válido: escribe un solo número, p. ej. 0414-1234567 o 0212-5551234.', p_campo, v
      using errcode = '22023';
  end if;
  if p_solo_movil and regexp_replace(v_dig, '^(580?|0)', '') !~ '^4(12|14|16|22|24|26)' then
    raise exception 'El % debe ser un móvil venezolano (0412, 0414, 0416, 0422, 0424 o 0426).', p_campo using errcode = '22023';
  end if;
  return v;
end $$;

-- Estado de Venezuela (los de res.country.state en Odoo). Acepta "Bolívar", "Bolivar." o "Bolivar. (VE)"; devuelve el nombre
-- con acentos o null si no es un estado de Venezuela.
create or replace function public.estado_ve(p_valor text)
returns text language sql immutable set search_path = public as $$
  select e from unnest(array['Amazonas', 'Anzoátegui', 'Apure', 'Aragua', 'Barinas', 'Bolívar', 'Carabobo', 'Cojedes',
    'Delta Amacuro', 'Dependencias Federales', 'Distrito Capital', 'Falcón', 'Guárico', 'La Guaira', 'Lara', 'Mérida', 'Miranda',
    'Monagas', 'Nueva Esparta', 'Portuguesa', 'Sucre', 'Táchira', 'Trujillo', 'Yaracuy', 'Zulia']) e
  where translate(lower(e), 'áéíóú', 'aeiou') = btrim(regexp_replace(regexp_replace(translate(lower(coalesce(p_valor, '')), 'áéíóúü', 'aeiouu'),
    '\([^)]*\)|\.', '', 'g'), '\s+', ' ', 'g'))
$$;

-- Dirección de Odoo (street, street2, city, state_id): si viene cualquiera de sus campos, calle, ciudad y estado son
-- obligatorios (en Odoo también). Devuelve {calle, complemento, ciudad, estado} validado o '{}' si no viene dirección.
create or replace function public.validar_direccion_odoo(p_datos jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare v_calle text; v_comp text; v_ciudad text; v_estado text;
begin
  if not (p_datos ?| array['calle', 'complemento', 'ciudad', 'estado']) then return '{}'::jsonb; end if;
  v_calle := nullif(btrim(regexp_replace(coalesce(p_datos ->> 'calle', ''), '\s+', ' ', 'g')), '');
  v_comp := nullif(btrim(regexp_replace(coalesce(p_datos ->> 'complemento', ''), '\s+', ' ', 'g')), '');
  v_ciudad := nullif(btrim(regexp_replace(coalesce(p_datos ->> 'ciudad', ''), '\s+', ' ', 'g')), '');
  if v_calle is null or length(v_calle) < 4 then raise exception 'La calle es obligatoria (mínimo 4 caracteres).' using errcode = '22023'; end if;
  if length(v_calle) > 200 then raise exception 'La calle es demasiado larga (máximo 200 caracteres).' using errcode = '22023'; end if;
  if length(coalesce(v_comp, '')) > 200 then raise exception 'El complemento es demasiado largo (máximo 200 caracteres).' using errcode = '22023'; end if;
  if v_ciudad is null or length(v_ciudad) < 2 then raise exception 'La ciudad es obligatoria.' using errcode = '22023'; end if;
  if length(v_ciudad) > 100 then raise exception 'La ciudad es demasiado larga (máximo 100 caracteres).' using errcode = '22023'; end if;
  v_estado := public.estado_ve(p_datos ->> 'estado');
  if v_estado is null then
    raise exception 'Elige un estado de Venezuela válido%.', coalesce(' (se recibió "' || nullif(p_datos ->> 'estado', '') || '")', '') using errcode = '22023';
  end if;
  return jsonb_build_object('calle', v_calle, 'complemento', v_comp, 'ciudad', v_ciudad, 'estado', v_estado);
end $$;

-- Quién puede editar en Odoo los datos de un cliente: personal de administración con permiso sobre ese cliente
create or replace function public.puede_editar_cliente_odoo(p_cliente_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and public.es_personal_admin() and public.puede_gestionar_cliente(p_cliente_id)
$$;

revoke execute on function public.validar_telefono_ve(text, text, boolean) from public, anon, authenticated;
revoke execute on function public.estado_ve(text) from public, anon, authenticated;
revoke execute on function public.validar_direccion_odoo(jsonb) from public, anon, authenticated;
revoke execute on function public.puede_editar_cliente_odoo(uuid) from public, anon;
grant execute on function public.puede_editar_cliente_odoo(uuid) to authenticated;

-- ── Teléfonos y dirección del cliente ──────────────────────────────────
-- p_datos: cualquiera de telefono, celular, calle, complemento, ciudad, estado (la dirección va completa).
create or replace function public.actualizar_contacto_cliente(p_cliente_id uuid, p_datos jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_cli record; v_campos jsonb := '{}'::jsonb; v_ajenas text; v_tel text; v_cel text;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión.' using errcode = '42501'; end if;
  if not public.puede_editar_cliente_odoo(p_cliente_id) then
    raise exception 'No tienes permiso para editar los datos de este cliente en Odoo.' using errcode = '42501';
  end if;
  select id, odoo_id, empresa_id, nombre_negocio, telefono, celular, direccion, ciudad, estado into v_cli
  from clientes where id = p_cliente_id;
  if not found then raise exception 'Cliente no encontrado.' using errcode = 'P0002'; end if;
  if v_cli.odoo_id is null then raise exception 'Este cliente no está vinculado a Odoo.' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_datos) is distinct from 'object' or p_datos = '{}'::jsonb then
    raise exception 'No hay datos para guardar.' using errcode = '22023';
  end if;
  select string_agg(k, ', ') into v_ajenas from jsonb_object_keys(p_datos) k
  where k not in ('telefono', 'celular', 'calle', 'complemento', 'ciudad', 'estado');
  if v_ajenas is not null then raise exception 'Campos no permitidos: %.', v_ajenas using errcode = '22023'; end if;

  if p_datos ? 'telefono' then
    v_tel := public.validar_telefono_ve(p_datos ->> 'telefono', 'teléfono');
    v_campos := v_campos || jsonb_build_object('telefono', v_tel);
  end if;
  if p_datos ? 'celular' then
    v_cel := public.validar_telefono_ve(p_datos ->> 'celular', 'celular', true);
    v_campos := v_campos || jsonb_build_object('celular', v_cel);
  end if;
  -- Si se tocan los teléfonos, debe quedar al menos uno (un cliente sin teléfonos puede editar solo su dirección)
  if (p_datos ?| array['telefono', 'celular'])
     and (case when p_datos ? 'telefono' then v_tel else v_cli.telefono end) is null
     and (case when p_datos ? 'celular' then v_cel else v_cli.celular end) is null then
    raise exception 'El cliente debe quedar con al menos un teléfono.' using errcode = '22023';
  end if;
  v_campos := v_campos || public.validar_direccion_odoo(p_datos);

  if exists (select 1 from odoo_escrituras where tipo = 'cliente_contacto' and referencia_id = p_cliente_id
             and estado in ('pendiente', 'procesando') and created_at > now() - interval '15 minutes') then
    raise exception 'Ya hay un cambio de este cliente enviándose a Odoo. Espera su resultado.' using errcode = 'P0001';
  end if;

  return public.encolar_escritura_odoo('cliente_contacto', p_cliente_id, jsonb_build_object(
    'cliente_id', p_cliente_id, 'campos', v_campos,
    'antes', jsonb_build_object('telefono', v_cli.telefono, 'celular', v_cli.celular, 'direccion', v_cli.direccion,
      'ciudad', v_cli.ciudad, 'estado', v_cli.estado)), v_cli.empresa_id);
end $$;

-- ── Direcciones de entrega ─────────────────────────────────────────────
-- p_direccion_id null → dirección nueva (nombre, calle, complemento, ciudad, estado y teléfono opcional).
-- Con p_direccion_id → edita calle/complemento/ciudad/estado y/o teléfono (el nombre de una existente se cambia en Odoo).
create or replace function public.guardar_direccion_cliente(p_cliente_id uuid, p_direccion_id uuid, p_datos jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_cli record; v_dir record; v_campos jsonb := '{}'::jsonb; v_ajenas text; v_nombre text; v_dirs jsonb;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión.' using errcode = '42501'; end if;
  if not public.puede_editar_cliente_odoo(p_cliente_id) then
    raise exception 'No tienes permiso para editar los datos de este cliente en Odoo.' using errcode = '42501';
  end if;
  select id, odoo_id, empresa_id into v_cli from clientes where id = p_cliente_id;
  if not found then raise exception 'Cliente no encontrado.' using errcode = 'P0002'; end if;
  if v_cli.odoo_id is null then raise exception 'Este cliente no está vinculado a Odoo.' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_datos) is distinct from 'object' or p_datos = '{}'::jsonb then
    raise exception 'No hay datos para guardar.' using errcode = '22023';
  end if;
  select string_agg(k, ', ') into v_ajenas from jsonb_object_keys(p_datos) k
  where k not in ('nombre', 'calle', 'complemento', 'ciudad', 'estado', 'telefono');
  if v_ajenas is not null then raise exception 'Campos no permitidos: %.', v_ajenas using errcode = '22023'; end if;

  if p_datos ? 'telefono' then
    v_campos := jsonb_build_object('telefono', public.validar_telefono_ve(p_datos ->> 'telefono', 'teléfono'));
  end if;

  if p_direccion_id is null then
    v_nombre := nullif(btrim(regexp_replace(coalesce(p_datos ->> 'nombre', ''), '\s+', ' ', 'g')), '');
    if v_nombre is null or length(v_nombre) < 2 then raise exception 'La dirección nueva necesita un nombre (p. ej. "Sucursal Centro").' using errcode = '22023'; end if;
    if length(v_nombre) > 100 then raise exception 'El nombre es demasiado largo (máximo 100 caracteres).' using errcode = '22023'; end if;
    if not (p_datos ? 'calle') then raise exception 'La calle es obligatoria.' using errcode = '22023'; end if;
    if exists (select 1 from cliente_direcciones where cliente_id = p_cliente_id and lower(btrim(nombre)) = lower(v_nombre)) then
      raise exception 'El cliente ya tiene una dirección llamada "%".', v_nombre using errcode = '23505';
    end if;
    if exists (select 1 from odoo_escrituras where tipo = 'cliente_direccion' and referencia_id = p_cliente_id
               and estado in ('pendiente', 'procesando') and created_at > now() - interval '15 minutes'
               and lower(datos -> 'campos' ->> 'nombre') = lower(v_nombre)) then
      raise exception 'Esa dirección ya se está creando en Odoo. Espera su resultado.' using errcode = 'P0001';
    end if;
    v_campos := v_campos || jsonb_build_object('nombre', v_nombre) || public.validar_direccion_odoo(p_datos);
    return public.encolar_escritura_odoo('cliente_direccion', p_cliente_id,
      jsonb_build_object('cliente_id', p_cliente_id, 'accion', 'crear', 'campos', v_campos), v_cli.empresa_id);
  end if;

  select id, odoo_id, nombre, direccion, ciudad, estado, telefono into v_dir
  from cliente_direcciones where id = p_direccion_id and cliente_id = p_cliente_id;
  if not found then raise exception 'La dirección no pertenece a este cliente.' using errcode = 'P0002'; end if;
  if v_dir.odoo_id is null then raise exception 'Esta dirección no está vinculada a Odoo.' using errcode = 'P0001'; end if;
  if p_datos ? 'nombre' then
    raise exception 'El nombre de una dirección existente se cambia en Odoo.' using errcode = '22023';
  end if;
  v_campos := v_campos || public.validar_direccion_odoo(p_datos);
  if exists (select 1 from odoo_escrituras where tipo = 'cliente_direccion' and referencia_id = p_direccion_id
             and estado in ('pendiente', 'procesando') and created_at > now() - interval '15 minutes') then
    raise exception 'Ya hay un cambio de esta dirección enviándose a Odoo. Espera su resultado.' using errcode = 'P0001';
  end if;
  return public.encolar_escritura_odoo('cliente_direccion', p_direccion_id, jsonb_build_object(
    'cliente_id', p_cliente_id, 'accion', 'editar', 'direccion_id', p_direccion_id, 'nombre', v_dir.nombre, 'campos', v_campos,
    'antes', jsonb_build_object('direccion', v_dir.direccion, 'ciudad', v_dir.ciudad, 'estado', v_dir.estado, 'telefono', v_dir.telefono)),
    v_cli.empresa_id);
end $$;

-- ── Reintentar una escritura con error ─────────────────────────────────
create or replace function public.reintentar_escritura_cliente(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_e record;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión.' using errcode = '42501'; end if;
  select id, tipo, estado, datos ->> 'cliente_id' cliente_id into v_e from odoo_escrituras where id = p_id;
  if not found or v_e.tipo not in ('cliente_contacto', 'cliente_direccion') then
    raise exception 'Escritura no encontrada.' using errcode = 'P0002';
  end if;
  if not public.puede_editar_cliente_odoo(v_e.cliente_id::uuid) then
    raise exception 'No tienes permiso para editar los datos de este cliente en Odoo.' using errcode = '42501';
  end if;
  if v_e.estado <> 'error' then raise exception 'Solo se reintentan los envíos que terminaron con error.' using errcode = 'P0001'; end if;
  perform public.disparar_escritura_odoo(p_id);
  return p_id;
end $$;

-- ── Historial del cliente ──────────────────────────────────────────────
create or replace function public.historial_escrituras_cliente(p_cliente_id uuid, p_limite integer default 20)
returns table (id uuid, tipo text, accion text, direccion text, estado text, campos jsonb, antes jsonb, resultado jsonb, error text,
  intentos integer, solicitado_por text, created_at timestamptz, procesado_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not (public.es_personal_admin() and public.puede('clientes', 'ver')) then
    raise exception 'No tienes permiso para ver el historial de este cliente.' using errcode = '42501';
  end if;
  if not exists (select 1 from clientes c where c.id = p_cliente_id
                 and (c.empresa_id is null or c.empresa_id = any (public.empresas_visibles()))) then
    raise exception 'Cliente no encontrado.' using errcode = 'P0002';
  end if;
  return query
    select e.id, e.tipo, coalesce(e.datos ->> 'accion', 'editar'),
           case when e.tipo = 'cliente_direccion' then coalesce(e.datos ->> 'nombre', e.datos -> 'campos' ->> 'nombre', d.nombre) end,
           e.estado, e.datos -> 'campos', e.datos -> 'antes', e.resultado, e.error, e.intentos,
           nullif(btrim(concat_ws(' ', u.nombre, u.apellido)), ''), e.created_at, e.procesado_at
    from odoo_escrituras e
    left join usuarios u on u.id = e.solicitado_por
    left join cliente_direcciones d on e.tipo = 'cliente_direccion' and d.id = e.referencia_id
    where e.tipo in ('cliente_contacto', 'cliente_direccion') and e.datos ->> 'cliente_id' = p_cliente_id::text
    order by e.created_at desc
    limit least(greatest(coalesce(p_limite, 20), 1), 100);
end $$;

create index if not exists odoo_escrituras_cliente on public.odoo_escrituras ((datos ->> 'cliente_id'), created_at desc)
  where tipo in ('cliente_contacto', 'cliente_direccion');

revoke execute on function public.actualizar_contacto_cliente(uuid, jsonb) from public, anon;
revoke execute on function public.guardar_direccion_cliente(uuid, uuid, jsonb) from public, anon;
revoke execute on function public.reintentar_escritura_cliente(uuid) from public, anon;
revoke execute on function public.historial_escrituras_cliente(uuid, integer) from public, anon;
grant execute on function public.actualizar_contacto_cliente(uuid, jsonb) to authenticated;
grant execute on function public.guardar_direccion_cliente(uuid, uuid, jsonb) to authenticated;
grant execute on function public.reintentar_escritura_cliente(uuid) to authenticated;
grant execute on function public.historial_escrituras_cliente(uuid, integer) to authenticated;

notify pgrst, 'reload schema';

commit;
