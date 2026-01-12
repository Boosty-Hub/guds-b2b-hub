import { ReactNode, useState, useEffect } from "react";
import { NavLink, useLocation, Link } from "react-router-dom";
import { Home, Search, ShoppingCart, ClipboardList, User, Bell } from "lucide-react";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { useDeviceType } from "@/hooks/use-mobile";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { CurrencySwitch } from "@/components/CurrencySwitch";
import { Button } from "@/components/ui/button";

interface PortalMobileLayoutProps {
  children: ReactNode;
  title?: string;
  showHeader?: boolean;
  showNav?: boolean;
  cartCount?: number;
}

const navItems = [
  { icon: Home, label: "Inicio", path: "/portal" },
  { icon: Search, label: "Buscar", path: "/portal/catalogo" },
  { icon: ShoppingCart, label: "Carrito", path: "/portal/carrito" },
  { icon: ClipboardList, label: "Pedidos", path: "/portal/pedidos" },
  { icon: User, label: "Cuenta", path: "/portal/cuenta" },
];

export const PortalMobileLayout = ({ 
  children, 
  title,
  showHeader = true,
  showNav = true,
  cartCount = 0
}: PortalMobileLayoutProps) => {
  const location = useLocation();
  const { currency, setCurrency } = useCurrency();
  const { user } = useAuth();
  const [nombreEmpresa, setNombreEmpresa] = useState<string>("");
  const deviceType = useDeviceType();
  const isTablet = deviceType === "tablet";

  useEffect(() => {
    if (user?.cliente_id) {
      fetchClienteNombre();
    }
  }, [user]);

  const fetchClienteNombre = async () => {
    const { data } = await supabase
      .from('clientes')
      .select('nombre_negocio')
      .eq('id', user?.cliente_id)
      .single();
    
    if (data) setNombreEmpresa(data.nombre_negocio);
  };

  const getInitials = () => {
    if (!user) return "U";
    const first = user.nombre?.charAt(0) || "";
    const last = user.apellido?.charAt(0) || "";
    return (first + last).toUpperCase() || "U";
  };

  // Para tablet (iPad), usamos un contenedor más amplio
  const containerClass = isTablet 
    ? "min-h-screen bg-muted max-w-3xl mx-auto relative" 
    : "min-h-screen bg-muted max-w-md mx-auto relative";

  return (
    <div className={containerClass}>
      {/* Status Bar Simulation - solo en móvil */}
      {!isTablet && <div className="bg-primary h-6 w-full" />}

      {/* Header */}
      {showHeader && (
        <header className={`bg-primary text-primary-foreground sticky top-0 z-50 ${isTablet ? 'px-6 py-4' : 'px-4 py-3'}`}>
          <div className="flex items-center justify-between">
            <div>
              {title ? (
                <h1 className={`font-semibold ${isTablet ? 'text-xl' : 'text-lg'}`}>{title}</h1>
              ) : (
                <div>
                  <p className={`opacity-80 ${isTablet ? 'text-sm' : 'text-xs'}`}>Hola, {user?.nombre || 'Usuario'}</p>
                  <p className={`font-semibold ${isTablet ? 'text-base' : 'text-sm'}`}>{nombreEmpresa || 'Mi Negocio'}</p>
                </div>
              )}
            </div>
            <div className="flex items-center gap-3">
              {isTablet ? (
                <>
                  <CurrencySwitch variant="header" />
                  <Link to="/portal/cuenta/notificaciones">
                    <Button variant="ghost" size="icon" className="relative text-primary-foreground hover:bg-white/20">
                      <Bell className="h-5 w-5" />
                      <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-white text-xs text-primary font-semibold">
                        3
                      </span>
                    </Button>
                  </Link>
                  <Link to="/portal/cuenta">
                    <Avatar className="h-9 w-9 border-2 border-white/30">
                      <AvatarImage src={user?.avatar} alt={user?.nombre || "Usuario"} />
                      <AvatarFallback className="bg-white/20 text-primary-foreground font-semibold text-sm">
                        {getInitials()}
                      </AvatarFallback>
                    </Avatar>
                  </Link>
                </>
              ) : (
                <button
                  onClick={() => setCurrency(currency === "USD" ? "BS" : "USD")}
                  className="bg-white/20 px-2 py-1 rounded text-xs font-medium"
                >
                  {currency === "USD" ? "$ USD" : "Bs."}
                </button>
              )}
            </div>
          </div>
        </header>
      )}

      {/* Main Content */}
      <main className={`${showNav ? (isTablet ? "pb-24" : "pb-20") : ""}`}>
        {children}
      </main>

      {/* Bottom Navigation */}
      {showNav && (
        <nav className={`fixed bottom-0 left-0 right-0 ${isTablet ? 'max-w-3xl' : 'max-w-md'} mx-auto bg-card border-t border-border z-50`}>
          <div className={`flex items-center justify-around ${isTablet ? 'py-3' : 'py-2'}`}>
            {navItems.map((item) => {
              const isActive = location.pathname === item.path || 
                (item.path === "/portal" && location.pathname === "/portal");
              const isCart = item.path === "/portal/carrito";
              
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={`flex flex-col items-center gap-1 ${isTablet ? 'px-6 py-2' : 'px-3 py-1'} relative`}
                >
                  <div className="relative">
                    <item.icon 
                      className={`${isTablet ? 'h-7 w-7' : 'h-6 w-6'} ${isActive ? "text-primary" : "text-muted-foreground"}`} 
                    />
                    {isCart && cartCount > 0 && (
                      <span className={`absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center font-medium ${isTablet ? 'text-sm h-6 w-6' : 'text-xs h-5 w-5'}`}>
                        {cartCount}
                      </span>
                    )}
                  </div>
                  <span className={`${isTablet ? 'text-sm' : 'text-xs'} ${isActive ? "text-primary font-medium" : "text-muted-foreground"}`}>
                    {item.label}
                  </span>
                </NavLink>
              );
            })}
          </div>
          {/* Safe Area */}
          <div className={`${isTablet ? 'h-3' : 'h-2'} bg-card`} />
        </nav>
      )}
    </div>
  );
};
