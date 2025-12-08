import { NavLink, useNavigate } from "react-router-dom";
import { 
  LayoutDashboard, 
  Package, 
  Map, 
  CheckSquare,
  LogOut,
  Truck
} from "lucide-react";
import gudsLogo from "@/assets/guds-logo.png";
import { supabase } from "@/lib/supabase";

const navItems = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/delivery" },
  { icon: Package, label: "Mis Entregas", path: "/delivery/entregas" },
  { icon: Map, label: "Mi Ruta", path: "/delivery/ruta" },
  { icon: CheckSquare, label: "Historial", path: "/delivery/historial" },
];

export const DeliverySidebar = () => {
  const navigate = useNavigate();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-64 border-r border-border bg-card">
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 border-b border-border px-6">
          <img src={gudsLogo} alt="GUDS" className="h-10 w-auto" />
        </div>

        {/* Driver Info */}
        <div className="border-b border-border p-4">
          <div className="rounded-lg bg-amber-500/10 p-3">
            <div className="flex items-center gap-2 mb-1">
              <Truck className="h-4 w-4 text-amber-500" />
              <p className="text-xs font-medium text-amber-500">Portal Delivery</p>
            </div>
            <p className="font-semibold text-foreground">Carlos Ruiz</p>
            <p className="text-xs text-muted-foreground mt-1">Camioneta Ford • Zona Centro</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 p-4">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === "/delivery"}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-amber-500 text-white"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`
              }
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Logout */}
        <div className="border-t border-border p-4">
          <button 
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <LogOut className="h-5 w-5" />
            Cerrar Sesión
          </button>
        </div>
      </div>
    </aside>
  );
};
