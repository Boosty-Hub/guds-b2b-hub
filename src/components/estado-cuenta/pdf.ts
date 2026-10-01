import type { EstadoCuentaCompleto } from "./tipos";
import type { OpcionesPdf } from "./pdfEstadoCuenta";

// Puerta de entrada al PDF del estado de cuenta: el generador y la librería (jsPDF + autotable, ~120 KB gzip) viven en
// su propio archivo y solo se descargan al pedir el PDF. Importar este módulo no carga nada de eso.

const cargar = () => import("./pdfEstadoCuenta");

/** Precarga el generador (p. ej. al pasar el ratón por el botón) sin generar nada. */
export const precargarPdfEstadoCuenta = () => { cargar().catch(() => { /* se reintenta al pulsar */ }); };

export async function descargarPdfEstadoCuenta(datos: EstadoCuentaCompleto, opciones?: OpcionesPdf) {
  const m = await cargar();
  return m.descargarPdfEstadoCuenta(datos, opciones);
}

export async function pdfEstadoCuentaBase64(datos: EstadoCuentaCompleto, opciones?: OpcionesPdf) {
  const m = await cargar();
  return m.pdfEstadoCuentaBase64(datos, opciones);
}
