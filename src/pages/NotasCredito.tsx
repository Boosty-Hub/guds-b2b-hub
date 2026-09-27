import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
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

interface FacturaRow {
  id: string; numero: string; cliente_id: string; fecha_emision: string | null;
  moneda: string; total_usd: number; saldo_usd: number;
  cliente?: { nombre_negocio: string } | null;
}

const NotasCredito = () => {
  const navigate = useNavigate();
  const { formatPrice } = useCurrency();
  const [notas, setNotas] = useState<FacturaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase.from("facturas")
        .select("id, numero, cliente_id, fecha_emision, moneda, total_usd, saldo_usd, cliente:clientes(nombre_negocio)")
        .eq("tipo", "nota_credito").eq("estado", "posted")
        .order("fecha_emision", { ascending: false })
        .limit(10000);
      setNotas((data as unknown as FacturaRow[]) ?? []);
      setLoading(false);
    })();
  }, []);

  const filtradas = useMemo(() => notas.filter((f) =>
    f.numero.toLowerCase().includes(search.toLowerCase()) || (f.cliente?.nombre_negocio || "").toLowerCase().includes(search.toLowerCase())
  ), [notas, search]);

  const { ordenadas, orden, alternar } = useOrdenTabla(filtradas, {
    numero: (f) => f.numero, cliente: (f) => f.cliente?.nombre_negocio, emision: (f) => f.fecha_emision, moneda: (f) => f.moneda,
    total: (f) => Number(f.total_usd || 0), saldo: (f) => Number(f.saldo_usd || 0),
  });
  const pagination = usePagination(ordenadas, 50);
  const exportar = () => exportarCSV("notas-credito", ordenadas, [
    { titulo: "Número", valor: (f) => f.numero }, { titulo: "Cliente", valor: (f) => f.cliente?.nombre_negocio }, { titulo: "Emisión", valor: (f) => f.fecha_emision },
    { titulo: "Moneda", valor: (f) => f.moneda }, { titulo: "Total USD", valor: (f) => Number(f.total_usd || 0) }, { titulo: "Saldo USD", valor: (f) => Number(f.saldo_usd || 0) },
  ]);
  const totalCredito = filtradas.reduce((s, f) => s + Math.abs(Number(f.saldo_usd || 0)), 0);
  const fmtFecha = (d: string | null) => (d ? new Date(d).toLocaleDateString("es-VE", { day: "2-digit", month: "short", year: "numeric" }) : "—");

  const cols = useColumnas("notas-credito", [{ etiqueta: "Nº", fija: true }, { etiqueta: "Cliente" }, { etiqueta: "Emisión" }, { etiqueta: "Moneda" }, { etiqueta: "Total" }, { etiqueta: "Saldo (a favor del cliente)" }]);
  return (
    <MainLayout title="Notas de Crédito">
      {cols.estilo}
      <KpiStrip items={[
        { label: "Notas de crédito", valor: notas.length },
        { label: "Crédito disponible sin aplicar (filtro actual)", valor: formatPrice(totalCredito), tono: "positivo" },
      ]} />

      <BarraLista
        busqueda={search}
        onBusqueda={setSearch}
        placeholder="Buscar por número o cliente..."
        contador={`${filtradas.length} registros`}
        acciones={<>{cols.selector}<BotonExportar onClick={exportar} total={ordenadas.length} /></>}
      />

      <div className="rounded-lg border border-border bg-card">
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : filtradas.length === 0 ? (
          <div className="flex flex-col items-center py-10 text-muted-foreground"><FileMinus className="mb-2 h-8 w-8 opacity-50" />No hay notas de crédito</div>
        ) : (
          <Table data-tabla="notas-credito">
            <TableHeader>
              <TableRow>
                <EncabezadoOrdenable clave="numero" orden={orden} onOrdenar={alternar}>Nº</EncabezadoOrdenable><EncabezadoOrdenable clave="cliente" orden={orden} onOrdenar={alternar}>Cliente</EncabezadoOrdenable><EncabezadoOrdenable clave="emision" orden={orden} onOrdenar={alternar}>Emisión</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="moneda" orden={orden} onOrdenar={alternar}>Moneda</EncabezadoOrdenable><EncabezadoOrdenable clave="total" orden={orden} onOrdenar={alternar} alinear="derecha">Total</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="saldo" orden={orden} onOrdenar={alternar} alinear="derecha">Saldo (a favor del cliente)</EncabezadoOrdenable>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagination.pageItems.map((f) => (
                <TableRow key={f.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/admin/facturas/${f.id}`)}>
                  <TableCell className="whitespace-nowrap font-mono text-xs text-primary">{f.numero}</TableCell>
                  <TableCell className="font-medium"><span className="block max-w-[260px] truncate" title={f.cliente?.nombre_negocio || undefined}>{f.cliente?.nombre_negocio || "—"}</span></TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{fmtFecha(f.fecha_emision)}</TableCell>
                  <TableCell className="text-muted-foreground">{f.moneda}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">{formatPrice(f.total_usd)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-semibold text-success">{formatPrice(Math.abs(f.saldo_usd))}</TableCell>
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
