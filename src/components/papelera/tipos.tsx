import type { ComponentType } from "react";
import { FileQuestion, HandCoins, Archive, type LucideIcon } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FichaCampos, Panel } from "@/components/datos/FichaCampos";
import { useCurrency } from "@/contexts/CurrencyContext";

/*
 * Tipos de la Papelera general (fase 22a). Para agregar uno nuevo:
 *   1. En la base, la función que anula o archiva arma la foto y llama a public.papelera_guardar('<tipo>', …).
 *   2. Si se puede restaurar, se crea public.papelera_restaurar_<tipo>(p papelera) (restaurar_papelera la llama sola).
 *   3. Aquí: una entrada en TIPOS_PAPELERA con su etiqueta, ícono, enlace y, si hace falta, un Detalle propio.
 * Un tipo sin entrada se muestra igual (con su código y los datos completos guardados).
 */

export interface ItemPapelera {
  id: string;
  tipo: string;
  accion: "anulado" | "archivado";
  registro_id: string | null;
  numero: string | null;
  empresa_id: string | null;
  cliente_id: string | null;
  monto_usd: number | null;
  titulo: string;
  resumen: string | null;
  datos: Record<string, unknown> | null;
  motivo: string | null;
  restaurable: boolean;
  eliminado_por: string | null;
  eliminado_por_nombre: string | null;
  eliminado_at: string;
  restaurado_por: string | null;
  restaurado_por_nombre: string | null;
  restaurado_at: string | null;
  cliente?: { nombre_negocio: string } | null;
}

export interface TipoPapelera {
  etiqueta: string;
  plural: string;
  icono: LucideIcon;
  /** Qué pasa al restaurar (texto del diálogo de confirmación) */
  restaurarTexto?: (item: ItemPapelera) => string;
  /** Enlace útil desde el detalle */
  enlace?: (item: ItemPapelera) => { ruta: string; texto: string } | null;
  /** Detalle propio del tipo, debajo de la ficha general */
  Detalle?: ComponentType<{ item: ItemPapelera }>;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const lista = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);
const txt = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));
const num = (v: unknown) => Number(v ?? 0);
export const fechaHora = (s: unknown) => (s ? new Date(String(s)).toLocaleString("es-VE", { dateStyle: "short", timeStyle: "short" }) : null);
/** dd/mm/aa (la hora va en el title) */
export const fechaCorta = (s: unknown) => (s ? new Date(String(s)).toLocaleDateString("es-VE", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—");
const fecha = (s: unknown) => (s ? new Date(`${String(s).slice(0, 10)}T00:00:00`).toLocaleDateString("es-VE", { day: "2-digit", month: "short", year: "numeric" }) : null);
const bs = (n: number) => n.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const METODO: Record<string, string> = { transferencia: "Transferencia", efectivo: "Efectivo", pago_movil: "Pago móvil", tarjeta: "Tarjeta", credito: "Crédito" };

function DetalleCobro({ item }: { item: ItemPapelera }) {
  const { formatPrice } = useCurrency();
  const d = obj(item.datos);
  const p = obj(d.pago);
  const aplicaciones = lista(d.aplicaciones);
  const movimientos = lista(d.movimientos);
  const igtf = lista(d.pagos).filter((x) => x.es_igtf);
  const moneda = txt(p.moneda) ?? "USD";
  return (
    <>
      <Panel titulo="Cobro anulado">
        <FichaCampos columnas={3} campos={[
          { label: "Número", valor: txt(p.numero), mono: true },
          { label: "Banco", valor: txt(obj(d.banco).nombre) },
          { label: "Método", valor: METODO[String(p.metodo)] ?? txt(p.metodo) },
          { label: "Monto", valor: moneda === "USD" ? formatPrice(num(p.monto)) : `${bs(num(p.monto_moneda))} ${moneda === "BS" ? "Bs." : moneda} · ${formatPrice(num(p.monto))}` },
          { label: "Tasa", valor: p.tasa_cambio ? bs(num(p.tasa_cambio)) : null },
          { label: "Referencia", valor: txt(p.referencia), mono: true },
          { label: "Registrado", valor: fechaHora(p.created_at) },
          { label: "Verificado", valor: fechaHora(p.fecha_verificacion) },
          { label: "Fecha del pago", valor: fecha(p.fecha_pago) },
          { label: "Notas", valor: txt(p.notas), ancho: 3 },
          ...(igtf.length ? [{ label: "IGTF anulado con él", valor: igtf.map((x) => `${x.numero} (${formatPrice(num(x.monto))})`).join(", "), ancho: 3 as const }] : []),
        ]} />
      </Panel>
      <Panel titulo={`Aplicaciones que se quitaron (${aplicaciones.length})`} sinPadding>
        {aplicaciones.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">No estaba aplicado a ninguna factura (era un anticipo).</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Factura</TableHead><TableHead className="hidden sm:table-cell">Emisión</TableHead>
                <TableHead className="text-right">Aplicado</TableHead>
                <TableHead className="text-right" title="Saldo de la factura en GUDS antes y después de anular">Saldo antes → después</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {aplicaciones.map((a) => (
                <TableRow key={String(a.id ?? a.factura_id)}>
                  <TableCell className="whitespace-nowrap font-mono text-xs">{txt(a.factura_numero) ?? "—"}</TableCell>
                  <TableCell className="hidden whitespace-nowrap text-muted-foreground sm:table-cell">{fecha(a.factura_fecha) ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-medium">{formatPrice(num(a.monto_aplicado))}</TableCell>
                  <TableCell className="whitespace-nowrap text-right text-muted-foreground">
                    {formatPrice(num(a.saldo_factura_antes))} → <span className="text-foreground">{formatPrice(num(a.saldo_factura_despues))}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
      {movimientos.length > 0 && (
        <Panel titulo="Movimiento bancario que se quitó">
          <ul className="space-y-1 text-sm">
            {movimientos.map((m) => (
              <li key={String(m.id)} className="flex flex-wrap justify-between gap-2">
                <span>{m.tipo === "entrada" ? "Entrada" : "Salida"} · {fechaHora(m.fecha)}{m.referencia ? ` · ref. ${m.referencia}` : ""}</span>
                <span className="font-medium tabular-nums">{bs(num(m.monto))} {moneda === "BS" ? "Bs." : moneda}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}

function DetalleCuentaManual({ item }: { item: ItemPapelera }) {
  const { formatPrice } = useCurrency();
  const d = obj(item.datos);
  const c = obj(d.cuenta);
  const ESTADO: Record<string, string> = { pendiente: "Pendiente", parcial: "Pagada en parte", pagado: "Pagada" };
  return (
    <Panel titulo="Cuenta manual archivada">
      <FichaCampos columnas={3} campos={[
        { label: "Número", valor: txt(c.numero), mono: true },
        { label: "Fecha", valor: fecha(c.fecha) },
        { label: "Estado", valor: ESTADO[String(c.estado_pago)] ?? txt(c.estado_pago) },
        { label: "Monto", valor: formatPrice(num(c.monto)) },
        { label: "Pagado", valor: formatPrice(num(c.monto_pagado)) },
        { label: "Origen", valor: c.origen === "odoo" ? "Copiada de Odoo" : txt(c.origen) },
        { label: "Concepto", valor: txt(c.concepto), ancho: 3 },
      ]} />
      {txt(d.nota) && <p className="mt-2 text-xs text-muted-foreground">{txt(d.nota)}</p>}
    </Panel>
  );
}

export const TIPOS_PAPELERA: Record<string, TipoPapelera> = {
  cobro: {
    etiqueta: "Cobro",
    plural: "Cobros",
    icono: HandCoins,
    restaurarTexto: (i) => {
      const n = lista(obj(i.datos).aplicaciones).length;
      return `El cobro vuelve a «verificado», regresa su entrada al banco${n ? ` y se vuelve a aplicar a ${n === 1 ? "su factura" : `sus ${n} facturas`} (solo si todavía tienen saldo; si no, no se restaura)` : ""}.`;
    },
    enlace: (i) => (i.cliente_id ? { ruta: `/admin/cuentas/${i.cliente_id}`, texto: "Ver cuenta del cliente" } : null),
    Detalle: DetalleCobro,
  },
  cuenta_manual: {
    etiqueta: "Cuenta manual",
    plural: "Cuentas manuales",
    icono: Archive,
    enlace: (i) => (i.cliente_id ? { ruta: `/admin/clientes/${i.cliente_id}`, texto: "Ver cliente" } : null),
    Detalle: DetalleCuentaManual,
  },
};

export const tipoDe = (tipo: string): TipoPapelera =>
  TIPOS_PAPELERA[tipo] ?? { etiqueta: tipo.replace(/_/g, " "), plural: tipo.replace(/_/g, " "), icono: FileQuestion };

/** Por qué no se puede restaurar (texto para el detalle) */
export const motivoNoRestaurable = (i: ItemPapelera) =>
  i.tipo === "cuenta_manual"
    ? "No se restaura: la pestaña «Cuentas manuales» se quitó y la deuda sale de las facturas de Odoo. La cuenta sigue archivada en la base."
    : "Este registro no se puede restaurar.";
