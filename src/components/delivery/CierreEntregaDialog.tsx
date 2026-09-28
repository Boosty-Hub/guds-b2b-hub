import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, CalendarClock, Camera, CheckCircle2, Eraser, Loader2, Minus, PackageMinus, Plus, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { compressImage } from "@/lib/image";
import { diaCaracas } from "@/components/delivery/fechas";
import {
  MOTIVOS_LINEA, MOTIVOS_RECHAZO, MOTIVOS_REPROGRAMACION, siguienteDiaHabil, fmtCantidad,
  type EntregaReparto, type ResultadoCierre, type Motivo,
} from "@/components/delivery/entregas";

/** Pad de firma sobre canvas (dedo, lápiz o mouse). */
export function SignaturePad({ canvasRef, onTrazo }: { canvasRef: React.RefObject<HTMLCanvasElement>; onTrazo?: () => void }) {
  const drawing = useRef(false);
  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!; const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  };
  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = true; const ctx = canvasRef.current!.getContext("2d")!;
    ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.strokeStyle = "#1a2230";
    const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return; const ctx = canvasRef.current!.getContext("2d")!;
    const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); onTrazo?.();
  };
  const end = () => { drawing.current = false; };
  return (
    <canvas
      ref={canvasRef} width={480} height={180} aria-label="Firma de quien recibe"
      className="h-44 w-full touch-none rounded-lg border border-border bg-white"
      onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end}
    />
  );
}

const OPCIONES: { v: ResultadoCierre; titulo: string; texto: string; icono: typeof CheckCircle2; cls: string }[] = [
  { v: "completa", titulo: "Entregado completo", texto: "Recibió todo lo que llevas", icono: CheckCircle2, cls: "border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-100" },
  { v: "incompleta", titulo: "Entregado incompleto", texto: "Faltó o devolvió algún producto", icono: PackageMinus, cls: "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-100" },
  { v: "rechazada", titulo: "Rechazado", texto: "No recibió nada", icono: XCircle, cls: "border-red-300 bg-red-50 text-red-900 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-100" },
  { v: "reprogramada", titulo: "Reprogramar", texto: "Se entrega otro día", icono: CalendarClock, cls: "border-sky-300 bg-sky-50 text-sky-900 hover:bg-sky-100 dark:bg-sky-500/10 dark:text-sky-100" },
];

function SelectMotivo({ valor, onCambio, opciones, placeholder = "Elige el motivo", id }: { valor: string; onCambio: (v: string) => void; opciones: Motivo[]; placeholder?: string; id?: string }) {
  return (
    <Select value={valor} onValueChange={onCambio}>
      <SelectTrigger id={id} className="h-11"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>{opciones.map((m) => <SelectItem key={m.v} value={m.v}>{m.l}</SelectItem>)}</SelectContent>
    </Select>
  );
}

/** Cierre de una entrega con uno de los 4 resultados y su evidencia (app del repartidor). */
export function CierreEntregaDialog({ entrega, onClose, onCerrada }: { entrega: EntregaReparto | null; onClose: () => void; onCerrada: () => void }) {
  const { toast } = useToast();
  const [resultado, setResultado] = useState<ResultadoCierre | null>(null);
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [motivosLinea, setMotivosLinea] = useState<Record<string, string>>({});
  const [receptor, setReceptor] = useState("");
  const [notas, setNotas] = useState("");
  const [motivo, setMotivo] = useState("");
  const [detalle, setDetalle] = useState("");
  const [fecha, setFecha] = useState(siguienteDiaHabil());
  const [foto, setFoto] = useState<File | null>(null);
  const [firmado, setFirmado] = useState(false);
  const [busy, setBusy] = useState(false);
  const sigRef = useRef<HTMLCanvasElement>(null);

  // Al abrir otra entrega, todo vuelve a empezar
  useEffect(() => {
    setResultado(null); setReceptor(""); setNotas(""); setMotivo(""); setDetalle(""); setFecha(siguienteDiaHabil());
    setFoto(null); setFirmado(false); setMotivosLinea({});
    setCantidades(Object.fromEntries((entrega?.lineas ?? []).map((l) => [l.id, String(Number(l.esperada) || 0)])));
  }, [entrega?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const lineas = useMemo(() => entrega?.lineas ?? [], [entrega]);
  const cant = (id: string) => { const n = Number(String(cantidades[id] ?? "").replace(",", ".")); return Number.isFinite(n) ? n : NaN; };
  const conDiferencia = lineas.filter((l) => Number(l.esperada) > 0 && cant(l.id) < Number(l.esperada));
  const quedaPendiente = resultado === "incompleta"
    ? lineas.some((l) => Number(l.esperada) < Number(l.demandada)) || conDiferencia.some((l) => motivosLinea[l.id] === "falto_camion")
    : resultado === "completa" && lineas.some((l) => Number(l.esperada) < Number(l.demandada));
  const opciones = OPCIONES.filter((o) => o.v !== "incompleta" || entrega?.es_documento);

  const limpiarFirma = () => { const c = sigRef.current; if (c) c.getContext("2d")!.clearRect(0, 0, c.width, c.height); setFirmado(false); };

  const falta = (): string | null => {
    if (!resultado) return "Elige el resultado";
    if (resultado === "completa" || resultado === "incompleta") {
      if (resultado === "incompleta") {
        for (const l of lineas) {
          const n = cant(l.id);
          if (Number(l.esperada) > 0 && (!Number.isFinite(n) || n < 0 || n > Number(l.esperada))) return `Revisa la cantidad de ${l.producto}`;
          if (Number(l.esperada) > 0 && n < Number(l.esperada) && !motivosLinea[l.id]) return `Indica por qué faltó ${l.producto}`;
        }
        if (!conDiferencia.length) return "No hay diferencias: usa «Entregado completo»";
        if (lineas.reduce((s, l) => s + (Number(l.esperada) > 0 ? cant(l.id) : 0), 0) <= 0) return "Si no se entregó nada, usa «Rechazado»";
      }
      if (!receptor.trim()) return "Escribe el nombre de quien recibe";
      if (!foto) return "Toma la foto de la entrega";
      if (!firmado) return "Pide la firma de quien recibe";
    } else if (resultado === "rechazada") {
      if (!motivo) return "Elige el motivo del rechazo";
      if (motivo === "otro" && !detalle.trim()) return "Describe el motivo";
      if (!foto) return "Toma una foto (mercancía, documento o fachada)";
    } else {
      if (!motivo) return "Elige el motivo";
      if (motivo === "otro" && !detalle.trim()) return "Describe el motivo";
      if (!fecha || fecha < diaCaracas()) return "La fecha nueva debe ser de hoy en adelante";
    }
    return null;
  };

  const subir = async (blob: Blob, nombre: string) => {
    const ruta = `${entrega!.id}/${nombre}`;
    const { error } = await supabase.storage.from("evidencias-entrega").upload(ruta, blob, { upsert: false, contentType: blob.type || "image/jpeg" });
    if (error) throw new Error(`No se pudo subir la evidencia (${error.message}). La entrega no se cerró: inténtalo de nuevo.`);
    return ruta;
  };

  const confirmar = async () => {
    if (!entrega || !resultado) return;
    const aviso = falta();
    if (aviso) { toast({ title: "Falta información", description: aviso, variant: "destructive" }); return; }
    setBusy(true);
    try {
      const marca = Date.now();
      let rutaFirma: string | null = null;
      let rutaFoto: string | null = null;
      if (resultado === "completa" || resultado === "incompleta") {
        const blob: Blob | null = await new Promise((res) => sigRef.current!.toBlob(res, "image/png"));
        if (!blob) throw new Error("No se pudo leer la firma");
        rutaFirma = await subir(blob, `firma-${marca}.png`);
      }
      if (foto) {
        // Las fotos del teléfono pesan 2–6 MB: se comprimen antes de subir
        const comprimida = await compressImage(foto, 1600, 0.78).catch(() => foto);
        rutaFoto = await subir(comprimida, `foto-${marca}.jpg`);
      }
      const datos: Record<string, unknown> = { receptor: receptor.trim() || null, notas: notas.trim() || null, firma: rutaFirma, foto: rutaFoto };
      if (resultado === "incompleta") {
        datos.lineas = lineas.map((l) => ({ item_id: l.id, entregada: Number(l.esperada) > 0 ? cant(l.id) : 0,
          motivo: Number(l.esperada) > 0 && cant(l.id) < Number(l.esperada) ? motivosLinea[l.id] : null }));
      }
      if (resultado === "rechazada" || resultado === "reprogramada") { datos.motivo = motivo; datos.motivo_detalle = detalle.trim() || null; }
      if (resultado === "reprogramada") datos.fecha = fecha;
      const { data, error } = await supabase.rpc("cerrar_entrega", { p_entrega_id: entrega.id, p_resultado: resultado, p_datos: datos });
      if (error) throw new Error(error.message);
      const r = data as { escritura_id: string | null } | null;
      toast({
        title: resultado === "completa" ? "Entrega cerrada" : resultado === "incompleta" ? "Entrega incompleta registrada"
          : resultado === "rechazada" ? "Rechazo registrado" : "Entrega reprogramada",
        description: r?.escritura_id ? "El resultado se envía a Odoo." : resultado === "reprogramada" ? "Vuelve a la cola de despacho con la fecha nueva." : `${entrega.numero ?? ""} actualizada.`,
      });
      onCerrada();
    } catch (e) {
      toast({ title: "No se pudo cerrar la entrega", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const bloqueFoto = (etiqueta: string) => (
    <div className="space-y-1">
      <label htmlFor="foto-evidencia" className="flex items-center gap-1.5 text-sm font-medium"><Camera className="h-4 w-4" />{etiqueta}</label>
      <Input id="foto-evidencia" type="file" accept="image/*" capture="environment" className="h-11 pt-2.5" onChange={(e) => setFoto(e.target.files?.[0] || null)} />
      {foto && <p className="text-xs text-emerald-700 dark:text-emerald-300">Foto lista: {foto.name}</p>}
    </div>
  );
  const bloqueRecibe = (
    <>
      <div className="space-y-1">
        <label htmlFor="receptor" className="text-sm font-medium">Nombre de quien recibe</label>
        <Input id="receptor" className="h-11" value={receptor} onChange={(e) => setReceptor(e.target.value)} placeholder="Ej. Ana Pérez (encargada)" autoComplete="off" />
      </div>
      {bloqueFoto("Foto de la entrega")}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Firma de quien recibe</span>
          <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={limpiarFirma}><Eraser className="mr-1 h-3.5 w-3.5" />Limpiar</Button>
        </div>
        <SignaturePad canvasRef={sigRef} onTrazo={() => setFirmado(true)} />
      </div>
    </>
  );

  const titulo = OPCIONES.find((o) => o.v === resultado)?.titulo;
  return (
    <Dialog open={!!entrega} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-full max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-auto sm:max-h-[92vh] sm:max-w-lg sm:rounded-lg">
        {entrega && (
          <>
            <DialogHeader className="border-b border-border px-4 py-3 text-left">
              <DialogTitle className="flex items-center gap-2 pr-6 text-base">
                {resultado && (
                  <button type="button" onClick={() => setResultado(null)} disabled={busy} className="-ml-1 rounded p-1 hover:bg-muted" aria-label="Volver">
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                )}
                {titulo ?? "Cerrar entrega"} · <span className="font-mono text-sm">{entrega.numero}</span>
              </DialogTitle>
              <DialogDescription className="truncate">{entrega.contacto || entrega.cliente}</DialogDescription>
            </DialogHeader>

            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
              {!resultado && (
                <div className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2">
                  {opciones.map((o) => (
                    <button key={o.v} type="button" onClick={() => { setResultado(o.v); setMotivo(""); }}
                      className={`flex min-h-[112px] flex-col items-start justify-between rounded-xl border-2 p-3 text-left transition-colors ${o.cls}`}>
                      <o.icono className="h-7 w-7" />
                      <span><span className="block text-[15px] font-semibold leading-tight">{o.titulo}</span><span className="block text-xs opacity-80">{o.texto}</span></span>
                    </button>
                  ))}
                </div>
              )}

              {resultado === "completa" && (
                <>
                  <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                    <p className="font-medium">Se entrega todo lo que llevas:</p>
                    <ul className="mt-1 space-y-0.5 text-muted-foreground">
                      {lineas.filter((l) => Number(l.esperada) > 0).map((l) => <li key={l.id} className="flex justify-between gap-2"><span className="min-w-0 truncate">{l.producto}</span><span className="shrink-0 tabular-nums">{fmtCantidad(l.esperada)}</span></li>)}
                    </ul>
                    {quedaPendiente && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Lo que Odoo no tenía reservado queda pendiente para otra entrega.</p>}
                  </div>
                  {bloqueRecibe}
                </>
              )}

              {resultado === "incompleta" && (
                <>
                  <div className="space-y-2">
                    <p className="text-sm font-medium">¿Cuánto recibió de cada producto?</p>
                    {lineas.map((l) => {
                      const esp = Number(l.esperada) || 0;
                      const n = cant(l.id);
                      const dif = esp > 0 && n < esp;
                      return (
                        <div key={l.id} className={`rounded-lg border p-3 ${dif ? "border-amber-300 bg-amber-50/60 dark:bg-amber-500/10" : "border-border"}`}>
                          <p className="text-sm font-medium leading-snug">{l.producto}</p>
                          {esp <= 0 ? (
                            <p className="mt-1 text-xs text-muted-foreground">No salió en el camión (Odoo no lo tenía reservado).</p>
                          ) : (
                            <>
                              <div className="mt-2 flex items-center gap-2">
                                <Button type="button" variant="outline" size="icon" className="h-11 w-11 shrink-0" aria-label={`Menos ${l.producto}`}
                                  onClick={() => setCantidades((c) => ({ ...c, [l.id]: String(Math.max(0, (Number.isFinite(n) ? n : esp) - 1)) }))}><Minus className="h-4 w-4" /></Button>
                                <Input inputMode="decimal" className="h-11 text-center text-base tabular-nums" value={cantidades[l.id] ?? ""} aria-label={`Entregado de ${l.producto}`}
                                  onChange={(e) => setCantidades((c) => ({ ...c, [l.id]: e.target.value }))} />
                                <Button type="button" variant="outline" size="icon" className="h-11 w-11 shrink-0" aria-label={`Más ${l.producto}`}
                                  onClick={() => setCantidades((c) => ({ ...c, [l.id]: String(Math.min(esp, (Number.isFinite(n) ? n : 0) + 1)) }))}><Plus className="h-4 w-4" /></Button>
                                <span className="shrink-0 text-xs text-muted-foreground">de {fmtCantidad(esp)}</span>
                              </div>
                              {dif && (
                                <div className="mt-2">
                                  <SelectMotivo valor={motivosLinea[l.id] ?? ""} onCambio={(v) => setMotivosLinea((m) => ({ ...m, [l.id]: v }))} opciones={MOTIVOS_LINEA} placeholder="¿Por qué faltó?" />
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                    <p className={`rounded-md px-3 py-2 text-xs ${quedaPendiente ? "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-100" : "bg-muted text-muted-foreground"}`}>
                      {quedaPendiente ? "Lo que faltó en el camión queda pendiente en Odoo para otra entrega." : "Lo no entregado no queda pendiente: regresa al almacén."}
                    </p>
                  </div>
                  {bloqueRecibe}
                </>
              )}

              {resultado === "rechazada" && (
                <>
                  <div className="space-y-1">
                    <label htmlFor="motivo" className="text-sm font-medium">Motivo del rechazo</label>
                    <SelectMotivo id="motivo" valor={motivo} onCambio={setMotivo} opciones={MOTIVOS_RECHAZO} />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="detalle" className="text-sm font-medium">Detalle {motivo === "otro" ? "" : "(opcional)"}</label>
                    <Textarea id="detalle" value={detalle} onChange={(e) => setDetalle(e.target.value)} placeholder="Qué pasó" />
                  </div>
                  {bloqueFoto("Foto (mercancía, documento o fachada)")}
                  <div className="space-y-1">
                    <label htmlFor="quien" className="text-sm font-medium">Quién lo rechazó (opcional)</label>
                    <Input id="quien" className="h-11" value={receptor} onChange={(e) => setReceptor(e.target.value)} placeholder="Nombre" autoComplete="off" />
                  </div>
                  <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">La mercancía regresa contigo. El documento sigue abierto en Odoo: administración decide qué hacer.</p>
                </>
              )}

              {resultado === "reprogramada" && (
                <>
                  <div className="space-y-1">
                    <label htmlFor="fecha" className="text-sm font-medium">Fecha nueva</label>
                    <Input id="fecha" type="date" className="h-11" min={diaCaracas()} value={fecha} onChange={(e) => setFecha(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="motivo" className="text-sm font-medium">Motivo</label>
                    <SelectMotivo id="motivo" valor={motivo} onCambio={setMotivo} opciones={MOTIVOS_REPROGRAMACION} />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="detalle" className="text-sm font-medium">Detalle {motivo === "otro" ? "" : "(opcional)"}</label>
                    <Textarea id="detalle" value={detalle} onChange={(e) => setDetalle(e.target.value)} placeholder="Qué pasó" />
                  </div>
                  <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">La mercancía regresa contigo y el documento vuelve a la cola de despacho con la fecha nueva.</p>
                </>
              )}

              {resultado && resultado !== "reprogramada" && (
                <div className="space-y-1">
                  <label htmlFor="notas" className="text-sm font-medium">Notas (opcional)</label>
                  <Textarea id="notas" value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Observaciones" />
                </div>
              )}
            </div>

            {resultado && (
              <div className="flex gap-2 border-t border-border px-4 py-3">
                <Button variant="outline" className="h-11 flex-1" onClick={() => setResultado(null)} disabled={busy}>Atrás</Button>
                <Button className="h-11 flex-[2]" onClick={confirmar} disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirmar"}
                </Button>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
