// Trabajo secundario del arranque (avisos emergentes, widgets): se hace cuando la primera pantalla ya se pintó y el
// navegador quedó libre, para no competir con el código y los datos de la ruta.
type Callback = () => void;

const conIdle = (cb: Callback, timeout: number) => {
  const w = window as Window & { requestIdleCallback?: (cb: Callback, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(cb, { timeout });
    return () => w.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(cb, 1);
  return () => window.clearTimeout(id);
};

/** Llama a `cb` después del evento load + `esperaMs` + un momento libre del hilo principal. Devuelve cómo cancelarlo. */
export function alQuedarLibre(cb: Callback, esperaMs = 2500): () => void {
  let cancelar: () => void = () => {};
  let vivo = true;
  const programar = () => {
    const t = window.setTimeout(() => {
      cancelar = conIdle(() => { if (vivo) cb(); }, 2000);
    }, esperaMs);
    cancelar = () => window.clearTimeout(t);
  };
  if (document.readyState === "complete") programar();
  else {
    window.addEventListener("load", programar, { once: true });
    cancelar = () => window.removeEventListener("load", programar);
  }
  return () => { vivo = false; cancelar(); };
}

/** Llama a `cb` cuando lo que se acaba de renderizar ya está en pantalla: tras el próximo cuadro y un margen corto
 *  (`margenMs`) para que el navegador termine de presentarlo. */
export function despuesDePintar(cb: Callback, margenMs = 100): () => void {
  let t = 0;
  const raf = window.requestAnimationFrame(() => { t = window.setTimeout(cb, margenMs); });
  return () => { window.cancelAnimationFrame(raf); window.clearTimeout(t); };
}
