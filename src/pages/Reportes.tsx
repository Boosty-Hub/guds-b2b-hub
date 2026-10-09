import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ClipboardCheck, Loader2 } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { BarraLista } from "@/components/datos/BarraLista";
import { Panel } from "@/components/datos/FichaCampos";
import { TablaReporte } from "@/components/reportes/TablaReporte";
import { CobranzaDso } from "@/components/reportes/CobranzaDso";
import { HistoricoProfit } from "@/components/reportes/HistoricoProfit";
import { AnalisisVentas } from "@/components/reportes/AnalisisVentas";
import { MetasVendedores } from "@/components/reportes/MetasVendedores";
import { CalidadDatos, useCalidadOculta } from "@/components/reportes/CalidadDatos";
import { LoCobrado } from "@/components/reportes/cobrado/LoCobrado";
import { Antiguedad } from "@/components/reportes/antiguedad/Antiguedad";
import { VentasDeuda } from "@/components/reportes/ventas-deuda/VentasDeuda";
import { InsigniaProfit, colorFuente, periodoComparacion, Variacion, fechaCorta, TEXTO_COMPARACION } from "@/components/reportes/comun";
import { useOrdenTabla, EncabezadoOrdenable, exportarCSV, BotonExportar } from "@/components/datos/tabla";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { FiltrosLista, useFiltros, opcionesTexto, opcionesPrueba, pasaPrueba, coincideTexto, type OpcionPrueba } from "@/components/datos/FiltrosLista";
import { supabase } from "@/lib/supabase";
import { esIso } from "@/lib/fechas";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { usePermissions } from "@/contexts/PermissionsContext";
import { useToast } from "@/hooks/use-toast";

// ── Tipos de las funciones de reporte (migraciones 18u y 20g: Odoo + histórico de Profit) ──
type FuenteFila = "odoo" | "profit" | "ambas";
interface FilaVenta { clave: string; etiqueta: string; detalle: string | null; documentos: number | null; clientes: number | null; cantidad: number | null; bruto_usd: number; nc_usd: number; neto_usd: number; profit_usd: number; financieras_usd: number; fuente: FuenteFila }
interface FilaCobro { clave: string; etiqueta: string; detalle: string | null; cobros: number; clientes: number; monto_usd: number }
interface FilaReverso { empresa: string; cliente: string; factura: string; factura_fecha: string; nota: string; nota_fecha: string; neto_usd: number; motivo: string | null; fuente: FuenteFila }
// reporte_ventas_comparativo (20q): la venta del período, del anterior y del mismo período del año anterior
interface FilaComparativo { clave: string; etiqueta: string; detalle: string | null; actual_usd: number; anterior_usd: number; anio_anterior_usd: number;
  var_anterior_usd: number; var_anterior_pct: number | null; var_anio_usd: number; var_anio_pct: number | null;
  facturas_actual: number | null; facturas_anterior: number | null; facturas_anio_anterior: number | null;
  profit_actual_usd: number; profit_anterior_usd: number; profit_anio_anterior_usd: number; fuente: FuenteFila;
  anterior_desde: string; anterior_hasta: string; anio_desde: string; anio_hasta: string }
interface FilaInv { producto_id: string; sku: string; nombre: string; categoria: string; existencia: number; comprometido: number; disponible: number; vendido_unidades: number; vendido_usd: number; ultima_venta: string | null; cobertura_dias: number | null }

const num = (v: unknown) => Number(v ?? 0);
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const etiquetaMes = (k: string) => { const [y, m] = k.split("-"); return `${MESES[Number(m) - 1]} ${y.slice(2)}`; };

// Fuente de las ventas: Odoo (en operación desde mayo 2026) y el histórico de Profit (dic-2020 → may-2026, solo lectura)
type Fuente = "ambas" | "odoo" | "profit";
const FUENTES: Record<Fuente, string> = { ambas: "Odoo + Profit", odoo: "Solo Odoo", profit: "Solo Profit" };
const HISTORIAL_DESDE = "2020-12-01";
const textoFuente = (f: FuenteFila) => (f === "ambas" ? "Odoo + Profit" : f === "profit" ? "Profit" : "Odoo");

// Sub-vistas de Reportes → Cobranza (?cobranza=). La Antigüedad y Ventas vs deuda guardan en la URL su corte y sus filtros
// (se limpian al cambiar de sub-vista).
type SubCobranza = "resumen" | "cobrado" | "antiguedad" | "ventas-deuda";
const SUB_COBRANZA: [SubCobranza, string][] = [["resumen", "Resumen"], ["cobrado", "Lo cobrado"], ["antiguedad", "Antigüedad"], ["ventas-deuda", "Ventas vs deuda"]];
const PARAMS_SUBVISTA = ["corte", "base", "ne", "clasif", "agrupar", "columnas", "meses", "activo", "estado", "vista", "orden"];

type Periodo = "mes" | "mes_anterior" | "trimestre" | "anio" | "12m" | "24m" | "todo" | "personalizado" | `a${number}`;
const ANIO_ACTUAL = new Date().getFullYear();
const PERIODOS: [Periodo, string][] = [
  ["mes", "Este mes"], ["mes_anterior", "Mes anterior"], ["trimestre", "Últimos 3 meses"], ["anio", "Año en curso"],
  ["12m", "Últimos 12 meses"], ["24m", "Últimos 24 meses"],
  // Años completos anteriores (con el histórico de Profit hay ventas desde dic-2020)
  ...Array.from({ length: Math.max(0, ANIO_ACTUAL - 2021) }, (_, i): [Periodo, string] => [`a${ANIO_ACTUAL - 1 - i}`, `Año ${ANIO_ACTUAL - 1 - i}`]),
  ["todo", "Todo el historial"], ["personalizado", "Personalizado"],
];
const esPeriodo = (v: string | null): v is Periodo => !!v && PERIODOS.some(([k]) => k === v);
function rango(p: Periodo, desde: string, hasta: string): [string, string] {
  const hoy = new Date();
  const y = hoy.getFullYear(), m = hoy.getMonth();
  if (/^a\d{4}$/.test(p)) return [`${p.slice(1)}-01-01`, `${p.slice(1)}-12-31`];
  switch (p) {
    case "mes": return [iso(new Date(y, m, 1)), iso(hoy)];
    case "mes_anterior": return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
    case "trimestre": return [iso(new Date(y, m - 2, 1)), iso(hoy)];
    case "anio": return [iso(new Date(y, 0, 1)), iso(hoy)];
    case "12m": return [iso(new Date(y, m - 11, 1)), iso(hoy)];
    case "24m": return [iso(new Date(y, m - 23, 1)), iso(hoy)];
    case "todo": return [HISTORIAL_DESDE, iso(hoy)];
    default: return [desde, hasta];
  }
}
// Período anterior para comparar: si son meses completos, los mismos meses justo antes (un año → el año anterior);
// si no, el mismo número de días justo antes (la misma regla que periodo_comparacion() en la base)
const anterior = (desde: string, hasta: string) => periodoComparacion(desde, hasta, "anterior");
const variacion = (actual: number, previo: number) => (previo ? ((actual - previo) / Math.abs(previo)) * 100 : null);

// Color primario del tema ya resuelto: en atributos SVG (fill) var(--primary) no se resuelve
const colorPrimario = () => {
  try { const v = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim(); return v ? `hsl(${v})` : "#8b1a1a"; } catch { return "#8b1a1a"; }
};

function GraficoMeses({ datos, formato }: { datos: { mes: string; valor: number }[]; formato: (v: number) => string }) {
  const color = colorPrimario();
  return (
    <div className="h-44 w-full px-2 py-2">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={datos} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="mes" tickLine={false} axisLine={false} fontSize={11} tickFormatter={etiquetaMes} />
          <YAxis tickLine={false} axisLine={false} fontSize={11} width={56} tickFormatter={(v) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
          <Tooltip cursor={{ fill: "hsl(var(--muted))" }} formatter={(v: number) => [formato(v), "Monto"]} labelFormatter={(l: string) => etiquetaMes(l)}
            contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }} />
          <Bar dataKey="valor" radius={[3, 3, 0, 0]} fill={color} maxBarSize={48} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// Venta neta por mes, apilada por fuente (Odoo / Profit). Con una sola fuente no hay leyenda: el título la nombra.
function GraficoVentas({ datos, formato }: { datos: { mes: string; odoo: number; profit: number }[]; formato: (v: number) => string }) {
  const hayOdoo = datos.some((d) => Math.abs(d.odoo) > 0.004), hayProfit = datos.some((d) => Math.abs(d.profit) > 0.004);
  const series = [
    ...(hayProfit ? [{ clave: "profit" as const, nombre: "Profit (histórico)" }] : []),
    ...(hayOdoo || !hayProfit ? [{ clave: "odoo" as const, nombre: "Odoo" }] : []),
  ];
  const superficie = "hsl(var(--card))";
  return (
    <div className="w-full px-2 py-2">
      {series.length > 1 && (
        <div className="mb-1 flex flex-wrap items-center gap-3 px-2 text-[11px] text-muted-foreground" aria-label="Leyenda">
          {series.map((s) => (
            <span key={s.clave} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colorFuente(s.clave) }} aria-hidden />{s.nombre}
            </span>
          ))}
        </div>
      )}
      <div className="h-44 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={datos} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="mes" tickLine={false} axisLine={false} fontSize={11} tickFormatter={etiquetaMes} minTickGap={12} />
            <YAxis tickLine={false} axisLine={false} fontSize={11} width={56} tickFormatter={(v) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
            <Tooltip cursor={{ fill: "hsl(var(--muted))" }} labelFormatter={(l: string) => etiquetaMes(l)}
              formatter={(v: number, n: string) => [formato(v), n]}
              contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))", color: "hsl(var(--foreground))" }} />
            {series.map((s, i) => (
              <Bar key={s.clave} dataKey={s.clave} name={s.nombre} stackId="fuente" fill={colorFuente(s.clave)} maxBarSize={48} isAnimationActive={false}
                stroke={superficie} strokeWidth={1} radius={i === series.length - 1 ? [4, 4, 0, 0] : 0} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const Reportes = () => {
  const { formatPrice } = useCurrency();
  const { soloLectura, seleccion, empresas, empresaActiva } = useEmpresa();
  // 22a4/22e: los reportes con deuda o cobros por cliente (DSO, "Top clientes que pagaron", Calidad y cuadre) exigen reportes Y
  // cuentas (la base también lo exige)
  const { can } = usePermissions();
  const veDeuda = can("cuentas", "ver");
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(params.get("tab") || "ventas");
  const [periodo, setPeriodoEstado] = useState<Periodo>(esPeriodo(params.get("periodo")) ? (params.get("periodo") as Periodo) : "mes");
  const [fuente, setFuenteEstado] = useState<Fuente>((["ambas", "odoo", "profit"] as const).find((f) => f === params.get("fuente")) ?? "ambas");
  // Personalizado: desde/hasta también en la URL (22f), para que el enlace y la recarga conserven el período
  const [desdeP, setDesdeP] = useState(esIso(params.get("desde")) ? params.get("desde")! : iso(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [hastaP, setHastaP] = useState(esIso(params.get("hasta")) ? params.get("hasta")! : iso(new Date()));
  // Reportes → Cobranza: Resumen, Lo cobrado (22f, ?cobranza=cobrado) o Antigüedad (22g, ?cobranza=antiguedad)
  const subCobranza: SubCobranza = SUB_COBRANZA.find(([k]) => k === params.get("cobranza"))?.[0] ?? "resumen";
  const [desde, hasta] = rango(periodo, desdeP, hastaP);
  const [cargando, setCargando] = useState(true);
  const [ventas, setVentas] = useState<Record<string, FilaVenta[]>>({});
  const [comparativo, setComparativo] = useState<Record<"empresa" | "vendedor", FilaComparativo[]>>({ empresa: [], vendedor: [] });
  const [meses, setMeses] = useState<FilaVenta[]>([]);
  const [reversos, setReversos] = useState<FilaReverso[]>([]);
  const [verReversos, setVerReversos] = useState(false);
  const [cobros, setCobros] = useState<Record<string, FilaCobro[]>>({});
  const [cobrosPrev, setCobrosPrev] = useState<FilaCobro[]>([]);
  const [mesesCobro, setMesesCobro] = useState<FilaCobro[]>([]);
  const [inv, setInv] = useState<FilaInv[]>([]);
  // Ventana de rotación en la URL (?rotacion=30|60|90|180)
  const diasRot = [30, 60, 90, 180].includes(Number(params.get("rotacion"))) ? Number(params.get("rotacion")) : 90;
  const [qInv, setQInv] = useState("");

  // Pestaña, período y fuente quedan en la URL (para compartir el reporte)
  const enUrl = (clave: string, valor: string, porDefecto: string) => {
    if (valor === porDefecto) params.delete(clave); else params.set(clave, valor);
    setParams(params, { replace: true });
  };
  // Al salir de Inventario se quitan sus filtros de la URL (una sola escritura: dos seguidas se pisan)
  const cambiarTab = (t: string) => {
    setTab(t);
    if (t === "ventas") params.delete("tab"); else params.set("tab", t);
    if (t !== "inventario") ["situacion", "categoria", "rotacion"].forEach((k) => params.delete(k));
    if (t !== "cobranza") { params.delete("cobranza"); PARAMS_SUBVISTA.forEach((k) => params.delete(k)); }
    setParams(params, { replace: true });
  };
  // Al salir de la Antigüedad se quitan su corte y sus filtros de la URL
  const cambiarSubCobranza = (v: SubCobranza) => {
    if (v === "resumen") params.delete("cobranza"); else params.set("cobranza", v);
    if (v !== subCobranza) PARAMS_SUBVISTA.forEach((k) => params.delete(k));
    setParams(params, { replace: true });
  };
  // Si la URL cambia estando en la página (p. ej. un acceso de Ctrl+K), la pestaña la sigue
  const tabUrl = params.get("tab") || "ventas";
  useEffect(() => { if (tabUrl !== tab) setTab(tabUrl); }, [tabUrl]);   // eslint-disable-line react-hooks/exhaustive-deps
  const setDiasRot = (d: number) => enUrl("rotacion", String(d), "90");
  const setPeriodo = (p: Periodo) => {
    setPeriodoEstado(p);
    if (p === "personalizado") { params.set("desde", desdeP); params.set("hasta", hastaP); } else { params.delete("desde"); params.delete("hasta"); }
    enUrl("periodo", p, "mes");
  };
  const cambiarRango = (d: string, h: string) => {
    setDesdeP(d); setHastaP(h);
    if (esIso(d)) params.set("desde", d);
    if (esIso(h)) params.set("hasta", h);
    setParams(params, { replace: true });
  };
  const setFuente = (f: Fuente) => { setFuenteEstado(f); enUrl("fuente", f, "ambas"); };

  // Carga según la pestaña (cada consulta agrega en el servidor)
  useEffect(() => {
    if (tab === "profit") { setCargando(false); return; }   // la pestaña del histórico carga lo suyo
    if (tab === "calidad" && !veDeuda) { setCargando(false); return; }   // sin permiso de Cuentas no se carga (22e)
    if (tab === "analisis" || tab === "metas" || tab === "calidad") return;   // también (e informan si están cargando)
    if (tab === "cobranza" && subCobranza !== "resumen") { setCargando(false); return; }   // Lo cobrado y la Antigüedad cargan lo suyo (22f, 22g)
    let cancelado = false;
    (async () => {
      setCargando(true);
      const [pd, ph] = anterior(desde, hasta);
      // Gráfico mensual: los 12 meses hasta el fin del período, o el período completo si es más largo
      const h = new Date(`${hasta}T00:00:00`);
      const ini12 = [iso(new Date(h.getFullYear(), h.getMonth() - 11, 1)), iso(new Date(`${desde.slice(0, 7)}-01T00:00:00`))].sort()[0];
      const rpc = async <T,>(fn: string, args: Record<string, unknown>) => {
        const { data, error } = await supabase.rpc(fn, args);
        if (error) throw error;
        return (data ?? []) as T[];
      };
      try {
        if (tab === "ventas") {
          // "empresa" da los totales con un solo redondeo (y la tabla por empresa en modo "Ambas")
          const grupos = ["empresa", "vendedor", "cliente", "producto", "categoria"];
          // Con el histórico de Profit un período largo pesa y la base tiene pocos núcleos: las consultas por documento van en
          // 2 carriles y las de líneas (categoría y producto, las más pesadas) en un tercero, una tras otra. Si una tabla
          // falla, las demás se muestran igual.
          const venta = (g: string, d: string, h: string) => () => rpc<FilaVenta>("reporte_ventas", { p_desde: d, p_hasta: h, p_agrupar: g, p_fuente: fuente });
          // Comparativos (20q): período anterior y mismo período del año anterior, con las cifras de reporte_ventas
          const comparar = (g: string) => () => rpc<FilaComparativo>("reporte_ventas_comparativo", { p_desde: desde, p_hasta: hasta, p_agrupar: g, p_fuente: fuente });
          const livianas: [string, () => Promise<unknown[]>][] = [
            ["empresa", venta("empresa", desde, hasta)], ["mes", venta("mes", ini12, hasta)], ["comp_empresa", comparar("empresa")],
            ["vendedor", venta("vendedor", desde, hasta)], ["cliente", venta("cliente", desde, hasta)], ["comp_vendedor", comparar("vendedor")],
            ["reversos", () => rpc<FilaReverso>("reporte_reversos", { p_desde: desde, p_hasta: hasta, p_fuente: fuente })],
          ];
          // Por categoría y producto la página solo muestra unidades y venta: sin conteos de documentos ni clientes (mucho más rápido)
          const lineas = (g: string) => () => rpc<FilaVenta>("reporte_ventas", { p_desde: desde, p_hasta: hasta, p_agrupar: g, p_fuente: fuente, p_conteos: false });
          const pesadas: [string, () => Promise<unknown[]>][] = [["categoria", lineas("categoria")], ["producto", lineas("producto")]];
          const out: Record<string, unknown[]> = {};
          const fallas: string[] = [];
          const carril = async (cola: [string, () => Promise<unknown[]>][]) => {
            for (let t = cola.shift(); t && !cancelado; t = cola.shift()) {
              try { out[t[0]] = await t[1](); } catch (e) { out[t[0]] = []; fallas.push((e as Error).message); }
            }
          };
          const total = livianas.length + pesadas.length;
          await Promise.all([carril(livianas), carril(livianas), carril(pesadas)]);
          if (cancelado) return;
          setVentas(Object.fromEntries(grupos.map((g) => [g, (out[g] ?? []) as FilaVenta[]])));
          setComparativo({ empresa: (out.comp_empresa ?? []) as FilaComparativo[], vendedor: (out.comp_vendedor ?? []) as FilaComparativo[] });
          setMeses((out.mes ?? []) as FilaVenta[]); setReversos((out.reversos ?? []) as FilaReverso[]);
          if (fallas.length) toast({ title: `No se pudieron cargar ${fallas.length} de ${total} partes del reporte`, description: fallas[0], variant: "destructive" });
        } else if (tab === "cobranza") {
          const grupos = ["empresa", "banco", "vendedor", ...(veDeuda ? ["cliente"] : []), "metodo"];
          const [res, prev, m] = await Promise.all([
            Promise.all(grupos.map((g) => rpc<FilaCobro>("reporte_cobranza", { p_desde: desde, p_hasta: hasta, p_agrupar: g }))),
            rpc<FilaCobro>("reporte_cobranza", { p_desde: pd, p_hasta: ph, p_agrupar: "empresa" }),
            rpc<FilaCobro>("reporte_cobranza", { p_desde: ini12, p_hasta: hasta, p_agrupar: "mes" }),
          ]);
          if (cancelado) return;
          setCobros(Object.fromEntries(grupos.map((g, i) => [g, res[i]])));
          setCobrosPrev(prev); setMesesCobro(m);
        } else if (tab === "inventario") {
          const r = await rpc<FilaInv>("reporte_inventario", { p_dias: diasRot });
          if (cancelado) return;
          setInv(r);
        }
      } catch (e) {
        if (!cancelado) toast({ title: "No se pudo cargar el reporte", description: (e as Error).message, variant: "destructive" });
      } finally {
        if (!cancelado) setCargando(false);
      }
    })();
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, desde, hasta, diasRot, soloLectura, seleccion, fuente, veDeuda, subCobranza]);

  // ── Ventas ──
  const totalVentas = useMemo(() => {
    const porEmpresa = ventas.empresa ?? [];
    const suma = (c: (f: FilaVenta) => unknown) => porEmpresa.reduce((s, f) => s + num(c(f)), 0);
    const [neto, bruto, nc, docs, profit, financieras] = [suma((f) => f.neto_usd), suma((f) => f.bruto_usd), suma((f) => f.nc_usd),
      suma((f) => f.documentos), suma((f) => f.profit_usd), suma((f) => f.financieras_usd)];
    const clientes = (ventas.cliente ?? []).filter((f) => num(f.bruto_usd) > 0).length;
    const clientesProfit = (ventas.cliente ?? []).some((f) => num(f.bruto_usd) > 0 && f.fuente !== "odoo");
    return { neto, bruto, nc, docs, clientes, ticket: docs ? bruto / docs : 0, profit, financieras,
      conProfit: porEmpresa.some((f) => f.fuente !== "odoo"), clientesProfit };
  }, [ventas]);
  // Comparativo del total (suma de las empresas visibles)
  const comp = useMemo(() => {
    const filas = comparativo.empresa;
    const s = (c: (f: FilaComparativo) => unknown) => filas.reduce((a, f) => a + num(c(f)), 0);
    const [ad, ah] = anterior(desde, hasta), [yd, yh] = periodoComparacion(desde, hasta, "anio_anterior");
    return {
      actual: s((f) => f.actual_usd), anterior: s((f) => f.anterior_usd), anio: s((f) => f.anio_anterior_usd),
      facturas: [s((f) => f.facturas_actual), s((f) => f.facturas_anterior), s((f) => f.facturas_anio_anterior)],
      profit: [s((f) => f.profit_actual_usd), s((f) => f.profit_anterior_usd), s((f) => f.profit_anio_anterior_usd)],
      periodos: [[desde, hasta], [filas[0]?.anterior_desde ?? ad, filas[0]?.anterior_hasta ?? ah], [filas[0]?.anio_desde ?? yd, filas[0]?.anio_hasta ?? yh]] as [string, string][],
    };
  }, [comparativo, desde, hasta]);
  const netoPrev = comp.anterior;
  const prevConProfit = Math.abs(comp.profit[1]) > 0.004;
  const varVentas = variacion(totalVentas.neto, netoPrev);
  const varAnio = variacion(totalVentas.neto, comp.anio);
  const [pdesde, phasta] = anterior(desde, hasta);
  // Primera columna de las tablas de ventas: etiqueta + insignia cuando la fila incluye Profit
  const conInsignia = (texto: string, f: FilaVenta) => (
    <span className="inline-flex max-w-full items-center gap-1.5"><span className="truncate">{texto}</span>{f.fuente !== "odoo" && <InsigniaProfit />}</span>
  );
  const columnasFuente = [
    { clave: "fuente", titulo: "Fuente", valor: (f: FilaVenta) => textoFuente(f.fuente), soloExportar: true },
    { clave: "profit", titulo: "Parte de Profit (USD)", valor: (f: FilaVenta) => num(f.profit_usd), soloExportar: true },
  ];

  // ── Cobranza ──
  const totalCobros = useMemo(() => {
    const porEmpresa = cobros.empresa ?? [];
    return { monto: porEmpresa.reduce((s, f) => s + num(f.monto_usd), 0), cobros: porEmpresa.reduce((s, f) => s + num(f.cobros), 0),
      clientes: (cobros.cliente ?? []).length };
  }, [cobros]);
  const cobradoPrev = cobrosPrev.reduce((s, f) => s + num(f.monto_usd), 0);
  const varCobros = variacion(totalCobros.monto, cobradoPrev);

  // ── Inventario ──
  // Filtros de la pestaña (en la URL): situación (las mismas reglas que los indicadores) y categoría
  const pruebasSituacion: OpcionPrueba<FilaInv>[] = [
    { valor: "sin_disponible", etiqueta: "Sin disponible", prueba: (f) => num(f.disponible) <= 0 },
    { valor: "quiebre", etiqueta: "Riesgo de quiebre (< 15 días)", prueba: (f) => f.cobertura_dias !== null && num(f.cobertura_dias) < 15 },
    { valor: "inmovilizado", etiqueta: "Inmovilizado (sin ventas)", prueba: (f) => num(f.vendido_unidades) <= 0 && num(f.existencia) > 0 },
  ];
  const fInv = useFiltros(tab === "inventario" ? [
    { clave: "situacion", etiqueta: "Situación", todos: "Todas", principal: true, opciones: opcionesPrueba(inv, pruebasSituacion) },
    { clave: "categoria", etiqueta: "Categoría", todos: "Todas", principal: true, opciones: opcionesTexto(inv, (f) => f.categoria) },
  ] : []);
  const filtroInv = fInv.v("situacion");
  // Indicadores: por categoría si hay una elegida (sin filtros, los mismos de siempre); la situación la fijan ellos al pulsarlos
  const invBase = useMemo(() => inv.filter((f) => coincideTexto(f.categoria, fInv.v("categoria"))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inv, fInv.firma]);
  const invStats = useMemo(() => ({
    total: invBase.length,
    sinDisponible: invBase.filter((f) => num(f.disponible) <= 0).length,
    quiebre: invBase.filter((f) => f.cobertura_dias !== null && num(f.cobertura_dias) < 15).length,
    inmovilizado: invBase.filter((f) => num(f.vendido_unidades) <= 0 && num(f.existencia) > 0).length,
    vendido: invBase.reduce((s, f) => s + num(f.vendido_usd), 0),
  }), [invBase]);
  const setFiltroInv = (s: string) => fInv.set("situacion", filtroInv === s ? "" : s);
  const textoInv = qInv.trim().toLowerCase();
  const invFiltrado = invBase.filter((f) => pasaPrueba(pruebasSituacion, filtroInv, f) &&
    (!textoInv || f.nombre.toLowerCase().includes(textoInv) || (f.sku || "").toLowerCase().includes(textoInv) || f.categoria.toLowerCase().includes(textoInv)));
  const { ordenadas: invOrden, orden: ordenInv, alternar: alternarInv } = useOrdenTabla(invFiltrado, {
    sku: (f) => f.sku, nombre: (f) => f.nombre, categoria: (f) => f.categoria, existencia: (f) => num(f.existencia), comprometido: (f) => num(f.comprometido),
    disponible: (f) => num(f.disponible), vendido: (f) => num(f.vendido_unidades), usd: (f) => num(f.vendido_usd), ultima: (f) => f.ultima_venta,
    cobertura: (f) => (f.cobertura_dias === null ? null : num(f.cobertura_dias)),
  });
  const pgInv = usePagination(invOrden, 50, fInv.firma);
  const porCategoria = useMemo(() => {
    const m = new Map<string, { categoria: string; productos: number; existencia: number; disponible: number; vendido: number; usd: number }>();
    for (const f of inv) {
      const g = m.get(f.categoria) || { categoria: f.categoria, productos: 0, existencia: 0, disponible: 0, vendido: 0, usd: 0 };
      g.productos += 1; g.existencia += num(f.existencia); g.disponible += num(f.disponible); g.vendido += num(f.vendido_unidades); g.usd += num(f.vendido_usd);
      m.set(f.categoria, g);
    }
    return [...m.values()];
  }, [inv]);

  const fmtN = (v: unknown) => num(v).toLocaleString("es-VE", { maximumFractionDigits: 0 });
  const tonoVar = (v: number | null) => (v === null ? "tenue" as const : v >= 0 ? "positivo" as const : "negativo" as const);
  const textoVar = (v: number | null) => (v === null ? "sin datos del período anterior" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}% vs período anterior`);
  const textoVarAnio = (v: number | null) => (v === null ? "sin datos del año anterior" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}% vs año anterior`);

  const calidadOculta = useCalidadOculta();   // Fase 21d: la sección se oculta al terminar la revisión
  const pestanas = (
    <TabsList>
      <TabsTrigger value="ventas">Ventas</TabsTrigger>
      <TabsTrigger value="analisis">Análisis</TabsTrigger>
      <TabsTrigger value="metas">Metas</TabsTrigger>
      <TabsTrigger value="cobranza">Cobranza</TabsTrigger>
      <TabsTrigger value="inventario"><span className="sm:hidden">Inventario</span><span className="hidden sm:inline">Inventario y rotación</span></TabsTrigger>
      <TabsTrigger value="profit"><span className="sm:hidden">Profit</span><span className="hidden sm:inline">Histórico Profit</span></TabsTrigger>
      {!veDeuda ? null : calidadOculta && tab !== "calidad"
        ? <TabsTrigger value="calidad" title="Calidad y cuadre (sección oculta)" aria-label="Calidad y cuadre (sección oculta)" className="px-2 text-muted-foreground/70"><ClipboardCheck className="h-3.5 w-3.5" /></TabsTrigger>
        : <TabsTrigger value="calidad"><span className="sm:hidden">Calidad</span><span className="hidden sm:inline">Calidad y cuadre</span></TabsTrigger>}
    </TabsList>
  );
  const selectorPeriodo = (
    <>
      <Select value={periodo} onValueChange={(v) => setPeriodo(v as Periodo)}>
        <SelectTrigger className="h-8 w-44 text-[13px]" aria-label="Período"><SelectValue /></SelectTrigger>
        <SelectContent>{PERIODOS.map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
      </Select>
      {(tab === "ventas" || tab === "analisis") && (
        <Select value={fuente} onValueChange={(v) => setFuente(v as Fuente)}>
          <SelectTrigger className="h-8 w-36 text-[13px]" aria-label="Fuente de las ventas"><SelectValue /></SelectTrigger>
          <SelectContent>{(Object.keys(FUENTES) as Fuente[]).map((k) => <SelectItem key={k} value={k}>{FUENTES[k]}</SelectItem>)}</SelectContent>
        </Select>
      )}
      {periodo === "personalizado" && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Input type="date" value={desdeP} max={hastaP} onChange={(e) => cambiarRango(e.target.value, hastaP)} className="h-8 w-36 text-[13px]" aria-label="Desde" />
          a
          <Input type="date" value={hastaP} min={desdeP} onChange={(e) => cambiarRango(desdeP, e.target.value)} className="h-8 w-36 text-[13px]" aria-label="Hasta" />
        </span>
      )}
      <span className="text-xs text-muted-foreground">{desde.split("-").reverse().join("/")} – {hasta.split("-").reverse().join("/")}</span>
    </>
  );

  return (
    <MainLayout title="Reportes">
      <Tabs value={tab} onValueChange={cambiarTab}>
        <BarraLista pestanas={<div className="-mx-1 w-[calc(100%+0.5rem)] overflow-x-auto px-1 [scrollbar-width:none] sm:mx-0 sm:w-auto sm:px-0">{pestanas}</div>}
          filtros={tab === "inventario" ? (
            <>
              <Select value={String(diasRot)} onValueChange={(v) => setDiasRot(Number(v))}>
                <SelectTrigger className="h-8 w-52 text-[13px]" aria-label="Ventana de rotación"><SelectValue /></SelectTrigger>
                <SelectContent>{[30, 60, 90, 180].map((d) => <SelectItem key={d} value={String(d)}>Rotación: ventas de {d} días</SelectItem>)}</SelectContent>
              </Select>
              <FiltrosLista filtros={fInv} resultados={invFiltrado.length} />
            </>
          ) : tab === "profit" || tab === "calidad" || (tab === "cobranza" && (subCobranza === "antiguedad" || subCobranza === "ventas-deuda")) ? null : selectorPeriodo}
          acciones={cargando ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            : <span className="text-[11px] text-muted-foreground">{tab === "calidad" ? "Bandeja de trabajo · Odoo manda"
              : tab === "cobranza" ? (subCobranza === "antiguedad" ? <>Saldos al corte · Odoo + notas de entrega</>
                : subCobranza === "ventas-deuda" ? <>Venta con IVA · Odoo + Profit · deuda neta al corte</> : <>USD a la tasa BCV del día · Odoo + Profit</>)
              : <>USD · neto de IVA · fuente {tab === "ventas" || tab === "analisis" ? FUENTES[fuente].replace("Solo ", "") : tab === "profit" ? "Profit (solo lectura)" : "Odoo"}</>}</span>} />

        <TabsContent value="ventas" className="mt-0">
          <KpiStrip items={[
            { label: "Venta neta", valor: formatPrice(totalVentas.neto),
              detalle: <span className="inline-flex items-center gap-1">{totalVentas.conProfit && <InsigniaProfit />}{textoVar(varVentas)}{!totalVentas.conProfit && prevConProfit ? " (con Profit)" : ""}</span>,
              tono: tonoVar(varVentas),
              titulo: `Facturas − notas de crédito, sin IVA ni saldos iniciales. Comparado con ${pdesde.split("-").reverse().join("/")} – ${phasta.split("-").reverse().join("/")} (${textoVar(varVentas)}) y con ${fechaCorta(comp.periodos[2][0])} – ${fechaCorta(comp.periodos[2][1])} (${textoVarAnio(varAnio)})` },
            { label: "Facturado", valor: formatPrice(totalVentas.bruto), detalle: <span className="inline-flex items-center gap-1">{totalVentas.conProfit && <InsigniaProfit />}{fmtN(totalVentas.docs)} facturas</span> },
            { label: "Notas de crédito", valor: formatPrice(totalVentas.nc), tono: totalVentas.nc < 0 ? "negativo" : "normal",
              detalle: totalVentas.conProfit ? <span className="inline-flex items-center gap-1"><InsigniaProfit />con devoluciones</span> : undefined },
            { label: "Clientes con compra", valor: fmtN(totalVentas.clientes), detalle: totalVentas.clientesProfit ? <InsigniaProfit /> : undefined },
            { label: "Ticket promedio", valor: formatPrice(totalVentas.ticket), detalle: <span className="inline-flex items-center gap-1">{totalVentas.conProfit && <InsigniaProfit />}por factura</span> },
            ...(Math.abs(totalVentas.financieras) > 0.004 ? [{ label: "Notas financieras", valor: formatPrice(totalVentas.financieras),
              detalle: <span className="inline-flex items-center gap-1"><InsigniaProfit />aparte de la venta</span>, tono: "tenue" as const,
              titulo: "Notas de crédito y débito de Profit (descuentos, acuerdos comerciales, ajustes de precio, anulaciones): no entran en la venta neta" }] : []),
          ]} />
          {totalVentas.conProfit && (
            <p className="-mt-1 mb-2 text-xs text-muted-foreground">
              <InsigniaProfit className="mr-1 align-[-2px]" />
              Incluye {formatPrice(totalVentas.profit)} del histórico de Profit (hasta may-2026, solo lectura): facturas − devoluciones; las notas
              financieras de Profit van aparte y las facturas anuladas con devolución total no cuentan.
            </p>
          )}
          {reversos.length > 0 && (
            <p className="-mt-1 mb-3 text-xs text-muted-foreground">
              No se cuentan {fmtN(reversos.length)} facturas anuladas por completo con su nota de crédito o devolución ({formatPrice(reversos.reduce((s, r) => s + num(r.neto_usd), 0))}).
              <Button variant="link" size="sm" className="h-auto px-1 py-0 text-xs" onClick={() => setVerReversos(true)}>Ver lista</Button>
            </p>
          )}
          <Panel sinPadding className="mb-3" titulo={<>Venta neta por mes <span className="font-normal text-muted-foreground">
            · {meses.length ? `${etiquetaMes(meses[0].clave)} – ${etiquetaMes(meses[meses.length - 1].clave)}` : "sin datos"}</span></>}>
            <GraficoVentas datos={meses.map((f) => ({ mes: f.clave, odoo: num(f.neto_usd) - num(f.profit_usd), profit: num(f.profit_usd) }))} formato={formatPrice} />
          </Panel>
          <div className="grid gap-3 xl:grid-cols-2">
            <Panel sinPadding titulo={<>Comparativo <span className="font-normal text-muted-foreground">· venta neta</span></>}>
              <Table containerClassName="max-h-none">
                <TableHeader><TableRow>
                  <TableHead>Período</TableHead>
                  <TableHead className="text-right">Venta neta</TableHead>
                  <TableHead className="text-right">Variación</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Facturas</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {([["Actual", comp.actual], [TEXTO_COMPARACION.anterior, comp.anterior], [TEXTO_COMPARACION.anio_anterior, comp.anio]] as [string, number][]).map(([nombre, valor], i) => (
                    <TableRow key={nombre}>
                      <TableCell className="py-1.5">
                        <span className="flex flex-wrap items-center gap-x-1.5">
                          <span className={i === 0 ? "font-medium" : ""}>{nombre}</span>
                          {Math.abs(comp.profit[i]) > 0.004 && <InsigniaProfit />}
                        </span>
                        <span className="block text-[11px] text-muted-foreground">{fechaCorta(comp.periodos[i][0])} – {fechaCorta(comp.periodos[i][1])}</span>
                      </TableCell>
                      <TableCell className={`whitespace-nowrap py-1.5 text-right tabular-nums ${i === 0 ? "font-semibold" : ""}`}>{formatPrice(valor)}</TableCell>
                      <TableCell className="py-1.5 text-right">{i === 0 ? <span className="text-muted-foreground">—</span> : <Variacion actual={comp.actual} previo={valor} formato={formatPrice} />}</TableCell>
                      <TableCell className="hidden whitespace-nowrap py-1.5 text-right tabular-nums md:table-cell">{fmtN(comp.facturas[i])}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">Variación = actual − período comparado (USD y %), con la misma definición de venta neta en los tres períodos. Las cifras con la insignia incluyen el histórico de Profit.</p>
            </Panel>
            <TablaReporte titulo={<>Comparativo por vendedor <span className="font-normal text-muted-foreground">· vs anterior y año anterior</span></>}
              filas={comparativo.vendedor} exportar="ventas-comparativo-vendedor" limite={8} columnas={[
                { clave: "etiqueta", titulo: "Vendedor", valor: (f) => f.etiqueta,
                  render: (f) => <span className="inline-flex max-w-full items-center gap-1.5"><span className="truncate">{f.etiqueta}</span>{f.fuente !== "odoo" && <InsigniaProfit />}</span> },
                { clave: "actual", titulo: "Actual", valor: (f) => num(f.actual_usd), render: (f) => formatPrice(num(f.actual_usd)), derecha: true },
                { clave: "anterior", titulo: "Anterior", valor: (f) => num(f.anterior_usd), render: (f) => formatPrice(num(f.anterior_usd)), derecha: true, ocultarMovil: true },
                { clave: "var_ant", titulo: "Var. %", valor: (f) => f.var_anterior_pct, render: (f) => <Variacion soloPct actual={num(f.actual_usd)} previo={num(f.anterior_usd)} formato={formatPrice} />, derecha: true },
                { clave: "anio", titulo: "Año ant.", valor: (f) => num(f.anio_anterior_usd), render: (f) => formatPrice(num(f.anio_anterior_usd)), derecha: true, ocultarMovil: true },
                { clave: "var_anio", titulo: "Var. % año", valor: (f) => f.var_anio_pct, render: (f) => <Variacion soloPct actual={num(f.actual_usd)} previo={num(f.anio_anterior_usd)} formato={formatPrice} />, derecha: true },
                { clave: "var_ant_usd", titulo: "Variación vs anterior (USD)", valor: (f) => num(f.var_anterior_usd), soloExportar: true },
                { clave: "var_anio_usd", titulo: "Variación vs año anterior (USD)", valor: (f) => num(f.var_anio_usd), soloExportar: true },
                { clave: "fuente", titulo: "Fuente", valor: (f) => textoFuente(f.fuente), soloExportar: true },
              ]} />
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            {soloLectura && (
              <TablaReporte titulo="Por empresa" filas={ventas.empresa ?? []} exportar="ventas-por-empresa" metrica={(f) => num(f.neto_usd)} columnas={[
                { clave: "etiqueta", titulo: "Empresa", valor: (f) => f.etiqueta, render: (f) => conInsignia(f.etiqueta, f) },
                { clave: "documentos", titulo: "Facturas", valor: (f) => num(f.documentos), derecha: true },
                { clave: "neto", titulo: "Venta neta", valor: (f) => num(f.neto_usd), render: (f) => formatPrice(num(f.neto_usd)), derecha: true },
                ...columnasFuente,
                { clave: "financieras", titulo: "Notas financieras Profit (aparte)", valor: (f) => num(f.financieras_usd), soloExportar: true },
              ]} />
            )}
            <TablaReporte titulo="Por vendedor" filas={ventas.vendedor ?? []} exportar="ventas-por-vendedor" metrica={(f) => num(f.neto_usd)} columnas={[
              { clave: "etiqueta", titulo: "Vendedor", valor: (f) => f.etiqueta, render: (f) => conInsignia(f.etiqueta, f) },
              { clave: "documentos", titulo: "Facturas", valor: (f) => num(f.documentos), derecha: true },
              { clave: "clientes", titulo: "Clientes", valor: (f) => num(f.clientes), derecha: true, secundaria: true },
              { clave: "nc", titulo: "NC", valor: (f) => num(f.nc_usd), render: (f) => formatPrice(num(f.nc_usd)), derecha: true, ocultarMovil: true },
              { clave: "neto", titulo: "Venta neta", valor: (f) => num(f.neto_usd), render: (f) => formatPrice(num(f.neto_usd)), derecha: true },
              ...columnasFuente,
              { clave: "financieras", titulo: "Notas financieras Profit (aparte)", valor: (f) => num(f.financieras_usd), soloExportar: true },
            ]} />
            <TablaReporte titulo="Por categoría" filas={ventas.categoria ?? []} exportar="ventas-por-categoria" metrica={(f) => num(f.neto_usd)} columnas={[
              { clave: "etiqueta", titulo: "Categoría", valor: (f) => f.etiqueta.trim(), render: (f) => conInsignia(f.etiqueta.trim(), f) },
              { clave: "detalle", titulo: "Productos", valor: (f) => f.detalle, secundaria: true },
              { clave: "cantidad", titulo: "Unidades", valor: (f) => num(f.cantidad), render: (f) => fmtN(f.cantidad), derecha: true },
              { clave: "neto", titulo: "Venta neta", valor: (f) => num(f.neto_usd), render: (f) => formatPrice(num(f.neto_usd)), derecha: true },
              ...columnasFuente,
            ]} />
            <TablaReporte titulo="Top clientes" filas={ventas.cliente ?? []} exportar="ventas-por-cliente" metrica={(f) => num(f.neto_usd)} columnas={[
              { clave: "etiqueta", titulo: "Cliente", valor: (f) => f.etiqueta, render: (f) => conInsignia(f.etiqueta, f) },
              { clave: "detalle", titulo: "RIF · ciudad", valor: (f) => f.detalle, secundaria: true },
              { clave: "documentos", titulo: "Facturas", valor: (f) => num(f.documentos), derecha: true },
              { clave: "neto", titulo: "Venta neta", valor: (f) => num(f.neto_usd), render: (f) => formatPrice(num(f.neto_usd)), derecha: true },
              ...columnasFuente,
              { clave: "financieras", titulo: "Notas financieras Profit (aparte)", valor: (f) => num(f.financieras_usd), soloExportar: true },
            ]} />
            <TablaReporte titulo="Top productos" filas={ventas.producto ?? []} exportar="ventas-por-producto" metrica={(f) => num(f.neto_usd)} columnas={[
              { clave: "etiqueta", titulo: "Producto", valor: (f) => f.etiqueta, render: (f) => conInsignia(f.etiqueta, f) },
              { clave: "detalle", titulo: "SKU", valor: (f) => f.detalle, render: (f) => <span className="font-mono text-xs">{f.detalle}</span>, secundaria: true },
              { clave: "cantidad", titulo: "Unidades", valor: (f) => num(f.cantidad), render: (f) => fmtN(f.cantidad), derecha: true },
              { clave: "neto", titulo: "Venta neta", valor: (f) => num(f.neto_usd), render: (f) => formatPrice(num(f.neto_usd)), derecha: true },
              ...columnasFuente,
            ]} />
          </div>
          <Dialog open={verReversos} onOpenChange={setVerReversos}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
              <DialogHeader>
                <DialogTitle>Facturas anuladas por completo</DialogTitle>
                <DialogDescription>Factura y nota de crédito (o devolución total en Profit) por el mismo monto: se excluyen ambas de la venta, lo facturado y el ticket.</DialogDescription>
              </DialogHeader>
              <TablaReporte titulo={`${fmtN(reversos.length)} pares`} filas={reversos} exportar="facturas-anuladas" limite={50} columnas={[
                { clave: "empresa", titulo: "Empresa", valor: (f) => f.empresa, secundaria: true },
                { clave: "cliente", titulo: "Cliente", valor: (f) => f.cliente,
                  render: (f) => <span className="inline-flex max-w-full items-center gap-1.5"><span className="truncate">{f.cliente}</span>{f.fuente === "profit" && <InsigniaProfit />}</span> },
                { clave: "factura", titulo: "Factura", valor: (f) => f.factura, render: (f) => <span className="whitespace-nowrap">{f.factura} <span className="text-muted-foreground">· {f.factura_fecha.split("-").reverse().join("/")}</span></span> },
                { clave: "nota", titulo: "Nota de crédito", valor: (f) => f.nota, render: (f) => <span className="whitespace-nowrap">{f.nota} <span className="text-muted-foreground">· {f.nota_fecha.split("-").reverse().join("/")}</span></span>, ocultarMovil: true },
                { clave: "motivo", titulo: "Motivo", valor: (f) => f.motivo || "—", ocultarMovil: true },
                { clave: "neto", titulo: "Neto", valor: (f) => num(f.neto_usd), render: (f) => formatPrice(num(f.neto_usd)), derecha: true },
                { clave: "fuente", titulo: "Fuente", valor: (f) => textoFuente(f.fuente), soloExportar: true },
              ]} />
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="analisis" className="mt-0">
          {tab === "analisis" && <AnalisisVentas desde={desde} hasta={hasta} fuente={fuente} onCargando={setCargando} />}
        </TabsContent>

        <TabsContent value="metas" className="mt-0">
          {tab === "metas" && <MetasVendedores desde={desde} hasta={hasta} onCargando={setCargando} />}
        </TabsContent>

        <TabsContent value="cobranza" className="mt-0">
          <div className="mb-2 inline-flex max-w-full overflow-x-auto rounded-md border border-border bg-muted p-0.5 text-[13px] [scrollbar-width:none]" role="tablist" aria-label="Vista de cobranza">
            {SUB_COBRANZA.map(([k, t]) => (
              <button key={k} type="button" role="tab" aria-selected={subCobranza === k} onClick={() => cambiarSubCobranza(k)} data-testid={`cobranza-vista-${k}`}
                className={cn("shrink-0 whitespace-nowrap rounded-sm px-2.5 py-1 font-medium", subCobranza === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>{t}</button>
            ))}
          </div>
          {subCobranza === "ventas-deuda" ? (veDeuda ? (
            <VentasDeuda ambas={soloLectura} recarga={seleccion} empresas={empresaActiva?.nombre_corto ?? empresas.map((e) => e.nombre_corto).join(" y ")} />
          ) : (
            <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground" data-testid="ventas-deuda-sin-cuentas">
              Ventas vs deuda muestra la deuda de cada cliente: necesitas también el permiso de Cuentas.
            </p>
          )) : subCobranza === "antiguedad" ? (veDeuda ? (
            <Antiguedad ambas={soloLectura} recarga={seleccion} empresas={empresaActiva?.nombre_corto ?? empresas.map((e) => e.nombre_corto).join(" y ")} />
          ) : (
            <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground" data-testid="antiguedad-sin-cuentas">
              La antigüedad muestra la deuda de cada cliente: necesitas también el permiso de Cuentas.
            </p>
          )) : subCobranza === "cobrado" ? (
            <LoCobrado desde={desde} hasta={hasta} veDeuda={veDeuda} ambas={soloLectura} recarga={seleccion}
              empresas={empresaActiva?.nombre_corto ?? empresas.map((e) => e.nombre_corto).join(" y ")} />
          ) : (<>
          <KpiStrip items={[
            { label: "Cobrado", valor: formatPrice(totalCobros.monto), detalle: textoVar(varCobros), tono: tonoVar(varCobros),
              titulo: "Cobros que cuentan (sin IGTF), en USD a la tasa BCV del día de cada cobro. Antes del 1-may-2026, recibos de Profit" },
            { label: "Cobros", valor: fmtN(totalCobros.cobros) },
            { label: "Clientes que pagaron", valor: fmtN(totalCobros.clientes) },
            { label: "Cobro promedio", valor: formatPrice(totalCobros.cobros ? totalCobros.monto / totalCobros.cobros : 0) },
            { label: "Venta neta del período", valor: formatPrice(totalVentas.neto), tono: "tenue", titulo: "Abre la pestaña Ventas para actualizarla" },
          ]} />
          <Panel sinPadding className="mb-3" titulo="Cobrado por mes (últimos 12 meses)">
            <GraficoMeses datos={mesesCobro.map((f) => ({ mes: f.clave, valor: num(f.monto_usd) }))} formato={formatPrice} />
          </Panel>
          <div className="grid gap-3 xl:grid-cols-2">
            {soloLectura && (
              <TablaReporte titulo="Por empresa" filas={cobros.empresa ?? []} exportar="cobranza-por-empresa" metrica={(f) => num(f.monto_usd)} columnas={[
                { clave: "etiqueta", titulo: "Empresa", valor: (f) => f.etiqueta },
                { clave: "cobros", titulo: "Cobros", valor: (f) => num(f.cobros), derecha: true },
                { clave: "monto", titulo: "Cobrado", valor: (f) => num(f.monto_usd), render: (f) => formatPrice(num(f.monto_usd)), derecha: true },
              ]} />
            )}
            <TablaReporte titulo="Por banco o caja" filas={cobros.banco ?? []} exportar="cobranza-por-banco" metrica={(f) => num(f.monto_usd)} columnas={[
              { clave: "etiqueta", titulo: "Banco", valor: (f) => f.etiqueta },
              { clave: "detalle", titulo: "Moneda", valor: (f) => f.detalle, render: (f) => f.detalle ? <Badge variant="outline">{f.detalle === "USD" ? "USD" : "Bs."}</Badge> : "—" },
              { clave: "cobros", titulo: "Cobros", valor: (f) => num(f.cobros), derecha: true },
              { clave: "monto", titulo: "Cobrado (USD)", valor: (f) => num(f.monto_usd), render: (f) => formatPrice(num(f.monto_usd)), derecha: true },
            ]} />
            <TablaReporte titulo="Por vendedor del cliente" filas={cobros.vendedor ?? []} exportar="cobranza-por-vendedor" metrica={(f) => num(f.monto_usd)} columnas={[
              { clave: "etiqueta", titulo: "Vendedor", valor: (f) => f.etiqueta },
              { clave: "clientes", titulo: "Clientes", valor: (f) => num(f.clientes), derecha: true },
              { clave: "cobros", titulo: "Cobros", valor: (f) => num(f.cobros), derecha: true },
              { clave: "monto", titulo: "Cobrado", valor: (f) => num(f.monto_usd), render: (f) => formatPrice(num(f.monto_usd)), derecha: true },
            ]} />
            {veDeuda && (
              <TablaReporte titulo="Top clientes que pagaron" filas={cobros.cliente ?? []} exportar="cobranza-por-cliente" metrica={(f) => num(f.monto_usd)} columnas={[
                { clave: "etiqueta", titulo: "Cliente", valor: (f) => f.etiqueta },
                { clave: "detalle", titulo: "RIF · ciudad", valor: (f) => f.detalle, secundaria: true },
                { clave: "cobros", titulo: "Cobros", valor: (f) => num(f.cobros), derecha: true },
                { clave: "monto", titulo: "Cobrado", valor: (f) => num(f.monto_usd), render: (f) => formatPrice(num(f.monto_usd)), derecha: true },
              ]} />
            )}
          </div>
          {/* 21b (agente F2-3): DSO y mora por vendedor y por cliente. Muestra deuda por cliente: solo con el permiso de Cuentas */}
          {veDeuda && <CobranzaDso />}
          </>)}
        </TabsContent>

        <TabsContent value="inventario" className="mt-0">
          <KpiStrip items={[
            { label: "Productos almacenables", valor: fmtN(invStats.total), tono: "primario", onClick: () => fInv.set("situacion", ""), activo: !filtroInv },
            { label: "Sin disponible", valor: fmtN(invStats.sinDisponible), tono: invStats.sinDisponible ? "negativo" : "normal", onClick: () => setFiltroInv("sin_disponible"), activo: filtroInv === "sin_disponible" },
            { label: "Riesgo de quiebre", valor: fmtN(invStats.quiebre), detalle: "cobertura menor a 15 días", tono: invStats.quiebre ? "alerta" : "normal", onClick: () => setFiltroInv("quiebre"), activo: filtroInv === "quiebre" },
            { label: "Inmovilizado", valor: fmtN(invStats.inmovilizado), detalle: `con existencia y sin ventas en ${diasRot} días`, tono: invStats.inmovilizado ? "alerta" : "normal", onClick: () => setFiltroInv("inmovilizado"), activo: filtroInv === "inmovilizado" },
            { label: `Vendido en ${diasRot} días`, valor: formatPrice(invStats.vendido), tono: "positivo" },
          ]} />
          <div className="grid gap-3 xl:grid-cols-3">
            <TablaReporte className="xl:col-span-1" titulo="Por categoría" filas={porCategoria} exportar="inventario-por-categoria" metrica={(f) => f.usd} limite={15} columnas={[
              { clave: "categoria", titulo: "Categoría", valor: (f) => f.categoria.trim() },
              { clave: "productos", titulo: "Prod.", valor: (f) => f.productos, derecha: true },
              { clave: "disponible", titulo: "Disponible", valor: (f) => f.disponible, render: (f) => fmtN(f.disponible), derecha: true },
            ]} />
            <Panel sinPadding className="xl:col-span-2" titulo={<>Rotación por producto <span className="font-normal text-muted-foreground">· cobertura = disponible ÷ venta diaria de {diasRot} días</span></>}
              acciones={<div className="flex items-center gap-1.5">
                <Input value={qInv} onChange={(e) => setQInv(e.target.value)} placeholder="Buscar producto..." className="h-7 w-44 text-[13px]" />
                <BotonExportar soloIcono total={invOrden.length} onClick={() => exportarCSV("rotacion-inventario", invOrden, [
                  { titulo: "SKU", valor: (f) => f.sku }, { titulo: "Producto", valor: (f) => f.nombre }, { titulo: "Categoría", valor: (f) => f.categoria },
                  { titulo: "Existencia", valor: (f) => num(f.existencia) }, { titulo: "Comprometido", valor: (f) => num(f.comprometido) }, { titulo: "Disponible", valor: (f) => num(f.disponible) },
                  { titulo: `Vendido ${diasRot} días (u)`, valor: (f) => num(f.vendido_unidades) }, { titulo: `Vendido ${diasRot} días (USD)`, valor: (f) => num(f.vendido_usd) },
                  { titulo: "Última venta", valor: (f) => f.ultima_venta }, { titulo: "Cobertura (días)", valor: (f) => f.cobertura_dias },
                ])} />
              </div>}>
              <Table>
                <TableHeader><TableRow>
                  <EncabezadoOrdenable clave="nombre" orden={ordenInv} onOrdenar={alternarInv}>Producto</EncabezadoOrdenable>
                  <EncabezadoOrdenable clave="disponible" orden={ordenInv} onOrdenar={alternarInv} alinear="derecha">Disponible</EncabezadoOrdenable>
                  <EncabezadoOrdenable clave="vendido" orden={ordenInv} onOrdenar={alternarInv} alinear="derecha">Vendido (u)</EncabezadoOrdenable>
                  <EncabezadoOrdenable clave="usd" orden={ordenInv} onOrdenar={alternarInv} alinear="derecha" className="hidden md:table-cell">Vendido</EncabezadoOrdenable>
                  <EncabezadoOrdenable clave="ultima" orden={ordenInv} onOrdenar={alternarInv} className="hidden lg:table-cell">Última venta</EncabezadoOrdenable>
                  <EncabezadoOrdenable clave="cobertura" orden={ordenInv} onOrdenar={alternarInv} alinear="derecha">Cobertura</EncabezadoOrdenable>
                </TableRow></TableHeader>
                <TableBody>
                  {pgInv.pageItems.map((f) => {
                    const cob = f.cobertura_dias === null ? null : num(f.cobertura_dias);
                    return (
                      <TableRow key={f.producto_id}>
                        <TableCell className="max-w-[320px] truncate font-medium" title={`${f.sku} · ${f.nombre}`}><span className="mr-1.5 font-mono text-xs text-muted-foreground">{f.sku}</span>{f.nombre}</TableCell>
                        <TableCell className={`whitespace-nowrap text-right font-semibold ${num(f.disponible) <= 0 ? "text-destructive" : ""}`}>{fmtN(f.disponible)}</TableCell>
                        <TableCell className="whitespace-nowrap text-right">{fmtN(f.vendido_unidades)}</TableCell>
                        <TableCell className="hidden whitespace-nowrap text-right md:table-cell">{formatPrice(num(f.vendido_usd))}</TableCell>
                        <TableCell className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">{f.ultima_venta ? f.ultima_venta.split("-").reverse().join("/") : "—"}</TableCell>
                        <TableCell className="whitespace-nowrap text-right">
                          {cob === null ? <span className="text-xs text-muted-foreground">{num(f.existencia) > 0 ? "Sin ventas" : "—"}</span>
                            : <Badge variant={cob < 15 ? "destructive" : cob < 45 ? "secondary" : "outline"}>{fmtN(cob)} días</Badge>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <DataTablePagination pagination={pgInv} />
            </Panel>
          </div>
        </TabsContent>

        <TabsContent value="profit" className="mt-0">
          <HistoricoProfit />
        </TabsContent>

        <TabsContent value="calidad" className="mt-0">
          {tab === "calidad" && (veDeuda
            ? <CalidadDatos onCargando={setCargando} />
            : <p className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground" data-testid="calidad-sin-permiso">
                Calidad y cuadre muestra datos por cliente: necesitas también el permiso de Cuentas.
              </p>)}
        </TabsContent>
      </Tabs>
    </MainLayout>
  );
};

export default Reportes;
