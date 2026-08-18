begin;

-- Fase 11d: retirar el flujo FIFO viejo, ahora reemplazado por asignación manual (Fase 11c).

-- registrar_cobro (FIFO automático) queda reemplazado por registrar_cobro_facturas.
drop function if exists public.registrar_cobro(uuid, uuid, numeric, text, numeric, pago_metodo, text, text, text);

-- ajustar_deuda_odoo reseteaba ordenes.monto_pagado y re-adjudicaba FIFO: si se ejecutara ahora
-- desmentiría las asignaciones manuales de pago_facturas. Ya no aplica (la deuda vive en facturas
-- y se corrige re-corriendo sync-odoo-facturas.mjs).
drop function if exists public.ajustar_deuda_odoo(uuid, numeric);

-- pago_ordenes / pago_cuentas: histórico del FIFO viejo (1.418 adjudicaciones). Se conservan
-- para auditoría pero de solo lectura desde ahora.
comment on table public.pago_ordenes is 'DEPRECADA (Fase 11): histórico de adjudicación FIFO automática pre-facturas. Solo lectura. El flujo vigente usa pago_facturas.';
comment on table public.pago_cuentas is 'DEPRECADA (Fase 11): histórico de adjudicación FIFO automática pre-facturas. Solo lectura. El flujo vigente usa pago_facturas.';
revoke insert, update, delete on public.pago_ordenes from authenticated;
revoke insert, update, delete on public.pago_cuentas from authenticated;

comment on column public.ordenes.monto_pagado is 'DEPRECADO (Fase 11): ya no representa la deuda real. La deuda vive en facturas.saldo_usd.';
comment on column public.ordenes.estado_pago is 'DEPRECADO (Fase 11): ya no representa la deuda real. Ver facturas.estado_cobro.';
comment on column public.ordenes.pagado is 'DEPRECADO (Fase 11): ya no representa la deuda real. Ver facturas.saldo_usd.';
comment on table public.cuentas_cobrar is 'Fuera del cálculo de deuda desde Fase 11 (la deuda vive en facturas). Sigue disponible para cargos manuales ajenos a Odoo.';

commit;
