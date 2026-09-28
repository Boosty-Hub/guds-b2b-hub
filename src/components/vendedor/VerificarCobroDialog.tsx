import { useEffect, useMemo, useState } from "react";
import { CheckCircle, ExternalLink, FileText, Loader2, XCircle, AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FichaCampos } from "@/components/datos/FichaCampos";
import { METODO_LABEL } from "@/hooks/useCuentasPago";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/hooks/use-toast";
import { esPdfComprobante, useUrlComprobante } from "./comprobantes";
import { fechaCorta } from "./tipos";

// Verificación (admin, Pagos) de un cobro reportado por un vendedor (migración 20o): la foto del comprobante, los datos de
// la operación (monto original, tasa BCV de la fecha del pago, cuenta o efectivo, referencia) y la propuesta de aplicación a
// facturas. Administración la aplica tal cual o la corrige; verificar_cobro_propuesta valida el permiso y aplica con las
// funciones existentes (verificar_pago → aplicar_pago_a_facturas). Rechazar usa verificar_pago con el motivo.

interface PagoDetalle {
  id: string; numero: string; cliente_id: string; monto: number; monto_moneda: number | null; moneda: string | null; tasa_cambio: number | null;
  metodo: string; referencia: string | null; comprobante_url: string | null; banco_id: string | null; fecha_pago: string | null; created_at: string;
  notas: string | null; propuesta_aplicacion: { factura_id: string; numero: string; monto: number }[] | null; propuesta_estado: string | null;
  lote_cobro: string | null; lote_linea: number | null; estado: string; empresa_id: string | null;
  cliente: { nombre_negocio: string } | null; cuenta: { nombre: string; moneda: string | null } | null;
  registrado: { nombre: string; apellido: string | null } | null;
}
interface FacturaAbierta { id: string; numero: string; fecha_vencimiento: string | null; fecha_emision: string | null; saldo_usd: number }

const r2 = (n: number) => Math.round(n * 100) / 100;

export function VerificarCobroDialog({ pagoId, onCerrar, onHecho }: { pagoId: string | null; onCerrar: () => void; onHecho: () => void }) {
  const { formatPrice } = useCurrency();
  const { toast } = useToast();
  const [pago, setPago] = useState<PagoDetalle | null>(null);
  const [lote, setLote] = useState<{ id: string; numero: string; monto: number; estado: string }[]>([]);
  const [facturas, setFacturas] = useState<FacturaAbierta[]>([]);
  const [cajas, setCajas] = useState<{ id: string; nombre: string; moneda: string | null }[]>([]);
  const [cargando, setCargando] = useState(false);
  const [modo, setModo] = useState<"propuesta" | "corregir" | "sin_aplicar">("propuesta");
  const [asig, setAsig] = useState<Record<string, string>>({});
  const [banco, setBanco] = useState("");
  const [notas, setNotas] = useState("");
  const [rechazar, setRechazar] = useState(false);
  const [procesando, setProcesando] = useState(false);
  const vista = useUrlComprobante(pago?.comprobante_url ?? null);

  useEffect(() => {
    if (!pagoId) { setPago(null); return; }
    let vivo = true;
    setCargando(true); setRechazar(false); setNotas(""); setBanco("");
    (async () => {
      const { data } = await supabase.from("pagos")
        .select(`id, numero, cliente_id, monto, monto_moneda, moneda, tasa_cambio, metodo, referencia, comprobante_url, banco_id, fecha_pago, created_at, notas,
          propuesta_aplicacion, propuesta_estado, lote_cobro, lote_linea, estado, empresa_id,
          cliente:clientes(nombre_negocio), cuenta:bancos(nombre, moneda), registrado:usuarios!pagos_registrado_por_fkey(nombre, apellido)`)
        .eq("id", pagoId).maybeSingle();
      const p = data as unknown as PagoDetalle | null;
      if (!vivo) return;
      setPago(p);
      if (!p) { setCargando(false); return; }
      const [f, l, b] = await Promise.all([
        supabase.from("facturas").select("id, numero, fecha_vencimiento, fecha_emision, saldo_usd, estado_pago")
          .eq("cliente_id", p.cliente_id).eq("estado", "posted").eq("tipo", "factura").gt("saldo_usd", 0.009),
        p.lote_cobro ? supabase.from("pagos").select("id, numero, monto, estado").eq("lote_cobro", p.lote_cobro).order("lote_linea") : Promise.resolve({ data: [] }),
        p.banco_id ? Promise.resolve({ data: [] }) : supabase.from("bancos").select("id, nombre, moneda, empresa_id").eq("activo", true).order("nombre"),
      ]);
      if (!vivo) return;
      const abiertas = ((f.data ?? []) as (FacturaAbierta & { estado_pago: string | null })[]).filter((x) => x.estado_pago !== "anulado")
        .map((x) => ({ ...x, saldo_usd: Number(x.saldo_usd) }))
        .sort((a, b) => (a.fecha_vencimiento || a.fecha_emision || "").localeCompare(b.fecha_vencimiento || b.fecha_emision || ""));
      setFacturas(abiertas);
      setLote(((l.data ?? []) as { id: string; numero: string; monto: number; estado: string }[]));
      setCajas(((b.data ?? []) as { id: string; nombre: string; moneda: string | null; empresa_id: string | null }[])
        .filter((x) => !x.empresa_id || !p.empresa_id || x.empresa_id === p.empresa_id));
      const prop = p.propuesta_aplicacion ?? [];
      setModo(prop.length ? "propuesta" : "sin_aplicar");
      setAsig(Object.fromEntries(prop.map((x) => [x.factura_id, Number(x.monto).toFixed(2)])));
      setCargando(false);
    })();
    return () => { vivo = false; };
  }, [pagoId]);

  const saldoDe = useMemo(() => new Map(facturas.map((f) => [f.id, f.saldo_usd])), [facturas]);
  const propuesta = pago?.propuesta_aplicacion ?? [];
  const propuestaInvalida = propuesta.filter((x) => Number(x.monto) > (saldoDe.get(x.factura_id) ?? 0) + 0.01);
  const asignado = r2(Object.values(asig).reduce((s, v) => s + (Number(v) || 0), 0));
  const monto = Number(pago?.monto || 0);
  const excede = modo === "corregir" && asignado > monto + 0.01;
  const facturaExcedida = modo === "corregir" ? facturas.find((f) => (Number(asig[f.id]) || 0) > f.saldo_usd + 0.01) : undefined;

  const verificar = async () => {
    if (!pago) return;
    setProcesando(true);
    const p_asignaciones = modo === "propuesta" ? null
      : modo === "sin_aplicar" ? []
      : facturas.filter((f) => (Number(asig[f.id]) || 0) > 0).map((f) => ({ factura_id: f.id, monto: r2(Number(asig[f.id])) }));
    const { data, error } = await supabase.rpc("verificar_cobro_propuesta", {
      p_pago_id: pago.id, p_asignaciones, p_banco_id: banco || null, p_notas: notas.trim() || null,
    });
    setProcesando(false);
    if (error) { toast({ title: "No se pudo verificar", description: error.message, variant: "destructive" }); return; }
    const res = data as { aplicado: number; saldo_a_favor: number; propuesta_estado: string | null };
    toast({
      title: "Cobro verificado",
      description: `${pago.numero}: ${formatPrice(Number(res.aplicado || 0))} aplicado a facturas${Number(res.saldo_a_favor) > 0.009 ? ` · ${formatPrice(Number(res.saldo_a_favor))} a favor` : ""}`
        + (res.propuesta_estado === "corregida" ? " · aplicación corregida." : res.propuesta_estado === "aplicada" ? " · como propuso el vendedor." : "."),
    });
    onHecho();
  };

  const rechazarPago = async () => {
    if (!pago || !notas.trim()) return;
    setProcesando(true);
    const { error } = await supabase.rpc("verificar_pago", { p_pago_id: pago.id, p_aprobar: false, p_notas: notas.trim() });
    setProcesando(false);
    if (error) { toast({ title: "No se pudo rechazar", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Cobro rechazado", description: `${pago.numero}: se avisó al vendedor y al cliente.` });
    onHecho();
  };

  const esBs = pago?.moneda === "BS";
  const pdf = esPdfComprobante(pago?.comprobante_url);

  return (
    <Dialog open={!!pagoId} onOpenChange={(v) => { if (!v) onCerrar(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl" data-testid="verificar-cobro">
        <DialogHeader>
          <DialogTitle>Verificar cobro {pago?.numero ?? ""}</DialogTitle>
          <DialogDescription>
            {pago ? <>{pago.cliente?.nombre_negocio || "Cliente"} · reportado por {pago.registrado ? `${pago.registrado.nombre} ${pago.registrado.apellido || ""}`.trim() : "—"}</> : "Cargando…"}
          </DialogDescription>
        </DialogHeader>

        {cargando || !pago ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <div className="grid gap-4 md:grid-cols-[240px_minmax(0,1fr)]">
            {/* Comprobante */}
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Comprobante</p>
              {!pago.comprobante_url ? <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">Sin comprobante</p>
                : vista.error ? <p className="text-sm text-destructive">No se pudo abrir: {vista.error}</p>
                : !vista.url ? <div className="flex h-40 items-center justify-center rounded-md bg-muted"><Loader2 className="h-5 w-5 animate-spin" /></div>
                : pdf ? (
                  <a href={vista.url} target="_blank" rel="noopener noreferrer" className="flex h-40 flex-col items-center justify-center gap-2 rounded-md border border-border text-sm text-primary hover:bg-muted/40">
                    <FileText className="h-8 w-8" />Abrir PDF
                  </a>
                ) : (
                  <a href={vista.url} target="_blank" rel="noopener noreferrer" className="block" title="Abrir en tamaño completo">
                    <img src={vista.url} alt={`Comprobante de ${pago.numero}`} className="max-h-72 w-full rounded-md border border-border object-contain" data-testid="foto-comprobante" />
                  </a>
                )}
              {vista.url && <a href={vista.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline"><ExternalLink className="h-3 w-3" />Abrir en otra pestaña</a>}
            </div>

            <div className="min-w-0 space-y-4">
              <FichaCampos columnas={3} campos={[
                { label: "Monto (USD)", valor: <span className="text-base font-semibold">{formatPrice(monto)}</span> },
                { label: esBs ? "Monto en Bs." : "Moneda", valor: esBs ? `Bs. ${Number(pago.monto_moneda || 0).toLocaleString("es-VE", { minimumFractionDigits: 2 })}` : pago.moneda || "USD" },
                { label: "Tasa BCV", valor: esBs && pago.tasa_cambio ? `${Number(pago.tasa_cambio).toLocaleString("es-VE", { maximumFractionDigits: 4 })} (del ${fechaCorta(pago.fecha_pago)})` : null },
                { label: "Método", valor: METODO_LABEL[pago.metodo] || pago.metodo },
                { label: "Cuenta", valor: pago.cuenta?.nombre || (pago.metodo === "efectivo" ? "Efectivo (lo recibió el vendedor)" : null) },
                { label: "Referencia", valor: pago.referencia, mono: true },
                { label: "Fecha del pago", valor: fechaCorta(pago.fecha_pago || pago.created_at) },
                { label: "Reportado", valor: fechaCorta(pago.created_at) },
                ...(pago.notas ? [{ label: "Notas del vendedor", valor: pago.notas, ancho: 3 as const }] : []),
              ]} />
              {lote.length > 1 && (
                <p className="text-xs text-muted-foreground" data-testid="lote-cobro">
                  Cobro con {lote.length} líneas: {lote.map((x) => `${x.numero} (${formatPrice(Number(x.monto))}${x.id === pago.id ? ", este" : ""}${x.estado !== "pendiente" ? `, ${x.estado}` : ""})`).join(" · ")}. Cada línea se verifica por separado.
                </p>
              )}

              {!pago.banco_id && (
                <div className="space-y-1">
                  <Label className="text-xs">Cuenta o caja donde ingresa <span className="font-normal text-muted-foreground">· opcional</span></Label>
                  <Select value={banco} onValueChange={setBanco}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Sin movimiento bancario" /></SelectTrigger>
                    <SelectContent>{cajas.map((c) => <SelectItem key={c.id} value={c.id}>{c.nombre}{c.moneda ? ` · ${c.moneda === "BS" ? "Bs." : c.moneda}` : ""}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}

              {/* Aplicación a facturas */}
              {!rechazar && (
                <div className="space-y-2" data-testid="aplicacion-cobro">
                  <p className="text-[13px] font-semibold">Aplicación a facturas</p>
                  <div className="flex flex-wrap gap-1.5">
                    {propuesta.length > 0 && (
                      <Button type="button" size="sm" variant={modo === "propuesta" ? "default" : "outline"} className="h-8" onClick={() => setModo("propuesta")} data-testid="modo-propuesta">
                        Aplicar la propuesta
                      </Button>
                    )}
                    <Button type="button" size="sm" variant={modo === "corregir" ? "default" : "outline"} className="h-8" onClick={() => setModo("corregir")} data-testid="modo-corregir">
                      {propuesta.length ? "Corregir" : "Asignar a facturas"}
                    </Button>
                    <Button type="button" size="sm" variant={modo === "sin_aplicar" ? "default" : "outline"} className="h-8" onClick={() => setModo("sin_aplicar")}>
                      Dejar a favor
                    </Button>
                  </div>

                  {modo === "propuesta" && (
                    <div className="rounded-md border border-border" data-testid="propuesta-vendedor">
                      <ul className="divide-y divide-border text-[13px]">
                        {propuesta.map((x) => {
                          const saldo = saldoDe.get(x.factura_id);
                          const mal = Number(x.monto) > (saldo ?? 0) + 0.01;
                          return (
                            <li key={x.factura_id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                              <span>Factura {x.numero}<span className={cn("ml-1.5 text-xs", mal ? "text-destructive" : "text-muted-foreground")}>saldo hoy {saldo != null ? formatPrice(saldo) : "—"}</span></span>
                              <span className="font-semibold tabular-nums">{formatPrice(Number(x.monto))}</span>
                            </li>
                          );
                        })}
                      </ul>
                      <div className="flex justify-between border-t border-border px-3 py-1.5 text-xs">
                        <span className="text-muted-foreground">Queda a favor</span>
                        <span className="tabular-nums">{formatPrice(Math.max(0, r2(monto - propuesta.reduce((s, x) => s + Number(x.monto), 0))))}</span>
                      </div>
                      {propuestaInvalida.length > 0 && (
                        <p className="flex items-start gap-1.5 border-t border-border px-3 py-1.5 text-xs text-destructive">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />La propuesta supera el saldo actual de {propuestaInvalida.map((x) => x.numero).join(", ")}: corrígela.
                        </p>
                      )}
                    </div>
                  )}

                  {modo === "corregir" && (
                    <div className="rounded-md border border-border">
                      {facturas.length === 0 ? <p className="px-3 py-3 text-sm text-muted-foreground">El cliente no tiene facturas con saldo.</p> : (
                        <ul className="max-h-64 divide-y divide-border overflow-y-auto text-[13px]">
                          {facturas.map((f) => (
                            <li key={f.id} className="flex items-center gap-2 px-3 py-1.5">
                              <span className="min-w-0 flex-1">Factura {f.numero}<span className="ml-1.5 text-xs text-muted-foreground">vence {fechaCorta(f.fecha_vencimiento)} · saldo {formatPrice(f.saldo_usd)}</span></span>
                              <Input type="text" inputMode="decimal" value={asig[f.id] ?? ""} placeholder="0.00" aria-label={`Monto para ${f.numero}`}
                                className={cn("h-8 w-24 text-right tabular-nums", (Number(asig[f.id]) || 0) > f.saldo_usd + 0.01 && "border-destructive")}
                                onChange={(e) => setAsig((a) => ({ ...a, [f.id]: e.target.value.replace(/[^\d.]/g, "") }))} />
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="flex justify-between border-t border-border px-3 py-1.5 text-xs">
                        <span className="text-muted-foreground">Asignado {formatPrice(asignado)} de {formatPrice(monto)}</span>
                        <span className={cn("tabular-nums", excede && "text-destructive")}>{excede ? "Excede el monto" : `A favor ${formatPrice(Math.max(0, r2(monto - asignado)))}`}</span>
                      </div>
                      {facturaExcedida && <p className="border-t border-border px-3 py-1.5 text-xs text-destructive">La factura {facturaExcedida.numero} solo tiene saldo {formatPrice(facturaExcedida.saldo_usd)}.</p>}
                    </div>
                  )}
                  {modo === "sin_aplicar" && <p className="text-xs text-muted-foreground">El pago queda como saldo a favor del cliente (se aplica luego desde Cuentas por cobrar).</p>}
                </div>
              )}

              <div className="space-y-1">
                <Label className="text-xs">{rechazar ? "Motivo del rechazo (lo verán el vendedor y el cliente)" : "Notas (opcional)"}</Label>
                <Textarea rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} data-testid="notas-verificacion" />
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {rechazar ? (
            <>
              <Button variant="outline" onClick={() => setRechazar(false)} disabled={procesando}>Volver</Button>
              <Button variant="destructive" onClick={rechazarPago} disabled={procesando || !notas.trim()} data-testid="confirmar-rechazo">
                {procesando ? <Loader2 className="h-4 w-4 animate-spin" /> : <><XCircle className="mr-1.5 h-4 w-4" />Rechazar cobro</>}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setRechazar(true)} disabled={procesando || !pago} className="text-destructive" data-testid="rechazar-cobro">Rechazar…</Button>
              <Button onClick={verificar} data-testid="confirmar-verificacion"
                disabled={procesando || !pago || pago.estado !== "pendiente" || excede || !!facturaExcedida || (modo === "propuesta" && propuestaInvalida.length > 0)}>
                {procesando ? <Loader2 className="h-4 w-4 animate-spin" /> : <><CheckCircle className="mr-1.5 h-4 w-4" />{modo === "propuesta" ? "Verificar y aplicar propuesta" : "Verificar"}</>}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
