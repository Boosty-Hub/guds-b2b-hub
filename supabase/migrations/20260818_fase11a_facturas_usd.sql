begin;

-- Fase 11a: columnas USD canónicas en facturas, a prueba de re-sync de Odoo.
-- Ver BITACORA.md 2026-08-18 y guds-facturas-modulo (memoria) para contexto.

alter table public.facturas
  add column if not exists total_usd          numeric not null default 0, -- amount_total_signed (Odoo)
  add column if not exists saldo_odoo_usd      numeric not null default 0, -- amount_residual_signed (Odoo) — SOLO el sync escribe esta columna
  add column if not exists monto_aplicado_usd  numeric not null default 0, -- SOLO el trigger trg_pf_recalc la escribe (desde pago_facturas)
  add column if not exists odoo_sync_at        timestamptz,
  add column if not exists creada_en_guds      boolean not null default false;

comment on column public.facturas.total_usd is 'Total de la factura en USD (amount_total_signed de Odoo, con signo: negativo en notas de crédito). Valor canónico para cálculo de deuda.';
comment on column public.facturas.saldo_odoo_usd is 'Snapshot inmutable del saldo en USD según Odoo (amount_residual_signed). Solo lo escribe sync-odoo-facturas.mjs. NO representa lo aplicado en GUDS.';
comment on column public.facturas.monto_aplicado_usd is 'Suma de pago_facturas.monto_aplicado (pagos verificados) para esta factura. Mantenido por trigger, no editar a mano.';
comment on column public.facturas.total is 'DEPRECADO para cálculo de deuda: solo presentación en la moneda del documento. Usar total_usd.';
comment on column public.facturas.saldo_pendiente is 'DEPRECADO para cálculo de deuda: solo presentación en la moneda del documento. Usar saldo_usd.';
comment on column public.facturas.monto_pagado is 'DEPRECADO: usar monto_aplicado_usd / saldo_usd.';

-- saldo_usd: columna canónica de deuda. Generada -> el sync de Odoo no puede pisarla.
alter table public.facturas
  add column if not exists saldo_usd numeric
    generated always as (round(saldo_odoo_usd - monto_aplicado_usd, 2)) stored;

comment on column public.facturas.saldo_usd is 'Saldo real en USD = saldo_odoo_usd - monto_aplicado_usd. Columna canónica de deuda: sum(saldo_usd) por cliente = deuda real. Negativo en notas de crédito (restan).';

alter table public.facturas
  add column if not exists estado_cobro text generated always as (
    case
      when estado_pago = 'anulado' or estado = 'cancel' then 'anulado'
      when abs(saldo_odoo_usd - monto_aplicado_usd) <= 0.01 then 'pagado'
      when abs(saldo_odoo_usd - monto_aplicado_usd) < abs(total_usd) then 'parcial'
      else 'pendiente'
    end
  ) stored;

comment on column public.facturas.estado_cobro is 'Estado de cobro derivado del saldo real (no confundir con estado_pago, que viene de Odoo). Fuente de verdad para UI.';

-- Nota: el filtro de deuda es SOLO estado='posted'. estado_pago='anulado' (mapeado de
-- payment_state='reversed' en Odoo) NO implica saldo cero — hay 181 facturas 'reversed' con
-- saldo_odoo_usd real (~$1.082) según Odoo. saldo_usd ya es la fuente de verdad; no filtrar
-- por estado_pago al sumar deuda.
create index if not exists facturas_deuda_idx on public.facturas (cliente_id)
  include (saldo_usd)
  where estado = 'posted';

commit;
