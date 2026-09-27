import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
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
import { Loader2, HandCoins, FilePlus, Eye, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/hooks/use-toast";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { SelectorFacturas, type FacturaSaldo } from "@/components/cuentas/SelectorFacturas";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { BarraLista } from "@/components/datos/BarraLista";
import { useOrdenTabla, EncabezadoOrdenable, exportarCSV, BotonExportar } from "@/components/datos/tabla";
import { useColumnas } from "@/components/datos/columnas";

interface FacturaRow { id: string; numero: string; cliente_id: string; tipo: string; fecha_emision: string | null; fecha_vencimiento: string | null; saldo_usd: number; }
interface Banco { id: string; nombre: string; moneda: string; metodo_pago: string; metodos: string[] | null; }

const metodoLabel: Record<string, string> = {
  transferencia: "Transferencia", efectivo: "Efectivo", pago_movil: "Pago Móvil", credito: "Crédito", tarjeta: "Tarjeta",
};
// Antigüedad por días de vencimiento; "aFavor" = saldos negativos (notas de crédito sin aplicar); neto = saldo + aFavor
interface Deudor {
  cliente_id: string; nombre: string; docs: number; saldo: number;
  porVencer: number; d30: number; d60: number; d90: number; mas90: number; aFavor: number; neto: number;
}
const TRAMOS = [
  { k: "porVencer", label: "Por vencer" }, { k: "d30", label: "1–30 días" }, { k: "d60", label: "31–60 días" },
  { k: "d90", label: "61–90 días" }, { k: "mas90", label: "+90 días" },
] as const;
interface Cobro { id: string; numero: string; monto: number; monto_moneda: number; moneda: string; created_at: string; cliente?: { nombre_negocio: string } | null; banco?: { nombre: string } | null; }
interface CuentaManual { id: string; numero: string; cliente_id: string; concepto: string; monto: number; monto_pagado: number; estado_pago: string; fecha: string; }
interface PagoPendiente { id: string; numero: string; cliente_id: string; monto: number; monto_moneda: number | null; moneda: string; metodo: string; referencia: string | null; comprobante_url: string | null; banco_id: string | null; created_at: string; cliente?: { nombre_negocio: string } | null; orden?: { numero: string } | null; }
interface Anticipo { pago_id: string; numero: string; cliente_id: string; monto_usd: number; aplicado: number; disponible: number; created_at: string; }

const CuentasPorCobrar = () => {
  const { formatPrice, exchangeRate } = useCurrency();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [facturas, setFacturas] = useState<FacturaRow[]>([]);
  const [clientes, setClientes] = useState<Record<string, string>>({});
  const [bancos, setBancos] = useState<Banco[]>([]);
  const [cobros, setCobros] = useState<Cobro[]>([]);
  const [cuentas, setCuentas] = useState<CuentaManual[]>([]);
  const [pendientes, setPendientes] = useState<PagoPendiente[]>([]);
  const [anticipos, setAnticipos] = useState<Anticipo[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  // Verificación de pagos pendientes
  const [verif, setVerif] = useState<PagoPendiente | null>(null);
  const [verifForm, setVerifForm] = useState({ banco_id: "", notas: "" });
  const [verifAsignaciones, setVerifAsignaciones] = useState<Record<string, number>>({});
  const [verifSaving, setVerifSaving] = useState(false);

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ cliente_id: "", banco_id: "", metodo: "", monto: 0, tasa: 0, referencia: "", notas: "" });
  const [asignaciones, setAsignaciones] = useState<Record<string, number>>({});

  const [openCxc, setOpenCxc] = useState(false);
  const [savingCxc, setSavingCxc] = useState(false);
  const [cxcForm, setCxcForm] = useState({ cliente_id: "", concepto: "", monto: 0, fecha: "" });

  // Aplicar anticipo
  const [aplicarAnt, setAplicarAnt] = useState<Anticipo | null>(null);
  const [antAsignaciones, setAntAsignaciones] = useState<Record<string, number>>({});
  const [antSaving, setAntSaving] = useState(false);

  const fetchAll = async () => {
    setLoading(true);
    const [{ data: facs }, { data: clis }, { data: bcs }, { data: cbs }, { data: cxc }, { data: pend }, { data: ants }] = await Promise.all([
      supabase.from("facturas").select("id, numero, cliente_id, tipo, fecha_emision, fecha_vencimiento, saldo_usd").eq("estado", "posted"),
      supabase.from("clientes").select("id, nombre_negocio").order("nombre_negocio"),
      supabase.from("bancos").select("id, nombre, moneda, metodo_pago, metodos").eq("activo", true).order("nombre"),
      supabase.from("pagos").select("id, numero, monto, monto_moneda, moneda, created_at, cliente:clientes(nombre_negocio), banco:bancos(nombre)").eq("estado", "verificado").order("created_at", { ascending: false }).limit(5000),
      supabase.from("cuentas_cobrar").select("id, numero, cliente_id, concepto, monto, monto_pagado, estado_pago, fecha").order("fecha", { ascending: false }),
      supabase.from("pagos").select("id, numero, cliente_id, monto, monto_moneda, moneda, metodo, referencia, comprobante_url, banco_id, created_at, cliente:clientes(nombre_negocio), orden:ordenes(numero)").eq("estado", "pendiente").order("created_at", { ascending: false }),
      supabase.from("v_anticipos").select("*").order("created_at", { ascending: false }),
    ]);
    setFacturas((facs as FacturaRow[]) ?? []);
    setClientes(Object.fromEntries(((clis as { id: string; nombre_negocio: string }[]) ?? []).map((c) => [c.id, c.nombre_negocio])));
    setBancos((bcs as Banco[]) ?? []);
    setCobros((cbs as unknown as Cobro[]) ?? []);
    setCuentas((cxc as CuentaManual[]) ?? []);
    setPendientes((pend as unknown as PagoPendiente[]) ?? []);
    setAnticipos(((ants as Anticipo[]) ?? []).filter((a) => Number(a.disponible) > 0.009));
    setLoading(false);
  };
  useEffect(() => { fetchAll(); }, []);

  const facturasNormales = useMemo(() => facturas.filter((f) => f.tipo === "factura" && f.saldo_usd > 0.009), [facturas]);

  const deudores = useMemo(() => {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const m = new Map<string, Deudor>();
    const de = (id: string) => m.get(id) || { cliente_id: id, nombre: clientes[id] || "—", docs: 0, saldo: 0,
      porVencer: 0, d30: 0, d60: 0, d90: 0, mas90: 0, aFavor: 0, neto: 0 };
    for (const f of facturas) {
      const saldo = Number(f.saldo_usd);
      if (Math.abs(saldo) <= 0.009) continue;
      const d = de(f.cliente_id);
      if (saldo < 0) { d.aFavor += saldo; }
      else {
        d.docs += 1; d.saldo += saldo;
        const vence = f.fecha_vencimiento || f.fecha_emision;
        const dias = vence ? Math.floor((hoy.getTime() - new Date(`${vence}T00:00:00`).getTime()) / 86400000) : 0;
        if (dias <= 0) d.porVencer += saldo; else if (dias <= 30) d.d30 += saldo; else if (dias <= 60) d.d60 += saldo;
        else if (dias <= 90) d.d90 += saldo; else d.mas90 += saldo;
      }
      d.neto = d.saldo + d.aFavor;
      m.set(f.cliente_id, d);
    }
    return [...m.values()].filter((d) => d.saldo > 0.009).sort((a, b) => b.saldo - a.saldo);
  }, [facturas, clientes]);

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
  // Neto como en Odoo: facturas pendientes menos saldos a favor (notas de crédito sin aplicar) de todos los clientes
  const totalAFavor = facturas.reduce((s, f) => s + (Number(f.saldo_usd) < -0.009 ? Number(f.saldo_usd) : 0), 0);
  const totalNeto = totalPorCobrar + totalAFavor;
  const totalesTramo = TRAMOS.map((t) => ({ ...t, monto: deudores.reduce((s, d) => s + d[t.k], 0) }));
  const filtrados = deudores.filter((d) => d.nombre.toLowerCase().includes(q.toLowerCase()));
  const { ordenadas: deudOrdenados, orden: ordenDeud, alternar: alternarDeud } = useOrdenTabla(filtrados, {
    nombre: (d) => d.nombre, docs: (d) => d.docs, porVencer: (d) => d.porVencer, d30: (d) => d.d30, d60: (d) => d.d60,
    d90: (d) => d.d90, mas90: (d) => d.mas90, saldo: (d) => d.saldo, aFavor: (d) => Math.abs(d.aFavor), neto: (d) => d.neto,
  });
  const pgDeud = usePagination(deudOrdenados, 50);
  const exportarDeudores = () => exportarCSV("cuentas-por-cobrar", deudOrdenados, [
    { titulo: "Cliente", valor: (d) => d.nombre }, { titulo: "Facturas", valor: (d) => d.docs },
    ...TRAMOS.map((t) => ({ titulo: t.label, valor: (d: Deudor) => Number(d[t.k].toFixed(2)) })),
    { titulo: "Saldo", valor: (d) => Number(d.saldo.toFixed(2)) }, { titulo: "A favor", valor: (d) => Number(Math.abs(d.aFavor).toFixed(2)) },
    { titulo: "Neto", valor: (d) => Number(d.neto.toFixed(2)) },
  ]);
  const [tabCxc, setTabCxc] = useState("cobrar");
  const pgCobros = usePagination(cobros, 50);
  const pgCuentas = usePagination(cuentas, 50);
  const pgAnt = usePagination(anticipos, 50);

  const bancoSel = bancos.find((b) => b.id === form.banco_id);
  const esBs = bancoSel?.moneda === "BS";
  const metodosBanco = bancoSel?.metodos?.length ? bancoSel.metodos : bancoSel ? [bancoSel.metodo_pago] : [];
  const saldoCliente = deudores.find((d) => d.cliente_id === form.cliente_id)?.saldo ?? 0;
  const montoUSD = esBs ? (form.tasa > 0 ? form.monto / form.tasa : 0) : form.monto;

  const facturasDelCliente = (clienteId: string): FacturaSaldo[] => facturasNormales
    .filter((f) => f.cliente_id === clienteId)
    .map((f) => ({ id: f.id, numero: f.numero, fecha_emision: f.fecha_emision, saldo_usd: Number(f.saldo_usd) }))
    .sort((a, b) => new Date(a.fecha_emision || 0).getTime() - new Date(b.fecha_emision || 0).getTime());

  const facturasCliente = useMemo(() => facturasDelCliente(form.cliente_id), [facturasNormales, form.cliente_id]);

  const abrirCobro = (cliente_id?: string) => {
    setForm({ cliente_id: cliente_id || "", banco_id: "", metodo: "", monto: 0, tasa: Math.round(exchangeRate * 100) / 100, referencia: "", notas: "" });
    setAsignaciones({});
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
    const asignado = Object.values(asignaciones).reduce((s, v) => s + v, 0);
    if (asignado > montoUSD + 0.01) {
      toast({ title: "La asignación excede el monto", description: "Revisá los montos por factura.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const p_asignaciones = Object.entries(asignaciones).map(([factura_id, monto]) => ({ factura_id, monto }));
    const { data, error } = await supabase.rpc("registrar_cobro_facturas", {
      p_cliente_id: form.cliente_id,
      p_banco_id: form.banco_id,
      p_monto_moneda: form.monto,
      p_moneda: bancoSel?.moneda || "USD",
      p_tasa: esBs ? form.tasa : null,
      p_metodo: form.metodo || metodosBanco[0] || "transferencia",
      p_referencia: form.referencia || null,
      p_comprobante_url: null,
      p_notas: form.notas || null,
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
    setOpen(false);
    fetchAll();
  };

  const pgPend = usePagination(pendientes, 50);

  const abrirVerif = (p: PagoPendiente) => {
    setVerif(p);
    setVerifForm({ banco_id: p.banco_id || "", notas: "" });
    setVerifAsignaciones({});
  };

  const facturasVerif = useMemo(() => verif ? facturasDelCliente(verif.cliente_id) : [], [verif, facturasNormales]);
  const montoVerifUSD = verif ? Number(verif.monto) : 0;

  const verComprobante = async (path: string) => {
    const { data, error } = await supabase.storage.from("documentos").createSignedUrl(path, 120);
    if (error || !data?.signedUrl) { toast({ title: "No se pudo abrir el comprobante", description: error?.message, variant: "destructive" }); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const decidirVerif = async (aprobar: boolean) => {
    if (!verif) return;
    if (aprobar) {
      const asignado = Object.values(verifAsignaciones).reduce((s, v) => s + v, 0);
      if (asignado > montoVerifUSD + 0.01) {
        toast({ title: "La asignación excede el monto", description: "Revisá los montos por factura.", variant: "destructive" });
        return;
      }
    }
    setVerifSaving(true);
    const p_asignaciones = Object.entries(verifAsignaciones).map(([factura_id, monto]) => ({ factura_id, monto }));
    const { error } = await supabase.rpc("verificar_pago", {
      p_pago_id: verif.id,
      p_aprobar: aprobar,
      p_notas: verifForm.notas || null,
      p_banco_id: aprobar ? (verifForm.banco_id || null) : null,
      p_tasa: null,
      p_asignaciones,
    });
    setVerifSaving(false);
    if (error) { toast({ title: "No se pudo procesar", description: error.message, variant: "destructive" }); return; }
    toast({
      title: aprobar ? "Pago verificado" : "Pago rechazado",
      description: aprobar ? "Se aplicó a las facturas seleccionadas." : "El pago quedó rechazado.",
    });
    setVerif(null);
    fetchAll();
  };

  const abrirAplicarAnticipo = (a: Anticipo) => { setAplicarAnt(a); setAntAsignaciones({}); };
  const facturasAnt = useMemo(() => aplicarAnt ? facturasDelCliente(aplicarAnt.cliente_id) : [], [aplicarAnt, facturasNormales]);

  const confirmarAplicarAnticipo = async () => {
    if (!aplicarAnt) return;
    const asignado = Object.values(antAsignaciones).reduce((s, v) => s + v, 0);
    if (asignado <= 0.009) { toast({ title: "Elegí al menos una factura", variant: "destructive" }); return; }
    if (asignado > aplicarAnt.disponible + 0.01) { toast({ title: "Excede el anticipo disponible", variant: "destructive" }); return; }
    setAntSaving(true);
    const p_asignaciones = Object.entries(antAsignaciones).map(([factura_id, monto]) => ({ factura_id, monto }));
    const { error } = await supabase.rpc("aplicar_anticipo", { p_pago_id: aplicarAnt.pago_id, p_asignaciones });
    setAntSaving(false);
    if (error) { toast({ title: "No se pudo aplicar", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Anticipo aplicado" });
    setAplicarAnt(null);
    fetchAll();
  };

  const cols = useColumnas("cxc-antiguedad", [{ etiqueta: "Cliente", fija: true }, { etiqueta: "Facturas" }, ...["Por vencer", "1–30 días", "31–60 días", "61–90 días", "+90 días"].map((etiqueta) => ({ etiqueta })), { etiqueta: "Saldo" }, { etiqueta: "A favor" }, { etiqueta: "Neto" }, { etiqueta: "Acción", fija: true }]);
  return (
    <MainLayout title="Cuentas por Cobrar">
      {cols.estilo}
      <KpiStrip items={[
        {
          label: "Por cobrar (neto)",
          valor: formatPrice(totalNeto),
          tono: "negativo",
          detalle: Math.abs(totalAFavor) > 0.009 ? `Facturas ${formatPrice(totalPorCobrar)} · a favor ${formatPrice(totalAFavor)}` : undefined,
        },
        { label: "Clientes con deuda", valor: deudores.length, tono: "alerta" },
        { label: "Cobros registrados", valor: cobros.length, tono: "positivo" },
        { label: "Anticipos sin aplicar", valor: formatPrice(anticipos.reduce((s, a) => s + Number(a.disponible), 0)), tono: "primario" },
      ]} />

      {/* Búsqueda, pestañas y acciones en una sola fila */}
      <Tabs value={tabCxc} onValueChange={setTabCxc}>
        <BarraLista
          busqueda={q}
          onBusqueda={setQ}
          placeholder="Buscar cliente..."
          pestanas={
            <TabsList className="h-auto flex-wrap justify-start">
              <TabsTrigger value="cobrar">Por cobrar ({deudores.length})</TabsTrigger>
              <TabsTrigger value="manuales">Cuentas manuales ({cuentas.length})</TabsTrigger>
              <TabsTrigger value="cobros">Recibos ({cobros.length})</TabsTrigger>
              <TabsTrigger value="anticipos">Anticipos ({anticipos.length})</TabsTrigger>
              <TabsTrigger value="verificar" className="gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5" /> Por verificar
                {pendientes.length > 0 && <Badge variant="destructive" className="ml-1 px-1.5">{pendientes.length}</Badge>}
              </TabsTrigger>
            </TabsList>
          }
          acciones={
            <>
              <Button size="sm" variant="outline" className="gap-1.5" title="Nueva cuenta por cobrar manual" onClick={() => { setCxcForm({ cliente_id: "", concepto: "", monto: 0, fecha: "" }); setOpenCxc(true); }}>
                <FilePlus className="h-3.5 w-3.5" /> Nueva CxC
              </Button>
              <Button size="sm" className="gap-1.5" onClick={() => abrirCobro()}><HandCoins className="h-3.5 w-3.5" /> Registrar Cobro</Button>
              {tabCxc === "cobrar" && <>{cols.selector}<BotonExportar soloIcono onClick={exportarDeudores} total={deudOrdenados.length} /></>}
            </>
          }
        />

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : (
        <>
          <TabsContent value="verificar">
            <div className="rounded-lg border border-border bg-card">
              {pendientes.length === 0 ? (
                <p className="p-6 text-center text-muted-foreground">No hay pagos por verificar. Los pagos reportados por clientes y vendedores aparecen aquí.</p>
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
                          <TableCell className="whitespace-nowrap font-mono text-xs text-primary">{p.numero}</TableCell>
                          <TableCell className="font-medium"><span className="block max-w-[260px] truncate" title={p.cliente?.nombre_negocio || undefined}>{p.cliente?.nombre_negocio || "—"}</span></TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">{p.orden?.numero || "—"}</TableCell>
                          <TableCell className="whitespace-nowrap">{metodoLabel[p.metodo] || p.metodo}</TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground"><span className="block max-w-[160px] truncate" title={p.referencia || undefined}>{p.referencia || "—"}</span></TableCell>
                          <TableCell className="whitespace-nowrap text-right font-semibold">{formatPrice(p.monto)}</TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">{new Date(p.created_at).toLocaleDateString("es-VE")}</TableCell>
                          <TableCell className="text-right">
                            <Button size="sm" className="h-7 px-2 text-xs" onClick={() => abrirVerif(p)}>Verificar</Button>
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

          <TabsContent value="cobrar">
            <KpiStrip
              className="mb-2"
              items={totalesTramo.map((t) => ({
                label: t.label,
                valor: formatPrice(t.monto),
                tono: t.k === "mas90" && t.monto > 0.009 ? "negativo" as const : undefined,
              }))}
            />
            <div className="rounded-lg border border-border bg-card">
              <Table data-tabla="cxc-antiguedad">
                <TableHeader>
                  <TableRow>
                    <EncabezadoOrdenable clave="nombre" orden={ordenDeud} onOrdenar={alternarDeud}>Cliente</EncabezadoOrdenable>
                    <EncabezadoOrdenable clave="docs" orden={ordenDeud} onOrdenar={alternarDeud} alinear="centro">Facturas</EncabezadoOrdenable>
                    {TRAMOS.map((t) => <EncabezadoOrdenable key={t.k} clave={t.k} orden={ordenDeud} onOrdenar={alternarDeud} alinear="derecha" className="hidden lg:table-cell">{t.label}</EncabezadoOrdenable>)}
                    <EncabezadoOrdenable clave="saldo" orden={ordenDeud} onOrdenar={alternarDeud} alinear="derecha">Saldo</EncabezadoOrdenable>
                    <EncabezadoOrdenable clave="aFavor" orden={ordenDeud} onOrdenar={alternarDeud} alinear="derecha">A favor</EncabezadoOrdenable>
                    <EncabezadoOrdenable clave="neto" orden={ordenDeud} onOrdenar={alternarDeud} alinear="derecha">Neto</EncabezadoOrdenable>
                    <TableHead className="text-right">Acción</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pgDeud.pageItems.map((d) => (
                    <TableRow key={d.cliente_id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/admin/cuentas/${d.cliente_id}`)}>
                      <TableCell className="font-medium"><span className="block max-w-[260px] truncate" title={d.nombre}>{d.nombre}</span></TableCell>
                      <TableCell className="text-center">{d.docs}</TableCell>
                      {TRAMOS.map((t) => (
                        <TableCell key={t.k} className={`hidden whitespace-nowrap text-right lg:table-cell ${d[t.k] > 0.009 ? (t.k === "mas90" ? "text-destructive" : "") : "text-muted-foreground"}`}>
                          {d[t.k] > 0.009 ? formatPrice(d[t.k]) : "—"}
                        </TableCell>
                      ))}
                      <TableCell className="whitespace-nowrap text-right font-semibold text-destructive">{formatPrice(d.saldo)}</TableCell>
                      <TableCell className={`whitespace-nowrap text-right ${d.aFavor < -0.009 ? "text-success" : "text-muted-foreground"}`}>{d.aFavor < -0.009 ? formatPrice(Math.abs(d.aFavor)) : "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-semibold">{formatPrice(d.neto)}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" className="h-7 whitespace-nowrap px-2 text-xs" onClick={(e) => { e.stopPropagation(); abrirCobro(d.cliente_id); }}>Registrar cobro</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <DataTablePagination pagination={pgDeud} />
            </div>
          </TabsContent>

          <TabsContent value="manuales">
            <div className="rounded-lg border border-border bg-card">
              {cuentas.length === 0 ? (
                <p className="p-6 text-center text-muted-foreground">No hay cuentas por cobrar manuales. Creá una con "Nueva cuenta por cobrar".</p>
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
                          <TableCell className="whitespace-nowrap font-mono text-xs text-primary">{c.numero}</TableCell>
                          <TableCell className="font-medium"><span className="block max-w-[260px] truncate" title={clientes[c.cliente_id] || undefined}>{clientes[c.cliente_id] || "—"}</span></TableCell>
                          <TableCell className="text-muted-foreground"><span className="block max-w-[280px] truncate" title={c.concepto}>{c.concepto}</span></TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">{new Date(c.fecha).toLocaleDateString("es-VE")}</TableCell>
                          <TableCell>
                            <Badge variant={c.estado_pago === "pagado" ? "default" : c.estado_pago === "parcial" ? "outline" : "secondary"}>{c.estado_pago}</Badge>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right">{formatPrice(c.monto)}</TableCell>
                          <TableCell className="whitespace-nowrap text-right font-semibold text-destructive">{formatPrice(Number(c.monto) - Number(c.monto_pagado || 0))}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <DataTablePagination pagination={pgCuentas} />
                </>
              )}
            </div>
          </TabsContent>

          <TabsContent value="cobros">
            <div className="rounded-lg border border-border bg-card">
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
                      <TableCell className="whitespace-nowrap font-mono text-xs text-primary">{c.numero}</TableCell>
                      <TableCell className="font-medium"><span className="block max-w-[260px] truncate" title={c.cliente?.nombre_negocio || undefined}>{c.cliente?.nombre_negocio || "—"}</span></TableCell>
                      <TableCell className="text-muted-foreground"><span className="block max-w-[180px] truncate" title={c.banco?.nombre || undefined}>{c.banco?.nombre || "—"}</span></TableCell>
                      <TableCell className="whitespace-nowrap text-right">{Number(c.monto_moneda).toLocaleString("es-VE")} {c.moneda}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-semibold">{formatPrice(c.monto)}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{new Date(c.created_at).toLocaleDateString("es-VE")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <DataTablePagination pagination={pgCobros} />
            </div>
          </TabsContent>

          <TabsContent value="anticipos">
            <div className="rounded-lg border border-border bg-card">
              {anticipos.length === 0 ? (
                <p className="p-6 text-center text-muted-foreground">No hay anticipos sin aplicar. Un pago con sobrante queda acá.</p>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nº</TableHead><TableHead>Cliente</TableHead><TableHead>Fecha</TableHead>
                        <TableHead className="text-right">Pago</TableHead><TableHead className="text-right">Disponible</TableHead>
                        <TableHead className="text-right">Acción</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pgAnt.pageItems.map((a) => (
                        <TableRow key={a.pago_id}>
                          <TableCell className="whitespace-nowrap font-mono text-xs text-primary">{a.numero}</TableCell>
                          <TableCell className="font-medium"><span className="block max-w-[260px] truncate" title={clientes[a.cliente_id] || undefined}>{clientes[a.cliente_id] || "—"}</span></TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">{new Date(a.created_at).toLocaleDateString("es-VE")}</TableCell>
                          <TableCell className="whitespace-nowrap text-right">{formatPrice(a.monto_usd)}</TableCell>
                          <TableCell className="whitespace-nowrap text-right font-semibold text-success">{formatPrice(a.disponible)}</TableCell>
                          <TableCell className="text-right">
                            <Button size="sm" variant="outline" className="h-7 whitespace-nowrap px-2 text-xs" onClick={() => abrirAplicarAnticipo(a)}>Aplicar a facturas</Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <DataTablePagination pagination={pgAnt} />
                </>
              )}
            </div>
          </TabsContent>
        </>
      )}
      </Tabs>

      {/* Registrar cobro */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Registrar Cobro</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Cliente *</Label>
              <Select value={form.cliente_id} onValueChange={(v) => { setForm({ ...form, cliente_id: v }); setAsignaciones({}); }}>
                <SelectTrigger><SelectValue placeholder="Seleccionar cliente con deuda" /></SelectTrigger>
                <SelectContent>
                  {deudores.map((d) => (
                    <SelectItem key={d.cliente_id} value={d.cliente_id}>{d.nombre} — {formatPrice(d.saldo)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.cliente_id && <p className="text-xs text-muted-foreground">Saldo pendiente: <span className="font-semibold text-destructive">{formatPrice(saldoCliente)}</span></p>}
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
              <p className="text-xs text-muted-foreground">Equivale a <span className="font-semibold">{formatPrice(montoUSD)}</span></p>
            )}

            {form.cliente_id && (
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
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Verificar pago {verif?.numero}</DialogTitle></DialogHeader>
          {verif && (
            <div className="space-y-4 py-2">
              <div className="space-y-1 rounded-lg border bg-muted/40 p-3 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Cliente</span><span className="font-medium">{verif.cliente?.nombre_negocio || "—"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Orden</span><span>{verif.orden?.numero || "—"}</span></div>
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
                <p className="text-xs text-muted-foreground">Si elegís banco, se registra el movimiento de entrada.</p>
              </div>

              <SelectorFacturas
                facturas={facturasVerif}
                montoDisponible={montoVerifUSD}
                asignaciones={verifAsignaciones}
                onChange={setVerifAsignaciones}
                formatPrice={formatPrice}
              />

              <div className="space-y-2"><Label>Notas</Label><Textarea rows={2} value={verifForm.notas} onChange={(e) => setVerifForm((f) => ({ ...f, notas: e.target.value }))} placeholder="Opcional (motivo de rechazo, observaciones…)" /></div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="destructive" onClick={() => decidirVerif(false)} disabled={verifSaving}>Rechazar</Button>
            <Button onClick={() => decidirVerif(true)} disabled={verifSaving} className="gap-2">{verifSaving && <Loader2 className="h-4 w-4 animate-spin" />} Aprobar y adjudicar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Aplicar anticipo */}
      <Dialog open={!!aplicarAnt} onOpenChange={(o) => !o && setAplicarAnt(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Aplicar anticipo {aplicarAnt?.numero}</DialogTitle></DialogHeader>
          {aplicarAnt && (
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                Cliente <span className="font-medium text-foreground">{clientes[aplicarAnt.cliente_id]}</span> ·
                disponible <span className="font-semibold text-foreground">{formatPrice(aplicarAnt.disponible)}</span>
              </p>
              <SelectorFacturas
                facturas={facturasAnt}
                montoDisponible={aplicarAnt.disponible}
                asignaciones={antAsignaciones}
                onChange={setAntAsignaciones}
                formatPrice={formatPrice}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAplicarAnt(null)}>Cancelar</Button>
            <Button onClick={confirmarAplicarAnticipo} disabled={antSaving} className="gap-2">{antSaving && <Loader2 className="h-4 w-4 animate-spin" />} Aplicar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
};

export default CuentasPorCobrar;
