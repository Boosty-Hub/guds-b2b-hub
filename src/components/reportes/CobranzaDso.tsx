import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { TablaReporte } from "@/components/reportes/TablaReporte";
import { SelectorVentana, type VentanaDso } from "@/components/cuentas/metricas";

// Reportes → Cobranza (fase 21b, plan de revisión §3.3): días de venta adeudados (DSO) y mora ponderada por vendedor y por
// cliente, con el DSO al cierre del mes anterior y lo que tienen a favor en NC sin aplicar. Mismo cálculo que Cuentas y el
// detalle de la cuenta (reporte_dso sobre metricas_cobranza_calculo). Es una foto de hoy: no depende del período del reporte.
// 22h (D6): la medida oficial son los días de recuperación (deuda neta ÷ venta promedio mensual de 12 meses con IVA × 30);
// el DSO de la ventana queda como tendencia.

interface FilaDso {
  clave: string; etiqueta: string; detalle: string | null; clientes: number; deuda: number; vencido: number; venta: number;
  dso: number | null; mora: number | null; dso_ant: number | null; a_favor_nc: number;
  rec_deuda: number; rec_promedio: number; dias_rec: number | null;
}

const num = (v: unknown) => Number(v ?? 0);

export function CobranzaDso() {
  const { formatPrice } = useCurrency();
  const [ventana, setVentana] = useState<VentanaDso>(90);
  const [datos, setDatos] = useState<{ vendedor: FilaDso[]; cliente: FilaDso[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setDatos(null);
    Promise.all(["vendedor", "cliente"].map((g) => supabase.rpc("reporte_dso", { p_dias: ventana, p_agrupar: g }))).then(([v, c]) => {
      if (!vivo) return;
      const e = v.error ?? c.error;
      if (e) { setError(e.message); return; }
      setError(null);
      setDatos({ vendedor: (v.data as FilaDso[]) ?? [], cliente: (c.data as FilaDso[]) ?? [] });
    });
    return () => { vivo = false; };
  }, [ventana]);

  const rec = (f: FilaDso) => (num(f.rec_deuda) <= 0.009 ? "Sin deuda" : f.dias_rec == null ? "Sin compras" : `${f.dias_rec} d`);
  const usd = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const formula = (f: FilaDso) => (num(f.rec_deuda) <= 0.009 ? "Sin deuda neta" : f.dias_rec == null ? `Deuda neta ${usd(num(f.rec_deuda))} y sin compras en 12 meses`
    : `Deuda neta ${usd(num(f.rec_deuda))} ÷ venta promedio mensual ${usd(num(f.rec_promedio))} (12 meses, con IVA) × 30 = ${f.dias_rec} días`);
  const dso = (f: FilaDso) => (num(f.deuda) <= 0.009 ? "—" : f.dso == null ? "Sin ventas" : `${f.dso} d`);
  const cols = (quien: "vendedor" | "cliente") => [
    { clave: "etiqueta", titulo: quien === "vendedor" ? "Vendedor" : "Cliente", valor: (f: FilaDso) => f.etiqueta },
    ...(quien === "cliente" ? [{ clave: "detalle", titulo: "RIF · ciudad", valor: (f: FilaDso) => f.detalle, secundaria: true }]
      : [{ clave: "clientes", titulo: "Clientes con deuda", valor: (f: FilaDso) => num(f.clientes), derecha: true }]),
    { clave: "rec_deuda", titulo: "Deuda neta", valor: (f: FilaDso) => num(f.rec_deuda), render: (f: FilaDso) => formatPrice(num(f.rec_deuda)), derecha: true },
    { clave: "dias_rec", titulo: "Días rec.", valor: (f: FilaDso) => (f.dias_rec == null ? (num(f.rec_deuda) > 0.009 ? 99999 : null) : num(f.dias_rec)),
      render: (f: FilaDso) => <span title={formula(f)}>{rec(f)}</span>, derecha: true },
    { clave: "rec_promedio", titulo: "Venta promedio mensual (12 m, con IVA)", valor: (f: FilaDso) => num(f.rec_promedio), soloExportar: true },
    { clave: "formula", titulo: "Cómo se calcula", valor: (f: FilaDso) => formula(f), soloExportar: true },
    { clave: "deuda", titulo: "Deuda bruta", valor: (f: FilaDso) => num(f.deuda), render: (f: FilaDso) => formatPrice(num(f.deuda)), derecha: true, ocultarMovil: true },
    { clave: "vencido", titulo: "Vencido", valor: (f: FilaDso) => num(f.vencido), render: (f: FilaDso) => formatPrice(num(f.vencido)), derecha: true, ocultarMovil: true },
    { clave: "dso", titulo: `Tend. ${ventana} d`, valor: (f: FilaDso) => (f.dso == null ? (num(f.deuda) > 0.009 ? 99999 : null) : num(f.dso)), render: dso, derecha: true },
    { clave: "dso_ant", titulo: "Tend. mes ant.", valor: (f: FilaDso) => f.dso_ant, render: (f: FilaDso) => (f.dso_ant == null ? "—" : `${f.dso_ant} d`), derecha: true, secundaria: true },
    { clave: "mora", titulo: "Mora pond.", valor: (f: FilaDso) => f.mora, render: (f: FilaDso) => (f.mora == null ? "—" : `${f.mora} d`), derecha: true, ocultarMovil: true },
    { clave: "favor", titulo: "A favor (NC)", valor: (f: FilaDso) => num(f.a_favor_nc), render: (f: FilaDso) => (num(f.a_favor_nc) > 0.009 ? formatPrice(num(f.a_favor_nc)) : "—"), derecha: true, secundaria: true },
  ];

  return (
    <div className="mt-3 space-y-2" data-testid="reporte-dso">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-0.5 text-xs text-muted-foreground" data-testid="reporte-dso-formula">
          <p><span className="font-semibold text-foreground">Días de recuperación</span> = deuda neta de hoy (facturas y ND − NC a favor − anticipos, con las notas de entrega si las ves) ÷ venta promedio mensual de los últimos 12 meses (con IVA; cliente nuevo: los meses desde su primera compra) × 30. Pasa el ratón por los días para ver las cifras.</p>
          <p><span className="font-semibold text-foreground">Tendencia {ventana} d (DSO)</span> = deuda bruta ÷ venta promedio diaria de los últimos {ventana} días. Interno: no sale al cliente.</p>
        </div>
        <SelectorVentana valor={ventana} onCambio={setVentana} />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : !datos ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          <TablaReporte titulo="Recuperación por vendedor" filas={datos.vendedor} exportar="cobranza-recuperacion-por-vendedor" metrica={(f) => num(f.rec_deuda)} columnas={cols("vendedor")} />
          <TablaReporte titulo="Recuperación por cliente" filas={datos.cliente} exportar="cobranza-recuperacion-por-cliente" metrica={(f) => num(f.rec_deuda)} columnas={cols("cliente")} />
        </div>
      )}
    </div>
  );
}
