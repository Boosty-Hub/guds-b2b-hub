import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, FileMinus } from "lucide-react";
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
  id: string; numero: string; cliente_id: string; fecha_emision: string | null;
  moneda: string; total_usd: number; saldo_usd: number; estado: string; estado_cobro: string;
  es_saldo_inicial?: boolean | null; vendedor_odoo: string | null; motivo_anulacion: string | null; empresa_id?: string | null;
  cliente?: { nombre_negocio: string } | null;
}

// Estado de cobro de una nota de crédito visto como aplicación del crédito al cliente
const ESTADO_NC: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pendiente: { label: "Sin aplicar", variant: "secondary" },
  parcial: { label: "Aplicada en parte", variant: "outline" },
  pagado: { label: "Aplicada", variant: "default" },
  anulado: { label: "Anulada", variant: "destructive" },
};
const anulada = (f: FacturaRow) => f.estado === "cancel" || f.estado_cobro === "anulado";

const NotasCredito = () => {
  const navigate = useNavigate();
  const { formatPrice } = useCurrency();
  const [notas, setNotas] = useState<FacturaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      // Las anuladas (cancel) también se traen para el filtro "Anuladas"; por defecto se ven solo las publicadas, como antes
      const { data } = await supabase.from("facturas")
        .select("id, numero, cliente_id, fecha_emision, moneda, total_usd, saldo_usd, estado, estado_cobro, es_saldo_inicial, vendedor_odoo, motivo_anulacion, empresa_id, cliente:clientes(nombre_negocio)")
        .eq("tipo", "nota_credito").in("estado", ["posted", "cancel"])
        .order("fecha_emision", { ascending: false })
        .limit(10000);
      setNotas((data as unknown as FacturaRow[]) ?? []);
      setLoading(false);
    })();
  }, []);

  // ---- Filtros (en la URL) ----
  const pruebasEstado: OpcionPrueba<FacturaRow>[] = [
    { valor: "vigentes", etiqueta: "Publicadas", prueba: (x) => x.estado === "posted" },
    { valor: "disponible", etiqueta: "Con crédito disponible", prueba: (x) => x.estado === "posted" && !anulada(x) && Number(x.saldo_usd) < -0.009 },
    { valor: "pendiente", etiqueta: "Sin aplicar", prueba: (x) => !anulada(x) && x.estado_cobro === "pendiente" },
    { valor: "parcial", etiqueta: "Aplicadas en parte", prueba: (x) => !anulada(x) && x.estado_cobro === "parcial" },
    { valor: "pagado", etiqueta: "Aplicadas", prueba: (x) => !anulada(x) && x.estado_cobro === "pagado" },
    { valor: "anulado", etiqueta: "Anuladas", prueba: anulada },
    { valor: "todas", etiqueta: "Todas (con anuladas)", prueba: () => true },
  ];
  const pruebasInicial: OpcionPrueba<FacturaRow>[] = [
    { valor: "si", etiqueta: "Solo saldos iniciales", prueba: (x) => !!x.es_saldo_inicial },
    { valor: "no", etiqueta: "Sin saldos iniciales", prueba: (x) => !x.es_saldo_inicial },
  ];
  const filtroEmpresa = useFiltroEmpresa(notas);
  const f = useFiltros([
    { clave: "estado", etiqueta: "Estado", principal: true, porDefecto: "vigentes", opciones: opcionesPrueba(notas, pruebasEstado) },
    { clave: "fecha", etiqueta: "Emisión", tipo: "fecha", principal: true },
    { clave: "cliente", etiqueta: "Cliente", todos: "Todos los clientes", principal: true, opciones: opcionesDe(notas, (x) => x.cliente_id, (x) => x.cliente?.nombre_negocio ?? "—") },
    { clave: "vendedor", etiqueta: "Vendedor", opciones: opcionesTexto(notas, (x) => x.vendedor_odoo, "Sin vendedor") },
    { clave: "inicial", etiqueta: "Saldos iniciales", todos: "Con y sin saldos iniciales", opciones: opcionesPrueba(notas, pruebasInicial) },
    { clave: "moneda", etiqueta: "Moneda", todos: "Todas", opciones: opcionesDe(notas, (x) => x.moneda) },
    filtroEmpresa,
  ]);

  const filtradas = useMemo(() => {
    const q = search.toLowerCase();
    return notas.filter((x) =>
      pasaPrueba(pruebasEstado, f.v("estado"), x) && enRango(x.fecha_emision, f.v("fecha")) && coincide(x.cliente_id, f.v("cliente"))
      && coincideTexto(x.vendedor_odoo, f.v("vendedor")) && pasaPrueba(pruebasInicial, f.v("inicial"), x) && coincide(x.moneda, f.v("moneda"))
      && (!filtroEmpresa || coincide(x.empresa_id, f.v("empresa")))
      && (x.numero.toLowerCase().includes(q) || (x.cliente?.nombre_negocio || "").toLowerCase().includes(q)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notas, search, f.firma]);

  const { ordenadas, orden, alternar } = useOrdenTabla(filtradas, {
    numero: (x) => x.numero, cliente: (x) => x.cliente?.nombre_negocio, emision: (x) => x.fecha_emision, moneda: (x) => x.moneda,
    total: (x) => Number(x.total_usd || 0), saldo: (x) => Number(x.saldo_usd || 0),
  });
  const pagination = usePagination(ordenadas, 50, f.firma);
  const exportar = () => exportarCSV("notas-credito", ordenadas, [
    { titulo: "Número", valor: (x) => x.numero }, { titulo: "Cliente", valor: (x) => x.cliente?.nombre_negocio }, { titulo: "Emisión", valor: (x) => x.fecha_emision },
    { titulo: "Moneda", valor: (x) => x.moneda }, { titulo: "Total USD", valor: (x) => Number(x.total_usd || 0) }, { titulo: "Saldo USD", valor: (x) => Number(x.saldo_usd || 0) },
    { titulo: "Estado", valor: (x) => (x.estado === "cancel" ? "Anulada" : ESTADO_NC[x.estado_cobro]?.label ?? x.estado_cobro) },
    { titulo: "Vendedor", valor: (x) => x.vendedor_odoo }, { titulo: "Saldo inicial", valor: (x) => (x.es_saldo_inicial ? "Sí" : "") },
  ]);
  // Indicadores como antes: publicadas (sin filtros) y el crédito sin aplicar de lo filtrado
  const publicadas = notas.filter((x) => x.estado === "posted");
  const totalCredito = filtradas.filter((x) => x.estado === "posted").reduce((s, x) => s + Math.abs(Number(x.saldo_usd || 0)), 0);
  const fmtFecha = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString("es-VE", { day: "2-digit", month: "short", year: "numeric" }) : "—");

  const cols = useColumnas("notas-credito", [{ etiqueta: "Nº", fija: true }, { etiqueta: "Cliente" }, { etiqueta: "Emisión" }, { etiqueta: "Moneda" }, { etiqueta: "Total" }, { etiqueta: "Saldo (a favor del cliente)" }, { etiqueta: "Estado" }]);
  return (
    <MainLayout title="Notas de Crédito">
      {cols.estilo}
      <KpiStrip items={[
        { label: "Notas de crédito", valor: publicadas.length },
        { label: "Crédito disponible sin aplicar (filtro actual)", valor: formatPrice(totalCredito), tono: "positivo" },
      ]} />

      <BarraLista
        busqueda={search}
        onBusqueda={setSearch}
        placeholder="Buscar por número o cliente..."
        filtros={<FiltrosLista filtros={f} resultados={filtradas.length} />}
        contador={loading ? undefined : contadorFiltrado(filtradas.length, publicadas.length, f.activos || !!search)}
        acciones={<>{cols.selector}<BotonExportar onClick={exportar} total={ordenadas.length} /></>}
      />

      <div className="rounded-lg border border-border bg-card">
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : filtradas.length === 0 ? (
          <div className="flex flex-col items-center py-10 text-muted-foreground">
            <FileMinus className="mb-2 h-8 w-8 opacity-50" />
            {notas.length > 0 ? "Ninguna nota de crédito coincide con la búsqueda o los filtros" : "No hay notas de crédito"}
            {f.activos > 0 && <button type="button" className="mt-1 text-xs font-medium text-primary hover:underline" onClick={f.limpiar}>Limpiar filtros</button>}
          </div>
        ) : (
          <Table data-tabla="notas-credito">
            <TableHeader>
              <TableRow>
                <EncabezadoOrdenable clave="numero" orden={orden} onOrdenar={alternar}>Nº</EncabezadoOrdenable><EncabezadoOrdenable clave="cliente" orden={orden} onOrdenar={alternar}>Cliente</EncabezadoOrdenable><EncabezadoOrdenable clave="emision" orden={orden} onOrdenar={alternar}>Emisión</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="moneda" orden={orden} onOrdenar={alternar}>Moneda</EncabezadoOrdenable><EncabezadoOrdenable clave="total" orden={orden} onOrdenar={alternar} alinear="derecha">Total</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="saldo" orden={orden} onOrdenar={alternar} alinear="derecha">Saldo (a favor del cliente)</EncabezadoOrdenable>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagination.pageItems.map((x) => (
                <TableRow key={x.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/admin/facturas/${x.id}`)}>
                  <TableCell className="whitespace-nowrap font-mono text-xs text-primary">{x.numero}</TableCell>
                  <TableCell className="font-medium"><span className="block max-w-[260px] truncate" title={x.cliente?.nombre_negocio || undefined}>{x.cliente?.nombre_negocio || "—"}</span></TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{fmtFecha(x.fecha_emision)}</TableCell>
                  <TableCell className="text-muted-foreground">{x.moneda}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">{formatPrice(x.total_usd)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-semibold text-success">{x.estado === "cancel" ? "—" : formatPrice(Math.abs(x.saldo_usd))}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {x.estado === "cancel"
                      ? <Badge variant="destructive" title={x.motivo_anulacion || undefined}>Anulada</Badge>
                      : <Badge variant={ESTADO_NC[x.estado_cobro]?.variant ?? "secondary"}>{ESTADO_NC[x.estado_cobro]?.label ?? x.estado_cobro}</Badge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {!loading && <DataTablePagination pagination={pagination} />}
      </div>
    </MainLayout>
  );
};

export default NotasCredito;
