-- ════════════════════════════════════════════════════════════════════════
-- Fase 20w · Estado de cuenta: enlace público revocable, PDF y envío por correo (pedidos 4, 5 y 6 del dueño)
--   · estado_cuenta_datos(cliente, empresa, desde, hasta, movimientos) → INTERNA (no se ejecuta por la API): la lógica
--     del estado de cuenta que antes vivía en estado_cuenta_portal (fase 20m), ahora para cualquier cliente y empresa.
--     Mismo resumen que Cuentas por Cobrar y mismo libro con saldo corrido. Novedades:
--       - 'abiertos': documentos con saldo (facturas, notas de débito y notas de crédito a favor) con vencimiento y días.
--       - Las notas de débito y de crédito de 0,00 USD (ajustes por diferencial cambiario en bolívares: 441 de las 483 ND
--         del diario "Nota debito cliente") no se listan como movimientos: no mueven el saldo en USD (su saldo y todo lo
--         aplicado a ellas es 0,00) y enterraban los movimientos reales. Se cuentan en 'ajustes_cambiarios' para dejar
--         constancia en pantalla y en el PDF. El saldo y el libro no cambian.
--       - Empresa con sus datos de contacto (para el PDF) y cliente con su dirección.
--   · estado_cuenta_portal(desde, hasta, movimientos) → la misma de 20m, ahora sobre estado_cuenta_datos.
--   · estado_cuenta_cliente(cliente, desde, hasta, movimientos) → el del admin (CuentaDetalle): personal con 'cuentas'
--     ver o el vendedor del cliente. Misma fuente que el portal y que el enlace público.
--   · Enlaces públicos (estado_cuenta_enlaces): token aleatorio de 32 bytes (43 caracteres url-safe), uno activo por
--     cliente y empresa, vencimiento opcional, revocables al instante, con último acceso y número de accesos.
--       - crear_enlace_estado_cuenta / revocar_enlace_estado_cuenta / enlaces_estado_cuenta: administración con
--         'cuentas' editar, o el vendedor para clientes de su cartera (es_vendedor_de). Sin tocar la tabla directo.
--       - estado_cuenta_publico(token, desde, hasta, contar) → anon: el estado de cuenta de ESE cliente y empresa, sin
--         identificadores internos; registra el acceso. Token inválido, revocado o vencido → el mismo error genérico.
--   · Envíos por correo (estado_cuenta_envios): los escribe solo la función edge enviar-estado-cuenta con la llave de
--     servicio (registrar_envio_estado_cuenta / cerrar_envio_estado_cuenta, con límite de 5 por minuto por usuario y
--     20 por hora por cliente). datos_correo_estado_cuenta da al edge (con el JWT del usuario) los datos del correo y
--     valida el permiso; envios_estado_cuenta lista el historial en CuentaDetalle.
--   Nada de esto escribe en Odoo.
-- ════════════════════════════════════════════════════════════════════════
begin;

-- ── Lógica del estado de cuenta (interna) ──
create or replace function public.estado_cuenta_datos(
  p_cliente uuid,
  p_empresa uuid,
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
      'notas_debito_saldo', round(coalesce(sum(s.saldo_usd) filter (where s.saldo_usd > 0 and s.es_nd), 0), 2))
    into v_resumen
  from (
    select f.saldo_usd, coalesce(f.es_nota_debito, false) and f.tipo <> 'nota_credito' es_nd,
           v_hoy - coalesce(f.fecha_vencimiento, f.fecha_emision, v_hoy) dias
      from facturas f
     where f.cliente_id = p_cliente and f.estado = 'posted'
       and (f.empresa_id is null or f.empresa_id = p_empresa)
       and abs(f.saldo_usd) > 0.009
  ) s;

  select coalesce(round(sum(a.disponible), 2), 0) into v_anticipos
    from v_anticipos a where a.cliente_id = p_cliente and a.disponible > 0.009;

  v_saldo := (v_resumen->>'saldo')::numeric;
  v_nc := (v_resumen->>'nc_a_favor')::numeric;
  v_neto := round(v_saldo - v_nc - v_anticipos, 2);
  v_resumen := v_resumen || jsonb_build_object(
    'anticipos', v_anticipos,
    'a_favor', round(v_nc + v_anticipos, 2),
    'neto', v_neto);

  -- Documentos con saldo: primero lo que se debe (por vencimiento), al final las notas de crédito a favor
  select coalesce(jsonb_agg(jsonb_build_object(
           'factura_id', f.id, 'numero', f.numero,
           'tipo', case when f.tipo = 'nota_credito' then 'nota_credito' when f.es_nota_debito then 'nota_debito' else 'factura' end,
           'emision', f.fecha_emision, 'vence', f.fecha_vencimiento,
           'total', round(f.total_usd, 2), 'saldo', round(f.saldo_usd, 2),
           'dias', v_hoy - coalesce(f.fecha_vencimiento, f.fecha_emision, v_hoy),
           'estado', f.estado_cobro)
         order by (f.saldo_usd < 0), coalesce(f.fecha_vencimiento, f.fecha_emision) nulls last, f.numero), '[]'::jsonb)
    into v_abiertos
    from facturas f
   where f.cliente_id = p_cliente and f.estado = 'posted'
     and (f.empresa_id is null or f.empresa_id = p_empresa)
     and abs(f.saldo_usd) > 0.009;

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
    -- Ajustes cambiarios de 0,00 USD que no se listan (en el período pedido)
    select count(*) into v_ajustes
      from facturas f
     where f.cliente_id = p_cliente and f.estado = 'posted'
       and (f.empresa_id is null or f.empresa_id = p_empresa)
       and (f.tipo = 'nota_credito' or f.es_nota_debito)
       and abs(coalesce(f.total_usd, 0)) < 0.005 and abs(coalesce(f.saldo_usd, 0)) < 0.005
       and (p_desde is null or coalesce(f.fecha_emision, date '1900-01-01') >= p_desde)
       and (p_hasta is null or coalesce(f.fecha_emision, date '1900-01-01') <= p_hasta);

    with fac as (
      select f.id, f.numero, f.tipo, f.es_nota_debito, f.fecha_emision, f.fecha_vencimiento, f.total_usd, f.saldo_usd, f.estado_cobro
        from facturas f
       where f.cliente_id = p_cliente and f.estado = 'posted'
         and (f.empresa_id is null or f.empresa_id = p_empresa)
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
        from v_anticipos a where a.cliente_id = p_cliente and a.disponible > 0.009
    ),
    mov0 as (
      -- Documentos: facturas y notas de débito suman; las notas de crédito restan (total_usd ya viene negativo).
      -- Las notas de débito y de crédito de 0,00 USD (ajustes cambiarios) no se listan: ver 'ajustes_cambiarios'.
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
    -- Sin renglones de 0,00 (ajustes de Odoo por fracciones de céntimo); los documentos se muestran salvo los de 0,00
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
    'abiertos', v_abiertos,
    'periodo', jsonb_build_object('desde', p_desde, 'hasta', p_hasta),
    'saldo_inicial', round(v_inicial, 2),
    'saldo_final', round(v_final, 2),
    'movimientos', v_mov,
    'ajustes_cambiarios', v_ajustes,
    'diferencia', case when coalesce(p_movimientos, true) then round(v_total_libro - v_neto, 2) end);
end $$;

revoke all on function public.estado_cuenta_datos(uuid, uuid, date, date, boolean) from public, anon, authenticated;

-- ── Portal del cliente (20m): misma firma y mismo resultado, sobre la función común ──
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
begin
  select * into c from public.portal_cliente_contexto();
  return public.estado_cuenta_datos(c.o_cliente, c.o_empresa, p_desde, p_hasta, p_movimientos);
end $$;

revoke all on function public.estado_cuenta_portal(date, date, boolean) from public, anon;
grant execute on function public.estado_cuenta_portal(date, date, boolean) to authenticated;

-- ── Quién puede qué sobre el estado de cuenta de un cliente (interna) ──
-- p_accion 'ver' | 'editar'. Administración con el permiso de 'cuentas'; el vendedor solo para clientes de su cartera
-- (y si p_vendedor). Devuelve la empresa del estado de cuenta: la del cliente o, si es compartido, la activa. Para
-- editar (crear o revocar enlaces, enviar) rige la regla de toda la plataforma: con una empresa elegida y la del cliente.
create or replace function public.estado_cuenta_acceso(p_cliente_id uuid, p_accion text, p_vendedor boolean default true)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cli_emp uuid;
  v_emp uuid;
  v_activa uuid;
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;
  select c.empresa_id into v_cli_emp from clientes c where c.id = p_cliente_id;
  if not found then
    raise exception 'Cliente no encontrado' using errcode = 'P0002';
  end if;
  if not ((public.es_personal_admin() and public.puede('cuentas', p_accion))
          or (coalesce(p_vendedor, true) and public.es_vendedor_de(p_cliente_id))) then
    raise exception 'No tienes permiso sobre el estado de cuenta de este cliente' using errcode = '42501';
  end if;
  v_activa := public.empresa_activa();
  v_emp := coalesce(v_cli_emp, v_activa);
  if v_emp is null then
    raise exception 'Selecciona una empresa (GUDS o Quirutec) en el menú superior: este cliente es de las dos.' using errcode = 'P0001';
  end if;
  if not (v_emp = any (public.empresas_permitidas())) then
    raise exception 'No tienes acceso a la empresa de este cliente' using errcode = '42501';
  end if;
  if p_accion <> 'ver' then
    if v_activa is null then
      raise exception 'Modo consulta ("Ambas empresas"): selecciona GUDS o Quirutec en el menú superior para hacer cambios.' using errcode = 'P0001';
    end if;
    if v_activa <> v_emp then
      raise exception 'Este cliente pertenece a otra empresa. Cámbiala en el menú superior.' using errcode = 'P0001';
    end if;
  end if;
  return v_emp;
end $$;

revoke all on function public.estado_cuenta_acceso(uuid, text, boolean) from public, anon, authenticated;

-- ── Estado de cuenta de un cliente para el admin (CuentaDetalle) ──
create or replace function public.estado_cuenta_cliente(
  p_cliente_id uuid,
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
  v_emp uuid;
begin
  v_emp := public.estado_cuenta_acceso(p_cliente_id, 'ver');
  return public.estado_cuenta_datos(p_cliente_id, v_emp, p_desde, p_hasta, p_movimientos);
end $$;

revoke all on function public.estado_cuenta_cliente(uuid, date, date, boolean) from public, anon;
grant execute on function public.estado_cuenta_cliente(uuid, date, date, boolean) to authenticated;

-- ── Enlaces públicos ──
create table if not exists public.estado_cuenta_enlaces (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  token text not null unique check (token ~ '^[A-Za-z0-9_-]{43}$'),
  creado_por uuid references public.usuarios(id) on delete set null,
  creado_at timestamptz not null default now(),
  vence_at timestamptz,
  revocado_at timestamptz,
  revocado_por uuid references public.usuarios(id) on delete set null,
  revocado_motivo text check (revocado_motivo in ('revocado', 'reemplazado', 'vencido')),
  ultimo_acceso_at timestamptz,
  accesos integer not null default 0,
  check (vence_at is null or vence_at > creado_at),
  check ((revocado_at is null) = (revocado_motivo is null))
);
comment on table public.estado_cuenta_enlaces is
  'Enlaces públicos del estado de cuenta (fase 20w). Solo por RPC: crear_enlace_estado_cuenta, revocar_enlace_estado_cuenta, enlaces_estado_cuenta y estado_cuenta_publico.';
-- Un solo enlace sin revocar por cliente y empresa (el que se reutiliza)
create unique index if not exists estado_cuenta_enlaces_uno_activo
  on public.estado_cuenta_enlaces (cliente_id, empresa_id) where revocado_at is null;
create index if not exists estado_cuenta_enlaces_cliente on public.estado_cuenta_enlaces (cliente_id, creado_at desc);

alter table public.estado_cuenta_enlaces enable row level security;
revoke all on table public.estado_cuenta_enlaces from public, anon, authenticated;

-- ── Envíos por correo ──
create table if not exists public.estado_cuenta_envios (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  enlace_id uuid references public.estado_cuenta_enlaces(id) on delete set null,
  destinatarios text[] not null check (cardinality(destinatarios) between 1 and 10),
  asunto text not null check (length(asunto) between 1 and 200),
  mensaje text check (length(mensaje) <= 2000),
  adjunto_nombre text,
  adjunto_bytes integer,
  enviado_por uuid references public.usuarios(id) on delete set null,
  creado_at timestamptz not null default now(),
  enviado_at timestamptz,
  estado text not null default 'enviando' check (estado in ('enviando', 'enviado', 'fallido')),
  resend_id text,
  error text
);
comment on table public.estado_cuenta_envios is
  'Envíos del estado de cuenta por correo (fase 20w, Resend). Los escribe solo la función edge enviar-estado-cuenta.';
create index if not exists estado_cuenta_envios_cliente on public.estado_cuenta_envios (cliente_id, creado_at desc);
create index if not exists estado_cuenta_envios_usuario on public.estado_cuenta_envios (enviado_por, creado_at desc);

alter table public.estado_cuenta_envios enable row level security;
revoke all on table public.estado_cuenta_envios from public, anon, authenticated;

-- Un enlace como lo ve el personal (el token solo si puede compartirlo y el enlace sigue activo)
create or replace function public.estado_cuenta_enlace_json(e public.estado_cuenta_enlaces, p_con_token boolean)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', e.id,
    'token', case when p_con_token and e.revocado_at is null and (e.vence_at is null or e.vence_at > now()) then e.token end,
    'activo', e.revocado_at is null and (e.vence_at is null or e.vence_at > now()),
    'creado_at', e.creado_at,
    'creado_por', (select nullif(btrim(concat_ws(' ', u.nombre, u.apellido)), '') from usuarios u where u.id = e.creado_por),
    'vence_at', e.vence_at,
    'revocado_at', e.revocado_at,
    'revocado_por', (select nullif(btrim(concat_ws(' ', u.nombre, u.apellido)), '') from usuarios u where u.id = e.revocado_por),
    'revocado_motivo', case when e.revocado_at is null and e.vence_at is not null and e.vence_at <= now() then 'vencido' else e.revocado_motivo end,
    'ultimo_acceso_at', e.ultimo_acceso_at,
    'accesos', e.accesos);
$$;

revoke all on function public.estado_cuenta_enlace_json(public.estado_cuenta_enlaces, boolean) from public, anon, authenticated;

-- Crea el enlace del cliente o reutiliza el activo. p_nuevo = true revoca el anterior y crea otro. p_vence: último día
-- en que funciona (hora de Caracas), hasta un año.
create or replace function public.crear_enlace_estado_cuenta(
  p_cliente_id uuid,
  p_nuevo boolean default false,
  p_vence date default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_emp uuid;
  v_yo uuid := public.usuario_actual_id();
  v_hoy date := (now() at time zone 'America/Caracas')::date;
  e public.estado_cuenta_enlaces;
begin
  v_emp := public.estado_cuenta_acceso(p_cliente_id, 'editar');
  if p_vence is not null and (p_vence < v_hoy or p_vence > v_hoy + 366) then
    raise exception 'El vencimiento debe ser una fecha entre hoy y un año' using errcode = '22023';
  end if;
  -- Dos pestañas a la vez no crean dos enlaces
  perform pg_advisory_xact_lock(hashtextextended('estado_cuenta_enlace|' || p_cliente_id::text || '|' || v_emp::text, 0));

  if not coalesce(p_nuevo, false) then
    select * into e from estado_cuenta_enlaces x
     where x.cliente_id = p_cliente_id and x.empresa_id = v_emp and x.revocado_at is null
       and (x.vence_at is null or x.vence_at > now())
     order by x.creado_at desc limit 1;
    if found then
      return public.estado_cuenta_enlace_json(e, true) || jsonb_build_object('reutilizado', true);
    end if;
  end if;

  update estado_cuenta_enlaces x
     set revocado_at = now(), revocado_por = v_yo,
         revocado_motivo = case when x.vence_at is not null and x.vence_at <= now() then 'vencido' else 'reemplazado' end
   where x.cliente_id = p_cliente_id and x.empresa_id = v_emp and x.revocado_at is null;

  insert into estado_cuenta_enlaces (cliente_id, empresa_id, token, creado_por, vence_at)
  values (p_cliente_id, v_emp,
          translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_'),
          v_yo,
          case when p_vence is not null then ((p_vence + 1)::timestamp at time zone 'America/Caracas') end)
  returning * into e;
  return public.estado_cuenta_enlace_json(e, true) || jsonb_build_object('reutilizado', false);
end $$;

revoke all on function public.crear_enlace_estado_cuenta(uuid, boolean, date) from public, anon;
grant execute on function public.crear_enlace_estado_cuenta(uuid, boolean, date) to authenticated;

create or replace function public.revocar_enlace_estado_cuenta(p_enlace_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  e public.estado_cuenta_enlaces;
  v_emp uuid;
begin
  select * into e from estado_cuenta_enlaces where id = p_enlace_id;
  if not found then
    raise exception 'Enlace no encontrado' using errcode = 'P0002';
  end if;
  v_emp := public.estado_cuenta_acceso(e.cliente_id, 'editar');
  if e.empresa_id <> v_emp then
    raise exception 'Este enlace es de otra empresa. Cámbiala en el menú superior.' using errcode = 'P0001';
  end if;
  update estado_cuenta_enlaces
     set revocado_at = now(), revocado_por = public.usuario_actual_id(), revocado_motivo = 'revocado'
   where id = e.id and revocado_at is null
  returning * into e;
  if not found then
    select * into e from estado_cuenta_enlaces where id = p_enlace_id;
  end if;
  return public.estado_cuenta_enlace_json(e, false);
end $$;

revoke all on function public.revocar_enlace_estado_cuenta(uuid) from public, anon;
grant execute on function public.revocar_enlace_estado_cuenta(uuid) to authenticated;

-- Enlaces del cliente (el activo primero y el historial). El token solo para quien puede compartirlo.
create or replace function public.enlaces_estado_cuenta(p_cliente_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_emp uuid;
  v_token boolean;
begin
  v_emp := public.estado_cuenta_acceso(p_cliente_id, 'ver');
  v_token := (public.es_personal_admin() and public.puede('cuentas', 'editar')) or public.es_vendedor_de(p_cliente_id);
  return coalesce((
    select jsonb_agg(public.estado_cuenta_enlace_json(e, v_token)
                     order by (e.revocado_at is null) desc, e.creado_at desc)
      from estado_cuenta_enlaces e
     where e.id in (select x.id from estado_cuenta_enlaces x
                     where x.cliente_id = p_cliente_id and x.empresa_id = v_emp
                     order by x.creado_at desc limit 20)), '[]'::jsonb);
end $$;

revoke all on function public.enlaces_estado_cuenta(uuid) from public, anon;
grant execute on function public.enlaces_estado_cuenta(uuid) to authenticated;

-- ── Página pública: el estado de cuenta de ESE cliente y empresa, sin sesión ──
-- p_contar = false para las recargas automáticas de la página (actualizan el último acceso, no suman accesos).
create or replace function public.estado_cuenta_publico(
  p_token text,
  p_desde date default null,
  p_hasta date default null,
  p_contar boolean default true
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
  -- Mismo mensaje para un token inventado, mal formado, revocado o vencido: no dice si existió
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

  v := public.estado_cuenta_datos(e.cliente_id, e.empresa_id, p_desde, p_hasta, true);

  -- Sin identificadores internos (ni del cliente, ni de la empresa, ni de los documentos)
  v := jsonb_set(v, '{cliente}', (v->'cliente') - 'id');
  v := jsonb_set(v, '{empresa}', (v->'empresa') - 'id');
  v := jsonb_set(v, '{credito}', coalesce((v->'credito') - 'utilizado' - 'en_pedidos', 'null'::jsonb));
  v := jsonb_set(v, '{movimientos}', coalesce((select jsonb_agg(m - 'factura_id' order by o)
                                                 from jsonb_array_elements(v->'movimientos') with ordinality t(m, o)), '[]'::jsonb));
  v := jsonb_set(v, '{abiertos}', coalesce((select jsonb_agg(m - 'factura_id' order by o)
                                              from jsonb_array_elements(v->'abiertos') with ordinality t(m, o)), '[]'::jsonb));

  select c.rif into v_rif from clientes c where c.id = e.cliente_id;
  return v || jsonb_build_object(
    'enlace', jsonb_build_object('creado_at', e.creado_at, 'vence_at', e.vence_at),
    'actualizado_at', now(),
    -- ¿El cliente tiene usuario en el portal? (para mostrar "Iniciar sesión")
    'tiene_cuenta', exists (
      select 1 from usuarios u join clientes c on c.id = u.cliente_id
       where u.role = 'cliente' and coalesce(u.activo, true)
         and (c.id = e.cliente_id or (v_rif is not null and public.normalizar_rif(c.rif) = public.normalizar_rif(v_rif)))));
end $$;

revoke all on function public.estado_cuenta_publico(text, date, date, boolean) from public;
grant execute on function public.estado_cuenta_publico(text, date, date, boolean) to anon, authenticated;

-- ── Correo: datos para la función edge (con el JWT del usuario: valida permiso) ──
-- Solo administración con 'cuentas' editar (el vendedor no envía correos desde la plataforma). p_asegurar_enlace crea o
-- reutiliza el enlace activo; sin él solo informa el activo (vista previa).
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
  v := public.estado_cuenta_datos(p_cliente_id, v_emp, null, null, false);
  return jsonb_build_object(
    'hoy', v->'hoy',
    'cliente', (v->'cliente') || jsonb_build_object('email', (select nullif(btrim(c.email), '') from clientes c where c.id = p_cliente_id)),
    'empresa', v->'empresa',
    'resumen', v->'resumen',
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

-- ── Correo: registro del envío (solo la llave de servicio, desde la función edge) ──
create or replace function public.registrar_envio_estado_cuenta(
  p_usuario_id uuid,
  p_cliente_id uuid,
  p_empresa_id uuid,
  p_enlace_id uuid,
  p_destinatarios text[],
  p_asunto text,
  p_mensaje text,
  p_adjunto_nombre text,
  p_adjunto_bytes integer
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_dest text[];
  v_id uuid;
begin
  select array_agg(distinct lower(btrim(d))) into v_dest
    from unnest(coalesce(p_destinatarios, '{}')) d where nullif(btrim(d), '') is not null;
  if v_dest is null or cardinality(v_dest) = 0 then
    raise exception 'Indica al menos un destinatario' using errcode = '22023';
  end if;
  if cardinality(v_dest) > 10 then
    raise exception 'Máximo 10 destinatarios por envío' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_dest) d where length(d) > 254 or d !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$') then
    raise exception 'Hay un correo con formato inválido' using errcode = '22023';
  end if;
  if nullif(btrim(p_asunto), '') is null or length(p_asunto) > 200 then
    raise exception 'El asunto es obligatorio (hasta 200 caracteres)' using errcode = '22023';
  end if;
  if length(coalesce(p_mensaje, '')) > 2000 then
    raise exception 'El mensaje admite hasta 2000 caracteres' using errcode = '22023';
  end if;
  -- Límite de envíos: 5 por minuto por usuario y 20 por hora por cliente
  perform pg_advisory_xact_lock(hashtextextended('estado_cuenta_envio|' || coalesce(p_usuario_id::text, ''), 0));
  if (select count(*) from estado_cuenta_envios where enviado_por = p_usuario_id and creado_at > now() - interval '1 minute') >= 5 then
    raise exception 'Demasiados envíos seguidos: espera un minuto e inténtalo de nuevo' using errcode = 'P0001';
  end if;
  if (select count(*) from estado_cuenta_envios where cliente_id = p_cliente_id and creado_at > now() - interval '1 hour') >= 20 then
    raise exception 'Este cliente ya recibió muchos envíos en la última hora' using errcode = 'P0001';
  end if;
  insert into estado_cuenta_envios (cliente_id, empresa_id, enlace_id, destinatarios, asunto, mensaje, adjunto_nombre, adjunto_bytes, enviado_por)
  values (p_cliente_id, p_empresa_id, p_enlace_id, v_dest, btrim(p_asunto), nullif(btrim(coalesce(p_mensaje, '')), ''), p_adjunto_nombre, p_adjunto_bytes, p_usuario_id)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.cerrar_envio_estado_cuenta(p_envio_id uuid, p_resend_id text, p_error text)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update estado_cuenta_envios
     set estado = case when p_resend_id is not null and p_error is null then 'enviado' else 'fallido' end,
         resend_id = p_resend_id,
         error = left(p_error, 500),
         enviado_at = case when p_resend_id is not null and p_error is null then now() end
   where id = p_envio_id and estado = 'enviando';
$$;

revoke all on function public.registrar_envio_estado_cuenta(uuid, uuid, uuid, uuid, text[], text, text, text, integer) from public, anon, authenticated;
revoke all on function public.cerrar_envio_estado_cuenta(uuid, text, text) from public, anon, authenticated;
grant execute on function public.registrar_envio_estado_cuenta(uuid, uuid, uuid, uuid, text[], text, text, text, integer) to service_role;
grant execute on function public.cerrar_envio_estado_cuenta(uuid, text, text) to service_role;

-- Historial de envíos del cliente (CuentaDetalle)
create or replace function public.envios_estado_cuenta(p_cliente_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_emp uuid;
begin
  v_emp := public.estado_cuenta_acceso(p_cliente_id, 'ver', false);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id, 'creado_at', s.creado_at, 'enviado_at', s.enviado_at, 'estado', s.estado,
             'destinatarios', to_jsonb(s.destinatarios), 'asunto', s.asunto, 'resend_id', s.resend_id, 'error', s.error,
             'adjunto_bytes', s.adjunto_bytes,
             'enviado_por', (select nullif(btrim(concat_ws(' ', u.nombre, u.apellido)), '') from usuarios u where u.id = s.enviado_por))
           order by s.creado_at desc)
      from (select * from estado_cuenta_envios x
             where x.cliente_id = p_cliente_id and x.empresa_id = v_emp
             order by x.creado_at desc limit 50) s), '[]'::jsonb);
end $$;

revoke all on function public.envios_estado_cuenta(uuid) from public, anon;
grant execute on function public.envios_estado_cuenta(uuid) to authenticated;

commit;
