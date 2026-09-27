import { ReactNode, useState } from "react";
import { VendedorSidebar } from "./VendedorSidebar";
import { navItems as navVendedor } from "./navegacion";
import { BuscadorGlobal, type ModuloBuscador } from "@/components/BuscadorGlobal";
import { NavLink, useNavigate } from "react-router-dom";
import {
  Bell,
  Menu,
  X,
  LayoutDashboard,
  Users,
  ShoppingCart,
  CreditCard,
  Target,
  Warehouse,
  LogOut
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CurrencySwitch } from "@/components/CurrencySwitch";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Logo } from "@/components/Logo";
import { NotificationsDropdown } from "@/components/portal/NotificationsDropdown";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { BoostySupportSlot } from "@/components/support/BoostySupportSlot";
import { EmpresaSelector, ModoConsultaBanner } from "@/components/EmpresaSelector";

interface VendedorLayoutProps {
  children: ReactNode;
  title: string;
}

// Barra inferior: 5 items ya llenan el ancho en móvil (justify-around),
// así que Inventario no entra ahí — solo en el menú hamburguesa (sheetNavItems).
const mobileNavItems = [
  { icon: LayoutDashboard, label: "Inicio", path: "/vendedor" },
  { icon: Users, label: "Clientes", path: "/vendedor/clientes" },
  { icon: ShoppingCart, label: "Pedidos", path: "/vendedor/pedidos" },
  { icon: CreditCard, label: "Pagos", path: "/vendedor/pagos" },
  { icon: Target, label: "Metas", path: "/vendedor/metas" },
];

const sheetNavItems = [
  ...mobileNavItems,
  { icon: Warehouse, label: "Inventario", path: "/vendedor/inventario" },
];

// Accesos "Ir a" del buscador del vendedor
const modulosVendedor: ModuloBuscador[] = navVendedor.map((i) => ({ label: i.label, path: i.path, seccion: "Portal vendedor" }));

export const VendedorLayout = ({ children, title }: VendedorLayoutProps) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  const getInitials = (nombre: string, apellido: string) => {
    return `${nombre?.charAt(0) || ''}${apellido?.charAt(0) || ''}`.toUpperCase() || 'V';
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop Sidebar */}
      <div className="hidden md:block">
        <VendedorSidebar />
      </div>

      {/* Mobile Header */}
      <header className="md:hidden sticky top-0 z-50 bg-emerald-500 text-white">
        <div className="flex h-14 items-center justify-between gap-1 px-2">
          <button onClick={() => setIsMobileMenuOpen(true)} className="shrink-0 p-1.5" aria-label="Abrir menú">
            <Menu className="h-6 w-6" />
          </button>
          <h1 className="min-w-0 flex-1 truncate font-semibold">{title}</h1>
          <div className="flex shrink-0 items-center gap-1">
            <BuscadorGlobal compacto atajo={false} contexto="vendedor" modulos={modulosVendedor} className="border-white/30 bg-white/15 text-white hover:bg-white/25" />
            <EmpresaSelector variant="header" compacto />
            <CurrencySwitch variant="header" />
            <BoostySupportSlot media="(max-width: 767.98px)" />
            <NotificationsDropdown variant="header" />
          </div>
        </div>
      </header>
      <div className="md:hidden">
        <ModoConsultaBanner />
      </div>

      {/* Desktop Header */}
      <div className="hidden md:block md:pl-56">
        <header className="sticky top-0 z-30 flex h-12 items-center justify-between gap-3 border-b border-border bg-card px-4">
          <h1 className="min-w-0 truncate text-base font-semibold text-foreground">{title}</h1>
          <div className="flex items-center gap-3">
            <BuscadorGlobal contexto="vendedor" modulos={modulosVendedor} className="hidden lg:flex" />
            <EmpresaSelector />
            <CurrencySwitch />
            <NotificationsDropdown />
            <BoostySupportSlot media="(min-width: 768px)" />
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
                <span className="text-sm font-semibold text-emerald-500">
                  {user ? getInitials(user.nombre, user.apellido) : 'V'}
                </span>
              </div>
              <div>
                <p className="text-[13px] font-medium leading-tight">{user?.nombre} {user?.apellido}</p>
                <p className="text-[11px] leading-tight text-muted-foreground">Vendedor</p>
              </div>
            </div>
          </div>
        </header>
        <ModoConsultaBanner />
      </div>

      {/* Main Content */}
      <main className="md:pl-56 pb-20 md:pb-0">
        <div className="p-3 md:p-4">{children}</div>
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border z-50">
        <div className="flex items-center justify-around h-16">
          {mobileNavItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === "/vendedor"}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1 px-3 py-2 ${
                  isActive ? "text-emerald-500" : "text-muted-foreground"
                }`
              }
            >
              <item.icon className="h-5 w-5" />
              <span className="text-xs">{item.label}</span>
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
              <Logo className="h-8 text-primary" />
            </SheetTitle>
          </SheetHeader>
          
          {/* User Info */}
          <div className="p-4 border-b border-border">
            <div className="rounded-xl bg-emerald-500/10 p-4">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <span className="text-lg font-semibold text-emerald-500">
                    {user ? getInitials(user.nombre, user.apellido) : 'V'}
                  </span>
                </div>
                <div>
                  <p className="font-semibold">{user?.nombre} {user?.apellido}</p>
                  <p className="text-sm text-muted-foreground">{user?.email}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <nav className="p-4 space-y-1">
            {sheetNavItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === "/vendedor"}
                onClick={() => setIsMobileMenuOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-emerald-500 text-white"
                      : "text-muted-foreground hover:bg-muted"
                  }`
                }
              >
                <item.icon className="h-5 w-5" />
                {item.label}
              </NavLink>
            ))}
          </nav>

          {/* Logout */}
          <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-border">
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
};
