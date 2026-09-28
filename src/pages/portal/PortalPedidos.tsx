import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ClipboardList, Plus, Search, ChevronRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { estadoVisible, type ClaveEstado } from "@/components/pedidos/estadoPedido";
import { PortalPagina } from "@/components/portal/PortalPagina";
import { DetallePedido, NumeroPedido } from "@/components/portal/DetallePedido";
import { EditorPedidoPendiente } from "@/components/portal/EditorPedidoPendiente";
import { type ResultadoEdicion } from "@/components/portal/pedidoEditable";
import { textoPagoEdicion } from "@/components/portal/ResumenPagoPedido";
import { EstadoPill, EstadoVacio, Segmentado, SkeletonFilas, fechaCorta, normalizar, useEsEscritorio } from "@/components/portal/sistema";

// Mis pedidos (F4). Escritorio: maestro-detalle (lista a la izquierda, detalle a la derecha). Móvil: lista y hoja.
// Enlace directo: /portal/pedidos?pedido=<id> abre ese pedido (así llegan las notificaciones de confirmado, despachado y
// facturado). El checkout llega con ?orden=<id>&nuevo=1.

interface FilaPedido {
  id: string;
  numero: string;
  numero_guds: string | null;
  estado: string;
  estado_odoo: string | null;
  aprobacion: "pendiente" | "aprobada" | "rechazada" | null;
  rechazo_motivo: string | null;
  odoo_id: number | null;
  odoo_envio_error: string | null;
  estado_pago: string | null;
  total: number;
  created_at: string;
  fecha_pedido: string | null;
  ediciones: number | null;
  editado_at: string | null;
  vendedor_id: string | null;
  lineas: { count: number }[] | null;
}

type Pestana = "curso" | "entregados" | "cancelados";

const grupo = (clave: ClaveEstado): Pestana =>
  clave === "rechazado" || clave === "cancelado" ? "cancelados" : clave === "entregado" ? "entregados" : "curso";

const fechaDe = (o: FilaPedido) => o.fecha_pedido ?? o.created_at;
const POR_PAGINA = 20;

const PortalPedidos = () => {
  const [sp, setSp] = useSearchParams();
  const esEscritorio = useEsEscritorio();
  const { user } = useAuth();
  const { formatPrice } = useCurrency();
  const { toast } = useToast();

  const [ordenes, setOrdenes] = useState<FilaPedido[]>([]);
  const [loading, setLoading] = useState(true);
  const [pestana, setPestana] = useState<Pestana>("curso");
  const [busqueda, setBusqueda] = useState("");
  const [limite, setLimite] = useState(POR_PAGINA);
  // Pedido recién enviado desde el checkout: se abre con el aviso "recibido · pendiente de aprobación"
  const [recienEnviado, setRecienEnviado] = useState<string | null>(null);
  // Edición del pedido por aprobar (dentro del mismo panel) y aviso con el total que recalculó GUDS
  const [editando, setEditando] = useState(false);
  const [actualizado, setActualizado] = useState<{ id: string; total: number } | null>(null);
  const [recarga, setRecarga] = useState(0);

  const cargar = async (silencioso = false) => {
    if (!user?.cliente_id) return null;
    if (!silencioso) setLoading(true);
    const { data } = await supabase
      .from("ordenes")
      .select("id, numero, numero_guds, estado, estado_odoo, aprobacion, rechazo_motivo, odoo_id, odoo_envio_error, estado_pago, total, created_at, fecha_pedido, ediciones, editado_at, vendedor_id, lineas:orden_items(count)")
      .eq("cliente_id", user.cliente_id)
      .order("created_at", { ascending: false });
    const filas = ((data as unknown as FilaPedido[]) ?? []).sort((a, b) => fechaDe(b).localeCompare(fechaDe(a)));
    setOrdenes(filas);
    setLoading(false);
    return filas;
  };

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.cliente_id]);

  // Compatibilidad con el checkout (?orden=<id>&nuevo=1) → ?pedido=<id>
  useEffect(() => {
    const o = sp.get("orden");
    if (!o) return;
    if (sp.get("nuevo") === "1") setRecienEnviado(o);
    const n = new URLSearchParams(sp);
    n.delete("orden"); n.delete("nuevo"); n.set("pedido", o);
    setSp(n, { replace: true });
  }, [sp, setSp]);

  const seleccionado = sp.get("pedido");

  const conEstado = useMemo(() => ordenes.map((o) => ({ o, ev: estadoVisible(o) })), [ordenes]);
  const porPestana = useMemo(() => ({
    curso: conEstado.filter((x) => grupo(x.ev.clave) === "curso"),
    entregados: conEstado.filter((x) => grupo(x.ev.clave) === "entregados"),
    cancelados: conEstado.filter((x) => grupo(x.ev.clave) === "cancelados"),
  }), [conEstado]);

  // Un enlace directo abre la pestaña del pedido
  const sincronizado = useRef<string | null>(null);
  useEffect(() => {
    if (!seleccionado || loading || sincronizado.current === seleccionado) return;
    sincronizado.current = seleccionado;
    const x = conEstado.find((c) => c.o.id === seleccionado);
    if (x) setPestana(grupo(x.ev.clave));
  }, [seleccionado, loading, conEstado]);

  useEffect(() => { setLimite(POR_PAGINA); }, [pestana, busqueda]);

  const q = normalizar(busqueda.trim());
  const lista = porPestana[pestana].filter(({ o }) => !q || normalizar(o.numero).includes(q) || normalizar(o.numero_guds).includes(q));
  const visibles = lista.slice(0, limite);

  // En escritorio siempre hay un pedido a la vista (el elegido o el primero de la lista)
  const idDetalle = seleccionado ?? (esEscritorio ? visibles[0]?.o.id ?? null : null);

  const abrir = (id: string) => {
    setEditando(false);
    if (actualizado?.id !== id) setActualizado(null);
    const n = new URLSearchParams(sp);
    n.set("pedido", id);
    // En móvil la hoja entra al historial: "atrás" la cierra
    setSp(n, { replace: esEscritorio || !!seleccionado });
  };
  const cerrar = () => {
    setEditando(false);
    setActualizado(null);
    setRecienEnviado(null);
    const n = new URLSearchParams(sp);
    n.delete("pedido");
    setSp(n, { replace: true });
  };

  const alGuardarEdicion = async (r: ResultadoEdicion) => {
    setEditando(false);
    setActualizado({ id: r.orden_id, total: r.total });
    toast({ title: "Pedido actualizado", description: `${r.numero} · ${formatPrice(r.total)}. Sigue pendiente de aprobación.${textoPagoEdicion(r, formatPrice)}` });
    await cargar(true);
    setRecarga((v) => v + 1);
  };

  // El pedido dejó de estar por aprobar mientras se editaba (lo aprobaron o cambió de estado)
  const alBloquearEdicion = async (mensaje: string) => {
    setEditando(false);
    setActualizado(null);
    toast({ title: "No se puede editar", description: mensaje, variant: "destructive" });
    await cargar(true);
    setRecarga((v) => v + 1);
  };

  const filaSel = idDetalle ? ordenes.find((o) => o.id === idDetalle) : undefined;

  const panelDetalle = (id: string, enHoja: boolean) =>
    editando ? (
      <>
        {enHoja ? (
          <SheetHeader className="border-b border-border px-5 py-4 pr-12 text-left">
            <SheetTitle>Editar pedido {filaSel?.numero}</SheetTitle>
            <SheetDescription>Cambia cantidades, quita o agrega productos. Sigue pendiente de aprobación y el total final lo calcula GUDS.</SheetDescription>
          </SheetHeader>
        ) : (
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-lg font-semibold">Editar pedido {filaSel?.numero}</h2>
            <p className="mt-1 text-sm text-muted-foreground">Cambia cantidades, quita o agrega productos. Sigue pendiente de aprobación y el total final lo calcula GUDS.</p>
          </div>
        )}
        <EditorPedidoPendiente
          key={id}
          ordenId={id}
          modo="cliente"
          onCancelar={() => setEditando(false)}
          onGuardado={alGuardarEdicion}
          onYaNoEditable={alBloquearEdicion}
        />
      </>
    ) : (
      <DetallePedido
        key={id}
        ordenId={id}
        enHoja={enHoja}
        recarga={recarga}
        recienEnviado={recienEnviado === id}
        actualizado={actualizado?.id === id ? { total: actualizado.total } : null}
        onEditar={() => setEditando(true)}
      />
    );

  const tabs = [
    { valor: "curso" as const, etiqueta: "En curso", n: porPestana.curso.length },
    { valor: "entregados" as const, etiqueta: "Entregados", n: porPestana.entregados.length },
    { valor: "cancelados" as const, etiqueta: "Cancelados y rechazados", n: porPestana.cancelados.length },
  ];

  const vacio = pestana === "curso"
    ? { titulo: "No tienes pedidos en curso", desc: "Cuando hagas un pedido, aquí verás cada paso hasta la entrega." }
    : pestana === "entregados"
      ? { titulo: "Todavía no tienes pedidos entregados", desc: undefined }
      : { titulo: "No tienes pedidos cancelados ni rechazados", desc: undefined };

  return (
    <PortalPagina
      titulo="Mis pedidos"
      descripcion="Sigue cada pedido: aprobación, preparación, despacho, facturas y pagos."
      acciones={<Button asChild className="gap-2"><Link to="/portal/catalogo"><Plus className="h-4 w-4" />Hacer un pedido</Link></Button>}
    >
      <div className="lg:grid lg:grid-cols-[minmax(320px,400px)_minmax(0,1fr)] lg:items-start lg:gap-6">
        {/* Lista */}
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar pedido por número"
              aria-label="Buscar pedido por número"
              className="h-10 bg-card pl-9"
            />
          </div>
          <Segmentado<Pestana> opciones={tabs} valor={pestana} onCambio={setPestana} etiqueta="Estado de los pedidos" />

          {loading ? (
            <SkeletonFilas n={5} alto="h-[76px]" />
          ) : lista.length === 0 ? (
            <div className="rounded-xl border border-border bg-card">
              <EstadoVacio
                icono={ClipboardList}
                titulo={q ? `Sin pedidos que coincidan con «${busqueda.trim()}»` : vacio.titulo}
                descripcion={q ? "Prueba con otro número o revisa las otras pestañas." : vacio.desc}
                accion={pestana === "curso" && !q ? <Button asChild><Link to="/portal/catalogo">Hacer un pedido</Link></Button> : undefined}
              />
            </div>
          ) : (
            <>
              <ul className="overflow-hidden rounded-xl border border-border bg-card" aria-label="Pedidos">
                {visibles.map(({ o, ev }) => {
                  const activo = o.id === idDetalle && esEscritorio;
                  const n = o.lineas?.[0]?.count ?? 0;
                  return (
                    <li key={o.id} className="border-b border-border last:border-0">
                      <button
                        type="button"
                        onClick={() => abrir(o.id)}
                        aria-current={activo ? "true" : undefined}
                        className={cn(
                          "relative flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50",
                          activo && "bg-muted/70",
                        )}
                        data-testid="pedido-card"
                      >
                        {activo && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" aria-hidden />}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <NumeroPedido numero={o.numero} numeroGuds={o.numero_guds} className="truncate text-sm" />
                            <span className="shrink-0 text-sm font-semibold tabular-nums">{formatPrice(Number(o.total))}</span>
                          </div>
                          <div className="mt-1.5 flex items-center justify-between gap-2">
                            <span className="truncate text-xs text-muted-foreground">
                              {fechaCorta(fechaDe(o))} · {n} {n === 1 ? "producto" : "productos"}
                              {(o.ediciones ?? 0) > 0 && (
                                <span className="ml-1.5 rounded border border-border px-1 py-px text-[11px]" data-testid="pedido-editado"
                                  title={o.editado_at ? `Editado el ${fechaCorta(o.editado_at)}` : undefined}>Editado</span>
                              )}
                            </span>
                            <EstadoPill pedido={o} />
                          </div>
                          {ev.clave === "rechazado" && (
                            <p className="mt-1.5 line-clamp-2 text-xs text-destructive">{o.rechazo_motivo ? `Motivo: ${o.rechazo_motivo}` : "No se indicó el motivo."}</p>
                          )}
                        </div>
                        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground lg:hidden" />
                      </button>
                    </li>
                  );
                })}
              </ul>
              {lista.length > visibles.length && (
                <Button variant="outline" className="w-full" onClick={() => setLimite((l) => l + POR_PAGINA)}>
                  Mostrar más ({lista.length - visibles.length})
                </Button>
              )}
            </>
          )}
        </div>

        {/* Detalle (escritorio) */}
        <div className="sticky top-[5.5rem] hidden h-[calc(100vh-10.5rem)] min-h-[480px] flex-col overflow-hidden rounded-xl border border-border bg-card lg:flex">
          {esEscritorio && (idDetalle ? panelDetalle(idDetalle, false) : !loading && (
            <EstadoVacio icono={ClipboardList} titulo="Selecciona un pedido" descripcion="Aquí verás su estado, la línea de tiempo, las facturas y los despachos." className="my-auto" />
          ))}
        </div>
      </div>

      {/* Detalle (móvil y tableta) */}
      <Sheet open={!esEscritorio && !!seleccionado} onOpenChange={(v) => { if (!v) cerrar(); }}>
        <SheetContent side="bottom" className="flex h-[92vh] flex-col gap-0 rounded-t-2xl p-0 supports-[height:100dvh]:h-[92dvh] md:mx-auto md:max-w-2xl">
          {!esEscritorio && seleccionado && panelDetalle(seleccionado, true)}
        </SheetContent>
      </Sheet>
    </PortalPagina>
  );
};

export default PortalPedidos;
