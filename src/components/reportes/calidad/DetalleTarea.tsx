import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, ExternalLink, Loader2, MapPin, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/hooks/use-toast";
import { mostrarEstado } from "@/lib/estados";
import { actualizarTareas, leerHistorial, type Responsable } from "./datos";
import { ESCRITURA, ESTADO_CUADRE, ESTADO_TAREA, TIPOS, TIPOS_DIRECCION, datoActual, enlaceOdoo, nombreEntidad, type Historial, type Tarea } from "./tipos";

const SIN = "_sin";
const fechaHora = (v: string) => new Date(v).toLocaleString("es-VE", { dateStyle: "short", timeStyle: "short" });
const fecha = (v: unknown) => (typeof v === "string" && v ? v.slice(0, 10).split("-").reverse().join("/") : "—");
const t = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

const ACCION: Record<string, string> = {
  detectada: "Detectada", corregida: "Corregida", reabierta: "Reabierta", explicada: "Explicada", pendiente: "Volvió a pendiente",
  responsable: "Responsable", comentario: "Comentario", enviada_odoo: "Corrección enviada a Odoo",
};

export function InsigniaEstado({ estado }: { estado: Tarea["estado"] }) {
  const e = ESTADO_TAREA[estado];
  return <span title={e.ayuda} className={`inline-flex h-5 items-center rounded border px-1.5 text-[11px] font-medium ${e.clase}`}>{e.texto}</span>;
}

export function EstadoEscritura({ tarea }: { tarea: Tarea }) {
  const e = tarea.escritura;
  if (!e) return null;
  const x = ESCRITURA[e.estado] ?? { texto: e.estado, clase: "text-muted-foreground" };
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] ${x.clase}`} title={e.error ?? undefined}>
      {(e.estado === "pendiente" || e.estado === "procesando") && <Loader2 className="h-3 w-3 animate-spin" />}
      {x.texto}
    </span>
  );
}

/** Panel lateral de una tarea: datos, cómo se corrige, responsable, comentario, explicado e historial. */
export function DetalleTarea({ tarea, abierta, onCerrar, responsables, puedeEditar, soloLectura, odooBase, cidOdoo, empresaNombre, onCambio, onCorregir }: {
  tarea: Tarea | null;
  abierta: boolean;
  onCerrar: () => void;
  responsables: Responsable[];
  puedeEditar: boolean;
  soloLectura: boolean;
  odooBase: string | null;
  cidOdoo: (empresaId: string | null) => number | null;
  empresaNombre: (empresaId: string | null) => string;
  onCambio: (id: string) => void;
  onCorregir: (t: Tarea) => void;
}) {
  const { formatPrice } = useCurrency();
  const { toast } = useToast();
  const [historial, setHistorial] = useState<Historial[] | null>(null);
  const [comentario, setComentario] = useState("");
  const [guardando, setGuardando] = useState<string | null>(null);

  useEffect(() => {
    if (!tarea || !abierta) return;
    setComentario(tarea.comentario ?? "");
    setHistorial(null);
    leerHistorial(tarea.id).then(setHistorial);
  }, [tarea?.id, tarea?.updated_at, abierta]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!tarea) return null;
  const def = TIPOS[tarea.tipo];
  const d = tarea.detalle;
  const editable = puedeEditar && !(soloLectura && tarea.empresa_id);
  const motivoNoEditable = !puedeEditar ? "Tu rol solo puede consultar la bandeja" : soloLectura && tarea.empresa_id ? "Modo consulta («Ambas»): elige la empresa en el menú superior para trabajar la tarea" : null;
  const url = enlaceOdoo(odooBase, tarea, cidOdoo(tarea.empresa_id));
  const asistida = TIPOS_DIRECCION.includes(tarea.tipo) && tarea.estado !== "corregido";
  const enviando = tarea.escritura && ["pendiente", "procesando"].includes(tarea.escritura.estado);

  const guardar = async (clave: string, cambios: Parameters<typeof actualizarTareas>[1]) => {
    setGuardando(clave);
    try {
      await actualizarTareas([tarea.id], cambios);
      onCambio(tarea.id);
      toast({ title: cambios.estado === "explicado" ? "Marcada como explicada" : cambios.estado === "pendiente" ? "Vuelve a pendiente" : "Guardado" });
    } catch (e) {
      toast({ title: "No se pudo guardar", description: (e as Error).message, variant: "destructive" });
    } finally { setGuardando(null); }
  };

  const filas: [string, ReactNode][] = [];
  const add = (k: string, v: ReactNode) => filas.push([k, v]);
  if (tarea.entidad === "cliente") {
    add("RIF", t(d.rif)); add("Calle", t(d.calle)); add("Ciudad", t(d.ciudad));
    add("Estado", d.estado ? <>{t(d.estado)}{mostrarEstado(String(d.estado)) !== d.estado && <span className="text-muted-foreground"> · se muestra «{mostrarEstado(String(d.estado))}»</span>}</> : "—");
    add("Condición de pago", t(d.condicion_pago)); add("Vendedor", t(d.vendedor));
    add("Venta 12 meses", formatPrice(Number(d.venta_12m ?? 0))); add("Última compra", fecha(d.ultima_compra));
    if (asistida && (d.sugerido?.ciudad || d.sugerido?.estado)) add("Sugerido", [t(d.sugerido?.ciudad), mostrarEstado(String(d.sugerido?.estado ?? ""))].filter((x) => x && x !== "—").join(", "));
  } else if (tarea.entidad === "producto") {
    add("Categoría", t(d.categoria)); add("Última venta", fecha(d.ultima_venta)); add("Unidades", Number(d.unidades ?? 0).toLocaleString("es-VE"));
    add("Venta", formatPrice(Number(d.venta_usd ?? 0)));
  } else if (tarea.entidad === "estado") {
    add("Nombre en Odoo", t(d.estado)); add("Se muestra", t(d.mostrado)); add("Clientes", t(d.clientes));
  } else if (tarea.entidad === "pago") {
    add("Fecha", fecha(d.fecha)); add("Banco", t(d.banco)); add("Monto", formatPrice(Number(d.monto_usd ?? 0)));
    add("Aplicado", formatPrice(Number(d.aplicado_usd ?? 0))); add("Sin aplicar", formatPrice(Number(d.sin_aplicar_usd ?? 0)));
  } else {
    add("Fecha", fecha(d.fecha));
    if (d.estado_cuadre) add("Estado del cuadre", <span title={ESTADO_CUADRE[String(d.estado_cuadre)]?.ayuda}>{ESTADO_CUADRE[String(d.estado_cuadre)]?.texto ?? t(d.estado_cuadre)}</span>);
    if (d.total_odoo_usd !== undefined && d.total_odoo_usd !== null) add("Total en Odoo", formatPrice(Number(d.total_odoo_usd)));
    if (d.total_profit_usd !== undefined && d.total_profit_usd !== null) add("Total en Profit", formatPrice(Number(d.total_profit_usd)));
    if (d.diferencia_usd !== undefined && d.diferencia_usd !== null) add("Diferencia", formatPrice(Number(d.diferencia_usd)));
    if (d.saldo_usd !== undefined || d.saldo_odoo_usd !== undefined) add("Saldo en Odoo", formatPrice(Number(d.saldo_usd ?? d.saldo_odoo_usd ?? 0)));
    if (d.tipo_profit) add("Documento Profit", `${t(d.tipo_profit)} ${t(d.numero_profit)} · ${fecha(d.fecha_profit)} · ${t(d.estatus_profit)}`);
    if (d.motivo) add("Motivo", t(d.motivo));
    if (d.diario) add("Diario", t(d.diario));
    if (d.total_bs !== undefined) add("Total (Bs)", Number(d.total_bs ?? 0).toLocaleString("es-VE", { minimumFractionDigits: 2 }));
    if (d.rif) add("RIF", t(d.rif));
  }

  return (
    <Sheet open={abierta} onOpenChange={(v) => !v && onCerrar()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader className="space-y-1 text-left">
          <SheetTitle className="pr-6 text-base leading-tight">{nombreEntidad(tarea)}</SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-1.5 text-xs">
            <InsigniaEstado estado={tarea.estado} /> <span>{def?.titulo ?? tarea.tipo}</span> · <span>{empresaNombre(tarea.empresa_id)}</span>
          </SheetDescription>
        </SheetHeader>

        <div className="mt-3 space-y-4 text-sm">
          <p className="rounded-md border border-border bg-muted/40 px-2.5 py-2 text-xs">
            <span className="font-medium">{datoActual(tarea, formatPrice)}</span>
            <span className="mt-0.5 block text-muted-foreground">{def?.ayuda}.</span>
          </p>

          <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-3 gap-y-1 text-xs">
            {filas.map(([k, v]) => <Fragment key={k}><dt className="text-muted-foreground">{k}</dt><dd className="min-w-0 break-words">{v}</dd></Fragment>)}
          </dl>

          <div className="space-y-1.5">
            <p className="text-xs"><span className="text-muted-foreground">Dónde se corrige:</span> <span className="font-medium">{def?.donde}</span></p>
            <div className="flex flex-wrap gap-2">
              {asistida && (
                <Button size="sm" onClick={() => onCorregir(tarea)} disabled={!editable || !!enviando || !tarea.entidad_id}
                  title={motivoNoEditable ?? "Escribe la dirección corregida en Odoo"}>
                  <MapPin className="mr-1.5 h-4 w-4" />Corregir en Odoo
                </Button>
              )}
              {url && (
                <Button size="sm" variant="outline" asChild>
                  <a href={url} target="_blank" rel="noreferrer"><ExternalLink className="mr-1.5 h-4 w-4" />Abrir en Odoo</a>
                </Button>
              )}
              {tarea.entidad === "cliente" && tarea.entidad_id && (
                <Button size="sm" variant="ghost" asChild><Link to={`/admin/clientes/${tarea.entidad_id}`}>Ver ficha</Link></Button>
              )}
            </div>
            {tarea.escritura && (
              <p className="text-xs"><EstadoEscritura tarea={tarea} />
                {tarea.escritura.error && <span className="mt-0.5 block text-destructive">{tarea.escritura.error}</span>}
                {tarea.escritura.estado === "hecha" && tarea.estado !== "corregido" && <span className="mt-0.5 block text-muted-foreground">La tarea se cierra en la próxima revisión (al momento o con la siguiente sincronización).</span>}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="calidad-resp" className="text-xs">Responsable</Label>
            <Select value={tarea.responsable_id ?? SIN} disabled={!editable || guardando !== null}
              onValueChange={(v) => guardar("resp", { responsable: v === SIN ? null : v })}>
              <SelectTrigger id="calidad-resp" className="h-8 text-[13px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={SIN} className="text-[13px]">Sin responsable</SelectItem>
                {responsables.map((r) => <SelectItem key={r.id} value={r.id} className="text-[13px]">{r.nombre}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="calidad-com" className="text-xs">Comentario {tarea.estado === "pendiente" && <span className="font-normal text-muted-foreground">(obligatorio para marcar explicado)</span>}</Label>
            <Textarea id="calidad-com" value={comentario} onChange={(e) => setComentario(e.target.value)} maxLength={2000} rows={3} disabled={!editable}
              placeholder="Qué se revisó, por qué la diferencia es correcta o qué falta…" className="text-[13px]" />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={!editable || guardando !== null || !comentario.trim() || comentario.trim() === (tarea.comentario ?? "").trim()}
                onClick={() => guardar("com", { comentario })}>
                {guardando === "com" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}Guardar comentario
              </Button>
              {tarea.estado === "pendiente" && (
                <Button size="sm" disabled={!editable || guardando !== null || !comentario.trim()} onClick={() => guardar("exp", { estado: "explicado", comentario })}>
                  {guardando === "exp" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}Marcar explicado
                </Button>
              )}
              {tarea.estado === "explicado" && (
                <Button size="sm" variant="outline" disabled={!editable || guardando !== null} onClick={() => guardar("pen", { estado: "pendiente" })}>
                  <RotateCcw className="mr-1.5 h-4 w-4" />Volver a pendiente
                </Button>
              )}
            </div>
            {motivoNoEditable && <p className="text-[11px] text-muted-foreground">{motivoNoEditable}.</p>}
          </div>

          <div>
            <p className="mb-1 text-xs font-medium">Historial</p>
            {historial === null ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : (
              <ol className="space-y-1.5 border-l border-border pl-3 text-xs">
                {historial.map((h) => (
                  <li key={h.id}>
                    <span className="font-medium">{ACCION[h.accion] ?? h.accion}</span>
                    {h.accion === "responsable" && <> · {h.a ?? "sin responsable"}</>}
                    <span className="text-muted-foreground"> · {fechaHora(h.at)} · {h.usuario_nombre ?? "—"}</span>
                    {h.comentario && <span className="block whitespace-pre-wrap text-muted-foreground">{h.comentario}</span>}
                    {h.accion === "enviada_odoo" && h.detalle?.despues ? (
                      <span className="block text-muted-foreground">
                        {Object.entries(h.detalle.despues as Record<string, string | null>).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(" · ")}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
