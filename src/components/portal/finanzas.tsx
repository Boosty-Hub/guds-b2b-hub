import { Link, useLocation } from "react-router-dom";
import { Boxes, FileText, Landmark, LineChart, Receipt, Wallet, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { PillTono } from "@/components/portal/sistema";
import { estadoDocumento, type DocumentoCliente } from "@/hooks/useFinanzasPortal";

// Piezas compartidas de Finanzas del portal del cliente (F5): navegación de la sección y estado de un documento. El
// estado de cuenta (pantalla, PDF y Excel) está en components/estado-cuenta (22c: un solo formato para todas las vistas;
// el libro de movimientos, su CSV y la barra de antigüedad propia del portal se retiraron).

const DESTINOS: { etiqueta: string; ruta: string; icono: LucideIcon }[] = [
  { etiqueta: "Estado de cuenta", ruta: "/portal/finanzas", icono: LineChart },
  { etiqueta: "Facturas", ruta: "/portal/facturas", icono: FileText },
  { etiqueta: "Pagos", ruta: "/portal/pagos", icono: Wallet },
  { etiqueta: "Cómo pagar", ruta: "/portal/cuenta/pagos", icono: Landmark },
  { etiqueta: "Retenciones", ruta: "/portal/retenciones", icono: Receipt },
  { etiqueta: "Consignación", ruta: "/portal/consignacion", icono: Boxes },
];

/** Navegación de Finanzas en móvil y tableta (en escritorio la lleva la barra lateral). Se desplaza sola, sin mover la página. */
export const NavFinanzas = ({ className }: { className?: string }) => {
  const { pathname } = useLocation();
  return (
    <nav aria-label="Secciones de finanzas" className={cn("-mx-4 mb-4 md:-mx-6 lg:hidden", className)}>
      <ul className="flex gap-2 overflow-x-auto px-4 pb-1 md:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {DESTINOS.map((d) => {
          const activo = pathname === d.ruta || pathname.startsWith(`${d.ruta}/`);
          return (
            <li key={d.ruta} className="shrink-0">
              <Link
                to={d.ruta}
                aria-current={activo ? "page" : undefined}
                className={cn(
                  "flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium transition-colors",
                  activo ? "border-foreground bg-foreground text-background" : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                <d.icono className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                {d.etiqueta}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

/** Insignia del estado de un documento (pagada / parcial / vencida / por pagar / anulada / a favor / aplicada). */
export const PillDocumento = ({ doc, hoy, className }: { doc: DocumentoCliente; hoy: string; className?: string }) => {
  const e = estadoDocumento(doc, hoy);
  return <PillTono tono={e.tono} className={className} testId="estado-documento">{e.etiqueta}</PillTono>;
};
