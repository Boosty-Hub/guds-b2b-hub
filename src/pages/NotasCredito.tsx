import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Loader2, FileMinus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";

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
      setNotas((data as FacturaRow[]) ?? []);
      setLoading(false);
    })();
  }, []);

  const filtradas = useMemo(() => notas.filter((f) =>
    f.numero.toLowerCase().includes(search.toLowerCase()) || (f.cliente?.nombre_negocio || "").toLowerCase().includes(search.toLowerCase())
  ), [notas, search]);

  const pagination = usePagination(filtradas, 25);
  const totalCredito = filtradas.reduce((s, f) => s + Math.abs(Number(f.saldo_usd || 0)), 0);
  const fmtFecha = (d: string | null) => (d ? new Date(d).toLocaleDateString("es-VE", { day: "2-digit", month: "short", year: "numeric" }) : "—");

  return (
    <MainLayout title="Notas de Crédito">
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-2xl font-bold">{notas.length}</p>
          <p className="text-sm text-muted-foreground">Notas de crédito</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-2xl font-bold text-success">{formatPrice(totalCredito)}</p>
          <p className="text-sm text-muted-foreground">Crédito disponible sin aplicar (filtro actual)</p>
        </div>
      </div>

      <div className="relative mb-4 max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Buscar por número o cliente..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="rounded-xl border border-border bg-card shadow-sm">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : filtradas.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-muted-foreground"><FileMinus className="mb-3 h-10 w-10 opacity-50" />No hay notas de crédito</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nº</TableHead><TableHead>Cliente</TableHead><TableHead>Emisión</TableHead>
                <TableHead>Moneda</TableHead><TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Saldo (a favor del cliente)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagination.pageItems.map((f) => (
                <TableRow key={f.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/admin/facturas/${f.id}`)}>
                  <TableCell className="font-mono text-sm text-primary">{f.numero}</TableCell>
                  <TableCell className="font-medium">{f.cliente?.nombre_negocio || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtFecha(f.fecha_emision)}</TableCell>
                  <TableCell className="text-muted-foreground">{f.moneda}</TableCell>
                  <TableCell className="text-right">{formatPrice(f.total_usd)}</TableCell>
                  <TableCell className="text-right font-semibold text-success">{formatPrice(Math.abs(f.saldo_usd))}</TableCell>
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
