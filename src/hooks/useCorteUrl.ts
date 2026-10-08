import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { esIso, hoyCaracas } from "@/lib/fechas";

// Fecha de corte en la URL (?corte=AAAA-MM-DD), para SelectorCorte (fase 22c). Sin el parámetro (o inválido o futuro), hoy.

/** Corte en la URL: [corte efectivo (hoy si no hay o es inválido o futuro), cambiar(fecha|null)]. */
export function useCorteUrl(param = "corte"): [string, (fecha: string | null) => void, boolean] {
  const [sp, setSp] = useSearchParams();
  const hoy = hoyCaracas();
  const crudo = sp.get(param);
  const corte = esIso(crudo) && crudo < hoy ? crudo : hoy;
  const cambiar = useCallback((fecha: string | null) => {
    setSp((prev) => {
      const n = new URLSearchParams(prev);
      if (!fecha || !esIso(fecha) || fecha >= hoyCaracas()) n.delete(param); else n.set(param, fecha);
      return n;
    }, { replace: true });
  }, [setSp, param]);
  return [corte, cambiar, corte !== hoy];
}
