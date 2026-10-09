import { nombreArchivoExcel, type LibroExcel } from "@/lib/excel";
import { TRAMOS } from "@/hooks/useFinanzasPortal";
import {
  ESTATUS, anioMes, conceptoAbono, corteDe, estatusDe, fechaNumerica, formatoRif, leyendaNotasEntrega, origenTasaTexto, textoActualizado, tipoYNumero,
} from "./formato";
import type { AbonoDocumento, DocumentoAbierto, EstadoCuentaCompleto } from "./tipos";

const origenTasa = (d: DocumentoAbierto) => { const t = origenTasaTexto(d); return t ? t[0].toUpperCase() + t.slice(1) : ""; };

// Excel del estado de cuenta (fase 22c) con el formato del equipo de finanzas ("FORMATO EDC"): mismo encabezado (empresa,
// RIF, cliente y "Estado de cuenta actualizado al …"), mismas columnas y fila de totales; más el detalle de los abonos y
// el resumen. Sale de los mismos datos que la pantalla y el PDF (admin, enlace público, portal y vendedor). Solo lleva los
// comentarios visibles para el cliente: es el mismo archivo que se le puede mandar.

const comentarioVisible = (d: DocumentoAbierto) => (d.comentarios ?? []).filter((c) => c.visible !== false).map((c) => c.texto).join(" · ");

export function libroEstadoCuenta(datos: EstadoCuentaCompleto): LibroExcel {
  const corte = corteDe(datos);
  const empresa = datos.empresa;
  const docs = datos.abiertos ?? [];
  const encabezado = [
    empresa?.nombre ?? "GUDS",
    empresa?.rif ? `RIF: ${formatoRif(empresa.rif)}` : "",
    `Cliente: ${datos.cliente.nombre}${datos.cliente.rif ? ` · RIF ${formatoRif(datos.cliente.rif)}` : ""}`,
    textoActualizado(datos),
  ].filter(Boolean);
  const r = datos.resumen;
  const abonos = docs.flatMap((d) => (d.abonos ?? []).map((a) => ({ d, a })));

  return {
    archivo: nombreArchivoExcel("estado de cuenta", empresa?.nombre_corto ?? empresa?.nombre, datos.cliente.nombre, corte),
    autor: empresa?.nombre ?? "GUDS",
    hojas: [
      {
        nombre: "Estado de cuenta",
        encabezado,
        filas: docs,
        totales: "Totales",
        columnas: [
          { titulo: "Año", valor: (d: DocumentoAbierto) => anioMes(d).anio, tipo: "entero", total: false, ancho: 7 },
          { titulo: "Mes", valor: (d: DocumentoAbierto) => anioMes(d).mes, tipo: "texto", ancho: 6 },
          { titulo: "Tipo y Nº", valor: (d: DocumentoAbierto) => tipoYNumero(d), tipo: "texto", ancho: 16 },
          { titulo: "Nº de control", valor: (d: DocumentoAbierto) => d.nro_control ?? "", tipo: "texto", ancho: 15 },
          { titulo: "Fecha de emisión", valor: (d: DocumentoAbierto) => d.emision, tipo: "fecha", ancho: 12 },
          { titulo: "Fecha de vencimiento", valor: (d: DocumentoAbierto) => d.vence ?? d.emision, tipo: "fecha", ancho: 13 },
          { titulo: "Días transcurridos", valor: (d: DocumentoAbierto) => d.dias, tipo: "entero", total: false, ancho: 12 },
          { titulo: "Tasa de emisión", valor: (d: DocumentoAbierto) => d.tasa_emision ?? null, tipo: "tasa", total: false, ancho: 12 },
          { titulo: "Base imponible US$", valor: (d: DocumentoAbierto) => d.base ?? null, tipo: "usd", ancho: 15 },
          { titulo: "Impuesto US$", valor: (d: DocumentoAbierto) => d.iva ?? null, tipo: "usd", ancho: 13 },
          { titulo: "Total US$", valor: (d: DocumentoAbierto) => d.total, tipo: "usd", ancho: 14 },
          { titulo: "Deuda US$", valor: (d: DocumentoAbierto) => d.saldo, tipo: "usd", ancho: 14 },
          { titulo: "Estatus", valor: (d: DocumentoAbierto) => ESTATUS[estatusDe(d)].texto, tipo: "texto", ancho: 30 },
          // 22e: de dónde sale la tasa (después de las columnas del formato del equipo, para no moverlas)
          { titulo: "Origen de la tasa", valor: (d: DocumentoAbierto) => origenTasa(d), tipo: "texto", ancho: 34 },
          { titulo: "Qué falta (sugerencia)", valor: (d: DocumentoAbierto) => d.que_falta?.texto ?? "", tipo: "texto", ancho: 36 },
          { titulo: "Comentario", valor: comentarioVisible, tipo: "texto", ancho: 40, ajustar: true },
        ],
        notas: [
          "Montos en dólares (US$). Las notas de crédito a favor van en negativo. Los documentos en bolívares se expresan en US$ a la tasa de cada documento.",
          "Días transcurridos = fecha de corte − fecha de vencimiento (negativo = por vencer).",
          "Tasa de emisión: en los documentos en bolívares, la del documento; en los documentos en dólares, la tasa BCV del día de emisión (o la última publicada antes); en las notas de crédito, la de la factura que afectan. La columna «Origen de la tasa» dice de dónde sale cada una (las tomadas de Profit son de días sin tasa BCV en Odoo).",
          "«Qué falta» es una sugerencia automática según la base, el IVA y lo abonado; los comentarios los escribe nuestro equipo.",
          ...(leyendaNotasEntrega(docs) ? [`${leyendaNotasEntrega(docs)}; se incluye en el saldo.`] : []),
        ],
      },
      {
        nombre: "Abonos",
        encabezado: [...encabezado.slice(0, -1), `Abonos aplicados a los documentos con saldo, hasta el ${fechaNumerica(corte)}`],
        filas: abonos,
        totales: "Totales",
        columnas: [
          { titulo: "Tipo y Nº", valor: (x: { d: DocumentoAbierto; a: AbonoDocumento }) => tipoYNumero(x.d), tipo: "texto", ancho: 16 },
          { titulo: "Nº de control", valor: (x: { d: DocumentoAbierto }) => x.d.nro_control ?? "", tipo: "texto", ancho: 15 },
          { titulo: "Fecha", valor: (x: { a: AbonoDocumento }) => x.a.fecha, tipo: "fecha", ancho: 12 },
          { titulo: "Concepto", valor: (x: { a: AbonoDocumento }) => conceptoAbono(x.a), tipo: "texto", ancho: 24 },
          { titulo: "Documento", valor: (x: { a: AbonoDocumento }) => x.a.documento ?? "", tipo: "texto", ancho: 22 },
          { titulo: "Referencia", valor: (x: { a: AbonoDocumento }) => x.a.referencia ?? "", tipo: "texto", ancho: 18 },
          { titulo: "Banco", valor: (x: { a: AbonoDocumento }) => x.a.banco ?? "", tipo: "texto", ancho: 22 },
          { titulo: "Monto US$", valor: (x: { a: AbonoDocumento }) => x.a.monto, tipo: "usd", ancho: 14 },
          { titulo: "Monto Bs", valor: (x: { a: AbonoDocumento }) => (x.a.moneda === "VES" ? x.a.monto_moneda ?? null : null), tipo: "bs", ancho: 16 },
        ],
      },
      {
        nombre: "Resumen",
        encabezado,
        autofiltro: false,
        filas: [
          [Number(r.notas_entrega_saldo ?? 0) > 0.004 ? "Saldo por cobrar (facturas, notas de débito y notas de entrega)" : "Saldo por cobrar (facturas y notas de débito)", r.saldo],
          ...(Number(r.notas_entrega_saldo ?? 0) > 0.004 ? [["  de ello, notas de entrega (no fiscales)", Number(r.notas_entrega_saldo)] as [string, number]] : []),
          ["  Por vencer", r.por_vencer],
          ...TRAMOS.filter((t) => t.k !== "por_vencer").map((t) => [`  Vencido ${t.etiqueta.toLowerCase()}`, Number(r[t.k])] as [string, number]),
          ["Vencido (total)", r.vencido],
          ["Notas de crédito a favor", -r.nc_a_favor],
          ["Anticipos sin aplicar", -r.anticipos],
          ["Saldo neto", r.neto],
        ] as [string, number][],
        columnas: [
          { titulo: "Concepto", valor: (f: [string, number]) => f[0], tipo: "texto", ancho: 46 },
          { titulo: "US$", valor: (f: [string, number]) => f[1], tipo: "usd", ancho: 16 },
        ],
      },
    ],
  };
}
