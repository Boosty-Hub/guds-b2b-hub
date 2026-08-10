import { useState, useEffect } from "react";
import { VendedorLayout } from "@/components/vendedor/VendedorLayout";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search, Package, Warehouse, Loader2 } from "lucide-react";
import { supabase, Producto } from "@/lib/supabase";

// Vista de solo lectura para el vendedor: mismo stock que ve el admin en
// Inventario.tsx, pero sin la pestaña de Movimientos (movimientos_inventario
// está gateado por el permiso "inventario" que un vendedor no tiene — fase5
// permisos_rls.sql — así que esa pestaña le devolvería siempre vacío) y sin
// costo (fase0b_ajustes.sql solo le revoca esa columna a anon, no a un
// vendedor autenticado, así que se oculta aquí en la UI).
const VendedorInventario = () => {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const { data } = await supabase.from('productos').select('*').order('nombre');
    if (data) setProductos(data);
    setLoading(false);
  };

  const filteredProductos = productos.filter(p =>
    p.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.sku.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const stats = {
    total: productos.length,
    bajoMinimo: productos.filter(p => p.stock_actual > 0 && p.stock_actual <= p.stock_minimo).length,
    agotados: productos.filter(p => p.stock_actual === 0).length,
  };

  return (
    <VendedorLayout title="Inventario">
      <div className="mb-6 grid gap-4 grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <Warehouse className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.total}</p>
              <p className="text-sm text-muted-foreground">Productos</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-warning/10 p-2">
              <Package className="h-5 w-5 text-warning" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.bajoMinimo}</p>
              <p className="text-sm text-muted-foreground">Bajo Mínimo</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-destructive/10 p-2">
              <Package className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.agotados}</p>
              <p className="text-sm text-muted-foreground">Agotados</p>
            </div>
          </div>
        </div>
      </div>

      <div className="relative max-w-md mb-4">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar producto..."
          className="pl-9"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="rounded-xl border border-border bg-card shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Producto</TableHead>
                <TableHead className="text-center">Stock</TableHead>
                <TableHead className="text-center">Mínimo</TableHead>
                <TableHead className="text-center">Máximo</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredProductos.map((item) => {
                const status = item.stock_actual === 0 ? "agotado" : item.stock_actual <= item.stock_minimo ? "bajo" : "ok";
                return (
                  <TableRow key={item.id} className="hover:bg-muted/50">
                    <TableCell className="font-mono text-sm text-primary">{item.sku}</TableCell>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {item.imagen_emoji && <span>{item.imagen_emoji}</span>}
                        {item.nombre}
                      </div>
                    </TableCell>
                    <TableCell className="text-center font-semibold">{item.stock_actual}</TableCell>
                    <TableCell className="text-center text-muted-foreground">{item.stock_minimo}</TableCell>
                    <TableCell className="text-center text-muted-foreground">{item.stock_maximo || '-'}</TableCell>
                    <TableCell>
                      <Badge variant={status === "ok" ? "default" : status === "bajo" ? "secondary" : "destructive"}>
                        {status === "ok" ? "OK" : status === "bajo" ? "Bajo" : "Agotado"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </VendedorLayout>
  );
};

export default VendedorInventario;
