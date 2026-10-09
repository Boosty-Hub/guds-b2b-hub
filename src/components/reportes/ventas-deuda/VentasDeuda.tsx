import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { Panel } from "@/components/datos/FichaCampos";
import { BotonExcel } from "@/components/datos/BotonExcel";
import { Segmentado } from "@/components/datos/Segmentado";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { fmtUsd } from "@/components/estado-cuenta/formato";
import { fechaDMA, hoyCaracas } from "@/lib/fechas";
import { cn } from "@/lib/utils";
import {
  AGRUPAR, ESTADO, REGLA, agrupar, corteDefecto, cortesDisponibles, diasConjunto, etiquetaMes, filasDe, formulaFila, formulaTotal, mesesEntre,
  type Agrupar, type DatosVentasDeuda, type Fila, type Grupo,
} from "./datos";
import { libroVentasDeuda } from "./excelVentasDeuda";

// Reportes → Cobranza → Ventas vs deuda (22h · R4 del plan de reportes de finanzas): venta mensual con IVA por cliente (Profit +
// Odoo) frente a su deuda neta, con los días de recuperación oficiales (D6) y su explicación a la vista. Exige reportes y cuentas.

type Vista = "meses" | "resumen";
type FiltroEstado = "todos" | "deuda" | "lentos" | "recuperacion" | "activos" | "inactivos";
type Orden = "deuda" | "dias" | "venta" | "nombre";
const FILTROS: { clave: FiltroEstado; texto: string }[] = [
  { clave: "todos", texto: "Todos los clientes" }, { clave: "deuda", texto: "Con deuda" },
  { clave: "lentos", texto: "Recuperación lenta" }, { clave: "recuperacion", texto: "Con deuda y sin compras" },
  { clave: "activos", texto: "Activos" }, { clave: "inactivos", texto: "Inactivos" },
];
const pasa = (f: Fila, e: FiltroEstado) => e === "todos" || (e === "deuda" ? f.deuda > 0.009 : e === "lentos" ? f.lento
  : e === "recuperacion" ? f.estado === "recuperacion" : e === "activos" ? f.estado === "activo" : f.estado === "inactivo");
const ESTILO_ESTADO: Record<Fila["estado"], string> = {
  activo: "border-success/40 text-success", inactivo: "border-border text-muted-foreground",
  recuperacion: "border-destructive/40 text-destructive", sin_ventas: "border-border text-muted-foreground",
};

export function VentasDeuda({ ambas, empresas, recarga }: { ambas: boolean; empresas: string; recarga: string }) {
  const [params, setParams] = useSearchParams();
  const hoy = hoyCaracas();
  const cortes = useMemo(() => cortesDisponibles(hoy), [hoy]);
  const corte = cortes.some((c) => c.fecha === params.get("corte")) ? params.get("corte")! : corteDefecto(hoy);
  const meses = [12, 24, 36, 0].includes(Number(params.get("meses") ?? "12")) ? Number(params.get("meses") ?? "12") : 12;
  const conNe = params.get("ne") !== "0";
  const activoMeses = [3, 4, 6, 12].includes(Number(params.get("activo"))) ? Number(params.get("activo")) : 4;
  const estado: FiltroEstado = FILTROS.find((x) => x.clave === params.get("estado"))?.clave ?? "todos";
  const por: Agrupar = AGRUPAR.find((a) => a.clave === params.get("agrupar"))?.clave ?? "cliente";
  // En el teléfono arranca en "solo resumen" (la deuda y los días a la vista); en pantalla grande, con los meses
  const vistaDefecto: Vista = useMemo(() => (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches ? "resumen" : "meses"), []);
  const vista: Vista = params.get("vista") === "resumen" || params.get("vista") === "meses" ? (params.get("vista") as Vista) : vistaDefecto;
  const orden: Orden = (["dias", "venta", "nombre"] as const).find((o) => o === params.get("orden")) ?? "deuda";
  const enUrl = (clave: string, valor: string | null) =>
    setParams((prev) => { const n = new URLSearchParams(prev); if (valor == null) n.delete(clave); else n.set(clave, valor); return n; }, { replace: true });

  const [datos, setDatos] = useState<DatosVentasDeuda | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    let vivo = true;
    setCargando(true); setError(null);
    supabase.rpc("reporte_ventas_vs_deuda", { p_corte: corte, p_meses: meses, p_ne: conNe }).then(({ data, error: e }) => {
      if (!vivo) return;
      if (e) setError(e.message); else setDatos(data as DatosVentasDeuda);
      setCargando(false);
    });
    return () => { vivo = false; };
  }, [corte, meses, conNe, recarga]);

  const todas = useMemo(() => (datos ? filasDe(datos, activoMeses) : []), [datos, activoMeses]);
  const listaMeses = useMemo(() => (datos ? mesesEntre(datos.desde, datos.corte) : []), [datos]);
  const total = useMemo(() => diasConjunto(todas), [todas]);
  const kpi = useMemo(() => ({
    v12: todas.reduce((s, f) => s + Number(f.v12 ?? 0), 0),
    lentos: todas.filter((f) => f.lento).length,
    recuperacion: todas.filter((f) => f.estado === "recuperacion" && f.cl !== "incobrable" && f.deuda > 1).length,
    deudaRec: todas.filter((f) => f.estado === "recuperacion").reduce((s, f) => s + f.deuda, 0),
    activos: todas.filter((f) => f.estado === "activo").length,
    inactivosDeuda: todas.filter((f) => f.estado === "inactivo" && f.deuda > 0.009).length,
    ne: todas.reduce((s, f) => s + Number(f.ne ?? 0), 0),
  }), [todas]);

  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase();
    const xs = todas.filter((f) => pasa(f, estado) && (!t || `${f.n} ${f.rif ?? ""} ${f.cod ?? ""} ${f.v ?? ""}`.toLowerCase().includes(t)));
    const cmp: Record<Orden, (a: Fila, b: Fila) => number> = {
      deuda: (a, b) => b.deuda - a.deuda || Number(b.v12 ?? 0) - Number(a.v12 ?? 0),
      dias: (a, b) => (b.deuda > 0.009 ? b.dias ?? 99999 : -1) - (a.deuda > 0.009 ? a.dias ?? 99999 : -1),
      venta: (a, b) => Number(b.v12 ?? 0) - Number(a.v12 ?? 0),
      nombre: (a, b) => a.n.localeCompare(b.n),
    };
    return xs.sort(cmp[orden]);
  }, [todas, estado, q, orden]);
  const totFiltro = useMemo(() => diasConjunto(filtradas), [filtradas]);
  const grupos = useMemo(() => (por === "cliente" ? [] : agrupar(filtradas, por)), [filtradas, por]);
  const pg = usePagination(filtradas, 50, `${estado}|${q}|${orden}|${corte}|${meses}|${conNe}`);
  const verMeses = vista === "meses";
  const sumaMes = (m: string) => filtradas.reduce((s, f) => s + Number(f.ventas?.[m] ?? 0), 0);
  const libro = () => (datos ? libroVentasDeuda({ datos, filas: todas, meses: listaMeses, activoMeses, empresas, ambas }) : null);

  if (error) return <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" data-testid="vd-error">No se pudo cargar ventas vs deuda: {error}</p>;

  const celdaUsd = (v: number | undefined | null, fuerte = false, k?: string) => (
    <TableCell key={k} className={cn("whitespace-nowrap py-1.5 text-right tabular-nums", fuerte && "font-semibold")}>{v && Math.abs(v) >= 0.005 ? fmtUsd(v) : ""}</TableCell>
  );
  const textoDias = (f: Pick<Fila, "deuda" | "dias">) => (f.deuda <= 0.009 ? "—" : f.dias == null ? "Sin compras" : `${f.dias} d`);

  return (
    <div data-testid="ventas-deuda">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Select value={corte} onValueChange={(v) => enUrl("corte", v === corteDefecto(hoy) ? null : v)}>
          <SelectTrigger className="h-7 w-56 text-[12px]" aria-label="Corte" data-testid="vd-corte"><SelectValue /></SelectTrigger>
          <SelectContent>{cortes.map((c) => <SelectItem key={c.fecha} value={c.fecha}>{c.texto}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={String(meses)} onValueChange={(v) => enUrl("meses", v === "12" ? null : v)}>
          <SelectTrigger className="h-7 w-44 text-[12px]" aria-label="Meses de la matriz" data-testid="vd-meses"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="12">Últimos 12 meses</SelectItem><SelectItem value="24">Últimos 24 meses</SelectItem>
            <SelectItem value="36">Últimos 36 meses</SelectItem><SelectItem value="0">Desde dic-2020</SelectItem>
          </SelectContent>
        </Select>
        <Select value={String(activoMeses)} onValueChange={(v) => enUrl("activo", v === "4" ? null : v)}>
          <SelectTrigger className="h-7 w-56 text-[12px]" aria-label="Cliente activo si compró en" data-testid="vd-activo"><SelectValue /></SelectTrigger>
          <SelectContent>{[3, 4, 6, 12].map((n) => <SelectItem key={n} value={String(n)}>Activo: compró en los últimos {n} meses</SelectItem>)}</SelectContent>
        </Select>
        {datos?.ve_ne && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Switch checked={conNe} onCheckedChange={(v) => enUrl("ne", v ? null : "0")} aria-label="Incluir notas de entrega en la deuda y en la venta" data-testid="vd-ne" />
            Notas de entrega (deuda y venta)
          </label>
        )}
      </div>

      <KpiStrip items={[
        { label: "Venta 12 meses", valor: cargando ? "…" : fmtUsd(kpi.v12), detalle: "con IVA · Profit + Odoo" },
        { label: "Promedio mensual", valor: cargando ? "…" : fmtUsd(total.promedio), titulo: "Suma de la venta promedio mensual de cada cliente (12 meses, o desde su primera compra)" },
        { label: "Deuda neta", valor: cargando ? "…" : fmtUsd(total.deuda), detalle: kpi.ne > 0.009 ? `incluye ${fmtUsd(kpi.ne)} de N/E` : undefined, tono: "primario" },
        { label: "Días de recuperación", valor: cargando ? "…" : total.dias == null ? "—" : `${total.dias} días`, tono: total.dias != null && datos && total.dias > datos.umbral ? "alerta" : "normal",
          titulo: formulaTotal(total) },
        { label: `Más de ${datos?.umbral ?? 90} días`, valor: cargando ? "…" : kpi.lentos, tono: kpi.lentos ? "alerta" : "tenue",
          onClick: () => enUrl("estado", estado === "lentos" ? null : "lentos"), activo: estado === "lentos", titulo: "Recuperación lenta (sin contar los incobrables)" },
        { label: "Con deuda y sin compras", valor: cargando ? "…" : kpi.recuperacion, detalle: kpi.deudaRec > 0.009 ? fmtUsd(kpi.deudaRec) : undefined, tono: kpi.recuperacion ? "negativo" : "tenue",
          onClick: () => enUrl("estado", estado === "recuperacion" ? null : "recuperacion"), activo: estado === "recuperacion",
          titulo: "En recuperación: deben y no compraron en 12 meses (sin contar los incobrables)" },
        { label: "Activos", valor: cargando ? "…" : kpi.activos, detalle: `${kpi.inactivosDeuda} inactivos con deuda`, tono: "tenue",
          onClick: () => enUrl("estado", estado === "activos" ? null : "activos"), activo: estado === "activos" },
      ]} />
      <div className="-mt-1 mb-3 space-y-0.5 text-xs text-muted-foreground" data-testid="vd-regla">
        <p><span className="font-semibold text-foreground">Días de recuperación</span> = deuda neta al {datos ? fechaDMA(datos.corte) : "corte"} ÷ venta promedio mensual de los últimos 12 meses (con IVA, Profit + Odoo) × 30.
          Deuda neta = facturas y ND − NC a favor − anticipos{datos?.ne ? " + notas de entrega" : ""}. Cliente nuevo: los meses desde su primera compra. {datos?.ne ? "Las notas de entrega cuentan como venta (sin IVA) por lo que no pasó a factura." : "Sin notas de entrega: ni en la deuda ni en la venta."}</p>
        {!cargando && <p data-testid="vd-formula-total">Total: {formulaTotal(total)}.</p>}
      </div>

      <Panel sinPadding titulo={<>{por === "cliente" ? "Por cliente" : `Por ${AGRUPAR.find((a) => a.clave === por)?.texto.toLowerCase()}`} <span className="font-normal text-muted-foreground">· venta con IVA por mes</span></>}
        acciones={<BotonExcel libro={libro} disabled={cargando || !datos} size="sm" className="h-7 gap-1.5 text-xs" data-testid="vd-excel" />}>
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <Select value={por} onValueChange={(v) => enUrl("agrupar", v === "cliente" ? null : v)}>
            <SelectTrigger className="h-7 w-40 text-[12px]" aria-label="Agrupar por" data-testid="vd-agrupar"><SelectValue /></SelectTrigger>
            <SelectContent>{AGRUPAR.filter((a) => a.clave !== "empresa" || ambas).map((a) => <SelectItem key={a.clave} value={a.clave}>{a.texto}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={estado} onValueChange={(v) => enUrl("estado", v === "todos" ? null : v)}>
            <SelectTrigger className="h-7 w-48 text-[12px]" aria-label="Qué clientes" data-testid="vd-estado"><SelectValue /></SelectTrigger>
            <SelectContent>{FILTROS.map((x) => <SelectItem key={x.clave} value={x.clave}>{x.texto}</SelectItem>)}</SelectContent>
          </Select>
          <Segmentado<Vista> etiqueta="Columnas" valor={vista} onCambio={(v) => enUrl("vista", v === vistaDefecto ? null : v)} testId="vd-vista"
            opciones={[{ clave: "meses", texto: "Meses y resumen" }, { clave: "resumen", texto: "Solo resumen" }]} />
          {por === "cliente" && (
            <Select value={orden} onValueChange={(v) => enUrl("orden", v === "deuda" ? null : v)}>
              <SelectTrigger className="h-7 w-48 text-[12px]" aria-label="Ordenar" data-testid="vd-orden"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="deuda">Mayor deuda neta</SelectItem><SelectItem value="dias">Más días de recuperación</SelectItem>
                <SelectItem value="venta">Mayor venta 12 meses</SelectItem><SelectItem value="nombre">Nombre</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cliente, RIF, vendedor…" className="h-7 w-48 text-[13px] sm:ml-auto" aria-label="Buscar clientes" />
        </div>
        {cargando ? (
          <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Cargando…</p>
        ) : por !== "cliente" ? (
          <Table data-testid="vd-grupos">
            <TableHeader><TableRow>
              <TableHead className="sticky left-0 z-[2] min-w-[140px] bg-card [background-image:linear-gradient(hsl(var(--muted)/0.8),hsl(var(--muted)/0.8))]">{AGRUPAR.find((a) => a.clave === por)?.texto}</TableHead>
              <TableHead className="text-right">Clientes</TableHead>
              {verMeses && listaMeses.map((m) => <TableHead key={m} className="whitespace-nowrap text-right">{etiquetaMes(m)}</TableHead>)}
              <TableHead className="whitespace-nowrap text-right">Venta 12 m</TableHead>
              <TableHead className="whitespace-nowrap text-right">Prom. mensual</TableHead>
              <TableHead className="whitespace-nowrap text-right">Deuda neta</TableHead>
              <TableHead className="whitespace-nowrap text-right">Días</TableHead>
              <TableHead className="whitespace-nowrap text-right" title={`Clientes con más de ${datos?.umbral ?? 90} días`}>Lentos</TableHead>
              <TableHead className="whitespace-nowrap text-right" title="Con deuda y sin compras en 12 meses">Sin compras</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {grupos.map((g: Grupo) => (
                <TableRow key={g.clave} data-testid="vd-grupo">
                  <TableCell className="sticky left-0 z-[1] max-w-[160px] truncate bg-card py-1.5 font-medium sm:max-w-[260px]" title={g.etiqueta}>{g.etiqueta}</TableCell>
                  <TableCell className="py-1.5 text-right tabular-nums">{g.clientes}</TableCell>
                  {verMeses && listaMeses.map((m) => <TableCell key={m} className="whitespace-nowrap py-1.5 text-right tabular-nums">{g.ventas[m] && Math.abs(g.ventas[m]) >= 0.005 ? fmtUsd(g.ventas[m]) : ""}</TableCell>)}
                  {celdaUsd(g.v12)}{celdaUsd(g.promedio)}{celdaUsd(g.deuda, true)}
                  <TableCell className={cn("whitespace-nowrap py-1.5 text-right font-semibold tabular-nums", datos && g.dias != null && g.dias > datos.umbral && "text-destructive")}
                    title={formulaTotal(g)}>{textoDias(g)}</TableCell>
                  <TableCell className="py-1.5 text-right tabular-nums">{g.lentos || ""}</TableCell>
                  <TableCell className="py-1.5 text-right tabular-nums">{g.recuperacion || ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <>
            <Table data-testid="vd-tabla">
              <TableHeader><TableRow>
                <TableHead className="sticky left-0 z-[2] min-w-[150px] bg-card sm:min-w-[220px] [background-image:linear-gradient(hsl(var(--muted)/0.8),hsl(var(--muted)/0.8))]">Cliente</TableHead>
                {verMeses && listaMeses.map((m) => <TableHead key={m} className="whitespace-nowrap text-right">{etiquetaMes(m)}</TableHead>)}
                {verMeses && <TableHead className="whitespace-nowrap text-right">Total</TableHead>}
                <TableHead className="whitespace-nowrap text-right" title="Venta con IVA de los últimos 12 meses">Venta 12 m</TableHead>
                <TableHead className="whitespace-nowrap text-right" title="Venta de 12 meses ÷ 12 (o ÷ los meses desde la primera compra)">Prom. mensual</TableHead>
                <TableHead className="hidden whitespace-nowrap text-right xl:table-cell" title="Venta de los últimos 5 meses ÷ 5">Prom. 5 m</TableHead>
                <TableHead className="hidden whitespace-nowrap text-right lg:table-cell" title="Venta de los últimos 3 meses">Compra 90 d</TableHead>
                <TableHead className="whitespace-nowrap text-right">Deuda neta</TableHead>
                <TableHead className="whitespace-nowrap text-right" title={REGLA}>Días</TableHead>
                <TableHead className="hidden whitespace-nowrap text-right xl:table-cell" title="Deuda neta ÷ compra de 90 días">Deuda/compra 90 d</TableHead>
                <TableHead className="hidden whitespace-nowrap text-right xl:table-cell" title="Retenciones, IVA o IGTF por cobrar ÷ deuda neta">% impuesto</TableHead>
                <TableHead className="hidden md:table-cell">Estado</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {pg.pageItems.map((f) => (
                  <TableRow key={f.k} data-testid="vd-fila">
                    <TableCell className="sticky left-0 z-[1] max-w-[160px] bg-card py-1.5 sm:max-w-[300px]">
                      <span className="flex min-w-0 items-center gap-1.5">
                        {f.id ? <Link to={`/admin/cuentas/${f.id}`} className="truncate font-medium hover:underline" title={f.n}>{f.n}</Link>
                          : <span className="truncate font-medium" title={f.n}>{f.n}</span>}
                        {ambas && <Badge variant="outline" className="h-4 shrink-0 px-1 text-[10px]">{f.empresa}</Badge>}
                        {f.sf && <Badge variant="secondary" className="h-4 shrink-0 px-1 text-[10px]" title={f.k.startsWith("ne:") ? "Nota de entrega de un cliente sin ficha en GUDS" : "Cliente del histórico de Profit sin ficha en GUDS"}>{f.k.startsWith("ne:") ? "N/E" : "Profit"}</Badge>}
                        {f.cl === "incobrable" && <Badge variant="destructive" className="h-4 shrink-0 px-1 text-[10px]">Incobrable</Badge>}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        <span className="md:hidden">{ESTADO[f.estado]} · </span>{[f.tipo, f.v].filter(Boolean).join(" · ") || (f.rif ?? "")}
                        {Number(f.m12 ?? 12) < 12 && f.promedio > 0 ? ` · nuevo: ${f.m12} ${f.m12 === 1 ? "mes" : "meses"}` : ""}
                      </span>
                    </TableCell>
                    {verMeses && listaMeses.map((m) => <TableCell key={m} className="whitespace-nowrap py-1.5 text-right tabular-nums">{f.ventas?.[m] && Math.abs(f.ventas[m]) >= 0.005 ? fmtUsd(f.ventas[m]) : ""}</TableCell>)}
                    {verMeses && celdaUsd(Number(f.tot ?? 0), true)}
                    {celdaUsd(Number(f.v12 ?? 0))}{celdaUsd(f.promedio)}
                    <TableCell className="hidden whitespace-nowrap py-1.5 text-right tabular-nums xl:table-cell">{f.v5 ? fmtUsd(Number(f.v5) / 5) : ""}</TableCell>
                    <TableCell className="hidden whitespace-nowrap py-1.5 text-right tabular-nums lg:table-cell">{f.c90 ? fmtUsd(Number(f.c90)) : ""}</TableCell>
                    {celdaUsd(f.deuda, true)}
                    <TableCell className={cn("whitespace-nowrap py-1.5 text-right font-semibold tabular-nums", (f.lento || (f.estado === "recuperacion" && f.cl !== "incobrable")) && "text-destructive")}
                      title={formulaFila(f)} data-testid="vd-dias">{textoDias(f)}</TableCell>
                    <TableCell className="hidden whitespace-nowrap py-1.5 text-right tabular-nums text-muted-foreground xl:table-cell">{f.deudaSobreCompra == null ? "" : `${Math.round(f.deudaSobreCompra * 100)} %`}</TableCell>
                    <TableCell className="hidden whitespace-nowrap py-1.5 text-right tabular-nums text-muted-foreground xl:table-cell">{f.pctImpuesto == null ? "" : `${(f.pctImpuesto * 100).toLocaleString("es-VE", { maximumFractionDigits: 1 })} %`}</TableCell>
                    <TableCell className="hidden py-1.5 md:table-cell"><Badge variant="outline" className={cn("whitespace-nowrap text-[10px]", ESTILO_ESTADO[f.estado])}>{ESTADO[f.estado]}</Badge></TableCell>
                  </TableRow>
                ))}
                {!pg.pageItems.length && <TableRow><TableCell colSpan={20} className="py-6 text-center text-sm text-muted-foreground">Ningún cliente con este filtro.</TableCell></TableRow>}
                {filtradas.length > 0 && (
                  <TableRow className="bg-muted/40 font-semibold" data-testid="vd-total">
                    <TableCell className="sticky left-0 z-[1] bg-card py-1.5 [background-image:linear-gradient(hsl(var(--muted)/0.4),hsl(var(--muted)/0.4))]">Total ({filtradas.length.toLocaleString("es-VE")})</TableCell>
                    {verMeses && listaMeses.map((m) => celdaUsd(sumaMes(m), false, m))}
                    {verMeses && celdaUsd(filtradas.reduce((s, f) => s + Number(f.tot ?? 0), 0))}
                    {celdaUsd(filtradas.reduce((s, f) => s + Number(f.v12 ?? 0), 0))}{celdaUsd(totFiltro.promedio)}
                    <TableCell className="hidden xl:table-cell" /><TableCell className="hidden lg:table-cell" />
                    {celdaUsd(totFiltro.deuda)}
                    <TableCell className="whitespace-nowrap py-1.5 text-right tabular-nums" title={formulaTotal(totFiltro)}>{textoDias(totFiltro)}</TableCell>
                    <TableCell className="hidden xl:table-cell" /><TableCell className="hidden xl:table-cell" /><TableCell className="hidden md:table-cell" />
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <DataTablePagination pagination={pg} />
          </>
        )}
      </Panel>
    </div>
  );
}
