// Fechas de delivery en hora de Venezuela (America/Caracas, UTC-4), sin depender de la zona del navegador:
// con UTC, entre las 20:00 y las 23:59 de Caracas "hoy" ya sería el día siguiente.
export const ZONA_CARACAS = "America/Caracas";

/** Día (YYYY-MM-DD) en Caracas de una fecha; sin argumento, hoy. */
export const diaCaracas = (fecha: string | Date = new Date()) =>
  new Date(fecha).toLocaleDateString("en-CA", { timeZone: ZONA_CARACAS });

/** Fecha corta ("27 sept") en Caracas. */
export const fechaCorta = (s: string | null) =>
  s ? new Date(s).toLocaleDateString("es-ES", { day: "2-digit", month: "short", timeZone: ZONA_CARACAS }) : "—";

/** Fecha y hora ("27 sept, 10:32") en Caracas. */
export const fechaHora = (s: string | null) =>
  s ? new Date(s).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: ZONA_CARACAS }) : "—";
