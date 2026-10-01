-- ════════════════════════════════════════════════════════════════════════
-- Fase 21b · Clientes sin correo y envío masivo del estado de cuenta (plan de revisión 30-sep, puntos 2.6 y 2.7)
--   · [escribe en Odoo] El correo del cliente (res.partner.email) se edita desde GUDS por la misma cola que la dirección y
--     los teléfonos (decisión del 30-sep): actualizar_contacto_cliente acepta 'email' (formato validado, en minúsculas;
--     vacío = quitarlo). La cola lo manda a Odoo con escribir-cliente.js y, si Odoo acepta, GUDS guarda lo que quedó en Odoo.
--     Mismo modo que dirección y teléfonos (configuracion.odoo_escritura_clientes).
--   · Crear un contacto con correo desde el diálogo de envío usa la tabla cliente_contactos (20v): su propio trigger lo
--     encola hacia Odoo como persona de contacto.
--   · Envío masivo: estado_cuenta_lotes (uno por envío masivo) y estado_cuenta_envios.lote_id. registrar_envio_estado_cuenta
--     gana p_lote_id: dentro de un lote el límite por usuario es 40 por minuto (fuera de un lote sigue en 5 por minuto); el
--     de 20 por hora por cliente no cambia. Un lote admite hasta 200 clientes.
--   · Entrega y rebotes: estado_cuenta_envios.entrega ('entregado', 'rebotado', 'queja', 'retrasado') que escribe la función
--     edge al recibir el webhook de Resend (firmado; registrar_entrega_envio_estado_cuenta, solo la llave de servicio).
--   · Registro: envios_estado_cuenta_recientes (todos los clientes, con lote y entrega) y lote_estado_cuenta (progreso).
-- ════════════════════════════════════════════════════════════════════════
begin;

-- ── Correo del cliente hacia Odoo ──
create or replace function public.actualizar_contacto_cliente(p_cliente_id uuid, p_datos jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_cli record; v_campos jsonb := '{}'::jsonb; v_ajenas text; v_tel text; v_cel text; v_email text;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión.' using errcode = '42501'; end if;
  if not public.puede_editar_cliente_odoo(p_cliente_id) then
    raise exception 'No tienes permiso para editar los datos de este cliente en Odoo.' using errcode = '42501';
  end if;
  select id, odoo_id, empresa_id, nombre_negocio, telefono, celular, direccion, ciudad, estado, email into v_cli
  from clientes where id = p_cliente_id;
  if not found then raise exception 'Cliente no encontrado.' using errcode = 'P0002'; end if;
  if v_cli.odoo_id is null then raise exception 'Este cliente no está vinculado a Odoo.' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_datos) is distinct from 'object' or p_datos = '{}'::jsonb then
    raise exception 'No hay datos para guardar.' using errcode = '22023';
  end if;
  select string_agg(k, ', ') into v_ajenas from jsonb_object_keys(p_datos) k
  where k not in ('telefono', 'celular', 'calle', 'complemento', 'ciudad', 'estado', 'email');
  if v_ajenas is not null then raise exception 'Campos no permitidos: %.', v_ajenas using errcode = '22023'; end if;

  if p_datos ? 'telefono' then
    v_tel := public.validar_telefono_ve(p_datos ->> 'telefono', 'teléfono');
    v_campos := v_campos || jsonb_build_object('telefono', v_tel);
  end if;
  if p_datos ? 'celular' then
    v_cel := public.validar_telefono_ve(p_datos ->> 'celular', 'celular', true);
    v_campos := v_campos || jsonb_build_object('celular', v_cel);
  end if;
  if (p_datos ?| array['telefono', 'celular'])
     and (case when p_datos ? 'telefono' then v_tel else v_cli.telefono end) is null
     and (case when p_datos ? 'celular' then v_cel else v_cli.celular end) is null then
    raise exception 'El cliente debe quedar con al menos un teléfono.' using errcode = '22023';
  end if;
  -- Correo (21b): uno solo, en minúsculas; vacío lo quita en Odoo
  if p_datos ? 'email' then
    v_email := nullif(lower(btrim(coalesce(p_datos ->> 'email', ''))), '');
    if v_email is not null and (length(v_email) > 254 or v_email !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$') then
      raise exception 'El correo no tiene un formato válido.' using errcode = '22023';
    end if;
    v_campos := v_campos || jsonb_build_object('email', v_email);
  end if;
  v_campos := v_campos || public.validar_direccion_odoo(p_datos);

  if exists (select 1 from odoo_escrituras where tipo = 'cliente_contacto' and referencia_id = p_cliente_id
             and estado in ('pendiente', 'procesando') and created_at > now() - interval '15 minutes') then
    raise exception 'Ya hay un cambio de este cliente enviándose a Odoo. Espera su resultado.' using errcode = 'P0001';
  end if;

  return public.encolar_escritura_odoo('cliente_contacto', p_cliente_id, jsonb_build_object(
    'cliente_id', p_cliente_id, 'campos', v_campos,
    'antes', jsonb_build_object('telefono', v_cli.telefono, 'celular', v_cli.celular, 'direccion', v_cli.direccion,
      'ciudad', v_cli.ciudad, 'estado', v_cli.estado, 'email', v_cli.email)), v_cli.empresa_id);
end $function$;

-- ── Lotes de envío masivo ──
create table if not exists public.estado_cuenta_lotes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  creado_por uuid references public.usuarios(id) on delete set null,
  creado_at timestamptz not null default now(),
  clientes uuid[] not null check (cardinality(clientes) between 1 and 200),
  descripcion text check (length(descripcion) <= 200)
);
comment on table public.estado_cuenta_lotes is 'Envíos masivos del estado de cuenta (fase 21b). Solo por RPC.';
alter table public.estado_cuenta_lotes enable row level security;
revoke all on table public.estado_cuenta_lotes from public, anon, authenticated;

alter table public.estado_cuenta_envios add column if not exists lote_id uuid references public.estado_cuenta_lotes(id) on delete set null;
alter table public.estado_cuenta_envios add column if not exists entrega text check (entrega in ('entregado', 'rebotado', 'queja', 'retrasado'));
alter table public.estado_cuenta_envios add column if not exists entrega_at timestamptz;
alter table public.estado_cuenta_envios add column if not exists entrega_detalle text;
create index if not exists estado_cuenta_envios_lote on public.estado_cuenta_envios (lote_id) where lote_id is not null;
create index if not exists estado_cuenta_envios_resend on public.estado_cuenta_envios (resend_id) where resend_id is not null;

create or replace function public.crear_lote_estado_cuenta(p_clientes uuid[], p_descripcion text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_lista uuid[];
  v_emp uuid := public.empresa_activa();
  v_id uuid;
  c uuid;
begin
  if auth.uid() is null then raise exception 'No autenticado' using errcode = '42501'; end if;
  if not (public.es_personal_admin() and public.puede('cuentas', 'editar')) then
    raise exception 'No tienes permiso para enviar estados de cuenta' using errcode = '42501';
  end if;
  if v_emp is null then
    raise exception 'Modo consulta ("Ambas empresas"): selecciona GUDS o Quirutec en el menú superior para enviar.' using errcode = 'P0001';
  end if;
  select array_agg(distinct x) into v_lista from unnest(coalesce(p_clientes, '{}')) x where x is not null;
  if v_lista is null or cardinality(v_lista) = 0 then raise exception 'Elige al menos un cliente' using errcode = '22023'; end if;
  if cardinality(v_lista) > 200 then raise exception 'Máximo 200 clientes por envío masivo' using errcode = '22023'; end if;
  foreach c in array v_lista loop
    perform public.estado_cuenta_acceso(c, 'editar', false);   -- mismo permiso y empresa que el envío individual
  end loop;
  insert into estado_cuenta_lotes (empresa_id, creado_por, clientes, descripcion)
  values (v_emp, public.usuario_actual_id(), v_lista, nullif(btrim(coalesce(p_descripcion, '')), ''))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.crear_lote_estado_cuenta(uuid[], text) from public, anon;
grant execute on function public.crear_lote_estado_cuenta(uuid[], text) to authenticated;

-- Destinatarios sugeridos de varios clientes (correo del cliente y de sus contactos activos)
create or replace function public.destinatarios_estado_cuenta(p_clientes uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.es_personal_admin() and public.puede('cuentas', 'ver')) then
    raise exception 'No tienes permiso' using errcode = '42501';
  end if;
  if cardinality(coalesce(p_clientes, '{}')) > 200 then raise exception 'Máximo 200 clientes' using errcode = '22023'; end if;
  return coalesce((
    select jsonb_object_agg(c.id, coalesce((
             select jsonb_agg(distinct lower(btrim(e))) from (
               select c.email e union all
               select k.email from cliente_contactos k where k.cliente_id = c.id and coalesce(k.activo, true)) x
              where nullif(btrim(e), '') is not null), '[]'::jsonb))
      from clientes c
     where c.id = any (p_clientes)
       and (c.empresa_id is null or c.empresa_id = any (public.empresas_visibles()))), '{}'::jsonb);
end $$;
revoke all on function public.destinatarios_estado_cuenta(uuid[]) from public, anon;
grant execute on function public.destinatarios_estado_cuenta(uuid[]) to authenticated;

-- Registro del envío con lote (la función edge con la llave de servicio)
drop function if exists public.registrar_envio_estado_cuenta(uuid, uuid, uuid, uuid, text[], text, text, text, integer);
create or replace function public.registrar_envio_estado_cuenta(
  p_usuario_id uuid,
  p_cliente_id uuid,
  p_empresa_id uuid,
  p_enlace_id uuid,
  p_destinatarios text[],
  p_asunto text,
  p_mensaje text,
  p_adjunto_nombre text,
  p_adjunto_bytes integer,
  p_lote_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_dest text[];
  v_id uuid;
  l public.estado_cuenta_lotes;
begin
  select array_agg(distinct lower(btrim(d))) into v_dest
    from unnest(coalesce(p_destinatarios, '{}')) d where nullif(btrim(d), '') is not null;
  if v_dest is null or cardinality(v_dest) = 0 then
    raise exception 'Indica al menos un destinatario' using errcode = '22023';
  end if;
  if cardinality(v_dest) > 10 then
    raise exception 'Máximo 10 destinatarios por envío' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_dest) d where length(d) > 254 or d !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$') then
    raise exception 'Hay un correo con formato inválido' using errcode = '22023';
  end if;
  if nullif(btrim(p_asunto), '') is null or length(p_asunto) > 200 then
    raise exception 'El asunto es obligatorio (hasta 200 caracteres)' using errcode = '22023';
  end if;
  if length(coalesce(p_mensaje, '')) > 2000 then
    raise exception 'El mensaje admite hasta 2000 caracteres' using errcode = '22023';
  end if;
  if p_lote_id is not null then
    select * into l from estado_cuenta_lotes where id = p_lote_id;
    if not found or l.creado_por is distinct from p_usuario_id or not (p_cliente_id = any (l.clientes)) or l.empresa_id <> p_empresa_id then
      raise exception 'El envío no corresponde a ese envío masivo' using errcode = '22023';
    end if;
    if l.creado_at < now() - interval '1 day' then
      raise exception 'Ese envío masivo ya cerró; inicia uno nuevo' using errcode = 'P0001';
    end if;
    if exists (select 1 from estado_cuenta_envios where lote_id = p_lote_id and cliente_id = p_cliente_id and estado in ('enviando', 'enviado')) then
      raise exception 'Este cliente ya se envió en este envío masivo' using errcode = 'P0001';
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('estado_cuenta_envio|' || coalesce(p_usuario_id::text, ''), 0));
  if (select count(*) from estado_cuenta_envios where enviado_por = p_usuario_id and creado_at > now() - interval '1 minute')
     >= (case when p_lote_id is null then 5 else 40 end) then
    raise exception 'Demasiados envíos seguidos: espera un minuto e inténtalo de nuevo' using errcode = 'P0001';
  end if;
  if (select count(*) from estado_cuenta_envios where cliente_id = p_cliente_id and creado_at > now() - interval '1 hour') >= 20 then
    raise exception 'Este cliente ya recibió muchos envíos en la última hora' using errcode = 'P0001';
  end if;
  insert into estado_cuenta_envios (cliente_id, empresa_id, enlace_id, destinatarios, asunto, mensaje, adjunto_nombre, adjunto_bytes, enviado_por, lote_id)
  values (p_cliente_id, p_empresa_id, p_enlace_id, v_dest, btrim(p_asunto), nullif(btrim(coalesce(p_mensaje, '')), ''), p_adjunto_nombre, p_adjunto_bytes, p_usuario_id, p_lote_id)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.registrar_envio_estado_cuenta(uuid, uuid, uuid, uuid, text[], text, text, text, integer, uuid) from public, anon, authenticated;
grant execute on function public.registrar_envio_estado_cuenta(uuid, uuid, uuid, uuid, text[], text, text, text, integer, uuid) to service_role;

-- Entrega informada por el webhook de Resend (la función edge, con la firma verificada)
create or replace function public.registrar_entrega_envio_estado_cuenta(p_resend_id text, p_evento text, p_detalle text)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_entrega text := case p_evento when 'email.delivered' then 'entregado' when 'email.bounced' then 'rebotado'
                                  when 'email.complained' then 'queja' when 'email.delivery_delayed' then 'retrasado' end;
  n integer;
begin
  if v_entrega is null or nullif(btrim(p_resend_id), '') is null then return 0; end if;
  update estado_cuenta_envios
     set entrega = case when entrega in ('rebotado', 'queja') and v_entrega in ('entregado', 'retrasado') then entrega else v_entrega end,
         entrega_at = now(),
         entrega_detalle = left(coalesce(p_detalle, entrega_detalle), 300)
   where resend_id = p_resend_id;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.registrar_entrega_envio_estado_cuenta(text, text, text) from public, anon, authenticated;
grant execute on function public.registrar_entrega_envio_estado_cuenta(text, text, text) to service_role;

-- Historial de un cliente (CuentaDetalle): con lote y entrega
create or replace function public.envios_estado_cuenta(p_cliente_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_emp uuid;
begin
  v_emp := public.estado_cuenta_acceso(p_cliente_id, 'ver', false);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id, 'creado_at', s.creado_at, 'enviado_at', s.enviado_at, 'estado', s.estado,
             'destinatarios', to_jsonb(s.destinatarios), 'asunto', s.asunto, 'resend_id', s.resend_id, 'error', s.error,
             'adjunto_bytes', s.adjunto_bytes, 'lote_id', s.lote_id, 'entrega', s.entrega, 'entrega_at', s.entrega_at,
             'entrega_detalle', s.entrega_detalle,
             'enviado_por', (select nullif(btrim(concat_ws(' ', u.nombre, u.apellido)), '') from usuarios u where u.id = s.enviado_por))
           order by s.creado_at desc)
      from (select * from estado_cuenta_envios x
             where x.cliente_id = p_cliente_id and x.empresa_id = v_emp
             order by x.creado_at desc limit 50) s), '[]'::jsonb);
end $$;
revoke all on function public.envios_estado_cuenta(uuid) from public, anon;
grant execute on function public.envios_estado_cuenta(uuid) to authenticated;

-- Registro de envíos de todos los clientes (Cuentas → "Registro de envíos")
create or replace function public.envios_estado_cuenta_recientes(p_limite integer default 100, p_lote_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.es_personal_admin() and public.puede('cuentas', 'ver')) then
    raise exception 'No tienes permiso' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id, 'cliente_id', s.cliente_id, 'cliente', c.nombre_negocio, 'creado_at', s.creado_at, 'estado', s.estado,
             'destinatarios', to_jsonb(s.destinatarios), 'error', s.error, 'lote_id', s.lote_id, 'entrega', s.entrega,
             'entrega_detalle', s.entrega_detalle,
             'enviado_por', (select nullif(btrim(concat_ws(' ', u.nombre, u.apellido)), '') from usuarios u where u.id = s.enviado_por))
           order by s.creado_at desc)
      from (select * from estado_cuenta_envios x
             where x.empresa_id = any (public.empresas_visibles()) and (p_lote_id is null or x.lote_id = p_lote_id)
             order by x.creado_at desc limit least(greatest(coalesce(p_limite, 100), 1), 500)) s
      join clientes c on c.id = s.cliente_id), '[]'::jsonb);
end $$;
revoke all on function public.envios_estado_cuenta_recientes(integer, uuid) from public, anon;
grant execute on function public.envios_estado_cuenta_recientes(integer, uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
