import { useEffect, useMemo, useState } from "react";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { Panel } from "@/components/datos/FichaCampos";
import { TablaReporte } from "@/components/reportes/TablaReporte";
import { exportarCSV, BotonExportar } from "@/components/datos/tabla";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { useToast } from "@/hooks/use-toast";

// ── reporte_metas_vendedores (migración 20q): meta por vendedor y mes contra la venta real (definición de resumen_vendedor) ──
interface FilaMeta {
  vendedor_id: string; vendedor: string; email: string | null; activo: boolean; clientes: number; anio: number; mes: number; desde: string; hasta: string;
  meta_usd: number; venta_usd: number; facturas: number; cumplimiento_pct: number | null; brecha_usd: number | null;
  en_curso: boolean; dias_habiles: number; dias_transcurridos: number; proyeccion_usd: number | null; proyeccion_pct: number | null;
}
interface Vendedor {
  id: string; nombre: string; activo: boolean; clientes: number; meta: number; venta: number; facturas: number;
  cumplimiento: number | null; brecha: number | null; mesCurso: FilaMeta | null; meses: Map<string, FilaMeta>;
}

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const n = (v: unknown) => Number(v ?? 0);
const pct = (v: number | null) => (v === null ? "—" : `${v.toLocaleString("es-VE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`);
const tonoCumpl = (v: number | null) => (v === null ? "text-muted-foreground" : v >= 100 ? "text-success" : v >= 80 ? "text-warning" : "text-destructive");

/** Barra de cumplimiento (0–100 %, con marca si supera la meta) */
function BarraCumplimiento({ valor }: { valor: number | null }) {
  if (valor === null) return <span className="text-[11px] text-muted-foreground">sin meta</span>;
  return (
    <span className="inline-flex w-full items-center justify-end gap-1.5">
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-muted" aria-hidden>
        <span className={cn("block h-full rounded-full", valor >= 100 ? "bg-success" : valor >= 80 ? "bg-warning" : "bg-destructive")} style={{ width: `${Math.min(100, Math.max(0, valor))}%` }} />
      </span>
      <span className={cn("w-14 text-right text-xs font-medium tabular-nums", tonoCumpl(valor))}>{pct(valor)}</span>
    </span>
  );
}

/** Pestaña Metas de Reportes: meta de cada vendedor por mes contra su venta real, cumplimiento y proyección del mes en curso. */
export function MetasVendedores({ desde, hasta, onCargando }: { desde: string; hasta: string; onCargando?: (v: boolean) => void }) {
  const { formatPrice } = useCurrency();
  const { soloLectura, seleccion } = useEmpresa();
  const { toast } = useToast();
  const [filas, setFilas] = useState<FilaMeta[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      setCargando(true); onCargando?.(true); setError(null);
      const { data, error: e } = await supabase.rpc("reporte_metas_vendedores", { p_desde: desde, p_hasta: hasta });
      if (cancelado) return;
      if (e) {
        setFilas([]); setError(e.message);
        toast({ title: "No se pudieron cargar las metas", description: e.message, variant: "destructive" });
      } else setFilas((data ?? []) as FilaMeta[]);
      setCargando(false); onCargando?.(false);
    })();
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta, soloLectura, seleccion]);

  // Meses del período y vendedores con sus totales
  const { meses, vendedores, total } = useMemo(() => {
    const meses = [...new Map(filas.map((f) => [f.desde, { clave: f.desde, anio: f.anio, mes: f.mes, enCurso: f.en_curso, dh: f.dias_habiles, dt: f.dias_transcurridos }])).values()]
      .sort((a, b) => a.clave.localeCompare(b.clave));
    const porId = new Map<string, Vendedor>();
    for (const f of filas) {
      const v = porId.get(f.vendedor_id) ?? { id: f.vendedor_id, nombre: f.vendedor || f.email || "—", activo: f.activo, clientes: n(f.clientes), meta: 0, venta: 0, facturas: 0, cumplimiento: null, brecha: null, mesCurso: null, meses: new Map() };
      v.meta += n(f.meta_usd); v.venta += n(f.venta_usd); v.facturas += n(f.facturas);
      if (f.en_curso) v.mesCurso = f;
      v.meses.set(f.desde, f);
      porId.set(f.vendedor_id, v);
    }
    const vendedores = [...porId.values()].map((v) => ({ ...v, cumplimiento: v.meta > 0 ? (v.venta / v.meta) * 100 : null, brecha: v.meta > 0 ? v.meta - v.venta : null }))
      .sort((a, b) => (b.meta > 0 ? 1 : 0) - (a.meta > 0 ? 1 : 0) || b.venta - a.venta);
    const conMeta = vendedores.filter((v) => v.meta > 0);
    const curso = filas.filter((f) => f.en_curso);
    const cursoMeta = curso.filter((f) => n(f.meta_usd) > 0);
    const total = {
      meta: conMeta.reduce((s, v) => s + v.meta, 0),
      ventaConMeta: conMeta.reduce((s, v) => s + v.venta, 0),
      venta: vendedores.reduce((s, v) => s + v.venta, 0),
      conMeta: conMeta.length,
      alcanzadas: conMeta.filter((v) => v.venta >= v.meta).length,
      hayCurso: curso.length > 0,
      proyeccion: curso.reduce((s, f) => s + n(f.proyeccion_usd), 0),
      metaCurso: cursoMeta.reduce((s, f) => s + n(f.meta_usd), 0),
      proyeccionConMeta: cursoMeta.reduce((s, f) => s + n(f.proyeccion_usd), 0),
      diasHabiles: curso[0]?.dias_habiles ?? 0, diasTranscurridos: curso[0]?.dias_transcurridos ?? 0,
    };
    return { meses, vendedores, total };
  }, [filas]);

  const cumplTotal = total.meta > 0 ? (total.ventaConMeta / total.meta) * 100 : null;
  const proyPct = total.metaCurso > 0 ? (total.proyeccionConMeta / total.metaCurso) * 100 : null;
  const etiquetaMes = (m: { anio: number; mes: number }) => `${MESES[m.mes - 1]} ${String(m.anio).slice(2)}`;

  if (error) return <p className="rounded-lg border border-border bg-card px-3 py-6 text-center text-sm text-destructive">{error}</p>;

  return (
    <div className="min-w-0">
      <KpiStrip items={[
        { label: "Meta del período", valor: total.meta > 0 ? formatPrice(total.meta) : "Sin metas", detalle: `${total.conMeta} vendedor${total.conMeta === 1 ? "" : "es"} con meta`, tono: "primario" },
        { label: "Venta real", valor: formatPrice(total.conMeta ? total.ventaConMeta : total.venta),
          detalle: !total.conMeta ? "de todos los vendedores" : total.venta !== total.ventaConMeta ? `${formatPrice(total.venta)} con los que no tienen meta` : "de los vendedores con meta",
          titulo: "Documentos de venta de Odoo netos de IVA de los clientes asignados a cada vendedor (la misma cifra del portal del vendedor)" },
        { label: "Cumplimiento", valor: pct(cumplTotal), tono: cumplTotal === null ? "tenue" : cumplTotal >= 100 ? "positivo" : cumplTotal >= 80 ? "alerta" : "negativo",
          detalle: total.conMeta ? `${total.alcanzadas} de ${total.conMeta} alcanzaron la meta` : undefined },
        ...(total.hayCurso ? [{ label: "Proyección del mes", valor: formatPrice(total.proyeccion),
          detalle: proyPct !== null ? `${pct(proyPct)} de la meta del mes` : `${total.diasTranscurridos} de ${total.diasHabiles} días hábiles`,
          tono: proyPct === null ? "normal" as const : proyPct >= 100 ? "positivo" as const : "alerta" as const,
          titulo: `Venta del mes ÷ ${total.diasTranscurridos} días hábiles transcurridos (lunes a viernes, incluido hoy) × ${total.diasHabiles} días hábiles del mes` }] : []),
      ]} />
      {!cargando && total.conMeta === 0 && (
        <p className="-mt-1 mb-3 text-xs text-muted-foreground">
          No hay metas cargadas en el período. Administración las carga por vendedor y mes (USD) en Vendedores → Metas; mientras tanto se muestra la venta real.
        </p>
      )}

      <TablaReporte titulo={<>Metas por vendedor <span className="font-normal text-muted-foreground">· {meses.length === 1 ? etiquetaMes(meses[0]) : `${meses.length} meses`}</span></>}
        filas={vendedores} exportar="metas-por-vendedor" limite={25} vacio={cargando ? "Cargando…" : "Sin vendedores con meta o venta en el período"} columnas={[
          { clave: "nombre", titulo: "Vendedor", valor: (v) => v.nombre,
            render: (v) => <span className={cn("truncate", !v.activo && "text-muted-foreground")} title={`${v.clientes} clientes activos`}>{v.nombre}{!v.activo ? " (inactivo)" : ""}</span> },
          { clave: "meta", titulo: "Meta", valor: (v) => v.meta, render: (v) => (v.meta > 0 ? formatPrice(v.meta) : <span className="text-muted-foreground">—</span>), derecha: true },
          { clave: "venta", titulo: "Venta real", valor: (v) => v.venta, render: (v) => formatPrice(v.venta), derecha: true },
          { clave: "cumplimiento", titulo: "Cumplimiento", valor: (v) => v.cumplimiento, render: (v) => <BarraCumplimiento valor={v.cumplimiento} />, derecha: true },
          { clave: "brecha", titulo: "Brecha", valor: (v) => v.brecha, render: (v) => (v.brecha === null ? "—" : <span className={v.brecha > 0 ? "" : "text-success"}>{formatPrice(v.brecha)}</span>), derecha: true, ocultarMovil: true },
          ...(total.hayCurso ? [
            { clave: "proyeccion", titulo: "Proyección mes", valor: (v: Vendedor) => (v.mesCurso ? n(v.mesCurso.proyeccion_usd) : null),
              render: (v: Vendedor) => (v.mesCurso?.proyeccion_usd == null ? "—" : formatPrice(n(v.mesCurso.proyeccion_usd))), derecha: true, ocultarMovil: true },
            { clave: "proyeccion_pct", titulo: "Proy. %", valor: (v: Vendedor) => v.mesCurso?.proyeccion_pct ?? null,
              render: (v: Vendedor) => <span className={cn("tabular-nums", tonoCumpl(v.mesCurso?.proyeccion_pct ?? null))}>{pct(v.mesCurso?.proyeccion_pct ?? null)}</span>, derecha: true },
          ] : []),
          { clave: "facturas", titulo: "Facturas", valor: (v) => v.facturas, soloExportar: true },
          { clave: "clientes", titulo: "Clientes activos", valor: (v) => v.clientes, soloExportar: true },
        ]} />

      {meses.length > 1 && vendedores.length > 0 && (
        <Panel sinPadding titulo={<>Cumplimiento por mes <span className="font-normal text-muted-foreground">· venta ÷ meta</span></>}
          acciones={<BotonExportar soloIcono total={vendedores.length} onClick={() => exportarCSV("metas-por-mes", vendedores.flatMap((v) => meses.map((m) => ({ v, f: v.meses.get(m.clave) }))), [
            { titulo: "Vendedor", valor: (x) => x.v.nombre }, { titulo: "Año", valor: (x) => x.f?.anio ?? null }, { titulo: "Mes", valor: (x) => x.f?.mes ?? null },
            { titulo: "Meta (USD)", valor: (x) => n(x.f?.meta_usd) }, { titulo: "Venta (USD)", valor: (x) => n(x.f?.venta_usd) },
            { titulo: "Cumplimiento %", valor: (x) => x.f?.cumplimiento_pct ?? null }, { titulo: "Proyección (USD)", valor: (x) => x.f?.proyeccion_usd ?? null },
          ])} />}>
          <Table containerClassName="max-h-[28rem]">
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 z-20 min-w-[150px] bg-muted">Vendedor</TableHead>
                {meses.map((m) => <TableHead key={m.clave} className="whitespace-nowrap text-right">{etiquetaMes(m)}{m.enCurso ? " *" : ""}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {vendedores.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="sticky left-0 z-[1] max-w-[200px] truncate bg-card py-1 font-medium">{v.nombre}</TableCell>
                  {meses.map((m) => {
                    const f = v.meses.get(m.clave);
                    const c = f?.cumplimiento_pct ?? null;
                    return (
                      <TableCell key={m.clave} className="whitespace-nowrap py-1 text-right tabular-nums"
                        title={f ? `Meta ${formatPrice(n(f.meta_usd))} · venta ${formatPrice(n(f.venta_usd))}${f.en_curso && f.proyeccion_usd != null ? ` · proyección ${formatPrice(n(f.proyeccion_usd))}` : ""}` : undefined}>
                        {c !== null ? <span className={tonoCumpl(c)}>{pct(c)}</span>
                          : <span className="text-[11px] text-muted-foreground">{f && n(f.venta_usd) ? formatPrice(n(f.venta_usd)) : "—"}</span>}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">Sin meta se muestra la venta del mes. * mes en curso (el % es sobre la venta a la fecha).</p>
        </Panel>
      )}
      <p className="text-[11px] text-muted-foreground">
        Venta real = facturas − notas de crédito de Odoo, sin IVA, de los clientes asignados a cada vendedor (la misma definición que ve el vendedor en su portal); no
        incluye el histórico de Profit. Proyección = venta a la fecha ÷ días hábiles transcurridos × días hábiles del mes (lunes a viernes).
      </p>
    </div>
  );
}

export default MetasVendedores;
