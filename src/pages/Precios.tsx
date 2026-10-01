import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Tags, Loader2, Trash2, ChevronRight } from "lucide-react";
import { supabase, Producto } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { usePermissions } from "@/contexts/PermissionsContext";
import { useToast } from "@/hooks/use-toast";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { BarraLista } from "@/components/datos/BarraLista";
import { OdooBadge } from "@/components/OdooBadge";
import {
  FiltrosLista, useFiltros, useFiltroEmpresa, opcionesDe, opcionesPrueba, pasaPrueba, coincide, contadorFiltrado, type OpcionPrueba,
} from "@/components/datos/FiltrosLista";
import { esDeGuds, type ListaPrecio } from "@/components/listas-precios/comun";

// Listas de precios (fase 21e). Las de Odoo se ven aquí pero se editan en Odoo; las de GUDS se arman producto por
// producto en su detalle (/admin/precios/listas/:id), donde también se asignan a clientes e importan de Excel.

interface ListaFila extends ListaPrecio { clientes_count: number; precios_count: number }

type ProductoFila = Producto & { categoria?: { nombre: string } | null };
const CLAVES_PRODUCTOS = ["categoria", "oferta", "precio", "lista", "empresa"];

const Precios = () => {
  const navigate = useNavigate();
  const { empresas, empresaActiva } = useEmpresa();
  const { can } = usePermissions();
  const [listas, setListas] = useState<ListaFila[]>([]);
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
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [listSearchTerm, setListSearchTerm] = useState("");
  const [origenFiltro, setOrigenFiltro] = useState("todas");
  const { formatPrice } = useCurrency();
  const { toast } = useToast();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [aEliminar, setAEliminar] = useState<ListaFila | null>(null);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({ nombre: "", descripcion: "" });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const [listasRes, productosRes, especialesRes] = await Promise.all([
      supabase.from('listas_precios').select('id, nombre, descripcion, activo, moneda, empresa_id, odoo_id, updated_at, clientes:clientes(count), precios:precios_lista(count)').order('nombre'),
      supabase.from('productos').select('*, categoria:categorias(nombre)').eq('activo', true).order('nombre'),
      supabase.from('precios_lista').select('lista_precios_id, producto_id'),
    ]);
    const esp: Record<string, Set<string>> = {};
    for (const r of (especialesRes.data as { lista_precios_id: string; producto_id: string }[] | null) ?? []) (esp[r.lista_precios_id] ??= new Set()).add(r.producto_id);
    setEspeciales(esp);
    type Fila = ListaPrecio & { clientes?: { count: number }[]; precios?: { count: number }[] };
    setListas(((listasRes.data ?? []) as unknown as Fila[]).map(({ clientes, precios, ...l }) => ({
      ...l, clientes_count: clientes?.[0]?.count ?? 0, precios_count: precios?.[0]?.count ?? 0,
    })));
    if (productosRes.data) setProductos(productosRes.data as ProductoFila[]);
    setLoading(false);
  };

  // Las listas nuevas son de la empresa activa y en USD (el portal y los pedidos trabajan en USD)
  const handleCreate = async () => {
    if (!formData.nombre.trim() || !empresaActiva) return;
    setSaving(true);
    const { data, error } = await supabase.from('listas_precios').insert({
      nombre: formData.nombre.trim(), descripcion: formData.descripcion.trim() || null,
      empresa_id: empresaActiva.id, moneda: 'USD', activo: true, es_default: false, porcentaje_descuento: 0,
    }).select('id').single();
    setSaving(false);
    if (error) { toast({ title: "No se pudo crear la lista", description: error.message, variant: "destructive" }); return; }
    setIsCreateOpen(false);
    setFormData({ nombre: "", descripcion: "" });
    navigate(`/admin/precios/listas/${data.id}`);
  };

  // Eliminar: primero se quitan sus clientes (vuelven a su lista de Odoo con la próxima sincronización)
  const handleDelete = async () => {
    if (!aEliminar) return;
    setSaving(true);
    try {
      const { data: cli, error: e1 } = await supabase.from('clientes').select('id').eq('lista_precios_id', aEliminar.id);
      if (e1) throw e1;
      if (cli?.length) {
        const { error: e2 } = await supabase.rpc('asignar_lista_clientes', { p_lista: aEliminar.id, p_clientes: cli.map((c) => c.id), p_quitar: true });
        if (e2) throw e2;
      }
      const { error } = await supabase.from('listas_precios').delete().eq('id', aEliminar.id);
      if (error) throw error;
      toast({ title: "Lista eliminada" });
      setAEliminar(null);
      fetchData();
    } catch (error) {
      toast({ title: "No se pudo eliminar", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

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
    l.nombre.toLowerCase().includes(listSearchTerm.toLowerCase()) &&
    (origenFiltro === "todas" || (origenFiltro === "guds") === esDeGuds(l))
  );

  const pagination = usePagination(filteredProductos, 50, f.firma);
  const nombreEmpresa = (id: string | null) => empresas.find((e) => e.id === id)?.nombre_corto ?? "Ambas";
  const puedeCrear = can("precios", "crear");

  const stats = {
    total: listas.length,
    guds: listas.filter((l) => esDeGuds(l)).length,
    clientesAsignados: listas.filter((l) => esDeGuds(l)).reduce((sum, l) => sum + l.clientes_count, 0),
    precios: listas.reduce((sum, l) => sum + l.precios_count, 0),
  };

  return (
    <MainLayout title="Listas de Precios">
      <KpiStrip items={[
        { label: "Listas de precios", valor: stats.total, tono: "primario" },
        { label: "Listas de GUDS", valor: stats.guds },
        { label: "Clientes con lista de GUDS", valor: stats.clientesAsignados },
        { label: "Precios cargados", valor: stats.precios },
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
            filtros={
              <Select value={origenFiltro} onValueChange={setOrigenFiltro}>
                <SelectTrigger className="h-8 w-full text-xs sm:w-40" aria-label="Origen"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas las listas</SelectItem>
                  <SelectItem value="guds">Listas de GUDS</SelectItem>
                  <SelectItem value="odoo">Listas de Odoo</SelectItem>
                </SelectContent>
              </Select>
            }
            contador={`${filteredListas.length} registros`}
            acciones={puedeCrear && (
              <Button size="sm" className="gap-1.5" onClick={() => setIsCreateOpen(true)} data-testid="nueva-lista">
                <Plus className="h-3.5 w-3.5" />
                Nueva Lista
              </Button>
            )}
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
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lista</TableHead>
                    <TableHead className="hidden sm:table-cell">Empresa</TableHead>
                    <TableHead className="text-right">Precios</TableHead>
                    <TableHead className="text-right">Clientes</TableHead>
                    <TableHead className="hidden md:table-cell">Estado</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredListas.map((lista) => (
                    <TableRow key={lista.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/admin/precios/listas/${lista.id}`)} data-testid="fila-lista">
                      <TableCell className="max-w-[320px]">
                        <div className="flex items-center gap-1.5 truncate font-medium" title={lista.nombre}>
                          <span className="truncate">{lista.nombre}</span>
                          {esDeGuds(lista) ? <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px]">GUDS</Badge> : <OdooBadge titulo="Lista de Odoo · se edita en Odoo" />}
                        </div>
                        <p className="truncate text-xs text-muted-foreground" title={lista.descripcion || undefined}>{[lista.moneda ?? "USD", lista.descripcion].filter(Boolean).join(" · ")}</p>
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-xs text-muted-foreground sm:table-cell">{nombreEmpresa(lista.empresa_id)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{lista.precios_count}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{lista.clientes_count}</TableCell>
                      <TableCell className="hidden whitespace-nowrap md:table-cell">
                        <Badge variant={lista.activo ? "default" : "secondary"}>{lista.activo ? "Activa" : "Inactiva"}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {esDeGuds(lista) && can("precios", "eliminar") && (
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" title="Eliminar" aria-label={`Eliminar ${lista.nombre}`}
                              onClick={(e) => { e.stopPropagation(); setAEliminar(lista); }}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
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

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nueva lista de precios</DialogTitle>
            <DialogDescription>
              {empresaActiva ? <>Lista de <strong>{empresaActiva.nombre_corto}</strong> en USD. Después le pones el precio a cada producto y le asignas clientes.</> : "Elige GUDS o Quirutec en el menú superior: cada lista es de una empresa."}
            </DialogDescription>
          </DialogHeader>
          {empresaActiva && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="nl-nombre">Nombre *</Label>
                <Input id="nl-nombre" autoFocus placeholder="Ej.: Farmacias zona sur, Clínica X, Mayoristas…" value={formData.nombre}
                  onChange={(e) => setFormData({ ...formData, nombre: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="nl-desc">Descripción</Label>
                <Textarea id="nl-desc" rows={2} value={formData.descripcion} onChange={(e) => setFormData({ ...formData, descripcion: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={saving || !empresaActiva || !formData.nombre.trim()} data-testid="crear-lista">
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Crear y poner precios
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!aEliminar} onOpenChange={(v) => { if (!v) setAEliminar(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Eliminar lista de precios</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Se elimina <strong>«{aEliminar?.nombre}»</strong> con sus {aEliminar?.precios_count ?? 0} precios.
            {aEliminar?.clientes_count ? ` Sus ${aEliminar.clientes_count} clientes vuelven a la lista que tienen en Odoo.` : ""}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAEliminar(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
};

export default Precios;
