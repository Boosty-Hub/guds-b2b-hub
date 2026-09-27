-- ════════════════════════════════════════════════════════════════════════
-- Fase 18r · Rendimiento de RLS
--   Las políticas llamaban funciones constantes por consulta (puede('mod','acc'), auth.uid(), empresa_solicitada(),
--   es_admin_total(), is_admin(), usuario_actual_id()) SIN envolverlas en (select …): Postgres las evaluaba en cada
--   fila. En facturas eso eran ~585 ms por consulta (el buscador global tardaba 2,2 s y las listas también pagaban).
--   Envueltas en (select …) se evalúan una sola vez (initplan). Mismo resultado: dependen del usuario/headers de la
--   petición, que no cambian dentro de una sentencia.
--   Regla para políticas nuevas: escribir siempre (select public.puede('x','ver')) y (select auth.uid()).
--   probar-multiempresa.mjs verifica que no quede ninguna sin envolver.
-- ════════════════════════════════════════════════════════════════════════
begin;

do $$
declare
  r record;
  v_using text;
  v_check text;
  v_sql text;
  n integer := 0;
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
  loop
    v_using := r.qual;
    v_check := r.with_check;
    for i in 1..2 loop
      declare t text := case when i = 1 then v_using else v_check end;
      begin
        if t is null then continue; end if;
        t := regexp_replace(t, '(?<!SELECT )puede\(''([a-z_]+)''::text, ''([a-z_]+)''::text\)', '( SELECT puede(''\1''::text, ''\2''::text))', 'g');
        t := regexp_replace(t, '(?<!SELECT )auth\.uid\(\)', '( SELECT auth.uid())', 'g');
        t := regexp_replace(t, '(?<!SELECT )empresa_solicitada\(\)', '( SELECT empresa_solicitada())', 'g');
        t := regexp_replace(t, '(?<!SELECT )es_admin_total\(\)', '( SELECT es_admin_total())', 'g');
        t := regexp_replace(t, '(?<![A-Za-z_]|SELECT )is_admin\(\)', '( SELECT is_admin())', 'g');
        t := regexp_replace(t, '(?<!SELECT )usuario_actual_id\(\)', '( SELECT usuario_actual_id())', 'g');
        if i = 1 then v_using := t; else v_check := t; end if;
      end;
    end loop;

    if v_using is distinct from r.qual or v_check is distinct from r.with_check then
      v_sql := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
      if r.qual is not null then v_sql := v_sql || format(' using (%s)', v_using); end if;
      if r.with_check is not null then v_sql := v_sql || format(' with check (%s)', v_check); end if;
      execute v_sql;
      n := n + 1;
    end if;
  end loop;
  raise notice 'políticas optimizadas: %', n;
end $$;

commit;
