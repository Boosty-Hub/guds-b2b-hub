import { estadoVe } from "@/components/clientes/odooCliente";

// Presentación de estados (Fase 21d, plan de revisión 6.3). Odoo guarda el nombre del estado con su país y, en dos casos,
// con un punto ("Sucre. (VE)", "Bolivar. (VE)"). En listas y filtros se muestra el nombre limpio ("Sucre", "Bolívar"), SIN
// cambiar el dato guardado ni la clave con la que filtran las listas. Un estado de otro país conserva su sufijo
// ("Bolivar (EC)") para que el error siga a la vista hasta que se corrija en Odoo.

const SUFIJO_PAIS = /\s*\(([A-Z]{2})\)\s*$/;

/** "Sucre. (VE)" → "Sucre"; "Anzoategui (VE)" → "Anzoátegui"; "Bolivar (EC)" → "Bolivar (EC)"; vacío → "". */
export function mostrarEstado(valor?: string | null): string {
  const v = (valor ?? "").trim();
  if (!v) return "";
  const pais = v.match(SUFIJO_PAIS)?.[1];
  if (pais && pais !== "VE") return v;
  return estadoVe(v) ?? v.replace(SUFIJO_PAIS, "").replace(/\.+\s*$/, "").trim();
}

/** ¿El texto parece un estado de Odoo ("Nombre (XX)")? Para limpiar etiquetas de filtros sin tocar otros textos. */
export const pareceEstadoOdoo = (valor?: string | null) => /\S\.?\s*\(VE\)\s*$/.test((valor ?? "").trim());
