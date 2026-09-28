import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CalendarDays, ChevronDown, ChevronUp, MapPin, Navigation, Phone, Truck, ClipboardCheck, Loader2 } from "lucide-react";
import { fechaCorta, fechaHora } from "@/components/delivery/fechas";
import {
  ESTADO_ENTREGA, CLS_REPOSICION, etiquetaMotivo, telefonos, navegacion, fmtCantidad, fmtDia, MOTIVOS_LINEA, type EntregaReparto,
} from "@/components/delivery/entregas";

const ESTADO_ODOO: Record<string, string> = { lista: "Listo", en_espera: "En espera", parcial: "Parcial", borrador: "Borrador", hecha: "Hecho", cancelada: "Cancelado" };

/** Tarjeta de una entrega en la app del repartidor: documento, dirección, teléfono, líneas y acciones. */
export function TarjetaEntrega({ e, idx, onSalir, onCerrar, ocupado }: {
  e: EntregaReparto; idx?: number; onSalir?: (e: EntregaReparto) => void; onCerrar?: (e: EntregaReparto) => void; ocupado?: boolean;
}) {
  const [abierta, setAbierta] = useState(false);
  const abiertaGuds = e.estado === "asignada" || e.estado === "en_camino";
  const tels = telefonos(e.telefono);
  const est = ESTADO_ENTREGA[e.estado] ?? { label: e.estado, cls: "" };
  const lleva = e.lineas.filter((l) => Number(l.esperada) > 0);
  const unidades = lleva.reduce((s, l) => s + Number(l.esperada), 0);
  const avisoOdoo = abiertaGuds && e.es_documento && e.estado_odoo && e.estado_odoo !== "lista";
  return (
    <Card className={`border-border ${abiertaGuds && e.estado === "en_camino" ? "border-amber-400/70" : ""}`}>
      <CardContent className="p-4">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-3">
            {idx != null && (
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-bold ${e.estado === "en_camino" ? "bg-amber-500 text-white" : "bg-muted"}`}>{idx + 1}</div>
            )}
            <div className="min-w-0">
              <p className="font-semibold leading-snug">{e.cliente || e.contacto || "Cliente"}</p>
              <p className="text-xs text-muted-foreground">
                <span className="font-mono">{e.numero}</span>{e.origen ? ` · ${e.origen}` : ""}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Badge variant="outline" className={`whitespace-nowrap font-normal ${est.cls}`}>{est.label}</Badge>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{e.empresa}</span>
          </div>
        </div>

        <div className="space-y-1.5 text-sm">
          {e.tipo === "reposicion" && (
            <Badge variant="outline" className={`font-normal ${CLS_REPOSICION}`}>Reposición a consignación</Badge>
          )}
          {e.contacto && e.contacto !== e.cliente && (
            <p className="text-muted-foreground">{e.tipo === "reposicion" ? "Almacén de consignación" : "Entregar a"}: <span className="text-foreground">{e.contacto}</span></p>
          )}
          <p className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span>{e.direccion || "Sin dirección en Odoo"}{e.ciudad ? <span className="text-muted-foreground"> · {e.ciudad}</span> : null}</span>
          </p>
          {tels.length > 0 && <p className="flex items-center gap-2"><Phone className="h-4 w-4 shrink-0 text-muted-foreground" />{tels.join(" · ")}</p>}
          {abiertaGuds && e.fecha_programada && (
            <p className="flex items-center gap-2 text-muted-foreground"><CalendarDays className="h-4 w-4 shrink-0" />Programada: {fechaCorta(e.fecha_programada)}</p>
          )}
          {e.prioridad === "alta" && abiertaGuds && <Badge variant="destructive" className="text-xs">Prioridad alta</Badge>}
          {avisoOdoo && (
            <p className="flex items-start gap-2 rounded-md bg-amber-100 px-2 py-1.5 text-xs text-amber-900 dark:bg-amber-500/15 dark:text-amber-100">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              En Odoo el documento está «{ESTADO_ODOO[e.estado_odoo!] ?? e.estado_odoo}». Consulta con la oficina antes de salir.
            </p>
          )}
          {!abiertaGuds && (
            <div className="space-y-0.5 text-xs text-muted-foreground">
              {e.origen_cierre === "odoo" && <Badge variant="outline" className="mb-1 border-[#714B67]/30 bg-[#714B67]/10 font-normal text-[#714B67] dark:text-[#d7b6cf]">Actualizado desde Odoo</Badge>}
              {e.fecha_cierre && <p>Cerrada: {fechaHora(e.fecha_cierre)}</p>}
              {e.receptor_nombre && <p>Recibió: {e.receptor_nombre}</p>}
              {e.motivo_codigo && <p>Motivo: {etiquetaMotivo(e.motivo_codigo)}{e.motivo_detalle ? ` — ${e.motivo_detalle}` : ""}</p>}
              {!e.motivo_codigo && e.motivo_detalle && <p>{e.motivo_detalle}</p>}
              {e.reprogramada_para && <p>Nueva fecha: {fmtDia(e.reprogramada_para)}</p>}
            </div>
          )}
        </div>

        {e.lineas.length > 0 && (
          <div className="mt-2">
            <button type="button" onClick={() => setAbierta((v) => !v)} className="flex w-full items-center justify-between rounded-md bg-muted/50 px-2 py-1.5 text-left text-sm">
              <span>{lleva.length} {lleva.length === 1 ? "producto" : "productos"} · {fmtCantidad(unidades)} unidades</span>
              {abierta ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {abierta && (
              <ul className="mt-1 divide-y divide-border rounded-md border border-border text-sm">
                {e.lineas.map((l) => {
                  const cierre = e.lineas_cierre?.find((c) => c.item_id === l.id);
                  return (
                    <li key={l.id} className="px-2 py-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0 leading-snug">{l.producto}</span>
                        <span className="shrink-0 text-right tabular-nums">
                          <span className="font-semibold">{fmtCantidad(l.esperada)}</span> <span className="text-xs text-muted-foreground">{l.unidad && l.unidad !== "Units" ? l.unidad : "u."}</span>
                          {Number(l.demandada) !== Number(l.esperada) && <span className="block text-[11px] text-amber-700 dark:text-amber-300">pidió {fmtCantidad(l.demandada)}</span>}
                        </span>
                      </div>
                      {l.lotes.length > 0 && (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {l.lotes.map((x) => `Lote ${x.lote ?? "—"} (${fmtCantidad(x.cantidad)}${x.vence ? `, vence ${new Date(`${x.vence}T12:00:00Z`).toLocaleDateString("es-VE", { month: "2-digit", year: "numeric", timeZone: "UTC" })}` : ""})`).join(" · ")}
                        </p>
                      )}
                      {cierre && Number(cierre.entregada) !== Number(cierre.esperada) && (
                        <p className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-300">Entregado {fmtCantidad(cierre.entregada)} · {etiquetaMotivo(cierre.motivo, MOTIVOS_LINEA)}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {abiertaGuds && (
          <div className="mt-3 space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <Button asChild={tels.length > 0} variant="outline" className="h-11" disabled={!tels.length}>
                {tels.length ? <a href={`tel:${tels[0]}`}><Phone className="mr-1 h-4 w-4" />Llamar</a> : <span><Phone className="mr-1 h-4 w-4" />Llamar</span>}
              </Button>
              <Button asChild variant="outline" className="h-11">
                <a href={navegacion(e).maps} target="_blank" rel="noopener noreferrer"><MapPin className="mr-1 h-4 w-4" />Maps</a>
              </Button>
              <Button asChild variant="outline" className="h-11">
                <a href={navegacion(e).waze} target="_blank" rel="noopener noreferrer"><Navigation className="mr-1 h-4 w-4" />Waze</a>
              </Button>
            </div>
            {e.estado === "asignada" && onSalir && (
              <Button className="h-12 w-full bg-amber-500 text-base hover:bg-amber-600" onClick={() => onSalir(e)} disabled={ocupado}>
                {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Truck className="mr-2 h-5 w-5" />Salir a entregar</>}
              </Button>
            )}
            {e.estado === "en_camino" && onCerrar && (
              <Button className="h-12 w-full text-base" onClick={() => onCerrar(e)}>
                <ClipboardCheck className="mr-2 h-5 w-5" />Cerrar entrega
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
