import { useState, useEffect, useRef, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PortalPagina } from "@/components/portal/PortalPagina";
import { EstadoVacio, Kpi, Panel, PillTono, Segmentado, SkeletonFilas, useEsEscritorio, type Tono } from "@/components/portal/sistema";
import { CuentaPagoDatos } from "@/components/portal/CuentaPagoDatos";
import { NavFinanzas } from "@/components/portal/finanzas";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useAuth } from "@/contexts/AuthContext";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CreditCard,
  Upload,
  CheckCircle,
  AlertCircle,
  Plus,
  Loader2,
  Receipt,
  FileText,
  Paperclip,
  Landmark
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/lib/supabase";
import { compressImage } from "@/lib/image";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useCuentasPago, metodosDeCuenta, METODO_LABEL, separarBanco, type CuentaPago } from "@/hooks/useCuentasPago";

const MAX_COMPROBANTE_SIZE = 5 * 1024 * 1024;
const ALLOWED_COMPROBANTE_TYPES = ["application/pdf", "image/jpeg", "image/png"];

interface PagoDB {
  id: string;
  numero: string | null;
  monto: number;
  monto_moneda: number | null;
  moneda: string | null;
  metodo: string;
  referencia: string | null;
  estado: string;
  notas: string | null;          // motivo del rechazo cuando el admin rechaza el pago
  created_at: string;
  banco_id: string | null;
  orden?: { numero: string } | null;
}

// Deuda real: facturas publicadas (posted) con saldo, igual que Cuentas por Cobrar del admin
interface FacturaAbierta {
  estado_cobro?: string | null;
  id: string;
  numero: string;
  tipo: string;
  fecha_emision: string | null;
  fecha_vencimiento: string | null;
  saldo_usd: number;
  orden_id: string | null;
}

interface OrdenSinFactura {
  id: string;
  numero: string;
  total: number;
  monto_pagado: number | null;
  estado: string;
  aprobacion: string | null;
  estado_pago: string | null;
}

// A qué corresponde el pago: una factura, un pedido que aún no tiene factura o un abono a la cuenta
interface Destino {
  clave: string;
  etiqueta: string;
  saldoUSD: number | null;
  ordenId: string | null;
}

const statusConfig: Record<string, { label: string; tono: Tono }> = {
  pendiente: { label: "Por verificar", tono: "pendiente" },
  verificando: { label: "Por verificar", tono: "pendiente" },
  verificado: { label: "Verificado", tono: "ok" },
  aprobado: { label: "Verificado", tono: "ok" },
  rechazado: { label: "Rechazado", tono: "riesgo" },
};

const TOLERANCIA = 0.009; // misma tolerancia que CxC del admin
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const fmtBs = (n: number) => `Bs. ${n.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtUsd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ultimos4 = (n: string | null) => (n ? `…${n.slice(-4)}` : null);

const formVacio = { destino: "", cuentaId: "", metodo: "", monto: "", tasa: "", referencia: "" };

const PortalPagos = () => {
  const { formatPrice, exchangeRate } = useCurrency();
  const { user } = useAuth();
  const { empresaActiva } = useEmpresa();
  const { toast } = useToast();
  const { cuentas, loading: cargandoCuentas } = useCuentasPago();
  const esEscritorio = useEsEscritorio();
  const [searchParams, setSearchParams] = useSearchParams();

  const [activeTab, setActiveTab] = useState<"pendientes" | "verificados" | "rechazados">("pendientes");
  const [pagos, setPagos] = useState<PagoDB[]>([]);
  const [facturas, setFacturas] = useState<FacturaAbierta[]>([]);
  const [ordenesSinFactura, setOrdenesSinFactura] = useState<OrdenSinFactura[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Formulario de declaración
  const [form, setForm] = useState(formVacio);
  // true = el monto lo calculó la app a partir del saldo del documento (se recalcula si cambia la cuenta o la tasa)
  const [montoAuto, setMontoAuto] = useState(false);
  const [avisoMonto, setAvisoMonto] = useState<string | null>(null);
  // Tras elegir la cuenta la lista se pliega (queda la elegida + "Cambiar"), así los datos y el monto quedan a la vista
  const [listaCuentasAbierta, setListaCuentasAbierta] = useState(true);
  const [comprobanteFile, setComprobanteFile] = useState<File | null>(null);
  const [uploadingComprobante, setUploadingComprobante] = useState(false);
  const comprobanteInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (user?.cliente_id) {
      fetchData();
    }
  }, [user?.cliente_id]);

  const fetchData = async () => {
    if (!user?.cliente_id) return;
    setLoading(true);
    const cid = user.cliente_id;

    const [{ data: pagosData }, { data: facsData }, { data: ordsData }, { data: facOrdenes }] = await Promise.all([
      supabase
        .from("pagos")
        .select("id, numero, monto, monto_moneda, moneda, metodo, referencia, estado, notas, created_at, banco_id, orden:ordenes(numero)")
        .eq("cliente_id", cid)
        .order("created_at", { ascending: false }),
      // Facturas publicadas con saldo (positivo = por pagar; negativo = saldo a favor por notas de crédito)
      supabase
        .from("facturas")
        .select("id, numero, tipo, fecha_emision, fecha_vencimiento, saldo_usd, orden_id, estado_cobro")
        .eq("cliente_id", cid)
        .eq("estado", "posted")
        .or(`saldo_usd.gt.${TOLERANCIA},saldo_usd.lt.-${TOLERANCIA}`)
        .order("fecha_emision", { ascending: true }),
      supabase
        .from("ordenes")
        .select("id, numero, total, monto_pagado, estado, aprobacion, estado_pago")
        .eq("cliente_id", cid)
        .neq("estado", "cancelado")
        .order("created_at", { ascending: false }),
      // Pedidos que ya tienen factura (su deuda vive en la factura, no en el pedido)
      supabase.from("facturas").select("orden_id").eq("cliente_id", cid).not("orden_id", "is", null),
    ]);

    setPagos((pagosData as unknown as PagoDB[]) ?? []);
    setFacturas(((facsData as FacturaAbierta[]) ?? []).map((f) => ({ ...f, saldo_usd: Number(f.saldo_usd) })));
    const conFactura = new Set(((facOrdenes as { orden_id: string }[]) ?? []).map((f) => f.orden_id));
    setOrdenesSinFactura(
      ((ordsData as OrdenSinFactura[]) ?? []).filter((o) =>
        o.aprobacion !== "rechazada" && o.estado_pago !== "pagado" && !conFactura.has(o.id) &&
        Number(o.total) - Number(o.monto_pagado ?? 0) > TOLERANCIA
      )
    );
    setLoading(false);
  };

  const facturasPorPagar = useMemo(() => facturas.filter((f) => f.saldo_usd > TOLERANCIA), [facturas]);
  const totalPorPagar = facturasPorPagar.reduce((s, f) => s + f.saldo_usd, 0);
  const totalAFavor = facturas.reduce((s, f) => s + (f.saldo_usd < -TOLERANCIA ? -f.saldo_usd : 0), 0);

  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  // Misma regla que CxC del admin: vence = vencimiento o, si falta, la emisión
  const vencida = (f: FacturaAbierta) => {
    const v = f.fecha_vencimiento || f.fecha_emision;
    return !!v && new Date(`${v}T00:00:00`) < hoy;
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    const d = dateStr.length === 10 ? new Date(`${dateStr}T00:00:00`) : new Date(dateStr);
    return d.toLocaleDateString("es-VE", { day: "numeric", month: "short", year: "numeric" });
  };

  const destinos = useMemo<Destino[]>(() => [
    // Las anuladas que Odoo aún tiene con saldo ("por cruzar" con su NC) cuentan en la deuda, pero no se pagan
    ...facturasPorPagar.filter((f) => f.estado_cobro !== "anulado").map((f) => ({
      clave: `f:${f.id}`,
      etiqueta: `Factura ${f.numero} · saldo ${fmtUsd(f.saldo_usd)}`,
      saldoUSD: round2(f.saldo_usd),
      ordenId: f.orden_id,
    })),
    ...ordenesSinFactura.map((o) => {
      const saldo = round2(Number(o.total) - Number(o.monto_pagado ?? 0));
      return {
        clave: `o:${o.id}`,
        etiqueta: `Pedido ${o.numero} · ${fmtUsd(saldo)}${o.aprobacion === "pendiente" ? " · por aprobar" : ""}`,
        saldoUSD: saldo,
        ordenId: o.id,
      };
    }),
    { clave: "cuenta", etiqueta: "Abono a mi cuenta (sin documento específico)", saldoUSD: null, ordenId: null },
  ], [facturasPorPagar, ordenesSinFactura]);

  const cuentasPorId = useMemo(() => Object.fromEntries(cuentas.map((c) => [c.id, c])), [cuentas]);
  const cuentaSel = form.cuentaId ? cuentasPorId[form.cuentaId] : undefined;
  const esBS = cuentaSel?.moneda === "BS";
  const destinoSel = destinos.find((d) => d.clave === form.destino);
  const tasaNum = Number(form.tasa);
  const montoNum = Number(form.monto);
  const montoUSD = cuentaSel && montoNum > 0 ? (esBS ? (tasaNum > 0 ? round2(montoNum / tasaNum) : null) : round2(montoNum)) : null;

  // Saldo en USD → monto en la moneda de la cuenta (Bs. con la tasa indicada). null si falta la tasa.
  const enMoneda = (usd: number, moneda: string, tasa: number) =>
    moneda === "BS" ? (tasa > 0 ? round2(usd * tasa) : null) : round2(usd);

  const abrirDeclaracion = (destino = "") => {
    setForm({ ...formVacio, destino, tasa: exchangeRate > 0 ? String(exchangeRate) : "" });
    setMontoAuto(false);
    setAvisoMonto(null);
    setComprobanteFile(null);
    setListaCuentasAbierta(true);
    setIsPaymentOpen(true);
  };

  const elegirDestino = (clave: string) => {
    const d = destinos.find((x) => x.clave === clave);
    let monto = form.monto;
    let auto = montoAuto;
    if (cuentaSel && d?.saldoUSD != null && (form.monto === "" || montoAuto)) {
      const m = enMoneda(d.saldoUSD, cuentaSel.moneda, tasaNum);
      monto = m != null ? String(m) : "";
      auto = m != null;
    } else if (d?.saldoUSD == null && montoAuto) {
      monto = "";
      auto = false;
    }
    setForm({ ...form, destino: clave, monto });
    setMontoAuto(auto);
    setAvisoMonto(null);
  };

  const elegirCuenta = (c: CuentaPago) => {
    const tasa = tasaNum > 0 ? tasaNum : exchangeRate;
    const metodos = metodosDeCuenta(c);
    const saldo = destinoSel?.saldoUSD ?? null;
    let monto = form.monto;
    let auto = montoAuto;
    let aviso: string | null = null;
    if (saldo != null && (form.monto === "" || montoAuto)) {
      const m = enMoneda(saldo, c.moneda, tasa);
      monto = m != null ? String(m) : "";
      auto = m != null;
    } else if (form.monto !== "" && cuentaSel && cuentaSel.moneda !== c.moneda) {
      // El monto que escribió el cliente estaba en la otra moneda: se convierte. Nunca queda un número en USD bajo
      // la etiqueta Bs. (ni al revés).
      const v = Number(form.monto);
      if (!(tasa > 0) || !(v > 0)) {
        monto = "";
        aviso = c.moneda === "BS" ? "Indica el monto en bolívares." : "Indica el monto en dólares.";
      } else if (c.moneda === "BS") {
        monto = String(round2(v * tasa));
        aviso = `Convertimos ${fmtUsd(v)} a bolívares con la tasa del día. Verifica que coincida con lo que pagaste.`;
      } else {
        monto = String(round2(v / tasa));
        aviso = `Convertimos ${fmtBs(v)} a dólares con la tasa del día. Verifica que coincida con lo que pagaste.`;
      }
      auto = false;
    }
    setForm({
      ...form,
      cuentaId: c.id,
      metodo: (metodos as string[]).includes(form.metodo) ? form.metodo : metodos[0],
      monto,
      tasa: tasa > 0 ? String(tasa) : form.tasa,
    });
    setMontoAuto(auto);
    setAvisoMonto(aviso);
    setListaCuentasAbierta(false);
  };

  const cambiarTasa = (v: string) => {
    const t = Number(v);
    const saldo = destinoSel?.saldoUSD ?? null;
    if (montoAuto && esBS && saldo != null && t > 0) {
      setForm({ ...form, tasa: v, monto: String(round2(saldo * t)) });
    } else {
      setForm({ ...form, tasa: v });
    }
  };

  // Enlaces directos: /portal/pagos?factura=<id> (detalle del pedido o de la factura) abre la declaración de esa factura;
  // /portal/pagos?declarar=1 (estado de cuenta) abre la declaración vacía.
  useEffect(() => {
    const fid = searchParams.get("factura");
    const declarar = searchParams.get("declarar");
    if ((!fid && !declarar) || loading) return;
    if (fid) {
      if (facturasPorPagar.some((f) => f.id === fid && f.estado_cobro !== "anulado")) abrirDeclaracion(`f:${fid}`);
      else toast({ title: "Esta factura no tiene saldo pendiente", description: "Puedes declarar un abono a tu cuenta si lo necesitas." });
    } else {
      abrirDeclaracion();
    }
    const n = new URLSearchParams(searchParams);
    n.delete("factura");
    n.delete("declarar");
    setSearchParams(n, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, searchParams]);

  const handleComprobanteSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ALLOWED_COMPROBANTE_TYPES.includes(file.type)) {
      toast({ title: "Formato no permitido", description: "Solo se aceptan PDF, JPG o PNG", variant: "destructive" });
      return;
    }
    if (file.size > MAX_COMPROBANTE_SIZE) {
      toast({ title: "Archivo muy grande", description: "El máximo es 5 MB", variant: "destructive" });
      return;
    }
    setComprobanteFile(file);
  };

  const uploadComprobante = async (file: File): Promise<string> => {
    // Guarda la RUTA (bucket privado `documentos`); el admin genera la URL firmada al verificar.
    const isImage = file.type.startsWith("image/");
    const body = isImage ? await compressImage(file, 1600, 0.85) : file;
    const ext = isImage ? "jpg" : "pdf";
    const path = `comprobantes/${user?.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from("documentos").upload(path, body, {
      contentType: isImage ? "image/jpeg" : "application/pdf",
    });
    if (error) throw error;
    return path;
  };

  const handleSubmitPayment = async () => {
    const faltan: string[] = [];
    if (!destinoSel) faltan.push("qué estás pagando");
    if (!cuentaSel) faltan.push("la cuenta donde pagaste");
    if (!(montoNum > 0)) faltan.push("el monto");
    if (esBS && !(tasaNum > 0)) faltan.push("la tasa");
    if (!form.referencia.trim()) faltan.push("la referencia");
    if (!comprobanteFile) faltan.push("el comprobante");
    if (faltan.length > 0 || !cuentaSel || !destinoSel) {
      toast({ title: "Falta información", description: `Indica ${faltan.join(", ")}.`, variant: "destructive" });
      return;
    }

    setSaving(true);

    let comprobanteUrl: string | null = null;
    if (comprobanteFile) {
      setUploadingComprobante(true);
      try {
        comprobanteUrl = await uploadComprobante(comprobanteFile);
      } catch (err) {
        toast({ title: "No se pudo subir el comprobante", description: (err as Error).message, variant: "destructive" });
        setSaving(false);
        setUploadingComprobante(false);
        return;
      }
      setUploadingComprobante(false);
    }

    const { error } = await supabase.rpc("registrar_pago", {
      p_cliente_id: user?.cliente_id,
      p_orden_id: destinoSel.ordenId,
      p_banco_id: cuentaSel.id,
      p_metodo: form.metodo || "transferencia",
      p_monto_moneda: round2(montoNum),
      p_moneda: cuentaSel.moneda,
      p_tasa_cambio: esBS ? tasaNum : null,
      p_referencia: form.referencia.trim(),
      p_comprobante_url: comprobanteUrl,
    });

    setSaving(false);
    if (error) {
      toast({ title: "No se pudo declarar el pago", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Pago declarado", description: "Queda pendiente de verificación. Te avisaremos cuando lo revisemos." });
      setForm(formVacio);
      setComprobanteFile(null);
      setIsPaymentOpen(false);
      setActiveTab("pendientes");
      fetchData();
    }
  };

  const pagosPendientes = pagos.filter((p) => p.estado === "pendiente" || p.estado === "verificando");
  const pagosVerificados = pagos.filter((p) => p.estado === "verificado" || p.estado === "aprobado");
  const pagosRechazados = pagos.filter((p) => p.estado === "rechazado");
  const displayPagos = activeTab === "pendientes" ? pagosPendientes : activeTab === "verificados" ? pagosVerificados : pagosRechazados;
  const totalVerificado = pagosVerificados.reduce((sum, p) => sum + Number(p.monto), 0);

  const cuentasBS = cuentas.filter((c) => c.moneda === "BS");
  const cuentasUSD = cuentas.filter((c) => c.moneda === "USD");

  const tabs = [
    { k: "pendientes" as const, label: "Por verificar", n: pagosPendientes.length },
    { k: "verificados" as const, label: "Verificados", n: pagosVerificados.length },
    { k: "rechazados" as const, label: "Rechazados", n: pagosRechazados.length },
  ];

  // Botón de una cuenta (función de render, no componente: así no se remonta en cada tecla)
  const botonCuenta = (c: CuentaPago) => {
    const sel = form.cuentaId === c.id;
    const banco = separarBanco(c.banco_nombre);
    return (
      <button
        key={c.id}
        type="button"
        onClick={() => elegirCuenta(c)}
        aria-pressed={sel}
        className={cn(
          "w-full rounded-xl border p-3 text-left transition-colors",
          sel ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-muted/50",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">{c.nombre}</p>
          <span className="shrink-0 text-xs font-semibold">{c.moneda === "USD" ? "USD $" : "Bs."}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {[banco.nombre, ultimos4(c.numero_cuenta)].filter(Boolean).join(" · ")}
        </p>
      </button>
    );
  };

  const hayVencidas = facturasPorPagar.some(vencida);
  const totalVencido = facturasPorPagar.filter(vencida).reduce((s, f) => s + f.saldo_usd, 0);

  return (
    <PortalPagina
      titulo="Pagos"
      descripcion="Tus facturas por pagar y los pagos que has declarado."
      acciones={
        <>
          <Button asChild variant="outline" className="gap-2"><Link to="/portal/cuenta/pagos"><Landmark className="h-4 w-4" />Cómo pagar</Link></Button>
          <Button className="gap-2" onClick={() => abrirDeclaracion()} data-testid="declarar-pago"><Plus className="h-4 w-4" />Declarar un pago</Button>
        </>
      }
    >
      <NavFinanzas />
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-6">
        {/* Resumen y facturas pendientes (en móvil va primero; en escritorio, columna derecha) */}
        <aside className="space-y-4 lg:sticky lg:top-[5.5rem] lg:order-2" aria-label="Resumen de pagos">
          <div className="grid grid-cols-2 gap-3">
            <Kpi etiqueta="Por pagar" icono={AlertCircle} cargando={loading} testId="por-pagar" alerta={hayVencidas}
              valor={formatPrice(totalPorPagar)}
              detalle={facturasPorPagar.length === 0 ? "Sin facturas pendientes" : hayVencidas ? `${formatPrice(totalVencido)} vencido` : `${facturasPorPagar.length} ${facturasPorPagar.length === 1 ? "factura" : "facturas"}`} />
            <Kpi etiqueta="Verificado" icono={CheckCircle} cargando={loading} valor={formatPrice(totalVerificado)}
              detalle={`${pagosVerificados.length} ${pagosVerificados.length === 1 ? "pago" : "pagos"}`} />
          </div>
          {!loading && totalAFavor > TOLERANCIA && (
            <p className="rounded-lg border border-success/30 bg-success/5 px-3 py-2 text-xs text-foreground">
              Además tienes <span className="font-semibold tabular-nums">{formatPrice(totalAFavor)}</span> a favor por notas de crédito aún no aplicadas.
            </p>
          )}

          <div className="space-y-2 lg:hidden">
            <Button className="w-full gap-2" size="lg" onClick={() => abrirDeclaracion()} data-testid="declarar-pago-movil">
              <Plus className="h-5 w-5" />Declarar un pago
            </Button>
            <Link to="/portal/cuenta/pagos" className="flex items-center justify-center gap-1.5 py-1 text-sm font-medium text-primary">
              <Landmark className="h-4 w-4" />Ver cómo pagar
            </Link>
          </div>

          {/* Facturas pendientes: el detalle de "Por pagar" */}
          {!loading && facturasPorPagar.length > 0 && (
            <Panel titulo="Facturas pendientes" descripcion="Toca una factura para declarar su pago." cuerpoClassName="p-0 sm:p-0"
              accion={<Link to="/portal/facturas" className="text-xs font-medium text-primary hover:underline">Ver facturas</Link>}>
              <ul className="divide-y divide-border">
                {facturasPorPagar.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => abrirDeclaracion(`f:${f.id}`)}
                      aria-label={`Declarar pago de la factura ${f.numero}`}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40 sm:px-5"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">Factura {f.numero}</span>
                          <span className={cn("block text-xs", vencida(f) ? "text-destructive" : "text-muted-foreground")}>
                            {vencida(f) ? "Vencida el " : "Vence el "}{formatDate(f.fecha_vencimiento || f.fecha_emision)}
                          </span>
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums">{formatPrice(f.saldo_usd)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </aside>

        {/* Pagos declarados */}
        <section className="mt-6 space-y-3 lg:order-1 lg:mt-0" aria-label="Pagos declarados">
          <Segmentado<"pendientes" | "verificados" | "rechazados">
            opciones={tabs.map((t) => ({ valor: t.k, etiqueta: t.label, n: t.n }))}
            valor={activeTab}
            onCambio={setActiveTab}
            etiqueta="Estado de los pagos"
          />

          {loading ? (
            <SkeletonFilas n={4} alto="h-24" />
          ) : displayPagos.length === 0 ? (
            <div className="rounded-xl border border-border bg-card">
              <EstadoVacio
                icono={Receipt}
                titulo={activeTab === "pendientes" ? "No tienes pagos por verificar" : activeTab === "verificados" ? "No hay pagos verificados" : "No tienes pagos rechazados"}
                descripcion={activeTab === "pendientes" ? "Cuando declares un pago, lo verás aquí hasta que lo revisemos." : undefined}
              />
            </div>
          ) : (
            <ul className="space-y-3">
              {displayPagos.map((pago) => {
                const config = statusConfig[pago.estado] || statusConfig.pendiente;
                const cuenta = pago.banco_id ? cuentasPorId[pago.banco_id] : undefined;
                return (
                  <li key={pago.id} className="rounded-xl border border-border bg-card p-4 sm:p-5" data-testid="pago-card">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-lg font-semibold tabular-nums">{formatPrice(pago.monto)}</p>
                        <p className="text-xs text-muted-foreground">
                          {pago.moneda === "BS" && pago.monto_moneda ? <span className="tabular-nums">{fmtBs(Number(pago.monto_moneda))} · </span> : ""}
                          {pago.orden?.numero ? `Pedido ${pago.orden.numero}` : "Abono a cuenta"}
                        </p>
                      </div>
                      <PillTono tono={config.tono}>{config.label}</PillTono>
                    </div>

                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                      <div>
                        <dt className="text-xs text-muted-foreground">Método</dt>
                        <dd className="font-medium">{METODO_LABEL[pago.metodo] || pago.metodo}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Referencia</dt>
                        <dd className="break-all font-mono text-sm">{pago.referencia || "—"}</dd>
                      </div>
                      {cuenta && (
                        <div className="col-span-2 sm:col-span-1">
                          <dt className="text-xs text-muted-foreground">Cuenta</dt>
                          <dd className="font-medium">{cuenta.nombre}</dd>
                        </div>
                      )}
                    </dl>

                    {pago.estado === "rechazado" && (
                      <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                        {pago.notas ? `Motivo: ${pago.notas}` : "No se indicó el motivo del rechazo."}
                      </p>
                    )}

                    <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
                      <span>{formatDate(pago.created_at)}</span>
                      {pago.numero && <span className="font-mono">{pago.numero}</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {/* Declarar pago: contenido con scroll propio y pie fijo con el botón siempre visible */}
      <Sheet open={isPaymentOpen} onOpenChange={setIsPaymentOpen}>
        <SheetContent
          side={esEscritorio ? "right" : "bottom"}
          className={esEscritorio
            ? "flex w-full flex-col gap-0 p-0 sm:max-w-lg"
            : "flex h-[92vh] supports-[height:100dvh]:h-[92dvh] flex-col gap-0 rounded-t-2xl p-0 md:mx-auto md:max-w-2xl"}
        >
          <SheetHeader className="border-b border-border px-4 py-3 pr-12 text-left">
            <SheetTitle>Declarar pago</SheetTitle>
            <SheetDescription>Indica a qué cuenta pagaste y adjunta el comprobante. Lo verificaremos y te avisaremos.</SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 space-y-5" data-testid="pago-scroll">
            {/* 1. Qué paga */}
            <div className="space-y-2">
              <Label htmlFor="pago-destino">¿Qué estás pagando?</Label>
              <Select value={form.destino} onValueChange={elegirDestino}>
                <SelectTrigger id="pago-destino" aria-label="¿Qué estás pagando?">
                  <SelectValue placeholder="Elige una factura, un pedido o abono" />
                </SelectTrigger>
                <SelectContent>
                  {facturasPorPagar.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Facturas pendientes</SelectLabel>
                      {destinos.filter((d) => d.clave.startsWith("f:")).map((d) => (
                        <SelectItem key={d.clave} value={d.clave}>{d.etiqueta}</SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  {ordenesSinFactura.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Pedidos aún sin factura</SelectLabel>
                      {destinos.filter((d) => d.clave.startsWith("o:")).map((d) => (
                        <SelectItem key={d.clave} value={d.clave}>{d.etiqueta}</SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  <SelectGroup>
                    <SelectLabel>Otro</SelectLabel>
                    <SelectItem value="cuenta">Abono a mi cuenta (sin documento específico)</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            {/* 2. Cuenta donde pagó */}
            <div className="space-y-2" role="group" aria-labelledby="pago-cuenta-titulo">
              <Label id="pago-cuenta-titulo">¿A qué cuenta pagaste?</Label>
              {cargandoCuentas ? (
                <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Cargando cuentas" /></div>
              ) : cuentas.length === 0 ? (
                <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                  {empresaActiva?.nombre_corto || "La empresa"} todavía no tiene cuentas publicadas para recibir pagos. Consulta con tu ejecutivo de cuenta.
                </p>
              ) : cuentaSel && !listaCuentasAbierta ? (
                <div className="space-y-2">
                  {botonCuenta(cuentaSel)}
                  <button type="button" onClick={() => setListaCuentasAbierta(true)} className="text-sm font-medium text-primary underline-offset-2 hover:underline">
                    Cambiar cuenta
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {cuentasBS.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bolívares (Bs.)</p>
                      {cuentasBS.map(botonCuenta)}
                    </div>
                  )}
                  {cuentasUSD.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dólares (USD)</p>
                      {cuentasUSD.map(botonCuenta)}
                    </div>
                  )}
                </div>
              )}
            </div>

            {cuentaSel && (
              <>
                {/* 3. Método (según los datos de la cuenta) */}
                <div className="space-y-2">
                  <Label id="pago-metodo-titulo">Método</Label>
                  <div className="flex flex-wrap gap-2" role="group" aria-labelledby="pago-metodo-titulo">
                    {metodosDeCuenta(cuentaSel).map((m) => (
                      <button
                        key={m}
                        type="button"
                        aria-pressed={form.metodo === m}
                        onClick={() => setForm({ ...form, metodo: m })}
                        className={cn(
                          "rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                          form.metodo === m ? "border-primary bg-primary/5 text-primary" : "border-border",
                        )}
                      >
                        {METODO_LABEL[m]}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Datos de la cuenta elegida, con copiar */}
                <div className="rounded-xl border border-border bg-muted/40 px-3 py-2">
                  <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Datos para {METODO_LABEL[form.metodo]?.toLowerCase() || "pagar"}</p>
                  <CuentaPagoDatos cuenta={cuentaSel} metodo={form.metodo} />
                </div>

                {/* 4. Monto en la moneda de la cuenta */}
                <div className="space-y-2">
                  <Label htmlFor="monto-pago">{esBS ? "Monto pagado (Bs.)" : "Monto pagado (USD $)"}</Label>
                  <Input
                    id="monto-pago"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={form.monto}
                    onChange={(e) => { setForm({ ...form, monto: e.target.value }); setMontoAuto(false); setAvisoMonto(null); }}
                  />
                  {avisoMonto && <p className="text-xs text-amber-700 dark:text-amber-400" role="status">{avisoMonto}</p>}
                  {destinoSel?.saldoUSD != null && (
                    <p className="text-xs text-muted-foreground">
                      Saldo del documento: {fmtUsd(destinoSel.saldoUSD)}
                      {esBS && tasaNum > 0 ? ` (${fmtBs(round2(destinoSel.saldoUSD * tasaNum))} a la tasa indicada)` : ""}
                    </p>
                  )}
                </div>

                {esBS && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="tasa-pago">Tasa de cambio (Bs. por 1 USD)</Label>
                      <span className="text-xs text-muted-foreground">Tasa BCV del día</span>
                    </div>
                    <Input
                      id="tasa-pago"
                      type="number"
                      inputMode="decimal"
                      step="0.0001"
                      min="0"
                      value={form.tasa}
                      onChange={(e) => cambiarTasa(e.target.value)}
                    />
                    {montoUSD != null && (
                      <div className="flex items-center justify-between rounded-md bg-muted/60 px-3 py-2">
                        <span className="text-xs text-muted-foreground">Equivale a</span>
                        <span className="text-sm font-semibold tabular-nums" data-testid="equivale-usd">{fmtUsd(montoUSD)}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* 5. Referencia */}
                <div className="space-y-2">
                  <Label htmlFor="ref-pago">Número de referencia</Label>
                  <Input
                    id="ref-pago"
                    placeholder="Referencia de la operación"
                    value={form.referencia}
                    onChange={(e) => setForm({ ...form, referencia: e.target.value })}
                  />
                </div>

                {/* 6. Comprobante */}
                <div className="space-y-2">
                  <Label id="pago-comprobante-titulo">Comprobante</Label>
                  <input
                    ref={comprobanteInputRef}
                    type="file"
                    aria-labelledby="pago-comprobante-titulo"
                    accept="application/pdf,image/jpeg,image/png"
                    className="hidden"
                    onChange={handleComprobanteSelect}
                    data-testid="comprobante-input"
                  />
                  <button
                    type="button"
                    onClick={() => comprobanteInputRef.current?.click()}
                    disabled={uploadingComprobante}
                    aria-describedby="pago-comprobante-titulo"
                    className="w-full border-2 border-dashed border-border rounded-xl p-4 text-center disabled:opacity-50"
                  >
                    {comprobanteFile ? (
                      <span className="flex items-center justify-center gap-2 text-sm">
                        <Paperclip className="h-4 w-4 text-primary" aria-hidden />
                        {comprobanteFile.name}
                      </span>
                    ) : (
                      <span className="flex flex-col items-center gap-1 text-sm text-muted-foreground">
                        <Upload className="h-6 w-6" aria-hidden />
                        {uploadingComprobante ? "Subiendo..." : "Toca para adjuntar el comprobante (PDF, JPG o PNG, máx. 5 MB)"}
                      </span>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Pie fijo */}
          <div className="border-t border-border bg-background px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {cuentaSel && montoNum > 0 && (
              <p className="mb-2 text-center text-xs text-muted-foreground tabular-nums">
                Declaras {esBS ? fmtBs(montoNum) : fmtUsd(montoNum)}
                {esBS && montoUSD != null ? ` · equivale a ${fmtUsd(montoUSD)}` : ""}
              </p>
            )}
            <Button className="w-full h-12" size="lg" onClick={handleSubmitPayment} disabled={saving} data-testid="enviar-pago">
              {saving ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <CreditCard className="h-5 w-5 mr-2" />
                  Enviar declaración
                </>
              )}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </PortalPagina>
  );
};

export default PortalPagos;
