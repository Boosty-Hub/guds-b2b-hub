import { supabase, type Empresa } from "@/lib/supabase";

// Arranque de la sesión en paralelo. Antes era una cadena: perfil (usuarios) → empresas (permitidas, catálogo y
// asignadas) → ficha del cliente (mi_cliente_id). Ahora, en cuanto se conoce la sesión:
//  · las empresas permitidas y el catálogo de empresas salen junto con el perfil (no dependen de él);
//  · las empresas asignadas viajan dentro de la consulta del perfil (usuarios → usuario_empresas);
//  · la ficha del cliente se pide ya con la empresa que quedó activa la última vez (pista guardada en el navegador).
//    Solo se usa si esa empresa resulta ser la activa; si no, se vuelve a pedir con la correcta. Cada consulta es la
//    misma que antes, con los mismos parámetros y la misma empresa: solo cambia cuándo sale.

export interface EmpresasArranque {
  permitidas: string[];
  todas: Empresa[];
}

export interface EmpresaAsignada {
  empresa_id: string;
  por_defecto: boolean;
}

/** Columnas del perfil en el arranque: el perfil completo y sus empresas asignadas. */
export const SELECT_PERFIL = "*, usuario_empresas(empresa_id, por_defecto)";

interface Pista {
  rol: string;
  empresa: string;
}

let empresasEnCurso: { authId: string; promesa: Promise<EmpresasArranque> } | null = null;
let clienteEnCurso: { authId: string; empresa: string; promesa: Promise<string | null> } | null = null;
const asignadasPorUsuario = new Map<string, EmpresaAsignada[]>();

const clavePista = (authId: string) => `guds.arranque.${authId}`;

function leerPista(authId: string): Pista | null {
  try {
    const v = JSON.parse(localStorage.getItem(clavePista(authId)) || "null");
    return v && typeof v.rol === "string" && typeof v.empresa === "string" ? v : null;
  } catch {
    return null;
  }
}

/** Recuerda el rol y la empresa que quedó activa, para adelantar la ficha del cliente en el próximo arranque. */
export function guardarPista(authId: string | undefined, rol: string | undefined, empresa: string) {
  if (!authId || !rol) return;
  try { localStorage.setItem(clavePista(authId), JSON.stringify({ rol, empresa })); } catch { /* sin almacenamiento */ }
}

async function pedirEmpresas(): Promise<EmpresasArranque> {
  const [{ data: permitidas }, { data: todas }] = await Promise.all([
    supabase.rpc("empresas_permitidas"),
    supabase.from("empresas").select("*").eq("activo", true).order("orden"),
  ]);
  return { permitidas: (permitidas as string[] | null) ?? [], todas: (todas as Empresa[] | null) ?? [] };
}

/** Ficha del cliente en una empresa (un cliente presente en ambas empresas tiene una ficha por empresa). */
export async function pedirMiClienteId(empresa: string): Promise<string | null> {
  const { data } = await supabase.rpc("mi_cliente_id").setHeader("x-empresa-id", empresa);
  return (data as string | null) ?? null;
}

/** Lanza las consultas del arranque que no dependen del perfil. Se llama en cuanto se conoce la sesión. */
export function lanzarArranque(authId: string) {
  empresasEnCurso = { authId, promesa: pedirEmpresas() };
  const pista = leerPista(authId);
  clienteEnCurso = pista?.rol === "cliente"
    ? { authId, empresa: pista.empresa, promesa: pedirMiClienteId(pista.empresa) }
    : null;
}

/** Empresas permitidas y catálogo: las ya lanzadas para esta sesión o, si no las hay, se piden ahora. */
export function tomarEmpresas(authId: string | undefined): Promise<EmpresasArranque> {
  const enCurso = empresasEnCurso;
  empresasEnCurso = null;
  return enCurso && enCurso.authId === authId ? enCurso.promesa : pedirEmpresas();
}

/** Ficha del cliente para la empresa que queda activa: la adelantada si coincide la empresa o, si no, se pide ahora. */
export function tomarMiClienteId(authId: string | undefined, empresa: string): Promise<string | null> {
  const enCurso = clienteEnCurso;
  clienteEnCurso = null;
  return enCurso && enCurso.authId === authId && enCurso.empresa === empresa ? enCurso.promesa : pedirMiClienteId(empresa);
}

/** Guarda las empresas asignadas que llegaron con el perfil. */
export function guardarAsignadas(usuarioId: string, asignadas: EmpresaAsignada[] | null | undefined) {
  if (Array.isArray(asignadas)) asignadasPorUsuario.set(usuarioId, asignadas);
}

/** Empresas asignadas del usuario (llegadas con el perfil) o, si no las hay, se piden ahora. */
export async function tomarAsignadas(usuarioId: string): Promise<EmpresaAsignada[]> {
  const guardadas = asignadasPorUsuario.get(usuarioId);
  asignadasPorUsuario.delete(usuarioId);
  if (guardadas) return guardadas;
  const { data } = await supabase.from("usuario_empresas").select("empresa_id, por_defecto").eq("usuario_id", usuarioId);
  return (data as EmpresaAsignada[] | null) ?? [];
}
