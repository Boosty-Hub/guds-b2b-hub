import { useState, useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Search, Tags, Edit, Users, Percent, Loader2, Trash2, Check } from "lucide-react";
import { supabase, ListaPrecios, Producto, Cliente } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/hooks/use-toast";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";

interface ListaConClientes extends ListaPrecios {
  clientes_count?: number;
}

interface PrecioLista {
  id: string;
  lista_precios_id: string;
  producto_id: string;
  precio: number;
}

interface ProductoConPrecio extends Producto {
  precio_lista?: number | null;
  usa_precio_manual?: boolean;
}

const Precios = () => {
  const [listas, setListas] = useState<ListaConClientes[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [listSearchTerm, setListSearchTerm] = useState("");
  const { formatPrice } = useCurrency();
  const { toast } = useToast();

  // Estados para diálogos
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isClientesOpen, setIsClientesOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isPreciosOpen, setIsPreciosOpen] = useState(false);
  const [selectedLista, setSelectedLista] = useState<ListaConClientes | null>(null);
  const [saving, setSaving] = useState(false);
  
  // Estados para precios por producto
  const [productosConPrecios, setProductosConPrecios] = useState<ProductoConPrecio[]>([]);
  const [preciosModificados, setPreciosModificados] = useState<Record<string, number | null>>({});
  const [productSearchTerm, setProductSearchTerm] = useState("");

  // Form data
  const [formData, setFormData] = useState({
    nombre: "",
    descripcion: "",
    porcentaje_descuento: 0,
    es_default: false,
    activo: true,
  });

  // Clientes seleccionados para asignar
  const [selectedClienteIds, setSelectedClienteIds] = useState<string[]>([]);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const [listasRes, productosRes, clientesRes] = await Promise.all([
      supabase.from('listas_precios').select('*, clientes:clientes(count)').order('nombre'),
      supabase.from('productos').select('*').eq('activo', true).order('nombre'),
      supabase.from('clientes').select('*').eq('activo', true).order('nombre_negocio')
    ]);
    
    if (listasRes.data) {
      setListas(listasRes.data.map(l => ({
        ...l,
        clientes_count: l.clientes?.[0]?.count || 0
      })));
    }
    if (productosRes.data) setProductos(productosRes.data);
    if (clientesRes.data) setClientes(clientesRes.data);
    setLoading(false);
  };

  const resetForm = () => {
    setFormData({
      nombre: "",
      descripcion: "",
      porcentaje_descuento: 0,
      es_default: false,
      activo: true,
    });
  };

  const openEditDialog = (lista: ListaConClientes) => {
    setSelectedLista(lista);
    setFormData({
      nombre: lista.nombre,
      descripcion: lista.descripcion || "",
      porcentaje_descuento: lista.porcentaje_descuento || 0,
      es_default: lista.es_default || false,
      activo: lista.activo,
    });
    setIsEditOpen(true);
  };

  const openClientesSheet = async (lista: ListaConClientes) => {
    setSelectedLista(lista);
    // Obtener clientes asignados a esta lista
    const { data } = await supabase
      .from('clientes')
      .select('id')
      .eq('lista_precios_id', lista.id);
    
    setSelectedClienteIds(data?.map(c => c.id) || []);
    setIsClientesOpen(true);
  };

  const handleCreate = async () => {
    if (!formData.nombre.trim()) {
      toast({ title: "Error", description: "El nombre es requerido", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from('listas_precios')
        .insert({
          nombre: formData.nombre.trim(),
          descripcion: formData.descripcion.trim() || null,
          porcentaje_descuento: formData.porcentaje_descuento,
          es_default: formData.es_default,
          activo: formData.activo,
        });

      if (error) throw error;

      toast({ title: "Lista creada", description: "La lista de precios se creó correctamente" });
      setIsCreateOpen(false);
      resetForm();
      fetchData();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!selectedLista || !formData.nombre.trim()) {
      toast({ title: "Error", description: "El nombre es requerido", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from('listas_precios')
        .update({
          nombre: formData.nombre.trim(),
          descripcion: formData.descripcion.trim() || null,
          porcentaje_descuento: formData.porcentaje_descuento,
          es_default: formData.es_default,
          activo: formData.activo,
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedLista.id);

      if (error) throw error;

      toast({ title: "Lista actualizada", description: "Los cambios se guardaron correctamente" });
      setIsEditOpen(false);
      fetchData();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedLista) return;

    setSaving(true);
    try {
      // Primero quitar la lista de los clientes asignados
      await supabase
        .from('clientes')
        .update({ lista_precios_id: null })
        .eq('lista_precios_id', selectedLista.id);

      const { error } = await supabase
        .from('listas_precios')
        .delete()
        .eq('id', selectedLista.id);

      if (error) throw error;

      toast({ title: "Lista eliminada", description: "La lista de precios se eliminó correctamente" });
      setIsDeleteOpen(false);
      fetchData();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveClientes = async () => {
    if (!selectedLista) return;

    setSaving(true);
    try {
      // Quitar la lista de todos los clientes que la tenían
      await supabase
        .from('clientes')
        .update({ lista_precios_id: null })
        .eq('lista_precios_id', selectedLista.id);

      // Asignar la lista a los clientes seleccionados
      if (selectedClienteIds.length > 0) {
        await supabase
          .from('clientes')
          .update({ lista_precios_id: selectedLista.id })
          .in('id', selectedClienteIds);
      }

      toast({ 
        title: "Clientes actualizados", 
        description: `${selectedClienteIds.length} cliente(s) asignado(s) a la lista` 
      });
      setIsClientesOpen(false);
      fetchData();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const toggleClienteSelection = (clienteId: string) => {
    setSelectedClienteIds(prev => 
      prev.includes(clienteId) 
        ? prev.filter(id => id !== clienteId)
        : [...prev, clienteId]
    );
  };

  // Funciones para precios por producto
  const openPreciosSheet = async (lista: ListaConClientes) => {
    setSelectedLista(lista);
    setProductSearchTerm("");
    setPreciosModificados({});
    
    // Obtener precios personalizados para esta lista
    const { data: preciosData } = await supabase
      .from('precios_lista')
      .select('*')
      .eq('lista_precios_id', lista.id);
    
    const preciosMap: Record<string, number> = {};
    preciosData?.forEach(p => {
      preciosMap[p.producto_id] = p.precio;
    });
    
    // Combinar productos con sus precios personalizados
    const productosConPrecio = productos.map(p => ({
      ...p,
      precio_lista: preciosMap[p.id] || null,
      usa_precio_manual: !!preciosMap[p.id],
    }));
    
    setProductosConPrecios(productosConPrecio);
    setIsPreciosOpen(true);
  };

  const handlePrecioChange = (productoId: string, value: string) => {
    const numValue = value === '' ? null : parseFloat(value);
    setPreciosModificados(prev => ({
      ...prev,
      [productoId]: numValue,
    }));
  };

  const calcularPrecioConDescuento = (precioBase: number) => {
    if (!selectedLista) return precioBase;
    const descuento = selectedLista.porcentaje_descuento || 0;
    return precioBase * (1 - descuento / 100);
  };

  const handleSavePrecios = async () => {
    if (!selectedLista) return;

    setSaving(true);
    try {
      // Procesar cada precio modificado
      for (const [productoId, precio] of Object.entries(preciosModificados)) {
        if (precio === null) {
          // Eliminar precio personalizado
          await supabase
            .from('precios_lista')
            .delete()
            .eq('lista_precios_id', selectedLista.id)
            .eq('producto_id', productoId);
        } else {
          // Insertar o actualizar precio personalizado
          await supabase
            .from('precios_lista')
            .upsert({
              lista_precios_id: selectedLista.id,
              producto_id: productoId,
              precio: precio,
              updated_at: new Date().toISOString(),
            }, { onConflict: 'lista_precios_id,producto_id' });
        }
      }

      toast({ 
        title: "Precios guardados", 
        description: `Se actualizaron ${Object.keys(preciosModificados).length} precio(s)` 
      });
      setIsPreciosOpen(false);
      setPreciosModificados({});
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const getPrecioActual = (producto: ProductoConPrecio) => {
    // Si hay un precio modificado pendiente
    if (preciosModificados[producto.id] !== undefined) {
      return preciosModificados[producto.id];
    }
    // Si tiene precio manual guardado
    if (producto.precio_lista) {
      return producto.precio_lista;
    }
    // Precio con descuento global
    return calcularPrecioConDescuento(producto.precio_base);
  };

  const filteredProductosPrecios = productosConPrecios.filter(p =>
    p.nombre.toLowerCase().includes(productSearchTerm.toLowerCase()) ||
    p.sku.toLowerCase().includes(productSearchTerm.toLowerCase())
  );

  const filteredProductos = productos.filter(p =>
    p.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.sku.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredListas = listas.filter(l =>
    l.nombre.toLowerCase().includes(listSearchTerm.toLowerCase())
  );

  const pagination = usePagination(filteredProductos, 25);
  const pagination2 = usePagination(filteredProductosPrecios, 25);

  const stats = {
    total: listas.length,
    activas: listas.filter(l => l.activo).length,
    clientesAsignados: listas.reduce((sum, l) => sum + (l.clientes_count || 0), 0),
  };

  return (
    <MainLayout title="Listas de Precios">
      {/* Stats */}
      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <Tags className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.total}</p>
              <p className="text-sm text-muted-foreground">Listas de Precios</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-success/10 p-2">
              <Tags className="h-5 w-5 text-success" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.activas}</p>
              <p className="text-sm text-muted-foreground">Activas</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.clientesAsignados}</p>
              <p className="text-sm text-muted-foreground">Clientes Asignados</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <Percent className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{productos.length}</p>
              <p className="text-sm text-muted-foreground">Productos</p>
            </div>
          </div>
        </div>
      </div>

      <Tabs defaultValue="lists" className="space-y-6">
        <TabsList>
          <TabsTrigger value="lists">Listas de Precios</TabsTrigger>
          <TabsTrigger value="products">Productos y Precios</TabsTrigger>
        </TabsList>

        <TabsContent value="lists" className="space-y-4">
          {/* Header Actions */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input 
                placeholder="Buscar lista de precios..." 
                className="pl-9"
                value={listSearchTerm}
                onChange={(e) => setListSearchTerm(e.target.value)}
              />
            </div>
            <Button className="gap-2" onClick={() => { resetForm(); setIsCreateOpen(true); }}>
              <Plus className="h-4 w-4" />
              Nueva Lista
            </Button>
          </div>

          {/* Price Lists Grid */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : filteredListas.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Tags className="h-12 w-12 mb-4 opacity-50" />
              <p>No hay listas de precios</p>
              <Button className="mt-4 gap-2" onClick={() => { resetForm(); setIsCreateOpen(true); }}>
                <Plus className="h-4 w-4" />
                Crear Primera Lista
              </Button>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredListas.map((lista) => (
                <div key={lista.id} className="rounded-xl border border-border bg-card p-6 shadow-sm transition-all duration-200 hover:shadow-md animate-fade-in">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-semibold text-foreground">{lista.nombre}</h3>
                        {lista.es_default && (
                          <Badge variant="outline" className="text-xs">Default</Badge>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{lista.descripcion || 'Sin descripción'}</p>
                    </div>
                    <Badge variant={lista.activo ? "default" : "secondary"}>
                      {lista.activo ? "Activo" : "Inactivo"}
                    </Badge>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-2xl font-bold text-foreground">{lista.clientes_count || 0}</p>
                      <p className="text-xs text-muted-foreground">Clientes</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-primary">{lista.porcentaje_descuento}%</p>
                      <p className="text-xs text-muted-foreground">Descuento</p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" className="gap-1" onClick={() => openEditDialog(lista)}>
                      <Edit className="h-4 w-4" />
                      Editar
                    </Button>
                    <Button variant="outline" size="sm" className="gap-1" onClick={() => openPreciosSheet(lista)}>
                      <Percent className="h-4 w-4" />
                      Precios
                    </Button>
                    <Button variant="outline" size="sm" className="gap-1" onClick={() => openClientesSheet(lista)}>
                      <Users className="h-4 w-4" />
                      Clientes
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="text-destructive hover:text-destructive"
                      onClick={() => { setSelectedLista(lista); setIsDeleteOpen(true); }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="products" className="space-y-4">
          {/* Header Actions */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
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

          {/* Products Table */}
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
                    <TableHead className="text-right">Precio Base</TableHead>
                    <TableHead className="text-right">Precio Oferta</TableHead>
                    <TableHead className="text-center">En Oferta</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagination.pageItems.map((producto) => (
                    <TableRow key={producto.id} className="hover:bg-muted/50">
                      <TableCell className="font-mono text-sm text-primary">{producto.sku}</TableCell>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {producto.imagen_emoji && <span>{producto.imagen_emoji}</span>}
                          {producto.nombre}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium">{formatPrice(producto.precio_base)}</TableCell>
                      <TableCell className="text-right font-medium text-success">
                        {producto.precio_oferta ? formatPrice(producto.precio_oferta) : '-'}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant={producto.en_oferta ? "default" : "secondary"}>
                          {producto.en_oferta ? "Sí" : "No"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {!loading && <DataTablePagination pagination={pagination} />}
          </div>
        </TabsContent>
      </Tabs>

      {/* Dialog Crear Lista */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nueva Lista de Precios</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Nombre *</Label>
              <Input
                placeholder="Ej: Mayoristas, VIP, Distribuidores..."
                value={formData.nombre}
                onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Descripción</Label>
              <Textarea
                placeholder="Descripción de la lista de precios..."
                value={formData.descripcion}
                onChange={(e) => setFormData({ ...formData, descripcion: e.target.value })}
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label>Porcentaje de Descuento (%)</Label>
              <Input
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={formData.porcentaje_descuento}
                onChange={(e) => setFormData({ ...formData, porcentaje_descuento: parseFloat(e.target.value) || 0 })}
              />
              <p className="text-xs text-muted-foreground">
                Este descuento se aplicará sobre el precio base de los productos
              </p>
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Lista por defecto</Label>
                <p className="text-xs text-muted-foreground">Se asignará a nuevos clientes</p>
              </div>
              <Switch
                checked={formData.es_default}
                onCheckedChange={(checked) => setFormData({ ...formData, es_default: checked })}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label>Activo</Label>
              <Switch
                checked={formData.activo}
                onCheckedChange={(checked) => setFormData({ ...formData, activo: checked })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Crear Lista
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog Editar Lista */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar Lista de Precios</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Nombre *</Label>
              <Input
                placeholder="Nombre de la lista"
                value={formData.nombre}
                onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Descripción</Label>
              <Textarea
                placeholder="Descripción de la lista de precios..."
                value={formData.descripcion}
                onChange={(e) => setFormData({ ...formData, descripcion: e.target.value })}
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label>Porcentaje de Descuento (%)</Label>
              <Input
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={formData.porcentaje_descuento}
                onChange={(e) => setFormData({ ...formData, porcentaje_descuento: parseFloat(e.target.value) || 0 })}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Lista por defecto</Label>
                <p className="text-xs text-muted-foreground">Se asignará a nuevos clientes</p>
              </div>
              <Switch
                checked={formData.es_default}
                onCheckedChange={(checked) => setFormData({ ...formData, es_default: checked })}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label>Activo</Label>
              <Switch
                checked={formData.activo}
                onCheckedChange={(checked) => setFormData({ ...formData, activo: checked })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>Cancelar</Button>
            <Button onClick={handleUpdate} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Guardar Cambios
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog Confirmar Eliminar */}
      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Eliminar Lista de Precios</DialogTitle>
          </DialogHeader>
          <p className="py-4 text-muted-foreground">
            ¿Estás seguro de eliminar la lista <strong>"{selectedLista?.nombre}"</strong>? 
            Los clientes asignados a esta lista quedarán sin lista de precios.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteOpen(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sheet Asignar Clientes */}
      <Sheet open={isClientesOpen} onOpenChange={setIsClientesOpen}>
        <SheetContent className="sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Clientes - {selectedLista?.nombre}</SheetTitle>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            <p className="text-sm text-muted-foreground">
              Selecciona los clientes que tendrán acceso a esta lista de precios con {selectedLista?.porcentaje_descuento}% de descuento.
            </p>
            
            <div className="flex items-center justify-between rounded-lg bg-muted/50 p-3">
              <span className="text-sm font-medium">{selectedClienteIds.length} cliente(s) seleccionado(s)</span>
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => setSelectedClienteIds(clientes.map(c => c.id))}
              >
                Seleccionar todos
              </Button>
            </div>

            <ScrollArea className="h-[400px] rounded-lg border">
              <div className="p-4 space-y-2">
                {clientes.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No hay clientes registrados</p>
                ) : (
                  clientes.map((cliente) => (
                    <div 
                      key={cliente.id}
                      className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                        selectedClienteIds.includes(cliente.id) ? 'bg-primary/5 border-primary' : 'hover:bg-muted/50'
                      }`}
                      onClick={() => toggleClienteSelection(cliente.id)}
                    >
                      <Checkbox 
                        checked={selectedClienteIds.includes(cliente.id)}
                        onCheckedChange={() => toggleClienteSelection(cliente.id)}
                      />
                      <div className="flex-1">
                        <p className="font-medium">{cliente.nombre_negocio}</p>
                        <p className="text-xs text-muted-foreground">{cliente.codigo} • {cliente.ciudad}</p>
                      </div>
                      {selectedClienteIds.includes(cliente.id) && (
                        <Check className="h-4 w-4 text-primary" />
                      )}
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>

            <div className="flex gap-2 pt-4">
              <Button variant="outline" className="flex-1" onClick={() => setIsClientesOpen(false)}>
                Cancelar
              </Button>
              <Button className="flex-1" onClick={handleSaveClientes} disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Guardar Asignación
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Sheet Configurar Precios por Producto */}
      <Sheet open={isPreciosOpen} onOpenChange={setIsPreciosOpen}>
        <SheetContent className="sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>Precios - {selectedLista?.nombre}</SheetTitle>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            <div className="rounded-lg bg-muted/50 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Descuento Global</span>
                <Badge variant="outline" className="text-lg font-bold">
                  {selectedLista?.porcentaje_descuento || 0}%
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Este descuento se aplica a todos los productos que no tengan un precio manual configurado.
              </p>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input 
                placeholder="Buscar producto..." 
                className="pl-9"
                value={productSearchTerm}
                onChange={(e) => setProductSearchTerm(e.target.value)}
              />
            </div>

            {Object.keys(preciosModificados).length > 0 && (
              <div className="flex items-center justify-between rounded-lg bg-primary/10 p-3">
                <span className="text-sm font-medium text-primary">
                  {Object.keys(preciosModificados).length} cambio(s) pendiente(s)
                </span>
              </div>
            )}

            <ScrollArea className="h-[400px] rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead className="text-right">Precio Base</TableHead>
                    <TableHead className="text-right">Con Descuento</TableHead>
                    <TableHead className="text-right w-32">Precio Manual</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagination2.pageItems.map((producto) => {
                    const precioConDescuento = calcularPrecioConDescuento(producto.precio_base);
                    const tieneManual = producto.precio_lista !== null || preciosModificados[producto.id] !== undefined;
                    const precioActual = getPrecioActual(producto);
                    
                    return (
                      <TableRow key={producto.id} className={tieneManual ? "bg-primary/5" : ""}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {producto.imagen_emoji && <span>{producto.imagen_emoji}</span>}
                            <div>
                              <p className="font-medium text-sm">{producto.nombre}</p>
                              <p className="text-xs text-muted-foreground">{producto.sku}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {formatPrice(producto.precio_base)}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={tieneManual ? "line-through text-muted-foreground" : "font-medium"}>
                            {formatPrice(precioConDescuento)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center gap-1">
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder={formatPrice(precioConDescuento)}
                              className="w-24 text-right h-8"
                              value={
                                preciosModificados[producto.id] !== undefined 
                                  ? (preciosModificados[producto.id] ?? '') 
                                  : (producto.precio_lista ?? '')
                              }
                              onChange={(e) => handlePrecioChange(producto.id, e.target.value)}
                            />
                            {(producto.precio_lista || preciosModificados[producto.id]) && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive"
                                onClick={() => handlePrecioChange(producto.id, '')}
                                title="Quitar precio manual"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <DataTablePagination pagination={pagination2} />
            </ScrollArea>

            <div className="flex gap-2 pt-4">
              <Button variant="outline" className="flex-1" onClick={() => setIsPreciosOpen(false)}>
                Cancelar
              </Button>
              <Button 
                className="flex-1" 
                onClick={handleSavePrecios} 
                disabled={saving || Object.keys(preciosModificados).length === 0}
              >
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Guardar Precios ({Object.keys(preciosModificados).length})
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </MainLayout>
  );
};

export default Precios;
