import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TablaReporte } from "@/components/reportes/TablaReporte";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { useToast } from "@/hooks/use-toast";

// ── Respuesta de estado_historico_profit() (migración 20g) ──
interface AnioProfit { empresa: string; anio: number; lineas: number; facturas: number; excel_usd: number; venta_usd: number; financieras_usd: number; reversos_usd: number; nd_cambiarias_usd: number; unidades: number }
interface VendedorProfit { id: string; empresa: string; empresa_id: string; codigo: string; nombre: string; vendedor_odoo: string | null; propuesta_odoo: string | null; estado: "propuesto" | "sin_pareja" | "validado"; revisado_at: string | null; revisado_por: string | null; lineas: number; neto_usd: number; desde: string | null; hasta: string | null }
interface ClienteSinPareja { empresa: string; codigo: string; nombre: string | null; rif: string | null; lineas: number; neto_usd: number; ultima: string | null }
interface ProductoSinPareja { empresa: string; codigo: string; descripcion: string | null; categoria: string | null; lineas: number; unidades: number; neto_usd: number; ultima: string | null }
interface EstadoProfit {
  carga: { id: number; estado: string; publicada_at: string | null; archivo: string | null; cache_actualizada: string | null; lineas: number | null } | null;
  en_curso: boolean;
  lineas: number;
  desde: string | null;
  hasta: string | null;
  anios: AnioProfit[];
  clientes: { total: number; con_pareja: number; por_rif: number; por_nombre: number; por_documento: number; pct_monto: number | null };
  productos: { total: number; con_pareja: number; pct_monto: number | null };
  clientes_sin_pareja: ClienteSinPareja[];
  productos_sin_pareja: ProductoSinPareja[];
  vendedores: VendedorProfit[];
  candidatos: string[];
  puede_editar: boolean;
}

const SIN_PAREJA = "__profit__";
const num = (v: unknown) => Number(v ?? 0);
const fechaCorta = (d: string | null | undefined) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const mesAnio = (d: string | null | undefined) => (d ? `${MESES[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}` : "—");
const ESTADOS: Record<VendedorProfit["estado"], { texto: string; variante: "default" | "secondary" | "outline" }> = {
  validado: { texto: "Validado", variante: "default" },
  propuesto: { texto: "Propuesto", variante: "secondary" },
  sin_pareja: { texto: "Sin pareja", variante: "outline" },
};

/** Pestaña de Reportes con el estado del histórico de Profit y las equivalencias de vendedores (solo administración las edita). */
export function HistoricoProfit() {
  const { formatPrice } = useCurrency();
  const { soloLectura, seleccion } = useEmpresa();
  const { toast } = useToast();
  const [estado, setEstado] = useState<EstadoProfit | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    const { data, error } = await supabase.rpc("estado_historico_profit");
    if (error) toast({ title: "No se pudo cargar el histórico de Profit", description: error.message, variant: "destructive" });
    else setEstado(data as EstadoProfit);
    setCargando(false);
  }, [toast]);
  useEffect(() => { cargar(); }, [cargar, seleccion]);

  const guardar = async (clave: string, cambios: { id: string; vendedor_odoo: string | null }[]) => {
    setGuardando(clave);
    const { error } = await supabase.rpc("guardar_profit_vendedores", { p_cambios: cambios });
    setGuardando(null);
    if (error) { toast({ title: "No se guardó la equivalencia", description: error.message, variant: "destructive" }); return; }
    toast({ title: cambios.length === 1 ? "Equivalencia guardada" : `${cambios.length} equivalencias validadas` });
    cargar();
  };

  const fmtN = (v: unknown) => num(v).toLocaleString("es-VE", { maximumFractionDigits: 0 });
  const editable = (v: VendedorProfit) => !!estado?.puede_editar && !soloLectura && v.empresa_id === seleccion;
  const propuestas = useMemo(() => (estado?.vendedores ?? []).filter((v) => v.estado === "propuesto" && editable(v)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [estado, soloLectura, seleccion]);

  if (cargando && !estado) {
    return <div className="flex items-center gap-2 px-1 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando el histórico de Profit…</div>;
  }
  if (!estado) return null;
  if (!estado.carga) {
    return (
      <p className="rounded-lg border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground">
        Aún no se ha cargado el histórico de Profit. Se carga con <code className="font-mono text-xs">node scripts/importar-historico-profit.mjs</code>.
      </p>
    );
  }
  const vend = estado.vendedores;
  const nVal = vend.filter((v) => v.estado === "validado").length, nProp = vend.filter((v) => v.estado === "propuesto").length;

  return (
    <div>
      <KpiStrip items={[
        { label: "Líneas de Profit", valor: fmtN(estado.lineas), detalle: `${fmtN(estado.anios.reduce((s, a) => s + num(a.facturas), 0))} facturas`, tono: "primario" },
        { label: "Período", valor: `${mesAnio(estado.desde)} – ${mesAnio(estado.hasta)}`, detalle: `${fechaCorta(estado.desde)} al ${fechaCorta(estado.hasta)}`,
          titulo: "Hasta el arranque de Odoo" },
        { label: "Clientes con pareja", valor: `${fmtN(estado.clientes.con_pareja)} de ${fmtN(estado.clientes.total)}`, detalle: `${num(estado.clientes.pct_monto).toFixed(1)}% de la venta`,
          titulo: `Por RIF ${estado.clientes.por_rif} · por nombre ${estado.clientes.por_nombre} · por factura compartida con Odoo ${estado.clientes.por_documento}` },
        { label: "Productos con pareja", valor: `${fmtN(estado.productos.con_pareja)} de ${fmtN(estado.productos.total)}`, detalle: `${num(estado.productos.pct_monto).toFixed(1)}% de la venta`, titulo: "Por código de artículo = SKU" },
        { label: "Vendedores", valor: `${nVal} validados`, detalle: `${nProp} propuestos · ${vend.length - nVal - nProp} sin pareja`, tono: nProp ? "alerta" : "normal" },
        { label: "Última carga", valor: fechaCorta(estado.carga.publicada_at), detalle: estado.en_curso ? "hay una carga en curso" : (estado.carga.cache_actualizada ?? undefined), titulo: estado.carga.archivo ?? undefined },
      ]} />
      <p className="-mt-1 mb-3 text-xs text-muted-foreground">
        Solo lectura. Venta neta de Profit = facturas − devoluciones; las notas de crédito y débito de Profit (descuentos, acuerdos, ajustes,
        anulaciones, saldos migrados) van aparte; las facturas anuladas con una devolución por el mismo total y las notas de débito cambiarias no cuentan.
        "Base Excel" es la suma de la hoja de Profit tal cual.
      </p>

        <TablaReporte titulo={<>Equivalencias de vendedores <span className="font-normal text-muted-foreground">· Profit → Odoo</span></>}
          filas={vend} exportar="profit-vendedores" limite={15}
          acciones={propuestas.length > 0 && (
            <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={!!guardando}
              onClick={() => guardar("todas", propuestas.map((v) => ({ id: v.id, vendedor_odoo: v.vendedor_odoo })))}>
              {guardando === "todas" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Confirmar {propuestas.length}
            </Button>
          )}
          columnas={[
            { clave: "nombre", titulo: "Vendedor en Profit", valor: (f) => f.nombre,
              render: (f) => <span title={`${f.codigo} · ${f.empresa}`}>{f.nombre || "—"} <span className="text-xs font-normal text-muted-foreground">{f.codigo} · {f.empresa}</span></span> },
            { clave: "neto", titulo: "Venta", valor: (f) => num(f.neto_usd), render: (f) => formatPrice(num(f.neto_usd)), derecha: true, ocultarMovil: true },
            { clave: "odoo", titulo: "Vendedor en Odoo", valor: (f) => f.vendedor_odoo ?? "",
              render: (f) => editable(f) ? (
                <Select value={f.vendedor_odoo ?? SIN_PAREJA} disabled={!!guardando}
                  onValueChange={(v) => guardar(f.id, [{ id: f.id, vendedor_odoo: v === SIN_PAREJA ? null : v }])}>
                  <SelectTrigger className="h-7 w-44 text-xs" aria-label={`Vendedor en Odoo para ${f.nombre}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SIN_PAREJA} className="text-xs">Sin pareja (Profit)</SelectItem>
                    {estado.candidatos.map((c) => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : <span className={f.vendedor_odoo ? "" : "text-muted-foreground"}>{f.vendedor_odoo ?? "Nombre de Profit"}</span> },
            { clave: "estado", titulo: "Estado", valor: (f) => ESTADOS[f.estado].texto,
              render: (f) => (
                <span className="inline-flex items-center gap-1.5">
                  <Badge variant={ESTADOS[f.estado].variante} title={f.revisado_at ? `${f.revisado_por ?? ""} · ${fechaCorta(f.revisado_at)}` : undefined}>{ESTADOS[f.estado].texto}</Badge>
                  {f.estado === "propuesto" && editable(f) && (
                    <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" disabled={!!guardando} onClick={() => guardar(f.id, [{ id: f.id, vendedor_odoo: f.vendedor_odoo }])}>
                      {guardando === f.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Confirmar"}
                    </Button>
                  )}
                </span>
              ) },
            { clave: "codigo", titulo: "Código Profit", valor: (f) => f.codigo, soloExportar: true },
            { clave: "empresa", titulo: "Empresa", valor: (f) => f.empresa, soloExportar: true },
            { clave: "propuesta", titulo: "Propuesta de GUDS", valor: (f) => f.propuesta_odoo, soloExportar: true },
            { clave: "desde", titulo: "Primera venta", valor: (f) => f.desde, soloExportar: true },
            { clave: "hasta", titulo: "Última venta", valor: (f) => f.hasta, soloExportar: true },
          ]} />
      {estado.puede_editar && soloLectura && (
        <p className="-mt-1 mb-3 text-xs text-muted-foreground">Para editar las equivalencias elige GUDS o Quirutec en el menú superior.</p>
      )}

      <div className="grid gap-3 xl:grid-cols-2">
        <TablaReporte titulo="Por año y empresa" filas={estado.anios} exportar="profit-por-anio" limite={20} columnas={[
          { clave: "anio", titulo: "Año", valor: (f) => f.anio, render: (f) => <span className="tabular-nums">{f.anio} <span className="text-muted-foreground">· {f.empresa}</span></span> },
          { clave: "lineas", titulo: "Líneas", valor: (f) => num(f.lineas), render: (f) => fmtN(f.lineas), derecha: true, ocultarMovil: true },
          { clave: "excel", titulo: "Base Excel", valor: (f) => num(f.excel_usd), render: (f) => formatPrice(num(f.excel_usd)), derecha: true, ocultarMovil: true },
          { clave: "financieras", titulo: "Financieras", valor: (f) => num(f.financieras_usd), render: (f) => formatPrice(num(f.financieras_usd)), derecha: true, secundaria: true },
          { clave: "reversos", titulo: "Reversos", valor: (f) => num(f.reversos_usd), render: (f) => formatPrice(num(f.reversos_usd)), derecha: true, secundaria: true },
          { clave: "venta", titulo: "Venta neta", valor: (f) => num(f.venta_usd), render: (f) => formatPrice(num(f.venta_usd)), derecha: true },
          { clave: "empresa", titulo: "Empresa", valor: (f) => f.empresa, soloExportar: true },
          { clave: "facturas", titulo: "Facturas", valor: (f) => num(f.facturas), soloExportar: true },
          { clave: "nd", titulo: "ND cambiarias", valor: (f) => num(f.nd_cambiarias_usd), soloExportar: true },
          { clave: "unidades", titulo: "Unidades", valor: (f) => num(f.unidades), soloExportar: true },
        ]} />

        <TablaReporte titulo={<>Clientes sin pareja en GUDS <span className="font-normal text-muted-foreground">· quedan con nombre y RIF de Profit</span></>}
          filas={estado.clientes_sin_pareja} exportar="profit-clientes-sin-pareja" metrica={(f) => num(f.neto_usd)} columnas={[
            { clave: "nombre", titulo: "Cliente", valor: (f) => f.nombre ?? f.codigo },
            { clave: "rif", titulo: "Código / RIF", valor: (f) => f.rif ?? f.codigo, render: (f) => <span className="font-mono text-xs">{f.rif ?? f.codigo}</span>, ocultarMovil: true },
            { clave: "ultima", titulo: "Última compra", valor: (f) => f.ultima, render: (f) => fechaCorta(f.ultima), secundaria: true },
            { clave: "neto", titulo: "Venta", valor: (f) => num(f.neto_usd), render: (f) => formatPrice(num(f.neto_usd)), derecha: true },
            { clave: "empresa", titulo: "Empresa", valor: (f) => f.empresa, soloExportar: true },
          ]} />
        <TablaReporte titulo={<>Productos sin pareja <span className="font-normal text-muted-foreground">· código de Profit sin SKU en GUDS</span></>}
          filas={estado.productos_sin_pareja} exportar="profit-productos-sin-pareja" metrica={(f) => num(f.neto_usd)} columnas={[
            { clave: "descripcion", titulo: "Artículo", valor: (f) => f.descripcion ?? f.codigo },
            { clave: "codigo", titulo: "Código", valor: (f) => f.codigo, render: (f) => <span className="font-mono text-xs">{f.codigo}</span>, ocultarMovil: true },
            { clave: "ultima", titulo: "Última venta", valor: (f) => f.ultima, render: (f) => fechaCorta(f.ultima), secundaria: true },
            { clave: "neto", titulo: "Venta", valor: (f) => num(f.neto_usd), render: (f) => formatPrice(num(f.neto_usd)), derecha: true },
            { clave: "empresa", titulo: "Empresa", valor: (f) => f.empresa, soloExportar: true },
            { clave: "categoria", titulo: "Categoría Profit", valor: (f) => f.categoria, soloExportar: true },
            { clave: "unidades", titulo: "Unidades", valor: (f) => num(f.unidades), soloExportar: true },
          ]} />
      </div>
    </div>
  );
}
