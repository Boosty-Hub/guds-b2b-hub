import { forwardRef, useRef, useState, type ButtonHTMLAttributes } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNotifications } from "@/contexts/NotificationsContext";
import { cargaDiferida } from "@/lib/cargaDiferida";

// La campana se pinta con la pantalla; el menú (Radix Popover y su motor de posicionamiento) se descarga aparte, cuando
// el navegador queda libre o al acercarse a la campana. Si se toca antes de que llegue, se abre en cuanto llega.
const popover = cargaDiferida(() => import("@/components/portal/NotificationsPopover"));

export interface NotificationsDropdownProps {
  variant?: "default" | "header";
}

/** Botón de la campana: el mismo antes y después de cargar el menú. */
export const BotonAvisos = forwardRef<HTMLButtonElement, NotificationsDropdownProps & ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ variant = "default", className, ...props }, ref) => {
    const { unreadCount } = useNotifications();
    const isHeader = variant === "header";
    return (
      <Button
        ref={ref}
        variant="ghost"
        size="icon"
        aria-label={unreadCount > 0 ? `Avisos (${unreadCount} sin leer)` : "Avisos"}
        className={`relative ${isHeader ? "text-primary-foreground hover:bg-white/20" : "text-foreground"}${className ? ` ${className}` : ""}`}
        {...props}
      >
        <Bell className="h-5 w-5" aria-hidden />
        {unreadCount > 0 && (
          <span
            aria-hidden
            className={`absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold ${
              isHeader ? "bg-white text-primary" : "bg-destructive text-destructive-foreground"
            }`}
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </Button>
    );
  },
);
BotonAvisos.displayName = "BotonAvisos";

export const NotificationsDropdown = ({ variant = "default" }: NotificationsDropdownProps) => {
  const modulo = popover.useModulo();
  const [abrir, setAbrir] = useState(false);
  const foco = useRef(false);
  if (modulo) return <modulo.NotificationsPopover variant={variant} abrirAlMontar={abrir} enfocar={foco.current} />;
  return (
    <BotonAvisos
      variant={variant}
      aria-haspopup="dialog"
      aria-expanded={false}
      onPointerEnter={popover.pedir}
      onFocus={() => { foco.current = true; popover.pedir(); }}
      onBlur={() => { foco.current = false; }}
      onClick={() => { setAbrir(true); popover.pedir(); }}
    />
  );
};
