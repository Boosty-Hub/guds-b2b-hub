import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AlertCircle, CheckCircle2, Loader2, MailWarning, Send, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { pdfEstadoCuentaBase64, precargarPdfEstadoCuenta } from "./pdf";
import { urlEstadoCuenta } from "./formato";
import type { EstadoCuentaCompleto } from "./tipos";

// Envío masivo del estado de cuenta (fase 21b, punto 2.7): a cada cliente elegido en Cuentas (p. ej. todos los vencidos de
// un vendedor) le llega SU estado de cuenta, igual que el envío individual: enlace público, el mismo PDF (movimientos desde
// la factura abierta más antigua) y el mismo correo. Se registra como un lote (crear_lote_estado_cuenta) y cada envío queda
// en el historial del cliente con su entrega o rebote (webhook de Resend). Clientes sin correo: se omiten, salvo que se
// escriba uno para este envío. Se envía de uno en uno (el navegador genera cada PDF) y se puede detener.

const CORREO = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

type Estado = "pendiente" | "enviando" | "enviado" | "fallido" | "omitido";
interface Fila { id: string; nombre: string; destinos: string[]; nuevo: string; estado: Estado; error?: string }

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function invocar(body: Record<string, unknown>, empresa: string): Promise<{ error?: string; status?: number }> {
  const { error } = await supabase.functions.invoke("enviar-estado-cuenta", { body, headers: { "x-empresa-id": empresa } });
  if (!error) return {};
  const ctx = (error as { context?: Response }).context;
  if (ctx && typeof ctx.json === "function") {
    const j = await ctx.json().catch(() => null);
    return { error: j?.error ?? error.message, status: ctx.status };
  }
  return { error: error.message || "No se pudo contactar el servicio de correo" };
}

export function EnvioMasivoDialog({ open, onOpenChange, clientes, onTerminado }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clientes: { id: string; nombre: string }[];
  onTerminado?: () => void;
}) {
  const { empresaActiva } = useEmpresa();
  const empresa = empresaActiva?.id ?? "todas";
  const [filas, setFilas] = useState<Fila[]>([]);
  const [cargando, setCargando] = useState(false);
  const [asunto, setAsunto] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [terminado, setTerminado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const detener = useRef(false);

  useEffect(() => {
    if (!open) return;
    precargarPdfEstadoCuenta();
    setAsunto(""); setMensaje(""); setTerminado(false); setError(null); detener.current = false;
    setFilas(clientes.map((c) => ({ id: c.id, nombre: c.nombre, destinos: [], nuevo: "", estado: "pendiente" })));
    setCargando(true);
    supabase.rpc("destinatarios_estado_cuenta", { p_clientes: clientes.map((c) => c.id) }).then(({ data, error: e }) => {
      setCargando(false);
      if (e) { setError(e.message); return; }
      const mapa = (data as Record<string, string[]>) ?? {};
      setFilas((fs) => fs.map((f) => ({ ...f, destinos: (mapa[f.id] ?? []).filter((x) => CORREO.test(x)).slice(0, 10) })));
    });
  }, [open, clientes]);

  const cambiar = (id: string, p: Partial<Fila>) => setFilas((fs) => fs.map((f) => (f.id === id ? { ...f, ...p } : f)));
  const agregar = (f: Fila) => {
    const partes = f.nuevo.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (!partes.length) return;
    const malos = partes.filter((x) => !CORREO.test(x));
    if (malos.length) { cambiar(f.id, { error: `Correo inválido: ${malos.join(", ")}` }); return; }
    cambiar(f.id, { destinos: [...f.destinos, ...partes.filter((x) => !f.destinos.includes(x))].slice(0, 10), nuevo: "", error: undefined });
  };
  const teclas = (e: KeyboardEvent<HTMLInputElement>, f: Fila) => {
    if (e.key === "Enter" || e.key === "," || e.key === ";") { e.preventDefault(); agregar(f); }
  };

  const conCorreo = filas.filter((f) => f.destinos.length > 0);
  const hechos = filas.filter((f) => f.estado !== "pendiente" && f.estado !== "enviando").length;

  const enviarTodos = async () => {
    if (enviando || !conCorreo.length) return;
    setEnviando(true); setError(null); detener.current = false;
    setFilas((fs) => fs.map((f) => (f.destinos.length ? { ...f, estado: "pendiente", error: undefined } : { ...f, estado: "omitido", error: "Sin correo" })));
    const { data: lote, error: eLote } = await supabase.rpc("crear_lote_estado_cuenta", { p_clientes: conCorreo.map((f) => f.id), p_descripcion: asunto || null });
    if (eLote || !lote) { setError(eLote?.message ?? "No se pudo iniciar el envío"); setEnviando(false); return; }
    for (const f of conCorreo) {
      if (detener.current) break;
      cambiar(f.id, { estado: "enviando" });
      try {
        const { data: ec, error: eEc } = await supabase.rpc("estado_cuenta_cliente", { p_cliente_id: f.id, p_desde_abierta: true });
        if (eEc) throw new Error(eEc.message);
        const { data: enl, error: eEnl } = await supabase.rpc("crear_enlace_estado_cuenta", { p_cliente_id: f.id });
        if (eEnl) throw new Error(eEnl.message);
        const token = (enl as { token: string | null }).token;
        const pdf = await pdfEstadoCuentaBase64(ec as EstadoCuentaCompleto, { enlace: token ? urlEstadoCuenta(token) : null });
        const cuerpo = { modo: "enviar", cliente_id: f.id, destinatarios: f.destinos, asunto, mensaje, pdf_base64: pdf.base64, lote_id: lote };
        let r = await invocar(cuerpo, empresa);
        if (r.status === 429 && !/este cliente/i.test(r.error ?? "")) { await espera(20_000); r = await invocar(cuerpo, empresa); }
        if (r.error) throw new Error(r.error);
        cambiar(f.id, { estado: "enviado" });
      } catch (e) {
        cambiar(f.id, { estado: "fallido", error: (e as Error).message });
      }
    }
    setEnviando(false); setTerminado(true);
    onTerminado?.();
  };

  const ICONO: Record<Estado, JSX.Element> = {
    pendiente: <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />,
    enviando: <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />,
    enviado: <CheckCircle2 className="h-3.5 w-3.5 text-success" />,
    fallido: <AlertCircle className="h-3.5 w-3.5 text-destructive" />,
    omitido: <MailWarning className="h-3.5 w-3.5 text-warning" />,
  };
  const enviados = filas.filter((f) => f.estado === "enviado").length;
  const fallidos = filas.filter((f) => f.estado === "fallido").length;
  const omitidos = filas.filter((f) => f.estado === "omitido" || (!f.destinos.length && f.estado === "pendiente")).length;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!enviando) onOpenChange(o); }}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-1.5rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0" data-testid="envio-masivo">
        <DialogHeader className="border-b border-border px-4 py-4 text-left sm:px-5">
          <DialogTitle className="text-base">Enviar el estado de cuenta a {clientes.length} {clientes.length === 1 ? "cliente" : "clientes"}</DialogTitle>
          <DialogDescription className="text-xs">A cada uno le llega el suyo: enlace en línea y PDF adjunto, con movimientos desde su factura abierta más antigua.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="em-asunto" className="text-xs">Asunto (opcional)</Label>
              <Input id="em-asunto" value={asunto} maxLength={200} onChange={(e) => setAsunto(e.target.value)} disabled={enviando}
                placeholder="Por defecto: Tu estado de cuenta con … al …" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="em-mensaje" className="text-xs">Mensaje para todos (opcional)</Label>
              <Textarea id="em-mensaje" rows={2} maxLength={2000} value={mensaje} onChange={(e) => setMensaje(e.target.value)} disabled={enviando} />
            </div>
          </div>
          {(enviando || terminado) && (
            <div className="space-y-1" data-testid="em-progreso">
              <Progress value={conCorreo.length ? (filas.filter((f) => f.estado === "enviado" || f.estado === "fallido").length / conCorreo.length) * 100 : 0} />
              <p className="text-xs text-muted-foreground">{enviados} enviados · {fallidos} con error · {omitidos} sin correo{enviando ? " · enviando…" : ""}</p>
            </div>
          )}
          {error && <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{error}</p>}
          {cargando ? <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div> : (
            <ul className="divide-y divide-border rounded-md border border-border" data-testid="em-lista">
              {filas.map((f) => (
                <li key={f.id} className="space-y-1 px-3 py-2" data-testid="em-cliente" data-estado={f.estado}>
                  <div className="flex items-center gap-2">
                    {ICONO[f.estado]}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium" title={f.nombre}>{f.nombre}</span>
                    {!f.destinos.length && f.estado === "pendiente" && <span className="text-[11px] text-warning">Sin correo: se omite</span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 pl-5">
                    {f.destinos.map((d) => (
                      <span key={d} className="inline-flex max-w-full items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs">
                        <span className="truncate">{d}</span>
                        {!enviando && f.estado !== "enviado" && (
                          <button type="button" aria-label={`Quitar ${d}`} className="text-muted-foreground hover:text-foreground" onClick={() => cambiar(f.id, { destinos: f.destinos.filter((x) => x !== d) })}>
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </span>
                    ))}
                    {!enviando && f.estado !== "enviado" && (
                      <input value={f.nuevo} onChange={(e) => cambiar(f.id, { nuevo: e.target.value, error: undefined })} onKeyDown={(e) => teclas(e, f)}
                        onBlur={() => f.nuevo.trim() && agregar(f)} placeholder={f.destinos.length ? "otro…" : "correo para este envío"}
                        className="min-w-[9rem] flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground" aria-label={`Agregar correo para ${f.nombre}`} data-testid="em-destino" />
                    )}
                  </div>
                  {f.error && <p className={cn("pl-5 text-[11px]", f.estado === "omitido" ? "text-muted-foreground" : "text-destructive")}>{f.error}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <DialogFooter className="gap-2 border-t border-border px-4 py-3 sm:justify-between sm:px-5">
          <p className="hidden self-center text-xs text-muted-foreground sm:block">{conCorreo.length} con correo · {filas.length - conCorreo.length} sin correo{hechos && terminado ? ` · lote terminado` : ""}</p>
          <div className="flex gap-2">
            {enviando ? <Button variant="outline" onClick={() => { detener.current = true; }}>Detener</Button>
              : <Button variant="outline" onClick={() => onOpenChange(false)}>{terminado ? "Cerrar" : "Cancelar"}</Button>}
            {!terminado && (
              <Button onClick={enviarTodos} disabled={enviando || cargando || !conCorreo.length} className="gap-2" data-testid="em-enviar">
                {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {enviando ? "Enviando…" : `Enviar a ${conCorreo.length}`}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
