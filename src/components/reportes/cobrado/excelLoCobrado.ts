import { nombreArchivoExcel, type ColumnaExcel, type HojaExcel, type LibroExcel } from "@/lib/excel";
import { fechaDMA, hoyCaracas } from "@/lib/fechas";
import { ESTADO_COBRO, FUENTE_COBRO, TEXTO_TASA, etiquetaMes, num, pivotar, totalesPorMes, type CeldaCobro, type Cobro, type FilaMatriz } from "./datos";

// Excel de "Lo cobrado" (22f · R2) con las hojas del libro de finanzas: Detalle · Diario × mes en moneda original y en USD ·
// Moneda × mes · Cliente × mes · Vendedor × mes · No cuentan · Parámetros. Sin el permiso de Cuentas no van el detalle ni la
// hoja por cliente (traen clientes); "No cuentan" va resumida.

export interface DatosLoCobrado {
  desde: string; hasta: string; meses: string[];
  /** "GUDS", "Quirutec" o "GUDS y Quirutec" */
  empresas: string;
  ambas: boolean;
  diario: CeldaCobro[]; moneda: CeldaCobro[]; vendedor: CeldaCobro[]; estado: CeldaCobro[];
  cliente: CeldaCobro[] | null;
  detalle: Cobro[] | null;
}

const encabezado = (d: DatosLoCobrado, titulo: string) => [
  titulo, `Empresas: ${d.empresas}`, `Cobros del ${fechaDMA(d.desde)} al ${fechaDMA(d.hasta)} · USD a la tasa BCV del día de cada cobro`,
];

/** Columnas de una matriz fila × mes (valor y total en el tipo indicado). */
function columnasMes(meses: string[], tipo: "usd" | "numero", conTotal = true): ColumnaExcel<FilaMatriz>[] {
  return [
    ...meses.map((m): ColumnaExcel<FilaMatriz> => ({ titulo: etiquetaMes(m), valor: (f) => (f.meses[m] ? Math.round(f.meses[m] * 100) / 100 : null), tipo, ancho: 14, total: conTotal })),
    { titulo: "Total", valor: (f) => Math.round(f.total * 100) / 100, tipo, ancho: 16, total: conTotal },
  ];
}

export function libroLoCobrado(d: DatosLoCobrado): LibroExcel {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hojas: HojaExcel<any>[] = [];
  // Cada hoja con su tipo de fila (la inferencia de las columnas sale de `filas`)
  const agregar = <T,>(h: HojaExcel<T>) => { hojas.push(h); };
  const colEmpresa = <T extends { empresa: string | null }>(): ColumnaExcel<T>[] => (d.ambas ? [{ titulo: "Empresa", valor: (f) => f.empresa ?? "", ancho: 11 }] : []);
  const vigentes = d.detalle?.filter((c) => c.estado === "vigente") ?? null;
  const noCuentan = d.detalle?.filter((c) => c.estado !== "vigente") ?? null;

  // 1. Detalle (como la hoja "Cobranza 2026" de finanzas)
  if (vigentes) {
    agregar({
      nombre: "Detalle", encabezado: encabezado(d, "Lo cobrado · detalle"), totales: "Totales",
      columnas: [
        ...colEmpresa<Cobro>(),
        { titulo: "Fecha del cobro", valor: (c) => c.fecha, tipo: "fecha" },
        { titulo: "Número", valor: (c) => c.numero },
        { titulo: "RIF", valor: (c) => c.rif ?? "" },
        { titulo: "Cliente", valor: (c) => c.cliente ?? "", ancho: 40 },
        { titulo: "Vendedor del cliente", valor: (c) => c.vendedor, ancho: 24 },
        { titulo: "Cobrador (Profit)", valor: (c) => c.cobrador ?? "", ancho: 20 },
        { titulo: "Forma de pago", valor: (c) => c.forma },
        { titulo: "Referencia", valor: (c) => c.referencia ?? "" },
        { titulo: "Diario o cuenta", valor: (c) => c.diario, ancho: 26 },
        { titulo: "Moneda", valor: (c) => (c.moneda === "BS" ? "Bs" : "USD"), ancho: 8 },
        { titulo: "Monto original", valor: (c) => num(c.monto), tipo: "numero", total: false },
        { titulo: "Tasa BCV", valor: (c) => (c.tasa == null ? null : num(c.tasa)), tipo: "tasa", total: false },
        { titulo: "Origen de la tasa", valor: (c) => (c.tasa_origen ? TEXTO_TASA[c.tasa_origen] : ""), ancho: 24 },
        { titulo: "Total USD", valor: (c) => num(c.usd), tipo: "usd" },
        { titulo: "USD según el origen", valor: (c) => (c.usd_origen == null ? null : num(c.usd_origen)), tipo: "usd" },
        { titulo: "Fuente", valor: (c) => (c.fuente === "profit" ? "Profit (Excel de finanzas)" : FUENTE_COBRO[c.fuente]) },
      ],
      filas: vigentes,
      notas: [
        "Total USD = monto ÷ tasa BCV del día del cobro (los cobros en dólares van por su monto).",
        "\"USD según el origen\": el que trae Odoo o el Excel de finanzas (que usa una tasa por semana); se deja para cuadrar.",
      ],
    });
  }

  // 2 y 3. Diario × mes, en moneda original y en USD
  const enMoneda = pivotar(d.diario, "moneda");
  const subtotales = (["BS", "USD"] as const).flatMap((m): FilaMatriz[] => {
    const filas = enMoneda.filter((f) => f.moneda === m);
    if (!filas.length) return [];
    const t = totalesPorMes(filas, d.meses);
    return [{ clave: `total-${m}`, etiqueta: m === "BS" ? "Total en bolívares" : "Total en dólares", detalle: null, empresa: null, moneda: m, meses: t.meses, total: t.total, cobros: t.cobros, usd: 0 }];
  });
  agregar({
    nombre: "Diario x mes (moneda)", encabezado: encabezado(d, "Lo cobrado · por diario y mes, en la moneda del cobro"),
    columnas: [
      ...colEmpresa<FilaMatriz>(),
      { titulo: "Diario o cuenta", valor: (f) => f.etiqueta, ancho: 30 },
      { titulo: "Moneda", valor: (f) => (f.moneda === "BS" ? "Bs" : "USD"), ancho: 8 },
      ...columnasMes(d.meses, "numero", false),
    ],
    filas: [...enMoneda, ...subtotales],
    notas: ["Cada fila está en su moneda (Bs o USD): por eso los totales van por moneda."],
  });
  agregar({
    nombre: "Diario x mes (USD)", encabezado: encabezado(d, "Lo cobrado · por diario y mes, en USD"), totales: "Total",
    columnas: [
      ...colEmpresa<FilaMatriz>(),
      { titulo: "Diario o cuenta", valor: (f) => f.etiqueta, ancho: 30 },
      { titulo: "Moneda del diario", valor: (f) => (f.detalle === "BS" ? "Bs" : f.detalle === "USD" ? "USD" : ""), ancho: 10 },
      ...columnasMes(d.meses, "usd"),
    ],
    filas: pivotar(d.diario, "usd"),
  });

  // 4. Moneda × mes
  const porMonedaOriginal = pivotar(d.moneda, "moneda");
  const porMonedaUsd = pivotar(d.moneda, "usd");
  const bs = porMonedaOriginal.find((f) => f.moneda === "BS");
  const bsUsd = porMonedaUsd.find((f) => f.clave === "BS");
  const usd = porMonedaUsd.find((f) => f.clave === "USD");
  const totalUsd = totalesPorMes(porMonedaUsd, d.meses);
  const filaMoneda = (etiqueta: string, moneda: string, f?: FilaMatriz | { meses: Record<string, number>; total: number }) =>
    ({ clave: etiqueta, etiqueta, detalle: moneda, empresa: null, moneda: null, meses: f?.meses ?? {}, total: f?.total ?? 0, cobros: 0, usd: 0 }) as FilaMatriz;
  agregar({
    nombre: "Moneda x mes", encabezado: encabezado(d, "Lo cobrado · por moneda y mes"),
    columnas: [
      { titulo: "Moneda", valor: (f) => f.etiqueta, ancho: 34 },
      { titulo: "Expresado en", valor: (f) => f.detalle ?? "", ancho: 12 },
      ...columnasMes(d.meses, "numero", false),
    ],
    filas: [
      filaMoneda("Bolívares", "Bs", bs), filaMoneda("Bolívares en USD (BCV del día)", "USD", bsUsd),
      filaMoneda("Dólares", "USD", usd), filaMoneda("Total cobrado", "USD", totalUsd),
    ],
  });

  // 5. Cliente × mes (exige Cuentas)
  if (d.cliente) {
    agregar({
      nombre: "Cliente x mes (USD)", encabezado: encabezado(d, "Lo cobrado · por cliente y mes, en USD"), totales: "Total",
      columnas: [
        ...colEmpresa<FilaMatriz>(),
        { titulo: "RIF", valor: (f) => f.detalle ?? "" },
        { titulo: "Cliente", valor: (f) => f.etiqueta, ancho: 40 },
        { titulo: "Cobros", valor: (f) => f.cobros, tipo: "entero" },
        ...columnasMes(d.meses, "usd"),
      ],
      filas: pivotar(d.cliente, "usd"),
    });
  }

  // 6. Vendedor × mes
  agregar({
    nombre: "Vendedor x mes (USD)", encabezado: encabezado(d, "Lo cobrado · por vendedor del cliente y mes, en USD"), totales: "Total",
    columnas: [
      { titulo: "Vendedor del cliente", valor: (f) => f.etiqueta, ancho: 30 },
      { titulo: "Cobros", valor: (f) => f.cobros, tipo: "entero" },
      ...columnasMes(d.meses, "usd"),
    ],
    filas: pivotar(d.vendedor, "usd"),
  });

  // 7. No cuentan (detalle con Cuentas; si no, resumen)
  if (noCuentan) {
    agregar({
      nombre: "No cuentan", encabezado: encabezado(d, "Cobros que no suman en lo cobrado, y por qué"), totales: "Totales",
      columnas: [
        ...colEmpresa<Cobro>(),
        { titulo: "Fecha del cobro", valor: (c) => c.fecha, tipo: "fecha" },
        { titulo: "Número", valor: (c) => c.numero },
        { titulo: "Cliente", valor: (c) => c.cliente ?? "", ancho: 36 },
        { titulo: "Diario o cuenta", valor: (c) => c.diario, ancho: 26 },
        { titulo: "Moneda", valor: (c) => (c.moneda === "BS" ? "Bs" : "USD"), ancho: 8 },
        { titulo: "Monto original", valor: (c) => num(c.monto), tipo: "numero", total: false },
        { titulo: "USD", valor: (c) => num(c.usd), tipo: "usd" },
        { titulo: "Estado", valor: (c) => ESTADO_COBRO[c.estado] ?? c.estado, ancho: 26 },
        { titulo: "Por qué no cuenta", valor: (c) => c.motivo ?? "", ancho: 60, ajustar: true },
      ],
      filas: noCuentan,
    });
  } else {
    const resumen = pivotar(d.estado.filter((c) => c.fila !== "vigente"), "usd");
    agregar({
      nombre: "No cuentan", encabezado: encabezado(d, "Cobros que no suman en lo cobrado, y por qué"), totales: "Totales",
      columnas: [
        { titulo: "Estado", valor: (f) => ESTADO_COBRO[f.clave as keyof typeof ESTADO_COBRO] ?? f.etiqueta, ancho: 30 },
        { titulo: "Por qué no cuenta", valor: (f) => f.detalle ?? "", ancho: 70, ajustar: true },
        { titulo: "Cobros", valor: (f) => f.cobros, tipo: "entero" },
        { titulo: "USD", valor: (f) => f.total, tipo: "usd" },
      ],
      filas: resumen,
    });
  }

  // 8. Parámetros
  const p = (clave: string, valor: string) => ({ clave, valor });
  agregar({
    nombre: "Parámetros", encabezado: ["Lo cobrado · cómo se calcula"], autofiltro: false,
    columnas: [{ titulo: "Parámetro", valor: (f: { clave: string; valor: string }) => f.clave, ancho: 28 }, { titulo: "Valor", valor: (f) => f.valor, ancho: 110, ajustar: true }],
    filas: [
      p("Período", `Del ${fechaDMA(d.desde)} al ${fechaDMA(d.hasta)} (fecha del cobro)`),
      p("Empresas", d.empresas),
      p("Generado", fechaDMA(hoyCaracas())),
      p("Fuente de los cobros", "Desde el arranque de Odoo (1-may-2026), los cobros de Odoo. Antes, los recibos de Profit cargados del Excel de finanzas (\"FORMATO DE LO COBRADO\")."),
      p("Conversión a USD", "Monto ÷ tasa BCV del día del cobro (decisión D1). Si ese día no hay tasa de Odoo se usa la de Profit (columna \"Origen de la tasa\"). Los cobros en dólares van por su monto."),
      p("Qué no cuenta", "Cobros anulados o en borrador en Odoo, reportados en GUDS sin verificar, el IGTF (impuesto aparte) y los anticipos de saldo inicial migrados a Odoo con fecha anterior al arranque (es el mismo dinero de los recibos de Profit). Van en la hoja \"No cuentan\"."),
      p("Vendedor", "El vendedor asignado al cliente (Odoo no registra cobrador). En los recibos de Profit va también el cobrador de Profit."),
      p("Diferencias con el Excel de finanzas", "El Excel usa una tasa por semana (la BCV del último día hábil) y GUDS la del día; el Excel incluía cobros anulados en Odoo; los anticipos de saldo inicial de mayo en adelante el Excel los pone en el banco y GUDS en el diario de Odoo donde están."),
    ],
  });

  return { archivo: nombreArchivoExcel("lo cobrado", d.empresas, d.desde, d.hasta), hojas };
}
