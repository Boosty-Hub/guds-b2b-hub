import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeftRight, Banknote, Camera, CheckCircle2, FileText, ImagePlus, Loader2, MessageCircle, Plus, Trash2, User, Wand2, X,
} from "lucide-react";
import { VendedorLayout, BarraSuperiorMovil } from "@/components/vendedor/VendedorLayout";
import { ElegirClienteVendedor } from "@/components/vendedor/ElegirClienteVendedor";
import { useCarteraVendedor } from "@/components/vendedor/cartera";
import { borrarComprobanteCobro, subirComprobanteCobro, useUrlComprobante, esPdfComprobante } from "@/components/vendedor/comprobantes";
import { enlaceWhatsApp } from "@/components/vendedor/contacto";
import { fechaCorta, nuevaClave, type ClienteCartera } from "@/components/vendedor/tipos";
import { useCuentasPago, metodosDeCuenta, METODO_LABEL, type CuentaPago } from "@/hooks/useCuentasPago";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { useToast } from "@/hooks/use-toast";

// Registrar un cobro con evidencia (plan de portales §5, V4; decisiones del dueño del 28-sep): varias líneas en Bs y USD, cada
// una a una cuenta de la empresa del cliente o en efectivo; tasa BCV de la FECHA DEL PAGO; foto del comprobante con la cámara
// (comprimida, bucket privado); propuesta de aplicación a sus facturas (FIFO por vencimiento sugerido, editable). Todo queda
// pendiente: administración lo verifica y confirma o corrige la aplicación. Envío idempotente (registrar_cobro_vendedor con
// la clave del cobro).

const EFECTIVO = "efectivo";
const hoyCaracas = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Caracas" });
const restarDias = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
const redondear = (n: number) => Math.round(n * 100) / 100;

interface LineaCobro {
  id: string;
  cuenta_id: string;           // id de la cuenta o "efectivo"
  metodo: string;
  moneda: "USD" | "BS";        // en efectivo la elige el vendedor; con cuenta, la de la cuenta
  monto: string;
  fecha: string;
  referencia: string;
  comprobante: string | null;  // ruta en el bucket
  subiendo: boolean;
  errorArchivo: string | null;
}
interface FacturaAbierta { id: string; numero: string; fecha_emision: string | null; fecha_vencimiento: string | null; saldo_usd: number; total_usd: number; es_saldo_inicial: boolean | null }
interface Resultado { lote: string; repetido: boolean; pagos: { id: string; numero: string; monto: number }[]; total_usd: number; propuesto: number; a_favor: number }

const lineaNueva = (): LineaCobro => ({
  id: nuevaClave(), cuenta_id: "", metodo: "transferencia", moneda: "USD", monto: "", fecha: hoyCaracas(), referencia: "", comprobante: null, subiendo: false, errorArchivo: null,
});

const VendedorCobroNuevo = () => {
  const [params, setParams] = useSearchParams();
  const clienteId = params.get("cliente");
  const { user } = useAuth();
  const { clientes, cargando } = useCarteraVendedor();
  const { empresas, seleccion, cambiarEmpresa } = useEmpresa();
  const cliente = clienteId ? clientes.find((c) => c.id === clienteId) : undefined;
  const empresaCliente = cliente?.empresa_id ?? null;
  const cambiando = !!empresaCliente && seleccion !== empresaCliente && empresas.some((e) => e.id === empresaCliente);
  useEffect(() => { if (cambiando && empresaCliente) cambiarEmpresa(empresaCliente); }, [cambiando, empresaCliente, cambiarEmpresa]);
  const elegir = (id: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (id) n.set("cliente", id); else n.delete("cliente"); return n; });

  if (!clienteId) {
    return <ElegirClienteVendedor titulo="Registrar cobro" pregunta="¿De qué cliente es el cobro?" volverA="/vendedor/pagos" clientes={clientes}
      cargando={cargando} usuarioId={user?.id} onElegir={elegir} soloConDeuda />;
  }
  if (cargando || cambiando) {
    return (
      <VendedorLayout title="Registrar cobro" pantallaCompletaMovil>
        <BarraSuperiorMovil titulo="Registrar cobro" volverA="/vendedor/pagos" />
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-emerald-700" /></div>
      </VendedorLayout>
    );
  }
  if (!cliente) {
    return (
      <VendedorLayout title="Registrar cobro" pantallaCompletaMovil>
        <BarraSuperiorMovil titulo="Registrar cobro" onVolver={() => elegir(null)} />
        <div className="mx-auto max-w-md space-y-3 p-4 py-10 text-center" data-testid="cliente-no-encontrado">
          <User className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="font-semibold">Este cliente no está en tu cartera activa</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" onClick={() => elegir(null)}>Elegir cliente</Button>
            {empresas.filter((e) => e.id !== seleccion).map((e) => <Button key={e.id} variant="outline" onClick={() => cambiarEmpresa(e.id)}>Buscar en {e.nombre_corto}</Button>)}
          </div>
        </div>
      </VendedorLayout>
    );
  }
  return <FormularioCobro key={cliente.id} cliente={cliente} usuarioId={user?.id ?? ""} vendedor={user ? `${user.nombre} ${user.apellido || ""}`.trim() : ""} onCambiarCliente={() => elegir(null)} />;
};

function FormularioCobro({ cliente, usuarioId, vendedor, onCambiarCliente }: { cliente: ClienteCartera; usuarioId: string; vendedor: string; onCambiarCliente: () => void }) {
  const { formatPrice } = useCurrency();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { cuentas, loading: cargandoCuentas } = useCuentasPago();
  const [lineas, setLineas] = useState<LineaCobro[]>([lineaNueva()]);
  const [facturas, setFacturas] = useState<FacturaAbierta[] | null>(null);
  const [asig, setAsig] = useState<Record<string, string>>({});
  const [manual, setManual] = useState(false);
  const [notas, setNotas] = useState("");
  const [tasas, setTasas] = useState<Record<string, { tasa: number; fecha: string } | null>>({});
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const enviandoRef = useRef(false);
  const lote = useRef(nuevaClave());
  // Si se sale sin registrar, se borran los comprobantes subidos (el servidor no deja borrar los que ya usa un pago)
  const vivos = useRef<{ lineas: LineaCobro[]; registrado: boolean }>({ lineas: [], registrado: false });
  vivos.current.lineas = lineas;
  vivos.current.registrado = !!resultado;
  useEffect(() => () => {
    if (!vivos.current.registrado) vivos.current.lineas.forEach((l) => { if (l.comprobante) borrarComprobanteCobro(l.comprobante); });
  }, []);
  const hoy = hoyCaracas();
  const minFecha = restarDias(hoy, 90);

  const cuentasCliente = useMemo(() => cuentas.filter((c) => !c.empresa_id || !cliente.empresa_id || c.empresa_id === cliente.empresa_id), [cuentas, cliente.empresa_id]);
  const cuentaDe = (l: LineaCobro): CuentaPago | undefined => (l.cuenta_id && l.cuenta_id !== EFECTIVO ? cuentasCliente.find((c) => c.id === l.cuenta_id) : undefined);
  const monedaDe = (l: LineaCobro): "USD" | "BS" => { const c = cuentaDe(l); return c ? (c.moneda === "BS" ? "BS" : "USD") : l.moneda; };

  // Facturas abiertas del cliente, FIFO por vencimiento (sin notas de crédito: se aplican aparte)
  useEffect(() => {
    supabase.from("facturas").select("id, numero, fecha_emision, fecha_vencimiento, saldo_usd, total_usd, es_saldo_inicial, estado_pago")
      .eq("cliente_id", cliente.id).eq("estado", "posted").eq("tipo", "factura").gt("saldo_usd", 0.009)
      .then(({ data }) => {
        const lista = ((data ?? []) as (FacturaAbierta & { estado_pago: string | null })[]).filter((f) => f.estado_pago !== "anulado")
          .map((f) => ({ ...f, saldo_usd: Number(f.saldo_usd), total_usd: Number(f.total_usd) }))
          .sort((a, b) => (a.fecha_vencimiento || a.fecha_emision || "").localeCompare(b.fecha_vencimiento || b.fecha_emision || "") || a.numero.localeCompare(b.numero));
        setFacturas(lista);
      });
  }, [cliente.id]);

  // Tasa BCV de cada fecha usada en líneas en Bs (la última publicada hasta ese día, como el servidor)
  const fechasBs = useMemo(() => [...new Set(lineas.filter((l) => monedaDe(l) === "BS" && l.fecha).map((l) => l.fecha))], [lineas, cuentasCliente]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    fechasBs.filter((f) => !(f in tasas)).forEach(async (f) => {
      const { data } = await supabase.from("tasa_bcv").select("tasa, fecha").lte("fecha", f).gt("tasa", 0)
        .order("fecha", { ascending: false }).order("created_at", { ascending: false }).limit(1).maybeSingle();
      setTasas((t) => ({ ...t, [f]: data ? { tasa: Number((data as { tasa: number }).tasa), fecha: (data as { fecha: string }).fecha } : null }));
    });
  }, [fechasBs, tasas]);

  const usdDe = (l: LineaCobro) => {
    const m = Number(l.monto.replace(",", "."));
    if (!(m > 0)) return 0;
    if (monedaDe(l) === "USD") return redondear(m);
    const t = tasas[l.fecha]?.tasa;
    return t ? redondear(m / t) : 0;
  };
  const total = redondear(lineas.reduce((s, l) => s + usdDe(l), 0));

  // Propuesta FIFO: se recalcula con el total mientras el vendedor no la edite a mano
  const fifo = useCallback((monto: number) => {
    const out: Record<string, string> = {};
    let resto = monto;
    for (const f of facturas ?? []) {
      if (resto <= 0.004) break;
      const toma = redondear(Math.min(resto, f.saldo_usd));
      if (toma > 0) { out[f.id] = toma.toFixed(2); resto = redondear(resto - toma); }
    }
    return out;
  }, [facturas]);
  useEffect(() => { if (!manual) setAsig(fifo(total)); }, [total, manual, fifo]);
  const propuesto = redondear(Object.values(asig).reduce((s, v) => s + (Number(v) || 0), 0));
  const excede = propuesto > total + 0.01;
  const facturaExcedida = (facturas ?? []).find((f) => (Number(asig[f.id]) || 0) > f.saldo_usd + 0.01);

  const cambiar = (id: string, f: (l: LineaCobro) => Partial<LineaCobro>) => setLineas((ls) => ls.map((l) => (l.id === id ? { ...l, ...f(l) } : l)));
  const elegirCuenta = (l: LineaCobro, v: string) => {
    const c = cuentasCliente.find((x) => x.id === v);
    const monedaNueva = v === EFECTIVO ? l.moneda : c?.moneda === "BS" ? "BS" : "USD";
    cambiar(l.id, () => ({
      cuenta_id: v, metodo: v === EFECTIVO ? EFECTIVO : "transferencia",
      // Al cambiar de moneda el número escrito ya no vale: nunca un monto en USD con etiqueta de Bs.
      monto: l.cuenta_id && monedaNueva !== monedaDe(l) ? "" : l.monto,
      moneda: monedaNueva, referencia: v === EFECTIVO ? "" : l.referencia,
    }));
  };
  const adjuntar = async (l: LineaCobro, archivo: File | undefined) => {
    if (!archivo) return;
    cambiar(l.id, () => ({ subiendo: true, errorArchivo: null }));
    try {
      const ruta = await subirComprobanteCobro(usuarioId, cliente.id, archivo);
      if (l.comprobante) borrarComprobanteCobro(l.comprobante);
      cambiar(l.id, () => ({ comprobante: ruta, subiendo: false }));
    } catch (e) {
      cambiar(l.id, () => ({ subiendo: false, errorArchivo: (e as Error).message }));
    }
  };
  const quitarComprobante = (l: LineaCobro) => { if (l.comprobante) borrarComprobanteCobro(l.comprobante); cambiar(l.id, () => ({ comprobante: null })); };
  const quitarLinea = (l: LineaCobro) => { if (l.comprobante) borrarComprobanteCobro(l.comprobante); setLineas((ls) => ls.filter((x) => x.id !== l.id)); };

  // Validación (la misma que hace el servidor)
  const problemas = (l: LineaCobro): string[] => {
    const p: string[] = [];
    if (!l.cuenta_id) p.push("Indica dónde pagó el cliente");
    if (!(Number(l.monto.replace(",", ".")) > 0)) p.push("Falta el monto");
    if (!l.fecha || l.fecha > hoy || l.fecha < minFecha) p.push("Fecha fuera de rango (hasta 90 días atrás)");
    if (l.cuenta_id && l.cuenta_id !== EFECTIVO && l.referencia.trim().length < 4) p.push("Falta la referencia (mínimo 4 caracteres)");
    if (!l.comprobante) p.push("Falta el comprobante");
    if (monedaDe(l) === "BS" && l.fecha in tasas && !tasas[l.fecha]) p.push("No hay tasa BCV para esa fecha");
    return p;
  };
  const todosProblemas = lineas.flatMap(problemas);
  const subiendo = lineas.some((l) => l.subiendo);
  const puedeEnviar = !enviando && !subiendo && todosProblemas.length === 0 && total > 0 && !excede && !facturaExcedida;

  const enviar = async () => {
    if (enviandoRef.current || !puedeEnviar) return;
    enviandoRef.current = true;
    setEnviando(true);
    try {
      const { data, error } = await supabase.rpc("registrar_cobro_vendedor", {
        p_cliente_id: cliente.id,
        p_lineas: lineas.map((l) => ({
          banco_id: l.cuenta_id === EFECTIVO ? null : l.cuenta_id, metodo: l.cuenta_id === EFECTIVO ? EFECTIVO : l.metodo, moneda: monedaDe(l),
          monto: Number(l.monto.replace(",", ".")), referencia: l.referencia.trim() || null, fecha_pago: l.fecha, comprobante: l.comprobante,
        })),
        p_propuesta: (facturas ?? []).filter((f) => (Number(asig[f.id]) || 0) > 0).map((f) => ({ factura_id: f.id, monto: redondear(Number(asig[f.id])) })),
        p_lote: lote.current,
        p_notas: notas.trim() || null,
      });
      if (error) { toast({ title: "No se pudo registrar el cobro", description: error.message, variant: "destructive" }); return; }
      setResultado(data as Resultado);
      window.scrollTo({ top: 0 });
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  };

  const cabecera = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-card px-3 py-2" data-testid="cabecera-cliente">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{cliente.nombre_negocio}</p>
        <p className="text-xs text-muted-foreground">
          Por cobrar <span className="font-semibold text-foreground">{formatPrice(cliente.por_cobrar)}</span>
          {cliente.vencido > 0.009 && <> · vencido <span className="font-semibold text-destructive">{formatPrice(cliente.vencido)}</span></>}
          {cliente.a_favor < -0.009 && <> · a favor {formatPrice(Math.abs(cliente.a_favor))}</>}
        </p>
      </div>
      <button type="button" onClick={onCambiarCliente} className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-muted">
        <ArrowLeftRight className="h-3.5 w-3.5" />Cambiar
      </button>
    </div>
  );

  if (resultado) {
    const recibo = `Recibí de ${cliente.nombre_negocio} ${formatPrice(resultado.total_usd)} (${resultado.pagos.map((p) => p.numero).join(", ")}), pendiente de verificación por administración.${vendedor ? ` ${vendedor}.` : ""}`;
    return (
      <VendedorLayout title="Cobro registrado" pantallaCompletaMovil>
        <BarraSuperiorMovil titulo="Cobro registrado" volverA="/vendedor/pagos" />
        <div className="mx-auto max-w-lg space-y-3 p-4 md:p-0" data-testid="cobro-registrado">
          <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-center text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100">
            <CheckCircle2 className="mx-auto mb-2 h-8 w-8" />
            <p className="font-semibold">{resultado.repetido ? "Este cobro ya estaba registrado" : "Cobro registrado"}</p>
            <p className="text-sm">{formatPrice(resultado.total_usd)} · {resultado.pagos.length} {resultado.pagos.length === 1 ? "línea" : "líneas"} ({resultado.pagos.map((p) => p.numero).join(", ")})</p>
            <p className="mt-1 text-xs">Queda pendiente: administración lo verifica y confirma la aplicación a facturas.
              {Number(resultado.propuesto) > 0 ? ` Propuesto ${formatPrice(Number(resultado.propuesto))}.` : ""}{Number(resultado.a_favor) > 0.009 ? ` A favor ${formatPrice(Number(resultado.a_favor))}.` : ""}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button asChild variant="outline" className="h-10 gap-1.5">
              <a href={enlaceWhatsApp(cliente.celular || cliente.telefono, recibo)} target="_blank" rel="noopener noreferrer"><MessageCircle className="h-4 w-4" />Enviar recibo por WhatsApp</a>
            </Button>
            <Button className="h-10 bg-emerald-700 text-white hover:bg-emerald-800" onClick={() => navigate("/vendedor/pagos")}>Ver mis cobros</Button>
          </div>
          <Link to={`/vendedor/clientes/${cliente.id}`} className="block text-center text-sm text-emerald-700 hover:underline dark:text-emerald-400">Volver a la ficha del cliente</Link>
        </div>
      </VendedorLayout>
    );
  }

  const facturasBloque = (
    <section className="rounded-lg border border-border bg-card" data-testid="propuesta-facturas">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-2">
        <h2 className="text-[13px] font-semibold">Aplicar a facturas <span className="font-normal text-muted-foreground">· propuesta</span></h2>
        <button type="button" onClick={() => { setManual(false); setAsig(fifo(total)); }} className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400" data-testid="sugerir-fifo">
          <Wand2 className="h-3.5 w-3.5" />Sugerir (más vieja primero)
        </button>
      </header>
      {facturas === null ? <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-emerald-700" /></div>
        : facturas.length === 0 ? <p className="px-3 py-4 text-sm text-muted-foreground">El cliente no tiene facturas pendientes: el cobro queda como saldo a favor.</p>
        : (
          <ul className="divide-y divide-border lg:max-h-[46vh] lg:overflow-y-auto">
            {facturas.map((f) => {
              const v = asig[f.id] ?? "";
              const marcada = (Number(v) || 0) > 0;
              const dias = f.fecha_vencimiento ? Math.floor((Date.parse(`${hoy}T12:00:00`) - Date.parse(`${f.fecha_vencimiento}T12:00:00`)) / 86400000) : 0;
              return (
                <li key={f.id} className="flex items-center gap-2 px-3 py-2" data-testid="factura-propuesta">
                  <Checkbox checked={marcada} aria-label={`Aplicar a la factura ${f.numero}`}
                    onCheckedChange={(c) => {
                      setManual(true);
                      setAsig((a) => {
                        if (!c) { const n = { ...a }; delete n[f.id]; return n; }
                        const usado = Object.entries(a).filter(([k]) => k !== f.id).reduce((s, [, x]) => s + (Number(x) || 0), 0);
                        return { ...a, [f.id]: Math.max(0, redondear(Math.min(f.saldo_usd, total - usado))).toFixed(2) };
                      });
                    }} />
                  <div className="min-w-0 flex-1 text-[13px]">
                    <p className="font-medium">Factura {f.numero}{f.es_saldo_inicial ? <span className="ml-1 text-[11px] font-normal text-muted-foreground">· saldo inicial</span> : null}</p>
                    <p className="text-[11px] text-muted-foreground">
                      Vence {fechaCorta(f.fecha_vencimiento)}{dias > 0 ? <span className="text-destructive"> · {dias} d vencida</span> : ""} · saldo <span className="tabular-nums">{formatPrice(f.saldo_usd)}</span>
                    </p>
                  </div>
                  <div className="w-24 shrink-0">
                    <Input type="text" inputMode="decimal" value={v} placeholder="0.00" aria-label={`Monto para la factura ${f.numero} (USD)`}
                      className={cn("h-9 text-right tabular-nums", (Number(v) || 0) > f.saldo_usd + 0.01 && "border-destructive")}
                      onChange={(e) => { setManual(true); const x = e.target.value.replace(/[^\d.]/g, ""); setAsig((a) => ({ ...a, [f.id]: x })); }} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      <div className="space-y-0.5 border-t border-border px-3 py-2 text-xs">
        <div className="flex justify-between"><span className="text-muted-foreground">Total del cobro</span><span className="font-semibold tabular-nums" data-testid="total-cobro">{formatPrice(total)}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Propuesto a facturas</span><span className={cn("tabular-nums", excede && "font-semibold text-destructive")} data-testid="total-propuesto">{formatPrice(propuesto)}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Queda a favor del cliente</span><span className="tabular-nums">{formatPrice(Math.max(0, redondear(total - propuesto)))}</span></div>
        {excede && <p className="text-destructive">La propuesta supera el total del cobro.</p>}
        {facturaExcedida && <p className="text-destructive">La factura {facturaExcedida.numero} solo tiene saldo {formatPrice(facturaExcedida.saldo_usd)}.</p>}
      </div>
    </section>
  );

  return (
    <VendedorLayout title="Registrar cobro" pantallaCompletaMovil>
      <BarraSuperiorMovil titulo="Registrar cobro" subtitulo={cliente.nombre_negocio} volverA="/vendedor/pagos" />
      <div className="mx-auto max-w-5xl space-y-3 p-3 pb-28 md:p-0 md:pb-4" data-testid="formulario-cobro">
        <Link to="/vendedor/pagos" className="hidden h-8 items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground md:inline-flex">← Cobros</Link>
        {cabecera}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:items-start">
          <div className="min-w-0 space-y-3">
            {lineas.map((l, i) => (
              <LineaPago key={l.id} l={l} n={i + 1} total={lineas.length} cuentas={cuentasCliente} cargandoCuentas={cargandoCuentas}
                moneda={monedaDe(l)} cuenta={cuentaDe(l)} tasa={tasas[l.fecha]} usd={usdDe(l)} hoy={hoy} minFecha={minFecha} problemas={problemas(l)}
                onCuenta={(v) => elegirCuenta(l, v)} onCambiar={(f) => cambiar(l.id, () => f)} onAdjuntar={(a) => adjuntar(l, a)}
                onQuitarComprobante={() => quitarComprobante(l)} onQuitar={() => quitarLinea(l)} />
            ))}
            {lineas.length < 10 && (
              <Button type="button" variant="outline" className="h-auto min-h-10 w-full gap-1.5 whitespace-normal border-dashed py-2" onClick={() => setLineas((ls) => [...ls, lineaNueva()])} data-testid="agregar-linea">
                <Plus className="h-4 w-4 shrink-0" />Agregar otra forma de pago<span className="hidden sm:inline"> (p. ej. parte en Bs y parte en USD)</span>
              </Button>
            )}
            <div className="space-y-1">
              <Label htmlFor="notas-cobro" className="text-xs">Notas para administración <span className="font-normal text-muted-foreground">· opcional</span></Label>
              <Textarea id="notas-cobro" rows={2} maxLength={500} value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Ej.: el cliente retuvo el IVA de la factura 12342" />
            </div>
          </div>
          <div className="min-w-0 space-y-3 lg:sticky lg:top-14">
            {facturasBloque}
            <div className="hidden md:block">
              <Button className="h-11 w-full bg-emerald-700 text-base text-white hover:bg-emerald-800" onClick={enviar} disabled={!puedeEnviar} data-testid="registrar-cobro">
                {enviando ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Registrando…</> : `Registrar cobro · ${formatPrice(total)}`}
              </Button>
              {todosProblemas.length > 0 && <p className="mt-1.5 text-xs text-muted-foreground">Falta: {[...new Set(todosProblemas)].join(" · ")}.</p>}
            </div>
            <p className="text-xs text-muted-foreground">Queda <strong className="font-semibold text-foreground">pendiente de verificación</strong>: administración confirma el pago y la aplicación a facturas.</p>
          </div>
        </div>
      </div>
      {/* Teléfono: botón fijo abajo */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 md:hidden">
        {todosProblemas.length > 0 && <p className="mb-1 truncate text-[11px] text-muted-foreground">Falta: {[...new Set(todosProblemas)][0]}{todosProblemas.length > 1 ? "…" : ""}</p>}
        <Button className="h-11 w-full bg-emerald-700 text-base text-white hover:bg-emerald-800" onClick={enviar} disabled={!puedeEnviar} data-testid="registrar-cobro-movil">
          {enviando ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Registrando…</> : `Registrar cobro · ${formatPrice(total)}`}
        </Button>
      </div>
    </VendedorLayout>
  );
}

function LineaPago({ l, n, total, cuentas, cargandoCuentas, moneda, cuenta, tasa, usd, hoy, minFecha, problemas, onCuenta, onCambiar, onAdjuntar, onQuitarComprobante, onQuitar }: {
  l: LineaCobro; n: number; total: number; cuentas: CuentaPago[]; cargandoCuentas: boolean; moneda: "USD" | "BS"; cuenta?: CuentaPago;
  tasa: { tasa: number; fecha: string } | null | undefined; usd: number; hoy: string; minFecha: string; problemas: string[];
  onCuenta: (v: string) => void; onCambiar: (f: Partial<LineaCobro>) => void; onAdjuntar: (a: File | undefined) => void; onQuitarComprobante: () => void; onQuitar: () => void;
}) {
  const { formatPrice } = useCurrency();
  const uid = useId();
  const camara = useRef<HTMLInputElement>(null);
  const archivo = useRef<HTMLInputElement>(null);
  const esEfectivo = l.cuenta_id === EFECTIVO;
  const metodos = cuenta ? metodosDeCuenta(cuenta) : [];
  const vista = useUrlComprobante(l.comprobante ? `comprobantes-cobro/${l.comprobante}` : null);
  return (
    <section className="rounded-lg border border-border bg-card" data-testid="linea-cobro">
      <header className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-1.5">
        <h3 className="text-[13px] font-semibold">Pago {total > 1 ? n : ""}{usd > 0 ? <span className="ml-1.5 font-normal text-muted-foreground">≈ {formatPrice(usd)}</span> : null}</h3>
        {total > 1 && <button type="button" onClick={onQuitar} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive" aria-label={`Quitar el pago ${n}`}><Trash2 className="h-4 w-4" /></button>}
      </header>
      <div className="space-y-3 p-3">
        <div className="space-y-1">
          <Label htmlFor={`${uid}-cuenta`} className="text-xs">¿Dónde pagó el cliente?</Label>
          <Select value={l.cuenta_id} onValueChange={onCuenta}>
            <SelectTrigger id={`${uid}-cuenta`} aria-label="¿Dónde pagó el cliente?" className="h-10" data-testid="cuenta-cobro"><SelectValue placeholder={cargandoCuentas ? "Cargando cuentas…" : "Cuenta que recibió el pago"} /></SelectTrigger>
            <SelectContent>
              {cuentas.map((c) => <SelectItem key={c.id} value={c.id}>{c.nombre} · {c.moneda === "BS" ? "Bs." : "USD"}</SelectItem>)}
              <SelectItem value={EFECTIVO}>Efectivo (me lo entregó a mí)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {cuenta && metodos.length > 1 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Método de pago">
            {metodos.map((m) => (
              <Button key={m} type="button" size="sm" aria-pressed={l.metodo === m} variant={l.metodo === m ? "default" : "outline"} className={cn("h-8", l.metodo === m && "bg-emerald-700 hover:bg-emerald-800")}
                onClick={() => onCambiar({ metodo: m })}>{METODO_LABEL[m] || m}</Button>
            ))}
          </div>
        )}
        {esEfectivo && (
          <div className="space-y-1">
            <div className="flex gap-1.5" role="group" aria-label="Moneda del efectivo">
              {(["USD", "BS"] as const).map((m) => (
                <Button key={m} type="button" size="sm" aria-pressed={l.moneda === m} variant={l.moneda === m ? "default" : "outline"} className={cn("h-8", l.moneda === m && "bg-emerald-700 hover:bg-emerald-800")}
                  onClick={() => onCambiar({ moneda: m, monto: l.moneda === m ? l.monto : "" })}>{m === "USD" ? "Dólares" : "Bolívares"}</Button>
              ))}
            </div>
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground"><Banknote className="mt-0.5 h-3.5 w-3.5 shrink-0" />Adjunta el recibo firmado y entrega el efectivo en administración.</p>
          </div>
        )}
        {l.cuenta_id && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div className="min-w-0 space-y-1">
                <Label htmlFor={`${uid}-monto`} className="text-xs">Monto ({moneda === "BS" ? "Bs." : "USD"})</Label>
                <Input id={`${uid}-monto`} type="text" inputMode="decimal" value={l.monto} placeholder="0.00" className="h-10 tabular-nums" data-testid="monto-cobro"
                  onChange={(e) => onCambiar({ monto: e.target.value.replace(/[^\d.,]/g, "").slice(0, 14) })} />
              </div>
              <div className="min-w-0 space-y-1">
                <Label htmlFor={`${uid}-fecha`} className="text-xs">Fecha del pago</Label>
                <Input id={`${uid}-fecha`} type="date" value={l.fecha} min={minFecha} max={hoy} className="h-10" data-testid="fecha-cobro" onChange={(e) => onCambiar({ fecha: e.target.value })} />
              </div>
            </div>
            {moneda === "BS" && (
              <div className="flex items-center justify-between gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs" data-testid="tasa-cobro">
                <span className="text-muted-foreground">
                  {tasa === undefined ? "Buscando la tasa BCV…" : tasa ? <>Tasa BCV {tasa.fecha !== l.fecha ? `vigente (${fechaCorta(tasa.fecha)})` : `del ${fechaCorta(tasa.fecha)}`}: {tasa.tasa.toLocaleString("es-VE", { maximumFractionDigits: 4 })} Bs/USD</> : <span className="text-destructive">No hay tasa BCV para esa fecha</span>}
                </span>
                <span className="font-semibold tabular-nums">{usd > 0 ? `≈ ${formatPrice(usd)}` : ""}</span>
              </div>
            )}
            {!esEfectivo && (
              <div className="space-y-1">
                <Label htmlFor={`${uid}-referencia`} className="text-xs">Referencia de la operación</Label>
                <Input id={`${uid}-referencia`} value={l.referencia} onChange={(e) => onCambiar({ referencia: e.target.value.slice(0, 40) })} placeholder="Número de referencia (obligatorio)" className="h-10" data-testid="referencia-cobro" />
              </div>
            )}
            <div className="space-y-1">
              <p className="text-xs font-medium leading-none" id={`${uid}-comprobante`}>Comprobante {esEfectivo ? "(recibo firmado)" : "(captura o foto)"}</p>
              {l.comprobante ? (
                <div className="flex items-center gap-3 rounded-md border border-border p-2" data-testid="comprobante-adjunto">
                  {esPdfComprobante(l.comprobante) ? <FileText className="h-10 w-10 shrink-0 text-muted-foreground" />
                    : vista.url ? <img src={vista.url} alt="Comprobante" className="h-14 w-14 shrink-0 rounded object-cover" />
                    : <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded bg-muted"><Loader2 className="h-4 w-4 animate-spin" /></div>}
                  <p className="min-w-0 flex-1 text-xs text-muted-foreground">Comprobante adjunto.</p>
                  <button type="button" onClick={onQuitarComprobante} className="rounded-md p-2 text-muted-foreground hover:bg-muted" aria-label="Quitar el comprobante"><X className="h-4 w-4" /></button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" variant="outline" className="h-10 gap-1.5" disabled={l.subiendo} onClick={() => camara.current?.click()} data-testid="tomar-foto">
                    {l.subiendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}Tomar foto
                  </Button>
                  <Button type="button" variant="outline" className="h-10 gap-1.5" disabled={l.subiendo} onClick={() => archivo.current?.click()} data-testid="elegir-archivo">
                    <ImagePlus className="h-4 w-4" />Elegir archivo
                  </Button>
                </div>
              )}
              <input ref={camara} type="file" accept="image/*" capture="environment" className="hidden" data-testid="input-camara" aria-labelledby={`${uid}-comprobante`}
                onChange={(e) => { onAdjuntar(e.target.files?.[0]); e.target.value = ""; }} />
              <input ref={archivo} type="file" accept="image/*,application/pdf" className="hidden" data-testid="input-archivo" aria-labelledby={`${uid}-comprobante`}
                onChange={(e) => { onAdjuntar(e.target.files?.[0]); e.target.value = ""; }} />
              {l.errorArchivo && <p className="text-xs text-destructive" role="alert">{l.errorArchivo}</p>}
            </div>
          </>
        )}
        {problemas.length > 0 && l.cuenta_id && Number(l.monto) > 0 && (
          <p className="text-[11px] text-muted-foreground">Falta: {problemas.join(" · ")}.</p>
        )}
      </div>
    </section>
  );
}

export default VendedorCobroNuevo;
