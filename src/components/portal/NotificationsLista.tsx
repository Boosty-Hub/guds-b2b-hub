import { Bell, Package, CheckCircle, AlertCircle, Info } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Notification } from "@/contexts/NotificationsContext";

// Contenido del menú de avisos (se carga al abrirlo: date-fns y su idioma no viajan con cada pantalla).

const icono = (tipo: string | null) => {
  switch (tipo) {
    case "orden":
      return <Package className="h-4 w-4 text-blue-500" aria-hidden />;
    case "exito":
      return <CheckCircle className="h-4 w-4 text-green-500" aria-hidden />;
    case "alerta":
      return <AlertCircle className="h-4 w-4 text-amber-500" aria-hidden />;
    default:
      return <Info className="h-4 w-4 text-muted-foreground" aria-hidden />;
  }
};

const hace = (fecha: string | null) => (fecha ? formatDistanceToNow(new Date(fecha), { addSuffix: true, locale: es }) : "");

export default function NotificationsLista({ notifications, unreadCount, onAbrir, onMarcarTodas, onVerTodas }: {
  notifications: Notification[];
  unreadCount: number;
  onAbrir: (n: Notification) => void;
  onMarcarTodas: () => void;
  onVerTodas: () => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h2 className="font-semibold text-foreground">Notificaciones</h2>
        {unreadCount > 0 && (
          <Button variant="ghost" size="sm" onClick={onMarcarTodas} className="text-xs text-primary hover:text-primary/80">
            Marcar todas como leídas
          </Button>
        )}
      </div>

      <ScrollArea className="h-[300px]">
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Bell className="h-10 w-10 mb-2 opacity-50" aria-hidden />
            <p className="text-sm">No tienes notificaciones</p>
          </div>
        ) : (
          <ul className="divide-y">
            {notifications.map((notification) => (
              <li key={notification.id}>
                {/* Botón (no un div con clic): se abre con teclado y el lector anuncia título, mensaje y si está sin leer */}
                <button
                  type="button"
                  className={`block w-full px-4 py-3 text-left hover:bg-muted/50 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                    !notification.leida ? "bg-primary/5" : ""
                  }`}
                  onClick={() => onAbrir(notification)}
                >
                  <span className="flex gap-3">
                    <span className="flex-shrink-0 mt-0.5">{icono(notification.tipo)}</span>
                    <span className="block flex-1 min-w-0">
                      <span className={`block text-sm ${!notification.leida ? "font-semibold text-foreground" : "text-foreground"}`}>
                        {notification.titulo}
                        {!notification.leida && <span className="sr-only"> (sin leer)</span>}
                      </span>
                      {notification.mensaje && (
                        <span className="block text-xs text-muted-foreground mt-0.5 line-clamp-2">{notification.mensaje}</span>
                      )}
                      <span className="block text-xs text-muted-foreground mt-1">{hace(notification.created_at)}</span>
                    </span>
                    {!notification.leida && (
                      <span className="flex-shrink-0" aria-hidden>
                        <span className="block h-2 w-2 rounded-full bg-primary" />
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>

      {notifications.length > 0 && (
        <div className="border-t px-4 py-2">
          <Button variant="ghost" size="sm" className="w-full text-sm text-primary" onClick={onVerTodas}>
            Ver todas las notificaciones
          </Button>
        </div>
      )}
    </>
  );
}
