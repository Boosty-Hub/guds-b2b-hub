// PDF y Excel del plan de pago (21c), para aprobación y envío a tesorería. jsPDF y xlsx se descargan solo al pulsar.
import type { ItemPlan, PlanPago } from "./comun";
import { ESTADO_ITEM, ESTADO_PLAN, fmtBs, fmtFecha, fmtUsd, nombrePersona } from "./comun";

export interface DatosExportPlan {
  plan: PlanPago;
  items: ItemPlan[];
  empresa: { nombre: string; rif: string | null; color?: string | null } | null;
  bancos: Record<string, string>;
  cobertura: { usd: { plan: number; disp: number }; bs: { plan: number; disp: number; planUsd: number } };
  tasa: number;
}

const porProveedor = (items: ItemPlan[]) => {
  const m = new Map<string, { nombre: string; items: ItemPlan[]; total: number }>();
  for (const i of items) {
    const k = i.proveedor_id ?? i.proveedor_nombre ?? "—";
    const g = m.get(k) ?? { nombre: i.proveedor_nombre || "Sin proveedor", items: [], total: 0 };
    g.items.push(i); g.total += Number(i.monto_usd);
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => b.total - a.total);
};
const nombreArchivo = (p: PlanPago, ext: string) => `plan-pago-${p.numero}.${ext}`;

export async function descargarPdfPlan(d: DatosExportPlan) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const ANCHO = 297, MX = 12;
  const color = /^#[0-9a-f]{6}$/i.test(d.empresa?.color ?? "") ? d.empresa!.color! : "#1e3a5f";
  const rgb = [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)] as [number, number, number];
  const { plan, items } = d;
  const total = items.reduce((s, i) => s + Number(i.monto_usd), 0);
  const pagado = items.reduce((s, i) => s + Number(i.monto_pagado_usd), 0);

  doc.setFillColor(...rgb); doc.rect(0, 0, ANCHO, 4, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(17, 24, 39);
  doc.text(`Plan de pago ${plan.numero}`, MX, 15);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(107, 114, 128);
  doc.text([d.empresa?.nombre, d.empresa?.rif ? `RIF ${d.empresa.rif}` : null].filter(Boolean).join(" · "), MX, 20.5);
  doc.text(`Estado: ${ESTADO_PLAN[plan.estado]?.label ?? plan.estado}   ·   Pago: ${fmtFecha(plan.fecha_pago)}   ·   Pendiente al: ${fmtFecha(plan.fecha_corte)}   ·   Generado: ${new Date().toLocaleString("es-VE")}`, MX, 25.5);
  doc.text(`Creado por ${nombrePersona(plan.creado)}${plan.aprobado ? `   ·   Aprobado por ${nombrePersona(plan.aprobado)} el ${fmtFecha(plan.aprobado_at)}` : "   ·   Sin aprobar"}`, MX, 30.5);
  doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(...rgb);
  doc.text(`Total ${fmtUsd(total)}`, ANCHO - MX, 15, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(107, 114, 128);
  doc.text(`${items.length} facturas · ${new Set(items.map((i) => i.proveedor_id)).size} proveedores`, ANCHO - MX, 20.5, { align: "right" });
  if (pagado > 0.009) doc.text(`Pagado según Odoo: ${fmtUsd(pagado)}`, ANCHO - MX, 25.5, { align: "right" });

  // Cobertura por moneda
  autoTable(doc, {
    startY: 35, margin: { left: MX }, tableWidth: 150, theme: "grid",
    styles: { font: "helvetica", fontSize: 8, cellPadding: 1.2 }, headStyles: { fillColor: [247, 248, 250], textColor: [55, 65, 81] },
    head: [["Moneda de pago", "Planificado", "En bancos (Odoo)", "Queda"]],
    body: [
      ["USD", fmtUsd(d.cobertura.usd.plan), fmtUsd(d.cobertura.usd.disp), fmtUsd(d.cobertura.usd.disp - d.cobertura.usd.plan)],
      ["Bs.", `${fmtBs(d.cobertura.bs.plan)} (${fmtUsd(d.cobertura.bs.planUsd)})`, fmtBs(d.cobertura.bs.disp), fmtBs(d.cobertura.bs.disp - d.cobertura.bs.plan)],
    ],
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
  });

  const cuerpo: (string | { content: string; colSpan?: number; styles?: Record<string, unknown> })[][] = [];
  for (const g of porProveedor(items)) {
    cuerpo.push([{ content: g.nombre, colSpan: 7, styles: { fontStyle: "bold", fillColor: [243, 244, 246] } }, { content: fmtUsd(g.total), styles: { fontStyle: "bold", halign: "right", fillColor: [243, 244, 246] } }, { content: "", colSpan: 3, styles: { fillColor: [243, 244, 246] } }]);
    for (const i of g.items) {
      cuerpo.push([
        `${i.factura_numero}${i.factura_referencia ? ` · ${i.factura_referencia}` : ""}`, fmtFecha(i.fecha_vencimiento), fmtUsd(Number(i.saldo_al_planificar)),
        Number(i.ret_pendiente_est) > 0.009 ? fmtUsd(Number(i.ret_pendiente_est)) : "—", i.moneda_pago === "BS" ? "Bs." : "USD",
        i.banco_id ? d.bancos[i.banco_id] ?? "" : "", i.moneda_pago === "BS" && d.tasa > 0 ? fmtBs(Number(i.monto_usd) * d.tasa) : "",
        fmtUsd(Number(i.monto_usd)), ESTADO_ITEM[i.estado]?.label ?? i.estado,
        Number(i.monto_pagado_usd) > 0.009 ? fmtUsd(Number(i.monto_pagado_usd)) : "", i.notas ?? i.motivo_diferencia ?? "",
      ]);
    }
  }
  autoTable(doc, {
    startY: (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4, margin: { left: MX, right: MX }, theme: "striped",
    styles: { font: "helvetica", fontSize: 7.5, cellPadding: 1.1, overflow: "linebreak" },
    headStyles: { fillColor: rgb, textColor: [255, 255, 255] },
    head: [["Factura", "Vence", "Saldo", "Ret. pend.", "Moneda", "Banco", "Equiv. Bs.", "A pagar USD", "Estado", "Pagado", "Notas"]],
    body: cuerpo as never,
    foot: [[{ content: "Total del plan", colSpan: 7, styles: { halign: "right" } }, { content: fmtUsd(total), styles: { halign: "right" } }, { content: "", colSpan: 3 }]] as never,
    footStyles: { fillColor: [243, 244, 246], textColor: [17, 24, 39], fontStyle: "bold" },
    columnStyles: { 2: { halign: "right" }, 3: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right", fontStyle: "bold" }, 9: { halign: "right" }, 10: { cellWidth: 45 } },
  });
  if (plan.notas) {
    const y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
    doc.setFontSize(8.5); doc.setTextColor(55, 65, 81);
    doc.text(doc.splitTextToSize(`Notas: ${plan.notas}`, ANCHO - 2 * MX), MX, y);
  }
  const paginas = doc.getNumberOfPages();
  for (let n = 1; n <= paginas; n++) {
    doc.setPage(n); doc.setFontSize(7.5); doc.setTextColor(156, 163, 175);
    doc.text("Los pagos se registran en Odoo; GUDS cierra cada factura del plan cuando el pago llega por la sincronización.", MX, 203);
    doc.text(`Página ${n} de ${paginas}`, ANCHO - MX, 203, { align: "right" });
  }
  doc.save(nombreArchivo(plan, "pdf"));
}

export async function descargarExcelPlan(d: DatosExportPlan) {
  const XLSX = await import("xlsx");
  const { plan, items } = d;
  const filas = items.map((i) => ({
    Proveedor: i.proveedor_nombre ?? "", Factura: i.factura_numero, Referencia: i.factura_referencia ?? "", Vence: i.fecha_vencimiento ?? "",
    "Saldo al planificar": Number(i.saldo_al_planificar), "Ret. pend. (est.)": Number(i.ret_pendiente_est), "A pagar USD": Number(i.monto_usd),
    "Moneda de pago": i.moneda_pago === "BS" ? "Bs." : "USD", "Equivalente Bs.": i.moneda_pago === "BS" && d.tasa > 0 ? Math.round(Number(i.monto_usd) * d.tasa * 100) / 100 : null,
    Banco: i.banco_id ? d.bancos[i.banco_id] ?? "" : "", Estado: ESTADO_ITEM[i.estado]?.label ?? i.estado,
    "Pagado USD (Odoo)": Number(i.monto_pagado_usd), Diferencia: i.diferencia_usd != null ? Number(i.diferencia_usd) : null,
    "Pagos Odoo": i.pagos_odoo ?? "", "Fecha pago real": i.fecha_pago_real ?? "", Notas: [i.notas, i.motivo_diferencia].filter(Boolean).join(" · "),
  }));
  const hoja = XLSX.utils.json_to_sheet(filas);
  hoja["!cols"] = [{ wch: 34 }, { wch: 18 }, { wch: 16 }, { wch: 11 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 9 }, { wch: 14 }, { wch: 22 }, { wch: 11 }, { wch: 12 }, { wch: 11 }, { wch: 22 }, { wch: 12 }, { wch: 40 }];
  const resumen = XLSX.utils.aoa_to_sheet([
    ["Plan de pago", plan.numero], ["Empresa", d.empresa?.nombre ?? ""], ["Estado", ESTADO_PLAN[plan.estado]?.label ?? plan.estado],
    ["Fecha de pago", plan.fecha_pago], ["Pendiente al (corte)", plan.fecha_corte], ["Creado por", nombrePersona(plan.creado)],
    ["Aprobado por", plan.aprobado ? nombrePersona(plan.aprobado) : ""], ["Tasa BCV", d.tasa || ""], [],
    ["Moneda", "Planificado", "En bancos (Odoo)", "Queda"],
    ["USD", d.cobertura.usd.plan, d.cobertura.usd.disp, d.cobertura.usd.disp - d.cobertura.usd.plan],
    ["Bs.", d.cobertura.bs.plan, d.cobertura.bs.disp, d.cobertura.bs.disp - d.cobertura.bs.plan], [],
    ["Total USD", items.reduce((s, i) => s + Number(i.monto_usd), 0)], ["Pagado USD (Odoo)", items.reduce((s, i) => s + Number(i.monto_pagado_usd), 0)],
    ["Notas", plan.notas ?? ""],
  ]);
  resumen["!cols"] = [{ wch: 22 }, { wch: 22 }, { wch: 18 }, { wch: 18 }];
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, resumen, "Resumen");
  XLSX.utils.book_append_sheet(libro, hoja, "Facturas");
  XLSX.writeFile(libro, nombreArchivo(plan, "xlsx"));
}
