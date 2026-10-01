import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, CalendarRange, CheckCircle, Clock, Download, FileText, Plus, RefreshCw, Wallet } from "lucide-react";
import { PortalPagina } from "@/components/portal/PortalPagina";
import { EstadoVacio, Kpi, Panel, Segmentado, SkeletonFilas, fechaCorta } from "@/components/portal/sistema";
import {
  Antiguedad, DocumentoMovimiento, NavFinanzas, conceptoMovimiento, exportarEstadoCuentaCSV,
} from "@/components/portal/finanzas";
import { BotonPdfEstadoCuenta } from "@/components/estado-cuenta/BotonPdfEstadoCuenta";
import type { EstadoCuentaCompleto, FiltroDocumentos } from "@/components/estado-cuenta/tipos";
import { FiltroDocumentosSelector, TablaDocumentos } from "@/components/estado-cuenta/TablaDocumentos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCurrency } from "@/contexts/CurrencyContext";
import { cn } from "@/lib/utils";
import { conSigno, condicionPagoTexto, hoyLocal, sumarDias, useEstadoCuenta, type EstadoCuenta, type Movimiento } from "@/hooks/useFinanzasPortal";

// Estado de cuenta del cliente (F5): saldo, vencido, por vencer y a favor con la regla de Cuentas por Cobrar del admin
// (función estado_cuenta_portal), antigüedad por tramos, crédito y los movimientos del período con saldo corrido.
// Descarga en CSV y en PDF con diseño (el mismo documento del admin y del enlace público, fase 20w).
// 21b: documentos con el cruce por factura (base, IVA, abonos, saldo, qué falta y comentarios visibles) y movimientos
// desde la factura abierta más antigua.

type Rango = "abierta" | "30" | "90" | "anio" | "todo" | "fechas";
const POR_PAGINA = 40;

const periodoDe = (rango: Rango, hoy: string, fechas: { desde: string; hasta: string }): { desde: string | null; hasta: string | null; desdeAbierta?: boolean } => {
  switch (rango) {
    case "abierta": return { desde: null, hasta: null, desdeAbierta: true };
    case "30": return { desde: sumarDias(hoy, -30), hasta: null };
    case "90": return { desde: sumarDias(hoy, -90), hasta: null };
    case "anio": return { desde: `${hoy.slice(0, 4)}-01-01`, hasta: null };
    case "todo": return { desde: null, hasta: null };
    case "fechas": return { desde: fechas.desde || null, hasta: fechas.hasta || null };
  }
};

const PortalEstadoCuenta = () => {
  const { formatPrice, currency } = useCurrency();
  const hoy = useMemo(() => hoyLocal(), []);
  const [rango, setRango] = useState<Rango>("abierta");
  const [filtroDocs, setFiltroDocs] = useState<FiltroDocumentos>("abiertas");
  const [fechas, setFechas] = useState({ desde: sumarDias(hoy, -90), hasta: hoy });
  const [aplicadas, setAplicadas] = useState(fechas);
  const periodo = useMemo(() => periodoDe(rango, hoy, aplicadas), [rango, hoy, aplicadas]);
  const periodoConFiltro = useMemo(() => ({ ...periodo, filtro: filtroDocs }), [periodo, filtroDocs]);
  const { datos, cargando, error, recargar } = useEstadoCuenta(periodoConFiltro);
  const ec = datos as EstadoCuentaCompleto | null;
  const [visibles, setVisibles] = useState(POR_PAGINA);

  useEffect(() => { setVisibles(POR_PAGINA); }, [periodo.desde, periodo.hasta]);

  const r = datos?.resumen;
  const primeraCarga = cargando && !datos;
  const fechasInvalidas = rango === "fechas" && !!fechas.desde && !!fechas.hasta && fechas.desde > fechas.hasta;

  // En pantalla, lo más reciente primero (el saldo de cada renglón es el saldo corrido tras ese movimiento)
  const movs = useMemo(() => [...(datos?.movimientos ?? [])].reverse(), [datos?.movimientos]);
  const enPantalla = movs.slice(0, visibles);

  const acciones = (
    <>
      <Button variant="outline" className="gap-2" onClick={() => datos && exportarEstadoCuentaCSV(datos)} disabled={!datos} data-testid="ec-csv">
        <Download className="h-4 w-4" />CSV
      </Button>
      <BotonPdfEstadoCuenta datos={datos as EstadoCuentaCompleto | null} etiqueta="PDF" />
      <Button asChild className="gap-2"><Link to="/portal/pagos?declarar=1"><Plus className="h-4 w-4" />Declarar pago</Link></Button>
    </>
  );

  return (
    <PortalPagina
      titulo="Estado de cuenta"
      descripcion={datos?.empresa ? `Tu cuenta con ${datos.empresa.nombre_corto ?? datos.empresa.nombre}: saldo, antigüedad y movimientos.` : "Saldo, antigüedad y movimientos de tu cuenta."}
      acciones={acciones}
    >
      <NavFinanzas />

      {error && !datos ? (
        <div className="rounded-xl border border-border bg-card">
          <EstadoVacio icono={AlertCircle} titulo="No pudimos cargar tu estado de cuenta" descripcion="Revisa tu conexión e intenta de nuevo."
            accion={<Button variant="outline" className="gap-2" onClick={recargar}><RefreshCw className="h-4 w-4" />Reintentar</Button>} />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Indicadores */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi etiqueta="Saldo por pagar" icono={Wallet} cargando={primeraCarga} testId="ec-saldo" valor={formatPrice(r?.saldo ?? 0)}
              detalle={r ? (r.facturas_abiertas === 0 ? "Sin facturas pendientes" : `${r.facturas_abiertas} ${r.facturas_abiertas === 1 ? "documento" : "documentos"}`) : undefined} />
            <Kpi etiqueta="Vencido" icono={AlertCircle} cargando={primeraCarga} testId="ec-vencido" valor={formatPrice(r?.vencido ?? 0)}
              alerta={(r?.vencido ?? 0) > 0}
              detalle={r ? (r.facturas_vencidas === 0 ? "Nada vencido" : `${r.facturas_vencidas} ${r.facturas_vencidas === 1 ? "documento vencido" : "documentos vencidos"}`) : undefined}
              href={r && r.vencido > 0 ? "/portal/facturas?ver=vencidas" : undefined} />
            <Kpi etiqueta="Por vencer" icono={Clock} cargando={primeraCarga} testId="ec-por-vencer" valor={formatPrice(r?.por_vencer ?? 0)}
              detalle="Dentro del plazo" />
            <Kpi etiqueta="A favor" icono={CheckCircle} cargando={primeraCarga} testId="ec-a-favor" valor={formatPrice(r?.a_favor ?? 0)}
              detalle={r ? (r.a_favor <= 0 ? "Sin saldo a favor" : [r.nc_a_favor > 0 && `Notas de crédito ${formatPrice(r.nc_a_favor)}`, r.anticipos > 0 && `Anticipos ${formatPrice(r.anticipos)}`].filter(Boolean).join(" · ")) : undefined} />
          </div>

          {/* Acciones en móvil y tableta */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:hidden">
            <Button asChild className="col-span-2 h-11 gap-2 sm:col-span-1"><Link to="/portal/pagos?declarar=1"><Plus className="h-4 w-4" />Declarar pago</Link></Button>
            <Button variant="outline" className="h-11 gap-2" onClick={() => datos && exportarEstadoCuentaCSV(datos)} disabled={!datos}>
              <Download className="h-4 w-4" />Descargar CSV
            </Button>
            <BotonPdfEstadoCuenta datos={datos as EstadoCuentaCompleto | null} className="h-11" data-testid="ec-pdf-movil" />
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
            <Panel titulo="Antigüedad del saldo" descripcion="Días desde el vencimiento de cada factura. Toca un tramo para ver sus facturas.">
              {primeraCarga || !r ? <SkeletonFilas n={5} alto="h-8" /> : r.saldo <= 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">No tienes saldo pendiente.</p>
              ) : <Antiguedad resumen={r} />}
            </Panel>

            <Panel titulo="Resumen de la cuenta">
              {primeraCarga || !datos ? <SkeletonFilas n={4} alto="h-6" /> : <ResumenCuentaPanel datos={datos} />}
            </Panel>
          </div>

          {/* Documentos con el cruce por factura */}
          <Panel
            titulo={filtroDocs === "abiertas" ? "Documentos con saldo" : filtroDocs === "todas" ? "Documentos del período" : "Documentos pagados en el período"}
            descripcion={filtroDocs === "abiertas" ? "Por factura: cuánto era, cuánto has abonado y qué falta. Toca un documento para ver sus abonos." : datos ? descripcionPeriodo(datos, hoy).replace(/^\d+ movimientos? · /, "") : undefined}
            accion={<FiltroDocumentosSelector valor={filtroDocs} onCambio={setFiltroDocs} className="hidden sm:flex" />}
            cuerpoClassName="p-0 sm:p-0"
          >
            <div className="border-b border-border px-4 py-2 sm:hidden"><FiltroDocumentosSelector valor={filtroDocs} onCambio={setFiltroDocs} className="w-full overflow-x-auto" /></div>
            {primeraCarga ? <div className="p-4 sm:p-5"><SkeletonFilas n={3} alto="h-12" /></div> : !ec ? null : (
              <div className={cn("transition-opacity", cargando && "opacity-60")}>
                <TablaDocumentos docs={(filtroDocs === "abiertas" ? ec.abiertos : ec.documentos) ?? []} formato={formatPrice} limite={10}
                  enlace={(d) => (d.factura_id ? `/portal/facturas/${d.factura_id}` : null)} totales={filtroDocs === "abiertas"} testId="ec-documentos"
                  vacio={<p className="px-4 py-6 text-center text-sm text-muted-foreground">{filtroDocs === "abiertas" ? "No tienes documentos con saldo pendiente." : "No hay documentos en este período."}</p>} />
                <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground sm:px-5">«Qué falta» es una sugerencia automática según la base, el IVA y lo abonado; los comentarios los escribe nuestro equipo.</p>
              </div>
            )}
          </Panel>

          {/* Movimientos */}
          <Panel
            titulo="Movimientos"
            descripcion={datos ? descripcionPeriodo(datos, hoy) : undefined}
            cuerpoClassName="p-0 sm:p-0"
          >
            <div className="space-y-3 border-b border-border px-4 py-3 sm:px-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Segmentado<Rango>
                  className="sm:max-w-md sm:flex-1"
                  etiqueta="Período"
                  valor={rango}
                  onCambio={setRango}
                  opciones={[
                    { valor: "abierta", etiqueta: "Desde lo pendiente" },
                    { valor: "30", etiqueta: "30 días" }, { valor: "90", etiqueta: "90 días" },
                    { valor: "anio", etiqueta: "Este año" }, { valor: "todo", etiqueta: "Todo" },
                  ]}
                />
                <Button type="button" variant={rango === "fechas" ? "secondary" : "ghost"} className="gap-2 sm:ml-auto" onClick={() => setRango("fechas")}
                  aria-pressed={rango === "fechas"} data-testid="ec-rango-fechas">
                  <CalendarRange className="h-4 w-4" />Elegir fechas
                </Button>
              </div>
              {rango === "fechas" && (
                <form className="grid grid-cols-2 gap-2 sm:flex sm:items-end" onSubmit={(e) => { e.preventDefault(); if (!fechasInvalidas) setAplicadas(fechas); }}>
                  <div className="space-y-1">
                    <Label htmlFor="ec-desde" className="text-xs">Desde</Label>
                    <Input id="ec-desde" type="date" value={fechas.desde} max={fechas.hasta || hoy} onChange={(e) => setFechas({ ...fechas, desde: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="ec-hasta" className="text-xs">Hasta</Label>
                    <Input id="ec-hasta" type="date" value={fechas.hasta} min={fechas.desde || undefined} max={hoy} onChange={(e) => setFechas({ ...fechas, hasta: e.target.value })} />
                  </div>
                  <Button type="submit" className="col-span-2 sm:col-span-1" disabled={fechasInvalidas}>Aplicar</Button>
                  {fechasInvalidas && <p className="col-span-2 text-xs text-destructive">La fecha inicial no puede ser posterior a la final.</p>}
                </form>
              )}
            </div>

            {primeraCarga ? (
              <div className="p-4 sm:p-5"><SkeletonFilas n={6} alto="h-12" /></div>
            ) : !datos ? null : (
              <div className={cn("transition-opacity", cargando && "opacity-60")} aria-busy={cargando}>
                <FilaSaldo etiqueta={`Saldo al ${fechaCorta(datos.periodo.hasta ?? datos.hoy)}`} valor={datos.saldo_final} fuerte testId="ec-saldo-final" />
                {movs.length === 0 ? (
                  <EstadoVacio icono={FileText} titulo="Sin movimientos en este período" descripcion="Elige un período más amplio para ver movimientos anteriores." />
                ) : (
                  <>
                    <TablaMovimientos movs={enPantalla} />
                    <ListaMovimientos movs={enPantalla} />
                    {movs.length > visibles && (
                      <div className="border-t border-border px-4 py-3 text-center sm:px-5">
                        <Button variant="outline" onClick={() => setVisibles((v) => v + POR_PAGINA)} data-testid="ec-mas">
                          Ver movimientos anteriores ({movs.length - visibles})
                        </Button>
                      </div>
                    )}
                  </>
                )}
                {datos.periodo.desde && (movs.length <= visibles) && (
                  <FilaSaldo etiqueta={`Saldo anterior al ${fechaCorta(datos.periodo.desde)}`} valor={datos.saldo_inicial} testId="ec-saldo-inicial" />
                )}
              </div>
            )}
          </Panel>

          {currency === "BS" && (
            <p className="text-center text-xs text-muted-foreground">Los montos se muestran en bolívares a la tasa del día. El CSV y el PDF van en USD.</p>
          )}
        </div>
      )}

    </PortalPagina>
  );
};

const descripcionPeriodo = (d: EstadoCuenta, hoy: string) => {
  const n = d.movimientos.length;
  const cuantos = `${n} ${n === 1 ? "movimiento" : "movimientos"}`;
  if (!d.periodo.desde) return `${cuantos} · desde el inicio hasta el ${fechaCorta(d.periodo.hasta ?? hoy)}`;
  return `${cuantos} · del ${fechaCorta(d.periodo.desde)} al ${fechaCorta(d.periodo.hasta ?? hoy)}`;
};

function ResumenCuentaPanel({ datos }: { datos: EstadoCuenta }) {
  const { formatPrice } = useCurrency();
  const r = datos.resumen;
  const c = datos.credito;
  const condicion = condicionPagoTexto(datos.cliente.condicion_pago, datos.cliente.dias_credito);
  const limite = Number(c?.limite ?? 0);
  return (
    <div className="space-y-4">
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Saldo por pagar</dt><dd className="tabular-nums">{formatPrice(r.saldo)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Saldo a favor</dt><dd className="tabular-nums">{r.a_favor > 0 ? `−${formatPrice(r.a_favor)}` : formatPrice(0)}</dd></div>
        <div className="flex justify-between gap-3 border-t border-border pt-2 font-semibold">
          <dt>Saldo neto</dt><dd className="tabular-nums" data-testid="ec-neto">{conSigno(formatPrice, r.neto)}</dd>
        </div>
      </dl>
      <dl className="space-y-2 rounded-lg bg-muted/50 px-3 py-2.5 text-sm">
        {condicion && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Condición de pago</dt><dd className="text-right">{condicion}</dd></div>}
        {c && (c.modo === "abierto" ? (
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Crédito</dt><dd>Abierto (sin tope)</dd></div>
        ) : limite > 0 ? (
          <>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Límite de crédito</dt><dd className="tabular-nums">{formatPrice(limite)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Crédito disponible</dt><dd className="font-medium tabular-nums">{formatPrice(Number(c.disponible ?? 0))}</dd></div>
          </>
        ) : (
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Crédito</dt><dd>Sin línea de crédito</dd></div>
        ))}
      </dl>
      <Link to="/portal/facturas" className="flex items-center justify-center gap-1.5 text-sm font-medium text-primary hover:underline">
        <FileText className="h-4 w-4" />Ver mis facturas
      </Link>
    </div>
  );
}

function FilaSaldo({ etiqueta, valor, fuerte, testId }: { etiqueta: string; valor: number; fuerte?: boolean; testId?: string }) {
  const { formatPrice } = useCurrency();
  return (
    <div className={cn("flex items-center justify-between gap-3 bg-muted/40 px-4 py-2.5 text-sm sm:px-5", fuerte ? "border-b border-border font-semibold" : "border-t border-border text-muted-foreground")}>
      <span>{etiqueta}</span>
      <span className="tabular-nums" data-testid={testId}>{conSigno(formatPrice, valor)}</span>
    </div>
  );
}

/** Escritorio: tabla con cargo, abono y saldo. */
function TablaMovimientos({ movs }: { movs: Movimiento[] }) {
  const { formatPrice } = useCurrency();
  return (
    <div className="hidden md:block">
      <table className="w-full text-sm" data-testid="ec-tabla">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="px-5 py-2 font-medium">Fecha</th>
            <th className="px-3 py-2 font-medium">Documento</th>
            <th className="px-3 py-2 font-medium">Concepto</th>
            <th className="px-3 py-2 text-right font-medium">Cargo</th>
            <th className="px-3 py-2 text-right font-medium">Abono</th>
            <th className="px-5 py-2 text-right font-medium">Saldo</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {movs.map((m, i) => (
            <tr key={`${m.tipo}-${m.documento}-${m.fecha}-${i}`} className="hover:bg-muted/30" data-testid="ec-movimiento">
              <td className="whitespace-nowrap px-5 py-2.5 tabular-nums text-muted-foreground">{fechaCorta(m.fecha)}</td>
              <td className="px-3 py-2.5"><DocumentoMovimiento m={m} /></td>
              <td className="px-3 py-2.5">
                {conceptoMovimiento(m)}
                {(m.tipo === "factura" || m.tipo === "nota_debito") && m.vence && m.estado !== "anulado" && (
                  <span className="ml-1.5 text-xs text-muted-foreground">vence {fechaCorta(m.vence)}</span>
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{m.monto > 0 ? formatPrice(m.monto) : ""}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-success">{m.monto < 0 ? formatPrice(-m.monto) : ""}</td>
              <td className="whitespace-nowrap px-5 py-2.5 text-right font-medium tabular-nums">{conSigno(formatPrice, m.saldo)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Móvil: una fila por movimiento (concepto y documento a la izquierda; monto con signo y saldo a la derecha). */
function ListaMovimientos({ movs }: { movs: Movimiento[] }) {
  const { formatPrice } = useCurrency();
  return (
    <ul className="divide-y divide-border md:hidden" data-testid="ec-lista">
      {movs.map((m, i) => (
        <li key={`${m.tipo}-${m.documento}-${m.fecha}-${i}`} className="flex items-start justify-between gap-3 px-4 py-3" data-testid="ec-movimiento-movil">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{conceptoMovimiento(m)}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {fechaCorta(m.fecha)}{m.tipo !== "redondeo" && m.documento ? " · " : ""}<DocumentoMovimiento m={m} className="text-xs" />
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className={cn("text-sm font-semibold tabular-nums", m.monto < 0 && "text-success")}>
              {m.monto < 0 ? `−${formatPrice(-m.monto)}` : `+${formatPrice(m.monto)}`}
            </p>
            <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">Saldo {conSigno(formatPrice, m.saldo)}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default PortalEstadoCuenta;
