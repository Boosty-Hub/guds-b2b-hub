import { diasEntre } from "@/lib/fechas";

// Antigüedad de la deuda (22g · R3 del plan de reportes de finanzas). La base devuelve las partidas abiertas al corte
// (reporte_antiguedad → partidas_cobranza: mismo saldo y "qué falta" que el estado de cuenta) y la página agrupa: por
// empresa, año de emisión, vendedor, tipo de cliente, categoría, cliente, tipo de partida o clasificación, en tramos de días
// contados desde el vencimiento (por defecto, D2) o desde la emisión.

export type TipoPartida = "factura" | "nota_debito" | "nota_credito" | "anticipo" | "nota_entrega";
export type Clasificacion = "activa" | "incobrable";

/** Una partida tal como llega de reporte_antiguedad (claves cortas: el JSON pesa menos). */
export interface PartidaCruda {
  t: TipoPartida;
  /** retencion (falta solo la retención) · impuesto (falta IVA o IGTF) · a_favor (factura con saldo negativo) */
  k?: "retencion" | "impuesto" | "a_favor";
  /** Qué falta, en palabras (el del estado de cuenta) */
  f?: string;
  /** empresa_id */
  e: string;
  id: string;
  n: string;
  /** cliente_id (las notas de entrega pueden no tenerlo) */
  c?: string;
  /** nombre del cliente cuando no hay ficha (notas de entrega) */
  cn?: string;
  /** vendedor del documento */
  v?: string;
  em: string;
  ve: string;
  m: "USD" | "VES";
  tot: number;
  s: number;
  cl: Clasificacion;
  /** de dónde sale la clasificación: documento · cliente · nota */
  co?: "documento" | "cliente" | "nota";
}

export interface ClienteAntiguedad {
  n: string; rif?: string; cod?: string; e: string; v?: string; tipo?: string; cat?: string; canal?: string;
  cl?: Clasificacion; resp?: string; nota?: string; desde?: string;
  /** documentos con una clasificación distinta a la del cliente */
  ex?: number;
  /** último estado de cuenta enviado por correo */
  edc?: string;
}

export interface DatosAntiguedad {
  hoy: string;
  corte: string;
  /** ¿incluye las notas de entrega? (interruptor y permiso del módulo) */
  ne: boolean;
  /** ¿el usuario ve el módulo de notas de entrega? */
  ve_ne: boolean;
  empresas: { id: string; nombre: string }[];
  partidas: PartidaCruda[];
  clientes: Record<string, ClienteAntiguedad>;
}

export type Base = "vencimiento" | "emision";
export type Tramo = "por_vencer" | "t30" | "t60" | "t90" | "t90mas";
export const TRAMOS: Tramo[] = ["por_vencer", "t30", "t60", "t90", "t90mas"];
export const etiquetaTramo = (t: Tramo, base: Base) =>
  ({ por_vencer: "Por vencer", t30: base === "vencimiento" ? "1–30 días" : "0–30 días", t60: "31–60 días", t90: "61–90 días", t90mas: "Más de 90 días" })[t];
/** Tramos que se muestran: con días desde la emisión no hay "por vencer". */
export const tramosDe = (base: Base): Tramo[] => (base === "vencimiento" ? TRAMOS : TRAMOS.slice(1));
export const tramoDe = (dias: number, base: Base): Tramo =>
  base === "vencimiento" && dias <= 0 ? "por_vencer" : dias <= 30 ? "t30" : dias <= 60 ? "t60" : dias <= 90 ? "t90" : "t90mas";

/** Tipo de partida (como las columnas "Type" del Excel de finanzas, más las notas de entrega). */
export type Partida = "cartera" | "retencion" | "impuesto" | "a_favor" | "nc" | "anticipo" | "ne";
export const PARTIDA: Record<Partida, { texto: string; ayuda: string }> = {
  cartera: { texto: "Cartera abierta", ayuda: "Facturas y notas de débito con saldo" },
  retencion: { texto: "Retención por recibir", ayuda: "Solo falta el comprobante de retención (IVA o municipal)" },
  impuesto: { texto: "IVA o IGTF pendiente", ayuda: "Falta el IVA no retenido o el IGTF de los pagos en divisas" },
  a_favor: { texto: "Factura con saldo a favor", ayuda: "Factura o nota de débito pagada de más" },
  nc: { texto: "Notas de crédito a favor", ayuda: "Notas de crédito sin aplicar" },
  anticipo: { texto: "Anticipos sin aplicar", ayuda: "Cobros de Odoo o de GUDS sin aplicar a una factura" },
  ne: { texto: "Notas de entrega (no fiscal)", ayuda: "Deuda interna que no está en Odoo" },
};
export const ORDEN_PARTIDA: Partida[] = ["cartera", "retencion", "impuesto", "a_favor", "nc", "anticipo", "ne"];
export const partidaDe = (p: PartidaCruda): Partida =>
  p.t === "nota_entrega" ? "ne" : p.t === "anticipo" ? "anticipo" : p.t === "nota_credito" ? "nc"
    : p.k === "retencion" ? "retencion" : p.k === "impuesto" ? "impuesto" : p.k === "a_favor" ? "a_favor" : "cartera";

export const TIPO_DOC: Record<TipoPartida, string> = {
  factura: "Factura", nota_debito: "Nota de débito", nota_credito: "Nota de crédito", anticipo: "Anticipo", nota_entrega: "Nota de entrega",
};

/** Partida lista para agrupar y mostrar. */
export interface Fila {
  clave: string;
  p: PartidaCruda;
  empresa: string;
  cliente: string;
  rif: string;
  /** vendedor del documento (o del cliente si el documento no tiene) */
  vendedor: string;
  vendedorCliente: string;
  tipoCliente: string;
  categoria: string;
  canal: string;
  anio: string;
  dias: number;
  tramo: Tramo;
  partida: Partida;
  fiscal: boolean;
  saldo: number;
}

export function filasDe(d: DatosAntiguedad, base: Base): Fila[] {
  const emp = new Map(d.empresas.map((e) => [e.id, e.nombre]));
  return d.partidas.map((p) => {
    const c = p.c ? d.clientes[p.c] : undefined;
    const fecha = base === "vencimiento" ? p.ve || p.em : p.em;
    const dias = diasEntre(fecha, d.corte);
    return {
      clave: `${p.t}:${p.id}`, p,
      empresa: emp.get(p.e) ?? "—",
      cliente: c?.n ?? p.cn ?? "Sin cliente",
      rif: c?.rif ?? "",
      vendedor: p.v || c?.v || "Sin vendedor",
      vendedorCliente: c?.v || "Sin vendedor",
      tipoCliente: c?.tipo || "Sin clasificar",
      categoria: c?.cat || "Sin clasificar",
      canal: c?.canal || "Sin clasificar",
      anio: p.em.slice(0, 4),
      dias, tramo: tramoDe(dias, base), partida: partidaDe(p), fiscal: p.t !== "nota_entrega", saldo: Number(p.s),
    };
  });
}

export type Agrupar = "empresa" | "anio" | "vendedor" | "vendedor_cliente" | "tipo" | "categoria" | "cliente" | "partida" | "clasificacion";
export const AGRUPAR: { clave: Agrupar; texto: string }[] = [
  { clave: "anio", texto: "Año de emisión" },
  { clave: "vendedor", texto: "Vendedor" },
  { clave: "vendedor_cliente", texto: "Vendedor del cliente" },
  { clave: "tipo", texto: "Tipo de cliente" },
  { clave: "categoria", texto: "Categoría de cobranza" },
  { clave: "cliente", texto: "Cliente" },
  { clave: "partida", texto: "Tipo de partida" },
  { clave: "clasificacion", texto: "Activa / incobrable" },
  { clave: "empresa", texto: "Empresa" },
];
export const CLASIFICACION: Record<Clasificacion, string> = { activa: "Deuda activa", incobrable: "Incobrable" };

/** Clave y etiqueta del grupo de una fila. */
export const grupoDe = (f: Fila, por: Agrupar): { clave: string; etiqueta: string; detalle?: string } => {
  switch (por) {
    case "empresa": return { clave: f.p.e, etiqueta: f.empresa };
    case "anio": return { clave: f.anio, etiqueta: f.anio };
    case "vendedor": return { clave: f.vendedor, etiqueta: f.vendedor };
    case "vendedor_cliente": return { clave: f.vendedorCliente, etiqueta: f.vendedorCliente };
    case "tipo": return { clave: f.tipoCliente, etiqueta: f.tipoCliente };
    case "categoria": return { clave: f.categoria, etiqueta: f.categoria };
    case "cliente": return { clave: f.p.c ?? `sin:${f.cliente}`, etiqueta: f.cliente, detalle: f.rif || undefined };
    case "partida": return { clave: f.partida, etiqueta: PARTIDA[f.partida].texto };
    case "clasificacion": return { clave: f.p.cl, etiqueta: CLASIFICACION[f.p.cl] };
  }
};

export interface Grupo {
  clave: string;
  etiqueta: string;
  detalle?: string;
  /** empresa del grupo cuando todas sus partidas son de una sola (para la insignia en «Ambas») */
  empresa?: string;
  columnas: Record<string, number>;
  total: number;
  /** deuda (saldos positivos) y a favor (negativos, en positivo) */
  deuda: number;
  aFavor: number;
  vencido: number;
  partidas: number;
}

/** Agrupa filas × columnas (tramos o años). Ordena por total (o por clave si es el año). */
export function agrupar(filas: Fila[], por: Agrupar, columna: (f: Fila) => string): Grupo[] {
  const m = new Map<string, Grupo & { empresas: Set<string> }>();
  for (const f of filas) {
    const g = grupoDe(f, por);
    let x = m.get(g.clave);
    if (!x) { x = { ...g, columnas: {}, total: 0, deuda: 0, aFavor: 0, vencido: 0, partidas: 0, empresas: new Set() }; m.set(g.clave, x); }
    const col = columna(f);
    x.columnas[col] = (x.columnas[col] ?? 0) + f.saldo;
    x.total += f.saldo;
    if (f.saldo > 0) x.deuda += f.saldo; else x.aFavor -= f.saldo;
    if (f.saldo > 0 && f.dias > 0) x.vencido += f.saldo;
    x.partidas++;
    x.empresas.add(f.empresa);
  }
  const out = [...m.values()].map(({ empresas, ...g }) => ({ ...g, empresa: empresas.size === 1 ? [...empresas][0] : undefined }));
  return por === "anio" ? out.sort((a, b) => a.clave.localeCompare(b.clave))
    : por === "partida" ? out.sort((a, b) => ORDEN_PARTIDA.indexOf(a.clave as Partida) - ORDEN_PARTIDA.indexOf(b.clave as Partida))
    : out.sort((a, b) => b.total - a.total || a.etiqueta.localeCompare(b.etiqueta));
}

export const sumaColumnas = (grupos: Grupo[], columnas: string[]) => {
  const c: Record<string, number> = Object.fromEntries(columnas.map((k) => [k, 0]));
  let total = 0, deuda = 0, aFavor = 0, vencido = 0, partidas = 0;
  for (const g of grupos) {
    for (const k of columnas) c[k] += g.columnas[k] ?? 0;
    total += g.total; deuda += g.deuda; aFavor += g.aFavor; vencido += g.vencido; partidas += g.partidas;
  }
  return { columnas: c, total, deuda, aFavor, vencido, partidas };
};

/** Indicadores de un conjunto de filas. */
export function indicadores(filas: Fila[]) {
  let deuda = 0, nc = 0, anticipos = 0, positivos = 0, vencido = 0, mas90 = 0, incobrable = 0, ne = 0;
  const clientes = new Set<string>();
  for (const f of filas) {
    if (f.p.t === "nota_entrega") ne += f.saldo;
    else if (f.p.t === "anticipo") anticipos -= f.saldo;
    else if (f.saldo < 0) nc -= f.saldo;
    else deuda += f.saldo;
    if (f.saldo > 0) positivos += f.saldo;
    if (f.saldo > 0 && f.dias > 0) vencido += f.saldo;
    if (f.saldo > 0 && f.tramo === "t90mas") mas90 += f.saldo;
    if (f.p.cl === "incobrable") incobrable += f.saldo;
    if (f.saldo > 0.009) clientes.add(f.p.c ?? f.cliente);
  }
  const fiscalNeto = deuda - nc - anticipos;
  return { deuda, nc, anticipos, aFavor: nc + anticipos, fiscalNeto, ne, neto: fiscalNeto + ne, positivos, vencido, mas90, incobrable, clientes: clientes.size };
}

export const pct = (a: number, b: number) => (Math.abs(b) < 0.005 ? null : a / b);
export const fmtPct = (v: number | null) => (v == null ? "—" : `${(v * 100).toLocaleString("es-VE", { maximumFractionDigits: 1, minimumFractionDigits: v !== 0 && Math.abs(v) < 0.1 ? 1 : 0 })} %`);
