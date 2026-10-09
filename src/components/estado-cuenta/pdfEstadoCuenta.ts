import { jsPDF } from "jspdf";
import { autoTable, type CellInput, type RowInput, type UserOptions } from "jspdf-autotable";
import logoGuds from "@/assets/guds-logo.png";
import { TRAMOS, condicionPagoTexto } from "@/hooks/useFinanzasPortal";
import {
  ESTATUS, ORIGEN_TASA, anioMes, colorEmpresa, conceptoAbono, corteDe, direccionTexto, estatusDe, fechaHora, fechaLarga, fechaNumerica, fmtBs,
  fmtTasa, fmtUsd, formatoRif, leyendaNotasEntrega, leyendaTasas, nombreArchivoEstadoCuenta, tipoYNumero, totalesDocumentos,
} from "./formato";
import type { EmpresaEstadoCuenta, EstadoCuentaCompleto } from "./tipos";

// PDF del estado de cuenta (fase 20w): UN solo documento para el admin, el portal del cliente, la página pública y el
// adjunto del correo. Se arma como archivo con jsPDF + autotable (sin imprimir la pantalla) y este módulo solo se
// descarga al pulsar "Descargar PDF" (import dinámico desde ./pdf.ts): no pesa en el arranque de los portales.
// Letra: Plus Jakarta Sans del repo en tres grosores fijos con cifras tabulares (public/fonts/pdf, ver
// scripts/fuentes-pdf.py). Montos en USD con la convención -$1,234.69.
// 21b: A4 horizontal; la franja de arriba lleva por cobrar, vencido con su antigüedad, por vencer, a favor, saldo neto y
// notas de débito.
// 22c: el cuerpo es el formato de finanzas ("FORMATO EDC"): una fila por documento con saldo al corte (Año · Mes del
// vencimiento · Tipo y Nº · Nº de control · Emisión · Vencimiento · Días · Tasa de emisión · Base · Impuesto · Total · Deuda ·
// Estatus) y debajo de cada uno su detalle (qué falta, comentario visible y abonos); fila de totales. Ya no lleva el libro
// de movimientos.

export interface OpcionesPdf {
  /** Enlace público vigente (va en el pie de cada página). */
  enlace?: string | null;
}

// ── Medidas (mm) y colores ──
const ANCHO = 297;
const ALTO = 210;
const MX = 14;                 // margen lateral
const UTIL = ANCHO - 2 * MX;   // 269
const TOPE_CONT = 25;          // inicio del contenido en páginas 2+
const PIE = 20;                // alto reservado para el pie
type RGB = [number, number, number];
const TEXTO: RGB = [17, 24, 39];
const TENUE: RGB = [107, 114, 128];
const BORDE: RGB = [229, 231, 235];
const FONDO: RGB = [247, 248, 250];
const ROJO: RGB = [185, 28, 28];
const VERDE: RGB = [4, 120, 87];
const TRAMO_COLOR: Record<string, RGB> = {
  por_vencer: [14, 165, 233], d1_30: [251, 191, 36], d31_60: [249, 115, 22], d61_90: [239, 68, 68], mas_90: [153, 27, 27],
};

export const hexARgb = (hex: string): RGB => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const mezclar = (c: RGB, con: RGB, t: number): RGB => c.map((v, i) => Math.round(v + (con[i] - v) * t)) as RGB;

// ── Letra (se descarga una vez por sesión) ──
// Exportados para el PDF de la nota de entrega (22j): misma letra y mismo logo
export const FUENTES = [
  { archivo: "plus-jakarta-sans-pdf-400-v1.ttf", familia: "PJS", estilo: "normal" },
  { archivo: "plus-jakarta-sans-pdf-700-v1.ttf", familia: "PJS", estilo: "bold" },
  { archivo: "plus-jakarta-sans-pdf-600-v1.ttf", familia: "PJSS", estilo: "normal" },
] as const;
let fuentesCache: Promise<string[]> | null = null;

const aBase64 = (buf: ArrayBuffer) => {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

export const cargarFuentes = () => {
  fuentesCache ??= Promise.all(FUENTES.map(async (f) => {
    const r = await fetch(`/fonts/pdf/${f.archivo}`);
    if (!r.ok) throw new Error("No se pudo cargar la letra del PDF");
    return aBase64(await r.arrayBuffer());
  })).catch((e) => { fuentesCache = null; throw e; });
  return fuentesCache;
};

// ── Logo: el de la empresa si lo tiene; el de GUDS en el color de la marca; si no, sus iniciales ──
const cargarImagen = (src: string, cors = false) => new Promise<HTMLImageElement>((ok, mal) => {
  const img = new Image();
  if (cors) img.crossOrigin = "anonymous";
  img.onload = () => ok(img);
  img.onerror = () => mal(new Error("imagen"));
  img.src = src;
});

const lienzo = (img: HTMLImageElement, px: number, color?: string) => {
  const c = document.createElement("canvas");
  c.width = px; c.height = px;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("canvas");
  const r = Math.min(px / img.width, px / img.height);
  const w = img.width * r, h = img.height * r;
  ctx.drawImage(img, (px - w) / 2, (px - h) / 2, w, h);
  if (color) {
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, px, px);
  }
  return c.toDataURL("image/png");
};

export async function logoDe(e: EmpresaEstadoCuenta | null): Promise<string | null> {
  try {
    if (e?.logo_url) return lienzo(await cargarImagen(e.logo_url, true), 320);
    if (!e || (e.prefijo ?? e.nombre_corto ?? "").toUpperCase() === "GUDS") return lienzo(await cargarImagen(logoGuds), 320, colorEmpresa(e));
  } catch { /* sin logo: iniciales */ }
  return null;
}

// ── Documento ──
export async function generarPdfEstadoCuenta(datos: EstadoCuentaCompleto, opciones: OpcionesPdf = {}) {
  const [fuentes, logo] = await Promise.all([cargarFuentes(), logoDe(datos.empresa)]);
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape", compress: true });
  FUENTES.forEach((f, i) => {
    doc.addFileToVFS(f.archivo, fuentes[i]);
    doc.addFont(f.archivo, f.familia, f.estilo);
  });

  const empresa = datos.empresa;
  const marca = hexARgb(colorEmpresa(empresa));
  const marcaSuave = mezclar(marca, [255, 255, 255], 0.9);
  const r = datos.resumen;
  const corte = corteDe(datos);
  const generado = new Date();
  const nombreEmpresa = empresa?.nombre ?? "GUDS";
  const clienteNombre = datos.cliente.nombre;
  doc.setProperties({
    title: `Estado de cuenta · ${clienteNombre}`,
    subject: `Estado de cuenta de ${clienteNombre} con ${nombreEmpresa} al ${fechaLarga(corte)}`,
    author: nombreEmpresa,
    creator: "GUDS",
    keywords: "estado de cuenta",
  });
  doc.setLanguage("es-VE");

  const letra = (tam: number, peso: "normal" | "semi" | "bold" = "normal", color: RGB = TEXTO) => {
    doc.setFont(peso === "semi" ? "PJSS" : "PJS", peso === "bold" ? "bold" : "normal");
    doc.setFontSize(tam);
    doc.setTextColor(...color);
  };
  const texto = (t: string, x: number, y: number, o?: { derecha?: boolean; centro?: boolean; ancho?: number }) => {
    const linea = o?.ancho ? (doc.splitTextToSize(t, o.ancho) as string[])[0] ?? "" : t;
    const recortado = o?.ancho && linea !== t ? `${linea.replace(/\s+\S*$/, "")}…` : linea;
    doc.text(recortado, x, y, { align: o?.derecha ? "right" : o?.centro ? "center" : "left", baseline: "alphabetic" });
  };

  // ── Encabezado de la primera página ──
  let y = 14;
  const LOGO = 15;
  if (logo) {
    doc.addImage(logo, "PNG", MX, y, LOGO, LOGO, undefined, "FAST");
  } else {
    doc.setFillColor(...marca);
    doc.roundedRect(MX, y, LOGO, LOGO, 2.5, 2.5, "F");
    letra(10, "bold", [255, 255, 255]);
    texto((empresa?.nombre_corto ?? nombreEmpresa).slice(0, 2).toUpperCase(), MX + LOGO / 2, y + LOGO / 2 + 1.3, { centro: true });
  }
  const xEmp = MX + LOGO + 4;
  letra(10.5, "bold");
  texto(nombreEmpresa, xEmp, y + 4, { ancho: 100 });
  letra(7.6, "normal", TENUE);
  const dirEmpresa = (doc.splitTextToSize(direccionTexto(empresa), 102) as string[]).slice(0, 2);
  const lineasEmpresa = [
    empresa?.rif ? `RIF ${formatoRif(empresa.rif)}` : "",
    ...dirEmpresa,
    [empresa?.telefono, empresa?.email, empresa?.sitio_web].filter(Boolean).join("  ·  "),
  ].filter(Boolean);
  lineasEmpresa.slice(0, 4).forEach((l, i) => texto(l, xEmp, y + 8.4 + i * 3.6, { ancho: 102 }));

  letra(15, "bold", marca);
  texto("ESTADO DE CUENTA", ANCHO - MX, y + 5.2, { derecha: true });
  letra(8.4, "semi");
  texto(`Actualizado al ${fechaNumerica(corte)}`, ANCHO - MX, y + 10.6, { derecha: true });
  letra(7.6, "normal", TENUE);
  texto("Montos en US$ · documentos con saldo al corte", ANCHO - MX, y + 14.4, { derecha: true });

  y = 14 + Math.max(LOGO, 8.4 + lineasEmpresa.length * 3.6) + 3;
  doc.setDrawColor(...marca);
  doc.setLineWidth(0.6);
  doc.line(MX, y, ANCHO - MX, y);
  y += 5;

  // ── Cliente y saldo neto ──
  const condicion = condicionPagoTexto(datos.cliente.condicion_pago, datos.cliente.dias_credito);
  const dirCliente = direccionTexto(datos.cliente);
  const altoCliente = 23 + (dirCliente ? 3.8 : 0);
  doc.setFillColor(...FONDO);
  doc.roundedRect(MX, y, UTIL, altoCliente, 2.2, 2.2, "F");
  letra(6.6, "semi", TENUE);
  texto("CLIENTE", MX + 5, y + 6);
  letra(11, "bold");
  texto(clienteNombre, MX + 5, y + 11.6, { ancho: 180 });
  letra(7.8, "normal");
  texto([datos.cliente.rif && `RIF ${formatoRif(datos.cliente.rif)}`, datos.cliente.codigo && `Código ${datos.cliente.codigo}`].filter(Boolean).join("   ·   ") || "—",
    MX + 5, y + 16.2, { ancho: 180 });
  let yc = y + 16.2;
  if (dirCliente) { yc += 3.8; letra(7.4, "normal", TENUE); texto(dirCliente, MX + 5, yc, { ancho: 180 }); }
  yc += 3.8;
  letra(7.4, "normal", TENUE);
  texto(`Condición de pago: ${condicion ?? "—"}`, MX + 5, yc, { ancho: 180 });

  const xNeto = ANCHO - MX - 5;
  letra(6.6, "semi", TENUE);
  texto("SALDO NETO", xNeto, y + 6, { derecha: true });
  letra(16, "bold", r.neto > 0.004 ? TEXTO : VERDE);
  texto(fmtUsd(r.neto), xNeto, y + 13.4, { derecha: true });
  letra(7, "normal", TENUE);
  texto(r.a_favor > 0 ? `Por pagar ${fmtUsd(r.saldo)} menos a favor ${fmtUsd(r.a_favor)}` : "Saldo por pagar", xNeto, y + 17.6, { derecha: true, ancho: 60 });
  y += altoCliente + 5;

  // ── Franja (aprobada): por cobrar, vencido con su antigüedad, por vencer, a favor, saldo neto y notas de débito ──
  const tramosVencido = TRAMOS.filter((t) => t.k !== "por_vencer");
  const kpis: { etiqueta: string; valor: string; detalle: string[]; color?: RGB }[] = [
    { etiqueta: "SALDO POR PAGAR", valor: fmtUsd(r.saldo), detalle: [r.facturas_abiertas === 0 ? "Sin documentos pendientes" : `${r.facturas_abiertas} ${r.facturas_abiertas === 1 ? "documento" : "documentos"}`] },
    { etiqueta: "VENCIDO", valor: fmtUsd(r.vencido), color: r.vencido > 0.004 ? ROJO : undefined,
      detalle: r.vencido <= 0.004 ? ["Nada vencido"] : [
        `${r.facturas_vencidas} ${r.facturas_vencidas === 1 ? "documento" : "documentos"}`,
        tramosVencido.slice(0, 2).map((t) => `${t.etiqueta.replace(/ días?$/, "")}: ${fmtUsd(Number(r[t.k]))}`).join("  ·  "),
        tramosVencido.slice(2).map((t) => `${t.etiqueta.replace(/ días?$/, "")}: ${fmtUsd(Number(r[t.k]))}`).join("  ·  "),
      ] },
    { etiqueta: "POR VENCER", valor: fmtUsd(r.por_vencer), detalle: ["Dentro del plazo"] },
    { etiqueta: "A FAVOR", valor: fmtUsd(r.a_favor), detalle: [r.a_favor <= 0 ? "Sin saldo a favor" : [r.nc_a_favor > 0 && "Notas de crédito", r.anticipos > 0 && "anticipos"].filter(Boolean).join(" y ")], color: r.a_favor > 0.004 ? VERDE : undefined },
    { etiqueta: "SALDO NETO", valor: fmtUsd(r.neto), detalle: ["Por pagar menos a favor"] },
    { etiqueta: "NOTAS DE DÉBITO", valor: fmtUsd(r.notas_debito_saldo ?? 0), detalle: [`${r.notas_debito_abiertas ?? 0} con saldo (en el saldo)`] },
  ];
  const gap = 3;
  const wk = (UTIL - gap * (kpis.length - 1)) / kpis.length;
  const altoK = 22;
  kpis.forEach((k, i) => {
    const x = MX + i * (wk + gap);
    doc.setDrawColor(...BORDE);
    doc.setLineWidth(0.25);
    doc.roundedRect(x, y, wk, altoK, 2, 2, "S");
    letra(6.4, "semi", TENUE);
    texto(k.etiqueta, x + 3.5, y + 5.2);
    letra(12, "bold", k.color ?? TEXTO);
    texto(k.valor, x + 3.5, y + 11.2, { ancho: wk - 6 });
    letra(6.3, "normal", TENUE);
    k.detalle.filter(Boolean).slice(0, 3).forEach((l, j) => texto(l, x + 3.5, y + 15 + j * 2.9, { ancho: wk - 5 }));
  });
  y += altoK + 4;

  // Barra de antigüedad del saldo (por vencer y tramos del vencido) bajo la franja
  const total = Number(r.saldo) || 0;
  doc.setFillColor(...BORDE);
  doc.roundedRect(MX, y, UTIL, 2.6, 1.3, 1.3, "F");
  if (total > 0) {
    let x = MX;
    TRAMOS.forEach((t) => {
      const v = Number(r[t.k]) || 0;
      if (v <= 0) return;
      const w = (v / total) * UTIL;
      doc.setFillColor(...TRAMO_COLOR[t.k]);
      doc.rect(x, y, w, 2.6, "F");
      x += w;
    });
    doc.setDrawColor(255, 255, 255);
    doc.setLineWidth(0.8);
    doc.roundedRect(MX - 0.4, y - 0.4, UTIL + 0.8, 3.4, 1.7, 1.7, "S");
  }
  y += 6;
  letra(6.6, "normal", TENUE);
  {
    let x = MX;
    TRAMOS.forEach((t) => {
      const v = Number(r[t.k]) || 0;
      const p = total > 0 ? (v / total) * 100 : 0;
      doc.setFillColor(...TRAMO_COLOR[t.k]);
      doc.roundedRect(x, y - 1.9, 1.9, 1.9, 0.4, 0.4, "F");
      const etiqueta = `${t.etiqueta}: ${fmtUsd(v)}${v > 0 ? ` (${p < 1 ? "<1" : p.toFixed(0)} %)` : ""}`;
      texto(etiqueta, x + 3, y);
      x += Math.max(doc.getTextWidth(etiqueta) + 9, UTIL / TRAMOS.length);
    });
  }
  y += 6;

  // ── Utilidades de sección y tablas ──
  const limite = ALTO - PIE;
  const asegurar = (alto: number) => {
    if (y + alto > limite) { doc.addPage(); y = TOPE_CONT; }
  };
  const seccion = (t: string, sub?: string) => {
    asegurar(20);
    letra(9.6, "bold");
    texto(t, MX, y);
    if (sub) { letra(7.2, "normal", TENUE); texto(sub, ANCHO - MX, y, { derecha: true, ancho: 110 }); }
    y += 2.8;
  };
  const tabla = (o: UserOptions) => {
    // Los estilos de cada tabla se suman a los de base (antes los reemplazaban y el cuerpo salía en Helvetica)
    const { styles, headStyles, ...resto } = o;
    autoTable(doc, {
      theme: "plain",
      startY: y,
      margin: { left: MX, right: MX, top: TOPE_CONT, bottom: PIE + 2 },
      rowPageBreak: "avoid",
      styles: {
        font: "PJS", fontStyle: "normal", fontSize: 7.6, textColor: TEXTO, cellPadding: { top: 1.7, bottom: 1.7, left: 1.8, right: 1.8 },
        lineColor: BORDE, lineWidth: { bottom: 0.2 }, valign: "middle", overflow: "linebreak",
        ...styles,
      },
      headStyles: { font: "PJSS", fontStyle: "normal", fontSize: 6.8, textColor: TENUE, fillColor: FONDO, lineWidth: 0, ...headStyles },
      ...resto,
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 7;
  };
  const der = { halign: "right" as const };

  // ── Documentos con saldo al corte, con el formato de finanzas ──
  const docsPdf = datos.abiertos ?? [];
  seccion(`Estado de cuenta actualizado al ${fechaNumerica(corte)}`,
    docsPdf.length ? `${docsPdf.length} ${docsPdf.length === 1 ? "documento" : "documentos"} · días = corte − vencimiento · tasa de emisión en Bs por US$` : undefined);
  if (docsPdf.length === 0) {
    asegurar(10);
    letra(7.8, "normal", TENUE);
    texto("No hay facturas ni notas con saldo pendiente.", MX, y + 3.5);
    y += 11;
  } else {
    const num = (v: number | null | undefined) => Number(v ?? 0);
    const m = (v: number | null | undefined) => (Math.abs(num(v)) >= 0.005 ? fmtUsd(num(v)) : "—");
    const t = totalesDocumentos(docsPdf);
    const COLOR_ESTATUS: Record<string, RGB> = { pendiente: TEXTO, retencion: [146, 64, 14], nc_favor: VERDE, a_favor: VERDE };
    const filas: RowInput[] = [];
    docsPdf.forEach((d) => {
      const { anio, mes } = anioMes(d);
      const est = estatusDe(d);
      const vencida = d.saldo > 0 && d.dias > 0;
      filas.push([
        { content: anio ?? "—", styles: { textColor: TENUE } },
        { content: mes ?? "—", styles: { textColor: TENUE } },
        { content: tipoYNumero(d), styles: { font: "PJSS" } },
        d.nro_control ?? "—",
        fechaNumerica(d.emision),
        fechaNumerica(d.vence ?? d.emision),
        { content: String(d.dias), styles: { ...der, textColor: vencida ? ROJO : TENUE } },
        { content: d.tasa_emision != null ? fmtTasa(d.tasa_emision) + (d.tasa_origen && ORIGEN_TASA[d.tasa_origen]?.marca ? ` ${ORIGEN_TASA[d.tasa_origen].marca}` : "") : "—", styles: { ...der, textColor: TENUE } },
        { content: m(d.base), styles: der },
        { content: m(d.iva), styles: der },
        { content: m(d.total), styles: der },
        { content: fmtUsd(d.saldo), styles: { ...der, font: "PJSS", textColor: d.saldo < 0 ? VERDE : TEXTO } },
        { content: ESTATUS[est].texto, styles: { textColor: COLOR_ESTATUS[est], fontSize: 6.3 } },
      ] as CellInput[]);
      // Detalle: qué falta, comentario visible y abonos (lo mismo que se despliega en pantalla)
      const abonos = d.abonos ?? [];
      const max = 8;
      const partes = [
        d.que_falta ? `Qué falta: ${d.que_falta.texto}` : "",
        // Solo los visibles: el PDF del admin es el mismo que se adjunta al correo del cliente
        ...(d.comentarios ?? []).filter((c) => c.visible !== false).slice(0, 2).map((c) => `Comentario: ${c.texto}`),
        abonos.length ? `Abonos: ${abonos.slice(0, max).map((a) => [
          fechaNumerica(a.fecha), conceptoAbono(a), a.documento, a.banco, a.referencia && `ref. ${a.referencia}`,
          `${fmtUsd(a.monto)}${a.moneda === "VES" && a.monto_moneda != null ? ` (${fmtBs(a.monto_moneda)})` : ""}`,
        ].filter(Boolean).join(" ")).join("   ·   ")}${abonos.length > max ? `   ·   y ${abonos.length - max} más` : ""}` : "",
      ].filter(Boolean);
      if (partes.length) {
        filas.push([{ content: partes.join("     "), colSpan: 13, styles: { fontSize: 5.9, textColor: TENUE, cellPadding: { top: 0.4, bottom: 1.6, left: 4, right: 1.8 } } }] as CellInput[]);
      }
    });
    const pie = { font: "PJS", fontStyle: "bold" as const, lineWidth: 0, fillColor: marcaSuave };
    filas.push([
      { content: "Totales", colSpan: 8, styles: pie },
      { content: fmtUsd(t.base), styles: { ...der, ...pie } }, { content: fmtUsd(t.iva), styles: { ...der, ...pie } },
      { content: fmtUsd(t.total), styles: { ...der, ...pie } }, { content: fmtUsd(t.deuda), styles: { ...der, ...pie } },
      { content: t.aFavor < -0.004 ? `Por cobrar ${fmtUsd(t.porCobrar)} · a favor ${fmtUsd(t.aFavor)}` : "", styles: { ...pie, fontSize: 5.9, fontStyle: "normal" as const } },
    ] as CellInput[]);
    tabla({
      head: [["Año", "Mes", "Tipo y Nº", "Nº de control", "Emisión", "Vencimiento", { content: "Días", styles: der },
        { content: "Tasa de emisión", styles: der }, { content: "Base imponible US$", styles: der }, { content: "Impuesto US$", styles: der },
        { content: "Total US$", styles: der }, { content: "Deuda US$", styles: der }, "Estatus"]],
      body: filas,
      styles: { fontSize: 6.7, cellPadding: { top: 1.4, bottom: 1.4, left: 1.4, right: 1.4 } },
      columnStyles: {
        0: { cellWidth: 10 }, 1: { cellWidth: 8 }, 2: { cellWidth: 22 }, 3: { cellWidth: 21 }, 4: { cellWidth: 16 }, 5: { cellWidth: 18.5 },
        6: { cellWidth: 10 }, 7: { cellWidth: 16.5 }, 8: { cellWidth: 22 }, 9: { cellWidth: 19 }, 10: { cellWidth: 21 }, 11: { cellWidth: 21 },
      },
    });
  }

  // ── Notas ──
  const notas = [
    "Montos en dólares (US$); las notas de crédito a favor van en negativo. Los documentos en bolívares se expresan en US$ a la tasa de cada documento.",
    "Días transcurridos = fecha de corte − vencimiento (negativo = por vencer). Tasa de emisión: en bolívares, la del documento; en dólares, la BCV del día de emisión (o la última publicada antes); en una nota de crédito, la de la factura que afecta."
      + (leyendaTasas(docsPdf) ? ` ${leyendaTasas(docsPdf)}.` : ""),
    "Refleja lo registrado a la fecha de corte; los pagos declarados quedan pendientes hasta su verificación. «Qué falta» es una sugerencia automática según la base, el IVA y lo abonado; los comentarios los escribe nuestro equipo.",
    ...(leyendaNotasEntrega(docsPdf) ? [`${leyendaNotasEntrega(docsPdf)}; se incluye en el saldo.`] : []),
  ];
  asegurar(notas.length * 3.6 + 3);
  letra(6.9, "normal", TENUE);
  notas.forEach((n) => {
    const lineas = doc.splitTextToSize(n, UTIL) as string[];
    doc.text(lineas, MX, y);
    y += lineas.length * 3.2 + 0.6;
  });

  // ── Encabezado corto (páginas 2+) y pie con el enlace y la paginación ──
  const paginas = doc.getNumberOfPages();
  for (let p = 1; p <= paginas; p++) {
    doc.setPage(p);
    if (p > 1) {
      letra(7.6, "bold");
      texto(empresa?.nombre_corto ?? nombreEmpresa, MX, 13, { ancho: 60 });
      letra(7.4, "normal", TENUE);
      const cab = `Estado de cuenta · actualizado al ${fechaNumerica(corte)}`;
      const anchoCab = doc.getTextWidth(cab);
      texto(cab, ANCHO - MX, 13, { derecha: true });
      letra(7.4, "semi");
      texto(clienteNombre, ANCHO - MX - anchoCab - 3, 13, { derecha: true, ancho: UTIL - 64 - anchoCab });
      doc.setDrawColor(...marca);
      doc.setLineWidth(0.35);
      doc.line(MX, 16, ANCHO - MX, 16);
    }
    const yp = ALTO - 13;
    doc.setDrawColor(...BORDE);
    doc.setLineWidth(0.25);
    doc.line(MX, yp - 4, ANCHO - MX, yp - 4);
    if (opciones.enlace) {
      letra(6.9, "normal", TENUE);
      texto("Consulta tu estado de cuenta actualizado en:", MX, yp);
      letra(6.9, "semi", marca);
      const url = opciones.enlace;
      const corto = url.length > 140 ? `${url.slice(0, 139)}…` : url;
      doc.textWithLink(corto, MX, yp + 3.6, { url });
    } else {
      letra(6.9, "normal", TENUE);
      texto(`${nombreEmpresa}${empresa?.rif ? ` · RIF ${formatoRif(empresa.rif)}` : ""}`, MX, yp, { ancho: 130 });
    }
    letra(6.4, "normal", TENUE);
    texto(`Generado el ${fechaHora(generado)}`, MX, yp + (opciones.enlace ? 7.2 : 3.6));
    letra(7.2, "semi", TENUE);
    texto(`Página ${p} de ${paginas}`, ANCHO - MX, yp, { derecha: true });
  }

  const nombre = nombreArchivoEstadoCuenta(clienteNombre, corte);
  const blob = doc.output("blob");
  return { blob, nombre, paginas };
}

/** Genera y descarga el PDF (sin abrir el diálogo de impresión). */
export async function descargarPdfEstadoCuenta(datos: EstadoCuentaCompleto, opciones: OpcionesPdf = {}) {
  const { blob, nombre } = await generarPdfEstadoCuenta(datos, opciones);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return nombre;
}

/** PDF en base64 (adjunto del correo). */
export async function pdfEstadoCuentaBase64(datos: EstadoCuentaCompleto, opciones: OpcionesPdf = {}) {
  const { blob, nombre } = await generarPdfEstadoCuenta(datos, opciones);
  return { base64: aBase64(await blob.arrayBuffer()), nombre, bytes: blob.size };
}
