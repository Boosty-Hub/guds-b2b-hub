import { ReactNode, useState, useEffect } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Home, Search, ShoppingCart, ClipboardList, User } from "lucide-react";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

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

  return (
    <div className="min-h-screen bg-background max-w-md mx-auto relative">
      {/* Status Bar Simulation */}
      <div className="bg-primary h-6 w-full" />

      {/* Header */}
      {showHeader && (
        <header className="bg-primary text-primary-foreground px-4 py-3 sticky top-0 z-50">
          <div className="flex items-center justify-between">
            <div>
              {title ? (
                <h1 className="text-lg font-semibold">{title}</h1>
              ) : (
                <div>
                  <p className="text-xs opacity-80">Hola, {user?.nombre || 'Usuario'}</p>
                  <p className="text-sm font-semibold">{nombreEmpresa || 'Mi Negocio'}</p>
                </div>
              )}
            </div>
            <div className="flex items-center gap-3">
              {/* Currency Toggle */}
              <button
                onClick={() => setCurrency(currency === "USD" ? "BS" : "USD")}
                className="bg-white/20 px-2 py-1 rounded text-xs font-medium"
              >
                {currency === "USD" ? "$ USD" : "Bs."}
              </button>
            </div>
          </div>
        </header>
      )}

      {/* Main Content */}
      <main className={`${showNav ? "pb-20" : ""}`}>
        {children}
      </main>

      {/* Bottom Navigation */}
      {showNav && (
        <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-card border-t border-border z-50">
          <div className="flex items-center justify-around py-2">
            {navItems.map((item) => {
              const isActive = location.pathname === item.path || 
                (item.path === "/portal" && location.pathname === "/portal");
              const isCart = item.path === "/portal/carrito";
              
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className="flex flex-col items-center gap-1 px-3 py-1 relative"
                >
                  <div className="relative">
                    <item.icon 
                      className={`h-6 w-6 ${isActive ? "text-primary" : "text-muted-foreground"}`} 
                    />
                    {isCart && cartCount > 0 && (
                      <span className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground text-xs rounded-full h-5 w-5 flex items-center justify-center font-medium">
                        {cartCount}
                      </span>
                    )}
                  </div>
                  <span className={`text-xs ${isActive ? "text-primary font-medium" : "text-muted-foreground"}`}>
                    {item.label}
                  </span>
                </NavLink>
              );
            })}
          </div>
          {/* Safe Area */}
          <div className="h-2 bg-card" />
        </nav>
      )}
    </div>
  );
};
