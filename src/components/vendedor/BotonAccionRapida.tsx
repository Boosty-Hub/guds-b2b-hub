import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Plus } from "lucide-react";

/** Botón central de la barra del teléfono ("Nuevo pedido o cobro"): el mismo antes y después de cargar su menú. */
export const BotonAccionRapida = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>((props, ref) => (
  <button ref={ref} type="button" aria-label="Nuevo pedido o cobro" data-testid="boton-accion-rapida"
    className="-mt-5 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-700 text-white shadow-lg ring-4 ring-background active:bg-emerald-800"
    {...props}>
    <Plus className="h-6 w-6" aria-hidden />
  </button>
));
BotonAccionRapida.displayName = "BotonAccionRapida";
