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
  Image,
  Smartphone,
  Calendar,
  Upload,
  X
} from "lucide-react";
import { useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { useStoreConfig, Banner } from "@/contexts/StoreConfigContext";
import { supabase } from "@/lib/supabase";
import { compressImage } from "@/lib/image";
import { BannerVisual } from "@/components/BannerVisual";

const MAX_BANNER_IMAGE_SIZE = 2 * 1024 * 1024;

const gradientOptions = [
  { value: "from-yellow-500 to-orange-500", label: "Amarillo → Naranja", preview: "bg-gradient-to-r from-yellow-500 to-orange-500" },
  { value: "from-blue-500 to-purple-500", label: "Azul → Morado", preview: "bg-gradient-to-r from-blue-500 to-purple-500" },
  { value: "from-green-500 to-emerald-500", label: "Verde → Esmeralda", preview: "bg-gradient-to-r from-green-500 to-emerald-500" },
  { value: "from-pink-500 to-rose-500", label: "Rosa → Rojo", preview: "bg-gradient-to-r from-pink-500 to-rose-500" },
  { value: "from-cyan-500 to-blue-500", label: "Cian → Azul", preview: "bg-gradient-to-r from-cyan-500 to-blue-500" },
  { value: "from-purple-500 to-pink-500", label: "Morado → Rosa", preview: "bg-gradient-to-r from-purple-500 to-pink-500" },
  { value: "from-red-500 to-orange-500", label: "Rojo → Naranja", preview: "bg-gradient-to-r from-red-500 to-orange-500" },
  { value: "from-indigo-500 to-purple-500", label: "Índigo → Morado", preview: "bg-gradient-to-r from-indigo-500 to-purple-500" },
];

const Banners = () => {
  const { banners, addBanner, updateBanner, deleteBanner } = useStoreConfig();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [selectedBanner, setSelectedBanner] = useState<Banner | null>(null);
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    title: "",
    subtitle: "",
    bgColor: "from-yellow-500 to-orange-500",
    imagenUrl: null as string | null,
    link: "",
    fechaInicio: "",
    fechaFin: "",
  });
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetForm = () => {
    setFormData({
      title: "",
      subtitle: "",
      bgColor: "from-yellow-500 to-orange-500",
      imagenUrl: null,
      link: "",
      fechaInicio: "",
      fechaFin: "",
    });
  };

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Formato no permitido", description: "Solo se aceptan imágenes", variant: "destructive" });
      return;
    }
    if (file.size > MAX_BANNER_IMAGE_SIZE) {
      toast({ title: "Imagen muy grande", description: "El máximo es 2 MB", variant: "destructive" });
      return;
    }

    setUploadingImage(true);
    try {
      const compressed = await compressImage(file, 1200, 0.85);
      const path = `banners/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const { error } = await supabase.storage.from("imagenes").upload(path, compressed, { contentType: "image/jpeg" });
      if (error) throw error;
      const { data } = supabase.storage.from("imagenes").getPublicUrl(path);
      setFormData((prev) => ({ ...prev, imagenUrl: data.publicUrl }));
    } catch (err) {
      toast({ title: "No se pudo subir la imagen", description: (err as Error).message, variant: "destructive" });
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleCreate = async () => {
    if (!formData.title || !formData.subtitle) {
      toast({
        title: "Error",
        description: "Completa los campos requeridos",
        variant: "destructive",
      });
      return;
    }

    try {
      await addBanner({
        title: formData.title,
        subtitle: formData.subtitle,
        bgColor: formData.bgColor,
        textColor: "white",
        imagenUrl: formData.imagenUrl,
        link: formData.link || "/portal/catalogo",
        activo: true,
        orden: banners.length + 1,
        fechaInicio: formData.fechaInicio || new Date().toISOString().split("T")[0],
        fechaFin: formData.fechaFin || "2024-12-31",
      });
    } catch (e) {
      toast({ title: "No se pudo crear el banner", description: (e as Error).message, variant: "destructive" });
      return;
    }

    toast({
      title: "Banner Creado",
      description: "El banner ha sido creado exitosamente",
    });
    resetForm();
    setIsCreateOpen(false);
  };

  const handleEdit = async () => {
    if (!selectedBanner) return;

    try {
      await updateBanner(selectedBanner.id, {
        title: formData.title,
        subtitle: formData.subtitle,
        bgColor: formData.bgColor,
        imagenUrl: formData.imagenUrl,
        link: formData.link,
        fechaInicio: formData.fechaInicio,
        fechaFin: formData.fechaFin,
      });
    } catch (e) {
      toast({ title: "No se pudo actualizar el banner", description: (e as Error).message, variant: "destructive" });
      return;
    }

    toast({
      title: "Banner Actualizado",
      description: "El banner ha sido actualizado exitosamente",
    });
    resetForm();
    setIsEditOpen(false);
    setSelectedBanner(null);
  };

  const handleDelete = async () => {
    if (!selectedBanner) return;

    try {
      await deleteBanner(selectedBanner.id);
    } catch (e) {
      toast({ title: "No se pudo eliminar el banner", description: (e as Error).message, variant: "destructive" });
      return;
    }
    toast({
      title: "Banner Eliminado",
      description: "El banner ha sido eliminado",
      variant: "destructive",
    });
    setIsDeleteOpen(false);
    setSelectedBanner(null);
  };

  const openEditDialog = (banner: Banner) => {
    setSelectedBanner(banner);
    setFormData({
      title: banner.title,
      subtitle: banner.subtitle,
      bgColor: banner.bgColor,
      imagenUrl: banner.imagenUrl,
      link: banner.link,
      fechaInicio: banner.fechaInicio,
      fechaFin: banner.fechaFin,
    });
    setIsEditOpen(true);
  };

  const handleToggleActivo = async (banner: Banner) => {
    try {
      await updateBanner(banner.id, { activo: !banner.activo });
    } catch (e) {
      toast({ title: "No se pudo actualizar", description: (e as Error).message, variant: "destructive" });
      return;
    }
    toast({
      title: banner.activo ? "Banner Desactivado" : "Banner Activado",
      description: `"${banner.title}" ha sido ${banner.activo ? "desactivado" : "activado"}`,
    });
  };

  const activeBanners = banners.filter(b => b.activo).length;

  return (
    <MainLayout title="Banners Promocionales">
      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Image className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{banners.length}</p>
                <p className="text-xs text-muted-foreground">Total Banners</p>
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
                <p className="text-2xl font-bold">{activeBanners}</p>
                <p className="text-xs text-muted-foreground">Activos</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-blue-500/10 flex items-center justify-center">
                <Smartphone className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">App</p>
                <p className="text-xs text-muted-foreground">Portal Cliente</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold">Gestión de Banners</h2>
          <p className="text-sm text-muted-foreground">Los banners se muestran en el carrusel del portal cliente</p>
        </div>
        <Button className="gap-2" onClick={() => {
          resetForm();
          setIsCreateOpen(true);
        }}>
          <Plus className="h-4 w-4" />
          Nuevo Banner
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
              {banners.filter(b => b.activo).sort((a, b) => a.orden - b.orden).map((banner) => (
                <BannerVisual
                  key={banner.id}
                  banner={banner}
                  className="rounded-xl p-4 min-w-[180px] flex-shrink-0"
                />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Banners List */}
      <div className="space-y-3">
        {banners.sort((a, b) => a.orden - b.orden).map((banner) => (
          <Card key={banner.id} className={`border-border ${!banner.activo ? "opacity-60" : ""}`}>
            <CardContent className="p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="hidden sm:block cursor-grab text-muted-foreground hover:text-foreground">
                  <GripVertical className="h-5 w-5" />
                </div>

                {/* Banner Preview */}
                <BannerVisual banner={banner} className="rounded-lg p-3 sm:min-w-[150px] text-sm" />

                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold">{banner.title}</h3>
                    {!banner.activo && (
                      <Badge variant="secondary">Inactivo</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{banner.subtitle}</p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {banner.fechaInicio} - {banner.fechaFin}
                    </span>
                    <span>Link: {banner.link}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-4 sm:justify-start">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      {banner.activo ? "Activo" : "Inactivo"}
                    </span>
                    <Switch
                      checked={banner.activo}
                      onCheckedChange={() => handleToggleActivo(banner)}
                    />
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEditDialog(banner)}>
                        <Edit className="h-4 w-4 mr-2" />
                        Editar
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleToggleActivo(banner)}>
                        {banner.activo ? (
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
                          setSelectedBanner(banner);
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
            <DialogTitle>Crear Banner</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Título *</Label>
                <Input
                  placeholder="Ej: 20% OFF"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Subtítulo *</Label>
                <Input
                  placeholder="Ej: En aceites"
                  value={formData.subtitle}
                  onChange={(e) => setFormData({ ...formData, subtitle: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Color de Fondo (respaldo si no hay imagen)</Label>
              <Select
                value={formData.bgColor}
                onValueChange={(value) => setFormData({ ...formData, bgColor: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {gradientOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <div className="flex items-center gap-2">
                        <div className={`h-4 w-8 rounded ${opt.preview}`} />
                        {opt.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Imagen de Diseño</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageSelect}
              />
              {formData.imagenUrl ? (
                <div className="relative">
                  <img src={formData.imagenUrl} alt="Banner" className="w-full h-32 object-cover rounded-lg" />
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    className="absolute top-2 right-2 h-7 w-7"
                    onClick={() => setFormData({ ...formData, imagenUrl: null })}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={uploadingImage}
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full border-2 border-dashed border-border rounded-xl p-4 text-center hover:border-primary transition-colors disabled:opacity-50"
                >
                  <span className="flex flex-col items-center gap-1 text-sm text-muted-foreground">
                    <Upload className="h-6 w-6" />
                    {uploadingImage ? "Subiendo..." : "Toca para subir una imagen (máx. 2 MB)"}
                  </span>
                </button>
              )}
            </div>

            {/* Preview */}
            <div className="space-y-2">
              <Label>Vista Previa</Label>
              <BannerVisual
                banner={{ bgColor: formData.bgColor, imagenUrl: formData.imagenUrl, title: formData.title || "Título", subtitle: formData.subtitle || "Subtítulo" }}
                className="rounded-xl p-4"
              />
            </div>

            <div className="space-y-2">
              <Label>Link (URL destino)</Label>
              <Input
                placeholder="/portal/catalogo?cat=Aceites"
                value={formData.link}
                onChange={(e) => setFormData({ ...formData, link: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Fecha Inicio</Label>
                <Input
                  type="date"
                  value={formData.fechaInicio}
                  onChange={(e) => setFormData({ ...formData, fechaInicio: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Fecha Fin</Label>
                <Input
                  type="date"
                  value={formData.fechaFin}
                  onChange={(e) => setFormData({ ...formData, fechaFin: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreate}>Crear Banner</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Editar Banner</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Título *</Label>
                <Input
                  placeholder="Ej: 20% OFF"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Subtítulo *</Label>
                <Input
                  placeholder="Ej: En aceites"
                  value={formData.subtitle}
                  onChange={(e) => setFormData({ ...formData, subtitle: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Color de Fondo (respaldo si no hay imagen)</Label>
              <Select
                value={formData.bgColor}
                onValueChange={(value) => setFormData({ ...formData, bgColor: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {gradientOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <div className="flex items-center gap-2">
                        <div className={`h-4 w-8 rounded ${opt.preview}`} />
                        {opt.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Imagen de Diseño</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageSelect}
              />
              {formData.imagenUrl ? (
                <div className="relative">
                  <img src={formData.imagenUrl} alt="Banner" className="w-full h-32 object-cover rounded-lg" />
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    className="absolute top-2 right-2 h-7 w-7"
                    onClick={() => setFormData({ ...formData, imagenUrl: null })}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={uploadingImage}
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full border-2 border-dashed border-border rounded-xl p-4 text-center hover:border-primary transition-colors disabled:opacity-50"
                >
                  <span className="flex flex-col items-center gap-1 text-sm text-muted-foreground">
                    <Upload className="h-6 w-6" />
                    {uploadingImage ? "Subiendo..." : "Toca para subir una imagen (máx. 2 MB)"}
                  </span>
                </button>
              )}
            </div>

            {/* Preview */}
            <div className="space-y-2">
              <Label>Vista Previa</Label>
              <BannerVisual
                banner={{ bgColor: formData.bgColor, imagenUrl: formData.imagenUrl, title: formData.title || "Título", subtitle: formData.subtitle || "Subtítulo" }}
                className="rounded-xl p-4"
              />
            </div>

            <div className="space-y-2">
              <Label>Link (URL destino)</Label>
              <Input
                placeholder="/portal/catalogo?cat=Aceites"
                value={formData.link}
                onChange={(e) => setFormData({ ...formData, link: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Fecha Inicio</Label>
                <Input
                  type="date"
                  value={formData.fechaInicio}
                  onChange={(e) => setFormData({ ...formData, fechaInicio: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Fecha Fin</Label>
                <Input
                  type="date"
                  value={formData.fechaFin}
                  onChange={(e) => setFormData({ ...formData, fechaFin: e.target.value })}
                />
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
            <AlertDialogTitle>¿Eliminar banner?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. El banner "{selectedBanner?.title}" será eliminado permanentemente.
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

export default Banners;
