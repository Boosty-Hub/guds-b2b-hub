import { useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  MoreHorizontal,
  Edit,
  Trash2,
  GripVertical,
  Eye,
  EyeOff,
  FolderOpen,
  Smartphone,
  Package
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useStoreConfig, Categoria } from "@/contexts/StoreConfigContext";

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
  const { categorias, addCategoria, updateCategoria, deleteCategoria } = useStoreConfig();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [selectedCategoria, setSelectedCategoria] = useState<Categoria | null>(null);
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
        nombre: formData.nombre,
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
      title: categoria.activo ? "Categoría Desactivada" : "Categoría Activada",
      description: `"${categoria.nombre}" ha sido ${categoria.activo ? "desactivada" : "activada"}`,
    });
  };

  const activeCategorias = categorias.filter(c => c.activo).length;
  const totalProductos = categorias.reduce((sum, c) => sum + c.productosCount, 0);

  return (
    <MainLayout title="Categorías">
      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                <FolderOpen className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{categorias.length}</p>
                <p className="text-xs text-muted-foreground">Total Categorías</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-green-500/10 flex items-center justify-center">
                <Eye className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{activeCategorias}</p>
                <p className="text-xs text-muted-foreground">Activas</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-blue-500/10 flex items-center justify-center">
                <Package className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{totalProductos}</p>
                <p className="text-xs text-muted-foreground">Productos Total</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold">Gestión de Categorías</h2>
          <p className="text-sm text-muted-foreground">Las categorías se muestran en el portal cliente y catálogo</p>
        </div>
        <Button className="gap-2" onClick={() => {
          resetForm();
          setIsCreateOpen(true);
        }}>
          <Plus className="h-4 w-4" />
          Nueva Categoría
        </Button>
      </div>

      {/* Preview */}
      <Card className="border-border mb-6">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Smartphone className="h-4 w-4" />
            Vista Previa - Portal Cliente
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="bg-muted rounded-xl p-4 max-w-md mx-auto">
            <div className="flex gap-3 overflow-x-auto pb-2">
              {categorias.filter(c => c.activo).sort((a, b) => a.orden - b.orden).map((cat) => (
                <div key={cat.id} className="flex flex-col items-center gap-2 min-w-[70px]">
                  <div className={`h-14 w-14 rounded-full ${cat.color} flex items-center justify-center text-2xl`}>
                    {cat.icono}
                  </div>
                  <span className="text-xs text-center">{cat.nombre}</span>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Categories Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {categorias.sort((a, b) => a.orden - b.orden).map((categoria) => (
          <Card key={categoria.id} className={`border-border ${!categoria.activo ? "opacity-60" : ""}`}>
            <CardContent className="p-4">
              <div className="flex items-start gap-4">
                <div className="cursor-grab text-muted-foreground hover:text-foreground mt-1">
                  <GripVertical className="h-5 w-5" />
                </div>
                
                {/* Category Icon */}
                <div className={`h-14 w-14 rounded-full ${categoria.color} flex items-center justify-center text-2xl flex-shrink-0`}>
                  {categoria.icono}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold truncate">{categoria.nombre}</h3>
                    {!categoria.activo && (
                      <Badge variant="secondary" className="text-xs">Inactivo</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {categoria.productosCount} productos
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Switch
                    checked={categoria.activo}
                    onCheckedChange={() => handleToggleActivo(categoria)}
                  />

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEditDialog(categoria)}>
                        <Edit className="h-4 w-4 mr-2" />
                        Editar
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleToggleActivo(categoria)}>
                        {categoria.activo ? (
                          <>
                            <EyeOff className="h-4 w-4 mr-2" />
                            Desactivar
                          </>
                        ) : (
                          <>
                            <Eye className="h-4 w-4 mr-2" />
                            Activar
                          </>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem 
                        className="text-destructive"
                        onClick={() => {
                          setSelectedCategoria(categoria);
                          setIsDeleteOpen(true);
                        }}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Eliminar
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

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
            <DialogTitle>Editar Categoría</DialogTitle>
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
