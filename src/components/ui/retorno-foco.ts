import * as React from "react";

/**
 * Devuelve el foco al elemento que lo tenía al abrir un diálogo, hoja o alerta (WCAG 2.4.3).
 * Radix solo lo devuelve a su Trigger: en los diálogos que se abren por estado (sin Trigger) el foco quedaba en <body>.
 * Si quien llama maneja el foco (preventDefault en su onCloseAutoFocus) o el elemento ya no existe, decide Radix.
 */
export function useRetornoFoco(onOpenAutoFocus?: (e: Event) => void, onCloseAutoFocus?: (e: Event) => void) {
  const previo = React.useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: (e: Event) => {
      const activo = document.activeElement;
      previo.current = activo instanceof HTMLElement && activo !== document.body ? activo : null;
      onOpenAutoFocus?.(e);
    },
    onCloseAutoFocus: (e: Event) => {
      onCloseAutoFocus?.(e);
      if (e.defaultPrevented) return;
      const destino = previo.current;
      previo.current = null;
      if (destino?.isConnected) {
        e.preventDefault();
        destino.focus({ preventScroll: true });
      }
    },
  };
}
