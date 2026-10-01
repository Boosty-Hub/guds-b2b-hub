import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { fechaHora } from "./formato";

// Registro de envíos del estado de cuenta (fase 21b): los últimos envíos de todos los clientes de la empresa, individuales
// y masivos, con el estado del envío y la entrega o rebote que informa Resend.

interface Envio {
  id: string; cliente_id: string; cliente: string; creado_at: string; estado: "enviando" | "enviado" | "fallido";
  destinatarios: string[]; error: string | null; lote_id: string | null; entrega: string | null; entrega_detalle: string | null; enviado_por: string | null;
}

const ESTADO: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  enviado: { label: "Enviado", variant: "default" }, enviando: { label: "Enviando", variant: "secondary" }, fallido: { label: "Falló", variant: "destructive" },
  entregado: { label: "Entregado", variant: "outline" }, rebotado: { label: "Rebotó", variant: "destructive" },
  queja: { label: "Marcado como spam", variant: "destructive" }, retrasado: { label: "Retrasado", variant: "secondary" },
};

export function RegistroEnvios({ open, onOpenChange, senal = 0 }: { open: boolean; onOpenChange: (o: boolean) => void; senal?: number }) {
  const [envios, setEnvios] = useState<Envio[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setEnvios(null);
    supabase.rpc("envios_estado_cuenta_recientes", { p_limite: 200 }).then(({ data, error: e }) => {
      if (e) { setError(e.message); setEnvios([]); return; }
      setError(null); setEnvios((data as Envio[]) ?? []);
    });
  }, [open, senal]);
  const rebotes = (envios ?? []).filter((e) => e.entrega === "rebotado" || e.entrega === "queja" || e.estado === "fallido").length;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full p-0 sm:max-w-lg" data-testid="registro-envios">
        <SheetHeader className="border-b border-border px-4 py-3 text-left">
          <SheetTitle className="text-base">Registro de envíos</SheetTitle>
          <SheetDescription className="text-xs">
            Últimos {envios?.length ?? "…"} envíos del estado de cuenta{rebotes ? ` · ${rebotes} con error o rebote` : ""}. La entrega la informa el proveedor de correo.
          </SheetDescription>
        </SheetHeader>
        <div className="h-[calc(100vh-5.5rem)] overflow-y-auto">
          {envios === null ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            : error ? <p className="p-4 text-sm text-destructive">{error}</p>
            : envios.length === 0 ? <p className="p-4 text-sm text-muted-foreground">Aún no hay envíos.</p>
            : (
              <ul className="divide-y divide-border">
                {envios.map((e) => (
                  <li key={e.id} className="space-y-0.5 px-4 py-2 text-xs" data-testid="registro-envio">
                    <div className="flex items-center justify-between gap-2">
                      <Link to={`/admin/cuentas/${e.cliente_id}`} className="min-w-0 truncate font-medium text-primary hover:underline" onClick={() => onOpenChange(false)}>{e.cliente}</Link>
                      <span className="flex shrink-0 gap-1">
                        {e.entrega && <Badge variant={ESTADO[e.entrega]?.variant ?? "outline"} className="px-1.5 py-0 text-[10px]" title={e.entrega_detalle ?? undefined}>{ESTADO[e.entrega]?.label ?? e.entrega}</Badge>}
                        <Badge variant={ESTADO[e.estado].variant} className="px-1.5 py-0 text-[10px]">{ESTADO[e.estado].label}</Badge>
                      </span>
                    </div>
                    <p className="truncate text-muted-foreground" title={e.destinatarios.join(", ")}>{e.destinatarios.join(", ")}</p>
                    <p className="truncate text-muted-foreground">{fechaHora(e.creado_at)}{e.lote_id ? " · masivo" : ""}{e.enviado_por ? ` · ${e.enviado_por}` : ""}{e.error ? ` · ${e.error}` : ""}</p>
                  </li>
                ))}
              </ul>
            )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
