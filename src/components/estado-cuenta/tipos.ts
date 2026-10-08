import type { EstadoCuenta, Movimiento } from "@/hooks/useFinanzasPortal";

// Estado de cuenta completo (fase 20w): lo que devuelven estado_cuenta_portal (portal), estado_cuenta_cliente (admin y
// vendedor) y estado_cuenta_publico (enlace público), todas sobre la misma función del servidor (estado_cuenta_datos). El
// enlace público no trae identificadores internos (id del cliente, de la empresa ni de los documentos).
// 22c: un solo estado de cuenta con el formato de finanzas (documentos con saldo al corte, con Nº de control, tasa de
// emisión y estatus); el libro de movimientos ya no forma parte de él (el servidor lo sigue devolviendo para el frontend
// anterior; el nuevo lo pide con p_movimientos = false).

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

/** Estatus del formato de finanzas (22c): Pendiente por cobrar · Pendiente comprobante de retención · NC a favor · Saldo a favor. */
export type EstatusDocumento = "pendiente" | "retencion" | "nc_favor" | "a_favor";

/** De dónde sale la tasa de emisión de un documento (22e). */
export type OrigenTasa = "factura" | "documento" | "bcv" | "profit";

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
  /** Nº de control fiscal (de Odoo). */
  nro_control?: string | null;
  /** Estatus del formato de finanzas (22c). */
  estatus?: EstatusDocumento;
  /** Tasa de emisión (Bs por USD): en Bs, la del documento; en USD, la BCV del día de emisión (o la última anterior);
   *  en una NC, la de la factura que afecta (22e). */
  tasa_emision?: number | null;
  /** De dónde sale la tasa (22e): factura que afecta la NC · documento en Bs · BCV del día · Profit (día sin tasa en Odoo). */
  tasa_origen?: OrigenTasa | null;
  /** Número de la factura cuya tasa lleva la NC (tasa_origen = 'factura'). */
  tasa_factura?: string | null;
  emision: string | null;
  vence: string | null;
  total: number;
  saldo: number;
  /** Días desde el vencimiento (o la emisión) hasta el corte: > 0 vencido, ≤ 0 por vencer. */
  dias: number;
  estado: string | null;
  moneda?: "USD" | "VES";
  /** Bs por USD implícita en el documento (solo documentos en bolívares; para mostrar, tasa_emision). */
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
  /** Libro de movimientos (21b): vacío cuando se pide con p_movimientos = false (22c). */
  movimientos: MovimientoEstadoCuenta[];
  /** Fecha de corte (22c): los saldos, los días y los abonos son a esta fecha. Hoy en el enlace público y el portal. */
  corte?: string;
  /** Documentos con saldo al corte, en el formato de finanzas. */
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
