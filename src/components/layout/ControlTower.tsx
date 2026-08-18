import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Bell, X, PanelRightClose, PanelRightOpen, Package, CheckCircle, AlertCircle, Info, ListTodo,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useNotifications, type Notification } from "@/contexts/NotificationsContext";
import { useControlTower } from "@/contexts/ControlTowerContext";
import { usePendingActions } from "@/hooks/use-pending-actions";

const iconoTipo = (tipo: string | null) => {
  switch (tipo) {
    case "orden": return <Package className="h-4 w-4 text-blue-500" />;
    case "exito": return <CheckCircle className="h-4 w-4 text-green-500" />;
    case "alerta": return <AlertCircle className="h-4 w-4 text-amber-500" />;
    default: return <Info className="h-4 w-4 text-muted-foreground" />;
  }
};

function Contenido({ onNavigate }: { onNavigate: (link: string) => void }) {
  const { user } = useAuth();
  const { markAllAsRead, refresh: refreshBadge } = useNotifications();
  const { items: pendientes, total: totalPendientes, loading: loadingPendientes } = usePendingActions();
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [loadingNotifs, setLoadingNotifs] = useState(true);

  const cargarNotifs = async () => {
    if (!user?.id) return;
    setLoadingNotifs(true);
    const { data } = await supabase.from("notificaciones").select("*")
      .eq("usuario_id", user.id).order("created_at", { ascending: false }).limit(50);
    setNotifs((data as Notification[]) ?? []);
    setLoadingNotifs(false);
  };
  useEffect(() => { cargarNotifs(); }, [user?.id]);

  const marcarLeida = async (n: Notification) => {
    if (!n.leida) {
      await supabase.from("notificaciones").update({ leida: true }).eq("id", n.id);
      setNotifs((prev) => prev.map((x) => (x.id === n.id ? { ...x, leida: true } : x)));
      refreshBadge();
    }
    if (n.link) onNavigate(n.link);
  };

  const marcarTodasLeidas = async () => {
    await markAllAsRead();
    setNotifs((prev) => prev.map((n) => ({ ...n, leida: true })));
  };

  const noLeidas = notifs.filter((n) => !n.leida).length;
  const formatTime = (d: string | null) => (d ? formatDistanceToNow(new Date(d), { addSuffix: true, locale: es }) : "");

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Por hacer */}
      <div className="border-b border-border p-4">
        <div className="mb-2 flex items-center gap-2">
          <ListTodo className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">Por hacer</h3>
          {totalPendientes > 0 && <Badge variant="destructive" className="ml-auto">{totalPendientes}</Badge>}
        </div>
        {loadingPendientes ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : totalPendientes === 0 ? (
          <p className="text-sm text-muted-foreground">Todo al día — nada pendiente.</p>
        ) : (
          <div className="space-y-1">
            {pendientes.filter((p) => p.count > 0).map((p) => (
              <button
                key={p.clave}
                onClick={() => onNavigate(p.link)}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm hover:bg-muted/60"
              >
                <p.icono className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate">{p.label}</span>
                <Badge variant="secondary">{p.count}</Badge>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Notificaciones */}
      <div className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">Notificaciones</h3>
          </div>
          {noLeidas > 0 && (
            <Button variant="ghost" size="sm" className="h-7 text-xs text-primary" onClick={marcarTodasLeidas}>
              Marcar todas leídas
            </Button>
          )}
        </div>
        {loadingNotifs ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : notifs.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-muted-foreground">
            <Bell className="mb-2 h-8 w-8 opacity-40" />
            <p className="text-sm">Sin notificaciones</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {notifs.map((n) => (
              <div
                key={n.id}
                onClick={() => marcarLeida(n)}
                className={cn("flex cursor-pointer gap-3 px-1 py-3 hover:bg-muted/50", !n.leida && "bg-primary/5")}
              >
                <div className="mt-0.5 shrink-0">{iconoTipo(n.tipo)}</div>
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm", !n.leida ? "font-semibold" : "")}>{n.titulo}</p>
                  {n.mensaje && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.mensaje}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">{formatTime(n.created_at)}</p>
                </div>
                {!n.leida && <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Radix Sheet renderiza en un portal que ignora `lg:hidden` del contenedor — hay que
 * decidir en JS cuál de las dos variantes montar, no dejar las dos montadas a la vez
 * (si no, el overlay mobile queda flotando encima e intercepta los clics en desktop). */
function useEsDesktop() {
  const [esDesktop, setEsDesktop] = useState(() => typeof window !== "undefined" ? window.innerWidth >= 1024 : true);
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1024px)");
    const onChange = () => setEsDesktop(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return esDesktop;
}

export function ControlTower() {
  const navigate = useNavigate();
  const { open, close, collapsed, toggleCollapsed } = useControlTower();
  const { unreadCount } = useNotifications();
  const { total: totalPendientes } = usePendingActions();
  const esDesktop = useEsDesktop();

  const irA = (link: string) => { close(); navigate(link); };

  if (!open) return null;

  if (!esDesktop) {
    return (
      <Sheet open={open} onOpenChange={(o) => !o && close()}>
        <SheetContent side="right" className="w-full p-0 sm:max-w-full">
          <SheetHeader className="flex h-16 flex-row items-center justify-between border-b border-border p-4">
            <SheetTitle>Torre de Control</SheetTitle>
          </SheetHeader>
          <Contenido onNavigate={irA} />
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <>
      {/* Desktop: aside fijo que empuja contenido (MainLayout aplica el margen) */}
      <aside
        className={cn(
          "fixed right-0 top-0 z-40 flex h-screen flex-col border-l border-border bg-card transition-[width] duration-200",
          collapsed ? "w-16" : "w-96"
        )}
      >
        {collapsed ? (
          <TooltipProvider>
            <div className="flex h-full flex-col items-center gap-2 py-4">
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <button onClick={toggleCollapsed} className="rounded-lg p-2 hover:bg-muted"><PanelRightOpen className="h-5 w-5" /></button>
                </TooltipTrigger>
                <TooltipContent side="left">Expandir torre de control</TooltipContent>
              </Tooltip>
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <button onClick={toggleCollapsed} className="relative rounded-lg p-2 hover:bg-muted">
                    <Bell className="h-5 w-5" />
                    {unreadCount > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] text-destructive-foreground">{unreadCount > 9 ? "9+" : unreadCount}</span>}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left">Notificaciones</TooltipContent>
              </Tooltip>
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <button onClick={toggleCollapsed} className="relative rounded-lg p-2 hover:bg-muted">
                    <ListTodo className="h-5 w-5" />
                    {totalPendientes > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] text-destructive-foreground">{totalPendientes > 9 ? "9+" : totalPendientes}</span>}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left">Por hacer</TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
        ) : (
          <>
            <div className="flex h-16 items-center justify-between border-b border-border px-4">
              <h2 className="font-semibold">Torre de Control</h2>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" onClick={toggleCollapsed} title="Colapsar"><PanelRightClose className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" onClick={close} title="Cerrar"><X className="h-4 w-4" /></Button>
              </div>
            </div>
            <Contenido onNavigate={irA} />
          </>
        )}
      </aside>
    </>
  );
}
