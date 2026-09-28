-- ════════════════════════════════════════════════════════════════════════
-- Fase 20o · Portal del vendedor V4: cobro con evidencia y propuesta de aplicación a facturas (plan del vendedor 3.6)
--   Decisiones del dueño (28-sep): el vendedor puede recibir efectivo con comprobante; propone a qué facturas se aplica el
--   cobro y administración confirma; la tasa es la BCV de la fecha del pago.
--   · pagos: fecha_pago, registrado_por, lote_cobro/lote_linea (las líneas de un mismo cobro y su idempotencia),
--     propuesta_aplicacion (jsonb [{factura_id, numero, monto}]) y propuesta_estado (pendiente/aplicada/corregida).
--   · Bucket privado comprobantes-cobro, ruta <usuario vendedor>/<cliente>/<archivo>: el vendedor sube solo a su carpeta y
--     para clientes de su cartera; administración lee todo; el vendedor lee lo suyo; el cliente lee lo de sus fichas.
--     El vendedor puede borrar un archivo suyo mientras ningún pago lo use (limpieza si el envío falla).
--   · tasa_bcv_de(fecha): tasa BCV vigente en una fecha (la última publicada hasta ese día).
--   · registrar_cobro_vendedor(cliente, líneas, propuesta, lote): varias líneas (Bs/USD, cuenta o efectivo), cada una con
--     fecha, referencia (salvo efectivo) y comprobante que debe existir en el bucket; convierte Bs con la tasa BCV de la
--     fecha del pago (la calcula el servidor); valida que las cuentas sean de la empresa del cliente y publicadas, que la
--     referencia no esté ya registrada y que la propuesta sea solo sobre facturas abiertas de ESE cliente sin exceder su
--     saldo ni el total; reparte la propuesta entre las líneas. Idempotente por lote. Todo queda pendiente.
--   · verificar_cobro_propuesta(pago, asignaciones?, banco?, notas?): administración (personal admin con permiso de editar
--     cuentas) verifica el pago aplicando la propuesta tal cual o corregida; reutiliza verificar_pago, que aplica con la
--     función interna aplicar_pago_a_facturas.
--   · Aviso al vendedor cuando administración rechaza un cobro de su cliente (antes solo se avisaba al cliente), y el aviso
--     "Pago por verificar" de un cobro del vendedor lleva a /admin/pagos, donde se ve la foto y la propuesta.
-- ════════════════════════════════════════════════════════════════════════
begin;

-- 1. Columnas del pago ----------------------------------------------------------------------------------------------------
alter table public.pagos
  add column if not exists fecha_pago date,
  add column if not exists registrado_por uuid references public.usuarios(id),
  add column if not exists lote_cobro uuid,
  add column if not exists lote_linea smallint,
  add column if not exists propuesta_aplicacion jsonb,
  add column if not exists propuesta_estado text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pagos_propuesta_estado_check') then
    alter table public.pagos add constraint pagos_propuesta_estado_check
      check (propuesta_estado is null or propuesta_estado in ('pendiente', 'aplicada', 'corregida'));
  end if;
end $$;
create unique index if not exists pagos_lote_cobro_linea_key on public.pagos (lote_cobro, lote_linea) where lote_cobro is not null;
comment on column public.pagos.fecha_pago is 'Fecha en que el cliente pagó (la tasa BCV de un pago en Bs es la de esta fecha)';
comment on column public.pagos.registrado_por is 'Usuario que registró el cobro (vendedor)';
comment on column public.pagos.lote_cobro is 'Cobro del vendedor con varias líneas: mismo lote; también es la clave de idempotencia';
comment on column public.pagos.propuesta_aplicacion is 'Facturas a las que el vendedor propone aplicar este pago [{factura_id, numero, monto}]';
comment on column public.pagos.propuesta_estado is 'pendiente → aplicada (tal cual) o corregida (administración cambió la aplicación)';

-- 2. Bucket privado de comprobantes de cobro ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comprobantes-cobro', 'comprobantes-cobro', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Ruta válida para subir: <mi usuario>/<cliente de mi cartera>/<archivo>
create or replace function public.ruta_comprobante_cobro_ok(p_nombre text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_partes text[] := string_to_array(coalesce(p_nombre, ''), '/');
begin
  if auth.uid() is null or array_length(v_partes, 1) is distinct from 3 then return false; end if;
  if v_partes[1] is distinct from public.usuario_actual_id()::text then return false; end if;
  if v_partes[2] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  if v_partes[3] !~ '^[A-Za-z0-9._-]{1,120}$' then return false; end if;
  return public.es_vendedor_de(v_partes[2]::uuid);
end $$;

-- El cliente (usuario del portal) lee los comprobantes de sus fichas
create or replace function public.comprobante_cobro_de_mis_clientes(p_nombre text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_cli text := split_part(coalesce(p_nombre, ''), '/', 2);
begin
  if auth.uid() is null or v_cli !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  return v_cli::uuid = any (public.clientes_del_usuario());
end $$;

-- Un comprobante ya ligado a un pago no se borra
create or replace function public.comprobante_cobro_en_uso(p_nombre text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is null or exists (select 1 from pagos p where p.comprobante_url = 'comprobantes-cobro/' || p_nombre);
$$;

revoke execute on function public.ruta_comprobante_cobro_ok(text) from public, anon;
revoke execute on function public.comprobante_cobro_de_mis_clientes(text) from public, anon;
revoke execute on function public.comprobante_cobro_en_uso(text) from public, anon;
-- Se evalúan en las políticas de storage con el rol de quien pide (authenticated)
grant execute on function public.ruta_comprobante_cobro_ok(text) to authenticated;
grant execute on function public.comprobante_cobro_de_mis_clientes(text) to authenticated;
grant execute on function public.comprobante_cobro_en_uso(text) to authenticated;

drop policy if exists cobros_subir on storage.objects;
drop policy if exists cobros_leer on storage.objects;
drop policy if exists cobros_borrar on storage.objects;
create policy cobros_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'comprobantes-cobro' and public.ruta_comprobante_cobro_ok(name));
create policy cobros_leer on storage.objects for select to authenticated
  using (bucket_id = 'comprobantes-cobro' and (
    (select public.es_personal_admin())
    or (storage.foldername(name))[1] = (select public.usuario_actual_id())::text
    or public.comprobante_cobro_de_mis_clientes(name)));
create policy cobros_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'comprobantes-cobro'
    and (storage.foldername(name))[1] = (select public.usuario_actual_id())::text
    and not public.comprobante_cobro_en_uso(name));

-- 3. Tasa BCV de una fecha --------------------------------------------------------------------------------------------------
create or replace function public.tasa_bcv_de(p_fecha date)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select t.tasa from tasa_bcv t where t.fecha <= p_fecha and t.tasa > 0 order by t.fecha desc, t.created_at desc limit 1;
$$;
revoke execute on function public.tasa_bcv_de(date) from public, anon;
grant execute on function public.tasa_bcv_de(date) to authenticated;

-- 4. Registrar un cobro del vendedor -----------------------------------------------------------------------------------------
-- p_lineas: [{banco_id|null, metodo, moneda, monto, referencia, fecha_pago, comprobante}]  (monto en la moneda de la línea;
--           comprobante = ruta en el bucket comprobantes-cobro). p_propuesta: [{factura_id, monto}] en USD, en el orden en
--           que se aplica (el portal sugiere FIFO por vencimiento). p_lote: clave del cobro (idempotencia).
create or replace function public.registrar_cobro_vendedor(
  p_cliente_id uuid, p_lineas jsonb, p_propuesta jsonb default '[]'::jsonb, p_lote uuid default null, p_notas text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario uuid := public.usuario_actual_id();
  v_hoy date := (now() at time zone 'America/Caracas')::date;
  v_cli clientes%rowtype;
  v_empresa uuid;
  l jsonb;
  v_i int := 0;
  v_banco bancos%rowtype;
  v_metodo text; v_moneda text; v_monto numeric; v_ref text; v_ref_norm text; v_fecha date; v_comp text; v_tasa numeric; v_usd numeric;
  v_prev text;
  v_lineas jsonb := '[]'::jsonb;           -- líneas validadas (con monto en USD)
  v_total numeric := 0;
  v_prop jsonb := '[]'::jsonb;              -- propuesta validada [{factura_id, numero, monto}]
  v_propuesto numeric := 0;
  f record;
  v_rest_linea numeric; v_rest jsonb; v_asig jsonb; v_toma numeric; k int;
  v_id uuid;
  v_pagos jsonb := '[]'::jsonb;
begin
  if v_usuario is null then raise exception 'No autenticado' using errcode = '42501'; end if;
  if p_cliente_id is null or not public.es_vendedor_de(p_cliente_id) then
    raise exception 'Este cliente no está en tu cartera' using errcode = '42501';
  end if;
  if p_lote is null then raise exception 'Falta la clave del cobro' using errcode = '22023'; end if;

  -- Idempotencia: el mismo lote (doble toque, reintento) devuelve lo ya registrado
  perform pg_advisory_xact_lock(hashtextextended('cobro_vendedor:' || p_lote::text, 0));
  if exists (select 1 from pagos where lote_cobro = p_lote) then
    if exists (select 1 from pagos where lote_cobro = p_lote and (registrado_por is distinct from v_usuario or cliente_id <> p_cliente_id)) then
      raise exception 'Clave de cobro ya usada' using errcode = 'P0001';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'numero', numero, 'monto', monto, 'moneda', moneda, 'monto_moneda', monto_moneda)
             order by lote_linea), '[]'::jsonb), coalesce(sum(monto), 0)
      into v_pagos, v_total from pagos where lote_cobro = p_lote;
    return jsonb_build_object('lote', p_lote, 'repetido', true, 'pagos', v_pagos, 'total_usd', round(v_total, 2));
  end if;

  select * into v_cli from clientes where id = p_cliente_id;
  v_empresa := coalesce(v_cli.empresa_id, public.empresa_activa_requerida());

  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'Agrega al menos una línea de pago' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lineas) > 10 then raise exception 'Máximo 10 líneas por cobro' using errcode = '22023'; end if;

  -- Líneas
  for l in select * from jsonb_array_elements(p_lineas) loop
    v_i := v_i + 1;
    v_metodo := lower(btrim(coalesce(l->>'metodo', '')));
    v_moneda := upper(btrim(coalesce(l->>'moneda', '')));
    v_monto := round(nullif(l->>'monto', '')::numeric, 2);
    v_ref := nullif(btrim(coalesce(l->>'referencia', '')), '');
    v_fecha := nullif(l->>'fecha_pago', '')::date;
    v_comp := nullif(btrim(coalesce(l->>'comprobante', '')), '');

    if v_metodo not in ('transferencia', 'pago_movil', 'zelle', 'efectivo') then
      raise exception 'Línea %: método no válido', v_i using errcode = '22023';
    end if;
    if v_monto is null or v_monto <= 0 or v_monto > 1e9 then raise exception 'Línea %: monto inválido', v_i using errcode = '22023'; end if;
    if v_fecha is null then raise exception 'Línea %: falta la fecha del pago', v_i using errcode = '22023'; end if;
    if v_fecha > v_hoy then raise exception 'Línea %: la fecha del pago no puede ser futura', v_i using errcode = '22023'; end if;
    if v_fecha < v_hoy - 90 then raise exception 'Línea %: la fecha del pago tiene más de 90 días', v_i using errcode = '22023'; end if;

    if v_metodo = 'efectivo' then
      if nullif(l->>'banco_id', '') is not null then raise exception 'Línea %: el efectivo no va a una cuenta', v_i using errcode = '22023'; end if;
      if v_moneda not in ('USD', 'BS') then raise exception 'Línea %: moneda no válida', v_i using errcode = '22023'; end if;
      v_banco := null;
    else
      select * into v_banco from bancos b where b.id = nullif(l->>'banco_id', '')::uuid;
      if not found or not coalesce(v_banco.activo, false) or not coalesce(v_banco.visible_portal, false) then
        raise exception 'Línea %: la cuenta indicada no recibe pagos de clientes', v_i using errcode = 'P0001';
      end if;
      if v_banco.empresa_id is not null and v_banco.empresa_id <> v_empresa then
        raise exception 'Línea %: la cuenta indicada es de otra empresa', v_i using errcode = 'P0001';
      end if;
      if (v_metodo = 'pago_movil' and v_banco.pago_movil_telefono is null) or (v_metodo = 'zelle' and v_banco.zelle_correo is null) then
        raise exception 'Línea %: esa cuenta no recibe %', v_i, replace(v_metodo, '_', ' ') using errcode = 'P0001';
      end if;
      v_moneda := case when upper(coalesce(v_banco.moneda, 'USD')) = 'BS' then 'BS' else 'USD' end;
      if v_ref is null or length(v_ref) < 4 then
        raise exception 'Línea %: falta la referencia de la operación (mínimo 4 caracteres)', v_i using errcode = '22023';
      end if;
      -- Referencia ya registrada en la misma cuenta (no rechazada, últimos 180 días), o repetida en este cobro
      v_ref_norm := upper(regexp_replace(v_ref, '\s', '', 'g'));
      select p.numero into v_prev from pagos p
       where p.banco_id = v_banco.id and upper(regexp_replace(coalesce(p.referencia, ''), '\s', '', 'g')) = v_ref_norm
         and p.estado <> 'rechazado' and p.created_at > now() - interval '180 days'
       limit 1;
      if v_prev is not null then
        raise exception 'Línea %: la referencia % ya está registrada en esa cuenta (cobro %)', v_i, v_ref, v_prev using errcode = 'P0001';
      end if;
      if exists (select 1 from jsonb_array_elements(v_lineas) x where x->>'banco_id' = v_banco.id::text and x->>'ref_norm' = v_ref_norm) then
        raise exception 'Línea %: referencia repetida en este cobro', v_i using errcode = 'P0001';
      end if;
    end if;

    -- Comprobante obligatorio (también en efectivo): debe estar subido en la carpeta del vendedor para este cliente
    if v_comp is null then raise exception 'Línea %: falta el comprobante', v_i using errcode = '22023'; end if;
    if split_part(v_comp, '/', 1) <> v_usuario::text or split_part(v_comp, '/', 2) <> p_cliente_id::text
       or not exists (select 1 from storage.objects o where o.bucket_id = 'comprobantes-cobro' and o.name = v_comp) then
      raise exception 'Línea %: el comprobante no se encontró; vuelve a adjuntarlo', v_i using errcode = 'P0001';
    end if;
    -- La misma evidencia no respalda dos cobros distintos (dentro de un mismo cobro sí puede repetirse)
    select p.numero into v_prev from pagos p where p.comprobante_url = 'comprobantes-cobro/' || v_comp limit 1;
    if v_prev is not null then
      raise exception 'Línea %: ese comprobante ya se usó en el cobro %', v_i, v_prev using errcode = 'P0001';
    end if;

    if v_moneda = 'BS' then
      v_tasa := public.tasa_bcv_de(v_fecha);
      if coalesce(v_tasa, 0) <= 0 then
        raise exception 'Línea %: no hay tasa BCV registrada para el %', v_i, to_char(v_fecha, 'DD/MM/YYYY') using errcode = 'P0001';
      end if;
      v_usd := round(v_monto / v_tasa, 2);
    else
      v_tasa := null;
      v_usd := v_monto;
    end if;
    if v_usd <= 0 then raise exception 'Línea %: el monto es demasiado pequeño', v_i using errcode = '22023'; end if;

    v_total := v_total + v_usd;
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object(
      'banco_id', v_banco.id, 'metodo', v_metodo, 'moneda', v_moneda, 'monto', v_monto, 'usd', v_usd, 'tasa', v_tasa,
      'referencia', v_ref, 'ref_norm', v_ref_norm, 'fecha', v_fecha, 'comprobante', v_comp));
    v_ref_norm := null;
  end loop;

  -- Propuesta de aplicación: solo facturas abiertas de ESTE cliente, sin exceder su saldo ni el total del cobro
  for f in
    select x.factura_id, round(sum(x.monto), 2) monto, min(x.orden) orden
      from (select (e->>'factura_id')::uuid factura_id, (e->>'monto')::numeric monto, n orden
              from jsonb_array_elements(coalesce(p_propuesta, '[]'::jsonb)) with ordinality t(e, n)) x
     where x.monto > 0
     group by x.factura_id
     order by min(x.orden)
  loop
    declare fa facturas%rowtype;
    begin
      select * into fa from facturas where id = f.factura_id;
      if not found or fa.cliente_id is distinct from p_cliente_id then
        raise exception 'La propuesta incluye una factura que no es de este cliente' using errcode = 'P0001';
      end if;
      if fa.estado <> 'posted' or fa.tipo <> 'factura' or coalesce(fa.estado_pago, '') = 'anulado' or coalesce(fa.saldo_usd, 0) <= 0.009 then
        raise exception 'La factura % no tiene saldo por cobrar', fa.numero using errcode = 'P0001';
      end if;
      if f.monto > fa.saldo_usd + 0.01 then
        raise exception 'La factura % solo tiene saldo $%', fa.numero, fa.saldo_usd using errcode = 'P0001';
      end if;
      v_prop := v_prop || jsonb_build_array(jsonb_build_object('factura_id', fa.id, 'numero', fa.numero, 'monto', f.monto));
      v_propuesto := v_propuesto + f.monto;
    end;
  end loop;
  if v_propuesto > v_total + 0.01 then
    raise exception 'La propuesta ($%) excede el total del cobro ($%)', round(v_propuesto, 2), round(v_total, 2) using errcode = 'P0001';
  end if;

  -- Reparto de la propuesta entre las líneas (en orden) y registro de los pagos pendientes
  v_rest := v_prop;
  for k in 0 .. jsonb_array_length(v_lineas) - 1 loop
    l := v_lineas -> k;
    v_rest_linea := (l->>'usd')::numeric;
    v_asig := '[]'::jsonb;
    for v_i in 0 .. jsonb_array_length(v_rest) - 1 loop
      exit when v_rest_linea <= 0.004;
      v_toma := least(v_rest_linea, (v_rest -> v_i ->> 'monto')::numeric);
      if v_toma > 0.004 then
        v_asig := v_asig || jsonb_build_array(jsonb_build_object(
          'factura_id', v_rest -> v_i ->> 'factura_id', 'numero', v_rest -> v_i ->> 'numero', 'monto', round(v_toma, 2)));
        v_rest := jsonb_set(v_rest, array[v_i::text, 'monto'], to_jsonb(round((v_rest -> v_i ->> 'monto')::numeric - v_toma, 2)));
        v_rest_linea := v_rest_linea - v_toma;
      end if;
    end loop;

    insert into pagos (cliente_id, orden_id, banco_id, metodo, monto, monto_moneda, moneda, tasa_cambio, referencia, comprobante_url,
                       estado, notas, empresa_id, fecha_pago, registrado_por, lote_cobro, lote_linea, propuesta_aplicacion, propuesta_estado)
    values (p_cliente_id, null, nullif(l->>'banco_id', '')::uuid, (l->>'metodo')::pago_metodo, (l->>'usd')::numeric, (l->>'monto')::numeric,
            l->>'moneda', nullif(l->>'tasa', '')::numeric, l->>'referencia', 'comprobantes-cobro/' || (l->>'comprobante'),
            'pendiente', nullif(btrim(coalesce(p_notas, '')), ''), v_empresa, (l->>'fecha')::date, v_usuario, p_lote, k + 1,
            case when jsonb_array_length(v_asig) > 0 then v_asig end, case when jsonb_array_length(v_asig) > 0 then 'pendiente' end)
    returning id into v_id;
    v_pagos := v_pagos || jsonb_build_array((select jsonb_build_object('id', p.id, 'numero', p.numero, 'monto', p.monto,
                 'moneda', p.moneda, 'monto_moneda', p.monto_moneda) from pagos p where p.id = v_id));
  end loop;

  return jsonb_build_object('lote', p_lote, 'repetido', false, 'pagos', v_pagos, 'total_usd', round(v_total, 2),
    'propuesto', round(v_propuesto, 2), 'a_favor', round(greatest(v_total - v_propuesto, 0), 2));
end $$;
revoke execute on function public.registrar_cobro_vendedor(uuid, jsonb, jsonb, uuid, text) from public, anon;
grant execute on function public.registrar_cobro_vendedor(uuid, jsonb, jsonb, uuid, text) to authenticated;

-- 5. Verificar un cobro aplicando la propuesta (tal cual o corregida) ---------------------------------------------------------
create or replace function public.verificar_cobro_propuesta(
  p_pago_id uuid, p_asignaciones jsonb default null, p_banco_id uuid default null, p_notas text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p pagos%rowtype;
  v_asig jsonb;
  v_prop_norm jsonb;
  v_asig_norm jsonb;
  v_estado text;
  v_r jsonb;
begin
  if not (public.es_personal_admin() and public.puede('cuentas', 'editar')) then
    raise exception 'No tienes permiso para verificar cobros' using errcode = '42501';
  end if;
  select * into p from pagos where id = p_pago_id;
  if not found then raise exception 'Pago no encontrado' using errcode = 'P0001'; end if;
  if p.estado <> 'pendiente' then raise exception 'El pago ya fue %', p.estado using errcode = 'P0001'; end if;
  if p_asignaciones is not null and jsonb_typeof(p_asignaciones) <> 'array' then
    raise exception 'Asignaciones inválidas' using errcode = '22023';
  end if;

  v_asig := coalesce(p_asignaciones, p.propuesta_aplicacion, '[]'::jsonb);
  -- ¿Se aplicó tal cual o se corrigió? (se compara por factura y monto, sin importar el orden)
  select coalesce(jsonb_agg(jsonb_build_object('f', x->>'factura_id', 'm', round((x->>'monto')::numeric, 2)) order by x->>'factura_id'), '[]'::jsonb)
    into v_prop_norm from jsonb_array_elements(coalesce(p.propuesta_aplicacion, '[]'::jsonb)) x where (x->>'monto')::numeric > 0;
  select coalesce(jsonb_agg(jsonb_build_object('f', x->>'factura_id', 'm', round((x->>'monto')::numeric, 2)) order by x->>'factura_id'), '[]'::jsonb)
    into v_asig_norm from jsonb_array_elements(v_asig) x where (x->>'monto')::numeric > 0;
  v_estado := case when p.propuesta_aplicacion is null then null
                   when v_prop_norm = v_asig_norm then 'aplicada' else 'corregida' end;

  -- verificar_pago registra el movimiento bancario, aplica con aplicar_pago_a_facturas (valida cliente, saldo y tipo de
  -- cada factura) y recalcula el crédito del cliente
  v_r := public.verificar_pago(p_pago_id, true, p_notas, p_banco_id, null,
           (select coalesce(jsonb_agg(jsonb_build_object('factura_id', x->>'factura_id', 'monto', (x->>'monto')::numeric)), '[]'::jsonb)
              from jsonb_array_elements(v_asig) x));
  if v_estado is not null then
    update pagos set propuesta_estado = v_estado where id = p_pago_id;
  end if;
  return coalesce(v_r, '{}'::jsonb) || jsonb_build_object('propuesta_estado', v_estado);
end $$;
revoke execute on function public.verificar_cobro_propuesta(uuid, jsonb, uuid, text) from public, anon;
grant execute on function public.verificar_cobro_propuesta(uuid, jsonb, uuid, text) to authenticated;

-- 6. Aviso al vendedor cuando se rechaza un cobro de su cliente ------------------------------------------------------------
create or replace function public.trg_pago_estado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_cli text;
begin
  if NEW.estado is not distinct from OLD.estado then return NEW; end if;
  select nombre_negocio into v_cli from clientes where id=NEW.cliente_id;
  if NEW.estado::text='verificado' then
    perform notif_cliente(NEW.cliente_id, 'Pago verificado', 'Tu pago '||coalesce(NEW.numero,'')||' de '||fmt_usd(NEW.monto)||' fue verificado.', 'exito', '/portal/pagos');
    perform notif_vendedor(NEW.cliente_id, 'Pago verificado', coalesce(v_cli,'Cliente')||': '||fmt_usd(NEW.monto), 'exito', '/vendedor/pagos');
  elsif NEW.estado::text='rechazado' then
    perform notif_cliente(NEW.cliente_id, 'Pago rechazado', 'Tu pago '||coalesce(NEW.numero,'')||' de '||fmt_usd(NEW.monto)||' fue rechazado.', 'alerta', '/portal/pagos');
    perform notif_vendedor(NEW.cliente_id, 'Cobro rechazado',
      coalesce(v_cli,'Cliente')||': '||coalesce(NEW.numero,'')||' de '||fmt_usd(NEW.monto)||coalesce(' · '||nullif(btrim(NEW.notas),''),''),
      'alerta', '/vendedor/pagos');
  end if;
  return NEW;
end; $$;
-- Función de trigger: no se ejecuta por la API
revoke execute on function public.trg_pago_estado() from public, anon, authenticated;

-- Aviso "Pago por verificar": el cobro reportado por un vendedor se verifica en Pagos (foto y propuesta)
create or replace function public.trg_pago_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_cli text;
begin
  select nombre_negocio into v_cli from clientes where id=NEW.cliente_id;
  if NEW.estado::text='pendiente' then
    if NEW.registrado_por is not null then
      perform notif_admins('Cobro por verificar', coalesce(v_cli,'Cliente')||': el vendedor reportó '||fmt_usd(NEW.monto)
        ||case when NEW.propuesta_aplicacion is not null then ' con propuesta de aplicación' else '' end, 'alerta', '/admin/pagos');
    else
      perform notif_admins('Pago por verificar', coalesce(v_cli,'Cliente')||' reportó '||fmt_usd(NEW.monto), 'alerta', '/admin/cuentas-por-cobrar');
    end if;
  elsif NEW.estado::text='verificado' then
    perform notif_cliente(NEW.cliente_id, 'Pago verificado', 'Tu pago '||coalesce(NEW.numero,'')||' de '||fmt_usd(NEW.monto)||' fue verificado.', 'exito', '/portal/pagos');
    perform notif_vendedor(NEW.cliente_id, 'Pago verificado', coalesce(v_cli,'Cliente')||': '||fmt_usd(NEW.monto), 'exito', '/vendedor/pagos');
  end if;
  return NEW;
end; $$;
revoke execute on function public.trg_pago_insert() from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
