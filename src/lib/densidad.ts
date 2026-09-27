// Densidad de datos por usuario (se guarda en el navegador). Compacta por defecto; "cómoda" agranda tablas y filas.
export type Densidad = "compacta" | "comoda";
const CLAVE = "guds.densidad";

export function leerDensidad(): Densidad {
  try { return localStorage.getItem(CLAVE) === "comoda" ? "comoda" : "compacta"; } catch { return "compacta"; }
}

export function aplicarDensidad(d: Densidad = leerDensidad()) {
  document.documentElement.classList.toggle("densidad-comoda", d === "comoda");
}

export function guardarDensidad(d: Densidad) {
  try { localStorage.setItem(CLAVE, d); } catch { /* sin almacenamiento */ }
  aplicarDensidad(d);
}
