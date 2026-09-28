import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Loader2 } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { BarraLista } from "@/components/datos/BarraLista";
import { Panel } from "@/components/datos/FichaCampos";
import { TablaReporte } from "@/components/reportes/TablaReporte";
import { useOrdenTabla, EncabezadoOrdenable, exportarCSV, BotonExportar } from "@/components/datos/tabla";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { useToast } from "@/hooks/use-toast";

// ── Tipos de las funciones de reporte (migración 18u) ──
interface FilaVenta { clave: string; etiqueta: string; detalle: string | null; documentos: number; clientes: number; cantidad: number | null; bruto_usd: number; nc_usd: number; neto_usd: number }
interface FilaCobro { clave: string; etiqueta: string; detalle: string | null; cobros: number; clientes: number; monto_usd: number }
interface FilaReverso { empresa: string; cliente: string; factura: string; factura_fecha: string; nota: string; nota_fecha: string; neto_usd: number; motivo: string | null }
interface FilaInv { producto_id: string; sku: string; nombre: string; categoria: string; existencia: number; comprometido: number; disponible: number; vendido_unidades: number; vendido_usd: number; ultima_venta: string | null; cobertura_dias: number | null }

const num = (v: unknown) => Number(v ?? 0);
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const etiquetaMes = (k: string) => { const [y, m] = k.split("-"); return `${MESES[Number(m) - 1]} ${y.slice(2)}`; };

type Periodo = "mes" | "mes_anterior" | "trimestre" | "anio" | "12m" | "personalizado";
const PERIODOS: Record<Periodo, string> = {
  mes: "Este mes", mes_anterior: "Mes anterior", trimestre: "Últimos 3 meses", anio: "Año en curso", "12m": "Últimos 12 meses", personalizado: "Personalizado",
};
function rango(p: Periodo, desde: string, hasta: string): [string, string] {
  const hoy = new Date();
  const y = hoy.getFullYear(), m = hoy.getMonth();
  switch (p) {
    case "mes": return [iso(new Date(y, m, 1)), iso(hoy)];
    case "mes_anterior": return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
    case "trimestre": return [iso(new Date(y, m - 2, 1)), iso(hoy)];
    case "anio": return [iso(new Date(y, 0, 1)), iso(hoy)];
    case "12m": return [iso(new Date(y, m - 11, 1)), iso(hoy)];
    default: return [desde, hasta];
  }
}
// Período anterior de igual duración (para comparar)
function anterior(desde: string, hasta: string): [string, string] {
  const d = new Date(`${desde}T00:00:00`), h = new Date(`${hasta}T00:00:00`);
  const dias = Math.round((h.getTime() - d.getTime()) / 86400000) + 1;
  const fin = new Date(d.getTime() - 86400000), ini = new Date(fin.getTime() - (dias - 1) * 86400000);
  return [iso(ini), iso(fin)];
}
const variacion = (actual: number, previo: number) => (previo ? ((actual - previo) / Math.abs(previo)) * 100 : null);

// Color primario del tema ya resuelto: en atributos SVG (fill) var(--primary) no se resuelve
const colorPrimario = () => {
  try { const v = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim(); return v ? `hsl(${v})` : "#8b1a1a"; } catch { return "#8b1a1a"; }
};

function GraficoMeses({ datos, formato }: { datos: { mes: string; valor: number }[]; formato: (v: number) => string }) {
  const color = colorPrimario();
  return (
    <div className="h-44 w-full px-2 py-2">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={datos} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="mes" tickLine={false} axisLine={false} fontSize={11} tickFormatter={etiquetaMes} />
          <YAxis tickLine={false} axisLine={false} fontSize={11} width={56} tickFormatter={(v) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
          <Tooltip cursor={{ fill: "hsl(var(--muted))" }} formatter={(v: number) => [formato(v), "Monto"]} labelFormatter={(l: string) => etiquetaMes(l)}
            contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }} />
          <Bar dataKey="valor" radius={[3, 3, 0, 0]} fill={color} maxBarSize={48} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const Reportes = () => {
  const { formatPrice } = useCurrency();
  const { soloLectura, seleccion } = useEmpresa();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(params.get("tab") || "ventas");
  const [periodo, setPeriodo] = useState<Periodo>("mes");
  const [desdeP, setDesdeP] = useState(iso(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [hastaP, setHastaP] = useState(iso(new Date()));
  const [desde, hasta] = rango(periodo, desdeP, hastaP);
  const [cargando, setCargando] = useState(true);
  const [ventas, setVentas] = useState<Record<string, FilaVenta[]>>({});
  const [ventasPrev, setVentasPrev] = useState<FilaVenta[]>([]);
  const [meses, setMeses] = useState<FilaVenta[]>([]);
  const [reversos, setReversos] = useState<FilaReverso[]>([]);
  const [verReversos, setVerReversos] = useState(false);
  const [cobros, setCobros] = useState<Record<string, FilaCobro[]>>({});
  const [cobrosPrev, setCobrosPrev] = useState<FilaCobro[]>([]);
  const [mesesCobro, setMesesCobro] = useState<FilaCobro[]>([]);
  const [inv, setInv] = useState<FilaInv[]>([]);
  const [diasRot, setDiasRot] = useState(90);
  const [filtroInv, setFiltroInv] = useState<"todos" | "quiebre" | "inmovilizado">("todos");
  const [qInv, setQInv] = useState("");

  const cambiarTab = (t: string) => { setTab(t); params.set("tab", t); setParams(params, { replace: true }); };

  // Carga según la pestaña (cada consulta agrega en el servidor)
  useEffect(() => {
    let cancelado = false;
    (async () => {
      setCargando(true);
      const [pd, ph] = anterior(desde, hasta);
      const ini12 = iso(new Date(new Date(`${hasta}T00:00:00`).getFullYear(), new Date(`${hasta}T00:00:00`).getMonth() - 11, 1));
      const rpc = async <T,>(fn: string, args: Record<string, unknown>) => {
        const { data, error } = await supabase.rpc(fn, args);
        if (error) throw error;
        return (data ?? []) as T[];
      };
      try {
        if (tab === "ventas") {
          // "empresa" da los totales con un solo redondeo (y la tabla por empresa en modo "Ambas")
          const grupos = ["empresa", "vendedor", "cliente", "producto", "categoria"];
          const [res, prev, m, rev] = await Promise.all([
            Promise.all(grupos.map((g) => rpc<FilaVenta>("reporte_ventas", { p_desde: desde, p_hasta: hasta, p_agrupar: g }))),
            rpc<FilaVenta>("reporte_ventas", { p_desde: pd, p_hasta: ph, p_agrupar: "empresa" }),
            rpc<FilaVenta>("reporte_ventas", { p_desde: ini12, p_hasta: hasta, p_agrupar: "mes" }),
            rpc<FilaReverso>("reporte_reversos", { p_desde: desde, p_hasta: hasta }),
          ]);
          if (cancelado) return;
          setVentas(Object.fromEntries(grupos.map((g, i) => [g, res[i]])));
          setVentasPrev(prev); setMeses(m); setReversos(rev);
        } else if (tab === "cobranza") {
          const grupos = ["empresa", "banco", "vendedor", "cliente", "metodo"];
          const [res, prev, m] = await Promise.all([
            Promise.all(grupos.map((g) => rpc<FilaCobro>("reporte_cobranza", { p_desde: desde, p_hasta: hasta, p_agrupar: g }))),
            rpc<FilaCobro>("reporte_cobranza", { p_desde: pd, p_hasta: ph, p_agrupar: "empresa" }),
            rpc<FilaCobro>("reporte_cobranza", { p_desde: ini12, p_hasta: hasta, p_agrupar: "mes" }),
          ]);
          if (cancelado) return;
          setCobros(Object.fromEntries(grupos.map((g, i) => [g, res[i]])));
          setCobrosPrev(prev); setMesesCobro(m);
        } else {
          const r = await rpc<FilaInv>("reporte_inventario", { p_dias: diasRot });
          if (cancelado) return;
          setInv(r);
        }
      } catch (e) {
        if (!cancelado) toast({ title: "No se pudo cargar el reporte", description: (e as Error).message, variant: "destructive" });
      } finally {
        if (!cancelado) setCargando(false);
      }
    })();
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, desde, hasta, diasRot, soloLectura, seleccion]);

  // ── Ventas ──
  const totalVentas = useMemo(() => {
    const porEmpresa = ventas.empresa ?? [];
    const neto = porEmpresa.reduce((s, f) => s + num(f.neto_usd), 0);
    const bruto = porEmpresa.reduce((s, f) => s + num(f.bruto_usd), 0);
    const nc = porEmpresa.reduce((s, f) => s + num(f.nc_usd), 0);
    const docs = porEmpresa.reduce((s, f) => s + num(f.documentos), 0);
    const clientes = (ventas.cliente ?? []).filter((f) => num(f.bruto_usd) > 0).length;
    return { neto, bruto, nc, docs, clientes, ticket: docs ? bruto / docs : 0 };
  }, [ventas]);
  const netoPrev = ventasPrev.reduce((s, f) => s + num(f.neto_usd), 0);
  const varVentas = variacion(totalVentas.neto, netoPrev);

  // ── Cobranza ──
  const totalCobros = useMemo(() => {
    const porEmpresa = cobros.empresa ?? [];
    return { monto: porEmpresa.reduce((s, f) => s + num(f.monto_usd), 0), cobros: porEmpresa.reduce((s, f) => s + num(f.cobros), 0),
      clientes: (cobros.cliente ?? []).length };
  }, [cobros]);
  const cobradoPrev = cobrosPrev.reduce((s, f) => s + num(f.monto_usd), 0);
  const varCobros = variacion(totalCobros.monto, cobradoPrev);

  // ── Inventario ──
  const invStats = useMemo(() => ({
    total: inv.length,
    sinDisponible: inv.filter((f) => num(f.disponible) <= 0).length,
    quiebre: inv.filter((f) => f.cobertura_dias !== null && num(f.cobertura_dias) < 15).length,
    inmovilizado: inv.filter((f) => num(f.vendido_unidades) <= 0 && num(f.existencia) > 0).length,
    vendido: inv.reduce((s, f) => s + num(f.vendido_usd), 0),
  }), [inv]);
  const textoInv = qInv.trim().toLowerCase();
  const invFiltrado = inv.filter((f) =>
    (filtroInv === "todos" || (filtroInv === "quiebre" ? f.cobertura_dias !== null && num(f.cobertura_dias) < 15 : num(f.vendido_unidades) <= 0 && num(f.existencia) > 0)) &&
    (!textoInv || f.nombre.toLowerCase().includes(textoInv) || (f.sku || "").toLowerCase().includes(textoInv) || f.categoria.toLowerCase().includes(textoInv)));
  const { ordenadas: invOrden, orden: ordenInv, alternar: alternarInv } = useOrdenTabla(invFiltrado, {
    sku: (f) => f.sku, nombre: (f) => f.nombre, categoria: (f) => f.categoria, existencia: (f) => num(f.existencia), comprometido: (f) => num(f.comprometido),
    disponible: (f) => num(f.disponible), vendido: (f) => num(f.vendido_unidades), usd: (f) => num(f.vendido_usd), ultima: (f) => f.ultima_venta,
    cobertura: (f) => (f.cobertura_dias === null ? null : num(f.cobertura_dias)),
  });
  const pgInv = usePagination(invOrden, 50);
  const porCategoria = useMemo(() => {
    const m = new Map<string, { categoria: string; productos: number; existencia: number; disponible: number; vendido: number; usd: number }>();
    for (const f of inv) {
      const g = m.get(f.categoria) || { categoria: f.categoria, productos: 0, existencia: 0, disponible: 0, vendido: 0, usd: 0 };
      g.productos += 1; g.existencia += num(f.existencia); g.disponible += num(f.disponible); g.vendido += num(f.vendido_unidades); g.usd += num(f.vendido_usd);
      m.set(f.categoria, g);
    }
    return [...m.values()];
  }, [inv]);

  const fmtN = (v: unknown) => num(v).toLocaleString("es-VE", { maximumFractionDigits: 0 });
  const tonoVar = (v: number | null) => (v === null ? "tenue" as const : v >= 0 ? "positivo" as const : "negativo" as const);
  const textoVar = (v: number | null) => (v === null ? "sin datos del período anterior" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}% vs período anterior`);

  const pestanas = (
    <TabsList>
      <TabsTrigger value="ventas">Ventas</TabsTrigger>
      <TabsTrigger value="cobranza">Cobranza</TabsTrigger>
      <TabsTrigger value="inventario">Inventario y rotación</TabsTrigger>
    </TabsList>
  );
  const selectorPeriodo = (
    <>
      <Select value={periodo} onValueChange={(v) => setPeriodo(v as Periodo)}>
        <SelectTrigger className="h-8 w-44 text-[13px]" aria-label="Período"><SelectValue /></SelectTrigger>
        <SelectContent>{Object.entries(PERIODOS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
      </Select>
      {periodo === "personalizado" && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Input type="date" value={desdeP} max={hastaP} onChange={(e) => setDesdeP(e.target.value)} className="h-8 w-36 text-[13px]" aria-label="Desde" />
          a
          <Input type="date" value={hastaP} min={desdeP} onChange={(e) => setHastaP(e.target.value)} className="h-8 w-36 text-[13px]" aria-label="Hasta" />
        </span>
      )}
      <span className="text-xs text-muted-foreground">{desde.split("-").reverse().join("/")} – {hasta.split("-").reverse().join("/")}</span>
    </>
  );

  return (
    <MainLayout title="Reportes">
      <Tabs value={tab} onValueChange={cambiarTab}>
        <BarraLista pestanas={pestanas}
          filtros={tab === "inventario" ? (
            <Select value={String(diasRot)} onValueChange={(v) => setDiasRot(Number(v))}>
              <SelectTrigger className="h-8 w-52 text-[13px]" aria-label="Ventana de rotación"><SelectValue /></SelectTrigger>
              <SelectContent>{[30, 60, 90, 180].map((d) => <SelectItem key={d} value={String(d)}>Rotación: ventas de {d} días</SelectItem>)}</SelectContent>
            </Select>
          ) : selectorPeriodo}
          acciones={cargando ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : <span className="text-[11px] text-muted-foreground">USD · neto de IVA · fuente Odoo</span>} />

        <TabsContent value="ventas" className="mt-0">
          <KpiStrip items={[
            { label: "Venta neta", valor: formatPrice(totalVentas.neto), detalle: textoVar(varVentas), tono: tonoVar(varVentas), titulo: "Facturas − notas de crédito, sin IVA ni saldos iniciales" },
            { label: "Facturado", valor: formatPrice(totalVentas.bruto), detalle: `${fmtN(totalVentas.docs)} facturas` },
            { label: "Notas de crédito", valor: formatPrice(totalVentas.nc), tono: totalVentas.nc < 0 ? "negativo" : "normal" },
            { label: "Clientes con compra", valor: fmtN(totalVentas.clientes) },
            { label: "Ticket promedio", valor: formatPrice(totalVentas.ticket), detalle: "por factura" },
          ]} />
          {reversos.length > 0 && (
            <p className="-mt-1 mb-3 text-xs text-muted-foreground">
              No se cuentan {fmtN(reversos.length)} facturas anuladas por completo con su nota de crédito ({formatPrice(reversos.reduce((s, r) => s + num(r.neto_usd), 0))}).
              <Button variant="link" size="sm" className="h-auto px-1 py-0 text-xs" onClick={() => setVerReversos(true)}>Ver lista</Button>
            </p>
          )}
          <Panel sinPadding className="mb-3" titulo="Venta neta por mes (últimos 12 meses)">
            <GraficoMeses datos={meses.map((f) => ({ mes: f.clave, valor: num(f.neto_usd) }))} formato={formatPrice} />
          </Panel>
          <div className="grid gap-3 xl:grid-cols-2">
            {soloLectura && (
              <TablaReporte titulo="Por empresa" filas={ventas.empresa ?? []} exportar="ventas-por-empresa" metrica={(f) => num(f.neto_usd)} columnas={[
                { clave: "etiqueta", titulo: "Empresa", valor: (f) => f.etiqueta },
                { clave: "documentos", titulo: "Facturas", valor: (f) => num(f.documentos), derecha: true },
                { clave: "neto", titulo: "Venta neta", valor: (f) => num(f.neto_usd), render: (f) => formatPrice(num(f.neto_usd)), derecha: true },
              ]} />
            )}
            <TablaReporte titulo="Por vendedor" filas={ventas.vendedor ?? []} exportar="ventas-por-vendedor" metrica={(f) => num(f.neto_usd)} columnas={[
              { clave: "etiqueta", titulo: "Vendedor (Odoo)", valor: (f) => f.etiqueta },
              { clave: "documentos", titulo: "Facturas", valor: (f) => num(f.documentos), derecha: true },
              { clave: "clientes", titulo: "Clientes", valor: (f) => num(f.clientes), derecha: true, secundaria: true },
              { clave: "nc", titulo: "NC", valor: (f) => num(f.nc_usd), render: (f) => formatPrice(num(f.nc_usd)), derecha: true, ocultarMovil: true },
              { clave: "neto", titulo: "Venta neta", valor: (f) => num(f.neto_usd), render: (f) => formatPrice(num(f.neto_usd)), derecha: true },
            ]} />
            <TablaReporte titulo="Por categoría" filas={ventas.categoria ?? []} exportar="ventas-por-categoria" metrica={(f) => num(f.neto_usd)} columnas={[
              { clave: "etiqueta", titulo: "Categoría", valor: (f) => f.etiqueta.trim() },
              { clave: "detalle", titulo: "Productos", valor: (f) => f.detalle, secundaria: true },
              { clave: "cantidad", titulo: "Unidades", valor: (f) => num(f.cantidad), render: (f) => fmtN(f.cantidad), derecha: true },
              { clave: "neto", titulo: "Venta neta", valor: (f) => num(f.neto_usd), render: (f) => formatPrice(num(f.neto_usd)), derecha: true },
            ]} />
            <TablaReporte titulo="Top clientes" filas={ventas.cliente ?? []} exportar="ventas-por-cliente" metrica={(f) => num(f.neto_usd)} columnas={[
              { clave: "etiqueta", titulo: "Cliente", valor: (f) => f.etiqueta },
              { clave: "detalle", titulo: "RIF · ciudad", valor: (f) => f.detalle, secundaria: true },
              { clave: "documentos", titulo: "Facturas", valor: (f) => num(f.documentos), derecha: true },
              { clave: "neto", titulo: "Venta neta", valor: (f) => num(f.neto_usd), render: (f) => formatPrice(num(f.neto_usd)), derecha: true },
            ]} />
            <TablaReporte titulo="Top productos" filas={ventas.producto ?? []} exportar="ventas-por-producto" metrica={(f) => num(f.neto_usd)} columnas={[
              { clave: "etiqueta", titulo: "Producto", valor: (f) => f.etiqueta },
              { clave: "detalle", titulo: "SKU", valor: (f) => f.detalle, render: (f) => <span className="font-mono text-xs">{f.detalle}</span>, secundaria: true },
              { clave: "cantidad", titulo: "Unidades", valor: (f) => num(f.cantidad), render: (f) => fmtN(f.cantidad), derecha: true },
              { clave: "neto", titulo: "Venta neta", valor: (f) => num(f.neto_usd), render: (f) => formatPrice(num(f.neto_usd)), derecha: true },
            ]} />
          </div>
          <Dialog open={verReversos} onOpenChange={setVerReversos}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
              <DialogHeader>
                <DialogTitle>Facturas anuladas con nota de crédito</DialogTitle>
                <DialogDescription>Factura y nota de crédito por el mismo monto: se excluyen ambas de la venta, lo facturado y el ticket.</DialogDescription>
              </DialogHeader>
              <TablaReporte titulo={`${fmtN(reversos.length)} pares`} filas={reversos} exportar="facturas-anuladas" limite={50} columnas={[
                { clave: "empresa", titulo: "Empresa", valor: (f) => f.empresa, secundaria: true },
                { clave: "cliente", titulo: "Cliente", valor: (f) => f.cliente },
                { clave: "factura", titulo: "Factura", valor: (f) => f.factura, render: (f) => <span className="whitespace-nowrap">{f.factura} <span className="text-muted-foreground">· {f.factura_fecha.split("-").reverse().join("/")}</span></span> },
                { clave: "nota", titulo: "Nota de crédito", valor: (f) => f.nota, render: (f) => <span className="whitespace-nowrap">{f.nota} <span className="text-muted-foreground">· {f.nota_fecha.split("-").reverse().join("/")}</span></span>, ocultarMovil: true },
                { clave: "motivo", titulo: "Motivo", valor: (f) => f.motivo || "—", ocultarMovil: true },
                { clave: "neto", titulo: "Neto", valor: (f) => num(f.neto_usd), render: (f) => formatPrice(num(f.neto_usd)), derecha: true },
              ]} />
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="cobranza" className="mt-0">
          <KpiStrip items={[
            { label: "Cobrado", valor: formatPrice(totalCobros.monto), detalle: textoVar(varCobros), tono: tonoVar(varCobros), titulo: "Cobros verificados (sin IGTF)" },
            { label: "Cobros", valor: fmtN(totalCobros.cobros) },
            { label: "Clientes que pagaron", valor: fmtN(totalCobros.clientes) },
            { label: "Cobro promedio", valor: formatPrice(totalCobros.cobros ? totalCobros.monto / totalCobros.cobros : 0) },
            { label: "Venta neta del período", valor: formatPrice(totalVentas.neto), tono: "tenue", titulo: "Abre la pestaña Ventas para actualizarla" },
          ]} />
          <Panel sinPadding className="mb-3" titulo="Cobrado por mes (últimos 12 meses)">
            <GraficoMeses datos={mesesCobro.map((f) => ({ mes: f.clave, valor: num(f.monto_usd) }))} formato={formatPrice} />
          </Panel>
          <div className="grid gap-3 xl:grid-cols-2">
            {soloLectura && (
              <TablaReporte titulo="Por empresa" filas={cobros.empresa ?? []} exportar="cobranza-por-empresa" metrica={(f) => num(f.monto_usd)} columnas={[
                { clave: "etiqueta", titulo: "Empresa", valor: (f) => f.etiqueta },
                { clave: "cobros", titulo: "Cobros", valor: (f) => num(f.cobros), derecha: true },
                { clave: "monto", titulo: "Cobrado", valor: (f) => num(f.monto_usd), render: (f) => formatPrice(num(f.monto_usd)), derecha: true },
              ]} />
            )}
            <TablaReporte titulo="Por banco o caja" filas={cobros.banco ?? []} exportar="cobranza-por-banco" metrica={(f) => num(f.monto_usd)} columnas={[
              { clave: "etiqueta", titulo: "Banco", valor: (f) => f.etiqueta },
              { clave: "detalle", titulo: "Moneda", valor: (f) => f.detalle, render: (f) => f.detalle ? <Badge variant="outline">{f.detalle === "USD" ? "USD" : "Bs."}</Badge> : "—" },
              { clave: "cobros", titulo: "Cobros", valor: (f) => num(f.cobros), derecha: true },
              { clave: "monto", titulo: "Cobrado (USD)", valor: (f) => num(f.monto_usd), render: (f) => formatPrice(num(f.monto_usd)), derecha: true },
            ]} />
            <TablaReporte titulo="Por vendedor del cliente" filas={cobros.vendedor ?? []} exportar="cobranza-por-vendedor" metrica={(f) => num(f.monto_usd)} columnas={[
              { clave: "etiqueta", titulo: "Vendedor", valor: (f) => f.etiqueta },
              { clave: "clientes", titulo: "Clientes", valor: (f) => num(f.clientes), derecha: true },
              { clave: "cobros", titulo: "Cobros", valor: (f) => num(f.cobros), derecha: true },
              { clave: "monto", titulo: "Cobrado", valor: (f) => num(f.monto_usd), render: (f) => formatPrice(num(f.monto_usd)), derecha: true },
            ]} />
            <TablaReporte titulo="Top clientes que pagaron" filas={cobros.cliente ?? []} exportar="cobranza-por-cliente" metrica={(f) => num(f.monto_usd)} columnas={[
              { clave: "etiqueta", titulo: "Cliente", valor: (f) => f.etiqueta },
              { clave: "detalle", titulo: "RIF · ciudad", valor: (f) => f.detalle, secundaria: true },
              { clave: "cobros", titulo: "Cobros", valor: (f) => num(f.cobros), derecha: true },
              { clave: "monto", titulo: "Cobrado", valor: (f) => num(f.monto_usd), render: (f) => formatPrice(num(f.monto_usd)), derecha: true },
            ]} />
          </div>
        </TabsContent>

        <TabsContent value="inventario" className="mt-0">
          <KpiStrip items={[
            { label: "Productos almacenables", valor: fmtN(invStats.total), tono: "primario", onClick: () => setFiltroInv("todos"), activo: filtroInv === "todos" },
            { label: "Sin disponible", valor: fmtN(invStats.sinDisponible), tono: invStats.sinDisponible ? "negativo" : "normal" },
            { label: "Riesgo de quiebre", valor: fmtN(invStats.quiebre), detalle: "cobertura menor a 15 días", tono: invStats.quiebre ? "alerta" : "normal", onClick: () => setFiltroInv("quiebre"), activo: filtroInv === "quiebre" },
            { label: "Inmovilizado", valor: fmtN(invStats.inmovilizado), detalle: `con existencia y sin ventas en ${diasRot} días`, tono: invStats.inmovilizado ? "alerta" : "normal", onClick: () => setFiltroInv("inmovilizado"), activo: filtroInv === "inmovilizado" },
            { label: `Vendido en ${diasRot} días`, valor: formatPrice(invStats.vendido), tono: "positivo" },
          ]} />
          <div className="grid gap-3 xl:grid-cols-3">
            <TablaReporte className="xl:col-span-1" titulo="Por categoría" filas={porCategoria} exportar="inventario-por-categoria" metrica={(f) => f.usd} limite={15} columnas={[
              { clave: "categoria", titulo: "Categoría", valor: (f) => f.categoria.trim() },
              { clave: "productos", titulo: "Prod.", valor: (f) => f.productos, derecha: true },
              { clave: "disponible", titulo: "Disponible", valor: (f) => f.disponible, render: (f) => fmtN(f.disponible), derecha: true },
            ]} />
            <Panel sinPadding className="xl:col-span-2" titulo={<>Rotación por producto <span className="font-normal text-muted-foreground">· cobertura = disponible ÷ venta diaria de {diasRot} días</span></>}
              acciones={<div className="flex items-center gap-1.5">
                <Input value={qInv} onChange={(e) => setQInv(e.target.value)} placeholder="Buscar producto..." className="h-7 w-44 text-[13px]" />
                <BotonExportar soloIcono total={invOrden.length} onClick={() => exportarCSV("rotacion-inventario", invOrden, [
                  { titulo: "SKU", valor: (f) => f.sku }, { titulo: "Producto", valor: (f) => f.nombre }, { titulo: "Categoría", valor: (f) => f.categoria },
                  { titulo: "Existencia", valor: (f) => num(f.existencia) }, { titulo: "Comprometido", valor: (f) => num(f.comprometido) }, { titulo: "Disponible", valor: (f) => num(f.disponible) },
                  { titulo: `Vendido ${diasRot} días (u)`, valor: (f) => num(f.vendido_unidades) }, { titulo: `Vendido ${diasRot} días (USD)`, valor: (f) => num(f.vendido_usd) },
                  { titulo: "Última venta", valor: (f) => f.ultima_venta }, { titulo: "Cobertura (días)", valor: (f) => f.cobertura_dias },
                ])} />
              </div>}>
              <Table>
                <TableHeader><TableRow>
                  <EncabezadoOrdenable clave="nombre" orden={ordenInv} onOrdenar={alternarInv}>Producto</EncabezadoOrdenable>
                  <EncabezadoOrdenable clave="disponible" orden={ordenInv} onOrdenar={alternarInv} alinear="derecha">Disponible</EncabezadoOrdenable>
                  <EncabezadoOrdenable clave="vendido" orden={ordenInv} onOrdenar={alternarInv} alinear="derecha">Vendido (u)</EncabezadoOrdenable>
                  <EncabezadoOrdenable clave="usd" orden={ordenInv} onOrdenar={alternarInv} alinear="derecha" className="hidden md:table-cell">Vendido</EncabezadoOrdenable>
                  <EncabezadoOrdenable clave="ultima" orden={ordenInv} onOrdenar={alternarInv} className="hidden lg:table-cell">Última venta</EncabezadoOrdenable>
                  <EncabezadoOrdenable clave="cobertura" orden={ordenInv} onOrdenar={alternarInv} alinear="derecha">Cobertura</EncabezadoOrdenable>
                </TableRow></TableHeader>
                <TableBody>
                  {pgInv.pageItems.map((f) => {
                    const cob = f.cobertura_dias === null ? null : num(f.cobertura_dias);
                    return (
                      <TableRow key={f.producto_id}>
                        <TableCell className="max-w-[320px] truncate font-medium" title={`${f.sku} · ${f.nombre}`}><span className="mr-1.5 font-mono text-xs text-muted-foreground">{f.sku}</span>{f.nombre}</TableCell>
                        <TableCell className={`whitespace-nowrap text-right font-semibold ${num(f.disponible) <= 0 ? "text-destructive" : ""}`}>{fmtN(f.disponible)}</TableCell>
                        <TableCell className="whitespace-nowrap text-right">{fmtN(f.vendido_unidades)}</TableCell>
                        <TableCell className="hidden whitespace-nowrap text-right md:table-cell">{formatPrice(num(f.vendido_usd))}</TableCell>
                        <TableCell className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">{f.ultima_venta ? f.ultima_venta.split("-").reverse().join("/") : "—"}</TableCell>
                        <TableCell className="whitespace-nowrap text-right">
                          {cob === null ? <span className="text-xs text-muted-foreground">{num(f.existencia) > 0 ? "Sin ventas" : "—"}</span>
                            : <Badge variant={cob < 15 ? "destructive" : cob < 45 ? "secondary" : "outline"}>{fmtN(cob)} días</Badge>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <DataTablePagination pagination={pgInv} />
            </Panel>
          </div>
        </TabsContent>
      </Tabs>
    </MainLayout>
  );
};

export default Reportes;
