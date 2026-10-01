import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, FileText } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { BarraLista } from "@/components/datos/BarraLista";
import { useOrdenTabla, EncabezadoOrdenable, exportarCSV, BotonExportar } from "@/components/datos/tabla";
import { useColumnas } from "@/components/datos/columnas";
import {
  FiltrosLista, useFiltros, useFiltroEmpresa, opcionesDe, opcionesTexto, opcionesPrueba, pasaPrueba, coincide, coincideTexto, enRango,
  contadorFiltrado, type OpcionPrueba,
} from "@/components/datos/FiltrosLista";

interface FacturaRow {
  es_nota_debito?: boolean;
  es_saldo_inicial?: boolean | null;
  id: string; numero: string; cliente_id: string; fecha_emision: string | null; fecha_vencimiento: string | null;
  moneda: string; total: number; total_usd: number; saldo_usd: number; estado_cobro: string;
  estado: string; motivo_anulacion: string | null; vendedor_odoo: string | null; empresa_id?: string | null;
  cliente?: { nombre_negocio: string } | null;
}

const ESTADO_COBRO: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pendiente: { label: "Pendiente", variant: "secondary" },
  parcial: { label: "Parcial", variant: "outline" },
  pagado: { label: "Pagada", variant: "default" },
  anulado: { label: "Anulada", variant: "destructive" },
};

const anulada = (f: FacturaRow) => f.estado === "cancel" || f.estado_cobro === "anulado";

/** Días de atraso según el vencimiento (o la emisión si no tiene), como Cuentas por Cobrar. ≤ 0 = por vencer. */
const diasAtraso = (f: FacturaRow, hoy: number) => {
  const vence = f.fecha_vencimiento || f.fecha_emision;
  return vence ? Math.floor((hoy - new Date(`${vence}T00:00:00`).getTime()) / 86400000) : 0;
};

const Facturas = () => {
  const navigate = useNavigate();
  const { formatPrice } = useCurrency();
  const [facturas, setFacturas] = useState<FacturaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase.from("facturas")
        .select("id, numero, cliente_id, fecha_emision, fecha_vencimiento, moneda, total, total_usd, saldo_usd, estado_cobro, estado, motivo_anulacion, es_nota_debito, es_saldo_inicial, vendedor_odoo, empresa_id, cliente:clientes(nombre_negocio)")
        // Las facturas no se eliminan: las anuladas siguen aquí (filtro "Anuladas") con su motivo
        .eq("tipo", "factura").in("estado", ["posted", "cancel"])
        .order("fecha_emision", { ascending: false })
        .limit(10000);
      setFacturas((data as unknown as FacturaRow[]) ?? []);
      setLoading(false);
    })();
  }, []);

  // ---- Filtros (en la URL) ----
  const hoy = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }, []);
  const conSaldo = (f: FacturaRow) => !anulada(f) && Number(f.saldo_usd) > 0.009;
  const pruebasEstado: OpcionPrueba<FacturaRow>[] = [
    { valor: "vigentes", etiqueta: "Vigentes", prueba: (f) => !anulada(f) },
    { valor: "pendiente", etiqueta: "Pendientes", prueba: (f) => !anulada(f) && f.estado_cobro === "pendiente" },
    { valor: "parcial", etiqueta: "Pagadas en parte", prueba: (f) => !anulada(f) && f.estado_cobro === "parcial" },
    { valor: "pagado", etiqueta: "Pagadas", prueba: (f) => !anulada(f) && f.estado_cobro === "pagado" },
    { valor: "anulado", etiqueta: "Anuladas", prueba: anulada },
    { valor: "todas", etiqueta: "Todas (con anuladas)", prueba: () => true },
  ];
  // Antigüedad del saldo: mismos tramos que Cuentas por Cobrar (solo facturas vigentes con saldo)
  const pruebasTramo: OpcionPrueba<FacturaRow>[] = [
    { valor: "por_vencer", etiqueta: "Por vencer", prueba: (f) => conSaldo(f) && diasAtraso(f, hoy) <= 0 },
    { valor: "vencidas", etiqueta: "Vencidas (todas)", prueba: (f) => conSaldo(f) && diasAtraso(f, hoy) > 0 },
    { valor: "d30", etiqueta: "Vencidas 1–30 días", prueba: (f) => conSaldo(f) && diasAtraso(f, hoy) >= 1 && diasAtraso(f, hoy) <= 30 },
    { valor: "d60", etiqueta: "Vencidas 31–60 días", prueba: (f) => conSaldo(f) && diasAtraso(f, hoy) >= 31 && diasAtraso(f, hoy) <= 60 },
    { valor: "d90", etiqueta: "Vencidas 61–90 días", prueba: (f) => conSaldo(f) && diasAtraso(f, hoy) >= 61 && diasAtraso(f, hoy) <= 90 },
    { valor: "mas90", etiqueta: "Vencidas +90 días", prueba: (f) => conSaldo(f) && diasAtraso(f, hoy) > 90 },
  ];
  const pruebasDoc: OpcionPrueba<FacturaRow>[] = [
    { valor: "factura", etiqueta: "Facturas", prueba: (f) => !f.es_nota_debito },
    { valor: "nd", etiqueta: "Notas de débito", prueba: (f) => !!f.es_nota_debito },
  ];
  const pruebasInicial: OpcionPrueba<FacturaRow>[] = [
    { valor: "si", etiqueta: "Solo saldos iniciales", prueba: (f) => !!f.es_saldo_inicial },
    { valor: "no", etiqueta: "Sin saldos iniciales", prueba: (f) => !f.es_saldo_inicial },
  ];
  const filtroEmpresa = useFiltroEmpresa(facturas);
  const f = useFiltros([
    { clave: "estado", etiqueta: "Estado", principal: true, porDefecto: "vigentes", opciones: opcionesPrueba(facturas, pruebasEstado) },
    { clave: "vence", etiqueta: "Vencimiento", todos: "Todas", principal: true, opciones: opcionesPrueba(facturas, pruebasTramo) },
    { clave: "fecha", etiqueta: "Emisión", tipo: "fecha", principal: true },
    { clave: "vendedor", etiqueta: "Vendedor", principal: true, opciones: opcionesTexto(facturas, (x) => x.vendedor_odoo, "Sin vendedor") },
    { clave: "cliente", etiqueta: "Cliente", todos: "Todos los clientes", opciones: opcionesDe(facturas, (x) => x.cliente_id, (x) => x.cliente?.nombre_negocio ?? "—") },
    { clave: "doc", etiqueta: "Documento", todos: "Facturas y notas de débito", opciones: opcionesPrueba(facturas, pruebasDoc) },
    { clave: "inicial", etiqueta: "Saldos iniciales", todos: "Con y sin saldos iniciales", opciones: opcionesPrueba(facturas, pruebasInicial) },
    { clave: "moneda", etiqueta: "Moneda", todos: "Todas", opciones: opcionesDe(facturas, (x) => x.moneda) },
    filtroEmpresa,
  ]);
  // Todos los filtros salvo el estado (base de los indicadores) y la búsqueda
  const pasaSinEstado = (x: FacturaRow) =>
    pasaPrueba(pruebasTramo, f.v("vence"), x) && enRango(x.fecha_emision, f.v("fecha"))
    && coincideTexto(x.vendedor_odoo, f.v("vendedor")) && coincide(x.cliente_id, f.v("cliente"))
    && pasaPrueba(pruebasDoc, f.v("doc"), x) && pasaPrueba(pruebasInicial, f.v("inicial"), x)
    && coincide(x.moneda, f.v("moneda")) && (!filtroEmpresa || coincide(x.empresa_id, f.v("empresa")));
  // Sin filtros (estado "vigentes" por defecto), los indicadores son los de siempre: sobre todas las facturas
  const base = useMemo(() => facturas.filter(pasaSinEstado),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [facturas, f.firma, hoy]);

  const filtradas = useMemo(() => {
    const q = search.toLowerCase();
    return base.filter((x) => pasaPrueba(pruebasEstado, f.v("estado"), x)
      && (x.numero.toLowerCase().includes(q) || (x.cliente?.nombre_negocio || "").toLowerCase().includes(q)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, search, f.firma]);

  const { ordenadas, orden, alternar } = useOrdenTabla(filtradas, {
    numero: (x) => x.numero, cliente: (x) => x.cliente?.nombre_negocio, emision: (x) => x.fecha_emision, vence: (x) => x.fecha_vencimiento || x.fecha_emision,
    moneda: (x) => x.moneda, total: (x) => Number(x.total_usd || 0), saldo: (x) => Number(x.saldo_usd || 0),
  });
  const pagination = usePagination(ordenadas, 50, f.firma);
  const exportar = () => exportarCSV("facturas", ordenadas, [
    { titulo: "Número", valor: (x) => x.numero }, { titulo: "Cliente", valor: (x) => x.cliente?.nombre_negocio }, { titulo: "Emisión", valor: (x) => x.fecha_emision },
    { titulo: "Vence", valor: (x) => x.fecha_vencimiento }, { titulo: "Moneda", valor: (x) => x.moneda },
    { titulo: "Total USD", valor: (x) => Number(x.total_usd || 0) }, { titulo: "Saldo USD", valor: (x) => Number(x.saldo_usd || 0) },
    { titulo: "Estado", valor: (x) => (x.estado === "cancel" ? "Anulada" : ESTADO_COBRO[x.estado_cobro]?.label ?? x.estado_cobro) },
    { titulo: "Días vencida", valor: (x) => (conSaldo(x) && diasAtraso(x, hoy) > 0 ? diasAtraso(x, hoy) : "") },
    { titulo: "Vendedor", valor: (x) => x.vendedor_odoo }, { titulo: "Nota de débito", valor: (x) => (x.es_nota_debito ? "Sí" : "") },
    { titulo: "Saldo inicial", valor: (x) => (x.es_saldo_inicial ? "Sí" : "") },
    { titulo: "Motivo de anulación", valor: (x) => x.motivo_anulacion },
  ]);
  const vigentes = base.filter((x) => x.estado !== "cancel");
  const totalSaldo = filtradas.filter((x) => x.estado !== "cancel").reduce((s, x) => s + Number(x.saldo_usd || 0), 0);
  const fmtFecha = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString("es-VE", { day: "2-digit", month: "short", year: "numeric" }) : "—");

  const cols = useColumnas("facturas", [{ etiqueta: "Nº", fija: true }, { etiqueta: "Cliente" }, { etiqueta: "Emisión" }, { etiqueta: "Vence" }, { etiqueta: "Moneda" }, { etiqueta: "Total" }, { etiqueta: "Saldo" }, { etiqueta: "Estado" }]);
  return (
    <MainLayout title="Facturas">
      {cols.estilo}
      <KpiStrip items={[
        { label: "Facturas vigentes", valor: vigentes.length },
        { label: "Saldo pendiente (filtro actual)", valor: formatPrice(totalSaldo), tono: "negativo" },
        { label: "Pagadas", valor: vigentes.filter((x) => x.estado_cobro === "pagado").length, tono: "positivo" },
        { label: "Anuladas", valor: base.length - vigentes.length, detalle: "Se conservan con su motivo", onClick: () => f.set("estado", f.v("estado") === "anulado" ? "" : "anulado"), activo: f.v("estado") === "anulado" },
      ]} />

      <BarraLista
        busqueda={search}
        onBusqueda={setSearch}
        placeholder="Buscar por número o cliente..."
        filtros={<FiltrosLista filtros={f} resultados={filtradas.length} />}
        contador={loading ? undefined : contadorFiltrado(filtradas.length, facturas.length, f.activos || !!search)}
        acciones={<>{cols.selector}<BotonExportar onClick={exportar} total={ordenadas.length} /></>}
      />

      <div className="rounded-lg border border-border bg-card">
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : filtradas.length === 0 ? (
          <div className="flex flex-col items-center py-10 text-muted-foreground">
            <FileText className="mb-2 h-8 w-8 opacity-50" />
            {facturas.length > 0 ? "Ninguna factura coincide con la búsqueda o los filtros" : "No hay facturas"}
            {f.activos > 0 && <button type="button" className="mt-1 text-xs font-medium text-primary hover:underline" onClick={f.limpiar}>Limpiar filtros</button>}
          </div>
        ) : (
          <Table data-tabla="facturas">
            <TableHeader>
              <TableRow>
                <EncabezadoOrdenable clave="numero" orden={orden} onOrdenar={alternar}>Nº</EncabezadoOrdenable><EncabezadoOrdenable clave="cliente" orden={orden} onOrdenar={alternar}>Cliente</EncabezadoOrdenable><EncabezadoOrdenable clave="emision" orden={orden} onOrdenar={alternar}>Emisión</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="vence" orden={orden} onOrdenar={alternar}>Vence</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="moneda" orden={orden} onOrdenar={alternar}>Moneda</EncabezadoOrdenable><EncabezadoOrdenable clave="total" orden={orden} onOrdenar={alternar} alinear="derecha">Total</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="saldo" orden={orden} onOrdenar={alternar} alinear="derecha">Saldo</EncabezadoOrdenable><TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagination.pageItems.map((x) => {
                const atraso = conSaldo(x) ? diasAtraso(x, hoy) : 0;
                return (
                  <TableRow key={x.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/admin/facturas/${x.id}`)}>
                    <TableCell className="font-mono text-xs text-primary">
                      <span className="flex items-center gap-1.5 whitespace-nowrap">{x.numero}{x.es_nota_debito && <Badge variant="outline" className="px-1 py-0 font-sans text-[10px]">ND</Badge>}</span>
                    </TableCell>
                    <TableCell className="font-medium"><span className="block max-w-[260px] truncate" title={x.cliente?.nombre_negocio || undefined}>{x.cliente?.nombre_negocio || "—"}</span></TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{fmtFecha(x.fecha_emision)}</TableCell>
                    <TableCell className={`whitespace-nowrap ${atraso > 0 ? "text-destructive" : "text-muted-foreground"}`} title={atraso > 0 ? `Vencida hace ${atraso} día${atraso === 1 ? "" : "s"}` : undefined}>
                      {fmtFecha(x.fecha_vencimiento || x.fecha_emision)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{x.moneda}</TableCell>
                    <TableCell className="whitespace-nowrap text-right">{formatPrice(x.total_usd)}</TableCell>
                    <TableCell className={`whitespace-nowrap text-right font-semibold ${x.estado !== "cancel" && x.saldo_usd > 0.009 ? "text-destructive" : ""}`}>{x.estado === "cancel" ? "—" : formatPrice(x.saldo_usd)}</TableCell>
                    <TableCell>
                      {x.estado === "cancel"
                        ? <Badge variant="destructive" title={x.motivo_anulacion || undefined}>Anulada</Badge>
                        : <Badge variant={ESTADO_COBRO[x.estado_cobro]?.variant ?? "secondary"}>{ESTADO_COBRO[x.estado_cobro]?.label ?? x.estado_cobro}</Badge>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {!loading && <DataTablePagination pagination={pagination} />}
      </div>
    </MainLayout>
  );
};

export default Facturas;
