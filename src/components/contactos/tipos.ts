// Módulo Contactos (migración 20v): personas de un cliente, de un proveedor o sueltas. Solo las de un cliente pueden tener
// usuario del portal de clientes. Tabla public.cliente_contactos (se generalizó; el nombre se conserva por compatibilidad).
import { supabase } from "@/lib/supabase";

export interface Contacto {
  id: string;
  empresa_id: string | null;
  cliente_id: string | null;
  proveedor_id: string | null;
  nombre: string;
  cargo: string | null;
  email: string | null;
  telefono: string | null;
  celular: string | null;
  es_principal: boolean;
  notas: string | null;
  activo: boolean;
  odoo_id: number | null;
  origen: "guds" | "odoo";
  odoo_padre_id: number | null;
  odoo_sync_at: string | null;
  created_at: string;
  updated_at: string;
  cliente?: { id: string; nombre_negocio: string; codigo: string | null; odoo_id: number | null } | null;
  proveedor?: { id: string; nombre: string; codigo: string | null; odoo_id: number | null } | null;
}

/** Acceso al portal de un contacto (accesos_portal_contactos) */
export interface AccesoPortal {
  contacto_id: string;
  usuario_id: string;
  email: string;
  activo: boolean;
  debe_cambiar_clave: boolean;
  cliente_id: string | null;
  ultimo_ingreso: string | null;
}

export const SELECT_CONTACTO = "id, empresa_id, cliente_id, proveedor_id, nombre, cargo, email, telefono, celular, es_principal, notas, activo, "
  + "odoo_id, origen, odoo_padre_id, odoo_sync_at, created_at, updated_at, cliente:clientes(id, nombre_negocio, codigo, odoo_id), "
  + "proveedor:proveedores(id, nombre, codigo, odoo_id)";

export type TipoVinculo = "cliente" | "proveedor" | "suelto";
export const tipoVinculo = (k: Pick<Contacto, "cliente_id" | "proveedor_id">): TipoVinculo =>
  (k.cliente_id ? "cliente" : k.proveedor_id ? "proveedor" : "suelto");
export const nombreVinculo = (k: Contacto) => k.cliente?.nombre_negocio ?? k.proveedor?.nombre ?? null;
export const enlaceVinculo = (k: Pick<Contacto, "cliente_id" | "proveedor_id">) =>
  (k.cliente_id ? `/admin/clientes/${k.cliente_id}` : k.proveedor_id ? `/admin/proveedores/${k.proveedor_id}` : null);

/** Estado del acceso al portal: sin acceso, activo, con clave temporal, desactivado */
export type EstadoAcceso = "sin" | "activo" | "temporal" | "desactivado";
export const estadoAcceso = (a: AccesoPortal | null | undefined, k?: Pick<Contacto, "cliente_id">): EstadoAcceso => {
  if (!a) return "sin";
  if (!a.activo || (k && a.cliente_id !== k.cliente_id)) return "desactivado";
  return a.debe_cambiar_clave ? "temporal" : "activo";
};
export const ETIQUETA_ACCESO: Record<EstadoAcceso, string> = {
  sin: "Sin acceso", activo: "Con acceso", temporal: "Clave temporal", desactivado: "Desactivado",
};

// Reglas de una contraseña elegida por el admin (las mismas que validan la base y el cambio obligatorio del portal)
export function errorClave(clave: string, confirmacion: string, email?: string | null): string | null {
  if (clave.length < 8) return "La contraseña debe tener al menos 8 caracteres.";
  if (clave.length > 72) return "La contraseña no puede tener más de 72 caracteres.";
  if (!/[A-Za-z]/.test(clave) || !/\d/.test(clave)) return "Usa letras y números.";
  if (clave !== clave.trim()) return "No puede empezar ni terminar con espacios.";
  const e = (email ?? "").toLowerCase();
  if (e && (clave.toLowerCase() === e || clave.toLowerCase() === e.split("@")[0])) return "La contraseña no puede ser el correo.";
  if (clave !== confirmacion) return "Las contraseñas no coinciden.";
  return null;
}

export const RE_CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Accesos al portal visibles para quien consulta, por contacto */
export async function cargarAccesos(): Promise<Map<string, AccesoPortal>> {
  const { data } = await supabase.rpc("accesos_portal_contactos");
  const m = new Map<string, AccesoPortal>();
  for (const a of (data as AccesoPortal[] | null) ?? []) m.set(a.contacto_id, a);
  return m;
}

export const fechaHora = (d?: string | null) =>
  (d ? new Date(d).toLocaleString("es-VE", { dateStyle: "short", timeStyle: "short" }) : null);
