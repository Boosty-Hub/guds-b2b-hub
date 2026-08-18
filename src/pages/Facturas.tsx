import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Loader2, FileText } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";

interface FacturaRow {
  id: string; numero: string; cliente_id: string; fecha_emision: string | null;
  moneda: string; total: number; total_usd: number; saldo_usd: number; estado_cobro: string;
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
  const [estadoFilter, setEstadoFilter] = useState("all");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase.from("facturas")
        .select("id, numero, cliente_id, fecha_emision, moneda, total, total_usd, saldo_usd, estado_cobro, cliente:clientes(nombre_negocio)")
        .eq("tipo", "factura").eq("estado", "posted")
        .order("fecha_emision", { ascending: false })
        .limit(10000);
      setFacturas((data as FacturaRow[]) ?? []);
      setLoading(false);
    })();
  }, []);

  const filtradas = useMemo(() => facturas.filter((f) => {
    const matchQ = f.numero.toLowerCase().includes(search.toLowerCase()) || (f.cliente?.nombre_negocio || "").toLowerCase().includes(search.toLowerCase());
    const matchEstado = estadoFilter === "all" || f.estado_cobro === estadoFilter;
    return matchQ && matchEstado;
  }), [facturas, search, estadoFilter]);

  const pagination = usePagination(filtradas, 25);
  const totalSaldo = filtradas.reduce((s, f) => s + Number(f.saldo_usd || 0), 0);
  const fmtFecha = (d: string | null) => (d ? new Date(d).toLocaleDateString("es-VE", { day: "2-digit", month: "short", year: "numeric" }) : "—");

  return (
    <MainLayout title="Facturas">
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-2xl font-bold">{facturas.length}</p>
          <p className="text-sm text-muted-foreground">Facturas</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-2xl font-bold text-destructive">{formatPrice(totalSaldo)}</p>
          <p className="text-sm text-muted-foreground">Saldo pendiente (filtro actual)</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-2xl font-bold">{facturas.filter((f) => f.estado_cobro === "pagado").length}</p>
          <p className="text-sm text-muted-foreground">Pagadas</p>
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar por número o cliente..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={estadoFilter} onValueChange={setEstadoFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Estado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="pendiente">Pendiente</SelectItem>
            <SelectItem value="parcial">Parcial</SelectItem>
            <SelectItem value="pagado">Pagada</SelectItem>
            <SelectItem value="anulado">Anulada</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-xl border border-border bg-card shadow-sm">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : filtradas.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-muted-foreground"><FileText className="mb-3 h-10 w-10 opacity-50" />No hay facturas</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nº</TableHead><TableHead>Cliente</TableHead><TableHead>Emisión</TableHead>
                <TableHead>Moneda</TableHead><TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Saldo</TableHead><TableHead>Estado</TableHead>
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
                  <TableCell className={`text-right font-semibold ${f.saldo_usd > 0.009 ? "text-destructive" : ""}`}>{formatPrice(f.saldo_usd)}</TableCell>
                  <TableCell><Badge variant={ESTADO_COBRO[f.estado_cobro]?.variant ?? "secondary"}>{ESTADO_COBRO[f.estado_cobro]?.label ?? f.estado_cobro}</Badge></TableCell>
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
