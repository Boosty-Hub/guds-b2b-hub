import { useCurrency } from "@/contexts/CurrencyContext";
import { Button } from "@/components/ui/button";
import { DollarSign } from "lucide-react";

interface CurrencySwitchProps {
  variant?: "default" | "header";
}

export const CurrencySwitch = ({ variant = "default" }: CurrencySwitchProps) => {
  const { currency, setCurrency, exchangeRate } = useCurrency();

  const toggleCurrency = () => {
    setCurrency(currency === "USD" ? "BS" : "USD");
  };

  const isHeader = variant === "header";

  return (
    <div className="flex items-center gap-2">
      <Button
        variant={isHeader ? "secondary" : "outline"}
        size="sm"
        onClick={toggleCurrency}
        className={`gap-2 min-w-[100px] ${isHeader ? "bg-white/20 text-white border-white/30 hover:bg-white/30" : ""}`}
      >
        {currency === "USD" ? (
          <>
            <DollarSign className="h-4 w-4" />
            <span>USD</span>
          </>
        ) : (
          <>
            <span className="font-bold text-sm">Bs.</span>
          </>
        )}
      </Button>
      <span className={`text-xs hidden sm:block ${isHeader ? "text-white/90 font-medium" : "text-muted-foreground"}`}>
        1 USD = {exchangeRate} Bs.
      </span>
    </div>
  );
};
