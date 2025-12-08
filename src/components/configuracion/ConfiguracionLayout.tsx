import { ReactNode } from "react";
import { ConfiguracionSidebar } from "./ConfiguracionSidebar";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

interface ConfiguracionLayoutProps {
  children: ReactNode;
  title: string;
  description?: string;
}

export const ConfiguracionLayout = ({ children, title, description }: ConfiguracionLayoutProps) => {
  const { user } = useAuth();
  
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
      <div className="pl-64">
        {/* Header */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-card px-6">
          <div>
            <h1 className="text-xl font-semibold text-foreground">{title}</h1>
            {description && (
              <p className="text-sm text-muted-foreground">{description}</p>
            )}
          </div>
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="h-5 w-5" />
            </Button>
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
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
};
