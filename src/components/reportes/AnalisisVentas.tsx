import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Download, Filter, Loader2, Plus, SlidersHorizontal, X } from "lucide-react";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { Panel } from "@/components/datos/FichaCampos";
import { exportarCSV } from "@/components/datos/tabla";
import { InsigniaProfit } from "@/components/reportes/comun";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { useToast } from "@/hooks/use-toast";

// ── Motor reporte_ventas_cubo (migración 20j): agrupa por hasta 4 niveles con subtotales y, opcionalmente, una columna ──
export type FuenteCubo = "ambas" | "odoo" | "profit";
type Dim = "empresa" | "anio" | "mes" | "anio_mes" | "vendedor" | "cliente" | "tipo_cliente" | "canal" | "segmento"
  | "categoria" | "linea" | "sublinea" | "marca" | "producto";
type Columna = "" | "anio" | "mes" | "anio_mes" | "empresa";
type Medida = "venta" | "unidades" | "precio" | "margen_pct" | "margen_usd" | "costo" | "documentos" | "clientes" | "nc" | "financieras" | "participacion";

interface FilaCubo {
  nivel: number; k1: string | null; k2: string | null; k3: string | null; k4: string | null; col: string | null;
  /** Nombre y detalle (RIF, código) de la fila en su propio nivel; ecol = nombre de la columna en la matriz */
  etiqueta: string | null; detalle: string | null; ecol: string | null;
  venta_usd: number | null; nc_usd: number | null; unidades: number | null; documentos: number | null; clientes: number | null;
  precio_promedio: number | null; financieras_usd: number | null; profit_usd: number | null;
  costo_usd: number | null; venta_con_costo_usd: number | null; margen_usd: number | null; margen_pct: number | null; cobertura_costo_pct: number | null;
  fuente: "odoo" | "profit" | "ambas"; ve_costo: boolean;
}
interface Nodo { id: string; nivel: number; clave: string; etiqueta: string; detalle: string | null; fila: FilaCubo; celdas: Map<string, FilaCubo>; hijos: Nodo[] }
interface ValorFiltro { k: string; e: string }
type Filtros = Partial<Record<Dim, ValorFiltro[]>>;

const DIMS: Record<Dim, { titulo: string; tiempo?: boolean; profit?: boolean; detalle?: string }> = {
  categoria: { titulo: "Categoría" },
  linea: { titulo: "Línea" },
  sublinea: { titulo: "Sub-línea" },
  producto: { titulo: "Artículo", detalle: "Código" },
  marca: { titulo: "Marca", profit: true },
  vendedor: { titulo: "Vendedor" },
  cliente: { titulo: "Cliente", detalle: "RIF" },
  tipo_cliente: { titulo: "Tipo de cliente", profit: true },
  canal: { titulo: "Canal", profit: true },
  segmento: { titulo: "Segmento", profit: true },
  empresa: { titulo: "Empresa" },
  anio: { titulo: "Año", tiempo: true },
  mes: { titulo: "Mes", tiempo: true },
  anio_mes: { titulo: "Año-mes", tiempo: true },
};
const LISTA_DIMS = Object.keys(DIMS) as Dim[];
const COLUMNAS: [Columna, string][] = [["", "Sin columnas"], ["mes", "Mes"], ["anio", "Año"], ["anio_mes", "Año-mes"], ["empresa", "Empresa"]];

const MEDIDAS: Record<Medida, { titulo: string; costo?: boolean; conteo?: boolean; ayuda?: string }> = {
  venta: { titulo: "Venta neta", ayuda: "Facturas − notas de crédito y devoluciones, en USD sin IVA" },
  unidades: { titulo: "Unidades" },
  precio: { titulo: "Precio prom.", ayuda: "Precio promedio ponderado: venta neta ÷ unidades" },
  margen_pct: { titulo: "Margen %", costo: true, ayuda: "(Venta con costo − costo) ÷ venta con costo. * = parte de la venta sin costo" },
  margen_usd: { titulo: "Utilidad bruta", costo: true, ayuda: "Venta con costo − costo" },
  costo: { titulo: "Costo", costo: true, ayuda: "Odoo: costo promedio actual · Profit: último costo del Excel" },
  documentos: { titulo: "Facturas", conteo: true },
  clientes: { titulo: "Clientes", conteo: true, ayuda: "Clientes con factura" },
  nc: { titulo: "NC y devol.", ayuda: "Notas de crédito de Odoo y devoluciones de Profit (ya restadas en la venta)" },
  financieras: { titulo: "NC financieras", ayuda: "Notas financieras de Profit (descuentos, ajustes): aparte, no restan en la venta neta" },
  participacion: { titulo: "% del total" },
};
const LISTA_MEDIDAS = Object.keys(MEDIDAS) as Medida[];

interface Preset { titulo: string; niveles: Dim[]; columna: Columna; medidas: Medida[]; matriz?: Medida; top?: number }
const PRESETS: Record<string, Preset> = {
  productos: { titulo: "Categoría › Línea › Sub-línea › Artículo", niveles: ["categoria", "linea", "sublinea", "producto"], columna: "", medidas: ["venta", "unidades", "margen_pct", "precio"] },
  vendedor_cliente: { titulo: "Vendedor › Cliente", niveles: ["vendedor", "cliente"], columna: "", medidas: ["venta", "margen_pct", "precio", "participacion"] },
  cliente_articulo: { titulo: "Cliente › Categoría › Artículo", niveles: ["cliente", "categoria", "producto"], columna: "", medidas: ["venta", "unidades", "margen_pct", "precio"] },
  anio_mes: { titulo: "Matriz Año × Mes", niveles: ["anio"], columna: "mes", medidas: ["venta"], matriz: "venta" },
  evolucion: { titulo: "Evolución mensual: Categoría › Línea › Artículo", niveles: ["categoria", "linea", "producto"], columna: "anio_mes", medidas: ["venta"], matriz: "venta" },
  top_productos: { titulo: "Top productos con margen", niveles: ["producto"], columna: "", medidas: ["venta", "unidades", "precio", "costo", "margen_usd", "margen_pct"], top: 50 },
  top_clientes: { titulo: "Top clientes con margen", niveles: ["cliente"], columna: "", medidas: ["venta", "margen_usd", "margen_pct", "documentos", "participacion"], top: 50 },
};

// Última configuración (por navegador). Puede no haber almacenamiento: todo va en try/catch.
const CLAVE_LS = "guds.reportes.analisis.v1";
interface Config { preset: string; niveles: Dim[]; columna: Columna; medidas: Medida[]; matriz: Medida; filtros: Filtros; orden: Medida }
const CONFIG_INICIAL: Config = { preset: "productos", ...PRESETS.productos, matriz: "venta", filtros: {}, orden: "venta" };
function leerConfig(): Config {
  try {
    const c = JSON.parse(localStorage.getItem(CLAVE_LS) || "null");
    if (!c || !Array.isArray(c.niveles) || !c.niveles.length || c.niveles.length > 4 || !c.niveles.every((d: string) => d in DIMS)) return CONFIG_INICIAL;
    const filtros: Filtros = {};
    for (const [d, v] of Object.entries(c.filtros || {})) {
      if (d in DIMS && Array.isArray(v)) filtros[d as Dim] = (v as ValorFiltro[]).filter((x) => x && typeof x.k === "string").slice(0, 200);
    }
    return {
      preset: typeof c.preset === "string" && (c.preset in PRESETS || c.preset === "personalizado") ? c.preset : "personalizado",
      niveles: c.niveles,
      columna: COLUMNAS.some(([k]) => k === c.columna) && !c.niveles.includes(c.columna) ? c.columna : "",
      medidas: Array.isArray(c.medidas) ? c.medidas.filter((m: string) => m in MEDIDAS) : CONFIG_INICIAL.medidas,
      matriz: c.matriz in MEDIDAS ? c.matriz : "venta",
      filtros,
      orden: c.orden in MEDIDAS ? c.orden : "venta",
    };
  } catch {
    return CONFIG_INICIAL;
  }
}
function guardarConfig(c: Config) {
  try { localStorage.setItem(CLAVE_LS, JSON.stringify(c)); } catch { /* sin almacenamiento: no pasa nada */ }
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const fmtN = (v: number | null, dec = 0) => (v === null ? "—" : v.toLocaleString("es-VE", { minimumFractionDigits: dec, maximumFractionDigits: dec }));
const fmtPct = (v: number | null) => (v === null ? "—" : `${v.toLocaleString("es-VE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`);
const r2 = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);
const claveFila = (f: FilaCubo) => [f.k1, f.k2, f.k3, f.k4].slice(0, f.nivel);
const idDe = (ks: (string | null)[]) => ks.join("\u0001");
const EN_BLANCO = new Set<string>();

// reporte_ventas_cubo_json devuelve las filas como arreglos (respuesta compacta) + si quien consulta ve el costo
interface RespuestaCubo { columnas: string[]; filas: unknown[][]; ve_costo: boolean }
async function consultarCubo(args: Record<string, unknown>) {
  const pedir = () => supabase.rpc("reporte_ventas_cubo_json", args);
  let r = await pedir();
  // Un reintento si la base corta por tiempo (la sincronización con Odoo la carga cada 15 minutos)
  if (r.error && (r.error.code === "57014" || /timeout/i.test(r.error.message))) r = await pedir();
  if (r.error) throw r.error;
  const d = r.data as RespuestaCubo;
  const filas = (d?.filas ?? []).map((a) => {
    const o: Record<string, unknown> = { ve_costo: !!d.ve_costo };
    d.columnas.forEach((c, i) => { o[c] = a[i]; });
    return o as unknown as FilaCubo;
  });
  return { filas, veCosto: !!d?.ve_costo };
}

/** Arma el árbol (y las celdas de la matriz) a partir de las filas del cubo */
function construirArbol(filas: FilaCubo[]) {
  const nodos = new Map<string, Nodo>();
  const raiz: Nodo[] = [];
  let total: Nodo | null = null;
  const columnas = new Map<string, string>();
  const ordenadas = [...filas].sort((a, b) => a.nivel - b.nivel || (a.col === null ? -1 : 1) - (b.col === null ? -1 : 1));
  for (const f of ordenadas) {
    const ks = claveFila(f);
    const id = idDe(ks);
    if (f.col !== null) {
      columnas.set(f.col, f.ecol ?? f.col);
      const n = f.nivel === 0 ? total : nodos.get(id);
      n?.celdas.set(f.col, f);
      continue;
    }
    const nodo: Nodo = {
      id, nivel: f.nivel, clave: ks[ks.length - 1] ?? "",
      etiqueta: (f.nivel ? f.etiqueta : "Total general") ?? "—",
      detalle: f.nivel ? f.detalle : null,
      fila: f, celdas: new Map(), hijos: [],
    };
    if (f.nivel === 0) { total = nodo; continue; }
    nodos.set(id, nodo);
    if (f.nivel === 1) raiz.push(nodo);
    else nodos.get(idDe(ks.slice(0, -1)))?.hijos.push(nodo);
  }
  const cols = [...columnas.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, e]) => ({ k, e }));
  return { raiz, total, columnas: cols, cantidad: nodos.size };
}

export function AnalisisVentas({ desde, hasta, fuente, onCargando }: { desde: string; hasta: string; fuente: FuenteCubo; onCargando?: (v: boolean) => void }) {
  const { formatPrice } = useCurrency();
  const { soloLectura, seleccion } = useEmpresa();
  const { toast } = useToast();
  const [config, setConfig] = useState<Config>(leerConfig);
  const [filas, setFilas] = useState<FilaCubo[]>([]);
  const [veCosto, setVeCosto] = useState(true);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [abiertos, setAbiertos] = useState<Set<string>>(EN_BLANCO);
  const [verTodos, setVerTodos] = useState(false);
  const [exportando, setExportando] = useState<string | null>(null);
  const { niveles, columna, filtros } = config;
  const matriz = !!columna;

  useEffect(() => { guardarConfig(config); }, [config]);
  const cambiar = (c: Partial<Config>, personalizado = true) => setConfig((x) => ({ ...x, ...c, ...(personalizado ? { preset: "personalizado" } : {}) }));
  const aplicarPreset = (p: string) => {
    const pr = PRESETS[p];
    if (!pr) return;
    setConfig((x) => ({ ...x, preset: p, niveles: pr.niveles, columna: pr.columna, medidas: pr.medidas, matriz: pr.matriz ?? x.matriz, orden: "venta" }));
    setAbiertos(EN_BLANCO); setVerTodos(false);
  };
  const top = PRESETS[config.preset]?.top ?? 100;

  const medidas = (matriz ? [config.matriz] : config.medidas).filter((m) => veCosto || !MEDIDAS[m].costo);
  const conteos = medidas.some((m) => MEDIDAS[m].conteo);
  const filtrosRpc = useMemo(() => Object.fromEntries(Object.entries(filtros).filter(([, v]) => v && v.length).map(([d, v]) => [d, v!.map((x) => x.k)])), [filtros]);
  const claveConsulta = JSON.stringify([desde, hasta, fuente, niveles, columna, filtrosRpc, conteos, soloLectura, seleccion]);

  // Consulta
  useEffect(() => {
    let cancelado = false;
    (async () => {
      setCargando(true); onCargando?.(true); setError(null);
      try {
        const r = await consultarCubo({ p_desde: desde, p_hasta: hasta, p_niveles: niveles, p_fuente: fuente, p_filtros: filtrosRpc, p_columna: columna || null, p_conteos: conteos });
        if (cancelado) return;
        setFilas(r.filas); setVeCosto(r.veCosto);
      } catch (e) {
        if (cancelado) return;
        setFilas([]); setError((e as Error).message);
        toast({ title: "No se pudo calcular el análisis", description: (e as Error).message, variant: "destructive" });
      }
      setCargando(false); onCargando?.(false);
    })();
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveConsulta]);

  const { raiz, total, columnas, cantidad } = useMemo(() => construirArbol(filas), [filas]);

  // Orden de cada nivel: tiempo por clave; el resto por la medida elegida (o el total de la fila en la matriz), de mayor a menor
  const valor = (f: FilaCubo | undefined, m: Medida): number | null => {
    if (!f) return null;
    switch (m) {
      case "venta": return num(f.venta_usd);
      case "unidades": return num(f.unidades);
      case "precio": return num(f.precio_promedio);
      case "margen_pct": return num(f.venta_con_costo_usd) && num(f.venta_con_costo_usd)! > 0 ? num(f.margen_pct) : null;
      case "margen_usd": return num(f.margen_usd);
      case "costo": return num(f.costo_usd);
      case "documentos": return num(f.documentos);
      case "clientes": return num(f.clientes);
      case "nc": return num(f.nc_usd);
      case "financieras": return num(f.financieras_usd);
      case "participacion": { const t = num(total?.fila.venta_usd); return t ? (num(f.venta_usd) ?? 0) / t * 100 : null; }
    }
  };
  const ordenar = (lista: Nodo[], nivel: number) => {
    const dim = niveles[nivel - 1];
    if (DIMS[dim]?.tiempo) return [...lista].sort((a, b) => a.clave.localeCompare(b.clave));
    const m = matriz ? config.matriz : config.orden;
    return [...lista].sort((a, b) => (valor(b.fila, m) ?? -Infinity) - (valor(a.fila, m) ?? -Infinity));
  };

  // Filas visibles (los niveles abiertos) y "ver todos" en el primer nivel
  const raizOrdenada = useMemo(() => ordenar(raiz, 1), // eslint-disable-next-line react-hooks/exhaustive-deps
    [raiz, config.orden, config.matriz, matriz]);
  const visibles = useMemo(() => {
    const out: Nodo[] = [];
    const recorrer = (lista: Nodo[], nivel: number) => {
      for (const n of ordenar(lista, nivel)) {
        out.push(n);
        if (abiertos.has(n.id) && n.hijos.length) recorrer(n.hijos, nivel + 1);
      }
    };
    for (const n of verTodos ? raizOrdenada : raizOrdenada.slice(0, top)) {
      out.push(n);
      if (abiertos.has(n.id) && n.hijos.length) recorrer(n.hijos, 2);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raizOrdenada, abiertos, verTodos, top, config.orden, config.matriz]);

  const alternar = (id: string) => setAbiertos((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const expandirTodo = () => {
    // Abre nivel por nivel mientras la tabla no pase de ~3.000 filas
    const abrir = new Set<string>();
    let frontera = verTodos ? raiz : raizOrdenada.slice(0, top);
    let filasVisibles = frontera.length;
    for (let nivel = 1; nivel < niveles.length; nivel++) {
      const hijos = frontera.flatMap((n) => n.hijos);
      if (!hijos.length) break;
      if (filasVisibles + hijos.length > 3000) {
        toast({ title: `Se abrió hasta el nivel ${nivel}`, description: "Abrir el siguiente nivel mostraría más de 3.000 filas: filtra o abre las filas que necesites." });
        break;
      }
      frontera.forEach((n) => n.hijos.length && abrir.add(n.id));
      filasVisibles += hijos.length;
      frontera = hijos;
    }
    setAbiertos(abrir);
  };

  // ── Celdas ──
  const dinero = new Set<Medida>(["venta", "margen_usd", "costo", "nc", "financieras", "precio"]);
  const celda = (f: FilaCubo | undefined, m: Medida): ReactNode => {
    if (!f) return <span className="text-muted-foreground/60">—</span>;
    if (m === "margen_pct") {
      const vcc = num(f.venta_con_costo_usd);
      if (!vcc || vcc <= 0 || f.margen_pct === null) return <span className="text-[11px] text-muted-foreground">sin costo</span>;
      const cob = num(f.cobertura_costo_pct);
      const parcial = cob !== null && cob < 99.5;
      return (
        <span className={cn(num(f.margen_pct)! < 0 && "text-destructive")} title={parcial ? `Margen sobre el ${fmtN(cob, 1)} % de la venta (el resto no tiene costo)` : undefined}>
          {fmtPct(num(f.margen_pct))}{parcial && <sup className="ml-0.5 text-muted-foreground">*</sup>}
        </span>
      );
    }
    const v = valor(f, m);
    if (v === null) return <span className="text-muted-foreground/60">—</span>;
    if (m === "participacion") return fmtPct(v);
    if (dinero.has(m)) return <span className={cn(v < 0 && "text-destructive")}>{formatPrice(v)}</span>;
    return fmtN(v);
  };

  // ── KPIs del total ──
  const t = total?.fila;
  const conProfit = !!t && t.fuente !== "odoo" && Math.abs(num(t.profit_usd) ?? 0) > 0.004;
  const insigniaPorFila = !!t && t.fuente === "ambas";
  const kpis = t ? [
    { label: "Venta neta", valor: formatPrice(num(t.venta_usd) ?? 0), detalle: conProfit ? <span className="inline-flex items-center gap-1"><InsigniaProfit />{formatPrice(num(t.profit_usd) ?? 0)} de Profit</span> : undefined, titulo: MEDIDAS.venta.ayuda },
    { label: "Unidades", valor: fmtN(num(t.unidades)) },
    { label: "Precio prom.", valor: t.precio_promedio === null ? "—" : formatPrice(num(t.precio_promedio)!), titulo: MEDIDAS.precio.ayuda },
    ...(veCosto ? [{
      label: "Margen", valor: num(t.venta_con_costo_usd) ? fmtPct(num(t.margen_pct)) : "sin costo",
      detalle: num(t.venta_con_costo_usd) ? `${formatPrice(num(t.margen_usd) ?? 0)} · ${fmtN(num(t.cobertura_costo_pct), 1)} % con costo` : undefined,
      tono: (num(t.margen_pct) ?? 0) < 0 ? "negativo" as const : "normal" as const, titulo: MEDIDAS.margen_pct.ayuda,
    }] : []),
    ...(conteos ? [{ label: "Facturas · clientes", valor: `${fmtN(num(t.documentos))} · ${fmtN(num(t.clientes))}` }] : []),
    ...(Math.abs(num(t.financieras_usd) ?? 0) > 0.004 ? [{ label: "NC financieras", valor: formatPrice(num(t.financieras_usd)!), detalle: "aparte de la venta", tono: "tenue" as const, titulo: MEDIDAS.financieras.ayuda }] : []),
  ] : [];

  // ── Exportación ──
  const recorrerTodo = (fn: (n: Nodo, ruta: Nodo[]) => void) => {
    const ir = (lista: Nodo[], nivel: number, ruta: Nodo[]) => {
      for (const n of ordenar(lista, nivel)) { fn(n, [...ruta, n]); ir(n.hijos, nivel + 1, [...ruta, n]); }
    };
    ir(raizOrdenada, 1, []);
  };
  const valorCsv = (f: FilaCubo | undefined, m: Medida) => {
    const v = valor(f, m);
    if (v === null) return null;
    return m === "precio" ? Math.round(v * 10000) / 10000 : r2(v);
  };
  const exportarAnalisis = () => {
    const filasCsv: { nivel: number; ruta: Nodo[]; nodo: Nodo }[] = [];
    recorrerTodo((n, ruta) => filasCsv.push({ nivel: n.nivel, ruta, nodo: n }));
    if (total) filasCsv.push({ nivel: 0, ruta: [], nodo: total });
    const cols: { titulo: string; valor: (x: (typeof filasCsv)[number]) => string | number | null }[] = [
      { titulo: "Nivel", valor: (x) => x.nivel },
      ...niveles.flatMap((d, i) => [
        { titulo: DIMS[d].titulo, valor: (x: (typeof filasCsv)[number]) => (x.nivel === 0 ? (i === 0 ? "Total general" : null) : x.ruta[i]?.etiqueta ?? null) },
        ...(DIMS[d].detalle ? [{ titulo: `${DIMS[d].titulo} · ${DIMS[d].detalle}`, valor: (x: (typeof filasCsv)[number]) => x.ruta[i]?.detalle ?? null }] : []),
      ]),
      ...(matriz
        ? [...columnas.map((c) => ({ titulo: `${c.e} · ${MEDIDAS[config.matriz].titulo}`, valor: (x: (typeof filasCsv)[number]) => valorCsv(x.nodo.celdas.get(c.k), config.matriz) })),
          { titulo: `Total · ${MEDIDAS[config.matriz].titulo}`, valor: (x: (typeof filasCsv)[number]) => valorCsv(x.nodo.fila, config.matriz) }]
        : medidas.map((m) => ({ titulo: MEDIDAS[m].titulo + (m === "venta" || dinero.has(m) ? " (USD)" : ""), valor: (x: (typeof filasCsv)[number]) => valorCsv(x.nodo.fila, m) }))),
      ...(!matriz && veCosto && medidas.includes("margen_pct") ? [{ titulo: "% de la venta con costo", valor: (x: (typeof filasCsv)[number]) => num(x.nodo.fila.cobertura_costo_pct) }] : []),
      { titulo: "Incluye Profit", valor: (x) => (x.nodo.fila.fuente === "odoo" ? "No" : "Sí") },
    ];
    exportarCSV(`analisis-${niveles.join("-")}${columna ? `-x-${columna}` : ""}_${desde}_${hasta}`, filasCsv, cols);
  };

  // Detalle de líneas con las columnas de la hoja "Base datos" del Excel, por tramos de 3 meses
  const exportarLineas = async () => {
    const tramos: [string, string][] = [];
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    let d = new Date(`${desde}T00:00:00`);
    const fin = new Date(`${hasta}T00:00:00`);
    while (d <= fin) {
      const f = new Date(d.getFullYear(), d.getMonth() + 3, 0);
      tramos.push([iso(d), iso(f < fin ? f : fin)]);
      d = new Date(f.getFullYear(), f.getMonth(), f.getDate() + 1);
    }
    const lineas: Record<string, unknown>[] = [];
    try {
      for (const [i, [a, b]] of tramos.entries()) {
        setExportando(`${i + 1}/${tramos.length}`);
        let r = await supabase.rpc("reporte_ventas_lineas", { p_desde: a, p_hasta: b, p_fuente: fuente, p_filtros: filtrosRpc });
        if (r.error && r.error.code === "57014") r = await supabase.rpc("reporte_ventas_lineas", { p_desde: a, p_hasta: b, p_fuente: fuente, p_filtros: filtrosRpc });
        if (r.error) throw r.error;
        lineas.push(...((r.data ?? []) as Record<string, unknown>[]));
      }
    } catch (e) {
      toast({ title: "No se pudo descargar el detalle", description: (e as Error).message, variant: "destructive" });
      setExportando(null);
      return;
    }
    const c = (titulo: string, campo: string) => ({ titulo, valor: (x: Record<string, unknown>) => x[campo] as string | number | null });
    const vacio = (titulo: string) => ({ titulo, valor: () => null });
    exportarCSV(`ventas-lineas_${desde}_${hasta}`, lineas, [
      c("Empresa", "empresa"), c("Fecha de Emisión", "fecha"), c("Fecha de Vencimiento", "fecha_vencimiento"), c("Mes", "mes"), c("Año", "anio"),
      c("Semana del Año", "semana"), c("Dia de la Semana", "dia_semana"), c("Tipo", "tipo"), c("Numero Documento", "numero"), c("Numero Origen", "numero_origen"),
      c("Documento Origen", "documento_origen"), c("Código del vendedor", "vendedor_codigo"), c("Nombre Vendedor", "vendedor"), c("Moneda", "moneda"),
      c("Tasa de Venta", "tasa_venta"), vacio("Tasa de Hoy"), c("Código de Cliente", "cliente_codigo"), c("Nombre o Razón Social", "cliente"),
      c("Tipo de Cliente", "tipo_cliente"), c("Canal de Ventas", "canal"), c("Segmento", "segmento"), c("Código del Articulo", "articulo_codigo"),
      c("Descripcion Articulo", "articulo"), c("Línea del Articulo", "linea"), c("Sub-Línea del Articulo", "sublinea"), c("Marca/Presentación", "marca"),
      c("Categoria del Articulo", "categoria"), c("Cantidad (Unidad Primaria)", "cantidad"), c("Precio Unitario Bolivares", "precio_bs"),
      c("Precio Unitario Dolares", "precio_usd"), c("Presentación (Primaria)", "presentacion"), c("% Descuento Renglón", "descuento_renglon_pct"),
      c("% Descuento Global", "descuento_global_pct"), c("Monto del Descuento Bolivares", "descuento_bs"), c("Exento Producto Bolivares", "exento_bs"),
      c("Base Imponible Producto Bolivares", "base_imponible_bs"), c("I.V.A. Producto Bolivares", "iva_bs"), c("Total Producto Bolivares", "total_bs"),
      c("Monto del Descuento USD", "descuento_usd"), c("Exento Producto USD", "exento_usd"), c("Base Imponible Producto USD", "base_imponible_usd"),
      c("I.V.A. Producto USD", "iva_usd"), c("Total Producto USD", "total_usd"), c("Anulado", "anulado"),
      ...(veCosto ? [c("Ultimo Costo USD (Referencia)", "ultimo_costo_usd")] : []),
      c("Estatus Cobro", "estatus_cobro"), c("Dias de Credito", "dias_credito"), c("Condicion de Pago", "condicion_pago"), c("Lista de Precios", "lista_precios"),
      c("Base de Ventas", "base_ventas_usd"),
      ...(veCosto ? [c("Costo por Unidad", "costo_usd"), c("Rentabilidad", "rentabilidad_usd")] : []),
      // Columnas de GUDS (no están en el Excel)
      c("Fuente", "fuente"), c("Tratamiento", "tratamiento"), c("RIF", "cliente_rif"), c("Venta neta GUDS (USD)", "venta_neta_usd"),
      c("NC financieras Profit (USD)", "financieras_usd"), ...(veCosto ? [c("Fecha del costo (Odoo)", "costo_fecha")] : []),
    ]);
    setExportando(null);
    toast({ title: `Detalle descargado: ${lineas.length.toLocaleString("es-VE")} líneas` });
  };

  // ── Controles ──
  const usados = new Set<string>([...niveles, columna].filter(Boolean));
  const selectorNivel = (i: number) => (
    <Select key={i} value={niveles[i] ?? "_"} onValueChange={(v) => {
      const n = [...niveles];
      if (v === "_") n.splice(i); else n[i] = v as Dim;
      cambiar({ niveles: n.filter(Boolean), columna: n.includes(columna as Dim) ? "" : columna }); setAbiertos(EN_BLANCO);
    }}>
      <SelectTrigger className="h-8 w-[calc(50%-4px)] text-[13px] sm:w-40" aria-label={`Nivel ${i + 1}`}>
        <span className="min-w-0 truncate"><span className="text-muted-foreground">{i + 1}.</span>{" "}<SelectValue /></span>
      </SelectTrigger>
      <SelectContent>
        {i > 0 && <SelectItem value="_">— sin nivel —</SelectItem>}
        {LISTA_DIMS.filter((d) => d === niveles[i] || !usados.has(d)).map((d) => (
          <SelectItem key={d} value={d}>{DIMS[d].titulo}{DIMS[d].profit ? " (Profit)" : ""}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  const chipsFiltro = (Object.entries(filtros) as [Dim, ValorFiltro[]][]).filter(([, v]) => v?.length);

  return (
    <div className="min-w-0">
      <Panel className="mb-2" titulo={<><SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />Vista</>}>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={config.preset} onValueChange={(v) => (v === "personalizado" ? cambiar({}) : aplicarPreset(v))}>
            <SelectTrigger className="h-8 w-full text-[13px] sm:w-80" aria-label="Vista del Excel"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(PRESETS).map(([k, p]) => <SelectItem key={k} value={k}>{p.titulo}</SelectItem>)}
              <SelectItem value="personalizado">Personalizada</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto" role="group" aria-label="Niveles">
            {[0, 1, 2, 3].filter((i) => i <= niveles.length && i < 4).map(selectorNivel)}
          </div>
          <Select value={columna || "_"} onValueChange={(v) => { cambiar({ columna: (v === "_" ? "" : v) as Columna }); setAbiertos(EN_BLANCO); }}>
            <SelectTrigger className="h-8 w-[calc(50%-4px)] text-[13px] sm:w-40" aria-label="Columnas"><SelectValue /></SelectTrigger>
            <SelectContent>
              {COLUMNAS.filter(([k]) => !k || !niveles.includes(k as Dim)).map(([k, e]) => <SelectItem key={k || "_"} value={k || "_"}>{k ? `Columnas: ${e}` : e}</SelectItem>)}
            </SelectContent>
          </Select>
          {matriz ? (
            <Select value={config.matriz} onValueChange={(v) => cambiar({ matriz: v as Medida })}>
              <SelectTrigger className="h-8 w-[calc(50%-4px)] text-[13px] sm:w-44" aria-label="Medida de la matriz"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LISTA_MEDIDAS.filter((m) => m !== "participacion" && (veCosto || !MEDIDAS[m].costo)).map((m) => <SelectItem key={m} value={m}>{MEDIDAS[m].titulo}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 w-[calc(50%-4px)] justify-start gap-1.5 text-[13px] font-normal sm:w-auto">
                  Medidas <span className="text-muted-foreground">({medidas.length})</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-64 p-2">
                {LISTA_MEDIDAS.filter((m) => veCosto || !MEDIDAS[m].costo).map((m) => (
                  <label key={m} className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 text-[13px] hover:bg-muted" title={MEDIDAS[m].ayuda}>
                    <Checkbox className="mt-0.5" checked={config.medidas.includes(m)} onCheckedChange={(v) => {
                      const s = v ? [...config.medidas, m] : config.medidas.filter((x) => x !== m);
                      cambiar({ medidas: LISTA_MEDIDAS.filter((x) => s.includes(x)) });
                    }} />
                    <span>{MEDIDAS[m].titulo}{MEDIDAS[m].conteo && <span className="block text-[11px] text-muted-foreground">cuenta documentos (más lento en períodos largos)</span>}</span>
                  </label>
                ))}
              </PopoverContent>
            </Popover>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          {chipsFiltro.map(([d, v]) => (
            <span key={d} className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-xs">
              <span className="text-muted-foreground">{DIMS[d].titulo}:</span>
              <span className="max-w-[180px] truncate" title={v.map((x) => x.e).join(", ")}>{v.length === 1 ? v[0].e : `${v.length} valores`}</span>
              <button type="button" className="text-muted-foreground hover:text-foreground" aria-label={`Quitar filtro ${DIMS[d].titulo}`}
                onClick={() => { const f = { ...filtros }; delete f[d]; cambiar({ filtros: f }, false); }}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <NuevoFiltro desde={desde} hasta={hasta} fuente={fuente} filtros={filtros} formatPrice={formatPrice}
            onAplicar={(d, v) => { const f = { ...filtros }; if (v.length) f[d] = v; else delete f[d]; cambiar({ filtros: f }, false); setAbiertos(EN_BLANCO); }} />
          {chipsFiltro.length > 0 && (
            <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={() => cambiar({ filtros: {} }, false)}>Quitar filtros</Button>
          )}
        </div>
      </Panel>

      {kpis.length > 0 && <KpiStrip items={kpis} />}

      <Panel sinPadding className="min-w-0"
        titulo={<span className="flex min-w-0 flex-wrap items-center gap-x-2">
          <span className="truncate">{niveles.map((d) => DIMS[d].titulo).join(" › ")}{matriz ? ` × ${COLUMNAS.find(([k]) => k === columna)?.[1]}` : ""}</span>
          {conProfit && <InsigniaProfit />}
          <span className="font-normal text-muted-foreground">· {cantidad.toLocaleString("es-VE")} filas</span>
        </span>}
        acciones={<>
          {cargando && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <Button type="button" size="sm" variant="outline" className="h-8 w-8 px-0" onClick={expandirTodo} disabled={niveles.length < 2 || !raiz.length} title="Abrir todos los niveles" aria-label="Abrir todos los niveles"><ChevronsUpDown className="h-3.5 w-3.5" /></Button>
          <Button type="button" size="sm" variant="outline" className="h-8 w-8 px-0" onClick={() => setAbiertos(EN_BLANCO)} disabled={!abiertos.size} title="Cerrar todos los niveles" aria-label="Cerrar todos los niveles"><ChevronsDownUp className="h-3.5 w-3.5" /></Button>
          <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 px-2" onClick={exportarAnalisis} disabled={!raiz.length} title="Descargar el análisis con sus niveles y subtotales (CSV)" aria-label="Exportar análisis (CSV)">
            <Download className="h-3.5 w-3.5" /><span className="hidden sm:inline">Análisis</span>
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 px-2" onClick={exportarLineas} disabled={!!exportando || !raiz.length}
            title='Descargar el detalle de líneas con las columnas de la hoja "Base datos" del Excel (CSV)' aria-label="Exportar líneas (CSV)">
            {exportando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{exportando ? `Líneas ${exportando}` : "Líneas"}</span>
          </Button>
        </>}>
        {error ? (
          <p className="px-3 py-6 text-center text-sm text-destructive">{error}</p>
        ) : !raiz.length ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">{cargando ? "Calculando…" : "Sin ventas en el período con estos filtros"}</p>
        ) : (
          <>
            <Table containerClassName="max-h-[calc(100vh-15rem)] min-h-[12rem]">
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 z-20 min-w-[180px] bg-muted">{niveles.map((d) => DIMS[d].titulo).join(" › ")}</TableHead>
                  {matriz ? (
                    <>
                      {columnas.map((c) => <TableHead key={c.k} className="whitespace-nowrap text-right">{c.e}</TableHead>)}
                      <TableHead className="sticky right-0 z-20 whitespace-nowrap bg-muted text-right font-semibold">Total</TableHead>
                    </>
                  ) : medidas.map((m) => (
                    <TableHead key={m} className="whitespace-nowrap text-right" title={MEDIDAS[m].ayuda}>
                      <button type="button" className={cn("hover:text-foreground", config.orden === m && "text-foreground underline underline-offset-4")}
                        onClick={() => cambiar({ orden: m }, false)}>{MEDIDAS[m].titulo}</button>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibles.map((n) => {
                  const abierto = abiertos.has(n.id);
                  return (
                    <TableRow key={n.id} className={cn(n.nivel === 1 && niveles.length > 1 && "font-medium")}>
                      <TableCell className="sticky left-0 z-[1] max-w-[280px] bg-card py-1" style={{ paddingLeft: `${8 + (n.nivel - 1) * 14}px` }}>
                        <span className="flex min-w-0 items-center gap-1">
                          {n.hijos.length ? (
                            <button type="button" onClick={() => alternar(n.id)} className="shrink-0 rounded text-muted-foreground hover:text-foreground"
                              aria-label={`${abierto ? "Cerrar" : "Abrir"} ${n.etiqueta}`} aria-expanded={abierto}>
                              {abierto ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                            </button>
                          ) : <span className="w-3.5 shrink-0" />}
                          <span className="truncate" title={n.detalle ? `${n.etiqueta} · ${n.detalle}` : n.etiqueta}>{n.etiqueta}</span>
                          {n.detalle && <span className="hidden shrink-0 font-mono text-[10px] text-muted-foreground xl:inline">{n.detalle}</span>}
                          {insigniaPorFila && n.fila.fuente !== "odoo" && <InsigniaProfit />}
                        </span>
                      </TableCell>
                      {matriz ? (
                        <>
                          {columnas.map((c) => <TableCell key={c.k} className="whitespace-nowrap py-1 text-right">{celda(n.celdas.get(c.k), config.matriz)}</TableCell>)}
                          <TableCell className="sticky right-0 z-[1] whitespace-nowrap bg-card py-1 text-right font-semibold">{celda(n.fila, config.matriz)}</TableCell>
                        </>
                      ) : medidas.map((m) => <TableCell key={m} className="whitespace-nowrap py-1 text-right">{celda(n.fila, m)}</TableCell>)}
                    </TableRow>
                  );
                })}
              </TableBody>
              {total && (
                <TableFooter className="sticky bottom-0 z-10 bg-muted">
                  <TableRow>
                    <TableCell className="sticky left-0 z-[1] bg-muted py-1 font-semibold">
                      <span className="flex items-center gap-1.5">Total general{conProfit && <InsigniaProfit />}</span>
                    </TableCell>
                    {matriz ? (
                      <>
                        {columnas.map((c) => <TableCell key={c.k} className="whitespace-nowrap py-1 text-right font-semibold">{celda(total.celdas.get(c.k), config.matriz)}</TableCell>)}
                        <TableCell className="sticky right-0 z-[1] whitespace-nowrap bg-muted py-1 text-right font-semibold">{celda(total.fila, config.matriz)}</TableCell>
                      </>
                    ) : medidas.map((m) => <TableCell key={m} className="whitespace-nowrap py-1 text-right font-semibold">{celda(total.fila, m)}</TableCell>)}
                  </TableRow>
                </TableFooter>
              )}
            </Table>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
              {raizOrdenada.length > top && (
                <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={() => setVerTodos((v) => !v)}>
                  {verTodos ? `Ver los primeros ${top}` : `Ver todos (${raizOrdenada.length.toLocaleString("es-VE")})`}
                </Button>
              )}
              <span>Venta neta en USD sin IVA: facturas − NC y devoluciones; sin saldos iniciales, ND ni facturas anuladas por completo.</span>
              {veCosto && medidas.includes("margen_pct") && <span>Margen sobre las líneas con costo (Odoo: costo promedio actual; Profit: último costo). * = parte de la venta sin costo.</span>}
              {niveles.some((d) => DIMS[d].profit) && <span>Marca, tipo de cliente, canal y segmento solo existen en Profit.</span>}
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}

/** Botón "Agregar filtro": elige la dimensión y sus valores (con la venta de cada uno en el período y los demás filtros) */
function NuevoFiltro({ desde, hasta, fuente, filtros, onAplicar, formatPrice }: {
  desde: string; hasta: string; fuente: FuenteCubo; filtros: Filtros; formatPrice: (v: number) => string;
  onAplicar: (d: Dim, valores: ValorFiltro[]) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [dim, setDim] = useState<Dim>("vendedor");
  const [opciones, setOpciones] = useState<{ k: string; e: string; d: string | null; venta: number }[]>([]);
  const [cargando, setCargando] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Map<string, string>>(new Map());
  const pedido = useRef(0);

  useEffect(() => {
    if (!abierto) return;
    setSel(new Map((filtros[dim] ?? []).map((x) => [x.k, x.e])));
    const otros = Object.fromEntries(Object.entries(filtros).filter(([d, v]) => d !== dim && v?.length).map(([d, v]) => [d, v!.map((x) => x.k)]));
    const id = ++pedido.current;
    setCargando(true);
    consultarCubo({ p_desde: desde, p_hasta: hasta, p_niveles: [dim], p_fuente: fuente, p_filtros: otros, p_columna: null, p_conteos: false })
      .then(({ filas }) => filas.filter((f) => f.nivel === 1).map((f) => ({ k: f.k1 ?? "", e: f.etiqueta ?? "—", d: f.detalle, venta: Number(f.venta_usd ?? 0) })))
      .catch(() => [] as { k: string; e: string; d: string | null; venta: number }[])
      .then((lista) => {
        if (id !== pedido.current) return;
        lista.sort((a, b) => (DIMS[dim].tiempo ? a.k.localeCompare(b.k) : b.venta - a.venta));
        setOpciones(lista);
        setCargando(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, dim]);

  const texto = q.trim().toLowerCase();
  const filtradas = opciones.filter((o) => !texto || o.e.toLowerCase().includes(texto) || (o.d ?? "").toLowerCase().includes(texto)).slice(0, 300);
  return (
    <Popover open={abierto} onOpenChange={(v) => { setAbierto(v); if (!v) setQ(""); }}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-6 gap-1 px-1.5 text-xs"><Plus className="h-3 w-3" />Filtro</Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-2">
        <div className="flex items-center gap-1.5">
          <Select value={dim} onValueChange={(v) => { setDim(v as Dim); setQ(""); }}>
            <SelectTrigger className="h-8 flex-1 text-[13px]" aria-label="Filtrar por"><SelectValue /></SelectTrigger>
            <SelectContent>{LISTA_DIMS.map((d) => <SelectItem key={d} value={d}>{DIMS[d].titulo}{DIMS[d].profit ? " (Profit)" : ""}</SelectItem>)}</SelectContent>
          </Select>
          {cargando && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar…" className="mt-1.5 h-8 text-[13px]" />
        <div className="mt-1.5 max-h-64 overflow-y-auto">
          {!cargando && !filtradas.length && <p className="px-1.5 py-3 text-center text-xs text-muted-foreground">Sin valores en el período</p>}
          {filtradas.map((o) => (
            <label key={o.k} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[13px] hover:bg-muted">
              <Checkbox checked={sel.has(o.k)} onCheckedChange={(v) => setSel((s) => { const n = new Map(s); if (v) n.set(o.k, o.e); else n.delete(o.k); return n; })} />
              <span className="min-w-0 flex-1 truncate" title={o.d ? `${o.e} · ${o.d}` : o.e}>{o.e}</span>
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{formatPrice(o.venta)}</span>
            </label>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">{sel.size} seleccionado{sel.size === 1 ? "" : "s"}</span>
          <div className="flex gap-1.5">
            {sel.size > 0 && <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSel(new Map())}>Limpiar</Button>}
            <Button size="sm" className="h-7 text-xs" onClick={() => { onAplicar(dim, [...sel.entries()].map(([k, e]) => ({ k, e }))); setAbierto(false); }}>Aplicar</Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default AnalisisVentas;
