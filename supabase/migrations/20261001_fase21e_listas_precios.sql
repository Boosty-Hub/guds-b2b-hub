-- ════════════════════════════════════════════════════════════════════════
-- Fase 21e · Listas de precios personalizadas (plan de revisión 30-sep, Fase 5 — parte sin escritura en Odoo).
--   En Odoo los productos están a 1 USD y el precio se escribe a mano al cotizar. GUDS arma listas propias con un
--   precio por producto, escrito a mano fila por fila (o importado de Excel/CSV), y las asigna a clientes.
--   precio_efectivo() ya usa precios_lista para el portal, el vendedor y los pedidos; el pedido que va a Odoo lleva el
--   precio por línea (price_unit), así que la cotización sale con el precio de la lista sin escribir la lista en Odoo.
--
--   · Lista "de GUDS" = listas_precios.odoo_id is null. La sincronización respeta la lista de GUDS asignada a un
--     cliente (importar.js); las de Odoo se siguen tomando de Odoo. Las listas de GUDS son en USD.
--   · precios_lista_historial: cada cambio (antes → después, quién, origen manual / masivo / importación / copia).
--   · precios_lista_cargas: registro de cada importación (archivo, conteos, no encontrados).
--   · guardar_precios_lista(lista, items, origen, archivo, no_encontrados): único camino de escritura de precios
--     (precio null = quitar → usa el precio base). asignar_lista_clientes(lista, clientes, quitar).
--   · Seguridad: precios_lista y listas_precios dejan de ser legibles por cualquier usuario con sesión; el personal con
--     permiso 'precios' ve todo, y el cliente o el vendedor solo la lista de sus clientes (listas_del_usuario()).
--   Permisos: módulo 'precios' (ver, crear, editar, eliminar). Nada para anon.
-- ════════════════════════════════════════════════════════════════════════
begin;

-- ── 1. Columnas ─────────────────────────────────────────────────────────
alter table public.listas_precios add column if not exists creada_por uuid references public.usuarios(id) on delete set null;
alter table public.precios_lista add column if not exists actualizado_por uuid references public.usuarios(id) on delete set null;
comment on column public.listas_precios.odoo_id is 'Lista de Odoo (product.pricelist). Null = lista creada en GUDS: la sincronización no la cambia en los clientes.';

-- ── 2. Historial y cargas ───────────────────────────────────────────────
create table if not exists public.precios_lista_cargas (
  id uuid primary key default gen_random_uuid(),
  lista_precios_id uuid not null references public.listas_precios(id) on delete cascade,
  empresa_id uuid references public.empresas(id),
  archivo text,
  filas integer not null default 0,
  nuevos integer not null default 0,
  cambiados integer not null default 0,
  quitados integer not null default 0,
  sin_cambio integer not null default 0,
  no_encontrados jsonb not null default '[]'::jsonb,
  usuario_id uuid references public.usuarios(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists precios_lista_cargas_lista on public.precios_lista_cargas (lista_precios_id, created_at desc);

create table if not exists public.precios_lista_historial (
  id bigint generated always as identity primary key,
  lista_precios_id uuid not null references public.listas_precios(id) on delete cascade,
  producto_id uuid not null references public.productos(id) on delete cascade,
  empresa_id uuid references public.empresas(id),
  precio_antes numeric,
  precio_despues numeric,
  origen text not null default 'manual' check (origen in ('manual', 'masivo', 'importacion', 'copia')),
  carga_id uuid references public.precios_lista_cargas(id) on delete set null,
  usuario_id uuid references public.usuarios(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists precios_lista_historial_lista on public.precios_lista_historial (lista_precios_id, created_at desc);
create index if not exists precios_lista_historial_prod on public.precios_lista_historial (lista_precios_id, producto_id, created_at desc);

alter table public.precios_lista_cargas enable row level security;
alter table public.precios_lista_historial enable row level security;
drop policy if exists empresa_visible on public.precios_lista_cargas;
create policy empresa_visible on public.precios_lista_cargas as restrictive for all to authenticated
  using (empresa_id is null or empresa_id = any ((select public.empresas_visibles())::uuid[]));
drop policy if exists cargas_ver on public.precios_lista_cargas;
create policy cargas_ver on public.precios_lista_cargas for select to authenticated using ((select public.puede('precios', 'ver')));
drop policy if exists empresa_visible on public.precios_lista_historial;
create policy empresa_visible on public.precios_lista_historial as restrictive for all to authenticated
  using (empresa_id is null or empresa_id = any ((select public.empresas_visibles())::uuid[]));
drop policy if exists historial_ver on public.precios_lista_historial;
create policy historial_ver on public.precios_lista_historial for select to authenticated using ((select public.puede('precios', 'ver')));
revoke all on public.precios_lista_cargas, public.precios_lista_historial from anon;
revoke insert, update, delete on public.precios_lista_cargas, public.precios_lista_historial from authenticated;

-- ── 3. Lectura: fuera el "cualquiera con sesión lee todo" ───────────────
-- Listas de los clientes del usuario: las suyas (portal) o las de su cartera (vendedor).
create or replace function public.listas_del_usuario()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct c.lista_precios_id) filter (where c.lista_precios_id is not null), '{}')
    from clientes c
   where c.id = any (public.clientes_del_usuario())
      or c.id in (select public.mis_clientes_vendedor());
$$;
revoke all on function public.listas_del_usuario() from public, anon;
grant execute on function public.listas_del_usuario() to authenticated;

drop policy if exists precios_lista_auth_read on public.precios_lista;
drop policy if exists precios_lista_de_mis_clientes on public.precios_lista;
create policy precios_lista_de_mis_clientes on public.precios_lista for select to authenticated
  using (lista_precios_id = any ((select public.listas_del_usuario())::uuid[]));
drop policy if exists listas_precios_auth_read on public.listas_precios;
drop policy if exists listas_precios_de_mis_clientes on public.listas_precios;
create policy listas_precios_de_mis_clientes on public.listas_precios for select to authenticated
  using (id = any ((select public.listas_del_usuario())::uuid[]));

-- ── 4. Guardar precios (manual, masivo, importación, copia) ─────────────
-- p_items: [{producto_id, precio}] — precio null o vacío = quitar (vuelve al precio base).
create or replace function public.guardar_precios_lista(
  p_lista uuid, p_items jsonb, p_origen text default 'manual', p_archivo text default null, p_no_encontrados jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid; v_lista listas_precios; v_carga uuid;
  v_nuevos int := 0; v_cambiados int := 0; v_quitados int := 0; v_igual int := 0; v_filas int := 0;
  it jsonb; v_prod uuid; v_precio numeric; v_antes numeric; v_emp_prod uuid; v_ok boolean;
begin
  if auth.uid() is null then raise exception 'Sin sesión' using errcode = '42501'; end if;
  if not (public.puede('precios', 'editar') or public.puede('precios', 'crear')) then
    raise exception 'No tienes permiso para editar precios' using errcode = '42501';
  end if;
  if p_origen not in ('manual', 'masivo', 'importacion', 'copia') then raise exception 'Origen no válido' using errcode = '22023'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'No hay precios para guardar' using errcode = '22023'; end if;
  if jsonb_array_length(p_items) > 5000 then raise exception 'Demasiadas filas (máximo 5.000 por vez)' using errcode = '22023'; end if;
  select * into v_lista from listas_precios where id = p_lista;
  if not found then raise exception 'Lista no encontrada' using errcode = 'P0002'; end if;
  if v_lista.empresa_id is not null and not (v_lista.empresa_id = any (public.empresas_visibles())) then
    raise exception 'La lista es de otra empresa' using errcode = '42501';
  end if;
  if v_lista.odoo_id is not null then
    raise exception 'Esta lista viene de Odoo: sus precios se cambian en Odoo. Crea una lista de GUDS para precios personalizados.' using errcode = 'P0001';
  end if;
  select id into v_uid from usuarios where auth_id = auth.uid();

  if p_origen = 'importacion' then
    insert into precios_lista_cargas (lista_precios_id, empresa_id, archivo, usuario_id, no_encontrados)
    values (p_lista, v_lista.empresa_id, left(p_archivo, 200), v_uid, coalesce(p_no_encontrados, '[]'::jsonb))
    returning id into v_carga;
  end if;

  for it in select * from jsonb_array_elements(p_items) loop
    v_filas := v_filas + 1;
    v_prod := nullif(it ->> 'producto_id', '')::uuid;
    v_precio := case when nullif(btrim(coalesce(it ->> 'precio', '')), '') is null then null else (it ->> 'precio')::numeric end;
    if v_precio is not null and (v_precio < 0 or v_precio > 1e9) then
      raise exception 'Precio no válido (%): debe ser 0 o mayor', v_precio using errcode = '22023';
    end if;
    v_precio := round(v_precio, 4);
    select p.empresa_id, true into v_emp_prod, v_ok from productos p where p.id = v_prod;
    if v_ok is null then raise exception 'Producto no encontrado' using errcode = 'P0002'; end if;
    if v_lista.empresa_id is not null and v_emp_prod is not null and v_emp_prod <> v_lista.empresa_id then
      raise exception 'Un producto es de otra empresa que la lista' using errcode = '22023';
    end if;
    v_ok := null;
    select precio into v_antes from precios_lista where lista_precios_id = p_lista and producto_id = v_prod;
    if not found then v_antes := null; end if;

    if v_precio is null then
      if v_antes is null then v_igual := v_igual + 1; continue; end if;
      delete from precios_lista where lista_precios_id = p_lista and producto_id = v_prod;
      v_quitados := v_quitados + 1;
    elsif v_antes is null then
      insert into precios_lista (lista_precios_id, producto_id, precio, empresa_id, actualizado_por)
      values (p_lista, v_prod, v_precio, v_lista.empresa_id, v_uid);
      v_nuevos := v_nuevos + 1;
    elsif v_antes = v_precio then
      v_igual := v_igual + 1; continue;
    else
      update precios_lista set precio = v_precio, updated_at = now(), actualizado_por = v_uid
       where lista_precios_id = p_lista and producto_id = v_prod;
      v_cambiados := v_cambiados + 1;
    end if;
    insert into precios_lista_historial (lista_precios_id, producto_id, empresa_id, precio_antes, precio_despues, origen, carga_id, usuario_id)
    values (p_lista, v_prod, v_lista.empresa_id, v_antes, v_precio, p_origen, v_carga, v_uid);
  end loop;

  update listas_precios set updated_at = now() where id = p_lista;
  if v_carga is not null then
    update precios_lista_cargas set filas = v_filas, nuevos = v_nuevos, cambiados = v_cambiados, quitados = v_quitados, sin_cambio = v_igual
     where id = v_carga;
  end if;
  return jsonb_build_object('nuevos', v_nuevos, 'cambiados', v_cambiados, 'quitados', v_quitados, 'sin_cambio', v_igual, 'carga_id', v_carga);
end $$;
revoke all on function public.guardar_precios_lista(uuid, jsonb, text, text, jsonb) from public, anon;
grant execute on function public.guardar_precios_lista(uuid, jsonb, text, text, jsonb) to authenticated;

-- ── 5. Asignar la lista a clientes ──────────────────────────────────────
-- Quitar deja el cliente sin lista: la próxima sincronización le pone la de Odoo (hoy "Predeterminado").
create or replace function public.asignar_lista_clientes(p_lista uuid, p_clientes uuid[], p_quitar boolean default false)
returns integer language plpgsql security definer set search_path = public as $$
declare v_lista listas_precios; v_n integer; v_ajenos integer;
begin
  if auth.uid() is null then raise exception 'Sin sesión' using errcode = '42501'; end if;
  if not public.puede('precios', 'editar') then raise exception 'No tienes permiso para asignar listas' using errcode = '42501'; end if;
  select * into v_lista from listas_precios where id = p_lista;
  if not found then raise exception 'Lista no encontrada' using errcode = 'P0002'; end if;
  if v_lista.odoo_id is not null then
    raise exception 'Esta lista viene de Odoo: se asigna en Odoo.' using errcode = 'P0001';
  end if;
  if coalesce(array_length(p_clientes, 1), 0) = 0 then return 0; end if;
  select count(*) into v_ajenos from clientes c
   where c.id = any (p_clientes)
     and ((v_lista.empresa_id is not null and c.empresa_id is distinct from v_lista.empresa_id)
          or not (c.empresa_id = any (public.empresas_visibles())));
  if v_ajenos > 0 then raise exception 'Hay clientes de otra empresa que la lista' using errcode = '22023'; end if;
  if p_quitar then
    update clientes set lista_precios_id = null, updated_at = now() where id = any (p_clientes) and lista_precios_id = p_lista;
  else
    if not v_lista.activo then raise exception 'La lista está inactiva' using errcode = 'P0001'; end if;
    update clientes set lista_precios_id = p_lista, updated_at = now() where id = any (p_clientes) and lista_precios_id is distinct from p_lista;
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.asignar_lista_clientes(uuid, uuid[], boolean) from public, anon;
grant execute on function public.asignar_lista_clientes(uuid, uuid[], boolean) to authenticated;

notify pgrst, 'reload schema';
commit;
