import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

// Edición de teléfonos y direcciones de un cliente que se escribe en Odoo (migración 19w).
// Las mismas reglas que validan actualizar_contacto_cliente / guardar_direccion_cliente en la base, para avisar antes de enviar.

/** Estados de Venezuela (los de res.country.state en Odoo). */
export const ESTADOS_VE = [
  "Amazonas", "Anzoátegui", "Apure", "Aragua", "Barinas", "Bolívar", "Carabobo", "Cojedes", "Delta Amacuro",
  "Dependencias Federales", "Distrito Capital", "Falcón", "Guárico", "La Guaira", "Lara", "Mérida", "Miranda", "Monagas",
  "Nueva Esparta", "Portuguesa", "Sucre", "Táchira", "Trujillo", "Yaracuy", "Zulia",
] as const;

const normEstado = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\([^)]*\)/g, "").replace(/\./g, "").replace(/\s+/g, " ").trim().toLowerCase();

/** "Sucre. (VE)" (como lo guarda Odoo) → "Sucre"; null si no es un estado de Venezuela. */
export function estadoVe(valor?: string | null): string | null {
  if (!valor) return null;
  const n = normEstado(valor);
  return ESTADOS_VE.find((e) => normEstado(e) === n) ?? null;
}

/** Error de un teléfono venezolano (un número por campo, extensión opcional) o null si es válido o está vacío. */
export function errorTelefonoVe(valor: string, campo: string, soloMovil = false): string | null {
  const v = valor.trim();
  if (!v) return null;
  if (v.length > 40) return `El ${campo} es demasiado largo.`;
  const num = v.replace(/\s*(ext\.?|extensi[oó]n|x)\s*[0-9]{1,6}\s*$/i, "");
  const dig = num.replace(/[^0-9]/g, "");
  if (!/^[0-9 +().-]+$/.test(num) || !/^(580?|0)?[24][0-9]{9}$/.test(dig)) return `Escribe un solo número venezolano, p. ej. ${soloMovil ? "0414-1234567" : "0212-5551234"}.`;
  if (soloMovil && !/^4(12|14|16|22|24|26)/.test(dig.replace(/^(580?|0)/, ""))) return "Debe ser un móvil (0412, 0414, 0416, 0422, 0424 o 0426).";
  return null;
}

export interface DireccionForm { calle: string; complemento: string; ciudad: string; estado: string }

/** Errores por campo de una dirección de Odoo (calle, ciudad y estado obligatorios). */
export function erroresDireccion(d: DireccionForm): Partial<Record<keyof DireccionForm, string>> {
  const e: Partial<Record<keyof DireccionForm, string>> = {};
  const calle = d.calle.trim().replace(/\s+/g, " ");
  if (calle.length < 4) e.calle = "La calle es obligatoria (mínimo 4 caracteres).";
  else if (calle.length > 200) e.calle = "Máximo 200 caracteres.";
  if (d.complemento.trim().length > 200) e.complemento = "Máximo 200 caracteres.";
  const ciudad = d.ciudad.trim();
  if (ciudad.length < 2) e.ciudad = "La ciudad es obligatoria.";
  else if (ciudad.length > 100) e.ciudad = "Máximo 100 caracteres.";
  if (!estadoVe(d.estado)) e.estado = "Elige un estado.";
  return e;
}

export const direccionPayload = (d: DireccionForm) => ({
  calle: d.calle.trim(), complemento: d.complemento.trim(), ciudad: d.ciudad.trim(), estado: d.estado,
});

/** Fila de historial_escrituras_cliente. */
export interface EscrituraCliente {
  id: string;
  tipo: "cliente_contacto" | "cliente_direccion" | "cliente_nuevo" | "persona_contacto" | "cliente_limite";
  accion: "editar" | "crear";
  direccion: string | null;
  estado: "pendiente" | "procesando" | "simulada" | "hecha" | "error";
  campos: Record<string, string | null> | null;
  antes: Record<string, string | null> | null;
  resultado: {
    modo?: "simulacion" | "aplicada";
    cambios?: { campo: string; antes: string | number | null; despues: string | number | null }[];
    contactos_hijos?: number;
    no_aplicados?: string[];
    ya_existia?: boolean;
    existente?: number | null;
    // Tipos de la fase 20s (alta del cliente, contactos y límite)
    accion?: string;
    motivo?: string | null;
    omitida?: string;
    sin_cambios?: boolean;
    partner?: { id: number; nombre: string | null; rif: string | null } | number;
    candidatos?: unknown[];
    valor?: number;
    contacto?: string;
    odoo_id?: number;
    nota?: { texto?: string; ok?: boolean; error?: string; simulada?: boolean } | null;
  } | null;
  error: string | null;
  intentos: number;
  solicitado_por: string | null;
  created_at: string;
  procesado_at: string | null;
}

export const esFinal = (e?: EscrituraCliente | null) => !!e && !["pendiente", "procesando"].includes(e.estado);

/** Nombre legible de los campos (de GUDS y de res.partner). */
export const ETIQUETA_CAMPO: Record<string, string> = {
  telefono: "Teléfono", celular: "Celular", calle: "Calle", complemento: "Complemento", ciudad: "Ciudad", estado: "Estado",
  nombre: "Nombre", phone: "Teléfono", mobile: "Celular", street: "Calle", street2: "Complemento", city: "Ciudad",
  state_id: "Estado", country_id: "País",
};

export async function historialCliente(clienteId: string, limite = 20) {
  const { data, error } = await supabase.rpc("historial_escrituras_cliente", { p_cliente_id: clienteId, p_limite: limite });
  if (error) throw error;
  return (data ?? []) as EscrituraCliente[];
}

/**
 * Sigue una escritura encolada hasta que Odoo responde (consulta su fila cada 1,5 s, hasta 60 s).
 * Si se agota el tiempo, la escritura sigue en cola: la sincronización periódica la reintenta.
 */
export function useSeguimientoEscritura(clienteId: string | undefined, onFinal?: (e: EscrituraCliente) => void) {
  const [id, setId] = useState<string | null>(null);
  const [escritura, setEscritura] = useState<EscrituraCliente | null>(null);
  const [agotado, setAgotado] = useState(false);
  const [reintentando, setReintentando] = useState(false);
  const [errorConsulta, setErrorConsulta] = useState<string | null>(null);
  const [ronda, setRonda] = useState(0);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  useEffect(() => {
    if (!id || !clienteId) return;
    let vivo = true;
    let intentos = 0;
    let timer: ReturnType<typeof setTimeout>;
    const consultar = async () => {
      try {
        const fila = (await historialCliente(clienteId, 30)).find((x) => x.id === id) ?? null;
        if (!vivo) return;
        setErrorConsulta(null);
        if (fila) setEscritura(fila);
        if (esFinal(fila)) { onFinalRef.current?.(fila as EscrituraCliente); return; }
      } catch (e) {
        if (vivo) setErrorConsulta((e as Error).message);
      }
      if (++intentos >= 40) { if (vivo) setAgotado(true); return; }
      timer = setTimeout(consultar, 1500);
    };
    setAgotado(false);
    timer = setTimeout(consultar, 800);
    return () => { vivo = false; clearTimeout(timer); };
  }, [id, clienteId, ronda]);

  const seguir = useCallback((nuevo: string) => { setEscritura(null); setAgotado(false); setId(nuevo); }, []);
  const limpiar = useCallback(() => { setId(null); setEscritura(null); setAgotado(false); setErrorConsulta(null); }, []);
  const reintentar = useCallback(async () => {
    if (!id) return;
    setReintentando(true);
    const { error } = await supabase.rpc("reintentar_escritura_cliente", { p_id: id });
    setReintentando(false);
    if (error) { setErrorConsulta(error.message); return; }
    setEscritura((e) => (e ? { ...e, estado: "pendiente", error: null } : e));
    setRonda((r) => r + 1);   // reinicia el seguimiento del mismo id
  }, [id]);

  return { id, escritura, agotado, reintentando, errorConsulta, seguir, limpiar, reintentar, enCurso: !!id && !esFinal(escritura) && !agotado };
}
