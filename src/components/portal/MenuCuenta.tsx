import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { BotonCuenta } from "@/components/portal/BotonCuenta";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Menú de la cuenta (Radix DropdownMenu). Se descarga aparte: ver MenuCuenta en PortalShell. */
export function MenuCuentaDesplegable({ onCerrarSesion, abrirAlMontar = false, enfocar = false }: {
  onCerrarSesion: () => void;
  /** El usuario tocó el botón antes de que llegara el menú: se abre al montarse. */
  abrirAlMontar?: boolean;
  /** El botón tenía el foco: lo conserva. */
  enfocar?: boolean;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [abierto, setAbierto] = useState(abrirAlMontar);
  const boton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (enfocar) boton.current?.focus(); }, [enfocar]);
  return (
    <DropdownMenu modal={false} open={abierto} onOpenChange={setAbierto}>
      <DropdownMenuTrigger asChild>
        <BotonCuenta ref={boton} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <p className="truncate text-sm font-medium">{[user?.nombre, user?.apellido].filter(Boolean).join(" ") || "Mi cuenta"}</p>
          <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate("/portal/cuenta")}>Mi cuenta</DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate("/portal/cuenta/perfil")}>Datos personales</DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate("/portal/cuenta/seguridad")}>Seguridad</DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate("/portal/ayuda")}>Ayuda</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onCerrarSesion}>
          <LogOut className="mr-2 h-4 w-4" aria-hidden />Cerrar sesión
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
