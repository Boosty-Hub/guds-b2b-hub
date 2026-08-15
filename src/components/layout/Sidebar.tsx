import { useState } from "react";
import { cn } from "@/lib/utils";
import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  ShoppingCart,
  Users,
  Package,
  Warehouse,
  Boxes,
  Tags,
  CreditCard,
  Settings,
  LogOut,
  Truck,
  Ticket,
  Image,
  FolderOpen,
  UserPlus,
  HandCoins,
  Landmark,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { supabase } from "@/lib/supabase";
import { usePermissions } from "@/contexts/PermissionsContext";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type NavItem = { icon: React.ComponentType<{ className?: string }>; label: string; path: string; modulo: string };
type NavSection = { title: string; items: NavItem[] };

const navSections: NavSection[] = [
  {
    title: "Principal",
    items: [{ icon: LayoutDashboard, label: "Dashboard", path: "/admin/dashboard", modulo: "dashboard" }],
  },
  {
    title: "Ventas",
    items: [
      { icon: ShoppingCart, label: "Órdenes", path: "/admin/ordenes", modulo: "ordenes" },
      { icon: Users, label: "Clientes", path: "/admin/clientes", modulo: "clientes" },
      { icon: UserPlus, label: "Registros", path: "/admin/registros", modulo: "registros" },
    ],
  },
  {
    title: "Catálogo",
    items: [
      { icon: Package, label: "Productos", path: "/admin/productos", modulo: "productos" },
      { icon: FolderOpen, label: "Categorías", path: "/admin/categorias", modulo: "categorias" },
      { icon: Tags, label: "Precios", path: "/admin/precios", modulo: "precios" },
      { icon: Ticket, label: "Cupones", path: "/admin/cupones", modulo: "cupones" },
      { icon: Image, label: "Banners", path: "/admin/banners", modulo: "banners" },
    ],
  },
  {
    title: "Inventario",
    items: [
      { icon: Warehouse, label: "Inventario", path: "/admin/inventario", modulo: "inventario" },
      { icon: Boxes, label: "Almacenes", path: "/admin/almacenes", modulo: "inventario" },
    ],
  },
  {
    title: "Finanzas",
    items: [
      { icon: CreditCard, label: "Cuentas", path: "/admin/cuentas", modulo: "cuentas" },
      { icon: HandCoins, label: "Cuentas por Cobrar", path: "/admin/cuentas-por-cobrar", modulo: "cuentas" },
      { icon: Landmark, label: "Bancos", path: "/admin/bancos", modulo: "bancos" },
    ],
  },
  {
    title: "Logística",
    items: [{ icon: Truck, label: "Delivery", path: "/admin/delivery", modulo: "delivery" }],
  },
];

const SECTIONS_KEY = "guds-sb-sections";

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function Sidebar({ collapsed, onToggleCollapse }: SidebarProps) {
  const navigate = useNavigate();
  const { can } = usePermissions();

  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(SECTIONS_KEY) || "{}"); } catch { return {}; }
  });
  const isSectionOpen = (title: string) => openSections[title] !== false; // abierto por defecto
  const toggleSection = (title: string) => {
    setOpenSections((prev) => {
      const next = { ...prev, [title]: prev[title] === false ? true : false };
      localStorage.setItem(SECTIONS_KEY, JSON.stringify(next));
      return next;
    });
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  // Filtrar por permisos y descartar secciones vacías
  const sections = navSections
    .map((s) => ({ ...s, items: s.items.filter((i) => i.modulo === "dashboard" || can(i.modulo, "ver")) }))
    .filter((s) => s.items.length > 0);

  const linkClass = (isActive: boolean) =>
    cn(
      "flex items-center rounded-lg text-sm font-medium transition-all duration-200",
      collapsed ? "justify-center h-10 w-10 mx-auto" : "gap-3 px-3 py-2.5",
      isActive
        ? "bg-primary text-primary-foreground shadow-sm"
        : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
    );

  const renderItem = (item: NavItem) => {
    const link = (
      <NavLink key={item.path} to={item.path} className={({ isActive }) => linkClass(isActive)}>
        <item.icon className="h-5 w-5 shrink-0" />
        {!collapsed && <span className="truncate">{item.label}</span>}
      </NavLink>
    );
    if (!collapsed) return link;
    return (
      <Tooltip key={item.path} delayDuration={0}>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right">{item.label}</TooltipContent>
      </Tooltip>
    );
  };

  return (
    <TooltipProvider>
      <aside
        className={cn(
          "fixed left-0 top-0 z-40 h-screen border-r border-sidebar-border bg-sidebar transition-[width] duration-200",
          collapsed ? "w-16" : "w-64"
        )}
      >
        <div className="flex h-full flex-col">
          {/* Logo + toggle */}
          <div
            className={cn(
              "flex h-20 items-center border-b border-sidebar-border",
              collapsed ? "justify-center px-2" : "justify-between px-4"
            )}
          >
            {!collapsed && <Logo className="h-12 text-primary" />}
            <button
              onClick={onToggleCollapse}
              className="rounded-lg p-2 text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              title={collapsed ? "Expandir menú" : "Colapsar menú"}
            >
              {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto px-3 py-4">
            {sections.map((section, idx) => (
              <div key={section.title} className={cn(idx > 0 && (collapsed ? "mt-2 border-t border-sidebar-border pt-2" : "mt-4"))}>
                {collapsed ? (
                  <div className="space-y-1">{section.items.map(renderItem)}</div>
                ) : (
                  <>
                    <button
                      onClick={() => toggleSection(section.title)}
                      className="flex w-full items-center justify-between rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-sidebar-foreground/60 transition-colors hover:text-sidebar-foreground"
                    >
                      {section.title}
                      <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !isSectionOpen(section.title) && "-rotate-90")} />
                    </button>
                    {isSectionOpen(section.title) && <div className="mt-1 space-y-1">{section.items.map(renderItem)}</div>}
                  </>
                )}
              </div>
            ))}
          </nav>

          {/* Bottom section */}
          <div className="border-t border-sidebar-border p-3">
            {(() => {
              const cfg = (
                <NavLink
                  to="/admin/configuracion"
                  className={({ isActive }) => linkClass(isActive)}
                >
                  <Settings className="h-5 w-5 shrink-0" />
                  {!collapsed && "Configuración"}
                </NavLink>
              );
              const logout = (
                <button
                  onClick={handleLogout}
                  className={cn(
                    "mt-1 flex items-center rounded-lg text-sm font-medium text-sidebar-foreground transition-all duration-200 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    collapsed ? "justify-center h-10 w-10 mx-auto" : "w-full gap-3 px-3 py-2.5"
                  )}
                >
                  <LogOut className="h-5 w-5 shrink-0" />
                  {!collapsed && "Cerrar Sesión"}
                </button>
              );
              if (!collapsed) return <>{cfg}{logout}</>;
              return (
                <>
                  <Tooltip delayDuration={0}><TooltipTrigger asChild>{cfg}</TooltipTrigger><TooltipContent side="right">Configuración</TooltipContent></Tooltip>
                  <Tooltip delayDuration={0}><TooltipTrigger asChild>{logout}</TooltipTrigger><TooltipContent side="right">Cerrar Sesión</TooltipContent></Tooltip>
                </>
              );
            })()}
          </div>
        </div>
      </aside>
    </TooltipProvider>
  );
}
