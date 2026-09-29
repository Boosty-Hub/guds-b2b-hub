-- ════════════════════════════════════════════════════════════════════════
-- Fase 20s · Clientes, contactos y límites de crédito creados en GUDS → Odoo (Fase 9b; flancos 28, 29 y 47)
--   Decisiones del dueño: 3 (27-sep) y B (29-sep) → los clientes nuevos de GUDS se crean en Odoo automáticamente al aprobar
--   el registro (o al darlos de alta en el admin), SIN DUPLICAR por RIF ni por nombre: si ya existe, se enlaza.
--   5 (27-sep) → la escritura usa la API key actual y lo que GUDS crea queda marcado "(GUDS)". D (29-sep) → notas "(GUDS)" en
--   el historial de Odoo (odoo.js → nota()).
--
--   1. Aprobación (aprobar_registro_cliente, misma firma y mismas validaciones de quien llama que 19q):
--      · si en la empresa (o entre los compartidos) ya hay un cliente con el mismo RIF (clave_rif: J-12345678-9 = J123456789
--        = J-12345678) o el mismo nombre normalizado, NO se crea otro: el acceso del solicitante queda ligado a ese cliente y
--        el registro lo anota (uso_cliente_existente, coincidencia).
--      · si no, se crea el cliente como antes (ahora con calle, estado de Venezuela y tipo de persona) y se ENCOLA su alta en
--        Odoo (odoo_escrituras tipo cliente_nuevo). El escritor (escribir-cliente-nuevo.js) busca en Odoo por RIF y nombre:
--        1 coincidencia → enlaza; varias → quedan para que administración elija (elegir_cliente_odoo); 0 → crea el res.partner.
--      · Tras crear o enlazar, aplicar_vinculo_cliente_odoo() pone clientes.odoo_id (la sincronización lo actualiza por
--        odoo_id: no duplica la fila), reenvía los pedidos aprobados que esperaban al cliente y encola sus contactos y su límite.
--   2. Contactos (flanco 29): cliente_contactos → contacto hijo en Odoo (tipo persona_contacto). Crear y editar nombre, cargo,
--      correo y teléfonos se envían; desactivar o borrar NO. Los de un cliente sin Odoo esperan a que el cliente quede ligado.
--   3. Límites (flanco 28): al editar el límite de un cliente de Odoo queda pendiente (18l) y se encola (tipo cliente_limite);
--      al escribirse en Odoo se apaga el pendiente (marcar_limite_credito_enviado).
--   Modos en configuracion (solo los lee administración, clave odoo_%): odoo_escritura_clientes_nuevos (clientes nuevos y
--   contactos; nace en 'simular') y odoo_escritura_clientes (límites, como teléfonos y direcciones de 19w).
--   Solo el personal de administración encola: clientes:crear para aprobar/crear/elegir, y quien puede editar el cliente en
--   Odoo (19w) para contactos y límites. Lo que hagan otros usuarios queda pendiente y administración lo envía desde la ficha.
--   Nunca se borra ni se archiva nada en Odoo.
-- ════════════════════════════════════════════════════════════════════════
begin;

-- ── Columnas ─────────────────────────────────────────────────────────────
alter table public.clientes
  add column if not exists odoo_vinculo text,
  add column if not exists odoo_vinculo_at timestamptz,
  add column if not exists odoo_vinculo_detalle jsonb;
alter table public.clientes drop constraint if exists clientes_odoo_vinculo_check;
alter table public.clientes add constraint clientes_odoo_vinculo_check
  check (odoo_vinculo in ('pendiente', 'creado', 'enlazado', 'varias', 'error'));
comment on column public.clientes.odoo_vinculo is 'Alta en Odoo de un cliente creado en GUDS (20s): pendiente | creado | enlazado (ya existía) | varias (coincidencias por elegir) | error. Null = vino de Odoo';
comment on column public.clientes.odoo_vinculo_detalle is 'Detalle del alta en Odoo: candidatos a elegir, motivo del enlace o error (20s)';

alter table public.registros_clientes
  add column if not exists estado_ve text,
  add column if not exists uso_cliente_existente boolean not null default false,
  add column if not exists coincidencia text;
alter table public.registros_clientes drop constraint if exists registros_clientes_coincidencia_check;
alter table public.registros_clientes add constraint registros_clientes_coincidencia_check check (coincidencia in ('rif', 'nombre'));
comment on column public.registros_clientes.estado_ve is 'Estado de Venezuela de la dirección (Odoo lo exige para crear el cliente)';
comment on column public.registros_clientes.uso_cliente_existente is 'Al aprobar ya existía el cliente en GUDS (mismo RIF o nombre): el acceso quedó ligado a ese cliente';

-- ── Cola: tipos nuevos, modo e índice por cliente ────────────────────────
alter table public.odoo_escrituras drop constraint if exists odoo_escrituras_tipo_check;
alter table public.odoo_escrituras add constraint odoo_escrituras_tipo_check check (tipo in ('entrega_estado', 'cliente_contacto',
  'cliente_direccion', 'producto', 'cliente_nuevo', 'persona_contacto', 'cliente_limite'));
comment on table public.odoo_escrituras is 'Registro y cola de lo que GUDS escribe en Odoo (entregas, clientes nuevos, contactos, límites, teléfonos y direcciones, foto y descripción de productos)';
insert into public.configuracion (clave, valor, descripcion)
values ('odoo_escritura_clientes_nuevos', 'simular', 'Clientes nuevos (crear o enlazar) y personas de contacto hacia Odoo: simular (no escribe) o activo')
on conflict (clave) do nothing;
drop index if exists public.odoo_escrituras_cliente;
create index odoo_escrituras_cliente on public.odoo_escrituras ((datos ->> 'cliente_id'), created_at desc)
  where tipo in ('cliente_contacto', 'cliente_direccion', 'cliente_nuevo', 'persona_contacto', 'cliente_limite');

-- ── Reglas internas ──────────────────────────────────────────────────────
-- Clave para comparar RIF escritos distinto: letra + 8 dígitos, sin dígito verificador (igual que claveRif() de util.js)
create or replace function public.clave_rif(t text)
returns text language sql immutable set search_path = public as $$
  select case
    when x.n is null or x.n in ('ND', 'NA', 'SINRIF') then null
    when x.n ~ '^[VEJPGC][0-9]{9}$' then left(x.n, 9)
    when x.n ~ '^[VEJPGC][0-9]{7,8}$' then left(x.n, 1) || lpad(substr(x.n, 2), 8, '0')
    else x.n end
  from (select public.normalizar_rif(t) n) x
$$;

-- Estado de Venezuela a partir de un texto libre: un tramo que sea un estado ("Valencia, Carabobo", "Edo. Miranda") o una
-- ciudad conocida ("Caracas" → Distrito Capital). No mira palabras sueltas (hay avenidas Bolívar, Miranda o Sucre).
create or replace function public.inferir_estado_ve(p_texto text)
returns text language plpgsql immutable set search_path = public as $$
declare v_parte text; v_estado text; v_norm text;
begin
  if nullif(btrim(coalesce(p_texto, '')), '') is null then return null; end if;
  foreach v_parte in array regexp_split_to_array(p_texto, '[,;/]|\s-\s') loop
    v_estado := public.estado_ve(regexp_replace(btrim(v_parte), '^(edo\.?|estado)\s+', '', 'i'));
    if v_estado is not null then return v_estado; end if;
  end loop;
  v_norm := ' ' || btrim(regexp_replace(translate(lower(p_texto), 'áéíóúüñ', 'aeiouun'), '[^a-z0-9]+', ' ', 'g')) || ' ';
  select c.e into v_estado from (values
    ('caracas', 'Distrito Capital'),
    ('maracaibo', 'Zulia'), ('cabimas', 'Zulia'), ('ciudad ojeda', 'Zulia'), ('machiques', 'Zulia'), ('santa barbara del zulia', 'Zulia'),
    ('valencia', 'Carabobo'), ('puerto cabello', 'Carabobo'), ('guacara', 'Carabobo'), ('naguanagua', 'Carabobo'), ('los guayos', 'Carabobo'),
    ('tocuyito', 'Carabobo'), ('moron', 'Carabobo'), ('bejuma', 'Carabobo'),
    ('barquisimeto', 'Lara'), ('cabudare', 'Lara'), ('carora', 'Lara'), ('el tocuyo', 'Lara'), ('quibor', 'Lara'),
    ('maracay', 'Aragua'), ('turmero', 'Aragua'), ('cagua', 'Aragua'), ('la victoria', 'Aragua'), ('villa de cura', 'Aragua'),
    ('barcelona', 'Anzoátegui'), ('puerto la cruz', 'Anzoátegui'), ('lecheria', 'Anzoátegui'), ('el tigre', 'Anzoátegui'), ('anaco', 'Anzoátegui'),
    ('puerto ordaz', 'Bolívar'), ('san felix', 'Bolívar'), ('ciudad guayana', 'Bolívar'), ('ciudad bolivar', 'Bolívar'), ('upata', 'Bolívar'),
    ('maturin', 'Monagas'), ('punta de mata', 'Monagas'), ('caripito', 'Monagas'),
    ('san cristobal', 'Táchira'), ('tariba', 'Táchira'), ('rubio', 'Táchira'), ('la grita', 'Táchira'), ('san antonio del tachira', 'Táchira'),
    ('el vigia', 'Mérida'), ('ejido', 'Mérida'), ('tovar', 'Mérida'),
    ('cumana', 'Sucre'), ('carupano', 'Sucre'), ('guiria', 'Sucre'),
    ('socopo', 'Barinas'), ('barinitas', 'Barinas'),
    ('porlamar', 'Nueva Esparta'), ('pampatar', 'Nueva Esparta'), ('la asuncion', 'Nueva Esparta'), ('juan griego', 'Nueva Esparta'),
    ('coro', 'Falcón'), ('punto fijo', 'Falcón'), ('tucacas', 'Falcón'),
    ('los teques', 'Miranda'), ('guarenas', 'Miranda'), ('guatire', 'Miranda'), ('petare', 'Miranda'), ('chacao', 'Miranda'), ('baruta', 'Miranda'),
    ('el hatillo', 'Miranda'), ('charallave', 'Miranda'), ('ocumare del tuy', 'Miranda'), ('santa teresa del tuy', 'Miranda'), ('cua', 'Miranda'),
    ('san antonio de los altos', 'Miranda'), ('higuerote', 'Miranda'),
    ('san juan de los morros', 'Guárico'), ('calabozo', 'Guárico'), ('valle de la pascua', 'Guárico'), ('zaraza', 'Guárico'),
    ('acarigua', 'Portuguesa'), ('araure', 'Portuguesa'), ('guanare', 'Portuguesa'),
    ('san felipe', 'Yaracuy'), ('yaritagua', 'Yaracuy'), ('chivacoa', 'Yaracuy'),
    ('valera', 'Trujillo'), ('bocono', 'Trujillo'),
    ('tinaquillo', 'Cojedes'), ('tucupita', 'Delta Amacuro'), ('puerto ayacucho', 'Amazonas'),
    ('san fernando de apure', 'Apure'), ('guasdualito', 'Apure'),
    ('maiquetia', 'La Guaira'), ('catia la mar', 'La Guaira'), ('macuto', 'La Guaira'), ('caraballeda', 'La Guaira')
  ) c(ciudad, e)
  where v_norm like '% ' || c.ciudad || ' %'
  order by length(c.ciudad) desc
  limit 1;
  return v_estado;
end $$;

-- Cliente de GUDS que ya existe (misma empresa o compartido) con el mismo RIF o el mismo nombre normalizado.
-- Prioridad: RIF, activo, de la misma empresa, ligado a Odoo, el más antiguo.
create or replace function public.buscar_cliente_existente(p_empresa uuid, p_rif text, p_nombre text)
returns table (id uuid, nombre text, rif text, activo boolean, odoo_id integer, coincidencia text)
language sql stable set search_path = public as $$
  with k as (select public.clave_rif(p_rif) rif, public.normalizar_nombre_empresa(p_nombre) nom)
  select c.id, c.nombre_negocio::text, c.rif, c.activo, c.odoo_id,
         case when k.rif is not null and public.clave_rif(c.rif) = k.rif then 'rif' else 'nombre' end
  from clientes c cross join k
  where (c.empresa_id is null or p_empresa is null or c.empresa_id = p_empresa)
    and ((k.rif is not null and public.clave_rif(c.rif) = k.rif)
         or (k.nom is not null and public.normalizar_nombre_empresa(c.nombre_negocio) = k.nom))
  order by (k.rif is not null and public.clave_rif(c.rif) = k.rif) desc, c.activo desc,
           (c.empresa_id is not distinct from p_empresa) desc, (c.odoo_id is not null) desc, c.created_at
  limit 1
$$;

-- Quién crea o enlaza clientes en Odoo: personal de administración con permiso de crear clientes
create or replace function public.puede_crear_cliente_odoo()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and public.es_personal_admin() and public.puede('clientes', 'crear')
$$;

-- Nombre de quien llama (para las notas "(GUDS)" en Odoo)
create or replace function public.nombre_usuario_actual()
returns text language sql stable security definer set search_path = public as $$
  select nullif(btrim(concat_ws(' ', nombre, apellido)), '') from usuarios where auth_id = auth.uid()
$$;

-- ── Guardas ──────────────────────────────────────────────────────────────
-- El vínculo con Odoo de un cliente (odoo_id y el estado del alta) solo lo cambian la sincronización, la función edge y las
-- funciones de esta fase; nunca una petición de la API (antes se podía cambiar clientes.odoo_id desde el navegador).
create or replace function public.trg_cliente_odoo_protegido()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '') <> 'authenticated' then return new; end if;
  if coalesce(current_setting('guds.vinculo_odoo', true), '') = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    new.odoo_id := null; new.odoo_vinculo := null; new.odoo_vinculo_at := null; new.odoo_vinculo_detalle := null;
  else
    new.odoo_id := old.odoo_id; new.odoo_vinculo := old.odoo_vinculo; new.odoo_vinculo_at := old.odoo_vinculo_at;
    new.odoo_vinculo_detalle := old.odoo_vinculo_detalle;
  end if;
  return new;
end $$;
drop trigger if exists b0_cliente_odoo_protegido on public.clientes;
create trigger b0_cliente_odoo_protegido before insert or update on public.clientes
  for each row execute function public.trg_cliente_odoo_protegido();

-- Igual para el odoo_id de los contactos
create or replace function public.trg_contacto_odoo_protegido()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '') <> 'authenticated' then return new; end if;
  if tg_op = 'INSERT' then new.odoo_id := null; else new.odoo_id := old.odoo_id; end if;
  return new;
end $$;
drop trigger if exists b_contacto_odoo_protegido on public.cliente_contactos;
create trigger b_contacto_odoo_protegido before insert or update on public.cliente_contactos
  for each row execute function public.trg_contacto_odoo_protegido();

-- Registro público: entra siempre pendiente y sin datos de revisión (la política de anon acepta cualquier fila); el estado de
-- Venezuela se normaliza ("Bolivar. (VE)" → "Bolívar") o queda vacío si no es válido
create or replace function public.trg_registro_cliente_normalizar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '') in ('anon', 'authenticated')
     and not (public.es_personal_admin() and public.puede('registros', 'editar')) then
    new.estado := 'pendiente'; new.revisado_por := null; new.fecha_revision := null; new.cliente_creado_id := null;
    new.uso_cliente_existente := false; new.coincidencia := null;
  end if;
  new.estado_ve := public.estado_ve(new.estado_ve);
  return new;
end $$;
drop trigger if exists a_registro_cliente_normalizar on public.registros_clientes;
create trigger a_registro_cliente_normalizar before insert or update of estado_ve on public.registros_clientes
  for each row execute function public.trg_registro_cliente_normalizar();

-- Duplicados (18c) con la clave de RIF nueva: "J-12345678" y "J-12345678-9" también son el mismo cliente
create or replace function public.trg_cliente_sin_duplicados()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_rol text; v_rif text; v_nom text; v_otro record;
begin
  v_rol := coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '');
  if v_rol <> 'authenticated' then return new; end if;     -- el importador de Odoo no pasa por aquí
  if tg_op = 'UPDATE' and new.rif is not distinct from old.rif
     and new.nombre_negocio is not distinct from old.nombre_negocio then
    return new;
  end if;
  v_rif := public.clave_rif(new.rif);
  v_nom := normalizar_nombre_empresa(new.nombre_negocio);
  select c.nombre_negocio, c.rif into v_otro
  from clientes c
  where c.id <> new.id
    and (c.empresa_id is null or new.empresa_id is null or c.empresa_id = new.empresa_id)
    and ((v_rif is not null and public.clave_rif(c.rif) = v_rif)
         or (v_nom is not null and normalizar_nombre_empresa(c.nombre_negocio) = v_nom))
  limit 1;
  if found then
    raise exception 'Ya existe un cliente con ese RIF o nombre en esta empresa: % (RIF %).', v_otro.nombre_negocio, v_otro.rif
      using errcode = 'P0001';
  end if;
  return new;
end $$;

-- ── Cola: alta del cliente en Odoo ───────────────────────────────────────
-- Encola (una sola vez a la vez) el alta en Odoo de un cliente sin odoo_id y lo marca "pendiente". Interna.
create or replace function public.encolar_cliente_nuevo(p_cliente_id uuid, p_datos jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_c record; v_id uuid;
begin
  select id, odoo_id, empresa_id, codigo, nombre_negocio into v_c from clientes where id = p_cliente_id for update;
  if not found or v_c.odoo_id is not null then return null; end if;
  select id into v_id from odoo_escrituras where tipo = 'cliente_nuevo' and referencia_id = p_cliente_id
    and estado in ('pendiente', 'procesando') and created_at > now() - interval '15 minutes' order by created_at desc limit 1;
  if v_id is not null then return v_id; end if;
  -- El detalle se conserva (p. ej. los candidatos a elegir si este envío falla); el resultado lo reemplaza
  perform set_config('guds.vinculo_odoo', 'on', true);
  update clientes set odoo_vinculo = 'pendiente', odoo_vinculo_at = now() where id = p_cliente_id;
  perform set_config('guds.vinculo_odoo', '', true);
  return public.encolar_escritura_odoo('cliente_nuevo', p_cliente_id,
    jsonb_build_object('cliente_id', p_cliente_id, 'codigo', v_c.codigo, 'nombre', v_c.nombre_negocio) || coalesce(p_datos, '{}'::jsonb),
    v_c.empresa_id);
end $$;

-- Alta manual en el admin (Clientes → Nuevo): también va a Odoo. La aprobación de registros encola por su cuenta.
create or replace function public.trg_cliente_nuevo_odoo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.odoo_id is not null or new.registro_origen_id is not null or not coalesce(new.activo, true) then return null; end if;
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '') <> 'authenticated' then return null; end if;
  if not public.puede_crear_cliente_odoo() then return null; end if;
  perform public.encolar_cliente_nuevo(new.id, jsonb_build_object('origen', 'manual', 'aprobado_por', public.nombre_usuario_actual()));
  return null;
end $$;
drop trigger if exists y_cliente_nuevo_odoo on public.clientes;
create trigger y_cliente_nuevo_odoo after insert on public.clientes for each row execute function public.trg_cliente_nuevo_odoo();

-- ── Aprobación de registros ──────────────────────────────────────────────
create or replace function public.aprobar_registro_cliente(p_registro_id uuid, p_admin_id uuid default null, p_lista_precios_id uuid default null,
  p_vendedor_id uuid default null, p_limite_credito numeric default 0, p_dias_credito integer default 0)
returns table(cliente_id uuid, email text, password_temporal text)
language plpgsql security definer set search_path = public as $$
declare
  v_registro record;
  v_cliente_id uuid;
  v_codigo text;
  v_lista_id uuid;
  v_auth_id uuid;
  v_pass text;
  v_admin uuid;
  v_empresa uuid;
  v_existente uuid;
  v_coincidencia text;
  v_estado text;
begin
  if not (public.es_personal_admin() and public.puede('clientes', 'crear')) then
    raise exception 'No tienes permiso para aprobar registros de clientes' using errcode = '42501';
  end if;

  select * into v_registro from registros_clientes where id = p_registro_id for update;
  if v_registro is null then raise exception 'Registro no encontrado'; end if;
  if v_registro.estado <> 'pendiente' then raise exception 'El registro ya fue procesado'; end if;

  -- El aprobador es siempre quien llama (p_admin_id se ignora: no se puede aprobar en nombre de otro)
  v_admin := (select id from usuarios where auth_id = auth.uid());
  v_empresa := coalesce(v_registro.empresa_id, public.empresa_activa_requerida());

  -- ¿Ya existe en GUDS (misma empresa o compartido) con el mismo RIF o nombre? No se crea otro: el acceso queda ligado a ese
  select b.id, b.coincidencia into v_existente, v_coincidencia
  from public.buscar_cliente_existente(v_empresa, v_registro.rif, v_registro.nombre_negocio) b;

  if v_existente is not null then
    v_cliente_id := v_existente;
  else
    if p_lista_precios_id is null then
      select id into v_lista_id from listas_precios where es_default = true limit 1;
    else
      v_lista_id := p_lista_precios_id;
    end if;
    v_codigo := generar_codigo_cliente();
    v_estado := coalesce(public.estado_ve(v_registro.estado_ve), public.inferir_estado_ve(v_registro.ciudad),
      public.inferir_estado_ve(v_registro.direccion));
    insert into clientes (
      codigo, nombre_negocio, tipo_negocio, rif, email, telefono,
      direccion, calle, direccion_entrega, ciudad, estado, contribuyente_especial, es_empresa,
      lista_precios_id, vendedor_asignado_id,
      limite_credito, dias_credito, registro_origen_id, empresa_id
    ) values (
      v_codigo, v_registro.nombre_negocio, v_registro.tipo_negocio,
      v_registro.rif, v_registro.email, v_registro.telefono,
      v_registro.direccion, nullif(btrim(v_registro.direccion), ''), v_registro.direccion_entrega, v_registro.ciudad, v_estado,
      v_registro.contribuyente_especial, left(public.normalizar_rif(v_registro.rif), 1) in ('J', 'G', 'C'),
      v_lista_id, p_vendedor_id,
      p_limite_credito, p_dias_credito, p_registro_id, v_empresa
    ) returning id into v_cliente_id;
  end if;

  v_pass := generar_password_temporal();
  v_auth_id := public.crear_auth_user(v_registro.email, v_pass);

  insert into usuarios (auth_id, email, nombre, apellido, telefono, role, cliente_id, activo, debe_cambiar_clave)
  values (v_auth_id, v_registro.email, v_registro.nombre_contacto, v_registro.apellido_contacto,
          v_registro.telefono, 'cliente', v_cliente_id, true, true);

  update registros_clientes set
    estado = 'aprobado', revisado_por = v_admin, fecha_revision = now(), cliente_creado_id = v_cliente_id,
    uso_cliente_existente = v_existente is not null, coincidencia = v_coincidencia
  where id = p_registro_id;

  -- Cliente nuevo → su alta en Odoo (crear o enlazar sin duplicar), en segundo plano
  if v_existente is null then
    perform public.encolar_cliente_nuevo(v_cliente_id, jsonb_build_object('origen', 'registro', 'registro_id', p_registro_id,
      'aprobado_por', public.nombre_usuario_actual()));
  end if;

  return query select v_cliente_id, v_registro.email::text, v_pass;
end $$;

-- Qué pasará al aprobar un registro (lo muestra Registros antes de confirmar). No cambia nada.
create or replace function public.previsualizar_registro_cliente(p_registro_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_r record; v_empresa uuid; v_estado text;
  v_e_id uuid; v_e_nombre text; v_e_rif text; v_e_activo boolean; v_e_odoo integer; v_e_coinc text;
  v_p_nombre text; v_p_rif text;
begin
  if not public.puede_crear_cliente_odoo() then
    raise exception 'No tienes permiso para aprobar registros de clientes' using errcode = '42501';
  end if;
  select * into v_r from registros_clientes where id = p_registro_id;
  if not found then raise exception 'Registro no encontrado' using errcode = 'P0002'; end if;
  v_empresa := coalesce(v_r.empresa_id, public.empresa_activa());
  select b.id, b.nombre, b.rif, b.activo, b.odoo_id, b.coincidencia into v_e_id, v_e_nombre, v_e_rif, v_e_activo, v_e_odoo, v_e_coinc
  from public.buscar_cliente_existente(v_empresa, v_r.rif, v_r.nombre_negocio) b;
  if v_e_id is null then
    -- El espejo de Odoo en GUDS también tiene los proveedores: uno con el mismo RIF se enlazaría en vez de crear otro
    select p.nombre, p.rif into v_p_nombre, v_p_rif from proveedores p
    where p.odoo_id is not null and (p.empresa_id is null or v_empresa is null or p.empresa_id = v_empresa)
      and public.clave_rif(p.rif) = public.clave_rif(v_r.rif)
    limit 1;
  end if;
  v_estado := coalesce(public.estado_ve(v_r.estado_ve), public.inferir_estado_ve(v_r.ciudad), public.inferir_estado_ve(v_r.direccion));
  return jsonb_build_object(
    'accion', case when v_e_id is not null then 'usar_existente' when v_p_nombre is not null then 'enlazar_odoo' else 'crear_odoo' end,
    'empresa_id', v_empresa, 'empresa', (select nombre_corto from empresas where id = v_empresa),
    'empresa_activa', public.empresa_activa(),
    'existente', case when v_e_id is not null then jsonb_build_object('id', v_e_id, 'nombre', v_e_nombre, 'rif', v_e_rif,
      'activo', v_e_activo, 'en_odoo', v_e_odoo is not null, 'coincidencia', v_e_coinc,
      'rif_distinto', v_e_coinc = 'nombre' and public.clave_rif(v_e_rif) is distinct from public.clave_rif(v_r.rif)) end,
    'odoo', case when v_p_nombre is not null then jsonb_build_object('nombre', v_p_nombre, 'rif', v_p_rif, 'tipo', 'proveedor') end,
    'estado_ve', v_estado,
    'estado_inferido', v_estado is not null and public.estado_ve(v_r.estado_ve) is null,
    'rif_valido', coalesce(public.clave_rif(v_r.rif) ~ '^[VEJPGC][0-9]{8}$', false),
    'email_usado', exists (select 1 from auth.users a where lower(a.email) = lower(v_r.email))
      or exists (select 1 from usuarios u where lower(u.email) = lower(v_r.email)),
    'modo', coalesce((select valor from configuracion where clave = 'odoo_escritura_clientes_nuevos'), 'simular'));
end $$;

-- ── Resultado del alta (los llama la función edge: rol postgres) ─────────
-- Liga el cliente al contacto de Odoo creado o enlazado; reenvía sus pedidos aprobados que esperaban y encola sus contactos
-- y, si es un cliente creado con límite, el límite. Interna.
create or replace function public.aplicar_vinculo_cliente_odoo(p_cliente_id uuid, p_odoo_id integer, p_vinculo text, p_detalle jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c record; v_otro text; v_ped int := 0; v_k int := 0; v_lim boolean := false; r record;
begin
  if p_vinculo not in ('creado', 'enlazado') or p_odoo_id is null or p_odoo_id <= 0 then raise exception 'Vínculo con Odoo inválido'; end if;
  select id, odoo_id, empresa_id, coalesce(limite_credito, 0) limite into v_c from clientes where id = p_cliente_id for update;
  if not found then raise exception 'Cliente no encontrado'; end if;
  if v_c.odoo_id is not null then
    if v_c.odoo_id = p_odoo_id then return jsonb_build_object('ya_vinculado', true); end if;
    raise exception 'El cliente ya está ligado a otro contacto de Odoo (%)', v_c.odoo_id;
  end if;
  select nombre_negocio into v_otro from clientes where odoo_id = p_odoo_id;
  if v_otro is not null then raise exception 'El contacto % de Odoo ya está ligado al cliente % de GUDS', p_odoo_id, v_otro; end if;

  v_lim := p_vinculo = 'creado' and v_c.limite > 0;
  perform set_config('guds.vinculo_odoo', 'on', true);
  update clientes set odoo_id = p_odoo_id, odoo_vinculo = p_vinculo, odoo_vinculo_at = now(),
    odoo_vinculo_detalle = coalesce(p_detalle, '{}'::jsonb), updated_at = now(),
    limite_credito_pendiente = case when v_lim then true else limite_credito_pendiente end,
    limite_credito_editado_en = case when v_lim then now() else limite_credito_editado_en end
  where id = p_cliente_id;
  perform set_config('guds.vinculo_odoo', '', true);

  -- Pedidos aprobados que no pudieron enviarse porque el cliente no existía en Odoo
  for r in select o.id from ordenes o where o.cliente_id = p_cliente_id and o.aprobacion = 'aprobada' and o.aprobado_por is not null
      and o.odoo_id is null and o.estado <> 'cancelado' order by o.aprobado_at limit 20 loop
    update ordenes set odoo_envio_error = null where id = r.id;
    perform public.disparar_envio_pedido(r.id);
    v_ped := v_ped + 1;
  end loop;
  -- Contactos que esperaban al cliente
  for r in select k.id, k.nombre from cliente_contactos k where k.cliente_id = p_cliente_id and k.odoo_id is null and k.activo loop
    perform public.encolar_escritura_odoo('persona_contacto', r.id, jsonb_build_object('cliente_id', p_cliente_id, 'contacto_id', r.id,
      'accion', 'crear', 'nombre', r.nombre, 'origen', 'cliente_vinculado'), v_c.empresa_id);
    v_k := v_k + 1;
  end loop;
  if v_lim then
    perform public.encolar_escritura_odoo('cliente_limite', p_cliente_id, jsonb_build_object('cliente_id', p_cliente_id,
      'valor', v_c.limite, 'origen', 'cliente_creado'), v_c.empresa_id);
  end if;
  return jsonb_build_object('pedidos_reenviados', v_ped, 'contactos_encolados', v_k, 'limite_encolado', v_lim);
end $$;

-- Varias coincidencias en Odoo: el cliente queda esperando que administración elija. Interna.
create or replace function public.registrar_revision_cliente_odoo(p_cliente_id uuid, p_detalle jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('guds.vinculo_odoo', 'on', true);
  update clientes set odoo_vinculo = 'varias', odoo_vinculo_at = now(), odoo_vinculo_detalle = coalesce(p_detalle, '{}'::jsonb)
  where id = p_cliente_id and odoo_id is null;
  perform set_config('guds.vinculo_odoo', '', true);
end $$;

-- El alta falló (dato faltante, Odoo rechazó…): queda en error con el motivo (se conservan los candidatos, si los había). Interna.
create or replace function public.registrar_error_cliente_odoo(p_cliente_id uuid, p_error text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('guds.vinculo_odoo', 'on', true);
  update clientes set odoo_vinculo = 'error', odoo_vinculo_at = now(),
    odoo_vinculo_detalle = coalesce(odoo_vinculo_detalle, '{}'::jsonb) || jsonb_build_object('error', left(coalesce(p_error, 'Error desconocido'), 500))
  where id = p_cliente_id and odoo_id is null;
  perform set_config('guds.vinculo_odoo', '', true);
end $$;

-- El límite enviado quedó en Odoo: se apaga el pendiente solo si el límite de GUDS sigue siendo el enviado. Interna.
create or replace function public.marcar_limite_credito_enviado(p_cliente_id uuid, p_valor numeric)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update clientes set limite_credito_pendiente = false
  where id = p_cliente_id and limite_credito_pendiente and round(coalesce(limite_credito, 0), 2) = round(coalesce(p_valor, 0), 2);
  return found;
end $$;

-- ── Contactos y límite: disparadores ─────────────────────────────────────
-- Contacto creado o editado por administración → a la cola (si el cliente ya está en Odoo). Desactivar no se envía.
create or replace function public.trg_contacto_odoo_encolar()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_cli record; v_accion text;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '') <> 'authenticated' then return null; end if;
  select odoo_id, empresa_id into v_cli from clientes where id = new.cliente_id;
  if v_cli.odoo_id is null then return null; end if;           -- espera a que el cliente quede ligado a Odoo
  if new.odoo_id is null then
    if not new.activo then return null; end if;
    if tg_op = 'UPDATE' and old.activo and (new.nombre, new.cargo, new.email, new.telefono, new.celular)
       is not distinct from (old.nombre, old.cargo, old.email, old.telefono, old.celular) then return null; end if;
    v_accion := 'crear';
  else
    if tg_op = 'UPDATE' and (new.nombre, new.cargo, new.email, new.telefono, new.celular)
       is not distinct from (old.nombre, old.cargo, old.email, old.telefono, old.celular) then return null; end if;
    v_accion := 'editar';
  end if;
  if not public.puede_editar_cliente_odoo(new.cliente_id) then return null; end if;
  if exists (select 1 from odoo_escrituras where tipo = 'persona_contacto' and referencia_id = new.id and estado = 'pendiente') then return null; end if;
  perform public.encolar_escritura_odoo('persona_contacto', new.id, jsonb_build_object('cliente_id', new.cliente_id, 'contacto_id', new.id,
    'accion', v_accion, 'nombre', new.nombre), v_cli.empresa_id);
  return null;
end $$;
drop trigger if exists y_contacto_odoo_encolar on public.cliente_contactos;
create trigger y_contacto_odoo_encolar after insert or update on public.cliente_contactos
  for each row execute function public.trg_contacto_odoo_encolar();

-- Límite editado por administración en un cliente de Odoo (18l lo marcó pendiente) → a la cola
create or replace function public.trg_cliente_limite_odoo_encolar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.odoo_id is null or not new.limite_credito_pendiente or new.limite_credito is not distinct from old.limite_credito then return null; end if;
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '') <> 'authenticated' then return null; end if;
  if not public.puede_editar_cliente_odoo(new.id) then return null; end if;
  if exists (select 1 from odoo_escrituras where tipo = 'cliente_limite' and referencia_id = new.id and estado = 'pendiente') then return null; end if;
  perform public.encolar_escritura_odoo('cliente_limite', new.id, jsonb_build_object('cliente_id', new.id, 'valor', new.limite_credito,
    'antes', old.limite_credito), new.empresa_id);
  return null;
end $$;
drop trigger if exists y_cliente_limite_odoo on public.clientes;
create trigger y_cliente_limite_odoo after update of limite_credito on public.clientes
  for each row execute function public.trg_cliente_limite_odoo_encolar();

-- ── Acciones del admin (ficha del cliente) ───────────────────────────────
-- Elegir entre las coincidencias de Odoo: enlazar una (p_odoo_id) o crear un cliente nuevo (null; solo si ningún candidato
-- tiene el mismo RIF). Solo se aceptan contactos que el escritor encontró como coincidencias.
create or replace function public.elegir_cliente_odoo(p_cliente_id uuid, p_odoo_id integer)
returns uuid language plpgsql security definer set search_path = public as $$
declare v record; v_cand jsonb;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión.' using errcode = '42501'; end if;
  if not public.puede_crear_cliente_odoo() then
    raise exception 'No tienes permiso para crear o enlazar clientes en Odoo.' using errcode = '42501';
  end if;
  select id, odoo_id, empresa_id, odoo_vinculo_detalle into v from clientes
  where id = p_cliente_id and (empresa_id is null or empresa_id = any (public.empresas_visibles())) for update;
  if not found then raise exception 'Cliente no encontrado.' using errcode = 'P0002'; end if;
  if v.odoo_id is not null then raise exception 'El cliente ya está vinculado a Odoo.' using errcode = 'P0001'; end if;
  if exists (select 1 from odoo_escrituras where tipo = 'cliente_nuevo' and referencia_id = p_cliente_id and estado in ('pendiente', 'procesando')
             and created_at > now() - interval '15 minutes') then
    raise exception 'Ya hay un envío de este cliente a Odoo en curso. Espera su resultado.' using errcode = 'P0001';
  end if;
  v_cand := coalesce(v.odoo_vinculo_detalle -> 'candidatos', (select e.resultado -> 'candidatos' from odoo_escrituras e
    where e.tipo = 'cliente_nuevo' and e.referencia_id = p_cliente_id and e.estado in ('hecha', 'simulada')
    order by e.created_at desc limit 1), '[]'::jsonb);
  if p_odoo_id is null then
    if exists (select 1 from jsonb_array_elements(v_cand) x where x ->> 'coincide' <> 'nombre') then
      raise exception 'En Odoo hay un contacto con el mismo RIF: elige enlazarlo (no se crea otro).' using errcode = 'P0001';
    end if;
  elsif not exists (select 1 from jsonb_array_elements(v_cand) x where (x ->> 'id')::int = p_odoo_id) then
    raise exception 'Ese contacto de Odoo no está entre las coincidencias de este cliente.' using errcode = 'P0001';
  end if;
  return public.encolar_cliente_nuevo(p_cliente_id, jsonb_build_object('origen', 'eleccion', 'aprobado_por', public.nombre_usuario_actual(),
    'elegido', coalesce(to_jsonb(p_odoo_id), '"crear"'::jsonb)));
end $$;

-- Completar los datos que Odoo exige (dirección con estado, teléfonos, RIF) de un cliente que aún no está en Odoo, y enviarlo
create or replace function public.completar_cliente_odoo(p_cliente_id uuid, p_datos jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v record; v_ajenas text; v_dir jsonb; v_tel text; v_cel text; v_rif text;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión.' using errcode = '42501'; end if;
  if not public.puede_crear_cliente_odoo() then
    raise exception 'No tienes permiso para crear o enlazar clientes en Odoo.' using errcode = '42501';
  end if;
  select id, odoo_id, telefono, celular into v from clientes
  where id = p_cliente_id and (empresa_id is null or empresa_id = any (public.empresas_visibles()));
  if not found then raise exception 'Cliente no encontrado.' using errcode = 'P0002'; end if;
  if v.odoo_id is not null then raise exception 'El cliente ya está en Odoo: sus datos se editan desde "Teléfonos y dirección".' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_datos) is distinct from 'object' or p_datos = '{}'::jsonb then raise exception 'No hay datos para guardar.' using errcode = '22023'; end if;
  select string_agg(k, ', ') into v_ajenas from jsonb_object_keys(p_datos) k
  where k not in ('calle', 'complemento', 'ciudad', 'estado', 'telefono', 'celular', 'rif');
  if v_ajenas is not null then raise exception 'Campos no permitidos: %.', v_ajenas using errcode = '22023'; end if;
  v_dir := public.validar_direccion_odoo(p_datos);
  if p_datos ? 'telefono' then v_tel := public.validar_telefono_ve(p_datos ->> 'telefono', 'teléfono'); end if;
  if p_datos ? 'celular' then v_cel := public.validar_telefono_ve(p_datos ->> 'celular', 'celular', true); end if;
  if p_datos ? 'rif' then
    v_rif := upper(btrim(coalesce(p_datos ->> 'rif', '')));
    if coalesce(public.clave_rif(v_rif), '') !~ '^[VEJPG][0-9]{8}$' then
      raise exception 'El RIF "%" no es válido: usa el formato J-12345678-9.', v_rif using errcode = '22023';
    end if;
  end if;
  update clientes set
    calle = case when v_dir ? 'calle' then v_dir ->> 'calle' else calle end,
    complemento = case when v_dir ? 'calle' then v_dir ->> 'complemento' else complemento end,
    ciudad = case when v_dir ? 'calle' then v_dir ->> 'ciudad' else ciudad end,
    estado = case when v_dir ? 'calle' then v_dir ->> 'estado' else estado end,
    direccion = case when v_dir ? 'calle' then concat_ws(', ', v_dir ->> 'calle', v_dir ->> 'complemento') else direccion end,
    telefono = case when p_datos ? 'telefono' then v_tel else telefono end,
    celular = case when p_datos ? 'celular' then v_cel else celular end,
    rif = coalesce(v_rif, rif),
    updated_at = now()
  where id = p_cliente_id;
  return public.encolar_cliente_nuevo(p_cliente_id, jsonb_build_object('origen', 'datos_completados', 'aprobado_por', public.nombre_usuario_actual()));
end $$;

-- Enviar (o reenviar) a Odoo un cliente de GUDS que aún no está vinculado (p. ej. creado mientras el modo era "simular")
create or replace function public.enviar_cliente_odoo(p_cliente_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión.' using errcode = '42501'; end if;
  if not public.puede_crear_cliente_odoo() then
    raise exception 'No tienes permiso para crear o enlazar clientes en Odoo.' using errcode = '42501';
  end if;
  select id, odoo_id into v from clientes where id = p_cliente_id and (empresa_id is null or empresa_id = any (public.empresas_visibles()));
  if not found then raise exception 'Cliente no encontrado.' using errcode = 'P0002'; end if;
  if v.odoo_id is not null then raise exception 'El cliente ya está vinculado a Odoo.' using errcode = 'P0001'; end if;
  if exists (select 1 from odoo_escrituras where tipo = 'cliente_nuevo' and referencia_id = p_cliente_id and estado in ('pendiente', 'procesando')
             and created_at > now() - interval '15 minutes') then
    raise exception 'Ya hay un envío de este cliente a Odoo en curso. Espera su resultado.' using errcode = 'P0001';
  end if;
  return public.encolar_cliente_nuevo(p_cliente_id, jsonb_build_object('origen', 'reintento', 'aprobado_por', public.nombre_usuario_actual()));
end $$;

-- Enviar a Odoo los contactos pendientes de un cliente ya vinculado (los creados por quien no encola, o que fallaron)
create or replace function public.enviar_contactos_odoo(p_cliente_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v record; r record; n int := 0;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión.' using errcode = '42501'; end if;
  if not public.puede_editar_cliente_odoo(p_cliente_id) then
    raise exception 'No tienes permiso para editar los datos de este cliente en Odoo.' using errcode = '42501';
  end if;
  select id, odoo_id, empresa_id into v from clientes where id = p_cliente_id;
  if not found then raise exception 'Cliente no encontrado.' using errcode = 'P0002'; end if;
  if v.odoo_id is null then raise exception 'El cliente aún no está en Odoo: sus contactos se envían cuando quede vinculado.' using errcode = 'P0001'; end if;
  for r in select k.id, k.nombre from cliente_contactos k where k.cliente_id = p_cliente_id and k.odoo_id is null and k.activo
      and not exists (select 1 from odoo_escrituras e where e.tipo = 'persona_contacto' and e.referencia_id = k.id and e.estado in ('pendiente', 'procesando')) loop
    perform public.encolar_escritura_odoo('persona_contacto', r.id, jsonb_build_object('cliente_id', p_cliente_id, 'contacto_id', r.id,
      'accion', 'crear', 'nombre', r.nombre, 'origen', 'manual'), v.empresa_id);
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'No hay contactos pendientes de enviar a Odoo.' using errcode = 'P0001'; end if;
  return n;
end $$;

-- Enviar a Odoo el límite de crédito pendiente de un cliente
create or replace function public.enviar_limite_credito_odoo(p_cliente_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión.' using errcode = '42501'; end if;
  if not public.puede_editar_cliente_odoo(p_cliente_id) then
    raise exception 'No tienes permiso para editar los datos de este cliente en Odoo.' using errcode = '42501';
  end if;
  select id, odoo_id, empresa_id, limite_credito, limite_credito_pendiente into v from clientes where id = p_cliente_id;
  if not found then raise exception 'Cliente no encontrado.' using errcode = 'P0002'; end if;
  if v.odoo_id is null then raise exception 'El cliente aún no está en Odoo: el límite se envía cuando quede vinculado.' using errcode = 'P0001'; end if;
  if not v.limite_credito_pendiente then raise exception 'El límite de crédito no tiene cambios pendientes de enviar.' using errcode = 'P0001'; end if;
  if exists (select 1 from odoo_escrituras where tipo = 'cliente_limite' and referencia_id = p_cliente_id and estado in ('pendiente', 'procesando')
             and created_at > now() - interval '15 minutes') then
    raise exception 'Ya hay un envío del límite en curso. Espera su resultado.' using errcode = 'P0001';
  end if;
  return public.encolar_escritura_odoo('cliente_limite', p_cliente_id, jsonb_build_object('cliente_id', p_cliente_id,
    'valor', v.limite_credito, 'origen', 'manual'), v.empresa_id);
end $$;

-- Reintentar una escritura con error (19w) también para los tipos nuevos
create or replace function public.reintentar_escritura_cliente(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_e record;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión.' using errcode = '42501'; end if;
  select id, tipo, estado, referencia_id, datos ->> 'cliente_id' cliente_id into v_e from odoo_escrituras where id = p_id;
  if not found or v_e.tipo not in ('cliente_contacto', 'cliente_direccion', 'cliente_nuevo', 'persona_contacto', 'cliente_limite') then
    raise exception 'Escritura no encontrada.' using errcode = 'P0002';
  end if;
  if not public.puede_editar_cliente_odoo(v_e.cliente_id::uuid)
     or (v_e.tipo = 'cliente_nuevo' and not public.puede_crear_cliente_odoo()) then
    raise exception 'No tienes permiso para editar los datos de este cliente en Odoo.' using errcode = '42501';
  end if;
  if v_e.estado <> 'error' then raise exception 'Solo se reintentan los envíos que terminaron con error.' using errcode = 'P0001'; end if;
  if v_e.tipo = 'cliente_nuevo' then
    perform set_config('guds.vinculo_odoo', 'on', true);
    update clientes set odoo_vinculo = 'pendiente', odoo_vinculo_at = now() where id = v_e.referencia_id and odoo_id is null;
    perform set_config('guds.vinculo_odoo', '', true);
  end if;
  perform public.disparar_escritura_odoo(p_id);
  return p_id;
end $$;

-- Historial del cliente (19w) con los tipos nuevos. En persona_contacto, "direccion" trae el nombre del contacto.
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
    select e.id, e.tipo, coalesce(e.datos ->> 'accion', case when e.tipo = 'cliente_nuevo' then 'crear' else 'editar' end),
           case when e.tipo = 'cliente_direccion' then coalesce(e.datos ->> 'nombre', e.datos -> 'campos' ->> 'nombre', d.nombre)
                when e.tipo = 'persona_contacto' then coalesce(k.nombre, e.datos ->> 'nombre') end,
           e.estado, e.datos -> 'campos', e.datos -> 'antes', e.resultado, e.error, e.intentos,
           nullif(btrim(concat_ws(' ', u.nombre, u.apellido)), ''), e.created_at, e.procesado_at
    from odoo_escrituras e
    left join usuarios u on u.id = e.solicitado_por
    left join cliente_direcciones d on e.tipo = 'cliente_direccion' and d.id = e.referencia_id
    left join cliente_contactos k on e.tipo = 'persona_contacto' and k.id = e.referencia_id
    where e.tipo in ('cliente_contacto', 'cliente_direccion', 'cliente_nuevo', 'persona_contacto', 'cliente_limite')
      and e.datos ->> 'cliente_id' = p_cliente_id::text
    order by e.created_at desc
    limit least(greatest(coalesce(p_limite, 20), 1), 100);
end $$;

-- Estado de Odoo del cliente para su ficha: alta (vínculo y último envío), contactos y límite
create or replace function public.estado_odoo_cliente(p_cliente_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v record; v_envio jsonb;
begin
  if auth.uid() is null or not (public.es_personal_admin() and public.puede('clientes', 'ver')) then
    raise exception 'No tienes permiso para ver el estado de Odoo de este cliente.' using errcode = '42501';
  end if;
  select c.id, c.odoo_id, c.odoo_vinculo, c.odoo_vinculo_at, c.odoo_vinculo_detalle, c.limite_credito, c.limite_credito_pendiente,
         c.limite_credito_editado_en, c.estado, c.calle, c.ciudad, c.rif, c.telefono, c.celular, c.complemento
  into v from clientes c where c.id = p_cliente_id and (c.empresa_id is null or c.empresa_id = any (public.empresas_visibles()));
  if not found then raise exception 'Cliente no encontrado.' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'odoo_id', v.odoo_id, 'vinculo', v.odoo_vinculo, 'vinculo_at', v.odoo_vinculo_at, 'detalle', v.odoo_vinculo_detalle,
    'datos', jsonb_build_object('calle', v.calle, 'complemento', v.complemento, 'ciudad', v.ciudad, 'estado', v.estado, 'rif', v.rif,
      'telefono', v.telefono, 'celular', v.celular),
    'modo_nuevos', coalesce((select valor from configuracion where clave = 'odoo_escritura_clientes_nuevos'), 'simular'),
    'modo_clientes', coalesce((select valor from configuracion where clave = 'odoo_escritura_clientes'), 'simular'),
    'alta', (select jsonb_build_object('id', e.id, 'estado', e.estado, 'resultado', e.resultado, 'error', e.error, 'intentos', e.intentos,
        'origen', e.datos ->> 'origen', 'created_at', e.created_at, 'procesado_at', e.procesado_at,
        'solicitado_por', (select nullif(btrim(concat_ws(' ', u.nombre, u.apellido)), '') from usuarios u where u.id = e.solicitado_por))
      from odoo_escrituras e where e.tipo = 'cliente_nuevo' and e.referencia_id = p_cliente_id order by e.created_at desc limit 1),
    'contactos', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'nombre', k.nombre, 'cargo', k.cargo, 'activo', k.activo, 'odoo_id', k.odoo_id,
        'envio', (select jsonb_build_object('id', e.id, 'estado', e.estado, 'error', e.error, 'accion', e.datos ->> 'accion', 'created_at', e.created_at,
            'omitida', e.resultado ->> 'omitida')
          from odoo_escrituras e where e.tipo = 'persona_contacto' and e.referencia_id = k.id order by e.created_at desc limit 1))
        order by k.es_principal desc, k.nombre) from cliente_contactos k where k.cliente_id = p_cliente_id), '[]'::jsonb),
    'limite', jsonb_build_object('valor', v.limite_credito, 'pendiente', v.limite_credito_pendiente, 'editado_en', v.limite_credito_editado_en,
      'envio', (select jsonb_build_object('id', e.id, 'estado', e.estado, 'error', e.error, 'resultado', e.resultado, 'created_at', e.created_at)
        from odoo_escrituras e where e.tipo = 'cliente_limite' and e.referencia_id = p_cliente_id order by e.created_at desc limit 1)));
end $$;

-- ── Permisos de ejecución ────────────────────────────────────────────────
-- Internas: nadie las ejecuta por la API (ojo: "revoke ... from public" no basta en Supabase; se revoca de anon y authenticated)
revoke execute on function public.clave_rif(text) from public, anon, authenticated;
revoke execute on function public.inferir_estado_ve(text) from public, anon, authenticated;
revoke execute on function public.buscar_cliente_existente(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.nombre_usuario_actual() from public, anon, authenticated;
revoke execute on function public.encolar_cliente_nuevo(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.aplicar_vinculo_cliente_odoo(uuid, integer, text, jsonb) from public, anon, authenticated;
revoke execute on function public.registrar_revision_cliente_odoo(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.registrar_error_cliente_odoo(uuid, text) from public, anon, authenticated;
revoke execute on function public.marcar_limite_credito_enviado(uuid, numeric) from public, anon, authenticated;
revoke execute on function public.trg_cliente_odoo_protegido() from public, anon, authenticated;
revoke execute on function public.trg_contacto_odoo_protegido() from public, anon, authenticated;
revoke execute on function public.trg_registro_cliente_normalizar() from public, anon, authenticated;
revoke execute on function public.trg_cliente_sin_duplicados() from public, anon, authenticated;
revoke execute on function public.trg_cliente_nuevo_odoo() from public, anon, authenticated;
revoke execute on function public.trg_contacto_odoo_encolar() from public, anon, authenticated;
revoke execute on function public.trg_cliente_limite_odoo_encolar() from public, anon, authenticated;
-- Acciones del admin: con sesión (validan al llamador); sin anon
revoke execute on function public.aprobar_registro_cliente(uuid, uuid, uuid, uuid, numeric, integer) from public, anon;
revoke execute on function public.previsualizar_registro_cliente(uuid) from public, anon;
revoke execute on function public.puede_crear_cliente_odoo() from public, anon;
revoke execute on function public.elegir_cliente_odoo(uuid, integer) from public, anon;
revoke execute on function public.completar_cliente_odoo(uuid, jsonb) from public, anon;
revoke execute on function public.enviar_cliente_odoo(uuid) from public, anon;
revoke execute on function public.enviar_contactos_odoo(uuid) from public, anon;
revoke execute on function public.enviar_limite_credito_odoo(uuid) from public, anon;
revoke execute on function public.reintentar_escritura_cliente(uuid) from public, anon;
revoke execute on function public.historial_escrituras_cliente(uuid, integer) from public, anon;
revoke execute on function public.estado_odoo_cliente(uuid) from public, anon;
grant execute on function public.aprobar_registro_cliente(uuid, uuid, uuid, uuid, numeric, integer) to authenticated;
grant execute on function public.previsualizar_registro_cliente(uuid) to authenticated;
grant execute on function public.puede_crear_cliente_odoo() to authenticated;
grant execute on function public.elegir_cliente_odoo(uuid, integer) to authenticated;
grant execute on function public.completar_cliente_odoo(uuid, jsonb) to authenticated;
grant execute on function public.enviar_cliente_odoo(uuid) to authenticated;
grant execute on function public.enviar_contactos_odoo(uuid) to authenticated;
grant execute on function public.enviar_limite_credito_odoo(uuid) to authenticated;
grant execute on function public.reintentar_escritura_cliente(uuid) to authenticated;
grant execute on function public.historial_escrituras_cliente(uuid, integer) to authenticated;
grant execute on function public.estado_odoo_cliente(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
