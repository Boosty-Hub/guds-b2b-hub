import { NavLink } from "react-router-dom";
import { 
  Users, 
  Building2, 
  Bell, 
  Shield, 
  CreditCard,
  Truck,
  FileText,
  ArrowLeft,
  Settings,
  Wallet,
  DollarSign,
  Package,
  Smile
} from "lucide-react";
import { Button } from "@/components/ui/button";
import gudsLogo from "@/assets/guds-logo.png";

const navItems = [
  { icon: Users, label: "Usuarios", path: "/admin/configuracion/usuarios" },
  { icon: Building2, label: "Empresa", path: "/admin/configuracion/empresa" },
  { icon: Wallet, label: "Métodos de Pago", path: "/admin/configuracion/metodos-pago" },
  { icon: DollarSign, label: "Moneda", path: "/admin/configuracion/moneda" },
  { icon: Package, label: "Empaques", path: "/admin/configuracion/empaques" },
  { icon: Smile, label: "Iconos", path: "/admin/configuracion/iconos" },
  { icon: Bell, label: "Notificaciones", path: "/admin/configuracion/notificaciones" },
  { icon: Shield, label: "Seguridad", path: "/admin/configuracion/seguridad" },
  { icon: CreditCard, label: "Facturación", path: "/admin/configuracion/facturacion" },
  { icon: Truck, label: "Envíos", path: "/admin/configuracion/envios" },
  { icon: FileText, label: "Plantillas", path: "/admin/configuracion/plantillas" },
];

export const ConfiguracionSidebar = () => {
  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-64 border-r border-border bg-card">
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 border-b border-border px-6">
          <img src={gudsLogo} alt="GUDS" className="h-10 w-auto" />
        </div>

        {/* Back to Admin */}
        <div className="border-b border-border p-4">
          <NavLink to="/admin/dashboard">
            <Button variant="ghost" className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />
              Volver al Dashboard
            </Button>
          </NavLink>
        </div>

        {/* Config Header */}
        <div className="p-4">
          <div className="rounded-lg bg-primary/10 p-3">
            <div className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-primary" />
              <span className="font-semibold text-foreground">Configuración</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Administra tu sistema</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 px-4">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
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
      </div>
    </aside>
  );
};
