import { NavLink, useNavigate } from "react-router-dom";
import { LogOut, TrendingUp } from "lucide-react";
import { navItems } from "./navegacion";
import { Logo } from "@/components/Logo";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";


export const VendedorSidebar = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-56 border-r border-border bg-card">
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className="flex h-12 items-center gap-3 border-b border-border px-4">
          <Logo className="h-8 text-primary" />
        </div>

        {/* Seller Info */}
        <div className="border-b border-border px-3 py-2">
          <div className="rounded-md bg-emerald-500/10 px-2.5 py-1.5">
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-600"><TrendingUp className="h-3.5 w-3.5" /> Portal Vendedor</p>
            <p className="truncate text-[13px] font-semibold text-foreground">{user ? `${user.nombre} ${user.apellido || ""}` : "Vendedor"}</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === "/vendedor"}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
                  isActive
                    ? "bg-emerald-500 text-white"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Logout */}
        <div className="border-t border-border p-2">
          <button 
            onClick={handleLogout}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <LogOut className="h-4 w-4" />
            Cerrar Sesión
          </button>
        </div>
      </div>
    </aside>
  );
};
