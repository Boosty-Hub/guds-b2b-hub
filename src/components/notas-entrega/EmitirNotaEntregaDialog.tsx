import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2, PackageCheck, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/lib/supabase";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { useToast } from "@/hooks/use-toast";
import { fmtUsd } from "@/components/estado-cuenta/formato";
import { fechaDMA, hoyCaracas, sumarDias } from "@/lib/fechas";
import { cn } from "@/lib/utils";
import type { PedidoParaNota } from "./tipos";

// Emitir una nota de entrega (22j · NE2): nace de un pedido de Odoo con su albarán validado y aún sin factura (la mercancía
// ya salió del inventario de Odoo). Se elige el pedido, las líneas y cuánto de cada una (por defecto todo lo entregado sin
// facturar), la fecha (la del despacho) y el vencimiento (según los días de crédito del cliente). Sin IVA. GUDS no escribe
// nada en Odoo: la nota queda en GUDS con el correlativo NE de la empresa.

const n = (v: unknown) => Number(v ?? 0);
const cant = (v: number) => v.toLocaleString("es-VE", { maximumFractionDigits: 3 });

export function EmitirNotaEntregaDialog({ open, onOpenChange, clienteId, onEmitida }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Solo los pedidos de este cliente (desde el detalle de la cuenta) */
  clienteId?: string | null;
  onEmitida?: (id: string) => void;
}) {
  const { empresaActiva, soloLectura } = useEmpresa();
  const { toast } = useToast();
  const [pedidos, setPedidos] = useState<PedidoParaNota[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<PedidoParaNota | null>(null);
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [fecha, setFecha] = useState("");
  const [vence, setVence] = useState("");
  const [obs, setObs] = useState("");
  const [guardando, setGuardando] = useState(false);
  const hoy = hoyCaracas();

  useEffect(() => {
    if (!open) return;
    setSel(null); setQ(""); setError(null); setPedidos(null);
    supabase.rpc("pedidos_para_nota_entrega", { p_cliente: clienteId ?? null }).then(({ data, error: e }) => {
      if (e) setError(e.message);
      setPedidos((data as PedidoParaNota[]) ?? []);
    });
  }, [open, clienteId, empresaActiva?.id]);

  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (pedidos ?? []).filter((p) => !t || `${p.numero} ${p.cliente ?? ""} ${p.rif ?? ""} ${p.vendedor ?? ""}`.toLowerCase().includes(t));
  }, [pedidos, q]);

  const elegir = (p: PedidoParaNota) => {
    setSel(p);
    setCantidades(Object.fromEntries(p.lineas.map((l) => [l.orden_item_id, String(n(l.pendiente))])));
    setMarcadas(new Set(p.lineas.map((l) => l.orden_item_id)));
    const f = p.despacho && p.despacho <= hoy ? p.despacho : hoy;
    setFecha(f);
    setVence(sumarDias(f, n(p.dias_credito)));
    setObs("");
  };

  const lineas = useMemo(() => (sel?.lineas ?? []).map((l) => {
    const c = Number((cantidades[l.orden_item_id] ?? "").replace(",", "."));
    const activa = marcadas.has(l.orden_item_id);
    const valida = Number.isFinite(c) && c > 0 && c <= n(l.pendiente) + 0.0005;
    return { ...l, c, activa, valida, sub: activa && valida ? Math.round(c * n(l.precio) * 100) / 100 : 0 };
  }), [sel, cantidades, marcadas]);
  const total = lineas.reduce((s, l) => s + l.sub, 0);
  const malas = lineas.filter((l) => l.activa && !l.valida).length;
  const elegidas = lineas.filter((l) => l.activa).length;
  const fechaOk = !!fecha && fecha <= hoy && !!vence && vence >= fecha;
  const puedeEmitir = !!sel && elegidas > 0 && malas === 0 && total > 0.009 && fechaOk && !soloLectura && sel.empresa_id === empresaActiva?.id;

  const emitir = async () => {
    if (!sel || !puedeEmitir) return;
    setGuardando(true);
    const todas = lineas.every((l) => l.activa && Math.abs(l.c - n(l.pendiente)) < 0.0005);
    const { data, error: e } = await supabase.rpc("emitir_nota_entrega", {
      p_orden: sel.orden_id,
      p_items: todas ? null : lineas.filter((l) => l.activa).map((l) => ({ orden_item_id: l.orden_item_id, cantidad: l.c })),
      p_fecha: fecha, p_vence: vence, p_observacion: obs.trim() || null,
    });
    setGuardando(false);
    if (e) { toast({ title: "No se pudo emitir la nota de entrega", description: e.message, variant: "destructive" }); return; }
    toast({ title: "Nota de entrega emitida", description: `Del pedido ${sel.numero} por ${fmtUsd(total)} (sin IVA).` });
    onOpenChange(false);
    onEmitida?.(data as string);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!guardando) onOpenChange(o); }}>
      <DialogContent className="flex max-h-[92vh] max-w-3xl flex-col gap-3 overflow-hidden p-4 sm:p-6" data-testid="ne-emitir">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><PackageCheck className="h-4 w-4" /> Emitir nota de entrega</DialogTitle>
          <DialogDescription>
            Nace de un pedido de Odoo con el albarán validado y aún sin factura: la mercancía ya salió de Odoo. Documento no fiscal, sin IVA.
          </DialogDescription>
        </DialogHeader>

        {soloLectura && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
            Estás viendo «Ambas empresas» (solo consulta): elige GUDS o Quirutec en el menú superior para emitir.
          </p>
        )}

        {!sel ? (
          <>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por pedido, cliente o vendedor..." className="h-8 pl-8 text-sm"
                aria-label="Buscar pedido" data-testid="ne-emitir-buscar" />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border">
              {pedidos === null ? (
                <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
              ) : error ? (
                <p className="p-4 text-sm text-destructive">{error}</p>
              ) : visibles.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground" data-testid="ne-emitir-vacio">
                  {pedidos.length ? "Ningún pedido coincide con la búsqueda." : "No hay pedidos de Odoo entregados sin facturar."}
                </p>
              ) : (
                <ul className="divide-y divide-border" data-testid="ne-emitir-pedidos">
                  {visibles.map((p) => {
                    const otra = !soloLectura && p.empresa_id !== empresaActiva?.id;
                    return (
                      <li key={p.orden_id}>
                        <button type="button" onClick={() => elegir(p)} disabled={otra}
                          className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left hover:bg-muted/50 disabled:opacity-50" data-testid="ne-emitir-pedido">
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-center gap-1.5 text-sm">
                              <span className="font-mono text-xs font-medium text-primary">{p.numero}</span>
                              <span className="truncate font-medium">{p.cliente ?? "Sin cliente"}</span>
                              {p.con_ne && <Badge variant="outline" className="h-4 px-1 text-[10px]">Ya tiene N/E</Badge>}
                            </span>
                            <span className="block truncate text-[11px] text-muted-foreground">
                              {[p.despacho ? `despachado ${fechaDMA(p.despacho)}` : null, `${p.lineas.length} ${p.lineas.length === 1 ? "línea" : "líneas"}`, p.vendedor].filter(Boolean).join(" · ")}
                            </span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="block text-sm font-semibold tabular-nums">{fmtUsd(p.pendiente_usd)}</span>
                            <span className="block text-[11px] text-muted-foreground">sin facturar</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {pedidos?.length ? `${pedidos.length} ${pedidos.length === 1 ? "pedido" : "pedidos"} con mercancía entregada y sin facturar. ` : ""}
              Si un pedido no aparece: su albarán no está validado en Odoo, ya está facturado o ya está en otra nota de entrega.
            </p>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => setSel(null)} disabled={guardando}>
                <ArrowLeft className="h-3.5 w-3.5" /> Otro pedido
              </Button>
              <p className="min-w-0 text-sm"><span className="font-mono text-xs text-primary">{sel.numero}</span> · <span className="font-medium">{sel.cliente}</span></p>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
              <ul className="divide-y divide-border rounded-md border border-border" data-testid="ne-emitir-lineas">
                {lineas.map((l) => (
                  <li key={l.orden_item_id} className={cn("grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 px-3 py-2 sm:grid-cols-[auto_1fr_7rem_6rem]", !l.activa && "opacity-60")}>
                    <Checkbox checked={l.activa} className="mt-0.5" aria-label={`Incluir ${l.descripcion}`}
                      onCheckedChange={(v) => setMarcadas((s) => { const x = new Set(s); if (v) x.add(l.orden_item_id); else x.delete(l.orden_item_id); return x; })} />
                    <div className="min-w-0">
                      <p className="truncate text-sm" title={l.descripcion}>{l.descripcion}</p>
                      <p className="text-[11px] text-muted-foreground">
                        Entregado {cant(n(l.entregada))} · facturado {cant(n(l.facturada))}{n(l.en_ne) > 0 ? ` · en otras N/E ${cant(n(l.en_ne))}` : ""} · {fmtUsd(n(l.precio))} c/u
                      </p>
                    </div>
                    <div className="col-start-2 sm:col-start-auto">
                      <Input value={cantidades[l.orden_item_id] ?? ""} inputMode="decimal" disabled={!l.activa}
                        onChange={(e) => setCantidades((c) => ({ ...c, [l.orden_item_id]: e.target.value }))}
                        className={cn("h-7 text-right text-sm tabular-nums", l.activa && !l.valida && "border-destructive")}
                        aria-label={`Cantidad de ${l.descripcion} (máximo ${cant(n(l.pendiente))})`} />
                      <p className="mt-0.5 text-right text-[10px] text-muted-foreground">de {cant(n(l.pendiente))}</p>
                    </div>
                    <p className="col-start-2 text-right text-sm font-medium tabular-nums sm:col-start-auto sm:pt-1">{fmtUsd(l.sub)}</p>
                  </li>
                ))}
              </ul>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="ne-fecha">Emisión</Label>
                  <Input id="ne-fecha" type="date" value={fecha} max={hoy} onChange={(e) => { setFecha(e.target.value); if (e.target.value) setVence(sumarDias(e.target.value, n(sel.dias_credito))); }} className="h-8" />
                  <p className="text-[11px] text-muted-foreground">{sel.despacho ? `El albarán se validó el ${fechaDMA(sel.despacho)}.` : "Sin fecha de despacho en Odoo."}</p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ne-vence">Vencimiento</Label>
                  <Input id="ne-vence" type="date" value={vence} min={fecha} onChange={(e) => setVence(e.target.value)} className="h-8" />
                  <p className="text-[11px] text-muted-foreground">{n(sel.dias_credito) > 0 ? `${sel.dias_credito} días de crédito del cliente.` : "El cliente es de contado."}</p>
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="ne-obs">Observación</Label>
                <Textarea id="ne-obs" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Opcional: condiciones, quién recibió, número del talonario…" />
              </div>
            </div>
            <DialogFooter className="flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm">Total <span className="font-semibold tabular-nums" data-testid="ne-emitir-total">{fmtUsd(total)}</span> <span className="text-xs text-muted-foreground">sin IVA · {elegidas} de {lineas.length} líneas</span></p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)} disabled={guardando}>Cancelar</Button>
                <Button onClick={emitir} disabled={!puedeEmitir || guardando} className="gap-2" data-testid="ne-emitir-confirmar">
                  {guardando && <Loader2 className="h-4 w-4 animate-spin" />} Emitir nota de entrega
                </Button>
              </div>
            </DialogFooter>
            {malas > 0 && <p className="text-xs text-destructive">Revisa las cantidades: deben ser mayores que cero y no pasar de lo entregado sin facturar.</p>}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
