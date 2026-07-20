import { useState, useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Search, DollarSign, TrendingUp, TrendingDown, CreditCard, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/hooks/use-toast";

interface ClienteCuenta {
  id: string;
  codigo: string;
  nombre_negocio: string;
  limite_credito: number;
  credito_utilizado: number;
  dias_credito: number;
}
interface PagoRow {
  id: string;
  numero: string;
  cliente_id: string;
  monto: number;
  metodo: string;
  referencia: string | null;
  estado: string;
  created_at: string;
  fecha_verificacion: string | null;
  cliente?: { nombre_negocio: string } | null;
}
interface OrdenRow {
  id: string;
  numero: string;
  cliente_id: string;
  total: number;
  estado: string;
  pagado: boolean;
  metodo_pago: string | null;
  created_at: string;
  cliente?: { nombre_negocio: string } | null;
}

const Cuentas = () => {
  const { formatPrice, exchangeRate } = useCurrency();
  const { toast } = useToast();
  const [clientes, setClientes] = useState<ClienteCuenta[]>([]);
  const [pagos, setPagos] = useState<PagoRow[]>([]);
  const [ordenes, setOrdenes] = useState<OrdenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchAcc, setSearchAcc] = useState("");
  const [searchTrx, setSearchTrx] = useState("");

  // Registrar pago
  const [payOpen, setPayOpen] = useState(false);
  const [payForm, setPayForm] = useState({ cliente_id: "", orden_id: "", monto: "", banco_id: "", tasa: "", referencia: "" });
  const [bancos, setBancos] = useState<{ id: string; nombre: string; metodo_pago: string; moneda: string }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    setLoading(true);
    const [cRes, pRes, oRes, bRes] = await Promise.all([
      supabase.from("clientes").select("id, codigo, nombre_negocio, limite_credito, credito_utilizado, dias_credito").eq("activo", true),
      supabase.from("pagos").select("id, numero, cliente_id, monto, metodo, referencia, estado, created_at, fecha_verificacion, cliente:clientes(nombre_negocio)").order("created_at", { ascending: false }),
      supabase.from("ordenes").select("id, numero, cliente_id, total, estado, pagado, metodo_pago, created_at, cliente:clientes(nombre_negocio)").order("created_at", { ascending: false }),
      supabase.from("bancos").select("id, nombre, metodo_pago, moneda").eq("activo", true).order("nombre"),
    ]);
    if (cRes.data) setClientes(cRes.data as ClienteCuenta[]);
    if (pRes.data) setPagos(pRes.data as unknown as PagoRow[]);
    if (oRes.data) setOrdenes(oRes.data as unknown as OrdenRow[]);
    if (bRes.data) setBancos(bRes.data as { id: string; nombre: string; metodo_pago: string; moneda: string }[]);
    setLoading(false);
  };

  const bancoSel = bancos.find((b) => b.id === payForm.banco_id);
  const esBS = bancoSel?.moneda === "BS";

  const now = Date.now();
  const isOverdue = (o: OrdenRow, diasCredito: number) =>
    o.metodo_pago === "credito" && !o.pagado && o.estado !== "cancelado" &&
    new Date(o.created_at).getTime() + diasCredito * 86400000 < now;

  const overdueByClient = new Map<string, number>();
  for (const o of ordenes) {
    const cli = clientes.find((c) => c.id === o.cliente_id);
    if (cli && isOverdue(o, cli.dias_credito)) {
      overdueByClient.set(o.cliente_id, (overdueByClient.get(o.cliente_id) || 0) + Number(o.total));
    }
  }
  const ultimoPagoByClient = new Map<string, string>();
  for (const p of pagos) {
    if (p.estado === "verificado" && p.fecha_verificacion) {
      const prev = ultimoPagoByClient.get(p.cliente_id);
      if (!prev || new Date(p.fecha_verificacion) > new Date(prev)) ultimoPagoByClient.set(p.cliente_id, p.fecha_verificacion);
    }
  }

  const estadoCuenta = (c: ClienteCuenta): { label: string; variant: "default" | "secondary" | "destructive" } => {
    if (Number(c.credito_utilizado) > Number(c.limite_credito)) return { label: "Excedido", variant: "destructive" };
    if (overdueByClient.has(c.id)) return { label: "Vencido", variant: "secondary" };
    return { label: "Al Día", variant: "default" };
  };

  // KPIs
  const totalPorCobrar = clientes.reduce((s, c) => s + Number(c.credito_utilizado || 0), 0);
  const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const cobradoMes = pagos
    .filter((p) => p.estado === "verificado" && p.fecha_verificacion && new Date(p.fecha_verificacion).getTime() >= inicioMes)
    .reduce((s, p) => s + Number(p.monto || 0), 0);
  const totalVencido = Array.from(overdueByClient.values()).reduce((s, v) => s + v, 0);
  const clientesConCredito = clientes.filter((c) => Number(c.limite_credito) > 0).length;

  const formatDate = (s: string | null) => (s ? new Date(s).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }) : "—");

  // Movimientos: pagos verificados (+) y órdenes a crédito (cargo, -)
  const movimientos = [
    ...pagos.filter((p) => p.estado === "verificado").map((p) => ({
      id: p.id, fecha: p.fecha_verificacion || p.created_at, cliente: p.cliente?.nombre_negocio || "—",
      tipo: "pago" as const, monto: Number(p.monto), metodo: p.metodo, referencia: p.numero,
    })),
    ...ordenes.filter((o) => o.metodo_pago === "credito" && o.estado !== "cancelado").map((o) => ({
      id: o.id, fecha: o.created_at, cliente: o.cliente?.nombre_negocio || "—",
      tipo: "cargo" as const, monto: Number(o.total), metodo: "Orden a crédito", referencia: o.numero,
    })),
  ].sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());

  const clientesFiltrados = clientes.filter((c) =>
    c.nombre_negocio.toLowerCase().includes(searchAcc.toLowerCase()) || c.codigo.toLowerCase().includes(searchAcc.toLowerCase()));
  const movimientosFiltrados = movimientos.filter((m) =>
    m.cliente.toLowerCase().includes(searchTrx.toLowerCase()) || m.referencia.toLowerCase().includes(searchTrx.toLowerCase()));

  const ordenesPendientesDelCliente = ordenes.filter((o) => o.cliente_id === payForm.cliente_id && !o.pagado && o.estado !== "cancelado");

  const registrarPago = async () => {
    if (!payForm.cliente_id || !payForm.monto || Number(payForm.monto) <= 0) {
      toast({ title: "Datos incompletos", description: "Elige el cliente y un monto válido", variant: "destructive" });
      return;
    }
    if (esBS && (!payForm.tasa || Number(payForm.tasa) <= 0)) {
      toast({ title: "Falta la tasa de cambio", description: "Para un cobro en bolívares indica la tasa (Bs. por USD).", variant: "destructive" });
      return;
    }
    setSaving(true);
    // registrar_pago: como admin queda verificado y liquida la orden (soporta parcial/multi-método)
    const { error } = await supabase.rpc("registrar_pago", {
      p_cliente_id: payForm.cliente_id,
      p_orden_id: payForm.orden_id || null,
      p_banco_id: payForm.banco_id || null,
      p_metodo: bancoSel?.metodo_pago || "efectivo",
      p_monto_moneda: Number(payForm.monto),
      p_moneda: bancoSel?.moneda || "USD",
      p_tasa_cambio: esBS ? Number(payForm.tasa) : null,
      p_referencia: payForm.referencia || null,
    });
    setSaving(false);
    if (error) {
      toast({ title: "No se pudo registrar el pago", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Pago registrado", description: "El pago fue registrado y aplicado a la cuenta del cliente." });
    setPayOpen(false);
    setPayForm({ cliente_id: "", orden_id: "", monto: "", banco_id: "", tasa: "", referencia: "" });
    fetchAll();
  };

  return (
    <MainLayout title="Cuentas por Cobrar">
      {/* Stats */}
      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-destructive/10 p-2"><TrendingDown className="h-5 w-5 text-destructive" /></div>
            <div>
              <p className="text-2xl font-bold text-destructive">{formatPrice(totalPorCobrar)}</p>
              <p className="text-sm text-muted-foreground">Total por Cobrar</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-success/10 p-2"><TrendingUp className="h-5 w-5 text-success" /></div>
            <div>
              <p className="text-2xl font-bold text-success">{formatPrice(cobradoMes)}</p>
              <p className="text-sm text-muted-foreground">Cobrado este Mes</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-warning/10 p-2"><DollarSign className="h-5 w-5 text-warning" /></div>
            <div>
              <p className="text-2xl font-bold">{formatPrice(totalVencido)}</p>
              <p className="text-sm text-muted-foreground">Vencido</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2"><CreditCard className="h-5 w-5 text-primary" /></div>
            <div>
              <p className="text-2xl font-bold">{clientesConCredito}</p>
              <p className="text-sm text-muted-foreground">Clientes con Crédito</p>
            </div>
          </div>
        </div>
      </div>

      <Tabs defaultValue="accounts" className="space-y-6">
        <TabsList>
          <TabsTrigger value="accounts">Estado de Cuentas</TabsTrigger>
          <TabsTrigger value="transactions">Movimientos</TabsTrigger>
        </TabsList>

        <TabsContent value="accounts" className="space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Buscar cliente..." className="pl-9" value={searchAcc} onChange={(e) => setSearchAcc(e.target.value)} />
            </div>
            <Button className="gap-2" onClick={() => setPayOpen(true)}>
              <Plus className="h-4 w-4" /> Registrar Pago
            </Button>
          </div>

          <div className="rounded-xl border border-border bg-card shadow-sm">
            {loading ? (
              <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
            ) : clientesFiltrados.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">No hay clientes con cuenta</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead className="text-right">Límite Crédito</TableHead>
                    <TableHead className="text-right">Saldo Deudor</TableHead>
                    <TableHead className="text-right">Disponible</TableHead>
                    <TableHead>Último Pago</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clientesFiltrados.map((c) => {
                    const disponible = Number(c.limite_credito) - Number(c.credito_utilizado);
                    const est = estadoCuenta(c);
                    return (
                      <TableRow key={c.id} className="hover:bg-muted/50">
                        <TableCell>
                          <p className="font-medium">{c.nombre_negocio}</p>
                          <p className="text-xs text-muted-foreground">{c.codigo}</p>
                        </TableCell>
                        <TableCell className="text-right">{formatPrice(Number(c.limite_credito))}</TableCell>
                        <TableCell className={`text-right font-semibold ${Number(c.credito_utilizado) > 0 ? "text-destructive" : ""}`}>
                          {formatPrice(Number(c.credito_utilizado))}
                        </TableCell>
                        <TableCell className={`text-right ${disponible < 0 ? "text-destructive" : "text-success"}`}>
                          {formatPrice(disponible)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{formatDate(ultimoPagoByClient.get(c.id) || null)}</TableCell>
                        <TableCell><Badge variant={est.variant}>{est.label}</Badge></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </TabsContent>

        <TabsContent value="transactions" className="space-y-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Buscar por cliente o referencia..." className="pl-9" value={searchTrx} onChange={(e) => setSearchTrx(e.target.value)} />
          </div>
          <div className="rounded-xl border border-border bg-card shadow-sm">
            {loading ? (
              <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
            ) : movimientosFiltrados.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">No hay movimientos registrados</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead>Método</TableHead>
                    <TableHead>Referencia</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movimientosFiltrados.map((m) => (
                    <TableRow key={`${m.tipo}-${m.id}`} className="hover:bg-muted/50">
                      <TableCell className="text-muted-foreground">{formatDate(m.fecha)}</TableCell>
                      <TableCell className="font-medium">{m.cliente}</TableCell>
                      <TableCell>
                        <Badge variant={m.tipo === "pago" ? "default" : "destructive"}>{m.tipo === "pago" ? "Pago" : "Cargo"}</Badge>
                      </TableCell>
                      <TableCell className={`text-right font-semibold ${m.tipo === "pago" ? "text-success" : "text-destructive"}`}>
                        {m.tipo === "pago" ? "+" : "-"}{formatPrice(m.monto)}
                      </TableCell>
                      <TableCell className="text-muted-foreground capitalize">{m.metodo.replace("_", " ")}</TableCell>
                      <TableCell className="font-mono text-sm text-primary">{m.referencia}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Registrar Pago */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Registrar pago</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Cliente</Label>
              <Select value={payForm.cliente_id} onValueChange={(v) => setPayForm((f) => ({ ...f, cliente_id: v, orden_id: "" }))}>
                <SelectTrigger><SelectValue placeholder="Selecciona el cliente" /></SelectTrigger>
                <SelectContent>
                  {clientes.map((c) => <SelectItem key={c.id} value={c.id}>{c.nombre_negocio}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {payForm.cliente_id && ordenesPendientesDelCliente.length > 0 && (
              <div>
                <Label>Orden (opcional)</Label>
                <Select value={payForm.orden_id} onValueChange={(v) => setPayForm((f) => ({ ...f, orden_id: v, monto: ordenesPendientesDelCliente.find((o) => o.id === v)?.total?.toString() || f.monto }))}>
                  <SelectTrigger><SelectValue placeholder="Aplicar a una orden" /></SelectTrigger>
                  <SelectContent>
                    {ordenesPendientesDelCliente.map((o) => <SelectItem key={o.id} value={o.id}>{o.numero} — {formatPrice(Number(o.total))}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>Banco / cuenta que recibe</Label>
              <Select value={payForm.banco_id} onValueChange={(v) => {
                const b = bancos.find((x) => x.id === v);
                const nextTasa = b?.moneda === "BS" && exchangeRate > 0 ? String(exchangeRate) : "";
                setPayForm((f) => ({ ...f, banco_id: v, tasa: nextTasa }));
              }}>
                <SelectTrigger><SelectValue placeholder="Efectivo (sin banco)" /></SelectTrigger>
                <SelectContent>
                  {bancos.map((b) => <SelectItem key={b.id} value={b.id}>{b.nombre} · {b.moneda === "USD" ? "USD $" : "Bs."} · {b.metodo_pago.replace("_", " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{esBS ? "Monto recibido (Bs.)" : "Monto recibido (USD $)"}</Label>
              <Input type="number" min="0" step="0.01" value={payForm.monto} onChange={(e) => setPayForm((f) => ({ ...f, monto: e.target.value }))} placeholder="0.00" />
            </div>
            {esBS && (
              <div>
                <div className="flex items-center justify-between">
                  <Label>Tasa de cambio (Bs. por 1 USD)</Label>
                  <span className="text-[11px] text-muted-foreground">Tasa BCV precargada</span>
                </div>
                <Input type="number" min="0" step="0.01" value={payForm.tasa} onChange={(e) => setPayForm((f) => ({ ...f, tasa: e.target.value }))} placeholder="Ej. 400" />
                {payForm.monto && payForm.tasa && Number(payForm.tasa) > 0 && (
                  <div className="mt-2 flex items-center justify-between rounded-md bg-muted/60 px-3 py-2">
                    <span className="text-xs text-muted-foreground">Equivale a</span>
                    <span className="text-sm font-semibold">{formatPrice(Number(payForm.monto) / Number(payForm.tasa))}</span>
                  </div>
                )}
              </div>
            )}
            <div>
              <Label>Referencia</Label>
              <Input value={payForm.referencia} onChange={(e) => setPayForm((f) => ({ ...f, referencia: e.target.value }))} placeholder="Nro. de referencia (opcional)" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={registrarPago} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Registrar pago"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
};

export default Cuentas;
