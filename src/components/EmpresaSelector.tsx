import { forwardRef, useRef, useState, type ButtonHTMLAttributes } from "react";
import { ChevronDown, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { cargaDiferida } from "@/lib/cargaDiferida";
import type { Empresa } from "@/lib/supabase";

export interface EmpresaSelectorProps {
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

// El menú (Radix DropdownMenu y su motor de posicionamiento) se descarga aparte: hasta que llega se muestra el mismo
// botón; si se toca antes, el menú se abre en cuanto llega.
const menu = cargaDiferida(() => import("@/components/EmpresaMenu"));

/** Botón de la empresa activa: el mismo antes y después de cargar el menú. */
export const BotonEmpresa = forwardRef<HTMLButtonElement, EmpresaSelectorProps & ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ variant = "default", compacto = false, className, ...props }, ref) => {
    const { empresas, empresaActiva } = useEmpresa();
    const isHeader = variant === "header";
    const etiqueta = empresaActiva?.nombre_corto ?? "Ambas empresas";
    const unaSola = empresas.length === 1;
    return (
      <Button
        ref={ref}
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
        {...props}
      >
        <EmpresaDistintivo empresa={empresaActiva} className="h-5 w-5" />
        {!compacto && <span className="max-w-[9rem] truncate font-medium">{etiqueta}</span>}
        {!unaSola && <ChevronDown className="h-3.5 w-3.5 opacity-70" />}
      </Button>
    );
  },
);
BotonEmpresa.displayName = "BotonEmpresa";

export function EmpresaSelector(props: EmpresaSelectorProps) {
  const { empresas } = useEmpresa();
  const variasEmpresas = empresas.length > 1;
  const modulo = menu.useModulo(variasEmpresas);
  const [abrir, setAbrir] = useState(false);
  const foco = useRef(false);
  if (empresas.length === 0) return null;
  if (!variasEmpresas) return <BotonEmpresa {...props} />;
  if (modulo) return <modulo.EmpresaMenu {...props} abrirAlMontar={abrir} enfocar={foco.current} />;
  return (
    <BotonEmpresa
      {...props}
      aria-haspopup="menu"
      aria-expanded={false}
      onPointerEnter={menu.pedir}
      onFocus={() => { foco.current = true; menu.pedir(); }}
      onBlur={() => { foco.current = false; }}
      onClick={() => { setAbrir(true); menu.pedir(); }}
    />
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
