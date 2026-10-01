import { useSearchParams } from "react-router-dom";
import { useState, useEffect, useMemo, Fragment } from "react";
import { cn } from "@/lib/utils";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Checkbox } from "@/components/ui/checkbox";
import { Package, Edit, Loader2, MoreHorizontal, CheckSquare, XSquare, Tag, FolderOpen, ChevronRight } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase, Producto, Categoria, TipoEmpaque, ProductoEmpaque } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/hooks/use-toast";
import { ProductImagesInput, borrarFotosQuitadas } from "@/components/products/ProductImagesInput";
import { SyncOdooProducto } from "@/components/products/SyncOdooProducto";
import { urlImagenAncho } from "@/components/portal/ProductImage";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { OdooBadge } from "@/components/OdooBadge";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { BarraLista } from "@/components/datos/BarraLista";
import { useOrdenTabla, EncabezadoOrdenable, exportarCSV, BotonExportar } from "@/components/datos/tabla";
import { useColumnas } from "@/components/datos/columnas";
import {
  FiltrosLista, useFiltros, useFiltroEmpresa, opcionesDe, opcionesPrueba, pasaPrueba, coincide, contadorFiltrado, type OpcionPrueba,
} from "@/components/datos/FiltrosLista";
import { EtiquetaIva } from "@/components/portal/EtiquetaIva";
import { textoIva } from "@/lib/iva";

interface ProductoConRelaciones extends Producto {
  categoria: Categoria | null;
  tipo_empaque: TipoEmpaque | null;
  producto_empaques?: (ProductoEmpaque & { tipo_empaque: TipoEmpaque })[];
}

// Costo del producto: viene de Odoo (costo promedio) y solo lo ve administración (tabla producto_costos, fase 20j)
const CostoOdoo = ({ productoId }: { productoId?: string }) => {
  const [c, setC] = useState<{ costo: number | null; costo_actualizado_at: string | null } | null | undefined>(undefined);
  useEffect(() => {
    if (!productoId) { setC(null); return; }
    let activo = true;
    supabase.from("producto_costos").select("costo, costo_actualizado_at").eq("producto_id", productoId).maybeSingle()
      .then(({ data }) => { if (activo) setC((data as { costo: number | null; costo_actualizado_at: string | null } | null) ?? null); });
    return () => { activo = false; };
  }, [productoId]);
  return (
    <p className="flex h-10 items-center gap-1.5 rounded-md border border-border bg-muted/40 px-3 text-sm" title="El costo lo mantiene Odoo">
      {c === undefined ? <span className="text-muted-foreground">…</span>
        : c?.costo != null && Number(c.costo) > 0 ? <><span className="tabular-nums font-medium">${Number(c.costo).toFixed(2)}</span><span className="text-xs text-muted-foreground">Odoo{c.costo_actualizado_at ? ` · ${new Date(c.costo_actualizado_at).toLocaleDateString("es-VE")}` : ""}</span></>
        : <span className="text-xs text-muted-foreground">Sin costo en Odoo</span>}
    </p>
  );
};

const Productos = () => {
  const [productos, setProductos] = useState<ProductoConRelaciones[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [empaques, setEmpaques] = useState<TipoEmpaque[]>([]);
  const [loading, setLoading] = useState(true);
  const [params] = useSearchParams();
  const [searchTerm, setSearchTerm] = useState(params.get("q") ?? "");
  const [grouped, setGrouped] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (k: string) => setOpenGroups((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isBulkCategoryOpen, setIsBulkCategoryOpen] = useState(false);
  const [selectedProducto, setSelectedProducto] = useState<ProductoConRelaciones | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkCategoryId, setBulkCategoryId] = useState("");
  const [importErrors, setImportErrors] = useState<{row: number; field: string; message: string}[]>([]);
  const { formatPrice } = useCurrency();
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    sku: "",
    nombre: "",
    descripcion: "",
    categoria_id: "",
    empaques_ids: [] as string[],
    precio_base: 0,
    costo: 0,
    stock_actual: 0,
    stock_minimo: 0,
    activo: true,
    destacado: false,
  });
  const [imagenes, setImagenes] = useState<string[]>([]);
  // Fotos con que se abrió el formulario: al guardar se borran del bucket las quitadas; al cancelar, las subidas sin guardar
  const [imagenesIniciales, setImagenesIniciales] = useState<string[]>([]);
  // Versión del indicador de sincronización con Odoo (se recarga tras guardar o enviar)
  const [versionSync, setVersionSync] = useState(0);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const [productosRes, categoriasRes, empaquesRes] = await Promise.all([
      supabase.from('productos').select('*, categoria:categorias(*), tipo_empaque:tipos_empaque(*), producto_empaques(*, tipo_empaque:tipos_empaque(*))').order('nombre'),
      supabase.from('categorias').select('*').eq('activo', true).order('orden'),
      supabase.from('tipos_empaque').select('*').eq('activo', true).order('orden')
    ]);
    
    if (productosRes.data) setProductos(productosRes.data);
    if (categoriasRes.data) setCategorias(categoriasRes.data);
    if (empaquesRes.data) setEmpaques(empaquesRes.data);
    setLoading(false);
  };

  const resetForm = () => {
    setFormData({
      sku: "",
      nombre: "",
      descripcion: "",
      categoria_id: "",
      empaques_ids: [],
      precio_base: 0,
      costo: 0,
      stock_actual: 0,
      stock_minimo: 0,
      activo: true,
      destacado: false,
    });
    setImagenes([]);
  };

  const handleEdit = async () => {
    if (!selectedProducto || !formData.nombre) return;
    // Los productos de Odoo no traen empaques: en ellos el empaque es opcional (se vende por su unidad)
    if (formData.empaques_ids.length === 0 && !selectedProducto.odoo_id) {
      toast({ title: "Error", description: "Selecciona al menos un tipo de empaque", variant: "destructive" });
      return;
    }

    // Producto de Odoo: SKU, nombre, categoría, unidad y stock vienen de Odoo; el precio también si tuvo ventas.
    const esOdoo = !!selectedProducto.odoo_id;
    // La foto principal (a otra, no quitarla) y la descripción se escriben en Odoo (20r): la ficha queda abierta con el estado
    const principalNueva = imagenes[0] || null;
    const cambioOdoo = esOdoo && (
      (!!principalNueva && principalNueva !== (selectedProducto.imagen_url || null)) ||
      (formData.descripcion.trim() || null) !== (selectedProducto.descripcion?.trim() || null));
    const propios = {
      descripcion: formData.descripcion || null,
      costo: formData.costo || null,
      stock_minimo: formData.stock_minimo,
      imagen_url: imagenes[0] || null,
      imagenes,
      activo: formData.activo,
      destacado: formData.destacado,
      ...(!esOdoo || selectedProducto.precio_origen !== 'odoo' ? { precio_base: formData.precio_base } : {}),
    };
    const { error } = await supabase
      .from('productos')
      .update(esOdoo ? propios : {
        ...propios,
        sku: formData.sku,
        nombre: formData.nombre,
        categoria_id: formData.categoria_id || null,
        unidad: empaques.find(e => e.id === formData.empaques_ids[0])?.nombre || 'Unidad',
        stock_actual: formData.stock_actual,
      })
      .eq('id', selectedProducto.id);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    // Actualizar empaques: eliminar existentes y crear nuevos
    await supabase.from('producto_empaques').delete().eq('producto_id', selectedProducto.id);
    
    const empaquesInsert = formData.empaques_ids.map(empaqueId => ({
      producto_id: selectedProducto.id,
      tipo_empaque_id: empaqueId,
    }));
    await supabase.from('producto_empaques').insert(empaquesInsert);

    // Fotos quitadas del formulario: se borran del bucket ahora que el cambio quedó guardado
    await borrarFotosQuitadas(imagenesIniciales, imagenes);
    setImagenesIniciales(imagenes);

    if (cambioOdoo) {
      toast({ title: "Producto Actualizado", description: "La foto y la descripción se envían a Odoo; el estado se ve en la ficha." });
      await recargarSeleccionado(selectedProducto.id);
      setVersionSync((v) => v + 1);
      document.querySelector('[data-testid="sync-odoo-producto"]')?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      fetchData();
      return;
    }
    toast({ title: "Producto Actualizado", description: `"${formData.nombre}" ha sido actualizado` });
    resetForm();
    setIsEditOpen(false);
    setSelectedProducto(null);
    fetchData();
  };

  const recargarSeleccionado = async (id: string) => {
    const { data } = await supabase.from('productos')
      .select('*, categoria:categorias(*), tipo_empaque:tipos_empaque(*), producto_empaques(*, tipo_empaque:tipos_empaque(*))')
      .eq('id', id).single();
    if (data) setSelectedProducto(data as ProductoConRelaciones);
  };

  // Cerrar un formulario sin guardar: las fotos que se subieron en él no quedan huérfanas en el bucket
  const cerrarFormulario = (abrir: boolean, setAbierto: (v: boolean) => void) => {
    if (!abrir) borrarFotosQuitadas(imagenes, imagenesIniciales);
    setAbierto(abrir);
  };

  const toggleEmpaque = (empaqueId: string) => {
    setFormData(prev => ({
      ...prev,
      empaques_ids: prev.empaques_ids.includes(empaqueId)
        ? prev.empaques_ids.filter(id => id !== empaqueId)
        : [...prev.empaques_ids, empaqueId]
    }));
  };

  const handleToggleActivo = async (productoId: string, activo: boolean) => {
    const { error } = await supabase
      .from('productos')
      .update({ activo })
      .eq('id', productoId);

    if (error) {
      toast({ title: "No se pudo actualizar", description: error.message, variant: "destructive" });
    } else {
      // Actualizar localmente para evitar refetch (en productos de Odoo "desactivar" = ocultar de la tienda)
      setProductos(prev => prev.map(p => p.id === productoId ? { ...p, activo, oculto_tienda: p.odoo_id ? !activo : p.oculto_tienda } : p));
      toast({ title: activo ? "Producto Activado" : "Producto Desactivado" });
    }
  };

  // Funciones de selección múltiple
  const toggleSelectAll = () => {
    if (selectedIds.length === filteredProductos.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredProductos.map(p => p.id));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  // Acciones masivas
  const handleBulkActivate = async () => {
    const { error } = await supabase
      .from('productos')
      .update({ activo: true })
      .in('id', selectedIds);

    if (error) {
      toast({ title: "No se pudieron activar", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Productos Activados", description: `${selectedIds.length} productos han sido activados` });
      setSelectedIds([]);
      fetchData();
    }
  };

  const handleBulkDeactivate = async () => {
    const { error } = await supabase
      .from('productos')
      .update({ activo: false })
      .in('id', selectedIds);

    if (error) {
      toast({ title: "No se pudieron desactivar", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Productos Desactivados", description: `${selectedIds.length} productos han sido desactivados` });
      setSelectedIds([]);
      fetchData();
    }
  };

  const handleBulkChangeCategory = async () => {
    const { error } = await supabase
      .from('productos')
      .update({ categoria_id: bulkCategoryId || null })
      .in('id', selectedIds);

    if (error) {
      toast({ title: "No se pudo cambiar la categoría", description: error.message, variant: "destructive" });
    } else {
      const catName = categorias.find(c => c.id === bulkCategoryId)?.nombre || "Sin categoría";
      toast({ title: "Categoría Actualizada", description: `${selectedIds.length} productos movidos a "${catName}"` });
      setSelectedIds([]);
      fetchData();
    }
    setIsBulkCategoryOpen(false);
    setBulkCategoryId("");
  };

  const handleBulkToggleFeatured = async (featured: boolean) => {
    const { error } = await supabase
      .from('productos')
      .update({ destacado: featured })
      .in('id', selectedIds);

    if (error) {
      toast({ title: "No se pudieron actualizar", description: error.message, variant: "destructive" });
    } else {
      toast({ title: featured ? "Productos Destacados" : "Destacados Removidos", description: `${selectedIds.length} productos actualizados` });
      setSelectedIds([]);
      fetchData();
    }
  };

  const openEditSheet = (producto: ProductoConRelaciones) => {
    setSelectedProducto(producto);
    setFormData({
      sku: producto.sku,
      nombre: producto.nombre,
      descripcion: producto.descripcion || "",
      categoria_id: producto.categoria_id || "",
      empaques_ids: producto.producto_empaques?.map(pe => pe.tipo_empaque_id) || [],
      precio_base: producto.precio_base,
      costo: producto.costo || 0,
      stock_actual: producto.stock_actual,
      stock_minimo: producto.stock_minimo,
      activo: producto.activo,
      destacado: producto.destacado,
    });
    const existentes = Array.isArray(producto.imagenes) ? (producto.imagenes as string[]) : [];
    const iniciales = existentes.length > 0 ? existentes : (producto.imagen_url ? [producto.imagen_url] : []);
    setImagenes(iniciales);
    setImagenesIniciales(iniciales);
    setIsEditOpen(true);
  };

  // ---- Filtros (en la URL). Estado de stock con la misma regla que los indicadores y la insignia "Estado" ----
  const controla = (p: Producto) => p.controla_stock !== false;
  const pruebasStock: OpcionPrueba<ProductoConRelaciones>[] = [
    { valor: "disponible", etiqueta: "Disponible", prueba: (p) => controla(p) && p.stock_actual > p.stock_minimo },
    { valor: "bajo", etiqueta: "Bajo stock", prueba: (p) => controla(p) && p.stock_actual > 0 && p.stock_actual <= p.stock_minimo },
    { valor: "agotado", etiqueta: "Agotado", prueba: (p) => controla(p) && p.stock_actual <= 0 },
    { valor: "servicio", etiqueta: "Servicio (sin stock)", prueba: (p) => !controla(p) },
  ];
  const siNo = (si: string, no: string, f: (p: ProductoConRelaciones) => boolean): OpcionPrueba<ProductoConRelaciones>[] =>
    [{ valor: "si", etiqueta: si, prueba: f }, { valor: "no", etiqueta: no, prueba: (p) => !f(p) }];
  const pruebasActivo = siNo("Activos", "Inactivos", (p) => p.activo);
  // Visible en la tienda: la misma regla del catálogo del portal (activo, vendible y no oculto)
  const pruebasTienda = siNo("Visible en la tienda", "No visible", (p) => p.activo && p.vendible !== false && !p.oculto_tienda);
  const tieneFoto = (p: ProductoConRelaciones) => !!p.imagen_url || (Array.isArray(p.imagenes) && (p.imagenes as unknown[]).length > 0);
  const pruebasFoto = siNo("Con foto", "Sin foto", tieneFoto);
  const pruebasIva: OpcionPrueba<ProductoConRelaciones>[] = [
    { valor: "iva", etiqueta: "Con IVA", prueba: (p) => p.impuesto_pct != null && Number(p.impuesto_pct) > 0 },
    { valor: "exento", etiqueta: "Exento (0%)", prueba: (p) => p.impuesto_pct != null && Number(p.impuesto_pct) === 0 },
    { valor: "sin", etiqueta: "Sin sincronizar", prueba: (p) => p.impuesto_pct == null },
  ];
  const pruebasTipo: OpcionPrueba<ProductoConRelaciones>[] = [
    { valor: "almacenable", etiqueta: "Almacenable", prueba: (p) => controla(p) },
    { valor: "servicio", etiqueta: "Servicio", prueba: (p) => !controla(p) },
  ];
  const pruebasPromo: OpcionPrueba<ProductoConRelaciones>[] = [
    { valor: "destacado", etiqueta: "Destacados", prueba: (p) => !!p.destacado },
    { valor: "oferta", etiqueta: "En oferta", prueba: (p) => !!p.en_oferta },
    { valor: "ninguna", etiqueta: "Sin destacar ni oferta", prueba: (p) => !p.destacado && !p.en_oferta },
  ];
  const filtroEmpresa = useFiltroEmpresa(productos);
  const f = useFiltros([
    { clave: "categoria", etiqueta: "Categoría", todos: "Todas", principal: true, opciones: opcionesDe(productos, (p) => p.categoria_id, (p) => p.categoria?.nombre ?? "—", "Sin categoría") },
    { clave: "stock", etiqueta: "Stock", principal: true, opciones: opcionesPrueba(productos, pruebasStock) },
    { clave: "activo", etiqueta: "Situación", todos: "Activos e inactivos", principal: true, opciones: opcionesPrueba(productos, pruebasActivo) },
    { clave: "tienda", etiqueta: "Tienda", todos: "Todos", opciones: opcionesPrueba(productos, pruebasTienda) },
    { clave: "foto", etiqueta: "Foto", todos: "Con y sin foto", opciones: opcionesPrueba(productos, pruebasFoto) },
    { clave: "iva", etiqueta: "IVA", todos: "Todos", opciones: opcionesPrueba(productos, pruebasIva) },
    { clave: "tipo", etiqueta: "Tipo", todos: "Todos", opciones: opcionesPrueba(productos, pruebasTipo) },
    { clave: "promo", etiqueta: "Destacado / oferta", todos: "Todos", opciones: opcionesPrueba(productos, pruebasPromo) },
    filtroEmpresa,
  ]);
  const pasaFiltros = (p: ProductoConRelaciones, sinStock = false) =>
    coincide(p.categoria_id, f.v("categoria")) && (sinStock || pasaPrueba(pruebasStock, f.v("stock"), p))
    && pasaPrueba(pruebasActivo, f.v("activo"), p) && pasaPrueba(pruebasTienda, f.v("tienda"), p)
    && pasaPrueba(pruebasFoto, f.v("foto"), p) && pasaPrueba(pruebasIva, f.v("iva"), p)
    && pasaPrueba(pruebasTipo, f.v("tipo"), p) && pasaPrueba(pruebasPromo, f.v("promo"), p)
    && (!filtroEmpresa || coincide(p.empresa_id, f.v("empresa")));
  // Indicadores: todos los filtros salvo el de stock (los KPI de stock lo fijan al pulsarlos). Sin filtros = todos, como antes.
  const baseKpi = useMemo(() => productos.filter((p) => pasaFiltros(p, true)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [productos, f.firma]);
  const termino = searchTerm.toLowerCase();
  const filteredProductos = productos.filter(p =>
    pasaFiltros(p) && (p.nombre.toLowerCase().includes(termino) || p.sku.toLowerCase().includes(termino)));

  const { ordenadas: productosOrdenados, orden, alternar } = useOrdenTabla(filteredProductos, {
    sku: (p) => p.sku, nombre: (p) => p.nombre, categoria: (p) => p.categoria?.nombre, precio: (p) => Number(p.precio_base || 0),
    iva: (p) => (p.impuesto_pct == null ? null : Number(p.impuesto_pct)),
    stock: (p) => Number(p.stock_disponible ?? p.stock_actual ?? 0),
  });
  const pagination = usePagination(productosOrdenados, 50, f.firma);
  const exportarProductos = () => exportarCSV("productos", productosOrdenados, [
    { titulo: "SKU", valor: (p) => p.sku }, { titulo: "Producto", valor: (p) => p.nombre }, { titulo: "Categoría", valor: (p) => p.categoria?.nombre },
    { titulo: "Precio base", valor: (p) => Number(p.precio_base || 0) }, { titulo: "IVA %", valor: (p) => (p.impuesto_pct == null ? "" : Number(p.impuesto_pct)) },
    { titulo: "Existencia", valor: (p) => p.stock_actual },
    { titulo: "Disponible", valor: (p) => p.stock_disponible ?? p.stock_actual }, { titulo: "Activo", valor: (p) => (p.activo ? "Sí" : "No") },
    { titulo: "Visible en tienda", valor: (p) => (p.activo && p.vendible !== false && !p.oculto_tienda ? "Sí" : "No") },
    { titulo: "Foto", valor: (p) => (tieneFoto(p) ? "Sí" : "No") }, { titulo: "Tipo", valor: (p) => (controla(p) ? "Almacenable" : "Servicio") },
  ]);

  // Sin filtros, los mismos números de siempre (sobre todos los productos)
  const stats = {
    total: baseKpi.length,
    disponibles: baseKpi.filter(p => p.controla_stock !== false && p.stock_actual > p.stock_minimo).length,
    bajoStock: baseKpi.filter(p => p.activo && p.controla_stock !== false && p.stock_actual > 0 && p.stock_actual <= p.stock_minimo).length,
    agotados: baseKpi.filter(p => p.activo && p.controla_stock !== false && p.stock_actual <= 0).length,
  };
  // Pulsar un indicador de stock lo fija como filtro (bajo stock y agotados cuentan solo productos activos, como el KPI)
  const kpiStock = (stock: string, soloActivos: boolean) => () =>
    f.v("stock") === stock ? f.setVarios({ stock: "", activo: "" }) : f.setVarios({ stock, activo: soloActivos ? "si" : "" });

  const getStatus = (p: Producto) => {
    if (p.controla_stock === false) return { label: "Servicio", variant: "outline" as const };
    if (p.stock_actual <= 0) return { label: "Agotado", variant: "destructive" as const };
    if (p.stock_actual <= p.stock_minimo) return { label: "Bajo Stock", variant: "secondary" as const };
    return { label: "Disponible", variant: "default" as const };
  };

  const grupos = useMemo(() => {
    const m = new Map<string, { key: string; nombre: string; items: ProductoConRelaciones[] }>();
    for (const p of filteredProductos) {
      const key = p.categoria_id || "sin";
      const g = m.get(key) || { key, nombre: p.categoria?.nombre || "Sin categoría", items: [] };
      g.items.push(p);
      m.set(key, g);
    }
    return [...m.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [filteredProductos]);

  const renderProductoRow = (producto: ProductoConRelaciones) => {
    const status = getStatus(producto);
    const isSelected = selectedIds.includes(producto.id);
    return (
      <TableRow
        key={producto.id}
        className={`hover:bg-muted/50 cursor-pointer ${isSelected ? 'bg-primary/5' : ''}`}
        onClick={() => openEditSheet(producto)}
      >
        <TableCell onClick={(e) => e.stopPropagation()}>
          <Checkbox checked={isSelected} onCheckedChange={() => toggleSelect(producto.id)} />
        </TableCell>
        <TableCell className="whitespace-nowrap font-mono text-xs text-primary">{producto.sku}</TableCell>
        <TableCell className="font-medium">
          <div className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
            {producto.imagen_url ? (
              // Miniatura al tamaño en que se pinta: las fotos que llegan de Odoo pueden medir hasta 1920 px
              <img src={urlImagenAncho(producto.imagen_url, 40)} alt={producto.nombre} loading="lazy" decoding="async"
                className="h-5 w-5 shrink-0 rounded object-cover"
                onError={(e) => { const u = producto.imagen_url!; if (e.currentTarget.src !== u) e.currentTarget.src = u; }} />
            ) : (
              <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <span className="max-w-[260px] truncate" title={producto.nombre}>{producto.nombre}</span>
            {producto.odoo_id && <OdooBadge />}
          </div>
        </TableCell>
        <TableCell className="max-w-[180px] truncate whitespace-nowrap text-muted-foreground" title={producto.categoria?.nombre || 'Sin Categoría'}>{producto.categoria?.nombre || 'Sin Categoría'}</TableCell>
        <TableCell>
          <div className="flex gap-1 whitespace-nowrap">
            {producto.producto_empaques && producto.producto_empaques.length > 0 ? (
              producto.producto_empaques.map(pe => (
                <Badge key={pe.id} variant="outline" className="text-xs">
                  {pe.tipo_empaque?.nombre}
                  {pe.tipo_empaque && pe.tipo_empaque.unidades > 1 && (
                    <span className="ml-1 text-muted-foreground">({pe.tipo_empaque.unidades}u)</span>
                  )}
                </Badge>
              ))
            ) : (
              <Badge variant="outline">{producto.unidad}</Badge>
            )}
          </div>
        </TableCell>
        <TableCell className="whitespace-nowrap text-right font-semibold">{formatPrice(producto.precio_base)}</TableCell>
        <TableCell className="whitespace-nowrap">
          {producto.impuesto_pct != null
            ? <EtiquetaIva pct={producto.impuesto_pct} nombre={producto.impuesto_nombre} className="text-xs" />
            : <span className="text-xs text-muted-foreground" title="Aún sin sincronizar: se aplica el IVA general de configuración">—</span>}
        </TableCell>
        <TableCell className="text-center">{producto.stock_actual}</TableCell>
        <TableCell className="whitespace-nowrap">
          <Badge variant={status.variant}>{status.label}</Badge>
        </TableCell>
        <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
          <Switch checked={producto.activo} onCheckedChange={(checked) => handleToggleActivo(producto.id, checked)} />
        </TableCell>
        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
          <div className="flex justify-end gap-0.5">
            <Button variant="ghost" size="icon" className="h-7 w-7" title="Editar" onClick={() => openEditSheet(producto)}>
              <Edit className="h-3.5 w-3.5" />
            </Button>
          </div>
        </TableCell>
      </TableRow>
    );
  };

  const cols = useColumnas("productos", [{ etiqueta: "", fija: true }, { etiqueta: "SKU" }, { etiqueta: "Producto", fija: true }, { etiqueta: "Categoría" }, { etiqueta: "Empaque" }, { etiqueta: "Precio Base" }, { etiqueta: "IVA" }, { etiqueta: "Stock" }, { etiqueta: "Estado" }, { etiqueta: "Activo" }, { etiqueta: "Acciones", fija: true }]);
  return (
    <MainLayout title="Productos">
      {cols.estilo}
      {/* Stats */}
      <KpiStrip
        items={[
          { label: "Total Productos", valor: stats.total, tono: "primario" },
          { label: "Disponibles", valor: stats.disponibles, tono: "positivo", onClick: kpiStock("disponible", false), activo: f.v("stock") === "disponible", titulo: "Ver los disponibles" },
          { label: "Bajo Stock", valor: stats.bajoStock, tono: "alerta", onClick: kpiStock("bajo", true), activo: f.v("stock") === "bajo", titulo: "Ver los activos con bajo stock" },
          { label: "Agotados", valor: stats.agotados, tono: "negativo", onClick: kpiStock("agotado", true), activo: f.v("stock") === "agotado", titulo: "Ver los activos agotados" },
        ]}
      />

      {/* Header Actions */}
      <BarraLista
        busqueda={searchTerm}
        onBusqueda={setSearchTerm}
        placeholder="Buscar producto..."
        contador={loading ? undefined : contadorFiltrado(filteredProductos.length, productos.length, f.activos || !!searchTerm)}
        filtros={<FiltrosLista filtros={f} resultados={filteredProductos.length} />}
        acciones={
          <>
            {cols.selector}
            <BotonExportar onClick={exportarProductos} total={productosOrdenados.length} />
            <Button size="sm" variant={grouped ? "default" : "outline"} className="gap-1.5" onClick={() => setGrouped((g) => !g)}>
              <FolderOpen className="h-3.5 w-3.5" />
              {grouped ? "Agrupado por categoría" : "Agrupar por categoría"}
            </Button>
            <span className="hidden text-[12px] text-muted-foreground lg:inline" title="Los productos se crean en Odoo y llegan con la sincronización; aquí se editan">Se crean en Odoo</span>
          </>
        }
      />

      {/* Bulk Actions Bar */}
      {selectedIds.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-1.5">
          <div className="flex items-center gap-2">
            <Checkbox
              checked={selectedIds.length === filteredProductos.length}
              onCheckedChange={toggleSelectAll}
            />
            <span className="text-[13px] font-medium text-primary">
              {selectedIds.length} producto{selectedIds.length > 1 ? 's' : ''} seleccionado{selectedIds.length > 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={handleBulkActivate}>
              <CheckSquare className="h-3.5 w-3.5" />
              Activar
            </Button>
            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={handleBulkDeactivate}>
              <XSquare className="h-3.5 w-3.5" />
              Desactivar
            </Button>
            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => setIsBulkCategoryOpen(true)}>
              <FolderOpen className="h-3.5 w-3.5" />
              Cambiar Categoría
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs">
                  <MoreHorizontal className="h-3.5 w-3.5" />
                  Más
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleBulkToggleFeatured(true)}>
                  <Tag className="h-4 w-4 mr-2" />
                  Marcar como Destacados
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleBulkToggleFeatured(false)}>
                  <Tag className="h-4 w-4 mr-2" />
                  Quitar Destacados
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedIds([])}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {/* Products Table */}
      <div className="rounded-lg border border-border bg-card animate-fade-in">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <Table data-tabla="productos">
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox
                    checked={selectedIds.length === filteredProductos.length && filteredProductos.length > 0}
                    onCheckedChange={toggleSelectAll}
                  />
                </TableHead>
                <EncabezadoOrdenable clave="sku" orden={orden} onOrdenar={alternar}>SKU</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="nombre" orden={orden} onOrdenar={alternar}>Producto</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="categoria" orden={orden} onOrdenar={alternar}>Categoría</EncabezadoOrdenable>
                <TableHead>Empaque</TableHead>
                <EncabezadoOrdenable clave="precio" orden={orden} onOrdenar={alternar} alinear="derecha">Precio Base</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="iva" orden={orden} onOrdenar={alternar}>IVA</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="stock" orden={orden} onOrdenar={alternar} alinear="centro">Stock</EncabezadoOrdenable>
                <TableHead>Estado</TableHead>
                <TableHead className="text-center">Activo</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grouped
                ? grupos.map((g) => (
                    <Fragment key={g.key}>
                      <TableRow className="cursor-pointer bg-muted/40 hover:bg-muted" onClick={() => toggleGroup(g.key)}>
                        <TableCell colSpan={11}>
                          <div className="flex items-center gap-2 whitespace-nowrap font-medium">
                            <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 transition-transform", openGroups.has(g.key) && "rotate-90")} />
                            <span className="truncate">{g.nombre}</span>
                            <Badge variant="secondary">{g.items.length} producto{g.items.length !== 1 ? "s" : ""}</Badge>
                          </div>
                        </TableCell>
                      </TableRow>
                      {openGroups.has(g.key) && g.items.map(renderProductoRow)}
                    </Fragment>
                  ))
                : pagination.pageItems.map(renderProductoRow)}
            </TableBody>
          </Table>
        )}
        {!loading && !grouped && <DataTablePagination pagination={pagination} />}
        {!loading && grouped && filteredProductos.length > 0 && (
          <div className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
            {grupos.length} categoría{grupos.length !== 1 ? "s" : ""} · {filteredProductos.length} productos
          </div>
        )}
      </div>

      {/* Edit Product Sheet */}
      <Sheet open={isEditOpen} onOpenChange={(v) => cerrarFormulario(v, setIsEditOpen)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">Editar Producto {selectedProducto?.odoo_id && <OdooBadge />}</SheetTitle>
            {selectedProducto?.odoo_id && (
              <p className="text-xs text-muted-foreground">
                Los campos con la marca Odoo se editan en Odoo. Aquí se administran imágenes, descripción, empaques, ofertas y visibilidad en la tienda.
              </p>
            )}
          </SheetHeader>
          <div className="grid gap-4 py-4">
            {selectedProducto?.odoo_id && (
              <SyncOdooProducto producto={selectedProducto} version={versionSync} onEnviado={() => recargarSeleccionado(selectedProducto.id)} />
            )}
            {/* Image Upload */}
            <div className="space-y-2">
              <Label>Imágenes del Producto</Label>
              <ProductImagesInput images={imagenes} onChange={setImagenes} />
              {selectedProducto?.odoo_id && (
                <p className="text-xs text-muted-foreground">
                  La principal se envía a Odoo. Quitarla solo la quita en GUDS: en Odoo se conserva la suya (GUDS no borra nada en Odoo).
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">SKU {selectedProducto?.odoo_id && <OdooBadge />}</Label>
                <Input
                  value={formData.sku}
                  disabled={!!selectedProducto?.odoo_id}
                  onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">Nombre * {selectedProducto?.odoo_id && <OdooBadge />}</Label>
                <Input
                  value={formData.nombre}
                  disabled={!!selectedProducto?.odoo_id}
                  onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-descripcion" className="flex items-center gap-1.5">
                Descripción {selectedProducto?.odoo_id && <OdooBadge titulo="Descripción de venta: se sincroniza con Odoo en los dos sentidos (gana el cambio más reciente)" />}
              </Label>
              <Textarea
                id="edit-descripcion"
                value={formData.descripcion}
                maxLength={5000}
                rows={4}
                placeholder={selectedProducto?.odoo_id ? "Descripción de venta: la ven los clientes en la ficha del producto y se escribe en Odoo" : undefined}
                onChange={(e) => setFormData({ ...formData, descripcion: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">Categoría {selectedProducto?.odoo_id && <OdooBadge />}</Label>
              <Select value={formData.categoria_id} disabled={!!selectedProducto?.odoo_id} onValueChange={(v) => setFormData({ ...formData, categoria_id: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Sin categoría" />
                </SelectTrigger>
                <SelectContent>
                  {categorias.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.icono} {cat.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Tipos de Empaque * (selecciona uno o más)</Label>
              <div className="grid grid-cols-2 gap-2 p-3 border rounded-lg">
                {empaques.map((emp) => (
                  <div key={emp.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`edit-emp-${emp.id}`}
                      checked={formData.empaques_ids.includes(emp.id)}
                      onCheckedChange={() => toggleEmpaque(emp.id)}
                    />
                    <label
                      htmlFor={`edit-emp-${emp.id}`}
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                    >
                      {emp.nombre} ({emp.unidades}u)
                    </label>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  Precio Base * {selectedProducto?.precio_origen === 'odoo' && <OdooBadge titulo="Último precio de venta en Odoo · se actualiza desde Odoo" />}
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.precio_base}
                  disabled={!!selectedProducto?.odoo_id && selectedProducto.precio_origen === 'odoo'}
                  onChange={(e) => setFormData({ ...formData, precio_base: parseFloat(e.target.value) || 0 })}
                />
                {selectedProducto?.odoo_id && selectedProducto.precio_origen !== 'odoo' && (
                  <p className="text-xs text-muted-foreground">Sin ventas en Odoo: el precio lo fija GUDS hasta que haya una venta en Odoo.</p>
                )}
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="iva-producto">
                  IVA de venta: {textoIva(selectedProducto?.impuesto_pct) ?? "el general de configuración (sin sincronizar)"}
                  {selectedProducto?.impuesto_pct != null && <OdooBadge titulo={`Impuesto del producto en Odoo${selectedProducto.impuesto_nombre ? `: ${selectedProducto.impuesto_nombre}` : ""} · se cambia en Odoo`} />}
                </p>
              </div>
              <div className="space-y-2">
                <Label>Costo</Label>
                <CostoOdoo productoId={selectedProducto?.id} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">Stock Actual {selectedProducto?.odoo_id && <OdooBadge titulo="Stock de los almacenes propios en Odoo" />}</Label>
                <Input
                  type="number"
                  min="0"
                  value={formData.stock_actual}
                  disabled={!!selectedProducto?.odoo_id}
                  onChange={(e) => setFormData({ ...formData, stock_actual: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div className="space-y-2">
                <Label>Stock Mínimo</Label>
                <Input
                  type="number"
                  min="0"
                  value={formData.stock_minimo}
                  onChange={(e) => setFormData({ ...formData, stock_minimo: parseInt(e.target.value) || 0 })}
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Switch
                  checked={formData.activo}
                  onCheckedChange={(v) => setFormData({ ...formData, activo: v })}
                />
                <Label>{selectedProducto?.odoo_id ? "Visible en la tienda" : "Activo"}</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={formData.destacado}
                  onCheckedChange={(v) => setFormData({ ...formData, destacado: v })}
                />
                <Label>Destacado</Label>
              </div>
            </div>
            {selectedProducto?.odoo_id && !selectedProducto.disponible && (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                No disponible para la venta: en Odoo no está a la venta, es un servicio o no tiene precio.
              </p>
            )}

            <div className="flex gap-2 pt-4">
              <Button variant="outline" className="flex-1" onClick={() => cerrarFormulario(false, setIsEditOpen)}>
                Cancelar
              </Button>
              <Button className="flex-1" onClick={handleEdit}>
                Guardar Cambios
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Bulk Change Category Dialog */}
      <Dialog open={isBulkCategoryOpen} onOpenChange={setIsBulkCategoryOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cambiar Categoría</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Label className="mb-2 block">Selecciona la nueva categoría para {selectedIds.length} productos</Label>
            <Select value={bulkCategoryId} onValueChange={setBulkCategoryId}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar categoría" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Sin Categoría</SelectItem>
                {categorias.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>{cat.nombre}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBulkCategoryOpen(false)}>Cancelar</Button>
            <Button onClick={handleBulkChangeCategory}>
              Cambiar Categoría
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
};

export default Productos;
