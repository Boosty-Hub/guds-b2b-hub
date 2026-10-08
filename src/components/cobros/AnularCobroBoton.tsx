import { useState, type MouseEvent } from "react";
import { Ban, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/lib/supabase";
import { usePermissions } from "@/contexts/PermissionsContext";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/*
 * Botón «Anular» de un cobro (fase 22a). Solo lo ve quien puede editar la Papelera (Administrador).
 *  · Cobro registrado en GUDS y verificado → diálogo con motivo obligatorio → RPC anular_cobro. El cobro queda anulado,
 *    sus facturas recuperan el saldo, sale del banco y su foto va a la Papelera (de donde se puede restaurar).
 *  · Cobro que viene de Odoo → solo explica que se anula en Odoo (la sincronización lo refleja).
 *  · Cobros por verificar, rechazados, ya anulados o el IGTF de otro cobro → no muestra nada.
 *
 * Uso:  <AnularCobroBoton cobro={{ id, numero, monto, estado, odoo_id, es_igtf, moneda, monto_moneda, cliente }} onAnulado={recargar} />
 */

export interface CobroAnulable {
  id: string;
  numero: string;
  /** Monto en USD */
  monto: number;
  /** Solo se anulan los verificados (si no se pasa, se asume verificado) */
  estado?: string | null;
  /** Si viene de Odoo, el botón solo explica que se anula allá */
  odoo_id?: number | null;
  /** El IGTF de un cobro se anula junto con su cobro: no lleva botón */
  es_igtf?: boolean | null;
  moneda?: string | null;
  monto_moneda?: number | null;
  /** Nombre del cliente, para el diálogo */
  cliente?: string | null;
}

export interface ResultadoAnulacion { papelera_id: string; numero: string; monto_usd: number; facturas: number; cobros: number }

export function AnularCobroBoton({ cobro, onAnulado, variante = "boton", className }: {
  cobro: CobroAnulable;
  onAnulado?: (r: ResultadoAnulacion) => void;
  /** "boton": texto «Anular» (por defecto) · "icono": solo el ícono, para tablas angostas */
  variante?: "boton" | "icono";
  className?: string;
}) {
  const { can } = usePermissions();
  const { soloLectura } = useEmpresa();
  const { formatPrice } = useCurrency();
  const { toast } = useToast();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);

  if (!can("papelera", "editar")) return null;
  if ((cobro.estado ?? "verificado") !== "verificado" || cobro.es_igtf) return null;

  const deOdoo = !!cobro.odoo_id;
  const motivoOk = motivo.trim().length >= 5;
  const abrir = (e: MouseEvent) => { e.stopPropagation(); setMotivo(""); setAbierto(true); };

  const anular = async () => {
    if (!motivoOk || soloLectura) return;
    setGuardando(true);
    const { data, error } = await supabase.rpc("anular_cobro", { p_pago_id: cobro.id, p_motivo: motivo.trim() });
    setGuardando(false);
    if (error) { toast({ title: "No se pudo anular el cobro", description: error.message, variant: "destructive" }); return; }
    const r = data as ResultadoAnulacion;
    toast({ title: `Cobro ${cobro.numero} anulado`, description: "Sus facturas recuperaron el saldo. Quedó en la Papelera, desde donde se puede restaurar." });
    setAbierto(false);
    onAnulado?.(r);
  };

  const montoTexto = `${formatPrice(Number(cobro.monto || 0))}${cobro.moneda && cobro.moneda !== "USD" && cobro.monto_moneda
    ? ` · ${Number(cobro.monto_moneda).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cobro.moneda === "BS" ? "Bs." : cobro.moneda}` : ""}`;
  const etiqueta = deOdoo ? `Anular ${cobro.numero} (viene de Odoo)` : `Anular cobro ${cobro.numero}`;

  return (
    <>
      {variante === "icono" ? (
        <Button type="button" variant="ghost" size="icon" onClick={abrir} aria-label={etiqueta}
          title={deOdoo ? "Este cobro viene de Odoo: se anula en Odoo" : "Anular cobro"}
          className={cn("h-7 w-7", deOdoo ? "text-muted-foreground/60 hover:text-muted-foreground" : "text-destructive hover:bg-destructive/10", className)}>
          <Ban className="h-3.5 w-3.5" />
        </Button>
      ) : (
        <Button type="button" variant={deOdoo ? "ghost" : "outline"} size="sm" onClick={abrir} aria-label={etiqueta}
          title={deOdoo ? "Este cobro viene de Odoo: se anula en Odoo" : "Anular cobro"}
          className={cn("h-7 gap-1 px-2 text-xs", deOdoo ? "text-muted-foreground" : "border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive", className)}>
          <Ban className="h-3.5 w-3.5" /> Anular
        </Button>
      )}

      <Dialog open={abierto} onOpenChange={(o) => { if (!guardando) setAbierto(o); }}>
        <DialogContent className="max-w-lg" onClick={(e) => e.stopPropagation()}>
          {deOdoo ? (
            <>
              <DialogHeader>
                <DialogTitle>El cobro {cobro.numero} viene de Odoo</DialogTitle>
                <DialogDescription>Odoo es la fuente de verdad de los cobros que vienen de allá.</DialogDescription>
              </DialogHeader>
              <p className="text-sm">
                Este cobro viene de Odoo: <span className="font-medium">anúlalo en Odoo y la sincronización lo reflejará</span> en GUDS
                (estado del cobro y saldo de sus facturas).
              </p>
              <DialogFooter><Button variant="outline" onClick={() => setAbierto(false)}>Entendido</Button></DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Anular cobro {cobro.numero}</DialogTitle>
                <DialogDescription>
                  {cobro.cliente ? <><span className="font-medium text-foreground">{cobro.cliente}</span> · </> : null}{montoTexto}
                </DialogDescription>
              </DialogHeader>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                <li>Se quitan sus aplicaciones: cada factura recupera el saldo que este cobro le había rebajado.</li>
                <li>Se quita su entrada en el banco (y el IGTF que haya nacido de él).</li>
                <li>Queda en la <span className="font-medium text-foreground">Papelera</span> con todos sus datos; un administrador puede restaurarlo si las facturas aún tienen saldo.</li>
              </ul>
              <div className="space-y-1.5">
                <Label htmlFor={`motivo-anular-${cobro.id}`}>Motivo de la anulación *</Label>
                <Textarea id={`motivo-anular-${cobro.id}`} rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Ej.: cobro duplicado, monto equivocado, registrado al cliente que no era…" />
                {motivo.length > 0 && !motivoOk && <p className="text-xs text-destructive">Escribe al menos 5 caracteres.</p>}
              </div>
              {soloLectura && (
                <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                  Estás viendo «Ambas empresas» (solo consulta): elige GUDS o Quirutec en el menú superior para anular.
                </p>
              )}
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setAbierto(false)} disabled={guardando}>Cancelar</Button>
                <Button variant="destructive" onClick={anular} disabled={guardando || !motivoOk || soloLectura} className="gap-2">
                  {guardando && <Loader2 className="h-4 w-4 animate-spin" />} Anular cobro
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
