// Fechas de la plataforma en un solo lugar (R0 del plan de reportes, fase 22c). Las fechas de negocio son días de
// Caracas (UTC−4, sin horario de verano) en formato ISO 'AAAA-MM-DD'; así las guarda la base y así viajan en la URL.
// En pantalla y en los Excel/PDF se muestran como dd/mm/aaaa.

const ZONA = "America/Caracas";
const RE_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Hoy en Caracas: '2026-10-08'. */
export const hoyCaracas = (): string => new Date().toLocaleDateString("en-CA", { timeZone: ZONA });

/** Día de Caracas de un instante (timestamp de la base o Date): '2026-10-08'. */
export const diaCaracas = (t: string | Date): string => (typeof t === "string" && RE_ISO.test(t) ? t : new Date(t).toLocaleDateString("en-CA", { timeZone: ZONA }));

/** ¿Es una fecha ISO válida 'AAAA-MM-DD'? */
export const esIso = (s: string | null | undefined): s is string => {
  if (!s || !RE_ISO.test(s)) return false;
  const [a, m, d] = s.split("-").map(Number);
  const x = new Date(Date.UTC(a, m - 1, d));
  return x.getUTCFullYear() === a && x.getUTCMonth() === m - 1 && x.getUTCDate() === d;
};

/** Date (o año, mes 1–12 y día) → 'AAAA-MM-DD' con los componentes locales del Date (sin pasar por UTC). */
export function iso(d: Date): string;
export function iso(anio: number, mes: number, dia: number): string;
export function iso(a: Date | number, m?: number, d?: number): string {
  const [y, mm, dd] = a instanceof Date ? [a.getFullYear(), a.getMonth() + 1, a.getDate()] : [a, m ?? 1, d ?? 1];
  return `${String(y).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

/** 'AAAA-MM-DD' → Date a medianoche local (para date-fns o un calendario). */
export const aDate = (s: string): Date => {
  const [a, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(a, m - 1, d);
};

/** Suma (o resta) días a 'AAAA-MM-DD'. */
export const sumarDias = (s: string, dias: number): string => {
  const d = aDate(s);
  d.setDate(d.getDate() + dias);
  return iso(d);
};

/** Días de a hasta b (b − a), en días de calendario. */
export const diasEntre = (a: string, b: string): number => Math.round((aDate(b).getTime() - aDate(a).getTime()) / 86_400_000);

/** Último día del mes de una fecha. */
export const finDeMes = (s: string): string => {
  const d = aDate(s);
  return iso(new Date(d.getFullYear(), d.getMonth() + 1, 0));
};

/** Primer día del mes de una fecha. */
export const inicioDeMes = (s: string): string => `${s.slice(0, 7)}-01`;

/** 30/09/2026 (o "—"). Acepta 'AAAA-MM-DD' o un timestamp (se toma su día en Caracas). */
export const fechaDMA = (s: string | null | undefined): string => {
  if (!s) return "—";
  const dia = RE_ISO.test(s) ? s : s.length >= 10 && !Number.isNaN(Date.parse(s)) ? diaCaracas(s) : null;
  if (!dia) return "—";
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`;
};

/** '30/09/2026' o '30-09-2026' → '2026-09-30' (null si no es una fecha válida). */
export const desdeDMA = (s: string): string | null => {
  const m = s.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (!m) return null;
  const x = iso(Number(m[3]), Number(m[2]), Number(m[1]));
  return esIso(x) ? x : null;
};

export type ClavePreset = "hoy" | "ayer" | "7d" | "30d" | "90d" | "este_mes" | "mes_anterior" | "este_anio" | "anio_anterior";

export interface Periodo { desde: string; hasta: string }

/** Periodos predefinidos, con la misma regla en toda la plataforma: los de "este …" llegan hasta hoy (no al fin del mes). */
export const PRESETS: { clave: ClavePreset; etiqueta: string }[] = [
  { clave: "hoy", etiqueta: "Hoy" },
  { clave: "ayer", etiqueta: "Ayer" },
  { clave: "7d", etiqueta: "Últimos 7 días" },
  { clave: "30d", etiqueta: "Últimos 30 días" },
  { clave: "90d", etiqueta: "Últimos 90 días" },
  { clave: "este_mes", etiqueta: "Este mes" },
  { clave: "mes_anterior", etiqueta: "Mes anterior" },
  { clave: "este_anio", etiqueta: "Este año" },
  { clave: "anio_anterior", etiqueta: "Año anterior" },
];

/** Desde y hasta de un preset, contados desde `hoy` (por defecto, hoy en Caracas). */
export const periodoPreset = (clave: ClavePreset, hoy: string = hoyCaracas()): Periodo => {
  const anio = Number(hoy.slice(0, 4));
  switch (clave) {
    case "hoy": return { desde: hoy, hasta: hoy };
    case "ayer": { const a = sumarDias(hoy, -1); return { desde: a, hasta: a }; }
    case "7d": return { desde: sumarDias(hoy, -6), hasta: hoy };
    case "30d": return { desde: sumarDias(hoy, -29), hasta: hoy };
    case "90d": return { desde: sumarDias(hoy, -89), hasta: hoy };
    case "este_mes": return { desde: inicioDeMes(hoy), hasta: hoy };
    case "mes_anterior": { const fin = sumarDias(inicioDeMes(hoy), -1); return { desde: inicioDeMes(fin), hasta: fin }; }
    case "este_anio": return { desde: `${anio}-01-01`, hasta: hoy };
    case "anio_anterior": return { desde: `${anio - 1}-01-01`, hasta: `${anio - 1}-12-31` };
  }
};

/** Cortes típicos para un estado de cuenta o una antigüedad: hoy, cierre del mes anterior y de los dos anteriores. */
export const cortesSugeridos = (hoy: string = hoyCaracas()): { fecha: string; etiqueta: string }[] => {
  const fin1 = sumarDias(inicioDeMes(hoy), -1);
  const fin2 = sumarDias(inicioDeMes(fin1), -1);
  const mes = (s: string) => aDate(s).toLocaleDateString("es-VE", { month: "long", year: "numeric" });
  return [
    { fecha: hoy, etiqueta: "Hoy" },
    { fecha: fin1, etiqueta: `Cierre de ${mes(fin1)}` },
    { fecha: fin2, etiqueta: `Cierre de ${mes(fin2)}` },
  ];
};
