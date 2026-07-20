import { useState, useEffect, useCallback } from "react";
import { VendedorLayout } from "@/components/vendedor/VendedorLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Search, Users, Loader2, Phone } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useAuth } from "@/contexts/AuthContext";

interface Cli {
  id: string; codigo: string; nombre_negocio: string; ciudad: string;
  telefono: string | null; limite_credito: number; credito_utilizado: number;
}

const VendedorClientes = () => {
  const { formatPrice } = useCurrency();
  const { user } = useAuth();
  const [clientes, setClientes] = useState<Cli[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const fetchClientes = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    // Solo los clientes asignados a este vendedor
    const { data } = await supabase
      .from("clientes")
      .select("id, codigo, nombre_negocio, ciudad, telefono, limite_credito, credito_utilizado")
      .eq("activo", true)
      .eq("vendedor_asignado_id", user.id)
      .order("nombre_negocio");
    if (data) setClientes(data as Cli[]);
    setLoading(false);
  }, [user?.id]);
  useEffect(() => { fetchClientes(); }, [fetchClientes]);

  const totalSaldo = clientes.reduce((s, c) => s + Number(c.credito_utilizado || 0), 0);
  const conSaldo = clientes.filter((c) => Number(c.credito_utilizado) > 0).length;

  const filtrados = clientes.filter((c) =>
    c.nombre_negocio.toLowerCase().includes(search.toLowerCase()) || c.codigo.toLowerCase().includes(search.toLowerCase()));

  return (
    <VendedorLayout title="Mis Clientes">
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="border-border"><CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-emerald-500/10 flex items-center justify-center"><Users className="h-5 w-5 text-emerald-500" /></div>
            <div><p className="text-2xl font-bold">{clientes.length}</p><p className="text-sm text-muted-foreground">Clientes asignados</p></div>
          </CardContent></Card>
          <Card className="border-border"><CardContent className="p-4"><p className="text-2xl font-bold">{conSaldo}</p><p className="text-sm text-muted-foreground">Con saldo pendiente</p></CardContent></Card>
          <Card className="border-border"><CardContent className="p-4"><p className="text-2xl font-bold">{formatPrice(totalSaldo)}</p><p className="text-sm text-muted-foreground">Saldo total de cartera</p></CardContent></Card>
        </div>

        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar cliente..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        <div className="rounded-xl border border-border bg-card">
          {loading ? (
            <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-emerald-500" /></div>
          ) : filtrados.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">No tienes clientes asignados</div>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Cliente</TableHead><TableHead>Ciudad</TableHead>
                <TableHead className="text-right">Línea de crédito</TableHead>
                <TableHead className="text-right">Saldo pendiente</TableHead>
                <TableHead>Estado</TableHead><TableHead className="text-right">Contacto</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filtrados.map((c) => {
                  const disp = Number(c.limite_credito) - Number(c.credito_utilizado);
                  const excedido = Number(c.credito_utilizado) > Number(c.limite_credito);
                  return (
                    <TableRow key={c.id} className="hover:bg-muted/50">
                      <TableCell><p className="font-medium">{c.nombre_negocio}</p><p className="text-xs text-muted-foreground">{c.codigo}</p></TableCell>
                      <TableCell className="text-muted-foreground">{c.ciudad}</TableCell>
                      <TableCell className="text-right">{formatPrice(Number(c.limite_credito))}</TableCell>
                      <TableCell className={`text-right font-semibold ${Number(c.credito_utilizado) > 0 ? "text-destructive" : ""}`}>{formatPrice(Number(c.credito_utilizado))}</TableCell>
                      <TableCell><Badge variant={excedido ? "destructive" : disp > 0 ? "default" : "secondary"}>{excedido ? "Excedido" : "Al día"}</Badge></TableCell>
                      <TableCell className="text-right">
                        {c.telefono ? <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => window.open(`tel:${c.telefono}`, "_self")}><Phone className="h-4 w-4" /></Button> : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </VendedorLayout>
  );
};

export default VendedorClientes;
