import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { Panel } from "@/components/datos/FichaCampos";
import { BarChart3, Loader2, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { diaCaracas } from "@/components/delivery/fechas";
import { MOTIVOS_LINEA, MOTIVOS_RECHAZO, MOTIVOS_REPROGRAMACION, etiquetaMotivo, fmtDia } from "@/components/delivery/entregas";
import {
  cargarIndicadores, fmtMinutos, fmtPct, pct, type IndicadorRepartidor, type Indicadores, type MetricasDelivery, type MotivoConteo,
} from "@/components/delivery/seguimiento";

const LISTA_MOTIVOS = { incompleta: MOTIVOS_LINEA, rechazada: MOTIVOS_RECHAZO, reprogramada: MOTIVOS_REPROGRAMACION } as const;
const TIPO_MOTIVO = { incompleta: "Incompleta", rechazada: "Rechazo", reprogramada: "Reprogramación" } as const;
// Mismos colores que las insignias de estado de la entrega (verde entregada, ámbar incompleta, rojo rechazada, celeste reprogramada)
const SEGMENTOS: { k: keyof MetricasDelivery; label: string; cls: string }[] = [
  { k: "completas", label: "Completas", cls: "bg-emerald-600" },
  { k: "incompletas", label: "Incompletas", cls: "bg-amber-500" },
  { k: "rechazadas", label: "Rechazadas", cls: "bg-red-500" },
  { k: "reprogramadas", label: "Reprogramadas", cls: "bg-sky-500" },
];

const menosDias = (dia: string, n: number) => { const [y, m, d] = dia.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10); };
const etiquetaMot = (m: MotivoConteo) => etiquetaMotivo(m.codigo, [...LISTA_MOTIVOS[m.tipo]]);

/** Resultado de las entregas cerradas en una barra 100 % (con leyenda aparte y los números en la tabla). */
function BarraResultados({ m }: { m: MetricasDelivery }) {
  if (!m.cerradas) return <span className="text-xs text-muted-foreground">Sin cierres</span>;
  return (
    <div className="flex h-2.5 w-28 gap-[2px] overflow-hidden rounded-full bg-muted" role="img"
      aria-label={SEGMENTOS.map((s) => `${s.label}: ${m[s.k]}`).join(", ")}>
      {SEGMENTOS.map((s) => Number(m[s.k]) > 0 && (
        <span key={s.k} className={`h-full ${s.cls}`} style={{ width: `${(Number(m[s.k]) / m.cerradas) * 100}%` }} title={`${s.label}: ${m[s.k]} (${fmtPct(pct(Number(m[s.k]), m.cerradas))})`} />
      ))}
    </div>
  );
}

/** Indicadores de delivery (D6) por período y repartidor: asignadas y cerradas, % por resultado, a tiempo según la fecha
 *  programada, tiempo de salida a entrega, reprogramaciones y motivos más frecuentes. Empresa activa del menú superior. */
export function IndicadoresPanel() {
  const { toast } = useToast();
  const hoy = diaCaracas();
  const [desde, setDesde] = useState(menosDias(hoy, 29));
  const [hasta, setHasta] = useState(hoy);
  const [datos, setDatos] = useState<Indicadores | null>(null);
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback(async () => {
    if (!desde || !hasta || hasta < desde) return;
    setCargando(true);
    try { setDatos(await cargarIndicadores(desde, hasta)); }
    catch (e) { toast({ title: "No se pudieron cargar los indicadores", description: (e as Error).message, variant: "destructive" }); }
    finally { setCargando(false); }
  }, [desde, hasta, toast]);
  useEffect(() => { cargar(); }, [cargar]);

  const rango = (n: number | "mes") => {
    setHasta(hoy);
    setDesde(n === "mes" ? `${hoy.slice(0, 8)}01` : menosDias(hoy, n - 1));
  };
  const t = datos?.total;
  const maxMotivo = Math.max(1, ...(datos?.motivos ?? []).map((m) => m.n));
  const fila = (m: MetricasDelivery) => ({
    completas: pct(m.completas, m.cerradas), incompletas: pct(m.incompletas, m.cerradas), rechazadas: pct(m.rechazadas, m.cerradas),
    reprogramadas: pct(m.reprogramadas, m.cerradas), aTiempo: pct(m.a_tiempo, m.con_objetivo),
  });

  return (
    <div className="space-y-3">
      <Panel titulo={<><BarChart3 className="h-4 w-4 text-primary" />Indicadores de delivery</>}
        acciones={<Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={cargar} disabled={cargando}><RefreshCw className={`h-3.5 w-3.5 ${cargando ? "animate-spin" : ""}`} />Actualizar</Button>}>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="ind-desde" className="text-xs">Desde</Label>
            <Input id="ind-desde" type="date" value={desde} max={hasta} onChange={(e) => e.target.value && setDesde(e.target.value)} className="h-9 w-[150px]" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ind-hasta" className="text-xs">Hasta</Label>
            <Input id="ind-hasta" type="date" value={hasta} min={desde} max={hoy} onChange={(e) => e.target.value && setHasta(e.target.value)} className="h-9 w-[150px]" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" className="h-9" onClick={() => rango(1)}>Hoy</Button>
            <Button size="sm" variant="outline" className="h-9" onClick={() => rango(7)}>7 días</Button>
            <Button size="sm" variant="outline" className="h-9" onClick={() => rango(30)}>30 días</Button>
            <Button size="sm" variant="outline" className="h-9" onClick={() => rango("mes")}>Este mes</Button>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Cerradas: las que el repartidor cerró en GUDS en el período (las validadas directo en Odoo van aparte). A tiempo: entregas (completas o
          incompletas) hechas el día programado o antes (la fecha de la reprogramación si es otro intento, si no la fecha programada en Odoo o, sin ella,
          el día de la ruta). Salida a entrega: desde «Salir a entregar» hasta el cierre.
        </p>
      </Panel>

      {cargando && !datos ? <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      : !t ? null : (
        <>
          <KpiStrip className="mb-0" items={[
            { label: "Asignadas", valor: t.asignadas, detalle: `${fmtDia(desde)} – ${fmtDia(hasta)}` },
            { label: "Cerradas", valor: t.cerradas, detalle: t.cerradas_odoo ? `+ ${t.cerradas_odoo} validadas en Odoo` : "por el repartidor", tono: "primario" },
            { label: "Completas", valor: fmtPct(fila(t).completas), detalle: `${t.completas} entregas`, tono: "positivo" },
            { label: "Incompletas", valor: fmtPct(fila(t).incompletas), detalle: `${t.incompletas} entregas`, tono: t.incompletas ? "alerta" : "tenue" },
            { label: "Rechazadas", valor: fmtPct(fila(t).rechazadas), detalle: `${t.rechazadas} entregas`, tono: t.rechazadas ? "negativo" : "tenue" },
            { label: "Reprogramadas", valor: t.reprogramadas, detalle: fmtPct(fila(t).reprogramadas) + " de las cerradas" },
            { label: "A tiempo", valor: fmtPct(fila(t).aTiempo), detalle: `${t.a_tiempo} de ${t.con_objetivo} entregas`, titulo: "Entregadas el día programado o antes" },
            { label: "Salida → entrega", valor: fmtMinutos(t.minutos_salida_entrega), detalle: t.con_tiempo ? `promedio de ${t.con_tiempo}` : "sin datos" },
          ]} />

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
            <Panel sinPadding titulo="Por repartidor">
              {!datos!.repartidores.length ? <p className="px-3 py-4 text-sm text-muted-foreground">No hay entregas asignadas ni cerradas en el período.</p> : (
                <>
                  <div className="flex flex-wrap items-center gap-3 border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground" aria-hidden>
                    {SEGMENTOS.map((s) => <span key={s.k} className="inline-flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${s.cls}`} />{s.label}</span>)}
                  </div>
                  <Table data-tabla="indicadores">
                    <TableHeader><TableRow>
                      <TableHead>Repartidor</TableHead><TableHead className="text-right">Asignadas</TableHead><TableHead className="text-right">Cerradas</TableHead>
                      <TableHead>Resultado</TableHead><TableHead className="text-right">Completas</TableHead><TableHead className="text-right">Incompletas</TableHead>
                      <TableHead className="text-right">Rechazadas</TableHead><TableHead className="text-right">Reprog.</TableHead>
                      <TableHead className="text-right">A tiempo</TableHead><TableHead className="text-right">Salida → entrega</TableHead><TableHead>Motivos</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {datos!.repartidores.map((r: IndicadorRepartidor) => {
                        const f = fila(r);
                        return (
                          <TableRow key={r.id} data-repartidor={r.id}>
                            <TableCell className="whitespace-nowrap font-medium">{r.nombre}</TableCell>
                            <TableCell className="text-right tabular-nums">{r.asignadas}</TableCell>
                            <TableCell className="text-right tabular-nums">{r.cerradas}{r.cerradas_odoo ? <span className="block text-[10px] text-muted-foreground">+{r.cerradas_odoo} Odoo</span> : null}</TableCell>
                            <TableCell><BarraResultados m={r} /></TableCell>
                            <TableCell className="whitespace-nowrap text-right tabular-nums">{fmtPct(f.completas)}<span className="block text-[10px] text-muted-foreground">{r.completas}</span></TableCell>
                            <TableCell className="whitespace-nowrap text-right tabular-nums">{fmtPct(f.incompletas)}<span className="block text-[10px] text-muted-foreground">{r.incompletas}</span></TableCell>
                            <TableCell className="whitespace-nowrap text-right tabular-nums">{fmtPct(f.rechazadas)}<span className="block text-[10px] text-muted-foreground">{r.rechazadas}</span></TableCell>
                            <TableCell className="text-right tabular-nums">{r.reprogramadas}</TableCell>
                            <TableCell className="whitespace-nowrap text-right tabular-nums">{fmtPct(f.aTiempo)}<span className="block text-[10px] text-muted-foreground">{r.a_tiempo}/{r.con_objetivo}</span></TableCell>
                            <TableCell className="whitespace-nowrap text-right tabular-nums">{fmtMinutos(r.minutos_salida_entrega)}</TableCell>
                            <TableCell className="min-w-[160px] text-[11px] text-muted-foreground">
                              {r.motivos.length ? r.motivos.map((m) => `${etiquetaMot(m)} (${m.n})`).join(" · ") : "—"}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </>
              )}
            </Panel>

            <Panel titulo="Motivos más frecuentes">
              {!datos!.motivos.length ? <p className="text-sm text-muted-foreground">Sin incidencias en el período.</p> : (
                <ol className="space-y-2" data-lista="motivos">
                  {datos!.motivos.map((m) => (
                    <li key={`${m.tipo}:${m.codigo}`} className="space-y-0.5">
                      <div className="flex items-baseline justify-between gap-2 text-xs">
                        <span className="min-w-0 truncate" title={etiquetaMot(m)}>{etiquetaMot(m)} <span className="text-muted-foreground">· {TIPO_MOTIVO[m.tipo]}</span></span>
                        <span className="shrink-0 font-medium tabular-nums">{m.n}</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-muted"><div className="h-full rounded-full bg-primary/70" style={{ width: `${(m.n / maxMotivo) * 100}%` }} /></div>
                    </li>
                  ))}
                </ol>
              )}
              <p className="mt-3 text-[11px] text-muted-foreground">En las incompletas cuenta el motivo de cada producto con diferencia.</p>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
