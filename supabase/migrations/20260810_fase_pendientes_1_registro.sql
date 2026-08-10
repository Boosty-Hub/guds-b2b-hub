-- Pendientes de lanzamiento — Fase 1 (registro de clientes)
-- Items: 3 (contribuyente especial), 5 (persona de contacto en un solo campo,
-- apellido pasa a ser opcional), 6 (dirección fiscal + dirección de entrega).
-- Los items 1 y 4 (validación de RIF/teléfono, "Razón Social") son solo de
-- frontend y no requieren cambios de esquema.
begin;

alter table public.registros_clientes
  add column if not exists contribuyente_especial boolean not null default false,
  add column if not exists direccion_entrega text;

alter table public.registros_clientes
  alter column apellido_contacto drop not null;

alter table public.clientes
  add column if not exists contribuyente_especial boolean not null default false,
  add column if not exists direccion_entrega text;

alter table public.usuarios
  alter column apellido drop not null;

-- Arrastra los campos nuevos de la solicitud al cliente aprobado y ya no exige
-- apellido_contacto (el formulario ahora captura "Persona de Contacto" en un
-- solo campo, que sigue viajando en nombre_contacto).
create or replace function public.aprobar_registro_cliente(
  p_registro_id uuid,
  p_admin_id uuid default null,
  p_lista_precios_id uuid default null,
  p_vendedor_id uuid default null,
  p_limite_credito numeric default 0,
  p_dias_credito integer default 0
)
returns table(cliente_id uuid, email text, password_temporal text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_registro RECORD;
  v_cliente_id uuid;
  v_codigo text;
  v_lista_id uuid;
  v_auth_id uuid;
  v_pass text;
  v_admin uuid;
begin
  select * into v_registro from registros_clientes where id = p_registro_id;
  if v_registro is null then raise exception 'Registro no encontrado'; end if;
  if v_registro.estado <> 'pendiente' then raise exception 'El registro ya fue procesado'; end if;

  v_admin := coalesce(p_admin_id, (select id from usuarios where auth_id = auth.uid()));

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
    limite_credito, dias_credito, registro_origen_id
  ) values (
    v_codigo, v_registro.nombre_negocio, v_registro.tipo_negocio,
    v_registro.rif, v_registro.email, v_registro.telefono,
    v_registro.direccion, v_registro.direccion_entrega, v_registro.ciudad,
    v_registro.contribuyente_especial, v_lista_id, p_vendedor_id,
    p_limite_credito, p_dias_credito, p_registro_id
  ) returning id into v_cliente_id;

  v_pass := generar_password_temporal();
  v_auth_id := public.crear_auth_user(v_registro.email, v_pass);

  insert into usuarios (auth_id, email, nombre, apellido, telefono, role, cliente_id, activo)
  values (v_auth_id, v_registro.email, v_registro.nombre_contacto, v_registro.apellido_contacto,
          v_registro.telefono, 'cliente', v_cliente_id, true);

  update registros_clientes set
    estado = 'aprobado', revisado_por = v_admin, fecha_revision = now(), cliente_creado_id = v_cliente_id
  where id = p_registro_id;

  return query select v_cliente_id, v_registro.email::text, v_pass;
end;
$function$;

commit;
