import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";
import { supabase } from "@/lib/supabase";

interface RefreshResult {
  ok: boolean;
  tasa?: number;
  fuente?: string;
  error?: string;
}

interface CurrencyContextType {
  currency: "USD" | "BS";
  setCurrency: (currency: "USD" | "BS") => void;
  exchangeRate: number;
  setExchangeRate: (rate: number) => void;
  tasaActualizada: string | null;
  tasaFuente: string | null;
  refreshing: boolean;
  refreshTasa: () => Promise<RefreshResult>;
  formatPrice: (priceUSD: number) => string;
  convertToBS: (priceUSD: number) => number;
  convertToUSD: (priceBS: number) => number;
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined);

export const CurrencyProvider = ({ children }: { children: ReactNode }) => {
  const [currency, setCurrency] = useState<"USD" | "BS">("USD");
  // Fuente de verdad: configuracion.tasa_cambio en la BD (tasa BCV Bs/USD). El valor
  // inicial es solo un placeholder hasta que carga; se sobrescribe en el useEffect.
  const [exchangeRate, setExchangeRate] = useState(0);
  const [tasaActualizada, setTasaActualizada] = useState<string | null>(null);
  const [tasaFuente, setTasaFuente] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const cargarTasa = useCallback(async () => {
    const { data } = await supabase
      .from("configuracion")
      .select("clave, valor")
      .in("clave", ["tasa_cambio", "tasa_cambio_actualizada", "tasa_cambio_fuente"]);
    if (!data) return;
    const map = Object.fromEntries(data.map((r) => [r.clave, r.valor]));
    const tasa = Number(map["tasa_cambio"]);
    if (Number.isFinite(tasa) && tasa > 0) setExchangeRate(tasa);
    setTasaActualizada(map["tasa_cambio_actualizada"] ?? null);
    setTasaFuente(map["tasa_cambio_fuente"] ?? null);
  }, []);

  useEffect(() => {
    cargarTasa();
  }, [cargarTasa]);

  // Dispara la actualización de la tasa desde el BCV (misma Edge Function que el cron).
  const refreshTasa = useCallback(async (): Promise<RefreshResult> => {
    setRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke("actualizar-tasa-bcv");
      if (error) return { ok: false, error: error.message };
      await cargarTasa();
      return (data as RefreshResult) ?? { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Error desconocido" };
    } finally {
      setRefreshing(false);
    }
  }, [cargarTasa]);

  const convertToBS = (priceUSD: number): number => {
    return priceUSD * exchangeRate;
  };

  const convertToUSD = (priceBS: number): number => {
    return priceBS / exchangeRate;
  };

  const formatPrice = (priceUSD: number): string => {
    if (currency === "USD") {
      return `$${priceUSD.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    } else {
      const priceBS = convertToBS(priceUSD);
      return `Bs. ${priceBS.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
  };

  return (
    <CurrencyContext.Provider
      value={{
        currency,
        setCurrency,
        exchangeRate,
        setExchangeRate,
        tasaActualizada,
        tasaFuente,
        refreshing,
        refreshTasa,
        formatPrice,
        convertToBS,
        convertToUSD,
      }}
    >
      {children}
    </CurrencyContext.Provider>
  );
};

export const useCurrency = () => {
  const context = useContext(CurrencyContext);
  if (context === undefined) {
    throw new Error("useCurrency must be used within a CurrencyProvider");
  }
  return context;
};
