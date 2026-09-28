import { ReactNode, useState } from "react";
import { VendedorSidebar } from "./VendedorSidebar";
import { navItems as navVendedor, accionesRapidas } from "./navegacion";
import { BuscadorGlobal, type ModuloBuscador } from "@/components/BuscadorGlobal";
import { Link, NavLink, useNavigate } from "react-router-dom";
import {
  Menu,
  Sun,
  Wallet,
  ShoppingCart,
  CreditCard,
  LogOut,
  Plus,
  ArrowLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CurrencySwitch } from "@/components/CurrencySwitch";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Logo } from "@/components/Logo";
import { NotificationsDropdown } from "@/components/portal/NotificationsDropdown";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { BoostySupportSlot } from "@/components/support/BoostySupportSlot";
import { EmpresaSelector, ModoConsultaBanner } from "@/components/EmpresaSelector";

interface VendedorLayoutProps {
  children: ReactNode;
  title: string;
  /** En el teléfono la pantalla ocupa todo (sin header ni barra inferior): la página pone su propia barra (BarraSuperiorMovil). */
  pantallaCompletaMovil?: boolean;
}

// Barra inferior: Hoy · Cartera · [+] · Pedidos · Cobros. El botón central abre "Nuevo pedido / Registrar cobro";
// el resto (Clientes, Metas, Inventario, Consignación, Retenciones) está en el menú hamburguesa.
const mobileNavIzq = [
  { icon: Sun, label: "Hoy", path: "/vendedor" },
  { icon: Wallet, label: "Cartera", path: "/vendedor/cartera" },
];
const mobileNavDer = [
  { icon: ShoppingCart, label: "Pedidos", path: "/vendedor/pedidos" },
  { icon: CreditCard, label: "Cobros", path: "/vendedor/pagos" },
];

// Menú hamburguesa = el mismo menú del sidebar (navegacion.ts), para que ninguna entrada quede fuera en el teléfono
const sheetNavItems = navVendedor;

// Accesos "Ir a" del buscador del vendedor
const modulosVendedor: ModuloBuscador[] = [...accionesRapidas, ...navVendedor].map((i) => ({ label: i.label, path: i.path, seccion: "Portal vendedor" }));

const claseNavMovil = ({ isActive }: { isActive: boolean }) =>
  `flex min-w-0 flex-1 flex-col items-center gap-1 px-1 py-2 ${isActive ? "text-emerald-500" : "text-muted-foreground"}`;

export const VendedorLayout = ({ children, title, pantallaCompletaMovil = false }: VendedorLayoutProps) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  const getInitials = (nombre: string, apellido: string) => {
    return `${nombre?.charAt(0) || ''}${apellido?.charAt(0) || ''}`.toUpperCase() || 'V';
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop Sidebar */}
      <div className="hidden md:block">
        <VendedorSidebar />
      </div>

      {/* Mobile Header: en una sola fila los controles dejaban el título en 5 px. Fila 1: menú, título de la pantalla y
          campana; fila 2: buscador (ocupa lo que sobra), empresa, moneda y soporte. */}
      <header className={cn("md:hidden sticky top-0 z-50 bg-emerald-500 text-white", pantallaCompletaMovil && "hidden")}>
        <div className="flex h-12 items-center gap-1 px-2">
          <button onClick={() => setIsMobileMenuOpen(true)} className="shrink-0 p-1.5" aria-label="Abrir menú">
            <Menu className="h-6 w-6" />
          </button>
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold" data-testid="titulo-movil">{title}</h1>
          <NotificationsDropdown variant="header" />
        </div>
        <div className="flex items-center gap-1.5 px-2 pb-2">
          <BuscadorGlobal atajo={false} contexto="vendedor" modulos={modulosVendedor}
            className="w-auto min-w-0 flex-1 border-white/30 bg-white/15 text-white/90 hover:bg-white/25 [&_kbd]:hidden" />
          <EmpresaSelector variant="header" compacto />
          <CurrencySwitch variant="header" />
          <BoostySupportSlot media="(max-width: 767.98px)" />
        </div>
      </header>
      <div className={cn("md:hidden", pantallaCompletaMovil && "hidden")}>
        <ModoConsultaBanner />
      </div>

      {/* Desktop Header */}
      <div className="hidden md:block md:pl-56">
        <header className="sticky top-0 z-30 flex h-12 items-center justify-between gap-3 border-b border-border bg-card px-4">
          <h1 className="min-w-0 truncate text-base font-semibold text-foreground">{title}</h1>
          <div className="flex items-center gap-3">
            <BuscadorGlobal contexto="vendedor" modulos={modulosVendedor} className="hidden lg:flex" />
            <EmpresaSelector />
            <CurrencySwitch />
            <NotificationsDropdown />
            <BoostySupportSlot media="(min-width: 768px)" />
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
                <span className="text-sm font-semibold text-emerald-500">
                  {user ? getInitials(user.nombre, user.apellido) : 'V'}
                </span>
              </div>
              <div>
                <p className="text-[13px] font-medium leading-tight">{user?.nombre} {user?.apellido}</p>
                <p className="text-[11px] leading-tight text-muted-foreground">Vendedor</p>
              </div>
            </div>
          </div>
        </header>
        <ModoConsultaBanner />
      </div>

      {/* Main Content */}
      <main className={cn("md:pl-56 md:pb-0", pantallaCompletaMovil ? "pb-0" : "pb-20")}>
        <div className={pantallaCompletaMovil ? "md:p-4" : "p-3 md:p-4"}>{children}</div>
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className={cn("md:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border z-50", pantallaCompletaMovil && "hidden")} data-testid="nav-movil">
        <div className="flex h-16 items-center justify-around">
          {mobileNavIzq.map((item) => (
            <NavLink key={item.path} to={item.path} end={item.path === "/vendedor"} className={claseNavMovil}>
              <item.icon className="h-5 w-5" />
              <span className="text-xs">{item.label}</span>
            </NavLink>
          ))}
          <div className="flex flex-1 justify-center">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label="Nuevo pedido o cobro" data-testid="boton-accion-rapida"
                  className="-mt-5 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg ring-4 ring-background active:bg-emerald-600">
                  <Plus className="h-6 w-6" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="center" sideOffset={10} className="w-52">
                {accionesRapidas.map((a) => (
                  <DropdownMenuItem key={a.path} asChild className="h-11 gap-2.5 text-sm">
                    <Link to={a.path}><a.icon className="h-4 w-4 text-emerald-600" />{a.label}</Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {mobileNavDer.map((item) => (
            <NavLink key={item.path} to={item.path} className={claseNavMovil}>
              <item.icon className="h-5 w-5" />
              <span className="text-xs">{item.label}</span>
            </NavLink>
          ))}
        </div>
        <div className="h-safe-area-inset-bottom bg-card" />
      </nav>

      {/* Mobile Menu Sheet */}
      <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
        <SheetContent side="left" className="flex w-80 flex-col gap-0 p-0">
          <SheetHeader className="p-4 border-b border-border">
            <SheetTitle className="flex items-center gap-3">
              <Logo className="h-8 text-primary" />
            </SheetTitle>
          </SheetHeader>
          
          {/* User Info */}
          <div className="p-4 border-b border-border">
            <div className="rounded-xl bg-emerald-500/10 p-4">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <span className="text-lg font-semibold text-emerald-500">
                    {user ? getInitials(user.nombre, user.apellido) : 'V'}
                  </span>
                </div>
                <div>
                  <p className="font-semibold">{user?.nombre} {user?.apellido}</p>
                  <p className="text-sm text-muted-foreground">{user?.email}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Navigation: todas las secciones de navegacion.ts; se desplaza si la pantalla es baja */}
          <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto p-4">
            {sheetNavItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === "/vendedor"}
                onClick={() => setIsMobileMenuOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-emerald-500 text-white"
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
          <div className="shrink-0 border-t border-border p-4">
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

/** Barra superior propia de una pantalla completa en el teléfono (Nuevo pedido, Registrar cobro): volver, título y extra. */
export const BarraSuperiorMovil = ({ titulo, subtitulo, volverA, onVolver, derecha }: {
  titulo: string; subtitulo?: ReactNode; volverA?: string; onVolver?: () => void; derecha?: ReactNode;
}) => {
  const navigate = useNavigate();
  return (
    <header className="sticky top-0 z-40 flex min-h-12 items-center gap-1 bg-emerald-500 px-1.5 py-1 text-white md:hidden" data-testid="barra-movil">
      <button type="button" aria-label="Volver" className="shrink-0 rounded-md p-2 active:bg-white/15"
        onClick={() => (onVolver ? onVolver() : volverA ? navigate(volverA) : navigate(-1))}>
        <ArrowLeft className="h-5 w-5" />
      </button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-semibold leading-tight" data-testid="titulo-movil">{titulo}</h1>
        {subtitulo && <div className="truncate text-xs leading-tight text-white/85">{subtitulo}</div>}
      </div>
      {derecha}
    </header>
  );
};
