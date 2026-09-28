import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { compressImage } from "@/lib/image";

// Comprobantes de cobro del vendedor: bucket privado "comprobantes-cobro" (migración 20o), ruta <usuario>/<cliente>/<archivo>.
// El vendedor sube a su carpeta y solo para clientes de su cartera; administración lee todo; el cliente lee lo de sus fichas.
// En pagos.comprobante_url se guarda con el prefijo del bucket ("comprobantes-cobro/…"); los comprobantes antiguos (portal del
// cliente, retenciones) viven en el bucket "documentos" sin prefijo.

export const BUCKET_COBROS = "comprobantes-cobro";

const aleatorio = () => Math.random().toString(36).slice(2, 10);

/** Comprime la foto (cámara del teléfono: varios MB) y la sube. Devuelve la ruta dentro del bucket. */
export async function subirComprobanteCobro(usuarioId: string, clienteId: string, archivo: File): Promise<string> {
  const esImagen = archivo.type.startsWith("image/");
  const esPdf = archivo.type === "application/pdf";
  if (!esImagen && !esPdf) throw new Error("El comprobante debe ser una foto o un PDF.");
  const cuerpo: Blob = esImagen ? await compressImage(archivo, 1600, 0.8).catch(() => archivo) : archivo;
  if (cuerpo.size > 5 * 1024 * 1024) throw new Error("El archivo supera 5 MB.");
  const tipo = esImagen ? (cuerpo === archivo ? archivo.type : "image/jpeg") : "application/pdf";
  const ext = tipo === "application/pdf" ? "pdf" : tipo === "image/png" ? "png" : tipo === "image/webp" ? "webp" : "jpg";
  const ruta = `${usuarioId}/${clienteId}/${Date.now()}-${aleatorio()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET_COBROS).upload(ruta, cuerpo, { contentType: tipo, upsert: false });
  if (error) throw new Error(error.message);
  return ruta;
}

/** Borra un comprobante propio que ningún pago usa (p. ej. se quitó antes de enviar el cobro). */
export async function borrarComprobanteCobro(ruta: string) {
  try { await supabase.storage.from(BUCKET_COBROS).remove([ruta]); } catch { /* queda huérfano, sin efecto */ }
}

/** comprobante_url de un pago → bucket y ruta. */
export const ubicarComprobante = (url: string) =>
  url.startsWith(`${BUCKET_COBROS}/`) ? { bucket: BUCKET_COBROS, ruta: url.slice(BUCKET_COBROS.length + 1) } : { bucket: "documentos", ruta: url };

export const esPdfComprobante = (url: string | null | undefined) => !!url && /\.pdf$/i.test(url);

/** URL firmada (temporal) para ver un comprobante. */
export async function urlComprobante(url: string, segundos = 300): Promise<string> {
  const { bucket, ruta } = ubicarComprobante(url);
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(ruta, segundos);
  if (error || !data?.signedUrl) throw new Error(error?.message || "No se pudo abrir el comprobante");
  return data.signedUrl;
}

/** URL firmada de un comprobante para mostrarlo en pantalla (null mientras carga o si falla). */
export function useUrlComprobante(url: string | null | undefined) {
  const [estado, setEstado] = useState<{ url: string | null; error: string | null }>({ url: null, error: null });
  useEffect(() => {
    let vivo = true;
    setEstado({ url: null, error: null });
    if (!url) return;
    urlComprobante(url).then((u) => { if (vivo) setEstado({ url: u, error: null }); })
      .catch((e: Error) => { if (vivo) setEstado({ url: null, error: e.message }); });
    return () => { vivo = false; };
  }, [url]);
  return estado;
}

/** true en pantallas chicas (< 768 px), calculado al montar para no pintar primero la variante equivocada. */
export function useEsMovil() {
  const consulta = "(max-width: 767.98px)";
  const [movil, setMovil] = useState(() => (typeof window !== "undefined" ? window.matchMedia(consulta).matches : false));
  useEffect(() => {
    const mql = window.matchMedia(consulta);
    const alCambiar = () => setMovil(mql.matches);
    mql.addEventListener("change", alCambiar);
    setMovil(mql.matches);
    return () => mql.removeEventListener("change", alCambiar);
  }, []);
  return movil;
}
