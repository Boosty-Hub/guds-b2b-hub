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

/** Un abono aplicado a un documento (fase 21b): cobro, nota de crédito, retención, reintegro u otro ajuste. */
export interface AbonoDocumento {
  fecha: string | null;
  /** pago · nota_credito (NC usada en esta factura) · aplicada (esta NC usada en otro documento) · retencion · reintegro · otro */
  tipo: "pago" | "nota_credito" | "aplicada" | "retencion" | "reintegro" | "otro" | string;
  documento: string | null;
  documento_tipo?: TipoDocumentoAbierto | null;
  /** Retenciones: iva | municipal */
  clase?: string | null;
  referencia?: string | null;
  banco?: string | null;
  metodo?: string | null;
  moneda?: "USD" | "VES" | null;
  /** Lo aplicado en la moneda del cobro (Bs) a la tasa del cobro. */
  monto_moneda?: number | null;
  monto: number;
}

/** Sugerencia automática de GUDS sobre por qué queda saldo (no es un comentario de una persona). */
export interface QueFalta { codigo: string; texto: string; esperado: number | null }

/** Comentario de una persona sobre una factura (los internos y el autor solo en el admin). */
export interface ComentarioDocumento { id?: string; texto: string; fecha: string; visible?: boolean; autor?: string | null }

/** Documento con saldo (lo que se debe, o una nota de crédito a favor), con el cruce de la fase 21b. */
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
  moneda?: "USD" | "VES";
  /** Bs por USD del documento (solo documentos en bolívares). */
  tasa?: number | null;
  base?: number;
  iva?: number;
  base_bs?: number | null;
  iva_bs?: number | null;
  total_bs?: number | null;
  saldo_bs?: number | null;
  pagos?: number;
  nc?: number;
  retenciones?: number;
  otros?: number;
  abonado?: number;
  ultimo_abono?: string | null;
  que_falta?: QueFalta | null;
  comentarios?: ComentarioDocumento[];
  abonos?: AbonoDocumento[];
}

export type FiltroDocumentos = "abiertas" | "todas" | "pagadas";

export type MovimientoEstadoCuenta = Omit<Movimiento, "factura_id"> & { factura_id?: string | null };

export interface EstadoCuentaCompleto extends Omit<EstadoCuenta, "empresa" | "cliente" | "movimientos" | "resumen"> {
  empresa: EmpresaEstadoCuenta | null;
  cliente: ClienteEstadoCuenta;
  resumen: EstadoCuenta["resumen"] & { notas_debito_abiertas?: number; notas_debito_saldo?: number };
  movimientos: MovimientoEstadoCuenta[];
  abiertos?: DocumentoAbierto[];
  /** Documentos según el filtro (todas las emitidas o las pagadas en el período); null con el filtro 'abiertas'. */
  documentos?: DocumentoAbierto[] | null;
  filtro?: FiltroDocumentos;
  /** Emisión de la factura abierta más antigua (inicio por defecto de los movimientos). */
  desde_abierta?: string | null;
  tolerancia?: number;
  /** Notas de débito y de crédito de 0,00 USD (diferencial cambiario en bolívares) que no se listan en el período. */
  ajustes_cambiarios?: number;
  /** Solo en el enlace público. */
  enlace?: { creado_at: string; vence_at: string | null };
  actualizado_at?: string;
  tiene_cuenta?: boolean;
}
