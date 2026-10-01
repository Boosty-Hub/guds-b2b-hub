// Pestaña "Calidad y cuadre" de Reportes. Desde la Fase 21d es una bandeja de trabajo: el código vive en ./calidad/
// (tareas por tipo con responsable, comentario e historial; corrección asistida de dirección hacia Odoo; cuadre Profit ↔ Odoo
// uno a uno; ocultar la sección al terminar).
import { useSeccionCalidad } from "./calidad/datos";

export { CalidadCuadre as CalidadDatos } from "./calidad/CalidadCuadre";

/** ¿La sección está oculta para la empresa activa? (Reportes la saca de las pestañas y deja un ícono para volver a abrirla). */
export function useCalidadOculta(): boolean {
  return !!useSeccionCalidad().estado?.oculta;
}
