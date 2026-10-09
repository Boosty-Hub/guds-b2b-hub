import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Loader2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { Panel } from "@/components/datos/FichaCampos";
import { BotonExcel } from "@/components/datos/BotonExcel";
import { Segmentado } from "@/components/datos/Segmentado";
import { SelectorCorte } from "@/components/datos/SelectorCorte";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { useCorteUrl } from "@/hooks/useCorteUrl";
import { fmtUsd } from "@/components/estado-cuenta/formato";
import { fechaDMA } from "@/lib/fechas";
import { cn } from "@/lib/utils";
import {
  AGRUPAR, CLASIFICACION, ORDEN_PARTIDA, PARTIDA, TIPO_DOC, agrupar, etiquetaTramo, filasDe, fmtPct, grupoDe, indicadores, pct,
  sumaColumnas, tramosDe, type Agrupar, type Base, type DatosAntiguedad, type Fila, type Grupo, type Partida, type Tramo,
} from "./datos";
import { libroAntiguedad } from "./excelAntiguedad";

// Reportes → Cobranza → Antigüedad (22g · R3 del plan de reportes de finanzas): el "Análisis de vencimiento" de finanzas
// dentro de GUDS. Saldos al corte de todas las partidas abiertas (facturas, ND, NC a favor, anticipos de Odoo y de GUDS y,
// con el interruptor, las notas de entrega no fiscales), agrupados y por tramos de días. Exige reportes y cuentas (D10).

type Columnas = "tramos" | "anios";
type FiltroClasif = "todas" | "activa" | "incobrable";

const tonoTramo: Record<Tramo, string> = {
  por_vencer: "text-success", t30: "text-foreground", t60: "text-warning", t90: "text-warning", t90mas: "text-destructive",
};

export function Antiguedad({ ambas, empresas, recarga }: {
  /** Modo «Ambas»: insignia y columna de empresa */
  ambas: boolean;
  /** Nombre de las empresas visibles, para el Excel */
  empresas: string;
  /** Cambia al cambiar la empresa: vuelve a cargar */
  recarga: string;
}) {
  const [params, setParams] = useSearchParams();
  const [corte, setCorte, cortePasado] = useCorteUrl();
  const base: Base = params.get("base") === "emision" ? "emision" : "vencimiento";
  const conNe = params.get("ne") !== "0";
  const clasif: FiltroClasif = (["activa", "incobrable"] as const).find((c) => c === params.get("clasif")) ?? "todas";
  const por: Agrupar = AGRUPAR.find((a) => a.clave === params.get("agrupar"))?.clave ?? "anio";
  const columnas: Columnas = params.get("columnas") === "anios" ? "anios" : "tramos";
  const enUrl = (clave: string, valor: string | null) => {
    setParams((prev) => { const n = new URLSearchParams(prev); if (valor == null) n.delete(clave); else n.set(clave, valor); return n; }, { replace: true });
  };

  const [datos, setDatos] = useState<DatosAntiguedad | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [qMatriz, setQMatriz] = useState("");
  const [verTodas, setVerTodas] = useState(false);
  const [sel, setSel] = useState<{ por: Agrupar; clave: string; etiqueta: string } | null>(null);
  const [q, setQ] = useState("");
  const [fPartida, setFPartida] = useState<Partida | "todas">("todas");
  const [fTramo, setFTramo] = useState<Tramo | "todos">("todos");

  useEffect(() => {
    let vivo = true;
    setCargando(true); setError(null);
    supabase.rpc("reporte_antiguedad", { p_corte: corte, p_ne: conNe }).then(({ data, error: e }) => {
      if (!vivo) return;
      if (e) setError(e.message); else setDatos(data as DatosAntiguedad);
      setCargando(false);
    });
    return () => { vivo = false; };
  }, [corte, conNe, recarga]);

  const todas = useMemo(() => (datos ? filasDe(datos, base) : []), [datos, base]);
  const filas = useMemo(() => (clasif === "todas" ? todas : todas.filter((f) => f.p.cl === clasif)), [todas, clasif]);
  const kpi = useMemo(() => indicadores(filas), [filas]);
  const nNe = useMemo(() => filas.filter((f) => f.p.t === "nota_entrega").length, [filas]);
  const nIncobrables = useMemo(() => new Set(todas.filter((f) => f.p.cl === "incobrable").map((f) => f.p.c ?? f.cliente)).size, [todas]);

  // ── Matriz ──
  const cols: string[] = useMemo(() => (columnas === "tramos" ? tramosDe(base) : [...new Set(filas.map((f) => f.anio))].sort()), [columnas, base, filas]);
  const columna = (f: Fila) => (columnas === "tramos" ? f.tramo : f.anio);
  const grupos = useMemo(() => {
    const t = qMatriz.trim().toLowerCase();
    const g = agrupar(filas, por, columnas === "tramos" ? (f) => f.tramo : (f) => f.anio);
    return t ? g.filter((x) => `${x.etiqueta} ${x.detalle ?? ""}`.toLowerCase().includes(t)) : g;
  }, [filas, por, columnas, qMatriz]);
  const total = useMemo(() => sumaColumnas(agrupar(filas, por, columna), cols), [filas, por, cols]);   // eslint-disable-line react-hooks/exhaustive-deps
  const limite = por === "cliente" ? 25 : 50;
  const visibles = verTodas ? grupos : grupos.slice(0, limite);
  const etiquetaCol = (k: string) => (columnas === "tramos" ? etiquetaTramo(k as Tramo, base) : k);

  // ── Top 10 y por tipo de partida ──
  const top10 = useMemo(() => agrupar(filas, "cliente", (f) => f.tramo).filter((g) => g.total > 0.009).slice(0, 10), [filas]);
  const porPartida = useMemo(() => agrupar(filas, "partida", (f) => f.tramo), [filas]);

  // ── Detalle ──
  const detalle = useMemo(() => {
    const t = q.trim().toLowerCase();
    return filas.filter((f) => (!sel || grupoDe(f, sel.por).clave === sel.clave)
      && (fPartida === "todas" || f.partida === fPartida) && (fTramo === "todos" || f.tramo === fTramo)
      && (!t || `${f.cliente} ${f.rif} ${f.p.n} ${f.vendedor} ${f.p.f ?? ""}`.toLowerCase().includes(t)))
      .sort((a, b) => a.cliente.localeCompare(b.cliente) || a.p.em.localeCompare(b.p.em) || a.p.n.localeCompare(b.p.n));
  }, [filas, sel, fPartida, fTramo, q]);
  const sumaDetalle = useMemo(() => detalle.reduce((s, f) => s + f.saldo, 0), [detalle]);
  const pg = usePagination(detalle, 25, `${sel?.clave}|${fPartida}|${fTramo}|${q}|${corte}|${base}|${clasif}`);

  const elegir = (g: Grupo) => {
    setSel(sel && sel.por === por && sel.clave === g.clave ? null : { por, clave: g.clave, etiqueta: `${AGRUPAR.find((a) => a.clave === por)?.texto}: ${g.etiqueta}` });
    requestAnimationFrame(() => document.getElementById("antiguedad-detalle")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const libro = () => (datos ? libroAntiguedad({ datos, filas, base, clasif, empresas, ambas }) : null);

  if (error) return <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" data-testid="antiguedad-error">No se pudo cargar la antigüedad: {error}</p>;

  const celdaGrupo = (g: Grupo): ReactNode => {
    const c = por === "cliente" && datos && !g.clave.startsWith("sin:") ? datos.clientes[g.clave] : undefined;
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        {c ? <Link to={`/admin/cuentas/${g.clave}`} className="truncate hover:underline" title={g.etiqueta} onClick={(e) => e.stopPropagation()}>{g.etiqueta}</Link>
          : <span className="truncate" title={g.etiqueta}>{g.etiqueta}</span>}
        {ambas && g.empresa && ["cliente", "vendedor", "vendedor_cliente"].includes(por) && <Badge variant="outline" className="h-4 shrink-0 px-1 text-[10px]">{g.empresa}</Badge>}
        {c?.cl === "incobrable" && <Badge variant="destructive" className="h-4 shrink-0 px-1 text-[10px]" title={[c.resp, c.nota].filter(Boolean).join(" · ") || undefined}>Incobrable</Badge>}
        {por === "partida" && g.clave === "ne" && <Badge variant="secondary" className="h-4 shrink-0 px-1 text-[10px]">No fiscal</Badge>}
      </span>
    );
  };
  const fmtCelda = (v: number | undefined) => (v && Math.abs(v) >= 0.005 ? fmtUsd(v) : "");

  return (
    <div data-testid="antiguedad">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <SelectorCorte valor={corte} onCambio={setCorte} />
        <Segmentado<Base> etiqueta="Días desde" valor={base} onCambio={(v) => enUrl("base", v === "vencimiento" ? null : v)} testId="antiguedad-base"
          opciones={[{ clave: "vencimiento", texto: "Desde el vencimiento" }, { clave: "emision", texto: "Desde la emisión" }]} />
        <Select value={clasif} onValueChange={(v) => enUrl("clasif", v === "todas" ? null : v)}>
          <SelectTrigger className="h-7 w-40 text-[12px]" aria-label="Clasificación de la deuda" data-testid="antiguedad-clasif"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Activa e incobrable</SelectItem>
            <SelectItem value="activa">Solo deuda activa</SelectItem>
            <SelectItem value="incobrable">Solo incobrable</SelectItem>
          </SelectContent>
        </Select>
        {datos?.ve_ne && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Switch checked={conNe} onCheckedChange={(v) => enUrl("ne", v ? null : "0")} aria-label="Incluir notas de entrega" data-testid="antiguedad-ne" />
            Notas de entrega
          </label>
        )}
      </div>

      <KpiStrip items={[
        { label: "Deuda", valor: cargando ? "…" : fmtUsd(kpi.deuda), titulo: "Facturas y notas de débito con saldo al corte (fiscal)" },
        { label: "A favor", valor: cargando ? "…" : fmtUsd(-kpi.aFavor), tono: kpi.aFavor > 0.009 ? "positivo" : "tenue",
          detalle: kpi.aFavor > 0.009 ? `NC ${fmtUsd(kpi.nc)} · anticipos ${fmtUsd(kpi.anticipos)}` : undefined,
          titulo: "Notas de crédito sin aplicar y cobros sin aplicar a una factura (de Odoo y de GUDS)" },
        { label: "Deuda neta", valor: cargando ? "…" : fmtUsd(kpi.fiscalNeto), tono: "primario", titulo: "Deuda − a favor (fiscal, sin notas de entrega)" },
        { label: "Vencida", valor: cargando ? "…" : fmtUsd(kpi.vencido), detalle: `${fmtPct(pct(kpi.vencido, kpi.positivos))} de la deuda`,
          tono: kpi.vencido > 0.009 ? "alerta" : "tenue", titulo: base === "vencimiento" ? "Saldo con más de 0 días desde el vencimiento" : "Saldo con más de 0 días desde la emisión" },
        { label: "Más de 90 días", valor: cargando ? "…" : fmtUsd(kpi.mas90), tono: kpi.mas90 > 0.009 ? "negativo" : "tenue" },
        { label: "Incobrable", valor: cargando ? "…" : fmtUsd(kpi.incobrable), tono: kpi.incobrable > 0.009 ? "negativo" : "tenue",
          detalle: nIncobrables ? `${nIncobrables} clientes` : undefined, titulo: "Casos con abogados o cobranza externa (gestión de cobranza). No baja el saldo",
          onClick: () => enUrl("clasif", clasif === "incobrable" ? null : "incobrable"), activo: clasif === "incobrable" },
        ...(datos?.ne && nNe > 0 ? [{ label: "Notas de entrega", valor: cargando ? "…" : fmtUsd(kpi.ne), detalle: `${nNe} · no fiscal`, tono: "tenue" as const,
          titulo: "Deuda interna de notas de entrega no fiscales (no está en Odoo; en el estado de cuenta, solo si se marca «Incluir notas de entrega»)" }] : []),
      ]} />
      <div className="-mt-1 mb-3 space-y-0.5 text-xs text-muted-foreground" data-testid="antiguedad-notas">
        <p>Saldos al {fechaDMA(corte)}{cortePasado ? " (lo aplicado después del corte vuelve al saldo)" : ""}, los mismos del estado de cuenta. Días desde el {base === "vencimiento" ? "vencimiento" : "la emisión"}; el año es el de emisión.
          Las notas de crédito y los anticipos restan.</p>
        {datos?.ne && nNe > 0 && <p>Incluye {nNe} notas de entrega no fiscales ({fmtUsd(kpi.ne)}): deuda interna, aparte del estado de cuenta del cliente.</p>}
        {cortePasado && <p>La clasificación activa / incobrable es la de hoy.</p>}
      </div>

      <Panel sinPadding titulo={<>Por {AGRUPAR.find((a) => a.clave === por)?.texto.toLowerCase()} <span className="font-normal text-muted-foreground">· {columnas === "tramos" ? "por tramos de días" : "por año de emisión"}</span></>}
        acciones={<BotonExcel libro={libro} disabled={cargando || !datos} size="sm" className="h-7 gap-1.5 text-xs" data-testid="antiguedad-excel" />}>
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <Select value={por} onValueChange={(v) => { enUrl("agrupar", v === "anio" ? null : v); setVerTodas(false); setQMatriz(""); }}>
            <SelectTrigger className="h-7 w-48 text-[12px]" aria-label="Agrupar por" data-testid="antiguedad-agrupar"><SelectValue /></SelectTrigger>
            <SelectContent>{AGRUPAR.filter((a) => a.clave !== "empresa" || ambas).map((a) => <SelectItem key={a.clave} value={a.clave}>{a.texto}</SelectItem>)}</SelectContent>
          </Select>
          <Segmentado<Columnas> etiqueta="Columnas" valor={columnas} onCambio={(v) => enUrl("columnas", v === "tramos" ? null : v)} testId="antiguedad-columnas"
            opciones={[{ clave: "tramos", texto: "Tramos" }, { clave: "anios", texto: "Años" }]} />
          {grupos.length > 10 || qMatriz ? (
            <Input value={qMatriz} onChange={(e) => setQMatriz(e.target.value)} placeholder="Buscar…" className="h-7 w-40 text-[13px] sm:ml-auto" aria-label="Buscar en la matriz" />
          ) : null}
        </div>
        {cargando ? (
          <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Cargando…</p>
        ) : !grupos.length ? (
          <p className="p-4 text-sm text-muted-foreground">Sin partidas abiertas al corte.</p>
        ) : (
          <Table data-testid="antiguedad-matriz">
            <TableHeader><TableRow>
              <TableHead className="sticky left-0 z-[2] min-w-[140px] bg-card sm:min-w-[200px] [background-image:linear-gradient(hsl(var(--muted)/0.8),hsl(var(--muted)/0.8))]">{AGRUPAR.find((a) => a.clave === por)?.texto}</TableHead>
              {cols.map((k) => <TableHead key={k} className="whitespace-nowrap text-right">{etiquetaCol(k)}</TableHead>)}
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="whitespace-nowrap text-right" title="Parte del total (neto) de este grupo">% del total</TableHead>
              <TableHead className="whitespace-nowrap text-right" title="Saldo vencido ÷ deuda del grupo">% vencido</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {visibles.map((g) => (
                <TableRow key={g.clave} data-testid="antiguedad-fila" onClick={() => elegir(g)}
                  className={cn("cursor-pointer", sel?.por === por && sel.clave === g.clave && "bg-primary/5")} title="Ver sus partidas">
                  <TableCell className="sticky left-0 z-[1] max-w-[150px] bg-card py-1.5 font-medium sm:max-w-[300px]">{celdaGrupo(g)}</TableCell>
                  {cols.map((k) => <TableCell key={k} className="whitespace-nowrap py-1.5 text-right tabular-nums">{fmtCelda(g.columnas[k])}</TableCell>)}
                  <TableCell className="whitespace-nowrap py-1.5 text-right font-semibold tabular-nums">{fmtUsd(g.total)}</TableCell>
                  <TableCell className="whitespace-nowrap py-1.5 text-right tabular-nums text-muted-foreground">{fmtPct(pct(g.total, total.total))}</TableCell>
                  <TableCell className="whitespace-nowrap py-1.5 text-right tabular-nums text-muted-foreground">{fmtPct(pct(g.vencido, g.deuda))}</TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/40 font-semibold" data-testid="antiguedad-total">
                <TableCell className="sticky left-0 z-[1] bg-card py-1.5 [background-image:linear-gradient(hsl(var(--muted)/0.4),hsl(var(--muted)/0.4))]">Total</TableCell>
                {cols.map((k) => <TableCell key={k} className="whitespace-nowrap py-1.5 text-right tabular-nums">{fmtCelda(total.columnas[k])}</TableCell>)}
                <TableCell className="whitespace-nowrap py-1.5 text-right tabular-nums">{fmtUsd(total.total)}</TableCell>
                <TableCell className="py-1.5 text-right tabular-nums">{fmtPct(total.total ? 1 : null)}</TableCell>
                <TableCell className="whitespace-nowrap py-1.5 text-right tabular-nums">{fmtPct(pct(total.vencido, total.deuda))}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
        {grupos.length > limite && (
          <div className="border-t border-border px-3 py-1.5 text-right">
            <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setVerTodas((v) => !v)}>
              {verTodas ? `Ver solo las primeras ${limite}` : `Ver las ${grupos.length} filas`}
            </Button>
          </div>
        )}
      </Panel>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel sinPadding titulo="Top 10 clientes con mayor deuda">
          <Table data-testid="antiguedad-top">
            <TableHeader><TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Vencido</TableHead>
              <TableHead className="text-right">Saldo</TableHead>
              <TableHead className="hidden text-right md:table-cell">% del total</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {top10.map((g) => {
                const c = datos?.clientes[g.clave];
                return (
                  <TableRow key={g.clave} data-testid="antiguedad-top-fila">
                    <TableCell className="max-w-[220px] py-1.5 sm:max-w-[320px]">
                      <span className="flex min-w-0 items-center gap-1.5">
                        {c ? <Link to={`/admin/cuentas/${g.clave}`} className="truncate font-medium hover:underline" title={g.etiqueta}>{g.etiqueta}</Link>
                          : <span className="truncate font-medium" title={g.etiqueta}>{g.etiqueta}</span>}
                        {ambas && g.empresa && <Badge variant="outline" className="h-4 shrink-0 px-1 text-[10px]">{g.empresa}</Badge>}
                        {c?.cl === "incobrable" && <Badge variant="destructive" className="h-4 shrink-0 px-1 text-[10px]">Incobrable</Badge>}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {[g.detalle, c?.tipo, c?.v, c?.edc ? `estado de cuenta enviado el ${fechaDMA(c.edc)}` : null].filter(Boolean).join(" · ")}
                      </span>
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap py-1.5 text-right tabular-nums sm:table-cell">{fmtUsd(g.vencido)}</TableCell>
                    <TableCell className="whitespace-nowrap py-1.5 text-right font-semibold tabular-nums">{fmtUsd(g.total)}</TableCell>
                    <TableCell className="hidden whitespace-nowrap py-1.5 text-right tabular-nums text-muted-foreground md:table-cell">{fmtPct(pct(g.total, kpi.neto))}</TableCell>
                  </TableRow>
                );
              })}
              {!cargando && !top10.length && <TableRow><TableCell colSpan={4} className="py-4 text-center text-sm text-muted-foreground">Ningún cliente con deuda.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </Panel>
        <Panel sinPadding titulo="Por tipo de partida">
          <Table data-testid="antiguedad-partidas">
            <TableHeader><TableRow>
              <TableHead>Partida</TableHead>
              <TableHead className="text-right">Partidas</TableHead>
              <TableHead className="text-right">Saldo</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {porPartida.map((g) => (
                <TableRow key={g.clave} className="cursor-pointer" onClick={() => { setFPartida(g.clave as Partida); setSel(null); document.getElementById("antiguedad-detalle")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>
                  <TableCell className="py-1.5">
                    <span className="font-medium">{g.etiqueta}</span>
                    <span className="block text-[11px] text-muted-foreground">{PARTIDA[g.clave as Partida]?.ayuda}</span>
                  </TableCell>
                  <TableCell className="py-1.5 text-right tabular-nums">{g.partidas.toLocaleString("es-VE")}</TableCell>
                  <TableCell className="whitespace-nowrap py-1.5 text-right font-semibold tabular-nums">{fmtUsd(g.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      </div>

      <Panel sinPadding className="scroll-mt-24" titulo={<>Partidas <span className="font-normal text-muted-foreground">· {detalle.length.toLocaleString("es-VE")} · {fmtUsd(sumaDetalle)}</span></>}>
        <div id="antiguedad-detalle" />
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cliente, RIF, número…" className="h-7 min-w-0 flex-1 text-[13px] sm:max-w-xs" aria-label="Buscar partidas" />
          <Select value={fPartida} onValueChange={(v) => setFPartida(v as Partida | "todas")}>
            <SelectTrigger className="h-7 w-44 text-[12px]" aria-label="Tipo de partida"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas las partidas</SelectItem>
              {ORDEN_PARTIDA.map((k) => <SelectItem key={k} value={k}>{PARTIDA[k].texto}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={fTramo} onValueChange={(v) => setFTramo(v as Tramo | "todos")}>
            <SelectTrigger className="h-7 w-36 text-[12px]" aria-label="Tramo"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los tramos</SelectItem>
              {tramosDe(base).map((k) => <SelectItem key={k} value={k}>{etiquetaTramo(k, base)}</SelectItem>)}
            </SelectContent>
          </Select>
          {sel && (
            <Badge variant="secondary" className="h-7 gap-1 pr-1 text-[12px] font-normal" data-testid="antiguedad-filtro">
              <span className="max-w-[220px] truncate">{sel.etiqueta}</span>
              <button type="button" onClick={() => setSel(null)} aria-label="Quitar filtro" className="rounded p-0.5 hover:bg-background"><X className="h-3 w-3" /></button>
            </Badge>
          )}
        </div>
        <Table data-testid="antiguedad-detalle">
          <TableHeader><TableRow>
            <TableHead>Cliente</TableHead>
            <TableHead className="hidden sm:table-cell">Documento</TableHead>
            <TableHead className="hidden md:table-cell">Emisión</TableHead>
            <TableHead className="hidden md:table-cell">Vence</TableHead>
            <TableHead className="text-right">Días</TableHead>
            <TableHead className="hidden lg:table-cell">Partida</TableHead>
            <TableHead className="text-right">Saldo</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {pg.pageItems.map((f) => {
              const doc = `${TIPO_DOC[f.p.t]} ${f.p.n}`;
              const enlaceDoc = f.p.t === "nota_entrega" ? `/admin/notas-entrega/${f.p.id}` : f.p.t === "anticipo" ? null : `/admin/facturas/${f.p.id}`;
              return (
                <TableRow key={f.clave} data-testid="antiguedad-partida" data-tipo={f.p.t}>
                  <TableCell className="max-w-[180px] py-1.5 sm:max-w-[280px]">
                    <span className="flex min-w-0 items-center gap-1.5">
                      {f.p.c ? <Link to={`/admin/cuentas/${f.p.c}`} className="truncate font-medium hover:underline" title={f.cliente}>{f.cliente}</Link>
                        : <span className="truncate font-medium" title={f.cliente}>{f.cliente}</span>}
                      {f.p.cl === "incobrable" && <Badge variant="destructive" className="h-4 shrink-0 px-1 text-[10px]" title={f.p.co === "documento" ? "Marcado así este documento" : "Cliente incobrable"}>Incobrable</Badge>}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      <span className="sm:hidden">{doc} · </span>
                      {[ambas ? f.empresa : null, f.p.f ?? (f.partida !== "cartera" ? PARTIDA[f.partida].texto : null), f.vendedor].filter(Boolean).join(" · ")}
                    </span>
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap py-1.5 sm:table-cell">
                    {enlaceDoc ? <Link to={enlaceDoc} className="hover:underline">{doc}</Link> : doc}
                    {!f.fiscal && <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">No fiscal</Badge>}
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap py-1.5 md:table-cell">{fechaDMA(f.p.em)}</TableCell>
                  <TableCell className="hidden whitespace-nowrap py-1.5 md:table-cell">{fechaDMA(f.p.ve)}</TableCell>
                  <TableCell className={cn("whitespace-nowrap py-1.5 text-right tabular-nums", tonoTramo[f.tramo])} title={etiquetaTramo(f.tramo, base)}>{f.dias.toLocaleString("es-VE")}</TableCell>
                  <TableCell className="hidden whitespace-nowrap py-1.5 lg:table-cell"><span className="text-[12px]">{PARTIDA[f.partida].texto}</span></TableCell>
                  <TableCell className={cn("whitespace-nowrap py-1.5 text-right font-semibold tabular-nums", f.saldo < 0 && "text-success")}>{fmtUsd(f.saldo)}</TableCell>
                </TableRow>
              );
            })}
            {!cargando && !pg.pageItems.length && <TableRow><TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">Sin partidas con este filtro.</TableCell></TableRow>}
          </TableBody>
        </Table>
        <DataTablePagination pagination={pg} />
      </Panel>
      <p className="mt-1 text-[11px] text-muted-foreground">{CLASIFICACION.incobrable}: se marca por cliente o por documento en el detalle de la cuenta (Gestión de cobranza). No baja el saldo.</p>
    </div>
  );
}
