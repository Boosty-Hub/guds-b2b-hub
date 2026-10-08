-- ════════════════════════════════════════════════════════════════════════
-- Fase 22e · Respuestas del dueño del 8-oct a lo abierto de 22a–22d (docs/PLAN-REPORTES-FINANZAS.md)
--   1. Estado de cuenta: una nota de crédito lleva la TASA DE LA FACTURA QUE AFECTA, como la pone finanzas en su Excel:
--      la que revierte (factura_origen_id); si no tiene, aquella en la que más se aplicó; si no, la que dice Profit para las
--      NC migradas (profit_documentos.numero_origen, del MISMO cliente: por número solo, otra serie da tasas equivocadas).
--      Con la factura en USD, la tasa es la BCV del día de esa factura. Y se ve DE DÓNDE sale cada tasa:
--      tasa_origen = 'factura' (+ tasa_factura = número) · 'documento' (documento en Bs: su propia tasa) · 'bcv' (BCV del
--      día: bcv.org.ve u Odoo) · 'profit' (días sin tasa en Odoo: se conservan las 335 tomadas de las facturas de Profit,
--      decisión del dueño, pero marcadas). tasa_bcv_dia_fuente(fecha): la fuente de la fila que usa tasa_bcv_dia.
--   2. Consignación: no se declara ni se aprueba con productos sin precio para el cliente (irían en 0 a Odoo); la base
--      responde con la lista de productos. Tampoco se declara en un almacén sin cliente asignado.
--      consignacion_disponible gana la columna precio (el formulario la muestra y avisa antes de enviar).
--   3. Permisos (D10 ampliado): Calidad y cuadre y "Top clientes que pagaron" (reporte_cobranza agrupado por cliente)
--      exigen reportes Y cuentas, como los demás reportes con datos por cliente (22a4). calidad_seccion (solo dice si la
--      sección está oculta) sigue con reportes.
--   Las funciones largas (estado_cuenta_documentos, declarar_venta_consignacion, revisar_declaracion_consignacion) se
--   reescriben completas a partir de su definición vigente (22c / 22b + pausa) con solo los cambios marcados "22e".
--   Nada de esto escribe en Odoo.
-- ════════════════════════════════════════════════════════════════════════
begin;

-- ── 1. Tasa del estado de cuenta ─────────────────────────────────────────
create or replace function public.tasa_bcv_dia_fuente(p_fecha date)
returns text
language sql
stable
security definer
set search_path = public
as $$
  -- Misma fila que tasa_bcv_dia(p_fecha)
  select t.fuente from tasa_bcv t
   where t.fecha <= p_fecha and t.tasa > 0
   order by t.fecha desc, (coalesce(t.fuente, '') ~* 'respaldo'), t.created_at
   limit 1
$$;
revoke all on function public.tasa_bcv_dia_fuente(date) from public, anon;
grant execute on function public.tasa_bcv_dia_fuente(date) to authenticated;

CREATE OR REPLACE FUNCTION public.estado_cuenta_documentos(p_cliente uuid, p_empresa uuid, p_filtro text DEFAULT 'abiertas'::text, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_internos boolean DEFAULT false, p_corte date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
           f.tasa_cambio, o.tasa_cambio tasa_origen_doc, o.fecha_emision emision_origen,
           -- 22e: factura que afecta una NC (la que revierte; si no, en la que más se aplicó; si no, la que dice Profit)
           af.numero af_numero, af.fecha_emision af_emision, af.tasa_cambio af_tasa_cambio,
           case when af.moneda <> 'USD' and af.total <> 0 and af.total_usd <> 0 then abs(af.total / af.total_usd) end af_tasa_doc
      from facturas f
      left join facturas o on o.id = f.factura_origen_id
      left join lateral (
        select y.numero, y.fecha_emision, y.tasa_cambio, y.moneda, y.total, y.total_usd from (
          -- en Odoo/GUDS: la factura que revierte o en la que más se aplicó
          select 1 prio, x.numero, x.fecha_emision, x.tasa_cambio, x.moneda, x.total, x.total_usd
            from facturas x
           where x.tipo <> 'nota_credito'
             and x.id = coalesce(f.factura_origen_id,
                                 (select fa.factura_id from factura_aplicaciones fa
                                   where fa.documento_id = f.id and fa.factura_id is not null
                                   order by fa.monto_usd desc nulls last, fa.fecha, fa.factura_id limit 1))
          union all
          -- NC migrada de Profit: Profit guarda el número de la factura que afecta (numero_origen), del MISMO cliente
          select 2, pn.numero_origen, coalesce(po.fecha, fo.fecha_emision), fo.tasa_cambio, coalesce(fo.moneda, 'USD'), fo.total, fo.total_usd
            from profit_documentos pn
            left join lateral (select p.fecha from profit_documentos p
                                where p.lote = pn.lote and p.empresa_id = pn.empresa_id and p.tipo = 'factura'
                                  and p.numero = pn.numero_origen and p.cliente_codigo = pn.cliente_codigo
                                order by p.fecha limit 1) po on true
            left join lateral (select x.fecha_emision, x.tasa_cambio, x.moneda, x.total, x.total_usd from facturas x
                                where x.empresa_id = f.empresa_id and x.cliente_id = f.cliente_id and x.tipo = 'factura'
                                  and x.numero = pn.numero_origen and x.estado = 'posted'
                                order by x.fecha_emision limit 1) fo on true
           where pn.lote = public.profit_lote_vigente() and pn.empresa_id = f.empresa_id and pn.cliente_id = f.cliente_id
             and pn.tipo in ('nota_credito', 'devolucion') and pn.numero = f.numero and pn.numero_origen is not null
             and coalesce(po.fecha, fo.fecha_emision) is not null
        ) y
        where f.tipo = 'nota_credito'
        order by y.prio limit 1
      ) af on true
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
           -- 22e (decisión del 8-oct): una NC lleva la tasa de la factura que afecta, como en el Excel de finanzas
           case when b.af_tasa_doc is not null then
                  coalesce((select c.t from (values (b.af_tasa_cambio), (public.tasa_bcv_dia(b.af_emision))) c(t)
                             where c.t > 1 and abs(c.t - b.af_tasa_doc) / b.af_tasa_doc < 0.001
                             order by abs(c.t - b.af_tasa_doc) limit 1), b.af_tasa_doc)
                when b.af_numero is not null and b.af_emision is not null then public.tasa_bcv_dia(b.af_emision)
                when b.tasa_doc is not null then
                  coalesce((select c.t from (values (b.tasa_cambio), (b.tasa_origen_doc), (public.tasa_bcv_dia(b.fecha_emision)),
                                                    (case when b.emision_origen is not null then public.tasa_bcv_dia(b.emision_origen) end)) c(t)
                             where c.t > 1 and abs(c.t - b.tasa_doc) / b.tasa_doc < 0.001
                             order by abs(c.t - b.tasa_doc) limit 1), b.tasa_doc)
                when b.fecha_emision is not null then public.tasa_bcv_dia(b.fecha_emision) end tasa_emision,
           -- De dónde sale la tasa (se muestra): factura que afecta la NC · el propio documento en Bs · BCV del día
           -- (bcv.org.ve u Odoo) · Profit (días sin tasa en Odoo, rellenados con la tasa de las facturas de Profit)
           case when b.af_tasa_doc is not null or (b.af_numero is not null and b.af_emision is not null) then 'factura'
                when b.tasa_doc is not null then 'documento'
                when b.fecha_emision is not null then
                  case when public.tasa_bcv_dia_fuente(b.fecha_emision) ~* 'profit' then 'profit' else 'bcv' end end tasa_origen0,
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
           'tasa_factura', case when b.tasa_emision is not null and b.tasa_origen0 = 'factura' then b.af_numero end,
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
end $function$;

-- ── 2. Consignación: precio obligatorio y almacén con cliente ────────────
drop function if exists public.consignacion_disponible(uuid);
create function public.consignacion_disponible(p_almacen_id uuid)
 returns table(producto_id uuid, nombre text, sku text, cantidad numeric, reservado numeric, comprometido numeric, disponible numeric, precio numeric)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
#variable_conflict use_column
declare a public.almacenes%rowtype;
begin
  select * into a from public.almacenes where id = p_almacen_id;
  if not found or a.tipo <> 'consignacion' then raise exception 'Almacén de consignación no encontrado' using errcode = 'P0001'; end if;
  if not (a.empresa_id is null or a.empresa_id = any (public.empresas_visibles())) then
    raise exception 'Este almacén pertenece a otra empresa' using errcode = '42501';
  end if;
  if not ((public.is_admin() and (select public.puede('inventario', 'ver')))
          or (a.cliente_id is not null and a.cliente_id = any (public.clientes_del_usuario()))
          or (a.cliente_id is not null and a.cliente_id in (select public.mis_clientes_vendedor()))) then
    raise exception 'No tienes acceso a este almacén' using errcode = '42501';
  end if;
  return query
    select ia.producto_id, p.nombre::text, p.sku::text, ia.cantidad, coalesce(ia.reservado, 0), coalesce(c.cantidad, 0),
           greatest(ia.cantidad - coalesce(ia.reservado, 0) - coalesce(c.cantidad, 0), 0),
           -- 22e: precio del producto para el cliente del almacén (null sin cliente); en 0 no se puede declarar
           case when a.cliente_id is not null then coalesce(public.precio_efectivo(ia.producto_id, null, a.cliente_id), 0) end
    from public.inventario_almacen ia
    join public.productos p on p.id = ia.producto_id
    left join public.consignacion_comprometido(p_almacen_id) c on c.producto_id = ia.producto_id
    where ia.almacen_id = p_almacen_id and ia.cantidad > 0
    order by p.nombre;
end $function$;
revoke all on function public.consignacion_disponible(uuid) from public, anon;
grant execute on function public.consignacion_disponible(uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declarar_venta_consignacion(p_almacen_id uuid, p_items jsonb, p_notas text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_usuario public.usuarios%rowtype;
  v_almacen public.almacenes%rowtype;
  v_declaracion_id uuid;
  v_numero text;
  v_subtotal numeric := 0;
  v_impuesto numeric;
  v_total numeric;
  v_cliente_nombre text;
  r record;
begin
  select * into v_usuario from public.usuarios where auth_id = auth.uid();
  if not found then
    raise exception 'Usuario no encontrado';
  end if;

  select * into v_almacen from public.almacenes where id = p_almacen_id;
  if not found then
    raise exception 'Almacén % no existe', p_almacen_id;
  end if;
  if v_almacen.tipo <> 'consignacion' or not coalesce(v_almacen.activo, true) then
    raise exception 'El almacén % no es de consignación o está inactivo', v_almacen.nombre;
  end if;

  -- Autorización
  if public.is_admin() then
    null; -- admin puede declarar sobre cualquier almacén de consignación
  elsif v_usuario.role::text = 'cliente' then
    if v_almacen.cliente_id is null or not (v_almacen.cliente_id = any (public.clientes_del_usuario())) then
      raise exception 'No tenés acceso a este almacén';
    end if;
  elsif v_usuario.role::text = 'vendedor' then
    if v_almacen.cliente_id is null or v_almacen.cliente_id not in (select public.mis_clientes_vendedor()) then
      raise exception 'No tenés acceso a este almacén';
    end if;
  else
    raise exception 'No autorizado';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Agregá al menos un producto vendido';
  end if;

  -- 22e: el almacén necesita su cliente, y cada producto declarado, precio para ese cliente (el pedido va a Odoo con
  -- ese precio: en 0 no se declara; decisión del 8-oct)
  if v_almacen.cliente_id is null then
    raise exception 'El almacén % no tiene un cliente asignado: asígnalo en Inventario → Almacenes antes de declarar ventas', v_almacen.nombre
      using errcode = 'P0001';
  end if;
  declare v_sin_precio text;
  begin
    select string_agg(p.nombre, ', ' order by p.nombre) into v_sin_precio
      from (select distinct (x->>'producto_id')::uuid id from jsonb_array_elements(p_items) x) i
      join public.productos p on p.id = i.id
     where coalesce(public.precio_efectivo(p.id, null, v_almacen.cliente_id), 0) <= 0;
    if v_sin_precio is not null then
      raise exception 'Sin precio para este cliente: %. No se puede declarar hasta que administración les asigne precio (lista de precios del cliente o precio del producto).', v_sin_precio
        using errcode = 'P0001';
    end if;
  end;

  v_numero := public.siguiente_numero(public.empresa_activa_requerida(), 'DC', 6);

  insert into public.declaraciones_consignacion (
    numero, almacen_id, cliente_id, declarado_por, rol_declarante, notas
  ) values (
    v_numero, p_almacen_id, v_almacen.cliente_id, v_usuario.id,
    case when public.is_admin() then 'admin' else v_usuario.role::text end,
    p_notas
  ) returning id into v_declaracion_id;

  -- Un producto repetido en la lista se suma (se valida el total contra lo disponible)
  for r in
    select (x->>'producto_id')::uuid as producto_id, sum((x->>'cantidad')::numeric) as cantidad, bool_or((x->>'cantidad') is null) sin_cantidad
    from jsonb_array_elements(p_items) x
    group by 1
  loop
    declare
      v_disponible numeric;
      v_precio numeric;
      v_nombre text;
      v_sku text;
      v_sub numeric;
    begin
      if r.sin_cantidad or r.cantidad is null or r.cantidad <= 0 then
        raise exception 'Cantidad inválida para un producto declarado';
      end if;
      if r.cantidad <> trunc(r.cantidad) then
        raise exception 'Las cantidades se declaran en unidades enteras';
      end if;

      select p.nombre, p.sku into v_nombre, v_sku from public.productos p where p.id = r.producto_id;

      -- Disponible = existencia (Odoo) − reservado (Odoo) − declarado en GUDS que Odoo aún no reservó (22b)
      select ia.cantidad - coalesce(ia.reservado, 0)
             - coalesce((select c.cantidad from public.consignacion_comprometido(p_almacen_id, v_declaracion_id) c where c.producto_id = r.producto_id), 0)
        into v_disponible
      from public.inventario_almacen ia
      where ia.almacen_id = p_almacen_id and ia.producto_id = r.producto_id;

      if v_disponible is null or r.cantidad > v_disponible then
        raise exception 'Stock insuficiente de %: disponible % (descontando lo reservado en Odoo y lo ya declarado)',
          coalesce(v_nombre, 'producto'), greatest(coalesce(v_disponible, 0), 0);
      end if;

      v_precio := public.precio_efectivo(r.producto_id, null, v_almacen.cliente_id);
      v_sub := round(r.cantidad * v_precio, 2);
      v_subtotal := v_subtotal + v_sub;

      insert into public.declaracion_consignacion_items (
        declaracion_id, producto_id, nombre_producto, sku_producto, cantidad, precio_unitario, subtotal
      ) values (
        v_declaracion_id, r.producto_id, v_nombre, v_sku, r.cantidad, v_precio, v_sub
      );
    end;
  end loop;

  -- IVA de cada producto (Odoo), por grupo de tasa como Odoo (fase 20c)
  select coalesce(sum(round(g.base * g.pct / 100.0, 2)), 0) into v_impuesto
  from (select public.impuesto_producto(i.producto_id) pct, sum(i.subtotal) base
        from public.declaracion_consignacion_items i where i.declaracion_id = v_declaracion_id group by 1) g;
  v_total := v_subtotal + v_impuesto;

  perform set_config('guds.revision_consignacion', 'on', true);
  update public.declaraciones_consignacion
  set subtotal = v_subtotal, impuesto = v_impuesto, total = v_total
  where id = v_declaracion_id;
  perform set_config('guds.revision_consignacion', 'off', true);

  select nombre_negocio into v_cliente_nombre from public.clientes where id = v_almacen.cliente_id;
  perform public.notif_admins(
    'Declaración de consignación por revisar',
    coalesce(v_cliente_nombre, 'Cliente') || ' declaró ventas por ' || public.fmt_usd(v_total),
    'alerta', '/admin/consignacion'
  );

  return v_declaracion_id;
end $function$;

CREATE OR REPLACE FUNCTION public.revisar_declaracion_consignacion(p_declaracion_id uuid, p_aprobar boolean, p_notas text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_admin uuid;
  d public.declaraciones_consignacion%rowtype;
  a public.almacenes%rowtype;
  v_cliente text;
  v_vendedor uuid;
  v_orden_id uuid;
  v_numero text;
  v_total numeric;
  r record;
  v_disponible numeric;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede revisar declaraciones';
  end if;
  select id into v_admin from public.usuarios where auth_id = auth.uid();

  select * into d from public.declaraciones_consignacion where id = p_declaracion_id for update;
  if not found then
    raise exception 'Declaración % no existe', p_declaracion_id;
  end if;
  if d.estado <> 'pendiente' then
    raise exception 'La declaración ya fue %', d.estado;
  end if;

  perform set_config('guds.revision_consignacion', 'on', true);

  if not p_aprobar then
    update public.declaraciones_consignacion
    set estado = 'rechazado', revisado_por = v_admin, revisado_en = now(), notas = coalesce(p_notas, notas)
    where id = p_declaracion_id;
    perform set_config('guds.revision_consignacion', 'off', true);
    return jsonb_build_object('estado', 'rechazado');
  end if;

  if coalesce((select valor from public.configuracion where clave = 'odoo_envio_consignacion'), 'pausado') <> 'activo' then
    raise exception 'La aprobación de ventas en consignación está en pausa hasta actualizar el envío a Odoo (fase 22b): el pedido saldría del almacén general. Puedes rechazarla o esperar.' using errcode = 'P0001';
  end if;
  select * into a from public.almacenes where id = d.almacen_id;
  -- 22e: con líneas sin precio no se aprueba (irían en 0 a Odoo)
  if exists (select 1 from public.declaracion_consignacion_items i where i.declaracion_id = d.id and coalesce(i.precio_unitario, 0) <= 0) then
    raise exception 'No se puede aprobar: hay productos sin precio (%). Recházala y que se declare de nuevo cuando tengan precio.',
      (select string_agg(coalesce(i.nombre_producto, 'producto'), ', ' order by i.nombre_producto) from public.declaracion_consignacion_items i
        where i.declaracion_id = d.id and coalesce(i.precio_unitario, 0) <= 0)
      using errcode = 'P0001';
  end if;
  if a.odoo_id is null then
    raise exception 'El almacén % no está enlazado a Odoo: no se puede crear el pedido', a.nombre;
  end if;
  if not coalesce(a.activo, true) then
    raise exception 'El almacén % está inactivo', a.nombre;
  end if;
  if exists (select 1 from public.declaracion_consignacion_items i where i.declaracion_id = d.id and (i.cantidad <> trunc(i.cantidad) or i.producto_id is null)) then
    raise exception 'La declaración tiene cantidades no enteras o productos sin enlazar: rechazala y que se declare de nuevo';
  end if;

  -- Re-valida lo disponible (pudo cambiar desde que se declaró). El stock NO se descuenta aquí: baja cuando Odoo valida la entrega.
  for r in
    select i.producto_id, max(i.nombre_producto) nombre, sum(i.cantidad) cantidad
    from public.declaracion_consignacion_items i where i.declaracion_id = d.id group by 1
  loop
    select ia.cantidad - coalesce(ia.reservado, 0)
           - coalesce((select c.cantidad from public.consignacion_comprometido(d.almacen_id, d.id) c where c.producto_id = r.producto_id), 0)
      into v_disponible
    from public.inventario_almacen ia
    where ia.almacen_id = d.almacen_id and ia.producto_id = r.producto_id;
    if v_disponible is null or r.cantidad > v_disponible then
      raise exception 'Stock insuficiente de %: disponible % (cambió desde que se declaró)', coalesce(r.nombre, 'producto'), greatest(coalesce(v_disponible, 0), 0);
    end if;
  end loop;

  select c.nombre_negocio, case when d.rol_declarante = 'vendedor' then d.declarado_por else c.vendedor_asignado_id end
    into v_cliente, v_vendedor
  from public.clientes c where c.id = d.cliente_id;

  -- Pedido aprobado por quien revisa: el trigger y_orden_enviar_si_aprobada lo envía a Odoo al confirmar la transacción
  insert into public.ordenes (
    empresa_id, cliente_id, usuario_id, vendedor_id, almacen_id, subtotal, descuento, impuesto, envio, total, estado,
    metodo_pago, notas, aprobacion, aprobado_por, aprobado_at
  ) values (
    d.empresa_id, d.cliente_id, coalesce(d.declarado_por, v_admin), v_vendedor, d.almacen_id, d.subtotal, 0, d.impuesto, 0, d.total,
    'pendiente', 'credito',
    'Venta en consignación ' || d.numero || ' · ' || a.nombre || coalesce(' · ' || nullif(trim(d.notas), ''), ''),
    'aprobada', v_admin, now()
  ) returning id, numero into v_orden_id, v_numero;

  insert into public.orden_items (orden_id, producto_id, cantidad, precio_unitario, descuento, subtotal, nombre_producto, sku_producto,
    tipo_empaque_id, unidades_por_empaque)
  select v_orden_id, i.producto_id, i.cantidad::int, i.precio_unitario, 0, i.subtotal, i.nombre_producto, i.sku_producto, null, 1
  from public.declaracion_consignacion_items i
  where i.declaracion_id = d.id
  order by i.created_at, i.id;
  v_total := coalesce(public.aplicar_impuestos_orden(v_orden_id), d.total);

  update public.declaraciones_consignacion
  set estado = 'aprobado', orden_id = v_orden_id, revisado_por = v_admin, revisado_en = now(), notas = coalesce(p_notas, notas)
  where id = p_declaracion_id;
  perform set_config('guds.revision_consignacion', 'off', true);

  perform public.notif_admins('Pedido de consignación ' || v_numero,
    coalesce(v_cliente, 'Cliente') || ' · ' || public.fmt_usd(v_total) || ' · declaración ' || d.numero || ' aprobada; se está creando en Odoo',
    'orden', '/admin/ordenes?orden=' || v_orden_id);
  perform public.notif_cliente(d.cliente_id, 'Declaración de consignación aprobada',
    'Tu declaración ' || d.numero || ' generó el pedido ' || v_numero || ' por ' || public.fmt_usd(v_total)
      || '. La factura te llegará cuando se procese.', 'exito', '/portal/consignacion');
  perform public.notif_vendedor(d.cliente_id, 'Declaración de consignación aprobada',
    coalesce(v_cliente, 'Cliente') || ': ' || d.numero || ' → pedido ' || v_numero || ' · ' || public.fmt_usd(v_total), 'exito', '/vendedor/consignacion');

  return jsonb_build_object('estado', 'aprobado', 'orden_id', v_orden_id, 'numero', v_numero, 'total', v_total,
    'mensaje', 'Pedido ' || v_numero || ' creado; se está enviando a Odoo como cotización desde ' || a.nombre);
end $function$;

-- ── 3. Permisos: Calidad y cuadre y "Top clientes que pagaron" exigen reportes + cuentas ─────────────────
-- Reemplazos puntuales sobre la definición vigente (no pisan otros cambios); se puede volver a correr (si ya está, no hace nada)
do $$
declare
  f text; d text; n text;
begin
  -- Lectura de la bandeja y del cuadre
  foreach f in array array['public.reporte_cuadre_profit_odoo()', 'public.reporte_calidad_datos()', 'public.calidad_revisar()'] loop
    d := pg_get_functiondef(f::regprocedure);
    n := replace(d, 'perform public.exigir_permiso_reportes();', 'perform public.exigir_permiso_reportes_cuentas();');
    if n = d and position('exigir_permiso_reportes_cuentas' in d) = 0 then raise exception '%: no se encontró la verificación de permisos', f; end if;
    if n <> d then execute n; end if;
  end loop;
  -- Trabajo en la bandeja
  foreach f in array array['public.calidad_actualizar_tareas(uuid[],text,uuid,boolean,text)', 'public.calidad_corregir_direccion(uuid,jsonb)'] loop
    d := pg_get_functiondef(f::regprocedure);
    n := replace(d, 'if not public.puede(''reportes'', ''editar'') then',
                    'if not (public.puede(''reportes'', ''editar'') and public.puede(''cuentas'', ''ver'')) then');
    if n = d and position('public.puede(''cuentas'', ''ver'')' in d) = 0 then raise exception '%: no se encontró la verificación de permisos', f; end if;
    if n <> d then execute n; end if;
  end loop;
  -- Responsables asignables (lista de usuarios)
  d := pg_get_functiondef('public.calidad_responsables()'::regprocedure);
  if position('public.puede(''cuentas'', ''ver'')' in d) = 0 then
    n := replace(d, 'where public.puede(''reportes'', ''ver'') and', 'where public.puede(''reportes'', ''ver'') and public.puede(''cuentas'', ''ver'') and');
    if n = d then raise exception 'calidad_responsables: no se encontró la verificación de permisos'; end if;
    execute n;
  end if;
  -- Cobranza agrupada por cliente (la función guardada usa CRLF: el reemplazo no depende del salto de línea)
  d := pg_get_functiondef('public.reporte_cobranza(date,date,text)'::regprocedure);
  if position('exigir_permiso_reportes_cuentas' in d) = 0 then
    n := replace(d, 'perform public.exigir_permiso_reportes();',
      'if p_agrupar = ''cliente'' then perform public.exigir_permiso_reportes_cuentas(); else perform public.exigir_permiso_reportes(); end if;  -- 22e: por cliente exige también Cuentas');
    if n = d then raise exception 'reporte_cobranza: no se encontró la verificación de permisos'; end if;
    execute n;
  end if;
end $$;

alter policy calidad_tareas_ver on public.calidad_tareas
  using ((select public.puede('reportes', 'ver')) and (select public.puede('cuentas', 'ver')));
alter policy calidad_tareas_historial_ver on public.calidad_tareas_historial
  using ((select public.puede('reportes', 'ver')) and (select public.puede('cuentas', 'ver')));

commit;
