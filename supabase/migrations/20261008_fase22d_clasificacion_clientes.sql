-- ════════════════════════════════════════════════════════════════════════
-- Fase 22d · Clasificación de clientes de finanzas → Odoo (docs/PLAN-REPORTES-FINANZAS.md, D5; decisión del 8-oct: opción A)
--   La taxonomía de finanzas pasa a ser la oficial y se guarda en Odoo reutilizando campos vacíos de res.partner:
--     · Industria (industry_id → res.partner.industry)            = tipo de cliente
--     · Canal de contacto (eu_partner_channel_id → eu.res.channel)  = canal (solo GUDS; Quirutec no usa canal)
--     · Segmento de contacto (eu_partner_segment_id → eu.res.segment) = categoría de cobranza
--   La sincronización ya los trae a clientes.tipo_cliente / canal / segmento (importar.js), que siguen protegidos por el
--   disparador del espejo: GUDS no los edita directo, los escribe en Odoo por la cola odoo_escrituras (tipo 'clasificacion',
--   escribir-clasificacion.js) y la sincronización los confirma.
--
--   · clasificacion_tipos: catálogo de finanzas por empresa (tipo → canal → categoría de cobranza), con los ids de los
--     valores en Odoo una vez creados o encontrados. Se edita en Configuración → Clasificación de clientes.
--   · clasificacion_clientes: la clasificación de cada cliente en GUDS: propuesta (carga inicial desde el Excel de finanzas
--     o regla fiable de Profit) → asignada (finanzas la revisó) → enviada a Odoo (escritura en la cola, resultado por cliente).
--     Lo que hay en Odoo es lo que manda: el estado "confirmada" sale de comparar con clientes.tipo_cliente/canal/segmento.
--   · RPC: clasificacion_clientes_lista, guardar_clasificacion_tipo, asignar_clasificacion, confirmar_clasificacion,
--     adoptar_clasificacion_odoo, enviar_clasificacion_odoo, preparar_catalogo_clasificacion_odoo, clasificacion_estado_odoo.
--     clasificacion_cargar_profit (interna): sugerencias de Profit (CADENAS → Cadena Moderno en GUDS, PARTICULAR →
--     Particular, en Quirutec DISTRIBUIDOR/CLINICA → Clínica / Distribuidor).
--   · Modo de escritura: configuracion.odoo_escritura_clasificacion = 'simular' (modo prueba: lee Odoo y registra el plan,
--     no escribe). Pasa a 'activo' solo cuando el dueño autorice la primera escritura real.
--   Permisos: módulo 'clasificacion_clientes' (ver; crear y editar = catálogo, asignar y enviar a Odoo). Administrador:
--   todo; Contador: ver, crear y editar. En «Ambas» solo se consulta. Nada para anon.
-- ════════════════════════════════════════════════════════════════════════
begin;

-- ── 0. Texto comparable (sin tildes, minúsculas, espacios simples): "Droguería" = "DROGUERIA " ──────────────
create or replace function public.clasif_norm(t text) returns text language sql immutable set search_path = public as $$
  select btrim(regexp_replace(lower(translate(coalesce(t, ''), 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU')), '\s+', ' ', 'g'));
$$;
revoke execute on function public.clasif_norm(text) from public, anon;
grant execute on function public.clasif_norm(text) to authenticated;

-- ── 1. Módulo y permisos ─────────────────────────────────────────────────
insert into public.modulos (codigo, nombre, descripcion, icono, orden, activo) values
  ('clasificacion_clientes', 'Clasificación de clientes',
   'Tipo de cliente, canal y categoría de cobranza de finanzas, guardados en Odoo (Editar = asignar y enviar a Odoo)', 'Tags', 24, true)
on conflict (codigo) do nothing;
insert into public.permisos (rol_id, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar)
select r.id, m.id, true, true, true, true from public.roles r, public.modulos m
where r.nombre = 'Administrador' and m.codigo = 'clasificacion_clientes'
on conflict (rol_id, modulo_id) do nothing;
insert into public.permisos (rol_id, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar)
select r.id, m.id, true, true, true, false from public.roles r, public.modulos m
where r.nombre = 'Contador' and m.codigo = 'clasificacion_clientes'
on conflict (rol_id, modulo_id) do nothing;

-- ── 2. Catálogo de finanzas por empresa ─────────────────────────────────
create table if not exists public.clasificacion_tipos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  tipo text not null,
  criterio text,
  canal text,
  categoria_cobranza text,
  orden integer not null default 0,
  activo boolean not null default true,
  por_confirmar boolean not null default false,
  nota text,
  odoo_industry_id integer,
  odoo_channel_id integer,
  odoo_segment_id integer,
  odoo_verificado_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.usuarios(id) on delete set null,
  constraint clasificacion_tipos_tipo_check check (btrim(tipo) <> '' and length(tipo) <= 100),
  constraint clasificacion_tipos_canal_check check (canal is null or (btrim(canal) <> '' and length(canal) <= 100)),
  constraint clasificacion_tipos_categoria_check check (categoria_cobranza is null or (btrim(categoria_cobranza) <> '' and length(categoria_cobranza) <= 100))
);
create unique index if not exists clasificacion_tipos_unico on public.clasificacion_tipos (empresa_id, public.clasif_norm(tipo));
comment on table public.clasificacion_tipos is 'Catálogo de clasificación de clientes de finanzas por empresa (22d): tipo → canal → categoría de cobranza. En Odoo: Industria, Canal de contacto y Segmento de contacto (catálogos compartidos por las dos compañías)';
comment on column public.clasificacion_tipos.por_confirmar is 'Tipo agregado por GUDS que finanzas aún no confirma (p. ej. Cines, E-commerce): sus clientes no se envían a Odoo hasta completarlo';
comment on column public.clasificacion_tipos.odoo_industry_id is 'res.partner.industry en Odoo con el nombre del tipo (lo llena el escritor al crearlo o encontrarlo)';
comment on column public.clasificacion_tipos.odoo_channel_id is 'eu.res.channel en Odoo con el nombre del canal';
comment on column public.clasificacion_tipos.odoo_segment_id is 'eu.res.segment en Odoo con el nombre de la categoría de cobranza';

alter table public.clasificacion_tipos enable row level security;
revoke all on public.clasificacion_tipos from anon;
revoke insert, update, delete on public.clasificacion_tipos from authenticated;
grant select on public.clasificacion_tipos to authenticated;
drop policy if exists clasificacion_tipos_ver on public.clasificacion_tipos;
create policy clasificacion_tipos_ver on public.clasificacion_tipos for select to authenticated
  using ((select public.puede('clasificacion_clientes', 'ver')) or (select public.puede('clientes', 'ver')) or (select public.puede('reportes', 'ver')));
drop policy if exists empresa_visible on public.clasificacion_tipos;
create policy empresa_visible on public.clasificacion_tipos as restrictive for all to authenticated
  using (empresa_id = any ((select public.empresas_visibles())::uuid[]));

-- ── 3. Clasificación de cada cliente en GUDS ────────────────────────────
create table if not exists public.clasificacion_clientes (
  cliente_id uuid primary key references public.clientes(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id),
  tipo_id uuid references public.clasificacion_tipos(id) on delete set null,
  origen text,
  estado text not null default 'propuesta',
  excel_texto text,
  excel_tipo_id uuid references public.clasificacion_tipos(id) on delete set null,
  excel_detalle jsonb,
  profit_tipo text,
  profit_segmento text,
  profit_categoria text,
  profit_tipo_id uuid references public.clasificacion_tipos(id) on delete set null,
  escritura_id uuid references public.odoo_escrituras(id) on delete set null,
  enviado_tipo_id uuid references public.clasificacion_tipos(id) on delete set null,
  enviado_at timestamptz,
  enviado_por uuid references public.usuarios(id) on delete set null,
  envio_estado text,
  envio_error text,
  envio_detalle jsonb,
  envio_procesado_at timestamptz,
  revisado_por uuid references public.usuarios(id) on delete set null,
  revisado_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clasificacion_clientes_origen_check check (origen is null or origen in ('excel', 'profit', 'manual', 'odoo')),
  constraint clasificacion_clientes_estado_check check (estado in ('propuesta', 'asignada')),
  constraint clasificacion_clientes_envio_check check (envio_estado is null or envio_estado in ('pendiente', 'simulada', 'hecha', 'error'))
);
create index if not exists clasificacion_clientes_empresa on public.clasificacion_clientes (empresa_id);
create index if not exists clasificacion_clientes_tipo on public.clasificacion_clientes (tipo_id);
create index if not exists clasificacion_clientes_escritura on public.clasificacion_clientes (escritura_id);
comment on table public.clasificacion_clientes is 'Clasificación de finanzas de cada cliente en GUDS (22d): propuesta (Excel de finanzas / Profit) → asignada (revisada) → enviada a Odoo por la cola. El valor oficial es el de Odoo (clientes.tipo_cliente/canal/segmento)';
comment on column public.clasificacion_clientes.estado is 'propuesta = carga automática sin revisar; asignada = finanzas la confirmó o la eligió (se puede enviar a Odoo)';
comment on column public.clasificacion_clientes.excel_detalle is 'Lo que dice el Excel de finanzas: filas, cómo se emparejó por nombre, categoría y la letra interna de Quirutec (cat_interna_ventas, pendiente de decidir)';
comment on column public.clasificacion_clientes.envio_estado is 'Resultado del último envío a Odoo para este cliente (lo escribe escribir-clasificacion.js): pendiente, simulada (modo prueba), hecha o error';

-- El tipo debe ser del catálogo de la misma empresa que el cliente
create or replace function public.trg_clasificacion_cliente_empresa() returns trigger language plpgsql set search_path = public as $$
declare v uuid;
begin
  foreach v in array array[new.tipo_id, new.excel_tipo_id, new.profit_tipo_id, new.enviado_tipo_id] loop
    if v is not null and not exists (select 1 from clasificacion_tipos t where t.id = v and t.empresa_id = new.empresa_id) then
      raise exception 'El tipo de cliente es del catálogo de otra empresa' using errcode = '22023';
    end if;
  end loop;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists clasificacion_cliente_empresa on public.clasificacion_clientes;
create trigger clasificacion_cliente_empresa before insert or update on public.clasificacion_clientes
  for each row execute function public.trg_clasificacion_cliente_empresa();

alter table public.clasificacion_clientes enable row level security;
revoke all on public.clasificacion_clientes from anon;
revoke insert, update, delete on public.clasificacion_clientes from authenticated;
grant select on public.clasificacion_clientes to authenticated;
drop policy if exists clasificacion_clientes_ver on public.clasificacion_clientes;
create policy clasificacion_clientes_ver on public.clasificacion_clientes for select to authenticated
  using ((select public.puede('clasificacion_clientes', 'ver')) or (select public.puede('clientes', 'ver')));
drop policy if exists empresa_visible on public.clasificacion_clientes;
create policy empresa_visible on public.clasificacion_clientes as restrictive for all to authenticated
  using (empresa_id = any ((select public.empresas_visibles())::uuid[]));

-- ── 4. Cola de escrituras: tipo 'clasificacion' (se conserva la lista actual) y modo prueba ──────────────────
do $$
declare v_tipos text[];
begin
  -- Los valores entre comillas, en cualquiera de los dos formatos: ARRAY['a'::text, 'b'::text] o '{a,b}'::text[]
  select array_agg(distinct x) into v_tipos
  from pg_constraint c, lateral regexp_matches(pg_get_constraintdef(c.oid), '''([^'']*)''', 'g') m,
    lateral regexp_split_to_table(m[1], '[^a-z_]+') x
  where c.conrelid = 'public.odoo_escrituras'::regclass and c.conname = 'odoo_escrituras_tipo_check' and x <> '';
  v_tipos := coalesce(v_tipos, array['entrega_estado', 'cliente_contacto', 'cliente_direccion']);
  if not ('clasificacion' = any (v_tipos)) then v_tipos := array_append(v_tipos, 'clasificacion'); end if;
  alter table public.odoo_escrituras drop constraint if exists odoo_escrituras_tipo_check;
  -- Mismo formato que las migraciones anteriores (ARRAY['a'::text, …]) para que otras puedan leerlo igual
  execute format('alter table public.odoo_escrituras add constraint odoo_escrituras_tipo_check check (tipo = any (array[%s]::text[]))',
    (select string_agg(quote_literal(x), ', ' order by x) from unnest(v_tipos) x));
end $$;

insert into public.configuracion (clave, valor, tipo, descripcion) values
  ('odoo_escritura_clasificacion', 'simular', 'string',
   'Clasificación de clientes de finanzas → Odoo (22d): simular = modo prueba (lee Odoo y registra lo que haría, no escribe); activo = escribe')
on conflict (clave) do nothing;

-- ── 5. Lista de clientes con su clasificación, actividad y estado ───────
create or replace function public.clasificacion_clientes_lista(p_cliente uuid default null)
returns table (
  cliente_id uuid, empresa_id uuid, empresa text, codigo text, nombre text, rif text, odoo_id integer, es_empleado boolean,
  vendedor_id uuid, vendedor text, ventas_odoo_usd numeric, ultima_factura date, deuda_usd numeric, ventas_profit_usd numeric,
  ultima_profit date, con_actividad boolean,
  odoo_tipo text, odoo_canal text, odoo_segmento text, odoo_tipo_id uuid,
  tipo_id uuid, tipo text, canal text, categoria text, tipo_por_confirmar boolean, origen text, estado_asignacion text,
  excel_texto text, excel_tipo_id uuid, excel_tipo text, excel_detalle jsonb,
  profit_tipo text, profit_segmento text, profit_categoria text, profit_tipo_id uuid,
  escritura_id uuid, enviado_at timestamptz, envio_estado text, envio_error text, envio_detalle jsonb,
  revisado_at timestamptz, revisado_por text, estado text
)
language plpgsql stable security definer set search_path = public as $$
declare v_lote bigint := public.profit_lote_vigente();
begin
  if auth.uid() is null then raise exception 'Sin sesión' using errcode = '42501'; end if;
  if not (public.puede('clasificacion_clientes', 'ver') or (p_cliente is not null and public.puede('clientes', 'ver'))) then
    raise exception 'No tienes permiso para ver la clasificación de clientes' using errcode = '42501';
  end if;
  return query
  with cli as (
    select c.* from clientes c
    where c.empresa_id = any (public.empresas_visibles()) and (p_cliente is null or c.id = p_cliente)
  ), fac as (
    select f.cliente_id,
      coalesce(sum(f.total_usd) filter (where not coalesce(f.es_saldo_inicial, false)), 0) ventas,
      max(f.fecha_emision) filter (where not coalesce(f.es_saldo_inicial, false) and f.tipo = 'factura') ultima,
      coalesce(sum(f.saldo_usd), 0) deuda
    from facturas f join cli on cli.id = f.cliente_id
    where f.estado = 'posted'
    group by 1
  ), vh as (
    select v.cliente_id, sum(v.neto_usd) ventas, max(v.fecha) ultima
    from ventas_historicas v join cli on cli.id = v.cliente_id
    where v.lote = v_lote
    group by 1
  ), base as (
    select cli.id, cli.empresa_id, e.nombre_corto::text empresa, cli.codigo, cli.nombre_negocio::text nombre, cli.rif, cli.odoo_id,
      coalesce(cli.es_empleado, false) es_empleado, cli.vendedor_asignado_id,
      coalesce(nullif(btrim(concat_ws(' ', u.nombre, u.apellido)), ''), cli.vendedor_odoo) vendedor,
      round(coalesce(fac.ventas, 0), 2) ventas, fac.ultima, round(coalesce(fac.deuda, 0), 2) deuda,
      round(coalesce(vh.ventas, 0), 2) ventas_profit, vh.ultima ultima_profit,
      cli.tipo_cliente, cli.canal, cli.segmento,
      (select t2.id from clasificacion_tipos t2 where t2.empresa_id = cli.empresa_id and public.clasif_norm(t2.tipo) = public.clasif_norm(cli.tipo_cliente) limit 1) odoo_tipo_id,
      cc.tipo_id, t.tipo, t.canal t_canal, t.categoria_cobranza, t.por_confirmar or not t.activo por_confirmar, cc.origen, cc.estado,
      cc.excel_texto, cc.excel_tipo_id, tx.tipo excel_tipo, cc.excel_detalle,
      cc.profit_tipo, cc.profit_segmento, cc.profit_categoria, cc.profit_tipo_id,
      cc.escritura_id, cc.enviado_at, cc.envio_estado, cc.envio_error, cc.envio_detalle, cc.enviado_tipo_id,
      cc.revisado_at, nullif(btrim(concat_ws(' ', ur.nombre, ur.apellido)), '') revisado_por,
      oe.estado escritura_estado, oe.error escritura_error,
      t.id is not null and public.clasif_norm(cli.tipo_cliente) = public.clasif_norm(t.tipo)
        and (t.canal is null or public.clasif_norm(cli.canal) = public.clasif_norm(t.canal))
        and (t.categoria_cobranza is null or public.clasif_norm(cli.segmento) = public.clasif_norm(t.categoria_cobranza)) coincide
    from cli
    join empresas e on e.id = cli.empresa_id
    left join usuarios u on u.id = cli.vendedor_asignado_id
    left join fac on fac.cliente_id = cli.id
    left join vh on vh.cliente_id = cli.id
    left join clasificacion_clientes cc on cc.cliente_id = cli.id
    left join clasificacion_tipos t on t.id = cc.tipo_id
    left join clasificacion_tipos tx on tx.id = cc.excel_tipo_id
    left join usuarios ur on ur.id = cc.revisado_por
    left join odoo_escrituras oe on oe.id = cc.escritura_id
  )
  select b.id, b.empresa_id, b.empresa, b.codigo, b.nombre, b.rif, b.odoo_id, b.es_empleado,
    b.vendedor_asignado_id, b.vendedor, b.ventas, b.ultima, b.deuda, b.ventas_profit, b.ultima_profit,
    (b.ventas > 0 or b.deuda > 0.01),
    b.tipo_cliente, b.canal, b.segmento, b.odoo_tipo_id,
    b.tipo_id, b.tipo, b.t_canal, b.categoria_cobranza, coalesce(b.por_confirmar, false), b.origen, b.estado,
    b.excel_texto, b.excel_tipo_id, b.excel_tipo, b.excel_detalle,
    b.profit_tipo, b.profit_segmento, b.profit_categoria, b.profit_tipo_id,
    b.escritura_id, b.enviado_at, b.envio_estado, coalesce(b.envio_error, case when b.escritura_estado = 'error' then b.escritura_error end),
    b.envio_detalle, b.revisado_at, b.revisado_por,
    case
      when b.coincide then 'confirmada'
      when b.escritura_id is not null and b.tipo_id is not null and b.enviado_tipo_id = b.tipo_id then
        case coalesce(nullif(b.envio_estado, 'pendiente'), case when b.escritura_estado in ('error', 'simulada') then b.escritura_estado end, 'pendiente')
          when 'error' then 'error'
          when 'simulada' then 'simulada'
          when 'hecha' then 'cambiado_en_odoo'
          else 'enviando'
        end
      when b.tipo_id is not null and b.estado = 'propuesta' then 'propuesta'
      when b.tipo_id is not null then 'por_enviar'
      when coalesce(b.tipo_cliente, b.canal, b.segmento) is not null then 'solo_odoo'
      else 'sin_clasificar'
    end
  from base b
  order by b.empresa, b.nombre;
end $$;
revoke execute on function public.clasificacion_clientes_lista(uuid) from public, anon;
grant execute on function public.clasificacion_clientes_lista(uuid) to authenticated;

-- Quién llama y en qué empresa (para las acciones). Lanza si no puede.
create or replace function public.clasificacion_contexto(p_accion text) returns uuid language plpgsql stable security definer set search_path = public as $$
declare v_emp uuid := public.empresa_activa();
begin
  if auth.uid() is null then raise exception 'Sin sesión' using errcode = '42501'; end if;
  if not public.puede('clasificacion_clientes', p_accion) then
    raise exception 'No tienes permiso para cambiar la clasificación de clientes' using errcode = '42501';
  end if;
  if v_emp is null then
    raise exception 'Selecciona una empresa (GUDS o Quirutec) en el menú superior: en "Ambas empresas" solo se puede consultar.' using errcode = 'P0001';
  end if;
  return v_emp;
end $$;
revoke execute on function public.clasificacion_contexto(text) from public, anon, authenticated;

-- ── 6. Catálogo: crear / editar un tipo ─────────────────────────────────
create or replace function public.guardar_clasificacion_tipo(
  p_id uuid, p_tipo text, p_criterio text default null, p_canal text default null, p_categoria text default null,
  p_orden integer default null, p_activo boolean default true, p_por_confirmar boolean default false, p_nota text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.clasificacion_contexto(case when p_id is null then 'crear' else 'editar' end);
  v_yo uuid := (select id from usuarios where auth_id = auth.uid());
  v_tipo text := nullif(btrim(regexp_replace(coalesce(p_tipo, ''), '\s+', ' ', 'g')), '');
  v_canal text := nullif(btrim(regexp_replace(coalesce(p_canal, ''), '\s+', ' ', 'g')), '');
  v_cat text := nullif(btrim(regexp_replace(coalesce(p_categoria, ''), '\s+', ' ', 'g')), '');
  v_ant clasificacion_tipos;
  v_id uuid;
begin
  if v_tipo is null then raise exception 'Escribe el tipo de cliente' using errcode = '22023'; end if;
  if length(v_tipo) > 100 or length(coalesce(v_canal, '')) > 100 or length(coalesce(v_cat, '')) > 100 then
    raise exception 'Máximo 100 caracteres por nombre' using errcode = '22023';
  end if;
  if not coalesce(p_por_confirmar, false) and v_cat is null then
    raise exception 'Falta la categoría de cobranza (o márcalo "por confirmar")' using errcode = '22023';
  end if;
  if exists (select 1 from clasificacion_tipos t where t.empresa_id = v_emp and public.clasif_norm(t.tipo) = public.clasif_norm(v_tipo)
             and t.id is distinct from p_id) then
    raise exception 'Ya existe el tipo "%" en esta empresa', v_tipo using errcode = '23505';
  end if;
  if p_id is null then
    insert into clasificacion_tipos (empresa_id, tipo, criterio, canal, categoria_cobranza, orden, activo, por_confirmar, nota, updated_by)
    values (v_emp, v_tipo, nullif(btrim(p_criterio), ''), v_canal, v_cat,
      coalesce(p_orden, (select coalesce(max(orden), 0) + 10 from clasificacion_tipos where empresa_id = v_emp)),
      coalesce(p_activo, true), coalesce(p_por_confirmar, false), nullif(btrim(p_nota), ''), v_yo)
    returning id into v_id;
    return v_id;
  end if;
  select * into v_ant from clasificacion_tipos where id = p_id;
  if not found then raise exception 'Tipo no encontrado' using errcode = 'P0002'; end if;
  if v_ant.empresa_id <> v_emp then raise exception 'El tipo es de otra empresa' using errcode = '42501'; end if;
  -- Si cambia un nombre, el valor de Odoo se vuelve a buscar o crear con el nombre nuevo (el anterior queda en Odoo: nunca se borra)
  update clasificacion_tipos set tipo = v_tipo, criterio = nullif(btrim(p_criterio), ''), canal = v_canal, categoria_cobranza = v_cat,
      orden = coalesce(p_orden, orden), activo = coalesce(p_activo, true), por_confirmar = coalesce(p_por_confirmar, false),
      nota = nullif(btrim(p_nota), ''), updated_at = now(), updated_by = v_yo,
      odoo_industry_id = case when v_tipo = v_ant.tipo then odoo_industry_id end,
      odoo_channel_id = case when v_canal is not distinct from v_ant.canal then odoo_channel_id end,
      odoo_segment_id = case when v_cat is not distinct from v_ant.categoria_cobranza then odoo_segment_id end
  where id = p_id;
  return p_id;
end $$;
revoke execute on function public.guardar_clasificacion_tipo(uuid, text, text, text, text, integer, boolean, boolean, text) from public, anon;
grant execute on function public.guardar_clasificacion_tipo(uuid, text, text, text, text, integer, boolean, boolean, text) to authenticated;

-- ── 7. Asignar (individual o masivo), confirmar propuestas, tomar el valor de Odoo ─────────────────────────
-- p_tipo null = quitar la asignación de GUDS (no toca Odoo).
create or replace function public.asignar_clasificacion(p_clientes uuid[], p_tipo uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.clasificacion_contexto('editar');
  v_yo uuid := (select id from usuarios where auth_id = auth.uid());
  v_t clasificacion_tipos;
  v_ajenos integer;
  n integer;
begin
  if coalesce(cardinality(p_clientes), 0) = 0 then return 0; end if;
  if cardinality(p_clientes) > 2000 then raise exception 'Demasiados clientes a la vez (máximo 2.000)' using errcode = '22023'; end if;
  if p_tipo is not null then
    select * into v_t from clasificacion_tipos where id = p_tipo;
    if not found then raise exception 'Tipo no encontrado' using errcode = 'P0002'; end if;
    if v_t.empresa_id <> v_emp then raise exception 'El tipo es de otra empresa' using errcode = '42501'; end if;
    if not v_t.activo then raise exception 'El tipo "%" está inactivo', v_t.tipo using errcode = 'P0001'; end if;
  end if;
  select count(*) into v_ajenos from unnest(p_clientes) x(id) left join clientes c on c.id = x.id
  where c.id is null or c.empresa_id is distinct from v_emp;
  if v_ajenos > 0 then raise exception 'Hay clientes de otra empresa o inexistentes (%)', v_ajenos using errcode = '22023'; end if;

  insert into clasificacion_clientes (cliente_id, empresa_id, tipo_id, origen, estado, revisado_por, revisado_at)
  select distinct x.id, v_emp, p_tipo, case when p_tipo is not null then 'manual' end,
    case when p_tipo is not null then 'asignada' else 'propuesta' end, v_yo, now()
  from unnest(p_clientes) x(id)
  on conflict (cliente_id) do update set
    tipo_id = excluded.tipo_id,
    -- Confirmar el mismo tipo que proponía el Excel o Profit conserva su origen
    origen = case when excluded.tipo_id is null then null
                  when clasificacion_clientes.tipo_id = excluded.tipo_id and clasificacion_clientes.origen is not null then clasificacion_clientes.origen
                  else 'manual' end,
    estado = excluded.estado, revisado_por = excluded.revisado_por, revisado_at = excluded.revisado_at;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.asignar_clasificacion(uuid[], uuid) from public, anon;
grant execute on function public.asignar_clasificacion(uuid[], uuid) to authenticated;

create or replace function public.confirmar_clasificacion(p_clientes uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.clasificacion_contexto('editar');
  v_yo uuid := (select id from usuarios where auth_id = auth.uid());
  n integer;
begin
  update clasificacion_clientes cc set estado = 'asignada', revisado_por = v_yo, revisado_at = now()
  from clasificacion_tipos t
  where cc.cliente_id = any (coalesce(p_clientes, '{}')) and cc.empresa_id = v_emp and cc.estado = 'propuesta'
    and t.id = cc.tipo_id and t.activo;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.confirmar_clasificacion(uuid[]) from public, anon;
grant execute on function public.confirmar_clasificacion(uuid[]) to authenticated;

-- Odoo manda: toma como asignación el tipo que el cliente ya tiene en Odoo (si existe en el catálogo de la empresa)
create or replace function public.adoptar_clasificacion_odoo(p_clientes uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.clasificacion_contexto('editar');
  v_yo uuid := (select id from usuarios where auth_id = auth.uid());
  n integer;
begin
  insert into clasificacion_clientes (cliente_id, empresa_id, tipo_id, origen, estado, revisado_por, revisado_at)
  select c.id, v_emp, t.id, 'odoo', 'asignada', v_yo, now()
  from clientes c
  join lateral (select t0.id from clasificacion_tipos t0 where t0.empresa_id = v_emp and t0.activo
                and public.clasif_norm(t0.tipo) = public.clasif_norm(c.tipo_cliente) limit 1) t on true
  where c.id = any (coalesce(p_clientes, '{}')) and c.empresa_id = v_emp
  on conflict (cliente_id) do update set tipo_id = excluded.tipo_id, origen = 'odoo', estado = 'asignada',
    revisado_por = excluded.revisado_por, revisado_at = excluded.revisado_at;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.adoptar_clasificacion_odoo(uuid[]) from public, anon;
grant execute on function public.adoptar_clasificacion_odoo(uuid[]) to authenticated;

-- ── 8. Enviar a Odoo (encola en odoo_escrituras, en partes de 25 clientes) ───────────────────────────────
-- Solo las asignaciones revisadas (estado 'asignada') de tipos completos. Se dispara la primera parte; el escritor
-- encadena las siguientes del mismo lote (y la sincronización reintenta lo que quede pendiente).
create or replace function public.enviar_clasificacion_odoo(p_clientes uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.clasificacion_contexto('editar');
  v_yo uuid := (select id from usuarios where auth_id = auth.uid());
  v_lote uuid := gen_random_uuid();
  v_ids uuid[];
  v_partes integer;
  v_fila uuid;
  v_primera uuid;
  v_omitidos jsonb;
  v_modo text := coalesce((select valor from configuracion where clave = 'odoo_escritura_clasificacion'), 'simular');
  i integer;
begin
  if coalesce(cardinality(p_clientes), 0) = 0 then return jsonb_build_object('encolados', 0, 'omitidos', '{}'::jsonb); end if;
  if cardinality(p_clientes) > 2000 then raise exception 'Demasiados clientes a la vez (máximo 2.000)' using errcode = '22023'; end if;

  with ev as (
    select x.id cliente_id, c.nombre_negocio nombre,
      case
        when c.id is null or c.empresa_id is distinct from v_emp then 'otra_empresa'
        when c.odoo_id is null then 'sin_odoo'
        when cc.tipo_id is null then 'sin_tipo'
        when cc.estado <> 'asignada' then 'sin_confirmar'
        when not t.activo or t.por_confirmar then 'tipo_por_confirmar'
        when t.categoria_cobranza is null then 'tipo_incompleto'
        when public.clasif_norm(c.tipo_cliente) = public.clasif_norm(t.tipo)
          and (t.canal is null or public.clasif_norm(c.canal) = public.clasif_norm(t.canal))
          and public.clasif_norm(c.segmento) = public.clasif_norm(t.categoria_cobranza) then 'ya_en_odoo'
        when oe.estado in ('pendiente', 'procesando') and cc.enviado_tipo_id = cc.tipo_id
          and oe.created_at > now() - interval '30 minutes' then 'en_curso'
      end motivo
    from (select distinct unnest(p_clientes) id) x
    left join clientes c on c.id = x.id
    left join clasificacion_clientes cc on cc.cliente_id = x.id
    left join clasificacion_tipos t on t.id = cc.tipo_id
    left join odoo_escrituras oe on oe.id = cc.escritura_id
  )
  select (select coalesce(jsonb_object_agg(s.motivo, s.n), '{}'::jsonb) from (select ev.motivo, count(*) n from ev where ev.motivo is not null group by 1) s),
         (select array_agg(ev.cliente_id order by ev.nombre) from ev where ev.motivo is null)
  into v_omitidos, v_ids;
  if v_ids is null then
    return jsonb_build_object('encolados', 0, 'omitidos', v_omitidos, 'modo', v_modo);
  end if;

  v_partes := ceil(cardinality(v_ids) / 25.0)::int;
  for i in 1 .. v_partes loop
    insert into odoo_escrituras (empresa_id, tipo, referencia_id, datos, solicitado_por)
    values (v_emp, 'clasificacion', v_lote, jsonb_build_object('accion', 'clientes', 'lote', v_lote, 'parte', i, 'partes', v_partes,
      'clientes', to_jsonb(v_ids[(i - 1) * 25 + 1 : i * 25])), v_yo)
    returning id into v_fila;
    if i = 1 then v_primera := v_fila; end if;
    update clasificacion_clientes set escritura_id = v_fila, enviado_tipo_id = tipo_id, enviado_at = now(), enviado_por = v_yo,
      envio_estado = 'pendiente', envio_error = null, envio_detalle = null, envio_procesado_at = null
    where cliente_id = any (v_ids[(i - 1) * 25 + 1 : i * 25]);
  end loop;
  perform public.disparar_escritura_odoo(v_primera);
  return jsonb_build_object('encolados', cardinality(v_ids), 'partes', v_partes, 'lote', v_lote, 'omitidos', v_omitidos, 'modo', v_modo);
end $$;
revoke execute on function public.enviar_clasificacion_odoo(uuid[]) from public, anon;
grant execute on function public.enviar_clasificacion_odoo(uuid[]) to authenticated;

-- Revisa (y en modo activo crea) en Odoo los valores del catálogo de la empresa activa, sin tocar clientes
create or replace function public.preparar_catalogo_clasificacion_odoo()
returns uuid language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.clasificacion_contexto('editar');
begin
  if exists (select 1 from odoo_escrituras where tipo = 'clasificacion' and referencia_id = v_emp and estado in ('pendiente', 'procesando')
             and created_at > now() - interval '15 minutes') then
    raise exception 'Ya hay una revisión del catálogo en curso' using errcode = 'P0001';
  end if;
  return public.encolar_escritura_odoo('clasificacion', v_emp, jsonb_build_object('accion', 'catalogo', 'empresa_id', v_emp), v_emp);
end $$;
revoke execute on function public.preparar_catalogo_clasificacion_odoo() from public, anon;
grant execute on function public.preparar_catalogo_clasificacion_odoo() to authenticated;

-- Modo de escritura y última revisión del catálogo por empresa (visible)
create or replace function public.clasificacion_estado_odoo()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not (public.puede('clasificacion_clientes', 'ver') or public.puede('clientes', 'ver')) then
    raise exception 'No tienes permiso para ver la clasificación de clientes' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'modo', coalesce((select valor from configuracion where clave = 'odoo_escritura_clasificacion'), 'simular'),
    'catalogo', coalesce((
      select jsonb_agg(jsonb_build_object('empresa_id', x.empresa_id, 'id', x.id, 'estado', x.estado, 'error', x.error,
        'resultado', x.resultado, 'created_at', x.created_at, 'procesado_at', x.procesado_at) order by x.created_at)
      from (select distinct on (o.empresa_id) o.* from odoo_escrituras o
            where o.tipo = 'clasificacion' and o.datos ->> 'accion' = 'catalogo' and o.empresa_id = any (public.empresas_visibles())
            order by o.empresa_id, o.created_at desc) x), '[]'::jsonb));
end $$;
revoke execute on function public.clasificacion_estado_odoo() from public, anon;
grant execute on function public.clasificacion_estado_odoo() to authenticated;

-- ── 9. Sugerencias de Profit (interna; la corre la carga inicial) ────────
-- Tipo dominante de Profit por cliente (por venta) y la regla fiable del análisis del 8-oct:
--   GUDS: CADENAS → categoría Cadena Moderno; PARTICULAR → tipo Particular (Resto).
--   Quirutec: DISTRIBUIDOR o CLINICA → categoría Clínica / Distribuidor; PARTICULAR → tipo Particular (Resto).
-- Solo propone un TIPO cuando la regla lo determina (PARTICULAR) y el cliente no tiene tipo; lo revisado no se toca.
create or replace function public.clasificacion_cargar_profit()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_lote bigint := public.profit_lote_vigente(); v_sug integer; v_prop integer;
begin
  with vh as (
    select v.cliente_id, upper(btrim(v.tipo_cliente)) tipo, upper(btrim(coalesce(v.segmento, ''))) seg, sum(abs(v.neto_usd)) peso, count(*) filas
    from ventas_historicas v join clientes c on c.id = v.cliente_id and c.empresa_id = v.empresa_id
    where v.lote = v_lote and nullif(btrim(v.tipo_cliente), '') is not null
    group by 1, 2, 3
  ), dom as (
    select distinct on (cliente_id) cliente_id, tipo, nullif(seg, '') seg from vh order by cliente_id, peso desc, filas desc
  ), sug as (
    select c.id cliente_id, c.empresa_id, d.tipo, d.seg,
      case when e.nombre_corto = 'GUDS' and d.tipo = 'CADENAS' then 'Cadena Moderno'
           when d.tipo = 'PARTICULAR' then 'Resto'
           when e.nombre_corto = 'Quirutec' and d.tipo in ('DISTRIBUIDOR', 'CLINICA') then 'Clínica / Distribuidor' end categoria,
      case when d.tipo = 'PARTICULAR' then (select t.id from clasificacion_tipos t where t.empresa_id = c.empresa_id
                                             and public.clasif_norm(t.tipo) = 'particular' and t.activo limit 1) end tipo_id
    from dom d join clientes c on c.id = d.cliente_id join empresas e on e.id = c.empresa_id
  )
  insert into clasificacion_clientes (cliente_id, empresa_id, profit_tipo, profit_segmento, profit_categoria, profit_tipo_id)
  select cliente_id, empresa_id, tipo, seg, categoria, tipo_id from sug
  on conflict (cliente_id) do update set profit_tipo = excluded.profit_tipo, profit_segmento = excluded.profit_segmento,
    profit_categoria = excluded.profit_categoria, profit_tipo_id = excluded.profit_tipo_id
  where (clasificacion_clientes.profit_tipo, clasificacion_clientes.profit_segmento, clasificacion_clientes.profit_categoria, clasificacion_clientes.profit_tipo_id)
    is distinct from (excluded.profit_tipo, excluded.profit_segmento, excluded.profit_categoria, excluded.profit_tipo_id);
  get diagnostics v_sug = row_count;

  update clasificacion_clientes set tipo_id = profit_tipo_id, origen = 'profit'
  where tipo_id is null and profit_tipo_id is not null and estado = 'propuesta' and revisado_at is null;
  get diagnostics v_prop = row_count;
  return jsonb_build_object('sugerencias', v_sug, 'propuestas_tipo', v_prop);
end $$;
revoke execute on function public.clasificacion_cargar_profit() from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
