import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
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
import { HandCoins, Search, DollarSign, TrendingUp, TrendingDown, Users, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/hooks/use-toast";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { SelectorFacturas, type FacturaSaldo } from "@/components/cuentas/SelectorFacturas";

interface ClienteCuenta {
  id: string;
  codigo: string | null;
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
  monto_moneda: number;
  moneda: string;
  metodo: string;
  referencia: string | null;
  estado: string;
  created_at: string;
  fecha_verificacion: string | null;
  banco?: { nombre: string } | null;
}
interface FacturaRow {
  id: string;
  numero: string;
  cliente_id: string;
  tipo: string;
  fecha_emision: string | null;
  total_usd: number;
  saldo_usd: number;
  estado_cobro: string;
}
interface Banco { id: string; nombre: string; metodo_pago: string; metodos: string[] | null; moneda: string; }

const metodoLabel: Record<string, string> = {
  transferencia: "Transferencia", efectivo: "Efectivo", pago_movil: "Pago Móvil", credito: "Crédito", tarjeta: "Tarjeta",
};

const Cuentas = () => {
  const { formatPrice } = useCurrency();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [clientes, setClientes] = useState<ClienteCuenta[]>([]);
  const [pagos, setPagos] = useState<PagoRow[]>([]);
  const [facturas, setFacturas] = useState<FacturaRow[]>([]);
  const [bancos, setBancos] = useState<Banco[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchAcc, setSearchAcc] = useState("");
  const [searchTrx, setSearchTrx] = useState("");

  // Registrar cobro
  const [payOpen, setPayOpen] = useState(false);
  const [payForm, setPayForm] = useState({ cliente_id: "", banco_id: "", metodo: "", monto: "", tasa: "", referencia: "" });
  const [asignaciones, setAsignaciones] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    setLoading(true);
    const [cRes, pRes, fRes, bRes] = await Promise.all([
      supabase.from("clientes").select("id, codigo, nombre_negocio, limite_credito, credito_utilizado, dias_credito"),
      supabase.from("pagos").select("id, numero, cliente_id, monto, monto_moneda, moneda, metodo, referencia, estado, created_at, fecha_verificacion, banco:bancos(nombre)").order("created_at", { ascending: false }).limit(5000),
      supabase.from("facturas").select("id, numero, cliente_id, tipo, fecha_emision, total_usd, saldo_usd, estado_cobro").eq("estado", "posted"),
      supabase.from("bancos").select("id, nombre, metodo_pago, metodos, moneda").eq("activo", true).order("nombre"),
    ]);
    if (cRes.data) setClientes(cRes.data as ClienteCuenta[]);
    if (pRes.data) setPagos(pRes.data as unknown as PagoRow[]);
    if (fRes.data) setFacturas(fRes.data as FacturaRow[]);
    if (bRes.data) setBancos(bRes.data as Banco[]);
    setLoading(false);
  };

  const clientesMap = useMemo(() => Object.fromEntries(clientes.map((c) => [c.id, c.nombre_negocio])), [clientes]);

  // Deuda real por cliente = suma de saldo_usd de sus facturas (las notas de crédito restan solas, por el signo)
  const deudaCliente = useMemo(() => {
    const m = new Map<string, { saldo: number; docs: number }>();
    for (const f of facturas) {
      if (Math.abs(f.saldo_usd) <= 0.009) continue;
      const d = m.get(f.cliente_id) || { saldo: 0, docs: 0 };
      d.saldo += Number(f.saldo_usd); d.docs += 1; m.set(f.cliente_id, d);
    }
    return m;
  }, [facturas]);

  const ultimoPagoByClient = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of pagos) {
      if (p.estado !== "verificado") continue;
      const f = p.fecha_verificacion || p.created_at;
      const prev = m.get(p.cliente_id);
      if (!prev || new Date(f) > new Date(prev)) m.set(p.cliente_id, f);
    }
    return m;
  }, [pagos]);

  const estadoCuenta = (c: ClienteCuenta, saldo: number): { label: string; variant: "default" | "secondary" | "destructive" } => {
    if (Number(c.limite_credito) > 0 && saldo > Number(c.limite_credito)) return { label: "Excedido", variant: "destructive" };
    if (saldo > 0.009) return { label: "Con deuda", variant: "secondary" };
    return { label: "Al día", variant: "default" };
  };

  // KPIs (data real)
  const totalPorCobrar = useMemo(() => [...deudaCliente.values()].reduce((s, d) => s + d.saldo, 0), [deudaCliente]);
  const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const cobradoMes = pagos
    .filter((p) => p.estado === "verificado")
    .filter((p) => { const f = p.fecha_verificacion || p.created_at; return f && new Date(f).getTime() >= inicioMes; })
    .reduce((s, p) => s + Number(p.monto || 0), 0);
  const clientesConDeuda = deudaCliente.size;

  const formatDate = (s: string | null) => (s ? new Date(s).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }) : "—");

  // Estado de cuentas: clientes ordenados por deuda real desc
  const cuentasCliente = useMemo(() => clientes
    .map((c) => ({ c, ...(deudaCliente.get(c.id) || { saldo: 0, docs: 0 }) }))
    .sort((a, b) => b.saldo - a.saldo), [clientes, deudaCliente]);

  // Movimientos (libro de cuenta): cobros verificados (+), facturas de tipo factura (cargo −), notas de crédito (crédito +)
  const movimientos = useMemo(() => [
    ...pagos.filter((p) => p.estado === "verificado").map((p) => ({
      id: p.id, fecha: p.fecha_verificacion || p.created_at, cliente: clientesMap[p.cliente_id] || "—",
      tipo: "pago" as const, monto: Number(p.monto), metodo: metodoLabel[p.metodo] || p.metodo, referencia: p.numero,
    })),
    ...facturas.filter((f) => f.tipo === "factura").map((f) => ({
      id: f.id, fecha: f.fecha_emision || "", cliente: clientesMap[f.cliente_id] || "—",
      tipo: "cargo" as const, monto: Number(f.total_usd), metodo: "Factura", referencia: f.numero,
    })),
    ...facturas.filter((f) => f.tipo === "nota_credito").map((f) => ({
      id: f.id, fecha: f.fecha_emision || "", cliente: clientesMap[f.cliente_id] || "—",
      tipo: "pago" as const, monto: Math.abs(Number(f.total_usd)), metodo: "Nota de crédito", referencia: f.numero,
    })),
  ].sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()), [pagos, facturas, clientesMap]);

  const cuentasFiltradas = cuentasCliente.filter(({ c }) =>
    c.nombre_negocio.toLowerCase().includes(searchAcc.toLowerCase()) || (c.codigo || "").toLowerCase().includes(searchAcc.toLowerCase()));
  const movimientosFiltrados = movimientos.filter((m) =>
    m.cliente.toLowerCase().includes(searchTrx.toLowerCase()) || (m.referencia || "").toLowerCase().includes(searchTrx.toLowerCase()));

  const pagination = usePagination(cuentasFiltradas, 25);
  const pagination2 = usePagination(movimientosFiltrados, 25);

  // Dialog: deudores + banco/método seleccionado
  const deudores = useMemo(() => [...deudaCliente.entries()]
    .map(([id, d]) => ({ id, nombre: clientesMap[id] || "—", saldo: d.saldo }))
    .sort((a, b) => b.saldo - a.saldo), [deudaCliente, clientesMap]);
  const bancoSel = bancos.find((b) => b.id === payForm.banco_id);
  const esBS = bancoSel?.moneda === "BS";
  const metodosBanco = bancoSel?.metodos?.length ? bancoSel.metodos : bancoSel ? [bancoSel.metodo_pago] : [];
  const saldoCliente = deudores.find((d) => d.id === payForm.cliente_id)?.saldo ?? 0;
  const montoUSD = esBS ? (Number(payForm.tasa) > 0 ? Number(payForm.monto) / Number(payForm.tasa) : 0) : Number(payForm.monto) || 0;
  const facturasCliente: FacturaSaldo[] = useMemo(() => facturas
    .filter((f) => f.cliente_id === payForm.cliente_id && f.tipo === "factura" && f.saldo_usd > 0.009)
    .map((f) => ({ id: f.id, numero: f.numero, fecha_emision: f.fecha_emision, saldo_usd: Number(f.saldo_usd) }))
    .sort((a, b) => new Date(a.fecha_emision || 0).getTime() - new Date(b.fecha_emision || 0).getTime()),
    [facturas, payForm.cliente_id]);

  const abrirCobro = () => {
    setPayForm({ cliente_id: "", banco_id: "", metodo: "", monto: "", tasa: "", referencia: "" });
    setAsignaciones({});
    setPayOpen(true);
  };
  const elegirBanco = (banco_id: string) => {
    const b = bancos.find((x) => x.id === banco_id);
    const ms = b?.metodos?.length ? b.metodos : b ? [b.metodo_pago] : [];
    setPayForm((f) => ({ ...f, banco_id, metodo: ms[0] || "transferencia" }));
  };

  const registrarCobro = async () => {
    if (!payForm.cliente_id || !payForm.banco_id || !payForm.monto || Number(payForm.monto) <= 0) {
      toast({ title: "Datos incompletos", description: "Elegí cliente, banco y un monto válido.", variant: "destructive" });
      return;
    }
    if (esBS && (!payForm.tasa || Number(payForm.tasa) <= 0)) {
      toast({ title: "Falta la tasa de cambio", description: "Para un cobro en bolívares indicá la tasa (Bs. por USD).", variant: "destructive" });
      return;
    }
    const asignado = Object.values(asignaciones).reduce((s, v) => s + v, 0);
    if (asignado > montoUSD + 0.01) {
      toast({ title: "La asignación excede el monto", description: "Revisá los montos por factura.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const p_asignaciones = Object.entries(asignaciones).map(([factura_id, monto]) => ({ factura_id, monto }));
    const { data, error } = await supabase.rpc("registrar_cobro_facturas", {
      p_cliente_id: payForm.cliente_id,
      p_banco_id: payForm.banco_id,
      p_monto_moneda: Number(payForm.monto),
      p_moneda: bancoSel?.moneda || "USD",
      p_tasa: esBS ? Number(payForm.tasa) : null,
      p_metodo: payForm.metodo || metodosBanco[0] || "transferencia",
      p_referencia: payForm.referencia || null,
      p_comprobante_url: null,
      p_notas: null,
      p_asignaciones,
    });
    setSaving(false);
    if (error) {
      toast({ title: "No se pudo registrar el cobro", description: error.message, variant: "destructive" });
      return;
    }
    const r = data as { monto_usd: number; facturas_afectadas: number; saldo_a_favor: number };
    toast({
      title: "Cobro registrado",
      description: `$${r.monto_usd} aplicado a ${r.facturas_afectadas} factura(s)` + (r.saldo_a_favor > 0.009 ? ` · saldo a favor: ${formatPrice(r.saldo_a_favor)}` : ""),
    });
    setPayOpen(false);
    fetchAll();
  };

  return (
    <MainLayout title="Estado de Cuentas">
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
            <div className="rounded-lg bg-warning/10 p-2"><Users className="h-5 w-5 text-warning" /></div>
            <div>
              <p className="text-2xl font-bold">{clientesConDeuda}</p>
              <p className="text-sm text-muted-foreground">Clientes con Deuda</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2"><DollarSign className="h-5 w-5 text-primary" /></div>
            <div>
              <p className="text-2xl font-bold">{pagos.filter((p) => p.estado === "verificado").length}</p>
              <p className="text-sm text-muted-foreground">Recibos registrados</p>
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
            <Button className="gap-2" onClick={abrirCobro}>
              <HandCoins className="h-4 w-4" /> Registrar Cobro
            </Button>
          </div>

          <div className="rounded-xl border border-border bg-card shadow-sm">
            {loading ? (
              <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
            ) : cuentasFiltradas.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">No hay clientes</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead className="text-right">Saldo Deudor</TableHead>
                    <TableHead className="text-center">Documentos</TableHead>
                    <TableHead className="text-right">Límite Crédito</TableHead>
                    <TableHead>Último Pago</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagination.pageItems.map(({ c, saldo, docs }) => {
                    const est = estadoCuenta(c, saldo);
                    return (
                      <TableRow key={c.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/admin/cuentas/${c.id}`)}>
                        <TableCell>
                          <p className="font-medium">{c.nombre_negocio}</p>
                          <p className="text-xs text-muted-foreground">{c.codigo || "—"}</p>
                        </TableCell>
                        <TableCell className={`text-right font-semibold ${saldo > 0 ? "text-destructive" : ""}`}>
                          {formatPrice(saldo)}
                        </TableCell>
                        <TableCell className="text-center text-muted-foreground">{docs || "—"}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{formatPrice(Number(c.limite_credito))}</TableCell>
                        <TableCell className="text-muted-foreground">{formatDate(ultimoPagoByClient.get(c.id) || null)}</TableCell>
                        <TableCell><Badge variant={est.variant}>{est.label}</Badge></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
            {!loading && <DataTablePagination pagination={pagination} />}
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
                  {pagination2.pageItems.map((m) => (
                    <TableRow key={`${m.tipo}-${m.id}`} className="hover:bg-muted/50">
                      <TableCell className="text-muted-foreground">{formatDate(m.fecha)}</TableCell>
                      <TableCell className="font-medium">{m.cliente}</TableCell>
                      <TableCell>
                        <Badge variant={m.tipo === "pago" ? "default" : "destructive"}>{m.tipo === "pago" ? "Cobro" : "Cargo"}</Badge>
                      </TableCell>
                      <TableCell className={`text-right font-semibold ${m.tipo === "pago" ? "text-success" : "text-destructive"}`}>
                        {m.tipo === "pago" ? "+" : "-"}{formatPrice(m.monto)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{m.metodo}</TableCell>
                      <TableCell className="font-mono text-sm text-primary">{m.referencia}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {!loading && <DataTablePagination pagination={pagination2} />}
          </div>
        </TabsContent>
      </Tabs>

      {/* Registrar Cobro */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Registrar Cobro</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Cliente *</Label>
              <Select value={payForm.cliente_id} onValueChange={(v) => { setPayForm((f) => ({ ...f, cliente_id: v })); setAsignaciones({}); }}>
                <SelectTrigger><SelectValue placeholder="Seleccionar cliente con deuda" /></SelectTrigger>
                <SelectContent>
                  {deudores.map((d) => <SelectItem key={d.id} value={d.id}>{d.nombre} — {formatPrice(d.saldo)}</SelectItem>)}
                </SelectContent>
              </Select>
              {payForm.cliente_id && <p className="text-xs text-muted-foreground">Saldo pendiente: <span className="font-semibold text-destructive">{formatPrice(saldoCliente)}</span></p>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Banco *</Label>
                <Select value={payForm.banco_id} onValueChange={elegirBanco}>
                  <SelectTrigger><SelectValue placeholder="Seleccionar banco" /></SelectTrigger>
                  <SelectContent>
                    {bancos.map((b) => <SelectItem key={b.id} value={b.id}>{b.nombre} ({b.moneda})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Método *</Label>
                <Select value={payForm.metodo} onValueChange={(v) => setPayForm((f) => ({ ...f, metodo: v }))} disabled={!payForm.banco_id}>
                  <SelectTrigger><SelectValue placeholder={payForm.banco_id ? "Método" : "Elegí un banco"} /></SelectTrigger>
                  <SelectContent>
                    {metodosBanco.map((m) => <SelectItem key={m} value={m}>{metodoLabel[m] || m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{esBS ? "Monto recibido (Bs.)" : "Monto recibido (USD $)"} *</Label>
                <Input type="number" min="0" step="0.01" value={payForm.monto} onChange={(e) => setPayForm((f) => ({ ...f, monto: e.target.value }))} placeholder="0.00" />
              </div>
              {esBS && (
                <div className="space-y-2">
                  <Label>Tasa (Bs/USD) *</Label>
                  <Input type="number" min="0" step="0.01" value={payForm.tasa} onChange={(e) => setPayForm((f) => ({ ...f, tasa: e.target.value }))} placeholder="Ej. 400" />
                </div>
              )}
            </div>
            {esBS && payForm.monto && payForm.tasa && Number(payForm.tasa) > 0 && (
              <p className="text-xs text-muted-foreground">Equivale a <span className="font-semibold">{formatPrice(montoUSD)}</span></p>
            )}

            {payForm.cliente_id && (
              <SelectorFacturas
                facturas={facturasCliente}
                montoDisponible={montoUSD}
                asignaciones={asignaciones}
                onChange={setAsignaciones}
                formatPrice={formatPrice}
              />
            )}

            <div className="space-y-2">
              <Label>Referencia</Label>
              <Input value={payForm.referencia} onChange={(e) => setPayForm((f) => ({ ...f, referencia: e.target.value }))} placeholder="Nro. de referencia (opcional)" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={registrarCobro} disabled={saving} className="gap-2">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Registrar Cobro</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
};

export default Cuentas;
