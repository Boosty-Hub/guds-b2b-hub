-- ════════════════════════════════════════════════════════════════════════
-- Fase 21b · Estado de cuenta a profundidad (plan de revisión 30-sep, fase 2: puntos 2.1 a 2.5)
--   Pedido de finanzas y dirección: por factura, cuánto era (base imponible e IVA), cuánto se ha abonado (pagos, notas de
--   crédito, retenciones y otros) y qué falta, sin cruzar a mano facturas contra pagos. Igual en admin, enlace público, PDF,
--   correo, portal del cliente y cartera del vendedor.
--
--   · factura_comentarios: comentario cualitativo por factura (solo GUDS). Visible para el cliente o interno; con autor y
--     fecha; NO se sobrescriben: editar = un comentario nuevo que reemplaza al anterior (queda en el historial), retirar =
--     se marca retirado. Se escriben solo por RPC (comentar_factura / retirar_comentario_factura); se leen por RLS (personal
--     con 'cuentas' ver o el vendedor del cliente) o por comentarios_factura (historial con autores). El cliente y el
--     enlace público solo reciben los visibles vigentes, por las funciones del estado de cuenta.
--   · estado_cuenta_documentos (interna): un renglón por documento con base, IVA y total (USD; y en Bs a la tasa del
--     documento si es en bolívares), lo abonado por tipo (pagos, NC, retenciones, otros), saldo, el desglose de cada abono
--     (fecha, tipo, documento, referencia, banco, moneda y monto) y "qué falta" sugerido por GUDS.
--       Semántica verificada (30-sep, 3.935 documentos): en facturas y notas de débito total_usd − saldo_usd = Σ de
--       factura_aplicaciones del documento (100 %); en notas de crédito |total| − |saldo| = lo aplicado sobre la nota
--       (retenciones, reintegros) + sus usos en otros documentos (factura_aplicaciones.documento_id, tipo nota_credito).
--       Se suman además los cobros de GUDS (pago_facturas de pagos verificados) y las retenciones aprobadas en GUDS que aún
--       no están en Odoo (retencion_items), igual que el saldo (columnas generadas monto_aplicado_usd y monto_retenido_usd).
--       Base e IVA en USD = subtotal e impuesto × total_usd / total (la tasa del documento; tasa_cambio no es fiable en
--       las facturas en Bs).
--   · "Qué falta" (sugerencia, nunca sustituye al comentario de una persona). Con tolerancia configurable
--     (configuracion.estado_cuenta_tolerancia_usd, por defecto 0,05 USD):
--       saldo ≈ IVA no retenido (IVA − retención ya aplicada)        → "Pendiente el IVA no retenido"
--       saldo ≈ % de retención de IVA del cliente × IVA, sin retención → "Retención de IVA por recibir"
--         (el % sale de su historial en esa empresa: 75 o 100; sin historial, 75 %)
--       saldo ≈ IVA, sin retención aplicada                            → "Pendiente el IVA"
--       saldo ≈ 3 % de los pagos en divisas (empresa con IGTF)         → "Pendiente el IGTF"
--       saldo ≈ 1,25 % de la base (cliente que retiene municipal)      → "Retención municipal por recibir"
--       combinaciones de dos de las anteriores; solo retenciones aplicadas → "Falta el pago (ya se aplicó la retención)";
--       lo único abonado equivale a la retención de IVA → "Falta el pago (solo se abonó el monto de la retención de IVA)";
--       saldo < 1 USD → "Diferencia menor"; si nada encaja (o no hay ningún abono): vacío.
--   · estado_cuenta_datos: 'abiertos' pasa a traer el cruce completo de los documentos con saldo (mismas claves de antes
--     más las nuevas); 'documentos' = cruce según filtro (todas las emitidas en el período o las pagadas en el período);
--     'desde_abierta' (fecha de la factura abierta más antigua) y p_desde_abierta: el período de movimientos empieza ahí
--     (punto 2.1). p_internos: comentarios internos y autores (solo admin).
--   · Las RPC públicas ganan p_filtro y p_desde_abierta (se recrean con la misma seguridad de 20w). El enlace público sigue
--     sin identificadores internos (ni de documentos, ni de cobros, ni de comentarios).
--   Nada de esto escribe en Odoo.
-- ════════════════════════════════════════════════════════════════════════
begin;

-- ── Configuración ──
insert into public.configuracion (clave, valor, tipo, descripcion)
values ('estado_cuenta_tolerancia_usd', '0.05', 'number',
        'Estado de cuenta: tolerancia (USD) para sugerir "qué falta" en una factura (IVA, IGTF, retenciones)')
on conflict (clave) do nothing;

create or replace function public.estado_cuenta_tolerancia()
returns numeric language sql stable security definer set search_path = public as $$
  select least(greatest(coalesce((select case when valor ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' then valor::numeric end
                                    from configuracion where clave = 'estado_cuenta_tolerancia_usd'), 0.05), 0), 5)
$$;
revoke all on function public.estado_cuenta_tolerancia() from public, anon, authenticated;

-- ── Comentarios por factura ──
create table if not exists public.factura_comentarios (
  id uuid primary key default gen_random_uuid(),
  factura_id uuid not null references public.facturas(id) on delete cascade,
  empresa_id uuid references public.empresas(id) on delete cascade,
  texto text not null check (length(btrim(texto)) between 1 and 500),
  visible_cliente boolean not null default true,
  autor_id uuid references public.usuarios(id) on delete set null,
  creado_at timestamptz not null default now(),
  reemplaza_id uuid references public.factura_comentarios(id) on delete set null,
  retirado_at timestamptz,
  retirado_por uuid references public.usuarios(id) on delete set null,
  retirado_motivo text check (retirado_motivo in ('retirado', 'reemplazado')),
  check ((retirado_at is null) = (retirado_motivo is null))
);
comment on table public.factura_comentarios is
  'Comentarios por factura (fase 21b, solo GUDS): historial, no se sobrescriben. Escritura solo por comentar_factura / retirar_comentario_factura.';
create index if not exists factura_comentarios_factura on public.factura_comentarios (factura_id, creado_at desc);

alter table public.factura_comentarios enable row level security;
revoke all on table public.factura_comentarios from public, anon, authenticated;
grant select on table public.factura_comentarios to authenticated;

drop policy if exists factura_comentarios_empresa on public.factura_comentarios;
create policy factura_comentarios_empresa on public.factura_comentarios as restrictive for select to authenticated
  using (empresa_id is null or empresa_id = any ((select public.empresas_visibles())::uuid[]));
drop policy if exists factura_comentarios_ver on public.factura_comentarios;
create policy factura_comentarios_ver on public.factura_comentarios for select to authenticated
  using (((select public.es_personal_admin()) and (select public.puede('cuentas', 'ver')))
         or factura_id in (select f.id from public.facturas f where f.cliente_id in (select public.mis_clientes_vendedor())));

-- Escribir un comentario (o reemplazar uno vigente). Administración con 'cuentas' editar, con la empresa del documento
-- elegida (regla de toda la plataforma).
create or replace function public.comentar_factura(
  p_factura_id uuid,
  p_texto text,
  p_visible boolean default true,
  p_reemplaza uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  f record;
  v_yo uuid := public.usuario_actual_id();
  v_activa uuid := public.empresa_activa();
  v_texto text := btrim(coalesce(p_texto, ''));
  v_ant public.factura_comentarios;
  c public.factura_comentarios;
begin
  if auth.uid() is null then raise exception 'No autenticado' using errcode = '42501'; end if;
  if not (public.es_personal_admin() and public.puede('cuentas', 'editar')) then
    raise exception 'No tienes permiso para comentar facturas' using errcode = '42501';
  end if;
  select id, empresa_id, cliente_id, estado into f from facturas where id = p_factura_id;
  if not found then raise exception 'Factura no encontrada' using errcode = 'P0002'; end if;
  if v_activa is null then
    raise exception 'Modo consulta ("Ambas empresas"): selecciona GUDS o Quirutec en el menú superior para comentar.' using errcode = 'P0001';
  end if;
  if f.empresa_id is not null and f.empresa_id <> v_activa then
    raise exception 'Esta factura pertenece a otra empresa. Cámbiala en el menú superior.' using errcode = 'P0001';
  end if;
  if length(v_texto) = 0 or length(v_texto) > 500 then
    raise exception 'El comentario debe tener entre 1 y 500 caracteres' using errcode = '22023';
  end if;
  if p_reemplaza is not null then
    select * into v_ant from factura_comentarios where id = p_reemplaza for update;
    if not found or v_ant.factura_id <> p_factura_id then
      raise exception 'El comentario que se reemplaza no es de esta factura' using errcode = '22023';
    end if;
    if v_ant.retirado_at is not null then
      raise exception 'Ese comentario ya fue reemplazado o retirado; recarga la página' using errcode = 'P0001';
    end if;
    update factura_comentarios set retirado_at = now(), retirado_por = v_yo, retirado_motivo = 'reemplazado' where id = v_ant.id;
  end if;
  insert into factura_comentarios (factura_id, empresa_id, texto, visible_cliente, autor_id, reemplaza_id)
  values (p_factura_id, coalesce(f.empresa_id, v_activa), v_texto, coalesce(p_visible, true), v_yo, p_reemplaza)
  returning * into c;
  return jsonb_build_object('id', c.id, 'texto', c.texto, 'visible', c.visible_cliente, 'fecha', c.creado_at);
end $$;
revoke all on function public.comentar_factura(uuid, text, boolean, uuid) from public, anon;
grant execute on function public.comentar_factura(uuid, text, boolean, uuid) to authenticated;

create or replace function public.retirar_comentario_factura(p_comentario_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  c public.factura_comentarios;
  v_activa uuid := public.empresa_activa();
begin
  if auth.uid() is null then raise exception 'No autenticado' using errcode = '42501'; end if;
  if not (public.es_personal_admin() and public.puede('cuentas', 'editar')) then
    raise exception 'No tienes permiso para retirar comentarios' using errcode = '42501';
  end if;
  select * into c from factura_comentarios where id = p_comentario_id for update;
  if not found then raise exception 'Comentario no encontrado' using errcode = 'P0002'; end if;
  if v_activa is null or (c.empresa_id is not null and c.empresa_id <> v_activa) then
    raise exception 'Selecciona la empresa de la factura en el menú superior para retirar el comentario.' using errcode = 'P0001';
  end if;
  update factura_comentarios set retirado_at = now(), retirado_por = public.usuario_actual_id(), retirado_motivo = 'retirado'
   where id = c.id and retirado_at is null;
end $$;
revoke all on function public.retirar_comentario_factura(uuid) from public, anon;
grant execute on function public.retirar_comentario_factura(uuid) to authenticated;

-- Historial completo (vigentes, reemplazados y retirados) con autores, para el admin
create or replace function public.comentarios_factura(p_factura_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  f record;
begin
  if auth.uid() is null then raise exception 'No autenticado' using errcode = '42501'; end if;
  select id, empresa_id, cliente_id into f from facturas where id = p_factura_id;
  if not found then raise exception 'Factura no encontrada' using errcode = 'P0002'; end if;
  if not ((public.es_personal_admin() and public.puede('cuentas', 'ver')) or public.es_vendedor_de(f.cliente_id)) then
    raise exception 'No tienes permiso para ver los comentarios de esta factura' using errcode = '42501';
  end if;
  if f.empresa_id is not null and not (f.empresa_id = any (public.empresas_visibles())) then
    raise exception 'No tienes acceso a la empresa de esta factura' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', c.id, 'texto', c.texto, 'visible', c.visible_cliente, 'fecha', c.creado_at,
             'autor', (select nullif(btrim(concat_ws(' ', u.nombre, u.apellido)), '') from usuarios u where u.id = c.autor_id),
             'vigente', c.retirado_at is null, 'retirado_at', c.retirado_at, 'retirado_motivo', c.retirado_motivo,
             'retirado_por', (select nullif(btrim(concat_ws(' ', u.nombre, u.apellido)), '') from usuarios u where u.id = c.retirado_por),
             'reemplaza_id', c.reemplaza_id)
           order by c.creado_at desc)
      from factura_comentarios c where c.factura_id = p_factura_id), '[]'::jsonb);
end $$;
revoke all on function public.comentarios_factura(uuid) from public, anon;
grant execute on function public.comentarios_factura(uuid) to authenticated;

-- ── Cruce por documento (interna) ──
-- p_filtro: 'abiertas' (con saldo), 'todas' (emitidas en el período) o 'pagadas' (saldo 0 con el último abono en el período).
create or replace function public.estado_cuenta_documentos(
  p_cliente uuid,
  p_empresa uuid,
  p_filtro text default 'abiertas',
  p_desde date default null,
  p_hasta date default null,
  p_internos boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_hoy date := (now() at time zone 'America/Caracas')::date;
  v_tol numeric := public.estado_cuenta_tolerancia();
  v_filtro text := coalesce(nullif(p_filtro, ''), 'abiertas');
  v_igtf boolean;
  v_pct numeric;
  v_mun boolean;
  v jsonb;
begin
  if v_filtro not in ('abiertas', 'todas', 'pagadas') then
    raise exception 'Filtro de documentos no válido' using errcode = '22023';
  end if;
  -- Contexto del cliente en la empresa: % de retención de IVA (historial), si retiene municipal, si la empresa cobra IGTF
  select exists (select 1 from pagos p where p.es_igtf and p.empresa_id = p_empresa) into v_igtf;
  select case when percentile_cont(0.5) within group (order by r) >= 0.875 then 1.0
              when count(*) > 0 then 0.75 end
    into v_pct
    from (select fa.monto_usd / nullif(f.impuesto * f.total_usd / nullif(f.total, 0), 0) r
            from factura_aplicaciones fa join facturas f on f.id = fa.factura_id
           where f.cliente_id = p_cliente and (f.empresa_id is null or f.empresa_id = p_empresa)
             and fa.tipo = 'retencion' and fa.descripcion ~* '^IVA' and fa.monto_usd > 0.009 and f.impuesto > 0) h
   where h.r is not null;
  select exists (select 1 from factura_aplicaciones fa join facturas f on f.id = fa.factura_id
                  where f.cliente_id = p_cliente and (f.empresa_id is null or f.empresa_id = p_empresa)
                    and fa.tipo = 'retencion' and fa.descripcion ~* '^RETRS' and fa.monto_usd > 0.009)
      or exists (select 1 from retenciones r where r.cliente_id = p_cliente and r.tipo = 'municipal'
                    and (r.empresa_id is null or r.empresa_id = p_empresa) and r.estado = 'aprobado')
    into v_mun;

  with docs as (
    select f.id, f.numero, f.tipo, coalesce(f.es_nota_debito, false) es_nd, f.fecha_emision, f.fecha_vencimiento,
           f.moneda, f.total_usd, f.saldo_usd, f.estado_cobro, f.subtotal, f.impuesto, f.total,
           case when f.moneda <> 'USD' and f.total <> 0 and f.total_usd <> 0 then abs(f.total / f.total_usd) end tasa_doc,
           case when f.total <> 0 then f.subtotal * f.total_usd / f.total else f.total_usd end base_usd,
           case when f.total <> 0 then f.impuesto * f.total_usd / f.total else 0 end iva_usd
      from facturas f
     where f.cliente_id = p_cliente and f.estado = 'posted'
       and (f.empresa_id is null or f.empresa_id = p_empresa)
       -- los ajustes cambiarios de 0,00 USD no se listan (como en los movimientos)
       and not ((f.tipo = 'nota_credito' or f.es_nota_debito)
                and abs(coalesce(f.total_usd, 0)) < 0.005 and abs(coalesce(f.saldo_usd, 0)) < 0.005)
  ),
  ab0 as (
    -- Odoo: lo aplicado sobre el documento
    select fa.factura_id doc, fa.fecha, fa.tipo, fa.monto_usd monto, fa.pago_id, fa.documento_id, fa.descripcion, null::text ret_tipo
      from factura_aplicaciones fa join docs d on d.id = fa.factura_id
    union all
    -- Odoo: una nota de crédito del cliente usada en otro documento (cuenta como consumida en la nota)
    select fa.documento_id, fa.fecha, 'aplicada', fa.monto_usd, null::uuid, fa.factura_id, fa.descripcion, null
      from factura_aplicaciones fa join docs d on d.id = fa.documento_id
     where fa.tipo = 'nota_credito' and d.tipo = 'nota_credito'
    union all
    -- GUDS: cobros verificados asignados a la factura
    select pf.factura_id, coalesce(p.fecha_pago, (coalesce(p.fecha_verificacion, p.created_at) at time zone 'America/Caracas')::date),
           'pago', pf.monto_aplicado, pf.pago_id, null::uuid, null::text, null
      from pago_facturas pf join docs d on d.id = pf.factura_id join pagos p on p.id = pf.pago_id
     where p.estado = 'verificado'
    union all
    -- GUDS: retenciones aprobadas que aún no están en Odoo
    select ri.factura_id, r.fecha, 'retencion', ri.monto_aplicado, null::uuid, null::uuid,
           coalesce(nullif(btrim(r.numero_comprobante), ''), r.numero), r.tipo
      from retencion_items ri join retenciones r on r.id = ri.retencion_id join docs d on d.id = ri.factura_id
     where r.estado = 'aprobado' and r.odoo_id is null
  ),
  ab as (
    select a.*,
           case a.tipo when 'pago' then 'pagos' when 'nota_credito' then 'nc' when 'aplicada' then 'nc'
                       when 'retencion' then 'retenciones' else 'otros' end col,
           case when a.tipo = 'retencion' then
             case when coalesce(a.ret_tipo, '') = 'iva' or coalesce(a.descripcion, '') ~* '^IVA' then 'iva'
                  when coalesce(a.ret_tipo, '') = 'municipal' or coalesce(a.descripcion, '') ~* '^RETRS' then 'municipal'
                  else coalesce(a.ret_tipo, 'otra') end end clase_ret,
           p.numero pago_numero, p.referencia pago_ref, p.moneda pago_moneda, p.monto pago_monto, p.monto_moneda pago_monto_moneda,
           p.metodo::text pago_metodo, coalesce(p.es_igtf, false) pago_igtf,
           coalesce(nullif(btrim(b.nombre), ''), nullif(btrim(p.banco), '')) banco,
           dd.numero doc_numero, dd.tipo doc_tipo, coalesce(dd.es_nota_debito, false) doc_nd
      from ab0 a
      left join pagos p on p.id = a.pago_id
      left join bancos b on b.id = p.banco_id
      left join facturas dd on dd.id = a.documento_id
     where abs(a.monto) >= 0.005
  ),
  agg as (
    select d.id,
           coalesce(sum(a.monto) filter (where a.col = 'pagos'), 0) pagos,
           coalesce(sum(a.monto) filter (where a.col = 'nc'), 0) nc,
           coalesce(sum(a.monto) filter (where a.col = 'retenciones'), 0) retenciones,
           coalesce(sum(a.monto) filter (where a.col = 'otros'), 0) otros,
           coalesce(sum(a.monto) filter (where a.clase_ret = 'iva'), 0) ret_iva,
           coalesce(sum(a.monto) filter (where a.clase_ret = 'municipal'), 0) ret_mun,
           coalesce(sum(a.monto) filter (where a.col = 'pagos' and a.pago_moneda = 'USD' and not a.pago_igtf), 0) pagos_div,
           max(a.fecha) ultimo_abono,
           coalesce(jsonb_agg(jsonb_build_object(
               'fecha', a.fecha,
               'tipo', a.tipo,
               'documento', case when a.tipo = 'pago' then coalesce(a.pago_numero, 'Cobro')
                                 when a.tipo in ('nota_credito', 'aplicada') then coalesce(a.doc_numero, a.descripcion)
                                 else a.descripcion end,
               'documento_tipo', case when a.tipo in ('nota_credito', 'aplicada') and a.doc_tipo is not null then
                                   case when a.doc_tipo = 'nota_credito' then 'nota_credito' when a.doc_nd then 'nota_debito' else 'factura' end end,
               'clase', a.clase_ret,
               'referencia', nullif(btrim(a.pago_ref), ''),
               'banco', a.banco,
               'metodo', a.pago_metodo,
               'moneda', case when a.tipo = 'pago' then case when a.pago_moneda = 'USD' then 'USD' else 'VES' end end,
               'monto_moneda', case when a.tipo = 'pago' and coalesce(a.pago_moneda, 'USD') <> 'USD' and coalesce(a.pago_monto, 0) <> 0
                                    then round(a.monto * a.pago_monto_moneda / a.pago_monto, 2) end,
               'monto', round(a.monto, 2))
             order by a.fecha nulls last, a.tipo) filter (where a.doc is not null), '[]'::jsonb) abonos
      from docs d left join ab a on a.doc = d.id
     group by d.id
  ),
  com as (
    select c.factura_id,
           jsonb_agg(case when coalesce(p_internos, false) then
                       jsonb_build_object('id', c.id, 'texto', c.texto, 'visible', c.visible_cliente, 'fecha', c.creado_at,
                         'autor', (select nullif(btrim(concat_ws(' ', u.nombre, u.apellido)), '') from usuarios u where u.id = c.autor_id))
                     else jsonb_build_object('texto', c.texto, 'fecha', c.creado_at) end
                     order by c.creado_at desc) lista,
           count(*) n
      from factura_comentarios c join docs d on d.id = c.factura_id
     where c.retirado_at is null and (coalesce(p_internos, false) or c.visible_cliente)
     group by c.factura_id
  ),
  base as (
    select d.*, g.pagos, g.nc, g.retenciones, g.otros, g.ret_iva, g.ret_mun, g.pagos_div, g.ultimo_abono, g.abonos,
           v_hoy - coalesce(d.fecha_vencimiento, d.fecha_emision, v_hoy) dias,
           k.lista comentarios
      from docs d join agg g on g.id = d.id left join com k on k.factura_id = d.id
     where case v_filtro
             when 'abiertas' then abs(d.saldo_usd) > 0.009
             when 'todas' then (p_desde is null or d.fecha_emision >= p_desde) and (p_hasta is null or d.fecha_emision <= p_hasta)
             else abs(d.saldo_usd) <= 0.009 and d.estado_cobro <> 'anulado'
                  and (p_desde is null or g.ultimo_abono >= p_desde) and (p_hasta is null or g.ultimo_abono <= p_hasta)
           end
  ),
  -- "Qué falta": componentes candidatos de una factura o nota de débito con saldo (USD)
  qf as (
    select b.id, x.codigo, x.texto, x.esperado
      from base b
      cross join lateral (
        select c.codigo, c.texto, c.esperado from (
        select v.orden, v.codigo, v.texto, v.esperado
          from (values
            (1, 'iva_no_retenido', 'Pendiente el IVA no retenido',
                case when b.ret_iva > 0.009 and b.iva_usd - b.ret_iva > 0.009 then b.iva_usd - b.ret_iva end),
            (2, 'retencion_iva', 'Retención de IVA por recibir (' || to_char(coalesce(v_pct, 0.75) * 100, 'FM990') || ' %)',
                case when b.ret_iva <= 0.009 and b.iva_usd > 0.009 then coalesce(v_pct, 0.75) * b.iva_usd end),
            (3, 'iva', 'Pendiente el IVA',
                case when b.iva_usd > 0.009 and b.ret_iva <= 0.009 then b.iva_usd end),
            (4, 'igtf', 'Pendiente el IGTF (3 % de los pagos en divisas)',
                case when v_igtf and b.pagos_div > 0.009 then 0.03 * b.pagos_div end),
            (5, 'retencion_municipal', 'Retención municipal por recibir (1,25 %)',
                case when v_mun and b.ret_mun <= 0.009 and b.base_usd > 0.009 then 0.0125 * b.base_usd end),
            (6, 'retenciones', 'Retenciones de IVA y municipal por recibir',
                case when v_pct is not null and v_mun and b.ret_iva <= 0.009 and b.ret_mun <= 0.009 and b.iva_usd > 0.009
                     then v_pct * b.iva_usd + 0.0125 * b.base_usd end),
            (7, 'iva_no_retenido_municipal', 'Pendiente el IVA no retenido y la retención municipal',
                case when v_mun and b.ret_iva > 0.009 and b.ret_mun <= 0.009 and b.iva_usd - b.ret_iva > 0.009
                     then b.iva_usd - b.ret_iva + 0.0125 * b.base_usd end),
            (8, 'iva_igtf', 'Pendiente el IVA y el IGTF',
                case when v_igtf and b.pagos_div > 0.009 and b.iva_usd > 0.009 and b.ret_iva <= 0.009 then b.iva_usd + 0.03 * b.pagos_div end),
            (9, 'iva_no_retenido_igtf', 'Pendiente el IVA no retenido y el IGTF',
                case when v_igtf and b.pagos_div > 0.009 and b.ret_iva > 0.009 and b.iva_usd - b.ret_iva > 0.009
                     then b.iva_usd - b.ret_iva + 0.03 * b.pagos_div end)
          ) v(orden, codigo, texto, esperado)
         where v.esperado is not null and abs(b.saldo_usd - v.esperado) <= v_tol
         union all
        select 20, 'solo_retencion', 'Falta el pago (retención ya aplicada)', null::numeric
         where b.pagos <= 0.009 and b.nc <= 0.009 and b.otros <= 0.009 and b.retenciones > 0.009 and b.saldo_usd >= 1
         union all
        -- Lo único abonado equivale a la retención de IVA (cobros históricos que registraron la retención como pago)
        select 21, 'abono_retencion', 'Falta el pago (solo abonó la retención de IVA)', null::numeric
         where b.pagos > 0.009 and b.nc <= 0.009 and b.otros <= 0.009 and b.retenciones <= 0.009 and b.saldo_usd >= 1
           and b.iva_usd > 0.009 and abs(b.pagos - coalesce(v_pct, 0.75) * b.iva_usd) <= v_tol
         union all
        select 30, 'diferencia_menor', 'Diferencia menor (redondeo o cambio)', null::numeric
         where b.saldo_usd < 1
        ) c order by c.orden limit 1
      ) x
     where b.tipo <> 'nota_credito' and b.saldo_usd > 0.009
       -- sin ningún abono falta todo: no se sugiere nada
       and b.pagos + b.nc + b.retenciones + b.otros > 0.009
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'factura_id', b.id,
           'numero', b.numero,
           'tipo', case when b.tipo = 'nota_credito' then 'nota_credito' when b.es_nd then 'nota_debito' else 'factura' end,
           'emision', b.fecha_emision, 'vence', b.fecha_vencimiento, 'dias', b.dias, 'estado', b.estado_cobro,
           'moneda', case when b.moneda = 'USD' then 'USD' else 'VES' end,
           'tasa', round(b.tasa_doc, 4),
           'base', round(b.base_usd, 2), 'iva', round(b.iva_usd, 2), 'total', round(b.total_usd, 2),
           'base_bs', case when b.tasa_doc is not null then round(b.subtotal * sign(b.total_usd), 2) end,
           'iva_bs', case when b.tasa_doc is not null then round(b.impuesto * sign(b.total_usd), 2) end,
           'total_bs', case when b.tasa_doc is not null then round(b.total * sign(b.total_usd), 2) end,
           'saldo_bs', case when b.tasa_doc is not null then round(b.saldo_usd * b.tasa_doc, 2) end,
           'pagos', round(b.pagos, 2), 'nc', round(b.nc, 2), 'retenciones', round(b.retenciones, 2), 'otros', round(b.otros, 2),
           'abonado', round(b.pagos + b.nc + b.retenciones + b.otros, 2),
           'saldo', round(b.saldo_usd, 2),
           'ultimo_abono', b.ultimo_abono,
           'que_falta', case when q.codigo is not null then jsonb_build_object('codigo', q.codigo, 'texto', q.texto, 'esperado', round(q.esperado, 2)) end,
           'comentarios', coalesce(b.comentarios, '[]'::jsonb),
           'abonos', b.abonos)
         order by
           case when v_filtro = 'abiertas' then (b.saldo_usd < 0)::int end,
           case when v_filtro = 'abiertas' then coalesce(b.fecha_vencimiento, b.fecha_emision) end nulls last,
           case when v_filtro <> 'abiertas' then coalesce(b.fecha_emision, date '1900-01-01') end desc,
           b.numero), '[]'::jsonb)
    into v
    from base b left join qf q on q.id = b.id;
  return v;
end $$;
revoke all on function public.estado_cuenta_documentos(uuid, uuid, text, date, date, boolean) from public, anon, authenticated;

-- ── Lógica común del estado de cuenta (20w) con el cruce por documento ──
drop function if exists public.estado_cuenta_datos(uuid, uuid, date, date, boolean);
create or replace function public.estado_cuenta_datos(
  p_cliente uuid,
  p_empresa uuid,
  p_desde date default null,
  p_hasta date default null,
  p_movimientos boolean default true,
  p_internos boolean default false,
  p_filtro text default 'abiertas',
  p_desde_abierta boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_hoy date := (now() at time zone 'America/Caracas')::date;
  v_resumen jsonb;
  v_saldo numeric;
  v_nc numeric;
  v_anticipos numeric;
  v_neto numeric;
  v_credito jsonb;
  v_cliente jsonb;
  v_empresa jsonb;
  v_abiertos jsonb;
  v_documentos jsonb;
  v_desde_abierta date;
  v_desde date := p_desde;
  v_ajustes int := 0;
  v_mov jsonb := '[]'::jsonb;
  v_total_libro numeric := 0;
  v_inicial numeric := 0;
  v_final numeric := 0;
begin
  if p_cliente is null or p_empresa is null then
    raise exception 'Falta el cliente o la empresa' using errcode = '22023';
  end if;
  if p_desde is not null and p_hasta is not null and p_desde > p_hasta then
    raise exception 'La fecha inicial no puede ser posterior a la final' using errcode = '22023';
  end if;

  -- Resumen: misma regla que Cuentas por Cobrar del admin
  select jsonb_build_object(
      'saldo', round(coalesce(sum(s.saldo_usd) filter (where s.saldo_usd > 0), 0), 2),
      'por_vencer', round(coalesce(sum(s.saldo_usd) filter (where s.saldo_usd > 0 and s.dias <= 0), 0), 2),
      'vencido', round(coalesce(sum(s.saldo_usd) filter (where s.saldo_usd > 0 and s.dias > 0), 0), 2),
      'd1_30', round(coalesce(sum(s.saldo_usd) filter (where s.saldo_usd > 0 and s.dias between 1 and 30), 0), 2),
      'd31_60', round(coalesce(sum(s.saldo_usd) filter (where s.saldo_usd > 0 and s.dias between 31 and 60), 0), 2),
      'd61_90', round(coalesce(sum(s.saldo_usd) filter (where s.saldo_usd > 0 and s.dias between 61 and 90), 0), 2),
      'mas_90', round(coalesce(sum(s.saldo_usd) filter (where s.saldo_usd > 0 and s.dias > 90), 0), 2),
      'nc_a_favor', round(coalesce(-sum(s.saldo_usd) filter (where s.saldo_usd < 0), 0), 2),
      'facturas_abiertas', count(*) filter (where s.saldo_usd > 0),
      'facturas_vencidas', count(*) filter (where s.saldo_usd > 0 and s.dias > 0),
      'notas_credito_abiertas', count(*) filter (where s.saldo_usd < 0),
      'notas_debito_abiertas', count(*) filter (where s.saldo_usd > 0 and s.es_nd),
      'notas_debito_saldo', round(coalesce(sum(s.saldo_usd) filter (where s.saldo_usd > 0 and s.es_nd), 0), 2)),
      min(s.fecha_emision) filter (where s.saldo_usd > 0)
    into v_resumen, v_desde_abierta
  from (
    select f.saldo_usd, f.fecha_emision, coalesce(f.es_nota_debito, false) and f.tipo <> 'nota_credito' es_nd,
           v_hoy - coalesce(f.fecha_vencimiento, f.fecha_emision, v_hoy) dias
      from facturas f
     where f.cliente_id = p_cliente and f.estado = 'posted'
       and (f.empresa_id is null or f.empresa_id = p_empresa)
       and abs(f.saldo_usd) > 0.009
  ) s;

  -- 2.1: los movimientos empiezan en la factura abierta más antigua (sin deuda: los últimos 90 días)
  if coalesce(p_desde_abierta, false) and p_desde is null then
    v_desde := coalesce(v_desde_abierta, v_hoy - 90);
    if p_hasta is not null and v_desde > p_hasta then v_desde := p_hasta; end if;
  end if;

  select coalesce(round(sum(a.disponible), 2), 0) into v_anticipos
    from v_anticipos a where a.cliente_id = p_cliente and a.disponible > 0.009;

  v_saldo := (v_resumen->>'saldo')::numeric;
  v_nc := (v_resumen->>'nc_a_favor')::numeric;
  v_neto := round(v_saldo - v_nc - v_anticipos, 2);
  v_resumen := v_resumen || jsonb_build_object(
    'anticipos', v_anticipos,
    'a_favor', round(v_nc + v_anticipos, 2),
    'neto', v_neto);

  -- Documentos con saldo con el cruce completo (base, IVA, abonos, qué falta y comentarios)
  v_abiertos := public.estado_cuenta_documentos(p_cliente, p_empresa, 'abiertas', null, null, p_internos);
  if coalesce(p_filtro, 'abiertas') <> 'abiertas' then
    v_documentos := public.estado_cuenta_documentos(p_cliente, p_empresa, p_filtro, v_desde, p_hasta, p_internos);
  end if;

  select to_jsonb(x) into v_credito from public.credito_disponible(p_cliente) x;
  select jsonb_build_object('id', cl.id, 'nombre', cl.nombre_negocio, 'rif', cl.rif, 'codigo', cl.codigo,
           'condicion_pago', cl.condicion_pago, 'dias_credito', cl.dias_credito,
           'direccion', nullif(btrim(cl.direccion), ''), 'ciudad', nullif(btrim(cl.ciudad), ''),
           'estado', nullif(btrim(regexp_replace(coalesce(cl.estado, ''), '\s*\(VE\)\s*$', '')), ''))
    into v_cliente from clientes cl where cl.id = p_cliente;
  select jsonb_build_object('id', e.id, 'nombre', e.nombre, 'nombre_corto', e.nombre_corto, 'prefijo', e.prefijo,
           'rif', e.rif, 'direccion', e.direccion, 'ciudad', e.ciudad, 'estado', e.estado, 'telefono', e.telefono,
           'email', e.email, 'sitio_web', e.sitio_web, 'logo_url', e.logo_url, 'color', e.color)
    into v_empresa from empresas e where e.id = p_empresa;

  if coalesce(p_movimientos, true) then
    select count(*) into v_ajustes
      from facturas f
     where f.cliente_id = p_cliente and f.estado = 'posted'
       and (f.empresa_id is null or f.empresa_id = p_empresa)
       and (f.tipo = 'nota_credito' or f.es_nota_debito)
       and abs(coalesce(f.total_usd, 0)) < 0.005 and abs(coalesce(f.saldo_usd, 0)) < 0.005
       and (v_desde is null or coalesce(f.fecha_emision, date '1900-01-01') >= v_desde)
       and (p_hasta is null or coalesce(f.fecha_emision, date '1900-01-01') <= p_hasta);

    with fac as (
      select f.id, f.numero, f.tipo, f.es_nota_debito, f.fecha_emision, f.fecha_vencimiento, f.total_usd, f.saldo_usd, f.estado_cobro
        from facturas f
       where f.cliente_id = p_cliente and f.estado = 'posted'
         and (f.empresa_id is null or f.empresa_id = p_empresa)
    ),
    cob as (
      select fa.pago_id, fa.fecha fecha_ap,
             case when f.tipo = 'nota_credito' then fa.monto_usd else -fa.monto_usd end monto
        from factura_aplicaciones fa join fac f on f.id = fa.factura_id
       where fa.tipo = 'pago' and fa.pago_id is not null
      union all
      select pf.pago_id, null::date, -pf.monto_aplicado
        from pago_facturas pf join fac f on f.id = pf.factura_id join pagos p on p.id = pf.pago_id
       where p.estado = 'verificado'
      union all
      select a.pago_id, null::date, -a.disponible
        from v_anticipos a where a.cliente_id = p_cliente and a.disponible > 0.009
    ),
    mov0 as (
      select f.fecha_emision fecha, 1 orden,
             case when f.tipo = 'nota_credito' then 'nota_credito' when f.es_nota_debito then 'nota_debito' else 'factura' end tipo,
             f.numero::text documento, null::text detalle, f.id factura_id, f.id::text clave, f.total_usd monto,
             f.fecha_vencimiento vence, f.estado_cobro estado
        from fac f
       where not ((f.tipo = 'nota_credito' or f.es_nota_debito)
                  and abs(coalesce(f.total_usd, 0)) < 0.005 and abs(coalesce(f.saldo_usd, 0)) < 0.005)
      union all
      select coalesce(case when p.odoo_id is not null then (p.created_at at time zone 'UTC')::date
                           else (p.created_at at time zone 'America/Caracas')::date end, min(cob.fecha_ap)),
             2, 'cobro', coalesce(p.numero::text, 'Cobro'), p.metodo::text, null::uuid, cob.pago_id::text,
             sum(cob.monto), null::date, null::text
        from cob left join pagos p on p.id = cob.pago_id
       group by cob.pago_id, p.id
      union all
      select fa.fecha, 3,
             case fa.tipo when 'retencion' then 'retencion' when 'reintegro' then 'reintegro' else 'ajuste' end,
             coalesce(fa.descripcion, ''), null::text, null::uuid, fa.tipo || '|' || coalesce(fa.descripcion, ''),
             sum(case when f.tipo = 'nota_credito' then fa.monto_usd else -fa.monto_usd end), null::date, null::text
        from factura_aplicaciones fa join fac f on f.id = fa.factura_id
       where fa.tipo not in ('pago', 'nota_credito')
       group by fa.fecha, fa.tipo, fa.descripcion
      union all
      select fa.fecha, 3, 'nota_credito_aplicada', coalesce(d.numero::text, fa.descripcion, ''), null::text, null::uuid,
             'nca|' || coalesce(fa.documento_id::text, fa.descripcion, ''), sum(-fa.monto_usd), null::date, null::text
        from factura_aplicaciones fa join fac f on f.id = fa.factura_id left join facturas d on d.id = fa.documento_id
       where fa.tipo = 'nota_credito' and (fa.documento_id is null or fa.documento_id not in (select id from fac))
       group by fa.fecha, fa.documento_id, d.numero, fa.descripcion
      union all
      select fa.fecha, 3, 'nota_credito_aplicada', n.numero::text, null::text, null::uuid, 'ncx|' || n.id::text,
             sum(fa.monto_usd), null::date, null::text
        from factura_aplicaciones fa join fac n on n.id = fa.documento_id
       where fa.tipo = 'nota_credito' and fa.factura_id not in (select id from fac)
       group by fa.fecha, n.id, n.numero
      union all
      select r.fecha, 3, 'retencion', r.numero::text, r.tipo::text, null::uuid, 'ret|' || r.id::text,
             sum(-ri.monto_aplicado), null::date, null::text
        from retencion_items ri join retenciones r on r.id = ri.retencion_id join fac f on f.id = ri.factura_id
       where r.estado = 'aprobado' and r.odoo_id is null
       group by r.id, r.fecha, r.numero, r.tipo
    ),
    mov1 as (
      select * from mov0 where orden = 1 or abs(monto) >= 0.005
    ),
    mov as (
      select * from mov1
      union all
      select v_hoy, 9, 'redondeo', 'Redondeo', null::text, null::uuid, 'redondeo', d.dif, null::date, null::text
        from (select v_neto - coalesce(sum(monto), 0) dif from mov1) d
       where abs(d.dif) >= 0.005 and abs(d.dif) <= 1
    ),
    libro as (
      select m.*, coalesce(m.fecha, date '1900-01-01') f_orden,
             sum(m.monto) over (order by coalesce(m.fecha, date '1900-01-01'), m.orden, m.documento, m.clave
                                rows between unbounded preceding and current row) acumulado
        from mov m
    )
    select coalesce(sum(l.monto), 0),
           coalesce(sum(l.monto) filter (where v_desde is not null and l.f_orden < v_desde), 0),
           coalesce(sum(l.monto) filter (where p_hasta is null or l.f_orden <= p_hasta), 0),
           coalesce(jsonb_agg(jsonb_build_object(
               'fecha', l.fecha, 'tipo', l.tipo, 'documento', l.documento, 'detalle', l.detalle, 'factura_id', l.factura_id,
               'monto', round(l.monto, 2), 'saldo', round(l.acumulado, 2), 'vence', l.vence, 'estado', l.estado)
             order by l.f_orden, l.orden, l.documento, l.clave)
             filter (where (v_desde is null or l.f_orden >= v_desde) and (p_hasta is null or l.f_orden <= p_hasta)), '[]'::jsonb)
      into v_total_libro, v_inicial, v_final, v_mov
      from libro l;
  end if;

  return jsonb_build_object(
    'hoy', v_hoy,
    'cliente', v_cliente,
    'empresa', v_empresa,
    'resumen', v_resumen,
    'credito', v_credito,
    'abiertos', v_abiertos,
    'documentos', v_documentos,
    'filtro', coalesce(p_filtro, 'abiertas'),
    'desde_abierta', v_desde_abierta,
    'tolerancia', public.estado_cuenta_tolerancia(),
    'periodo', jsonb_build_object('desde', v_desde, 'hasta', p_hasta,
                                  'modo', case when coalesce(p_desde_abierta, false) and p_desde is null then 'abierta' end),
    'saldo_inicial', round(v_inicial, 2),
    'saldo_final', round(v_final, 2),
    'movimientos', v_mov,
    'ajustes_cambiarios', v_ajustes,
    'diferencia', case when coalesce(p_movimientos, true) then round(v_total_libro - v_neto, 2) end);
end $$;
revoke all on function public.estado_cuenta_datos(uuid, uuid, date, date, boolean, boolean, text, boolean) from public, anon, authenticated;

-- ── Portal del cliente ──
drop function if exists public.estado_cuenta_portal(date, date, boolean);
create or replace function public.estado_cuenta_portal(
  p_desde date default null,
  p_hasta date default null,
  p_movimientos boolean default true,
  p_filtro text default 'abiertas',
  p_desde_abierta boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c record;
begin
  select * into c from public.portal_cliente_contexto();
  return public.estado_cuenta_datos(c.o_cliente, c.o_empresa, p_desde, p_hasta, p_movimientos, false, p_filtro, p_desde_abierta);
end $$;
revoke all on function public.estado_cuenta_portal(date, date, boolean, text, boolean) from public, anon;
grant execute on function public.estado_cuenta_portal(date, date, boolean, text, boolean) to authenticated;

-- ── Admin (CuentaDetalle) y vendedor del cliente: con comentarios internos ──
drop function if exists public.estado_cuenta_cliente(uuid, date, date, boolean);
create or replace function public.estado_cuenta_cliente(
  p_cliente_id uuid,
  p_desde date default null,
  p_hasta date default null,
  p_movimientos boolean default true,
  p_filtro text default 'abiertas',
  p_desde_abierta boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_emp uuid;
begin
  v_emp := public.estado_cuenta_acceso(p_cliente_id, 'ver');
  return public.estado_cuenta_datos(p_cliente_id, v_emp, p_desde, p_hasta, p_movimientos, true, p_filtro, p_desde_abierta);
end $$;
revoke all on function public.estado_cuenta_cliente(uuid, date, date, boolean, text, boolean) from public, anon;
grant execute on function public.estado_cuenta_cliente(uuid, date, date, boolean, text, boolean) to authenticated;

-- ── Enlace público: sin identificadores internos y solo comentarios visibles ──
-- Quita los ids de los documentos (factura_id) de una lista de documentos
create or replace function public.estado_cuenta_sin_ids(p_docs jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select coalesce((select jsonb_agg(d - 'factura_id' order by o) from jsonb_array_elements(p_docs) with ordinality t(d, o)), p_docs)
$$;
revoke all on function public.estado_cuenta_sin_ids(jsonb) from public, anon, authenticated;

drop function if exists public.estado_cuenta_publico(text, date, date, boolean);
create or replace function public.estado_cuenta_publico(
  p_token text,
  p_desde date default null,
  p_hasta date default null,
  p_contar boolean default true,
  p_filtro text default 'abiertas',
  p_desde_abierta boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  e public.estado_cuenta_enlaces;
  v jsonb;
  v_rif text;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'Este enlace no es válido o ya no está disponible' using errcode = 'P0001';
  end if;
  select * into e from estado_cuenta_enlaces x
   where x.token = p_token and x.revocado_at is null and (x.vence_at is null or x.vence_at > now());
  if not found then
    raise exception 'Este enlace no es válido o ya no está disponible' using errcode = 'P0001';
  end if;

  update estado_cuenta_enlaces
     set ultimo_acceso_at = now(), accesos = accesos + case when coalesce(p_contar, true) then 1 else 0 end
   where id = e.id;

  -- p_internos = false: solo comentarios visibles para el cliente, sin autor ni id
  v := public.estado_cuenta_datos(e.cliente_id, e.empresa_id, p_desde, p_hasta, true, false, p_filtro, p_desde_abierta);

  v := jsonb_set(v, '{cliente}', (v->'cliente') - 'id');
  v := jsonb_set(v, '{empresa}', (v->'empresa') - 'id');
  v := jsonb_set(v, '{credito}', coalesce((v->'credito') - 'utilizado' - 'en_pedidos', 'null'::jsonb));
  v := jsonb_set(v, '{movimientos}', coalesce((select jsonb_agg(m - 'factura_id' order by o)
                                                 from jsonb_array_elements(v->'movimientos') with ordinality t(m, o)), '[]'::jsonb));
  v := jsonb_set(v, '{abiertos}', public.estado_cuenta_sin_ids(v->'abiertos'));
  if jsonb_typeof(v->'documentos') = 'array' then
    v := jsonb_set(v, '{documentos}', public.estado_cuenta_sin_ids(v->'documentos'));
  end if;

  select c.rif into v_rif from clientes c where c.id = e.cliente_id;
  return v || jsonb_build_object(
    'enlace', jsonb_build_object('creado_at', e.creado_at, 'vence_at', e.vence_at),
    'actualizado_at', now(),
    'tiene_cuenta', exists (
      select 1 from usuarios u join clientes c on c.id = u.cliente_id
       where u.role = 'cliente' and coalesce(u.activo, true)
         and (c.id = e.cliente_id or (v_rif is not null and public.normalizar_rif(c.rif) = public.normalizar_rif(v_rif)))));
end $$;
revoke all on function public.estado_cuenta_publico(text, date, date, boolean, text, boolean) from public;
grant execute on function public.estado_cuenta_publico(text, date, date, boolean, text, boolean) to anon, authenticated;

-- ── Correo: el resumen ya traía el vencido; se agregan la antigüedad, las ND y los documentos con saldo (con "qué falta"
--    y los comentarios visibles) para la tabla del correo. Misma firma que 20w.
create or replace function public.datos_correo_estado_cuenta(p_cliente_id uuid, p_asegurar_enlace boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_emp uuid;
  v_enlace jsonb;
  v jsonb;
begin
  v_emp := public.estado_cuenta_acceso(p_cliente_id, 'editar', false);
  if coalesce(p_asegurar_enlace, false) then
    v_enlace := public.crear_enlace_estado_cuenta(p_cliente_id, false, null);
  else
    select public.estado_cuenta_enlace_json(x, true) into v_enlace from estado_cuenta_enlaces x
     where x.cliente_id = p_cliente_id and x.empresa_id = v_emp and x.revocado_at is null
       and (x.vence_at is null or x.vence_at > now())
     order by x.creado_at desc limit 1;
  end if;
  v := public.estado_cuenta_datos(p_cliente_id, v_emp, null, null, false, false, 'abiertas', false);
  return jsonb_build_object(
    'hoy', v->'hoy',
    'cliente', (v->'cliente') || jsonb_build_object('email', (select nullif(btrim(c.email), '') from clientes c where c.id = p_cliente_id)),
    'empresa', v->'empresa',
    'resumen', v->'resumen',
    'documentos', coalesce((select jsonb_agg(jsonb_build_object(
                     'numero', d->>'numero', 'tipo', d->>'tipo', 'vence', d->>'vence', 'dias', (d->>'dias')::int,
                     'total', (d->>'total')::numeric, 'abonado', (d->>'abonado')::numeric, 'saldo', (d->>'saldo')::numeric,
                     'que_falta', d->'que_falta'->>'texto', 'comentario', d->'comentarios'->0->>'texto') order by o)
                   from jsonb_array_elements(v->'abiertos') with ordinality t(d, o)), '[]'::jsonb),
    'enlace', v_enlace,
    'contactos', coalesce((
      select jsonb_agg(jsonb_build_object('nombre', k.nombre, 'cargo', k.cargo, 'email', btrim(k.email), 'principal', coalesce(k.es_principal, false))
             order by coalesce(k.es_principal, false) desc, k.nombre)
        from cliente_contactos k
       where k.cliente_id = p_cliente_id and coalesce(k.activo, true) and nullif(btrim(k.email), '') is not null), '[]'::jsonb),
    'remitente', (select jsonb_build_object('id', u.id, 'nombre', nullif(btrim(concat_ws(' ', u.nombre, u.apellido)), ''), 'email', u.email)
                    from usuarios u where u.auth_id = auth.uid()));
end $$;
revoke all on function public.datos_correo_estado_cuenta(uuid, boolean) from public, anon;
grant execute on function public.datos_correo_estado_cuenta(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';

commit;
