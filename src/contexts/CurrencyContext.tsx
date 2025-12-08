import { createContext, useContext, useState, ReactNode } from "react";

interface CurrencyContextType {
  currency: "USD" | "BS";
  setCurrency: (currency: "USD" | "BS") => void;
  exchangeRate: number;
  setExchangeRate: (rate: number) => void;
  formatPrice: (priceUSD: number) => string;
  convertToBS: (priceUSD: number) => number;
  convertToUSD: (priceBS: number) => number;
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined);

export const CurrencyProvider = ({ children }: { children: ReactNode }) => {
  const [currency, setCurrency] = useState<"USD" | "BS">("USD");
  const [exchangeRate, setExchangeRate] = useState(36.85); // 1 USD = 36.85 Bs.

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
