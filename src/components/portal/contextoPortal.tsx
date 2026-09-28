import { createContext, useContext } from "react";
import type { EstadoCarritoPanel } from "@/components/portal/PortalCartWidget";

// Contexto del shell del portal: datos del cliente para los encabezados y el carrito único.
export interface ClientePortal {
  id: string;
  nombre_negocio: string;
  rif: string | null;
  codigo: string | null;
  vendedor_odoo: string | null;
}

export interface PortalContexto {
  cliente: ClientePortal | null;
  carrito: EstadoCarritoPanel;
  abrirCarrito: () => void;
}

export const ContextoPortal = createContext<PortalContexto | null>(null);

/** Datos del shell del portal (null fuera del shell, p. ej. en pruebas aisladas). */
export const usePortal = () => useContext(ContextoPortal);
