-- ════════════════════════════════════════════════════════════════════════
-- Fase 22a1 · Estado 'anulado' para los cobros (decisión del usuario del 8-oct: "anular cobros, solo administradores").
--   Va en su propia transacción: un valor nuevo de un enum no se puede usar en la misma transacción que lo crea.
--   La función anular_cobro y la papelera están en 20261008_fase22a2_papelera_anular_cobro.sql.
-- ════════════════════════════════════════════════════════════════════════
begin;

alter type public.pago_estado add value if not exists 'anulado';

commit;
