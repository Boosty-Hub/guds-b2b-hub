import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useCurrency } from "@/contexts/CurrencyContext";
import { type BancoSaldo, type FacturaPlan, cargarBancos, disponiblePorMoneda, fmtBs, fmtFecha, fmtUsd, mensajeError } from "./comun";
import { CoberturaMonedas } from "./CoberturaMonedas";

interface Props {
  abierto: boolean;
  onCerrar: () => void;
  corte: string;
  empresaId: string;
  /** Plan en borrador al que agregar (desde "Agregar facturas" en el plan). */
  planInicial?: string | null;
  items: { factura: FacturaPlan; monto: number }[];
  onCreado: (planId: string) => void;
}

export function DialogoCrearPlan({ abierto, onCerrar, corte, empresaId, planInicial, items, onCreado }: Props) {
  const { toast } = useToast();
  const { exchangeRate } = useCurrency();
  const [borradores, setBorradores] = useState<{ id: string; numero: string; fecha_pago: string }[]>([]);
  const [destino, setDestino] = useState<string>(planInicial ?? "nuevo");
  const [fechaPago, setFechaPago] = useState(corte);
  const [moneda, setMoneda] = useState<"USD" | "BS">("USD");
  const [notas, setNotas] = useState("");
  const [bancos, setBancos] = useState<BancoSaldo[]>([]);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data }, b] = await Promise.all([
        supabase.from("planes_pago").select("id, numero, fecha_pago").eq("empresa_id", empresaId).eq("estado", "borrador").order("created_at", { ascending: false }),
        cargarBancos(),
      ]);
      const lista = (data ?? []) as { id: string; numero: string; fecha_pago: string }[];
      setBorradores(lista);
      if (planInicial && !lista.some((p) => p.id === planInicial)) setDestino("nuevo");
      setBancos(b);
    })();
  }, [empresaId, planInicial]);

  const total = items.reduce((s, i) => s + i.monto, 0);
  const disp = disponiblePorMoneda(bancos, empresaId);
  const guardar = async () => {
    setGuardando(true);
    const p_items = items.map((i) => ({ factura_proveedor_id: i.factura.id, monto_usd: Math.round(i.monto * 100) / 100, moneda_pago: moneda }));
    const nuevo = destino === "nuevo";
    const { data, error } = await supabase.rpc("guardar_plan_pago", {
      p_plan_id: nuevo ? null : destino, p_fecha_corte: nuevo ? corte : null, p_fecha_pago: nuevo ? fechaPago : null,
      p_notas: nuevo ? notas : null, p_items, p_modo: nuevo ? "reemplazar" : "agregar",
    });
    setGuardando(false);
    if (error) { toast({ title: "No se pudo guardar el plan", description: mensajeError(error), variant: "destructive" }); return; }
    toast({ title: nuevo ? "Plan de pago creado (borrador)" : "Facturas agregadas al plan", description: `${items.length} facturas · ${fmtUsd(total)}` });
    onCreado(data as string);
  };

  return (
    <Dialog open={abierto} onOpenChange={(v) => { if (!v) onCerrar(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{destino === "nuevo" ? "Nuevo plan de pago" : "Agregar al plan"}</DialogTitle>
          <DialogDescription>{items.length} facturas · {fmtUsd(total)} · pendiente al {fmtFecha(corte)}. Queda en borrador hasta que un aprobador lo apruebe.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {borradores.length > 0 && (
            <div className="grid gap-1.5">
              <Label htmlFor="destino-plan">Plan</Label>
              <select id="destino-plan" value={destino} onChange={(e) => setDestino(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                <option value="nuevo">Nuevo plan</option>
                {borradores.map((p) => <option key={p.id} value={p.id}>Agregar a {p.numero} (borrador, pago {fmtFecha(p.fecha_pago)})</option>)}
              </select>
            </div>
          )}
          {destino === "nuevo" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="fecha-pago-plan">Fecha de pago</Label>
                  <Input id="fecha-pago-plan" type="date" value={fechaPago} onChange={(e) => setFechaPago(e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="moneda-plan">Se paga en</Label>
                  <select id="moneda-plan" value={moneda} onChange={(e) => setMoneda(e.target.value as "USD" | "BS")} className="h-10 rounded-md border border-input bg-background px-2 text-sm">
                    <option value="USD">Dólares (USD)</option>
                    <option value="BS">Bolívares (Bs.)</option>
                  </select>
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="notas-plan">Notas</Label>
                <Textarea id="notas-plan" value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} placeholder="Opcional: criterio, prioridades, quién ejecuta…" />
              </div>
            </>
          )}
          <CoberturaMonedas
            planUsd={moneda === "USD" ? total : 0} planBsUsd={moneda === "BS" ? total : 0} tasa={exchangeRate}
            dispUsd={disp.usd} dispBs={disp.bs} compacto
          />
          {moneda === "BS" && exchangeRate > 0 && <p className="text-xs text-muted-foreground">Equivale a {fmtBs(total * exchangeRate)} a la tasa BCV de hoy ({exchangeRate.toLocaleString("es-VE")}). La moneda se ajusta por factura en el plan.</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCerrar}>Cancelar</Button>
          <Button onClick={guardar} disabled={guardando || !items.length}>
            {guardando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{destino === "nuevo" ? "Crear borrador" : "Agregar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
