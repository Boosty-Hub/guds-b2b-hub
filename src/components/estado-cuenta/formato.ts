import type { DocumentoAbierto, EmpresaEstadoCuenta, EstadoCuentaCompleto, EstatusDocumento, OrigenTasa, TipoDocumentoAbierto } from "./tipos";

// Formatos del estado de cuenta compartidos por la página pública, el admin y el PDF: siempre en USD, con el signo antes
// del símbolo (-$1,234.69, la convención de la plataforma) y fechas en español de Venezuela.

/** -$1,234.69 · $0.00 (sin "-$0.00" por céntimos de redondeo). */
export const fmtUsd = (n: number | string | null | undefined) => {
  const v = Number(n);
  const x = Number.isFinite(v) ? v : 0;
  const signo = x < 0 && Math.abs(x) >= 0.005 ? "-" : "";
  return `${signo}$${Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const aFecha = (s: string) => (s.length === 10 ? new Date(`${s}T00:00:00`) : new Date(s));

/** 30 sep 2026 */
export const fechaLarga = (s: string | null | undefined) => {
  if (!s) return "—";
  const d = aFecha(s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-VE", { day: "numeric", month: "short", year: "numeric" }).replace(/\./g, "");
};

/** 30/09/2026 (tablas del PDF: ancho fijo) */
export const fechaNumerica = (s: string | null | undefined) => {
  if (!s) return "—";
  const d = aFecha(s);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};

/** 30 sep 2026, 10:42 a. m. */
export const fechaHora = (s: string | Date | null | undefined) => {
  if (!s) return "—";
  const d = typeof s === "string" ? new Date(s) : s;
  if (Number.isNaN(d.getTime())) return "—";
  return `${fechaLarga(d.toISOString())}, ${d.toLocaleTimeString("es-VE", { hour: "numeric", minute: "2-digit" })}`;
};

export const TIPO_DOCUMENTO: Record<TipoDocumentoAbierto, string> = {
  factura: "Factura",
  nota_debito: "Nota de débito",
  nota_credito: "Nota de crédito",
  nota_entrega: "Nota de entrega",
};

/** "Vencida hace 12 días" / "Vence hoy" / "Vence en 5 días" / "A favor". */
export const textoDias = (d: Pick<DocumentoAbierto, "dias" | "saldo" | "vence">) => {
  if (d.saldo < 0) return "A favor";
  if (d.dias > 0) return `Vencida hace ${d.dias} ${d.dias === 1 ? "día" : "días"}`;
  if (d.dias === 0) return "Vence hoy";
  return `Vence en ${-d.dias} ${d.dias === -1 ? "día" : "días"}`;
};

/** Texto del período de los movimientos. */
export const textoPeriodo = (d: Pick<EstadoCuentaCompleto, "periodo" | "hoy">) =>
  d.periodo.desde
    ? `Del ${fechaLarga(d.periodo.desde)} al ${fechaLarga(d.periodo.hasta ?? d.hoy)}`
    : `Todos los movimientos hasta el ${fechaLarga(d.periodo.hasta ?? d.hoy)}`;

/** Dirección de una línea (empresa o cliente). */
export const direccionTexto = (x: { direccion?: string | null; ciudad?: string | null; estado?: string | null } | null | undefined) =>
  x ? [x.direccion, x.ciudad, x.estado].map((s) => (s ?? "").trim()).filter(Boolean)
    .filter((s, i, a) => i === 0 || !a[0].toLowerCase().includes(s.toLowerCase())).join(", ") : "";

/** Nombre del archivo: estado-de-cuenta-<cliente>-<AAAA-MM-DD>.pdf (o .xlsx), sin acentos ni caracteres raros. */
export const nombreArchivoEstadoCuenta = (cliente: string | null | undefined, fecha: string, ext: "pdf" | "xlsx" = "pdf") => {
  const limpio = (cliente ?? "cliente")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "") || "cliente";
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : new Date().toISOString().slice(0, 10);
  return `estado-de-cuenta-${limpio}-${dia}.${ext}`;
};

/** Color de marca de la empresa (#rrggbb) con respaldo en el rojo GUDS. */
export const colorEmpresa = (e: EmpresaEstadoCuenta | null | undefined) =>
  e?.color && /^#[0-9a-f]{6}$/i.test(e.color) ? e.color : "#8f1a1a";

/** URL pública del estado de cuenta para un token. */
export const urlEstadoCuenta = (token: string) => `${window.location.origin}/estado-cuenta/${token}`;

/** Bs 1.234,56 (montos en bolívares a la tasa del documento o del cobro). */
export const fmtBs = (n: number | string | null | undefined) => {
  const v = Number(n);
  const x = Number.isFinite(v) ? v : 0;
  const signo = x < 0 && Math.abs(x) >= 0.005 ? "-" : "";
  return `${signo}Bs ${Math.abs(x).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/** Concepto de un abono aplicado a un documento (21b). */
export const conceptoAbono = (a: { tipo: string; clase?: string | null; metodo?: string | null; documento_tipo?: string | null }) => {
  switch (a.tipo) {
    case "pago": return "Cobro";
    case "nota_credito": return "Nota de crédito";
    case "aplicada": return a.documento_tipo === "nota_debito" ? "Aplicada a la nota de débito" : "Aplicada a la factura";
    case "retencion": return a.clase === "iva" ? "Retención de IVA" : a.clase === "municipal" ? "Retención municipal" : "Retención";
    case "reintegro": return "Reintegro";
    // 22j: movimientos de una nota de entrega
    case "facturada": return "Pasó a factura";
    case "devolucion": return "Devolución";
    case "descuento": return "Descuento";
    default: return "Ajuste";
  }
};

/** Columna del estado de cuenta en la que suma un abono. */
export const columnaAbono = (tipo: string): "pagos" | "nc" | "retenciones" | "otros" =>
  tipo === "pago" ? "pagos" : tipo === "nota_credito" || tipo === "aplicada" ? "nc" : tipo === "retencion" ? "retenciones" : "otros";

// ── Formato de finanzas (22c): las columnas del Excel "FORMATO EDC" del equipo, comunes a la pantalla, el PDF y el Excel ──

/** FACT · NC · ND, como en el Excel del equipo. */
export const TIPO_CORTO: Record<TipoDocumentoAbierto, string> = { factura: "FACT", nota_credito: "NC", nota_debito: "ND", nota_entrega: "N/E" };

/** Leyenda cuando el estado de cuenta incluye notas de entrega (22j), o null. */
export const leyendaNotasEntrega = (docs: Pick<DocumentoAbierto, "tipo">[]): string | null =>
  docs.some((d) => d.tipo === "nota_entrega") ? "N/E = nota de entrega: documento no fiscal, sin IVA ni número de control" : null;

/** "FACT 10256", "NC 1023", "ND 1297". */
export const tipoYNumero = (d: Pick<DocumentoAbierto, "tipo" | "numero">) => `${TIPO_CORTO[d.tipo] ?? ""} ${d.numero}`.trim();

export const ESTATUS: Record<EstatusDocumento, { texto: string; tono: "pendiente" | "retencion" | "favor" }> = {
  pendiente: { texto: "Pendiente por cobrar", tono: "pendiente" },
  retencion: { texto: "Pendiente comprobante de retención", tono: "retencion" },
  nc_favor: { texto: "NC a favor", tono: "favor" },
  a_favor: { texto: "Saldo a favor", tono: "favor" },
};

/** Estatus del documento (con respaldo para datos sin el campo: NC → a favor, el resto → pendiente). */
export const estatusDe = (d: Pick<DocumentoAbierto, "estatus" | "tipo" | "saldo">): EstatusDocumento =>
  d.estatus ?? (d.saldo < 0 ? (d.tipo === "nota_credito" ? "nc_favor" : "a_favor") : "pendiente");

/** Año y mes (01–12) del vencimiento (o de la emisión si no tiene), como las dos primeras columnas del formato. */
export const anioMes = (d: Pick<DocumentoAbierto, "vence" | "emision">): { anio: number | null; mes: string | null } => {
  const f = d.vence ?? d.emision;
  return f && /^\d{4}-\d{2}/.test(f) ? { anio: Number(f.slice(0, 4)), mes: f.slice(5, 7) } : { anio: null, mes: null };
};

/** Tasa (Bs por USD) con 4 decimales: 549.3716. */
export const fmtTasa = (n: number | null | undefined) =>
  n == null || !Number.isFinite(Number(n)) ? "—" : Number(n).toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });

/** De dónde sale la tasa de emisión (22e): marca junto al número (solo las que no son la regla general) y su explicación. */
export const ORIGEN_TASA: Record<OrigenTasa, { marca: string; texto: string }> = {
  bcv: { marca: "", texto: "BCV del día de emisión" },
  documento: { marca: "", texto: "la del documento en bolívares" },
  factura: { marca: "F", texto: "la de la factura que afecta la nota de crédito" },
  profit: { marca: "P", texto: "tomada de Profit: ese día no hay tasa BCV en Odoo" },
};
export const origenTasaTexto = (d: Pick<DocumentoAbierto, "tasa_origen" | "tasa_factura">): string | null =>
  !d.tasa_origen ? null
    : d.tasa_origen === "factura" && d.tasa_factura ? `la de la factura ${d.tasa_factura} (que afecta la nota de crédito)`
    : ORIGEN_TASA[d.tasa_origen]?.texto ?? null;
/** Leyenda de las marcas que aparecen en estos documentos ("F = …; P = …"), o null si no hay ninguna. */
export const leyendaTasas = (docs: Pick<DocumentoAbierto, "tasa_origen">[]): string | null => {
  const hay = new Set(docs.map((d) => d.tasa_origen).filter(Boolean));
  const partes = (Object.entries(ORIGEN_TASA) as [OrigenTasa, { marca: string; texto: string }][])
    .filter(([k, v]) => v.marca && hay.has(k)).map(([, v]) => `${v.marca} = ${v.texto}`);
  return partes.length ? partes.join("; ") : null;
};

/** RIF con guiones: J-410154438 → J-41015443-8 (si no tiene la forma esperada, tal cual). */
export const formatoRif = (rif: string | null | undefined) => {
  const t = (rif ?? "").trim().toUpperCase();
  const m = t.replace(/[\s.-]/g, "").match(/^([VEJGPC])(\d{8})(\d)$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : t;
};

/** Totales del formato: base, impuesto, total y deuda de todas las filas (las NC restan), y la deuda separada en por
 *  cobrar (saldos positivos) y a favor (negativos). */
export const totalesDocumentos = (docs: DocumentoAbierto[]) => {
  const n = (v: number | null | undefined) => Number(v ?? 0);
  const r = (v: number) => Math.round(v * 100) / 100;
  return {
    base: r(docs.reduce((s, d) => s + n(d.base), 0)),
    iva: r(docs.reduce((s, d) => s + n(d.iva), 0)),
    total: r(docs.reduce((s, d) => s + n(d.total), 0)),
    deuda: r(docs.reduce((s, d) => s + n(d.saldo), 0)),
    porCobrar: r(docs.reduce((s, d) => s + Math.max(n(d.saldo), 0), 0)),
    aFavor: r(docs.reduce((s, d) => s + Math.min(n(d.saldo), 0), 0)),
  };
};

/** Fecha de corte del estado de cuenta (la de hoy si el servidor no la trae). */
export const corteDe = (d: Pick<EstadoCuentaCompleto, "corte" | "hoy">) => d.corte ?? d.hoy;

/** "Estado de cuenta actualizado al 30/09/2026". */
export const textoActualizado = (d: Pick<EstadoCuentaCompleto, "corte" | "hoy">) => `Estado de cuenta actualizado al ${fechaNumerica(corteDe(d))}`;
