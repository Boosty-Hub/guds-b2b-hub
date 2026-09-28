-- ════════════════════════════════════════════════════════════════════════
-- Fase 19u · Cola de escrituras GUDS → Odoo (decisiones del dueño, 28-sep)
--   Lo único que GUDS escribe en Odoo (además de crear los pedidos aprobados, Fase 9b):
--     · entrega_estado: el estado de un documento de entrega de Odoo que tiene repartidor asignado en GUDS
--       (entregado completo / incompleto → se valida en Odoo con las cantidades entregadas).
--     · cliente_contacto / cliente_direccion: dirección y teléfonos de un cliente editados en GUDS.
--   Cada escritura queda registrada (quién la pidió, qué datos, resultado de Odoo) y la hace la función edge sync-odoo
--   (?escritura=<id>, disparada por pg_net; cada sincronización reintenta las pendientes). Modo por tipo en configuracion:
--   'simular' (lee Odoo y calcula sin escribir) o 'activo'. Las entregas arrancan en 'simular' hasta un piloto acordado.
--   Nunca se borra nada en Odoo (el cliente odoo.js no tiene unlink).
-- ════════════════════════════════════════════════════════════════════════
begin;

create table if not exists public.odoo_escrituras (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas(id),
  tipo text not null check (tipo in ('entrega_estado', 'cliente_contacto', 'cliente_direccion')),
  referencia_id uuid not null,
  datos jsonb not null default '{}'::jsonb,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'procesando', 'simulada', 'hecha', 'error')),
  intentos integer not null default 0,
  error text,
  resultado jsonb,
  solicitado_por uuid references public.usuarios(id),
  created_at timestamptz not null default now(),
  procesado_at timestamptz
);
create index if not exists odoo_escrituras_pendientes on public.odoo_escrituras (estado, created_at) where estado in ('pendiente', 'error');
create index if not exists odoo_escrituras_referencia on public.odoo_escrituras (tipo, referencia_id, created_at desc);
comment on table public.odoo_escrituras is 'Registro y cola de lo que GUDS escribe en Odoo (estado de entregas, contacto y direcciones de clientes)';

alter table public.odoo_escrituras enable row level security;
drop policy if exists odoo_escrituras_admin_read on public.odoo_escrituras;
create policy odoo_escrituras_admin_read on public.odoo_escrituras for select to authenticated using ((select public.es_personal_admin()));
drop policy if exists empresa_visible on public.odoo_escrituras;
create policy empresa_visible on public.odoo_escrituras as restrictive for all to authenticated
  using (empresa_id is null or empresa_id = any ((select public.empresas_visibles())::uuid[]));
revoke all on public.odoo_escrituras from anon;
revoke insert, update, delete on public.odoo_escrituras from authenticated;

insert into public.configuracion (clave, valor) values ('odoo_escritura_entregas', 'simular'), ('odoo_escritura_clientes', 'simular')
on conflict (clave) do nothing;

-- Dispara la escritura en la función edge (secreto en Vault)
create or replace function public.disparar_escritura_odoo(p_id uuid)
returns bigint language sql security definer set search_path = public as $$
  select net.http_post(
    url := 'https://oyyxkbwtyxdpzsgarmim.supabase.co/functions/v1/sync-odoo?escritura=' || p_id::text,
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_odoo_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000);
$$;
revoke execute on function public.disparar_escritura_odoo(uuid) from public, anon, authenticated;

-- Encola y dispara. Solo la usan otras funciones (que ya validaron permisos); nadie la ejecuta por REST.
create or replace function public.encolar_escritura_odoo(p_tipo text, p_referencia uuid, p_datos jsonb, p_empresa uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into odoo_escrituras (empresa_id, tipo, referencia_id, datos, solicitado_por)
  values (p_empresa, p_tipo, p_referencia, coalesce(p_datos, '{}'::jsonb), (select id from usuarios where auth_id = auth.uid()))
  returning id into v_id;
  perform public.disparar_escritura_odoo(v_id);
  return v_id;
end $$;
revoke execute on function public.encolar_escritura_odoo(text, uuid, jsonb, uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
