-- ════════════════════════════════════════════════════════════════════════
-- Fase 20g · R1: histórico de ventas de Profit Plus en los reportes (docs/PLAN-PORTALES-Y-FLUJOS.md §7, decisión 6 del 28-sep)
--   "Importemos todo con el badge de Profit. Es solo data de lectura vieja: que aporte a todos los reportes; no afecta
--   las funcionalidades armadas con Odoo, que es el que está en funcionamiento real."
--
--   · ventas_historicas: una fila por línea de documento de Profit (dic-2020 → may-2026), extraída de la caché de las
--     tablas dinámicas del Excel "Reporte de Venta Consolidado" con scripts/importar-historico-profit.mjs. Solo lectura
--     para todos los usuarios (sin permisos de escritura y con un disparador que lo impide desde la API); lectura con el
--     permiso "reportes" y la empresa activa. El costo (último costo de Profit) solo lo lee el servidor: no se concede a
--     los usuarios de la API (se mostrará a administración en la fase de costo, R3).
--   · profit_documentos: resumen por documento (lo leen los reportes por mes, empresa, vendedor y cliente).
--   · Cargas por lote (profit_cargas): el script inserta un lote nuevo y al final lo publica (pasa a "vigente" en una
--     transacción corta); los reportes solo leen el lote vigente y el script borra los anteriores. Repetir la carga
--     reemplaza el histórico sin duplicar ni dejar huecos.
--   · Clientes y productos: se emparejan con GUDS al cargar (cliente por RIF normalizado, luego por nombre normalizado y
--     luego por un número de factura compartido con los saldos iniciales de Odoo; producto por código = sku). Sin pareja
--     quedan con el nombre y el RIF de Profit.
--   · profit_vendedores: equivalencia vendedor de Profit → vendedor de Odoo, propuesta por GUDS (nombres que coinciden
--     por palabras) y validada por administración desde Reportes → Histórico Profit.
--   · Venta neta de Profit (columna tratamiento):
--       venta        = facturas − devoluciones (líneas de productos)
--       financiera   = notas de crédito y de débito de Profit (descuentos, acuerdos comerciales, ajustes de precio,
--                      anulaciones, saldos migrados): no entran en la venta neta, se muestran aparte
--       nd_cambiaria = notas de débito por diferencial cambiario: fuera
--       reverso      = factura anulada por completo con una devolución o NC por el mismo total (mismo cliente): fuera,
--                      igual que en Odoo (19o)
--     La empresa PRUEBAS no se importa.
--   · reporte_ventas y reporte_reversos suman Profit a Odoo (parámetro p_fuente: ambas | odoo | profit) y devuelven la
--     columna fuente; la venta de Odoo (documentos_venta) no cambia.
-- ════════════════════════════════════════════════════════════════════════
begin;

-- 1. Cargas (lotes) -------------------------------------------------------------------------------------------------
create table if not exists public.profit_cargas (
  id bigint generated always as identity primary key,
  estado text not null default 'cargando' check (estado in ('cargando', 'vigente', 'reemplazada', 'fallida')),
  iniciada_at timestamptz not null default now(),
  publicada_at timestamptz,
  archivo text,
  cache_actualizada text,
  lineas integer,
  omitidas jsonb,
  desde date,
  hasta date,
  resultado jsonb
);
create unique index if not exists profit_cargas_una_vigente on public.profit_cargas ((true)) where estado = 'vigente';
comment on table public.profit_cargas is 'Cada ejecución de scripts/importar-historico-profit.mjs; los reportes leen solo el lote vigente';

-- 2. Histórico ------------------------------------------------------------------------------------------------------
create table if not exists public.ventas_historicas (
  id bigint generated always as identity primary key,
  lote bigint not null references public.profit_cargas(id),
  origen text not null default 'profit' check (origen = 'profit'),
  empresa_id uuid not null references public.empresas(id),
  -- Documento
  documento integer not null,
  tipo text not null check (tipo in ('factura', 'devolucion', 'nota_credito', 'nota_debito')),
  numero text not null,
  renglon integer not null,
  fecha date not null,
  fecha_vencimiento date,
  documento_origen text,
  numero_origen text,
  tratamiento text not null default 'venta' check (tratamiento in ('venta', 'financiera', 'nd_cambiaria', 'reverso')),
  -- Vendedor (Profit)
  vendedor_codigo text,
  vendedor_nombre text,
  -- Cliente
  cliente_codigo text,
  cliente_nombre text,
  cliente_rif text,
  cliente_id uuid references public.clientes(id) on delete set null,
  cliente_match text check (cliente_match in ('rif', 'nombre', 'documento')),
  tipo_cliente text,
  canal text,
  segmento text,
  -- Artículo
  articulo_codigo text,
  articulo_descripcion text,
  producto_id uuid references public.productos(id) on delete set null,
  categoria text,
  linea text,
  sublinea text,
  marca text,
  presentacion text,
  -- Importes
  moneda text,
  tasa_venta numeric,
  cantidad numeric not null default 0,
  precio_usd numeric,
  precio_bs numeric,
  descuento_renglon_pct numeric,
  descuento_global_pct numeric,
  descuento_usd numeric,
  descuento_bs numeric,
  exento_usd numeric,
  base_imponible_usd numeric,
  iva_usd numeric,
  total_usd numeric,
  exento_bs numeric,
  base_imponible_bs numeric,
  iva_bs numeric,
  total_bs numeric,
  neto_usd numeric not null,
  -- Costo de referencia de Profit (solo servidor / administración)
  ultimo_costo_usd numeric,
  costo_usd numeric,
  -- Cobro
  estatus_cobro text,
  dias_credito integer,
  condicion_pago text,
  lista_precios text,
  unique (lote, empresa_id, tipo, numero, renglon)
);
create index if not exists ventas_historicas_lote_empresa_fecha on public.ventas_historicas (lote, empresa_id, fecha);
create index if not exists ventas_historicas_cliente on public.ventas_historicas (cliente_id) where cliente_id is not null;
create index if not exists ventas_historicas_producto on public.ventas_historicas (producto_id) where producto_id is not null;
comment on table public.ventas_historicas is 'Histórico de ventas de Profit Plus (dic-2020 → may-2026), solo lectura. Lo carga scripts/importar-historico-profit.mjs';
comment on column public.ventas_historicas.neto_usd is 'Base de ventas de Profit: exento + base imponible en USD, sin IVA (negativo en devoluciones y NC)';
comment on column public.ventas_historicas.tratamiento is 'venta (facturas y devoluciones) · financiera (NC/ND, aparte) · nd_cambiaria (fuera) · reverso (factura anulada con devolución/NC por el mismo total, fuera)';
comment on column public.ventas_historicas.documento is 'Número correlativo del documento (empresa, tipo, número) dentro del lote: une las líneas con profit_documentos';

-- Resumen por documento (≈ 29 mil filas en vez de 130 mil líneas): lo usan los reportes agrupados por mes, empresa,
-- vendedor y cliente, los reversos y el estado de la carga. Se arma al publicar el lote.
create table if not exists public.profit_documentos (
  lote bigint not null references public.profit_cargas(id),
  documento integer not null,
  empresa_id uuid not null references public.empresas(id),
  tipo text not null,
  numero text not null,
  fecha date not null,
  tratamiento text not null,
  numero_origen text,
  cliente_codigo text,
  cliente_nombre text,
  cliente_rif text,
  cliente_id uuid,
  cliente_match text,
  vendedor_codigo text,
  vendedor_nombre text,
  descripcion text,
  lineas integer not null,
  cantidad numeric not null,
  neto_usd numeric not null,
  total_usd numeric,
  primary key (lote, documento)
);
create index if not exists profit_documentos_lote_empresa_fecha on public.profit_documentos (lote, empresa_id, fecha);
alter table public.profit_documentos add column if not exists cliente_match text;
comment on table public.profit_documentos is 'Resumen por documento del histórico de Profit (derivado de ventas_historicas al publicar cada lote)';

-- Resumen por artículo (≈ 540 filas): estado de la carga y artículos sin pareja
create table if not exists public.profit_articulos (
  lote bigint not null references public.profit_cargas(id),
  empresa_id uuid not null references public.empresas(id),
  articulo_codigo text not null,
  descripcion text,
  categoria text,
  producto_id uuid,
  lineas integer not null,
  unidades numeric not null,
  neto_usd numeric not null,
  ultima date,
  primary key (lote, empresa_id, articulo_codigo)
);
comment on table public.profit_articulos is 'Resumen por artículo del histórico de Profit (venta = facturas − devoluciones), derivado al publicar cada lote';

-- 3. Equivalencias de vendedores ------------------------------------------------------------------------------------
create table if not exists public.profit_vendedores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  codigo_profit text not null,
  nombre_profit text not null,
  vendedor_odoo text,
  usuario_id uuid references public.usuarios(id) on delete set null,
  propuesta_odoo text,
  estado text not null default 'sin_pareja' check (estado in ('propuesto', 'sin_pareja', 'validado')),
  revisado_por uuid references public.usuarios(id) on delete set null,
  revisado_at timestamptz,
  created_at timestamptz not null default now(),
  unique (empresa_id, codigo_profit, nombre_profit)
);
comment on table public.profit_vendedores is 'Vendedor de Profit → vendedor de Odoo (nombre como en facturas.vendedor_odoo). Sin vendedor_odoo se muestra el nombre de Profit';

-- Lote vigente (lo usan la política de lectura y los reportes)
create or replace function public.profit_lote_vigente() returns bigint language sql stable set search_path = public as $$
  select id from profit_cargas where estado = 'vigente';
$$;
revoke execute on function public.profit_lote_vigente() from public, anon;
grant execute on function public.profit_lote_vigente() to authenticated;

-- 4. Seguridad: RLS, permisos y solo lectura ------------------------------------------------------------------------
alter table public.ventas_historicas enable row level security;
alter table public.profit_vendedores enable row level security;
alter table public.profit_cargas enable row level security;

drop policy if exists ventas_historicas_reportes_ver on public.ventas_historicas;
create policy ventas_historicas_reportes_ver on public.ventas_historicas for select to authenticated
  using ((select public.puede('reportes', 'ver')) and lote = (select public.profit_lote_vigente()));
drop policy if exists empresa_visible on public.ventas_historicas;
create policy empresa_visible on public.ventas_historicas as restrictive for all to authenticated
  using (empresa_id = any ((select public.empresas_visibles())::uuid[]));

alter table public.profit_documentos enable row level security;
drop policy if exists profit_documentos_reportes_ver on public.profit_documentos;
create policy profit_documentos_reportes_ver on public.profit_documentos for select to authenticated
  using ((select public.puede('reportes', 'ver')) and lote = (select public.profit_lote_vigente()));
drop policy if exists empresa_visible on public.profit_documentos;
create policy empresa_visible on public.profit_documentos as restrictive for all to authenticated
  using (empresa_id = any ((select public.empresas_visibles())::uuid[]));

alter table public.profit_articulos enable row level security;
drop policy if exists profit_articulos_reportes_ver on public.profit_articulos;
create policy profit_articulos_reportes_ver on public.profit_articulos for select to authenticated
  using ((select public.puede('reportes', 'ver')) and lote = (select public.profit_lote_vigente()));
drop policy if exists empresa_visible on public.profit_articulos;
create policy empresa_visible on public.profit_articulos as restrictive for all to authenticated
  using (empresa_id = any ((select public.empresas_visibles())::uuid[]));

drop policy if exists profit_vendedores_reportes_ver on public.profit_vendedores;
create policy profit_vendedores_reportes_ver on public.profit_vendedores for select to authenticated using ((select public.puede('reportes', 'ver')));
drop policy if exists empresa_visible on public.profit_vendedores;
create policy empresa_visible on public.profit_vendedores as restrictive for all to authenticated
  using (empresa_id = any ((select public.empresas_visibles())::uuid[]));

drop policy if exists profit_cargas_reportes_ver on public.profit_cargas;
create policy profit_cargas_reportes_ver on public.profit_cargas for select to authenticated using ((select public.puede('reportes', 'ver')));

revoke all on public.ventas_historicas, public.profit_documentos, public.profit_articulos, public.profit_vendedores, public.profit_cargas from public, anon, authenticated;
-- El costo de referencia no se concede a la API (solo lo leen las funciones del servidor)
grant select (id, lote, origen, empresa_id, documento, tipo, numero, renglon, fecha, fecha_vencimiento, documento_origen, numero_origen, tratamiento,
  vendedor_codigo, vendedor_nombre, cliente_codigo, cliente_nombre, cliente_rif, cliente_id, cliente_match, tipo_cliente, canal, segmento,
  articulo_codigo, articulo_descripcion, producto_id, categoria, linea, sublinea, marca, presentacion, moneda, tasa_venta, cantidad,
  precio_usd, precio_bs, descuento_renglon_pct, descuento_global_pct, descuento_usd, descuento_bs, exento_usd, base_imponible_usd,
  iva_usd, total_usd, exento_bs, base_imponible_bs, iva_bs, total_bs, neto_usd, estatus_cobro, dias_credito, condicion_pago,
  lista_precios) on public.ventas_historicas to authenticated;
grant select on public.profit_documentos, public.profit_articulos, public.profit_vendedores, public.profit_cargas to authenticated;

-- El histórico solo cambia con el script de carga (rol postgres). Desde la API (anon/authenticated) no se escribe,
-- ni siquiera desde una función security definer. Se permiten las acciones anidadas (on delete set null de clientes y productos).
create or replace function public.trg_ventas_historicas_solo_lectura() returns trigger language plpgsql as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '') in ('anon', 'authenticated') then
    raise exception 'El histórico de Profit es de solo lectura' using errcode = '42501';
  end if;
  return null;
end $$;
revoke execute on function public.trg_ventas_historicas_solo_lectura() from public, anon, authenticated;
drop trigger if exists a_solo_lectura on public.ventas_historicas;
create trigger a_solo_lectura before insert or update or delete or truncate on public.ventas_historicas
  for each statement execute function public.trg_ventas_historicas_solo_lectura();
drop trigger if exists a_solo_lectura on public.profit_documentos;
create trigger a_solo_lectura before insert or update or delete or truncate on public.profit_documentos
  for each statement execute function public.trg_ventas_historicas_solo_lectura();
drop trigger if exists a_solo_lectura on public.profit_articulos;
create trigger a_solo_lectura before insert or update or delete or truncate on public.profit_articulos
  for each statement execute function public.trg_ventas_historicas_solo_lectura();

-- 5. Emparejamiento y carga (solo el script, rol postgres) ------------------------------------------------------------
-- Palabras de un nombre (sin acentos ni signos, de 2 letras o más) para proponer equivalencias de vendedores
create or replace function public.profit_palabras(t text) returns text[] language sql immutable as $$
  select coalesce(array_agg(distinct w order by w) filter (where length(w) >= 2), '{}')
  from regexp_split_to_table(trim(regexp_replace(upper(translate(coalesce(t, ''), 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU')), '[^A-Z0-9]+', ' ', 'g')), ' ') w;
$$;
revoke execute on function public.profit_palabras(text) from public, anon, authenticated;

-- Pareja de cada cliente de Profit en GUDS. p = [{empresa_id, cliente_codigo, nombre, rif, facturas: [números]}]
--   1) RIF normalizado · 2) nombre normalizado (sin "C.A.", signos ni mayúsculas) · 3) el número de sus facturas se
--   conservó en los saldos iniciales de Odoo y todas apuntan al mismo cliente. Prefiere la misma empresa sobre los compartidos.
create or replace function public.profit_parejas_clientes(p jsonb)
returns table(empresa_id uuid, cliente_codigo text, cliente_id uuid, metodo text) language sql stable set search_path = public as $$
  with pc as (
    select x.empresa_id, coalesce(x.cliente_codigo, '') cliente_codigo, public.normalizar_rif(x.rif) rif,
           public.normalizar_nombre_empresa(x.nombre) nombre, x.facturas
    from jsonb_to_recordset(p) as x(empresa_id uuid, cliente_codigo text, nombre text, rif text, facturas jsonb)
  ), cn as (
    select c.id, c.empresa_id, public.normalizar_rif(c.rif) rif, public.normalizar_nombre_empresa(c.nombre_negocio) nombre, c.activo, c.created_at
    from clientes c
  ), por_rif as (
    select distinct on (pc.empresa_id, pc.cliente_codigo) pc.empresa_id, pc.cliente_codigo, cn.id
    from pc join cn on cn.rif = pc.rif and (cn.empresa_id = pc.empresa_id or cn.empresa_id is null)
    order by pc.empresa_id, pc.cliente_codigo, (cn.empresa_id is null), cn.activo desc nulls last, cn.created_at
  ), por_nombre as (
    select distinct on (pc.empresa_id, pc.cliente_codigo) pc.empresa_id, pc.cliente_codigo, cn.id
    from pc join cn on cn.nombre = pc.nombre and (cn.empresa_id = pc.empresa_id or cn.empresa_id is null)
    order by pc.empresa_id, pc.cliente_codigo, (cn.empresa_id is null), cn.activo desc nulls last, cn.created_at
  ), por_documento as (
    select pc.empresa_id, pc.cliente_codigo, min(f.cliente_id::text)::uuid id
    from pc cross join lateral jsonb_array_elements_text(coalesce(pc.facturas, '[]'::jsonb)) n(numero)
    join facturas f on f.empresa_id = pc.empresa_id and f.tipo = 'factura' and f.es_saldo_inicial and f.numero = n.numero and f.cliente_id is not null
    group by pc.empresa_id, pc.cliente_codigo
    having count(distinct f.cliente_id) = 1
  )
  select pc.empresa_id, pc.cliente_codigo, coalesce(r.id, n.id, d.id),
         case when r.id is not null then 'rif' when n.id is not null then 'nombre' when d.id is not null then 'documento' end
  from pc
  left join por_rif r on r.empresa_id = pc.empresa_id and r.cliente_codigo = pc.cliente_codigo
  left join por_nombre n on n.empresa_id = pc.empresa_id and n.cliente_codigo = pc.cliente_codigo
  left join por_documento d on d.empresa_id = pc.empresa_id and d.cliente_codigo = pc.cliente_codigo;
$$;
revoke execute on function public.profit_parejas_clientes(jsonb) from public, anon, authenticated;

-- Pareja de cada artículo de Profit: producto de GUDS con el mismo código (sku) en la misma empresa (o compartido)
create or replace function public.profit_parejas_productos(p jsonb)
returns table(empresa_id uuid, articulo_codigo text, producto_id uuid) language sql stable set search_path = public as $$
  select x.empresa_id, x.articulo_codigo,
         (select pr.id from productos pr
           where upper(trim(pr.sku)) = upper(trim(x.articulo_codigo)) and (pr.empresa_id = x.empresa_id or pr.empresa_id is null)
           order by (pr.empresa_id is null), pr.activo desc nulls last, pr.created_at limit 1)
  from jsonb_to_recordset(p) as x(empresa_id uuid, articulo_codigo text);
$$;
revoke execute on function public.profit_parejas_productos(jsonb) from public, anon, authenticated;

-- Vuelve a emparejar el lote vigente (p. ej. después de crear clientes o productos en Odoo): solo escribe lo que cambia
create or replace function public.profit_emparejar() returns jsonb language plpgsql set search_path = public as $$
declare v_lote bigint := public.profit_lote_vigente(); v_cli integer; v_prod integer;
begin
  if v_lote is null then return jsonb_build_object('lote', null); end if;
  with entrada as (
    select jsonb_agg(jsonb_build_object('empresa_id', empresa_id, 'cliente_codigo', cliente_codigo, 'nombre', nombre, 'rif', rif, 'facturas', facturas)) j
    from (select empresa_id, coalesce(cliente_codigo, '') cliente_codigo, max(cliente_nombre) nombre, max(cliente_rif) rif,
                 coalesce(jsonb_agg(distinct numero) filter (where tipo = 'factura'), '[]'::jsonb) facturas
          from ventas_historicas where lote = v_lote group by 1, 2) c
  )
  update ventas_historicas v set cliente_id = p.cliente_id, cliente_match = p.metodo
  from public.profit_parejas_clientes((select j from entrada)) p
  where v.lote = v_lote and p.empresa_id = v.empresa_id and p.cliente_codigo = coalesce(v.cliente_codigo, '')
    and (v.cliente_id, v.cliente_match) is distinct from (p.cliente_id, p.metodo);
  get diagnostics v_cli = row_count;

  with entrada as (
    select jsonb_agg(jsonb_build_object('empresa_id', empresa_id, 'articulo_codigo', articulo_codigo)) j
    from (select distinct empresa_id, articulo_codigo from ventas_historicas where lote = v_lote and articulo_codigo is not null) a
  )
  update ventas_historicas v set producto_id = p.producto_id
  from public.profit_parejas_productos((select j from entrada)) p
  where v.lote = v_lote and p.empresa_id = v.empresa_id and p.articulo_codigo = v.articulo_codigo and v.producto_id is distinct from p.producto_id;
  get diagnostics v_prod = row_count;

  update profit_documentos d set cliente_id = x.cliente_id, cliente_match = x.cliente_match
  from (select documento, min(cliente_id::text)::uuid cliente_id, max(cliente_match) cliente_match
        from ventas_historicas where lote = v_lote group by documento) x
  where d.lote = v_lote and d.documento = x.documento and (d.cliente_id, d.cliente_match) is distinct from (x.cliente_id, x.cliente_match);
  update profit_articulos a set producto_id = x.producto_id
  from (select empresa_id, articulo_codigo, min(producto_id::text)::uuid producto_id
        from ventas_historicas where lote = v_lote and articulo_codigo is not null group by 1, 2) x
  where a.lote = v_lote and a.empresa_id = x.empresa_id and a.articulo_codigo = x.articulo_codigo and a.producto_id is distinct from x.producto_id;
  return jsonb_build_object('lote', v_lote, 'lineas_cliente', v_cli, 'lineas_producto', v_prod);
end $$;
revoke execute on function public.profit_emparejar() from public, anon, authenticated;

-- Propone la equivalencia de cada vendedor de Profit con un nombre de vendedor de Odoo (facturas.vendedor_odoo):
-- todas las palabras de un nombre están en el otro (al menos 2), p. ej. "JUAN ANTONIO PEREZ GOMEZ" → "JUAN PEREZ".
-- Si hay empate entre dos candidatos no propone. Lo validado por administración no se toca.
create or replace function public.profit_proponer_vendedores() returns integer language plpgsql set search_path = public as $$
declare n integer;
begin
  insert into profit_vendedores (empresa_id, codigo_profit, nombre_profit)
  select distinct empresa_id, coalesce(vendedor_codigo, ''), coalesce(vendedor_nombre, '')
  from ventas_historicas where lote = public.profit_lote_vigente()
  on conflict (empresa_id, codigo_profit, nombre_profit) do nothing;

  with cand as (
    select distinct upper(regexp_replace(trim(vendedor_odoo), '\s+', ' ', 'g')) nombre
    from facturas where nullif(trim(vendedor_odoo), '') is not null
  ), ct as (
    select nombre, public.profit_palabras(nombre) pal from cand
  ), pv as (
    select id, public.profit_palabras(nombre_profit) pal from profit_vendedores where estado <> 'validado'
  ), m as (
    select pv.id, ct.nombre,
           cardinality(array(select unnest(pv.pal) intersect select unnest(ct.pal))) comunes,
           (ct.pal = pv.pal) exacto
    from pv join ct on (ct.pal <@ pv.pal and cardinality(ct.pal) >= 2) or (pv.pal <@ ct.pal and cardinality(pv.pal) >= 2)
  ), r as (
    select id, nombre, row_number() over (partition by id order by exacto desc, comunes desc, nombre) pos,
           count(*) over (partition by id, exacto, comunes) empates
    from m
  ), propuesta as (
    select pv.id, (select r.nombre from r where r.id = pv.id and r.pos = 1 and r.empates = 1) nombre from pv
  )
  update profit_vendedores p set propuesta_odoo = x.nombre, vendedor_odoo = x.nombre,
         estado = case when x.nombre is null then 'sin_pareja' else 'propuesto' end,
         usuario_id = (select u.id from usuarios u where u.role = 'vendedor'
                        and upper(regexp_replace(trim(concat_ws(' ', u.nombre, u.apellido)), '\s+', ' ', 'g')) = x.nombre
                        order by u.activo desc nulls last, u.created_at limit 1)
  from propuesta x
  where x.id = p.id;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.profit_proponer_vendedores() from public, anon, authenticated;

-- Abre un lote nuevo (los que quedaron a medias pasan a "fallida")
create or replace function public.profit_iniciar_carga(p_archivo text, p_cache text, p_omitidas jsonb) returns bigint
language plpgsql set search_path = public as $$
declare v_id bigint;
begin
  update profit_cargas set estado = 'fallida' where estado = 'cargando';
  insert into profit_cargas (archivo, cache_actualizada, omitidas) values (p_archivo, p_cache, p_omitidas) returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.profit_iniciar_carga(text, text, jsonb) from public, anon, authenticated;

-- Publica el lote: comprueba que llegaron todas las líneas, clasifica notas y reversos, lo marca vigente (el anterior
-- queda "reemplazada") y propone vendedores. Solo reescribe las filas que no son venta.
create or replace function public.profit_publicar_carga(p_lote bigint, p_lineas integer) returns jsonb
language plpgsql set search_path = public as $$
declare v_n integer; v_desde date; v_hasta date; v_emp jsonb; v_vend integer; v_rev integer; v_res jsonb;
begin
  if not exists (select 1 from profit_cargas where id = p_lote and estado = 'cargando') then
    raise exception 'El lote % no está en carga', p_lote;
  end if;
  select count(*), min(fecha), max(fecha) into v_n, v_desde, v_hasta from ventas_historicas where lote = p_lote;
  if v_n is distinct from p_lineas then
    raise exception 'El lote % tiene % líneas y se esperaban %', p_lote, v_n, p_lineas;
  end if;

  update ventas_historicas set tratamiento = case
      when tipo = 'nota_debito' and upper(coalesce(articulo_descripcion, '')) ~ '(CAMBIARI|DIFERENCIAL DE TASA|DIFERENCIA DE TASA)' then 'nd_cambiaria'
      else 'financiera' end
  where lote = p_lote and tipo in ('nota_credito', 'nota_debito');

  -- Reversos: devolución o NC cuyo documento de origen es una factura del mismo cliente por el mismo total (con IVA)
  with docs as (
    select empresa_id, tipo, numero, max(numero_origen) numero_origen, max(cliente_codigo) cliente_codigo, sum(total_usd) total
    from ventas_historicas where lote = p_lote group by empresa_id, tipo, numero
  ), par as (
    select distinct on (f.empresa_id, f.numero) f.empresa_id, f.numero factura, n.tipo nota_tipo, n.numero nota
    from docs n join docs f on f.empresa_id = n.empresa_id and f.tipo = 'factura' and f.numero = n.numero_origen
      and f.cliente_codigo is not distinct from n.cliente_codigo
    where n.tipo in ('devolucion', 'nota_credito') and f.total <> 0 and abs(abs(n.total) - abs(f.total)) < 0.01
    order by f.empresa_id, f.numero, n.numero
  ), marcar as (
    select empresa_id, 'factura'::text tipo, factura numero from par
    union all
    select empresa_id, nota_tipo, nota from par
  )
  update ventas_historicas v set tratamiento = 'reverso'
  from marcar m
  where v.lote = p_lote and v.empresa_id = m.empresa_id and v.tipo = m.tipo and v.numero = m.numero;
  get diagnostics v_rev = row_count;

  delete from profit_documentos;
  insert into profit_documentos (lote, documento, empresa_id, tipo, numero, fecha, tratamiento, numero_origen, cliente_codigo, cliente_nombre,
    cliente_rif, cliente_id, cliente_match, vendedor_codigo, vendedor_nombre, descripcion, lineas, cantidad, neto_usd, total_usd)
  select lote, documento, min(empresa_id::text)::uuid, min(tipo), min(numero), min(fecha), min(tratamiento), max(numero_origen), max(cliente_codigo),
         max(cliente_nombre), max(cliente_rif), min(cliente_id::text)::uuid, max(cliente_match), max(vendedor_codigo), max(vendedor_nombre),
         max(articulo_descripcion) filter (where articulo_codigo is null), count(*), sum(cantidad), sum(neto_usd), sum(total_usd)
  from ventas_historicas where lote = p_lote group by lote, documento;
  delete from profit_articulos;
  insert into profit_articulos (lote, empresa_id, articulo_codigo, descripcion, categoria, producto_id, lineas, unidades, neto_usd, ultima)
  select lote, empresa_id, articulo_codigo, max(articulo_descripcion), max(categoria), min(producto_id::text)::uuid, count(*),
         coalesce(sum(cantidad) filter (where tratamiento = 'venta'), 0), coalesce(sum(neto_usd) filter (where tratamiento = 'venta'), 0), max(fecha)
  from ventas_historicas where lote = p_lote and articulo_codigo is not null group by lote, empresa_id, articulo_codigo;

  update profit_cargas set estado = 'reemplazada' where estado = 'vigente';
  update profit_cargas set estado = 'vigente', publicada_at = now(), lineas = v_n, desde = v_desde, hasta = v_hasta where id = p_lote;
  v_vend := public.profit_proponer_vendedores();

  select jsonb_object_agg(e.nombre_corto, x.n) into v_emp
  from (select empresa_id, count(*) n from ventas_historicas where lote = p_lote group by 1) x join empresas e on e.id = x.empresa_id;
  v_res := jsonb_build_object('lote', p_lote, 'lineas', v_n, 'desde', v_desde, 'hasta', v_hasta, 'por_empresa', v_emp,
                              'lineas_reverso', v_rev, 'vendedores_propuestos', v_vend);
  update profit_cargas set resultado = v_res where id = p_lote;
  return v_res;
end $$;
revoke execute on function public.profit_publicar_carga(bigint, integer) from public, anon, authenticated;

-- 6. Reportes: Odoo + Profit ----------------------------------------------------------------------------------------
-- documentos_venta (venta de Odoo, 19o): misma definición; solo evalúa empresas_visibles() una vez y no por cada factura
-- (con el período "Todo el historial" pasaba de 0,8 s a milisegundos).
create or replace function public.documentos_venta(p_desde date, p_hasta date)
returns table(id uuid, empresa_id uuid, cliente_id uuid, tipo text, fecha date, vendedor text, factor numeric, neto_usd numeric)
language sql stable security definer set search_path = public as $$
  with reverso as (
    select fa.id factura_id, nc.id nota_id
    from facturas nc join facturas fa on fa.id = nc.factura_origen_id
    where nc.tipo = 'nota_credito' and fa.tipo = 'factura' and nc.estado = 'posted' and fa.estado = 'posted'
      and fa.moneda is not distinct from nc.moneda and abs(abs(nc.total) - abs(fa.total)) < 0.01
  ), excluir as (select factura_id id from reverso union select nota_id from reverso)
  select f.id, f.empresa_id, f.cliente_id, f.tipo, f.fecha_emision, coalesce(nullif(trim(f.vendedor_odoo), ''), 'Sin vendedor'),
         case when f.total <> 0 then f.total_usd / f.total else 0 end,
         case when f.total <> 0 then f.subtotal * f.total_usd / f.total else 0 end
  from facturas f
  where f.estado = 'posted' and f.tipo in ('factura', 'nota_credito') and not f.es_saldo_inicial and not coalesce(f.es_nota_debito, false)
    and f.fecha_emision between p_desde and p_hasta
    and (f.empresa_id is null or f.empresa_id = any((select public.empresas_visibles())::uuid[]))
    and f.id not in (select id from excluir);
$$;
revoke execute on function public.documentos_venta(date, date) from public, anon, authenticated;

-- Ventas agrupadas (mes | vendedor | cliente | producto | categoria | empresa) de la fuente pedida.
--   bruto = facturas; nc = notas de crédito de Odoo y devoluciones de Profit; neto = bruto + nc
--   profit_usd = parte del neto que viene de Profit; financieras_usd = NC/ND financieras de Profit (aparte, no están en el neto)
--   fuente = odoo | profit | ambas (de qué fuentes sale la fila)
--   p_conteos = false: por producto o categoría no cuenta documentos ni clientes (quedan null) y es mucho más rápido
drop function if exists public.reporte_ventas(date, date, text);
drop function if exists public.reporte_ventas(date, date, text, text);
create or replace function public.reporte_ventas(p_desde date, p_hasta date, p_agrupar text, p_fuente text default 'ambas',
                                                 p_conteos boolean default true)
returns table(clave text, etiqueta text, detalle text, documentos bigint, clientes bigint, cantidad numeric,
              bruto_usd numeric, nc_usd numeric, neto_usd numeric, profit_usd numeric, financieras_usd numeric, fuente text)
language plpgsql stable security definer set search_path = public set work_mem = '16MB' as $$
#variable_conflict use_column
declare
  v_fuente text := coalesce(p_fuente, 'ambas');
  v_odoo boolean;
  v_profit boolean;
  v_emp uuid[];
  v_lote bigint;
begin
  perform public.exigir_permiso_reportes();
  if v_fuente not in ('ambas', 'odoo', 'profit') then
    raise exception 'Fuente no válida: % (ambas, odoo o profit)', p_fuente using errcode = '22023';
  end if;
  v_odoo := v_fuente in ('ambas', 'odoo');
  v_profit := v_fuente in ('ambas', 'profit');
  v_emp := public.empresas_visibles();
  v_lote := case when v_profit then public.profit_lote_vigente() end;

  if p_agrupar in ('producto', 'categoria') and not coalesce(p_conteos, true) then
    -- Sin conteos: solo sumas, agregadas por hash (sin ordenar)
    return query
    with d as (select * from public.documentos_venta(p_desde, p_hasta) where v_odoo),
    l as (
      select 'odoo'::text fte, d.tipo = 'nota_credito' es_nc, i.producto_id, i.sku_producto sku, i.nombre_producto nombre, null::text cat_profit,
             case when d.tipo = 'nota_credito' then -i.cantidad else i.cantidad end cant, i.subtotal * d.factor usd
      from d join factura_items i on i.factura_id = d.id
      union all
      select 'profit', v.tipo = 'devolucion', v.producto_id, v.articulo_codigo, v.articulo_descripcion, nullif(trim(v.categoria), ''), v.cantidad, v.neto_usd
      from ventas_historicas v
      where v.lote = v_lote and v.tratamiento = 'venta' and v.fecha between p_desde and p_hasta and v.empresa_id = any(v_emp)
    ), e1 as (
      select case when p_agrupar = 'producto' then coalesce(l.producto_id::text, l.sku, l.nombre)
                  else coalesce(pr.categoria_id::text, 'profit:' || upper(l.cat_profit), 'sin') end k,
             coalesce(l.producto_id::text, l.sku, l.nombre) pk, sum(l.cant) cant,
             sum(l.usd) filter (where not l.es_nc) fac, sum(l.usd) filter (where l.es_nc) nc, sum(l.usd) usd,
             sum(l.usd) filter (where l.fte = 'profit') prof, bool_or(l.fte = 'odoo') hay_odoo, bool_or(l.fte = 'profit') hay_profit,
             max(l.producto_id::text) prod, max(l.nombre) nombre, max(l.sku) sku, max(l.cat_profit) cat_profit
      from l left join productos pr on pr.id = l.producto_id
      group by 1, 2
    ), g as (
      select e1.k, count(*) n, sum(e1.cant) cant, sum(e1.fac) fac, sum(e1.nc) nc, sum(e1.usd) usd, sum(e1.prof) prof,
             bool_or(e1.hay_odoo) hay_odoo, bool_or(e1.hay_profit) hay_profit,
             max(e1.prod) prod, max(e1.nombre) nombre, max(e1.sku) sku, max(e1.cat_profit) cat_profit
      from e1 group by e1.k
    )
    select g.k,
           case when p_agrupar = 'producto' then coalesce(p.nombre, g.nombre)
                else coalesce(c.nombre, g.cat_profit || ' (Profit)', 'Sin categoría') end::text,
           case when p_agrupar = 'producto' then coalesce(p.sku, g.sku) else g.n::text || ' productos' end::text,
           null::bigint, null::bigint, round(g.cant, 2), round(g.fac, 2), round(coalesce(g.nc, 0), 2), round(g.usd, 2), round(coalesce(g.prof, 0), 2), 0::numeric,
           case when g.hay_odoo and g.hay_profit then 'ambas' when g.hay_profit then 'profit' else 'odoo' end
    from g
    left join productos p on p_agrupar = 'producto' and p.id = g.prod::uuid
    left join categorias c on p_agrupar = 'categoria' and c.id::text = g.k
    order by 9 desc nulls last;
  elsif p_agrupar in ('producto', 'categoria') then
    -- Líneas de las dos fuentes con claves cortas: documento de Odoo (uuid) o de Profit (entero), que no se cruzan, y cliente
    -- (uuid de GUDS o, sin pareja, uno derivado del código de Profit). Se agrupa primero por (grupo, cliente): cada documento
    -- es de un solo cliente, así que sumar los documentos de cada cliente da el total exacto sin volver a ordenar.
    return query
    with d as (select * from public.documentos_venta(p_desde, p_hasta) where v_odoo),
    l as (
      select 'odoo'::text fte, d.id doc_o, null::integer doc_p, d.cliente_id cli, d.tipo = 'nota_credito' es_nc, i.producto_id,
             i.sku_producto sku, i.nombre_producto nombre, null::text cat_profit,
             case when d.tipo = 'nota_credito' then -i.cantidad else i.cantidad end cant, i.subtotal * d.factor usd
      from d join factura_items i on i.factura_id = d.id
      union all
      select 'profit', null::uuid, v.documento, coalesce(v.cliente_id, md5(v.empresa_id::text || ':' || coalesce(v.cliente_codigo, ''))::uuid),
             v.tipo = 'devolucion', v.producto_id, v.articulo_codigo, v.articulo_descripcion, nullif(trim(v.categoria), ''), v.cantidad, v.neto_usd
      from ventas_historicas v
      where v.lote = v_lote and v.tratamiento = 'venta' and v.fecha between p_desde and p_hasta and v.empresa_id = any(v_emp)
    ), lk as (
      -- Solo claves y montos (las etiquetas se buscan al final, por grupo)
      select case when p_agrupar = 'producto' then coalesce(l.producto_id::text, l.sku, l.nombre)
                  else coalesce(pr.categoria_id::text, 'profit:' || upper(l.cat_profit), 'sin') end k,
             coalesce(l.producto_id::text, l.sku, l.nombre) pk, l.fte, l.doc_o, l.doc_p, l.cli, l.es_nc, l.producto_id, l.sku, l.nombre,
             l.cat_profit, l.cant, l.usd
      from l left join productos pr on pr.id = l.producto_id
    ), e1 as (
      select lk.k, lk.cli, count(distinct lk.doc_o) + count(distinct lk.doc_p) docs, sum(lk.cant) cant,
             sum(lk.usd) filter (where not lk.es_nc) fac, sum(lk.usd) filter (where lk.es_nc) nc, sum(lk.usd) usd,
             sum(lk.usd) filter (where lk.fte = 'profit') prof, bool_or(lk.fte = 'odoo') hay_odoo, bool_or(lk.fte = 'profit') hay_profit,
             max(lk.producto_id::text) prod, max(lk.nombre) nombre, max(lk.sku) sku, max(lk.cat_profit) cat_profit
      from lk group by lk.k, lk.cli
    ), np as (
      select lk.k, count(distinct lk.pk) n from lk where p_agrupar = 'categoria' group by lk.k
    ), g as (
      select e1.k, sum(e1.docs)::bigint docs, count(e1.cli) clis, sum(e1.cant) cant, sum(e1.fac) fac, sum(e1.nc) nc, sum(e1.usd) usd,
             sum(e1.prof) prof, bool_or(e1.hay_odoo) hay_odoo, bool_or(e1.hay_profit) hay_profit,
             max(e1.prod) prod, max(e1.nombre) nombre, max(e1.sku) sku, max(e1.cat_profit) cat_profit
      from e1 group by e1.k
    )
    select g.k,
           case when p_agrupar = 'producto' then coalesce(p.nombre, g.nombre)
                else coalesce(c.nombre, g.cat_profit || ' (Profit)', 'Sin categoría') end::text,
           case when p_agrupar = 'producto' then coalesce(p.sku, g.sku) else np.n::text || ' productos' end::text,
           g.docs, g.clis, round(g.cant, 2), round(g.fac, 2), round(coalesce(g.nc, 0), 2), round(g.usd, 2), round(coalesce(g.prof, 0), 2), 0::numeric,
           case when g.hay_odoo and g.hay_profit then 'ambas' when g.hay_profit then 'profit' else 'odoo' end
    from g
    left join productos p on p_agrupar = 'producto' and p.id = g.prod::uuid
    left join categorias c on p_agrupar = 'categoria' and c.id::text = g.k
    left join np on np.k = g.k
    order by 9 desc nulls last;
  else
    return query
    with d as (
      select 'odoo'::text fte, dv.id::text doc, dv.empresa_id, dv.cliente_id::text cli, dv.tipo, dv.fecha, dv.vendedor,
             dv.neto_usd neto, 0::numeric fin, null::text cli_nombre, null::text cli_detalle
      from public.documentos_venta(p_desde, p_hasta) dv
      where v_odoo
      union all
      select 'profit', 'p' || v.documento, v.empresa_id,
             coalesce(v.cliente_id::text, 'profit:' || v.empresa_id::text || ':' || coalesce(v.cliente_codigo, '')),
             case v.tipo when 'factura' then 'factura' when 'devolucion' then 'nota_credito' else 'financiera' end,
             v.fecha, coalesce(nullif(trim(pv.vendedor_odoo), ''), nullif(v.vendedor_nombre, ''), 'Sin vendedor'),
             case when v.tratamiento = 'venta' then v.neto_usd else 0 end, case when v.tratamiento = 'financiera' then v.neto_usd else 0 end,
             v.cliente_nombre, coalesce(v.cliente_rif, v.cliente_codigo)
      from profit_documentos v
      left join profit_vendedores pv on pv.empresa_id = v.empresa_id and pv.codigo_profit = coalesce(v.vendedor_codigo, '')
        and pv.nombre_profit = coalesce(v.vendedor_nombre, '')
      where v.lote = v_lote and v.tratamiento in ('venta', 'financiera') and v.fecha between p_desde and p_hasta and v.empresa_id = any(v_emp)
    ), k as (
      select d.*, case p_agrupar when 'mes' then to_char(d.fecha, 'YYYY-MM') when 'vendedor' then d.vendedor
                                 when 'cliente' then d.cli else coalesce(d.empresa_id::text, 'compartido') end k
      from d
    )
    select k.k,
           case p_agrupar when 'cliente' then coalesce(max(cl.nombre_negocio), max(k.cli_nombre), '—')
                          when 'empresa' then coalesce(max(e.nombre_corto), 'Compartido') else k.k end::text,
           case p_agrupar when 'cliente' then coalesce(max(nullif(concat_ws(' · ', cl.rif, cl.ciudad), '')), max(k.cli_detalle)) else null end::text,
           count(distinct k.doc) filter (where k.tipo = 'factura'), count(distinct k.cli), null::numeric,
           round(coalesce(sum(k.neto) filter (where k.tipo = 'factura'), 0), 2), round(coalesce(sum(k.neto) filter (where k.tipo = 'nota_credito'), 0), 2),
           round(sum(k.neto), 2), round(coalesce(sum(k.neto) filter (where k.fte = 'profit'), 0), 2), round(coalesce(sum(k.fin), 0), 2),
           case when bool_or(k.fte = 'odoo') and bool_or(k.fte = 'profit') then 'ambas' when bool_or(k.fte = 'profit') then 'profit' else 'odoo' end
    from k
    left join clientes cl on cl.id = (case when k.cli !~ '^profit:' then k.cli::uuid end)
    left join empresas e on e.id = k.empresa_id
    group by k.k
    order by case when p_agrupar = 'mes' then k.k end, 9 desc nulls last;
  end if;
end $$;
revoke execute on function public.reporte_ventas(date, date, text, text, boolean) from public, anon;
grant execute on function public.reporte_ventas(date, date, text, text, boolean) to authenticated;

-- Pares factura + nota de reverso total con algún documento en el período (Odoo 19o y Profit)
drop function if exists public.reporte_reversos(date, date);
create or replace function public.reporte_reversos(p_desde date, p_hasta date, p_fuente text default 'ambas')
returns table(empresa text, cliente text, factura text, factura_fecha date, nota text, nota_fecha date, neto_usd numeric, motivo text, fuente text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_fuente text := coalesce(p_fuente, 'ambas');
  v_emp uuid[];
  v_lote bigint;
begin
  perform public.exigir_permiso_reportes();
  if v_fuente not in ('ambas', 'odoo', 'profit') then
    raise exception 'Fuente no válida: % (ambas, odoo o profit)', p_fuente using errcode = '22023';
  end if;
  v_emp := public.empresas_visibles();
  v_lote := case when v_fuente in ('ambas', 'profit') then public.profit_lote_vigente() end;
  return query
  select * from (
    select e.nombre_corto::text, coalesce(c.nombre_negocio, '—')::text, fa.numero::text, fa.fecha_emision, nc.numero::text, nc.fecha_emision,
           round(case when fa.total <> 0 then fa.subtotal * fa.total_usd / fa.total else 0 end, 2),
           coalesce(nullif(trim(nc.motivo_nota), ''), nullif(trim(nc.referencia), ''), nullif(trim(fa.motivo_anulacion), ''))::text,
           'odoo'::text
    from facturas nc join facturas fa on fa.id = nc.factura_origen_id
    left join clientes c on c.id = fa.cliente_id
    left join empresas e on e.id = fa.empresa_id
    where v_fuente in ('ambas', 'odoo')
      and nc.tipo = 'nota_credito' and fa.tipo = 'factura' and nc.estado = 'posted' and fa.estado = 'posted'
      and fa.moneda is not distinct from nc.moneda and abs(abs(nc.total) - abs(fa.total)) < 0.01
      and not fa.es_saldo_inicial and not nc.es_saldo_inicial
      and (fa.fecha_emision between p_desde and p_hasta or nc.fecha_emision between p_desde and p_hasta)
      and (fa.empresa_id is null or fa.empresa_id = any(v_emp))
    union all
    select e.nombre_corto::text, coalesce(c.nombre_negocio, f.cliente_nombre, '—')::text, f.numero, f.fecha,
           (case n.tipo when 'devolucion' then 'Dev. ' else 'NC ' end || n.numero)::text, n.fecha, round(f.neto, 2),
           (case n.tipo when 'devolucion' then 'Devolución total en Profit' else coalesce(n.descripcion, 'Nota de crédito total en Profit') end)::text,
           'profit'::text
    from (select empresa_id, numero, fecha, cliente_id, cliente_nombre, neto_usd neto
          from profit_documentos where lote = v_lote and tratamiento = 'reverso' and tipo = 'factura') f
    join (select empresa_id, tipo, numero, numero_origen, fecha, descripcion
          from profit_documentos where lote = v_lote and tratamiento = 'reverso' and tipo in ('devolucion', 'nota_credito')) n
      on n.empresa_id = f.empresa_id and n.numero_origen = f.numero
    left join clientes c on c.id = f.cliente_id
    left join empresas e on e.id = f.empresa_id
    where (f.fecha between p_desde and p_hasta or n.fecha between p_desde and p_hasta)
      and f.empresa_id = any(v_emp)
  ) x
  order by 7 desc;
end $$;
revoke execute on function public.reporte_reversos(date, date, text) from public, anon;
grant execute on function public.reporte_reversos(date, date, text) to authenticated;

-- 7. Pestaña "Histórico Profit": estado de la carga, emparejamiento y equivalencias de vendedores ------------------
create or replace function public.estado_historico_profit() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_emp uuid[]; v_lote bigint; v_res jsonb;
begin
  perform public.exigir_permiso_reportes();
  v_emp := public.empresas_visibles();
  v_lote := public.profit_lote_vigente();
  with v as (select * from profit_documentos where lote = v_lote and empresa_id = any(v_emp)),
  cli as (
    select v.empresa_id, v.cliente_codigo, max(v.cliente_nombre) nombre, max(v.cliente_rif) rif, max(v.cliente_match) metodo,
           bool_or(v.cliente_id is not null) con_pareja, sum(v.lineas) lineas,
           coalesce(sum(v.neto_usd) filter (where v.tratamiento = 'venta'), 0) neto, max(v.fecha) ultima
    from v group by v.empresa_id, v.cliente_codigo
  ), prod as (
    select a.empresa_id, a.articulo_codigo, a.descripcion, a.categoria, a.producto_id is not null con_pareja, a.lineas,
           a.neto_usd neto, a.unidades, a.ultima
    from profit_articulos a where a.lote = v_lote and a.empresa_id = any(v_emp)
  ), vend as (
    select v.empresa_id, coalesce(v.vendedor_codigo, '') codigo, coalesce(v.vendedor_nombre, '') nombre, sum(v.lineas) lineas,
           coalesce(sum(v.neto_usd) filter (where v.tratamiento = 'venta'), 0) neto, min(v.fecha) desde, max(v.fecha) hasta
    from v group by 1, 2, 3
  )
  select jsonb_build_object(
    'carga', (select to_jsonb(pc) from profit_cargas pc where pc.id = v_lote),
    'en_curso', exists (select 1 from profit_cargas where estado = 'cargando'),
    'lineas', (select coalesce(sum(lineas), 0) from v),
    'desde', (select min(fecha) from v),
    'hasta', (select max(fecha) from v),
    'anios', coalesce((select jsonb_agg(a order by a.empresa, a.anio) from (
        select e.nombre_corto empresa, extract(year from v.fecha)::int anio, sum(v.lineas) lineas,
               count(*) filter (where v.tipo = 'factura' and v.tratamiento = 'venta') facturas,
               round(sum(v.neto_usd), 2) excel_usd,
               round(coalesce(sum(v.neto_usd) filter (where v.tratamiento = 'venta'), 0), 2) venta_usd,
               round(coalesce(sum(v.neto_usd) filter (where v.tratamiento = 'financiera'), 0), 2) financieras_usd,
               round(coalesce(sum(v.neto_usd) filter (where v.tratamiento = 'reverso'), 0), 2) reversos_usd,
               round(coalesce(sum(v.neto_usd) filter (where v.tratamiento = 'nd_cambiaria'), 0), 2) nd_cambiarias_usd,
               round(coalesce(sum(v.cantidad) filter (where v.tratamiento = 'venta'), 0), 0) unidades
        from v join empresas e on e.id = v.empresa_id group by 1, 2) a), '[]'::jsonb),
    'clientes', (select jsonb_build_object('total', count(*), 'con_pareja', count(*) filter (where con_pareja),
        'por_rif', count(*) filter (where metodo = 'rif'), 'por_nombre', count(*) filter (where metodo = 'nombre'),
        'por_documento', count(*) filter (where metodo = 'documento'),
        'pct_monto', round(100 * coalesce(sum(neto) filter (where con_pareja), 0) / nullif(sum(neto), 0), 1)) from cli),
    'productos', (select jsonb_build_object('total', count(*), 'con_pareja', count(*) filter (where con_pareja),
        'pct_monto', round(100 * coalesce(sum(neto) filter (where con_pareja), 0) / nullif(sum(neto), 0), 1)) from prod),
    'clientes_sin_pareja', coalesce((select jsonb_agg(x order by x.neto_usd desc) from (
        select e.nombre_corto empresa, cli.cliente_codigo codigo, cli.nombre, cli.rif, cli.lineas, round(cli.neto, 2) neto_usd, cli.ultima
        from cli join empresas e on e.id = cli.empresa_id where not cli.con_pareja order by cli.neto desc limit 200) x), '[]'::jsonb),
    'productos_sin_pareja', coalesce((select jsonb_agg(x order by x.neto_usd desc) from (
        select e.nombre_corto empresa, prod.articulo_codigo codigo, prod.descripcion, prod.categoria, prod.lineas,
               round(prod.unidades, 0) unidades, round(prod.neto, 2) neto_usd, prod.ultima
        from prod join empresas e on e.id = prod.empresa_id where not prod.con_pareja order by prod.neto desc limit 200) x), '[]'::jsonb),
    'vendedores', coalesce((select jsonb_agg(x order by x.empresa, x.neto_usd desc) from (
        select pv.id, e.nombre_corto empresa, pv.empresa_id, pv.codigo_profit codigo, pv.nombre_profit nombre, pv.vendedor_odoo,
               pv.propuesta_odoo, pv.estado, pv.revisado_at, nullif(trim(concat_ws(' ', u.nombre, u.apellido)), '') revisado_por,
               coalesce(vend.lineas, 0) lineas, round(coalesce(vend.neto, 0), 2) neto_usd, vend.desde, vend.hasta
        from profit_vendedores pv
        join empresas e on e.id = pv.empresa_id
        left join vend on vend.empresa_id = pv.empresa_id and vend.codigo = pv.codigo_profit and vend.nombre = pv.nombre_profit
        left join usuarios u on u.id = pv.revisado_por
        where pv.empresa_id = any(v_emp)) x), '[]'::jsonb),
    'candidatos', coalesce((select jsonb_agg(n order by n) from (
        select distinct upper(regexp_replace(trim(vendedor_odoo), '\s+', ' ', 'g')) n from facturas
        where nullif(trim(vendedor_odoo), '') is not null) c), '[]'::jsonb),
    'puede_editar', public.puede('reportes', 'editar')
  ) into v_res;
  return v_res;
end $$;
revoke execute on function public.estado_historico_profit() from public, anon;
grant execute on function public.estado_historico_profit() to authenticated;

-- Guarda (y valida) equivalencias: p_cambios = [{"id": uuid, "vendedor_odoo": "NOMBRE" | null}]. null = sin pareja
-- (se muestra el nombre de Profit). Solo administración (reportes: editar) y en la empresa activa.
create or replace function public.guardar_profit_vendedores(p_cambios jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare v_activa uuid; v_usuario uuid; r record; v_nombre text; n integer := 0;
begin
  if not public.puede('reportes', 'editar') then
    raise exception 'Solo administración puede editar las equivalencias de vendedores' using errcode = '42501';
  end if;
  v_activa := public.empresa_activa();
  if v_activa is null then
    raise exception 'Modo consulta ("Ambas empresas"): selecciona GUDS o Quirutec en el menú superior para hacer cambios.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_cambios) is distinct from 'array' or jsonb_array_length(p_cambios) = 0 or jsonb_array_length(p_cambios) > 500 then
    raise exception 'Envía entre 1 y 500 equivalencias' using errcode = '22023';
  end if;
  v_usuario := public.usuario_actual_id();
  for r in select * from jsonb_to_recordset(p_cambios) as x(id uuid, vendedor_odoo text) loop
    v_nombre := nullif(upper(regexp_replace(trim(coalesce(r.vendedor_odoo, '')), '\s+', ' ', 'g')), '');
    if v_nombre is not null and not exists (
      select 1 from facturas where upper(regexp_replace(trim(vendedor_odoo), '\s+', ' ', 'g')) = v_nombre) then
      raise exception 'El vendedor "%" no existe en Odoo', v_nombre using errcode = '22023';
    end if;
    update profit_vendedores set vendedor_odoo = v_nombre, estado = 'validado', revisado_por = v_usuario, revisado_at = now(),
           usuario_id = (select u.id from usuarios u where u.role = 'vendedor'
                          and upper(regexp_replace(trim(concat_ws(' ', u.nombre, u.apellido)), '\s+', ' ', 'g')) = v_nombre
                          order by u.activo desc nulls last, u.created_at limit 1)
    where id = r.id and empresa_id = v_activa;
    if not found then
      raise exception 'Equivalencia no encontrada en la empresa activa' using errcode = 'P0002';
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.guardar_profit_vendedores(jsonb) from public, anon;
grant execute on function public.guardar_profit_vendedores(jsonb) to authenticated;

notify pgrst, 'reload schema';

commit;
