import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ChevronRight, CreditCard, Loader2, MessageCircle, Phone } from "lucide-react";
import { VendedorLayout } from "@/components/vendedor/VendedorLayout";
import { TramosAntiguedad } from "@/components/vendedor/TramosAntiguedad";
import { AvisoEmpresaCartera } from "@/components/vendedor/AvisoEmpresaCartera";
import { useCarteraVendedor, sumarTramos, TRAMOS } from "@/components/vendedor/cartera";
import { useResumenVendedor } from "@/components/vendedor/resumen";
import { enlaceWhatsApp, telefonoLlamar, telefonoWhatsApp } from "@/components/vendedor/contacto";
import { diasDesde, fechaCorta, type ClienteCartera, type Tramos } from "@/components/vendedor/tipos";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { BarraLista } from "@/components/datos/BarraLista";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useMetricasCobranza, dsoAlto, tendencia, textoDso, IconoTendencia } from "@/components/cuentas/metricas";
import {
  FiltrosLista, useFiltros, opcionesDe, opcionesTexto, opcionesPrueba, pasaPrueba, coincide, coincideTexto, contadorFiltrado,
  type OpcionPrueba,
} from "@/components/datos/FiltrosLista";

// Cartera del vendedor (plan de portales §5, V3): clientes ordenados por prioridad de cobro (vencido ponderado por los días
// de mora), antigüedad por tramos como filtro, y filtros por situación. Datos de cartera_vendedor() (misma definición de
// deuda que el admin y que resumen_vendedor()).
// 21b: DSO por cliente (deuda ÷ venta promedio diaria de 90 días) con tendencia contra el mes anterior, de
// metricas_cobranza (solo sus clientes); deuda y saldo a favor (NC sin aplicar) por separado.

type Filtro = "todos" | "visitar" | "vencido" | "por_vencer" | "sin_compras" | "al_dia";
type Orden = "prioridad" | "vencido" | "mora" | "monto" | "dso" | "nombre";

const FILTROS: { valor: Filtro; etiqueta: string }[] = [
  { valor: "todos", etiqueta: "Todos" },
  { valor: "visitar", etiqueta: "Para visitar" },
  { valor: "vencido", etiqueta: "Con vencido" },
  { valor: "por_vencer", etiqueta: "Por vencer" },
  { valor: "sin_compras", etiqueta: "Sin compras +30 días" },
  { valor: "al_dia", etiqueta: "Al día" },
];

const sinCompras = (c: ClienteCartera) => { const d = diasDesde(c.ultima_compra); return d == null || d > 30; };
// "Para visitar": misma regla que el tablero Hoy (hoy_vendedor): vencido, algo que vence en 7 días, o compra seguido
// (2+ pedidos en 6 meses) y no pide hace más de 30 días
const paraVisitar = (c: ClienteCartera) => c.vencido > 0.009 || c.vence_7d > 0.009 || (c.compras_180d >= 2 && (diasDesde(c.ultima_compra) ?? 0) > 30);

// Situación (los botones de la barra) como pruebas, para contar y filtrar con la misma regla
const PRUEBAS_SITUACION: OpcionPrueba<ClienteCartera>[] = [
  { valor: "visitar", etiqueta: "Para visitar", prueba: paraVisitar },
  { valor: "vencido", etiqueta: "Con vencido", prueba: (c) => c.vencido > 0.009 },
  { valor: "por_vencer", etiqueta: "Por vencer", prueba: (c) => c.por_cobrar > 0.009 && c.vencido <= 0.009 },
  { valor: "sin_compras", etiqueta: "Sin compras +30 días", prueba: sinCompras },
  { valor: "al_dia", etiqueta: "Al día", prueba: (c) => c.por_cobrar <= 0.009 },
];
const PRUEBAS_COBROS: OpcionPrueba<ClienteCartera>[] = [
  { valor: "si", etiqueta: "Con cobros por verificar", prueba: (c) => c.cobros_pendientes > 0 },
  { valor: "no", etiqueta: "Sin cobros por verificar", prueba: (c) => !(c.cobros_pendientes > 0) },
];
const textoCondicion = (c: string) => c.replace(/^Immediate Payment$/i, "Pago inmediato").replace(/^(\d+)\s*Days?$/i, "$1 días").replace(/^contado$/i, "Contado");

const VendedorCartera = () => {
  const { formatPrice } = useCurrency();
  const navigate = useNavigate();
  const { clientes, cargando, error } = useCarteraVendedor();
  const { resumen } = useResumenVendedor();
  const { datos: metricas } = useMetricasCobranza(90);
  const metricaDe = useMemo(() => new Map((metricas?.clientes ?? []).map((m) => [m.cliente_id, m])), [metricas]);
  const umbral = metricas?.alerta_dso ?? 60;
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get("q") || "");
  const [orden, setOrden] = useState<Orden>("prioridad");

  // ---- Filtros (en la URL): situación (?filtro=, como enlaza el tablero Hoy), tramo, ciudad, condición y cobros ----
  const f = useFiltros([
    { clave: "filtro", etiqueta: "Situación", todos: "Todos", opciones: opcionesPrueba(clientes, PRUEBAS_SITUACION) },
    { clave: "tramo", etiqueta: "Antigüedad", todos: "Todos los tramos", opciones: TRAMOS.map((t) => ({ valor: t.clave, etiqueta: t.etiqueta, n: clientes.filter((c) => Number(c.tramos[t.clave]) > 0.009).length })) },
    { clave: "ciudad", etiqueta: "Ciudad", todos: "Todas las ciudades", opciones: opcionesTexto(clientes, (c) => c.ciudad, "Sin ciudad") },
    { clave: "condicion", etiqueta: "Condición de pago", todos: "Todas", opciones: opcionesDe(clientes, (c) => c.condicion_pago, (_c, v) => textoCondicion(v), "Sin condición") },
    { clave: "cobros", etiqueta: "Cobros por verificar", todos: "Todos", opciones: opcionesPrueba(clientes, PRUEBAS_COBROS) },
  ]);
  const filtro = (FILTROS.some((x) => x.valor === f.v("filtro")) ? f.v("filtro") : "todos") as Filtro;
  const tramo = (TRAMOS.some((t) => t.clave === f.v("tramo")) ? f.v("tramo") : null) as keyof Tramos | null;
  const setFiltro = (v: Filtro) => f.set("filtro", v === "todos" ? "" : v);
  const setTramo = (t: keyof Tramos | null) => f.set("tramo", t ?? "");
  // Indicadores y tramos: sobre los clientes que pasan ciudad, condición y cobros (sin esos filtros = toda la cartera, como antes)
  const base = useMemo(() => clientes.filter((c) => coincideTexto(c.ciudad, f.v("ciudad")) && coincide(c.condicion_pago, f.v("condicion"))
    && pasaPrueba(PRUEBAS_COBROS, f.v("cobros"), c)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [clientes, f.firma]);

  const tramos = useMemo(() => sumarTramos(base), [base]);
  const totales = useMemo(() => ({
    por_cobrar: base.reduce((s, c) => s + c.por_cobrar, 0),
    vencido: base.reduce((s, c) => s + c.vencido, 0),
    con_vencido: base.filter((c) => c.vencido > 0.009).length,
    vence_7d: base.reduce((s, c) => s + c.vence_7d, 0),
    a_favor: base.reduce((s, c) => s + c.a_favor, 0),
  }), [base]);

  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const t = norm(q.trim());
  const lista = useMemo(() => {
    const filas = base.filter((c) =>
      (!t || norm(`${c.nombre_negocio} ${c.codigo ?? ""} ${c.ciudad ?? ""}`).includes(t))
      && pasaPrueba(PRUEBAS_SITUACION, filtro === "todos" ? "" : filtro, c)
      && (!tramo || Number(c.tramos[tramo]) > 0.009));
    const cmp: Record<Orden, (a: ClienteCartera, b: ClienteCartera) => number> = {
      prioridad: (a, b) => b.prioridad - a.prioridad || b.por_cobrar - a.por_cobrar,
      vencido: (a, b) => b.vencido - a.vencido,
      mora: (a, b) => b.dias_mora - a.dias_mora || b.vencido - a.vencido,
      monto: (a, b) => b.por_cobrar - a.por_cobrar,
      dso: (a, b) => (metricaDe.get(b.id)?.dso ?? (b.por_cobrar > 0.009 ? 99999 : -1)) - (metricaDe.get(a.id)?.dso ?? (a.por_cobrar > 0.009 ? 99999 : -1)),
      nombre: (a, b) => a.nombre_negocio.localeCompare(b.nombre_negocio),
    };
    return [...filas].sort(cmp[orden]);
  }, [base, t, filtro, tramo, orden, metricaDe]);
  const pag = usePagination(lista, 50, f.firma);

  const situacion = (c: ClienteCartera) => c.vencido > 0.009
    ? <Badge variant="outline" className="whitespace-nowrap border-red-300 bg-red-50 px-1.5 py-0 text-[11px] text-red-800 dark:bg-red-500/10 dark:text-red-300">Vencido · {c.dias_mora} d</Badge>
    : c.por_cobrar > 0.009 ? <Badge variant="outline" className="whitespace-nowrap border-amber-300 bg-amber-50 px-1.5 py-0 text-[11px] text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">Por vencer</Badge>
    : c.a_favor < -0.009 ? <Badge variant="outline" className="whitespace-nowrap border-emerald-300 bg-emerald-50 px-1.5 py-0 text-[11px] text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">Saldo a favor</Badge>
    : <Badge variant="outline" className="whitespace-nowrap border-emerald-300 bg-emerald-50 px-1.5 py-0 text-[11px] text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">Al día</Badge>;

  const acciones = (c: ClienteCartera) => {
    const tel = c.celular || c.telefono;
    return (
      <div className="relative z-10 flex shrink-0 items-center gap-0.5">
        {tel && <a href={`tel:${telefonoLlamar(tel)}`} className="rounded-md p-2 text-muted-foreground hover:bg-muted" aria-label={`Llamar a ${c.nombre_negocio}`} onClick={(e) => e.stopPropagation()}><Phone className="h-4 w-4" /></a>}
        {telefonoWhatsApp(tel) && <a href={enlaceWhatsApp(tel, `Hola, ${c.nombre_negocio}. `)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
          className="rounded-md p-2 text-muted-foreground hover:bg-muted" aria-label={`WhatsApp a ${c.nombre_negocio}`}><MessageCircle className="h-4 w-4" /></a>}
        {c.por_cobrar > 0.009 && <Link to={`/vendedor/cobros/nuevo?cliente=${c.id}`} onClick={(e) => e.stopPropagation()}
          className="rounded-md p-2 text-muted-foreground hover:bg-muted" aria-label={`Registrar cobro de ${c.nombre_negocio}`}><CreditCard className="h-4 w-4" /></Link>}
      </div>
    );
  };

  return (
    <VendedorLayout title="Cartera">
      {resumen && <AvisoEmpresaCartera clientes={resumen.clientes} porEmpresa={resumen.clientes_por_empresa} />}
      <KpiStrip items={[
        { label: "Por cobrar", valor: formatPrice(totales.por_cobrar), detalle: `${base.filter((c) => c.por_cobrar > 0.009).length} clientes`, tono: totales.por_cobrar > 0.009 ? "negativo" : "normal",
          onClick: () => f.setVarios({ filtro: "", tramo: "" }), activo: filtro === "todos" && !tramo },
        { label: "Vencido", valor: formatPrice(totales.vencido), detalle: `${totales.con_vencido} clientes`, tono: totales.vencido > 0.009 ? "negativo" : "normal",
          onClick: () => f.setVarios({ filtro: "vencido", tramo: "" }), activo: filtro === "vencido" },
        { label: "Vence en 7 días", valor: formatPrice(totales.vence_7d), tono: totales.vence_7d > 0.009 ? "alerta" : "tenue",
          onClick: () => f.setVarios({ filtro: "por_vencer", tramo: "" }), activo: filtro === "por_vencer" },
        { label: "Saldo a favor", valor: formatPrice(Math.abs(totales.a_favor)), detalle: "notas de crédito", tono: "tenue" },
      ]} />
      <TramosAntiguedad tramos={tramos} activo={tramo} onElegir={setTramo} className="mb-3" />

      <BarraLista busqueda={q} onBusqueda={setQ} placeholder="Buscar cliente, código o ciudad..."
        filtros={
          <>
            <div className="flex w-full gap-1.5 overflow-x-auto pb-0.5 sm:w-auto [scrollbar-width:none]">
            {FILTROS.map((x) => (
              <Button key={x.valor} size="sm" variant={filtro === x.valor ? "default" : "outline"} onClick={() => setFiltro(x.valor)} aria-pressed={filtro === x.valor}
                className={cn("h-8 shrink-0", filtro === x.valor && "bg-emerald-700 text-white hover:bg-emerald-800")} data-testid={`filtro-${x.valor}`}>
                {x.etiqueta}
              </Button>
            ))}
            </div>
            <FiltrosLista filtros={f} resultados={lista.length} />
          </>
        }
        contador={cargando ? undefined : `${contadorFiltrado(lista.length, clientes.length, f.activos || !!t, "clientes")}${tramo ? ` · ${TRAMOS.find((x) => x.clave === tramo)?.etiqueta}` : ""}`}
        acciones={
          <Select value={orden} onValueChange={(v) => setOrden(v as Orden)}>
            <SelectTrigger className="h-8 w-[170px] text-[13px]" aria-label="Ordenar clientes" data-testid="orden-cartera"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="prioridad">Prioridad de cobro</SelectItem>
              <SelectItem value="vencido">Mayor vencido</SelectItem>
              <SelectItem value="mora">Más días de mora</SelectItem>
              <SelectItem value="monto">Mayor saldo</SelectItem>
              <SelectItem value="dso">Mayor DSO</SelectItem>
              <SelectItem value="nombre">Nombre</SelectItem>
            </SelectContent>
          </Select>
        } />

      <div className="rounded-lg border border-border bg-card">
        {cargando ? <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-emerald-700" /></div>
          : error ? <p className="p-4 text-sm text-destructive" role="alert">No se pudo cargar la cartera: {error}</p>
          : lista.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">{clientes.length ? "Ningún cliente con ese filtro." : "No tienes clientes activos en tu cartera."}</p>
          : (
            <>
              {/* Teléfono: tarjetas; tocar abre la ficha */}
              <ul className="divide-y divide-border md:hidden" data-testid="cartera-tarjetas">
                {pag.pageItems.map((c) => (
                  <li key={c.id} className="relative flex items-start gap-2 px-3 py-2.5 hover:bg-muted/40" data-testid="cartera-cliente">
                    <div className="min-w-0 flex-1">
                      <Link to={`/vendedor/clientes/${c.id}`} className="line-clamp-2 text-sm font-semibold leading-snug after:absolute after:inset-0">{c.nombre_negocio}</Link>
                      <p className="truncate text-xs text-muted-foreground">{[c.ciudad, c.ultima_compra ? `compró ${fechaCorta(c.ultima_compra)}` : "sin compras"].filter(Boolean).join(" · ")}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                        {situacion(c)}
                        {c.vencido > 0.009 && <span className="font-semibold tabular-nums text-destructive">{formatPrice(c.vencido)} vencido</span>}
                        {c.por_cobrar > 0.009 && <span className="tabular-nums text-muted-foreground">de {formatPrice(c.por_cobrar)}</span>}
                        {c.cobros_pendientes > 0 && <span className="text-amber-700 dark:text-amber-300">{c.cobros_pendientes} cobro(s) por verificar</span>}
                        {(() => { const m = metricaDe.get(c.id); return m && m.deuda > 0.009 ? (
                          <span className={cn("inline-flex items-center gap-0.5 tabular-nums", dsoAlto(m, umbral) ? "font-semibold text-destructive" : "text-muted-foreground")}>DSO {textoDso(m)}<IconoTendencia t={tendencia(m)} /></span>
                        ) : null; })()}
                      </div>
                    </div>
                    {acciones(c)}
                  </li>
                ))}
              </ul>
              {/* Escritorio: tabla */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Situación</TableHead>
                    <TableHead className="text-right">Vencido</TableHead>
                    <TableHead className="text-right">Por cobrar</TableHead>
                    <TableHead className="text-right" title="Días de venta adeudados: deuda ÷ venta promedio diaria de 90 días">DSO</TableHead>
                    <TableHead className="hidden text-right lg:table-cell">A favor</TableHead>
                    <TableHead className="hidden lg:table-cell">Próx. vencimiento</TableHead>
                    <TableHead className="hidden lg:table-cell">Última compra</TableHead>
                    <TableHead className="hidden xl:table-cell">Último cobro</TableHead>
                    <TableHead className="w-px"><span className="sr-only">Acciones</span></TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {pag.pageItems.map((c) => (
                      <TableRow key={c.id} className="cursor-pointer" onClick={() => navigate(`/vendedor/clientes/${c.id}`)} data-testid="cartera-fila">
                        <TableCell className="max-w-[300px]">
                          <Link to={`/vendedor/clientes/${c.id}`} onClick={(e) => e.stopPropagation()} className="block truncate font-medium hover:underline" title={c.nombre_negocio}>{c.nombre_negocio}</Link>
                          <span className="block truncate text-[11px] text-muted-foreground">{[c.codigo, c.ciudad, c.condicion_pago].filter(Boolean).join(" · ")}</span>
                        </TableCell>
                        <TableCell>{situacion(c)}</TableCell>
                        <TableCell className={cn("whitespace-nowrap text-right tabular-nums", c.vencido > 0.009 && "font-semibold text-destructive")}>{formatPrice(c.vencido)}</TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">
                          {formatPrice(c.por_cobrar)}
                          {c.a_favor < -0.009 && <span className="block text-[11px] text-emerald-700 dark:text-emerald-400 lg:hidden">{formatPrice(Math.abs(c.a_favor))} a favor</span>}
                        </TableCell>
                        {(() => { const m = metricaDe.get(c.id); return (
                          <TableCell className={cn("whitespace-nowrap text-right tabular-nums", m && dsoAlto(m, umbral) ? "font-semibold text-destructive" : "text-muted-foreground")} data-testid="cartera-dso">
                            <span className="inline-flex items-center justify-end gap-1">{m ? textoDso(m) : "—"}{m && <IconoTendencia t={tendencia(m)} />}</span>
                          </TableCell>
                        ); })()}
                        <TableCell className="hidden whitespace-nowrap text-right tabular-nums text-emerald-700 dark:text-emerald-400 lg:table-cell">{c.a_favor < -0.009 ? formatPrice(Math.abs(c.a_favor)) : ""}</TableCell>
                        <TableCell className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">{c.proximo_vencimiento ? fechaCorta(c.proximo_vencimiento) : "—"}</TableCell>
                        <TableCell className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">{fechaCorta(c.ultima_compra)}</TableCell>
                        <TableCell className="hidden whitespace-nowrap text-muted-foreground xl:table-cell">{fechaCorta(c.ultimo_cobro)}</TableCell>
                        <TableCell className="py-0.5">
                          <div className="flex items-center justify-end">{acciones(c)}<ChevronRight className="h-4 w-4 text-muted-foreground" /></div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        {!cargando && lista.length > 0 && <DataTablePagination pagination={pag} />}
      </div>
    </VendedorLayout>
  );
};

export default VendedorCartera;
