// Contacto con el cliente desde el portal del vendedor: llamar, WhatsApp y el texto del estado de cuenta para compartir.

/** Número para wa.me en formato internacional sin signos. Venezuela: 0414-1234567 → 584141234567. null si no parece válido. */
export const telefonoWhatsApp = (tel: string | null | undefined): string | null => {
  if (!tel) return null;
  let d = tel.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = `58${d.slice(1)}`;
  else if (d.length === 10 && /^[24]/.test(d)) d = `58${d}`;
  d = d.replace(/\D/g, "");
  return d.length >= 10 && d.length <= 15 ? d : null;
};

export const telefonoLlamar = (tel: string | null | undefined) => (tel ? tel.replace(/[^\d+]/g, "") : null);

/** Enlace de WhatsApp con un mensaje; sin número abre el selector de contactos de WhatsApp. */
export const enlaceWhatsApp = (tel: string | null | undefined, texto: string) => {
  const n = telefonoWhatsApp(tel);
  return `https://wa.me/${n ?? ""}?text=${encodeURIComponent(texto)}`;
};

const usd = (n: number) => `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fecha = (s: string | null) => (s ? new Date(`${s}T12:00:00`).toLocaleDateString("es-VE", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—");

export interface DatosEstadoCuenta {
  cliente: string;
  empresa: string | null;
  hoy: string;
  por_cobrar: number;   // facturas con saldo
  neto: number;         // facturas menos notas de crédito sin aplicar
  vencido: number;
  a_favor: number;
  facturas: { numero: string; fecha_vencimiento: string | null; dias: number; saldo_usd: number; tipo: string }[];
  vendedor: string | null;
}

/**
 * Texto del estado de cuenta para WhatsApp: saldo, vencido, facturas pendientes (las 8 más viejas) y el enlace al portal,
 * donde el cliente ve el detalle y declara sus pagos. Montos en USD (como las facturas de Odoo).
 */
export const textoEstadoCuenta = (d: DatosEstadoCuenta, enlacePortal: string) => {
  const abiertas = d.facturas.filter((f) => f.tipo === "factura" && Number(f.saldo_usd) > 0.009);
  const lineas = abiertas.slice(0, 8).map((f) =>
    `• Factura ${f.numero} · vence ${fecha(f.fecha_vencimiento)}${f.dias > 0 ? ` (${f.dias} días vencida)` : ""} · ${usd(f.saldo_usd)}`);
  const resto = abiertas.length - lineas.length;
  return [
    `Hola, ${d.cliente}. Este es su estado de cuenta${d.empresa ? ` con ${d.empresa}` : ""} al ${fecha(d.hoy)}:`,
    "",
    ...(d.a_favor < -0.009 ? [`Total en facturas: ${usd(d.por_cobrar)}`, `Notas de crédito a su favor: ${usd(Math.abs(d.a_favor))}`] : []),
    d.neto < -0.009 ? `Saldo a su favor: ${usd(Math.abs(d.neto))}` : `Saldo por pagar: ${usd(Math.max(0, d.neto))}`,
    ...(d.vencido > 0.009 ? [`Vencido: ${usd(d.vencido)}`] : []),
    ...(lineas.length ? ["", "Facturas pendientes:", ...lineas] : ["", "No tiene facturas pendientes."]),
    ...(resto > 0 ? [`… y ${resto} más.`] : []),
    "",
    `Puede ver el detalle y reportar sus pagos en el portal: ${enlacePortal}`,
    ...(d.vendedor ? ["", `Saludos, ${d.vendedor}`] : []),
  ].join("\n");
};
