import type { EstadoCuenta, Movimiento } from "@/hooks/useFinanzasPortal";

// Estado de cuenta completo (fase 20w): lo que devuelven estado_cuenta_portal (portal), estado_cuenta_cliente (admin) y
// estado_cuenta_publico (enlace público), todas sobre la misma función del servidor (estado_cuenta_datos). El enlace
// público no trae identificadores internos (id del cliente, de la empresa ni de los documentos).

export interface EmpresaEstadoCuenta {
  id?: string;
  nombre: string;
  nombre_corto: string | null;
  prefijo?: string | null;
  rif: string | null;
  direccion?: string | null;
  ciudad?: string | null;
  estado?: string | null;
  telefono?: string | null;
  email?: string | null;
  sitio_web?: string | null;
  logo_url?: string | null;
  color?: string | null;
}

export interface ClienteEstadoCuenta {
  id?: string;
  nombre: string;
  rif: string | null;
  codigo: string | null;
  condicion_pago: string | null;
  dias_credito: number | null;
  direccion?: string | null;
  ciudad?: string | null;
  estado?: string | null;
}

export type TipoDocumentoAbierto = "factura" | "nota_debito" | "nota_credito";

/** Documento con saldo (lo que se debe, o una nota de crédito a favor). */
export interface DocumentoAbierto {
  factura_id?: string;
  numero: string;
  tipo: TipoDocumentoAbierto;
  emision: string | null;
  vence: string | null;
  total: number;
  saldo: number;
  /** Días desde el vencimiento (o la emisión): > 0 vencido, ≤ 0 por vencer. */
  dias: number;
  estado: string | null;
}

export type MovimientoEstadoCuenta = Omit<Movimiento, "factura_id"> & { factura_id?: string | null };

export interface EstadoCuentaCompleto extends Omit<EstadoCuenta, "empresa" | "cliente" | "movimientos" | "resumen"> {
  empresa: EmpresaEstadoCuenta | null;
  cliente: ClienteEstadoCuenta;
  resumen: EstadoCuenta["resumen"] & { notas_debito_abiertas?: number; notas_debito_saldo?: number };
  movimientos: MovimientoEstadoCuenta[];
  abiertos?: DocumentoAbierto[];
  /** Notas de débito y de crédito de 0,00 USD (diferencial cambiario en bolívares) que no se listan en el período. */
  ajustes_cambiarios?: number;
  /** Solo en el enlace público. */
  enlace?: { creado_at: string; vence_at: string | null };
  actualizado_at?: string;
  tiene_cuenta?: boolean;
}
