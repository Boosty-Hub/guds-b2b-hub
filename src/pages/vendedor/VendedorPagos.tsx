import { useState, useEffect, useCallback } from "react";
import { VendedorLayout } from "@/components/vendedor/VendedorLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";

interface Pago { id: string; numero: string; monto: number; metodo: string; estado: string; referencia: string | null; created_at: string; cliente?: { nombre_negocio: string } | null; }
interface Cli { id: string; nombre_negocio: string; }
interface OrdenPend { id: string; numero: string; total: number; cliente_id: string; }
interface Banco { id: string; nombre: string; metodo_pago: string; metodos: string[] | null; moneda: string; }

const metodoLabel: Record<string, string> = {
  transferencia: "Transferencia", efectivo: "Efectivo", pago_movil: "Pago Móvil", credito: "Crédito", tarjeta: "Tarjeta",
};

const estadoConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  pendiente: { label: "Pendiente", variant: "secondary" }, verificado: { label: "Verificado", variant: "default" }, rechazado: { label: "Rechazado", variant: "destructive" },
};

const VendedorPagos = () => {
  const { formatPrice, exchangeRate } = useCurrency();
  const { user } = useAuth();
  const { toast } = useToast();
  const [pagos, setPagos] = useState<Pago[]>([]);
  const [clientes, setClientes] = useState<Cli[]>([]);
  const [ordenes, setOrdenes] = useState<OrdenPend[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ cliente_id: "", orden_id: "", monto: "", banco_id: "", metodo: "", tasa: "", referencia: "" });
  const [bancos, setBancos] = useState<Banco[]>([]);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    const [pRes, cRes, oRes, bRes] = await Promise.all([
      supabase.from("pagos").select("id, numero, monto, metodo, estado, referencia, created_at, cliente:clientes(nombre_negocio)").order("created_at", { ascending: false }),
      // Solo los clientes asignados a este vendedor
      supabase.from("clientes").select("id, nombre_negocio").eq("activo", true).eq("vendedor_asignado_id", user.id).order("nombre_negocio"),
      supabase.from("ordenes").select("id, numero, total, cliente_id").eq("pagado", false).neq("estado", "cancelado"),
      supabase.from("bancos").select("id, nombre, metodo_pago, metodos, moneda").eq("activo", true).order("nombre"),
    ]);
    if (pRes.data) setPagos(pRes.data as unknown as Pago[]);
    if (cRes.data) setClientes(cRes.data as Cli[]);
    if (oRes.data) setOrdenes(oRes.data as OrdenPend[]);
    if (bRes.data) setBancos(bRes.data as Banco[]);
    setLoading(false);
  }, [user?.id]);
  useEffect(() => { fetchData(); }, [fetchData]);

  const verificados = pagos.filter((p) => p.estado === "verificado").reduce((s, p) => s + Number(p.monto), 0);
  const pendientes = pagos.filter((p) => p.estado === "pendiente").reduce((s, p) => s + Number(p.monto), 0);

  const ordenesDelCliente = ordenes.filter((o) => o.cliente_id === form.cliente_id);
  const bancoSel = bancos.find((b) => b.id === form.banco_id);
  const esBS = bancoSel?.moneda === "BS";
  const metodosBanco = bancoSel?.metodos?.length ? bancoSel.metodos : bancoSel ? [bancoSel.metodo_pago] : [];

  const registrar = async () => {
    if (!form.cliente_id || !form.monto || Number(form.monto) <= 0) { toast({ title: "Faltan datos", description: "Elige cliente y monto", variant: "destructive" }); return; }
    if (esBS && (!form.tasa || Number(form.tasa) <= 0)) { toast({ title: "Falta la tasa", description: "Indica la tasa (Bs. por USD) para un cobro en bolívares.", variant: "destructive" }); return; }
    setSaving(true);
    const { error } = await supabase.rpc("registrar_pago", {
      p_cliente_id: form.cliente_id, p_orden_id: form.orden_id || null, p_banco_id: form.banco_id || null,
      p_metodo: form.metodo || metodosBanco[0] || "transferencia", p_monto_moneda: Number(form.monto),
      p_moneda: bancoSel?.moneda || "USD", p_tasa_cambio: esBS ? Number(form.tasa) : null, p_referencia: form.referencia || null,
    });
    setSaving(false);
    if (error) { toast({ title: "No se pudo registrar el cobro", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Cobro registrado", description: "Queda pendiente de verificación por administración." });
    setOpen(false); setForm({ cliente_id: "", orden_id: "", monto: "", banco_id: "", metodo: "", tasa: "", referencia: "" });
    fetchData();
  };

  const fmt = (s: string) => new Date(s).toLocaleDateString("es-ES", { day: "2-digit", month: "short" });

  const pagination = usePagination(pagos, 25);

  return (
    <VendedorLayout title="Pagos">
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="border-border"><CardContent className="p-4"><p className="text-2xl font-bold text-emerald-600">{formatPrice(verificados)}</p><p className="text-sm text-muted-foreground">Verificados</p></CardContent></Card>
          <Card className="border-border"><CardContent className="p-4"><p className="text-2xl font-bold">{formatPrice(pendientes)}</p><p className="text-sm text-muted-foreground">Pendientes de verificar</p></CardContent></Card>
          <Card className="border-border"><CardContent className="p-4"><p className="text-2xl font-bold">{pagos.length}</p><p className="text-sm text-muted-foreground">Total registros</p></CardContent></Card>
        </div>

        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold">Pagos de mis clientes</h2>
          <Button className="bg-emerald-500 hover:bg-emerald-600" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />Registrar Cobro</Button>
        </div>

        <div className="rounded-xl border border-border bg-card">
          {loading ? <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-emerald-500" /></div>
          : pagos.length === 0 ? <div className="py-16 text-center text-muted-foreground">Aún no hay pagos registrados</div>
          : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Pago</TableHead><TableHead>Cliente</TableHead><TableHead>Fecha</TableHead>
                <TableHead className="text-right">Monto</TableHead><TableHead>Método</TableHead><TableHead>Estado</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {pagination.pageItems.map((p) => (
                  <TableRow key={p.id} className="hover:bg-muted/50">
                    <TableCell className="font-medium text-emerald-600">{p.numero}</TableCell>
                    <TableCell>{p.cliente?.nombre_negocio || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{fmt(p.created_at)}</TableCell>
                    <TableCell className="text-right font-semibold">{formatPrice(Number(p.monto))}</TableCell>
                    <TableCell>{metodoLabel[p.metodo] || p.metodo}</TableCell>
                    <TableCell><Badge variant={estadoConfig[p.estado]?.variant || "secondary"}>{estadoConfig[p.estado]?.label || p.estado}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {!loading && pagos.length > 0 && <DataTablePagination pagination={pagination} />}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Registrar cobro</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>Cliente</Label>
              <Select value={form.cliente_id} onValueChange={(v) => setForm((f) => ({ ...f, cliente_id: v, orden_id: "" }))}>
                <SelectTrigger><SelectValue placeholder="Selecciona el cliente" /></SelectTrigger>
                <SelectContent>{clientes.map((c) => <SelectItem key={c.id} value={c.id}>{c.nombre_negocio}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {form.cliente_id && ordenesDelCliente.length > 0 && (
              <div><Label>Orden (opcional)</Label>
                <Select value={form.orden_id} onValueChange={(v) => setForm((f) => ({ ...f, orden_id: v, monto: ordenesDelCliente.find((o) => o.id === v)?.total?.toString() || f.monto }))}>
                  <SelectTrigger><SelectValue placeholder="Aplicar a una orden" /></SelectTrigger>
                  <SelectContent>{ordenesDelCliente.map((o) => <SelectItem key={o.id} value={o.id}>{o.numero} — {formatPrice(Number(o.total))}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Banco / cuenta que recibe</Label>
                <Select value={form.banco_id} onValueChange={(v) => {
                  const b = bancos.find((x) => x.id === v);
                  const ms = b?.metodos?.length ? b.metodos : b ? [b.metodo_pago] : [];
                  const nextTasa = b?.moneda === "BS" && exchangeRate > 0 ? String(exchangeRate) : "";
                  setForm((f) => ({ ...f, banco_id: v, metodo: ms[0] || "transferencia", tasa: nextTasa }));
                }}>
                  <SelectTrigger><SelectValue placeholder="Seleccionar banco" /></SelectTrigger>
                  <SelectContent>{bancos.map((b) => <SelectItem key={b.id} value={b.id}>{b.nombre} · {b.moneda === "USD" ? "USD $" : "Bs."}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Método</Label>
                <Select value={form.metodo} onValueChange={(v) => setForm((f) => ({ ...f, metodo: v }))} disabled={!form.banco_id}>
                  <SelectTrigger><SelectValue placeholder={form.banco_id ? "Método" : "Elegí un banco"} /></SelectTrigger>
                  <SelectContent>{metodosBanco.map((m) => <SelectItem key={m} value={m}>{metodoLabel[m] || m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>{esBS ? "Monto recibido (Bs.)" : "Monto recibido (USD $)"}</Label><Input type="number" min="0" step="0.01" value={form.monto} onChange={(e) => setForm((f) => ({ ...f, monto: e.target.value }))} placeholder="0.00" /></div>
            {esBS && (
              <div>
                <div className="flex items-center justify-between">
                  <Label>Tasa de cambio (Bs. por 1 USD)</Label>
                  <span className="text-[11px] text-muted-foreground">Tasa BCV precargada</span>
                </div>
                <Input type="number" min="0" step="0.01" value={form.tasa} onChange={(e) => setForm((f) => ({ ...f, tasa: e.target.value }))} placeholder="Ej. 400" />
                {form.monto && form.tasa && Number(form.tasa) > 0 && (
                  <div className="mt-2 flex items-center justify-between rounded-md bg-muted/60 px-3 py-2">
                    <span className="text-xs text-muted-foreground">Equivale a</span>
                    <span className="text-sm font-semibold">{formatPrice(Number(form.monto) / Number(form.tasa))}</span>
                  </div>
                )}
              </div>
            )}
            <div><Label>Referencia</Label><Input value={form.referencia} onChange={(e) => setForm((f) => ({ ...f, referencia: e.target.value }))} placeholder="Nro. de referencia (opcional)" /></div>
            <p className="text-xs text-muted-foreground">El cobro queda pendiente hasta que administración lo verifique.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
            <Button className="bg-emerald-500 hover:bg-emerald-600" onClick={registrar} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Registrar cobro"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </VendedorLayout>
  );
};

export default VendedorPagos;
