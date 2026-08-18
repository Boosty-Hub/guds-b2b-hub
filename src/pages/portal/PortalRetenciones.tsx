import { useEffect, useState } from "react";
import { PortalMobileLayout } from "@/components/portal/PortalMobileLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Receipt, Eye } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/hooks/use-toast";
import { DeclararRetencionForm } from "@/components/retenciones/DeclararRetencionForm";
import type { FacturaSaldo } from "@/components/cuentas/SelectorFacturas";

interface ClienteFlags { retiene_iva: boolean; retiene_islr: boolean; }
interface Retencion {
  id: string; numero: string; tipo: string; estado: string; fecha: string; total: number; comprobante_url: string | null;
}

const ESTADO: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  pendiente: { label: "Pendiente", variant: "secondary" },
  aprobado: { label: "Aprobado", variant: "default" },
  rechazado: { label: "Rechazado", variant: "destructive" },
};

const PortalRetenciones = () => {
  const { user } = useAuth();
  const { formatPrice } = useCurrency();
  const { toast } = useToast();
  const [flags, setFlags] = useState<ClienteFlags | null>(null);
  const [facturas, setFacturas] = useState<FacturaSaldo[]>([]);
  const [retenciones, setRetenciones] = useState<Retencion[]>([]);
  const [loading, setLoading] = useState(true);

  const cargar = async () => {
    if (!user?.cliente_id) return;
    setLoading(true);
    const { data: cli } = await supabase.from("clientes").select("retiene_iva, retiene_islr").eq("id", user.cliente_id).maybeSingle();
    setFlags((cli as ClienteFlags) ?? null);
    const { data: facs } = await supabase.from("facturas")
      .select("id, numero, fecha_emision, saldo_usd")
      .eq("cliente_id", user.cliente_id).eq("tipo", "factura").eq("estado", "posted").gt("saldo_usd", 0.009)
      .order("fecha_emision", { ascending: true });
    setFacturas(((facs as { id: string; numero: string; fecha_emision: string | null; saldo_usd: number }[]) ?? [])
      .map((f) => ({ id: f.id, numero: f.numero, fecha_emision: f.fecha_emision, saldo_usd: Number(f.saldo_usd) })));
    const { data: rets } = await supabase.from("retenciones")
      .select("id, numero, tipo, estado, fecha, total, comprobante_url")
      .eq("cliente_id", user.cliente_id).is("odoo_id", null).order("created_at", { ascending: false });
    setRetenciones((rets as Retencion[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { cargar(); }, [user?.cliente_id]);

  const verComprobante = async (path: string) => {
    const { data, error } = await supabase.storage.from("documentos").createSignedUrl(path, 120);
    if (error || !data?.signedUrl) { toast({ title: "No se pudo abrir el comprobante", variant: "destructive" }); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const puedeRetener = flags?.retiene_iva || flags?.retiene_islr;

  return (
    <PortalMobileLayout title="Retenciones">
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : !puedeRetener ? (
        <div className="flex flex-col items-center px-4 py-16 text-center text-muted-foreground">
          <Receipt className="mb-3 h-10 w-10 opacity-50" />
          <p>No estás registrado como agente de retención.</p>
        </div>
      ) : (
        <div className="space-y-6 px-4 pt-4">
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <h2 className="mb-3 font-semibold">Declarar retención</h2>
            <DeclararRetencionForm clienteId={user!.cliente_id!} facturas={facturas} onDeclarado={cargar} />
          </div>

          <div className="rounded-xl border border-border bg-card shadow-sm">
            <div className="border-b border-border p-5"><h2 className="font-semibold">Mis retenciones ({retenciones.length})</h2></div>
            {retenciones.length === 0 ? (
              <p className="p-8 text-center text-muted-foreground">Todavía no declaraste ninguna retención.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nº</TableHead><TableHead>Tipo</TableHead><TableHead>Fecha</TableHead>
                    <TableHead className="text-right">Total</TableHead><TableHead>Estado</TableHead><TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {retenciones.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-sm text-primary">{r.numero}</TableCell>
                      <TableCell className="uppercase text-muted-foreground">{r.tipo}</TableCell>
                      <TableCell className="text-muted-foreground">{new Date(r.fecha).toLocaleDateString("es-VE")}</TableCell>
                      <TableCell className="text-right font-semibold">{formatPrice(r.total)}</TableCell>
                      <TableCell><Badge variant={ESTADO[r.estado]?.variant ?? "secondary"}>{ESTADO[r.estado]?.label ?? r.estado}</Badge></TableCell>
                      <TableCell>
                        {r.comprobante_url && (
                          <Button variant="ghost" size="icon" onClick={() => verComprobante(r.comprobante_url!)}><Eye className="h-4 w-4" /></Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      )}
    </PortalMobileLayout>
  );
};

export default PortalRetenciones;
