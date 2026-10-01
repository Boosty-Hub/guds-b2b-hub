// Planificación de pagos a proveedores (fase 21c): tipos, grupos de vencimiento y fechas del día de caja.
import { supabase } from "@/lib/supabase";

export interface FacturaPlan {
  id: string; empresa_id: string; numero: string; referencia: string | null; proveedor_id: string | null;
  proveedor_nombre: string | null; proveedor_rif: string | null; fecha_emision: string | null; fecha_vencimiento: string | null;
  vence: string | null; condicion_pago: string | null; plazo_dias: number | null; moneda: string; es_nota_debito: boolean;
  total_usd: number; saldo_usd: number; impuesto_usd: number; ret_iva_emitida: boolean; ret_islr_emitida: boolean;
  iva_pct: number | null; islr_pct: number | null; ret_iva_pend: number; ret_islr_pend: number;
  plan_id: string | null; plan_numero: string | null; plan_estado: string | null; plan_monto: number | null;
}

export interface PlanPago {
  id: string; empresa_id: string; numero: string; estado: EstadoPlan; fecha_corte: string; fecha_pago: string; notas: string | null;
  tasa_bcv: number | null; aprobado_at: string | null; cerrado_at: string | null; cierre: string | null; anulado_motivo: string | null;
  conciliado_at: string | null; created_at: string; updated_at: string;
  creado?: { nombre: string | null; apellido: string | null } | null;
  aprobado?: { nombre: string | null; apellido: string | null } | null;
  cerrado?: { nombre: string | null; apellido: string | null } | null;
  items?: ItemPlan[];
}
export type EstadoPlan = "borrador" | "aprobado" | "pagado" | "anulado";

export interface ItemPlan {
  id: string; plan_id: string; empresa_id: string; factura_proveedor_id: string | null; proveedor_id: string | null;
  factura_numero: string; factura_referencia: string | null; proveedor_nombre: string | null; fecha_vencimiento: string | null;
  saldo_al_planificar: number; ret_pendiente_est: number; monto_usd: number; moneda_pago: "USD" | "BS"; banco_id: string | null;
  notas: string | null; estado: EstadoItem; monto_pagado_usd: number; retenido_usd: number; diferencia_usd: number | null;
  motivo_diferencia: string | null; pagos_odoo: string | null; fecha_pago_real: string | null;
  factura?: { saldo_usd: number; estado_pago: string } | null;
  banco?: { nombre: string; moneda: string } | null;
}
export type EstadoItem = "pendiente" | "parcial" | "pagado" | "diferencia";

export const ESTADO_PLAN: Record<EstadoPlan, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; clase?: string }> = {
  borrador: { label: "Borrador", variant: "secondary" },
  aprobado: { label: "Aprobado", variant: "outline", clase: "border-primary text-primary" },
  pagado: { label: "Pagado", variant: "default", clase: "bg-success text-success-foreground hover:bg-success" },
  anulado: { label: "Anulado", variant: "destructive" },
};
export const ESTADO_ITEM: Record<EstadoItem, { label: string; clase: string }> = {
  pendiente: { label: "Pendiente", clase: "text-muted-foreground" },
  parcial: { label: "Parcial", clase: "text-warning" },
  pagado: { label: "Pagado", clase: "text-success" },
  diferencia: { label: "Diferencia", clase: "text-destructive" },
};

export const DIAS_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

// ── Fechas (siempre en hora de Caracas, como texto AAAA-MM-DD) ──
export const hoyCaracas = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Caracas" });
const aFecha = (iso: string) => new Date(`${iso}T12:00:00Z`);
export const sumarDias = (iso: string, n: number) => {
  const d = aFecha(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
};
export const diasEntre = (desde: string, hasta: string) => Math.round((aFecha(hasta).getTime() - aFecha(desde).getTime()) / 86400000);
/** Próximo día de caja (0 = domingo … 6 = sábado) desde `desde`, incluido: si hoy es el día de caja, es hoy. */
export const proximoDiaCaja = (dia: number, desde = hoyCaracas()) => {
  const d = aFecha(desde).getUTCDay();
  return sumarDias(desde, (dia - d + 7) % 7);
};
export const fmtFecha = (d?: string | null) => (d ? new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString("es-VE") : "—");
export const fmtFechaCorta = (iso: string) =>
  aFecha(iso).toLocaleDateString("es-VE", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
export const fmtUsd = (n: number) => {
  const v = Number(n) || 0;
  return `${v < 0 && Math.abs(v) >= 0.005 ? "-" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
export const fmtBs = (n: number) => `Bs. ${(Number(n) || 0).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const nombrePersona = (u?: { nombre: string | null; apellido: string | null } | null) =>
  u ? [u.nombre, u.apellido].filter(Boolean).join(" ") || "—" : "—";

// ── Grupos de vencimiento respecto a la fecha de corte ──
export type Grupo = "vencido" | "corte" | "d7" | "d14" | "d30" | "despues";
export const GRUPOS: { k: Grupo; label: string; corto: string }[] = [
  { k: "vencido", label: "Vencido", corto: "Vencido" },
  { k: "corte", label: "Vence hasta el corte", corto: "Hasta el corte" },
  { k: "d7", label: "Corte + 7 días", corto: "+7 días" },
  { k: "d14", label: "Corte + 14 días", corto: "+14 días" },
  { k: "d30", label: "Corte + 30 días", corto: "+30 días" },
  { k: "despues", label: "Más de 30 días después del corte", corto: "Después" },
];
/** Vencido = vence antes de hoy; luego por tramos desde hoy hasta el corte y 7/14/30 días después del corte. */
export function grupoDe(vence: string | null, hoy: string, corte: string): Grupo {
  if (!vence) return "corte";
  if (vence < hoy) return "vencido";
  if (vence <= corte) return "corte";
  const d = diasEntre(corte, vence);
  return d <= 7 ? "d7" : d <= 14 ? "d14" : d <= 30 ? "d30" : "despues";
}
export const rangoGrupo = (g: Grupo, hoy: string, corte: string) => {
  switch (g) {
    case "vencido": return `antes del ${fmtFecha(hoy)}`;
    case "corte": return `${fmtFecha(hoy)} – ${fmtFecha(corte)}`;
    case "d7": return `${fmtFecha(sumarDias(corte, 1))} – ${fmtFecha(sumarDias(corte, 7))}`;
    case "d14": return `${fmtFecha(sumarDias(corte, 8))} – ${fmtFecha(sumarDias(corte, 14))}`;
    case "d30": return `${fmtFecha(sumarDias(corte, 15))} – ${fmtFecha(sumarDias(corte, 30))}`;
    default: return `desde el ${fmtFecha(sumarDias(corte, 31))}`;
  }
};
export const retPendiente = (f: Pick<FacturaPlan, "ret_iva_pend" | "ret_islr_pend">) => Number(f.ret_iva_pend || 0) + Number(f.ret_islr_pend || 0);
/** Lo que se sugiere pagar: el saldo menos las retenciones que aún no se emitieron (se emiten al pagar). */
export const netoSugerido = (f: FacturaPlan) => Math.max(0, Math.round((Number(f.saldo_usd) - retPendiente(f)) * 100) / 100);

// ── Saldos de bancos (módulo Bancos, saldos que trae Odoo) ──
export interface BancoSaldo { id: string; nombre: string; moneda: string; empresa_id: string | null; saldo: number; saldo_usd: number; compartida: boolean }
export async function cargarBancos(): Promise<BancoSaldo[]> {
  const { data } = await supabase.from("bancos")
    .select("id, nombre, moneda, empresa_id, saldo_odoo, saldo_odoo_usd, cuenta_compartida, activo, tipo_odoo")
    .eq("activo", true).order("nombre");
  return ((data ?? []) as { id: string; nombre: string; moneda: string; empresa_id: string | null; saldo_odoo: number | null; saldo_odoo_usd: number | null; cuenta_compartida: boolean | null }[])
    .map((b) => ({ id: b.id, nombre: b.nombre, moneda: (b.moneda || "USD").toUpperCase() === "USD" ? "USD" : "BS", empresa_id: b.empresa_id,
      saldo: Number(b.saldo_odoo || 0), saldo_usd: Number(b.saldo_odoo_usd || 0), compartida: !!b.cuenta_compartida }));
}
/** Disponible por moneda: USD en dólares; Bs en bolívares (y su equivalente en USD a la tasa BCV). */
export function disponiblePorMoneda(bancos: BancoSaldo[], empresaId: string | null) {
  const de = bancos.filter((b) => !empresaId || b.empresa_id === empresaId || b.empresa_id === null);
  return {
    usd: de.filter((b) => b.moneda === "USD").reduce((s, b) => s + b.saldo, 0),
    bs: de.filter((b) => b.moneda === "BS").reduce((s, b) => s + b.saldo, 0),
    bancos: de,
  };
}

export async function cargarDiasCaja(): Promise<Record<string, number>> {
  const { data } = await supabase.from("dias_caja").select("empresa_id, dia_semana").eq("tipo", "proveedores");
  return Object.fromEntries(((data ?? []) as { empresa_id: string; dia_semana: number }[]).map((d) => [d.empresa_id, d.dia_semana]));
}

export const mensajeError = (e: unknown) => {
  const m = (e as { message?: string })?.message || String(e);
  return m.replace(/^.*?ERROR:\s*/, "");
};
