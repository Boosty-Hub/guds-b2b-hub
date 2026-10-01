import { useState, useEffect, useCallback } from "react";
import { VendedorLayout } from "@/components/vendedor/VendedorLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, Loader2, Pencil, ChevronRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { BarraLista } from "@/components/datos/BarraLista";
import { useOrdenTabla, EncabezadoOrdenable } from "@/components/datos/tabla";
import { useResumenVendedor, mesDe } from "@/components/vendedor/resumen";
import { EditarPedidoDialog } from "@/components/vendedor/EditarPedidoDialog";
import { EstadoPedidoBadge } from "@/components/vendedor/estadoPedidoVendedor";
import { estadoVisible, type ClaveEstado } from "@/components/pedidos/estadoPedido";
import {
  FiltrosLista, useFiltros, opcionesDe, opcionesPrueba, pasaPrueba, coincide, enRango, contadorFiltrado, type OpcionPrueba,
} from "@/components/datos/FiltrosLista";
import { pedidoEditable, type ResultadoEdicion } from "@/components/portal/pedidoEditable";
import { textoPagoEdicion } from "@/components/portal/ResumenPagoPedido";

interface Orden { id: string; numero: string; numero_guds: string | null; total: number; estado: string; estado_odoo: string | null; created_at: string;
  fecha_pedido: string | null; odoo_id: number | null; odoo_envio_error: string | null;
  aprobacion: "pendiente" | "aprobada" | "rechazada" | null; rechazo_motivo: string | null; cliente?: { nombre_negocio: string } | null;
  cliente_id: string; vendedor_id: string | null; ediciones: number | null; editado_at: string | null; }
type Filtro = "todos" | "abiertos" | "por_aprobar" | "rechazados";

// Estado visible: el mismo contrato que ven el admin y el cliente (estadoPedido.ts)
const ESTADOS_VISIBLES: { clave: ClaveEstado; etiqueta: string }[] = [
  { clave: "por_aprobar", etiqueta: "Por aprobar" }, { clave: "registrandose", etiqueta: "Aprobado" },
  { clave: "cotizacion", etiqueta: "Cotización" }, { clave: "confirmado", etiqueta: "Confirmado" },
  { clave: "en_preparacion", etiqueta: "En preparación" }, { clave: "despachado_parcial", etiqueta: "Despacho parcial" },
  { clave: "entregado", etiqueta: "Despachado" }, { clave: "cancelado", etiqueta: "Cancelado" }, { clave: "rechazado", etiqueta: "No aprobado" },
];
const PRUEBAS_ESTADO: OpcionPrueba<Orden>[] = ESTADOS_VISIBLES.map((e) => ({ valor: e.clave, etiqueta: e.etiqueta, prueba: (o) => estadoVisible(o).clave === e.clave }));
// "En curso" con la misma definición que resumen_vendedor(): estado abierto y no rechazado
const ABIERTOS = ["pendiente", "confirmado", "procesando", "enviado"];
const abierto = (o: Orden) => ABIERTOS.includes(o.estado) && o.aprobacion !== "rechazada";
// Los indicadores de arriba (?filtro=, como enlaza el tablero Hoy)
const PRUEBAS_SEGUIMIENTO: OpcionPrueba<Orden>[] = [
  { valor: "abiertos", etiqueta: "En curso", prueba: abierto },
  { valor: "por_aprobar", etiqueta: "Por aprobar", prueba: (o) => o.aprobacion === "pendiente" },
  { valor: "rechazados", etiqueta: "No aprobados", prueba: (o) => o.aprobacion === "rechazada" },
];

// Los avisos (confirmado, despachado, facturado…) enlazan a /vendedor/pedidos?pedido=<id>: se abre el detalle del pedido.
// "Duplicar y corregir" (enlaces viejos /vendedor/pedidos?duplicar=<id>) abre la venta rápida con la copia.
const VendedorPedidos = () => {
  const [params] = useSearchParams();
  const pedido = params.get("pedido");
  const duplicar = params.get("duplicar");
  if (pedido) return <Navigate to={`/vendedor/pedidos/${encodeURIComponent(pedido)}`} replace />;
  if (duplicar) return <Navigate to={`/vendedor/pedidos/nuevo?duplicar=${encodeURIComponent(duplicar)}`} replace />;
  return <ListaPedidos />;
};

const ListaPedidos = () => {
  const { formatPrice } = useCurrency();
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [ordenes, setOrdenes] = useState<Orden[]>([]);
  const [loading, setLoading] = useState(true);
  // Clientes de su cartera (activos o no): solo en esos puede editar pedidos por aprobar
  const [asignados, setAsignados] = useState<string[]>([]);
  const [editar, setEditar] = useState<Orden | null>(null);
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get("q") || "");
  // Contadores desde resumen_vendedor() (misma fuente que el Dashboard y Metas)
  const { resumen, recargar: recargarResumen } = useResumenVendedor();
  // El buscador global abre esta página con ?q=
  useEffect(() => { const v = params.get("q"); if (v !== null) setQ(v); }, [params]);

  const fetchData = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    // Todos sus clientes asignados (activos o no): la lista de pedidos se filtra explícitamente por su cartera,
    // además de lo que ya limita RLS (los pedidos que tomó él aunque el cliente ya no sea suyo también cuentan)
    const { data: asignados } = await supabase.from("clientes").select("id").eq("vendedor_asignado_id", user.id);
    const ids = ((asignados ?? []) as { id: string }[]).map((c) => c.id);
    const filtro = ids.length ? `vendedor_id.eq.${user.id},cliente_id.in.(${ids.join(",")})` : `vendedor_id.eq.${user.id}`;
    setAsignados(ids);
    const oRes = await supabase.from("ordenes").select("id, numero, numero_guds, total, estado, estado_odoo, created_at, fecha_pedido, odoo_id, odoo_envio_error, aprobacion, rechazo_motivo, cliente_id, vendedor_id, ediciones, editado_at, cliente:clientes(nombre_negocio)").or(filtro).order("created_at", { ascending: false });
    if (oRes.data) setOrdenes(oRes.data as unknown as Orden[]);
    setLoading(false);
  }, [user?.id]);
  useEffect(() => { fetchData(); }, [fetchData]);

  // Editar pedidos por aprobar de clientes de su cartera (el servidor valida lo mismo)
  const puedeEditar = (o: Orden) => pedidoEditable(o) && asignados.includes(o.cliente_id);
  const alGuardarEdicion = (r: ResultadoEdicion) => {
    setEditar(null);
    toast({ title: "Pedido actualizado", description: `${r.numero} · ${formatPrice(r.total)}. Sigue por aprobar.${textoPagoEdicion(r, formatPrice)}` });
    fetchData(); recargarResumen();
  };
  const alBloquearEdicion = (mensaje: string) => {
    setEditar(null);
    toast({ title: "No se puede editar", description: mensaje, variant: "destructive" });
    fetchData(); recargarResumen();
  };

  const fmt = (s: string) => new Date(s).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });

  const fechaDe = (o: Orden) => o.fecha_pedido || o.created_at;
  // ---- Filtros (en la URL) ----
  const f = useFiltros([
    { clave: "estado", etiqueta: "Estado", principal: true, opciones: opcionesPrueba(ordenes, PRUEBAS_ESTADO, true) },
    { clave: "fecha", etiqueta: "Fecha", tipo: "fecha", principal: true },
    { clave: "cliente", etiqueta: "Cliente", todos: "Todos los clientes", opciones: opcionesDe(ordenes, (o) => o.cliente_id, (o) => o.cliente?.nombre_negocio ?? "—") },
    { clave: "filtro", etiqueta: "Seguimiento", todos: "Todos", opciones: opcionesPrueba(ordenes, PRUEBAS_SEGUIMIENTO) },
  ]);
  const estadoFiltro = (PRUEBAS_SEGUIMIENTO.some((x) => x.valor === f.v("filtro")) ? f.v("filtro") : "todos") as Filtro;
  const setEstadoFiltro = (v: Filtro) => f.set("filtro", v === "todos" ? "" : v);
  const texto = q.trim().toLowerCase();
  const filtradas = ordenes.filter((o) => pasaPrueba(PRUEBAS_SEGUIMIENTO, f.v("filtro"), o) && pasaPrueba(PRUEBAS_ESTADO, f.v("estado"), o)
    && enRango(fechaDe(o), f.v("fecha")) && coincide(o.cliente_id, f.v("cliente")) &&
    (!texto || o.numero.toLowerCase().includes(texto) || (o.numero_guds || "").toLowerCase().includes(texto)
      || (o.cliente?.nombre_negocio || "").toLowerCase().includes(texto)));
  const { ordenadas, orden, alternar } = useOrdenTabla(filtradas, {
    numero: (o) => o.numero, cliente: (o) => o.cliente?.nombre_negocio, fecha: (o) => fechaDe(o), total: (o) => Number(o.total || 0), estado: (o) => estadoVisible(o).etiqueta,
  });
  const pagination = usePagination(ordenadas, 50, f.firma);
  const ped = resumen?.pedidos;
  const abrirDetalle = (o: Orden) => navigate(`/vendedor/pedidos/${o.id}`);
  // Número de Odoo y, si el pedido nació en GUDS, el número con el que el vendedor lo conoció
  const antes = (o: Orden) => (o.numero_guds && o.numero_guds !== o.numero ? o.numero_guds : null);
  const marcaEditado = (o: Orden) => (o.ediciones ?? 0) > 0 && (
    <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
      title={`Editado ${o.ediciones === 1 ? "1 vez" : `${o.ediciones} veces`}${o.editado_at ? ` · último cambio: ${fmt(o.editado_at)}` : ""}`}
      data-testid="pedido-editado">
      Editado
    </Badge>
  );

  return (
    <VendedorLayout title="Pedidos">
      <KpiStrip items={[
        { label: "Pedidos de mis clientes", valor: ped?.total ?? "—", tono: "primario", onClick: () => setEstadoFiltro("todos"), activo: estadoFiltro === "todos" },
        { label: "En curso", valor: ped?.abiertos ?? "—", tono: ped?.abiertos ? "alerta" : "normal", onClick: () => setEstadoFiltro("abiertos"), activo: estadoFiltro === "abiertos" },
        { label: "Por aprobar", valor: ped?.por_aprobar ?? "—", tono: ped?.por_aprobar ? "alerta" : "normal", onClick: () => setEstadoFiltro("por_aprobar"), activo: estadoFiltro === "por_aprobar" },
        { label: "No aprobados", valor: ped?.rechazados ?? "—", tono: ped?.rechazados ? "negativo" : "normal", onClick: () => setEstadoFiltro("rechazados"), activo: estadoFiltro === "rechazados" },
        { label: `Pedidos de ${mesDe(resumen)}`, valor: ped ? formatPrice(ped.mes_monto) : "—", detalle: ped ? `${ped.mes_n} pedidos` : undefined, tono: "positivo",
          titulo: "Pedidos no cancelados del mes. Lo facturado está en Dashboard y Metas." },
      ]} />

      <BarraLista busqueda={q} onBusqueda={setQ} placeholder="Buscar pedido o cliente..."
        filtros={<FiltrosLista filtros={f} resultados={filtradas.length} />}
        contador={loading ? undefined : contadorFiltrado(filtradas.length, ordenes.length, f.activos || !!texto)}
        acciones={<Button size="sm" className="gap-1.5 bg-emerald-700 hover:bg-emerald-800" onClick={() => navigate("/vendedor/pedidos/nuevo")} data-testid="nuevo-pedido"><Plus className="h-3.5 w-3.5" />Nuevo Pedido</Button>} />

      <div className="rounded-lg border border-border bg-card">
        {loading ? <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-emerald-700" /></div>
        : ordenes.length === 0 ? <div className="py-10 text-center text-sm text-muted-foreground">Aún no hay pedidos. Crea el primero con "Nuevo Pedido".</div>
        : filtradas.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Sin resultados{texto ? ` para "${q.trim()}"` : ""}
            {f.activos > 0 && <button type="button" className="ml-2 font-medium text-primary hover:underline" onClick={f.limpiar}>Limpiar filtros</button>}
          </div>
        )
        : (
          <>
            {/* Teléfono: tarjetas con número, cliente, total, estado y fecha a la vista (sin desplazar de lado). Tocar abre el detalle. */}
            <ul className="divide-y divide-border md:hidden" data-testid="pedidos-tarjetas">
              {pagination.pageItems.map((o) => (
                // Enlace "estirado" (after:inset-0): toda la tarjeta abre el detalle y el botón Editar queda encima, sin anidar controles
                <li key={o.id} className="relative px-3 py-2.5 hover:bg-muted/40 active:bg-muted/60" data-testid="pedido-tarjeta">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <Link to={`/vendedor/pedidos/${o.id}`} className="truncate text-sm font-semibold text-emerald-700 after:absolute after:inset-0 dark:text-emerald-400">{o.numero}</Link>
                      {marcaEditado(o)}
                    </div>
                    <span className="flex shrink-0 items-center gap-1 text-sm font-semibold tabular-nums">
                      {formatPrice(Number(o.total))}<ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                    </span>
                  </div>
                  <p className="truncate pr-5 text-[13px] text-foreground">{o.cliente?.nombre_negocio || "—"}</p>
                  <div className="mt-1 flex min-h-6 items-center gap-2">
                    <EstadoPedidoBadge pedido={o} className="px-2 py-0 text-[11px]" />
                    <span className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground">{antes(o) ? `${antes(o)} · ` : ""}{fmt(fechaDe(o))}</span>
                    {puedeEditar(o) && (
                      <Button size="sm" variant="outline" className="relative z-10 h-9 shrink-0 gap-1.5 px-2.5" onClick={() => setEditar(o)}
                        aria-label={`Editar pedido ${o.numero}`} data-testid="editar-pedido-movil">
                        <Pencil className="h-3.5 w-3.5" />Editar
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {/* Escritorio: tabla compacta; la fila abre el detalle */}
            <div className="hidden md:block">
              <Table>
                <TableHeader><TableRow>
                  <EncabezadoOrdenable clave="numero" orden={orden} onOrdenar={alternar}>Pedido</EncabezadoOrdenable>
                  <EncabezadoOrdenable clave="cliente" orden={orden} onOrdenar={alternar}>Cliente</EncabezadoOrdenable>
                  <EncabezadoOrdenable clave="fecha" orden={orden} onOrdenar={alternar}>Fecha</EncabezadoOrdenable>
                  <EncabezadoOrdenable clave="total" orden={orden} onOrdenar={alternar} alinear="derecha">Total</EncabezadoOrdenable>
                  <EncabezadoOrdenable clave="estado" orden={orden} onOrdenar={alternar}>Estado</EncabezadoOrdenable>
                  <TableHead className="w-px"><span className="sr-only">Acciones</span></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {pagination.pageItems.map((o) => (
                    <TableRow key={o.id} className="cursor-pointer" onClick={() => abrirDetalle(o)} data-testid="pedido-fila">
                      <TableCell className="whitespace-nowrap">
                        <Link to={`/vendedor/pedidos/${o.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-emerald-700 hover:underline">{o.numero}</Link>
                        {antes(o) && <span className="ml-1.5 text-[11px] text-muted-foreground">antes {antes(o)}</span>}
                        {(o.ediciones ?? 0) > 0 && <span className="ml-1.5">{marcaEditado(o)}</span>}
                      </TableCell>
                      <TableCell><span className="block max-w-[280px] truncate" title={o.cliente?.nombre_negocio || undefined}>{o.cliente?.nombre_negocio || "—"}</span></TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{fmt(fechaDe(o))}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{formatPrice(Number(o.total))}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <EstadoPedidoBadge pedido={o} />
                        {o.aprobacion === "rechazada" && o.rechazo_motivo && (
                          <span className="ml-1.5 inline-block max-w-[220px] truncate align-middle text-xs text-muted-foreground" title={o.rechazo_motivo}>{o.rechazo_motivo}</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap py-1 text-right">
                        {puedeEditar(o) && (
                          <Button size="sm" variant="outline" className="h-8 gap-1.5 px-2.5" onClick={(e) => { e.stopPropagation(); setEditar(o); }}
                            aria-label={`Editar pedido ${o.numero}`} data-testid="editar-pedido">
                            <Pencil className="h-3.5 w-3.5" />Editar
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
        {!loading && filtradas.length > 0 && <DataTablePagination pagination={pagination} />}
      </div>

      {/* Editar pedido por aprobar */}
      <EditarPedidoDialog orden={editar} onCerrar={() => setEditar(null)} onGuardado={alGuardarEdicion} onYaNoEditable={alBloquearEdicion} />
    </VendedorLayout>
  );
};

export default VendedorPedidos;
