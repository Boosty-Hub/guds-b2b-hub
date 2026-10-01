import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { ArrowLeft, Loader2, Building2, FileText, Clock, HandCoins, Mail, Send, Wallet, AlertCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/contexts/CurrencyContext";
import { usePermissions } from "@/contexts/PermissionsContext";
import { OdooBadge } from "@/components/OdooBadge";
import { Antiguedad, conceptoMovimiento } from "@/components/portal/finanzas";
import { conSigno, sumarDias, type Movimiento } from "@/hooks/useFinanzasPortal";
import { BotonPdfEstadoCuenta } from "@/components/estado-cuenta/BotonPdfEstadoCuenta";
import { EnlacePublicoPanel } from "@/components/estado-cuenta/EnlacePublicoPanel";
import { EnviarEstadoCuentaDialog } from "@/components/estado-cuenta/EnviarEstadoCuentaDialog";
import { fechaHora, textoPeriodo } from "@/components/estado-cuenta/formato";
import type { DocumentoAbierto, EstadoCuentaCompleto, FiltroDocumentos } from "@/components/estado-cuenta/tipos";
import { rpcConReintento } from "@/components/estado-cuenta/reintento";
import { FiltroDocumentosSelector, TablaDocumentos } from "@/components/estado-cuenta/TablaDocumentos";
import { ComentariosFacturaDialog } from "@/components/estado-cuenta/ComentariosFacturaDialog";
import { TarjetaMetricas } from "@/components/cuentas/metricas";

// Estado de cuenta de un cliente en el admin (/admin/cuentas/:clienteId). El resumen, la antigüedad, los documentos con
// saldo y el libro de movimientos salen de estado_cuenta_cliente (fase 20w): la MISMA función del servidor que el portal
// del cliente y el enlace público (y la regla de Cuentas por Cobrar), con las notas de débito etiquetadas. Desde aquí se
// descarga el PDF, se comparte el enlace público revocable y se envía por correo. Abajo, el detalle crudo de facturas,
// notas, pagos, reintegros y retenciones.
// 21b: abre en "Documentos" (el cruce por factura: base, IVA, abonos por tipo, saldo, qué falta y comentarios, con filtro
// con saldo / todas / pagadas en el período) y los movimientos desde la factura abierta más antigua. Tarjeta interna de
// cobranza (DSO, mora ponderada, tendencia, días de pago, a favor por aplicar).

interface ClienteLite { id: string; nombre_negocio: string; codigo: string | null; rif: string | null; limite_credito: number; }
interface FacturaRow {
  id: string; numero: string; tipo: string; es_nota_debito: boolean | null; fecha_emision: string | null; fecha_vencimiento: string | null;
  total_usd: number; saldo_usd: number; estado_cobro: string;
}
interface PagoRow {
  id: string; numero: string; monto: number; moneda: string; monto_moneda: number | null; estado: string;
  created_at: string; fecha_verificacion: string | null; banco?: { nombre: string } | null;
  odoo_id: number | null; es_igtf: boolean;
}
interface ReintegroRow { id: string; numero: string; monto: number; moneda: string; monto_moneda: number | null; estado: string; fecha: string | null; referencia: string | null; banco?: { nombre: string } | null; }
interface PagoFacturaRow { pago_id: string; factura_id: string; monto_aplicado: number; factura?: { numero: string } | null; }
interface RetencionRow { id: string; numero: string; tipo: string; estado: string; fecha: string; total: number; odoo_id: number | null; }
interface EnvioRow {
  id: string; creado_at: string; enviado_at: string | null; estado: "enviando" | "enviado" | "fallido"; destinatarios: string[];
  asunto: string; resend_id: string | null; error: string | null; enviado_por: string | null; adjunto_bytes: number | null;
  lote_id?: string | null; entrega?: "entregado" | "rebotado" | "queja" | "retrasado" | null; entrega_detalle?: string | null;
}

type Rango = "abierta" | "30" | "90" | "anio" | "todo";

const ESTADO_RETENCION: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  pendiente: { label: "Pendiente", variant: "secondary" },
  aprobado: { label: "Aprobado", variant: "default" },
  rechazado: { label: "Rechazado", variant: "destructive" },
};

const ESTADO_COBRO: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pendiente: { label: "Pendiente", variant: "secondary" },
  parcial: { label: "Parcial", variant: "outline" },
  pagado: { label: "Pagada", variant: "default" },
  anulado: { label: "Anulada", variant: "destructive" },
};

const ESTADO_ENVIO: Record<EnvioRow["estado"], { label: string; variant: "default" | "secondary" | "destructive" }> = {
  enviado: { label: "Enviado", variant: "default" },
  enviando: { label: "Enviando", variant: "secondary" },
  fallido: { label: "Falló", variant: "destructive" },
};

const hoyCaracas = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Caracas" });
const ENTREGA: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  entregado: { label: "Entregado", variant: "outline" },
  rebotado: { label: "Rebotó", variant: "destructive" },
  queja: { label: "Marcado como spam", variant: "destructive" },
  retrasado: { label: "Retrasado", variant: "secondary" },
};

const periodoDe = (rango: Rango, hoy: string): { desde: string | null; hasta: string | null; desdeAbierta?: boolean } => {
  switch (rango) {
    case "abierta": return { desde: null, hasta: null, desdeAbierta: true };
    case "30": return { desde: sumarDias(hoy, -30), hasta: null };
    case "90": return { desde: sumarDias(hoy, -90), hasta: null };
    case "anio": return { desde: `${hoy.slice(0, 4)}-01-01`, hasta: null };
    case "todo": return { desde: null, hasta: null };
  }
};

const CuentaDetalle = () => {
  const { clienteId = "" } = useParams();
  const navigate = useNavigate();
  const { formatPrice } = useCurrency();
  const { can } = usePermissions();
  const puedeEditar = can("cuentas", "editar");
  const [cliente, setCliente] = useState<ClienteLite | null>(null);
  const [facturas, setFacturas] = useState<FacturaRow[]>([]);
  const [pagos, setPagos] = useState<PagoRow[]>([]);
  const [reintegros, setReintegros] = useState<ReintegroRow[]>([]);
  const [pagoFacturas, setPagoFacturas] = useState<PagoFacturaRow[]>([]);
  const [retenciones, setRetenciones] = useState<RetencionRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Estado de cuenta (misma fuente que el portal y el enlace público)
  const hoy = useMemo(hoyCaracas, []);
  const [rango, setRango] = useState<Rango>("abierta");
  const [filtroDocs, setFiltroDocs] = useState<FiltroDocumentos>("abiertas");
  const [tab, setTab] = useState("documentos");
  const [comentando, setComentando] = useState<DocumentoAbierto | null>(null);
  const periodo = useMemo(() => periodoDe(rango, hoy), [rango, hoy]);
  const [ec, setEc] = useState<EstadoCuentaCompleto | null>(null);
  const [ecError, setEcError] = useState<string | null>(null);
  const [ecCargando, setEcCargando] = useState(true);
  const [enlaceUrl, setEnlaceUrl] = useState<string | null>(null);
  const [envios, setEnvios] = useState<EnvioRow[] | null>(null);
  const [correoAbierto, setCorreoAbierto] = useState(false);
  const [senal, setSenal] = useState(0);

  useEffect(() => {
    let activo = true;
    (async () => {
      setLoading(true);
      const [{ data: cli }, { data: facs }, { data: pgs }, { data: rets }, { data: reins }, { data: aplOdoo }] = await Promise.all([
        supabase.from("clientes").select("id, nombre_negocio, codigo, rif, limite_credito").eq("id", clienteId).maybeSingle(),
        supabase.from("facturas").select("id, numero, tipo, es_nota_debito, fecha_emision, fecha_vencimiento, total_usd, saldo_usd, estado_cobro").eq("cliente_id", clienteId).eq("estado", "posted").order("fecha_emision", { ascending: false }),
        supabase.from("pagos").select("id, numero, monto, moneda, monto_moneda, estado, created_at, fecha_verificacion, odoo_id, es_igtf, banco:bancos(nombre)").eq("cliente_id", clienteId).order("created_at", { ascending: false }),
        supabase.from("retenciones").select("id, numero, tipo, estado, fecha, total, odoo_id").eq("cliente_id", clienteId).order("fecha", { ascending: false }),
        supabase.from("reintegros").select("id, numero, monto, moneda, monto_moneda, estado, fecha, referencia, banco:bancos(nombre)").eq("cliente_id", clienteId).order("fecha", { ascending: false }),
        // Cobros de Odoo aplicados a facturas (conciliaciones de Odoo)
        supabase.from("factura_aplicaciones").select("pago_id, factura_id, monto_usd, factura:facturas!factura_aplicaciones_factura_id_fkey!inner(numero, cliente_id)")
          .eq("tipo", "pago").eq("factura.cliente_id", clienteId),
      ]);
      let pf: PagoFacturaRow[] = [];
      if (pgs?.length) {
        const { data } = await supabase.from("pago_facturas").select("pago_id, factura_id, monto_aplicado, factura:facturas(numero)").in("pago_id", pgs.map((p) => p.id));
        pf = (data as unknown as PagoFacturaRow[]) ?? [];
      }
      for (const a of (aplOdoo as unknown as { pago_id: string | null; factura_id: string; monto_usd: number; factura?: { numero: string } | null }[]) ?? []) {
        if (a.pago_id) pf.push({ pago_id: a.pago_id, factura_id: a.factura_id, monto_aplicado: Number(a.monto_usd), factura: a.factura });
      }
      if (activo) {
        setCliente((cli as ClienteLite) ?? null);
        setFacturas((facs as FacturaRow[]) ?? []);
        setPagos((pgs as unknown as PagoRow[]) ?? []);
        setPagoFacturas(pf);
        setRetenciones((rets as RetencionRow[]) ?? []);
        setReintegros((reins as unknown as ReintegroRow[]) ?? []);
        setLoading(false);
      }
    })();
    return () => { activo = false; };
  }, [clienteId]);

  const [ecIntento, setEcIntento] = useState(0);
  useEffect(() => {
    let activo = true;
    setEcCargando(true);
    rpcConReintento(() => supabase.rpc("estado_cuenta_cliente", {
      p_cliente_id: clienteId, p_desde: periodo.desde, p_hasta: periodo.hasta, p_filtro: filtroDocs, p_desde_abierta: !!periodo.desdeAbierta,
    })).then(({ data, error }) => {
      if (!activo) return;
      // Si falla un cambio de período se conserva lo que ya estaba en pantalla (con el aviso y "Reintentar")
      if (error) setEcError(error.message); else { setEc(data as EstadoCuentaCompleto); setEcError(null); }
      setEcCargando(false);
    });
    return () => { activo = false; };
  }, [clienteId, periodo.desde, periodo.hasta, periodo.desdeAbierta, filtroDocs, ecIntento]);

  const cargarEnvios = useCallback(async () => {
    const { data, error } = await supabase.rpc("envios_estado_cuenta", { p_cliente_id: clienteId });
    setEnvios(error ? [] : ((data as EnvioRow[]) ?? []));
  }, [clienteId]);
  useEffect(() => { cargarEnvios(); }, [cargarEnvios]);

  const alEnviar = useCallback(() => { cargarEnvios(); setSenal((n) => n + 1); }, [cargarEnvios]);
  const alEnlace = useCallback((u: string | null) => setEnlaceUrl(u), []);

  const facturasNormales = facturas.filter((f) => f.tipo === "factura");
  const notasCredito = facturas.filter((f) => f.tipo === "nota_credito");
  const notasDebito = facturasNormales.filter((f) => f.es_nota_debito);
  const pagosVerificados = pagos.filter((p) => p.estado === "verificado");
  const movs = useMemo(() => [...(ec?.movimientos ?? [])].reverse(), [ec?.movimientos]);

  const facPag = usePagination(facturasNormales, 10);
  const ncPag = usePagination(notasCredito, 10);
  const pagPag = usePagination(pagos, 10);
  const movPag = usePagination(movs, 25);
  const docsTabla = (filtroDocs === "abiertas" ? ec?.abiertos : ec?.documentos) ?? [];

  const facturasAplicadasPorPago = (pagoId: string) => pagoFacturas.filter((pf) => pf.pago_id === pagoId);

  const fmtFecha = (d?: string | null) => (d ? new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString("es-VE", { day: "2-digit", month: "short", year: "numeric" }) : "—");

  const volver = (
    <Button variant="ghost" size="sm" className="mb-2 h-7 gap-1.5 px-2 text-xs" onClick={() => navigate("/admin/cuentas")}>
      <ArrowLeft className="h-3.5 w-3.5" /> Volver a cuentas
    </Button>
  );

  if (loading) {
    return (
      <MainLayout title="Cuenta">
        {volver}
        <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      </MainLayout>
    );
  }

  if (!cliente) {
    return (
      <MainLayout title="Cuenta">
        {volver}
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Building2 className="mb-4 h-12 w-12 opacity-50" />
          <p>Cliente no encontrado</p>
        </div>
      </MainLayout>
    );
  }

  const iniciales = cliente.nombre_negocio.split(" ").map((w) => w[0]).join("").slice(0, 2);
  const r = ec?.resumen;
  // Mismo número que la lista de Cuentas: facturas y notas de débito con saldo menos notas de crédito a favor
  const saldoDeudor = r ? r.saldo - r.nc_a_favor : facturas.reduce((s, f) => s + Number(f.saldo_usd || 0), 0);
  const tabActivos = [reintegros.length > 0, retenciones.length > 0];

  return (
    <MainLayout title={cliente.nombre_negocio}>
      {volver}

      <div className="mb-3 flex flex-col gap-3 rounded-lg border border-border bg-card p-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar className="h-14 w-14">
            <AvatarFallback className="bg-primary/10 text-lg text-primary">{iniciales}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">{cliente.nombre_negocio}</h1>
            <p className="font-mono text-sm text-muted-foreground">{[cliente.codigo, cliente.rif].filter(Boolean).join(" · ")}</p>
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="sm:text-right">
            <p className={`text-lg font-semibold tabular-nums ${saldoDeudor > 0.009 ? "text-destructive" : ""}`} data-testid="cd-saldo">{formatPrice(saldoDeudor)}</p>
            <p className="text-sm text-muted-foreground">Saldo deudor</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <BotonPdfEstadoCuenta datos={ec} enlace={enlaceUrl} className="gap-2" />
            {puedeEditar && (
              <Button variant="outline" className="gap-2" onClick={() => setCorreoAbierto(true)} disabled={!ec} data-testid="ec-correo">
                <Mail className="h-4 w-4" /> Enviar por correo
              </Button>
            )}
            <Link to={`/admin/clientes/${cliente.id}`}><Button variant="outline" className="gap-2"><Building2 className="h-4 w-4" /> Ver cliente</Button></Link>
          </div>
        </div>
      </div>

      {ecError && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-sm" role="alert">
          <AlertCircle className="h-4 w-4 shrink-0 text-warning" />
          <span className="min-w-0 flex-1">{ec ? "No se pudo cargar el período elegido; se muestra el anterior." : "No se pudo cargar el estado de cuenta."} {ecError}</span>
          <Button size="sm" variant="outline" className="h-7" onClick={() => setEcIntento((n) => n + 1)} disabled={ecCargando}>Reintentar</Button>
        </div>
      )}
      {(!ecError || ec) && (
        <KpiStrip items={[
          { label: "Por cobrar", valor: r ? formatPrice(r.saldo) : "…", detalle: r ? `${r.facturas_abiertas} ${r.facturas_abiertas === 1 ? "documento" : "documentos"}` : undefined, tono: r && r.saldo > 0.009 ? "negativo" : "normal" },
          { label: "Vencido", valor: r ? formatPrice(r.vencido) : "…", detalle: r ? `${r.facturas_vencidas} vencidos` : undefined, tono: r && r.vencido > 0.009 ? "negativo" : "tenue" },
          { label: "Por vencer", valor: r ? formatPrice(r.por_vencer) : "…", tono: "normal" },
          { label: "A favor", valor: r ? formatPrice(r.a_favor) : "…", detalle: r ? `NC ${formatPrice(r.nc_a_favor)} · anticipos ${formatPrice(r.anticipos)}` : undefined, tono: r && r.a_favor > 0.009 ? "positivo" : "tenue" },
          { label: "Saldo neto", valor: r ? conSigno(formatPrice, r.neto) : "…", tono: "primario" },
          { label: "Notas de débito", valor: r ? formatPrice(r.notas_debito_saldo ?? 0) : "…", detalle: r ? `${r.notas_debito_abiertas ?? 0} con saldo · ${notasDebito.length} en total` : undefined, tono: "normal" },
        ]} />
      )}

      <div className="mb-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div className="space-y-3 min-w-0">
          <div className="rounded-lg border border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
              <div className="rounded-lg bg-primary/10 p-1.5"><Clock className="h-4 w-4 text-primary" /></div>
              <h2 className="text-[13px] font-semibold">Antigüedad del saldo</h2>
            </div>
            <div className="p-3">
              {ecCargando && !ec ? <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                : !r || r.saldo <= 0 ? <p className="py-3 text-center text-sm text-muted-foreground">Sin saldo pendiente.</p>
                : <Antiguedad resumen={r} enlaces={false} />}
            </div>
          </div>

          <TarjetaMetricas clienteId={cliente.id} formatPrice={formatPrice} />
        </div>

        <div className="space-y-3 min-w-0">
          <EnlacePublicoPanel clienteId={cliente.id} puedeEditar={puedeEditar} onEnlace={alEnlace} recargarSenal={senal} />
          <div className="rounded-lg border border-border bg-card" data-testid="ec-envios">
            <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-primary/10 p-1.5"><Send className="h-4 w-4 text-primary" /></div>
                <h2 className="text-[13px] font-semibold">Envíos por correo ({envios?.length ?? 0})</h2>
              </div>
            </div>
            {envios === null ? (
              <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
            ) : envios.length === 0 ? (
              <p className="p-3 text-center text-xs text-muted-foreground">Aún no se ha enviado el estado de cuenta por correo.</p>
            ) : (
              <ul className="max-h-72 divide-y divide-border overflow-y-auto">
                {envios.map((e) => (
                  <li key={e.id} className="space-y-0.5 px-3 py-2 text-xs" data-testid="ec-envio">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">{fechaHora(e.enviado_at ?? e.creado_at)}{e.lote_id ? " · masivo" : ""}</span>
                      <span className="flex gap-1">
                        {e.entrega && <Badge variant={ENTREGA[e.entrega].variant} className="px-1.5 py-0 text-[10px]" title={e.entrega_detalle ?? undefined}>{ENTREGA[e.entrega].label}</Badge>}
                        <Badge variant={ESTADO_ENVIO[e.estado].variant} className="px-1.5 py-0 text-[10px]">{ESTADO_ENVIO[e.estado].label}</Badge>
                      </span>
                    </div>
                    <p className="truncate font-medium" title={e.destinatarios.join(", ")}>{e.destinatarios.join(", ")}</p>
                    <p className="truncate text-muted-foreground" title={e.error ?? undefined}>
                      {e.enviado_por ?? "—"}{e.resend_id ? ` · id ${e.resend_id}` : ""}{e.error ? ` · ${e.error}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <div className="-mx-1 overflow-x-auto px-1">
          <TabsList className="h-8">
            <TabsTrigger value="documentos" className="h-6 text-xs" data-testid="tab-documentos">Documentos ({ec?.abiertos?.length ?? 0} con saldo)</TabsTrigger>
            <TabsTrigger value="movimientos" className="h-6 text-xs">Movimientos ({ec?.movimientos.length ?? 0})</TabsTrigger>
            <TabsTrigger value="facturas" className="h-6 text-xs">Facturas y ND ({facturasNormales.length})</TabsTrigger>
            <TabsTrigger value="nc" className="h-6 text-xs">Notas de crédito ({notasCredito.length})</TabsTrigger>
            <TabsTrigger value="pagos" className="h-6 text-xs">Pagos ({pagos.length})</TabsTrigger>
            {tabActivos[0] && <TabsTrigger value="reintegros" className="h-6 text-xs">Reintegros ({reintegros.length})</TabsTrigger>}
            {tabActivos[1] && <TabsTrigger value="retenciones" className="h-6 text-xs">Retenciones ({retenciones.length})</TabsTrigger>}
          </TabsList>
        </div>

        {/* Cruce por documento (el mismo del enlace público, el PDF, el correo y el portal) */}
        <TabsContent value="documentos" className="mt-2">
          <div className="rounded-lg border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-primary/10 p-1.5"><FileText className="h-4 w-4 text-primary" /></div>
                <h2 className="text-[13px] font-semibold">{filtroDocs === "abiertas" ? "Documentos con saldo" : filtroDocs === "todas" ? "Documentos emitidos en el período" : "Documentos pagados en el período"}</h2>
                {filtroDocs !== "abiertas" && ec && <span className="text-xs text-muted-foreground">{textoPeriodo(ec)}</span>}
                {ecCargando && ec && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              </div>
              <FiltroDocumentosSelector valor={filtroDocs} onCambio={setFiltroDocs} />
            </div>
            {!ec ? (
              <p className="p-5 text-center text-sm text-muted-foreground">{ecCargando ? "Cargando…" : ecError ?? "Sin datos"}</p>
            ) : (
              <TablaDocumentos docs={docsTabla} modo="admin" formato={formatPrice} enlace={(d) => (d.factura_id ? `/admin/facturas/${d.factura_id}` : null)}
                onComentar={(d) => setComentando(d)} totales={filtroDocs === "abiertas"} testId="cd-documentos"
                vacio={<p className="p-5 text-center text-sm text-muted-foreground">{filtroDocs === "abiertas" ? "No hay documentos con saldo." : "No hay documentos en este período."}</p>} />
            )}
            {ec && filtroDocs !== "abiertas" && (
              <p className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">El período es el de la pestaña Movimientos ({textoPeriodo(ec).toLowerCase()}).</p>
            )}
            <p className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
              «Qué falta» es una sugerencia automática (tolerancia {formatPrice(ec?.tolerancia ?? 0.05)}); los comentarios los escribe el equipo. Los visibles salen en el enlace, el PDF, el correo y el portal; los internos (candado) solo aquí.
            </p>
          </div>
        </TabsContent>

        {/* Libro de movimientos con saldo corrido (el mismo del PDF y del enlace público) */}
        <TabsContent value="movimientos" className="mt-2">
          <div className="rounded-lg border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-primary/10 p-1.5"><Wallet className="h-4 w-4 text-primary" /></div>
                <h2 className="text-[13px] font-semibold">Estado de cuenta</h2>
                {ec && <span className="text-xs text-muted-foreground">{textoPeriodo(ec)}</span>}
                {ecCargando && ec && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              </div>
              <div className="flex rounded-md border border-border bg-background p-0.5" role="group" aria-label="Período">
                {([["abierta", "Desde la abierta más antigua"], ["30", "30 días"], ["90", "90 días"], ["anio", "Este año"], ["todo", "Todo"]] as [Rango, string][]).map(([v, t]) => (
                  <button key={v} type="button" onClick={() => setRango(v)} aria-pressed={rango === v}
                    className={cn("rounded px-2 py-0.5 text-xs", rango === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{t}</button>
                ))}
              </div>
            </div>
            {!ec ? (
              <p className="p-5 text-center text-sm text-muted-foreground">{ecCargando ? "Cargando…" : ecError ?? "Sin datos"}</p>
            ) : (
              <>
                <div className="flex items-center justify-between border-b border-border bg-muted/20 px-3 py-1.5 text-sm font-semibold">
                  <span>Saldo al {fmtFecha(ec.periodo.hasta ?? ec.hoy)}</span><span className="tabular-nums" data-testid="cd-saldo-final">{conSigno(formatPrice, ec.saldo_final)}</span>
                </div>
                {movs.length === 0 ? (
                  <p className="p-5 text-center text-sm text-muted-foreground">Sin movimientos en este período.</p>
                ) : (
                  <Table data-testid="cd-movimientos">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fecha</TableHead><TableHead>Documento</TableHead><TableHead>Concepto</TableHead>
                        <TableHead className="text-right">Cargo</TableHead><TableHead className="text-right">Abono</TableHead><TableHead className="text-right">Saldo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {movPag.pageItems.map((m, i) => (
                        <TableRow key={`${m.tipo}-${m.documento}-${m.fecha}-${i}`} data-tipo={m.tipo}>
                          <TableCell className="whitespace-nowrap text-muted-foreground">{fmtFecha(m.fecha)}</TableCell>
                          <TableCell className="font-mono text-sm">
                            {m.factura_id ? <Link to={`/admin/facturas/${m.factura_id}`} className="text-primary hover:underline">{m.documento}</Link> : <span className="text-muted-foreground">{m.tipo === "redondeo" ? "—" : m.documento || "—"}</span>}
                          </TableCell>
                          <TableCell>
                            {m.tipo === "nota_debito" ? <Badge variant="outline" className="whitespace-nowrap px-1.5 py-0 text-[11px]">{conceptoMovimiento(m as Movimiento)}</Badge> : conceptoMovimiento(m as Movimiento)}
                            {(m.tipo === "factura" || m.tipo === "nota_debito") && m.vence && m.estado !== "anulado" && <span className="ml-1.5 text-xs text-muted-foreground">vence {fmtFecha(m.vence)}</span>}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right tabular-nums">{m.monto > 0 ? formatPrice(m.monto) : ""}</TableCell>
                          <TableCell className="whitespace-nowrap text-right tabular-nums text-success">{m.monto < 0 ? formatPrice(-m.monto) : ""}</TableCell>
                          <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">{conSigno(formatPrice, m.saldo)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
                {movs.length > 0 && <DataTablePagination pagination={movPag} />}
                {ec.periodo.desde && (
                  <div className="flex items-center justify-between border-t border-border bg-muted/20 px-3 py-1.5 text-sm text-muted-foreground">
                    <span>Saldo anterior al {fmtFecha(ec.periodo.desde)}</span><span className="tabular-nums">{conSigno(formatPrice, ec.saldo_inicial)}</span>
                  </div>
                )}
                {!!ec.ajustes_cambiarios && (
                  <p className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground" data-testid="cd-ajustes">
                    No se listan {ec.ajustes_cambiarios} {ec.ajustes_cambiarios === 1 ? "ajuste" : "ajustes"} por diferencial cambiario (notas de débito o de crédito en bolívares de 0,00 USD): no cambian el saldo. Están en la pestaña de facturas.
                  </p>
                )}
              </>
            )}
          </div>
        </TabsContent>

        {/* Facturas y notas de débito */}
        <TabsContent value="facturas" className="mt-2">
          <div className="rounded-lg border border-border bg-card">
            {facturasNormales.length === 0 ? (
              <p className="p-5 text-center text-sm text-muted-foreground">Este cliente no tiene facturas.</p>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nº</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Emisión</TableHead>
                      <TableHead>Vencimiento</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Saldo</TableHead>
                      <TableHead>Estado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {facPag.pageItems.map((f) => (
                      <TableRow key={f.id}>
                        <TableCell className="font-mono text-sm"><Link to={`/admin/facturas/${f.id}`} className="text-primary hover:underline">{f.numero}</Link></TableCell>
                        <TableCell>{f.es_nota_debito ? <Badge variant="outline" className="whitespace-nowrap px-1.5 py-0 text-[11px]">Nota de débito</Badge> : <span className="text-muted-foreground">Factura</span>}</TableCell>
                        <TableCell className="text-muted-foreground">{fmtFecha(f.fecha_emision)}</TableCell>
                        <TableCell className="text-muted-foreground">{fmtFecha(f.fecha_vencimiento)}</TableCell>
                        <TableCell className="text-right">{formatPrice(f.total_usd)}</TableCell>
                        <TableCell className={`text-right font-semibold ${f.saldo_usd > 0.009 ? "text-destructive" : ""}`}>{formatPrice(f.saldo_usd)}</TableCell>
                        <TableCell><Badge variant={ESTADO_COBRO[f.estado_cobro]?.variant ?? "secondary"}>{ESTADO_COBRO[f.estado_cobro]?.label ?? f.estado_cobro}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <DataTablePagination pagination={facPag} />
              </>
            )}
          </div>
        </TabsContent>

        {/* Notas de crédito */}
        <TabsContent value="nc" className="mt-2">
          <div className="rounded-lg border border-border bg-card">
            {notasCredito.length === 0 ? (
              <p className="p-5 text-center text-sm text-muted-foreground">Este cliente no tiene notas de crédito.</p>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nº</TableHead>
                      <TableHead>Emisión</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Saldo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ncPag.pageItems.map((f) => (
                      <TableRow key={f.id}>
                        <TableCell className="font-mono text-sm"><Link to={`/admin/facturas/${f.id}`} className="text-primary hover:underline">{f.numero}</Link></TableCell>
                        <TableCell className="text-muted-foreground">{fmtFecha(f.fecha_emision)}</TableCell>
                        <TableCell className="text-right">{formatPrice(f.total_usd)}</TableCell>
                        <TableCell className="text-right font-semibold text-success">{formatPrice(f.saldo_usd)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <DataTablePagination pagination={ncPag} />
              </>
            )}
          </div>
        </TabsContent>

        {/* Pagos */}
        <TabsContent value="pagos" className="mt-2">
          <div className="rounded-lg border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/30 px-3 py-1.5">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-success/10 p-1.5"><HandCoins className="h-4 w-4 text-success" /></div>
                <h2 className="text-[13px] font-semibold">Pagos ({pagos.length})</h2>
              </div>
              <p className="text-sm text-muted-foreground">
                Verificados: <span className="font-semibold text-foreground">{formatPrice(pagosVerificados.reduce((s, p) => s + Number(p.monto), 0))}</span>
              </p>
            </div>
            {pagos.length === 0 ? (
              <p className="p-5 text-center text-sm text-muted-foreground">Este cliente no tiene pagos registrados.</p>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nº</TableHead>
                      <TableHead>Banco</TableHead>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="text-right">Monto</TableHead>
                      <TableHead>Aplicado a</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagPag.pageItems.map((p) => {
                      const aplicaciones = facturasAplicadasPorPago(p.id);
                      return (
                        <TableRow key={p.id}>
                          <TableCell className="font-mono text-sm text-primary">
                            <span className="flex items-center gap-1.5">{p.numero}{p.odoo_id && <OdooBadge />}{p.es_igtf && <Badge variant="outline" className="px-1 py-0 text-[10px]">IGTF</Badge>}</span>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{p.banco?.nombre || "—"}</TableCell>
                          <TableCell className="text-muted-foreground">{fmtFecha(p.fecha_verificacion || p.created_at)}</TableCell>
                          <TableCell>
                            <Badge variant={p.estado === "verificado" ? "default" : p.estado === "pendiente" ? "secondary" : "destructive"}>{p.estado}</Badge>
                          </TableCell>
                          <TableCell className="text-right font-semibold">{formatPrice(p.monto)}</TableCell>
                          <TableCell className="max-w-xs">
                            {aplicaciones.length === 0 ? (
                              <span className="flex items-center gap-1 text-xs text-muted-foreground"><Wallet className="h-3 w-3" /> Sin aplicar (anticipo)</span>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {aplicaciones.map((a, i) => (
                                  <span key={`${a.factura_id}-${i}`} className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                                    {a.factura?.numero} · {formatPrice(a.monto_aplicado)}
                                  </span>
                                ))}
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                <DataTablePagination pagination={pagPag} />
              </>
            )}
          </div>
        </TabsContent>

        {tabActivos[0] && (
          <TabsContent value="reintegros" className="mt-2">
            <div className="rounded-lg border border-border bg-card">
              <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
                <h2 className="text-[13px] font-semibold">Reintegros al cliente ({reintegros.length})</h2><OdooBadge titulo="Pagos salientes al cliente registrados en Odoo" />
              </div>
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Nº</TableHead><TableHead>Banco</TableHead><TableHead>Fecha</TableHead><TableHead>Referencia</TableHead><TableHead className="text-right">Monto</TableHead><TableHead>Estado</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {reintegros.map((ri) => (
                    <TableRow key={ri.id}>
                      <TableCell className="font-mono text-sm text-primary">{ri.numero}</TableCell>
                      <TableCell className="text-muted-foreground">{ri.banco?.nombre || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{fmtFecha(ri.fecha)}</TableCell>
                      <TableCell className="text-muted-foreground">{ri.referencia || "—"}</TableCell>
                      <TableCell className="text-right font-semibold">{formatPrice(ri.monto)}</TableCell>
                      <TableCell><Badge variant={ri.estado === "verificado" ? "default" : ri.estado === "pendiente" ? "secondary" : "destructive"}>{ri.estado}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        )}

        {tabActivos[1] && (
          <TabsContent value="retenciones" className="mt-2">
            <div className="rounded-lg border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Nº</TableHead><TableHead>Tipo</TableHead><TableHead>Fecha</TableHead><TableHead className="text-right">Monto</TableHead><TableHead>Estado</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {retenciones.map((rt) => (
                    <TableRow key={rt.id}>
                      <TableCell className="font-mono text-sm text-primary">{rt.numero}{rt.odoo_id && <OdooBadge className="ml-1.5" />}</TableCell>
                      <TableCell className="uppercase text-muted-foreground">{rt.tipo}</TableCell>
                      <TableCell className="text-muted-foreground">{fmtFecha(rt.fecha)}</TableCell>
                      <TableCell className="text-right font-semibold">{formatPrice(rt.total)}</TableCell>
                      <TableCell><Badge variant={ESTADO_RETENCION[rt.estado]?.variant ?? "secondary"}>{ESTADO_RETENCION[rt.estado]?.label ?? rt.estado}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        )}
      </Tabs>

      <EnviarEstadoCuentaDialog open={correoAbierto} onOpenChange={setCorreoAbierto} clienteId={cliente.id} datos={ec} onEnviado={alEnviar} />
      <ComentariosFacturaDialog facturaId={comentando?.factura_id ?? null} numero={comentando?.numero} open={!!comentando}
        onOpenChange={(o) => { if (!o) setComentando(null); }} puedeEditar={puedeEditar} onCambio={() => setEcIntento((n) => n + 1)} />
    </MainLayout>
  );
};

export default CuentaDetalle;
