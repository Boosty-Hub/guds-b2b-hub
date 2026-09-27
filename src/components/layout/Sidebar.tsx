import { useState } from "react";
import { cn } from "@/lib/utils";
import { NavLink, useNavigate } from "react-router-dom";
import {
  Settings,
  LogOut,
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

import { navSections, type NavItem } from "./navegacion";

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
      "flex items-center rounded-md text-[13px] font-medium transition-all duration-200",
      collapsed ? "justify-center h-8 w-8 mx-auto" : "gap-2.5 px-2.5 py-1.5",
      isActive
        ? "bg-primary text-primary-foreground shadow-sm"
        : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
    );

  const renderItem = (item: NavItem) => {
    const link = (
      <NavLink key={item.path} to={item.path} className={({ isActive }) => linkClass(isActive)}>
        <item.icon className="h-4 w-4 shrink-0" />
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
          collapsed ? "w-14" : "w-56"
        )}
      >
        <div className="flex h-full flex-col">
          {/* Logo + toggle */}
          <div
            className={cn(
              "flex h-12 items-center border-b border-sidebar-border",
              collapsed ? "justify-center px-2" : "justify-between px-4"
            )}
          >
            {!collapsed && <Logo className="h-8 text-primary" />}
            <button
              onClick={onToggleCollapse}
              className="rounded-md p-1.5 text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              title={collapsed ? "Expandir menú" : "Colapsar menú"}
            >
              {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto px-2 py-2">
            {sections.map((section, idx) => (
              <div key={section.title} className={cn(idx > 0 && (collapsed ? "mt-1.5 border-t border-sidebar-border pt-1.5" : "mt-2"))}>
                {collapsed ? (
                  <div className="space-y-0.5">{section.items.map(renderItem)}</div>
                ) : (
                  <>
                    <button
                      onClick={() => toggleSection(section.title)}
                      className="flex w-full items-center justify-between rounded-md px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/60 transition-colors hover:text-sidebar-foreground"
                    >
                      {section.title}
                      <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !isSectionOpen(section.title) && "-rotate-90")} />
                    </button>
                    {isSectionOpen(section.title) && <div className="mt-0.5 space-y-0.5">{section.items.map(renderItem)}</div>}
                  </>
                )}
              </div>
            ))}
          </nav>

          {/* Bottom section */}
          <div className="border-t border-sidebar-border p-2">
            {(() => {
              const cfg = (
                <NavLink
                  to="/admin/configuracion"
                  className={({ isActive }) => linkClass(isActive)}
                >
                  <Settings className="h-4 w-4 shrink-0" />
                  {!collapsed && "Configuración"}
                </NavLink>
              );
              const logout = (
                <button
                  onClick={handleLogout}
                  className={cn(
                    "mt-0.5 flex items-center rounded-md text-[13px] font-medium text-sidebar-foreground transition-all duration-200 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    collapsed ? "justify-center h-8 w-8 mx-auto" : "w-full gap-2.5 px-2.5 py-1.5"
                  )}
                >
                  <LogOut className="h-4 w-4 shrink-0" />
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
