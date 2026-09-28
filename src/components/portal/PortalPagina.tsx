import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { EmpresaDistintivo, EmpresaSelector } from "@/components/EmpresaSelector";
import { NotificationsDropdown } from "@/components/portal/NotificationsDropdown";
import { Skeleton } from "@/components/ui/skeleton";
import { SelectorMoneda } from "@/components/portal/sistema";

// Página del portal dentro del shell. Pone el encabezado compacto de móvil/tableta (título o saludo, volver, empresa,
// moneda y avisos) y, en escritorio, el título de la página con sus acciones. El contenido va en un contenedor de ancho
// máximo según el tipo de página.

const ANCHOS = {
  normal: "max-w-7xl",     // 1280 px
  estrecho: "max-w-3xl",   // formularios y ajustes
  completo: "max-w-none",
};

interface PortalPaginaProps {
  titulo: string;
  descripcion?: ReactNode;
  /** Ruta del botón "volver" (subpáginas). */
  volver?: string;
  etiquetaVolver?: string;
  /** Acciones junto al título en escritorio (en móvil van dentro del contenido). */
  acciones?: ReactNode;
  ancho?: keyof typeof ANCHOS;
  /** Reemplaza el título del encabezado móvil (p. ej. el saludo del inicio). */
  encabezadoMovil?: ReactNode;
  /** Franja fija bajo el encabezado móvil (p. ej. buscador y categorías del catálogo). */
  subencabezadoMovil?: ReactNode;
  /** Oculta el título de escritorio (la página pone el suyo). */
  sinTituloEscritorio?: boolean;
  className?: string;
  children: ReactNode;
}

export const PortalPagina = ({
  titulo, descripcion, volver, etiquetaVolver = "Volver", acciones, ancho = "normal", encabezadoMovil, subencabezadoMovil,
  sinTituloEscritorio, className, children,
}: PortalPaginaProps) => {
  const { empresas, empresaActiva } = useEmpresa();
  const acento = empresaActiva?.color || "hsl(var(--primary))";

  return (
    <>
      {/* Encabezado compacto (móvil y tableta) */}
      <header
        className="sticky top-0 z-30 border-b border-border bg-card pt-[env(safe-area-inset-top)] lg:hidden"
        style={{ boxShadow: `inset 0 2px 0 0 ${acento}` }}
        data-encabezado-movil
      >
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-2 px-3 md:max-w-none md:px-6">
          {volver ? (
            <Link to={volver} className="-ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-muted" aria-label={etiquetaVolver}>
              <ChevronLeft className="h-5 w-5" />
            </Link>
          ) : (
            <EmpresaDistintivo empresa={empresaActiva} className="ml-1 h-8 w-8 rounded-lg text-[11px]" />
          )}
          <div className="min-w-0 flex-1 px-1">
            {encabezadoMovil ?? <h1 className="truncate text-base font-semibold text-foreground">{titulo}</h1>}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {empresas.length > 1 && !volver && <EmpresaSelector compacto />}
            {!volver && <SelectorMoneda compacto />}
            <NotificationsDropdown />
          </div>
        </div>
        {subencabezadoMovil && <div className="mx-auto max-w-3xl px-3 pb-3 md:max-w-none md:px-6">{subencabezadoMovil}</div>}
      </header>

      <div className={cn("mx-auto w-full px-4 pt-4 md:px-6 lg:px-8 lg:pt-6", ANCHOS[ancho], className)}>
        {!sinTituloEscritorio && (
          <div className="mb-6 hidden items-end justify-between gap-4 lg:flex">
            <div className="min-w-0">
              {volver && (
                <Link to={volver} className="mb-1 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                  <ChevronLeft className="h-4 w-4" />{etiquetaVolver}
                </Link>
              )}
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">{titulo}</h1>
              {descripcion && <p className="mt-1 text-sm text-muted-foreground">{descripcion}</p>}
            </div>
            {acciones && <div className="flex shrink-0 items-center gap-2">{acciones}</div>}
          </div>
        )}
        {children}
      </div>
    </>
  );
};

/** Esqueleto de página mientras carga el código de la ruta. */
export const PaginaCargando = () => (
  <div aria-busy="true" aria-label="Cargando">
    <div className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-card px-4 lg:hidden">
      <Skeleton className="h-8 w-8 rounded-lg" />
      <Skeleton className="h-4 w-32" />
    </div>
    <div className="mx-auto w-full max-w-7xl space-y-4 px-4 pt-4 md:px-6 lg:px-8 lg:pt-6">
      <Skeleton className="hidden h-8 w-56 lg:block" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  </div>
);
