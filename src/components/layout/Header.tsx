import { Bell, User, LogOut, Settings, Rows3, Rows4 } from "lucide-react";
import { useState } from "react";
import { leerDensidad, guardarDensidad, type Densidad } from "@/lib/densidad";
import { BuscadorGlobal } from "@/components/BuscadorGlobal";
import { cn } from "@/lib/utils";
import { useNotifications } from "@/contexts/NotificationsContext";
import { useControlTower } from "@/contexts/ControlTowerContext";
import { usePendingActions } from "@/hooks/use-pending-actions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { TasaBcv } from "@/components/TasaBcv";
import { EstadoSyncOdoo } from "@/components/EstadoSyncOdoo";
import { BoostySupportSlot } from "@/components/support/BoostySupportSlot";
import { EmpresaSelector } from "@/components/EmpresaSelector";

interface HeaderProps {
  title: string;
}

export function Header({ title }: HeaderProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { unreadCount } = useNotifications();
  const { toggle: toggleTorre, open: torreAbierta, collapsed: torreColapsada } = useControlTower();
  // La torre abierta (w-96) empuja el contenido: los breakpoints miden la ventana, no el ancho que queda, así que con ella
  // abierta se ocultan el buscador (sigue Ctrl+K), el estado de Odoo y el nombre salvo en pantallas muy anchas.
  const torreEmpuja = torreAbierta && !torreColapsada;
  const { total: totalPendientes } = usePendingActions();
  const totalBadge = unreadCount + totalPendientes;

  const [densidad, setDensidad] = useState<Densidad>(leerDensidad);
  const alternarDensidad = () => { const d: Densidad = densidad === "compacta" ? "comoda" : "compacta"; guardarDensidad(d); setDensidad(d); };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  const getInitials = (nombre: string, apellido: string) => {
    return `${nombre?.charAt(0) || ''}${apellido?.charAt(0) || ''}`.toUpperCase() || 'U';
  };

  return (
    <header className="sticky top-0 z-30 flex h-12 items-center justify-between gap-4 border-b border-border bg-card px-4">
      {/* El título cede espacio (se trunca) antes que el estado de Odoo y la tasa BCV, que nunca pasan a dos líneas */}
      <h1 className="min-w-[7rem] flex-1 truncate text-base font-semibold text-foreground" title={title}>{title}</h1>

      <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
        {/* Buscador global (Ctrl/⌘ + K) */}
        <BuscadorGlobal className={cn("hidden w-48 min-[1500px]:w-72", torreEmpuja ? "min-[1800px]:flex" : "md:flex")} />

        {/* Empresa activa */}
        <EmpresaSelector />

        {/* Sincronización con Odoo */}
        <EstadoSyncOdoo className={cn("hidden", torreEmpuja ? "min-[1800px]:flex" : "xl:flex")} />

        {/* Tasa BCV */}
        <TasaBcv />

        {/* Torre de control */}
        <Button
          variant={torreAbierta ? "secondary" : "ghost"}
          size="icon"
          className="relative"
          onClick={toggleTorre}
          title="Torre de control"
        >
          <Bell className="h-5 w-5" />
          {totalBadge > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-xs font-semibold text-destructive-foreground">
              {totalBadge > 9 ? "9+" : totalBadge}
            </span>
          )}
        </Button>

        {/* Boosty support */}
        <BoostySupportSlot media="(min-width: 1024px)" />

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-2 px-2">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary text-primary-foreground text-sm">
                  {user ? getInitials(user.nombre, user.apellido) : 'U'}
                </AvatarFallback>
              </Avatar>
              <span className={cn("hidden text-sm font-medium", torreEmpuja ? "min-[1800px]:block" : "min-[1400px]:block")}>
                {user?.nombre || 'Usuario'}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>
              <div>
                <p className="font-medium">{user?.nombre} {user?.apellido}</p>
                <p className="text-xs text-muted-foreground">{user?.email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate("/admin/perfil")}>
              <User className="mr-2 h-4 w-4" />
              Mi Perfil
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/admin/configuracion")}>
              <Settings className="mr-2 h-4 w-4" />
              Configuración
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={(e) => { e.preventDefault(); alternarDensidad(); }}>
              {densidad === "compacta" ? <Rows4 className="mr-2 h-4 w-4" /> : <Rows3 className="mr-2 h-4 w-4" />}
              Vista {densidad === "compacta" ? "compacta" : "cómoda"}
              <span className="ml-auto text-[10px] text-muted-foreground">cambiar</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={handleLogout}>
              <LogOut className="mr-2 h-4 w-4" />
              Cerrar Sesión
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
