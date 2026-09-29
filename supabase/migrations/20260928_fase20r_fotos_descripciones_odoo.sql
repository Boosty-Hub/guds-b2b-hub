-- ════════════════════════════════════════════════════════════════════════
-- Fase 20r · Fotos y descripciones de producto bidireccionales con Odoo (decisión 15 del dueño, 28-sep)
--   Se editan en GUDS y se escriben en Odoo; lo que cambie en Odoo llega a GUDS. La escritura en Odoo se limita a
--   product.template: imagen (image_1920) y descripción de venta (description_sale). Gana el cambio más reciente.
--
--   Cómo se decide (por campo: foto principal y descripción):
--     · productos.<campo>_origen / <campo>_actualizada_en: de dónde vino el valor actual de GUDS ('guds' | 'odoo') y cuándo
--       cambió (en GUDS: cuando lo editó administración; desde Odoo: el write_date del adjunto de la imagen o de la plantilla).
--     · Huella de lo último que se vio (o se escribió) en Odoo: imagen_odoo_checksum (checksum del adjunto image_1920; null =
--       Odoo sin imagen) + imagen_odoo_url (la URL de GUDS cuyo contenido tiene Odoo) y descripcion_odoo_md5.
--     · Sincronización (Odoo → GUDS): si la huella de Odoo cambió, gana Odoo salvo que GUDS tenga un cambio propio más reciente
--       (origen 'guds' y fecha posterior al cambio de Odoo). Solo se descargan las imágenes que cambiaron.
--     · Escritura (GUDS → Odoo, cola odoo_escrituras tipo 'producto'): se envía el estado actual de GUDS de los campos con
--       origen 'guds' que difieren de la huella de Odoo; si Odoo cambió ese campo después, gana Odoo y no se envía. Al escribir
--       se guarda la huella nueva de Odoo, así lo que escribió GUDS no vuelve como "cambio de Odoo".
--     · Sin bucles: la sincronización y el escritor de la cola no pasan por PostgREST (no traen request.jwt.claims) y además
--       escriben en modo réplica; los disparadores de esta fase solo actúan en cambios hechos por un usuario.
--   Nunca se borra nada en Odoo: quitar la foto en GUDS no se envía (en Odoo eso borraría el adjunto de la imagen).
--   Modo en configuracion.odoo_escritura_productos: 'simular' (arma el envío sin escribir) o 'activo'. Solo lo lee
--   administración (clave odoo_%).
-- ════════════════════════════════════════════════════════════════════════
begin;

-- ── Columnas ─────────────────────────────────────────────────────────────
alter table public.productos
  add column if not exists imagen_actualizada_en timestamptz,
  add column if not exists imagen_origen text,
  add column if not exists imagen_odoo_checksum text,
  add column if not exists imagen_odoo_url text,
  add column if not exists descripcion_actualizada_en timestamptz,
  add column if not exists descripcion_origen text,
  add column if not exists descripcion_odoo_md5 text;
alter table public.productos drop constraint if exists productos_imagen_origen_check;
alter table public.productos add constraint productos_imagen_origen_check check (imagen_origen in ('guds', 'odoo'));
alter table public.productos drop constraint if exists productos_descripcion_origen_check;
alter table public.productos add constraint productos_descripcion_origen_check check (descripcion_origen in ('guds', 'odoo'));
comment on column public.productos.imagen_origen is 'De dónde vino la foto principal actual: guds (la cambió administración) u odoo (la trajo la sincronización); null = anterior a la sincronización (20r)';
comment on column public.productos.imagen_actualizada_en is 'Cuándo cambió la foto principal (en GUDS o, si vino de Odoo, el write_date del adjunto en Odoo)';
comment on column public.productos.imagen_odoo_checksum is 'Checksum del adjunto image_1920 de la plantilla en Odoo visto o escrito por última vez (null = Odoo sin imagen)';
comment on column public.productos.imagen_odoo_url is 'URL de GUDS cuyo contenido tiene Odoo como imagen (la que se trajo o se envió)';
comment on column public.productos.descripcion_origen is 'De dónde vino la descripción actual: guds u odoo (description_sale); null = anterior a la sincronización (20r)';
comment on column public.productos.descripcion_actualizada_en is 'Cuándo cambió la descripción (en GUDS o, si vino de Odoo, el write_date de la plantilla)';
comment on column public.productos.descripcion_odoo_md5 is 'md5 de la descripción de venta de Odoo vista o escrita por última vez (null = vacía)';
-- Estado de hoy: en Odoo no hay imágenes ni descripciones de venta en las plantillas (verificado el 28-sep), así que las huellas
-- quedan vacías. Las 2 fotos que ya había en GUDS quedan con origen null: no se envían a Odoo salvo que se editen o se envíen
-- a mano (enviar_producto_odoo).

-- ── Cola: tipo nuevo y modo ──────────────────────────────────────────────
alter table public.odoo_escrituras drop constraint if exists odoo_escrituras_tipo_check;
alter table public.odoo_escrituras add constraint odoo_escrituras_tipo_check
  check (tipo in ('entrega_estado', 'cliente_contacto', 'cliente_direccion', 'producto'));
comment on table public.odoo_escrituras is 'Registro y cola de lo que GUDS escribe en Odoo (estado de entregas, contacto y direcciones de clientes, foto y descripción de productos)';
insert into public.configuracion (clave, valor, descripcion)
values ('odoo_escritura_productos', 'simular', 'Foto y descripción de productos hacia Odoo: simular (no escribe) o activo')
on conflict (clave) do nothing;

-- ── Reglas internas ──────────────────────────────────────────────────────
-- ¿Gana el cambio de Odoo? Sí, salvo que el valor de GUDS lo haya puesto GUDS después del cambio de Odoo (empate: Odoo).
-- Sin fecha del cambio de Odoo no se decide (false).
create or replace function public.contenido_odoo_gana(p_origen text, p_guds_en timestamptz, p_odoo_en timestamptz)
returns boolean language sql immutable set search_path = public as $$
  select p_odoo_en is not null and (p_origen is distinct from 'guds' or p_guds_en is null or p_odoo_en >= p_guds_en)
$$;

-- Galería con una foto principal nueva: quita la principal anterior (y la nueva, si ya estaba) y pone la nueva primero.
-- Sin galería, la principal vive solo en imagen_url ('[]'). Máximo 4 fotos, como en el admin.
create or replace function public.imagenes_con_principal(p_imagenes jsonb, p_anterior text, p_nueva text)
returns jsonb language sql immutable set search_path = public as $$
  with actuales as (
    select e.v, e.i from jsonb_array_elements_text(case when jsonb_typeof(p_imagenes) = 'array' then p_imagenes else '[]'::jsonb end)
      with ordinality e(v, i)
  )
  select case when not exists (select 1 from actuales) then '[]'::jsonb
    else coalesce((select jsonb_agg(z.v order by z.o, z.i) from (
        select y.v, y.o, y.i from (
          select p_nueva v, 0 o, 0::bigint i where p_nueva is not null
          union all
          select a.v, 1, a.i from actuales a where a.v is distinct from p_anterior and a.v is distinct from p_nueva
        ) y order by y.o, y.i limit 4) z), '[]'::jsonb)
  end
$$;

-- Descripciones de Odoo → GUDS. p_filas: [{odoo_id, descripcion, cambio_en}] de todas las plantillas leídas (descripcion
-- null = vacía en Odoo; cambio_en = write_date de la plantilla). Solo mira las filas cuya huella cambió.
-- Devuelve cuántas trajo, cuántas ya coincidían y cuántas conserva GUDS por ser más recientes (se envían por la cola).
create or replace function public.sincronizar_descripciones_odoo(p_filas jsonb, p_aplicar boolean default true)
returns jsonb language plpgsql set search_path = public as $$
declare v_prev text := current_setting('session_replication_role'); r jsonb;
begin
  -- Sin disparadores (como el resto de la sincronización)
  if p_aplicar then execute 'set local session_replication_role = replica'; end if;
  with x as (
    select x.odoo_id, nullif(btrim(x.descripcion), '') descripcion, x.cambio_en
    from jsonb_to_recordset(coalesce(p_filas, '[]'::jsonb)) x(odoo_id int, descripcion text, cambio_en timestamptz)
  ), c as (
    select p.id, x.descripcion, md5(x.descripcion) huella, x.cambio_en,
      case when x.descripcion is not distinct from nullif(btrim(p.descripcion), '') then 'igual'
           when public.contenido_odoo_gana(p.descripcion_origen, p.descripcion_actualizada_en, x.cambio_en) then 'odoo'
           else 'guds' end decision
    from x join productos p on p.odoo_id = x.odoo_id
    where md5(x.descripcion) is distinct from p.descripcion_odoo_md5
  ), u as (
    update productos p set descripcion_odoo_md5 = c.huella,
      descripcion = case when c.decision = 'odoo' then c.descripcion else p.descripcion end,
      descripcion_origen = case when c.decision = 'odoo' then 'odoo' else p.descripcion_origen end,
      descripcion_actualizada_en = case when c.decision = 'odoo' then c.cambio_en else p.descripcion_actualizada_en end,
      updated_at = case when c.decision = 'odoo' then now() else p.updated_at end
    from c where p_aplicar and p.id = c.id and c.decision in ('igual', 'odoo')
    returning p.id
  )
  select jsonb_build_object('traidas', count(*) filter (where decision = 'odoo'), 'iguales', count(*) filter (where decision = 'igual'),
    'guds_mas_reciente', count(*) filter (where decision = 'guds'), 'escritas', (select count(*) from u)) into r from c;
  if p_aplicar then execute format('set local session_replication_role = %s', v_prev); end if;
  return r;
end $$;

-- Imágenes de Odoo → GUDS, paso 1: qué hacer con cada plantilla cuya huella cambió. p_adjuntos: [{odoo_id, checksum,
-- mimetype, cambio_en}] de todas las plantillas leídas (checksum null = sin imagen; cambio_en = write_date del adjunto o, si
-- no hay imagen, el de la plantilla). accion: traer | quitar | guds_mas_reciente (GUDS cambió después: se conserva).
create or replace function public.decidir_imagenes_odoo(p_adjuntos jsonb)
returns table (producto_id uuid, odoo_id integer, accion text, checksum text, mimetype text, cambio_en timestamptz,
  url_previa text, checksum_previo text, odoo_url_previa text)
language sql stable set search_path = public as $$
  select p.id, p.odoo_id,
    case when not public.contenido_odoo_gana(p.imagen_origen, p.imagen_actualizada_en, x.cambio_en) then 'guds_mas_reciente'
         when x.checksum is null then 'quitar' else 'traer' end,
    x.checksum, x.mimetype, x.cambio_en, p.imagen_url, p.imagen_odoo_checksum, p.imagen_odoo_url
  from (select x.odoo_id, nullif(x.checksum, '') checksum, x.mimetype, x.cambio_en
        from jsonb_to_recordset(coalesce(p_adjuntos, '[]'::jsonb)) x(odoo_id int, checksum text, mimetype text, cambio_en timestamptz)) x
  join productos p on p.odoo_id = x.odoo_id
  where x.checksum is distinct from p.imagen_odoo_checksum and x.cambio_en is not null
  order by x.cambio_en desc
$$;

-- Imágenes de Odoo → GUDS, paso 2 (después de subir las traídas al bucket): aplica traer/quitar si el producto no cambió
-- mientras tanto. Devuelve cuántas aplicó y las URL de copias de Odoo que ya nadie usa (para borrarlas del bucket).
create or replace function public.aplicar_imagenes_odoo(p_cambios jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare v_prev text := current_setting('session_replication_role'); r jsonb;
begin
  execute 'set local session_replication_role = replica';
  with x as (
    select * from jsonb_to_recordset(coalesce(p_cambios, '[]'::jsonb)) x(producto_id uuid, accion text, checksum text, url text,
      cambio_en timestamptz, url_previa text, checksum_previo text, odoo_url_previa text)
    where x.accion in ('traer', 'quitar') and (x.accion = 'quitar' or (x.url is not null and x.checksum is not null))
  ), u as (
    update productos p set
      imagenes = public.imagenes_con_principal(p.imagenes, p.imagen_url, case when x.accion = 'traer' then x.url end),
      imagen_url = case when x.accion = 'traer' then x.url else public.imagenes_con_principal(p.imagenes, p.imagen_url, null) ->> 0 end,
      imagen_odoo_checksum = case when x.accion = 'traer' then x.checksum end,
      imagen_odoo_url = case when x.accion = 'traer' then x.url end,
      imagen_origen = 'odoo', imagen_actualizada_en = x.cambio_en, updated_at = now()
    from x
    where p.id = x.producto_id and p.imagen_url is not distinct from x.url_previa and p.imagen_odoo_checksum is not distinct from x.checksum_previo
    returning p.id, x.odoo_url_previa, p.imagen_url, p.imagenes
  )
  select jsonb_build_object('aplicadas', count(*), 'omitidas', (select count(*) from x) - count(*),
    'sin_uso', coalesce(jsonb_agg(u.odoo_url_previa) filter (where u.odoo_url_previa is not null
      and u.odoo_url_previa is distinct from u.imagen_url and not coalesce(u.imagenes, '[]'::jsonb) ? u.odoo_url_previa), '[]'::jsonb))
  into r from u;
  execute format('set local session_replication_role = %s', v_prev);
  return r;
end $$;

revoke execute on function public.contenido_odoo_gana(text, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.imagenes_con_principal(jsonb, text, text) from public, anon, authenticated;
revoke execute on function public.sincronizar_descripciones_odoo(jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.decidir_imagenes_odoo(jsonb) from public, anon, authenticated;
revoke execute on function public.aplicar_imagenes_odoo(jsonb) from public, anon, authenticated;

-- ── Permiso y cola ───────────────────────────────────────────────────────
-- Quién envía fotos y descripciones a Odoo: personal de administración con permiso para editar productos
create or replace function public.puede_editar_producto_odoo()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and public.es_personal_admin() and public.puede('productos', 'editar')
$$;
revoke execute on function public.puede_editar_producto_odoo() from public, anon;
grant execute on function public.puede_editar_producto_odoo() to authenticated;

-- Encola (o completa la que aún espera) la escritura de un producto. El escritor envía el estado ACTUAL del producto, así que
-- una fila pendiente basta para varios cambios seguidos. Interna: la llaman el disparador y enviar_producto_odoo.
create or replace function public.encolar_escritura_producto(p_producto_id uuid, p_campos text[])
returns uuid language plpgsql security definer set search_path = public as $$
declare v_p record; v_id uuid;
begin
  select id, odoo_id, empresa_id, nombre, imagen_url, left(descripcion, 300) descripcion into v_p from productos where id = p_producto_id;
  if not found or v_p.odoo_id is null then return null; end if;
  select id into v_id from odoo_escrituras where tipo = 'producto' and referencia_id = p_producto_id and estado = 'pendiente'
    order by created_at desc limit 1 for update;
  if v_id is not null then
    update odoo_escrituras set datos = datos
      || jsonb_build_object('campos', (select coalesce(jsonb_agg(distinct c), '[]'::jsonb)
           from (select jsonb_array_elements_text(coalesce(datos -> 'campos', '[]'::jsonb)) c union select unnest(p_campos)) z),
         'imagen_url', v_p.imagen_url, 'descripcion', v_p.descripcion)
    where id = v_id;
    return v_id;
  end if;
  return public.encolar_escritura_odoo('producto', p_producto_id, jsonb_build_object(
    'producto_id', p_producto_id, 'nombre', v_p.nombre, 'campos', to_jsonb(p_campos),
    'imagen_url', v_p.imagen_url, 'descripcion', v_p.descripcion), v_p.empresa_id);
end $$;
revoke execute on function public.encolar_escritura_producto(uuid, text[]) from public, anon, authenticated;

-- ── Disparadores ─────────────────────────────────────────────────────────
-- Antes de guardar un cambio hecho por un usuario: sella de dónde y cuándo cambió la foto principal / la descripción y
-- protege las huellas de Odoo (solo las escriben la sincronización y el escritor de la cola, que no pasan por aquí).
create or replace function public.trg_producto_contenido_odoo()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '') <> 'authenticated' then return new; end if;
  if coalesce(current_setting('guds.contenido_odoo', true), '') = 'on' then return new; end if;   -- enviar_producto_odoo
  new.imagen_odoo_checksum := old.imagen_odoo_checksum;
  new.imagen_odoo_url := old.imagen_odoo_url;
  new.descripcion_odoo_md5 := old.descripcion_odoo_md5;
  new.imagen_origen := old.imagen_origen;
  new.imagen_actualizada_en := old.imagen_actualizada_en;
  new.descripcion_origen := old.descripcion_origen;
  new.descripcion_actualizada_en := old.descripcion_actualizada_en;
  if new.imagen_url is distinct from old.imagen_url then
    new.imagen_origen := 'guds';
    new.imagen_actualizada_en := now();
  end if;
  new.descripcion := nullif(btrim(new.descripcion), '');
  if new.descripcion is distinct from nullif(btrim(old.descripcion), '') then
    if length(new.descripcion) > 5000 then
      raise exception 'La descripción es demasiado larga (máximo 5000 caracteres).' using errcode = '22023';
    end if;
    new.descripcion_origen := 'guds';
    new.descripcion_actualizada_en := now();
  end if;
  return new;
end $$;
drop trigger if exists d_producto_contenido_odoo on public.productos;
create trigger d_producto_contenido_odoo before update on public.productos
  for each row execute function public.trg_producto_contenido_odoo();

-- Después: si administración cambió la foto principal (a otra, no quitarla) o la descripción de un producto de Odoo, encola
-- la escritura. Los cambios de la sincronización no traen request.jwt.claims (y van en modo réplica): no encolan.
create or replace function public.trg_producto_contenido_odoo_encolar()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_campos text[] := '{}';
begin
  if new.odoo_id is null then return null; end if;
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '') <> 'authenticated' then return null; end if;
  if coalesce(current_setting('guds.contenido_odoo', true), '') = 'on' then return null; end if;
  if new.imagen_url is distinct from old.imagen_url and new.imagen_url is not null then v_campos := v_campos || 'imagen'::text; end if;
  if new.descripcion is distinct from old.descripcion then v_campos := v_campos || 'descripcion'::text; end if;
  if cardinality(v_campos) = 0 or not public.puede_editar_producto_odoo() then return null; end if;
  perform public.encolar_escritura_producto(new.id, v_campos);
  return null;
end $$;
drop trigger if exists producto_contenido_odoo_encolar on public.productos;
create trigger producto_contenido_odoo_encolar after update of imagen_url, descripcion on public.productos
  for each row when (old.imagen_url is distinct from new.imagen_url or old.descripcion is distinct from new.descripcion)
  execute function public.trg_producto_contenido_odoo_encolar();
revoke execute on function public.trg_producto_contenido_odoo() from public, anon, authenticated;
revoke execute on function public.trg_producto_contenido_odoo_encolar() from public, anon, authenticated;

-- ── Acciones del admin ───────────────────────────────────────────────────
-- Envía a Odoo la foto principal y/o la descripción que tiene GUDS y Odoo no (p. ej. fotos cargadas antes de esta fase).
-- La descripción solo se envía si GUDS tiene una (vaciarla en Odoo solo pasa al editarla).
create or replace function public.enviar_producto_odoo(p_producto_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v record; v_campos text[] := '{}';
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión.' using errcode = '42501'; end if;
  if not public.puede_editar_producto_odoo() then
    raise exception 'No tienes permiso para enviar productos a Odoo.' using errcode = '42501';
  end if;
  select id, odoo_id, imagen_url, imagen_odoo_url, nullif(btrim(descripcion), '') descripcion, descripcion_odoo_md5 into v
  from productos where id = p_producto_id and (empresa_id is null or empresa_id = any (public.empresas_visibles()));
  if not found then raise exception 'Producto no encontrado.' using errcode = 'P0002'; end if;
  if v.odoo_id is null then raise exception 'Este producto no está vinculado a Odoo.' using errcode = 'P0001'; end if;
  if v.imagen_url is not null and v.imagen_url is distinct from v.imagen_odoo_url then v_campos := v_campos || 'imagen'::text; end if;
  if v.descripcion is not null and md5(v.descripcion) is distinct from v.descripcion_odoo_md5 then v_campos := v_campos || 'descripcion'::text; end if;
  if cardinality(v_campos) = 0 then raise exception 'La foto y la descripción ya coinciden con Odoo.' using errcode = 'P0001'; end if;
  if exists (select 1 from odoo_escrituras where tipo = 'producto' and referencia_id = p_producto_id and estado = 'procesando'
             and created_at > now() - interval '15 minutes') then
    raise exception 'Ya hay un envío de este producto en curso. Espera su resultado.' using errcode = 'P0001';
  end if;
  -- Lo que se envía pasa a ser "cambio de GUDS" ahora (gana frente a cambios anteriores de Odoo)
  perform set_config('guds.contenido_odoo', 'on', true);
  update productos set
    imagen_origen = case when 'imagen' = any (v_campos) then 'guds' else imagen_origen end,
    imagen_actualizada_en = case when 'imagen' = any (v_campos) then now() else imagen_actualizada_en end,
    descripcion_origen = case when 'descripcion' = any (v_campos) then 'guds' else descripcion_origen end,
    descripcion_actualizada_en = case when 'descripcion' = any (v_campos) then now() else descripcion_actualizada_en end
  where id = p_producto_id;
  perform set_config('guds.contenido_odoo', '', true);
  return public.encolar_escritura_producto(p_producto_id, v_campos);
end $$;

-- Vuelve a disparar un envío de producto que terminó con error
create or replace function public.reintentar_escritura_producto(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_e record;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión.' using errcode = '42501'; end if;
  if not public.puede_editar_producto_odoo() then
    raise exception 'No tienes permiso para enviar productos a Odoo.' using errcode = '42501';
  end if;
  select e.id, e.estado into v_e from odoo_escrituras e join productos p on p.id = e.referencia_id
  where e.id = p_id and e.tipo = 'producto' and (p.empresa_id is null or p.empresa_id = any (public.empresas_visibles()));
  if not found then raise exception 'Envío no encontrado.' using errcode = 'P0002'; end if;
  if v_e.estado <> 'error' then raise exception 'Solo se reintentan los envíos que terminaron con error.' using errcode = 'P0001'; end if;
  perform public.disparar_escritura_odoo(p_id);
  return p_id;
end $$;

revoke execute on function public.enviar_producto_odoo(uuid) from public, anon;
revoke execute on function public.reintentar_escritura_producto(uuid) from public, anon;
grant execute on function public.enviar_producto_odoo(uuid) to authenticated;
grant execute on function public.reintentar_escritura_producto(uuid) to authenticated;

create index if not exists odoo_escrituras_producto on public.odoo_escrituras (referencia_id, created_at desc) where tipo = 'producto';

notify pgrst, 'reload schema';

commit;
