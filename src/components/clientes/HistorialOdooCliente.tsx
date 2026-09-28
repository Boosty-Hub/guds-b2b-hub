import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { usePagination } from "@/hooks/use-pagination";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { CambiosOdoo } from "./EstadoEnvioOdoo";
import { historialCliente, type EscrituraCliente } from "./odooCliente";

const ESTADO: Record<EscrituraCliente["estado"], { label: string; cls: string }> = {
  pendiente: { label: "En cola", cls: "border-border bg-muted text-foreground" },
  procesando: { label: "Enviando…", cls: "border-primary/40 bg-primary/10 text-foreground" },
  hecha: { label: "Guardado en Odoo", cls: "border-success/50 bg-success/15 text-foreground" },
  simulada: { label: "Simulado", cls: "border-warning/60 bg-warning/15 text-foreground" },
  error: { label: "Error", cls: "border-destructive/50 bg-destructive/10 text-destructive" },
};

const fecha = (d: string) => new Date(d).toLocaleString("es-VE", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

const que = (e: EscrituraCliente) =>
  e.tipo === "cliente_contacto" ? "Teléfonos / dirección" : `${e.accion === "crear" ? "Nueva dirección" : "Dirección"}: ${e.direccion ?? "—"}`;

/** Últimos cambios del cliente enviados a Odoo (quién, cuándo, qué, estado), con reintentar los que fallaron. */
export function HistorialOdooCliente({ clienteId, version }: { clienteId: string; version: number }) {
  const { toast } = useToast();
  const [filas, setFilas] = useState<EscrituraCliente[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reintentando, setReintentando] = useState<string | null>(null);
  const pag = usePagination(filas, 10);

  const cargar = useCallback(async () => {
    try {
      const f = await historialCliente(clienteId, 20);
      setFilas(f); setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, [clienteId]);

  useEffect(() => { cargar(); }, [cargar, version]);

  // Mientras haya envíos en curso, se refresca solo
  const enCurso = filas.some((f) => f.estado === "pendiente" || f.estado === "procesando");
  useEffect(() => {
    if (!enCurso) return;
    const t = setInterval(cargar, 3000);
    return () => clearInterval(t);
  }, [enCurso, cargar]);

  const reintentar = async (id: string) => {
    setReintentando(id);
    const { error: e } = await supabase.rpc("reintentar_escritura_cliente", { p_id: id });
    setReintentando(null);
    if (e) { toast({ title: "No se pudo reintentar", description: e.message, variant: "destructive" }); return; }
    setFilas((fs) => fs.map((f) => (f.id === id ? { ...f, estado: "pendiente", error: null } : f)));
    setTimeout(cargar, 1500);
  };

  if (cargando) return <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  if (error) return <p className="p-6 text-center text-sm text-destructive">{error}</p>;
  if (!filas.length) return <p className="p-6 text-center text-sm text-muted-foreground">Todavía no se han enviado cambios de este cliente a Odoo.</p>;

  return (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <p className="text-xs text-muted-foreground">Últimos {filas.length} envíos a Odoo</p>
        <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs" onClick={cargar}><RefreshCw className="h-3.5 w-3.5" /> Actualizar</Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow><TableHead>Fecha</TableHead><TableHead>Qué</TableHead><TableHead>Cambios</TableHead><TableHead>Quién</TableHead><TableHead>Estado</TableHead></TableRow>
        </TableHeader>
        <TableBody>
          {pag.pageItems.map((f) => (
            <TableRow key={f.id}>
              <TableCell className="whitespace-nowrap align-top text-xs text-muted-foreground">{fecha(f.created_at)}</TableCell>
              <TableCell className="min-w-[160px] align-top text-xs font-medium">{que(f)}</TableCell>
              <TableCell className="min-w-[240px] max-w-[420px] align-top"><CambiosOdoo escritura={f} /></TableCell>
              <TableCell className="whitespace-nowrap align-top text-xs text-muted-foreground">{f.solicitado_por ?? "—"}</TableCell>
              <TableCell className="min-w-[140px] align-top">
                <Badge variant="outline" className={ESTADO[f.estado].cls}>{ESTADO[f.estado].label}</Badge>
                {f.estado === "error" && (
                  <>
                    <p className="mt-1 max-w-[260px] break-words text-[11px] text-destructive">{f.error}</p>
                    <Button size="sm" variant="outline" className="mt-1 h-6 gap-1 px-2 text-[11px]" onClick={() => reintentar(f.id)} disabled={reintentando === f.id}>
                      {reintentando === f.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />} Reintentar
                    </Button>
                  </>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <DataTablePagination pagination={pag} pageSizeOptions={[10, 25, 50]} />
    </>
  );
}
