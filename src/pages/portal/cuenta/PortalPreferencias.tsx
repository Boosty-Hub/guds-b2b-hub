import { useState } from "react";
import { PortalMobileLayout } from "@/components/portal/PortalMobileLayout";
import { useCurrency } from "@/contexts/CurrencyContext";
import { 
  ChevronLeft,
  Settings,
  Moon,
  Sun,
  Globe,
  DollarSign,
  Check
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

const PortalPreferencias = () => {
  const navigate = useNavigate();
  const { currency, setCurrency } = useCurrency();
  const [darkMode, setDarkMode] = useState(false);

  const currencies = [
    { id: "USD", name: "Dólar (USD)", symbol: "$" },
    { id: "VES", name: "Bolívar (VES)", symbol: "Bs." },
  ];

  return (
    <PortalMobileLayout showHeader={false} showNav={false}>
      {/* Header */}
      <div className="bg-primary text-primary-foreground px-4 py-3 sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-1">
            <ChevronLeft className="h-6 w-6" />
          </button>
          <h1 className="text-lg font-semibold">Preferencias</h1>
        </div>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Appearance */}
        <div className="bg-card rounded-xl border border-border p-4">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Apariencia
          </h3>
          
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                {darkMode ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
              </div>
              <div>
                <p className="font-medium">Modo oscuro</p>
                <p className="text-sm text-muted-foreground">Cambiar tema de la aplicación</p>
              </div>
            </div>
            <Switch 
              checked={darkMode}
              onCheckedChange={setDarkMode}
            />
          </div>
        </div>

        {/* Currency */}
        <div className="bg-card rounded-xl border border-border p-4">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Moneda
          </h3>
          
          <div className="space-y-2">
            {currencies.map((curr) => (
              <button
                key={curr.id}
                onClick={() => setCurrency(curr.id as any)}
                className={`w-full p-3 rounded-xl border flex items-center justify-between transition-colors ${
                  currency === curr.id 
                    ? "border-primary bg-primary/5" 
                    : "border-border"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-lg font-bold text-muted-foreground">{curr.symbol}</span>
                  <span className="font-medium">{curr.name}</span>
                </div>
                {currency === curr.id && (
                  <div className="h-6 w-6 rounded-full bg-primary flex items-center justify-center">
                    <Check className="h-4 w-4 text-white" />
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Language */}
        <div className="bg-card rounded-xl border border-border p-4">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Idioma
          </h3>
          
          <button
            className="w-full p-3 rounded-xl border border-primary bg-primary/5 flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <span className="text-lg">🇪🇸</span>
              <span className="font-medium">Español</span>
            </div>
            <div className="h-6 w-6 rounded-full bg-primary flex items-center justify-center">
              <Check className="h-4 w-4 text-white" />
            </div>
          </button>
        </div>

        {/* App Info */}
        <div className="bg-muted rounded-xl p-4 text-center">
          <p className="text-sm text-muted-foreground">GUDS App v1.0.0</p>
          <p className="text-xs text-muted-foreground mt-1">© 2024 GUDS Distribuidora</p>
        </div>
      </div>
    </PortalMobileLayout>
  );
};

export default PortalPreferencias;
