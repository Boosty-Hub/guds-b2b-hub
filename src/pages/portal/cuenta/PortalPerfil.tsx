import { useState, useEffect, useRef } from "react";
import { PortalMobileLayout } from "@/components/portal/PortalMobileLayout";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  ChevronLeft,
  User,
  Mail,
  Phone,
  Building2,
  Loader2,
  Save,
  Camera
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase, Cliente } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";

const PortalPerfil = () => {
  const { user, updateUser } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [formData, setFormData] = useState({
    nombre: "",
    apellido: "",
    telefono: "",
    email: "",
  });

  useEffect(() => {
    if (user) {
      setFormData({
        nombre: user.nombre || "",
        apellido: user.apellido || "",
        telefono: user.telefono || "",
        email: user.email || "",
      });
      setAvatarUrl(user.avatar || null);
      
      if (user.cliente_id) {
        fetchCliente();
      } else {
        setLoading(false);
      }
    }
  }, [user]);

  // Compress image before upload (optimized to avoid iOS/WKWebView crashes)
  const compressImage = async (
    file: File,
    maxDimension: number = 1024,
    quality: number = 0.82
  ): Promise<Blob> => {
    const toJpegBlob = (canvas: HTMLCanvasElement) =>
      new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error("Failed to compress image"));
          },
          "image/jpeg",
          quality
        );
      });

    // Prefer createImageBitmap (usually more memory-friendly on iOS/WKWebView)
    if (typeof createImageBitmap === "function") {
      // Tiny decode first to infer orientation with minimal memory
      const thumb = await createImageBitmap(file, {
        resizeWidth: 64,
        resizeQuality: "low",
      });
      const isLandscape = thumb.width >= thumb.height;
      thumb.close?.();

      const bitmap = await createImageBitmap(
        file,
        isLandscape
          ? { resizeWidth: maxDimension, resizeQuality: "high" }
          : { resizeHeight: maxDimension, resizeQuality: "high" }
      );

      try {
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;

        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas context not available");

        ctx.drawImage(bitmap, 0, 0);
        return await toJpegBlob(canvas);
      } finally {
        bitmap.close?.();
      }
    }

    // Fallback: <img> + canvas
    const objectUrl = URL.createObjectURL(file);
    try {
      const img = new Image();
      (img as any).decoding = "async";

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Failed to load image"));
        img.src = objectUrl;
      });

      const width = img.width;
      const height = img.height;
      const scale = Math.min(1, maxDimension / Math.max(width, height));
      const targetW = Math.max(1, Math.round(width * scale));
      const targetH = Math.max(1, Math.round(height * scale));

      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;

      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas context not available");

      ctx.drawImage(img, 0, 0, targetW, targetH);
      return await toJpegBlob(canvas);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  };

  const handlePhotoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !user) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast({ title: "Error", description: "Solo se permiten imágenes", variant: "destructive" });
      return;
    }

    setUploadingPhoto(true);

    try {
      // Compress the image before upload (keeps memory low on iOS)
      const compressedBlob = await compressImage(file, 1024, 0.82);

      const fileName = `avatars/${user.id}-${Date.now()}.jpg`;

      // Upload compressed image to storage
      const { error: uploadError } = await supabase.storage
        .from('imagenes')
        .upload(fileName, compressedBlob, {
          upsert: true,
          contentType: 'image/jpeg'
        });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('imagenes')
        .getPublicUrl(fileName);

      // Update user profile with avatar URL
      const { error: updateError } = await supabase
        .from('usuarios')
        .update({ avatar_url: publicUrl })
        .eq('id', user.id);

      if (updateError) throw updateError;

      setAvatarUrl(publicUrl);
      updateUser({ avatar: publicUrl });
      toast({ title: "Éxito", description: "Foto actualizada correctamente" });
    } catch (error: any) {
      console.error('Error uploading photo:', error);
      toast({ title: "Error", description: error.message || "No se pudo subir la foto", variant: "destructive" });
    } finally {
      setUploadingPhoto(false);
      // allow selecting the same file again
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const fetchCliente = async () => {
    const { data } = await supabase
      .from('clientes')
      .select('*')
      .eq('id', user?.cliente_id)
      .single();
    
    if (data) setCliente(data);
    setLoading(false);
  };

  const handleSave = async () => {
    setSaving(true);
    
    const { error } = await supabase
      .from('usuarios')
      .update({
        nombre: formData.nombre,
        apellido: formData.apellido,
        telefono: formData.telefono,
      })
      .eq('id', user?.id);
    
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Guardado", description: "Tus datos han sido actualizados" });
    }
    
    setSaving(false);
  };

  const initials = user ? `${user.nombre?.charAt(0) || ''}${user.apellido?.charAt(0) || ''}`.toUpperCase() : 'U';

  return (
    <PortalMobileLayout showHeader={false} showNav={false}>
      {/* Header */}
      <div className="bg-primary text-primary-foreground px-4 py-3 sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/portal/cuenta")} className="p-1">
            <ChevronLeft className="h-6 w-6" />
          </button>
          <h1 className="text-lg font-semibold">Datos Personales</h1>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="px-4 py-6 space-y-6">
          {/* Avatar */}
          <div className="flex flex-col items-center">
            <div className="relative">
              {avatarUrl ? (
                <img 
                  src={avatarUrl} 
                  alt="Avatar" 
                  className="h-24 w-24 rounded-full object-cover"
                />
              ) : (
                <div className="h-24 w-24 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-3xl font-bold text-primary">{initials}</span>
                </div>
              )}
              {uploadingPhoto && (
                <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-white" />
                </div>
              )}
            </div>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handlePhotoUpload}
              accept="image/*"
              className="hidden"
            />
            <Button 
              variant="outline" 
              size="sm" 
              className="mt-3 gap-2"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingPhoto}
            >
              <Camera className="h-4 w-4" />
              Cambiar foto
            </Button>
          </div>

          {/* Form */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <User className="h-4 w-4" />
                Nombre
              </Label>
              <Input
                value={formData.nombre}
                onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                placeholder="Tu nombre"
              />
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <User className="h-4 w-4" />
                Apellido
              </Label>
              <Input
                value={formData.apellido}
                onChange={(e) => setFormData({ ...formData, apellido: e.target.value })}
                placeholder="Tu apellido"
              />
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Mail className="h-4 w-4" />
                Email
              </Label>
              <Input
                value={formData.email}
                disabled
                className="bg-muted"
              />
              <p className="text-xs text-muted-foreground">El email no puede ser modificado</p>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Phone className="h-4 w-4" />
                Teléfono
              </Label>
              <Input
                value={formData.telefono}
                onChange={(e) => setFormData({ ...formData, telefono: e.target.value })}
                placeholder="Tu teléfono"
              />
            </div>
          </div>

          {/* Business Info (Read Only) */}
          {cliente && (
            <div className="bg-muted rounded-xl p-4 space-y-3">
              <h3 className="font-semibold flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Datos del Negocio
              </h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Negocio</p>
                  <p className="font-medium">{cliente.nombre_negocio}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">RIF</p>
                  <p className="font-medium">{cliente.rif}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Tipo</p>
                  <p className="font-medium">{cliente.tipo_negocio}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Ciudad</p>
                  <p className="font-medium">{cliente.ciudad}</p>
                </div>
              </div>
            </div>
          )}

          {/* Save Button */}
          <Button 
            className="w-full gap-2" 
            size="lg"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                <Save className="h-5 w-5" />
                Guardar Cambios
              </>
            )}
          </Button>
        </div>
      )}
    </PortalMobileLayout>
  );
};

export default PortalPerfil;
