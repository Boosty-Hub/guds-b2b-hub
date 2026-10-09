import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, Lock, MessageSquare, MessageSquarePlus, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { TRAMOS, condicionPagoTexto } from "@/hooks/useFinanzasPortal";
import {
  ESTATUS, ORIGEN_TASA, anioMes, conceptoAbono, corteDe, estatusDe, fechaLarga, fechaNumerica, fmtBs, fmtTasa, fmtUsd, formatoRif,
  leyendaNotasEntrega, leyendaTasas, origenTasaTexto, textoActualizado, tipoYNumero, totalesDocumentos,
} from "./formato";
import type { AbonoDocumento, DocumentoAbierto, EstadoCuentaCompleto, EstatusDocumento } from "./tipos";

// EL estado de cuenta (fase 22c): un solo componente con el formato del Excel de finanzas ("FORMATO EDC") para el detalle
// de la cuenta (admin), el enlace público, el portal del cliente y la ficha del vendedor; el PDF y el Excel salen de los
// mismos datos y columnas. El modo solo cambia las acciones (comentar, enlaces a la factura) y si se ven los comentarios
// internos (solo admin).
//   · Encabezado: empresa y RIF, "Cliente: …" y "Estado de cuenta actualizado al dd/mm/aaaa" (fecha de corte).
//   · Franja: por cobrar, vencido, por vencer, a favor, saldo neto y la antigüedad del saldo.
//   · Tabla: Año · Mes (del vencimiento) · Tipo y Nº · Nº de control · Emisión · Vencimiento · Días transcurridos · Tasa de
//     emisión · Base · Impuesto · Total · Deuda (US$) · Estatus; las NC a favor en negativo; fila de totales. Cada documento se
//     despliega con "qué falta", los comentarios y sus abonos. Filtro por estatus.

export type ModoEstadoCuenta = "admin" | "publico" | "portal" | "vendedor";

export interface EstadoCuentaProps {
  datos: EstadoCuentaCompleto;
  modo: ModoEstadoCuenta;
  /** Recargando (se atenúa la tabla sin quitarla). */
  cargando?: boolean;
  /** Enlace del número de documento (admin: ficha de la factura; portal: su factura). */
  enlaceDocumento?: (d: DocumentoAbierto) => string | null;
  /** Admin: abrir los comentarios del documento. */
  onComentar?: (d: DocumentoAbierto) => void;
  /** Controles a la derecha del encabezado (selector de corte, PDF, Excel…). */
  acciones?: ReactNode;
  /** Ocultar el bloque de empresa del encabezado (cuando la página ya lo muestra). */
  sinEmpresa?: boolean;
  className?: string;
  testId?: string;
}

const n = (v: number | null | undefined) => Number(v ?? 0);
const hay = (v: number | null | undefined) => Math.abs(n(v)) >= 0.005;

const TONO_ESTATUS: Record<EstatusDocumento, string> = {
  pendiente: "border-border bg-muted/60 text-foreground",
  retencion: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200",
  nc_favor: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300",
  a_favor: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300",
};

export function PillEstatus({ d, className }: { d: DocumentoAbierto; className?: string }) {
  const e = estatusDe(d);
  return (
    <span className={cn("inline-flex items-center whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] leading-tight", TONO_ESTATUS[e], className)}
      data-testid="estatus" data-estatus={e}>
      {ESTATUS[e].texto}
    </span>
  );
}

const claseDias = (d: DocumentoAbierto) =>
  d.saldo < 0 ? "text-muted-foreground" : d.dias > 0 ? "text-destructive" : "text-muted-foreground";

const textoDiasCorto = (d: DocumentoAbierto) => (d.dias > 0 ? `${d.dias} días vencida` : d.dias === 0 ? "vence hoy" : `vence en ${-d.dias} días`);

export function EstadoCuenta({
  datos, modo, cargando, enlaceDocumento, onComentar, acciones, sinEmpresa, className, testId = "estado-cuenta",
}: EstadoCuentaProps) {
  const docs = useMemo(() => datos.abiertos ?? [], [datos.abiertos]);
  const [filtro, setFiltro] = useState<EstatusDocumento | "todos">("todos");
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const corte = corteDe(datos);
  const esHoy = corte === datos.hoy;
  const admin = modo === "admin";

  const conteo = useMemo(() => {
    const c: Record<EstatusDocumento, number> = { pendiente: 0, retencion: 0, nc_favor: 0, a_favor: 0 };
    for (const d of docs) c[estatusDe(d)]++;
    return c;
  }, [docs]);
  const visibles = useMemo(() => (filtro === "todos" ? docs : docs.filter((d) => estatusDe(d) === filtro)), [docs, filtro]);
  const tot = useMemo(() => totalesDocumentos(visibles), [visibles]);
  const clave = (d: DocumentoAbierto, i: number) => `${d.tipo}-${d.numero}-${i}`;
  const alternar = (k: string) => setAbiertos((s) => { const x = new Set(s); if (x.has(k)) x.delete(k); else x.add(k); return x; });

  const numero = (d: DocumentoAbierto) => {
    const url = enlaceDocumento?.(d);
    const t = tipoYNumero(d);
    return url
      ? <Link to={url} className="font-medium tabular-nums text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{t}</Link>
      : <span className="font-medium tabular-nums">{t}</span>;
  };
  const r = datos.resumen;
  const condicion = condicionPagoTexto(datos.cliente.condicion_pago, datos.cliente.dias_credito);
  const c = datos.credito;
  const limite = Number(c?.limite ?? 0);

  return (
    <section className={cn("rounded-lg border border-border bg-card", className)} data-testid={testId} data-corte={corte} data-modo={modo}>
      {/* Encabezado del formato */}
      <header className="flex flex-col gap-2 border-b border-border px-3 py-2.5 sm:px-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-0.5">
          {!sinEmpresa && datos.empresa && (
            <p className="truncate text-[13px] font-semibold">
              {datos.empresa.nombre}
              {datos.empresa.rif && <span className="ml-2 font-normal text-muted-foreground">RIF: {formatoRif(datos.empresa.rif)}</span>}
            </p>
          )}
          <p className="text-[13px]">
            <span className="text-muted-foreground">Cliente: </span>
            <span className="font-semibold" data-testid="ec-cliente">{datos.cliente.nombre}</span>
            {datos.cliente.rif && <span className="ml-2 text-xs text-muted-foreground">RIF {formatoRif(datos.cliente.rif)}</span>}
          </p>
          <p className="text-sm font-semibold" data-testid="ec-actualizado">
            {textoActualizado(datos)}
            {!esHoy && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">Corte pasado</span>}
          </p>
          {(condicion || (esHoy && c)) && (
            <p className="text-xs text-muted-foreground">
              {[condicion && `Condición de pago: ${condicion}`,
                esHoy && c && (c.modo === "abierto" ? "Crédito abierto" : limite > 0 ? `Límite de crédito ${fmtUsd(limite)} · disponible ${fmtUsd(Number(c.disponible ?? 0))}` : null),
              ].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
        {acciones && <div className="flex flex-wrap items-center gap-2 lg:justify-end">{acciones}</div>}
      </header>

      {/* Franja: resumen y antigüedad al corte */}
      <div className="grid grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-5" data-testid="ec-resumen">
        {[
          { k: "saldo", t: "Por cobrar", v: fmtUsd(r.saldo), d: `${r.facturas_abiertas} ${r.facturas_abiertas === 1 ? "documento" : "documentos"}`, cls: r.saldo > 0.009 ? "text-destructive" : "" },
          { k: "vencido", t: "Vencido", v: fmtUsd(r.vencido), d: r.facturas_vencidas ? `${r.facturas_vencidas} ${r.facturas_vencidas === 1 ? "vencido" : "vencidos"}` : "nada vencido", cls: r.vencido > 0.009 ? "text-destructive" : "text-muted-foreground" },
          { k: "por_vencer", t: "Por vencer", v: fmtUsd(r.por_vencer), d: "dentro del plazo", cls: "" },
          { k: "a_favor", t: "A favor", v: fmtUsd(-r.a_favor), d: r.a_favor > 0.009 ? [r.nc_a_favor > 0.009 && `NC ${fmtUsd(r.nc_a_favor)}`, r.anticipos > 0.009 && `anticipos ${fmtUsd(r.anticipos)}`].filter(Boolean).join(" · ") : "sin saldo a favor", cls: r.a_favor > 0.009 ? "text-success" : "text-muted-foreground" },
          { k: "neto", t: "Saldo neto", v: fmtUsd(r.neto), d: "por cobrar − a favor", cls: "text-primary" },
        ].map((x, i) => (
          <div key={x.k} className={cn("min-w-0 bg-card px-3 py-1.5", i === 4 && "max-sm:col-span-2")} data-testid={`ec-${x.k}`}>
            <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{x.t}</p>
            <p className={cn("truncate text-base font-semibold leading-tight tabular-nums", x.cls)}>{x.v}</p>
            <p className="truncate text-[11px] leading-tight text-muted-foreground">{x.d}</p>
          </div>
        ))}
      </div>
      {r.saldo > 0.009 && <Antiguedad resumen={r} />}

      {/* Filtro por estatus */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2 sm:px-4" role="group" aria-label="Estatus" data-testid="ec-filtro-estatus">
        {([["todos", "Todos", docs.length] as const, ...(["pendiente", "retencion", "nc_favor", "a_favor"] as EstatusDocumento[])
          .filter((e) => conteo[e] > 0).map((e) => [e, ESTATUS[e].texto, conteo[e]] as const)]).map(([v, t, k]) => (
          <button key={v} type="button" onClick={() => setFiltro(v)} aria-pressed={filtro === v}
            className={cn("rounded-full border px-2.5 py-0.5 text-xs", filtro === v ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground")}>
            {t} <span className="tabular-nums opacity-80">({k})</span>
          </button>
        ))}
        {cargando && <span className="ml-auto text-xs text-muted-foreground" aria-live="polite">Actualizando…</span>}
      </div>

      <div className={cn("transition-opacity", cargando && "opacity-60")} aria-busy={cargando}>
        {visibles.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground" data-testid="ec-vacio">
            {docs.length === 0 ? `No hay documentos con saldo al ${fechaNumerica(corte)}.` : "No hay documentos con este estatus."}
          </p>
        ) : (
          <>
            {/* Escritorio */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[1120px] text-xs" data-testid="ec-tabla">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-[11px] text-muted-foreground">
                    <th className="w-6 px-1 py-1.5" aria-label="Detalle" />
                    <th className="px-1.5 py-1.5 font-medium">Año</th>
                    <th className="px-1.5 py-1.5 font-medium">Mes</th>
                    <th className="px-2 py-1.5 font-medium">Tipo y Nº</th>
                    <th className="px-2 py-1.5 font-medium">Nº de control</th>
                    <th className="px-2 py-1.5 font-medium">Emisión</th>
                    <th className="px-2 py-1.5 font-medium">Vencimiento</th>
                    <th className="px-2 py-1.5 text-right font-medium" title="Fecha de corte − vencimiento (negativo = por vencer)">Días</th>
                    <th className="px-2 py-1.5 text-right font-medium" title="Bs por US$: en bolívares, la del documento; en dólares, la BCV del día de emisión">Tasa de emisión</th>
                    <th className="px-2 py-1.5 text-right font-medium">Base imponible US$</th>
                    <th className="px-2 py-1.5 text-right font-medium">Impuesto US$</th>
                    <th className="px-2 py-1.5 text-right font-medium">Total US$</th>
                    <th className="px-2 py-1.5 text-right font-medium">Deuda US$</th>
                    <th className="px-2 py-1.5 font-medium">Estatus</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((d, i) => {
                    const k = clave(d, i);
                    const abierto = abiertos.has(k);
                    const { anio, mes } = anioMes(d);
                    const nCom = d.comentarios?.length ?? 0;
                    return (
                      <Fragment key={k}>
                        <tr className={cn("cursor-pointer border-b border-border align-top hover:bg-muted/30", abierto && "bg-muted/20")} onClick={() => alternar(k)}
                          data-testid="ec-documento" data-tipo={d.tipo} data-numero={d.numero} data-estatus={estatusDe(d)}>
                          <td className="px-1 py-1.5">
                            <button type="button" onClick={(e) => { e.stopPropagation(); alternar(k); }} aria-expanded={abierto}
                              aria-label={`${abierto ? "Ocultar" : "Ver"} el detalle de ${tipoYNumero(d)}`} className="rounded p-0.5 text-muted-foreground hover:bg-muted">
                              {abierto ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                            </button>
                          </td>
                          <td className="px-1.5 py-1.5 tabular-nums text-muted-foreground">{anio ?? "—"}</td>
                          <td className="px-1.5 py-1.5 tabular-nums text-muted-foreground">{mes ?? "—"}</td>
                          <td className="whitespace-nowrap px-2 py-1.5">
                            {numero(d)}
                            {d.moneda === "VES" && <span className="ml-1 text-[10px] text-muted-foreground">Bs</span>}
                            {d.tipo === "nota_entrega" && <MarcaNoFiscal />}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-muted-foreground" data-testid="ec-control">{d.nro_control ?? "—"}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-muted-foreground">{fechaNumerica(d.emision)}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-muted-foreground">{fechaNumerica(d.vence ?? d.emision)}</td>
                          <td className={cn("whitespace-nowrap px-2 py-1.5 text-right tabular-nums", claseDias(d))} data-testid="ec-dias">{d.dias}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-muted-foreground" data-testid="ec-tasa" data-origen={d.tasa_origen ?? undefined}
                            title={origenTasaTexto(d) ? `Tasa: ${origenTasaTexto(d)}` : undefined}>{fmtTasa(d.tasa_emision)}<MarcaTasa d={d} alinear /></td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{hay(d.base) ? fmtUsd(n(d.base)) : "—"}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{hay(d.iva) ? fmtUsd(n(d.iva)) : "—"}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{fmtUsd(d.total)}</td>
                          <td className={cn("whitespace-nowrap px-2 py-1.5 text-right font-semibold tabular-nums", d.saldo < 0 && "text-success")} data-testid="ec-deuda">{fmtUsd(d.saldo)}</td>
                          <td className="px-2 py-1.5">
                            <span className="flex items-center gap-1.5">
                              <PillEstatus d={d} />
                              {d.que_falta && <Sparkles className="h-3 w-3 shrink-0 text-amber-600" aria-label="Con sugerencia de qué falta" />}
                              {nCom > 0 && <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground" title="Comentarios"><MessageSquare className="h-3 w-3" />{nCom}</span>}
                            </span>
                          </td>
                        </tr>
                        {abierto && (
                          <tr className="border-b border-border bg-muted/20" data-testid="ec-detalle">
                            <td />
                            <td colSpan={13} className="px-2 pb-2.5 pt-1"><Detalle d={d} modo={modo} onComentar={onComentar} /></td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/40 font-semibold" data-testid="ec-totales">
                    <td />
                    <td className="px-2 py-1.5" colSpan={8}>Totales{filtro !== "todos" ? ` (${ESTATUS[filtro].texto.toLowerCase()})` : ""}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{fmtUsd(tot.base)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{fmtUsd(tot.iva)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{fmtUsd(tot.total)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums" data-testid="ec-total-deuda">{fmtUsd(tot.deuda)}</td>
                    <td className="px-2 py-1.5 text-[11px] font-normal text-muted-foreground">
                      {tot.aFavor < -0.004 && <>Por cobrar {fmtUsd(tot.porCobrar)} · a favor {fmtUsd(tot.aFavor)}</>}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Teléfono: una tarjeta por documento */}
            <ul className="divide-y divide-border md:hidden" data-testid="ec-lista">
              {visibles.map((d, i) => {
                const k = clave(d, i);
                const abierto = abiertos.has(k);
                return (
                  <li key={k} className="px-3 py-2.5" data-testid="ec-documento-movil" data-tipo={d.tipo} data-estatus={estatusDe(d)}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm">{numero(d)}{d.moneda === "VES" && <span className="ml-1 text-[10px] text-muted-foreground">Bs</span>}{d.tipo === "nota_entrega" && <MarcaNoFiscal />}</p>
                        <p className="truncate text-[11px] text-muted-foreground">Control {d.nro_control ?? "—"} · emitida {fechaNumerica(d.emision)}</p>
                        <p className={cn("text-[11px]", claseDias(d))}>Vence {fechaNumerica(d.vence ?? d.emision)} · {d.saldo < 0 ? `${d.dias} días` : textoDiasCorto(d)}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={cn("text-sm font-semibold tabular-nums", d.saldo < 0 && "text-success")}>{fmtUsd(d.saldo)}</p>
                        <p className="text-[11px] tabular-nums text-muted-foreground">de {fmtUsd(d.total)}</p>
                      </div>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <PillEstatus d={d} />
                      <span className="tabular-nums">Base {fmtUsd(n(d.base))} · IVA {fmtUsd(n(d.iva))}</span>
                      <span className="tabular-nums">Tasa {fmtTasa(d.tasa_emision)}<MarcaTasa d={d} /></span>
                    </div>
                    <button type="button" onClick={() => alternar(k)} aria-expanded={abierto} className="mt-1.5 flex items-center gap-1 text-xs font-medium text-primary">
                      {abierto ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      {abierto ? "Ocultar detalle" : `Ver detalle${d.abonos?.length ? ` (${d.abonos.length} ${d.abonos.length === 1 ? "abono" : "abonos"})` : ""}`}
                    </button>
                    {abierto && <div className="mt-1.5 rounded-md bg-muted/40 p-2"><Detalle d={d} modo={modo} onComentar={onComentar} movil /></div>}
                  </li>
                );
              })}
              <li className="space-y-0.5 bg-muted/40 px-3 py-2.5 text-sm font-semibold" data-testid="ec-totales-movil">
                <div className="flex items-center justify-between"><span>Total deuda</span><span className="tabular-nums">{fmtUsd(tot.deuda)}</span></div>
                {tot.aFavor < -0.004 && (
                  <p className="text-[11px] font-normal text-muted-foreground">Por cobrar {fmtUsd(tot.porCobrar)} · a favor {fmtUsd(tot.aFavor)} · total {fmtUsd(tot.total)}</p>
                )}
              </li>
            </ul>
          </>
        )}
      </div>

      <footer className="space-y-1 border-t border-border px-3 py-2 text-[11px] text-muted-foreground sm:px-4">
        <p>
          Montos en dólares (US$); las notas de crédito a favor van en negativo y los documentos en bolívares se expresan en US$ a la tasa
          de cada documento. Días transcurridos = corte − vencimiento (negativo = por vencer). Tasa de emisión: en bolívares, la del documento;
          en dólares, la BCV del día de emisión; en una nota de crédito, la de la factura que afecta.
          {leyendaTasas(docs) && <span data-testid="ec-leyenda-tasas"> {leyendaTasas(docs)}.</span>}
          {leyendaNotasEntrega(docs) && <span data-testid="ec-leyenda-ne"> {leyendaNotasEntrega(docs)}; se incluye en el saldo.</span>} Toca un documento para ver sus abonos y comentarios.
        </p>
        <p>
          «Qué falta» es una sugerencia automática (tolerancia {fmtUsd(datos.tolerancia ?? 0.05)}); los comentarios los escribe nuestro equipo.
          {admin && " Los visibles salen en el enlace, el PDF, el Excel, el correo, el portal y la ficha del vendedor; los internos (candado) solo aquí."}
          {!esHoy && r.anticipos > 0.009 && " Los anticipos son los cobrados hasta el corte y aún sin aplicar hoy."}
        </p>
      </footer>
    </section>
  );
}

/** Marca de documento no fiscal (nota de entrega, 22j). */
function MarcaNoFiscal() {
  return <span className="ml-1 rounded bg-muted px-1 py-px text-[10px] text-muted-foreground" title="Nota de entrega: documento no fiscal, sin IVA">no fiscal</span>;
}

/** Barra de antigüedad del saldo por cobrar (por vencer y tramos de vencido) con su leyenda. */
function Antiguedad({ resumen }: { resumen: EstadoCuentaCompleto["resumen"] }) {
  const total = Number(resumen.saldo) || 0;
  return (
    <div className="border-b border-border px-3 py-2 sm:px-4" data-testid="ec-antiguedad">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted" role="img"
        aria-label={`Antigüedad del saldo: ${TRAMOS.map((t) => `${t.etiqueta} ${fmtUsd(Number(resumen[t.k]))}`).join(", ")}`}>
        {total > 0 && TRAMOS.map((t) => {
          const v = Number(resumen[t.k]) || 0;
          return v > 0 ? <div key={t.k} className={cn("h-full", t.barra)} style={{ width: `${(v / total) * 100}%` }} /> : null;
        })}
      </div>
      <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px]">
        {TRAMOS.map((t) => {
          const v = Number(resumen[t.k]) || 0;
          return (
            <li key={t.k} className={cn("flex items-center gap-1.5", v <= 0 && "text-muted-foreground")}>
              <span className={cn("h-2 w-2 shrink-0 rounded-sm", t.barra)} aria-hidden />
              {t.etiqueta}: <span className="font-medium tabular-nums" data-testid={`tramo-${t.k}`}>{fmtUsd(v)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Lo que se despliega bajo un documento: qué falta, comentarios, lo abonado por tipo y cada abono. */
/** Marca junto a la tasa cuando no es la regla general: F (factura que afecta la NC) o P (tomada de Profit). En la tabla
 *  (alinear) ocupa siempre el mismo ancho para que las tasas queden alineadas. */
function MarcaTasa({ d, alinear }: { d: DocumentoAbierto; alinear?: boolean }) {
  const m = d.tasa_origen ? ORIGEN_TASA[d.tasa_origen]?.marca : "";
  if (!m && !alinear) return null;
  return (
    <sup className={cn("ml-0.5 text-[9px] font-semibold text-amber-700 dark:text-amber-300", alinear && "inline-block w-1.5 text-left")}
      aria-label={m ? `Tasa: ${origenTasaTexto(d) ?? ""}` : undefined} aria-hidden={m ? undefined : true}>{m}</sup>
  );
}

function Detalle({ d, modo, onComentar, movil }: { d: DocumentoAbierto; modo: ModoEstadoCuenta; onComentar?: (d: DocumentoAbierto) => void; movil?: boolean }) {
  const admin = modo === "admin";
  const comentarios = (d.comentarios ?? []).filter((c) => admin || c.visible !== false);
  const abonos = d.abonos ?? [];
  const partes = ([["Cobros", d.pagos], ["Notas de crédito", d.nc], ["Retenciones", d.retenciones], ["Otros", d.otros]] as [string, number | undefined][])
    .filter(([, v]) => hay(v));
  return (
    <div className="space-y-2 text-xs" data-testid="ec-detalle-contenido">
      <div className={cn("flex flex-wrap gap-x-4 gap-y-1", movil && "flex-col")}>
        {d.que_falta && (
          <span title="Sugerencia automática de GUDS según la base, el IVA y lo abonado" data-testid="que-falta" data-codigo={d.que_falta.codigo}
            className="inline-flex max-w-full items-start gap-1 self-start rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] leading-tight text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <Sparkles className="mt-px h-3 w-3 shrink-0" aria-hidden />
            <span className="min-w-0"><span className="font-medium">Qué falta: </span>{d.que_falta.texto}</span>
          </span>
        )}
        {partes.length > 0 && (
          <span className="text-muted-foreground">
            Abonado {fmtUsd(n(d.abonado))}: {partes.map(([t, v]) => `${t.toLowerCase()} ${fmtUsd(n(v))}`).join(" · ")}
          </span>
        )}
        {d.moneda === "VES" && d.total_bs != null && (
          <span className="text-muted-foreground">En Bs: total {fmtBs(d.total_bs)}{d.saldo_bs != null ? ` · deuda ${fmtBs(d.saldo_bs)}` : ""}</span>
        )}
        {d.tasa_emision != null && origenTasaTexto(d) && (
          <span className="text-muted-foreground" data-testid="ec-tasa-origen">Tasa de emisión {fmtTasa(d.tasa_emision)}: {origenTasaTexto(d)}</span>
        )}
      </div>

      {(comentarios.length > 0 || onComentar) && (
        <div className="flex items-start gap-2">
          <ul className="min-w-0 flex-1 space-y-0.5" data-testid="comentarios">
            {comentarios.map((c, i) => (
              <li key={c.id ?? i} className="leading-snug" data-testid="comentario">
                {admin && c.visible === false && <Lock className="mr-1 inline h-3 w-3 text-muted-foreground" aria-label="Interno" />}
                <span className="italic">{c.texto}</span>
                <span className="ml-1 text-[10px] text-muted-foreground">{[admin ? c.autor : null, fechaLarga(c.fecha)].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
            {comentarios.length === 0 && <li className="text-muted-foreground">Sin comentarios.</li>}
          </ul>
          {onComentar && d.factura_id && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onComentar(d); }} data-testid="comentar"
              className="inline-flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground">
              <MessageSquarePlus className="h-3.5 w-3.5" /> Comentar
            </button>
          )}
        </div>
      )}

      {abonos.length === 0 ? <p className="text-muted-foreground">Sin abonos al corte.</p> : movil ? <AbonosLista abonos={abonos} /> : <AbonosTabla abonos={abonos} />}
    </div>
  );
}

function AbonosTabla({ abonos }: { abonos: AbonoDocumento[] }) {
  return (
    <table className="w-full max-w-4xl text-xs" data-testid="abonos">
      <thead>
        <tr className="text-left text-[11px] text-muted-foreground">
          <th className="py-0.5 pr-2 font-medium">Fecha</th><th className="px-2 py-0.5 font-medium">Concepto</th><th className="px-2 py-0.5 font-medium">Documento</th>
          <th className="px-2 py-0.5 font-medium">Referencia</th><th className="px-2 py-0.5 font-medium">Banco</th>
          <th className="px-2 py-0.5 text-right font-medium">Monto</th>
        </tr>
      </thead>
      <tbody>
        {abonos.map((a, i) => (
          <tr key={i} className="border-t border-border/60" data-testid="abono" data-tipo={a.tipo}>
            <td className="whitespace-nowrap py-0.5 pr-2 tabular-nums text-muted-foreground">{fechaNumerica(a.fecha)}</td>
            <td className="whitespace-nowrap px-2 py-0.5">{conceptoAbono(a)}</td>
            <td className="px-2 py-0.5 tabular-nums">{a.documento || "—"}</td>
            <td className="px-2 py-0.5 text-muted-foreground">{a.referencia || "—"}</td>
            <td className="px-2 py-0.5 text-muted-foreground">{a.banco || "—"}</td>
            <td className="whitespace-nowrap px-2 py-0.5 text-right tabular-nums">
              {fmtUsd(a.monto)}
              {a.moneda === "VES" && a.monto_moneda != null && <span className="ml-1 text-[10px] text-muted-foreground">({fmtBs(a.monto_moneda)})</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AbonosLista({ abonos }: { abonos: AbonoDocumento[] }) {
  return (
    <ul className="space-y-1.5" data-testid="abonos-movil">
      {abonos.map((a, i) => (
        <li key={i} className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p>{conceptoAbono(a)} <span className="tabular-nums text-muted-foreground">{a.documento}</span></p>
            <p className="truncate text-[11px] text-muted-foreground">{[fechaNumerica(a.fecha), a.banco, a.referencia && `ref. ${a.referencia}`].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="shrink-0 text-right tabular-nums">
            {fmtUsd(a.monto)}
            {a.moneda === "VES" && a.monto_moneda != null && <p className="text-[10px] text-muted-foreground">{fmtBs(a.monto_moneda)}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}
