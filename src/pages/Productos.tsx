import { useState, useEffect, useRef, useMemo, Fragment } from "react";
import * as XLSX from 'xlsx';
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Search, Package, Edit, Trash2, Loader2, MoreHorizontal, CheckSquare, XSquare, Tag, FolderOpen, Upload, Download, FileSpreadsheet, AlertCircle, CheckCircle2, ChevronRight } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { ProductImagesInput } from "@/components/products/ProductImagesInput";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";

interface ProductoConRelaciones extends Producto {
  categoria: Categoria | null;
  tipo_empaque: TipoEmpaque | null;
  producto_empaques?: (ProductoEmpaque & { tipo_empaque: TipoEmpaque })[];
}

interface ImportRow {
  sku: string;
  nombre: string;
  descripcion: string;
  categoria: string;
  precio_base: number;
  costo: number;
  stock_actual: number;
  stock_minimo: number;
  activo: boolean;
  // Campos calculados/mapeados
  categoria_id?: string;
  valid: boolean;
  errors: string[];
}

const Productos = () => {
  const [productos, setProductos] = useState<ProductoConRelaciones[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [empaques, setEmpaques] = useState<TipoEmpaque[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoriaFilter, setCategoriaFilter] = useState("all");
  const [grouped, setGrouped] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (k: string) => setOpenGroups((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false);
  const [isBulkCategoryOpen, setIsBulkCategoryOpen] = useState(false);
  const [selectedProducto, setSelectedProducto] = useState<ProductoConRelaciones | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkCategoryId, setBulkCategoryId] = useState("");
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importData, setImportData] = useState<ImportRow[]>([]);
  const [importErrors, setImportErrors] = useState<{row: number; field: string; message: string}[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  const generateSKU = () => {
    const prefix = formData.nombre.substring(0, 3).toUpperCase() || "PRD";
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `${prefix}-${random}`;
  };

  const handleCreate = async () => {
    if (!formData.nombre || !formData.precio_base) {
      toast({ title: "Error", description: "Nombre y precio son requeridos", variant: "destructive" });
      return;
    }
    if (formData.empaques_ids.length === 0) {
      toast({ title: "Error", description: "Selecciona al menos un tipo de empaque", variant: "destructive" });
      return;
    }

    const sku = formData.sku || generateSKU();

    // Crear producto
    const { data: newProduct, error } = await supabase
      .from('productos')
      .insert({
        sku,
        nombre: formData.nombre,
        descripcion: formData.descripcion || null,
        categoria_id: formData.categoria_id || null,
        unidad: empaques.find(e => e.id === formData.empaques_ids[0])?.nombre || 'Unidad',
        precio_base: formData.precio_base,
        costo: formData.costo || null,
        stock_actual: formData.stock_actual,
        stock_minimo: formData.stock_minimo,
        imagen_url: imagenes[0] || null,
        imagenes,
        activo: formData.activo,
        destacado: formData.destacado,
      })
      .select()
      .single();

    if (error || !newProduct) {
      toast({ title: "Error", description: error?.message || "Error al crear producto", variant: "destructive" });
      return;
    }

    // Crear relaciones con empaques
    const empaquesInsert = formData.empaques_ids.map(empaqueId => ({
      producto_id: newProduct.id,
      tipo_empaque_id: empaqueId,
    }));
    
    await supabase.from('producto_empaques').insert(empaquesInsert);

    toast({ title: "Producto Creado", description: `"${formData.nombre}" ha sido creado exitosamente` });
    resetForm();
    setIsCreateOpen(false);
    fetchData();
  };

  const handleEdit = async () => {
    if (!selectedProducto || !formData.nombre) return;
    if (formData.empaques_ids.length === 0) {
      toast({ title: "Error", description: "Selecciona al menos un tipo de empaque", variant: "destructive" });
      return;
    }

    const { error } = await supabase
      .from('productos')
      .update({
        sku: formData.sku,
        nombre: formData.nombre,
        descripcion: formData.descripcion || null,
        categoria_id: formData.categoria_id || null,
        unidad: empaques.find(e => e.id === formData.empaques_ids[0])?.nombre || 'Unidad',
        precio_base: formData.precio_base,
        costo: formData.costo || null,
        stock_actual: formData.stock_actual,
        stock_minimo: formData.stock_minimo,
        imagen_url: imagenes[0] || null,
        imagenes,
        activo: formData.activo,
        destacado: formData.destacado,
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

    toast({ title: "Producto Actualizado", description: `"${formData.nombre}" ha sido actualizado` });
    resetForm();
    setIsEditOpen(false);
    setSelectedProducto(null);
    fetchData();
  };

  const handleDelete = async () => {
    if (!selectedProducto) return;

    const { error } = await supabase
      .from('productos')
      .delete()
      .eq('id', selectedProducto.id);

    if (error) {
      toast({ title: "Error", description: "No se puede eliminar el producto", variant: "destructive" });
    } else {
      toast({ title: "Producto Eliminado", description: `"${selectedProducto.nombre}" ha sido eliminado`, variant: "destructive" });
    }
    
    setIsDeleteOpen(false);
    setSelectedProducto(null);
    fetchData();
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
      toast({ title: "Error", description: "No se pudo actualizar el estado", variant: "destructive" });
    } else {
      // Actualizar localmente para evitar refetch
      setProductos(prev => prev.map(p => p.id === productoId ? { ...p, activo } : p));
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
      toast({ title: "Error", description: "No se pudieron activar los productos", variant: "destructive" });
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
      toast({ title: "Error", description: "No se pudieron desactivar los productos", variant: "destructive" });
    } else {
      toast({ title: "Productos Desactivados", description: `${selectedIds.length} productos han sido desactivados` });
      setSelectedIds([]);
      fetchData();
    }
  };

  const handleBulkDelete = async () => {
    const { error } = await supabase
      .from('productos')
      .delete()
      .in('id', selectedIds);

    if (error) {
      toast({ title: "Error", description: "No se pudieron eliminar los productos", variant: "destructive" });
    } else {
      toast({ title: "Productos Eliminados", description: `${selectedIds.length} productos han sido eliminados`, variant: "destructive" });
      setSelectedIds([]);
      fetchData();
    }
    setIsBulkDeleteOpen(false);
  };

  const handleBulkChangeCategory = async () => {
    const { error } = await supabase
      .from('productos')
      .update({ categoria_id: bulkCategoryId || null })
      .in('id', selectedIds);

    if (error) {
      toast({ title: "Error", description: "No se pudo cambiar la categoría", variant: "destructive" });
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
      toast({ title: "Error", description: "No se pudieron actualizar los productos", variant: "destructive" });
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
    setImagenes(existentes.length > 0 ? existentes : (producto.imagen_url ? [producto.imagen_url] : []));
    setIsEditOpen(true);
  };

  // Funciones de importación
  const downloadTemplate = () => {
    const headers = ['SKU', 'Nombre', 'Descripcion', 'Categoria', 'Precio Base', 'Costo', 'Stock Actual', 'Stock Minimo', 'Activo'];
    const exampleData = [
      ['PRD-001', 'Aceite de Oliva 1L', 'Aceite de oliva extra virgen', 'Aceites', 15.99, 10.50, 100, 20, 'SI'],
      ['PRD-002', 'Arroz Premium 1kg', 'Arroz de grano largo', 'Granos', 3.50, 2.00, 200, 50, 'SI'],
      ['PRD-003', 'Harina de Trigo 1kg', 'Harina todo uso', 'Harinas', 2.25, 1.50, 150, 30, 'SI'],
    ];
    
    // Crear workbook de Excel
    const wb = XLSX.utils.book_new();
    const wsData = [headers, ...exampleData];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    
    // Ajustar ancho de columnas
    ws['!cols'] = [
      { wch: 12 },  // SKU
      { wch: 30 },  // Nombre
      { wch: 40 },  // Descripcion
      { wch: 15 },  // Categoria
      { wch: 12 },  // Precio Base
      { wch: 10 },  // Costo
      { wch: 12 },  // Stock Actual
      { wch: 12 },  // Stock Minimo
      { wch: 8 },   // Activo
    ];
    
    XLSX.utils.book_append_sheet(wb, ws, 'Productos');
    XLSX.writeFile(wb, 'plantilla_productos.xlsx');
    
    toast({ title: "Plantilla Descargada", description: "Completa el archivo Excel y súbelo para importar" });
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    console.log('handleFileUpload triggered');
    const file = event.target.files?.[0];
    console.log('File selected:', file?.name);
    if (!file) {
      console.log('No file selected');
      return;
    }

    toast({ title: "Procesando...", description: `Leyendo archivo: ${file.name}` });

    const fileExtension = file.name.split('.').pop()?.toLowerCase();
    
    if (fileExtension === 'xlsx' || fileExtension === 'xls') {
      // Leer archivo Excel
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          const workbook = XLSX.read(data, { type: 'array' });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          
          // Convertir a JSON directamente (mejor manejo de datos)
          const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' });
          console.log('Excel rows:', jsonData.length);
          if (jsonData.length > 0) {
            console.log('Primera fila:', jsonData[0]);
          }
          
          parseExcelData(jsonData);
        } catch (error) {
          console.error('Error parsing Excel:', error);
          toast({ title: "Error", description: "No se pudo leer el archivo Excel", variant: "destructive" });
        }
      };
      reader.onerror = (e) => {
        console.error('Error reading file:', e);
        toast({ title: "Error", description: "No se pudo leer el archivo", variant: "destructive" });
      };
      reader.readAsArrayBuffer(file);
    } else {
      // Leer archivo CSV/TXT
      const reader = new FileReader();
      reader.onload = (e) => {
        console.log('File read complete');
        const text = e.target?.result as string;
        console.log('File content length:', text.length);
        parseCSV(text);
      };
      reader.onerror = (e) => {
        console.error('Error reading file:', e);
        toast({ title: "Error", description: "No se pudo leer el archivo", variant: "destructive" });
      };
      reader.readAsText(file);
    }
    
    event.target.value = ''; // Reset input
  };

  // Parser para datos de Excel (JSON)
  const parseExcelData = (jsonData: Record<string, unknown>[]) => {
    if (jsonData.length === 0) {
      toast({ title: "Error", description: "El archivo está vacío", variant: "destructive" });
      return;
    }

    const parsedData: ImportRow[] = [];
    const errors: {row: number; field: string; message: string}[] = [];

    // Función para buscar valor en objeto con claves flexibles
    const findValue = (obj: Record<string, unknown>, patterns: string[]): unknown => {
      const keys = Object.keys(obj);
      for (const pattern of patterns) {
        const key = keys.find(k => k.toLowerCase().replace(/[^a-z0-9]/g, '').includes(pattern));
        if (key) return obj[key];
      }
      return '';
    };

    jsonData.forEach((row, index) => {
      const rowNum = index + 2;

      const nombre = String(findValue(row, ['nombre', 'producto', 'name']) || '');
      const precioBase = Number(findValue(row, ['preciobase', 'precio', 'price']) || 0);
      const categoriaStr = String(findValue(row, ['categoria', 'categora', 'category']) || '');

      const importRow: ImportRow = {
        sku: String(findValue(row, ['sku', 'codigo', 'cdigo']) || ''),
        nombre: nombre,
        descripcion: String(findValue(row, ['descripcion', 'descripcin', 'desc']) || ''),
        categoria: categoriaStr,
        precio_base: precioBase,
        costo: Number(findValue(row, ['costo', 'cost']) || 0),
        stock_actual: Number(findValue(row, ['stockactual', 'stock']) || 0),
        stock_minimo: Number(findValue(row, ['stockminimo', 'stockmin', 'minimo']) || 0),
        activo: ['si', '1', 'true', 'yes', 'activo'].includes(String(findValue(row, ['activo', 'active', 'estado']) || 'si').toLowerCase()),
        valid: true,
        errors: [],
      };

      if (index < 3) console.log('Row parseada:', importRow);

      // Validaciones
      if (!importRow.nombre) {
        importRow.valid = false;
        importRow.errors.push('Nombre requerido');
        errors.push({ row: rowNum, field: 'nombre', message: 'Nombre es requerido' });
      }
      if (importRow.precio_base <= 0) {
        importRow.valid = false;
        importRow.errors.push('Precio inválido');
        errors.push({ row: rowNum, field: 'precio_base', message: 'Precio debe ser mayor a 0' });
      }

      // Mapear categoría
      if (importRow.categoria) {
        const cat = categorias.find(c => 
          c.nombre.toLowerCase() === importRow.categoria.toLowerCase()
        );
        if (cat) {
          importRow.categoria_id = cat.id;
        } else {
          importRow.errors.push(`Categoría "${importRow.categoria}" no encontrada`);
        }
      }

      // Generar SKU si no tiene
      if (!importRow.sku) {
        const prefix = importRow.nombre.substring(0, 3).toUpperCase() || 'PRD';
        const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        importRow.sku = `${prefix}-${random}`;
      }

      parsedData.push(importRow);
    });

    console.log('Total parseados:', parsedData.length, 'Válidos:', parsedData.filter(r => r.valid).length);
    setImportData(parsedData);
    setImportErrors(errors);
    setIsImportOpen(true);
  };

  const parseCSV = (text: string) => {
    const lines = text.split('\n').filter(line => line.trim());
    if (lines.length < 2) {
      toast({ title: "Error", description: "El archivo está vacío o no tiene datos", variant: "destructive" });
      return;
    }

    // Detectar separador (coma o punto y coma)
    const headerLine = lines[0];
    const separator = headerLine.includes(';') ? ';' : ',';
    console.log('Separador detectado:', separator);
    console.log('Header:', headerLine);

    // Parsear header para mapear columnas
    const headers = headerLine.split(separator).map(h => h.trim().toLowerCase().replace(/^"|"$/g, ''));
    console.log('Headers parseados:', headers);

    // Mapeo de columnas (flexible) - normalizar headers quitando espacios y caracteres especiales
    const normalizeHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normalizedHeaders = headers.map(normalizeHeader);
    console.log('Headers normalizados:', normalizedHeaders);

    const findCol = (patterns: string[]): number => {
      for (const pattern of patterns) {
        const idx = normalizedHeaders.findIndex(h => h.includes(pattern));
        if (idx !== -1) return idx;
      }
      return -1;
    };

    const colMap = {
      sku: findCol(['sku', 'codigo', 'cdigo']),
      nombre: findCol(['nombre', 'producto', 'name']),
      descripcion: findCol(['descripcion', 'descripcin', 'desc']),
      categoria: findCol(['categoria', 'categora', 'category']),
      precio_base: findCol(['preciobase', 'precio', 'price']),
      costo: findCol(['costo', 'cost']),
      stock_actual: findCol(['stockactual', 'stock']),
      stock_minimo: findCol(['stockminimo', 'stockmin', 'minimo']),
      activo: findCol(['activo', 'active', 'estado']),
    };
    console.log('Mapeo de columnas:', colMap);

    // Saltar header
    const dataLines = lines.slice(1);
    const parsedData: ImportRow[] = [];
    const errors: {row: number; field: string; message: string}[] = [];

    dataLines.forEach((line, index) => {
      // Parsear valores respetando comillas (manejar campos con comas dentro de comillas)
      const values: string[] = [];
      let current = '';
      let inQuotes = false;
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === separator && !inQuotes) {
          values.push(current.trim().replace(/^"|"$/g, ''));
          current = '';
        } else {
          current += char;
        }
      }
      values.push(current.trim().replace(/^"|"$/g, '')); // Último valor
      
      const rowNum = index + 2;

      if (index < 3) console.log(`Fila ${rowNum}:`, values);

      // Función helper para obtener valor por índice
      const getValue = (colIndex: number): string => {
        if (colIndex === -1 || colIndex >= values.length) return '';
        return values[colIndex] || '';
      };

      // Parsear números (manejar formato con coma decimal)
      const parseNumber = (val: string): number => {
        if (!val) return 0;
        // Reemplazar coma por punto para decimales
        const cleaned = val.replace(',', '.').replace(/[^\d.-]/g, '');
        return parseFloat(cleaned) || 0;
      };

      const row: ImportRow = {
        sku: getValue(colMap.sku),
        nombre: getValue(colMap.nombre),
        descripcion: getValue(colMap.descripcion),
        categoria: getValue(colMap.categoria),
        precio_base: parseNumber(getValue(colMap.precio_base)),
        costo: parseNumber(getValue(colMap.costo)),
        stock_actual: parseInt(getValue(colMap.stock_actual)) || 0,
        stock_minimo: parseInt(getValue(colMap.stock_minimo)) || 0,
        activo: ['si', '1', 'true', 'yes', 'activo'].includes(getValue(colMap.activo).toLowerCase()) || colMap.activo === -1,
        valid: true,
        errors: [],
      };

      console.log('Row parseada:', row);

      // Validaciones
      if (!row.nombre) {
        row.valid = false;
        row.errors.push('Nombre requerido');
        errors.push({ row: rowNum, field: 'nombre', message: 'Nombre es requerido' });
      }
      if (row.precio_base <= 0) {
        row.valid = false;
        row.errors.push('Precio inválido');
        errors.push({ row: rowNum, field: 'precio_base', message: 'Precio debe ser mayor a 0' });
      }

      // Mapear categoría
      if (row.categoria) {
        const cat = categorias.find(c => 
          c.nombre.toLowerCase() === row.categoria.toLowerCase()
        );
        if (cat) {
          row.categoria_id = cat.id;
        } else {
          row.errors.push(`Categoría "${row.categoria}" no encontrada`);
        }
      }

      // Generar SKU si no tiene
      if (!row.sku) {
        const prefix = row.nombre.substring(0, 3).toUpperCase() || 'PRD';
        const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        row.sku = `${prefix}-${random}`;
      }

      parsedData.push(row);
    });

    setImportData(parsedData);
    setImportErrors(errors);
    setIsImportOpen(true);
  };

  const updateImportRow = (index: number, field: keyof ImportRow, value: string | number | boolean) => {
    setImportData(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      
      // Re-validar
      const row = updated[index];
      row.errors = [];
      row.valid = true;
      
      if (!row.nombre) {
        row.valid = false;
        row.errors.push('Nombre requerido');
      }
      if (row.precio_base <= 0) {
        row.valid = false;
        row.errors.push('Precio inválido');
      }
      
      return updated;
    });
  };

  const handleImport = async () => {
    const validRows = importData.filter(row => row.valid);
    if (validRows.length === 0) {
      toast({ title: "Error", description: "No hay productos válidos para importar", variant: "destructive" });
      return;
    }

    setIsImporting(true);

    try {
      const defaultEmpaque = empaques[0];
      let importados = 0;
      const fallidos: { sku: string; motivo: string }[] = [];

      for (const row of validRows) {
        // Crear producto — y COMPROBAR el error (antes se ignoraba)
        const { data: newProduct, error } = await supabase
          .from('productos')
          .insert({
            sku: row.sku,
            nombre: row.nombre,
            descripcion: row.descripcion || null,
            categoria_id: row.categoria_id || null,
            unidad: defaultEmpaque?.nombre || 'Unidad',
            precio_base: row.precio_base,
            costo: row.costo || null,
            stock_actual: row.stock_actual,
            stock_minimo: row.stock_minimo,
            imagen_url: null,
            activo: row.activo,
            destacado: false,
          })
          .select()
          .single();

        if (error || !newProduct) {
          const dup = error?.code === "23505" || /duplicate|ya existe/i.test(error?.message || "");
          fallidos.push({ sku: row.sku, motivo: dup ? "SKU ya existe" : (error?.message || "error al insertar") });
          continue;
        }

        if (defaultEmpaque) {
          // Relación con empaque usando las columnas reales (no cantidad/es_principal)
          const { error: eErr } = await supabase.from('producto_empaques').insert({
            producto_id: newProduct.id,
            tipo_empaque_id: defaultEmpaque.id,
            precio_empaque: null,
            activo: true,
          });
          if (eErr) {
            // el producto quedó creado; solo avisamos del empaque
            fallidos.push({ sku: row.sku, motivo: `producto creado, pero falló el empaque: ${eErr.message}` });
          }
        }
        importados++;
      }

      if (fallidos.length === 0) {
        toast({ title: "Importación exitosa", description: `${importados} productos importados correctamente` });
      } else {
        const detalle = fallidos.slice(0, 5).map(f => `${f.sku}: ${f.motivo}`).join(" · ");
        toast({
          title: `Importación parcial: ${importados} ok, ${fallidos.length} con problemas`,
          description: detalle + (fallidos.length > 5 ? ` … y ${fallidos.length - 5} más` : ""),
          variant: "destructive",
        });
      }

      setIsImportOpen(false);
      setImportData([]);
      setImportErrors([]);
      fetchData();
    } catch (error) {
      toast({ title: "Error", description: "Error durante la importación", variant: "destructive" });
    } finally {
      setIsImporting(false);
    }
  };

  const filteredProductos = productos.filter(p => {
    const matchSearch = p.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
                       p.sku.toLowerCase().includes(searchTerm.toLowerCase());
    const matchCategoria = categoriaFilter === "all" || p.categoria_id === categoriaFilter;
    return matchSearch && matchCategoria;
  });

  const pagination = usePagination(filteredProductos, 25);

  const stats = {
    total: productos.length,
    disponibles: productos.filter(p => p.stock_actual > p.stock_minimo).length,
    bajoStock: productos.filter(p => p.stock_actual > 0 && p.stock_actual <= p.stock_minimo).length,
    agotados: productos.filter(p => p.stock_actual === 0).length,
  };

  const getStatus = (p: Producto) => {
    if (p.stock_actual === 0) return { label: "Agotado", variant: "destructive" as const };
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
        <TableCell className="font-mono text-sm text-primary">{producto.sku}</TableCell>
        <TableCell className="font-medium">
          <div className="flex items-center gap-2">
            {producto.imagen_url ? (
              <img src={producto.imagen_url} alt={producto.nombre} className="h-8 w-8 rounded object-cover" />
            ) : (
              <Package className="h-5 w-5 text-muted-foreground" />
            )}
            {producto.nombre}
          </div>
        </TableCell>
        <TableCell className="text-muted-foreground">{producto.categoria?.nombre || 'Sin Categoría'}</TableCell>
        <TableCell>
          <div className="flex flex-wrap gap-1">
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
        <TableCell className="text-right font-semibold">{formatPrice(producto.precio_base)}</TableCell>
        <TableCell className="text-center">{producto.stock_actual}</TableCell>
        <TableCell>
          <Badge variant={status.variant}>{status.label}</Badge>
        </TableCell>
        <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
          <Switch checked={producto.activo} onCheckedChange={(checked) => handleToggleActivo(producto.id, checked)} />
        </TableCell>
        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditSheet(producto)}>
              <Edit className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:text-destructive"
              onClick={() => { setSelectedProducto(producto); setIsDeleteOpen(true); }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </TableCell>
      </TableRow>
    );
  };

  return (
    <MainLayout title="Productos">
      {/* Stats */}
      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <Package className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.total}</p>
              <p className="text-sm text-muted-foreground">Total Productos</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-success/10 p-2">
              <Package className="h-5 w-5 text-success" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.disponibles}</p>
              <p className="text-sm text-muted-foreground">Disponibles</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-warning/10 p-2">
              <Package className="h-5 w-5 text-warning" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.bajoStock}</p>
              <p className="text-sm text-muted-foreground">Bajo Stock</p>
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

      {/* Header Actions */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
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
          <Select value={categoriaFilter} onValueChange={setCategoriaFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Categoría" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              {categorias.map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>{cat.nombre}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button variant={grouped ? "default" : "outline"} className="gap-2" onClick={() => setGrouped((g) => !g)}>
            <FolderOpen className="h-4 w-4" />
            {grouped ? "Agrupado por categoría" : "Agrupar por categoría"}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2">
                <Upload className="h-4 w-4" />
                Importar
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={downloadTemplate}>
                <Download className="h-4 w-4 mr-2" />
                Descargar Plantilla
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Subir Archivo (CSV/Excel)
              </DropdownMenuItem>
            </DropdownMenuContent>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt,.xlsx,.xls"
              className="hidden"
              onChange={handleFileUpload}
            />
          </DropdownMenu>
          <Button className="gap-2" onClick={() => { resetForm(); setIsCreateOpen(true); }}>
            <Plus className="h-4 w-4" />
            Nuevo Producto
          </Button>
        </div>
      </div>

      {/* Bulk Actions Bar */}
      {selectedIds.length > 0 && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 p-3">
          <div className="flex items-center gap-3">
            <Checkbox
              checked={selectedIds.length === filteredProductos.length}
              onCheckedChange={toggleSelectAll}
            />
            <span className="font-medium text-primary">
              {selectedIds.length} producto{selectedIds.length > 1 ? 's' : ''} seleccionado{selectedIds.length > 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="gap-2" onClick={handleBulkActivate}>
              <CheckSquare className="h-4 w-4" />
              Activar
            </Button>
            <Button size="sm" variant="outline" className="gap-2" onClick={handleBulkDeactivate}>
              <XSquare className="h-4 w-4" />
              Desactivar
            </Button>
            <Button size="sm" variant="outline" className="gap-2" onClick={() => setIsBulkCategoryOpen(true)}>
              <FolderOpen className="h-4 w-4" />
              Cambiar Categoría
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="gap-2">
                  <MoreHorizontal className="h-4 w-4" />
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
                <DropdownMenuSeparator />
                <DropdownMenuItem 
                  className="text-destructive"
                  onClick={() => setIsBulkDeleteOpen(true)}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Eliminar Seleccionados
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds([])}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

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
                <TableHead className="w-12">
                  <Checkbox
                    checked={selectedIds.length === filteredProductos.length && filteredProductos.length > 0}
                    onCheckedChange={toggleSelectAll}
                  />
                </TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Producto</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead>Empaque</TableHead>
                <TableHead className="text-right">Precio Base</TableHead>
                <TableHead className="text-center">Stock</TableHead>
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
                        <TableCell colSpan={10}>
                          <div className="flex items-center gap-2 font-medium">
                            <ChevronRight className={cn("h-4 w-4 shrink-0 transition-transform", openGroups.has(g.key) && "rotate-90")} />
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
          <div className="border-t border-border px-4 py-2.5 text-sm text-muted-foreground">
            {grupos.length} categoría{grupos.length !== 1 ? "s" : ""} · {filteredProductos.length} productos
          </div>
        )}
      </div>

      {/* Create Product Sheet */}
      <Sheet open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Crear Producto</SheetTitle>
          </SheetHeader>
          <div className="grid gap-4 py-4">
            {/* Image Upload */}
            <div className="space-y-2">
              <Label>Imágenes del Producto</Label>
              <ProductImagesInput images={imagenes} onChange={setImagenes} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>SKU</Label>
                <Input
                  placeholder="Auto-generado"
                  value={formData.sku}
                  onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Nombre *</Label>
                <Input
                  placeholder="Nombre del producto"
                  value={formData.nombre}
                  onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Descripción</Label>
              <Textarea
                placeholder="Descripción del producto"
                value={formData.descripcion}
                onChange={(e) => setFormData({ ...formData, descripcion: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Categoría</Label>
              <Select value={formData.categoria_id} onValueChange={(v) => setFormData({ ...formData, categoria_id: v })}>
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
                      id={`create-emp-${emp.id}`}
                      checked={formData.empaques_ids.includes(emp.id)}
                      onCheckedChange={() => toggleEmpaque(emp.id)}
                    />
                    <label
                      htmlFor={`create-emp-${emp.id}`}
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
                <Label>Precio Base *</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.precio_base}
                  onChange={(e) => setFormData({ ...formData, precio_base: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div className="space-y-2">
                <Label>Costo</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.costo}
                  onChange={(e) => setFormData({ ...formData, costo: parseFloat(e.target.value) || 0 })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Stock Actual</Label>
                <Input
                  type="number"
                  min="0"
                  value={formData.stock_actual}
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
                <Label>Activo</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={formData.destacado}
                  onCheckedChange={(v) => setFormData({ ...formData, destacado: v })}
                />
                <Label>Destacado</Label>
              </div>
            </div>

            <div className="flex gap-2 pt-4">
              <Button variant="outline" className="flex-1" onClick={() => setIsCreateOpen(false)}>
                Cancelar
              </Button>
              <Button className="flex-1" onClick={handleCreate}>
                Crear Producto
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Edit Product Sheet */}
      <Sheet open={isEditOpen} onOpenChange={setIsEditOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Editar Producto</SheetTitle>
          </SheetHeader>
          <div className="grid gap-4 py-4">
            {/* Image Upload */}
            <div className="space-y-2">
              <Label>Imágenes del Producto</Label>
              <ProductImagesInput images={imagenes} onChange={setImagenes} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>SKU</Label>
                <Input
                  value={formData.sku}
                  onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Nombre *</Label>
                <Input
                  value={formData.nombre}
                  onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Descripción</Label>
              <Textarea
                value={formData.descripcion}
                onChange={(e) => setFormData({ ...formData, descripcion: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Categoría</Label>
              <Select value={formData.categoria_id} onValueChange={(v) => setFormData({ ...formData, categoria_id: v })}>
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
                <Label>Precio Base *</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.precio_base}
                  onChange={(e) => setFormData({ ...formData, precio_base: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div className="space-y-2">
                <Label>Costo</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.costo}
                  onChange={(e) => setFormData({ ...formData, costo: parseFloat(e.target.value) || 0 })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Stock Actual</Label>
                <Input
                  type="number"
                  min="0"
                  value={formData.stock_actual}
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
                <Label>Activo</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={formData.destacado}
                  onCheckedChange={(v) => setFormData({ ...formData, destacado: v })}
                />
                <Label>Destacado</Label>
              </div>
            </div>

            <div className="flex gap-2 pt-4">
              <Button variant="outline" className="flex-1" onClick={() => setIsEditOpen(false)}>
                Cancelar
              </Button>
              <Button className="flex-1" onClick={handleEdit}>
                Guardar Cambios
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Delete Confirmation */}
      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar producto?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. El producto "{selectedProducto?.nombre}" será eliminado permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Delete Confirmation */}
      <AlertDialog open={isBulkDeleteOpen} onOpenChange={setIsBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar {selectedIds.length} productos?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. Los {selectedIds.length} productos seleccionados serán eliminados permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Eliminar {selectedIds.length} productos
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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

      {/* Import Preview Dialog */}
      <Dialog open={isImportOpen} onOpenChange={setIsImportOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              Vista Previa de Importación
            </DialogTitle>
          </DialogHeader>
          
          {/* Summary */}
          <div className="flex gap-4 py-2">
            <div className="flex items-center gap-2 text-sm">
              <Badge variant="default">{importData.length}</Badge>
              <span className="text-muted-foreground">Total productos</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Badge variant="default" className="bg-green-500">
                {importData.filter(r => r.valid).length}
              </Badge>
              <span className="text-muted-foreground">Válidos</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Badge variant="destructive">
                {importData.filter(r => !r.valid).length}
              </Badge>
              <span className="text-muted-foreground">Con errores</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Badge variant="secondary">
                {importData.filter(r => r.errors.length > 0 && r.valid).length}
              </Badge>
              <span className="text-muted-foreground">Con advertencias</span>
            </div>
          </div>

          {/* Table */}
          <ScrollArea className="h-[400px] rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">Estado</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Categoría</TableHead>
                  <TableHead className="text-right">Precio</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead>Activo</TableHead>
                  <TableHead>Observaciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {importData.map((row, index) => (
                  <TableRow key={index} className={!row.valid ? 'bg-destructive/5' : row.errors.length > 0 ? 'bg-yellow-500/5' : ''}>
                    <TableCell>
                      {row.valid ? (
                        row.errors.length > 0 ? (
                          <AlertCircle className="h-4 w-4 text-yellow-500" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        )
                      ) : (
                        <AlertCircle className="h-4 w-4 text-destructive" />
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{row.sku}</TableCell>
                    <TableCell>
                      <Input
                        value={row.nombre}
                        onChange={(e) => updateImportRow(index, 'nombre', e.target.value)}
                        className={`h-8 ${!row.nombre ? 'border-destructive' : ''}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Select 
                        value={row.categoria_id || 'none'} 
                        onValueChange={(v) => updateImportRow(index, 'categoria_id', v === 'none' ? '' : v)}
                      >
                        <SelectTrigger className="h-8 w-32">
                          <SelectValue placeholder="Sin categoría" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Sin categoría</SelectItem>
                          {categorias.map((cat) => (
                            <SelectItem key={cat.id} value={cat.id}>{cat.nombre}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        step="0.01"
                        value={row.precio_base}
                        onChange={(e) => updateImportRow(index, 'precio_base', parseFloat(e.target.value) || 0)}
                        className={`h-8 w-24 text-right ${row.precio_base <= 0 ? 'border-destructive' : ''}`}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        value={row.stock_actual}
                        onChange={(e) => updateImportRow(index, 'stock_actual', parseInt(e.target.value) || 0)}
                        className="h-8 w-20 text-right"
                      />
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={row.activo}
                        onCheckedChange={(checked) => updateImportRow(index, 'activo', checked)}
                      />
                    </TableCell>
                    <TableCell>
                      {row.errors.length > 0 && (
                        <div className="text-xs text-muted-foreground">
                          {row.errors.map((err, i) => (
                            <span key={i} className={row.valid ? 'text-yellow-600' : 'text-destructive'}>
                              {err}{i < row.errors.length - 1 ? ', ' : ''}
                            </span>
                          ))}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setIsImportOpen(false); setImportData([]); }}>
              Cancelar
            </Button>
            <Button 
              onClick={handleImport} 
              disabled={isImporting || importData.filter(r => r.valid).length === 0}
              className="gap-2"
            >
              {isImporting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Importando...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  Importar {importData.filter(r => r.valid).length} productos
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
};

export default Productos;
