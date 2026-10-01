import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useEmpresa } from "@/contexts/EmpresaContext";
import type { Grupo, Historial, Tarea } from "./tipos";

const SEL = "id, empresa_id, tipo, grupo, entidad, entidad_id, clave, estado, responsable_id, comentario, detalle, escritura_id, detectada_at, cerrada_at, cierre_automatico, updated_at, escritura:odoo_escrituras(id, estado, error, procesado_at, created_at)";

/** Tareas de un grupo (calidad o cuadre) en las empresas visibles (RLS), con el estado de su escritura a Odoo. */
export function useTareas(grupo: Grupo) {
  const { seleccion } = useEmpresa();
  const [tareas, setTareas] = useState<Tarea[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const pedido = useRef(0);

  const cargar = useCallback(async () => {
    const n = ++pedido.current;
    setCargando(true); setError(null);
    // PostgREST devuelve hasta 1000 filas por defecto en algunos clientes: se pide por páginas
    const todas: Tarea[] = [];
    for (let desde = 0; ; desde += 1000) {
      const { data, error: e } = await supabase.from("calidad_tareas").select(SEL).eq("grupo", grupo)
        .order("detectada_at", { ascending: true }).order("id").range(desde, desde + 999);
      if (n !== pedido.current) return;
      if (e) { setError(e.message); setCargando(false); return; }
      todas.push(...((data ?? []) as unknown as Tarea[]));
      if (!data || data.length < 1000) break;
    }
    setTareas(todas); setCargando(false);
  }, [grupo]);

  useEffect(() => { cargar(); }, [cargar, seleccion]);

  /** Reemplaza (o agrega) una tarea leída de nuevo, p. ej. tras enviar una corrección a Odoo. */
  const refrescarUna = useCallback(async (id: string) => {
    const { data } = await supabase.from("calidad_tareas").select(SEL).eq("id", id).maybeSingle();
    if (data) setTareas((ts) => (ts ?? []).map((t) => (t.id === id ? (data as unknown as Tarea) : t)));
    return (data as unknown as Tarea) ?? null;
  }, []);

  return { tareas, error, cargando, cargar, refrescarUna };
}

export interface Responsable { id: string; nombre: string; email: string }

export function useResponsables() {
  const [lista, setLista] = useState<Responsable[]>([]);
  useEffect(() => {
    supabase.rpc("calidad_responsables").then(({ data }) => setLista((data ?? []) as Responsable[]));
  }, []);
  return lista;
}

/** Base web de Odoo para los enlaces (solo administración la puede leer). */
export function useOdooBase() {
  const [base, setBase] = useState<string | null>(null);
  useEffect(() => {
    supabase.from("configuracion").select("valor").eq("clave", "odoo_url_web").maybeSingle()
      .then(({ data }) => setBase((data?.valor as string) || null));
  }, []);
  return base;
}

export async function leerHistorial(tareaId: string): Promise<Historial[]> {
  const { data } = await supabase.from("calidad_tareas_historial").select("id, at, usuario_nombre, accion, de, a, comentario, detalle")
    .eq("tarea_id", tareaId).order("at", { ascending: false }).limit(200);
  return (data ?? []) as Historial[];
}

export async function actualizarTareas(ids: string[], cambios: { estado?: "pendiente" | "explicado"; responsable?: string | null; comentario?: string }) {
  const { data, error } = await supabase.rpc("calidad_actualizar_tareas", {
    p_ids: ids,
    p_estado: cambios.estado ?? null,
    p_responsable: cambios.responsable ?? null,
    p_quitar_responsable: cambios.responsable === null,
    p_comentario: cambios.comentario ?? null,
  });
  if (error) throw new Error(error.message);
  return data as number;
}

export interface EstadoSeccion { oculta: boolean; revisado: string | null; detalle: Record<string, { por: string; at: string }> }

/** ¿La sección "Calidad y cuadre" está oculta para la empresa activa? (en "Ambas": si lo está en las dos). */
export function useSeccionCalidad() {
  const { seleccion } = useEmpresa();
  const [estado, setEstado] = useState<EstadoSeccion | null>(null);
  const leer = useCallback(async () => {
    const { data } = await supabase.rpc("calidad_seccion");
    setEstado((data as EstadoSeccion) ?? null);
  }, []);
  useEffect(() => { leer(); }, [leer, seleccion]);
  useEffect(() => {
    const f = () => leer();
    window.addEventListener("calidad-seccion", f);
    return () => window.removeEventListener("calidad-seccion", f);
  }, [leer]);
  const cambiar = useCallback(async (ocultar: boolean) => {
    const { data, error } = await supabase.rpc("calidad_seccion", { p_ocultar: ocultar });
    if (error) throw new Error(error.message);
    setEstado(data as EstadoSeccion);
    window.dispatchEvent(new Event("calidad-seccion"));   // la pestaña de Reportes se entera
  }, []);
  return { estado, cambiar, leer };
}
