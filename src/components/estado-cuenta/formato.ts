import type { DocumentoAbierto, EmpresaEstadoCuenta, EstadoCuentaCompleto, TipoDocumentoAbierto } from "./tipos";

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

/** Nombre del archivo: estado-de-cuenta-<cliente>-<AAAA-MM-DD>.pdf, sin acentos ni caracteres raros. */
export const nombreArchivoEstadoCuenta = (cliente: string | null | undefined, fecha: string) => {
  const limpio = (cliente ?? "cliente")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "") || "cliente";
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : new Date().toISOString().slice(0, 10);
  return `estado-de-cuenta-${limpio}-${dia}.pdf`;
};

/** Color de marca de la empresa (#rrggbb) con respaldo en el rojo GUDS. */
export const colorEmpresa = (e: EmpresaEstadoCuenta | null | undefined) =>
  e?.color && /^#[0-9a-f]{6}$/i.test(e.color) ? e.color : "#8f1a1a";

/** URL pública del estado de cuenta para un token. */
export const urlEstadoCuenta = (token: string) => `${window.location.origin}/estado-cuenta/${token}`;
