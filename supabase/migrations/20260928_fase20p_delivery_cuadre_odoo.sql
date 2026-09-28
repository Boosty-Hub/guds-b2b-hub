-- ════════════════════════════════════════════════════════════════════════
-- Fase 20p · Delivery D8: cuadre con Odoo (solo lectura) — docs/PLAN-PORTALES-Y-FLUJOS.md §6, plan-delivery.md §3.9 (Nivel 0)
--   En cada sincronización (inventario.js, después de escribir las transferencias de la empresa y de cerrar las entregas que
--   Odoo validó) se compara lo cerrado en GUDS con el estado del documento de entrega en Odoo. No escribe en Odoo.
--   Una fila por documento de entrega con al menos una entrega en GUDS (de los últimos 180 días):
--     · pendiente_odoo       entregada (completa o incompleta) en GUDS y el documento sigue abierto en Odoo (normal mientras
--                            odoo_escritura_entregas = 'simular');
--     · validada_sin_guds    validado en Odoo sin cierre de entrega del repartidor en GUDS (lo validó la oficina, o GUDS lo
--                            tiene rechazado, reprogramado o anulado);
--     · cantidades_distintas entregada en GUDS y validada en Odoo con otras cantidades (diferencia por producto);
--     · cancelada_odoo       entregada en GUDS y el documento se canceló en Odoo o ya no existe;
--     · cuadrada             entregada en GUDS y validada en Odoo con las mismas cantidades.
--   Los documentos abiertos en los dos lados (o solo con rechazo / reprogramación y abiertos en Odoo) no tienen fila.
-- ════════════════════════════════════════════════════════════════════════
begin;

create table if not exists public.cuadre_entregas_odoo (
  transferencia_odoo_id integer primary key,
  empresa_id uuid not null references public.empresas(id),
  transferencia_id uuid references public.transferencias(id) on delete set null,
  entrega_id uuid references public.entregas(id) on delete set null,
  doc_numero text,
  tipo text not null check (tipo in ('pendiente_odoo', 'validada_sin_guds', 'cantidades_distintas', 'cancelada_odoo', 'cuadrada')),
  estado_guds text,
  origen_cierre text,
  estado_odoo text,
  cerrada_guds_at timestamptz,
  validada_odoo_at timestamptz,
  lineas jsonb,
  detectado_at timestamptz not null default now(),
  revisado_at timestamptz not null default now()
);
comment on table public.cuadre_entregas_odoo is 'Cuadre de las entregas de GUDS con los documentos de entrega de Odoo (solo lectura). Lo recalcula la sincronización (cuadrar_entregas_odoo) por empresa; nadie lo escribe por la API.';
comment on column public.cuadre_entregas_odoo.lineas is 'Productos con diferencia: [{move_odoo_id, producto, guds, odoo, diferencia}] (diferencia = Odoo − GUDS)';
comment on column public.cuadre_entregas_odoo.detectado_at is 'Desde cuándo el documento está en este tipo de cuadre';
comment on column public.cuadre_entregas_odoo.revisado_at is 'Última sincronización que lo revisó';
create index if not exists cuadre_entregas_odoo_empresa on public.cuadre_entregas_odoo (empresa_id, tipo);

alter table public.cuadre_entregas_odoo enable row level security;
drop policy if exists cuadre_entregas_odoo_ver on public.cuadre_entregas_odoo;
create policy cuadre_entregas_odoo_ver on public.cuadre_entregas_odoo for select to authenticated
  using ((select public.es_personal_admin()) and (select public.puede('delivery', 'ver'))
    and empresa_id = any ((select public.empresas_visibles())::uuid[]));
revoke all on table public.cuadre_entregas_odoo from anon;
revoke insert, update, delete, truncate, references, trigger on table public.cuadre_entregas_odoo from authenticated;
grant select on table public.cuadre_entregas_odoo to authenticated;

-- Recalcula el cuadre de una empresa. Interna: la llama el importador (inventario.js) en cada sincronización.
create or replace function public.cuadrar_entregas_odoo(p_empresa uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_marca timestamptz := clock_timestamp(); v_res jsonb;
begin
  if p_empresa is null then raise exception 'Falta la empresa'; end if;

  with docs as (
    select distinct e.transferencia_odoo_id odoo_id from entregas e
    where e.empresa_id = p_empresa and e.transferencia_odoo_id is not null and e.created_at > now() - interval '180 days'
  ),
  -- Último cierre de entrega del repartidor en GUDS (completa o incompleta)
  g as (
    select distinct on (e.transferencia_odoo_id) e.transferencia_odoo_id odoo_id, e.id, e.estado::text estado, e.lineas, e.fecha_cierre
    from entregas e join docs d on d.odoo_id = e.transferencia_odoo_id
    where e.empresa_id = p_empresa and e.origen_cierre = 'guds' and e.estado in ('entregada', 'incompleta')
    order by e.transferencia_odoo_id, e.fecha_cierre desc nulls last, e.created_at desc
  ),
  -- Última entrega del documento (cualquier estado)
  u as (
    select distinct on (e.transferencia_odoo_id) e.transferencia_odoo_id odoo_id, e.id, e.estado::text estado, e.origen_cierre, e.fecha_cierre, e.doc_numero
    from entregas e join docs d on d.odoo_id = e.transferencia_odoo_id
    where e.empresa_id = p_empresa
    order by e.transferencia_odoo_id, e.created_at desc
  ),
  t as (select t.id, t.odoo_id, t.numero, t.estado, t.fecha_realizada from transferencias t join docs d on d.odoo_id = t.odoo_id),
  -- Diferencias por producto (por movimiento de Odoo) entre lo entregado en GUDS y lo validado en Odoo
  dif as (
    select g.odoo_id, jsonb_agg(jsonb_build_object('move_odoo_id', l.mv, 'producto', l.producto, 'guds', l.guds, 'odoo', l.odoo,
      'diferencia', l.odoo - l.guds) order by l.mv) lineas
    from g join t on t.odoo_id = g.odoo_id and t.estado = 'hecha'
    cross join lateral (
      select coalesce(a.mv, b.mv) mv, coalesce(a.producto, b.producto) producto, coalesce(a.q, 0) guds, coalesce(b.q, 0) odoo
      from (select (x->>'move_odoo_id')::int mv, x->>'producto' producto, coalesce((x->>'entregada')::numeric, 0) q
            from jsonb_array_elements(coalesce(g.lineas, '[]'::jsonb)) x) a
      full join (select ti.odoo_id mv, coalesce(ti.nombre_producto, p.nombre) producto,
                   case when ti.estado = 'cancelada' then 0 else coalesce(ti.cantidad_hecha, 0) end q
                 from transferencia_items ti left join productos p on p.id = ti.producto_id where ti.transferencia_id = t.id) b on a.mv = b.mv
    ) l
    where abs(l.guds - l.odoo) > 0.0001
    group by g.odoo_id
  ),
  clasif as (
    select d.odoo_id, t.id transferencia_id, coalesce(g.id, u.id) entrega_id, coalesce(t.numero, u.doc_numero) numero,
      case
        when g.id is not null and (t.id is null or t.estado = 'cancelada') then 'cancelada_odoo'
        when g.id is not null and t.estado <> 'hecha' then 'pendiente_odoo'
        when g.id is not null and dif.odoo_id is not null then 'cantidades_distintas'
        when g.id is not null then 'cuadrada'
        when t.estado = 'hecha' then 'validada_sin_guds'
      end tipo,
      coalesce(g.estado, u.estado) estado_guds, case when g.id is not null then 'guds' else u.origen_cierre end origen_cierre,
      coalesce(t.estado, 'no_existe') estado_odoo, coalesce(g.fecha_cierre, u.fecha_cierre) cerrada_guds_at, t.fecha_realizada validada_odoo_at,
      dif.lineas
    from docs d
    left join g on g.odoo_id = d.odoo_id
    left join u on u.odoo_id = d.odoo_id
    left join t on t.odoo_id = d.odoo_id
    left join dif on dif.odoo_id = d.odoo_id
  )
  insert into cuadre_entregas_odoo as c (transferencia_odoo_id, empresa_id, transferencia_id, entrega_id, doc_numero, tipo, estado_guds, origen_cierre,
    estado_odoo, cerrada_guds_at, validada_odoo_at, lineas, detectado_at, revisado_at)
  select k.odoo_id, p_empresa, k.transferencia_id, k.entrega_id, k.numero, k.tipo, k.estado_guds, k.origen_cierre, k.estado_odoo,
    k.cerrada_guds_at, k.validada_odoo_at, k.lineas, v_marca, v_marca
  from clasif k where k.tipo is not null
  on conflict (transferencia_odoo_id) do update set empresa_id = excluded.empresa_id, transferencia_id = excluded.transferencia_id,
    entrega_id = excluded.entrega_id, doc_numero = excluded.doc_numero, tipo = excluded.tipo, estado_guds = excluded.estado_guds,
    origen_cierre = excluded.origen_cierre, estado_odoo = excluded.estado_odoo, cerrada_guds_at = excluded.cerrada_guds_at,
    validada_odoo_at = excluded.validada_odoo_at, lineas = excluded.lineas,
    detectado_at = case when c.tipo is distinct from excluded.tipo then excluded.detectado_at else c.detectado_at end,
    revisado_at = excluded.revisado_at;

  -- Lo que ya no tiene nada que cuadrar (o salió de la ventana de 180 días)
  delete from cuadre_entregas_odoo where empresa_id = p_empresa and revisado_at < v_marca;

  select jsonb_build_object(
    'pendiente_odoo', count(*) filter (where tipo = 'pendiente_odoo'),
    'validada_sin_guds', count(*) filter (where tipo = 'validada_sin_guds'),
    'cantidades_distintas', count(*) filter (where tipo = 'cantidades_distintas'),
    'cancelada_odoo', count(*) filter (where tipo = 'cancelada_odoo'),
    'cuadrada', count(*) filter (where tipo = 'cuadrada'))
  into v_res from cuadre_entregas_odoo where empresa_id = p_empresa;
  return v_res;
end $$;

revoke execute on function public.cuadrar_entregas_odoo(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
