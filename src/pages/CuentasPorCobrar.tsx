import { useEffect, useMemo, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Search, Loader2, HandCoins, Wallet, Users, FilePlus, Eye, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/hooks/use-toast";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";

interface OrdenLite { id: string; numero: string; cliente_id: string; total: number; monto_pagado: number; estado_pago: string; fecha: string; }
interface Banco { id: string; nombre: string; moneda: string; metodo_pago: string; metodos: string[] | null; }

const metodoLabel: Record<string, string> = {
  transferencia: "Transferencia", efectivo: "Efectivo", pago_movil: "Pago Móvil", credito: "Crédito", tarjeta: "Tarjeta",
};
interface Deudor { cliente_id: string; nombre: string; docs: number; saldo: number; }
interface Cobro { id: string; numero: string; monto: number; monto_moneda: number; moneda: string; created_at: string; cliente?: { nombre_negocio: string } | null; banco?: { nombre: string } | null; }
interface CuentaManual { id: string; numero: string; cliente_id: string; concepto: string; monto: number; monto_pagado: number; estado_pago: string; fecha: string; }
interface PagoPendiente { id: string; numero: string; monto: number; monto_moneda: number | null; moneda: string; metodo: string; referencia: string | null; comprobante_url: string | null; banco_id: string | null; created_at: string; cliente?: { nombre_negocio: string } | null; orden?: { numero: string } | null; }

const CuentasPorCobrar = () => {
  const { formatPrice, exchangeRate } = useCurrency();
  const { toast } = useToast();
  const [ordenes, setOrdenes] = useState<OrdenLite[]>([]);
  const [clientes, setClientes] = useState<Record<string, string>>({});
  const [bancos, setBancos] = useState<Banco[]>([]);
  const [cobros, setCobros] = useState<Cobro[]>([]);
  const [cuentas, setCuentas] = useState<CuentaManual[]>([]);
  const [pendientes, setPendientes] = useState<PagoPendiente[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  // Verificación de pagos pendientes
  const [verif, setVerif] = useState<PagoPendiente | null>(null);
  const [verifForm, setVerifForm] = useState({ banco_id: "", notas: "" });
  const [verifSaving, setVerifSaving] = useState(false);

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ cliente_id: "", banco_id: "", metodo: "", monto: 0, tasa: 0, referencia: "", notas: "" });

  const [openCxc, setOpenCxc] = useState(false);
  const [savingCxc, setSavingCxc] = useState(false);
  const [cxcForm, setCxcForm] = useState({ cliente_id: "", concepto: "", monto: 0, fecha: "" });

  const fetchAll = async () => {
    setLoading(true);
    const [{ data: ords }, { data: clis }, { data: bcs }, { data: cbs }, { data: cxc }, { data: pend }] = await Promise.all([
      supabase.from("ordenes").select("id, numero, cliente_id, total, monto_pagado, estado_pago, fecha_pedido, created_at").neq("estado", "cancelado"),
      supabase.from("clientes").select("id, nombre_negocio").order("nombre_negocio"),
      supabase.from("bancos").select("id, nombre, moneda, metodo_pago, metodos").eq("activo", true).order("nombre"),
      supabase.from("pagos").select("id, numero, monto, monto_moneda, moneda, created_at, cliente:clientes(nombre_negocio), banco:bancos(nombre)").eq("estado", "verificado").order("created_at", { ascending: false }).limit(5000),
      supabase.from("cuentas_cobrar").select("id, numero, cliente_id, concepto, monto, monto_pagado, estado_pago, fecha").order("fecha", { ascending: false }),
      supabase.from("pagos").select("id, numero, monto, monto_moneda, moneda, metodo, referencia, comprobante_url, banco_id, created_at, cliente:clientes(nombre_negocio), orden:ordenes(numero)").eq("estado", "pendiente").order("created_at", { ascending: false }),
    ]);
    setOrdenes(((ords as (OrdenLite & { fecha_pedido: string | null; created_at: string })[]) ?? []).map((o) => ({ ...o, fecha: o.fecha_pedido || o.created_at })));
    setClientes(Object.fromEntries(((clis as { id: string; nombre_negocio: string }[]) ?? []).map((c) => [c.id, c.nombre_negocio])));
    setBancos((bcs as Banco[]) ?? []);
    setCobros((cbs as Cobro[]) ?? []);
    setCuentas((cxc as CuentaManual[]) ?? []);
    setPendientes((pend as PagoPendiente[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { fetchAll(); }, []);

  const deudores = useMemo(() => {
    const m = new Map<string, Deudor>();
    const add = (cli: string, saldo: number) => {
      if (saldo <= 0.009) return;
      const d = m.get(cli) || { cliente_id: cli, nombre: clientes[cli] || "—", docs: 0, saldo: 0 };
      d.docs += 1; d.saldo += saldo;
      m.set(cli, d);
    };
    for (const o of ordenes) add(o.cliente_id, Number(o.total) - Number(o.monto_pagado || 0));
    for (const c of cuentas) if (c.estado_pago !== "anulada") add(c.cliente_id, Number(c.monto) - Number(c.monto_pagado || 0));
    return [...m.values()].sort((a, b) => b.saldo - a.saldo);
  }, [ordenes, cuentas, clientes]);

  const clientesLista = useMemo(() => Object.entries(clientes).map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre)), [clientes]);

  const crearCuenta = async () => {
    if (!cxcForm.cliente_id || !cxcForm.concepto.trim() || !cxcForm.monto || cxcForm.monto <= 0) {
      toast({ title: "Faltan datos", description: "Cliente, concepto y monto (USD) son requeridos.", variant: "destructive" });
      return;
    }
    setSavingCxc(true);
    const { error } = await supabase.from("cuentas_cobrar").insert({
      cliente_id: cxcForm.cliente_id, concepto: cxcForm.concepto.trim(), monto: cxcForm.monto,
      fecha: cxcForm.fecha || undefined, origen: "manual",
    });
    setSavingCxc(false);
    if (error) { toast({ title: "No se pudo crear", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Cuenta por cobrar creada", description: `${formatPrice(cxcForm.monto)} para ${clientes[cxcForm.cliente_id]}` });
    setOpenCxc(false);
    fetchAll();
  };

  const totalPorCobrar = deudores.reduce((s, d) => s + d.saldo, 0);
  const filtrados = deudores.filter((d) => d.nombre.toLowerCase().includes(q.toLowerCase()));
  const pgDeud = usePagination(filtrados, 25);
  const pgCobros = usePagination(cobros, 25);
  const pgCuentas = usePagination(cuentas, 25);

  const bancoSel = bancos.find((b) => b.id === form.banco_id);
  const esBs = bancoSel?.moneda === "BS";
  const metodosBanco = bancoSel?.metodos?.length ? bancoSel.metodos : bancoSel ? [bancoSel.metodo_pago] : [];
  const saldoCliente = deudores.find((d) => d.cliente_id === form.cliente_id)?.saldo ?? 0;

  // Documentos pendientes del cliente en el MISMO orden que registrar_cobro (FIFO por fecha, órdenes + cuentas)
  const docsClienteFifo = useMemo(() => {
    if (!form.cliente_id) return [] as { numero: string; tipo: string; saldo: number; fecha: string }[];
    const docs: { numero: string; tipo: string; saldo: number; fecha: string }[] = [];
    for (const o of ordenes) {
      const saldo = Number(o.total) - Number(o.monto_pagado || 0);
      if (o.cliente_id === form.cliente_id && saldo > 0.009) docs.push({ numero: o.numero, tipo: "Orden", saldo, fecha: o.fecha });
    }
    for (const c of cuentas) {
      const saldo = Number(c.monto) - Number(c.monto_pagado || 0);
      if (c.cliente_id === form.cliente_id && c.estado_pago !== "anulada" && saldo > 0.009) docs.push({ numero: c.numero, tipo: "Cuenta", saldo, fecha: c.fecha });
    }
    return docs.sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());
  }, [form.cliente_id, ordenes, cuentas]);

  const montoUSD = esBs ? (form.tasa > 0 ? form.monto / form.tasa : 0) : form.monto;
  const previewAdjudicacion = useMemo(() => {
    let rest = montoUSD;
    const rows = docsClienteFifo.map((d) => {
      const aplicado = Math.max(0, Math.min(rest, d.saldo));
      rest = Math.round((rest - aplicado) * 100) / 100;
      const estado = aplicado <= 0.009 ? "pendiente" : aplicado >= d.saldo - 0.009 ? "cubierto" : "parcial";
      return { ...d, aplicado, estado };
    });
    return { rows, aFavor: Math.round(rest * 100) / 100, tocados: rows.filter((r) => r.aplicado > 0.009).length };
  }, [docsClienteFifo, montoUSD]);

  const abrirCobro = (cliente_id?: string) => {
    setForm({ cliente_id: cliente_id || "", banco_id: "", metodo: "", monto: 0, tasa: Math.round(exchangeRate * 100) / 100, referencia: "", notas: "" });
    setOpen(true);
  };

  const elegirBanco = (banco_id: string) => {
    const b = bancos.find((x) => x.id === banco_id);
    const ms = b?.metodos?.length ? b.metodos : b ? [b.metodo_pago] : [];
    setForm((f) => ({ ...f, banco_id, metodo: ms[0] || "transferencia" }));
  };

  const registrar = async () => {
    if (!form.cliente_id || !form.banco_id || !form.monto || form.monto <= 0) {
      toast({ title: "Faltan datos", description: "Elegí cliente, banco y un monto válido.", variant: "destructive" });
      return;
    }
    if (esBs && (!form.tasa || form.tasa <= 0)) {
      toast({ title: "Falta la tasa", description: "Un pago en bolívares necesita la tasa Bs/USD.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.rpc("registrar_cobro", {
      p_cliente_id: form.cliente_id,
      p_banco_id: form.banco_id,
      p_monto_moneda: form.monto,
      p_moneda: bancoSel?.moneda || "USD",
      p_tasa: esBs ? form.tasa : null,
      p_metodo: form.metodo || metodosBanco[0] || "transferencia",
      p_referencia: form.referencia || null,
      p_notas: form.notas || null,
    });
    setSaving(false);
    if (error) {
      toast({ title: "No se pudo registrar el cobro", description: error.message, variant: "destructive" });
      return;
    }
    const r = data as { ordenes_afectadas: number; credito_a_favor: number; monto_usd: number };
    toast({
      title: "Cobro registrado",
      description: `$${r.monto_usd} adjudicado a ${r.ordenes_afectadas} orden(es)` + (r.credito_a_favor > 0 ? ` · saldo a favor: ${formatPrice(r.credito_a_favor)}` : ""),
    });
    setOpen(false);
    fetchAll();
  };

  const pgPend = usePagination(pendientes, 25);

  const abrirVerif = (p: PagoPendiente) => {
    setVerif(p);
    setVerifForm({ banco_id: p.banco_id || "", notas: "" });
  };

  const verComprobante = async (path: string) => {
    const { data, error } = await supabase.storage.from("documentos").createSignedUrl(path, 120);
    if (error || !data?.signedUrl) { toast({ title: "No se pudo abrir el comprobante", description: error?.message, variant: "destructive" }); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const decidirVerif = async (aprobar: boolean) => {
    if (!verif) return;
    setVerifSaving(true);
    const { error } = await supabase.rpc("verificar_pago", {
      p_pago_id: verif.id,
      p_aprobar: aprobar,
      p_notas: verifForm.notas || null,
      p_banco_id: aprobar ? (verifForm.banco_id || null) : null,
    });
    setVerifSaving(false);
    if (error) { toast({ title: "No se pudo procesar", description: error.message, variant: "destructive" }); return; }
    toast({
      title: aprobar ? "Pago verificado" : "Pago rechazado",
      description: aprobar ? "Se adjudicó a la deuda del cliente (más antiguo primero)." : "El pago quedó rechazado.",
    });
    setVerif(null);
    fetchAll();
  };

  return (
    <MainLayout title="Cuentas por Cobrar">
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-destructive/10 p-2"><Wallet className="h-5 w-5 text-destructive" /></div>
            <div><p className="text-2xl font-bold">{formatPrice(totalPorCobrar)}</p><p className="text-sm text-muted-foreground">Total por cobrar</p></div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-warning/10 p-2"><Users className="h-5 w-5 text-warning" /></div>
            <div><p className="text-2xl font-bold">{deudores.length}</p><p className="text-sm text-muted-foreground">Clientes con deuda</p></div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-success/10 p-2"><HandCoins className="h-5 w-5 text-success" /></div>
            <div><p className="text-2xl font-bold">{cobros.length}</p><p className="text-sm text-muted-foreground">Cobros registrados</p></div>
          </div>
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar cliente..." className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={() => { setCxcForm({ cliente_id: "", concepto: "", monto: 0, fecha: "" }); setOpenCxc(true); }}>
            <FilePlus className="h-4 w-4" /> Nueva cuenta por cobrar
          </Button>
          <Button className="gap-2" onClick={() => abrirCobro()}><HandCoins className="h-4 w-4" /> Registrar Cobro</Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : (
        <Tabs defaultValue="cobrar">
          <TabsList>
            <TabsTrigger value="cobrar">Por cobrar ({deudores.length})</TabsTrigger>
            <TabsTrigger value="manuales">Cuentas manuales ({cuentas.length})</TabsTrigger>
            <TabsTrigger value="cobros">Recibos ({cobros.length})</TabsTrigger>
            <TabsTrigger value="verificar" className="gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" /> Por verificar
              {pendientes.length > 0 && <Badge variant="destructive" className="ml-1 px-1.5">{pendientes.length}</Badge>}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="verificar" className="mt-4">
            <div className="rounded-xl border border-border bg-card shadow-sm">
              {pendientes.length === 0 ? (
                <p className="p-8 text-center text-muted-foreground">No hay pagos por verificar. Los pagos reportados por clientes y vendedores aparecen aquí.</p>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nº</TableHead><TableHead>Cliente</TableHead><TableHead>Orden</TableHead>
                        <TableHead>Método</TableHead><TableHead>Referencia</TableHead>
                        <TableHead className="text-right">Monto</TableHead><TableHead>Fecha</TableHead>
                        <TableHead className="text-right">Acción</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pgPend.pageItems.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-mono text-sm text-primary">{p.numero}</TableCell>
                          <TableCell className="font-medium">{p.cliente?.nombre_negocio || "—"}</TableCell>
                          <TableCell className="text-muted-foreground">{p.orden?.numero || "—"}</TableCell>
                          <TableCell>{metodoLabel[p.metodo] || p.metodo}</TableCell>
                          <TableCell className="font-mono text-sm text-muted-foreground">{p.referencia || "—"}</TableCell>
                          <TableCell className="text-right font-semibold">{formatPrice(p.monto)}</TableCell>
                          <TableCell className="text-muted-foreground">{new Date(p.created_at).toLocaleDateString("es-VE")}</TableCell>
                          <TableCell className="text-right">
                            <Button size="sm" onClick={() => abrirVerif(p)}>Verificar</Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <DataTablePagination pagination={pgPend} />
                </>
              )}
            </div>
          </TabsContent>

          <TabsContent value="cobrar" className="mt-4">
            <div className="rounded-xl border border-border bg-card shadow-sm">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead className="text-center">Documentos</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                    <TableHead className="text-right">Acción</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pgDeud.pageItems.map((d) => (
                    <TableRow key={d.cliente_id}>
                      <TableCell className="font-medium">{d.nombre}</TableCell>
                      <TableCell className="text-center">{d.docs}</TableCell>
                      <TableCell className="text-right font-semibold text-destructive">{formatPrice(d.saldo)}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => abrirCobro(d.cliente_id)}>Registrar cobro</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <DataTablePagination pagination={pgDeud} />
            </div>
          </TabsContent>

          <TabsContent value="manuales" className="mt-4">
            <div className="rounded-xl border border-border bg-card shadow-sm">
              {cuentas.length === 0 ? (
                <p className="p-8 text-center text-muted-foreground">No hay cuentas por cobrar manuales. Creá una con "Nueva cuenta por cobrar".</p>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nº</TableHead><TableHead>Cliente</TableHead><TableHead>Concepto</TableHead>
                        <TableHead>Fecha</TableHead><TableHead>Estado</TableHead>
                        <TableHead className="text-right">Monto</TableHead><TableHead className="text-right">Saldo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pgCuentas.pageItems.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell className="font-mono text-sm text-primary">{c.numero}</TableCell>
                          <TableCell className="font-medium">{clientes[c.cliente_id] || "—"}</TableCell>
                          <TableCell className="text-muted-foreground">{c.concepto}</TableCell>
                          <TableCell className="text-muted-foreground">{new Date(c.fecha).toLocaleDateString("es-VE")}</TableCell>
                          <TableCell>
                            <Badge variant={c.estado_pago === "pagado" ? "default" : c.estado_pago === "parcial" ? "outline" : "secondary"}>{c.estado_pago}</Badge>
                          </TableCell>
                          <TableCell className="text-right">{formatPrice(c.monto)}</TableCell>
                          <TableCell className="text-right font-semibold text-destructive">{formatPrice(Number(c.monto) - Number(c.monto_pagado || 0))}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <DataTablePagination pagination={pgCuentas} />
                </>
              )}
            </div>
          </TabsContent>

          <TabsContent value="cobros" className="mt-4">
            <div className="rounded-xl border border-border bg-card shadow-sm">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nº</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Banco</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead className="text-right">USD</TableHead>
                    <TableHead>Fecha</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pgCobros.pageItems.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono text-sm text-primary">{c.numero}</TableCell>
                      <TableCell className="font-medium">{c.cliente?.nombre_negocio || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{c.banco?.nombre || "—"}</TableCell>
                      <TableCell className="text-right">{Number(c.monto_moneda).toLocaleString("es-VE")} {c.moneda}</TableCell>
                      <TableCell className="text-right font-semibold">{formatPrice(c.monto)}</TableCell>
                      <TableCell className="text-muted-foreground">{new Date(c.created_at).toLocaleDateString("es-VE")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <DataTablePagination pagination={pgCobros} />
            </div>
          </TabsContent>
        </Tabs>
      )}

      {/* Registrar cobro */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Registrar Cobro</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Cliente *</Label>
              <Select value={form.cliente_id} onValueChange={(v) => setForm({ ...form, cliente_id: v })}>
                <SelectTrigger><SelectValue placeholder="Seleccionar cliente con deuda" /></SelectTrigger>
                <SelectContent>
                  {deudores.map((d) => (
                    <SelectItem key={d.cliente_id} value={d.cliente_id}>{d.nombre} — {formatPrice(d.saldo)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.cliente_id && <p className="text-xs text-muted-foreground">Saldo pendiente: <span className="font-semibold text-destructive">{formatPrice(saldoCliente)}</span> — se adjudica de la orden más antigua a la más nueva.</p>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Banco *</Label>
                <Select value={form.banco_id} onValueChange={elegirBanco}>
                  <SelectTrigger><SelectValue placeholder="Seleccionar banco" /></SelectTrigger>
                  <SelectContent>
                    {bancos.map((b) => (
                      <SelectItem key={b.id} value={b.id}>{b.nombre} ({b.moneda})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Método *</Label>
                <Select value={form.metodo} onValueChange={(v) => setForm({ ...form, metodo: v })} disabled={!form.banco_id}>
                  <SelectTrigger><SelectValue placeholder={form.banco_id ? "Método" : "Elegí un banco"} /></SelectTrigger>
                  <SelectContent>
                    {metodosBanco.map((m) => (
                      <SelectItem key={m} value={m}>{metodoLabel[m] || m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Monto ({bancoSel?.moneda || "—"}) *</Label>
                <Input type="number" step="0.01" min="0" value={form.monto || ""} onChange={(e) => setForm({ ...form, monto: parseFloat(e.target.value) || 0 })} />
              </div>
              {esBs && (
                <div className="space-y-2">
                  <Label>Tasa (Bs/USD) *</Label>
                  <Input type="number" step="0.01" min="0" value={form.tasa || ""} onChange={(e) => setForm({ ...form, tasa: parseFloat(e.target.value) || 0 })} />
                </div>
              )}
            </div>
            {esBs && form.monto > 0 && form.tasa > 0 && (
              <p className="text-xs text-muted-foreground">Equivale a <span className="font-semibold">{formatPrice(form.monto / form.tasa)}</span></p>
            )}

            {/* Preview de adjudicación (un pago que abarca varias órdenes, más antiguo primero) */}
            {form.cliente_id && montoUSD > 0.009 && (
              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  Adjudicación automática · del documento más antiguo al más nuevo:
                </p>
                {previewAdjudicacion.tocados === 0 ? (
                  <p className="text-xs text-muted-foreground">Este cliente no tiene documentos pendientes.</p>
                ) : (
                  <div className="max-h-40 space-y-1.5 overflow-y-auto">
                    {previewAdjudicacion.rows.filter((r) => r.aplicado > 0.009).map((r, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <span className="font-mono text-xs text-primary">{r.numero}</span>
                        <span className="text-[11px] text-muted-foreground">{r.tipo}</span>
                        <span className="ml-auto tabular-nums">{formatPrice(r.aplicado)}<span className="text-muted-foreground"> / {formatPrice(r.saldo)}</span></span>
                        <Badge variant={r.estado === "cubierto" ? "default" : "outline"} className="shrink-0">
                          {r.estado === "cubierto" ? "Cubierta" : "Parcial"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
                {previewAdjudicacion.aFavor > 0.009 && (
                  <p className="mt-2 border-t border-border pt-2 text-xs">
                    Sobrante (saldo a favor del cliente): <span className="font-semibold">{formatPrice(previewAdjudicacion.aFavor)}</span>
                  </p>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label>Referencia</Label>
              <Input value={form.referencia} onChange={(e) => setForm({ ...form, referencia: e.target.value })} placeholder="Nº de transferencia / referencia" />
            </div>
            <div className="space-y-2">
              <Label>Notas</Label>
              <Textarea value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={registrar} disabled={saving} className="gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Registrar Cobro
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Nueva cuenta por cobrar manual */}
      <Dialog open={openCxc} onOpenChange={setOpenCxc}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Nueva Cuenta por Cobrar</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Cliente *</Label>
              <Select value={cxcForm.cliente_id} onValueChange={(v) => setCxcForm({ ...cxcForm, cliente_id: v })}>
                <SelectTrigger><SelectValue placeholder="Seleccionar cliente" /></SelectTrigger>
                <SelectContent>
                  {clientesLista.map((c) => (<SelectItem key={c.id} value={c.id}>{c.nombre}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Concepto *</Label>
              <Input value={cxcForm.concepto} onChange={(e) => setCxcForm({ ...cxcForm, concepto: e.target.value })} placeholder="Ej. Ajuste, servicio, saldo anterior…" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Monto (USD) *</Label>
                <Input type="number" step="0.01" min="0" value={cxcForm.monto || ""} onChange={(e) => setCxcForm({ ...cxcForm, monto: parseFloat(e.target.value) || 0 })} />
              </div>
              <div className="space-y-2">
                <Label>Fecha</Label>
                <Input type="date" value={cxcForm.fecha} onChange={(e) => setCxcForm({ ...cxcForm, fecha: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenCxc(false)}>Cancelar</Button>
            <Button onClick={crearCuenta} disabled={savingCxc} className="gap-2">{savingCxc && <Loader2 className="h-4 w-4 animate-spin" />} Crear</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Verificar pago pendiente */}
      <Dialog open={!!verif} onOpenChange={(o) => !o && setVerif(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Verificar pago {verif?.numero}</DialogTitle></DialogHeader>
          {verif && (
            <div className="space-y-4 py-2">
              <div className="space-y-1 rounded-lg border bg-muted/40 p-3 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Cliente</span><span className="font-medium">{verif.cliente?.nombre_negocio || "—"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Orden</span><span>{verif.orden?.numero || "— (se adjudica FIFO)"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Monto</span><span className="font-semibold">{formatPrice(verif.monto)}{verif.moneda !== "USD" && verif.monto_moneda ? ` · ${Number(verif.monto_moneda).toLocaleString("es-VE")} ${verif.moneda}` : ""}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Método</span><span>{metodoLabel[verif.metodo] || verif.metodo}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Referencia</span><span className="font-mono">{verif.referencia || "—"}</span></div>
              </div>
              {verif.comprobante_url && (
                <Button variant="outline" size="sm" className="gap-2" onClick={() => verComprobante(verif.comprobante_url!)}>
                  <Eye className="h-4 w-4" /> Ver comprobante
                </Button>
              )}
              <div className="space-y-2">
                <Label>Banco donde ingresó (opcional)</Label>
                <Select value={verifForm.banco_id} onValueChange={(v) => setVerifForm((f) => ({ ...f, banco_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Sin banco / asignar luego" /></SelectTrigger>
                  <SelectContent>{bancos.map((b) => <SelectItem key={b.id} value={b.id}>{b.nombre} ({b.moneda})</SelectItem>)}</SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Si elegís banco, se registra el movimiento de entrada. Al aprobar, el monto se adjudica a la deuda del cliente (más antiguo primero).</p>
              </div>
              <div className="space-y-2"><Label>Notas</Label><Textarea rows={2} value={verifForm.notas} onChange={(e) => setVerifForm((f) => ({ ...f, notas: e.target.value }))} placeholder="Opcional (motivo de rechazo, observaciones…)" /></div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="destructive" onClick={() => decidirVerif(false)} disabled={verifSaving}>Rechazar</Button>
            <Button onClick={() => decidirVerif(true)} disabled={verifSaving} className="gap-2">{verifSaving && <Loader2 className="h-4 w-4 animate-spin" />} Aprobar y adjudicar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
};

export default CuentasPorCobrar;
