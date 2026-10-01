import { useState, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
import { HandCoins, ListChecks, Loader2, Mail, MailX } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { EncabezadoOrdenable, useOrdenTabla } from "@/components/datos/tabla";
import { useMetricasCobranza, dsoAlto, tendencia, textoDso, IconoTendencia, SelectorVentana, type MetricaCliente, type VentanaDso } from "@/components/cuentas/metricas";
import { EnvioMasivoDialog } from "@/components/estado-cuenta/EnvioMasivoDialog";
import { RegistroEnvios } from "@/components/estado-cuenta/RegistroEnvios";
import { usePermissions } from "@/contexts/PermissionsContext";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/hooks/use-toast";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { SelectorFacturas, type FacturaSaldo } from "@/components/cuentas/SelectorFacturas";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { BarraLista } from "@/components/datos/BarraLista";
import {
  FiltrosLista, useFiltros, useFiltroEmpresa, opcionesDe, opcionesPrueba, pasaPrueba, coincide, enRango, contadorFiltrado,
  type DefFiltro, type OpcionPrueba,
} from "@/components/datos/FiltrosLista";

interface ClienteCuenta {
  id: string;
  codigo: string | null;
  nombre_negocio: string;
  limite_credito: number;
  credito_utilizado: number;
  dias_credito: number;
  empresa_id?: string | null;
  vendedor_asignado_id?: string | null;
  vendedor?: { nombre: string; apellido: string | null } | null;
}
// Claves de filtro de cada pestaña: se limpian al cambiar de pestaña ("empresa" vale para las dos)
const CLAVES_PESTANA = ["situacion", "vendedor", "ultimo", "correo", "cobranza", "m_tipo", "m_fecha", "nc_antiguedad"];
// 21b: columnas internas de cobranza (DSO con tendencia, mora ponderada, a favor por aplicar), indicador y filtro "sin
// correo", selección para el envío masivo del estado de cuenta, registro de envíos y la pestaña "NC sin aplicar".
interface NcSinAplicar {
  factura_id: string; numero: string; cliente_id: string; cliente: string; vendedor: string; empresa: string | null;
  emision: string | null; dias: number | null; total: number; saldo: number; moneda: string; aplicada: number;
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
  const { can } = usePermissions();
  const puedeEnviar = can("cuentas", "editar");
  const [ventana, setVentana] = useState<VentanaDso>(90);
  const { datos: metricas, recargar: recargarMetricas } = useMetricasCobranza(ventana);
  const metricaDe = useMemo(() => new Map((metricas?.clientes ?? []).map((m) => [m.cliente_id, m])), [metricas]);
  const umbralDso = metricas?.alerta_dso ?? 60;
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [masivoAbierto, setMasivoAbierto] = useState(false);
  const [registroAbierto, setRegistroAbierto] = useState(false);
  const [senalRegistro, setSenalRegistro] = useState(0);
  const [ncs, setNcs] = useState<NcSinAplicar[] | null>(null);
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
      supabase.from("clientes").select("id, codigo, nombre_negocio, limite_credito, credito_utilizado, dias_credito, empresa_id, vendedor_asignado_id, vendedor:usuarios!clientes_vendedor_asignado_id_fkey(nombre, apellido)"),
      supabase.from("pagos").select("id, numero, cliente_id, monto, monto_moneda, moneda, metodo, referencia, estado, created_at, fecha_verificacion, banco:bancos(nombre)").order("created_at", { ascending: false }).limit(5000),
      supabase.from("facturas").select("id, numero, cliente_id, tipo, fecha_emision, total_usd, saldo_usd, estado_cobro").eq("estado", "posted"),
      supabase.from("bancos").select("id, nombre, metodo_pago, metodos, moneda").eq("activo", true).order("nombre"),
    ]);
    if (cRes.data) setClientes(cRes.data as unknown as ClienteCuenta[]);
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
    .map((c) => ({ c, ...(deudaCliente.get(c.id) || { saldo: 0, docs: 0 }), m: metricaDe.get(c.id) as MetricaCliente | undefined }))
    .sort((a, b) => b.saldo - a.saldo), [clientes, deudaCliente, metricaDe]);

  // Movimientos (libro de cuenta): cobros verificados (+), facturas de tipo factura (cargo −), notas de crédito (crédito +)
  const empresaCliente = useMemo(() => Object.fromEntries(clientes.map((c) => [c.id, c.empresa_id ?? null])), [clientes]);
  const movimientos = useMemo(() => [
    ...pagos.filter((p) => p.estado === "verificado").map((p) => ({
      id: p.id, fecha: p.fecha_verificacion || p.created_at, cliente: clientesMap[p.cliente_id] || "—", empresa_id: empresaCliente[p.cliente_id] ?? null,
      tipo: "pago" as const, clase: "cobro" as const, monto: Number(p.monto), metodo: metodoLabel[p.metodo] || p.metodo, referencia: p.numero,
    })),
    ...facturas.filter((f) => f.tipo === "factura").map((f) => ({
      id: f.id, fecha: f.fecha_emision || "", cliente: clientesMap[f.cliente_id] || "—", empresa_id: empresaCliente[f.cliente_id] ?? null,
      tipo: "cargo" as const, clase: "factura" as const, monto: Number(f.total_usd), metodo: "Factura", referencia: f.numero,
    })),
    ...facturas.filter((f) => f.tipo === "nota_credito").map((f) => ({
      id: f.id, fecha: f.fecha_emision || "", cliente: clientesMap[f.cliente_id] || "—", empresa_id: empresaCliente[f.cliente_id] ?? null,
      tipo: "pago" as const, clase: "nc" as const, monto: Math.abs(Number(f.total_usd)), metodo: "Nota de crédito", referencia: f.numero,
    })),
  ].sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()), [pagos, facturas, clientesMap, empresaCliente]);
  type Movimiento = (typeof movimientos)[number];
  type CuentaFila = (typeof cuentasCliente)[number];

  // ---- Filtros (en la URL), según la pestaña ----
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "movimientos" ? "transactions" : params.get("tab") === "nc" ? "nc" : "accounts";
  const setTab = (t: string) => setParams((p) => {
    const n = new URLSearchParams(p);
    if (t === "transactions") n.set("tab", "movimientos"); else if (t === "nc") n.set("tab", "nc"); else n.delete("tab");
    for (const k of CLAVES_PESTANA) n.delete(k);
    return n;
  }, { replace: true });
  const nombreVendedor = (c: ClienteCuenta) => (c.vendedor ? `${c.vendedor.nombre} ${c.vendedor.apellido || ""}`.trim() : null);
  const pruebasSituacion: OpcionPrueba<CuentaFila>[] = [
    { valor: "al_dia", etiqueta: "Al día", prueba: (x) => estadoCuenta(x.c, x.saldo).label === "Al día" },
    { valor: "con_deuda", etiqueta: "Con deuda", prueba: (x) => x.saldo > 0.009 },
    { valor: "excedido", etiqueta: "Deuda sobre el límite", prueba: (x) => estadoCuenta(x.c, x.saldo).label === "Excedido" },
    { valor: "a_favor", etiqueta: "Con saldo a favor", prueba: (x) => x.saldo < -0.009 },
  ];
  const hoyMs = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }, []);
  const diasUltimo = (id: string) => { const u = ultimoPagoByClient.get(id); return u ? Math.floor((hoyMs - new Date(u).getTime()) / 86400000) : null; };
  const pruebasUltimo: OpcionPrueba<CuentaFila>[] = [
    { valor: "30", etiqueta: "En los últimos 30 días", prueba: (x) => { const d = diasUltimo(x.c.id); return d != null && d <= 30; } },
    { valor: "90", etiqueta: "Hace 31 a 90 días", prueba: (x) => { const d = diasUltimo(x.c.id); return d != null && d > 30 && d <= 90; } },
    { valor: "mas90", etiqueta: "Hace más de 90 días", prueba: (x) => { const d = diasUltimo(x.c.id); return d != null && d > 90; } },
    { valor: "nunca", etiqueta: "Sin cobros registrados", prueba: (x) => diasUltimo(x.c.id) == null },
  ];
  // Sin correo: ni el cliente ni sus contactos activos tienen correo (dato de metricas_cobranza)
  const sinCorreo = (x: CuentaFila) => x.m ? !x.m.tiene_correo : false;
  const pruebasCorreo: OpcionPrueba<CuentaFila>[] = [
    { valor: "sin", etiqueta: "Sin correo", prueba: sinCorreo },
    { valor: "sin_deuda", etiqueta: "Sin correo y con deuda", prueba: (x) => sinCorreo(x) && x.saldo > 0.009 },
    { valor: "con", etiqueta: "Con correo", prueba: (x) => !!x.m?.tiene_correo },
  ];
  const pruebasCobranza: OpcionPrueba<CuentaFila>[] = [
    { valor: "dso_alto", etiqueta: `DSO alto (más de ${umbralDso} días o sin ventas con vencido)`, prueba: (x) => !!x.m && dsoAlto(x.m, umbralDso) },
    { valor: "empeora", etiqueta: "Empeora contra el mes anterior", prueba: (x) => !!x.m && tendencia(x.m) === "empeora" },
    { valor: "mejora", etiqueta: "Mejora contra el mes anterior", prueba: (x) => !!x.m && tendencia(x.m) === "mejora" },
    { valor: "a_favor_nc", etiqueta: "Con NC sin aplicar", prueba: (x) => (x.m?.a_favor_nc ?? 0) > 0.009 },
  ];
  const pruebasTipoMov: OpcionPrueba<Movimiento>[] = [
    { valor: "cobro", etiqueta: "Cobros", prueba: (m) => m.clase === "cobro" },
    { valor: "factura", etiqueta: "Facturas (cargos)", prueba: (m) => m.clase === "factura" },
    { valor: "nc", etiqueta: "Notas de crédito", prueba: (m) => m.clase === "nc" },
  ];
  const empCuentas = useFiltroEmpresa(clientes), empMov = useFiltroEmpresa(movimientos);
  const defsPorTab: Record<string, (DefFiltro | null)[]> = {
    accounts: [
      { clave: "situacion", etiqueta: "Situación", todos: "Todas", principal: true, opciones: opcionesPrueba(cuentasCliente, pruebasSituacion) },
      { clave: "vendedor", etiqueta: "Vendedor", principal: true, opciones: opcionesDe(clientes, (c) => c.vendedor_asignado_id, (c) => nombreVendedor(c) ?? "—", "Sin vendedor") },
      { clave: "ultimo", etiqueta: "Último cobro", todos: "Cualquiera", principal: true, opciones: opcionesPrueba(cuentasCliente, pruebasUltimo) },
      { clave: "cobranza", etiqueta: "Cobranza", todos: "Todas", opciones: opcionesPrueba(cuentasCliente, pruebasCobranza) },
      { clave: "correo", etiqueta: "Correo", todos: "Todos", opciones: opcionesPrueba(cuentasCliente, pruebasCorreo) },
      empCuentas,
    ],
    nc: [
      { clave: "nc_antiguedad", etiqueta: "Antigüedad", todos: "Todas", principal: true, opciones: [
        { valor: "30", etiqueta: "Hasta 30 días" }, { valor: "90", etiqueta: "31 a 90 días" }, { valor: "mas90", etiqueta: "Más de 90 días" }] },
    ],
    transactions: [
      { clave: "m_tipo", etiqueta: "Tipo", todos: "Todos", principal: true, opciones: opcionesPrueba(movimientos, pruebasTipoMov) },
      { clave: "m_fecha", etiqueta: "Fecha", tipo: "fecha", principal: true },
      empMov,
    ],
  };
  const f = useFiltros(defsPorTab[tab]);

  const cuentasFiltradas = cuentasCliente.filter((x) =>
    pasaPrueba(pruebasSituacion, f.v("situacion"), x) && coincide(x.c.vendedor_asignado_id, f.v("vendedor"))
    && pasaPrueba(pruebasUltimo, f.v("ultimo"), x) && (!empCuentas || coincide(x.c.empresa_id, f.v("empresa")))
    && pasaPrueba(pruebasCorreo, f.v("correo"), x) && pasaPrueba(pruebasCobranza, f.v("cobranza"), x)
    && (x.c.nombre_negocio.toLowerCase().includes(searchAcc.toLowerCase()) || (x.c.codigo || "").toLowerCase().includes(searchAcc.toLowerCase())));
  const movimientosFiltrados = movimientos.filter((m) =>
    pasaPrueba(pruebasTipoMov, f.v("m_tipo"), m) && enRango(m.fecha, f.v("m_fecha")) && (!empMov || coincide(m.empresa_id, f.v("empresa")))
    && (m.cliente.toLowerCase().includes(searchTrx.toLowerCase()) || (m.referencia || "").toLowerCase().includes(searchTrx.toLowerCase())));

  const { ordenadas: cuentasOrdenadas, orden, alternar } = useOrdenTabla(cuentasFiltradas, {
    cliente: (x) => x.c.nombre_negocio, saldo: (x) => x.saldo, vencido: (x) => x.m?.vencido ?? 0,
    dso: (x) => (x.m && x.m.deuda > 0.009 ? x.m.dso ?? 99999 : null), mora: (x) => x.m?.mora ?? 0, favor: (x) => x.m?.a_favor_nc ?? 0,
    docs: (x) => x.docs, limite: (x) => Number(x.c.limite_credito), ultimo: (x) => ultimoPagoByClient.get(x.c.id) ?? null,
  });
  const pagination = usePagination(cuentasOrdenadas, 50, f.firma);
  const ncFiltradas = (ncs ?? []).filter((n) => {
    const v = f.v("nc_antiguedad"), d = n.dias ?? 0;
    return (!v || (v === "30" ? d <= 30 : v === "90" ? d > 30 && d <= 90 : d > 90))
      && (!searchAcc || `${n.cliente} ${n.numero} ${n.vendedor}`.toLowerCase().includes(searchAcc.toLowerCase()));
  });
  const paginationNc = usePagination(ncFiltradas, 50, f.firma);
  useEffect(() => {
    if (tab !== "nc" || ncs) return;
    supabase.rpc("nc_sin_aplicar").then(({ data, error }) => {
      if (error) { toast({ title: "No se cargaron las notas de crédito", description: error.message, variant: "destructive" }); setNcs([]); return; }
      setNcs(((data as NcSinAplicar[]) ?? []).map((n) => ({ ...n, total: Number(n.total), saldo: Number(n.saldo), aplicada: Number(n.aplicada) })));
    });
  }, [tab, ncs, toast]);

  // Selección para el envío masivo (sobre lo filtrado; se limpia al cambiar los filtros)
  useEffect(() => { setSeleccion(new Set()); }, [f.firma]);
  const todosSel = cuentasFiltradas.length > 0 && cuentasFiltradas.every((x) => seleccion.has(x.c.id));
  const alternarTodos = () => setSeleccion(todosSel ? new Set() : new Set(cuentasFiltradas.map((x) => x.c.id)));
  const alternarSel = (id: string) => setSeleccion((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const seleccionados = useMemo(() => cuentasCliente.filter((x) => seleccion.has(x.c.id)).map((x) => ({ id: x.c.id, nombre: x.c.nombre_negocio })), [cuentasCliente, seleccion]);
  const totalAFavorNc = (metricas?.clientes ?? []).reduce((s, m) => s + m.a_favor_nc, 0);
  const nSinCorreoDeuda = cuentasCliente.filter((x) => sinCorreo(x) && x.saldo > 0.009).length;
  const nDsoAlto = cuentasCliente.filter((x) => x.m && dsoAlto(x.m, umbralDso)).length;
  const pagination2 = usePagination(movimientosFiltrados, 50, f.firma);

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

  const pestanas = (
    <TabsList>
      <TabsTrigger value="accounts">Estado de Cuentas</TabsTrigger>
      <TabsTrigger value="transactions">Movimientos</TabsTrigger>
      <TabsTrigger value="nc" data-testid="tab-nc">NC sin aplicar</TabsTrigger>
    </TabsList>
  );

  return (
    <MainLayout title="Estado de Cuentas">
      <KpiStrip items={[
        { label: "Total por Cobrar", valor: formatPrice(totalPorCobrar), tono: "negativo" },
        { label: "Cobrado este Mes", valor: formatPrice(cobradoMes), tono: "positivo" },
        { label: "Clientes con Deuda", valor: clientesConDeuda, tono: "alerta" },
        { label: "A favor por aplicar", valor: formatPrice(totalAFavorNc), detalle: "NC sin cruzar", tono: totalAFavorNc > 0.009 ? "positivo" : "tenue",
          onClick: () => setTab("nc"), activo: tab === "nc" },
        { label: `DSO alto (>${umbralDso} d)`, valor: metricas ? nDsoAlto : "…", tono: nDsoAlto ? "alerta" : "tenue",
          onClick: () => { setTab("accounts"); setTimeout(() => f.setVarios({ cobranza: "dso_alto" }), 0); }, activo: f.v("cobranza") === "dso_alto" },
        { label: "Con deuda y sin correo", valor: metricas ? nSinCorreoDeuda : "…", tono: nSinCorreoDeuda ? "alerta" : "tenue",
          onClick: () => { setTab("accounts"); setTimeout(() => f.setVarios({ correo: "sin_deuda" }), 0); }, activo: f.v("correo") === "sin_deuda" },
        { label: "Recibos registrados", valor: pagos.filter((p) => p.estado === "verificado").length },
      ]} />

      <Tabs value={tab} onValueChange={setTab}>
        {/* Pestañas, búsqueda, filtros y acciones de la pestaña activa en una sola fila */}
        {tab === "accounts" ? (
          <BarraLista
            pestanas={pestanas}
            busqueda={searchAcc}
            onBusqueda={setSearchAcc}
            placeholder="Buscar cliente..."
            filtros={<FiltrosLista filtros={f} resultados={cuentasFiltradas.length} />}
            contador={loading ? undefined : contadorFiltrado(cuentasFiltradas.length, cuentasCliente.length, f.activos || !!searchAcc)}
            acciones={
              <>
                <SelectorVentana valor={ventana} onCambio={setVentana} className="hidden sm:flex" />
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setRegistroAbierto(true)} data-testid="registro-envios-abrir">
                  <ListChecks className="h-3.5 w-3.5" /> Registro de envíos
                </Button>
                {puedeEnviar && seleccion.size > 0 && (
                  <Button size="sm" variant="secondary" className="gap-1.5" onClick={() => setMasivoAbierto(true)} data-testid="masivo-abrir">
                    <Mail className="h-3.5 w-3.5" /> Enviar estado de cuenta ({seleccion.size})
                  </Button>
                )}
                <Button size="sm" className="gap-1.5" onClick={abrirCobro}>
                  <HandCoins className="h-3.5 w-3.5" /> Registrar Cobro
                </Button>
              </>
            }
          />
        ) : tab === "nc" ? (
          <BarraLista
            pestanas={pestanas}
            busqueda={searchAcc}
            onBusqueda={setSearchAcc}
            placeholder="Buscar cliente, NC o vendedor..."
            filtros={<FiltrosLista filtros={f} resultados={ncFiltradas.length} />}
            contador={ncs === null ? undefined : contadorFiltrado(ncFiltradas.length, ncs.length, f.activos || !!searchAcc)}
          />
        ) : (
          <BarraLista
            pestanas={pestanas}
            busqueda={searchTrx}
            onBusqueda={setSearchTrx}
            placeholder="Buscar por cliente o referencia..."
            filtros={<FiltrosLista filtros={f} resultados={movimientosFiltrados.length} />}
            contador={loading ? undefined : contadorFiltrado(movimientosFiltrados.length, movimientos.length, f.activos || !!searchTrx)}
          />
        )}

        <TabsContent value="accounts">

          <div className="rounded-lg border border-border bg-card">
            {loading ? (
              <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
            ) : cuentasFiltradas.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground">No hay clientes</div>
            ) : (
              <Table data-testid="cuentas-tabla">
                <TableHeader>
                  <TableRow>
                    {puedeEnviar && (
                      <TableHead className="w-8 px-2">
                        <Checkbox checked={todosSel} onCheckedChange={alternarTodos} aria-label="Elegir todos los clientes filtrados" data-testid="sel-todos" />
                      </TableHead>
                    )}
                    <EncabezadoOrdenable clave="cliente" orden={orden} onOrdenar={alternar}>Cliente</EncabezadoOrdenable>
                    <EncabezadoOrdenable clave="saldo" orden={orden} onOrdenar={alternar} alinear="derecha">Saldo Deudor</EncabezadoOrdenable>
                    <EncabezadoOrdenable clave="vencido" orden={orden} onOrdenar={alternar} alinear="derecha" className="hidden lg:table-cell">Vencido</EncabezadoOrdenable>
                    <EncabezadoOrdenable clave="dso" orden={orden} onOrdenar={alternar} alinear="derecha">
                      <span title={`Días de venta adeudados: deuda ÷ venta promedio diaria de ${ventana} días`}>DSO</span>
                    </EncabezadoOrdenable>
                    <EncabezadoOrdenable clave="mora" orden={orden} onOrdenar={alternar} alinear="derecha" className="hidden xl:table-cell">
                      <span title="Días de mora ponderados por monto">Mora pond.</span>
                    </EncabezadoOrdenable>
                    <EncabezadoOrdenable clave="favor" orden={orden} onOrdenar={alternar} alinear="derecha" className="hidden xl:table-cell">A favor (NC)</EncabezadoOrdenable>
                    <EncabezadoOrdenable clave="docs" orden={orden} onOrdenar={alternar} alinear="centro" className="hidden md:table-cell">Docs.</EncabezadoOrdenable>
                    <EncabezadoOrdenable clave="limite" orden={orden} onOrdenar={alternar} alinear="derecha" className="hidden 2xl:table-cell">Límite Crédito</EncabezadoOrdenable>
                    <EncabezadoOrdenable clave="ultimo" orden={orden} onOrdenar={alternar}>Último Pago</EncabezadoOrdenable>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagination.pageItems.map(({ c, saldo, docs, m }) => {
                    const est = estadoCuenta(c, saldo);
                    const t = m ? tendencia(m) : null;
                    const alto = m ? dsoAlto(m, umbralDso) : false;
                    return (
                      <TableRow key={c.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/admin/cuentas/${c.id}`)} data-testid="cuenta-fila">
                        {puedeEnviar && (
                          <TableCell className="w-8 px-2" onClick={(e) => e.stopPropagation()}>
                            <Checkbox checked={seleccion.has(c.id)} onCheckedChange={() => alternarSel(c.id)} aria-label={`Elegir ${c.nombre_negocio}`} />
                          </TableCell>
                        )}
                        <TableCell>
                          <div className="flex min-w-0 items-center">
                            <span className="max-w-[260px] truncate font-medium" title={c.nombre_negocio}>{c.nombre_negocio}</span>
                            <span className="ml-1.5 whitespace-nowrap text-xs text-muted-foreground">{c.codigo || "—"}</span>
                            {m && !m.tiene_correo && <span className="ml-1.5 shrink-0" title="Sin correo (ni del cliente ni de sus contactos)" data-testid="sin-correo"><MailX className="h-3.5 w-3.5 text-warning" aria-label="Sin correo" /></span>}
                          </div>
                        </TableCell>
                        <TableCell className={`whitespace-nowrap text-right font-semibold ${saldo > 0 ? "text-destructive" : ""}`}>
                          {formatPrice(saldo)}
                        </TableCell>
                        <TableCell className="hidden whitespace-nowrap text-right text-muted-foreground lg:table-cell">{m && m.vencido > 0.009 ? formatPrice(m.vencido) : "—"}</TableCell>
                        <TableCell className={`whitespace-nowrap text-right tabular-nums ${alto ? "font-semibold text-destructive" : "text-muted-foreground"}`} data-testid="dso">
                          <span className="inline-flex items-center justify-end gap-1">{m ? textoDso(m) : "—"}<IconoTendencia t={t} /></span>
                        </TableCell>
                        <TableCell className="hidden whitespace-nowrap text-right tabular-nums text-muted-foreground xl:table-cell">{m && m.deuda > 0.009 ? `${m.mora} d` : "—"}</TableCell>
                        <TableCell className="hidden whitespace-nowrap text-right tabular-nums text-success xl:table-cell">{m && m.a_favor_nc > 0.009 ? formatPrice(m.a_favor_nc) : ""}</TableCell>
                        <TableCell className="hidden text-center text-muted-foreground md:table-cell">{docs || "—"}</TableCell>
                        <TableCell className="hidden whitespace-nowrap text-right text-muted-foreground 2xl:table-cell">{formatPrice(Number(c.limite_credito))}</TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(ultimoPagoByClient.get(c.id) || null)}</TableCell>
                        <TableCell className="whitespace-nowrap"><Badge variant={est.variant}>{est.label}</Badge></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
            {!loading && <DataTablePagination pagination={pagination} />}
          </div>
        </TabsContent>

        <TabsContent value="transactions">
          <div className="rounded-lg border border-border bg-card">
            {loading ? (
              <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
            ) : movimientosFiltrados.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground">No hay movimientos registrados</div>
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
                      <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(m.fecha)}</TableCell>
                      <TableCell className="font-medium"><span className="block max-w-[260px] truncate" title={m.cliente}>{m.cliente}</span></TableCell>
                      <TableCell>
                        <Badge variant={m.tipo === "pago" ? "default" : "destructive"}>{m.tipo === "pago" ? "Cobro" : "Cargo"}</Badge>
                      </TableCell>
                      <TableCell className={`whitespace-nowrap text-right font-semibold ${m.tipo === "pago" ? "text-success" : "text-destructive"}`}>
                        {m.tipo === "pago" ? "+" : "-"}{formatPrice(m.monto)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{m.metodo}</TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs text-primary">{m.referencia}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {!loading && <DataTablePagination pagination={pagination2} />}
          </div>
        </TabsContent>

        {/* Notas de crédito sin aplicar (a favor por cruzar en Odoo), con antigüedad */}
        <TabsContent value="nc">
          <div className="rounded-lg border border-border bg-card" data-testid="nc-sin-aplicar">
            <p className="border-b border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
              Saldo a favor de los clientes en notas de crédito que aún no se cruzan con facturas. Se aplican en Odoo; al sincronizar, salen de esta lista.
            </p>
            {ncs === null ? (
              <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
            ) : ncFiltradas.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground">No hay notas de crédito sin aplicar</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead><TableHead>Nota de crédito</TableHead><TableHead>Emisión</TableHead>
                    <TableHead className="text-right">Antigüedad</TableHead><TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Ya aplicado</TableHead><TableHead className="text-right">A favor</TableHead>
                    <TableHead className="hidden lg:table-cell">Vendedor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginationNc.pageItems.map((n) => (
                    <TableRow key={n.factura_id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/admin/cuentas/${n.cliente_id}`)}>
                      <TableCell className="max-w-[260px] truncate font-medium" title={n.cliente}>{n.cliente}</TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs text-primary">{n.numero}{n.moneda === "VES" && <span className="ml-1 text-muted-foreground">(Bs)</span>}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(n.emision)}</TableCell>
                      <TableCell className={`whitespace-nowrap text-right tabular-nums ${(n.dias ?? 0) > 90 ? "text-destructive" : "text-muted-foreground"}`}>{n.dias ?? "—"} d</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{formatPrice(n.total)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums text-muted-foreground">{n.aplicada > 0.009 ? formatPrice(n.aplicada) : "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums text-success">{formatPrice(n.saldo)}</TableCell>
                      <TableCell className="hidden max-w-[180px] truncate text-muted-foreground lg:table-cell">{n.vendedor}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {ncs !== null && <DataTablePagination pagination={paginationNc} />}
          </div>
        </TabsContent>
      </Tabs>

      <EnvioMasivoDialog open={masivoAbierto} onOpenChange={setMasivoAbierto} clientes={seleccionados}
        onTerminado={() => { setSenalRegistro((n) => n + 1); recargarMetricas(); }} />
      <RegistroEnvios open={registroAbierto} onOpenChange={setRegistroAbierto} senal={senalRegistro} />

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
