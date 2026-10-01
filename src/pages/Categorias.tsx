import { useMemo, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import {
  Plus,
  Edit,
  Trash2,
  GripVertical,
  Smartphone,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useStoreConfig, Categoria } from "@/contexts/StoreConfigContext";
import { OdooBadge } from "@/components/OdooBadge";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { BarraLista } from "@/components/datos/BarraLista";
import { Panel } from "@/components/datos/FichaCampos";
import { FiltrosLista, useFiltros, opcionesPrueba, pasaPrueba, normalizarTexto, contadorFiltrado, type OpcionPrueba } from "@/components/datos/FiltrosLista";
import { useEmpresa } from "@/contexts/EmpresaContext";

const colorOptions = [
  { value: "bg-yellow-500", label: "Amarillo" },
  { value: "bg-orange-500", label: "Naranja" },
  { value: "bg-red-500", label: "Rojo" },
  { value: "bg-pink-500", label: "Rosa" },
  { value: "bg-purple-500", label: "Morado" },
  { value: "bg-blue-500", label: "Azul" },
  { value: "bg-cyan-500", label: "Cian" },
  { value: "bg-green-500", label: "Verde" },
  { value: "bg-emerald-500", label: "Esmeralda" },
  { value: "bg-amber-500", label: "Ámbar" },
];

const iconOptions = [
  "🫒", "🍚", "🌾", "🥫", "🥛", "🧃", "🧂", "🍝", "🧹", "🧴",
  "🥩", "🍗", "🐟", "🥬", "🍎", "🍞", "🧀", "🥚", "☕", "🍪",
  "🍫", "🍬", "🥤", "🍺", "🧊", "🧈", "🥜", "🌽", "🥕", "🧅"
];

const Categorias = () => {
  const { categorias: todas, addCategoria, updateCategoria, deleteCategoria } = useStoreConfig();
  // Categorías por empresa (fase 21a): Odoo no les asigna compañía, la empresa sale de sus productos (categorias.empresas).
  // En una empresa se ven las suyas y las compartidas (marcadas); en «Ambas», todas con su empresa.
  const { empresaActiva, empresas: listaEmpresas, soloLectura } = useEmpresa();
  const categorias = useMemo(() => todas.filter((c) => !empresaActiva || !(c.empresas ?? []).length || (c.empresas ?? []).includes(empresaActiva.id)),
    [todas, empresaActiva]);
  const nombreEmpresa = (id: string) => listaEmpresas.find((e) => e.id === id)?.nombre_corto ?? "—";
  const compartida = (c: Categoria) => (c.empresas ?? []).length > 1;
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [selectedCategoria, setSelectedCategoria] = useState<Categoria | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    nombre: "",
    icono: "🫒",
    color: "bg-yellow-500",
  });

  const resetForm = () => {
    setFormData({
      nombre: "",
      icono: "🫒",
      color: "bg-yellow-500",
    });
  };

  const handleCreate = async () => {
    if (!formData.nombre) {
      toast({
        title: "Error",
        description: "El nombre es requerido",
        variant: "destructive",
      });
      return;
    }

    try {
      await addCategoria({
        nombre: formData.nombre,
        icono: formData.icono,
        color: formData.color,
        activo: true,
        orden: categorias.length + 1,
        productosCount: 0,
      });
    } catch (e) {
      toast({ title: "No se pudo crear la categoría", description: (e as Error).message, variant: "destructive" });
      return;
    }

    toast({
      title: "Categoría Creada",
      description: `"${formData.nombre}" ha sido creada exitosamente`,
    });
    resetForm();
    setIsCreateOpen(false);
  };

  const handleEdit = async () => {
    if (!selectedCategoria) return;

    try {
      await updateCategoria(selectedCategoria.id, {
        // En categorías de Odoo el nombre se edita en Odoo
        ...(selectedCategoria.odooId ? {} : { nombre: formData.nombre }),
        icono: formData.icono,
        color: formData.color,
      });
    } catch (e) {
      toast({ title: "No se pudo actualizar la categoría", description: (e as Error).message, variant: "destructive" });
      return;
    }

    toast({
      title: "Categoría Actualizada",
      description: `"${formData.nombre}" ha sido actualizada`,
    });
    resetForm();
    setIsEditOpen(false);
    setSelectedCategoria(null);
  };

  const handleDelete = async () => {
    if (!selectedCategoria) return;

    try {
      await deleteCategoria(selectedCategoria.id);
    } catch (e) {
      toast({ title: "No se pudo eliminar la categoría", description: (e as Error).message, variant: "destructive" });
      return;
    }
    toast({
      title: "Categoría Eliminada",
      description: `"${selectedCategoria.nombre}" ha sido eliminada. Los productos asociados quedarán sin categoría.`,
      variant: "destructive",
    });
    setIsDeleteOpen(false);
    setSelectedCategoria(null);
  };

  const openEditDialog = (categoria: Categoria) => {
    setSelectedCategoria(categoria);
    setFormData({
      nombre: categoria.nombre,
      icono: categoria.icono,
      color: categoria.color,
    });
    setIsEditOpen(true);
  };

  const handleToggleActivo = async (categoria: Categoria) => {
    try {
      await updateCategoria(categoria.id, { activo: !categoria.activo });
    } catch (e) {
      toast({ title: "No se pudo actualizar", description: (e as Error).message, variant: "destructive" });
      return;
    }
    toast({
      title: categoria.activo ? "Categoría oculta del portal" : "Categoría visible en el portal",
      description: `"${categoria.nombre}" ${categoria.activo ? "ya no se ofrece" : "se ofrece"} en el portal del cliente y del vendedor${categoria.deVenta === false ? " (no tiene productos vendibles: igual no aparece)" : ""}`,
    });
  };

  const activeCategorias = categorias.filter(c => c.activo && c.deVenta !== false).length;
  const noVenta = categorias.filter(c => c.deVenta === false).length;
  const totalProductos = categorias.reduce((sum, c) => sum + c.productosCount, 0);

  // ---- Filtros (en la URL) ----
  const pruebasActivo: OpcionPrueba<Categoria>[] = [
    { valor: "si", etiqueta: "Visibles en el portal", prueba: (c) => c.activo }, { valor: "no", etiqueta: "Ocultas del portal", prueba: (c) => !c.activo },
  ];
  const pruebasProductos: OpcionPrueba<Categoria>[] = [
    { valor: "con", etiqueta: "Con productos", prueba: (c) => c.productosCount > 0 }, { valor: "sin", etiqueta: "Sin productos", prueba: (c) => c.productosCount === 0 },
  ];
  const pruebasVenta: OpcionPrueba<Categoria>[] = [
    { valor: "si", etiqueta: "De venta", prueba: (c) => c.deVenta !== false },
    { valor: "no", etiqueta: "No de venta (ocultas del portal)", prueba: (c) => c.deVenta === false },
  ];
  const pruebasEmpresa: OpcionPrueba<Categoria>[] = [
    ...listaEmpresas.map((e) => ({ valor: e.id, etiqueta: `Solo ${e.nombre_corto || e.nombre}`, prueba: (c: Categoria) => (c.empresas ?? []).length === 1 && (c.empresas ?? [])[0] === e.id })),
    { valor: "compartida", etiqueta: "Compartidas", prueba: (c) => compartida(c) },
    { valor: "sin", etiqueta: "Sin productos", prueba: (c) => !(c.empresas ?? []).length },
  ];
  const pruebasOrigen: OpcionPrueba<Categoria>[] = [
    { valor: "odoo", etiqueta: "Odoo", prueba: (c) => !!c.odooId }, { valor: "guds", etiqueta: "Creada en GUDS", prueba: (c) => !c.odooId },
  ];
  const f = useFiltros([
    { clave: "activo", etiqueta: "Portal", todos: "Visibles y ocultas", principal: true, opciones: opcionesPrueba(categorias, pruebasActivo) },
    { clave: "productos", etiqueta: "Productos", todos: "Todas", principal: true, opciones: opcionesPrueba(categorias, pruebasProductos) },
    { clave: "venta", etiqueta: "Venta", todos: "De venta y no", principal: true, opciones: opcionesPrueba(categorias, pruebasVenta) },
    ...(soloLectura && listaEmpresas.length > 1 ? [{ clave: "empresa", etiqueta: "Empresa", todos: "Todas", opciones: opcionesPrueba(categorias, pruebasEmpresa) }] : []),
    { clave: "origen", etiqueta: "Origen", todos: "Odoo y GUDS", opciones: opcionesPrueba(categorias, pruebasOrigen) },
  ]);
  const termino = normalizarTexto(busqueda);
  const filtradas = categorias.filter((c) => pasaPrueba(pruebasActivo, f.v("activo"), c) && pasaPrueba(pruebasProductos, f.v("productos"), c)
    && pasaPrueba(pruebasOrigen, f.v("origen"), c) && pasaPrueba(pruebasVenta, f.v("venta"), c) && pasaPrueba(pruebasEmpresa, f.v("empresa"), c)
    && (!termino || normalizarTexto(c.nombre).includes(termino)));

  return (
    <MainLayout title="Categorías">
      {/* Stats */}
      <KpiStrip
        items={[
          { label: empresaActiva ? `Categorías de ${empresaActiva.nombre_corto}` : "Total Categorías", valor: categorias.length, tono: "primario" },
          { label: "En el portal", valor: activeCategorias, tono: "positivo", detalle: "activas y de venta" },
          { label: "No de venta", valor: noVenta, detalle: "sin productos vendibles", activo: f.v("venta") === "no",
            onClick: () => f.set("venta", f.v("venta") === "no" ? "" : "no") },
          { label: "Productos Total", valor: totalProductos },
        ]}
      />

      {/* Header */}
      <BarraLista
        busqueda={busqueda}
        onBusqueda={setBusqueda}
        placeholder="Buscar categoría..."
        filtros={<FiltrosLista filtros={f} resultados={filtradas.length} />}
        contador={contadorFiltrado(filtradas.length, categorias.length, f.activos || !!busqueda)}
        acciones={
          <Button size="sm" className="gap-1.5" onClick={() => {
            resetForm();
            setIsCreateOpen(true);
          }}>
            <Plus className="h-3.5 w-3.5" />
            Nueva Categoría
          </Button>
        }
      />

      {/* Categories Table */}
      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-6"></TableHead>
              <TableHead className="w-10">Icono</TableHead>
              <TableHead>Categoría</TableHead>
              <TableHead>Empresa</TableHead>
              <TableHead className="text-right">Productos</TableHead>
              <TableHead className="text-center" title="Interruptor manual: mostrar la categoría en el portal del cliente y del vendedor">En el portal</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtradas.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">{categorias.length ? "Ninguna categoría coincide con la búsqueda o los filtros" : "No hay categorías"}</TableCell>
              </TableRow>
            ) : [...filtradas].sort((a, b) => a.orden - b.orden).map((categoria) => (
              <TableRow key={categoria.id} className={!categoria.activo || categoria.deVenta === false ? "opacity-60" : ""} data-testid="fila-categoria">
                <TableCell className="pr-0">
                  <div className="cursor-grab text-muted-foreground hover:text-foreground">
                    <GripVertical className="h-3.5 w-3.5" />
                  </div>
                </TableCell>
                <TableCell>
                  <div className={`h-6 w-6 rounded-full ${categoria.color} flex items-center justify-center text-sm`}>
                    {categoria.icono}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
                    <span className="max-w-[260px] truncate font-medium" title={categoria.nombre}>{categoria.etiqueta ?? categoria.nombre}</span>
                    {categoria.odooId && <OdooBadge />}
                    {categoria.deVenta === false && (
                      <Badge variant="outline" className="text-xs" title="Ningún producto es vendible: el portal no la ofrece">No de venta</Badge>
                    )}
                    {categoria.deVenta !== false && !categoria.activo && (
                      <Badge variant="secondary" className="text-xs">Oculta del portal</Badge>
                    )}
                    {categoria.grupo && <span className="min-w-0 max-w-[280px] truncate text-xs text-muted-foreground" title={`Subcategoría de ${categoria.grupo}`}>en {categoria.grupo}</span>}
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <div className="flex gap-1">
                    {!(categoria.empresas ?? []).length ? <span className="text-xs text-muted-foreground">Sin productos</span>
                      : empresaActiva ? (compartida(categoria) ? <Badge variant="outline" className="px-1.5 py-0 text-[10px]" title={(categoria.empresas ?? []).map(nombreEmpresa).join(" y ")}>Compartida</Badge>
                        : <span className="text-xs text-muted-foreground">{empresaActiva.nombre_corto}</span>)
                      : (categoria.empresas ?? []).map((id) => <Badge key={id} variant="outline" className="px-1.5 py-0 text-[10px]">{nombreEmpresa(id)}</Badge>)}
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap text-right">{categoria.productosCount} productos</TableCell>
                <TableCell className="text-center">
                  <Switch
                    checked={categoria.activo}
                    onCheckedChange={() => handleToggleActivo(categoria)}
                    disabled={categoria.deVenta === false}
                    title={categoria.deVenta === false ? "No tiene productos vendibles: el portal no la ofrece" : categoria.activo ? "Ocultar del portal" : "Mostrar en el portal"}
                    aria-label={`Mostrar ${categoria.etiqueta ?? categoria.nombre} en el portal`}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-0.5">
                    <Button variant="ghost" size="icon" className="h-7 w-7" title="Editar" onClick={() => openEditDialog(categoria)}>
                      <Edit className="h-3.5 w-3.5" />
                    </Button>
                    {!categoria.odooId && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" title="Eliminar" onClick={() => { setSelectedCategoria(categoria); setIsDeleteOpen(true); }}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Vista previa del portal (debajo de la lista para priorizar los datos) */}
      <Panel className="mt-3" titulo={<><Smartphone className="h-3.5 w-3.5" /> Vista Previa - Portal Cliente</>}>
        <div className="mx-auto max-w-md rounded-lg bg-muted p-2">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {categorias.filter(c => c.activo && c.deVenta !== false && c.productosCount > 0).sort((a, b) => a.orden - b.orden).map((cat) => (
              <div key={cat.id} className="flex w-[72px] shrink-0 flex-col items-center gap-1">
                <div className={`h-10 w-10 rounded-full ${cat.color} flex items-center justify-center text-lg`}>
                  {cat.icono}
                </div>
                <span className="line-clamp-2 w-full break-words text-center text-[11px] leading-tight" title={cat.nombre}>{cat.etiqueta ?? cat.nombre}</span>
              </div>
            ))}
          </div>
        </div>
      </Panel>

      {/* Create Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Crear Categoría</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Nombre *</Label>
              <Input
                placeholder="Ej: Aceites"
                value={formData.nombre}
                onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Icono</Label>
              <div className="grid grid-cols-10 gap-2 p-3 border rounded-lg max-h-32 overflow-y-auto">
                {iconOptions.map((icon) => (
                  <button
                    key={icon}
                    onClick={() => setFormData({ ...formData, icono: icon })}
                    className={`h-8 w-8 rounded flex items-center justify-center text-lg hover:bg-muted transition-colors ${
                      formData.icono === icon ? "bg-primary/20 ring-2 ring-primary" : ""
                    }`}
                  >
                    {icon}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex flex-wrap gap-2">
                {colorOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setFormData({ ...formData, color: opt.value })}
                    className={`h-8 w-8 rounded-full ${opt.value} transition-transform ${
                      formData.color === opt.value ? "ring-2 ring-offset-2 ring-primary scale-110" : ""
                    }`}
                    title={opt.label}
                  />
                ))}
              </div>
            </div>

            {/* Preview */}
            <div className="space-y-2">
              <Label>Vista Previa</Label>
              <div className="flex items-center gap-4 p-4 bg-muted rounded-lg">
                <div className={`h-14 w-14 rounded-full ${formData.color} flex items-center justify-center text-2xl`}>
                  {formData.icono}
                </div>
                <span className="font-medium">{formData.nombre || "Nombre"}</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreate}>Crear Categoría</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">Editar Categoría {selectedCategoria?.odooId && <OdooBadge />}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">Nombre * {selectedCategoria?.odooId && <OdooBadge />}</Label>
              <Input
                placeholder="Ej: Aceites"
                disabled={!!selectedCategoria?.odooId}
                value={formData.nombre}
                onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Icono</Label>
              <div className="grid grid-cols-10 gap-2 p-3 border rounded-lg max-h-32 overflow-y-auto">
                {iconOptions.map((icon) => (
                  <button
                    key={icon}
                    onClick={() => setFormData({ ...formData, icono: icon })}
                    className={`h-8 w-8 rounded flex items-center justify-center text-lg hover:bg-muted transition-colors ${
                      formData.icono === icon ? "bg-primary/20 ring-2 ring-primary" : ""
                    }`}
                  >
                    {icon}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex flex-wrap gap-2">
                {colorOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setFormData({ ...formData, color: opt.value })}
                    className={`h-8 w-8 rounded-full ${opt.value} transition-transform ${
                      formData.color === opt.value ? "ring-2 ring-offset-2 ring-primary scale-110" : ""
                    }`}
                    title={opt.label}
                  />
                ))}
              </div>
            </div>

            {/* Preview */}
            <div className="space-y-2">
              <Label>Vista Previa</Label>
              <div className="flex items-center gap-4 p-4 bg-muted rounded-lg">
                <div className={`h-14 w-14 rounded-full ${formData.color} flex items-center justify-center text-2xl`}>
                  {formData.icono}
                </div>
                <span className="font-medium">{formData.nombre || "Nombre"}</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleEdit}>Guardar Cambios</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar categoría?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. La categoría "{selectedCategoria?.nombre}" será eliminada permanentemente.
              {selectedCategoria && selectedCategoria.productosCount > 0 && (
                <span className="block mt-2 text-destructive font-medium">
                  ⚠️ Esta categoría tiene {selectedCategoria.productosCount} productos asociados.
                </span>
              )}
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
    </MainLayout>
  );
};

export default Categorias;
