import { useEffect, useMemo, useState, type ReactNode } from "react";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { TablaReporte } from "@/components/reportes/TablaReporte";
import { InsigniaProfit, fechaCorta } from "@/components/reportes/comun";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { ESTADO_CUADRE, montoTarea, type Tarea } from "./tipos";

interface Cuadre {
  lote: number | null; ventana_desde: string;
  totales: Record<string, number>;
  resumen: { empresa: string; clase: string; estado: string; documentos: number; odoo_usd: number; profit_usd: number; diferencia_usd: number }[];
}
const num = (v: unknown) => Number(v ?? 0);
const fmtN = (v: unknown) => num(v).toLocaleString("es-VE", { maximumFractionDigits: 0 });
const CLASE: Record<string, string> = { factura: "Factura", nc: "Nota de crédito", nd: "Nota de débito" };
const VARIANTE: Record<string, "default" | "secondary" | "outline" | "destructive"> = { cuadra: "default", pronto_pago: "secondary", difiere: "destructive", nc_ambigua: "outline", solo_odoo: "outline" };
const ORDEN = ["difiere", "pronto_pago", "solo_odoo", "nc_ambigua", "sin_saldo_inicial", "diferencial"];

/** Cabecera del cuadre Profit ↔ Odoo: el cruce documento a documento (20q) y cuánto queda por explicar en la bandeja. */
export function CuadreResumen({ tareas }: { tareas: Tarea[] }) {
  const { formatPrice } = useCurrency();
  const { seleccion } = useEmpresa();
  const [datos, setDatos] = useState<Cuadre | null>(null);
  useEffect(() => {
    let cancelado = false;
    (async () => {
      let r = await supabase.rpc("reporte_cuadre_profit_odoo");
      if (r.error?.code === "57014") r = await supabase.rpc("reporte_cuadre_profit_odoo");
      if (!cancelado && !r.error) setDatos(r.data as Cuadre);
    })();
    return () => { cancelado = true; };
  }, [seleccion]);

  // Lo que falta, por estado del cuadre (de la bandeja: misma fuente que la lista de abajo)
  const falta = useMemo(() => {
    const m = new Map<string, { estado: string; pendientes: number; pendientes_usd: number; explicadas: number; corregidas: number; total: number }>();
    for (const t of tareas) {
      const k = String(t.detalle.estado_cuadre ?? "otro");
      const g = m.get(k) ?? { estado: k, pendientes: 0, pendientes_usd: 0, explicadas: 0, corregidas: 0, total: 0 };
      g.total++;
      if (t.estado === "pendiente") { g.pendientes++; g.pendientes_usd += montoTarea(t); }
      else if (t.estado === "explicado") g.explicadas++; else g.corregidas++;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => ORDEN.indexOf(a.estado) - ORDEN.indexOf(b.estado));
  }, [tareas]);
  const pend = falta.reduce((s, g) => s + g.pendientes, 0);
  const total = falta.reduce((s, g) => s + g.total, 0);
  const revisadas = total - pend;

  if (!datos) return null;
  if (!datos.lote) return <p className="mb-3 rounded-lg border border-border bg-card px-3 py-4 text-center text-sm text-muted-foreground">Aún no hay histórico de Profit cargado.</p>;
  const t = datos.totales;
  const insignia = (c: ReactNode) => <span className="inline-flex items-center gap-1">{c}<InsigniaProfit /></span>;

  return (
    <>
      <KpiStrip items={[
        { label: "Saldos iniciales en Odoo", valor: fmtN(t.documentos), detalle: "facturas, NC y ND al corte", tono: "primario",
          titulo: "Documentos que Odoo recibió como cartera abierta de Profit al arrancar" },
        { label: "Cuadran", valor: fmtN(t.cuadran), tono: "positivo", detalle: insignia(`dif. ${formatPrice(num(t.cuadran_odoo_usd) - num(t.cuadran_profit_usd))}`),
          titulo: "Mismo número y mismo total con IVA (diferencia menor a 1 USD)" },
        { label: "Por explicar", valor: fmtN(pend), tono: pend ? "alerta" : "positivo", detalle: `de ${fmtN(total)} en la bandeja`,
          titulo: "Tareas del cuadre pendientes de revisar uno a uno" },
        { label: "Revisadas", valor: total ? `${Math.round((revisadas / total) * 100)} %` : "—", tono: "tenue", detalle: `${fmtN(revisadas)} explicadas o corregidas` },
        { label: "Pendientes sin saldo inicial", valor: fmtN(t.sin_saldo_inicial), detalle: formatPrice(num(t.sin_saldo_inicial_usd)), tono: t.sin_saldo_inicial ? "alerta" : "normal",
          titulo: "Facturas que Profit tiene «Pendiente» y no llegaron como saldo inicial a Odoo" },
      ]} />
      <p className="-mt-1 mb-3 text-xs text-muted-foreground">
        <InsigniaProfit className="mr-1 align-[-2px]" />
        Cada saldo inicial de Odoo se busca en el histórico de Profit por empresa, tipo y número. Cuadran {fmtN(t.cuadran)} documentos: Odoo {formatPrice(num(t.cuadran_odoo_usd))} contra
        Profit {formatPrice(num(t.cuadran_profit_usd))}. En la ventana del análisis previo (desde {fechaCorta(datos.ventana_desde)}) cuadran {fmtN(t.ventana_cuadran)}.
        Lo que no cuadra, los pendientes sin saldo inicial y los diferenciales cambiarios se revisan uno a uno abajo.
      </p>
      <div className="mb-3 grid gap-3 xl:grid-cols-2">
        <TablaReporte titulo={<>Lo que falta por explicar <span className="font-normal text-muted-foreground">· {fmtN(pend)}</span></>} filas={falta} exportar="cuadre-falta-por-explicar" limite={10}
          vacio="Nada en la bandeja del cuadre" columnas={[
            { clave: "estado", titulo: "Estado del cuadre", valor: (f) => ESTADO_CUADRE[f.estado]?.texto ?? f.estado, render: (f) => <span title={ESTADO_CUADRE[f.estado]?.ayuda}>{ESTADO_CUADRE[f.estado]?.texto ?? f.estado}</span> },
            { clave: "pendientes", titulo: "Pendientes", valor: (f) => f.pendientes, derecha: true },
            { clave: "usd", titulo: "Monto pendiente", valor: (f) => Math.round(f.pendientes_usd * 100) / 100, render: (f) => formatPrice(f.pendientes_usd), derecha: true },
            { clave: "explicadas", titulo: "Explicadas", valor: (f) => f.explicadas, derecha: true, ocultarMovil: true },
            { clave: "corregidas", titulo: "Corregidas", valor: (f) => f.corregidas, derecha: true, ocultarMovil: true },
            { clave: "total", titulo: "Total", valor: (f) => f.total, soloExportar: true },
          ]} />
        <TablaReporte titulo="Cruce por empresa y tipo" filas={datos.resumen} exportar="cuadre-profit-odoo-resumen" limite={8} columnas={[
          { clave: "empresa", titulo: "Empresa · tipo", valor: (f) => `${f.empresa} ${f.clase}`, render: (f) => <span>{f.empresa} <span className="text-muted-foreground">· {CLASE[f.clase] ?? f.clase}</span></span> },
          { clave: "estado", titulo: "Estado", valor: (f) => (f.estado === "cuadra" ? "Cuadra" : ESTADO_CUADRE[f.estado]?.texto ?? f.estado),
            render: (f) => <Badge variant={VARIANTE[f.estado] ?? "outline"} title={ESTADO_CUADRE[f.estado]?.ayuda}>{f.estado === "cuadra" ? "Cuadra" : ESTADO_CUADRE[f.estado]?.texto ?? f.estado}</Badge> },
          { clave: "documentos", titulo: "Docs.", valor: (f) => num(f.documentos), derecha: true },
          { clave: "diferencia", titulo: "Diferencia", valor: (f) => num(f.diferencia_usd), render: (f) => formatPrice(num(f.diferencia_usd)), derecha: true, ocultarMovil: true },
          { clave: "odoo", titulo: "Odoo (USD)", valor: (f) => num(f.odoo_usd), soloExportar: true },
          { clave: "profit", titulo: "Profit (USD)", valor: (f) => num(f.profit_usd), soloExportar: true },
        ]} />
      </div>
    </>
  );
}
