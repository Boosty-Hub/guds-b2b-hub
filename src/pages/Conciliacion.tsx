import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Loader2, Sparkles, Check, X, Search, ArrowLeft, ListChecks } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { useCurrency } from "@/contexts/CurrencyContext";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";

interface Banco { id: string; nombre: string; moneda: string; }
interface Extracto {
  id: string; nombre_archivo: string; moneda: string; fecha_desde: string | null; fecha_hasta: string | null;
  total_lineas: number; created_at: string; banco?: { nombre: string } | null;
}
interface LineaExtracto {
  id: string; fecha: string; monto: number; referencia: string | null; descripcion: string | null;
  estado: string; metodo_match: string | null; confianza: number | null;
  sugerencia_ia: { movimiento_bancario_id: string | null; confianza: number; motivo: string } | null;
  movimiento?: { referencia: string | null; descripcion: string | null } | null;
}
interface MovimientoCandidato { id: string; fecha: string; monto: number; tipo: string; referencia: string | null; descripcion: string | null }

const CAMPOS = [
  { key: "fecha", label: "Fecha" },
  { key: "monto", label: "Monto (+ entrada / − salida)" },
  { key: "referencia", label: "Referencia" },
  { key: "descripcion", label: "Descripción" },
] as const;

const Conciliacion = () => {
  const { toast } = useToast();
  const { formatPrice } = useCurrency();
  const [bancos, setBancos] = useState<Banco[]>([]);
  const [extractos, setExtractos] = useState<Extracto[]>([]);
  const [loading, setLoading] = useState(true);
  const [seleccionado, setSeleccionado] = useState<Extracto | null>(null);
  const [lineas, setLineas] = useState<LineaExtracto[]>([]);
  const [cargandoLineas, setCargandoLineas] = useState(false);
  const [sugiriendoIA, setSugiriendoIA] = useState(false);

  // Carga de extracto
  const [openCarga, setOpenCarga] = useState(false);
  const [pasoCarga, setPasoCarga] = useState<1 | 2>(1);
  const [bancoId, setBancoId] = useState("");
  const [nombreArchivo, setNombreArchivo] = useState("");
  const [filas, setFilas] = useState<string[][]>([]); // incluye la fila de encabezado (índice 0)
  const [mapeo, setMapeo] = useState<Record<string, string>>({}); // campo -> índice de columna (string)
  const [tieneEncabezado, setTieneEncabezado] = useState(true);
  const [guardandoExtracto, setGuardandoExtracto] = useState(false);

  // Match manual
  const [lineaBuscar, setLineaBuscar] = useState<LineaExtracto | null>(null);
  const [candidatos, setCandidatos] = useState<MovimientoCandidato[]>([]);
  const [buscandoCandidatos, setBuscandoCandidatos] = useState(false);
  const [bancoActualId, setBancoActualId] = useState("");

  const fetchAll = async () => {
    setLoading(true);
    const [{ data: bcs }, { data: exts }] = await Promise.all([
      supabase.from("bancos").select("id, nombre, moneda").eq("activo", true).order("nombre"),
      supabase.from("extractos_bancarios").select("id, nombre_archivo, moneda, fecha_desde, fecha_hasta, total_lineas, created_at, banco:bancos(nombre)").order("created_at", { ascending: false }),
    ]);
    setBancos((bcs as Banco[]) ?? []);
    setExtractos((exts as unknown as Extracto[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { fetchAll(); }, []);

  const cargarLineas = async (extracto: Extracto) => {
    setSeleccionado(extracto);
    setCargandoLineas(true);
    const { data } = await supabase.from("extracto_lineas")
      .select("id, fecha, monto, referencia, descripcion, estado, metodo_match, confianza, sugerencia_ia, movimiento:movimientos_bancarios(referencia, descripcion)")
      .eq("extracto_id", extracto.id).order("fecha", { ascending: true });
    setLineas((data as unknown as LineaExtracto[]) ?? []);
    setCargandoLineas(false);
  };

  const conciliadas = lineas.filter((l) => l.estado === "conciliado");
  const pendientes = lineas.filter((l) => l.estado === "pendiente");
  const descartadas = lineas.filter((l) => l.estado === "descartado");
  const pgConc = usePagination(conciliadas, 25);
  const pgPend = usePagination(pendientes, 25);
  const pgDesc = usePagination(descartadas, 25);
  const pgExtractos = usePagination(extractos, 25);

  // ── Carga: parseo de archivo ──────────────────────────────────────────
  // Un CSV se parsea como texto plano, a mano: XLSX "adivina" fechas en formato inglés
  // (mes/día) incluso pidiéndole raw:true, y rompe fechas día/mes como "11/08/2026".
  // Para .xlsx/.xls real sí usamos la librería (ahí el serial de fecha se maneja aparte).
  const parseCsvTexto = (texto: string): string[][] => {
    const lineasTexto = texto.split(/\r\n|\r|\n/).filter((l) => l.trim() !== "");
    const sep = lineasTexto[0]?.includes(";") && !lineasTexto[0]?.includes(",") ? ";" : ",";
    return lineasTexto.map((linea) => {
      const celdas: string[] = [];
      let actual = ""; let dentroComillas = false;
      for (let i = 0; i < linea.length; i++) {
        const ch = linea[i];
        if (ch === '"') { dentroComillas = !dentroComillas; continue; }
        if (ch === sep && !dentroComillas) { celdas.push(actual); actual = ""; continue; }
        actual += ch;
      }
      celdas.push(actual);
      return celdas.map((c) => c.trim());
    });
  };

  const handleFile = (file: File) => {
    setNombreArchivo(file.name);
    const esCsv = file.name.toLowerCase().endsWith(".csv");
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        let rows: (string | number)[][];
        if (esCsv) {
          rows = parseCsvTexto(String(e.target?.result ?? ""));
        } else {
          const wb = XLSX.read(e.target?.result, { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          rows = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1, defval: "", raw: true });
        }
        if (rows.length === 0) { toast({ title: "Archivo vacío", variant: "destructive" }); return; }
        setFilas(rows.map((r) => r.map((c) => String(c ?? ""))));
        setMapeo({});
        setPasoCarga(2);
      } catch {
        toast({ title: "No se pudo leer el archivo", description: "Verificá que sea un CSV o Excel válido.", variant: "destructive" });
      }
    };
    if (esCsv) reader.readAsText(file); else reader.readAsArrayBuffer(file);
  };

  const encabezados = filas[0] ?? [];
  const filasDatos = tieneEncabezado ? filas.slice(1) : filas;
  const columnasDisponibles = (filas[0] ?? []).map((_, i) => i);

  const confirmarCarga = async () => {
    if (!bancoId) { toast({ title: "Elegí un banco", variant: "destructive" }); return; }
    if (!mapeo.fecha || !mapeo.monto) { toast({ title: "Faltan columnas", description: "Fecha y Monto son obligatorios.", variant: "destructive" }); return; }
    const banco = bancos.find((b) => b.id === bancoId);

    const p_lineas = filasDatos
      .filter((row) => row.some((c) => c.trim() !== ""))
      .map((row) => {
        const fechaRaw = row[Number(mapeo.fecha)] ?? "";
        const montoRaw = (row[Number(mapeo.monto)] ?? "0").replace(/[^\d.,-]/g, "").replace(/\.(?=\d{3},)/g, "").replace(",", ".");
        const fecha = normalizarFecha(fechaRaw);
        return {
          fecha,
          monto: Number(montoRaw) || 0,
          referencia: mapeo.referencia ? row[Number(mapeo.referencia)] || null : null,
          descripcion: mapeo.descripcion ? row[Number(mapeo.descripcion)] || null : null,
        };
      })
      .filter((l) => l.fecha && l.monto !== 0);

    if (p_lineas.length === 0) { toast({ title: "No se encontraron filas válidas", variant: "destructive" }); return; }

    setGuardandoExtracto(true);
    const { data: extractoId, error } = await supabase.rpc("crear_extracto_bancario", {
      p_banco_id: bancoId, p_nombre_archivo: nombreArchivo, p_moneda: banco?.moneda || "USD", p_lineas,
    });
    if (error) { setGuardandoExtracto(false); toast({ title: "No se pudo cargar el extracto", description: error.message, variant: "destructive" }); return; }

    const { data: resAuto, error: errAuto } = await supabase.rpc("conciliar_extracto_automatico", { p_extracto_id: extractoId });
    setGuardandoExtracto(false);
    if (errAuto) { toast({ title: "Extracto cargado, pero falló el match automático", description: errAuto.message, variant: "destructive" }); }
    else {
      const r = resAuto as { conciliadas: number; pendientes: number };
      toast({ title: "Extracto cargado", description: `${r.conciliadas} conciliada(s) automáticamente, ${r.pendientes} por revisar.` });
    }
    setOpenCarga(false);
    setPasoCarga(1); setFilas([]); setMapeo({}); setBancoId(""); setNombreArchivo("");
    fetchAll();
  };

  // ── Revisión ───────────────────────────────────────────────────────────
  const sugerirConIA = async () => {
    if (!seleccionado) return;
    setSugiriendoIA(true);
    const { data: session } = await supabase.auth.getSession();
    const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/conciliar-ia-sugerir`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${session?.session?.access_token}` },
      body: JSON.stringify({ extracto_id: seleccionado.id }),
    });
    const body = await resp.json();
    setSugiriendoIA(false);
    if (!resp.ok || !body.ok) {
      toast({ title: "No se pudo obtener sugerencias de IA", description: body.error || `HTTP ${resp.status}`, variant: "destructive" });
      return;
    }
    toast({ title: "Sugerencias listas", description: `${body.con_sugerencia} de ${body.procesadas} línea(s) con un candidato sugerido.` });
    cargarLineas(seleccionado);
  };

  const aplicarSugerencia = async (linea: LineaExtracto) => {
    const { error } = await supabase.rpc("aplicar_sugerencia_ia", { p_linea_id: linea.id });
    if (error) { toast({ title: "No se pudo aplicar", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Conciliado con sugerencia de IA" });
    if (seleccionado) cargarLineas(seleccionado);
  };

  const descartar = async (linea: LineaExtracto) => {
    const { error } = await supabase.rpc("descartar_linea_extracto", { p_linea_id: linea.id, p_notas: null });
    if (error) { toast({ title: "No se pudo descartar", description: error.message, variant: "destructive" }); return; }
    if (seleccionado) cargarLineas(seleccionado);
  };

  const abrirBusquedaManual = async (linea: LineaExtracto) => {
    setLineaBuscar(linea);
    setBuscandoCandidatos(true);
    const tipo = linea.monto >= 0 ? "entrada" : "salida";
    const [{ data: movs }, { data: usados }] = await Promise.all([
      supabase.from("movimientos_bancarios").select("id, fecha, monto, tipo, referencia, descripcion")
        .eq("banco_id", bancoActualId).eq("tipo", tipo).order("fecha", { ascending: false }).limit(60),
      supabase.from("extracto_lineas").select("movimiento_bancario_id").not("movimiento_bancario_id", "is", null),
    ]);
    const idsUsados = new Set(((usados as { movimiento_bancario_id: string }[]) ?? []).map((u) => u.movimiento_bancario_id));
    setCandidatos(((movs as unknown as MovimientoCandidato[]) ?? []).filter((m) => !idsUsados.has(m.id)).slice(0, 30));
    setBuscandoCandidatos(false);
  };

  useEffect(() => {
    if (!seleccionado) return;
    supabase.from("extractos_bancarios").select("banco_id").eq("id", seleccionado.id).maybeSingle()
      .then(({ data }) => setBancoActualId((data as { banco_id: string } | null)?.banco_id || ""));
  }, [seleccionado]);

  const confirmarManual = async (movimientoId: string) => {
    if (!lineaBuscar) return;
    const { error } = await supabase.rpc("confirmar_match_extracto", { p_linea_id: lineaBuscar.id, p_movimiento_id: movimientoId });
    if (error) { toast({ title: "No se pudo conciliar", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Conciliado manualmente" });
    setLineaBuscar(null);
    if (seleccionado) cargarLineas(seleccionado);
  };

  if (seleccionado) {
    return (
      <MainLayout title={`Extracto — ${seleccionado.nombre_archivo}`}>
        <Button variant="ghost" className="mb-4 gap-2" onClick={() => setSeleccionado(null)}><ArrowLeft className="h-4 w-4" /> Volver a extractos</Button>

        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{seleccionado.banco?.nombre} · {seleccionado.total_lineas} línea(s)</p>
          <Button variant="outline" className="gap-2" onClick={sugerirConIA} disabled={sugiriendoIA || pendientes.length === 0}>
            {sugiriendoIA ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Sugerir con IA ({pendientes.length} pendientes)
          </Button>
        </div>

        {cargandoLineas ? (
          <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : (
          <Tabs defaultValue="pendientes">
            <TabsList>
              <TabsTrigger value="pendientes">Por conciliar ({pendientes.length})</TabsTrigger>
              <TabsTrigger value="conciliadas">Conciliadas ({conciliadas.length})</TabsTrigger>
              <TabsTrigger value="descartadas">Descartadas ({descartadas.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="pendientes" className="mt-4">
              <div className="rounded-xl border border-border bg-card shadow-sm">
                {pendientes.length === 0 ? (
                  <p className="p-8 text-center text-muted-foreground">No hay líneas por conciliar.</p>
                ) : (
                  <>
                    <Table>
                      <TableHeader>
                        <TableRow><TableHead>Fecha</TableHead><TableHead>Referencia</TableHead><TableHead className="text-right">Monto</TableHead><TableHead>Sugerencia IA</TableHead><TableHead className="text-right">Acción</TableHead></TableRow>
                      </TableHeader>
                      <TableBody>
                        {pgPend.pageItems.map((l) => (
                          <TableRow key={l.id}>
                            <TableCell className="text-muted-foreground">{new Date(l.fecha).toLocaleDateString("es-VE")}</TableCell>
                            <TableCell><p className="font-mono text-sm">{l.referencia || "—"}</p><p className="text-xs text-muted-foreground">{l.descripcion}</p></TableCell>
                            <TableCell className={`text-right font-semibold ${l.monto < 0 ? "text-destructive" : ""}`}>{formatPrice(l.monto)}</TableCell>
                            <TableCell>
                              {l.sugerencia_ia ? (
                                l.sugerencia_ia.movimiento_bancario_id ? (
                                  <div className="flex items-center gap-2">
                                    <Badge variant="outline" className="gap-1"><Sparkles className="h-3 w-3" /> {l.sugerencia_ia.confianza}%</Badge>
                                    <span className="text-xs text-muted-foreground max-w-xs truncate" title={l.sugerencia_ia.motivo}>{l.sugerencia_ia.motivo}</span>
                                  </div>
                                ) : <span className="text-xs text-muted-foreground">IA: sin candidato</span>
                              ) : <span className="text-xs text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                {l.sugerencia_ia?.movimiento_bancario_id && (
                                  <Button size="sm" variant="outline" className="gap-1" onClick={() => aplicarSugerencia(l)}><Check className="h-3.5 w-3.5" /> Aplicar</Button>
                                )}
                                <Button size="sm" variant="outline" className="gap-1" onClick={() => abrirBusquedaManual(l)}><Search className="h-3.5 w-3.5" /> Buscar</Button>
                                <Button size="sm" variant="ghost" className="gap-1 text-destructive" onClick={() => descartar(l)}><X className="h-3.5 w-3.5" /> Descartar</Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <DataTablePagination pagination={pgPend} />
                  </>
                )}
              </div>
            </TabsContent>

            <TabsContent value="conciliadas" className="mt-4">
              <div className="rounded-xl border border-border bg-card shadow-sm">
                {conciliadas.length === 0 ? <p className="p-8 text-center text-muted-foreground">Nada conciliado todavía.</p> : (
                  <>
                    <Table>
                      <TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Referencia</TableHead><TableHead className="text-right">Monto</TableHead><TableHead>Método</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {pgConc.pageItems.map((l) => (
                          <TableRow key={l.id}>
                            <TableCell className="text-muted-foreground">{new Date(l.fecha).toLocaleDateString("es-VE")}</TableCell>
                            <TableCell className="font-mono text-sm">{l.referencia || "—"}</TableCell>
                            <TableCell className="text-right font-semibold">{formatPrice(l.monto)}</TableCell>
                            <TableCell><Badge variant={l.metodo_match === "automatico" ? "default" : l.metodo_match === "ia" ? "outline" : "secondary"}>{l.metodo_match}{l.confianza != null ? ` · ${l.confianza}%` : ""}</Badge></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <DataTablePagination pagination={pgConc} />
                  </>
                )}
              </div>
            </TabsContent>

            <TabsContent value="descartadas" className="mt-4">
              <div className="rounded-xl border border-border bg-card shadow-sm">
                {descartadas.length === 0 ? <p className="p-8 text-center text-muted-foreground">Nada descartado.</p> : (
                  <>
                    <Table>
                      <TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Referencia</TableHead><TableHead className="text-right">Monto</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {pgDesc.pageItems.map((l) => (
                          <TableRow key={l.id}>
                            <TableCell className="text-muted-foreground">{new Date(l.fecha).toLocaleDateString("es-VE")}</TableCell>
                            <TableCell className="font-mono text-sm">{l.referencia || "—"}</TableCell>
                            <TableCell className="text-right font-semibold">{formatPrice(l.monto)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <DataTablePagination pagination={pgDesc} />
                  </>
                )}
              </div>
            </TabsContent>
          </Tabs>
        )}

        {/* Búsqueda manual */}
        <Dialog open={!!lineaBuscar} onOpenChange={(o) => !o && setLineaBuscar(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Buscar movimiento para conciliar</DialogTitle></DialogHeader>
            {lineaBuscar && (
              <div className="space-y-3 py-2">
                <p className="text-sm text-muted-foreground">
                  Línea: {new Date(lineaBuscar.fecha).toLocaleDateString("es-VE")} · {formatPrice(lineaBuscar.monto)} · {lineaBuscar.referencia}
                </p>
                {buscandoCandidatos ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
                ) : candidatos.length === 0 ? (
                  <p className="py-8 text-center text-muted-foreground">Sin movimientos sin conciliar de ese tipo en este banco.</p>
                ) : (
                  <div className="max-h-80 overflow-y-auto rounded-lg border border-border">
                    <Table>
                      <TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Referencia</TableHead><TableHead className="text-right">Monto</TableHead><TableHead></TableHead></TableRow></TableHeader>
                      <TableBody>
                        {candidatos.map((c) => (
                          <TableRow key={c.id}>
                            <TableCell className="text-muted-foreground">{new Date(c.fecha).toLocaleDateString("es-VE")}</TableCell>
                            <TableCell className="font-mono text-sm">{c.referencia || "—"}</TableCell>
                            <TableCell className="text-right font-semibold">{formatPrice(c.monto)}</TableCell>
                            <TableCell><Button size="sm" onClick={() => confirmarManual(c.id)}>Elegir</Button></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </MainLayout>
    );
  }

  return (
    <MainLayout title="Conciliación Bancaria">
      <div className="mb-4 flex justify-end">
        <Button className="gap-2" onClick={() => setOpenCarga(true)}><Upload className="h-4 w-4" /> Cargar extracto</Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : extractos.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center text-muted-foreground">
          <ListChecks className="mb-3 h-10 w-10 opacity-50" />
          <p>Todavía no cargaste ningún extracto bancario.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Archivo</TableHead><TableHead>Banco</TableHead><TableHead>Período</TableHead><TableHead className="text-center">Líneas</TableHead><TableHead>Cargado</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {pgExtractos.pageItems.map((e) => (
                <TableRow key={e.id} className="cursor-pointer hover:bg-muted/50" onClick={() => cargarLineas(e)}>
                  <TableCell className="font-medium">{e.nombre_archivo}</TableCell>
                  <TableCell className="text-muted-foreground">{e.banco?.nombre || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{e.fecha_desde} — {e.fecha_hasta}</TableCell>
                  <TableCell className="text-center">{e.total_lineas}</TableCell>
                  <TableCell className="text-muted-foreground">{new Date(e.created_at).toLocaleDateString("es-VE")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <DataTablePagination pagination={pgExtractos} />
        </div>
      )}

      {/* Carga de extracto: paso 1 (banco + archivo) / paso 2 (mapeo de columnas) */}
      <Dialog open={openCarga} onOpenChange={(o) => { setOpenCarga(o); if (!o) { setPasoCarga(1); setFilas([]); setMapeo({}); } }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Cargar extracto bancario</DialogTitle></DialogHeader>
          {pasoCarga === 1 ? (
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Banco *</Label>
                <Select value={bancoId} onValueChange={setBancoId}>
                  <SelectTrigger><SelectValue placeholder="Elegir banco" /></SelectTrigger>
                  <SelectContent>{bancos.map((b) => <SelectItem key={b.id} value={b.id}>{b.nombre} ({b.moneda})</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Archivo (CSV o Excel) *</Label>
                <Input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} disabled={!bancoId} />
                {!bancoId && <p className="text-xs text-muted-foreground">Elegí el banco primero.</p>}
              </div>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={tieneEncabezado} onChange={(e) => setTieneEncabezado(e.target.checked)} /> La primera fila es encabezado
              </label>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {CAMPOS.map((c) => (
                  <div key={c.key} className="space-y-2">
                    <Label>{c.label}{(c.key === "fecha" || c.key === "monto") && " *"}</Label>
                    <Select value={mapeo[c.key] || ""} onValueChange={(v) => setMapeo((m) => ({ ...m, [c.key]: v }))}>
                      <SelectTrigger><SelectValue placeholder="Columna..." /></SelectTrigger>
                      <SelectContent>
                        {columnasDisponibles.map((i) => (
                          <SelectItem key={i} value={String(i)}>{tieneEncabezado && encabezados[i] ? encabezados[i] : `Columna ${i + 1}`}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">Vista previa (primeras filas)</p>
                <div className="max-h-56 overflow-auto rounded-lg border border-border">
                  <Table>
                    <TableBody>
                      {filasDatos.slice(0, 5).map((row, i) => (
                        <TableRow key={i}>
                          {row.map((cell, j) => <TableCell key={j} className="whitespace-nowrap text-xs">{cell}</TableCell>)}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            {pasoCarga === 2 && <Button variant="outline" onClick={() => setPasoCarga(1)}>Atrás</Button>}
            <Button variant="outline" onClick={() => setOpenCarga(false)}>Cancelar</Button>
            {pasoCarga === 2 && (
              <Button onClick={confirmarCarga} disabled={guardandoExtracto} className="gap-2">
                {guardandoExtracto && <Loader2 className="h-4 w-4 animate-spin" />} Cargar y conciliar
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
};

/** "15/02/2026" (día/mes/año), "2026-02-15", o el serial de fecha de un Excel real -> "2026-02-15" (ISO). */
function normalizarFecha(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  // Serial de fecha de Excel (días desde 1899-12-30), típico al leer .xlsx con raw:true.
  if (/^\d{4,6}(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    if (serial > 20000 && serial < 80000) {
      const ms = Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000;
      return new Date(ms).toISOString().slice(0, 10);
    }
  }
  return null;
}

export default Conciliacion;
