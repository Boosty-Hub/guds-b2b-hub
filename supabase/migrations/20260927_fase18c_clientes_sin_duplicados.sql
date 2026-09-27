-- ════════════════════════════════════════════════════════════════════════
-- Fase 18c · Clientes sin duplicados por RIF ni por nombre (decisión 3, 2026-09-27)
--   Aplica a cualquier alta o edición hecha por un usuario (alta manual, aprobación de registros, tienda),
--   dentro de la misma empresa o contra clientes compartidos. El RIF y el nombre se comparan normalizados:
--   "J-12345678-9" = "J123456789"; "FARMATODO, C.A." = "Farmatodo CA".
-- ════════════════════════════════════════════════════════════════════════
begin;

create or replace function public.normalizar_rif(t text)
returns text language sql immutable as $$
  select nullif(regexp_replace(upper(coalesce(t, '')), '[^A-Z0-9]', '', 'g'), '');
$$;

-- Mayúsculas, sin acentos ni signos, sin sufijos societarios al final (C.A., S.A., S.R.L., COMPAÑÍA ANÓNIMA…)
create or replace function public.normalizar_nombre_empresa(t text)
returns text language plpgsql immutable as $$
declare v text; tokens text[]; n int;
begin
  v := upper(translate(coalesce(t, ''), 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'));
  tokens := regexp_split_to_array(trim(regexp_replace(v, '[^A-Z0-9]+', ' ', 'g')), ' ');
  loop
    n := array_length(tokens, 1);
    exit when n is null or n <= 1;
    exit when tokens[n] not in ('C', 'A', 'CA', 'S', 'SA', 'SRL', 'RL', 'R', 'L', 'COMPANIA', 'ANONIMA', 'CIA');
    tokens := tokens[1:n - 1];
  end loop;
  return nullif(array_to_string(tokens, ''), '');
end $$;

create or replace function public.trg_cliente_sin_duplicados()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_rol text; v_rif text; v_nom text; v_otro record;
begin
  v_rol := coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '');
  if v_rol <> 'authenticated' then return new; end if;     -- el importador de Odoo no pasa por aquí
  if tg_op = 'UPDATE' and new.rif is not distinct from old.rif
     and new.nombre_negocio is not distinct from old.nombre_negocio then
    return new;
  end if;
  v_rif := normalizar_rif(new.rif);
  if v_rif in ('ND', 'NA', 'SINRIF') then v_rif := null; end if;
  v_nom := normalizar_nombre_empresa(new.nombre_negocio);
  select c.nombre_negocio, c.rif into v_otro
  from clientes c
  where c.id <> new.id
    and (c.empresa_id is null or new.empresa_id is null or c.empresa_id = new.empresa_id)
    and ((v_rif is not null and normalizar_rif(c.rif) = v_rif)
         or (v_nom is not null and normalizar_nombre_empresa(c.nombre_negocio) = v_nom))
  limit 1;
  if found then
    raise exception 'Ya existe un cliente con ese RIF o nombre en esta empresa: % (RIF %).', v_otro.nombre_negocio, v_otro.rif
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists b_cliente_sin_duplicados on public.clientes;
create trigger b_cliente_sin_duplicados before insert or update of rif, nombre_negocio on public.clientes
  for each row execute function public.trg_cliente_sin_duplicados();

commit;
