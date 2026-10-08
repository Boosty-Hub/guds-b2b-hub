-- ════════════════════════════════════════════════════════════════════════
-- Fase 22c · Un solo estado de cuenta con el formato de finanzas (R1 del plan de reportes, docs/PLAN-REPORTES-FINANZAS.md)
--   Decisión del 8-oct: en el detalle de la cuenta, el enlace público, el PDF, el Excel, el portal del cliente, la ficha del
--   vendedor y el correo se ve UN estado de cuenta: el del Excel "FORMATO EDC" del equipo. Una fila por documento con saldo
--   (facturas, notas de débito y notas de crédito a favor, estas en negativo): Año · Mes (del vencimiento) · Tipo y Nº ·
--   Nº de control · Emisión · Vencimiento · Días transcurridos · Tasa de emisión · Base · Impuesto · Total · Deuda · Estatus.
--
--   · estado_cuenta_documentos gana p_corte (T4): saldo de cada documento al corte = saldo actual + lo aplicado DESPUÉS
--     del corte (factura_aplicaciones.fecha, pago_facturas de cobros VERIFICADOS de GUDS con la fecha del cobro y
--     retenciones aprobadas de GUDS que aún no están en Odoo), que equivale a total − lo aplicado hasta el corte (la
--     identidad total − aplicado = saldo se verificó el 8-oct en 4.053 documentos: 4.052 al centavo, 1 a 0,02). Solo
--     documentos emitidos hasta el corte; días = corte − vencimiento; abonos, "qué falta" y lo abonado por tipo, al corte.
--     Corte nulo o futuro = hoy (hora de Caracas). Los cobros anulados o pendientes nunca cuentan (estado = 'verificado').
--   · Campos nuevos por documento: nro_control (facturas.nro_control, de Odoo), tasa_emision y tasa_origen ('documento':
--     documentos en Bs = |total ÷ total_usd| ajustada a la tasa conocida más cercana; 'bcv': documentos en USD = tasa BCV del día de emisión o la última anterior,
--     tasa_bcv_dia) y estatus ('pendiente' = Pendiente por cobrar · 'retencion' = Pendiente comprobante de retención, cuando
--     "qué falta" dice retención de IVA o municipal por recibir · 'nc_favor' = NC a favor · 'a_favor' = otro saldo a favor).
--     Orden: por vencimiento (año y mes de la primera columna), emisión y número.
--   · estado_cuenta_datos gana p_corte y devuelve 'corte'; el resumen (por cobrar, vencido, tramos, a favor, neto) sale de
--     los mismos documentos al corte. Anticipos de GUDS sin aplicar: los cobrados hasta el corte, de la empresa del estado
--     de cuenta (antes no filtraba la empresa).
--   · estado_cuenta_cliente (admin y vendedor) gana p_corte; los comentarios internos solo para administración (antes
--     también le llegaban al vendedor). estado_cuenta_publico gana p_movimientos. El enlace público y el portal siempre
--     muestran el corte de hoy.
--   · datos_correo_estado_cuenta: los documentos del correo con las columnas del formato (Nº de control, estatus, tasa…),
--     notas de crédito incluidas.
--   · tasa_bcv_dia(fecha) + índice por fecha. El histórico (T2) lo carga scripts/importar-tasas-bcv-historico.mjs.
--
--   Compatibilidad: las firmas de las RPC públicas solo GANAN parámetros con valor por defecto y la respuesta conserva las
--   claves de 21b (movimientos, documentos, periodo…), así que el frontend publicado sigue funcionando hasta que se
--   publique el nuevo. Cuando esté publicado, se puede quitar el libro de movimientos del servidor (queda como pendiente).
--   Nada de esto escribe en Odoo.
-- ════════════════════════════════════════════════════════════════════════
begin;

-- ── T2: tasa BCV de un día ──
create index if not exists tasa_bcv_fecha on public.tasa_bcv (fecha desc, created_at);

-- La última publicada hasta esa fecha. Dentro del mismo día gana la primera fila del BCV (la del cron de las 8:00, la
-- vigente ese día: una pulsación del botón por la tarde puede traer ya la del día hábil siguiente, como el 14-ago) y el
-- respaldo de dolarapi va de último.
create or replace function public.tasa_bcv_dia(p_fecha date)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select t.tasa from tasa_bcv t
   where t.fecha <= p_fecha and t.tasa > 0
   order by t.fecha desc, (coalesce(t.fuente, '') ~* 'respaldo'), t.created_at
   limit 1
$$;
revoke all on function public.tasa_bcv_dia(date) from public, anon;
grant execute on function public.tasa_bcv_dia(date) to authenticated;

-- ── Cruce por documento al corte (interna) ──
drop function if exists public.estado_cuenta_documentos(uuid, uuid, text, date, date, boolean);
create or replace function public.estado_cuenta_documentos(
  p_cliente uuid,
  p_empresa uuid,
  p_filtro text default 'abiertas',
  p_desde date default null,
  p_hasta date default null,
  p_internos boolean default false,
  p_corte date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_hoy date := (now() at time zone 'America/Caracas')::date;
  v_corte date;
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
  -- El corte solo aplica a los documentos con saldo; 'todas' y 'pagadas' (frontend de 21b) son siempre a hoy
  v_corte := case when v_filtro = 'abiertas' then least(coalesce(p_corte, v_hoy), v_hoy) else v_hoy end;

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
    select f.id, f.numero, f.tipo, coalesce(f.es_nota_debito, false) es_nd, f.nro_control, f.fecha_emision, f.fecha_vencimiento,
           f.moneda, f.total_usd, f.saldo_usd, f.estado_cobro, f.subtotal, f.impuesto, f.total,
           case when f.moneda <> 'USD' and f.total <> 0 and f.total_usd <> 0 then abs(f.total / f.total_usd) end tasa_doc,
           case when f.total <> 0 then f.subtotal * f.total_usd / f.total else f.total_usd end base_usd,
           case when f.total <> 0 then f.impuesto * f.total_usd / f.total else 0 end iva_usd,
           f.tasa_cambio, o.tasa_cambio tasa_origen_doc, o.fecha_emision emision_origen
      from facturas f
      left join facturas o on o.id = f.factura_origen_id
     where f.cliente_id = p_cliente and f.estado = 'posted'
       and (f.empresa_id is null or f.empresa_id = p_empresa)
       and (v_filtro <> 'abiertas' or coalesce(f.fecha_emision, date '1900-01-01') <= v_corte)
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
    -- GUDS: cobros verificados asignados a la factura (los anulados, pendientes o rechazados no cuentan)
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
           (a.fecha is not null and a.fecha > v_corte) as futuro,
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
           coalesce(sum(a.monto) filter (where a.col = 'pagos' and not a.futuro), 0) pagos,
           coalesce(sum(a.monto) filter (where a.col = 'nc' and not a.futuro), 0) nc,
           coalesce(sum(a.monto) filter (where a.col = 'retenciones' and not a.futuro), 0) retenciones,
           coalesce(sum(a.monto) filter (where a.col = 'otros' and not a.futuro), 0) otros,
           coalesce(sum(a.monto) filter (where a.clase_ret = 'iva' and not a.futuro), 0) ret_iva,
           coalesce(sum(a.monto) filter (where a.clase_ret = 'municipal' and not a.futuro), 0) ret_mun,
           coalesce(sum(a.monto) filter (where a.col = 'pagos' and a.pago_moneda = 'USD' and not a.pago_igtf and not a.futuro), 0) pagos_div,
           -- lo aplicado después del corte: se le devuelve al saldo de hoy
           coalesce(sum(a.monto) filter (where a.futuro), 0) despues,
           max(a.fecha) filter (where not a.futuro) ultimo_abono,
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
             order by a.fecha nulls last, a.tipo) filter (where a.doc is not null and not a.futuro), '[]'::jsonb) abonos
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
           -- saldo al corte: notas de crédito (saldo negativo) − lo aplicado después; facturas y ND + lo aplicado después
           case when d.tipo = 'nota_credito' then d.saldo_usd - g.despues else d.saldo_usd + g.despues end saldo,
           v_corte - coalesce(d.fecha_vencimiento, d.fecha_emision, v_corte) dias,
           k.lista comentarios
      from docs d join agg g on g.id = d.id left join com k on k.factura_id = d.id
  ),
  sel as (
    select b.* from base b
     where case v_filtro
             when 'abiertas' then abs(b.saldo) > 0.009
             when 'todas' then (p_desde is null or b.fecha_emision >= p_desde) and (p_hasta is null or b.fecha_emision <= p_hasta)
             else abs(b.saldo) <= 0.009 and b.estado_cobro <> 'anulado'
                  and (p_desde is null or b.ultimo_abono >= p_desde) and (p_hasta is null or b.ultimo_abono <= p_hasta)
           end
  ),
  -- "Qué falta": componentes candidatos de una factura o nota de débito con saldo (USD), al corte
  qf as (
    select b.id, x.codigo, x.texto, x.esperado
      from sel b
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
         where v.esperado is not null and abs(b.saldo - v.esperado) <= v_tol
         union all
        select 20, 'solo_retencion', 'Falta el pago (retención ya aplicada)', null::numeric
         where b.pagos <= 0.009 and b.nc <= 0.009 and b.otros <= 0.009 and b.retenciones > 0.009 and b.saldo >= 1
         union all
        -- Lo único abonado equivale a la retención de IVA (cobros históricos que registraron la retención como pago)
        select 21, 'abono_retencion', 'Falta el pago (solo abonó la retención de IVA)', null::numeric
         where b.pagos > 0.009 and b.nc <= 0.009 and b.otros <= 0.009 and b.retenciones <= 0.009 and b.saldo >= 1
           and b.iva_usd > 0.009 and abs(b.pagos - coalesce(v_pct, 0.75) * b.iva_usd) <= v_tol
         union all
        select 30, 'diferencia_menor', 'Diferencia menor (redondeo o cambio)', null::numeric
         where b.saldo < 1
        ) c order by c.orden limit 1
      ) x
     where b.tipo <> 'nota_credito' and b.saldo > 0.009
       -- sin ningún abono falta todo: no se sugiere nada
       and b.pagos + b.nc + b.retenciones + b.otros > 0.009
  ),
  fin as (
    select b.*, q.codigo qf_codigo, q.texto qf_texto, q.esperado qf_esperado,
           -- En Bs: |total ÷ total_usd|, que por el redondeo del total en USD se aparta en el 3.er decimal de la tasa real; si
           -- una tasa conocida (la del documento, la de su documento de origen o la BCV de esas fechas) está a menos de 0,1 %,
           -- se muestra esa (las NC de una devolución llevan a veces la tasa de la factura que revierten). En USD: BCV del día.
           case when b.tasa_doc is not null then
                  coalesce((select c.t from (values (b.tasa_cambio), (b.tasa_origen_doc), (public.tasa_bcv_dia(b.fecha_emision)),
                                                    (case when b.emision_origen is not null then public.tasa_bcv_dia(b.emision_origen) end)) c(t)
                             where c.t > 1 and abs(c.t - b.tasa_doc) / b.tasa_doc < 0.001
                             order by abs(c.t - b.tasa_doc) limit 1), b.tasa_doc)
                when b.fecha_emision is not null then public.tasa_bcv_dia(b.fecha_emision) end tasa_emision,
           case when b.tasa_doc is not null then 'documento' when b.fecha_emision is not null then 'bcv' end tasa_origen0,
           case when b.saldo < -0.009 then case when b.tipo = 'nota_credito' then 'nc_favor' else 'a_favor' end
                when q.codigo in ('retencion_iva', 'retencion_municipal', 'retenciones') then 'retencion'
                else 'pendiente' end estatus,
           case when b.estado_cobro = 'anulado' then 'anulado'
                when abs(b.saldo) <= 0.01 then 'pagado'
                when abs(b.saldo) < abs(b.total_usd) then 'parcial'
                else 'pendiente' end estado_corte
      from sel b left join qf q on q.id = b.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'factura_id', b.id,
           'numero', b.numero,
           'tipo', case when b.tipo = 'nota_credito' then 'nota_credito' when b.es_nd then 'nota_debito' else 'factura' end,
           'nro_control', nullif(btrim(b.nro_control), ''),
           'emision', b.fecha_emision, 'vence', b.fecha_vencimiento, 'dias', b.dias,
           'estado', case when v_filtro = 'abiertas' then b.estado_corte else b.estado_cobro end,
           'estatus', b.estatus,
           'moneda', case when b.moneda = 'USD' then 'USD' else 'VES' end,
           'tasa', round(b.tasa_doc, 4),
           'tasa_emision', round(b.tasa_emision, 4),
           'tasa_origen', case when b.tasa_emision is not null then b.tasa_origen0 end,
           'base', round(b.base_usd, 2), 'iva', round(b.iva_usd, 2), 'total', round(b.total_usd, 2),
           'base_bs', case when b.tasa_doc is not null then round(b.subtotal * sign(b.total_usd), 2) end,
           'iva_bs', case when b.tasa_doc is not null then round(b.impuesto * sign(b.total_usd), 2) end,
           'total_bs', case when b.tasa_doc is not null then round(b.total * sign(b.total_usd), 2) end,
           'saldo_bs', case when b.tasa_doc is not null then round(b.saldo * b.tasa_doc, 2) end,
           'pagos', round(b.pagos, 2), 'nc', round(b.nc, 2), 'retenciones', round(b.retenciones, 2), 'otros', round(b.otros, 2),
           'abonado', round(b.pagos + b.nc + b.retenciones + b.otros, 2),
           'saldo', round(b.saldo, 2),
           'ultimo_abono', b.ultimo_abono,
           'que_falta', case when b.qf_codigo is not null then jsonb_build_object('codigo', b.qf_codigo, 'texto', b.qf_texto, 'esperado', round(b.qf_esperado, 2)) end,
           'comentarios', coalesce(b.comentarios, '[]'::jsonb),
           'abonos', b.abonos)
         order by
           case when v_filtro = 'abiertas' then coalesce(b.fecha_vencimiento, b.fecha_emision) end nulls last,
           case when v_filtro = 'abiertas' then b.fecha_emision end nulls last,
           case when v_filtro <> 'abiertas' then coalesce(b.fecha_emision, date '1900-01-01') end desc,
           b.numero), '[]'::jsonb)
    into v
    from fin b;
  return v;
end $$;
revoke all on function public.estado_cuenta_documentos(uuid, uuid, text, date, date, boolean, date) from public, anon, authenticated;

-- ── Lógica común del estado de cuenta, al corte ──
drop function if exists public.estado_cuenta_datos(uuid, uuid, date, date, boolean, boolean, text, boolean);
create or replace function public.estado_cuenta_datos(
  p_cliente uuid,
  p_empresa uuid,
  p_desde date default null,
  p_hasta date default null,
  p_movimientos boolean default true,
  p_internos boolean default false,
  p_filtro text default 'abiertas',
  p_desde_abierta boolean default false,
  p_corte date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_hoy date := (now() at time zone 'America/Caracas')::date;
  v_corte date := least(coalesce(p_corte, (now() at time zone 'America/Caracas')::date), (now() at time zone 'America/Caracas')::date);
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

  -- Documentos con saldo al corte, con el cruce completo (base, IVA, abonos, qué falta, comentarios, tasa y estatus)
  v_abiertos := public.estado_cuenta_documentos(p_cliente, p_empresa, 'abiertas', null, null, p_internos, v_corte);

  -- Resumen de esos mismos documentos (misma regla que Cuentas por Cobrar del admin)
  select jsonb_build_object(
      'saldo', round(coalesce(sum(s.saldo) filter (where s.saldo > 0), 0), 2),
      'por_vencer', round(coalesce(sum(s.saldo) filter (where s.saldo > 0 and s.dias <= 0), 0), 2),
      'vencido', round(coalesce(sum(s.saldo) filter (where s.saldo > 0 and s.dias > 0), 0), 2),
      'd1_30', round(coalesce(sum(s.saldo) filter (where s.saldo > 0 and s.dias between 1 and 30), 0), 2),
      'd31_60', round(coalesce(sum(s.saldo) filter (where s.saldo > 0 and s.dias between 31 and 60), 0), 2),
      'd61_90', round(coalesce(sum(s.saldo) filter (where s.saldo > 0 and s.dias between 61 and 90), 0), 2),
      'mas_90', round(coalesce(sum(s.saldo) filter (where s.saldo > 0 and s.dias > 90), 0), 2),
      'nc_a_favor', round(coalesce(-sum(s.saldo) filter (where s.saldo < 0), 0), 2),
      'facturas_abiertas', count(*) filter (where s.saldo > 0),
      'facturas_vencidas', count(*) filter (where s.saldo > 0 and s.dias > 0),
      'notas_credito_abiertas', count(*) filter (where s.saldo < 0),
      'notas_debito_abiertas', count(*) filter (where s.saldo > 0 and s.tipo = 'nota_debito'),
      'notas_debito_saldo', round(coalesce(sum(s.saldo) filter (where s.saldo > 0 and s.tipo = 'nota_debito'), 0), 2)),
      min(s.emision) filter (where s.saldo > 0)
    into v_resumen, v_desde_abierta
  from (select (d->>'saldo')::numeric saldo, (d->>'dias')::int dias, d->>'tipo' tipo, (d->>'emision')::date emision
          from jsonb_array_elements(v_abiertos) d) s;

  -- 2.1: los movimientos empiezan en la factura abierta más antigua (sin deuda: los últimos 90 días)
  if coalesce(p_desde_abierta, false) and p_desde is null then
    v_desde := coalesce(v_desde_abierta, v_hoy - 90);
    if p_hasta is not null and v_desde > p_hasta then v_desde := p_hasta; end if;
  end if;

  -- Anticipos (cobros de GUDS sin aplicar) de esta empresa, cobrados hasta el corte
  select coalesce(round(sum(a.disponible), 2), 0) into v_anticipos
    from v_anticipos a join pagos p on p.id = a.pago_id
   where a.cliente_id = p_cliente and a.disponible > 0.009
     and (p.empresa_id is null or p.empresa_id = p_empresa)
     and coalesce(p.fecha_pago, (coalesce(p.fecha_verificacion, p.created_at) at time zone 'America/Caracas')::date) <= v_corte;

  v_saldo := (v_resumen->>'saldo')::numeric;
  v_nc := (v_resumen->>'nc_a_favor')::numeric;
  v_neto := round(v_saldo - v_nc - v_anticipos, 2);
  v_resumen := v_resumen || jsonb_build_object(
    'anticipos', v_anticipos,
    'a_favor', round(v_nc + v_anticipos, 2),
    'neto', v_neto);

  if coalesce(p_filtro, 'abiertas') <> 'abiertas' then
    v_documentos := public.estado_cuenta_documentos(p_cliente, p_empresa, p_filtro, v_desde, p_hasta, p_internos, null);
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

  -- Libro de movimientos con saldo corrido (21b). Ya no forma parte del estado de cuenta (22c); se conserva para el
  -- frontend publicado hasta que se publique el nuevo, que pide p_movimientos = false.
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
        from v_anticipos a join pagos p on p.id = a.pago_id
       where a.cliente_id = p_cliente and a.disponible > 0.009 and (p.empresa_id is null or p.empresa_id = p_empresa)
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
       where v_corte = v_hoy and abs(d.dif) >= 0.005 and abs(d.dif) <= 1
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
    'corte', v_corte,
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
    'diferencia', case when coalesce(p_movimientos, true) and v_corte = v_hoy then round(v_total_libro - v_neto, 2) end);
end $$;
revoke all on function public.estado_cuenta_datos(uuid, uuid, date, date, boolean, boolean, text, boolean, date) from public, anon, authenticated;

-- ── Portal del cliente: siempre al corte de hoy (misma firma) ──
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
  return public.estado_cuenta_datos(c.o_cliente, c.o_empresa, p_desde, p_hasta, p_movimientos, false, p_filtro, p_desde_abierta, null);
end $$;
revoke all on function public.estado_cuenta_portal(date, date, boolean, text, boolean) from public, anon;
grant execute on function public.estado_cuenta_portal(date, date, boolean, text, boolean) to authenticated;

-- ── Admin (CuentaDetalle) y vendedor del cliente: con fecha de corte; comentarios internos solo para administración ──
drop function if exists public.estado_cuenta_cliente(uuid, date, date, boolean, text, boolean);
create or replace function public.estado_cuenta_cliente(
  p_cliente_id uuid,
  p_desde date default null,
  p_hasta date default null,
  p_movimientos boolean default true,
  p_filtro text default 'abiertas',
  p_desde_abierta boolean default false,
  p_corte date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_emp uuid;
  v_internos boolean;
begin
  v_emp := public.estado_cuenta_acceso(p_cliente_id, 'ver');
  v_internos := public.es_personal_admin() and public.puede('cuentas', 'ver');
  return public.estado_cuenta_datos(p_cliente_id, v_emp, p_desde, p_hasta, p_movimientos, v_internos, p_filtro, p_desde_abierta, p_corte);
end $$;
revoke all on function public.estado_cuenta_cliente(uuid, date, date, boolean, text, boolean, date) from public, anon;
grant execute on function public.estado_cuenta_cliente(uuid, date, date, boolean, text, boolean, date) to authenticated;

-- ── Enlace público: siempre al corte de hoy, sin identificadores internos y solo comentarios visibles ──
drop function if exists public.estado_cuenta_publico(text, date, date, boolean, text, boolean);
create or replace function public.estado_cuenta_publico(
  p_token text,
  p_desde date default null,
  p_hasta date default null,
  p_contar boolean default true,
  p_filtro text default 'abiertas',
  p_desde_abierta boolean default false,
  p_movimientos boolean default true
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
  v := public.estado_cuenta_datos(e.cliente_id, e.empresa_id, p_desde, p_hasta, coalesce(p_movimientos, true), false, p_filtro, p_desde_abierta, null);

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
revoke all on function public.estado_cuenta_publico(text, date, date, boolean, text, boolean, boolean) from public;
grant execute on function public.estado_cuenta_publico(text, date, date, boolean, text, boolean, boolean) to anon, authenticated;

-- ── Correo: los documentos con las columnas del formato del equipo (misma firma que 20w) ──
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
  v := public.estado_cuenta_datos(p_cliente_id, v_emp, null, null, false, false, 'abiertas', false, null);
  return jsonb_build_object(
    'hoy', v->'hoy',
    'corte', v->'corte',
    'cliente', (v->'cliente') || jsonb_build_object('email', (select nullif(btrim(c.email), '') from clientes c where c.id = p_cliente_id)),
    'empresa', v->'empresa',
    'resumen', v->'resumen',
    'documentos', coalesce((select jsonb_agg(jsonb_build_object(
                     'numero', d->>'numero', 'tipo', d->>'tipo', 'nro_control', d->>'nro_control',
                     'emision', d->>'emision', 'vence', d->>'vence', 'dias', (d->>'dias')::int,
                     'tasa', (d->>'tasa_emision')::numeric, 'base', (d->>'base')::numeric, 'iva', (d->>'iva')::numeric,
                     'total', (d->>'total')::numeric, 'abonado', (d->>'abonado')::numeric, 'saldo', (d->>'saldo')::numeric,
                     'estatus', d->>'estatus',
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
