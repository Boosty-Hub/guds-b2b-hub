import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { VendedorLayout } from "@/components/vendedor/VendedorLayout";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Receipt } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { DeclararRetencionForm } from "@/components/retenciones/DeclararRetencionForm";
import type { FacturaSaldo } from "@/components/cuentas/SelectorFacturas";
import { FiltrosLista, useFiltros, opcionesDe, coincide, enRango, contadorFiltrado } from "@/components/datos/FiltrosLista";

interface ClienteConRetencion { id: string; nombre_negocio: string; }
interface Retencion { id: string; numero: string; tipo: string; estado: string; fecha: string; total: number; }

const ESTADO: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  pendiente: { label: "Pendiente", variant: "secondary" },
  aprobado: { label: "Aprobado", variant: "default" },
  rechazado: { label: "Rechazado", variant: "destructive" },
};

const VendedorRetenciones = () => {
  const { user } = useAuth();
  const { formatPrice } = useCurrency();
  const [clientes, setClientes] = useState<ClienteConRetencion[]>([]);
  // El cliente elegido va en la URL (?cliente=): sobrevive a recargar y se puede compartir
  const [params, setParams] = useSearchParams();
  const clienteId = params.get("cliente") ?? "";
  const [facturas, setFacturas] = useState<FacturaSaldo[]>([]);
  const [retenciones, setRetenciones] = useState<Retencion[]>([]);
  const [loading, setLoading] = useState(true);

  const cargarClientes = async () => {
    if (!user?.id) return;
    setLoading(true);
    const { data } = await supabase.from("clientes")
      .select("id, nombre_negocio")
      .eq("vendedor_asignado_id", user.id)
      .or("retiene_iva.eq.true,retiene_islr.eq.true")
      .order("nombre_negocio");
    setClientes((data as ClienteConRetencion[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { cargarClientes(); }, [user?.id]);

  const cargarDetalle = async (cid: string) => {
    const { data: facs } = await supabase.from("facturas")
      .select("id, numero, fecha_emision, saldo_usd")
      .eq("cliente_id", cid).eq("tipo", "factura").eq("estado", "posted").gt("saldo_usd", 0.009)
      .order("fecha_emision", { ascending: true });
    setFacturas(((facs as { id: string; numero: string; fecha_emision: string | null; saldo_usd: number }[]) ?? [])
      .map((f) => ({ id: f.id, numero: f.numero, fecha_emision: f.fecha_emision, saldo_usd: Number(f.saldo_usd) })));
    const { data: rets } = await supabase.from("retenciones")
      .select("id, numero, tipo, estado, fecha, total")
      .eq("cliente_id", cid).is("odoo_id", null).order("created_at", { ascending: false });
    setRetenciones((rets as Retencion[]) ?? []);
  };

  const elegirCliente = (cid: string) => {
    setParams((p) => { const n = new URLSearchParams(p); n.set("cliente", cid); ["tipo", "estado", "fecha"].forEach((k) => n.delete(k)); return n; }, { replace: true });
  };
  // Detalle del cliente de la URL (al elegirlo o al recargar)
  useEffect(() => {
    if (clienteId && clientes.some((c) => c.id === clienteId)) cargarDetalle(clienteId);
    else { setFacturas([]); setRetenciones([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteId, clientes]);
  const clienteSel = clientes.find((c) => c.id === clienteId);

  // Filtros de las retenciones del cliente (en la URL)
  const f = useFiltros([
    { clave: "tipo", etiqueta: "Tipo", principal: true, opciones: opcionesDe(retenciones, (r) => r.tipo, (_r, v) => v.toUpperCase()) },
    { clave: "estado", etiqueta: "Estado", principal: true, opciones: opcionesDe(retenciones, (r) => r.estado, (_r, v) => ESTADO[v]?.label ?? v) },
    { clave: "fecha", etiqueta: "Fecha", tipo: "fecha" },
  ]);
  const retFiltradas = retenciones.filter((r) => coincide(r.tipo, f.v("tipo")) && coincide(r.estado, f.v("estado")) && enRango(r.fecha, f.v("fecha")));

  return (
    <VendedorLayout title="Retenciones">
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : clientes.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center text-muted-foreground">
          <Receipt className="mb-3 h-10 w-10 opacity-50" />
          <p>Ninguno de tus clientes está registrado como agente de retención.</p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="max-w-sm space-y-2">
            <Select value={clienteId} onValueChange={elegirCliente}>
              <SelectTrigger aria-label="Cliente"><SelectValue placeholder="Elige un cliente" /></SelectTrigger>
              <SelectContent>
                {clientes.map((c) => <SelectItem key={c.id} value={c.id}>{c.nombre_negocio}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {clienteSel && (
            <>
              <div className="rounded-lg border border-border bg-card p-3">
                <h2 className="mb-2 text-[13px] font-semibold">Declarar retención — {clienteSel.nombre_negocio}</h2>
                <DeclararRetencionForm clienteId={clienteSel.id} facturas={facturas} onDeclarado={() => cargarDetalle(clienteId)} />
              </div>

              <div className="rounded-lg border border-border bg-card">
                <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
                  <h2 className="mr-auto text-[13px] font-semibold">Retenciones de {clienteSel.nombre_negocio}{" "}
                    <span className="font-normal text-muted-foreground" data-contador="">({contadorFiltrado(retFiltradas.length, retenciones.length, f.activos, "retenciones")})</span>
                  </h2>
                  {retenciones.length > 0 && <FiltrosLista filtros={f} resultados={retFiltradas.length} />}
                </div>
                {retenciones.length === 0 ? (
                  <p className="p-5 text-center text-sm text-muted-foreground">Sin retenciones todavía.</p>
                ) : retFiltradas.length === 0 ? (
                  <p className="p-5 text-center text-sm text-muted-foreground">
                    Ninguna retención con esos filtros.
                    <button type="button" className="ml-2 font-medium text-primary hover:underline" onClick={f.limpiar}>Limpiar filtros</button>
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nº</TableHead><TableHead>Tipo</TableHead><TableHead>Fecha</TableHead>
                        <TableHead className="text-right">Total</TableHead><TableHead>Estado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {retFiltradas.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="font-mono text-sm text-primary">{r.numero}</TableCell>
                          <TableCell className="uppercase text-muted-foreground">{r.tipo}</TableCell>
                          <TableCell className="text-muted-foreground">{new Date(r.fecha).toLocaleDateString("es-VE")}</TableCell>
                          <TableCell className="text-right font-semibold">{formatPrice(r.total)}</TableCell>
                          <TableCell><Badge variant={ESTADO[r.estado]?.variant ?? "secondary"}>{ESTADO[r.estado]?.label ?? r.estado}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </VendedorLayout>
  );
};

export default VendedorRetenciones;
