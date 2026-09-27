-- ════════════════════════════════════════════════════════════════════════
-- Fase 18b · Maestros espejo (docs/PLAN-ESPEJO-ODOO.md, Fase 3)
--   1. Proveedores (nuevo) y direcciones de entrega de clientes, espejo de Odoo
--   2. Productos: origen del precio (Odoo / GUDS), disponibilidad calculada y "oculto en la tienda" (decisión GUDS)
--   3. Protección de campos espejo: en registros que vienen de Odoo, los campos que manda Odoo no se editan ni se
--      borran desde GUDS (la sincronización los pisaría). Los campos propios de GUDS siguen editables.
-- ════════════════════════════════════════════════════════════════════════
begin;
set local session_replication_role = replica;

-- ── 1a. Proveedores ─────────────────────────────────────────────────────
create table if not exists public.proveedores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas(id) default public.empresa_activa_requerida(),  -- null = compartido
  odoo_id integer unique,
  codigo text not null,
  nombre text not null,
  rif text,
  email text,
  telefono text,
  celular text,
  direccion text,
  ciudad text,
  estado text,
  es_empresa boolean,
  tipo_residencia text,
  condicion_pago text,
  dias_credito integer default 0,
  sitio_web text,
  notas text,
  cliente_id uuid references public.clientes(id) on delete set null,   -- si también es cliente
  activo boolean not null default true,
  odoo_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists proveedores_empresa_idx on public.proveedores (empresa_id);
create unique index if not exists proveedores_empresa_codigo_key on public.proveedores (empresa_id, codigo) nulls not distinct;

-- ── 1b. Direcciones de entrega de clientes ─────────────────────────────
create table if not exists public.cliente_direcciones (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  empresa_id uuid references public.empresas(id),
  odoo_id integer unique,
  nombre text,
  direccion text,
  ciudad text,
  estado text,
  telefono text,
  activo boolean not null default true,
  odoo_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cliente_direcciones_cliente_idx on public.cliente_direcciones (cliente_id);
create index if not exists cliente_direcciones_empresa_idx on public.cliente_direcciones (empresa_id);

-- Reglas multiempresa (igual que 17b): herencia, guardia, validación de refs, RLS restrictiva
drop trigger if exists a_heredar_empresa on public.cliente_direcciones;
create trigger a_heredar_empresa before insert on public.cliente_direcciones
  for each row execute function public.trg_heredar_empresa('clientes', 'cliente_id');
do $$
declare t text;
begin
  foreach t in array array['proveedores', 'cliente_direcciones'] loop
    execute format('drop trigger if exists z_guardia_empresa on public.%I', t);
    execute format('create trigger z_guardia_empresa before insert or update or delete on public.%I for each row execute function public.trg_guardia_empresa()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists empresa_visible on public.%I', t);
    execute format('create policy empresa_visible on public.%I as restrictive for all to authenticated
      using (empresa_id is null or empresa_id = any ((select public.empresas_visibles())::uuid[]))', t);
    execute format('drop policy if exists empresa_visible_anon on public.%I', t);
    execute format('create policy empresa_visible_anon on public.%I as restrictive for all to anon using (false)', t);
  end loop;
end $$;
drop trigger if exists z_validar_refs_empresa on public.proveedores;
create trigger z_validar_refs_empresa before insert or update on public.proveedores
  for each row execute function public.trg_validar_refs_empresa('cliente_id:clientes');

-- Permisos por rol (módulo nuevo "compras"; clientes para las direcciones)
insert into public.modulos (codigo, nombre, descripcion, icono, orden, activo)
select 'compras', 'Compras', 'Proveedores, órdenes de compra y cuentas por pagar', 'Truck', 18, true
where not exists (select 1 from public.modulos where codigo = 'compras');

drop policy if exists proveedores_leer on public.proveedores;
create policy proveedores_leer on public.proveedores for select to authenticated using (public.puede('compras', 'ver'));
drop policy if exists proveedores_crear on public.proveedores;
create policy proveedores_crear on public.proveedores for insert to authenticated with check (public.puede('compras', 'crear'));
drop policy if exists proveedores_editar on public.proveedores;
create policy proveedores_editar on public.proveedores for update to authenticated using (public.puede('compras', 'editar'));
drop policy if exists proveedores_eliminar on public.proveedores;
create policy proveedores_eliminar on public.proveedores for delete to authenticated using (public.puede('compras', 'eliminar'));

drop policy if exists cliente_direcciones_leer on public.cliente_direcciones;
create policy cliente_direcciones_leer on public.cliente_direcciones for select to authenticated
  using (public.puede('clientes', 'ver') or cliente_id in (select cliente_id from public.usuarios where auth_id = auth.uid())
         or public.es_vendedor_de(cliente_id));
drop policy if exists cliente_direcciones_escribir on public.cliente_direcciones;
create policy cliente_direcciones_escribir on public.cliente_direcciones for all to authenticated
  using (public.puede('clientes', 'editar')) with check (public.puede('clientes', 'editar'));

drop trigger if exists update_proveedores_updated_at on public.proveedores;
create trigger update_proveedores_updated_at before update on public.proveedores for each row execute function public.update_updated_at();
drop trigger if exists update_cliente_direcciones_updated_at on public.cliente_direcciones;
create trigger update_cliente_direcciones_updated_at before update on public.cliente_direcciones for each row execute function public.update_updated_at();

-- ── 2. Productos: precio y disponibilidad ──────────────────────────────
alter table public.productos
  add column if not exists precio_origen text not null default 'guds' check (precio_origen in ('odoo', 'guds')),
  add column if not exists disponible boolean,            -- vendible en Odoo, físico y con precio
  add column if not exists oculto_tienda boolean not null default false;   -- decisión de GUDS
update public.productos set precio_origen = 'odoo' where odoo_id is not null and precio_base > 0;
update public.productos set disponible = coalesce(vendible, false) and coalesce(tipo_odoo, 'consu') <> 'service' and precio_base > 0
  where odoo_id is not null;

-- En productos de Odoo, "activo" (visible en el catálogo) = disponible y no oculto por GUDS. Si un usuario cambia
-- "activo" desde las pantallas, se traduce a oculto_tienda. El precio solo se edita si no vino de Odoo.
create or replace function public.trg_producto_espejo()
returns trigger language plpgsql as $$
declare v_rol text;
begin
  if new.odoo_id is null then return new; end if;
  v_rol := coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '');
  if v_rol = 'authenticated' then
    if new.precio_base is distinct from old.precio_base and old.precio_origen = 'odoo' then
      raise exception 'El precio de este producto viene de Odoo (último precio de venta) y se actualiza desde Odoo.' using errcode = 'P0001';
    end if;
    if new.activo is distinct from old.activo then
      if new.activo and not coalesce(old.disponible, false) and not (new.precio_base > 0 and old.precio_origen = 'guds') then
        raise exception 'No se puede activar: en Odoo este producto no está a la venta o no tiene precio.' using errcode = 'P0001';
      end if;
      new.oculto_tienda := not new.activo;
    end if;
  end if;
  new.disponible := coalesce(new.vendible, false) and coalesce(new.tipo_odoo, 'consu') <> 'service' and new.precio_base > 0;
  new.activo := new.disponible and not new.oculto_tienda;
  return new;
end $$;
drop trigger if exists b_producto_espejo on public.productos;
create trigger b_producto_espejo before update on public.productos for each row execute function public.trg_producto_espejo();

-- ── 3. Protección de campos espejo ─────────────────────────────────────
-- Argumentos: nombres de columna; "col|condicion" protege col solo si old.condicion no es nulo.
create or replace function public.trg_proteger_espejo_odoo()
returns trigger language plpgsql as $$
declare v_rol text; i int; v_col text; v_cond text;
begin
  v_rol := coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '');
  if v_rol <> 'authenticated' then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if old.odoo_id is not null then
      raise exception 'Este registro viene de Odoo: se elimina o se anula en Odoo.' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if old.odoo_id is null then return new; end if;
  for i in 0 .. tg_nargs - 1 loop
    v_col := split_part(tg_argv[i], '|', 1);
    v_cond := nullif(split_part(tg_argv[i], '|', 2), '');
    continue when v_cond is not null and (to_jsonb(old) -> v_cond) in ('null'::jsonb) ;
    continue when v_cond is not null and (to_jsonb(old) -> v_cond) is null;
    if (to_jsonb(new) -> v_col) is distinct from (to_jsonb(old) -> v_col) then
      raise exception 'El dato "%" viene de Odoo y se edita en Odoo.', v_col using errcode = 'P0001';
    end if;
  end loop;
  return new;
end $$;

do $$
declare r record;
begin
  for r in select * from (values
    ('productos', array['sku', 'nombre', 'categoria_id', 'unidad', 'empresa_id', 'tipo_odoo', 'vendible']),
    ('clientes', array['codigo', 'nombre_negocio', 'rif', 'cedula', 'email', 'telefono', 'celular', 'direccion', 'ciudad', 'estado',
      'latitud', 'longitud', 'es_empresa', 'tipo_negocio', 'tipo_residencia', 'vendedor_odoo', 'condicion_pago', 'dias_credito',
      'limite_credito', 'licencia_actividad', 'sitio_web', 'notas', 'fecha_registro_odoo', 'activo', 'empresa_id',
      'vendedor_asignado_id|vendedor_odoo']),
    ('proveedores', array['codigo', 'nombre', 'rif', 'email', 'telefono', 'celular', 'direccion', 'ciudad', 'estado', 'es_empresa',
      'tipo_residencia', 'condicion_pago', 'dias_credito', 'sitio_web', 'notas', 'activo', 'empresa_id']),
    ('cliente_direcciones', array['cliente_id', 'nombre', 'direccion', 'ciudad', 'estado', 'telefono', 'activo', 'empresa_id']),
    ('bancos', array['nombre', 'moneda', 'tipo_odoo', 'activo', 'empresa_id']),
    ('categorias', array['nombre']),
    ('almacenes', array['nombre', 'codigo', 'tipo', 'activo', 'empresa_id']),
    ('ordenes', array['numero', 'cliente_id', 'subtotal', 'impuesto', 'total', 'estado', 'estado_odoo', 'moneda_original',
      'fecha_pedido', 'vendedor_odoo', 'empresa_id']),
    ('orden_items', array['orden_id', 'producto_id', 'nombre_producto', 'cantidad', 'precio_unitario', 'descuento', 'subtotal']),
    ('facturas', array['numero', 'tipo', 'es_nota_debito', 'cliente_id', 'orden_id', 'fecha_emision', 'fecha_vencimiento', 'moneda',
      'tasa_cambio', 'subtotal', 'impuesto', 'total', 'monto_pagado', 'saldo_pendiente', 'total_usd', 'saldo_odoo_usd',
      'estado_pago', 'estado', 'referencia', 'nro_control', 'empresa_id']),
    ('factura_items', array['factura_id', 'producto_id', 'nombre_producto', 'cantidad', 'precio_unitario', 'descuento', 'subtotal', 'total']),
    ('pagos', array['numero', 'cliente_id', 'banco_id', 'monto', 'monto_moneda', 'moneda', 'estado', 'estado_odoo', 'referencia',
      'es_igtf', 'fecha_verificacion', 'empresa_id']),
    ('retenciones', array['numero', 'numero_comprobante', 'tipo', 'cliente_id', 'porcentaje', 'base_imponible', 'total', 'fecha',
      'estado', 'empresa_id']),
    ('retencion_items', array['retencion_id', 'factura_id', 'monto_aplicado'])
  ) as t(tabla, cols) loop
    execute format('drop trigger if exists c_proteger_espejo_odoo on public.%I', r.tabla);
    execute format('create trigger c_proteger_espejo_odoo before update or delete on public.%I for each row execute function public.trg_proteger_espejo_odoo(%s)',
      r.tabla, (select string_agg(quote_literal(x), ', ') from unnest(r.cols) x));
  end loop;
end $$;

-- ── 4. Delivery: en órdenes de Odoo el estado lo manda Odoo; la entrega queda en "entregas" ──
CREATE OR REPLACE FUNCTION public.actualizar_estado_entrega(p_entrega_id uuid, p_estado entrega_estado, p_receptor text DEFAULT NULL::text, p_notas text DEFAULT NULL::text, p_motivo text DEFAULT NULL::text, p_firma_url text DEFAULT NULL::text, p_foto_url text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_ent record; v_mine boolean;
begin
  select * into v_ent from entregas where id = p_entrega_id;
  if not found then raise exception 'Entrega no encontrada'; end if;

  v_mine := exists (select 1 from usuarios where id = v_ent.repartidor_id and auth_id = auth.uid());
  if not (v_mine or public.is_admin()) then
    raise exception 'No autorizado para actualizar esta entrega';
  end if;

  update entregas set
    estado = p_estado,
    fecha_inicio_entrega = case when p_estado = 'en_camino' then coalesce(fecha_inicio_entrega, now()) else fecha_inicio_entrega end,
    fecha_entrega = case when p_estado = 'entregada' then now() else fecha_entrega end,
    receptor_nombre = coalesce(p_receptor, receptor_nombre),
    notas = coalesce(p_notas, notas),
    motivo_fallo = case when p_estado = 'fallida' then p_motivo else motivo_fallo end,
    firma_url = coalesce(p_firma_url, firma_url),
    foto_entrega_url = coalesce(p_foto_url, foto_entrega_url),
    updated_at = now()
  where id = p_entrega_id;

  if p_estado = 'en_camino' then
    update ordenes set estado = 'enviado' where id = v_ent.orden_id and odoo_id is null and estado in ('pendiente','confirmado','procesando');
  elsif p_estado = 'entregada' then
    update ordenes set estado = case when odoo_id is null then 'completado'::orden_estado else estado end, fecha_entrega_real = now() where id = v_ent.orden_id;
  end if;
end;
$function$;

commit;
