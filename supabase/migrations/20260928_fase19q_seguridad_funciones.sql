-- ════════════════════════════════════════════════════════════════════════
-- Fase 19q · Seguridad de funciones del servidor (auditoría 28-sep)
--   Causa de fondo: varias migraciones hicieron "revoke ... from public" creyendo que cerraban la función, pero Supabase
--   concede EXECUTE directamente a anon y authenticated (privilegios por defecto), así que seguían abiertas a cualquiera
--   con la llave pública del frontend, incluso sin sesión.
--   Hallazgos críticos:
--     · aprobar_registro_cliente no validaba quién la llamaba: cualquiera podía aprobar un registro pendiente (incluido el
--       suyo, hecho en el formulario público) y recibir la contraseña temporal → acceso al portal de clientes.
--     · crear_auth_user (sin validación): cualquiera podía crear cuentas de acceso confirmadas con cualquier correo.
--     · aplicar_pago_a_facturas (interna): cualquiera podía aplicar un pago a facturas del mismo cliente.
--     · notif_* (internas): cualquiera podía crear notificaciones con texto y enlace arbitrarios para administradores,
--       vendedores o clientes (suplantación / phishing dentro de la plataforma).
--   Correcciones:
--     1. aprobar_registro_cliente exige personal de administración con permiso de crear clientes; el aprobador es quien
--        llama (se ignora p_admin_id, que se conserva por compatibilidad).
--     2. Funciones internas (solo las usan otras funciones o triggers con permisos de dueño): sin EXECUTE para nadie.
--     3. Acciones de negocio (RPC del frontend, que ya exigen sesión): sin EXECUTE para anon.
--     4. Privilegios por defecto: las funciones nuevas de public ya no quedan ejecutables por anon ni PUBLIC
--        (authenticated las conserva; lo que deba usar anon se concede explícitamente).
--   Se mantienen para anon las funciones auxiliares que usan las políticas RLS (empresa_solicitada, clientes_del_usuario,
--   is_admin, puede, etc.), que solo leen y dependen de auth.uid().
-- ════════════════════════════════════════════════════════════════════════
begin;

create or replace function public.aprobar_registro_cliente(p_registro_id uuid, p_admin_id uuid default null, p_lista_precios_id uuid default null,
  p_vendedor_id uuid default null, p_limite_credito numeric default 0, p_dias_credito integer default 0)
returns table(cliente_id uuid, email text, password_temporal text)
language plpgsql security definer set search_path = public as $$
declare
  v_registro RECORD;
  v_cliente_id uuid;
  v_codigo text;
  v_lista_id uuid;
  v_auth_id uuid;
  v_pass text;
  v_admin uuid;
begin
  if not (public.es_personal_admin() and public.puede('clientes', 'crear')) then
    raise exception 'No tienes permiso para aprobar registros de clientes' using errcode = '42501';
  end if;

  select * into v_registro from registros_clientes where id = p_registro_id for update;
  if v_registro is null then raise exception 'Registro no encontrado'; end if;
  if v_registro.estado <> 'pendiente' then raise exception 'El registro ya fue procesado'; end if;

  -- El aprobador es siempre quien llama (p_admin_id se ignora: no se puede aprobar en nombre de otro)
  v_admin := (select id from usuarios where auth_id = auth.uid());

  if p_lista_precios_id is null then
    select id into v_lista_id from listas_precios where es_default = true limit 1;
  else
    v_lista_id := p_lista_precios_id;
  end if;

  v_codigo := generar_codigo_cliente();

  insert into clientes (
    codigo, nombre_negocio, tipo_negocio, rif, email, telefono,
    direccion, direccion_entrega, ciudad, contribuyente_especial,
    lista_precios_id, vendedor_asignado_id,
    limite_credito, dias_credito, registro_origen_id, empresa_id
  ) values (
    v_codigo, v_registro.nombre_negocio, v_registro.tipo_negocio,
    v_registro.rif, v_registro.email, v_registro.telefono,
    v_registro.direccion, v_registro.direccion_entrega, v_registro.ciudad,
    v_registro.contribuyente_especial, v_lista_id, p_vendedor_id,
    p_limite_credito, p_dias_credito, p_registro_id, coalesce(v_registro.empresa_id, public.empresa_activa_requerida())
  ) returning id into v_cliente_id;

  v_pass := generar_password_temporal();
  v_auth_id := public.crear_auth_user(v_registro.email, v_pass);

  insert into usuarios (auth_id, email, nombre, apellido, telefono, role, cliente_id, activo, debe_cambiar_clave)
  values (v_auth_id, v_registro.email, v_registro.nombre_contacto, v_registro.apellido_contacto,
          v_registro.telefono, 'cliente', v_cliente_id, true, true);

  update registros_clientes set
    estado = 'aprobado', revisado_por = v_admin, fecha_revision = now(), cliente_creado_id = v_cliente_id
  where id = p_registro_id;

  return query select v_cliente_id, v_registro.email::text, v_pass;
end $$;

do $$
declare
  f regprocedure;
  internas text[] := array['crear_auth_user', 'aplicar_pago_a_facturas', 'notif_admins', 'notif_cliente', 'notif_crear', 'notif_vendedor',
    'recalcular_comprometido_guds', 'recalcular_credito', 'liquidar_orden', 'generar_numero_orden', 'generar_numero_pago',
    'validar_stock_pedido', 'validar_credito', 'generar_password_temporal', 'siguiente_numero'];
  acciones text[] := array['actualizar_estado_entrega', 'aplicar_anticipo', 'aplicar_sugerencia_ia', 'aprobar_registro_cliente', 'asignar_entrega',
    'cambiar_acceso_cliente', 'cerrar_mi_cuenta', 'conciliar_extracto_automatico', 'confirmar_match_extracto', 'crear_acceso_contacto',
    'crear_extracto_bancario', 'crear_orden_admin', 'crear_orden_desde_carrito', 'crear_orden_vendedor', 'crear_usuario_admin',
    'credito_disponible', 'declarar_retencion', 'declarar_venta_consignacion', 'descartar_linea_extracto', 'facturar_orden',
    'generar_codigo_cliente', 'marcar_clave_cambiada', 'mis_permisos', 'precio_efectivo', 'puede_gestionar_cliente',
    'registrar_cobro_facturas', 'registrar_pago', 'registrar_pago_vendedor', 'restablecer_clave_cliente',
    'revisar_declaracion_consignacion', 'revisar_retencion', 'verificar_pago', 'buscar_global', 'aprobar_pedido', 'rechazar_pedido',
    'reintentar_envio_pedido', 'solicitar_sync_odoo', 'estado_sync_odoo', 'reporte_ventas', 'reporte_cobranza', 'reporte_inventario',
    'reporte_reversos'];
begin
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any(internas) loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any(acciones) loop
    execute format('revoke execute on function %s from public, anon', f);
  end loop;
end $$;

alter default privileges for role postgres in schema public revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon;

notify pgrst, 'reload schema';

commit;
