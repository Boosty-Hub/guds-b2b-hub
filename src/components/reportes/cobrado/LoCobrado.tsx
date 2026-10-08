import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { Panel } from "@/components/datos/FichaCampos";
import { BotonExcel } from "@/components/datos/BotonExcel";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { fmtBs, fmtTasa, fmtUsd } from "@/components/estado-cuenta/formato";
import { fechaDMA } from "@/lib/fechas";
import { cn } from "@/lib/utils";
import {
  ESTADO_COBRO, FUENTE_COBRO, TEXTO_TASA, etiquetaMes, mesesDe, num, pivotar, totalesPorMes,
  type CeldaCobro, type Cobro, type FilaMatriz,
} from "./datos";
import { libroLoCobrado } from "./excelLoCobrado";

// Reportes → Cobranza → Lo cobrado (22f · R2 del plan de reportes de finanzas): el libro de cobros de finanzas dentro de GUDS.
// Fuente única en la base (cobros_unificados): Odoo desde su arranque y, antes, los recibos de Profit del Excel de finanzas.
// USD = monto ÷ tasa BCV del día del cobro (D1). Lo que no cuenta (anulados, borradores, IGTF, saldos iniciales) se ve aparte.
// Con el permiso de Cuentas se ven además el detalle y la matriz por cliente (traen clientes; la base también lo exige).

type Vista = "diario" | "moneda" | "cliente" | "vendedor";
type Medida = "usd" | "moneda";
const VISTAS: { clave: Vista; texto: string; cuentas?: boolean }[] = [
  { clave: "diario", texto: "Diario" }, { clave: "moneda", texto: "Moneda" },
  { clave: "cliente", texto: "Cliente", cuentas: true }, { clave: "vendedor", texto: "Vendedor" },
];
type FiltroDetalle = "vigentes" | "no_cuentan" | "todos";

function Segmentado<T extends string>({ valor, opciones, onCambio, etiqueta }: {
  valor: T; opciones: { clave: T; texto: string }[]; onCambio: (v: T) => void; etiqueta: string;
}) {
  return (
    <div className="inline-flex rounded-md border border-border bg-muted p-0.5 text-[12px]" role="tablist" aria-label={etiqueta}>
      {opciones.map((o) => (
        <button key={o.clave} type="button" role="tab" aria-selected={valor === o.clave} onClick={() => onCambio(o.clave)}
          className={cn("rounded-sm px-2 py-0.5 font-medium", valor === o.clave ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
          {o.texto}
        </button>
      ))}
    </div>
  );
}

// Montos en Bs muy largos (cientos de millones) en el indicador: en millones, con el monto completo al pasar el ratón
const bsCorto = (v: number) => (Math.abs(v) >= 1e8 ? `Bs ${(v / 1e6).toLocaleString("es-VE", { maximumFractionDigits: Math.abs(v) >= 1e9 ? 0 : 1 })} millones` : fmtBs(v));

const MarcaP = ({ c }: { c: Pick<Cobro, "tasa_origen"> }) =>
  c.tasa_origen === "profit" ? <sup className="ml-0.5 text-[10px] font-semibold text-warning" title={TEXTO_TASA.profit}>P</sup> : null;

export function LoCobrado({ desde, hasta, veDeuda, ambas, empresas, recarga }: {
  desde: string; hasta: string;
  /** Permiso de Cuentas: detalle y matriz por cliente */
  veDeuda: boolean;
  /** Modo «Ambas»: columna de empresa */
  ambas: boolean;
  /** Nombre de las empresas visibles, para el Excel */
  empresas: string;
  /** Cambia al cambiar la empresa: vuelve a cargar */
  recarga: string;
}) {
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [m, setM] = useState<{ diario: CeldaCobro[]; moneda: CeldaCobro[]; vendedor: CeldaCobro[]; estado: CeldaCobro[]; fuente: CeldaCobro[]; cliente: CeldaCobro[] | null }>(
    { diario: [], moneda: [], vendedor: [], estado: [], fuente: [], cliente: null });
  const [detalle, setDetalle] = useState<Cobro[] | null>(null);
  const [vista, setVista] = useState<Vista>("diario");
  const [medida, setMedida] = useState<Medida>("usd");
  const [verTodas, setVerTodas] = useState(false);
  const [qMatriz, setQMatriz] = useState("");
  const [filtro, setFiltro] = useState<FiltroDetalle>("vigentes");
  const [q, setQ] = useState("");

  useEffect(() => {
    let vivo = true;
    setCargando(true); setError(null);
    // Todas las matrices en una llamada (la base calcula los cobros una sola vez) y, con Cuentas, el detalle
    const grupos = ["diario", "moneda", "vendedor", "estado", "fuente", ...(veDeuda ? ["cliente"] : [])];
    (async () => {
      try {
        const [celdas, det] = await Promise.all([
          supabase.rpc("reporte_cobranza_matrices", { p_desde: desde, p_hasta: hasta, p_filas: grupos })
            .then(({ data, error: e }) => { if (e) throw e; return (data ?? []) as (CeldaCobro & { agrupacion: string })[]; }),
          veDeuda ? supabase.rpc("reporte_cobros_detalle", { p_desde: desde, p_hasta: hasta }).then(({ data, error: e }) => { if (e) throw e; return (data ?? []) as Cobro[]; })
            : Promise.resolve(null),
        ]);
        if (!vivo) return;
        const de = (g: string) => celdas.filter((c) => c.agrupacion === g);
        setM({ diario: de("diario"), moneda: de("moneda"), vendedor: de("vendedor"), estado: de("estado"), fuente: de("fuente"), cliente: veDeuda ? de("cliente") : null });
        setDetalle(det);
      } catch (e) {
        if (vivo) setError((e as Error).message);
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => { vivo = false; };
  }, [desde, hasta, veDeuda, recarga]);

  const meses = useMemo(() => mesesDe(desde, hasta), [desde, hasta]);

  // ── Indicadores ──
  const kpi = useMemo(() => {
    const porMoneda = pivotar(m.moneda, "moneda");
    const vig = m.estado.filter((c) => c.fila === "vigente");
    const fuera = m.estado.filter((c) => c.fila !== "vigente");
    return {
      usd: vig.reduce((s, c) => s + num(c.usd), 0),
      cobros: vig.reduce((s, c) => s + num(c.cobros), 0),
      bs: porMoneda.find((f) => f.moneda === "BS"), divisas: porMoneda.find((f) => f.moneda === "USD"),
      fueraN: fuera.reduce((s, c) => s + num(c.cobros), 0), fueraUsd: fuera.reduce((s, c) => s + num(c.usd), 0),
      saldoInicial: fuera.filter((c) => c.fila === "saldo_inicial"),
    };
  }, [m]);
  const deProfit = useMemo(() => { const p = m.fuente.filter((c) => c.fila === "profit"); return { n: p.reduce((s, c) => s + num(c.cobros), 0), usd: p.reduce((s, c) => s + num(c.usd), 0) }; }, [m.fuente]);
  const conTasaProfit = useMemo(() => (detalle ?? []).some((c) => c.estado === "vigente" && c.tasa_origen === "profit"), [detalle]);
  const siN = kpi.saldoInicial.reduce((s, c) => s + num(c.cobros), 0), siUsd = kpi.saldoInicial.reduce((s, c) => s + num(c.usd), 0);

  // ── Matriz ──
  const vistaEf: Vista = vista === "cliente" && !m.cliente ? "diario" : vista;
  const medidaEf: Medida = vistaEf === "vendedor" ? "usd" : medida;
  const celdas = useMemo(() => (vistaEf === "cliente" ? m.cliente ?? [] : m[vistaEf]), [m, vistaEf]);
  const filasMatriz = useMemo(() => {
    const t = qMatriz.trim().toLowerCase();
    const todas = pivotar(celdas, medidaEf);
    return t ? todas.filter((f) => `${f.etiqueta} ${f.detalle ?? ""} ${f.empresa ?? ""}`.toLowerCase().includes(t)) : todas;
  }, [celdas, medidaEf, qMatriz]);
  const limite = vistaEf === "cliente" ? 25 : 50;
  const visibles = verTodas ? filasMatriz : filasMatriz.slice(0, limite);
  const totales: { etiqueta: string; moneda: "BS" | "USD" | null; t: ReturnType<typeof totalesPorMes> }[] = medidaEf === "usd"
    ? [{ etiqueta: "Total", moneda: null, t: totalesPorMes(filasMatriz, meses) }]
    : (["BS", "USD"] as const).filter((x) => filasMatriz.some((f) => f.moneda === x))
      .map((x) => ({ etiqueta: x === "BS" ? "Total en bolívares" : "Total en dólares", moneda: x, t: totalesPorMes(filasMatriz.filter((f) => f.moneda === x), meses) }));
  const fmtCelda = (v: number, moneda: "BS" | "USD" | null) => (!v ? "" : moneda === "BS" ? fmtBs(v) : fmtUsd(v));

  // ── Detalle ──
  const detalleFiltrado = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (detalle ?? []).filter((c) => (filtro === "todos" || (filtro === "vigentes") === (c.estado === "vigente"))
      && (!t || `${c.numero} ${c.cliente ?? ""} ${c.rif ?? ""} ${c.referencia ?? ""} ${c.diario} ${c.vendedor}`.toLowerCase().includes(t)));
  }, [detalle, filtro, q]);
  const pg = usePagination(detalleFiltrado, 25, `${filtro}|${q}|${desde}|${hasta}`);

  const libro = () => libroLoCobrado({ desde, hasta, meses, empresas, ambas, ...m, detalle });

  if (error) return <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" data-testid="cobrado-error">No se pudo cargar lo cobrado: {error}</p>;

  const celdaEtiqueta = (f: FilaMatriz): ReactNode => (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="truncate" title={f.etiqueta}>{f.etiqueta}</span>
      {ambas && f.empresa && <Badge variant="outline" className="h-4 shrink-0 px-1 text-[10px]">{f.empresa}</Badge>}
      {f.moneda && <Badge variant="secondary" className="h-4 shrink-0 px-1 text-[10px]">{f.moneda === "BS" ? "Bs" : "USD"}</Badge>}
      {vistaEf === "cliente" && f.detalle && <span className="hidden shrink-0 text-[11px] text-muted-foreground xl:inline">{f.detalle}</span>}
    </span>
  );

  return (
    <div data-testid="lo-cobrado">
      <KpiStrip items={[
        { label: "Cobrado", valor: cargando ? "…" : fmtUsd(kpi.usd), tono: "primario", titulo: "Cobros que cuentan, en USD a la tasa BCV del día de cada cobro (sin IGTF)" },
        { label: "Cobros", valor: cargando ? "…" : kpi.cobros.toLocaleString("es-VE") },
        { label: "En bolívares", valor: cargando ? "…" : bsCorto(kpi.bs?.total ?? 0), detalle: kpi.bs ? `≈ ${fmtUsd(kpi.bs.usd)}` : undefined, titulo: fmtBs(kpi.bs?.total ?? 0) },
        { label: "En divisas", valor: cargando ? "…" : fmtUsd(kpi.divisas?.total ?? 0) },
        { label: "No cuentan", valor: cargando ? "…" : kpi.fueraN.toLocaleString("es-VE"), detalle: kpi.fueraN ? fmtUsd(kpi.fueraUsd) : undefined, tono: kpi.fueraN ? "alerta" : "tenue",
          titulo: "Anulados, borradores, reportados sin verificar, IGTF y anticipos de saldo inicial anteriores al arranque de Odoo",
          onClick: () => document.getElementById("cobrado-no-cuentan")?.scrollIntoView({ behavior: "smooth", block: "start" }) },
      ]} />
      <div className="-mt-1 mb-3 space-y-0.5 text-xs text-muted-foreground" data-testid="cobrado-notas">
        <p>USD = monto ÷ tasa BCV del día del cobro. Desde el 1-may-2026 los cobros salen de Odoo; antes, de los recibos de Profit del Excel de finanzas.
          {deProfit.n > 0 && <> En este período, {deProfit.n.toLocaleString("es-VE")} cobros ({fmtUsd(deProfit.usd)}) son de Profit.</>}</p>
        {siN > 0 && <p>No se cuentan {siN.toLocaleString("es-VE")} anticipos de saldo inicial migrados a Odoo antes de su arranque ({fmtUsd(siUsd)}): es el mismo dinero de los recibos de Profit.</p>}
        {conTasaProfit && <p><span className="font-semibold text-warning">P</span> = tasa tomada de Profit: ese día no hay tasa BCV en Odoo (viene redondeada a 2 decimales).</p>}
        {!veDeuda && <p data-testid="cobrado-sin-cuentas">El detalle de cobros y la matriz por cliente piden también el permiso de Cuentas.</p>}
      </div>

      <Panel sinPadding titulo={<>Por {VISTAS.find((v) => v.clave === vistaEf)?.texto.toLowerCase()} y mes <span className="font-normal text-muted-foreground">· {medidaEf === "usd" ? "en USD" : "en la moneda del cobro"}</span></>}
        acciones={<BotonExcel libro={libro} disabled={cargando} size="sm" className="h-7 gap-1.5 text-xs" data-testid="cobrado-excel" />}>
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <Segmentado<Vista> etiqueta="Filas" valor={vistaEf} onCambio={(v) => { setVista(v); setVerTodas(false); setQMatriz(""); }}
            opciones={VISTAS.filter((v) => !v.cuentas || veDeuda)} />
          {vistaEf !== "vendedor" && (
            <Segmentado<Medida> etiqueta="Monto" valor={medidaEf} onCambio={setMedida} opciones={[{ clave: "usd", texto: "USD" }, { clave: "moneda", texto: "Moneda original" }]} />
          )}
          {filasMatriz.length > 10 || qMatriz ? (
            <Input value={qMatriz} onChange={(e) => setQMatriz(e.target.value)} placeholder="Buscar…" className="h-7 w-40 text-[13px] sm:ml-auto" aria-label="Buscar en la matriz" />
          ) : null}
        </div>
        {cargando ? (
          <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Cargando…</p>
        ) : !filasMatriz.length ? (
          <p className="p-4 text-sm text-muted-foreground">Sin cobros en el período.</p>
        ) : (
          <Table data-testid="cobrado-matriz">
            <TableHeader><TableRow>
              <TableHead className="sticky left-0 z-[2] min-w-[140px] bg-card sm:min-w-[180px] [background-image:linear-gradient(hsl(var(--muted)/0.8),hsl(var(--muted)/0.8))]">{VISTAS.find((v) => v.clave === vistaEf)?.texto}</TableHead>
              {meses.map((mm) => <TableHead key={mm} className="whitespace-nowrap text-right">{etiquetaMes(mm)}</TableHead>)}
              <TableHead className="text-right">Total</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {visibles.map((f) => (
                <TableRow key={f.clave} data-testid="cobrado-fila">
                  <TableCell className="sticky left-0 z-[1] max-w-[150px] bg-card py-1.5 font-medium sm:max-w-[280px]">{celdaEtiqueta(f)}</TableCell>
                  {meses.map((mm) => <TableCell key={mm} className="whitespace-nowrap py-1.5 text-right tabular-nums">{fmtCelda(f.meses[mm] ?? 0, medidaEf === "usd" ? null : f.moneda)}</TableCell>)}
                  <TableCell className="whitespace-nowrap py-1.5 text-right font-semibold tabular-nums">{fmtCelda(f.total, medidaEf === "usd" ? null : f.moneda)}</TableCell>
                </TableRow>
              ))}
              {totales.map((t) => (
                <TableRow key={t.etiqueta} className="bg-muted/40 font-semibold" data-testid="cobrado-total">
                  <TableCell className="sticky left-0 z-[1] bg-card py-1.5 [background-image:linear-gradient(hsl(var(--muted)/0.4),hsl(var(--muted)/0.4))]">{t.etiqueta}</TableCell>
                  {meses.map((mm) => <TableCell key={mm} className="whitespace-nowrap py-1.5 text-right tabular-nums">{fmtCelda(t.t.meses[mm], t.moneda)}</TableCell>)}
                  <TableCell className="whitespace-nowrap py-1.5 text-right tabular-nums">{fmtCelda(t.t.total, t.moneda)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {filasMatriz.length > limite && (
          <div className="border-t border-border px-3 py-1.5 text-right">
            <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setVerTodas((v) => !v)}>
              {verTodas ? `Ver solo las primeras ${limite}` : `Ver las ${filasMatriz.length} filas`}
            </Button>
          </div>
        )}
      </Panel>

      {detalle && (
        <Panel sinPadding titulo={<>Detalle de cobros <span className="font-normal text-muted-foreground">· {detalleFiltrado.length.toLocaleString("es-VE")}</span></>}>
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cliente, RIF, número…" className="h-7 min-w-0 flex-1 text-[13px] sm:max-w-xs" aria-label="Buscar cobros" />
            <Select value={filtro} onValueChange={(v) => setFiltro(v as FiltroDetalle)}>
              <SelectTrigger className="h-7 w-36 text-[12px]" aria-label="Qué cobros"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="vigentes">Los que cuentan</SelectItem>
                <SelectItem value="no_cuentan">No cuentan</SelectItem>
                <SelectItem value="todos">Todos</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Table data-testid="cobrado-detalle">
            <TableHeader><TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead className="hidden sm:table-cell">Número</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead className="hidden lg:table-cell">Diario o cuenta</TableHead>
              <TableHead className="hidden xl:table-cell">Forma</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Monto</TableHead>
              <TableHead className="hidden text-right md:table-cell">Tasa BCV</TableHead>
              <TableHead className="text-right">USD</TableHead>
              <TableHead className="hidden sm:table-cell">Fuente</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {pg.pageItems.map((c) => (
                <TableRow key={c.ref} data-testid="cobrado-cobro" data-estado={c.estado} className={c.estado !== "vigente" ? "text-muted-foreground" : undefined}>
                  <TableCell className="whitespace-nowrap py-1.5">{fechaDMA(c.fecha)}</TableCell>
                  <TableCell className="hidden whitespace-nowrap py-1.5 font-mono text-xs sm:table-cell">{c.numero}</TableCell>
                  <TableCell className="max-w-[180px] py-1.5 sm:max-w-[260px]">
                    <span className="block truncate font-medium" title={c.cliente ?? ""}>{c.cliente ?? "—"}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      <span className="sm:hidden">{c.numero} · {c.moneda === "BS" ? fmtBs(c.monto) : fmtUsd(c.monto)} · </span>
                      {[ambas ? c.empresa : null, c.rif, c.estado !== "vigente" ? ESTADO_COBRO[c.estado] : null].filter(Boolean).join(" · ")}
                    </span>
                  </TableCell>
                  <TableCell className="hidden max-w-[200px] truncate py-1.5 lg:table-cell" title={c.diario}>{c.diario}</TableCell>
                  <TableCell className="hidden whitespace-nowrap py-1.5 xl:table-cell">{c.forma}</TableCell>
                  <TableCell className="hidden whitespace-nowrap py-1.5 text-right tabular-nums sm:table-cell">{c.moneda === "BS" ? fmtBs(c.monto) : fmtUsd(c.monto)}</TableCell>
                  <TableCell className="hidden whitespace-nowrap py-1.5 text-right tabular-nums md:table-cell" title={c.tasa_origen ? TEXTO_TASA[c.tasa_origen] : undefined}>
                    {c.moneda === "BS" ? <>{fmtTasa(c.tasa)}<MarcaP c={c} /></> : "—"}
                  </TableCell>
                  <TableCell className={cn("whitespace-nowrap py-1.5 text-right font-semibold tabular-nums", c.estado !== "vigente" && "line-through decoration-muted-foreground/60")}
                    title={c.motivo ?? (c.usd_origen != null && Math.abs(num(c.usd_origen) - num(c.usd)) >= 0.01 ? `Según ${FUENTE_COBRO[c.fuente]}: ${fmtUsd(c.usd_origen)}` : undefined)}>
                    {fmtUsd(c.usd)}
                  </TableCell>
                  <TableCell className="hidden py-1.5 sm:table-cell"><Badge variant="outline" className="text-[10px]">{FUENTE_COBRO[c.fuente]}</Badge></TableCell>
                </TableRow>
              ))}
              {!pg.pageItems.length && <TableRow><TableCell colSpan={9} className="py-6 text-center text-sm text-muted-foreground">Sin cobros con este filtro.</TableCell></TableRow>}
            </TableBody>
          </Table>
          <DataTablePagination pagination={pg} />
        </Panel>
      )}

      <Panel sinPadding titulo="No cuentan, y por qué" className="scroll-mt-24">
        <div id="cobrado-no-cuentan" />
        <Table data-testid="cobrado-no-cuentan">
          <TableHeader><TableRow>
            <TableHead>Estado</TableHead>
            <TableHead className="hidden md:table-cell">Por qué no cuenta</TableHead>
            <TableHead className="text-right">Cobros</TableHead>
            <TableHead className="text-right">USD</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {pivotar(m.estado.filter((c) => c.fila !== "vigente"), "usd").map((f) => (
              <TableRow key={f.clave} data-testid="cobrado-no-cuenta" data-estado={f.clave}>
                <TableCell className="py-1.5 font-medium">{ESTADO_COBRO[f.clave as keyof typeof ESTADO_COBRO] ?? f.etiqueta}
                  <span className="block text-[11px] font-normal text-muted-foreground md:hidden">{f.detalle}</span></TableCell>
                <TableCell className="hidden py-1.5 text-muted-foreground md:table-cell">{f.detalle}</TableCell>
                <TableCell className="py-1.5 text-right tabular-nums">{f.cobros.toLocaleString("es-VE")}</TableCell>
                <TableCell className="whitespace-nowrap py-1.5 text-right tabular-nums">{fmtUsd(f.total)}</TableCell>
              </TableRow>
            ))}
            {!cargando && !m.estado.some((c) => c.fila !== "vigente") && (
              <TableRow><TableCell colSpan={4} className="py-4 text-center text-sm text-muted-foreground">Todos los cobros del período cuentan.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Panel>
    </div>
  );
}
