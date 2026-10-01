import { useState, useEffect, useCallback } from "react";
import { VendedorLayout } from "@/components/vendedor/VendedorLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, Loader2, Paperclip } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { useNavigate, useSearchParams } from "react-router-dom";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { BarraLista } from "@/components/datos/BarraLista";
import { useOrdenTabla, EncabezadoOrdenable } from "@/components/datos/tabla";
import { METODO_LABEL } from "@/hooks/useCuentasPago";
import { useResumenVendedor, mesDe } from "@/components/vendedor/resumen";
import { urlComprobante } from "@/components/vendedor/comprobantes";
import {
  FiltrosLista, useFiltros, opcionesDe, opcionesPrueba, pasaPrueba, coincide, enRango, contadorFiltrado, type OpcionPrueba,
} from "@/components/datos/FiltrosLista";

// Cobros del vendedor: lista de pagos de su cartera con las cifras de resumen_vendedor(). El registro de un cobro nuevo
// (varias líneas, tasa BCV por fecha, comprobante y propuesta de aplicación a facturas) está en /vendedor/cobros/nuevo.

interface Pago {
  id: string; numero: string; monto: number; metodo: string; estado: string; referencia: string | null; created_at: string; fecha_pago: string | null;
  es_igtf: boolean | null; comprobante_url: string | null; propuesta_estado: string | null; moneda: string | null; monto_moneda: number | null;
  notas: string | null; cliente_id: string | null; cliente?: { nombre_negocio: string } | null;
}

const estadoConfig: Record<string, { label: string; cls: string }> = {
  pendiente: { label: "Pendiente", cls: "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200" },
  verificado: { label: "Verificado", cls: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300" },
  rechazado: { label: "Rechazado", cls: "border-red-300 bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-300" },
};
const PROPUESTA: Record<string, string> = { pendiente: "Propuesta enviada", aplicada: "Aplicada como propusiste", corregida: "Aplicación corregida" };

// Día del pago en hora de Caracas (YYYY-MM-DD), para comparar con el mes del resumen
const diaCaracas = (s: string) => new Date(s).toLocaleDateString("en-CA", { timeZone: "America/Caracas" });

const VendedorPagos = () => {
  const { formatPrice } = useCurrency();
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [pagos, setPagos] = useState<Pago[]>([]);
  const [loading, setLoading] = useState(true);
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get("q") || "");
  // Cifras desde resumen_vendedor() (misma fuente que el tablero Hoy)
  const { resumen } = useResumenVendedor();
  // El buscador global abre esta página con ?q=
  useEffect(() => { const v = params.get("q"); if (v !== null) setQ(v); }, [params]);

  const fetchData = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    const { data } = await supabase.from("pagos")
      .select("id, numero, monto, metodo, estado, referencia, created_at, fecha_pago, es_igtf, comprobante_url, propuesta_estado, moneda, monto_moneda, notas, cliente_id, cliente:clientes(nombre_negocio)")
      .order("created_at", { ascending: false });
    if (data) setPagos(data as unknown as Pago[]);
    setLoading(false);
  }, [user?.id]);
  useEffect(() => { fetchData(); }, [fetchData]);

  const verComprobante = async (url: string) => {
    try { window.open(await urlComprobante(url, 120), "_blank", "noopener,noreferrer"); }
    catch (e) { toast({ title: "No se pudo abrir el comprobante", description: (e as Error).message, variant: "destructive" }); }
  };

  const fmt = (s: string) => new Date(s.length === 10 ? `${s}T12:00:00` : s).toLocaleDateString("es-ES", { day: "2-digit", month: "short", timeZone: "America/Caracas" });
  const fechaDe = (p: Pago) => p.fecha_pago || p.created_at;

  const cob = resumen?.cobros;
  const verificadoMes = (p: Pago) => p.estado === "verificado" && !p.es_igtf && !!resumen && diaCaracas(p.created_at) >= resumen.mes_desde && diaCaracas(p.created_at) <= resumen.mes_hasta;
  // ---- Filtros (en la URL). ?estado=pendiente llega desde el tablero Hoy ----
  const pruebasEstado: OpcionPrueba<Pago>[] = [
    { valor: "pendiente", etiqueta: "Pendientes de verificar", prueba: (p) => p.estado === "pendiente" },
    { valor: "verificado", etiqueta: "Verificados", prueba: (p) => p.estado === "verificado" },
    { valor: "verificado_mes", etiqueta: `Verificados en ${mesDe(resumen) || "el mes"} (sin IGTF)`, prueba: verificadoMes },
    { valor: "rechazado", etiqueta: "Rechazados", prueba: (p) => p.estado === "rechazado" },
  ];
  const f = useFiltros([
    { clave: "estado", etiqueta: "Estado", todos: "Todos", principal: true, opciones: opcionesPrueba(pagos, pruebasEstado) },
    { clave: "fecha", etiqueta: "Fecha", tipo: "fecha", principal: true },
    { clave: "cliente", etiqueta: "Cliente", todos: "Todos los clientes", opciones: opcionesDe(pagos, (p) => p.cliente_id, (p) => p.cliente?.nombre_negocio ?? "—") },
    { clave: "metodo", etiqueta: "Método", todos: "Todos", opciones: opcionesDe(pagos, (p) => p.metodo, (_p, v) => METODO_LABEL[v] || v) },
  ]);
  const estadoFiltro = f.v("estado");
  const verEstado = (v: string) => () => f.set("estado", estadoFiltro === v ? "" : v);
  const texto = q.trim().toLowerCase();
  const filtrados = pagos.filter((p) => pasaPrueba(pruebasEstado, estadoFiltro, p) && enRango(fechaDe(p), f.v("fecha"))
    && coincide(p.cliente_id, f.v("cliente")) && coincide(p.metodo, f.v("metodo")) &&
    (!texto || [p.numero, p.cliente?.nombre_negocio, p.referencia].some((v) => (v || "").toLowerCase().includes(texto))));
  const { ordenadas, orden, alternar } = useOrdenTabla(filtrados, {
    numero: (p) => p.numero, cliente: (p) => p.cliente?.nombre_negocio, fecha: (p) => fechaDe(p), monto: (p) => Number(p.monto || 0),
    metodo: (p) => p.metodo, estado: (p) => p.estado,
  });
  const pagination = usePagination(ordenadas, 50, f.firma);
  const montoOriginal = (p: Pago) => (p.moneda === "BS" && p.monto_moneda ? `Bs. ${Number(p.monto_moneda).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null);

  return (
    <VendedorLayout title="Cobros">
      <div>
        <KpiStrip items={[
          { label: `Verificados en ${mesDe(resumen)}`, valor: cob ? formatPrice(cob.verificados_mes_monto) : "—", detalle: cob ? `${cob.verificados_mes_n} cobros · sin IGTF` : undefined,
            tono: "positivo", onClick: verEstado("verificado_mes"), activo: estadoFiltro === "verificado_mes" },
          { label: "Pendientes de verificar", valor: cob ? formatPrice(cob.pendientes_monto) : "—", detalle: cob ? `${cob.pendientes_n} cobros` : undefined,
            tono: cob?.pendientes_n ? "alerta" : "normal", onClick: verEstado("pendiente"), activo: estadoFiltro === "pendiente" },
          { label: "Total registros", valor: cob?.total ?? "—", detalle: cob?.rechazados_mes_n ? `${cob.rechazados_mes_n} rechazados este mes` : undefined,
            onClick: () => f.set("estado", ""), activo: !estadoFiltro },
        ]} />

        <BarraLista busqueda={q} onBusqueda={setQ} placeholder="Buscar cobro, cliente o referencia..."
          filtros={<FiltrosLista filtros={f} resultados={filtrados.length} />}
          contador={loading ? undefined : contadorFiltrado(filtrados.length, pagos.length, f.activos || !!texto)}
          acciones={<Button size="sm" className="gap-1.5 bg-emerald-700 hover:bg-emerald-800" onClick={() => navigate("/vendedor/cobros/nuevo")} data-testid="registrar-cobro-lista"><Plus className="h-3.5 w-3.5" />Registrar Cobro</Button>} />

        <div className="rounded-lg border border-border bg-card">
          {loading ? <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-emerald-700" /></div>
          : pagos.length === 0 ? <div className="py-10 text-center text-sm text-muted-foreground">Aún no hay cobros registrados</div>
          : filtrados.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Sin resultados{texto ? ` para "${q.trim()}"` : ""}
              {f.activos > 0 && <button type="button" className="ml-2 font-medium text-primary hover:underline" onClick={f.limpiar}>Limpiar filtros</button>}
            </div>
          )
          : (
            <>
              {/* Teléfono: tarjetas con número, cliente, monto y estado a la vista */}
              <ul className="divide-y divide-border md:hidden" data-testid="cobros-tarjetas">
                {pagination.pageItems.map((p) => (
                  <li key={p.id} className="px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-emerald-700 dark:text-emerald-400">{p.numero}</span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums">{formatPrice(Number(p.monto))}</span>
                    </div>
                    <p className="truncate text-[13px]">{p.cliente?.nombre_negocio || "—"}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <Badge variant="outline" className={`px-2 py-0 text-[11px] ${estadoConfig[p.estado]?.cls ?? ""}`}>{estadoConfig[p.estado]?.label || p.estado}</Badge>
                      <span>{fmt(fechaDe(p))} · {METODO_LABEL[p.metodo] || p.metodo}{montoOriginal(p) ? ` · ${montoOriginal(p)}` : ""}</span>
                      {p.comprobante_url && <button type="button" onClick={() => verComprobante(p.comprobante_url!)} className="inline-flex h-7 items-center gap-1 text-emerald-700 dark:text-emerald-400"><Paperclip className="h-3.5 w-3.5" />Comprobante</button>}
                    </div>
                    {p.propuesta_estado && <p className="mt-0.5 text-[11px] text-muted-foreground">{PROPUESTA[p.propuesta_estado]}</p>}
                    {p.estado === "rechazado" && p.notas && <p className="mt-0.5 text-[11px] text-destructive">Motivo: {p.notas}</p>}
                  </li>
                ))}
              </ul>
              <div className="hidden md:block">
                <Table>
                  <TableHeader><TableRow>
                    <EncabezadoOrdenable clave="numero" orden={orden} onOrdenar={alternar}>Cobro</EncabezadoOrdenable>
                    <EncabezadoOrdenable clave="cliente" orden={orden} onOrdenar={alternar}>Cliente</EncabezadoOrdenable>
                    <EncabezadoOrdenable clave="fecha" orden={orden} onOrdenar={alternar}>Fecha</EncabezadoOrdenable>
                    <EncabezadoOrdenable clave="monto" orden={orden} onOrdenar={alternar} alinear="derecha">Monto</EncabezadoOrdenable>
                    <EncabezadoOrdenable clave="metodo" orden={orden} onOrdenar={alternar}>Método</EncabezadoOrdenable>
                    <EncabezadoOrdenable clave="estado" orden={orden} onOrdenar={alternar}>Estado</EncabezadoOrdenable>
                  </TableRow></TableHeader>
                  <TableBody>
                    {pagination.pageItems.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="whitespace-nowrap font-medium text-emerald-700">
                          {p.numero}
                          {p.comprobante_url && (
                            <button type="button" onClick={() => verComprobante(p.comprobante_url!)} className="ml-1.5 inline-flex align-middle text-muted-foreground hover:text-foreground" title="Ver comprobante" aria-label={`Ver comprobante de ${p.numero}`}>
                              <Paperclip className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </TableCell>
                        <TableCell><span className="block max-w-[260px] truncate" title={p.cliente?.nombre_negocio || undefined}>{p.cliente?.nombre_negocio || "—"}</span></TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{fmt(fechaDe(p))}</TableCell>
                        <TableCell className="whitespace-nowrap text-right font-semibold">
                          {formatPrice(Number(p.monto))}
                          {montoOriginal(p) && <span className="block text-[11px] font-normal text-muted-foreground">{montoOriginal(p)}</span>}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{METODO_LABEL[p.metodo] || p.metodo}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          <Badge variant="outline" className={estadoConfig[p.estado]?.cls}>{estadoConfig[p.estado]?.label || p.estado}</Badge>
                          {p.propuesta_estado && <span className="ml-1.5 text-[11px] text-muted-foreground">{PROPUESTA[p.propuesta_estado]}</span>}
                          {p.estado === "rechazado" && p.notas && <span className="ml-1.5 inline-block max-w-[200px] truncate align-middle text-[11px] text-destructive" title={p.notas}>{p.notas}</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
          {!loading && filtrados.length > 0 && <DataTablePagination pagination={pagination} />}
        </div>
      </div>
    </VendedorLayout>
  );
};

export default VendedorPagos;
