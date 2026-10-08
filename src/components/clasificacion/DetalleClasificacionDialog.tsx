import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { CAMPOS_ODOO, ESTADOS, ORIGENES, fechaCorta, fechaHora, pistaError, usd, type FilaClasif } from "./comun";

const EMPAREJADO: Record<string, string> = { "nombre-exacto": "mismo nombre", "nombre-aprox": "nombre parecido", "via-profit": "vía Profit" };

function Bloque({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="rounded-md border border-border">
      <h3 className="border-b border-border bg-muted/30 px-2.5 py-1 text-[12px] font-semibold">{titulo}</h3>
      <div className="space-y-1 px-2.5 py-2 text-[13px]">{children}</div>
    </section>
  );
}
const Par = ({ k, v }: { k: string; v: ReactNode }) => (
  <div className="flex gap-2"><span className="w-32 shrink-0 text-[12px] text-muted-foreground">{k}</span><span className="min-w-0 break-words">{v ?? "—"}</span></div>
);

/** Detalle de la clasificación de un cliente: Odoo, GUDS, Excel de finanzas, Profit y el último envío (payload, cambios, nota). */
export function DetalleClasificacionDialog({ fila, onClose }: { fila: FilaClasif | null; onClose: () => void }) {
  const x = fila;
  const d = x?.envio_detalle;
  const pista = pistaError(x?.envio_error);
  return (
    <Dialog open={!!x} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {x && (
          <>
            <DialogHeader>
              <DialogTitle className="pr-6 text-base">
                <Link to={`/admin/clientes/${x.cliente_id}`} className="hover:underline">{x.nombre}</Link>
              </DialogTitle>
              <DialogDescription className="flex flex-wrap items-center gap-2">
                <span className={cn("rounded-md border px-1.5 py-0.5 text-[11px] font-medium", ESTADOS[x.estado].cls)}>{ESTADOS[x.estado].label}</span>
                <span>{ESTADOS[x.estado].ayuda}.</span>
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2 sm:grid-cols-2">
              <Bloque titulo="En Odoo (oficial)">
                <Par k="Tipo (Industria)" v={x.odoo_tipo} />
                <Par k="Canal" v={x.odoo_canal} />
                <Par k="Categoría (Segmento)" v={x.odoo_segmento} />
                <Par k="Contacto en Odoo" v={x.odoo_id ? `#${x.odoo_id}` : "sin vincular"} />
              </Bloque>
              <Bloque titulo="Asignado en GUDS">
                <Par k="Tipo de cliente" v={x.tipo ? <>{x.tipo}{x.tipo_por_confirmar && <span className="text-warning"> (por confirmar)</span>}</> : null} />
                <Par k="Canal" v={x.canal} />
                <Par k="Categoría de cobranza" v={x.categoria} />
                <Par k="Origen" v={x.origen ? `${ORIGENES[x.origen]}${x.estado_asignacion === "propuesta" ? " · propuesta sin revisar" : ""}` : null} />
                {x.revisado_at && <Par k="Revisado" v={`${x.revisado_por ?? "—"} · ${fechaHora(x.revisado_at)}`} />}
              </Bloque>
              <Bloque titulo="Excel de finanzas">
                {!x.excel_texto ? <p className="text-muted-foreground">El cliente no está en el Excel.</p> : (
                  <>
                    {x.excel_detalle?.conflicto && <p className="flex items-center gap-1 text-[12px] text-warning"><AlertTriangle className="h-3.5 w-3.5" />Dos filas con tipos distintos: no se propuso tipo.</p>}
                    {(x.excel_detalle?.filas ?? []).map((r, i) => (
                      <div key={i} className="border-b border-border/60 pb-1 last:border-0 last:pb-0">
                        <p className="truncate text-[12px] text-muted-foreground" title={r.cliente}>{r.cliente} · {EMPAREJADO[r.emparejado ?? ""] ?? r.emparejado}</p>
                        <p>{r.tipo ?? "—"}{r.categoria ? <span className="text-muted-foreground"> → {r.categoria}</span> : null}</p>
                        {r.cat_interna_ventas != null && r.cat_interna_ventas !== 0 && (
                          <p className="text-[11px] text-muted-foreground" title="Letra de tamaño de Quirutec: pendiente de decidir si es una dimensión aparte">Categoría interna de ventas: {String(r.cat_interna_ventas)} (pendiente)</p>
                        )}
                      </div>
                    ))}
                  </>
                )}
              </Bloque>
              <Bloque titulo="Profit (histórico)">
                <Par k="Tipo" v={x.profit_tipo} />
                <Par k="Segmento" v={x.profit_segmento} />
                <Par k="Sugerencia" v={x.profit_categoria ? `Categoría ${x.profit_categoria}` : x.profit_tipo ? "sin regla fiable" : null} />
                <Par k="Ventas Profit" v={x.ventas_profit_usd ? `${usd(x.ventas_profit_usd)} · última ${fechaCorta(x.ultima_profit)}` : null} />
                <Par k="Ventas Odoo / deuda" v={`${usd(x.ventas_odoo_usd)} / ${usd(x.deuda_usd)}`} />
              </Bloque>
            </div>
            <Bloque titulo={`Último envío a Odoo${x.enviado_at ? ` · ${fechaHora(x.enviado_at)}` : ""}`}>
              {!x.escritura_id ? <p className="text-muted-foreground">Todavía no se ha enviado.</p> : (
                <>
                  <Par k="Resultado" v={x.envio_estado === "simulada" ? "Simulado (modo prueba): no se escribió en Odoo"
                    : x.envio_estado === "hecha" ? (d?.sin_cambios ? "Odoo ya tenía estos valores" : "Escrito en Odoo")
                      : x.envio_estado === "error" || x.estado === "error" ? "Error" : "En la cola"} />
                  {x.envio_error && (
                    <p className="rounded bg-destructive/10 px-2 py-1 text-[12px] text-destructive">{x.envio_error}{pista && <span className="block text-foreground">{pista}</span>}</p>
                  )}
                  {d?.payload && Object.keys(d.payload).length > 0 && (
                    <div>
                      <p className="text-[12px] text-muted-foreground">Lo que se escribe en el contacto {d.partner ? `#${d.partner}` : ""} (res.partner):</p>
                      <table className="mt-1 w-full text-[12px]">
                        <tbody>{Object.entries(d.payload).map(([k, v]) => {
                          const cambio = d.cambios?.find((c) => c.campo === k);
                          return (
                            <tr key={k} className="border-t border-border/60">
                              <td className="py-0.5 pr-2 text-muted-foreground">{CAMPOS_ODOO[k] ?? k}</td>
                              <td className="py-0.5 pr-2 font-mono">{typeof v === "number" ? `id ${v}` : String(v)}</td>
                              <td className="py-0.5">{cambio ? `${cambio.antes ?? "—"} → ${cambio.despues ?? "—"}` : ""}</td>
                            </tr>
                          );
                        })}</tbody>
                      </table>
                      <p className="mt-1 text-[11px] text-muted-foreground">"(nuevo) …" = el valor no existe en Odoo y se crearía con ese nombre.</p>
                    </div>
                  )}
                  {d?.nota?.texto && <Par k={d.nota.simulada ? "Nota (simulada)" : "Nota en Odoo"} v={<span className="text-[12px]">{d.nota.texto}</span>} />}
                </>
              )}
            </Bloque>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
