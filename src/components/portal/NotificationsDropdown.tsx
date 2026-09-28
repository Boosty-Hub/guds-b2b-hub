import { lazy, Suspense, useState } from "react";
import { Bell, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useNavigate } from "react-router-dom";
import { useNotifications, Notification } from "@/contexts/NotificationsContext";
import { usePortal } from "@/components/portal/contextoPortal";

// El contenido (lista, fechas relativas con date-fns) se descarga al abrir el menú o al acercarse a la campana.
const cargarLista = () => import("@/components/portal/NotificationsLista");
const NotificationsLista = lazy(cargarLista);

interface NotificationsDropdownProps {
  variant?: "default" | "header";
}

export const NotificationsDropdown = ({ variant = "default" }: NotificationsDropdownProps) => {
  const navigate = useNavigate();
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const [open, setOpen] = useState(false);
  // Dentro del portal del cliente hay una página con todas las notificaciones; en los demás paneles solo se cierra
  const enPortal = usePortal() !== null;

  const handleClick = (n: Notification) => {
    if (!n.leida) markAsRead(n.id);
    if (n.link) { setOpen(false); navigate(n.link); }
  };

  const isHeader = variant === "header";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={unreadCount > 0 ? `Avisos (${unreadCount} sin leer)` : "Avisos"}
          onPointerEnter={() => { void cargarLista(); }}
          onFocus={() => { void cargarLista(); }}
          className={`relative ${
            isHeader
              ? "text-primary-foreground hover:bg-white/20"
              : "text-foreground"
          }`}
        >
          <Bell className="h-5 w-5" aria-hidden />
          {unreadCount > 0 && (
            <span
              aria-hidden
              className={`absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold ${
                isHeader
                  ? "bg-white text-primary"
                  : "bg-destructive text-destructive-foreground"
              }`}
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 p-0 bg-card border shadow-lg z-[100]"
        align="end"
        sideOffset={8}
        aria-label="Notificaciones"
      >
        <Suspense fallback={<div className="flex h-[360px] items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Cargando notificaciones" /></div>}>
          <NotificationsLista
            notifications={notifications}
            unreadCount={unreadCount}
            onAbrir={handleClick}
            onMarcarTodas={markAllAsRead}
            onVerTodas={() => { setOpen(false); if (enPortal) navigate("/portal/cuenta/notificaciones"); }}
          />
        </Suspense>
      </PopoverContent>
    </Popover>
  );
};
