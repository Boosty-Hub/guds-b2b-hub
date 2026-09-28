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

// Cartera del vendedor (plan de portales §5, V3): clientes ordenados por prioridad de cobro (vencido ponderado por los días
// de mora), antigüedad por tramos como filtro, y filtros por situación. Datos de cartera_vendedor() (misma definición de
// deuda que el admin y que resumen_vendedor()).

type Filtro = "todos" | "visitar" | "vencido" | "por_vencer" | "sin_compras" | "al_dia";
type Orden = "prioridad" | "vencido" | "mora" | "monto" | "nombre";

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

const VendedorCartera = () => {
  const { formatPrice } = useCurrency();
  const navigate = useNavigate();
  const { clientes, cargando, error } = useCarteraVendedor();
  const { resumen } = useResumenVendedor();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get("q") || "");
  const [filtro, setFiltro] = useState<Filtro>(() => (FILTROS.some((f) => f.valor === params.get("filtro")) ? params.get("filtro") as Filtro : "todos"));
  const [tramo, setTramo] = useState<keyof Tramos | null>(null);
  const [orden, setOrden] = useState<Orden>("prioridad");

  const tramos = useMemo(() => sumarTramos(clientes), [clientes]);
  const totales = useMemo(() => ({
    por_cobrar: clientes.reduce((s, c) => s + c.por_cobrar, 0),
    vencido: clientes.reduce((s, c) => s + c.vencido, 0),
    con_vencido: clientes.filter((c) => c.vencido > 0.009).length,
    vence_7d: clientes.reduce((s, c) => s + c.vence_7d, 0),
    a_favor: clientes.reduce((s, c) => s + c.a_favor, 0),
  }), [clientes]);

  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const t = norm(q.trim());
  const lista = useMemo(() => {
    const f = clientes.filter((c) =>
      (!t || norm(`${c.nombre_negocio} ${c.codigo ?? ""} ${c.ciudad ?? ""}`).includes(t))
      && (filtro === "todos" || (filtro === "visitar" ? paraVisitar(c) : filtro === "vencido" ? c.vencido > 0.009
        : filtro === "por_vencer" ? c.por_cobrar > 0.009 && c.vencido <= 0.009
        : filtro === "sin_compras" ? sinCompras(c) : c.por_cobrar <= 0.009))
      && (!tramo || Number(c.tramos[tramo]) > 0.009));
    const cmp: Record<Orden, (a: ClienteCartera, b: ClienteCartera) => number> = {
      prioridad: (a, b) => b.prioridad - a.prioridad || b.por_cobrar - a.por_cobrar,
      vencido: (a, b) => b.vencido - a.vencido,
      mora: (a, b) => b.dias_mora - a.dias_mora || b.vencido - a.vencido,
      monto: (a, b) => b.por_cobrar - a.por_cobrar,
      nombre: (a, b) => a.nombre_negocio.localeCompare(b.nombre_negocio),
    };
    return [...f].sort(cmp[orden]);
  }, [clientes, t, filtro, tramo, orden]);
  const pag = usePagination(lista, 50);

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
        { label: "Por cobrar", valor: formatPrice(totales.por_cobrar), detalle: `${clientes.filter((c) => c.por_cobrar > 0.009).length} clientes`, tono: totales.por_cobrar > 0.009 ? "negativo" : "normal",
          onClick: () => { setFiltro("todos"); setTramo(null); }, activo: filtro === "todos" && !tramo },
        { label: "Vencido", valor: formatPrice(totales.vencido), detalle: `${totales.con_vencido} clientes`, tono: totales.vencido > 0.009 ? "negativo" : "normal",
          onClick: () => { setFiltro("vencido"); setTramo(null); }, activo: filtro === "vencido" },
        { label: "Vence en 7 días", valor: formatPrice(totales.vence_7d), tono: totales.vence_7d > 0.009 ? "alerta" : "tenue",
          onClick: () => { setFiltro("por_vencer"); setTramo(null); }, activo: filtro === "por_vencer" },
        { label: "Saldo a favor", valor: formatPrice(Math.abs(totales.a_favor)), detalle: "notas de crédito", tono: "tenue" },
      ]} />
      <TramosAntiguedad tramos={tramos} activo={tramo} onElegir={setTramo} className="mb-3" />

      <BarraLista busqueda={q} onBusqueda={setQ} placeholder="Buscar cliente, código o ciudad..."
        filtros={
          <div className="flex w-full gap-1.5 overflow-x-auto pb-0.5 sm:w-auto [scrollbar-width:none]">
            {FILTROS.map((f) => (
              <Button key={f.valor} size="sm" variant={filtro === f.valor ? "default" : "outline"} onClick={() => setFiltro(f.valor)}
                className={cn("h-8 shrink-0", filtro === f.valor && "bg-emerald-500 text-white hover:bg-emerald-600")} data-testid={`filtro-${f.valor}`}>
                {f.etiqueta}
              </Button>
            ))}
          </div>
        }
        contador={cargando ? undefined : `${lista.length} clientes${tramo ? ` · ${TRAMOS.find((x) => x.clave === tramo)?.etiqueta}` : ""}`}
        acciones={
          <Select value={orden} onValueChange={(v) => setOrden(v as Orden)}>
            <SelectTrigger className="h-8 w-[170px] text-[13px]" data-testid="orden-cartera"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="prioridad">Prioridad de cobro</SelectItem>
              <SelectItem value="vencido">Mayor vencido</SelectItem>
              <SelectItem value="mora">Más días de mora</SelectItem>
              <SelectItem value="monto">Mayor saldo</SelectItem>
              <SelectItem value="nombre">Nombre</SelectItem>
            </SelectContent>
          </Select>
        } />

      <div className="rounded-lg border border-border bg-card">
        {cargando ? <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-emerald-500" /></div>
          : error ? <p className="p-4 text-sm text-destructive">No se pudo cargar la cartera: {error}</p>
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
                          {c.a_favor < -0.009 && <span className="block text-[11px] text-emerald-700 dark:text-emerald-400">{formatPrice(Math.abs(c.a_favor))} a favor</span>}
                        </TableCell>
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
