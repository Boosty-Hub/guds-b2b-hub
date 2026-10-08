-- ════════════════════════════════════════════════════════════════════════
-- Fase 22g · R3 del plan de reportes de finanzas (docs/PLAN-REPORTES-FINANZAS.md): Antigüedad de la deuda, gestión de
-- cobranza (T5), anticipos de Odoo sin aplicar (T6) y notas de entrega no fiscales en solo lectura (NE1).
--
--   1. T6 · pagos.saldo_odoo_usd y pagos.odoo_conciliaciones: lo que Odoo dice que queda sin aplicar de cada cobro (la línea
--      por cobrar del cobro) y sus conciliaciones [fecha, monto], para el saldo a una fecha de corte. Los escribe la
--      sincronización (importar.js): las columnas se crean ANTES de desplegarla (la sincronización escribe con los
--      disparadores apagados). v_anticipos incluye ahora esos cobros (antes solo los de GUDS): el estado de cuenta, Cuentas
--      por Cobrar → Anticipos y el tablero los ven. aplicar_anticipo rechaza los de Odoo (se aplican en Odoo).
--   2. T5 · cobranza_gestion: activa / incobrable por cliente (con responsable, nota y desde cuándo) y excepciones por
--      documento; historial de cambios. Se edita con guardar_gestion_cobranza / quitar_gestion_cobranza (permiso Cuentas →
--      Editar). Carga inicial desde el Excel de finanzas (scripts/importar-vencimiento-finanzas.mjs).
--   3. NE1 · notas_entrega (+ ítems y movimientos) con módulo propio 'notas_entrega'. Solo lectura en GUDS por ahora: las 29
--      históricas (serie HIST, Quirutec) se cargan del Excel. Nunca se escriben en Odoo.
--   4. partidas_cobranza(corte, empresas, ne): una fila por partida abierta al corte (facturas, ND, NC a favor, anticipos de
--      Odoo y de GUDS, notas de entrega), con el mismo saldo al corte y el mismo "qué falta" del estado de cuenta.
--      reporte_antiguedad(corte, ne): las partidas y sus clientes en JSON (exige reportes y cuentas, D10).
-- ════════════════════════════════════════════════════════════════════════
begin;

-- 1. T6 · Cobros de Odoo sin aplicar --------------------------------------------------------------------------------------
alter table public.pagos add column if not exists saldo_odoo_usd numeric(14,2);
alter table public.pagos add column if not exists odoo_conciliaciones jsonb;
comment on column public.pagos.saldo_odoo_usd is
  'Cobros de Odoo: lo que queda sin aplicar (residual de la línea por cobrar del cobro, en USD). > 0 = anticipo. Lo escribe la sincronización (22g)';
comment on column public.pagos.odoo_conciliaciones is
  'Cobros de Odoo: conciliaciones de la línea por cobrar como [[fecha, monto USD], …]. Saldo al corte = saldo_odoo_usd + lo conciliado después del corte (22g)';

do $$
begin
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'public.pagos'::regclass and t.tgname = 'c_proteger_espejo_odoo'
                    and pg_get_triggerdef(t.oid) like '%''saldo_odoo_usd''%') then
    drop trigger if exists c_proteger_espejo_odoo on public.pagos;
    create trigger c_proteger_espejo_odoo before delete or update on public.pagos
      for each row execute function public.trg_proteger_espejo_odoo('numero', 'cliente_id', 'banco_id', 'monto', 'monto_moneda', 'moneda',
        'estado', 'estado_odoo', 'referencia', 'es_igtf', 'fecha_verificacion', 'empresa_id', 'igtf_origen_id', 'lote_pago', 'fecha_pago',
        'saldo_odoo_usd', 'odoo_conciliaciones');
  end if;
end $$;

-- Anticipos: cobros de GUDS (monto − lo asignado a facturas) y, desde 22g, cobros de Odoo con saldo sin aplicar en Odoo
create or replace view public.v_anticipos with (security_invoker = on) as
select p.id as pago_id,
       p.numero,
       p.cliente_id,
       p.created_at,
       p.monto as monto_usd,
       case when p.odoo_id is null then coalesce((select sum(pf.monto_aplicado) from public.pago_facturas pf where pf.pago_id = p.id), 0)
            else p.monto - p.saldo_odoo_usd end as aplicado,
       case when p.odoo_id is null then round(p.monto - coalesce((select sum(pf.monto_aplicado) from public.pago_facturas pf where pf.pago_id = p.id), 0), 2)
            else p.saldo_odoo_usd end as disponible,
       p.empresa_id,
       p.odoo_id,
       p.fecha_pago as fecha
  from public.pagos p
 where p.estado = 'verificado'
   and (p.odoo_id is null or coalesce(p.saldo_odoo_usd, 0) > 0.009);
comment on view public.v_anticipos is
  'Cobros verificados sin aplicar: de GUDS (monto − lo asignado) y de Odoo (saldo_odoo_usd, se aplican en Odoo). 22g: incluye los de Odoo';

do $$
declare d text;
begin
  d := pg_get_functiondef('public.aplicar_anticipo'::regproc);
  if position('se aplica en Odoo' in d) = 0 then
    d := replace(d, $x$  v_asignado := public.aplicar_pago_a_facturas(p_pago_id, p_asignaciones);$x$,
$x$  if p.odoo_id is not null then
    raise exception 'Este cobro viene de Odoo: se aplica a las facturas en Odoo' using errcode = 'P0001', hint = 'se aplica en Odoo';
  end if;
  v_asignado := public.aplicar_pago_a_facturas(p_pago_id, p_asignaciones);$x$);
    if position('se aplica en Odoo' in d) = 0 then raise exception 'aplicar_anticipo: no se encontró dónde agregar la validación'; end if;
    execute d;
  end if;
end $$;

-- 2. T5 · Gestión de cobranza: activa / incobrable ------------------------------------------------------------------------
create table if not exists public.cobranza_gestion (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  factura_id uuid references public.facturas(id) on delete cascade,
  clasificacion text not null default 'activa',
  responsable text,
  nota text,
  desde date not null default ((now() at time zone 'America/Caracas')::date),
  origen text not null default 'manual',
  created_at timestamptz not null default now(),
  created_by uuid references public.usuarios(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.usuarios(id) on delete set null,
  constraint cobranza_gestion_clasificacion_check check (clasificacion in ('activa', 'incobrable')),
  constraint cobranza_gestion_origen_check check (origen in ('excel', 'manual')),
  constraint cobranza_gestion_responsable_check check (responsable is null or (btrim(responsable) <> '' and length(responsable) <= 120)),
  constraint cobranza_gestion_nota_check check (nota is null or (btrim(nota) <> '' and length(nota) <= 1000))
);
create unique index if not exists cobranza_gestion_cliente on public.cobranza_gestion (cliente_id) where factura_id is null;
create unique index if not exists cobranza_gestion_factura on public.cobranza_gestion (factura_id) where factura_id is not null;
create index if not exists cobranza_gestion_empresa on public.cobranza_gestion (empresa_id);
comment on table public.cobranza_gestion is
  'Gestión de cobranza (22g · T5): clasificación de la deuda por cliente (factura_id nulo) y excepciones por documento. Incobrable = casos con abogados o cobranza externa: no baja el saldo, se ve aparte en la antigüedad';
comment on column public.cobranza_gestion.responsable is 'Quién lleva el caso (abogado, cobranza externa, persona de cobranzas)';
comment on column public.cobranza_gestion.desde is 'Desde cuándo rige la clasificación';

create table if not exists public.cobranza_gestion_historial (
  id bigint generated always as identity primary key,
  gestion_id uuid,
  empresa_id uuid not null,
  cliente_id uuid not null,
  factura_id uuid,
  accion text not null,
  clasificacion text,
  responsable text,
  nota text,
  desde date,
  origen text,
  usuario_id uuid,
  usuario_nombre text,
  creado_at timestamptz not null default now(),
  constraint cobranza_gestion_historial_accion_check check (accion in ('crear', 'cambiar', 'quitar'))
);
create index if not exists cobranza_gestion_historial_cliente on public.cobranza_gestion_historial (cliente_id, creado_at desc);
comment on table public.cobranza_gestion_historial is 'Cada cambio de la gestión de cobranza (22g): quién, cuándo y cómo quedó';

create or replace function public.trg_cobranza_gestion_historial()
returns trigger language plpgsql security definer set search_path = public as $$
declare r public.cobranza_gestion;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  if tg_op = 'UPDATE' and (old.clasificacion, old.responsable, old.nota, old.desde) is not distinct from (new.clasificacion, new.responsable, new.nota, new.desde) then
    return new;
  end if;
  insert into public.cobranza_gestion_historial (gestion_id, empresa_id, cliente_id, factura_id, accion, clasificacion, responsable, nota, desde,
                                                 origen, usuario_id, usuario_nombre)
  values (r.id, r.empresa_id, r.cliente_id, r.factura_id,
          case tg_op when 'INSERT' then 'crear' when 'UPDATE' then 'cambiar' else 'quitar' end,
          r.clasificacion, r.responsable, r.nota, r.desde, r.origen, public.usuario_actual_id(),
          coalesce(public.calidad_usuario_nombre(), case when r.origen = 'excel' then 'Carga del Excel de finanzas' end));
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke execute on function public.trg_cobranza_gestion_historial() from public, anon, authenticated;
drop trigger if exists cobranza_gestion_historial on public.cobranza_gestion;
create trigger cobranza_gestion_historial after insert or update or delete on public.cobranza_gestion
  for each row execute function public.trg_cobranza_gestion_historial();

alter table public.cobranza_gestion enable row level security;
alter table public.cobranza_gestion_historial enable row level security;
revoke all on public.cobranza_gestion, public.cobranza_gestion_historial from anon;
revoke insert, update, delete on public.cobranza_gestion, public.cobranza_gestion_historial from authenticated;
grant select on public.cobranza_gestion, public.cobranza_gestion_historial to authenticated;
drop policy if exists cobranza_gestion_ver on public.cobranza_gestion;
create policy cobranza_gestion_ver on public.cobranza_gestion for select to authenticated using ((select public.puede('cuentas', 'ver')));
drop policy if exists empresa_visible on public.cobranza_gestion;
create policy empresa_visible on public.cobranza_gestion as restrictive for all to authenticated
  using (empresa_id = any ((select public.empresas_visibles())::uuid[]));
drop policy if exists cobranza_gestion_historial_ver on public.cobranza_gestion_historial;
create policy cobranza_gestion_historial_ver on public.cobranza_gestion_historial for select to authenticated using ((select public.puede('cuentas', 'ver')));
drop policy if exists empresa_visible on public.cobranza_gestion_historial;
create policy empresa_visible on public.cobranza_gestion_historial as restrictive for all to authenticated
  using (empresa_id = any ((select public.empresas_visibles())::uuid[]));

-- Guardar: sin documento = la clasificación del cliente; con documento = excepción (si queda igual que la del cliente, se quita)
create or replace function public.guardar_gestion_cobranza(p_cliente uuid, p_factura uuid default null, p_clasificacion text default 'activa',
  p_responsable text default null, p_nota text default null, p_desde date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid;
  v_cli_clasif text;
  v_id uuid;
  v_resp text := nullif(btrim(p_responsable), '');
  v_nota text := nullif(btrim(p_nota), '');
  v_desde date := coalesce(p_desde, (now() at time zone 'America/Caracas')::date);
  v_yo uuid := public.usuario_actual_id();
begin
  if not public.puede('cuentas', 'editar') then
    raise exception 'No tienes permiso para cambiar la gestión de cobranza' using errcode = '42501';
  end if;
  if p_clasificacion is null or p_clasificacion not in ('activa', 'incobrable') then
    raise exception 'Clasificación no válida (activa o incobrable)' using errcode = '22023';
  end if;
  select c.empresa_id into v_emp from clientes c where c.id = p_cliente;
  -- Como toda escritura: con una empresa activa (en «Ambas» solo se consulta) y el cliente de esa empresa
  if v_emp is null or v_emp <> public.empresa_activa_requerida() then
    raise exception 'Cliente no encontrado en la empresa activa' using errcode = 'P0002';
  end if;
  if v_desde > (now() at time zone 'America/Caracas')::date then
    raise exception 'La fecha no puede ser futura' using errcode = '22023';
  end if;

  if p_factura is null then
    insert into cobranza_gestion (empresa_id, cliente_id, clasificacion, responsable, nota, desde, origen, created_by, updated_by)
    values (v_emp, p_cliente, p_clasificacion, v_resp, v_nota, v_desde, 'manual', v_yo, v_yo)
    on conflict (cliente_id) where factura_id is null do update
      set clasificacion = excluded.clasificacion, responsable = excluded.responsable, nota = excluded.nota, desde = excluded.desde,
          origen = 'manual', updated_at = now(), updated_by = v_yo
    returning id into v_id;
    return jsonb_build_object('id', v_id, 'clasificacion', p_clasificacion);
  end if;

  if not exists (select 1 from facturas f where f.id = p_factura and f.cliente_id = p_cliente and f.estado = 'posted') then
    raise exception 'El documento no es de este cliente' using errcode = '22023';
  end if;
  select g.clasificacion into v_cli_clasif from cobranza_gestion g where g.cliente_id = p_cliente and g.factura_id is null;
  if p_clasificacion = coalesce(v_cli_clasif, 'activa') and v_resp is null and v_nota is null then
    delete from cobranza_gestion g where g.factura_id = p_factura;
    return jsonb_build_object('id', null, 'clasificacion', p_clasificacion, 'quitada', true);
  end if;
  insert into cobranza_gestion (empresa_id, cliente_id, factura_id, clasificacion, responsable, nota, desde, origen, created_by, updated_by)
  values (v_emp, p_cliente, p_factura, p_clasificacion, v_resp, v_nota, v_desde, 'manual', v_yo, v_yo)
  on conflict (factura_id) where factura_id is not null do update
    set clasificacion = excluded.clasificacion, responsable = excluded.responsable, nota = excluded.nota, desde = excluded.desde,
        origen = 'manual', updated_at = now(), updated_by = v_yo
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'clasificacion', p_clasificacion);
end $$;
comment on function public.guardar_gestion_cobranza(uuid, uuid, text, text, text, date) is
  'Gestión de cobranza (22g · T5): clasificación del cliente (sin documento) o excepción de un documento. Exige Cuentas → Editar';

create or replace function public.quitar_gestion_cobranza(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.puede('cuentas', 'editar') then
    raise exception 'No tienes permiso para cambiar la gestión de cobranza' using errcode = '42501';
  end if;
  delete from cobranza_gestion g where g.id = p_id and g.empresa_id = public.empresa_activa_requerida();
  if not found then raise exception 'No se encontró la clasificación' using errcode = 'P0002'; end if;
end $$;
comment on function public.quitar_gestion_cobranza(uuid) is 'Quita una clasificación de cobranza (vuelve a "activa" o a la del cliente). Exige Cuentas → Editar';

-- Para el detalle de la cuenta: la clasificación del cliente, sus excepciones por documento y el historial
create or replace function public.gestion_cobranza_cliente(p_cliente uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_emp uuid;
begin
  if not public.puede('cuentas', 'ver') then
    raise exception 'No tienes permiso para ver cuentas' using errcode = '42501';
  end if;
  select c.empresa_id into v_emp from clientes c where c.id = p_cliente;
  if v_emp is null or not (v_emp = any (public.empresas_visibles())) then
    raise exception 'Cliente no encontrado' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'cliente', (select jsonb_build_object('id', g.id, 'clasificacion', g.clasificacion, 'responsable', g.responsable, 'nota', g.nota,
                       'desde', g.desde, 'origen', g.origen, 'actualizado', g.updated_at,
                       'por', (select nullif(btrim(concat_ws(' ', u.nombre, u.apellido)), '') from usuarios u where u.id = coalesce(g.updated_by, g.created_by)))
                  from cobranza_gestion g where g.cliente_id = p_cliente and g.factura_id is null),
    'documentos', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'factura_id', g.factura_id, 'numero', f.numero,
                       'tipo', case when f.tipo = 'nota_credito' then 'nota_credito' when coalesce(f.es_nota_debito, false) then 'nota_debito' else 'factura' end,
                       'emision', f.fecha_emision, 'saldo', f.saldo_usd, 'clasificacion', g.clasificacion, 'responsable', g.responsable,
                       'nota', g.nota, 'desde', g.desde, 'origen', g.origen) order by f.fecha_emision, f.numero)
                  from cobranza_gestion g join facturas f on f.id = g.factura_id where g.cliente_id = p_cliente), '[]'::jsonb),
    'historial', coalesce((select jsonb_agg(x order by (x->>'fecha')::timestamptz desc) from (
                  select jsonb_build_object('fecha', h.creado_at, 'accion', h.accion, 'clasificacion', h.clasificacion, 'responsable', h.responsable,
                         'nota', h.nota, 'desde', h.desde, 'por', h.usuario_nombre,
                         'documento', (select f.numero from facturas f where f.id = h.factura_id)) x
                    from cobranza_gestion_historial h where h.cliente_id = p_cliente order by h.creado_at desc limit 20) t), '[]'::jsonb));
end $$;

revoke execute on function public.guardar_gestion_cobranza(uuid, uuid, text, text, text, date), public.quitar_gestion_cobranza(uuid),
  public.gestion_cobranza_cliente(uuid) from public, anon;
grant execute on function public.guardar_gestion_cobranza(uuid, uuid, text, text, text, date), public.quitar_gestion_cobranza(uuid),
  public.gestion_cobranza_cliente(uuid) to authenticated;

-- 3. NE1 · Notas de entrega no fiscales ------------------------------------------------------------------------------------
insert into public.modulos (codigo, nombre, descripcion, icono, orden, activo) values
  ('notas_entrega', 'Notas de entrega', 'Notas de entrega no fiscales (N/E): deuda interna que no está en Odoo', 'FileText', 25, true)
on conflict (codigo) do nothing;
insert into public.permisos (rol_id, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar)
select r.id, m.id, true, true, true, true from public.roles r, public.modulos m
where r.nombre = 'Administrador' and m.codigo = 'notas_entrega'
on conflict (rol_id, modulo_id) do nothing;
insert into public.permisos (rol_id, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar)
select r.id, m.id, true, true, true, false from public.roles r, public.modulos m
where r.nombre = 'Contador' and m.codigo = 'notas_entrega'
on conflict (rol_id, modulo_id) do nothing;

create table if not exists public.notas_entrega (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  serie text not null,
  numero text not null,
  cliente_id uuid references public.clientes(id) on delete set null,
  cliente_nombre text not null,
  vendedor_id uuid references public.usuarios(id) on delete set null,
  vendedor_nombre text,
  orden_id uuid references public.ordenes(id) on delete set null,
  pedido_odoo text,
  fecha_emision date not null,
  fecha_vencimiento date,
  moneda text not null default 'USD',
  tasa numeric(18,6),
  total_usd numeric(14,2) not null,
  estado text not null default 'emitida',
  clasificacion text,
  observacion text,
  origen text not null default 'guds',
  archivo text,
  created_at timestamptz not null default now(),
  created_by uuid references public.usuarios(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.usuarios(id) on delete set null,
  constraint notas_entrega_serie_check check (serie in ('NE', 'TAL', 'HIST')),
  constraint notas_entrega_numero_check check (btrim(numero) <> '' and length(numero) <= 30),
  constraint notas_entrega_moneda_check check (moneda in ('USD', 'BS')),
  constraint notas_entrega_estado_check check (estado in ('borrador', 'emitida', 'abonada', 'pagada', 'facturada', 'devuelta', 'anulada')),
  constraint notas_entrega_clasificacion_check check (clasificacion is null or clasificacion in ('activa', 'incobrable')),
  constraint notas_entrega_origen_check check (origen in ('excel', 'guds')),
  constraint notas_entrega_numero_unico unique (empresa_id, serie, numero)
);
create index if not exists notas_entrega_cliente on public.notas_entrega (cliente_id);
comment on table public.notas_entrega is
  'Notas de entrega NO fiscales (22g · NE1 del plan): deuda interna que no está en Odoo ni en el libro fiscal. Serie NE (correlativo de GUDS), TAL (talonario físico), HIST (históricas del Excel de finanzas). No se escriben en Odoo';
comment on column public.notas_entrega.cliente_nombre is 'Nombre del cliente como figura en la nota (si no tiene ficha en GUDS no se crea: crear un cliente lo crea en Odoo)';
comment on column public.notas_entrega.total_usd is 'Total sin IVA, en USD';
comment on column public.notas_entrega.clasificacion is 'activa o incobrable; nula = la del cliente (gestión de cobranza). Marcar incobrable no baja el saldo';

create table if not exists public.nota_entrega_items (
  id uuid primary key default gen_random_uuid(),
  nota_id uuid not null references public.notas_entrega(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id),
  producto_id uuid references public.productos(id) on delete set null,
  descripcion text not null,
  cantidad numeric(14,3) not null default 1,
  precio_usd numeric(14,4) not null default 0,
  subtotal_usd numeric(14,2) not null default 0,
  orden smallint not null default 0,
  constraint nota_entrega_items_descripcion_check check (btrim(descripcion) <> '')
);
create index if not exists nota_entrega_items_nota on public.nota_entrega_items (nota_id);
comment on table public.nota_entrega_items is 'Líneas de una nota de entrega (producto o texto libre). Las históricas no traen líneas';

create table if not exists public.nota_entrega_movimientos (
  id uuid primary key default gen_random_uuid(),
  nota_id uuid not null references public.notas_entrega(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id),
  tipo text not null,
  fecha date,
  monto_usd numeric(14,2) not null,
  pago_id uuid references public.pagos(id) on delete set null,
  factura_id uuid references public.facturas(id) on delete set null,
  referencia text,
  nota text,
  origen text not null default 'guds',
  created_at timestamptz not null default now(),
  created_by uuid references public.usuarios(id) on delete set null,
  constraint nota_entrega_movimientos_tipo_check check (tipo in ('abono', 'descuento', 'devolucion', 'facturada', 'ajuste')),
  constraint nota_entrega_movimientos_origen_check check (origen in ('excel', 'guds'))
);
create index if not exists nota_entrega_movimientos_nota on public.nota_entrega_movimientos (nota_id);
comment on table public.nota_entrega_movimientos is
  'Lo que baja el saldo de una nota de entrega: abono, descuento, devolución, facturada (pasa a una factura fiscal de Odoo) o ajuste. Fecha nula = sin fecha (abonos históricos)';
comment on column public.nota_entrega_movimientos.pago_id is 'Si el dinero entró por un banco de Odoo: el cobro (anticipo) al que se vincula, para no contarlo dos veces';

-- Empresa de las líneas y movimientos = la de su nota
create or replace function public.trg_nota_entrega_hijo_empresa()
returns trigger language plpgsql set search_path = public as $$
begin
  select n.empresa_id into new.empresa_id from notas_entrega n where n.id = new.nota_id;
  return new;
end $$;
revoke execute on function public.trg_nota_entrega_hijo_empresa() from public, anon, authenticated;
drop trigger if exists a_empresa on public.nota_entrega_items;
create trigger a_empresa before insert or update of nota_id on public.nota_entrega_items for each row execute function public.trg_nota_entrega_hijo_empresa();
drop trigger if exists a_empresa on public.nota_entrega_movimientos;
create trigger a_empresa before insert or update of nota_id on public.nota_entrega_movimientos for each row execute function public.trg_nota_entrega_hijo_empresa();

alter table public.notas_entrega enable row level security;
alter table public.nota_entrega_items enable row level security;
alter table public.nota_entrega_movimientos enable row level security;
revoke all on public.notas_entrega, public.nota_entrega_items, public.nota_entrega_movimientos from anon;
revoke insert, update, delete on public.notas_entrega, public.nota_entrega_items, public.nota_entrega_movimientos from authenticated;
grant select on public.notas_entrega, public.nota_entrega_items, public.nota_entrega_movimientos to authenticated;
do $$
declare t text;
begin
  foreach t in array array['notas_entrega', 'nota_entrega_items', 'nota_entrega_movimientos'] loop
    execute format('drop policy if exists %I on public.%I', t || '_ver', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.puede(''notas_entrega'', ''ver'')))', t || '_ver', t);
    execute format('drop policy if exists empresa_visible on public.%I', t);
    execute format('create policy empresa_visible on public.%I as restrictive for all to authenticated using (empresa_id = any ((select public.empresas_visibles())::uuid[]))', t);
  end loop;
end $$;

-- Lista con saldo, abonado y la clasificación efectiva (la propia o la del cliente)
create or replace view public.v_notas_entrega with (security_invoker = on) as
select n.id, n.empresa_id, n.serie, n.numero, n.serie || ' ' || n.numero as documento, n.cliente_id,
       coalesce(c.nombre_negocio, n.cliente_nombre) as cliente, c.rif, n.cliente_nombre,
       coalesce(nullif(btrim(concat_ws(' ', u.nombre, u.apellido)), ''), n.vendedor_nombre) as vendedor,
       n.orden_id, n.pedido_odoo, n.fecha_emision, coalesce(n.fecha_vencimiento, n.fecha_emision) as fecha_vencimiento,
       n.moneda, n.tasa, n.total_usd,
       coalesce(m.abonado, 0) as abonado,
       round(n.total_usd - coalesce(m.abonado, 0), 2) as saldo_usd,
       n.estado, coalesce(n.clasificacion, g.clasificacion, 'activa') as clasificacion,
       case when n.clasificacion is not null then 'nota' when g.clasificacion is not null then 'cliente' end as clasificacion_origen,
       n.observacion, n.origen, n.archivo, n.created_at, n.updated_at,
       coalesce(m.movimientos, 0) as movimientos
  from public.notas_entrega n
  left join public.clientes c on c.id = n.cliente_id
  left join public.usuarios u on u.id = n.vendedor_id
  left join public.cobranza_gestion g on g.cliente_id = n.cliente_id and g.factura_id is null
  left join lateral (select sum(x.monto_usd) abonado, count(*) movimientos from public.nota_entrega_movimientos x where x.nota_id = n.id) m on true;
comment on view public.v_notas_entrega is 'Notas de entrega con saldo (total − movimientos) y clasificación efectiva (22g)';
grant select on public.v_notas_entrega to authenticated;
revoke all on public.v_notas_entrega from anon;

-- 4. Partidas abiertas al corte y reporte de antigüedad ----------------------------------------------------------------------
-- Una fila por partida con saldo al corte. Mismo saldo al corte y mismo "qué falta" que estado_cuenta_documentos (21b/22c/22e):
-- saldo de hoy ± lo aplicado después del corte. Interna (sin permisos): la llaman reporte_antiguedad y las pruebas.
create or replace function public.partidas_cobranza(p_corte date, p_empresas uuid[], p_ne boolean default true)
returns table (
  ref text, tipo text, clase text, falta text, empresa_id uuid, documento_id uuid, numero text, cliente_id uuid, cliente_nombre text,
  vendedor text, emision date, vence date, moneda text, total_usd numeric, saldo_usd numeric, clasificacion text, clasificacion_origen text
)
language sql stable security definer set search_path = public
as $$
  with
  docs as materialized (
    select f.id, f.empresa_id, f.cliente_id, f.numero, f.tipo, coalesce(f.es_nota_debito, false) es_nd, f.fecha_emision, f.fecha_vencimiento,
           f.moneda, f.total_usd, f.saldo_usd, f.vendedor_odoo,
           case when f.total <> 0 then f.subtotal * f.total_usd / f.total else f.total_usd end base_usd,
           case when f.total <> 0 then f.impuesto * f.total_usd / f.total else 0 end iva_usd
      from facturas f
     where f.estado = 'posted' and f.empresa_id = any (p_empresas)
       and coalesce(f.fecha_emision, date '1900-01-01') <= p_corte
       and not ((f.tipo = 'nota_credito' or coalesce(f.es_nota_debito, false))
                and abs(coalesce(f.total_usd, 0)) < 0.005 and abs(coalesce(f.saldo_usd, 0)) < 0.005)
  ),
  ab0 as (
    select fa.factura_id doc, fa.fecha, fa.tipo, fa.monto_usd monto, fa.pago_id, fa.descripcion, null::text ret_tipo
      from factura_aplicaciones fa join docs d on d.id = fa.factura_id
    union all
    select fa.documento_id, fa.fecha, 'aplicada', fa.monto_usd, null::uuid, fa.descripcion, null::text
      from factura_aplicaciones fa join docs d on d.id = fa.documento_id
     where fa.tipo = 'nota_credito' and d.tipo = 'nota_credito'
    union all
    select pf.factura_id, coalesce(p.fecha_pago, (coalesce(p.fecha_verificacion, p.created_at) at time zone 'America/Caracas')::date),
           'pago', pf.monto_aplicado, pf.pago_id, null::text, null::text
      from pago_facturas pf join docs d on d.id = pf.factura_id join pagos p on p.id = pf.pago_id
     where p.estado = 'verificado'
    union all
    select ri.factura_id, r.fecha, 'retencion', ri.monto_aplicado, null::uuid, coalesce(nullif(btrim(r.numero_comprobante), ''), r.numero), r.tipo::text
      from retencion_items ri join retenciones r on r.id = ri.retencion_id join docs d on d.id = ri.factura_id
     where r.estado = 'aprobado' and r.odoo_id is null
  ),
  ab as (
    select a.doc, a.monto, (a.fecha is not null and a.fecha > p_corte) futuro,
           case a.tipo when 'pago' then 'pagos' when 'nota_credito' then 'nc' when 'aplicada' then 'nc' when 'retencion' then 'retenciones'
                       else 'otros' end col,
           case when a.tipo = 'retencion' then
             case when coalesce(a.ret_tipo, '') = 'iva' or coalesce(a.descripcion, '') ~* '^IVA' then 'iva'
                  when coalesce(a.ret_tipo, '') = 'municipal' or coalesce(a.descripcion, '') ~* '^RETRS' then 'municipal'
                  else coalesce(a.ret_tipo, 'otra') end end clase_ret,
           (a.tipo = 'pago' and p.moneda = 'USD' and not coalesce(p.es_igtf, false)) divisa
      from ab0 a left join pagos p on p.id = a.pago_id
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
           coalesce(sum(a.monto) filter (where a.divisa and not a.futuro), 0) pagos_div,
           coalesce(sum(a.monto) filter (where a.futuro), 0) despues
      from docs d left join ab a on a.doc = d.id
     group by d.id
  ),
  abiertos as materialized (
    select x.* from (
      select d.*, g.pagos, g.nc, g.retenciones, g.otros, g.ret_iva, g.ret_mun, g.pagos_div,
             case when d.tipo = 'nota_credito' then d.saldo_usd - g.despues else d.saldo_usd + g.despues end saldo
        from docs d join agg g on g.id = d.id) x
     where abs(x.saldo) > 0.009
  ),
  -- Contexto de cada cliente para "qué falta" (mismas reglas que el estado de cuenta)
  ret_pct as (
    select h.cliente_id, h.empresa_id,
           case when percentile_cont(0.5) within group (order by h.r) >= 0.875 then 1.0 when count(*) > 0 then 0.75 end pct
      from (select f.cliente_id, f.empresa_id, fa.monto_usd / nullif(f.impuesto * f.total_usd / nullif(f.total, 0), 0) r
              from factura_aplicaciones fa join facturas f on f.id = fa.factura_id
             where fa.tipo = 'retencion' and fa.descripcion ~* '^IVA' and fa.monto_usd > 0.009 and f.impuesto > 0
               and f.empresa_id = any (p_empresas)) h
     where h.r is not null
     group by h.cliente_id, h.empresa_id
  ),
  ret_mun as (
    select f.cliente_id, f.empresa_id from factura_aplicaciones fa join facturas f on f.id = fa.factura_id
     where fa.tipo = 'retencion' and fa.descripcion ~* '^RETRS' and fa.monto_usd > 0.009 and f.empresa_id = any (p_empresas)
    union
    select r.cliente_id, r.empresa_id from retenciones r
     where r.tipo = 'municipal' and r.estado = 'aprobado' and r.empresa_id = any (p_empresas)
  ),
  igtf as (select distinct p.empresa_id from pagos p where p.es_igtf and p.empresa_id = any (p_empresas)),
  qf as (
    select b.id, x.codigo, x.texto
      from abiertos b
      left join ret_pct rp on rp.cliente_id = b.cliente_id and rp.empresa_id = b.empresa_id
      left join lateral (select true si from ret_mun rm where rm.cliente_id = b.cliente_id and rm.empresa_id = b.empresa_id limit 1) mu on true
      left join igtf ig on ig.empresa_id = b.empresa_id
      cross join lateral (
        select c.codigo, c.texto from (
          select v.orden, v.codigo, v.texto
            from (values
              (1, 'iva_no_retenido', 'Pendiente el IVA no retenido',
                  case when b.ret_iva > 0.009 and b.iva_usd - b.ret_iva > 0.009 then b.iva_usd - b.ret_iva end),
              (2, 'retencion_iva', 'Retención de IVA por recibir (' || to_char(coalesce(rp.pct, 0.75) * 100, 'FM990') || ' %)',
                  case when b.ret_iva <= 0.009 and b.iva_usd > 0.009 then coalesce(rp.pct, 0.75) * b.iva_usd end),
              (3, 'iva', 'Pendiente el IVA',
                  case when b.iva_usd > 0.009 and b.ret_iva <= 0.009 then b.iva_usd end),
              (4, 'igtf', 'Pendiente el IGTF (3 % de los pagos en divisas)',
                  case when ig.empresa_id is not null and b.pagos_div > 0.009 then 0.03 * b.pagos_div end),
              (5, 'retencion_municipal', 'Retención municipal por recibir (1,25 %)',
                  case when mu.si and b.ret_mun <= 0.009 and b.base_usd > 0.009 then 0.0125 * b.base_usd end),
              (6, 'retenciones', 'Retenciones de IVA y municipal por recibir',
                  case when rp.pct is not null and mu.si and b.ret_iva <= 0.009 and b.ret_mun <= 0.009 and b.iva_usd > 0.009
                       then rp.pct * b.iva_usd + 0.0125 * b.base_usd end),
              (7, 'iva_no_retenido_municipal', 'Pendiente el IVA no retenido y la retención municipal',
                  case when mu.si and b.ret_iva > 0.009 and b.ret_mun <= 0.009 and b.iva_usd - b.ret_iva > 0.009
                       then b.iva_usd - b.ret_iva + 0.0125 * b.base_usd end),
              (8, 'iva_igtf', 'Pendiente el IVA y el IGTF',
                  case when ig.empresa_id is not null and b.pagos_div > 0.009 and b.iva_usd > 0.009 and b.ret_iva <= 0.009
                       then b.iva_usd + 0.03 * b.pagos_div end),
              (9, 'iva_no_retenido_igtf', 'Pendiente el IVA no retenido y el IGTF',
                  case when ig.empresa_id is not null and b.pagos_div > 0.009 and b.ret_iva > 0.009 and b.iva_usd - b.ret_iva > 0.009
                       then b.iva_usd - b.ret_iva + 0.03 * b.pagos_div end)
            ) v(orden, codigo, texto, esperado)
           where v.esperado is not null and abs(b.saldo - v.esperado) <= public.estado_cuenta_tolerancia()
          union all
          select 20, 'solo_retencion', 'Falta el pago (retención ya aplicada)'
           where b.pagos <= 0.009 and b.nc <= 0.009 and b.otros <= 0.009 and b.retenciones > 0.009 and b.saldo >= 1
          union all
          select 21, 'abono_retencion', 'Falta el pago (solo abonó la retención de IVA)'
           where b.pagos > 0.009 and b.nc <= 0.009 and b.otros <= 0.009 and b.retenciones <= 0.009 and b.saldo >= 1
             and b.iva_usd > 0.009 and abs(b.pagos - coalesce(rp.pct, 0.75) * b.iva_usd) <= public.estado_cuenta_tolerancia()
          union all
          select 30, 'diferencia_menor', 'Diferencia menor (redondeo o cambio)'
           where b.saldo < 1
        ) c order by c.orden limit 1
      ) x
     where b.tipo <> 'nota_credito' and b.saldo > 0.009
       and b.pagos + b.nc + b.retenciones + b.otros > 0.009
  ),
  gcli as (select g.cliente_id, g.clasificacion from cobranza_gestion g where g.factura_id is null and g.empresa_id = any (p_empresas)),
  gdoc as (select g.factura_id, g.clasificacion from cobranza_gestion g where g.factura_id is not null and g.empresa_id = any (p_empresas)),
  -- Cobros de GUDS sin aplicar (como el estado de cuenta: lo disponible hoy de lo cobrado hasta el corte)
  ant_guds as (
    select p.id, p.empresa_id, p.cliente_id, p.numero, p.moneda, p.monto,
           coalesce(p.fecha_pago, (coalesce(p.fecha_verificacion, p.created_at) at time zone 'America/Caracas')::date) fecha,
           round(p.monto - coalesce((select sum(pf.monto_aplicado) from pago_facturas pf where pf.pago_id = p.id), 0), 2) disponible
      from pagos p
     where p.odoo_id is null and p.estado = 'verificado' and p.empresa_id = any (p_empresas)
  ),
  -- Cobros de Odoo sin aplicar al corte: lo que Odoo dice que queda hoy + lo que se concilió después del corte
  ant_odoo as (
    select p.id, p.empresa_id, p.cliente_id, p.numero, p.moneda, p.monto, p.fecha_pago fecha,
           p.saldo_odoo_usd + coalesce((select sum((c->>1)::numeric) from jsonb_array_elements(p.odoo_conciliaciones) c
                                         where (c->>0)::date > p_corte), 0) disponible
      from pagos p
     where p.odoo_id is not null and p.estado = 'verificado' and p.empresa_id = any (p_empresas)
       and p.fecha_pago <= p_corte and p.saldo_odoo_usd is not null
  ),
  ne as (
    select n.*, coalesce((select sum(m.monto_usd) from nota_entrega_movimientos m
                           where m.nota_id = n.id and (m.fecha is null or m.fecha <= p_corte)), 0) abonado
      from notas_entrega n
     where coalesce(p_ne, true) and n.empresa_id = any (p_empresas) and n.estado not in ('borrador', 'anulada')
       and n.fecha_emision <= p_corte
  )
  select 'f:' || b.id,
         case when b.tipo = 'nota_credito' then 'nota_credito' when b.es_nd then 'nota_debito' else 'factura' end,
         case when q.codigo in ('retencion_iva', 'retencion_municipal', 'retenciones') then 'retencion'
              when q.codigo in ('iva_no_retenido', 'iva', 'igtf', 'iva_no_retenido_municipal', 'iva_igtf', 'iva_no_retenido_igtf') then 'impuesto'
              when b.tipo <> 'nota_credito' and b.saldo < -0.009 then 'a_favor' end,
         q.texto, b.empresa_id, b.id, b.numero, b.cliente_id, null::text, nullif(btrim(b.vendedor_odoo), ''),
         b.fecha_emision, b.fecha_vencimiento, case when b.moneda = 'USD' then 'USD' else 'VES' end,
         round(b.total_usd, 2), round(b.saldo, 2),
         coalesce(gd.clasificacion, gc.clasificacion, 'activa'),
         case when gd.clasificacion is not null then 'documento' when gc.clasificacion is not null then 'cliente' end
    from abiertos b
    left join qf q on q.id = b.id
    left join gdoc gd on gd.factura_id = b.id
    left join gcli gc on gc.cliente_id = b.cliente_id
  union all
  select 'p:' || a.id, 'anticipo', null, null, a.empresa_id, a.id, a.numero, a.cliente_id, null, null, a.fecha, a.fecha,
         case when a.moneda = 'USD' then 'USD' else 'VES' end, round(-a.monto, 2), round(-a.disponible, 2),
         coalesce(gc.clasificacion, 'activa'), case when gc.clasificacion is not null then 'cliente' end
    from (select * from ant_guds where fecha <= p_corte union all select * from ant_odoo) a
    left join gcli gc on gc.cliente_id = a.cliente_id
   where a.disponible > 0.009
  union all
  select 'n:' || n.id, 'nota_entrega', null, null, n.empresa_id, n.id, n.serie || ' ' || n.numero, n.cliente_id,
         coalesce(c.nombre_negocio, n.cliente_nombre),
         coalesce(nullif(btrim(concat_ws(' ', u.nombre, u.apellido)), ''), n.vendedor_nombre),
         n.fecha_emision, coalesce(n.fecha_vencimiento, n.fecha_emision), case when n.moneda = 'USD' then 'USD' else 'VES' end,
         n.total_usd, round(n.total_usd - n.abonado, 2),
         coalesce(n.clasificacion, gc.clasificacion, 'activa'),
         case when n.clasificacion is not null then 'nota' when gc.clasificacion is not null then 'cliente' end
    from ne n
    left join clientes c on c.id = n.cliente_id
    left join usuarios u on u.id = n.vendedor_id
    left join gcli gc on gc.cliente_id = n.cliente_id
   where abs(n.total_usd - n.abonado) > 0.009
$$;
comment on function public.partidas_cobranza(date, uuid[], boolean) is
  'Partidas abiertas al corte (22g): facturas, ND, NC a favor, anticipos de Odoo y de GUDS y notas de entrega, con su clasificación de cobranza. Mismo saldo y "qué falta" que el estado de cuenta. Interna';
revoke execute on function public.partidas_cobranza(date, uuid[], boolean) from public, anon, authenticated;

create or replace function public.reporte_antiguedad(p_corte date default null, p_ne boolean default true)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_hoy date := (now() at time zone 'America/Caracas')::date;
  v_corte date := least(coalesce(p_corte, (now() at time zone 'America/Caracas')::date), (now() at time zone 'America/Caracas')::date);
  v_emps uuid[] := public.empresas_visibles();
  v_ve_ne boolean := public.puede('notas_entrega', 'ver');
  v_ne boolean := coalesce(p_ne, true) and public.puede('notas_entrega', 'ver');
  v jsonb;
begin
  perform public.exigir_permiso_reportes_cuentas();
  with p as materialized (select * from public.partidas_cobranza(v_corte, v_emps, v_ne)),
  cli as (
    select c.id, c.nombre_negocio, c.rif, c.codigo, c.empresa_id,
           coalesce(nullif(btrim(concat_ws(' ', u.nombre, u.apellido)), ''), nullif(btrim(c.vendedor_odoo), '')) vendedor,
           coalesce(nullif(btrim(c.tipo_cliente), ''), ct.tipo) tipo,
           coalesce(nullif(btrim(c.segmento), ''), ct.categoria_cobranza) categoria,
           coalesce(nullif(btrim(c.canal), ''), ct.canal) canal,
           g.clasificacion, g.responsable, g.nota, g.desde,
           (select count(*) from cobranza_gestion x where x.cliente_id = c.id and x.factura_id is not null) excepciones,
           (select max(coalesce(e.enviado_at, e.creado_at))::date from estado_cuenta_envios e
             where e.cliente_id = c.id and e.estado <> 'error') ultimo_edc
      from clientes c
      left join usuarios u on u.id = c.vendedor_asignado_id
      left join clasificacion_clientes cc on cc.cliente_id = c.id
      left join clasificacion_tipos ct on ct.id = cc.tipo_id
      left join cobranza_gestion g on g.cliente_id = c.id and g.factura_id is null
     where c.id in (select distinct p.cliente_id from p where p.cliente_id is not null)
  )
  select jsonb_build_object(
    'hoy', v_hoy, 'corte', v_corte, 'ne', v_ne, 've_ne', v_ve_ne,
    'empresas', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'nombre', e.nombre_corto) order by e.nombre_corto)
                            from empresas e where e.id = any (v_emps)), '[]'::jsonb),
    'partidas', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                    't', p.tipo, 'k', p.clase, 'f', p.falta, 'e', p.empresa_id, 'id', p.documento_id, 'n', p.numero,
                    'c', p.cliente_id, 'cn', p.cliente_nombre, 'v', p.vendedor, 'em', p.emision, 've', p.vence, 'm', p.moneda,
                    'tot', p.total_usd, 's', p.saldo_usd, 'cl', p.clasificacion, 'co', p.clasificacion_origen))
                    order by p.cliente_id, p.emision, p.numero) from p), '[]'::jsonb),
    'clientes', coalesce((select jsonb_object_agg(c.id, jsonb_strip_nulls(jsonb_build_object(
                    'n', c.nombre_negocio, 'rif', c.rif, 'cod', c.codigo, 'e', c.empresa_id, 'v', c.vendedor, 'tipo', c.tipo,
                    'cat', c.categoria, 'canal', c.canal, 'cl', c.clasificacion, 'resp', c.responsable, 'nota', c.nota, 'desde', c.desde,
                    'ex', nullif(c.excepciones, 0), 'edc', c.ultimo_edc))) from cli c), '{}'::jsonb))
    into v;
  return v;
end $$;
comment on function public.reporte_antiguedad(date, boolean) is
  'Antigüedad de la deuda al corte (22g · R3): partidas abiertas (partidas_cobranza) y sus clientes, en JSON. Exige reportes y cuentas (D10); las notas de entrega, además, su módulo';
revoke execute on function public.reporte_antiguedad(date, boolean) from public, anon;
grant execute on function public.reporte_antiguedad(date, boolean) to authenticated;

commit;
