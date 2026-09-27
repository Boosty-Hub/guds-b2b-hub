-- ════════════════════════════════════════════════════════════════════════
-- Fase 19c · Estado de la sincronización con Odoo en la interfaz
--   estado_sync_odoo(): última corrida aplicada (ok/error), si hay una en curso y cuándo fue la última correcta.
--   solicitar_sync_odoo(): dispara la función edge (pg_net + secreto en Vault) — solo administración; si ya hay una
--   corrida en curso, la función edge no arranca otra.
-- ════════════════════════════════════════════════════════════════════════
begin;

create or replace function public.estado_sync_odoo()
returns table(ultima_ok timestamptz, ultima_estado text, ultima_error text, ultima_inicio timestamptz, en_curso boolean, segundos integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not ((select public.puede('configuracion', 'ver')) or (select public.puede('dashboard', 'ver'))) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  return query
  select (select max(c.terminado_en) from sync_corridas c where c.modo = 'completo' and c.estado = 'ok'),
         u.estado, u.error, u.iniciado_en,
         exists (select 1 from sync_corridas c where c.modo = 'completo' and c.estado = 'en_curso' and c.iniciado_en > now() - interval '10 minutes'),
         (u.resumen->>'segundos')::int
  from (select c.* from sync_corridas c where c.modo = 'completo' order by c.iniciado_en desc limit 1) u;
end $$;

create or replace function public.solicitar_sync_odoo() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
begin
  if not (select public.puede('configuracion', 'editar')) then
    raise exception 'Solo administración puede sincronizar con Odoo' using errcode = '42501';
  end if;
  if exists (select 1 from sync_corridas where modo = 'completo' and estado = 'en_curso' and iniciado_en > now() - interval '10 minutes') then
    return jsonb_build_object('ok', false, 'mensaje', 'Ya hay una sincronización en curso');
  end if;
  perform public.disparar_sync_odoo();
  return jsonb_build_object('ok', true, 'mensaje', 'Sincronización solicitada; tarda alrededor de un minuto');
end $$;

grant execute on function public.estado_sync_odoo() to authenticated;
grant execute on function public.solicitar_sync_odoo() to authenticated;
revoke execute on function public.estado_sync_odoo() from anon;
revoke execute on function public.solicitar_sync_odoo() from anon;
commit;
