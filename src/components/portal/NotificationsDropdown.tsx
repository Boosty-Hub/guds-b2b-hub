import { useState } from "react";
import { Bell, Package, CheckCircle, AlertCircle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { useNotifications, Notification } from "@/contexts/NotificationsContext";

interface NotificationsDropdownProps {
  variant?: "default" | "header";
}

export const NotificationsDropdown = ({ variant = "default" }: NotificationsDropdownProps) => {
  const navigate = useNavigate();
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const [open, setOpen] = useState(false);

  const handleClick = (n: Notification) => {
    if (!n.leida) markAsRead(n.id);
    if (n.link) { setOpen(false); navigate(n.link); }
  };

  const getIcon = (tipo: string | null) => {
    switch (tipo) {
      case "orden":
        return <Package className="h-4 w-4 text-blue-500" />;
      case "exito":
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "alerta":
        return <AlertCircle className="h-4 w-4 text-amber-500" />;
      default:
        return <Info className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const formatTime = (dateStr: string | null) => {
    if (!dateStr) return "";
    return formatDistanceToNow(new Date(dateStr), {
      addSuffix: true,
      locale: es,
    });
  };

  const isHeader = variant === "header";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`relative ${
            isHeader
              ? "text-primary-foreground hover:bg-white/20"
              : "text-foreground"
          }`}
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span
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
      >
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-semibold text-foreground">Notificaciones</h3>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={markAllAsRead}
              className="text-xs text-primary hover:text-primary/80"
            >
              Marcar todas como leídas
            </Button>
          )}
        </div>

        <ScrollArea className="h-[300px]">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Bell className="h-10 w-10 mb-2 opacity-50" />
              <p className="text-sm">No tienes notificaciones</p>
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`px-4 py-3 hover:bg-muted/50 cursor-pointer transition-colors ${
                    !notification.leida ? "bg-primary/5" : ""
                  }`}
                  onClick={() => handleClick(notification)}
                >
                  <div className="flex gap-3">
                    <div className="flex-shrink-0 mt-0.5">
                      {getIcon(notification.tipo)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-sm ${
                          !notification.leida
                            ? "font-semibold text-foreground"
                            : "text-foreground"
                        }`}
                      >
                        {notification.titulo}
                      </p>
                      {notification.mensaje && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                          {notification.mensaje}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatTime(notification.created_at)}
                      </p>
                    </div>
                    {!notification.leida && (
                      <div className="flex-shrink-0">
                        <div className="h-2 w-2 rounded-full bg-primary" />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        {notifications.length > 0 && (
          <div className="border-t px-4 py-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-sm text-primary"
              onClick={() => setOpen(false)}
            >
              Ver todas las notificaciones
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};
