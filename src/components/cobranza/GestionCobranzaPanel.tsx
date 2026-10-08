import { useCallback, useEffect, useState } from "react";
import { Gavel, History, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { fmtUsd, fechaHora } from "@/components/estado-cuenta/formato";
import { fechaDMA, hoyCaracas } from "@/lib/fechas";
import { cn } from "@/lib/utils";

// Gestión de cobranza (22g · T5 del plan de reportes de finanzas): deuda activa o incobrable (casos con abogados o cobranza
// externa) del cliente, con responsable, nota y desde cuándo, y excepciones por documento. No baja el saldo: la Antigüedad la
// muestra aparte. Ver: Cuentas → Ver; cambiar: Cuentas → Editar (la base también lo exige).

type Clasif = "activa" | "incobrable";
interface Gestion { id: string; clasificacion: Clasif; responsable: string | null; nota: string | null; desde: string; origen: "excel" | "manual"; actualizado: string; por: string | null }
interface GestionDoc { id: string; factura_id: string; numero: string; tipo: string; emision: string | null; saldo: number; clasificacion: Clasif; responsable: string | null; nota: string | null; desde: string; origen: string }
interface Historial { fecha: string; accion: "crear" | "cambiar" | "quitar"; clasificacion: Clasif; responsable: string | null; nota: string | null; desde: string; por: string | null; documento: string | null }
interface DatosGestion { cliente: Gestion | null; documentos: GestionDoc[]; historial: Historial[] }
export interface DocumentoGestionable { factura_id: string | null; numero: string; tipo: string; saldo: number }

const TEXTO: Record<Clasif, string> = { activa: "Deuda activa", incobrable: "Incobrable" };
const TIPO: Record<string, string> = { factura: "Factura", nota_debito: "ND", nota_credito: "NC" };

export function GestionCobranzaPanel({ clienteId, puedeEditar, documentos }: {
  clienteId: string;
  puedeEditar: boolean;
  /** Documentos abiertos del estado de cuenta, para marcar uno como excepción */
  documentos: DocumentoGestionable[];
}) {
  const { toast } = useToast();
  const [d, setD] = useState<DatosGestion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [form, setForm] = useState<{ clasificacion: Clasif; responsable: string; nota: string; desde: string }>({ clasificacion: "activa", responsable: "", nota: "", desde: hoyCaracas() });
  const [doc, setDoc] = useState<{ factura_id: string; clasificacion: Clasif }>({ factura_id: "", clasificacion: "incobrable" });
  const [verHistorial, setVerHistorial] = useState(false);

  const cargar = useCallback(async () => {
    const { data, error: e } = await supabase.rpc("gestion_cobranza_cliente", { p_cliente: clienteId });
    if (e) setError(e.message); else { setD(data as DatosGestion); setError(null); }
  }, [clienteId]);
  useEffect(() => { cargar(); }, [cargar]);

  const actual: Clasif = d?.cliente?.clasificacion ?? "activa";
  // La excepción de un documento es, por defecto, lo contrario de la clasificación del cliente
  useEffect(() => { setDoc((x) => ({ ...x, clasificacion: actual === "incobrable" ? "activa" : "incobrable" })); }, [actual]);
  const abrirEdicion = () => {
    setForm({ clasificacion: actual, responsable: d?.cliente?.responsable ?? "", nota: d?.cliente?.nota ?? "", desde: d?.cliente?.desde ?? hoyCaracas() });
    setEditando(true);
  };
  const guardar = async (args: { p_factura?: string | null; p_clasificacion: Clasif; p_responsable?: string | null; p_nota?: string | null; p_desde?: string | null }, exito: string) => {
    setGuardando(true);
    const { error: e } = await supabase.rpc("guardar_gestion_cobranza", { p_cliente: clienteId, p_factura: null, p_responsable: null, p_nota: null, p_desde: null, ...args });
    setGuardando(false);
    if (e) { toast({ title: "No se pudo guardar", description: e.message, variant: "destructive" }); return false; }
    toast({ title: exito });
    await cargar();
    return true;
  };
  const quitar = async (id: string) => {
    setGuardando(true);
    const { error: e } = await supabase.rpc("quitar_gestion_cobranza", { p_id: id });
    setGuardando(false);
    if (e) { toast({ title: "No se pudo quitar", description: e.message, variant: "destructive" }); return; }
    toast({ title: "Excepción quitada" });
    cargar();
  };

  const conExcepcion = new Set((d?.documentos ?? []).map((x) => x.factura_id));
  const candidatos = documentos.filter((x) => x.factura_id && !conExcepcion.has(x.factura_id) && Math.abs(x.saldo) > 0.009);

  return (
    <div className="rounded-lg border border-border bg-card" data-testid="gc-panel">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <div className={cn("rounded-lg p-1.5", actual === "incobrable" ? "bg-destructive/10" : "bg-primary/10")}><Gavel className={cn("h-4 w-4", actual === "incobrable" ? "text-destructive" : "text-primary")} /></div>
          <h2 className="text-[13px] font-semibold">Gestión de cobranza</h2>
        </div>
        {puedeEditar && d && !editando && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={abrirEdicion} data-testid="gc-cambiar">Cambiar</Button>}
      </div>
      {error ? <p className="p-3 text-xs text-destructive">{error}</p> : !d ? (
        <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="space-y-2 p-3 text-xs">
          {!editando ? (
            <div data-testid="gc-actual">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant={actual === "incobrable" ? "destructive" : "outline"} data-testid="gc-clasificacion">{TEXTO[actual]}</Badge>
                {d.cliente && <span className="text-muted-foreground">desde {fechaDMA(d.cliente.desde)}</span>}
              </div>
              {d.cliente?.responsable && <p className="mt-1"><span className="text-muted-foreground">Responsable:</span> {d.cliente.responsable}</p>}
              {d.cliente?.nota && <p className="mt-0.5 whitespace-pre-line text-muted-foreground">{d.cliente.nota}</p>}
              {!d.cliente && <p className="mt-1 text-muted-foreground">Sin marca: la deuda se gestiona normalmente.</p>}
              {d.cliente && <p className="mt-1 text-[11px] text-muted-foreground">{d.cliente.origen === "excel" ? "Cargado del Excel de finanzas" : `Por ${d.cliente.por ?? "—"}`} · {fechaHora(d.cliente.actualizado)}</p>}
            </div>
          ) : (
            <div className="space-y-2" data-testid="gc-form">
              <div className="grid grid-cols-2 gap-2">
                <Select value={form.clasificacion} onValueChange={(v) => setForm({ ...form, clasificacion: v as Clasif })}>
                  <SelectTrigger className="h-8 text-xs" aria-label="Clasificación" data-testid="gc-form-clasificacion"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="activa">Deuda activa</SelectItem><SelectItem value="incobrable">Incobrable</SelectItem></SelectContent>
                </Select>
                <Input type="date" value={form.desde} max={hoyCaracas()} onChange={(e) => setForm({ ...form, desde: e.target.value })} className="h-8 text-xs" aria-label="Desde" />
              </div>
              <Input value={form.responsable} onChange={(e) => setForm({ ...form, responsable: e.target.value })} maxLength={120} className="h-8 text-xs"
                placeholder="Responsable (abogado, cobranza externa…)" aria-label="Responsable" />
              <Textarea value={form.nota} onChange={(e) => setForm({ ...form, nota: e.target.value })} maxLength={1000} rows={2} className="text-xs" placeholder="Nota" aria-label="Nota" />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditando(false)} disabled={guardando}>Cancelar</Button>
                <Button size="sm" className="h-7 text-xs" disabled={guardando || !form.desde} data-testid="gc-guardar"
                  onClick={async () => { if (await guardar({ p_clasificacion: form.clasificacion, p_responsable: form.responsable, p_nota: form.nota, p_desde: form.desde }, "Gestión de cobranza guardada")) setEditando(false); }}>
                  {guardando && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}Guardar
                </Button>
              </div>
            </div>
          )}

          {(d.documentos.length > 0 || (puedeEditar && candidatos.length > 0)) && (
            <div className="border-t border-border pt-2">
              <p className="mb-1 font-medium">Documentos con otra clasificación ({d.documentos.length})</p>
              {d.documentos.length > 0 && (
                <ul className="max-h-40 divide-y divide-border overflow-y-auto rounded border border-border">
                  {d.documentos.map((x) => (
                    <li key={x.id} className="flex items-center justify-between gap-2 px-2 py-1" data-testid="gc-doc">
                      <span className="min-w-0 truncate">{TIPO[x.tipo] ?? x.tipo} {x.numero} <span className="text-muted-foreground">· {fmtUsd(x.saldo)}</span></span>
                      <span className="flex shrink-0 items-center gap-1">
                        <Badge variant={x.clasificacion === "incobrable" ? "destructive" : "outline"} className="px-1.5 py-0 text-[10px]">{TEXTO[x.clasificacion]}</Badge>
                        {puedeEditar && <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={() => quitar(x.id)} disabled={guardando}>Quitar</Button>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {puedeEditar && candidatos.length > 0 && (
                <div className="mt-1.5 flex gap-1.5">
                  <Select value={doc.factura_id} onValueChange={(v) => setDoc({ ...doc, factura_id: v })}>
                    <SelectTrigger className="h-7 min-w-0 flex-1 text-xs" aria-label="Documento" data-testid="gc-doc-select"><SelectValue placeholder="Documento…" /></SelectTrigger>
                    <SelectContent>{candidatos.map((x) => <SelectItem key={x.factura_id!} value={x.factura_id!}>{TIPO[x.tipo] ?? x.tipo} {x.numero} · {fmtUsd(x.saldo)}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={doc.clasificacion} onValueChange={(v) => setDoc({ ...doc, clasificacion: v as Clasif })}>
                    <SelectTrigger className="h-7 w-28 text-xs" aria-label="Clasificación del documento"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="incobrable">Incobrable</SelectItem><SelectItem value="activa">Activa</SelectItem></SelectContent>
                  </Select>
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!doc.factura_id || guardando || doc.clasificacion === actual} data-testid="gc-agregar-doc"
                    title={doc.clasificacion === actual ? "Es la misma clasificación del cliente" : undefined}
                    onClick={async () => { if (await guardar({ p_factura: doc.factura_id, p_clasificacion: doc.clasificacion }, "Documento marcado")) setDoc({ ...doc, factura_id: "" }); }}>
                    Marcar
                  </Button>
                </div>
              )}
            </div>
          )}

          {d.historial.length > 0 && (
            <div className="border-t border-border pt-2">
              <button type="button" className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground" onClick={() => setVerHistorial((v) => !v)} data-testid="gc-historial">
                <History className="h-3 w-3" /> Historial ({d.historial.length})
              </button>
              {verHistorial && (
                <ul className="mt-1 space-y-1">
                  {d.historial.map((h, i) => (
                    <li key={i} className="text-[11px]">
                      <span className="text-muted-foreground">{fechaHora(h.fecha)} · {h.por ?? "—"}:</span>{" "}
                      {h.accion === "quitar" ? "quitó" : h.accion === "crear" ? "marcó" : "cambió a"} {h.documento ? `${h.documento} ` : "el cliente "}
                      {h.accion !== "quitar" && <b>{TEXTO[h.clasificacion]}</b>}{h.responsable ? ` · ${h.responsable}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
