import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";

export interface Notification {
  id: string;
  titulo: string;
  mensaje: string | null;
  tipo: string | null;
  leida: boolean | null;
  created_at: string | null;
  link: string | null;
}

interface NotificationsContextType {
  notifications: Notification[];
  unreadCount: number;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  refresh: () => Promise<void>;
}

const NotificationsContext = createContext<NotificationsContextType | undefined>(undefined);

/**
 * Fuente única de notificaciones. Mantiene UN solo canal de Supabase Realtime
 * por usuario, sin importar cuántas campanitas (NotificationsDropdown) se
 * rendericen en pantalla. Antes cada dropdown abría su propio canal con el mismo
 * topic y la segunda suscripción reventaba, dejando el portal en blanco.
 */
export const NotificationsProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchNotifications = useCallback(async () => {
    if (!user?.id) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }
    const { data, error } = await supabase
      .from("notificaciones")
      .select("*")
      .eq("usuario_id", user.id)
      .order("created_at", { ascending: false })
      .limit(10);

    if (!error && data) {
      setNotifications(data as Notification[]);
      setUnreadCount(data.filter((n) => !n.leida).length);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }
    fetchNotifications();
    // Un único canal por usuario. Al cambiar de usuario o desmontar, se limpia.
    const channel = supabase
      .channel(`notif-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notificaciones", filter: `usuario_id=eq.${user.id}` },
        () => fetchNotifications()
      )
      .subscribe();
    // Respaldo: refresca cada 60s por si realtime no está disponible.
    const poll = setInterval(fetchNotifications, 60000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
  }, [user?.id, fetchNotifications]);

  const markAsRead = async (notificationId: string) => {
    await supabase.from("notificaciones").update({ leida: true }).eq("id", notificationId);
    setNotifications((prev) =>
      prev.map((n) => (n.id === notificationId ? { ...n, leida: true } : n))
    );
    setUnreadCount((prev) => Math.max(0, prev - 1));
  };

  const markAllAsRead = async () => {
    if (!user?.id) return;
    await supabase
      .from("notificaciones")
      .update({ leida: true })
      .eq("usuario_id", user.id)
      .eq("leida", false);
    setNotifications((prev) => prev.map((n) => ({ ...n, leida: true })));
    setUnreadCount(0);
  };

  return (
    <NotificationsContext.Provider
      value={{ notifications, unreadCount, markAsRead, markAllAsRead, refresh: fetchNotifications }}
    >
      {children}
    </NotificationsContext.Provider>
  );
};

export const useNotifications = () => {
  const ctx = useContext(NotificationsContext);
  if (ctx === undefined) {
    throw new Error("useNotifications must be used within a NotificationsProvider");
  }
  return ctx;
};
