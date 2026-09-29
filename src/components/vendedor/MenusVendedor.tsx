import { useEffect, useRef, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { LogOut } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/contexts/AuthContext";
import { navItems, accionesRapidas } from "./navegacion";
import { BotonAccionRapida } from "./BotonAccionRapida";

// Menús del portal del vendedor que no se ven al cargar (acciones rápidas y menú del teléfono). Se descargan aparte,
// cuando el navegador queda libre o al tocarlos por primera vez: ver VendedorLayout.

const iniciales = (nombre?: string, apellido?: string) => `${nombre?.charAt(0) || ""}${apellido?.charAt(0) || ""}`.toUpperCase() || "V";

/** "Nuevo pedido / Registrar cobro" (Radix DropdownMenu) del botón central de la barra del teléfono. */
export function AccionesRapidasMenu({ abrirAlMontar = false, enfocar = false }: { abrirAlMontar?: boolean; enfocar?: boolean }) {
  const [abierto, setAbierto] = useState(abrirAlMontar);
  const boton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (enfocar) boton.current?.focus(); }, [enfocar]);
  return (
    <DropdownMenu modal={false} open={abierto} onOpenChange={setAbierto}>
      <DropdownMenuTrigger asChild>
        <BotonAccionRapida ref={boton} />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="center" sideOffset={10} className="w-52">
        {accionesRapidas.map((a) => (
          <DropdownMenuItem key={a.path} asChild className="h-11 gap-2.5 text-sm">
            <Link to={a.path}><a.icon className="h-4 w-4 text-emerald-700" aria-hidden />{a.label}</Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Menú hamburguesa del teléfono (Radix Sheet): las mismas secciones del sidebar (navegacion.ts). */
export function MenuMovilVendedor({ abierto, setAbierto, onLogout }: { abierto: boolean; setAbierto: (v: boolean) => void; onLogout: () => void }) {
  const { user } = useAuth();
  return (
    <Sheet open={abierto} onOpenChange={setAbierto}>
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
              <div className="h-12 w-12 rounded-full bg-emerald-500/20 flex items-center justify-center" aria-hidden>
                <span className="text-lg font-semibold text-emerald-800">
                  {iniciales(user?.nombre, user?.apellido)}
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
        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto p-4" aria-label="Secciones del portal">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === "/vendedor"}
              onClick={() => setAbierto(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-emerald-700 text-white"
                    : "text-muted-foreground hover:bg-muted"
                }`
              }
            >
              <item.icon className="h-5 w-5" aria-hidden />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Logout */}
        <div className="shrink-0 border-t border-border p-4">
          <button
            onClick={onLogout}
            className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-destructive hover:bg-destructive/10"
          >
            <LogOut className="h-5 w-5" aria-hidden />
            Cerrar Sesión
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
