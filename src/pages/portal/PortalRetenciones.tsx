import { useEffect, useState } from "react";
import { PortalPagina } from "@/components/portal/PortalPagina";
import { EstadoVacio, Panel, PillTono, SkeletonFilas, type Tono } from "@/components/portal/sistema";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Receipt, Eye } from "lucide-react";
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

const ESTADO: Record<string, { label: string; tono: Tono }> = {
  pendiente: { label: "Pendiente", tono: "pendiente" },
  aprobado: { label: "Aprobado", tono: "ok" },
  rechazado: { label: "Rechazado", tono: "riesgo" },
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
    <PortalPagina titulo="Retenciones" descripcion="Declara los comprobantes de retención de IVA o ISLR de tus facturas.">
      {loading ? (
        <SkeletonFilas n={2} alto="h-48" />
      ) : !puedeRetener ? (
        <div className="rounded-xl border border-border bg-card">
          <EstadoVacio icono={Receipt} titulo="No estás registrado como agente de retención"
            descripcion="Si tu empresa es agente de retención, pide a tu ejecutivo de cuenta que lo actualice en tu ficha." />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:items-start">
          <Panel titulo="Declarar retención">
            <DeclararRetencionForm clienteId={user!.cliente_id!} facturas={facturas} onDeclarado={cargar} />
          </Panel>

          <Panel titulo={`Mis retenciones (${retenciones.length})`} cuerpoClassName="p-0 sm:p-0">
            {retenciones.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">Todavía no has declarado ninguna retención.</p>
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
                      <TableCell className="font-mono text-sm">{r.numero}</TableCell>
                      <TableCell className="uppercase text-muted-foreground">{r.tipo}</TableCell>
                      <TableCell className="text-muted-foreground">{new Date(r.fecha).toLocaleDateString("es-VE")}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{formatPrice(r.total)}</TableCell>
                      <TableCell><PillTono tono={ESTADO[r.estado]?.tono ?? "neutro"}>{ESTADO[r.estado]?.label ?? r.estado}</PillTono></TableCell>
                      <TableCell>
                        {r.comprobante_url && (
                          <Button variant="ghost" size="icon" onClick={() => verComprobante(r.comprobante_url!)} aria-label={`Ver comprobante de ${r.numero}`}><Eye className="h-4 w-4" /></Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Panel>
        </div>
      )}
    </PortalPagina>
  );
};

export default PortalRetenciones;
