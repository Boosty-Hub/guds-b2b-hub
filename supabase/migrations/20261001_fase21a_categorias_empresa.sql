-- ════════════════════════════════════════════════════════════════════════
-- Fase 21a · 1.1 Categorías por empresa (plan de revisión del 30-sep).
--   Odoo no asigna compañía a product.category, así que la empresa de cada categoría se deriva de sus productos:
--     · categorias.empresas  = empresas de sus productos (un producto compartido —empresa_id vacío— cuenta en las dos).
--                              Vacío = categoría sin productos (creada en GUDS o sin uso): se ve en las dos.
--     · categorias.de_venta  = tiene al menos un producto vendible (sale_ok de Odoo). Las de gastos de importación,
--                              servicios internos o "Todos / Entregas" quedan en false y el portal no las ofrece.
--     · categorias.etiqueta / grupo (generadas): "MATERIAL MEDICO QUIRURGICO / GUANTES" → etiqueta "GUANTES",
--                              grupo "MATERIAL MEDICO QUIRURGICO", para mostrarlas como subcategorías.
--   Se recalculan al sincronizar (el importador llama a recalcular_categorias_empresas(): escribe en modo réplica, sin
--   disparadores) y, para los cambios hechos en GUDS, con un disparador por sentencia en productos.
--   categorias.activo pasa a ser el interruptor manual "Mostrar en el portal" (el portal lo respeta desde ahora). Las 7
--   categorías que la carga del 14-ago dejó inactivas se reactivan: el portal ya las mostraba (ignoraba activo), así que
--   no cambia lo que ve el cliente.
-- ════════════════════════════════════════════════════════════════════════
begin;

alter table public.categorias
  add column if not exists empresas uuid[] not null default '{}',
  add column if not exists de_venta boolean not null default false,
  add column if not exists etiqueta text generated always as (btrim(regexp_replace(nombre, '^.*/', ''))) stored,
  add column if not exists grupo text generated always as (nullif(btrim(substring(nombre from '^(.*)/[^/]*$')), '')) stored;

comment on column public.categorias.empresas is 'Empresas de sus productos (derivado; un producto compartido cuenta en todas). Vacío = sin productos.';
comment on column public.categorias.de_venta is 'Tiene algún producto vendible (derivado). Si es false el portal no la ofrece.';
comment on column public.categorias.activo is 'Interruptor manual: mostrar la categoría en el portal del cliente y del vendedor.';

create index if not exists categorias_empresas_gin on public.categorias using gin (empresas);

-- Recalcula empresas y de_venta de todas las categorías (19 filas: barato). Interna.
create or replace function public.recalcular_categorias_empresas()
returns integer language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with x as (
    select c.id,
      coalesce((select array_agg(distinct e.id order by e.id) from productos p join empresas e on p.empresa_id = e.id or p.empresa_id is null
                where p.categoria_id = c.id), '{}'::uuid[]) empresas,
      exists (select 1 from productos p where p.categoria_id = c.id and coalesce(p.vendible, true)) de_venta
    from categorias c
  ), u as (
    update categorias c set empresas = x.empresas, de_venta = x.de_venta
    from x where c.id = x.id and (c.empresas, c.de_venta) is distinct from (x.empresas, x.de_venta)
    returning 1
  )
  select count(*) into n from u;
  return n;
end $$;
revoke all on function public.recalcular_categorias_empresas() from public, anon, authenticated;

create or replace function public.trg_productos_recalcular_categorias()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.recalcular_categorias_empresas();
  return null;
end $$;
revoke all on function public.trg_productos_recalcular_categorias() from public, anon, authenticated;

drop trigger if exists zz_recalcular_categorias_ins on public.productos;
drop trigger if exists zz_recalcular_categorias_upd on public.productos;
drop trigger if exists zz_recalcular_categorias_del on public.productos;
create trigger zz_recalcular_categorias_ins after insert on public.productos
  for each statement execute function public.trg_productos_recalcular_categorias();
create trigger zz_recalcular_categorias_upd after update of categoria_id, empresa_id, vendible on public.productos
  for each statement execute function public.trg_productos_recalcular_categorias();
create trigger zz_recalcular_categorias_del after delete on public.productos
  for each statement execute function public.trg_productos_recalcular_categorias();

select public.recalcular_categorias_empresas();

-- Interruptor manual: las que dejó apagadas la carga del 14-ago (nadie las tocó después) vuelven a mostrarse
update public.categorias set activo = true
 where odoo_id is not null and not activo and updated_at < '2026-08-15';

-- ── Portal del cliente: categorías con productos vendibles y visibles de la empresa que compra ──
create or replace function public.categorias_portal()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  c record;
  v jsonb;
begin
  select * into c from public.portal_contexto();
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', cat.id, 'nombre', btrim(cat.nombre), 'etiqueta', cat.etiqueta, 'grupo', cat.grupo,
           'n', x.n, 'disponibles', x.d)
           order by public.texto_busqueda(coalesce(cat.grupo, cat.etiqueta)), cat.grupo is not null, public.texto_busqueda(cat.etiqueta)), '[]'::jsonb)
    into v
    from (select p.categoria_id, count(*) n,
                 count(*) filter (where (not coalesce(p.controla_stock, true)) or coalesce(p.stock_disponible, p.stock_actual, 0) > 0) d
            from productos p
           where p.activo and coalesce(p.vendible, true) and not coalesce(p.oculto_tienda, false)
             and (p.empresa_id = c.o_empresa or p.empresa_id is null) and p.categoria_id is not null
           group by p.categoria_id) x
    join categorias cat on cat.id = x.categoria_id
   where cat.activo;
  return v;
end $$;

-- ── Portal del vendedor (pedido nuevo): las mismas reglas con la empresa del cliente ──
create or replace function public.categorias_vendedor(p_cliente_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_emp uuid := public.vendedor_cliente_empresa(p_cliente_id);
  v jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', cat.id, 'etiqueta', cat.etiqueta, 'grupo', cat.grupo, 'n', x.n)
           order by public.texto_busqueda(cat.etiqueta)), '[]'::jsonb)
    into v
    from (select p.categoria_id, count(*) n from productos p
           where p.activo and coalesce(p.vendible, true) and (p.empresa_id = v_emp or p.empresa_id is null)
             and p.categoria_id is not null
           group by p.categoria_id) x
    join categorias cat on cat.id = x.categoria_id
   where cat.activo;
  return v;
end $$;

commit;
