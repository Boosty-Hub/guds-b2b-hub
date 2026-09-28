import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router-dom";
import { Boxes, FileText, Landmark, LineChart, Receipt, Wallet, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/contexts/CurrencyContext";
import { METODO_LABEL } from "@/hooks/useCuentasPago";
import { exportarCSV } from "@/components/datos/tabla";
import { PillTono, fechaCorta } from "@/components/portal/sistema";
import {
  TRAMOS, condicionPagoTexto, estadoDocumento, type DocumentoCliente, type EstadoCuenta, type Movimiento, type ResumenCuenta,
} from "@/hooks/useFinanzasPortal";

// Piezas compartidas de Finanzas del portal del cliente (F5): navegación de la sección, barra de antigüedad, etiquetas de
// los movimientos, estado de un documento, exportación a CSV y la versión imprimible del estado de cuenta.

const DESTINOS: { etiqueta: string; ruta: string; icono: LucideIcon }[] = [
  { etiqueta: "Estado de cuenta", ruta: "/portal/finanzas", icono: LineChart },
  { etiqueta: "Facturas", ruta: "/portal/facturas", icono: FileText },
  { etiqueta: "Pagos", ruta: "/portal/pagos", icono: Wallet },
  { etiqueta: "Cómo pagar", ruta: "/portal/cuenta/pagos", icono: Landmark },
  { etiqueta: "Retenciones", ruta: "/portal/retenciones", icono: Receipt },
  { etiqueta: "Consignación", ruta: "/portal/consignacion", icono: Boxes },
];

/** Navegación de Finanzas en móvil y tableta (en escritorio la lleva la barra lateral). Se desplaza sola, sin mover la página. */
export const NavFinanzas = ({ className }: { className?: string }) => {
  const { pathname } = useLocation();
  return (
    <nav aria-label="Secciones de finanzas" className={cn("-mx-4 mb-4 md:-mx-6 lg:hidden", className)}>
      <ul className="flex gap-2 overflow-x-auto px-4 pb-1 md:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {DESTINOS.map((d) => {
          const activo = pathname === d.ruta || pathname.startsWith(`${d.ruta}/`);
          return (
            <li key={d.ruta} className="shrink-0">
              <Link
                to={d.ruta}
                aria-current={activo ? "page" : undefined}
                className={cn(
                  "flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium transition-colors",
                  activo ? "border-foreground bg-foreground text-background" : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                <d.icono className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                {d.etiqueta}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

/** Barra apilada de antigüedad + filas por tramo (cada una lleva a sus facturas). */
export const Antiguedad = ({ resumen, enlaces = true }: { resumen: ResumenCuenta; enlaces?: boolean }) => {
  const { formatPrice } = useCurrency();
  const total = Number(resumen.saldo) || 0;
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted" role="img"
        aria-label={`Antigüedad del saldo: ${TRAMOS.map((t) => `${t.etiqueta} ${formatPrice(Number(resumen[t.k]))}`).join(", ")}`}>
        {total > 0 && TRAMOS.map((t) => {
          const v = Number(resumen[t.k]) || 0;
          return v > 0 ? <div key={t.k} className={cn("h-full", t.barra)} style={{ width: `${(v / total) * 100}%` }} /> : null;
        })}
      </div>
      <ul className="mt-4 divide-y divide-border">
        {TRAMOS.map((t) => {
          const v = Number(resumen[t.k]) || 0;
          const pct = total > 0 ? (v / total) * 100 : 0;
          const contenido = (
            <>
              <span className="flex min-w-0 items-center gap-2.5">
                <span className={cn("h-2.5 w-2.5 shrink-0 rounded-sm", t.barra)} aria-hidden />
                <span className="truncate text-sm">{t.etiqueta}</span>
              </span>
              <span className="flex shrink-0 items-baseline gap-3">
                <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{v > 0 ? `${pct < 1 ? "<1" : pct.toFixed(0)} %` : ""}</span>
                <span className={cn("min-w-[6.5rem] text-right text-sm font-semibold tabular-nums", v <= 0 && "font-normal text-muted-foreground")}
                  data-testid={`tramo-${t.k}`}>{formatPrice(v)}</span>
              </span>
            </>
          );
          return (
            <li key={t.k}>
              {enlaces && v > 0 ? (
                <Link to={`/portal/facturas?tramo=${t.k}`} className="-mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-2.5 hover:bg-muted/50"
                  aria-label={`${t.etiqueta}: ${formatPrice(v)}. Ver facturas`}>
                  {contenido}
                </Link>
              ) : (
                <div className="flex items-center justify-between gap-3 py-2.5">{contenido}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

/** Insignia del estado de un documento (pagada / parcial / vencida / por pagar / anulada / a favor / aplicada). */
export const PillDocumento = ({ doc, hoy, className }: { doc: DocumentoCliente; hoy: string; className?: string }) => {
  const e = estadoDocumento(doc, hoy);
  return <PillTono tono={e.tono} className={className} testId="estado-documento">{e.etiqueta}</PillTono>;
};

const RETENCION: Record<string, string> = { IVA1: "Retención de IVA", RETRS: "Retención municipal", iva: "Retención de IVA", islr: "Retención de ISLR" };

/** Concepto legible de un movimiento del estado de cuenta. */
export const conceptoMovimiento = (m: Movimiento) => {
  switch (m.tipo) {
    case "factura": return m.estado === "anulado" ? "Factura (anulada)" : "Factura";
    case "nota_debito": return m.estado === "anulado" ? "Nota de débito (anulada)" : "Nota de débito";
    case "nota_credito": return "Nota de crédito";
    case "cobro": return m.detalle && METODO_LABEL[m.detalle] ? `Cobro · ${METODO_LABEL[m.detalle]}` : "Cobro";
    case "retencion": return RETENCION[m.detalle ?? ""] ?? RETENCION[m.documento.split("/")[0]] ?? "Retención";
    case "reintegro": return "Reintegro de saldo a favor";
    case "nota_credito_aplicada": return "Nota de crédito aplicada";
    case "redondeo": return "Redondeo por conversión a USD";
    default: return "Ajuste";
  }
};

/** Documento con enlace a su ficha cuando es una factura o nota del cliente. */
export const DocumentoMovimiento = ({ m, className }: { m: Movimiento; className?: string }) =>
  m.factura_id ? (
    <Link to={`/portal/facturas/${m.factura_id}`} className={cn("font-medium tabular-nums text-foreground underline-offset-2 hover:underline", className)}>
      {m.documento}
    </Link>
  ) : (
    <span className={cn("tabular-nums text-muted-foreground", className)}>{m.tipo === "redondeo" ? "—" : m.documento || "—"}</span>
  );

const fmtUsd = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const n2 = (n: number) => Number(Number(n).toFixed(2));

/** Descarga el estado de cuenta del período en CSV (montos en USD, separador punto y coma, para Excel). */
export const exportarEstadoCuentaCSV = (d: EstadoCuenta) => {
  type Fila = { fecha: string; tipo: string; documento: string; concepto: string; vence: string; cargo: number | null; abono: number | null; saldo: number };
  const filas: Fila[] = [];
  if (d.periodo.desde) {
    filas.push({ fecha: d.periodo.desde, tipo: "", documento: "", concepto: "Saldo anterior", vence: "", cargo: null, abono: null, saldo: n2(d.saldo_inicial) });
  }
  for (const m of d.movimientos) {
    filas.push({
      fecha: m.fecha ?? "", tipo: m.tipo, documento: m.tipo === "redondeo" ? "" : m.documento, concepto: conceptoMovimiento(m), vence: m.vence ?? "",
      cargo: m.monto > 0 ? n2(m.monto) : null, abono: m.monto < 0 ? n2(-m.monto) : null, saldo: n2(m.saldo),
    });
  }
  filas.push({ fecha: d.periodo.hasta ?? d.hoy, tipo: "", documento: "", concepto: "Saldo final", vence: "", cargo: null, abono: null, saldo: n2(d.saldo_final) });
  exportarCSV(`estado-de-cuenta-${(d.cliente.codigo ?? "cliente").replace(/[^\w-]+/g, "")}`, filas, [
    { titulo: "Fecha", valor: (f) => f.fecha },
    { titulo: "Documento", valor: (f) => f.documento },
    { titulo: "Concepto", valor: (f) => f.concepto },
    { titulo: "Vencimiento", valor: (f) => f.vence },
    { titulo: "Cargo (USD)", valor: (f) => f.cargo },
    { titulo: "Abono (USD)", valor: (f) => f.abono },
    { titulo: "Saldo (USD)", valor: (f) => f.saldo },
  ]);
};

/**
 * Versión imprimible del estado de cuenta (Imprimir / Guardar como PDF del navegador). Se monta fuera de la app (portal en
 * <body>) y al imprimir es lo único visible: sin barra lateral, navegación, widgets ni tema oscuro.
 */
export const EstadoCuentaImpreso = ({ datos }: { datos: EstadoCuenta }) => {
  useEffect(() => {
    const estilo = document.createElement("style");
    estilo.setAttribute("data-impresion-portal", "");
    estilo.textContent = `
      @media screen { .impresion-portal { display: none !important; } }
      @media print {
        html, body { background: #fff !important; }
        body > *:not(.impresion-portal) { display: none !important; }
        .impresion-portal { display: block !important; }
        @page { size: A4; margin: 14mm 12mm; }
      }`;
    document.head.appendChild(estilo);
    return () => { estilo.remove(); };
  }, []);

  const r = datos.resumen;
  const periodo = datos.periodo.desde
    ? `Del ${fechaCorta(datos.periodo.desde)} al ${fechaCorta(datos.periodo.hasta ?? datos.hoy)}`
    : `Todos los movimientos hasta el ${fechaCorta(datos.periodo.hasta ?? datos.hoy)}`;
  const condicion = condicionPagoTexto(datos.cliente.condicion_pago, datos.cliente.dias_credito);
  const celda = "border-b border-neutral-300 px-2 py-1.5";

  const doc: ReactNode = (
    <div className="impresion-portal bg-white font-sans text-[11px] leading-snug text-black" aria-hidden>
      <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-3">
        <div>
          <p className="text-base font-bold">{datos.empresa?.nombre ?? "GUDS"}</p>
          {datos.empresa?.rif && <p>RIF {datos.empresa.rif}</p>}
        </div>
        <div className="text-right">
          <p className="text-lg font-bold uppercase tracking-wide">Estado de cuenta</p>
          <p>Emitido el {fechaCorta(datos.hoy)}</p>
          <p>{periodo}</p>
        </div>
      </header>

      <section className="mt-3 grid grid-cols-2 gap-6">
        <div>
          <p className="text-[10px] font-semibold uppercase text-neutral-600">Cliente</p>
          <p className="text-sm font-semibold">{datos.cliente.nombre}</p>
          <p>{[datos.cliente.rif && `RIF ${datos.cliente.rif}`, datos.cliente.codigo && `Código ${datos.cliente.codigo}`].filter(Boolean).join(" · ")}</p>
          {condicion && <p>Condición de pago: {condicion}</p>}
        </div>
        <table className="w-full border-collapse self-start">
          <tbody>
            <tr><td className={celda}>Saldo por pagar</td><td className={cn(celda, "text-right font-semibold tabular-nums")}>{fmtUsd(r.saldo)}</td></tr>
            <tr><td className={celda}>Vencido</td><td className={cn(celda, "text-right tabular-nums")}>{fmtUsd(r.vencido)}</td></tr>
            <tr><td className={celda}>Por vencer</td><td className={cn(celda, "text-right tabular-nums")}>{fmtUsd(r.por_vencer)}</td></tr>
            <tr><td className={celda}>A favor (notas de crédito y anticipos)</td><td className={cn(celda, "text-right tabular-nums")}>{fmtUsd(-r.a_favor)}</td></tr>
            <tr><td className="px-2 py-1.5 font-bold">Saldo neto</td><td className="px-2 py-1.5 text-right font-bold tabular-nums">{fmtUsd(r.neto)}</td></tr>
          </tbody>
        </table>
      </section>

      <section className="mt-4">
        <p className="mb-1 text-[10px] font-semibold uppercase text-neutral-600">Antigüedad del saldo</p>
        <table className="w-full border-collapse">
          <thead><tr>{TRAMOS.map((t) => <th key={t.k} className={cn(celda, "text-right font-semibold")}>{t.etiqueta}</th>)}<th className={cn(celda, "text-right font-semibold")}>Total</th></tr></thead>
          <tbody><tr>{TRAMOS.map((t) => <td key={t.k} className={cn(celda, "text-right tabular-nums")}>{fmtUsd(Number(r[t.k]))}</td>)}<td className={cn(celda, "text-right font-semibold tabular-nums")}>{fmtUsd(r.saldo)}</td></tr></tbody>
        </table>
      </section>

      <section className="mt-4">
        <p className="mb-1 text-[10px] font-semibold uppercase text-neutral-600">Movimientos</p>
        <table className="w-full border-collapse">
          <thead className="[display:table-header-group]">
            <tr>
              <th className={cn(celda, "text-left font-semibold")}>Fecha</th>
              <th className={cn(celda, "text-left font-semibold")}>Documento</th>
              <th className={cn(celda, "text-left font-semibold")}>Concepto</th>
              <th className={cn(celda, "text-right font-semibold")}>Cargo</th>
              <th className={cn(celda, "text-right font-semibold")}>Abono</th>
              <th className={cn(celda, "text-right font-semibold")}>Saldo</th>
            </tr>
          </thead>
          <tbody>
            {datos.periodo.desde && (
              <tr><td className={celda}>{fechaCorta(datos.periodo.desde)}</td><td className={celda} /><td className={cn(celda, "italic")}>Saldo anterior</td><td className={celda} /><td className={celda} /><td className={cn(celda, "text-right tabular-nums")}>{fmtUsd(datos.saldo_inicial)}</td></tr>
            )}
            {datos.movimientos.map((m, i) => (
              <tr key={i} className="[break-inside:avoid]">
                <td className={cn(celda, "whitespace-nowrap")}>{fechaCorta(m.fecha)}</td>
                <td className={cn(celda, "tabular-nums")}>{m.tipo === "redondeo" ? "" : m.documento}</td>
                <td className={celda}>{conceptoMovimiento(m)}</td>
                <td className={cn(celda, "text-right tabular-nums")}>{m.monto > 0 ? fmtUsd(m.monto) : ""}</td>
                <td className={cn(celda, "text-right tabular-nums")}>{m.monto < 0 ? fmtUsd(-m.monto) : ""}</td>
                <td className={cn(celda, "text-right tabular-nums")}>{fmtUsd(m.saldo)}</td>
              </tr>
            ))}
            <tr><td className="px-2 py-1.5">{fechaCorta(datos.periodo.hasta ?? datos.hoy)}</td><td /><td className="px-2 py-1.5 font-bold">Saldo final</td><td /><td /><td className="px-2 py-1.5 text-right font-bold tabular-nums">{fmtUsd(datos.saldo_final)}</td></tr>
          </tbody>
        </table>
      </section>

      <footer className="mt-4 border-t border-neutral-300 pt-2 text-[10px] text-neutral-600">
        Montos en dólares (USD). Los documentos en bolívares se expresan en USD a la tasa de cada documento. Este estado de cuenta
        refleja lo registrado a la fecha de emisión; los pagos declarados quedan pendientes hasta su verificación.
      </footer>
    </div>
  );
  return createPortal(doc, document.body);
};
