import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ImageOff, Loader2, RefreshCw, UserPlus, Ban } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fechaHora, fechaCorta } from "@/components/delivery/fechas";
import { EstadoTransferencia } from "@/components/inventario/EstadoTransferencia";
import { OdooBadge } from "@/components/OdooBadge";
import {
  ESTADO_ENTREGA, ESTADO_ESCRITURA, MOTIVOS_LINEA, ABIERTAS, CLS_REPOSICION, etiquetaMotivo, fmtCantidad, fmtDia, fmtFecha, telefonos, type LineaCierre,
} from "@/components/delivery/entregas";
import { ETIQUETA_UBICACION, type EstadoUbicacion } from "@/components/delivery/ubicaciones";
import { verEnGoogle } from "@/components/mapas/geo";

// ── Tipos del admin (documentos de entrega de Odoo + entregas de GUDS + escritura en Odoo) ──
export interface ItemDoc {
  id: string; odoo_id: number; nombre_producto: string | null; cantidad_demandada: number | null; cantidad_hecha: number | null;
  estado: string | null; unidad: string | null;
}
export interface DocEntrega {
  id: string; empresa_id: string; odoo_id: number; numero: string; tipo: string; origen: string | null; estado: string; contacto: string | null;
  fecha_programada: string | null; fecha_realizada: string | null; direccion_entrega: string | null; ciudad_entrega: string | null;
  region_entrega: string | null; telefono_entrega: string | null; notas: string | null; odoo_sync_at: string | null;
  almacen?: { nombre: string; tipo: string } | null; cliente?: { nombre_negocio: string } | null; items?: ItemDoc[];
  // Reposición a consignación: almacén destino y su cliente (donde se entrega)
  almacen_destino?: { nombre: string; tipo: string; cliente_id?: string | null; cliente?: { nombre_negocio: string } | null } | null;
  // Destino (20f): cliente del documento y contacto de Odoo (la sucursal si es una dirección de entrega)
  cliente_id?: string | null; partner_odoo_id?: number | null;
}
export interface EntregaAdmin {
  id: string; transferencia_id: string | null; transferencia_odoo_id: number | null; orden_id: string | null; doc_numero: string | null;
  empresa_id: string; estado: string; prioridad: string | null; repartidor_id: string | null; created_at: string;
  fecha_asignacion: string | null; fecha_inicio_entrega: string | null; fecha_entrega: string | null; fecha_cierre: string | null;
  receptor_nombre: string | null; notas: string | null; motivo_fallo: string | null; motivo_codigo: string | null; motivo_detalle: string | null;
  reprogramada_para: string | null; deja_pendiente: boolean | null; lineas: LineaCierre[] | null; origen_cierre: string | null;
  firma_url: string | null; foto_entrega_url: string | null; doc_direccion: string | null;
  // 20f: destino, ruta del día y GPS del cierre
  cliente_id?: string | null; direccion_id?: string | null; fecha_ruta?: string | null; orden_ruta?: number | null;
  cierre_lat?: number | null; cierre_lng?: number | null; cierre_precision_m?: number | null;
  repartidor?: { nombre: string; apellido: string | null } | null;
  orden?: { numero: string; direccion_entrega: string | null; cliente?: { nombre_negocio: string } | null } | null;
  cliente?: { nombre_negocio: string } | null;
  documento?: DocEntrega | null;
}
export interface EscrituraOdoo {
  id: string; referencia_id: string; estado: string; error: string | null; intentos: number; created_at: string; procesado_at: string | null;
  resultado: PlanOdoo | null;
}
export interface PlanOdoo {
  modo?: string; resultado?: string; resultado_odoo?: string; mensaje?: string; crear_pendiente?: boolean; motivo_pendiente?: string;
  escrituras?: { modelo: string; ids: number[]; valores: Record<string, unknown>; detalle: string }[];
  validacion?: { modelo: string; metodo: string; ids: number[]; contexto: Record<string, unknown> };
  advertencias?: string[]; pendientes?: { id: number; nombre: string; estado: string }[];
  documento?: { nombre?: string; estado?: string; write_date?: string };
}
export type Situacion = "por_asignar" | "asignada" | "en_camino" | "cerrada";
export interface FilaDoc {
  clave: string; doc: DocEntrega | null; entrega: EntregaAdmin | null; intentos: EntregaAdmin[]; situacion: Situacion;
  escritura: EscrituraOdoo | null;
}

export const nombreRepartidor = (e: EntregaAdmin | null) => (e?.repartidor ? `${e.repartidor.nombre} ${e.repartidor.apellido || ""}`.trim() : "—");
export const numeroFila = (f: FilaDoc) => f.doc?.numero || f.entrega?.doc_numero || f.entrega?.orden?.numero || "—";
export const esReposicion = (d: DocEntrega | null | undefined) => d?.tipo === "interna";
export const clienteFila = (f: FilaDoc) => (esReposicion(f.doc) ? f.doc?.almacen_destino?.cliente?.nombre_negocio : f.doc?.cliente?.nombre_negocio)
  || f.entrega?.cliente?.nombre_negocio || f.entrega?.orden?.cliente?.nombre_negocio || f.doc?.almacen_destino?.nombre || f.doc?.contacto || "—";
/** Insignia de tipo: reposición a consignación o corte de consignación (las ventas desde almacén propio no llevan). */
export function TipoDocBadge({ doc }: { doc: DocEntrega | null | undefined }) {
  if (esReposicion(doc)) return <Badge variant="outline" className={`h-4 whitespace-nowrap px-1 text-[10px] font-normal ${CLS_REPOSICION}`}>Reposición a consignación</Badge>;
  if (doc?.almacen?.tipo === "consignacion") return <Badge variant="outline" className="h-4 whitespace-nowrap px-1 text-[10px] font-normal">Corte de consignación</Badge>;
  return null;
}

// La evidencia vive en el bucket PRIVADO "evidencias-entrega" (se guarda la ruta <entrega>/<archivo>): se abre con una
// URL firmada de 1 hora. Las entregas viejas podían tener una URL pública completa: se usa tal cual.
const URL_FIRMADA_SEG = 3600;
async function urlEvidencia(ruta: string | null): Promise<string | null> {
  if (!ruta) return null;
  if (/^https?:\/\//.test(ruta)) return ruta;
  const { data, error } = await supabase.storage.from("evidencias-entrega").createSignedUrl(ruta, URL_FIRMADA_SEG);
  if (error || !data?.signedUrl) throw new Error(error?.message || "sin URL");
  return data.signedUrl;
}

export function Evidencia({ titulo, ruta, fondoBlanco }: { titulo: string; ruta: string | null; fondoBlanco?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [estado, setEstado] = useState<"cargando" | "ok" | "vacio" | "error">(ruta ? "cargando" : "vacio");
  useEffect(() => {
    let vivo = true;
    if (!ruta) { setEstado("vacio"); return; }
    setEstado("cargando");
    urlEvidencia(ruta)
      .then((u) => { if (vivo) { setUrl(u); setEstado(u ? "ok" : "vacio"); } })
      .catch(() => { if (vivo) setEstado("error"); });
    return () => { vivo = false; };
  }, [ruta]);
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs font-medium text-muted-foreground">{titulo}</p>
      <div className={`flex min-h-[120px] items-center justify-center overflow-hidden rounded-lg border border-border ${fondoBlanco ? "bg-white" : "bg-muted/40"}`}>
        {estado === "cargando" && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
        {estado === "vacio" && <span className="text-xs text-muted-foreground">Sin {titulo.toLowerCase()}</span>}
        {estado === "error" && <span className="flex items-center gap-1.5 px-3 text-center text-xs text-destructive"><ImageOff className="h-4 w-4 shrink-0" />No se pudo abrir la evidencia</span>}
        {estado === "ok" && url && (
          <a href={url} target="_blank" rel="noopener noreferrer" title="Abrir en tamaño completo" className="block w-full">
            <img src={url} alt={titulo} className="max-h-72 w-full object-contain" onError={() => setEstado("error")} />
          </a>
        )}
      </div>
    </div>
  );
}

const Dato = ({ etiqueta, children, ancho }: { etiqueta: string; children: React.ReactNode; ancho?: boolean }) => (
  <div className={`min-w-0 ${ancho ? "col-span-2 sm:col-span-3" : ""}`}>
    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{etiqueta}</p>
    <div className="break-words text-sm">{children}</div>
  </div>
);

export function InsigniaOdooCierre() {
  return <Badge variant="outline" className="whitespace-nowrap border-[#714B67]/30 bg-[#714B67]/10 font-normal text-[#714B67] dark:text-[#d7b6cf]">Actualizado desde Odoo</Badge>;
}

export function EstadoEntregaBadge({ estado }: { estado: string }) {
  const e = ESTADO_ENTREGA[estado] ?? { label: estado, cls: "" };
  return <Badge variant="outline" className={`whitespace-nowrap font-normal ${e.cls}`}>{e.label}</Badge>;
}

export function EscrituraBadge({ esc }: { esc: EscrituraOdoo | null }) {
  if (!esc) return null;
  const e = ESTADO_ESCRITURA[esc.estado] ?? { label: esc.estado, cls: "", titulo: "" };
  const yaValidado = esc.resultado?.resultado === "ya_validado";
  return <Badge variant="outline" title={esc.error || e.titulo} className={`whitespace-nowrap font-normal ${e.cls}`}>{yaValidado ? "Ya validado en Odoo" : e.label}</Badge>;
}

/** Detalle de un documento de entrega para el admin: datos del documento de Odoo (tal cual), líneas y lotes, la entrega de
 *  GUDS (repartidor, resultado y evidencia) y el estado de la escritura en Odoo, con "Reintentar". */
export function DetalleEntregaDialog({ fila, onClose, onAsignar, onAnular, onReintentar, puedeEditar, ubicacion, onUbicar }: {
  fila: FilaDoc | null; onClose: () => void; onAsignar: (f: FilaDoc) => void; onAnular: (e: EntregaAdmin) => void;
  onReintentar: (esc: EscrituraOdoo) => Promise<void>; puedeEditar: boolean;
  /** 20f: estado de la ubicación del destino y abrir el editor en el mapa */
  ubicacion?: EstadoUbicacion; onUbicar?: (f: FilaDoc) => void;
}) {
  const [lotes, setLotes] = useState<Record<string, { lote: string | null; cantidad: number; vence: string | null }[]>>({});
  const [reintentando, setReintentando] = useState(false);
  const f = fila;
  const doc = f?.doc ?? null;
  const e = f?.entrega ?? null;
  const esc = f?.escritura ?? null;

  useEffect(() => {
    setLotes({});
    if (!doc?.id) return;
    let vivo = true;
    supabase.from("transferencia_lotes").select("item_id, lote_nombre, cantidad, lote:lotes(vencimiento)").eq("transferencia_id", doc.id)
      .then(({ data }) => {
        if (!vivo) return;
        const m: Record<string, { lote: string | null; cantidad: number; vence: string | null }[]> = {};
        for (const l of (data as unknown as { item_id: string; lote_nombre: string | null; cantidad: number; lote: { vencimiento: string | null } | null }[] | null) ?? []) {
          (m[l.item_id] ||= []).push({ lote: l.lote_nombre, cantidad: Number(l.cantidad), vence: l.lote?.vencimiento ?? null });
        }
        setLotes(m);
      });
    return () => { vivo = false; };
  }, [doc?.id]);

  if (!f) return <Dialog open={false} />;
  const abierta = !!e && ABIERTAS.includes(e.estado);
  const cierre = new Map((e?.lineas ?? []).map((l) => [l.item_id, l]));
  const items = (doc?.items ?? []).filter((i) => i.estado !== "cancelada").sort((a, b) => a.odoo_id - b.odoo_id);
  const tels = telefonos(doc?.telefono_entrega);
  const plan = esc?.resultado ?? null;
  const reintentar = async () => { if (!esc) return; setReintentando(true); try { await onReintentar(esc); } finally { setReintentando(false); } };
  const anteriores = f.intentos.filter((x) => x.id !== e?.id);

  return (
    <Dialog open={!!f} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
            <span className="font-mono">{numeroFila(f)}</span>
            {doc && <EstadoTransferencia estado={doc.estado} />}
            <TipoDocBadge doc={doc} />
            {e && <EstadoEntregaBadge estado={e.estado} />}
            {e?.origen_cierre === "odoo" && <InsigniaOdooCierre />}
            {doc && <OdooBadge sincronizado={doc.odoo_sync_at} titulo="Documento de entrega de Odoo: se muestra tal cual y se edita en Odoo" />}
          </DialogTitle>
          <DialogDescription>{clienteFila(f)}{doc?.origen ? ` · ${doc.origen}` : ""}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {esReposicion(doc)
            ? <Dato etiqueta="Almacén de consignación">{doc?.almacen_destino?.nombre || "—"}{doc?.almacen_destino?.cliente ? <span className="block text-muted-foreground">{doc.almacen_destino.cliente.nombre_negocio}</span> : null}</Dato>
            : doc?.contacto && <Dato etiqueta="Entregar a">{doc.contacto}</Dato>}
          <Dato etiqueta="Dirección de entrega" ancho={!doc?.contacto}>
            {doc?.direccion_entrega || e?.doc_direccion || e?.orden?.direccion_entrega || "—"}
            {doc?.ciudad_entrega && <span className="text-muted-foreground"> · {doc.ciudad_entrega}</span>}
            {doc?.region_entrega && <span className="text-muted-foreground"> · {doc.region_entrega.replace(/\s*\(VE\)$/, "")}</span>}
          </Dato>
          <Dato etiqueta="Teléfono">{tels.length ? tels.join(" · ") : "—"}</Dato>
          {ubicacion && (
            <Dato etiqueta="Ubicación en el mapa">
              <span className={ETIQUETA_UBICACION[ubicacion].cls}>{ETIQUETA_UBICACION[ubicacion].label}</span>
              {onUbicar && <button type="button" className="ml-2 text-xs text-primary hover:underline" onClick={() => onUbicar(f)}>{ubicacion === "sin" ? "Ubicar" : ubicacion === "propuesta" ? "Revisar" : "Ver / editar"}</button>}
            </Dato>
          )}
          {e?.fecha_ruta && <Dato etiqueta="Ruta">{fmtDia(e.fecha_ruta)}{e.orden_ruta ? ` · parada ${e.orden_ruta}` : ""}</Dato>}
          {e?.cierre_lat != null && e.cierre_lng != null && (
            <Dato etiqueta="GPS al cerrar">
              <a className="text-primary hover:underline" href={verEnGoogle({ lat: Number(e.cierre_lat), lng: Number(e.cierre_lng) })} target="_blank" rel="noopener noreferrer">
                {Number(e.cierre_lat).toFixed(5)}, {Number(e.cierre_lng).toFixed(5)}
              </a>{e.cierre_precision_m != null ? <span className="text-muted-foreground"> · ±{Math.round(Number(e.cierre_precision_m))} m</span> : null}
            </Dato>
          )}
          {doc && <Dato etiqueta="Programada">{fechaCorta(doc.fecha_programada)}</Dato>}
          {doc?.almacen && <Dato etiqueta="Sale de">{doc.almacen.nombre}{doc.almacen.tipo === "consignacion" ? " (consignación)" : ""}</Dato>}
          {e && <Dato etiqueta="Repartidor">{nombreRepartidor(e)}{e.prioridad === "alta" ? <span className="text-destructive"> · prioridad alta</span> : null}</Dato>}
          {e && <Dato etiqueta="Asignada">{fechaHora(e.fecha_asignacion)}</Dato>}
          {e?.fecha_inicio_entrega && <Dato etiqueta="Salió a entregar">{fechaHora(e.fecha_inicio_entrega)}</Dato>}
          {e && !abierta && <Dato etiqueta="Cerrada">{fechaHora(e.fecha_cierre || e.fecha_entrega)}</Dato>}
          {e?.receptor_nombre && !abierta && <Dato etiqueta={e.estado === "rechazada" ? "Rechazó" : "Recibió"}>{e.receptor_nombre}</Dato>}
          {e?.deja_pendiente != null && !abierta && <Dato etiqueta="Pendiente en Odoo">{e.deja_pendiente ? "Sí, con lo no entregado" : "No"}</Dato>}
          {e?.reprogramada_para && <Dato etiqueta="Nueva fecha">{fmtDia(e.reprogramada_para)}</Dato>}
          {(e?.motivo_codigo || e?.motivo_detalle) && !abierta && (
            <Dato etiqueta="Motivo" ancho>{e.motivo_codigo ? etiquetaMotivo(e.motivo_codigo) : ""}{e.motivo_detalle ? `${e.motivo_codigo ? " — " : ""}${e.motivo_detalle}` : ""}</Dato>
          )}
          {e?.notas && <Dato etiqueta="Notas del repartidor" ancho>{e.notas}</Dato>}
          {doc?.notas && <Dato etiqueta="Notas del documento (Odoo)" ancho>{doc.notas}</Dato>}
        </div>

        {items.length > 0 && (
          <div className="rounded-lg border border-border">
            <Table containerClassName="max-h-72">
              <TableHeader><TableRow>
                <TableHead>Producto</TableHead><TableHead className="text-right">Pedido</TableHead>
                <TableHead className="text-right">{doc?.estado === "hecha" ? "Hecho" : "Reservado"}</TableHead>
                {cierre.size > 0 && <TableHead className="text-right">Entregado</TableHead>}
                <TableHead>Lotes</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {items.map((i) => {
                  const c = cierre.get(i.id);
                  const corto = Number(i.cantidad_hecha ?? 0) < Number(i.cantidad_demandada ?? 0) && doc?.estado !== "hecha";
                  return (
                    <TableRow key={i.id}>
                      <TableCell className="min-w-[200px]">{i.nombre_producto}</TableCell>
                      <TableCell className="whitespace-nowrap text-right">{fmtCantidad(i.cantidad_demandada)}</TableCell>
                      <TableCell className={`whitespace-nowrap text-right ${corto ? "font-semibold text-warning" : ""}`} title={corto ? "Odoo no tiene todo reservado: lo que falta no sale en el camión" : undefined}>
                        {fmtCantidad(i.cantidad_hecha)}
                      </TableCell>
                      {cierre.size > 0 && (
                        <TableCell className="whitespace-nowrap text-right">
                          {c ? <>{fmtCantidad(c.entregada)}{c.motivo && <span className="block text-[11px] text-muted-foreground">{etiquetaMotivo(c.motivo, MOTIVOS_LINEA)}</span>}</> : "—"}
                        </TableCell>
                      )}
                      <TableCell className="text-xs text-muted-foreground">
                        {(lotes[i.id] ?? []).map((l) => `${l.lote ?? "—"} (${fmtCantidad(l.cantidad)}${l.vence ? `, vence ${fmtFecha(l.vence)}` : ""})`).join(" · ") || "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {e && !abierta && (e.firma_url || e.foto_entrega_url) && (
          <div className="grid grid-cols-1 gap-3 border-t border-border pt-3 sm:grid-cols-2">
            <Evidencia titulo="Firma" ruta={e.firma_url} fondoBlanco />
            <Evidencia titulo="Foto" ruta={e.foto_entrega_url} />
          </div>
        )}

        {esc && (
          <div className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-medium">Escritura en Odoo <EscrituraBadge esc={esc} /></div>
              {puedeEditar && (esc.estado === "error" || esc.estado === "simulada") && (
                <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={reintentar} disabled={reintentando}
                  title={esc.estado === "simulada" ? "Vuelve a procesarla con el modo vigente (simular o activo)" : "Vuelve a intentar escribir en Odoo"}>
                  {reintentando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  {esc.estado === "error" ? "Reintentar" : "Volver a procesar"}
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">Solicitada {fechaHora(esc.created_at)}{esc.procesado_at ? ` · procesada ${fechaHora(esc.procesado_at)}` : ""} · {esc.intentos} {esc.intentos === 1 ? "intento" : "intentos"}</p>
            {esc.error && <p className="rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">{esc.error}</p>}
            {plan?.mensaje && <p className="text-xs">{plan.mensaje}</p>}
            {plan?.motivo_pendiente && <p className="text-xs"><span className="font-medium">Pendiente:</span> {plan.crear_pendiente ? "se crea" : "no se crea"} — {plan.motivo_pendiente}</p>}
            {!!plan?.escrituras?.length && (
              <div className="text-xs">
                <p className="font-medium">{esc.estado === "hecha" ? "Se escribió en Odoo:" : "Se escribiría en Odoo:"}</p>
                <ul className="ml-4 list-disc text-muted-foreground">
                  {plan.escrituras.map((w, k) => <li key={k}><span className="font-mono">{w.modelo}.write({JSON.stringify(w.valores)})</span> — {w.detalle}</li>)}
                </ul>
              </div>
            )}
            {plan?.validacion && (
              <p className="text-xs"><span className="font-medium">{esc.estado === "hecha" ? "Validación:" : "Validación que se haría:"}</span>{" "}
                <span className="font-mono text-muted-foreground">{plan.validacion.modelo}.{plan.validacion.metodo}({JSON.stringify(plan.validacion.ids)}) contexto {JSON.stringify(plan.validacion.contexto)}</span>
              </p>
            )}
            {!!plan?.pendientes?.length && <p className="text-xs"><span className="font-medium">Pendiente creado en Odoo:</span> {plan.pendientes.map((p) => p.nombre).join(", ")}</p>}
            {!!plan?.advertencias?.length && (
              <ul className="ml-4 list-disc text-xs text-warning">{plan.advertencias.map((a, k) => <li key={k}>{a}</li>)}</ul>
            )}
          </div>
        )}

        {anteriores.length > 0 && (
          <div className="text-xs">
            <p className="mb-1 font-medium">Intentos anteriores</p>
            <ul className="space-y-1">
              {anteriores.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-2 text-muted-foreground">
                  <EstadoEntregaBadge estado={x.estado} /> {nombreRepartidor(x)} · {fechaHora(x.fecha_cierre || x.fecha_asignacion)}
                  {x.motivo_codigo && <span>· {etiquetaMotivo(x.motivo_codigo)}</span>}
                  {x.reprogramada_para && <span>· para el {fmtDia(x.reprogramada_para)}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {puedeEditar && (f.situacion === "por_asignar" || abierta) && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
            {abierta && e && (
              <Button variant="outline" size="sm" className="gap-1" onClick={() => onAnular(e)}><Ban className="h-3.5 w-3.5" />Quitar asignación</Button>
            )}
            {doc && (
              <Button size="sm" className="gap-1" onClick={() => onAsignar(f)} disabled={doc.estado !== "lista"}
                title={doc.estado !== "lista" ? "Se asigna cuando Odoo tenga el documento «Listo»" : undefined}>
                <UserPlus className="h-3.5 w-3.5" />{abierta ? "Reasignar" : "Asignar repartidor"}
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
