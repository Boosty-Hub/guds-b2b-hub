-- ════════════════════════════════════════════════════════════════════════
-- Fase 20m · Portal del cliente: finanzas (F5) y cuenta (F6)
--   · estado_cuenta_portal(desde, hasta, movimientos) → el estado de cuenta del cliente que llama:
--       - resumen con la MISMA lógica que Cuentas por Cobrar del admin (CuentasPorCobrar.tsx, "deudores"): facturas
--         publicadas (posted) de la empresa activa con |saldo_usd| > 0,009; los saldos positivos son deuda y se reparten
--         por días desde el vencimiento (o la emisión) en por vencer / 1–30 / 31–60 / 61–90 / +90; los negativos son
--         notas de crédito sin aplicar (a favor). Más los anticipos (v_anticipos) y el crédito (credito_disponible).
--       - libro de movimientos con saldo corrido: facturas y notas de débito suman, notas de crédito restan, y los cobros,
--         retenciones, ajustes y reintegros aplicados (de Odoo en factura_aplicaciones y de GUDS en pago_facturas /
--         retencion_items) restan o suman según el documento. Cuadra con el saldo: Σ movimientos = Σ saldo_usd − anticipos
--         (los céntimos de la conversión a USD por documento van en un renglón "Redondeo"; en 'diferencia' se devuelve
--         lo que no cuadre, 0 si cuadra). Filtro por período con saldo anterior.
--       "Hoy" es la fecha de Caracas, como el navegador del admin.
--   · factura_portal(id) → una factura (o nota) del cliente: renglones, impuestos y lo aplicado (cobros, retenciones,
--     notas de crédito, ajustes). El cliente no lee factura_aplicaciones por RLS; aquí solo ve lo de sus documentos.
--   · mi_ejecutivo() → nombre, teléfono y WhatsApp del ejecutivo de cuenta. Nada más del vendedor (ni correo ni id).
--   Las tres son SECURITY DEFINER, solo para un usuario cliente activo, ligadas a su ficha en la empresa activa
--   (mi_cliente_id); anon y public no las ejecutan. portal_cliente_contexto() es interna (no se ejecuta por la API).
-- ════════════════════════════════════════════════════════════════════════
begin;

-- Quién llama: usuario cliente activo, su ficha en la empresa activa y la empresa (como portal_contexto del catálogo,
-- con un mensaje general).
create or replace function public.portal_cliente_contexto(out o_usuario uuid, out o_cliente uuid, out o_empresa uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;
  select u.id into o_usuario from usuarios u
   where u.auth_id = auth.uid() and coalesce(u.activo, true) and u.role = 'cliente';
  if o_usuario is null then
    raise exception 'Esta consulta es solo para clientes del portal' using errcode = '42501';
  end if;
  o_empresa := public.empresa_activa_requerida();
  o_cliente := public.mi_cliente_id();
  if o_cliente is null or not exists (select 1 from clientes c where c.id = o_cliente and (c.empresa_id is null or c.empresa_id = o_empresa)) then
    raise exception 'Tu cuenta no está habilitada en esta empresa' using errcode = 'P0001';
  end if;
end $$;

revoke all on function public.portal_cliente_contexto() from public, anon, authenticated;

-- ── Estado de cuenta ──
create or replace function public.estado_cuenta_portal(
  p_desde date default null,
  p_hasta date default null,
  p_movimientos boolean default true
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c record;
  v_hoy date := (now() at time zone 'America/Caracas')::date;
  v_resumen jsonb;
  v_saldo numeric;
  v_nc numeric;
  v_anticipos numeric;
  v_neto numeric;
  v_credito jsonb;
  v_cliente jsonb;
  v_empresa jsonb;
  v_mov jsonb := '[]'::jsonb;
  v_total_libro numeric := 0;
  v_inicial numeric := 0;
  v_final numeric := 0;
begin
  select * into c from public.portal_cliente_contexto();
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
      'notas_credito_abiertas', count(*) filter (where s.saldo_usd < 0))
    into v_resumen
  from (
    select f.saldo_usd, v_hoy - coalesce(f.fecha_vencimiento, f.fecha_emision, v_hoy) dias
      from facturas f
     where f.cliente_id = c.o_cliente and f.estado = 'posted'
       and (f.empresa_id is null or f.empresa_id = c.o_empresa)
       and abs(f.saldo_usd) > 0.009
  ) s;

  select coalesce(round(sum(a.disponible), 2), 0) into v_anticipos
    from v_anticipos a where a.cliente_id = c.o_cliente and a.disponible > 0.009;

  v_saldo := (v_resumen->>'saldo')::numeric;
  v_nc := (v_resumen->>'nc_a_favor')::numeric;
  v_neto := round(v_saldo - v_nc - v_anticipos, 2);
  v_resumen := v_resumen || jsonb_build_object(
    'anticipos', v_anticipos,
    'a_favor', round(v_nc + v_anticipos, 2),
    'neto', v_neto);

  select to_jsonb(x) into v_credito from public.credito_disponible(c.o_cliente) x;
  select jsonb_build_object('id', cl.id, 'nombre', cl.nombre_negocio, 'rif', cl.rif, 'codigo', cl.codigo,
           'condicion_pago', cl.condicion_pago, 'dias_credito', cl.dias_credito)
    into v_cliente from clientes cl where cl.id = c.o_cliente;
  select jsonb_build_object('id', e.id, 'nombre', e.nombre, 'nombre_corto', e.nombre_corto, 'rif', e.rif)
    into v_empresa from empresas e where e.id = c.o_empresa;

  if coalesce(p_movimientos, true) then
    with fac as (
      select f.id, f.numero, f.tipo, f.es_nota_debito, f.fecha_emision, f.fecha_vencimiento, f.total_usd, f.estado_cobro
        from facturas f
       where f.cliente_id = c.o_cliente and f.estado = 'posted'
         and (f.empresa_id is null or f.empresa_id = c.o_empresa)
    ),
    -- Cobros aplicados: de Odoo (factura_aplicaciones) y de GUDS (pago_facturas de pagos verificados), más lo que el
    -- cobro dejó sin aplicar como anticipo. Un renglón por cobro, en la fecha del cobro.
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
        from v_anticipos a where a.cliente_id = c.o_cliente and a.disponible > 0.009
    ),
    mov0 as (
      -- Documentos: facturas y notas de débito suman; las notas de crédito restan (total_usd ya viene negativo)
      select f.fecha_emision fecha, 1 orden,
             case when f.tipo = 'nota_credito' then 'nota_credito' when f.es_nota_debito then 'nota_debito' else 'factura' end tipo,
             f.numero::text documento, null::text detalle, f.id factura_id, f.id::text clave, f.total_usd monto,
             f.fecha_vencimiento vence, f.estado_cobro estado
        from fac f
      union all
      select coalesce(case when p.odoo_id is not null then (p.created_at at time zone 'UTC')::date
                           else (p.created_at at time zone 'America/Caracas')::date end, min(cob.fecha_ap)),
             2, 'cobro', coalesce(p.numero::text, 'Cobro'), p.metodo::text, null::uuid, cob.pago_id::text,
             sum(cob.monto), null::date, null::text
        from cob left join pagos p on p.id = cob.pago_id
       group by cob.pago_id, p.id
      union all
      -- Retenciones, ajustes y reintegros de Odoo (en una nota de crédito suman: consumen su saldo a favor)
      select fa.fecha, 3,
             case fa.tipo when 'retencion' then 'retencion' when 'reintegro' then 'reintegro' else 'ajuste' end,
             coalesce(fa.descripcion, ''), null::text, null::uuid, fa.tipo || '|' || coalesce(fa.descripcion, ''),
             sum(case when f.tipo = 'nota_credito' then fa.monto_usd else -fa.monto_usd end), null::date, null::text
        from factura_aplicaciones fa join fac f on f.id = fa.factura_id
       where fa.tipo not in ('pago', 'nota_credito')
       group by fa.fecha, fa.tipo, fa.descripcion
      union all
      -- Notas de crédito aplicadas cuya nota no está entre los documentos vivos del cliente (p. ej. anulada)
      select fa.fecha, 3, 'nota_credito_aplicada', coalesce(d.numero::text, fa.descripcion, ''), null::text, null::uuid,
             'nca|' || coalesce(fa.documento_id::text, fa.descripcion, ''), sum(-fa.monto_usd), null::date, null::text
        from factura_aplicaciones fa join fac f on f.id = fa.factura_id left join facturas d on d.id = fa.documento_id
       where fa.tipo = 'nota_credito' and (fa.documento_id is null or fa.documento_id not in (select id from fac))
       group by fa.fecha, fa.documento_id, d.numero, fa.descripcion
      union all
      -- Y al revés: una nota de crédito del cliente usada en un documento que no está entre los suyos
      select fa.fecha, 3, 'nota_credito_aplicada', n.numero::text, null::text, null::uuid, 'ncx|' || n.id::text,
             sum(fa.monto_usd), null::date, null::text
        from factura_aplicaciones fa join fac n on n.id = fa.documento_id
       where fa.tipo = 'nota_credito' and fa.factura_id not in (select id from fac)
       group by fa.fecha, n.id, n.numero
      union all
      -- Retenciones declaradas en GUDS y aprobadas (aún no en Odoo): restan del saldo del documento
      select r.fecha, 3, 'retencion', r.numero::text, r.tipo::text, null::uuid, 'ret|' || r.id::text,
             sum(-ri.monto_aplicado), null::date, null::text
        from retencion_items ri join retenciones r on r.id = ri.retencion_id join fac f on f.id = ri.factura_id
       where r.estado = 'aprobado' and r.odoo_id is null
       group by r.id, r.fecha, r.numero, r.tipo
    ),
    -- Céntimos de redondeo: cada saldo de Odoo se convierte y redondea a USD por documento, y la suma de totales y
    -- aplicaciones puede diferir en céntimos del saldo. Se muestran como un renglón explícito (hoy) para que el saldo
    -- corrido termine en el saldo real. Una diferencia mayor a 1 USD no se disfraza: queda en 'diferencia'.
    -- Sin renglones de 0,00 (ajustes de Odoo por fracciones de céntimo); los documentos siempre se muestran
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
           coalesce(sum(l.monto) filter (where p_desde is not null and l.f_orden < p_desde), 0),
           coalesce(sum(l.monto) filter (where p_hasta is null or l.f_orden <= p_hasta), 0),
           coalesce(jsonb_agg(jsonb_build_object(
               'fecha', l.fecha, 'tipo', l.tipo, 'documento', l.documento, 'detalle', l.detalle, 'factura_id', l.factura_id,
               'monto', round(l.monto, 2), 'saldo', round(l.acumulado, 2), 'vence', l.vence, 'estado', l.estado)
             order by l.f_orden, l.orden, l.documento, l.clave)
             filter (where (p_desde is null or l.f_orden >= p_desde) and (p_hasta is null or l.f_orden <= p_hasta)), '[]'::jsonb)
      into v_total_libro, v_inicial, v_final, v_mov
      from libro l;
  end if;

  return jsonb_build_object(
    'hoy', v_hoy,
    'cliente', v_cliente,
    'empresa', v_empresa,
    'resumen', v_resumen,
    'credito', v_credito,
    'periodo', jsonb_build_object('desde', p_desde, 'hasta', p_hasta),
    'saldo_inicial', round(v_inicial, 2),
    'saldo_final', round(v_final, 2),
    'movimientos', v_mov,
    'diferencia', case when coalesce(p_movimientos, true) then round(v_total_libro - v_neto, 2) end);
end $$;

revoke all on function public.estado_cuenta_portal(date, date, boolean) from public, anon;
grant execute on function public.estado_cuenta_portal(date, date, boolean) to authenticated;

-- ── Ficha de una factura ──
create or replace function public.factura_portal(p_factura_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c record;
  f facturas%rowtype;
  v_mios uuid[];
begin
  select * into c from public.portal_cliente_contexto();
  select * into f from facturas x
   where x.id = p_factura_id and x.cliente_id = c.o_cliente and (x.empresa_id is null or x.empresa_id = c.o_empresa);
  if not found then
    return null;
  end if;
  v_mios := public.clientes_del_usuario();

  return jsonb_build_object(
    'id', f.id, 'numero', f.numero, 'tipo', f.tipo, 'es_nota_debito', coalesce(f.es_nota_debito, false),
    'estado', f.estado, 'estado_cobro', f.estado_cobro,
    'fecha_emision', f.fecha_emision, 'fecha_vencimiento', f.fecha_vencimiento,
    'moneda', f.moneda, 'tasa_cambio', f.tasa_cambio, 'subtotal', f.subtotal, 'impuesto', f.impuesto, 'total', f.total,
    'total_usd', f.total_usd, 'saldo_usd', f.saldo_usd, 'nro_control', f.nro_control,
    'motivo_anulacion', f.motivo_anulacion, 'motivo_nota', f.motivo_nota, 'anulada_at', f.anulada_at,
    'hoy', (now() at time zone 'America/Caracas')::date,
    'orden', (select jsonb_build_object('id', o.id, 'numero', o.numero) from ordenes o
               where o.id = f.orden_id and o.cliente_id = any (v_mios)),
    'origen', (select jsonb_build_object('id', x.id, 'numero', x.numero) from facturas x
                where x.id = f.factura_origen_id and x.cliente_id = c.o_cliente),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'nombre', i.nombre_producto, 'sku', i.sku_producto, 'producto_id', i.producto_id, 'cantidad', i.cantidad,
               'precio_unitario', i.precio_unitario, 'descuento', i.descuento, 'subtotal', i.subtotal, 'total', i.total)
             order by i.odoo_id nulls last, i.created_at, i.nombre_producto)
        from factura_items i where i.factura_id = f.id), '[]'::jsonb),
    -- Lo aplicado a este documento: Odoo (cobros, retenciones, notas de crédito, ajustes, reintegros) y GUDS
    'aplicaciones', coalesce((
      select jsonb_agg(a.fila order by a.fecha nulls last, a.referencia)
        from (
          select fa.fecha, coalesce(p.numero::text, d.numero::text, fa.descripcion) referencia,
                 jsonb_build_object(
                   'tipo', case fa.tipo when 'pago' then 'cobro' when 'retencion' then 'retencion'
                                        when 'nota_credito' then 'nota_credito' when 'reintegro' then 'reintegro' else 'ajuste' end,
                   'fecha', fa.fecha,
                   'referencia', case when fa.tipo = 'pago' then (case when p.cliente_id = any (v_mios) then p.numero::text end)
                                      when fa.tipo = 'nota_credito' then (case when d.cliente_id = any (v_mios) then d.numero::text end)
                                      else fa.descripcion end,
                   'metodo', case when fa.tipo = 'pago' and p.cliente_id = any (v_mios) then p.metodo::text end,
                   'documento_id', case when fa.tipo = 'nota_credito' and d.cliente_id = c.o_cliente then d.id end,
                   'monto_usd', fa.monto_usd,
                   'origen', 'odoo') fila
            from factura_aplicaciones fa
            left join pagos p on p.id = fa.pago_id
            left join facturas d on d.id = fa.documento_id
           where fa.factura_id = f.id
          union all
          select (p.created_at at time zone 'America/Caracas')::date, p.numero::text,
                 jsonb_build_object('tipo', 'cobro', 'fecha', (p.created_at at time zone 'America/Caracas')::date,
                   'referencia', p.numero, 'metodo', p.metodo::text, 'documento_id', null, 'monto_usd', pf.monto_aplicado,
                   'origen', 'guds')
            from pago_facturas pf join pagos p on p.id = pf.pago_id
           where pf.factura_id = f.id and p.estado = 'verificado'
          union all
          select r.fecha, r.numero::text,
                 jsonb_build_object('tipo', 'retencion', 'fecha', r.fecha, 'referencia', r.numero, 'metodo', r.tipo::text,
                   'documento_id', null, 'monto_usd', ri.monto_aplicado, 'origen', 'guds')
            from retencion_items ri join retenciones r on r.id = ri.retencion_id
           where ri.factura_id = f.id and r.estado = 'aprobado' and r.odoo_id is null
        ) a), '[]'::jsonb),
    -- Si es nota de crédito: a qué documentos del cliente se aplicó
    'aplicada_a', coalesce((
      select jsonb_agg(jsonb_build_object('factura_id', x.id, 'numero', x.numero, 'fecha', fa.fecha, 'monto_usd', fa.monto_usd)
             order by fa.fecha, x.numero)
        from factura_aplicaciones fa join facturas x on x.id = fa.factura_id
       where fa.documento_id = f.id and fa.tipo = 'nota_credito' and x.cliente_id = c.o_cliente), '[]'::jsonb)
  );
end $$;

revoke all on function public.factura_portal(uuid) from public, anon;
grant execute on function public.factura_portal(uuid) to authenticated;

-- ── Ejecutivo de cuenta ──
create or replace function public.mi_ejecutivo()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c record;
  v_nombre text;
  v_tel text;
  v_dig text;
  v_nacional text;
begin
  select * into c from public.portal_cliente_contexto();
  select coalesce(nullif(btrim(concat_ws(' ', u.nombre, u.apellido)), ''), nullif(btrim(cl.vendedor_odoo), '')),
         nullif(btrim(u.telefono), '')
    into v_nombre, v_tel
    from clientes cl
    left join usuarios u on u.id = cl.vendedor_asignado_id and coalesce(u.activo, true)
   where cl.id = c.o_cliente;
  if v_nombre is null then
    return null;
  end if;
  -- WhatsApp solo para celulares de Venezuela (04xx…), en formato internacional sin signos (58 4xx…)
  v_dig := regexp_replace(coalesce(v_tel, ''), '\D', '', 'g');
  v_nacional := case
    when length(v_dig) = 12 and v_dig like '58%' then substr(v_dig, 3)
    when length(v_dig) = 11 and v_dig like '0%' then substr(v_dig, 2)
    when length(v_dig) = 10 then v_dig
  end;
  return jsonb_build_object(
    'nombre', v_nombre,
    'telefono', v_tel,
    'whatsapp', case when v_nacional ~ '^4(12|14|16|22|24|26)[0-9]{7}$' then '58' || v_nacional end);
end $$;

revoke all on function public.mi_ejecutivo() from public, anon;
grant execute on function public.mi_ejecutivo() to authenticated;

commit;
