import { BuscadorGlobal } from "@/components/BuscadorGlobal";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { NavLink, useNavigate } from "react-router-dom";
import {
  Menu,
  LayoutDashboard,
  ShoppingCart,
  Users,
  Package,
  Settings,
  LogOut,
  X,
  Bell
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Logo } from "@/components/Logo";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { BoostySupportSlot } from "@/components/support/BoostySupportSlot";
import { ControlTower } from "./ControlTower";
import { useControlTower } from "@/contexts/ControlTowerContext";
import { useNotifications } from "@/contexts/NotificationsContext";
import { usePendingActions } from "@/hooks/use-pending-actions";
import { EmpresaSelector, ModoConsultaBanner } from "@/components/EmpresaSelector";
import { TooltipProvider } from "@/components/ui/tooltip";
import { usePermissions } from "@/contexts/PermissionsContext";
import { navSections } from "./navegacion";

interface MainLayoutProps {
  children: React.ReactNode;
  title: string;
}

const mobileNavItems = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/admin/dashboard" },
  { icon: ShoppingCart, label: "Órdenes", path: "/admin/ordenes" },
  { icon: Users, label: "Clientes", path: "/admin/clientes" },
  { icon: Package, label: "Productos", path: "/admin/productos" },
  { icon: Settings, label: "Config", path: "/admin/configuracion" },
];

const COLLAPSE_KEY = "guds-sb-collapsed";

export function MainLayout({ children, title }: MainLayoutProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === "1");
  const toggleCollapsed = () =>
    setCollapsed((v) => {
      const next = !v;
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  const navigate = useNavigate();
  const { user } = useAuth();
  const { open: torreAbierta, collapsed: torreColapsada, toggle: toggleTorre } = useControlTower();
  const margenTorre = torreAbierta ? (torreColapsada ? "lg:mr-16" : "lg:mr-96") : "lg:mr-0";
  const { unreadCount } = useNotifications();
  const { total: totalPendientes } = usePendingActions();
  const totalBadgeMobile = unreadCount + totalPendientes;
  const { can } = usePermissions();

  // El menú del celular sale de la misma lista y el mismo filtro de permisos que el lateral de escritorio
  // (navegacion.ts). Antes era una lista escrita a mano y le faltaban 15 módulos (Reportes, Facturas, Bancos…).
  const seccionesMovil = navSections
    .map((s) => ({ ...s, items: s.items.filter((i) => i.modulo === "dashboard" || can(i.modulo, "ver")) }))
    .filter((s) => s.items.length > 0);
  // Un módulo con otro enlace debajo de su ruta (Delivery → Devoluciones) solo se marca en su ruta exacta
  const tieneHijo = (path: string) => navSections.some((s) => s.items.some((i) => i.path.startsWith(path + "/")));
  const claseItemMovil = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors ${
      isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
    }`;

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  const getInitials = (nombre: string, apellido: string) => {
    return `${nombre?.charAt(0) || ''}${apellido?.charAt(0) || ''}`.toUpperCase() || 'U';
  };

  return (
    <TooltipProvider>
    <div className="min-h-screen bg-background">
      {/* Desktop Sidebar */}
      <div className="hidden lg:block">
        <Sidebar collapsed={collapsed} onToggleCollapse={toggleCollapsed} />
      </div>

      {/* Mobile Header */}
      <header className="lg:hidden sticky top-0 z-50 bg-primary pt-[env(safe-area-inset-top)] text-primary-foreground">
        <div className="flex items-center justify-between h-14 px-4">
          <button onClick={() => setIsMobileMenuOpen(true)} className="p-2 -ml-2">
            <Menu className="h-6 w-6" />
          </button>
          <h1 className="font-semibold truncate">{title}</h1>
          <div className="flex items-center gap-2">
            <BuscadorGlobal compacto atajo={false} className="border-white/30 bg-white/15 text-white hover:bg-white/25" />
            <EmpresaSelector variant="header" compacto />
            <BoostySupportSlot media="(max-width: 1023.98px)" />
            <button onClick={toggleTorre} className="relative p-2" title="Torre de control">
              <Bell className="h-5 w-5" />
              {totalBadgeMobile > 0 && (
                <span className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold text-destructive-foreground">
                  {totalBadgeMobile > 9 ? "9+" : totalBadgeMobile}
                </span>
              )}
            </button>
            <div className="h-8 w-8 rounded-full bg-white/20 flex items-center justify-center">
              <span className="text-sm font-semibold">
                {user ? getInitials(user.nombre, user.apellido) : 'U'}
              </span>
            </div>
          </div>
        </div>
      </header>
      <div className="lg:hidden">
        <ModoConsultaBanner />
      </div>

      {/* Desktop Header */}
      <div className={cn("hidden lg:block transition-[margin] duration-200", collapsed ? "lg:ml-14" : "lg:ml-56", margenTorre)}>
        <Header title={title} />
        <ModoConsultaBanner />
      </div>

      {/* Main Content */}
      <main className={cn("pb-20 lg:pb-0 transition-[margin] duration-200", collapsed ? "lg:ml-14" : "lg:ml-56", margenTorre)}>
        <div className="p-3 lg:p-4">{children}</div>
      </main>

      {/* Torre de control (empuja en desktop, overlay completo en mobile/tablet) */}
      <ControlTower />

      {/* Mobile Bottom Navigation */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border z-50 overflow-hidden">
        <div className="flex items-center h-16">
          {mobileNavItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `flex flex-1 min-w-0 flex-col items-center gap-1 px-1 py-2 ${
                  isActive ? "text-primary" : "text-muted-foreground"
                }`
              }
            >
              <item.icon className="h-5 w-5 shrink-0" />
              <span className="text-xs truncate max-w-full">{item.label}</span>
            </NavLink>
          ))}
        </div>
        <div className="h-[env(safe-area-inset-bottom)] bg-card" />
      </nav>

      {/* Mobile Menu Sheet */}
      <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
        <SheetContent side="left" className="w-80 p-0 pt-[env(safe-area-inset-top)]">
          <SheetHeader className="p-4 border-b border-border">
            <SheetTitle className="flex items-center gap-3">
              <Logo className="h-10 text-primary" />
            </SheetTitle>
          </SheetHeader>
          
          {/* Admin Info */}
          <div className="p-4 border-b border-border">
            <div className="rounded-xl bg-primary/10 p-4">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-full bg-primary/20 flex items-center justify-center">
                  <span className="text-lg font-semibold text-primary">
                    {user ? getInitials(user.nombre, user.apellido) : 'U'}
                  </span>
                </div>
                <div>
                  <p className="font-semibold">{user?.nombre} {user?.apellido}</p>
                  <p className="text-sm text-muted-foreground">{user?.email}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Full Navigation: las mismas secciones del lateral, filtradas por permisos */}
          <nav className="p-4 max-h-[calc(100vh-280px)] overflow-y-auto">
            {seccionesMovil.map((section) => (
              <div key={section.title} className="mb-3">
                <p className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">{section.title}</p>
                <div className="space-y-1">
                  {section.items.map((item) => (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      end={tieneHijo(item.path)}
                      onClick={() => setIsMobileMenuOpen(false)}
                      className={claseItemMovil}
                    >
                      <item.icon className="h-5 w-5 shrink-0" />
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              </div>
            ))}
            <div className="space-y-1 border-t border-border pt-3">
              <NavLink to="/admin/configuracion" onClick={() => setIsMobileMenuOpen(false)} className={claseItemMovil}>
                <Settings className="h-5 w-5 shrink-0" />
                Configuración
              </NavLink>
            </div>
          </nav>

          {/* Logout */}
          <div className="absolute bottom-0 left-0 right-0 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-border bg-background">
            <button 
              onClick={handleLogout}
              className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-destructive hover:bg-destructive/10"
            >
              <LogOut className="h-5 w-5" />
              Cerrar Sesión
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
    </TooltipProvider>
  );
}
