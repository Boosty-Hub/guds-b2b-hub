import { ReactNode, useState } from "react";
import { DeliverySidebar } from "./DeliverySidebar";
import { NavLink, useNavigate } from "react-router-dom";
import { 
  Bell, 
  Menu, 
  LayoutDashboard, 
  Package, 
  Map, 
  CheckSquare,
  LogOut,
  Truck
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import gudsLogo from "@/assets/guds-logo.png";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";

interface DeliveryLayoutProps {
  children: ReactNode;
  title: string;
}

const mobileNavItems = [
  { icon: LayoutDashboard, label: "Inicio", path: "/delivery" },
  { icon: Package, label: "Entregas", path: "/delivery/entregas" },
  { icon: Map, label: "Ruta", path: "/delivery/ruta" },
  { icon: CheckSquare, label: "Historial", path: "/delivery/historial" },
];

export const DeliveryLayout = ({ children, title }: DeliveryLayoutProps) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  const getInitials = (nombre: string, apellido: string) => {
    return `${nombre?.charAt(0) || ''}${apellido?.charAt(0) || ''}`.toUpperCase() || 'D';
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop Sidebar */}
      <div className="hidden md:block">
        <DeliverySidebar />
      </div>

      {/* Mobile Header */}
      <header className="md:hidden sticky top-0 z-50 bg-amber-500 text-white">
        <div className="flex items-center justify-between h-14 px-4">
          <button onClick={() => setIsMobileMenuOpen(true)} className="p-2 -ml-2">
            <Menu className="h-6 w-6" />
          </button>
          <h1 className="font-semibold">{title}</h1>
          <Button variant="ghost" size="icon" className="relative text-white hover:bg-white/10">
            <Bell className="h-5 w-5" />
            <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-white text-xs text-amber-500 font-bold">
              4
            </span>
          </Button>
        </div>
      </header>

      {/* Desktop Header */}
      <div className="hidden md:block md:pl-64">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-card px-6">
          <h1 className="text-xl font-semibold text-foreground">{title}</h1>
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="h-5 w-5" />
              <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-xs text-white">
                4
              </span>
            </Button>
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-full bg-amber-500/20 flex items-center justify-center">
                <span className="text-sm font-semibold text-amber-500">
                  {user ? getInitials(user.nombre, user.apellido) : 'D'}
                </span>
              </div>
              <div>
                <p className="text-sm font-medium">{user?.nombre} {user?.apellido}</p>
                <p className="text-xs text-muted-foreground">Repartidor</p>
              </div>
            </div>
          </div>
        </header>
      </div>

      {/* Main Content */}
      <main className="md:pl-64 pb-20 md:pb-0">
        <div className="p-4 md:p-6">{children}</div>
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border z-50">
        <div className="flex items-center justify-around h-16">
          {mobileNavItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === "/delivery"}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1 px-3 py-2 ${
                  isActive ? "text-amber-500" : "text-muted-foreground"
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
              <img src={gudsLogo} alt="GUDS" className="h-8" />
            </SheetTitle>
          </SheetHeader>
          
          {/* User Info */}
          <div className="p-4 border-b border-border">
            <div className="rounded-xl bg-amber-500/10 p-4">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-full bg-amber-500/20 flex items-center justify-center">
                  <span className="text-lg font-semibold text-amber-500">
                    {user ? getInitials(user.nombre, user.apellido) : 'D'}
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
            {mobileNavItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === "/delivery"}
                onClick={() => setIsMobileMenuOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-amber-500 text-white"
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
