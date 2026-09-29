import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TODAS, useEmpresa } from "@/contexts/EmpresaContext";
import { BotonEmpresa, EmpresaDistintivo, type EmpresaSelectorProps } from "@/components/EmpresaSelector";

// Menú para cambiar de empresa (Radix). Se descarga aparte (ver EmpresaSelector): mientras tanto se ve el mismo botón.
export function EmpresaMenu({ variant = "default", compacto = false, className, abrirAlMontar = false, enfocar = false }: EmpresaSelectorProps & {
  /** El usuario tocó el botón antes de que llegara el menú: se abre al montarse. */
  abrirAlMontar?: boolean;
  /** El botón tenía el foco: lo conserva. */
  enfocar?: boolean;
}) {
  const { empresas, seleccion, puedeElegirAmbas, cambiarEmpresa } = useEmpresa();
  const [abierto, setAbierto] = useState(abrirAlMontar);
  const punteroTactil = useRef(false);
  const boton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (enfocar) boton.current?.focus(); }, [enfocar]);

  return (
    <DropdownMenu open={abierto} onOpenChange={setAbierto}>
      {/* En táctil Radix abre al apoyar el dedo; el clic de levantarlo caía en el botón vecino (Ticket).
          Ahí se abre con el clic completo. */}
      <DropdownMenuTrigger
        asChild
        onPointerDown={(e) => {
          punteroTactil.current = e.pointerType === "touch" || e.pointerType === "pen";
          if (punteroTactil.current) e.preventDefault();
        }}
        onClick={() => {
          if (punteroTactil.current) setAbierto((v) => !v);
          punteroTactil.current = false;
        }}
      >
        <BotonEmpresa ref={boton} variant={variant} compacto={compacto} className={className} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Empresa</DropdownMenuLabel>
        {empresas.map((e) => (
          <DropdownMenuItem key={e.id} onClick={() => cambiarEmpresa(e.id)} className="gap-3 py-2">
            <EmpresaDistintivo empresa={e} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{e.nombre_corto}</p>
              <p className="truncate text-xs text-muted-foreground">{e.nombre}</p>
            </div>
            {seleccion === e.id && <Check className="h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
        {puedeElegirAmbas && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => cambiarEmpresa(TODAS)} className="gap-3 py-2">
              <EmpresaDistintivo empresa={null} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Ambas empresas</p>
                <p className="text-xs text-muted-foreground">Solo consulta: dashboard, reportes y listados</p>
              </div>
              {seleccion === TODAS && <Check className="h-4 w-4 text-primary" />}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
