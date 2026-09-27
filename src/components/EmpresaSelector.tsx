import { useRef, useState } from "react";
import { Check, ChevronDown, Layers } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TODAS, useEmpresa } from "@/contexts/EmpresaContext";
import type { Empresa } from "@/lib/supabase";

interface EmpresaSelectorProps {
  // "default": header claro (desktop) · "header": barra de color (móvil)
  variant?: "default" | "header";
  // Solo el distintivo (barras móviles con poco espacio)
  compacto?: boolean;
  className?: string;
}

// Distintivo de la empresa: su logo si lo tiene; si no, las iniciales sobre su color.
export function EmpresaDistintivo({ empresa, className }: { empresa: Empresa | null; className?: string }) {
  if (!empresa) {
    return (
      <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground", className)}>
        <Layers className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (empresa.logo_url) {
    return <img src={empresa.logo_url} alt={empresa.nombre_corto} className={cn("h-6 w-6 shrink-0 rounded-md object-contain bg-white", className)} />;
  }
  return (
    <span
      className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white", className)}
      style={{ backgroundColor: empresa.color || "hsl(var(--primary))" }}
    >
      {empresa.nombre_corto.slice(0, 2).toUpperCase()}
    </span>
  );
}

export function EmpresaSelector({ variant = "default", compacto = false, className }: EmpresaSelectorProps) {
  const { empresas, seleccion, empresaActiva, puedeElegirAmbas, cambiarEmpresa } = useEmpresa();
  const [abierto, setAbierto] = useState(false);
  const punteroTactil = useRef(false);
  if (empresas.length === 0) return null;

  const isHeader = variant === "header";
  const etiqueta = empresaActiva?.nombre_corto ?? "Ambas empresas";
  const unaSola = empresas.length === 1;

  const trigger = (
    <Button
      variant={isHeader ? "secondary" : "outline"}
      size="sm"
      disabled={unaSola}
      className={cn(
        "gap-2 disabled:opacity-100",
        compacto && "h-8 gap-1 px-1.5",
        isHeader && "bg-white/20 text-white border-white/30 hover:bg-white/30",
        className,
      )}
      title={empresaActiva?.nombre ?? "Consultando ambas empresas"}
      aria-label={`Cambiar empresa (actual: ${etiqueta})`}
    >
      <EmpresaDistintivo empresa={empresaActiva} className="h-5 w-5" />
      {!compacto && <span className="max-w-[9rem] truncate font-medium">{etiqueta}</span>}
      {!unaSola && <ChevronDown className="h-3.5 w-3.5 opacity-70" />}
    </Button>
  );

  if (unaSola) return trigger;

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
        {trigger}
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

// Franja bajo el header cuando se consulta "Ambas empresas".
export function ModoConsultaBanner() {
  const { soloLectura, empresas } = useEmpresa();
  if (!soloLectura || empresas.length < 2) return null;
  return (
    <div className="flex items-center gap-2 border-b border-amber-300/60 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200 lg:px-6">
      <Layers className="h-3.5 w-3.5 shrink-0" />
      <span>
        Estás viendo <strong>ambas empresas</strong> · solo consulta. Elige GUDS o Quirutec en el menú superior para crear o editar.
      </span>
    </div>
  );
}
