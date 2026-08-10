import { useRef, useState } from "react";
import { Package, ImagePlus, X, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { compressImage } from "@/lib/image";
import { useToast } from "@/hooks/use-toast";

const MAX_IMAGE_SIZE = 2 * 1024 * 1024; // 2MB
export const MAX_PRODUCT_IMAGES = 4;

function pathFromPublicUrl(url: string): string | null {
  const marker = "/object/public/imagenes/";
  const idx = url.indexOf(marker);
  return idx === -1 ? null : url.slice(idx + marker.length);
}

interface ProductImagesInputProps {
  images: string[];
  onChange: (images: string[]) => void;
}

// Hasta MAX_PRODUCT_IMAGES imágenes por SKU. La primera es la principal (se
// espeja en productos.imagen_url para no romper los 12 sitios que leen esa
// sola columna). Reemplaza el bloque de subida duplicado entre los sheets de
// crear y editar producto.
export function ProductImagesInput({ images, onChange }: ProductImagesInputProps) {
  const [uploadingSlot, setUploadingSlot] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingSlot = useRef<number | null>(null);
  const { toast } = useToast();

  const openPicker = (slot: number) => {
    pendingSlot.current = slot;
    inputRef.current?.click();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const slot = pendingSlot.current;
    e.target.value = "";
    if (!file || slot === null) return;

    if (!file.type.startsWith("image/")) {
      toast({ title: "Error", description: "Solo se permiten archivos de imagen", variant: "destructive" });
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      toast({ title: "Error", description: "La imagen no puede superar 2MB", variant: "destructive" });
      return;
    }

    setUploadingSlot(slot);
    try {
      const compressed = await compressImage(file, 1200, 0.85);
      const path = `productos/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const { error } = await supabase.storage.from("imagenes").upload(path, compressed, { contentType: "image/jpeg" });
      if (error) throw error;
      const { data } = supabase.storage.from("imagenes").getPublicUrl(path);

      const next = [...images];
      next[slot] = data.publicUrl;
      onChange(next);
    } catch (err) {
      toast({ title: "No se pudo subir la imagen", description: (err as Error).message, variant: "destructive" });
    } finally {
      setUploadingSlot(null);
    }
  };

  const removeAt = async (slot: number) => {
    const url = images[slot];
    const next = images.filter((_, i) => i !== slot);
    onChange(next);

    const path = pathFromPublicUrl(url);
    if (path) {
      await supabase.storage.from("imagenes").remove([path]);
    }
  };

  const makePrincipal = (slot: number) => {
    if (slot === 0) return;
    const next = [...images];
    const [chosen] = next.splice(slot, 1);
    next.unshift(chosen);
    onChange(next);
  };

  const slots = Array.from({ length: MAX_PRODUCT_IMAGES }, (_, i) => images[i] ?? null);

  return (
    <div className="space-y-2">
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
      <div className="grid grid-cols-4 gap-2">
        {slots.map((url, slot) => (
          <div
            key={slot}
            className="relative h-20 w-20 rounded-lg border-2 border-dashed border-muted-foreground/25 flex items-center justify-center overflow-hidden bg-muted/50"
          >
            {url ? (
              <>
                <img src={url} alt={`Imagen ${slot + 1}`} className="h-full w-full object-cover" />
                {slot === 0 ? (
                  <span className="absolute top-1 left-1 h-5 w-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center" title="Principal">
                    <Star className="h-3 w-3" />
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => makePrincipal(slot)}
                    className="absolute top-1 left-1 h-5 w-5 rounded-full bg-muted text-foreground/70 hover:text-primary flex items-center justify-center"
                    title="Marcar como principal"
                  >
                    <Star className="h-3 w-3" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => removeAt(slot)}
                  className="absolute top-1 right-1 h-5 w-5 rounded-full bg-destructive text-white flex items-center justify-center"
                >
                  <X className="h-3 w-3" />
                </button>
              </>
            ) : uploadingSlot === slot ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            ) : (
              <button
                type="button"
                onClick={() => openPicker(slot)}
                disabled={uploadingSlot !== null}
                className="flex flex-col items-center gap-1 text-muted-foreground disabled:opacity-50"
              >
                {slot === 0 ? <Package className="h-8 w-8" /> : <ImagePlus className="h-6 w-6" />}
              </button>
            )}
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Hasta {MAX_PRODUCT_IMAGES} imágenes, JPG/PNG, máx. 2MB cada una. La marcada con <Star className="h-3 w-3 inline" /> es la principal en catálogo.
      </p>
    </div>
  );
}
