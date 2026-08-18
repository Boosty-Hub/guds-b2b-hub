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

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  const getInitials = (nombre: string, apellido: string) => {
    return `${nombre?.charAt(0) || ''}${apellido?.charAt(0) || ''}`.toUpperCase() || 'U';
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop Sidebar */}
      <div className="hidden lg:block">
        <Sidebar collapsed={collapsed} onToggleCollapse={toggleCollapsed} />
      </div>

      {/* Mobile Header */}
      <header className="lg:hidden sticky top-0 z-50 bg-primary text-primary-foreground">
        <div className="flex items-center justify-between h-14 px-4">
          <button onClick={() => setIsMobileMenuOpen(true)} className="p-2 -ml-2">
            <Menu className="h-6 w-6" />
          </button>
          <h1 className="font-semibold truncate">{title}</h1>
          <div className="flex items-center gap-2">
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

      {/* Desktop Header */}
      <div className={cn("hidden lg:block transition-[margin] duration-200", collapsed ? "lg:ml-16" : "lg:ml-64", margenTorre)}>
        <Header title={title} />
      </div>

      {/* Main Content */}
      <main className={cn("pb-20 lg:pb-0 transition-[margin] duration-200", collapsed ? "lg:ml-16" : "lg:ml-64", margenTorre)}>
        <div className="p-4 lg:p-6">{children}</div>
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
        <div className="h-safe-area-inset-bottom bg-card" />
      </nav>

      {/* Mobile Menu Sheet */}
      <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
        <SheetContent side="left" className="w-80 p-0">
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

          {/* Full Navigation */}
          <nav className="p-4 space-y-1 max-h-[calc(100vh-280px)] overflow-y-auto">
            {[
              { icon: LayoutDashboard, label: "Dashboard", path: "/admin/dashboard" },
              { icon: ShoppingCart, label: "Órdenes", path: "/admin/ordenes" },
              { icon: Users, label: "Clientes", path: "/admin/clientes" },
              { label: "Registros", path: "/admin/registros" },
              { icon: Package, label: "Productos", path: "/admin/productos" },
              { label: "Categorías", path: "/admin/categorias" },
              { label: "Inventario", path: "/admin/inventario" },
              { label: "Precios", path: "/admin/precios" },
              { label: "Cupones", path: "/admin/cupones" },
              { label: "Banners", path: "/admin/banners" },
              { label: "Cuentas", path: "/admin/cuentas" },
              { label: "Delivery", path: "/admin/delivery" },
              { icon: Settings, label: "Configuración", path: "/admin/configuracion" },
            ].map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={() => setIsMobileMenuOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted"
                  }`
                }
              >
                {item.icon && <item.icon className="h-5 w-5" />}
                {!item.icon && <div className="h-5 w-5" />}
                {item.label}
              </NavLink>
            ))}
          </nav>

          {/* Logout */}
          <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-border bg-background">
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
  );
}
