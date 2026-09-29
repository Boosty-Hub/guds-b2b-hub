import { ReactNode, useEffect, useRef, useState } from "react";
import { VendedorSidebar } from "./VendedorSidebar";
import { navItems as navVendedor, accionesRapidas } from "./navegacion";
import { BuscadorGlobal, type ModuloBuscador } from "@/components/BuscadorGlobal";
import { NavLink, useNavigate } from "react-router-dom";
import {
  Menu,
  Sun,
  Wallet,
  ShoppingCart,
  CreditCard,
  ArrowLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CurrencySwitch } from "@/components/CurrencySwitch";
import { cargaDiferida } from "@/lib/cargaDiferida";
import { BotonAccionRapida } from "./BotonAccionRapida";
import { NotificationsDropdown } from "@/components/portal/NotificationsDropdown";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { BoostySupportSlot } from "@/components/support/BoostySupportSlot";
import { EmpresaSelector, ModoConsultaBanner } from "@/components/EmpresaSelector";
import { useAccesibilidadPortal } from "@/components/portal/accesibilidad";

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

// Menú hamburguesa (el mismo menú del sidebar, navegacion.ts) y acciones rápidas: Radix Sheet / DropdownMenu se descargan
// aparte (MenusVendedor), cuando el navegador queda libre o al tocarlos por primera vez.
const menus = cargaDiferida(() => import("./MenusVendedor"));

// Accesos "Ir a" del buscador del vendedor
const modulosVendedor: ModuloBuscador[] = [...accionesRapidas, ...navVendedor].map((i) => ({ label: i.label, path: i.path, seccion: "Portal vendedor" }));

const claseNavMovil = ({ isActive }: { isActive: boolean }) =>
  `flex min-w-0 flex-1 flex-col items-center gap-1 px-1 py-2 ${isActive ? "text-emerald-700" : "text-muted-foreground"}`;

export const VendedorLayout = ({ children, title, pantallaCompletaMovil = false }: VendedorLayoutProps) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();
  useAccesibilidadPortal();
  const menusVendedor = menus.useModulo();
  useEffect(() => { if (isMobileMenuOpen) menus.pedir(); }, [isMobileMenuOpen]);

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
      <header className={cn("md:hidden sticky top-0 z-50 bg-emerald-800 text-white", pantallaCompletaMovil && "hidden")}>
        <div className="flex h-12 items-center gap-1 px-2">
          <button onClick={() => setIsMobileMenuOpen(true)} className="shrink-0 p-1.5" aria-label="Abrir menú">
            <Menu className="h-6 w-6" aria-hidden />
          </button>
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold" data-testid="titulo-movil">{title}</h1>
          <NotificationsDropdown variant="header" />
        </div>
        {/* Alto reservado (36 px + margen): el botón de soporte llega después y no debe empujar la pantalla (CLS) */}
        <div className="flex min-h-11 items-center gap-1.5 px-2 pb-2">
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
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">{title}</h1>
          <div className="flex shrink-0 items-center gap-2 lg:gap-3">
            <BuscadorGlobal contexto="vendedor" modulos={modulosVendedor} className="hidden lg:flex" />
            <EmpresaSelector compacto className="lg:hidden" />
            <EmpresaSelector className="hidden lg:inline-flex" />
            {/* La tasa junto a la moneda solo cabe desde xl */}
            <div className="[&_span.text-xs]:hidden xl:[&_span.text-xs]:block">
              <CurrencySwitch />
            </div>
            <NotificationsDropdown />
            <BoostySupportSlot media="(min-width: 768px)" />
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-emerald-500/20 flex items-center justify-center" aria-hidden>
                <span className="text-sm font-semibold text-emerald-800">
                  {user ? getInitials(user.nombre, user.apellido) : 'V'}
                </span>
              </div>
              <div className="hidden lg:block">
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
      <nav className={cn("md:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border z-50", pantallaCompletaMovil && "hidden")} data-testid="nav-movil" aria-label="Navegación principal">
        <div className="flex h-16 items-center justify-around">
          {mobileNavIzq.map((item) => (
            <NavLink key={item.path} to={item.path} end={item.path === "/vendedor"} className={claseNavMovil}>
              <item.icon className="h-5 w-5" aria-hidden />
              <span className="text-xs">{item.label}</span>
            </NavLink>
          ))}
          <div className="flex flex-1 justify-center">
            <AccionesRapidas modulo={menusVendedor} />
          </div>
          {mobileNavDer.map((item) => (
            <NavLink key={item.path} to={item.path} className={claseNavMovil}>
              <item.icon className="h-5 w-5" aria-hidden />
              <span className="text-xs">{item.label}</span>
            </NavLink>
          ))}
        </div>
        <div className="h-safe-area-inset-bottom bg-card" />
      </nav>

      {/* Mobile Menu Sheet */}
      {menusVendedor && <menusVendedor.MenuMovilVendedor abierto={isMobileMenuOpen} setAbierto={setIsMobileMenuOpen} onLogout={handleLogout} />}
    </div>
  );
};

/** Botón central de la barra del teléfono: se pinta con la pantalla; su menú llega aparte (si se toca antes, se abre al llegar). */
function AccionesRapidas({ modulo }: { modulo: typeof import("./MenusVendedor") | null }) {
  const [abrir, setAbrir] = useState(false);
  const foco = useRef(false);
  if (modulo) return <modulo.AccionesRapidasMenu abrirAlMontar={abrir} enfocar={foco.current} />;
  return (
    <BotonAccionRapida
      aria-haspopup="menu"
      aria-expanded={false}
      onPointerEnter={menus.pedir}
      onFocus={() => { foco.current = true; menus.pedir(); }}
      onBlur={() => { foco.current = false; }}
      onClick={() => { setAbrir(true); menus.pedir(); }}
    />
  );
}

/** Barra superior propia de una pantalla completa en el teléfono (Nuevo pedido, Registrar cobro): volver, título y extra. */
export const BarraSuperiorMovil = ({ titulo, subtitulo, volverA, onVolver, derecha }: {
  titulo: string; subtitulo?: ReactNode; volverA?: string; onVolver?: () => void; derecha?: ReactNode;
}) => {
  const navigate = useNavigate();
  return (
    <header className="sticky top-0 z-40 flex min-h-12 items-center gap-1 bg-emerald-800 px-1.5 py-1 text-white md:hidden" data-testid="barra-movil">
      <button type="button" aria-label="Volver" className="shrink-0 rounded-md p-2 active:bg-white/15"
        onClick={() => (onVolver ? onVolver() : volverA ? navigate(volverA) : navigate(-1))}>
        <ArrowLeft className="h-5 w-5" aria-hidden />
      </button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-semibold leading-tight" data-testid="titulo-movil">{titulo}</h1>
        {subtitulo && <div className="truncate text-xs leading-tight text-white/85">{subtitulo}</div>}
      </div>
      {derecha}
    </header>
  );
};
