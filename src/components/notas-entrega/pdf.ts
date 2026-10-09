import type { DatosPdfNota } from "./pdfNotaEntrega";

// Puerta de entrada al PDF de la nota de entrega: el generador y jsPDF solo se descargan al pedirlo.
const cargar = () => import("./pdfNotaEntrega");

export const precargarPdfNotaEntrega = () => { cargar().catch(() => { /* se reintenta al pulsar */ }); };

export async function descargarPdfNotaEntrega(datos: DatosPdfNota) {
  const m = await cargar();
  return m.descargarPdfNotaEntrega(datos);
}
