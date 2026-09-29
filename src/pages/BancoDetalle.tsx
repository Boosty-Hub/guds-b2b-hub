import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Loader2, Landmark, ArrowDownLeft, ArrowUpRight, AlertTriangle, ListChecks } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/contexts/CurrencyContext";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { OdooBadge } from "@/components/OdooBadge";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { BarraLista } from "@/components/datos/BarraLista";

interface Banco {
  id: string; nombre: string; moneda: string; numero_cuenta: string | null; cuenta_odoo: string | null; odoo_id: number | null; tipo_odoo: string | null;
  saldo_odoo: number | null; saldo_odoo_usd: number | null; saldo_extracto: number | null; saldo_odoo_at: string | null; cuenta_compartida: boolean;
}
interface Movimiento {
  id: string; tipo: string; origen: string; monto: number; referencia: string | null; descripcion: string | null; fecha: string;
  pago?: { id: string; numero: string; cliente_id: string | null } | null;
  pago_proveedor?: { id: string; numero: string; proveedor_id: string | null } | null;
  reintegro?: { id: string; numero: string; cliente_id: string | null } | null;
}
interface LineaOdoo {
  id: string; fecha: string | null; referencia: string | null; contacto: string | null; monto: number; saldo: number | null; conciliada: boolean;
  monto_otra_moneda: number | null; otra_moneda: string | null;
  cliente?: { id: string; nombre_negocio: string } | null; proveedor?: { id: string; nombre: string } | null;
  extracto?: { nombre: string | null } | null;
}
interface ExtractoOdoo { id: string; nombre: string | null; fecha: string | null; saldo_inicial: number | null; saldo_final: number | null; saldo_final_real: number | null; valido: boolean | null }

const ORIGEN_MOV: Record<string, string> = {
  cobro: "Cobro", pago_proveedor: "Pago a proveedor", reintegro_proveedor: "Reintegro de proveedor", reintegro_cliente: "Reintegro a cliente",
  por_identificar: "Por identificar", manual: "Manual",
};
const fmtMoneda = (n: number | null | undefined, moneda: string) => {
  const n0 = Number(n || 0);
  // El signo va antes del símbolo (-$1,234.69)
  const signo = n0 < 0 && Math.abs(n0) >= 0.005 ? "-" : "";
  const v = Math.abs(n0);
  return moneda === "USD"
    ? `${signo}$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `${signo}Bs. ${v.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const fmtFecha = (d?: string | null) => (d ? new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString("es-VE") : "—");

const BancoDetalle = () => {
  const { bancoId } = useParams();
  const navigate = useNavigate();
  const { exchangeRate } = useCurrency();
  const [banco, setBanco] = useState<Banco | null>(null);
  const [movs, setMovs] = useState<Movimiento[]>([]);
  const [lineas, setLineas] = useState<LineaOdoo[]>([]);
  const [extractos, setExtractos] = useState<ExtractoOdoo[]>([]);
  const [loading, setLoading] = useState(true);
  const [origen, setOrigen] = useState("todos");
  const [filtroLinea, setFiltroLinea] = useState("pendientes");
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("movimientos");

  useEffect(() => {
    let vivo = true;
    (async () => {
      setLoading(true);
      const [{ data: b }, { data: mv }, { data: ln }, { data: ex }] = await Promise.all([
        supabase.from("bancos").select("id, nombre, moneda, numero_cuenta, cuenta_odoo, odoo_id, tipo_odoo, saldo_odoo, saldo_odoo_usd, saldo_extracto, saldo_odoo_at, cuenta_compartida").eq("id", bancoId).maybeSingle(),
        supabase.from("movimientos_bancarios").select("id, tipo, origen, monto, referencia, descripcion, fecha, pago:pagos(id, numero, cliente_id), pago_proveedor:pagos_proveedor(id, numero, proveedor_id), reintegro:reintegros(id, numero, cliente_id)")
          .eq("banco_id", bancoId).order("fecha", { ascending: false }),
        supabase.from("extracto_odoo_lineas").select("id, fecha, referencia, contacto, monto, saldo, conciliada, monto_otra_moneda, otra_moneda, cliente:clientes(id, nombre_negocio), proveedor:proveedores(id, nombre), extracto:extractos_odoo(nombre)")
          .eq("banco_id", bancoId).order("fecha", { ascending: false }),
        supabase.from("extractos_odoo").select("id, nombre, fecha, saldo_inicial, saldo_final, saldo_final_real, valido").eq("banco_id", bancoId).order("fecha", { ascending: false }),
      ]);
      if (vivo) {
        setBanco((b as Banco) ?? null);
        setMovs((mv as unknown as Movimiento[]) ?? []);
        setLineas((ln as unknown as LineaOdoo[]) ?? []);
        setExtractos((ex as ExtractoOdoo[]) ?? []);
        setLoading(false);
      }
    })();
    return () => { vivo = false; };
  }, [bancoId]);

  const t = q.trim().toLowerCase();
  const movsFiltrados = useMemo(() => movs.filter((m) => (origen === "todos" || m.origen === origen)
    && (!t || [m.referencia, m.descripcion, m.pago?.numero, m.pago_proveedor?.numero, m.reintegro?.numero].some((v) => (v || "").toLowerCase().includes(t)))), [movs, origen, t]);
  const lineasFiltradas = useMemo(() => lineas.filter((l) => (filtroLinea === "todas" || (filtroLinea === "pendientes" ? !l.conciliada : l.conciliada))
    && (!t || [l.referencia, l.contacto].some((v) => (v || "").toLowerCase().includes(t)))), [lineas, filtroLinea, t]);
  const pgMov = usePagination(movsFiltrados, 50);
  const pgLin = usePagination(lineasFiltradas, 50);
  const pgExt = usePagination(extractos, 50);

  const volver = <Button variant="ghost" size="sm" className="mb-2 h-7 gap-1.5 px-2 text-xs" onClick={() => navigate(-1)}><ArrowLeft className="h-3.5 w-3.5" /> Volver</Button>;
  if (loading) return <MainLayout title="Banco">{volver}<div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></MainLayout>;
  if (!banco) return <MainLayout title="Banco">{volver}<div className="py-20 text-center text-muted-foreground">Banco no encontrado</div></MainLayout>;

  const entradas = movs.filter((m) => m.tipo === "entrada").reduce((s, m) => s + Number(m.monto), 0);
  const salidas = movs.filter((m) => m.tipo === "salida").reduce((s, m) => s + Number(m.monto), 0);
  const pendientes = lineas.filter((l) => !l.conciliada).length;
  const saldoPrincipal = banco.cuenta_compartida ? banco.saldo_extracto : banco.saldo_odoo;
  const aUsd = banco.moneda === "USD" ? Number(saldoPrincipal || 0) : exchangeRate > 0 ? Number(saldoPrincipal || 0) / exchangeRate : null;
  const enlaceMov = (m: Movimiento) =>
    m.pago?.cliente_id ? <Link to={`/admin/cuentas/${m.pago.cliente_id}`} className="font-mono text-primary hover:underline">{m.pago.numero}</Link>
    : m.pago_proveedor?.proveedor_id ? <Link to={`/admin/proveedores/${m.pago_proveedor.proveedor_id}`} className="font-mono text-primary hover:underline">{m.pago_proveedor.numero}</Link>
    : m.reintegro?.cliente_id ? <Link to={`/admin/cuentas/${m.reintegro.cliente_id}`} className="font-mono text-primary hover:underline">{m.reintegro.numero}</Link>
    : <span className="font-mono text-muted-foreground">{m.referencia || "—"}</span>;

  return (
    <MainLayout title={banco.nombre}>
      {volver}
      {/* Cabecera compacta: nombre, cuenta, moneda y acción */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="rounded-md bg-primary/10 p-1.5"><Landmark className="h-4 w-4 text-primary" /></div>
          <h1 className="flex flex-wrap items-center gap-2 text-base font-semibold">{banco.nombre}{banco.odoo_id && <OdooBadge sincronizado={banco.saldo_odoo_at} />}
            <Badge variant={banco.moneda === "USD" ? "default" : "secondary"}>{banco.moneda === "USD" ? "USD $" : "Bs."}</Badge>
            <span className="font-mono text-xs font-normal text-muted-foreground">{banco.cuenta_odoo || banco.numero_cuenta || "—"}</span></h1>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => navigate("/admin/conciliacion")}><ListChecks className="h-3.5 w-3.5" /> Conciliar en GUDS</Button>
      </div>
      {banco.cuenta_compartida && (
        <p className="mb-2 flex items-center gap-2 rounded-md border border-warning/50 bg-warning/10 px-2.5 py-1.5 text-xs">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
          En Odoo este diario usa la misma cuenta contable que otro banco, así que su saldo contable no se puede separar: se muestra el saldo según el último extracto.
        </p>
      )}
      <KpiStrip items={[
        { label: banco.cuenta_compartida ? "Saldo según extracto" : "Saldo contable (Odoo)", valor: banco.odoo_id ? fmtMoneda(saldoPrincipal, banco.moneda) : "—",
          detalle: banco.moneda !== "USD" && aUsd !== null && banco.odoo_id ? `≈ ${fmtMoneda(aUsd, "USD")} a tasa BCV` : undefined, tono: "primario" },
        { label: "Saldo último extracto", valor: banco.saldo_extracto !== null ? fmtMoneda(banco.saldo_extracto, banco.moneda) : "—" },
        { label: "Entradas registradas", valor: fmtMoneda(entradas, banco.moneda), tono: "positivo" },
        { label: "Salidas registradas", valor: fmtMoneda(salidas, banco.moneda), tono: "negativo" },
        { label: "Por conciliar en Odoo", valor: pendientes, detalle: "líneas de extracto", tono: pendientes > 0 ? "alerta" : "normal", onClick: pendientes > 0 ? () => { setTab("extracto"); setFiltroLinea("pendientes"); } : undefined },
      ]} />

      <Tabs value={tab} onValueChange={setTab}>
        {/* Pestañas, búsqueda y filtro de la pestaña activa en una sola fila */}
        <BarraLista
          pestanas={
            <TabsList className="h-auto flex-wrap justify-start">
              <TabsTrigger value="movimientos">Movimientos ({movs.length})</TabsTrigger>
              <TabsTrigger value="extracto">Extracto de Odoo ({lineas.length})</TabsTrigger>
              <TabsTrigger value="extractos">Extractos ({extractos.length})</TabsTrigger>
            </TabsList>
          }
          busqueda={q}
          onBusqueda={setQ}
          placeholder="Buscar referencia, descripción o contacto..."
          filtros={tab === "movimientos" ? (
            <Select value={origen} onValueChange={setOrigen}>
              <SelectTrigger className="h-8 w-full text-[13px] sm:w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos los orígenes</SelectItem>
                {Object.entries(ORIGEN_MOV).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : tab === "extracto" ? (
            <Select value={filtroLinea} onValueChange={setFiltroLinea}>
              <SelectTrigger className="h-8 w-full text-[13px] sm:w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pendientes">Por conciliar en Odoo</SelectItem>
                <SelectItem value="conciliadas">Conciliadas</SelectItem>
                <SelectItem value="todas">Todas</SelectItem>
              </SelectContent>
            </Select>
          ) : undefined}
        />

        <TabsContent value="movimientos" className="mt-0">
          <div className="rounded-lg border border-border bg-card">
            <Table>
              <TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Descripción</TableHead><TableHead>Origen</TableHead><TableHead>Documento</TableHead><TableHead className="text-right">Monto</TableHead></TableRow></TableHeader>
              <TableBody>
                {pgMov.pageItems.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">Sin movimientos</TableCell></TableRow>
                ) : pgMov.pageItems.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{fmtFecha(m.fecha)}</TableCell>
                    <TableCell className="max-w-[420px]">
                      <span className="flex min-w-0 items-center gap-1.5 font-medium">
                        {m.tipo === "salida" ? <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-destructive" /> : <ArrowDownLeft className="h-3.5 w-3.5 shrink-0 text-success" />}
                        <span className="truncate" title={m.descripcion || undefined}>{m.descripcion || ORIGEN_MOV[m.origen]}</span>
                      </span>
                    </TableCell>
                    <TableCell><Badge variant="outline" className={cn("whitespace-nowrap font-normal", m.origen === "por_identificar" && "border-warning/60 bg-warning/15")}>{ORIGEN_MOV[m.origen] ?? m.origen}</Badge></TableCell>
                    <TableCell className="whitespace-nowrap">{enlaceMov(m)}</TableCell>
                    <TableCell className={cn("text-right font-semibold", m.tipo === "salida" ? "text-destructive" : "text-success")}>
                      {m.tipo === "salida" ? "-" : "+"}{fmtMoneda(m.monto, banco.moneda)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <DataTablePagination pagination={pgMov} />
          </div>
        </TabsContent>

        <TabsContent value="extracto" className="mt-0">
          <div className="rounded-lg border border-border bg-card">
            <Table>
              <TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Referencia</TableHead><TableHead>Contacto</TableHead><TableHead className="text-right">Monto</TableHead><TableHead className="text-right">Saldo</TableHead><TableHead>Estado</TableHead></TableRow></TableHeader>
              <TableBody>
                {pgLin.pageItems.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">Sin líneas con este filtro</TableCell></TableRow>
                ) : pgLin.pageItems.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="text-muted-foreground">{fmtFecha(l.fecha)}</TableCell>
                    <TableCell className="max-w-[280px] text-sm">
                      <span className="line-clamp-2">{l.referencia || "—"}</span>
                      {l.extracto?.nombre && <span className="block text-xs text-muted-foreground">{l.extracto.nombre}</span>}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-sm">
                      {l.cliente ? <Link to={`/admin/clientes/${l.cliente.id}`} className="text-primary hover:underline">{l.cliente.nombre_negocio}</Link>
                        : l.proveedor ? <Link to={`/admin/proveedores/${l.proveedor.id}`} className="text-primary hover:underline">{l.proveedor.nombre}</Link>
                        : l.contacto || <span className="text-muted-foreground">Sin contacto</span>}
                    </TableCell>
                    <TableCell className={cn("text-right font-semibold", Number(l.monto) < 0 ? "text-destructive" : "text-success")}>
                      {fmtMoneda(l.monto, banco.moneda)}
                      {l.monto_otra_moneda !== null && l.otra_moneda && <span className="block text-xs font-normal text-muted-foreground">{l.otra_moneda} {Number(l.monto_otra_moneda).toLocaleString("es-VE", { minimumFractionDigits: 2 })}</span>}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">{l.saldo !== null ? fmtMoneda(l.saldo, banco.moneda) : "—"}</TableCell>
                    <TableCell>{l.conciliada
                      ? <Badge variant="outline" className="border-success/40 bg-success/10 font-normal text-success">Conciliada</Badge>
                      : <Badge variant="outline" className="border-warning/60 bg-warning/15 font-normal">Por conciliar</Badge>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <DataTablePagination pagination={pgLin} />
          </div>
        </TabsContent>

        <TabsContent value="extractos" className="mt-0">
          <div className="rounded-lg border border-border bg-card">
            <Table>
              <TableHeader><TableRow><TableHead>Extracto</TableHead><TableHead>Fecha</TableHead><TableHead className="text-right">Saldo inicial</TableHead><TableHead className="text-right">Saldo final</TableHead><TableHead>Estado</TableHead></TableRow></TableHeader>
              <TableBody>
                {pgExt.pageItems.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">Sin extractos en Odoo</TableCell></TableRow>
                ) : pgExt.pageItems.map((x) => (
                  <TableRow key={x.id}>
                    <TableCell className="font-medium">{x.nombre || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{fmtFecha(x.fecha)}</TableCell>
                    <TableCell className="text-right">{fmtMoneda(x.saldo_inicial, banco.moneda)}</TableCell>
                    <TableCell className="text-right font-semibold">{fmtMoneda(x.saldo_final_real ?? x.saldo_final, banco.moneda)}</TableCell>
                    <TableCell>{x.valido ? <Badge variant="outline" className="font-normal">Válido</Badge> : <Badge variant="outline" className="border-warning/60 bg-warning/15 font-normal">Con diferencias</Badge>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <DataTablePagination pagination={pgExt} />
          </div>
        </TabsContent>
      </Tabs>
    </MainLayout>
  );
};

export default BancoDetalle;
