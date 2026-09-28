// IVA de venta de un producto tal como viene de Odoo (productos.impuesto_pct): "Exento" o "IVA 16 %".
// null = aún sin sincronizar (el servidor usa el IVA general de configuración).

/** 16 → "16 %"; 12.5 → "12,5 %". */
export const textoPct = (pct: number) => `${Number(pct).toLocaleString("es-VE", { maximumFractionDigits: 2 })} %`;

export const textoIva = (pct: number | null | undefined) => {
  if (pct == null || !Number.isFinite(Number(pct))) return null;
  return Number(pct) === 0 ? "Exento" : `IVA ${textoPct(Number(pct))}`;
};
