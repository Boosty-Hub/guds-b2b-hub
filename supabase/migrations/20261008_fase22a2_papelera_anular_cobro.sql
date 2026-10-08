-- ════════════════════════════════════════════════════════════════════════
-- Fase 22a2 · Papelera general + anular cobros (decisiones del usuario del 8-oct).
--   "Todo lo anulado o archivado debe ir a papelera": tabla `papelera` genérica con la foto completa (jsonb) de lo que se
--   anuló o archivó, quién, cuándo y por qué, y si se puede restaurar.
--
--   · papelera_guardar(...)            interna: la llaman las funciones que anulan/archivan (no se expone a la API).
--   · restaurar_papelera(p_id)         RPC: valida permiso y empresa y delega en papelera_restaurar_<tipo>(papelera).
--                                      Un tipo sin esa función no se restaura (p. ej. 'cuenta_manual').
--   · anular_cobro(p_pago_id, p_motivo) RPC: solo cobros registrados en GUDS (odoo_id null) y verificados. Quita sus
--                                      aplicaciones a facturas (trg_pf_recalc devuelve el saldo), sus movimientos bancarios y
--                                      el IGTF que nació de él; el cobro queda 'anulado' y la foto va a la papelera.
--   · papelera_restaurar_cobro         vuelve a 'verificado' y reaplica a las mismas facturas si aún tienen saldo.
--
--   Cómo se agrega un tipo nuevo: (1) la función que anula/archiva arma la foto y llama a papelera_guardar con su tipo;
--   (2) si se puede restaurar, se crea public.papelera_restaurar_<tipo>(p papelera) (sin grant a authenticated);
--   (3) en el frontend se agrega el tipo a src/components/papelera/tipos.tsx (etiqueta, ícono y detalle).
--
--   Permisos: módulo 'papelera' (ver = ver la papelera; editar = anular cobros y restaurar). Solo Administrador.
--   anular_cobro exige además personal admin + cuentas/editar. Nada para anon.
--   Lo que contaba "todo menos rechazado" ahora excluye también los anulados (cartera_vendedor: último cobro;
--   registrar_cobro_vendedor: referencia repetida).
-- ════════════════════════════════════════════════════════════════════════
begin;

-- ── 1. Módulo y permisos ─────────────────────────────────────────────────
insert into public.modulos (codigo, nombre, descripcion, icono, orden, activo) values
  ('papelera', 'Papelera', 'Lo anulado o archivado (cobros, cuentas manuales…). Editar = anular cobros y restaurar', 'Trash2', 22, true)
on conflict (codigo) do nothing;
insert into public.permisos (rol_id, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar)
select r.id, m.id, true, true, true, true from public.roles r, public.modulos m
where r.nombre = 'Administrador' and m.codigo = 'papelera'
on conflict (rol_id, modulo_id) do nothing;

-- ── 2. Tabla papelera ────────────────────────────────────────────────────
create table if not exists public.papelera (
  id uuid primary key default gen_random_uuid(),
  tipo text not null,
  accion text not null default 'anulado',
  registro_id uuid,
  numero text,
  empresa_id uuid references public.empresas(id),
  cliente_id uuid references public.clientes(id) on delete set null,
  monto_usd numeric,
  titulo text not null,
  resumen text,
  datos jsonb not null default '{}'::jsonb,
  motivo text,
  restaurable boolean not null default true,
  eliminado_por uuid references public.usuarios(id) on delete set null,
  eliminado_por_nombre text,
  eliminado_at timestamptz not null default now(),
  restaurado_por uuid references public.usuarios(id) on delete set null,
  restaurado_por_nombre text,
  restaurado_at timestamptz,
  constraint papelera_accion_check check (accion in ('anulado', 'archivado')),
  constraint papelera_tipo_check check (tipo ~ '^[a-z][a-z0-9_]*$')
);
comment on table public.papelera is 'Papelera general (22a): foto de lo anulado o archivado. Se escribe solo por funciones (papelera_guardar / restaurar_papelera)';
comment on column public.papelera.tipo is 'cobro · cuenta_manual · … (la restauración la hace public.papelera_restaurar_<tipo>, si existe)';
comment on column public.papelera.registro_id is 'id del registro original (pagos.id, cuentas_cobrar.id…)';
comment on column public.papelera.datos is 'Foto completa del registro y lo que dependía de él (p. ej. aplicaciones a facturas y movimientos bancarios de un cobro)';
comment on column public.papelera.eliminado_por is 'Quién lo anuló o archivó (null = el sistema, p. ej. una migración)';
create index if not exists papelera_empresa_idx on public.papelera (empresa_id, eliminado_at desc);
create index if not exists papelera_tipo_idx on public.papelera (tipo, eliminado_at desc);
create index if not exists papelera_registro_idx on public.papelera (registro_id);

alter table public.papelera enable row level security;
revoke all on public.papelera from public, anon, authenticated;
grant select on public.papelera to authenticated;
drop policy if exists empresa_visible on public.papelera;
create policy empresa_visible on public.papelera as restrictive for all to authenticated
  using (empresa_id is null or empresa_id = any ((select public.empresas_visibles())::uuid[]));
drop policy if exists papelera_ver on public.papelera;
create policy papelera_ver on public.papelera for select to authenticated
  using ((select public.puede('papelera', 'ver')));

-- ── 3. Guardar en la papelera (interna) ──────────────────────────────────
create or replace function public.papelera_guardar(
  p_tipo text, p_accion text, p_registro_id uuid, p_numero text, p_empresa_id uuid, p_cliente_id uuid, p_monto_usd numeric,
  p_titulo text, p_resumen text, p_datos jsonb, p_motivo text, p_restaurable boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_usuario uuid; v_nombre text;
begin
  select u.id, coalesce(nullif(trim(concat_ws(' ', u.nombre, u.apellido)), ''), u.email)
    into v_usuario, v_nombre
    from usuarios u where u.auth_id = auth.uid();
  insert into papelera (tipo, accion, registro_id, numero, empresa_id, cliente_id, monto_usd, titulo, resumen, datos, motivo,
                        restaurable, eliminado_por, eliminado_por_nombre)
  values (p_tipo, coalesce(p_accion, 'anulado'), p_registro_id, p_numero, p_empresa_id, p_cliente_id, p_monto_usd, p_titulo, p_resumen,
          coalesce(p_datos, '{}'::jsonb), nullif(btrim(coalesce(p_motivo, '')), ''), coalesce(p_restaurable, true), v_usuario, v_nombre)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.papelera_guardar(text, text, uuid, text, uuid, uuid, numeric, text, text, jsonb, text, boolean) from public, anon, authenticated;

-- ── 4. Cobros: columnas de anulación y guardia ───────────────────────────
alter table public.pagos add column if not exists anulado_at timestamptz;
alter table public.pagos add column if not exists anulado_por uuid references public.usuarios(id) on delete set null;
alter table public.pagos add column if not exists motivo_anulacion text;
comment on column public.pagos.motivo_anulacion is 'Motivo de la anulación (22a). La foto completa queda en la papelera';

-- Un cobro solo entra o sale de 'anulado' por anular_cobro / restaurar_papelera (que guardan la foto en la papelera)
create or replace function public.trg_pago_anulado_guardia()
returns trigger language plpgsql set search_path = public as $$
declare v_rol text;
begin
  v_rol := coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '');
  if v_rol not in ('authenticated', 'anon') then return new; end if;
  if coalesce(current_setting('guds.papelera', true), '') = 'on' then return new; end if;
  if (coalesce(old.estado::text, '') = 'anulado') <> (coalesce(new.estado::text, '') = 'anulado') then
    raise exception 'Un cobro se anula con el botón «Anular» y se recupera desde la Papelera.' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists b_pago_anulado_guardia on public.pagos;
create trigger b_pago_anulado_guardia before update of estado on public.pagos
  for each row execute function public.trg_pago_anulado_guardia();

-- Avisos de cambio de estado: anular y restaurar no avisan al cliente ni al vendedor ("Pago verificado" otra vez)
create or replace function public.trg_pago_estado()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_cli text;
begin
  if NEW.estado is not distinct from OLD.estado then return NEW; end if;
  if NEW.estado::text = 'anulado' or OLD.estado::text = 'anulado' then return NEW; end if;
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

-- ── 5. Anular un cobro ───────────────────────────────────────────────────
create or replace function public.anular_cobro(p_pago_id uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_pago pagos%rowtype;
  v_ids uuid[];
  v_activa uuid;
  v_foto jsonb;
  v_n_fact int;
  v_cliente text;
  v_banco text;
  v_papelera uuid;
begin
  if auth.uid() is null or not (public.es_personal_admin() and public.puede('cuentas', 'editar') and public.puede('papelera', 'editar')) then
    raise exception 'Solo un administrador puede anular cobros' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'Indica el motivo de la anulación (al menos 5 caracteres)' using errcode = 'P0001';
  end if;

  select * into v_pago from pagos where id = p_pago_id for update;
  if not found then raise exception 'Cobro no encontrado' using errcode = 'P0001'; end if;
  if v_pago.empresa_id is not null and not (v_pago.empresa_id = any (public.empresas_permitidas())) then
    raise exception 'No tienes acceso a la empresa de este cobro' using errcode = '42501';
  end if;
  if v_pago.odoo_id is not null then
    raise exception 'El cobro % viene de Odoo: anúlalo en Odoo y la sincronización lo reflejará.', v_pago.numero using errcode = 'P0001';
  end if;
  if v_pago.estado::text = 'anulado' then
    raise exception 'El cobro % ya está anulado (está en la Papelera).', v_pago.numero using errcode = 'P0001';
  end if;
  if v_pago.estado::text <> 'verificado' then
    raise exception 'Solo se anulan cobros verificados. Un cobro por verificar se rechaza desde «Por verificar».' using errcode = 'P0001';
  end if;
  if coalesce(v_pago.es_igtf, false) and v_pago.igtf_origen_id is not null then
    raise exception 'Este es el IGTF de otro cobro: anula el cobro principal y su IGTF se anula con él.' using errcode = 'P0001';
  end if;
  v_activa := public.empresa_activa();
  if v_activa is null then
    raise exception 'Modo consulta ("Ambas empresas"): selecciona GUDS o Quirutec en el menú superior para anular.' using errcode = 'P0001';
  end if;
  if v_pago.empresa_id is not null and v_pago.empresa_id <> v_activa then
    raise exception 'Este cobro pertenece a otra empresa. Cámbiala en el menú superior.' using errcode = 'P0001';
  end if;

  -- El cobro y el IGTF que nació de él (registrado en GUDS)
  v_ids := array[v_pago.id] || coalesce((select array_agg(x.id order by x.created_at) from pagos x
    where x.igtf_origen_id = v_pago.id and x.odoo_id is null and x.estado::text = 'verificado'), '{}'::uuid[]);
  perform 1 from pagos where id = any (v_ids) for update;

  if exists (select 1 from extracto_lineas el join movimientos_bancarios m on m.id = el.movimiento_bancario_id
             where m.pago_id = any (v_ids)) then
    raise exception 'El movimiento bancario del cobro % ya está conciliado con un extracto: deshaz esa conciliación antes de anularlo.', v_pago.numero
      using errcode = 'P0001';
  end if;

  select nombre_negocio into v_cliente from clientes where id = v_pago.cliente_id;
  select nombre into v_banco from bancos where id = v_pago.banco_id;
  select count(distinct pf.factura_id) into v_n_fact from pago_facturas pf where pf.pago_id = any (v_ids);

  -- Foto completa (versión 1): lo necesario para ver y para restaurar
  v_foto := jsonb_build_object(
    'version', 1,
    'pago', to_jsonb(v_pago),
    'pagos', (select coalesce(jsonb_agg(to_jsonb(x) order by x.es_igtf, x.created_at), '[]'::jsonb) from pagos x where x.id = any (v_ids)),
    'cliente', (select jsonb_build_object('id', c.id, 'nombre', c.nombre_negocio, 'rif', c.rif, 'codigo', c.codigo) from clientes c where c.id = v_pago.cliente_id),
    'banco', case when v_pago.banco_id is not null then jsonb_build_object('id', v_pago.banco_id, 'nombre', v_banco) end,
    'aplicaciones', (select coalesce(jsonb_agg(to_jsonb(pf) || jsonb_build_object(
        'factura_numero', f.numero, 'factura_tipo', f.tipo, 'factura_fecha', f.fecha_emision, 'factura_total_usd', f.total_usd,
        'saldo_factura_antes', f.saldo_usd, 'saldo_factura_despues', round(f.saldo_usd + pf.monto_aplicado, 2), 'saldo_odoo_usd', f.saldo_odoo_usd)
        order by f.fecha_emision, f.numero), '[]'::jsonb)
      from pago_facturas pf join facturas f on f.id = pf.factura_id where pf.pago_id = any (v_ids)),
    'movimientos', (select coalesce(jsonb_agg(to_jsonb(m) order by m.fecha), '[]'::jsonb) from movimientos_bancarios m where m.pago_id = any (v_ids)),
    -- Solo informativo (no se tocan): adjudicaciones viejas a órdenes y cuentas manuales, y el espejo de aplicaciones de Odoo
    'pago_ordenes', (select coalesce(jsonb_agg(to_jsonb(po)), '[]'::jsonb) from pago_ordenes po where po.pago_id = any (v_ids)),
    'pago_cuentas', (select coalesce(jsonb_agg(to_jsonb(pc)), '[]'::jsonb) from pago_cuentas pc where pc.pago_id = any (v_ids)),
    'factura_aplicaciones', (select coalesce(jsonb_agg(to_jsonb(fa)), '[]'::jsonb) from factura_aplicaciones fa where fa.pago_id = any (v_ids))
  );

  perform set_config('guds.papelera', 'on', true);
  -- Sin aplicaciones: trg_pf_recalc recalcula facturas.monto_aplicado_usd (el saldo vuelve a ser el de Odoo)
  delete from pago_facturas where pago_id = any (v_ids);
  -- Sin la entrada en el banco (el saldo del banco deja de contarla)
  delete from movimientos_bancarios where pago_id = any (v_ids);
  update pagos set estado = 'anulado', anulado_at = now(), anulado_por = public.usuario_actual_id(), motivo_anulacion = btrim(p_motivo)
   where id = any (v_ids);
  perform public.recalcular_credito(v_pago.cliente_id);

  v_papelera := public.papelera_guardar('cobro', 'anulado', v_pago.id, v_pago.numero, v_pago.empresa_id, v_pago.cliente_id, v_pago.monto,
    'Cobro ' || v_pago.numero,
    concat_ws(' · ', v_cliente, v_banco,
      case when v_n_fact = 0 then 'sin facturas aplicadas' when v_n_fact = 1 then 'aplicado a 1 factura' else 'aplicado a ' || v_n_fact || ' facturas' end,
      case when cardinality(v_ids) > 1 then 'con su IGTF' end),
    v_foto, p_motivo, true);

  return jsonb_build_object('papelera_id', v_papelera, 'numero', v_pago.numero, 'monto_usd', v_pago.monto,
    'facturas', v_n_fact, 'cobros', cardinality(v_ids));
end $$;
revoke all on function public.anular_cobro(uuid, text) from public, anon;
grant execute on function public.anular_cobro(uuid, text) to authenticated;

-- ── 6. Restaurar ─────────────────────────────────────────────────────────
-- Cobro: vuelve a 'verificado' y se reaplica a las mismas facturas si aún tienen saldo (si no, error claro).
create or replace function public.papelera_restaurar_cobro(p_item public.papelera)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_foto jsonb := p_item.datos;
  v_ids uuid[];
  r record;
begin
  if not public.puede('cuentas', 'editar') then
    raise exception 'No tienes permiso para restaurar cobros' using errcode = '42501';
  end if;
  select array_agg((x->>'id')::uuid) into v_ids from jsonb_array_elements(coalesce(v_foto->'pagos', '[]'::jsonb)) x;
  if v_ids is null then v_ids := array[p_item.registro_id]; end if;
  perform 1 from pagos where id = any (v_ids) for update;
  if (select count(*) from pagos where id = any (v_ids)) <> cardinality(v_ids) then
    raise exception 'El cobro % ya no existe: no se puede restaurar.', p_item.numero using errcode = 'P0001';
  end if;
  if exists (select 1 from pagos where id = any (v_ids) and estado::text <> 'anulado') then
    raise exception 'El cobro % ya no está anulado.', p_item.numero using errcode = 'P0001';
  end if;

  -- Cada factura debe seguir vigente y con saldo para lo que el cobro le aplicaba
  for r in
    select (a->>'factura_id')::uuid factura_id, max(a->>'factura_numero') numero, round(sum((a->>'monto_aplicado')::numeric), 2) monto
      from jsonb_array_elements(coalesce(v_foto->'aplicaciones', '[]'::jsonb)) a
     group by 1
  loop
    declare f facturas%rowtype;
    begin
      select * into f from facturas where id = r.factura_id for update;
      if not found then
        raise exception 'La factura % ya no existe: no se puede restaurar el cobro %.', r.numero, p_item.numero using errcode = 'P0001';
      end if;
      if f.estado <> 'posted' or f.estado_pago = 'anulado' then
        raise exception 'La factura % está anulada: no se puede restaurar el cobro %.', f.numero, p_item.numero using errcode = 'P0001';
      end if;
      if r.monto > f.saldo_usd + 0.01 then
        raise exception 'La factura % ya no tiene saldo suficiente (saldo USD %, el cobro le aplicaba USD %): no se puede restaurar el cobro %.',
          f.numero, f.saldo_usd, r.monto, p_item.numero using errcode = 'P0001';
      end if;
    end;
  end loop;

  perform set_config('guds.papelera', 'on', true);
  -- Primero verificado (así trg_pf_recalc cuenta las aplicaciones al reinsertarlas)
  update pagos set estado = 'verificado', anulado_at = null, anulado_por = null, motivo_anulacion = null where id = any (v_ids);
  insert into pago_facturas (id, pago_id, factura_id, monto_aplicado, created_at, created_by, empresa_id)
  select x.id, x.pago_id, x.factura_id, x.monto_aplicado, x.created_at, x.created_by, x.empresa_id
    from jsonb_populate_recordset(null::pago_facturas, coalesce(v_foto->'aplicaciones', '[]'::jsonb)) x
  on conflict do nothing;
  insert into movimientos_bancarios (id, banco_id, tipo, monto, referencia, descripcion, pago_id, fecha, created_at, empresa_id, origen,
                                     pago_proveedor_id, reintegro_id, odoo_pago_id)
  select x.id, x.banco_id, x.tipo, x.monto, x.referencia, x.descripcion, x.pago_id, x.fecha, x.created_at, x.empresa_id, x.origen,
         x.pago_proveedor_id, x.reintegro_id, x.odoo_pago_id
    from jsonb_populate_recordset(null::movimientos_bancarios, coalesce(v_foto->'movimientos', '[]'::jsonb)) x
  on conflict do nothing;
  perform public.recalcular_credito((v_foto->'pago'->>'cliente_id')::uuid);
end $$;
revoke all on function public.papelera_restaurar_cobro(public.papelera) from public, anon, authenticated;

-- Genérica: valida y delega en public.papelera_restaurar_<tipo>(papelera)
create or replace function public.restaurar_papelera(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_item papelera%rowtype;
  v_fn text;
  v_activa uuid;
  v_usuario uuid; v_nombre text;
begin
  if auth.uid() is null or not (public.es_personal_admin() and public.puede('papelera', 'editar')) then
    raise exception 'Solo un administrador puede restaurar desde la Papelera' using errcode = '42501';
  end if;
  select * into v_item from papelera where id = p_id for update;
  if not found then raise exception 'No está en la Papelera' using errcode = 'P0001'; end if;
  if v_item.empresa_id is not null and not (v_item.empresa_id = any (public.empresas_permitidas())) then
    raise exception 'No tienes acceso a esa empresa' using errcode = '42501';
  end if;
  if v_item.restaurado_at is not null then
    raise exception '% ya se restauró el %.', v_item.titulo, to_char(v_item.restaurado_at at time zone 'America/Caracas', 'DD/MM/YYYY') using errcode = 'P0001';
  end if;
  if not v_item.restaurable then
    raise exception '% no se puede restaurar.', v_item.titulo using errcode = 'P0001';
  end if;
  v_activa := public.empresa_activa();
  if v_activa is null then
    raise exception 'Modo consulta ("Ambas empresas"): selecciona GUDS o Quirutec en el menú superior para restaurar.' using errcode = 'P0001';
  end if;
  if v_item.empresa_id is not null and v_item.empresa_id <> v_activa then
    raise exception 'Esto pertenece a otra empresa. Cámbiala en el menú superior.' using errcode = 'P0001';
  end if;

  v_fn := 'papelera_restaurar_' || v_item.tipo;
  if to_regprocedure('public.' || v_fn || '(public.papelera)') is null then
    raise exception 'Este tipo de registro (%) no se restaura desde la Papelera.', v_item.tipo using errcode = 'P0001';
  end if;
  execute format('select public.%I($1)', v_fn) using v_item;

  select u.id, coalesce(nullif(trim(concat_ws(' ', u.nombre, u.apellido)), ''), u.email) into v_usuario, v_nombre
    from usuarios u where u.auth_id = auth.uid();
  update papelera set restaurado_at = now(), restaurado_por = v_usuario, restaurado_por_nombre = v_nombre where id = p_id;
  return jsonb_build_object('id', p_id, 'tipo', v_item.tipo, 'numero', v_item.numero, 'titulo', v_item.titulo);
end $$;
revoke all on function public.restaurar_papelera(uuid) from public, anon;
grant execute on function public.restaurar_papelera(uuid) to authenticated;

-- ── 7. Lo que contaba "todo menos rechazado" excluye también lo anulado ──
-- (reemplazo puntual sobre la definición vigente, para no pisar cambios de otras fases en estas funciones)
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.cartera_vendedor'::regproc);
  n := replace(d, 'p.estado::text <> ''rechazado''', 'p.estado::text not in (''rechazado'', ''anulado'')');
  if n = d and position('''anulado''' in d) = 0 then raise exception 'cartera_vendedor: no se encontró el filtro a cambiar'; end if;
  if n <> d then execute n; end if;

  d := pg_get_functiondef('public.registrar_cobro_vendedor'::regproc);
  n := replace(d, 'p.estado <> ''rechazado'' and p.created_at', 'p.estado::text not in (''rechazado'', ''anulado'') and p.created_at');
  if n = d and position('''anulado''' in d) = 0 then raise exception 'registrar_cobro_vendedor: no se encontró el filtro a cambiar'; end if;
  if n <> d then execute n; end if;
end $$;

commit;
