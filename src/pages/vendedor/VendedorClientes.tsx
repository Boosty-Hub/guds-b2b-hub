import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { VendedorLayout } from "@/components/vendedor/VendedorLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, Phone } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useAuth } from "@/contexts/AuthContext";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { BarraLista } from "@/components/datos/BarraLista";
import { useOrdenTabla, EncabezadoOrdenable } from "@/components/datos/tabla";

interface Cli {
  id: string; codigo: string; nombre_negocio: string; ciudad: string;
  telefono: string | null; limite_credito: number; saldo: number;
}

const VendedorClientes = () => {
  const { formatPrice } = useCurrency();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [clientes, setClientes] = useState<Cli[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(params.get("q") || "");
  const [soloDeuda, setSoloDeuda] = useState(false);
  // El buscador global abre esta página con ?q=
  useEffect(() => { const q = params.get("q"); if (q !== null) setSearch(q); }, [params]);

  const fetchClientes = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    // Solo los clientes asignados a este vendedor
    const { data } = await supabase
      .from("clientes")
      .select("id, codigo, nombre_negocio, ciudad, telefono, limite_credito")
      .eq("activo", true)
      .eq("vendedor_asignado_id", user.id)
      .order("nombre_negocio");
    const lista = (data ?? []) as Omit<Cli, "saldo">[];
    const ids = lista.map((c) => c.id);

    // Deuda real = suma de facturas.saldo_usd (Fase 11 — ya no ordenes/cuentas_cobrar, deprecadas)
    const saldos = new Map<string, number>();
    if (ids.length) {
      const { data: facs } = await supabase.from("facturas").select("cliente_id, saldo_usd").in("cliente_id", ids).eq("estado", "posted");
      for (const f of (facs ?? []) as { cliente_id: string; saldo_usd: number }[]) {
        saldos.set(f.cliente_id, (saldos.get(f.cliente_id) || 0) + Number(f.saldo_usd));
      }
    }
    setClientes(lista.map((c) => ({ ...c, saldo: saldos.get(c.id) || 0 })));
    setLoading(false);
  }, [user?.id]);
  useEffect(() => { fetchClientes(); }, [fetchClientes]);

  const totalSaldo = clientes.reduce((s, c) => s + Math.max(0, Number(c.saldo || 0)), 0);
  const conSaldo = clientes.filter((c) => Number(c.saldo) > 0.009).length;
  const excedidos = clientes.filter((c) => Number(c.limite_credito) > 0 && Number(c.saldo) > Number(c.limite_credito)).length;

  const texto = search.trim().toLowerCase();
  const filtrados = clientes.filter((c) =>
    (!soloDeuda || Number(c.saldo) > 0.009) &&
    (!texto || c.nombre_negocio.toLowerCase().includes(texto) || (c.codigo || "").toLowerCase().includes(texto) || (c.ciudad || "").toLowerCase().includes(texto)));
  const { ordenadas, orden, alternar } = useOrdenTabla(filtrados, {
    nombre: (c) => c.nombre_negocio, ciudad: (c) => c.ciudad, limite: (c) => Number(c.limite_credito || 0), saldo: (c) => Number(c.saldo || 0),
  });
  const pagination = usePagination(ordenadas, 50);

  return (
    <VendedorLayout title="Mis Clientes">
      <KpiStrip items={[
        { label: "Clientes asignados", valor: clientes.length, tono: "primario", onClick: () => setSoloDeuda(false), activo: !soloDeuda },
        { label: "Con saldo pendiente", valor: conSaldo, tono: conSaldo ? "alerta" : "normal", onClick: () => setSoloDeuda(true), activo: soloDeuda },
        { label: "Saldo total de cartera", valor: formatPrice(totalSaldo), tono: totalSaldo > 0 ? "negativo" : "normal" },
        { label: "Sobre su límite", valor: excedidos, tono: excedidos ? "negativo" : "normal" },
      ]} />

      <BarraLista busqueda={search} onBusqueda={setSearch} placeholder="Buscar cliente, código o ciudad..."
        contador={loading ? undefined : `${filtrados.length} registros`} />

      <div className="rounded-lg border border-border bg-card">
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-emerald-500" /></div>
        ) : filtrados.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">{clientes.length ? `Sin resultados${texto ? ` para "${search.trim()}"` : ""}` : "No tienes clientes asignados"}</div>
        ) : (
          <Table>
            <TableHeader><TableRow>
              <EncabezadoOrdenable clave="nombre" orden={orden} onOrdenar={alternar}>Cliente</EncabezadoOrdenable>
              <TableHead className="hidden sm:table-cell">Código</TableHead>
              <EncabezadoOrdenable clave="ciudad" orden={orden} onOrdenar={alternar} className="hidden md:table-cell">Ciudad</EncabezadoOrdenable>
              <EncabezadoOrdenable clave="limite" orden={orden} onOrdenar={alternar} alinear="derecha" className="hidden md:table-cell">Línea de crédito</EncabezadoOrdenable>
              <EncabezadoOrdenable clave="saldo" orden={orden} onOrdenar={alternar} alinear="derecha">Saldo</EncabezadoOrdenable>
              <TableHead>Estado</TableHead><TableHead className="text-right">Contacto</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {pagination.pageItems.map((c) => {
                const saldo = Number(c.saldo || 0);
                const excedido = Number(c.limite_credito) > 0 && saldo > Number(c.limite_credito);
                const conDeuda = saldo > 0.009;
                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium"><span className="block max-w-[280px] truncate" title={c.nombre_negocio}>{c.nombre_negocio}</span></TableCell>
                    <TableCell className="hidden whitespace-nowrap font-mono text-xs text-muted-foreground sm:table-cell">{c.codigo}</TableCell>
                    <TableCell className="hidden whitespace-nowrap text-muted-foreground md:table-cell">{c.ciudad}</TableCell>
                    <TableCell className="hidden whitespace-nowrap text-right md:table-cell">{Number(c.limite_credito) > 0 ? formatPrice(Number(c.limite_credito)) : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className={`whitespace-nowrap text-right font-semibold ${conDeuda ? "text-destructive" : ""}`}>{formatPrice(saldo)}</TableCell>
                    <TableCell className="whitespace-nowrap"><Badge variant={excedido ? "destructive" : conDeuda ? "secondary" : "default"}>{excedido ? "Excedido" : conDeuda ? "Con deuda" : "Al día"}</Badge></TableCell>
                    <TableCell className="text-right">
                      {c.telefono ? <Button size="icon" variant="ghost" className="h-7 w-7" title={`Llamar ${c.telefono}`} onClick={() => window.open(`tel:${c.telefono}`, "_self")}><Phone className="h-3.5 w-3.5" /></Button> : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {!loading && filtrados.length > 0 && <DataTablePagination pagination={pagination} />}
      </div>
    </VendedorLayout>
  );
};

export default VendedorClientes;
