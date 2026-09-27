-- ════════════════════════════════════════════════════════════════════════
-- Fase 17a · Multiempresa: estructura base
--   GUDS SUPPLY, C.A. (Odoo company 1) y DISTRIBUIDORA MEDICO QUIRURGICA QUIRUTEC, C.A. (Odoo company 3)
--
-- Orden de aplicación:
--   1. esta migración (columnas empresa_id todavía opcionales)
--   2. node scripts/multiempresa-backfill.mjs --apply   (asigna empresa a lo existente leyendo Odoo)
--   3. 20260927_fase17b_multiempresa_reglas.sql          (NOT NULL, guardia, RLS, unicidad, numeración)
--
-- Contexto de empresa por petición: el frontend manda el header `x-empresa-id` (uuid de la empresa
-- o `todas`). Ver docs/PLAN-ESPEJO-ODOO.md (Fase 1).
-- ════════════════════════════════════════════════════════════════════════
begin;

-- ── 1. Empresas ──────────────────────────────────────────────────────────
create table if not exists public.empresas (
  id uuid primary key default gen_random_uuid(),
  odoo_company_id integer unique,
  nombre text not null,
  nombre_corto text not null,
  prefijo text not null unique,          -- prefijo de los documentos creados en GUDS (GUDS-ORD-00001)
  rif text,
  direccion text,
  ciudad text,
  estado text,
  telefono text,
  email text,
  sitio_web text,
  logo_url text,
  color text,                            -- color del distintivo en el selector del header
  activo boolean not null default true,
  orden integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.empresas (odoo_company_id, nombre, nombre_corto, prefijo, rif, direccion, ciudad, estado, color, orden)
values
  (1, 'GUDS SUPPLY, C.A.', 'GUDS', 'GUDS', 'J-410154438',
   'Av. Sanatorio del Ávila, C.C. Ciudad Center, Torre E, Nivel 7, Of. 727-728, Urb. Boleíta',
   'Caracas', 'Distrito Capital', '#8f1a1a', 1),
  (3, 'DISTRIBUIDORA MEDICO QUIRURGICA QUIRUTEC, C.A.', 'Quirutec', 'QRT', 'J-314567080',
   'Av. Sanatorio del Ávila, C.C. Ciudad Center, Torre E, Piso 7, Of. 728-E, Urb. Boleíta Norte',
   'Caracas', 'Distrito Capital', '#0e7490', 2)
on conflict (odoo_company_id) do nothing;

drop trigger if exists empresas_updated_at on public.empresas;
create trigger empresas_updated_at before update on public.empresas
  for each row execute function public.update_updated_at();

-- ── 2. Empresas asignadas a cada usuario ────────────────────────────────
create table if not exists public.usuario_empresas (
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  por_defecto boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (usuario_id, empresa_id)
);
create index if not exists usuario_empresas_empresa_idx on public.usuario_empresas (empresa_id);

-- ── 3. Contadores de numeración por empresa ─────────────────────────────
create table if not exists public.empresa_secuencias (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo text not null,                    -- ORD, PAG, CLI, F, RET, DC…
  ultimo integer not null default 0,
  primary key (empresa_id, tipo)
);

-- ── 4. Funciones de contexto ────────────────────────────────────────────
create or replace function public.usuario_actual_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from usuarios where auth_id = auth.uid();
$$;

-- Empresas que el usuario puede ver. Un administrador total sin empresas asignadas ve todas
-- (evita dejar fuera al admin por un olvido de configuración).
create or replace function public.empresas_permitidas()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(
    (select array_agg(ue.empresa_id order by e.orden)
       from usuario_empresas ue
       join usuarios u on u.id = ue.usuario_id
       join empresas e on e.id = ue.empresa_id
      where u.auth_id = auth.uid() and coalesce(u.activo, true) and e.activo),
    case when public.es_admin_total()
         then (select array_agg(id order by orden) from empresas where activo) end,
    '{}'::uuid[]);
$$;

-- Empresa pedida por el frontend en el header x-empresa-id (null = "todas" o sin header).
create or replace function public.empresa_solicitada()
returns uuid language plpgsql stable as $$
declare v text;
begin
  v := nullif(current_setting('request.headers', true), '')::json ->> 'x-empresa-id';
  if v is null or v = '' or v = 'todas' then return null; end if;
  return v::uuid;
exception when others then
  return null;
end $$;

-- Empresas visibles en esta petición: la pedida si está permitida; si no ("todas"), todas las permitidas.
create or replace function public.empresas_visibles()
returns uuid[] language sql stable security definer set search_path = public as $$
  select case when s.pedida is not null and s.pedida = any(s.permitidas) then array[s.pedida]
              else s.permitidas end
  from (select public.empresa_solicitada() pedida, public.empresas_permitidas() permitidas) s;
$$;

-- Empresa activa para escribir: la pedida si está permitida; null en modo "Ambas".
create or replace function public.empresa_activa()
returns uuid language sql stable security definer set search_path = public as $$
  select s.pedida
  from (select public.empresa_solicitada() pedida, public.empresas_permitidas() permitidas) s
  where s.pedida = any(s.permitidas);
$$;

create or replace function public.empresa_activa_requerida()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v uuid := public.empresa_activa();
begin
  if v is null then
    raise exception 'Selecciona una empresa (GUDS o Quirutec) en el menú superior: en "Ambas empresas" solo se puede consultar.'
      using errcode = 'P0001';
  end if;
  return v;
end $$;

-- ── 5. Columna empresa_id en las tablas de negocio (opcional hasta la 17b) ──
do $$
declare t text;
begin
  foreach t in array array[
    'productos','clientes','listas_precios','precios_lista','producto_empaques',
    'bancos','almacenes','inventario_almacen','movimientos_inventario',
    'cupones','banners','metas_vendedor','registros_clientes','notificaciones',
    'carrito','favoritos',
    'ordenes','orden_items','entregas',
    'facturas','factura_items',
    'pagos','pago_facturas','pago_ordenes','pago_cuentas','cuentas_cobrar',
    'movimientos_bancarios','extractos_bancarios','extracto_lineas',
    'declaraciones_consignacion','declaracion_consignacion_items',
    'retenciones','retencion_items'
  ] loop
    execute format('alter table public.%I add column if not exists empresa_id uuid references public.empresas(id)', t);
    execute format('create index if not exists %I on public.%I (empresa_id)', t || '_empresa_idx', t);
  end loop;
end $$;

-- ── 6. RLS de las tablas nuevas ─────────────────────────────────────────
alter table public.empresas enable row level security;
drop policy if exists empresas_lectura on public.empresas;
create policy empresas_lectura on public.empresas for select to anon, authenticated
  using (activo or public.es_admin_total());
drop policy if exists empresas_admin on public.empresas;
create policy empresas_admin on public.empresas for all to authenticated
  using (public.es_admin_total()) with check (public.es_admin_total());

alter table public.usuario_empresas enable row level security;
drop policy if exists usuario_empresas_lectura on public.usuario_empresas;
create policy usuario_empresas_lectura on public.usuario_empresas for select to authenticated
  using (usuario_id = public.usuario_actual_id() or public.puede('usuarios', 'ver'));
drop policy if exists usuario_empresas_admin on public.usuario_empresas;
create policy usuario_empresas_admin on public.usuario_empresas for all to authenticated
  using (public.puede('usuarios', 'editar')) with check (public.puede('usuarios', 'editar'));

-- Solo accesible por funciones security definer
alter table public.empresa_secuencias enable row level security;

commit;
