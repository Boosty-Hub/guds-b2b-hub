import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, Lock, MessageSquarePlus, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TIPO_DOCUMENTO, conceptoAbono, fechaLarga, fechaNumerica, fmtBs, fmtUsd, textoDias } from "./formato";
import type { AbonoDocumento, DocumentoAbierto } from "./tipos";

// Tabla de documentos con el cruce (fase 21b): por factura, base imponible e IVA, lo abonado por tipo (pagos, notas de
// crédito, retenciones y otros), el saldo, "qué falta" (sugerencia de GUDS, distinta del comentario de una persona) y el
// comentario visible. Cada documento se despliega para ver sus abonos (fecha, tipo, documento, referencia, banco y
// monto). La misma tabla en el admin, el enlace público, el portal del cliente y la ficha del vendedor; el PDF y el correo
// muestran lo mismo con su propio formato. Montos en USD; los documentos en bolívares muestran además los Bs a la tasa
// del documento.

export interface TablaDocumentosProps {
  docs: DocumentoAbierto[];
  /** "admin": comentarios internos (con candado), autor y botón para comentar. */
  modo?: "admin" | "cliente";
  /** Formato de los montos en USD (por defecto -$1,234.56). */
  formato?: (n: number) => string;
  /** Enlace del número de documento (p. ej. a la ficha de la factura). */
  enlace?: (d: DocumentoAbierto) => string | null;
  onComentar?: (d: DocumentoAbierto) => void;
  /** Documentos visibles de entrada (el resto con "Ver todos"); sin límite si no se indica. */
  limite?: number;
  /** Mostrar la fila de totales. */
  totales?: boolean;
  vacio?: ReactNode;
  className?: string;
  testId?: string;
}

const n = (v: number | null | undefined) => Number(v ?? 0);
const hay = (v: number | null | undefined) => Math.abs(n(v)) >= 0.005;

const claseDias = (d: DocumentoAbierto) => (d.saldo < 0 ? "text-success" : d.saldo > 0.009 && d.dias > 0 ? "text-destructive" : "text-muted-foreground");

/** "Pendiente el IVA" con su marca de sugerencia automática. */
export function QueFaltaPill({ d, compacto }: { d: DocumentoAbierto; compacto?: boolean }) {
  if (!d.que_falta) return null;
  return (
    <span title="Sugerencia automática de GUDS según la base, el IVA y lo abonado" data-testid="que-falta" data-codigo={d.que_falta.codigo}
      className={cn("inline-flex max-w-full items-start gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] leading-tight text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200",
        compacto && "py-0")}>
      <Sparkles className="mt-px h-3 w-3 shrink-0" aria-hidden />
      <span className="min-w-0"><span className="sr-only">Sugerencia: </span>{d.que_falta.texto}</span>
    </span>
  );
}

/** Último comentario vigente (los internos con candado, solo en el admin). */
function Comentario({ d, modo, onComentar }: { d: DocumentoAbierto; modo: "admin" | "cliente"; onComentar?: (d: DocumentoAbierto) => void }) {
  const c = d.comentarios?.[0];
  const mas = (d.comentarios?.length ?? 0) - 1;
  return (
    <div className="flex min-w-0 items-start gap-1">
      {c ? (
        <p className="min-w-0 text-xs leading-snug" data-testid="comentario" title={modo === "admin" && c.autor ? `${c.autor} · ${fechaLarga(c.fecha)}` : fechaLarga(c.fecha)}>
          {modo === "admin" && c.visible === false && <Lock className="mr-1 inline h-3 w-3 text-muted-foreground" aria-label="Interno" />}
          <span className="italic">{c.texto}</span>
          {mas > 0 && <span className="ml-1 text-muted-foreground">(+{mas})</span>}
        </p>
      ) : modo === "admin" ? <span className="text-xs text-muted-foreground">—</span> : null}
      {onComentar && (
        <button type="button" onClick={(e) => { e.stopPropagation(); onComentar(d); }} data-testid="comentar"
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Comentar ${d.numero}`} title="Comentar">
          <MessageSquarePlus className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function Abonos({ abonos, formato }: { abonos: AbonoDocumento[]; formato: (n: number) => string }) {
  if (!abonos.length) return <p className="px-3 py-2 text-xs text-muted-foreground">Sin abonos.</p>;
  return (
    <table className="w-full text-xs" data-testid="abonos">
      <thead>
        <tr className="text-left text-[11px] text-muted-foreground">
          <th className="px-3 py-1 font-medium">Fecha</th><th className="px-2 py-1 font-medium">Tipo</th><th className="px-2 py-1 font-medium">Documento</th>
          <th className="px-2 py-1 font-medium">Referencia</th><th className="px-2 py-1 font-medium">Banco</th>
          <th className="px-3 py-1 text-right font-medium">Monto</th>
        </tr>
      </thead>
      <tbody>
        {abonos.map((a, i) => (
          <tr key={i} className="border-t border-border/60" data-testid="abono" data-tipo={a.tipo}>
            <td className="whitespace-nowrap px-3 py-1 tabular-nums text-muted-foreground">{fechaNumerica(a.fecha)}</td>
            <td className="whitespace-nowrap px-2 py-1">{conceptoAbono(a)}</td>
            <td className="px-2 py-1 tabular-nums">{a.documento || "—"}</td>
            <td className="px-2 py-1 text-muted-foreground">{a.referencia || "—"}</td>
            <td className="px-2 py-1 text-muted-foreground">{a.banco || "—"}</td>
            <td className="whitespace-nowrap px-3 py-1 text-right tabular-nums">
              {formato(a.monto)}
              {a.moneda === "VES" && a.monto_moneda != null && <span className="block text-[10px] text-muted-foreground">{fmtBs(a.monto_moneda)}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const Bs = ({ v }: { v: number | null | undefined }) => (v == null ? null : <span className="block text-[10px] font-normal text-muted-foreground">{fmtBs(v)}</span>);

export function TablaDocumentos({
  docs, modo = "cliente", formato = fmtUsd, enlace, onComentar, limite, totales = true, vacio, className, testId = "tabla-documentos",
}: TablaDocumentosProps) {
  const [abiertos, setAbiertos] = useState<Set<number>>(new Set());
  const [todos, setTodos] = useState(false);
  const visibles = limite && !todos ? docs.slice(0, limite) : docs;
  const alternar = (i: number) => setAbiertos((s) => { const x = new Set(s); if (x.has(i)) x.delete(i); else x.add(i); return x; });

  const suma = useMemo(() => {
    const f = docs.filter((d) => d.tipo !== "nota_credito");
    const k = (c: keyof DocumentoAbierto) => f.reduce((s, d) => s + n(d[c] as number), 0);
    return {
      base: k("base"), iva: k("iva"), total: k("total"), pagos: k("pagos"), nc: k("nc"), retenciones: k("retenciones"), otros: k("otros"), saldo: k("saldo"),
      favor: docs.filter((d) => d.tipo === "nota_credito").reduce((s, d) => s + n(d.saldo), 0),
      hayNc: docs.some((d) => d.tipo === "nota_credito"),
    };
  }, [docs]);

  if (!docs.length) return <>{vacio ?? <p className="px-4 py-6 text-center text-sm text-muted-foreground">No hay documentos.</p>}</>;

  const numero = (d: DocumentoAbierto) => {
    const url = enlace?.(d);
    return url ? <Link to={url} className="font-medium tabular-nums text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{d.numero}</Link>
      : <span className="font-medium tabular-nums">{d.numero}</span>;
  };
  const monto = (v: number | null | undefined, cls?: string) => <span className={cn("tabular-nums", !hay(v) && "text-muted-foreground/60", cls)}>{hay(v) ? formato(n(v)) : "—"}</span>;

  return (
    <div className={className} data-testid={testId}>
      {/* Escritorio */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[1080px] text-xs" data-testid={`${testId}-tabla`}>
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left text-[11px] text-muted-foreground">
              <th className="w-6 px-1 py-1.5" aria-label="Abonos" />
              <th className="px-2 py-1.5 font-medium">Nº</th>
              <th className="px-2 py-1.5 font-medium">Emisión</th>
              <th className="px-2 py-1.5 font-medium">Vence</th>
              <th className="px-2 py-1.5 text-right font-medium">Días</th>
              <th className="px-2 py-1.5 text-right font-medium">Base imp.</th>
              <th className="px-2 py-1.5 text-right font-medium">IVA</th>
              <th className="px-2 py-1.5 text-right font-medium">Total</th>
              <th className="px-2 py-1.5 text-right font-medium">Pagos</th>
              <th className="px-2 py-1.5 text-right font-medium">NC</th>
              <th className="px-2 py-1.5 text-right font-medium">Retenc.</th>
              <th className="px-2 py-1.5 text-right font-medium">Otros</th>
              <th className="px-2 py-1.5 text-right font-medium">Saldo</th>
              <th className="min-w-[150px] px-2 py-1.5 font-medium">Qué falta</th>
              <th className="min-w-[150px] px-2 py-1.5 font-medium">Comentario</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((d, i) => {
              const abierto = abiertos.has(i);
              const nAb = d.abonos?.length ?? 0;
              return (
                <Fragment key={`${d.numero}-${i}`}>
                  <tr className={cn("border-b border-border align-top", nAb > 0 && "cursor-pointer hover:bg-muted/30")} onClick={() => nAb > 0 && alternar(i)}
                    data-testid="documento" data-tipo={d.tipo} data-numero={d.numero}>
                    <td className="px-1 py-1.5">
                      {nAb > 0 && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); alternar(i); }} aria-expanded={abierto}
                          aria-label={`${abierto ? "Ocultar" : "Ver"} abonos de ${d.numero}`} className="rounded p-0.5 text-muted-foreground hover:bg-muted">
                          {abierto ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </button>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      {numero(d)}
                      {d.tipo !== "factura" && <span className="block text-[10px] text-muted-foreground">{TIPO_DOCUMENTO[d.tipo]}</span>}
                      {d.moneda === "VES" && <span className="block text-[10px] text-muted-foreground">En Bs{d.tasa ? ` · tasa ${d.tasa.toLocaleString("es-VE", { maximumFractionDigits: 2 })}` : ""}</span>}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-muted-foreground">{fechaNumerica(d.emision)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-muted-foreground">{fechaNumerica(d.vence ?? d.emision)}</td>
                    <td className={cn("whitespace-nowrap px-2 py-1.5 text-right tabular-nums", claseDias(d))} title={textoDias(d)}>
                      {d.saldo < 0 ? "—" : Math.abs(d.saldo) <= 0.009 ? "—" : d.dias > 0 ? d.dias : d.dias === 0 ? "hoy" : `en ${-d.dias}`}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">{monto(d.base)}<Bs v={d.base_bs} /></td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">{monto(d.iva)}<Bs v={d.iva_bs} /></td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">{monto(d.total)}<Bs v={d.total_bs} /></td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">{monto(d.pagos, "text-success")}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">{monto(d.nc, "text-success")}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">{monto(d.retenciones, "text-success")}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">{monto(d.otros, "text-success")}</td>
                    <td className={cn("whitespace-nowrap px-2 py-1.5 text-right font-semibold", d.saldo < 0 ? "text-success" : d.saldo > 0.009 ? "text-foreground" : "text-muted-foreground")} data-testid="saldo">
                      {formato(d.saldo)}<Bs v={d.saldo_bs} />
                    </td>
                    <td className="px-2 py-1.5"><QueFaltaPill d={d} /></td>
                    <td className="px-2 py-1.5"><Comentario d={d} modo={modo} onComentar={onComentar} /></td>
                  </tr>
                  {abierto && (
                    <tr className="border-b border-border bg-muted/20">
                      <td />
                      <td colSpan={14} className="py-1 pr-2"><Abonos abonos={d.abonos ?? []} formato={formato} /></td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          {totales && (
            <tfoot>
              <tr className="bg-muted/30 font-semibold">
                <td />
                <td className="px-2 py-1.5" colSpan={4}>Total por cobrar{suma.hayNc ? " (facturas y ND)" : ""}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{formato(suma.base)}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{formato(suma.iva)}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{formato(suma.total)}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{formato(suma.pagos)}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{formato(suma.nc)}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{formato(suma.retenciones)}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{formato(suma.otros)}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums" data-testid="total-saldo">{formato(suma.saldo)}</td>
                <td colSpan={2} />
              </tr>
              {suma.hayNc && (
                <tr className="bg-muted/30 text-success">
                  <td />
                  <td className="px-2 py-1.5" colSpan={11}>Notas de crédito a favor</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right font-semibold tabular-nums">{formato(suma.favor)}</td>
                  <td colSpan={2} />
                </tr>
              )}
            </tfoot>
          )}
        </table>
      </div>

      {/* Teléfono: una tarjeta por documento */}
      <ul className="divide-y divide-border md:hidden" data-testid={`${testId}-movil`}>
        {visibles.map((d, i) => {
          const abierto = abiertos.has(i);
          const nAb = d.abonos?.length ?? 0;
          return (
            <li key={`${d.numero}-${i}`} className="px-4 py-3" data-testid="documento-movil" data-tipo={d.tipo}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm">{numero(d)} <span className="text-muted-foreground">· {TIPO_DOCUMENTO[d.tipo]}</span></p>
                  <p className={cn("mt-0.5 text-xs", claseDias(d))}>{textoDias(d)}{d.saldo >= 0 && ` · ${fechaLarga(d.vence ?? d.emision)}`}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={cn("text-sm font-semibold tabular-nums", d.saldo < 0 && "text-success")}>{formato(d.saldo)}</p>
                  {d.saldo_bs != null && <p className="text-[11px] tabular-nums text-muted-foreground">{fmtBs(d.saldo_bs)}</p>}
                </div>
              </div>
              <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1 text-[11px]">
                <div><dt className="text-muted-foreground">Base</dt><dd className="tabular-nums">{formato(n(d.base))}</dd></div>
                <div><dt className="text-muted-foreground">IVA</dt><dd className="tabular-nums">{formato(n(d.iva))}</dd></div>
                <div><dt className="text-muted-foreground">Total</dt><dd className="tabular-nums">{formato(d.total)}</dd></div>
                {hay(d.pagos) && <div><dt className="text-muted-foreground">Pagos</dt><dd className="tabular-nums text-success">{formato(n(d.pagos))}</dd></div>}
                {hay(d.nc) && <div><dt className="text-muted-foreground">NC</dt><dd className="tabular-nums text-success">{formato(n(d.nc))}</dd></div>}
                {hay(d.retenciones) && <div><dt className="text-muted-foreground">Retenciones</dt><dd className="tabular-nums text-success">{formato(n(d.retenciones))}</dd></div>}
                {hay(d.otros) && <div><dt className="text-muted-foreground">Otros</dt><dd className="tabular-nums text-success">{formato(n(d.otros))}</dd></div>}
              </dl>
              {(d.que_falta || d.comentarios?.length || onComentar) && (
                <div className="mt-2 space-y-1">
                  <QueFaltaPill d={d} />
                  <Comentario d={d} modo={modo} onComentar={onComentar} />
                </div>
              )}
              {nAb > 0 && (
                <>
                  <button type="button" onClick={() => alternar(i)} aria-expanded={abierto} className="mt-2 flex items-center gap-1 text-xs font-medium text-primary">
                    {abierto ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}{abierto ? "Ocultar abonos" : `Ver abonos (${nAb})`}
                  </button>
                  {abierto && (
                    <ul className="mt-1.5 space-y-1.5 rounded-md bg-muted/40 px-3 py-2 text-xs" data-testid="abonos-movil">
                      {(d.abonos ?? []).map((a, j) => (
                        <li key={j} className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p>{conceptoAbono(a)} <span className="tabular-nums text-muted-foreground">{a.documento}</span></p>
                            <p className="truncate text-[11px] text-muted-foreground">{[fechaNumerica(a.fecha), a.banco, a.referencia && `ref. ${a.referencia}`].filter(Boolean).join(" · ")}</p>
                          </div>
                          <div className="shrink-0 text-right tabular-nums">
                            {formato(a.monto)}
                            {a.moneda === "VES" && a.monto_moneda != null && <p className="text-[10px] text-muted-foreground">{fmtBs(a.monto_moneda)}</p>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </li>
          );
        })}
        {totales && (
          <li className="flex items-center justify-between bg-muted/30 px-4 py-2.5 text-sm font-semibold">
            <span>Total por cobrar</span><span className="tabular-nums">{formato(suma.saldo)}</span>
          </li>
        )}
      </ul>

      {limite && docs.length > limite && !todos && (
        <div className="border-t border-border px-4 py-3 text-center">
          <Button variant="outline" onClick={() => setTodos(true)} data-testid={`${testId}-todos`}>Ver todos los documentos ({docs.length})</Button>
        </div>
      )}
    </div>
  );
}

/** Selector abiertas / todas / pagadas en el período. */
export function FiltroDocumentosSelector({ valor, onCambio, className }: {
  valor: "abiertas" | "todas" | "pagadas"; onCambio: (v: "abiertas" | "todas" | "pagadas") => void; className?: string;
}) {
  const ops: ["abiertas" | "todas" | "pagadas", string][] = [["abiertas", "Con saldo"], ["todas", "Todas del período"], ["pagadas", "Pagadas en el período"]];
  return (
    <div className={cn("flex rounded-md border border-border bg-background p-0.5", className)} role="group" aria-label="Documentos" data-testid="filtro-documentos">
      {ops.map(([v, t]) => (
        <button key={v} type="button" onClick={() => onCambio(v)} aria-pressed={valor === v}
          className={cn("whitespace-nowrap rounded px-2 py-1 text-xs", valor === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{t}</button>
      ))}
    </div>
  );
}
