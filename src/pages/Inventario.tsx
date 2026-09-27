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
  almacen: { id: string; nombre: string; tipo: string } | null;
  producto: { id: string; nombre: string; sku: string } | null;
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
  producto: { id: string; nombre: string; sku: string } | null;
}
const FILTROS_LOTE: Record<string, string> = {
  vencidos: "Vencidos con existencia", "30": "Vencen en 30 días", "90": "Vencen en 90 días",
  existencia: "Todos con existencia", sin_fecha: "Sin fecha de vencimiento", todos: "Todos los lotes",
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
  const [params] = useSearchParams();
  const [loteFiltro, setLoteFiltro] = useState(params.get("lotes") || "90");
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoriaFiltro, setCategoriaFiltro] = useState("all");
  const [agruparCategoria, setAgruparCategoria] = useState(false);
  // Como el inventario de Odoo: por defecto solo productos almacenables activos (sin servicios ni inactivos)
  const [alcance, setAlcance] = useState<"almacenables" | "todos">("almacenables");
  const [openCat, setOpenCat] = useState<Set<string>>(new Set());
  const toggleCat = (k: string) => setOpenCat((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const [movementSearchTerm, setMovementSearchTerm] = useState("");
  const [tipoFiltro, setTipoFiltro] = useState("all");
  const [almSearch, setAlmSearch] = useState("");
  const [almTipoFiltro, setAlmTipoFiltro] = useState("all");
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
      supabase.from('inventario_almacen').select('id, cantidad, reservado, almacen:almacenes(id, nombre, tipo), producto:productos(id, nombre, sku)').limit(5000),
      supabase.from('lotes').select('id, nombre, es_serie, vencimiento, cantidad, producto:productos(id, nombre, sku)').order('vencimiento', { ascending: true, nullsFirst: false }),
    ]);
    if (lotesRes.data) setLotes(lotesRes.data as unknown as LoteRow[]);

    if (productosRes.data) setProductos(productosRes.data as unknown as ProductoConCategoria[]);
    if (movimientosRes.data) setMovimientos(movimientosRes.data);
    if (invAlmRes.data) setInvAlmacen(invAlmRes.data as unknown as InvAlmacenRow[]);
    setLoading(false);
  };

  const categorias = useMemo(() => {
    const set = new Map<string, string>();
    for (const p of productos) if (p.categoria?.nombre) set.set(p.categoria.nombre, p.categoria.nombre);
    return [...set.values()].sort((a, b) => a.localeCompare(b));
  }, [productos]);

  const esAlmacenable = (p: ProductoConCategoria) => p.activo && p.controla_stock !== false;
  const filteredProductos = productos.filter(p =>
    (alcance === "todos" || esAlmacenable(p)) &&
    (p.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
     p.sku.toLowerCase().includes(searchTerm.toLowerCase())) &&
    (categoriaFiltro === "all" || p.categoria?.nombre === categoriaFiltro)
  );
  const estadoStock = (p: ProductoConCategoria) =>
    p.controla_stock === false ? "servicio" : p.stock_actual <= 0 ? "agotado" : p.stock_actual <= p.stock_minimo ? "bajo" : "ok";
  const ETIQUETA_ESTADO: Record<string, string> = { ok: "OK", bajo: "Bajo", agotado: "Agotado", servicio: "Servicio" };
  const { ordenadas, orden, alternar } = useOrdenTabla(filteredProductos, {
    sku: (p) => p.sku, nombre: (p) => p.nombre, stock: (p) => Number(p.stock_actual || 0),
    comprometido: (p) => Number(p.comprometido_odoo || 0) + Number(p.comprometido_guds || 0),
    disponible: (p) => (p.controla_stock === false ? null : Number(p.stock_disponible ?? p.stock_actual ?? 0)),
    minimo: (p) => Number(p.stock_minimo || 0), maximo: (p) => Number(p.stock_maximo || 0), estado: (p) => estadoStock(p),
  });
  const pagination = usePagination(ordenadas, 50);
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
    return lotes.filter((l) => {
      const e = estadoVencimiento(l.vencimiento);
      const ex = Number(l.cantidad) > 0;
      const ok = loteFiltro === "todos" ? true : loteFiltro === "existencia" ? ex : loteFiltro === "sin_fecha" ? e === "sin_fecha"
        : loteFiltro === "vencidos" ? ex && e === "vencido" : loteFiltro === "30" ? ex && e === "30" : ex && (e === "30" || e === "90");
      return ok && (!q || l.nombre.toLowerCase().includes(q) || l.producto?.nombre?.toLowerCase().includes(q) || l.producto?.sku?.toLowerCase().includes(q));
    });
  }, [lotes, loteSearch, loteFiltro]);
  const paginacionLotes = usePagination(lotesFiltrados, 50);
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
    const matchesTipo = tipoFiltro === "all" || m.tipo === tipoFiltro;
    return matchesSearch && matchesTipo;
  });

  const pagination2 = usePagination(filteredMovimientos, 50);

  const gruposAlm = useMemo(() => {
    const m = new Map<string, { key: string; nombre: string; tipo: string; items: InvAlmacenRow[]; total: number }>();
    const q = almSearch.toLowerCase();
    for (const r of invAlmacen) {
      if (!r.almacen) continue;
      if (almTipoFiltro !== "all" && r.almacen.tipo !== almTipoFiltro) continue;
      if (q && !(r.almacen.nombre.toLowerCase().includes(q) || r.producto?.nombre?.toLowerCase().includes(q) || r.producto?.sku?.toLowerCase().includes(q))) continue;
      const key = r.almacen.id;
      const g = m.get(key) || { key, nombre: r.almacen.nombre, tipo: r.almacen.tipo, items: [], total: 0 };
      g.items.push(r); g.total += Number(r.cantidad || 0);
      m.set(key, g);
    }
    return [...m.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [invAlmacen, almSearch, almTipoFiltro]);

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

  const [tab, setTab] = useState<string>(params.get("tab") || "stock");
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
        { label: "Almacenables activos", valor: stats.total, tono: "primario", onClick: () => setAlcance("almacenables"), activo: alcance === "almacenables", titulo: "Ver solo productos almacenables activos (como el inventario de Odoo)" },
        { label: "Servicios e inactivos", valor: stats.otros, tono: "tenue", detalle: alcance === "todos" ? "mostrándose en la lista" : "ocultos · clic para ver", onClick: () => setAlcance((a) => (a === "todos" ? "almacenables" : "todos")), activo: alcance === "todos" },
        {
          label: "Lotes vencen en 90 días", valor: conteoLotes.d90, tono: "alerta",
          detalle: conteoLotes.vencidos > 0 ? <span className="text-destructive">{conteoLotes.vencidos} vencidos con existencia</span> : undefined,
        },
        { label: "Agotados", valor: stats.agotados, tono: "negativo" },
        { label: "Bajo Mínimo", valor: stats.bajoMinimo, tono: "alerta" },
      ]} />

      <Tabs value={tab} onValueChange={setTab}>
        {/* Pestañas, búsqueda, filtros y acciones de la pestaña activa en una sola fila */}
        {tab === "stock" ? (
          <BarraLista
            pestanas={pestanas}
            busqueda={searchTerm}
            onBusqueda={setSearchTerm}
            placeholder="Buscar producto..."
            filtros={
              <Select value={categoriaFiltro} onValueChange={setCategoriaFiltro}>
                <SelectTrigger className="h-8 w-full text-[13px] sm:w-44">
                  <SelectValue placeholder="Categoría" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las categorías</SelectItem>
                  {categorias.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            }
            contador={`${filteredProductos.length} registros`}
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
            filtros={
              <Select value={almTipoFiltro} onValueChange={setAlmTipoFiltro}>
                <SelectTrigger className="h-8 w-full text-[13px] sm:w-48">
                  <SelectValue placeholder="Tipo de almacén" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los almacenes</SelectItem>
                  <SelectItem value="propio">Solo propios</SelectItem>
                  <SelectItem value="consignacion">Solo consignación</SelectItem>
                </SelectContent>
              </Select>
            }
            contador={`${gruposAlm.length} almacenes`}
          />
        ) : tab === "lotes" ? (
          <BarraLista
            pestanas={pestanas}
            busqueda={loteSearch}
            onBusqueda={setLoteSearch}
            placeholder="Buscar lote o producto..."
            filtros={
              <Select value={loteFiltro} onValueChange={setLoteFiltro}>
                <SelectTrigger className="h-8 w-full text-[13px] sm:w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(FILTROS_LOTE).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            }
            contador={`${lotesFiltrados.length} registros`}
            acciones={<span className="flex items-center gap-1.5 text-xs text-muted-foreground"><OdooBadge /> Lotes, series y vencimientos de Odoo</span>}
          />
        ) : (
          <BarraLista
            pestanas={pestanas}
            busqueda={movementSearchTerm}
            onBusqueda={setMovementSearchTerm}
            placeholder="Buscar movimiento..."
            filtros={
              <Select value={tipoFiltro} onValueChange={setTipoFiltro}>
                <SelectTrigger className="h-8 w-full text-[13px] sm:w-40">
                  <SelectValue placeholder="Tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="entrada">Entradas</SelectItem>
                  <SelectItem value="salida">Salidas</SelectItem>
                  <SelectItem value="ajuste">Ajustes</SelectItem>
                </SelectContent>
              </Select>
            }
            contador={`${filteredMovimientos.length} registros`}
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
