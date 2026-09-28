import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Cuentas donde el cliente puede pagar: vista public.cuentas_pago (fase 19l). Solo trae las cuentas publicadas
// (activas y visible_portal) de la empresa activa, con los datos de pago; los clientes ya no leen la tabla bancos.
export interface CuentaPago {
  id: string;
  empresa_id: string | null;
  nombre: string;
  banco_nombre: string | null;
  moneda: "BS" | "USD";
  metodo_pago: string | null;
  metodos: string[] | null;
  tipo_odoo: string | null;
  numero_cuenta: string | null;
  titular: string | null;
  documento: string | null;             // RIF del titular
  pago_movil_telefono: string | null;
  pago_movil_documento: string | null;
  pago_movil_banco: string | null;      // código de 4 dígitos (p. ej. 0134)
  zelle_correo: string | null;
  zelle_titular: string | null;
  instrucciones: string | null;
}

export type MetodoCuenta = "transferencia" | "pago_movil" | "zelle";

export const METODO_LABEL: Record<string, string> = {
  transferencia: "Transferencia",
  pago_movil: "Pago móvil",
  zelle: "Zelle",
  efectivo: "Efectivo",
  credito: "Crédito",
  tarjeta: "Tarjeta",
};

// Métodos que se ofrecen por cuenta (decisión 28-sep): transferencia siempre; pago móvil solo si la cuenta tiene
// teléfono de pago móvil; Zelle solo si tiene correo Zelle. La columna `metodos` de Odoo no se usa para el cliente.
export const metodosDeCuenta = (c: CuentaPago): MetodoCuenta[] => [
  "transferencia",
  ...(c.pago_movil_telefono ? (["pago_movil"] as const) : []),
  ...(c.zelle_correo ? (["zelle"] as const) : []),
];

// banco_nombre viene de Odoo como "BANESCO - UNIOVECA": nombre del banco y código SWIFT/BIC.
export const separarBanco = (banco: string | null): { nombre: string | null; swift: string | null } => {
  if (!banco) return { nombre: null, swift: null };
  const m = banco.match(/^(.*?)\s+-\s+([A-Z0-9]{8}(?:[A-Z0-9]{3})?)$/);
  return m ? { nombre: m[1].trim(), swift: m[2] } : { nombre: banco.trim(), swift: null };
};

export const useCuentasPago = () => {
  const [cuentas, setCuentas] = useState<CuentaPago[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const recargar = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase
      .from("cuentas_pago")
      .select("id, empresa_id, nombre, banco_nombre, moneda, metodo_pago, metodos, tipo_odoo, numero_cuenta, titular, documento, pago_movil_telefono, pago_movil_documento, pago_movil_banco, zelle_correo, zelle_titular, instrucciones")
      .order("moneda")
      .order("nombre");
    setError(err ? err.message : null);
    setCuentas((data as CuentaPago[] | null) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { recargar(); }, [recargar]);

  return { cuentas, loading, error, recargar };
};
