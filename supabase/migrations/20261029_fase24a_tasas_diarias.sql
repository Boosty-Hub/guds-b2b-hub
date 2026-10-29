-- ============================================================================
-- FASE 24a: Tasas diarias (BCV dólar y euro, dólar paralelo y brecha)
--   Igual que el módulo de tasas de BoostyDesk (pedido del usuario, 29-oct-2026).
--   - tasas_diarias: una fila por día. fecha = fecha valor del BCV: en la tarde el BCV publica la del día hábil
--     siguiente, así que la carga de las 17:00 del viernes llena la fila del lunes. El paralelo se registra en el día
--     en que se consulta. La brecha es cuánto más caro está el paralelo que el BCV dólar, en %.
--   - Las registra la Edge Function actualizar-tasa-bcv a las 8:00 y a las 17:00 de Caracas (BCV desde bcv.org.ve con
--     respaldo en DolarApi; paralelo desde DolarApi) y se pueden corregir a mano (una corrección no la pisa la carga).
--   - tasa_del_dia(fecha): la vigente a esa fecha, más la del próximo día hábil si el BCV ya la publicó. La lee el
--     encabezado y la pantalla /admin/tasas.
--   - La tasa canónica de cobros, retenciones y estados de cuenta sigue siendo configuracion.tasa_cambio + tasa_bcv
--     (upsert_tasa_bcv). La Edge Function la sigue actualizando, ahora solo con la tasa ya vigente (fecha valor ≤ hoy):
--     la publicada por adelantado para el día hábil siguiente ya no entra antes de tiempo.
-- ============================================================================
begin;

create table if not exists public.tasas_diarias (
  fecha date primary key,
  bcv_usd numeric(16,6) check (bcv_usd > 0),
  bcv_eur numeric(16,6) check (bcv_eur > 0),
  paralelo_usd numeric(16,6) check (paralelo_usd > 0),
  brecha_pct numeric(8,2) generated always as (
    case when bcv_usd > 0 and paralelo_usd > 0 then round((paralelo_usd / bcv_usd - 1) * 100, 2) end
  ) stored,
  fuente_bcv text,
  fuente_paralelo text,
  editada_manual boolean not null default false,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid
);
comment on table public.tasas_diarias is 'Fase 24a: tasas por día (fecha valor del BCV): BCV dólar y euro, dólar paralelo y brecha';

-- Las tasas son públicas: las lee cualquier usuario con sesión (como tasa_bcv). Se escriben solo por las funciones.
alter table public.tasas_diarias enable row level security;
drop policy if exists tasas_diarias_leer on public.tasas_diarias;
create policy tasas_diarias_leer on public.tasas_diarias for select to authenticated using (true);
revoke all on public.tasas_diarias from anon, authenticated;
grant select on public.tasas_diarias to authenticated;

-- Carga automática (solo la Edge Function, con la clave de servicio). Solo escribe lo que trae y no toca una fila
-- corregida a mano.
create or replace function public.registrar_tasas_automaticas(
  p_fecha date, p_bcv_usd numeric default null, p_bcv_eur numeric default null, p_paralelo_usd numeric default null,
  p_fuente_bcv text default null, p_fuente_paralelo text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.tasas_diarias as t (fecha, bcv_usd, bcv_eur, paralelo_usd, fuente_bcv, fuente_paralelo)
  values (p_fecha, p_bcv_usd, p_bcv_eur, p_paralelo_usd,
          case when p_bcv_usd is not null or p_bcv_eur is not null then p_fuente_bcv end,
          case when p_paralelo_usd is not null then p_fuente_paralelo end)
  on conflict (fecha) do update set
    bcv_usd = coalesce(excluded.bcv_usd, t.bcv_usd),
    bcv_eur = coalesce(excluded.bcv_eur, t.bcv_eur),
    paralelo_usd = coalesce(excluded.paralelo_usd, t.paralelo_usd),
    fuente_bcv = coalesce(excluded.fuente_bcv, t.fuente_bcv),
    fuente_paralelo = coalesce(excluded.fuente_paralelo, t.fuente_paralelo),
    actualizado_en = now()
  where not t.editada_manual;
end;
$$;
revoke all on function public.registrar_tasas_automaticas(date, numeric, numeric, numeric, text, text) from public, anon, authenticated;
grant execute on function public.registrar_tasas_automaticas(date, numeric, numeric, numeric, text, text) to service_role;

-- Corrección manual de un día: personal administrativo con permiso de editar Configuración, Cuentas o Bancos.
-- Si se corrige el BCV dólar de hoy, también la tasa canónica: configuracion.tasa_cambio y la fila de hoy en tasa_bcv
-- (se corrige la que haya; tasa_bcv_dia toma la primera del día, así que una fila nueva no mandaría).
create or replace function public.guardar_tasa_diaria(
  p_fecha date, p_bcv_usd numeric, p_bcv_eur numeric, p_paralelo_usd numeric
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_hoy date := (now() at time zone 'America/Caracas')::date;
  v_antes numeric;
begin
  if auth.uid() is null or not ((select public.es_personal_admin())
       and ((select public.puede('configuracion', 'editar')) or (select public.puede('cuentas', 'editar'))
            or (select public.puede('bancos', 'editar')))) then
    raise exception 'No tienes permiso para editar las tasas' using errcode = '42501';
  end if;
  if p_fecha is null then raise exception 'Indica la fecha'; end if;
  if p_fecha > v_hoy + 7 then raise exception 'La fecha no puede ser de más de una semana adelante'; end if;
  if coalesce(p_bcv_usd, 1) <= 0 or coalesce(p_bcv_eur, 1) <= 0 or coalesce(p_paralelo_usd, 1) <= 0 then
    raise exception 'Las tasas deben ser mayores que cero';
  end if;
  if p_bcv_usd is null and p_bcv_eur is null and p_paralelo_usd is null then
    raise exception 'Escribe al menos una tasa';
  end if;

  select bcv_usd into v_antes from tasas_diarias where fecha = p_fecha;

  insert into public.tasas_diarias (fecha, bcv_usd, bcv_eur, paralelo_usd, fuente_bcv, fuente_paralelo, editada_manual, actualizado_por)
  values (p_fecha, p_bcv_usd, p_bcv_eur, p_paralelo_usd, 'manual', 'manual', true, auth.uid())
  on conflict (fecha) do update set
    -- Lo que se deja en blanco conserva el valor que había
    bcv_usd = coalesce(excluded.bcv_usd, tasas_diarias.bcv_usd),
    bcv_eur = coalesce(excluded.bcv_eur, tasas_diarias.bcv_eur),
    paralelo_usd = coalesce(excluded.paralelo_usd, tasas_diarias.paralelo_usd),
    fuente_bcv = case when coalesce(excluded.bcv_usd, tasas_diarias.bcv_usd) is distinct from tasas_diarias.bcv_usd
                        or coalesce(excluded.bcv_eur, tasas_diarias.bcv_eur) is distinct from tasas_diarias.bcv_eur
                      then 'manual' else tasas_diarias.fuente_bcv end,
    fuente_paralelo = case when coalesce(excluded.paralelo_usd, tasas_diarias.paralelo_usd) is distinct from tasas_diarias.paralelo_usd
                           then 'manual' else tasas_diarias.fuente_paralelo end,
    editada_manual = true, actualizado_por = auth.uid(), actualizado_en = now();

  if p_fecha = v_hoy and p_bcv_usd is not null and p_bcv_usd is distinct from v_antes then
    update public.tasa_bcv set tasa = p_bcv_usd, fuente = 'manual (tasas)' where fecha = v_hoy;
    if found then
      update public.configuracion set valor = p_bcv_usd::text, updated_at = now() where clave = 'tasa_cambio';
      update public.configuracion set valor = now()::text, updated_at = now() where clave = 'tasa_cambio_actualizada';
      update public.configuracion set valor = 'manual (tasas)', updated_at = now() where clave = 'tasa_cambio_fuente';
    else
      perform public.upsert_tasa_bcv(p_bcv_usd, 'manual (tasas)');
    end if;
  end if;
end;
$$;
revoke all on function public.guardar_tasa_diaria(date, numeric, numeric, numeric) from public, anon;
grant execute on function public.guardar_tasa_diaria(date, numeric, numeric, numeric) to authenticated;

-- Tasas vigentes a una fecha (por defecto hoy en Caracas). Cada tasa se toma de su última fecha valor ≤ fecha; la
-- brecha se calcula con esas dos. «proxima_*»: la del día hábil siguiente, si el BCV ya la publicó.
create or replace function public.tasa_del_dia(p_fecha date default null)
returns jsonb language sql stable security invoker set search_path = public as $$
  with d as (select coalesce(p_fecha, (now() at time zone 'America/Caracas')::date) as hoy),
  bcv as (select t.fecha, t.bcv_usd, t.bcv_eur, t.fuente_bcv from tasas_diarias t, d
           where t.fecha <= d.hoy and t.bcv_usd is not null order by t.fecha desc limit 1),
  par as (select t.fecha, t.paralelo_usd from tasas_diarias t, d
           where t.fecha <= d.hoy and t.paralelo_usd is not null order by t.fecha desc limit 1),
  prox as (select t.fecha, t.bcv_usd, t.bcv_eur from tasas_diarias t, d
            where t.fecha > d.hoy and t.bcv_usd is not null order by t.fecha asc limit 1)
  select jsonb_build_object(
    'fecha', (select hoy from d),
    'bcv_usd', (select bcv_usd from bcv), 'bcv_eur', (select bcv_eur from bcv),
    'fecha_bcv', (select fecha from bcv), 'fuente_bcv', (select fuente_bcv from bcv),
    'paralelo_usd', (select paralelo_usd from par), 'fecha_paralelo', (select fecha from par),
    'brecha_pct', (select round(((select paralelo_usd from par) / bcv_usd - 1) * 100, 2) from bcv),
    'proxima_fecha', (select fecha from prox), 'proxima_bcv_usd', (select bcv_usd from prox),
    'proxima_bcv_eur', (select bcv_eur from prox)
  );
$$;
revoke all on function public.tasa_del_dia(date) from public, anon;
grant execute on function public.tasa_del_dia(date) to authenticated;

-- 8:00 (ya existía) y 17:00 de Caracas (UTC-4, sin horario de verano). Misma llamada que la de las 8:00.
do $$
begin
  perform cron.unschedule('actualizar-tasa-bcv-tarde');
exception when others then null;
end $$;

select cron.schedule(
  'actualizar-tasa-bcv-tarde',
  '0 21 * * *',
  $cron$
    select net.http_post(
      url     := 'https://oyyxkbwtyxdpzsgarmim.supabase.co/functions/v1/actualizar-tasa-bcv',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', 'sb_publishable_J8477Ia3F9Ro3S7NQQlwrw_BDOYElbV'
      ),
      body    := '{}'::jsonb
    );
  $cron$
);

commit;
