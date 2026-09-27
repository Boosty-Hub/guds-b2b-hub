-- ════════════════════════════════════════════════════════════════════════
-- Fase 17c · Los usuarios de un cliente acceden a la empresa de su cliente
--   (o a todas si el cliente es compartido). Cubre cualquier vía de alta: aprobación de registro,
--   usuarios creados desde la ficha del cliente, o cambio de cliente_id.
-- ════════════════════════════════════════════════════════════════════════
begin;

create or replace function public.trg_usuario_empresas_cliente()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.cliente_id is not null and (tg_op = 'INSERT' or new.cliente_id is distinct from old.cliente_id) then
    insert into usuario_empresas (usuario_id, empresa_id, por_defecto)
    select new.id, e.id, row_number() over (order by e.orden) = 1
    from clientes c
    join empresas e on e.activo and (c.empresa_id is null or e.id = c.empresa_id)
    where c.id = new.cliente_id
    on conflict (usuario_id, empresa_id) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists trg_usuario_empresas_cliente on public.usuarios;
create trigger trg_usuario_empresas_cliente
  after insert or update of cliente_id on public.usuarios
  for each row execute function public.trg_usuario_empresas_cliente();

-- Usuarios de clientes que ya existan
insert into public.usuario_empresas (usuario_id, empresa_id, por_defecto)
select u.id, e.id, row_number() over (partition by u.id order by e.orden) = 1
from public.usuarios u
join public.clientes c on c.id = u.cliente_id
join public.empresas e on e.activo and (c.empresa_id is null or e.id = c.empresa_id)
on conflict (usuario_id, empresa_id) do nothing;

commit;
