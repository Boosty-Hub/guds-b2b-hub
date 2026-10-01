import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
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
import { KpiStrip } from "@/components/datos/KpiStrip";
import { BarraLista } from "@/components/datos/BarraLista";
import {
  FiltrosLista, useFiltros, useFiltroEmpresa, opcionesDe, opcionesPrueba, pasaPrueba, coincide, contadorFiltrado, type OpcionPrueba,
} from "@/components/datos/FiltrosLista";

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

type ProductoFila = Producto & { categoria?: { nombre: string } | null };
const CLAVES_PRODUCTOS = ["categoria", "oferta", "precio", "lista", "empresa"];

const Precios = () => {
  const [listas, setListas] = useState<ListaConClientes[]>([]);
  const [productos, setProductos] = useState<ProductoFila[]>([]);
  // Productos con precio especial por lista (tabla precios_lista): lista → productos
  const [especiales, setEspeciales] = useState<Record<string, Set<string>>>({});
  const [params, setParams] = useSearchParams();
  // Pestaña en la URL (?tab=products) para que los filtros sobrevivan a recargar
  const tab = params.get("tab") === "products" ? "products" : "lists";
  const setTab = (t: string) => setParams((p) => {
    const n = new URLSearchParams(p);
    if (t === "products") n.set("tab", t); else { n.delete("tab"); CLAVES_PRODUCTOS.forEach((k) => n.delete(k)); }
    return n;
  }, { replace: true });
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
    const [listasRes, productosRes, clientesRes, especialesRes] = await Promise.all([
      supabase.from('listas_precios').select('*, clientes:clientes(count)').order('nombre'),
      supabase.from('productos').select('*, categoria:categorias(nombre)').eq('activo', true).order('nombre'),
      supabase.from('clientes').select('*').eq('activo', true).order('nombre_negocio'),
      supabase.from('precios_lista').select('lista_precios_id, producto_id'),
    ]);
    const esp: Record<string, Set<string>> = {};
    for (const r of (especialesRes.data as { lista_precios_id: string; producto_id: string }[] | null) ?? []) (esp[r.lista_precios_id] ??= new Set()).add(r.producto_id);
    setEspeciales(esp);
    
    if (listasRes.data) {
      setListas(listasRes.data.map(l => ({
        ...l,
        clientes_count: l.clientes?.[0]?.count || 0
      })));
    }
    if (productosRes.data) setProductos(productosRes.data as ProductoFila[]);
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

  // ---- Filtros de "Productos y precios" (en la URL) ----
  const pruebasOferta: OpcionPrueba<ProductoFila>[] = [
    { valor: "si", etiqueta: "En oferta", prueba: (p) => !!p.en_oferta }, { valor: "no", etiqueta: "Sin oferta", prueba: (p) => !p.en_oferta },
  ];
  const pruebasPrecio: OpcionPrueba<ProductoFila>[] = [
    { valor: "sin", etiqueta: "Sin precio base (0)", prueba: (p) => !(Number(p.precio_base) > 0) },
    { valor: "con", etiqueta: "Con precio base", prueba: (p) => Number(p.precio_base) > 0 },
  ];
  const filtroEmpresa = useFiltroEmpresa(productos);
  const f = useFiltros(tab === "products" ? [
    { clave: "categoria", etiqueta: "Categoría", todos: "Todas", principal: true, opciones: opcionesDe(productos, (p) => p.categoria_id, (p) => p.categoria?.nombre?.trim() || "—", "Sin categoría") },
    { clave: "oferta", etiqueta: "Oferta", todos: "Todos", principal: true, opciones: opcionesPrueba(productos, pruebasOferta) },
    { clave: "precio", etiqueta: "Precio base", todos: "Todos", principal: true, opciones: opcionesPrueba(productos, pruebasPrecio) },
    { clave: "lista", etiqueta: "Precio especial en lista", todos: "Todos", opciones: listas.map((l) => ({ valor: l.id, etiqueta: l.nombre, n: productos.filter((p) => especiales[l.id]?.has(p.id)).length })) },
    filtroEmpresa,
  ] : []);
  const filteredProductos = productos.filter(p =>
    (p.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.sku.toLowerCase().includes(searchTerm.toLowerCase())) &&
    coincide(p.categoria_id, f.v("categoria")) && pasaPrueba(pruebasOferta, f.v("oferta"), p) && pasaPrueba(pruebasPrecio, f.v("precio"), p) &&
    (!f.v("lista") || !!especiales[f.v("lista")]?.has(p.id)) && (!filtroEmpresa || coincide(p.empresa_id, f.v("empresa")))
  );

  const filteredListas = listas.filter(l =>
    l.nombre.toLowerCase().includes(listSearchTerm.toLowerCase())
  );

  const pagination = usePagination(filteredProductos, 50, f.firma);
  const pagination2 = usePagination(filteredProductosPrecios, 50);

  const stats = {
    total: listas.length,
    activas: listas.filter(l => l.activo).length,
    clientesAsignados: listas.reduce((sum, l) => sum + (l.clientes_count || 0), 0),
  };

  return (
    <MainLayout title="Listas de Precios">
      <KpiStrip items={[
        { label: "Listas de Precios", valor: stats.total, tono: "primario" },
        { label: "Activas", valor: stats.activas, tono: "positivo" },
        { label: "Clientes Asignados", valor: stats.clientesAsignados },
        { label: "Productos", valor: productos.length },
      ]} />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="lists">Listas de Precios</TabsTrigger>
          <TabsTrigger value="products">Productos y Precios</TabsTrigger>
        </TabsList>

        <TabsContent value="lists">
          <BarraLista
            busqueda={listSearchTerm}
            onBusqueda={setListSearchTerm}
            placeholder="Buscar lista de precios..."
            contador={`${filteredListas.length} registros`}
            acciones={
              <Button size="sm" className="gap-1.5" onClick={() => { resetForm(); setIsCreateOpen(true); }}>
                <Plus className="h-3.5 w-3.5" />
                Nueva Lista
              </Button>
            }
          />

          <div className="rounded-lg border border-border bg-card">
            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : filteredListas.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-sm text-muted-foreground">
                <Tags className="mb-2 h-8 w-8 opacity-50" />
                <p>No hay listas de precios</p>
                <Button size="sm" className="mt-3 gap-1.5" onClick={() => { resetForm(); setIsCreateOpen(true); }}>
                  <Plus className="h-3.5 w-3.5" />
                  Crear Primera Lista
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lista</TableHead>
                    <TableHead>Descripción</TableHead>
                    <TableHead className="text-right">Clientes</TableHead>
                    <TableHead className="text-right">Descuento</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredListas.map((lista) => (
                    <TableRow key={lista.id} className="hover:bg-muted/50">
                      <TableCell className="max-w-[240px] truncate font-medium" title={lista.nombre}>
                        {lista.nombre}
                        {lista.es_default && (
                          <Badge variant="outline" className="ml-1.5">Default</Badge>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[320px] truncate text-muted-foreground" title={lista.descripcion || undefined}>{lista.descripcion || 'Sin descripción'}</TableCell>
                      <TableCell className="whitespace-nowrap text-right">{lista.clientes_count || 0}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-semibold text-primary">{lista.porcentaje_descuento}%</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Badge variant={lista.activo ? "default" : "secondary"}>
                          {lista.activo ? "Activo" : "Inactivo"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Editar" aria-label="Editar" onClick={() => openEditDialog(lista)}>
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => openPreciosSheet(lista)}>
                            <Percent className="h-3.5 w-3.5" />
                            Precios
                          </Button>
                          <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => openClientesSheet(lista)}>
                            <Users className="h-3.5 w-3.5" />
                            Clientes
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            title="Eliminar"
                            aria-label="Eliminar"
                            onClick={() => { setSelectedLista(lista); setIsDeleteOpen(true); }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </TabsContent>

        <TabsContent value="products">
          <BarraLista
            busqueda={searchTerm}
            onBusqueda={setSearchTerm}
            placeholder="Buscar producto..."
            filtros={<FiltrosLista filtros={f} resultados={filteredProductos.length} />}
            contador={loading ? undefined : contadorFiltrado(filteredProductos.length, productos.length, f.activos || !!searchTerm)}
          />

          {/* Products Table */}
          <div className="rounded-lg border border-border bg-card">
            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
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
                      <TableCell className="whitespace-nowrap font-mono text-xs text-primary">{producto.sku}</TableCell>
                      <TableCell className="max-w-[360px] truncate font-medium" title={producto.nombre}>
                        {producto.imagen_emoji && <span className="mr-1.5">{producto.imagen_emoji}</span>}
                        {producto.nombre}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-medium">{formatPrice(producto.precio_base)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-medium text-success">
                        {producto.precio_oferta ? formatPrice(producto.precio_oferta) : '-'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-center">
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
                        <TableCell className="max-w-[240px] truncate" title={producto.nombre}>
                          {producto.imagen_emoji && <span className="mr-1.5">{producto.imagen_emoji}</span>}
                          <span className="font-medium">{producto.nombre}</span>
                          <span className="ml-1.5 text-xs text-muted-foreground">{producto.sku}</span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right text-muted-foreground">
                          {formatPrice(producto.precio_base)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right">
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
                              className="h-7 w-24 text-right text-[13px]"
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
                                className="h-7 w-7 text-destructive"
                                onClick={() => handlePrecioChange(producto.id, '')}
                                title="Quitar precio manual"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
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
