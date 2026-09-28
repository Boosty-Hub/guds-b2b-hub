import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, FileText } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { BarraLista } from "@/components/datos/BarraLista";
import { useOrdenTabla, EncabezadoOrdenable, exportarCSV, BotonExportar } from "@/components/datos/tabla";
import { useColumnas } from "@/components/datos/columnas";

interface FacturaRow {
  es_nota_debito?: boolean;
  id: string; numero: string; cliente_id: string; fecha_emision: string | null;
  moneda: string; total: number; total_usd: number; saldo_usd: number; estado_cobro: string;
  estado: string; motivo_anulacion: string | null;
  cliente?: { nombre_negocio: string } | null;
}

const ESTADO_COBRO: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pendiente: { label: "Pendiente", variant: "secondary" },
  parcial: { label: "Parcial", variant: "outline" },
  pagado: { label: "Pagada", variant: "default" },
  anulado: { label: "Anulada", variant: "destructive" },
};

const Facturas = () => {
  const navigate = useNavigate();
  const { formatPrice } = useCurrency();
  const [facturas, setFacturas] = useState<FacturaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [estadoFilter, setEstadoFilter] = useState("vigentes");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase.from("facturas")
        .select("id, numero, cliente_id, fecha_emision, moneda, total, total_usd, saldo_usd, estado_cobro, estado, motivo_anulacion, es_nota_debito, cliente:clientes(nombre_negocio)")
        // Las facturas no se eliminan: las anuladas siguen aquí (filtro "Anuladas") con su motivo
        .eq("tipo", "factura").in("estado", ["posted", "cancel"])
        .order("fecha_emision", { ascending: false })
        .limit(10000);
      setFacturas((data as unknown as FacturaRow[]) ?? []);
      setLoading(false);
    })();
  }, []);

  const filtradas = useMemo(() => facturas.filter((f) => {
    const matchQ = f.numero.toLowerCase().includes(search.toLowerCase()) || (f.cliente?.nombre_negocio || "").toLowerCase().includes(search.toLowerCase());
    const anulada = f.estado === "cancel" || f.estado_cobro === "anulado";
    const matchEstado = estadoFilter === "todas" || (estadoFilter === "anulado" ? anulada
      : !anulada && (estadoFilter === "vigentes" || f.estado_cobro === estadoFilter));
    return matchQ && matchEstado;
  }), [facturas, search, estadoFilter]);

  const { ordenadas, orden, alternar } = useOrdenTabla(filtradas, {
    numero: (f) => f.numero, cliente: (f) => f.cliente?.nombre_negocio, emision: (f) => f.fecha_emision, moneda: (f) => f.moneda,
    total: (f) => Number(f.total_usd || 0), saldo: (f) => Number(f.saldo_usd || 0),
  });
  const pagination = usePagination(ordenadas, 50);
  const exportar = () => exportarCSV("facturas", ordenadas, [
    { titulo: "Número", valor: (f) => f.numero }, { titulo: "Cliente", valor: (f) => f.cliente?.nombre_negocio }, { titulo: "Emisión", valor: (f) => f.fecha_emision },
    { titulo: "Moneda", valor: (f) => f.moneda }, { titulo: "Total USD", valor: (f) => Number(f.total_usd || 0) }, { titulo: "Saldo USD", valor: (f) => Number(f.saldo_usd || 0) },
    { titulo: "Estado", valor: (f) => (f.estado === "cancel" ? "Anulada" : ESTADO_COBRO[f.estado_cobro]?.label ?? f.estado_cobro) },
    { titulo: "Motivo de anulación", valor: (f) => f.motivo_anulacion },
  ]);
  const vigentes = facturas.filter((f) => f.estado !== "cancel");
  const totalSaldo = filtradas.filter((f) => f.estado !== "cancel").reduce((s, f) => s + Number(f.saldo_usd || 0), 0);
  const fmtFecha = (d: string | null) => (d ? new Date(d).toLocaleDateString("es-VE", { day: "2-digit", month: "short", year: "numeric" }) : "—");

  const cols = useColumnas("facturas", [{ etiqueta: "Nº", fija: true }, { etiqueta: "Cliente" }, { etiqueta: "Emisión" }, { etiqueta: "Moneda" }, { etiqueta: "Total" }, { etiqueta: "Saldo" }, { etiqueta: "Estado" }]);
  return (
    <MainLayout title="Facturas">
      {cols.estilo}
      <KpiStrip items={[
        { label: "Facturas vigentes", valor: vigentes.length },
        { label: "Saldo pendiente (filtro actual)", valor: formatPrice(totalSaldo), tono: "negativo" },
        { label: "Pagadas", valor: vigentes.filter((f) => f.estado_cobro === "pagado").length, tono: "positivo" },
        { label: "Anuladas", valor: facturas.length - vigentes.length, detalle: "Se conservan con su motivo", onClick: () => setEstadoFilter("anulado") },
      ]} />

      <BarraLista
        busqueda={search}
        onBusqueda={setSearch}
        placeholder="Buscar por número o cliente..."
        filtros={
          <Select value={estadoFilter} onValueChange={setEstadoFilter}>
            <SelectTrigger className="h-8 w-40 text-[13px]"><SelectValue placeholder="Estado" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="vigentes">Vigentes</SelectItem>
              <SelectItem value="todas">Todas (con anuladas)</SelectItem>
              <SelectItem value="pendiente">Pendiente</SelectItem>
              <SelectItem value="parcial">Parcial</SelectItem>
              <SelectItem value="pagado">Pagada</SelectItem>
              <SelectItem value="anulado">Anulada</SelectItem>
            </SelectContent>
          </Select>
        }
        contador={`${filtradas.length} registros`}
        acciones={<>{cols.selector}<BotonExportar onClick={exportar} total={ordenadas.length} /></>}
      />

      <div className="rounded-lg border border-border bg-card">
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : filtradas.length === 0 ? (
          <div className="flex flex-col items-center py-10 text-muted-foreground"><FileText className="mb-2 h-8 w-8 opacity-50" />No hay facturas</div>
        ) : (
          <Table data-tabla="facturas">
            <TableHeader>
              <TableRow>
                <EncabezadoOrdenable clave="numero" orden={orden} onOrdenar={alternar}>Nº</EncabezadoOrdenable><EncabezadoOrdenable clave="cliente" orden={orden} onOrdenar={alternar}>Cliente</EncabezadoOrdenable><EncabezadoOrdenable clave="emision" orden={orden} onOrdenar={alternar}>Emisión</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="moneda" orden={orden} onOrdenar={alternar}>Moneda</EncabezadoOrdenable><EncabezadoOrdenable clave="total" orden={orden} onOrdenar={alternar} alinear="derecha">Total</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="saldo" orden={orden} onOrdenar={alternar} alinear="derecha">Saldo</EncabezadoOrdenable><TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagination.pageItems.map((f) => (
                <TableRow key={f.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/admin/facturas/${f.id}`)}>
                  <TableCell className="font-mono text-xs text-primary">
                    <span className="flex items-center gap-1.5 whitespace-nowrap">{f.numero}{f.es_nota_debito && <Badge variant="outline" className="px-1 py-0 font-sans text-[10px]">ND</Badge>}</span>
                  </TableCell>
                  <TableCell className="font-medium"><span className="block max-w-[260px] truncate" title={f.cliente?.nombre_negocio || undefined}>{f.cliente?.nombre_negocio || "—"}</span></TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{fmtFecha(f.fecha_emision)}</TableCell>
                  <TableCell className="text-muted-foreground">{f.moneda}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">{formatPrice(f.total_usd)}</TableCell>
                  <TableCell className={`whitespace-nowrap text-right font-semibold ${f.estado !== "cancel" && f.saldo_usd > 0.009 ? "text-destructive" : ""}`}>{f.estado === "cancel" ? "—" : formatPrice(f.saldo_usd)}</TableCell>
                  <TableCell>
                    {f.estado === "cancel"
                      ? <Badge variant="destructive" title={f.motivo_anulacion || undefined}>Anulada</Badge>
                      : <Badge variant={ESTADO_COBRO[f.estado_cobro]?.variant ?? "secondary"}>{ESTADO_COBRO[f.estado_cobro]?.label ?? f.estado_cobro}</Badge>}
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

export default Facturas;
