-- ════════════════════════════════════════════════════════════════════════
-- Fase 21d · Plan de revisión 30-sep, Fase 6: la pestaña Reportes → "Calidad y cuadre" pasa de solo lectura a una
-- BANDEJA DE TRABAJO.
--
--   · calidad_tareas: una tarea por cada problema detectado (tipo + entidad), con estado pendiente / corregido /
--     explicado, responsable, comentario y su historial (calidad_tareas_historial). Por empresa (null = cliente
--     compartido o dato común de Odoo, visible desde las dos).
--   · calidad_detectar(): las reglas (las mismas de reporte_calidad_datos y reporte_cuadre_profit_odoo de 20q, más:
--     sin ciudad, sin estado, nombre de estado con punto en Odoo y diferenciales cambiarios). Interna, todas las empresas.
--   · calidad_sincronizar_tareas(): crea las tareas nuevas, refresca su detalle y CIERRA SOLA ("corregido",
--     cierre_automatico) la que ya no se detecta porque la sincronización trajo el dato corregido; si vuelve a
--     aparecer, la reabre. La corre pg_cron después de cada sincronización con Odoo (cada 15 min, lun–sáb) y de noche,
--     y al aplicarse en Odoo una corrección asistida (trigger en odoo_escrituras).
--   · Corrección asistida [escribe en Odoo]: calidad_corregir_direccion() encola, por la misma cola y función de 19w
--     (actualizar_contacto_cliente), la calle/ciudad/estado del cliente. Lo contable solo se señala (enlace a Odoo).
--   · calidad_actualizar_tareas(): responsable, comentario y "explicado" (con comentario obligatorio), en lote.
--   · calidad_seccion(): ocultar / volver a mostrar la sección al terminar (por empresa).
--   · reporte_cuadre_profit_odoo(): mismo resultado, ahora sobre cuadre_profit_odoo_base() (el cruce que comparte con
--     las tareas) y con el avance de la revisión ('revision').
-- Lectura con el permiso de reportes (ver); cambios con reportes (editar); la corrección asistida además exige poder
-- editar el cliente en Odoo (19w). Nada para anon. Idempotente.
-- ════════════════════════════════════════════════════════════════════════
begin;

-- ── 1. Tablas ─────────────────────────────────────────────────────────────
create table if not exists public.calidad_tareas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas(id),
  tipo text not null,
  grupo text not null check (grupo in ('calidad', 'cuadre')),
  entidad text not null check (entidad in ('cliente', 'producto', 'factura', 'pago', 'estado', 'profit_documento')),
  entidad_id uuid,
  clave text not null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'corregido', 'explicado')),
  responsable_id uuid references public.usuarios(id) on delete set null,
  comentario text check (length(comentario) <= 2000),
  detalle jsonb not null default '{}'::jsonb,
  escritura_id uuid references public.odoo_escrituras(id) on delete set null,
  detectada_at timestamptz not null default now(),
  vista_at timestamptz not null default now(),
  cerrada_at timestamptz,
  cerrada_por uuid references public.usuarios(id) on delete set null,
  cierre_automatico boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists calidad_tareas_unica
  on public.calidad_tareas (tipo, clave, coalesce(empresa_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists calidad_tareas_estado on public.calidad_tareas (grupo, tipo, estado);
create index if not exists calidad_tareas_entidad on public.calidad_tareas (entidad_id);
create index if not exists calidad_tareas_escritura on public.calidad_tareas (escritura_id) where escritura_id is not null;

create table if not exists public.calidad_tareas_historial (
  id uuid primary key default gen_random_uuid(),
  tarea_id uuid not null references public.calidad_tareas(id) on delete cascade,
  empresa_id uuid references public.empresas(id),
  at timestamptz not null default now(),
  usuario_id uuid references public.usuarios(id) on delete set null,
  usuario_nombre text,
  accion text not null check (accion in ('detectada', 'corregida', 'reabierta', 'explicada', 'pendiente', 'responsable',
                                          'comentario', 'enviada_odoo')),
  de text,
  a text,
  comentario text,
  detalle jsonb
);
create index if not exists calidad_tareas_historial_tarea on public.calidad_tareas_historial (tarea_id, at desc);

alter table public.calidad_tareas enable row level security;
alter table public.calidad_tareas_historial enable row level security;

drop policy if exists calidad_tareas_ver on public.calidad_tareas;
create policy calidad_tareas_ver on public.calidad_tareas for select to authenticated
  using ((select public.puede('reportes', 'ver')));
drop policy if exists empresa_visible on public.calidad_tareas;
create policy empresa_visible on public.calidad_tareas as restrictive for all to authenticated
  using (empresa_id is null or empresa_id = any ((select public.empresas_visibles())::uuid[]));

drop policy if exists calidad_tareas_historial_ver on public.calidad_tareas_historial;
create policy calidad_tareas_historial_ver on public.calidad_tareas_historial for select to authenticated
  using ((select public.puede('reportes', 'ver')));
drop policy if exists empresa_visible on public.calidad_tareas_historial;
create policy empresa_visible on public.calidad_tareas_historial as restrictive for all to authenticated
  using (empresa_id is null or empresa_id = any ((select public.empresas_visibles())::uuid[]));

-- Solo lectura por la API: todos los cambios pasan por las funciones de abajo
revoke all on public.calidad_tareas, public.calidad_tareas_historial from public, anon, authenticated;
grant select on public.calidad_tareas, public.calidad_tareas_historial to authenticated;

-- "Ambas empresas" = consulta; una tarea de la otra empresa no se toca (misma guardia que el resto de tablas)
drop trigger if exists z_guardia_empresa on public.calidad_tareas;
create trigger z_guardia_empresa before insert or update or delete on public.calidad_tareas
  for each row execute function public.trg_guardia_empresa();
drop trigger if exists update_calidad_tareas_updated_at on public.calidad_tareas;
create trigger update_calidad_tareas_updated_at before update on public.calidad_tareas
  for each row execute function public.update_updated_at();

-- ── 2. Cruce Profit ↔ Odoo (el de 20q, ahora reutilizable) ─────────────────
-- Una fila por saldo inicial de Odoo (fuente 'odoo', con su estado de cuadre) y una por factura "Pendiente" de Profit
-- que no llegó como saldo inicial (fuente 'sin_saldo').
create or replace function public.cuadre_profit_odoo_base(p_emp uuid[])
returns table (fuente text, id uuid, empresa_id uuid, cliente_id uuid, clase text, numero text, fecha date, estado_odoo text,
  total_usd numeric, saldo_usd numeric, documento integer, tipo_profit text, numero_profit text, fecha_profit date,
  total_profit numeric, neto_profit numeric, estatus_profit text, cliente_profit text, dif numeric, estado_cuadre text)
language sql stable security definer set search_path = public set work_mem = '32MB' as $$
  with lote as (select public.profit_lote_vigente() v),
  o as (
    select f.id, f.empresa_id, f.cliente_id, f.numero, f.fecha_emision, f.total_usd, f.saldo_usd, f.estado,
           case when f.tipo = 'nota_credito' then 'nc' when coalesce(f.es_nota_debito, false) then 'nd' else 'factura' end clase,
           ltrim(regexp_replace(upper(btrim(f.numero)), '^(NC|ND|N/C|N/D)\s*', ''), '0') num
    from facturas f
    where f.es_saldo_inicial and f.empresa_id = any(p_emp)
  ), p as (
    select d.documento, d.empresa_id, d.tipo, d.numero, d.fecha, d.total_usd, d.neto_usd, d.cliente_nombre, d.tratamiento, d.estatus_cobro estatus,
           case d.tipo when 'factura' then 'factura' when 'nota_debito' then 'nd' else 'nc' end clase,
           ltrim(upper(btrim(d.numero)), '0') num
    from profit_documentos d, lote
    where d.lote = lote.v and d.empresa_id = any(p_emp)
  ), par as (
    select distinct on (o.id) o.*, p.documento, p.tipo tipo_profit, p.numero numero_profit, p.fecha fecha_profit, p.total_usd total_profit,
           p.neto_usd neto_profit, p.estatus estatus_profit, p.cliente_nombre cliente_profit, o.total_usd - p.total_usd dif
    from o left join p on p.empresa_id = o.empresa_id and p.clase = o.clase and p.num = o.num and o.num <> ''
    order by o.id, abs(o.total_usd - p.total_usd) nulls last
  ), c as (
    select par.*, case when par.documento is null then 'solo_odoo'
                       when abs(par.dif) < 1 then 'cuadra'
                       when abs(par.dif - 0.03 * par.neto_profit) < 0.05 then 'pronto_pago'
                       when par.clase = 'nc' then 'nc_ambigua'
                       else 'difiere' end estado_cuadre
    from par
  )
  select 'odoo', c.id, c.empresa_id, c.cliente_id, c.clase, c.numero, c.fecha_emision, c.estado, c.total_usd, c.saldo_usd,
         c.documento, c.tipo_profit, c.numero_profit, c.fecha_profit, c.total_profit, c.neto_profit, c.estatus_profit, c.cliente_profit,
         c.dif, c.estado_cuadre
  from c
  union all
  -- Facturas "Pendiente" en Profit (sin anular) que no llegaron como saldo inicial a Odoo
  select 'sin_saldo', null, p.empresa_id, null, p.clase, p.numero, p.fecha, null, p.total_usd, null,
         p.documento, p.tipo, p.numero, p.fecha, p.total_usd, p.neto_usd, p.estatus, p.cliente_nombre, null, null
  from p
  where p.clase = 'factura' and p.estatus = 'Pendiente' and p.tratamiento = 'venta'
    and not exists (select 1 from c where c.documento = p.documento)
$$;

-- ── 3. Detección (todas las empresas; interna) ────────────────────────────
-- Las mismas reglas que reporte_calidad_datos() de 20q para clientes, productos, anuladas y cobros, más:
--   cliente_sin_ciudad / cliente_sin_estado (clientes activos), estado_con_punto (el NOMBRE del estado en Odoo trae un
--   punto, "Sucre." / "Bolivar.": se corrige en la configuración de Odoo, no por cliente; GUDS ya lo muestra sin punto),
--   cuadre_documento (saldos iniciales que no cuadran con Profit), cuadre_sin_saldo_inicial y cuadre_diferencial (notas
--   de débito o de crédito en bolívares de 0,00 USD: ajustes por diferencial cambiario, no son venta ni cambian saldos).
-- El detalle trae lo que la bandeja muestra y, para la corrección asistida, una sugerencia de ciudad y estado.
create or replace function public.calidad_detectar(p_tipos text[] default null)
returns table (tipo text, grupo text, entidad text, entidad_id uuid, clave text, empresa_id uuid, detalle jsonb)
language plpgsql stable security definer set search_path = public set work_mem = '32MB' as $$
#variable_conflict use_column
declare
  v_emp uuid[] := (select array_agg(e.id) from empresas e);
  v_hoy date := (now() at time zone 'America/Caracas')::date;
  quiere_cli boolean := p_tipos is null or p_tipos && array['cliente_estado_extranjero', 'cliente_sin_estado', 'cliente_sin_ciudad',
                          'estado_con_punto', 'cliente_sin_condicion', 'cliente_sin_rif'];
  quiere_prod boolean := p_tipos is null or p_tipos && array['producto_sin_costo', 'producto_sin_categoria', 'producto_categoria_inactiva'];
  quiere_cuadre boolean := p_tipos is null or p_tipos && array['cuadre_documento', 'cuadre_sin_saldo_inicial'];
begin
  if quiere_cli then
    return query
    with cli as (
      select c.* from clientes c where c.activo
    ), compras as (
      select f.cliente_id, max(f.fecha_emision) ultima,
             round(coalesce(sum(case when f.total <> 0 then f.subtotal * f.total_usd / f.total end) filter (where f.fecha_emision > v_hoy - 365), 0), 2) venta_12m
      from facturas f
      where f.estado = 'posted' and f.tipo = 'factura' and not f.es_saldo_inicial and f.cliente_id is not null
      group by 1
    ), ciudades as (
      -- Ciudades conocidas (≥ 2 clientes) para sugerir la de un cliente sin ciudad a partir de su calle
      select k, (array_agg(ciudad order by n desc))[1] ciudad, (array_agg(estado order by n desc))[1] estado, sum(n) n
      from (select translate(upper(btrim(c.ciudad)), 'ÁÉÍÓÚÜÑ', 'AEIOUUN') k, btrim(c.ciudad) ciudad, public.estado_ve(c.estado) estado, count(*) n
            from clientes c where nullif(btrim(c.ciudad), '') is not null group by 1, 2, 3) x
      where length(k) >= 4 and public.estado_ve(k) is null
      group by k having sum(n) >= 2
    ), estado_por_ciudad as (
      select translate(upper(btrim(c.ciudad)), 'ÁÉÍÓÚÜÑ', 'AEIOUUN') k, mode() within group (order by public.estado_ve(c.estado)) moda
      from clientes c where public.estado_ve(c.estado) is not null and c.estado !~ '\((?!VE\))[A-Z]{2}\)\s*$' and nullif(btrim(c.ciudad), '') is not null
      group by 1
    ), j as (
      select c.id, c.empresa_id, c.nombre_negocio, c.rif, c.estado, c.ciudad, c.calle, c.complemento, c.direccion, c.condicion_pago,
             c.vendedor_odoo, c.odoo_id, co.ultima, coalesce(co.venta_12m, 0) venta_12m,
             coalesce(nullif(btrim(c.ciudad), ''), sug.ciudad) sug_ciudad,
             coalesce(
               public.estado_ve(c.estado),   -- "Bolivar (EC)" → Bolívar (el de Venezuela con el mismo nombre)
               (select e.moda from estado_por_ciudad e where e.k = translate(upper(btrim(coalesce(nullif(btrim(c.ciudad), ''), sug.ciudad))), 'ÁÉÍÓÚÜÑ', 'AEIOUUN')),
               case when nullif(btrim(c.ciudad), '') is null then sug.estado end) sug_estado
      from cli c left join compras co on co.cliente_id = c.id
      left join lateral (
        select ci.ciudad, ci.estado from ciudades ci
        where nullif(btrim(c.ciudad), '') is null
          and translate(upper(coalesce(c.calle, c.direccion, '')), 'ÁÉÍÓÚÜÑ', 'AEIOUUN') ~ ('(^|[^A-Z])' || regexp_replace(ci.k, '([.()\[\]*+?^$|\\])', '\\\1', 'g') || '([^A-Z]|$)')
        order by length(ci.k) desc, ci.n desc limit 1) sug on true
    ), d as (
      select j.*, jsonb_build_object('cliente', j.nombre_negocio, 'rif', j.rif, 'estado', j.estado, 'ciudad', j.ciudad,
               'calle', coalesce(j.calle, j.direccion), 'complemento', j.complemento, 'condicion_pago', j.condicion_pago,
               'vendedor', j.vendedor_odoo, 'odoo_id', j.odoo_id, 'ultima_compra', j.ultima, 'venta_12m', j.venta_12m,
               'sugerido', jsonb_build_object('ciudad', j.sug_ciudad, 'estado', j.sug_estado)) det
      from j
    )
    select 'cliente_estado_extranjero', 'calidad', 'cliente', d.id, d.id::text, d.empresa_id, d.det from d
      where d.estado ~ '\((?!VE\))[A-Z]{2}\)\s*$'
    union all
    select 'cliente_sin_estado', 'calidad', 'cliente', d.id, d.id::text, d.empresa_id, d.det from d
      where nullif(btrim(coalesce(d.estado, '')), '') is null
    union all
    select 'cliente_sin_ciudad', 'calidad', 'cliente', d.id, d.id::text, d.empresa_id, d.det from d
      where nullif(btrim(coalesce(d.ciudad, '')), '') is null
    union all
    select 'cliente_sin_condicion', 'calidad', 'cliente', d.id, d.id::text, d.empresa_id, d.det from d
      where nullif(btrim(coalesce(d.condicion_pago, '')), '') is null
    union all
    select 'cliente_sin_rif', 'calidad', 'cliente', d.id, d.id::text, d.empresa_id, d.det from d
      where nullif(upper(btrim(coalesce(d.rif, ''))), 'N/D') is null
    union all
    -- Una tarea por nombre de estado (no por cliente): se corrige una vez en Odoo
    select 'estado_con_punto', 'calidad', 'estado', null, x.estado, null,
           jsonb_build_object('estado', x.estado, 'mostrado', public.estado_ve(x.estado), 'clientes', x.n,
             'donde', 'Odoo → Contactos → Configuración → Estados federales')
      from (select d.estado, count(*) n from d where d.estado ~ '\.\s*(\([A-Z]{2}\))?\s*$' group by 1) x;
  end if;

  if quiere_prod then
    return query
    with vendidos as (
      select i.producto_id, f.empresa_id, max(f.fecha_emision) ultima, round(sum(i.cantidad), 2) unidades,
             round(sum(i.subtotal * case when f.total <> 0 then f.total_usd / f.total else 0 end), 2) venta_usd
      from factura_items i join facturas f on f.id = i.factura_id
      where f.estado = 'posted' and f.tipo = 'factura' and not f.es_saldo_inicial and i.producto_id is not null and f.empresa_id = any(v_emp)
      group by 1, 2
    ), prod as (
      select v.producto_id id, v.empresa_id, p.sku, p.nombre, p.tipo_odoo, p.odoo_id, c.nombre categoria, c.activo categoria_activa,
             p.categoria_id, v.ultima, v.unidades, v.venta_usd,
             exists (select 1 from producto_costos pc where pc.producto_id = v.producto_id and pc.empresa_id = v.empresa_id and pc.costo > 0) con_costo
      from vendidos v join productos p on p.id = v.producto_id left join categorias c on c.id = p.categoria_id
    ), d as (
      select prod.*, jsonb_build_object('producto', prod.nombre, 'sku', prod.sku, 'categoria', prod.categoria, 'odoo_id', prod.odoo_id,
               'ultima_venta', prod.ultima, 'unidades', prod.unidades, 'venta_usd', prod.venta_usd,
               'motivo', case when prod.categoria_id is null then 'Sin categoría' else 'En la categoría raíz de Odoo' end) det
      from prod
    )
    select 'producto_sin_costo', 'calidad', 'producto', d.id, d.id::text, d.empresa_id, d.det from d
      where not d.con_costo and coalesce(d.tipo_odoo, '') <> 'service'
    union all
    select 'producto_sin_categoria', 'calidad', 'producto', d.id, d.id::text, d.empresa_id, d.det from d
      where d.categoria_id is null or upper(btrim(d.categoria)) in ('TODOS', 'TODOS Q', 'ALL')
    union all
    select 'producto_categoria_inactiva', 'calidad', 'producto', d.id, d.id::text, d.empresa_id, d.det - 'motivo' from d
      where d.categoria_id is not null and not coalesce(d.categoria_activa, true);
  end if;

  if p_tipos is null or 'factura_anulada_con_saldo' = any(p_tipos) then
    return query
    select 'factura_anulada_con_saldo', 'calidad', 'factura', f.id, f.id::text, f.empresa_id,
           jsonb_build_object('numero', f.numero, 'tipo', f.tipo, 'fecha', f.fecha_emision, 'cliente', cl.nombre_negocio,
             'estado_odoo', f.estado, 'estado_pago', f.estado_pago, 'odoo_id', f.odoo_id, 'es_saldo_inicial', f.es_saldo_inicial,
             'saldo_usd', round(coalesce(nullif(f.saldo_usd, 0), f.saldo_odoo_usd), 2),
             'motivo', case when f.estado = 'cancel' then 'Cancelada en Odoo con saldo' else 'Revertida con nota de crédito y aún con saldo' end)
    from facturas f left join clientes cl on cl.id = f.cliente_id
    where (f.estado = 'cancel' and abs(coalesce(f.saldo_odoo_usd, f.saldo_usd, 0)) > 0.009)
       or (f.estado = 'posted' and f.estado_pago = 'anulado' and abs(coalesce(f.saldo_usd, 0)) > 0.009);
  end if;

  if p_tipos is null or 'cobro_sin_aplicar' = any(p_tipos) then
    return query
    select 'cobro_sin_aplicar', 'calidad', 'pago', p.id, p.id::text, p.empresa_id,
           jsonb_build_object('numero', p.numero, 'fecha', coalesce(p.fecha_pago, (p.created_at at time zone 'America/Caracas')::date),
             'cliente', cl.nombre_negocio, 'banco', b.nombre, 'moneda', p.moneda, 'odoo_id', p.odoo_id,
             'monto_usd', round(p.monto, 2), 'aplicado_usd', round(coalesce(a.aplicado, 0), 2),
             'sin_aplicar_usd', round(p.monto - coalesce(a.aplicado, 0), 2))
    from pagos p
    left join (select pago_id, sum(monto_usd) aplicado from factura_aplicaciones where pago_id is not null group by 1) a on a.pago_id = p.id
    left join clientes cl on cl.id = p.cliente_id left join bancos b on b.id = p.banco_id
    where p.odoo_id is not null and p.estado = 'verificado' and not coalesce(p.es_igtf, false)
      and p.monto - coalesce(a.aplicado, 0) >= 1;
  end if;

  if quiere_cuadre then
    return query
    select case b.fuente when 'odoo' then 'cuadre_documento' else 'cuadre_sin_saldo_inicial' end, 'cuadre',
           case b.fuente when 'odoo' then 'factura' else 'profit_documento' end,
           b.id, case b.fuente when 'odoo' then b.id::text else b.clase || ':' || ltrim(upper(btrim(b.numero)), '0') end, b.empresa_id,
           jsonb_build_object('estado_cuadre', coalesce(b.estado_cuadre, 'sin_saldo_inicial'), 'clase', b.clase, 'numero', b.numero, 'fecha', b.fecha,
             'cliente', coalesce(cl.nombre_negocio, b.cliente_profit), 'rif', cl.rif, 'estado_odoo', b.estado_odoo,
             'odoo_id', f.odoo_id, 'total_odoo_usd', case when b.fuente = 'odoo' then round(b.total_usd, 2) end,
             'saldo_odoo_usd', round(b.saldo_usd, 2), 'tipo_profit', b.tipo_profit, 'numero_profit', b.numero_profit,
             'fecha_profit', b.fecha_profit, 'total_profit_usd', round(b.total_profit, 2), 'estatus_profit', b.estatus_profit,
             'diferencia_usd', round(b.dif, 2))
    from public.cuadre_profit_odoo_base(v_emp) b
    left join facturas f on f.id = b.id left join clientes cl on cl.id = b.cliente_id
    where b.fuente = 'sin_saldo' or b.estado_cuadre <> 'cuadra';
  end if;

  if p_tipos is null or 'cuadre_diferencial' = any(p_tipos) then
    return query
    select 'cuadre_diferencial', 'cuadre', 'factura', f.id, f.id::text, f.empresa_id,
           jsonb_build_object('estado_cuadre', 'diferencial', 'clase', case when f.tipo = 'nota_credito' then 'nc' else 'nd' end,
             'numero', f.numero, 'fecha', f.fecha_emision, 'cliente', cl.nombre_negocio, 'rif', cl.rif, 'odoo_id', f.odoo_id,
             'diario', f.diario_odoo, 'moneda', f.moneda, 'total_bs', round(f.total, 2), 'total_odoo_usd', round(f.total_usd, 2))
    from facturas f left join clientes cl on cl.id = f.cliente_id
    where f.estado = 'posted' and not f.es_saldo_inicial and (f.tipo = 'nota_credito' or f.es_nota_debito)
      and coalesce(f.moneda, '') <> 'USD'
      and abs(coalesce(f.total_usd, 0)) < 0.005 and abs(coalesce(f.saldo_usd, 0)) < 0.005;
  end if;
end $$;

-- ── 4. Sincronizar tareas con la detección ────────────────────────────────
create or replace function public.calidad_sincronizar_tareas(p_tipos text[] default null)
returns jsonb language plpgsql security definer set search_path = public set work_mem = '32MB' as $$
declare v_nuevas int := 0; v_cerradas int := 0; v_reabiertas int := 0; v_vistas int := 0;
begin
  -- Interna: ya validó quien la llama. La tarea es de su empresa aunque quien revisa esté en "Ambas".
  perform set_config('guds.bypass_guard', 'on', true);
  drop table if exists pg_temp._calidad_det;
  create temp table _calidad_det on commit drop as select * from public.calidad_detectar(p_tipos);
  create index on _calidad_det (tipo, clave);

  -- Las que siguen: se refresca el detalle (cifras, sugerencias) solo si cambió
  update calidad_tareas t set detalle = d.detalle, entidad_id = d.entidad_id, vista_at = now()
  from _calidad_det d
  where t.tipo = d.tipo and t.clave = d.clave and t.empresa_id is not distinct from d.empresa_id
    and (t.detalle is distinct from d.detalle or t.entidad_id is distinct from d.entidad_id);
  get diagnostics v_vistas = row_count;

  -- Corregidas que vuelven a aparecer → pendiente otra vez
  with r as (
    update calidad_tareas t set estado = 'pendiente', cerrada_at = null, cerrada_por = null, cierre_automatico = false
    from _calidad_det d
    where t.tipo = d.tipo and t.clave = d.clave and t.empresa_id is not distinct from d.empresa_id and t.estado = 'corregido'
    returning t.id, t.empresa_id)
  insert into calidad_tareas_historial (tarea_id, empresa_id, accion, de, a, usuario_nombre, comentario)
  select r.id, r.empresa_id, 'reabierta', 'corregido', 'pendiente', 'GUDS (automático)', 'El problema volvió a aparecer en la sincronización'
  from r;
  get diagnostics v_reabiertas = row_count;

  -- Nuevas
  with n as (
    insert into calidad_tareas (empresa_id, tipo, grupo, entidad, entidad_id, clave, detalle)
    select d.empresa_id, d.tipo, d.grupo, d.entidad, d.entidad_id, d.clave, d.detalle
    from _calidad_det d
    where not exists (select 1 from calidad_tareas t where t.tipo = d.tipo and t.clave = d.clave and t.empresa_id is not distinct from d.empresa_id)
    on conflict do nothing
    returning id, empresa_id)
  insert into calidad_tareas_historial (tarea_id, empresa_id, accion, a, usuario_nombre)
  select n.id, n.empresa_id, 'detectada', 'pendiente', 'GUDS (automático)' from n;
  get diagnostics v_nuevas = row_count;

  -- Las que ya no se detectan: la sincronización trajo el dato corregido → se cierran solas
  with prev as (
    select t.id, t.estado from calidad_tareas t
    where t.estado in ('pendiente', 'explicado') and (p_tipos is null or t.tipo = any(p_tipos))
      and not exists (select 1 from _calidad_det d where d.tipo = t.tipo and d.clave = t.clave and d.empresa_id is not distinct from t.empresa_id)
  ), c as (
    update calidad_tareas t set estado = 'corregido', cerrada_at = now(), cerrada_por = null, cierre_automatico = true
    from prev where t.id = prev.id
    returning t.id, t.empresa_id, prev.estado de)
  insert into calidad_tareas_historial (tarea_id, empresa_id, accion, de, a, usuario_nombre, comentario)
  select c.id, c.empresa_id, 'corregida', c.de, 'corregido', 'GUDS (automático)', 'La sincronización con Odoo trajo el dato corregido'
  from c;
  get diagnostics v_cerradas = row_count;

  -- Hora de la última revisión completa (la bandeja la muestra; calidad_revisar la usa para no repetir en menos de 1 min)
  if p_tipos is null then
    insert into configuracion (clave, valor, tipo, descripcion)
    values ('calidad_ultima_revision', now()::text, 'texto', 'Última revisión de la bandeja de calidad (Fase 21d)')
    on conflict (clave) do update set valor = excluded.valor, updated_at = now();
  end if;
  return jsonb_build_object('actualizadas', v_vistas, 'nuevas', v_nuevas, 'cerradas', v_cerradas, 'reabiertas', v_reabiertas, 'at', now());
end $$;

-- ── 5. Funciones para la bandeja (API) ────────────────────────────────────
create or replace function public.calidad_usuario_nombre() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim(concat_ws(' ', btrim(u.nombre), btrim(u.apellido))), ''), u.email, 'Usuario')
  from usuarios u where u.auth_id = auth.uid() limit 1
$$;

-- Revisar ahora (botón de la bandeja): como mucho una vez por minuto
create or replace function public.calidad_revisar() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_ultima timestamptz;
begin
  perform public.exigir_permiso_reportes();
  select nullif(valor, '')::timestamptz into v_ultima from configuracion where clave = 'calidad_ultima_revision';
  if v_ultima > now() - interval '1 minute' then
    return jsonb_build_object('omitida', true, 'at', v_ultima);
  end if;
  return public.calidad_sincronizar_tareas(null);
end $$;

-- Responsable, comentario y estado (pendiente / explicado) de una o varias tareas
create or replace function public.calidad_actualizar_tareas(p_ids uuid[], p_estado text default null,
  p_responsable uuid default null, p_quitar_responsable boolean default false, p_comentario text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_nombre text; v_com text := nullif(btrim(coalesce(p_comentario, '')), ''); n int := 0; r record;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión.' using errcode = '42501'; end if;
  if not public.puede('reportes', 'editar') then
    raise exception 'No tienes permiso para trabajar la bandeja de calidad.' using errcode = '42501';
  end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 then raise exception 'Elige al menos una tarea.' using errcode = '22023'; end if;
  if array_length(p_ids, 1) > 2000 then raise exception 'Demasiadas tareas a la vez (máximo 2000).' using errcode = '22023'; end if;
  if p_estado is not null and p_estado not in ('pendiente', 'explicado') then
    raise exception 'Estado no válido: "corregido" lo marca la sincronización cuando Odoo trae el dato corregido.' using errcode = '22023';
  end if;
  if length(coalesce(v_com, '')) > 2000 then raise exception 'El comentario es demasiado largo (máximo 2000 caracteres).' using errcode = '22023'; end if;
  if p_responsable is not null and not exists (select 1 from usuarios u where u.id = p_responsable and u.role = 'admin' and coalesce(u.activo, true)) then
    raise exception 'El responsable debe ser un usuario activo de administración.' using errcode = '22023';
  end if;
  select id into v_uid from usuarios where auth_id = auth.uid();
  v_nombre := public.calidad_usuario_nombre();

  for r in select t.* from calidad_tareas t
           where t.id = any(p_ids) and (t.empresa_id is null or t.empresa_id = any(public.empresas_visibles()))
           for update loop
    if p_estado = 'explicado' and r.estado <> 'explicado' and v_com is null and nullif(btrim(coalesce(r.comentario, '')), '') is null then
      raise exception 'Para marcar como explicado escribe por qué (comentario).' using errcode = '22023';
    end if;
    if p_estado is not null and r.estado = 'corregido' then
      raise exception 'La tarea ya está corregida: se reabre sola si el problema vuelve.' using errcode = 'P0001';
    end if;
    update calidad_tareas set
      estado = coalesce(p_estado, estado),
      responsable_id = case when p_quitar_responsable then null else coalesce(p_responsable, responsable_id) end,
      comentario = coalesce(v_com, comentario),
      cerrada_at = case when p_estado = 'explicado' and r.estado <> 'explicado' then now() when p_estado = 'pendiente' then null else cerrada_at end,
      cerrada_por = case when p_estado = 'explicado' and r.estado <> 'explicado' then v_uid when p_estado = 'pendiente' then null else cerrada_por end,
      cierre_automatico = case when p_estado is not null then false else cierre_automatico end
    where id = r.id;
    if p_estado is not null and p_estado <> r.estado then
      insert into calidad_tareas_historial (tarea_id, empresa_id, usuario_id, usuario_nombre, accion, de, a, comentario)
      values (r.id, r.empresa_id, v_uid, v_nombre, case p_estado when 'explicado' then 'explicada' else 'pendiente' end, r.estado, p_estado, v_com);
    elsif v_com is not null and v_com is distinct from r.comentario then
      insert into calidad_tareas_historial (tarea_id, empresa_id, usuario_id, usuario_nombre, accion, comentario)
      values (r.id, r.empresa_id, v_uid, v_nombre, 'comentario', v_com);
    end if;
    if (p_responsable is not null and p_responsable is distinct from r.responsable_id) or (p_quitar_responsable and r.responsable_id is not null) then
      insert into calidad_tareas_historial (tarea_id, empresa_id, usuario_id, usuario_nombre, accion, de, a)
      values (r.id, r.empresa_id, v_uid, v_nombre, 'responsable',
        (select public.calidad_nombre_usuario(r.responsable_id)), case when p_quitar_responsable then null else (select public.calidad_nombre_usuario(p_responsable)) end);
    end if;
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'No se encontraron las tareas (o son de otra empresa).' using errcode = 'P0002'; end if;
  return n;
end $$;

create or replace function public.calidad_nombre_usuario(p_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim(concat_ws(' ', btrim(u.nombre), btrim(u.apellido))), ''), u.email) from usuarios u where u.id = p_id
$$;

-- Personas que pueden ser responsables (administración activa)
create or replace function public.calidad_responsables()
returns table (id uuid, nombre text, email text)
language sql stable security definer set search_path = public as $$
  select u.id, coalesce(nullif(btrim(concat_ws(' ', btrim(u.nombre), btrim(u.apellido))), ''), u.email::text), u.email::text
  from usuarios u
  where public.puede('reportes', 'ver') and u.role = 'admin' and coalesce(u.activo, true)
  order by 2
$$;

-- Corrección asistida [escribe en Odoo]: calle / ciudad / estado del contacto del cliente, por la cola de 19w
create or replace function public.calidad_corregir_direccion(p_tarea uuid, p_datos jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare t record; v_esc uuid; v_uid uuid; v_nombre text; v_datos jsonb;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión.' using errcode = '42501'; end if;
  if not public.puede('reportes', 'editar') then
    raise exception 'No tienes permiso para trabajar la bandeja de calidad.' using errcode = '42501';
  end if;
  select * into t from calidad_tareas where id = p_tarea
    and (empresa_id is null or empresa_id = any(public.empresas_visibles()));
  if not found then raise exception 'Tarea no encontrada.' using errcode = 'P0002'; end if;
  if t.tipo not in ('cliente_estado_extranjero', 'cliente_sin_estado', 'cliente_sin_ciudad') or t.entidad_id is null then
    raise exception 'Esta tarea no tiene corrección asistida: se corrige en Odoo.' using errcode = 'P0001';
  end if;
  if t.estado = 'corregido' then raise exception 'La tarea ya está corregida.' using errcode = 'P0001'; end if;
  if t.empresa_id is not null and t.empresa_id is distinct from public.empresa_activa() then
    raise exception 'Elige la empresa del cliente en el menú superior para corregirlo.' using errcode = 'P0001';
  end if;
  -- Solo dirección: calle, complemento, ciudad, estado (actualizar_contacto_cliente valida formato, permisos y estado de Venezuela)
  v_datos := jsonb_build_object('calle', p_datos ->> 'calle', 'complemento', p_datos ->> 'complemento',
                                'ciudad', p_datos ->> 'ciudad', 'estado', p_datos ->> 'estado');
  v_esc := public.actualizar_contacto_cliente(t.entidad_id, v_datos);

  select id into v_uid from usuarios where auth_id = auth.uid();
  v_nombre := public.calidad_usuario_nombre();
  perform set_config('guds.bypass_guard', 'on', true);   -- también las tareas compartidas del mismo cliente
  with u as (
    update calidad_tareas set escritura_id = v_esc
    where entidad_id = t.entidad_id and tipo in ('cliente_estado_extranjero', 'cliente_sin_estado', 'cliente_sin_ciudad') and estado <> 'corregido'
    returning id, empresa_id)
  insert into calidad_tareas_historial (tarea_id, empresa_id, usuario_id, usuario_nombre, accion, detalle)
  select u.id, u.empresa_id, v_uid, v_nombre, 'enviada_odoo',
         jsonb_build_object('escritura_id', v_esc, 'antes', jsonb_build_object('calle', t.detalle ->> 'calle', 'ciudad', t.detalle ->> 'ciudad', 'estado', t.detalle ->> 'estado'),
           'despues', v_datos)
  from u;
  return v_esc;
end $$;

-- Ocultar la sección al terminar (por empresa). Sin argumento: solo consulta. En "Ambas" está oculta si lo está en las dos.
create or replace function public.calidad_seccion(p_ocultar boolean default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_emp uuid; v_vis uuid[];
begin
  perform public.exigir_permiso_reportes();
  select coalesce(valor, '{}')::jsonb into v from configuracion where clave = 'calidad_seccion_oculta';
  v := coalesce(v, '{}'::jsonb);
  if p_ocultar is not null then
    if not public.puede('reportes', 'editar') then
      raise exception 'No tienes permiso para ocultar la sección.' using errcode = '42501';
    end if;
    v_emp := public.empresa_activa();
    if v_emp is null then
      raise exception 'Modo consulta ("Ambas empresas"): selecciona GUDS o Quirutec en el menú superior para hacer cambios.' using errcode = 'P0001';
    end if;
    v := case when p_ocultar
              then v || jsonb_build_object(v_emp::text, jsonb_build_object('por', public.calidad_usuario_nombre(), 'at', now()))
              else v - v_emp::text end;
    insert into configuracion (clave, valor, tipo, descripcion)
    values ('calidad_seccion_oculta', v::text, 'json', 'Reportes → Calidad y cuadre oculta por empresa (Fase 21d)')
    on conflict (clave) do update set valor = excluded.valor, updated_at = now();
  end if;
  v_vis := public.empresas_visibles();
  return jsonb_build_object(
    'revisado', (select nullif(valor, '')::timestamptz from configuracion where clave = 'calidad_ultima_revision'),
    'oculta', coalesce(array_length(v_vis, 1), 0) > 0 and (select bool_and(v ? e::text) from unnest(v_vis) e),
    'detalle', (select coalesce(jsonb_object_agg(k, v -> k), '{}'::jsonb) from jsonb_object_keys(v) k where k::uuid = any(v_vis)));
end $$;

-- ── 6. Al aplicarse en Odoo una corrección asistida, se reevalúan las tareas de clientes ──
create or replace function public.trg_calidad_escritura_hecha() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'hecha' and old.estado is distinct from 'hecha'
     and exists (select 1 from calidad_tareas t where t.escritura_id = new.id) then
    begin
      perform public.calidad_sincronizar_tareas(array['cliente_estado_extranjero', 'cliente_sin_estado', 'cliente_sin_ciudad', 'estado_con_punto']);
    exception when others then
      raise warning 'calidad: no se pudieron reevaluar las tareas tras la escritura %: %', new.id, sqlerrm;
    end;
  end if;
  return null;
end $$;
drop trigger if exists z_calidad_escritura_hecha on public.odoo_escrituras;
create trigger z_calidad_escritura_hecha after update of estado on public.odoo_escrituras
  for each row execute function public.trg_calidad_escritura_hecha();

-- ── 7. reporte_cuadre_profit_odoo(): mismo JSON de 20q sobre la base común + avance de la revisión ──
create or replace function public.reporte_cuadre_profit_odoo() returns jsonb
language plpgsql stable security definer set search_path = public set work_mem = '32MB' as $$
declare v_emp uuid[]; v_lote bigint; v_res jsonb;
begin
  perform public.exigir_permiso_reportes();
  v_emp := public.empresas_visibles();
  v_lote := public.profit_lote_vigente();
  with b as (select * from public.cuadre_profit_odoo_base(v_emp)),
  c as (select b.*, b.total_profit tp from b where b.fuente = 'odoo'),
  sin_saldo as (select * from b where b.fuente = 'sin_saldo')
  select jsonb_build_object(
    'lote', v_lote,
    'ventana_desde', '2024-12-01',
    'totales', (select jsonb_build_object(
        'documentos', count(*),
        'cuadran', count(*) filter (where estado_cuadre = 'cuadra'),
        'cuadran_odoo_usd', round(coalesce(sum(total_usd) filter (where estado_cuadre = 'cuadra'), 0), 2),
        'cuadran_profit_usd', round(coalesce(sum(tp) filter (where estado_cuadre = 'cuadra'), 0), 2),
        'pronto_pago', count(*) filter (where estado_cuadre = 'pronto_pago'),
        'pronto_pago_usd', round(coalesce(sum(dif) filter (where estado_cuadre = 'pronto_pago'), 0), 2),
        'difieren', count(*) filter (where estado_cuadre = 'difiere'),
        'nc_ambiguas', count(*) filter (where estado_cuadre = 'nc_ambigua'),
        'solo_odoo', count(*) filter (where estado_cuadre = 'solo_odoo'),
        'pendientes_profit', count(*) filter (where estado_cuadre = 'cuadra' and estatus_profit = 'Pendiente'),
        'ventana_cuadran', count(*) filter (where estado_cuadre = 'cuadra' and fecha >= '2024-12-01'),
        'ventana_odoo_usd', round(coalesce(sum(total_usd) filter (where estado_cuadre = 'cuadra' and fecha >= '2024-12-01'), 0), 2),
        'ventana_profit_usd', round(coalesce(sum(tp) filter (where estado_cuadre = 'cuadra' and fecha >= '2024-12-01'), 0), 2),
        'sin_saldo_inicial', (select count(*) from sin_saldo),
        'sin_saldo_inicial_usd', (select round(coalesce(sum(total_usd), 0), 2) from sin_saldo))
      from c),
    'resumen', coalesce((select jsonb_agg(x order by x.empresa, x.clase, x.estado) from (
        select e.nombre_corto empresa, c.clase, c.estado_cuadre estado, count(*) documentos,
               round(sum(c.total_usd), 2) odoo_usd, round(coalesce(sum(c.tp), 0), 2) profit_usd, round(coalesce(sum(c.dif), 0), 2) diferencia_usd
        from c join empresas e on e.id = c.empresa_id group by 1, 2, 3) x), '[]'::jsonb),
    -- Avance de la revisión uno a uno (bandeja de tareas): por tipo y estado de la tarea
    'revision', coalesce((select jsonb_agg(x) from (
        select t.tipo, coalesce(t.detalle ->> 'estado_cuadre', '') estado_cuadre, t.estado, count(*) n,
               round(coalesce(sum(abs(coalesce((t.detalle ->> 'diferencia_usd')::numeric, (t.detalle ->> 'total_odoo_usd')::numeric,
                 (t.detalle ->> 'total_profit_usd')::numeric, 0))), 0), 2) usd
        from calidad_tareas t
        where t.grupo = 'cuadre' and (t.empresa_id is null or t.empresa_id = any(v_emp))
        group by 1, 2, 3) x), '[]'::jsonb)
  ) into v_res;
  return v_res;
end $$;

-- ── 8. Permisos de ejecución ──────────────────────────────────────────────
-- Internas: nadie por la API (en Supabase "revoke ... from public" no basta: se revoca de anon y authenticated)
revoke execute on function public.cuadre_profit_odoo_base(uuid[]) from public, anon, authenticated;
revoke execute on function public.calidad_detectar(text[]) from public, anon, authenticated;
revoke execute on function public.calidad_sincronizar_tareas(text[]) from public, anon, authenticated;
revoke execute on function public.trg_calidad_escritura_hecha() from public, anon, authenticated;
revoke execute on function public.calidad_usuario_nombre() from public, anon, authenticated;
revoke execute on function public.calidad_nombre_usuario(uuid) from public, anon, authenticated;
-- De la bandeja: validan a quien llama
revoke execute on function public.calidad_revisar() from public, anon;
revoke execute on function public.calidad_actualizar_tareas(uuid[], text, uuid, boolean, text) from public, anon;
revoke execute on function public.calidad_responsables() from public, anon;
revoke execute on function public.calidad_corregir_direccion(uuid, jsonb) from public, anon;
revoke execute on function public.calidad_seccion(boolean) from public, anon;
revoke execute on function public.reporte_cuadre_profit_odoo() from public, anon;
grant execute on function public.calidad_revisar(), public.calidad_actualizar_tareas(uuid[], text, uuid, boolean, text),
  public.calidad_responsables(), public.calidad_corregir_direccion(uuid, jsonb), public.calidad_seccion(boolean),
  public.reporte_cuadre_profit_odoo() to authenticated;

-- ── 9. Programación: después de cada sincronización con Odoo (que corre a :00/:15/:30/:45) y de noche ──
select cron.unschedule(jobid) from cron.job where jobname in ('calidad-tareas', 'calidad-tareas-nocturna');
select cron.schedule('calidad-tareas', '7,22,37,52 11-23 * * 1-6', $$select public.calidad_sincronizar_tareas()$$);
select cron.schedule('calidad-tareas-nocturna', '40 6 * * *', $$select public.calidad_sincronizar_tareas()$$);

-- Primera carga
select public.calidad_sincronizar_tareas();

notify pgrst, 'reload schema';

commit;
