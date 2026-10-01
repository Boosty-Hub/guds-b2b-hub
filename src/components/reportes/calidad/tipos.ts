// Bandeja de calidad de datos y cuadre (Fase 21d · plan de revisión 30-sep, Fase 6).
// Cada tarea la crea y la cierra la base (calidad_sincronizar_tareas, migración 20261001_fase21d_calidad_tareas.sql):
// aquí solo se describe cada tipo para la pantalla.
import { mostrarEstado } from "@/lib/estados";

export type Grupo = "calidad" | "cuadre";
export type EstadoTarea = "pendiente" | "corregido" | "explicado";
export type Detalle = Record<string, unknown> & { sugerido?: { ciudad?: string | null; estado?: string | null } };

export interface Escritura { id: string; estado: string; error: string | null; procesado_at: string | null; created_at: string }
export interface Tarea {
  id: string;
  empresa_id: string | null;
  tipo: string;
  grupo: Grupo;
  entidad: "cliente" | "producto" | "factura" | "pago" | "estado" | "profit_documento";
  entidad_id: string | null;
  clave: string;
  estado: EstadoTarea;
  responsable_id: string | null;
  comentario: string | null;
  detalle: Detalle;
  escritura_id: string | null;
  escritura?: Escritura | null;
  detectada_at: string;
  cerrada_at: string | null;
  cierre_automatico: boolean;
  updated_at: string;
}
export interface Historial {
  id: string; at: string; usuario_nombre: string | null; accion: string; de: string | null; a: string | null; comentario: string | null;
  detalle: Record<string, unknown> | null;
}

/** Cómo se corrige: con un clic hacia Odoo (asistida), en Odoo (con enlace) o en GUDS. */
export type Correccion = "asistida" | "odoo" | "contable" | "guds" | "explicar";

export interface DefTipo {
  grupo: Grupo;
  titulo: string;
  corto: string;
  ayuda: string;
  donde: string;
  correccion: Correccion;
  /** Modelo de Odoo para el enlace "Abrir en Odoo" */
  modelo?: string;
}

export const TIPOS: Record<string, DefTipo> = {
  cliente_estado_extranjero: { grupo: "calidad", titulo: "Clientes con estado de otro país", corto: "Estado de otro país", correccion: "asistida", modelo: "res.partner",
    ayuda: "El estado del contacto es de otro país (p. ej. «Bolivar (EC)», de Ecuador)", donde: "Corrección asistida: GUDS lo escribe en Odoo" },
  cliente_sin_estado: { grupo: "calidad", titulo: "Clientes sin estado", corto: "Sin estado", correccion: "asistida", modelo: "res.partner",
    ayuda: "Clientes activos sin estado en su dirección", donde: "Corrección asistida: GUDS lo escribe en Odoo" },
  cliente_sin_ciudad: { grupo: "calidad", titulo: "Clientes sin ciudad", corto: "Sin ciudad", correccion: "asistida", modelo: "res.partner",
    ayuda: "Clientes activos sin ciudad en su dirección (GUDS sugiere una a partir de la calle)", donde: "Corrección asistida: GUDS lo escribe en Odoo" },
  estado_con_punto: { grupo: "calidad", titulo: "Estados con punto en el nombre (Odoo)", corto: "Estado con punto", correccion: "explicar",
    ayuda: "El nombre del estado en Odoo trae un punto («Sucre.», «Bolivar.»). GUDS ya lo muestra limpio en listas y filtros sin cambiar el dato",
    donde: "Odoo → Contactos → Configuración → Estados federales (una vez, no por cliente)" },
  cliente_sin_condicion: { grupo: "calidad", titulo: "Clientes sin condición de pago", corto: "Sin condición de pago", correccion: "odoo", modelo: "res.partner",
    ayuda: "Clientes activos sin plazo de pago", donde: "Odoo → Contactos → Ventas y compras → Plazo de pago" },
  cliente_sin_rif: { grupo: "calidad", titulo: "Clientes sin RIF", corto: "Sin RIF", correccion: "odoo", modelo: "res.partner",
    ayuda: "Clientes activos sin RIF ni cédula", donde: "Odoo → Contactos → RIF" },
  producto_sin_costo: { grupo: "calidad", titulo: "Productos con ventas y sin costo", corto: "Sin costo", correccion: "odoo", modelo: "product.template",
    ayuda: "Productos vendidos sin costo en su empresa (el margen no los cuenta)", donde: "Odoo → Inventario → producto → Costo (en cada empresa)" },
  producto_sin_categoria: { grupo: "calidad", titulo: "Productos con ventas y sin categoría", corto: "Sin categoría", correccion: "odoo", modelo: "product.template",
    ayuda: "Productos vendidos sin categoría o en la categoría raíz de Odoo («Todos»)", donde: "Odoo → Inventario → producto → Categoría" },
  producto_categoria_inactiva: { grupo: "calidad", titulo: "Productos con ventas en una categoría inactiva", corto: "Categoría inactiva", correccion: "guds", modelo: "product.template",
    ayuda: "La categoría del producto está desactivada en GUDS pero el producto se vende", donde: "GUDS → Categorías (activar) u Odoo → mover el producto de categoría" },
  factura_anulada_con_saldo: { grupo: "calidad", titulo: "Facturas anuladas que Odoo aún tiene con saldo", corto: "Anuladas con saldo", correccion: "contable", modelo: "account.move",
    ayuda: "Documentos revertidos con nota de crédito o cancelados que conservan saldo en Odoo", donde: "Odoo → Contabilidad → conciliar la factura con su nota de crédito" },
  cobro_sin_aplicar: { grupo: "calidad", titulo: "Cobros de Odoo con parte sin aplicar", corto: "Cobros sin aplicar", correccion: "contable", modelo: "account.payment",
    ayuda: "Cobros verificados con al menos 1 USD sin conciliar con facturas", donde: "Odoo → Contabilidad → conciliar el cobro con sus facturas" },
  cuadre_documento: { grupo: "cuadre", titulo: "Saldos iniciales que no cuadran con Profit", corto: "No cuadran", correccion: "explicar", modelo: "account.move",
    ayuda: "Documento que Odoo recibió como cartera abierta de Profit y no coincide con el histórico de Profit", donde: "Revisar uno a uno y explicar; si hay error, corregir en Odoo" },
  cuadre_sin_saldo_inicial: { grupo: "cuadre", titulo: "Pendientes en Profit sin saldo inicial en Odoo", corto: "Sin saldo inicial", correccion: "explicar",
    ayuda: "Facturas que Profit tiene «Pendiente» y no llegaron como saldo inicial a Odoo", donde: "Revisar en Profit si se cobraron antes del corte; si no, cargar el saldo en Odoo" },
  cuadre_diferencial: { grupo: "cuadre", titulo: "Diferenciales cambiarios", corto: "Diferenciales cambiarios", correccion: "explicar", modelo: "account.move",
    ayuda: "Notas de débito o de crédito en bolívares de 0,00 USD: ajustes por diferencial cambiario, no son venta ni cambian saldos",
    donde: "Revisar y marcar como explicados (se pueden explicar varios a la vez)" },
};
export const ORDEN_TIPOS = Object.keys(TIPOS);
export const tiposDe = (g: Grupo) => ORDEN_TIPOS.filter((t) => TIPOS[t].grupo === g);
export const TIPOS_DIRECCION = ["cliente_estado_extranjero", "cliente_sin_estado", "cliente_sin_ciudad"];

export const ESTADO_TAREA: Record<EstadoTarea, { texto: string; clase: string; ayuda: string }> = {
  pendiente: { texto: "Pendiente", clase: "border-warning/40 bg-warning/10 text-warning", ayuda: "Por corregir o explicar" },
  corregido: { texto: "Corregido", clase: "border-success/40 bg-success/10 text-success", ayuda: "La sincronización con Odoo trajo el dato corregido" },
  explicado: { texto: "Explicado", clase: "border-primary/40 bg-primary/10 text-primary", ayuda: "Revisado: tiene una explicación y no requiere cambio" },
};

/** Estados de cuadre (los de reporte_cuadre_profit_odoo, más los dos de la bandeja). */
export const ESTADO_CUADRE: Record<string, { texto: string; ayuda: string }> = {
  difiere: { texto: "Difiere", ayuda: "Mismo número con otro total" },
  pronto_pago: { texto: "Pronto pago 3 %", ayuda: "Odoo = Profit + 3 % de la base: el descuento global por pronto pago de Profit no pasó al saldo inicial de Odoo" },
  nc_ambigua: { texto: "NC ambigua", ayuda: "Profit numera devoluciones y notas de crédito por separado; Odoo las unió: el número corresponde a otro documento de Profit" },
  solo_odoo: { texto: "Solo en Odoo", ayuda: "Ningún documento de Profit tiene ese número (p. ej. notas de débito que no están en la vista de ventas)" },
  sin_saldo_inicial: { texto: "Sin saldo inicial", ayuda: "Profit la tiene «Pendiente» y no llegó a Odoo" },
  diferencial: { texto: "Diferencial", ayuda: "Ajuste cambiario de 0,00 USD" },
};

export const ESCRITURA: Record<string, { texto: string; clase: string }> = {
  pendiente: { texto: "Enviando a Odoo…", clase: "text-muted-foreground" },
  procesando: { texto: "Escribiendo en Odoo…", clase: "text-muted-foreground" },
  hecha: { texto: "Escrito en Odoo", clase: "text-success" },
  simulada: { texto: "Simulado (modo prueba)", clase: "text-warning" },
  error: { texto: "Error al escribir en Odoo", clase: "text-destructive" },
};

const txt = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));
const PREFIJO: Record<string, string> = { factura: "Fact.", nc: "NC", nd: "ND" };

/** Qué es (cliente, producto, documento…) en una línea. */
export function nombreEntidad(t: Tarea): string {
  const d = t.detalle;
  switch (t.entidad) {
    case "cliente": return txt(d.cliente) ?? "Cliente";
    case "producto": return [txt(d.sku), txt(d.producto)].filter(Boolean).join(" · ") || "Producto";
    case "estado": return `«${txt(d.estado) ?? t.clave}»`;
    case "pago": return [txt(d.numero), txt(d.cliente)].filter(Boolean).join(" · ") || "Cobro";
    default: {
      const pref = PREFIJO[String(d.clase ?? "")] ?? (d.tipo === "nota_credito" ? "NC" : "");
      return [`${pref} ${txt(d.numero) ?? ""}`.trim(), txt(d.cliente)].filter(Boolean).join(" · ") || "Documento";
    }
  }
}

/** El dato que está mal (o lo que hay que mirar), corto. `dinero` formatea USD. */
export function datoActual(t: Tarea, dinero: (n: number) => string): string {
  const d = t.detalle;
  const n = (k: string) => Number(d[k] ?? 0);
  switch (t.tipo) {
    case "cliente_estado_extranjero": return `${txt(d.estado)} · ${txt(d.ciudad) ?? "sin ciudad"}`;
    case "cliente_sin_estado": return txt(d.ciudad) ? `Sin estado · ${d.ciudad}` : "Sin estado ni ciudad";
    case "cliente_sin_ciudad": return `Sin ciudad · ${mostrarEstado(txt(d.estado)) || "sin estado"}`;
    case "estado_con_punto": return `${n("clientes")} clientes · se muestra «${txt(d.mostrado) ?? "—"}»`;
    case "cliente_sin_condicion": return `Sin plazo · venta 12 m ${dinero(n("venta_12m"))}`;
    case "cliente_sin_rif": return `Sin RIF · venta 12 m ${dinero(n("venta_12m"))}`;
    case "producto_sin_costo": return `Sin costo · vendido ${dinero(n("venta_usd"))}`;
    case "producto_sin_categoria": return `${txt(d.motivo) ?? "Sin categoría"} · vendido ${dinero(n("venta_usd"))}`;
    case "producto_categoria_inactiva": return `${txt(d.categoria) ?? "—"} (inactiva)`;
    case "factura_anulada_con_saldo": return `${txt(d.motivo) ?? ""} · saldo ${dinero(n("saldo_usd"))}`;
    case "cobro_sin_aplicar": return `Sin aplicar ${dinero(n("sin_aplicar_usd"))} de ${dinero(n("monto_usd"))}`;
    case "cuadre_documento": {
      const e = ESTADO_CUADRE[String(d.estado_cuadre)]?.texto ?? String(d.estado_cuadre);
      return d.diferencia_usd === null || d.diferencia_usd === undefined
        ? `${e} · Odoo ${dinero(n("total_odoo_usd"))}`
        : `${e} · Odoo ${dinero(n("total_odoo_usd"))} vs Profit ${dinero(n("total_profit_usd"))}`;
    }
    case "cuadre_sin_saldo_inicial": return `Pendiente en Profit · ${dinero(n("total_profit_usd"))}`;
    case "cuadre_diferencial": return `${txt(d.diario) ?? "Ajuste"} · Bs ${n("total_bs").toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    default: return "";
  }
}

/** Monto USD con el que se resume "cuánto queda" (diferencia, saldo, monto). */
export function montoTarea(t: Tarea): number {
  const d = t.detalle;
  const k = t.tipo === "cuadre_documento" ? (d.diferencia_usd ?? d.total_odoo_usd)
    : t.tipo === "cuadre_sin_saldo_inicial" ? d.total_profit_usd
      : t.tipo === "factura_anulada_con_saldo" ? d.saldo_usd
        : t.tipo === "cobro_sin_aplicar" ? d.sin_aplicar_usd
          : t.tipo.startsWith("producto") ? d.venta_usd
            : t.tipo.startsWith("cliente") ? d.venta_12m : 0;
  return Math.abs(Number(k ?? 0)) || 0;
}

/** Enlace al registro en Odoo (configuracion.odoo_url_web, solo administración). */
export function enlaceOdoo(base: string | null, t: Tarea, cid?: number | null): string | null {
  const id = Number(t.detalle.odoo_id);
  const modelo = TIPOS[t.tipo]?.modelo;
  if (!base || !modelo || !Number.isFinite(id) || id <= 0) return null;
  return `${base.replace(/\/+$/, "")}/web#id=${id}&model=${modelo}&view_type=form${cid ? `&cids=${cid}` : ""}`;
}

/** Texto para buscar (cliente, número, RIF, SKU…). */
export const textoBusqueda = (t: Tarea) =>
  [t.detalle.cliente, t.detalle.numero, t.detalle.rif, t.detalle.sku, t.detalle.producto, t.detalle.estado, t.detalle.ciudad, t.comentario]
    .filter(Boolean).join(" ").toLowerCase();
