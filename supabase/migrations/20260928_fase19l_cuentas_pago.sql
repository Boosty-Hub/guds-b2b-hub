-- ════════════════════════════════════════════════════════════════════════
-- Fase 19l · Cuentas para pagar (decisión 28-sep: publicar todas las cuentas bancarias con sus datos para que el cliente
-- pague y luego declare a cuál pagó)
--   1. bancos: datos que el cliente necesita para pagar. Número, banco y titular vienen de Odoo (res.partner.bank del diario);
--      pago móvil (bancos venezolanos: teléfono, cédula/RIF y código del banco) y Zelle (correo registrado en el banco de
--      EE. UU.) se completan en GUDS porque Odoo no los tiene. visible_portal decide qué se publica (por defecto: las cuentas
--      bancarias activas; nunca las cajas ni los diarios contables de anticipos).
--   2. Seguridad: la política bancos_auth_read (using true) dejaba a CUALQUIER usuario con sesión (clientes, vendedores,
--      repartidores) leer la tabla completa, incluidos los saldos de Odoo y del extracto. Ahora solo el personal de
--      administración lee bancos; clientes y vendedores usan la vista cuentas_pago (solo datos de pago de cuentas publicadas).
--   3. Se desactivan 2 cuentas de maqueta creadas a mano (RIF J-12345678-9 y correo pagos@guds.com; 0 pagos).
--   4. registrar_pago: quien no es administración solo puede declarar pagos a cuentas publicadas.
--   5. Método de pago "zelle".
-- ════════════════════════════════════════════════════════════════════════
begin;

-- (PG >= 12 permite agregar el valor dentro de la transacción mientras no se use en ella)
alter type public.pago_metodo add value if not exists 'zelle';

alter table public.bancos
  add column if not exists banco_nombre text,
  add column if not exists visible_portal boolean not null default false,
  add column if not exists pago_movil_telefono text,
  add column if not exists pago_movil_documento text,
  add column if not exists pago_movil_banco text,
  add column if not exists zelle_correo text,
  add column if not exists zelle_titular text,
  add column if not exists instrucciones text;

comment on column public.bancos.visible_portal is 'Se publica a clientes y vendedores como cuenta donde pagar (vista cuentas_pago)';
comment on column public.bancos.pago_movil_banco is 'Código del banco para pago móvil (p. ej. 0134)';

update public.bancos set visible_portal = (coalesce(tipo_odoo = 'bank', false) and coalesce(activo, false));

update public.bancos set activo = false, visible_portal = false
where odoo_id is null and documento in ('J-12345678-9', 'pagos@guds.com')
  and not exists (select 1 from public.pagos p where p.banco_id = bancos.id);

drop policy if exists bancos_auth_read on public.bancos;
drop policy if exists bancos_personal_read on public.bancos;
create policy bancos_personal_read on public.bancos for select to authenticated using ((select public.es_personal_admin()));

drop view if exists public.cuentas_pago;
create view public.cuentas_pago with (security_invoker = false) as
  select b.id, b.empresa_id, b.nombre, b.banco_nombre, b.moneda, b.metodo_pago, b.metodos, b.tipo_odoo,
         b.numero_cuenta, b.titular, b.documento,
         b.pago_movil_telefono, b.pago_movil_documento, b.pago_movil_banco,
         b.zelle_correo, b.zelle_titular, b.instrucciones
  from public.bancos b
  where b.activo and b.visible_portal
    and (b.empresa_id is null or b.empresa_id = any ((select public.empresas_visibles())::uuid[]));
revoke all on public.cuentas_pago from anon, public;
grant select on public.cuentas_pago to authenticated;

create or replace function public.registrar_pago(p_cliente_id uuid, p_orden_id uuid, p_banco_id uuid, p_metodo pago_metodo, p_monto_moneda numeric,
  p_moneda text default 'USD', p_tasa_cambio numeric default null, p_referencia text default null, p_comprobante_url text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_es_admin boolean := public.is_admin();
  v_autorizado boolean;
  v_monto_usd numeric;
  v_id uuid;
begin
  v_autorizado := v_es_admin
    or public.es_vendedor_de(p_cliente_id)
    or p_cliente_id = any (public.clientes_del_usuario());
  if not v_autorizado then raise exception 'No autorizado para registrar este pago'; end if;
  if p_monto_moneda is null or p_monto_moneda <= 0 then raise exception 'Monto inválido'; end if;
  if not v_es_admin and p_banco_id is not null
     and not exists (select 1 from public.bancos b where b.id = p_banco_id and b.activo and b.visible_portal) then
    raise exception 'La cuenta indicada no recibe pagos de clientes';
  end if;

  if p_moneda = 'BS' then
    if coalesce(p_tasa_cambio, 0) <= 0 then raise exception 'Falta la tasa de cambio para un pago en bolívares'; end if;
    v_monto_usd := round(p_monto_moneda / p_tasa_cambio, 2);
  else
    v_monto_usd := p_monto_moneda;
  end if;

  insert into pagos (cliente_id, orden_id, banco_id, metodo, monto, monto_moneda, moneda, tasa_cambio, referencia, comprobante_url, estado, verificado_por, fecha_verificacion)
  values (
    p_cliente_id, p_orden_id, p_banco_id, p_metodo, v_monto_usd, p_monto_moneda,
    coalesce(p_moneda,'USD'), case when p_moneda = 'BS' then p_tasa_cambio else null end, p_referencia, p_comprobante_url,
    (case when v_es_admin then 'verificado' else 'pendiente' end)::pago_estado,
    case when v_es_admin then (select id from usuarios where auth_id = auth.uid()) else null end,
    case when v_es_admin then now() else null end
  ) returning id into v_id;

  if v_es_admin then
    perform public.liquidar_orden(p_orden_id);
  end if;

  return v_id;
end $$;

notify pgrst, 'reload schema';

commit;
