import { useCurrency } from "@/contexts/CurrencyContext";
import { Button } from "@/components/ui/button";
import { DollarSign } from "lucide-react";

export const CurrencySwitch = () => {
  const { currency, setCurrency, exchangeRate } = useCurrency();

  const toggleCurrency = () => {
    setCurrency(currency === "USD" ? "BS" : "USD");
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={toggleCurrency}
        className="gap-2 min-w-[100px]"
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
      <span className="text-xs text-muted-foreground hidden sm:block">
        1 USD = {exchangeRate} Bs.
      </span>
    </div>
  );
};
