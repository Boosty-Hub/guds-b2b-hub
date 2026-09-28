import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { VendedorLayout } from "@/components/vendedor/VendedorLayout";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2 } from "lucide-react";
import { supabase, Producto } from "@/lib/supabase";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { BarraLista } from "@/components/datos/BarraLista";
import { useOrdenTabla, EncabezadoOrdenable } from "@/components/datos/tabla";

// Vista de solo lectura para el vendedor: el DISPONIBLE para vender (existencia − comprometido en entregas de Odoo y
// pedidos de GUDS), igual que valida el servidor al crear el pedido. Sin movimientos (movimientos_inventario está
// gateado por el permiso "inventario" que un vendedor no tiene) y sin costo.
const VendedorInventario = () => {
  const [params] = useSearchParams();
  const [productos, setProductos] = useState<Producto[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState(params.get("q") || "");
  const [filtro, setFiltro] = useState<"todos" | "disponibles" | "agotados">("todos");
  // El buscador global abre esta página con ?q=
  useEffect(() => { const q = params.get("q"); if (q !== null) setSearchTerm(q); }, [params]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase.from('productos').select('*').eq('activo', true).order('nombre');
      if (data) setProductos(data);
      setLoading(false);
    })();
  }, []);

  const disponible = (p: Producto) => Number(p.stock_disponible ?? p.stock_actual ?? 0);
  const esServicio = (p: Producto) => p.controla_stock === false;
  const almacenables = productos.filter((p) => !esServicio(p));
  const stats = {
    total: almacenables.length,
    disponibles: almacenables.filter((p) => disponible(p) > 0).length,
    agotados: almacenables.filter((p) => disponible(p) <= 0).length,
    comprometidos: almacenables.filter((p) => Number(p.comprometido_odoo || 0) + Number(p.comprometido_guds || 0) > 0).length,
  };

  const texto = searchTerm.trim().toLowerCase();
  const filtrados = productos.filter((p) =>
    (filtro === "todos" || (!esServicio(p) && (filtro === "disponibles" ? disponible(p) > 0 : disponible(p) <= 0))) &&
    (!texto || p.nombre.toLowerCase().includes(texto) || (p.sku || "").toLowerCase().includes(texto)));
  const { ordenadas, orden, alternar } = useOrdenTabla(filtrados, {
    sku: (p) => p.sku, nombre: (p) => p.nombre, stock: (p) => Number(p.stock_actual || 0), disponible: (p) => (esServicio(p) ? null : disponible(p)),
  });
  const pagination = usePagination(ordenadas, 50);

  return (
    <VendedorLayout title="Inventario">
      <KpiStrip items={[
        { label: "Productos", valor: stats.total, tono: "primario", onClick: () => setFiltro("todos"), activo: filtro === "todos" },
        { label: "Con disponible", valor: stats.disponibles, tono: "positivo", onClick: () => setFiltro("disponibles"), activo: filtro === "disponibles" },
        { label: "Sin disponible", valor: stats.agotados, tono: stats.agotados ? "negativo" : "normal", onClick: () => setFiltro("agotados"), activo: filtro === "agotados" },
        { label: "Con pedidos en curso", valor: stats.comprometidos, detalle: "parte comprometida", tono: "tenue" },
      ]} />

      <BarraLista busqueda={searchTerm} onBusqueda={setSearchTerm} placeholder="Buscar producto o SKU..."
        contador={loading ? undefined : `${filtrados.length} registros`} />

      <div className="rounded-lg border border-border bg-card">
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-emerald-700" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <EncabezadoOrdenable clave="sku" orden={orden} onOrdenar={alternar} className="hidden sm:table-cell">SKU</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="nombre" orden={orden} onOrdenar={alternar}>Producto</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="stock" orden={orden} onOrdenar={alternar} alinear="derecha" className="hidden md:table-cell">Existencia</EncabezadoOrdenable>
                <TableHead className="hidden text-right md:table-cell">Comprometido</TableHead>
                <EncabezadoOrdenable clave="disponible" orden={orden} onOrdenar={alternar} alinear="derecha">Disponible</EncabezadoOrdenable>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagination.pageItems.map((item) => {
                const servicio = esServicio(item);
                const disp = disponible(item);
                const comprometido = Number(item.comprometido_odoo || 0) + Number(item.comprometido_guds || 0);
                return (
                  <TableRow key={item.id}>
                    <TableCell className="hidden whitespace-nowrap font-mono text-xs text-primary sm:table-cell">{item.sku}</TableCell>
                    <TableCell className="font-medium">
                      <span className="block max-w-[340px] truncate" title={item.nombre}>{item.imagen_emoji && <span className="mr-1.5">{item.imagen_emoji}</span>}{item.nombre}</span>
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap text-right text-muted-foreground md:table-cell">{servicio ? "—" : Number(item.stock_actual).toLocaleString("es-VE")}</TableCell>
                    <TableCell className="hidden whitespace-nowrap text-right text-muted-foreground md:table-cell">{!servicio && comprometido > 0 ? comprometido.toLocaleString("es-VE") : "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-semibold">{servicio ? <span className="text-xs font-normal text-muted-foreground">Sin tope</span> : disp.toLocaleString("es-VE")}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {servicio ? <Badge variant="outline">Servicio</Badge>
                        : disp <= 0 ? <Badge variant="destructive">Sin disponible</Badge>
                        : item.stock_minimo > 0 && disp <= item.stock_minimo ? <Badge variant="secondary">Bajo</Badge>
                        : <Badge>Disponible</Badge>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {!loading && <DataTablePagination pagination={pagination} />}
      </div>
    </VendedorLayout>
  );
};

export default VendedorInventario;
