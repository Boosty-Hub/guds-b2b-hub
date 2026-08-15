import { useState, useEffect, useMemo, Fragment } from "react";
import { cn } from "@/lib/utils";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Search, ArrowUpRight, ArrowDownLeft, Package, Warehouse, Loader2, RefreshCw, ChevronRight, Boxes } from "lucide-react";
import { supabase, Producto } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";

interface MovimientoInventario {
  id: string;
  producto_id: string;
  tipo: string;
  cantidad: number;
  stock_anterior: number;
  stock_nuevo: number;
  motivo: string | null;
  referencia_tipo: string | null;
  created_at: string;
  producto?: Producto;
}

interface InvAlmacenRow {
  id: string;
  cantidad: number;
  almacen: { id: string; nombre: string; tipo: string } | null;
  producto: { id: string; nombre: string; sku: string } | null;
}

const Inventario = () => {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [movimientos, setMovimientos] = useState<MovimientoInventario[]>([]);
  const [invAlmacen, setInvAlmacen] = useState<InvAlmacenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [movementSearchTerm, setMovementSearchTerm] = useState("");
  const [tipoFiltro, setTipoFiltro] = useState("all");
  const [almSearch, setAlmSearch] = useState("");
  const [openAlm, setOpenAlm] = useState<Set<string>>(new Set());
  const toggleAlm = (k: string) => setOpenAlm((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  
  // Estados para diálogos
  const [isMovementOpen, setIsMovementOpen] = useState(false);
  const [movementType, setMovementType] = useState<'entrada' | 'salida' | 'ajuste'>('entrada');
  const [selectedProductoId, setSelectedProductoId] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [motivo, setMotivo] = useState("");
  const [saving, setSaving] = useState(false);
  
  const { toast } = useToast();
  const { user } = useAuth();

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const [productosRes, movimientosRes, invAlmRes] = await Promise.all([
      supabase.from('productos').select('*').order('nombre'),
      supabase.from('movimientos_inventario').select('*, producto:productos(nombre, sku)').order('created_at', { ascending: false }).limit(50),
      supabase.from('inventario_almacen').select('id, cantidad, almacen:almacenes(id, nombre, tipo), producto:productos(id, nombre, sku)').limit(5000),
    ]);

    if (productosRes.data) setProductos(productosRes.data);
    if (movimientosRes.data) setMovimientos(movimientosRes.data);
    if (invAlmRes.data) setInvAlmacen(invAlmRes.data as unknown as InvAlmacenRow[]);
    setLoading(false);
  };

  const filteredProductos = productos.filter(p =>
    p.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.sku.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const pagination = usePagination(filteredProductos, 25);

  const filteredMovimientos = movimientos.filter(m => {
    const matchesSearch = movementSearchTerm === "" ||
      (m.producto as any)?.nombre?.toLowerCase().includes(movementSearchTerm.toLowerCase()) ||
      (m.producto as any)?.sku?.toLowerCase().includes(movementSearchTerm.toLowerCase());
    const matchesTipo = tipoFiltro === "all" || m.tipo === tipoFiltro;
    return matchesSearch && matchesTipo;
  });

  const pagination2 = usePagination(filteredMovimientos, 25);

  const gruposAlm = useMemo(() => {
    const m = new Map<string, { key: string; nombre: string; tipo: string; items: InvAlmacenRow[]; total: number }>();
    const q = almSearch.toLowerCase();
    for (const r of invAlmacen) {
      if (!r.almacen) continue;
      if (q && !(r.almacen.nombre.toLowerCase().includes(q) || r.producto?.nombre?.toLowerCase().includes(q) || r.producto?.sku?.toLowerCase().includes(q))) continue;
      const key = r.almacen.id;
      const g = m.get(key) || { key, nombre: r.almacen.nombre, tipo: r.almacen.tipo, items: [], total: 0 };
      g.items.push(r); g.total += Number(r.cantidad || 0);
      m.set(key, g);
    }
    return [...m.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [invAlmacen, almSearch]);

  const openMovementDialog = (type: 'entrada' | 'salida' | 'ajuste') => {
    setMovementType(type);
    setSelectedProductoId("");
    setCantidad("");
    setMotivo("");
    setIsMovementOpen(true);
  };

  const handleMovement = async () => {
    if (!selectedProductoId || !cantidad) {
      toast({ title: "Error", description: "Selecciona un producto y cantidad", variant: "destructive" });
      return;
    }

    const cantidadNum = parseInt(cantidad);
    if (isNaN(cantidadNum) || cantidadNum <= 0) {
      toast({ title: "Error", description: "La cantidad debe ser un número positivo", variant: "destructive" });
      return;
    }

    const producto = productos.find(p => p.id === selectedProductoId);
    if (!producto) return;

    setSaving(true);

    try {
      let nuevoStock: number;
      
      if (movementType === 'entrada') {
        nuevoStock = producto.stock_actual + cantidadNum;
      } else if (movementType === 'salida') {
        if (cantidadNum > producto.stock_actual) {
          toast({ title: "Error", description: "No hay suficiente stock disponible", variant: "destructive" });
          setSaving(false);
          return;
        }
        nuevoStock = producto.stock_actual - cantidadNum;
      } else {
        // Ajuste: la cantidad es el nuevo stock
        nuevoStock = cantidadNum;
      }

      // Actualizar stock del producto
      const { error: updateError } = await supabase
        .from('productos')
        .update({ stock_actual: nuevoStock, updated_at: new Date().toISOString() })
        .eq('id', selectedProductoId);

      if (updateError) throw updateError;

      // Registrar movimiento
      const { error: movError } = await supabase
        .from('movimientos_inventario')
        .insert({
          producto_id: selectedProductoId,
          tipo: movementType,
          cantidad: movementType === 'ajuste' ? Math.abs(nuevoStock - producto.stock_actual) : cantidadNum,
          stock_anterior: producto.stock_actual,
          stock_nuevo: nuevoStock,
          motivo: motivo || null,
          referencia_tipo: 'manual',
          usuario_id: user?.id || null,
        });

      if (movError) throw movError;

      toast({ 
        title: "Movimiento registrado", 
        description: `${movementType === 'entrada' ? 'Entrada' : movementType === 'salida' ? 'Salida' : 'Ajuste'} de ${cantidadNum} unidades` 
      });

      setIsMovementOpen(false);
      fetchData();
    } catch (error: any) {
      console.error('Error:', error);
      toast({ title: "Error", description: error.message || "No se pudo registrar el movimiento", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const stats = {
    total: productos.length,
    bajoMinimo: productos.filter(p => p.stock_actual > 0 && p.stock_actual <= p.stock_minimo).length,
    agotados: productos.filter(p => p.stock_actual === 0).length,
  };

  return (
    <MainLayout title="Inventario">
      {/* Stats */}
      <div className="mb-6 grid gap-4 md:grid-cols-4">
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
            <div className="rounded-lg bg-success/10 p-2">
              <ArrowUpRight className="h-5 w-5 text-success" />
            </div>
            <div>
              <p className="text-2xl font-bold">{movimientos.filter(m => m.tipo === 'entrada').length}</p>
              <p className="text-sm text-muted-foreground">Entradas</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-destructive/10 p-2">
              <ArrowDownLeft className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.agotados}</p>
              <p className="text-sm text-muted-foreground">Agotados</p>
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
      </div>

      <Tabs defaultValue="stock" className="space-y-6">
        <TabsList>
          <TabsTrigger value="stock">Stock Actual</TabsTrigger>
          <TabsTrigger value="almacenes">Por Almacén</TabsTrigger>
          <TabsTrigger value="movements">Movimientos</TabsTrigger>
        </TabsList>

        <TabsContent value="stock" className="space-y-4">
          {/* Header Actions */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-1 items-center gap-4">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input 
                  placeholder="Buscar producto..." 
                  className="pl-9" 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>
            <Button className="gap-2" onClick={() => openMovementDialog('ajuste')}>
              <RefreshCw className="h-4 w-4" />
              Ajuste de Inventario
            </Button>
          </div>

          {/* Inventory Table */}
          <div className="rounded-xl border border-border bg-card shadow-sm animate-fade-in">
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
                  {pagination.pageItems.map((item) => {
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
            {!loading && <DataTablePagination pagination={pagination} />}
          </div>
        </TabsContent>

        <TabsContent value="almacenes" className="space-y-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar almacén o producto..."
              className="pl-9"
              value={almSearch}
              onChange={(e) => setAlmSearch(e.target.value)}
            />
          </div>
          <div className="rounded-xl border border-border bg-card shadow-sm animate-fade-in">
            {loading ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
            ) : gruposAlm.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Boxes className="mb-4 h-12 w-12 opacity-50" />
                <p>No hay existencias por almacén</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Almacén / Producto</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead className="text-right">Cantidad</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {gruposAlm.map((g) => (
                    <Fragment key={g.key}>
                      <TableRow className="cursor-pointer bg-muted/40 hover:bg-muted" onClick={() => toggleAlm(g.key)}>
                        <TableCell colSpan={3}>
                          <div className="flex items-center gap-2 font-medium">
                            <ChevronRight className={cn("h-4 w-4 shrink-0 transition-transform", openAlm.has(g.key) && "rotate-90")} />
                            <Boxes className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="truncate">{g.nombre}</span>
                            <Badge variant={g.tipo === "consignacion" ? "outline" : "secondary"}>{g.tipo}</Badge>
                            <Badge variant="secondary">{g.items.length} SKU</Badge>
                            <span className="ml-auto font-semibold text-primary">{g.total.toLocaleString("es-VE")} u</span>
                          </div>
                        </TableCell>
                      </TableRow>
                      {openAlm.has(g.key) && g.items.map((r) => (
                        <TableRow key={r.id} className="hover:bg-muted/50">
                          <TableCell className="pl-10">{r.producto?.nombre || "—"}</TableCell>
                          <TableCell className="font-mono text-sm text-muted-foreground">{r.producto?.sku || "—"}</TableCell>
                          <TableCell className="text-right font-semibold">{Number(r.cantidad).toLocaleString("es-VE")}</TableCell>
                        </TableRow>
                      ))}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            )}
            {!loading && gruposAlm.length > 0 && (
              <div className="border-t border-border px-4 py-2.5 text-sm text-muted-foreground">
                {gruposAlm.length} almacén{gruposAlm.length !== 1 ? "es" : ""} con existencias
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="movements" className="space-y-4">
          {/* Header Actions */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-1 items-center gap-4">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input 
                  placeholder="Buscar movimiento..." 
                  className="pl-9"
                  value={movementSearchTerm}
                  onChange={(e) => setMovementSearchTerm(e.target.value)}
                />
              </div>
              <Select value={tipoFiltro} onValueChange={setTipoFiltro}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="entrada">Entradas</SelectItem>
                  <SelectItem value="salida">Salidas</SelectItem>
                  <SelectItem value="ajuste">Ajustes</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="gap-2" onClick={() => openMovementDialog('entrada')}>
                <ArrowUpRight className="h-4 w-4" />
                Entrada
              </Button>
              <Button variant="outline" className="gap-2" onClick={() => openMovementDialog('salida')}>
                <ArrowDownLeft className="h-4 w-4" />
                Salida
              </Button>
            </div>
          </div>

          {/* Movements Table */}
          <div className="rounded-xl border border-border bg-card shadow-sm animate-fade-in">
            {filteredMovimientos.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Package className="h-12 w-12 mb-4 opacity-50" />
                <p>No hay movimientos registrados</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Producto</TableHead>
                    <TableHead className="text-center">Cantidad</TableHead>
                    <TableHead className="text-center">Stock Anterior</TableHead>
                    <TableHead className="text-center">Stock Nuevo</TableHead>
                    <TableHead>Motivo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagination2.pageItems.map((mov: any) => (
                    <TableRow key={mov.id} className="hover:bg-muted/50">
                      <TableCell className="text-muted-foreground">
                        {new Date(mov.created_at).toLocaleDateString('es-VE', { 
                          day: '2-digit', 
                          month: '2-digit', 
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </TableCell>
                      <TableCell>
                        <Badge variant={mov.tipo === "entrada" ? "default" : mov.tipo === "salida" ? "destructive" : "secondary"}>
                          {mov.tipo.charAt(0).toUpperCase() + mov.tipo.slice(1)}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">{mov.producto?.nombre || '-'}</TableCell>
                      <TableCell className="text-center font-semibold">
                        <span className={mov.tipo === 'entrada' ? 'text-green-600' : mov.tipo === 'salida' ? 'text-red-600' : ''}>
                          {mov.tipo === 'entrada' ? '+' : mov.tipo === 'salida' ? '-' : ''}{mov.cantidad}
                        </span>
                      </TableCell>
                      <TableCell className="text-center text-muted-foreground">{mov.stock_anterior}</TableCell>
                      <TableCell className="text-center text-muted-foreground">{mov.stock_nuevo}</TableCell>
                      <TableCell className="text-muted-foreground">{mov.motivo || '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <DataTablePagination pagination={pagination2} />
          </div>
        </TabsContent>
      </Tabs>

      {/* Dialog de Movimiento */}
      <Dialog open={isMovementOpen} onOpenChange={setIsMovementOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {movementType === 'entrada' ? '📥 Entrada de Inventario' : 
               movementType === 'salida' ? '📤 Salida de Inventario' : 
               '🔄 Ajuste de Inventario'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Producto *</Label>
              <Select value={selectedProductoId} onValueChange={setSelectedProductoId}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar producto" />
                </SelectTrigger>
                <SelectContent>
                  {productos.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <div className="flex items-center gap-2">
                        <span>{p.imagen_emoji}</span>
                        <span>{p.nombre}</span>
                        <span className="text-muted-foreground">({p.stock_actual} en stock)</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedProductoId && (
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-sm text-muted-foreground">
                  Stock actual: <span className="font-semibold text-foreground">
                    {productos.find(p => p.id === selectedProductoId)?.stock_actual || 0}
                  </span>
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label>
                {movementType === 'ajuste' ? 'Nuevo Stock *' : 'Cantidad *'}
              </Label>
              <Input
                type="number"
                min="1"
                placeholder={movementType === 'ajuste' ? 'Nuevo stock' : 'Cantidad'}
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
              />
              {movementType === 'ajuste' && cantidad && selectedProductoId && (
                <p className="text-xs text-muted-foreground">
                  Diferencia: {parseInt(cantidad) - (productos.find(p => p.id === selectedProductoId)?.stock_actual || 0)} unidades
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Motivo / Observaciones</Label>
              <Textarea
                placeholder="Ej: Compra a proveedor, Venta directa, Ajuste por conteo físico..."
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsMovementOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleMovement} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {movementType === 'entrada' ? 'Registrar Entrada' : 
               movementType === 'salida' ? 'Registrar Salida' : 
               'Aplicar Ajuste'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
};

export default Inventario;
