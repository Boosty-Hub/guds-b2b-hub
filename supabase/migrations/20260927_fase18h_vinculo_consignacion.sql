-- ════════════════════════════════════════════════════════════════════════
-- Fase 18h · Vínculo manual del cliente de una consignación
--   Cambiar el cliente desde GUDS (también quitarlo) deja el vínculo en "manual": la sincronización lo respeta.
--   Poner vinculo_cliente en nulo sin tocar el cliente = volver a la identificación automática desde Odoo.
-- ════════════════════════════════════════════════════════════════════════
begin;

create or replace function public.trg_almacen_vinculo_manual()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '') = 'authenticated'
     and new.cliente_id is distinct from old.cliente_id then
    new.vinculo_cliente := 'manual';
  end if;
  return new;
end $$;

commit;
