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
import { ArrowUpRight, ArrowDownLeft, Package, Loader2, RefreshCw, ChevronRight, Boxes, ArrowLeftRight } from "lucide-react";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { BarraLista } from "@/components/datos/BarraLista";
import { useOrdenTabla, EncabezadoOrdenable, exportarCSV, BotonExportar } from "@/components/datos/tabla";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { VencimientoBadge, estadoVencimiento } from "@/components/inventario/VencimientoBadge";
import { OdooBadge } from "@/components/OdooBadge";
import { supabase, Producto } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { useColumnas } from "@/components/datos/columnas";
import {
  FiltrosLista, useFiltros, useFiltroEmpresa, opcionesDe, opcionesPrueba, pasaPrueba, coincide, enRango, contadorFiltrado,
  type OpcionPrueba, type DefFiltro,
} from "@/components/datos/FiltrosLista";

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
  reservado: number;
  empresa_id?: string | null;
  almacen: { id: string; nombre: string; tipo: string } | null;
  producto: { id: string; nombre: string; sku: string; categoria_id: string | null } | null;
}

interface ProductoConCategoria extends Omit<Producto, 'categoria'> {
  categoria?: { nombre: string } | null;
}

interface LoteRow {
  id: string;
  nombre: string;
  es_serie: boolean;
  vencimiento: string | null;
  cantidad: number;
  empresa_id?: string | null;
  producto: { id: string; nombre: string; sku: string; categoria_id: string | null } | null;
}
const FILTROS_LOTE: Record<string, string> = {
  vencidos: "Vencidos con existencia", "30": "Vencen en 30 días", "90": "Vencen en 90 días",
  existencia: "Todos con existencia", sin_fecha: "Sin fecha de vencimiento", todos: "Todos los lotes",
};

// Filtros de cada pestaña (en la URL). Al cambiar de pestaña se quitan los que la nueva no tiene; "categoria", "almacen" y
// "empresa" significan lo mismo en todas y se conservan donde existen.
const CLAVES_TAB: Record<string, string[]> = {
  stock: ["alcance", "categoria", "estado", "almacen", "lote", "empresa"],
  almacenes: ["tipo_almacen", "almacen", "categoria", "empresa"],
  lotes: ["lotes", "categoria", "tipo_lote", "empresa"],
  movements: ["tipo_mov", "fecha"],
};


// Comprometido (entregas pendientes en Odoo + pedidos de GUDS sin pasar a Odoo) y disponible para vender
function CeldasReservado({ item }: { item: Pick<Producto, "controla_stock" | "comprometido_odoo" | "comprometido_guds" | "stock_disponible" | "stock_actual"> }) {
  if (item.controla_stock === false) {
    return <><TableCell className="text-right text-muted-foreground">—</TableCell><TableCell className="whitespace-nowrap text-right text-xs text-muted-foreground">Sin control de stock</TableCell></>;
  }
  const comprometido = Number(item.comprometido_odoo || 0) + Number(item.comprometido_guds || 0);
  const disponible = Number(item.stock_disponible ?? item.stock_actual ?? 0);
  return (
    <>
      <TableCell className="whitespace-nowrap text-right text-muted-foreground" title={comprometido > 0 ? `Odoo: ${Number(item.comprometido_odoo || 0)} · Pedidos GUDS: ${Number(item.comprometido_guds || 0)}` : undefined}>
        {comprometido > 0 ? comprometido.toLocaleString("es-VE") : "—"}
      </TableCell>
      <TableCell className={cn("whitespace-nowrap text-right font-semibold", comprometido > 0 && disponible === 0 && "text-destructive")}>{disponible.toLocaleString("es-VE")}</TableCell>
    </>
  );
}

const Inventario = () => {
  const [productos, setProductos] = useState<ProductoConCategoria[]>([]);
  const [movimientos, setMovimientos] = useState<MovimientoInventario[]>([]);
  const [invAlmacen, setInvAlmacen] = useState<InvAlmacenRow[]>([]);
  const [lotes, setLotes] = useState<LoteRow[]>([]);
  const [loteSearch, setLoteSearch] = useState("");
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [agruparCategoria, setAgruparCategoria] = useState(false);
  const [openCat, setOpenCat] = useState<Set<string>>(new Set());
  const toggleCat = (k: string) => setOpenCat((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const [movementSearchTerm, setMovementSearchTerm] = useState("");
  const [almSearch, setAlmSearch] = useState("");
  const [openAlm, setOpenAlm] = useState<Set<string>>(new Set());
  const toggleAlm = (k: string) => setOpenAlm((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  
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
    const [productosRes, movimientosRes, invAlmRes, lotesRes] = await Promise.all([
      supabase.from('productos').select('*, categoria:categorias(nombre)').order('nombre'),
      supabase.from('movimientos_inventario').select('*, producto:productos(nombre, sku)').order('created_at', { ascending: false }).limit(50),
      supabase.from('inventario_almacen').select('id, cantidad, reservado, empresa_id, almacen:almacenes(id, nombre, tipo), producto:productos(id, nombre, sku, categoria_id)').limit(5000),
      supabase.from('lotes').select('id, nombre, es_serie, vencimiento, cantidad, empresa_id, producto:productos(id, nombre, sku, categoria_id)').order('vencimiento', { ascending: true, nullsFirst: false }),
    ]);
    if (lotesRes.data) setLotes(lotesRes.data as unknown as LoteRow[]);

    if (productosRes.data) setProductos(productosRes.data as unknown as ProductoConCategoria[]);
    if (movimientosRes.data) setMovimientos(movimientosRes.data);
    if (invAlmRes.data) setInvAlmacen(invAlmRes.data as unknown as InvAlmacenRow[]);
    setLoading(false);
  };

  // Nombre de cada categoría (para las opciones de las pestañas cuyas filas solo traen categoria_id)
  const nombreCategoria = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of productos) if (p.categoria_id && p.categoria?.nombre) m.set(p.categoria_id, p.categoria.nombre.trim());
    return m;
  }, [productos]);

  // ---- Pestaña activa y filtros (en la URL) ----
  const tab = (["almacenes", "lotes", "movements"].includes(params.get("tab") ?? "") ? params.get("tab") : "stock") as string;
  const setTab = (t: string) => setParams((p) => {
    const n = new URLSearchParams(p);
    if (t === "stock") n.delete("tab"); else n.set("tab", t);
    for (const k of new Set(Object.values(CLAVES_TAB).flat())) if (!CLAVES_TAB[t].includes(k)) n.delete(k);
    return n;
  }, { replace: true });

  const esAlmacenable = (p: ProductoConCategoria) => p.activo && p.controla_stock !== false;
  const estadoStock = (p: ProductoConCategoria) =>
    p.controla_stock === false ? "servicio" : p.stock_actual <= 0 ? "agotado" : p.stock_actual <= p.stock_minimo ? "bajo" : "ok";
  const ETIQUETA_ESTADO: Record<string, string> = { ok: "OK", bajo: "Bajo", agotado: "Agotado", servicio: "Servicio" };

  // Existencias por almacén y lotes con existencia de cada producto
  const almacenesDe = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const r of invAlmacen) {
      if (!r.producto || !r.almacen || !(Number(r.cantidad) > 0)) continue;
      const s = m.get(r.producto.id) ?? new Set<string>(); s.add(r.almacen.id); m.set(r.producto.id, s);
    }
    return m;
  }, [invAlmacen]);
  const lotesDe = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of lotes) {
      if (!l.producto || !(Number(l.cantidad) > 0)) continue;
      const s = m.get(l.producto.id) ?? new Set<string>(); s.add(estadoVencimiento(l.vencimiento)); m.set(l.producto.id, s);
    }
    return m;
  }, [lotes]);

  const pruebasEstado: OpcionPrueba<ProductoConCategoria>[] = [
    { valor: "ok", etiqueta: "OK (sobre el mínimo)", prueba: (p) => estadoStock(p) === "ok" },
    { valor: "bajo", etiqueta: "Bajo mínimo", prueba: (p) => estadoStock(p) === "bajo" },
    { valor: "agotado", etiqueta: "Agotado", prueba: (p) => estadoStock(p) === "agotado" },
    { valor: "servicio", etiqueta: "Servicio (sin stock)", prueba: (p) => estadoStock(p) === "servicio" },
  ];
  const pruebasLoteProducto: OpcionPrueba<ProductoConCategoria>[] = [
    { valor: "vencidos", etiqueta: "Con lotes vencidos", prueba: (p) => !!lotesDe.get(p.id)?.has("vencido") },
    { valor: "30", etiqueta: "Con lotes que vencen en 30 días", prueba: (p) => !!lotesDe.get(p.id)?.has("30") },
    { valor: "90", etiqueta: "Con lotes que vencen en 90 días", prueba: (p) => { const s = lotesDe.get(p.id); return !!s && (s.has("30") || s.has("90")); } },
  ];
  const almacenesOpc = useMemo(() => opcionesDe(invAlmacen.filter((r) => r.almacen && Number(r.cantidad) > 0), (r) => r.almacen!.id, (r) => r.almacen!.nombre), [invAlmacen]);
  // Productos del alcance (como el inventario de Odoo: por defecto solo almacenables activos)
  const alcanceTodos = params.get("alcance") === "todos";
  const enAlcance = useMemo(() => (alcanceTodos ? productos : productos.filter(esAlmacenable)), [productos, alcanceTodos]);

  const filtroEmpresaProd = useFiltroEmpresa(productos);
  const filtroEmpresaAlm = useFiltroEmpresa(invAlmacen);
  const filtroEmpresaLote = useFiltroEmpresa(lotes);
  const catOpc = <T,>(filas: T[], id: (f: T) => string | null | undefined) =>
    opcionesDe(filas, id, (_f, v) => nombreCategoria.get(v) ?? "—", "Sin categoría");
  const pruebasLote: OpcionPrueba<LoteRow>[] = [
    { valor: "lote", etiqueta: "Lotes", prueba: (l) => !l.es_serie }, { valor: "serie", etiqueta: "Números de serie", prueba: (l) => l.es_serie },
  ];
  const pruebasMov: OpcionPrueba<MovimientoInventario>[] = [
    { valor: "entrada", etiqueta: "Entradas", prueba: (m) => m.tipo === "entrada" }, { valor: "salida", etiqueta: "Salidas", prueba: (m) => m.tipo === "salida" },
    { valor: "ajuste", etiqueta: "Ajustes", prueba: (m) => m.tipo === "ajuste" },
  ];
  const defsPorTab: Record<string, (DefFiltro | null)[]> = {
    stock: [
      { clave: "categoria", etiqueta: "Categoría", todos: "Todas", principal: true, opciones: catOpc(enAlcance, (p) => p.categoria_id) },
      { clave: "estado", etiqueta: "Estado", principal: true, opciones: opcionesPrueba(enAlcance, pruebasEstado, true) },
      { clave: "almacen", etiqueta: "Almacén", todos: "Todos los almacenes", principal: true, opciones: almacenesOpc },
      { clave: "lote", etiqueta: "Lotes", todos: "Todos", opciones: opcionesPrueba(enAlcance, pruebasLoteProducto) },
      { clave: "alcance", etiqueta: "Productos", porDefecto: "almacenables", opciones: [
        { valor: "almacenables", etiqueta: "Almacenables activos", n: productos.filter(esAlmacenable).length },
        { valor: "todos", etiqueta: "Todos (con servicios e inactivos)", n: productos.length },
      ] },
      filtroEmpresaProd,
    ],
    almacenes: [
      { clave: "tipo_almacen", etiqueta: "Tipo", todos: "Todos los almacenes", principal: true, opciones: opcionesPrueba(invAlmacen, [
        { valor: "propio", etiqueta: "Solo propios", prueba: (r) => r.almacen?.tipo === "propio" },
        { valor: "consignacion", etiqueta: "Solo consignación", prueba: (r) => r.almacen?.tipo === "consignacion" },
      ]) },
      { clave: "almacen", etiqueta: "Almacén", todos: "Todos los almacenes", principal: true, opciones: almacenesOpc },
      { clave: "categoria", etiqueta: "Categoría", todos: "Todas", principal: true, opciones: catOpc(invAlmacen, (r) => r.producto?.categoria_id) },
      filtroEmpresaAlm,
    ],
    lotes: [
      { clave: "lotes", etiqueta: "Vencimiento", porDefecto: "90", principal: true, opciones: Object.entries(FILTROS_LOTE).map(([valor, etiqueta]) => ({ valor, etiqueta })) },
      { clave: "categoria", etiqueta: "Categoría", todos: "Todas", principal: true, opciones: catOpc(lotes, (l) => l.producto?.categoria_id) },
      { clave: "tipo_lote", etiqueta: "Tipo", todos: "Lotes y series", opciones: opcionesPrueba(lotes, pruebasLote) },
      filtroEmpresaLote,
    ],
    movements: [
      { clave: "tipo_mov", etiqueta: "Tipo", principal: true, opciones: opcionesPrueba(movimientos, pruebasMov) },
      { clave: "fecha", etiqueta: "Fecha", tipo: "fecha", principal: true },
    ],
  };
  const f = useFiltros(defsPorTab[tab]);
  const loteFiltro = tab === "lotes" ? f.v("lotes") : "90";
  const setLoteFiltro = (v: string) => f.set("lotes", v);

  const termino = searchTerm.toLowerCase();
  const filteredProductos = enAlcance.filter(p =>
    (p.nombre.toLowerCase().includes(termino) || p.sku.toLowerCase().includes(termino)) &&
    coincide(p.categoria_id, f.v("categoria")) && pasaPrueba(pruebasEstado, f.v("estado"), p) &&
    (!f.v("almacen") || !!almacenesDe.get(p.id)?.has(f.v("almacen"))) && pasaPrueba(pruebasLoteProducto, f.v("lote"), p) &&
    (!filtroEmpresaProd || coincide(p.empresa_id, f.v("empresa")))
  );
  const { ordenadas, orden, alternar } = useOrdenTabla(filteredProductos, {
    sku: (p) => p.sku, nombre: (p) => p.nombre, stock: (p) => Number(p.stock_actual || 0),
    comprometido: (p) => Number(p.comprometido_odoo || 0) + Number(p.comprometido_guds || 0),
    disponible: (p) => (p.controla_stock === false ? null : Number(p.stock_disponible ?? p.stock_actual ?? 0)),
    minimo: (p) => Number(p.stock_minimo || 0), maximo: (p) => Number(p.stock_maximo || 0), estado: (p) => estadoStock(p),
  });
  const pagination = usePagination(ordenadas, 50, f.firma);
  const exportar = () => exportarCSV("inventario", ordenadas, [
    { titulo: "SKU", valor: (p) => p.sku }, { titulo: "Producto", valor: (p) => p.nombre }, { titulo: "Categoría", valor: (p) => p.categoria?.nombre },
    { titulo: "Stock", valor: (p) => Number(p.stock_actual || 0) },
    { titulo: "Comprometido Odoo", valor: (p) => Number(p.comprometido_odoo || 0) }, { titulo: "Comprometido GUDS", valor: (p) => Number(p.comprometido_guds || 0) },
    { titulo: "Disponible", valor: (p) => (p.controla_stock === false ? null : Number(p.stock_disponible ?? p.stock_actual ?? 0)) },
    { titulo: "Mínimo", valor: (p) => Number(p.stock_minimo || 0) }, { titulo: "Máximo", valor: (p) => Number(p.stock_maximo || 0) },
    { titulo: "Estado", valor: (p) => ETIQUETA_ESTADO[estadoStock(p)] }, { titulo: "Activo", valor: (p) => (p.activo ? "Sí" : "No") },
  ]);


  const lotesConExistencia = useMemo(() => lotes.filter((l) => Number(l.cantidad) > 0), [lotes]);
  const conteoLotes = useMemo(() => ({
    vencidos: lotesConExistencia.filter((l) => estadoVencimiento(l.vencimiento) === "vencido").length,
    d30: lotesConExistencia.filter((l) => estadoVencimiento(l.vencimiento) === "30").length,
    d90: lotesConExistencia.filter((l) => ["30", "90"].includes(estadoVencimiento(l.vencimiento))).length,
    sinFecha: lotes.filter((l) => !l.vencimiento).length,
  }), [lotes, lotesConExistencia]);
  const lotesFiltrados = useMemo(() => {
    const q = loteSearch.trim().toLowerCase();
    const cat = tab === "lotes" ? f.v("categoria") : "", tipoLote = tab === "lotes" ? f.v("tipo_lote") : "";
    const emp = tab === "lotes" && filtroEmpresaLote ? f.v("empresa") : "";
    return lotes.filter((l) => {
      const e = estadoVencimiento(l.vencimiento);
      const ex = Number(l.cantidad) > 0;
      const ok = loteFiltro === "todos" ? true : loteFiltro === "existencia" ? ex : loteFiltro === "sin_fecha" ? e === "sin_fecha"
        : loteFiltro === "vencidos" ? ex && e === "vencido" : loteFiltro === "30" ? ex && e === "30" : ex && (e === "30" || e === "90");
      return ok && coincide(l.producto?.categoria_id, cat) && pasaPrueba(pruebasLote, tipoLote, l) && coincide(l.empresa_id, emp)
        && (!q || l.nombre.toLowerCase().includes(q) || l.producto?.nombre?.toLowerCase().includes(q) || l.producto?.sku?.toLowerCase().includes(q));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lotes, loteSearch, loteFiltro, tab, f.firma]);
  const paginacionLotes = usePagination(lotesFiltrados, 50, f.firma);
  // El stock de los productos de Odoo se mueve en Odoo: el ajuste manual es solo para productos propios de GUDS
  const productosPropios = useMemo(() => productos.filter((p) => !p.odoo_id), [productos]);

  const gruposCategoria = useMemo(() => {
    const m = new Map<string, { key: string; nombre: string; items: ProductoConCategoria[] }>();
    for (const p of ordenadas) {
      const key = p.categoria?.nombre || "Sin categoría";
      const g = m.get(key) || { key, nombre: key, items: [] };
      g.items.push(p);
      m.set(key, g);
    }
    return [...m.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [ordenadas]);

  const filteredMovimientos = movimientos.filter(m => {
    const matchesSearch = movementSearchTerm === "" ||
      (m.producto as any)?.nombre?.toLowerCase().includes(movementSearchTerm.toLowerCase()) ||
      (m.producto as any)?.sku?.toLowerCase().includes(movementSearchTerm.toLowerCase());
    return matchesSearch && (tab !== "movements" || (pasaPrueba(pruebasMov, f.v("tipo_mov"), m) && enRango(m.created_at, f.v("fecha"))));
  });

  const pagination2 = usePagination(filteredMovimientos, 50, f.firma);

  const totalAlmacenes = useMemo(() => new Set(invAlmacen.filter((r) => r.almacen).map((r) => r.almacen!.id)).size, [invAlmacen]);
  const gruposAlm = useMemo(() => {
    const m = new Map<string, { key: string; nombre: string; tipo: string; items: InvAlmacenRow[]; total: number }>();
    const q = almSearch.toLowerCase();
    const enTab = tab === "almacenes";
    const tipoAlm = enTab ? f.v("tipo_almacen") : "", alm = enTab ? f.v("almacen") : "", cat = enTab ? f.v("categoria") : "";
    const emp = enTab && filtroEmpresaAlm ? f.v("empresa") : "";
    for (const r of invAlmacen) {
      if (!r.almacen) continue;
      if (tipoAlm && r.almacen.tipo !== tipoAlm) continue;
      if (!coincide(r.almacen.id, alm) || !coincide(r.producto?.categoria_id, cat) || !coincide(r.empresa_id, emp)) continue;
      if (q && !(r.almacen.nombre.toLowerCase().includes(q) || r.producto?.nombre?.toLowerCase().includes(q) || r.producto?.sku?.toLowerCase().includes(q))) continue;
      const key = r.almacen.id;
      const g = m.get(key) || { key, nombre: r.almacen.nombre, tipo: r.almacen.tipo, items: [], total: 0 };
      g.items.push(r); g.total += Number(r.cantidad || 0);
      m.set(key, g);
    }
    return [...m.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invAlmacen, almSearch, tab, f.firma]);

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

  const almacenables = productos.filter(esAlmacenable);
  const stats = {
    total: almacenables.length,
    otros: productos.length - almacenables.length,
    bajoMinimo: almacenables.filter(p => p.stock_actual > 0 && p.stock_actual <= p.stock_minimo).length,
    agotados: almacenables.filter(p => p.stock_actual <= 0).length,
  };

  // Indicadores de stock: al pulsarlos fijan el filtro (sobre almacenables activos, como el indicador)
  const alcance = f.v("alcance") === "todos" ? "todos" : "almacenables";
  const kpiEstado = (estado: string) => () =>
    f.v("estado") === estado && tab === "stock" ? f.setVarios({ estado: "", alcance: "" })
      : tab === "stock" ? f.setVarios({ estado, alcance: "" })
      : setParams((p) => { const n = new URLSearchParams(p); n.delete("tab"); for (const k of Object.values(CLAVES_TAB).flat()) n.delete(k); n.set("estado", estado); return n; }, { replace: true });
  const kpiAlcance = (a: "almacenables" | "todos") => () => {
    if (tab === "stock") f.set("alcance", a);
    else setParams((p) => { const n = new URLSearchParams(p); n.delete("tab"); for (const k of Object.values(CLAVES_TAB).flat()) n.delete(k); if (a === "todos") n.set("alcance", a); return n; }, { replace: true });
  };
  const pestanas = (
    <TabsList className="h-auto flex-wrap justify-start">
      <TabsTrigger value="stock">Stock Actual</TabsTrigger>
      <TabsTrigger value="almacenes">Por Almacén</TabsTrigger>
      <TabsTrigger value="lotes">Lotes y vencimientos</TabsTrigger>
      <TabsTrigger value="movements">Movimientos GUDS</TabsTrigger>
    </TabsList>
  );

  const cols = useColumnas("inventario", [{ etiqueta: "SKU" }, { etiqueta: "Producto", fija: true }, { etiqueta: "Stock" }, { etiqueta: "Comprometido" }, { etiqueta: "Disponible" }, { etiqueta: "Mínimo" }, { etiqueta: "Máximo" }, { etiqueta: "Estado" }]);
  return (
    <MainLayout title="Inventario">
      {cols.estilo}
      <KpiStrip items={[
        { label: "Almacenables activos", valor: stats.total, tono: "primario", onClick: kpiAlcance("almacenables"), activo: tab === "stock" && alcance === "almacenables", titulo: "Ver solo productos almacenables activos (como el inventario de Odoo)" },
        { label: "Servicios e inactivos", valor: stats.otros, tono: "tenue", detalle: alcance === "todos" ? "mostrándose en la lista" : "ocultos · clic para ver", onClick: kpiAlcance(alcance === "todos" ? "almacenables" : "todos"), activo: tab === "stock" && alcance === "todos" },
        {
          label: "Lotes vencen en 90 días", valor: conteoLotes.d90, tono: "alerta",
          detalle: conteoLotes.vencidos > 0 ? <span className="text-destructive">{conteoLotes.vencidos} vencidos con existencia</span> : undefined,
        },
        { label: "Agotados", valor: stats.agotados, tono: "negativo", onClick: kpiEstado("agotado"), activo: tab === "stock" && f.v("estado") === "agotado", titulo: "Ver los almacenables activos agotados" },
        { label: "Bajo Mínimo", valor: stats.bajoMinimo, tono: "alerta", onClick: kpiEstado("bajo"), activo: tab === "stock" && f.v("estado") === "bajo", titulo: "Ver los almacenables activos bajo el mínimo" },
      ]} />

      <Tabs value={tab} onValueChange={setTab}>
        {/* Pestañas, búsqueda, filtros y acciones de la pestaña activa en una sola fila */}
        {tab === "stock" ? (
          <BarraLista
            pestanas={pestanas}
            busqueda={searchTerm}
            onBusqueda={setSearchTerm}
            placeholder="Buscar producto..."
            filtros={<FiltrosLista filtros={f} resultados={filteredProductos.length} />}
            contador={loading ? undefined : contadorFiltrado(filteredProductos.length, enAlcance.length, f.activos || !!searchTerm)}
            acciones={
              <>
                {cols.selector}
                <Button size="sm" variant={agruparCategoria ? "default" : "outline"} className="h-8 w-8 px-0" title={agruparCategoria ? "Agrupado por categoría (quitar)" : "Agrupar por categoría"} aria-label="Agrupar por categoría" onClick={() => setAgruparCategoria((g) => !g)}>
                  <Boxes className="h-3.5 w-3.5" />
                </Button>
                <BotonExportar soloIcono onClick={exportar} total={ordenadas.length} />
                <Button size="sm" className="gap-1.5" title="Ajuste de inventario" onClick={() => openMovementDialog('ajuste')}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  Ajuste
                </Button>
              </>
            }
          />
        ) : tab === "almacenes" ? (
          <BarraLista
            pestanas={pestanas}
            busqueda={almSearch}
            onBusqueda={setAlmSearch}
            placeholder="Buscar almacén o producto..."
            filtros={<FiltrosLista filtros={f} resultados={gruposAlm.length} />}
            contador={loading ? undefined : contadorFiltrado(gruposAlm.length, totalAlmacenes, f.activos || !!almSearch, "almacenes")}
          />
        ) : tab === "lotes" ? (
          <BarraLista
            pestanas={pestanas}
            busqueda={loteSearch}
            onBusqueda={setLoteSearch}
            placeholder="Buscar lote o producto..."
            filtros={<FiltrosLista filtros={f} resultados={lotesFiltrados.length} />}
            contador={loading ? undefined : `${lotesFiltrados.length} registros`}
            acciones={<span className="flex items-center gap-1.5 text-xs text-muted-foreground"><OdooBadge /> Lotes, series y vencimientos de Odoo</span>}
          />
        ) : (
          <BarraLista
            pestanas={pestanas}
            busqueda={movementSearchTerm}
            onBusqueda={setMovementSearchTerm}
            placeholder="Buscar movimiento..."
            filtros={<FiltrosLista filtros={f} resultados={filteredMovimientos.length} />}
            contador={loading ? undefined : contadorFiltrado(filteredMovimientos.length, movimientos.length, f.activos || !!movementSearchTerm)}
            acciones={
              <>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openMovementDialog('entrada')}>
                  <ArrowUpRight className="h-3.5 w-3.5" />
                  Entrada
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openMovementDialog('salida')}>
                  <ArrowDownLeft className="h-3.5 w-3.5" />
                  Salida
                </Button>
              </>
            }
          />
        )}

        <TabsContent value="stock">

          {/* Inventory Table */}
          <div className="rounded-lg border border-border bg-card">
            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : (
              <Table data-tabla="inventario">
                <TableHeader>
                  <TableRow>
                    <EncabezadoOrdenable clave="sku" orden={orden} onOrdenar={alternar}>SKU</EncabezadoOrdenable>
                    <EncabezadoOrdenable clave="nombre" orden={orden} onOrdenar={alternar}>Producto</EncabezadoOrdenable>
                    <EncabezadoOrdenable clave="stock" orden={orden} onOrdenar={alternar} alinear="derecha">Stock</EncabezadoOrdenable>
                    <EncabezadoOrdenable clave="comprometido" orden={orden} onOrdenar={alternar} alinear="derecha">Comprometido</EncabezadoOrdenable>
                    <EncabezadoOrdenable clave="disponible" orden={orden} onOrdenar={alternar} alinear="derecha">Disponible</EncabezadoOrdenable>
                    <EncabezadoOrdenable clave="minimo" orden={orden} onOrdenar={alternar} alinear="derecha">Mínimo</EncabezadoOrdenable>
                    <EncabezadoOrdenable clave="maximo" orden={orden} onOrdenar={alternar} alinear="derecha">Máximo</EncabezadoOrdenable>
                    <EncabezadoOrdenable clave="estado" orden={orden} onOrdenar={alternar}>Estado</EncabezadoOrdenable>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agruparCategoria
                    ? gruposCategoria.map((g) => (
                        <Fragment key={g.key}>
                          <TableRow className="cursor-pointer bg-muted/40 hover:bg-muted" onClick={() => toggleCat(g.key)}>
                            <TableCell colSpan={8}>
                              <div className="flex items-center gap-2 font-medium">
                                <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 transition-transform", openCat.has(g.key) && "rotate-90")} />
                                <span className="truncate">{g.nombre}</span>
                                <Badge variant="secondary">{g.items.length} producto{g.items.length !== 1 ? "s" : ""}</Badge>
                              </div>
                            </TableCell>
                          </TableRow>
                          {openCat.has(g.key) && g.items.map((item) => {
                            const status = estadoStock(item);
                            return (
                              <TableRow key={item.id} className="hover:bg-muted/50">
                                <TableCell className="whitespace-nowrap pl-8 font-mono text-xs text-primary">{item.sku}</TableCell>
                                <TableCell className="max-w-[320px] truncate font-medium" title={item.nombre}>
                                  {item.imagen_emoji && <span className="mr-1.5">{item.imagen_emoji}</span>}
                                  {item.nombre}
                                </TableCell>
                                <TableCell className="whitespace-nowrap text-right font-semibold">{Number(item.stock_actual).toLocaleString("es-VE")}</TableCell>
                                <CeldasReservado item={item} />
                                <TableCell className="whitespace-nowrap text-right text-muted-foreground">{item.stock_minimo}</TableCell>
                                <TableCell className="whitespace-nowrap text-right text-muted-foreground">{item.stock_maximo || '-'}</TableCell>
                                <TableCell className="whitespace-nowrap">
                                  <Badge variant={status === "ok" ? "default" : status === "bajo" ? "secondary" : status === "servicio" ? "outline" : "destructive"}>
                                    {ETIQUETA_ESTADO[status]}{!item.activo && " · inactivo"}
                                  </Badge>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </Fragment>
                      ))
                    : pagination.pageItems.map((item) => {
                    const status = estadoStock(item);
                    return (
                      <TableRow key={item.id} className="hover:bg-muted/50">
                        <TableCell className="whitespace-nowrap font-mono text-xs text-primary">{item.sku}</TableCell>
                        <TableCell className="max-w-[320px] truncate font-medium" title={item.nombre}>
                          {item.imagen_emoji && <span className="mr-1.5">{item.imagen_emoji}</span>}
                          {item.nombre}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-semibold">{Number(item.stock_actual).toLocaleString("es-VE")}</TableCell>
                        <CeldasReservado item={item} />
                        <TableCell className="whitespace-nowrap text-right text-muted-foreground">{item.stock_minimo}</TableCell>
                        <TableCell className="whitespace-nowrap text-right text-muted-foreground">{item.stock_maximo || '-'}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          <Badge variant={status === "ok" ? "default" : status === "bajo" ? "secondary" : status === "servicio" ? "outline" : "destructive"}>
                            {ETIQUETA_ESTADO[status]}{!item.activo && " · inactivo"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
            {!loading && !agruparCategoria && <DataTablePagination pagination={pagination} />}
            {!loading && agruparCategoria && (
              <div className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
                {gruposCategoria.length} categoría{gruposCategoria.length !== 1 ? "s" : ""} · {filteredProductos.length} productos
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="almacenes">
          <div className="rounded-lg border border-border bg-card">
            {loading ? (
              <div className="flex items-center justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
            ) : gruposAlm.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-sm text-muted-foreground">
                <Boxes className="mb-2 h-8 w-8 opacity-50" />
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
                            <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 transition-transform", openAlm.has(g.key) && "rotate-90")} />
                            <Boxes className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate" title={g.nombre}>{g.nombre}</span>
                            <Badge variant={g.tipo === "consignacion" ? "outline" : "secondary"}>{g.tipo}</Badge>
                            <Badge variant="secondary">{g.items.length} SKU</Badge>
                            <span className="ml-auto whitespace-nowrap font-semibold text-primary">{g.total.toLocaleString("es-VE")} u</span>
                          </div>
                        </TableCell>
                      </TableRow>
                      {openAlm.has(g.key) && g.items.map((r) => (
                        <TableRow key={r.id} className="hover:bg-muted/50">
                          <TableCell className="max-w-[360px] truncate pl-8" title={r.producto?.nombre || undefined}>{r.producto?.nombre || "—"}</TableCell>
                          <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">{r.producto?.sku || "—"}</TableCell>
                          <TableCell className="whitespace-nowrap text-right font-semibold">{Number(r.cantidad).toLocaleString("es-VE")}</TableCell>
                        </TableRow>
                      ))}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            )}
            {!loading && gruposAlm.length > 0 && (
              <div className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
                {gruposAlm.length} almacén{gruposAlm.length !== 1 ? "es" : ""} con existencias
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="lotes">
          <KpiStrip items={[
            { label: "Vencidos con existencia", valor: conteoLotes.vencidos, tono: conteoLotes.vencidos ? "negativo" : "normal", onClick: () => setLoteFiltro("vencidos"), activo: loteFiltro === "vencidos" },
            { label: "Vencen en 30 días", valor: conteoLotes.d30, tono: conteoLotes.d30 ? "alerta" : "normal", onClick: () => setLoteFiltro("30"), activo: loteFiltro === "30" },
            { label: "Vencen en 90 días", valor: conteoLotes.d90, onClick: () => setLoteFiltro("90"), activo: loteFiltro === "90" },
            { label: "Sin fecha de vencimiento", valor: conteoLotes.sinFecha, tono: "tenue", onClick: () => setLoteFiltro("sin_fecha"), activo: loteFiltro === "sin_fecha" },
          ]} />
          <div className="rounded-lg border border-border bg-card">
            {loading ? (
              <div className="flex items-center justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lote / serie</TableHead>
                    <TableHead>Producto</TableHead>
                    <TableHead className="text-right">Existencia</TableHead>
                    <TableHead>Vencimiento</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginacionLotes.pageItems.length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">No hay lotes con este filtro</TableCell></TableRow>
                  ) : paginacionLotes.pageItems.map((l) => (
                    <TableRow key={l.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/admin/lotes/${l.id}`)}>
                      <TableCell className="whitespace-nowrap font-mono text-xs text-primary">
                        {l.nombre}
                        {l.es_serie && <Badge variant="outline" className="ml-1.5 px-1 py-0 font-sans text-[10px]">Serie</Badge>}
                      </TableCell>
                      <TableCell className="max-w-[380px] truncate" title={l.producto?.nombre || undefined}>
                        <span className="font-medium">{l.producto?.nombre || "—"}</span>
                        {l.producto?.sku && <span className="ml-1.5 font-mono text-xs text-muted-foreground">{l.producto.sku}</span>}
                      </TableCell>
                      <TableCell className={cn("whitespace-nowrap text-right font-semibold", Number(l.cantidad) <= 0 && "text-muted-foreground")}>{Number(l.cantidad).toLocaleString("es-VE")}</TableCell>
                      <TableCell className="whitespace-nowrap"><VencimientoBadge vencimiento={l.vencimiento} conFecha /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {!loading && <DataTablePagination pagination={paginacionLotes} />}
          </div>
        </TabsContent>

        <TabsContent value="movements">
          <p className="mb-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            Movimientos manuales de productos propios de GUDS. Las entradas, salidas y traslados de Odoo están en
            <Link to="/admin/transferencias" className="inline-flex items-center gap-1 font-medium text-primary hover:underline"><ArrowLeftRight className="h-3.5 w-3.5" /> Transferencias</Link>.
          </p>

          {/* Movements Table */}
          <div className="rounded-lg border border-border bg-card">
            {filteredMovimientos.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-sm text-muted-foreground">
                <Package className="mb-2 h-8 w-8 opacity-50" />
                <p>No hay movimientos registrados</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Producto</TableHead>
                    <TableHead className="text-right">Cantidad</TableHead>
                    <TableHead className="text-right">Stock Anterior</TableHead>
                    <TableHead className="text-right">Stock Nuevo</TableHead>
                    <TableHead>Motivo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagination2.pageItems.map((mov: any) => (
                    <TableRow key={mov.id} className="hover:bg-muted/50">
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {new Date(mov.created_at).toLocaleDateString('es-VE', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Badge variant={mov.tipo === "entrada" ? "default" : mov.tipo === "salida" ? "destructive" : "secondary"}>
                          {mov.tipo.charAt(0).toUpperCase() + mov.tipo.slice(1)}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate font-medium" title={mov.producto?.nombre || undefined}>{mov.producto?.nombre || '-'}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-semibold">
                        <span className={mov.tipo === 'entrada' ? 'text-green-600' : mov.tipo === 'salida' ? 'text-red-600' : ''}>
                          {mov.tipo === 'entrada' ? '+' : mov.tipo === 'salida' ? '-' : ''}{mov.cantidad}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right text-muted-foreground">{mov.stock_anterior}</TableCell>
                      <TableCell className="whitespace-nowrap text-right text-muted-foreground">{mov.stock_nuevo}</TableCell>
                      <TableCell className="max-w-[260px] truncate text-muted-foreground" title={mov.motivo || undefined}>{mov.motivo || '-'}</TableCell>
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
            <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><OdooBadge /> El stock de los productos de Odoo se mueve en Odoo</span> (se sincroniza solo).
              Aquí se ajustan únicamente los productos propios de GUDS{productosPropios.length === 0 ? ": hoy no hay ninguno." : "."}
            </p>
            <div className="space-y-2">
              <Label>Producto *</Label>
              <Select value={selectedProductoId} onValueChange={setSelectedProductoId}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar producto" />
                </SelectTrigger>
                <SelectContent>
                  {productosPropios.map((p) => (
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
