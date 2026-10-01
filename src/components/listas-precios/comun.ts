// Listas de precios personalizadas (fase 21e): tipos y utilidades compartidas por el detalle, el importador y el ajuste
// masivo. Los precios de la lista son en USD y por unidad (como en Odoo): un empaque vale unidades × precio.

export interface ListaPrecio {
  id: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  moneda: string | null;
  empresa_id: string | null;
  odoo_id: number | null;
  updated_at: string | null;
}

export interface ProductoLista {
  id: string;
  sku: string;
  nombre: string;
  precio_base: number;
  categoria_id: string | null;
  categoria: string | null;
}

/** Origen de un cambio sin guardar; va al historial. */
export type OrigenCambio = "manual" | "masivo" | "importacion" | "copia";

/** Lista creada en GUDS (no viene de Odoo): sus precios y clientes se editan aquí. */
export const esDeGuds = (l: Pick<ListaPrecio, "odoo_id">) => l.odoo_id == null;

/** "12,50" · "1.234,5" · "$ 12.5" → número; "" → null; texto inválido → NaN. */
export function leerPrecio(texto: string): number | null {
  let t = texto.replace(/[\s$]/g, "").replace(/usd/i, "");
  if (t === "") return null;
  if (t.includes(",") && t.includes(".")) {
    // El separador decimal es el que va último
    t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  } else if (t.includes(",")) {
    t = t.replace(",", ".");
  }
  if (!/^\d*\.?\d*$/.test(t) || t === ".") return NaN;
  return Number(t);
}

export const redondear = (n: number, dec = 2) => Math.round(n * 10 ** dec) / 10 ** dec;

/** Texto para el campo: 12.5 → "12.50"; conserva hasta 4 decimales si los tiene. */
export function textoPrecio(n: number | null | undefined): string {
  if (n == null) return "";
  const r = redondear(n, 4);
  return Number.isInteger(r * 100) ? r.toFixed(2) : String(r);
}

/** Diferencia porcentual contra el precio base (null si no hay base). */
export const difPct = (precio: number, base: number) => (base > 0 ? ((precio - base) / base) * 100 : null);

/** Normaliza para emparejar por nombre o código: minúsculas, sin acentos ni espacios repetidos. */
export const normalizar = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
