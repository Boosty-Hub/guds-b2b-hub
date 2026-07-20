import { ReactNode, useState } from "react";
import { ConfiguracionSidebar, configNavItems } from "./ConfiguracionSidebar";
import { Bell, Menu, Settings, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { NavLink } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { NotificationsDropdown } from "@/components/portal/NotificationsDropdown";

interface ConfiguracionLayoutProps {
  children: ReactNode;
  title: string;
  description?: string;
}

export const ConfiguracionLayout = ({ children, title, description }: ConfiguracionLayoutProps) => {
  const { user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const getInitials = () => {
    if (!user) return "??";
    const nombre = user.nombre || "";
    const apellido = user.apellido || "";
    return `${nombre.charAt(0)}${apellido.charAt(0)}`.toUpperCase() || "AD";
  };

  const getRoleName = () => {
    if (!user) return "Usuario";
    switch (user.role) {
      case 'admin': return 'Administrador';
      case 'vendedor': return 'Vendedor';
      case 'delivery': return 'Delivery';
      case 'cliente': return 'Cliente';
      default: return user.role;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <ConfiguracionSidebar />
      <div className="lg:pl-64">
        {/* Mobile Header */}
        <header className="lg:hidden sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-primary px-4 text-primary-foreground">
          <button onClick={() => setMenuOpen(true)} className="p-2 -ml-2" aria-label="Abrir menú de configuración">
            <Menu className="h-6 w-6" />
          </button>
          <h1 className="font-semibold truncate">{title}</h1>
          <div className="h-8 w-8 rounded-full bg-white/20 flex items-center justify-center">
            <span className="text-sm font-semibold">{getInitials()}</span>
          </div>
        </header>

        {/* Desktop Header */}
        <header className="hidden lg:flex sticky top-0 z-30 h-16 items-center justify-between border-b border-border bg-card px-6">
          <div>
            <h1 className="text-xl font-semibold text-foreground">{title}</h1>
            {description && (
              <p className="text-sm text-muted-foreground">{description}</p>
            )}
          </div>
          <div className="flex items-center gap-4">
            <NotificationsDropdown />
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-full bg-primary/20 flex items-center justify-center">
                <span className="text-sm font-semibold text-primary">{getInitials()}</span>
              </div>
              <div className="hidden sm:block">
                <p className="text-sm font-medium">{user?.nombre || 'Usuario'} {user?.apellido || ''}</p>
                <p className="text-xs text-muted-foreground">{getRoleName()}</p>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="p-4 lg:p-6">
          {description && <p className="mb-4 text-sm text-muted-foreground lg:hidden">{description}</p>}
          {children}
        </main>
      </div>

      {/* Mobile Config Nav Drawer */}
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetHeader className="border-b border-border p-4">
            <SheetTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-primary" />
              Configuración
            </SheetTitle>
          </SheetHeader>
          <div className="border-b border-border p-4">
            <NavLink to="/admin/dashboard" onClick={() => setMenuOpen(false)}>
              <Button variant="ghost" className="w-full justify-start gap-2 text-muted-foreground">
                <ArrowLeft className="h-4 w-4" />
                Volver al Dashboard
              </Button>
            </NavLink>
          </div>
          <nav className="space-y-1 overflow-y-auto p-4">
            {configNavItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`
                }
              >
                <item.icon className="h-5 w-5" />
                {item.label}
              </NavLink>
            ))}
          </nav>
        </SheetContent>
      </Sheet>
    </div>
  );
};
