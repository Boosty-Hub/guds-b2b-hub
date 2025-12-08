import { useState, useEffect } from "react";
import { ConfiguracionLayout } from "@/components/configuracion/ConfiguracionLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Loader2, Trash2, Edit, Package, FolderOpen, Smile } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";

interface Icono {
  id: string;
  emoji: string;
  nombre: string;
  categoria: string;
  activo: boolean;
  orden: number;
}

const ConfigIconos = () => {
  const [iconos, setIconos] = useState<Icono[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  // Dialog states
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [selectedIcono, setSelectedIcono] = useState<Icono | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    emoji: "",
    nombre: "",
    categoria: "productos",
    activo: true,
    orden: 0,
  });

  useEffect(() => {
    fetchIconos();
  }, []);

  const fetchIconos = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('iconos')
      .select('*')
      .order('categoria')
      .order('orden');
    
    if (data) setIconos(data);
    setLoading(false);
  };

  const resetForm = () => {
    setFormData({
      emoji: "",
      nombre: "",
      categoria: "productos",
      activo: true,
      orden: 0,
    });
  };

  const handleCreate = async () => {
    if (!formData.emoji || !formData.nombre) {
      toast({ title: "Error", description: "Completa todos los campos", variant: "destructive" });
      return;
    }

    const { error } = await supabase.from('iconos').insert({
      emoji: formData.emoji,
      nombre: formData.nombre,
      categoria: formData.categoria,
      activo: formData.activo,
      orden: formData.orden,
    });

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Icono Creado", description: `${formData.emoji} ${formData.nombre} ha sido agregado` });
    resetForm();
    setIsCreateOpen(false);
    fetchIconos();
  };

  const handleEdit = async () => {
    if (!selectedIcono) return;

    const { error } = await supabase
      .from('iconos')
      .update({
        emoji: formData.emoji,
        nombre: formData.nombre,
        categoria: formData.categoria,
        activo: formData.activo,
        orden: formData.orden,
      })
      .eq('id', selectedIcono.id);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Icono Actualizado", description: `${formData.emoji} ${formData.nombre} ha sido actualizado` });
    resetForm();
    setIsEditOpen(false);
    setSelectedIcono(null);
    fetchIconos();
  };

  const handleDelete = async () => {
    if (!selectedIcono) return;

    const { error } = await supabase.from('iconos').delete().eq('id', selectedIcono.id);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Icono Eliminado", description: `${selectedIcono.emoji} ha sido eliminado`, variant: "destructive" });
    }

    setIsDeleteOpen(false);
    setSelectedIcono(null);
    fetchIconos();
  };

  const handleToggleActivo = async (icono: Icono) => {
    const { error } = await supabase
      .from('iconos')
      .update({ activo: !icono.activo })
      .eq('id', icono.id);

    if (!error) {
      fetchIconos();
    }
  };

  const openEditDialog = (icono: Icono) => {
    setSelectedIcono(icono);
    setFormData({
      emoji: icono.emoji,
      nombre: icono.nombre,
      categoria: icono.categoria,
      activo: icono.activo,
      orden: icono.orden,
    });
    setIsEditOpen(true);
  };

  const iconosProductos = iconos.filter(i => i.categoria === 'productos');
  const iconosCategorias = iconos.filter(i => i.categoria === 'categorias');

  const renderIconoGrid = (items: Icono[]) => (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
      {items.map((icono) => (
        <div
          key={icono.id}
          className={`relative group rounded-xl border p-4 text-center transition-all hover:shadow-md ${
            icono.activo ? 'bg-card border-border' : 'bg-muted/50 border-muted opacity-60'
          }`}
        >
          <div className="text-4xl mb-2">{icono.emoji}</div>
          <p className="text-sm font-medium truncate">{icono.nombre}</p>
          <Badge variant={icono.activo ? "default" : "secondary"} className="mt-2 text-xs">
            {icono.activo ? "Activo" : "Inactivo"}
          </Badge>
          
          {/* Actions overlay */}
          <div className="absolute inset-0 bg-background/80 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
            <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => openEditDialog(icono)}>
              <Edit className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => handleToggleActivo(icono)}>
              <Switch checked={icono.activo} className="scale-75" />
            </Button>
            <Button 
              size="icon" 
              variant="outline" 
              className="h-8 w-8 text-destructive"
              onClick={() => { setSelectedIcono(icono); setIsDeleteOpen(true); }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <ConfiguracionLayout title="Iconos">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Iconos y Emojis</h2>
            <p className="text-muted-foreground">
              Gestiona los iconos disponibles para productos y categorías
            </p>
          </div>
          <Button className="gap-2" onClick={() => { resetForm(); setIsCreateOpen(true); }}>
            <Plus className="h-4 w-4" />
            Nuevo Icono
          </Button>
        </div>

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary/10 p-2">
                  <Smile className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{iconos.length}</p>
                  <p className="text-sm text-muted-foreground">Total Iconos</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-blue-500/10 p-2">
                  <Package className="h-5 w-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{iconosProductos.filter(i => i.activo).length}</p>
                  <p className="text-sm text-muted-foreground">Para Productos</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-amber-500/10 p-2">
                  <FolderOpen className="h-5 w-5 text-amber-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{iconosCategorias.filter(i => i.activo).length}</p>
                  <p className="text-sm text-muted-foreground">Para Categorías</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <Tabs defaultValue="productos" className="space-y-4">
            <TabsList>
              <TabsTrigger value="productos" className="gap-2">
                <Package className="h-4 w-4" />
                Productos ({iconosProductos.length})
              </TabsTrigger>
              <TabsTrigger value="categorias" className="gap-2">
                <FolderOpen className="h-4 w-4" />
                Categorías ({iconosCategorias.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="productos">
              <Card>
                <CardHeader>
                  <CardTitle>Iconos para Productos</CardTitle>
                  <CardDescription>
                    Estos iconos aparecen al crear o editar productos
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {iconosProductos.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">
                      No hay iconos para productos
                    </p>
                  ) : (
                    renderIconoGrid(iconosProductos)
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="categorias">
              <Card>
                <CardHeader>
                  <CardTitle>Iconos para Categorías</CardTitle>
                  <CardDescription>
                    Estos iconos aparecen al crear o editar categorías
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {iconosCategorias.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">
                      No hay iconos para categorías
                    </p>
                  ) : (
                    renderIconoGrid(iconosCategorias)
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo Icono</DialogTitle>
            <DialogDescription>Agrega un nuevo emoji para usar en productos o categorías</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-4">
              <div className="flex-1 space-y-2">
                <Label>Emoji</Label>
                <Input
                  placeholder="🍕"
                  value={formData.emoji}
                  onChange={(e) => setFormData({ ...formData, emoji: e.target.value })}
                  className="text-2xl text-center"
                  maxLength={4}
                />
              </div>
              <div className="text-6xl p-4 bg-muted rounded-xl">
                {formData.emoji || "❓"}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Nombre</Label>
              <Input
                placeholder="Ej: Pizza"
                value={formData.nombre}
                onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Usar en</Label>
              <Select value={formData.categoria} onValueChange={(v) => setFormData({ ...formData, categoria: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="productos">Productos</SelectItem>
                  <SelectItem value="categorias">Categorías</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Orden</Label>
              <Input
                type="number"
                placeholder="0"
                value={formData.orden}
                onChange={(e) => setFormData({ ...formData, orden: Number(e.target.value) })}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label>Activo</Label>
              <Switch
                checked={formData.activo}
                onCheckedChange={(checked) => setFormData({ ...formData, activo: checked })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreate}>Crear Icono</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Icono</DialogTitle>
            <DialogDescription>Modifica el emoji y sus propiedades</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-4">
              <div className="flex-1 space-y-2">
                <Label>Emoji</Label>
                <Input
                  value={formData.emoji}
                  onChange={(e) => setFormData({ ...formData, emoji: e.target.value })}
                  className="text-2xl text-center"
                  maxLength={4}
                />
              </div>
              <div className="text-6xl p-4 bg-muted rounded-xl">
                {formData.emoji || "❓"}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Nombre</Label>
              <Input
                value={formData.nombre}
                onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Usar en</Label>
              <Select value={formData.categoria} onValueChange={(v) => setFormData({ ...formData, categoria: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="productos">Productos</SelectItem>
                  <SelectItem value="categorias">Categorías</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Orden</Label>
              <Input
                type="number"
                value={formData.orden}
                onChange={(e) => setFormData({ ...formData, orden: Number(e.target.value) })}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label>Activo</Label>
              <Switch
                checked={formData.activo}
                onCheckedChange={(checked) => setFormData({ ...formData, activo: checked })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>Cancelar</Button>
            <Button onClick={handleEdit}>Guardar Cambios</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar icono?</AlertDialogTitle>
            <AlertDialogDescription>
              El icono {selectedIcono?.emoji} "{selectedIcono?.nombre}" será eliminado permanentemente.
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
    </ConfiguracionLayout>
  );
};

export default ConfigIconos;
