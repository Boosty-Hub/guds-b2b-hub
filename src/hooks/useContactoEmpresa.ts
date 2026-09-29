// Datos de contacto públicos de la empresa principal (tabla empresas, legible sin sesión) para la landing y el registro.
// Solo se muestran si existen: nada de teléfonos o correos de ejemplo.
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export interface ContactoEmpresa { nombre: string | null; telefono: string | null; email: string | null; ciudad: string | null }

const limpio = (s: unknown) => (typeof s === "string" && s.trim() ? s.trim() : null);

export function useContactoEmpresa(): ContactoEmpresa {
  const [c, setC] = useState<ContactoEmpresa>({ nombre: null, telefono: null, email: null, ciudad: null });
  useEffect(() => {
    let vivo = true;
    supabase.from("empresas").select("nombre, telefono, email, ciudad").eq("activo", true).order("orden").limit(1).maybeSingle()
      .then(({ data }) => {
        if (!vivo || !data) return;
        const d = data as Record<string, unknown>;
        setC({ nombre: limpio(d.nombre), telefono: limpio(d.telefono), email: limpio(d.email), ciudad: limpio(d.ciudad) });
      });
    return () => { vivo = false; };
  }, []);
  return c;
}

/** Enlace tel: con solo dígitos y el + inicial. */
export const hrefTelefono = (t: string) => `tel:${t.replace(/(?!^\+)[^\d]/g, "")}`;
