import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { TablaReporte, type ColumnaReporte } from "@/components/reportes/TablaReporte";
import { InsigniaProfit, fechaCorta } from "@/components/reportes/comun";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { useToast } from "@/hooks/use-toast";

// ── reporte_calidad_datos() y reporte_cuadre_profit_odoo() (migración 20q): solo lectura, se corrige en Odoo ──
type ClaveLista = "clientes_estado_extranjero" | "clientes_sin_condicion" | "clientes_sin_rif" | "productos_sin_costo" | "productos_sin_categoria"
  | "productos_categoria_inactiva" | "facturas_anuladas_con_saldo" | "cobros_sin_aplicar";
type Fila = Record<string, string | number | boolean | null>;
interface Calidad { generado: string; conteos: Record<ClaveLista, number>; listas: Record<ClaveLista, Fila[]>; montos: Record<string, number> }
interface Cuadre {
  lote: number | null; ventana_desde: string;
  totales: Record<string, number>;
  resumen: { empresa: string; clase: string; estado: string; documentos: number; odoo_usd: number; profit_usd: number; diferencia_usd: number }[];
  documentos: Fila[];
  pendientes_sin_saldo: Fila[];
}

const num = (v: unknown) => Number(v ?? 0);
const fmtN = (v: unknown) => num(v).toLocaleString("es-VE", { maximumFractionDigits: 0 });
const texto = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
const fecha = (v: unknown) => (typeof v === "string" && v ? fechaCorta(v.slice(0, 10)) : "—");
const CLASE: Record<string, string> = { factura: "Factura", nc: "Nota de crédito", nd: "Nota de débito" };
const PREFIJO: Record<string, string> = { factura: "Fact.", nc: "NC", nd: "ND" };
const ESTADO_CUADRE: Record<string, { texto: string; variante: "default" | "secondary" | "outline" | "destructive"; ayuda: string }> = {
  cuadra: { texto: "Cuadra", variante: "default", ayuda: "Mismo número y mismo total con IVA (diferencia menor a 1 USD)" },
  pronto_pago: { texto: "Pronto pago 3 %", variante: "secondary", ayuda: "Odoo = Profit + 3 % de la base: el descuento global por pronto pago de Profit no pasó al saldo inicial de Odoo" },
  difiere: { texto: "Difiere", variante: "destructive", ayuda: "Mismo número con otro total" },
  nc_ambigua: { texto: "NC ambigua", variante: "outline", ayuda: "Profit numera devoluciones y notas de crédito por separado; Odoo las unió: el número corresponde a otro documento de Profit" },
  solo_odoo: { texto: "Solo en Odoo", variante: "outline", ayuda: "Ningún documento de Profit tiene ese número (p. ej. notas de débito que no están en la vista de ventas)" },
};

const LISTAS: Record<ClaveLista, { titulo: string; corto: string; ayuda: string; donde: string }> = {
  clientes_estado_extranjero: { titulo: "Clientes con estado de otro país", corto: "Estado de otro país", ayuda: "El estado del contacto es de otro país (p. ej. «Bolivar (EC)», Ecuador)", donde: "Odoo → Contactos → dirección" },
  clientes_sin_condicion: { titulo: "Clientes sin condición de pago", corto: "Sin condición de pago", ayuda: "Clientes activos sin plazo de pago", donde: "Odoo → Contactos → Ventas y compras → Plazo de pago" },
  clientes_sin_rif: { titulo: "Clientes sin RIF", corto: "Sin RIF", ayuda: "Clientes activos sin RIF ni cédula", donde: "Odoo → Contactos → RIF" },
  productos_sin_costo: { titulo: "Productos con ventas y sin costo", corto: "Sin costo", ayuda: "Productos vendidos en Odoo sin costo en su empresa (el margen no los cuenta)", donde: "Odoo → Inventario → producto → Costo (en cada empresa)" },
  productos_sin_categoria: { titulo: "Productos con ventas y sin categoría", corto: "Sin categoría", ayuda: "Productos vendidos sin categoría o en la categoría raíz de Odoo («Todos»)", donde: "Odoo → Inventario → producto → Categoría" },
  productos_categoria_inactiva: { titulo: "Productos con ventas en una categoría inactiva", corto: "Categoría inactiva", ayuda: "La categoría del producto está desactivada en GUDS pero el producto se vende", donde: "GUDS → Categorías (activar) u Odoo → mover el producto de categoría" },
  facturas_anuladas_con_saldo: { titulo: "Facturas anuladas que Odoo aún tiene con saldo", corto: "Anuladas con saldo", ayuda: "Documentos revertidos con nota de crédito o cancelados que conservan saldo en Odoo", donde: "Odoo → Contabilidad → conciliar la factura con su nota de crédito" },
  cobros_sin_aplicar: { titulo: "Cobros de Odoo con parte sin aplicar", corto: "Cobros sin aplicar", ayuda: "Cobros verificados con al menos 1 USD sin conciliar con facturas", donde: "Odoo → Contabilidad → conciliar el cobro con sus facturas" },
};
const ORDEN_LISTAS = Object.keys(LISTAS) as ClaveLista[];

/** Pestaña "Calidad y cuadre" de Reportes: listas para corregir en Odoo y el cuadre de los saldos iniciales con Profit. */
export function CalidadDatos({ onCargando }: { onCargando?: (v: boolean) => void }) {
  const [vista, setVista] = useState<"calidad" | "cuadre">("calidad");
  return (
    <div className="min-w-0">
      <div className="mb-2 inline-flex rounded-md border border-border bg-muted p-0.5 text-[13px]" role="tablist" aria-label="Vista">
        {([["calidad", "Calidad de datos"], ["cuadre", "Cuadre Profit ↔ Odoo"]] as const).map(([k, t]) => (
          <button key={k} type="button" role="tab" aria-selected={vista === k} onClick={() => setVista(k)}
            className={cn("rounded-sm px-2.5 py-1 font-medium", vista === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>{t}</button>
        ))}
      </div>
      {vista === "calidad" ? <ListasCalidad onCargando={onCargando} /> : <CuadreProfitOdoo onCargando={onCargando} />}
    </div>
  );
}

function useRpc<T>(fn: string, onCargando?: (v: boolean) => void) {
  const { soloLectura, seleccion } = useEmpresa();
  const { toast } = useToast();
  const [datos, setDatos] = useState<T | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelado = false;
    (async () => {
      setCargando(true); onCargando?.(true); setError(null);
      let r = await supabase.rpc(fn);
      if (r.error && r.error.code === "57014") r = await supabase.rpc(fn);   // un reintento si la base corta por tiempo
      if (cancelado) return;
      if (r.error) { setError(r.error.message); toast({ title: "No se pudo cargar", description: r.error.message, variant: "destructive" }); }
      else setDatos(r.data as T);
      setCargando(false); onCargando?.(false);
    })();
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fn, soloLectura, seleccion]);
  return { datos, cargando, error };
}

function Estado({ cargando, error }: { cargando: boolean; error: string | null }) {
  if (error) return <p className="rounded-lg border border-border bg-card px-3 py-6 text-center text-sm text-destructive">{error}</p>;
  return cargando ? <div className="flex items-center gap-2 px-1 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Revisando los datos…</div> : null;
}

function ListasCalidad({ onCargando }: { onCargando?: (v: boolean) => void }) {
  const { formatPrice } = useCurrency();
  const { datos, cargando, error } = useRpc<Calidad>("reporte_calidad_datos", onCargando);
  const [lista, setLista] = useState<ClaveLista>("clientes_estado_extranjero");
  if (!datos) return <Estado cargando={cargando} error={error} />;

  const dinero = (campo: string) => (f: Fila) => formatPrice(num(f[campo]));
  const col = (clave: string, titulo: string, extra: Partial<ColumnaReporte<Fila>> = {}): ColumnaReporte<Fila> =>
    ({ clave, titulo, valor: (f) => (f[clave] as string | number | null) ?? null, render: (f) => texto(f[clave]), ...extra });
  const colsCliente = (principal: ColumnaReporte<Fila>): ColumnaReporte<Fila>[] => [
    col("cliente", "Cliente"), principal,
    col("ciudad", "Ciudad", { ocultarMovil: true }), col("vendedor", "Vendedor", { secundaria: true }),
    col("ultima_compra", "Última compra", { render: (f) => fecha(f.ultima_compra), ocultarMovil: true }),
    col("venta_12m", "Venta 12 meses", { valor: (f) => num(f.venta_12m), render: dinero("venta_12m"), derecha: true }),
    col("empresa", "Empresa", { soloExportar: true }), col("rif", "RIF", { soloExportar: true }), col("estado", "Estado", { soloExportar: true }),
    col("condicion_pago", "Condición de pago", { soloExportar: true }), col("facturas_12m", "Facturas 12 meses", { soloExportar: true }), col("odoo_id", "Id Odoo", { soloExportar: true }),
  ];
  const colsProducto = (extra: ColumnaReporte<Fila>[] = []): ColumnaReporte<Fila>[] => [
    col("producto", "Producto", { render: (f) => <span title={`${texto(f.sku)} · ${texto(f.producto)}`}><span className="mr-1.5 font-mono text-xs text-muted-foreground">{texto(f.sku)}</span>{texto(f.producto)}</span> }),
    col("categoria", "Categoría", { ocultarMovil: true }), ...extra,
    col("ultima_venta", "Última venta", { render: (f) => fecha(f.ultima_venta), secundaria: true }),
    col("unidades", "Unidades", { valor: (f) => num(f.unidades), render: (f) => fmtN(f.unidades), derecha: true, ocultarMovil: true }),
    col("venta_usd", "Venta", { valor: (f) => num(f.venta_usd), render: dinero("venta_usd"), derecha: true }),
    col("empresa", "Empresa", { soloExportar: true }), col("sku", "SKU", { soloExportar: true }),
  ];
  const columnas: Record<ClaveLista, ColumnaReporte<Fila>[]> = {
    clientes_estado_extranjero: colsCliente(col("estado", "Estado", { render: (f) => <span className="text-destructive">{texto(f.estado)}</span> })),
    clientes_sin_condicion: colsCliente(col("rif", "RIF", { render: (f) => <span className="font-mono text-xs">{texto(f.rif)}</span>, ocultarMovil: true })),
    clientes_sin_rif: colsCliente(col("rif", "RIF", { render: (f) => <span className="text-destructive">{texto(f.rif)}</span> })),
    productos_sin_costo: colsProducto(),
    productos_sin_categoria: colsProducto([col("motivo", "Motivo", { secundaria: true })]),
    productos_categoria_inactiva: colsProducto(),
    facturas_anuladas_con_saldo: [
      col("numero", "Documento", { render: (f) => <span className="whitespace-nowrap">{f.tipo === "nota_credito" ? "NC " : ""}{texto(f.numero)} <span className="text-muted-foreground">· {fecha(f.fecha)}</span></span> }),
      col("cliente", "Cliente"), col("motivo", "Motivo", { ocultarMovil: true }),
      col("saldo_usd", "Saldo en Odoo", { valor: (f) => num(f.saldo_usd), render: dinero("saldo_usd"), derecha: true }),
      col("empresa", "Empresa", { soloExportar: true }), col("tipo", "Tipo", { soloExportar: true }), col("fecha", "Fecha", { soloExportar: true }),
      col("estado_odoo", "Estado en Odoo", { soloExportar: true }), col("estado_pago", "Estado de pago", { soloExportar: true }), col("es_saldo_inicial", "Saldo inicial", { soloExportar: true }),
    ],
    cobros_sin_aplicar: [
      col("numero", "Cobro", { render: (f) => <span className="whitespace-nowrap">{texto(f.numero)} <span className="text-muted-foreground">· {fecha(f.fecha)}</span></span> }),
      col("cliente", "Cliente"), col("banco", "Banco", { ocultarMovil: true }),
      col("monto_usd", "Monto", { valor: (f) => num(f.monto_usd), render: dinero("monto_usd"), derecha: true, secundaria: true }),
      col("aplicado_usd", "Aplicado", { valor: (f) => num(f.aplicado_usd), render: dinero("aplicado_usd"), derecha: true, secundaria: true }),
      col("sin_aplicar_usd", "Sin aplicar", { valor: (f) => num(f.sin_aplicar_usd), render: dinero("sin_aplicar_usd"), derecha: true }),
      col("empresa", "Empresa", { soloExportar: true }), col("fecha", "Fecha", { soloExportar: true }), col("moneda", "Moneda", { soloExportar: true }),
    ],
  };
  const montoLista: Partial<Record<ClaveLista, string>> = {
    facturas_anuladas_con_saldo: `${formatPrice(num(datos.montos.facturas_anuladas_con_saldo_usd))} en saldos`,
    cobros_sin_aplicar: formatPrice(num(datos.montos.cobros_sin_aplicar_usd)),
    productos_sin_costo: `${formatPrice(num(datos.montos.productos_sin_costo_venta_usd))} vendidos`,
  };
  const info = LISTAS[lista];
  const filas = datos.listas[lista] ?? [];

  return (
    <>
      <KpiStrip className="lg:grid-cols-4 lg:grid-flow-row lg:auto-cols-auto" items={ORDEN_LISTAS.map((k) => ({
        label: LISTAS[k].corto, valor: fmtN(datos.conteos[k]), detalle: montoLista[k] ?? (k.startsWith("clientes") ? "clientes" : k.startsWith("productos") ? "productos" : undefined),
        tono: datos.conteos[k] ? ("alerta" as const) : ("positivo" as const), onClick: () => setLista(k), activo: lista === k, titulo: LISTAS[k].ayuda,
      }))} />
      <TablaReporte titulo={<>{info.titulo} <span className="font-normal text-muted-foreground">· {fmtN(filas.length)}</span></>}
        filas={filas} exportar={`calidad-${lista.replace(/_/g, "-")}`} limite={20} columnas={columnas[lista]}
        vacio="Nada que corregir en esta lista" />
      <p className="-mt-1 text-[11px] text-muted-foreground">
        {info.ayuda}. Dónde se corrige: <span className="font-medium text-foreground">{info.donde}</span>. Solo lectura: GUDS lo refleja en la siguiente sincronización.
        Revisado {new Date(datos.generado).toLocaleString("es-VE", { dateStyle: "short", timeStyle: "short" })}.
      </p>
    </>
  );
}

function CuadreProfitOdoo({ onCargando }: { onCargando?: (v: boolean) => void }) {
  const { formatPrice } = useCurrency();
  const { datos, cargando, error } = useRpc<Cuadre>("reporte_cuadre_profit_odoo", onCargando);
  const [estado, setEstado] = useState<string>("todos");
  const docs = useMemo(() => (datos?.documentos ?? []).filter((d) => estado === "todos" || d.estado === estado), [datos, estado]);
  if (!datos) return <Estado cargando={cargando} error={error} />;
  if (!datos.lote) return <p className="rounded-lg border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground">Aún no hay histórico de Profit cargado.</p>;
  const t = datos.totales;
  const insignia = (contenido: ReactNode) => <span className="inline-flex items-center gap-1">{contenido}<InsigniaProfit /></span>;

  return (
    <>
      <KpiStrip items={[
        { label: "Saldos iniciales en Odoo", valor: fmtN(t.documentos), detalle: "facturas, NC y ND al corte", tono: "primario",
          titulo: "Documentos que Odoo recibió como cartera abierta de Profit al arrancar" },
        { label: "Cuadran", valor: fmtN(t.cuadran), tono: "positivo", titulo: ESTADO_CUADRE.cuadra.ayuda,
          detalle: insignia(`dif. ${formatPrice(num(t.cuadran_odoo_usd) - num(t.cuadran_profit_usd))}`) },
        { label: "Pronto pago 3 %", valor: fmtN(t.pronto_pago), detalle: formatPrice(num(t.pronto_pago_usd)), tono: t.pronto_pago ? "alerta" : "normal", titulo: ESTADO_CUADRE.pronto_pago.ayuda,
          onClick: () => setEstado("pronto_pago"), activo: estado === "pronto_pago" },
        { label: "Difieren", valor: fmtN(t.difieren), tono: t.difieren ? "negativo" : "normal", titulo: ESTADO_CUADRE.difiere.ayuda, onClick: () => setEstado("difiere"), activo: estado === "difiere" },
        { label: "NC ambiguas", valor: fmtN(t.nc_ambiguas), tono: "tenue", titulo: ESTADO_CUADRE.nc_ambigua.ayuda, onClick: () => setEstado("nc_ambigua"), activo: estado === "nc_ambigua" },
        { label: "Solo en Odoo", valor: fmtN(t.solo_odoo), tono: "tenue", titulo: ESTADO_CUADRE.solo_odoo.ayuda, onClick: () => setEstado("solo_odoo"), activo: estado === "solo_odoo" },
        { label: "Pendientes sin saldo inicial", valor: fmtN(t.sin_saldo_inicial), detalle: formatPrice(num(t.sin_saldo_inicial_usd)), tono: t.sin_saldo_inicial ? "alerta" : "normal",
          titulo: "Facturas que Profit tiene «Pendiente» y no llegaron como saldo inicial a Odoo" },
      ]} />
      <p className="-mt-1 mb-3 text-xs text-muted-foreground">
        <InsigniaProfit className="mr-1 align-[-2px]" />
        Cada saldo inicial de Odoo se busca en el histórico de Profit por empresa, tipo y número. Cuadran {fmtN(t.cuadran)} documentos: Odoo {formatPrice(num(t.cuadran_odoo_usd))} contra
        Profit {formatPrice(num(t.cuadran_profit_usd))}; {fmtN(t.pendientes_profit)} figuran «Pendiente» en Profit. En la ventana del análisis previo (desde {fechaCorta(datos.ventana_desde)}) cuadran
        {" "}{fmtN(t.ventana_cuadran)}: Odoo {formatPrice(num(t.ventana_odoo_usd))} contra Profit {formatPrice(num(t.ventana_profit_usd))}.
      </p>

      <div className="grid gap-3 xl:grid-cols-5">
        <TablaReporte className="xl:col-span-2" titulo="Resumen por empresa y tipo" filas={datos.resumen} exportar="cuadre-profit-odoo-resumen" limite={30} columnas={[
          { clave: "empresa", titulo: "Empresa · tipo", valor: (f) => `${f.empresa} ${f.clase}`, render: (f) => <span>{f.empresa} <span className="text-muted-foreground">· {CLASE[f.clase] ?? f.clase}</span></span> },
          { clave: "estado", titulo: "Estado", valor: (f) => ESTADO_CUADRE[f.estado]?.texto ?? f.estado,
            render: (f) => <Badge variant={ESTADO_CUADRE[f.estado]?.variante ?? "outline"} title={ESTADO_CUADRE[f.estado]?.ayuda}>{ESTADO_CUADRE[f.estado]?.texto ?? f.estado}</Badge> },
          { clave: "documentos", titulo: "Docs.", valor: (f) => num(f.documentos), derecha: true },
          { clave: "diferencia", titulo: "Diferencia", valor: (f) => num(f.diferencia_usd), render: (f) => formatPrice(num(f.diferencia_usd)), derecha: true },
          { clave: "odoo", titulo: "Odoo (USD)", valor: (f) => num(f.odoo_usd), soloExportar: true },
          { clave: "profit", titulo: "Profit (USD)", valor: (f) => num(f.profit_usd), soloExportar: true },
        ]} />
        <TablaReporte className="xl:col-span-3" filas={docs} exportar="cuadre-profit-odoo-diferencias" limite={15}
          titulo={<span className="flex flex-wrap items-center gap-2">Documentos que no cuadran <span className="font-normal text-muted-foreground">· {fmtN(docs.length)}</span></span>}
          acciones={
            <Select value={estado} onValueChange={setEstado}>
              <SelectTrigger className="h-8 w-40 text-xs" aria-label="Filtrar por estado"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos" className="text-xs">Todos los estados</SelectItem>
                {Object.entries(ESTADO_CUADRE).filter(([k]) => k !== "cuadra").map(([k, e]) => <SelectItem key={k} value={k} className="text-xs">{e.texto}</SelectItem>)}
              </SelectContent>
            </Select>
          }
          columnas={[
            { clave: "numero", titulo: "Documento", valor: (f) => f.numero as string,
              render: (f) => <span className="whitespace-nowrap">{PREFIJO[String(f.clase)] ?? ""} {texto(f.numero)} <span className="text-muted-foreground">· {f.empresa as string}</span></span> },
            { clave: "cliente", titulo: "Cliente", valor: (f) => f.cliente as string, render: (f) => texto(f.cliente), ocultarMovil: true },
            { clave: "odoo", titulo: "Odoo", valor: (f) => num(f.total_odoo_usd), render: (f) => formatPrice(num(f.total_odoo_usd)), derecha: true, secundaria: true },
            { clave: "profit", titulo: "Profit", valor: (f) => (f.total_profit_usd === null ? null : num(f.total_profit_usd)), render: (f) => (f.total_profit_usd === null ? "—" : formatPrice(num(f.total_profit_usd))), derecha: true, secundaria: true },
            { clave: "diferencia", titulo: "Diferencia", valor: (f) => (f.diferencia_usd === null ? null : num(f.diferencia_usd)),
              render: (f) => (f.diferencia_usd === null ? "—" : <span className={Math.abs(num(f.diferencia_usd)) >= 1 ? "text-destructive" : ""}>{formatPrice(num(f.diferencia_usd))}</span>), derecha: true },
            { clave: "estado", titulo: "Estado", valor: (f) => ESTADO_CUADRE[String(f.estado)]?.texto ?? String(f.estado),
              render: (f) => <Badge variant={ESTADO_CUADRE[String(f.estado)]?.variante ?? "outline"} title={ESTADO_CUADRE[String(f.estado)]?.ayuda}>{ESTADO_CUADRE[String(f.estado)]?.texto ?? String(f.estado)}</Badge> },
            { clave: "empresa", titulo: "Empresa", valor: (f) => f.empresa as string, soloExportar: true },
            { clave: "clase", titulo: "Tipo", valor: (f) => CLASE[String(f.clase)] ?? String(f.clase), soloExportar: true },
            { clave: "fecha", titulo: "Fecha Odoo", valor: (f) => f.fecha as string, soloExportar: true },
            { clave: "rif", titulo: "RIF", valor: (f) => f.rif as string, soloExportar: true },
            { clave: "saldo", titulo: "Saldo actual en Odoo (USD)", valor: (f) => num(f.saldo_odoo_usd), soloExportar: true },
            { clave: "tipo_profit", titulo: "Documento Profit", valor: (f) => (f.tipo_profit ? `${f.tipo_profit} ${f.numero_profit}` : null), soloExportar: true },
            { clave: "fecha_profit", titulo: "Fecha Profit", valor: (f) => f.fecha_profit as string, soloExportar: true },
            { clave: "estatus_profit", titulo: "Estatus en Profit", valor: (f) => f.estatus_profit as string, soloExportar: true },
            { clave: "odoo_x", titulo: "Total Odoo (USD)", valor: (f) => num(f.total_odoo_usd), soloExportar: true },
            { clave: "profit_x", titulo: "Total Profit (USD)", valor: (f) => (f.total_profit_usd === null ? null : num(f.total_profit_usd)), soloExportar: true },
          ]} />
      </div>
      {estado !== "todos" && (
        <p className="-mt-1 mb-3 text-xs text-muted-foreground">
          {ESTADO_CUADRE[estado]?.ayuda}. <Button variant="link" size="sm" className="h-auto px-1 py-0 text-xs" onClick={() => setEstado("todos")}>Ver todos</Button>
        </p>
      )}
      <TablaReporte titulo={<>Pendientes en Profit sin saldo inicial en Odoo <span className="font-normal text-muted-foreground">· {fmtN(datos.pendientes_sin_saldo.length)}</span></>}
        filas={datos.pendientes_sin_saldo} exportar="cuadre-pendientes-profit-sin-saldo" limite={10} vacio="Todas las facturas pendientes de Profit llegaron a Odoo"
        metrica={(f) => num(f.total_usd)} columnas={[
          { clave: "numero", titulo: "Factura", valor: (f) => f.numero as string, render: (f) => <span className="whitespace-nowrap">{texto(f.numero)} <span className="text-muted-foreground">· {fecha(f.fecha)}</span></span> },
          { clave: "cliente", titulo: "Cliente", valor: (f) => f.cliente as string, render: (f) => texto(f.cliente) },
          { clave: "total", titulo: "Total", valor: (f) => num(f.total_usd), render: (f) => formatPrice(num(f.total_usd)), derecha: true },
          { clave: "empresa", titulo: "Empresa", valor: (f) => f.empresa as string, soloExportar: true },
          { clave: "fecha", titulo: "Fecha", valor: (f) => f.fecha as string, soloExportar: true },
        ]} />
      <p className="-mt-1 text-[11px] text-muted-foreground">
        Solo lectura: las diferencias se corrigen en Odoo. El estatus de Profit es el de la extracción del Excel (una factura «Pendiente» pudo cobrarse antes del corte).
      </p>
    </>
  );
}

export default CalidadDatos;
