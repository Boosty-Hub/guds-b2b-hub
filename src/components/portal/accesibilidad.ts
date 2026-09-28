import { useLayoutEffect, type KeyboardEvent } from "react";

// Accesibilidad compartida por los portales del cliente y del vendedor (F7, WCAG 2.2 AA).

let montados = 0;

/**
 * Marca <html> con la clase `portal-aa` mientras el portal esté montado: activa los tokens de contraste AA y el
 * movimiento reducido de index.css (también en diálogos y menús, que se pintan fuera del shell, en <body>).
 * Cuenta referencias para que al pasar de una pantalla a otra (cada página del vendedor monta su layout) no parpadee.
 */
export function useAccesibilidadPortal() {
  useLayoutEffect(() => {
    montados += 1;
    document.documentElement.classList.add("portal-aa");
    return () => {
      montados -= 1;
      if (montados === 0) document.documentElement.classList.remove("portal-aa");
    };
  }, []);
}

/** El usuario pidió menos movimiento en su sistema (para desplazamientos hechos por código). */
export const prefiereMenosMovimiento = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Teclado de un grupo de radios hecho con botones (role="radio"): las flechas mueven el foco y eligen la opción,
 * como en un grupo de radios nativo. Se usa en el onKeyDown del contenedor role="radiogroup".
 */
export function flechasGrupoRadio(e: KeyboardEvent<HTMLElement>) {
  const paso = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
  if (!paso) return;
  const opciones = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]:not([disabled])'));
  if (!opciones.length) return;
  e.preventDefault();
  const i = opciones.indexOf(document.activeElement as HTMLElement);
  const j = (Math.max(0, i) + paso + opciones.length) % opciones.length;
  opciones[j].focus();
  opciones[j].click();
}
