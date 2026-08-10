// Comprime una imagen a JPEG antes de subirla (evita crashes de memoria en
// iOS/WKWebView con fotos de cámara de varios MB). Extraído de
// PortalPerfil.tsx para reutilizarlo en cualquier flujo de subida.
export async function compressImage(
  file: File,
  maxDimension: number = 1024,
  quality: number = 0.82
): Promise<Blob> {
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
    (img as HTMLImageElement & { decoding: string }).decoding = "async";

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
}
