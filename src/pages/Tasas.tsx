import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, Plus, RefreshCw } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { BarraLista } from "@/components/datos/BarraLista";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { usePagination } from "@/hooks/use-pagination";
import { useToast } from "@/hooks/use-toast";
import { useCurrency } from "@/contexts/CurrencyContext";
import { usePermissions } from "@/contexts/PermissionsContext";
import { aDate, fechaDMA, hoyCaracas, sumarDias } from "@/lib/fechas";
import {
  avisarTasasActualizadas, formatearBrecha, formatearTasa, tasasService, useTasasDelDia, type TasaDiaria,
} from "@/lib/tasas";
import { cn } from "@/lib/utils";

type Rango = "30" | "90" | "anio" | "todo";
const RANGOS: { valor: Rango; etiqueta: string }[] = [
  { valor: "30", etiqueta: "30 días" },
  { valor: "90", etiqueta: "90 días" },
  { valor: "anio", etiqueta: "Este año" },
  { valor: "todo", etiqueta: "Todo" },
];

const desdeDe = (r: Rango): string | null => {
  const hoy = hoyCaracas();
  if (r === "30") return sumarDias(hoy, -30);
  if (r === "90") return sumarDias(hoy, -90);
  if (r === "anio") return `${hoy.slice(0, 4)}-01-01`;
  return null;
};

/** «880,12» o «880.12» → 880.12; vacío → null; inválido → NaN. */
const leerNumero = (t: string): number | null => {
  const limpio = t.trim().replace(/\s/g, "");
  if (!limpio) return null;
  const normal = limpio.includes(",") ? limpio.replace(/\./g, "").replace(",", ".") : limpio;
  const n = Number(normal);
  return Number.isFinite(n) && n > 0 ? n : NaN;
};

const textoTasa = (v: number | null) => (v === null ? "" : String(v).replace(".", ","));
const diaSemana = (iso: string) => aDate(iso).toLocaleDateString("es-VE", { weekday: "short" });
const diaLargo = (iso: string) => aDate(iso).toLocaleDateString("es-VE", { weekday: "long", day: "numeric", month: "long" });

/** Fila del historial con la tasa BCV vigente ese día: en fines de semana y feriados el BCV no publica y rige la del
 *  último día hábil, así que la brecha del día se calcula con esa. */
type FilaHistorial = TasaDiaria & { bcvVigente: { usd: number | null; eur: number | null; desde: string } | null; brechaDia: number | null };

const conVigente = (filas: TasaDiaria[]): FilaHistorial[] => {
  // Vienen de la más reciente a la más vieja: se recorren al revés para arrastrar la última publicada.
  let ultima: FilaHistorial["bcvVigente"] = null;
  const salida: FilaHistorial[] = [];
  for (let i = filas.length - 1; i >= 0; i--) {
    const f = filas[i];
    if (f.bcv_usd !== null || f.bcv_eur !== null) ultima = { usd: f.bcv_usd, eur: f.bcv_eur, desde: f.fecha };
    const vigente = f.bcv_usd !== null ? null : ultima;
    const usd = f.bcv_usd ?? vigente?.usd ?? null;
    const brechaDia = f.brecha_pct ?? (usd && f.paralelo_usd ? Math.round((f.paralelo_usd / usd - 1) * 10000) / 100 : null);
    salida.push({ ...f, bcvVigente: vigente, brechaDia });
  }
  return salida.reverse();
};

type Edicion = { fecha: string; bcv_usd: string; bcv_eur: string; paralelo_usd: string; nueva: boolean };

/** Fase 24a · Historial diario de tasas: BCV dólar y euro, dólar paralelo y brecha. */
export default function Tasas() {
  const { toast } = useToast();
  const { can } = usePermissions();
  const { refreshing, refreshTasa } = useCurrency();
  const puedeEditar = can("configuracion", "editar") || can("cuentas", "editar") || can("bancos", "editar");
  const { tasas: t } = useTasasDelDia();

  const [rango, setRango] = useState<Rango>("30");
  const [filas, setFilas] = useState<TasaDiaria[]>([]);
  const [cargando, setCargando] = useState(true);
  const [editando, setEditando] = useState<Edicion | null>(null);
  const [guardando, setGuardando] = useState(false);
  const hoy = hoyCaracas();

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setFilas(await tasasService.historial(desdeDe(rango)));
    } catch (e) {
      toast({ title: "No se pudo cargar el historial", description: (e as Error).message, variant: "destructive" });
    } finally {
      setCargando(false);
    }
  }, [rango, toast]);

  useEffect(() => { void cargar(); }, [cargar]);
  useEffect(() => {
    window.addEventListener("guds:tasas-actualizadas", cargar);
    return () => window.removeEventListener("guds:tasas-actualizadas", cargar);
  }, [cargar]);

  const historial = useMemo(() => conVigente(filas), [filas]);
  const pagination = usePagination(historial, 50, rango);

  const actualizarAhora = async () => {
    const res = await refreshTasa();
    avisarTasasActualizadas();
    if (res.ok) toast({ title: "Tasas actualizadas", description: "BCV y paralelo consultados ahora." });
    else toast({ title: "Tasas actualizadas con avisos", description: res.error ?? "Alguna fuente no respondió.", variant: "destructive" });
  };

  const abrirEdicion = (f: TasaDiaria | null) => setEditando(f
    ? { fecha: f.fecha, bcv_usd: textoTasa(f.bcv_usd), bcv_eur: textoTasa(f.bcv_eur), paralelo_usd: textoTasa(f.paralelo_usd), nueva: false }
    : { fecha: hoy, bcv_usd: textoTasa(t?.bcv_usd ?? null), bcv_eur: textoTasa(t?.bcv_eur ?? null), paralelo_usd: textoTasa(t?.paralelo_usd ?? null), nueva: true });

  const guardar = async () => {
    if (!editando) return;
    const valores = { bcv_usd: leerNumero(editando.bcv_usd), bcv_eur: leerNumero(editando.bcv_eur), paralelo_usd: leerNumero(editando.paralelo_usd) };
    if (Object.values(valores).some((v) => Number.isNaN(v))) {
      toast({ title: "Revisa las tasas", description: "Deben ser números mayores que cero.", variant: "destructive" });
      return;
    }
    if (Object.values(valores).every((v) => v === null)) {
      toast({ title: "Escribe al menos una tasa", variant: "destructive" });
      return;
    }
    setGuardando(true);
    try {
      await tasasService.guardar(editando.fecha, valores);
      toast({ title: `Tasas del ${fechaDMA(editando.fecha)} guardadas` });
      setEditando(null);
      avisarTasasActualizadas();
    } catch (e) {
      toast({ title: "No se pudieron guardar las tasas", description: (e as { message?: string })?.message, variant: "destructive" });
    } finally {
      setGuardando(false);
    }
  };

  const brecha = t?.brecha_pct ?? null;

  return (
    <MainLayout title="Tasas">
      <KpiStrip
        items={[
          { label: "BCV dólar", valor: `Bs. ${formatearTasa(t?.bcv_usd)}`, detalle: t?.fecha_bcv ? `Fecha valor ${fechaDMA(t.fecha_bcv)}` : "Sin registro", tono: "positivo" },
          { label: "BCV euro", valor: `Bs. ${formatearTasa(t?.bcv_eur)}`, detalle: t?.fecha_bcv ? `Fecha valor ${fechaDMA(t.fecha_bcv)}` : "Sin registro", tono: "primario" },
          { label: "Dólar paralelo", valor: `Bs. ${formatearTasa(t?.paralelo_usd)}`, detalle: t?.fecha_paralelo ? `Del ${fechaDMA(t.fecha_paralelo)}` : "Sin registro" },
          { label: "Brecha", valor: formatearBrecha(brecha), detalle: "Paralelo frente al BCV dólar", tono: brecha !== null && brecha > 20 ? "negativo" : "alerta" },
        ]}
      />

      {t?.proxima_fecha && (
        <p className="mb-3 rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm">
          El BCV ya publicó la del {diaLargo(t.proxima_fecha)}: $ {formatearTasa(t.proxima_bcv_usd)} · € {formatearTasa(t.proxima_bcv_eur)}.
          <span className="text-muted-foreground"> Cobros y estados de cuenta la toman ese día.</span>
        </p>
      )}

      <BarraLista
        filtros={<>
          <p className="min-w-0 text-sm font-semibold">
            Historial de tasas
            <span className="ml-1.5 hidden text-xs font-normal text-muted-foreground 2xl:inline">Se registran solas a las 8:00 y a las 17:00 (hora de Venezuela).</span>
          </p>
          <div className="flex gap-1" role="group" aria-label="Período">
            {RANGOS.map((r) => (
              <Button key={r.valor} size="sm" variant={rango === r.valor ? "secondary" : "ghost"} className="h-7 px-2.5 text-xs"
                aria-pressed={rango === r.valor} onClick={() => setRango(r.valor)}>
                {r.etiqueta}
              </Button>
            ))}
          </div>
        </>}
        contador={cargando ? undefined : `${filas.length} ${filas.length === 1 ? "día" : "días"}`}
        acciones={<>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void actualizarAhora()} disabled={refreshing}>
            {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Actualizar ahora
          </Button>
          {puedeEditar && (
            <Button size="sm" className="gap-1.5" onClick={() => abrirEdicion(null)}><Plus className="h-3.5 w-3.5" /> Registrar tasa</Button>
          )}
        </>}
      />

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {cargando && filas.length === 0 ? <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        : filas.length === 0 ? <div className="py-10 text-center text-sm text-muted-foreground">No hay tasas registradas en este período.</div>
        : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>Fecha valor</TableHead>
              <TableHead className="text-right">BCV $</TableHead>
              <TableHead className="text-right">BCV €</TableHead>
              <TableHead className="text-right">Paralelo $</TableHead>
              <TableHead className="text-right">Brecha</TableHead>
              <TableHead>Fuente</TableHead>
              {puedeEditar && <TableHead className="text-right"><span className="sr-only">Acciones</span></TableHead>}
            </TableRow></TableHeader>
            <TableBody>
              {pagination.pageItems.map((f) => (
                <TableRow key={f.fecha}>
                  <TableCell className="whitespace-nowrap">
                    <span className="font-medium">{fechaDMA(f.fecha)}</span>
                    <span className="ml-1.5 text-xs capitalize text-muted-foreground">{diaSemana(f.fecha)}</span>
                    {f.fecha > hoy && <span className="ml-2 text-[11px] font-medium text-success">Publicada por adelantado</span>}
                    {f.bcvVigente && <span className="ml-2 text-[11px] text-muted-foreground">BCV del {fechaDMA(f.bcvVigente.desde).slice(0, 5)}</span>}
                  </TableCell>
                  {f.bcvVigente ? <>
                    <TableCell className="whitespace-nowrap text-right tabular-nums text-muted-foreground" title={`Sin publicación del BCV: rige la del ${fechaDMA(f.bcvVigente.desde)}`}>{formatearTasa(f.bcvVigente.usd)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums text-muted-foreground" title={`Sin publicación del BCV: rige la del ${fechaDMA(f.bcvVigente.desde)}`}>{formatearTasa(f.bcvVigente.eur)}</TableCell>
                  </> : <>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{formatearTasa(f.bcv_usd)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{formatearTasa(f.bcv_eur)}</TableCell>
                  </>}
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{formatearTasa(f.paralelo_usd)}</TableCell>
                  <TableCell className={cn("whitespace-nowrap text-right tabular-nums", f.brechaDia === null ? "text-muted-foreground" : "font-medium")}>
                    {formatearBrecha(f.brechaDia)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {f.editada_manual
                      ? <Badge variant="secondary" className="px-1.5 py-0 text-[11px] font-normal">Corregida a mano</Badge>
                      : <span className="text-xs text-muted-foreground">{[...new Set([f.fuente_bcv, f.fuente_paralelo].filter(Boolean))].join(" · ") || "—"}</span>}
                  </TableCell>
                  {puedeEditar && (
                    <TableCell className="whitespace-nowrap text-right">
                      <Button variant="ghost" size="icon" className="h-7 w-7" title={`Corregir tasas del ${fechaDMA(f.fecha)}`}
                        aria-label={`Corregir tasas del ${fechaDMA(f.fecha)}`} onClick={() => abrirEdicion(f)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      {filas.length > 0 && <DataTablePagination pagination={pagination} />}

      <Dialog open={!!editando} onOpenChange={(o) => { if (!o && !guardando) setEditando(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader className="text-left">
            <DialogTitle>{editando?.nueva ? "Registrar tasa" : `Corregir tasas del ${editando ? fechaDMA(editando.fecha) : ""}`}</DialogTitle>
            <DialogDescription>
              Una tasa corregida a mano no la cambia la carga automática. Usa la fecha valor del BCV. Si corriges el BCV dólar
              de hoy, también cambia la tasa con la que se registran cobros y retenciones.
            </DialogDescription>
          </DialogHeader>
          {editando && (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label htmlFor="ta-fecha" className="text-xs">Fecha valor</Label>
                <Input id="ta-fecha" type="date" className="h-10" value={editando.fecha} disabled={!editando.nueva}
                  onChange={(e) => setEditando({ ...editando, fecha: e.target.value })} />
              </div>
              {([["bcv_usd", "BCV dólar"], ["bcv_eur", "BCV euro"], ["paralelo_usd", "Dólar paralelo"]] as const).map(([campo, etiqueta]) => (
                <div key={campo} className={campo === "paralelo_usd" ? "col-span-2" : ""}>
                  <Label htmlFor={`ta-${campo}`} className="text-xs">{etiqueta} (Bs.)</Label>
                  <Input id={`ta-${campo}`} inputMode="decimal" className="h-10 tabular-nums" value={editando[campo]}
                    onChange={(e) => setEditando({ ...editando, [campo]: e.target.value })} />
                </div>
              ))}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-10" disabled={guardando} onClick={() => setEditando(null)}>Cancelar</Button>
            <Button className="h-10" disabled={guardando || !editando?.fecha} onClick={() => void guardar()}>
              {guardando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
