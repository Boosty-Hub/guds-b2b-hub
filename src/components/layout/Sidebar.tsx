import { cn } from "@/lib/utils";
import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  ShoppingCart,
  Users,
  Package,
  Warehouse,
  Tags,
  CreditCard,
  Settings,
  LogOut,
  Truck,
  Ticket,
  Image,
  FolderOpen,
  UserPlus,
} from "lucide-react";
import gudsLogo from "@/assets/guds-logo.png";
import { supabase } from "@/lib/supabase";

const navItems = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/admin/dashboard" },
  { icon: ShoppingCart, label: "Órdenes", path: "/admin/ordenes" },
  { icon: Users, label: "Clientes", path: "/admin/clientes" },
  { icon: UserPlus, label: "Registros", path: "/admin/registros" },
  { icon: Package, label: "Productos", path: "/admin/productos" },
  { icon: FolderOpen, label: "Categorías", path: "/admin/categorias" },
  { icon: Warehouse, label: "Inventario", path: "/admin/inventario" },
  { icon: Tags, label: "Precios", path: "/admin/precios" },
  { icon: Ticket, label: "Cupones", path: "/admin/cupones" },
  { icon: Image, label: "Banners", path: "/admin/banners" },
  { icon: CreditCard, label: "Cuentas", path: "/admin/cuentas" },
  { icon: Truck, label: "Delivery", path: "/admin/delivery" },
];

export function Sidebar() {
  const navigate = useNavigate();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-64 border-r border-sidebar-border bg-sidebar">
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className="flex h-20 items-center justify-center border-b border-sidebar-border px-6">
          <img src={gudsLogo} alt="GUDS Logo" className="h-14 w-auto" />
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )
              }
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Bottom section */}
        <div className="border-t border-sidebar-border p-3">
          <NavLink
            to="/admin/configuracion"
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )
            }
          >
            <Settings className="h-5 w-5" />
            Configuración
          </NavLink>
          <button 
            onClick={handleLogout}
            className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground transition-all duration-200 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <LogOut className="h-5 w-5" />
            Cerrar Sesión
          </button>
        </div>
      </div>
    </aside>
  );
}
