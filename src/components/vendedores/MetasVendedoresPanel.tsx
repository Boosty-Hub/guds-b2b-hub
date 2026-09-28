import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { BarraLista } from "@/components/datos/BarraLista";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { useToast } from "@/hooks/use-toast";

// Vendedores → Metas (admin; decisión del dueño 28-sep: metas por vendedor y mes en USD, cargadas por administración).
// La meta se guarda en la empresa activa (guardar_meta_vendedor); la venta real tiene la misma definición que el portal del
// vendedor (resumen_vendedor): documentos de venta netos de IVA de sus clientes en el mes, en las empresas visibles.

interface FilaMeta { id: string; nombre: string; email: string; activo: boolean; clientes: number; meta: number; meta_empresa: number | null; venta: number; facturas: number }

const mesActual = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Caracas" }).slice(0, 7);
const moverMes = (m: string, d: number) => { const [a, n] = m.split("-").map(Number); const x = new Date(a, n - 1 + d, 1); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`; };

export function MetasVendedoresPanel({ pestanas }: { pestanas: ReactNode }) {
  const { formatPrice } = useCurrency();
  const { toast } = useToast();
  const { empresaActiva, soloLectura } = useEmpresa();
  const [mes, setMes] = useState(mesActual());
  const [filas, setFilas] = useState<FilaMeta[]>([]);
  const [cambios, setCambios] = useState<Record<string, string>>({});
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true);
    const [anio, m] = mes.split("-").map(Number);
    const { data, error: e } = await supabase.rpc("metas_vendedores", { p_anio: anio, p_mes: m });
    if (e) { setError(e.message); setFilas([]); }
    else {
      setError(null);
      setFilas(((data as { vendedores: FilaMeta[] } | null)?.vendedores ?? []).map((f) => ({
        ...f, meta: Number(f.meta), venta: Number(f.venta), meta_empresa: f.meta_empresa == null ? null : Number(f.meta_empresa),
      })));
    }
    setCambios({});
    setCargando(false);
  }, [mes]);
  useEffect(() => { cargar(); }, [cargar]);

  const texto = q.trim().toLowerCase();
  const visibles = filas.filter((f) => !texto || f.nombre.toLowerCase().includes(texto) || f.email.toLowerCase().includes(texto));
  const totales = useMemo(() => ({ meta: filas.reduce((s, f) => s + f.meta, 0), venta: filas.reduce((s, f) => s + f.venta, 0) }), [filas]);
  const pendientes = Object.entries(cambios).filter(([id, v]) => {
    const f = filas.find((x) => x.id === id);
    const n = v.trim() === "" ? 0 : Number(v.replace(",", "."));
    return f && Number.isFinite(n) && n >= 0 && Math.abs(n - (f.meta_empresa ?? 0)) > 0.004;
  });
  const invalidos = Object.values(cambios).some((v) => v.trim() !== "" && !(Number(v.replace(",", ".")) >= 0));

  const guardar = async () => {
    setGuardando(true);
    const [anio, m] = mes.split("-").map(Number);
    let errores = 0;
    for (const [id, v] of pendientes) {
      const n = v.trim() === "" ? 0 : Number(v.replace(",", "."));
      const { error: e } = await supabase.rpc("guardar_meta_vendedor", { p_vendedor_id: id, p_anio: anio, p_mes: m, p_meta: n });
      if (e) { errores++; toast({ title: "No se pudo guardar una meta", description: e.message, variant: "destructive" }); break; }
    }
    setGuardando(false);
    if (!errores) toast({ title: "Metas guardadas", description: `${pendientes.length} ${pendientes.length === 1 ? "meta" : "metas"} en ${empresaActiva?.nombre_corto ?? "la empresa activa"}.` });
    cargar();
  };

  const nombreMes = new Date(`${mes}-15T12:00:00`).toLocaleDateString("es-VE", { month: "long", year: "numeric" });
  const avanceTotal = totales.meta > 0 ? Math.round((totales.venta / totales.meta) * 100) : 0;

  return (
    <div data-testid="metas-vendedores">
      <BarraLista pestanas={pestanas} busqueda={q} onBusqueda={setQ} placeholder="Buscar vendedor..."
        filtros={
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setMes((x) => moverMes(x, -1))} aria-label="Mes anterior"><ChevronLeft className="h-4 w-4" /></Button>
            <Input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} className="h-8 w-40 text-[13px]" aria-label="Mes" data-testid="mes-metas" />
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setMes((x) => moverMes(x, 1))} aria-label="Mes siguiente"><ChevronRight className="h-4 w-4" /></Button>
          </div>
        }
        contador={cargando ? undefined : `${visibles.length} vendedores`}
        acciones={
          <Button size="sm" className="gap-1.5" onClick={guardar} disabled={soloLectura || guardando || pendientes.length === 0 || invalidos} data-testid="guardar-metas">
            {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Guardar{pendientes.length ? ` (${pendientes.length})` : ""}
          </Button>
        } />

      <KpiStrip items={[
        { label: `Meta de ${nombreMes}`, valor: formatPrice(totales.meta), tono: "primario" },
        { label: "Venta real", valor: formatPrice(totales.venta), detalle: "neto de IVA · como el portal del vendedor", tono: "positivo" },
        { label: "Avance", valor: totales.meta > 0 ? `${avanceTotal}%` : "—", tono: avanceTotal >= 100 ? "positivo" : "normal" },
      ]} />

      <p className="mb-2 text-xs text-muted-foreground">
        {soloLectura
          ? "Modo consulta (Ambas empresas): ves la suma de las metas de las dos empresas. Elige GUDS o Quirutec en el menú superior para cargarlas."
          : <>Las metas se cargan en <strong>{empresaActiva?.nombre_corto}</strong> (en USD). Deja el campo vacío o en 0 para quitarla. La venta real es la de las empresas visibles.</>}
      </p>

      <div className="rounded-lg border border-border bg-card">
        {cargando ? <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          : error ? <p className="p-4 text-sm text-destructive">{error}</p>
          : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Vendedor</TableHead>
                <TableHead className="text-center">Clientes</TableHead>
                <TableHead className="text-right">{soloLectura ? "Meta" : `Meta ${empresaActiva?.nombre_corto ?? ""}`}</TableHead>
                <TableHead className="text-right">Venta del mes</TableHead>
                <TableHead className="w-[220px]">Avance</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {visibles.map((f) => {
                  const valor = cambios[f.id] ?? (f.meta_empresa != null ? String(f.meta_empresa) : "");
                  const metaMostrada = soloLectura ? f.meta : (cambios[f.id] !== undefined ? Number(cambios[f.id].replace(",", ".")) || 0 : f.meta);
                  const av = metaMostrada > 0 ? Math.round((f.venta / metaMostrada) * 100) : 0;
                  return (
                    <TableRow key={f.id} className={cn(!f.activo && "opacity-60")} data-testid="fila-meta">
                      <TableCell>
                        <span className="block max-w-[260px] truncate font-medium" title={f.nombre}>{f.nombre}{!f.activo && <span className="ml-1 text-xs font-normal text-muted-foreground">(inactivo)</span>}</span>
                        <span className="block max-w-[260px] truncate text-[11px] text-muted-foreground">{f.email}</span>
                      </TableCell>
                      <TableCell className="text-center tabular-nums">{f.clientes}</TableCell>
                      <TableCell className="text-right">
                        {soloLectura ? <span className="tabular-nums">{f.meta > 0 ? formatPrice(f.meta) : "—"}</span> : (
                          <Input type="text" inputMode="decimal" value={valor} placeholder="Sin meta" aria-label={`Meta de ${f.nombre}`}
                            className={cn("ml-auto h-8 w-32 text-right tabular-nums", cambios[f.id] !== undefined && "border-primary")}
                            onChange={(e) => setCambios((c) => ({ ...c, [f.id]: e.target.value.replace(/[^\d.,]/g, "") }))} data-testid="input-meta" />
                        )}
                        {!soloLectura && f.meta > (f.meta_empresa ?? 0) + 0.004 && <span className="mt-0.5 block text-[10px] text-muted-foreground">Total empresas {formatPrice(f.meta)}</span>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{formatPrice(f.venta)}<span className="block text-[10px] text-muted-foreground">{f.facturas} facturas</span></TableCell>
                      <TableCell>
                        {metaMostrada > 0 ? (
                          <div className="flex items-center gap-2">
                            <Progress value={Math.min(100, av)} className="h-2 flex-1" />
                            <span className={cn("w-10 text-right text-xs tabular-nums", av >= 100 && "font-semibold text-success")}>{av}%</span>
                          </div>
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
      </div>
    </div>
  );
}
