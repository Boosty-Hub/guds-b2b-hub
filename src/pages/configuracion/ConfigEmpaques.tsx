import { useState, useEffect } from "react";
import { ConfiguracionLayout } from "@/components/configuracion/ConfiguracionLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Edit, Trash2, Package, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase, TipoEmpaque } from "@/lib/supabase";

const ConfigEmpaques = () => {
  const [empaques, setEmpaques] = useState<TipoEmpaque[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [selectedEmpaque, setSelectedEmpaque] = useState<TipoEmpaque | null>(null);
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    nombre: "",
    descripcion: "",
    unidades: 1,
  });

  useEffect(() => {
    fetchEmpaques();
  }, []);

  const fetchEmpaques = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('tipos_empaque')
      .select('*')
      .order('orden');
    
    if (data) setEmpaques(data);
    setLoading(false);
  };

  const resetForm = () => {
    setFormData({ nombre: "", descripcion: "", unidades: 1 });
  };

  const handleCreate = async () => {
    if (!formData.nombre) {
      toast({ title: "Error", description: "El nombre es requerido", variant: "destructive" });
      return;
    }

    const { error } = await supabase
      .from('tipos_empaque')
      .insert({
        nombre: formData.nombre,
        descripcion: formData.descripcion || null,
        unidades: formData.unidades,
        orden: empaques.length + 1,
        activo: true,
      });

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Empaque Creado", description: `"${formData.nombre}" ha sido creado` });
    resetForm();
    setIsCreateOpen(false);
    fetchEmpaques();
  };

  const handleEdit = async () => {
    if (!selectedEmpaque || !formData.nombre) return;

    const { error } = await supabase
      .from('tipos_empaque')
      .update({
        nombre: formData.nombre,
        descripcion: formData.descripcion || null,
        unidades: formData.unidades,
      })
      .eq('id', selectedEmpaque.id);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Empaque Actualizado", description: `"${formData.nombre}" ha sido actualizado` });
    resetForm();
    setIsEditOpen(false);
    setSelectedEmpaque(null);
    fetchEmpaques();
  };

  const handleDelete = async () => {
    if (!selectedEmpaque) return;

    const { error } = await supabase
      .from('tipos_empaque')
      .delete()
      .eq('id', selectedEmpaque.id);

    if (error) {
      toast({ title: "Error", description: "No se puede eliminar, hay productos usando este empaque", variant: "destructive" });
    } else {
      toast({ title: "Empaque Eliminado", description: `"${selectedEmpaque.nombre}" ha sido eliminado`, variant: "destructive" });
    }
    
    setIsDeleteOpen(false);
    setSelectedEmpaque(null);
    fetchEmpaques();
  };

  const handleToggleActivo = async (empaque: TipoEmpaque) => {
    const { error } = await supabase
      .from('tipos_empaque')
      .update({ activo: !empaque.activo })
      .eq('id', empaque.id);

    if (error) {
      toast({ title: "No se pudo actualizar", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: empaque.activo ? "Empaque Desactivado" : "Empaque Activado",
      description: `"${empaque.nombre}" ha sido ${empaque.activo ? "desactivado" : "activado"}`,
    });
    fetchEmpaques();
  };

  const openEditDialog = (empaque: TipoEmpaque) => {
    setSelectedEmpaque(empaque);
    setFormData({
      nombre: empaque.nombre,
      descripcion: empaque.descripcion || "",
      unidades: empaque.unidades,
    });
    setIsEditOpen(true);
  };

  return (
    <ConfiguracionLayout 
      title="Tipos de Empaque" 
      description="Define los tipos de empaque disponibles para los productos"
    >
      <Card className="border-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                Tipos de Empaque
              </CardTitle>
              <CardDescription>
                Define los tipos de empaque disponibles para los productos (Bulto, Caja, Pack, etc.)
              </CardDescription>
            </div>
            <Button className="gap-2" onClick={() => { resetForm(); setIsCreateOpen(true); }}>
              <Plus className="h-4 w-4" />
              Nuevo Empaque
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : empaques.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Package className="h-12 w-12 mb-4 opacity-50" />
              <p>No hay tipos de empaque</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead className="text-center">Unidades</TableHead>
                  <TableHead className="text-center">Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {empaques.map((empaque) => (
                  <TableRow key={empaque.id}>
                    <TableCell className="font-medium">{empaque.nombre}</TableCell>
                    <TableCell className="text-muted-foreground">{empaque.descripcion || '-'}</TableCell>
                    <TableCell className="text-center font-semibold">{empaque.unidades}</TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={empaque.activo}
                        onCheckedChange={() => handleToggleActivo(empaque)}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEditDialog(empaque)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="text-destructive"
                          onClick={() => { setSelectedEmpaque(empaque); setIsDeleteOpen(true); }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Crear Tipo de Empaque</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Nombre *</Label>
              <Input
                placeholder="Ej: Bulto"
                value={formData.nombre}
                onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Descripción</Label>
              <Input
                placeholder="Ej: Bulto de 24 unidades"
                value={formData.descripcion}
                onChange={(e) => setFormData({ ...formData, descripcion: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Cantidad de Unidades *</Label>
              <Input
                type="number"
                min="1"
                value={formData.unidades}
                onChange={(e) => setFormData({ ...formData, unidades: parseInt(e.target.value) || 1 })}
              />
              <p className="text-xs text-muted-foreground">
                Cuántas unidades individuales contiene este empaque
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreate}>Crear Empaque</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Tipo de Empaque</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Nombre *</Label>
              <Input
                placeholder="Ej: Bulto"
                value={formData.nombre}
                onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Descripción</Label>
              <Input
                placeholder="Ej: Bulto de 24 unidades"
                value={formData.descripcion}
                onChange={(e) => setFormData({ ...formData, descripcion: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Cantidad de Unidades *</Label>
              <Input
                type="number"
                min="1"
                value={formData.unidades}
                onChange={(e) => setFormData({ ...formData, unidades: parseInt(e.target.value) || 1 })}
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
            <AlertDialogTitle>¿Eliminar empaque?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. El empaque "{selectedEmpaque?.nombre}" será eliminado permanentemente.
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

export default ConfigEmpaques;
