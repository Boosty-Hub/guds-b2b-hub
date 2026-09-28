import { useState, useEffect, useCallback, useMemo } from "react";
import { VendedorLayout } from "@/components/vendedor/VendedorLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Loader2, Banknote } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { useSearchParams } from "react-router-dom";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { BarraLista } from "@/components/datos/BarraLista";
import { useOrdenTabla, EncabezadoOrdenable } from "@/components/datos/tabla";
import { useCuentasPago, metodosDeCuenta, METODO_LABEL, type CuentaPago } from "@/hooks/useCuentasPago";
import { CuentaPagoDatos } from "@/components/portal/CuentaPagoDatos";
import { useResumenVendedor, mesDe } from "@/components/vendedor/resumen";

interface Pago { id: string; numero: string; monto: number; metodo: string; estado: string; referencia: string | null; created_at: string; es_igtf: boolean | null; cliente?: { nombre_negocio: string } | null; }
interface Cli { id: string; nombre_negocio: string; empresa_id: string | null; }

// Efectivo que recibe el propio vendedor: no va a una cuenta publicada (administración elige la caja al verificar)
const EFECTIVO = "efectivo";

const estadoConfig: Record<string, { label: string; cls: string }> = {
  pendiente: { label: "Pendiente", cls: "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200" },
  verificado: { label: "Verificado", cls: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300" },
  rechazado: { label: "Rechazado", cls: "border-red-300 bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-300" },
};

// Día del pago en hora de Caracas (YYYY-MM-DD), para comparar con el mes del resumen
const diaCaracas = (s: string) => new Date(s).toLocaleDateString("en-CA", { timeZone: "America/Caracas" });

const formVacio = { cliente_id: "", cuenta_id: "", metodo: "", moneda: "USD" as "USD" | "BS", monto: "", referencia: "" };

const VendedorPagos = () => {
  const { formatPrice, exchangeRate } = useCurrency();
  const { user } = useAuth();
  const { toast } = useToast();
  const [pagos, setPagos] = useState<Pago[]>([]);
  const [clientes, setClientes] = useState<Cli[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(formVacio);
  const [saving, setSaving] = useState(false);
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get("q") || "");
  const [estadoFiltro, setEstadoFiltro] = useState<"todos" | "pendiente" | "verificado_mes">("todos");
  // Cuentas publicadas (vista cuentas_pago) y cifras desde resumen_vendedor() (misma fuente que el Dashboard)
  const { cuentas, loading: cargandoCuentas } = useCuentasPago();
  const { resumen, recargar: recargarResumen } = useResumenVendedor(true);
  // El buscador global abre esta página con ?q=
  useEffect(() => { const v = params.get("q"); if (v !== null) setQ(v); }, [params]);

  const fetchData = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    const [pRes, cRes] = await Promise.all([
      supabase.from("pagos").select("id, numero, monto, metodo, estado, referencia, created_at, es_igtf, cliente:clientes(nombre_negocio)").order("created_at", { ascending: false }),
      // Solo los clientes asignados a este vendedor
      supabase.from("clientes").select("id, nombre_negocio, empresa_id").eq("activo", true).eq("vendedor_asignado_id", user.id).order("nombre_negocio"),
    ]);
    if (pRes.data) setPagos(pRes.data as unknown as Pago[]);
    if (cRes.data) setClientes(cRes.data as Cli[]);
    setLoading(false);
  }, [user?.id]);
  useEffect(() => { fetchData(); }, [fetchData]);

  const cliente = clientes.find((c) => c.id === form.cliente_id);
  const deudaCliente = resumen?.detalle?.find((d) => d.cliente_id === form.cliente_id);
  // Cuentas de la empresa del cliente (o compartidas)
  const cuentasCliente = useMemo(
    () => (cliente ? cuentas.filter((c) => !c.empresa_id || !cliente.empresa_id || c.empresa_id === cliente.empresa_id) : []),
    [cuentas, cliente],
  );
  const esEfectivo = form.cuenta_id === EFECTIVO;
  const cuenta: CuentaPago | undefined = esEfectivo ? undefined : cuentasCliente.find((c) => c.id === form.cuenta_id);
  const metodos = cuenta ? metodosDeCuenta(cuenta) : [];
  // Moneda del monto: la de la cuenta; en efectivo la elige el vendedor
  const moneda: "USD" | "BS" = cuenta ? (cuenta.moneda === "BS" ? "BS" : "USD") : form.moneda;
  const esBS = moneda === "BS";
  const montoNum = Number(form.monto);
  const montoUSD = esBS ? (exchangeRate > 0 ? montoNum / exchangeRate : 0) : montoNum;
  const faltaReferencia = !esEfectivo && form.referencia.trim().length < 4;

  const elegirCuenta = (v: string) => setForm((f) => {
    const c = cuentasCliente.find((x) => x.id === v);
    const monedaNueva = v === EFECTIVO ? f.moneda : c?.moneda === "BS" ? "BS" : "USD";
    const monedaAntes = f.cuenta_id === EFECTIVO ? f.moneda : cuentasCliente.find((x) => x.id === f.cuenta_id)?.moneda === "BS" ? "BS" : "USD";
    return {
      ...f, cuenta_id: v, metodo: v === EFECTIVO ? EFECTIVO : "transferencia",
      // Al cambiar de moneda el número escrito ya no vale: nunca un monto en USD con etiqueta de Bs.
      monto: f.cuenta_id && monedaNueva !== monedaAntes ? "" : f.monto,
    };
  });

  const registrar = async () => {
    if (!form.cliente_id) { toast({ title: "Falta el cliente", variant: "destructive" }); return; }
    if (!form.cuenta_id || (!esEfectivo && !cuenta)) { toast({ title: "Falta la cuenta", description: "Indica a qué cuenta pagó el cliente o si te entregó efectivo.", variant: "destructive" }); return; }
    if (!(montoNum > 0)) { toast({ title: "Falta el monto", variant: "destructive" }); return; }
    if (faltaReferencia) { toast({ title: "Falta la referencia", description: "Escribe el número de referencia de la operación (mínimo 4 caracteres).", variant: "destructive" }); return; }
    if (esBS && !(exchangeRate > 0)) { toast({ title: "No hay tasa del día", description: "No se puede registrar un cobro en bolívares sin la tasa BCV del día.", variant: "destructive" }); return; }
    setSaving(true);
    const { error } = await supabase.rpc("registrar_pago", {
      p_cliente_id: form.cliente_id, p_orden_id: null, p_banco_id: cuenta?.id ?? null,
      p_metodo: esEfectivo ? EFECTIVO : (form.metodo || "transferencia"), p_monto_moneda: montoNum,
      p_moneda: moneda, p_tasa_cambio: esBS ? exchangeRate : null, p_referencia: form.referencia.trim() || null,
    });
    setSaving(false);
    if (error) { toast({ title: "No se pudo registrar el cobro", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Cobro registrado", description: "Queda pendiente de verificación por administración." });
    setOpen(false); setForm(formVacio);
    fetchData(); recargarResumen();
  };

  const fmt = (s: string) => new Date(s).toLocaleDateString("es-ES", { day: "2-digit", month: "short", timeZone: "America/Caracas" });

  const cob = resumen?.cobros;
  const verificadoMes = (p: Pago) => p.estado === "verificado" && !p.es_igtf && !!resumen && diaCaracas(p.created_at) >= resumen.mes_desde && diaCaracas(p.created_at) <= resumen.mes_hasta;
  const texto = q.trim().toLowerCase();
  const filtrados = pagos.filter((p) => (estadoFiltro === "todos" || (estadoFiltro === "pendiente" ? p.estado === "pendiente" : verificadoMes(p))) &&
    (!texto || [p.numero, p.cliente?.nombre_negocio, p.referencia].some((v) => (v || "").toLowerCase().includes(texto))));
  const { ordenadas, orden, alternar } = useOrdenTabla(filtrados, {
    numero: (p) => p.numero, cliente: (p) => p.cliente?.nombre_negocio, fecha: (p) => p.created_at, monto: (p) => Number(p.monto || 0),
    metodo: (p) => p.metodo, estado: (p) => p.estado,
  });
  const pagination = usePagination(ordenadas, 50);

  return (
    <VendedorLayout title="Pagos">
      <div>
        <KpiStrip items={[
          { label: `Verificados en ${mesDe(resumen)}`, valor: cob ? formatPrice(cob.verificados_mes_monto) : "—", detalle: cob ? `${cob.verificados_mes_n} cobros · sin IGTF` : undefined,
            tono: "positivo", onClick: () => setEstadoFiltro("verificado_mes"), activo: estadoFiltro === "verificado_mes" },
          { label: "Pendientes de verificar", valor: cob ? formatPrice(cob.pendientes_monto) : "—", detalle: cob ? `${cob.pendientes_n} cobros` : undefined,
            tono: cob?.pendientes_n ? "alerta" : "normal", onClick: () => setEstadoFiltro("pendiente"), activo: estadoFiltro === "pendiente" },
          { label: "Total registros", valor: cob?.total ?? "—", detalle: cob?.rechazados_mes_n ? `${cob.rechazados_mes_n} rechazados este mes` : undefined,
            onClick: () => setEstadoFiltro("todos"), activo: estadoFiltro === "todos" },
        ]} />

        <BarraLista busqueda={q} onBusqueda={setQ} placeholder="Buscar cobro, cliente o referencia..."
          contador={loading ? undefined : `${filtrados.length} registros`}
          acciones={<Button size="sm" className="gap-1.5 bg-emerald-500 hover:bg-emerald-600" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5" />Registrar Cobro</Button>} />

        <div className="rounded-lg border border-border bg-card">
          {loading ? <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-emerald-500" /></div>
          : pagos.length === 0 ? <div className="py-10 text-center text-sm text-muted-foreground">Aún no hay pagos registrados</div>
          : filtrados.length === 0 ? <div className="py-10 text-center text-sm text-muted-foreground">Sin resultados{texto ? ` para "${q.trim()}"` : ""}</div>
          : (
            <Table>
              <TableHeader><TableRow>
                <EncabezadoOrdenable clave="numero" orden={orden} onOrdenar={alternar}>Pago</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="cliente" orden={orden} onOrdenar={alternar}>Cliente</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="fecha" orden={orden} onOrdenar={alternar} className="hidden sm:table-cell">Fecha</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="monto" orden={orden} onOrdenar={alternar} alinear="derecha">Monto</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="metodo" orden={orden} onOrdenar={alternar} className="hidden md:table-cell">Método</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="estado" orden={orden} onOrdenar={alternar}>Estado</EncabezadoOrdenable>
              </TableRow></TableHeader>
              <TableBody>
                {pagination.pageItems.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="whitespace-nowrap font-medium text-emerald-600">{p.numero}</TableCell>
                    <TableCell><span className="block max-w-[260px] truncate" title={p.cliente?.nombre_negocio || undefined}>{p.cliente?.nombre_negocio || "—"}</span></TableCell>
                    <TableCell className="hidden whitespace-nowrap text-muted-foreground sm:table-cell">{fmt(p.created_at)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-semibold">{formatPrice(Number(p.monto))}</TableCell>
                    <TableCell className="hidden whitespace-nowrap md:table-cell">{METODO_LABEL[p.metodo] || p.metodo}</TableCell>
                    <TableCell className="whitespace-nowrap"><Badge variant="outline" className={estadoConfig[p.estado]?.cls}>{estadoConfig[p.estado]?.label || p.estado}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {!loading && filtrados.length > 0 && <DataTablePagination pagination={pagination} />}
        </div>
      </div>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setForm(formVacio); }}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader><DialogTitle>Registrar cobro</DialogTitle></DialogHeader>
          <div className="min-w-0 space-y-3 py-1">
            <div><Label>Cliente</Label>
              <Select value={form.cliente_id} onValueChange={(v) => setForm((f) => ({ ...formVacio, cliente_id: v, moneda: f.moneda }))}>
                <SelectTrigger><SelectValue placeholder="Selecciona el cliente" /></SelectTrigger>
                <SelectContent>
                  {clientes.length === 0
                    ? <div className="px-3 py-2 text-sm text-muted-foreground">No tienes clientes asignados en esta empresa</div>
                    : clientes.map((c) => <SelectItem key={c.id} value={c.id}>{c.nombre_negocio}</SelectItem>)}
                </SelectContent>
              </Select>
              {deudaCliente && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Por cobrar <span className="font-semibold text-foreground">{formatPrice(Number(deudaCliente.por_cobrar))}</span>
                  {Number(deudaCliente.vencido) > 0.009 && <> · vencido <span className="font-semibold text-destructive">{formatPrice(Number(deudaCliente.vencido))}</span></>}
                  {Number(deudaCliente.a_favor) < -0.009 && <> · a favor {formatPrice(Math.abs(Number(deudaCliente.a_favor)))}</>}
                </p>
              )}
            </div>

            <div><Label>¿Dónde pagó el cliente?</Label>
              <Select value={form.cuenta_id} onValueChange={elegirCuenta} disabled={!form.cliente_id}>
                <SelectTrigger><SelectValue placeholder={form.cliente_id ? (cargandoCuentas ? "Cargando cuentas…" : "Cuenta que recibió el pago") : "Primero elige el cliente"} /></SelectTrigger>
                <SelectContent>
                  {cuentasCliente.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.nombre} · {c.moneda === "BS" ? "Bs." : "USD"}</SelectItem>
                  ))}
                  <SelectItem value={EFECTIVO}>Efectivo (me lo entregó a mí)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {cuenta && (
              <>
                {metodos.length > 1 && (
                  <div><Label>Método</Label>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {metodos.map((m) => (
                        <Button key={m} type="button" size="sm" variant={form.metodo === m ? "default" : "outline"}
                          className={form.metodo === m ? "h-8 bg-emerald-500 hover:bg-emerald-600" : "h-8"}
                          onClick={() => setForm((f) => ({ ...f, metodo: m }))}>{METODO_LABEL[m] || m}</Button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="rounded-lg border border-border bg-muted/30 px-3 py-1">
                  <CuentaPagoDatos cuenta={cuenta} metodo={form.metodo || "transferencia"} />
                </div>
              </>
            )}

            {esEfectivo && (
              <div><Label>Moneda del efectivo</Label>
                <div className="mt-1 flex gap-1.5">
                  {(["USD", "BS"] as const).map((m) => (
                    <Button key={m} type="button" size="sm" variant={form.moneda === m ? "default" : "outline"}
                      className={form.moneda === m ? "h-8 bg-emerald-500 hover:bg-emerald-600" : "h-8"}
                      onClick={() => setForm((f) => ({ ...f, moneda: m, monto: f.moneda === m ? f.monto : "" }))}>
                      {m === "USD" ? "Dólares (USD)" : "Bolívares (Bs.)"}
                    </Button>
                  ))}
                </div>
                <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground"><Banknote className="mt-0.5 h-3.5 w-3.5 shrink-0" />Entrega el efectivo en administración; allí lo verifican.</p>
              </div>
            )}

            {form.cuenta_id && (
              <>
                <div><Label>{esBS ? "Monto recibido (Bs.)" : "Monto recibido (USD $)"}</Label>
                  <Input type="number" inputMode="decimal" min="0" step="0.01" value={form.monto} onChange={(e) => setForm((f) => ({ ...f, monto: e.target.value }))} placeholder="0.00" />
                  {esBS && (
                    <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-muted/60 px-3 py-2">
                      <span className="text-xs text-muted-foreground">
                        {exchangeRate > 0 ? <>Tasa BCV del día: {exchangeRate.toLocaleString("es-VE", { maximumFractionDigits: 4 })} Bs./USD</> : "Sin tasa del día"}
                      </span>
                      <span className="text-sm font-semibold">{montoNum > 0 && exchangeRate > 0 ? `≈ ${formatPrice(montoUSD)}` : ""}</span>
                    </div>
                  )}
                </div>
                {!esEfectivo && (
                  <div><Label>Referencia de la operación</Label>
                    <Input value={form.referencia} onChange={(e) => setForm((f) => ({ ...f, referencia: e.target.value }))} placeholder="Nro. de referencia (obligatorio)" />
                  </div>
                )}
              </>
            )}
            <p className="text-xs text-muted-foreground">El cobro queda pendiente hasta que administración lo verifique.</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
            <Button className="bg-emerald-500 hover:bg-emerald-600" onClick={registrar}
              disabled={saving || !form.cliente_id || !form.cuenta_id || !(montoNum > 0) || faltaReferencia || (esBS && !(exchangeRate > 0))}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Registrar cobro"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </VendedorLayout>
  );
};

export default VendedorPagos;
