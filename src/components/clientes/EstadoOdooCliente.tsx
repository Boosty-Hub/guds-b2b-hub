import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, FlaskConical, Link2, Loader2, Pencil, PlusCircle, RefreshCw, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Panel } from "@/components/datos/FichaCampos";
import { OdooBadge } from "@/components/OdooBadge";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { CamposDireccion, ErrorCampo } from "./CamposDireccion";
import { direccionPayload, errorTelefonoVe, erroresDireccion, estadoVe, type DireccionForm } from "./odooCliente";

// Estado de Odoo de un cliente en su ficha (migración 20s): alta en Odoo (pendiente, creado, enlazado, varias coincidencias
// con selector, error con reintentar y completar datos), sus contactos y su límite de crédito.

type EstadoEnvio = "pendiente" | "procesando" | "simulada" | "hecha" | "error";
export interface Candidato {
  id: number; nombre: string | null; rif: string | null; compania: string | null; compartido: boolean; activo: boolean;
  cliente: boolean; proveedor: boolean; ciudad: string | null; coincide: "rif" | "nombre" | "rif_y_nombre"; rif_distinto: boolean;
  ligado_a: { id: string; nombre: string } | null;
}
interface ResultadoAlta {
  modo?: "simulacion" | "aplicada"; accion?: "crear" | "enlazar" | "revisar" | "ya_vinculado"; motivo?: string | null; empresa?: string;
  partner?: Candidato; candidatos?: Candidato[]; puede_crear?: boolean; avisos?: string[];
  resumen?: { rif: string; estado: string; lista: string; vendedor: string | null; es_empresa: boolean };
  vals?: { name?: string }; odoo_id?: number; nota?: { texto?: string; ok?: boolean; error?: string; simulada?: boolean };
}
interface Envio { id: string; estado: EstadoEnvio; error: string | null; created_at: string }
export interface EstadoOdoo {
  odoo_id: number | null;
  vinculo: "pendiente" | "creado" | "enlazado" | "varias" | "error" | null;
  vinculo_at: string | null;
  detalle: { error?: string; motivo?: string; candidatos?: Candidato[]; puede_crear?: boolean; partner?: { id: number; nombre: string; rif: string | null } } | null;
  datos: { calle: string | null; complemento: string | null; ciudad: string | null; estado: string | null; rif: string | null; telefono: string | null; celular: string | null };
  modo_nuevos: "simular" | "activo";
  modo_clientes: "simular" | "activo";
  alta: (Envio & { resultado: ResultadoAlta | null; intentos: number; origen: string | null; solicitado_por: string | null; procesado_at: string | null }) | null;
  contactos: { id: string; nombre: string; cargo: string | null; activo: boolean; odoo_id: number | null; envio: (Envio & { accion: string | null; omitida: string | null }) | null }[];
  limite: { valor: number | null; pendiente: boolean; editado_en: string | null; envio: (Envio & { resultado: { modo?: string; valor?: number; avisos?: string[] } | null }) | null };
}

const fecha = (d?: string | null) => (d ? new Date(d).toLocaleString("es-VE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const enCurso = (e?: { estado: EstadoEnvio } | null) => !!e && (e.estado === "pendiente" || e.estado === "procesando");
const usd = (n: number | null | undefined) => `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Estado({ tono, icono: Icono, children }: { tono: "ok" | "alerta" | "error" | "neutro" | "curso"; icono: typeof Clock; children: React.ReactNode }) {
  const cls = { ok: "border-success/50 bg-success/10", alerta: "border-warning/60 bg-warning/10", error: "border-destructive/50 bg-destructive/10 text-destructive",
    neutro: "border-border bg-muted", curso: "border-primary/40 bg-primary/10" }[tono];
  return (
    <Badge variant="outline" className={cn("gap-1 whitespace-nowrap font-medium text-foreground", cls)}>
      <Icono className={cn("h-3 w-3", tono === "curso" && "animate-spin")} /> {children}
    </Badge>
  );
}

/** Estado del alta del cliente en Odoo (una línea con insignia + detalle). */
function textoAlta(e: EstadoOdoo): { tono: "ok" | "alerta" | "error" | "neutro" | "curso"; icono: typeof Clock; etiqueta: string; detalle?: string } {
  const a = e.alta;
  if (e.odoo_id && !e.vinculo) return { tono: "ok", icono: CheckCircle2, etiqueta: "Vinculado", detalle: `Vino de Odoo (contacto ${e.odoo_id}).` };
  if (e.vinculo === "creado") return { tono: "ok", icono: CheckCircle2, etiqueta: "Creado en Odoo", detalle: `GUDS lo creó en Odoo (contacto ${e.odoo_id}) el ${fecha(e.vinculo_at)}, marcado "(GUDS)".` };
  if (e.vinculo === "enlazado") {
    const p = e.detalle?.partner;
    return { tono: "ok", icono: Link2, etiqueta: "Enlazado", detalle: `Ya existía en Odoo${p ? `: ${p.nombre}${p.rif ? ` (${p.rif})` : ""}` : ""}${e.detalle?.motivo ? ` · ${e.detalle.motivo}` : ""}. No se creó otro.` };
  }
  if (e.vinculo === "varias") return { tono: "alerta", icono: AlertTriangle, etiqueta: "Varias coincidencias", detalle: e.detalle?.motivo ?? "Elige con cuál enlazarlo." };
  if (enCurso(a)) return { tono: "curso", icono: Loader2, etiqueta: a?.estado === "procesando" ? "Enviando a Odoo…" : "En cola para Odoo" };
  if (a?.estado === "error" || e.vinculo === "error") return { tono: "error", icono: AlertTriangle, etiqueta: "Error", detalle: a?.error ?? e.detalle?.error ?? "Odoo no aceptó el alta." };
  if (a?.estado === "simulada") {
    const r = a.resultado;
    const que = r?.accion === "crear" ? "se crearía en Odoo como cliente nuevo" : r?.accion === "enlazar" ? `se enlazaría con ${r.partner?.nombre ?? "un contacto existente"}`
      : r?.accion === "revisar" ? "hay varias coincidencias por elegir" : "sin cambios";
    return { tono: "alerta", icono: FlaskConical, etiqueta: "Simulado", detalle: `Modo simulación: ${que}. Odoo no se modificó.` };
  }
  if (!e.odoo_id) return { tono: "neutro", icono: Clock, etiqueta: "Sin Odoo", detalle: "Aún no se ha enviado a Odoo." };
  return { tono: "neutro", icono: Clock, etiqueta: "—" };
}

/** Completar los datos que Odoo exige (dirección con estado, teléfonos, RIF) de un cliente que aún no está en Odoo, y enviarlo. */
function CompletarDatosDialog({ open, onOpenChange, clienteId, datos, onEnviado }: {
  open: boolean; onOpenChange: (v: boolean) => void; clienteId: string; datos: EstadoOdoo["datos"]; onEnviado: () => void;
}) {
  const { toast } = useToast();
  type Form = DireccionForm & { telefono: string; celular: string; rif: string };
  const inicial = useMemo<Form>(() => ({ calle: datos.calle ?? "", complemento: datos.complemento ?? "", ciudad: datos.ciudad ?? "", estado: estadoVe(datos.estado) ?? "",
    telefono: datos.telefono ?? "", celular: datos.celular ?? "", rif: datos.rif ?? "" }), [datos]);
  const [form, setForm] = useState<Form>(inicial);
  const [intento, setIntento] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setForm(inicial); setIntento(false); setError(null); } }, [open, inicial]);
  const errores = useMemo(() => {
    const e: Partial<Record<keyof Form, string>> = { ...erroresDireccion(form) };
    if (form.telefono.trim()) e.telefono = errorTelefonoVe(form.telefono, "teléfono") ?? undefined;
    if (form.celular.trim()) e.celular = errorTelefonoVe(form.celular, "celular", true) ?? undefined;
    if (!/^[VEJPG]-?\d{7,8}-?\d?$/i.test(form.rif.trim())) e.rif = "Formato J-12345678-9.";
    return Object.fromEntries(Object.entries(e).filter(([, v]) => v)) as Partial<Record<keyof Form, string>>;
  }, [form]);
  const visibles = intento ? errores : {};
  const enviar = async () => {
    setIntento(true); setError(null);
    if (Object.keys(errores).length) return;
    const p: Record<string, string> = { ...direccionPayload(form), rif: form.rif.trim() };
    if (form.telefono.trim() !== (datos.telefono ?? "")) p.telefono = form.telefono.trim();
    if (form.celular.trim() !== (datos.celular ?? "")) p.celular = form.celular.trim();
    setEnviando(true);
    const { error: e } = await supabase.rpc("completar_cliente_odoo", { p_cliente_id: clienteId, p_datos: p });
    setEnviando(false);
    if (e) { setError(e.message); return; }
    toast({ title: "Datos guardados", description: "El cliente se está enviando a Odoo." });
    onOpenChange(false);
    onEnviado();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Completar datos para Odoo</DialogTitle>
          <DialogDescription>Odoo exige calle, ciudad, estado y un RIF válido. Se guardan en GUDS y el cliente se vuelve a enviar a Odoo.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); enviar(); }} noValidate>
          <div className="sm:col-span-2">
            <Label htmlFor="comp-rif">RIF *</Label>
            <Input id="comp-rif" value={form.rif} maxLength={20} aria-invalid={!!visibles.rif} onChange={(e) => setForm((f) => ({ ...f, rif: e.target.value }))} placeholder="J-12345678-9" />
            <ErrorCampo id="comp-rif-e" texto={visibles.rif} />
          </div>
          <CamposDireccion prefijo="comp" valor={form} errores={visibles} onChange={(d) => setForm((f) => ({ ...f, ...d }))} />
          <div>
            <Label htmlFor="comp-tel">Teléfono</Label>
            <Input id="comp-tel" inputMode="tel" value={form.telefono} maxLength={40} onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))} />
            <ErrorCampo id="comp-tel-e" texto={visibles.telefono} />
          </div>
          <div>
            <Label htmlFor="comp-cel">Celular</Label>
            <Input id="comp-cel" inputMode="tel" value={form.celular} maxLength={40} onChange={(e) => setForm((f) => ({ ...f, celular: e.target.value }))} />
            <ErrorCampo id="comp-cel-e" texto={visibles.celular} />
          </div>
          {error && <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive sm:col-span-2" role="alert">{error}</p>}
          <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
        </form>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={enviar} disabled={enviando} className="gap-1.5">{enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Guardar y enviar a Odoo</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Panel "Odoo" de la ficha del cliente (solo personal de administración). */
export function EstadoOdooCliente({ clienteId, version, puedeCrear, onCambio, onEstado }: {
  clienteId: string; version: number; puedeCrear: boolean; onCambio: () => void; onEstado?: (e: EstadoOdoo) => void;
}) {
  const { toast } = useToast();
  const avisos = useRef({ onCambio, onEstado });
  avisos.current = { onCambio, onEstado };
  const [estado, setEstado] = useState<EstadoOdoo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [completar, setCompletar] = useState(false);

  const cargar = useCallback(async () => {
    const { data, error: e } = await supabase.rpc("estado_odoo_cliente", { p_cliente_id: clienteId });
    if (e) { setError(e.message); return; }
    setError(null);
    setEstado(data as EstadoOdoo);
    avisos.current.onEstado?.(data as EstadoOdoo);
  }, [clienteId]);
  useEffect(() => { cargar(); }, [cargar, version]);

  // Mientras haya algo en cola, se refresca solo; al terminar el alta se recarga la ficha (odoo_id, datos de Odoo)
  const algoEnCurso = !!estado && (enCurso(estado.alta) || enCurso(estado.limite.envio) || estado.contactos.some((k) => enCurso(k.envio)));
  const [habiaCurso, setHabiaCurso] = useState(false);
  useEffect(() => {
    if (algoEnCurso) { setHabiaCurso(true); const t = setInterval(cargar, 2500); return () => clearInterval(t); }
    if (habiaCurso) { setHabiaCurso(false); avisos.current.onCambio(); }
  }, [algoEnCurso, cargar, habiaCurso]);

  const accion = async (clave: string, rpc: string, args: Record<string, unknown>, ok: string) => {
    setOcupado(clave);
    const { error: e } = await supabase.rpc(rpc, args);
    setOcupado(null);
    if (e) { toast({ title: "No se pudo completar", description: e.message, variant: "destructive" }); return; }
    toast({ title: ok });
    await cargar();
  };

  if (error) return <Panel titulo={<>Odoo <OdooBadge /></>}><p className="text-sm text-destructive">{error}</p></Panel>;
  if (!estado) return <Panel titulo={<>Odoo <OdooBadge /></>}><div className="flex justify-center py-2"><Loader2 className="h-4 w-4 animate-spin text-primary" /></div></Panel>;

  const alta = textoAlta(estado);
  const r = estado.alta?.resultado ?? null;
  const candidatos: Candidato[] = estado.detalle?.candidatos ?? (r?.accion === "revisar" ? r.candidatos ?? [] : []);
  const puedeCrearNuevo = (estado.detalle?.puede_crear ?? r?.puede_crear) === true;
  const mostrarCandidatos = !estado.odoo_id && candidatos.length > 0 && (estado.vinculo === "varias" || r?.accion === "revisar");
  const sinOdoo = !estado.odoo_id;
  const activos = estado.contactos.filter((k) => k.activo);
  const kEnOdoo = estado.contactos.filter((k) => k.odoo_id).length;
  const kError = activos.filter((k) => !k.odoo_id && k.envio?.estado === "error").length;
  const kPend = activos.filter((k) => !k.odoo_id).length;
  const kInactivos = estado.contactos.filter((k) => !k.activo && !k.odoo_id).length;
  const lim = estado.limite;

  return (
    <Panel titulo={<>Odoo <OdooBadge /></>} acciones={
      <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs" onClick={cargar} aria-label="Actualizar estado de Odoo"><RefreshCw className="h-3.5 w-3.5" /> Actualizar</Button>
    }>
      <div className="grid gap-3 md:grid-cols-3" data-testid="estado-odoo">
        {/* Alta del cliente */}
        <div className="min-w-0 space-y-1.5">
          <p className="text-[11px] text-muted-foreground">Cliente en Odoo</p>
          <div className="flex flex-wrap items-center gap-1.5"><Estado tono={alta.tono} icono={alta.icono}>{alta.etiqueta}</Estado>
            {estado.alta && sinOdoo && <span className="text-[11px] text-muted-foreground">{fecha(estado.alta.procesado_at ?? estado.alta.created_at)}</span>}</div>
          {alta.detalle && <p className="break-words text-xs text-muted-foreground" data-testid="detalle-alta">{alta.detalle}</p>}
          {sinOdoo && estado.alta?.estado === "simulada" && r?.accion === "crear" && r.resumen && (
            <p className="text-xs text-muted-foreground">RIF {r.resumen.rif} · {r.resumen.estado} · lista {r.resumen.lista} · vendedor {r.resumen.vendedor ?? "sin vendedor"}</p>
          )}
          {sinOdoo && !!r?.avisos?.length && <ul className="list-disc pl-4 text-[11px] text-warning">{r.avisos.map((a) => <li key={a}>{a}</li>)}</ul>}
          {sinOdoo && puedeCrear && !enCurso(estado.alta) && (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              <Button size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-xs" disabled={ocupado === "enviar"}
                onClick={() => accion("enviar", "enviar_cliente_odoo", { p_cliente_id: clienteId }, "Enviado a Odoo")}>
                {ocupado === "enviar" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                {estado.alta?.estado === "error" || estado.vinculo === "error" ? "Reintentar" : "Enviar a Odoo"}
              </Button>
              <Button size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-xs" onClick={() => setCompletar(true)}><Pencil className="h-3.5 w-3.5" /> Completar datos</Button>
            </div>
          )}
          {sinOdoo && estado.modo_nuevos === "simular" && <p className="text-[11px] text-warning">Modo simulación activo para clientes nuevos: no se escribe en Odoo.</p>}
        </div>

        {/* Contactos */}
        <div className="min-w-0 space-y-1.5">
          <p className="text-[11px] text-muted-foreground">Contactos</p>
          {estado.contactos.length === 0 ? <p className="text-xs text-muted-foreground">Sin contactos.</p> : (
            <div className="flex flex-wrap gap-1.5">
              {kEnOdoo > 0 && <Estado tono="ok" icono={CheckCircle2}>{kEnOdoo} en Odoo</Estado>}
              {kPend - kError > 0 && <Estado tono={activos.some((k) => enCurso(k.envio)) ? "curso" : "neutro"} icono={activos.some((k) => enCurso(k.envio)) ? Loader2 : Clock}>{kPend - kError} pendiente{kPend - kError > 1 ? "s" : ""}</Estado>}
              {kError > 0 && <Estado tono="error" icono={AlertTriangle}>{kError} con error</Estado>}
            </div>
          )}
          {kInactivos > 0 && <p className="text-[11px] text-muted-foreground">{kInactivos} desactivado{kInactivos > 1 ? "s" : ""}: no se envían a Odoo.</p>}
          {sinOdoo && kPend > 0 && <p className="text-[11px] text-muted-foreground">Se envían cuando el cliente quede en Odoo.</p>}
          {!sinOdoo && kPend > 0 && !activos.some((k) => enCurso(k.envio)) && (
            <Button size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-xs" disabled={ocupado === "contactos"}
              onClick={() => accion("contactos", "enviar_contactos_odoo", { p_cliente_id: clienteId }, "Contactos enviados a Odoo")}>
              {ocupado === "contactos" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Enviar pendientes
            </Button>
          )}
        </div>

        {/* Límite de crédito */}
        <div className="min-w-0 space-y-1.5">
          <p className="text-[11px] text-muted-foreground">Límite de crédito</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[13px] font-medium">{lim.valor ? usd(lim.valor) : "—"}</span>
            {enCurso(lim.envio) ? <Estado tono="curso" icono={Loader2}>Enviando…</Estado>
              : lim.pendiente ? (lim.envio?.estado === "error" ? <Estado tono="error" icono={AlertTriangle}>Error al enviar</Estado>
                : lim.envio?.estado === "simulada" ? <Estado tono="alerta" icono={FlaskConical}>Pendiente (simulado)</Estado>
                  : <Estado tono="alerta" icono={Clock}>Pendiente de enviar</Estado>)
                : lim.envio?.estado === "hecha" ? <Estado tono="ok" icono={CheckCircle2}>Enviado a Odoo</Estado>
                  : !sinOdoo ? <Estado tono="ok" icono={CheckCircle2}>Al día con Odoo</Estado> : null}
          </div>
          {lim.pendiente && lim.envio?.estado === "error" && <p className="break-words text-xs text-destructive">{lim.envio.error}</p>}
          {sinOdoo && Number(lim.valor) > 0 && <p className="text-[11px] text-muted-foreground">Se envía cuando el cliente se cree en Odoo.</p>}
          {!sinOdoo && lim.pendiente && !enCurso(lim.envio) && (
            <Button size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-xs" disabled={ocupado === "limite"}
              onClick={() => accion("limite", "enviar_limite_credito_odoo", { p_cliente_id: clienteId }, "Límite enviado a Odoo")}>
              {ocupado === "limite" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} {lim.envio?.estado === "error" ? "Reintentar" : "Enviar ahora"}
            </Button>
          )}
        </div>
      </div>

      {mostrarCandidatos && (
        <div className="mt-3 rounded-md border border-warning/50" data-testid="candidatos-odoo">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-warning/40 bg-warning/10 px-3 py-1.5">
            <p className="text-xs font-medium">Coincidencias en Odoo: elige con cuál enlazar este cliente{puedeCrearNuevo ? " o crea uno nuevo" : ""}</p>
            {puedeCrear && puedeCrearNuevo && (
              <Button size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-xs" disabled={!!ocupado}
                onClick={() => accion("crear", "elegir_cliente_odoo", { p_cliente_id: clienteId, p_odoo_id: null }, "Se creará como cliente nuevo en Odoo")}>
                <PlusCircle className="h-3.5 w-3.5" /> Crear nuevo en Odoo
              </Button>
            )}
          </div>
          <Table>
            <TableHeader><TableRow><TableHead>Contacto en Odoo</TableHead><TableHead>RIF</TableHead><TableHead>Coincide por</TableHead><TableHead>Compañía</TableHead><TableHead className="w-24"><span className="sr-only">Elegir</span></TableHead></TableRow></TableHeader>
            <TableBody>
              {candidatos.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="min-w-[160px] text-xs font-medium">{c.nombre ?? `Contacto ${c.id}`}
                    <span className="ml-1 text-[11px] font-normal text-muted-foreground">{[c.cliente && "cliente", c.proveedor && "proveedor", !c.activo && "archivado", c.ciudad].filter(Boolean).join(" · ")}</span>
                    {c.ligado_a && <p className="text-[11px] text-destructive">Ya ligado a {c.ligado_a.nombre}</p>}</TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-xs">{c.rif ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs">{c.coincide === "nombre" ? (c.rif_distinto ? "Nombre (otro RIF)" : "Nombre") : c.coincide === "rif" ? "RIF" : "RIF y nombre"}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{c.compartido ? "Compartido" : c.compania ?? "—"}</TableCell>
                  <TableCell className="py-1 text-right">
                    {puedeCrear && !c.ligado_a && (
                      <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" disabled={!!ocupado} aria-label={`Enlazar con ${c.nombre ?? c.id}`}
                        onClick={() => accion(`e${c.id}`, "elegir_cliente_odoo", { p_cliente_id: clienteId, p_odoo_id: c.id }, "Se enlazará con el contacto elegido")}>
                        {ocupado === `e${c.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />} Enlazar
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {puedeCrear && sinOdoo && (
        <CompletarDatosDialog open={completar} onOpenChange={setCompletar} clienteId={clienteId} datos={estado.datos} onEnviado={() => { cargar(); onCambio(); }} />
      )}
    </Panel>
  );
}

/** Insignia del estado en Odoo de un contacto (pestaña Contactos de la ficha). */
export function EstadoOdooContacto({ contacto }: { contacto?: EstadoOdoo["contactos"][number] }) {
  if (!contacto) return <span className="text-muted-foreground">—</span>;
  if (contacto.odoo_id) return <span className="text-success">En Odoo</span>;
  if (!contacto.activo) return <span className="text-muted-foreground">No se envía</span>;
  const e = contacto.envio;
  if (enCurso(e)) return <span className="text-primary">Enviando…</span>;
  if (e?.estado === "error") return <span className="text-destructive" title={e.error ?? ""}>Error</span>;
  if (e?.estado === "simulada") return <span className="text-warning">Simulado</span>;
  return <span className="text-muted-foreground">Pendiente</span>;
}
