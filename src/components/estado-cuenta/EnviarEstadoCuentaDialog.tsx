import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, ChevronRight, Loader2, Mail, Paperclip, Send, UserPlus, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { pdfEstadoCuentaBase64, precargarPdfEstadoCuenta } from "./pdf";
import { nombreArchivoEstadoCuenta, urlEstadoCuenta } from "./formato";
import type { EstadoCuentaCompleto } from "./tipos";

// Enviar el estado de cuenta por correo (fase 20w): destinatarios prellenados con el correo del cliente y de sus
// contactos (editables y validados), asunto, mensaje opcional y vista previa del correo tal como sale (la arma la
// función edge enviar-estado-cuenta). Al enviar: se asegura el enlace público, se genera el PDF con el mismo componente
// de siempre (con ese enlace en el pie) y la función lo adjunta y envía por Resend.
// 21b (clientes sin correo): desde aquí se guarda el correo del cliente — se escribe en Odoo por la cola de escrituras,
// como la dirección y los teléfonos — o se crea un contacto con correo (que su trigger también lleva a Odoo).

const CORREO = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const MAX = 10;
const FUNCION = "enviar-estado-cuenta";

type Respuesta = { asunto?: string; html?: string; texto?: string; destinatarios?: string[]; error?: string; resend_id?: string; envio_id?: string };

/** Llama a la función edge y devuelve su JSON (también en errores 4xx/5xx, que traen { error }). */
async function llamar(body: Record<string, unknown>, empresa: string): Promise<Respuesta> {
  const { data, error } = await supabase.functions.invoke(FUNCION, { body, headers: { "x-empresa-id": empresa } });
  if (!error) return data as Respuesta;
  const ctx = (error as { context?: Response }).context;
  if (ctx && typeof ctx.json === "function") {
    const j = await ctx.json().catch(() => null);
    if (j?.error) return { error: j.error };
  }
  return { error: error.message || "No se pudo contactar el servicio de correo" };
}

export function EnviarEstadoCuentaDialog({ open, onOpenChange, clienteId, datos, onEnviado }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clienteId: string;
  /** Estado de cuenta en pantalla (período elegido): es el que va en el PDF. */
  datos: EstadoCuentaCompleto | null;
  onEnviado?: () => void;
}) {
  const { empresaActiva } = useEmpresa();
  const empresa = empresaActiva?.id ?? "todas";
  const [destinos, setDestinos] = useState<string[]>([]);
  const [nuevo, setNuevo] = useState("");
  const [asunto, setAsunto] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [html, setHtml] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [enviando, setEnviando] = useState<null | "enlace" | "pdf" | "correo">(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDestino, setErrorDestino] = useState<string | null>(null);
  const iniciado = useRef(false);
  const ultimaVista = useRef("");
  // Agregar correo (cliente sin correo)
  const [agregarAbierto, setAgregarAbierto] = useState(false);
  const [modoCorreo, setModoCorreo] = useState<"cliente" | "contacto">("cliente");
  const [correoNuevo, setCorreoNuevo] = useState("");
  const [nombreContacto, setNombreContacto] = useState("");
  const [guardandoCorreo, setGuardandoCorreo] = useState(false);
  const [sugeridos, setSugeridos] = useState<number | null>(null);

  // Al abrir: vista previa con los destinatarios sugeridos y el asunto por defecto
  useEffect(() => {
    if (!open) { iniciado.current = false; return; }
    if (iniciado.current) return;
    iniciado.current = true;
    precargarPdfEstadoCuenta();
    setError(null); setErrorDestino(null); setMensaje(""); setNuevo(""); setHtml(null);
    setAgregarAbierto(false); setCorreoNuevo(""); setNombreContacto(""); setModoCorreo("cliente"); setSugeridos(null);
    setCargando(true);
    llamar({ modo: "vista_previa", cliente_id: clienteId }, empresa).then((r) => {
      setCargando(false);
      if (r.error) { setError(r.error); return; }
      setDestinos((r.destinatarios ?? []).slice(0, MAX));
      setSugeridos((r.destinatarios ?? []).length);
      if (!(r.destinatarios ?? []).length) setAgregarAbierto(true);
      ultimaVista.current = JSON.stringify(["", r.asunto ?? ""]);
      setAsunto(r.asunto ?? "");
      setHtml(r.html ?? null);
    });
  }, [open, clienteId, empresa]);

  // Vista previa al cambiar el mensaje o el asunto (con pausa, para no pedirla por cada tecla)
  useEffect(() => {
    if (!open || !iniciado.current || cargando) return;
    const clave = JSON.stringify([mensaje, asunto]);
    if (clave === ultimaVista.current) return;
    const t = setTimeout(() => {
      ultimaVista.current = clave;
      llamar({ modo: "vista_previa", cliente_id: clienteId, mensaje, asunto }, empresa).then((r) => { if (!r.error) setHtml(r.html ?? null); });
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mensaje, asunto]);

  const agregar = (texto: string) => {
    const partes = texto.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (!partes.length) return true;
    const malos = partes.filter((p) => !CORREO.test(p));
    if (malos.length) { setErrorDestino(`Correo inválido: ${malos.join(", ")}`); return false; }
    const todos = [...destinos, ...partes.filter((p) => !destinos.includes(p))];
    if (todos.length > MAX) { setErrorDestino(`Máximo ${MAX} destinatarios`); return false; }
    setDestinos(todos); setNuevo(""); setErrorDestino(null);
    return true;
  };
  const teclas = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "," || e.key === ";") { e.preventDefault(); agregar(nuevo); }
    else if (e.key === "Backspace" && !nuevo && destinos.length) setDestinos(destinos.slice(0, -1));
  };

  const enviar = async () => {
    if (!datos || enviando) return;
    if (nuevo.trim() && !agregar(nuevo)) return;
    const lista = nuevo.trim() ? [...destinos, ...nuevo.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter((s) => s && !destinos.includes(s))] : destinos;
    if (!lista.length) { setErrorDestino("Agrega al menos un destinatario"); return; }
    setError(null);
    try {
      // 1) Enlace público (reutiliza el activo) para el botón del correo y el pie del PDF
      setEnviando("enlace");
      const { data: enl, error: errEnl } = await supabase.rpc("crear_enlace_estado_cuenta", { p_cliente_id: clienteId });
      if (errEnl) throw new Error(errEnl.message);
      const token = (enl as { token: string | null }).token;
      // 2) El mismo PDF que "Descargar PDF"
      setEnviando("pdf");
      const pdf = await pdfEstadoCuentaBase64(datos, { enlace: token ? urlEstadoCuenta(token) : null });
      // 3) Envío
      setEnviando("correo");
      const r = await llamar({ modo: "enviar", cliente_id: clienteId, destinatarios: lista, asunto, mensaje, pdf_base64: pdf.base64 }, empresa);
      if (r.error) throw new Error(r.error);
      toast({ title: "Estado de cuenta enviado", description: `A ${lista.join(", ")} con el PDF adjunto.` });
      onEnviado?.();
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message || "No se pudo enviar el correo");
      onEnviado?.();
    } finally {
      setEnviando(null);
    }
  };

  // Guardar el correo en el cliente (→ Odoo) o crear un contacto con correo; en los dos casos queda como destinatario
  const guardarCorreo = async () => {
    const correo = correoNuevo.trim().toLowerCase();
    if (!CORREO.test(correo)) { toast({ title: "Correo inválido", description: correo || "Escribe un correo", variant: "destructive" }); return; }
    if (modoCorreo === "contacto" && nombreContacto.trim().length < 2) { toast({ title: "Falta el nombre del contacto", variant: "destructive" }); return; }
    setGuardandoCorreo(true);
    const r = modoCorreo === "cliente"
      ? await supabase.rpc("actualizar_contacto_cliente", { p_cliente_id: clienteId, p_datos: { email: correo } })
      : await supabase.from("cliente_contactos").insert({ cliente_id: clienteId, nombre: nombreContacto.trim(), email: correo, activo: true }).select("id").single();
    setGuardandoCorreo(false);
    if (r.error) { toast({ title: "No se guardó el correo", description: r.error.message, variant: "destructive" }); return; }
    toast({
      title: modoCorreo === "cliente" ? "Correo enviado a Odoo" : "Contacto creado",
      description: modoCorreo === "cliente" ? `${correo}: queda en la ficha del cliente cuando Odoo lo confirme (unos segundos).` : `${nombreContacto.trim()} · ${correo}`,
    });
    if (!destinos.includes(correo) && destinos.length < MAX) setDestinos([...destinos, correo]);
    setCorreoNuevo(""); setNombreContacto(""); setAgregarAbierto(false); setErrorDestino(null);
  };

  const archivo = datos ? nombreArchivoEstadoCuenta(datos.cliente.nombre, datos.periodo.hasta ?? datos.hoy) : "";
  const pasos = { enlace: "Preparando el enlace…", pdf: "Generando el PDF…", correo: "Enviando…" } as const;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!enviando) onOpenChange(o); }}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-1.5rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0" data-testid="ec-correo-dialogo">
        <DialogHeader className="min-w-0 border-b border-border px-4 py-4 text-left sm:px-5">
          <DialogTitle className="flex items-center gap-2 text-base"><Mail className="h-4 w-4 text-primary" />Enviar estado de cuenta por correo</DialogTitle>
          <DialogDescription className="text-xs">El correo lleva el botón para ver el estado de cuenta en línea y el PDF adjunto.</DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 overflow-y-auto overflow-x-hidden md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] md:overflow-hidden">
          <div className="min-w-0 space-y-4 p-4 sm:p-5 md:overflow-y-auto">
            <div className="space-y-1.5">
              <Label htmlFor="ec-destino" className="text-xs">Para</Label>
              <div className={cn("flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring",
                errorDestino && "border-destructive")}>
                {destinos.map((d) => (
                  <span key={d} className="inline-flex max-w-full items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs" data-testid="ec-destino-chip">
                    <span className="truncate">{d}</span>
                    <button type="button" className="rounded text-muted-foreground hover:text-foreground" onClick={() => setDestinos(destinos.filter((x) => x !== d))}
                      aria-label={`Quitar ${d}`} disabled={!!enviando}><X className="h-3 w-3" /></button>
                  </span>
                ))}
                <input id="ec-destino" value={nuevo} onChange={(e) => { setNuevo(e.target.value); setErrorDestino(null); }} onKeyDown={teclas}
                  onBlur={() => nuevo.trim() && agregar(nuevo)} disabled={!!enviando}
                  placeholder={destinos.length ? "Agregar otro…" : "correo@cliente.com"} className="min-w-[10rem] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  data-testid="ec-destino-input" />
              </div>
              {errorDestino ? <p className="text-xs text-destructive">{errorDestino}</p>
                : <p className="text-[11px] text-muted-foreground">Del cliente y sus contactos con correo. Enter o coma para agregar; hasta {MAX}.</p>}
            </div>
            <div className={cn("rounded-md border px-3 py-2", sugeridos === 0 ? "border-warning/50 bg-warning/5" : "border-border")} data-testid="ec-agregar-correo">
              <button type="button" className="flex w-full items-center gap-1.5 text-left text-xs font-medium" onClick={() => setAgregarAbierto((a) => !a)} aria-expanded={agregarAbierto}>
                {agregarAbierto ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                <UserPlus className="h-3.5 w-3.5" />
                {sugeridos === 0 ? "Este cliente no tiene correo: agrégalo" : "Guardar un correo nuevo en el cliente"}
              </button>
              {agregarAbierto && (
                <div className="mt-2 space-y-2">
                  <div className="flex rounded-md border border-border bg-background p-0.5 text-xs" role="group" aria-label="Dónde guardar el correo">
                    {([["cliente", "Correo del cliente (Odoo)"], ["contacto", "Nuevo contacto"]] as ["cliente" | "contacto", string][]).map(([v, t]) => (
                      <button key={v} type="button" onClick={() => setModoCorreo(v)} aria-pressed={modoCorreo === v}
                        className={cn("flex-1 rounded px-2 py-1", modoCorreo === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{t}</button>
                    ))}
                  </div>
                  {modoCorreo === "contacto" && (
                    <Input value={nombreContacto} onChange={(e) => setNombreContacto(e.target.value)} placeholder="Nombre del contacto (p. ej. Cuentas por pagar)"
                      maxLength={120} disabled={guardandoCorreo} data-testid="ec-contacto-nombre" />
                  )}
                  <div className="flex gap-2">
                    <Input type="email" value={correoNuevo} onChange={(e) => setCorreoNuevo(e.target.value)} placeholder="correo@cliente.com" maxLength={254}
                      disabled={guardandoCorreo} data-testid="ec-correo-nuevo" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); guardarCorreo(); } }} />
                    <Button type="button" variant="secondary" onClick={guardarCorreo} disabled={guardandoCorreo || !correoNuevo.trim()} data-testid="ec-correo-guardar">
                      {guardandoCorreo ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar"}
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {modoCorreo === "cliente" ? "Se escribe en Odoo (como la dirección y los teléfonos) y queda como destinatario." : "El contacto se crea en GUDS y en Odoo, y queda como destinatario."}
                  </p>
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ec-asunto" className="text-xs">Asunto</Label>
              <Input id="ec-asunto" value={asunto} maxLength={200} onChange={(e) => setAsunto(e.target.value)} disabled={!!enviando} data-testid="ec-asunto" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ec-mensaje" className="text-xs">Mensaje (opcional)</Label>
              <Textarea id="ec-mensaje" rows={5} maxLength={2000} value={mensaje} onChange={(e) => setMensaje(e.target.value)} disabled={!!enviando}
                placeholder="Ej.: Buenos días, les compartimos el estado de cuenta actualizado. Quedamos atentos." data-testid="ec-mensaje" />
              <p className="text-right text-[11px] tabular-nums text-muted-foreground">{mensaje.length}/2000</p>
            </div>
            <div className="flex items-center gap-2 rounded-md bg-muted/50 px-2.5 py-2 text-xs text-muted-foreground">
              <Paperclip className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{archivo || "PDF del estado de cuenta"}</span>
            </div>
            {error && <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert" data-testid="ec-correo-error">{error}</p>}
          </div>

          <div className="flex min-h-[360px] min-w-0 flex-col border-t border-border bg-muted/40 md:border-l md:border-t-0">
            <p className="px-4 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Vista previa</p>
            <div className="min-h-0 flex-1 p-3">
              {cargando || html === null ? (
                <div className="flex h-full min-h-[320px] items-center justify-center text-sm text-muted-foreground">
                  {cargando ? <Loader2 className="h-5 w-5 animate-spin" /> : error ? "Sin vista previa" : ""}
                </div>
              ) : (
                <iframe title="Vista previa del correo" srcDoc={html} sandbox="" className="h-full min-h-[320px] w-full rounded-md border border-border bg-white" data-testid="ec-correo-vista" />
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="min-w-0 gap-2 border-t border-border px-4 py-3 sm:justify-between sm:px-5">
          <p className="hidden self-center text-xs text-muted-foreground sm:block">{enviando ? pasos[enviando] : `${destinos.length} ${destinos.length === 1 ? "destinatario" : "destinatarios"}`}</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={!!enviando}>Cancelar</Button>
            <Button onClick={enviar} disabled={!!enviando || cargando || !datos || (!destinos.length && !nuevo.trim())} className="gap-2" data-testid="ec-correo-enviar">
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{enviando ? pasos[enviando] : "Enviar"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
