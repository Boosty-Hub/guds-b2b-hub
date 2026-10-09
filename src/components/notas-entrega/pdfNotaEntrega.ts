import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { FUENTES, cargarFuentes, hexARgb, logoDe, mezclar } from "@/components/estado-cuenta/pdfEstadoCuenta";
import { colorEmpresa, direccionTexto, fechaNumerica, fmtUsd, formatoRif } from "@/components/estado-cuenta/formato";
import type { EmpresaEstadoCuenta } from "@/components/estado-cuenta/tipos";
import { MOVIMIENTO_NOTA, type ItemNota, type MovimientoNota, type NotaEntrega } from "./tipos";

// PDF de una nota de entrega (22j · NE2): "NOTA DE ENTREGA — DOCUMENTO NO FISCAL", sin IVA ni número de control, con las
// líneas, el total, lo abonado, el saldo y la firma de recibido. Misma letra y logo que el estado de cuenta; este módulo
// solo se descarga al pedir el PDF (import dinámico desde ./pdf.ts).

type RGB = [number, number, number];
const ANCHO = 210;
const MX = 14;
const UTIL = ANCHO - 2 * MX;
const TEXTO: RGB = [17, 24, 39];
const TENUE: RGB = [107, 114, 128];
const BORDE: RGB = [229, 231, 235];
const ROJO: RGB = [185, 28, 28];

const cant = (v: number) => Number(v).toLocaleString("es-VE", { maximumFractionDigits: 3 });

export interface DatosPdfNota {
  nota: NotaEntrega;
  items: ItemNota[];
  movimientos: MovimientoNota[];
  empresa: EmpresaEstadoCuenta | null;
  cliente?: { direccion?: string | null; ciudad?: string | null; estado?: string | null; telefono?: string | null } | null;
}

export async function generarPdfNotaEntrega({ nota, items, movimientos, empresa, cliente }: DatosPdfNota) {
  const [fuentes, logo] = await Promise.all([cargarFuentes(), logoDe(empresa)]);
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  FUENTES.forEach((f, i) => { doc.addFileToVFS(f.archivo, fuentes[i]); doc.addFont(f.archivo, f.familia, f.estilo); });
  const marca = hexARgb(colorEmpresa(empresa)) as RGB;
  const marcaSuave = mezclar(marca, [255, 255, 255], 0.9) as RGB;
  const nombreEmpresa = empresa?.nombre ?? "GUDS";
  doc.setProperties({ title: `Nota de entrega ${nota.documento}`, subject: `Nota de entrega ${nota.documento} · ${nota.cliente}`, author: nombreEmpresa, creator: "GUDS" });
  doc.setLanguage("es-VE");

  const letra = (tam: number, peso: "normal" | "semi" | "bold" = "normal", color: RGB = TEXTO) => {
    doc.setFont(peso === "semi" ? "PJSS" : "PJS", peso === "bold" ? "bold" : "normal");
    doc.setFontSize(tam);
    doc.setTextColor(...color);
  };
  const texto = (t: string, x: number, y: number, o?: { derecha?: boolean; ancho?: number }) => {
    const lineas = o?.ancho ? (doc.splitTextToSize(t, o.ancho) as string[]) : [t];
    doc.text(lineas[0] ?? "", x, y, { align: o?.derecha ? "right" : "left" });
  };

  // ── Encabezado ──
  let y = 14;
  const LOGO = 15;
  if (logo) doc.addImage(logo, "PNG", MX, y, LOGO, LOGO, undefined, "FAST");
  else {
    doc.setFillColor(...marca); doc.roundedRect(MX, y, LOGO, LOGO, 2.5, 2.5, "F");
    letra(10, "bold", [255, 255, 255]); doc.text((empresa?.nombre_corto ?? nombreEmpresa).slice(0, 2).toUpperCase(), MX + LOGO / 2, y + LOGO / 2 + 1.3, { align: "center" });
  }
  const xEmp = MX + LOGO + 4;
  letra(10.5, "bold"); texto(nombreEmpresa, xEmp, y + 4, { ancho: 90 });
  letra(7.6, "normal", TENUE);
  [empresa?.rif ? `RIF ${formatoRif(empresa.rif)}` : "", ...(doc.splitTextToSize(direccionTexto(empresa), 90) as string[]).slice(0, 2),
    [empresa?.telefono, empresa?.email].filter(Boolean).join("  ·  ")].filter(Boolean).slice(0, 4)
    .forEach((l, i) => texto(l, xEmp, y + 8.4 + i * 3.6, { ancho: 90 }));

  letra(14, "bold", marca); texto("NOTA DE ENTREGA", ANCHO - MX, y + 5, { derecha: true });
  letra(8.4, "bold", ROJO); texto("DOCUMENTO NO FISCAL", ANCHO - MX, y + 10, { derecha: true });
  letra(9, "semi"); texto(`Nº ${nota.documento}`, ANCHO - MX, y + 15, { derecha: true });
  y += 26;

  // ── Datos del cliente y de la nota ──
  doc.setFillColor(...marcaSuave); doc.setDrawColor(...BORDE);
  doc.roundedRect(MX, y, UTIL, 22, 2, 2, "FD");
  const col = (x: number, etiqueta: string, valor: string, ancho: number, fila: number) => {
    letra(6.8, "semi", TENUE); texto(etiqueta.toUpperCase(), x, y + 5 + fila * 9);
    letra(8.6, "normal"); texto(valor || "—", x, y + 9 + fila * 9, { ancho });
  };
  col(MX + 4, "Cliente", nota.cliente, 104, 0);
  col(MX + 4, "RIF y dirección", [nota.rif ? formatoRif(nota.rif) : null, direccionTexto(cliente ?? null)].filter(Boolean).join(" · "), 104, 1);
  col(MX + 114, "Emisión", fechaNumerica(nota.fecha_emision), 30, 0);
  col(MX + 146, "Vencimiento", fechaNumerica(nota.fecha_vencimiento), 30, 0);
  col(MX + 114, "Pedido de Odoo", nota.pedido_odoo ?? "", 30, 1);
  col(MX + 146, "Vendedor", nota.vendedor ?? "", 34, 1);
  y += 27;

  // ── Líneas ──
  const filas = items.length
    ? items.map((l) => [l.descripcion, cant(l.cantidad), fmtUsd(l.precio_usd), fmtUsd(l.subtotal_usd)])
    : [["Nota de entrega histórica (sin detalle de líneas)", "", "", fmtUsd(nota.total_usd)]];
  autoTable(doc, {
    startY: y,
    margin: { left: MX, right: MX },
    head: [["Descripción", "Cantidad", "Precio US$", "Subtotal US$"]],
    body: filas,
    theme: "plain",
    styles: { font: "PJS", fontSize: 8.2, cellPadding: { top: 1.8, bottom: 1.8, left: 2, right: 2 }, textColor: TEXTO, lineColor: BORDE, lineWidth: { bottom: 0.2 } },
    headStyles: { font: "PJSS", fontSize: 7.4, textColor: TENUE, fillColor: [247, 248, 250] },
    columnStyles: { 1: { halign: "right", cellWidth: 24 }, 2: { halign: "right", cellWidth: 28 }, 3: { halign: "right", cellWidth: 30 } },
    didParseCell: (d) => { if (d.section === "head" && d.column.index > 0) d.cell.styles.halign = "right"; },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;

  // ── Totales ──
  const total = (etiqueta: string, valor: string, fuerte = false) => {
    letra(fuerte ? 9.4 : 8.4, fuerte ? "bold" : "normal", fuerte ? TEXTO : TENUE);
    texto(etiqueta, ANCHO - MX - 36, y, { derecha: true }); texto(valor, ANCHO - MX, y, { derecha: true });
    y += fuerte ? 5.2 : 4.4;
  };
  total("Total (sin IVA)", fmtUsd(nota.total_usd), true);
  const vigentes = movimientos.filter((m) => !(m.tipo === "abono" && m.trasladado));
  for (const t of ["abono", "facturada", "devolucion", "descuento", "ajuste"] as const) {
    const s = vigentes.filter((m) => m.tipo === t).reduce((a, m) => a + Number(m.monto_usd), 0);
    if (Math.abs(s) >= 0.005) total(t === "abono" ? "Abonado" : MOVIMIENTO_NOTA[t], fmtUsd(-s));
  }
  total("Saldo", fmtUsd(nota.saldo_usd), true);

  if (nota.observacion) {
    y += 2; letra(7, "semi", TENUE); texto("OBSERVACIÓN", MX, y); y += 4;
    letra(8.2, "normal");
    const obs = (doc.splitTextToSize(nota.observacion, UTIL) as string[]).slice(0, 4);
    obs.forEach((l) => { doc.text(l, MX, y); y += 3.8; });
  }
  y += 3;
  letra(7.4, "normal", TENUE);
  (doc.splitTextToSize("Documento no fiscal: no sustituye la factura ni lleva IVA ni número de control. La mercancía se despachó con el pedido de Odoo indicado. "
    + "Montos en dólares (US$).", UTIL) as string[]).forEach((l) => { doc.text(l, MX, y); y += 3.4; });

  // ── Firmas ──
  y = Math.max(y + 18, 250);
  doc.setDrawColor(...TENUE);
  const firma = (x: number, t: string) => { doc.line(x, y, x + 70, y); letra(7.4, "normal", TENUE); texto(t, x, y + 4); };
  firma(MX, "Entregado por");
  firma(ANCHO - MX - 70, "Recibido conforme: nombre, C.I., firma y sello");
  letra(6.8, "normal", TENUE);
  texto(`Generado por GUDS el ${new Date().toLocaleString("es-VE")}`, MX, 290);
  return doc;
}

export async function descargarPdfNotaEntrega(datos: DatosPdfNota) {
  const doc = await generarPdfNotaEntrega(datos);
  const archivo = `nota-de-entrega-${datos.nota.documento.replace(/\s+/g, "-").toLowerCase()}.pdf`;
  doc.save(archivo);
  return archivo;
}
