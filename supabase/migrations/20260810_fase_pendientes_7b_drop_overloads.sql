-- Fase 7b — create or replace no reemplaza una función si la lista de
-- parámetros cambió (se añadieron parámetros al final): Postgres crea una
-- SOBRECARGA nueva en vez de sustituir la anterior, dejando dos versiones
-- coexistiendo y expuestas a PostgREST, con riesgo de ambigüedad al resolver
-- la llamada. Se elimina explícitamente la firma vieja de cada función,
-- igual que ya hizo fase6b_entrega_evidencia.sql con actualizar_estado_entrega.
begin;

drop function if exists public.crear_orden_desde_carrito(pago_metodo, text, uuid);
drop function if exists public.registrar_pago(uuid, uuid, uuid, pago_metodo, numeric, text, numeric, text);

commit;
