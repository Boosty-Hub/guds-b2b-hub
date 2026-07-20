import { NavLink } from "react-router-dom";
import { LayoutDashboard, ShoppingCart, Package, CreditCard, User, LogOut } from "lucide-react";
import { Logo } from "@/components/Logo";

const navItems = [
  { icon: LayoutDashboard, label: "Inicio", path: "/portal" },
  { icon: ShoppingCart, label: "Catálogo", path: "/portal/catalogo" },
  { icon: Package, label: "Mis Pedidos", path: "/portal/pedidos" },
  { icon: CreditCard, label: "Pagos", path: "/portal/pagos" },
  { icon: User, label: "Mi Cuenta", path: "/portal/cuenta" },
];

export const PortalSidebar = () => {
  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-64 border-r border-border bg-card">
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 border-b border-border px-6">
          <Logo className="h-10 text-primary" />
        </div>

        {/* Client Info */}
        <div className="border-b border-border p-4">
          <div className="rounded-lg bg-primary/10 p-3">
            <p className="text-xs text-muted-foreground">Empresa</p>
            <p className="font-semibold text-foreground">Walmart México</p>
            <p className="text-xs text-muted-foreground mt-1">Sede Centro</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 p-4">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === "/portal"}
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

        {/* Logout */}
        <div className="border-t border-border p-4">
          <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive">
            <LogOut className="h-5 w-5" />
            Cerrar Sesión
          </button>
        </div>
      </div>
    </aside>
  );
};
