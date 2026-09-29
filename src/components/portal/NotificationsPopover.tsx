import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useNavigate } from "react-router-dom";
import { useNotifications, Notification } from "@/contexts/NotificationsContext";
import { usePortal } from "@/components/portal/contextoPortal";
import { BotonAvisos, type NotificationsDropdownProps } from "@/components/portal/NotificationsDropdown";

// El contenido (lista, fechas relativas con date-fns) se descarga al abrir el menú o al acercarse a la campana.
const cargarLista = () => import("@/components/portal/NotificationsLista");
const NotificationsLista = lazy(cargarLista);

/** Menú de avisos (Radix Popover). Se descarga aparte: ver NotificationsDropdown. */
export const NotificationsPopover = ({ variant = "default", abrirAlMontar = false, enfocar = false }: NotificationsDropdownProps & {
  /** El usuario tocó la campana antes de que llegara el menú: se abre al montarse. */
  abrirAlMontar?: boolean;
  /** La campana tenía el foco: lo conserva. */
  enfocar?: boolean;
}) => {
  const navigate = useNavigate();
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const [open, setOpen] = useState(abrirAlMontar);
  const boton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (enfocar) boton.current?.focus(); }, [enfocar]);
  // Dentro del portal del cliente hay una página con todas las notificaciones; en los demás paneles solo se cierra
  const enPortal = usePortal() !== null;

  const handleClick = (n: Notification) => {
    if (!n.leida) markAsRead(n.id);
    if (n.link) { setOpen(false); navigate(n.link); }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <BotonAvisos
          ref={boton}
          variant={variant}
          onPointerEnter={() => { void cargarLista(); }}
          onFocus={() => { void cargarLista(); }}
        />
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
