import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AlertCircle, ChevronRight, FileText, RefreshCw, Search, X } from "lucide-react";
import { PortalPagina } from "@/components/portal/PortalPagina";
import { EstadoVacio, Segmentado, SkeletonFilas, fechaCorta, normalizar } from "@/components/portal/sistema";
import { NavFinanzas, PillDocumento } from "@/components/portal/finanzas";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import {
  TOLERANCIA, TRAMOS, conSigno, cuentaEnDeuda, diasEntre, esClaveTramo, estadoDocumento, etiquetaTipoDoc, hoyLocal, tramoDe,
  type DocumentoCliente,
} from "@/hooks/useFinanzasPortal";

// Facturas del cliente (F5): facturas, notas de débito y de crédito de su ficha en la empresa activa, con su estado de
// cobro (pagada / parcial / vencida / por pagar / anulada). "Por pagar" usa la misma regla que Cuentas por Cobrar del
// admin, así su total coincide con el saldo del estado de cuenta. ?tramo= filtra por antigüedad; ?ver= elige la pestaña.

type Vista = "por_pagar" | "vencidas" | "pagadas" | "todas";
const VISTAS: Vista[] = ["por_pagar", "vencidas", "pagadas", "todas"];
const POR_PAGINA = 30;

const PortalFacturas = () => {
  const { user } = useAuth();
  const { formatPrice } = useCurrency();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const hoy = useMemo(() => hoyLocal(), []);
  const [docs, setDocs] = useState<DocumentoCliente[] | null>(null);
  const [error, setError] = useState(false);
  const [q, setQ] = useState("");
  const [visibles, setVisibles] = useState(POR_PAGINA);

  const verParam = params.get("ver");
  const tramo = esClaveTramo(params.get("tramo")) ? params.get("tramo") : null;
  const vista: Vista = tramo ? "por_pagar" : VISTAS.includes(verParam as Vista) ? (verParam as Vista) : "por_pagar";

  const cargar = async () => {
    const cid = user?.cliente_id;
    if (!cid) return;
    setError(false);
    const { data, error: e } = await supabase
      .from("facturas")
      .select("id, numero, tipo, es_nota_debito, estado, estado_cobro, fecha_emision, fecha_vencimiento, total_usd, saldo_usd")
      .eq("cliente_id", cid)
      .order("fecha_emision", { ascending: false })
      .order("numero", { ascending: false });
    if (e) { setError(true); return; }
    setDocs(((data as DocumentoCliente[]) ?? []).map((d) => ({ ...d, total_usd: Number(d.total_usd ?? 0), saldo_usd: Number(d.saldo_usd ?? 0) })));
  };
  useEffect(() => { cargar(); }, [user?.cliente_id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setVisibles(POR_PAGINA); }, [vista, tramo, q]);

  const grupos = useMemo(() => {
    const todos = docs ?? [];
    const porPagar = todos.filter(cuentaEnDeuda);
    // Misma regla que el admin: saldo positivo con vencimiento pasado (incluye facturas anuladas cuyo saldo aún no se
    // cruzó con su nota de crédito; el admin también las cuenta)
    const vencidas = porPagar.filter((d) => tramoDe(d.fecha_vencimiento || d.fecha_emision, hoy) !== "por_vencer");
    const pagadas = todos.filter((d) => d.tipo !== "nota_credito" && estadoDocumento(d, hoy).clave === "pagada");
    return { por_pagar: porPagar, vencidas, pagadas, todas: todos };
  }, [docs, hoy]);

  const lista = useMemo(() => {
    let l = grupos[vista];
    if (tramo) l = l.filter((d) => tramoDe(d.fecha_vencimiento || d.fecha_emision, hoy) === tramo);
    const t = normalizar(q.trim());
    if (t) l = l.filter((d) => normalizar(d.numero).includes(t));
    if (vista === "por_pagar" || vista === "vencidas") {
      // Lo que vence primero, primero
      l = [...l].sort((a, b) => (a.fecha_vencimiento || a.fecha_emision || "").localeCompare(b.fecha_vencimiento || b.fecha_emision || ""));
    }
    return l;
  }, [grupos, vista, tramo, q, hoy]);

  const totalSaldo = lista.reduce((s, d) => s + (cuentaEnDeuda(d) ? Number(d.saldo_usd) : 0), 0);
  const enPantalla = lista.slice(0, visibles);

  const cambiarVista = (v: Vista) => {
    const n = new URLSearchParams(params);
    n.delete("tramo");
    if (v === "por_pagar") n.delete("ver"); else n.set("ver", v);
    setParams(n, { replace: true });
  };
  const quitarTramo = () => {
    const n = new URLSearchParams(params);
    n.delete("tramo");
    setParams(n, { replace: true });
  };

  const etiquetaTramo = TRAMOS.find((t) => t.k === tramo)?.etiqueta;
  const vacio = {
    por_pagar: { titulo: "No tienes facturas por pagar", desc: "Cuando tengas facturas con saldo pendiente, aparecerán aquí." },
    vencidas: { titulo: "No tienes facturas vencidas", desc: "Todo al día." },
    pagadas: { titulo: "Aún no hay facturas pagadas", desc: undefined },
    todas: { titulo: "Aún no tienes facturas", desc: "Tus facturas aparecerán aquí cuando se emitan." },
  }[vista];

  return (
    <PortalPagina titulo="Facturas" descripcion="Tus facturas, notas de crédito y notas de débito, con su saldo y estado.">
      <NavFinanzas />

      <div className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <Segmentado<Vista>
            className="lg:max-w-xl lg:flex-1"
            etiqueta="Facturas"
            valor={vista}
            onCambio={cambiarVista}
            opciones={[
              { valor: "por_pagar", etiqueta: "Por pagar" },
              { valor: "vencidas", etiqueta: "Vencidas", n: docs ? grupos.vencidas.length : undefined },
              { valor: "pagadas", etiqueta: "Pagadas" },
              { valor: "todas", etiqueta: "Todas" },
            ]}
          />
          <div className="relative lg:ml-auto lg:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por número"
              aria-label="Buscar factura por número"
              className="h-10 w-full rounded-md border border-border bg-card pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
            />
          </div>
        </div>

        {(tramo || ((vista === "por_pagar" || vista === "vencidas") && docs && lista.length > 0)) && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            {tramo ? (
              <button type="button" onClick={quitarTramo}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-sm hover:bg-muted" data-testid="chip-tramo">
                Antigüedad: {etiquetaTramo}<X className="h-3.5 w-3.5" aria-label="Quitar filtro" />
              </button>
            ) : <span />}
            {docs && lista.length > 0 && (
              <p className="text-sm text-muted-foreground">
                {lista.length} {lista.length === 1 ? "documento" : "documentos"} · saldo <span className="font-semibold tabular-nums text-foreground" data-testid="facturas-total">{formatPrice(totalSaldo)}</span>
              </p>
            )}
          </div>
        )}

        {error ? (
          <div className="rounded-xl border border-border bg-card">
            <EstadoVacio icono={AlertCircle} titulo="No pudimos cargar tus facturas"
              accion={<Button variant="outline" className="gap-2" onClick={cargar}><RefreshCw className="h-4 w-4" />Reintentar</Button>} />
          </div>
        ) : docs === null ? (
          <SkeletonFilas n={6} alto="h-16" />
        ) : lista.length === 0 ? (
          <div className="rounded-xl border border-border bg-card">
            <EstadoVacio icono={FileText} titulo={q ? `No hay documentos con «${q}»` : vacio.titulo} descripcion={q ? undefined : vacio.desc} />
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            {/* Escritorio y tableta: tabla */}
            <table className="hidden w-full text-sm md:table" data-testid="facturas-tabla">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Número</th>
                  <th className="px-3 py-2.5 font-medium">Emisión</th>
                  <th className="px-3 py-2.5 font-medium">Vencimiento</th>
                  <th className="px-3 py-2.5 text-right font-medium">Total</th>
                  <th className="px-3 py-2.5 text-right font-medium">Saldo</th>
                  <th className="px-3 py-2.5 font-medium">Estado</th>
                  <th className="w-px px-4 py-2.5"><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {enPantalla.map((d) => {
                  const e = estadoDocumento(d, hoy);
                  const saldo = Number(d.saldo_usd);
                  return (
                    <tr key={d.id} className="cursor-pointer hover:bg-muted/30" onClick={() => navigate(`/portal/facturas/${d.id}`)} data-testid="factura-fila">
                      <td className="px-4 py-3">
                        <Link to={`/portal/facturas/${d.id}`} className="font-medium tabular-nums hover:underline" onClick={(ev) => ev.stopPropagation()}>{d.numero}</Link>
                        <span className="block text-xs text-muted-foreground">{etiquetaTipoDoc(d)}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 tabular-nums text-muted-foreground">{fechaCorta(d.fecha_emision)}</td>
                      <td className={cn("whitespace-nowrap px-3 py-3 tabular-nums", e.clave === "vencida" ? "text-destructive" : "text-muted-foreground")}>
                        {d.tipo === "nota_credito" ? "—" : fechaCorta(d.fecha_vencimiento || d.fecha_emision)}
                        {e.dias ? <span className="block text-xs">hace {e.dias} {e.dias === 1 ? "día" : "días"}</span> : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{conSigno(formatPrice, Number(d.total_usd))}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums">
                        {e.clave === "anulada"
                          ? <span className="font-normal text-muted-foreground" title={Math.abs(saldo) > TOLERANCIA ? "Saldo por cruzar con su nota de crédito" : undefined}>{Math.abs(saldo) > TOLERANCIA ? formatPrice(Math.abs(saldo)) : "—"}</span>
                          : Math.abs(saldo) > TOLERANCIA ? formatPrice(Math.abs(saldo)) : formatPrice(0)}
                      </td>
                      <td className="px-3 py-3"><PillDocumento doc={d} hoy={hoy} /></td>
                      <td className="px-4 py-3 text-right">
                        {cuentaEnDeuda(d) && d.tipo !== "nota_credito" && e.clave !== "anulada" ? (
                          <Button asChild size="sm" variant="outline" onClick={(ev) => ev.stopPropagation()}>
                            <Link to={`/portal/pagos?factura=${d.id}`}>Pagar</Link>
                          </Button>
                        ) : <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground" />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Móvil: tarjetas */}
            <ul className="divide-y divide-border md:hidden" data-testid="facturas-lista">
              {enPantalla.map((d) => {
                const e = estadoDocumento(d, hoy);
                const saldo = Number(d.saldo_usd);
                const vence = d.fecha_vencimiento || d.fecha_emision;
                return (
                  <li key={d.id}>
                    <Link to={`/portal/facturas/${d.id}`} className="flex items-start justify-between gap-3 px-4 py-3 active:bg-muted/40" data-testid="factura-tarjeta">
                      <div className="min-w-0">
                        <p className="text-sm font-medium"><span className="text-muted-foreground">{etiquetaTipoDoc(d)}</span> <span className="tabular-nums">{d.numero}</span></p>
                        <p className={cn("mt-0.5 text-xs tabular-nums", e.clave === "vencida" ? "text-destructive" : "text-muted-foreground")}>
                          {d.tipo === "nota_credito" || !vence ? `Emitida el ${fechaCorta(d.fecha_emision)}`
                            : e.clave === "vencida" ? `Venció el ${fechaCorta(vence)} · hace ${diasEntre(vence, hoy)} d`
                            : `Vence el ${fechaCorta(vence)}`}
                        </p>
                        <div className="mt-1.5"><PillDocumento doc={d} hoy={hoy} /></div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold tabular-nums">
                          {Math.abs(saldo) > TOLERANCIA ? formatPrice(Math.abs(saldo)) : conSigno(formatPrice, Number(d.total_usd))}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {Math.abs(saldo) <= TOLERANCIA ? "Total"
                            : e.clave === "anulada" ? "Por cruzar"
                            : saldo < 0 ? "A favor" : `Saldo de ${conSigno(formatPrice, Number(d.total_usd))}`}
                        </p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>

            {lista.length > visibles && (
              <div className="border-t border-border px-4 py-3 text-center">
                <Button variant="outline" onClick={() => setVisibles((v) => v + POR_PAGINA)} data-testid="facturas-mas">
                  Ver más ({lista.length - visibles})
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </PortalPagina>
  );
};

export default PortalFacturas;
