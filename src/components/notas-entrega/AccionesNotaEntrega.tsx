import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { fmtUsd } from "@/components/estado-cuenta/formato";
import { fechaDMA, hoyCaracas } from "@/lib/fechas";
import { cn } from "@/lib/utils";
import { MOVIMIENTO_NOTA, type CobroParaNota, type FacturaParaNota, type MovimientoNota, type NotaEntrega } from "./tipos";

// Acciones sobre una nota de entrega (22j · NE2–NE3). Todas por RPC y con la empresa activa (en «Ambas» solo se consulta):
//  · Abonar: se enlaza al cobro de Odoo por el que entró el dinero (deja de ser saldo a favor del cliente). Sin cobro de
//    Odoo solo si el dinero no pasó por Odoo (clientes sin ficha): exige referencia.
//  · Pasar a factura: con la factura de Odoo y el monto sugerido (lo que Odoo facturó de sus líneas). Lo abonado de más
//    vuelve a ser anticipo para aplicarlo en Odoo a la factura.
//  · Descuento, devolución o ajuste, con motivo.
//  · Anular (sin movimientos de GUDS) y quitar un movimiento: van a la Papelera (Administrador).

const num = (s: string) => Number(String(s).replace(",", "."));
const AVISO_AMBAS = "Estás viendo «Ambas empresas» (solo consulta): elige GUDS o Quirutec en el menú superior.";

function Aviso({ visible }: { visible: boolean }) {
  return visible ? (
    <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">{AVISO_AMBAS}</p>
  ) : null;
}

interface Base { nota: NotaEntrega; open: boolean; onOpenChange: (o: boolean) => void; onHecho: () => void; soloLectura: boolean }

export function AbonarNotaDialog({ nota, open, onOpenChange, onHecho, soloLectura }: Base) {
  const { toast } = useToast();
  const [cobros, setCobros] = useState<CobroParaNota[] | null>(null);
  const [pago, setPago] = useState<string>("");
  const [monto, setMonto] = useState("");
  const [ref, setRef] = useState("");
  const [fecha, setFecha] = useState(hoyCaracas());
  const [texto, setTexto] = useState("");
  const [guardando, setGuardando] = useState(false);
  const saldo = Number(nota.saldo_usd);

  useEffect(() => {
    if (!open) return;
    setCobros(null); setPago(""); setRef(""); setTexto(""); setFecha(hoyCaracas()); setMonto(saldo.toFixed(2));
    supabase.rpc("cobros_para_nota_entrega", { p_nota: nota.id }).then(({ data, error }) => {
      const lista = (data as CobroParaNota[]) ?? [];
      setCobros(lista);
      if (error) toast({ title: "No se pudieron cargar los cobros", description: error.message, variant: "destructive" });
      if (lista.length) { setPago(lista[0].pago_id); setMonto(Math.min(saldo, Number(lista[0].disponible)).toFixed(2)); } else setPago("manual");
    });
  }, [open, nota.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const cobro = cobros?.find((c) => c.pago_id === pago) ?? null;
  const m = num(monto);
  const tope = cobro ? Math.min(saldo, Number(cobro.disponible)) : saldo;
  const ok = Number.isFinite(m) && m > 0.009 && m <= tope + 0.009 && (pago !== "manual" || ref.trim().length >= 3) && !soloLectura;

  const guardar = async () => {
    if (!ok) return;
    setGuardando(true);
    const { error } = await supabase.rpc("abonar_nota_entrega", {
      p_nota: nota.id, p_monto: Math.round(m * 100) / 100, p_pago: pago === "manual" ? null : pago,
      p_fecha: pago === "manual" ? fecha : null, p_referencia: pago === "manual" ? ref.trim() : null, p_nota_texto: texto.trim() || null,
    });
    setGuardando(false);
    if (error) { toast({ title: "No se pudo registrar el abono", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Abono registrado", description: cobro ? `Enlazado al cobro ${cobro.numero}: ya no cuenta como saldo a favor del cliente.` : "Registrado en GUDS con su referencia." });
    onOpenChange(false); onHecho();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!guardando) onOpenChange(o); }}>
      <DialogContent className="max-w-lg" data-testid="ne-abonar">
        <DialogHeader>
          <DialogTitle>Registrar abono · {nota.documento}</DialogTitle>
          <DialogDescription>Saldo {fmtUsd(saldo)}. El dinero entra por un banco de Odoo: elige el cobro de Odoo del cliente que lo paga.</DialogDescription>
        </DialogHeader>
        {cobros === null ? <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div> : (
          <RadioGroup value={pago} onValueChange={(v) => { setPago(v); const c = cobros.find((x) => x.pago_id === v); setMonto((c ? Math.min(saldo, Number(c.disponible)) : saldo).toFixed(2)); }}
            className="max-h-64 space-y-1 overflow-y-auto" data-testid="ne-abonar-cobros">
            {cobros.map((c) => (
              <label key={c.pago_id} className={cn("flex cursor-pointer items-start gap-2 rounded-md border border-border px-2.5 py-2 text-sm", pago === c.pago_id && "border-primary bg-primary/5")}>
                <RadioGroupItem value={c.pago_id} className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="flex justify-between gap-2"><span className="font-mono text-xs">{c.numero}</span><span className="font-semibold tabular-nums">{fmtUsd(c.disponible)}</span></span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {[fechaDMA(c.fecha), c.banco, c.referencia && `ref. ${c.referencia}`, `cobro ${fmtUsd(c.monto)}`].filter(Boolean).join(" · ")} · sin aplicar
                  </span>
                </span>
              </label>
            ))}
            {cobros.length === 0 && <p className="text-xs text-muted-foreground">{nota.cliente_id ? "El cliente no tiene cobros de Odoo sin aplicar." : "El cliente no tiene ficha en GUDS: no tiene cobros en Odoo."}</p>}
            <label className={cn("flex cursor-pointer items-start gap-2 rounded-md border border-dashed border-border px-2.5 py-2 text-sm", pago === "manual" && "border-primary bg-primary/5")}>
              <RadioGroupItem value="manual" className="mt-0.5" />
              <span className="text-xs text-muted-foreground">Sin cobro de Odoo: solo si el dinero <span className="font-medium text-foreground">no</span> entró por un banco de Odoo (queda en GUDS con su referencia).</span>
            </label>
          </RadioGroup>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="ne-abono-monto">Monto (USD)</Label>
            <Input id="ne-abono-monto" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} className="h-8 text-right tabular-nums" />
            <p className="text-[11px] text-muted-foreground">Hasta {fmtUsd(tope)}</p>
          </div>
          {pago === "manual" && (
            <div className="space-y-1">
              <Label htmlFor="ne-abono-fecha">Fecha</Label>
              <Input id="ne-abono-fecha" type="date" value={fecha} max={hoyCaracas()} onChange={(e) => setFecha(e.target.value)} className="h-8" />
            </div>
          )}
        </div>
        {pago === "manual" && (
          <div className="space-y-1">
            <Label htmlFor="ne-abono-ref">Referencia del pago *</Label>
            <Input id="ne-abono-ref" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Nº de transferencia, recibo…" className="h-8" />
          </div>
        )}
        <div className="space-y-1">
          <Label htmlFor="ne-abono-nota">Nota</Label>
          <Textarea id="ne-abono-nota" rows={2} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Opcional" />
        </div>
        <Aviso visible={soloLectura} />
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={guardando}>Cancelar</Button>
          <Button onClick={guardar} disabled={!ok || guardando} className="gap-2" data-testid="ne-abonar-confirmar">{guardando && <Loader2 className="h-4 w-4 animate-spin" />} Registrar abono</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ConvertirNotaDialog({ nota, open, onOpenChange, onHecho, soloLectura }: Base) {
  const { toast } = useToast();
  const [facturas, setFacturas] = useState<FacturaParaNota[] | null>(null);
  const [factura, setFactura] = useState("");
  const [monto, setMonto] = useState("");
  const [guardando, setGuardando] = useState(false);
  const sinFacturar = Number(nota.sin_facturar);

  useEffect(() => {
    if (!open) return;
    setFacturas(null); setFactura("");
    supabase.rpc("conversion_nota_entrega", { p_nota: nota.id }).then(({ data, error }) => {
      const lista = (data as FacturaParaNota[]) ?? [];
      setFacturas(lista);
      if (error) toast({ title: "No se pudieron cargar las facturas", description: error.message, variant: "destructive" });
      if (lista.length) { setFactura(lista[0].factura_id); setMonto(Number(lista[0].sugerido || sinFacturar).toFixed(2)); }
    });
  }, [open, nota.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const m = num(monto);
  const ok = !!factura && Number.isFinite(m) && m > 0.009 && m <= sinFacturar + 0.009 && !soloLectura;
  const guardar = async () => {
    if (!ok) return;
    setGuardando(true);
    const { data, error } = await supabase.rpc("convertir_nota_entrega", { p_nota: nota.id, p_factura: factura, p_monto: Math.round(m * 100) / 100 });
    setGuardando(false);
    if (error) { toast({ title: "No se pudo pasar a factura", description: error.message, variant: "destructive" }); return; }
    const r = data as { trasladado: number; estado: string };
    toast({ title: "Nota pasada a factura", description: Number(r.trasladado) > 0.009
      ? `Lo abonado de más (${fmtUsd(r.trasladado)}) vuelve a ser anticipo del cliente: aplícalo en Odoo a la factura.` : "La deuda de esa parte vive ahora en la factura fiscal." });
    onOpenChange(false); onHecho();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!guardando) onOpenChange(o); }}>
      <DialogContent className="max-w-lg" data-testid="ne-convertir">
        <DialogHeader>
          <DialogTitle>Pasar a factura · {nota.documento}</DialogTitle>
          <DialogDescription>Sin facturar {fmtUsd(sinFacturar)} (sin IVA). La factura se emite en Odoo; aquí se registra cuánto de la nota pasó a ella.</DialogDescription>
        </DialogHeader>
        {facturas === null ? <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
          : facturas.length === 0 ? <p className="text-sm text-muted-foreground">No hay facturas del cliente desde la emisión de la nota{nota.orden_id ? " ni de su pedido" : ""}. Emítela en Odoo y espera la sincronización.</p> : (
          <RadioGroup value={factura} onValueChange={(v) => { setFactura(v); const f = facturas.find((x) => x.factura_id === v); setMonto(Number(f?.sugerido || sinFacturar).toFixed(2)); }}
            className="max-h-64 space-y-1 overflow-y-auto" data-testid="ne-convertir-facturas">
            {facturas.map((f) => (
              <label key={f.factura_id} className={cn("flex cursor-pointer items-start gap-2 rounded-md border border-border px-2.5 py-2 text-sm", factura === f.factura_id && "border-primary bg-primary/5")}>
                <RadioGroupItem value={f.factura_id} className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span><span className="font-mono text-xs">FACT {f.numero}</span>{f.del_pedido && <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">Del pedido</Badge>}</span>
                    <span className="tabular-nums text-xs text-muted-foreground">base {fmtUsd(f.base)}</span>
                  </span>
                  <span className="block text-[11px] text-muted-foreground">{fechaDMA(f.fecha)}{Number(f.sugerido) > 0.009 ? ` · sugerido ${fmtUsd(f.sugerido)}` : ""}</span>
                </span>
              </label>
            ))}
          </RadioGroup>
        )}
        {!!facturas?.length && (
          <div className="space-y-1">
            <Label htmlFor="ne-conv-monto">Monto de la nota que pasa a la factura (USD, sin IVA)</Label>
            <Input id="ne-conv-monto" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} className="h-8 text-right tabular-nums" />
            <p className="text-[11px] text-muted-foreground">Hasta {fmtUsd(sinFacturar)}. Si ya estaba abonada, lo abonado de más vuelve a ser anticipo para aplicarlo en Odoo.</p>
          </div>
        )}
        <Aviso visible={soloLectura} />
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={guardando}>Cancelar</Button>
          <Button onClick={guardar} disabled={!ok || guardando} className="gap-2" data-testid="ne-convertir-confirmar">{guardando && <Loader2 className="h-4 w-4 animate-spin" />} Pasar a factura</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AjusteNotaDialog({ nota, open, onOpenChange, onHecho, soloLectura }: Base) {
  const { toast } = useToast();
  const [tipo, setTipo] = useState<"descuento" | "devolucion" | "ajuste">("descuento");
  const [monto, setMonto] = useState("");
  const [motivo, setMotivo] = useState("");
  const [fecha, setFecha] = useState(hoyCaracas());
  const [guardando, setGuardando] = useState(false);
  useEffect(() => { if (open) { setTipo("descuento"); setMonto(""); setMotivo(""); setFecha(hoyCaracas()); } }, [open]);
  const tope = tipo === "ajuste" ? Number(nota.saldo_usd) : Number(nota.sin_facturar);
  const m = num(monto);
  const ok = Number.isFinite(m) && m > 0.009 && m <= tope + 0.009 && motivo.trim().length >= 5 && !soloLectura;
  const guardar = async () => {
    if (!ok) return;
    setGuardando(true);
    const { error } = await supabase.rpc("ajustar_nota_entrega", { p_nota: nota.id, p_tipo: tipo, p_monto: Math.round(m * 100) / 100, p_motivo: motivo.trim(), p_fecha: fecha });
    setGuardando(false);
    if (error) { toast({ title: "No se pudo registrar", description: error.message, variant: "destructive" }); return; }
    toast({ title: `${MOVIMIENTO_NOTA[tipo]} registrado` });
    onOpenChange(false); onHecho();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!guardando) onOpenChange(o); }}>
      <DialogContent className="max-w-md" data-testid="ne-ajuste">
        <DialogHeader>
          <DialogTitle>Descuento, devolución o ajuste · {nota.documento}</DialogTitle>
          <DialogDescription>La devolución y el descuento bajan lo vendido (y la venta); el ajuste solo corrige el saldo.</DialogDescription>
        </DialogHeader>
        <RadioGroup value={tipo} onValueChange={(v) => setTipo(v as typeof tipo)} className="flex flex-wrap gap-3">
          {(["descuento", "devolucion", "ajuste"] as const).map((t) => (
            <label key={t} className="flex items-center gap-1.5 text-sm"><RadioGroupItem value={t} /> {MOVIMIENTO_NOTA[t]}</label>
          ))}
        </RadioGroup>
        {tipo === "devolucion" && <p className="text-[11px] text-muted-foreground">La mercancía devuelta entra al inventario con su albarán de devolución en Odoo.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="ne-aj-monto">Monto (USD)</Label>
            <Input id="ne-aj-monto" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} className="h-8 text-right tabular-nums" />
            <p className="text-[11px] text-muted-foreground">Hasta {fmtUsd(tope)}</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ne-aj-fecha">Fecha</Label>
            <Input id="ne-aj-fecha" type="date" value={fecha} max={hoyCaracas()} onChange={(e) => setFecha(e.target.value)} className="h-8" />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="ne-aj-motivo">Motivo *</Label>
          <Textarea id="ne-aj-motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </div>
        <Aviso visible={soloLectura} />
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={guardando}>Cancelar</Button>
          <Button onClick={guardar} disabled={!ok || guardando} className="gap-2">{guardando && <Loader2 className="h-4 w-4 animate-spin" />} Registrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Anular la nota o quitar uno de sus movimientos: motivo obligatorio, a la Papelera. */
export function PapeleraNotaDialog({ nota, movimiento, open, onOpenChange, onHecho, soloLectura }: Base & { movimiento?: MovimientoNota | null }) {
  const { toast } = useToast();
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  useEffect(() => { if (open) setMotivo(""); }, [open]);
  const ok = motivo.trim().length >= 5 && !soloLectura;
  const guardar = async () => {
    if (!ok) return;
    setGuardando(true);
    const { error } = movimiento
      ? await supabase.rpc("quitar_movimiento_nota_entrega", { p_movimiento: movimiento.id, p_motivo: motivo.trim() })
      : await supabase.rpc("anular_nota_entrega", { p_nota: nota.id, p_motivo: motivo.trim() });
    setGuardando(false);
    if (error) { toast({ title: movimiento ? "No se pudo quitar el movimiento" : "No se pudo anular la nota", description: error.message, variant: "destructive" }); return; }
    toast({ title: movimiento ? "Movimiento quitado" : `Nota ${nota.documento} anulada`, description: "Quedó en la Papelera, desde donde se puede restaurar." });
    onOpenChange(false); onHecho();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!guardando) onOpenChange(o); }}>
      <DialogContent className="max-w-md" data-testid="ne-papelera">
        <DialogHeader>
          <DialogTitle>{movimiento ? `Quitar ${MOVIMIENTO_NOTA[movimiento.tipo].toLowerCase()} de ${fmtUsd(movimiento.monto_usd)}` : `Anular la nota ${nota.documento}`}</DialogTitle>
          <DialogDescription>
            {movimiento ? "La nota recupera ese monto en su saldo." : "Sale de la deuda y de la venta; lo de su pedido vuelve a quedar pendiente."} Queda en la Papelera, desde donde un administrador la puede restaurar.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="ne-pap-motivo">Motivo *</Label>
          <Textarea id="ne-pap-motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: emitida por error, monto equivocado…" />
        </div>
        <Aviso visible={soloLectura} />
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={guardando}>Cancelar</Button>
          <Button variant="destructive" onClick={guardar} disabled={!ok || guardando} className="gap-2">{guardando && <Loader2 className="h-4 w-4 animate-spin" />} {movimiento ? "Quitar" : "Anular nota"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
